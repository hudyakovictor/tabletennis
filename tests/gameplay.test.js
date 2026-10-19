const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '56_rig.js', '57_camera.js', '70_game.js'],
  ['PH', 'predict', 'netContactKind', 'netAtX', 'MATCH_RULES', 'Game', 'GS', 'V3', 'SwipeTracker']);
const { PH, V3, GS } = lib;

/* A real, accepted flick: the only thing that makes `playerStrokeIntent`
 * return a gesture. Everything else in the fixture is the minimum the
 * refusal paths touch. */
function gesture(g, x = .5, y = .55) {
  const sw = g.swipe;
  let t = g.time;
  sw.down(x, y, t);
  for (let i = 1; i <= 4; i++) { t += .012; sw.move(x + .004 * i, y - .03 * i, t); }
  t += .01; sw.up(x + .03, y - .16, t);
  g.time = t; g.swipeReleasedAt = t;
  sw.pressZone = { accepted: true, radius: 48, distancePx: 0 };
}

function fixture(overrides = {}) {
  const g = Object.create(lib.Game.prototype);
  Object.assign(g, {
    time: 1, state: GS.RALLY, server: 1, isServeBall: false, tossApex: 1.4,
    settings: { grip: 'shakehand', hand: 'right' },
    ball: { live: true, p: V3.new(0, 1.20, 1.20), v: V3.new(0, 0, 4), w: V3.new(), lastHitBy: -1 },
    player: { pos: V3.new(0, 1.20, 1.44), prevPos: V3.new(0, 1.20, 1.44), normal: V3.new(0, 0, -1) },
    aiPaddle: { pos: V3.new(0, 1.20, -1.44), normal: V3.new(0, 0, 1) },
    ai: { plan: null, readyToStrike: () => true, pos: V3.new(0, 1.20, -1.44) },
    swipe: new lib.SwipeTracker(), swipeReleasedAt: -Infinity, rallyBounces: [],
  }, overrides);
  gesture(g);
  g.applyHit = () => { g._hitCalls = (g._hitCalls || 0) + 1; };
  return g;
}

test('a serve or rally ball may not be volleyed out of the air', () => {
  // The ball is inside the capture box and the flick is real, but it has not
  // bounced on the player's court yet: ITTF 2.07 makes a return impossible.
  const g = fixture();
  g.tryPlayerHit({ ...g.ball.p });
  assert.equal(g._hitCalls || 0, 0);
  assert.equal(g.ball.lastHitBy, -1);
});

test('the same ball is contactable once it has bounced on the player half', () => {
  // The gate is the bounce, not the geometry: swap only rallyBounces and the
  // contact path (not the gate) is what decides the outcome. We assert the
  // gate no longer rejects by checking the measurement is published.
  const g = fixture({ rallyBounces: [1] });
  let measured = 0;
  g.shotJournal = { observeCapture() { measured++; } };
  try { g.tryPlayerHit({ ...g.ball.p }); } catch (e) { /* deep stroke path is out of scope here */ }
  assert.equal(measured, 1);
});

test('the opponent may not return an un-bounced serve either', () => {
  const g = fixture({
    isServeBall: true,
    ball: { live: true, p: V3.new(0, 1.20, -1.20), v: V3.new(0, 0, -4), w: V3.new(), lastHitBy: 1 },
    ai: { plan: {}, readyToStrike: () => true, pos: V3.new(0, 1.20, -1.44), swing: () => ({}) },
  });
  g.tryAiHit();
  assert.equal(g._hitCalls || 0, 0);
  assert.equal(g.ball.lastHitBy, 1);
});

test('no stroke exists after the point has been awarded', () => {
  const g = fixture({ state: GS.POINT, rallyBounces: [1] });
  g.tryPlayerHit({ ...g.ball.p });
  assert.equal(g._hitCalls || 0, 0);
  assert.equal(g.ball.lastHitBy, -1);
  const ai = fixture({
    state: GS.POINT, ball: { live: true, p: V3.new(0, 1.20, -1.20), v: V3.new(0, 0, -4), w: V3.new(), lastHitBy: 1 },
    rallyBounces: [-1], ai: { plan: {}, readyToStrike: () => true, pos: V3.new(0, 1.20, -1.44), swing: () => ({}) },
  });
  ai.tryAiHit();
  assert.equal(ai._hitCalls || 0, 0);
});

test('the net is not a wall below the tabletop', () => {
  const o = {};
  lib.predict(V3.new(0, 0.30, 0.40), V3.new(0, 0, -3), V3.new(),
    { dt: PH.SIM_DT, maxT: 1.2, out: o });
  assert.equal(o.hitNet, false, 'a ball under the table must pass under the net');
  assert.ok(o.floor && o.floor.z < 0, 'and reach the floor on the far side');
});

test('the tape and the space just above it are the same object for solvers and play', () => {
  const contact = (y) => {
    const o = {};
    lib.predict(V3.new(0, y, 0.10), V3.new(0, -0.2, -6), V3.new(),
      { dt: PH.SIM_DT, maxT: 0.35, out: o });
    return !!o.hitNet;
  };
  assert.equal(lib.netContactKind(PH.NET_TOP - 0.005), 2, 'a surface overlapping the tape clips it');
  assert.equal(lib.netContactKind(PH.NET_TOP + PH.R + 0.001), 0, 'a ball clear of the tape misses it');
  assert.equal(contact(PH.NET_TOP - 0.005), true);
  assert.equal(contact(PH.NET_TOP + PH.R + 0.02), false);
});

test('an end-line ball is judged at its surface contact point, not the step end', () => {
  // Starts one substep before the surface reaches the table, exactly on the
  // end line: the contact point is inside REACH_Z even though the step end is
  // outside it. predict and the live handler must agree it bounced.
  const o = {};
  lib.predict(V3.new(0, PH.TABLE_Y + PH.R + 0.002, -PH.TABLE_REACH_Z + 0.004),
    V3.new(0, -3, -6), V3.new(), { dt: PH.SIM_DT, maxT: 0.4, stopOnFirstBounce: true, out: o });
  assert.ok(o.landed, 'the ball touched the table');
  assert.ok(Math.abs(o.landed.z) <= PH.TABLE_REACH_Z);
});
