const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

/* Подача глазами игрока: мяч в руке, затем бросок, затем удар.
 *
 * Три гейта на то, что видно в кадре, и один на сеть:
 *  · между очками мяч не перелетает через зал — его прячут на `serve.hold`;
 *  · в руке он стоит ровно там, откуда начнётся бросок;
 *  · кисть стоит ПОД мячом ещё в готовности, а не только с момента броска;
 *  · сеть регистрирует контакт там, где шаг пересёк плоскость, а не в конце
 *    шага (иначе мяч «проваливается сквозь сетку и его выталкивает»).
 */
const lib = load(['10_math.js', '12_match_rules.js', '25_career.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '42_shot_diagnostics.js', '43_input_telemetry.js', '55_ai.js', '56_rig.js', '57_camera.js',
  '59_replay.js', '70_game.js', '80_ui.js'],
  ['Game', 'GS', 'V3', 'Q', 'PH', 'STROKE_CONFIG', 'PADDLE_STANCE_Z', 'PADDLE_LIMITS', 'paddleLimitsFor',
    'parkServeBall', 'integrateBall', 'tableContact', 'netContactStep', 'netContactKind', 'MATCH_RULES']);
const { V3, PH, GS, STROKE_CONFIG } = lib;

function handFixture(extra = {}) {
  const g = Object.create(lib.Game.prototype);
  Object.assign(g, {
    settings: { hand: 'right', grip: 'shakehand' },
    player: { pos: V3.new(0.12, PH.TABLE_Y + 0.28, 1.45), prevPos: V3.new(), prev: V3.new(), vel: V3.new(),
      normal: V3.new(0, 0, -1), lastHitT: -9 },
    state: GS.SERVE_READY, server: 1, time: 5,
    ball: { live: false, p: V3.new(0, 0.9, 1.5), v: V3.new(), w: V3.new(), q: lib.Q.new(), lastHitBy: 0,
      hist: [], speed: 0 },
  }, extra);
  return g;
}

test('between points the held ball is hidden for exactly one serve.hold window', () => {
  const hold = STROKE_CONFIG.serve.hold;
  assert.ok(hold && hold.appear > 0.05 && hold.appear < 0.6, `hold.appear = ${hold && hold.appear}`);
  const g = handFixture();
  assert.equal(g.isHeldBallPending(), false, 'nothing is hidden while no point has ended');
  g._handover = { left: hold.appear };
  assert.equal(g.isHeldBallPending(), true);
  let t = 0, frames = 0;
  while (g.isHeldBallPending() && frames < 600) { g.tickHandover(1 / 60); t += 1 / 60; frames++; }
  assert.ok(frames > 1, 'the window must last more than one frame');
  assert.ok(t <= hold.appear + 1 / 60 + 1e-6, `hidden for ${t.toFixed(3)} s, window ${hold.appear}`);
  assert.ok(t > hold.appear - 0.05, `window cut short: ${t.toFixed(3)} s`);
  assert.equal(g._handover, null, 'the flag must clear itself');
  assert.equal(g.tickHandover(1 / 60), false, 'ticking afterwards is a no-op');
});

test('a pending handover still leaves the ball exactly at the toss origin', () => {
  const toss = STROKE_CONFIG.serve.toss;
  for (const hand of ['right', 'left']) {
    for (const padZ of [1.1, 1.45, 1.9, 2.6]) {
      const g = handFixture();
      g.settings.hand = hand;
      g.player.pos.z = padZ;
      g._handover = { left: STROKE_CONFIG.serve.hold.appear };
      g.holdBall(g.ball.p, 1 / 60);
      assert.ok(Math.abs(g.ball.p.y - (PH.TABLE_Y + toss.height)) < 1e-9, 'toss height is the hand height');
      assert.ok(g.ball.p.z >= PH.T_HALF_LEN + toss.endLineMargin - 1e-9, 'never inside the table');
      assert.ok(g.ball.p.z <= toss.farZ + 1e-9, 'never a metre off the end line');
      assert.equal(g.isHeldBallPending(), true, 'the ball keeps being hidden while it is parked');
    }
  }
});

test('the blade can physically stand under the held ball, not only under the toss', () => {
  const toss = STROKE_CONFIG.serve.toss, track = STROKE_CONFIG.serve.tracking;
  /* Цель подхвата — `ball.y - tracking.underBall`. Если она вылезает за пределы
   * объёма ракетки, клинок физически не может встать под мяч, и на броске
   * получается рывок (замер: 1.21 м → 1.01 м за 6 кадров). */
  assert.ok(track.underBall > 0 && track.underBall < toss.height,
    'the blade must sit below the ball, above the table');
  const under = PH.TABLE_Y + toss.height - track.underBall;
  const lim = lib.paddleLimitsFor(lib.PADDLE_STANCE_Z);
  assert.ok(under >= PH.TABLE_Y + lim.yLo - 1e-9,
    `under-ball height ${under.toFixed(3)} is below the blade volume`);
  assert.ok(under <= PH.TABLE_Y + lim.yHi + 1e-9,
    `under-ball height ${under.toFixed(3)} is above the blade volume`);
  assert.ok(lib.MATCH_RULES !== undefined);
  assert.ok(lib.PADDLE_STANCE_Z > PH.T_HALF_LEN, 'the stance lives behind the end line');
});

test('the serve is served from the hand the handover left it in', () => {
  const g = handFixture();
  g._handover = { left: STROKE_CONFIG.serve.hold.appear };
  g.setState = (next) => { g.state = next; return next; };   // реальный setState тянет рендер
  g.audio = { ui() {} }; g.recenterT = 0; g.tossQueued = false;
  g.holdBall(g.ball.p, 1 / 60);
  const hand = V3.clone(g.ball.p);
  g.startToss();
  assert.equal(g.isHeldBallPending(), false, 'a toss makes the ball visible at once');
  const toss = STROKE_CONFIG.serve.toss;
  assert.ok(Math.abs(g.ball.p.y - hand.y) < 1e-9, 'the toss starts from the hand, not from a ready marker');
  assert.ok(g.ball.p.z >= PH.T_HALF_LEN + toss.endLineMargin - 1e-9);
  assert.ok(g.ball.v.y > 1.5, 'the toss is a real upward throw');
  assert.equal(g.state, GS.SERVE_TOSS);
});

test('the net reports and resolves the crossing of the step, not its end', () => {
  const g = handFixture({
    state: GS.RALLY, time: 2,
    ball: { live: true, p: V3.new(0.10, 0.85, 0.06), v: V3.new(3, 0, -6), w: V3.new(), q: lib.Q.new(),
      lastHitBy: 1, hist: [], speed: 0, trailGrade: null, golden: null },
    rallyBounces: [1], stats: {},
    audio: { hitNet() {}, hitEdge() {}, hitFloor() {} },
    moments: { addBounce() {} }, watchdog: null, shotJournal: null,
    emitParticles() {}, msg() {}, punchSlowmo() {}, buzz() {}, shakeIt() {},
    onBounce() {}, onFloor() {}, settleDeadBall() {}, awardPoint() {},
    _trailCrumb() {}, tryPlayerHit() {}, watchdogSubstep() {}, updateShotDiagnostics() {},
  });
  /* Что дал бы шаг без контакта — тот самый «конец шага», за который раньше
   * отвечала сеть. */
  const px = V3.clone(g.ball.p), pv = V3.clone(g.ball.v), pw = V3.clone(g.ball.w);
  lib.integrateBall(px, pv, pw, 0.02);
  assert.ok(px.z < 0, 'the sample step really does cross the plane');
  assert.equal(lib.netContactKind(0.85, px.x), 1, 'and the crossing is on the mesh');
  g.stepPhysics(0.02);
  const p = g.ball.p;
  assert.ok(Math.abs(p.z - (PH.R + 0.004)) < 1e-9, `the ball is pushed clear of the mesh, z = ${p.z}`);
  const toEnd = Math.abs(px.x - 0.10), got = Math.abs(p.x - 0.10);
  assert.ok(got > 0, 'the contact must keep the lateral travel it really had');
  assert.ok(got < toEnd * 0.75, `contact recorded at ${got.toFixed(4)} m of a ${toEnd.toFixed(4)} m step`);
  assert.ok(Math.abs(p.y - 0.85) < 0.01, `contact height ${p.y.toFixed(4)} stays on the segment`);
});
