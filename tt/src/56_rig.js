/* =====================================================================
 *  PADDLE-ONLY RIG
 *  Local +Z is the red face normal; the handle extends along local -Y.
 *  No hand/arm geometry. Drawing is a pure consumer of the gameplay pose.
 * ===================================================================== */
'use strict';

/** Shakehand-inspired player pose, in world/player coordinates.
 * Local +Y points from grip to blade head. All targets are absolute:
 * lateral reach sets forehand/backhand stance; phase adds wrist motion.
 * Reflecting x, velocity.x and handedness reflects the entire pose.
 * These are animation limits, not a claim of biomechanical simulation.
 */
function playerWristPose(pos, vel, hand, phase = {}) {
  const h = hand === 'left' ? -1 : 1;
  const reach = Math.tanh(pos.x / 0.48);
  const forehand = pos.x * h >= -0.08;
  const t = clamp(Math.abs(pos.x) / 0.72, 0, 1);
  const stance = t * t * (3 - 2 * t);
  const readyRoll = 0.28; // relaxed ready grip (~16°), never rigid 12 o'clock
  const cross = clamp((pos.x * h + 0.24) / 0.32, 0, 1);
  const mix = cross * cross * (3 - 2 * cross);
  const sideRoll = lerp(-1.05, 1.35, mix);
  const preparation = clamp(phase.preparation || 0, 0, 1);
  const follow = clamp(phase.follow || 0, 0, 1);
  const direction = 2 * mix - 1;
  return {
    yaw: clamp(-reach * 0.27 - clamp(vel.x, -7, 7) * 0.035, -0.52, 0.52),
    pitch: clamp(-0.03 + (pos.z - 1.44) * 0.40 + clamp(vel.z, -5, 5) * 0.10
      - clamp(vel.y, -4, 4) * 0.025 + (phase.gesturePitch || 0)
      + preparation * 0.07 - follow * 0.10, -0.55, 0.55),
    roll: clamp(h * (lerp(readyRoll, sideRoll, stance)
      + direction * (preparation * 0.14 - follow * 0.24))
      - clamp(vel.x, -7, 7) * 0.018, -1.55, 1.55),
    forehand,
  };
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
    const roll = absoluteRoll ? clamp(extraRoll || 0, -1.55, 1.55)
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
