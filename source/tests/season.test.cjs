/* Сезон — календарь. Остаток считается от даты старта, поэтому тест проверяет
 * границы: старт, середина, последний час, финиш и «через месяц после».
 * Раньше «12д 4ч» лежало строкой в словаре и не менялось никогда — ни один
 * тест этого не замечал, потому что проверять было нечего. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/data/season.js'), 'utf8');
/* t() как в бандле, но без словаря: видно и ключ, и подставленные числа. */
const t = (k, vars) => (vars ? k + ':' + Object.keys(vars).map((x) => x + '=' + vars[x]).join(',') : k);
const context = vm.createContext({ t });
vm.runInContext(source + '\n;globalThis.api = { SEASON, seasonEnd, seasonLeft, seasonOver, seasonLeftText, seasonLeftShort };', context);
const { SEASON, seasonEnd, seasonLeft, seasonOver, seasonLeftText, seasonLeftShort } = context.api;

const DAY = 864e5, HOUR = 36e5;
const at = (iso) => Date.parse(iso);

test('границы сезона: старт 15.10.2026, длина 26 дней', () => {
  assert.equal(SEASON.n, 4);
  assert.equal(SEASON.days, 26);
  assert.equal(SEASON.start, Date.UTC(2026, 9, 15));
  assert.equal(seasonEnd(), Date.UTC(2026, 10, 10));
});

test('в первый день остаётся весь сезон, и он не завершён', () => {
  const now = at('2026-10-15T00:00:00Z');
  assert.equal(seasonLeft(now), 26 * DAY);
  assert.equal(seasonOver(now), false);
  assert.equal(seasonLeftText(now), 'season.dh:d=26,h=0');
  assert.equal(seasonLeftShort(now), 'season.dShort:d=26');
});

test('середина сезона считается в днях и часах', () => {
  const now = at('2026-10-20T06:30:00Z');
  assert.equal(seasonLeft(now), 20 * DAY + 17 * HOUR + 30 * 60000);
  assert.equal(seasonLeftText(now), 'season.dh:d=20,h=17');
  assert.equal(seasonLeftShort(now), 'season.dShort:d=20');
});

test('последние часы — уже часы и минуты, а не «0д 3ч»', () => {
  const now = at('2026-11-09T21:15:00Z');
  assert.equal(seasonLeft(now), 2 * HOUR + 45 * 60000);
  assert.equal(seasonLeftText(now), 'season.hm:h=2,m=45');
  assert.equal(seasonLeftShort(now), 'season.hShort:h=2');
});

test('последняя минута не показывает «0ч 0м»', () => {
  const now = seasonEnd() - 30 * 1000;
  assert.equal(seasonLeftText(now), 'season.hm:h=0,m=1');
  assert.equal(seasonLeftShort(now), 'season.hShort:h=1');
});

test('финиш: остаток ноль, оба экрана говорят «завершён»', () => {
  const now = seasonEnd();
  assert.equal(seasonLeft(now), 0);
  assert.equal(seasonOver(now), true);
  assert.equal(seasonLeftText(now), 'season.over');
  assert.equal(seasonLeftShort(now), 'season.overShort');
});

test('после финиша остаток не уходит в минус', () => {
  const now = seasonEnd() + 40 * DAY;
  assert.equal(seasonLeft(now), 0);
  assert.equal(seasonOver(now), true);
  assert.equal(seasonLeftText(now), 'season.over');
});

test('зашитых чисел сезона больше нет в словарях', () => {
  const ru = fs.readFileSync(path.join(__dirname, '../src/locales/ru.js'), 'utf8');
  const en = fs.readFileSync(path.join(__dirname, '../src/locales/en.js'), 'utf8');
  for (const src of [ru, en]) {
    assert.ok(!src.includes("'season.left'"), 'season.left был выдуманным остатком');
    assert.ok(!src.includes("'season.leftShort'"), 'season.leftShort был выдуманным остатком');
    assert.ok(src.includes("'season.over'"), 'финиш сезона должен быть в словаре');
  }
});
