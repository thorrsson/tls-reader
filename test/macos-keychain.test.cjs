const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');

test('patched electron-builder uses keychain password for access control and certificate passwords for import', async () => {
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const filename = builderRequire.resolve('app-builder-lib/out/codeSign/macCodeSign.js');
  const dependencyRequire = createRequire(filename);
  const calls = [];
  const exports = {};
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports,
    __dirname: path.dirname(filename),
    process,
    require(name) {
      if (name === 'builder-util') {
        return {
          async exec(command, args) {
            assert.equal(command, '/usr/bin/security');
            calls.push(Array.from(args));
            return '';
          },
        };
      }
      if (name === 'lazy-val') {
        // Skip the bundled root-certificate copy; no real keychain is touched.
        return { Lazy: class { value = Promise.resolve(); } };
      }
      if (name === './codesign') {
        return { importCertificate: async link => link };
      }
      return dependencyRequire(name);
    },
  }, { filename });

  await exports.createKeychain({
    tmpDir: {},
    currentDir: '/synthetic/project',
    cscLink: '/synthetic/application.p12',
    cscKeyPassword: 'application-export-password',
    cscILink: '/synthetic/installer.p12',
    cscIKeyPassword: 'installer-export-password',
  });

  const flag = (args, name) => args[args.indexOf(name) + 1];
  const keychainPassword = flag(calls.find(args => args[0] === 'create-keychain'), '-p');
  assert.ok(keychainPassword);
  assert.equal(flag(calls.find(args => args[0] === 'unlock-keychain'), '-p'), keychainPassword);
  const imports = calls.filter(args => args[0] === 'import');
  assert.deepEqual(imports.map(args => flag(args, '-P')), [
    'application-export-password', 'installer-export-password',
  ]);
  const partitions = calls.filter(args => args[0] === 'set-key-partition-list');
  assert.equal(partitions.length, 2);
  for (const args of partitions) {
    assert.equal(flag(args, '-k'), keychainPassword);
    assert.ok(!imports.some(entry => flag(entry, '-P') === keychainPassword));
  }
});
