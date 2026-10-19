const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, utilityProcess } = require('electron');
const packagedResourcesArg = process.argv.find((arg) => arg.startsWith('--packaged-resources='));
const packagedResources = packagedResourcesArg
  ? path.resolve(packagedResourcesArg.slice('--packaged-resources='.length))
  : null;
const moduleDir = packagedResources ? path.join(packagedResources, 'app.asar') : __dirname;
const { ReaderServerRuntime } = require(path.join(moduleDir, 'server-runtime.cjs'));
const { secureWindow } = require(path.join(moduleDir, 'window-security.cjs'));

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.on('window-all-closed', () => {});

function httpStatus(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers, agent: false }, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
      response.once('error', reject);
    });
    request.once('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error('Smoke HTTP request timed out')));
  });
}

async function run() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tls-reader-electron-smoke-'));
  let window;
  let rendererFailure;
  let unexpectedExit;
  let failure;
  const runtime = new ReaderServerRuntime({
    sourceDir: packagedResources
      ? path.join(packagedResources, 'reader')
      : path.resolve(__dirname, '../resources/reader'),
    userDataPath: tempDir,
    appVersion: require(path.join(moduleDir, 'package.json')).version,
    utilityProcess,
    onUnexpectedExit: (details) => { unexpectedExit = details; },
  });
  const deadline = setTimeout(() => {
    console.error('Electron smoke exceeded its 90-second deadline');
    window?.destroy();
    runtime.child?.kill();
    app.exit(1);
  }, 90_000);
  try {
    const serverUrl = await runtime.start();
    assert.equal(new URL(serverUrl).hostname, '127.0.0.1');
    assert.equal(await httpStatus(serverUrl), 403);
    assert.equal(await httpStatus(serverUrl, { 'X-TLS-Reader-Token': runtime.authToken }), 200);

    window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        partition: `tls-reader-smoke-${process.pid}`,
      },
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      rendererFailure = details;
    });
    secureWindow(window, {
      serverUrl,
      token: runtime.authToken,
      openExternal: (url) => { throw new Error(`Unexpected external navigation: ${url}`); },
    });
    await window.loadURL(serverUrl);
    let page;
    const renderDeadline = Date.now() + 15_000;
    do {
      page = await window.webContents.executeJavaScript(`({
        title: document.title,
        login: Boolean(document.querySelector('input[type="password"]')),
        nodeExposed: typeof process !== 'undefined' || typeof require !== 'undefined'
      })`);
      if (page.login) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < renderDeadline);
    assert.ok(page.title.trim(), 'reader page must have a title');
    assert.equal(page.login, true, 'reader login form must render');
    assert.equal(page.nodeExposed, false, 'renderer must not expose Node globals');
    assert.equal(window.isVisible(), false, 'smoke must never show a window');
    const apiStatus = await window.webContents.executeJavaScript(
      "fetch('/api/library/session').then(response => response.status)",
    );
    assert.equal(apiStatus, 401, 'authenticated desktop request must reach the Next session route');
    assert.equal(rendererFailure, undefined, 'renderer must not crash');
    assert.equal(unexpectedExit, undefined, 'utility process must remain running');
    console.log(JSON.stringify({
      smoke: 'passed', title: page.title, login: page.login, apiStatus,
      hostname: new URL(serverUrl).hostname, visible: window.isVisible(),
    }));
  } catch (error) {
    failure = error;
  } finally {
    window?.destroy();
    await runtime.stop();
    if (runtime.exitInfo?.code !== 0 && !failure) {
      failure = new Error(`Utility process did not exit gracefully: ${JSON.stringify(runtime.exitInfo)}`);
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    clearTimeout(deadline);
  }
  if (failure) throw failure;
}

app.whenReady().then(run).then(() => app.exit(0)).catch((error) => {
  console.error('Electron smoke failed:', error);
  app.exit(1);
});
