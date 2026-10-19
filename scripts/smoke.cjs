const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tls-reader-smoke-'));
  let child;
  let output = '';
  try {
    await fs.cp('resources/reader', root, { recursive: true, verbatimSymlinks: true });
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const { runtimeEnv: config } = JSON.parse(await fs.readFile(path.join(root, 'desktop-backend.json'), 'utf8'));
    child = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, ...config, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => { output += error.message; });
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (child.exitCode !== null) throw new Error(`Reader exited: ${output}`);
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch (error) {
        if (attempt === 149) throw new Error(`Reader not ready: ${error.message}\n${output}`);
      }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, `Reader readiness timed out: ${output}`);
    const html = await (await fetch(origin)).text();
    assert.match(html, /TLS/);
    const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"]+_next\/static\/[^"]+)"/g)].map(match => match[1]))];
    assert.ok(assets.some(asset => asset.includes('.js')), 'page references JS');
    assert.ok(assets.some(asset => asset.includes('.css')), 'page references CSS');
    for (const asset of assets) assert.equal((await fetch(new URL(asset.replaceAll('&amp;', '&'), origin))).status, 200, asset);
    assert.equal((await fetch(`${origin}/api/library/session`)).status, 401);
    assert.equal((await fetch(`${origin}/api/library/session`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status, 400);
    const logout = await fetch(`${origin}/api/library/session`, { method: 'DELETE' });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /HttpOnly/i);
    assert.match(logout.headers.get('set-cookie'), /SameSite=lax/i);
    const locale = await fetch(`${origin}/locales/en/thorium-web.json`);
    assert.equal(locale.status, 200);
    assert.ok(Object.keys(await locale.json()).length > 0);
    const font = await fetch(`${origin}/fonts/AndroidPatch/serif/NimbusRoman.woff`);
    assert.equal(font.status, 200);
    assert.equal(Buffer.from(await font.arrayBuffer()).toString('ascii', 0, 4), 'wOFF');
    console.log(`Relocated standalone OK: page, ${assets.length} JS/CSS assets, session, locale, font`);
  } finally {
    if (child && child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
