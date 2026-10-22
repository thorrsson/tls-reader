const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, Menu, clipboard, ipcMain, utilityProcess } = require('electron');
const packagedResourcesArg = process.argv.find((arg) => arg.startsWith('--packaged-resources='));
const packagedResources = packagedResourcesArg
  ? path.resolve(packagedResourcesArg.slice('--packaged-resources='.length))
  : null;
const moduleDir = packagedResources ? path.join(packagedResources, 'app.asar') : __dirname;
const { ReaderServerRuntime } = require(path.join(moduleDir, 'server-runtime.cjs'));
const { secureWindow } = require(path.join(moduleDir, 'window-security.cjs'));
const { applicationMenuTemplate, installEditingContextMenu } = require(path.join(moduleDir, 'menus.cjs'));
const { installDesktopBridge } = require(path.join(moduleDir, 'bridge.cjs'));

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
  let menuState;
  let commandBridge;
  let fixtureServer;
  const testClipboard = process.env.CI === 'true';
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
        preload: path.join(moduleDir, 'preload.cjs'),
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
    commandBridge = installDesktopBridge({
      ipcMain, window, serverUrl,
      onState: state => {
        menuState = state;
        Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate({
          state,
          checkForUpdates: () => {},
          installUpdate: () => {},
          command: command => commandBridge.send(command),
        })));
      },
    });
    installEditingContextMenu(window, Menu);
    await window.loadURL(serverUrl);
    let page;
    const renderDeadline = Date.now() + 15_000;
    do {
      page = await window.webContents.executeJavaScript(`({
        title: document.title,
        login: Boolean(document.querySelector('dialog[open] input[type="password"]')),
        nodeExposed: typeof process !== 'undefined' || typeof require !== 'undefined'
      })`);
      if (page.login) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    } while (Date.now() < renderDeadline);
    assert.ok(page.title.trim(), 'reader page must have a title');
    assert.equal(page.login, true, 'reader login form must render');
    assert.equal(page.nodeExposed, false, 'renderer must not expose Node globals');
    assert.equal(menuState.authenticated, false);
    assert.equal(menuState.busy, false);
    assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('.thorium-toolbar'))"), false);
    await window.webContents.executeJavaScript("document.querySelector('dialog').close()");
    commandBridge.send('sign-in');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await window.webContents.executeJavaScript("document.querySelector('dialog').open"), true);
    assert.equal(window.isVisible(), false, 'smoke must never show a window');
    const apiStatus = await window.webContents.executeJavaScript(
      "fetch('/api/library/session').then(response => response.status)",
    );
    assert.equal(apiStatus, 401, 'authenticated desktop request must reach the Next session route');
    const fields = await window.webContents.executeJavaScript(`({
      username: document.querySelector('#login-username')?.autocomplete,
      password: document.querySelector('#login-password')?.autocomplete
    })`);
    assert.deepEqual(fields, { username: 'username', password: 'current-password' });
    const editMenu = Menu.getApplicationMenu().items.find(item => item.role === 'editmenu');
    assert.ok(editMenu?.submenu.items.some(item => item.role === 'paste'), 'native Edit menu must include Paste');
    await window.webContents.executeJavaScript("document.querySelector('#login-password').focus()");
    if (testClipboard) {
      clipboard.writeText('synthetic-paste-password');
      window.webContents.paste();
    } else {
      // Do not replace a developer's clipboard during a local smoke.
      await window.webContents.insertText('synthetic-paste-password');
    }
    const inputDeadline = Date.now() + 3000;
    let filledPassword;
    do {
      filledPassword = await window.webContents.executeJavaScript("document.querySelector('#login-password').value");
      if (filledPassword === 'synthetic-paste-password') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < inputDeadline);
    assert.equal(filledPassword, 'synthetic-paste-password', 'native password-field insertion must work');
    fixtureServer = http.createServer((request, response) => {
      response.setHeader('Access-Control-Allow-Origin', '*');
      if (request.url === '/manifest.json') {
        const origin = `http://127.0.0.1:${fixtureServer.address().port}`;
        response.setHeader('content-type', 'application/webpub+json');
        response.end(JSON.stringify({
          '@context': 'https://readium.org/webpub-manifest/context.jsonld',
          metadata: {
            '@type': 'https://schema.org/Book', title: 'Desktop Menu Smoke',
            identifier: 'tls-menu-smoke', language: 'en',
            conformsTo: 'https://readium.org/webpub-manifest/profiles/epub',
          },
          links: [{ rel: 'self', href: `${origin}/manifest.json`, type: 'application/webpub+json' }],
          readingOrder: [{ href: `${origin}/chapter.xhtml`, type: 'application/xhtml+xml', title: 'Chapter One' }],
          toc: [{ href: `${origin}/chapter.xhtml`, title: 'Chapter One' }],
        }));
      } else {
        response.setHeader('content-type', 'application/xhtml+xml');
        response.end('<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p>A synthetic book for native menu verification.</p></body></html>');
      }
    });
    await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
    const manifestUrl = `http://127.0.0.1:${fixtureServer.address().port}/manifest.json`;
    await window.webContents.executeJavaScript(`(() => {
      const originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (url === '/api/library/session' && options?.method === 'POST') {
          window.smokeCredentials = JSON.parse(options.body);
          return Promise.resolve(new Response(JSON.stringify({ books: [{
            title: 'Desktop Menu Smoke', manifestUrl: ${JSON.stringify(manifestUrl)},
            publicationId: null, identifier: 'tls-menu-smoke', assetId: null, coverUrl: null, author: null
          }] }), {
            status: 200, headers: { 'content-type': 'application/json' }
          }));
        }
        return originalFetch(url, options);
      };
      document.querySelector('#login-username').value = 'autofill@example.com';
      document.querySelector('#login-password').value = 'synthetic-autofill-password';
      document.querySelector('.auth-form').requestSubmit();
    })()`);
    const submitted = await window.webContents.executeJavaScript('window.smokeCredentials');
    assert.deepEqual(submitted, { email: 'autofill@example.com', password: 'synthetic-autofill-password' },
      'login must submit password-manager-filled DOM values without React change events');
    const stateDeadline = Date.now() + 3000;
    while (!menuState.authenticated && Date.now() < stateDeadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(menuState.authenticated, true);
    commandBridge.send('view-list');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(menuState.catalogView, 'list');
    assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('.catalog-view-toggle'))"), false);
    await window.webContents.executeJavaScript("document.querySelector('.catalog-row-list li button').click()");
    const readerDeadline = Date.now() + 30_000;
    while (!menuState.readerReady && Date.now() < readerDeadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(menuState.readerReady, true, 'synthetic publication must enable native reading commands');
    commandBridge.send('reading-settings');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('[role=\"dialog\"]'))"), true,
      'native reading settings must open the reader sheet');
    await window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await new Promise(resolve => setTimeout(resolve, 200));
    commandBridge.send('table-of-contents');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('[role=\"dialog\"]'))"), true,
      'native contents must open the reader sheet');
    commandBridge.send('show-library');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(menuState.reading, false);
    assert.equal(menuState.readerReady, false);
    commandBridge.send('sign-out');
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(menuState.authenticated, false);
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
    if (fixtureServer) {
      fixtureServer.closeAllConnections();
      await new Promise(resolve => fixtureServer.close(resolve));
    }
    if (runtime.exitInfo?.code !== 0 && !failure) {
      failure = new Error(`Utility process did not exit gracefully: ${JSON.stringify(runtime.exitInfo)}`);
    }
    await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    if (testClipboard) clipboard.clear();
    clearTimeout(deadline);
  }
  if (failure) throw failure;
}

app.whenReady().then(run).then(() => app.exit(0)).catch((error) => {
  console.error('Electron smoke failed:', error);
  app.exit(1);
});
