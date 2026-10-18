/* =====================================================================
 *  PADDLE-ONLY RIG
 *  Local +Z is the red face normal; the handle extends along local -Y.
 *  No hand/arm geometry. Drawing is a pure consumer of the gameplay pose.
 * ===================================================================== */
'use strict';

/* The wrist's own range around the handle.
 *  · GRIP_ROLL is the resting angle of the hand that holds it: a right-
 *    hander's handle sits out toward the right hip, a left-hander's toward
 *    the left. It is a property of the GRIP, not of a world direction, so
 *    it is the one part of the blade's roll that does not mirror away when
 *    the lateral pose is expressed in body space (see 57_pose.js).
 *  · RIG_EXTRA_ROLL is the safety clamp on everything the pose adds on top
 *    (stance bank, mouse lead, cock, contact snap). It is wider than the
 *    pose's own authored limit so the renderer can never truncate a pose.
 *  · RIG_TOTAL_ROLL is the anatomical ceiling: grip + swing + pose, so no
 *    combination of inputs can ever wind the blade into a corkscrew. */
const GRIP_ROLL = 0.42;
const RIG_EXTRA_ROLL = 0.44;
const RIG_SWING_ROLL = 0.14;
const RIG_TOTAL_ROLL = 1.05;

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

  /** Absolute orientation, with only a small, bounded grip/swing roll.
   *
   *  The roll is composed in the order the arm composes it: the grip the
   *  hand holds (a constant of WHICH hand, mirrored by hand), the rotation
   *  through the ball that the same grip produces (so it turns the way the
   *  wrist actually turns, not the same way for both hands), and finally
   *  whatever posture the pose module asks for (stance bank, mouse lead,
   *  cock, snap). The total is clamped, so no combination of inputs can
   *  wind the blade past the wrist's range.
   *
   *  Roll is about local +Z, which IS the face normal, so none of this can
   *  change the direction the blade hits in — only the angle the handle
   *  stands at. That invariant is what tests/paddle.test.js pins. */
  paddleQuat(out, normal, hand, swing, extraRoll) {
    Q.lookRotation(out, normal, this._up);
    const gripSign = hand === 'left' ? 1 : -1;
    const roll = clamp(
      gripSign * (GRIP_ROLL + clamp(swing || 0, -1, 1) * RIG_SWING_ROLL)
      + clamp(extraRoll || 0, -RIG_EXTRA_ROLL, RIG_EXTRA_ROLL),
      -RIG_TOTAL_ROLL, RIG_TOTAL_ROLL);
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
      : this.paddleQuat(this._q, o.normal, o.hand, o.swing, o.roll);
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
