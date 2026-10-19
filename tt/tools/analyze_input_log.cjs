'use strict';
/* Analyse topspin-input-log.jsonl from the pause button.
 *
 *   node tt/tools/analyze_input_log.cjs LOG.jsonl [--csv out.csv] [--png out.png]
 *
 * Counts rejection reasons, the along/across distribution of rejected
 * presses, and a 90th-percentile oval-size recommendation. Outputs CSV plus
 * a rejected-press heatmap PNG (x = along px, y = across px). */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { writePng, heatColor } = require('./png.cjs');

const root = path.resolve(__dirname, '../..');
const rulesSource = fs.readFileSync(path.join(root, 'tt/src/12_match_rules.js'), 'utf8');
const { MATCH_RULES, PRESS_REJECTION_REASONS } = vm.runInNewContext(
  rulesSource + '\n;({ MATCH_RULES, PRESS_REJECTION_REASONS })', { console });

const args = process.argv.slice(2);
const input = args.find(a => !a.startsWith('--'));
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
if (!input) {
  console.error('usage: node tt/tools/analyze_input_log.cjs LOG.jsonl [--csv out.csv] [--png out.png]');
  process.exit(2);
}

const events = [];
let malformed = 0;
for (const line of fs.readFileSync(input, 'utf8').split(/\r?\n/)) {
  if (!line.trim()) continue;
  try { events.push(JSON.parse(line)); } catch { malformed++; }
}

const percentile = (values, q) => {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return xs.length ? xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(xs.length * q) - 1))] : null;
};
const stats = (values) => ({
  count: values.filter(Number.isFinite).length,
  p50: percentile(values, .5), p90: percentile(values, .9), p95: percentile(values, .95),
  max: values.filter(Number.isFinite).length ? Math.max(...values.filter(Number.isFinite)) : null,
});
const speedPx = (e) => e.ball && Array.isArray(e.ball.screenV)
  ? Math.hypot(e.ball.screenV[0] || 0, e.ball.screenV[1] || 0) : 0;

const attempts = events.filter(e => e.type === 'pointerdown' && e.decision);
const rejected = attempts.filter(e => !e.decision.accepted);
const contacts = events.filter(e => e.type === 'contact' && e.decision);
const reasonCounts = {};
for (const reason of PRESS_REJECTION_REASONS) reasonCounts[reason] = 0;
for (const e of rejected) {
  const reason = e.decision.reason || 'OUTSIDE_ZONE';
  reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
}
for (const e of events) {
  if (e.type === 'pointerup' && e.outcome && e.outcome.reason === 'STATIC_CLICK') reasonCounts.STATIC_CLICK++;
  if (e.type === 'decision' && e.outcome && e.outcome.reason) reasonCounts[e.outcome.reason] =
    (reasonCounts[e.outcome.reason] || 0) + 1;
}

const need = (rows, pick) => stats(rows.map(pick).filter(v => v !== null && v !== undefined));
const neededForward = (e) => e.decision.along > 0 ? e.decision.along - speedPx(e) * MATCH_RULES.ovalLeadSec : null;
const neededBack = (e) => e.decision.along < 0 ? -e.decision.along : null;
const recommendation = {
  basis: 'p90 of presses that actually contacted; rejected p90 shown for the misses',
  contacted: {
    forwardFixedPx: need(contacts, neededForward), backPx: need(contacts, neededBack),
    sidePx: need(contacts, e => Math.abs(e.decision.across)),
  },
  rejected: {
    forwardFixedPx: need(rejected, neededForward), backPx: need(rejected, neededBack),
    sidePx: need(rejected, e => Math.abs(e.decision.across)),
  },
  suggested: {
    ovalForwardPx: Math.ceil(need(contacts, neededForward).p90 || MATCH_RULES.ovalForwardPx),
    ovalBackPx: Math.ceil(need(contacts, neededBack).p90 || MATCH_RULES.ovalBackPx),
    ovalSidePx: Math.ceil(need(contacts, e => Math.abs(e.decision.across)).p90 || MATCH_RULES.ovalSideTouchPx),
  },
};

const summary = {
  file: input, events: events.length, malformed,
  rulesVersions: [...new Set(events.map(e => e.rulesVersion))],
  attempts: attempts.length, rejected: rejected.length, contacts: contacts.length,
  byInputType: Object.fromEntries(['mouse', 'touch', 'pen'].map(t => [t,
    attempts.filter(e => e.inputType === t).length])),
  reasons: reasonCounts,
  rejectedDistribution: {
    along: stats(rejected.map(e => e.decision.along)),
    acrossAbs: stats(rejected.map(e => Math.abs(e.decision.across))),
    score: stats(rejected.map(e => e.decision.score)),
    timingErrorMs: stats(rejected.map(e => e.decision.timingErrorMs)),
  },
  acceptedDistribution: {
    along: stats(contacts.map(e => e.decision.along)),
    acrossAbs: stats(contacts.map(e => Math.abs(e.decision.across))),
  },
  recommendation,
};

// ---- CSV: one tidy table ---------------------------------------------
const rows = [['kind', 'key', 'count', 'p50', 'p90', 'p95', 'max'].join(',')];
const fmt = (v) => v === null || v === undefined ? '' : Number(v).toFixed(2);
for (const [reason, count] of Object.entries(reasonCounts))
  rows.push(['reason', reason, count, '', '', '', ''].join(','));
const addStats = (kind, key, s) => rows.push([kind, key, s.count, fmt(s.p50), fmt(s.p90), fmt(s.p95), fmt(s.max)].join(','));
addStats('rejected', 'alongPx', summary.rejectedDistribution.along);
addStats('rejected', 'acrossAbsPx', summary.rejectedDistribution.acrossAbs);
addStats('rejected', 'score', summary.rejectedDistribution.score);
addStats('rejected', 'timingErrorMs', summary.rejectedDistribution.timingErrorMs);
addStats('contacted', 'alongPx', summary.acceptedDistribution.along);
addStats('contacted', 'acrossAbsPx', summary.acceptedDistribution.acrossAbs);
addStats('needed-contacted', 'forwardFixedPx', recommendation.contacted.forwardFixedPx);
addStats('needed-contacted', 'backPx', recommendation.contacted.backPx);
addStats('needed-contacted', 'sidePx', recommendation.contacted.sidePx);
rows.push(['suggested', 'ovalForwardPx', '', '', recommendation.suggested.ovalForwardPx, '', ''].join(','));
rows.push(['suggested', 'ovalBackPx', '', '', recommendation.suggested.ovalBackPx, '', ''].join(','));
rows.push(['suggested', 'ovalSidePx', '', '', recommendation.suggested.ovalSidePx, '', ''].join(','));

const csvPath = option('--csv', 'test-results/input-log-analysis.csv');
fs.mkdirSync(path.dirname(path.resolve(root, csvPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, csvPath), rows.join('\n') + '\n');

// ---- PNG heatmap of rejected presses ----------------------------------
const X0 = -120, X1 = 360, Y0 = -160, Y1 = 160, CELL = 8, SCALE = 3;
const cols = Math.ceil((X1 - X0) / CELL), gridRows = Math.ceil((Y1 - Y0) / CELL);
const bins = new Float64Array(cols * gridRows);
for (const e of rejected) {
  const cx = Math.floor((e.decision.along - X0) / CELL);
  const cy = Math.floor((e.decision.across - Y0) / CELL);
  if (cx >= 0 && cx < cols && cy >= 0 && cy < gridRows) bins[cy * cols + cx]++;
}
const maxBin = Math.max(1, ...bins);
const W = cols * SCALE, H = gridRows * SCALE, pixels = new Uint8Array(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const bx = Math.floor(x / SCALE), by = gridRows - 1 - Math.floor(y / SCALE);
  const v = bins[by * cols + bx];
  let color = v > 0 ? heatColor(Math.log1p(v) / Math.log1p(maxBin)) : [24, 24, 28];
  const along = X0 + bx * CELL, across = Y0 + by * CELL;
  if (Math.abs(along) < CELL || Math.abs(across) < CELL) color = [110, 110, 110]; // axes through the ball
  pixels.set(color, (y * W + x) * 3);
}
const pngPath = option('--png', 'test-results/input-log-rejected-heatmap.png');
fs.mkdirSync(path.dirname(path.resolve(root, pngPath)), { recursive: true });
writePng(path.resolve(root, pngPath), W, H, pixels);

console.log(JSON.stringify({ ...summary, csv: csvPath, png: pngPath,
  heatmap: { x: `along ${X0}..${X1} px`, y: `across ${Y0}..${Y1} px`, cellPx: CELL } }, null, 2));
