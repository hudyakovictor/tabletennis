/* =====================================================================
 *  PADDLE RIG — every paddle in the world gets a hand and an arm.
 *
 *  WHY THIS EXISTS. A paddle floating in the air is a sprite, not an
 *  opponent: the eye has nothing to read, and the scene feels empty even
 *  though the physics underneath is real. One rig, built from the same
 *  primitives as the rest of the scene, fixes three things at once:
 *
 *   · the opponent finally looks like a person standing at the far end —
 *     you can see the wrist snap on a loop and the forearm drop on a chop,
 *     which is exactly the information a table-tennis player watches for;
 *   · the online opponent's hand (same rig, fed from the network);
 *   · the training ghost — the very same rig drawn translucent, tracing
 *     the stroke you were supposed to play.
 *
 *  NOTHING HERE IS ANIMATED BY HAND: the arm is solved from the paddle's
 *  own position and normal every frame, so it follows the physics for
 *  free. Limb axes are +Z so a single Q.lookRotation aims them.
 *
 *  BIOMECHANICAL EXTENSION (99-level):
 *   - forearm rotation (pronation/supination) from RacketBiomech
 *   - wrist extension/deviation
 *   - handle twist visualization
 *   - rubber flip visualization (different materials per active side)
 *   - edge zone visual adaptation
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
  // Forearm visual rotation scale — makes pronation/supination readable
  FOREARM_VIS_SCALE: 1.3,
  // Wrist visual deviation scale
  WRIST_VIS_SCALE: 1.2,
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

    // Temporary storage for computations
    this._s = {
      q: Q.new(), qr: Q.new(), q2: Q.new(), q3: Q.new(),
      m: M4.create(), m2: M4.create(), m3: M4.create(),
      v1: V3.new(), v2: V3.new(), v3: V3.new(), v4: V3.new(), v5: V3.new(),
      one: { x: 1, y: 1, z: 1 }, up: { x: 0, y: 1, z: 0 },
      forearmAxis: V3.new(0, 0, 1),
      wristDevAxis: V3.new(1, 0, 0),
    };
    // Matrix for forearm rotation
    this._forearmM4 = M4.create();
    this._wristM4 = M4.create();
    this._tmpM4 = M4.create();
  }

  /** World direction of the paddle handle (local -Y) for a given quat. */
  handleDir(out, quat) {
    const s = this._s;
    M4.compose(s.m, { x: 0, y: 0, z: 0 }, quat, s.one);
    return V3.norm(out, M4.transformDir(out, s.m, { x: 0, y: -1, z: 0 }));
  }

  /** Paddle orientation: local +Z along the normal, rolled into the hand. */
  paddleQuat(out, normal, hand, swing, extraRoll) {
    Q.lookRotation(out, normal, this._s.up);
    const roll = (hand === 'left' ? 0.42 : -0.42) + (swing || 0) * 0.3 + (extraRoll || 0);
    Q.mul(out, out, Q.setAxisAngle(this._s.qr, 0, 0, 1, roll));
    return out;
  }

  /**
   * Apply forearm rotation to a direction vector.
   * This simulates pronation/supination visually.
   */
  applyForearmRotation(out, dir, forearmPsi, axis) {
    const s = this._s;
    const scaledPsi = forearmPsi * RIG.FOREARM_VIS_SCALE;
    M4.setAxisAngle(this._forearmM4, axis || s.forearmAxis, scaledPsi);
    return V3.norm(out, M4.transformDir(out, this._forearmM4, dir));
  }

  /**
   * Apply wrist deviation to a direction vector.
   */
  applyWristDeviation(out, dir, wristDev, axis) {
    const s = this._s;
    M4.setAxisAngle(this._wristM4, axis || s.wristDevAxis, wristDev);
    return V3.norm(out, M4.transformDir(out, this._wristM4, dir));
  }

  /**
   * DRAW THE ARM + HAND THAT HOLDS A PADDLE.
   *
   * Enhanced with biomechanical parameters from RacketBiomech:
   *   o = {
   *     pos, normal, hand, swing, windup, roll,
   *     bioQ,           // biomechanical orientation quaternion
   *     bioActive,      // whether to use bio orientation
   *     forearmPsi,     // forearm pronation/supination angle [rad]
   *     wristExt,       // wrist extension/flexion [rad]
   *     wristDev,       // wrist radial/ulnar deviation [rad]
   *     phiFlip,        // flip angle [rad]
   *     activeSide,     // +1 = forehand/red, -1 = backhand/black
   *     mats,           // racket materials
   *     ghost, alpha, t, ...
   *   }
   */
  drawArm(R, S, o) {
    this.build(R);
    const s = this._s;
    const wd = clamp(o.windup || 0, 0, 1);
    const n = V3.norm(s.v1, o.normal);
    const q = o.q || this.paddleQuat(s.q, n, o.hand, o.swing, o.roll);

    // ---- BIOMECHANICAL ENHANCEMENTS ----

    // If bioQ is provided and bioActive, use it as the base orientation
    const useBio = o.bioQ && o.bioActive !== false;
    let finalQ = q;
    let effectiveForearmPsi = o.forearmPsi || 0;
    let effectiveWristDev = o.wristDev || 0;
    let effectiveWristExt = o.wristExt || 0;

    if (useBio) {
      // Use the biomechanical orientation
      finalQ = o.bioQ;

      // Extract effective biomechanical angles
      effectiveForearmPsi = o.forearmPsi || 0;
      effectiveWristDev = o.wristDev || 0;

      // Combine wrist extension into the visual (affects hand pose slightly)
      effectiveWristExt = o.wristExt || 0;

      // The flip angle can add a subtle visual rotation
      const phiFlip = o.phiFlip || 0;
      if (Math.abs(phiFlip) > 0.1) {
        // Subtle additional roll from flip — makes the flip visible
        const flipVisual = phiFlip * 0.12;
        const baseRoll = (o.hand === 'left' ? 0.42 : -0.42) + (o.swing || 0) * 0.3 + (o.roll || 0);
        const combinedRoll = baseRoll + flipVisual;
        Q.mul(finalQ, finalQ, Q.setAxisAngle(s.qr, 0, 0, 1, combinedRoll));
      }
    }

    // Compute handle direction with possible forearm rotation
    let hdir = this.handleDir(s.v2, finalQ);

    // Apply forearm rotation to handle direction (visual only)
    if (Math.abs(effectiveForearmPsi) > 0.01) {
      hdir = this.applyForearmRotation(s.v3, hdir, effectiveForearmPsi, s.forearmAxis);
    }

    // fist grips the handle a hand's width below the blade
    const fist = V3.addScaled(V3.new(), o.pos, hdir, RIG.HANDLE);

    // ---- FOREARM with pronation/supination ----
    // Base forearm direction: runs back and down from fist
    let fa = V3.norm(s.v4, V3.new(
      -n.x * 0.60 + hdir.x * 0.45,
      -0.46 - wd * 0.30,
      -n.z * 0.60 + hdir.z * 0.45
    ));

    // Apply forearm rotation to forearm direction (visual)
    if (Math.abs(effectiveForearmPsi) > 0.01) {
      fa = this.applyForearmRotation(s.v5, fa, effectiveForearmPsi, s.forearmAxis);
    }

    // Elbow position
    const elbow = V3.addScaled(V3.new(), fist, fa, RIG.FOREARM);
    const mid = V3.lerp(s.v2, fist, elbow, 0.5);

    // ---- WRIST VISUALIZATION ----
    // Wrist deviation bends the forearm slightly at the wrist
    // This affects the fist position slightly
    let fistOffset = V3.zero(V3.new());
    if (Math.abs(effectiveWristDev) > 0.01) {
      // Wrist deviation slightly shifts the fist
      const devDir = V3.norm(s.v3, V3.new(-n.x, 0, -n.z));
      fistOffset = V3.scale(V3.new(), devDir, effectiveWristDev * 0.02);
    }

    const fistFinal = V3.add(V3.new(), fist, fistOffset);

    // ---- SKIN AND CLOTH COLORS ----
    const skin = o.ghost ? o.ghostCol : RIG.SKIN;
    const blue = o.hand === 'left';
    const sleeveCol = o.ghost ? o.ghostCol : (o.sleeve || (blue ? RIG.SLEEVE_ALT : RIG.SLEEVE));

    const base = o.ghost ? this.ghostMat(o, skin, 0.55) : { color: skin, rough: 0.62 };
    const cloth = o.ghost ? this.ghostMat(o, sleeveCol, 0.42) : { color: sleeveCol, rough: 0.85 };

    // ---- DRAW FOREARM ----
    const qf = Q.lookRotation(s.q, fa, s.up);
    M4.compose(s.m, mid, qf, { x: 1, y: 1, z: RIG.FOREARM });
    R.draw(this.mFore, s.m, base);

    // ---- DRAW ELBOW JOINT ----
    M4.compose(s.m, elbow, qf, s.one);
    R.draw(this.mJoint, s.m, base);

    // ---- DRAW SLEEVE CUFF OVER ELBOW END ----
    const cuff = V3.addScaled(V3.new(), elbow, fa, RIG.FOREARM * 0.44);
    M4.compose(s.m, cuff, qf, { x: 1, y: 1, z: RIG.FOREARM * 0.55 });
    R.draw(this.mUpper, s.m, cloth);

    M4.compose(s.m, V3.addScaled(V3.new(), elbow, fa, RIG.FOREARM * 0.92), qf, { x: 1, y: 1, z: RIG.FOREARM * 0.5 });
    R.draw(this.mSleeve, s.m, cloth);

    // ---- DRAW FIST (PALM) ----
    // Fist orientation: slightly rotated by wrist extension
    let palmQ = qf;
    if (Math.abs(effectiveWristExt) > 0.01) {
      // Wrist extension tilts the fist
      const wristExtVisual = effectiveWristExt * RIG.WRIST_VIS_SCALE;
      const wristQ = Q.setAxisAngle(s.qr, 1, 0, 0, wristExtVisual);
      Q.mul(palmQ, palmQ, wristQ);
    }

    M4.compose(s.m, fistFinal, palmQ, { x: 0.92, y: 0.74, z: 0.58 });
    R.draw(this.mPalm, s.m, base);

    // ---- DRAW THUMB ----
    // Thumb lays along the handle
    const th = V3.addScaled(V3.new(), fistFinal, hdir, -0.012);
    const qh = Q.lookRotation(s.q, hdir, n);
    M4.compose(s.m, V3.addScaled(th, th, n, 0.030), qh, { x: 1, y: 1, z: 0.062 });
    R.draw(this.mThumb, s.m, base);

    return { fist: fistFinal, elbow, forearmPsi: effectiveForearmPsi };
  }

  /**
   * Enhanced ghost material with biomechanical info.
   */
  ghostMat(o, col, rough) {
    return {
      color: o.ghostCol || col, rough: rough || 0.4, unlit: true,
      blend: 'add', opacity: o.alpha !== undefined ? o.alpha : 0.42,
      emissive: [0.06, 0.10, 0.14], doubleSided: false,
    };
  }

  /**
   * DRAW THE WHOLE PADDLE — now with full biomechanical orientation.
   *
   * KEY ENHANCEMENTS:
   * 1. Uses bioQ for orientation when provided
   * 2. Determines active side geometrically (n · ballDir)
   * 3. Renders correct rubber color based on active side
   * 4. Forearm rotation visible in arm pose
   * 5. Wrist deviation visible in fist position
   * 6. Flip angle adds subtle visual rotation
   */
  draw(R, S, o) {
    this.build(R);
    const s = this._s;
    const n = V3.norm(s.v1, o.normal);
    const q = o.q || this.paddleQuat(s.q, n, o.hand, o.swing, o.roll);

    // ---- BIOMECHANICAL SETUP ----

    // Use bio quaternion if provided
    const bioQ = o.bioQ || null;
    const useBio = bioQ && o.bioActive !== false;
    const finalQ = useBio ? bioQ : q;

    // Determine active side for rubber color
    // Method 1: from bioMeta if available
    let activeSide = o.activeSide || 1;

    // Method 2: geometric calculation from normal and ball direction
    if (o.ballDir && !o.bioMeta) {
      const nWorld = V3.norm(V3.new(), n);
      const d = V3.dot(nWorld, o.ballDir);
      activeSide = d >= 0 ? 1 : -1;
    }

    // Store for drawArm
    const armOptions = Object.assign({}, o, {
      q: finalQ,
      forearmPsi: o.forearmPsi || 0,
      wristDev: o.wristDev || 0,
      wristExt: o.wristExt || 0,
      phiFlip: o.phiFlip || 0,
      activeSide,
    });

    const me = S.mesh, ma = S.mat;
    const mats = o.mats || {};

    // ---- MATERIAL SELECTION BASED ON ACTIVE SIDE ----
    // This is the KEY visual difference: correct rubber color per side

    let wood, red, black, handle;

    if (o.ghost) {
      const ghostCol = o.ghostCol || RIG.SKIN;
      wood = this.ghostMat(o, ghostCol, 0.5);
      red = this.ghostMat(o, ghostCol, 0.5);
      black = this.ghostMat(o, ghostCol, 0.5);
      handle = this.ghostMat(o, ghostCol, 0.5);
    } else {
      wood = mats.wood || ma.bladeWood;
      // Active side gets the correct rubber color
      if (activeSide >= 0) {
        // Forehand active: red rubber visible
        red = mats.red || ma.rubberRed;
        black = mats.black || ma.rubberBlack;
      } else {
        // Backhand active: black rubber visible
        red = mats.black || ma.rubberBlack;
        black = mats.red || ma.rubberRed;
      }
      handle = mats.grip || ma.handle;
    }

    // ---- DRAW PADDLE BLADE ----
    M4.compose(s.m, o.pos, finalQ, s.one);
    R.draw(me.blade, s.m, wood);

    // ---- DRAW RUBBER ON BOTH SIDES ----
    // Offset along normal for rubber thickness
    const rubberOffset = 0.0085;

    // Active side rubber (the one facing the ball)
    const activeOffset = V3.addScaled(V3.new(), o.pos, n, rubberOffset);
    M4.compose(s.m2, activeOffset, finalQ, s.one);
    R.draw(me.rubber, s.m2, activeSide >= 0 ? red : black);

    // Inactive side rubber (opposite side)
    const inactiveOffset = V3.addScaled(V3.new(), o.pos, V3.scale(V3.new(), n, -1), rubberOffset);
    M4.compose(s.m2, inactiveOffset, finalQ, s.one);
    R.draw(me.rubber, s.m2, activeSide >= 0 ? black : red);

    // ---- DRAW HANDLE ----
    const ho = V3.new();
    M4.transformDir(ho, s.m, { x: 0, y: -0.125, z: 0 });
    M4.compose(s.m2, V3.addScaled(s.v3, o.pos, ho, 1), finalQ, s.one);
    R.draw(me.handle, s.m2, handle);

    // ---- DRAW ARM WITH BIOMECHANICAL PARAMS ----
    // Pass the computed activeSide and bio params to drawArm
    this.drawArm(R, S, armOptions);

    return finalQ;
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

  /**
   * Draw a "biomechanical hint" — a subtle line showing forearm rotation axis.
   * Used for training/development mode only.
   */
  drawBiomechHint(R, S, pos, normal, forearmPsi, wristDev, alpha) {
    const s = this._s;
    this.build(R);

    const hintAlpha = alpha !== undefined ? alpha : 0.3;

    // Forearm axis indicator (line along forearm rotation axis)
    const axisLen = 0.15;
    const axisDir = V3.norm(s.v1, normal);
    const start = V3.addScaled(V3.new(), pos, axisDir, -0.1);
    const end = V3.addScaled(V3.new(), pos, axisDir, axisLen);

    // Simple line using a thin box
    const mid = V3.lerp(s.v2, start, end, 0.5);
    const dir = V3.norm(s.v3, V3.sub(V3.new(), end, start));
    const q = Q.lookRotation(s.q, dir, s.up);
    const length = V3.len(V3.sub(V3.new(), end, start));

    M4.compose(s.m, mid, q, { x: 0.003, y: 0.003, z: length });
    R.draw(this.mJoint, s.m, {
      color: [1, 0.5, 0.2], rough: 0.5, emissive: [0.5, 0.2, 0],
      blend: true, opacity: hintAlpha, doubleSided: true, unlit: true,
    });

    // Wrist deviation indicator (perpendicular to forearm)
    if (Math.abs(wristDev) > 0.01) {
      const wStart = V3.addScaled(V3.new(), pos, axisDir, 0.05);
      const wDir = V3.norm(s.v4, V3.new(1, 0, 0));
      const wEnd = V3.addScaled(V3.new(), wStart, wDir, wristDev * 0.2);
      const wMid = V3.lerp(s.v5, wStart, wEnd, 0.5);
      const wLen = V3.len(V3.sub(V3.new(), wEnd, wStart));
      const wQ = Q.lookRotation(s.q, wDir, axisDir);
      M4.compose(s.m2, wMid, wQ, { x: 0.003, y: 0.003, z: wLen });
      R.draw(this.mJoint, s.m2, {
        color: [0.2, 0.5, 1], rough: 0.5, emissive: [0, 0.2, 0.5],
        blend: true, opacity: hintAlpha * 0.7, doubleSided: true, unlit: true,
      });
    }

    return s.m;
  }
}
