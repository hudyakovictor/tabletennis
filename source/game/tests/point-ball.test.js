'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { Game, GS, PH, V3, Q } = load(['10_math.js', '30_physics.js', '70_game.js'], ['Game', 'GS', 'PH', 'V3', 'Q']);

function visualBall(p, v) {
  const g = Object.create(Game.prototype);
  g.state = GS.POINT;
  g.replayer = { on: false };
  g.ball = { p: V3.new(...p), v: V3.new(...v), w: V3.new(0, 0, 12), q: Q.new(), live: false };
  g.score = [3, 2];
  g.audio = { hitTable() {}, hitFloor() {} };
  g.capturePointBall();
  return g;
}

test('after a point the separate visual ball keeps falling and rebounds on the table without changing the rally', () => {
  const g = visualBall([0, PH.TABLE_Y + .14, .7], [0, -1.2, .1]);
  const original = JSON.stringify(g.ball), score = JSON.stringify(g.score), b = g._pointBall;
  let fell = false, bounced = false;
  for (let i = 0; i < 30; i++) {
    g.advancePointBall(1 / 60);
    fell ||= b.p.y < PH.TABLE_Y + .12;
    bounced ||= b.v.y > .2;
    assert.ok(b.p.y >= PH.TABLE_Y + PH.R - 1e-5);
  }
  assert.ok(fell && bounced, 'the ball must visibly fall and bounce upward');
  assert.equal(JSON.stringify(g.ball), original);
  assert.equal(JSON.stringify(g.score), score);
});

test('a ball outside the table bounces off the floor, then eventually settles without sinking', () => {
  const g = visualBall([2, .5, 1.8], [0, -2, 0]);
  const b = g._pointBall;
  let bounced = false;
  for (let i = 0; i < 600; i++) {
    g.advancePointBall(1 / 60);
    bounced ||= b.v.y > .2;
    assert.ok(b.p.y >= PH.R - 1e-8);
  }
  assert.ok(bounced);
  assert.ok(b.p.y < PH.R + .002 && V3.len(b.v) < .01);
});

test('visual physics does not run outside the point, during replay, or after it is cleared', () => {
  const g = visualBall([0, 1.3, 1], [0, -1, 0]);
  const old = JSON.stringify(g._pointBall);
  g.replayer.on = true; g.advancePointBall(.1);
  assert.equal(JSON.stringify(g._pointBall), old);
  g.replayer.on = false; g.state = GS.SERVE_READY; g.advancePointBall(.1);
  assert.equal(JSON.stringify(g._pointBall), old);
  g.state = GS.POINT; g._pointBall = null;
  assert.doesNotThrow(() => g.advancePointBall(.1));
});
