const assert = require('node:assert/strict');
const test = require('node:test');
const { loadTsModule } = require('./helpers/load-ts.cjs');

const branding = require('../config/thorium-web/branding.local.json');

const plain = (value) => JSON.parse(JSON.stringify(value));

const config = {
  apiBaseUrl: 'https://api.library.test',
  authUrl: 'https://api.library.test/auth/login',
  catalogUrl: 'https://api.library.test/opds',
};

const load = (file) =>
  loadTsModule(file, {
    globals: { process: { env: {} } },
    stubs: {
      '@/config/thorium-web/branding.local.json': {
        default: { ...branding, library: { ...branding.library, requireEntitlement: false } },
      },
    },
  });

const context = (respond, hasSession = true) => {
  const calls = [];
  return {
    calls,
    ctx: {
      config,
      hasSession,
      upstream: async (url, init, auth) => {
        calls.push({ url, init, auth });
        return respond(url, init, auth);
      },
    },
  };
};

test('signIn authenticates the library load with the new token and asks to store it', async () => {
  const { signIn } = load('lib/library/session.ts');
  const { ctx, calls } = context((url) => {
    if (url === config.authUrl) return Response.json({ token: 'fresh-token' });
    if (url.includes('/my/entitlements')) return Response.json([]);
    return Response.json({ publications: [] });
  }, false);

  const request = new Request('capacitor://localhost/api/library/session', {
    method: 'POST',
    body: JSON.stringify({ email: 'a@b.test', password: 'pw' }),
  });
  const result = await signIn(request, ctx, 'capacitor://localhost');

  assert.equal(result.response.status, 200);
  assert.deepEqual(plain(result.session), { set: 'fresh-token' });
  assert.equal(calls[0].auth, 'none');
  assert.ok(calls.slice(1).every(({ auth }) => auth.bearer === 'fresh-token'));
});

test('signIn does not store a token when the library fails to load', async () => {
  const { signIn } = load('lib/library/session.ts');
  const { ctx } = context((url) => {
    if (url === config.authUrl) return Response.json({ token: 'fresh-token' });
    return new Response('nope', { status: 500 });
  }, false);

  const request = new Request('capacitor://localhost/api/library/session', {
    method: 'POST',
    body: JSON.stringify({ email: 'a@b.test', password: 'pw' }),
  });
  const result = await signIn(request, ctx, 'capacitor://localhost');
  assert.notEqual(result.response.status, 200);
  assert.equal(result.session, undefined);
});

test('restoreSession builds reader URLs from the supplied reader origin', async () => {
  const { restoreSession } = load('lib/library/session.ts');
  const { ctx, calls } = context((url) => {
    if (url.includes('/my/entitlements')) return Response.json([]);
    return Response.json({
      publications: [{
        metadata: { title: 'Book', identifier: 'urn:book-1' },
        links: [{ rel: 'self', href: '/opds/publications/book-1', type: 'application/webpub+json' }],
      }],
    });
  });

  const result = await restoreSession(ctx, 'capacitor://localhost');
  const payload = await result.response.json();
  assert.equal(result.response.status, 200);
  assert.ok(calls.every(({ auth }) => auth === 'session'));
  assert.equal(payload.books.length, 1);
  for (const book of payload.books) {
    assert.ok(book.manifestUrl.startsWith('capacitor://localhost/api/library/pub/'));
  }
});

test('handlers report a missing session without contacting upstream', async () => {
  const { restoreSession } = load('lib/library/session.ts');
  const { getProgress } = load('lib/library/progress.ts');
  const { getPublicationResource } = load('lib/library/publication.ts');
  const { ctx, calls } = context(() => Response.json({}), false);

  for (const result of [
    await restoreSession(ctx, 'capacitor://localhost'),
    await getProgress(ctx, 'book-1'),
    await getPublicationResource(ctx, 'book-1', ['manifest.json']),
  ]) {
    assert.equal(result.response.status, 401);
  }
  assert.equal(calls.length, 0);
});

test('publication auth failures ask the transport to clear the session', async () => {
  const { getPublicationResource } = load('lib/library/publication.ts');
  const { ctx } = context(() => new Response('expired', { status: 401 }));

  const result = await getPublicationResource(ctx, 'book-1', ['OPS', 'chapter.xhtml'], '?a=1');
  assert.equal(result.response.status, 401);
  assert.deepEqual(plain(result.session), { clear: true });
});

test('publication resources forward the query string upstream', async () => {
  const { getPublicationResource } = load('lib/library/publication.ts');
  const { ctx, calls } = context(() => new Response('<html/>', {
    headers: { 'content-type': 'application/xhtml+xml' },
  }));

  const result = await getPublicationResource(ctx, 'book-1', ['OPS', 'ch 1.xhtml'], '?v=2');
  assert.equal(result.response.status, 200);
  assert.equal(calls[0].url, 'https://api.library.test/pub/book-1/OPS/ch%201.xhtml?v=2');
  assert.equal(calls[0].auth, 'session');
});

test('signOut always clears the session', () => {
  const { signOut } = load('lib/library/session.ts');
  assert.deepEqual(plain(signOut().session), { clear: true });
});
