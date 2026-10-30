/* Shared tiny harness for gameplay audits (audit_gp.cjs):
 * loads tt/src files into a vm context and collects numbered checks. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');            // game/
const SRC = path.join(ROOT, 'tt', 'src');
const out = [];
const idRef = { v: 201 };
function load(files, names, extra = {}) {
  files = ['05_stroke_config.js', ...files.filter(f => f !== '05_stroke_config.js')];
  const ctx = vm.createContext({ console, Math, setInterval, clearInterval, URLSearchParams, ...extra });
  const source = files.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  vm.runInContext(source + '\n;globalThis.__api = {' + names.join(',') + '};', ctx);
  return ctx.__api;
}
function rec(idRef, g, name, ok, detail, sev = 2) { out.push({ id: idRef.v++, group: g, name, ok: !!ok, detail: detail || '', sev }); }
module.exports = { load, ROOT, SRC, rec, out, idRef };
