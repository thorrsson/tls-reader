const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { buildConfig } = require('./build-config.cjs');
const { stage } = require('./stage.cjs');
const { loadEnvConfig } = require('@next/env');

loadEnvConfig(process.cwd(), false);
const config = buildConfig();
// CLI-provided values override .env files loaded by Next.
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build'], {
  stdio: 'inherit',
  env: { ...process.env, ...config },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
stage();
writeFileSync('resources/reader/desktop-backend.json', JSON.stringify({ runtimeEnv: config }, null, 2));
