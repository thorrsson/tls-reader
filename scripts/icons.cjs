const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

async function main() {
  const directory = path.resolve('assets/icons');
  await fs.mkdir(directory, { recursive: true });
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  const images = new Map();
  for (const size of sizes) {
    const image = await sharp('assets/icon.svg').resize(size, size).png().toBuffer();
    images.set(size, image);
    await fs.writeFile(path.join(directory, `${size}x${size}.png`), image);
  }
  const entries = [16, 32, 48, 64, 128, 256];
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach((size, index) => {
    const position = 6 + index * 16;
    header[position] = size === 256 ? 0 : size;
    header[position + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, position + 4);
    header.writeUInt16LE(32, position + 6);
    header.writeUInt32LE(images.get(size).length, position + 8);
    header.writeUInt32LE(offset, position + 12);
    offset += images.get(size).length;
  });
  await fs.writeFile(path.join(directory, 'icon.ico'), Buffer.concat([header, ...entries.map(size => images.get(size))]));
  if (process.platform === 'darwin') {
    const iconset = path.join(directory, 'icon.iconset');
    await fs.mkdir(iconset, { recursive: true });
    try {
      for (const size of [16, 32, 128, 256, 512]) {
        await fs.writeFile(path.join(iconset, `icon_${size}x${size}.png`), images.get(size));
        await fs.writeFile(path.join(iconset, `icon_${size}x${size}@2x.png`), images.get(size * 2));
      }
      execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(directory, 'icon.icns')]);
    } finally {
      await fs.rm(iconset, { recursive: true, force: true });
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
