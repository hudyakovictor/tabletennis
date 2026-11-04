'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '30_physics.js', '40_swipe.js', '55_ai.js'], [
  'OpponentAI', 'AI_LEVELS', 'PH', 'V3', 'predict', 'bounceTable', 'paddleTableClearance', 'resolveRacketLaunch',
]);
const { PH, V3 } = lib;

function fixture(level = 3, beforeBounce = false, vz = -.3) {
  const ai = new lib.OpponentAI(level);
  ai.rng = () => .5;
  const ball = { p: V3.new(.1, PH.TABLE_Y + (beforeBounce ? .32 : .25), beforeBounce ? .18 : -.25),
    v: V3.new(.05, beforeBounce ? -.1 : .5, beforeBounce ? -1.2 : vz), w: V3.new(),
    live: true, lastHitBy: 1, golden: null };
  return { ai, ball, aiPaddle: { normal: ai.faceNormal, roll: ai.roll },
    player: { pos: V3.new(.2, PH.TABLE_Y, 1.15) }, time: 100, strokeTime: 10,
    shotId: 1, rally: 1, netTouched: false, isServeBall: false,
    rallyBounces: beforeBounce ? [] : [-1] };
}

function assertFutureContact(game, plan) {
  assert.ok(plan, 'a legal short ball has a plan');
  for (const key of ['x', 'y', 'z', 't', 'speed', 'bounceT'])
    assert.ok(Number.isFinite(plan[key]), `${key} is finite`);
  const bounced = game.rallyBounces.includes(-1);
  const deadline = lib.predict(game.ball.p, game.ball.v, game.ball.w,
    { dt: PH.SIM_DT, maxT: 2.4, stopAfterBounces: bounced ? 1 : 2 });
  const nextBounce = bounced ? deadline.landed : deadline.b2;
  assert.ok(nextBounce, 'fixture really dies on the table');
  const lead = plan.t - game.strokeTime;
  assert.ok(lead > 0 && lead < nextBounce.t, `future contact ${lead} precedes the dead bounce ${nextBounce.t}`);
  if (bounced) assert.equal(plan.bounceT, 0, 'the next bounce is not treated as the first legal bounce');
  else assert.ok(lead > deadline.landed.t, 'never plan a volley before the first own-court bounce');
  const contact = lib.predict(game.ball.p, game.ball.v, game.ball.w,
    { dt: PH.SIM_DT, maxT: lead, stopAfterBounces: bounced ? 1 : 2 });
  assert.equal(contact.hitNet, false);
  assert.equal(contact.bounces, bounced ? 0 : 1, 'contact stays inside the legal return interval');
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(plan[axis] - contact.end[axis]) < .025,
    `${axis}: planned ${plan[axis]} must be an actual ball position ${contact.end[axis]}`);
  assert.equal(plan.willLandIn, true);
  assert.equal(plan.short, true);
  assert.ok(plan.z > -.75 && game.ai.noisyTarget(plan, game).z > -.8, 'the target permits stepping in near the net');
}

test('short post-bounce plans are finite actual future contacts before the next bounce, including zero/reversed vz', () => {
  for (let level = 0; level < lib.AI_LEVELS.length; level++) for (const vz of [-.3, 0, .3]) {
    const game = fixture(level, false, vz), before = JSON.stringify(game.ball);
    assertFutureContact(game, game.ai.computePlan(game));
    assert.equal(JSON.stringify(game.ball), before, 'planning never mutates the live ball');
  }
});

test('a short incoming ball is planned after its first own bounce, not after its second', () => {
  for (let level = 0; level < lib.AI_LEVELS.length; level++) {
    const game = fixture(level, true);
    assertFutureContact(game, game.ai.computePlan(game));
  }
});

test('a legal post-bounce ball still gets a plan when neither a future table landing nor the deep plane exists', () => {
  const game = fixture();
  V3.set(game.ball.p, .65, PH.TABLE_Y + .15, -.30);
  V3.set(game.ball.v, 1.8, .5, -.2);
  const flight = lib.predict(game.ball.p, game.ball.v, game.ball.w,
    { dt: PH.SIM_DT, maxT: 2.4, stopZ: -PH.T_HALF_LEN - .26, stopDir: -1 });
  assert.equal(flight.landed, null); assert.equal(flight.reach, null);
  const plan = game.ai.computePlan(game);
  assert.ok(plan && plan.t > game.strokeTime && plan.t < game.strokeTime + flight.floor.t);
  const at = lib.predict(game.ball.p, game.ball.v, game.ball.w,
    { dt: PH.SIM_DT, maxT: plan.t - game.strokeTime });
  assert.ok(V3.dist(plan, at.end) < .025, 'fallback follows the real airborne ball, not a synthetic deep target');
});

test('out flights and already-dead double bounces cannot produce a return plan', () => {
  for (const kind of ['out', 'double']) {
    const game = fixture();
    if (kind === 'out') {
      game.rallyBounces = [];
      V3.set(game.ball.p, .1, PH.TABLE_Y + .60, .2); V3.set(game.ball.v, 0, 0, -12);
      const flight = lib.predict(game.ball.p, game.ball.v, game.ball.w,
        { maxT: 2.4, stopZ: -PH.T_HALF_LEN - .26, stopDir: -1 });
      assert.equal(flight.landed, null); assert.ok(flight.reach, 'old deep-plane fallback would attempt this out ball');
    } else game.rallyBounces.push(-1);
    assert.equal(game.ai.computePlan(game), null, kind);
    game.ai.think(game, 1 / 60);
    assert.equal(game.ai.plan, null); assert.equal(game.ai.commit, null);
  }
});

test('think approaches stationary/reversing legal short balls without bypassing level reaction', () => {
  for (let level = 0; level < lib.AI_LEVELS.length; level++) for (const vz of [0, .3]) {
    const game = fixture(level, false, vz), ai = game.ai;
    V3.set(ai.pos, .1, PH.TABLE_Y + .25, -.55); V3.copy(ai._moveSmooth, ai.pos); V3.copy(ai.lastPos, ai.pos);
    const start = V3.clone(ai.pos);
    ai.think(game, 1 / 60);
    assert.ok(ai.plan && ai.pos.z > start.z, 'a short legal ball is approached even without negative vz');
    assert.equal(ai.commit, null);
    const deadline = ai._reactUntil;
    game.strokeTime = deadline - .001; ai.think(game, 1 / 60);
    assert.equal(ai.commit, null, 'no decision before the level deadline');
    game.strokeTime = deadline + .001; ai.think(game, 1 / 60);
    assert.ok(ai.commit, 'decision is made only after the original reaction delay');
  }
});

test('a reachable short post-bounce flight is physically approached and solved before its dead bounce', () => {
  for (const vz of [-.3, 0, .3]) {
    const game = fixture(3, false, vz), ai = game.ai;
    ai.rng = () => .99;
    V3.set(ai.pos, .1, PH.TABLE_Y + .25, -.55); V3.copy(ai._moveSmooth, ai.pos); V3.copy(ai.lastPos, ai.pos);
    const source = { p: V3.clone(game.ball.p), v: V3.clone(game.ball.v), w: V3.clone(game.ball.w) };
    const end = lib.predict(source.p, source.v, source.w,
      { dt: PH.SIM_DT, maxT: 2.4, stopOnFirstBounce: true });
    assert.ok(end.landed, 'next bounce ends this legal return interval');
    ai.think(game, 1 / 120);
    let returned = false;
    for (let i = 1; i < 120 && i / 120 < end.landed.t; i++) {
      const live = lib.predict(source.p, source.v, source.w,
        { dt: PH.SIM_DT, maxT: i / 120, stopOnFirstBounce: true });
      if (live.landed) break;
      V3.copy(game.ball.p, live.end); V3.copy(game.ball.v, live.endV); V3.copy(game.ball.w, live.endW);
      game.strokeTime = 10 + live.endT;
      const previous = V3.clone(ai.pos);
      ai.think(game, 1 / 120);
      assert.ok(V3.dist(ai.pos, previous) <= ai.maxSpeed / 120 + 1e-9, 'no teleport to make the short return');
      if (!ai.commit || game.strokeTime < ai.swingAt || V3.dist(game.ball.p, ai.pos) > .42) continue;
      assert.ok(game.strokeTime >= 10 + ai.L.react && game.strokeTime < 10 + end.landed.t);
      const before = JSON.stringify(game.ball), racket = ai.swing(game);
      assert.equal(JSON.stringify(game.ball), before);
      assert.ok(racket && racket.valid !== false && lib.resolveRacketLaunch(game.ball, racket), 'actual physical contact');
      assert.equal(ai._flightLegal(game.ball, racket, false), true, 'the solved return really lands on the other court');
      returned = true;
      break;
    }
    assert.equal(returned, true, `reachable short vz=${vz} must be approached and returned before its second bounce`);
  }
});

test('the actual first own bounce refreshes perception without rerolling noise, reaction or committed tactics', () => {
  for (const level of [0, 3]) {
    const game = fixture(level, true), ai = game.ai;
    let draws = 0; ai.rng = () => { draws++; return .5; };
    ai.think(game, 1 / 60);
    const reaction = ai._reactUntil;
    if (level === 3) { game.strokeTime = reaction + .001; ai.think(game, 1 / 60); }
    const previous = ai.plan, commit = ai.commit, selected = draws, readT = ai.readT, windup = ai.backswingStart;
    const first = lib.predict(game.ball.p, game.ball.v, game.ball.w,
      { dt: PH.SIM_DT, maxT: 2.4, stopOnFirstBounce: true });
    V3.copy(game.ball.p, first.end); V3.copy(game.ball.v, first.endV); V3.copy(game.ball.w, first.endW);
    lib.bounceTable(game.ball.p, game.ball.v, game.ball.w);
    game.rallyBounces.push(-1); game.strokeTime = 10 + first.endT;
    ai.think(game, 1 / 60);
    assert.ok(ai.plan && ai.plan !== previous, 'refresh the previously cached pre-bounce prediction');
    assert.equal(ai.plan.bounceT, 0); assert.equal(ai._reactUntil, reaction);
    assert.equal(ai.plan.errUnitX, previous.errUnitX); assert.equal(ai.plan.errUnitY, previous.errUnitY);
    assert.equal(draws, selected, 'reading the bounce does not spend new tactic or noise draws');
    if (commit) {
      assert.equal(ai.commit.archId, commit.archId); assert.equal(ai.commit.aim, commit.aim);
      assert.equal(ai.readT, readT); assert.equal(ai.backswingStart, windup); assert.equal(ai.swingAt, ai.plan.t);
    } else assert.equal(ai.commit, null, 'EASY is still waiting on its original reaction deadline');
    assertFutureContact(game, ai.plan);
  }
});

test('intentional golden winners remain unread and unreturned even on a stationary post-bounce ball', () => {
  const game = fixture(3, false, 0), ai = game.ai, before = V3.clone(ai.pos);
  let reads = 0; ai.computePlan = () => { reads++; throw new Error('golden winners must not be read'); };
  game.ball.golden = 'win';
  ai.think(game, 1 / 60);
  assert.equal(reads, 0); assert.equal(ai.plan, null); assert.equal(ai.commit, null);
  assert.equal(ai.phase, 'IDLE'); assert.equal(V3.dist(ai.pos, before), 0);
});

test('AI translation obeys the combined level/Career speed cap and resynchronizes external live poses', () => {
  for (let level = 0; level < lib.AI_LEVELS.length; level++) for (const dt of [1 / 30, 1 / 60, 1 / 120]) {
    const game = fixture(level), ai = game.ai;
    ai.maxSpeed *= .6; ai.seenBallId = game.shotId; ai.phase = 'READY';
    ai.plan = { x: 1.1, y: PH.TABLE_Y + .55, z: -.3, t: 11, speed: 5, bounceT: 0, errUnitX: 0, errUnitY: 0 };
    const identity = ai.pos;
    for (let i = 0; i < 12; i++) {
      if (i === 4) {
        V3.set(ai.pos, -.4, PH.TABLE_Y + .3, -.7); // Game contact/follow-through owns this live pose.
        ai.plan.x = -.95;
      }
      const previous = V3.clone(ai.pos);
      ai.think(game, dt); game.strokeTime += dt;
      const distance = V3.dist(ai.pos, previous);
      assert.ok(distance > 0 && distance <= ai.maxSpeed * dt + 1e-9,
        `${ai.L.name}/${dt}: actual step ${distance} exceeds ${ai.maxSpeed * dt}`);
      assert.equal(ai.pos, identity); assert.ok(V3.dist(ai.pos, ai._moveSmooth) < 1e-12);
      assert.ok(Math.abs(V3.len(ai.vel) - distance / dt) < 1e-9, 'velocity starts at the live pose, not stale lastPos');
      assert.ok(lib.paddleTableClearance(ai.pos, ai.faceNormal, ai.roll) >= -1e-6);
    }
  }
});

test('a low outside recovery cannot cross the table edge by exceeding the AI translation speed cap', () => {
  const game = fixture(0), ai = game.ai;
  V3.set(ai.pos, 0, PH.TABLE_Y - .04, -PH.T_HALF_LEN - .15);
  V3.copy(ai._moveSmooth, ai.pos); V3.copy(ai.lastPos, ai.pos);
  ai.seenBallId = game.shotId; ai.phase = 'READY';
  ai.plan = { x: 0, y: PH.TABLE_Y - .04, z: -1.1, t: 11, speed: 5, bounceT: 0, errUnitX: 0, errUnitY: 0 };
  for (let i = 0; i < 120; i++) {
    const previous = V3.clone(ai.pos);
    ai.think(game, 1 / 60); game.strokeTime += 1 / 60;
    assert.ok(V3.dist(ai.pos, previous) <= ai.maxSpeed / 60 + 1e-9, 'clearance correction may not teleport the center');
    assert.ok(lib.paddleTableClearance(ai.pos, ai.faceNormal, ai.roll) >= -1e-6, 'the same center remains above the tabletop');
  }
  assert.ok(ai.pos.z > -1.25, 'a safe bounded recovery still makes forward progress');
});
