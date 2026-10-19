/* One versioned player-control contract. Not difficulty, equipment, cosmetics
 * or handedness. Distances are metres; marker sizes are CSS pixels, NOT hit
 * radii. Keep input affordance, timing and physical capture separate. */
'use strict';
const MATCH_RULES = Object.freeze({
  version: 1,
  pressRadiusPx: 72,          // screen-space admission for real pointer-down events
  /* A serve is the one moment the ball stands still in your other hand, and
   * the 72 px circle is a 144 px disc — 1.8 % of a 1280x760 screen. Measured
   * with `node tt/tools/probe_zone.js serve`: 32 of 36 screen cells were
   * rejected as "outside" while the stroke itself was a clean SERVE_TOP. The
   * gate exists so a tap in an empty corner cannot hit a moving ball; a
   * stationary toss is not that problem, so serving gets a wider disc. */
  servePressRadiusPx: 168,
  trajectoryAssist: .85,
  positionAssist: .85,
  sensitivity: 1,
  captureRadius: .50,        // realistic stance distance requires larger capture
  depthTolerance: .48,      // realistic stance distance
  serveCaptureRadius: .72,  // falling toss only; larger for realistic stance
  sweetRadius: .15225,       // contact-quality reference, NOT capture radius
  timingMinPx: 8,
  timingMaxPx: 20,
  timingHorizon: .44,
});

/** Read-only compatibility for old modules/saves. Setters deliberately ignore
 * legacy writes instead of crashing a strict-mode old career/perk caller.
 * Physics reads MATCH_RULES directly. These keys do not enter new saves. */
function installUnifiedControls(settings) {
  const fixed = { hitZone: .85, assist: MATCH_RULES.trajectoryAssist,
    posAssist: MATCH_RULES.positionAssist, sensitivity: MATCH_RULES.sensitivity, showZone: true };
  for (const [key, value] of Object.entries(fixed)) {
    Object.defineProperty(settings, key, { configurable: false, enumerable: false,
      get() { return value; }, set(_ignored) {} });
  }
  return settings;
}
function playerCaptureLimits(isServe) {
  return { radius: isServe ? MATCH_RULES.serveCaptureRadius : MATCH_RULES.captureRadius,
    depth: MATCH_RULES.depthTolerance, sweet: MATCH_RULES.sweetRadius };
}
/** Endpoint capture used by impact AND the timing cue. CCD remains the
 * additional continuous path for a fast crossing between physical substeps.
 * This does not manufacture a stroke: callers still enforce fresh gestures,
 * bounce legality, toss height and the consumed-once rule. */
function playerInCaptureRange(ball, paddle, isServe = false) {
  if (!ball || !paddle || ![ball.x, ball.y, ball.z, paddle.x, paddle.y, paddle.z].every(Number.isFinite)) return false;
  const dx = ball.x - paddle.x, dy = ball.y - paddle.y, dz = ball.z - paddle.z;
  return isServe ? Math.hypot(dx, dy, dz) <= MATCH_RULES.serveCaptureRadius
    : Math.hypot(dx, dy) <= MATCH_RULES.captureRadius && Math.abs(dz) <= MATCH_RULES.depthTolerance;
}
/** Pure overlay model: cue follows the ball; no fake area-of-effect circle.
 * A warm solid bracket means an available time/position window, never an
 * automatic hit. Early dashed brackets differ by shape as well as colour. */
function strikeCueModel(window) {
  if (!window || !window.on || !['rally', 'serve'].includes(window.kind) || !Number.isFinite(window.t)
      || !Number.isFinite(window.k) || !Number.isFinite(window.ready)
      || window.t > MATCH_RULES.timingHorizon || window.k < .02) return null;
  const hot = window.contactable === true && window.ready > .82;
  return { radius: MATCH_RULES.timingMinPx + Math.min(1, Math.max(0, window.t / MATCH_RULES.timingHorizon))
      * (MATCH_RULES.timingMaxPx - MATCH_RULES.timingMinPx),
    hot, dashed: !hot, alpha: Math.min(1, Math.max(0, window.k)) * (hot ? .9 : .5) };
}

/** Inverse capture: where the bat centre may be for this actual ball.
 * Section is drawn at the bat's depth, not a misleading screen-space circle. */
function ballCaptureTarget(paddle, ball, serving = false) {
  if (!paddle || !paddle.pos || !ball || ![paddle.pos.x,paddle.pos.y,paddle.pos.z,ball.x,ball.y,ball.z].every(Number.isFinite)) return null;
  const limits = playerCaptureLimits(serving), dz = ball.z - paddle.pos.z;
  const depth = serving ? limits.radius : limits.depth, depthOk = Math.abs(dz) <= depth;
  const radius = serving ? Math.sqrt(Math.max(0, limits.radius ** 2 - dz ** 2)) : limits.radius;
  const center = { x: ball.x, y: ball.y, z: paddle.pos.z }, points = [];
  if (depthOk) for (let i = 0; i <= 48; i++) {
    const a = i / 48 * Math.PI * 2;
    points.push({ x: center.x + Math.cos(a)*radius, y: center.y + Math.sin(a)*radius, z: center.z });
  }
  return { center, points, radius, limitRadius: limits.radius, depth, depthGap: Math.abs(dz), depthOk,
    inside: playerInCaptureRange(ball, paddle.pos, serving), serving };
}

/** Numeric evidence at one physical substep, before impact changes the ball.
 * Includes the alternate CCD route so endpoint-only counting cannot overstate
 * how many hits a smaller radius would reject. Depth is held fixed. */
function measureCaptureAllowance(paddle, p0, p1, serving, endpointEligible) {
  const p = paddle.pos, n = paddle.normal, previous = paddle.prevPos;
  if (!p || !n || !previous || !p0 || !p1 ||
      ![p.x,p.y,p.z,n.x,n.y,n.z,previous.x,previous.y,previous.z,p0.x,p0.y,p0.z,p1.x,p1.y,p1.z].every(Number.isFinite)) return null;
  const limits = playerCaptureLimits(serving), dx = p1.x-p.x, dy = p1.y-p.y, dz = p1.z-p.z;
  const lateral = Math.hypot(dx,dy), distance = Math.hypot(dx,dy,dz);
  const endpointRadius = endpointEligible && (serving || Math.abs(dz)<=limits.depth) ? (serving ? distance : lateral) : null;
  const d0 = (p0.x-previous.x)*n.x+(p0.y-previous.y)*n.y+(p0.z-previous.z)*n.z;
  const d1 = dx*n.x+dy*n.y+dz*n.z;
  let ccdRadius = null;
  if (d0 > PH.R && d1 <= PH.R) {
    const t = Math.max(0,Math.min(1,(d0-PH.R)/Math.max(d0-d1,1e-9)));
    const ex = p0.x+(p1.x-p0.x)*t-(previous.x+(p.x-previous.x)*t);
    const ey = p0.y+(p1.y-p0.y)*t-(previous.y+(p.y-previous.y)*t);
    const ez = p0.z+(p1.z-p0.z)*t-(previous.z+(p.z-previous.z)*t);
    const dn = ex*n.x+ey*n.y+ez*n.z;
    ccdRadius = Math.hypot(ex-n.x*dn,ey-n.y*dn,ez-n.z*dn);
  }
  const candidates = [endpointRadius,ccdRadius].filter(Number.isFinite);
  return { serving: !!serving, radius: limits.radius, depthLimit: limits.depth,
    lateral, depthGap: Math.abs(dz), distance, endpointEligible: !!endpointEligible,
    endpointRadius, ccdRadius, requiredRadius: candidates.length ? Math.min(...candidates) : null,
    score: serving ? distance/limits.radius : Math.max(lateral/limits.radius,Math.abs(dz)/limits.depth) };
}

// Actual mouse/touch press admission, in CSS pixels. Independent of quality.
function pressRadiusFor(serving) {
  return serving ? MATCH_RULES.servePressRadiusPx : MATCH_RULES.pressRadiusPx;
}
/** The toss and the strike: the same numbers the input gate uses. */
function pressHitZone(ballScreen, pointer, width, height, radius = MATCH_RULES.pressRadiusPx) {
  if (!ballScreen || !ballScreen.ok || !pointer || ![ballScreen.x,ballScreen.y,pointer.x,pointer.y,width,height,radius].every(Number.isFinite) || width<=0 || height<=0 || radius<=0) return null;
  const x=ballScreen.x*width,y=ballScreen.y*height;
  const distancePx=Math.hypot(pointer.x*width-x,pointer.y*height-y);
  return { x,y,radius,distancePx,pointerX:pointer.x*width,pointerY:pointer.y*height,accepted:distancePx<=radius };
}
