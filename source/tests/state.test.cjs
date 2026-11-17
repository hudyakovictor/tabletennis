const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const stateSource = fs.readFileSync(path.join(__dirname, '../src/core/state.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function loadState(raw, options = {}) {
  const entries = new Map([['ttu-v2', JSON.stringify(raw)], ['ttu-miss-shots', '[{"id":1,"img":"T0xE"}]']]);
  if (Object.hasOwn(options, 'primary')) entries.set('ttu-v2', options.primary);
  if (Object.hasOwn(options, 'backup')) entries.set('ttu-v2.bak', options.backup);
  if (options.engine) entries.set('topspin.arena.save.v1', JSON.stringify(options.engine));
  const localStorage = { getItem: k => entries.get(k) ?? null, setItem: (k, v) => entries.set(k, v), removeItem: k => entries.delete(k) };
  const context = vm.createContext({ localStorage, structuredClone, setTimeout, clearTimeout, window: options.window });
  vm.runInContext(stateSource + '\n;globalThis.api = { S, SAVE_VERSION, DEFAULT_STATE, repairAudioLevels, repairCalibrationPreferences, effectiveReducedMotion, saveNow };', context);
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
  assert.deepEqual(plain(S.owned), ['r-standard']);
  assert.deepEqual(plain(S.equipped), { racket: 'r-standard' });
});

test('v9 equipment migration retires only known goods and preserves all unrelated earned state', () => {
  const retired = ['r-coral', 'r-void', 'r-teal', 'b-ink', 't-gold', 't-coral', 'tb-neon', 'f-season', 'season-bundle'];
  const raw = { v: 9, owned: [...retired, 'r-pan', 'r-unreleased', 't-event'],
    equipped: { racket: 'r-pan', rubber: 'r-coral', blade: 'b-ink', trail: 't-gold', table: 'tb-neon' },
    coins: 713, gems: 900, rating: 1420, wins: 11, losses: 5, streak: 3, bestRally: 17, form: [1, 0, 1],
    level: 4, xp: 251, hist: [{ t: 10, r: 1400 }], diff: 3, cal: { camZoom: 75 },
    passSeason: 5, passLvl: 7, passXp: 60, premium: true, claimed: { f: [1, 2], p: [3] },
    rewardReceipts: ['item:r-coral', 'purchase:old-charge', 'bundle:4', 'pass:5:p:3'],
    chests: [{ id: 'earned', kind: 'gold', state: 'ready' }, null], tutorialDone: true, tutorialRewarded: true,
    training: { version: 1, lastLesson: 'TOPSPIN', lessons: { TOPSPIN: { mastered: true, practiced: true, attempts: 7, correct: 6 } } },
    earnedBadge: { id: 'tournament-winner' } };
  const { S, SAVE_VERSION, entries } = loadState(raw);
  assert.equal(SAVE_VERSION, 10); assert.equal(S.v, SAVE_VERSION);
  assert.deepEqual(plain(S.owned), ['r-standard', 'r-pan', 'r-unreleased', 't-event']);
  assert.deepEqual(plain(S.equipped), { racket: 'r-pan' });
  for (const key of Object.keys(raw).filter(key => !['v', 'owned', 'equipped'].includes(key))) assert.deepEqual(plain(S[key]), raw[key], key);
  assert.deepEqual(JSON.parse(entries.get('ttu-v2.bak')), raw);
  assert.deepEqual(JSON.parse(entries.get('ttu-v2')), raw, 'load must not overwrite the original save');
});

test('legacy and current saves safely repair corrupt ownership containers before choosing equipment', () => {
  for (const v of [5, 9, 10]) for (const owned of [null, {}, 'r-pan', 42, false, []]) {
    const { S } = loadState({ v, owned, equipped: { racket: 'r-pan', trail: 't-gold', table: 'tb-neon' },
      coins: 777, gems: 19, passLvl: 7, premium: true, claimed: { f: [1], p: [3] }, rewardReceipts: ['pass:4:p:3'] });
    assert.deepEqual(plain(S.owned), ['r-standard'], `${v}: ${JSON.stringify(owned)}`);
    assert.deepEqual(plain(S.equipped), { racket: 'r-standard' });
    assert.equal(S.coins, 777); assert.equal(S.gems, 19); assert.equal(S.passLvl, 7); assert.equal(S.premium, true);
    assert.deepEqual(plain(S.claimed), { f: [1], p: [3] }); assert.deepEqual(plain(S.rewardReceipts), ['pass:4:p:3']);
  }
  const { S } = loadState({ v: 10, owned: [null, 'r-pan', 'r-standard', 'r-standard', 7, {}, '', ' ', 't-event', 't-event'], equipped: ['r-pan'] });
  assert.deepEqual(plain(S.owned), ['r-pan', 'r-standard', 't-event']);
  assert.deepEqual(plain(S.equipped), { racket: 'r-standard' });
});

test('pan selection requires ownership and a valid explicit racket choice, on migration and reload', () => {
  for (const v of [9, 10]) for (const row of [
    { owned: [], equipped: { racket: 'r-pan' }, expected: 'r-standard' },
    { owned: ['r-unreleased'], equipped: { racket: 'r-pan' }, expected: 'r-standard' },
    { owned: ['r-pan'], equipped: { racket: 'r-pan', rubber: 'r-coral', blade: 'b-ink', trail: 't-gold', table: 'tb-neon' }, expected: 'r-pan' },
    { owned: ['r-pan'], equipped: { racket: 'r-standard' }, expected: 'r-standard' },
    { owned: ['r-pan'], equipped: { racket: 'unknown' }, expected: 'r-standard' },
    ...[null, [], 'r-pan', true, 1].map(equipped => ({ owned: ['r-pan'], equipped, expected: 'r-standard' }))
  ]) {
    const { S } = loadState({ v, owned: row.owned, equipped: row.equipped });
    assert.equal(S.owned.filter(id => id === 'r-standard').length, 1);
    assert.equal(S.owned.includes('r-pan'), row.owned.includes('r-pan'));
    assert.deepEqual(plain(S.equipped), { racket: row.expected });
  }
});

test('current-version cleanup and repeated persisted reloads are idempotent and keep the original backup', () => {
  const raw = { v: 10, owned: ['t-event', 'r-standard', 'r-standard', 'r-coral', 'r-pan', 't-event', 'tb-neon'],
    equipped: { racket: 'r-pan', trail: 't-gold', table: 'tb-neon' }, rewardReceipts: ['purchase:charge', 'bundle:4'],
    claimed: { f: [2], p: [3] }, coins: 731, gems: 99 };
  const backup = JSON.stringify({ v: 9, owned: ['r-coral'], gems: 99 });
  let f = loadState(raw, { backup });
  assert.deepEqual(plain(f.S.owned), ['t-event', 'r-standard', 'r-pan']);
  assert.deepEqual(plain(f.S.equipped), { racket: 'r-pan' });
  const normalized = plain(f.S);
  for (let i = 0; i < 3; i++) {
    assert.equal(f.saveNow(), true);
    assert.deepEqual(JSON.parse(f.entries.get('ttu-v2')), normalized);
    assert.equal(f.entries.get('ttu-v2.bak'), backup);
    f = loadState(JSON.parse(f.entries.get('ttu-v2')), { backup });
    assert.deepEqual(plain(f.S), normalized);
  }
});

test('corrupt primary containers recover real ownership from backup rather than granting a new pan', () => {
  const backup = { v: 9, owned: ['r-coral', 'r-pan', 't-event'], equipped: { racket: 'r-pan', table: 'tb-neon' }, coins: 812, gems: 36 };
  for (const primary of ['{broken', 'null', '[]', '42', '"not-state"']) {
    const { S, entries } = loadState(null, { primary, backup: JSON.stringify(backup) });
    assert.deepEqual(plain(S.owned), ['r-standard', 'r-pan', 't-event']);
    assert.deepEqual(plain(S.equipped), { racket: 'r-pan' });
    assert.equal(S.coins, 812); assert.equal(S.gems, 36);
    assert.deepEqual(JSON.parse(entries.get('ttu-v2.bak')), backup);
  }
});

test('newer save schemas retain their version and foreign data while retired equipment is removed', () => {
  const raw = { v: 11, owned: ['r-pan', 't-event', 't-gold'], equipped: { racket: 'r-pan', table: 'tb-neon' },
    coins: 777, claimsV11: { event: 'earned' } };
  const { S, entries } = loadState(raw);
  assert.equal(S.v, 11); assert.deepEqual(plain(S.claimsV11), raw.claimsV11); assert.equal(S.coins, 777);
  assert.deepEqual(plain(S.owned), ['r-standard', 'r-pan', 't-event']);
  assert.deepEqual(plain(S.equipped), { racket: 'r-pan' });
  assert.equal(entries.has('ttu-v2.bak'), false);
});

test('v8 settings migration retains explicit mute/zero/fractions, gallery, progress and inventory', () => {
  const raw = { v: 7, sfx: false, volume: 0, rm: true, quality: 'high', diff: 3, hint: false, vibro: false, missShots: true,
    cal: { padSpeed: 100 * (1 - .84) / .36, flytime: 0, captureK: 100 },
    owned: ['r-real'], equipped: { rubber: 'r-real', blade: 'b-real' }, coins: 777, gems: 9,
    training: { version: 1, lessons: { TOPSPIN: { mastered: true, practiced: true, attempts: 7, correct: 6 } }, lastLesson: 'TOPSPIN' },
    claimed: { f: [1, 2], p: [1] }, tutorialDone: true, tutorialRewarded: true, premium: true };
  const { S, entries } = loadState(raw);
  for (const key of Object.keys(raw).filter(key => !['v', 'owned', 'equipped'].includes(key))) assert.deepEqual(JSON.parse(JSON.stringify(S[key])), raw[key], key);
  assert.deepEqual(plain(S.owned), ['r-standard', 'r-real']);
  assert.deepEqual(plain(S.equipped), { racket: 'r-standard' });
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
