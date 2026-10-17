const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function load(files, names, extra = {}) {
  const saved = new Map();
  const context = vm.createContext({ console, setInterval, clearInterval, URLSearchParams,
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) },
    ...extra });
  const source = files.map(f => process.env.TT_TEST_REF
    ? execFileSync('git', ['show', `${process.env.TT_TEST_REF}:tt/src/${f}`], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
  vm.runInContext(source + '\n;globalThis.api = {' + names.join(',') + '};', context);
  return { ...context.api, context, saved };
}
module.exports = { load, root };
