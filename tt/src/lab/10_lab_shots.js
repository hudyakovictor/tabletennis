/* =====================================================================
 *  SHOT MODEL — exactly eight strokes, one per swipe direction.
 *
 *  Direction decides the spin:
 *     ↑  topspin          ↓  backspin
 *     ←/→  sidespin       diagonals = top/back + side
 *  Distance of the swipe decides the power (three bands). No hold, no
 *  second axis, no curved gesture: research (docs/research-shots-2026.md)
 *  shows that is the most a thumb or a mouse can reproduce reliably.
 *
 *  The ball is launched with a real velocity/spin and then flies through
 *  the SAME collisions as the live simulation: a weak shot dies before the
 *  net, an over-hit one flies past the end line. Nothing is teleported onto
 *  the table, so what the counter reports is what physics did.
 * ===================================================================== */
'use strict';

const LAB_SHOTS = Object.freeze([
  { id: 'TOP',      ru: 'ТОПСПИН',      short: 'ТОП',  dir: [0, 1],            deg: 0,
    top: 230, side: 0,   speed: 8.01, aim: 0.00, elev: 0.262, elevBias: 0.010 },
  { id: 'TOP_R',    ru: 'ТОПСПИН →',    short: 'ТОП →', dir: [0.7071, 0.7071], deg: 45,
    top: 175, side: 105, speed: 7.78, aim: 0.42, elev: 0.240, elevBias: 0.000 },
  { id: 'SIDE_R',   ru: 'БОКОВОЙ →',    short: 'БОК →', dir: [1, 0],            deg: 90,
    top: 25,  side: 150, speed: 5.03, aim: 0.42, elev: 0.185, elevBias: -0.010 },
  { id: 'BACK_R',   ru: 'ПОДРЕЗКА →',   short: 'РЕЗ →', dir: [0.7071, -0.7071], deg: 135,
    top: -150, side: 105, speed: 4.55, aim: 0.40, elev: 0.230, elevBias: 0.030 },
  { id: 'BACK',     ru: 'ПОДРЕЗКА',     short: 'РЕЗ',  dir: [0, -1],           deg: 180,
    top: -190, side: 0,  speed: 4.49, aim: 0.00, elev: 0.235, elevBias: 0.040 },
  { id: 'BACK_L',   ru: 'ПОДРЕЗКА ←',   short: 'РЕЗ ←', dir: [-0.7071, -0.7071], deg: 225,
    top: -150, side: -105, speed: 4.55, aim: -0.40, elev: 0.230, elevBias: 0.030 },
  { id: 'SIDE_L',   ru: 'БОКОВОЙ ←',    short: 'БОК ←', dir: [-1, 0],           deg: 270,
    top: 25,  side: -150, speed: 5.03, aim: -0.42, elev: 0.185, elevBias: -0.010 },
  { id: 'TOP_L',    ru: 'ТОПСПИН ←',    short: 'ТОП ←', dir: [-0.7071, 0.7071], deg: 315,
    top: 175, side: -105, speed: 7.78, aim: -0.42, elev: 0.240, elevBias: 0.000 },
]);

const LAB_SHOT_BY_ID = Object.freeze(LAB_SHOTS.reduce((o, s) => (o[s.id] = s, o), {}));
const LAB_SHOT_INDEX = Object.freeze(LAB_SHOTS.reduce((o, s, i) => (o[s.id] = i, o), {}));

/* ------------------------------- direction --------------------------- */
/** Nearest of the eight authored directions to a screen vector.
 *  A crooked human line is snapped, not rejected: this is the whole point
 *  of "выпрямляться до ближайшей возможной фигуры". */
function labShotForVector(dx, dy) {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  const ux = dx / len, uy = dy / len;
  let best = null, bestDot = -2;
  for (const s of LAB_SHOTS) {
    const d = ux * s.dir[0] + uy * s.dir[1];
    if (d > bestDot) { bestDot = d; best = s; }
  }
  return { shot: best, dot: bestDot, angle: best.deg, ux, uy };
}

/* ------------------------------- effort ------------------------------ */
/** Swipe length in millimetres -> continuous effort.
 *  Length, not speed: speed depends on frame rate and on how hard the
 *  finger was flicked, while length is something the player can repeat. */
function labEffort(mm) {
  const span = LAB.powerFullMm - LAB.powerZeroMm;
  return clamp((mm - LAB.powerZeroMm) / span, 0, 1) * LAB.effortMax;
}
function labPowerBand(effort) {
  if (effort < LAB.weakBelow) return 'weak';
  if (effort < LAB.normalBelow) return 'normal';
  if (effort < LAB.strongBelow) return 'strong';
  return 'over';
}
const LAB_BAND_RU = Object.freeze({
  weak: 'СЛАБЫЙ', normal: 'ОБЫЧНЫЙ', strong: 'СИЛЬНЫЙ', over: 'СЛИШКОМ СИЛЬНО',
});
/* Bat speed vs swipe length. Chosen so the four bands read on the table:
 * weak dies short, normal lands mid-table, strong lands near the far edge,
 * over flies off the end. */
function labPowerFactor(effort) {
  return 0.58 + 0.80 * effort;
}
function labSpinFactor(effort) {
  return 0.55 + 0.85 * effort;
}

/* ---------------------------- ball flights --------------------------- */
/**
 * Time to the strike plane, from the SAME predictor the rest of the game
 * uses. A null time means the ball never gets there (it dies short or it
 * has already gone past).
 */
const _wtpPred = {};
function labTimeToPlane(ball, planeZ) {
  if (!ball || !ball.live) return { t: null, at: null };
  const z = Number.isFinite(planeZ) ? planeZ : LAB.strikeZ;
  if (!(ball.v.z > 0.05)) return { t: null, at: null };
  /* Already past the plane: report how long ago, negative. Without this a
   * ball that flew by would still look contactable for the rest of the frame. */
  if (ball.p.z >= z) {
    return { t: -(ball.p.z - z) / Math.max(ball.v.z, 0.2),
      at: { x: ball.p.x, y: ball.p.y, z: ball.p.z } };
  }
  const o = predict({ x: ball.p.x, y: ball.p.y, z: ball.p.z },
    { x: ball.v.x, y: ball.v.y, z: ball.v.z },
    { x: ball.w.x, y: ball.w.y, z: ball.w.z },
    { dt: 1 / 180, maxT: 2.6, stopZ: z, stopDir: 1, stopAtPlane: true, out: _wtpPred });
  if (o.reach && Number.isFinite(o.reachT)) {
    return { t: o.reachT, at: { x: o.reach.x, y: o.reach.y, z: o.reach.z } };
  }
  return { t: null, at: null };
}

/**
 * Colour zone of the ball and whether a stroke can be accepted now.
 *
 *   white : still on the opponent's side, or arriving above the reachable
 *           height — too early to swing
 *   green : on our side and not yet past the strike plane — swing now
 *   red   : past the strike plane — the stroke would be late
 *
 * `tHit` is the signed time to the strike plane (negative = already past).
 * It is measured from the recorded crossing, so the sign cannot be wrong
 * even when a prediction of a already-passed ball would answer "0".
 */
function labBallZone(ball, tHit) {
  if (!ball || !ball.live || ball.lastHitBy !== -1)
    return { zone: 'idle', inWindow: false, t: null };
  if (ball.p.y < LAB.windowMinY || ball.p.y > LAB.windowMaxY)
    return { zone: 'idle', inWindow: false, t: null };
  let t = tHit;
  if (t === undefined) t = labTimeToPlane(ball).t;
  const tt = Number.isFinite(t) ? t : null;
  if (tt !== null && tt < -LAB.windowLateSec) return { zone: 'late', inWindow: false, t: tt };
  /* Red starts a hair BEFORE the plane: a swipe needs ~80-130 ms, so a ball
   * that is already this close can no longer be returned. Red then lasts
   * until the ball is gone, which keeps the colour readable on screen. */
  if (tt !== null && tt < LAB.lateReactSec) return { zone: 'late', inWindow: false, t: tt };
  if (ball.p.z >= LAB.windowOpenZ && (tt === null || tt >= -LAB.windowLateSec))
    return { zone: 'ready', inWindow: true, t: tt };
  if (tt !== null && tt < LAB.windowLateSec) return { zone: 'late', inWindow: false, t: tt };
  return { zone: 'early', inWindow: false, t: tt };
}

/* Evaluate one launch candidate with the production flight model. */
const _labPred = {};
function labFlight(from, v, w, opts) {
  const p = { x: from.x, y: from.y, z: from.z };
  const vv = { x: v.x, y: v.y, z: v.z };
  const ww = { x: w.x, y: w.y, z: w.z };
  return predict(p, vv, ww, Object.assign({
    dt: 1 / 230, maxT: 2.6, stopOnFirstBounce: true, out: _labPred,
  }, opts || {}));
}

/**
 * Launch the ball from `from` so that it lands on `target` (x,z), with a
 * fixed speed and spin. The elevation is searched inside a human range
 * (≤ 0.34 rad); if the ball is too slow it dies short, if it is too fast
 * there is no elevation left that can bring it down inside the table.
 * That is how the two failure modes the brief asks for happen naturally.
 */
function labSolveLaunch(from, target, spin, speed, opts) {
  const elevBase = (opts && Number.isFinite(opts.elevBase)) ? opts.elevBase : 0.21;
  const elevSpan = (opts && Number.isFinite(opts.elevSpan)) ? opts.elevSpan : 0.085;
  let ux0 = target.x - from.x, uz0 = target.z - from.z;
  const horiz = Math.hypot(ux0, uz0) || 1e-6;
  ux0 /= horiz; uz0 /= horiz;

  const scan = (ux, uz) => {
    let best = null;
    /* A wide but ordered scan: the shot keeps its character because any
     * elevation far from the authored one is penalised, but a ball met low
     * over the table can still be lifted enough to reach the far half. */
    const lo = elevBase - 0.24, hi = elevBase + 0.30;
    for (let i = 0; i <= 14; i++) {
      const elev = lo + (i / 14) * (hi - lo);
      const ch = Math.cos(elev), sh = Math.sin(elev);
      const v = { x: ux * speed * ch, y: speed * sh, z: uz * speed * ch };
      const t = labFlight(from, v, spin);
      let score;
      if (t.hitNet) score = 60 + Math.max(0, -t.clear) * 30;
      else if (t.landed) score = Math.hypot(t.landed.x - target.x, t.landed.z - target.z)
        + Math.max(0, 0.03 - t.clear) * 12;
      else {
        const pc = t.planeCross || t.floor;
        score = 8 + (pc ? Math.hypot(pc.x - target.x, pc.z - target.z) : 9);
      }
      score += Math.abs(elev - elevBase) * 0.35;
      if (!best || score < best.score) best = { score, elev, elevDeg: elev / DEG, v, flight: t, ux, uz };
    }
    return best;
  };

  let best = scan(ux0, uz0);
  /* Sidespin bends the flight after launch, so the aim has to be rotated
   * the other way. Two small corrections are enough for every legal speed;
   * they cost two flights and keep the shot's character intact. */
  for (let k = 0; k < 2; k++) {
    const f = best.flight;
    if (!f || !f.landed) break;
    const errLat = (f.landed.x - target.x) * (-best.uz) + (f.landed.z - target.z) * (best.ux);
    if (Math.abs(errLat) < 0.035) break;
    const corr = -Math.atan2(errLat, horiz) * 0.95;
    const c = Math.cos(corr), sN = Math.sin(corr);
    const nx = best.ux * c - best.uz * sN;
    const nz = best.ux * sN + best.uz * c;
    const cand = scan(nx, nz);
    if (cand.score < best.score) best = cand; else break;
  }
  return best;
}

/**
 * Build the player's stroke: gesture -> real launch velocity + spin.
 *
 * Power is NOT compensated away. The launch direction is solved once for a
 * reference swipe (a calm, normal stroke that lands mid-table), and then the
 * bat speed is scaled by the actual swipe length. A soft swipe therefore
 * genuinely drops short of the net, a hard one genuinely overruns the far
 * edge — which is exactly what the debug mode has to show. Anything else
 * would teach the player that power does not matter.
 */
const STROKE_REF_EFFORT = 0.55;
const _strokeCache = new Map();
function labBuildStroke(shot, effort, contact) {
  const from = { x: contact.x, y: contact.y, z: contact.z };
  const key = `${shot.id}|${from.x.toFixed(2)}|${from.y.toFixed(2)}|${from.z.toFixed(2)}`;
  let ref = _strokeCache.get(key);
  if (!ref) {
    const target = {
      x: clamp(shot.aim, -PH.T_HALF_WID * 0.82, PH.T_HALF_WID * 0.82),
      z: from.z < 0.9 ? -0.62 : -0.88,
    };
    const spin = { x: -shot.top, y: -shot.side, z: 0 };
    const sol = labSolveLaunch(from, target, spin, shot.speed,
      { elevBase: shot.elev + shot.elevBias, elevSpan: 0.100 });
    const f = sol && sol.flight;
    const onTable = !!(f && f.landed && f.landed.z < 0 &&
      Math.abs(f.landed.x) <= PH.T_HALF_WID);
    ref = sol ? { dir: sol.v, solved: onTable, target } : { dir: null, solved: false, target };
    if (_strokeCache.size > 48) _strokeCache.clear();
    _strokeCache.set(key, ref);
  }
  const speed = shot.speed * labPowerFactor(effort);
  const k = labSpinFactor(effort);
  const spin = { x: -shot.top * k, y: -shot.side * k, z: 0 };
  const target = ref.target;
  let v;
  if (ref.dir) {
    const l = Math.hypot(ref.dir.x, ref.dir.y, ref.dir.z) || 1;
    v = { x: ref.dir.x / l * speed, y: ref.dir.y / l * speed, z: ref.dir.z / l * speed };
  } else {
    v = { x: 0, y: speed * 0.35, z: -speed * 0.94 };
  }
  return {
    shot, effort, band: labPowerBand(effort), target,
    speed, spin, target_z: target.z,
    elevDeg: Math.asin(clamp(v.y / (speed || 1), -1, 1)) / DEG,
    v, solved: ref.solved,
  };
}

/* -------------------------------- serve ------------------------------ */
/** A legal serve: own side first, then the opponent's, in the chosen
 *  direction with the chosen spin. Solved once and cached per combination
 *  so serving never costs a frame. */
const LAB_SERVE_CACHE = new Map();
const _servePred = {};
function labSolveServe(dirKey, spinKey) {
  const key = dirKey + '|' + spinKey;
  if (LAB_SERVE_CACHE.has(key)) return LAB_SERVE_CACHE.get(key);
  const dirx = dirKey === 'LEFT' ? -1 : dirKey === 'RIGHT' ? 1 : 0;
  const aimX = dirx * 0.50;
  const own = { x: aimX * 0.30, z: LAB.serveOwnZ };
  const fin = { x: aimX, z: LAB.serveTargetZ };
  const spinTop = spinKey === 'TOP' ? 120 : spinKey === 'BACK' ? -110 : 0;
  const spinSide = spinKey === 'SIDE' ? (dirx >= 0 ? -130 : 130) : 0;
  const spin = { x: -spinTop, y: -spinSide, z: 0 };
  const hand = { x: LAB.serveHand.x * (dirx || 1) * 0.5, y: LAB.serveHand.y, z: LAB.serveHand.z };
  let best = null;
  for (let si = 0; si < 9; si++) {
    const speed = 3.6 + si * 0.62;
    for (let ei = 0; ei < 9; ei++) {
      const elev = -0.10 + ei * 0.075;
      const ch = Math.cos(elev), sh = Math.sin(elev);
      /* Aim the HORIZONTAL line at the final target: that is what puts the
       * serve left / centre / right. The speed and the elevation decide how
       * far the first bounce lands, i.e. whether the serve is legal. */
      const ax = fin.x - hand.x, az = fin.z - hand.z;
      const ah = Math.hypot(ax, az) || 1e-6;
      const v = { x: (ax / ah) * speed * ch, y: speed * sh, z: (az / ah) * speed * ch };
      const p = { x: hand.x, y: hand.y, z: hand.z };
      const out = predict(p, v, spin,
        { dt: 1 / 180, maxT: 2.4, stopAfterBounces: 2, out: _servePred });
      const b1 = out.landed, b2 = out.b2;
      let score = (b1 ? Math.hypot(b1.x - own.x, b1.z - own.z) : 5)
        + (b2 ? Math.hypot(b2.x - fin.x, b2.z - fin.z) : 4)
        + (out.hitNet ? 8 : 0);
      if (b1 && b1.z < 0) score += 6;                  // bounced on the wrong side first
      if (b2 && b2.z > 0) score += 6;
      if (!best || score < best.score) best = { score, v, speed, elev };
    }
  }
  LAB_SERVE_CACHE.set(key, best);
  return best;
}
