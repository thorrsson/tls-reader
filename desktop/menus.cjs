function applicationMenuTemplate({ checkForUpdates, installUpdate }) {
  return [
    {
      label: 'TLS Reader',
      submenu: [
        { label: 'Check for Updates…', click: checkForUpdates },
        { label: 'Install Downloaded Update', click: installUpdate },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
  ];
}

function editingContextTemplate({ isEditable, editFlags }) {
  if (!isEditable) return [];
  return [
    { role: 'undo', enabled: editFlags.canUndo },
    { role: 'redo', enabled: editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: editFlags.canCut },
    { role: 'copy', enabled: editFlags.canCopy },
    { role: 'paste', enabled: editFlags.canPaste },
    { type: 'separator' },
    { role: 'selectAll', enabled: editFlags.canSelectAll },
  ];
}

function installEditingContextMenu(window, Menu) {
  window.webContents.on('context-menu', (_event, params) => {
    const template = editingContextTemplate(params);
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window });
  });
}

module.exports = { applicationMenuTemplate, editingContextTemplate, installEditingContextMenu };
