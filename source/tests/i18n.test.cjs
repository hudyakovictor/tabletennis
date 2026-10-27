/* i18n contract: (1) ru/en dictionaries have identical key sets;
   (2) every key referenced from code exists in both dictionaries;
   (3) plural forms and interpolation actually render.
   Run: npm test  (from source/) */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.resolve(__dirname, '..', 'src');
function loadI18n() {
  const ctx = vm.createContext({ console, Intl, navigator: { language: 'en-US' } });
  const src = ['core/i18n.js', 'locales/ru.js', 'locales/en.js']
    .map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
  vm.runInContext(src + '\n;globalThis.api = { I18n };', ctx);
  return ctx.api.I18n;
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
}
function usedKeys() {
  const keys = new Set();
  const pats = [
    /\bt\(\s*'([A-Za-z0-9_.-]+)'/g,                 // t('key')
    /\b(?:tk|nk|dk|sk|tagk):\s*'([A-Za-z0-9_.-]+)'/g, // data-carried keys
    /\bk:\s*'((?:nav|league)\.[a-z]+)'/g,           // Nav / LEAGUES
    /'(tip\.\d+)'/g                                  // splash tips
  ];
  for (const f of walk(SRC)) {
    const s = fs.readFileSync(f, 'utf8');
    for (const re of pats) for (const m of s.matchAll(re)) if (!m[1].endsWith('.')) keys.add(m[1]);  // 'kind.'+x — динамические семейства ниже
  }
  // dynamic families built by concatenation in code
  for (const k of ['rubber', 'blade', 'trail', 'table', 'bundle']) keys.add('kind.' + k);
  for (const c of ['coins', 'gems']) keys.add('cur.' + c);
  for (const r of ['common', 'rare', 'epic', 'leg']) keys.add('rarity.' + r);
  return keys;
}

test('ru and en dictionaries have identical key sets', () => {
  const I18n = loadI18n();
  const ru = Object.keys(I18n.dicts.ru).sort(), en = Object.keys(I18n.dicts.en).sort();
  assert.deepEqual(en, ru);
});

test('every key used in code exists in both dictionaries', () => {
  const I18n = loadI18n();
  const missing = [];
  for (const k of usedKeys()) {
    if (!(k in I18n.dicts.ru)) missing.push('ru:' + k);
    if (!(k in I18n.dicts.en)) missing.push('en:' + k);
  }
  assert.deepEqual(missing, []);
});

test('placeholders match between locales', () => {
  const I18n = loadI18n();
  const ph = (v) => {
    const forms = typeof v === 'object' ? Object.values(v) : [v];
    const set = new Set();
    for (const f of forms) for (const m of String(f).matchAll(/\{(\w+)\}/g)) set.add(m[1]);
    return [...set].sort().join(',');
  };
  for (const k of Object.keys(I18n.dicts.ru)) assert.equal(ph(I18n.dicts.en[k]), ph(I18n.dicts.ru[k]), k);
});

test('plural forms and interpolation render', () => {
  const I18n = loadI18n();
  I18n.lang = 'ru';
  assert.equal(I18n.t('gems.word', { n: 1 }), 'гем');
  assert.equal(I18n.t('gems.word', { n: 3 }), 'гема');
  assert.equal(I18n.t('gems.word', { n: 80 }), 'гемов');
  assert.equal(I18n.t('chest.opensInToast', { name: 'Золотой сундук', time: '8ч' }), 'Золотой сундук откроется через 8ч');
  I18n.lang = 'en';
  assert.equal(I18n.t('gems.word', { n: 1 }), 'gem');
  assert.equal(I18n.t('gems.word', { n: 80 }), 'gems');
  assert.equal(I18n.t('match.matchTo', { n: 11 }), 'Match to 11');
  assert.equal(I18n.t('no.such.key'), 'no.such.key');   // fallback: the key itself, never a crash
});
