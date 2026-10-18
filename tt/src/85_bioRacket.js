/* =====================================================================
 *  BIOLOGICAL RACKET — 3D biomechanical model for table tennis racket
 *
 *  implements the kinematic chain:
 *    Q_world = Q_shoulder · Q_elbow · Q_forearm · Q_wristBase · Q_racketLocal
 *
 *  where:
 *    - Q_forearm stores pronation/supination (ψ_forearm)
 *    - Q_racketLocal stores forward tilt, side tilt, handle twist, flip
 *    - φ_flip(x) = π · S(x;k,x₀)  — sigmoid flip through center
 *    - x = clamp((p_hit,x - x_sternum)/W, -1, 1)  — normalized lateral position
 *    - b = 3u² - 2u³, u = (x+1)/2  — smooth transition
 *    - n = Q_world · n₀  — normal determines active side geometrically
 *
 *  DEG = π/180
 * ===================================================================== */
'use strict';

/* ---- constants (tuned for mobile gameplay feel) ---- */
const BIO = {
  // Zone width: how wide the working zone is (meters from center)
  ZONE_HALF_WIDTH: BIO_ZONE_HALF_WIDTH,

  // Forearm rotation range [rad]
  FOREARM_SUP: 0.42,   // supination in backhand (more than real for visibility)
  FOREARM_PRO: -0.52,  // pronation in forehand

  // Forward tilt range [deg] — how much blade closes downward
  THETA_BH: 10,        // backhand: slightly open
  THETA_FH: 24,        // forehand: more closed for topspin
  THETA_EDGE_F: 10,    // extra closure at extreme edges
  GAMMA: 1.6,          // edge growth exponent

  // Side tilt range [deg] — blade banks sideways at edges
  THETA_SIDE_MAX: 22,  // max side tilt at extreme edges
  BETA: 1.5,           // side tilt growth exponent

  // Handle twist [deg] — how grip rotates in palm
  THETA_H0: 6,         // base handle orientation
  THETA_H1: 14,        // backhand vs forehand difference
  THETA_H2: 10,        // edge adaptation
  DELTA: 1.4,          // handle edge exponent

  // Flip sigmoid parameters — sigmoid through center for rubber flip
  FLIP_K: 14,          // steepness of sigmoid (sharp flip at center)
  FLIP_X0: -0.06,      // center of flip (slightly left of center for right-hander)

  // Wrist extension/flexion [rad]
  WRIST_EXT_BH: 0.28,  // backhand: wrist extension
  WRIST_EXT_FH: -0.12, // forehand: slight flexion

  // Wrist radial/ulnar deviation at edges [deg]
  WRIST_DEV_MAX: 14,
  ETA: 1.3,

  // Forearm pronation sigmoid for arm rig
  FOREARM_K: 11,
  FOREARM_X0: -0.04,

  // Visual exaggeration for mobile (makes biomechanics readable)
  VIS_FORARM_SCALE: 1.25,
  VIS_WRIST_SCALE: 1.15,
  VIS_FLIP_EXAGGERATION: 0.15,  // extra flip visible for clarity
};

/* ---- math helpers ---- */
const _sigmoidBuf = { value: 0 };
function sigmoid(x, k, x0) {
  // Protect against extreme values
  const arg = -k * (x - x0);
  if (arg > 50) return 1;
  if (arg < -50) return 0;
  _sigmoidBuf.value = 1 / (1 + Math.exp(arg));
  return _sigmoidBuf.value;
}

function smoothBlend(x) {
  const u = (x + 1) / 2;  // map [-1,1] -> [0,1]
  return 3 * u * u - 2 * u * u * u;  // smoothstep
}

function computeX(hitPosX, sternumX, zoneHalfWidth) {
  const W = zoneHalfWidth || BIO.ZONE_HALF_WIDTH;
  return clamp((hitPosX - sternumX) / W, -1, 1);
}

/* ---- RacketBiomech: computes full 3D orientation ---- */
class RacketBiomech {
  constructor() {
    // Pre-allocated temporaries for performance
    this._qTmp = Q.new();
    this._qForearm = Q.new();
    this._qFlip = Q.new();
    this._qForward = Q.new();
    this._qSide = Q.new();
    this._qHandle = Q.new();
    this._qLocal = Q.new();
    this._qWorld = Q.new();
    this._qArm = Q.new();
    this._qArmTotal = Q.new();
    this._m4Tmp = M4.create();
    this._one = { x: 1, y: 1, z: 1 };
    this._nLocal = V3.new(0, 0, 1);  // normal of red (forehand) face in local space
    this._nWorld = V3.new();
    this._handleDir = V3.new();
    this._negHandleDir = V3.new();
    this._fwdDir = V3.new(0, 0, -1);  // default facing direction
  }

  /**
   * Compute the full biomechanical orientation of the racket.
   *
   * @param {object} ctx
   *   - x: normalized lateral position [-1,1] (-1=bh edge, 0=center, 1=fh edge)
   *   - armQ: combined shoulder+elbow+wristBase quaternion (orientation of arm)
   *   - hand: 'left' or 'right' (affects base roll and flip direction)
   *   - isServe: whether this is a serve (affects pose)
   *   - strokeType: 'LOOP', 'DRIVE', 'SMASH', 'CHOP', etc.
   *   - swingSpeed: normalized speed 0..1 (affects forward tilt)
   *   - ballDir: direction TO ball (for normal determination) — normalized
   *   - contactQuality: 0..1 (affects blade openness)
   *   - targetX: optional target x for assisted shots
   * @returns {object} biomechanics result
   */
  compute(ctx) {
    const handSign = ctx.hand === 'left' ? -1 : 1;
    const x = clamp(ctx.x || 0, -1, 1);
    const b = smoothBlend(x);  // 0 = pure BH, 1 = pure FH
    const absX = Math.abs(x);
    const signX = Math.sign(x) || 1;

    // ---- 1. FOREARM PRONATION/SUPINATION ----
    // ψ_forearm(x) = ψ_sup + (ψ_pro - ψ_sup) · S(x;k_f, x_f)
    // Backhand = more supination (palm up-ish), Forehand = pronation (palm down-ish)
    const S_forearm = sigmoid(x, BIO.FOREARM_K, BIO.FOREARM_X0);
    let psiForearm = BIO.FOREARM_SUP + (BIO.FOREARM_PRO - BIO.FOREARM_SUP) * S_forearm;

    // Visual exaggeration for mobile readability
    psiForearm *= BIO.VIS_FORARM_SCALE;

    // Build forearm quaternion: rotation around longitudinal axis (Z in forearm local)
    // The forearm local Z is roughly along the forearm from elbow to wrist
    // For visual purposes, we apply this as an additional rotation on the arm
    Q.setAxisAngle(this._qForearm, 0, 0, 1, psiForearm);

    // ---- 2. RACKET LOCAL ORIENTATION COMPONENTS ----

    // 2a. φ_flip — sigmoid roll around handle axis for rubber flip
    // Flips π radians (180°) through center with sigmoid steepness
    const phiFlipBase = Math.PI * sigmoid(x, BIO.FLIP_K, BIO.FLIP_X0);
    // Exaggerate slightly for visibility
    const phiFlip = phiFlipBase + BIO.VIS_FLIP_EXAGGERATION * sigmoid(x, BIO.FLIP_K, BIO.FLIP_X0);
    // For left-handed, flip direction reverses
    const finalPhiFlip = phiFlip * handSign;

    // 2b. θ_forward — forward tilt (blade closes downward toward table)
    // More closed for topspin strokes, more open for backspin
    const stroke = ctx.strokeType || 'DRIVE';
    let baseThetaForward;
    switch (stroke) {
      case 'LOOP':
      case 'COUNTER':
        baseThetaForward = BIO.THETA_FH + 8 * (ctx.swingSpeed || 0.5);  // heavy topspin = more closed
        break;
      case 'DRIVE':
        baseThetaForward = BIO.THETA_FH * 0.7 + BIO.THETA_BH * 0.3;
        break;
      case 'SMASH':
        baseThetaForward = 5 - 5 * (ctx.swingSpeed || 0.5);  // flatter for smash
        break;
      case 'CHOP':
      case 'PUSH':
        baseThetaForward = -8 - 5 * (ctx.swingSpeed || 0.5);  // open for backspin
        break;
      case 'FLICK':
        baseThetaForward = BIO.THETA_FH * 0.8;
        break;
      case 'BLOCK':
        baseThetaForward = 8;
        break;
      case 'LOB':
        baseThetaForward = BIO.THETA_FH * 0.6;
        break;
      default:
        baseThetaForward = BIO.THETA_FH * 0.5 + BIO.THETA_BH * 0.5;
    }

    // Blend between bh/fh based on position
    const thetaForwardBase = BIO.THETA_BH * (1 - b) + baseThetaForward * b;

    // Edge bonus: more closure at extreme positions
    const thetaEdgeBonus = BIO.THETA_EDGE_F * Math.pow(absX, BIO.GAMMA);

    // Contact quality reduces effective closure (off-center hits open up)
    const qualityFactor = ctx.contactQuality !== undefined ? ctx.contactQuality : 1;
    const thetaForward = (thetaForwardBase + thetaEdgeBonus) * (0.85 + 0.15 * qualityFactor);
    const thetaForwardRad = thetaForward * DEG;

    // 2c. θ_side — side tilt (blade banks sideways at edges)
    // In BH zone: blade banks one way, in FH zone: banks opposite
    const thetaSideBase = BIO.THETA_SIDE_MAX * signX * Math.pow(absX, BIO.BETA);

    // Stroke-specific side tilt (HOOK/FADE have extra)
    let thetaSideExtra = 0;
    if (stroke === 'HOOK' || stroke === 'FADE' || stroke === 'SERVE_SIDE') {
      thetaSideExtra = BIO.THETA_SIDE_MAX * 0.5 * signX * Math.sign(ctx.swingDirX || 1);
    }

    const thetaSide = thetaSideBase + thetaSideExtra;
    const thetaSideRad = thetaSide * DEG;

    // 2d. θ_handle — handle twist in palm
    const thetaHandleBase = BIO.THETA_H0 + BIO.THETA_H1 * (2 * b - 1);
    const thetaHandleEdge = BIO.THETA_H2 * signX * Math.pow(absX, BIO.DELTA);
    const thetaHandle = thetaHandleBase + thetaHandleEdge;
    const thetaHandleRad = thetaHandle * DEG;

    // ---- 3. BUILD LOCAL ORIENTATION ----
    // Order: handle twist (innermost) → side tilt → forward tilt → flip (outermost)
    // This matches: R_z(φ_flip) · R_x(θ_forward) · R_y(θ_side) · R_z(θ_handle)

    const qLocal = this._qLocal;
    Q.identity(qLocal);

    // Step 1: handle twist (around local Z — handle axis)
    Q.setAxisAngle(this._qHandle, 0, 0, 1, thetaHandleRad);
    Q.mul(qLocal, qLocal, this._qHandle);

    // Step 2: side tilt (around local Y — blade banks sideways)
    Q.setAxisAngle(this._qSide, 0, 1, 0, thetaSideRad);
    Q.mul(qLocal, qLocal, this._qSide);

    // Step 3: forward tilt (around local X — blade closes downward)
    Q.setAxisAngle(this._qForward, 1, 0, 0, thetaForwardRad);
    Q.mul(qLocal, qLocal, this._qForward);

    // Step 4: flip (around local Z — rubber flips)
    Q.setAxisAngle(this._qFlip, 0, 0, 1, finalPhiFlip);
    Q.mul(qLocal, qLocal, this._qFlip);

    // ---- 4. COMBINE INTO WORLD ORIENTATION ----
    // Q_world = Q_arm · Q_forearm · Q_racketLocal
    const qArm = ctx.armQ || Q.identity(this._qArm);
    const qWorld = this._qWorld;

    // First apply forearm rotation to arm
    // Q_arm_with_forearm = Q_arm · Q_forearm
    Q.mul(this._qArmTotal, qArm, this._qForearm);

    // Then apply racket local orientation
    // Q_world = Q_arm_with_forearm · Q_racketLocal
    Q.mul(qWorld, this._qArmTotal, qLocal);

    // ---- 5. COMPUTE WORLD-SPACE NORMAL (for active side determination) ----
    // n = Q_world · n₀ where n₀ = (0,0,1) — red/forehand face normal in local space
    M4.compose(this._m4Tmp, V3.new(), qWorld, this._one);
    M4.transformDir(this._nWorld, this._m4Tmp, this._nLocal);
    V3.norm(this._nWorld, this._nWorld);

    // ---- 6. DETERMINE ACTIVE SIDE GEOMETRICALLY ----
    // d = n · v̂_toBall > 0 → red (forehand) face is active
    // d < 0 → black (backhand) face is active
    const ballDir = ctx.ballDir || this._fwdDir;
    const d = V3.dot(this._nWorld, ballDir);
    const activeSide = d >= 0 ? 1 : -1;  // +1 = forehand/red, -1 = backhand/black

    // ---- 7. COMPUTE HANDLE DIRECTION (for grip visualization) ----
    // Handle extends in local -Y direction
    M4.transformDir(this._handleDir, this._m4Tmp, { x: 0, y: -1, z: 0 });
    V3.norm(this._handleDir, this._handleDir);
    V3.mul(this._negHandleDir, this._handleDir, -1);

    // ---- 8. WRIST PARAMETERS ----
    const omegaWristExt = BIO.WRIST_EXT_BH * (1 - b) + BIO.WRIST_EXT_FH * b;
    const omegaWristDev = BIO.WRIST_DEV_MAX * signX * Math.pow(absX, BIO.ETA) * DEG;

    // ---- 9. METADATA FOR UI/FEEDBACK ----
    const isFlipping = Math.abs(finalPhiFlip) > 0.3 && Math.abs(x) < 0.3;
    const isAtEdge = absX > 0.75;
    const zoneLabel = x < -0.6 ? 'BH_EDGE' : x < -0.2 ? 'BACKHAND' : x < 0.2 ? 'CENTER' : x < 0.6 ? 'FORHAND' : 'FH_EDGE';
    const strokeQuality = ctx.contactQuality !== undefined ? ctx.contactQuality : 1;

    return {
      // Core orientation
      Q_world: qWorld,
      n_world: this._nWorld,
      handleDir: this._handleDir,
      negHandleDir: this._negHandleDir,

      // Active side (geometric, not boolean)
      activeSide,  // +1 = forehand/red, -1 = backhand/black
      d,           // dot product value (for debugging)

      // Biomechanical parameters
      forearmPsi: psiForearm,
      wristExt: omegaWristExt,
      wristDev: omegaWristDev,

      // Blade angles
      thetaForward,
      thetaSide,
      thetaHandle,
      phiFlip: finalPhiFlip,

      // Position parameters
      x,
      b,
      absX,
      signX,

      // Visual state
      isFlipping,
      isAtEdge,
      zoneLabel,

      // Quality
      strokeQuality,
      strokeType: stroke,

      // Derived: which material to show
      activeMaterial: activeSide >= 0 ? 'red' : 'black',
      inactiveMaterial: activeSide >= 0 ? 'black' : 'red',
    };
  }

  /**
   * Get material info for the active side.
   */
  getMaterialForSide(eq, activeSide) {
    if (!eq) return { side: 'fore', color: [1, 0.1, 0.1], backColor: [0.15, 0.15, 0.17] };
    const side = activeSide >= 0 ? 'fore' : 'back';
    const col = eq.colours[side];
    const backCol = eq.colours[side + 'Back'];
    return {
      side,
      activeColor: col || [1, 0.1, 0.1],
      inactiveColor: backCol || [0.15, 0.15, 0.17],
      isForehand: side === 'fore',
      bladeWood: eq.colours.wood,
      grip: eq.colours.grip,
    };
  }

  /**
   * Static preset for different stroke types — used for training ghosts, etc.
   */
  static strokePreset(strokeId, x, swingSpeed) {
    const b = smoothBlend(x);
    const absX = Math.abs(x);
    const signX = Math.sign(x) || 1;

    const presets = {
      LOOP: {
        thetaForward: 20 + 12 * swingSpeed + 8 * Math.pow(absX, BIO.GAMMA),
        thetaSide: 6 * signX * Math.pow(absX, BIO.BETA),
        thetaHandle: 8 + 8 * (2 * b - 1) + 6 * signX * Math.pow(absX, BIO.DELTA),
        forearmPsi: BIO.FOREARM_SUP + (BIO.FOREARM_PRO - BIO.FOREARM_SUP) * sigmoid(x, BIO.FOREARM_K, BIO.FOREARM_X0),
      },
      DRIVE: {
        thetaForward: 15 + 6 * swingSpeed + 5 * Math.pow(absX, BIO.GAMMA),
        thetaSide: 4 * signX * Math.pow(absX, BIO.BETA),
        thetaHandle: 6 + 6 * (2 * b - 1) + 4 * signX * Math.pow(absX, BIO.DELTA),
        forearmPsi: BIO.FOREARM_SUP * 0.7 + BIO.FOREARM_PRO * 0.3,
      },
      SMASH: {
        thetaForward: 5 - 3 * swingSpeed,
        thetaSide: 3 * signX,
        thetaHandle: 4 + 2 * (2 * b - 1),
        forearmPsi: BIO.FOREARM_PRO * 0.6,
      },
      CHOP: {
        thetaForward: -10 - 5 * swingSpeed,
        thetaSide: 10 * signX * Math.pow(absX, BIO.BETA),
        thetaHandle: 12 + 4 * signX * Math.pow(absX, BIO.DELTA),
        forearmPsi: BIO.FOREARM_SUP * 0.9,
      },
      FLICK: {
        thetaForward: 18 + 4 * swingSpeed,
        thetaSide: 10 * signX * Math.pow(absX, BIO.BETA),
        thetaHandle: 10 + 4 * (2 * b - 1),
        forearmPsi: BIO.FOREARM_SUP * 0.5 + BIO.FOREARM_PRO * 0.5,
      },
      PUSH: {
        thetaForward: -5 - 3 * swingSpeed,
        thetaSide: 8 * signX * Math.pow(absX, BIO.BETA),
        thetaHandle: 8 + 3 * (2 * b - 1),
        forearmPsi: BIO.FOREARM_SUP,
      },
      BLOCK: {
        thetaForward: 8,
        thetaSide: 3 * signX * Math.pow(absX, BIO.BETA),
        thetaHandle: 5 + 2 * (2 * b - 1),
        forearmPsi: BIO.FOREARM_SUP * 0.6 + BIO.FOREARM_PRO * 0.4,
      },
      SERVE_TOP: {
        thetaForward: 16,
        thetaSide: 2 * signX,
        thetaHandle: 5,
        forearmPsi: BIO.FOREARM_SUP * 0.5 + BIO.FOREARM_PRO * 0.5,
      },
      SERVE_BACK: {
        thetaForward: -8,
        thetaSide: 6 * signX,
        thetaHandle: 10,
        forearmPsi: BIO.FOREARM_SUP * 0.8,
      },
    };
    return presets[strokeId] || presets.DRIVE;
  }
}

/* ---- helper: integrate bio orientation into existing paddle state ---- */
function integrateBioRacket(bioResult, paddleState, ctx) {
  // Update paddle normal from bio computation (this is what physics uses)
  V3.copy(paddleState.normal, bioResult.n_world);
  V3.norm(paddleState.normal, paddleState.normal);

  // Update paddle quaternion for rendering
  Q.lookRotation(paddleState.q, paddleState.normal, { x: 0, y: 1, z: 0 });

  // Store full bio quaternion for rendering
  paddleState.bioQ = bioResult.Q_world;

  // Store metadata for UI and animation
  if (!paddleState.bioMeta) paddleState.bioMeta = {};
  Object.assign(paddleState.bioMeta, {
    x: bioResult.x,
    b: bioResult.b,
    activeSide: bioResult.activeSide,
    forearmPsi: bioResult.forearmPsi,
    wristExt: bioResult.wristExt,
    wristDev: bioResult.wristDev,
    thetaForward: bioResult.thetaForward,
    thetaSide: bioResult.thetaSide,
    thetaHandle: bioResult.thetaHandle,
    phiFlip: bioResult.phiFlip,
    isFlipping: bioResult.isFlipping,
    isAtEdge: bioResult.isAtEdge,
    zoneLabel: bioResult.zoneLabel,
    strokeQuality: bioResult.strokeQuality,
    strokeType: bioResult.strokeType,
    d: bioResult.d,
  });

  // Store forearm rotation for arm rig
  paddleState.forearmPsi = bioResult.forearmPsi;
  paddleState.wristExt = bioResult.wristExt;
  paddleState.wristDev = bioResult.wristDev;
  paddleState.phiFlip = bioResult.phiFlip;

  return paddleState;
}

/* ---- helper: compute bio orientation for player paddle ---- */
function computePlayerBioRacket(game, ctx) {
  if (!game.bioRacket) return null;

  // Determine x from current ball position relative to player
  const ball = game.ball;
  const player = game.player;

  // Use ball x-position relative to player's sternum (which is at x=0)
  // If ball not live, use player's current lateral velocity to estimate
  let hitX;
  if (ball.live && ball.p) {
    hitX = ball.p.x;
  } else {
    // Estimate from player movement
    hitX = player.pos.x + player.vel.x * 0.1;
  }

  // Determine ball direction for normal check
  let ballDir;
  if (ball.live && ball.v) {
    ballDir = V3.norm(V3.new(), ball.v);
    // If ball moving away from player, flip direction
    if (ballDir.z < 0) V3.mul(ballDir, ballDir, -1);
  } else {
    ballDir = V3.new(0, 0, 1);
  }

  // Estimate stroke type from swipe
  let strokeType = 'DRIVE';
  let swingSpeed = 0.5;
  if (game.liveStroke) {
    strokeType = game.liveStroke.stroke.id;
    swingSpeed = game.liveStroke.power || 0.5;
  } else if (game.swipe && game.swipe.m) {
    const m = game.swipe.m;
    swingSpeed = clamp(m.speed / 4, 0, 1);
    strokeType = game.swipe.lastReleased ?
      classifyStrokeFromMetrics(m) : 'DRIVE';
  }

  // Contact quality estimate
  let contactQuality = 1;
  if (game.lastSweet !== undefined) {
    contactQuality = game.lastSweet;
  }

  const bioCtx = {
    x: computeX(hitX, 0, BIO.ZONE_HALF_WIDTH),
    armQ: game.player.armQ || Q.identity(Q.new()),
    hand: game.settings.hand || 'right',
    isServe: game.isServeBall,
    strokeType,
    swingSpeed,
    ballDir,
    contactQuality,
    swingDirX: game.player.vel.x || 0,
  };

  return game.bioRacket.compute(bioCtx);
}

/* ---- simple stroke classification for bio context ---- */
function classifyStrokeFromMetrics(m) {
  if (!m) return 'DRIVE';
  const u = m.up;
  const r = m.right;
  if (u < -0.3) return 'CHOP';
  if (u > 0.6) return 'LOOP';
  if (Math.abs(r) > 0.5 && Math.abs(m.curl) > 0.3) return r > 0 ? 'HOOK' : 'FADE';
  return 'DRIVE';
}
