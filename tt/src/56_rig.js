/* =====================================================================
 *  PADDLE VISUAL — render the racket only.
 *
 *  The previous version also built a 3D forearm/hand rig and layered several
 *  biomechanical rotations on top of the live hit normal. That extra local-Z
 *  roll made the blade spin like a propeller, and the arm mesh was unwanted.
 *  The game now uses the same racket normal as the stroke/physics solver and
 *  never adds a free spin around the blade's face.
 * ===================================================================== */
'use strict';

class PaddleRig {
  constructor() {
    this.built = false;
    this.R = null;
    this._orientation = Q.new();
    this._bladeMatrix = M4.create();
    this._faceMatrix = M4.create();
    this._normal = V3.new();
    this._offset = V3.new();
    this._handleOffset = V3.new();
    this._unit = { x: 1, y: 1, z: 1 };
    this._up = { x: 0, y: 1, z: 0 };
    this._defaultNormal = { x: 0, y: -0.05, z: -1 };
  }

  build(renderer) {
    if (this.built) return;
    this.R = renderer;
    this.built = true;
  }

  /** Orient local +Z to the solved contact normal; do not roll about it. */
  paddleQuat(out, normal) {
    return Q.lookRotation(out, normal, this._up);
  }

  ghostMat(o, col, rough) {
    return {
      color: o.ghostCol || col,
      rough: rough || 0.4,
      unlit: true,
      blend: 'add',
      opacity: o.alpha !== undefined ? o.alpha : 0.42,
      emissive: [0.06, 0.10, 0.14],
      doubleSided: false,
    };
  }

  draw(renderer, scene, o) {
    this.build(renderer);

    const mesh = scene.mesh;
    const material = scene.mat;
    const mats = o.mats || {};
    const normal = V3.norm(this._normal, o.normal || this._defaultNormal);
    const orientation = this.paddleQuat(this._orientation, normal);
    const pos = o.pos;

    const wood = o.ghost
      ? this.ghostMat(o, o.ghostCol || [0.855, 0.635, 0.495], 0.5)
      : (mats.wood || material.bladeWood);
    const red = o.ghost
      ? this.ghostMat(o, o.ghostCol, 0.5)
      : (mats.red || material.rubberRed);
    const black = o.ghost
      ? this.ghostMat(o, o.ghostCol, 0.5)
      : (mats.black || material.rubberBlack);
    const grip = o.ghost
      ? this.ghostMat(o, o.ghostCol, 0.5)
      : (mats.grip || material.handle);

    // Blade and faces share one stable orientation. Red is always the +normal
    // face and black the -normal face; input changes the normal, not blade roll.
    M4.compose(this._bladeMatrix, pos, orientation, this._unit);
    renderer.draw(mesh.blade, this._bladeMatrix, wood);

    const faceOffset = 0.0085;
    V3.addScaled(this._offset, pos, normal, faceOffset);
    M4.compose(this._faceMatrix, this._offset, orientation, this._unit);
    renderer.draw(mesh.rubber, this._faceMatrix, red);

    V3.addScaled(this._offset, pos, normal, -faceOffset);
    M4.compose(this._faceMatrix, this._offset, orientation, this._unit);
    renderer.draw(mesh.rubber, this._faceMatrix, black);

    // The handle follows the racket's local -Y axis. No hand/arm geometry is
    // allocated or drawn, keeping the mobile scene lean and the racket stable.
    M4.transformDir(this._handleOffset, this._bladeMatrix, { x: 0, y: -0.125, z: 0 });
    V3.addScaled(this._offset, pos, this._handleOffset, 1);
    M4.compose(this._faceMatrix, this._offset, orientation, this._unit);
    renderer.draw(mesh.handle, this._faceMatrix, grip);

    return orientation;
  }
}
