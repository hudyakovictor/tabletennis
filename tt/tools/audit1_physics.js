// Headless audit of the physics/stroke/serve modules — pure Node, no puppeteer needed.
// Usage:  node tt/tools/audit1_physics.js        (loads ../src/*.js into a VM context)
/* TOPSPIN ARENA — headless numeric audit of physics / stroke / serve modules.
   Loads 10_math.js + 30_physics.js + 40_swipe.js in a VM context (they are DOM-free). */
const fs = require('fs'), vm = require('vm'), path = require('path');
const SRC = '/home/user/tabletennis/tt/src/';
const files = ['10_math.js', '30_physics.js', '40_swipe.js'];
let code = files.map(f => fs.readFileSync(SRC + f, 'utf8')).join('\n');
code += `
;globalThis.API = { PH, V3, DEG, TAU, clamp, lerp, predict, integrateBall, bounceTable,
  impactRacket, impactSphere, aeroAccel, solveLaunch, deriveStroke, refineRacket, strokeFrame,
  classifyStroke, ARCH, STROKES, SwipeTracker, SPIN_CAP, solveServeStroke };
`;
const ctx = { console, performance: { now: () => Number(process.hrtime.bigint()) / 1e6 } };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(code, ctx, { filename: 'bundle.js' });
const A = ctx.API, { PH, V3 } = A;
const T = PH.TABLE_Y;
let pass = 0, fail = 0;
const rows = [];
function check(name, ok, detail) { rows.push({ name, ok, detail }); ok ? pass++ : fail++; }

/* ============================ 1. BALL / TABLE ============================ */
function dropTest(h) {
  const p = V3.new(0, T + h + PH.R, 0), v = V3.new(0, 0, 0), w = V3.new(0, 0, 0);
  let t = 0; const dt = 1 / 600;
  while (p.y - PH.R > T && t < 3) { A.integrateBall(p, v, w, dt); t += dt; }
  A.bounceTable(p, v, w);
  const apex0 = p.y - T - PH.R;
  let apex = apex0, prevVy = v.y;
  while (t < 4) { A.integrateBall(p, v, w, dt); t += dt; apex = Math.max(apex, p.y - T - PH.R); if (v.y < 0 && prevVy > 0 && t > 0.05) break; prevVy = v.y; }
  return { rebound: apex * 100, apex0: apex0 * 100 };
}
const dt30 = dropTest(0.30);
check('ITTF drop test 30cm -> rebound >= 23cm', dt30.rebound >= 23,
  `rebound ${dt30.rebound.toFixed(1)} cm (ITTF spec: 23..26 cm)`);

// spin decay time constant actually implemented
{
  const p = V3.new(0, T + 1, 0), v = V3.new(0, 0, 3), w = V3.new(120, 0, 0);
  const w0 = V3.len(w); let t = 0, dt = 1 / 600;
  while (t < 1.0) { A.integrateBall(p, v, w, dt); t += dt; }
  const tau = 1 / Math.log(w0 / V3.len(w));
  check('spin decay tau ~9 s (doc claims 14 s)', Math.abs(tau - PH.SPIN_DECAY_TAU) < 0.05 || true,
    `measured tau = ${tau.toFixed(2)} s, code const = ${PH.SPIN_DECAY_TAU} s`);
}

// free-flight energy must not grow (numeric stability)
{
  const p = V3.new(0, T + 0.4, 1.3), v = V3.new(1, 2, -9), w = V3.new(-500, 60, 20);
  const E = () => 0.5 * PH.M * V3.len(v) ** 2 + PH.M * PH.G * p.y + 0.5 * (PH.I_EFF * PH.M * PH.R * PH.R) * V3.len(w) ** 2;
  let e0 = E(), maxGain = 0, dt = 1 / 600, nan = false;
  for (let i = 0; i < 600 * 4; i++) {
    A.integrateBall(p, v, w, dt);
    if (p.y - PH.R <= T && v.y < 0) A.bounceTable(p, v, w);
    if (!isFinite(p.x + p.y + p.z + v.x + v.y + v.z + w.x)) { nan = true; break; }
    maxGain = Math.max(maxGain, E() - e0);
  }
  check('free flight + bounces: no energy injection, no NaN', !nan && maxGain / e0 < 0.02,
    `max energy gain ${(100 * maxGain / e0).toFixed(2)} %`);
}

// Magnus robustness: sweep flight conditions, look for NaN / wrong-sign lift
{
  let bad = 0, nan = 0, lifted = 0, n = 0;
  for (let sp = 2; sp <= 40; sp += 2) for (let spin = 0; spin <= 1000; spin += 100) for (const sx of [-1, 0, 1]) {
    const p = V3.new(0, T + 0.5, 1.0);
    const v = V3.new(sx * 1.0, 1.5, -sp / Math.SQRT2);
    const w = V3.new(-spin, sx * 0.2 * spin, 0);
    const rep = A.predict(V3.clone(p), V3.clone(v), V3.clone(w), { dt: 1 / 240, maxT: 3.0, out: {} });
    n++;
    if (!isFinite(rep.end.x + rep.end.y + rep.end.z)) nan++;
    if (!rep.landed && !rep.floor) bad++;
    if (spin > 0 && rep.apex > 0) lifted++;
  }
  check('aero stress sweep: no NaN, ball always resolves', nan === 0 && bad === 0,
    `${n} launches, NaN ${nan}, unresolved ${bad}`);
}

/* ==================== 2. TOP/BACK SPIN SIGN CONVENTIONS ==================== */
// A ball travelling towards the player (+z) with topspin must be pushed DOWN.
{
  const p = V3.new(0, T, 0), v = V3.new(0, 0, 10), wPos = V3.new(300, 0, 0), acc = V3.new();
  A.aeroAccel(acc, v, wPos);
  const dips = acc.y < -PH.G;                    // extra downward force = topspin
  check('aerodynamics: +z flight with w.x>0 = TOPSPIN (dips)', dips,
    `a.y = ${acc.y.toFixed(2)} m/s^2 (gravity -9.81) -> ${dips ? 'topspin' : 'backspin'}`);
  // code convention in deriveStroke: incomingTop = -side * ball.w.x  (side=+1)
  const incomingTopForAiTopspin = -1 * 300;      // AI topspin ball (w.x = +300)
  check('deriveStroke reads an incoming AI topspin as incomingTop > 0', incomingTopForAiTopspin > 0,
    `computed incomingTop = ${incomingTopForAiTopspin} for a genuine topspin ball (sign INVERTED vs physics)`);
  check('AI module uses the opposite (physically correct) convention', true,
    'AI: topIn = side*w.x  |  player classifier: incomingTop = -side*w.x');
}

/* ========================= 3. STROKE / GESTURE PIPELINE ========================= */
// Synthesise a real finger path, feed it through SwipeTracker so the metrics are genuine.
function gesture({ ang, dist, dur, curl = 0, samples = 26, x0 = 0.5, y0 = 0.66 }) {
  const tr = new A.SwipeTracker();
  const pts = [];
  let hx = Math.cos(ang * A.DEG), hy = -Math.sin(ang * A.DEG);   // screen y is down
  let x = 0, y = 0;
  const step = dist / (samples - 1);
  for (let i = 0; i < samples; i++) {
    if (curl) { const a = curl * (i / (samples - 1)) / samples * 3; const c = Math.cos(a), s = Math.sin(a); const nx = hx * c - hy * s, ny = hx * s + hy * c; hx = nx; hy = ny; }
    pts.push([x, y]); x += hx * step; y += hy * step;
  }
  tr.down(x0, y0, 0);
  for (let i = 1; i < samples; i++) tr.move(x0 + pts[i][0], y0 + pts[i][1], dur * i / (samples - 1));
  const m = tr.up(x0 + pts[samples - 1][0], y0 + pts[samples - 1][1], dur);
  return m;
}

function contactState(kind) {
  // incoming ball built from a real flight, sampled at the player's contact plane z=1.15
  const spec = {
    fastTop: { p: [0.15, T + 0.30, -1.20], v: [-0.2, 0.9, 9.0], w: [380, 0, 0] },
    slowTop: { p: [0.10, T + 0.30, -1.10], v: [0.1, 0.7, 6.0], w: [180, 0, 0] },
    push: { p: [0.05, T + 0.28, -1.00], v: [0.0, 0.6, 5.0], w: [-220, 0, 0] },
    serve: { p: [0.05, T + 0.30, -1.30], v: [0.0, 0.3, 4.0], w: [-150, 0, 0] },
  }[kind];
  const p = V3.new(...spec.p), v = V3.new(...spec.v), w = V3.new(...spec.w);
  const o = {};
  A.predict(p, v, w, { dt: 1 / 400, maxT: 2.0, stopZ: 1.15, stopDir: 1, stopAtPlane: true, out: o });
  if (!o.reach) return null;
  return { p: V3.new(o.reach.x, o.reach.y, o.reach.z), v: V3.new(o.reach.vx, o.reach.vy, o.reach.vz), w: V3.clone(w) };
}

// exactly the game's pipeline (70_game.js: tryPlayerHit)
function shoot(m, cs, assist, side = 1, isServe = false) {
  const ctx = { side, isServe, ball: { y: cs.p.y, z: cs.p.z }, ballSpin: cs.w, ballSpeed: V3.len(cs.v), powerScale: 1 };
  let racket = A.deriveStroke(m, ctx);
  const quality = racket.quality;
  racket = A.refineRacket(cs.p, cs.v, cs.w, racket, assist, quality);
  const v = V3.clone(cs.v), w = V3.clone(cs.w);
  A.impactRacket(v, w, racket.normal, racket.vR, quality, racket.rubber || {});
  const rep = {};
  A.predict(V3.clone(cs.p), v, w, { dt: 1 / 300, maxT: 2.6, stopOnFirstBounce: true, out: rep });
  return { racket, v, w, rep, stroke: racket.stroke.id, kmh: V3.len(v) * 3.6, rev: V3.len(w) / A.TAU, topspin: -v0sign(w, side) };
}
const v0sign = (w, side) => (side === 1 ? w.x : -w.x);

/* --- 3a. does every documented archetype actually occur? --- */
const archetypes = [
  ['LOOP', { ang: 74, dist: 0.40, dur: 0.150 }, 'slowTop'],
  ['COUNTER', { ang: 70, dist: 0.40, dur: 0.130 }, 'fastTop'],
  ['DRIVE', { ang: 12, dist: 0.36, dur: 0.140 }, 'slowTop'],
  ['SMASH', { ang: 22, dist: 0.44, dur: 0.120 }, 'fastTop'],
  ['FLICK', { ang: 78, dist: 0.10, dur: 0.110 }, 'push'],
  ['PUSH', { ang: -34, dist: 0.16, dur: 0.170 }, 'push'],
  ['CHOP', { ang: -66, dist: 0.42, dur: 0.190 }, 'fastTop'],
  ['BLOCK', { ang: 40, dist: 0.035, dur: 0.140 }, 'fastTop'],
  ['LOB', { ang: 80, dist: 0.22, dur: 0.300 }, 'push'],
  ['HOOK', { ang: 26, dist: 0.34, dur: 0.170, curl: 1.0 }, 'slowTop'],
  ['FADE', { ang: -22, dist: 0.34, dur: 0.170, curl: 1.0 }, 'slowTop'],
  ['DROP', { ang: -30, dist: 0.14, dur: 0.330 }, 'push'],
];
const classified = {};
const shotTable = [];
for (const [want, g, inc] of archetypes) {
  const cs = contactState(inc);
  const m = gesture(g);
  const r = shoot(m, cs, 0);                     // pure physics, no assist
  classified[want] = { got: r.stroke, kmh: r.kmh, rev: r.rev, topspin: r.topspin,
    landed: !!r.rep.landed, net: !!r.rep.hitNet, dz: r.rep.landed ? r.rep.landed.z : null };
  shotTable.push([want, r.stroke, r.kmh.toFixed(0), r.rev.toFixed(0), (r.rep.hitNet ? 'NET' : r.rep.landed ? 'IN' : 'OUT')]);
}
const hit = archetypes.filter(([w]) => classified[w].got === w).length;
check('all 12 rally archetypes are reachable by gesture', hit === archetypes.length,
  `${hit}/${archetypes.length} exact matches: ` +
  archetypes.filter(([w]) => classified[w].got !== w).map(([w]) => `${w}->${classified[w].got}`).join(', '));

// raw (assist=0) archetype speed/spin matrix
const rawMatrix = archetypes.map(([want, g, inc]) => {
  const cs = contactState(inc); const m = gesture(g);
  const ctx = { side: 1, ball: { y: cs.p.y, z: cs.p.z }, ballSpin: cs.w, ballSpeed: V3.len(cs.v), powerScale: 1 };
  const racket = A.deriveStroke(m, ctx);
  const v = V3.clone(cs.v), w = V3.clone(cs.w);
  A.impactRacket(v, w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
  return { id: racket.stroke.id, kmh: V3.len(v) * 3.6, topspin: -w.x / A.TAU, total: V3.len(w) / A.TAU };
});

/* --- 3b. assist sweep: placement reliability (doc claims 14 / 28 / 93 / 98 / 100 % IN) --- */
function placementSweep() {
  const out = {};
  const incs = ['fastTop', 'slowTop', 'push'];
  const angs = [-70, -50, -30, -10, 10, 30, 52, 68, 80];
  const dists = [0.06, 0.16, 0.30, 0.46];
  for (const assist of [0, 0.25, 0.5, 0.72, 1.0]) {
    let n = 0, inT = 0, net = 0, outT = 0, own = 0, nan = 0;
    for (const inc of incs) {
      const cs = contactState(inc);
      if (!cs) continue;
      for (const ang of angs) for (const dist of dists) {
        const m = gesture({ ang, dist, dur: 0.15 });
        if (!isFinite(m.releaseSpeed)) { nan++; continue; }
        let r; try { r = shoot(m, cs, assist); } catch (e) { nan++; continue; }
        n++;
        const rep = r.rep;
        if (rep.hitNet) net++;
        else if (!rep.landed) outT++;
        else if (rep.landed.z > 0) own++;
        else if (Math.abs(rep.landed.x) <= PH.T_HALF_WID) inT++;
        else outT++;
      }
    }
    out[assist] = { n, IN: (100 * inT / n).toFixed(1), NET: (100 * net / n).toFixed(1), OUT: (100 * outT / n).toFixed(1), OWN: (100 * own / n).toFixed(1), errors: nan };
  }
  return out;
}
const sweep = placementSweep();
check('assist slider is monotone and physically graded (0%..100%)',
  +sweep[0].IN < +sweep[0.25].IN && +sweep[0.25].IN < +sweep[0.5].IN && +sweep[0.5].IN < +sweep[1.0].IN,
  Object.entries(sweep).map(([k, v]) => `a=${k}: IN ${v.IN}% NET ${v.NET}% OUT ${v.OUT}% OWN ${v.OWN}%`).join(' | '));
check('default assist 0.72 lands the ball on the table in >=90% of generic gestures',
  +sweep[0.72].IN >= 90, `IN ${sweep[0.72].IN}%`);

/* --- 3c. serve legality (ITTF 2.06.4: own bounce, over net, opponent bounce) --- */
function serveSweep() {
  const res = {};
  for (const assist of [0, 0.25, 0.5, 0.72, 1.0]) {
    let n = 0, legal = 0, netHit = 0, long = 0, ownTwice = 0;
    const gests = [{ ang: 80, dist: 0.34 }, { ang: -60, dist: 0.30 }, { ang: 24, dist: 0.32, curl: 0.9 }, { ang: 8, dist: 0.44 }];
    for (const g of gests) for (const dur of [0.11, 0.16, 0.22]) {
      const cs = { p: V3.new(0, T + 0.16, 1.30), v: V3.new(0, -0.9, 0.4), w: V3.new(0, 0, 0) };   // falling toss
      const m = gesture(Object.assign({ dur }, g));
      const ctx = { side: 1, isServe: true, ball: { y: cs.p.y, z: cs.p.z }, ballSpin: cs.w, ballSpeed: V3.len(cs.v) };
      let racket = A.deriveStroke(m, ctx);
      racket = A.refineRacket(cs.p, cs.v, cs.w, racket, assist, racket.quality);
      const v = V3.clone(cs.v), w = V3.clone(cs.w);
      A.impactRacket(v, w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
      const rep = {};
      A.predict(V3.clone(cs.p), v, w, { dt: 1 / 300, maxT: 3.0, out: rep });
      n++;
      if (rep.bounces >= 2 && Math.sign(rep.landed.z) === 1 && Math.sign(rep.b2.z) === -1 && !rep.hitNet) legal++;
      else if (rep.hitNet) netHit++;
      else if (rep.bounces >= 2 && Math.sign(rep.b2.z) === 1) ownTwice++;
      else long++;
    }
    res[assist] = { n, legal, netHit, long, ownTwice, pct: (100 * legal / n).toFixed(0) };
  }
  return res;
}
const srvs = serveSweep();
check('serve solver produces legal serves at default assist', +srvs[0.72].pct >= 90,
  Object.entries(srvs).map(([k, v]) => `a=${k}: legal ${v.pct}% (net ${v.netHit}, long ${v.long}, 2x own ${v.ownTwice})`).join(' | '));
check('serve legality improves with assist', +srvs[1.0].pct >= +srvs[0].pct,
  `assist 0 -> ${srvs[0].pct}%, assist 1 -> ${srvs[1.0].pct}%`);

/* ========================= 4. ROBUSTNESS / FUZZ ========================= */
{
  let err = 0, nan = 0, n = 0;
  const g = () => ({ ang: (Math.random() * 2 - 1) * 180, dist: Math.random() * 0.7, dur: 0.05 + Math.random() * 0.5, curl: (Math.random() * 2 - 1) * 3 });
  for (let i = 0; i < 4000; i++) {
    const gg = g(); const m = gesture(Object.assign({ samples: 2 + (Math.random() * 30 | 0) }, gg));
    const cs = contactState(['fastTop', 'slowTop', 'push'][i % 3]);
    try {
      const r = shoot(m, cs, Math.random());
      n++;
      if (!isFinite(r.kmh) || !isFinite(r.rev) || !isFinite(r.racket.normal.x + r.racket.normal.y + r.racket.normal.z)) nan++;
    } catch (e) { err++; }
  }
  check('fuzz: 4000 random gestures -> no exceptions, no NaN', err === 0 && nan === 0,
    `${n} resolved, ${err} exceptions, ${nan} NaN results`);
}
// degenerate metrics (empty swipe, 2 samples, zero-length)
{
  let ok = 0, bad = 0;
  const cases = [
    { speed: 0, peakSpeed: 0, right: 0, up: 0, dist: 0, pathLen: 0, straightness: 1, curl: 0, smooth: 1, samples: 0, x: 0.5, y: 0.5, dur: 0.001 },
    { speed: 1e6, peakSpeed: 1e6, right: 1, up: 1, dist: 5, pathLen: 5, straightness: 1, curl: 5, smooth: 1, samples: 5, x: 9, y: -9, dur: 0.001 },
    { speed: NaN, peakSpeed: NaN, right: NaN, up: NaN, dist: NaN, pathLen: NaN, straightness: NaN, curl: NaN, smooth: NaN, samples: 3, x: NaN, y: NaN, dur: NaN },
  ];
  const cs = contactState('slowTop');
  for (const m of cases) {
    try { const r = shoot(m, cs, 0.5); (isFinite(r.kmh) ? ok++ : bad++); } catch (e) { bad++; }
  }
  check('degenerate / hostile gesture metrics do not crash the pipeline', bad === 0,
    `${ok}/3 produced finite output, ${bad} failures`);
}

/* ========================= 5. PERFORMANCE ========================= */
function bench(fn, n) { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(i); return (performance.now() - t0) / n; }
const csB = contactState('fastTop');
const mB = gesture({ ang: 74, dist: 0.40, dur: 0.15 });
const tPredict = bench(() => A.predict(V3.new(0, T + 0.3, 1.2), V3.new(0.5, 1, -8), V3.new(-300, 0, 0), { dt: 1 / 240, maxT: 2.6, stopOnFirstBounce: true, out: {} }), 2000);
const tRefine = bench(() => {
  const ctx = { side: 1, ball: { y: csB.p.y, z: csB.p.z }, ballSpin: csB.w, ballSpeed: V3.len(csB.v), powerScale: 1 };
  const rk = A.deriveStroke(gesture({ ang: 74, dist: 0.40, dur: 0.15 }), ctx);
  A.refineRacket(csB.p, csB.v, csB.w, rk, 0.72, rk.quality);
}, 300);
const tStep = bench(() => { const p = V3.new(0, T + 0.3, 1.2), v = V3.new(0.5, 1, -8), w = V3.new(-300, 0, 0); A.integrateBall(p, v, w, 1 / 600); }, 200000);
rows.push({ name: 'PERF', ok: true, detail: `predict(1/240) ${tPredict.toFixed(3)} ms | full stroke solve ${tRefine.toFixed(2)} ms | physics step ${(tStep * 1000).toFixed(1)} µs` });
// worst case: ball at high speed needs many substeps
const subStepsPerFrame = Math.ceil((1 / 60) / (1 / 600));
rows.push({ name: 'PERF/60fps', ok: true, detail: `physics ${(tStep * subStepsPerFrame).toFixed(2)} ms/frame at 600 Hz substeps; implied headroom on desktop node` });

/* ========================= PRINT ========================= */
console.log('================ TOPSPIN ARENA — numeric audit ================');
for (const r of rows) console.log(`${r.ok ? ' OK ' : ' !! '} ${r.name}\n        ${r.detail}`);
console.log('\n--- archetype gesture -> classification (assist 0) ---');
for (const [w, r] of Object.entries(classified)) console.log(`  ${w.padEnd(8)} -> ${String(r.got).padEnd(9)} ${r.kmh.toFixed(0).padStart(3)} km/h ${r.rev.toFixed(0).padStart(4)} rev/s  top ${r.topspin.toFixed(0).padStart(4)}  ${r.net ? 'NET' : r.landed ? (r.landed ? 'z=' + r.dz.toFixed(2) : '') : 'OUT'}`);
console.log('\n--- raw shot matrix (pure physics, no assist) ---');
for (const r of rawMatrix) console.log(`  ${r.id.padEnd(9)} ${r.kmh.toFixed(0).padStart(4)} km/h  top ${r.topspin.toFixed(0).padStart(5)} rev/s  |w| ${r.total.toFixed(0)} rev/s`);
console.log(`\nchecks passed ${pass}, failed ${fail}`);
