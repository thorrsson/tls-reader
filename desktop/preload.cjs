const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  const commands = new Set([
    'sign-in', 'sign-out', 'show-library', 'refresh-library',
    'reading-settings', 'table-of-contents', 'bookmarks', 'view-grid', 'view-list',
  ]);
  contextBridge.exposeInMainWorld('tlsDesktop', Object.freeze({
    onCommand(callback) {
      if (typeof callback !== 'function') throw new TypeError('Expected a command callback');
      const listener = (_event, command) => {
        if (commands.has(command)) callback(command);
      };
      ipcRenderer.on('tls-reader:command', listener);
      return () => ipcRenderer.removeListener('tls-reader:command', listener);
    },
    reportState(state) {
      ipcRenderer.send('tls-reader:state', {
        authenticated: state.authenticated,
        busy: state.busy,
        reading: state.reading,
        readerReady: state.readerReady,
        catalogView: state.catalogView,
      });
    },
  }));
}
