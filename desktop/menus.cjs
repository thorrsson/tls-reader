const { initialState, commandEnabled } = require('./bridge.cjs');

function applicationMenuTemplate({ checkForUpdates, installUpdate, command = () => {}, state = initialState }) {
  const item = (label, name, accelerator) => ({
    label, id: name, enabled: commandEnabled(name, state),
    ...(accelerator ? { accelerator } : {}),
    click: () => command(name),
  });
  return [
    {
      label: 'TLS Reader',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Check for Updates…', click: checkForUpdates },
        { label: 'Install Downloaded Update', click: installUpdate },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Account',
      submenu: [item('Sign In…', 'sign-in'), item('Sign Out', 'sign-out')],
    },
    {
      label: 'Library',
      submenu: [
        item('Show Library', 'show-library', 'CmdOrCtrl+L'),
        item('Refresh Library', 'refresh-library', 'CmdOrCtrl+Shift+R'),
      ],
    },
    {
      label: 'Reading',
      submenu: [
        item('Reading Settings…', 'reading-settings', 'CmdOrCtrl+,'),
        item('Table of Contents…', 'table-of-contents', 'CmdOrCtrl+Shift+T'),
        { ...item('Bookmarks (not supported by this reader)', 'bookmarks'), enabled: false },
      ],
    },
    {
      label: 'View',
      submenu: [
        { ...item('Library Grid', 'view-grid'), type: 'radio', checked: state.catalogView === 'grid' },
        { ...item('Library List', 'view-list'), type: 'radio', checked: state.catalogView === 'list' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
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
