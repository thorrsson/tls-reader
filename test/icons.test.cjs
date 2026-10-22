const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sharp = require('sharp');

test('packaging uses native bookshelf icons for every platform', () => {
  const config = fs.readFileSync('electron-builder.yml', 'utf8');
  for (const icon of ['assets/icons/icon.icns', 'assets/icons/icon.ico', 'assets/icons']) {
    assert.ok(config.includes(`icon: ${icon}`));
  }
  assert.equal(fs.readFileSync('assets/icons/icon.icns').toString('ascii', 0, 4), 'icns');
  const ico = fs.readFileSync('assets/icons/icon.ico');
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 6);
  for (let index = 0; index < 6; index++) {
    const offset = ico.readUInt32LE(6 + index * 16 + 12);
    const length = ico.readUInt32LE(6 + index * 16 + 8);
    assert.ok(offset + length <= ico.length);
    assert.equal(ico.toString('ascii', offset + 1, offset + 4), 'PNG');
  }
});

test('Linux and source-resolution icons have the required dimensions and transparency', async () => {
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    const metadata = await sharp(`assets/icons/${size}x${size}.png`).metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    assert.equal(metadata.hasAlpha, true);
  }
});
