/* =====================================================================
 *  UNIFIED MATCH RULES & CONTACT CORRIDOR REGISTRATION ENGINE (v4+)
 *
 *  Preserves the frozen v4 rule contract (`MATCH_RULES`, `GRACE_RULES`,
 *  `PRESS_REJECTION_REASONS`) while completely upgrading the runtime
 *  touch/click/contact registration pipeline with:
 *    - `CONTACT_CORRIDOR_RULES` — multi-anchor 3D post-bounce strike corridor
 *    - `solveStrikeCorridor()`  — traces the incoming ball's full legal
 *      post-bounce flight (`current`, `early`, `sweet`, `apex`, `stance`,
 *      `deep`) + computes optimal auto-footwork depth `footZ`
 *    - `evaluateContactZone()`  — evaluates both multi-anchor contact ovals
 *      AND continuous 2D trajectory-polyline segments, clamping off-screen
 *      meeting points on BOTH X and Y and protecting portrait scale floors
 *    - `canArmEarlyServeSwipe()` — preserves early serve swipes started in
 *      `SERVE_READY` or rising `SERVE_TOSS` until the toss crests its apex
 *    - `evaluateStrokeDirection()` — pixel-consistent biomechanically valid
 *      stroke direction check
 *    - `bladePlaneCapture()`    — continuous swept 3D capture in the local
 *      blade-face coordinate frame
 * ===================================================================== */
'use strict';

let CAPTURE_FORGIVE = 1;
function setCaptureForgiveness(k) { CAPTURE_FORGIVE = (Number.isFinite(k) && k > 0) ? k : 1; }
function getCaptureForgiveness() { return CAPTURE_FORGIVE; }

const MATCH_RULES = Object.freeze(Object.assign({
  version: 4,
  zoneShape: 'oval',           // 'circle' keeps pressHitZone for A/B comparison
  pressRadiusPx: 96,           // legacy circle admission for real pointer-down events
  ovalLeadSec: .16,            // how far ahead of the ball a backswing may start
  ovalForwardPx: 24,           // fixed forward allowance, CSS px
  ovalForwardMaxPx: 120,       // hard cap on the forward half-axis, CSS px (simulator-selected)
  ovalBackPx: 18,              // allowance behind the ball, CSS px
  ovalSideMousePx: 44,         // transverse allowance for a mouse press
  ovalSideTouchPx: 60,         // transverse allowance for touch/pen (finger occludes the ball)
  ovalMinSpeedPx: 8,           // circle below this screen speed
  ovalFullSpeedPx: 120,        // full oval at/above this screen speed; smoothstep between
  ovalSampleDtSec: .05,        // projection interval for screen velocity
  serveTossMinRise: .16,       // ITTF minimum toss rise, metres above release
  trajectoryAssist: .85,
  positionAssist: .85,
  sensitivity: 1,
  captureRadius: .22,          // v3: blade + finger forgiveness
  depthTolerance: .22,         // v3: auto-footwork puts the blade at the ball's depth
  serveCaptureRadius: .55,     // falling toss capture radius
  sweetRadius: .15225,         // contact-quality reference, NOT capture radius
  timingMinPx: 8,
  timingMaxPx: 20,
  timingHorizon: .44,
  contactAtClosest: true,      // endpoint contact at closest approach, not on entry into box
  zoneAnchor: 'contact',       // 'ball' | 'contact'
  contactForwardPx: 150,       // contact gate: how far BELOW the meeting point an upward swipe may start
  contactBackPx: 120,          // contact gate: how far ABOVE it a downward push/chop may start
  contactSideTouchPx: 64,      // contact gate half-width, finger
  contactSideMousePx: 46,      // contact gate half-width, mouse
  zoneScale: 'world',          // 'world' | 'px'
  zoneRefPxPerCmX: 2.94,
  zoneRefPxPerCmY: 2.39,
  zoneScaleMin: .75, zoneScaleMax: 1.5,
  contactMinSideTouchPx: 52, contactMinSideMousePx: 38, contactMinAlongPx: 70,
  contactEdgePx: 20,           // off-screen meeting point clamped on both X and Y
  magnet: 0,
  magnetRadius: 0,
  magnetHorizon: .45,
  autoFootwork: true,          // bat DEPTH follows the ball's best post-bounce hitting point
  footworkHeight: .40,         // m above table: ideal descending contact height
}, (typeof globalThis !== 'undefined' && globalThis.__TT_RULES) || {}));

const GRACE_RULES = Object.freeze({
  bandMul: 1.34,
  serveBandMul: 1.36,
  depthMul: 1.75,
  padVelK: 0.42,
  minCarryMs: 2.6,
  maxCarryMs: 6.2,
  upNormal: 0.42,
  fwdNormal: 0.90,
  scatterYawRad: 0.11,
  scatterPitchRad: 0.06,
  scatterSpin: 85,
  quality: 0.30,
  serveLiftMs: [1.55, 2.6],
  serveSpeedMs: [1.3, 3.0],
  serveCounterAim: 0.9,
  serveSideK: 1.30,
  serveFwdK: 1.15,
});

const CONTACT_CORRIDOR_RULES = Object.freeze({
  horizonSec: 1.65,
  sampleDtSec: 1 / 240,
  minStepInZ: 1.02,
  maxReachZ: 2.38,
  stanceZ: 1.78,
  minClearanceY: 0.015,
  maxReachY: 0.92,
  portraitFloorY: 0.92,
  compactFlickMinPx: 14,
  compactFlickMaxPx: 42,
  compactFlickMaxSec: 0.38,
  tapContactRadiusPx: 36,       // immediate tap; the larger oval still admits swipe backswings
  strokeAnchorWindowSec: 0.34,
  strokeReleaseWindowSec: 0.85,
  serveEarlyAlignTouchPx: 96,
  serveEarlyAlignMousePx: 74,
});

const PRESS_REJECTION_REASONS = Object.freeze([
  'OUTSIDE_ZONE', 'NO_FRESH_SWIPE', 'STATIC_CLICK', 'DEPTH_FAIL', 'TIMING_LATE',
  'TIMING_EARLY', 'CONSUMED', 'SERVE_TOSS_LOW', 'WRONG_DIRECTION', 'BOUNCE_ILLEGAL',
]);

function installUnifiedControls(settings) {
  const fixed = { hitZone: .85, assist: MATCH_RULES.trajectoryAssist,
    posAssist: MATCH_RULES.positionAssist, sensitivity: MATCH_RULES.sensitivity, showZone: true };
  for (const [key, value] of Object.entries(fixed)) {
    const desc = Object.getOwnPropertyDescriptor(settings, key);
    if (desc && desc.configurable === false) continue;
    Object.defineProperty(settings, key, { configurable: false, enumerable: false,
      get() { return value; }, set(_ignored) {} });
  }
  return settings;
}

/* =====================================================================
 *  1. 3D CAPTURE, GRACE RING & SWEPT BLADE-PLANE GEOMETRY
 * ===================================================================== */

function playerCaptureLimits(isServe) {
  return {
    radius: (isServe ? MATCH_RULES.serveCaptureRadius : MATCH_RULES.captureRadius) * CAPTURE_FORGIVE,
    depth: MATCH_RULES.depthTolerance * CAPTURE_FORGIVE,
    sweet: MATCH_RULES.sweetRadius,
  };
}

function playerInCaptureRange(ball, paddle, isServe = false) {
  if (!ball || !paddle || ![ball.x, ball.y, ball.z, paddle.x, paddle.y, paddle.z].every(Number.isFinite)) return false;
  const dx = ball.x - paddle.x, dy = ball.y - paddle.y, dz = ball.z - paddle.z;
  return isServe
    ? Math.hypot(dx, dy, dz) <= MATCH_RULES.serveCaptureRadius * CAPTURE_FORGIVE
    : Math.hypot(dx, dy) <= MATCH_RULES.captureRadius * CAPTURE_FORGIVE
      && Math.abs(dz) <= MATCH_RULES.depthTolerance * CAPTURE_FORGIVE;
}

function playerGraceRange(ball, paddle, isServe = false) {
  if (!ball || !paddle || ![ball.x, ball.y, ball.z, paddle.x, paddle.y, paddle.z].every(Number.isFinite)) return false;
  if (playerInCaptureRange(ball, paddle, isServe)) return false;
  const dx = ball.x - paddle.x, dy = ball.y - paddle.y, dz = ball.z - paddle.z;
  return isServe
    ? Math.hypot(dx, dy, dz) <= MATCH_RULES.serveCaptureRadius * CAPTURE_FORGIVE * GRACE_RULES.serveBandMul
    : Math.hypot(dx, dy) <= MATCH_RULES.captureRadius * CAPTURE_FORGIVE * GRACE_RULES.bandMul
      && Math.abs(dz) <= MATCH_RULES.depthTolerance * CAPTURE_FORGIVE * GRACE_RULES.depthMul;
}

/**
 * Continuous swept 3D capture check between `[ballPrev -> ballPos]` and
 * `[padPrev -> padPos]`, evaluated in BOTH world XY/Z and the tilted blade's
 * oriented plane (`padNormal`). Prevents fast substeps and angled loops from
 * slipping through discrete frame samples.
 */
function bladePlaneCapture(ballPos, ballPrev, padPos, padPrev, padNormal, isServe = false) {
  if (!ballPos || !padPos) return { ok: false, grace: false, t: 1, lat: Infinity, dz: Infinity, point: ballPos };
  const b0 = (ballPrev && Number.isFinite(ballPrev.x)) ? ballPrev : ballPos;
  const p0 = (padPrev && Number.isFinite(padPrev.x)) ? padPrev : padPos;
  const rx0 = b0.x - p0.x, ry0 = b0.y - p0.y, rz0 = b0.z - p0.z;
  const rx1 = ballPos.x - padPos.x, ry1 = ballPos.y - padPos.y, rz1 = ballPos.z - padPos.z;
  const dvx = rx1 - rx0, dvy = ry1 - ry0, dvz = rz1 - rz0;
  const d2 = dvx * dvx + dvy * dvy + dvz * dvz;
  const tStar = d2 > 1e-8 ? clamp(-(rx0 * dvx + ry0 * dvy + rz0 * dvz) / d2, 0, 1) : 1;
  const cx = rx0 + dvx * tStar, cy = ry0 + dvy * tStar, cz = rz0 + dvz * tStar;

  const lim = playerCaptureLimits(isServe);
  let faceDist = Math.abs(cz);
  let inPlane = Math.hypot(cx, cy);
  if (padNormal && Number.isFinite(padNormal.x)) {
    const nLen = Math.hypot(padNormal.x, padNormal.y, padNormal.z);
    if (nLen > 1e-5) {
      const nx = padNormal.x / nLen, ny = padNormal.y / nLen, nz = padNormal.z / nLen;
      const dn = cx * nx + cy * ny + cz * nz;
      faceDist = Math.abs(dn);
      const tx = cx - dn * nx, ty = cy - dn * ny, tz = cz - dn * nz;
      inPlane = Math.hypot(tx, ty, tz);
    }
  }
  const d3 = Math.hypot(cx, cy, cz);
  const lat = Math.min(Math.hypot(cx, cy), inPlane);
  const dzEff = Math.min(Math.abs(cz), faceDist);
  const ok = isServe ? d3 <= lim.radius : (lat <= lim.radius && dzEff <= lim.depth);
  const grace = !ok && (isServe
    ? d3 <= lim.radius * GRACE_RULES.serveBandMul
    : (lat <= lim.radius * GRACE_RULES.bandMul && dzEff <= lim.depth * GRACE_RULES.depthMul));
  return {
    ok,
    grace,
    t: tStar,
    lat,
    dz: cz,
    dzEff,
    d3,
    point: {
      x: lerp(b0.x, ballPos.x, tStar),
      y: lerp(b0.y, ballPos.y, tStar),
      z: lerp(b0.z, ballPos.z, tStar),
    },
    padPoint: {
      x: lerp(p0.x, padPos.x, tStar),
      y: lerp(p0.y, padPos.y, tStar),
      z: lerp(p0.z, padPos.z, tStar),
    },
  };
}

function strikeCueModel(window) {
  if (!window || !window.on || !['rally', 'serve'].includes(window.kind) || !Number.isFinite(window.t)
      || !Number.isFinite(window.k) || !Number.isFinite(window.ready)
      || window.t > MATCH_RULES.timingHorizon || window.k < .02) return null;
  const hot = window.contactable === true && window.ready > .82;
  return { radius: MATCH_RULES.timingMinPx + Math.min(1, Math.max(0, window.t / MATCH_RULES.timingHorizon))
      * (MATCH_RULES.timingMaxPx - MATCH_RULES.timingMinPx),
    hot, dashed: !hot, alpha: Math.min(1, Math.max(0, window.k)) * (hot ? .9 : .5) };
}

function ballCaptureTarget(paddle, ball, serving = false) {
  if (!paddle || !paddle.pos || !ball || ![paddle.pos.x, paddle.pos.y, paddle.pos.z, ball.x, ball.y, ball.z].every(Number.isFinite)) return null;
  const limits = playerCaptureLimits(serving), dz = ball.z - paddle.pos.z;
  const depth = serving ? limits.radius : limits.depth, depthOk = Math.abs(dz) <= depth;
  const radius = serving ? Math.sqrt(Math.max(0, limits.radius ** 2 - dz ** 2)) : limits.radius;
  const center = { x: ball.x, y: ball.y, z: paddle.pos.z }, points = [];
  if (depthOk) for (let i = 0; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2;
    points.push({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius, z: center.z });
  }
  return { center, points, radius, limitRadius: limits.radius, depth, depthGap: Math.abs(dz), depthOk,
    inside: playerInCaptureRange(ball, paddle.pos, serving), serving };
}

function measureCaptureAllowance(paddle, p0, p1, serving, endpointEligible) {
  const p = paddle.pos, n = paddle.normal, previous = paddle.prevPos;
  if (!p || !n || !previous || !p0 || !p1 ||
      ![p.x, p.y, p.z, n.x, n.y, n.z, previous.x, previous.y, previous.z, p0.x, p0.y, p0.z, p1.x, p1.y, p1.z].every(Number.isFinite)) return null;
  const limits = playerCaptureLimits(serving), dx = p1.x - p.x, dy = p1.y - p.y, dz = p1.z - p.z;
  const lateral = Math.hypot(dx, dy), distance = Math.hypot(dx, dy, dz);
  const endpointRadius = endpointEligible && (serving || Math.abs(dz) <= limits.depth) ? (serving ? distance : lateral) : null;
  const d0 = (p0.x - previous.x) * n.x + (p0.y - previous.y) * n.y + (p0.z - previous.z) * n.z;
  const d1 = dx * n.x + dy * n.y + dz * n.z;
  let ccdRadius = null;
  if (d0 > PH.R && d1 <= PH.R) {
    const t = Math.max(0, Math.min(1, (d0 - PH.R) / Math.max(d0 - d1, 1e-9)));
    const ex = p0.x + (p1.x - p0.x) * t - (previous.x + (p.x - previous.x) * t);
    const ey = p0.y + (p1.y - p0.y) * t - (previous.y + (p.y - previous.y) * t);
    const ez = p0.z + (p1.z - p0.z) * t - (previous.z + (p.z - previous.z) * t);
    const dn = ex * n.x + ey * n.y + ez * n.z;
    ccdRadius = Math.hypot(ex - n.x * dn, ey - n.y * dn, ez - n.z * dn);
  }
  const candidates = [endpointRadius, ccdRadius].filter(Number.isFinite);
  return { serving: !!serving, radius: limits.radius, depthLimit: limits.depth,
    lateral, depthGap: Math.abs(dz), distance, endpointEligible: !!endpointEligible,
    endpointRadius, ccdRadius, requiredRadius: candidates.length ? Math.min(...candidates) : null,
    score: serving ? distance / limits.radius : Math.max(lateral / limits.radius, Math.abs(dz) / limits.depth) };
}

/* =====================================================================
 *  2. SCREEN-SPACE PRESS OVALS & CONTACT PLANE GATE
 * ===================================================================== */

function pressHitZone(ballScreen, pointer, width, height, radius = MATCH_RULES.pressRadiusPx) {
  if (!ballScreen || !ballScreen.ok || !pointer || ![ballScreen.x, ballScreen.y, pointer.x, pointer.y, width, height, radius].every(Number.isFinite) || width <= 0 || height <= 0 || radius <= 0) return null;
  const x = ballScreen.x * width, y = ballScreen.y * height;
  const distancePx = Math.hypot(pointer.x * width - x, pointer.y * height - y);
  const accepted = distancePx <= radius;
  return { x, y, radius, distancePx, pointerX: pointer.x * width, pointerY: pointer.y * height, accepted,
    shape: 'circle', score: distancePx / radius, along: null, across: null,
    reason: accepted ? null : 'OUTSIDE_ZONE' };
}

function pressOvalSidePx(pointerType, opts = {}) {
  if (Number.isFinite(opts.sidePx) && opts.sidePx > 0) return opts.sidePx;
  return pointerType === 'mouse' ? MATCH_RULES.ovalSideMousePx : MATCH_RULES.ovalSideTouchPx;
}

function serveTossRise(tossApex, tossStartY, tableY) {
  const start = Number.isFinite(tossStartY) ? tossStartY
    : Number.isFinite(tableY) ? tableY + .14 : NaN;
  return Number.isFinite(tossApex) && Number.isFinite(start) ? tossApex - start : NaN;
}

function pressOvalSmoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function pressOvalReferenceAxis(center, width, height, opts, projectWorldPoint) {
  const fromVector = (x, y) => {
    const len = Math.hypot(x, y);
    return len > 1e-9 ? { x: x / len, y: y / len } : null;
  };
  const axisPx = opts.referenceAxisPx || opts.referenceAxis;
  if (axisPx && [axisPx.x, axisPx.y].every(Number.isFinite)) {
    const axis = fromVector(axisPx.x, axisPx.y);
    if (axis) return axis;
  }
  const referenceWorld = opts.referenceWorld || opts.referencePoint || opts.racketWorld || opts.playerWorld;
  if (referenceWorld && [referenceWorld.x, referenceWorld.y, referenceWorld.z].every(Number.isFinite) &&
      typeof projectWorldPoint === 'function') {
    const p = projectWorldPoint(referenceWorld);
    if (p && [p.x, p.y].every(Number.isFinite)) {
      const axis = fromVector(p.x - center.x, p.y - center.y);
      if (axis) return axis;
    }
  }
  const referencePx = opts.referencePx || opts.racketPx || opts.playerPx;
  if (referencePx && [referencePx.x, referencePx.y].every(Number.isFinite)) {
    const axis = fromVector(referencePx.x - center.x, referencePx.y - center.y);
    if (axis) return axis;
  }
  const referenceScreen = opts.referenceScreen || opts.racketScreen || opts.playerScreen;
  if (referenceScreen && [referenceScreen.x, referenceScreen.y].every(Number.isFinite)) {
    const axis = fromVector(referenceScreen.x * width - center.x,
      referenceScreen.y * height - center.y);
    if (axis) return axis;
  }
  return { x: 0, y: 1 };
}

function pressOvalBlendAxis(reference, velocityAxis, blend) {
  if (!(blend > 0)) return reference;
  if (blend >= 1) return velocityAxis;
  const dot = Math.min(1, Math.max(-1, reference.x * velocityAxis.x + reference.y * velocityAxis.y));
  const angle = Math.acos(dot), step = angle * blend;
  let px = velocityAxis.x - reference.x * dot, py = velocityAxis.y - reference.y * dot;
  const plen = Math.hypot(px, py);
  if (plen <= 1e-9) { px = -reference.y; py = reference.x; }
  else { px /= plen; py /= plen; }
  const co = Math.cos(step), si = Math.sin(step);
  return { x: reference.x * co + px * si, y: reference.y * co + py * si };
}

function pressHitZoneOval(ball, pointer, width, height, opts = {}) {
  if (!ball || !pointer || ![pointer.x, pointer.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  if (opts.kind === 'serve') {
    opts = { ...opts,
      sidePx: (Number.isFinite(opts.sidePx) && opts.sidePx > 0 ? opts.sidePx
        : pressOvalSidePx(opts.pointerType || opts.inputType || 'touch', opts)) * GRACE_RULES.serveSideK,
      fwdPx: (Number.isFinite(opts.fwdPx) && opts.fwdPx > 0 ? opts.fwdPx : MATCH_RULES.ovalForwardPx) * GRACE_RULES.serveFwdK,
      forwardMaxPx: (Number.isFinite(opts.forwardMaxPx) && opts.forwardMaxPx > 0
        ? opts.forwardMaxPx : MATCH_RULES.ovalForwardMaxPx) * GRACE_RULES.serveFwdK };
  }
  const lead = Number.isFinite(opts.leadSec) && opts.leadSec > 0 ? opts.leadSec : MATCH_RULES.ovalLeadSec;
  const fwdPx = Number.isFinite(opts.fwdPx) && opts.fwdPx > 0 ? opts.fwdPx : MATCH_RULES.ovalForwardPx;
  const forwardMaxPx = Number.isFinite(opts.forwardMaxPx) && opts.forwardMaxPx > 0
    ? opts.forwardMaxPx : MATCH_RULES.ovalForwardMaxPx;
  const backPx = Number.isFinite(opts.backPx) && opts.backPx > 0 ? opts.backPx : MATCH_RULES.ovalBackPx;
  const pointerType = opts.pointerType || opts.inputType || 'touch';
  const sidePx = pressOvalSidePx(pointerType, opts);
  if (!(lead > 0) || !(fwdPx > 0) || !(forwardMaxPx > 0) || !(backPx > 0) || !(sidePx > 0)) return null;

  let center = null, screenVx = 0, screenVy = 0, worldVelocity = null;
  let projectWorldPoint = null;
  const pos = ball.p && [ball.p.x, ball.p.y, ball.p.z].every(Number.isFinite) ? ball.p
    : [ball.x, ball.y, ball.z].every(Number.isFinite) ? ball : null;
  if (pos && typeof opts.project === 'function') {
    worldVelocity = ball.v && [ball.v.x, ball.v.y, ball.v.z].every(Number.isFinite) ? ball.v
      : opts.velocity && [opts.velocity.x, opts.velocity.y, opts.velocity.z].every(Number.isFinite) ? opts.velocity : null;
    if (!worldVelocity) return null;
    const dt = Number.isFinite(opts.sampleDtSec) && opts.sampleDtSec > 0
      ? Math.min(.25, opts.sampleDtSec) : MATCH_RULES.ovalSampleDtSec;
    const a0 = opts.project({ x: pos.x, y: pos.y, z: pos.z });
    if (!a0 || !a0.ok || ![a0.x, a0.y].every(Number.isFinite)) return null;
    const ax = a0.x, ay = a0.y;
    const a1 = opts.project({ x: pos.x + worldVelocity.x * dt,
      y: pos.y + worldVelocity.y * dt, z: pos.z + worldVelocity.z * dt });
    if (!a1 || !a1.ok || ![a1.x, a1.y].every(Number.isFinite)) return null;
    center = { x: ax * width, y: ay * height };
    screenVx = (a1.x - ax) * width / dt;
    screenVy = (a1.y - ay) * height / dt;
    projectWorldPoint = (p) => {
      const q = opts.project({ x: p.x, y: p.y, z: p.z });
      return q && q.ok && [q.x, q.y].every(Number.isFinite)
        ? { x: q.x * width, y: q.y * height } : null;
    };
  } else if (ball.ok && [ball.x, ball.y].every(Number.isFinite)) {
    center = { x: ball.x * width, y: ball.y * height };
    const sv = opts.screenVelocityPx || opts.screenVelocity || ball.screenVelocityPx || ball.screenVelocity;
    if (sv) {
      if (![sv.x, sv.y].every(Number.isFinite)) return null;
      const inPx = !!opts.screenVelocityPx || !!ball.screenVelocityPx;
      screenVx = inPx ? sv.x : sv.x * width;
      screenVy = inPx ? sv.y : sv.y * height;
    }
    worldVelocity = ball.v && [ball.v.x, ball.v.y, ball.v.z].every(Number.isFinite) ? ball.v : opts.velocity || null;
    if (typeof opts.project === 'function') projectWorldPoint = (p) => {
      const q = opts.project({ x: p.x, y: p.y, z: p.z });
      return q && q.ok && [q.x, q.y].every(Number.isFinite)
        ? { x: q.x * width, y: q.y * height } : null;
    };
  } else return null;
  if (![screenVx, screenVy].every(Number.isFinite)) return null;

  // Clamp off-screen centers on BOTH X and Y when edgePx > 0
  const edgePx = Number.isFinite(opts.edgePx) ? Math.max(0, opts.edgePx) : 0;
  if (edgePx > 0) {
    if (width > edgePx * 2) center.x = Math.min(width - edgePx, Math.max(edgePx, center.x));
    if (height > edgePx * 2) center.y = Math.min(height - edgePx, Math.max(edgePx, center.y));
  }

  const pointerX = pointer.x * width, pointerY = pointer.y * height;
  const dx = pointerX - center.x, dy = pointerY - center.y;
  const distancePx = Math.hypot(dx, dy);
  const speedPx = Math.hypot(screenVx, screenVy);
  const referenceAxis = pressOvalReferenceAxis(center, width, height, opts, projectWorldPoint);
  const velocityAxis = speedPx > 1e-9
    ? { x: screenVx / speedPx, y: screenVy / speedPx } : referenceAxis;
  const minSpeedPx = MATCH_RULES.ovalMinSpeedPx;
  const fullSpeedPx = Math.max(minSpeedPx + 1e-9, MATCH_RULES.ovalFullSpeedPx);
  const blend = pressOvalSmoothstep((speedPx - minSpeedPx) / (fullSpeedPx - minSpeedPx));
  const still = pressOvalSmoothstep(1 - speedPx / (minSpeedPx * 4));
  const blendEff = Math.max(blend, still);
  const axis = still >= blend ? referenceAxis
    : pressOvalBlendAxis(referenceAxis, velocityAxis, blend);
  const axisX = axis.x, axisY = axis.y;
  const along = dx * axisX + dy * axisY;
  const across = -dx * axisY + dy * axisX;
  const uncappedForwardPx = speedPx * lead + fwdPx;
  const cappedForwardPx = Math.min(forwardMaxPx, Math.max(uncappedForwardPx, forwardMaxPx * still));
  const forwardExtent = still >= blend
    ? sidePx + (cappedForwardPx - sidePx) * blendEff
    : sidePx + (cappedForwardPx - sidePx) * blend;
  const backExtent = still >= blend
    ? sidePx + (backPx - sidePx) * blendEff
    : sidePx + (backPx - sidePx) * blend;
  const longNorm = along >= 0 ? along / forwardExtent : -along / backExtent;
  const score = Math.hypot(longNorm, across / sidePx);
  let accepted = score <= 1, reason = accepted ? null : 'OUTSIDE_ZONE';
  let directionDot = null, directionOk = null;
  const swipe = opts.swipe || opts.swipeDirection;
  if (swipe && [swipe.x, swipe.y].every(Number.isFinite)) {
    const sl = Math.hypot(swipe.x, swipe.y);
    if (sl > 1e-9) {
      directionDot = distancePx > 1e-9 ? -(swipe.x * dx + swipe.y * dy) / (sl * distancePx) : 1;
      const dotLimit = opts.pointerType === 'mouse' ? -0.3 : 0;
      directionOk = directionDot > dotLimit;
      if (accepted && !directionOk) { accepted = false; reason = 'WRONG_DIRECTION'; }
    }
  }
  if (opts.kind === 'serve' && accepted) {
    const falling = typeof opts.falling === 'boolean' ? opts.falling
      : worldVelocity ? worldVelocity.y < 0 : screenVy > 0;
    const rise = Number.isFinite(opts.tossRise) ? opts.tossRise
      : serveTossRise(opts.tossApex, opts.tossStartY, opts.tableY);
    if (!falling || !(rise >= MATCH_RULES.serveTossMinRise - 1e-6)) { accepted = false; reason = 'SERVE_TOSS_LOW'; }
  }
  return { x: center.x, y: center.y, radius: Math.max(forwardExtent, backExtent, sidePx),
    distancePx, pointerX, pointerY, accepted, shape: blendEff > 0 ? 'oval' : 'circle',
    score, along, across, reason, directionDot, directionOk,
    axisX, axisY, referenceAxisX: referenceAxis.x, referenceAxisY: referenceAxis.y,
    velocityAxisX: velocityAxis.x, velocityAxisY: velocityAxis.y, blend,
    screenVx, screenVy, speedPx, blendEff, leadSec: lead,
    fwdPx: forwardExtent, uncappedForwardPx, forwardMaxPx,
    backPx: backExtent, sidePx, pointerType,
    pressX: pointer.x, pressY: pointer.y, vw: width, vh: height,
    kind: opts.kind === 'serve' ? 'serve' : 'rally' };
}

function pressServeZoneOval(ball, pointer, width, height, opts = {}) {
  return pressHitZoneOval(ball, pointer, width, height, {
    edgePx: opts.edgePx ?? MATCH_RULES.contactEdgePx,
    ...opts,
    kind: 'serve',
  });
}

function contactGateExtents(pointerType, scale, width, height) {
  const mouse = (pointerType || 'touch') === 'mouse', R = MATCH_RULES;
  const world = R.zoneScale === 'world' && scale && Number.isFinite(scale.kx) && Number.isFinite(scale.ky);
  const portrait = Number.isFinite(width) && Number.isFinite(height) && height > width * 1.05;
  const limX = (k) => Math.min(R.zoneScaleMax || 1.5, Math.max(R.zoneScaleMin || .75, k));
  const minKy = portrait ? Math.max(R.zoneScaleMin || .75, CONTACT_CORRIDOR_RULES.portraitFloorY) : (R.zoneScaleMin || .75);
  const limY = (k) => Math.min(R.zoneScaleMax || 1.5, Math.max(minKy, k));
  const kx = world ? limX(scale.kx) : 1, ky = world ? limY(scale.ky) : 1;
  const minSide = (mouse ? R.contactMinSideMousePx : R.contactMinSideTouchPx) || 0;
  const minAlong = R.contactMinAlongPx || 0;
  return { kx, ky,
    sidePx: Math.max(minSide, (mouse ? R.contactSideMousePx : R.contactSideTouchPx) * kx),
    fwdPx: Math.max(minAlong, R.contactForwardPx * ky),
    backPx: R.contactBackPx > 0 ? Math.max(Math.min(minAlong, R.contactBackPx), R.contactBackPx * ky) : 1e-3 };
}

function pressContactZone(contactScreen, pointer, width, height, opts = {}) {
  if (!contactScreen || !contactScreen.ok || !(width > 0) || !(height > 0)) return null;
  const ext = contactGateExtents(opts.pointerType, opts.scale, width, height);
  // Clamp off-screen meeting points on BOTH X and Y so top lobs & low drops remain reachable on glass
  let cx = contactScreen.x, cy = contactScreen.y, clamped = false;
  const ex = (MATCH_RULES.contactEdgePx || 0) / width;
  const ey = (MATCH_RULES.contactEdgePx || 0) / height;
  if (ex > 0 && ex < 0.45 && Number.isFinite(cx) && (cx < ex || cx > 1 - ex)) {
    cx = Math.min(1 - ex, Math.max(ex, cx)); clamped = true;
  }
  if (ey > 0 && ey < 0.45 && Number.isFinite(cy) && (cy < ey || cy > 1 - ey)) {
    cy = Math.min(1 - ey, Math.max(ey, cy)); clamped = true;
  }
  const z = pressHitZoneOval({ x: cx, y: cy, ok: true }, pointer, width, height, {
    ...opts, screenVelocityPx: { x: 0, y: 1000 }, leadSec: 1e-6,
    fwdPx: ext.fwdPx, forwardMaxPx: ext.fwdPx, backPx: ext.backPx, sidePx: ext.sidePx,
  });
  if (z) { z.anchor = 'contact'; z.kx = ext.kx; z.ky = ext.ky; z.edgeClamped = clamped; }
  return z;
}

function pressZoneForBall(ball, pointer, width, height, opts = {}) {
  const shape = opts.shape || MATCH_RULES.zoneShape;
  if (shape === 'oval') {
    return opts.kind === 'serve' ? pressServeZoneOval(ball, pointer, width, height, opts)
      : pressHitZoneOval(ball, pointer, width, height, opts);
  }
  const screen = ball && ball.ok ? ball
    : typeof opts.project === 'function' ? opts.project(ball && ball.p ? ball.p : ball) : null;
  return screen ? pressHitZone(screen, pointer, width, height,
    Number.isFinite(opts.radius) ? opts.radius : MATCH_RULES.pressRadiusPx) : null;
}

/* =====================================================================
 *  3. MULTI-ANCHOR 3D STRIKE CORRIDOR & CONTACT REGISTRATION ENGINE
 * ===================================================================== */

/**
 * Trace the incoming ball's 3D path and extract the legal post-bounce strike
 * corridor on the player's side (`z > 0`), together with physical anchors:
 *   - `current`: live ball position if already post-bounce & reachable
 *   - `early`:   rising/counter-hit right after the player-half bounce
 *   - `sweet`:   post-bounce sweet spot around `MATCH_RULES.footworkHeight`
 *   - `apex`:    highest post-bounce point
 *   - `stance`:  crossing of `PADDLE_STANCE_Z` (`1.78 m`)
 *   - `deep`:    deep baseline loop intercept (`z ~ 2.00..2.35 m`)
 */
function solveStrikeCorridor(ball, pad, rallyBounces, predictFn, opts = {}) {
  const empty = { valid: false, bouncedAlready: false, anchors: [], samples: [], primary: null, footZ: null };
  if (!ball || !ball.live || typeof predictFn !== 'function') return empty;
  const incoming = ball.lastHitBy === -1 && (ball.v.z > 0.08 || (ball.p.z > 0.15 && ball.v.z > -0.35));
  if (!incoming && !opts.force) return empty;

  const tableY = Number.isFinite(opts.tableY) ? opts.tableY : (typeof PH !== 'undefined' ? PH.TABLE_Y : 0.76);
  const minZ = opts.minStepInZ ?? CONTACT_CORRIDOR_RULES.minStepInZ;
  const maxZ = opts.maxReachZ ?? CONTACT_CORRIDOR_RULES.maxReachZ;
  const stanceZ = opts.stanceZ ?? CONTACT_CORRIDOR_RULES.stanceZ;
  const padZ = pad && pad.pos && Number.isFinite(pad.pos.z) ? clamp(pad.pos.z, minZ, maxZ) : stanceZ;
  const optY = tableY + (opts.footworkHeight ?? MATCH_RULES.footworkHeight);
  const minY = tableY + CONTACT_CORRIDOR_RULES.minClearanceY;
  const maxY = tableY + CONTACT_CORRIDOR_RULES.maxReachY;

  const bouncedAlready = !!(opts.allowVolley ||
    (Array.isArray(rallyBounces) && rallyBounces.some((s) => s > 0)));

  const path = [];
  const simOut = {};
  const simDt = opts.dt ?? CONTACT_CORRIDOR_RULES.sampleDtSec;
  predictFn(
    { x: ball.p.x, y: ball.p.y, z: ball.p.z },
    { x: ball.v.x, y: ball.v.y, z: ball.v.z },
    { x: ball.w.x, y: ball.w.y, z: ball.w.z },
    {
      dt: simDt,
      maxT: opts.maxT ?? CONTACT_CORRIDOR_RULES.horizonSec,
      maxPath: 1200,
      out: simOut,
      path,
    }
  );

  // Extract bounce records in both formats (predict's landed/b2/b3 OR array bounces)
  const bounceList = [];
  if (Array.isArray(simOut.bounces)) {
    for (let i = 0; i < simOut.bounces.length; i++) bounceList.push(simOut.bounces[i]);
  } else {
    if (simOut.landed) bounceList.push({ side: Math.sign(simOut.landed.z), t: simOut.landed.t });
    if (simOut.b2) bounceList.push({ side: Math.sign(simOut.b2.z), t: simOut.b2.t });
    if (simOut.b3) bounceList.push({ side: Math.sign(simOut.b3.z), t: simOut.b3.t });
  }

  let legalFromT = bouncedAlready ? 0 : Infinity;
  let secondBounceT = Infinity;
  if (!bouncedAlready) {
    let playerCount = 0;
    for (let i = 0; i < bounceList.length; i++) {
      const b = bounceList[i];
      if (b && b.side > 0) {
        playerCount++;
        if (playerCount === 1) legalFromT = b.t;
        else if (playerCount === 2) { secondBounceT = b.t; break; }
      }
    }
  } else {
    for (let i = 0; i < bounceList.length; i++) {
      if (bounceList[i] && bounceList[i].side > 0) { secondBounceT = bounceList[i].t; break; }
    }
  }

  if (!Number.isFinite(legalFromT)) return empty;

  const samples = [];
  if (bouncedAlready && ball.p.z >= minZ - 0.14 && ball.p.z <= maxZ + 0.12 &&
      ball.p.y >= minY - 0.08 && ball.p.y <= maxY + 0.28) {
    samples.push({ x: ball.p.x, y: ball.p.y, z: ball.p.z, t: 0, vy: ball.v.y });
  }
  let prevY = ball.p.y, prevT = 0;
  const flatFloats = path.length > 0 && typeof path[0] === 'number';
  const stepCount = flatFloats ? Math.floor(path.length / 3) : path.length;
  for (let i = 0; i < stepCount; i++) {
    const px = flatFloats ? path[i * 3] : path[i].x;
    const py = flatFloats ? path[i * 3 + 1] : path[i].y;
    const pz = flatFloats ? path[i * 3 + 2] : path[i].z;
    const ptT = flatFloats ? (i + 1) * simDt : path[i].t;
    const vy = ptT > prevT ? (py - prevY) / (ptT - prevT) : ball.v.y;
    prevY = py; prevT = ptT;
    if (ptT + 1e-6 < legalFromT) continue;
    if (ptT > secondBounceT + 0.02) break;
    if (pz < minZ - 0.16 || pz > maxZ + 0.14) continue;
    if (py < tableY - 0.14 || py > maxY + 0.35) continue;
    samples.push({ x: px, y: py, z: pz, t: ptT, vy });
  }

  if (!samples.length) return empty;

  let currentA = null, earlyA = null, apexA = samples[0], sweetA = null, stanceA = null, padPlaneA = null, deepA = null;
  let bestSweetCost = Infinity, bestStanceDz = Infinity, bestPadDz = Infinity;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.t === 0) currentA = { ...s, tag: 'current' };
    if (!earlyA && s.t >= legalFromT + 0.035 && s.z >= minZ - 0.04 && s.y >= minY) {
      earlyA = { ...s, tag: 'early' };
    }
    if (s.y > apexA.y) apexA = s;
    const dzStance = Math.abs(s.z - stanceZ);
    if (dzStance < bestStanceDz) { bestStanceDz = dzStance; stanceA = { ...s, tag: 'stance' }; }
    const dzPad = Math.abs(s.z - padZ);
    if (dzPad < bestPadDz) { bestPadDz = dzPad; padPlaneA = { ...s, tag: 'pad' }; }
    if (s.z >= 1.98 && s.z <= maxZ && s.y >= tableY - 0.04) {
      if (!deepA || Math.abs(s.y - (tableY + 0.28)) < Math.abs(deepA.y - (tableY + 0.28))) {
        deepA = { ...s, tag: 'deep' };
      }
    }
    const fallBonus = s.vy <= 0.15 ? 0 : 0.12;
    const heightErr = Math.abs(s.y - optY);
    const zComfort = Math.abs(clamp(s.z, minZ, 2.05) - clamp(stanceZ, minZ, 2.05)) * 0.18;
    const cost = heightErr + fallBonus + zComfort;
    if (s.z >= minZ - 0.02 && s.z <= 2.18 && s.y >= minY && cost < bestSweetCost) {
      bestSweetCost = cost;
      sweetA = { ...s, tag: 'sweet' };
    }
  }
  const apexAnchor = { ...apexA, tag: 'apex' };

  const rawAnchors = [stanceA, sweetA, padPlaneA, currentA, earlyA, apexAnchor, deepA].filter(Boolean);
  const anchors = [];
  for (let i = 0; i < rawAnchors.length; i++) {
    const a = rawAnchors[i];
    let dup = false;
    for (let j = 0; j < anchors.length; j++) {
      const b = anchors[j];
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 0.045) { dup = true; break; }
    }
    if (!dup) anchors.push(a);
  }

  const stanceGood = stanceA && bestStanceDz <= 0.08 && stanceA.y >= tableY + 0.02 && stanceA.y <= maxY + 0.12;
  const primary = (stanceGood ? stanceA : null) || sweetA || apexAnchor || earlyA || currentA || samples[0];
  const footTarget = (MATCH_RULES.autoFootwork && sweetA && (!stanceGood || sweetA.z < stanceZ - 0.12))
    ? sweetA
    : primary;
  const footZ = clamp(footTarget.z, minZ, maxZ);

  return {
    valid: true,
    bouncedAlready,
    legalFromT,
    secondBounceT,
    anchors,
    samples,
    primary: { x: primary.x, y: primary.y, z: primary.z, t: primary.t, tag: primary.tag || 'primary' },
    footZ,
  };
}

/**
 * Evaluate a rally press against ALL legal post-bounce strike anchors AND
 * continuous 2D polyline segments of the incoming flight corridor.
 */
function evaluateContactZone(corridor, ball, pointer, width, height, projectFn, scaleFn, opts = {}) {
  const vw = Math.max(1, Number.isFinite(width) ? width : 1);
  const vh = Math.max(1, Number.isFinite(height) ? height : 1);
  const pointerType = opts.pointerType || 'touch';
  const px = pointer && Number.isFinite(pointer.x) ? pointer.x : NaN;
  const py = pointer && Number.isFinite(pointer.y) ? pointer.y : NaN;

  if (!corridor || !corridor.valid || !corridor.anchors || !corridor.anchors.length) {
    const pBall = ball && ball.p && typeof projectFn === 'function' ? projectFn(ball.p, {}) : null;
    if (opts.frozen && pBall && pBall.ok) {
      const sc = typeof scaleFn === 'function' ? scaleFn(ball.p) : null;
      const z = pressContactZone(pBall, pointer, vw, vh, { ...opts, pointerType, scale: sc });
      if (z && ball && ball.p) z.worldTarget = { x: ball.p.x, y: ball.p.y, z: ball.p.z, t: 0, tag: 'frozen' };
      return z;
    }
    return pressZoneForBall(ball, pointer, vw, vh, {
      ...opts,
      pointerType,
      project: projectFn,
      referenceWorld: opts.referenceWorld,
    });
  }

  let bestZone = null;
  let bestAnchor = corridor.primary;

  for (let i = 0; i < corridor.anchors.length; i++) {
    const a = corridor.anchors[i];
    const proj = projectFn(a, {});
    if (!proj || !proj.ok) continue;
    const sc = typeof scaleFn === 'function' ? scaleFn(a) : null;
    const z = pressContactZone(proj, pointer, vw, vh, { ...opts, pointerType, scale: sc });
    if (z && (!bestZone || (Number.isFinite(z.score) && z.score < bestZone.score))) {
      bestZone = z;
      bestAnchor = a;
    }
  }

  if (Number.isFinite(px) && Number.isFinite(py) && corridor.samples && corridor.samples.length >= 2) {
    const pointerX = px * vw, pointerY = py * vh;
    const edge = opts.edgePx ?? MATCH_RULES.contactEdgePx;
    const stride = Math.max(1, Math.floor(corridor.samples.length / 18));
    let prevPt = null, prevS = null;
    for (let i = 0; i < corridor.samples.length; i += stride) {
      const s = corridor.samples[i];
      const pr = projectFn(s, {});
      if (!pr || !pr.ok) continue;
      const sx = vw > edge * 2 ? clamp(pr.x * vw, edge, vw - edge) : pr.x * vw;
      const sy = vh > edge * 2 ? clamp(pr.y * vh, edge, vh - edge) : pr.y * vh;
      if (prevPt) {
        const vx = sx - prevPt.x, vy = sy - prevPt.y;
        const len2 = vx * vx + vy * vy;
        const u = len2 > 1e-6 ? clamp(((pointerX - prevPt.x) * vx + (pointerY - prevPt.y) * vy) / len2, 0, 1) : 0;
        const midWorld = {
          x: lerp(prevS.x, s.x, u),
          y: lerp(prevS.y, s.y, u),
          z: lerp(prevS.z, s.z, u),
          t: lerp(prevS.t, s.t, u),
          tag: 'corridor',
        };
        const midProj = { ok: true, x: lerp(prevPt.x, sx, u) / vw, y: lerp(prevPt.y, sy, u) / vh };
        const sc = typeof scaleFn === 'function' ? scaleFn(midWorld) : null;
        const cz = pressContactZone(midProj, pointer, vw, vh, { ...opts, pointerType, scale: sc });
        if (cz && (!bestZone || (Number.isFinite(cz.score) && cz.score < bestZone.score))) {
          bestZone = cz;
          bestAnchor = midWorld;
        }
      }
      prevPt = { x: sx, y: sy };
      prevS = s;
    }
  }

  if (!bestZone && corridor.primary) {
    const pPrimary = projectFn(corridor.primary, {});
    const sc = typeof scaleFn === 'function' ? scaleFn(corridor.primary) : null;
    bestZone = pressContactZone(pPrimary, pointer, vw, vh, { ...opts, pointerType, scale: sc });
  }

  if (bestZone && bestAnchor) {
    bestZone.worldTarget = {
      x: bestAnchor.x,
      y: bestAnchor.y,
      z: bestAnchor.z,
      t: Number.isFinite(bestAnchor.t) ? bestAnchor.t : 0,
      tag: bestAnchor.tag || 'corridor',
    };
    bestZone.corridorFootZ = corridor.footZ;
  }
  return bestZone;
}

function canArmEarlyServeSwipe(projected, pointer, width, height, pointerType = 'touch') {
  if (!projected || !projected.ok || !pointer || !Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) {
    return false;
  }
  const vw = Math.max(1, Number.isFinite(width) ? width : 1);
  const vh = Math.max(1, Number.isFinite(height) ? height : 1);
  const edge = MATCH_RULES.contactEdgePx;
  const bx = vw > edge * 2 ? clamp(projected.x * vw, edge, vw - edge) : projected.x * vw;
  const by = vh > edge * 2 ? clamp(projected.y * vh, edge, vh - edge) : projected.y * vh;
  const px = pointer.x * vw, py = pointer.y * vh;
  const maxSide = pointerType === 'mouse'
    ? CONTACT_CORRIDOR_RULES.serveEarlyAlignMousePx
    : CONTACT_CORRIDOR_RULES.serveEarlyAlignTouchPx;
  const dx = Math.abs(px - bx);
  const dy = py - by;
  return dx <= maxSide && dy >= -140 && dy <= 240;
}

function evaluateStrokeDirection(zone, m) {
  if (!zone || !zone.accepted || !m) return true;
  if (!Number.isFinite(zone.x) || !Number.isFinite(zone.y) ||
      !Number.isFinite(zone.pointerX) || !Number.isFinite(zone.pointerY)) return true;

  const dxNorm = Number.isFinite(m.dx) ? m.dx : 0;
  const dyNorm = Number.isFinite(m.dy) ? m.dy : 0;
  const vw = Math.max(1, Number.isFinite(zone.vw) ? zone.vw : 1000);
  const vh = Math.max(1, Number.isFinite(zone.vh) ? zone.vh : 500);
  const sdx = dxNorm * vw;
  const sdy = dyNorm * vh;
  const sLen = Math.hypot(sdx, sdy);
  if (sLen < 1e-4) return true;

  if (zone.anchor === 'contact') {
    const toAnchorX = zone.x - zone.pointerX;
    if (Math.abs(toAnchorX) <= 54) return true;
    if (dyNorm < -0.05 && Math.abs(sdy) >= Math.abs(sdx) * 0.65) return true;
    return toAnchorX * sdx >= 0;
  }

  const toBallX = zone.x - zone.pointerX;
  const toBallY = zone.y - zone.pointerY;
  const distFromBall = Math.hypot(toBallX, toBallY);
  if (distFromBall <= 54) return true;
  const dot = (toBallX * sdx + toBallY * sdy) / (distFromBall * sLen);
  return dot >= -0.25;
}
