const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { UpdateController } = require('../desktop/updater.cjs');

class FakeUpdater extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.checkError = null;
    this.setFeedURL = (config) => this.calls.push(['feed', config]);
    this.checkForUpdates = async () => {
      this.calls.push(['check']);
      if (this.checkError) throw this.checkError;
      return {};
    };
    this.quitAndInstall = (...args) => this.calls.push(['install', ...args]);
  }
}

function createController(overrides = {}) {
  const updater = new FakeUpdater();
  const timers = [];
  const notices = [];
  const logs = [];
  const controller = new UpdateController({
    updater,
    app: { isPackaged: true },
    platform: 'darwin',
    env: {},
    dialog: { showMessageBox: async (...args) => {
      notices.push(args.at(-1));
      return { response: 1 };
    } },
    log: (...args) => logs.push(args),
    setInterval: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearInterval: () => {},
    intervalMs: 60_000,
    ...overrides,
  });
  return { controller, updater, timers, notices, logs };
}

test('configures the public GitHub feed and checks immediately and periodically', async () => {
  const { controller, updater, timers } = createController();
  await controller.start();

  assert.deepEqual(updater.calls[0], ['feed', {
    provider: 'github',
    owner: 'thorrsson',
    repo: 'tls-reader',
    private: false,
  }]);
  assert.equal(updater.calls.filter(([type]) => type === 'check').length, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 60_000);
  await timers[0].callback();
  assert.equal(updater.calls.filter(([type]) => type === 'check').length, 2);
  controller.stop();
});

test('enables updates only for packaged macOS/Windows and Linux AppImage builds', async () => {
  for (const details of [
    { packaged: false, platform: 'darwin', env: {} },
    { packaged: true, platform: 'linux', env: {} },
  ]) {
    const { controller, updater } = createController({
      app: { isPackaged: details.packaged },
      platform: details.platform,
      env: details.env,
    });
    await controller.start();
    assert.equal(updater.calls.length, 0);
  }
  const { controller, updater } = createController({
    platform: 'linux',
    env: { APPIMAGE: '/opt/TLSReader.AppImage' },
  });
  await controller.start();
  assert.ok(updater.calls.some(([type]) => type === 'check'));
});

test('manual checks recover after errors and update state from updater events', async () => {
  const { controller, updater, logs } = createController();
  updater.checkError = new Error('offline');
  await controller.start();
  assert.equal(controller.state.status, 'error');
  assert.ok(logs.length > 0);

  updater.checkError = null;
  await controller.checkNow();
  assert.equal(controller.state.status, 'checking');
  updater.emit('update-not-available');
  assert.equal(controller.state.status, 'not-available');
  updater.emit('update-available', { version: '4.0.0' });
  assert.equal(controller.state.status, 'available');
  updater.emit('download-progress', { percent: 47 });
  assert.equal(controller.state.progress, 47);
  updater.emit('update-downloaded', { version: '4.0.0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.state.status, 'downloaded');
});

test('prompts after download and installs only after explicit selection', async () => {
  const { controller, updater, notices } = createController();
  await controller.start();
  updater.emit('update-downloaded', { version: '4.0.0' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(notices.length, 1);
  assert.deepEqual(notices[0].buttons, ['Restart now', 'Later']);
  await controller.installNow();
  assert.deepEqual(updater.calls.at(-1), ['install', false, true]);
});

test('manual install does nothing before an update is downloaded', async () => {
  const { controller, updater } = createController();
  await controller.installNow();
  assert.equal(updater.calls.some(([type]) => type === 'install'), false);
});
