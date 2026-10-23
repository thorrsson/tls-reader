const { isTrustedAppUrl } = require('./url-policy.cjs');

const commands = new Set([
  'sign-in', 'sign-out', 'show-library', 'refresh-library',
  'reading-settings', 'table-of-contents', 'bookmarks', 'view-grid', 'view-list',
]);
const initialState = {
  authenticated: false, busy: true, reading: false, readerReady: false, catalogView: 'grid',
};

function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(initialState);
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) return null;
  if (keys.slice(0, 4).some(key => typeof value[key] !== 'boolean')) return null;
  if (!['grid', 'list'].includes(value.catalogView)) return null;
  if ((value.reading && !value.authenticated) || (value.readerReady && !value.reading)) return null;
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function commandEnabled(command, state) {
  if (!commands.has(command) || state.busy) return false;
  if (command === 'bookmarks') return false;
  if (command === 'sign-in') return !state.authenticated;
  if (!state.authenticated) return false;
  if (['reading-settings', 'table-of-contents', 'bookmarks'].includes(command)) return state.reading && state.readerReady;
  if (['view-grid', 'view-list', 'refresh-library'].includes(command)) return !state.reading;
  return true;
}

function trustedSender(event, window, serverUrl) {
  return !window.isDestroyed() && event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isTrustedAppUrl(event.senderFrame?.url, serverUrl);
}

function installDesktopBridge({ ipcMain, window, serverUrl, onState }) {
  let state = { ...initialState };
  const receive = (event, value) => {
    if (!trustedSender(event, window, serverUrl)) return;
    const next = validateState(value);
    if (!next) {
      console.warn('Rejected invalid desktop menu state');
      return;
    }
    state = next;
    onState(state);
  };
  const reset = () => {
    state = { ...initialState };
    onState(state);
  };
  ipcMain.on('tls-reader:state', receive);
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) reset();
  });
  window.on('closed', () => {
    ipcMain.removeListener('tls-reader:state', receive);
    reset();
  });
  return {
    send(command) {
      if (!window.isDestroyed() && isTrustedAppUrl(window.webContents.getURL(), serverUrl) &&
          commandEnabled(command, state)) {
        window.webContents.send('tls-reader:command', command);
      }
    },
  };
}

module.exports = { initialState, validateState, commandEnabled, trustedSender, installDesktopBridge };
