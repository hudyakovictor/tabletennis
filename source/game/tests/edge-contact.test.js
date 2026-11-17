'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '55_ai.js', '59_replay.js', '70_game.js'],
['V3', 'Q', 'PH', 'Stamina', 'predict', 'OpponentAI', 'PaddleStrokeMotion', 'paddleContactPose',
  'paddlePoseQuaternion', 'MomentPlayer', 'Game', 'GS', 'resolveRacketLaunch', 'resolvedRacketFrame',
  'strokeIdentityMatches', 'impactRacket']);
const { V3, PH } = lib;

test('edge-glance candidate does not mutate live ball spin before contact is confirmed', () => {
  const spin = V3.new(13, -7, 4);
  const game = Object.create(lib.Game.prototype);
  game.ball = { p: V3.new(0, PH.TABLE_Y + .3, .5), v: V3.new(0, -3, 4), w: V3.clone(spin) };
  game.player = { vel: V3.new() };
  const racket = game._glanceRacket({ right: .2, releaseSpeed: 1 }, game.ball.p, false, {}, null);
  assert.ok(racket.glanceSpin, 'candidate retains its own randomized edge-spin impulse');
  assert.deepEqual({ ...game.ball.w }, { ...spin }, 'building an edge candidate leaves the live ball untouched');
});

test('a separating edge glance commits neither its candidate spin nor an impulse', () => {
  const ball = { v: V3.new(0, 1, 0), w: V3.new(2, 3, 4) };
  const before = { v: V3.clone(ball.v), w: V3.clone(ball.w) };
  const game = Object.create(lib.Game.prototype); game.ball = ball;
  const result = game.resolvePlayerRacketImpact({ normal: V3.new(0, 1, 0), vR: V3.new(),
    rubber: {}, glanceSpin: V3.new(20, -30, 40) }, 1);
  assert.equal(result, null, 'an outward-moving ball separates from this face');
  assert.deepEqual({ ...ball.v }, { ...before.v });
  assert.deepEqual({ ...ball.w }, { ...before.w });
});

test('a confirmed edge glance commits its candidate spin before resolving the impulse', () => {
  const ball = { v: V3.new(0, -4, 0), w: V3.new(2, 3, 4) };
  const game = Object.create(lib.Game.prototype); game.ball = ball;
  const delta = V3.new(20, -30, 40);
  const expectedV = V3.clone(ball.v), expectedW = V3.add(V3.clone(ball.w), ball.w, delta);
  const expected = lib.impactRacket(expectedV, expectedW, V3.new(0, 1, 0), V3.new(), 1, {});
  const result = game.resolvePlayerRacketImpact({ normal: V3.new(0, 1, 0), vR: V3.new(),
    rubber: {}, glanceSpin: delta }, 1);
  assert.ok(result && expected);
  assert.deepEqual({ ...ball.v }, { ...expectedV });
  assert.deepEqual({ ...ball.w }, { ...expectedW });
});

test('player contact keeps the end-of-sweep position and rate-limits the visible face turn', () => {
  const fromQ = lib.paddlePoseQuaternion(V3.new(0, -.6, -.8), .28);
  const targetNormal = V3.norm(V3.new(), V3.new(.7, .2, -.68));
  const targetQ = lib.paddlePoseQuaternion(targetNormal, .9);
  const frameEndPos = V3.new(.42, 1.11, 1.92);
  const pad = { pos: V3.new(-.1, 1.02, 1.7), normal: V3.new(0, -1, 0),
    q: lib.Q.copy(lib.Q.new(), fromQ), roll: .28, activeFace: 1 };
  const game = Object.create(lib.Game.prototype); game.player = pad;
  const contactPose = { pos: V3.new(-.35, 1.35, 1.4), normal: targetNormal, q: targetQ,
    roll: .9, activeFace: 1 };
  const fraction = game.setPlayerContactPose(contactPose, frameEndPos, fromQ, 1 / 60);
  assert.deepEqual({ ...pad.pos }, { ...frameEndPos }, 'CCD contact must not rewind the paddle to its impact substep');
  assert.ok(fraction > 0 && fraction < 1, 'large turn is blended rather than snapped');
  const dot = Math.abs(pad.q.x * fromQ.x + pad.q.y * fromQ.y + pad.q.z * fromQ.z + pad.q.w * fromQ.w);
  assert.ok(2 * Math.acos(Math.min(1, dot)) <= 18 / 60 + 1e-8);
  assert.ok(Math.abs(pad.roll - .28) < Math.abs(.9 - .28), 'roll follows the same bounded contact transition');
  assert.ok(Math.abs(V3.len(pad.normal) - 1) < 1e-9);
  assert.deepEqual(pad.contactPose, contactPose, 'the solved physical contact remains available for diagnostics');
});

test('reused trajectory output does not report an earlier net or edge collision', () => {
  const out = {};
  const intoNet = lib.predict(V3.new(0, PH.TABLE_Y + .45, -1.1), V3.new(0, 0, 4), V3.new(), { out });
  assert.equal(intoNet.hitNet, true, 'fixture must actually hit the net');
  lib.predict(V3.new(0, PH.TABLE_Y + .55, 1.2), V3.new(0, 2.2, -3.2), V3.new(), { out });
  assert.equal(out.hitNet, false, 'a reused report must not remember the previous net');
  assert.equal(out.edge, 0, 'a reused report must not remember the previous edge');
  assert.equal(out.edgeBounce, null);
});
