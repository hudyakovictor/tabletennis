/* =====================================================================
 *  PADDLE RIG — every paddle in the world gets a hand and an arm.
 *
 *  Why this exists. A paddle floating in the air is a sprite, not an
 *  opponent: the eye has nothing to read, and the scene feels empty even
 *  though the physics underneath is real. One rig, built from the same
 *  primitives as the rest of the scene, fixes three things at once:
 *
 *  · the opponent finally looks like a person standing at the far end —
 *    you can see the wrist snap on a loop and the forearm drop on a chop,
 *    which is exactly the information a table-tennis player watches for;
 *  · the online opponent's hand (same rig, fed from the network);
 *  · the training ghost — the very same rig drawn translucent, tracing
 *    the stroke you were supposed to play.
 *
 *  Nothing here is animated by hand: the arm is solved from the paddle's
 *  own position and normal every frame, so it follows the physics for
 *  free. Limb axes are +Z so a single Q.lookRotation aims them.
 * ===================================================================== */
'use strict';

/** Limb segment: a tapered cylinder whose axis is +Z instead of +Y. */
function limbGeo(rTop, rBot, seg = 16) {
  return transformGeo(makeCylinder(rTop, rBot, 1, seg, true), (p, n) => {
    const y = p.y, z = p.z; p.y = -z; p.z = y;
    const ny = n.y, nz = n.z; n.y = -nz; n.z = ny;
  });
}

const RIG = {
  HANDLE: 0.122,        // how far the fist sits down the handle
  FOREARM: 0.285,       // wrist to elbow
  SKIN: [0.855, 0.635, 0.495],
  SKIN_SHADE: [0.72, 0.50, 0.38],
  SLEEVE: [0.13, 0.20, 0.42],
  SLEEVE_ALT: [0.72, 0.14, 0.19],
};

class PaddleRig {
  constructor() { this.built = false; }

  build(R) {
    if (this.built) return;
    this.mFore = R.mesh(limbGeo(0.0265, 0.0405, 16));       // forearm
    this.mUpper = R.mesh(limbGeo(0.0405, 0.047, 14));       // elbow end of the sleeve
    this.mSleeve = R.mesh(limbGeo(0.049, 0.056, 16));       // short sleeve cuff
    this.mPalm = R.mesh(makeSphere(0.047, 18, 12));         // fist
    this.mThumb = R.mesh(limbGeo(0.0145, 0.018, 10));       // thumb over the handle
    this.mJoint = R.mesh(makeSphere(0.041, 14, 10));        // elbow
    this.mPath = R.dynMesh(420);                            // ghost stroke ribbon
    this.R = R;
    this.built = true;
    this._s = {
      q: Q.new(), qr: Q.new(), m: M4.create(), m2: M4.create(),
      v1: V3.new(), v2: V3.new(), v3: V3.new(), v4: V3.new(),
      one: { x: 1, y: 1, z: 1 }, up: { x: 0, y: 1, z: 0 },
    };
  }

  /** World direction of the paddle handle (local -Y) for a given quat. */
  handleDir(out, quat) {
    const s = this._s;
    M4.compose(s.m, { x: 0, y: 0, z: 0 }, quat, s.one);
    return V3.norm(out, M4.transformDir(out, s.m, { x: 0, y: -1, z: 0 }));
  }

  /** Paddle orientation: local +Z along the normal, rolled into the hand.
   *  `extraRoll` is the bank into a lateral step, so a bat that is moving
   *  right is visibly turned right instead of sliding flat. */
  paddleQuat(out, normal, hand, swing, extraRoll) {
    Q.lookRotation(out, normal, this._s.up);
    const roll = (hand === 'left' ? 0.42 : -0.42) + (swing || 0) * 0.3 + (extraRoll || 0);
    Q.mul(out, out, Q.setAxisAngle(this._s.qr, 0, 0, 1, roll));
    return out;
  }

  /**
   * Draw the arm + hand that holds a paddle. The paddle itself is drawn by
   * the caller (it may be a ghost, a remote player, or the real thing).
   *   o = { pos, normal, hand, swing, windup, ghost, alpha, t }
   */
  drawArm(R, S, o) {
    this.build(R);
    const s = this._s;
    const wd = clamp(o.windup || 0, 0, 1);
    const n = V3.norm(s.v1, o.normal);
    const hdir = this.handleDir(s.v2, o.q || this.paddleQuat(s.q, n, o.hand, o.swing, o.roll));
    // fist grips the handle a hand's width below the blade
    const fist = V3.addScaled(V3.new(), o.pos, hdir, RIG.HANDLE);
    // the forearm runs back and down from the fist; on a windup the elbow
    // drops away from the table, which is the whole telegraph of a loop
    const fa = V3.norm(s.v3, V3.new(
      -n.x * 0.60 + hdir.x * 0.45,
      -0.46 - wd * 0.30,
      -n.z * 0.60 + hdir.z * 0.45));
    const elbow = V3.addScaled(V3.new(), fist, fa, RIG.FOREARM);
    const mid = V3.lerp(s.v4, fist, elbow, 0.5);

    const skin = o.ghost ? o.ghostCol : RIG.SKIN;
    const blue = o.hand === 'left';
    const sleeveCol = o.ghost ? o.ghostCol : (o.sleeve || (blue ? RIG.SLEEVE_ALT : RIG.SLEEVE));

    const base = o.ghost ? this.ghostMat(o, skin, 0.55) : { color: skin, rough: 0.62 };
    const cloth = o.ghost ? this.ghostMat(o, sleeveCol, 0.42) : { color: sleeveCol, rough: 0.85 };

    // forearm
    const qf = Q.lookRotation(s.q, fa, s.up);
    M4.compose(s.m, mid, qf, { x: 1, y: 1, z: RIG.FOREARM });
    R.draw(this.mFore, s.m, base);
    // elbow
    M4.compose(s.m, elbow, qf, s.one);
    R.draw(this.mJoint, s.m, base);
    // sleeve cuff over the elbow end
    const cuff = V3.addScaled(V3.new(), elbow, fa, RIG.FOREARM * 0.44);
    M4.compose(s.m, cuff, qf, { x: 1, y: 1, z: RIG.FOREARM * 0.55 });
    R.draw(this.mUpper, s.m, cloth);
    M4.compose(s.m, V3.addScaled(V3.new(), elbow, fa, RIG.FOREARM * 0.92), qf, { x: 1, y: 1, z: RIG.FOREARM * 0.5 });
    R.draw(this.mSleeve, s.m, cloth);
    // fist: squashed ball, thumb laid along the handle
    M4.compose(s.m, fist, qf, { x: 0.92, y: 0.74, z: 0.58 });
    R.draw(this.mPalm, s.m, base);
    const th = V3.addScaled(V3.new(), fist, hdir, -0.012);
    const qh = Q.lookRotation(s.q, hdir, n);
    M4.compose(s.m, V3.addScaled(th, th, n, 0.030), qh, { x: 1, y: 1, z: 0.062 });
    R.draw(this.mThumb, s.m, base);
    return { fist, elbow };
  }

  ghostMat(o, col, rough) {
    return {
      color: o.ghostCol || col, rough: rough || 0.4, unlit: true,
      blend: 'add', opacity: o.alpha !== undefined ? o.alpha : 0.42,
      emissive: [0.06, 0.10, 0.14], doubleSided: false,
    };
  }

  /** The whole thing: paddle + hand + arm. Used by the opponent and the ghost. */
  draw(R, S, o) {
    this.build(R);
    const s = this._s;
    const n = V3.norm(s.v1, o.normal);
    const q = o.q || this.paddleQuat(s.q, n, o.hand, o.swing, o.roll);
    const me = S.mesh, ma = S.mat;
    const mats = o.mats || {};                       // the equipped racket's palette
    const wood = o.ghost ? this.ghostMat(o, o.ghostCol, 0.5) : (mats.wood || ma.bladeWood);
    const red = o.ghost ? this.ghostMat(o, o.ghostCol, 0.5) : (mats.red || ma.rubberRed);
    const black = o.ghost ? this.ghostMat(o, o.ghostCol, 0.5) : (mats.black || ma.rubberBlack);
    const handle = o.ghost ? this.ghostMat(o, o.ghostCol, 0.5) : (mats.grip || ma.handle);

    M4.compose(s.m, o.pos, q, s.one);
    R.draw(me.blade, s.m, wood);
    M4.compose(s.m2, V3.addScaled(s.v2, o.pos, n, 0.0085), q, s.one);
    R.draw(me.rubber, s.m2, black);
    M4.compose(s.m2, V3.addScaled(s.v2, o.pos, n, -0.0085), q, s.one);
    R.draw(me.rubber, s.m2, red);
    const ho = V3.new();
    M4.transformDir(ho, s.m, { x: 0, y: -0.125, z: 0 });
    M4.compose(s.m2, V3.addScaled(s.v3, o.pos, ho, 1), q, s.one);
    R.draw(me.handle, s.m2, handle);

    this.drawArm(R, S, Object.assign({}, o, { q }));
    return q;
  }

  /* ------------------------------------------------------------------ *
   *  Ghost stroke ribbon — the path of the hand through the stroke,     *
   *  drawn as a camera-facing ribbon with a travelling highlight.       *
   * ------------------------------------------------------------------ */
  pathMesh(pts, camPos, width, headI) {
    const R = this.mPath, RR = this.R;
    const n = pts.length / 3;
    if (n < 3) { R.count = 0; return R; }
    let nv = 0, ni = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      const j = i < n - 1 ? i + 1 : i - 1, sgn = i < n - 1 ? 1 : -1;
      let dx = (pts[j * 3] - x) * sgn, dy = (pts[j * 3 + 1] - y) * sgn, dz = (pts[j * 3 + 2] - z) * sgn;
      let vx = camPos.x - x, vy = camPos.y - y, vz = camPos.z - z;
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const t = i / (n - 1);
      const w = width * (0.35 + 0.65 * t);
      sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      const up = (headI !== undefined) ? clamp(1 - Math.abs(i - headI) / 5, 0.18, 1) : 1;
      R.pos[nv * 3] = x - sx; R.pos[nv * 3 + 1] = y - sy; R.pos[nv * 3 + 2] = z - sz;
      R.nrm[nv * 3] = 0; R.nrm[nv * 3 + 1] = 1; R.nrm[nv * 3 + 2] = 0;
      R.uv[nv * 2] = t; R.uv[nv * 2 + 1] = 0; nv++;
      R.pos[nv * 3] = x + sx; R.pos[nv * 3 + 1] = y + sy; R.pos[nv * 3 + 2] = z + sz;
      R.nrm[nv * 3] = 0; R.nrm[nv * 3 + 1] = 1; R.nrm[nv * 3 + 2] = 0;
      R.uv[nv * 2] = t; R.uv[nv * 2 + 1] = up; nv++;
      if (i > 0) {
        const a = (i - 1) * 2;
        R.idx[ni++] = a; R.idx[ni++] = a + 1; R.idx[ni++] = a + 2;
        R.idx[ni++] = a + 1; R.idx[ni++] = a + 3; R.idx[ni++] = a + 2;
      }
    }
    RR.uploadDyn(R, nv, ni);
    return R;
  }
}
