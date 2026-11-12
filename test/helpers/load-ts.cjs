const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const repoRoot = path.join(__dirname, '../..');

const resolveTsFile = (base) => {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
};

/**
 * Loads a TypeScript module in a sandbox. Repository-local imports (`@/...`
 * and relative paths) are transpiled and loaded recursively; any other
 * dependency must be supplied through `stubs`, keyed by import specifier.
 */
function loadTsModule(relativePath, { globals = {}, stubs = {} } = {}) {
  const context = vm.createContext({ URL, URLSearchParams, Response, Headers, Request, ...globals });
  const cache = new Map();

  const load = (filename) => {
    if (cache.has(filename)) {
      return cache.get(filename).exports;
    }
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    cache.set(filename, module);
    const requireFromModule = (name) => {
      if (Object.prototype.hasOwnProperty.call(stubs, name)) {
        return stubs[name];
      }
      let base = null;
      if (name.startsWith('@/')) {
        base = path.join(repoRoot, name.slice(2));
      } else if (name.startsWith('./') || name.startsWith('../')) {
        base = path.resolve(path.dirname(filename), name);
      }
      const resolved = base && resolveTsFile(base);
      if (!resolved) {
        throw new Error(`Unexpected dependency: ${name}`);
      }
      return load(resolved);
    };
    const wrapper = vm.runInContext(
      `(function (module, exports, require) {\n${source}\n})`,
      context,
      { filename },
    );
    wrapper(module, module.exports, requireFromModule);
    return module.exports;
  };

  return load(path.join(repoRoot, relativePath));
}

module.exports = { loadTsModule };
