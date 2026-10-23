const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const { NextResponse } = require('next/server');

function loadPublicationRoute(fetchImpl) {
  const filename = path.join(
    __dirname,
    '../app/api/library/pub/[publicationId]/[...resourcePath]/route.ts',
  );
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    URL,
    Response,
    Headers,
    process: { env: { NEXT_PUBLIC_TLS_API_BASE_URL: 'https://api.library.test' } },
    fetch: (...args) => fetchImpl(...args),
    require: (name) => {
      if (name === 'next/server') return { NextResponse };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  }, { filename });
  return module.exports;
}

function publicationRequest(resourcePath) {
  return {
    cookies: { get: () => ({ value: 'session-token' }) },
    headers: new Headers(),
    nextUrl: { protocol: 'https:', searchParams: new URLSearchParams() },
  };
}

const publicationParams = (resourcePath) => ({
  params: Promise.resolve({ publicationId: 'book-1', resourcePath }),
});

test('preserves TOC entry fields and recursively normalizes child hrefs', async () => {
  const manifest = {
    metadata: { title: 'Nested contents' },
    readingOrder: [{ href: 'OPS/chapter.xhtml', type: 'application/xhtml+xml' }],
    toc: [{
      title: 'Part one',
      href: 'https://api.library.test/pub/book-1/OPS/part.xhtml',
      children: [{
        title: 'Chapter one',
        href: '/api/library/pub/book-1/OPS/chapter.xhtml#start',
        type: 'application/xhtml+xml',
        custom: { label: 'preserved' },
      }],
      type: 'application/json',
      properties: { expanded: true },
    }],
  };
  const calls = [];
  const route = loadPublicationRoute(async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(manifest, {
      headers: { 'content-type': 'application/webpub+json' },
    });
  });

  const response = await route.GET(
    publicationRequest(['manifest.json']),
    publicationParams(['manifest.json']),
  );
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.toc[0].type, 'application/json');
  assert.deepEqual(result.toc[0].properties, { expanded: true });
  assert.equal(result.toc[0].href, 'OPS/part.xhtml');
  assert.equal(result.toc[0].children[0].href, 'OPS/chapter.xhtml#start');
  assert.equal(result.toc[0].children[0].type, 'application/xhtml+xml');
  assert.deepEqual(result.toc[0].children[0].custom, { label: 'preserved' });
  assert.equal(calls[0].options.redirect, 'manual');
});

test('proxies an upstream position-list path instead of synthesizing over it', async () => {
  const upstreamList = {
    total: 1,
    positions: [{ href: 'OPS/chapter.xhtml', locations: { position: 7 } }],
  };
  const manifest = {
    metadata: { title: 'Position list' },
    readingOrder: [{ href: 'OPS/chapter.xhtml' }],
    links: [{
      href: 'OPS/positions.json',
      type: 'application/vnd.readium.position-list+json',
    }],
  };
  const calls = [];
  const route = loadPublicationRoute(async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/manifest.json')) {
      return Response.json(manifest, {
        headers: { 'content-type': 'application/webpub+json' },
      });
    }
    return Response.json(upstreamList, {
      headers: { 'content-type': 'application/vnd.readium.position-list+json' },
    });
  });

  const manifestResponse = await route.GET(
    publicationRequest(['manifest.json']),
    publicationParams(['manifest.json']),
  );
  const rewritten = await manifestResponse.json();
  assert.equal(rewritten.links.some((link) => link.href === 'positions-fallback.json'), false);
  assert.equal(rewritten.links.find((link) => link.type === 'application/vnd.readium.position-list+json').href,
    'OPS/positions.json');

  const positionResponse = await route.GET(
    publicationRequest(['OPS', 'positions.json']),
    publicationParams(['OPS', 'positions.json']),
  );
  assert.deepEqual(await positionResponse.json(), upstreamList);
  assert.equal(calls.at(-1).url, 'https://api.library.test/pub/book-1/OPS/positions.json');
  const fallbackResponse = await route.GET(
    publicationRequest(['positions-fallback.json']),
    publicationParams(['positions-fallback.json']),
  );
  assert.equal(fallbackResponse.status, 404);
  assert.ok(calls.every(({ options }) => options.redirect === 'manual'));
});

test('adds and serves a distinct synthesized position-list fallback only when upstream omits it', async () => {
  const manifest = {
    metadata: { title: 'Fallback positions' },
    readingOrder: [
      { href: 'OPS/one.xhtml', type: 'application/xhtml+xml' },
      { href: 'OPS/two.xhtml', type: 'application/xhtml+xml' },
    ],
  };
  const calls = [];
  const route = loadPublicationRoute(async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json(manifest, {
      headers: { 'content-type': 'application/webpub+json' },
    });
  });

  const manifestResponse = await route.GET(
    publicationRequest(['manifest.json']),
    publicationParams(['manifest.json']),
  );
  const rewritten = await manifestResponse.json();
  const fallback = rewritten.links.find(
    (link) => link.type === 'application/vnd.readium.position-list+json',
  );
  assert.equal(fallback.href, 'positions-fallback.json');

  const positionResponse = await route.GET(
    publicationRequest(['positions-fallback.json']),
    publicationParams(['positions-fallback.json']),
  );
  const positionList = await positionResponse.json();
  assert.equal(positionList.total, 2);
  assert.deepEqual(positionList.positions.map((position) => position.href), [
    'OPS/one.xhtml', 'OPS/two.xhtml',
  ]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.redirect === 'manual'));
});
