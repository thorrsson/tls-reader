const { createHmac, timingSafeEqual } = require('node:crypto');

const READINESS_PATH = '/__tls_reader_desktop_ready';

function readinessProof(token, challenge) {
  return createHmac('sha256', token).update(challenge).digest('hex');
}

function hasValidToken(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const actualBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function installRequestAuthorization(http, port, token, onListening = () => {}) {
  const originalEmit = http.Server.prototype.emit;
  const emitWithAuthorization = function (event, ...args) {
    if (event === 'listening' && this.address()?.port === port) onListening(this);
    if (event === 'request' && this.address()?.port === port) {
      const [request, response] = args;
      const challenge = request.headers['x-tls-reader-challenge'];
      if (request.method === 'GET' && request.url === READINESS_PATH &&
          typeof challenge === 'string' && /^[a-f0-9]{64}$/.test(challenge)) {
        response.writeHead(204, {
          'Cache-Control': 'no-store',
          'X-TLS-Reader-Proof': readinessProof(token, challenge),
        });
        response.end();
        return true;
      }
      if (!hasValidToken(request.headers['x-tls-reader-token'], token)) {
        response.writeHead(403, { 'Cache-Control': 'no-store' });
        response.end('Forbidden');
        return true;
      }
    }
    return originalEmit.call(this, event, ...args);
  };
  http.Server.prototype.emit = emitWithAuthorization;
  return () => {
    if (http.Server.prototype.emit === emitWithAuthorization) {
      http.Server.prototype.emit = originalEmit;
    }
  };
}

module.exports = { hasValidToken, installRequestAuthorization, READINESS_PATH, readinessProof };
