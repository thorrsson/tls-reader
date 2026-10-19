function isAllowedExternalUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    if (url.protocol === 'https:') return Boolean(url.hostname);
    return url.protocol === 'mailto:' && /^[^@\s]+@[^@\s]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function isTrustedAppUrl(value, appOrigin) {
  try {
    const candidate = new URL(value);
    const trusted = new URL(appOrigin);
    return !candidate.username && !candidate.password && candidate.origin === trusted.origin &&
      candidate.protocol === 'http:' &&
      trusted.protocol === 'http:' && trusted.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function isTrustedFrameUrl(frameUrl, appOrigin) {
  if (isTrustedAppUrl(frameUrl, appOrigin)) return true;
  try {
    const url = new URL(frameUrl);
    return url.protocol === 'blob:' && isTrustedAppUrl(url.origin, appOrigin);
  } catch {
    return false;
  }
}

function isTrustedFrame(frame, appOrigin) {
  const seen = new Set();
  while (frame && !seen.has(frame)) {
    seen.add(frame);
    if (isTrustedFrameUrl(frame.url, appOrigin)) return true;
    if (frame.url !== 'about:blank' && frame.url !== 'about:srcdoc') return false;
    frame = frame.parent;
  }
  return false;
}

function authorizeRequestHeaders(details, webContentsId, appOrigin, token) {
  const headers = Object.fromEntries(Object.entries(details.requestHeaders)
    .filter(([name]) => name.toLowerCase() !== 'x-tls-reader-token'));
  if (details.webContentsId === webContentsId && isTrustedAppUrl(details.url, appOrigin) &&
      (details.resourceType === 'mainFrame' || isTrustedFrame(details.frame, appOrigin))) {
    headers['X-TLS-Reader-Token'] = token;
  }
  return headers;
}

module.exports = { isAllowedExternalUrl, isTrustedAppUrl, isTrustedFrameUrl, authorizeRequestHeaders };
