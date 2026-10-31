const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const GS = { MENU: 'MENU', RALLY: 'RALLY', SERVE_READY: 'SERVE_READY', SERVE_TOSS: 'SERVE_TOSS' };
let randomCalls = 0;
const math = Object.create(Math);
math.random = () => { randomCalls++; throw new Error('training consumed simulation randomness'); };
const lib = load(['10_math.js', '30_physics.js', '40_swipe.js', '42_shot_diagnostics.js', '65_train.js', '84_racket.js'],
  ['Trainer', 'TRAIN_STEPS', 'TRAIN_GUIDES', 'TRAIN_FEEDS', 'TRAIN_SKILLS', 'STROKES', 'SwipeTracker', 'V3', 'Q', 'PH', 'TAU', 'ET',
    'trainingCatalog', 'trainingCoverage', 'trainingLessonView', 'trainingGestureModel', 'trainingDiagram', 'trainingFeedBall',
    'trainingExecutedTechnique', 'tapStrokeMetrics', 'deriveStroke', 'refineRacket', 'resolveRacketLaunch', 'racketForStroke',
    'strokeIdentityMatches', 'measureShotSpin', 'predict', 'bounceTable', 'integrateBall', 'Equipment', 'BLADES', 'RUBBERS', 'SERVE_WARM'],
  { GS, window: { __TT_EMBED: true }, Math: math });
const { V3, Q, PH, TAU } = lib;
const plain = x => JSON.parse(JSON.stringify(x));
const copyBall = b => ({ p: { ...b.p }, v: { ...b.v }, w: { ...b.w } });
const NEW_IDS = ['BANANA', 'CHOP_BLOCK', 'SERVE_NO_SPIN', 'SERVE_SIDE_TOP', 'SERVE_SIDE_BACK'];

function fixture(options = {}) {
  const progress = [], phases = [];
  const g = { time: 123, state: GS.RALLY, shotId: 0, rallyBounces: [], marks: [], serveBounces: 0, netTouched: false,
    settings: { hint: options.hint !== false, hand: options.hand || 'right', grip: options.grip || 'shakehand' },
    ball: { p: V3.new(), v: V3.new(), w: V3.new(), q: Q.new(), hist: [], live: false, lastHitBy: 0 },
    swipe: new lib.SwipeTracker(), audio: { ui() {} },
    ai: { levelIndex: 1, pos: V3.new(), anim: {}, reset() {}, setLevel(n) { this.levelIndex = n; }, setHandicap() {} },
    aiPaddle: { pos: V3.new(), normal: V3.new(0, 0, 1) },
    canvas: { getBoundingClientRect: () => ({ width: 390, height: 844 }) },
    project: () => ({ x: .5, y: .5, ok: true }), contactPrediction: () => ({ p: V3.new(0, 1, .92), t: 1 }),
    cancelInput() { this.swipe.cancel(); }, setSlowmoAllowed() {},
    prepServe() { this.shotId++; this.state = GS.SERVE_READY; this.isServeBall = true; this.ball.live = false; this.ball.lastHitBy = 0; },
    ui: { inputMode: 'mouse', trainSync(t) { phases.push(t.phase); },
      trainProgress(t) { progress.push(plain(t.profile.lessons[t.S.id])); }, trainHide() {} },
    applyHit(side, racket, p, quality, info) {
      this.reply = { side, racket, contact: { ...p }, quality, info, ball: copyBall(this.ball) };
      this.shotId++; this.ball.lastHitBy = side; this.rallyBounces.length = 0;
    } };
  const t = new lib.Trainer(g, options); g.training = t; t.begin();
  return { g, t, progress, phases };
}

function start(t) {
  if (t.phase === 'intro') assert.equal(t.action('start'), true);
  else if (t.phase === 'ok') t.update(1.01, .35);
  else if (t.phase === 'fail') t.update(1.51, .35);
  if (t.phase === 'wait') t.update(.66, .23);
  assert.equal(t.phase, 'live');
}

function gestureAtContact(g, model, serving) {
  const ps = model.points, mirror = g.settings.hand === 'left' ? -1 : 1;
  const distance = ps.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - ps[i][0], p[1] - ps[i][1]), 0);
  let time = 0;
  g.swipe.down(.5 + mirror * ps[0][0], .5 + ps[0][1], 0);
  for (let i = 1; i <= model.contactIndex; i++) {
    time += Math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1]) / distance * model.duration / 1000;
    g.swipe.move(.5 + mirror * ps[i][0], .5 + ps[i][1], time);
  }
  if (model.kind === 'tap') {
    g.swipe.up(.5, .5, model.duration / 1000);
    return lib.tapStrokeMetrics(g.swipe.m, .5, .5, serving);
  }
  return { ...g.swipe.m };
}

function contact(t, options = {}) {
  const g = t.g, serving = !!t.S.serve && t.turns === 0;
  const id = options.stroke || t.S.stroke, banana = id === 'BANANA', cut = id === 'CHOP_BLOCK';
  const model = options.gesture ? lib.trainingGestureModel(options.gesture, id) : lib.trainingLessonView(t.S).gesture;
  const m = gestureAtContact(g, model, serving);
  const p = V3.new(banana ? g.settings.hand === 'left' ? .35 : -.35 : 0, serving ? 1.12 : .95, serving ? 1.55 : .92);
  const v = V3.new(0, serving ? -1.7 : -.5, serving ? 0 : cut ? 9 : 5), w = V3.new(serving ? 0 : cut ? 285 : 35, 0, 0);
  const context = { side: 1, isServe: serving, ball: p, ballVelocity: v, ballSpin: w, ballSpeed: V3.len(v),
    forehand: !banana, hand: g.settings.hand, grip: g.settings.grip, equip: options.equip };
  let racket = lib.deriveStroke(m, context);
  racket.quality = .9; racket.aim = { x: 0, z: -.68 };
  racket.contactInput = { p: { ...p }, v: { ...v }, w: { ...w }, gesture: { ...m }, context: { forehand: !banana } };
  racket = lib.refineRacket(p, v, w, racket, 1, .9);
  const launch = lib.resolveRacketLaunch({ p, v, w }, racket, {});
  assert.ok(launch, id); assert.notEqual(racket.valid, false, id);
  assert.equal(lib.strokeIdentityMatches(racket, launch), true, id);
  const flight = lib.predict(launch.p, launch.v, launch.w, { dt: PH.SIM_DT, maxT: 3, stopAfterBounces: serving ? 2 : 1 });
  assert.equal(flight.hitNet, false, id);
  assert.ok(serving ? flight.landed && flight.landed.z > 0 && flight.b2 && flight.b2.z < 0 : flight.landed && flight.landed.z < 0, id);
  V3.copy(g.ball.p, launch.p); V3.copy(g.ball.v, launch.v); V3.copy(g.ball.w, launch.w);
  g.ball.live = true; g.ball.lastHitBy = 1; g.ball.trailGrade = 'yellow'; g.shotId++; g.isServeBall = serving;
  t.onPlayerHit({ stroke: lib.STROKES[options.label || racket.stroke.id], technique: options.claimTechnique,
    quality: .9, topspin: 999, sidespin: 999 }, racket, p);
  return { racket, launch, flight };
}

function bounce(t) {
  const b = t.g.ball, r = lib.predict(b.p, b.v, b.w, { dt: PH.SIM_DT, maxT: 3, stopOnFirstBounce: true });
  assert.ok(r.landed); assert.equal(r.hitNet, false);
  V3.set(b.p, r.landed.x, PH.TABLE_Y + PH.R + 1e-5, r.landed.z); V3.copy(b.v, r.endV);
  V3.mul(b.w, b.w, Math.exp(-r.endT / PH.SPIN_DECAY_TAU)); lib.bounceTable(b.p, b.v, b.w);
  const side = Math.sign(b.p.z); t.g.rallyBounces.push(side); t.onBounce(side, b.lastHitBy);
  if (t.g.isServeBall) t.g.serveBounces++;
}
function land(t) { if (t.g.isServeBall) bounce(t); bounce(t); }

test('old version-one lesson IDs, mastery and lastLesson survive the five additive lessons', () => {
  const legacy = lib.TRAIN_STEPS.filter(s => !NEW_IDS.includes(s.id)); assert.equal(legacy.length, 39);
  const lessons = Object.fromEntries(legacy.map(s => [s.id, { mastered: true, practiced: true, attempts: 7, correct: 6 }]));
  const { t } = fixture({ progress: { version: 1, lastLesson: 'PUSH', lessons } });
  assert.equal(t.profile.version, 1); assert.equal(lib.trainingCatalog().version, 1); assert.equal(t.S.id, 'PUSH');
  for (const s of legacy) assert.deepEqual(plain(t.profile.lessons[s.id]), lessons[s.id], s.id);
  for (const id of NEW_IDS) assert.equal(t.profile.lessons[id], undefined, id);
  assert.equal(t.summary().mastered, 39); assert.equal(lib.trainingCoverage(t.profile.lessons).have, 49);
  assert.equal(lib.trainingCoverage(t.profile.lessons).total, 54); assert.equal(t.summary().courseComplete, false);
});

test('all five additions pass real prefix contacts, three practice successes, quiz and four checks', async ctx => {
  for (const id of NEW_IDS) await ctx.test(id, () => {
    const { t, progress } = fixture({ lessonId: id });
    for (let i = 0; i < 3; i++) { start(t); contact(t); land(t); }
    assert.equal(t.phase, 'question'); assert.equal(t.practicePassed, true); assert.equal(t.profile.lessons[id].mastered, false);
    assert.equal(t.action('answer', t.S.quiz.answer), true); assert.equal(t.stage, 'check');
    for (let i = 0; i < 4; i++) { start(t); contact(t); land(t); }
    assert.equal(t.phase, 'review'); assert.equal(t.done, 4); assert.equal(t.attempts, 4); assert.equal(t.checkPassed, true);
    assert.deepEqual(plain(t.profile.lessons[id]), { mastered: true, practiced: true, attempts: 7, correct: 7 });
    assert.equal(progress.length, 2); t.progress(true, true); t.progress(true, true); assert.equal(progress.length, 2);
    const before = plain(t.profile); t.onFault(-1, 'miss'); t.onBounce(-1, 1); assert.deepEqual(plain(t.profile), before);
  });
});

test('mixed serve objectives require simultaneous measured components and ignore a forged technique', () => {
  for (const id of ['SERVE_SIDE_TOP', 'SERVE_SIDE_BACK']) {
    for (const actual of ['SERVE_SIDE', id === 'SERVE_SIDE_TOP' ? 'SERVE_SIDE_BACK' : 'SERVE_SIDE_TOP']) {
      const { t } = fixture({ lessonId: id }); start(t);
      const gesture = actual === 'SERVE_SIDE' ? { kind: 'side', length: 'medium', pace: 'medium' } : lib.TRAIN_GUIDES[actual].gesture;
      contact(t, { gesture, claimTechnique: id }); land(t);
      assert.equal(t.done, 0); assert.equal(t.result.reason, 'spin');
      assert.equal(t.lastShot.technique, actual); assert.notEqual(t.lastShot.technique, id);
    }
  }
});

test('an untyped or variant-labelled callback cannot forge a reported physical contact', () => {
  for (const stroke of [undefined, { id: 'SERVE_SIDE_TOP' }]) {
    const { g, t } = fixture(); start(t); g.shotId++; g.ball.lastHitBy = 1;
    t.onPlayerHit({ stroke: lib.STROKES.DRIVE, quality: 1, topspin: 999 }, { stroke }, g.ball.p);
    t.onBounce(-1, 1);
    assert.equal(t.lastShot, null); assert.equal(t.pending, null); assert.equal(t.stats.hits, 0); assert.equal(t.done, 0);
  }
});

test('serve variation distinguishes actual side-top and side-back, not just the shared stroke ID', () => {
  const { t } = fixture({ lessonId: 'SERVE_VARIATION' });
  for (const [id, expected] of [['SERVE_SIDE_TOP', 1], ['SERVE_SIDE_BACK', 2], ['SERVE_SIDE_BACK', 2]]) {
    start(t); contact(t, { gesture: lib.TRAIN_GUIDES[id].gesture, claimTechnique: 'SERVE_SIDE_TOP' }); land(t);
    assert.equal(t.lastShot.stroke, 'SERVE_SIDE'); assert.equal(t.lastShot.technique, id); assert.equal(t.done, expected);
  }
  assert.equal(t.result.reason, 'vary'); assert.equal(t.attempts, 3);
});

test('no-spin checks the full initial modulus, including corkspin, and not the spin after a bounce', () => {
  const { t } = fixture({ lessonId: 'SERVE_NO_SPIN' }); start(t); contact(t);
  const shot = t.lastShot; assert.ok(shot.spinMeasured.totalRps < 1);
  for (const spin of [{ totalRps: 1, topRps: 0, sideRps: 0, corkRps: 1 },
    { totalRps: 1.2, topRps: 0, sideRps: 1.2, corkRps: 0 }]) assert.equal(t.criterion({ ...shot, spinMeasured: spin }), 'spin');
  assert.equal(t.criterion({ ...shot, gesture: { tap: true, serveTap: false } }), 'tap');
  bounce(t); assert.ok(V3.len(t.g.ball.w) / TAU > 1, 'the table really adds spin');
  assert.ok(t.lastShot.spinMeasured.totalRps < 1, 'impact evidence remains detached');
  bounce(t); assert.equal(t.done, 1);
});

test('new context criteria reject missing evidence, wrong side, high contact or insufficient incoming pace/spin', () => {
  const banana = fixture({ lessonId: 'BANANA' }).t; start(banana); contact(banana);
  const b = banana.lastShot; assert.equal(banana.criterion(b), null);
  for (const incoming of [null, { ...b.incoming, forehand: true }, { ...b.incoming, x: PH.T_HALF_WID + .01 },
    { ...b.incoming, y: PH.TABLE_Y + .28 }, { ...b.incoming, z: PH.T_HALF_LEN }]) assert.equal(banana.criterion({ ...b, incoming }), 'context');
  const cut = fixture({ lessonId: 'CHOP_BLOCK' }).t; start(cut); contact(cut);
  const c = cut.lastShot; assert.equal(cut.criterion(c), null);
  for (const incoming of [{ ...c.incoming, speed: 6.99 }, { ...c.incoming, spin: { topRps: 220 / TAU } },
    { ...c.incoming, spin: { topRps: -50 } }]) assert.equal(cut.criterion({ ...c, incoming }), 'context');
});

test('new contacts retain their measured identity across both hands, both grips and real equipment', () => {
  const builds = [new lib.Equipment(), new lib.Equipment(lib.BLADES.at(-1).id, lib.RUBBERS.at(-1).id, lib.RUBBERS[1].id)];
  for (const id of NEW_IDS) for (const hand of ['right', 'left']) for (const grip of ['shakehand', 'penhold']) {
    const { t } = fixture({ lessonId: id, hand, grip }); start(t);
    const equip = builds[hand === 'right' ? 0 : 1].forSide(id === 'BANANA' ? -1 : 1);
    const { racket, launch } = contact(t, { equip });
    assert.equal(lib.strokeIdentityMatches(racket, launch), true, `${id} ${hand} ${grip}`);
    assert.equal(t.criterion(t.lastShot), null, `${id} ${hand} ${grip}`);
  }
});

test('live exercise deadlines use simulation time at 0.35, 1 and 1.25 pace and 30, 60, 120 FPS', () => {
  for (const pace of [.35, 1, 1.25]) for (const fps of [30, 60, 120]) {
    const { g, t } = fixture({ mode: 'accuracy', hint: false }); start(t);
    const frames = Math.floor(9.9 / pace * fps);
    for (let i = 0; i < frames; i++) t.update(1 / fps, pace / fps);
    assert.equal(t.phase, 'live', `${pace} ${fps}`); assert.equal(t.attempts, 0); assert.equal(g.time, 123);
    t.update(.3 / pace, .3); assert.equal(t.phase, 'fail'); assert.equal(t.attempts, 1);
    const ballNo = t.ballNo; t.update(1.49, 1.49 * pace); assert.equal(t.phase, 'fail');
    t.update(.02, .02 * pace); assert.equal(t.phase, 'live'); assert.equal(t.ballNo, ballNo + 1); assert.equal(t.attempts, 1);
  }
});

test('feeder launch failure, feeder point fault and let auto-retry without pupil error counters', () => {
  for (const reason of ['launch', 'feeder', 'let']) {
    const { t } = fixture({ lessonId: reason === 'let' ? 'SERVE' : 'RALLY' });
    if (reason === 'launch') t.custom = { ...t.S, feed: { speed: .01, top: 0, depth: .62, clear: 5 } };
    if (reason === 'launch') { t.action('start'); t.update(.66); } else {
      start(t); if (reason === 'let') t.onLet(); else t.onFault(1, 'feeder');
    }
    assert.equal(t.phase, 'fail'); assert.equal(t.feedback.neutral, true);
    const before = [t.attempts, t.done, t.fails, t.stats.attempts, t.stats.streak], no = t.ballNo;
    t.update(1.51, .53); assert.equal(t.ballNo, no + 1);
    assert.deepEqual([t.attempts, t.done, t.fails, t.stats.attempts, t.stats.streak], before);
    assert.equal(t.latestFeedback.neutral, true); assert.notEqual(t.phase, 'review');
  }
});

test('explicit hint off never freezes or silently re-enables after repeated misses', () => {
  const { g, t } = fixture({ hint: false });
  g.contactPrediction = () => ({ p: V3.new(0, 1, .92), t: .01 });
  for (let i = 0; i < 5; i++) {
    start(t); g.rallyBounces.push(1); t.update(.01); assert.equal(t.guide, 'none'); assert.equal(t.frozen, false);
    t.onFault(-1, 'miss'); assert.equal(g.settings.hint, false);
  }
});

test('a missed new rally ball cannot reuse old active tracker samples, but a fresh gesture is retained', () => {
  for (const fresh of [false, true]) {
    const { g, t } = fixture({ lessonId: 'RALLY' }); start(t); contact(t); land(t);
    g.shotId++; g.ball.lastHitBy = -1;
    if (fresh) { g.swipe.down(.5, .65, 1); g.swipe.move(.5, .57, 1.04); }
    t.update(.01); t.onFault(-1, 'miss');
    assert.equal(t.result.contact, false); assert.equal(t.feedback.actual.id, null);
    assert.equal(!!t.feedback.actual.gesture, fresh); assert.equal(g.swipe.samples.length, 0);
  }
});

test('reply eligibility and the executed clone launch follow simulation time, never g.time', () => {
  const { g, t } = fixture({ lessonId: 'RALLY' }); start(t); contact(t); land(t);
  assert.equal(t.replyReady, true); g.time += 1000; assert.equal(t.tryReply(), false);
  for (let i = 0; i < 60; i++) lib.integrateBall(g.ball.p, g.ball.v, g.ball.w, PH.SIM_DT);
  const before = copyBall(g.ball); t.update(.3, .1);
  assert.equal(t.tryReply(), true); assert.equal(g.reply.side, -1); assert.equal(g.reply.racket.stroke.id, 'DRIVE');
  const expected = lib.resolveRacketLaunch(before, g.reply.racket, {});
  assert.deepEqual(plain(g.reply.ball), plain({ p: expected.p, v: expected.v, w: expected.w }));
  const no = t.ballNo; t.quit(); t.update(100, 100); assert.equal(t.ballNo, no); assert.equal(g.training, null);
});

test('locale repaint retains physical facts, latest feedback, quiz state, timers and diagram references', () => {
  const lang = lib.ET.lang();
  try {
    lib.ET.set('ru');
    const { g, t } = fixture({ lessonId: 'SERVE_SIDE_TOP' }); start(t);
    contact(t, { gesture: lib.TRAIN_GUIDES.SERVE_SIDE_BACK.gesture }); land(t);
    const feedback = t.feedback, title = feedback.title, motion = feedback.actual.gesture;
    const expected = feedback.expected.gesture, diagram = t.snapshot().diagram, result = t.result;
    const state = () => ({ ball: copyBall(g.ball), phase: t.phase, stage: t.stage, done: t.done, attempts: t.attempts,
      time: g.time, t: t.t, simTime: t.simTime, profile: plain(t.profile), stats: { ...t.stats } });
    const before = state();
    lib.ET.set('en'); t.localize();
    assert.notEqual(feedback.title, title); assert.equal(feedback.expected.title, 'Side-topspin serve');
    assert.equal(feedback.actual.technique, 'SERVE_SIDE_BACK'); assert.equal(feedback.actual.title, 'Side-backspin serve');
    assert.equal(t.feedbackText, t.msg); assert.equal(feedback.actual.gesture, motion); assert.equal(feedback.expected.gesture, expected);
    assert.equal(t.diagram, diagram); assert.equal(t.result, result); assert.deepEqual(state(), before);
    t.update(1.51, .53); assert.equal(t.feedback, null); assert.equal(t.lastShot, null);
    const next = state(); lib.ET.set('ru'); t.localize();
    assert.equal(t.latestFeedback, feedback); assert.equal(t.latestFeedback.title, title); assert.equal(t.feedbackText, '');
    assert.equal(t.latestFeedback.actual.gesture, motion); assert.deepEqual(state(), next);

    const q = fixture({ lessonId: 'BANANA' }).t;
    for (let i = 0; i < 3; i++) { start(q); contact(q); land(q); }
    q.action('answer', q.S.quiz.options.find(id => id !== q.S.quiz.answer));
    const counts = [q.done, q.attempts, q.t, q.simTime]; assert.equal(q.phase, 'question');
    lib.ET.set('en'); q.localize();
    assert.equal(q.msg, lib.ET('academy.wrongChoice')); assert.equal(q.quizPassed, false);
    assert.equal(q.snapshot().quiz.prompt, lib.ET(q.S.quiz.prompt)); assert.deepEqual([q.done, q.attempts, q.t, q.simTime], counts);
    assert.equal(q.action('answer', q.S.quiz.answer), true); lib.ET.set('ru'); q.localize();
    assert.equal(q.msg, lib.ET('academy.checkReady')); assert.equal(q.phase, 'intro'); assert.equal(q.stage, 'check');
  } finally { lib.ET.set(lang); }
});

test('all 22 diagrams use isolated shared launch physics and cached snapshots do not consume randomness', () => {
  const warm = plain(Array.from(lib.SERVE_WARM));
  for (const [id, row] of Object.entries(lib.TRAIN_GUIDES)) {
    const diagram = lib.trainingDiagram(row.stroke, null, lib.TRAIN_FEEDS.normal, null, id, row.gesture);
    assert.ok(diagram, id); assert.equal(diagram.stroke, row.stroke); assert.equal(diagram.technique, id);
    assert.deepEqual(Array.from(diagram.recommended[0]), Object.values(diagram.launch.p), id);
    assert.deepEqual(plain(diagram.spin), plain(lib.measureShotSpin(diagram.launch.w, diagram.launch.v)), id);
    if (id === 'LOB') assert.ok(Math.max(...diagram.recommended.map(p => p[1])) >= 1.3);
  }
  const { g, t } = fixture({ lessonId: 'SERVE_SIDE_TOP' }), before = copyBall(g.ball), profile = plain(t.profile);
  const a = t.snapshot(), b = t.snapshot(); assert.equal(a.diagram, b.diagram);
  assert.deepEqual(copyBall(g.ball), before); assert.deepEqual(plain(t.profile), profile); assert.equal(g.time, 123);
  assert.deepEqual(plain(Array.from(lib.SERVE_WARM)), warm, 'a diagram cannot change the live serve solver warm starts');
  assert.equal(t.attempts, 0); assert.equal(randomCalls, 0);
});

test('an impossible diagram is cached as absent instead of rerunning physics on every snapshot', () => {
  const { g, t } = fixture({ lessonId: 'BANANA' }), faces = [];
  g.equip = { forSide: side => { faces.push(side); return { e: .8, mu: 0, et: .5, damp: 1 }; } };
  assert.equal(t.snapshot().diagram, null); assert.equal(t.diagram, false);
  assert.equal(t.snapshot().diagram, null); assert.equal(t.diagram, false);
  assert.deepEqual(faces, [-1], 'the backhand example must use the back face, and only once');
});

test('diagram labels cannot claim an unexecuted mixed sign or an unknown physical ID', () => {
  assert.equal(lib.trainingDiagram('SERVE_SIDE', null, null, null, 'SERVE_SIDE_TOP', lib.TRAIN_GUIDES.SERVE_SIDE_BACK.gesture), null);
  assert.equal(lib.trainingDiagram('SERVE_SIDE', null, null, null, 'SERVE_SIDE_BACK', lib.TRAIN_GUIDES.SERVE_SIDE_TOP.gesture), null);
  assert.equal(lib.trainingDiagram('SERVE_SIDE', null, null, null, 'SERVE_SIDE_TOP', { kind: 'side', verticalBrush: 0 }), null);
  assert.equal(lib.trainingDiagram('unknown'), null);
  assert.equal(lib.trainingDiagram('SERVE_TOP', null, null, null, 'SERVE_SIDE_TOP'), null);
});

test('the dedicated chop-block feed reaches a legal low fast topspin contact; banana feed stays in natural backhand', () => {
  assert.equal(lib.trainingLessonView(lib.TRAIN_STEPS.find(s => s.id === 'BANANA')).feed, 'short');
  assert.equal(lib.trainingLessonView(lib.TRAIN_STEPS.find(s => s.id === 'CHOP_BLOCK')).feed, 'chopBlock');
  const cut = fixture({ lessonId: 'CHOP_BLOCK' }); start(cut.t);
  assert.equal(cut.g.ball.w.x, lib.TRAIN_FEEDS.chopBlock.top); assert.equal(cut.g.ball.p.y, lib.TRAIN_FEEDS.chopBlock.y0);
  for (const n of [0, 1]) for (const varied of [false, true]) {
    const a = lib.trainingFeedBall(lib.TRAIN_FEEDS.chopBlock, n, varied);
    const first = lib.predict(a.p, a.v, a.w, { dt: PH.SIM_DT, maxT: 3, stopOnFirstBounce: true });
    const p = V3.new(first.landed.x, PH.TABLE_Y + PH.R + 1e-5, first.landed.z), v = V3.clone(first.endV);
    const w = V3.mul(V3.new(), a.w, Math.exp(-first.endT / PH.SPIN_DECAY_TAU)); lib.bounceTable(p, v, w);
    const reach = lib.predict(p, v, w, { dt: PH.SIM_DT, maxT: 3, stopZ: .92, stopAtPlane: true });
    V3.mul(w, w, Math.exp(-reach.endT / PH.SPIN_DECAY_TAU));
    assert.ok(reach.reach && !reach.hitNet && reach.bounces === 0);
    assert.ok(reach.reach.y - PH.TABLE_Y < .28); assert.ok(V3.len(reach.endV) >= 7);
    assert.ok(lib.measureShotSpin(w, reach.endV).topRps * TAU > 220);
  }
  for (const hand of ['right', 'left']) {
    const { g, t } = fixture({ lessonId: 'BANANA', hand }); start(t);
    const r = lib.predict(g.ball.p, g.ball.v, g.ball.w, { dt: PH.SIM_DT, maxT: 3, stopZ: .82, stopAtPlane: true });
    assert.ok(r.reach && r.bounces === 1, JSON.stringify({ hand, launch: copyBall(g.ball), result: r })); assert.ok(r.reach.y - PH.TABLE_Y < .28);
    assert.equal(Math.sign(r.reach.x), hand === 'left' ? 1 : -1);
  }
});
