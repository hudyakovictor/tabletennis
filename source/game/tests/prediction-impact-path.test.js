'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { V3, PH, predict, integrateBall } = load(['10_math.js', '30_physics.js'], ['V3', 'PH', 'predict', 'integrateBall']);

for (const axis of ['x', 'z']) for (const sign of [-1, 1])
  for (const stop of ['first', 'count', 'duration']) {
    test(`sampled prediction hits the table, not past its line: ${axis}/${sign}/${stop}`, () => {
      const p = V3.new(.2, PH.TABLE_Y + PH.R + .001, .5);
      p[axis] = sign * ((axis === 'x' ? PH.T_HALF_WID : PH.T_HALF_LEN) - .01);
      const v = V3.new(0, -2, 0); v[axis] = sign * 30;
      const path = [], opts = { dt: PH.SIM_DT, maxT: PH.SIM_DT, path };
      if (stop === 'first') opts.stopOnFirstBounce = true;
      if (stop === 'count') opts.stopAfterBounces = 1;
      const out = predict(p, v, V3.new(), opts);
      assert.equal(out.bounces, 1); assert.equal(path.length, 3);
      assert.ok(Math.abs(path[0] - out.landed.x) < 1e-9);
      assert.ok(Math.abs(path[1] - (PH.TABLE_Y + PH.R + 1e-5)) < 1e-9);
      assert.ok(Math.abs(path[2] - out.landed.z) < 1e-9);
    });
  }

test('a later bounce must not overwrite a path sample after maxPath is full', () => {
  const p = V3.new(0, PH.TABLE_Y + PH.R + .02, .5), v = V3.new(0, -2, 0), w = V3.new();
  const expectedP = V3.clone(p), expectedV = V3.clone(v), expectedW = V3.clone(w);
  integrateBall(expectedP, expectedV, expectedW, PH.SIM_DT);
  const path = [];
  const out = predict(p, v, w, { dt: PH.SIM_DT, maxT: .02, path, maxPath: 3, stopOnFirstBounce: true });
  assert.equal(out.bounces, 1); assert.equal(path.length, 3);
  assert.ok(Math.abs(path[1] - expectedP.y) < 1e-9);
  assert.ok(path[1] > PH.TABLE_Y + PH.R + .001);
});
