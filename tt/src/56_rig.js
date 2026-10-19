/* =====================================================================
 *  PADDLE-ONLY RIG
 *  Local +Z is the red face normal; the handle extends along local -Y.
 *  No hand/arm geometry. Drawing is a pure consumer of the gameplay pose.
 * ===================================================================== */
'use strict';

/**
 * Shakehand-inspired player pose, in world/player coordinates.
 * Local +Y points from grip to blade head. All targets are absolute:
 * lateral reach sets forehand/backhand stance; phase adds wrist motion.
 * Reflecting x, velocity.x, ballX and handedness reflects the entire pose.
 *
 * Drivers — each is a real thing a shakehand player does with the bat:
 *   1. pos.x         lateral reach → yaw + FH/BH clock roll
 *   2. pos.y         height → close a smash, open a push
 *   3. pos.z         depth → open over the table, close off it
 *   4. vel.x         lead the step with the face
 *   5. vel.y         lift opens, drop closes
 *   6. vel.z         a lunge tips the blade into the ball
 *   7. hand          left mirrors right exactly
 *   8. preparation   backswing cocks the wrist (continuous)
 *   9. follow        recovery unrolls it
 *  10. gesturePitch  live swipe flexion
 *  11. gestureYaw    live swipe / curl turn
 *  12. ballX         face tracks the intercept, not the body
 *  13. ballY/contactY  close if the contact is above the bat
 *  14. incomingTop   topspin closes, backspin opens
 *  15. ballSpeed     a fast ball is blocked with a tighter face
 *  16. stepIn/serve/eta  short ball, toss, commit-over-time
 *  17. incomingSide  sidespin yaws the face into the kick
 *  18. compact       block: pull a wide roll back to ready
 *  19. snap          wrist snap in the brush direction
 *  20. aimYaw/Pitch  desktop hover micro-aim (touch leaves these 0)
 *  21. attackLean    drive/loop: close the face, tip the head toward the net
 *
 * Extra drivers are zero when omitted, so a rest pose at x=0, z=1.44 is
 * bit-identical to the ready grip. Animation limits, not full IK.
 */
function playerWristPose(pos, vel, hand, phase = {}) {
  const h = hand === 'left' ? -1 : 1;
  const px = pos.x || 0;
  const reach = Math.tanh(px / 0.48);
  const forehand = typeof phase.forehand === 'boolean' ? phase.forehand : px * h >= -0.08;
  const key = wristStrokeKey(phase.grip, phase.serving ? 'SERVE' : phase.stroke, phase.preparation, phase.follow, forehand);
  const t = clamp(Math.abs(px) / 0.72, 0, 1);
  const stance = t * t * (3 - 2 * t);
  const penhold = phase.grip === 'penhold';

  const readyRoll = penhold ? 0.08 : 0.28; // relaxed ready grip (~16°), never rigid 12 o'clock
  const cross = clamp((px * h + 0.24) / 0.32, 0, 1);
  const mix = cross * cross * (3 - 2 * cross);
  const sideRoll = lerp(-1.05, 1.35, mix);
  const preparation = clamp(phase.preparation || 0, 0, 1);
  const follow = clamp(phase.follow || 0, 0, 1);
  const direction = 2 * mix - 1;

  const vx = clamp((vel && vel.x) || 0, -7, 7);
  const vy = clamp((vel && vel.y) || 0, -4, 4);
  const vz = clamp((vel && vel.z) || 0, -5, 5);

  /* Height. Prefer the predicted contact if the caller has one — that is
     where a real player sets the angle, not where the bat currently sits.
     Missing y is home so x/z-only callers keep the old rest pitch. */
  const HOME_Y = 1.01;
  const hy = Number.isFinite(phase.contactY) ? phase.contactY
    : Number.isFinite(pos.y) ? pos.y : HOME_Y;
  /* Stretched arm cannot close as hard as a compact smash in front. */
  const reachLimit = 1 - 0.32 * stance;
  const heightPitch = -clamp((hy - HOME_Y) / 0.55, -1, 1) * 0.22 * reachLimit;

  /* Depth. Over the table you get under the ball (open); off the end you
     close for a loop. Velocity still tips the blade into a lunge. */
  const pz = Number.isFinite(pos.z) ? pos.z : 1.44;
  const depthPitch = -(pz - 1.44) * 0.22;

  const gestureYaw = clamp(phase.gestureYaw || 0, -0.32, 0.32);
  const gesturePitch = phase.gesturePitch || 0;
  const aimYaw = clamp(phase.aimYaw || 0, -0.12, 0.12);
  const aimPitch = clamp(phase.aimPitch || 0, -0.14, 0.14);
  const snap = clamp(phase.snap || 0, -1, 1);

  const hasBall = Number.isFinite(phase.ballX) || Number.isFinite(phase.ballY)
    || Number.isFinite(phase.incomingTop) || Number.isFinite(phase.ballSpeed)
    || Number.isFinite(phase.incomingSide) || Number.isFinite(phase.contactY);
  const eta = Number.isFinite(phase.eta) ? clamp(phase.eta, 0, 2) : 0.45;
  const commit = hasBall ? clamp(1.20 - eta / 0.48, 0.22, 1) : 0;

  let trackYaw = 0, readPitch = 0;
  if (hasBall) {
    if (Number.isFinite(phase.ballX)) {
      trackYaw = -clamp((phase.ballX - px) / 0.45, -1, 1) * 0.13 * commit;
    }
    const refY = Number.isFinite(pos.y) ? pos.y : HOME_Y;
    if (Number.isFinite(phase.ballY)) {
      readPitch += -clamp((phase.ballY - refY) / 0.32, -1, 1) * 0.11 * commit;
    }
    /* Sign: a ball travelling toward the player (+z) has POSITIVE w.x for
       topspin (see 40_swipe.js). Close for top, open for back. */
    if (Number.isFinite(phase.incomingTop)) {
      readPitch += -clamp(phase.incomingTop / 360, -1, 1) * 0.14 * commit;
    }
    if (Number.isFinite(phase.ballSpeed)) {
      readPitch += -clamp((phase.ballSpeed - 5.5) / 12, 0, 1) * 0.08 * commit;
    }
    /* World-space sidespin: +w.y kicks the ball to the player's +x, so the
       face yaws right (negative yaw) to cover it. Not mirrored by hand —
       both grips live in the same world. */
    if (Number.isFinite(phase.incomingSide)) {
      trackYaw += -clamp(phase.incomingSide / 90, -1, 1) * 0.10 * commit;
    }
  }

  const stepIn = clamp(phase.stepIn || 0, 0, 1);
  const serving = phase.serving ? 1 : 0;
  const sidePitch = stance * (forehand ? -0.055 : 0.075);

  const yaw = clamp(
    -reach * 0.27 - vx * 0.035 + gestureYaw + trackYaw + aimYaw,
    -0.52, 0.52);

  let pitch = key.pitch + depthPitch + heightPitch + vz * 0.10 - vy * 0.025
    + gesturePitch
    + readPitch + stepIn * 0.09 + serving * 0.07 + sidePitch
    + aimPitch - snap * 0.08
    - clamp(phase.attackLean || 0, 0, 1) * 0.28;

  let roll = h * (lerp(readyRoll, sideRoll, stance)
      + direction * (preparation * 0.14 - follow * 0.24))
    - vx * 0.018;

  /* Closing a wide forehand lays the blade back (shoulder opens). Zero at
     the centre because stance is 0, so the ready grip does not drift. */
  const closeAmt = clamp(-pitch - 0.03, 0, 0.45);
  roll += h * stance * closeAmt * 0.50;

  /* Fast incoming + no time: compact block, pull a laid-back roll home. */
  const compact = clamp(phase.compact || 0, 0, 1);
  roll = lerp(roll, h * readyRoll, compact * 0.52);

  /* Near the table the handle cannot lay the blade flat. */
  if (Number.isFinite(pos.y)) {
    const clear = clamp((pos.y - 0.82) / 0.18, 0, 1);
    const cap = lerp(0.62, 1.55, clear);
    roll = clamp(roll, -cap, cap);
  }

  return {
    yaw,
    pitch: clamp(pitch, -0.90, 0.78),
    // Handle-up penhold reverses local roll: the same world-space wrist
    // motion must not lean the handle in the opposite lateral direction.
    roll: (penhold ? h * Math.PI : 0) + clamp(roll * (penhold ? (forehand ? -0.65 : -0.85) : 1), -1.55, 1.55),
    forehand,
  };
}

/** Face normal from wrist yaw/pitch. Roll is around this axis and must
 *  not be baked in — the rubber colours stay on their surfaces. */
function faceFromWrist(out, yaw, pitch, side) {
  const o = out || { x: 0, y: 0, z: 0 };
  const fwd = (side === undefined || side >= 0) ? -1 : 1;
  const p = Number.isFinite(pitch) ? pitch : 0;
  const y = Number.isFinite(yaw) ? yaw : 0;
  const cp = Math.cos(p), sp = Math.sin(p);
  o.x = Math.sin(-y) * cp;
  o.y = sp;
  o.z = fwd * Math.cos(y) * cp;
  const L = Math.hypot(o.x, o.y, o.z) || 1;
  o.x /= L; o.y /= L; o.z /= L;
  return o;
}

class PaddleRig {
  constructor() {
    this._q = Q.new();
    this._rollQ = Q.new();
    this._m = M4.create();
    this._partM = M4.create();
    this._normal = V3.new();
    this._pos = V3.new();
    this._one = { x: 1, y: 1, z: 1 };
    this._up = { x: 0, y: 1, z: 0 };
  }

  /** Player supplies an absolute wrist roll; AI retains its compact grip. */
  paddleQuat(out, normal, hand, swing, extraRoll, absoluteRoll = false) {
    Q.lookRotation(out, normal, this._up);
    const roll = absoluteRoll ? (Number.isFinite(extraRoll) ? paddleAngleDelta(0, extraRoll) : 0)
      : (hand === 'left' ? 0.42 : -0.42)
      + clamp(swing || 0, -1, 1) * 0.3 + clamp(extraRoll || 0, -0.55, 0.55);
    return Q.mul(out, out, Q.setAxisAngle(this._rollQ, 0, 0, 1, roll));
  }

  ghostMat(o) {
    return {
      color: o.ghostCol || [0.25, 0.8, 1], rough: 0.5, unlit: true,
      blend: 'add', opacity: o.alpha !== undefined ? o.alpha : 0.42,
      emissive: [0.06, 0.10, 0.14], doubleSided: false,
    };
  }

  draw(R, S, o) {
    // Copy a supplied quaternion: callers retain ownership of their pose.
    const q = o.q ? Q.copy(this._q, o.q)
      : this.paddleQuat(this._q, o.normal, o.hand, o.swing, o.roll, o.absoluteRoll);
    const me = S.mesh, ma = S.mat, mats = o.mats || {};
    const draw = o.shadowPass
      ? (mesh, matrix, mat) => R.drawShadow(mesh, matrix, null, 0)
      : (mesh, matrix, mat) => R.draw(mesh, matrix, mat);
    const ghost = o.ghost ? this.ghostMat(o) : null;
    M4.compose(this._m, o.pos, q, this._one);
    draw(me.blade, this._m, ghost || mats.wood || ma.bladeWood);

    // Offsets must use the very same quaternion as the blade, not a stale
    // physics normal. Red/black are fixed surfaces, never swapped by ball
    // velocity (which used to make the colours pop at every bounce).
    M4.transformDir(this._normal, this._m, { x: 0, y: 0, z: 1 });
    V3.addScaled(this._pos, o.pos, this._normal, 0.0085);
    M4.compose(this._partM, this._pos, q, this._one);
    draw(me.rubber, this._partM, ghost || mats.red || ma.rubberRed);
    V3.addScaled(this._pos, o.pos, this._normal, -0.0085);
    M4.compose(this._partM, this._pos, q, this._one);
    draw(me.rubber, this._partM, ghost || mats.black || ma.rubberBlack);

    M4.transformDir(this._pos, this._m, { x: 0, y: -0.125, z: 0 });
    V3.add(this._pos, o.pos, this._pos);
    M4.compose(this._partM, this._pos, q, this._one);
    draw(me.handle, this._partM, ghost || mats.grip || ma.handle);
    return q;
  }
}
