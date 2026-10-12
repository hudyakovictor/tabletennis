/* =====================================================================
 *  CAMERA — four FIXED rigs, and nothing else.
 *
 *  Why this file exists. The camera used to be a preset plus a free
 *  orbit (drag / wheel / pinch / arrow keys / three sliders). A free
 *  orbit means every player has to re-discover a playable framing by
 *  hand, and "playable" is a narrow band: from too low the net hides
 *  the ball, from too high the two halves squash together and depth is
 *  gone, from the side your own bat leaves the frame. It also means the
 *  table can be tilted in the picture, which is the single fastest way
 *  to make a table-tennis game feel wrong.
 *
 *  So: the camera is now a choice between four authored rigs. Each one
 *  has a fixed eye, a fixed look point and a fixed FOV — distance and
 *  angle are decided here, once, and measured (tt/tools/analyze.js,
 *  suite 5) on eight aspect ratios:
 *
 *    · the whole table (four corners + both net ends) is always inside
 *      the frame, with margin;
 *    · the camera never yaws off the table's centre line, so the table
 *      is always straight — the net stays vertical in the picture and
 *      the two sidelines converge symmetrically;
 *    · the volume your bat can occupy is inside the frame too, so the
 *      racket can never be parked off-screen;
 *    · on narrow/portrait screens the rig is pushed back (never tilted)
 *      until the table fits — the geometry stays authored, only the
 *      distance adapts.
 *
 *  Everything here is a pure function of (mode, ball, aspect): no state,
 *  no DOM, no renderer. The game calls it, the analysis bench calls the
 *  very same code, so the measurement cannot drift from the build.
 * ===================================================================== */
'use strict';

/* ------------------------------------------------------------------ *
 *  THE FOUR RIGS
 *  eye/look are in metres, fov is vertical degrees authored for 16:9.
 *  `follow` is the ONLY motion allowed, and it is a pure translation of
 *  the whole rig (no pitching, no yawing) so the table cannot tilt.
 * ------------------------------------------------------------------ */
const CAMERA_PRESETS = {
  /* The broadcast frame: over the player's shoulder, whole table in
     shot, ~23° down. This is the one a TV director would cut to. */
  BROADCAST: {
    id: 'BROADCAST', ru: 'ТВ', short: 'ТРАНСТЛЯЦИЯ',
    desc: 'Классический ракурс трансляции: весь стол и своя ракетка в кадре',
    eye: { x: 0, y: 2.28, z: 3.22 }, look: { x: 0, y: 0.80, z: -0.30 }, fov: 42,
    follow: { y: 0, z: 0 },
  },
  /* Slightly lower and closer, and it rides the ball's height a few
     centimetres so a lob does not leave the top of the frame. */
  DYNAMIC: {
    id: 'DYNAMIC', ru: 'ДИНАМИКА', short: 'ДИНАМИКА',
    desc: 'Чуть ниже и ближе, камера мягко едет за высотой мяча',
    eye: { x: 0, y: 2.02, z: 2.94 }, look: { x: 0, y: 0.78, z: -0.34 }, fov: 46,
    follow: { y: 0.10, z: 0.06 },
  },
  /* Low, from just above the playing surface: the net reads as a real
     obstacle and the ball's height above it is obvious. */
  LOW: {
    id: 'LOW', ru: 'НИЗКАЯ', short: 'ОТ СТОЛА',
    desc: 'Низкая камера у уровня стола: хорошо видна высота мяча над сеткой',
    eye: { x: 0, y: 1.42, z: 3.12 }, look: { x: 0, y: 0.84, z: -0.36 }, fov: 48,
    follow: { y: 0, z: 0 },
  },
  /* A true side view, symmetric about the net: for reading spin,
     trajectory shape and the moment of contact. */
  SIDE: {
    id: 'SIDE', ru: 'СБОКУ', short: 'АНАЛИЗ',
    desc: 'Ровно сбоку, симметрично сетке: форма траектории и вращение как на ладони',
    eye: { x: 3.62, y: 1.66, z: 0 }, look: { x: 0, y: 0.86, z: 0 }, fov: 40,
    follow: { y: 0, z: 0 },
  },
};
const CAMERA_ORDER = ['BROADCAST', 'DYNAMIC', 'LOW', 'SIDE'];

/* The box your bat is allowed to occupy. One source of truth: the game
   clamps to it, the camera fits around it, the bench measures it. */
const PADDLE_LIMITS = {
  x: 1.02,                 // |x| of the bat, metres from the centre line
  yLo: -0.24, yHi: 0.94,   // bat height relative to the playing surface
  zNear: 1.02, zFar: 2.06, // bat depth: from just inside the table to well back
  /* Extra reach, granted ONLY for a ball that dies short AND leaves time to
   * get there (the game gates it on time-to-contact). 0.86 -> 0.66 because the
   * opponent's shots used to land at a median 0.76-0.82 m past the net — every
   * ball was a short ball, and a short ball arrives at the bat plane in
   * ~0.20 s, which is inside human reaction time. Measured with the old value:
   * 0-14 % of the opponent's returns were returnable at all. Leaning over the
   * table to pick a ball out of the front half is a real thing players do.
   * 0.46 is what a net-cord needs: a ball that clips the tape dribbles over and
   * dies 0.15-0.35 m in, so the bat has to be able to get almost to the net.
   * Checked against the frame rather than guessed: at 0.46 the step-in plane is
   * on screen for all 4 rigs x 8 aspects (0/128 corners outside). */
  zStepIn: 0.46,
};

const _cp = { eye: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: 42, mode: 'BROADCAST' };

/** Replicates Renderer.setCamera's narrow-screen rule: below 16:9 the
 *  HORIZONTAL field of view is locked, so portrait phones zoom out
 *  instead of cropping the table. */
function effectiveFov(fovDeg, aspect) {
  const REF = 16 / 9;
  let vf = fovDeg * DEG;
  if (aspect < REF) {
    const hf = 2 * Math.atan(Math.tan(vf / 2) * REF);
    const need = 2 * Math.atan(Math.tan(hf / 2) / Math.max(aspect, 0.30));
    vf = Math.min(need, vf * 1.55, 84 * DEG);
  }
  return vf / DEG;
}

/** view·proj for a rig — the same matrices the renderer builds. */
function rigViewProj(rig, aspect, out) {
  const vf = effectiveFov(rig.fov, aspect) * DEG;
  const proj = M4.perspective((out && out.proj) || M4.create(), vf, aspect, 0.05, 60);
  const view = M4.lookAt((out && out.view) || M4.create(), rig.eye, rig.look, { x: 0, y: 1, z: 0 });
  return M4.mul((out && out.vp) || M4.create(), proj, view);
}

/** World → normalised screen (0..1, y down). Matches Game.project(). */
function projectPoint(vp, p, out) {
  const o = out || {};
  const cw = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
  if (cw <= 1e-4) { o.ok = false; o.x = 0.5; o.y = 0.5; o.d = cw; return o; }
  o.x = ((vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / cw) * 0.5 + 0.5;
  o.y = 0.5 - ((vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / cw) * 0.5;
  o.d = cw; o.ok = true;
  return o;
}

/* ------------------------------------------------------------------ *
 *  Framing test used by the fit below and by the analysis bench.
 *
 *  Two point sets, because they are not the same problem:
 *    HARD — the table, the net and the volume the ball can occupy. These
 *           decide how far the rig is pushed back. If a corner of the
 *           table is out of frame the game is unplayable.
 *    SOFT — the box your bat can occupy. This is *reported*, not fitted:
 *           `clampPaddleToFrustum()` guarantees the bat itself is never
 *           left off-screen, and fitting the camera to the bat's most
 *           extreme pose (raised above the head, two metres back) would
 *           push the table so far away that the ball becomes a speck.
 * ------------------------------------------------------------------ */
const FRAME_POINTS = [];
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  FRAME_POINTS.push({ x: sx * PH.T_HALF_WID, y: PH.TABLE_Y, z: sz * PH.T_HALF_LEN, w: 1 });
}
FRAME_POINTS.push({ x: -PH.NET_HALF_WID, y: PH.NET_TOP, z: 0, w: 1 });
FRAME_POINTS.push({ x: PH.NET_HALF_WID, y: PH.NET_TOP, z: 0, w: 1 });
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 1.30, z: 0, w: 1 });            // a high lob
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 0.55, z: -PH.T_HALF_LEN - 0.5, w: 1 });  // deep behind the bot
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 0.45, z: PH.T_HALF_LEN + 0.45, w: 1 });   // short in front of you

const PADDLE_POINTS = [];
for (const sx of [-1, 1]) {
  for (const sz of [PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zNear, PADDLE_LIMITS.zFar]) {
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + PADDLE_LIMITS.yLo, z: sz });
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + 0.55, z: sz });
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + PADDLE_LIMITS.yHi, z: sz });
  }
}

/* Fairness set: the bat MUST be able to stand just outside both sidelines
   at the heights and depths a return is actually played at, on every
   preset and every aspect ratio. Without this a portrait phone quietly
   turns every wide ball into an unreturnable one — and the bat leaves the
   frame trying, which is the bug this whole file exists to prevent.
   These are real contact poses, not the corners of the whole box: fitting
   the extreme ones (bat at knee height two metres behind you) would push
   the camera so far back that the ball becomes a speck. */
const REACH_POSES = [
  [0.943, 0.10, 0.46],       // reaching over the table for a net-cord dribbler
  [0.943, 0.25, 1.02],
  [0.943, 0.30, 1.40],       // the bread and butter: wide, at the end line
  [0.943, 0.05, 1.55],       // wide and low
  [0.943, 0.35, 1.75],
  [0.943, 0.60, 1.95],       // a deep lob, taken high
];
const REACH_POINTS = [];
for (const sx of [-1, 1]) {
  for (const [x, y, z] of REACH_POSES) {
    REACH_POINTS.push({ x: sx * x, y: PH.TABLE_Y + y, z: z, w: 1 });
  }
}
const _fitVp = M4.create(), _fitS = {};
function _marginOver(vp, pts, weighted) {
  let worst = 1e9;
  for (const p of pts) {
    projectPoint(vp, p, _fitS);
    let m = Math.min(_fitS.x, 1 - _fitS.x, _fitS.y, 1 - _fitS.y);
    if (!_fitS.ok) m = -1;
    if (weighted && p.w) m /= p.w;
    if (m < worst) worst = m;
  }
  return worst;
}
function rigMargin(rig, aspect) {
  rigViewProj(rig, aspect, { vp: _fitVp });
  return Math.min(_marginOver(_fitVp, FRAME_POINTS, true), _marginOver(_fitVp, REACH_POINTS, false));
}
/** How much of the bat's volume this rig keeps on screen (0..1). */
function paddleVolumeVisible(rig, aspect) {
  rigViewProj(rig, aspect, { vp: _fitVp });
  let ok = 0;
  for (const p of PADDLE_POINTS) {
    projectPoint(_fitVp, p, _fitS);
    if (_fitS.ok && _fitS.x > 0.02 && _fitS.x < 0.98 && _fitS.y > 0.02 && _fitS.y < 0.98) ok++;
  }
  return ok / PADDLE_POINTS.length;
}

/* The push-back solve is a property of (mode, aspect) only, so it is
   cached — one solve per resolution change, not per frame. */
const _fitCache = new Map();
const FIT_MARGIN = 0.035;              // 3.5 % of the screen, all around

function fitRig(P, aspect) {
  const key = P.id + '|' + Math.round(aspect * 1000);
  const hit = _fitCache.get(key);
  if (hit) return hit;
  const rig = { eye: { x: P.eye.x, y: P.eye.y, z: P.eye.z },
    look: { x: P.look.x, y: P.look.y, z: P.look.z }, fov: P.fov, mode: P.id };
  if (rigMargin(rig, aspect) >= FIT_MARGIN) { _fitCache.set(key, rig); return rig; }
  // Push straight back along the authored axis, and if that is not enough,
  // raise the eye a little. Both keep the table square to the frame.
  const dx = rig.eye.x - rig.look.x, dy = rig.eye.y - rig.look.y, dz = rig.eye.z - rig.look.z;
  let best = null;
  for (const lift of [0, 0.14, 0.30, 0.50, 0.75]) {
    for (let k = 1.0; k <= 2.6; k += 0.05) {
      const r = {
        eye: { x: rig.look.x + dx * k, y: rig.look.y + dy * k + lift, z: rig.look.z + dz * k },
        look: { x: rig.look.x, y: rig.look.y, z: rig.look.z }, fov: rig.fov, mode: rig.mode,
      };
      const m = rigMargin(r, aspect);
      if (!best || m > best.m) best = { m, r };
      if (m >= FIT_MARGIN) break;
    }
    if (best && best.m >= FIT_MARGIN) break;
  }
  const out = best ? best.r : rig;
  _fitCache.set(key, out);
  return out;
}

/**
 * The camera for this frame. Pure: mode + ball + aspect in, rig out.
 * The returned object is reused, so never hold on to it.
 */
function cameraRigFor(mode, ball, aspect, out) {
  const P = CAMERA_PRESETS[mode] || CAMERA_PRESETS.BROADCAST;
  const base = fitRig(P, aspect);
  const o = out || _cp;
  const f = P.follow;
  let fy = 0, fz = 0;
  if (f.y || f.z) {
    // ride the ball's height/depth a few centimetres — a pure translation
    const h = clamp(((ball ? ball.y : PH.TABLE_Y) - PH.TABLE_Y) / 1.4, 0, 1);
    const d = clamp(((ball ? ball.z : 0) + 0.6) / 2.2, 0, 1);
    fy = h * f.y; fz = d * f.z;
  }
  o.mode = P.id;
  o.eye.x = base.eye.x; o.eye.y = base.eye.y + fy; o.eye.z = base.eye.z + fz;
  o.look.x = base.look.x; o.look.y = base.look.y + fy; o.look.z = base.look.z + fz;
  o.fov = base.fov;
  return o;
}

/** Highest pixel the table itself occupies (0..1, y down). The HUD text
 *  band must stay above this, or messages land on the playing surface. */
function tableTopScreenY(mode, aspect, vpOut) {
  const rig = cameraRigFor(mode, { x: 0, y: PH.TABLE_Y, z: 0 }, aspect);
  const vp = rigViewProj(rig, aspect, vpOut || { vp: M4.create() });
  const a = projectPoint(vp, { x: -PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN }, {});
  const b = projectPoint(vp, { x: PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN }, {});
  const c = projectPoint(vp, { x: 0, y: PH.NET_TOP, z: 0 }, {});
  return Math.max(0.05, Math.min(a.y, b.y, c.y));
}

/* ------------------------------------------------------------------ *
 *  POINTER → BAT
 *  One function, used by the game and measured by the bench: the bat is
 *  where the cursor is, always, and it can never be pushed outside the
 *  frame (which is how it used to get lost off-screen and stay there).
 * ------------------------------------------------------------------ */
const _ptOut = { tx: 0, ty: 0, tz: 0 };

/**
 * @param px,py   pointer in normalised screen space (0..1, y down)
 * @param stanceY the y the hand landed at — it sets how deep you stand,
 *                so flicking the wrist upward cannot lunge you over the table
 * @param sens    the player's sensitivity multiplier
 */
function paddleTargetFromPointer(px, py, stanceY, sens, out, opts) {
  const o = out || _ptOut;
  const s = clamp(Number.isFinite(sens) ? sens : 1, 0.4, 2.2);
  const zNear = (opts && Number.isFinite(opts.zNear))
    ? clamp(opts.zNear, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar) : PADDLE_LIMITS.zNear;
  let x = Number.isFinite(px) ? clamp(px, 0, 1) : 0.5;
  let y = Number.isFinite(py) ? clamp(py, 0, 1) : 0.55;
  let sy = Number.isFinite(stanceY) ? clamp(stanceY, 0, 1) : y;
  // 0.5 on screen is the centre line; the reachable half-width is the
  // authored limit, so the mapping is exact and independent of sensitivity
  // at the centre and only the *gain* changes with the slider.
  o.tx = (x - 0.5) * 2 * PADDLE_LIMITS.x * s;
  o.ty = PH.TABLE_Y + 0.62 - (y - 0.18) * 0.95 * s;
  o.tz = 1.44 + clamp(sy - 0.55, -0.34, 0.45) * 0.86 * (0.6 + 0.4 * s);
  o.tx = clamp(o.tx, -PADDLE_LIMITS.x, PADDLE_LIMITS.x);
  o.ty = clamp(o.ty, PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi);
  o.tz = clamp(o.tz, zNear, PADDLE_LIMITS.zFar);
  o.zNear = zNear;
  return o;
}

const _clampS = {}, _clampA = {}, _clampP = { x: 0, y: 0, z: 0 };
/* The pose the rig is authored around: dead centre, bat height, mid-depth.
   Every rig keeps it on screen with margin to spare (verified in the
   camera suite), which is what makes it a usable anchor for the clamp. */
/* How long the bat owns the new point before the cursor gets it back. Shared
 * by resetPaddle() and the home blend in updatePlayerPaddle(). */
const RECENTER_S = 0.34;

const PADDLE_HOME = { x: 0, y: PH.TABLE_Y + 0.62, z: 1.44 };

function insideFrame(s, m) {
  return s.ok && s.x > m && s.x < 1 - m && s.y > m && s.y < 1 - m;
}

/** Largest k in [0,1] with lerp(a,b,k) still inside the frame, given that a
 *  is inside and b is not. The visible part of a perspective frustum is a
 *  convex set, so the segment crosses the edge exactly once and bisection
 *  converges monotonically — no gain to tune, no overshoot, no rig-specific
 *  behaviour. 12 steps resolve the boundary to 1/4096 of the segment. */
function bisectIntoFrame(vp, m, ax, ay, az, bx, by, bz) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const k = 0.5 * (lo + hi);
    _clampP.x = ax + (bx - ax) * k;
    _clampP.y = ay + (by - ay) * k;
    _clampP.z = az + (bz - az) * k;
    if (insideFrame(projectPoint(vp, _clampP, _clampS), m)) lo = k; else hi = k;
  }
  return lo;
}

/**
 * Pull the bat back inside the frame. Called after the pointer map and after
 * every assist, so neither the cursor nor the intercept solver can park the
 * racket somewhere the player cannot see it — the original complaint behind
 * "the racket drifts off screen and stays there".
 *
 * The previous version nudged tx/ty by a fixed gain (3.1 / 2.2 per unit of
 * overshoot) twice and then re-clamped to the authored limits, which could
 * push it straight back out. Measured: 22 % of samples off-frame at
 * sensitivity 1.0 and 51 % at 1.8. It also fought the player's intent — a
 * horizontal overshoot dragged the bat's height with it.
 */
function clampPaddleToFrustum(vp, t, margin) {
  const m = margin === undefined ? 0.045 : margin;
  const s = projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, _clampS);
  /* Behind the camera no pull on any axis can help, and returning the pose
   * untouched is exactly how the bat used to end up stranded off screen. Home
   * is on screen by construction — bench suite 6 checks that anchor for every
   * rig x aspect — so that is where the bat goes. */
  if (!s.ok) { t.tx = PADDLE_HOME.x; t.ty = PADDLE_HOME.y; t.tz = PADDLE_HOME.z; return t; }
  const outX = s.x < m || s.x > 1 - m;
  const outY = s.y < m || s.y > 1 - m;
  if (!outX && !outY) return t;

  /* Offend on one axis only? Pull on that axis and leave the other alone, so
     the height you chose survives a horizontal correction. Otherwise fall
     back to the home pose, which is on screen by construction. */
  const tries = outX !== outY
    ? [[outX ? PADDLE_HOME.x : t.tx, outX ? t.ty : PADDLE_HOME.y, t.tz], [PADDLE_HOME.x, PADDLE_HOME.y, t.tz]]
    : [[PADDLE_HOME.x, PADDLE_HOME.y, t.tz]];
  for (let i = 0; i < tries.length; i++) {
    const ax = tries[i][0], ay = tries[i][1], az = tries[i][2];
    if (!insideFrame(projectPoint(vp, { x: ax, y: ay, z: az }, _clampA), m)) continue;
    const k = bisectIntoFrame(vp, m, ax, ay, az, t.tx, t.ty, t.tz);
    t.tx = ax + (t.tx - ax) * k;
    t.ty = ay + (t.ty - ay) * k;
    break;
  }
  /* If even the home pose cannot be shown at the depth that was asked for,
   * then the DEPTH is the problem: a bat leaning over the table toward the net
   * leaves the frame on rigs that were fitted for a body standing behind the
   * end line. Walk the depth back toward the body until the pose fits, and
   * report the depth settled on — the caller has to take t.tz back or the
   * correction is silently thrown away. Measured cost of not doing it: 402 of
   * 19 447 headless match frames with the bat off screen (worst 9 % of the
   * viewport) after the step-in reach was deepened 0.86 -> 0.46. */
  if (!insideFrame(projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, _clampA), m)) {
    for (let k = 1; k <= 4; k++) {
      const f = k / 4;
      const az = lerp(t.tz, PADDLE_LIMITS.zNear, f);
      const ax = lerp(t.tx, PADDLE_HOME.x, f * 0.5), ay = lerp(t.ty, PADDLE_HOME.y, f * 0.5);
      if (!insideFrame(projectPoint(vp, { x: ax, y: ay, z: az }, _clampA), m)) continue;
      const kk = bisectIntoFrame(vp, m, ax, ay, az, t.tx, t.ty, az);
      t.tx = ax + (t.tx - ax) * kk;
      t.ty = ay + (t.ty - ay) * kk;
      t.tz = az;
      break;
    }
  }
  /* Last resort, and the whole reason this function exists: if no depth shows
   * the pose, the bat goes home instead of staying invisible. */
  if (!insideFrame(projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, _clampA), m)) {
    t.tx = PADDLE_HOME.x; t.ty = PADDLE_HOME.y; t.tz = PADDLE_HOME.z;
  }
  t.tx = clamp(t.tx, -PADDLE_LIMITS.x, PADDLE_LIMITS.x);
  t.ty = clamp(t.ty, PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi);
  t.tz = clamp(t.tz, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
  return t;
}

function paddleVisibleOk(vp, t, margin) {
  projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, _clampS);
  if (!_clampS.ok) return false;
  const m = margin === undefined ? 0.0 : margin;
  return _clampS.x > m && _clampS.x < 1 - m && _clampS.y > m && _clampS.y < 1 - m;
}
