'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '30_physics.js', '40_swipe.js', '70_game.js'],
  ['Game', 'GS', 'PH', 'V3', 'Q', 'predict']);
const { Game, GS, PH, V3, Q, predict } = lib;

for (const axis of ['x', 'z']) for (const sign of [-1, 1]) for (const direction of [-1, 1])
  for (const descent of [.1, .35, 2]) {
    test(`live/predicted edge: ${axis}/${sign}/${direction}/vy=${descent}`, () => {
      const p = V3.new(.2, PH.TABLE_Y + PH.R + .0001, .4);
      p[axis] = sign * ((axis === 'x' ? PH.T_HALF_WID : PH.T_HALF_LEN) - .001);
      const v = V3.new(.05, -descent, .05); v[axis] = sign * direction * .5;
      const w = V3.new(30, -20, 15);
      const prediction = predict(p, v, w, { dt: PH.SIM_DT, maxT: PH.SIM_DT });
      assert.equal(prediction.bounces, 1);
      const g = Object.create(Game.prototype), calls = [];
      Object.assign(g, { time: 1, state: GS.RALLY, stats: {},
        ball: { p: V3.clone(p), v: V3.clone(v), w: V3.clone(w), q: Q.new(), live: true, lastHitBy: -1 },
        player: { lastHitT: 1 }, audio: { hitEdge() {}, hitNet() {}, hitFloor() {} },
        onBounce(side, speed, info) { calls.push({ side, speed, info }); },
        msg() {}, shakeIt() {}, _trailCrumb() {}, watchdogSubstep() {} });
      g.stepPhysics(PH.SIM_DT);
      assert.equal(calls.length, 1);
      assert.ok(calls[0].info.edge > .25);
      for (const [actual, expected] of [[g.ball.p, prediction.end], [g.ball.v, prediction.endV], [g.ball.w, prediction.endW]])
        for (const coord of ['x', 'y', 'z']) assert.ok(Math.abs(actual[coord] - expected[coord]) < 1e-8,
          `${coord}: live ${actual[coord]}, predicted ${expected[coord]}`);
    });
  }

test('slow edge bounces remain real contacts and a second receiver bounce ends the point', () => {
  const g = Object.create(Game.prototype), contacts = [];
  let edgeSounds = 0, tableSounds = 0, edgeFeedback = 0, winner = 0;
  Object.assign(g, { time: 1, state: GS.RALLY, stats: {}, rallyBounces: [], isServeBall: false,
    ball: { p: V3.new(PH.T_HALF_WID - .001, PH.TABLE_Y + PH.R + .001, .5),
      v: V3.new(0, -.35, 0), w: V3.new(), q: Q.new(), live: true, lastHitBy: -1 },
    player: { lastHitT: 1 }, audio: { hitEdge() { edgeSounds++; }, hitTable() { tableSounds++; }, hitNet() {}, hitFloor() {} },
    recorder: { addBounce() {} }, watchdog: { tableContact(e) { contacts.push(e); } },
    msg() { edgeFeedback++; }, shakeIt() {}, _trailCrumb() {}, watchdogSubstep() {}, addMark() {}, emitParticles() {},
    awardPoint(who) { winner = who; this.ball.live = false; } });
  for (let i = 0; i < 600 && g.ball.live; i++) {
    g.time += 1 / 600; g.player.lastHitT = g.time; g.stepPhysics(1 / 600);
  }
  assert.equal(contacts.length, 2);
  assert.ok(contacts.every(c => c.edge > .25));
  assert.ok(contacts[1].time - contacts[0].time < .35);
  assert.equal(winner, -1, 'receiver failed to return before the second bounce');
  assert.equal(g.ball.live, false);
  assert.equal(edgeFeedback, 1, 'visual edge feedback stays rate-limited');
  assert.equal(tableSounds, 2, 'every real collision has one dry table cue, even two close edge bounces');
  assert.equal(edgeSounds, 0, 'an edge does not add a second transient over the base contact');
});

test('recorded weak-normal edge witness has one live/predicted contact and cannot award a premature point', () => {
  const p = V3.new(.37435006549318794, 1.4956347050357772, 1.200767946336776);
  const v = V3.new(-.9023632048174567, .4692986016484436, -7.654537023117085);
  const w = V3.new(-28.177399564617033, -13.783426272581995, 6.400938055664742);
  const dt = PH.SIM_DT, steps = 270, forecast = predict(p, v, w, { dt, maxT: steps * dt - 1e-9 });
  let contacts = 0, winner = 0;
  const g = Object.create(Game.prototype);
  Object.assign(g, { time: 1, state: GS.RALLY, stats: {}, rallyBounces: [], isServeBall: false,
    ball: { p: V3.clone(p), v: V3.clone(v), w: V3.clone(w), q: Q.new(), live: true, lastHitBy: 1 },
    player: { lastHitT: 1 }, audio: { hitTable() {}, hitNet() {}, hitFloor() {} },
    recorder: { addBounce() {} }, watchdog: { tableContact() { contacts++; } },
    msg() {}, shakeIt() {}, _trailCrumb() {}, watchdogSubstep() {}, addMark() {}, emitParticles() {},
    awardPoint(who) { winner = who; this.ball.live = false; } });
  for (let i = 0; i < steps && g.ball.live; i++) {
    g.time += dt; g.player.lastHitT = g.time; g.stepPhysics(dt);
  }
  assert.equal(contacts, 1); assert.equal(forecast.bounces, 1); assert.equal(forecast.b2, null);
  assert.equal(winner, 0); assert.equal(g.ball.live, true);
  for (const [actual, expected] of [[g.ball.p, forecast.end], [g.ball.v, forecast.endV], [g.ball.w, forecast.endW]]) {
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-8, axis + ' live/predicted parity');
  }
});
