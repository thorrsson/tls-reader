const fs = require('node:fs');
const path = require('node:path');

function allowed(source) {
  const parts = source.split(/[\\/]/);
  return !parts.some(part => part.startsWith('.env') || ['.git', 'cache', '.cache', '.DS_Store'].includes(part));
}

function verifyLinks(root, directory = root) {
  root = fs.realpathSync(root);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(file);
      const resolved = fs.realpathSync(file);
      if (path.isAbsolute(link) || !resolved.startsWith(root + path.sep)) {
        throw new Error(`Non-portable standalone link: ${file}`);
      }
    } else if (entry.isDirectory()) {
      verifyLinks(root, file);
    }
  }
}

function repairTracedLinks(root, target, directory = target) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const link = fs.readlinkSync(file);
      const originalFile = path.join(root, path.relative(target, file));
      const original = fs.realpathSync(originalFile);
      const dependencies = fs.realpathSync(path.join(root, 'node_modules'));
      if (!original.startsWith(dependencies + path.sep)) {
        throw new Error(`Escaping original dependency: ${original}`);
      }
      const destination = path.isAbsolute(link)
        ? path.join(target, path.relative(root, original))
        : path.resolve(path.dirname(file), link);
      if (!destination.startsWith(target + path.sep)) throw new Error(`Escaping traced link: ${file}`);
      if (!fs.existsSync(destination)) {
        fs.cpSync(original, destination, { recursive: true, dereference: true, filter: allowed });
      }
      if (path.isAbsolute(link)) {
        fs.unlinkSync(file);
        fs.symlinkSync(path.relative(path.dirname(file), destination), file, fs.statSync(destination).isDirectory() ? 'dir' : 'file');
      }
    } else if (entry.isDirectory()) {
      repairTracedLinks(root, target, file);
    }
  }
}

function stage(root = process.cwd()) {
  root = fs.realpathSync(root);
  const source = path.join(root, '.next/standalone');
  const target = path.join(root, 'resources/reader');
  if (!fs.existsSync(path.join(source, 'server.js'))) throw new Error('Build standalone reader first');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, filter: allowed, verbatimSymlinks: true });
  fs.cpSync(path.join(root, 'public'), path.join(target, 'public'), { recursive: true, filter: allowed });
  fs.cpSync(path.join(root, '.next/static'), path.join(target, '.next/static'), { recursive: true });
  // These routes use fs at runtime, so do not depend on heuristic tracing.
  const thorium = fs.realpathSync(path.join(root, 'node_modules/@edrlab/thorium-web'));
  const assets = path.join(target, 'node_modules/@edrlab/thorium-web/dist');
  fs.mkdirSync(assets, { recursive: true });
  for (const name of ['fonts', 'locales']) {
    fs.cpSync(path.join(thorium, 'dist', name), path.join(assets, name), { recursive: true, dereference: true });
  }
  repairTracedLinks(root, target);
  verifyLinks(target);
  return target;
}

if (require.main === module) stage();
module.exports = { stage, allowed, verifyLinks };
