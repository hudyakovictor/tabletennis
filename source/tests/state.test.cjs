const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stateSource = fs.readFileSync(path.join(__dirname, '../src/core/state.js'), 'utf8');

function loadState(raw, options = {}) {
  const entries = new Map([['ttu-v2', JSON.stringify(raw)], ['ttu-miss-shots', '[{"id":1,"img":"T0xE"}]']]);
  if (options.engine) entries.set('topspin.arena.save.v1', JSON.stringify(options.engine));
  const localStorage = { getItem: k => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v), removeItem: k => entries.delete(k) };
  const context = vm.createContext({ localStorage, structuredClone, setTimeout, clearTimeout, window: options.window });
  vm.runInContext(stateSource + '\n;globalThis.api = { S, SAVE_VERSION, DEFAULT_STATE, repairAudioLevels, repairCalibrationPreferences, effectiveReducedMotion };', context);
  return { ...context.api, entries };
}

test('v2 gallery crop upgrades once without clearing images or other settings', () => {
  const { S, SAVE_VERSION, entries } = loadState({ v: 2, missShotHalf: 20, missShots: false, rating: 1105 });
  assert.ok(SAVE_VERSION >= 8); assert.equal(S.v, SAVE_VERSION); assert.equal(S.missShotHalf, 350);
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

test('fresh settings use the approved preset, with no duplicated calibration defaults', () => {
  const { S } = loadState(null);
  assert.equal(S.quality, 'mid'); assert.equal(S.diff, 1); assert.equal(S.lang, null);
  assert.equal(S.sfx, true); assert.equal(S.vibro, true); assert.equal(S.hint, true); assert.equal(S.rm, false); assert.equal(S.missShots, false);
  assert.deepEqual(JSON.parse(JSON.stringify(S.audioLevels)), { master: .8, effects: .9, music: .25, ambient: .2 });
  assert.deepEqual(Object.keys(S.cal), []);
});

test('v8 settings migration retains explicit mute/zero/fractions, gallery, progress and inventory', () => {
  const raw = { v: 7, sfx: false, volume: 0, rm: true, quality: 'high', diff: 3, hint: false, vibro: false, missShots: true,
    cal: { padSpeed: 100 * (1 - .84) / .36, flytime: 0, captureK: 100 },
    owned: ['r-real'], equipped: { rubber: 'r-real', blade: 'b-real' }, coins: 777, gems: 9,
    training: { version: 1, lessons: { TOPSPIN: { mastered: true, practiced: true, attempts: 7, correct: 6 } }, lastLesson: 'TOPSPIN' },
    claimed: { f: [1, 2], p: [1] }, tutorialDone: true, tutorialRewarded: true, premium: true };
  const { S, entries } = loadState(raw);
  for (const key of Object.keys(raw).filter(key => key !== 'v')) assert.deepEqual(JSON.parse(JSON.stringify(S[key])), raw[key], key);
  assert.equal(S.audioLevels.master, 0); assert.equal(S.audioLevels.effects, .9);
  assert.deepEqual(JSON.parse(entries.get('ttu-v2.bak')), raw);
  assert.equal(JSON.parse(entries.get('ttu-miss-shots'))[0].img, 'T0xE');
});

test('actual old engine volume/mute is imported once, never replacing a new explicit master or unmute', () => {
  const engine = { v: 3, settings: { volume: 0, sound: false }, owned: ['engine-owned'] };
  const old = loadState({ v: 7, sfx: true }, { engine }).S;
  assert.equal(old.audioLevels.master, 0); assert.equal(old.sfx, false);
  const fresh = loadState(null, { engine }).S; assert.equal(fresh.audioLevels.master, 0); assert.equal(fresh.sfx, false);
  const current = loadState({ v: 8, sfx: true, audioLevels: { master: .4, effects: 0, music: .1, ambient: .2 } }, { engine }).S;
  assert.equal(current.audioLevels.master, .4); assert.equal(current.audioLevels.effects, 0); assert.equal(current.sfx, true);
});

test('real legacy engine quality, difficulty and haptics fill only absent shell preferences', () => {
  const engine = { v: 3, settings: { haptics: false, difficulty: 3, quality: 'low' } };
  for (const raw of [null, { v: 7 }]) {
    const { S } = loadState(raw, { engine }); assert.equal(S.vibro, false); assert.equal(S.diff, 3); assert.equal(S.quality, 'low');
  }
  const explicit = loadState({ v: 7, vibro: true, diff: 0, quality: 'high' }, { engine }).S;
  assert.equal(explicit.vibro, true); assert.equal(explicit.diff, 0); assert.equal(explicit.quality, 'high');
  assert.equal(loadState(null, { engine: { settings: { quality: 'medium' } } }).S.quality, 'mid');
});

test('partial/corrupt levels and calibrations are sanitized without interpreting raw values as multipliers', () => {
  const { repairAudioLevels, repairCalibrationPreferences } = loadState(null);
  const levels = repairAudioLevels({ master: NaN, effects: 4, music: -1, ambient: 0 }, 0);
  assert.equal(levels.master, 0); assert.equal(levels.effects, 1); assert.equal(levels.music, 0); assert.equal(levels.ambient, 0);
  const raw = JSON.parse('{"__proto__":{"flytime":0},"constructor":0,"prototype":0,"captureK":1.12,"flytime":0,"camZoom":200,"camHeight":-5}');
  raw.spinGain = NaN; raw.arcSens = '50'; Object.setPrototypeOf(raw, { hintRadius: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(repairCalibrationPreferences(raw))), { captureK: 1.12, flytime: 0, camZoom: 100, camHeight: 0 });
});

test('effective reduced motion is OS OR user preference, with requested rm untouched', () => {
  const query = { matches: true }, { S, effectiveReducedMotion: reduced } = loadState({ v: 8, rm: false }, { window: { matchMedia: () => query } });
  assert.equal(reduced(), true); assert.equal(S.rm, false);
  S.rm = true; query.matches = false; assert.equal(reduced(), true); assert.equal(S.rm, true);
  S.rm = false; assert.equal(reduced(), false);
});
