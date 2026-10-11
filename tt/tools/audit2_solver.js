// Headless audit of the physics/stroke/serve modules — pure Node, no puppeteer needed.
// Usage:  node tt/tools/audit2_solver.js        (loads ../src/*.js into a VM context)
/* Audit part 2 — instrumented cost breakdown, serve legality detail, crash causes. */
const fs = require('fs'), vm = require('vm');
const SRC = '/home/user/tabletennis/tt/src/';
let code = ['10_math.js', '30_physics.js', '40_swipe.js'].map(f => fs.readFileSync(SRC + f, 'utf8')).join('\n');
code += `\n;globalThis.API = { PH, V3, DEG, TAU, predict, integrateBall, deriveStroke, refineRacket, ARCH, STROKES, SwipeTracker, impactRacket };`;
const ctx = { console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
const A = ctx.API, { PH, V3 } = A, T = PH.TABLE_Y;

/* ---- instrument predict ---- */
const realPredict = ctx.predict;
let calls = 0, nanos = 0;
ctx.predict = function (...a) { calls++; const t = process.hrtime.bigint(); const r = realPredict.apply(null, a); nanos += Number(process.hrtime.bigint() - t); return r; };

function gesture({ ang, dist, dur, curl = 0, samples = 26, x0 = 0.5, y0 = 0.66 }) {
  const tr = new A.SwipeTracker(); const pts = [];
  let hx = Math.cos(ang * A.DEG), hy = -Math.sin(ang * A.DEG); let x = 0, y = 0;
  const step = dist / (samples - 1);
  for (let i = 0; i < samples; i++) {
    if (curl) { const a = curl * (i / (samples - 1)) / samples * 3; const c = Math.cos(a), s = Math.sin(a); const nx = hx * c - hy * s, ny = hx * s + hy * c; hx = nx; hy = ny; }
    pts.push([x, y]); x += hx * step; y += hy * step;
  }
  tr.down(x0, y0, 0);
  for (let i = 1; i < samples; i++) tr.move(x0 + pts[i][0], y0 + pts[i][1], dur * i / (samples - 1));
  return tr.up(x0 + pts[samples - 1][0], y0 + pts[samples - 1][1], dur);
}
function contactState(kind) {
  const spec = {
    fastTop: { p: [0.15, T + 0.30, -1.20], v: [-0.2, 0.9, 9.0], w: [380, 0, 0] },
    slowTop: { p: [0.10, T + 0.30, -1.10], v: [0.1, 0.7, 6.0], w: [180, 0, 0] },
  }[kind];
  const p = V3.new(...spec.p), v = V3.new(...spec.v), w = V3.new(...spec.w), o = {};
  A.predict(p, v, w, { dt: 1 / 400, maxT: 2.0, stopZ: 1.15, stopDir: 1, stopAtPlane: true, out: o });
  return { p: V3.new(o.reach.x, o.reach.y, o.reach.z), v: V3.new(o.reach.vx, o.reach.vy, o.reach.vz), w: V3.clone(w) };
}
const cs = contactState('fastTop');
const m = gesture({ ang: 74, dist: 0.40, dur: 0.15 });
const mkRacket = (assist) => {
  const c = { side: 1, ball: { y: cs.p.y, z: cs.p.z }, ballSpin: cs.w, ballSpeed: V3.len(cs.v), powerScale: 1 };
  return A.deriveStroke(m, c);
};
console.log('=========== COST OF ONE STROKE SOLVE (refineRacket) ===========');
for (const assist of [0, 0.25, 0.5, 0.72, 1.0]) {
  calls = 0; nanos = 0;
  const rk = mkRacket(assist);
  const t0 = performance.now();
  A.refineRacket(cs.p, cs.v, cs.w, rk, assist, rk.quality);
  const ms = performance.now() - t0;
  console.log(` assist ${assist.toFixed(2)}: ${ms.toFixed(1)} ms wall | predict() calls ${calls} | time inside predict ${(nanos / 1e6).toFixed(1)} ms`);
}
// how often per rally: player + AI strokes
console.log('\npredict() cost per call ~=', (nanos / 1e6 / Math.max(calls, 1)).toFixed(3), 'ms (at the dt used by the solver)');

/* ---- serve detail ---- */
function serveOne(g, dur, assist, contactY = 0.16, vy = -0.9) {
  const p = V3.new(0, T + contactY, 1.30), v = V3.new(0, vy, 0.4), w = V3.new(0, 0, 0);
  const mm = gesture(Object.assign({ dur }, g));
  const c = { side: 1, isServe: true, ball: { y: p.y, z: p.z }, ballSpin: w, ballSpeed: V3.len(v) };
  let rk = A.deriveStroke(mm, c);
  rk = A.refineRacket(p, v, w, rk, assist, rk.quality);
  const v2 = V3.clone(v), w2 = V3.clone(w);
  A.impactRacket(v2, w2, rk.normal, rk.vR, rk.quality, rk.rubber || {});
  const rep = {};
  A.predict(V3.clone(p), v2, w2, { dt: 1 / 300, maxT: 3.0, out: rep });
  const own = rep.bounces >= 1 ? Math.sign(rep.landed.z) : 0;
  const second = rep.b2 ? Math.sign(rep.b2.z) : 0;
  return { stroke: rk.stroke.id, bounces: rep.bounces, own, second, net: rep.hitNet, floor: !!rep.floor,
    valid: rk.valid, kmh: V3.len(v2) * 3.6, spin: V3.len(w2) / A.TAU };
}
console.log('\n=========== SERVE SOLVER (ITTF 2.06.4) ===========');
const gests = [
  ['up-swipe', { ang: 80, dist: 0.34 }],
  ['chop-swipe', { ang: -60, dist: 0.30 }],
  ['side-curl', { ang: 24, dist: 0.32, curl: 0.9 }],
  ['flat-fast', { ang: 8, dist: 0.44 }],
  ['weak-tap', { ang: 60, dist: 0.12 }],
];
for (const assist of [0, 0.72, 1.0]) {
  let ok = 0, n = 0;
  for (const [nm, g] of gests) for (const dur of [0.11, 0.16, 0.22]) {
    const r = serveOne(g, dur, assist); n++;
    const legal = r.bounces >= 2 && r.own === 1 && r.second === -1 && !r.net;
    if (legal) ok++;
    if (assist === 0.72) console.log(`  ${nm.padEnd(11)} dur ${dur}  -> ${r.stroke.padEnd(10)} bounces ${r.bounces} own ${r.own} 2nd ${r.second} net ${r.net} floor ${r.floor} valid ${r.valid} | ${r.kmh.toFixed(0)} km/h ${r.spin.toFixed(0)} rev/s  ${legal ? 'LEGAL' : '*** ILLEGAL'}`);
  }
  console.log(`  assist ${assist}: legal ${ok}/${n}`);
}

/* ---- crash causes on degenerate metrics ---- */
console.log('\n=========== DEGENERATE INPUT ===========');
const cases = [
  ['empty swipe metrics', { speed: 0, peakSpeed: 0, right: 0, up: 0, dist: 0, pathLen: 0, straightness: 1, curl: 0, smooth: 1, samples: 0, x: 0.5, y: 0.5, dur: 0.001, dx: 0, dy: 0, accel: 0, jerk: 0 }],
  ['absurd metrics', { speed: 1e6, peakSpeed: 1e6, right: 1, up: 1, dist: 5, pathLen: 5, straightness: 1, curl: 5, smooth: 1, samples: 5, x: 9, y: -9, dur: 0.001, dx: 5, dy: 5, accel: 1e5, jerk: 0 }],
  ['NaN metrics', { speed: NaN, peakSpeed: NaN, right: NaN, up: NaN, dist: NaN, pathLen: NaN, straightness: NaN, curl: NaN, smooth: NaN, samples: 3, x: NaN, y: NaN, dur: NaN, dx: NaN, dy: NaN, accel: NaN, jerk: NaN }],
];
for (const [nm, mm] of cases) {
  try { const rk = A.deriveStroke(mm, { side: 1, ball: { y: cs.p.y, z: cs.p.z }, ballSpin: cs.w, ballSpeed: V3.len(cs.v) }); console.log(`  ${nm}: ok stroke=${rk.stroke.id} vmag=${rk.vmag}`); }
  catch (e) { console.log(`  ${nm}: THROWS -> ${e.message}`); }
}

/* ---- what does the game's per-frame prediction cost? ---- */
console.log('\n=========== PER-FRAME PREDICTION (ring / landing preview) ===========');
const n0 = calls; const t0 = performance.now();
for (let i = 0; i < 300; i++) A.predict(V3.new(0.3, T + 0.3, 0.6), V3.new(0.5, 1.2, 7), V3.new(-250, 0, 0), { dt: 1 / 400, maxT: 2.0, stopZ: 1.15, stopDir: 1, stopAtPlane: true, out: {} });
console.log(`  1 intercept prediction: ${((performance.now() - t0) / 300).toFixed(3)} ms`);
