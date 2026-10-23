const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { installRequestAuthorization } = require('../desktop/server-auth.cjs');
const { probeServer } = require('../desktop/server-runtime.cjs');
const { authorizeRequestHeaders } = require('../desktop/url-policy.cjs');

function request(port, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { 'X-TLS-Reader-Token': token } : {};
    const req = http.get({ host: '127.0.0.1', port, headers, agent: false }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    req.once('error', reject);
    req.setTimeout(1000, () => req.destroy(new Error('Authorization test request timed out')));
  });
}

test('rejects loopback requests without the per-launch token and accepts authorized reader requests', async (t) => {
  const server = http.createServer((_request, response) => response.end('reader'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const restoreAuthorization = installRequestAuthorization(http, port, 'private-runtime-token');
  t.after(async () => {
    restoreAuthorization();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  assert.equal(await request(port), 403);
  assert.equal(await request(port, 'wrong-token'), 403);
  assert.equal(await request(port, 'private-runtime-token'), 200);
});

test('readiness verifies the server secret without accepting a foreign loopback HTTP response', async (t) => {
  const server = http.createServer((_request, response) => response.end('foreign server'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let restoreAuthorization = () => {};
  t.after(async () => {
    restoreAuthorization();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${port}`;
  await assert.rejects(probeServer(url, 100, 'private-runtime-token'), /ownership/);
  restoreAuthorization = installRequestAuthorization(http, port, 'private-runtime-token');
  assert.equal((await probeServer(url, 100, 'private-runtime-token')).status, 204);
  await assert.rejects(probeServer(url, 100, 'wrong-token'), /ownership/);
});

test('authorizes initial main-frame navigation but never foreign windows, frames or destinations', () => {
  const serverUrl = 'http://127.0.0.1:43127';
  const base = {
    url: `${serverUrl}/`, webContentsId: 3, resourceType: 'mainFrame',
    frame: { url: 'about:blank' }, requestHeaders: { Accept: '*/*' },
  };
  const authorize = (details) => authorizeRequestHeaders(details, 3, serverUrl, 'secret');
  assert.equal(authorize(base)['X-TLS-Reader-Token'], 'secret');
  assert.equal(authorize({ ...base, webContentsId: 4 })['X-TLS-Reader-Token'], undefined);
  assert.equal(authorize({ ...base, url: 'https://evil.example/' })['X-TLS-Reader-Token'], undefined);
  assert.equal(authorize({ ...base, resourceType: 'xhr', frame: { url: 'https://evil.example/' } })
    ['X-TLS-Reader-Token'], undefined);
  assert.equal(authorize({ ...base, resourceType: 'xhr', frame: { url: `${serverUrl}/book` } })
    ['X-TLS-Reader-Token'], 'secret');
  assert.equal(authorize({ ...base, resourceType: 'xhr', frame: { url: `blob:${serverUrl}/book` } })
    ['X-TLS-Reader-Token'], 'secret');
  assert.equal(authorize({
    ...base, webContentsId: 4, requestHeaders: { 'x-tls-reader-token': 'secret' },
  })['x-tls-reader-token'], undefined);
  assert.equal(authorize({
    ...base, url: 'https://evil.example/redirect', requestHeaders: { 'X-TLS-Reader-Token': 'secret' },
  })['X-TLS-Reader-Token'], undefined);
  assert.equal(authorize({
    ...base, resourceType: 'xhr',
    frame: { url: 'about:srcdoc', parent: { url: `${serverUrl}/book` } },
  })['X-TLS-Reader-Token'], 'secret');
  assert.equal(authorize({
    ...base, resourceType: 'xhr',
    frame: { url: 'about:blank', parent: { url: 'https://evil.example/' } },
  })['X-TLS-Reader-Token'], undefined);
});
