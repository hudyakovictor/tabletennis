'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { trainingPath, V3, PH } = load(['10_math.js', '30_physics.js', '65_train.js'], ['trainingPath', 'V3', 'PH']);

for (const velocity of [[0, -2, 1], [.3, -1.8, 1.1], [-.3, -1.8, 1.1]]) {
  test(`training diagram includes actual end of sampled trajectory: ${velocity}`, () => {
    const flight = trainingPath(V3.new(0, PH.TABLE_Y + .4, .5), V3.new(...velocity), V3.new(), 1);
    assert.equal(flight.result.bounces, 1);
    const last = flight.path[flight.path.length - 1], end = flight.result.end;
    assert.ok(Math.hypot(last[0] - end.x, last[1] - end.y, last[2] - end.z) < 1e-9,
      `diagram ends at ${last}, physics ends at ${JSON.stringify(end)}`);
  });
}
