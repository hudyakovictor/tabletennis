const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const GS = { RALLY: 'RALLY', MENU: 'MENU', SERVE_READY: 'SERVE_READY', SERVE_TOSS: 'SERVE_TOSS' };
const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '40_swipe.js', '42_shot_diagnostics.js', '55_ai.js', '65_train.js'],
  ['Trainer', 'ET', 'TRAINING_VERSION', 'TRAIN_SKILLS', 'TRAIN_MODULES', 'TRAIN_STEPS', 'TRAIN_GUIDES', 'TRAIN_GUIDE_FIELDS', 'TRAIN_FEEDS', 'TRAIN_TARGETS',
    'trainingCatalog', 'trainingCoverage', 'trainingGuideView', 'trainingLessonView', 'trainingTarget', 'trainingInTarget', 'trainingTip',
    'detectInputMode', 'trainingFeedBall', 'STROKES', 'ARCH', 'V3', 'Q', 'PH', 'TAU', 'predict', 'bounceTable', 'impactRacket',
    'makeRacket', 'refineRacket', 'measureShotSpin', 'classifyStroke', 'getCaptureForgiveness', 'SwipeTracker', 'isRealStroke'],
  { GS, PHYS_DT: 1 / 600, window: { __TT_EMBED: true } });
const { Trainer, TRAIN_SKILLS, TRAIN_MODULES, TRAIN_STEPS, TRAIN_GUIDES, STROKES, V3, Q, PH, TAU } = lib;
const plain = value => JSON.parse(JSON.stringify(value));
const stepIndex = id => TRAIN_STEPS.findIndex(step => step.id === id);
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`);

function trainerFixture(options = {}) {
  const progress = [], completions = [];
  const g = {
    score: [6, 4], state: GS.RALLY, time: 0, shotId: 0, rally: 0, serveBounces: 0, netTouched: false, rallyBounces: [], marks: [],
    ball: { live: false, p: V3.new(0, 1, .9), v: V3.new(), w: V3.new(), q: Q.new(), hist: [], lastHitBy: 0 },
    career: { coins: 400, rating: 1234 }, audio: { ui() {} },
    ui: { inputMode: 'mouse', trainSync() {}, trainDone(t) { completions.push(t.summary()); },
      trainProgress(t) { progress.push({ stage: t.stage, id: t.S.id, practiced: t.practicePassed, mastered: t.checkPassed }); }, trainHide() {} },
    ai: { levelIndex: 3, pos: V3.new(), anim: {}, setLevel(n) { this.levelIndex = n; }, reset() {}, setHandicap() {}, setTrend() {} },
    aiPaddle: { pos: V3.new(), normal: V3.new(0, 0, 1) },
    cancelInput() { this.cancelled = (this.cancelled || 0) + 1; }, resetPaddle() {},
    setSlowmoAllowed(on) { this.slowmoAllowed = on; }, contactPrediction() { return { p: V3.new(0, 1, .92), t: .1 }; },
    prepServe() { this.state = GS.SERVE_READY; this.isServeBall = true; this.ball.lastHitBy = 0; this.ball.live = false; }
  };
  const t = new Trainer(g, options); g.training = t; t.begin();
  return { g, t, progress, completions };
}

function startAttempt(t) {
  if (t.phase === 'intro') assert.equal(t.action('start'), true);
  else if (t.phase === 'ok') t.update(1.01);
  else if (t.phase === 'fail') t.onPress({ accepted: false });
  assert.equal(t.phase, 'wait'); t.update(.66); assert.equal(t.phase, 'live', `feed for ${t.S.id}`);
}

// Controller fixtures use an actual racket collision and the shared flight
// predictor. Supplied HUD labels/spin are deliberately independent evidence.
function playerContact(t, options = {}) {
  const g = t.g, b = g.ball, id = options.physicalStroke || t.S.stroke;
  const serving = !!t.S.serve && t.turns === 0, quality = options.quality ?? .9;
  const p = V3.new(0, id === 'SMASH' ? 1.4 : serving ? 1.12 : 1, serving ? 1.55 : .92);
  const v = V3.new(0, serving ? -1.7 : -.5, serving ? 0 : 5), w = V3.new(serving ? 0 : 35, 0, 0);
  const zone = t.currentTarget, aim = options.aim || { x: zone ? (zone.x0 + zone.x1) / 2 : 0, z: zone ? (zone.z0 + zone.z1) / 2 : -.7 };
  let racket = lib.makeRacket(1, id, { elev: lib.ARCH[id].elev, contact: lib.ARCH[id].contact, aim, quality, isServe: serving,
    azSwing: ['HOOK', 'SERVE_SIDE'].includes(id) ? .30 : id === 'FADE' ? -.30 : 0,
    azFace: ['HOOK', 'SERVE_SIDE'].includes(id) ? -.32 : id === 'FADE' ? .32 : 0,
    vmag: options.vmag ?? (id === 'SMASH' ? 10 : id === 'LOB' ? 5 : 6) });
  racket.netClear = id === 'LOB' ? .65 : id === 'DROP' ? .035 : .12;
  racket.power = options.power ?? .35;
  const tap = options.tap ?? !!(t.S.check && t.S.check.tap);
  racket.contactInput = { p: { ...p }, v: { ...v }, w: { ...w }, gesture: {
    tap, sx: .5, sy: .7, samples: tap ? 2 : 4, dist: tap ? 0 : .28, pathLen: tap ? 0 : .3, peakSpeed: tap ? .8 : 3, releaseSpeed: tap ? .8 : 3
  } };
  racket = lib.refineRacket(p, v, w, racket, 1, quality);
  assert.ok(lib.impactRacket(v, w, racket.normal, racket.vR, quality, racket.rubber || {}), `physical ${id} contact`);
  V3.addScaled(b.p, p, racket.normal, PH.R * 1.05); V3.copy(b.v, v); V3.copy(b.w, w);
  b.live = true; b.lastHitBy = 1; b.trailGrade = options.grade || 'yellow'; g.shotId++; g.isServeBall = serving;
  const flight = lib.predict(b.p, b.v, b.w, { dt: PH.SIM_DT, maxT: 3, stopAfterBounces: serving ? 2 : 1 });
  assert.equal(flight.hitNet, false, `fixture ${id} must clear the net`); assert.equal(flight.diverged, false);
  assert.ok(flight.landed, `fixture ${id} must land`);
  assert.ok(serving ? flight.landed.z > 0 && flight.b2 && flight.b2.z < 0 : flight.landed.z < 0, `fixture ${id} must land legally`);
  const info = { stroke: STROKES[options.label || id], quality, power: racket.power, ...options.info };
  g.lastShotInfo = info;
  if (options.notify !== false) t.onPlayerHit(info, racket, p);
  return { info, racket, contactP: p, flight };
}

function landOnce(t) {
  const g = t.g, b = g.ball;
  const flight = lib.predict(b.p, b.v, b.w, { dt: PH.SIM_DT, maxT: 3, stopOnFirstBounce: true });
  assert.ok(flight.landed); assert.equal(flight.hitNet, false);
  V3.set(b.p, flight.landed.x, PH.TABLE_Y + PH.R + 1e-5, flight.landed.z);
  V3.copy(b.v, flight.endV); V3.mul(b.w, b.w, Math.exp(-flight.landed.t / PH.SPIN_DECAY_TAU));
  lib.bounceTable(b.p, b.v, b.w); g.time += flight.landed.t;
  const side = Math.sign(b.p.z); g.rallyBounces.push(side); t.onBounce(side, b.lastHitBy);
  if (g.isServeBall) g.serveBounces++;
  return flight.landed;
}
function landContact(t) { if (t.g.isServeBall) landOnce(t); return landOnce(t); }
function finishPractice(t) {
  for (let i = 0; i < 3; i++) { startAttempt(t); playerContact(t); landContact(t); }
  assert.equal(t.phase, 'question'); assert.equal(t.practicePassed, true); assert.equal(t.done, 3);
}
function enterCheck(t) { finishPractice(t); assert.equal(t.action('answer', t.S.quiz.answer), true); assert.equal(t.stage, 'check'); }

test('the independent skill registry covers the 39 lessons, eight modules and all actual strokes', () => {
  assert.equal(TRAIN_STEPS.length, 39); assert.equal(TRAIN_MODULES.length, 8);
  assert.ok(TRAIN_SKILLS.length > TRAIN_STEPS.length, 'skills are not one convenient entry per lesson');
  const skills = new Set(TRAIN_SKILLS.map(s => s.id)), modules = new Set(TRAIN_MODULES.map(m => m.id));
  const covered = new Set(TRAIN_STEPS.flatMap(s => s.skills));
  for (const collection of [TRAIN_SKILLS, TRAIN_MODULES, TRAIN_STEPS, Object.values(TRAIN_GUIDES), lib.TRAIN_TARGETS]) {
    assert.equal(new Set(collection.map(row => row.id)).size, collection.length, 'stable unique IDs');
    for (const row of collection) assert.match(row.id, /^[A-Za-z][A-Za-z0-9_]{0,47}$/);
  }
  for (const step of TRAIN_STEPS) {
    assert.ok(modules.has(step.module)); assert.ok(STROKES[step.stroke]); assert.equal(step.need, 3);
    assert.ok(step.skills.length); for (const id of step.skills) assert.ok(skills.has(id), `${step.id}: unknown skill ${id}`);
  }
  for (const id of modules) assert.ok(TRAIN_STEPS.some(step => step.module === id), `nonempty module ${id}`);
  assert.equal(Object.keys(STROKES).filter(id => !id.startsWith('SERVE_')).length, 13);
  assert.equal(Object.keys(STROKES).filter(id => id.startsWith('SERVE_')).length, 4);
  assert.deepEqual(Object.keys(TRAIN_GUIDES).sort(), Object.keys(STROKES).sort());
  for (const id of Object.keys(STROKES)) { assert.ok(skills.has(id)); assert.ok(covered.has(id)); }
  const ratio = [...skills].filter(id => covered.has(id)).length / skills.size;
  assert.ok(ratio >= .95, `real registry coverage: ${ratio}`);
  assert.equal(lib.trainingCatalog().coverage, Math.round(ratio * 100));
  const again = load(['65_train.js'], ['TRAIN_SKILLS', 'TRAIN_STEPS', 'TRAIN_MODULES']);
  for (const name of ['TRAIN_SKILLS', 'TRAIN_STEPS', 'TRAIN_MODULES']) assert.deepEqual(plain(lib[name].map(row => row.id)), plain(again[name].map(row => row.id)));
});

test('foundation contact/control comes before serving and advanced strokes, with actual tap instructions', () => {
  const first = TRAIN_STEPS[0]; assert.equal(first.module, 'basics'); assert.equal(first.serve, undefined); assert.equal(first.check.tap, true);
  for (const id of ['DRIVE', 'BLOCK']) assert.ok(stepIndex(id) >= 0 && stepIndex(id) < stepIndex('COUNTER'));
  assert.ok(stepIndex('SERVE') > 0); assert.ok(stepIndex('SMASH') > stepIndex('DRIVE'));
  lib.ET.set('en');
  try { assert.match(lib.trainingTip(first, 'touch'), /tap/i); assert.match(lib.trainingTip(first, 'mouse'), /click|tap/i); }
  finally { lib.ET.set('ru'); }
});

test('all numbered motion examples produce the advertised stroke through the actual input tracker and classifier', () => {
  for (const row of lib.trainingCatalog().strokes) {
    const points = row.gesture.points, sw = new lib.SwipeTracker(); let time = 0;
    assert.ok(points.length); assert.ok(row.gesture.duration > 0);
    assert.ok(points.some(p => Math.hypot(...p) < 1e-8), `${row.id}: motion goes through the ball`);
    sw.down(.5 + points[0][0], .5 + points[0][1], 0);
    const length = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
    for (let i = 1; i < points.length; i++) {
      time += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]) / length * row.gesture.duration / 1000;
      sw.move(.5 + points[i][0], .5 + points[i][1], time);
    }
    const metrics = sw.m, serving = row.id.startsWith('SERVE_');
    if (row.id === 'BLOCK') Object.assign(metrics, { dist: 0, releaseSpeed: .8, peakSpeed: .8, up: 1 });
    else assert.equal(lib.isRealStroke(metrics, serving), true, row.id);
    const power = Math.max(metrics.releaseSpeed, .78 * metrics.peakSpeed) / 4.2;
    const ctx = { isServe: serving, ball: { y: row.id === 'SMASH' ? 1.4 : .95, z: .92 },
      incomingTop: row.id === 'COUNTER' ? 285 : 35, ballSpeed: row.id === 'BLOCK' ? 9 : 4 };
    assert.equal(lib.classifyStroke(metrics, ctx, power).id, row.id, row.id);
  }
});

test('practice keeps the correction visible until an explicit retry without resetting earlier successes', () => {
  const { t } = trainerFixture(); startAttempt(t); playerContact(t); landContact(t);
  startAttempt(t); t.onFault(-1, 'miss');
  const counts = [t.done, t.attempts, t.stats.attempts], feedback = plain(t.snapshot().feedback);
  t.update(20); assert.equal(t.phase, 'fail'); assert.deepEqual(plain(t.snapshot().feedback), feedback);
  assert.equal(t.g.ball.live, false); assert.equal(t.action('retry'), true); assert.equal(t.phase, 'wait');
  assert.deepEqual([t.done, t.attempts, t.stats.attempts], counts);
  t.update(.66); assert.equal(t.phase, 'live'); assert.equal(t.feedback, null);
});

test('actual hand traces are copied before the tracker is cancelled, with screen aspect and the real contact origin', () => {
  const { g, t } = trainerFixture({ lessonId: 'TOPSPIN' }); startAttempt(t);
  g.swipe = new lib.SwipeTracker(); g.canvas = { getBoundingClientRect: () => ({ width: 390, height: 844 }) };
  g.project = () => ({ x: .5, y: .5, ok: true });
  g.swipe.down(.5, .65, 0); g.swipe.move(.5, .56, .04); g.swipe.move(.5, .45, .08);
  playerContact(t, { physicalStroke: 'BLOCK', tap: true }); landContact(t);
  const saved = plain(t.feedback.actual.gesture);
  assert.deepEqual(saved.viewport, [390, 844]); assert.equal(saved.points.length, 3);
  near(saved.points[0][1], .15, 'start relative to contact'); near(saved.points[2][1], -.05, 'end relative to contact');
  g.swipe.cancel(); assert.deepEqual(plain(t.snapshot().feedback.actual.gesture), saved);
  assert.equal(t.feedback.code, 'tap'); assert.match(t.feedback.correction, /не на нём/);
});

test('stroke feedback identifies tap, direction, length, pace and arc direction instead of a generic instruction', () => {
  const cases = [
    ['TOPSPIN', 'BLOCK', { tap: true }, 'tap'],
    ['TOPSPIN', 'FLICK', { up: 1, dist: .08 }, 'short'],
    ['FLICK', 'LOOP', { up: 1, dist: .28 }, 'long'],
    ['LOB', 'LOOP', { up: 1, dist: .28 }, 'fast'],
    ['TOPSPIN', 'LOB', { up: 1, dist: .28 }, 'slow'],
    ['PUSH', 'DRIVE', { up: .1, dist: .1 }, 'direction'],
    ['HOOK', 'FADE', { up: -.4, dist: .28, curl: 3 }, 'curveSide']
  ];
  try {
    for (const lang of ['ru', 'en']) {
      lib.ET.set(lang);
      for (const [lessonId, stroke, gesture, code] of cases) {
        const { t } = trainerFixture({ lessonId });
        t.lastShot = { stroke, gesture, incoming: { y: .95, z: .92, speed: 4, spin: { topRps: 6 } } };
        const feedback = t.feedbackFor('stroke');
        assert.equal(feedback.code, code, `${lang}: ${lessonId}`);
        for (const text of [feedback.title, feedback.correction, feedback.expected.title, feedback.actual.title]) {
          assert.ok(text.length); assert.doesNotMatch(text, /academy\.|undefined|\{[a-z]+\}/);
        }
        assert.equal(feedback.actual.gesture, null, 'no invented actual curve without recorded pointer samples');
      }
    }
  } finally { lib.ET.set('ru'); }
});

test('placement feedback tells which way the actual landing missed the zone', () => {
  const { t } = trainerFixture({ mode: 'accuracy', target: 'center' });
  t.currentTarget = { x0: -.3, x1: .3, z0: -1.2, z1: -.2 };
  for (const [landing, correction] of [[{ x: -.5, z: -.7 }, 'aimRight'], [{ x: .5, z: -.7 }, 'aimLeft'],
    [{ x: 0, z: -1.3 }, 'aimShort'], [{ x: 0, z: -.1 }, 'aimDeep']]) {
    t.result = { contact: true, legal: true, landing };
    const feedback = t.feedbackFor('outside');
    assert.equal(feedback.code, 'outside'); assert.equal(feedback.correction, lib.ET('academy.feedback.' + correction));
    assert.deepEqual(feedback.landing, landing); assert.deepEqual(feedback.target, t.currentTarget);
  }
});

test('miss explanations use fresh admission evidence and never treat heuristic timing labels as exact early or late measurements', () => {
  const { g, t } = trainerFixture(); g.shotJournal = { sequence: 0, latest: null }; startAttempt(t);
  g.shotJournal.latest = { id: 1, outcome: 'outside', reason: 'TIMING_LATE', pressZone: { accepted: false, reason: 'OUTSIDE_ZONE' } };
  t.onFault(-1, 'miss'); assert.equal(t.feedback.code, 'zone');
  startAttempt(t); g.shotJournal.latest = { id: 2, outcome: 'rejected', pressZone: { accepted: false, reason: 'BEFORE_BOUNCE' } };
  t.onFault(-1, 'miss'); assert.equal(t.feedback.code, 'bounce');
  startAttempt(t); g.shotJournal.latest = { id: 3, outcome: 'no_contact', reason: 'TIMING_LATE', pressZone: { accepted: true } };
  t.onFault(-1, 'miss'); assert.equal(t.feedback.code, 'miss');
  g.shotJournal.sequence = 3; startAttempt(t);
  t.onFault(-1, 'miss'); assert.equal(t.feedback.code, 'miss'); assert.equal(t.feedback.actual.gesture, null);
});

test('missing the next rally ball cannot display a contact or hand trace from the preceding successful return', () => {
  const { g, t } = trainerFixture({ lessonId: 'RALLY' }); startAttempt(t);
  playerContact(t); landContact(t); assert.equal(t.turns, 1);
  t.inputMotion = { points: [[.5, .5]], contact: [.5, .5], viewport: [390, 844], ballId: g.shotId };
  g.shotId++; g.ball.lastHitBy = -1;
  t.onFault(-1, 'miss'); assert.equal(t.result.contact, false); assert.equal(t.feedback.contact, false);
  assert.equal(t.feedback.actual.gesture, null);
});

test('all lessons and 17 guides have bilingual context, how-to, effects, advantages, use, risk and counterplay', () => {
  const ET = lib.ET;
  const ru = Object.keys(ET.dicts.ru).sort(), en = Object.keys(ET.dicts.en).sort(); assert.deepEqual(ru, en);
  const text = (value, label) => { assert.equal(typeof value, 'string', label); assert.ok(value.trim().length > 0, label); assert.doesNotMatch(value, /\b(?:academy|drill|train|hud|ui)\.[A-Za-z_]/, label); };
  for (const guide of Object.values(TRAIN_GUIDES)) for (const field of lib.TRAIN_GUIDE_FIELDS) {
    assert.ok(Object.hasOwn(ET.dicts.ru, guide[field]), `${guide.id}.${field} RU`);
    assert.ok(Object.hasOwn(ET.dicts.en, guide[field]), `${guide.id}.${field} EN`);
  }
  try {
    for (const lang of ['ru', 'en']) {
      ET.set(lang); const catalog = lib.trainingCatalog();
      for (const guide of catalog.strokes) {
        const lesson = TRAIN_STEPS.find(step => step.id === guide.lessonId);
        assert.ok(lesson && lesson.check && lesson.check.strokes.includes(guide.id), `assessable guide ${guide.id}`);
      }
      for (const module of catalog.modules) { text(module.title, module.id); text(module.description, module.id); }
      for (const row of [...catalog.skills, ...catalog.targets]) text(row.title, row.id);
      for (const view of [...catalog.lessons, ...catalog.strokes]) {
        for (const field of ['title', 'feature', 'advantage', 'when', 'risk', 'counter']) text(view[field], `${view.id}.${field}`);
        text(view.controls.touch, `${view.id}.touch`); text(view.controls.mouse, `${view.id}.mouse`);
        assert.match(view.controls.mouse, lang === 'en' ? /LMB/ : /\u041b\u041a\u041c/);
        assert.doesNotMatch(view.controls.touch, /mouse|LMB|RMB|wheel|\u043c\u044b\u0448|\u041b\u041a\u041c|\u041f\u041a\u041c/i);
        assert.ok(['tap', 'up', 'down', 'forward', 'side', 'curveLeft', 'curveRight'].includes(view.gesture.kind));
        assert.ok(['short', 'medium', 'long'].includes(view.gesture.length)); assert.ok(['soft', 'medium', 'fast'].includes(view.gesture.pace));
      }
      for (const step of TRAIN_STEPS) {
        const view = lib.trainingLessonView(step); text(view.goal, step.id); text(view.context, step.id); text(view.quiz.prompt, step.id);
        assert.ok(view.quiz.options.length >= 3); assert.equal(new Set(view.quiz.options.map(o => o.id)).size, view.quiz.options.length);
        assert.ok(step.quiz.options.includes(step.quiz.answer)); for (const option of view.quiz.options) text(option.text, `${step.id}.${option.id}`);
        for (const mode of ['touch', 'mouse']) text(lib.trainingTip(step, mode), `${step.id}.${mode}`);
      }
    }
  } finally { ET.set('ru'); }
});

test('coverage counts mastered known skills, not practice flags, unknown IDs or lesson-list traversal', () => {
  const first = TRAIN_STEPS[0], raw = { [first.id]: { practiced: true }, UNKNOWN: { mastered: true } };
  assert.equal(lib.trainingCoverage(raw).have, 0); raw[first.id].mastered = true;
  const expected = new Set(first.skills); assert.equal(lib.trainingCoverage(raw).have, expected.size);
  const all = Object.fromEntries(TRAIN_STEPS.map(s => [s.id, { mastered: true }]));
  assert.equal(lib.trainingCoverage(all).total, TRAIN_SKILLS.length); assert.ok(lib.trainingCoverage(all).percent >= 95);
  const catalog = lib.trainingCatalog(), count = TRAIN_SKILLS.length, original = TRAIN_STEPS[0].skills.length;
  catalog.lessons[0].skills.push('INVENTED'); catalog.skills.push({ id: 'INVENTED' }); catalog.strokes[0].gesture.kind = 'invalid';
  assert.equal(TRAIN_SKILLS.length, count); assert.equal(TRAIN_STEPS[0].skills.length, original);
  assert.notEqual(TRAIN_GUIDES[catalog.strokes[0].id].gesture.kind, 'invalid');
});

test('pointer detection uses the primary pointer, not viewport width or the presence of hybrid touch', () => {
  const screen = (coarse, fine, width) => ({ innerWidth: width, matchMedia: q => ({ matches: q === '(pointer: coarse)' ? coarse : q === '(pointer: fine)' ? fine : false }) });
  for (const width of [320, 640, 1920]) {
    assert.equal(lib.detectInputMode(screen(true, false, width), { maxTouchPoints: 5 }), 'touch');
    assert.equal(lib.detectInputMode(screen(false, true, width), { maxTouchPoints: 0 }), 'mouse');
    assert.equal(lib.detectInputMode(screen(false, true, width), { maxTouchPoints: 10 }), 'mouse');
  }
  assert.equal(lib.detectInputMode({}, { maxTouchPoints: 1 }), 'touch'); assert.equal(lib.detectInputMode({}, {}), 'mouse');
});

test('embedded intro requires an explicit start and clears stale input before the next ball', () => {
  const { g, t } = trainerFixture(); assert.ok(g.cancelled); t.update(5); assert.equal(t.phase, 'intro');
  t.onPress({ accepted: true }); assert.equal(t.phase, 'intro');
  const before = g.cancelled; assert.equal(t.action('start'), true); assert.ok(g.cancelled > before);
  t.update(.66); assert.equal(t.phase, 'live'); assert.equal(t.ballNo, 1);
});

test('practice freezes only the first opportunity per lesson, including retries and revisits', () => {
  const { g, t } = trainerFixture(); startAttempt(t); g.rallyBounces.push(1); t.update(.01); assert.equal(t.frozen, true);
  t.onPress({ accepted: false, reason: 'OUTSIDE_ZONE' }); assert.equal(t.frozen, true); assert.ok(t.nudge > 0);
  t.onPress({ accepted: true }); assert.equal(t.frozen, false); assert.equal(t.nudge, 0);
  playerContact(t); landContact(t); startAttempt(t); g.rallyBounces.push(1); t.update(.01); assert.equal(t.frozen, false);
  t.onFault(-1, 'miss'); startAttempt(t); g.rallyBounces.push(1); t.update(.01); assert.equal(t.frozen, false);
  t.action('restart'); startAttempt(t); g.rallyBounces.push(1); t.update(.01); assert.equal(t.frozen, false);
  t.goStep(stepIndex('DRIVE')); startAttempt(t); g.rallyBounces.push(1); t.update(.01); assert.equal(t.frozen, true);
});

test('the first falling serve can freeze once, never on ascent and never on a repeated serve', () => {
  const { g, t } = trainerFixture({ lessonId: 'SERVE' }); startAttempt(t);
  g.state = GS.SERVE_TOSS; g.ball.live = true; g.tossApex = 1.6; g.ball.p.y = 1.4; g.ball.v.y = 1;
  t.update(.01); assert.equal(t.frozen, false); g.ball.v.y = -1; t.update(.01); assert.equal(t.frozen, true);
  t.onPress({ accepted: true }); t.onLet(); startAttempt(t); g.state = GS.SERVE_TOSS; g.ball.live = true; g.ball.v.y = -1;
  t.update(.01); assert.equal(t.frozen, false);
});

test('normal-speed checks never freeze, use standard capture, and quit restores normal help and bot level', () => {
  for (const lessonId of [TRAIN_STEPS[0].id, 'SERVE', 'FINAL']) {
    const { g, t } = trainerFixture({ lessonId }); const career = plain(g.career);
    if (lessonId === 'FINAL') assert.equal(g.ai.levelIndex, 0);
    t.stage = 'check'; t.configureHelp(); assert.equal(lib.getCaptureForgiveness(), 1); assert.equal(g.slowmoAllowed, false);
    startAttempt(t); g.rallyBounces.push(1);
    if (t.S.serve) { g.state = GS.SERVE_TOSS; g.ball.live = true; g.tossApex = 1.6; g.ball.p.y = 1.4; g.ball.v.y = -1; }
    t.update(.01); assert.equal(t.guide, 'none'); assert.equal(t.frozen, false);
    t.quit(); assert.equal(lib.getCaptureForgiveness(), 1); assert.equal(g.slowmoAllowed, true); assert.equal(g.ai.levelIndex, 3);
    assert.equal(g.training, null); assert.equal(g.state, GS.MENU); assert.equal(g.ball.live, false); assert.deepEqual(plain(g.career), career);
  }
  const { g, t } = trainerFixture(); assert.ok(lib.getCaptureForgiveness() > 1); t.quit();
  assert.equal(lib.getCaptureForgiveness(), 1); assert.equal(g.slowmoAllowed, true);
});

test('a label, predicted landing or unreported physical return is not a successful training contact', () => {
  const { g, t } = trainerFixture({ lessonId: 'TOPSPIN' }); startAttempt(t);
  g.lastShotInfo = { stroke: STROKES.LOOP, topspin: 999 }; t.onBounce(-1, 1); assert.equal(t.done, 0); assert.equal(t.stats.hits, 0);
  playerContact(t, { notify: false }); landContact(t); assert.equal(t.done, 0); assert.equal(t.attempts, 0);
  playerContact(t); assert.equal(t.done, 0); assert.equal(t.phase, 'live');
  t.onBounce(-1, -1); t.onBounce(1, 1); assert.equal(t.done, 0); landContact(t); assert.equal(t.done, 1);
  const counted = [t.done, t.attempts, t.stats.success]; t.onBounce(-1, 1); t.onPlayerHit(g.lastShotInfo);
  assert.deepEqual([t.done, t.attempts, t.stats.success], counted);
});

test('spin success uses travel-relative post-impact vectors, not a forged HUD spin or classifier label', () => {
  for (const [lessonId, physicalStroke, label] of [['TOPSPIN', 'PUSH', 'LOOP'], ['PUSH', 'LOOP', 'PUSH'], ['HOOK', 'DRIVE', 'HOOK']]) {
    const { t } = trainerFixture({ lessonId }); startAttempt(t);
    playerContact(t, { physicalStroke, label, info: { topspin: 999, sidespin: 999 } }); landContact(t);
    assert.equal(t.done, 0, lessonId); assert.equal(t.result.reason, 'spin', lessonId); assert.equal(t.result.contact, true); assert.equal(t.result.legal, true);
    startAttempt(t); playerContact(t); const measured = lib.measureShotSpin(t.g.ball.w, t.g.ball.v); near(t.lastShot.spinMeasured.topRps, measured.topRps, lessonId);
    landContact(t); assert.equal(t.done, 1, lessonId);
  }
});

test('spin measurements rotate with travel and remain detached from later table-bounce changes', () => {
  const { g, t } = trainerFixture({ lessonId: 'TOPSPIN' }); startAttempt(t); playerContact(t);
  const spin = t.lastShot.spinMeasured.topRps; const outgoing = plain(t.lastShot.outgoing);
  assert.ok(spin >= 3); landContact(t); near(t.result.topspin, spin, 'captured spin'); assert.deepEqual(plain(t.lastShot.outgoing), outgoing);
  for (const [v, w] of [[V3.new(0, 0, -5), V3.new(-10 * TAU, 0, 0)], [V3.new(3, 0, -4), V3.new(-8 * TAU, 0, -6 * TAU)], [V3.new(5, 0, 0), V3.new(0, 0, -10 * TAU)]]) {
    V3.copy(g.ball.v, v); V3.copy(g.ball.w, w); t.phase = 'live'; g.shotId++;
    t.onPlayerHit({ stroke: STROKES.LOOP, quality: .9, topspin: -999 }); near(t.lastShot.spinMeasured.topRps, 10, 'travel-relative topspin');
  }
});

test('speed and lob height objectives are measured from the real flight, never from supplied labels or HUD metrics', () => {
  for (const [lessonId, physicalStroke, vmag, reason] of [['SMASH', 'BLOCK', 3, 'speed'], ['LOB', 'DRIVE', 6, 'height']]) {
    const { t } = trainerFixture({ lessonId }); startAttempt(t);
    playerContact(t, { physicalStroke, label: t.S.stroke, vmag, info: { speed: 999, apex: 999 } });
    assert.ok(t.lastShot.speed < 999); assert.ok(t.lastShot.apex < 999); landContact(t);
    assert.equal(t.done, 0, lessonId); assert.equal(t.result.reason, reason, lessonId);
  }
  const { t } = trainerFixture({ lessonId: 'SMASH' }); startAttempt(t); playerContact(t); landContact(t);
  assert.equal(t.done, 1); assert.ok(t.result.speed >= 25);
});

test('simple contact and timing lessons require their real input and contact-quality evidence', () => {
  const simple = trainerFixture().t; startAttempt(simple); playerContact(simple, { tap: false }); landContact(simple);
  assert.equal(simple.done, 0); assert.equal(simple.result.reason, 'tap');
  const timing = trainerFixture({ lessonId: 'TIMING' }).t;
  for (const options of [{ quality: .3, grade: 'green' }, { quality: .9, grade: 'red' }]) {
    startAttempt(timing); playerContact(timing, options); landContact(timing); assert.equal(timing.done, 0); assert.equal(timing.result.reason, 'timing');
  }
  startAttempt(timing); playerContact(timing, { quality: .9, grade: 'yellow' }); landContact(timing);
  assert.equal(timing.done, 1); near(timing.result.quality, .9, 'contact quality');
});

test('left/right and short targets require the actual opponent landing rather than the aim label', () => {
  const { t } = trainerFixture({ lessonId: 'AIM' }); startAttempt(t);
  const wrongX = -Math.sign(t.currentTarget.x0 + t.currentTarget.x1) * .4;
  playerContact(t, { aim: { x: wrongX, z: -.7 }, info: { aimX: -wrongX } }); landContact(t);
  assert.equal(t.done, 0); assert.equal(t.result.reason, 'outside');
  for (let i = 0; i < 2; i++) {
    startAttempt(t); const target = { ...t.currentTarget }; playerContact(t); const landing = landContact(t);
    assert.equal(lib.trainingInTarget(landing, target), true); assert.equal(t.done, i + 1);
    assert.equal(Math.sign(landing.x), i % 2 ? -1 : 1);
  }
  const drop = trainerFixture({ lessonId: 'DROP' }).t; startAttempt(drop);
  playerContact(drop, { physicalStroke: 'DRIVE', label: 'DROP', aim: { x: 0, z: -1.1 } }); landContact(drop);
  assert.equal(drop.done, 0); assert.equal(drop.result.reason, 'outside');
});

test('duplicate contact/bounce callbacks cannot advance a continuous rally', () => {
  const { g, t } = trainerFixture({ lessonId: 'RALLY' }); startAttempt(t); const shot = playerContact(t);
  t.onPlayerHit(shot.info, shot.racket, shot.contactP); assert.equal(t.stats.hits, 1, 'duplicate callback before the bounce'); landContact(t);
  assert.equal(t.phase, 'live'); assert.equal(t.turns, 1); assert.equal(t.done, 0); assert.equal(t.replyReady, true);
  const before = [t.turns, t.done, t.attempts, t.stats.hits, t.total];
  t.onBounce(-1, 1); t.onPlayerHit(shot.info, shot.racket, shot.contactP); t.onBounce(-1, 1);
  assert.deepEqual([t.turns, t.done, t.attempts, t.stats.hits, t.total], before, `shot ${g.shotId} is not a fresh return`);
});

test('rally objectives require several distinct contacted returns within one attempt', () => {
  const { t } = trainerFixture({ lessonId: 'RALLY' }); startAttempt(t);
  for (let i = 1; i <= t.S.rally.returns; i++) {
    playerContact(t); landContact(t); assert.equal(t.turns, i); assert.equal(t.ballNo, 1);
    assert.equal(t.done, i === t.S.rally.returns ? 1 : 0); assert.equal(t.attempts, i === t.S.rally.returns ? 1 : 0);
  }
});

test('three practice successes require a correct contextual quiz before any mastery check', () => {
  const { t, progress } = trainerFixture(); finishPractice(t); assert.equal(t.quizPassed, false); assert.equal(t.profile.lessons[t.S.id].mastered, false);
  assert.deepEqual(progress.map(p => [p.stage, p.mastered]), [['practice', false]]);
  const step = t.step; t.update(20); assert.equal(t.phase, 'question'); assert.equal(t.step, step);
  assert.equal(t.action('answer', 'UNKNOWN'), false);
  assert.equal(t.action('answer', t.S.quiz.options.find(id => id !== t.S.quiz.answer)), false);
  assert.equal(t.phase, 'question'); assert.equal(t.quizPassed, false); assert.equal(t.action('continue'), false);
  assert.equal(t.action('answer', t.S.quiz.answer), true); assert.equal(t.stage, 'check'); assert.equal(t.phase, 'intro');
  assert.equal(t.done, 0); assert.equal(t.attempts, 0); assert.equal(t.quizPassed, true); assert.equal(t.profile.lessons[t.S.id].mastered, false);
});

test('practice failures do not substitute for the three successful repetitions', () => {
  const { t } = trainerFixture(); startAttempt(t); t.onFault(-1, 'miss');
  for (let i = 0; i < 2; i++) { startAttempt(t); playerContact(t); landContact(t); }
  assert.equal(t.done, 2); assert.equal(t.attempts, 3); assert.equal(t.phase, 'ok'); assert.equal(t.practicePassed, false);
  startAttempt(t); playerContact(t); landContact(t); assert.equal(t.phase, 'question'); assert.equal(t.attempts, 4);
});

test('mastery requires all four check attempts with at least three correct, plus practice and quiz', async context => {
  for (const correct of [0, 1, 2, 3, 4]) await context.test(`${correct}/4 correct`, () => {
    const { t, progress } = trainerFixture(); enterCheck(t);
    for (let i = 0; i < 4; i++) {
      startAttempt(t); if (i < correct) { playerContact(t); landContact(t); } else t.onFault(-1, 'miss');
      if (i < 3) { assert.equal(t.checkPassed, false); assert.equal(t.profile.lessons[t.S.id].mastered, false); assert.notEqual(t.phase, 'review'); }
    }
    assert.equal(t.attempts, 4); assert.equal(t.done, correct); assert.equal(t.phase, 'review'); assert.equal(t.checkPassed, correct >= 3);
    assert.equal(t.profile.lessons[t.S.id].mastered, correct >= 3); assert.equal(progress.filter(p => p.mastered).length, correct >= 3 ? 1 : 0);
    const before = t.attempts; t.onBounce(-1, 1); t.onFault(-1, 'miss'); assert.equal(t.attempts, before);
  });
  for (const missing of ['practicePassed', 'quizPassed']) await context.test(`missing ${missing}`, () => {
    const { t } = trainerFixture(); t.stage = 'check'; t.practicePassed = true; t.quizPassed = true; t[missing] = false; t.configureHelp();
    for (let i = 0; i < 4; i++) { startAttempt(t); playerContact(t); landContact(t); }
    assert.equal(t.phase, 'review'); assert.equal(t.checkPassed, false); assert.equal(t.summary().mastered, 0);
  });
});

test('failed checks retry without mastery; skip and final-list traversal never complete the course', () => {
  const { t, completions } = trainerFixture(); enterCheck(t);
  for (let i = 0; i < 4; i++) { startAttempt(t); t.onFault(-1, 'miss'); }
  assert.equal(t.checkPassed, false); assert.equal(t.action('retry'), true); assert.equal(t.stage, 'check'); assert.equal(t.done, 0); assert.equal(t.attempts, 0);
  assert.equal(t.summary().courseComplete, false); t.skip();
  for (let i = t.step; i < TRAIN_STEPS.length; i++) t.skip();
  assert.equal(t.finished, true); assert.equal(t.phase, 'done'); assert.equal(t.summary().mastered, 0); assert.equal(t.summary().coverage, 0);
  assert.equal(t.summary().courseComplete, false); assert.equal(completions.length, 1); assert.equal(completions[0].courseComplete, false);
});

test('stroke and accuracy practice repeat indefinitely without course progress or a completion event', () => {
  for (const options of [{ mode: 'stroke', stroke: 'DRIVE' }, { mode: 'stroke', stroke: 'SERVE_TOP' }, { mode: 'accuracy', target: 'left' }]) {
    const { t, progress, completions } = trainerFixture(options); const id = t.S.id, step = t.step;
    for (let i = 0; i < 8; i++) { startAttempt(t); playerContact(t); landContact(t); assert.equal(t.phase, 'ok'); }
    assert.equal(t.done, 8); assert.equal(t.stats.success, 8); assert.equal(t.finished, false); assert.equal(t.S.id, id); assert.equal(t.step, step);
    assert.equal(t.summary().courseComplete, false); assert.equal(progress.length, 0); assert.equal(completions.length, 0); assert.deepEqual(plain(t.profile.lessons), {});
    t.skip(); assert.equal(t.S.id, id); t.nextStep(); assert.equal(t.S.id, id); assert.equal(t.done, 0); assert.equal(t.finished, false);
  }
  const progress = { lessons: Object.fromEntries(TRAIN_STEPS.map(step => [step.id, { mastered: true, practiced: true, attempts: 7, correct: 6 }])) };
  for (const mode of ['stroke', 'accuracy']) {
    const { t } = trainerFixture({ mode, progress }); assert.equal(t.summary().mastered, TRAIN_STEPS.length); assert.equal(t.summary().courseComplete, false);
  }
});

test('serve credit needs physical contact and both legal bounces; a let is neutral in the check', () => {
  const { g, t } = trainerFixture({ lessonId: 'SERVE' }); enterCheck(t); startAttempt(t); playerContact(t);
  t.onBounce(-1, 1); assert.equal(t.done, 0); assert.equal(t.attempts, 0);
  landOnce(t); assert.equal(t.done, 0); assert.equal(g.serveBounces, 1);
  g.netTouched = true; landOnce(t); assert.equal(t.done, 0); assert.equal(t.attempts, 0);
  const stats = plain(t.stats); t.onLet(); assert.equal(t.pending, null); assert.equal(t.frozen, false); assert.deepEqual(plain(t.stats), stats);
  assert.equal(t.checkPassed, false); startAttempt(t); playerContact(t); landContact(t); assert.equal(t.done, 1); assert.equal(t.attempts, 1);
});

test('named short/block profiles have distinct motion and contextual physical classification', () => {
  assert.equal(TRAIN_GUIDES.BLOCK.gesture.kind, 'tap'); assert.equal(TRAIN_GUIDES.PUSH.gesture.length, 'short');
  assert.equal(TRAIN_GUIDES.CHOP.gesture.length, 'long'); assert.equal(TRAIN_GUIDES.DROP.gesture.pace, 'soft');
  assert.equal(TRAIN_GUIDES.FLICK.gesture.length, 'short'); assert.equal(TRAIN_GUIDES.FLICK.gesture.pace, 'fast');
  assert.equal(TRAIN_GUIDES.LOB.gesture.pace, 'soft'); assert.equal(TRAIN_GUIDES.LOOP.gesture.pace, 'fast');
  const gesture = { right: 0, up: -.5, curl: 0, dist: .08, pathLen: .08, straightness: 1 };
  const ctx = { isServe: false, ball: { y: .95, z: .8 }, incomingTop: 0, ballSpeed: 4 };
  assert.equal(lib.classifyStroke({ ...gesture, dist: .04 }, ctx, .15).id, 'DROP');
  assert.equal(lib.classifyStroke({ ...gesture, dist: .04 }, { ...ctx, ballSpeed: 10 }, .15).id, 'BLOCK');
  assert.equal(lib.classifyStroke(gesture, ctx, .4).id, 'PUSH');
  assert.equal(lib.classifyStroke({ ...gesture, dist: .3 }, ctx, .8).id, 'CHOP');
  assert.equal(lib.classifyStroke({ ...gesture, up: .9 }, ctx, .5).id, 'FLICK');
  assert.equal(lib.classifyStroke({ ...gesture, up: .9, dist: .3 }, ctx, .2).id, 'LOB');
  assert.equal(lib.classifyStroke({ ...gesture, up: .9, dist: .3 }, ctx, .8).id, 'LOOP');
  assert.equal(lib.classifyStroke({ ...gesture, up: .9, dist: .3 }, { ...ctx, incomingTop: 285 }, .8).id, 'COUNTER');
  assert.notEqual(lib.classifyStroke({ ...gesture, up: 0, dist: .3 }, ctx, .9).id, 'SMASH');
});

test('every feed preset lands legally under full shared physics in both mirrored lanes', async context => {
  for (const [id, spec] of Object.entries(lib.TRAIN_FEEDS)) await context.test(id, () => {
    for (const varied of [false, true]) for (const displaced of [false, true]) {
      const mirrored = [];
      for (const n of [0, 1]) {
        const label = `${id}, n=${n}, varied=${varied}, displaced=${displaced}`;
        const ball = lib.trainingFeedBall(spec, n, varied, displaced); assert.ok(ball, label);
        for (const vector of [ball.p, ball.v, ball.w]) for (const value of Object.values(vector)) assert.ok(Number.isFinite(value), label);
        const result = lib.predict(ball.p, ball.v, ball.w, { dt: PH.SIM_DT, maxT: 3, stopOnFirstBounce: true });
        assert.equal(result.hitNet, false, label); assert.equal(result.diverged, false, label); assert.equal(result.bounces, 1, label);
        assert.ok(result.netCross, label); assert.ok(result.landed && result.landed.z > .03 && result.landed.z <= PH.T_HALF_LEN, label);
        assert.ok(Math.abs(result.landed.x) <= PH.T_HALF_WID, label);
        if (varied) assert.equal(Math.sign(result.landed.x), -Math.sign(ball.p.x), `both left/right placements: ${label}`);
        if (id === 'side') { assert.ok(Math.abs(lib.measureShotSpin(ball.w, ball.v).sideRps) >= 3, label); assert.notEqual(ball.w.z, 0); }
        if (id === 'high') {
          const contact = lib.predict(ball.p, ball.v, ball.w, { dt: PH.SIM_DT, maxT: 3, stopZ: Math.max(.92, result.landed.z + .08), stopAtPlane: true });
          assert.ok(contact.bounces >= 1 && contact.reach, `a legal bounce before smash contact: ${label}`);
          assert.ok(contact.reach.y > PH.NET_TOP + .14, `post-bounce high contact: ${label}`);
          const gesture = { right: 0, up: 0, curl: 0, dist: .3, pathLen: .3, straightness: 1 };
          assert.equal(lib.classifyStroke(gesture, { isServe: false, ball: contact.reach, incomingTop: 0, ballSpeed: 4 }, .9).id, 'SMASH', label);
        }
        mirrored.push(result.landed);
      }
      near(mirrored[0].x, -mirrored[1].x, `${id} mirrored landing`); near(mirrored[0].z, mirrored[1].z, `${id} equal depth`);
    }
  });
});
