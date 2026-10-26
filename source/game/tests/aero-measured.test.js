const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '30_physics.js'], ['PH', 'V3', 'aeroAccel', 'aeroCdMeasured', 'aeroCmMeasured', 'integrateBall', 'bounceTable']);
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

test('topspin dips and backspin floats with the measured Magnus magnitude', () => {
  const v = V3.new(0, 0, -10), a = V3.new();
  lib.aeroAccel(a, v, V3.new(-300, 0, 0));
  const K = PH.RHO * (4 / 3) * Math.PI * PH.R ** 3 / PH.M;
  near(a.y + PH.G, -lib.aeroCmMeasured(10, 300) * K * 300 * 10, 1e-6, 'topspin Magnus');
  lib.aeroAccel(a, v, V3.new(300, 0, 0)); assert.ok(a.y > -PH.G, 'backspin lifts');
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
