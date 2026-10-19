const { authorizeRequestHeaders, isAllowedExternalUrl, isTrustedAppUrl } = require('./url-policy.cjs');

function secureWindow(window, { serverUrl, token, openExternal }) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      callback({
        requestHeaders: authorizeRequestHeaders(details, window.webContents.id, serverUrl, token),
      });
    },
  );
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url, serverUrl)) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) openExternal(url);
    }
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedAppUrl(url, serverUrl)) event.preventDefault();
  });
}

module.exports = { secureWindow };
