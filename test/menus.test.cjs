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
  template[0].submenu[0].click();
  template[0].submenu[1].click();
  assert.equal(checked, 1);
  assert.equal(installed, 1);
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
