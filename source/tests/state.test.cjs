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
  assert.equal(SAVE_VERSION, 7); assert.equal(S.v, 7); assert.equal(S.missShotHalf, 350);
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

/* v4 → v5: история рейтинга. Старый сейв получает пустую — профиль покажет
 * «истории нет», а не дорисует кривую от выдуманного числа. */
test('a v4 save gets an empty rating history, a real one survives', () => {
  const { S } = loadState({ v: 4, rating: 1180 });
  assert.deepEqual(S.hist, [], 'без истории — пустой массив');
  assert.equal(S.rating, 1180, 'рейтинг не трогаем');
  const hist = [{ t: Date.now() - 864e5, r: 1164 }, { t: Date.now(), r: 1180 }];
  const kept = loadState({ v: 4, hist }).S;
  assert.equal(kept.hist.length, 2, 'своя история не затирается миграцией');
});

/* v5 → v6: сезон привязан к номеру. Старый сейв получает passSeason = 4 —
 * тот же сезон, что был хардкодом, поэтому ролловера до смены нет. */
test('a v5 save gets passSeason = 4 and survives a real one', () => {
  const { S } = loadState({ v: 5, passLvl: 7, passXp: 60 });
  assert.equal(S.passSeason, 4, 'запускаем сезон 4 на легаси-сейве');
  assert.equal(S.passLvl, 7); assert.equal(S.passXp, 60);
  const kept = loadState({ v: 5, passSeason: 5 }).S;
  assert.equal(kept.passSeason, 5, 'уже сменённый сезон не откатывается');
});

test('new saves have no invented pass progress and legacy claims survive migration', () => {
  const fresh = loadState(null).S;
  assert.equal(fresh.passLvl, 0); assert.equal(fresh.passXp, 0);
  assert.deepEqual(Array.from(fresh.claimed.f), []); assert.deepEqual(Array.from(fresh.claimed.p), []);
  const legacy = loadState({ v: 5, passLvl: 7, passXp: 60, premium: true, claimed: { f: [1, 2], p: [1] } }).S;
  assert.equal(legacy.passLvl, 7); assert.equal(legacy.passXp, 60); assert.equal(legacy.premium, true);
  assert.deepEqual(Array.from(legacy.claimed.f), [1, 2]); assert.deepEqual(Array.from(legacy.claimed.p), [1]);
});
