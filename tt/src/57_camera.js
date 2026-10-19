/* =====================================================================
 * CAMERA — stable elevated presets + independent height and dolly.
 * Headroom includes the opponent racket and serve toss, not just the table.
 * Renderer and all hit-test/HUD matrices share the same framing shift.
 * ===================================================================== */
'use strict';

// Stable front-facing views. Legacy IDs keep existing saves compatible.
const CAMERA_PRESETS = {
  BROADCAST: { id: 'BROADCAST', ru: 'ИГРОВАЯ', short: 'ИГРА',
    desc: 'Весь стол и обе половины', pitch: 25, height: 0.63,
    eye: { x: 0, y: 2.25, z: 3.2 }, look: { x: 0, y: 0.76, z: 0 }, fov: 43, follow: { y: 0, z: 0 } },
  DYNAMIC: { id: 'DYNAMIC', ru: 'ОБЗОР', short: 'ОБЗОР',
    desc: 'Выше: легче читать отскок', pitch: 33, height: 0.63,
    eye: { x: 0, y: 2.85, z: 3.2 }, look: { x: 0, y: 0.76, z: 0 }, fov: 43, follow: { y: 0, z: 0 } },
  LOW: { id: 'LOW', ru: 'БЛИЖЕ', short: 'БЛИЖЕ',
    desc: 'Крупнее, без вида из-под стола', pitch: 22, height: 0.69,
    eye: { x: 0, y: 2.05, z: 3.2 }, look: { x: 0, y: 0.76, z: 0 }, fov: 40, follow: { y: 0, z: 0 } },
};
const CAMERA_ORDER = ['BROADCAST', 'DYNAMIC', 'LOW'];

/* The box your bat is allowed to occupy. One source of truth: the game
   clamps to it, the camera fits around it, the bench measures it. */
const PADDLE_LIMITS = {
  x: 1.02,                 // |x| of the bat, metres from the centre line
  yLo: -0.28, yHi: 1.00,   // bat height relative to the playing surface (expanded for mobile)
  /* Realistic stance: the player stands 40-110 cm behind the end line,
   * not hovering right over the table edge. zNear = just behind end line,
   * zFar = a full metre back. zStepIn allows leaning over the table for
   * very short balls (net-cord dribblers). */
  zNear: 1.45, zFar: 2.50, // bat depth: from end line to well behind it
  zStepIn: 0.80,           // lean over the table for a short ball
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

/* ------------------------------------------------------------------ *
 *  PHONE VS DESKTOP FRAMING
 *  A portrait screen is tall and narrow: the table fills the width long
 *  before it fills the height, so the vertical bands (opponent raise,
 *  reading room, dead margins) decide how much of the screen is empty.
 *  Phones get a tighter fit margin and tighter bands, so the table reads
 *  as big as its width allows and the spare space goes to the game, not
 *  to the frame. Desktop keeps the authored roomy contract.
 * ------------------------------------------------------------------ */
function phoneFactor(aspect) {
  return 1 - smoothstep(0.85, 1.3, aspect);
}
function frameMargin(aspect) {
  return lerp(0.055, 0.012, phoneFactor(aspect));
}
/** Dead air above the opponent's raised bat: the readability headroom. */
function cameraHeadroom(aspect) {
  return lerp(CAMERA_HEADROOM, 0.055, phoneFactor(aspect));
}
/** Lowest screen fraction the table feet may reach (HUD room below). */
function frameBottomRoom(aspect) {
  return lerp(0.901, 0.955, phoneFactor(aspect));
}

/** view·proj for a rig — the same matrices the renderer builds. */
function rigViewProj(rig, aspect, out) {
  const vf = effectiveFov(rig.fov, aspect) * DEG;
  const proj = M4.perspective((out && out.proj) || M4.create(), vf, aspect, 0.05, 60);
  proj[9] = 2 * (rig.shiftY || 0);
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
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 1.10, z: 0, w: 1 });            // a high lob
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 0.50, z: -PH.T_HALF_LEN - 0.35, w: 1 });  // deep behind the bot
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 0.35, z: PH.T_HALF_LEN + 0.15, w: 1 });   // short in front of you

const PADDLE_POINTS = [];
for (const sx of [-1, 1]) {
  for (const sz of [PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zNear, PADDLE_LIMITS.zFar]) {
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + PADDLE_LIMITS.yLo, z: sz });
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + 0.55, z: sz });
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + PADDLE_LIMITS.yHi, z: sz });
  }
}

/* Fairness set: contact poses kept in frame */
const REACH_POSES = [
  [0.85, 0.10, 0.80],       // reaching over the table for a net-cord dribbler
  [0.85, 0.25, 1.45],       // at the end line
  [0.85, 0.28, 1.37],       // wide, at the end line
  [0.85, 0.15, 1.78],       // wide and low, normal stance
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
  const phone = phoneFactor(aspect);
  const pitch = P.pitch * DEG; // Identical angle on phone and desktop.
  /* Mobile (portrait) fix: start much closer so the table fills the screen.
   * The old eye.z=3.2 + fitTablePresentation pushed the camera back until
   * the whole hall was visible on a narrow phone — the table became a stamp.
   * Now: bring the eye ~30% closer on phones and allow tighter margins so
   * the fit solver doesn't undo the closeness. */
  const eyeZ = lerp(3.2, 2.1, phone);
  const eyeY = PH.TABLE_Y + Math.tan(pitch) * eyeZ;
  const fov = lerp(P.fov, 30, phone);
  const rig = { eye: { x: 0, y: eyeY, z: eyeZ },
    look: { x: 0, y: PH.TABLE_Y, z: -0.12 }, fov, mode: P.id };
  // No automatic lift or ball-following: the chosen view stays predictable.
  /* maxPlayHeight caps the on-screen span from the opponent's raised bat down
   * to the near table edge. Pulling it in makes the rig dolly back a little, so
   * the whole play volume shrinks and tableFrameShift can lift the table off
   * the bottom edge — the "more room at the bottom" the player asked for.
   * Uniform scaling of eye↔look, so the viewing tilt is unchanged. */
  fitTablePresentation(rig, aspect, lerp(P.height, 0.80, phone),
    frameMargin(aspect), lerp(0.66, 0.82, phone));
  _fitCache.set(key, rig);
  return rig;
}

/**
 * The camera for this frame. Pure: mode + ball + aspect in, rig out.
 * The returned object is reused, so never hold on to it.
 */
function cameraRigFor(mode, ball, aspect, out, controls) {
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
  o.shiftY = 0;
  if (controls) {
    // Height is independent of zoom: RMB raises the eye, wheel dollies.
    const height = clamp(Number.isFinite(controls.height) ? controls.height : 0, -1, 2.5);
    const depth = Math.hypot(o.eye.x - o.look.x, o.eye.z - o.look.z);
    o.eye.y = o.look.y + clamp(o.eye.y - o.look.y + height,
      Math.tan(18 * DEG) * depth, Math.tan(42 * DEG) * depth);
    const zoom = clamp(Number.isFinite(controls.zoom) ? controls.zoom : 1, 0.72, 1.6);
    o.eye.x = o.look.x + (o.eye.x - o.look.x) * zoom;
    o.eye.y = o.look.y + (o.eye.y - o.look.y) * zoom;
    o.eye.z = o.look.z + (o.eye.z - o.look.z) * zoom;
    if (zoom !== 1 || height !== 0) {
      const phone = phoneFactor(aspect);
      /* The manual dolly may enlarge the table past the base framing, but
       * never past the frame: the play span stops at 0.88 so the shift can
       * still give the opponent its headroom AND leave the lower reading
       * room for the shot breakdown. */
      fitTablePresentation(o, aspect, lerp(0.72, 0.78, phone),
        Math.min(frameMargin(aspect), 0.025), lerp(0.80, 0.88, phone));
    }
  }
  return o;
}

// Full table silhouette, including the feet: text must not cover its legs.
const TABLE_FRAME_POINTS = [];
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  TABLE_FRAME_POINTS.push({ x: sx * PH.T_HALF_WID, y: PH.TABLE_Y, z: sz * PH.T_HALF_LEN });
  TABLE_FRAME_POINTS.push({ x: sx * (PH.T_HALF_WID - 0.14), y: 0, z: sz * (PH.T_HALF_LEN - 0.22) });
}
for (const sx of [-1, 1]) TABLE_FRAME_POINTS.push({ x: sx * PH.NET_HALF_WID, y: PH.NET_TOP + 0.025, z: 0 });
function tableScreenBounds(vp, out = {}) {
  out.top = 1; out.bottom = 0; out.left = 1; out.right = 0;
  const p = {};
  for (const pt of TABLE_FRAME_POINTS) {
    projectPoint(vp, pt, p);
    if (!p.ok) continue;
    out.top = Math.min(out.top, p.y); out.bottom = Math.max(out.bottom, p.y);
    out.left = Math.min(out.left, p.x); out.right = Math.max(out.right, p.x);
  }
  return out;
}
// AI think() allows bat centres up to TABLE_Y + .70 and z -2.45..-1.16.
// Include the whole blade/handle, plus a small margin for the serve toss.
// This is a fixed volume: no camera bobbing as the ball or racket moves.
// The padding is deliberately snug (blade top ~+0.82, wings ~±1.25, deep
// reach ~-2.5): every centimetre trimmed here is a centimetre of headroom
// that tableFrameShift can then hand to the player's side at the bottom.
const OPPONENT_FRAME_POINTS = [];
for (const x of [-1.25, 0, 1.25]) for (const z of [-2.5, -1.0])
  OPPONENT_FRAME_POINTS.push({ x, y: PH.TABLE_Y + 0.82, z });
const CAMERA_HEADROOM = 0.10;
function opponentScreenTop(vp) {
  let top = 1;
  const p = {};
  for (const point of OPPONENT_FRAME_POINTS) {
    projectPoint(vp, point, p);
    if (!p.ok) return -1;
    top = Math.min(top, p.y);
  }
  return top;
}
const _frameBuffer = { vp: M4.create(), proj: M4.create(), view: M4.create() }, _frameBounds = {};
function fitTablePresentation(rig, aspect, maxHeight = 0.60, margin = 0.05, maxPlayHeight = 0.76) {
  // Leave usable reading room below the feet, not just below the tabletop.
  for (let i = 0; i < 50; i++) {
    const vp = rigViewProj(rig, aspect, _frameBuffer);
    const b = tableScreenBounds(vp, _frameBounds);
    const playTop = Math.min(b.top, opponentScreenTop(vp));
    if (b.bottom - b.top <= maxHeight && b.bottom - playTop <= maxPlayHeight &&
        b.left >= margin && b.right <= 1 - margin) break;
    rig.eye.x = rig.look.x + (rig.eye.x - rig.look.x) * 1.025;
    rig.eye.y = rig.look.y + (rig.eye.y - rig.look.y) * 1.025;
    rig.eye.z = rig.look.z + (rig.eye.z - rig.look.z) * 1.025;
  }
}
function tableFrameShift(rig, aspect) {
  const vp = rigViewProj({ ...rig, shiftY: 0 }, aspect, _frameBuffer);
  const b = tableScreenBounds(vp, _frameBounds);
  // Bias the framing toward the player's side: reserve roughly 4× more empty
  // room below the table than above it, so the bat and the incoming ball have
  // somewhere to live. The opponent-headroom guard below still caps how far up
  // the table may slide, so this never crops the opponent's serve toss.
  const preferred = (1 - b.bottom - 4 * b.top) / 5;
  return Math.max(preferred, cameraHeadroom(aspect) - opponentScreenTop(vp));
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
const _ptRayPt = { x: 0, y: 0, z: 0 }, _ptAnchorPt = { x: 0, y: 0, z: 0 };

const _fpInv = M4.create(), _fpNa = { x: 0, y: 0, z: 0 }, _fpNb = { x: 0, y: 0, z: 0 };
/**
 * World point under a normalised screen point on the plane z = depth.
 * Perspective-exact: the blade lands WHERE THE POINTER LOOKS at its own
 * depth. The old linear screen→metre map drifted 0.2–0.4 m from the finger
 * on the wings and at deep, high balls — outside the capture box before any
 * timing error was added, which is why on a phone returns worked only over
 * the middle of the table.
 */
function pointerPlanePoint(vp, px, py, depth, out) {
  if (!vp || !out || !Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(depth)) return null;
  if (!M4.invert(_fpInv, vp)) return null;
  const nx = px * 2 - 1, ny = 1 - py * 2;
  const un = (ndcZ, o) => {
    const x = _fpInv[0] * nx + _fpInv[4] * ny + _fpInv[8] * ndcZ + _fpInv[12];
    const y = _fpInv[1] * nx + _fpInv[5] * ny + _fpInv[9] * ndcZ + _fpInv[13];
    const z = _fpInv[2] * nx + _fpInv[6] * ny + _fpInv[10] * ndcZ + _fpInv[14];
    const w = _fpInv[3] * nx + _fpInv[7] * ny + _fpInv[11] * ndcZ + _fpInv[15];
    if (Math.abs(w) < 1e-9) return false;
    o.x = x / w; o.y = y / w; o.z = z / w;
    return Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z);
  };
  if (!un(-1, _fpNa) || !un(1, _fpNb)) return null;
  const dz = _fpNb.z - _fpNa.z;
  if (Math.abs(dz) < 1e-6) return null;
  const t = (depth - _fpNa.z) / dz;
  if (!(t > 0)) return null;
  out.x = _fpNa.x + (_fpNb.x - _fpNa.x) * t;
  out.y = _fpNa.y + (_fpNb.y - _fpNa.y) * t;
  out.z = depth;
  return out;
}

/**
 * @param px,py   pointer in normalised screen space (0..1, y down)
 * @param stanceY the y the hand landed at — it sets how deep you stand,
 *                so flicking the wrist upward cannot lunge you over the table
 * @param sens    the player's sensitivity multiplier
 * @param opts.vp current view·proj: enables the perspective-correct map
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
  // Depth is anchored at PADDLE_HOME (the realistic stance main moved us to)
  // and spans it by ±0.43 m — sy 0.21 lands at zNear 1.45, sy 0.655 at the
  // deepest back swing. The perspective map needs the exact same contract as
  // the linear fallback, or the two paths disagree about where the bat lives.
  const tz = clamp(1.78 + clamp(sy - 0.55, -0.34, 0.45) * 0.96 * (0.6 + 0.4 * s),
    zNear, PADDLE_LIMITS.zFar);
  const vp = opts && opts.vp;
  const _pp = _ptRayPt, _pa = _ptAnchorPt;
  if (vp && pointerPlanePoint(vp, x, y, tz, _pp) && pointerPlanePoint(vp, 0.5, 0.5, tz, _pa)) {
    o.tx = clamp(_pa.x + (_pp.x - _pa.x) * s, -PADDLE_LIMITS.x, PADDLE_LIMITS.x);
    o.ty = clamp(_pa.y + (_pp.y - _pa.y) * s,
      PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi);
    o.tz = tz; o.zNear = zNear;
    return o;
  }
  // Mobile fallback: the expanded vertical range from main keeps high lobs
  // and low chops reachable even when the view matrix isn't ready yet.
  o.tx = (x - 0.5) * 2 * PADDLE_LIMITS.x * s;
  o.ty = PH.TABLE_Y + 0.62 - (y - 0.18) * 1.10 * s;
  o.tz = tz;
  o.tx = clamp(o.tx, -PADDLE_LIMITS.x, PADDLE_LIMITS.x);
  o.ty = clamp(o.ty, PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi);
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

const PADDLE_HOME = { x: 0, y: PH.TABLE_Y + 0.62, z: 1.78 };

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
