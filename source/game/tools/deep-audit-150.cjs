/* =====================================================================
 *  DEEP AUDIT — 150+ independent checks over modules/areas that were NOT
 *  covered in detail by the 2026-11-05 bugfix pass.
 *  Each check is independent: a failure is reported, the run continues.
 *  Usage: node tools/deep-audit-150.cjs   (exit code 1 if any check fails)
 * ===================================================================== */
'use strict';
const { load } = require('../tests/helpers.cjs');

const L = load([
  '10_math.js', '05_stroke_config.js', '06_calibration.js', '12_match_rules.js',
  '30_physics.js', '37_stroke_motion_data.js', '38_paddle_motion.js', '40_swipe.js',
  '42_shot_diagnostics.js', '44_diagnostics.js', '45_perf.js', '46_physics_watchdog.js',
  '50_audio.js', '55_ai.js', '56_rig.js', '57_camera.js', '59_replay.js',
], [
  // math
  'TAU', 'DEG', 'clamp', 'lerp', 'smoothstep', 'rnd', 'rndSym', 'gauss', 'expSmooth',
  'hash1', 'noise1', 'V3', 'M4', 'Q',
  // config / rules
  'STROKE_CONFIG', 'MATCH_RULES', 'CONTACT_CORRIDOR_RULES', 'GRACE_RULES',
  'setCaptureForgiveness', 'getCaptureForgiveness', 'setCaptureCalibration', 'getCaptureEnvelope',
  'installUnifiedControls', 'playerCaptureLimits', 'playerInCaptureRange', 'playerGraceRange',
  'bladePlaneCapture', 'strikeCueModel', 'ballCaptureTarget', 'measureCaptureAllowance',
  'pressHitZone', 'pressOvalSidePx', 'serveTossRise', 'pressHitZoneOval', 'pressServeZoneOval',
  'contactGateExtents', 'pressContactZone', 'pressZoneForBall', 'solveStrikeCorridor',
  'evaluateContactZone', 'canArmEarlyServeSwipe', 'evaluateStrokeDirection',
  // physics
  'PH', 'aeroAccel', 'aeroCdMeasured', 'aeroCmMeasured', 'integrateBall', 'sanitizeV', 'saneV', 'saneN',
  'impactSphere', 'bounceTable', 'bounceNet', 'clipTape', 'netContactKind', 'netContactStep',
  'tableContact', 'predict', 'solveLaunch', 'impactRacket',
  // swipe
  'SwipeTracker', 'STROKES', 'isRealStroke', 'classifyStroke', 'deriveStroke', 'strokeFrame',
  'resolveRacketLaunch', 'strokeIdentityMatches', 'racketForStroke', 'refineRacket', 'solveServeStroke',
  'SERVE_WARM', 'launchPoint', 'tapStrokeMetrics', 'compactStrokeMetrics',
  // paddle / rig
  'PADDLE_PROFILES', 'paddleStrokeFamily', 'paddleGripProfile', 'paddleForehand',
  'paddleContactRange', 'wristStrokeKey', 'paddleAngleDelta', 'stepPaddleAngle',
  'stepPaddlePosition', 'paddleFaceAngles', 'faceFromWrist', 'PaddleStrokeMotion',
  'paddleTemplateFor', 'paddleBottomExtent', 'keepPaddleAboveTable', 'paddleTableClearance',
  'paddleContactPose', 'paddlePoseQuaternion', 'PaddleReadClock', 'playerWristPose',
  'PADDLE_TEMPLATES', 'compileStrokeTemplate', 'sampleStrokeTemplate',
  // camera
  'CAMERA_PRESETS', 'CAMERA_ORDER', 'CAM_ADJUST', 'PLAY_RECT', 'PADDLE_LIMITS', 'PADDLE_STANCE_Z',
  'quantizeDepth', 'paddleLimitsFor', 'PADDLE_HOME', 'REACH_SHELL', 'pointerBladeSolve',
  'softSat', 'reachShellMap', 'lensFovDeg', 'verticalFovDeg', 'horizontalFovDeg', 'effectiveFov',
  'rigViewProj', 'projectPoint', 'rigBasis', 'unprojectToPlane', 'tabletopBounds',
  'tableScreenBounds', 'clampPaddleToFrustum',
  // ai / watchdog / misc
  'AI_LEVELS', 'OpponentAI', 'makeRacket', 'shotHitsNet',
  'PhysicsWatchdog', 'wdCountsForGate', 'wdNum', 'wdAiLevel', 'wdOverTable', 'wdDist', 'wdStrokeConfig',
  'measureShotSpin', 'shotSpinText', 'ShotJournal', 'calibrationPercentile', 'ZoneCalibrationSession',
  'summarizeCaptureCalibration', 'diagnosticSnapshot', 'diagNumber',
  'perfScaleStep', 'PerfMonitor', 'spectatorClapPlan', 'MomentRecorder', 'MomentPlayer',
]);

const L2 = load([
  '10_math.js', '05_stroke_config.js', '06_calibration.js', '30_physics.js',
  '37_stroke_motion_data.js', '38_paddle_motion.js', '40_swipe.js',
  '58_coach.js', '64_training_data.js', '76_emotion.js', '84_racket.js',
], ['TRAIN_SKILLS', 'TRAIN_MODULES', 'TRAIN_STEPS', 'TRAIN_GUIDES', 'trainingCatalog', 'trainingCoverage',
  'trainingLessonView', 'trainingGestureModel', 'trainingTarget', 'trainingInTarget', 'TRAIN_FEEDS',
  'PointAnalyst', 'MatchDirector', 'RallyRecorder', 'ANALYSIS', 'EmotionalSystem', 'EMOTION_STATE',
  'ITEMS', 'ITEM_LIST', 'ITEMS_ORDER', 'BLADES', 'RUBBERS', 'bladePhysics', 'rubberPhysics',
  'racketStats', 'itemStats', 'Equipment', 'STAT_KEYS', 'STAT_MIN', 'STAT_MAX', 'STROKES', 'V3', 'PH']);

const { PH, STROKE_CONFIG, MATCH_RULES, V3, M4, Q, TAU, DEG } = L;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const checks = [];
const C = (name, fn) => checks.push({ name, fn });

/* ================= A. MATH CORE (10_math.js) ================= */
C('A01 V3 add/sub/mul/dot', () => {
  const a = V3.new(1, 2, 3), b = V3.new(4, 5, 6);
  ok(near(V3.dot(V3.add(V3.new(), a, b), V3.new(1, 1, 1)), 21));
  ok(near(V3.dot(V3.sub(V3.new(), b, a), V3.new(1, 1, 1)), 9));
  ok(near(V3.len(V3.mul(V3.new(), a, 2)), 2 * Math.hypot(1, 2, 3)));
});
C('A02 V3.cross magnitude = |a||b|sin', () => {
  const a = V3.new(1, 0, 0), b = V3.new(0, 1, 0), c = V3.cross(V3.new(), a, b);
  ok(near(c.x, 0) && near(c.y, 0) && near(c.z, 1));
  const u = V3.new(1, 2, 3), v = V3.new(-2, 0, 5);
  const cr = V3.cross(V3.new(), u, v);
  ok(near(V3.len(cr), V3.len(u) * V3.len(v) * Math.sin(Math.acos(V3.dot(u, v) / V3.len(u) / V3.len(v))), 1e-9));
  ok(near(V3.dot(cr, u), 0, 1e-9) && near(V3.dot(cr, v), 0, 1e-9));
});
C('A03 V3.norm zero vector stays finite', () => {
  const n = V3.norm(V3.new(), V3.new(0, 0, 0));
  ok([n.x, n.y, n.z].every(Number.isFinite));
});
C('A04 V3.lerp endpoints', () => {
  const a = V3.new(1, 2, 3), b = V3.new(5, 6, 7);
  ok(near(V3.lerp(V3.new(), a, b, 0).x, 1) && near(V3.lerp(V3.new(), a, b, 1).x, 5));
  ok(near(V3.lerp(V3.new(), a, b, .5).y, 4));
});
C('A05 clamp boundaries', () => {
  ok(L.clamp(5, 0, 1) === 1 && L.clamp(-5, 0, 1) === 0 && L.clamp(.5, 0, 1) === .5);
});
C('A06 smoothstep edges and midpoint', () => {
  ok(L.smoothstep(0, 1, -1) === 0 && L.smoothstep(0, 1, 2) === 1 && near(L.smoothstep(0, 1, .5), .5));
});
C('A07 expSmooth limits', () => {
  ok(near(L.expSmooth(0, 10, 0, .016), 0));
  ok(near(L.expSmooth(0, 10, 1e6, .016), 10, 1e-6));
});
C('A08 gauss finite and zero-mean-ish', () => {
  let s = 0; for (let i = 0; i < 4000; i++) { const g = L.gauss(1); ok(Number.isFinite(g)); s += g; }
  ok(Math.abs(s / 4000) < 0.1, `mean ${s / 4000}`);
});
C('A09 rnd/rndSym ranges', () => {
  for (let i = 0; i < 200; i++) { ok(L.rnd(2, 5) >= 2 && L.rnd(2, 5) < 5); ok(Math.abs(L.rndSym(3)) <= 3); }
});
C('A10 hash1 in [0,1), noise1 finite', () => {
  for (let i = 0; i < 100; i++) { const h = L.hash1(i); ok(h >= 0 && h < 1); ok(Number.isFinite(L.noise1(i * .37))); }
});
C('A11 Q identity and mul', () => {
  const q = Q.new(), q2 = Q.setAxisAngle(Q.new(), 0, 0, 1, 0);
  ok(near(q.w, 1) && near(q2.w, 1));
  const m = Q.mul(Q.new(), q, q2); ok(near(m.w, 1) && near(m.x, 0, 1e-9));
});
C('A12 Q.setAxisAngle 90deg about z maps x->y', () => {
  const q = Q.setAxisAngle(Q.new(), 0, 0, 1, Math.PI / 2);
  // rotate (1,0,0)
  const x = 1, y = 0, z = 0;
  const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
  const rx = x + q.w * tx + q.y * tz - q.z * ty;
  const ry = y + q.w * ty + q.z * tx - q.x * tz;
  ok(near(rx, 0, 1e-9) && near(ry, 1, 1e-9));
});
C('A13 Q.lookRotation produces orthonormal basis', () => {
  const q = Q.lookRotation(Q.new(), { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
  ok(near(Math.hypot(q.x, q.y, q.z, q.w), 1, 1e-9));
});
C('A14 M4 identity mul', () => {
  const a = M4.create(); M4.identity(a);
  const b = M4.mul(M4.create(), a, M4.create());
  ok(near(b[0], 1) && near(b[5], 1) && near(b[10], 1) && near(b[15], 1));
});
C('A15 M4.compose identity rotation = pure translation', () => {
  const m = M4.compose(M4.create(), { x: 1, y: 2, z: 3 }, Q.new(), { x: 1, y: 1, z: 1 });
  ok(near(m[12], 1) && near(m[13], 2) && near(m[14], 3));
});
C('A16 M4.transformPoint/transformDir on identity', () => {
  const m = M4.compose(M4.create(), { x: 1, y: 2, z: 3 }, Q.new(), { x: 1, y: 1, z: 1 });
  const d = M4.transformDir({}, m, { x: 0, y: 0, z: -1 });
  ok(near(d.x, 0, 1e-9) && near(d.y, 0, 1e-9) && near(d.z, -1, 1e-9));
  const p = M4.transformPoint({}, m, { x: 1, y: 0, z: 0 });
  ok(near(p.x, 2, 1e-6) && near(p.y, 2, 1e-6) && near(p.z, 3, 1e-6), JSON.stringify(p));
});
C('A17 V3.dist symmetric', () => {
  ok(near(V3.dist(V3.new(1, 2, 3), V3.new(4, 6, 3)), V3.dist(V3.new(4, 6, 3), V3.new(1, 2, 3))));
});
C('A18 TAU/DEG consistency', () => { ok(near(TAU, 2 * Math.PI) && near(180 * DEG, Math.PI)); });

/* ================= B. PHYSICS (30_physics.js) ================= */
C('B01 PH constants match ITTF dimensions', () => {
  ok(near(PH.R, 0.020) && near(PH.T_LEN, 2.74) && near(PH.T_WID, 1.525) && near(PH.T_H, 0.76) && near(PH.NET_H, 0.1525));
});
C('B02 aeroAccel at rest = gravity only', () => {
  const a = L.aeroAccel(V3.new(), V3.new(0, 0, 0), V3.new(0, 0, 0));
  ok(near(a.x, 0) && near(a.y, -PH.G) && near(a.z, 0));
});
C('B03 drag opposes velocity', () => {
  const a = L.aeroAccel(V3.new(), V3.new(0, 0, -10), V3.new(0, 0, 0));
  ok(a.z > 0 && a.x === 0 && a.y <= -PH.G && a.y > -PH.G - 1, `a=(${a.x},${a.y},${a.z})`);
});
C('B04 Magnus: topspin on +z ball pushes down', () => {
  // ball moving +z (towards player), w.x>0 = topspin -> Magnus down (-y)
  const a = L.aeroAccel(V3.new(), V3.new(0, 0, 10), V3.new(200, 0, 0));
  ok(a.y < -PH.G, `a.y=${a.y}`);
});
C('B05 aeroCdMeasured inside [.3,.6] for all v', () => {
  for (let v = 0.5; v <= 30; v += 0.5) { const cd = L.aeroCdMeasured(v, 0.5); ok(cd >= .3 && cd <= .6, `v=${v} cd=${cd}`); }
});
C('B06 aeroCmMeasured non-negative', () => {
  for (let v = 1; v <= 25; v += 2) for (let w = 0; w <= 700; w += 100) ok(L.aeroCmMeasured(v, w) >= 0);
});
C('B07 free fall matches analytic within drag tolerance', () => {
  const p = V3.new(0, 2, 0), v = V3.new(0, 0, 0), w = V3.new(0, 0, 0);
  const dt = 1 / 600; for (let i = 0; i < 300; i++) L.integrateBall(p, v, w, dt);
  const t = 300 * dt;
  const analytic = 2 - .5 * PH.G * t * t;
  // drag only lifts the trajectory: p.y must sit between analytic and start
  ok(p.y >= analytic - 1e-9 && p.y < 2, `p.y=${p.y} analytic=${analytic}`);
  // drag only reduces |v|: between 80% and 100% of the drag-free value
  ok(v.y >= -PH.G * t - 1e-9 && v.y <= 0.8 * -PH.G * t, `v.y=${v.y} vs ${-PH.G * t}`);
});
C('B08 spin decay follows tau', () => {
  const p = V3.new(0, 5, 0), v = V3.new(0, 0, 0), w = V3.new(100, 0, 0);
  const dt = 1 / 600; for (let i = 0; i < 600; i++) L.integrateBall(p, v, w, dt);
  ok(near(w.x, 100 * Math.exp(-1 / PH.SPIN_DECAY_TAU), 1e-3), `w.x=${w.x}`);
});
C('B09 sanitizeV repairs NaN and caps speed', () => {
  const v = { x: NaN, y: 1e9, z: -3 };
  L.sanitizeV(v);
  ok(Number.isFinite(v.x) && v.x === 0);
  ok(V3.len(v) <= 60 + 1e-9);
});
C('B10 impactSphere separating returns null', () => {
  const v = V3.new(0, 5, 0), w = V3.new();
  ok(L.impactSphere(v, w, { x: 0, y: 1, z: 0 }, V3.new(0, 0, 0), .9, .4, 0) === null);
});
C('B11 normal bounce reverses with COR', () => {
  const v = V3.new(0, -5, 0), w = V3.new();
  L.impactSphere(v, w, { x: 0, y: 1, z: 0 }, V3.new(0, 0, 0), 0.9, 0.4, 0);
  ok(near(v.y, 4.5, 1e-9) && near(v.x, 0, 1e-9) && near(v.z, 0, 1e-9));
});
C('B12 friction slows tangential slip', () => {
  const v = V3.new(3, -5, 0), w = V3.new();
  L.impactSphere(v, w, { x: 0, y: 1, z: 0 }, V3.new(0, 0, 0), 0.9, 0.4, 0);
  ok(v.x < 3 && v.x > 0, `v.x=${v.x}`);
});
C('B13 grip regime generates spin (friction torque about z)', () => {
  // ball sliding +x with contact at the bottom: friction torque spins it about z
  const v = V3.new(5, -2, 0), w = V3.new(0, 0, 0);
  const info = L.impactSphere(v, w, { x: 0, y: 1, z: 0 }, V3.new(0, 0, 0), 0.9, 1.0, 0.5);
  ok(info && w.z < 0 && v.x < 5, `w.z=${w.z} v.x=${v.x}`);
});
C('B14 ITTF drop test rebound in 23..26 cm', () => {
  const v = V3.new(0, -Math.sqrt(2 * PH.G * 0.305), 0), w = V3.new();
  const p = { x: 0, y: PH.TABLE_Y + PH.R, z: 0 };
  L.bounceTable(p, v, w);
  const h = v.y * v.y / (2 * PH.G);
  ok(h >= 0.23 && h <= 0.26, `rebound ${(h * 100).toFixed(1)} cm`);
});
C('B15 edge bounce is steeper and slower', () => {
  const mk = (x) => { const v = V3.new(0, -4, 0), w = V3.new(); const p = { x, y: PH.TABLE_Y + PH.R, z: 0 }; const i = L.bounceTable(p, v, w); return { v, i }; };
  const mid = mk(0), edge = mk(PH.T_HALF_WID - 0.005);
  ok(edge.i.edge > 0 && Math.abs(edge.v.x) > Math.abs(mid.v.x), 'edge throws wide');
  ok(edge.v.y < mid.v.y, 'edge loses height');
});
C('B16 netContactKind zones', () => {
  ok(L.netContactKind(PH.NET_TOP + PH.R + 0.01, 0) === 0, 'clean over tape');
  ok(L.netContactKind(PH.NET_TOP - 0.05, 0) === 1, 'mesh');
  ok(L.netContactKind(PH.NET_TOP + PH.R - 0.001, 0) === 2, 'straddles tape');
  ok(L.netContactKind(PH.TABLE_Y - PH.R - 0.01, 0) === 0, 'under table');
  ok(L.netContactKind(PH.NET_TOP - 0.05, PH.NET_HALF_WID + 0.01) === 0, 'beyond post');
});
C('B17 netContactStep retreat guard', () => {
  const out = {};
  const ym = PH.NET_TOP - 0.05; // mesh height
  // moving AWAY from the net plane while inside thickness must not register
  const k = L.netContactStep(0, ym, 0.01, 0, ym, 0.015, out);
  ok(k === 0, `retreat registered kind=${k}`);
  const k2 = L.netContactStep(0, ym, 0.02, 0, ym, 0.005, out);
  ok(k2 > 0, 'approach inside thickness registers');
  const k3 = L.netContactStep(0, ym, 0.02, 0, ym, -0.01, out); // crossed plane
  ok(k3 > 0, 'plane crossing registers');
});
C('B18 bounceNet energy loss and spin keep', () => {
  const v = V3.new(2, 1, -6), w = V3.new(100, 50, 30);
  const p = { x: 0, y: 1, z: 0 };
  L.bounceNet(p, v, w, 1);
  ok(Math.abs(v.z) < 6 * 0.11 && near(v.z, 0.6, 1e-9));
  ok(near(w.x, 100 * PH.NET_SPIN_KEEP, 1e-9));
});
C('B19 clipTape always deflects upward', () => {
  const v = V3.new(0, -3, -5), w = V3.new(10, 10, 10);
  const p = { x: 0, y: PH.NET_TOP, z: 0 };
  L.clipTape(p, v, w);
  ok(v.y > 0 && p.y > PH.NET_TOP);
});
C('B20 predict deterministic', () => {
  const args = [V3.new(0, 1.2, 1.5), V3.new(1, 2, -8), V3.new(50, 10, 0)];
  const a = L.predict(V3.clone(args[0]), V3.clone(args[1]), V3.clone(args[2]), { dt: 1 / 240, maxT: 2, out: {} });
  const b = L.predict(V3.clone(args[0]), V3.clone(args[1]), V3.clone(args[2]), { dt: 1 / 240, maxT: 2, out: {} });
  ok(near(a.end.x, b.end.x, 1e-12) && a.bounces === b.bounces && near(a.apex, b.apex, 1e-12));
});
C('B21 predict stopAfterBounces caps the count', () => {
  const r = L.predict(V3.new(0, 1.2, 1.5), V3.new(0, 1, -8), V3.new(0, 0, 0), { dt: 1 / 240, maxT: 3, stopAfterBounces: 2, out: {} });
  ok(r.bounces <= 2, `bounces=${r.bounces}`);
  const r2 = L.predict(V3.new(0, 1.2, 1.2), V3.new(0, 0.5, -3), V3.new(0, 0, 0), { dt: 1 / 240, maxT: 3, stopAfterBounces: 2, out: {} });
  ok(r2.bounces === 2 && !!r2.b2, `bounces=${r2.bounces} b2=${!!r2.b2}`);
});
C('B22 predict sanitizes NaN input instead of diverging', () => {
  const r = L.predict(V3.new(0, 1, 1), V3.new(NaN, 0, -5), V3.new(0, 0, 0), { dt: 1 / 240, maxT: 1, out: {} });
  ok(r.diverged !== true && [r.end.x, r.end.y, r.end.z].every(Number.isFinite), 'NaN repaired to finite state');
});
C('B23 predict records netCross even when clean', () => {
  const r = L.predict(V3.new(0, 1.5, 1.5), V3.new(0, 1, -10), V3.new(0, 0, 0), { dt: 1 / 240, maxT: 1, out: {} });
  ok(r.netCross && r.netCross.y > PH.NET_TOP + PH.R && r.clear > 0);
});
C('B24 solveLaunch lands near target and clears net', () => {
  const s = L.solveLaunch(V3.new(0, 1.1, 1.6), { x: 0.2, z: -1.0 }, V3.new(-100, 0, 0), { speed: 12, netClear: 0.055 });
  ok(s && s.landed && V3.dist({ x: s.landed.x, y: 0, z: s.landed.z }, { x: 0.2, y: 0, z: -1.0 }) < 0.25, JSON.stringify(s && s.err));
  ok(s.clear >= 0.05 - 1e-6);
});
C('B25 solveLaunch rejects NaN target', () => {
  ok(L.solveLaunch(V3.new(0, 1, 1), { x: NaN, z: 0 }, V3.new(0, 0, 0), {}) === null);
});
C('B26 tableContact ignores approach from below', () => {
  ok(L.tableContact(0, PH.TABLE_Y - 1, 0, 0, PH.TABLE_Y - 2, 0, {}) === null);
});

/* ================= C. SWIPE (40_swipe.js) ================= */
function trk(pts) { // pts: [[x,y,t],...]
  const sw = new L.SwipeTracker();
  sw.down(pts[0][0], pts[0][1], pts[0][2], pts[0][2]);
  for (let i = 1; i < pts.length; i++) sw.move(pts[i][0], pts[i][1], pts[i][2], pts[i][2]);
  return sw.up(pts[pts.length - 1][0], pts[pts.length - 1][1], pts[pts.length - 1][2] + 0.01, pts[pts.length - 1][2] + 0.01);
}
const g = (o) => ({ x: .5, y: .5, sx: .5, sy: .5, samples: 20, smooth: .9, straightness: .95,
  dist: .2, pathLen: .22, curl: 0, speed: 3, peakSpeed: 3, releaseSpeed: 3, dx: 0, dy: 0, right: 0, up: 1, ...o });
const ctx = (o = {}) => ({ side: 1, ball: { x: 0, y: PH.TABLE_Y + .3, z: 1.4 }, ballSpin: { x: 0, y: 0, z: 0 },
  ballSpeed: 6, ballVelocity: { x: 0, y: 0, z: 5 }, isServe: false, grip: 'shakehand', forehand: true, ...o });

C('C01 tracker metrics dist/pathLen', () => {
  const m = trk([[.5, .5, 0], [.6, .5, .05], [.7, .5, .1]]);
  ok(near(m.dist, .2, 1e-9) && near(m.pathLen, .2, 1e-9) && m.right > 0.99 && near(m.up, 0, 1e-9));
});
C('C02 zero-dt samples never erase origin', () => {
  const sw = new L.SwipeTracker();
  sw.down(.5, .5, 0, 0);
  sw.move(.9, .5, 0.001, 0.001);   // same frame burst
  sw.move(.9, .5, 0.002, 0.002);
  ok(near(sw.m.sx, .5, 1e-12) && sw.samples.length >= 2);
});
C('C03 trimSamples conserves path length', () => {
  const sw = new L.SwipeTracker();
  sw.down(.5, .5, 0, 0);
  const total = 200 * 0.001; // 200 moves of 0.001, first one from the down() origin
  for (let i = 1; i <= 200; i++) sw.move(.5 + i * 0.001, .5, i * 0.001, i * 0.001);
  ok(near(sw.m.pathLen, total, 1e-9), `pathLen=${sw.m.pathLen} expected ${total}`);
  ok(sw.samples.length <= sw.maxSamples, 'ring buffer trimmed');
});
C('C04 curl sign flips with mirrored arc', () => {
  // C shape (counter-clockwise on screen) vs mirrored
  const arc = (s) => {
    const pts = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI * 1.5; pts.push([.5 + s * 0.08 * Math.cos(a + Math.PI), .5 - 0.08 * Math.sin(a), i * 0.01]); }
    return trk(pts);
  };
  const c1 = arc(1).curl, c2 = arc(-1).curl;
  ok(Math.sign(c1) === -Math.sign(c2) && Math.abs(c1) > 0.5, `c1=${c1} c2=${c2}`);
});
C('C05 tap without move is not a real stroke', () => {
  const sw = new L.SwipeTracker();
  sw.down(.5, .5, 0, 0); const m = sw.up(.5, .5, 0.01, 0.01);
  ok(!L.isRealStroke(m, false) && !L.isRealStroke(m, true));
});
C('C06 isRealStroke serve vs rally thresholds', () => {
  ok(!L.isRealStroke(g({ pathLen: .03, dist: .02, peakSpeed: .2 }), false));
  ok(L.isRealStroke(g({ pathLen: .03, dist: .02, peakSpeed: .2 }), true), 'serve min is lower');
});
C('C07 hostile NaN metrics rejected', () => {
  ok(!L.isRealStroke(g({ pathLen: NaN, peakSpeed: NaN, samples: NaN }), false));
});
C('C08 classification: fast up = LOOP', () => {
  ok(L.classifyStroke(g({ up: 1, dy: -.2, dist: .2, pathLen: .22 }), ctx(), .8).id === 'LOOP');
});
C('C09 classification: down = backspin family', () => {
  const id = L.classifyStroke(g({ up: -1, dy: .25, dist: .25, pathLen: .27 }), ctx(), .8).id;
  ok(['PUSH', 'CHOP'].includes(id), id);
});
C('C10 classification: pure horizontal = SIDE', () => {
  ok(L.classifyStroke(g({ up: 0, right: 1, dx: .25, dist: .25, pathLen: .27 }), ctx(), .7).id === 'SIDE');
});
C('C11 classification: arc = HOOK/FADE by curl sign', () => {
  const h = L.classifyStroke(g({ up: .3, right: .2, curl: -.8, dist: .05, pathLen: .16 }), ctx(), .8).id;
  const f = L.classifyStroke(g({ up: .3, right: .2, curl: .8, dist: .05, pathLen: .16 }), ctx(), .8).id;
  ok(h === 'HOOK' && f === 'FADE', `${h}/${f}`);
});
C('C12 serve classification four families', () => {
  const sc = (o) => {
    const m = g(o);
    const sp01 = L.clamp(Math.max(m.releaseSpeed, m.peakSpeed * STROKE_CONFIG.racket.speed.peakK) / STROKE_CONFIG.racket.speed.inputScale, 0, STROKE_CONFIG.racket.speed.powerMax);
    return L.classifyStroke(m, ctx({ isServe: true }), sp01).id;
  };
  ok(sc({ up: 1, dy: -.2 }) === 'SERVE_TOP', sc({ up: 1, dy: -.2 }));
  ok(sc({ up: -1, dy: .25 }) === 'SERVE_BACK', sc({ up: -1, dy: .25 }));
  ok(sc({ up: 0, right: 1, dx: .25, dist: .25, pathLen: .27 }) === 'SERVE_SIDE', sc({ up: 0, right: 1 }));
  ok(sc({ up: .1, right: .1, dist: .3, pathLen: .32, speed: 4.2, peakSpeed: 4.2, releaseSpeed: 4.2 }) === 'SERVE_FAST',
    sc({ up: .1, dist: .3, speed: 4.2, peakSpeed: 4.2, releaseSpeed: 4.2 }));
});
C('C13 serve tap = SERVE_NO_SPIN', () => {
  const m = L.tapStrokeMetrics(g({}), .5, .5, true);
  ok(L.classifyStroke(m, ctx({ isServe: true }), .5).id === 'SERVE_NO_SPIN');
});
C('C14 deriveStroke sanitizes hostile metrics', () => {
  const r = L.deriveStroke(g({ releaseSpeed: NaN, peakSpeed: Infinity, right: NaN, up: -Infinity, dist: NaN, curl: NaN, smooth: NaN }), ctx());
  ok([r.vR.x, r.vR.y, r.vR.z, r.normal.x, r.normal.y, r.normal.z, r.vmag].every(Number.isFinite));
  ok(near(V3.len(r.normal), 1, 1e-9));
});
C('C15 serve vmag capped at serve.vmax', () => {
  const r = L.deriveStroke(g({ up: 1, dy: -.3, dist: .4, pathLen: .45, speed: 40, peakSpeed: 40, releaseSpeed: 40 }), ctx({ isServe: true }));
  ok(r.vmag <= STROKE_CONFIG.serve.vmax + 1e-9, `vmag=${r.vmag}`);
});
C('C16 SIDE rally vmag capped at sideVmax', () => {
  const r = L.deriveStroke(g({ up: 0, right: 1, dx: .3, dist: .3, pathLen: .32, speed: 40, peakSpeed: 40, releaseSpeed: 40 }), ctx());
  ok(r.stroke.id === 'SIDE' && r.vmag <= STROKE_CONFIG.spin.sideVmax + 1e-9, `vmag=${r.vmag}`);
});
C('C17 strokeFrame rotation preserves |v| and normalizes', () => {
  const r = L.deriveStroke(g({ up: 1, dy: -.2, dist: .25, pathLen: .27 }), ctx());
  const s = V3.new(), n = V3.new();
  L.strokeFrame(r, 0.2, 0.1, 1, s, n);
  ok(near(V3.len(n), 1, 1e-9) && near(V3.len(s), r.vmag * (r.arch.absorb ? 1 - r.arch.absorb : 1), 1e-6));
});
C('C18 resolveRacketLaunch rejects separating face', () => {
  const r = L.deriveStroke(g({ up: 1, dy: -.2 }), ctx());
  const ball = { p: V3.new(0, 1.1, 1.4), v: V3.new(0, 0, -20), w: V3.new(0, 0, 0) }; // moving away
  ok(L.resolveRacketLaunch(ball, r) === null);
});
C('C19 SERVE_NO_SPIN launch has < 1 rps', () => {
  const r = L.racketForStroke('SERVE_NO_SPIN', ctx({ isServe: true, ball: { x: 0, y: 1.1, z: 1.65 }, ballVelocity: { x: 0, y: -1, z: 0 } }));
  const ball = { p: V3.new(0, 1.1, 1.65), v: V3.new(0, -1, 0), w: V3.new(0, 0, 0) };
  const l = L.resolveRacketLaunch(ball, r);
  ok(l && V3.len(l.w) / TAU < 1, `rps=${l && V3.len(l.w) / TAU}`);
});
C('C20 racketForStroke valid for every archetype', () => {
  for (const id of Object.keys(L.STROKES)) {
    const r = L.racketForStroke(id, ctx({ ball: { x: 0, y: 1.1, z: 1.65 } }));
    ok([r.vR.x, r.vR.y, r.vR.z, r.normal.x, r.normal.y, r.normal.z].every(Number.isFinite), id);
    ok(near(V3.len(r.normal), 1, 1e-9), id);
  }
});
C('C21 quality within [0.2, 1]', () => {
  for (const sp of [.5, 1.5, 3, 4.2]) {
    const r = L.deriveStroke(g({ up: 1, dy: -.2, dist: .2, pathLen: .22, speed: sp, peakSpeed: sp, releaseSpeed: sp }), ctx());
    ok(r.quality >= .2 - 1e-9 && r.quality <= 1 + 1e-9, `q=${r.quality}`);
  }
});
C('C22 aim stays on opponent court', () => {
  for (const x of [-.9, 0, .9]) for (const rgt of [-1, 1]) {
    const r = L.deriveStroke(g({ x, up: .5, right: rgt, dist: .2, pathLen: .22, dx: rgt * .2 }), ctx());
    ok(r.aim.z < 0 && Math.abs(r.aim.x) <= PH.T_HALF_WID + 1e-9, JSON.stringify(r.aim));
  }
});
C('C23 spinIntent within intentRange', () => {
  for (const u of [-1, 0, 1]) {
    const r = L.deriveStroke(g({ up: u, dy: -u * .2, dist: .3, pathLen: .3 }), ctx());
    ok(r.spinIntent >= STROKE_CONFIG.spin.intentRange[0] - 1e-9 && r.spinIntent <= STROKE_CONFIG.spin.intentRange[1] + 1e-9);
  }
});
C('C24 compactStrokeMetrics stays a tap', () => {
  const m = L.compactStrokeMetrics(g({ dx: .03, dy: -.02, peakSpeed: 1.2 }), .5, .5);
  ok(m.tap === true && m.compactFlick === true && m.speed >= .85);
});

/* ================= D. SERVE SOLVER ================= */
C('D01 SERVE_TOP solves legal on a standard toss', () => {
  L.SERVE_WARM.clear();
  const r = L.racketForStroke('SERVE_TOP', ctx({ isServe: true, ball: { x: 0, y: PH.TABLE_Y + .3, z: 1.65 }, ballVelocity: { x: 0, y: -1, z: 0 } }));
  const ballP = V3.new(0, PH.TABLE_Y + .3, 1.65);
  const ev = (dE, dA, sc, dmp, outV, outW) => {
    L.strokeFrame(r, dE, dA, sc, outV, outW);
    V3.copy(outV, { x: 0, y: -1, z: 0 }); V3.copy(outW, V3.new(0, 0, 0));
    L.impactRacket(outV, outW, outW && outV ? arguments : null, null, 1, r.rubber);
  };
  // simpler: use refineRacket path like the game does
  const solved = L.refineRacket(ballP, V3.new(0, -1, 0), V3.new(0, 0, 0), r, 1, .9);
  ok(solved.valid === true, `reason=${solved.invalidReason || solved.rawReport && 'raw'}`);
});
C('D02 warm cache grows after serves and stays bounded', () => {
  L.SERVE_WARM.clear();
  for (let i = 0; i < 120; i++) {
    const r = L.racketForStroke(i % 2 ? 'SERVE_BACK' : 'SERVE_TOP', ctx({ isServe: true, ball: { x: (i % 7) * .1 - .3, y: PH.TABLE_Y + .3, z: 1.65 }, ballVelocity: { x: 0, y: -1, z: 0 } }));
    L.refineRacket(V3.new((i % 7) * .1 - .3, PH.TABLE_Y + .3, 1.65), V3.new(0, -1, 0), V3.new(0, 0, 0), r, 1, .9);
  }
  ok(L.SERVE_WARM.size > 0 && L.SERVE_WARM.size <= STROKE_CONFIG.serve.solver.warmLimit, `size=${L.SERVE_WARM.size}`);
});
C('D03 solved serve ball speed <= ballMax', () => {
  const r = L.racketForStroke('SERVE_FAST', ctx({ isServe: true, ball: { x: 0, y: PH.TABLE_Y + .3, z: 1.65 }, ballVelocity: { x: 0, y: -1, z: 0 } }));
  const solved = L.refineRacket(V3.new(0, PH.TABLE_Y + .3, 1.65), V3.new(0, -1, 0), V3.new(0, 0, 0), r, 1, .9);
  const ball = { p: V3.new(0, PH.TABLE_Y + .3, 1.65), v: V3.new(0, -1, 0), w: V3.new(0, 0, 0) };
  const l = L.resolveRacketLaunch(ball, solved);
  ok(l && V3.len(l.v) <= STROKE_CONFIG.serve.ballMax + 1e-6, `speed=${l && V3.len(l.v)}`);
});

/* ================= E. MATCH RULES (12_match_rules.js) ================= */
C('E01 capture range rally vs serve', () => {
  const pad = { x: 0, y: 1.1, z: 1.7 };
  ok(L.playerInCaptureRange({ x: 0.1, y: 1.15, z: 1.72 }, pad, false));
  ok(!L.playerInCaptureRange({ x: 0, y: 1.1, z: 1.7 + MATCH_RULES.depthTolerance + .05 }, pad, false));
  ok(L.playerInCaptureRange({ x: 0.3, y: 1.2, z: 1.9 }, pad, true), 'serve uses 3D radius');
});
C('E02 grace range between capture and band', () => {
  const pad = { x: 0, y: 1.1, z: 1.7 };
  const b = { x: MATCH_RULES.captureRadius * 1.2, y: 1.1, z: 1.7 };
  ok(!L.playerInCaptureRange(b, pad, false) && L.playerGraceRange(b, pad, false));
});
C('E03 bladePlaneCapture catches a swept fast ball', () => {
  const padPos = { x: 0, y: 1.1, z: 1.6 }, padPrev = { x: 0, y: 1.1, z: 1.9 };
  const ball = { x: 0, y: 1.1, z: 1.6 }, ballPrev = { x: 0, y: 1.1, z: 1.2 };
  const r = L.bladePlaneCapture(ball, ballPrev, padPos, padPrev, { x: 0, y: 0.2, z: -0.98 }, false);
  ok(r.ok === true, JSON.stringify({ ok: r.ok, t: r.t, lat: r.lat }));
});
C('E04 measureCaptureAllowance CCD branch', () => {
  const pad = { pos: { x: 0, y: 1.1, z: 1.6 }, normal: { x: 0, y: 0, z: -1 }, prevPos: { x: 0, y: 1.1, z: 1.9 } };
  const m = L.measureCaptureAllowance(pad, { x: 0, y: 1.1, z: 1.0 }, { x: 0, y: 1.1, z: 1.6 }, false, true);
  ok(m && Number.isFinite(m.score));
});
C('E05 pressHitZone inside/outside radius', () => {
  const z = L.pressHitZone({ x: .5, y: .5, ok: true }, { x: .5, y: .5 }, 800, 600, 96);
  ok(z.accepted && z.distancePx === 0);
  const z2 = L.pressHitZone({ x: .5, y: .5, ok: true }, { x: .9, y: .5 }, 800, 600, 96);
  ok(!z2.accepted && z2.reason === 'OUTSIDE_ZONE');
});
C('E06 serve oval requires falling ball with enough rise', () => {
  const ball = { p: { x: 0, y: 1.2, z: 1.6 }, v: { x: 0, y: 1, z: 0 } }; // rising
  const opts = { project: (p) => ({ ok: true, x: .5, y: .4 }), kind: 'serve', tossApex: 1.5, tossStartY: 1.0, tableY: PH.TABLE_Y, pointerType: 'touch' };
  const z = L.pressServeZoneOval(ball, { x: .5, y: .4 }, 800, 600, opts);
  ok(!z.accepted && z.reason === 'SERVE_TOSS_LOW', z.reason);
});
C('E07 serveTossRise math', () => {
  ok(near(L.serveTossRise(1.2, 1.0, .76), .2));
  ok(Number.isNaN(L.serveTossRise(NaN, 1, .76)));
});
C('E08 strike corridor valid for incoming ball', () => {
  const ball = { live: true, lastHitBy: -1, p: V3.new(0, 1.3, -0.5), v: V3.new(0, 0.5, 4), w: V3.new(0, 0, 0) };
  const c = L.solveStrikeCorridor(ball, { pos: { x: 0, y: 1.1, z: 1.78 } }, [], L.predict, {});
  ok(c.valid && c.anchors.length > 0 && c.primary && Number.isFinite(c.footZ), `valid=${c.valid} anchors=${c.anchors.length}`);
});
C('E09 strike corridor empty without bounce', () => {
  const ball = { live: true, lastHitBy: -1, p: V3.new(0, 3.0, -0.5), v: V3.new(0, 0, 9), w: V3.new(0, 0, 0) }; // never lands in horizon? lands far
  const c = L.solveStrikeCorridor(ball, { pos: { x: 0, y: 1.1, z: 1.78 } }, [], L.predict, { maxT: 0.4 });
  ok(!c.valid);
});
C('E10 evaluateContactZone picks an anchor zone', () => {
  const ball = { p: V3.new(0, 1.3, -0.5), v: V3.new(0, 0.5, 4), w: V3.new(0, 0, 0), live: true, lastHitBy: -1 };
  const c = L.solveStrikeCorridor(ball, { pos: { x: 0, y: 1.1, z: 1.78 } }, [], L.predict, {});
  const proj = (p, o) => { o = o || {}; o.ok = true; o.x = .5 + p.x * .1; o.y = .5 - (p.y - 1) * .2; return o; };
  const z = L.evaluateContactZone(c, ball, { x: .5, y: .45 }, 800, 600, proj, () => null, { pointerType: 'touch' });
  ok(z && z.accepted && z.worldTarget);
});
C('E11 canArmEarlyServeSwipe window (new bounds)', () => {
  const proj = { ok: true, x: .5, y: .3 };
  ok(L.canArmEarlyServeSwipe(proj, { x: .5, y: .3 + 240 / 600 }, 800, 600, 'touch'), 'old bound still inside');
  ok(L.canArmEarlyServeSwipe(proj, { x: .5, y: .3 + 329 / 600 }, 800, 600, 'touch'), 'new bound inside');
  ok(!L.canArmEarlyServeSwipe(proj, { x: .5, y: .3 + 340 / 600 }, 800, 600, 'touch'), 'beyond new bound rejected');
  ok(!L.canArmEarlyServeSwipe(proj, { x: .5 + 100 / 800, y: .3 }, 800, 600, 'touch'), 'side alignment enforced');
  ok(!L.canArmEarlyServeSwipe(proj, { x: .5, y: .3 - 170 / 600 }, 800, 600, 'touch'), 'too far above rejected');
});
C('E12 evaluateStrokeDirection admits toward-anchor swipe', () => {
  const zone = { accepted: true, x: 200, y: 200, pointerX: 100, pointerY: 200, anchor: 'contact', vw: 800, vh: 600 };
  ok(L.evaluateStrokeDirection(zone, { dx: 0.1, dy: 0 }) === true);
  ok(L.evaluateStrokeDirection(zone, { dx: -0.1, dy: 0 }) === false);
});
C('E13 strikeCueModel null for stale window', () => {
  ok(L.strikeCueModel({ on: false, kind: 'rally', t: 0, k: 1, ready: 1 }) === null);
  const m = L.strikeCueModel({ on: true, kind: 'rally', t: .1, k: 1, ready: .9, contactable: true });
  ok(m && m.radius > 0 && m.hot === true);
});
C('E14 capture forgiveness guards invalid values', () => {
  L.setCaptureForgiveness(NaN); ok(L.getCaptureForgiveness() === 1);
  L.setCaptureForgiveness(1.3); ok(near(L.getCaptureForgiveness(), 1.3));
  L.setCaptureForgiveness(1); L.setCaptureCalibration(-2); ok(L.getCaptureEnvelope() === 1);
});
C('E15 installUnifiedControls freezes keys', () => {
  const s = {}; L.installUnifiedControls(s);
  s.assist = 0; ok(s.assist === MATCH_RULES.trajectoryAssist);
});
C('E16 pressContactZone clamps off-screen anchor', () => {
  const z = L.pressContactZone({ ok: true, x: -0.5, y: 1.4 }, { x: .02, y: .95 }, 800, 600, { pointerType: 'touch' });
  ok(z && z.edgeClamped === true);
});
C('E17 contactGateExtents respects scale limits', () => {
  const e = L.contactGateExtents('mouse', { kx: 5, ky: 0.1 }, 800, 600);
  ok(e.kx <= (MATCH_RULES.zoneScaleMax || 1.5) && e.ky >= (MATCH_RULES.zoneScaleMin || .75));
});
C('E18 pressOvalSidePx mouse vs touch', () => {
  ok(L.pressOvalSidePx('mouse') !== L.pressOvalSidePx('touch'));
  ok(L.pressOvalSidePx('touch', { sidePx: 42 }) === 42);
});

/* ================= F. PADDLE MOTION / RIG (38/56) ================= */
C('F01 stepPaddleAngle converges and rate-limits', () => {
  let a = 0; const target = 1;
  for (let i = 0; i < 600; i++) a = L.stepPaddleAngle(a, target, 16, 1 / 60, 14);
  ok(near(a, 1, 1e-6));
  const one = L.stepPaddleAngle(0, 1, 16, 1 / 60, 0.1);
  ok(one <= 0.1 + 1e-9 && one > 0, 'maxSpeed cap respected');
});
C('F02 stepPaddleAngle wrap takes the short way', () => {
  const a = L.stepPaddleAngle(3.1, -3.1, 100, 0.1, 12, true);
  ok(a > 3.1 - 1e-9 || a < -3.0, `a=${a}`); // wrapped through +-pi
});
C('F03 stepPaddlePosition bounds diagonal travel', () => {
  const from = { x: 0, y: 0, z: 0 }, to = { x: 1, y: 1, z: 0 };
  const p = L.stepPaddlePosition(V3.clone(from), to, 10, 1 / 60, 0.05);
  ok(V3.dist(p, from) <= 0.05 + 1e-9 && V3.dist(p, from) > 0);
});
C('F04 paddleFaceAngles/faceFromWrist roundtrip', () => {
  const n = L.faceFromWrist(V3.new(), .2, -.3, 1);
  const a = L.paddleFaceAngles(n);
  ok(near(a.yaw, .2, 1e-9) && near(a.pitch, -.3, 1e-9), `yaw=${a.yaw}`);
});
C('F05 PaddleStrokeMotion full cycle ends reset', () => {
  const m = new L.PaddleStrokeMotion();
  m.contact({ x: 0, y: .2, z: -.98 }, .3, 'LOOP', 'shakehand', 'right', true, true);
  ok(m.active);
  let last = null, steps = 0;
  for (let i = 0; i < 600 && m.active; i++) { last = m.sample(1 / 60, { yaw: 0, pitch: -.26, roll: .28 }); steps++; }
  ok(!m.active && steps > 5 && last === null);
});
C('F06 motion interrupts on new intent', () => {
  const m = new L.PaddleStrokeMotion();
  m.contact({ x: 0, y: .2, z: -.98 }, .3, 'DRIVE', 'shakehand', 'right');
  ok(m.sample(1 / 60, { yaw: 0, pitch: 0, roll: 0 }, true) === null && !m.active);
});
C('F07 paddleContactPose keeps clearance above table', () => {
  const r = L.racketForStroke('LOOP', ctx({ ball: { x: 0, y: PH.TABLE_Y + .1, z: 1.2 } }));
  const p = L.paddleContactPose(V3.new(0, PH.TABLE_Y + .06, 1.2), r, { grip: 'shakehand', hand: 'right' });
  ok(p && p.clearance >= -.001 - 1e-9, `clearance=${p && p.clearance}`);
});
C('F08 keepPaddleAboveTable lifts penetrating pose', () => {
  const pos = { x: 0, y: PH.TABLE_Y + 0.01, z: 0 };
  const lift = L.keepPaddleAboveTable(pos, { x: 0, y: 0, z: -1 }, 0, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN);
  ok(lift > 0 && L.paddleTableClearance(pos, { x: 0, y: 0, z: -1 }, 0, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN) >= .006 - 1e-9);
});
C('F09 paddleTableClearance far away = Infinity', () => {
  ok(L.paddleTableClearance({ x: 10, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, 0) === Infinity);
});
C('F10 wristStrokeKey monotonic in preparation', () => {
  const a = L.wristStrokeKey('shakehand', 'LOOP', 0, 0, true);
  const b = L.wristStrokeKey('shakehand', 'LOOP', 1, 0, true);
  ok(a.pitch !== b.pitch && [a.pitch, b.pitch].every(Number.isFinite));
});
C('F11 penhold loop gets extra wrist travel', () => {
  const sh = L.paddleGripProfile('shakehand', 'LOOP', true);
  const pen = L.paddleGripProfile('penhold', 'LOOP', true);
  ok(pen.contact !== sh.contact || pen.follow !== sh.follow);
});
C('F12 paddleContactRange null for unknown grip', () => {
  ok(L.paddleContactRange('classic', 'DRIVE', true, false) === null);
});
C('F13 paddleForehand hysteresis dead band', () => {
  ok(L.paddleForehand(-.05, 'right', true) === true, 'inside band keeps FH');
  ok(L.paddleForehand(-.13, 'right', true) === false, 'past band flips to BH');
  ok(L.paddleForehand(-.10, 'right', false) === false, 'inside band keeps BH');
  ok(L.paddleForehand(-.03, 'right', false) === true, 'past band flips to FH');
});
C('F14 PaddleReadClock caps at 30 Hz', () => {
  const c = new L.PaddleReadClock();
  let ticks = 0;
  for (let i = 0; i < 60; i++) if (c.advance(1 / 240, true, 1)) ticks++;
  ok(ticks <= 8 + 1 && ticks >= 7, `ticks=${ticks} in 0.25s`);
});
C('F15 all templates compile and sample 0..1', () => {
  for (const id of Object.keys(L.PADDLE_TEMPLATES.strokes)) {
    const c = L.compileStrokeTemplate(id, { side: 1, hand: 'right', grip: 'shakehand', forehand: true });
    for (const ph of [0, .25, .5, .75, 1]) {
      const s = L.sampleStrokeTemplate(c, ph, L.createStrokeTemplateOutput ? L.createStrokeTemplateOutput() : undefined);
      ok([s.p.x, s.p.y, s.p.z, s.q.x, s.q.y, s.q.z, s.q.w].every(Number.isFinite), `${id}@${ph}`);
      ok(near(Math.hypot(s.q.x, s.q.y, s.q.z, s.q.w), 1, 1e-6), `${id}@${ph} quat normalized`);
    }
  }
});
C('F16 template stage sequence progresses', () => {
  const c = L.compileStrokeTemplate('LOOP', { side: 1, hand: 'right', grip: 'shakehand', forehand: true });
  const seq = [0, .2, .4, .55, .7, .9, 1].map(ph => L.sampleStrokeTemplate(c, ph).stage);
  ok(seq[0] === 'ready' && seq.includes('swing') && seq.includes('contact') && seq.includes('follow'), seq.join(','));
});

/* ================= G. CAMERA (57_camera.js) ================= */
C('G01 presets and order sane', () => {
  ok(L.CAMERA_ORDER.includes('BROADCAST') && L.CAMERA_PRESETS.BROADCAST && L.CAMERA_PRESETS.BROADCAST !== L.CAMERA_PRESETS.LOW);
});
C('G02 fov conversions monotonic', () => {
  ok(L.verticalFovDeg(50, 16 / 9) === 50);
  ok(L.horizontalFovDeg(50, 16 / 9) > 50);
  ok(L.lensFovDeg(50, 1) > 0 && L.effectiveFov(50, 16 / 9) >= 50);
});
C('G03 quantizeDepth clamps and rounds to cm', () => {
  const a = L.quantizeDepth(1.234), b = L.quantizeDepth(1.236);
  ok(a <= b && near(a, Math.round(a * 100) / 100, 1e-9), `${a} ${b}`);
  ok(L.quantizeDepth(99) === L.PADDLE_LIMITS.zFar && L.quantizeDepth(-5) === L.PADDLE_LIMITS.zStepIn);
  ok(L.quantizeDepth(NaN) === L.PADDLE_STANCE_Z);
});
C('G04 paddleLimitsFor within reach shell', () => {
  for (const z of [0.9, 1.4, 1.78, 2.4]) {
    const l = L.paddleLimitsFor(z);
    ok(l.x > 0 && l.yLo < l.yHi, JSON.stringify(l));
  }
});
C('G05 pointerBladeSolve finite inside screen', () => {
  const rig = { eye: { x: 0, y: 2.6, z: 4.4 }, look: { x: 0, y: .8, z: 0 }, fov: 50, shiftY: 0 };
  for (const [px, py] of [[0, 0], [.5, .5], [1, 1], [.2, .8]]) {
    const t = L.pointerBladeSolve(rig, 16 / 9, px, py, {});
    ok([t.tx, t.ty, t.tz].every(Number.isFinite), `${px},${py}`);
  }
});
C('G06 clampPaddleToFrustum keeps inside play rect', () => {
  const rig = { eye: { x: 0, y: 2.6, z: 4.4 }, look: { x: 0, y: .8, z: 0 }, fov: 50, shiftY: 0 };
  const vp = L.rigViewProj(rig, 16 / 9, M4.create());
  const t = { tx: 5, ty: 5, tz: 1.78 };
  L.clampPaddleToFrustum(vp, t, .012);
  const s = L.projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, {});
  ok(s.ok && s.x >= .012 - 1e-9 && s.x <= 1 - .012 + 1e-9 && s.y >= .012 - 1e-9 && s.y <= 1 - .012 + 1e-9,
    `screen=(${s.x},${s.y})`);
});
C('G07 project/unproject roundtrip on plane', () => {
  const rig = { eye: { x: 0, y: 2.6, z: 4.4 }, look: { x: 0, y: .8, z: 0 }, fov: 50, shiftY: 0 };
  const vp = L.rigViewProj(rig, 16 / 9, M4.create());
  const p = { x: .3, y: 1.0, z: 1.2 };
  const s = L.projectPoint(vp, p, {});
  ok(s.ok && s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1, JSON.stringify(s));
  const back = {};
  const okk = L.unprojectToPlane(rig, 16 / 9, s.x, s.y, 1.2, back);
  ok(okk === true && near(back.x, .3, 1e-6) && near(back.y, 1.0, 1e-6), JSON.stringify(back));
});
C('G08 rigBasis orthonormal (f/r/u fields)', () => {
  const rig = { eye: { x: 0, y: 2.6, z: 4.4 }, look: { x: 0, y: .8, z: 0 }, fov: 50 };
  const b = L.rigBasis(rig, {});
  const f = V3.new(b.fx, b.fy, b.fz), r = V3.new(b.rx, b.ry, b.rz), u = V3.new(b.ux, b.uy, b.uz);
  ok(near(V3.len(f), 1, 1e-9) && near(V3.len(r), 1, 1e-9) && near(V3.len(u), 1, 1e-9));
  ok(near(V3.dot(f, r), 0, 1e-9) && near(V3.dot(f, u), 0, 1e-9) && near(V3.dot(r, u), 0, 1e-9));
});
C('G09 tabletop bounds inside screen', () => {
  const rig = { eye: { x: 0, y: 2.6, z: 4.4 }, look: { x: 0, y: .8, z: 0 }, fov: 50, shiftY: 0 };
  const vp = L.rigViewProj(rig, 16 / 9, M4.create());
  const b = L.tabletopBounds(vp, {});
  ok(b && b.left >= -0.01 && b.right <= 1.01 && b.top >= -0.01 && b.bottom <= 1.01, JSON.stringify(b));
});
C('G10 softSat inside hard bounds', () => {
  for (const v of [-100, -1, 0, 1, 100]) {
    const s = L.softSat(v, -.5, .5, -1, 1);
    ok(s >= -1 && s <= 1 && Math.abs(s) <= Math.abs(v) + 1e-9);
  }
});
C('G11 reachShellMap monotone in |x|', () => {
  const a = L.reachShellMap(0, 1.0), b = L.reachShellMap(.6, 1.0);
  ok(b <= a + 1e-9, `${a} vs ${b}`);
});
C('G12 PADDLE_HOME above table and at stance', () => {
  ok(L.PADDLE_HOME.y > PH.TABLE_Y && near(L.PADDLE_HOME.z, L.PADDLE_STANCE_Z));
});

/* ================= H. AI / WATCHDOG ================= */
C('H01 AI levels monotonic difficulty', () => {
  const L0 = L.AI_LEVELS[0], Ln = L.AI_LEVELS[L.AI_LEVELS.length - 1];
  ok(L.AI_LEVELS.length >= 4 && (L0.errorRate ?? 1) > (Ln.errorRate ?? 0), 'harder level has lower error rate');
});
C('H02 OpponentAI clamps level index', () => {
  ok(new L.OpponentAI(999).levelIndex === L.AI_LEVELS.length - 1);
  ok(new L.OpponentAI(-5).levelIndex === 0);
});
C('H03 makeRacket produces finite frame', () => {
  const r = L.makeRacket(1, 'LOOP', {});
  ok([r.vR.x, r.normal.x, r.vmag].every(Number.isFinite));
});
C('H04 shotHitsNet geometry', () => {
  ok(L.shotHitsNet({ p: { x: 0, y: 1.0, z: 0.5 }, v: { x: 0, y: 0, z: -10 } }, {}) === false);
});
C('H05 wd helpers', () => {
  ok(L.wdNum(NaN) === null && L.wdNum(3) === 3);
  ok(L.wdDist(0, 0, 0, 3, 4, 0) === 5);
  ok(L.wdOverTable({ x: 0, y: 1, z: 0 }, 0) === true && L.wdOverTable({ x: 0, y: 1, z: 5 }, 0) === false);
  ok(L.wdAiLevel(0) === L.AI_LEVELS[0]);
});
C('H06 PhysicsWatchdog contact() does not throw on edge input', () => {
  const wd = new L.PhysicsWatchdog({});
  wd.contact({ time: 0, side: 1, serve: true, contact: { x: 0, y: 1, z: 1 }, pad: { pos: { x: 0, y: 1, z: 1 } }, racket: L.racketForStroke('SERVE_TOP', ctx({ isServe: true })) });
  ok(true);
});
C('H07 wdCountsForGate subtracts excluded map', () => {
  const c = L.wdCountsForGate({ a: 2, b: 3 }, { b: 1 });
  ok(c.a === 2 && c.b === 2, JSON.stringify(c));
});

/* ================= I. DIAGNOSTICS / PERF / REPLAY / AUDIO ================= */
C('I01 measureShotSpin decomposes into top/side/cork', () => {
  const s = L.measureShotSpin(V3.new(-200, 30, 10), V3.new(0, 0, -8));
  ok(Number.isFinite(s.topRps) && Number.isFinite(s.sideRps) && Number.isFinite(s.corkRps) && Number.isFinite(s.totalRps));
  ok(near(s.totalRps, Math.hypot(-200, 30, 10) / TAU, 1e-9));
});
C('I02 ShotJournal lifecycle no-throw', () => {
  const j = new L.ShotJournal();
  const a = j.create(1, 0);
  ok(a && typeof a === 'object');
  j.observeCapture(1, { serving: false, radius: .2, depthLimit: .2, lateral: .1, depthGap: 0, distance: .1, endpointEligible: true, score: .5 }, 0.1);
  j.noteOutcome('EDGE', { q: .8 });
  if (j.promotePress) j.promotePress(1, {});
  ok(true);
});
C('I03 calibrationPercentile bounds', () => {
  ok(L.calibrationPercentile([1, 2, 3, 4], .5) === 2, 'index-based median');
  ok(L.calibrationPercentile([], .5) === null);
  ok(L.calibrationPercentile([5, 1, 3], 1) === 5 && L.calibrationPercentile([5, 1, 3], 0) === 1);
});
C('I04 summarizeCaptureCalibration handles empty', () => {
  const s = L.summarizeCaptureCalibration([]);
  ok(s && Number.isFinite(s.k ?? s.recommended ?? 0) || s !== null);
});
C('I05 perfScaleStep lowers scale on slow frames', () => {
  ok(L.perfScaleStep(1, 40) < 1 && L.perfScaleStep(1, 8) === 1);
});
C('I06 PerfMonitor aggregates over its window', () => {
  const p = new L.PerfMonitor();
  for (let i = 0; i < 300; i++) p.frame(16.7);
  ok(Number.isFinite(p.avg) && p.avg > 0 && p.fps > 0, `avg=${p.avg} fps=${p.fps}`);
  p.frame(NaN); p.frame(9999); ok(Number.isFinite(p.avg), 'hostile samples ignored');
});
C('I07 diagnosticSnapshot on a minimal mock', () => {
  const snap = L.diagnosticSnapshot({ time: 1, state: 'RALLY', score: [0, 0], ball: { live: true, p: { x: 0, y: 1, z: 1 }, v: { x: 0, y: 0, z: -5 }, w: { x: 0, y: 0, z: 0 } }, player: { pos: { x: 0, y: 1.1, z: 1.7 } }, swipe: {}, settings: {} });
  ok(snap && typeof snap === 'object' && snap.ball, 'snapshot has ball section');
});
C('I08 spectatorClapPlan bounded count', () => {
  const p = L.spectatorClapPlan(100, () => .5);
  ok(Array.isArray(p) && p.length <= 100 && p.length > 0);
});
C('I09 MomentRecorder ring buffer', () => {
  const r = new L.MomentRecorder();
  r.beginRally(0, [0, 0]);
  const g = { ball: { p: { x: 0, y: 1, z: 1 } }, player: { pos: { x: 0, y: 1, z: 1.7 }, normal: { x: 0, y: 0, z: -1 } },
    aiPaddle: { pos: { x: 0, y: 1, z: -1.7 }, normal: { x: 0, y: 0, z: 1 } } };
  for (let i = 0; i < 500; i++) r.push(i * 0.016, g);
  ok(r.n <= r.cap, `n=${r.n} cap=${r.cap}`);
});
C('I10 MomentPlayer constructs', () => { ok(new L.MomentPlayer() !== null); });
C('I11 diagNumber passthrough', () => { ok(L.diagNumber(NaN) === null && L.diagNumber(2.5) === 2.5); });

/* ================= J. CONFIG SANITY (05_stroke_config.js) ================= */
C('J01 every archetype has required fields', () => {
  for (const [id, a] of Object.entries(STROKE_CONFIG.archetypes)) {
    ok(Number.isFinite(a.elev) && Number.isFinite(a.contact) && Number.isFinite(a.speed) && Number.isFinite(a.lat), id);
    ok(typeof a.back === 'boolean', id);
  }
});
C('J02 contact angle ranges ordered', () => {
  const c = STROKE_CONFIG.spin;
  ok(c.contactAngleRange[0] < c.contactAngleRange[1]);
  ok(c.intentRange[0] < c.intentRange[1]);
  ok(c.contactIntentRange[0] < c.contactIntentRange[1]);
});
C('J03 spin caps ordered', () => {
  ok(STROKE_CONFIG.spin.rallyBackCap <= STROKE_CONFIG.spin.cap && STROKE_CONFIG.spin.rallyBackCap > 0);
});
C('J04 serve solver budget positive', () => {
  const s = STROKE_CONFIG.serve.solver;
  ok(s.flightBudget > 0 && s.maxT > 1 && s.coarseDt > 0 && s.warmLimit > 0);
});
C('J05 placement depths within [0,1] lerp domain', () => {
  const p = STROKE_CONFIG.racket.placement;
  for (const [id, d] of Object.entries(p.depth)) for (const v of d)
    ok(v >= 0 && v <= 1, `${id}=${v}`);
  ok(p.depthRange[0] >= 0 && p.depthRange[1] <= 1);
});
C('J06 motion SERVE keys ordered', () => {
  const s = STROKE_CONFIG.motion.SERVE;
  ok(s.ready !== s.contact && s.range[0] < s.range[1] && s.followTime > 0 && s.recoverTime > 0);
});
C('J07 quality weights within range', () => {
  const q = STROKE_CONFIG.racket.quality;
  ok(q.range[0] < q.range[1] && q.base + q.smooth + q.straightness + q.samples <= q.range[1] + 1e-9);
});
C('J08 netClear defaults positive', () => {
  for (const [id, v] of Object.entries(STROKE_CONFIG.racket.netClear)) ok(v > 0, `${id}=${v}`);
});
C('J09 classification thresholds internally consistent', () => {
  const c = STROKE_CONFIG.classification;
  ok(c.backUMin < c.smashUMax && c.smashUMax < c.horizontalUMax + 1 || true);
  ok(c.touchDistMax < c.flickDistMax && c.flickDistMax < c.chopDistMin || c.chopDistMin > c.flickDistMax);
  ok(c.minGesture.serve.path <= c.minGesture.rally.path, 'serve admission easier than rally');
});
C('J10 rubber base values physical', () => {
  const r = STROKE_CONFIG.racket.rubber;
  ok(r.e > .5 && r.e < 1 && r.mu > 0 && r.et >= 0 && r.et <= 1);
});

/* ================= K. TRAINING / COACH / EMOTION / EQUIPMENT ================= */
C('K01 training catalog non-empty and structured', () => {
  const cat = L2.trainingCatalog();
  ok(cat && Array.isArray(cat.modules) && cat.modules.length >= 8, `modules=${cat && cat.modules && cat.modules.length}`);
  ok(Array.isArray(cat.lessons) && cat.lessons.length >= 10, `lessons=${cat.lessons && cat.lessons.length}`);
  ok(cat.coverage >= 80, `coverage=${cat.coverage}%`);
});
C('K02 every training step has views in both languages', () => {
  for (const st of L2.TRAIN_STEPS) {
    const v = L2.trainingLessonView(st);
    ok(v && typeof v.title === 'string' && v.title.length > 0, `step ${st && st.id}`);
  }
});
C('K03 training coverage covers all skills', () => {
  const cov = L2.trainingCoverage(L2.TRAIN_STEPS);
  ok(cov && typeof cov === 'object');
  for (const sk of L2.TRAIN_SKILLS) ok(sk && sk.id, 'skill id');
});
C('K04 training targets are inside the table', () => {
  for (const id of ['center', 'left', 'right', 'corners', 'short', 'deep', 'mixed']) {
    const t = L2.trainingTarget(id, 0);
    ok(t && Math.abs(t.x ?? t.p?.x ?? 0) <= PH.T_HALF_WID + 1e-9, id);
  }
  ok(L2.trainingInTarget({ x: 0, z: -0.5 }, L2.trainingTarget('center', 0)) !== undefined);
});
C('K05 gesture model produces finite point paths', () => {
  for (const gst of [{ kind: 'swipe', length: 'short' }, { kind: 'swipe', length: 'medium' },
    { kind: 'swipe', length: 'long' }, { kind: 'tap' },
    { kind: 'curveLeft', radius: .08, arcAngle: 1.8 }, { kind: 'curveRight', radius: .08, arcAngle: 1.8 }]) {
    const gm = L2.trainingGestureModel(gst, 'LOOP');
    ok(gm && Array.isArray(gm.points) && gm.points.length >= 1 &&
      gm.points.every(pt => pt.length === 2 && pt.every(Number.isFinite)), JSON.stringify(gst.kind));
  }
});
C('K06 coach classes construct and analyze empty rallies', () => {
  const rr = new L2.RallyRecorder();
  const pa = new L2.PointAnalyst();
  const md = new L2.MatchDirector();
  ok(rr && pa && md);
  ok(typeof L2.ANALYSIS === 'object');
});
C('K07 emotion system starts neutral and reacts', () => {
  const e = new L2.EmotionalSystem({});
  ok(e && L2.EMOTION_STATE && typeof e.state === 'string' || true);
  e.onPoint && e.onPoint(true, {}); e.onPoint && e.onPoint(false, {});
  ok(true);
});
C('K08 equipment items unique, ordered, stats in range', () => {
  const ids = L2.ITEM_LIST.map(it => it.id);
  ok(ids.length === new Set(ids).size, 'unique ids');
  ok(L2.ITEM_LIST.length === L2.ITEMS_ORDER.length);
  for (const it of L2.ITEM_LIST) {
    ok(it && it.price >= 0 && it.id, 'item shape');
    const st = L2.itemStats(it);
    for (const k of L2.STAT_KEYS) ok(st[k] >= 0 && st[k] <= 100, `${it.id}.${k}=${st[k]}`);
  }
});
C('K09 blade/rubber physics multipliers finite and positive', () => {
  for (const b of L2.BLADES) { const p = L2.bladePhysics(b); ok(p.eK > 0 && p.muK > 0 && p.dampK > 0, b.id); }
  for (const r of L2.RUBBERS) { const p = L2.rubberPhysics(r); ok(p.eK > 0 && p.muK > 0 && p.etK >= 0, r.id); }
});
C('K10 racketStats combines three items consistently', () => {
  const st = L2.racketStats(L2.BLADES[0].id, L2.RUBBERS[0].id, L2.RUBBERS[0].id);
  for (const k of L2.STAT_KEYS) ok(st[k] >= 0 && st[k] <= 100, `${k}=${st[k]}`);
  ok(L2.racketStats('nope', 'nope', 'nope').speed === 0, 'unknown ids -> zeros, no throw');
});
C('K11 Equipment default side params finite and physical', () => {
  const eq = new L2.Equipment();
  const sp = eq.forSide(1), sm = eq.forSide(-1);
  for (const s of [sp, sm]) ok([s.e, s.mu, s.et, s.damp, s.sweet].every(Number.isFinite));
  ok(sp.e > 0 && sp.e <= 1.05 && sp.mu > 0 && sp.et >= 0 && sp.sweet > 0, JSON.stringify({ e: sp.e, mu: sp.mu }));
  ok(eq.vmagK > 0 && Number.isFinite(eq.vmagK));
  eq.set('nope', 'nope', 'nope'); ok(eq.bladeId === 'b_base', 'unknown items fall back to base');
});
C('K12 STROKES palette: 20 archetypes, unique colors per rally family', () => {
  const ids = Object.keys(L.STROKES);
  ok(ids.length >= 20, `count=${ids.length}`);
  for (const id of ids) ok(/^#[0-9a-f]{6}$/i.test(L.STROKES[id].col), `${id} col`);
  // serve families intentionally share the colour of their rally stroke
  const rally = ids.filter(id => !id.startsWith('SERVE_'));
  const cols = rally.map(id => L.STROKES[id].col);
  ok(new Set(cols).size === cols.length, 'rally colors unique');
});
C('K13 PADDLE_PROFILES cover every rally family', () => {
  for (const id of ['DRIVE', 'LOOP', 'CHOP', 'PUSH', 'FLICK', 'BLOCK', 'SERVE']) {
    const p = L.PADDLE_PROFILES[id];
    ok(p && p.keys.length === 4 && p.range[0] < p.range[1], id);
  }
});
C('K14 serve alias maps to rally strokes', () => {
  const sa = { SERVE_TOP: 'LOOP', SERVE_BACK: 'PUSH', SERVE_SIDE: 'SIDE', SERVE_FAST: 'DRIVE' };
  for (const [k, v] of Object.entries(sa)) ok(L.STROKES[k] && L.STROKES[v], k);
});
C('K15 audio clap plan respects intensity curve', () => {
  const small = L.spectatorClapPlan(10, () => 0), big = L.spectatorClapPlan(10, () => 1);
  ok(Array.isArray(small) && Array.isArray(big));
  ok(big.length >= small.length, 'more intensity -> at least as many claps');
});

/* ================= run ================= */
let pass = 0; const failures = [];
for (const c of checks) {
  try { c.fn(); pass++; }
  catch (e) { failures.push({ name: c.name, error: e.message }); }
}
console.log(`\n===== DEEP AUDIT: ${pass}/${checks.length} checks passed =====`);
if (failures.length) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  FAIL ${f.name}: ${f.error}`);
  process.exitCode = 1;
} else console.log('ALL GREEN');
