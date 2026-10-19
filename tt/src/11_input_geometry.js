/* =====================================================================
 *  INPUT GEOMETRY
 *  One coherent bridge between pointer, camera, racket and ball.
 *
 *  The four "felt" problems all have the same root: each layer was working
 *  in its own coordinate frame.
 *      · camera            – world coordinates, fits table, viewport ratios
 *      · paddleTarget      – pointer pixels (0..1, y-down) -> world xyz
 *      · pressZone (oval)  – pointer px vs. ball px at pointerdown time
 *      · tryPlayerHit      – world distance, recomputed each substep
 *  Pointer position, ball position, racket position and zone were computed
 *  at different times (down / move / hit), with different assumptions and
 *  no shared anchor — a click that should hit could be 20 cm off the ball.
 *
 *  This module is the single source of truth: it owns the BALL-ANCHORED
 *  PADDLE PLANE (the visible plane the bat sweeps through, parallel to
 *  the camera's image plane, passing through the paddle's home depth),
 *  projects both ball and pointer onto it through the same viewProj the
 *  renderer uses, and reports
 *      · where the bat should be (paddle world xyz)
 *      · what the bat's visible footprint is (for the press oval)
 *      · whether the pointer is inside the live capture volume
 *  All three values come from ONE math pass and SHARE three inputs:
 *  pointer (px,py), ball (world xyz), and the camera viewProj.
 *
 *  Coordinates: world is metres (+x right, +y up, +z toward player),
 *  screen is 0..1 with y down, paddlePlane is camera-aligned.
 * ===================================================================== */
'use strict';

/* The paddle lives on a vertical plane parallel to the camera's image
 * plane, at the depth the player stands. This is the plane a real mouse
 * cursor is "drawing on" when you drag in front of you: moving the cursor
 * left slides the bat left on the plane, not toward the opponent.
 *
 * Why a plane (and not the world floor or a spherical shell):
 *   · the bat is, physically, an extended object in front of the player;
 *   · the camera turns horizontal screen motion into a useful racket
 *     displacement for a wide range of camera rigs, without a per-camera
 *     formula (the old paddleTargetFromPointer used a hard-coded
 *     (y-0.18)*1.10 multiplier that depended on the preset's pitch and
 *     silently drifted as the camera changed);
 *   · height on the plane is what the ball's projected y becomes when
 *     you scale it by the distance to the bat's depth: same as where the
 *     ball would land if it kept flying forward, which is exactly where
 *     you want to put the bat.
 *
 * The plane's basis vectors (right, up) come from the camera's view
 * matrix, NOT from a fixed (x,z) world frame. That is the fix: the
 * camera-preset fitting and the cursor-to-bat mapping used to disagree
 * because one was world-aligned and the other was screen-aligned.
 */
const PADDLE_PLANE = Object.freeze({
  // The bat's "depth home": the centre of its travel range, in world z.
  // Matches the home pose set in 70_game.js (PADDLE_LIMITS centre).
  zHome: 1.78,
  // Lateral play: the bat may travel this far either side of centre, in
  // metres ON THE PLANE. Roughly matches PADDLE_LIMITS.x for the live
  // rig; the renderer / camera fit may clip tighter, and that clip is
  // applied later by clampPaddleToFrustum.
  halfWidth: 1.02,
  // Height band on the plane (above the table). Lower is below the tape
  // for a chop; upper is overhead for a lob.
  yLo: -0.28,            // 48 cm below the table — chopping low
  yHi: 1.05,             // 1.81 m above the floor — overhead
  // Forward step: the bat may also LEAN forward over the table for a
  // short ball. This is the closest the bat centre can come to the net.
  zStepIn: 0.62,         // 62 cm past the end line
  zFar: 2.55,            // a full metre behind the end line
});

/* Two output buffers to avoid allocation in the hot loop. Both reuse the
 * same internal object — copy out the values you need. */
const _outPose = { x: 0, y: 0, z: 0, depth: PADDLE_PLANE.zHome, ok: true };
const _outPx   = { x: 0.5, y: 0.55, ok: true, depth01: 1 };
const _outZone = { accepted: false, shape: 'circle', radius: 0, along: 0, across: 0,
                   referenceAxisX: 0, referenceAxisY: 1, blend: 0, score: 1 };

/* The camera-space basis vectors of the paddle plane are the FIRST TWO
 * ROWS of the view matrix's 3x3 (the world->camera rotation): they tell
 * us where world +x and world +y project on the image plane.
 *
 *   view matrix (world -> camera):
 *     row 0 (rx, ry, rz): camera-right   = world+x  rotated into camera
 *     row 1 (ux, uy, uz): camera-up      = world+y  rotated into camera
 *     row 2 (fx, fy, fz): camera-forward = -world+z rotated into camera
 *
 * The paddle plane basis is (camera-right, camera-up). To project a
 * world point P onto the plane at depth d, we compute:
 *
 *     P - d * zhat        (push to the plane's depth; zhat = world +z)
 *     . right, . up       (its in-plane coordinates)
 *
 * To project the CURSOR (already in 0..1 screen, y down) onto the plane:
 *
 *     ndcX  =  cursor.x*2 - 1         (-1..+1, +1 = right)
 *     ndcY  =  1 - cursor.y*2         (-1..+1, +1 = up in world)
 *     fovH, fovV  (from projection matrix, derived once)
 *     ray  =  unproject(ndcX, ndcY, fovH, fovV, viewInverse)
 *     hit  =  ray-plane intersection with the paddle plane at depth d
 *
 * Inverse view is built lazily and reused. */
const _viewInvCache = new Map();
function getViewInverse(view) {
  // Key by content (cheap 4-float fingerprint). Module-level cache so
  // multiple Game instances do not corrupt each other when the view is
  // shared across frames.
  const key = view[0] + '|' + view[5] + '|' + view[10] + '|' + view[14];
  let inv = _viewInvCache.get(key);
  if (inv) return inv;
  inv = M4.create();
  M4.invert(inv, view);
  _viewInvCache.set(key, inv);
  if (_viewInvCache.size > 8) {
    const first = _viewInvCache.keys().next().value;
    if (first !== key) _viewInvCache.delete(first);
  }
  return inv;
}

/* Vertical FOV in radians from a perspective projection matrix.
 * Row-major column-major read: M4.perspective writes
 *   o[5] = f ;  f = 1 / tan(fovy/2)
 * so fovy = 2 * atan(1 / o[5]). */
function fovYFromProj(proj) { return 2 * Math.atan(1 / Math.max(proj[5], 1e-6)); }

/* Returns the ray (origin, dir) for a normalised screen point.
 * origin = camera position in world space (inverse-view applied to 0,0,0)
 * dir    = normalised direction in world space (inverse-view applied to
 *          the camera-space ray built from ndc + fov). */
const _camOrigin = { x: 0, y: 0, z: 0 };
const _rayDir = { x: 0, y: 0, z: 0 };
function unprojectScreen(px, py, view, proj, aspect) {
  // camera-space ray: x = ndcX * tan(fovH/2), y = ndcY * tan(fovV/2), z = -1
  const ndcX = px * 2 - 1;
  const ndcY = 1 - py * 2;          // flip y: screen y down -> camera up
  const fovY = fovYFromProj(proj);
  const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
  const dirCam = { x: Math.tan(fovX / 2) * ndcX, y: Math.tan(fovY / 2) * ndcY, z: -1 };
  const inv = getViewInverse(view);
  // origin: column 3 of inverse view is the camera position in world
  _camOrigin.x = inv[12]; _camOrigin.y = inv[13]; _camOrigin.z = inv[14];
  // direction: rotate dirCam by inverse view's 3x3
  _rayDir.x = inv[0] * dirCam.x + inv[4] * dirCam.y + inv[8]  * dirCam.z;
  _rayDir.y = inv[1] * dirCam.x + inv[5] * dirCam.y + inv[9]  * dirCam.z;
  _rayDir.z = inv[2] * dirCam.x + inv[6] * dirCam.y + inv[10] * dirCam.z;
  const L = Math.hypot(_rayDir.x, _rayDir.y, _rayDir.z) || 1;
  _rayDir.x /= L; _rayDir.y /= L; _rayDir.z /= L;
  return { ox: _camOrigin.x, oy: _camOrigin.y, oz: _camOrigin.z,
           dx: _rayDir.x, dy: _rayDir.y, dz: _rayDir.z };
}

/* Ray-plane intersection for a plane with normal n (world +z) at depth z.
 * Returns t along the ray, or -1 if parallel / behind. */
function rayPlaneZ(ox, oy, oz, dx, dy, dz, z) {
  if (Math.abs(dz) < 1e-6) return -1;
  const t = (z - oz) / dz;
  return t > 0 ? t : -1;
}

/* Project a world point onto the SCREEN (0..1, y down) using the same
 * viewProj the renderer uses. Kept here so we don't fork the math
 * between Game.project() and 57_camera's projectPoint. */
const _projTmp = { x: 0, y: 0, d: 1, ok: true };
function projectWorld(vp, p, out) {
  const o = out || _projTmp;
  const cw = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
  if (cw <= 1e-4) { o.ok = false; o.x = 0.5; o.y = 0.5; o.d = cw; return o; }
  o.x = ((vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / cw) * 0.5 + 0.5;
  o.y = 0.5 - ((vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / cw) * 0.5;
  o.d = cw; o.ok = true;
  return o;
}

/* Project a world point onto the paddle plane at depth zPlane.
 * Returns (onPlaneX, onPlaneY) in metres — the bat's working frame. */
function projectOntoPaddlePlane(vp, view, projMat, p, zPlane, aspect, out) {
  const o = out || _outPose;
  // First: where on the screen would p appear?
  const s = projectWorld(vp, p, _projTmp);
  if (!s.ok) { o.ok = false; return o; }
  // Then: take a ray from the camera through that screen point, and
  // intersect it with the paddle plane at zPlane. This gives the world
  // point on the plane that LINES UP with the ball on screen.
  const r = unprojectScreen(s.x, s.y, view, projMat, aspect);
  const t = rayPlaneZ(r.ox, r.oy, r.oz, r.dx, r.dy, r.dz, zPlane);
  if (t < 0) { o.ok = false; return o; }
  o.x = r.ox + r.dx * t;
  o.y = r.oy + r.dy * t;
  o.z = zPlane;
  o.depth = zPlane;
  o.ok = true;
  return o;
}

/* Derive the pure projection matrix from vp and view: proj = vp * inv(view).
 * vp = proj * view, and OpenGL matrices are column-major, so this is the
 * correct recover operation. The output is the upper-left 4x4 (no row 4
 * adjustment); all 16 components are written. The previous code copied vp
 * verbatim and called it "proj", which silently baked the camera rotation
 * into FOV — bat was off by up to 4° vertical. */
const _projDeriveCache = new Map();
function deriveProj(vp, view) {
  const key = vp[5] + '_' + view[0] + '_' + view[5] + '_' + view[10];
  let cached = _projDeriveCache.get(key);
  if (cached) return cached;
  const invView = getViewInverse(view);
  const proj = M4.create();
  M4.mul(proj, vp, invView);
  _projDeriveCache.set(key, proj);
  if (_projDeriveCache.size > 8) {
    const first = _projDeriveCache.keys().next().value;
    if (first !== key) _projDeriveCache.delete(first);
  }
  return proj;
}

/* -----------------------------------------------------------------
 *  THE LIVE BRIDGE
 *
 *  computePaddleAim() is the one function the input loop calls. It takes
 *  the pointer (px, py in 0..1, y down), the ball's world position, the
 *  live viewProj and view matrices, and the renderer aspect ratio, and
 *  returns EVERYTHING the rest of the game needs:
 *
 *    outPose.xyz  – world position the bat should snap to this frame
 *    outScreen.xy – where that world position lands on screen
 *    outZone      – press-oval eligibility for THIS pointer position,
 *                   centred on the ball, axis-aligned with the ball's
 *                   screen velocity (or the racket, when slow)
 *
 *  The oval is built in metres on the paddle plane (not pixels), so it
 *  matches the player's actual reach regardless of zoom or screen size.
 *  Callers turn it back into pixels for the HUD by projecting the
 *  oval's far end (centre + along-axis) through the same viewProj.
 *
 *  PROJ MATRIX (not vp). The FOV lives in the projection matrix alone,
 *  and `vp = proj * view` mixes the two. If we read vp[5] and call it
 *  fovY, the rotation baked into view[5] (camera-up y-component) tilts
 *  the supposed "vertical FOV" by as much as 4° on a steep pitch.
 *  Callers may pass `proj` explicitly OR let the bridge derive it from
 *  vp+view (slow but correct). For the live path, callers MUST pass proj.
 * ----------------------------------------------------------------- */
const _ballScreen = { x: 0.5, y: 0.5, ok: true, d: 1 };
const _batOnPlane = { x: 0, y: 0, z: PADDLE_PLANE.zHome, depth: PADDLE_PLANE.zHome, ok: true };
const _ballOnPlane = { x: 0, y: 0, z: PADDLE_PLANE.zHome, depth: PADDLE_PLANE.zHome, ok: true };
const _aimTmp = { x: 0, y: 0, z: 0, depth: 0, ok: true };
const _axis = { rx: 0, ry: 0, ux: 0, uy: 0 };

function computePaddleAim(px, py, ballWorld, vp, view, aspect, ballScreenVel, opts) {
  opts = opts || {};
  const serving = !!opts.serving;
  const depth = Number.isFinite(opts.depth) ? clamp(opts.depth, PADDLE_PLANE.zStepIn, PADDLE_PLANE.zFar)
                                            : PADDLE_PLANE.zHome;

  // Resolve the actual projection matrix: prefer what the caller passed,
  // otherwise derive it from vp+view (vp = proj * view -> proj = vp * inv(view)).
  let projMat = opts.proj;
  if (!projMat) projMat = deriveProj(vp, view);

  // Step 1: project the ball onto screen (live, this frame).
  projectWorld(vp, ballWorld, _ballScreen);

  // Step 2: the plane basis — camera-right/up in the plane's tangent space.
  // Row 0 of the view matrix = camera-right; row 1 = camera-up. We want
  // their IN-PLANE components (drop z). They are already orthonormal in 3D,
  // so dropping z still gives us a 2D basis on the plane (perpendicular
  // to world +z).
  _axis.rx = view[0]; _axis.ry = view[1];
  _axis.ux = view[4]; _axis.uy = view[5];
  const rL = Math.hypot(_axis.rx, _axis.ry) || 1;
  _axis.rx /= rL; _axis.ry /= rL;
  const uL = Math.hypot(_axis.ux, _axis.uy) || 1;
  _axis.ux /= uL; _axis.uy /= uL;

  // Step 3: project ball + cursor onto the paddle plane at `depth`.
  // Same view, same plane — so they share their frame by construction.
  projectOntoPaddlePlane(vp, view, projMat, ballWorld, depth, aspect, _ballOnPlane);
  const cursorRay = unprojectScreen(px, py, view, projMat, aspect);
  const ct = rayPlaneZ(cursorRay.ox, cursorRay.oy, cursorRay.oz,
                       cursorRay.dx, cursorRay.dy, cursorRay.dz, depth);
  if (ct < 0) { _outPose.ok = false; return null; }
  _batOnPlane.x = cursorRay.ox + cursorRay.dx * ct;
  _batOnPlane.y = cursorRay.oy + cursorRay.dy * ct;
  _batOnPlane.z = depth;
  _batOnPlane.depth = depth;
  _batOnPlane.ok = true;

  // Step 4: express the pointer's offset from the ball on the plane.
  // The cursor's "ahead of the ball" direction on the plane is the
  // projection of world +z (the ball comes from there) — but reflected:
  // the ball is BEHIND the player's screen position, so a backswing is a
  // forward screen motion that maps to NEGATIVE z on the plane (away
  // from net) when world velocity is +z toward the player.
  const dx = _batOnPlane.x - _ballOnPlane.x;
  const dy = _batOnPlane.y - _ballOnPlane.y;
  // distance on the plane, in metres
  const planeDist = Math.hypot(dx, dy);

  // Step 5: world -> plane-to-screen ratio at this depth, so the press
  // oval can be sized in metres and still feel right on the HUD.
  // (1 metre on the plane -> this many px when projected.)
  const planeOnScreen = projectWorld(vp,
    { x: _ballOnPlane.x + _axis.rx, y: _ballOnPlane.y + _axis.ry, z: depth }, _projTmp);
  const m1px = planeOnScreen.ok ? Math.hypot(planeOnScreen.x - _ballScreen.x,
                                             planeOnScreen.y - _ballScreen.y) : 0.001;
  // px per metre on the paddle plane (for both axes — we use a single
  // average because the plane is roughly uniform for an upright bat).
  const pxPerM = Math.max(m1px, 0.05);

  // Step 6: build the press oval in metres, axis = ball's screen velocity
  // when it has one, else the racket's forward direction.
  const v = ballScreenVel || {};
  const vL = Math.hypot(v.x || 0, v.y || 0);
  // The oval's "along" axis follows the screen velocity, falling back to a
  // vertical reference (player->ball, which is screen-down).
  const refAxis = { x: 0, y: 1 };
  let axisX = refAxis.x, axisY = refAxis.y;
  if (vL > 1e-3) { axisX = v.x / vL; axisY = v.y / vL; }
  const blend = smoothstep(0.02, 0.30, vL);        // 30% of typical speed = full oval
  // Blend with the static reference axis for stationary balls.
  const bDot = axisX * refAxis.x + axisY * refAxis.y;
  const bAngle = Math.acos(Math.max(-1, Math.min(1, bDot)));
  const bStep = bAngle * blend;
  let perpX = axisX - refAxis.x * bDot, perpY = axisY - refAxis.y * bDot;
  const perpL = Math.hypot(perpX, perpY);
  if (perpL < 1e-6) { perpX = -refAxis.y; perpY = refAxis.x; }
  else { perpX /= perpL; perpY /= perpL; }
  const cb = Math.cos(bStep), sb = Math.sin(bStep);
  axisX = refAxis.x * cb + perpX * sb;
  axisY = refAxis.y * cb + perpY * sb;

  // Step 7: project the oval axis onto the paddle plane to get the
  // "along/across" axes in metres. (Screen axes are not plane axes when
  // the camera looks down.)
  // A screen-axis (sx, sy) maps to a plane direction = sx*right + sy*up.
  const alongRight = axisX * _axis.rx + axisY * _axis.ux;
  const alongUp    = axisX * _axis.ry + axisY * _axis.uy;
  const alongL = Math.hypot(alongRight, alongUp) || 1;
  const alongNx = alongRight / alongL, alongNy = alongUp / alongL;
  // perpendicular on the plane (clockwise 90°)
  const acrossNx = -alongNy, acrossNy = alongNx;

  // Step 8: pointer offset on the plane, expressed in (along, across).
  const alongMetres  = dx * alongNx + dy * alongNy;
  const acrossMetres = dx * acrossNx + dy * acrossNy;

  // Step 9: OVAL SIZES IN METRES. These are the player's actual reach
  // around the ball on the plane, scaled by sensitivity. The forward half
  // extends with screen velocity (a faster ball means the player may
  // start the swing earlier). The sideways half is the user's "finger
  // width" on the plane.
  const sens = clamp(opts.sens || 1, 0.4, 2.2);
  const sideReach = 0.12 * sens;                       // 12 cm each side at sens=1
  const backReach = 0.06 * sens;                       // 6 cm behind the ball
  const fwdReach  = clamp(0.10 + vL * 0.02, 0.10, 0.34) * sens;
  const forwardExtent = lerp(sideReach, fwdReach, blend);

  // Step 10: score the press and pick accepted/reason.
  const longNorm = alongMetres >= 0 ? alongMetres / forwardExtent : -alongMetres / backReach;
  const acrossNorm = acrossMetres / sideReach;
  const ovalScore = Math.hypot(longNorm, acrossNorm);
  const accepted = ovalScore <= 1;
  const reason = accepted ? null : 'OUTSIDE_ZONE';

  // Step 11: serve gate — must be falling AND rise >= 16 cm.
  if (serving && accepted && opts.v) {
    if (opts.v.y > 0) { _outZone.reason = 'SERVE_TOSS_LOW'; }
  }

  // Output pose: the bat wants to be where the pointer is, on the plane,
  // then clamped to the paddle's reachable volume.
  _aimTmp.x = _batOnPlane.x;
  _aimTmp.y = _batOnPlane.y;
  _aimTmp.z = depth;
  _aimTmp.depth = depth;
  _aimTmp.ok = true;

  // Output screen: project the bat's desired pose back to screen.
  projectWorld(vp, _aimTmp, _outPx);
  _outPx.depth01 = clamp((depth - PADDLE_PLANE.zStepIn) /
                         (PADDLE_PLANE.zFar - PADDLE_PLANE.zStepIn), 0, 1);

  // Output zone (in metres — caller can convert to px with pxPerM).
  _outZone.accepted = accepted;
  _outZone.shape = blend > 0.02 ? 'oval' : 'circle';
  _outZone.radius = Math.max(forwardExtent, backReach, sideReach);
  _outZone.along = alongMetres;
  _outZone.across = acrossMetres;
  _outZone.referenceAxisX = refAxis.x;
  _outZone.referenceAxisY = refAxis.y;
  _outZone.blend = blend;
  _outZone.score = ovalScore;
  _outZone.reason = reason;
  _outZone.axisX = axisX;
  _outZone.axisY = axisY;
  _outZone.fwdMetres = forwardExtent;
  _outZone.backMetres = backReach;
  _outZone.sideMetres = sideReach;
  _outZone.planeDist = planeDist;
  _outZone.pxPerM = pxPerM;
  _outZone.ballOnPlaneX = _ballOnPlane.x;
  _outZone.ballOnPlaneY = _ballOnPlane.y;
  _outZone.batOnPlaneX = _batOnPlane.x;
  _outZone.batOnPlaneY = _batOnPlane.y;
  _outZone.pointerX = px;
  _outZone.pointerY = py;

  return { pose: _aimTmp, screen: _outPx, zone: _outZone };
}

/* Clamp the computed aim to the reachable paddle volume AND to whatever
 * the camera frustum actually shows. Replaces the old
 * clampPaddleToFrustum that fought the cursor. The frustum check here
 * uses the same viewProj the aim was computed from, so they cannot
 * disagree by construction. */
const _frS = { x: 0.5, y: 0.5, ok: true };
function clampAimToLimits(vp, pose, minSurface, margin) {
  margin = margin || 0.04;
  // Reachable volume
  pose.x = clamp(pose.x, -PADDLE_PLANE.halfWidth, PADDLE_PLANE.halfWidth);
  pose.y = clamp(pose.y, PH.TABLE_Y + PADDLE_PLANE.yLo, PH.TABLE_Y + PADDLE_PLANE.yHi);
  pose.z = clamp(pose.z, minSurface, PADDLE_PLANE.zFar);

  // Frustum (only kicks in for extreme manual zoom-out / tiny aspect)
  projectWorld(vp, pose, _frS);
  if (_frS.ok && _frS.x > margin && _frS.x < 1 - margin && _frS.y > margin && _frS.y < 1 - margin) return pose;
  // Walk toward the home pose and stop as soon as we re-enter the frame.
  const home = { x: 0, y: PH.TABLE_Y + 0.62, z: PADDLE_PLANE.zHome };
  for (let k = 1; k <= 4; k++) {
    const f = k / 4;
    const tx = lerp(pose.x, home.x, f);
    const ty = lerp(pose.y, home.y, f);
    const tz = lerp(pose.z, home.z, f * 0.6);
    projectWorld(vp, { x: tx, y: ty, z: tz }, _frS);
    if (_frS.ok && _frS.x > margin && _frS.x < 1 - margin && _frS.y > margin && _frS.y < 1 - margin) {
      pose.x = tx; pose.y = ty; pose.z = tz;
      return pose;
    }
  }
  pose.x = home.x; pose.y = home.y; pose.z = home.z;
  return pose;
}

/* Public handle: the press-zone acceptance used by tryPlayerHit.
 *
 * The legacy version fixed the zone in pointerdown and let it go stale as
 * the ball moved. The bridge stamps the zone EVERY frame from the live
 * cursor and the live ball; if the player is still over the ball when
 * the bat closes in, the press is admitted. The caller has to enforce
 * the consumed-once rule and the timing freshness itself — this only
 * reports geometry. */
function pointerInZone(zone) {
  return !!(zone && zone.accepted);
}

/* Convert the live zone back to pixel sizes for the HUD. */
function zoneToPx(zone) {
  if (!zone) return null;
  const r = (zone.radius || 0.12) * (zone.pxPerM || 0.001);
  return {
    shape: zone.shape,
    radiusPx: r,
    alongPx: (zone.along || 0) * (zone.pxPerM || 0.001),
    acrossPx: (zone.across || 0) * (zone.pxPerM || 0.001),
    fwdPx: (zone.fwdMetres || 0) * (zone.pxPerM || 0.001),
    backPx: (zone.backMetres || 0) * (zone.pxPerM || 0.001),
    sidePx: (zone.sideMetres || 0) * (zone.pxPerM || 0.001),
    accepted: zone.accepted,
    score: zone.score,
    reason: zone.reason,
    blend: zone.blend,
  };
}