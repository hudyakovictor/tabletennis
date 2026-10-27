'use strict';
/*
 * Deterministic return/serve audit matrix.
 *
 * This is intentionally one fast, reproducible 300-scenario matrix rather
 * than a claim that an arbitrary number of manual play sessions happened.
 * It exercises the contracts shared by input, admission, capture/CCD, toss
 * legality and the physics solver. The companion audit note documents scope
 * and the boundary of what automated checks can prove.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load([
  '10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '42_shot_diagnostics.js', '56_rig.js', '70_game.js',
], [
  'V3', 'PH', 'MATCH_RULES', 'SwipeTracker', 'isRealStroke', 'playerInCaptureRange',
  'measureCaptureAllowance', 'serveTossIsLegal', 'pressServeZoneOval',
  'impactSphere', 'integrateBall', 'predict', 'Game',
]);

const { V3, PH, MATCH_RULES: R } = lib;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
function normalised(x, y, z) {
  const l = Math.hypot(x, y, z); return V3.new(x / l, y / l, z / l);
}
function tangentFor(n) {
  let x = -n.z, y = 0, z = n.x;
  let l = Math.hypot(x, y, z);
  if (l < 1e-8) { x = 1; y = 0; z = 0; l = 1; }
  return V3.new(x / l, y / l, z / l);
}
function plusScaled(a, b, ar, br) {
  return V3.new(a.x * ar + b.x * br, a.y * ar + b.y * br, a.z * ar + b.z * br);
}

test('return/serve audit matrix: 300 deterministic scenarios', () => {
  let checks = 0;
  const check = (name, fn) => {
    try { fn(); } catch (error) { error.message = `[audit ${checks + 1}: ${name}] ${error.message}`; throw error; }
    checks++;
  };

  // 1–40: event-time hand kinematics. Positive event time is recognisable;
  // same-time geometry is preserved but never converted to a fake high speed.
  for (let i = 0; i < 20; i++) check(`event-time swipe ${i}`, () => {
    const sw = new lib.SwipeTracker(), dt = .004 + i * .003;
    sw.down(.2, .8, 10, 3);
    sw.move(.28, .62, 10 + dt, 3 + dt);
    sw.up(.34, .44, 10 + 2 * dt, 3 + 2 * dt);
    assert.equal(lib.isRealStroke(sw.lastReleased, false), true);
    assert.ok(sw.lastReleased.peakSpeed > 0);
    assert.ok(near(sw.lastReleased.peakSimTime, 3 + dt));
  });
  for (let i = 0; i < 20; i++) check(`zero-time swipe ${i}`, () => {
    const sw = new lib.SwipeTracker();
    sw.down(.2, .8, 10, 3);
    sw.move(.28 + i * .001, .62, 10, 3);
    sw.up(.34, .44, 10, 3);
    assert.equal(sw.lastReleased.peakSpeed, 0);
    assert.equal(lib.isRealStroke(sw.lastReleased, false), false);
    assert.ok(sw.lastReleased.pathLen > .2, 'shape is retained for diagnostics');
  });

  // 41–80: a trailing telemetry ring cannot rewrite whole-gesture metrics.
  for (let i = 0; i < 40; i++) check(`long gesture history ${i}`, () => {
    const moves = 65 + i, sw = new lib.SwipeTracker();
    sw.down(0, 0, 0, 0);
    for (let k = 1; k <= moves; k++) sw.move(k / moves, 0, k * .004, k * .004);
    sw.up(1, 0, (moves + 1) * .004, (moves + 1) * .004);
    assert.equal(sw.samples.length, sw.maxSamples);
    assert.equal(sw.lastReleased.samples, moves + 2);
    assert.ok(near(sw.lastReleased.sx, 0));
    assert.ok(near(sw.lastReleased.dx, 1));
    assert.ok(sw.lastReleased.pathLen >= .999999);
    assert.ok(sw.lastReleased.peakSpeed > 0);
  });

  // 81–120: equal pixel diagonals retain an equal X/Y direction on all
  // portrait/wide dimensions when both axes use the shorter-side scale.
  for (let i = 0; i < 40; i++) check(`aspect-invariant diagonal ${i}`, () => {
    const w = 320 + i * 29, h = 300 + ((i * 83) % 1000), scale = Math.min(w, h);
    const sw = new lib.SwipeTracker();
    sw.down(0, 0, 0, 0);
    sw.move(60 / scale, 60 / scale, .05, .05);
    assert.ok(near(sw.m.right, Math.SQRT1_2, 1e-10));
    assert.ok(near(sw.m.up, -Math.SQRT1_2, 1e-10));
  });

  // 121–180: endpoint capture follows the racket's local disk/slab for six
  // normals and ten radial/depth offsets each (not world XY/Z).
  const normals = [
    normalised(0, 0, -1), normalised(.5, 0, -.8660254), normalised(0, .5, -.8660254),
    normalised(.4, .5, -.7681146), normalised(-.7, .2, -.6855655), normalised(.1, -.8, -.5916079),
  ];
  const factors = [.0, .20, .55, .80, .999, 1.001, .35, .72, 1.1, .92];
  for (let ni = 0; ni < normals.length; ni++) for (let fi = 0; fi < factors.length; fi++) {
    check(`local endpoint ${ni}/${fi}`, () => {
      const n = normals[ni], u = tangentFor(n), f = factors[fi];
      const radial = R.captureRadius * f;
      const depth = R.depthTolerance * ((fi % 3 === 0) ? .75 : (fi % 3 === 1 ? .999 : 1.001));
      const paddle = { pos: V3.new(), prevPos: V3.new(), normal: n };
      const ball = plusScaled(u, n, radial, depth);
      const expected = radial <= R.captureRadius && Math.abs(depth) <= R.depthTolerance;
      assert.equal(lib.playerInCaptureRange(ball, paddle), expected);
      const sample = lib.measureCaptureAllowance(paddle, ball, ball, false, true);
      assert.ok(sample && near(sample.radial, radial, 1e-8));
      assert.ok(near(sample.depthGap, Math.abs(depth), 1e-8));
    });
  }

  // 181–210: the continuous disk sweep and its diagnostic measurement agree.
  const sweepGame = Object.create(lib.Game.prototype);
  for (let i = 0; i < 30; i++) check(`local CCD ${i}`, () => {
    const n = normals[i % normals.length], u = tangentFor(n);
    const radial = R.captureRadius * (.35 + i * .028);
    const paddle = { pos: V3.new(), prevPos: V3.new(), normal: n };
    const p0 = plusScaled(u, n, radial, .10), p1 = plusScaled(u, n, radial, -.10);
    const measured = lib.measureCaptureAllowance(paddle, p0, p1, false, false);
    const hit = sweepGame.sweepPaddle(paddle, p0, p1, R.captureRadius);
    assert.equal(!!hit, !!measured.ccdRadius && measured.ccdRadius <= R.captureRadius);
    if (hit) assert.ok(near(hit.rad, measured.ccdRadius, 1e-9));
  });

  // 211–240: toss boundary and falling-only serve admission.
  for (let i = 0; i < 10; i++) check(`serve minimum rise ${i}`, () => {
    const rise = R.serveTossMinRise + (i - 5) * 1e-6;
    assert.equal(lib.serveTossIsLegal(rise), rise >= R.serveTossMinRise - 1e-6);
  });
  const center = { x: .5, y: .5, ok: true };
  for (let i = 0; i < 20; i++) check(`falling serve gate ${i}`, () => {
    const falling = i % 2 === 0;
    const rise = i % 4 < 2 ? R.serveTossMinRise : R.serveTossMinRise - .02;
    const zone = lib.pressServeZoneOval(center, center, 1000, 500,
      { screenVelocityPx: { x: 0, y: 240 }, pointerType: 'touch', falling, tossRise: rise });
    assert.equal(zone.accepted, falling && lib.serveTossIsLegal(rise));
  });

  // 241–270: non-unit normals cannot alter an impulse; default predictions
  // use the same production step as an explicit PH.SIM_DT call.
  for (let i = 0; i < 15; i++) check(`unit normal invariance ${i}`, () => {
    const n = normalised(.2 + i * .01, .75, -.63), scale = .2 + i * .37;
    const aV = V3.new(.5, -4.2, 1.1), aW = V3.new(40, -10, 15);
    const bV = V3.clone(aV), bW = V3.clone(aW);
    const ia = lib.impactSphere(aV, aW, n, V3.new(), .8, .4, .1);
    const ib = lib.impactSphere(bV, bW, V3.new(n.x * scale, n.y * scale, n.z * scale), V3.new(), .8, .4, .1);
    assert.ok(ia && ib);
    assert.ok(near(aV.x, bV.x, 1e-10) && near(aV.y, bV.y, 1e-10) && near(aV.z, bV.z, 1e-10));
    assert.ok(near(aW.x, bW.x, 1e-10) && near(aW.y, bW.y, 1e-10) && near(aW.z, bW.z, 1e-10));
  });
  for (let i = 0; i < 8; i++) check(`RK4 convergence ${i}`, () => {
    const initial = { p: V3.new(.03 * i, 1.2, 1.1), v: V3.new(.4, .1 - i * .02, -5.5), w: V3.new(35 + i * 9, -20, i * 6) };
    const advance = dt => {
      const p = V3.clone(initial.p), v = V3.clone(initial.v), w = V3.clone(initial.w);
      for (let t = 0; t < .12 - 1e-12; t += dt) lib.integrateBall(p, v, w, dt);
      return p;
    };
    const coarse = advance(.01), fine = advance(.005), reference = advance(.0005);
    const distance = q => Math.hypot(q.x - reference.x, q.y - reference.y, q.z - reference.z);
    assert.ok(distance(fine) < distance(coarse), `${distance(fine)} < ${distance(coarse)}`);
  });
  for (let i = 0; i < 7; i++) check(`production predictor default ${i}`, () => {
    const p = V3.new(.05 * (i - 3), 1.1 + i * .01, 1.0), v = V3.new(.1, .2, -5 - i * .1), w = V3.new(i * 5, 20, -i * 3);
    const a = lib.predict(V3.clone(p), V3.clone(v), V3.clone(w), { maxT: .18, out: {} });
    const b = lib.predict(V3.clone(p), V3.clone(v), V3.clone(w), { dt: PH.SIM_DT, maxT: .18, out: {} });
    assert.ok(finite(a.end) && finite(b.end));
    assert.ok(near(a.end.x, b.end.x, 1e-12) && near(a.end.y, b.end.y, 1e-12) && near(a.end.z, b.end.z, 1e-12));
  });

  // 271–300: admission state is distinct from the pointerdown sample. A
  // current accepted gate enters; a current rejected gate stays unavailable.
  for (let i = 0; i < 30; i++) check(`live admission ${i}`, () => {
    const expected = i % 2 === 0;
    const g = Object.create(lib.Game.prototype);
    g.time = 2 + i * .01; g.strokeTime = g.time;
    g.swipe = new lib.SwipeTracker(); g.swipe.down(.1, .1, 1, 1);
    g.swipe.pressZone = { accepted: false, startAccepted: false, contactEligible: false,
      pointerType: 'mouse', gestureId: g.swipe.gestureId };
    g.inputPointer = { x: .5, y: .5 };
    g.currentPressZone = () => ({ zone: { accepted: expected, score: expected ? .5 : 1.5,
      x: 500, y: 250, pointerX: 500, pointerY: 250 } });
    assert.equal(g.notePressProgress(g.inputPointer, 'mouse'), expected);
    assert.equal(g.pressAdmitsBall(), expected);
    assert.equal(g.swipe.pressZone.startAccepted, false);
  });

  assert.equal(checks, 300);
});
