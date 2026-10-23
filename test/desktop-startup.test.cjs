const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

test('reader window opens before a slow optional updater check resolves', async () => {
  const calls = [];
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  app.whenReady = () => Promise.resolve();
  app.getPath = () => '/user-data';
  app.getVersion = () => '1.0.0';
  app.isPackaged = false;
  app.quit = () => calls.push('quit');
  class Window extends EventEmitter {
    constructor() { super(); calls.push('window'); }
    loadURL() { calls.push('load'); return Promise.resolve(); }
  }
  class Runtime {
    async start() { calls.push('runtime'); return 'http://127.0.0.1:1234'; }
  }
  let finishCheck;
  class Updater {
    start() {
      calls.push('updater');
      return new Promise(resolve => { finishCheck = resolve; });
    }
  }
  const modules = {
    'node:path': path,
    electron: {
      app, BrowserWindow: Window, nativeTheme: new EventEmitter(), dialog: {
        showErrorBox: () => assert.fail('startup must not fail'),
      },
      Menu: { setApplicationMenu() {}, buildFromTemplate() {} },
    },
    'electron-updater': {},
    './server-runtime.cjs': { ReaderServerRuntime: Runtime },
    './url-policy.cjs': {},
    './window-security.cjs': { secureWindow() {} },
    './updater.cjs': { UpdateController: Updater },
    './menus.cjs': { applicationMenuTemplate() {}, installEditingContextMenu() {} },
    './bridge.cjs': { initialState: {}, installDesktopBridge() {} },
  };
  vm.runInNewContext(fs.readFileSync('desktop/main.cjs', 'utf8'), {
    require: name => {
      assert.ok(Object.hasOwn(modules, name), name);
      return modules[name];
    },
    __dirname: path.resolve('desktop'), process, console,
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['runtime', 'window', 'load', 'updater']);
  finishCheck();
});

test('desktop build loads production dotenv configuration before spawning Next and staging runtime config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-env-build-'));
  try {
    fs.writeFileSync(path.join(root, '.env.local'), [
      'NEXT_PUBLIC_TLS_API_BASE_URL=https://dotenv.example',
      'NEXT_PUBLIC_TLS_CATALOG_URL=https://dotenv.example/books',
      'NEXT_PUBLIC_TLS_BASE_READER_URL=https://must-not-survive.example',
    ].join('\n'));
    const result = spawnSync(process.execPath, ['-e', `
      const fs = require('node:fs');
      const vm = require('node:vm');
      const { createRequire } = require('node:module');
      const fromRepo = createRequire(${JSON.stringify(path.resolve('package.json'))});
      let buildEnv;
      let staged;
      let written;
      const dependencies = {
        'node:child_process': { spawnSync: (binary, args, options) => { buildEnv = options.env; return { status: 0 }; } },
        'node:fs': { writeFileSync: (file, contents) => { written = JSON.parse(contents); } },
        './stage.cjs': { stage: () => { staged = true; } },
      };
      const localRequire = name => Object.hasOwn(dependencies, name) ? dependencies[name] :
        name === './build-config.cjs' ? fromRepo('./scripts/build-config.cjs') : fromRepo(name);
      localRequire.resolve = fromRepo.resolve;
      vm.runInNewContext(fs.readFileSync(${JSON.stringify(path.resolve('scripts/build-desktop.cjs'))}, 'utf8'), {
        require: localRequire, process,
      });
      console.log(JSON.stringify({ buildEnv, staged, written }));
    `], {
      cwd: root, encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        NEXT_PUBLIC_TLS_AUTH_URL: 'https://shell.example/login',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(output.staged, true);
    assert.equal(output.buildEnv.NEXT_PUBLIC_TLS_API_BASE_URL, 'https://dotenv.example');
    assert.equal(output.buildEnv.NEXT_PUBLIC_TLS_CATALOG_URL, 'https://dotenv.example/books');
    assert.equal(output.buildEnv.NEXT_PUBLIC_TLS_AUTH_URL, 'https://shell.example/login');
    assert.equal(output.buildEnv.NEXT_PUBLIC_TLS_BASE_READER_URL, '');
    for (const [name, value] of Object.entries(output.written.runtimeEnv)) {
      assert.equal(output.buildEnv[name], value, 'build-time and runtime backend must match');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
