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

test('mobile versions strip prerelease metadata for the App Store and keep it for Android', () => {
  const { mobileVersion, MAX_BUILD_NUMBER } = require('../scripts/mobile-version.cjs');
  assert.deepEqual(mobileVersion('v1.2.3-beta.1+sha.5', '42'), {
    marketingVersion: '1.2.3', versionName: '1.2.3-beta.1+sha.5', buildNumber: 42,
  });
  assert.equal(mobileVersion('v8.7.6', String(MAX_BUILD_NUMBER)).buildNumber, MAX_BUILD_NUMBER);
  for (const build of [undefined, '', '0', '-1', '1.5', '01', String(MAX_BUILD_NUMBER + 1)]) {
    assert.throws(() => mobileVersion('v1.2.3', build), /build number/);
  }
  assert.throws(() => mobileVersion('1.2.3', '1'), /valid semantic version/);
});

test('mobile version command exports store versions to the GitHub environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-mobile-version-'));
  try {
    const githubEnv = path.join(root, 'env');
    const result = spawnSync(process.execPath, ['scripts/mobile-version.cjs'], {
      encoding: 'utf8', env: { ...process.env, RELEASE_TAG: 'v2.0.0-rc.1', BUILD_NUMBER: '17', GITHUB_ENV: githubEnv },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(githubEnv, 'utf8'),
      'TLS_MARKETING_VERSION=2.0.0\nTLS_VERSION_NAME=2.0.0-rc.1\nTLS_BUILD_NUMBER=17\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
