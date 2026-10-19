const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const GITHUB_FEED = Object.freeze({
  provider: 'github',
  owner: 'thorrsson',
  repo: 'tls-reader',
  private: false,
});

class UpdateController {
  constructor({
    updater,
    app,
    platform = process.platform,
    env = process.env,
    dialog,
    log = console.error,
    getWindow = () => null,
    setInterval: schedule = setInterval,
    clearInterval: cancel = clearInterval,
    intervalMs = UPDATE_INTERVAL_MS,
  }) {
    this.updater = updater;
    this.app = app;
    this.platform = platform;
    this.env = env;
    this.dialog = dialog;
    this.log = log;
    this.getWindow = getWindow;
    this.schedule = schedule;
    this.cancel = cancel;
    this.intervalMs = intervalMs;
    this.state = { status: 'idle', progress: 0 };
    this.timer = null;
    this.started = false;
    this.downloadPromptShown = false;
  }

  isEnabled() {
    return this.app.isPackaged && (this.platform !== 'linux' || Boolean(this.env.APPIMAGE));
  }

  async start() {
    if (this.started || !this.isEnabled()) return false;
    this.started = true;
    this.updater.autoDownload = true;
    this.updater.autoInstallOnAppQuit = false;
    this.updater.setFeedURL({ ...GITHUB_FEED });

    this.updater.on('checking-for-update', () => {
      this.state = { ...this.state, status: 'checking', error: undefined };
    });
    this.updater.on('update-available', (info) => {
      this.state = { ...this.state, status: 'available', info };
    });
    this.updater.on('update-not-available', (info) => {
      this.state = { ...this.state, status: 'not-available', info };
    });
    this.updater.on('download-progress', (progress) => {
      this.state = { ...this.state, status: 'downloading', progress: progress.percent };
    });
    this.updater.on('update-downloaded', (info) => {
      this.state = { ...this.state, status: 'downloaded', info, progress: 100 };
      this._promptForRestart();
    });
    this.updater.on('error', (error) => this._reportError(error));

    this.timer = this.schedule(() => this.checkNow(), this.intervalMs);
    await this.checkNow();
    return true;
  }

  async checkNow() {
    if (!this.isEnabled() || !this.started) return false;
    this.state = { ...this.state, status: 'checking', error: undefined };
    try {
      await this.updater.checkForUpdates();
      return true;
    } catch (error) {
      await this._reportError(error);
      return false;
    }
  }

  async _reportError(error) {
    this.state = { ...this.state, status: 'error', error };
    this.log('TLS Reader update check failed:', error);
    try {
      await this._showMessageBox({
        type: 'error',
        title: 'Update check failed',
        message: 'TLS Reader could not check for updates.',
        detail: error.message,
        buttons: ['OK'],
      });
    } catch (dialogError) {
      this.log('Could not display update error:', dialogError);
    }
  }

  async _promptForRestart() {
    if (this.downloadPromptShown) return;
    this.downloadPromptShown = true;
    try {
      const result = await this._showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: 'A TLS Reader update has been downloaded.',
        detail: 'Restart TLS Reader to install the update.',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (result.response === 0) this.installNow();
    } catch (error) {
      this.log('Could not display update-ready prompt:', error);
    }
  }

  _showMessageBox(options) {
    const window = this.getWindow();
    return window ? this.dialog.showMessageBox(window, options) : this.dialog.showMessageBox(options);
  }

  installNow() {
    if (!this.isEnabled() || this.state.status !== 'downloaded') return false;
    this.updater.quitAndInstall(false, true);
    return true;
  }

  stop() {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }
}

module.exports = { UpdateController, GITHUB_FEED, UPDATE_INTERVAL_MS };
