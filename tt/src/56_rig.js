/* =====================================================================
 *  PADDLE-ONLY RIG
 *  Local +Z is the red face normal; the handle extends along local -Y.
 *  No hand/arm geometry. Drawing is a pure consumer of the gameplay pose.
 * ===================================================================== */
'use strict';

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

  /** Absolute orientation, with only a small, bounded grip/swing roll. */
  paddleQuat(out, normal, hand, swing, extraRoll) {
    Q.lookRotation(out, normal, this._up);
    const roll = (hand === 'left' ? 0.42 : -0.42)
      + clamp(swing || 0, -1, 1) * 0.3 + clamp(extraRoll || 0, -0.35, 0.35);
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
