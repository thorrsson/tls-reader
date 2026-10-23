const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const { initialState, validateState, commandEnabled, installDesktopBridge } = require('../desktop/bridge.cjs');

test('menu bridge accepts only complete bounded state and known commands', () => {
  assert.deepEqual(validateState(initialState), initialState);
  assert.equal(validateState({ ...initialState, token: 'forbidden' }), null);
  assert.equal(validateState({ ...initialState, reading: true }), null);
  assert.equal(validateState({ ...initialState, readerReady: true }), null);
  assert.equal(validateState({ ...initialState, catalogView: 'arbitrary' }), null);
  assert.equal(validateState({ ...initialState, busy: 'false' }), null);
  assert.equal(commandEnabled('eval', { ...initialState, busy: false }), false);
  assert.equal(commandEnabled('sign-in', { ...initialState, busy: false }), true);
  assert.equal(commandEnabled('sign-in', initialState), false);
});

test('sandboxed preload exposes only bounded methods in the main frame and strips IPC events', () => {
  const ipcRenderer = new EventEmitter();
  let sent;
  ipcRenderer.send = (...args) => { sent = args; };
  let api;
  const electron = {
    ipcRenderer,
    contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'tlsDesktop'); api = value; } },
  };
  const source = fs.readFileSync('desktop/preload.cjs', 'utf8');
  vm.runInNewContext(source, { require: () => electron, process: { isMainFrame: false } });
  assert.equal(api, undefined);
  vm.runInNewContext(source, { require: () => electron, process: { isMainFrame: true } });
  assert.deepEqual(Object.keys(api).sort(), ['onCommand', 'reportState']);
  assert.equal(Object.isFrozen(api), true);
  let received;
  const dispose = api.onCommand((...args) => { received = args; });
  ipcRenderer.emit('tls-reader:command', { sender: 'privileged' }, 'eval');
  assert.equal(received, undefined);
  ipcRenderer.emit('tls-reader:command', { sender: 'privileged' }, 'show-library');
  assert.deepEqual(received, ['show-library']);
  api.reportState({ ...initialState, token: 'never forward' });
  assert.equal(sent[0], 'tls-reader:state');
  assert.deepEqual(Object.keys(sent[1]).sort(), Object.keys(initialState).sort());
  dispose();
  assert.equal(ipcRenderer.listenerCount('tls-reader:command'), 0);
});

test('bridge ignores foreign windows, subframes and navigation destinations and cleans listeners', () => {
  const ipcMain = new EventEmitter();
  const window = new EventEmitter();
  const webContents = new EventEmitter();
  const url = 'http://127.0.0.1:1234';
  webContents.mainFrame = { url };
  webContents.getURL = () => url;
  let sent;
  webContents.send = (...args) => { sent = args; };
  window.webContents = webContents;
  window.isDestroyed = () => false;
  let latest;
  const bridge = installDesktopBridge({ ipcMain, window, serverUrl: url, onState: state => { latest = state; } });
  const state = { ...initialState, authenticated: true, busy: false };
  ipcMain.emit('tls-reader:state', { sender: {}, senderFrame: webContents.mainFrame }, state);
  ipcMain.emit('tls-reader:state', { sender: webContents, senderFrame: { url } }, state);
  assert.equal(latest, undefined);
  webContents.mainFrame.url = 'https://untrusted.example';
  ipcMain.emit('tls-reader:state', { sender: webContents, senderFrame: webContents.mainFrame }, state);
  assert.equal(latest, undefined);
  webContents.mainFrame.url = url;
  ipcMain.emit('tls-reader:state', { sender: webContents, senderFrame: webContents.mainFrame }, state);
  assert.deepEqual(latest, state);
  bridge.send('show-library');
  assert.deepEqual(sent, ['tls-reader:command', 'show-library']);
  sent = undefined;
  bridge.send('reading-settings');
  assert.equal(sent, undefined);
  webContents.emit('did-start-navigation', {}, url, false, true);
  assert.deepEqual(latest, initialState);
  bridge.send('show-library');
  assert.equal(sent, undefined);
  window.emit('closed');
  assert.equal(ipcMain.listenerCount('tls-reader:state'), 0);
});
