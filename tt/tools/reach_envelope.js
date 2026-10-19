'use strict';
/* Reach envelope: what can the STROKE ITSELF do, with the solver removed?
 *
 * zone_matrix.js measures the shipped pipeline (deriveStroke -> refineRacket ->
 * impact -> predict), so a cell it misses can mean two very different things:
 *   1. the physics/gesture cannot put the ball there, or
 *   2. the solver failed to find a stroke that could.
 * The two need opposite fixes, so this tool samples the raw parameter space the
 * solver searches over — (dElev, dAz, scale, damp) — and keeps, for every cell
 * of the 15x15 grid, the candidate that lands closest to the cell centre.
 *
 * The aim is NOT part of the physics, so one scan per stroke/power covers the
 * whole grid: `dist` tells how far the best physical candidate is from a cell,
 * which is the honest reachability answer.
 *
 * Sampling is a Halton sequence (deterministic, no RNG state) plus the corners
 * of the box, because a regular grid aliases into stripes: with 9 azimuths a
 * serve could only ever be "reached" in 9 columns.
 *
 * Output JSON: per scenario `reach` (cells within half a cell), `map`, and
 * `warm[]` — the best (dE,dA,sc,dmp) per cell, which is exactly the table the
 * plan proposes to precompute and ship as a solver warm start.
 *
 * Usage: node tt/tools/reach_envelope.js [--only=serves|returns] [--n=4000]
 *        [--power=1] [--dt=fine]
 */
const { load } = require('../../tests/helpers.cjs');
const L = load(['10_math.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '56_rig.js'],
  ['V3', 'PH', 'deriveStroke', 'refineRacket', 'impactRacket', 'predict', 'strokeFrame',
    'SERVE_VMAX']);
const { V3, PH } = L;

const N = 15;
const X0 = -PH.T_HALF_WID, X1 = PH.T_HALF_WID;
const Z0 = -PH.T_HALF_LEN, Z1 = 0;
const DX = (X1 - X0) / N, DZ = (Z1 - Z0) / N;
const RX = X1 + PH.R, RZ = PH.T_HALF_LEN + PH.R;
const argOf = (k, d) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || d;
const ONLY = argOf('only', 'both');
const NS = Math.max(200, +argOf('n', '4000') || 4000);
const ONLY_POWER = argOf('power', '');
const DT = argOf('dt', 'coarse') === 'fine' ? PH.SIM_DT : 1 / 170;
const HALF = Math.hypot(DX, DZ) / 2;   // a cell is covered if a candidate lands this close

const cellCenter = (ix, iz) => ({ x: X0 + (ix + .5) * DX, z: Z0 + (iz + .5) * DZ });
const cellOf = (p) => {
  if (!p || Math.abs(p.x) > RX || p.z < -RZ || p.z > PH.R) return null;
  return { ix: Math.min(N - 1, Math.max(0, Math.floor((p.x - X0) / DX))),
    iz: Math.min(N - 1, Math.max(0, Math.floor((p.z - Z0) / DZ))) };
};
const idx = (ix, iz) => iz * N + ix;

function metrics(o) {
  return Object.assign({
    right: 0, up: 0, dist: .12, curl: 0, speed: 1.5, peakSpeed: 1.5,
    releaseSpeed: 1.5, smooth: .9, straightness: .95, samples: 10, jerk: .1,
    x: .5, y: .5,
  }, o);
}
const ctxFor = (contact, ballSpin, ballSpeed) => ({
  side: 1, grip: 'shakehand', forehand: true,
  ball: { y: contact.y, z: contact.z },
  ballSpin, ballSpeed, movePitch: -.1,
});

/* Halton bases 2,3,5,7 — low discrepancy, reproducible, no RNG. */
function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }

const SCEN = [
  { id: 'DRIVE', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: 1.08, z: 1.30 },
    gesture: { up: .18, dist: .16, releaseSpeed: 1.7, peakSpeed: 1.8 },
    incoming: { v: [0, -1.0, 8.5], w: [140, 0, 0] } },
  { id: 'LOOP', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: 1.02, z: 1.30 },
    gesture: { up: .62, dist: .26, releaseSpeed: 2.4, peakSpeed: 2.7 },
    incoming: { v: [0, -1.2, 6.5], w: [120, 0, 0] } },
  { id: 'COUNTER', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: 1.10, z: 1.30 },
    gesture: { up: .80, dist: .24, releaseSpeed: 3.2, peakSpeed: 3.6 },
    incoming: { v: [0, -1.0, 9.5], w: [240, 0, 0] } },
  { id: 'SMASH', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: 1.24, z: 1.30 },
    gesture: { up: .15, dist: .24, releaseSpeed: 3.6, peakSpeed: 4.0 },
    incoming: { v: [0, -1.4, 8.0], w: [160, 0, 0] } },
  { id: 'CHOP', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: 1.10, z: 1.30 },
    gesture: { up: -.62, dist: .26, releaseSpeed: 2.6, peakSpeed: 3.0 },
    incoming: { v: [0, -.8, 7.5], w: [180, 0, 0] } },
  { id: 'PUSH', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: .95, z: 1.30 },
    gesture: { up: -.45, dist: .18, releaseSpeed: 1.2, peakSpeed: 1.4 },
    incoming: { v: [0, -.6, 4.5], w: [-150, 0, 0] } },
  { id: 'DROP', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: .98, z: 1.30 },
    gesture: { up: -.40, dist: .10, releaseSpeed: .5, peakSpeed: .6 },
    incoming: { v: [0, -.5, 4.0], w: [-140, 0, 0] } },
  { id: 'FLICK', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: 1.00, z: 1.20 },
    gesture: { up: .80, dist: .10, releaseSpeed: 1.6, peakSpeed: 1.8 },
    incoming: { v: [0, -.5, 4.5], w: [-120, 0, 0] } },
  { id: 'BLOCK', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: 1.05, z: 1.30 },
    gesture: { up: .15, dist: .04, releaseSpeed: .9, peakSpeed: 1.0 },
    incoming: { v: [0, -1.2, 12.0], w: [220, 0, 0] } },
  { id: 'LOB', serve: false, power: [.65, 1, 1.35], contact: { x: 0, y: .95, z: 1.35 },
    gesture: { up: .80, dist: .24, releaseSpeed: .8, peakSpeed: .9 },
    incoming: { v: [0, -.5, 4.0], w: [-120, 0, 0] } },
  { id: 'SERVE_TOP', serve: true, power: [.7, 1.15], gesture: { up: .35, dist: .20, releaseSpeed: 1.8, peakSpeed: 2.0 } },
  { id: 'SERVE_BACK', serve: true, power: [.7, 1.15], gesture: { up: -.45, dist: .20, releaseSpeed: 1.5, peakSpeed: 1.7 } },
  { id: 'SERVE_SIDE', serve: true, power: [.7, 1.15], gesture: { right: .8, up: .05, dist: .20, releaseSpeed: 1.8, peakSpeed: 2.0, curl: .6 } },
  { id: 'SERVE_FAST', serve: true, power: [.7, 1.15], gesture: { up: .05, dist: .22, releaseSpeed: 3.6, peakSpeed: 4.0 } },
];

const TOSS = { x: 0, y: 1.14, z: 1.44 };
const tossV = V3.new(0, -0.8, 0), tossW = V3.new(0, 0, 0);
const launchFrom = (contact, normal) => V3.new(
  contact.x + normal.x * PH.R * 1.05,
  contact.y + normal.y * PH.R * 1.05,
  contact.z + normal.z * PH.R * 1.05);

const E_LO = -1.15, E_HI = 1.10, A_LO = -0.85, A_HI = 0.85, S_LO = 0.22, S_HI = 1.70;

function scan(sc, power) {
  const serve = sc.serve;
  const contact = serve ? TOSS : sc.contact;
  const ctx = ctxFor(contact, V3.new(...(sc.incoming ? sc.incoming.w : [0, 0, 0])),
    sc.incoming ? Math.hypot(...sc.incoming.v) : 1.5);
  if (serve) ctx.isServe = true;
  const vIn = serve ? tossV : V3.new(...sc.incoming.v);
  const wIn = serve ? tossW : V3.new(...sc.incoming.w);
  const base = L.deriveStroke(metrics(sc.gesture), ctx);
  if (serve) base.isServe = true;
  base.vmag = Math.min(serve ? 12.5 : 19.5, base.vmag * power);
  const rubber = Object.assign({}, base.rubber || {});

  const best = new Array(N * N).fill(null);      // {d, dE, dA, sc, dmp, x, z}
  let flights = 0, nets = 0, own = 0, off = 0, legal = 0;

  const tryOne = (dE, dA, sca, dmp, verify) => {
    const sv = V3.new(), sn = V3.new();
    L.strokeFrame(base, dE, dA, sca, sv, sn);
    if (serve && V3.len(sv) > L.SERVE_VMAX) V3.mul(sv, sv, L.SERVE_VMAX / V3.len(sv));
    const bv = V3.clone(vIn), bw = V3.clone(wIn);
    rubber.damp = dmp;
    L.impactRacket(bv, bw, sn, sv, .9, rubber);
    flights++;
    const out = {};
    L.predict(launchFrom(contact, sn), bv, bw, serve
      ? { dt: verify ? PH.SIM_DT : DT, maxT: 3.0, stopAfterBounces: 2, out }
      : { dt: verify ? PH.SIM_DT : DT, maxT: 2.6, stopOnFirstBounce: true, out });
    if (out.hitNet) { nets++; return null; }
    const land = serve ? out.b2 : out.landed;
    if (!land) { off++; return null; }
    if (serve) {
      if (!(out.landed && out.landed.z > 0)) { own++; return null; }
      if (land.z >= 0) { own++; return null; }
    } else if (land.z >= 0) { own++; return null; }
    legal++;
    const c = cellOf(land);
    if (!c) { off++; return null; }
    const cc = cellCenter(c.ix, c.iz);
    const d = Math.hypot(land.x - cc.x, land.z - cc.z);
    const i = idx(c.ix, c.iz);
    const cur = best[i];
    if (!cur || d < cur.d) best[i] = { d, dE, dA, sc: sca, dmp, x: land.x, z: land.z };
    return { i, d };
  };

  /* corners + edges of the box first: the extremes are where a sampler with a
   * prime base can starve, and they are the physically interesting ones. */
  for (const dE of [E_LO, 0, E_HI]) for (const dA of [A_LO, 0, A_HI]) {
    for (const sca of [S_LO, 0.6, 1.0, S_HI]) for (const dmp of [1, 0.58]) tryOne(dE, dA, sca, dmp, false);
  }
  for (let i = 1; i <= NS; i++) {
    const dE = E_LO + (E_HI - E_LO) * halton(i, 2);
    const dA = A_LO + (A_HI - A_LO) * halton(i, 3);
    const sca = S_LO + (S_HI - S_LO) * halton(i, 5);
    const dmp = halton(i, 7) < 0.4 ? 0.58 : 1;
    tryOne(dE, dA, sca, dmp, false);
  }

  /* the winners are re-flown at the production step before they are trusted:
   * a coarse pass can put a ball half a cell away from where it really lands */
  let reach = 0, rej = 0;
  const warm = [];
  for (let i = 0; i < N * N; i++) {
    const b = best[i];
    if (!b) { warm.push(null); continue; }
    const v = tryOne(b.dE, b.dA, b.sc, b.dmp, true);
    if (v && v.d <= HALF) { reach++; warm.push({ dE: +b.dE.toFixed(3), dA: +b.dA.toFixed(3), sc: +b.sc.toFixed(3), dmp: b.dmp, err: +v.d.toFixed(3) }); }
    else { rej++; warm.push(null); }
  }
  return { reach, warm, flights, nets, own, off, legal, rej };
}

const out = [];
for (const sc of SCEN) {
  if (ONLY === 'serves' && !sc.serve) continue;
  if (ONLY === 'returns' && sc.serve) continue;
  for (const p of sc.power) {
    if (ONLY_POWER && String(p) !== ONLY_POWER) continue;
    const t0 = Date.now();
    const r = scan(sc, p);
    const map = [];
    for (let iz = 0; iz < N; iz++) {
      let line = '';
      for (let ix = 0; ix < N; ix++) line += r.warm[idx(ix, iz)] ? '#' : '.';
      map.push(line);
    }
    out.push({ id: sc.id, power: p, serve: !!sc.serve, reach: r.reach,
      flights: r.flights, nets: r.nets, ownSide: r.own, off: r.off, legal: r.legal,
      rejected: r.rej, map, warm: r.warm, ms: Date.now() - t0 });
    process.stderr.write(`reach ${sc.id} x${p}: ${r.reach}/225  (${r.flights} flights, ` +
      `${r.nets} net, ${r.own} own-side, ${r.legal} legal, ${r.rej} rejected by fine check) ` +
      `${Date.now() - t0} ms\n`);
  }
}
console.log(JSON.stringify(out, null, 1));
