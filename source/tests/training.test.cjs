const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load } = require('../game/tests/helpers.cjs');
const { launchBrowser, pageFixture } = require('./shell-fixture.cjs');

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

test('the current save migrates legacy flags without inventing academy mastery or changing earned state', () => {
  const legacy = { v: 6, tutorialDone: true, tutorialRewarded: true, coins: 713, gems: 9, rating: 1420, wins: 11, losses: 5,
    level: 4, xp: 251, diff: 3, cal: { captureK: 1.12, spinGain: .93 }, hist: [{ t: 10, r: 1400 }],
    passSeason: 5, passLvl: 7, passXp: 60, premium: true, claimed: { f: [1, 2], p: [1] },
    owned: ['r-owned', 'b-owned'], equipped: { rubber: 'r-owned', blade: 'b-owned' } };
  const api = loadState(legacy); assert.ok(api.SAVE_VERSION >= 8); assert.equal(api.S.v, api.SAVE_VERSION);
  for (const key of Object.keys(legacy).filter(key => !['v', 'owned', 'equipped'].includes(key))) assert.deepEqual(plain(api.S[key]), legacy[key], key);
  assert.deepEqual(plain(api.S.owned), ['r-standard', 'r-owned', 'b-owned']);
  assert.deepEqual(plain(api.S.equipped), { racket: 'r-standard' });
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
  const saved = JSON.parse(api.entries.get('ttu-v2')); assert.equal(saved.v, api.SAVE_VERSION); assert.equal(saved.coins, 913); assert.equal(saved.gems, 14);
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

let academyBrowser;
after(async () => { if (academyBrowser) await academyBrowser.close(); });

async function academyPage(t, { width = 390, height = 844, lang = 'en', input = 'touch', training = { version: 1, lessons: {}, lastLesson: null } } = {}) {
  academyBrowser ||= await launchBrowser();
  const engine = load(['03_i18n.js', '64_training_data.js'], ['trainingCatalog', 'ET']); engine.ET.set(lang);
  const result = await pageFixture(t, academyBrowser, ['training'], { width, height, matchHUD: true, persisted: true, raw: { training } });
  await result.page.evaluate(({ catalog, lang, input }) => {
    I18n.lang = lang; GameHost.trainingCatalog = catalog; GameHost.trainingIntent = null; GameHost.trainRequestId = 0; GameHost.trainActionId = 0; GameHost.previewRequestId = 0;
    window.devBtn = () => '<button class="ib mx-dev pe" data-act="dev">Dev</button>';
    window.diagnosticsSheet = () => Sheet.open('<h2>Diagnostics</h2><p>Recorded data</p>');
    window.devZoneSheet = () => Sheet.open('<h2>Contact diagnostics</h2>');
    window.diagnosticMarkFrame = () => trace.messages.push({ type: 'diagnosticMark' });
    GameHost.send = function(type, data = {}) {
      const m = { type, ...structuredClone(data) }; let result;
      if (type === 'train') {
        result = m.requestId = ++this.trainRequestId; this.paused = false;
        this.trainingIntent = { requestId: result, data: structuredClone(data), sessionId: null };
      }
      if (type === 'trainAction' || type === 'skipStep') {
        result = m.actionId = ++this.trainActionId; m.requestId = this.trainingIntent?.requestId; m.sessionId = this.trainingIntent?.sessionId;
      }
      if (type === 'pause') this.paused = true;
      if (type === 'quit') { this.trainingIntent = null; this.paused = false; }
      trace.host.push(type); trace.messages.push(m); return result;
    };
    GameHost.show = on => { trace.host.push(on ? 'show' : 'hide'); document.body.classList.toggle('in-game', on); };
    GameHost.openPreview = options => {
      if (fixture.previewFailure) return false;
      GameHost.send('pause'); const requestId = ++GameHost.previewRequestId;
      trace.messages.push({ type: 'previewOpen', ...structuredClone(options), requestId, trainRequestId: GameHost.trainingIntent?.requestId ?? null, sessionId: GameHost.trainingIntent?.sessionId ?? null });
      return true;
    };
    GameHost.closePreview = () => trace.messages.push({ type: 'previewClose', requestId: GameHost.previewRequestId });
    fixture.inputs = [];
    const surface = document.createElement('div'); surface.id = 'academy-input-surface'; surface.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:auto';
    document.getElementById('device').append(surface);
    for (const event of ['pointerdown', 'pointermove', 'pointerup']) surface.addEventListener(event, e => fixture.inputs.push(e.type));
    const d = fixture.academy = Router.screens.train, el = document.createElement('section');
    el.className = 'screen current'; el.dataset.id = 'train'; el.innerHTML = d.render(); document.getElementById('screens').replaceChildren(el);
    Router.cur = 'train'; Router._mount('train', el); d.inputMode = input; d.updateMenu();
    fixture.snapshot = changes => {
      const intent = GameHost.trainingIntent, mode = intent.data.mode;
      const id = mode === 'course' ? intent.data.lessonId : mode === 'stroke' ? intent.data.stroke : intent.data.target;
      const lesson = (mode === 'course' ? catalog.lessons : catalog.strokes).find(l => l.id === id) || catalog.lessons[1];
      const previous = fixture.latest?.requestId === intent.requestId ? fixture.latest : {};
      return { type: 'train', requestId: intent.requestId, sessionId: 'session-' + intent.requestId, mode, id, lesson, title: lesson.title, goal: lesson.goal || lesson.title,
        phase: 'intro', stage: 'practice', done: 0, attempts: 0, need: 3, step: 0, total: catalog.lessons.length, pacing: intent.data.pacing,
        setSize: intent.data.setSize, adaptive: intent.data.adaptive, variation: intent.data.variation, helpLevel: 'guided', inputMode: d.inputMode,
        stats: { attempts: 0, hits: 0, success: 0, streak: 0, bestStreak: 0 }, attemptReplay: { available: false, attemptId: null, truncated: false }, ...previous, ...changes };
    };
    fixture.train = changes => {
      const m = fixture.latest = fixture.snapshot(changes); GameHost.trainingIntent.sessionId = m.sessionId; fixture.emitHost(m); return m;
    };
    fixture.ack = (accepted = true, overrides = {}) => {
      const command = trace.messages.findLast(m => ['trainAction', 'skipStep'].includes(m.type));
      const m = { type: 'trainActionAck', actionId: command.actionId, requestId: command.requestId, sessionId: command.sessionId, accepted, ...overrides };
      if (m.accepted === true && d.pendingAction && m.actionId === d.pendingAction.actionId && m.requestId === d.requestId && m.sessionId === d.sessionId && command.action !== 'pacing') GameHost.paused = false;
      fixture.emitHost(m);
    };
    fixture.start = () => { d.el.querySelector('.academy-selection [data-act=open]').click(); fixture.train({ phase: 'intro' }); fixture.train({ phase: 'wait' }); fixture.ack(); };
    fixture.feedback = { code: 'direction', title: 'Gesture went in the wrong direction', correction: 'Start beside the ball and move along the green arrow before releasing. Keep the same length and do not add force.',
      expected: { id: 'DRIVE', gesture: catalog.strokes.find(s => s.id === 'DRIVE').gesture }, actual: { title: 'Push', gesture: { points: [[0, 0], [0, .1]], viewport: [390, 844] } }, contact: true, legal: true };
  }, { catalog: plain(engine.trainingCatalog()), lang, input });
  await result.page.evaluate(async () => { await Promise.all(['900 17px Unb', '800 12px Man'].map(font => document.fonts.load(font))); await document.fonts.ready; });
  return result;
}

test('the first selected lesson fits without scrolling and halves mandatory learning copy in RU/EN at all target sizes', async t => {
  for (const [width, height] of [[1280, 800], [390, 844], [320, 568]]) for (const lang of ['ru', 'en']) {
    const { page, errors } = await academyPage(t, { width, height, lang });
    const result = await page.evaluate(() => {
      const d = fixture.academy, card = d.menu.querySelector('.academy-selection'), start = card.querySelector('[data-act=open]');
      const text = [], walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement;
        if (parent.closest('.academy-actions,[data-demo-status]') || !parent.getClientRects().length || getComputedStyle(parent).display === 'none') continue;
        text.push(node.nodeValue);
      }
      const copy = text.join(' ').replace(/\s+/g, ' ').trim(), box = start.getBoundingClientRect();
      return { copy, words: copy.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu).length, start: { y: box.y, bottom: box.bottom, height: box.height }, scroll: d.el.querySelector('.academy-scroll').scrollTop,
        first: d.el.querySelector('.academy-content').firstElementChild === card, chapters: d.menu.querySelectorAll('.academy-chapter').length, open: d.menu.querySelectorAll('.academy-chapter[open]').length,
        lessons: d.menu.querySelectorAll('[data-choice]').length, instructions: card.querySelectorAll('[data-instruction]').length, motions: card.querySelectorAll('.academy-gesture').length };
    });
    assert.ok(result.words <= (lang === 'ru' ? 44 : 53) / 2, JSON.stringify({ width, height, lang, ...result }));
    assert.equal(result.first, true); assert.equal(result.scroll, 0); assert.ok(result.start.height >= 44); assert.ok(result.start.bottom <= height && result.start.y >= 0);
    assert.equal(result.chapters, 8); assert.equal(result.open, 0); assert.equal(result.lessons, 44); assert.equal(result.instructions, 1); assert.equal(result.motions, 1); assert.deepEqual(errors, []);
    t.diagnostic(`${width}x${height} ${lang}: ${result.words} words; start bottom ${Math.round(result.start.bottom)}px`);
  }
});

test('new-screen defaults, set selectors and pacing stay in memory and selecting a chapter lesson never starts it', async t => {
  const { page, errors } = await academyPage(t);
  const result = await page.evaluate(() => {
    const d = fixture.academy, before = JSON.stringify(S.training); d.el.querySelector('[data-chapter=basics]').open = true;
    d.el.querySelector('[data-choice=BLOCK]').click(); const selectedOnly = !d.active && !trace.messages.some(m => m.type === 'train');
    d.el.querySelector('[data-mode=stroke]').click(); const defaults = { ...d.options };
    const selectors = [...d.el.querySelectorAll('[data-set-size]')].map(b => b.dataset.setSize);
    d.el.querySelector('.academy-options').open = true; d.el.querySelector('[data-pacing=flow]').click();
    const settingsOpen = d.el.querySelector('.academy-options').open;
    d.el.querySelector('[data-set-size="20"]').click(); d.el.querySelector('[data-option=adaptive]').click(); d.el.querySelector('[data-option=variation]').click();
    d.el.querySelector('[data-act=open]').click(); const twenty = trace.messages.findLast(m => m.type === 'train'); d.toMenu();
    d.el.querySelector('[data-mode=accuracy]').click(); d.el.querySelector('[data-set-size=unlimited]').click(); d.el.querySelector('[data-act=open]').click();
    const unlimited = trace.messages.findLast(m => m.type === 'train'); d.toMenu(); d.el.querySelector('[data-mode=course]').click(); d.el.querySelector('[data-act=open]').click();
    return { before, after: JSON.stringify(S.training), defaults, selectedOnly, selectors, settingsOpen, twenty, unlimited, course: trace.messages.findLast(m => m.type === 'train'), saves: trace.saves };
  });
  assert.deepEqual(result.defaults, { pacing: 'coach', setSize: 10, adaptive: true, variation: true }); assert.equal(result.selectedOnly, true); assert.equal(result.settingsOpen, true);
  assert.deepEqual(result.selectors, ['10', '20', 'unlimited']); assert.equal(result.twenty.setSize, 20); assert.equal(typeof result.twenty.setSize, 'number'); assert.equal(result.twenty.pacing, 'flow'); assert.equal(result.twenty.adaptive, false); assert.equal(result.twenty.variation, false);
  assert.equal(result.unlimited.mode, 'accuracy'); assert.equal(result.unlimited.setSize, null); assert.equal(result.course.mode, 'course'); assert.equal(result.course.setSize, null);
  assert.equal(result.after, result.before); assert.deepEqual(result.saves, []); assert.deepEqual(errors, []);
});

test('start, retry and explicit resume retain panels until the exact boolean applied acknowledgement', async t => {
  const { page, errors } = await academyPage(t);
  const result = await page.evaluate(() => {
    const d = fixture.academy; d.el.querySelector('[data-act=open]').click(); fixture.train({ phase: 'intro' });
    const firstAction = trace.messages.findLast(m => m.type === 'trainAction'); fixture.train({ phase: 'wait' });
    const held = d.overlay === 'intro' && !!d.pendingAction;
    for (const changes of [{ actionId: firstAction.actionId + 1 }, { requestId: firstAction.requestId + 1 }, { sessionId: 'old' }, { accepted: 'true' }]) fixture.ack(true, changes);
    const staleHeld = d.overlay === 'intro' && !!d.pendingAction; fixture.ack(); const started = d.overlay === null;
    fixture.train({ phase: 'live' }); fixture.train({ phase: 'fail', feedback: fixture.feedback, latestFeedback: fixture.feedback, attempts: 1, attemptReplay: { available: true, attemptId: 8, truncated: false } });
    d.el.querySelector('[data-act=retry]').click(); const retry = { ...d.pendingAction }; fixture.ack(false);
    const rejected = d.overlay === 'feedback' && !d.pendingAction && d.dialog.querySelector('.academy-action-status').textContent.includes('not applied');
    d.el.querySelector('[data-act=retry]').click(); fixture.ack(true, { actionId: retry.actionId }); const retryHeld = !!d.pendingAction;
    fixture.train({ phase: 'wait', feedback: null }); fixture.ack(); d.pause(); d.el.querySelector('[data-act=resume]').click();
    const resumeHeld = d.overlay === 'pause' && d.pendingAction.action === 'resume'; fixture.ack();
    return { held, staleHeld, started, firstAction, rejected, retryHeld, resumeHeld, resumed: d.overlay === null, genericResumes: trace.messages.filter(m => m.type === 'resume').length };
  });
  for (const key of ['held', 'staleHeld', 'started', 'rejected', 'retryHeld', 'resumeHeld', 'resumed']) assert.equal(result[key], true, key);
  assert.equal(result.firstAction.action, 'start'); assert.equal(result.genericResumes, 0); assert.deepEqual(errors, []);
});

test('coach errors persist with full reason, correction and comparison while flow and neutral faults need no panel', async t => {
  const { page, errors } = await academyPage(t, { width: 1280, height: 800 });
  const result = await page.evaluate(() => {
    const d = fixture.academy; fixture.start(); fixture.train({ phase: 'live' });
    fixture.train({ phase: 'fail', feedback: fixture.feedback, latestFeedback: fixture.feedback, attemptReplay: { available: true, attemptId: 1, truncated: true } });
    const persistent = d.overlay === 'feedback'; fixture.train({ phase: 'fail' });
    const correction = d.dialog.querySelector('.academy-correction'), box = d.dialog.getBoundingClientRect();
    const review = { persistent: persistent && d.overlay === 'feedback', reason: d.dialog.querySelector('.academy-reason').textContent, correction: correction.textContent,
      clamp: getComputedStyle(correction).webkitLineClamp, comparison: !!d.dialog.querySelector('[data-motion=actual]'), attempt: !!d.dialog.querySelector('[data-act=attempt]:not(:disabled)'), example: !!d.dialog.querySelector('[data-act=example]'), truncated: !!d.dialog.querySelector('.academy-replay-notice'), beside: box.x >= innerWidth / 2 };
    d.el.querySelector('[data-act=menu]').click(); d.el.querySelector('[data-pacing=flow]').click(); fixture.ack(); const pacingPaused = GameHost.paused && d.overlay === 'menu';
    d.el.querySelector('[data-act=resume]').click(); fixture.ack(); fixture.train({ phase: 'wait', feedback: null }); fixture.train({ phase: 'live' }); fixture.train({ phase: 'fail', pacing: 'flow', feedback: fixture.feedback });
    const flow = d.overlay === null; fixture.train({ phase: 'wait' }); fixture.train({ phase: 'live' }); fixture.train({ phase: 'fail', pacing: 'coach', feedback: { ...fixture.feedback, code: 'let' }, result: { neutral: true } });
    return { ...review, pacingPaused, flow, neutral: d.overlay === null, genericResumes: trace.messages.filter(m => m.type === 'resume').length };
  });
  for (const key of ['persistent', 'comparison', 'attempt', 'example', 'truncated', 'beside', 'pacingPaused', 'flow', 'neutral']) assert.equal(result[key], true, key);
  assert.match(result.reason, /wrong direction/); assert.match(result.correction, /do not add force\.$/); assert.equal(result.clamp, 'none'); assert.equal(result.genericResumes, 0); assert.deepEqual(errors, []);
});

test('nested help and retained diagnostics never resume intro, coach feedback or an explicit pause, including locale refresh', async t => {
  const { page, errors } = await academyPage(t);
  const result = await page.evaluate(() => {
    const d = fixture.academy; d.openSession(false); fixture.train({ phase: 'intro' }); d.reference(); d.returnReference(); const intro = d.overlay;
    d.el.querySelector('[data-act=start]').click(); fixture.train({ phase: 'wait' }); fixture.ack(); fixture.train({ phase: 'live' });
    fixture.train({ phase: 'fail', feedback: fixture.feedback, latestFeedback: fixture.feedback }); d.reference();
    I18n.lang = 'ru'; d.refreshLocale(); d.returnReference(); const feedback = d.overlay;
    d.el.querySelector('[data-act=menu]').click(); const diagnostics = [...d.dialog.querySelectorAll('.academy-diagnostics [data-act]')].map(b => b.dataset.act);
    d.dialog.querySelector('[data-act=diagnostics]').click(); const nested = !!Sheet.cur; Sheet.close(true); const menu = d.overlay;
    d.reference(); d.returnReference(); const back = d.overlay; d.closePanel(); d.last = { ...d.last, phase: 'live' }; d.pause(); d.reference(); d.returnReference();
    return { intro, feedback, diagnostics, nested, menu, back, pause: d.overlay, paused: GameHost.paused, genericResumes: trace.messages.filter(m => m.type === 'resume').length };
  });
  assert.equal(result.intro, 'intro'); assert.equal(result.feedback, 'feedback'); assert.equal(result.menu, 'menu'); assert.equal(result.back, 'menu'); assert.equal(result.pause, 'pause'); assert.equal(result.nested, true); assert.equal(result.paused, true);
  assert.deepEqual(result.diagnostics, ['screenshot', 'diagnostics', 'diag-mark', 'dev']); assert.equal(result.genericResumes, 0); assert.deepEqual(errors, []);
});

test('Actual and Example use separate truthfully labelled requests, stale preview close is ignored, and four check attempts gate both sources', async t => {
  const { page, errors } = await academyPage(t);
  const result = await page.evaluate(() => {
    const d = fixture.academy; fixture.start(); fixture.train({ phase: 'live' });
    fixture.train({ phase: 'fail', feedback: fixture.feedback, latestFeedback: fixture.feedback, attemptReplay: { available: true, attemptId: 42, truncated: false } });
    d.el.querySelector('[data-act=attempt]').click(); const actual = trace.messages.findLast(m => m.type === 'previewOpen'), before = JSON.stringify(S.training);
    fixture.emitHost({ type: 'preview', requestId: actual.requestId - 1, active: false }); const stale = d.previewing;
    fixture.emitHost({ type: 'preview', requestId: actual.requestId, active: false, opened: false, error: 'unsupported' });
    const fallback = d.overlay === 'feedback' && d.dialog.querySelector('[data-demo-status]').textContent.includes('unavailable');
    d.el.querySelector('[data-act=example]').click(); const example = trace.messages.findLast(m => m.type === 'previewOpen'); fixture.emitHost({ type: 'preview', requestId: example.requestId, active: false });
    d.closePanel(); fixture.train({ phase: 'intro', stage: 'check', attempts: 0 }); d.reference(); d.playDemo('attempt'); d.playDemo('example');
    const introLocked = !d.dialog.querySelector('[data-act=attempt],[data-act=example]'); d.returnReference(); d.el.querySelector('[data-act=start]').click(); fixture.train({ phase: 'wait' }); fixture.ack();
    for (let i = 1; i < 4; i++) { fixture.train({ phase: 'live' }); fixture.train({ phase: 'fail', attempts: i }); d.playDemo('attempt'); d.playDemo('example'); }
    const opensBeforeFour = trace.messages.filter(m => m.type === 'previewOpen').length;
    fixture.train({ phase: 'review', attempts: 4, checkPassed: false, attemptReplay: { available: true, attemptId: 46, truncated: false } });
    const afterFour = !!d.dialog.querySelector('[data-act=attempt]:not(:disabled)') && !!d.dialog.querySelector('[data-act=example]');
    return { actual, example, stale, fallback, introLocked, opensBeforeFour, afterFour, saved: JSON.stringify(S.training) === before, paused: GameHost.paused };
  });
  assert.equal(result.actual.source, 'attempt'); assert.equal(result.actual.attemptId, 42); assert.equal(result.actual.play, false); assert.equal(result.actual.rate, 1); assert.equal(Object.hasOwn(result.actual, 'technique'), false);
  assert.equal(result.actual.trainRequestId, 1); assert.equal(result.actual.sessionId, 'session-1'); assert.notEqual(result.actual.requestId, result.example.requestId); assert.equal(result.example.source, 'example'); assert.equal(Object.hasOwn(result.example, 'attemptId'), false);
  for (const key of ['stale', 'fallback', 'introLocked', 'afterFour', 'saved', 'paused']) assert.equal(result[key], true, key); assert.equal(result.opensBeforeFour, 2); assert.deepEqual(errors, []);
});

test('finite practice summary never leaks course mastery or rewards and repeat sends a fresh clean train with current progress', async t => {
  const mastered = { version: 1, lessons: { HIT: { mastered: true, practiced: true, attempts: 7, correct: 6 } }, lastLesson: 'HIT' };
  const { page, errors } = await academyPage(t, { training: mastered });
  const result = await page.evaluate(() => {
    const d = fixture.academy; d.el.querySelector('[data-mode=stroke]').click(); fixture.start();
    const set = { size: 10, attempted: 10, successful: 6, bestStreak: 3, errors: [{ code: 'out', count: 1, correction: 'Reduce effort' }, { code: 'direction', count: 3, correction: 'Follow the green arrow' }] };
    fixture.train({ phase: 'done', practiceSet: set, attemptReplay: { available: true, attemptId: 10, truncated: false } });
    const oldRequest = d.requestId, oldSession = d.sessionId;
    fixture.emitHost({ type: 'trainDone', requestId: oldRequest, sessionId: oldSession, mode: 'stroke', practiceSet: set, courseComplete: true, rewarded: true, mastered: 44, total: 44, coverage: 100 });
    const summary = { values: [...d.dialog.querySelectorAll('.academy-set-stats dd')].map(el => el.textContent), correction: d.dialog.querySelector('.academy-correction').textContent,
      course: !!d.dialog.querySelector('.academy-coverage,.academy-reward'), text: d.dialog.textContent };
    S.training.lessons.DRIVE = { mastered: true, practiced: true, attempts: 7, correct: 6 };
    d.el.querySelector('[data-act=restart]').click(); const repeat = trace.messages.findLast(m => m.type === 'train');
    fixture.emitHost({ type: 'trainDone', requestId: oldRequest, sessionId: oldSession, mode: 'stroke', practiceSet: set });
    fixture.emitHost({ ...fixture.latest, phase: 'intro', requestId: oldRequest, sessionId: oldSession });
    fixture.train({ phase: 'intro', attempts: 0, done: 0, practiceSet: { size: 10, attempted: 0, successful: 0, bestStreak: 0, errors: [] }, attemptReplay: { available: false, attemptId: null, truncated: false } });
    return { summary, repeat, retired: d.retired.has(`${oldRequest}:${oldSession}`), fresh: d.requestId !== oldRequest && !d.summary && !d.pendingAction && !d.previewing && d.overlay === 'intro', restartActions: trace.messages.filter(m => m.type === 'trainAction' && m.action === 'restart').length };
  });
  assert.deepEqual(result.summary.values, ['10/10', '6', '60%', '3']); assert.match(result.summary.correction, /Follow the green arrow/); assert.equal(result.summary.course, false); assert.doesNotMatch(result.summary.text, /44 of 44|Skill coverage|Course reward/);
  assert.equal(result.repeat.requestId, 2); assert.equal(result.repeat.setSize, 10); assert.equal(result.repeat.pacing, 'coach'); assert.equal(result.repeat.progress.lessons.DRIVE.mastered, true); assert.equal(result.retired, true); assert.equal(result.fresh, true); assert.equal(result.restartActions, 0); assert.deepEqual(errors, []);
});

test('GPU ready resets pending actions and replay, announces restarted check, and locale or pacing never removes its pause', async t => {
  const { page, errors } = await academyPage(t);
  const result = await page.evaluate(() => {
    const d = fixture.academy; fixture.start(); fixture.train({ phase: 'intro', stage: 'check', attempts: 0 });
    d.el.querySelector('[data-act=start]').click(); const oldAction = { ...d.pendingAction }, oldRequest = d.requestId, oldSession = d.sessionId;
    fixture.train({ phase: 'wait', attempts: 2, attemptReplay: { available: true, attemptId: 2, truncated: false } });
    GameHost.send('train', { ...d.active, resume: { stage: 'check', practicePassed: true, quizPassed: true } });
    fixture.emitHost({ type: 'ready', trainingCatalog: GameHost.trainingCatalog, recovery: { type: 'train', requestId: GameHost.trainingIntent.requestId, phase: 'intro', resetAttempts: true, replayAvailable: false } });
    const cleared = !d.pendingAction && !d.previewing && !d.last.attemptReplay && d.retired.has(`${oldRequest}:${oldSession}`);
    fixture.emitHost({ type: 'trainActionAck', ...oldAction, accepted: true }); fixture.emitHost({ type: 'trainDone', requestId: oldRequest, sessionId: oldSession, mode: 'course' });
    fixture.train({ phase: 'intro', stage: 'check', sessionId: oldSession, attempts: 0, attemptReplay: { available: false, attemptId: null, truncated: false } });
    const intro = d.overlay === 'intro' && !d.summary, notice = d.dialog.querySelector('.academy-recovery-notice').textContent;
    I18n.lang = 'ru'; d.refreshLocale(); d.reference(); d.returnReference(); const localized = d.dialog.querySelector('.academy-recovery-notice').textContent;
    d.showPanel('pause'); d.el.querySelector('[data-pacing=flow]').click(); fixture.ack();
    return { cleared, intro, notice, localized, stillNotice: d.recoveryNotice && !!d.dialog.querySelector('.academy-recovery-notice'), paused: GameHost.paused, attempts: d.last.attempts, genericResumes: trace.messages.filter(m => m.type === 'resume').length };
  });
  for (const key of ['cleared', 'intro', 'stillNotice', 'paused']) assert.equal(result[key], true, key); assert.match(result.notice, /check restarts/i); assert.match(result.localized, /Проверка начинается заново/); assert.equal(result.attempts, 0); assert.equal(result.genericResumes, 0); assert.deepEqual(errors, []);
});

test('only pause and menu remain permanent and passive mobile HUD leaves the contact region and safe-area clear', async t => {
  const { page, errors } = await academyPage(t, { width: 320, height: 568 });
  await page.evaluate(() => { document.documentElement.style.setProperty('--tgt', '44px'); document.documentElement.style.setProperty('--tgb', '34px'); fixture.start(); fixture.train({ phase: 'live' }); });
  await page.mouse.move(160, 430); await page.mouse.down(); await page.mouse.move(160, 365, { steps: 4 }); await page.mouse.up();
  const result = await page.evaluate(() => {
    const d = fixture.academy, tc = d.live.querySelector('.tc').getBoundingClientRect(), tools = d.live.querySelector('.academy-tools').getBoundingClientRect();
    return { buttons: [...d.live.querySelectorAll('button')].map(b => ({ act: b.dataset.act, width: b.getBoundingClientRect().width, height: b.getBoundingClientRect().height })), tc: { y: tc.y, bottom: tc.bottom }, tools: { y: tools.y, bottom: tools.bottom }, inputs: fixture.inputs,
      pointer: getComputedStyle(d.live.querySelector('.tc')).pointerEvents, lowerControls: [...d.live.querySelectorAll('button')].some(b => b.getBoundingClientRect().bottom > innerHeight / 2) };
  });
  assert.deepEqual(result.buttons.map(b => b.act), ['pause', 'menu']); assert.ok(result.buttons.every(b => b.width >= 44 && b.height >= 44)); assert.ok(result.tc.y >= 44 && result.tools.y >= 44); assert.ok(result.tc.bottom < 568 / 2 && result.tools.bottom < 568 / 2);
  assert.equal(result.pointer, 'none'); assert.equal(result.lowerControls, false); assert.ok(result.inputs.includes('pointerdown') && result.inputs.includes('pointermove') && result.inputs.includes('pointerup')); assert.deepEqual(errors, []);
});
