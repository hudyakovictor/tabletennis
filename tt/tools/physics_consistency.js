'use strict';
/* Is predict() telling the same story as the live stepPhysics()?  Every case
 * here is something the solvers rely on: a net the ball can pass under, a
 * table it can only land on from above, and the exact point of contact. */
const { load } = require('../../tests/helpers.cjs');
const L = load(['10_math.js', '30_physics.js'], ['V3', 'PH', 'predict', 'bounceTable']);
const { V3, PH } = L;
const f = (n, d = 3) => Number(n).toFixed(d);

function run(p, v, w = [0, 0, 0], opts = {}) {
  const out = {};
  L.predict(V3.new(p[0], p[1], p[2]), V3.new(v[0], v[1], v[2]), V3.new(w[0], w[1], w[2]),
    Object.assign({ dt: 1 / 600, maxT: 2.5, out }, opts));
  return out;
}

const rows = [];
/* A. a ball that has fallen under the table, travelling toward z = 0. */
for (const y of [0.30, 0.55, 0.72, 0.76, 0.80]) {
  const r = run([0, y, 1.0], [0, 0, -3]);
  rows.push({ case: 'under-net', y, hitNet: r.hitNet, crossed: !!r.netCross,
    netY: r.netCross && +r.netCross.y.toFixed(2) });
}
/* B. a ball below the table inside the contour moving down: must never
 *    "bounce" on the table top. */
for (const y of [0.30, 0.50, 0.70]) {
  const r = run([0, y, 0.6], [0, -1.5, 0]);
  rows.push({ case: 'below-table', y, bounces: r.bounces,
    landed: r.landed && [f(r.landed.x), f(r.landed.z)], floor: !!r.floor });
}
/* C. a fast ball onto the line: the reported contact point must stay inside
 *    T_HALF + R, not the end of the integration step 5 cm later. */
for (const speed of [8, 18, 30]) {
  for (const z0 of [1.10, 1.25, 1.33]) {
    const vz = -speed * 0.8, vy = -speed * 0.6;
    const t = (PH.TABLE_Y + PH.R - 1.5) / vy;
    const zHit = z0 + vz * t;
    const r = run([0, 1.5, z0], [0, vy, vz]);
    rows.push({ case: 'line-contact', speed, z0, expectZ: +zHit.toFixed(3),
      landedZ: r.landed && +r.landed.z.toFixed(3), bounces: r.bounces });
  }
}
/* D. the net band: 0.9525 .. 0.9925 above the floor is tape in the game. */
for (const y of [0.950, 0.965, 0.975, 0.985, 0.995]) {
  const r = run([0, y, 0.4], [0, 0, -6]);
  rows.push({ case: 'net-band', y, hitNet: r.hitNet });
}
console.log(JSON.stringify(rows, null, 1));
