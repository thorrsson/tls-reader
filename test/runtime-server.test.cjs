const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ReaderServerRuntime, findFreePort, probeServer } = require('../desktop/server-runtime.cjs');

class FakeUtilityProcess extends EventEmitter {
  constructor() {
    super();
    this.children = [];
  }

  fork(modulePath, args, options) {
    const child = new EventEmitter();
    child.modulePath = modulePath;
    child.args = args;
    child.options = options;
    child.messages = [];
    child.killCount = 0;
    child.postMessage = (message) => {
      child.messages.push(message);
      if (message.type === 'shutdown') {
        setImmediate(() => child.emit('exit', 0));
      }
    };
    child.kill = () => {
      child.killCount += 1;
      setImmediate(() => child.emit('exit', 1));
    };
    this.children.push(child);
    return child;
  }
}

async function waitForChild(utilityProcess) {
  for (let attempts = 0; attempts < 100 && utilityProcess.children.length === 0; attempts += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(utilityProcess.children.length, 1, 'utility process should have started');
  return utilityProcess.children[0];
}

async function createRuntime(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tls-reader-runtime-'));
  const sourceDir = path.join(root, 'reader');
  const userDataPath = path.join(root, 'user-data');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'server.js'), 'standalone server');
  let hasSourceSymlink = false;
  try {
    await fs.symlink('server.js', path.join(sourceDir, 'server-link.js'));
    hasSourceSymlink = true;
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'ENOTSUP') throw error;
  }
  await fs.writeFile(path.join(sourceDir, 'desktop-backend.json'), JSON.stringify({
    runtimeEnv: { API_ORIGIN: 'https://api.example.test' },
  }));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const utilityProcess = new FakeUtilityProcess();
  const runtime = new ReaderServerRuntime({
    sourceDir,
    userDataPath,
    appVersion: '2.3.4',
    utilityProcess,
    findFreePort: async () => 43127,
    probe: async () => ({ status: 200 }),
    startupTimeoutMs: 100,
    pollIntervalMs: 1,
    shutdownTimeoutMs: 5,
    ...overrides,
  });
  return { runtime, utilityProcess, sourceDir, userDataPath, hasSourceSymlink };
}

test('copies the standalone reader into versioned writable storage and waits for readiness', async (t) => {
  const { runtime, utilityProcess, userDataPath, hasSourceSymlink } = await createRuntime(t);
  const url = await runtime.start();
  const child = utilityProcess.children[0];

  assert.equal(url, 'http://127.0.0.1:43127');
  assert.equal(await fs.readFile(path.join(userDataPath, 'runtime', '2.3.4', 'server.js'), 'utf8'), 'standalone server');
  if (hasSourceSymlink) {
    const copiedLink = path.join(userDataPath, 'runtime', '2.3.4', 'server-link.js');
    assert.equal((await fs.lstat(copiedLink)).isSymbolicLink(), true);
    assert.equal(await fs.readlink(copiedLink), 'server.js');
    assert.equal(await fs.readFile(copiedLink, 'utf8'), 'standalone server');
  }
  assert.equal(child.options.cwd, path.join(userDataPath, 'runtime', '2.3.4'));
  assert.equal(child.options.env.HOSTNAME, '127.0.0.1');
  assert.equal(child.options.env.PORT, '43127');
  assert.equal(child.options.env.API_ORIGIN, 'https://api.example.test');
  assert.equal(child.options.env.NEXT_PUBLIC_TLS_BASE_READER_URL, '');
  assert.equal(child.modulePath, path.join(userDataPath, 'runtime', '2.3.4', 'desktop-server-bootstrap.cjs'));
  assert.equal(child.options.env.TLS_READER_SERVER_PATH, path.join(userDataPath, 'runtime', '2.3.4', 'server.js'));
  assert.match(child.options.env.TLS_READER_LOCAL_AUTH_TOKEN, /^[a-f0-9]{64}$/);
  assert.notEqual(child.options.env.TLS_READER_LOCAL_AUTH_TOKEN, undefined);
  assert.equal(await fs.readFile(path.join(userDataPath, 'runtime', '2.3.4', 'desktop-server-bootstrap.cjs'), 'utf8')
    .then((contents) => contents.includes('desktop-server-auth.cjs')), true);
  await runtime.stop();
});

test('rejects staged symlinks that escape the reader template', async (t) => {
  const { runtime, sourceDir, hasSourceSymlink } = await createRuntime(t);
  if (!hasSourceSymlink) return t.skip('Symlinks are unavailable');
  await fs.symlink('../outside-reader', path.join(sourceDir, 'escaping-link'));
  await assert.rejects(runtime.start(), /non-portable symlink/);
});

test('fails startup when the utility process exits before becoming ready', async (t) => {
  const { runtime, utilityProcess } = await createRuntime(t, {
    probe: async () => { throw new Error('not ready'); },
  });
  const startup = runtime.start();
  const child = await waitForChild(utilityProcess);
  child.emit('exit', 9);

  await assert.rejects(startup, /exited before becoming ready/);
  await runtime.stop();
});

test('times out startup and terminates the unready utility process', async (t) => {
  const { runtime, utilityProcess } = await createRuntime(t, {
    probe: async () => { throw new Error('not ready'); },
    startupTimeoutMs: 10,
  });

  await assert.rejects(runtime.start(), /readiness timed out/);
  assert.deepEqual(utilityProcess.children[0].messages, [{ type: 'shutdown' }]);
});

test('reports utility process errors and cleans up the child', async (t) => {
  const { runtime, utilityProcess } = await createRuntime(t, {
    probe: async () => { throw new Error('not ready'); },
  });
  const startup = runtime.start();
  const child = await waitForChild(utilityProcess);
  child.emit('error', new Error('fork failed'));

  await assert.rejects(startup, /fork failed/);
  await runtime.stop();
  assert.deepEqual(utilityProcess.children[0].messages, [{ type: 'shutdown' }]);
});

test('cancels readiness when shutdown begins during startup', async (t) => {
  const { runtime, utilityProcess } = await createRuntime(t, {
    probe: async () => { throw new Error('not ready'); },
    startupTimeoutMs: 1000,
  });
  const startup = runtime.start();
  const child = await waitForChild(utilityProcess);
  await runtime.stop();

  await assert.rejects(startup, /startup cancelled/);
  assert.deepEqual(child.messages, [{ type: 'shutdown' }]);
});

test('kills the child when graceful shutdown does not complete before the timeout', async (t) => {
  const { runtime, utilityProcess } = await createRuntime(t, { shutdownTimeoutMs: 1 });
  await runtime.start();
  const child = utilityProcess.children[0];
  child.postMessage = (message) => child.messages.push(message);

  await runtime.stop();
  assert.deepEqual(child.messages, [{ type: 'shutdown' }]);
  assert.equal(child.killCount, 1);
});

test('reports an unexpected child exit after readiness', async (t) => {
  const unexpected = [];
  const { runtime, utilityProcess } = await createRuntime(t, {
    onUnexpectedExit: (details) => unexpected.push(details),
  });
  await runtime.start();
  utilityProcess.children[0].emit('exit', 7);

  assert.deepEqual(unexpected, [{ code: 7, signal: undefined }]);
  await runtime.stop();
});

test('real Node bootstrap serves authenticated loopback requests and exits gracefully', { timeout: 5000 }, async (t) => {
  const utilityProcess = {
    fork(modulePath, _args, options) {
      const child = spawn(process.execPath, ['-e', `
        process.parentPort = {
          on(event, listener) { process.on(event, (data) => listener({ data })); }
        };
        require(process.argv[1]);
      `, modulePath], {
        cwd: options.cwd,
        env: options.env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      child.postMessage = (message) => child.send(message);
      return child;
    },
  };
  const { runtime, sourceDir } = await createRuntime(t, {
    utilityProcess,
    findFreePort,
    probe: probeServer,
    startupTimeoutMs: 2000,
    shutdownTimeoutMs: 1000,
    log: () => {},
  });
  await fs.writeFile(path.join(sourceDir, 'server.js'), `
    const http = require('node:http');
    http.createServer((request, response) => response.end('reader'))
      .listen(Number(process.env.PORT), process.env.HOSTNAME);
  `);
  try {
    const url = await runtime.start();
    const http = require('node:http');
    const request = (headers) => new Promise((resolve, reject) => {
      const req = http.get(url, { headers, agent: false }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      });
      req.once('error', reject);
      req.setTimeout(1000, () => req.destroy(new Error('Runtime request timed out')));
    });
    assert.equal(await request({}), 403);
    assert.equal(await request({ 'X-TLS-Reader-Token': runtime.authToken }), 200);
    assert.equal(new URL(url).hostname, '127.0.0.1');
  } finally {
    await runtime.stop();
  }
  assert.equal(runtime.exitInfo.code, 0);
});
