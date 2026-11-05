/* Analysis probe for the player-reported bugs. Not a test — a measurement. */
'use strict';
const { load } = require('../tests/helpers.cjs');

const M = load([
  '10_math.js', '30_physics.js', '05_stroke_config.js',
  '37_stroke_motion_data.js', '38_paddle_motion.js', '40_swipe.js', '56_rig.js',
], ['PH', 'STROKE_CONFIG', 'V3', 'clamp', 'lerp', 'smoothstep', 'DEG', 'TAU',
  'classifyStroke', 'deriveStroke', 'resolveRacketLaunch', 'predict', 'impactRacket',
  'playerWristPose', 'paddleFaceAngles', 'faceFromWrist', 'stepPaddleAngle',
  'PaddleStrokeMotion', 'paddleGripProfile', 'wristStrokeKey']);

const { PH, STROKE_CONFIG, V3, clamp, DEG, classifyStroke, deriveStroke,
  resolveRacketLaunch, predict, playerWristPose, faceFromWrist } = M;

function gesture(o) {
  return { x: .5, y: .5, sx: .5, sy: .5, samples: 20, smooth: .9, straightness: .95,
    dist: .2, pathLen: .22, curl: 0, speed: 3, peakSpeed: 3, releaseSpeed: 3,
    dx: 0, dy: 0, right: 0, up: 1, ...o };
}
function ctx(o = {}) {
  return { side: 1, ball: { x: 0, y: PH.TABLE_Y + .3, z: 1.4 }, ballSpin: { x: 0, y: 0, z: 0 },
    ballSpeed: 6, ballVelocity: { x: 0, y: 0, z: 5 }, isServe: false, grip: 'shakehand',
    forehand: true, ...o };
}
function hitAndFly(m, c) {
  const st = classifyStroke(m, c, clamp(Math.max(m.releaseSpeed, m.peakSpeed * .78) / 4.2, 0, 1.45));
  const racket = deriveStroke(m, c);
  // ball flying towards the player, met at contact
  const ball = { p: V3.new(c.ball.x, c.ball.y, c.ball.z), v: V3.new(0, 1.5, 6), w: V3.new(0, 0, 0) };
  const launch = resolveRacketLaunch(ball, racket);
  if (!launch) return { st: st.id, launch: null };
  const out = predict(V3.clone(launch.p), V3.clone(launch.v), V3.clone(launch.w),
    { dt: PH.SIM_DT, maxT: 2.5, out: {} });
  return { st: st.id, v: launch.v, w: launch.w, out };
}

console.log('=== 1. BACKSPIN (swipe top->down) ===');
for (const sp of [1.5, 2.5, 3.5, 4.2]) {
  const m = gesture({ up: -1, right: 0, dy: .25, dist: .22, pathLen: .24, speed: sp, peakSpeed: sp, releaseSpeed: sp });
  const r = hitAndFly(m, ctx());
  if (!r.launch) { console.log('sp', sp, r.st, 'NO LAUNCH'); continue; }
  const b1 = r.out.landed;
  // simulate post-bounce velocity by re-running with bounce (predict already bounces; read endV)
  console.log(`sp=${sp} stroke=${r.st} v=(${r.v.x.toFixed(1)},${r.v.y.toFixed(1)},${r.v.z.toFixed(1)}) ` +
    `w=(${r.w.x.toFixed(0)},${r.w.y.toFixed(0)},${r.w.z.toFixed(0)}) rad/s=${(Math.hypot(r.w.x, r.w.y, r.w.z) / (2 * Math.PI)).toFixed(1)}rps ` +
    `landed=${b1 ? `z=${b1.z.toFixed(2)}` : 'none'} bounces=${r.out.bounces} endVz=${r.out.endV.z.toFixed(2)}`);
}

console.log('\n=== 2. SIDE SPIN (pure horizontal swipe) ===');
for (const dir of [1, -1]) {
  const m = gesture({ up: 0, right: dir, dx: .25 * dir, dist: .25, pathLen: .27, speed: 3, peakSpeed: 3, releaseSpeed: 3 });
  const r = hitAndFly(m, ctx());
  if (!r.launch) { console.log('dir', dir, r.st, 'NO LAUNCH'); continue; }
  console.log(`dir=${dir} stroke=${r.st} v=(${r.v.x.toFixed(1)},${r.v.y.toFixed(1)},${r.v.z.toFixed(1)}) ` +
    `w.y=${r.w.y.toFixed(1)} (${(Math.abs(r.w.y) / (2 * Math.PI)).toFixed(1)} rps side) w.x=${r.w.x.toFixed(0)} landed=${r.out.landed ? `x=${r.out.landed.x.toFixed(2)} z=${r.out.landed.z.toFixed(2)}` : 'none'}`);
}
console.log('-- arc (C-curve) gestures --');
for (const curl of [-0.8, 0.8]) {
  const m = gesture({ up: .3, right: .2, curl, dist: .05, pathLen: .16, speed: 3, peakSpeed: 3, releaseSpeed: 3 });
  const r = hitAndFly(m, ctx());
  if (!r.launch) { console.log('curl', curl, r.st, 'NO LAUNCH'); continue; }
  console.log(`curl=${curl} stroke=${r.st} w=(${r.w.x.toFixed(0)},${r.w.y.toFixed(0)},${r.w.z.toFixed(0)}) landed=${r.out.landed ? `x=${r.out.landed.x.toFixed(2)}` : 'none'}`);
}

console.log('\n=== 3. PADDLE POSE while raising (pos.y up, vel.y>0) ===');
let prevPitch = null;
for (let y = 0.85; y <= 1.75; y += 0.05) {
  const pose = playerWristPose({ x: 0, y, z: 1.78 }, { x: 0, y: 2.0, z: 0 }, 'right',
    { grip: 'shakehand', forehand: true, stroke: 'DRIVE', preparation: 0, follow: 0 });
  const n = faceFromWrist(V3.new(), pose.yaw, pose.pitch, 1);
  const deg = pose.pitch / DEG;
  const d = prevPitch === null ? 0 : deg - prevPitch;
  console.log(`y=${y.toFixed(2)} pitch=${deg.toFixed(1)}deg (d=${d.toFixed(1)}) normal=(${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}) roll=${(pose.roll / DEG).toFixed(0)}`);
  prevPitch = deg;
}

console.log('\n=== 4. SERVE toss: does an unhit toss ball slam the table? ===');
const toss = STROKE_CONFIG.serve.toss;
for (const k of [0, 0.45, 1]) {
  const vy = toss.speed + k * toss.speedSpan;
  const apex = PH.TABLE_Y + toss.readyHeight + vy * vy / (2 * PH.G);
  // fall back to table from apex
  const tFall = Math.sqrt(2 * (apex - (PH.TABLE_Y + PH.R)) / PH.G);
  const vImpact = PH.G * tFall;
  const e = clamp(PH.E_TABLE - PH.E_TABLE_SPEED * vImpact, 0.68, 0.92);
  console.log(`tossK=${k} vy=${vy.toFixed(2)} apex=+${(apex - PH.TABLE_Y).toFixed(2)}m impactV=${vImpact.toFixed(2)}m/s e=${e.toFixed(3)} reboundVy=${(vImpact * e).toFixed(2)}`);
}
