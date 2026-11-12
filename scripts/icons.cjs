const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');

const SPLASH_BACKGROUND = "#481022";

function iconParts(svg) {
  const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0];
  const background = /\n\s*<rect x="56" y="56" width="912" height="912" rx="204" fill="url\(#background\)"\/>/;
  const body = svg.split(background)[1]?.replace(/<\/svg>\s*$/, "");
  if (!defs || !body) throw new Error("assets/icon.svg no longer has the expected background and artwork layers");
  return { defs, body };
}

// Artwork is centred at roughly (512, 500); scale shrinks it into platform safe zones.
function iconSvg({ defs, body }, { background = "", scale = 1 } = {}) {
  const art = `<g transform="translate(512 512) scale(${scale}) translate(-512 -500)">${body}</g>`;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${defs}${background}${art}</svg>`);
}

async function writePng(file, input, width, height = width, options = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  let image = sharp(input).resize(width, height);
  if (options.opaque) image = image.flatten({ background: SPLASH_BACKGROUND }).removeAlpha();
  await image.png().toFile(file);
}

async function splash(file, icon, width, height) {
  const size = Math.round(Math.min(width, height) * 0.3);
  const logo = await sharp(icon).resize(size, size).png().toBuffer();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width, height, channels: 3, background: SPLASH_BACKGROUND } })
    .composite([{ input: logo, gravity: "center" }]).png().toFile(file);
}

async function mobile() {
  const source = await fs.readFile("assets/icon.svg");
  const parts = iconParts(source.toString("utf8"));
  const fullBleed = `<rect width="1024" height="1024" fill="url(#background)"/>`;
  const circle = `<circle cx="512" cy="512" r="512" fill="url(#background)"/>`;

  const ios = "ios/App/App/Assets.xcassets";
  await writePng(`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`, iconSvg(parts, { background: fullBleed, scale: 0.92 }), 1024, 1024, { opaque: true });
  for (const name of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) {
    await splash(`${ios}/Splash.imageset/${name}`, source, 2732, 2732);
  }

  const res = "android/app/src/main/res";
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  const splashSizes = { mdpi: [480, 320], hdpi: [800, 480], xhdpi: [1280, 720], xxhdpi: [1600, 960], xxxhdpi: [1920, 1280] };
  for (const [density, scale] of Object.entries(densities)) {
    const mipmap = `${res}/mipmap-${density}`;
    // Adaptive layers are 108dp; launchers only guarantee the central 66dp circle.
    await writePng(`${mipmap}/ic_launcher_foreground.png`, iconSvg(parts, { scale: 0.62 }), 108 * scale);
    await writePng(`${mipmap}/ic_launcher_background.png`, iconSvg({ ...parts, body: "" }, { background: fullBleed }), 108 * scale);
    await writePng(`${mipmap}/ic_launcher.png`, source, 48 * scale);
    await writePng(`${mipmap}/ic_launcher_round.png`, iconSvg(parts, { background: circle, scale: 0.78 }), 48 * scale);
    const [width, height] = splashSizes[density];
    await splash(`${res}/drawable-land-${density}/splash.png`, source, width, height);
    await splash(`${res}/drawable-port-${density}/splash.png`, source, height, width);
  }
  await splash(`${res}/drawable/splash.png`, source, 480, 320);
}

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

async function all() {
  await main();
  await mobile();
}

all().catch(error => { console.error(error); process.exitCode = 1; });
