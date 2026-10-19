const fs = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { hasValidToken, READINESS_PATH, readinessProof } = require('./server-auth.cjs');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function probeServer(url, timeoutMs = 1000, token) {
  return new Promise((resolve, reject) => {
    const challenge = randomBytes(32).toString('hex');
    const request = http.get(new URL(READINESS_PATH, url), {
      agent: false,
      headers: { 'X-TLS-Reader-Challenge': challenge },
    }, (response) => {
      response.resume();
      response.once('end', () => {
        if (typeof token !== 'string' || response.statusCode !== 204 ||
            !hasValidToken(response.headers['x-tls-reader-proof'], readinessProof(token, challenge))) {
          reject(new Error('Reader server ownership verification failed'));
          return;
        }
        resolve({ status: response.statusCode });
      });
      response.once('error', reject);
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Server readiness probe timed out'));
    });
    request.once('error', reject);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function systemEnvironment(source) {
  const keys = ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'USERPROFILE'];
  return Object.fromEntries(keys.filter((key) => typeof source[key] === 'string').map((key) => [key, source[key]]));
}

function readRuntimeEnvironment(configPath) {
  return fs.readFile(configPath, 'utf8').then((content) => {
    const config = JSON.parse(content);
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('desktop-backend.json must contain a JSON object');
    }
    const runtimeEnv = config.runtimeEnv ?? {};
    if (!runtimeEnv || typeof runtimeEnv !== 'object' || Array.isArray(runtimeEnv)) {
      throw new Error('desktop-backend.json runtimeEnv must be an object');
    }
    for (const [key, value] of Object.entries(runtimeEnv)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string') {
        throw new Error(`Invalid runtime environment entry: ${key}`);
      }
    }
    return runtimeEnv;
  });
}

async function copyRuntimeTemplate(sourceDir, destinationDir, fileSystem = fs) {
  const links = [];
  await fileSystem.cp(sourceDir, destinationDir, {
    recursive: true,
    preserveTimestamps: true,
    filter: async (source) => {
      if (!(await fileSystem.lstat(source)).isSymbolicLink()) return true;
      const target = await fileSystem.readlink(source);
      const relative = path.relative(sourceDir, path.resolve(path.dirname(source), target));
      if (path.isAbsolute(target) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
        throw new Error(`Reader template contains a non-portable symlink: ${source}`);
      }
      const type = (await fileSystem.stat(source)).isDirectory() ? 'dir' : 'file';
      links.push({ source, target, type });
      return false;
    },
  });
  // fs.cp creates untyped links on Windows, which makes directory links unusable.
  for (const { source, target, type } of links) {
    await fileSystem.symlink(target, path.join(destinationDir, path.relative(sourceDir, source)), type);
  }
}

class ReaderServerRuntime {
  constructor({
    sourceDir,
    userDataPath,
    appVersion,
    utilityProcess,
    findFreePort: findPort = findFreePort,
    probe = probeServer,
    startupTimeoutMs = 30_000,
    pollIntervalMs = 200,
    shutdownTimeoutMs = 1_500,
    env = process.env,
    onUnexpectedExit = () => {},
    log = console.error,
  }) {
    this.sourceDir = sourceDir;
    this.userDataPath = userDataPath;
    this.appVersion = appVersion;
    this.utilityProcess = utilityProcess;
    this.findFreePort = findPort;
    this.probe = probe;
    this.startupTimeoutMs = startupTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.hostEnv = env;
    this.onUnexpectedExit = onUnexpectedExit;
    this.log = log;
    this.runtimeDir = path.join(userDataPath, 'runtime', appVersion);
    this.child = null;
    this.serverUrl = null;
    this.authToken = null;
    this.stopping = false;
    this.ready = false;
    this.exitInfo = null;
    this.starting = null;
    this.stopPromise = null;
    this.terminationPromise = null;
  }

  start() {
    if (!this.starting) this.starting = this._start();
    return this.starting;
  }

  async _prepareRuntime() {
    const configName = 'desktop-backend.json';
    const configPath = path.join(this.sourceDir, configName);
    await fs.access(path.join(this.sourceDir, 'server.js'));
    await fs.access(configPath);
    await fs.mkdir(path.dirname(this.runtimeDir), { recursive: true });
    try {
      await fs.access(path.join(this.runtimeDir, 'server.js'));
      await fs.access(path.join(this.runtimeDir, configName));
      return;
    } catch {
      // A partial previous copy is replaced through an isolated staging directory.
    }

    const stagingDir = `${this.runtimeDir}.${randomUUID()}.tmp`;
    try {
      await copyRuntimeTemplate(this.sourceDir, stagingDir);
      if (this.stopping) throw new Error('startup cancelled');
      await fs.rm(this.runtimeDir, { recursive: true, force: true });
      await fs.rename(stagingDir, this.runtimeDir);
    } catch (error) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      throw error;
    }
  }

  async _start() {
    try {
      await this._prepareRuntime();
      if (this.stopping) throw new Error('startup cancelled');

      const port = await this.findFreePort();
      const configEnv = await readRuntimeEnvironment(path.join(this.runtimeDir, 'desktop-backend.json'));
      if (this.stopping) throw new Error('startup cancelled');

      this.serverUrl = `http://127.0.0.1:${port}`;
      const childEnv = {
        ...systemEnvironment(this.hostEnv),
        ...configEnv,
        NODE_ENV: 'production',
        HOSTNAME: '127.0.0.1',
        PORT: String(port),
        NEXT_PUBLIC_TLS_BASE_READER_URL: '',
      };
      this.authToken = randomBytes(32).toString('hex');
      childEnv.TLS_READER_LOCAL_AUTH_TOKEN = this.authToken;
      childEnv.TLS_READER_SERVER_PATH = path.join(this.runtimeDir, 'server.js');
      await fs.copyFile(path.join(__dirname, 'server-bootstrap.cjs'), path.join(this.runtimeDir, 'desktop-server-bootstrap.cjs'));
      await fs.copyFile(path.join(__dirname, 'server-auth.cjs'), path.join(this.runtimeDir, 'desktop-server-auth.cjs'));
      await fs.copyFile(path.join(__dirname, 'server-shutdown.cjs'), path.join(this.runtimeDir, 'desktop-server-shutdown.cjs'));
      if (this.stopping) throw new Error('startup cancelled');
      this.child = this.utilityProcess.fork(path.join(this.runtimeDir, 'desktop-server-bootstrap.cjs'), [], {
        cwd: this.runtimeDir,
        env: childEnv,
        stdio: 'pipe',
        serviceName: 'TLS Reader server',
      });
      for (const streamName of ['stdout', 'stderr']) {
        this.child[streamName]?.on('data', (data) => this.log(`Reader server ${streamName}:`, data.toString()));
      }

      this.childExited = new Promise((resolve) => {
        this.child.once('exit', (code, signal) => {
          this.exitInfo = { code, signal };
          resolve(this.exitInfo);
          if (this.ready && !this.stopping) this.onUnexpectedExit(this.exitInfo);
        });
      });
      this.child.once('error', (error) => {
        this.childError = error;
        if (this.ready && !this.stopping) this.onUnexpectedExit({ error });
      });

      const deadline = Date.now() + this.startupTimeoutMs;
      let lastProbeError;
      while (Date.now() < deadline) {
        if (this.stopping) throw new Error('startup cancelled');
        if (this.childError) throw this.childError;
        if (this.exitInfo) {
          throw new Error(`Reader server exited before becoming ready (code ${this.exitInfo.code ?? 'unknown'})`);
        }
        try {
          await this.probe(this.serverUrl, Math.min(1000, Math.max(1, deadline - Date.now())), this.authToken);
          if (this.stopping) throw new Error('startup cancelled');
          if (this.childError) throw this.childError;
          if (this.exitInfo) throw new Error('Reader server exited before becoming ready');
          this.ready = true;
          return this.serverUrl;
        } catch (error) {
          if (this.stopping) throw new Error('startup cancelled');
          lastProbeError = error;
          await wait(Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now())));
        }
      }
      throw new Error(`Reader server readiness timed out${lastProbeError ? `: ${lastProbeError.message}` : ''}`);
    } catch (error) {
      this.stopping = true;
      await this._terminateChild();
      throw error;
    }
  }

  stop() {
    if (!this.stopPromise) {
      this.stopping = true;
      this.stopPromise = (async () => {
        await this._terminateChild();
        if (this.starting) await this.starting.catch(() => {});
        await this._terminateChild();
      })();
    }
    return this.stopPromise;
  }

  _terminateChild() {
    if (!this.terminationPromise) this.terminationPromise = this._terminateChildOnce();
    return this.terminationPromise;
  }

  async _terminateChildOnce() {
    const child = this.child;
    if (!child || this.exitInfo) return;

    try {
      child.postMessage({ type: 'shutdown' });
    } catch {
      // A process that has already exited may reject the shutdown message.
    }

    const exited = this.childExited;
    if (exited) {
      await Promise.race([exited, wait(this.shutdownTimeoutMs)]);
    }
    if (!this.exitInfo) {
      try {
        child.kill();
      } catch {
        // The child may have exited between the timeout and kill.
      }
      if (exited) await Promise.race([exited, wait(this.shutdownTimeoutMs)]);
    }
  }
}

module.exports = { ReaderServerRuntime, copyRuntimeTemplate, findFreePort, probeServer, readRuntimeEnvironment };
