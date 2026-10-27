const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stateSource = fs.readFileSync(path.join(__dirname, '../src/core/state.js'), 'utf8');

function loadState(raw) {
  const entries = new Map([['ttu-v2', JSON.stringify(raw)], ['ttu-miss-shots', '[{"id":1,"img":"T0xE"}]']]);
  const localStorage = { getItem: k => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v), removeItem: k => entries.delete(k) };
  const context = vm.createContext({ localStorage, structuredClone, setTimeout, clearTimeout });
  vm.runInContext(stateSource + '\n;globalThis.api = { S, SAVE_VERSION };', context);
  return { ...context.api, entries };
}

test('v2 gallery crop upgrades once without clearing images or other settings', () => {
  const { S, SAVE_VERSION, entries } = loadState({ v: 2, missShotHalf: 20, missShots: false, rating: 1105 });
  assert.equal(SAVE_VERSION, 4); assert.equal(S.v, 4); assert.equal(S.missShotHalf, 350);
  assert.equal(S.missShots, false); assert.equal(S.rating, 1105);
  assert.equal(JSON.parse(entries.get('ttu-v2.bak')).missShotHalf, 20);
  assert.equal(JSON.parse(entries.get('ttu-miss-shots'))[0].img, 'T0xE');
});

test('a v3 save gets the default bot level, a chosen one survives', () => {
  const { S } = loadState({ v: 3, missShotHalf: 400, missShots: true, rating: 1234 });
  assert.equal(S.missShotHalf, 400); assert.equal(S.rating, 1234);
  assert.equal(S.diff, 1, 'ветеран без поля diff получает MEDIUM');
  const kept = loadState({ v: 3, diff: 3 }).S;
  assert.equal(kept.diff, 3, 'выбранный уровень не перетирается миграцией');
});
