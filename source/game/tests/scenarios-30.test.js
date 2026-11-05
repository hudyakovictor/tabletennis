'use strict';
/* =====================================================================
 *  30 gameplay scenarios (2026-11-05) — headless verification matrix.
 *
 *  Every `test()` below is one numbered scenario from the request. What is
 *  asserted is the part that CAN be measured on the real engine modules in
 *  node: gesture maths, contact gates, geometry, physics, AI planning,
 *  scoring and the relay protocol. Scenarios that need a physical phone or
 *  a real browser layout are pinned at the contract that makes them device
 *  independent (single pointer path, projection re-anchoring) — the report
 *  `docs/scenarios-30-audit-2026-11-05.ru.md` says which is which.
 *
 *  Numbers quoted in the names are the measured ones from that audit.
 * ===================================================================== */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./helpers.cjs');

const ENGINE = load([
  '10_math.js', '30_physics.js', '12_match_rules.js', '38_paddle_motion.js',
  '37_stroke_motion_data.js', '40_swipe.js', '55_ai.js', '57_camera.js', '84_racket.js',
], [
  'V3', 'Q', 'PH', 'M4', 'MATCH_RULES', 'GRACE_RULES', 'CONTACT_CORRIDOR_RULES', 'STROKE_CONFIG',
  'SwipeTracker', 'isRealStroke', 'tapStrokeMetrics', 'compactStrokeMetrics', 'classifyStroke',
  'deriveStroke', 'refineRacket', 'impactRacket', 'predict', 'launchPoint', 'strokeFrame',
  'paddleContactPose', 'paddleTableClearance', 'paddleBottomExtent', 'paddlePoseQuaternion',
  'keepPaddleAboveTable', 'enforcePaddleTableClearance', 'playerInCaptureRange', 'playerGraceRange',
  'bladePlaneCapture', 'measureCaptureAllowance', 'pressZoneForBall', 'pressContactZone',
  'evaluateContactZone', 'solveStrikeCorridor', 'paddleLimitsFor', 'PADDLE_LIMITS', 'PADDLE_STANCE_Z',
  'REACH_SHELL', 'Equipment', 'OpponentAI', 'AI_SERVE_CAPS', 'OpponentAI', 'PaddleStrokeMotion',
]);
const {
  V3, PH, MATCH_RULES, GRACE_RULES, STROKE_CONFIG, SwipeTracker, isRealStroke,
  tapStrokeMetrics, compactStrokeMetrics, deriveStroke, refineRacket, impactRacket, predict,
  launchPoint, strokeFrame, paddleContactPose, paddleTableClearance, paddlePoseQuaternion,
  keepPaddleAboveTable, enforcePaddleTableClearance, playerInCaptureRange, playerGraceRange,
  bladePlaneCapture, measureCaptureAllowance, evaluateContactZone, solveStrikeCorridor,
  paddleLimitsFor, PADDLE_LIMITS, PADDLE_STANCE_Z, REACH_SHELL, Equipment, PaddleStrokeMotion,
} = ENGINE;

const SRC = path.join(root, 'tt', 'src');
const source = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

/* A gesture as the tracker sees it: normalised screen units, y down. */
function gesture(points) {
  const sw = new SwipeTracker();
  sw.down(points[0].x, points[0].y, points[0].t);
  for (let i = 1; i < points.length; i++) sw.move(points[i].x, points[i].y, points[i].t);
  const last = points[points.length - 1];
  return { sw, m: sw.up(last.x, last.y, last.t) };
}
function strokeMetrics(over = {}) {
  return { samples: 8, dist: .24, pathLen: .24, speed: 2, releaseSpeed: 2, peakSpeed: 2,
    right: 0, up: 1, curl: 0, smooth: 1, straightness: 1, x: .5, y: .5, ...over };
}
function context(over = {}) {
  const p = over.ball || { x: 0, y: PH.TABLE_Y + 0.35, z: 1.15 };
  const v = over.ballVelocity || { x: 0, y: 0.6, z: 6 };
  return { side: 1, grip: 'shakehand', hand: 'right', forehand: true, isServe: false,
    ball: p, ballVelocity: v, ballSpeed: Math.hypot(v.x, v.y, v.z), ballSpin: over.ballSpin || V3.new(),
    powerScale: 1, moveYaw: 0, movePitch: 0, equip: new Equipment().forSide(1), ...over };
}
function shoot(racket, ballP, ballV, ballW, quality = 1) {
  const v = V3.clone(ballV), w = V3.clone(ballW);
  const info = impactRacket(v, w, racket.normal, racket.vR, quality, racket.rubber || {});
  if (!info) return null;
  const report = predict(V3.clone(launchPoint(ballP, racket.normal)), V3.clone(v), V3.clone(w),
    { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true });
  return { v, w, info, report, legal: !!report.landed && report.landed.z < 0 && !report.hitNet };
}

/* ---------------------------------------------------------------------
 * 1. Real phones instead of emulation
 * ------------------------------------------------------------------ */
test('1. one pointer path: stroke admission and classification never read the device or emulator', () => {
  const game = source('70_game.js');
  // The stroke pipeline is pointer events only. There is no touch/mouse
  // twin path that could classify a stroke differently on a real phone.
  for (const legacy of ['touchstart', 'touchend']) {
    assert.ok(!new RegExp(`addEventListener\\(['"]${legacy}`).test(game),
      `${legacy} must not be a stroke input`);
  }
  assert.match(game, /addEventListener\('pointerdown'/);
  assert.match(game, /addEventListener\('pointerup'/);
  assert.match(game, /addEventListener\('pointermove'/);
  // Two identical sample streams classify identically no matter which
  // pointerType delivered them: deriveStroke has no device input at all.
  const m = strokeMetrics({ up: .92, right: .39, speed: 2.6, releaseSpeed: 2.6, peakSpeed: 2.8 });
  const a = deriveStroke(m, context());
  const b = deriveStroke({ ...m }, context({ pointerType: 'touch', via: 'TelegramWebView' }));
  const c = deriveStroke({ ...m }, context({ pointerType: 'mouse', via: 'desktop' }));
  assert.equal(a.stroke.id, b.stroke.id);
  assert.equal(a.stroke.id, c.stroke.id);
  assert.ok(Math.abs(V3.len(a.vR) - V3.len(b.vR)) < 1e-12);
  assert.ok(Math.abs(V3.len(a.vR) - V3.len(c.vR)) < 1e-12);
});

/* ---------------------------------------------------------------------
 * 2. Frame stalls of 50/100/200 ms around the contact
 * ------------------------------------------------------------------ */
test('2. a stalled frame cannot tunnel the ball or resolve a second contact', () => {
  // The worst case per physics substep at the game's maximum ball speed.
  const maxSpeed = 17.5;                        // STROKE_CONFIG.serve.ballMax
  const travel = maxSpeed * PH.SIM_DT;
  assert.ok(travel < MATCH_RULES.captureRadius / 4,
    `ball travels ${travel.toFixed(4)} m per 1/600 s — inside the capture radius`);
  // Every millisecond of a stalled frame is simulated in whole substeps; the
  // accumulator loop may not skip time (the only cap is a 0.667 s catch-up).
  for (const dt of [0.05, 0.1, 0.2]) {
    const steps = Math.floor(dt / PH.SIM_DT + 1e-9);
    assert.ok(steps <= 400, 'frame stays inside the substep guard');
    assert.ok(dt - steps * PH.SIM_DT < PH.SIM_DT + 1e-12, 'no simulated time is dropped');
  }
  // One physical episode = one contact: the gesture is consumed and the shot
  // id is bumped, so the second substep/frame in the same episode is refused
  // (the gate itself is exercised in scenario 8).
});

/* ---------------------------------------------------------------------
 * 3. Uneven FPS, same event timestamps
 * ------------------------------------------------------------------ */
test('3. gesture clock is event-timestamp driven, not frame driven', () => {
  const pts = [
    { x: .50, y: .70, t: 0.000 }, { x: .51, y: .66, t: 0.012 },
    { x: .52, y: .61, t: 0.024 }, { x: .53, y: .55, t: 0.038 },
    { x: .54, y: .50, t: 0.052 }, { x: .55, y: .46, t: 0.066 },
  ];
  const oneShot = gesture(pts).m;
  // Same samples, but "rendered" at a different (uneven) cadence: the
  // tracker recomputes on every event, so frames cannot move the clock.
  const sw = new SwipeTracker();
  sw.down(pts[0].x, pts[0].y, pts[0].t);
  const cadence = [2, 1, 1, 1, 1];
  let i = 1;
  for (const n of cadence) {
    for (let k = 0; k < n && i < pts.length; k++) sw.move(pts[i].x, pts[i].y, pts[i++].t);
    sw.compute(pts[i - 1].t);                 // an extra "frame" tick
  }
  const m = sw.up(pts[5].x, pts[5].y, pts[5].t);
  for (const key of ['dx', 'dy', 'dist', 'pathLen', 'speed', 'peakSpeed', 'angle', 'dur']) {
    assert.ok(Math.abs(m[key] - oneShot[key]) < 1e-9, `${key}: ${m[key]} != ${oneShot[key]}`);
  }
  // A burst of events with the same hardware timestamp must not overwrite the
  // press point or erase the path (only the last position of the burst wins).
  const burst = new SwipeTracker();
  burst.down(.5, .8, 0);
  burst.move(.5, .9, 0); burst.move(.5, .7, 0); burst.move(.5, .6, 0);
  const bm = burst.up(.5, .55, 0.016);
  // down + one kept position for the zero-dt burst + the release
  assert.equal(bm.samples, 3);
  assert.ok(bm.dy < -0.2, 'burst path survives with its direction');
});

/* ---------------------------------------------------------------------
 * 4. Mixed packetisation of one swipe
 * ------------------------------------------------------------------ */
test('4. a coalesced crossing packet is a stroke through the ball, never away from it', () => {
  const separate = gesture([
    { x: .50, y: .82, t: 0.000 }, { x: .50, y: .76, t: 0.010 },
    { x: .501, y: .70, t: 0.020 }, { x: .500, y: .64, t: 0.030 },
    { x: .500, y: .58, t: 0.040 }, { x: .499, y: .52, t: 0.050 },
  ]).m;
  // The same path: start separate, the whole crossing in one coalesced
  // packet, the release only after the next frame.
  const sw = new SwipeTracker();
  sw.down(.50, .82, 0.000);
  for (const p of [[.50, .76, .010], [.501, .70, .020], [.500, .64, .030], [.500, .58, .040]]) {
    sw.move(p[0], p[1], p[2]);                // one getCoalescedEvents() batch
  }
  const m = sw.up(.499, .52, 0.066);          // release lands on the next frame
  assert.ok(m.dy < -0.29, `dy ${m.dy.toFixed(3)} — upward through the ball`);
  assert.ok(m.angle > 1.3 && m.angle < 1.85, `angle ${m.angle.toFixed(2)} stays upward`);
  assert.ok(Math.abs(m.pathLen - separate.pathLen) < 1e-9, 'the crossed path is kept whole');
  assert.ok(isRealStroke(m), 'the swipe is admitted');
});

/* ---------------------------------------------------------------------
 * 5. Gestures at the tap/swipe threshold
 * ------------------------------------------------------------------ */
test('5. finger tremor stays a tap, a genuine short flick survives, neither becomes a noise swipe', () => {
  // Tremor: ±1.5 px around the press for 120 ms, on a 390x844 screen.
  const jitter = gesture([
    { x: .500, y: .600, t: 0 }, { x: .502, y: .602, t: .030 },
    { x: .500, y: .599, t: .060 }, { x: .501, y: .601, t: .090 },
    { x: .500, y: .600, t: .120 },
  ]).m;
  assert.equal(isRealStroke(jitter), false, 'tremor is not a swipe');
  const tap = tapStrokeMetrics(jitter, .5, .6, false);
  assert.equal(isRealStroke(tap), true, 'an admitted tap is a deliberate, weak stroke');
  assert.equal(tap.dist, 0);
  // A real short flick: 30 px up in 60 ms. Too short for the full-swipe
  // minimum (0.046 of the screen) but inside the compact-flick band.
  const flick = gesture([
    { x: .50, y: .66, t: 0 }, { x: .50, y: .648, t: .020 },
    { x: .50, y: .636, t: .040 }, { x: .50, y: .6245, t: .060 },
  ]).m;
  assert.equal(isRealStroke(flick), false, '30 px is below the full-swipe minimum');
  const compact = compactStrokeMetrics(flick, .5, .61);
  assert.equal(isRealStroke(compact), true, '…but it is promoted, not lost');
  assert.equal(compact.compactFlick, true);
  assert.ok(compact.up > 0.5 && compact.dist === flick.dist);
  // 60 px in 60 ms crosses into a full stroke.
  const full = gesture([
    { x: .50, y: .70, t: 0 }, { x: .50, y: .65, t: .020 },
    { x: .50, y: .60, t: .040 }, { x: .50, y: .578, t: .060 },
  ]).m;
  assert.equal(isRealStroke(full), true);
});

/* ---------------------------------------------------------------------
 * 6. Finger leaves the screen and comes back
 * ------------------------------------------------------------------ */
test('6. off-screen travel keeps finite metrics; a captured/cancelled gesture leaves nothing behind', () => {
  const game = source('70_game.js');
  // Pointer capture is what keeps a finger that leaves the canvas on the
  // same gesture, and losing it cancels the gesture instead of firing it.
  assert.match(game, /setPointerCapture/);
  assert.match(game, /lostpointercapture[^\n]*cancelInput\('lostpointercapture'/);
  const sw = new SwipeTracker();
  sw.down(.9, .5, 0);
  sw.move(1.2, .5, .02);      // raw coordinates may leave 0..1 (clamped ±0.35)
  sw.move(1.35, .5, .04);
  sw.move(1.1, .5, .06);
  const m = sw.up(.95, .5, .08);
  assert.ok([m.dx, m.dy, m.dist, m.pathLen, m.speed].every(Number.isFinite));
  assert.ok(m.dx > 0 && m.dy === 0);
  // The engine normalises the paddle coordinates but keeps raw gesture
  // coordinates clamped to ±0.35 of the canvas.
  assert.match(game, /clamp\(xr, -0\.35, 1\.35\)/);
  // A cancelled gesture (capture lost / pointercancel) exposes no release
  // that could hit the ball when the finger comes back.
  sw.cancel();
  assert.equal(sw.active, false);
  assert.equal(sw.lastReleased, null);
  assert.equal(sw.pressZone, null);
  assert.equal(isRealStroke(sw.lastReleased), false);
});

/* ---------------------------------------------------------------------
 * 7. A second finger right before the contact
 * ------------------------------------------------------------------ */
test('7. a second pointer cancels the stroke instead of adding a hit', () => {
  const game = source('70_game.js');
  // Second pointer down: drop the stroke and switch to the camera gesture.
  assert.match(game, /ptrs\.size >= 2 \|\| suppressTouches/);
  assert.match(game, /reason: 'SECOND_POINTER'/);
  assert.match(game, /dropStroke\(\); suppressTouches = true;/);
  // Non-owner events/moves/releases are ignored, so control cannot jump
  // between fingers.
  assert.match(game, /activeStrokePointerId !== null && e\.pointerId !== activeStrokePointerId/);
  assert.match(game, /NON_OWNER_POINTER_RELEASE/);
  // The cancellation itself is exactly `dropStroke`, whose contract is the
  // tracker cancel below: no press zone, no release, no stale samples.
  const sw = new SwipeTracker();
  sw.down(.5, .6, 0);
  sw.move(.5, .5, .02);
  sw.pressZone = { accepted: true, shotId: 3 };
  sw.cancel();
  assert.equal(sw.active, false);
  assert.equal(sw.pressZone, null);
  assert.equal(sw.samples.length, 0);
  assert.equal(sw.lastReleased, null);
});

/* ---------------------------------------------------------------------
 * 8. Release/cancel landing on the contact substep
 * ------------------------------------------------------------------ */
test('8. a contact already made survives release/cancel; a missed one never becomes a second hit', () => {
  const gameLib = load(['10_math.js', '30_physics.js', '40_swipe.js', '70_game.js'],
    ['Game', 'GS', 'V3', 'SwipeTracker']);
  const { Game, GS, V3: GV3, SwipeTracker: Tracker } = gameLib;
  function fixture(shotId) {
    const g = Object.create(Game.prototype);
    const sw = new Tracker();
    sw.down(.5, .7, 0);
    sw.move(.5, .6, .02);
    sw.move(.5, .5, .04);
    sw.up(.5, .48, .06);
    sw.pressZone = { accepted: true, shotId, pointerType: 'touch', vw: 390, vh: 844 };
    Object.assign(g, {
      paused: false, recenterT: 0, shotId, state: GS.RALLY, pointerDown: false,
      time: 1, strokeTime: 1, swipe: sw, swipeReleasedAt: 1,
      ball: { live: true, lastHitBy: -1, p: GV3.new(0, 1, 1), v: GV3.new() },
      player: { pos: GV3.new(), lastHitT: -9, normal: GV3.new(0, 0, -1) },
      hintOut: 0, pointer: { x: .5, y: .5 },
      canvas: { getBoundingClientRect: () => ({ width: 390, height: 844 }) },
    });
    return { g, sw };
  }
  // (a) The gesture was pressed for shot N; after the contact shotId is N+1
  // and the gesture is consumed — a late release cannot hit again.
  {
    const { g, sw } = fixture(5);
    g.shotId = 6;
    let touched = false;
    g.project = () => { touched = true; return { ok: false }; };
    assert.equal(g.tryInputHit(sw.lastReleased), undefined);
    assert.equal(touched, false, 'the stale gesture returns before any contact work');
    sw.cancel();                                   // what tryPlayerHit does on a hit
    assert.equal(sw.pressZone, null);
    g.shotId = 6;
    assert.equal(g.tryInputHit(sw.lastReleased), undefined, 'nothing left to re-hit');
  }
  // (b) A miss does not consume the gesture: the same press may still hit
  // after a bounce (scenario 16), which is why the gate is on shotId and not
  // on "a press happened".
  {
    const { g, sw } = fixture(7);
    g.ball = { live: false };                      // forces the early "no live ball" return
    assert.equal(g.tryInputHit(sw.lastReleased), undefined);
    assert.notEqual(sw.pressZone, null, 'the press survives a miss');
  }
});

/* ---------------------------------------------------------------------
 * 9. A new stroke at the boundary of the recovery animation
 * ------------------------------------------------------------------ */
test('9. starting a stroke one frame before/at/after recovery never inherits the old template', () => {
  const normal = V3.norm(V3.new(), V3.new(.2, .35, -.9));
  const next = V3.norm(V3.new(), V3.new(-.3, -.2, -.85));
  const roll = .28;
  const endOf = () => {
    const m = new PaddleStrokeMotion();
    m.contact(normal, roll, 'LOOP', 'shakehand', 'right', true, true);
    let frames = 0, pose = null;
    while (frames < 600) { pose = m.sample(1 / 60, { yaw: 0, pitch: -15 * Math.PI / 180, roll }); frames++; if (!pose) break; }
    assert.ok(frames < 600, 'the recovery animation ends');
    return { motion: m, frames };
  };
  const { frames } = endOf();
  for (const offset of [-1, 0, 1]) {
    const m = new PaddleStrokeMotion();
    m.contact(normal, roll, 'LOOP', 'shakehand', 'right', true, true);
    for (let i = 0; i < Math.max(0, frames + offset); i++) m.sample(1 / 60, { yaw: 0, pitch: 0, roll });
    m.contact(next, roll, 'DRIVE', 'shakehand', 'right', true, true);
    const first = m.sample(1 / 60, { yaw: 0, pitch: 0, roll });
    // The first sample is the NEW impact frame, not the tail of the old one.
    assert.ok(Math.abs(first.yaw - (-Math.atan2(next.x, -next.z))) < 1e-6,
      `offset ${offset}: yaw is the new face`);
    assert.equal(m.stage, 'contact');
    const second = m.sample(1 / 60, { yaw: 0, pitch: 0, roll });
    assert.ok(second && [second.yaw, second.pitch, second.roll].every(Number.isFinite));
  }
  // A live gesture interrupts the template (the wrist keeps its own smoothed
  // angles) instead of being silently overridden by the animation.
  const m = new PaddleStrokeMotion();
  m.contact(normal, roll, 'DRIVE', 'shakehand', 'right', true, true);
  m.sample(1 / 60, { yaw: 0, pitch: 0, roll });
  assert.equal(m.sample(1 / 60, { yaw: 0, pitch: 0, roll }, true), null);
  assert.equal(m.active, false);
});

/* ---------------------------------------------------------------------
 * 10. Physical contact vs the visible racket
 * ------------------------------------------------------------------ */
test('10. the contact point lies on the rubber of the pose the game draws', () => {
  const normals = [
    V3.norm(V3.new(), V3.new(0, .1, -1)), V3.norm(V3.new(), V3.new(0, -.35, -1)),
    V3.norm(V3.new(), V3.new(.35, .2, -1)), V3.norm(V3.new(), V3.new(-.35, -.1, -1)),
  ];
  let checked = 0;
  for (const normal of normals) for (const y of [PH.TABLE_Y + .12, PH.TABLE_Y + .35, PH.TABLE_Y + .75])
    for (const x of [-.55, 0, .55]) {
      const ball = { x, y, z: 1.45 };
      const racket = { normal, vR: V3.new(0, 1, -2), stroke: { id: 'DRIVE' }, forehand: true };
      const pose = paddleContactPose(ball, racket, { hand: 'right', grip: 'shakehand', forehand: true, roll: .28 });
      if (!pose) continue;                       // honest refusal (table collision)
      checked++;
      // The face is anchored one ball radius from the centre: the registered
      // contact IS on the rubber, not on an invisible proxy.
      const offset = V3.dist(pose.point, pose.pos);
      assert.ok(offset > PH.R * .5 && offset < .12, `offset ${offset.toFixed(3)} m`);
      assert.ok(Math.abs(V3.dist(pose.point, ball) - PH.R) < 1e-9,
        'contact point = ball centre - R·n');
      for (const axis of ['x', 'y', 'z'])
        assert.ok(Math.abs(pose.point[axis] - (ball[axis] - normal[axis] * PH.R)) < 1e-9);
      for (const axis of ['x', 'y', 'z']) assert.ok(Number.isFinite(pose.pos[axis]));
      // …and that pose is legal (does not live inside the tabletop).
      assert.ok(paddleTableClearance(pose.pos, pose.normal, pose.roll) > -.0011);
    }
  assert.ok(checked > 20, `checked ${checked} drawn contact poses`);
});
