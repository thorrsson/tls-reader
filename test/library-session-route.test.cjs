const assert = require('node:assert/strict');
const test = require('node:test');
const { loadTsModule } = require('./helpers/load-ts.cjs');
const { NextResponse } = require('next/server');

const branding = require('../config/thorium-web/branding.local.json');

function loadSessionRoute({ fetchImpl, requireEntitlement = true } = {}) {
  const config = {
    ...branding,
    library: { ...branding.library, requireEntitlement },
  };
  return loadTsModule('app/api/library/session/route.ts', {
    globals: {
      process: { env: {} },
      fetch: (...args) => fetchImpl(...args),
    },
    stubs: {
      'next/server': { NextResponse },
      '@/config/thorium-web/branding.local.json': { default: config },
      '@/lib/branding': {
        integrationConfig: {
          tlsApiBaseUrl: 'https://api.library.test',
          authUrl: 'https://api.library.test/auth/login',
          catalogUrl: 'https://catalog.library.test/opds',
        },
      },
    },
  });
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
