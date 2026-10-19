const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildConfig } = require('../scripts/build-config.cjs');
const { stage, allowed, verifyLinks } = require('../scripts/stage.cjs');

test('desktop reader origin is always request-local', () => {
  assert.equal(buildConfig({ NEXT_PUBLIC_TLS_BASE_READER_URL: 'https://wrong.example' }).NEXT_PUBLIC_TLS_BASE_READER_URL, '');
});
test('release backend must explicitly specify public HTTPS endpoints', () => {
  assert.throws(() => buildConfig({ GITHUB_REF_TYPE: 'tag' }), /HTTPS/);
  assert.throws(() => buildConfig({ NEXT_PUBLIC_TLS_API_BASE_URL: 'https://user:secret@example.com' }), /credentials/);
  assert.throws(() => buildConfig({ NEXT_PUBLIC_TLS_AUTH_URL: 'file:///etc/passwd' }), /HTTP/);
  assert.equal(buildConfig({
    GITHUB_REF_TYPE: 'tag',
    NEXT_PUBLIC_TLS_API_BASE_URL: 'https://api.example.com',
    NEXT_PUBLIC_TLS_AUTH_URL: 'https://api.example.com/auth/login',
    NEXT_PUBLIC_TLS_CATALOG_URL: 'https://api.example.com/opds/publications',
  }).NEXT_PUBLIC_TLS_BASE_READER_URL, '');
});
test('staging excludes environment files, cache and VCS data', () => {
  for (const file of ['.env', '.env.local', '.git/config', '.next/cache/test', '.next\\cache\\test']) assert.equal(allowed(file), false);
  assert.equal(allowed('.next/static/test.js'), true);
});
test('staging rejects links to original checkout', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-stage-'));
  try {
    fs.writeFileSync(path.join(root, 'target'), 'ok');
    fs.symlinkSync(path.join(root, 'target'), path.join(root, 'link'));
    assert.throws(() => verifyLinks(root), /Non-portable/);
    fs.unlinkSync(path.join(root, 'link'));
    fs.symlinkSync('target', path.join(root, 'link'));
    verifyLinks(root);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('staging repairs incomplete traced pnpm links and includes reader assets without secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-stage-fixture-'));
  try {
    for (const directory of [
      '.next/standalone/node_modules/.pnpm/node_modules', '.next/static', 'public',
      'node_modules/.pnpm/semver/node_modules/semver',
      'node_modules/@edrlab/thorium-web/dist/fonts',
      'node_modules/@edrlab/thorium-web/dist/locales',
    ]) fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules/.pnpm/node_modules'), { recursive: true });
    fs.symlinkSync('../semver/node_modules/semver', path.join(root, 'node_modules/.pnpm/node_modules/semver'), 'dir');
    fs.symlinkSync('../semver/node_modules/semver', path.join(root, '.next/standalone/node_modules/.pnpm/node_modules/semver'), 'dir');
    fs.symlinkSync(path.join(root, 'node_modules/.pnpm/semver/node_modules/semver'), path.join(root, '.next/standalone/node_modules/absolute-semver'), 'dir');
    fs.symlinkSync(path.join(root, 'node_modules/.pnpm/semver/node_modules/semver'), path.join(root, 'node_modules/absolute-semver'), 'dir');
    for (const [file, content] of Object.entries({
      '.next/standalone/server.js': 'server',
      '.next/standalone/.env.production': 'must not ship',
      'node_modules/.pnpm/semver/node_modules/semver/index.js': 'module.exports = true',
      'node_modules/@edrlab/thorium-web/dist/fonts/example.woff': 'font',
      'node_modules/@edrlab/thorium-web/dist/locales/en.json': '{}',
      '.next/static/example.js': 'js',
      'public/logo.svg': 'logo',
    })) fs.writeFileSync(path.join(root, file), content);
    const output = stage(root, true);
    assert.equal(fs.readFileSync(path.join(output, 'node_modules/.pnpm/node_modules/semver/index.js'), 'utf8'), 'module.exports = true');
    assert.equal(fs.existsSync(path.join(output, '.env.production')), false);
    assert.equal(fs.lstatSync(path.join(output, 'node_modules/absolute-semver')).isSymbolicLink(), false);
    assert.ok(fs.existsSync(path.join(output, 'node_modules/semver/index.js')));
    for (const file of ['server.js', '.next/static/example.js', 'public/logo.svg', 'node_modules/@edrlab/thorium-web/dist/fonts/example.woff', 'node_modules/@edrlab/thorium-web/dist/locales/en.json']) {
      assert.ok(fs.existsSync(path.join(output, file)), file);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('package targets and public updater feed stay explicit', () => {
  const config = fs.readFileSync('electron-builder.yml', 'utf8');
  for (const value of ['repo: tls-reader', 'owner: thorrsson', 'target: nsis', 'target: dmg', 'target: zip', 'target: AppImage', 'arch: universal']) assert.ok(config.includes(value));
  assert.ok(!config.includes('GH_TOKEN'));
  assert.ok(config.includes('from: resources/reader/node_modules'));
  assert.equal(require('../package.json').version, require('../desktop/package.json').version);
});
test('release publishing depends on every native build and includes updater metadata', () => {
  const workflow = fs.readFileSync('.github/workflows/desktop.yml', 'utf8');
  for (const value of ['macos-latest', 'windows-latest', 'ubuntu-latest', 'dist/latest*.yml', 'dist/*.blockmap', '--draft', '--draft=false', 'needs:']) assert.ok(workflow.includes(value), value);
  assert.ok(workflow.indexOf('gh release upload') < workflow.indexOf('gh release edit'));
});
