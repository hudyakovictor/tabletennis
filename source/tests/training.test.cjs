const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load } = require('../game/tests/helpers.cjs');

const stateSource = fs.readFileSync(path.join(__dirname, '../src/core/state.js'), 'utf8');
const catalog = {
  version: 1,
  skills: ['tap', 'left', 'right', 'LOOP'].map(id => ({ id })),
  lessons: [{ id: 'CONTACT', skills: ['tap'] }, { id: 'PLACEMENT', skills: ['left', 'right'] }, { id: 'TOPSPIN', skills: ['LOOP'] }]
};
const plain = value => JSON.parse(JSON.stringify(value));

function loadState(raw = null, options = {}) {
  const entries = new Map([['ttu-v2', JSON.stringify(raw)]]), writes = [], timers = new Map(); let timerID = 0;
  if (Object.hasOwn(options, 'primary')) entries.set('ttu-v2', options.primary);
  if (Object.hasOwn(options, 'backup')) entries.set('ttu-v2.bak', options.backup);
  const localStorage = {
    getItem(key) { if (options.unavailable) throw new Error('storage unavailable'); return entries.get(key) ?? null; },
    setItem(key, value) { if (options.unavailable) throw new Error('storage unavailable'); writes.push({ key, value }); entries.set(key, value); },
    removeItem(key) { if (options.unavailable) throw new Error('storage unavailable'); entries.delete(key); }
  };
  const context = vm.createContext({ localStorage, structuredClone,
    setTimeout(fn, delay) { const id = ++timerID; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(stateSource + '\n;globalThis.api = { S, SAVE_VERSION, DEFAULT_STATE, repairTrainingState, applyTrainingProgress, trainingMastery, awardTrainingCompletion, save, saveNow };', context);
  return { ...context.api, context, entries, writes, timers };
}

function evidence(id, overrides = {}) {
  return { mode: 'course', id, stage: 'check', attempts: 4, correct: 3, validated: true, practicePassed: true, quizPassed: true, ...overrides };
}
function practice(id, overrides = {}) { return evidence(id, { stage: 'practice', attempts: 3, correct: 3, validated: false, quizPassed: false, ...overrides }); }
function masterAll(api, targetCatalog = catalog) {
  for (const lesson of targetCatalog.lessons) {
    assert.equal(api.applyTrainingProgress(api.S, practice(lesson.id), targetCatalog), true);
    assert.equal(api.applyTrainingProgress(api.S, evidence(lesson.id), targetCatalog), true);
  }
}

test('save version seven migrates legacy flags without inventing academy mastery or changing earned state', () => {
  const legacy = { v: 6, tutorialDone: true, tutorialRewarded: true, coins: 713, gems: 9, rating: 1420, wins: 11, losses: 5,
    level: 4, xp: 251, diff: 3, cal: { captureK: 1.12, spinGain: .93 }, hist: [{ t: 10, r: 1400 }],
    passSeason: 5, passLvl: 7, passXp: 60, premium: true, claimed: { f: [1, 2], p: [1] }, equipped: { rubber: 'r-owned', blade: 'b-owned' } };
  const api = loadState(legacy); assert.equal(api.SAVE_VERSION, 7); assert.equal(api.S.v, 7);
  for (const key of Object.keys(legacy).filter(key => key !== 'v')) assert.deepEqual(plain(api.S[key]), legacy[key], key);
  assert.deepEqual(plain(api.S.training), { version: 1, lessons: {}, lastLesson: null });
  assert.deepEqual(plain(api.trainingMastery(api.S, catalog)), { mastered: 0, total: 3, coverage: 0, courseComplete: false });
  assert.equal(api.awardTrainingCompletion(api.S, catalog), false); assert.equal(api.S.coins, 713); assert.equal(api.S.gems, 9);
  assert.deepEqual(JSON.parse(api.entries.get('ttu-v2.bak')), legacy);
  const doneOnly = loadState({ v: 6, tutorialDone: true }); assert.equal(doneOnly.trainingMastery(doneOnly.S, catalog).mastered, 0);
  assert.equal(doneOnly.awardTrainingCompletion(doneOnly.S, catalog), false); assert.notEqual(doneOnly.S.tutorialRewarded, true);
});

test('a fresh profile has empty academy evidence, and genuine saved progress survives repair and reload', () => {
  const fresh = loadState(); assert.deepEqual(plain(fresh.S.training), { version: 1, lessons: {}, lastLesson: null });
  assert.equal(fresh.S.tutorialDone, false); assert.equal(fresh.trainingMastery(fresh.S, catalog).courseComplete, false);
  const training = { version: 1, lastLesson: 'TOPSPIN', lessons: {
    CONTACT: { mastered: true, practiced: true, attempts: 7, correct: 6 }, TOPSPIN: { mastered: false, practiced: true, attempts: 5, correct: 3 }
  } };
  const api = loadState({ v: 7, training, tutorialRewarded: true }); assert.deepEqual(plain(api.S.training), training);
  api.saveNow(); const reloaded = loadState(JSON.parse(api.entries.get('ttu-v2'))); assert.deepEqual(plain(reloaded.S.training), training);
  assert.equal(reloaded.S.tutorialRewarded, true);
});

test('training repair rejects corrupt containers, inherited/prototype keys and malformed lesson IDs', () => {
  const { repairTrainingState: repair } = loadState();
  for (const raw of [null, undefined, true, 1, 'bad', [], ['CONTACT']]) assert.deepEqual(plain(repair(raw)), { version: 1, lessons: {}, lastLesson: null });
  const lessons = JSON.parse('{"__proto__":{"mastered":true},"constructor":{"mastered":true},"prototype":{"mastered":true},"toString":{"mastered":true}}');
  Object.assign(lessons, { 'bad-id': {}, lowercase: {}, '../CONTACT': {}, ['A'.repeat(49)]: {}, ARRAY: [], NIL: null, NUMBER: 1,
    CONTACT: { mastered: false, practiced: true, attempts: 3, correct: 3 } });
  Object.setPrototypeOf(lessons, { INHERITED: { mastered: true, practiced: true, attempts: 7, correct: 6 } });
  const repaired = repair({ version: 999, lessons, lastLesson: '__proto__' });
  assert.deepEqual(Object.keys(repaired.lessons), ['CONTACT']); assert.equal(repaired.lastLesson, null); assert.equal(repaired.version, 1);
  for (const id of ['__proto__', 'constructor', 'prototype', 'INHERITED']) assert.equal(Object.hasOwn(repaired.lessons, id), false);
  assert.equal({}.mastered, undefined); assert.equal(repair({ lastLesson: 'TOPSPIN' }).lastLesson, 'TOPSPIN');
  for (const lastLesson of [1, {}, [], 'bad-id', 'A'.repeat(49)]) assert.equal(repair({ lastLesson }).lastLesson, null);
});

test('repair bounds finite integer counters, keeps correct no higher than attempts, and never mutates its input', () => {
  const { repairTrainingState: repair } = loadState();
  const raw = { lessons: {
    CONTACT: { mastered: 'true', practiced: 1, attempts: -4, correct: Infinity },
    TOPSPIN: { mastered: true, practiced: true, attempts: 1000000.9, correct: 1000000 },
    PLACEMENT: { mastered: false, practiced: true, attempts: 7.9, correct: 99.9 },
    NONFINITE: { mastered: false, practiced: false, attempts: NaN, correct: '3' }
  } };
  const repaired = repair(raw); assert.equal(raw.lessons.PLACEMENT.correct, 99.9);
  assert.equal(repaired.lessons.CONTACT.mastered, false); assert.equal(repaired.lessons.CONTACT.practiced, false);
  assert.equal(repaired.lessons.CONTACT.attempts, 0); assert.equal(repaired.lessons.CONTACT.correct, 0);
  assert.equal(repaired.lessons.TOPSPIN.attempts, 100000); assert.equal(repaired.lessons.TOPSPIN.correct, 100000);
  assert.equal(repaired.lessons.PLACEMENT.attempts, 7); assert.equal(repaired.lessons.PLACEMENT.correct, 7);
  assert.equal(repaired.lessons.NONFINITE.attempts, 0); assert.equal(repaired.lessons.NONFINITE.correct, 0);
  const many = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`LESSON_${i}`, { attempts: 1, correct: 0 }]));
  assert.ok(Object.keys(repair({ lessons: many }).lessons).length <= 100);
});

test('only known course lessons with legitimate practice or complete check evidence can update progress', () => {
  const api = loadState(); const initial = plain(api.S);
  const rejected = [null, {}, evidence('UNKNOWN'), evidence('__proto__'), evidence('constructor'),
    evidence('CONTACT', { mode: 'stroke' }), evidence('CONTACT', { mode: 'accuracy' }), evidence('CONTACT', { stage: 'skip' }),
    evidence('CONTACT', { stage: 'question' }), evidence('CONTACT', { stage: 'review' }),
    evidence('CONTACT', { attempts: 3 }), evidence('CONTACT', { attempts: 5 }), evidence('CONTACT', { attempts: 4.5 }),
    evidence('CONTACT', { attempts: Infinity }), evidence('CONTACT', { attempts: 100001 }), evidence('CONTACT', { attempts: -1 }),
    evidence('CONTACT', { correct: 2 }), evidence('CONTACT', { correct: 5 }), evidence('CONTACT', { correct: 3.5 }),
    evidence('CONTACT', { correct: '3' }), evidence('CONTACT', { correct: NaN }), evidence('CONTACT', { validated: false }),
    evidence('CONTACT', { validated: 'true' }), evidence('CONTACT', { practicePassed: false }), evidence('CONTACT', { practicePassed: 1 }),
    evidence('CONTACT', { quizPassed: false }), evidence('CONTACT', { quizPassed: 'true' }),
    practice('CONTACT', { practicePassed: false }), practice('CONTACT', { correct: 2 }), practice('CONTACT', { attempts: 2 })];
  for (const message of rejected) { assert.equal(api.applyTrainingProgress(api.S, message, catalog), false, JSON.stringify(message)); assert.deepEqual(plain(api.S), initial); }
  for (const invalid of [null, {}, { ...catalog, version: 2 }, { ...catalog, lessons: {} }]) assert.equal(api.applyTrainingProgress(api.S, evidence('CONTACT'), invalid), false);
  assert.equal(api.applyTrainingProgress(api.S, practice('CONTACT', { attempts: 5 }), catalog), true);
  assert.deepEqual(plain(api.S.training.lessons.CONTACT), { practiced: true, mastered: false, attempts: 5, correct: 3 });
  assert.equal(api.applyTrainingProgress(api.S, evidence('CONTACT'), catalog), true);
  assert.equal(api.S.training.lessons.CONTACT.mastered, true); assert.equal(api.S.training.lastLesson, 'CONTACT');
  assert.equal(api.applyTrainingProgress(api.S, evidence('TOPSPIN', { correct: 4 }), catalog), true);
});

test('practice, skipped messages and forged profile flags cannot import mastery for this or other lessons', () => {
  const api = loadState(); const forged = { version: 1, lessons: Object.fromEntries(catalog.lessons.map(s => [s.id, { mastered: true, practiced: true, attempts: 7, correct: 6 }])) };
  assert.equal(api.applyTrainingProgress(api.S, practice('CONTACT', { profile: forged }), catalog), true);
  assert.equal(api.S.training.lessons.CONTACT.practiced, true); assert.equal(api.S.training.lessons.CONTACT.mastered, false);
  assert.equal(api.S.training.lessons.PLACEMENT, undefined); assert.equal(api.S.training.lessons.TOPSPIN, undefined);
  assert.equal(api.applyTrainingProgress(api.S, evidence('TOPSPIN', { stage: 'skipped', attempts: 0, correct: 0, profile: forged }), catalog), false);
  assert.equal(api.trainingMastery(api.S, catalog).mastered, 0); assert.equal(api.awardTrainingCompletion(api.S, catalog), false);
});

test('accepted progress is monotonic, bounded and detached from incoming profile objects', () => {
  const api = loadState(); masterAll(api);
  const row = plain(api.S.training.lessons.CONTACT);
  const profile = { lessons: { CONTACT: { mastered: false, practiced: false, attempts: 12, correct: 8 }, UNKNOWN: { mastered: true } } };
  assert.equal(api.applyTrainingProgress(api.S, evidence('CONTACT', { profile }), catalog), true);
  assert.deepEqual(plain(api.S.training.lessons.CONTACT), { mastered: true, practiced: true, attempts: 12, correct: 8 });
  profile.lessons.CONTACT.attempts = 99; assert.equal(api.S.training.lessons.CONTACT.attempts, 12); assert.equal(api.S.training.lessons.UNKNOWN, undefined);
  assert.equal(api.applyTrainingProgress(api.S, practice('CONTACT'), catalog), true);
  assert.equal(api.S.training.lessons.CONTACT.mastered, row.mastered); assert.equal(api.S.training.lessons.CONTACT.attempts, 12);
  const corrupt = { lessons: { CONTACT: { attempts: 1, correct: 1000000 } } };
  assert.equal(api.applyTrainingProgress(api.S, evidence('CONTACT', { profile: corrupt }), catalog), true);
  const repaired = api.S.training.lessons.CONTACT;
  assert.ok(repaired.attempts <= 100000 && repaired.correct <= repaired.attempts);
});

test('mastery measures registered skill coverage rather than lesson percentage, duplicate skills or unknown progress', () => {
  const api = loadState(); api.applyTrainingProgress(api.S, evidence('CONTACT'), catalog);
  assert.deepEqual(plain(api.trainingMastery(api.S, catalog)), { mastered: 1, total: 3, coverage: 25, courseComplete: false });
  api.applyTrainingProgress(api.S, practice('TOPSPIN'), catalog); api.S.training.lessons.UNKNOWN = { mastered: true };
  assert.equal(api.trainingMastery(api.S, catalog).coverage, 25);
  api.applyTrainingProgress(api.S, evidence('PLACEMENT'), catalog);
  const withUnknown = { ...catalog, lessons: catalog.lessons.map(s => ({ ...s, skills: [...s.skills, ...s.skills, 'UNKNOWN'] })) };
  assert.equal(api.trainingMastery(api.S, withUnknown).coverage, 75);
  api.applyTrainingProgress(api.S, evidence('TOPSPIN'), catalog);
  assert.deepEqual(plain(api.trainingMastery(api.S, catalog)), { mastered: 3, total: 3, coverage: 100, courseComplete: true });
  assert.equal(api.trainingMastery(api.S, { version: 1, skills: [], lessons: [] }).courseComplete, false);
});

test('mastery handles corrupt progress containers and does not count inherited lesson evidence', () => {
  const api = loadState();
  for (const training of [null, {}, [], { lessons: null }, { lessons: [] }, { lessons: 'bad' }]) {
    assert.deepEqual(plain(api.trainingMastery({ training }, catalog)), { mastered: 0, total: 3, coverage: 0, courseComplete: false });
  }
  const lessons = Object.create({ CONTACT: { mastered: true } });
  assert.equal(api.trainingMastery({ training: { lessons } }, catalog).mastered, 0);
});

test('the full engine data catalog determines real coverage and all-lesson completion without duplicate curriculum definitions', () => {
  const fullCatalog = load(['03_i18n.js', '64_training_data.js'], ['trainingCatalog']).trainingCatalog();
  const api = loadState(); const chosen = fullCatalog.lessons.find(s => s.skills.length > 1);
  assert.ok(chosen); api.applyTrainingProgress(api.S, evidence(chosen.id), fullCatalog);
  const known = new Set(fullCatalog.skills.map(s => s.id)); const covered = new Set(chosen.skills.filter(id => known.has(id)));
  assert.equal(api.trainingMastery(api.S, fullCatalog).coverage, Math.round(covered.size / known.size * 100));
  const final = fullCatalog.lessons.at(-1);
  for (const lesson of fullCatalog.lessons.slice(0, -1)) api.applyTrainingProgress(api.S, evidence(lesson.id), fullCatalog);
  assert.equal(api.trainingMastery(api.S, fullCatalog).courseComplete, false); assert.equal(api.awardTrainingCompletion(api.S, fullCatalog), false);
  api.applyTrainingProgress(api.S, evidence(final.id), fullCatalog);
  const result = api.trainingMastery(api.S, fullCatalog); assert.equal(result.mastered, fullCatalog.lessons.length); assert.equal(result.courseComplete, true);
  assert.equal(result.coverage, fullCatalog.coverage); assert.ok(result.coverage >= 95);
});

test('all mastered lessons synchronously grant exactly 200 coins and five gems once, preserving unrelated state', () => {
  const api = loadState({ v: 7, coins: 713, gems: 9, rating: 1420, cal: { captureK: 1.12 }, passSeason: 5, passLvl: 7, passXp: 60 });
  for (const lesson of catalog.lessons.slice(0, -1)) api.applyTrainingProgress(api.S, evidence(lesson.id), catalog);
  const before = plain(api.S); assert.equal(api.awardTrainingCompletion(api.S, catalog), false); assert.deepEqual(plain(api.S), before);
  api.applyTrainingProgress(api.S, practice('TOPSPIN'), catalog); assert.equal(api.awardTrainingCompletion(api.S, catalog), false);
  api.applyTrainingProgress(api.S, evidence('TOPSPIN'), catalog);
  const unrelated = plain(api.S); for (const key of ['coins', 'gems', 'tutorialDone', 'tutorialRewarded']) delete unrelated[key];
  assert.equal(api.awardTrainingCompletion(api.S, catalog), true);
  assert.equal(api.S.coins, 913); assert.equal(api.S.gems, 14); assert.equal(api.S.tutorialDone, true); assert.equal(api.S.tutorialRewarded, true); assert.equal(api.timers.size, 0);
  const after = plain(api.S); for (const key of ['coins', 'gems', 'tutorialDone', 'tutorialRewarded']) delete after[key]; assert.deepEqual(after, unrelated);
  assert.equal(api.awardTrainingCompletion(api.S, catalog), false); assert.equal(api.S.coins, 913); assert.equal(api.S.gems, 14);
});

test('a preserved legacy tutorial reward cannot be granted again after genuine academy mastery', () => {
  const api = loadState({ v: 6, tutorialDone: true, tutorialRewarded: true, coins: 713, gems: 9 }); masterAll(api);
  assert.equal(api.trainingMastery(api.S, catalog).courseComplete, true); assert.equal(api.awardTrainingCompletion(api.S, catalog), false);
  assert.equal(api.S.coins, 713); assert.equal(api.S.gems, 9); assert.equal(api.S.tutorialRewarded, true);
});

test('saveNow flushes progress and reward atomically, cancels debounced saves and retains the pre-migration backup', () => {
  const legacy = { v: 6, coins: 713, gems: 9, rating: 1420, passSeason: 5, passLvl: 7, passXp: 60, cal: { captureK: 1.12 } };
  const api = loadState(legacy); masterAll(api); api.save(); api.save();
  assert.equal(api.timers.size, 1); assert.equal([...api.timers.values()][0].delay, 250);
  assert.equal(api.awardTrainingCompletion(api.S, catalog), true); api.saveNow(); assert.equal(api.timers.size, 0);
  const saved = JSON.parse(api.entries.get('ttu-v2')); assert.equal(saved.v, 7); assert.equal(saved.coins, 913); assert.equal(saved.gems, 14);
  assert.equal(saved.tutorialRewarded, true); assert.equal(saved.tutorialDone, true); assert.deepEqual(saved.training, plain(api.S.training));
  assert.equal(api.writes.filter(w => w.key === 'ttu-v2').length, 1); assert.deepEqual(JSON.parse(api.entries.get('ttu-v2.bak')), legacy);
  const reload = loadState(saved, { backup: api.entries.get('ttu-v2.bak') }); assert.equal(reload.trainingMastery(reload.S, catalog).courseComplete, true);
  assert.equal(reload.awardTrainingCompletion(reload.S, catalog), false); assert.equal(reload.S.coins, 913); assert.equal(reload.S.gems, 14);
  reload.saveNow(); assert.deepEqual(JSON.parse(reload.entries.get('ttu-v2.bak')), legacy);
});

test('corrupt primary saves recover academy evidence from backup, and corrupt backups or denied storage are safe', () => {
  const valid = { v: 7, coins: 913, gems: 14, tutorialDone: true, tutorialRewarded: true,
    training: { version: 1, lastLesson: 'CONTACT', lessons: { CONTACT: { mastered: true, practiced: true, attempts: 7, correct: 6 } } } };
  const backup = JSON.stringify(valid), api = loadState(null, { primary: '{broken', backup });
  assert.equal(api.S.coins, 913); assert.deepEqual(plain(api.S.training), valid.training); api.saveNow();
  assert.deepEqual(JSON.parse(api.entries.get('ttu-v2')).training, valid.training); assert.equal(api.entries.get('ttu-v2.bak'), backup);
  const fresh = loadState(null, { primary: '{broken', backup: 'broken' }); assert.equal(fresh.trainingMastery(fresh.S, catalog).mastered, 0);
  assert.equal(fresh.S.tutorialDone, false); assert.equal(fresh.S.coins, fresh.DEFAULT_STATE.coins);
  const blocked = loadState(valid, { unavailable: true }); assert.equal(blocked.trainingMastery(blocked.S, catalog).mastered, 0); assert.doesNotThrow(() => blocked.saveNow());
});
