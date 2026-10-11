// Headless audit of the physics/stroke/serve modules — pure Node, no puppeteer needed.
// Usage:  node tt/tools/audit3_rules.js        (loads ../src/*.js into a VM context)
/* Audit part 3 — serve legality grid, table COR fidelity, archetype delivery. */
const fs = require('fs'), vm = require('vm');
const SRC = '/home/user/tabletennis/tt/src/';
let code = ['10_math.js', '30_physics.js', '40_swipe.js'].map(f => fs.readFileSync(SRC + f, 'utf8')).join('\n');
code += `\n;globalThis.API={PH,V3,DEG,TAU,V3N:V3.new,predict,integrateBall,bounceTable,deriveStroke,refineRacket,ARCH,STROKES,impactRacket,SPIN_CAP};`;
const ctx = { console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
const A = ctx.API, { PH, V3 } = A, T = PH.TABLE_Y;

/* ------------------ table COR: measured vs ITTF ------------------ */
console.log('=========== BALL <-> TABLE RESTITUTION ===========');
function drop(h, E0, SLOPE) {
  const p = V3.new(0, T + h + PH.R, 0), v = V3.new(0, 0, 0), w = V3.new(0, 0, 0); const dt = 1 / 600;
  let t = 0; while (p.y - PH.R > T && t < 3) { A.integrateBall(p, v, w, dt); t += dt; }
  const vImp = -v.y;
  const eTheory = Math.max(0.05, E0 - SLOPE * vImp);
  A.bounceTable(p, v, w);
  let apex = p.y - T - PH.R, prev = v.y;
  while (t < 4) { A.integrateBall(p, v, w, dt); t += dt; apex = Math.max(apex, p.y - T - PH.R); if (v.y < 0 && prev > 0 && t > 0.05) break; prev = v.y; }
  return { vImp, eTheory, rebound: apex * 100 };
}
for (const h of [0.30, 0.305]) {
  const r = drop(h);
  console.log(` drop ${(h * 100).toFixed(1)} cm: impact ${r.vImp.toFixed(2)} m/s, code COR ${r.eTheory.toFixed(3)} -> rebound ${r.rebound.toFixed(1)} cm  (ITTF requires 23-26 cm ${r.rebound >= 23 ? 'PASS' : 'FAIL'})`);
}
// what the doc claims and what it would give
for (const [E0, S] of [[0.870, 0.009], [0.915, 0.0085], [0.894, 0.0]]) {
  const v = Math.sqrt(2 * 9.81 * 0.30) * 0.985;       // slight drag loss
  const e = E0 - S * v;
  console.log(` COR model e0=${E0} slope=${S}: e=${e.toFixed(3)} -> analytic rebound ${(e * e * 30).toFixed(1)} cm`);
}

/* ------------------ speed decay over 0.51 s (doc: -51.5%) ------------------ */
{
  const p = V3.new(0, T + 0.5, 1.0), v = V3.new(0, 1.2, -30), w = V3.new(0, 0, 0);
  const v0 = V3.len(v); const dt = 1 / 600; let t = 0;
  while (t < 0.51) { A.integrateBall(p, v, w, dt); t += dt; }
  console.log(`\n 30 m/s throw, after 0.51 s: ${(100 * (1 - V3.len(v) / v0)).toFixed(1)} % speed lost (doc claims 51.5 %)`);
}

/* ------------------ serve legality grid ------------------ */
function gestureMetrics(o) {
  const m = Object.assign({
    dx: 0, dy: 0, dist: 0.3, pathLen: 0.3, straightness: 1, speed: 2.5, peakSpeed: 2.6,
    releaseSpeed: 2.5, accel: 0, angle: 0, angleDeg: 0, up: 0, right: 0, curl: 0, dur: 0.16,
    samples: 24, jerk: 0, smooth: 0.95, sx: 0.5, sy: 0.66, x: 0.6, y: 0.4,
  }, o);
  m.dist = m.dist; m.pathLen = m.pathLen || m.dist;
  return m;
}
console.log('\n=========== SERVE LEGALITY GRID (assist 0.72) ===========');
const serveGests = [
  ['up (SERVE_TOP)', { up: 0.97, right: 0.24, dist: 0.34, releaseSpeed: 2.6, peakSpeed: 2.7 }],
  ['down (SERVE_BACK)', { up: -0.87, right: 0.50, dist: 0.30, releaseSpeed: 2.4, peakSpeed: 2.5 }],
  ['side-curl', { up: 0.40, right: 0.92, dist: 0.32, releaseSpeed: 2.5, peakSpeed: 2.6, curl: 1.0 }],
  ['flat fast', { up: 0.14, right: 0.99, dist: 0.44, releaseSpeed: 3.4, peakSpeed: 3.5 }],
  ['weak tap', { up: 0.87, right: 0.50, dist: 0.14, releaseSpeed: 1.1, peakSpeed: 1.2 }],
];
const tosses = [];
for (const h of [0.16, 0.25, 0.36]) for (const vy of [-0.4, -1.5, -2.6]) for (const vz of [0, 0.4]) tosses.push([h, vy, vz]);
const byServe = {};
for (const [nm, gm] of serveGests) {
  let n = 0, legal = 0, long = 0, net = 0, ownOnly = 0, thrown = 0;
  for (const [h, vy, vz] of tosses) {
    const p = V3.new(0, T + h, 1.28), v = V3.new(0, vy, vz), w = V3.new(0, 0, 0);
    const m = gestureMetrics(gm);
    const c = { side: 1, isServe: true, ball: { y: p.y, z: p.z }, ballSpin: w, ballSpeed: V3.len(v) };
    try {
      let rk = A.deriveStroke(m, c);
      rk = A.refineRacket(p, v, w, rk, 0.72, rk.quality);
      const v2 = V3.clone(v), w2 = V3.clone(w);
      A.impactRacket(v2, w2, rk.normal, rk.vR, rk.quality, rk.rubber || {});
      const rep = {}; A.predict(V3.clone(p), v2, w2, { dt: 1 / 300, maxT: 3.0, out: rep });
      n++;
      const ok = rep.bounces >= 2 && Math.sign(rep.landed.z) === 1 && Math.sign(rep.b2.z) === -1 && !rep.hitNet;
      if (ok) legal++; else if (rep.hitNet) net++;
      else if (rep.bounces >= 1 && Math.sign(rep.landed.z) === 1 && !rep.b2) long++;
      else ownOnly++;
    } catch (e) { thrown++; }
  }
  byServe[nm] = { n, legal, long, net, ownOnly, thrown };
  console.log(`  ${nm.padEnd(18)} legal ${String(legal).padStart(2)}/${n}  (long ${long}, net ${net}, no-2nd-bounce ${ownOnly}, exceptions ${thrown})`);
}
const tot = Object.values(byServe).reduce((a, b) => a + b.legal, 0), totN = Object.values(byServe).reduce((a, b) => a + b.n, 0);
console.log(`  TOTAL: ${tot}/${totN} legal serves = ${(100 * tot / totN).toFixed(0)} %`);
// and per assist for the worst archetype
for (const assist of [0, 0.5, 0.72, 1.0]) {
  let legal = 0, n = 0;
  for (const [h, vy, vz] of tosses) {
    const p = V3.new(0, T + h, 1.28), v = V3.new(0, vy, vz), w = V3.new(0, 0, 0);
    const c = { side: 1, isServe: true, ball: { y: p.y, z: p.z }, ballSpin: w, ballSpeed: V3.len(v) };
    let rk = A.deriveStroke(gestureMetrics(serveGests[0][1]), c);
    rk = A.refineRacket(p, v, w, rk, assist, rk.quality);
    const v2 = V3.clone(v), w2 = V3.clone(w);
    A.impactRacket(v2, w2, rk.normal, rk.vR, rk.quality, rk.rubber || {});
    const rep = {}; A.predict(V3.clone(p), v2, w2, { dt: 1 / 300, maxT: 3.0, out: rep });
    n++;
    if (rep.bounces >= 2 && Math.sign(rep.landed.z) === 1 && Math.sign(rep.b2.z) === -1 && !rep.hitNet) legal++;
  }
  console.log(`  topspin serve with assist ${assist}: ${legal}/${n} legal`);
}

/* ------------------ archetype delivery at assist 0.72 ------------------ */
function contactState(kind) {
  const spec = {
    fastTop: { p: [0.15, T + 0.30, -1.20], v: [-0.2, 0.9, 9.0], w: [380, 0, 0] },
    slowTop: { p: [0.10, T + 0.30, -1.10], v: [0.1, 0.7, 6.0], w: [180, 0, 0] },
    push: { p: [0.05, T + 0.28, -1.00], v: [0.0, 0.6, 5.0], w: [-220, 0, 0] },
    high: { p: [0.0, T + 0.62, -0.60], v: [0.0, 0.4, 4.0], w: [120, 0, 0] },
    knear: { p: [0.0, T + 0.22, -0.30], v: [0.0, 0.8, 3.0], w: [-200, 0, 0] },
  }[kind];
  const p = V3.new(...spec.p), v = V3.new(...spec.v), w = V3.new(...spec.w), o = {};
  A.predict(p, v, w, { dt: 1 / 400, maxT: 2.0, stopZ: 1.15, stopDir: 1, stopAtPlane: true, out: o });
  return { p: V3.new(o.reach.x, o.reach.y, o.reach.z), v: V3.new(o.reach.vx, o.reach.vy, o.reach.vz), w: V3.clone(w) };
}
const lib = [
  ['LOOP', { up: 0.95, right: 0.31, dist: 0.30, releaseSpeed: 2.6, peakSpeed: 2.7 }, 'slowTop'],
  ['COUNTER', { up: 0.94, right: 0.34, dist: 0.30, releaseSpeed: 3.3, peakSpeed: 3.4 }, 'fastTop'],
  ['DRIVE', { up: 0.30, right: 0.95, dist: 0.34, releaseSpeed: 3.0, peakSpeed: 3.1 }, 'slowTop'],
  ['SMASH', { up: 0.35, right: 0.94, dist: 0.40, releaseSpeed: 3.6, peakSpeed: 3.7 }, 'high'],
  ['FLICK', { up: 0.92, right: 0.39, dist: 0.11, releaseSpeed: 2.0, peakSpeed: 2.1 }, 'knear'],
  ['PUSH', { up: -0.70, right: 0.71, dist: 0.16, releaseSpeed: 1.7, peakSpeed: 1.8 }, 'push'],
  ['CHOP', { up: -0.85, right: 0.53, dist: 0.42, releaseSpeed: 3.1, peakSpeed: 3.2 }, 'slowTop'],
  ['BLOCK', { up: 0.60, right: 0.80, dist: 0.035, releaseSpeed: 0.55, peakSpeed: 0.6 }, 'fastTop'],
  ['LOB', { up: 0.98, right: 0.20, dist: 0.22, releaseSpeed: 1.1, peakSpeed: 1.2 }, 'push'],
  ['HOOK', { up: 0.45, right: 0.89, dist: 0.34, releaseSpeed: 2.9, peakSpeed: 3.0, curl: 0.9 }, 'slowTop'],
  ['FADE', { up: 0.40, right: -0.92, dist: 0.34, releaseSpeed: 2.9, peakSpeed: 3.0, curl: 0.9 }, 'slowTop'],
  ['DROP', { up: -0.50, right: 0.87, dist: 0.14, releaseSpeed: 1.0, peakSpeed: 1.1 }, 'knear'],
];
console.log('\n=========== ARCHETYPE DELIVERY (assist 0.72) ===========');
const delivery = {};
for (const [want, gm, inc] of lib) {
  const cs = contactState(inc);
  const c = { side: 1, ball: { y: cs.p.y, z: cs.p.z }, ballSpin: cs.w, ballSpeed: V3.len(cs.v), powerScale: 1 };
  const m = gestureMetrics(gm);
  const cls = A.deriveStroke(m, c).stroke.id;
  let rk = A.deriveStroke(m, c);
  rk = A.refineRacket(cs.p, cs.v, cs.w, rk, 0.72, rk.quality);
  const v = V3.clone(cs.v), w = V3.clone(cs.w);
  A.impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
  const rep = {}; A.predict(V3.clone(cs.p), v, w, { dt: 1 / 300, maxT: 2.6, stopOnFirstBounce: true, out: rep });
  const topspin = -w.x / A.TAU;
  const inPlay = !rep.hitNet && rep.landed && rep.landed.z < 0 && Math.abs(rep.landed.x) <= PH.T_HALF_WID;
  delivery[want] = { cls, kmh: V3.len(v) * 3.6, topspin, inPlay, net: rep.hitNet, dz: rep.landed ? rep.landed.z : null };
  console.log(`  ${want.padEnd(8)} classified ${cls.padEnd(9)} ${(V3.len(v) * 3.6).toFixed(0).padStart(3)} km/h  top ${topspin.toFixed(0).padStart(5)} rev/s  ${inPlay ? 'IN' : (rep.hitNet ? 'NET' : 'OUT/OWN')}${rep.landed ? ' z=' + rep.landed.z.toFixed(2) : ''}`);
}
const okIn = Object.values(delivery).filter(d => d.inPlay).length;
console.log(`  delivered on the table: ${okIn}/12 archetypes at default assist`);
const okCls = lib.filter(([w]) => delivery[w].cls === w).length;
console.log(`  classified as intended:  ${okCls}/12`);
