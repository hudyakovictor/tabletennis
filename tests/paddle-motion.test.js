const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '56_rig.js'],
  ['PaddleStrokeMotion', 'PaddleReadClock', 'PaddleRig', 'paddleGripProfile', 'paddleContactRange',
    'paddleForehand', 'stepPaddleAngle', 'paddleAngleDelta', 'paddleBottomExtent', 'keepPaddleAboveTable',
    'faceFromWrist', 'paddleFaceAngles', 'playerWristPose', 'deriveStroke', 'refineRacket',
    'strokeFrame', 'resolvedRacketFrame', 'SwipeTracker', 'impactRacket', 'predict', 'PH', 'V3', 'Q', 'M4', 'DEG']);
const { V3, DEG, faceFromWrist, PaddleStrokeMotion } = lib;
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

for (const grip of ['shakehand', 'penhold']) for (const hand of ['right', 'left']) {
  test(`${grip}/${hand}: exact physical contact, correct stroke-specific follow, complete recovery`, () => {
    for (const stroke of ['DRIVE', 'LOOP', 'CHOP', 'PUSH', 'BLOCK', 'SERVE_TOP']) {
      for (const forehand of [true, false]) {
        const profile = lib.paddleGripProfile(grip, stroke, forehand);
        const ready = { yaw: 0, pitch: -profile.ready * DEG, roll: hand === 'left' ? -.3 : .3 };
        const pitch = -profile.contact * DEG, yaw = hand === 'left' ? .2 : -.2;
        const normal = faceFromWrist(V3.new(), yaw, pitch, 1);
        const motion = new PaddleStrokeMotion();
        motion.contact(normal, ready.roll, stroke, grip, hand, forehand);
        const start = motion.sample(1 / 30, ready);
        near(start.pitch, pitch); near(start.yaw, yaw);
        assert.equal(start.stage, 'contact');
        const hold = motion.sample(.02, ready);
        near(hold.pitch, pitch); assert.equal(hold.stage, 'contact');
        const follow = motion.sample(.005 + profile.followTime * .7, ready);
        assert.equal(follow.stage, 'follow');
        if (profile.follow > profile.contact) assert.ok(follow.pitch < pitch);
        else if (profile.follow < profile.contact) assert.ok(follow.pitch > pitch);
        assert.ok(Math.abs(follow.roll - ready.roll) <= Math.abs(profile.roll));
        let output;
        for (let i = 0; i < 100; i++) output = motion.sample(1 / 120, ready);
        assert.equal(output, null); assert.equal(motion.stage, 'ready'); assert.equal(motion.active, false);
      }
    }
  });
}

test('motion at equal timestamps is identical at 30, 60, 120 and 144 FPS', () => {
  for (const grip of ['shakehand', 'penhold']) for (const stroke of ['LOOP', 'CHOP', 'BLOCK']) {
    const ready = { yaw: .1, pitch: -.15, roll: .28 };
    const outputs = [];
    for (const fps of [30, 60, 120, 144]) {
      const m = new PaddleStrokeMotion();
      m.contact(faceFromWrist(V3.new(), -.25, .3, 1), .4, stroke, grip, 'right');
      m.sample(0, ready);
      let elapsed = 0, value;
      // Stop at exactly .2 seconds, including a fractional final frame.
      while (elapsed < .2 - 1e-10) {
        const dt = Math.min(1 / fps, .2 - elapsed);
        value = m.sample(dt, ready); elapsed += dt;
      }
      outputs.push(value);
    }
    for (const output of outputs.slice(1)) {
      for (const axis of ['yaw', 'pitch', 'roll']) near(output[axis], outputs[0][axis], 1e-8);
      assert.equal(output.stage, outputs[0].stage);
    }
  }
});

test('contact remains visible without follow-through and a new stroke interrupts recovery', () => {
  const m = new PaddleStrokeMotion(), ready = { yaw: 0, pitch: -.2, roll: .3 };
  m.contact(faceFromWrist(V3.new(), 0, .4, 1), .3, 'CHOP', 'shakehand', 'right', true, false);
  near(m.sample(.05, ready).pitch, .4);
  const recovery = m.sample(.06, ready);
  assert.equal(recovery.stage, 'recover'); assert.ok(recovery.pitch <= .4);
  assert.equal(m.sample(.01, ready, true), null);
  assert.equal(m.stage, 'ready');
});

test('bounded angular response is FPS-independent and never exceeds its speed budget', () => {
  for (const [start, end, speed] of [[0, 1.4, 6], [3.19, -3.19, 10], [-1, .2, 12]]) {
    const outputs = [];
    for (const fps of [30, 60, 120, 144]) {
      let angle = start, elapsed = 0;
      while (elapsed < .25 - 1e-10) {
        const dt = Math.min(1 / fps, .25 - elapsed);
        const next = lib.stepPaddleAngle(angle, end, 17, dt, speed, true);
        assert.ok(Math.abs(next - angle) <= speed * dt + 1e-9);
        angle = next; elapsed += dt;
      }
      outputs.push(angle);
    }
    for (const output of outputs.slice(1)) near(output, outputs[0], 1e-8);
  }
  const pen = lib.stepPaddleAngle(3.19, -3.19, 17, .05, 10, true);
  assert.ok(Math.abs(pen - 3.19) < .15, 'mirroring penhold must not make a full rotation');
  assert.equal(lib.stepPaddleAngle(.3, NaN, 17, .1), .3);
  assert.equal(lib.stepPaddleAngle(.3, 1, 17, NaN), .3);
});

test('forehand/backhand hysteresis rejects touch noise and mirrors exactly', () => {
  for (const hand of ['right', 'left']) {
    const h = hand === 'left' ? -1 : 1;
    let previous = true;
    for (const x of [-.07, -.10, -.06, -.12, -.09]) previous = lib.paddleForehand(x * h, hand, previous);
    assert.equal(previous, true);
    previous = lib.paddleForehand(-.14 * h, hand, previous);
    assert.equal(previous, false);
    for (const x of [-.07, -.09, -.04]) previous = lib.paddleForehand(x * h, hand, previous);
    assert.equal(previous, false);
    assert.equal(lib.paddleForehand(-.02 * h, hand, previous), true);
  }
});

test('penhold backhand has its own wrist travel without mirroring topspin sign', () => {
  const fh = lib.paddleGripProfile('penhold', 'LOOP', true);
  const bh = lib.paddleGripProfile('penhold', 'LOOP', false);
  assert.ok(bh.roll > fh.roll);
  assert.ok(bh.follow > fh.follow);
  assert.ok(fh.contact > 0 && bh.contact > 0);
  assert.equal(lib.paddleGripProfile('shakehand', 'COUNTER').family, 'LOOP');
  assert.equal(lib.paddleGripProfile('penhold', 'SERVE_SIDE').family, 'SERVE');
});

test('intercept reads run near 30 Hz on every display and refresh immediately on a new shot', () => {
  for (const fps of [30, 60, 120, 144]) {
    const clock = new lib.PaddleReadClock();
    let reads = 0;
    for (let i = 0; i < fps * 2; i++) if (clock.advance(1 / fps, true, 7)) reads++;
    assert.ok(reads >= 59 && reads <= 61, `${fps} FPS produced ${reads} reads`);
    assert.ok(clock.age < 1 / 30 + 1 / fps);
    assert.equal(clock.advance(1 / fps, true, 8), true);
    assert.equal(clock.age, 0);
    assert.equal(clock.advance(1 / fps, false, 8), false);
    assert.equal(clock.advance(1 / fps, true, 8), true);
  }
});

test('analytical table clearance agrees with the actual blade, rubbers and handle transforms', () => {
  const rig = new lib.PaddleRig();
  const S = { mesh: { blade: 'blade', rubber: 'rubber', handle: 'handle' }, mat: {} };
  for (const grip of ['shakehand', 'penhold']) for (const hand of ['right', 'left']) {
    for (const x of [-.7, 0, .7]) for (const pitch of [-.8, 0, .6]) {
      const pose = lib.playerWristPose({ x, y: .82, z: .9 }, V3.new(), hand, { grip });
      const normal = faceFromWrist(V3.new(), .3, pitch, 1), calls = [];
      rig.draw({ draw(mesh, matrix) { calls.push({ mesh, matrix: Array.from(matrix) }); } }, S,
        { pos: V3.new(), normal, roll: pose.roll, absoluteRoll: true, hand });
      let bottom = Infinity;
      for (const c of calls) {
        const m = c.matrix;
        const y = (px, py, pz) => m[1] * px + m[5] * py + m[9] * pz + m[13];
        if (c.mesh === 'handle') {
          for (const a of [-.015, .015]) for (const b of [-.05, .05]) for (const z of [-.011, .011]) bottom = Math.min(bottom, y(a, b, z));
        } else {
          const [rx, ry, thick] = c.mesh === 'blade' ? [.077, .082, .007] : [.072, .077, .0015];
          for (let i = 0; i < 360; i++) for (const z of [-thick, thick]) bottom = Math.min(bottom, y(rx * Math.cos(i * DEG), ry * Math.sin(i * DEG), z));
        }
      }
      near(lib.paddleBottomExtent(normal, pose.roll), -bottom, 4e-6);
      const pos = V3.new(x, .6, .9);
      lib.keepPaddleAboveTable(pos, normal, pose.roll, .76, .7625, 1.37);
      assert.ok(pos.y + bottom >= .7659);
    }
  }
  const outside = V3.new(1.5, .6, 2);
  assert.equal(lib.keepPaddleAboveTable(outside, V3.new(0, 0, -1), 0, .76, .7625, 1.37), 0);
  assert.equal(outside.y, .6);
});

test('refinement respects grip envelopes and its metadata rebuilds the actual impact frame', () => {
  for (const grip of ['shakehand', 'penhold']) for (const forehand of [true, false]) {
    const sw = new lib.SwipeTracker();
    sw.down(.5, .75, 0); sw.move(.52, .58, .05); sw.up(.55, .4, .1);
    const ball = V3.new(.1, .95, 1.55), vel = V3.new(0, -1, 5), spin = V3.new(250, 25, 0);
    const raw = lib.deriveStroke(sw.lastReleased, { side: 1, grip, forehand, ball: { y: ball.y, z: ball.z } });
    for (const assist of [0, .5, 1]) {
      const r = lib.refineRacket(ball, vel, spin, raw, assist, .85);
      const range = r.faceEnvelope || lib.paddleContactRange(grip, r.stroke.id, forehand, false);
      const pitch = Math.asin(r.normal.y) / DEG;
      assert.ok(pitch >= range[0] - 1e-6 && pitch <= range[1] + 1e-6);
      const v = V3.new(), n = V3.new();
      lib.strokeFrame(r, 0, 0, 1, v, n);
      assert.ok(V3.dist(n, r.normal) < 1e-8);
      assert.ok(V3.dist(v, r.vR) < 1e-8);
    }
  }
});

test('zero refinement preserves even a wide sidespin face azimuth', () => {
  const racket = { side: 1, elev: 20, azSwing: .5, azFace: 1.25, faceElev: -.2,
    contact: 40, vmag: 7, arch: {}, stroke: { id: 'HOOK' } };
  const v = V3.new(), n = V3.new();
  lib.strokeFrame(racket, 0, 0, 1, v, n);
  near(Math.atan2(n.x, -n.z), 1.25);
});

test('absolute roll is periodic, not clipped after repeated grip and hand changes', () => {
  const rig = new lib.PaddleRig(), normal = V3.norm(V3.new(), V3.new(.2, -.3, -1));
  let expected;
  for (const turns of [-20, -1, 0, 1, 20]) {
    const q = rig.paddleQuat(lib.Q.new(), normal, 'right', 0, .4 + turns * Math.PI * 2, true);
    const m = lib.M4.compose(lib.M4.create(), V3.new(), q, V3.new(1, 1, 1));
    if (!expected) expected = Array.from(m);
    for (let i = 0; i < 16; i++) near(m[i], expected[i], 1e-6);
  }
});


test('low/slow topspin opens adaptively while a strong high loop retains 30–50 degrees', () => {
  const normal = lib.paddleContactRange('shakehand', 'LOOP', true, false,
    { swingSpeed: 15, contactY: 1.2, incomingTop: 200 });
  near(normal[0], -50); near(normal[1], -30);
  const low = lib.paddleContactRange('shakehand', 'LOOP', true, false,
    { swingSpeed: 8, contactY: .88, incomingTop: -200 });
  near(low[0], -50); near(low[1], -15);
  const flick = lib.paddleContactRange('shakehand', 'FLICK');
  assert.ok(flick[1] > normal[1], 'short-table flick is not a full loop');
});

test('36 grip/height/depth/gesture cases return legally under the actual 600 Hz physics', () => {
  let checked = 0, independentlySolved = 0;
  for (const grip of ['shakehand', 'penhold']) {
    for (const y of [.88, 1.05, 1.3]) for (const z of [1.2, 1.65]) for (const dy of [-.35, -.12, .25]) {
      const sw = new lib.SwipeTracker();
      sw.down(.5, .5, 0); sw.move(.52, .5 + dy / 2, .05); sw.up(.54, .5 + dy, .1);
      const p = V3.new(0, y, z), v = V3.new(0, -1, 6), w = V3.new(150, 0, 0);
      const raw = lib.deriveStroke(sw.lastReleased, { side: 1, grip, ball: { y, z }, ballSpin: w, ballSpeed: 6, movePitch: -.15 });
      const r = lib.refineRacket(p, v, w, raw, .85, .85);
      if (r.dWrist) independentlySolved++;
      assert.equal(r.valid, true, `${grip} ${y}/${z}/${dy}: solver failed`);
      lib.impactRacket(v, w, r.normal, r.vR, .85, r.rubber);
      V3.addScaled(p, p, r.normal, lib.PH.R * 1.05);
      const report = lib.predict(p, v, w, { dt: lib.PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: {} });
      assert.ok(!report.hitNet && report.landed && report.landed.z < 0,
        `${grip} ${y}/${z}/${dy}: final physical trajectory is not legal`);
      const range = r.faceEnvelope;
      const pitch = Math.asin(r.normal.y) / DEG;
      if (range) assert.ok(pitch >= range[0] - 1e-6 && pitch <= range[1] + 1e-6);
      checked++;
    }
  }
  assert.equal(checked, 36);
  assert.ok(independentlySolved > 0, 'exercise the separate arm/wrist recovery, not just the old solver');
});

test('penhold handle stays up but follows the same lateral wrist direction as shakehand', () => {
  const rig = new lib.PaddleRig(), scene = { mesh: { blade: 'blade', rubber: 'rubber', handle: 'handle' }, mat: {} };
  for (const hand of ['right', 'left']) for (const x of [-.65, 0, .65]) {
    const handles = {};
    for (const grip of ['shakehand', 'penhold']) {
      const pose = lib.playerWristPose({ x, y: 1.1, z: 1.5 }, V3.new(), hand, { grip });
      const normal = faceFromWrist(V3.new(), pose.yaw, pose.pitch, 1);
      rig.draw({ draw(mesh, m) { if (mesh === 'handle') handles[grip] = { x: m[12], y: m[13] }; } }, scene,
        { pos: V3.new(), normal, roll: pose.roll, hand, absoluteRoll: true });
    }
    assert.ok(handles.penhold.y > 0, 'penhold handle must point up');
    assert.ok(handles.shakehand.y < 0, 'shakehand handle must point down');
    assert.equal(Math.sign(handles.penhold.x), Math.sign(handles.shakehand.x), '180-degree grip must not invert the lateral lean');
  }
});

test('penhold follow-through reverses local roll, not the physical contact face', () => {
  for (const hand of ['right', 'left']) for (const forehand of [true, false]) {
    const sign = hand === 'left' ? -1 : 1, normal = faceFromWrist(V3.new(), 0, -.3, 1);
    for (const grip of ['shakehand', 'penhold']) {
      const ready = { yaw: 0, pitch: -.3, roll: grip === 'penhold' ? sign * (Math.PI - .052) : sign * .28 };
      const motion = new PaddleStrokeMotion(); motion.contact(normal, ready.roll, 'LOOP', grip, hand, forehand);
      const first = motion.sample(0, ready); near(first.pitch, -.3); near(first.roll, ready.roll);
      const follow = motion.sample(.025 + motion.profile.followTime * .8, ready);
      assert.equal(Math.sign(follow.roll - ready.roll), sign * (grip === 'penhold' ? -1 : 1));
    }
  }
});
