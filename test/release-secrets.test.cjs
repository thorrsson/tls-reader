const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const macNames = [
  'MACOS_CERTIFICATE_P12', 'MACOS_CERTIFICATE_PASSWORD', 'MACOS_SIGNING_IDENTITY',
  'NOTARY_API_KEY_ID', 'NOTARY_API_ISSUER_ID', 'NOTARY_API_KEY_P8',
];
const fixture = macNames.map(name => `${name}=synthetic-${name}`).join('\n');

const shellTest = { skip: process.platform === 'win32' ? 'dotenv uploader runs in macOS/Linux Bash' : false };

function run(contents, args = [], upload = false, env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-secrets-'));
  try {
    const file = path.join(root, '.env');
    const log = path.join(root, 'calls');
    fs.writeFileSync(file, contents);
    fs.writeFileSync(path.join(root, 'gh'), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_LOG"
if [[ "$1" == api ]]; then exit "\${TEST_API_STATUS:-0}"; fi
if [[ "$1" == secret ]]; then
  cat >> "$TEST_LOG"
  printf '\\n' >> "$TEST_LOG"
  exit "\${TEST_SECRET_STATUS:-0}"
fi
exit 1
`, { mode: 0o700 });
    const result = spawnSync('bash', [
      'scripts/setup-release-secrets.sh', '-f', file, '-R', 'thorrsson/tls-reader',
      ...(upload ? [] : ['--dry-run']), ...args,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`, TEST_LOG: log, ...env },
    });
    return { ...result, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('dotenv importer validates macOS secrets offline without printing values or uploading', shellTest, () => {
  const result = run(`${fixture}\nSPARKLE_PRIVATE_ED_KEY=do-not-upload\n`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls, '');
  for (const name of macNames) assert.ok(result.stdout.includes(`Would set secret ${name}`));
  assert.ok(result.stdout.includes('Ignoring unused setting SPARKLE_PRIVATE_ED_KEY'));
  assert.ok(result.stdout.includes('full release tags remain blocked'));
  assert.ok(!result.stdout.includes('synthetic-'));
  assert.ok(!result.stdout.includes('do-not-upload'));
});

test('dotenv importer rejects malformed, unknown, duplicate and incomplete settings before upload', shellTest, () => {
  for (const [contents, message] of [
    [`${fixture}\nUNKNOWN=secret`, /unrecognized/],
    [`${fixture}\nMACOS_CERTIFICATE_P12=again`, /duplicate/],
    ['MACOS_CERTIFICATE_P12=x', /must be set/],
    [`${fixture}\nWIN_CSC_LINK=x`, /supplied together/],
    [`${fixture}\nNOT_A_VALID_LINE`, /invalid assignment/],
    [fixture.replace('synthetic-MACOS_CERTIFICATE_P12', '"unclosed'), /unmatched quote/],
  ]) {
    const result = run(contents, [], true);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(result.calls, '');
  }
});

test('dotenv importer preserves literal quoted passwords and uploads only to release via stdin', shellTest, () => {
  const password = '$(do-not-execute) $literal `command` \\backslash # literal';
  const contents = fixture.replace(
    'MACOS_CERTIFICATE_PASSWORD=synthetic-MACOS_CERTIFICATE_PASSWORD',
    `export MACOS_CERTIFICATE_PASSWORD='${password}'`,
  ) + '\nWIN_CSC_LINK=synthetic-windows\nWIN_CSC_KEY_PASSWORD="synthetic-password"\nSPARKLE_PUBLIC_ED_KEY=unused';
  const result = run(contents, [], true);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.calls.startsWith('api --method GET repos/thorrsson/tls-reader/environments/release --silent\n'));
  assert.ok(result.calls.includes(`secret set MACOS_CERTIFICATE_PASSWORD --env release --repo thorrsson/tls-reader\n${password}\n`));
  assert.equal((result.calls.match(/secret set /g) || []).length, 8);
  assert.ok(!result.calls.includes('SPARKLE'));
  assert.ok(!result.stdout.includes(password));
});

test('dotenv importer fails explicitly on missing environment or partial upload', shellTest, () => {
  const missing = run(fixture, [], true, { TEST_API_STATUS: '1' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /cannot access.*release environment/);
  assert.ok(!missing.calls.includes('secret set'));
  const failed = run(fixture, [], true, { TEST_SECRET_STATUS: '1' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /failed to set secret MACOS_CERTIFICATE_P12; earlier uploads may have succeeded/);
  assert.equal((failed.calls.match(/secret set /g) || []).length, 1);
  assert.ok(!failed.stderr.includes('synthetic-'));
});

test('release workflow maps existing macOS secret names behind protected environment', () => {
  const workflow = fs.readFileSync('.github/workflows/desktop.yml', 'utf8');
  assert.equal((workflow.match(/environment: .*'release' \|\| 'ci'/g) || []).length, 2);
  for (const name of macNames) assert.ok(workflow.includes(`secrets.${name}`));
  for (const name of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) assert.ok(!workflow.includes(name));
  for (const value of ['APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'export APPLE_API_KEY=', 'umask 077', 'trap ', 'base64 --decode', '--config.forceCodeSigning=true']) {
    assert.ok(workflow.includes(value), value);
  }
  const template = fs.readFileSync('.env.release.example', 'utf8');
  for (const name of macNames) assert.ok(template.includes(`${name}=`));
});
