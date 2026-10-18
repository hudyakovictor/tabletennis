const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

function rigFixture() {
  const lib = load(['10_math.js', '56_rig.js'], ['PaddleRig', 'Q', 'V3', 'M4']);
  const calls = [];
  const R = {
    draw(mesh, matrix, mat) { calls.push({ mesh, matrix: Array.from(matrix), mat }); },
    drawShadow(mesh, matrix) { calls.push({ mesh, matrix: Array.from(matrix), shadow: true }); },
  };
  const S = { mesh: { blade: 'blade', rubber: 'rubber', handle: 'handle' },
    mat: { bladeWood: 'wood', rubberRed: 'red', rubberBlack: 'black', handle: 'grip' } };
  return { ...lib, R, S, calls, rig: new lib.PaddleRig() };
}

test('paddle draws only blade, two rubbers and handle, including shadow pass', () => {
  const { rig, R, S, V3, calls } = rigFixture();
  for (const shadowPass of [false, true]) {
    calls.length = 0;
    rig.draw(R, S, { pos: V3.new(), normal: V3.new(0, 0, -1), hand: 'right', shadowPass });
    assert.deepEqual(calls.map(c => c.mesh), ['blade', 'rubber', 'rubber', 'handle']);
    assert.equal(calls.every(c => !!c.shadow === shadowPass), true);
  }
});

test('repeated rendering cannot rotate the input pose or change rubber sides', () => {
  const { rig, R, S, Q, V3, calls } = rigFixture();
  const o = { pos: V3.new(.2, 1, 1.5), normal: V3.new(0, 0, -1),
    q: Q.fromEuler(Q.new(), .25, -.4, .1), hand: 'right', swing: .8, roll: .2 };
  const before = JSON.stringify(o);
  rig.draw(R, S, o);
  const expected = JSON.stringify(calls);
  for (let i = 0; i < 1000; i++) {
    calls.length = 0;
    rig.draw(R, S, o);
    assert.equal(JSON.stringify(o), before);
    assert.equal(JSON.stringify(calls), expected);
  }
  assert.equal(calls[1].mat, 'red');
  assert.equal(calls[2].mat, 'black');
  // The surface centres are displaced exactly along the rendered blade Z.
  for (let axis = 0; axis < 3; axis++) {
    const delta = calls[1].matrix[12 + axis] - calls[2].matrix[12 + axis];
    assert.ok(Math.abs(delta - calls[0].matrix[8 + axis] * .017) < 1e-6);
  }
});

test('grip roll is bounded and never alters the face normal for either hand', () => {
  const { rig, Q, V3, M4 } = rigFixture();
  for (const hand of ['left', 'right']) {
    for (const swing of [-100, -1, 0, 1, 100]) {
      const n = V3.norm(V3.new(), V3.new(.3, -.2, -1));
      const q = rig.paddleQuat(Q.new(), n, hand, swing, swing);
      assert.ok(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-9);
      const m = M4.compose(M4.create(), V3.new(), q, V3.new(1, 1, 1));
      assert.ok(V3.dist(M4.transformDir(V3.new(), m, V3.new(0, 0, 1)), n) < 1e-6);
    }
  }
});

test('AI initializes a finite pose at every difficulty and does not strike inside think', () => {
  const { OpponentAI, V3 } = load(['10_math.js', '30_physics.js', '40_swipe.js', '55_ai.js'], ['OpponentAI', 'V3']);
  for (let level = 0; level < 5; level++) {
    const ai = new OpponentAI(level);
    assert.equal(ai.L.id, level);
    assert.equal(ai.side, -1);
    assert.ok(Object.values(ai.pos).every(Number.isFinite));
    const ball = { p: V3.new(0, 1, -1.4), v: V3.new(0, -1, -5), w: V3.new(10, 0, 0), live: true, lastHitBy: 1 };
    const g = { ball, time: 1, shotId: 1, rally: 1, ai, player: { pos: V3.new() } };
    const before = JSON.stringify(ball);
    ai.think(g, 1 / 60);
    assert.equal(JSON.stringify(ball), before);
    ai.commit = { x: 0, t: 1, speed: 8, archId: 'DRIVE', aim: { x: .2, z: .9 } };
    ai.plan = ai.commit; ai.swingAt = 1;
    const racket = ai.swing(g);
    assert.equal(JSON.stringify(ball), before, 'only Game.tryAiHit applies the physical impact');
    assert.ok(V3.len(racket.vR) > 0);
    assert.ok(Object.values(racket.normal).every(Number.isFinite));
    assert.equal(ai.commit, null);
    assert.equal(ai.swing(g), null, 'one committed stroke is consumed once');
  }
});

test('wrist stance persists at rest, mirrors for left hand and reacts to depth', () => {
  const { playerWristPose: pose } = load(['10_math.js', '56_rig.js'], ['playerWristPose']);
  const still = { x: 0, y: 0, z: 0 };
  for (const x of [-.7, -.2, 0, .2, .7]) {
    const r = pose({ x, y: 1, z: 1.44 }, { x: 2, y: 1, z: -2 }, 'right');
    const l = pose({ x: -x, y: 1, z: 1.44 }, { x: -2, y: 1, z: -2 }, 'left');
    assert.ok(Math.abs(r.yaw + l.yaw) < 1e-12);
    assert.ok(Math.abs(r.roll + l.roll) < 1e-12);
    assert.equal(r.pitch, l.pitch);
    assert.equal(r.forehand, l.forehand);
  }
  assert.ok(Math.abs(pose({ x: .7, z: 1.44 }, still, 'right').yaw) > .2);
  assert.ok(pose({ x: 0, z: 1.44 }, { ...still, z: -3 }, 'right').pitch < 0);
  assert.ok(pose({ x: 0, z: 1.44 }, { ...still, z: 3 }, 'right').pitch > 0);
});

test('ready grip is relaxed, forehand/backhand are distinct and roll preserves contact normal', () => {
  const { rig, Q, V3, M4 } = rigFixture();
  const { playerWristPose: pose } = load(['10_math.js', '56_rig.js'], ['playerWristPose']);
  for (const hand of ['right', 'left']) {
    const h = hand === 'right' ? 1 : -1;
    const centre = pose({ x: 0, z: 1.44 }, V3.new(), hand);
    assert.ok(Math.abs(centre.roll - h * .28) < 1e-10);
    const fh = pose({ x: .72 * h, z: 1.44 }, V3.new(), hand);
    const bh = pose({ x: -.72 * h, z: 1.44 }, V3.new(), hand);
    assert.equal(fh.forehand, true);
    assert.equal(bh.forehand, false);
    assert.ok(Math.abs(fh.roll) > Math.abs(bh.roll));
    for (const p of [centre, fh, bh]) {
      assert.ok(Math.abs(p.roll) < Math.PI / 2);
      const n = V3.norm(V3.new(), V3.new(.1, -.3, -1));
      const q = rig.paddleQuat(Q.new(), n, hand, 1, p.roll, true);
      const m = M4.compose(M4.create(), V3.new(), q, V3.new(1, 1, 1));
      assert.ok(V3.dist(M4.transformDir(V3.new(), m, V3.new(0, 0, 1)), n) < 1e-6);
    }
  }
});

test('preparation, forward wrist flexion and follow-through have separate bounded targets', () => {
  const { playerWristPose: pose } = load(['10_math.js', '56_rig.js'], ['playerWristPose']);
  const pos = { x: .6, z: 1.44 }, vel = { x: 0, y: 0, z: 0 };
  const ready = pose(pos, vel, 'right');
  const prepare = pose(pos, vel, 'right', { preparation: 1 });
  const forward = pose(pos, vel, 'right', { gesturePitch: -.3 });
  const recover = pose(pos, vel, 'right', { follow: 1 });
  assert.ok(prepare.roll > ready.roll);
  assert.ok(forward.pitch < ready.pitch - .25);
  assert.ok(recover.roll < ready.roll);
  for (let x = -.8; x <= .8; x += .01) {
    const a = pose({ x, z: 1.44 }, vel, 'right');
    const b = pose({ x: x + .001, z: 1.44 }, vel, 'right');
    assert.ok(Math.abs(a.roll - b.roll) < .02, 'no snap at crossover');
  }
});

test('sidespin, predicted contact, compact block and wrist face stay physically consistent', () => {
  const { playerWristPose: pose, faceFromWrist, V3 } = load(
    ['10_math.js', '56_rig.js'], ['playerWristPose', 'faceFromWrist', 'V3']);
  const still = { x: 0, y: 0, z: 0 };
  const ready = pose({ x: 0, z: 1.44 }, still, 'right');
  const sideR = pose({ x: 0, z: 1.44 }, still, 'right', { incomingSide: 90, eta: 0.15 });
  const sideL = pose({ x: 0, z: 1.44 }, still, 'right', { incomingSide: -90, eta: 0.15 });
  assert.ok(sideR.yaw < ready.yaw - 0.04, 'sidespin kick to +x yaws the face right');
  assert.ok(sideL.yaw > ready.yaw + 0.04, 'opposite sidespin yaws the other way');
  const highHit = pose({ x: 0, y: 1.01, z: 1.44 }, still, 'right', { contactY: 1.62 });
  const lowHit = pose({ x: 0, y: 1.01, z: 1.44 }, still, 'right', { contactY: 0.70 });
  assert.ok(highHit.pitch < lowHit.pitch - 0.16, 'angle is set for the intercept, not the current bat height');
  const wide = pose({ x: 0.72, z: 1.44 }, still, 'right');
  const blocked = pose({ x: 0.72, z: 1.44 }, still, 'right', { compact: 1, ballSpeed: 14, eta: 0.1 });
  assert.ok(Math.abs(blocked.roll) < Math.abs(wide.roll) - 0.15, 'a late block pulls a laid-back roll home');
  const n = faceFromWrist(V3.new(), 0.3, -0.2, 1);
  const nR = faceFromWrist(V3.new(), -0.3, -0.2, 1);
  assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9);
  assert.ok(n.y < 0, 'negative pitch is a closed face');
  assert.ok(n.x < 0 && nR.x > 0, 'negative yaw turns the face to +x');
  const nL = faceFromWrist(V3.new(), 0.3, -0.2, -1);
  assert.ok(nL.z > 0 && n.z < 0, 'far side looks the other way down the table');
});

test('attack lean closes the face forward; a loop face points into the ball', () => {
  const { playerWristPose: pose, deriveStroke, SwipeTracker, V3 } = load(
    ['10_math.js', '30_physics.js', '40_swipe.js', '56_rig.js'],
    ['playerWristPose', 'deriveStroke', 'SwipeTracker', 'V3']);
  const still = { x: 0, y: 0, z: 0 };
  const ready = pose({ x: 0, z: 1.44 }, still, 'right');
  const lean = pose({ x: 0, z: 1.44 }, still, 'right', { attackLean: 1 });
  assert.ok(lean.pitch < ready.pitch - 0.18, 'drive lean tips the blade toward the net');
  const sw = new SwipeTracker();
  sw.down(.5, .72, 0); sw.move(.52, .55, .06); sw.up(.54, .38, .12);
  const loop = deriveStroke(sw.lastReleased, { side: 1 });
  assert.ok(loop.normal.y < -0.12, 'a topspin face is closed, not standing vertical');
});

test('height, incoming spin, serve and step-in tilt the face like a real shakehand', () => {
  const { playerWristPose: pose } = load(['10_math.js', '56_rig.js'], ['playerWristPose']);
  const still = { x: 0, y: 0, z: 0 };
  const ready = pose({ x: 0, z: 1.44 }, still, 'right');
  const high = pose({ x: 0, y: 1.62, z: 1.44 }, still, 'right');
  const low = pose({ x: 0, y: 0.62, z: 1.44 }, still, 'right');
  const overTable = pose({ x: 0, z: 0.70 }, still, 'right');
  const offTable = pose({ x: 0, z: 1.90 }, still, 'right');
  const top = pose({ x: 0, y: 1.01, z: 1.44 }, still, 'right', { incomingTop: 360, ballY: 1.25, ballSpeed: 11, eta: 0.18 });
  const back = pose({ x: 0, y: 1.01, z: 1.44 }, still, 'right', { incomingTop: -280, ballY: 0.88, eta: 0.18 });
  const serve = pose({ x: 0, z: 1.44 }, still, 'right', { serving: true });
  const step = pose({ x: 0, z: 1.44 }, still, 'right', { stepIn: 1 });
  assert.ok(high.pitch < ready.pitch - 0.08, 'high contact closes the face');
  assert.ok(low.pitch > ready.pitch + 0.08, 'low contact opens the face');
  assert.ok(overTable.pitch > offTable.pitch + 0.12, 'over the table is more open than a loop stance');
  assert.ok(top.pitch < ready.pitch - 0.10, 'incoming topspin closes');
  assert.ok(back.pitch > ready.pitch + 0.06, 'incoming backspin opens');
  assert.ok(serve.pitch > ready.pitch, 'toss starts under the ball');
  assert.ok(step.pitch > ready.pitch, 'step-in gets under a short ball');
  const trackR = pose({ x: 0, z: 1.44 }, still, 'right', { ballX: 0.40, eta: 0.2 });
  const trackL = pose({ x: 0, z: 1.44 }, still, 'left', { ballX: -0.40, eta: 0.2 });
  assert.ok(trackR.yaw < -0.04, 'face yaws toward a ball on the forehand');
  assert.ok(Math.abs(trackR.yaw + trackL.yaw) < 1e-12, 'ball tracking mirrors with the hand');
});

test('stroke refinement frame preserves wrist pitch at zero correction', () => {
  const { SwipeTracker, deriveStroke, strokeFrame, V3 } = load(
    ['10_math.js', '30_physics.js', '40_swipe.js'], ['SwipeTracker', 'deriveStroke', 'strokeFrame', 'V3']);
  const sw = new SwipeTracker();
  sw.down(.5, .7, 0); sw.move(.56, .55, .07); sw.up(.6, .45, .12);
  for (const movePitch of [-.4, 0, .4]) {
    const racket = deriveStroke(sw.lastReleased, { side: 1, movePitch });
    const n = V3.new(), v = V3.new();
    strokeFrame(racket, 0, 0, 1, v, n);
    assert.ok(V3.dist(n, racket.normal) < 1e-9);
  }
});

test('grip profiles: shakehand rests tilted 10-20° forward, penhold 0-10° with handle up', () => {
  const { playerWristPose: pose, readyRollFor, gripRestPitch, DEG } = load(
    ['10_math.js', '56_rig.js'], ['playerWristPose', 'readyRollFor', 'gripRestPitch', 'DEG']);
  const still = { x: 0, y: 0, z: 0 };
  for (const hand of ['right', 'left']) {
    const h = hand === 'right' ? 1 : -1;
    const sh = pose({ x: 0, z: 1.44 }, still, hand, {}, 'shakehand');
    const tiltSh = -sh.pitch / DEG;
    assert.ok(tiltSh >= 10 && tiltSh <= 20, `shakehand ready nod is 10-20° fwd, got ${tiltSh}`);
    assert.ok(Math.abs(sh.roll - h * .28) < 1e-10);
    const pen = pose({ x: 0, z: 1.44 }, still, hand, {}, 'penhold');
    const tiltPen = -pen.pitch / DEG;
    assert.ok(tiltPen >= 0 && tiltPen <= 10, `penhold ready is 0-10° from vertical, got ${tiltPen}`);
    assert.ok(Math.abs(pen.roll - (Math.PI + h * .10)) < 1e-10, 'penhold ready wraps the handle up');
    assert.equal(sh.forehand, pen.forehand, 'wing boundary does not depend on the grip');
  }
  assert.ok(Math.abs(readyRollFor('right', 'shakehand') + readyRollFor('left', 'shakehand')) < 1e-12);
  assert.ok(Math.abs((readyRollFor('right', 'penhold') - Math.PI) + (readyRollFor('left', 'penhold') - Math.PI)) < 1e-12,
    'a left-handed penhold mirrors the right-handed one around the handle-up pose');
  assert.ok(gripRestPitch('penhold') > gripRestPitch('shakehand'), 'penhold stands more vertical');
  assert.equal(gripRestPitch('nonsense'), gripRestPitch('shakehand'), 'unknown grip degrades to shakehand');
});

test('penhold ready quaternion points the handle up without moving the face', () => {
  const { rig, Q, V3, M4, readyRollFor } = { ...rigFixture(), ...load(['10_math.js', '56_rig.js'], ['readyRollFor']) };
  const n = V3.norm(V3.new(), V3.new(0, -.1, -1));      // near-horizontal face, slightly closed
  for (const [grip, wantUp] of [['penhold', 1], ['shakehand', -1]]) {
    const q = rig.paddleQuat(Q.new(), n, 'right', 0, readyRollFor('right', grip), true);
    assert.ok(Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-9);
    const m = M4.compose(M4.create(), V3.new(), q, V3.new(1, 1, 1));
    const handleDir = M4.transformDir(V3.new(), m, V3.new(0, -1, 0));
    assert.ok(Math.sign(handleDir.y) === wantUp && Math.abs(handleDir.y) > .85,
      `${grip} handle must point ${wantUp > 0 ? 'up' : 'down'}, got y=${handleDir.y}`);
    assert.ok(V3.dist(M4.transformDir(V3.new(), m, V3.new(0, 0, 1)), n) < 1e-6,
      'roll around the face normal never rotates the face itself');
  }
});

test('every stroke has an authored contact pose inside the real angle bands', () => {
  const { STROKES, STROKE_POSE, strokePose, DEG } = load(
    ['10_math.js', '30_physics.js', '40_swipe.js', '56_rig.js'],
    ['STROKES', 'STROKE_POSE', 'strokePose', 'DEG']);
  for (const id of Object.keys(STROKES)) {
    const p = STROKE_POSE[id];
    assert.ok(p, `STROKE_POSE is missing ${id}`);
    assert.ok(Math.abs(p.tilt) <= .72 && Math.abs(p.turn) <= .25, `${id} pose stays printable`);
  }
  const deg = (rad) => -rad / DEG;      // + = closed (leaning forward), − = open
  assert.ok(deg(STROKE_POSE.DRIVE.tilt) >= 10 && deg(STROKE_POSE.DRIVE.tilt) <= 20, 'накат 10-20° вперёд');
  assert.ok(deg(STROKE_POSE.LOOP.tilt) >= 30 && deg(STROKE_POSE.LOOP.tilt) <= 50, 'топ-спин 30-50° вперёд');
  assert.ok(deg(STROKE_POSE.COUNTER.tilt) >= 30 && deg(STROKE_POSE.COUNTER.tilt) <= 50, 'контрнакат — та же семья');
  assert.ok(-deg(STROKE_POSE.CHOP.tilt) >= 20 && -deg(STROKE_POSE.CHOP.tilt) <= 40, 'подрезка 20-40° назад');
  assert.ok(-deg(STROKE_POSE.PUSH.tilt) >= 20 && -deg(STROKE_POSE.PUSH.tilt) <= 40, 'подставка открыта');
  assert.ok(deg(STROKE_POSE.BLOCK.tilt) >= 0 && deg(STROKE_POSE.BLOCK.tilt) <= 15, 'блок 0-15°');
  for (const id of ['PUSH', 'CHOP', 'DROP', 'SERVE_BACK'])
    assert.ok(STROKE_POSE[id].tilt > 0, `${id}: нижнее вращение бьётся открытой ракеткой`);
  for (const id of ['LOOP', 'COUNTER', 'DRIVE', 'SMASH'])
    assert.ok(STROKE_POSE[id].tilt < 0, `${id}: верхнее вращение бьётся закрытой ракеткой`);
  /* Penhold compresses the closed angles into the classic 10-30° wrist band
     and keeps the open ones nearly full (same face works both wings). */
  const loopPen = deg(strokePose('LOOP', 'penhold').tilt);
  assert.ok(loopPen >= 10 && loopPen <= 30, `penhold loop lives in the 10-30° wrist band, got ${loopPen}`);
  assert.ok(-deg(strokePose('CHOP', 'penhold').tilt) >= 20, 'penhold chop stays a real chop');
  assert.equal(strokePose('LOOP', 'shakehand'), STROKE_POSE.LOOP, 'shakehand is the authored table');
  assert.equal(strokePose('MISSING_ID', 'penhold'), null);
});

test('stroke pose blends in with the gesture and mirrors for the left hand', () => {
  const { playerWristPose: pose, STROKE_POSE } = load(['10_math.js', '56_rig.js'], ['playerWristPose', 'STROKE_POSE']);
  const still = { x: 0, y: 0, z: 0 }, pos = { x: 0, z: 1.44 };
  for (const grip of ['shakehand', 'penhold']) {
    const base = grip === 'penhold' ? Math.PI : 0;
    const readyR = pose(pos, still, 'right', {}, grip);
    const loop = STROKE_POSE.LOOP;
    const liveR = pose(pos, still, 'right', { strokeTilt: loop.tilt, strokeTurn: loop.turn, strokeK: 1 }, grip);
    assert.ok(liveR.pitch < readyR.pitch - .25, `${grip}: a loop visibly closes the face`);
    assert.ok(liveR.roll > readyR.roll, `${grip}: the loop turn wraps a right wrist`);
    const liveL = pose(pos, still, 'left', { strokeTilt: loop.tilt, strokeTurn: loop.turn, strokeK: 1 }, grip);
    assert.equal(liveL.pitch, liveR.pitch, 'contact angle is identical for both hands');
    assert.ok(Math.abs((liveR.roll - base) + (liveL.roll - base)) < 1e-9, `${grip}: lefty mirrors the wrist signature`);
    const idle = pose(pos, still, 'right', { strokeTilt: loop.tilt, strokeTurn: loop.turn, strokeK: 0 }, grip);
    assert.deepEqual(idle, readyR, 'stroke pose at zero blend IS the ready pose');
    const chop = STROKE_POSE.CHOP;
    const liveChop = pose(pos, still, 'right', { strokeTilt: chop.tilt, strokeTurn: chop.turn, strokeK: 1 }, grip);
    assert.ok(liveChop.pitch > liveR.pitch + .5, `${grip}: chop opens as much as loop closes`);
  }
});
