const { appendFileSync } = require('node:fs');
const { releaseVersion } = require('./release-version.cjs');

// Google Play rejects version codes above this value.
const MAX_BUILD_NUMBER = 2100000000;

// App Store versions must be numeric (X.Y.Z); prerelease and build metadata
// stay in the Android versionName only.
function mobileVersion(tag, buildNumber) {
  const version = releaseVersion(tag);
  const build = Number(buildNumber);
  if (!/^[1-9][0-9]*$/.test(String(buildNumber)) || build > MAX_BUILD_NUMBER) {
    throw new Error(`Mobile build number must be an integer from 1 to ${MAX_BUILD_NUMBER}.`);
  }
  return {
    marketingVersion: version.split(/[-+]/)[0],
    versionName: version,
    buildNumber: build,
  };
}

if (require.main === module) {
  const { marketingVersion, versionName, buildNumber } = mobileVersion(process.env.RELEASE_TAG, process.env.BUILD_NUMBER);
  const lines = `TLS_MARKETING_VERSION=${marketingVersion}\nTLS_VERSION_NAME=${versionName}\nTLS_BUILD_NUMBER=${buildNumber}\n`;
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, lines);
  process.stdout.write(lines);
}

module.exports = { mobileVersion, MAX_BUILD_NUMBER };
