const path = require('node:path');
const { app, BrowserWindow, dialog, Menu, shell, utilityProcess } = require('electron');
const { autoUpdater } = require('electron-updater');
const { ReaderServerRuntime } = require('./server-runtime.cjs');
const { isAllowedExternalUrl } = require('./url-policy.cjs');
const { secureWindow } = require('./window-security.cjs');
const { UpdateController } = require('./updater.cjs');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow = null;
  let runtime = null;
  let updater = null;
  let serverUrl = null;
  let quitting = false;
  let completedShutdown = false;

  function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }

  function openExternal(url) {
    if (!isAllowedExternalUrl(url)) return;
    shell.openExternal(url).catch((error) => {
      console.error('Could not open external link:', error);
    });
  }

  function createMainWindow() {
    if (!serverUrl || quitting) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      focusMainWindow();
      return;
    }

    mainWindow = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 720,
      minHeight: 560,
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const window = mainWindow;
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = null;
    });
    secureWindow(window, { serverUrl, token: runtime.authToken, openExternal });
    window.loadURL(serverUrl).catch((error) => {
      console.error('Could not load the local reader:', error);
      dialog.showErrorBox('TLS Reader failed to load', error.message);
      app.quit();
    });
  }

  function installApplicationMenu() {
    const template = [{
      label: 'TLS Reader',
      submenu: [
        { label: 'Check for Updates…', click: () => updater?.checkNow() },
        { label: 'Install Downloaded Update', click: () => updater?.installNow() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  app.on('second-instance', focusMainWindow);
  app.on('activate', createMainWindow);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', (event) => {
    if (completedShutdown) return;
    if (!runtime) {
      quitting = true;
      return;
    }
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    updater?.stop();
    runtime.stop().finally(() => {
      completedShutdown = true;
      app.quit();
    });
  });

  app.whenReady().then(async () => {
    if (quitting) return;
    installApplicationMenu();
    const sourceDir = app.isPackaged
      ? path.join(process.resourcesPath, 'reader')
      : path.resolve(__dirname, '../resources/reader');
    runtime = new ReaderServerRuntime({
      sourceDir,
      userDataPath: app.getPath('userData'),
      appVersion: app.getVersion(),
      utilityProcess,
      onUnexpectedExit: (details) => {
        if (quitting) return;
        const reason = details.error?.message ?? `exit code ${details.code ?? 'unknown'}`;
        dialog.showErrorBox('TLS Reader server stopped', `The local reader server stopped unexpectedly (${reason}).`);
        app.quit();
      },
    });
    try {
      serverUrl = await runtime.start();
    } catch (error) {
      if (!quitting) {
        console.error('TLS Reader server startup failed:', error);
        dialog.showErrorBox('TLS Reader could not start', error.message);
        app.quit();
      }
      return;
    }

    updater = new UpdateController({
      updater: autoUpdater,
      app,
      dialog,
      getWindow: () => mainWindow,
    });
    await updater.start();
    createMainWindow();
  }).catch((error) => {
    console.error('TLS Reader startup failed:', error);
    dialog.showErrorBox('TLS Reader could not start', error.message);
    app.quit();
  });
}
