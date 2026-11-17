'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '30_physics.js', '57_camera.js'],
  ['cameraRigFor', 'pointerBladeSolve', 'unprojectToPlane', 'REACH_SHELL']);

test('step-in recomputes pinned and exact for the final depth, including reused buffers', () => {
  const aspect = 390 / 844, rig = lib.cameraRigFor('BROADCAST', null, aspect), out = {};
  for (const x of [.1, .9, .5]) {
    const target = lib.pointerBladeSolve(rig, aspect, x, .45, { out, zFoot: .8 });
    assert.equal(target.tz, .8);
    const raw = {};
    assert.ok(lib.unprojectToPlane(rig, aspect, x, .45, target.tz, raw));
    const side = Math.abs(raw.x) > lib.REACH_SHELL.xSoft + 1e-9 ? Math.sign(raw.x) : 0;
    assert.equal(target.pinned, side, `x=${x}`);
    assert.equal(target.exact, !side, `x=${x}`);
  }
});
