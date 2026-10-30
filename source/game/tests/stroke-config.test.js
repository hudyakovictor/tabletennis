const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

function fresh(extra) {
  return load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '70_game.js'],
    ['STROKE_CONFIG', 'ARCH', 'PH', 'V3', 'SwipeTracker', 'classifyStroke', 'deriveStroke', 'refineRacket',
      'strokeFrame', 'impactRacket', 'predict', 'launchPoint', 'MATCH_RULES', 'playerInCaptureRange',
      'PADDLE_PROFILES', 'paddleGripProfile', 'PaddleStrokeMotion', 'parkServeBall', 'Game', 'GS'], extra);
}
function metrics(overrides = {}) {
  return { samples: 8, dist: .24, pathLen: .24, speed: 2, releaseSpeed: 2, peakSpeed: 2,
    right: 0, up: 1, curl: 0, smooth: 1, straightness: 1, x: .5, y: .5, ...overrides };
}
const near = (a, b, eps = 1e-8) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('serve.sideK changes classification without reloading the modules', () => {
  const l = fresh(), config = l.STROKE_CONFIG;
  const m = metrics({ right: .3, up: Math.sqrt(1 - .3 ** 2) }), ctx = { isServe: true };
  assert.equal(l.ARCH, config.archetypes);
  assert.equal(l.classifyStroke(m, ctx, .5).id, 'SERVE_TOP');
  config.serve.sideK = 2;
  assert.equal(l.classifyStroke(m, ctx, .5).id, 'SERVE_SIDE');
  config.serve.sideK = 1;
  assert.equal(l.classifyStroke(m, ctx, .5).id, 'SERVE_TOP');
});

test('a long fast forward diagonal can serve flat without stealing horizontal sidespin', () => {
  const l = fresh(), tracker = new l.SwipeTracker();
  tracker.down(.332, .5336, 0);
  tracker.move(.5, .5, .038);
  const m = tracker.up(.612, .4776, .062);
  const power = Math.max(m.releaseSpeed, m.peakSpeed * l.STROKE_CONFIG.racket.speed.peakK) / l.STROKE_CONFIG.racket.speed.inputScale;
  assert.equal(l.classifyStroke(m, { isServe: true }, power).id, 'SERVE_FAST');
  assert.equal(l.classifyStroke({ ...m, right: 1, up: 0 }, { isServe: true }, power).id, 'SERVE_SIDE');
});

test('horizontal serves retain lateral spin through impact and assistance, for both sides and grips', () => {
  const l = fresh();
  for (const side of [-1, 1]) for (const grip of ['shakehand', 'penhold']) {
    for (const right of [-1, 1]) for (const speed of [1, 4]) {
      const tracker = new l.SwipeTracker();
      tracker.down(.5 - right * .12, .5, 0);
      tracker.move(.5, .5, .12 / speed);
      const m = tracker.up(.5 + right * .12, .5, .24 / speed);
      const p = l.V3.new(0, 1.12, side * 1.65), v = l.V3.new(0, -1, 0), w = l.V3.new();
      const raw = l.deriveStroke(m, { side, grip, isServe: true, ball: p, ballVelocity: v });
      assert.equal(raw.stroke.id, 'SERVE_SIDE');
      const solved = l.refineRacket(p, v, w, raw, .85, 1);
      assert.equal(solved.valid, true);
      for (const racket of [raw, solved]) {
        const outV = l.V3.clone(v), outW = l.V3.clone(w);
        assert.ok(l.impactRacket(outV, outW, racket.normal, racket.vR, 1, racket.rubber));
        near(outW.x, 0);
        assert.ok(Math.abs(outW.z) > Math.abs(outW.x) + 1e-3);
        assert.ok(l.V3.len(racket.vR) <= l.STROKE_CONFIG.serve.vmax + 1e-8);
      }
      const frameV = l.V3.new(), frameN = l.V3.new();
      l.strokeFrame(solved, 0, 0, 1, frameV, frameN);
      near(l.V3.dist(frameV, solved.vR), 0);
      near(l.V3.dist(frameN, solved.normal), 0);
      const outV = l.V3.clone(v), outW = l.V3.clone(w);
      l.impactRacket(outV, outW, solved.normal, solved.vR, 1, solved.rubber);
      const report = l.predict(l.V3.clone(l.launchPoint(p, solved.normal)), outV, outW,
        { dt: l.PH.SIM_DT, maxT: l.STROKE_CONFIG.serve.solver.maxT, stopAfterBounces: 2 });
      assert.equal(report.hitNet, false);
      assert.equal(Math.sign(report.landed.z), side);
      assert.equal(Math.sign(report.b2.z), -side);
    }
  }
});

test('downward gestures produce backspin serves and chops, never topspin or smash', () => {
  const l = fresh();
  for (const side of [-1, 1]) for (const serving of [false, true]) {
    const p = l.V3.new(0, 1.12, side * (serving ? 1.65 : 2.4));
    const v = l.V3.new(0, -1, serving ? 0 : side * 5), w = l.V3.new();
    const racket = l.deriveStroke(metrics({ up: -1, speed: 3.2, releaseSpeed: 3.2, peakSpeed: 3.2 }),
      { side, isServe: serving, ball: p, ballVelocity: v });
    assert.equal(racket.stroke.id, serving ? 'SERVE_BACK' : 'CHOP');
    const solved = l.refineRacket(p, v, w, racket, .85, 1);
    assert.ok(l.impactRacket(v, w, solved.normal, solved.vR, 1, solved.rubber));
    assert.ok(side * w.x > 0, `backspin sign lost: ${w.x}, side ${side}`);
  }
});

test('straight horizontal rally strokes create sidespin after aiming for both sides and grips', () => {
  const l = fresh();
  for (const side of [-1, 1]) for (const grip of ['shakehand', 'penhold']) for (const right of [-1, 1]) {
    const p = l.V3.new(0, 1.12, side * 1.65), v = l.V3.new(0, -.1, side * 6), w = l.V3.new(side * 120, 0, 0);
    const raw = l.deriveStroke(metrics({ right, up: 0 }), { side, grip, ball: p, ballVelocity: v, ballSpin: w });
    assert.equal(raw.stroke.id, 'SIDE');
    const solved = l.refineRacket(p, v, w, raw, 1, 1);
    assert.equal(solved.valid, true);
    l.impactRacket(v, w, solved.normal, solved.vR, 1, solved.rubber);
    assert.ok(Math.abs(w.y) > Math.abs(w.x));
    assert.ok(side * right * w.y > 0);
    const flight = l.predict(l.V3.clone(l.launchPoint(p, solved.normal)), v, w,
      { dt: l.PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true });
    assert.equal(flight.hitNet, false);
    assert.equal(Math.sign(flight.landed?.z), -side);
  }
});

test('spin weights, archetypes, contact clamps and gain bounds are live configuration', () => {
  const l = fresh(), cfg = l.STROKE_CONFIG;
  const ctx = { side: 1, ball: { y: 1.12, z: 1.65 } };
  const before = l.deriveStroke(metrics(), ctx);
  cfg.archetypes.LOOP.elev = 10;
  cfg.spin.spinIntentWeights.u = 0;
  const after = l.deriveStroke(metrics(), ctx);
  assert.ok(after.elev < before.elev);
  assert.ok(after.spinIntent < before.spinIntent);
  cfg.spin.spinGainRange = [1, 1];
  near(l.deriveStroke(metrics(), { ...ctx, spinGain: 10 }).rubber.mu, cfg.racket.rubber.mu);
  cfg.spin.contactClampByArchetype.SERVE_SIDE = [11, 12];
  const sideServe = l.deriveStroke(metrics({ right: 1, up: 0 }), { ...ctx, isServe: true, spinBias: 'high', spinGain: 10 });
  assert.ok(sideServe.contact >= 11 && sideServe.contact <= 12);
});

test('serve speed ceiling is applied inside strokeFrame and throughout refinement', () => {
  const l = fresh(), cfg = l.STROKE_CONFIG;
  const p = l.V3.new(0, 1.12, 1.65), v = l.V3.new(0, -1, 0), w = l.V3.new();
  cfg.serve.vmax = 6;
  const raw = l.deriveStroke(metrics({ right: 1, up: 0, releaseSpeed: 8, peakSpeed: 8 }),
    { side: 1, isServe: true, ball: p, ballVelocity: v });
  const frameV = l.V3.new(), frameN = l.V3.new();
  l.strokeFrame(raw, .1, .2, 5, frameV, frameN);
  assert.ok(l.V3.len(frameV) <= 6 + 1e-8);
  const solved = l.refineRacket(p, v, w, raw, 1, 1);
  assert.ok(l.V3.len(solved.vR) <= 6 + 1e-8);
  l.impactRacket(v, w, solved.normal, solved.vR, 1, solved.rubber);
  near(w.x, 0);
});

test('impact rubber overrides config, config overrides PH, and omitted defaults fall back to PH', () => {
  const l = fresh(), cfg = l.STROKE_CONFIG;
  const hit = rubber => {
    const v = l.V3.new(), w = l.V3.new();
    l.impactRacket(v, w, l.V3.new(0, 0, -1), l.V3.new(0, 0, -6), 1, rubber);
    return v.z;
  };
  cfg.racket.rubber.eSpeed = 0;
  const before = hit();
  cfg.racket.rubber.e = .2;
  assert.ok(Math.abs(hit()) < Math.abs(before));
  near(hit({ e: .8 }), before);
  cfg.racket.rubber.damp = 0;
  assert.ok(Math.abs(hit()) < Math.abs(before));
  cfg.racket.rubber = {};
  near(hit(), hit({ e: l.PH.E_RACKET, mu: l.PH.MU_RACKET, et: l.PH.ET_RACKET, damp: 1 }));
  cfg.spin.cap = 20;
  const v = l.V3.new(), w = l.V3.new();
  l.impactRacket(v, w, l.V3.new(0, 0, -1), l.V3.new(2, 3, -6));
  near(l.V3.len(w), 20);
});

test('shared serve admission reads live config while retaining the frozen rules API', () => {
  const l = fresh(), cfg = l.STROKE_CONFIG;
  assert.ok(Object.isFrozen(l.MATCH_RULES));
  cfg.serve.captureRadius = .2;
  cfg.serve.tossMinRise = .3;
  near(l.MATCH_RULES.serveCaptureRadius, .2);
  near(l.MATCH_RULES.serveTossMinRise, .3);
  assert.equal(l.playerInCaptureRange(l.V3.new(.3, 0, 0), l.V3.new(), true), false);
  cfg.serve.captureRadius = .4;
  assert.equal(l.playerInCaptureRange(l.V3.new(.3, 0, 0), l.V3.new(), true), true);
  const overridden = fresh({ __TT_RULES: { serveCaptureRadius: .7, serveTossMinRise: .25 } });
  overridden.STROKE_CONFIG.serve.captureRadius = .1;
  near(overridden.MATCH_RULES.serveCaptureRadius, .7);
  near(overridden.MATCH_RULES.serveTossMinRise, .25);
});

test('refinement retains configured material damping instead of replacing it with assist softness', () => {
  const l = fresh();
  l.STROKE_CONFIG.racket.rubber.damp = .6;
  const p = l.V3.new(0, 1.12, 1.65), v = l.V3.new(0, -1, 0), w = l.V3.new();
  const raw = l.deriveStroke(metrics({ right: 1, up: 0 }), { side: 1, isServe: true, ball: p, ballVelocity: v });
  near(raw.rubber.damp, .6);
  const solved = l.refineRacket(p, v, w, raw, 1, 1);
  assert.equal(solved.valid, true);
  assert.ok(solved.rubber.damp > 0 && solved.rubber.damp <= .6);
  near(solved.rubber.damp, .6 * solved.damp);
});

test('serve motion keys, times, range and hold are configurable without stale profile copies', () => {
  const l = fresh(), p = l.STROKE_CONFIG.motion.SERVE;
  Object.assign(p, { ready: 12, prepare: -15, contact: 3, follow: 30, roll: .4,
    followTime: .2, recoverTime: .3, range: [-30, 35], hold: .08 });
  assert.deepEqual([...l.PADDLE_PROFILES.SERVE.keys], [12, -15, 3, 30]);
  assert.ok(Object.isFrozen(l.PADDLE_PROFILES.SERVE));
  const profile = l.paddleGripProfile('shakehand', 'SERVE_SIDE');
  near(profile.followTime, .2); near(profile.recoverTime, .3); near(profile.hold, .08);
  assert.deepEqual([...profile.range], [-30, 35]);
  const motion = new l.PaddleStrokeMotion(), ready = { yaw: 0, pitch: 0, roll: 0 };
  motion.contact(l.V3.new(0, 0, -1), 0, 'SERVE_SIDE', 'shakehand', 'right');
  motion.sample(0, ready);
  assert.equal(motion.sample(.06, ready).stage, 'contact');
  assert.equal(motion.sample(.03, ready).stage, 'follow');
  l.STROKE_CONFIG.racket.snapFrames = 3;
  near(l.paddleGripProfile('shakehand', 'DRIVE').hold, .05);
});

test('Game toss consumes serve tuning rather than hard-coded launch parameters', () => {
  const math = Object.create(Math); math.random = () => .5;
  const l = fresh({ Math: math }), cfg = l.STROKE_CONFIG;
  cfg.serve.toss.speed = 3;
  cfg.serve.toss.speedJitter = 0;
  cfg.serve.toss.height = .2;
  const g = { recenterT: 0, time: 0, player: { pos: l.V3.new(0, 1, 1.8) },
    ball: { p: l.V3.new(), v: l.V3.new(), w: l.V3.new() }, _cal: { tossHeight: 0 },
    audio: { ui() {} }, setState(state) { this.state = state; } };
  l.Game.prototype.startToss.call(g);
  near(g.ball.v.y, 3);
  near(g.ball.p.y, l.PH.TABLE_Y + .2);
  assert.equal(g.state, l.GS.SERVE_TOSS);
});

test('the free hand keeps the ready ball beside the blade and tossing never teleports it', () => {
  const l = fresh(), toss = l.STROKE_CONFIG.serve.toss;
  for (const hand of ['right', 'left']) {
    const pad = { pos: l.V3.new(0, l.PH.TABLE_Y + .28, 1.78) }, p = l.V3.new();
    l.parkServeBall(p, pad, hand);
    near(p.x - pad.pos.x, (hand === 'left' ? 1 : -1) * toss.lateralOffset);
    const before = l.V3.clone(p);
    const g = { recenterT: 0, time: 0, player: pad, settings: { hand },
      ball: { p, v: l.V3.new(), w: l.V3.new() }, _cal: { tossHeight: 0 },
      audio: { ui() {} }, setState(state) { this.state = state; } };
    l.Game.prototype.startToss.call(g);
    near(l.V3.dist(g.ball.p, before), 0);
    assert.equal(g.state, l.GS.SERVE_TOSS);
  }
});
