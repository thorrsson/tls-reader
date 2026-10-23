const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

const branding = require('../config/thorium-web/branding.local.json');

function loadSessionRoute({ fetchImpl, requireEntitlement = true } = {}) {
  const filename = path.join(__dirname, '../app/api/library/session/route.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const config = {
    ...branding,
    library: { ...branding.library, requireEntitlement },
  };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    URL,
    Response,
    Headers,
    process: {
      env: {
        NEXT_PUBLIC_TLS_API_BASE_URL: 'https://api.library.test',
        NEXT_PUBLIC_TLS_CATALOG_URL: 'https://catalog.library.test/opds',
      },
    },
    fetch: (...args) => fetchImpl(...args),
    require: (name) => {
      if (name === 'next/server') return { NextResponse };
      if (name === '@/config/thorium-web/branding.local.json') return { default: config };
      if (name === '@/lib/branding') {
        return {
          integrationConfig: {
            tlsApiBaseUrl: 'https://api.library.test',
            authUrl: 'https://api.library.test/auth/login',
            catalogUrl: 'https://catalog.library.test/opds',
          },
        };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  return module.exports;
}

function sessionRequest() {
  return {
    cookies: { get: () => ({ value: 'session-token' }) },
    headers: new Headers(),
    nextUrl: { protocol: 'https:', searchParams: new URLSearchParams() },
  };
}

test('rejects external and downgraded publication-feed URLs before sending credentials', async () => {
  for (const feedHref of [
    'https://attacker.test/opds/publications',
    'http://api.library.test/opds/publications',
  ]) {
    const calls = [];
    const route = loadSessionRoute({
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), options });
        if (String(url).includes('/my/entitlements')) {
          return Response.json([]);
        }
        return Response.json({ navigation: [{ href: feedHref }] });
      },
    });

    const response = await route.GET(sessionRequest());
    assert.equal(response.status, 200);
    assert.equal(calls.some(({ url }) => url === feedHref), false);
    assert.ok(calls.every(({ options }) => options.redirect === 'manual'));
    assert.ok(calls.every(({ options }) => options.headers.Authorization === 'Bearer session-token'));
  }
});

test('allows a configured API-origin feed without following authenticated redirects', async () => {
  const calls = [];
  const route = loadSessionRoute({
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/my/entitlements')) return Response.json([]);
      if (String(url).startsWith('https://catalog.library.test/')) {
        return Response.json({
          navigation: [{ href: 'https://api.library.test/opds/publications' }],
        });
      }
      return Response.json({ publications: [] });
    },
  });

  const response = await route.GET(sessionRequest());
  assert.equal(response.status, 200);
  const feedCall = calls.find(({ url }) => url === 'https://api.library.test/opds/publications');
  assert.ok(feedCall);
  assert.equal(feedCall.options.headers.Authorization, 'Bearer session-token');
  assert.equal(feedCall.options.redirect, 'manual');
});

test('filters the full catalog before capping entitled results', async () => {
  const publications = Array.from({ length: 205 }, (_, index) => ({
    metadata: { identifier: `book-${index}` },
  }));
  const calls = [];
  const route = loadSessionRoute({
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('/my/entitlements')) {
        return Response.json(Array.from({ length: 5 }, (_, index) => ({
          identifier: `book-${index + 200}`,
        })));
      }
      return Response.json({ publications });
    },
  });

  const response = await route.GET(sessionRequest());
  const { books } = await response.json();
  assert.deepEqual(books.map((book) => book.identifier), [
    'book-200', 'book-201', 'book-202', 'book-203', 'book-204',
  ]);
  assert.equal(calls.length, 2);
});

test('caps the catalog when entitlement filtering is disabled', async () => {
  const publications = Array.from({ length: 205 }, (_, index) => ({
    metadata: { identifier: `book-${index}` },
  }));
  const route = loadSessionRoute({
    requireEntitlement: false,
    fetchImpl: async (url) => String(url).includes('/my/entitlements')
      ? Response.json([])
      : Response.json({ publications }),
  });

  const response = await route.GET(sessionRequest());
  const { books } = await response.json();
  assert.equal(books.length, branding.library.maxItems);
  assert.equal(books[199].identifier, 'book-199');
});
