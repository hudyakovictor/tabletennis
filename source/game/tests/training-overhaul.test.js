const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const GS = { MENU: 'MENU', RALLY: 'RALLY', SERVE_READY: 'SERVE_READY', SERVE_TOSS: 'SERVE_TOSS' };
let randomCalls = 0;
const math = Object.create(Math);
math.random = () => { randomCalls++; throw new Error('training consumed simulation randomness'); };
const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '40_swipe.js', '42_shot_diagnostics.js', '65_train.js', '84_racket.js'],
  ['Trainer', 'TRAIN_STEPS', 'TRAIN_GUIDES', 'TRAIN_FEEDS', 'TRAIN_SKILLS', 'STROKES', 'SwipeTracker', 'V3', 'Q', 'PH', 'TAU', 'ET',
    'trainingCatalog', 'trainingCoverage', 'trainingLessonView', 'trainingGestureModel', 'trainingDiagram', 'trainingFeedBall',
    'trainingExecutedTechnique', 'tapStrokeMetrics', 'deriveStroke', 'refineRacket', 'resolveRacketLaunch', 'racketForStroke',
    'strokeIdentityMatches', 'measureShotSpin', 'predict', 'bounceTable', 'integrateBall', 'Equipment', 'BLADES', 'RUBBERS', 'SERVE_WARM',
    'getCaptureForgiveness', 'trainingTarget'],
  { GS, window: { __TT_EMBED: true }, Math: math });
const { V3, Q, PH, TAU } = lib;
const plain = x => JSON.parse(JSON.stringify(x));
const copyBall = b => ({ p: { ...b.p }, v: { ...b.v }, w: { ...b.w } });
const NEW_IDS = ['BANANA', 'CHOP_BLOCK', 'SERVE_NO_SPIN', 'SERVE_SIDE_TOP', 'SERVE_SIDE_BACK'];

function fixture(options = {}) {
  const progress = [], phases = [], completions = [];
  const g = { time: 123, state: GS.RALLY, shotId: 0, rallyBounces: [], marks: [], serveBounces: 0, netTouched: false,
    paused: false, timeScale: 1, targetTimeScale: 1, slowmoUntil: 0, slowmo: { on: false, active: false },
    settings: { hint: options.hint !== false, hand: options.hand || 'right', grip: options.grip || 'shakehand' },
    ball: { p: V3.new(), v: V3.new(), w: V3.new(), q: Q.new(), hist: [], live: false, lastHitBy: 0 },
    swipe: new lib.SwipeTracker(), audio: { ui() {} },
    ai: { levelIndex: 1, pos: V3.new(), anim: {}, reset() {}, setLevel(n) { this.levelIndex = n; }, setHandicap() {} },
    aiPaddle: { pos: V3.new(), normal: V3.new(0, 0, 1) },
    canvas: { getBoundingClientRect: () => ({ width: 390, height: 844 }) },
    project: () => ({ x: .5, y: .5, ok: true }), contactPrediction: () => ({ p: V3.new(0, 1, .92), t: 1 }),
    cancelInput() { this.swipe.cancel(); }, setSlowmoAllowed(value) { this.slowmoAllowed = value; },
    prepServe() { this.shotId++; this.state = GS.SERVE_READY; this.isServeBall = true; this.ball.live = false; this.ball.lastHitBy = 0; },
    ui: { inputMode: 'mouse', trainSync(t) { phases.push(t.phase); },
      trainProgress(t) { progress.push(plain(t.profile.lessons[t.S.id])); }, trainDone(t) { completions.push(plain(t.summary())); }, trainHide() {} },
    applyHit(side, racket, p, quality, info) {
      this.reply = { side, racket, contact: { ...p }, quality, info, ball: copyBall(this.ball) };
      this.shotId++; this.ball.lastHitBy = side; this.rallyBounces.length = 0;
    } };
  const t = new lib.Trainer(g, options); g.training = t; t.begin();
  return { g, t, progress, phases, completions };
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
  const p = options.incoming ? V3.clone(options.incoming.p)
    : V3.new(banana ? g.settings.hand === 'left' ? .35 : -.35 : 0, serving ? 1.12 : .95, serving ? 1.55 : .92);
  const v = options.incoming ? V3.clone(options.incoming.v) : V3.new(0, serving ? -1.7 : -.5, serving ? 0 : cut ? 9 : 5);
  const w = options.incoming ? V3.clone(options.incoming.w) : V3.new(serving ? 0 : cut ? 285 : 35, 0, 0);
  const context = { side: 1, isServe: serving, ball: p, ballVelocity: v, ballSpin: w, ballSpeed: V3.len(v),
    forehand: !banana, hand: g.settings.hand, grip: g.settings.grip, equip: options.equip };
  let racket = lib.deriveStroke(m, context);
  racket.quality = .9; racket.aim = options.aim || { x: 0, z: -.68 };
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

function incomingAtContact(t, z = .92) {
  const b = t.g.ball, first = lib.predict(b.p, b.v, b.w, { dt: PH.SIM_DT, maxT: 3, stopOnFirstBounce: true });
  assert.equal(first.hitNet, false); assert.ok(first.landed && first.landed.z > 0);
  const p = V3.new(first.landed.x, PH.TABLE_Y + PH.R + 1e-5, first.landed.z), v = V3.clone(first.endV);
  const w = V3.mul(V3.new(), b.w, Math.exp(-first.endT / PH.SPIN_DECAY_TAU)); lib.bounceTable(p, v, w);
  const reach = lib.predict(p, v, w, { dt: PH.SIM_DT, maxT: 3, stopZ: z, stopAtPlane: true });
  assert.equal(reach.hitNet, false); assert.equal(reach.bounces, 0); assert.ok(reach.reach);
  V3.mul(w, w, Math.exp(-reach.endT / PH.SPIN_DECAY_TAU));
  return { p: V3.clone(reach.reach), v: V3.clone(reach.endV), w };
}

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

test('adaptive assistance changes only between attempts after two consecutive outcomes and resets each transition run', () => {
  const { g, t } = fixture({ mode: 'stroke', stroke: 'DRIVE', pacing: 'coach', adaptive: true });
  const outcomes = [
    [true, 'guided', 1], [true, 'ring', 0], [true, 'ring', 1], [true, 'independent', 0],
    [false, 'independent', 1], [false, 'ring', 0], [false, 'ring', 1], [false, 'guided', 0],
    [true, 'guided', 1], [false, 'guided', 1], [true, 'guided', 1], [true, 'ring', 0],
    [true, 'ring', 1], [true, 'independent', 0], [true, 'independent', 1], [true, 'independent', 0],
    [false, 'independent', 1], [false, 'ring', 0]
  ];
  try {
    assert.equal(t.helpLevel, 'guided'); assert.equal(t.helpRun, 0);
    for (const [success, level, run] of outcomes) {
      if (t.phase === 'fail') assert.equal(t.action('retry'), true);
      start(t);
      const previousLevel = t.helpLevel, previousRun = t.helpRun;
      assert.equal(t.tutorialScale, previousLevel === 'guided' ? .65 : 1);
      assert.equal(t.guide, previousLevel === 'independent' ? 'none' : 'ring');
      assert.equal(lib.getCaptureForgiveness(), previousLevel === 'independent' ? 1 : 1.25);
      if (success) {
        contact(t); assert.equal(t.phase, 'live'); assert.equal(t.helpLevel, previousLevel); assert.equal(t.helpRun, previousRun);
        land(t);
      } else t.onFault(-1, 'miss');
      assert.equal(t.helpLevel, level, `outcome ${success}, attempt ${t.attempts}`); assert.equal(t.helpRun, run);
      assert.equal(t.helpResult, run ? success : null); assert.equal(g.ball.live, false); assert.equal(t.frozen, false);
      assert.equal(t.snapshot().helpLevel, level); assert.equal(t.tutorialScale, 1);
    }
    assert.equal(t.finished, false); assert.equal(t.setSize, null); assert.deepEqual(plain(t.profile.lessons), {});
  } finally { t.quit(); }
});

test('adaptive guided rally freezes at most one contact per attempt but can freeze the next retry', () => {
  const { g, t } = fixture({ lessonId: 'RALLY', pacing: 'coach', adaptive: true });
  g.contactPrediction = () => ({ p: V3.new(0, 1, .92), t: .01 });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (t.phase === 'fail') assert.equal(t.action('retry'), true);
      start(t); assert.equal(t.helpLevel, 'guided'); assert.equal(t.heldOnce, false);
      bounce(t); t.update(.01, .01); assert.equal(t.frozen, true); assert.equal(t.heldOnce, true);
      assert.equal(t.coachCue().level, 'freeze'); assert.equal(t.coachCue().helpLevel, 'guided'); assert.equal(t.coachCue().timeScale, .65);
      const timer = t.t, simTime = t.simTime, stats = plain(t.stats);
      t.update(10, 10); assert.equal(t.frozen, true); assert.equal(t.t, timer); assert.equal(t.simTime, simTime); assert.deepEqual(plain(t.stats), stats);
      t.onPress({ accepted: false }); assert.equal(t.frozen, true);
      t.onPress({ accepted: true }); assert.equal(t.frozen, false);
      t.update(.01, .01); assert.equal(t.frozen, false);
      contact(t); land(t); assert.equal(t.turns, 1); assert.equal(t.phase, 'live'); assert.equal(t.attempts, attempt);
      for (let i = 0; i < 60; i++) lib.integrateBall(g.ball.p, g.ball.v, g.ball.w, PH.SIM_DT);
      t.update(.3, .1); assert.equal(t.tryReply(), true); bounce(t); t.update(.01, .01);
      assert.equal(t.frozen, false, 'the actual next returned ball cannot introduce a second freeze'); assert.equal(t.heldOnce, true);
      t.onFault(-1, 'miss'); assert.equal(t.attempts, attempt + 1);
    }
  } finally { t.quit(); }
});

test('mastered lessons start adaptive repetition at ring and reset transition runs on restart or another lesson', async ctx => {
  for (const mode of ['course', 'stroke']) await ctx.test(mode, () => {
    const progress = { version: 1, lastLesson: 'DRIVE', lessons: { DRIVE: { mastered: true, practiced: true, attempts: 7, correct: 6 } } };
    const { g, t } = fixture({ mode, stroke: 'DRIVE', lessonId: 'DRIVE', adaptive: true, progress });
    g.contactPrediction = () => ({ p: V3.new(0, 1, .92), t: .01 });
    try {
      assert.equal(t.helpLevel, 'ring'); assert.equal(t.snapshot().helpLevel, 'ring');
      start(t); bounce(t); t.update(.01, .01); assert.equal(t.frozen, false); assert.equal(t.tutorialScale, 1);
      assert.equal(t.coachCue().level, 'ring'); contact(t); land(t); assert.equal(t.helpRun, 1);
      assert.equal(t.action('restart'), true); assert.equal(t.helpLevel, 'ring'); assert.equal(t.helpRun, 0); assert.equal(t.helpResult, null);
      start(t); contact(t); land(t); assert.equal(t.helpLevel, 'ring');
      start(t); contact(t); land(t); assert.equal(t.helpLevel, 'independent'); assert.equal(t.helpRun, 0);
      assert.deepEqual(plain(t.profile.lessons), progress.lessons);
      if (mode === 'course') {
        t.goStep(lib.TRAIN_STEPS.findIndex(s => s.id === 'BANANA'));
        assert.equal(t.helpLevel, 'guided'); assert.equal(t.helpRun, 0); assert.equal(t.helpResult, null);
      }
    } finally { t.quit(); }
  });
});

test('hint OFF during an adaptive freeze releases only tutorial assistance and preserves the user pause', async ctx => {
  for (const paused of [false, true]) for (const source of ['settings', 'requested', 'contact']) await ctx.test(`${source}/paused=${paused}`, () => {
    const { g, t } = fixture({ adaptive: true });
    g.contactPrediction = () => ({ p: V3.new(0, 1, .92), t: .01 });
    try {
      start(t); bounce(t); t.update(.01, .01); assert.equal(t.frozen, true);
      t.onPress({ accepted: false }); assert.ok(t.nudge > 0); g.paused = paused;
      const before = plain({ ball: copyBall(g.ball), stats: t.stats, attempts: t.attempts, done: t.done, timer: t.t, simTime: t.simTime });
      if (source === 'settings') g.settings.hint = false;
      else if (source === 'requested') g.hintRequested = false;
      else g.hintContact = false;
      t.update(0, 0);
      assert.equal(t.frozen, false); assert.equal(t.nudge, 0); assert.equal(t.guide, 'none'); assert.equal(t.tutorialScale, 1);
      assert.equal(lib.getCaptureForgiveness(), 1); assert.equal(g.paused, paused); assert.equal(g.ball.live, true);
      assert.deepEqual(plain({ ball: copyBall(g.ball), stats: t.stats, attempts: t.attempts, done: t.done, timer: t.t, simTime: t.simTime }), before);
      assert.equal(t.action('resume'), true); assert.equal(g.paused, paused);
      t.update(.01, .01); assert.equal(t.frozen, false); assert.equal(g.paused, paused);
      t.quit(); assert.equal(g.paused, paused); assert.equal(t.tutorialScale, 1); assert.equal(lib.getCaptureForgiveness(), 1);
      assert.equal(g.timeScale, 1); assert.equal(g.targetTimeScale, 1); assert.equal(g.slowmoAllowed, true);
    } finally { if (g.training) t.quit(); }
  });
});

test('coach-none, sparring and locked sessions suppress adaptive tutorial aids and quit restores normal state', async ctx => {
  for (const blocker of ['coach', 'sparring', 'ranked', 'online', 'career']) await ctx.test(blocker, () => {
    const { g, t } = fixture({ lessonId: 'DRIVE', adaptive: true });
    try {
      if (blocker === 'coach') t.custom = { ...t.S, coach: 'none', sparring: false };
      else if (blocker === 'sparring') t.custom = { ...t.S, coach: 'ring', sparring: true };
      else g.sessionKind = blocker;
      g.contactPrediction = () => ({ p: V3.new(0, 1, .92), t: .01 }); t.configureHelp();
      start(t); bounce(t); t.update(.01, .01);
      assert.equal(t.guide, 'none'); assert.equal(t.frozen, false); assert.equal(t.tutorialScale, 1); assert.equal(lib.getCaptureForgiveness(), 1);
      assert.notEqual(t.coachCue()?.kind, 'contact'); assert.equal(t.allowAi, blocker === 'sparring');
      if (blocker === 'sparring') assert.equal(g.ai.levelIndex, 0);
      g.timeScale = g.targetTimeScale = .35; g.slowmoUntil = 99; g.paused = true;
      const settings = plain(g.settings); t.quit();
      assert.equal(g.training, null); assert.equal(g.state, GS.MENU); assert.equal(g.ball.live, false); assert.equal(g.paused, true);
      assert.equal(g.timeScale, 1); assert.equal(g.targetTimeScale, 1); assert.equal(g.slowmoUntil, 0);
      assert.equal(g.slowmoAllowed, true); assert.equal(g.ai.levelIndex, 1); assert.equal(t.frozen, false); assert.equal(t.replyReady, false);
      assert.equal(lib.getCaptureForgiveness(), 1); assert.deepEqual(plain(g.settings), settings);
      assert.equal(t.queue.length, 0); assert.equal(t.currentSlot, null); assert.equal(t.recording, null); assert.equal(t.attemptClip, null);
    } finally { if (g.training) t.quit(); }
  });
});

test('seeded variation preforms reproducible balanced queues for short sets and four-ball checks', async ctx => {
  const check = { stage: 'check', practicePassed: true, quizPassed: true };
  const cases = [
    { name: 'mixed/10', mode: 'accuracy', target: 'mixed', setSize: 10 },
    { name: 'mixed/20', mode: 'accuracy', target: 'mixed', setSize: 20 },
    { name: 'corners/10', mode: 'accuracy', target: 'corners', setSize: 10 },
    { name: 'corners/20', mode: 'accuracy', target: 'corners', setSize: 20 },
    { name: 'read-spin/10', mode: 'accuracy', target: 'mixed', setSize: 10, mixLesson: 'READ_SPIN' },
    { name: 'read-spin/20', mode: 'accuracy', target: 'mixed', setSize: 20, mixLesson: 'READ_SPIN' },
    { name: 'choose/10', mode: 'accuracy', target: 'mixed', setSize: 10, mixLesson: 'CHOOSE' },
    { name: 'choose/20', mode: 'accuracy', target: 'mixed', setSize: 20, mixLesson: 'CHOOSE' },
    { name: 'mixed/infinite', mode: 'accuracy', target: 'mixed' },
    { name: 'read-spin/check', lessonId: 'READ_SPIN', resume: check },
    { name: 'choose/check', lessonId: 'CHOOSE', resume: check },
    { name: 'final/check', lessonId: 'FINAL', resume: check }
  ];
  for (const row of cases) await ctx.test(row.name, () => {
    const a = fixture({ ...row, variation: true, seed: 12345 }), b = fixture({ ...row, variation: true, seed: 12345 });
    try {
      if (row.mixLesson) {
        const mix = lib.TRAIN_STEPS.find(s => s.id === row.mixLesson).mix;
        for (const t of [a.t, b.t]) { t.custom = { ...t.S, mix }; t.resetQueue(); }
      }
      const t = a.t, size = t.mode === 'course' ? 4 : t.setSize || 20;
      assert.equal(t.queue.length, size); assert.equal(t.queueIndex, 0); assert.equal(t.currentSlot, null); assert.equal(t.ballNo, 0);
      assert.deepEqual(plain(t.queue), plain(b.t.queue)); assert.notEqual(t.queue, b.t.queue); assert.notEqual(t.sessionId, b.t.sessionId);
      const kinds = t.S.mix || [Object.keys(lib.TRAIN_FEEDS).find(k => lib.TRAIN_FEEDS[k] === t.S.feed)];
      const targetCount = t.S.target === 'mixed' ? 5 : ['sides', 'corners', 'depth'].includes(t.S.target) ? 2 : 1;
      const feeds = Object.fromEntries(kinds.map(k => [k, 0])), lanes = [0, 0], targets = Array(targetCount).fill(0);
      for (const slot of t.queue) {
        assert.deepEqual(Object.keys(slot).sort(), ['kind', 'lane', 'targetIndex']); assert.ok(kinds.includes(slot.kind));
        assert.ok(slot.lane === 0 || slot.lane === 1); assert.ok(Number.isInteger(slot.targetIndex) && slot.targetIndex >= 0 && slot.targetIndex < targetCount);
        feeds[slot.kind]++; lanes[slot.lane]++; targets[slot.targetIndex]++;
      }
      for (const counts of [Object.values(feeds), lanes, targets]) assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `${row.name}: ${counts}`);
      const queue = t.queue, contents = plain(queue);
      t.random = () => assert.fail('an already preformed queue cannot draw randomness while feeding or displaying');
      start(t); assert.equal(t.queue, queue); assert.equal(t.queueIndex, 0); assert.equal(t.currentSlot, queue[0]);
      assert.deepEqual(plain(t.queue), contents); assert.equal(t.incomingKind, t.S.serve ? undefined : queue[0].kind);
    } finally { a.t.quit(); b.t.quit(); }
  });
  await ctx.test('different explicit seeds form different mixed-set orders', () => {
    const a = fixture({ mode: 'accuracy', target: 'mixed', setSize: 20, variation: true, seed: 1 });
    const b = fixture({ mode: 'accuracy', target: 'mixed', setSize: 20, variation: true, seed: 2 });
    try { assert.notDeepEqual(plain(a.t.queue), plain(b.t.queue)); assert.equal(randomCalls, 0); }
    finally { a.t.quit(); b.t.quit(); }
  });
});

test('snapshot, locale and pause do not draw randomness or advance a seeded slot; only a settled landing does', () => {
  const lang = lib.ET.lang(), { g, t } = fixture({ mode: 'accuracy', target: 'mixed', setSize: 10, variation: true, adaptive: true, seed: 31 });
  try {
    const queue = t.queue, contents = plain(queue); let draws = 0;
    t.random = () => { draws++; assert.fail('display or an existing slot consumed seeded randomness'); };
    start(t); const slot = t.currentSlot, launch = copyBall(g.ball), profile = plain(t.profile), stats = plain(t.stats), target = plain(t.currentTarget);
    for (const locale of ['en', 'ru', 'en', 'ru']) {
      g.paused = !g.paused; lib.ET.set(locale); t.localize(); t.snapshot(); t.snapshot(); t.update(0, 0);
      assert.equal(t.queue, queue); assert.deepEqual(plain(t.queue), contents); assert.equal(t.currentSlot, slot); assert.equal(t.queueIndex, 0);
      assert.deepEqual(copyBall(g.ball), launch); assert.deepEqual(plain(t.currentTarget), target);
      assert.deepEqual(plain(t.profile), profile); assert.deepEqual(plain(t.stats), stats); assert.equal(draws, 0);
    }
    t.onFault(1, 'feeder'); assert.equal(t.feedback.neutral, true); assert.equal(t.currentSlot, slot); assert.equal(t.queueIndex, 0);
    assert.equal(t.fails, 0); assert.deepEqual(plain(t.stats), stats); assert.equal(t.helpRun, 0);
    t.update(1.49, 0); assert.equal(t.phase, 'fail'); assert.equal(t.ballNo, 1);
    t.update(.02, 0); assert.equal(t.phase, 'live'); assert.equal(t.ballNo, 2);
    assert.equal(t.currentSlot, slot); assert.equal(t.queueIndex, 0); assert.deepEqual(copyBall(g.ball), launch);
    const zone = t.currentTarget;
    contact(t, { aim: { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 } });
    assert.equal(t.queueIndex, 0); assert.equal(t.currentSlot, slot); assert.equal(t.attempts, 0);
    land(t); assert.equal(t.done, 1); assert.equal(t.queueIndex, 1); assert.equal(t.currentSlot, null);
    t.onBounce(-1, 1); assert.equal(t.queueIndex, 1); assert.equal(t.attempts, 1);
    assert.deepEqual(plain(t.queue), contents); assert.equal(draws, 0); start(t);
    assert.equal(t.queueIndex, 1); assert.equal(t.currentSlot, queue[1]); assert.equal(draws, 0); assert.equal(randomCalls, 0);
  } finally { t.quit(); lib.ET.set(lang); }
});

test('finite coach neutral retries retain the current slot and do not consume errors, attempts or adaptive runs', async ctx => {
  for (const reason of ['launch', 'feeder', 'let']) await ctx.test(reason, () => {
    const { g, t, completions } = fixture({ mode: reason === 'let' ? 'stroke' : 'accuracy', stroke: 'SERVE_SIDE_TOP', target: 'mixed',
      pacing: 'coach', setSize: 10, adaptive: true, variation: true, seed: 42 });
    try {
      const originalFeed = t.S.feed, queue = t.queue, contents = plain(queue);
      if (reason === 'launch') {
        t.custom = { ...t.S, feed: { speed: .01, top: 0, depth: .62, clear: 5 } };
        assert.equal(t.action('start'), true); t.update(.66, 0);
      } else {
        start(t);
        if (reason === 'let') { contact(t); bounce(t); g.netTouched = true; bounce(t); t.onLet(); }
        else t.onFault(1, 'feeder');
      }
      const slot = t.currentSlot, target = plain(t.currentTarget), before = plain(t.stats), no = t.ballNo;
      assert.equal(t.phase, 'fail'); assert.equal(t.feedback.neutral, true); assert.equal(t.reviewHeld, false); assert.equal(t.action('resume'), true);
      assert.equal(t.attempts, 0); assert.equal(t.done, 0); assert.equal(t.fails, 0); assert.equal(t.queueIndex, 0); assert.equal(slot, queue[0]);
      assert.equal(t.helpRun, 0); assert.equal(t.helpResult, null); assert.deepEqual(plain(t.practiceSet().errors), []);
      if (reason === 'launch') t.custom = { ...t.S, feed: originalFeed };
      t.update(1.49, 0); assert.equal(t.phase, 'fail'); assert.equal(t.ballNo, no);
      t.update(.02, 0); assert.equal(t.phase, 'live'); assert.equal(t.ballNo, no + 1);
      assert.equal(t.currentSlot, slot); assert.equal(t.queueIndex, 0); assert.deepEqual(plain(t.queue), contents); assert.deepEqual(plain(t.currentTarget), target);
      assert.deepEqual(plain(t.stats), before); assert.equal(t.fails, 0); assert.equal(t.helpRun, 0); assert.equal(t.attempts, 0);
      assert.equal(t.latestFeedback.neutral, true); assert.equal(completions.length, 0);
    } finally { t.quit(); }
  });
  await ctx.test('a neutral repeat between two successes does not break their transition or streak', () => {
    const { t } = fixture({ mode: 'stroke', stroke: 'DRIVE', pacing: 'coach', setSize: 10, adaptive: true, variation: true, seed: 8 });
    try {
      start(t); contact(t); land(t); assert.equal(t.helpLevel, 'guided'); assert.equal(t.helpRun, 1);
      start(t); const stats = plain(t.stats), slot = t.currentSlot;
      t.onFault(1, 'feeder'); t.update(1.51, 0);
      assert.deepEqual(plain(t.stats), stats); assert.equal(t.helpRun, 1); assert.equal(t.helpResult, true); assert.equal(t.currentSlot, slot);
      assert.equal(t.queueIndex, 1); assert.equal(t.fails, 0); assert.deepEqual(plain(t.practiceSet().errors), []);
      contact(t); land(t); assert.equal(t.helpLevel, 'ring'); assert.equal(t.helpRun, 0); assert.equal(t.stats.streak, 2);
      assert.equal(t.attempts, 2); assert.equal(t.queueIndex, 2); assert.equal(t.practiceSet().attempted, 2);
    } finally { t.quit(); }
  });
});

test('infinite variation appends another preformed batch only when the previous batch settles', () => {
  const { t, completions, progress } = fixture({ mode: 'accuracy', target: 'mixed', variation: true, seed: 9 });
  const nextRandom = t.random; let draws = 0;
  t.random = () => { draws++; return nextRandom(); };
  try {
    const first = plain(t.queue); assert.equal(first.length, 20);
    for (let i = 0; i < 20; i++) {
      start(t); assert.equal(t.queue.length, 20); assert.equal(t.queueIndex, i); assert.equal(draws, 0);
      t.onFault(-1, 'miss'); assert.equal(t.queueIndex, i + 1); assert.equal(t.attempts, i + 1);
      if (i < 19) { assert.equal(t.queue.length, 20); assert.equal(draws, 0); }
    }
    assert.equal(t.queue.length, 40); assert.ok(draws > 0); assert.deepEqual(plain(t.queue.slice(0, 20)), first);
    const afterExtension = draws; t.snapshot(); t.snapshot(); t.localize(); assert.equal(draws, afterExtension);
    start(t); assert.equal(t.currentSlot, t.queue[20]); assert.equal(t.queueIndex, 20); assert.equal(draws, afterExtension);
    t.onFault(-1, 'miss'); assert.equal(t.queueIndex, 21); assert.equal(t.queue.length, 40); assert.equal(draws, afterExtension);
    assert.equal(t.finished, false); assert.equal(t.setSize, null); assert.equal(completions.length, 0); assert.equal(progress.length, 0); assert.equal(randomCalls, 0);
  } finally { t.quit(); }
});

test('course variation keeps guided practice predictable while preforming a varied legal check', async ctx => {
  for (const lessonId of ['CHOOSE', 'DIRECTION']) await ctx.test(lessonId, () => {
    const a = fixture({ lessonId, adaptive: true, variation: true, seed: 1 }), b = fixture({ lessonId, adaptive: true, variation: true, seed: 2 });
    try {
      for (const t of [a.t, b.t]) t.random = () => assert.fail('guided course practice consumed seeded variation');
      for (let i = 0; i < 4; i++) {
        start(a.t); start(b.t);
        assert.equal(a.t.helpLevel, 'guided'); assert.equal(a.t.queue.length, 0); assert.equal(b.t.queue.length, 0);
        assert.deepEqual(copyBall(a.g.ball), copyBall(b.g.ball)); assert.deepEqual(plain(a.t.currentTarget), plain(b.t.currentTarget));
        assert.equal(a.t.currentSlot.kind, a.t.S.mix ? a.t.S.mix[i % a.t.S.mix.length] : 'normal');
        a.t.onFault(-1, 'miss'); b.t.onFault(-1, 'miss');
      }
    } finally { a.t.quit(); b.t.quit(); }
    const { g, t } = fixture({ lessonId, adaptive: true, variation: true, seed: 55,
      resume: { stage: 'check', practicePassed: true, quizPassed: true } });
    try {
      const queue = plain(t.queue); assert.equal(queue.length, 4);
      if (t.S.mix) assert.notDeepEqual(queue.map(slot => slot.kind), Array.from({ length: 4 }, (_, i) => t.S.mix[i % t.S.mix.length]));
      t.random = () => assert.fail('a preformed check consumed randomness');
      for (let i = 0; i < 4; i++) {
        start(t); assert.equal(t.currentSlot, t.queue[i]); assert.equal(t.incomingKind, queue[i].kind);
        assert.deepEqual(plain(t.currentTarget), plain(lib.trainingTarget(t.S.target, queue[i].targetIndex)));
        const flight = lib.predict(g.ball.p, g.ball.v, g.ball.w, { dt: PH.SIM_DT, maxT: 3, stopOnFirstBounce: true });
        assert.equal(flight.hitNet, false); assert.ok(flight.landed && flight.landed.z > 0); assert.equal(t.tutorialScale, 1);
        t.onFault(-1, 'miss'); assert.equal(t.queueIndex, i + 1);
      }
      assert.equal(t.phase, 'review'); assert.equal(t.attempts, 4); assert.equal(t.checkPassed, false);
      assert.deepEqual(plain(t.queue), queue); assert.equal(randomCalls, 0);
    } finally { t.quit(); }
  });
});

test('varied fixed-stroke sets preserve LOOP, BANANA and CHOP_BLOCK contexts through actual incoming and outgoing physics', async ctx => {
  for (const stroke of ['LOOP', 'BANANA', 'CHOP_BLOCK']) for (const hand of ['right', 'left']) await ctx.test(`${stroke}/${hand}`, () => {
    const { g, t, completions } = fixture({ mode: 'stroke', stroke, hand, setSize: 10, variation: true, seed: 77 });
    try {
      const spec = t.S.feed, sequence = plain(t.S.rally);
      const kind = Object.keys(lib.TRAIN_FEEDS).find(k => lib.TRAIN_FEEDS[k] === spec);
      assert.ok(t.queue.every(slot => slot.kind === kind));
      for (let i = 0; i < 10; i++) {
        start(t); assert.equal(t.incomingKind, kind); assert.equal(g.ball.w.x, spec.top);
        assert.equal(g.ball.w.y || 0, spec.side || 0); assert.equal(g.ball.w.z || 0, spec.cork || 0);
        const incoming = incomingAtContact(t, stroke === 'BANANA' ? .82 : .92);
        if (stroke === 'BANANA') {
          assert.equal(Math.sign(incoming.p.x), hand === 'left' ? 1 : -1); assert.ok(incoming.p.y - PH.TABLE_Y < .28);
          assert.ok(Math.abs(incoming.p.x) < PH.T_HALF_WID && Math.abs(incoming.p.z) < PH.T_HALF_LEN - .02);
        }
        if (stroke === 'CHOP_BLOCK') {
          assert.ok(incoming.p.y - PH.TABLE_Y < .28); assert.ok(V3.len(incoming.v) >= 7);
          assert.ok(lib.measureShotSpin(incoming.w, incoming.v).topRps * TAU > 220);
        }
        const shot = contact(t, { incoming });
        assert.equal(shot.racket.stroke.id, stroke); assert.equal(t.lastShot.stroke, stroke); assert.equal(t.criterion(t.lastShot), null);
        assert.deepEqual(plain(t.lastShot.incoming.spin), plain(lib.measureShotSpin(incoming.w, incoming.v)));
        land(t); assert.equal(t.done, i + 1); assert.equal(t.attempts, i + 1); assert.deepEqual(plain(t.S.rally), sequence);
      }
      assert.equal(t.phase, 'done'); assert.equal(t.ballNo, 10); assert.equal(completions.length, 1); assert.equal(t.practiceSet().successful, 10);
      assert.equal(randomCalls, 0);
    } finally { t.quit(); }
  });
});

test('attempt IDs remain monotonic across direct restart, lesson change, check entry and neutral retry', () => {
  const { t } = fixture({ lessonId: 'DRIVE', adaptive: true, variation: true, seed: 19 });
  try {
    let previous = t.attemptId;
    const freshAttempt = () => {
      start(t); assert.ok(Number.isInteger(t.attemptId) && t.attemptId > previous, `attemptId ${t.attemptId} must exceed ${previous}`);
      previous = t.attemptId;
      const replay = t.snapshot().attemptReplay;
      assert.deepEqual(Object.keys(replay).sort(), ['attemptId', 'available', 'truncated']);
      assert.equal(typeof replay.available, 'boolean'); assert.equal(typeof replay.truncated, 'boolean');
    };
    freshAttempt(); t.onFault(-1, 'miss'); const sessionId = t.sessionId;
    assert.equal(t.action('restart'), true); assert.ok(t.attemptId >= previous); assert.equal(t.sessionId, sessionId);
    assert.equal(t.attemptClip, null); assert.equal(t.recording, null);
    assert.deepEqual(plain(t.snapshot().attemptReplay), { available: false, attemptId: null, truncated: false });
    freshAttempt(); contact(t); land(t);
    t.goStep(lib.TRAIN_STEPS.findIndex(s => s.id === 'BANANA'));
    assert.ok(t.attemptId >= previous); assert.equal(t.attemptClip, null); assert.equal(t.recording, null);
    for (let i = 0; i < 3; i++) { freshAttempt(); contact(t); land(t); }
    assert.equal(t.phase, 'question'); assert.equal(t.action('answer', t.S.quiz.answer), true);
    assert.ok(t.attemptId >= previous); assert.equal(t.attemptClip, null); assert.equal(t.recording, null);
    freshAttempt(); t.onFault(1, 'feeder'); const slot = t.currentSlot;
    freshAttempt(); assert.equal(t.currentSlot, slot); assert.equal(t.queueIndex, 0); assert.equal(t.attempts, 0);
    t.quit(); assert.equal(t.attemptClip, null); assert.equal(t.recording, null);
    assert.deepEqual(plain(t.snapshot().attemptReplay), { available: false, attemptId: null, truncated: false });
  } finally { if (t.g.training) t.quit(); }
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
