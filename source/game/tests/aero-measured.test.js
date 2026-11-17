const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '30_physics.js'], ['PH', 'V3', 'STROKE_CONFIG', 'aeroAccel', 'aeroCdMeasured', 'aeroCmMeasured', 'integrateBall', 'bounceTable', 'predict']);
const { PH, V3 } = lib;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('measured aero is the default model', () => assert.equal(PH.AERO_MODEL, 'measured'));

test('C_D reproduces the Sony AI table (arXiv:2606.28805, Table I)', () => {
  near(lib.aeroCdMeasured(2.5, 0), .55, 1e-9, 'slow ball, no spin');
  near(lib.aeroCdMeasured(12.5, 0), .47, 1e-9, 'fast ball, no spin');
  near(lib.aeroCdMeasured(12.5, .62), .53, 1e-9, 'drag ridge');
  near(lib.aeroCdMeasured(17.5, .84), .37, 1e-9, 'drag trough');
  near(lib.aeroCdMeasured(10, 0), .48, 1e-9, 'interpolated between 7.5 and 12.5');
  const hi = lib.aeroCdMeasured(30, .84); assert.ok(hi >= .3 && hi <= .6, 'extrapolation stays bounded');
});

test('C_M follows the linear-then-quadratic fit and never goes negative', () => {
  near(lib.aeroCmMeasured(10.5, 0), .375, 1e-9, 'C_M at zero spin');
  near(lib.aeroCmMeasured(10.5, 300), .375 - 6.58e-4 * 300, 1e-9, 'linear branch');
  near(lib.aeroCmMeasured(9, 300), (lib.aeroCmMeasured(7.5, 300) + lib.aeroCmMeasured(10.5, 300)) / 2, 1e-9, 'interpolated in v');
  for (const v of [1, 3, 8, 14, 25]) for (const w of [0, 200, 500, 900, 1500]) assert.ok(lib.aeroCmMeasured(v, w) >= 0, `C_M(${v},${w}) >= 0`);
});

test('topspin dips and backspin floats with the measured reference and shared gameplay gain', () => {
  const v = V3.new(0, 0, -10), a = V3.new();
  lib.aeroAccel(a, v, V3.new(-300, 0, 0));
  const K = PH.RHO * (4 / 3) * Math.PI * PH.R ** 3 / PH.M;
  near(a.y + PH.G, -lib.aeroCmMeasured(10, 300) * K * 300 * 10 * lib.STROKE_CONFIG.flight.magnusGain, 1e-6, 'topspin Magnus');
  lib.aeroAccel(a, v, V3.new(300, 0, 0)); assert.ok(a.y > -PH.G, 'backspin lifts');
});

test('arcade gain amplifies only Magnus once for both shared aero models; zero-spin flight is unchanged', () => {
  const l = load(['10_math.js', '30_physics.js'], ['PH', 'V3', 'STROKE_CONFIG', 'aeroAccel', 'integrateBall']);
  const gain = l.STROKE_CONFIG.flight.magnusGain;
  assert.ok(gain >= 1.8 && gain <= 3, 'strong bounded source-configured curve');
  const v = l.V3.new(1.2, -.4, -8);
  for (const model of ['measured', 'legacy']) {
    l.PH.AERO_MODEL = model;
    for (const spin of [[0, 0, 0], [-200, 0, 0], [200, 0, 0], [0, -200, 0], [0, 200, 0], [-120, 160, 30]]) {
      const w = l.V3.new(...spin), a = l.V3.new(), reference = l.V3.new(), drag = l.V3.new();
      l.STROKE_CONFIG.flight.magnusGain = 0; l.aeroAccel(drag, v, w);
      l.STROKE_CONFIG.flight.magnusGain = 1; l.aeroAccel(reference, v, w);
      l.STROKE_CONFIG.flight.magnusGain = gain; l.aeroAccel(a, v, w);
      for (const axis of ['x', 'y', 'z']) near(a[axis] - drag[axis], (reference[axis] - drag[axis]) * gain, 1e-9, model + axis);
      if (!spin.some(Boolean)) for (const axis of ['x', 'y', 'z']) near(a[axis], reference[axis], 1e-12, 'zero spin');
    }
  }
});

test('strong signed curvature is integrated into the actual trajectory and prediction uses the same model', () => {
  const l = load(['10_math.js', '30_physics.js'], ['PH', 'V3', 'STROKE_CONFIG', 'integrateBall', 'predict']);
  const run = (w, gain) => {
    l.STROKE_CONFIG.flight.magnusGain = gain;
    const p = l.V3.new(0, 4, 1.8), v = l.V3.new(0, 1, -8), spin = l.V3.new(...w);
    const forecast = l.predict(p, v, spin, { dt: l.PH.SIM_DT, maxT: .4, out: {} });
    for (let t = 0; t < .4; t += l.PH.SIM_DT) l.integrateBall(p, v, spin, l.PH.SIM_DT);
    for (const axis of ['x', 'y', 'z']) near(forecast.end[axis], p[axis], 1e-12, 'prediction/live ' + axis);
    return { p, v };
  };
  const gain = l.STROKE_CONFIG.flight.magnusGain, zero = run([0, 0, 0], gain), referenceZero = run([0, 0, 0], 1);
  near(l.V3.dist(zero.p, referenceZero.p), 0, 1e-12, 'zero launch');
  for (const direction of [-1, 1]) {
    const reference = run([0, direction * 200, 0], 1), strong = run([0, direction * 200, 0], gain);
    assert.ok(Math.abs(strong.p.x) > Math.abs(reference.p.x) * 1.6);
    assert.equal(Math.sign(strong.p.x), -direction);
    assert.ok(Math.abs(Math.atan2(strong.v.x, -strong.v.z)) > Math.abs(Math.atan2(reference.v.x, -reference.v.z)) * 1.6);
    const verticalReference = run([direction * 200, 0, 0], 1), verticalStrong = run([direction * 200, 0, 0], gain);
    assert.ok(Math.abs(verticalStrong.p.y - zero.p.y) > Math.abs(verticalReference.p.y - zero.p.y) * 1.5);
  }
});

test('ITTF drop test and terminal velocity stay physical', () => {
  const p = V3.new(0, PH.TABLE_Y + PH.R + .305, 0), v = V3.new(), w = V3.new();
  let up = false, top = 0;
  for (let i = 0; i < 2400; i++) {
    lib.integrateBall(p, v, w, 1 / 1200);
    if (!up && p.y - PH.R <= PH.TABLE_Y) { p.y = PH.TABLE_Y + PH.R; lib.bounceTable(p, v, w); up = true; }
    if (up) { top = Math.max(top, p.y - PH.R - PH.TABLE_Y); if (v.y < 0) break; }
  }
  assert.ok(top >= .23 && top <= .26, `rebound ${top}`);
  const q = V3.new(0, 100, 0), u = V3.new();
  for (let i = 0; i < 6000; i++) lib.integrateBall(q, u, V3.new(), 1 / 600);
  assert.ok(-u.y > 8 && -u.y < 9, `terminal ${-u.y}`);
});
