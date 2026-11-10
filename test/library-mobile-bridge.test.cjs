const assert = require('node:assert/strict');
const test = require('node:test');
const { loadTsModule } = require('./helpers/load-ts.cjs');

const branding = require('../config/thorium-web/branding.local.json');

const ORIGIN = 'capacitor://localhost';
const config = {
  apiBaseUrl: 'https://api.library.test',
  authUrl: 'https://api.library.test/auth/login',
  catalogUrl: 'https://api.library.test/opds',
};

const loadBridge = () =>
  loadTsModule('lib/library/mobile.ts', {
    globals: { process: { env: {} } },
    stubs: {
      '@capacitor/core': {
        Capacitor: { isNativePlatform: () => false },
        registerPlugin: () => {
          throw new Error('not used in tests');
        },
      },
      '@/config/thorium-web/branding.local.json': {
        default: { ...branding, library: { ...branding.library, requireEntitlement: false } },
      },
    },
  });

function fakePlugin(respond, { session = true } = {}) {
  const state = { token: session ? 'stored' : null, requests: [] };
  return {
    state,
    getConfig: async () => config,
    hasSession: async () => ({ value: state.token !== null }),
    setToken: async ({ token }) => { state.token = token; },
    clearToken: async () => { state.token = null; },
    request: async (options) => {
      state.requests.push(options);
      const result = await respond(options);
      return { status: 200, headers: { 'content-type': 'application/json' }, ...result };
    },
  };
}

test('passes non-library and cross-origin requests to the original fetch', async () => {
  const { createMobileLibraryFetch } = loadBridge();
  const seen = [];
  const fallback = async (input) => {
    seen.push(String(input));
    return new Response('ok');
  };
  const plugin = fakePlugin(() => ({ body: '{}' }));
  const fetch = createMobileLibraryFetch(plugin, fallback, ORIGIN);

  await fetch('/locales/en/thorium-web.json');
  await fetch(`${ORIGIN}/api/library/pub/book-1/OPS/chapter.xhtml`);
  await fetch('https://elsewhere.test/api/library/session');
  assert.equal(seen.length, 3);
  assert.equal(plugin.state.requests.length, 0);
});

test('login stores the token natively and authenticates follow-up calls with it', async () => {
  const { createMobileLibraryFetch } = loadBridge();
  const plugin = fakePlugin(({ url }) => {
    if (url === config.authUrl) return { body: JSON.stringify({ token: 'fresh-token' }) };
    if (url.includes('/my/entitlements')) return { body: '[]' };
    return { body: JSON.stringify({ publications: [] }) };
  }, { session: false });
  const fetch = createMobileLibraryFetch(plugin, async () => assert.fail('fallback'), ORIGIN);

  const response = await fetch('/api/library/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.test', password: 'pw' }),
  });
  assert.equal(response.status, 200);
  assert.equal(plugin.state.token, 'fresh-token');
  assert.equal(plugin.state.requests[0].auth, 'none');
  assert.ok(plugin.state.requests.slice(1).every((r) => r.auth === 'bearer' && r.bearer === 'fresh-token'));
  assert.ok(plugin.state.requests.slice(1).every((r) => r.followRedirects === false));

  await fetch('/api/library/session', { method: 'DELETE' });
  assert.equal(plugin.state.token, null);
});

test('serves progress through the native session', async () => {
  const { createMobileLibraryFetch } = loadBridge();
  const plugin = fakePlugin(({ method }) => ({
    body: JSON.stringify(method === 'PUT' ? { ok: true } : { locator: { href: 'a' } }),
  }));
  const fetch = createMobileLibraryFetch(plugin, async () => assert.fail('fallback'), ORIGIN);

  const loaded = await (await fetch('/api/library/progress/book%201')).json();
  assert.deepEqual(JSON.parse(JSON.stringify(loaded)), { locator: { href: 'a' } });
  const saved = await fetch(new Request(`${ORIGIN}/api/library/progress/book%201`, {
    method: 'PUT',
    body: JSON.stringify({ locator: { href: 'b' } }),
  }));
  assert.equal(saved.status, 200);
  assert.equal(plugin.state.requests[0].url, 'https://api.library.test/my/publications/book%201/position');
  assert.equal(plugin.state.requests[1].body, JSON.stringify({ locator: { href: 'b' } }));
  assert.ok(plugin.state.requests.every((r) => r.auth === 'session'));
});

test('rewrites manifests and clears the native session on upstream auth failures', async () => {
  const { createMobileLibraryFetch } = loadBridge();
  let status = 200;
  const plugin = fakePlugin(() => ({
    status,
    body: JSON.stringify({
      metadata: { title: 'Book' },
      readingOrder: [{ href: 'OPS/chapter.xhtml', type: 'application/xhtml+xml' }],
    }),
  }));
  const fetch = createMobileLibraryFetch(plugin, async () => assert.fail('fallback'), ORIGIN);

  const manifest = await (await fetch(`${ORIGIN}/api/library/pub/book-1/manifest.json`)).json();
  assert.equal(manifest.readingOrder[0].href, 'OPS/chapter.xhtml');
  assert.equal(plugin.state.requests[0].url, 'https://api.library.test/pub/book-1/manifest.json');

  status = 401;
  const denied = await fetch(`${ORIGIN}/api/library/pub/book-1/manifest.json`);
  assert.equal(denied.status, 401);
  assert.equal(plugin.state.token, null);
});

test('maps native transport failures to the service-unreachable error', async () => {
  const { createMobileLibraryFetch } = loadBridge();
  const plugin = fakePlugin(() => { throw new Error('offline'); });
  const fetch = createMobileLibraryFetch(plugin, async () => assert.fail('fallback'), ORIGIN);

  const response = await fetch('/api/library/progress/book-1');
  assert.equal(response.status, 502);
});
