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
  for (const k of ['racket', 'rubber', 'blade', 'trail', 'table', 'bundle']) keys.add('kind.' + k);
  for (const c of ['coins', 'gems']) keys.add('cur.' + c);
  for (const r of ['common', 'rare', 'epic', 'leg']) keys.add('rarity.' + r);
  for (const id of ['win', 'lose', 'finished', 'avgSpeed', 'maxSpeed', 'avgSpin', 'maxSpin', 'summary', 'strokes', 'stroke', 'metric']) keys.add('result.' + id);
  for (const coverage of ['complete', 'partial', 'missing']) keys.add('result.coverage.' + coverage);
  for (const pacing of ['coach', 'flow']) { keys.add('academy.pacing.' + pacing); keys.add('academy.pacing.' + pacing + 'Hint'); }
  for (const level of ['guided', 'ring', 'independent']) keys.add('train.help.' + level);
  for (const kind of ['lesson', 'set', 'check']) keys.add('train.recovery.' + kind);
  for (const option of ['course', 'stroke', 'accuracy', 'adaptive', 'variation']) keys.add('academy.' + option);
  const icons = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(SRC, 'ui/stroke_icons.js'), 'utf8'), icons);
  for (const id of icons.StrokeIcons.ids) keys.add('hud.stroke.' + id);
  for (const id of ['label', 'near', 'far', 'target', 'rally', 'rallyShort', 'serve', 'unlimited', 'low', 'energy', 'energyValue',
    'kmh', 'rps', 'missing', 'free', 'lastContact', 'pointShort', 'letShort', 'ended', 'net', 'out', 'whiff', 'point', 'winner', 'let',
    'matchPoint', 'paused', 'unknown', 'announceScore', 'announceServe', 'announceLow']) keys.add('hud.' + id);
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

test('academy pacing, help, set counts and recovery messages render in both languages', () => {
  const I18n = loadI18n();
  for (const lang of ['ru', 'en']) {
    I18n.lang = lang;
    for (const key of ['academy.pacing.coach', 'academy.pacing.flow', 'train.help.guided', 'train.help.ring', 'train.help.independent',
      'train.recovery.lesson', 'train.recovery.set', 'train.recovery.check', 'train.actualAttempt', 'train.example', 'train.replayUnavailable', 'train.actionRejected']) {
      assert.notEqual(I18n.t(key), key); assert.ok(I18n.t(key).length > 0);
    }
    const count = I18n.t('train.setProgress', { attempted: 7, size: 10, successful: 4 });
    assert.match(count, /7\/10/); assert.match(count, /4/); assert.doesNotMatch(count, /\{\w+\}/);
  }
});
