'use strict';
/* Seeded map of AI serve second-bounce landings.
 *
 *   node tt/tools/ai_serve_map.cjs [--count 1000] [--seed 20261019] [--out test-results] [--level 2]
 *
 * Runs the real OpponentAI.serve -> impactRacket -> predict pipeline at the
 * authored AI toss contact height. Fails (exit 1) when the landing width
 * collapses: p90-p10 of |x| spread below threshold or legal rate too low. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { writePng, heatColor } = require('./png.cjs');

const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const count = Math.max(1, Math.floor(Number(option('--count', '1000')) || 1000));
const seed = Number(option('--seed', '20261019')) >>> 0;
const level = Math.max(0, Math.min(4, Math.floor(Number(option('--level', '2')) || 0)));
const outDir = path.resolve(root, option('--out', 'test-results'));

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);
const seededMath = Object.create(Math);
seededMath.random = random;

const files = ['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '55_ai.js'];
const source = files.map(f => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
const api = vm.runInNewContext(source +
  '\n;({ OpponentAI, V3, PH, impactRacket, predict, MATCH_RULES })', { console, Math: seededMath });
const { OpponentAI, V3, PH, impactRacket, predict } = api;

const ai = new OpponentAI(level);
const AI_SERVE_CONTACT_Y = 0.36; // 70_game.js contacts the AI toss here
const rows = [];
for (let i = 0; i < count; i++) {
  const ball = {
    p: V3.new((random() * 2 - 1) * 0.26, PH.TABLE_Y + AI_SERVE_CONTACT_Y, -(PH.T_HALF_LEN + 0.20)),
    v: V3.new((random() * 2 - 1) * 0.05, -2.43, (random() * 2 - 1) * 0.05),
    w: V3.new(), live: true, lastHitBy: 0,
  };
  const game = { ball, time: i, equip: { forSide: () => ({ e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1 }) } };
  const racket = ai.serve(game);
  const v = V3.clone(ball.v), w = V3.clone(ball.w);
  const info = impactRacket(v, w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
  const start = { x: ball.p.x + racket.normal.x * PH.R * 1.05,
    y: ball.p.y + racket.normal.y * PH.R * 1.05, z: ball.p.z + racket.normal.z * PH.R * 1.05 };
  const report = {};
  if (info) predict(start, v, w, { dt: PH.SIM_DT, maxT: 2.4, stopAfterBounces: 2, out: report });
  const b2 = report.b2 || null;
  const legal = !!(info && b2 && b2.z > 0 && Math.abs(b2.x) <= PH.T_HALF_WID + PH.R * .5 &&
    Math.abs(b2.z) <= PH.T_HALF_LEN + PH.R * .5 && report.landed && report.landed.z < 0 && !report.hitNet);
  rows.push({ i, type: racket.stroke ? racket.stroke.id : null, legal, valid: racket.valid !== false,
    aimX: racket.target ? racket.target.x : racket.aim ? racket.aim.x : null,
    aimZ: racket.target ? racket.target.z : racket.aim ? racket.aim.z : null,
    x: b2 ? b2.x : null, z: b2 ? b2.z : null, bounces: report.bounces || 0, hitNet: !!report.hitNet });
}

const legalRows = rows.filter(r => r.legal && Number.isFinite(r.x));
const pct = (values, q) => {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return xs.length ? xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(xs.length * q) - 1))] : null;
};
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const xs = legalRows.map(r => r.x), zs = legalRows.map(r => r.z);
const mx = mean(xs);
const summary = {
  seed, level, count, legal: legalRows.length, legalRate: +(legalRows.length / count).toFixed(4),
  x: { mean: mx, stdev: xs.length ? Math.sqrt(mean(xs.map(x => (x - mx) ** 2))) : null,
    p10: pct(xs, .1), p50: pct(xs, .5), p90: pct(xs, .9), widthP90P10: pct(xs, .9) - pct(xs, .1) },
  z: { p10: pct(zs, .1), p50: pct(zs, .5), p90: pct(zs, .9) },
  byType: Object.fromEntries([...new Set(rows.map(r => r.type))].map(type => {
    const subset = legalRows.filter(r => r.type === type).map(r => r.x);
    return [type, { legal: subset.length, widthP90P10: subset.length > 4 ? pct(subset, .9) - pct(subset, .1) : null }];
  })),
  thresholds: { minLegalRate: .95, minWidthP90P10: .55 },
};
summary.pass = summary.legalRate >= summary.thresholds.minLegalRate &&
  summary.x.widthP90P10 >= summary.thresholds.minWidthP90P10;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'ai-serve-map.json'), JSON.stringify({ summary, rows }, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'ai-serve-map.csv'),
  ['i,type,legal,valid,aimX,aimZ,x,z,bounces,hitNet',
    ...rows.map(r => [r.i, r.type, r.legal, r.valid, r.aimX, r.aimZ, r.x, r.z, r.bounces, r.hitNet].join(','))].join('\n') + '\n');

// Landing heatmap over the receiver's half: x sideways, z depth from net.
const COLS = 30, ROWS = 28, SCALE = 10, bins = new Float64Array(COLS * ROWS);
for (const r of legalRows) {
  const cx = Math.floor((r.x + PH.T_HALF_WID) / (2 * PH.T_HALF_WID) * COLS);
  const cy = Math.floor(r.z / PH.T_HALF_LEN * ROWS);
  if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) bins[cy * COLS + cx]++;
}
const maxBin = Math.max(1, ...bins), pixels = new Uint8Array(COLS * SCALE * ROWS * SCALE * 3);
for (let y = 0; y < ROWS * SCALE; y++) for (let x = 0; x < COLS * SCALE; x++) {
  const bin = bins[Math.floor(y / SCALE) * COLS + Math.floor(x / SCALE)];
  pixels.set(bin ? heatColor(Math.log1p(bin) / Math.log1p(maxBin)) : [24, 24, 28], (y * COLS * SCALE + x) * 3);
}
writePng(path.join(outDir, 'ai-serve-map.png'), COLS * SCALE, ROWS * SCALE, pixels);

console.log(JSON.stringify(summary, null, 2));
if (!summary.pass) process.exitCode = 1;
