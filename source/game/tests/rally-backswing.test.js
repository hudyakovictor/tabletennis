'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { Game, GS, V3, Q } = load(['10_math.js', '30_physics.js', '40_swipe.js', '56_rig.js', '70_game.js'], ['Game', 'GS', 'V3', 'Q']);
function pose(state, server, windup) {
  const g = Object.create(Game.prototype);
  const pos = V3.new(.1, 1.1, -1.65);
  Object.assign(g, { state, server, shotId: 5, audio: {},
    ai: { pos: V3.clone(pos), faceNormal: V3.new(0, -.15, 1), roll: .28, forehand: true, anim: { windup, swing: 0 } },
    aiPaddle: { pos: V3.clone(pos), prevPos: V3.clone(pos), normal: V3.new(0, 0, 1), q: Q.new() } });
  g.updateOpponentPose(1 / 60);
  return { normal: g.aiPaddle.normal, roll: g.aiPaddle.roll, pos: g.aiPaddle.pos };
}
test('opponent has no windup-driven pose change in a rally but keeps it during its serve', () => {
  const base = pose(GS.RALLY, -1, 0), rally = pose(GS.RALLY, -1, .35), serve = pose(GS.SERVE_TOSS, -1, .35);
  assert.ok(V3.dist(base.normal, rally.normal) < 1e-10);
  assert.equal(base.roll, rally.roll);
  assert.ok(V3.dist(base.normal, serve.normal) > .01);
  assert.ok(Math.abs(base.roll - serve.roll) > .01);
});
