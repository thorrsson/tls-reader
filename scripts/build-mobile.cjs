// Builds the reader as a static export for the Capacitor iOS/Android shells.
//
// Static exports cannot contain request-dependent route handlers, so the build
// runs from a staged copy of the sources without app/api. On mobile, those
// endpoints are served in the WebView by lib/library/mobile-* and native code.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { buildConfig } = require('./build-config.cjs');
const { loadEnvConfig } = require('@next/env');

const root = path.resolve(__dirname, '..');
const stageDir = path.join(root, '.mobile-build');
const outDir = path.join(root, 'out');
const sources = ['app', 'lib', 'config', 'public', 'next.config.ts', 'tsconfig.json', 'package.json'];
// Thorium only ships a fixed set of locales and fonts; anything else is a 404.
const staticOnlyRoutes = ['app/locales/[locale]/[file]/route.ts', 'app/fonts/[...fontPath]/route.ts'];

function stageSources() {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  for (const entry of sources) {
    fs.cpSync(path.join(root, entry), path.join(stageDir, entry), {
      recursive: true,
      filter: (src) => path.relative(root, src) !== path.join('app', 'api'),
    });
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(stageDir, 'node_modules'), 'dir');
  for (const route of staticOnlyRoutes) {
    fs.appendFileSync(path.join(stageDir, route), '\nexport const dynamicParams = false;\n');
  }
}

function main() {
  loadEnvConfig(root, false);
  const config = buildConfig();
  stageSources();
  const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
    cwd: stageDir,
    stdio: 'inherit',
    // CLI-provided values override .env files loaded by Next.
    env: { ...process.env, ...config, TLS_BUILD_TARGET: 'mobile', TLS_TURBOPACK_ROOT: root },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(path.join(stageDir, 'out'), outDir, { recursive: true });
  console.log(`Mobile web bundle written to ${path.relative(root, outDir)}/`);
}

if (require.main === module) {
  main();
}

module.exports = { stageSources };
