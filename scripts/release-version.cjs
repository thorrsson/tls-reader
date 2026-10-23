const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

function releaseVersion(tag) {
  const number = '(0|[1-9][0-9]*)';
  const prerelease = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
  const pattern = new RegExp(`^v${number}\\.${number}\\.${number}(?:-${prerelease}(?:\\.${prerelease})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
  if (typeof tag !== 'string' || !pattern.test(tag) || tag.trim() !== tag) {
    throw new Error('Release tag must be v followed by a valid semantic version (for example v1.2.3).');
  }
  return tag.slice(1);
}

function stampReleaseVersion(root, tag) {
  const version = releaseVersion(tag);
  const packages = ['package.json', 'desktop/package.json'].map(file => {
    const filename = path.join(root, file);
    const manifest = JSON.parse(readFileSync(filename, 'utf8'));
    return { filename, manifest: { ...manifest, version } };
  });
  for (const { filename, manifest } of packages) {
    writeFileSync(filename, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return version;
}

if (require.main === module) {
  const version = stampReleaseVersion(process.cwd(), process.env.RELEASE_TAG);
  console.log(`Embedded release version ${version} in root and desktop packages.`);
}

module.exports = { releaseVersion, stampReleaseVersion };
