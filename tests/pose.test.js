/* Regression suite for the racket pose (tt/src/57_pose.js).
 *
 * Every test here exists because something in the previous implementation
 * measured as "not working": the bat parked at the edge of the table moved
 * its face by 0.1 degrees, forward/back mouse travel changed nothing at all,
 * a left-handed player was a right-handed one with the sign of that 0.1
 * degree flipped, and the left button did nothing until it was released.
 * The numbers below are the floor, not the ceiling. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '30_physics.js', '57_camera.js', '56_rig.js', '57_pose.js'],
  ['RacketPose', 'RACKET_POSE', 'PaddleRig', 'GRIP_ROLL', 'RIG_EXTRA_ROLL', 'RIG_TOTAL_ROLL',
    'PADDLE_LIMITS', 'PH', 'V3', 'Q', 'M4']);
const { RacketPose, RACKET_POSE: P, PH, V3, Q, M4, PaddleRig, PADDLE_LIMITS,
  GRIP_ROLL, RIG_EXTRA_ROLL, RIG_TOTAL_ROLL } = lib;
/* NOTE: the bundle's own `DEG` is radians-per-degree (10_math.js), the
 * opposite of the usual convention, so this file spells the conversion out
 * in full instead of reusing a name that means two different things. */
const RAD2DEG = 180 / Math.PI;

/* The near side's reach box and ready pose, taken from the game itself so
   the tests can never drift away from the control mapping. */
const HOME = new RacketPose({ hand: 'right', side: 1 }).home;
const BOX = {
  xLimit: PADDLE_LIMITS.x, zIn: PADDLE_LIMITS.zNear, zOut: PADDLE_LIMITS.zFar,
  yLo: PH.TABLE_Y + PADDLE_LIMITS.yLo, yHi: PH.TABLE_Y + PADDLE_LIMITS.yHi,
};
const FAR_BOX = {
  xLimit: 1.12, zIn: -1.05, zOut: -2.5,
  yLo: PH.TABLE_Y - 0.05, yHi: PH.TABLE_Y + 0.96,
};

const mk = (hand = 'right', side = 1) => new RacketPose({
  hand, side,
  home: side > 0 ? HOME : { x: 0, y: HOME.y, z: -1.45 },
});
const inp = (o, extra) => Object.assign({
  x: HOME.x, y: HOME.y, z: HOME.z, vx: 0, vz: 0,
  pressing: false, followThrough: true,
}, BOX, o || {}, extra || {});

/** Settle: run long enough that every smoothing has converged. */
function settle(pose, o, seconds = 1.5, fps = 120) {
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) pose.update(1 / fps, o);
  return pose;
}
const deg = (r) => r * RAD2DEG;
function angles(pose) { return { pitch: pose.pitch, yaw: pose.yaw, roll: pose.roll }; }
function totalRollDeg(pose) {
  /* What the player actually sees: the grip the hand holds plus everything
     the pose adds, composed exactly the way the rig composes it. */
  const rig = new PaddleRig();
  const q = rig.paddleQuat(Q.new(), pose.normal, pose.hand, 0, pose.rollWorld);
  const m = M4.compose(M4.create(), V3.new(), q, V3.new(1, 1, 1));
  // the handle is local -Y; read its world x to know which way it leans
  const handle = M4.transformDir(V3.new(), m, V3.new(0, -1, 0));
  return { handleX: handle.x, handleY: handle.y, angle: Math.atan2(-handle.x, -handle.y) * RAD2DEG };
}

/* ================================================================== *
 *  1. the ready position
 * ================================================================== */
test('the ready pose is the authored rest position and is an exact fixed point at every frame rate', () => {
  for (const fps of [30, 60, 120, 144]) {
    const p = mk('right', 1);
    settle(p, inp(), 12, fps);
    assert.ok(Math.abs(p.pitch - P.restPitch) < 1e-12, `pitch at rest @${fps}`);
    assert.equal(p.yaw, 0);
    assert.equal(p.roll, 0);
    assert.equal(p.rollWorld, 0);
    assert.equal(p.press, 0);
    assert.equal(p.snap, 0);
    const before = { ...angles(p), nx: p.normal.x, ny: p.normal.y, nz: p.normal.z };
    for (let i = 0; i < fps * 12; i++) p.update(1 / fps, inp());
    assert.deepEqual({ ...angles(p), nx: p.normal.x, ny: p.normal.y, nz: p.normal.z }, before,
      'a bat that is not moving must not drift');
    assert.ok(p.normal.z < -0.99, 'the ready face points down the table');
  }
});

test('reset() returns to the ready pose instantly, including the click and contact envelopes', () => {
  const p = mk('right', 1);
  settle(p, inp({ x: 0.9, z: 1.05 }, { pressing: true }));
  p.strike(1); p.update(1 / 60, inp({ x: 0.9 }));
  assert.notEqual(p.roll, 0);
  p.reset();
  assert.equal(p.pitch, P.restPitch);
  assert.equal(p.yaw, 0); assert.equal(p.roll, 0);
  assert.equal(p.press, 0); assert.equal(p.snap, 0);
  assert.ok(Math.abs(p.normal.z + 1) < 0.01);
});

/* ================================================================== *
 *  2. left / right side of the table — the thing that did nothing
 * ================================================================== */
test('parking the bat on the right or left of the table really turns and banks the blade', () => {
  for (const hand of ['right', 'left']) {
    const p = mk(hand, 1);
    settle(p, inp());
    const centre = angles(p);
    assert.ok(Math.abs(centre.yaw) < 1e-9 && Math.abs(centre.roll) < 1e-9);

    const r = settle(mk(hand, 1), inp({ x: +PADDLE_LIMITS.x }));
    assert.ok(deg(r.yaw) > 8, `right side must open the face right, got ${deg(r.yaw)} deg`);
    assert.ok(deg(r.roll) < -8, `right side must bank the handle right, got ${deg(r.roll)} deg`);

    const l = settle(mk(hand, 1), inp({ x: -PADDLE_LIMITS.x }));
    assert.ok(deg(l.yaw) < -8);
    assert.ok(deg(l.roll) > 8);
    // exactly antisymmetric about the centre line
    assert.ok(Math.abs(r.yaw + l.yaw) < 1e-9 && Math.abs(r.roll + l.roll) < 1e-9);
    assert.ok(Math.abs(r.pitch - l.pitch) < 1e-9);
  }
});

test('the bank holds while the bat is parked there, it is not a velocity twitch that dies', () => {
  const p = mk('right', 1);
  settle(p, inp({ x: +PADDLE_LIMITS.x }), 0.25);
  const moving = p.roll;
  settle(p, inp({ x: +PADDLE_LIMITS.x }), 3.0);
  const parked = p.roll;
  assert.ok(Math.abs(parked) > 0.25, `still banked after 3 s: ${deg(parked)} deg`);
  assert.ok(Math.abs(parked) >= Math.abs(moving) - 1e-9,
    'the posture must not decay while the hand stays there');
});

/* ================================================================== *
 *  3. forward / back and up / down — previously exactly zero
 * ================================================================== */
test('leaning in over the table closes the face and sitting back opens it', () => {
  const p = mk('right', 1);
  settle(p, inp());
  const rest = p.pitch;
  const fwd = settle(mk('right', 1), inp({ z: PADDLE_LIMITS.zNear }));
  const back = settle(mk('right', 1), inp({ z: PADDLE_LIMITS.zFar }));
  assert.ok(deg(fwd.pitch - rest) > 5, `forward must close the face, got ${deg(fwd.pitch - rest)}`);
  assert.ok(deg(back.pitch - rest) < -5, `back must open the face, got ${deg(back.pitch - rest)}`);
  assert.ok(Math.abs(fwd.yaw) < 1e-9 && Math.abs(fwd.roll) < 1e-9, 'depth alone must not yaw or roll');
});

test('a high bat closes and a low bat opens, the way a player matches the ball', () => {
  const rest = settle(mk('right', 1), inp()).pitch;
  const high = settle(mk('right', 1), inp({ y: PH.TABLE_Y + PADDLE_LIMITS.yHi })).pitch;
  const low = settle(mk('right', 1), inp({ y: PH.TABLE_Y + PADDLE_LIMITS.yLo })).pitch;
  assert.ok(deg(high - rest) > 4, `high bat must close: ${deg(high - rest)}`);
  assert.ok(deg(low - rest) < -4, `low bat must open: ${deg(low - rest)}`);
});

test('the step-in depth a short ball grants still reads as leaning in', () => {
  const p = settle(mk('right', 1), inp({ z: PADDLE_LIMITS.zStepIn, zIn: PADDLE_LIMITS.zStepIn }));
  assert.ok(deg(p.pitch) > deg(P.restPitch) + 5);
  assert.ok(p.pitch <= P.pitch + 1e-12);
});

/* ================================================================== *
 *  4. mouse motion in all four directions
 * ================================================================== */
test('mouse travel turns and banks the blade in the direction of travel', () => {
  const run = (o) => {
    const p = mk('right', 1);
    settle(p, inp());
    let peak = { yaw: 0, roll: 0, pitch: 0 };
    for (let i = 0; i < 60; i++) {
      p.update(1 / 120, inp(o));
      for (const k of Object.keys(peak)) if (Math.abs(p[k]) > Math.abs(peak[k])) peak[k] = p[k];
    }
    return peak;
  };
  const right = run({ vx: 3.5 });
  const left = run({ vx: -3.5 });
  assert.ok(deg(right.yaw) > 3 && deg(right.roll) < -3, 'right travel opens right and banks right');
  assert.ok(deg(left.yaw) < -3 && deg(left.roll) > 3, 'left travel mirrors it');

  const fwd = run({ vz: -3.0 });
  const back = run({ vz: +3.0 });
  assert.ok(deg(fwd.pitch) > deg(P.restPitch) + 2, 'forward travel starts closing the face');
  assert.ok(deg(back.pitch) < deg(P.restPitch) - 2, 'backward travel starts opening it');
});

test('the raw pointer keeps cocking the wrist after the bat has run out of reach', () => {
  /* Desktop: the bat is clamped at the edge of its box, but the mouse is
     still travelling. Without the pointer term the blade froze there. */
  const p = mk('right', 1);
  settle(p, inp({ x: PADDLE_LIMITS.x }));
  const atEdge = p.yaw;
  let peak = atEdge, px = 0.9;
  for (let i = 0; i < 120; i++) {
    px += 0.02;
    p.update(1 / 120, inp({ x: PADDLE_LIMITS.x, vx: 0, ptrX: px, ptrY: 0.55 }));
    peak = Math.max(peak, p.yaw);
  }
  assert.ok(deg(peak - atEdge) > 2, `pointer past the box edge must add yaw, added ${deg(peak - atEdge)}`);
  assert.ok(peak <= P.yaw + 1e-12);

  const q = mk('right', 1);
  settle(q, inp());
  let peakP = q.pitch, py = 0.55;
  for (let i = 0; i < 120; i++) {
    py -= 0.02;
    q.update(1 / 120, inp({ ptrX: 0.5, ptrY: py }));
    peakP = Math.max(peakP, q.pitch);
  }
  assert.ok(deg(peakP) > deg(P.restPitch) + 3, `pointer forward must close the face, got ${deg(peakP)}`);
});

/* ================================================================== *
 *  5. the click, with no travel at all
 * ================================================================== */
test('pressing the button cocks the wrist with no movement whatsoever', () => {
  const p = mk('right', 1);
  settle(p, inp({ x: 0.6 }));
  const before = angles(p);
  for (let i = 0; i < 6; i++) p.update(1 / 120, inp({ x: 0.6 }, { pressing: true }));
  assert.ok(p.press > 0.7, `the cock must arrive in 50 ms, got ${p.press}`);
  assert.ok(p.pitch < before.pitch, 'cocking opens the face');
  assert.ok(p.roll > before.roll, 'and winds the roll back, opposite the snap');
  assert.ok(p.yaw > before.yaw, 'and winds the face toward the reaching side');

  // held down, it saturates and stays there — a held button is not a stroke.
  // Exact, not approximately: the envelope snaps shut at both ends so a
  // posture the player is keeping cannot keep creeping frame after frame.
  settle(p, inp({ x: 0.6 }, { pressing: true }), 2.0);
  assert.equal(p.press, 1, 'a held button arrives at a full cock and stops');
  const held = angles(p);
  for (let i = 0; i < 60; i++) p.update(1 / 120, inp({ x: 0.6 }, { pressing: true }));
  assert.deepEqual(angles(p), held, 'a held press is an exact fixed point');

  // release: back to the posture
  settle(p, inp({ x: 0.6 }), 2.0);
  assert.ok(Math.abs(p.pitch - before.pitch) < 1e-9);
  assert.ok(Math.abs(p.roll - before.roll) < 1e-9);
  assert.equal(p.press, 0);
});

/* ================================================================== *
 *  6. contact: the snap and the follow-through
 * ================================================================== */
test('contact snaps the blade through the ball within 50 ms and then follows through', () => {
  const p = mk('right', 1);
  settle(p, inp({ x: 0.6 }));
  const before = angles(p);
  for (let i = 0; i < 10; i++) p.update(1 / 120, inp({ x: 0.6 }, { pressing: true }));
  p.strike(1);
  p.update(1 / 120, inp({ x: 0.6 }));
  p.update(1 / 120, inp({ x: 0.6 }));
  p.update(1 / 120, inp({ x: 0.6 }));
  p.update(1 / 120, inp({ x: 0.6 }));
  p.update(1 / 120, inp({ x: 0.6 }));
  p.update(1 / 120, inp({ x: 0.6 }));   // 50 ms after contact
  assert.ok(p.pitch > before.pitch + 0.05, `the face must close through the ball, got ${deg(p.pitch - before.pitch)}`);
  assert.ok(p.yaw < before.yaw, 'and carry across the body');
  assert.equal(p.press, 0, 'the cock is spent on the ball, not held');
  assert.ok(p.snap > 0.4 && p.snap < 1);

  // the follow-through decays and lands exactly back on the posture
  settle(p, inp({ x: 0.6 }), 3.0);
  assert.equal(p.snap, 0, 'the snap must terminate, not tail forever');
  assert.ok(Math.abs(p.pitch - before.pitch) < 1e-9);
  assert.ok(Math.abs(p.roll - before.roll) < 1e-9);
});

test('a harder gesture snaps harder, and followThrough off stops the blade at the ball', () => {
  const soft = mk('right', 1), hard = mk('right', 1), noFt = mk('right', 1);
  for (const p of [soft, hard, noFt]) settle(p, inp({ x: 0.6 }));
  soft.strike(0.2); hard.strike(1.4); noFt.strike(1.4);
  const step = (p, ft) => { for (let i = 0; i < 5; i++) p.update(1 / 120, inp({ x: 0.6 }, { followThrough: ft })); };
  step(soft, true); step(hard, true); step(noFt, false);
  assert.ok(hard.pitch > soft.pitch, 'more power closes the face more');
  assert.ok(noFt.snap < hard.snap, 'followThrough off must kill the continuation faster');
  settle(noFt, inp({ x: 0.6 }, { followThrough: false }), 1.0);
  assert.equal(noFt.snap, 0);
});

/* ================================================================== *
 *  7. handedness and mirror symmetry
 * ================================================================== */
test('a right-hander reaching right is the exact reflection of a left-hander reaching left', () => {
  const r = settle(mk('right', 1), inp({ x: +0.85 }));
  const l = settle(mk('left', 1), inp({ x: -0.85 }));
  assert.ok(Math.abs(r.pitch - l.pitch) < 1e-12, 'pitch is a sagittal angle: it must not flip');
  assert.ok(Math.abs(r.yaw + l.yaw) < 1e-12, 'yaw must flip under x -> -x');
  assert.ok(Math.abs(r.roll + l.roll) < 1e-12, 'roll must flip under x -> -x');
  assert.ok(Math.abs(r.normal.x + l.normal.x) < 1e-12);
  assert.ok(Math.abs(r.normal.y - l.normal.y) < 1e-12);
  assert.ok(Math.abs(r.normal.z - l.normal.z) < 1e-12);
});

test('the two hands do NOT hold the same blade at the same world position', () => {
  /* This is the bug the old `* handed` multiplier produced in reverse: it
     made the roll agree at the same world x, which a reflection can never
     do. The posture angles agree (they are expressed in body space) but the
     DRAWN blade — grip plus posture — must differ by twice the grip. */
  for (const x of [+0.85, 0, -0.85]) {
    const r = settle(mk('right', 1), inp({ x }));
    const l = settle(mk('left', 1), inp({ x }));
    const tr = totalRollDeg(r), tl = totalRollDeg(l);
    assert.ok(Math.abs(tr.angle - tl.angle) > 30,
      `handle angle must differ between hands at x=${x}: ${tr.angle.toFixed(1)} vs ${tl.angle.toFixed(1)}`);
    assert.ok(Math.sign(tr.handleX || 1e-9) !== Math.sign(tl.handleX || 1e-9) || Math.abs(tr.handleX) < 1e-6,
      'the two handles lean to opposite sides');
  }
});

test('which side of the body is the forehand swaps with the hand, and the snap knows it', () => {
  const r = mk('right', 1), l = mk('left', 1);
  assert.ok(r.forehandFlag(+0.8) > 0.9, "a right-hander's forehand is on their right");
  assert.ok(r.forehandFlag(-0.8) < 0.1);
  assert.ok(l.forehandFlag(-0.8) > 0.9, "a left-hander's forehand is on their left");
  assert.ok(l.forehandFlag(+0.8) < 0.1);
  assert.ok(Math.abs(r.forehandFlag(0) - 0.5) < 1e-12, 'the centre of the body is neither');

  /* The forehand wrist snap is much stronger than the backhand one, so the
     same world position must snap differently for the two hands. Measured as
     the DELTA from the posture the blade was already holding: the absolute
     roll is mostly the stance bank, and both sides saturate the wrist limit
     if you measure that instead. */
  const snapAt = (hand, x) => {
    const p = settle(mk(hand, 1), inp({ x }));
    const before = p.roll;
    p.strike(1);
    let peak = 0;
    for (let i = 0; i < 12; i++) { p.update(1 / 120, inp({ x })); peak = Math.max(peak, Math.abs(p.roll - before)); }
    return peak;
  };
  const rFore = snapAt('right', +0.85), rBack = snapAt('right', -0.85);
  const lFore = snapAt('left', -0.85), lBack = snapAt('left', +0.85);
  assert.ok(rFore > rBack * 1.2,
    `righty forehand snap ${deg(rFore).toFixed(1)} deg must beat backhand ${deg(rBack).toFixed(1)} deg`);
  assert.ok(lFore > lBack * 1.2,
    `lefty forehand snap ${deg(lFore).toFixed(1)} deg must beat backhand ${deg(lBack).toFixed(1)} deg`);
  assert.ok(Math.abs(rFore - lFore) < 1e-9, 'both forehands snap identically');
  assert.ok(Math.abs(rBack - lBack) < 1e-9, 'and both backhands too');
});

test('setHand() mirrors the forehand side without teleporting the blade', () => {
  const p = settle(mk('right', 1), inp({ x: +0.6 }));
  const before = angles(p);
  assert.ok(p.setHand('left'));
  assert.equal(p.setHand('left'), false, 'setting the same hand again is a no-op');
  assert.deepEqual(angles(p), before, 'switching hands must not move the blade by itself');
  for (let i = 0; i < 200; i++) p.update(1 / 120, inp({ x: +0.6 }, { hand: 'left' }));
  assert.ok(p.forehandFlag(+0.6) < 0.1, 'and the same x is now the backhand side');
});

/* ================================================================== *
 *  8. the far side of the table
 * ================================================================== */
test('the opponent pose faces the near side and leans in over the table the same way', () => {
  const p = settle(mk('left', -1), inp({ x: 0, y: HOME.y, z: -1.45 }, FAR_BOX));
  assert.ok(p.normal.z > 0.99, 'the far blade faces +z, toward the player');
  assert.ok(Math.abs(p.normal.x) < 1e-9);
  const lean = settle(mk('left', -1), inp({ x: 0, y: HOME.y, z: -1.05 }, FAR_BOX));
  assert.ok(lean.pitch > p.pitch + 0.05, 'moving toward the net closes the far face too');
  const back = settle(mk('left', -1), inp({ x: 0, y: HOME.y, z: -2.5 }, FAR_BOX));
  assert.ok(back.pitch < p.pitch - 0.05);
  // the far side's "right" is world -x, so its stance mirrors in z, not x
  const farRight = settle(mk('left', -1), inp({ x: -0.9, y: HOME.y, z: -1.45 }, FAR_BOX));
  assert.ok(farRight.yaw > 0.05, 'body-space right is world -x on the far side');
  assert.ok(farRight.normal.x < 0, 'and the drawn face turns to world -x');
  assert.ok(farRight.rollWorld * farRight.roll < 0, 'rollWorld is body roll reflected by side');
});

/* ================================================================== *
 *  9. bounds, garbage input, determinism
 * ================================================================== */
test('pathological input cannot exceed the authored anatomy or break the normal', () => {
  const nasty = [
    { vx: 1e9, vz: -1e9 }, { vx: NaN, vz: NaN }, { vx: Infinity, vz: -Infinity },
    { x: 1e6, y: -1e6, z: 1e6 }, { x: NaN, y: NaN, z: NaN },
    { ptrX: NaN, ptrY: 1e9 }, { ptrX: 1e9, ptrY: -1e9 },
    { xLimit: 0, zIn: 1, zOut: 1, yLo: 1, yHi: 1 },
  ];
  /* Each side gets its OWN home and reach box: feeding a far-side pose the
     near-side box is not a pathological input, it is a different posture, and
     the recovery check would then be measuring the wrong target. */
  const homeOf = (side) => (side > 0
    ? { pos: { x: HOME.x, y: HOME.y, z: HOME.z }, box: BOX }
    : { pos: { x: 0, y: HOME.y, z: -1.45 }, box: FAR_BOX });
  for (const hand of ['right', 'left']) for (const side of [1, -1]) {
    const p = mk(hand, side);
    const h = homeOf(side);
    const base = Object.assign({}, h.pos, h.box);
    for (const n of nasty) {
      for (let i = 0; i < 40; i++) {
        p.update(i % 7 === 0 ? NaN : 1 / 120, Object.assign({ pressing: false, followThrough: true }, base, n));
        assert.ok(Math.abs(p.pitch) <= P.pitch + 1e-12, 'pitch bound');
        assert.ok(Math.abs(p.yaw) <= P.yaw + 1e-12, 'yaw bound');
        assert.ok(Math.abs(p.roll) <= P.roll + 1e-12, 'roll bound');
        assert.ok([p.pitch, p.yaw, p.roll, p.normal.x, p.normal.y, p.normal.z, p.press, p.snap]
          .every(Number.isFinite), 'everything finite');
        assert.ok(Math.abs(V3.len(p.normal) - 1) < 1e-9, 'the face normal stays a unit vector');
      }
    }
    // and it still recovers to the ready pose
    settle(p, Object.assign({ pressing: false, followThrough: true }, base), 4);
    assert.ok(Math.abs(p.pitch - P.restPitch) < 1e-9 && Math.abs(p.yaw) < 1e-9 && Math.abs(p.roll) < 1e-9);
  }
});

test('the pose is deterministic and never mutates its input', () => {
  const script = [
    inp({ x: 0.4, vx: 1.2 }), inp({ x: 0.7, vz: -1.0 }, { pressing: true }),
    inp({ x: -0.5, vx: -2.0 }), inp({ x: -0.5 }),
  ];
  const frozen = JSON.stringify(script);
  const run = () => {
    const p = mk('right', 1);
    settle(p, inp());
    const seen = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const s of script) { for (let i = 0; i < 12; i++) { p.update(1 / 120, s); seen.push(p.pitch, p.yaw, p.roll); } }
      p.strike(0.9);
      for (let i = 0; i < 40; i++) { p.update(1 / 120, inp()); seen.push(p.pitch, p.yaw, p.roll); }
    }
    return seen;
  };
  assert.deepEqual(run(), run());
  assert.equal(JSON.stringify(script), frozen, 'the input objects must not be written to');
});

test('the authored limits stay inside the wrist range the rig allows and inside the drawn-normal bound', () => {
  assert.ok(P.roll <= RIG_EXTRA_ROLL, 'the renderer must never truncate an authored pose');
  assert.ok(P.roll + GRIP_ROLL <= RIG_TOTAL_ROLL, 'grip plus posture must fit the anatomical ceiling');
  // this is the number the browser sweep test checks the drawn normal against
  assert.ok(Math.cos(P.pitch) * Math.cos(P.yaw) >= 0.85,
    'the worst deflection must keep the blade facing down the table');
  assert.ok(P.pitch > 0 && P.yaw > 0 && P.roll > 0 && P.restPitch < 0);
  assert.ok(P.snapForehand > P.snapBackhand, 'a forehand snap is a whip, a backhand one is forearm');
  assert.ok(P.rateSnap > P.rateRoll && P.rateSnap > P.ratePitch,
    'the contact snap must be filtered faster than the posture drifts');
});

test('roll never changes the direction the blade hits in, for either hand and any pose', () => {
  const rig = new PaddleRig();
  for (const hand of ['right', 'left']) {
    const p = mk(hand, 1);
    for (const x of [-0.9, -0.3, 0, 0.3, 0.9]) for (const z of [1.05, 1.44, 2.0]) {
      settle(p, inp({ x, z }), 0.6);
      p.strike(1);
      for (const swing of [-1, 0, 1]) {
        const q = rig.paddleQuat(Q.new(), p.normal, hand, swing, p.rollWorld);
        const m = M4.compose(M4.create(), V3.new(), q, V3.new(1, 1, 1));
        const drawn = M4.transformDir(V3.new(), m, V3.new(0, 0, 1));
        assert.ok(V3.dist(drawn, p.normal) < 1e-6,
          'the drawn face normal must be the physical one, roll included');
      }
    }
  }
});

/* --------------------------------------------------------------- *
 *  22. A saved rally keeps the wrist it was played with.
 * --------------------------------------------------------------- */
test('22 the wrist bank and the swing survive a replay round-trip', () => {
  const R2 = load(['10_math.js', '59_replay.js'], ['MomentRecorder', 'MomentPlayer', 'V3']);
  const rec = new R2.MomentRecorder();
  const g = {
    ball: { p: R2.V3.new(0, 0.3, 0), v: R2.V3.new(), w: R2.V3.new(), live: true, hist: [] },
    player: { pos: R2.V3.new(0, 0.5, 2.6), normal: R2.V3.new(0, 0, -1), roll: 0, swing: 0 },
    aiPaddle: { pos: R2.V3.new(0, 0.5, -2.6), normal: R2.V3.new(0, 0, 1) },
    aiPose: { rollWorld: 0 },
    ai: { pos: R2.V3.new(0, 0.5, -2.6), anim: { swing: 0, lean: 0 } }
  };
  const push = (t, roll, swing, aiRoll, aiSwing, aiLean) => {
    g.player.roll = roll; g.player.swing = swing;
    g.aiPose.rollWorld = aiRoll; g.ai.anim.swing = aiSwing; g.ai.anim.lean = aiLean;
    rec.push(t, g);
  };
  rec.beginRally(0, null);
  push(0, 0, 0, 0, 0, 0);
  push(1 / 30, -0.31, 1, 0.24, -0.8, 0.5);      // a banked forehand with the swing at its peak
  push(2 / 30, -0.12, 0.2, 0.1, -0.1, 0.1);

  const clip = rec.captureClip(2 / 30);
  const player = new R2.MomentPlayer();
  /* speed = 1/0.45 cancels the reel's ease-in on the very first step, so the
     cursor lands exactly on frame 1 and the comparison is exact, not fuzzy */
  assert.ok(player.play(clip, 1 / 0.45));

  player.update(1 / 30, g);                    // lands exactly on frame 1
  assert.ok(Math.abs(g.player.roll + 0.31) < 1e-6, 'the player bank must come back from the clip');
  assert.ok(Math.abs(g.player.swing - 1) < 1e-6, 'the swing phase must come back from the clip');
  assert.ok(Math.abs(g.aiPose.rollWorld - 0.24) < 1e-6, 'the AI bank must come back from the clip');
  assert.ok(Math.abs(g.ai.anim.swing + 0.8) < 1e-6 && Math.abs(g.ai.anim.lean - 0.5) < 1e-6,
    'the AI swing and lean must come back from the clip');

  player.update(1 / 30, g);                    // frame 2
  assert.ok(Math.abs(g.player.roll + 0.12) < 1e-6, 'the bank must follow the clip frame by frame');
  for (const v of [g.player.roll, g.player.swing, g.aiPose.rollWorld, g.ai.anim.swing, g.ai.anim.lean]) {
    assert.ok(Number.isFinite(v), 'every restored replay scalar stays finite');
  }
});
