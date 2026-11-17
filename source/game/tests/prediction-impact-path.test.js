'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { V3, PH, predict, integrateBall } = load(['10_math.js', '30_physics.js'], ['V3', 'PH', 'predict', 'integrateBall']);

test('player serve post-verification agrees with production physics, including marginal side serves', () => {
  const l = load(['10_math.js', '30_physics.js', '40_swipe.js', '70_game.js'],
    ['Game', 'V3', 'PH', 'predict', 'racketForStroke', 'strokeFrame', 'resolveRacketLaunch']);
  const g = Object.create(l.Game.prototype);
  g.ball = { p: l.V3.new(0, l.PH.TABLE_Y + .30, 1.6), v: l.V3.new(0, -1, -.02), w: l.V3.new() };
  for (const direction of [-1, 1]) for (const quality of [.6, .8, .92]) {
    const seed = l.racketForStroke('SERVE_SIDE', { side: 1, isServe: true, grip: 'shakehand',
      ball: g.ball.p, ballVelocity: g.ball.v }, { vmag: 4.3, quality, lateralBrushDir: direction, lateralGesture: true });
    for (const elevation of [-.3, -.2, -.1, 0, .1, .2, .29]) {
      const normal = l.V3.new(), vR = l.V3.new();
      l.strokeFrame(seed, elevation, .02 * direction, .99, vR, normal);
      const frame = { ...seed, normal, vR, valid: true };
      const launch = l.resolveRacketLaunch(g.ball, frame);
      const flight = launch && l.predict(launch.p, launch.v, launch.w,
        { dt: l.PH.SIM_DT, maxT: 2.6, stopAfterBounces: 2 });
      const expected = !!flight && !flight.diverged && !flight.hitNet && !!flight.landed && flight.landed.z > 0 &&
        Math.abs(flight.landed.x) <= l.PH.T_HALF_WID + .01 && !!flight.b2 && flight.b2.z < 0 &&
        flight.b2.z >= -l.PH.T_HALF_LEN - .01 && Math.abs(flight.b2.x) <= l.PH.T_HALF_WID + .01;
      assert.equal(g._playerFlightLegal(g.ball.p, frame, true), expected, `${direction}/${quality}/${elevation}`);
    }
  }
});

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

test('returned solver frames use the same actual incoming vectors and contact quality as the evaluated impact', () => {
  const l = load(['10_math.js', '30_physics.js', '40_swipe.js'],
    ['V3', 'racketForStroke', 'refineRacket', 'resolveRacketLaunch', 'impactRacket']);
  for (const id of ['LOOP', 'SERVE_SIDE', 'SERVE_BACK']) for (const quality of [.3, .6, .9]) {
    const serving = id.startsWith('SERVE'), ball = { p: l.V3.new(.1, 1.14, 1.75),
      v: l.V3.new(.1, -1, serving ? .02 : 5), w: l.V3.new(serving ? 0 : 100, 0, 0) };
    // Scalar-only gesture callers are real; refineRacket has the actual vectors.
    const raw = l.racketForStroke(id, { side: 1, grip: 'shakehand', forehand: true,
      ball: ball.p, ballSpeed: l.V3.len(ball.v) }, { vmag: 7, quality: 1 });
    const frame = l.refineRacket(ball.p, ball.v, ball.w, raw, .85, quality);
    assert.equal(frame.quality, quality); assert.equal(raw.quality, 1);
    assert.deepEqual({ ...frame.incomingVelocity }, { ...ball.v });
    assert.deepEqual({ ...frame.incomingSpin }, { ...ball.w });
    assert.notEqual(frame.incomingVelocity, ball.v); assert.notEqual(frame.incomingSpin, ball.w);
    const actual = l.resolveRacketLaunch(ball, frame), v = l.V3.clone(ball.v), w = l.V3.clone(ball.w);
    const evaluated = l.impactRacket(v, w, frame.normal, frame.vR, quality, frame.rubber);
    assert.equal(!!actual, !!evaluated, id + '/' + quality);
    if (actual) for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(actual.v[axis] - v[axis]) < 1e-12, 'velocity parity ' + axis);
      assert.ok(Math.abs(actual.w[axis] - w[axis]) < 1e-12, 'spin parity ' + axis);
    }
  }
  const ball = { p: l.V3.new(0, 1.14, 1.75), v: l.V3.new(0, -.1, 5), w: l.V3.new() };
  const raw = l.racketForStroke('LOOP', { side: 1, ball: ball.p, ballVelocity: ball.v }, { quality: .7 });
  assert.equal(l.refineRacket(ball.p, ball.v, ball.w, raw, .85).quality, .7, 'omitted quality keeps the original contact grade');
});
