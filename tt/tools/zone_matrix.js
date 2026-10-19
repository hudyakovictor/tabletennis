'use strict';
/* 15x15 zone matrix for the opponent's half.
 *
 * Every other harness asks "does the ball do something wrong?". This one asks
 * the coach's question: with each stroke, at each power, can the player PUT
 * the ball in each of the 15x15 cells of the opponent's court — and can the
 * serve land in each cell legally?
 *
 * The measurement goes through the shipping code, not a model of it:
 *   deriveStroke -> refineRacket (the same aim assist the game runs)
 *   -> impactRacket -> predict at the production step.
 * Difficulty is the same for every cell, so a hole in the map is either a
 * physical limit or a bug — never a fixture artefact.
 *
 * Output: one JSON object on stdout (maps are 15 lines of 15 characters:
 *   # landed in the requested cell, + landed on the opponent's half but in
 *   another cell, n net, s own half, o past the end line, . no contact).
 *
 * Usage: node tt/tools/zone_matrix.js [--quick]
 */
const { load } = require('../../tests/helpers.cjs');
const L = load(['10_math.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '56_rig.js'],
  ['V3', 'PH', 'DEG', 'deriveStroke', 'refineRacket', 'impactRacket', 'predict']);
const { V3, PH } = L;

const N = 15;
const X0 = -PH.T_HALF_WID, X1 = PH.T_HALF_WID;
const Z0 = -PH.T_HALF_LEN, Z1 = 0;
const DX = (X1 - X0) / N, DZ = (Z1 - Z0) / N;
const QUICK = process.argv.includes('--quick');

const cellCenter = (ix, iz) => ({ x: X0 + (ix + .5) * DX, z: Z0 + (iz + .5) * DZ });
/* "On the table" is the same contract tableContact() uses: the ball CENTRE
 * may be up to one radius outside the painted edge and still be an edge ball.
 * Testing the centre against the painted rectangle classified every hairline
 * edge ball as "out" — the 15-23 % of serves that looked illegal were mostly
 * 1-8 mm edge contacts. */
const RX = X1 + PH.R, RZ = PH.T_HALF_LEN + PH.R;
const cellOf = (p) => {
  if (!p || Math.abs(p.x) > RX || p.z < -RZ || p.z > PH.R) return null;
  return { ix: Math.min(N - 1, Math.max(0, Math.floor((p.x - X0) / DX))),
    iz: Math.min(N - 1, Math.max(0, Math.floor((p.z - Z0) / DZ))) };
};
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1] || 'both';

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

/* One natural scenario per stroke: the ball a coach would feed for it. The
 * contact point is part of the stroke's technique, and the incoming ball is
 * what makes that stroke the right answer. */
const RETURN_SCENARIOS = [
  { id: 'DRIVE', power: [.65, 1, 1.35], contact: { x: 0, y: 1.08, z: 1.30 },
    gesture: { up: .18, dist: .16, releaseSpeed: 1.7, peakSpeed: 1.8 },
    incoming: { v: [0, -1.0, 8.5], w: [140, 0, 0] } },
  { id: 'LOOP', power: [.65, 1, 1.35], contact: { x: 0, y: 1.02, z: 1.30 },
    gesture: { up: .62, dist: .26, releaseSpeed: 2.4, peakSpeed: 2.7 },
    incoming: { v: [0, -1.2, 6.5], w: [120, 0, 0] } },
  { id: 'COUNTER', power: [.65, 1, 1.35], contact: { x: 0, y: 1.10, z: 1.30 },
    gesture: { up: .80, dist: .24, releaseSpeed: 3.2, peakSpeed: 3.6 },
    incoming: { v: [0, -1.0, 9.5], w: [240, 0, 0] } },
  { id: 'SMASH', power: [.65, 1, 1.35], contact: { x: 0, y: 1.24, z: 1.30 },
    gesture: { up: .15, dist: .24, releaseSpeed: 3.6, peakSpeed: 4.0 },
    incoming: { v: [0, -1.4, 8.0], w: [160, 0, 0] } },
  { id: 'CHOP', power: [.65, 1, 1.35], contact: { x: 0, y: 1.10, z: 1.30 },
    gesture: { up: -.62, dist: .26, releaseSpeed: 2.6, peakSpeed: 3.0 },
    incoming: { v: [0, -.8, 7.5], w: [180, 0, 0] } },
  { id: 'PUSH', power: [.65, 1, 1.35], contact: { x: 0, y: .95, z: 1.30 },
    gesture: { up: -.45, dist: .18, releaseSpeed: 1.2, peakSpeed: 1.4 },
    incoming: { v: [0, -.6, 4.5], w: [-150, 0, 0] } },
  { id: 'DROP', power: [.65, 1, 1.35], contact: { x: 0, y: .98, z: 1.30 },
    gesture: { up: -.40, dist: .10, releaseSpeed: .5, peakSpeed: .6 },
    incoming: { v: [0, -.5, 4.0], w: [-140, 0, 0] } },
  { id: 'FLICK', power: [.65, 1, 1.35], contact: { x: 0, y: 1.00, z: 1.20 },
    gesture: { up: .80, dist: .10, releaseSpeed: 1.6, peakSpeed: 1.8 },
    incoming: { v: [0, -.5, 4.5], w: [-120, 0, 0] } },
  { id: 'BLOCK', power: [.65, 1, 1.35], contact: { x: 0, y: 1.05, z: 1.30 },
    gesture: { up: .15, dist: .04, releaseSpeed: .9, peakSpeed: 1.0 },
    incoming: { v: [0, -1.2, 12.0], w: [220, 0, 0] } },
  { id: 'LOB', power: [.65, 1, 1.35], contact: { x: 0, y: .95, z: 1.35 },
    gesture: { up: .80, dist: .24, releaseSpeed: .8, peakSpeed: .9 },
    incoming: { v: [0, -.5, 4.0], w: [-120, 0, 0] } },
];

const SERVE_SCENARIOS = [
  { id: 'SERVE_TOP', power: [.7, 1.15], gesture: { up: .35, dist: .20, releaseSpeed: 1.8, peakSpeed: 2.0 } },
  { id: 'SERVE_BACK', power: [.7, 1.15], gesture: { up: -.45, dist: .20, releaseSpeed: 1.5, peakSpeed: 1.7 } },
  { id: 'SERVE_SIDE', power: [.7, 1.15], gesture: { right: .8, up: .05, dist: .20, releaseSpeed: 1.8, peakSpeed: 2.0, curl: .6 } },
  { id: 'SERVE_FAST', power: [.7, 1.15], gesture: { up: .05, dist: .22, releaseSpeed: 3.6, peakSpeed: 4.0 } },
];

function launchFrom(contact, normal) {
  return V3.new(contact.x + normal.x * PH.R * 1.05,
    contact.y + normal.y * PH.R * 1.05,
    contact.z + normal.z * PH.R * 1.05);
}

function emptyMap() {
  return Array.from({ length: N }, () => Array(N).fill('.'));
}
function mapToText(m) { return m.map((r) => r.join('')); }

function tally(rows) {
  const acc = { requested: rows.length, inCell: 0, otherCell: 0, net: 0, own: 0, out: 0, none: 0, invalid: 0 };
  let se = 0, sdx = 0, sdz = 0, sv = 0, n = 0, opp = 0;
  for (const r of rows) {
    if (r.invalid) acc.invalid++;
    acc[r.kind] = (acc[r.kind] || 0) + 1;
    if (r.target && r.landed) {
      const dx = r.landed.x - r.target.x, dz = r.landed.z - r.target.z;
      se += Math.hypot(dx, dz); sdx += dx; sdz += dz; n++;
    }
    if (r.landed && r.landed.z < 0) opp++;
    if (Number.isFinite(r.vmag)) sv += r.vmag;
  }
  acc.meanErr = n ? +(se / n).toFixed(3) : null;
  acc.meanDx = n ? +(sdx / n).toFixed(3) : null;
  acc.meanDz = n ? +(sdz / n).toFixed(3) : null;
  acc.oppHalf = opp;
  acc.meanVmag = rows.length ? +(sv / rows.length).toFixed(2) : null;
  return acc;
}

/* ---------------- returns ---------------- */
const returnOut = [];
const zprog = (s) => process.stderr.write(s);
for (const sc of (ONLY === 'serves' ? [] : RETURN_SCENARIOS)) {
  const ctx = ctxFor(sc.contact, V3.new(...sc.incoming.w), Math.hypot(...sc.incoming.v));
  const vIn = V3.new(...sc.incoming.v);
  const wIn = V3.new(...sc.incoming.w);
  const base = L.deriveStroke(metrics(sc.gesture), ctx);
  const classified = base.stroke && base.stroke.id;
  for (const power of (QUICK ? [1] : sc.power)) {
    const rows = [];
    const map = emptyMap();
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const c = cellCenter(ix, iz);
      const raw = L.deriveStroke(metrics(sc.gesture), ctx);
      raw.vmag = Math.min(19.5, raw.vmag * power);
      raw.aim = { x: c.x, z: c.z };
      const r = L.refineRacket(V3.new(sc.contact.x, sc.contact.y, sc.contact.z),
        V3.clone(vIn), V3.clone(wIn), raw, 1.0, .9);
      const bv = V3.clone(vIn), bw = V3.clone(wIn);
      const info = L.impactRacket(bv, bw, r.normal, r.vR, .9, r.rubber || {});
      let kind = 'none', landed = null;
      if (info) {
        const out = {};
        L.predict(launchFrom(sc.contact, r.normal), bv, bw,
          { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out });
        if (out.hitNet) kind = 'net';
        else if (out.landed) {
          landed = out.landed;
          const cell = cellOf(out.landed);
          if (out.landed.z > 0) kind = 'own';
          else if (!cell) kind = 'out';
          else kind = (cell.ix === ix && cell.iz === iz) ? 'inCell' : 'otherCell';
          if (kind === 'out' && Math.abs(out.landed.z) <= PH.T_HALF_LEN + PH.R &&
            Math.abs(out.landed.x) <= PH.T_HALF_WID + PH.R) kind = 'otherCell';
        } else kind = 'out';
      }
      rows.push({ ix, iz, kind, invalid: r.valid === false, landed,
        target: { x: c.x, z: c.z }, vmag: +r.vmag.toFixed(1) });
      map[iz][ix] = kind === 'inCell' ? '#' : kind === 'otherCell' ? '+'
        : kind === 'net' ? 'n' : kind === 'own' ? 's' : kind === 'out' ? 'o' : '.';
    }
    returnOut.push({ stroke: sc.id, classified, power, tally: tally(rows), map: mapToText(map) });
    zprog(`return ${sc.id} x${power} done\n`);
  }
}

/* ---------------- serves ---------------- */
const serveOut = [];
const TOSS = { x: 0, y: 1.14, z: 1.44 };
const tossV = V3.new(0, -0.8, 0), tossW = V3.new(0, 0, 0);
for (const sc of (ONLY === 'returns' ? [] : SERVE_SCENARIOS)) {
  const ctx = ctxFor({ y: TOSS.y, z: TOSS.z }, V3.new(0, 0, 0), 1.5);
  ctx.isServe = true;
  const base = L.deriveStroke(metrics(sc.gesture), ctx);
  const classified = base.stroke && base.stroke.id;
  for (const power of (QUICK ? [1] : sc.power)) {
    const rows = [];
    const map = emptyMap();
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const c = cellCenter(ix, iz);
      const raw = L.deriveStroke(metrics(sc.gesture), ctx);
      raw.isServe = true;
      raw.vmag = Math.min(12.5, raw.vmag * power);
      raw.aim = { x: c.x, z: c.z };
      const r = L.refineRacket(V3.new(TOSS.x, TOSS.y, TOSS.z),
        V3.clone(tossV), V3.clone(tossW), raw, 1.0, .9);
      const bv = V3.clone(tossV), bw = V3.clone(tossW);
      const info = L.impactRacket(bv, bw, r.normal, r.vR, .9, r.rubber || {});
      let kind = 'none', first = null, second = null;
      if (info) {
        const out = {};
        L.predict(launchFrom(TOSS, r.normal), bv, bw,
          { dt: PH.SIM_DT, maxT: 3.0, stopAfterBounces: 2, out });
        first = out.landed; second = out.b2;
        if (out.hitNet) kind = 'net';
        else if (!first) kind = 'out';
        else if (first.z <= 0) kind = 'short';          // served straight over: illegal
        else if (!second) kind = 'oneBounce';
        else if (second.z > 0) kind = 'ownSecond';
        else {
          const cell = cellOf(second);
          kind = !cell ? 'out' : (cell.ix === ix && cell.iz === iz) ? 'inCell' : 'otherCell';
        }
      }
      rows.push({ ix, iz, kind, invalid: r.valid === false, first, second,
        target: { x: c.x, z: c.z }, landed: second });
      map[iz][ix] = kind === 'inCell' ? '#' : kind === 'otherCell' ? '+'
        : kind === 'net' ? 'n' : kind === 'short' ? 's' : kind === 'out' ? 'o' : '.';
    }
    serveOut.push({ serve: sc.id, classified, power, tally: tally(rows), map: mapToText(map) });
    zprog(`serve ${sc.id} x${power} done\n`);
  }
}

console.log(JSON.stringify({ grid: N, cell: { dx: +DX.toFixed(5), dz: +DZ.toFixed(5) },
  assist: 1.0, returns: returnOut, serves: serveOut }, null, 1));
