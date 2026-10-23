const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { applicationMenuTemplate, editingContextTemplate, installEditingContextMenu } = require('../desktop/menus.cjs');

test('application menu restores native edit commands without dropping update actions', () => {
  let checked = 0;
  let installed = 0;
  const template = applicationMenuTemplate({
    checkForUpdates: () => checked++,
    installUpdate: () => installed++,
  });
  assert.ok(template.some(item => item.role === 'editMenu'));
  template[0].submenu.find(item => item.label === 'Check for Updates…').click();
  template[0].submenu.find(item => item.label === 'Install Downloaded Update').click();
  assert.equal(checked, 1);
  assert.equal(installed, 1);
});

test('native menus gate account, library and reading actions by reader state', () => {
  const menus = state => applicationMenuTemplate({ state }).flatMap(menu => menu.submenu || []);
  const signedOut = menus({ authenticated: false, busy: false, reading: false, readerReady: false, catalogView: 'grid' });
  assert.equal(signedOut.find(item => item.id === 'sign-in').enabled, true);
  assert.equal(signedOut.find(item => item.id === 'sign-out').enabled, false);
  const library = menus({ authenticated: true, busy: false, reading: false, readerReady: false, catalogView: 'list' });
  assert.equal(library.find(item => item.id === 'view-list').checked, true);
  assert.equal(library.find(item => item.id === 'refresh-library').enabled, true);
  assert.equal(library.find(item => item.id === 'reading-settings').enabled, false);
  const reading = menus({ authenticated: true, busy: false, reading: true, readerReady: true, catalogView: 'grid' });
  for (const name of ['reading-settings', 'table-of-contents', 'show-library']) {
    assert.equal(reading.find(item => item.id === name).enabled, true);
  }
  assert.equal(reading.find(item => item.id === 'bookmarks').enabled, false);
  assert.equal(reading.find(item => item.id === 'refresh-library').enabled, false);
});

test('editable field context menu uses native roles and respects Chromium edit capabilities', () => {
  const template = editingContextTemplate({
    isEditable: true,
    editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true },
  });
  assert.deepEqual(template.find(item => item.role === 'paste'), { role: 'paste', enabled: true });
  assert.equal(template.find(item => item.role === 'copy').enabled, false);
  assert.equal(template.find(item => item.role === 'cut').enabled, false);
  assert.deepEqual(editingContextTemplate({ isEditable: false }), []);
});

test('context menu opens only for editable fields in its owning window', () => {
  const window = { webContents: new EventEmitter() };
  let popup;
  installEditingContextMenu(window, {
    buildFromTemplate: template => ({ popup: options => { popup = { template, options }; } }),
  });
  window.webContents.emit('context-menu', {}, { isEditable: false });
  assert.equal(popup, undefined);
  window.webContents.emit('context-menu', {}, { isEditable: true, editFlags: { canPaste: true } });
  assert.equal(popup.options.window, window);
  assert.equal(popup.template.find(item => item.role === 'paste').enabled, true);
});
