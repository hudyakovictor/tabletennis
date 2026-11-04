'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '40_swipe.js', '55_ai.js', '59_replay.js', '70_game.js'],
  ['V3', 'PH', 'predict', 'OpponentAI', 'PaddleStrokeMotion', 'paddleContactPose', 'MomentPlayer', 'Game', 'GS']);
const { V3, PH } = lib;

test('reused trajectory output does not report an earlier net or edge collision', () => {
  const out = {};
  lib.predict(V3.new(0, PH.TABLE_Y + .06, .1), V3.new(0, 0, -4), V3.new(), { out });
  assert.equal(out.hitNet, true);
  assert.ok(out.netKind > 0);
  out.edgeBounce = { x: 99 };
  lib.predict(V3.new(0, PH.TABLE_Y + 1, .7), V3.new(0, 1, 0), V3.new(), { maxT: .01, out });
  assert.equal(out.hitNet, false);
  assert.equal(out.netKind, null);
  assert.equal(out.edgeBounce, null);
  assert.equal(out.edge, 0);
});

test('invalid predictor time steps cannot trap the game in an infinite loop', () => {
  for (const dt of [-1, NaN, Infinity, 0]) {
    const result = lib.predict(V3.new(0, 2, 1), V3.new(), V3.new(), { dt, maxT: .02 });
    assert.ok(Number.isFinite(result.endT) && result.endT >= .02 && result.endT < .03);
  }
});

test('AI constructor normalizes difficulty exactly like a later level change', () => {
  for (const [value, expected] of [['2', 2], [1.6, 2], [NaN, 0], [Infinity, 0], [-4, 0], [100, 3]]) {
    const ai = new lib.OpponentAI(value);
    assert.equal(ai.levelIndex, expected);
    assert.ok(Number.isFinite(ai.maxSpeed));
  }
});

test('disabled follow-through is honored for an actual template-backed contact', () => {
  for (const stroke of ['DRIVE', 'CHOP', 'SERVE_TOP']) {
    const normal = V3.new(0, 0, -1), racket = { normal, vR: V3.new(0, 0, -4) };
    const pose = lib.paddleContactPose(V3.new(0, PH.TABLE_Y + .4, 1.5), racket, { roll: .28 });
    assert.ok(pose);
    const motion = new lib.PaddleStrokeMotion();
    motion.contact(normal, pose.roll, stroke, 'shakehand', 'right', true, false, { pose, racket, side: 1 });
    assert.equal(motion.templateMotion, null);
    const ready = { yaw: 0, pitch: 0, roll: .28 };
    assert.equal(motion.sample(0, ready).stage, 'contact');
    assert.notEqual(motion.sample(motion.profile.hold + .001, ready).stage, 'follow');
  }
});

test('replay draws recorded faces rather than stale live quaternions', () => {
  const frames = new Float32Array(32);
  for (let i = 0; i < 2; i++) { frames[i * 16 + 8] = -1; frames[i * 16 + 14] = 1; frames[i * 16 + 15] = .3; }
  const player = new lib.MomentPlayer();
  const g = { ball: { p: V3.new(), v: V3.new(), w: V3.new(), hist: [] },
    player: { pos: V3.new(), normal: V3.new(), poseReady: true },
    aiPaddle: { pos: V3.new(), normal: V3.new(), poseReady: true }, ai: { pos: V3.new() } };
  assert.equal(player.play({ frames, hz: 30, poseVersion: 2 }, 1), true);
  player.update(.01, g);
  assert.equal(g.player.poseReady, false);
  assert.equal(g.aiPaddle.poseReady, false);
  assert.equal(g.player.normal.z, -1);
  assert.equal(g.aiPaddle.normal.z, 1);
});

test('invalid replay cannot make the live ball appear or change slow motion', () => {
  const g = Object.create(lib.Game.prototype);
  let changed = 0;
  Object.assign(g, { replayer: new lib.MomentPlayer(), ball: { live: false }, setSlowmoHold() { changed++; } });
  assert.equal(g.watchMoment({ frames: new Float32Array() }, false), false);
  assert.equal(g.ball.live, false);
  assert.equal(changed, 0);
});

test('table collision rejection is actually logged once per gesture', () => {
  const g = Object.create(lib.Game.prototype), log = [];
  Object.assign(g, { shotId: 7, swipe: { gestureId: 11 }, ball: { lastHitBy: -1 }, rallyBounces: [1],
    logInput(type, event) { log.push({ type, event }); return event; } });
  g.logPressRejection('RACKET_TABLE_COLLISION');
  g.logPressRejection('RACKET_TABLE_COLLISION');
  assert.equal(log.length, 1);
  assert.equal(log[0].event.outcome.reason, 'RACKET_TABLE_COLLISION');
});
