(async function () {
  const platforms = {
    mac: { label: 'macOS', suffix: '-mac-universal.dmg' },
    windows: { label: 'Windows (x64)', suffix: '-win-x64.exe' },
    linux: { label: 'Linux (x64)', suffix: '-linux-x64.AppImage' },
  };
  const links = Array.from(document.querySelectorAll('[data-download]'));
  const status = document.querySelector('[data-download-status]');
  const agent = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  let detected;

  if (!/Android|iPhone|iPad|iPod/i.test(agent) &&
      !(/Mac/i.test(platform) && navigator.maxTouchPoints > 1)) {
    if (/Mac/i.test(platform)) detected = 'mac';
    else if (/Win/i.test(platform)) detected = 'windows';
    else if (/Linux/i.test(platform)) detected = 'linux';
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = false;
  }

  if (!detected) {
    showStatus('Choose a desktop installer from all downloads. TLS Reader is available for macOS, Windows, and Linux.');
  }
  const requested = new Set(links.map(link =>
    link.dataset.download === 'auto' ? detected : link.dataset.download
  ).filter(key => key in platforms));
  if (requested.size === 0) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://api.github.com/repos/thorrsson/tls-reader/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const release = await response.json();
    if (!Array.isArray(release.assets)) throw new Error('GitHub returned no release assets');

    const downloads = {};
    for (const key of requested) {
      const asset = release.assets.find(asset =>
        typeof asset.name === 'string' &&
        asset.name.startsWith('TLS-Reader-') &&
        asset.name.endsWith(platforms[key].suffix)
      );
      if (!asset) continue;
      const url = new URL(asset.browser_download_url);
      if (url.origin !== 'https://github.com' ||
          !url.pathname.startsWith('/thorrsson/tls-reader/releases/download/')) {
        throw new Error('GitHub returned an unexpected installer URL');
      }
      downloads[key] = url.href;
    }
    for (const link of links) {
      const key = link.dataset.download === 'auto' ? detected : link.dataset.download;
      if (!downloads[key]) continue;
      link.href = downloads[key];
      if (link.dataset.download === 'auto') {
        link.textContent = `Download for ${platforms[key].label}`;
      }
    }
    if ([...requested].some(key => !downloads[key])) {
      showStatus('Some installers are not available in the latest release. Unavailable download links open the release page instead.');
    }
  } catch (error) {
    console.error('Could not resolve TLS Reader downloads:', error);
    showStatus('Direct downloads are temporarily unavailable. Download links open the latest release page so you can choose an installer.');
  } finally {
    clearTimeout(timeout);
  }
})();
