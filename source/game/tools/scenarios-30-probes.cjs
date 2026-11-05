'use strict';
/* =====================================================================
 *  Scenarios 30 — measurement harness (2026-11-05).
 *
 *  The assertions live in `tests/scenarios-30*.test.js`. This tool prints
 *  the raw numbers the audit report quotes, so every figure in
 *  `docs/scenarios-30-audit-2026-11-05.ru.md` can be re-measured without
 *  reading the tests:
 *
 *      node tools/scenarios-30-probes.cjs
 *
 *  Sections are numbered by the scenario they document.
 * ===================================================================== */
const { load } = require('../tests/helpers.cjs');

const L = load([
  '10_math.js', '30_physics.js', '12_match_rules.js', '27_network.js', '38_paddle_motion.js',
  '37_stroke_motion_data.js', '40_swipe.js', '42_shot_diagnostics.js', '55_ai.js', '57_camera.js',
  '84_racket.js',
], [
  'V3', 'PH', 'STROKE_CONFIG', 'SwipeTracker', 'deriveStroke', 'refineRacket', 'impactRacket',
  'predict', 'integrateBall', 'tableContact', 'bounceTable', 'netContactStep', 'bladePlaneCapture',
  'playerCaptureLimits', 'solveStrikeCorridor', 'evaluateContactZone', 'paddleContactPose',
  'paddleTableClearance', 'enforcePaddleTableClearance', 'paddleLimitsFor', 'PADDLE_LIMITS',
  'PADDLE_STANCE_Z', 'Equipment', 'OpponentAI', 'resolveRacketLaunch', 'NetworkManager',
  'netMirrorState', 'quantizeDepth',
], { WebSocket: class { static OPEN = 1; constructor() { this.readyState = 1; } send() {} close() {} },
  location: { search: '' } });

const {
  V3, PH, STROKE_CONFIG, deriveStroke, refineRacket, impactRacket, predict, integrateBall,
  tableContact, bounceTable, netContactStep, bladePlaneCapture, playerCaptureLimits,
  solveStrikeCorridor, evaluateContactZone, paddleTableClearance, enforcePaddleTableClearance,
  paddleLimitsFor, PADDLE_LIMITS, PADDLE_STANCE_Z, Equipment, OpponentAI, resolveRacketLaunch,
  NetworkManager, netMirrorState, quantizeDepth,
} = L;
const TY = PH.TABLE_Y;
const pad = () => ({ pos: V3.new(0, TY + 0.35, 1.78), normal: V3.new(0, 0, -1), prevPos: V3.new() });
const proj = (q) => ({ ok: true, x: 0.5 + q.x * 0.28, y: 0.55 - (q.y - TY) * 0.42 });
const rngFrom = (seed) => { let st = seed >>> 0; return () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296); };
const head = (n, t) => console.log(`\n=== ${n}. ${t} ===`);

/* ---------------------------------------------------------------- 11 */
head(11, 'swept capture vs frame samples');
{
  const n = V3.norm(V3.new(), V3.new(0.25, -0.35, -1));
  const padPos = V3.new(0, TY + 0.35, 1.78), padPrev = V3.new(0.05, TY + 0.33, 1.80);
  let edges = 0, on = 0, prev = null, sweptOnly = 0;
  for (let off = -0.6; off <= 0.6001; off += 0.002) {
    const b0 = V3.new(off, TY + 0.40, 2.55), b1 = V3.new(off + 0.02, TY + 0.35, 1.55);
    const ok = bladePlaneCapture(b1, b0, padPos, padPrev, n, false).ok;
    if (ok) on++;
    if (prev !== null && ok !== prev) edges++;
    prev = ok;
    const mid = V3.new((b0.x + b1.x) / 2, (b0.y + b1.y) / 2, (b0.z + b1.z) / 2);
    const discrete = [b0, mid, b1].some(b => bladePlaneCapture(b, b, padPos, padPrev, n, false).ok);
    if (ok && !discrete) sweptOnly++;
  }
  console.log(`offsets 601, detected ${on}, contiguity edges ${edges} (2 = one interval), swept-only catches ${sweptOnly}`);
  console.log(`capture radius ${playerCaptureLimits(false).radius} m, depth ${playerCaptureLimits(false).depth} m`);
}

/* ---------------------------------------------------------------- 12 */
head(12, 'simultaneous height/width/depth limits');
{
  let cells = 0, corner = 0, worstClear = Infinity;
  for (const z of [PADDLE_LIMITS.zStepIn, 1.45, 1.61, PADDLE_STANCE_Z, PADDLE_LIMITS.zFar]) {
    const lim = paddleLimitsFor(z);
    let line = [];
    for (const wantX of [0, 1.2, 2.4]) for (const wantY of [0.02, 0.18, 2.0]) {
      const x = Math.max(-lim.x, Math.min(lim.x, wantX));
      const y = Math.max(TY + lim.yLo, Math.min(TY + lim.yHi, TY + wantY));
      cells++;
      if (wantX > lim.x && wantY <= 0.18) corner++;
      const clr = paddleTableClearance({ x, y, z }, V3.norm(V3.new(), V3.new(0, -0.2, -1)), 0);
      if (z <= PH.T_HALF_LEN + 0.24 && Math.abs(x) <= PH.T_HALF_WID) worstClear = Math.min(worstClear, clr);
      line.push(`x${x.toFixed(2)} y${y.toFixed(2)}`);
    }
    console.log(`z=${z.toFixed(2)} lim(x ±${lim.x.toFixed(2)}, y ${lim.yLo.toFixed(2)}…${lim.yHi.toFixed(2)}) -> ${line.join(' | ')}`);
  }
  console.log(`cells ${cells}, corner cells (width and height limit at once) ${corner}, worst table clearance over the table ${worstClear.toFixed(4)} m`);
}

/* ---------------------------------------------------------------- 13 */
head(13, 'table clearance lift');
{
  const n = V3.norm(V3.new(), V3.new(0, -0.18, -1));
  const rng = rngFrom(7);
  let lifts = 0, below = 0, moved = 0, again = 0;
  for (let i = 0; i < 1500; i++) {
    const p = { x: (rng() * 2 - 1) * 2.1, y: TY - 0.10 + rng() * 0.30, z: 1.20 + rng() * 0.95 };
    const bx = p.x, bz = p.z, roll = (rng() * 2 - 1) * 0.6;
    if (enforcePaddleTableClearance(p, n, roll) > 1e-9) lifts++;
    if (p.x !== bx || p.z !== bz) moved++;
    if (enforcePaddleTableClearance(p, n, roll) > 1e-9) again++;
    if (paddleTableClearance(p, n, roll) < 0.006 - 1e-6) below++;
  }
  console.log(`1500 poses: lifted ${lifts}, still below ${below}, x/z moved ${moved}, needed a second lift ${again}`);
}

/* ---------------------------------------------------------------- 14 */
head(14, 'sidespin moves the meeting point, forecast stability');
{
  const land = (wy) => { const o = {}; predict(V3.new(0, TY + 0.42, -0.9), V3.new(0, 1.2, 5.4), V3.new(0, wy, 0), { dt: 1 / 240, maxT: 2, out: o, maxPath: 2000 }); return o.landed; };
  for (const wy of [0, 280, -280, 600, -600]) {
    const l = land(wy);
    console.log(`w.y=${wy}: landing x=${l.x.toFixed(3)} z=${l.z.toFixed(3)} t=${l.t.toFixed(3)}`);
  }
  const p = V3.new(0, TY + 0.42, -0.9), v = V3.new(0, 1.2, 5.4), w = V3.new(0, 400, 0);
  let prev = null, worst = 0;
  for (let i = 0; i <= 12; i++) {
    const o = {}; predict(V3.clone(p), V3.clone(v), V3.clone(w), { dt: 1 / 240, maxT: 2, out: o, maxPath: 2000 });
    if (o.landed && prev) worst = Math.max(worst, Math.hypot(o.landed.x - prev.x, o.landed.z - prev.z));
    if (o.landed) prev = o.landed;
    integrateBall(p, v, w, 0.02);
  }
  console.log(`forecast re-run every 20 ms over a 400 rad/s ball: worst step ${worst.toFixed(4)} m`);
}

/* ---------------------------------------------------------------- 16/17 */
head(16, 'five AI serves -> receiver corridor');
{
  const SERVES = { SERVE_TOP: .10, SERVE_BACK: .40, SERVE_SIDE: .65, SERVE_FAST: .80, SERVE_NO_SPIN: .95 };
  const out = {};
  for (const [id, draw] of Object.entries(SERVES)) {
    let solved = 0, corridors = 0, admitted = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rng = rngFrom(seed * 97), ai = new OpponentAI(1);
      ai.side = -1; ai.setHandicap(1);
      const draws = [draw, .35 + rng() * .3, .3 + rng() * .4, rng() < .5 ? .1 : .9, rng() < .5 ? .1 : .9];
      ai.rng = () => (draws.length ? draws.shift() : rng());
      const ball = { p: V3.new((rng() * 2 - 1) * .2, TY + STROKE_CONFIG.serve.toss.aiContactHeight, -(PH.T_HALF_LEN + .2)),
        v: V3.new((rng() * 2 - 1) * .05, -2.43, (rng() * 2 - 1) * .05), w: V3.new(), live: true, lastHitBy: 0 };
      const racket = ai.serve({ ball, time: 0, strokeTime: 0, equip: { forSide: () => ({}) } });
      if (!racket || !racket.valid) continue;
      const launch = resolveRacketLaunch(ball, racket);
      if (!launch) continue;
      solved++;
      const p = V3.clone(launch.p), v = V3.clone(launch.v), w = V3.clone(launch.w);
      const prev = V3.new(), hit = {};
      let state = null, bounces = 0;
      for (let i = 0; i < 1200; i++) {
        V3.copy(prev, p); integrateBall(p, v, w, PH.SIM_DT);
        if (netContactStep(prev.x, prev.y, prev.z, p.x, p.y, p.z, hit)) break;
        if (v.y < 0 && tableContact(prev.x, prev.y, prev.z, p.x, p.y, p.z, hit)) {
          V3.copy(p, { x: hit.x, y: hit.y + 1e-5, z: hit.z });
          bounceTable(p, v, w);
          bounces++;
          if (bounces === 1) state = { p: V3.clone(p), v: V3.clone(v), w: V3.clone(w) };
          if (bounces === 2) break;
        }
        if (p.y < .05) break;
      }
      if (!state) continue;
      const incoming = { ...state, live: true, lastHitBy: -1 };
      const c = solveStrikeCorridor(incoming, pad(), [], predict, { tableY: TY });
      if (!c.valid) continue;
      corridors++;
      const a = proj(c.primary);
      const z = evaluateContactZone(c, incoming, { x: a.x, y: a.y }, 390, 844, proj, () => null, { pointerType: 'touch' });
      if (z && z.accepted) admitted++;
    }
    out[id] = { solved, corridors, admitted };
  }
  for (const [k, v] of Object.entries(out)) console.log(`${k}: solved ${v.solved}, corridors ${v.corridors}, press admitted ${v.admitted}`);
}

head(17, 'backspin bounce and the reversing ball');
{
  const run = (spinX) => {
    const v = V3.new(0, -1.4, 6.5), spin = V3.new(spinX, 0, 0), p = V3.new(0, TY + 0.35, -0.6);
    const prev = V3.new(), hit = {};
    for (let i = 0; i < 1200; i++) {
      V3.copy(prev, p); integrateBall(p, v, spin, PH.SIM_DT);
      if (netContactStep(prev.x, prev.y, prev.z, p.x, p.y, p.z, hit)) return null;
      if (v.y < 0 && tableContact(prev.x, prev.y, prev.z, p.x, p.y, p.z, hit)) {
        V3.copy(p, { x: hit.x, y: hit.y + 1e-5, z: hit.z });
        const before = v.z; bounceTable(p, v, spin);
        return { z: p.z, before, after: v.z };
      }
      if (p.y < .05) return null;
    }
    return null;
  };
  for (const spin of [-300, -600, -900, -1200]) {
    const b = run(spin);
    console.log(`w.x=${spin}: bounce z=${b.z.toFixed(2)} vz ${b.before.toFixed(2)} -> ${b.after.toFixed(2)} (${b.after < 0 ? 'REVERSED' : 'forward'})`);
  }
  const away = { p: V3.new(0, TY + 0.20, 0.55), v: V3.new(0, -0.9, -4.0), w: V3.new(500, 0, 0), live: true, lastHitBy: -1 };
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 40; i++) {
    const c = solveStrikeCorridor(away, pad(), [], predict, { tableY: TY });
    if (c.valid) console.log('  !! a ball leaving the player produced a corridor');
  }
  console.log(`40 refusals for a reversing ball: ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(1)} ms`);
}

/* ---------------------------------------------------------------- 18 */
head(18, 'centre -> edge -> rim');
{
  const n0 = V3.norm(V3.new(), V3.new(0, -0.25, -1));
  const swing = (n, q = 1) => { const v = V3.new(0, 0.55, 6.1), w = V3.new(-55, 25, 0); const i = impactRacket(v, w, n, V3.new(0, 2, -7), q, {}); return i ? { speed: V3.len(v), spin: V3.len(w), slip: i.slipping } : null; };
  for (let phi = 0; phi <= 90; phi += 10) {
    const a = phi * Math.PI / 180;
    const r = swing(V3.norm(V3.new(), V3.new(Math.sin(a), n0.y, -Math.cos(a))));
    console.log(`face angle ${String(phi).padStart(2)}°: ${r ? `${r.speed.toFixed(2)} m/s, ${r.spin.toFixed(0)} rad/s, slip=${r.slip}` : 'no contact (rim)'}`);
  }
  for (const q of [1, .8, .6, .4, .2, .1]) {
    const r = swing(n0, q);
    console.log(`quality ${q}: ${r.speed.toFixed(2)} m/s`);
  }
}

/* ---------------------------------------------------------------- 21 */
head(21, 'equipment on one incoming ball');
{
  const n = V3.norm(V3.new(), V3.new(0, -0.22, -1));
  const contact = (p) => { const v = V3.new(0, 0.55, 6.1), w = V3.new(-55, 25, 0); const i = impactRacket(v, w, n, V3.new(0, 2.4, -8.4), 0.95, p); return i ? `${V3.len(v).toFixed(2)} m/s, ${V3.len(w).toFixed(0)} rad/s` : 'none'; };
  for (const [id, blade, fh] of [['base', 'b_base', 'r_base'], ['fast', 'b_carb', 'r_fast'], ['spin', 'b_loop', 'r_tops']]) {
    const e = new Equipment(blade, fh, fh);
    console.log(`${id.padEnd(5)} FH ${contact(e.forSide(1))}`);
  }
  const mixed = new Equipment('b_base', 'r_fast', 'r_tops');
  console.log(`mixed FH ${contact(mixed.forSide(1))} | BH ${contact(mixed.forSide(-1))}`);
  console.log(`spin cap ${STROKE_CONFIG.spin.cap}`);
}

/* ---------------------------------------------------------------- 22/23 */
head(22, 'stroke type x incoming spin');
{
  const GEST = { DRIVE: [0.2, 0, 1.2], LOOP: [0.5, 0, 1.2], PUSH: [-0.6, 0, 1.2], SIDE: [0, 1, 1.4], CHOP: [-0.95, 0, 3.0] };
  const SPINS = { TOP: [-180, 0, 0], BACK: [260, 0, 0], SIDE: [0, 240, 0], MIXED: [-120, 140, 40] };
  const P = V3.new(0, TY + 0.35, 1.15), V = V3.new(0, 0.6, 6), eq = new Equipment();
  const m = (u, r, s) => ({ samples: 8, dist: .24, pathLen: .24, speed: s, releaseSpeed: s, peakSpeed: s * 1.02, right: r, up: u, curl: 0, smooth: 1, straightness: 1, x: .5, y: .5 });
  const one = (g, spin, assist = 0.85) => {
    const raw = deriveStroke(m(...g), { side: 1, grip: 'shakehand', hand: 'right', forehand: true, isServe: false,
      ball: { x: P.x, y: P.y, z: P.z }, ballSpin: V3.clone(spin), ballVelocity: V3.clone(V), ballSpeed: V3.len(V), powerScale: 1, equip: eq.forSide(1) });
    const sol = refineRacket(P, V3.clone(V), V3.clone(spin), raw, assist, 0.9);
    const v = V3.clone(V), w = V3.clone(spin);
    impactRacket(v, w, sol.normal, sol.vR, 0.9, sol.rubber);
    return `${raw.stroke.id}->${sol.stroke.id} w(${w.x.toFixed(0)},${w.y.toFixed(0)}) ${V3.len(v).toFixed(1)} m/s`;
  };
  for (const [id, g] of Object.entries(GEST)) {
    console.log(`${id.padEnd(5)} ${Object.entries(SPINS).map(([s, w]) => `${s}:${one(g, V3.new(...w))}`).join(' | ')}`);
  }
  console.log('assist 0 (raw contact model):');
  for (const [s, w] of Object.entries(SPINS)) console.log(`  LOOP/${s}: ${one(GEST.LOOP, V3.new(...w), 0)}`);
}

/* ---------------------------------------------------------------- 28/29 */
head(28, 'network mirror and de-duplication');
{
  const m = netMirrorState({ ball: { p: [0, 0.5, 0.8], v: [0.3, 0.5, -4], w: [100, 50, 20] }, lastHitBy: 1, score: [1, 0] });
  console.log(`mirror: p.z ${m.ball.p[2]}, v.z ${m.ball.v[2]}, w ${JSON.stringify(m.ball.w)}, lastHitBy ${m.lastHitBy}, score ${m.score}`);
  const game = { ball: { p: V3.new(0, 0.5, 1), v: V3.new(0, 0.5, 8), w: V3.new(), live: true, lastHitBy: -1 },
    score: [0, 0], server: 1, state: 'RALLY', rally: 3 };
  const host = new NetworkManager(game);
  host.isHost = true; host.state = 'IN_MATCH';
  host._handle({ type: 'guestHit', hitId: 1, v: [0, 0.5, 8], w: [0, 0, 0], rally: 4 });
  game.ball.lastHitBy = 1;
  host._handle({ type: 'guestHit', hitId: 1, v: [0, 9, 9], w: [0, 0, 0], rally: 4 });
  console.log(`duplicate guestHit: v.z ${game.ball.v.z} (first strike was mirrored to -8; a duplicate would rewrite it)`);
  console.log(`stale state rejected: ${new NetworkManager({ ball: { p: V3.new(), v: V3.new(), w: V3.new(), live: true } })._validState({ lastHitBy: 7 }) === false ? 'hostile lastHitBy' : 'accepted'} `);
}

/* ---------------------------------------------------------------- 30 */
head(30, 'bounded caches and long-run timing');
{
  const bins = new Set();
  for (let i = 0; i <= 1000; i++) bins.add(quantizeDepth(1.30 + i * 0.00105));
  console.log(`1000 depths over 1.05 m -> ${bins.size} cache bins`);
  const P = V3.new(0, TY + 0.35, 1.15), V = V3.new(0, 0.6, 6), eq = new Equipment();
  const solve = () => refineRacket(P, V3.clone(V), V3.new(-60, 20, 0), deriveStroke(
    { samples: 8, dist: .24, pathLen: .24, speed: 1.2, releaseSpeed: 1.2, peakSpeed: 1.22, right: 0, up: 0.5, curl: 0, smooth: 1, straightness: 1, x: .5, y: .5 },
    { side: 1, grip: 'shakehand', hand: 'right', forehand: true, isServe: false,
      ball: { x: P.x, y: P.y, z: P.z }, ballSpin: V3.new(-60, 20, 0), ballVelocity: V3.clone(V),
      ballSpeed: V3.len(V), powerScale: 1, equip: eq.forSide(1) }), 0.85, 0.9).valid;
  for (let i = 0; i < 200; i++) solve();
  const batch = () => { const t = process.hrtime.bigint(); for (let i = 0; i < 100; i++) solve(); return Number(process.hrtime.bigint() - t) / 1e6; };
  const first = batch();
  for (let i = 0; i < 800; i++) solve();
  const last = batch();
  console.log(`100 swings: first ${first.toFixed(1)} ms, after 1000 contacts ${last.toFixed(1)} ms`);
}
