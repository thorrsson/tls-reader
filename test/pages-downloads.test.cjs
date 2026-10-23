const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('docs/assets/downloads.js', 'utf8');
const releasePage = 'https://github.com/thorrsson/tls-reader/releases/latest';
const base = 'https://github.com/thorrsson/tls-reader/releases/download/v1.2.3/';
const names = [
  'TLS-Reader-1.2.3-mac-universal.zip',
  'TLS-Reader-1.2.3-mac-universal.dmg.blockmap',
  'TLS-Reader-1.2.3-mac-universal.dmg',
  'TLS-Reader-1.2.3-win-x64.exe',
  'TLS-Reader-1.2.3-linux-x64.AppImage',
];
const assets = names.map(name => ({ name, browser_download_url: base + name }));

async function run(navigator, options = {}) {
  const links = (options.keys || ['auto', 'auto']).map(key => ({
    dataset: { download: key }, href: releasePage, textContent: 'Downloads',
  }));
  const status = { hidden: true, textContent: '' };
  const errors = [];
  let requests = 0;
  await vm.runInNewContext(script, {
    navigator, URL, AbortController, setTimeout, clearTimeout,
    document: {
      querySelectorAll: () => links,
      querySelector: () => status,
    },
    console: { error: (...args) => errors.push(args) },
    fetch: async (url, init) => {
      requests++;
      assert.equal(url, 'https://api.github.com/repos/thorrsson/tls-reader/releases/latest');
      assert.ok(init.signal instanceof AbortSignal);
      if (options.error) throw options.error;
      return {
        ok: !options.httpStatus, status: options.httpStatus || 200,
        json: async () => options.release || { assets },
      };
    },
  });
  return { links, status, requests, errors };
}

test('desktop download buttons resolve the latest installer, not ZIPs or blockmaps', async () => {
  for (const [platform, suffix, label] of [
    ['MacIntel', 'mac-universal.dmg', 'macOS'],
    ['Win32', 'win-x64.exe', 'Windows (x64)'],
    ['Linux x86_64', 'linux-x64.AppImage', 'Linux (x64)'],
  ]) {
    const result = await run({ platform });
    assert.equal(result.requests, 1);
    assert.equal(result.status.hidden, true);
    for (const link of result.links) {
      assert.equal(link.href, `${base}TLS-Reader-1.2.3-${suffix}`);
      assert.equal(link.textContent, `Download for ${label}`);
    }
  }
});

test('uses user agent client hints when available', async () => {
  const result = await run({ platform: '', userAgentData: { platform: 'Windows' } });
  assert.equal(result.links[0].href, `${base}TLS-Reader-1.2.3-win-x64.exe`);
});

test('mobile and unknown systems retain the release-page fallback', async () => {
  for (const navigator of [
    { platform: 'Linux armv8l', userAgent: 'Mozilla Android' },
    { platform: 'iPhone', userAgent: 'iPhone' },
    { platform: 'MacIntel', userAgent: 'Macintosh', maxTouchPoints: 5 },
    { platform: 'FreeBSD' },
    {},
  ]) {
    const result = await run(navigator);
    assert.equal(result.requests, 0);
    assert.equal(result.status.hidden, false);
    assert.equal(result.links[0].href, releasePage);
  }
});

test('explicit platform choices work even on mobile and preserve their labels', async () => {
  const result = await run({ userAgent: 'Android', platform: 'Linux' }, {
    keys: ['auto', 'mac', 'windows', 'linux'],
  });
  assert.equal(result.requests, 1);
  assert.equal(result.links[0].href, releasePage);
  for (let index = 1; index < result.links.length; index++) {
    assert.equal(result.links[index].href, assets[index + 1].browser_download_url);
    assert.equal(result.links[index].textContent, 'Downloads');
  }
});

test('API failures are visible and leave working fallback links', async () => {
  for (const options of [
    { httpStatus: 403 },
    { httpStatus: 404 },
    { error: new Error('Network unavailable') },
    { error: new DOMException('Timed out', 'AbortError') },
    { release: {} },
    { release: { assets: [{ name: names[2], browser_download_url: 'https://example.com/installer.dmg' }] } },
  ]) {
    const result = await run({ platform: 'MacIntel' }, options);
    assert.equal(result.links[0].href, releasePage);
    assert.equal(result.status.hidden, false);
    assert.match(result.status.textContent, /temporarily unavailable/);
    assert.equal(result.errors.length, 1);
  }
});

test('missing assets do not prevent available platforms from resolving', async () => {
  const result = await run({ platform: 'MacIntel' }, {
    keys: ['auto', 'windows'], release: { assets: [assets[3]] },
  });
  assert.equal(result.links[0].href, releasePage);
  assert.equal(result.links[1].href, assets[3].browser_download_url);
  assert.equal(result.status.hidden, false);
  assert.match(result.status.textContent, /not available/);
});

test('Pages loads the script with a baseurl-aware path and retains no-JS fallbacks', () => {
  const layout = fs.readFileSync('docs/_layouts/default.html', 'utf8');
  assert.ok(layout.includes(`src="{{ '/assets/downloads.js' | relative_url }}" defer`));
  assert.match(layout, /data-download-status role="status" hidden/);
  for (const file of ['docs/_layouts/default.html', 'docs/index.md', 'docs/getting-started.md']) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.includes(`href="${releasePage}" data-download="auto"`));
  }
  assert.match(fs.readFileSync('docs/index.md', 'utf8'), /All downloads and release notes/);
});
