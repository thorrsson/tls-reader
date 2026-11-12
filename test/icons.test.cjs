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

test('mobile apps ship opaque iOS and adaptive Android bookshelf icons', async () => {
  const ios = await sharp('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png').metadata();
  assert.deepEqual([ios.width, ios.height, ios.hasAlpha], [1024, 1024, false]);
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [density, scale] of Object.entries(densities)) {
    const sizes = { ic_launcher: 48, ic_launcher_round: 48, ic_launcher_foreground: 108, ic_launcher_background: 108 };
    for (const [name, dp] of Object.entries(sizes)) {
      const metadata = await sharp(`android/app/src/main/res/mipmap-${density}/${name}.png`).metadata();
      assert.equal(metadata.width, dp * scale, `${density}/${name}`);
    }
  }
  for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const xml = fs.readFileSync(`android/app/src/main/res/mipmap-anydpi-v26/${file}`, 'utf8');
    assert.ok(xml.includes('@mipmap/ic_launcher_background') && xml.includes('@mipmap/ic_launcher_foreground'), file);
  }
});
