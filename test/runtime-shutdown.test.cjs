const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { installGracefulShutdown } = require('../desktop/server-shutdown.cjs');

test('utility shutdown closes HTTP servers before exiting and ignores unrelated messages', async () => {
  const parentPort = new EventEmitter();
  const events = [];
  let finishClose;
  const servers = new Set([{
    close(callback) { events.push('close'); finishClose = callback; },
    closeIdleConnections() { events.push('close-idle'); },
  }]);
  installGracefulShutdown(parentPort, servers, (code) => events.push(['exit', code]));
  parentPort.emit('message', { data: { type: 'unrelated' } });
  assert.deepEqual(events, []);
  parentPort.emit('message', { data: { type: 'shutdown' } });
  parentPort.emit('message', { data: { type: 'shutdown' } });
  assert.deepEqual(events, ['close', 'close-idle']);
  finishClose();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['close', 'close-idle', ['exit', 0]]);
});
