const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadProgressHelpers() {
  const filename = path.join(__dirname, '../app/reader-runtime-helpers.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports }, { filename });
  return module.exports;
}

class FakeTimers {
  nextId = 0;
  callbacks = new Map();

  setTimeout = (callback, delay) => {
    const id = ++this.nextId;
    this.callbacks.set(id, { callback, delay });
    return id;
  };

  clearTimeout = id => this.callbacks.delete(id);

  advance() {
    const timers = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const timer of timers) timer.callback();
  }
}

const {
  canApplyServerProgress,
  getReaderRuntimeState,
  ProgressSaveQueue,
} = loadProgressHelpers();

test('flushes the pending locator immediately with keepalive when leaving', () => {
  const timers = new FakeTimers();
  const saves = [];
  const queue = new ProgressSaveQueue(
    async (payload, keepalive) => saves.push({ payload, keepalive }),
    error => { throw error; },
    timers,
  );

  queue.queue('final-position');
  assert.equal(timers.callbacks.size, 1);
  assert.equal([...timers.callbacks.values()][0].delay, 700);
  queue.flush();

  assert.equal(timers.callbacks.size, 0);
  assert.deepEqual(saves, [{ payload: 'final-position', keepalive: true }]);
});

test('cancels a queued B when progress returns to already-sent A', async () => {
  const timers = new FakeTimers();
  const saves = [];
  let resolveSave;
  const queue = new ProgressSaveQueue(
    (payload, keepalive) => {
      saves.push({ payload, keepalive });
      return new Promise(resolve => { resolveSave = resolve; });
    },
    error => { throw error; },
    timers,
  );

  queue.queue('A');
  timers.advance();
  assert.deepEqual(saves, [{ payload: 'A', keepalive: false }]);

  queue.queue('B');
  assert.equal(queue.queue('A'), 'already-in-flight');
  assert.equal(timers.callbacks.size, 0);
  timers.advance();
  assert.equal(saves.length, 1);

  resolveSave();
  await Promise.resolve();
  assert.equal(queue.queue('A'), 'already-saved');
});

test('sends only the latest queued locator after the debounce delay', () => {
  const timers = new FakeTimers();
  const saves = [];
  const queue = new ProgressSaveQueue(
    async (payload, keepalive) => saves.push({ payload, keepalive }),
    error => { throw error; },
    timers,
  );

  queue.queue('B');
  queue.queue('C');
  assert.equal(timers.callbacks.size, 1);
  timers.advance();
  assert.deepEqual(saves, [{ payload: 'C', keepalive: false }]);
});

test('reports failed saves and permits retrying the same locator', async () => {
  const timers = new FakeTimers();
  const errors = [];
  let attempts = 0;
  const queue = new ProgressSaveQueue(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    },
    error => errors.push(error.message),
    timers,
  );

  queue.queue('position');
  timers.advance();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, ['offline']);

  queue.queue('position');
  timers.advance();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.deepEqual(errors, ['offline']);
});

test('allows server hydration only when no newer local progress is pending', () => {
  assert.equal(canApplyServerProgress(3, 3, false, false), true);
  assert.equal(canApplyServerProgress(3, 4, false, false), false);
  assert.equal(canApplyServerProgress(3, 3, true, false), false);
  assert.equal(canApplyServerProgress(3, 3, false, true), false);
});

test('renders publication errors before checking reader readiness', () => {
  assert.equal(getReaderRuntimeState({
    error: new Error('manifest failed'),
    isLoading: true,
    publication: null,
    profile: null,
    localDataKey: null,
    isPositionReady: false,
  }).status, 'error');
  assert.equal(getReaderRuntimeState({
    error: null,
    isLoading: false,
    publication: null,
    profile: null,
    localDataKey: null,
    isPositionReady: false,
  }).status, 'loading');
  assert.equal(getReaderRuntimeState({
    error: null,
    isLoading: false,
    publication: {},
    profile: 'epub',
    localDataKey: 'reader-key',
    isPositionReady: true,
  }).status, 'ready');
});
