const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { releaseVersion } = require('../scripts/release-version.cjs');

test('release version comes from the tag, not the checked-in package version', () => {
  for (const version of ['0.0.0', '1.2.3', '12.34.56', '1.2.3-beta.1', '1.2.3+build.42']) {
    assert.equal(releaseVersion(`v${version}`), version);
  }
  for (const tag of [undefined, '', '1.2.3', 'v1.2', 'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2.3-01', 'v1.2.3-', 'v1.2.3 ', 'v1.2.3\n']) {
    assert.throws(() => releaseVersion(tag), /valid semantic version/);
  }
});

test('release command embeds the tag version in both manifests and rejects invalid tags without changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-release-version-'));
  try {
    fs.mkdirSync(path.join(root, 'desktop'));
    const manifests = ['package.json', 'desktop/package.json'];
    for (const file of manifests) {
      fs.copyFileSync(file, path.join(root, file));
    }
    const run = tag => spawnSync(process.execPath, [path.resolve('scripts/release-version.cjs')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, RELEASE_TAG: tag },
    });
    const originals = manifests.map(file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
    const result = run('v8.7.6');
    assert.equal(result.status, 0, result.stderr);
    manifests.forEach((file, index) => {
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')), { ...originals[index], version: '8.7.6' });
    });
    const stamped = manifests.map(file => fs.readFileSync(path.join(root, file), 'utf8'));
    const invalid = run('vnot-a-version');
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /valid semantic version/);
    assert.deepEqual(manifests.map(file => fs.readFileSync(path.join(root, file), 'utf8')), stamped);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every release build stamps manifests before dependency installation and packaging', () => {
  const workflow = fs.readFileSync('.github/workflows/desktop.yml', 'utf8').replace(/\r\n/g, '\n');
  const build = workflow.split('\n  build:\n')[1].split('\n  publish:\n')[0];
  const step = build.split('      - name: Embed release version from tag\n')[1].split('\n      - name:')[0];
  assert.match(step, /if: startsWith\(github.ref, 'refs\/tags\/v'\)/);
  assert.ok(step.includes('RELEASE_TAG: ${{ github.ref_name }}'));
  assert.ok(step.includes('run: node scripts/release-version.cjs'));
  assert.ok(build.indexOf('Embed release version from tag') < build.indexOf('pnpm install --frozen-lockfile'));
  assert.ok(build.indexOf('Embed release version from tag') < build.indexOf('pnpm desktop:build'));
  assert.ok(build.indexOf('Embed release version from tag') < build.indexOf('pnpm exec electron-builder'));
});
