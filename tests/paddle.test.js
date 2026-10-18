const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

function rigFixture() {
  const lib = load(['10_math.js', '56_rig.js'], ['PaddleRig', 'Q', 'V3', 'M4']);
  const calls = [];
  const R = {
    draw(mesh, matrix, mat) { calls.push({ mesh, matrix: Array.from(matrix), mat }); },
    drawShadow(mesh, matrix) { calls.push({ mesh, matrix: Array.from(matrix), shadow: true }); },
  };
  const S = { mesh: { blade: 'blade', rubber: 'rubber', handle: 'handle' },
    mat: { bladeWood: 'wood', rubberRed: 'red', rubberBlack: 'black', handle: 'grip' } };
  return { ...lib, R, S, calls, rig: new lib.PaddleRig() };
}

test('paddle draws only blade, two rubbers and handle, including shadow pass', () => {
  const { rig, R, S, V3, calls } = rigFixture();
  for (const shadowPass of [false, true]) {
    calls.length = 0;
    rig.draw(R, S, { pos: V3.new(), normal: V3.new(0, 0, -1), hand: 'right', shadowPass });
    assert.deepEqual(calls.map(c => c.mesh), ['blade', 'rubber', 'rubber', 'handle']);
    assert.equal(calls.every(c => !!c.shadow === shadowPass), true);
  }
});

test('repeated rendering cannot rotate the input pose or change rubber sides', () => {
  const { rig, R, S, Q, V3, calls } = rigFixture();
  const o = { pos: V3.new(.2, 1, 1.5), normal: V3.new(0, 0, -1),
    q: Q.fromEuler(Q.new(), .25, -.4, .1), hand: 'right', swing: .8, roll: .2 };
  const before = JSON.stringify(o);
  rig.draw(R, S, o);
  const expected = JSON.stringify(calls);
  for (let i = 0; i < 1000; i++) {
    calls.length = 0;
    rig.draw(R, S, o);
    assert.equal(JSON.stringify(o), before);
    assert.equal(JSON.stringify(calls), expected);
  }
  assert.equal(calls[1].mat, 'red');
  assert.equal(calls[2].mat, 'black');
  // The surface centres are displaced exactly along the rendered blade Z.
  for (let axis = 0; axis < 3; axis++) {
    const delta = calls[1].matrix[12 + axis] - calls[2].matrix[12 + axis];
    assert.ok(Math.abs(delta - calls[0].matrix[8 + axis] * .017) < 1e-6);
  }
});

test('grip roll is bounded and never alters the face normal for either hand', () => {
  const { rig, Q, V3, M4 } = rigFixture();
  for (const hand of ['left', 'right']) {
    for (const swing of [-100, -1, 0, 1, 100]) {
      const n = V3.norm(V3.new(), V3.new(.3, -.2, -1));
      const q = rig.paddleQuat(Q.new(), n, hand, swing, swing);
      assert.ok(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-9);
      const m = M4.compose(M4.create(), V3.new(), q, V3.new(1, 1, 1));
      assert.ok(V3.dist(M4.transformDir(V3.new(), m, V3.new(0, 0, 1)), n) < 1e-6);
    }
  }
});

test('AI initializes a finite pose at every difficulty and does not strike inside think', () => {
  const { OpponentAI, V3 } = load(['10_math.js', '30_physics.js', '40_swipe.js', '55_ai.js'], ['OpponentAI', 'V3']);
  for (let level = 0; level < 5; level++) {
    const ai = new OpponentAI(level);
    assert.equal(ai.L.id, level);
    assert.equal(ai.side, -1);
    assert.ok(Object.values(ai.pos).every(Number.isFinite));
    const ball = { p: V3.new(0, 1, -1.4), v: V3.new(0, -1, -5), w: V3.new(10, 0, 0), live: true, lastHitBy: 1 };
    const g = { ball, time: 1, shotId: 1, rally: 1, ai, player: { pos: V3.new() } };
    const before = JSON.stringify(ball);
    ai.think(g, 1 / 60);
    assert.equal(JSON.stringify(ball), before);
    ai.commit = { x: 0, t: 1, speed: 8, archId: 'DRIVE', aim: { x: .2, z: .9 } };
    ai.plan = ai.commit; ai.swingAt = 1;
    const racket = ai.swing(g);
    assert.equal(JSON.stringify(ball), before, 'only Game.tryAiHit applies the physical impact');
    assert.ok(V3.len(racket.vR) > 0);
    assert.ok(Object.values(racket.normal).every(Number.isFinite));
    assert.equal(ai.commit, null);
    assert.equal(ai.swing(g), null, 'one committed stroke is consumed once');
  }
});
