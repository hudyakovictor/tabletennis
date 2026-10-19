'use strict';
/* Deterministic press-zone noise simulator.
 *
 *   node tt/tools/noise_zone_sim.cjs [--seed 20261019] [--out test-results]
 *
 * Uses the 144 scenarios of `npm run calibrate` (shotCalibrationCases).
 * Press-point noise: transverse -80..+80 px, timing -120..+120 ms;
 * input mouse/touch; FPS 30/60/120/144 quantises the effective press instant.
 *
 * Two label sets are reported for every attempt:
 *   lead (original, intentionally retained for comparison):
 *     good: |across| <= 24 px and effective lead 0.10..0.22 s
 *     bad:  |across| >= 64 px, or lead <= 0.02 s, or lead >= 0.30 s
 *   worldDistance (independent of ovalLeadSec):
 *     unproject the press ray onto the authored racket-home contact plane
 *     (z=1.78 m), advance the ball linearly to that plane, and measure the
 *     world XY distance from the press ray to the future contact point.
 *     good: <= MATCH_RULES.sweetRadius (0.15225 m)
 *     bad:  >= 0.35 m
 * Everything between is ambiguous and excluded from both rates.
 *
 * A separate velocity-stress sweep (incoming velocity x1/x2/x4/x8) is used
 * only to select ovalForwardMaxPx: among finite candidates that keep both
 * main datasets at >=95% per input, choose the largest whose stress-world
 * bad-rejection also stays >=95% per input. Fixed seed: two runs print
 * byte-identical JSON. */
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
const seed = Number(option('--seed', '20261019')) >>> 0;
const outDir = path.resolve(root, option('--out', 'test-results'));

const files = ['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js'];
const source = files.map(f => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
const api = vm.runInNewContext(source +
  '\n;({ MATCH_RULES, pressHitZone, pressHitZoneOval, shotCalibrationCases, PH })', { console });
const { MATCH_RULES, PH } = api;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* A fixed reference camera for the bench. The GAME uses its real view-proj
 * matrix through the same two-projection API; the bench only needs a stable,
 * perspective-correct screen velocity per scenario. */
const W = 1280, H = 760;
const CONTACT_PLANE_Z = 1.78; // authored paddle-home depth, metres
const WORLD_GOOD_MAX_M = MATCH_RULES.sweetRadius;
const WORLD_BAD_MIN_M = .35;
function project(p, out = {}) {
  const denom = 3.4 - p.z;
  if (!(denom > 0.2) || ![p.x, p.y, p.z].every(Number.isFinite)) { out.ok = false; return out; }
  out.x = 0.5 + 0.42 * p.x / denom;
  out.y = 0.60 - 0.38 * (p.y - PH.TABLE_Y) / denom;
  out.ok = true;
  return out;
}
function unprojectAtZ(pointer, z) {
  const denom = 3.4 - z;
  return { x: (pointer.x - .5) * denom / .42,
    y: PH.TABLE_Y + (.60 - pointer.y) * denom / .38, z };
}
function screenVelocity(ball) {
  const dt = MATCH_RULES.ovalSampleDtSec;
  const a = project(ball.p, {}), ax = a.x, ay = a.y;
  const b = project({ x: ball.p.x + ball.v.x * dt, y: ball.p.y + ball.v.y * dt, z: ball.p.z + ball.v.z * dt }, {});
  return { x: (b.x - ax) * W / dt, y: (b.y - ay) * H / dt, center: { x: ax * W, y: ay * H } };
}
function worldLabelFor(ball, pointer) {
  if (!(ball.v.z > 0)) return { label: 'ambiguous', distanceM: null };
  const tc = Math.max(0, (CONTACT_PLANE_Z - ball.p.z) / ball.v.z);
  const contact = { x: ball.p.x + ball.v.x * tc, y: ball.p.y + ball.v.y * tc, z: CONTACT_PLANE_Z };
  const q = unprojectAtZ(pointer, CONTACT_PLANE_Z);
  const distanceM = Math.hypot(q.x - contact.x, q.y - contact.y);
  return { label: distanceM <= WORLD_GOOD_MAX_M ? 'good' : distanceM >= WORLD_BAD_MIN_M ? 'bad' : 'ambiguous',
    distanceM };
}

const ovalWithCap = (capPx) => (ball, pointer, type, swipe) => api.pressHitZoneOval(ball, pointer, W, H,
  { project: (p, out) => project(p, out || {}), pointerType: type, swipe,
    referenceScreen: { x: .5, y: 1 }, forwardMaxPx: capPx });
const shapes = {
  'circle-48': (ball, pointer) => api.pressHitZone(project(ball.p, {}), pointer, W, H, 48),
  'circle-72': (ball, pointer) => api.pressHitZone(project(ball.p, {}), pointer, W, H, 72),
  'circle-96-current-legacy': (ball, pointer) => api.pressHitZone(project(ball.p, {}), pointer, W, H, MATCH_RULES.pressRadiusPx),
  oval: ovalWithCap(MATCH_RULES.ovalForwardMaxPx),
};
const CAP_CANDIDATES = [64, 80, 96, 120, 140, 160, 200, 240, 320, 480, 1000000];
const capLabel = (cap) => cap >= 1000000 ? 'uncapped' : `oval-cap-${cap}`;

const emptyBucket = () => ({ good: 0, goodAccepted: 0, bad: 0, badRejected: 0,
  ambiguous: 0, total: 0, byFps: {}, byInput: {} });
const emptyCounts = () => ({ good: 0, goodAccepted: 0, bad: 0, badRejected: 0 });
function addAttempt(bucket, label, accepted, fps, inputType) {
  bucket.total++;
  const fsBucket = bucket.byFps[fps] || (bucket.byFps[fps] = emptyCounts());
  const inBucket = bucket.byInput[inputType] || (bucket.byInput[inputType] = emptyCounts());
  if (label === 'good') for (const b of [bucket, fsBucket, inBucket]) { b.good++; if (accepted) b.goodAccepted++; }
  else if (label === 'bad') for (const b of [bucket, fsBucket, inBucket]) { b.bad++; if (!accepted) b.badRejected++; }
  else bucket.ambiguous++;
}
const rate4 = (n, d) => d ? +(n / d).toFixed(4) : null;
const serializeCounts = (b) => ({ good: b.good, goodAccepted: b.goodAccepted,
  goodAcceptRate: rate4(b.goodAccepted, b.good), bad: b.bad, badRejected: b.badRejected,
  badRejectRate: rate4(b.badRejected, b.bad) });
function serializeBucket(bucket) {
  return { total: bucket.total, ambiguous: bucket.ambiguous, ...serializeCounts(bucket),
    byFps: Object.fromEntries(Object.entries(bucket.byFps).map(([fps, b]) => [fps, serializeCounts(b)])),
    byInput: Object.fromEntries(Object.entries(bucket.byInput).map(([type, b]) => [type, serializeCounts(b)])) };
}
const percentile = (values, q) => {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return xs.length ? +xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(xs.length * q) - 1))].toFixed(2) : null;
};

const cases = api.shotCalibrationCases();
const attemptsPerCaseCell = 10;
const datasetResults = { lead: {}, worldDistance: {} };
for (const dataset of Object.keys(datasetResults))
  for (const name of Object.keys(shapes)) datasetResults[dataset][name] = emptyBucket();
const capResults = Object.fromEntries(CAP_CANDIDATES.map(cap => [capLabel(cap), {
  capPx: cap >= 1000000 ? null : cap, lead: emptyBucket(), worldDistance: emptyBucket(),
}]));
const heat = new Map(); // oval acceptance by along/across bin on the lead attempts
const mainSpeeds = [];

function generatedAttempt(c, ball, random, fps) {
  const { x: svx, y: svy, center } = screenVelocity(ball);
  const speed = Math.hypot(svx, svy);
  if (!(speed > 0)) return null;
  const ux = svx / speed, uy = svy / speed, px = -uy, py = ux;
  const acrossNoise = -80 + random() * 160;
  const timeNoiseMs = -120 + random() * 240;
  const effectiveTimeMs = Math.round(timeNoiseMs / (1000 / fps)) * (1000 / fps);
  const lead = MATCH_RULES.ovalLeadSec + effectiveTimeMs / 1000;
  const along = speed * lead;
  const pointer = { x: (center.x + ux * along + px * acrossNoise) / W,
    y: (center.y + uy * along + py * acrossNoise) / H };
  return { pointer, swipe: { x: -ux, y: -uy }, speed, along, acrossNoise,
    leadLabel: Math.abs(acrossNoise) <= 24 && lead >= .10 && lead <= .22 ? 'good'
      : Math.abs(acrossNoise) >= 64 || lead <= .02 || lead >= .30 ? 'bad' : 'ambiguous' };
}
const ballForCase = (c, velocityScale = 1) => {
  const h = c.hand === 'left' ? -1 : 1;
  return { p: { x: .15 * h * (c.forehand ? 1 : -1), y: c.y, z: c.z },
    v: { x: 0, y: -1 * velocityScale, z: 6 * velocityScale } };
};

for (const type of ['mouse', 'touch']) {
  for (const fps of [30, 60, 120, 144]) {
    const random = mulberry32(seed ^ (type === 'mouse' ? 0x1111 : 0x2222) ^ fps);
    for (const c of cases) {
      const ball = ballForCase(c);
      for (let k = 0; k < attemptsPerCaseCell; k++) {
        const attempt = generatedAttempt(c, ball, random, fps);
        if (!attempt) continue;
        mainSpeeds.push(attempt.speed);
        const world = worldLabelFor(ball, attempt.pointer);
        for (const [name, evaluate] of Object.entries(shapes)) {
          const zone = evaluate(ball, attempt.pointer, type, attempt.swipe);
          const accepted = !!(zone && zone.accepted);
          addAttempt(datasetResults.lead[name], attempt.leadLabel, accepted, fps, type);
          addAttempt(datasetResults.worldDistance[name], world.label, accepted, fps, type);
          if (name === 'oval') {
            const key = `${Math.floor(attempt.along / 10)},${Math.floor(attempt.acrossNoise / 10)}`;
            const bin = heat.get(key) || { n: 0, accepted: 0 };
            bin.n++; if (accepted) bin.accepted++;
            heat.set(key, bin);
          }
        }
        for (const cap of CAP_CANDIDATES) {
          const zone = ovalWithCap(cap)(ball, attempt.pointer, type, attempt.swipe);
          const accepted = !!(zone && zone.accepted), result = capResults[capLabel(cap)];
          addAttempt(result.lead, attempt.leadLabel, accepted, fps, type);
          addAttempt(result.worldDistance, world.label, accepted, fps, type);
        }
      }
    }
  }
}

// Velocity stress, used only for cap selection. Labels are the independent
// world-distance labels; lead labels are kept for transparency in JSON.
const stressAttemptsPerCaseCell = 3;
const stressSpeeds = [];
for (const result of Object.values(capResults)) result.stressWorldDistance = emptyBucket();
for (const velocityScale of [1, 2, 4, 8]) {
  for (const type of ['mouse', 'touch']) {
    for (const fps of [30, 60, 120, 144]) {
      const random = mulberry32(seed ^ (type === 'mouse' ? 0x1111 : 0x2222) ^ fps ^ (velocityScale * 7919));
      for (const c of cases) {
        const ball = ballForCase(c, velocityScale);
        for (let k = 0; k < stressAttemptsPerCaseCell; k++) {
          const attempt = generatedAttempt(c, ball, random, fps);
          if (!attempt) continue;
          stressSpeeds.push(attempt.speed);
          const world = worldLabelFor(ball, attempt.pointer);
          for (const cap of CAP_CANDIDATES) {
            const zone = ovalWithCap(cap)(ball, attempt.pointer, type, attempt.swipe);
            addAttempt(capResults[capLabel(cap)].stressWorldDistance, world.label,
              !!(zone && zone.accepted), fps, type);
          }
        }
      }
    }
  }
}

const serializedDatasets = Object.fromEntries(Object.entries(datasetResults).map(([dataset, byShape]) =>
  [dataset, Object.fromEntries(Object.entries(byShape).map(([name, bucket]) => [name, serializeBucket(bucket)]))]));
const serializedCaps = Object.fromEntries(Object.entries(capResults).map(([label, result]) => [label, {
  capPx: result.capPx, lead: serializeBucket(result.lead),
  worldDistance: serializeBucket(result.worldDistance),
  stressWorldDistance: serializeBucket(result.stressWorldDistance),
}]));

const perInputPass = (bucket) => ['mouse', 'touch'].every(type => {
  const b = bucket.byInput[type];
  return b && b.goodAcceptRate >= .95 && b.badRejectRate >= .95;
});
const perInputBadPass = (bucket) => ['mouse', 'touch'].every(type => {
  const b = bucket.byInput[type];
  return b && b.badRejectRate >= .95;
});
const eligibleCaps = Object.values(serializedCaps).filter(result => result.capPx !== null &&
  perInputPass(result.lead) && perInputPass(result.worldDistance) && perInputBadPass(result.stressWorldDistance));
const selectedCap = eligibleCaps.length ? Math.max(...eligibleCaps.map(r => r.capPx)) : null;

const rulesReport = { version: MATCH_RULES.version, zoneShape: MATCH_RULES.zoneShape,
  pressRadiusPx: MATCH_RULES.pressRadiusPx, ovalLeadSec: MATCH_RULES.ovalLeadSec,
  ovalForwardPx: MATCH_RULES.ovalForwardPx, ovalForwardMaxPx: MATCH_RULES.ovalForwardMaxPx,
  ovalBackPx: MATCH_RULES.ovalBackPx, ovalSideMousePx: MATCH_RULES.ovalSideMousePx,
  ovalSideTouchPx: MATCH_RULES.ovalSideTouchPx, ovalMinSpeedPx: MATCH_RULES.ovalMinSpeedPx,
  ovalFullSpeedPx: MATCH_RULES.ovalFullSpeedPx };
const report = { seed, scenarios: cases.length, viewport: [W, H],
  command: `node tt/tools/noise_zone_sim.cjs --seed ${seed} --out test-results`,
  labels: {
    lead: { good: '|across|<=24px and lead 0.10..0.22s',
      bad: '|across|>=64px or lead<=0.02s or lead>=0.30s' },
    worldDistance: { contactPlaneZ: CONTACT_PLANE_Z,
      good: `world distance <= ${WORLD_GOOD_MAX_M} m (MATCH_RULES.sweetRadius)`,
      bad: `world distance >= ${WORLD_BAD_MIN_M} m`,
      note: 'Press ray is unprojected at the contact plane; the ball is advanced linearly to that plane. Independent of ovalLeadSec.' },
  },
  targets: { goodAcceptRate: .95, badRejectRate: .95 },
  screenSpeedPx: {
    main: { min: percentile(mainSpeeds, 0), p50: percentile(mainSpeeds, .5),
      p90: percentile(mainSpeeds, .9), max: percentile(mainSpeeds, 1) },
    stress: { min: percentile(stressSpeeds, 0), p50: percentile(stressSpeeds, .5),
      p90: percentile(stressSpeeds, .9), max: percentile(stressSpeeds, 1) },
  },
  rules: rulesReport,
  datasets: serializedDatasets,
  // Backward-compatible alias: previous consumers read the lead dataset here.
  shapes: serializedDatasets.lead,
  capSweep: serializedCaps,
  capSelection: {
    criterion: 'Largest finite candidate with per-input good/bad >= .95 on both main datasets and per-input stress-world badRejectRate >= .95.',
    selectedPx: selectedCap, currentRulesPx: MATCH_RULES.ovalForwardMaxPx,
    matchesRules: selectedCap === MATCH_RULES.ovalForwardMaxPx,
    stressVelocityScales: [1, 2, 4, 8],
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'noise-zone.json'), JSON.stringify(report, null, 2) + '\n');
const csvRows = ['dataset,shape,breakdown,value,total,ambiguous,good,goodAccepted,goodAcceptRate,bad,badRejected,badRejectRate'];
for (const [dataset, byShape] of Object.entries(serializedDatasets)) {
  for (const [shape, result] of Object.entries(byShape)) {
    const push = (breakdown, value, b, total = '', ambiguous = '') => csvRows.push([
      dataset, shape, breakdown, value, total, ambiguous,
      b.good, b.goodAccepted, b.goodAcceptRate, b.bad, b.badRejected, b.badRejectRate,
    ].join(','));
    push('overall', 'all', result, result.total, result.ambiguous);
    for (const [fps, b] of Object.entries(result.byFps)) push('fps', fps, b);
    for (const [type, b] of Object.entries(result.byInput)) push('input', type, b);
  }
}
fs.writeFileSync(path.join(outDir, 'noise-zone.csv'), csvRows.join('\n') + '\n');

// Oval acceptance heatmap on lead attempts: x along -40..200 px, y across -100..100 px.
const X0 = -40, X1 = 200, Y0 = -100, Y1 = 100, CELL = 10, SCALE = 4;
const cols = (X1 - X0) / CELL, rowsN = (Y1 - Y0) / CELL;
const pixels = new Uint8Array(cols * SCALE * rowsN * SCALE * 3);
for (let y = 0; y < rowsN * SCALE; y++) for (let x = 0; x < cols * SCALE; x++) {
  const bx = Math.floor(x / SCALE), by = rowsN - 1 - Math.floor(y / SCALE);
  const bin = heat.get(`${(X0 + bx * CELL) / CELL},${(Y0 + by * CELL) / CELL}`) ||
    heat.get(`${Math.floor((X0 + bx * CELL) / CELL)},${Math.floor((Y0 + by * CELL) / CELL)}`);
  const color = bin && bin.n ? heatColor(bin.accepted / bin.n) : [24, 24, 28];
  pixels.set(color, (y * cols * SCALE + x) * 3);
}
writePng(path.join(outDir, 'noise-zone-oval-heatmap.png'), cols * SCALE, rowsN * SCALE, pixels);

console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${path.join(outDir, 'noise-zone.csv')} and ${path.join(outDir, 'noise-zone-oval-heatmap.png')}`);
