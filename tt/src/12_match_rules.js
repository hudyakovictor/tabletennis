/* One versioned player-control contract. Not difficulty, equipment, cosmetics
 * or handedness. Distances are metres; marker sizes are CSS pixels, NOT hit
 * radii. Keep input affordance, timing and physical capture separate. */
'use strict';
const MATCH_RULES = Object.freeze({
  version: 2,
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
  captureRadius: .62,        // realistic stance distance requires larger capture
  depthTolerance: .62,      // realistic stance distance
  serveCaptureRadius: .88,  // falling toss only; larger for realistic stance
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
function playerCaptureLimits(isServe, scale = 1) {
  const sc = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return { radius: (isServe ? MATCH_RULES.serveCaptureRadius : MATCH_RULES.captureRadius) * sc,
    depth: MATCH_RULES.depthTolerance * sc, sweet: MATCH_RULES.sweetRadius };
}
/** Endpoint capture used by impact AND the timing cue. CCD remains the
 * additional continuous path for a fast crossing between physical substeps.
 * This does not manufacture a stroke: callers still enforce fresh gestures,
 * bounce legality, toss height and the consumed-once rule. */
function playerInCaptureRange(ball, paddle, isServe = false, scale = 1) {
  if (!ball || !paddle || ![ball.x, ball.y, ball.z, paddle.x, paddle.y, paddle.z].every(Number.isFinite)) return false;
  const sc = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const dx = ball.x - paddle.x, dy = ball.y - paddle.y, dz = ball.z - paddle.z;
  return isServe ? Math.hypot(dx, dy, dz) <= MATCH_RULES.serveCaptureRadius * sc
    : Math.hypot(dx, dy) <= MATCH_RULES.captureRadius * sc && Math.abs(dz) <= MATCH_RULES.depthTolerance * sc;
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

const PRESS_REJECTION_REASONS = Object.freeze([
  'OUTSIDE_ZONE', 'NO_FRESH_SWIPE', 'STATIC_CLICK', 'DEPTH_FAIL', 'TIMING_LATE',
  'TIMING_EARLY', 'CONSUMED', 'SERVE_TOSS_LOW', 'WRONG_DIRECTION', 'BOUNCE_ILLEGAL',
]);

// Actual mouse/touch press admission, in CSS pixels. Independent of quality.
function pressHitZone(ballScreen, pointer, width, height, radius = MATCH_RULES.pressRadiusPx) {
  if (!ballScreen || !ballScreen.ok || !pointer || ![ballScreen.x,ballScreen.y,pointer.x,pointer.y,width,height,radius].every(Number.isFinite) || width<=0 || height<=0 || radius<=0) return null;
  const x=ballScreen.x*width,y=ballScreen.y*height;
  const distancePx=Math.hypot(pointer.x*width-x,pointer.y*height-y);
  const accepted=distancePx<=radius;
  return { x,y,radius,distancePx,pointerX:pointer.x*width,pointerY:pointer.y*height,accepted,
    shape:'circle', score:distancePx/radius, along:null, across:null,
    reason:accepted?null:'OUTSIDE_ZONE' };
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

/** Oval press admission, elongated along the ball's SCREEN velocity.
 *
 * `ball` may be a world ball ({p,v} or a position plus opts.velocity) when
 * opts.project is supplied, or an already projected point ({x,y,ok}) when
 * opts.screenVelocityPx / opts.screenVelocity is supplied. The screen
 * velocity is always the difference of two projections, never the raw world
 * vector, so perspective foreshortening is part of the shape. `along` is
 * positive ahead of the ball (where a backswing starts); `across` is the
 * signed transverse offset. Half-ellipses are glued at the ball: the forward
 * half uses |v|*lead+fwdPx, the rear half uses backPx. */
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
  // The player/racket side of the authored camera is screen-down. This is
  // only a fallback; live input passes the actual racket position.
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
    const ax = a0.x, ay = a0.y; // copy: Game.project may reuse its out object
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
  const axis = pressOvalBlendAxis(referenceAxis, velocityAxis, blend);
  const axisX = axis.x, axisY = axis.y;
  const along = dx * axisX + dy * axisY;
  const across = -dx * axisY + dy * axisX;
  const uncappedForwardPx = speedPx * lead + fwdPx;
  const cappedForwardPx = Math.min(forwardMaxPx, uncappedForwardPx);
  const forwardExtent = sidePx + (cappedForwardPx - sidePx) * blend;
  const backExtent = sidePx + (backPx - sidePx) * blend;
  const longNorm = along >= 0 ? along / forwardExtent : -along / backExtent;
  const ovalScore = Math.hypot(longNorm, across / sidePx);
  // At blend=0 both long extents equal sidePx, so this is exactly the circle
  // score for any axis; interpolated extents make the ellipse itself smooth.
  const score = ovalScore;
  let accepted = score <= 1, reason = accepted ? null : 'OUTSIDE_ZONE';
  let directionDot = null, directionOk = null;
  const swipe = opts.swipe || opts.swipeDirection;
  if (swipe && [swipe.x, swipe.y].every(Number.isFinite)) {
    const sl = Math.hypot(swipe.x, swipe.y);
    if (sl > 1e-9) {
      directionDot = distancePx > 1e-9 ? -(swipe.x * dx + swipe.y * dy) / (sl * distancePx) : 1;
      directionOk = directionDot > 0;
      if (accepted && !directionOk) { accepted = false; reason = 'WRONG_DIRECTION'; }
    }
  }
  // Input admission and contact timing are separate decisions. Live input
  // may start a flick while the toss rises; tryPlayerHit enforces the legal
  // descent/rise at contact. Diagnostic callers retain the strict default.
  if (opts.kind === 'serve' && accepted && !opts.deferServeTiming) {
    const falling = typeof opts.falling === 'boolean' ? opts.falling
      : worldVelocity ? worldVelocity.y < 0 : screenVy > 0;
    const rise = Number.isFinite(opts.tossRise) ? opts.tossRise
      : serveTossRise(opts.tossApex, opts.tossStartY, opts.tableY);
    if (!falling || !(rise > MATCH_RULES.serveTossMinRise)) { accepted = false; reason = 'SERVE_TOSS_LOW'; }
  }
  return { x: center.x, y: center.y, radius: Math.max(forwardExtent, backExtent, sidePx),
    distancePx, pointerX, pointerY, accepted, shape: blend > 0 ? 'oval' : 'circle',
    score, along, across, reason, directionDot, directionOk,
    axisX, axisY, referenceAxisX: referenceAxis.x, referenceAxisY: referenceAxis.y,
    velocityAxisX: velocityAxis.x, velocityAxisY: velocityAxis.y, blend,
    screenVx, screenVy, speedPx, leadSec: lead,
    fwdPx: forwardExtent, uncappedForwardPx, forwardMaxPx,
    backPx: backExtent, sidePx, pointerType,
    kind: opts.kind === 'serve' ? 'serve' : 'rally' };
}

/** Serve press admission: same oval, but the toss must already be falling
 * from a legal rise. Screen "forward" is therefore down the fall line. */
function pressServeZoneOval(ball, pointer, width, height, opts = {}) {
  return pressHitZoneOval(ball, pointer, width, height, { ...opts, kind: 'serve' });
}

/** The one dispatch used by live input and by the debug overlay. */
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
