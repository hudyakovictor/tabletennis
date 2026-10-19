'use strict';
/* Stroke-assist audit: how far does refineRacket move the player's swing, and
 * does the ball it certifies obey the human speed band?  Node-only. */
const { load } = require('../../tests/helpers.cjs');
const L = load(['10_math.js', '30_physics.js', '40_swipe.js', '12_match_rules.js', '38_paddle_motion.js'],
  ['V3', 'PH', 'deriveStroke', 'refineRacket', 'strokeFrame', 'impactRacket', 'predict', 'SwipeTracker', 'MATCH_RULES', 'ARCH', 'STROKES']);
const { V3, PH } = L;
let seed = 20261019;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const res = [];
const N = 240;
for (let i = 0; i < N; i++) {
  const y = PH.TABLE_Y + 0.08 + rnd() * 0.62;
  const z = 1.02 + rnd() * 0.62;
  const x = (rnd() - 0.5) * 1.3;
  const incoming = V3.new((rnd() - 0.5) * 3.0, -0.4 - rnd() * 2.6, 2.0 + rnd() * 11.0);
  const w = V3.new((rnd() - 0.5) * 520, (rnd() - 0.5) * 260, (rnd() - 0.5) * 520);
  const u = -0.72 + rnd() * 1.44;          // screen-up component of the gesture
  const r = (rnd() - 0.5) * 1.2;
  const dist = 0.05 + rnd() * 0.30;
  const v = 0.12 + rnd() * 3.4;             // swipe speed (normalised units / s)
  const m = { sx: 0.5, sy: 0.6, x: 0.5 + r * dist, y: 0.6 - u * dist, dx: r * dist, dy: -u * dist,
    dist, dur: dist / v, samples: 4, pathLen: dist * 1.02, straightness: 0.98, curl: (rnd() - 0.5) * 0.5,
    jerk: rnd() * 4, speed: v, releaseSpeed: v, peakSpeed: v * 1.1, accel: 0,
    angle: Math.atan2(u, r), angleDeg: Math.atan2(u, r) / (Math.PI / 180), right: r / Math.hypot(r, u || 1e-9),
    up: u / Math.hypot(r, u || 1e-9), smooth: 0.6 + rnd() * 0.4 };
  const ctx = { side: 1, grip: rnd() < 0.5 ? 'shakehand' : 'penhold', forehand: rnd() < 0.5,
    isServe: false, ball: { y, z }, ballSpin: w, ballSpeed: V3.len(incoming),
    powerScale: 1, moveYaw: 0, movePitch: -0.1, spinBias: 'norm' };
  const racket = L.deriveStroke(m, ctx);
  const rawBall = V3.clone(incoming), rawW = V3.clone(w);
  const rawV = V3.new(), rawN = V3.new();
  L.strokeFrame(racket, 0, 0, 1, rawV, rawN);
  L.impactRacket(rawBall, rawW, rawN, rawV, racket.quality, racket.rubber || {});
  const contact = V3.new(x, y, z);
  const q = 0.85;
  const out = L.refineRacket(contact, incoming, w, racket, L.MATCH_RULES.trajectoryAssist, q);
  const bb = V3.clone(incoming), bw = V3.clone(w);
  const info = L.impactRacket(bb, bw, out.normal, out.vR, q, out.rubber || {});
  const rep = {};
  const lp = V3.new(contact.x + out.normal.x * PH.R * 1.05, contact.y + out.normal.y * PH.R * 1.05, contact.z + out.normal.z * PH.R * 1.05);
  L.predict(lp, V3.clone(bb), V3.clone(bw), { dt: 1 / 280, maxT: 2.6, stopOnFirstBounce: true, out: rep });
  const legal = !rep.hitNet && rep.landed && rep.landed.z < 0 && Math.abs(rep.landed.x) <= PH.T_HALF_WID + PH.R;
  res.push({ rawBallSpeed: V3.len(rawBall), ballSpeed: info ? V3.len(bb) : 0, vR: V3.len(out.vR),
    vmag0: racket === out ? null : undefined, scale: out.scale === undefined ? 1 : out.scale,
    dE: out.dElev || 0, dA: out.dAz || 0, damp: out.damp === undefined ? 1 : out.damp,
    valid: out.valid, solved: !!out.solved, stroke: out.stroke && out.stroke.id, legal,
    net: !!rep.hitNet, land: rep.landed || null, inSpeed: V3.len(incoming), q });
}
const by = {};
for (const r of res) { const k = r.stroke; (by[k] = by[k] || []).push(r); }
const f = (n, d = 2) => Number(n).toFixed(d);
console.log('rows', res.length, 'legal', res.filter(r => r.legal).length);
const over = res.filter(r => r.vR > 19.6);
console.log('racket speed > 19.5:', over.length, 'max', f(Math.max(...res.map(r => r.vR))));
const overBall = res.filter(r => r.ballSpeed > 1.92 * r.vR + r.inSpeed + 0.05);
console.log('ball faster than 1.92*vR+vin:', overBall.length);
console.log('scale distribution:', [0, .5, 1, 1.5, 2, 2.2, 3, 99].map((t, i, a) =>
  `${t}+:${res.filter(r => r.scale >= t).length}`).join(' '));
for (const [k, rows] of Object.entries(by)) {
  console.log(k.padEnd(12), 'n', String(rows.length).padStart(3),
    'legal', String(rows.filter(r => r.legal).length).padStart(3),
    'scale med/max', f(rows.map(r => r.scale).sort((a, b) => a - b)[rows.length >> 1] || 0), f(Math.max(...rows.map(r => r.scale))),
    'vR med/max', f(rows.map(r => r.vR).sort((a, b) => a - b)[rows.length >> 1] || 0), f(Math.max(...rows.map(r => r.vR))));
}
const worst = res.slice().sort((a, b) => b.ballSpeed - a.ballSpeed).slice(0, 10);
for (const r of worst) console.log('worst', r.stroke, 'in', f(r.inSpeed), 'rawBall', f(r.rawBallSpeed), 'vR', f(r.vR), 'scale', f(r.scale), 'ball', f(r.ballSpeed), 'legal', r.legal, 'net', r.net);
