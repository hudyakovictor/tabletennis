/* =====================================================================
 *  HIT FEEDBACK SYSTEM — multi-layered impact response
 *
 *  Layers:
 *   1. Visual: particles, flash, screen effects
 *   2. Audio: layered sounds based on quality/spin/speed
 *   3. Haptic: variable vibration patterns
 *   4. Camera: micro-reaction on impact
 *
 *  This system transforms a physical impact into a multi-sensory
 *  experience — the key to "game feel" at 99 level.
 * ===================================================================== */
'use strict';

const HIT_FEEDBACK = {
  // Particle system tuning
  PARTICLES: {
    baseCount: 8,
    qualityMultiplier: 22,
    speedMultiplier: 0.6,
    maxCount: 60,
    minSize: 0.008,
    maxSize: 0.035,
  },

  // Camera shake tuning
  CAMERA: {
    shakeBase: 0.0015,
    shakeSpeedMultiplier: 0.0008,
    shakeQualityMultiplier: 0.04,
    maxShake: 0.08,
  },

  // Haptic patterns
  HAPTIC: {
    HIT: [8, 25, 8],
    WINNER: [15, 40, 15, 40],
    BLOCK: [4, 12],
    NET_CORD: [12, 22, 12],
    EDGE_BALL: [8, 35, 8],
    POINT_LOST: [25, 80, 30],
    POINT_WON: [12, 28, 12, 28],
    SERVE: [6, 18, 6],
  },

  // Audio layering
  AUDIO: {
    woodHitBase: 0.4,
    rubberFrictionBase: 0.3,
    whooshBase: 0.2,
    spinVolumeMultiplier: 0.3,
  },
};

/**
 * Main hit feedback executor.
 * Called from Game.applyHit — transforms impact into experience.
 */
class HitFeedbackSystem {
  constructor(game) {
    this.game = game;
    this._particles = game.particles;
    this._audio = game.audio;
    this._camera = game;
    this._hapticEnabled = true;
    this._lastHitTime = 0;
    this._cooldown = 0.05;  // prevent feedback spamming
  }

  /**
   * Execute complete feedback for an impact.
   * @param {object} ctx
   *   - quality: 0..1 contact quality
   *   - speed: m/s ball speed
   *   - spin: rad/s ball spin vector
   *   - spinType: 'topspin', 'backspin', 'sidespin', 'none'
   *   - stroke: stroke archetype
   *   - isWinner: whether this hit won the point
   *   - isNetCord: whether hit the net
   *   - isEdge: whether edge ball
   *   - contactPoint: {x,y,z} where contact occurred
   *   - side: +1 player, -1 AI
   */
  execute(ctx) {
    const now = this.game.time;
    if (now - this._lastHitTime < this._cooldown) return;
    this._lastHitTime = now;

    // Determine spin characteristics
    const spin = ctx.spin || V3.new();
    const spinMag = V3.len(spin);
    const spinType = this.determineSpinType(spin, ctx.side);

    // Quality-based scaling
    const quality = clamp(ctx.quality || 1, 0, 1);
    const speed = ctx.speed || 0;

    // ---- VISUAL FEEDBACK ----
    this.visual(quality, speed, spinType, spinMag, ctx);

    // ---- AUDIO FEEDBACK ----
    this.audio(quality, speed, spinType, spinMag, ctx);

    // ---- HAPTIC FEEDBACK ----
    this.haptic(quality, speed, spinType, ctx);

    // ---- CAMERA FEEDBACK ----
    this.camera(quality, speed, ctx);
  }

  /**
   * Determine spin type from spin vector.
   * Convention in 30_physics.js: for player (+1, shooting -z), w.x < 0 is topspin;
   * for opponent (-1, shooting +z), w.x > 0 is topspin -> topSigned = -side * w.x.
   */
  determineSpinType(spin, side = 1) {
    const w = spin;
    const topSigned = -(side || 1) * w.x;
    const top = Math.abs(topSigned);
    const lat = Math.abs(w.y);
    const slice = Math.abs(w.z);

    if (top > lat * 1.5 && top > slice * 1.5) {
      return topSigned > 0 ? 'topspin' : 'backspin';
    }
    if (lat > top * 1.2 && lat > slice * 1.2) {
      return w.y > 0 ? 'sidespin-right' : 'sidespin-left';
    }
    return 'mixed';
  }

  /**
   * Visual feedback: particles, glow, effects.
   */
  visual(quality, speed, spinType, spinMag, ctx) {
    const game = this.game;

    /* Без «салюта» в точке контакта: фейерверк частиц при каждом ударе
     * мигал ровно там, куда игрок смотрит в момент решения. Приговор вводу
     * остаётся в следе мяча (зелёный/жёлтый/красный) и в ХАДе — этого
     * достаточно, чтобы читать качество, не теряя мяч.
     * Экранная вспышка остаётся — она на край кадра, не на точку удара. */
    if (quality > 0.5 && speed > 5) {
      const flashIntensity = Math.min(1, (quality - 0.5) * 0.8 + speed * 0.012);
      game.hitFlash = Math.min(1, game.hitFlash + flashIntensity * 0.15);
    }
  }

  /**
   * Audio feedback: layered sounds.
   */
  audio(quality, speed, spinType, spinMag, ctx) {
    const audio = this._audio;
    if (!audio || !audio.initialized) return;

    // ---- Layer 1: Wood impact (body sound) ----
    // Quality determines wood vs rubber ratio
    const woodVolume = HIT_FEEDBACK.AUDIO.woodHitBase * (1 - quality * 0.4);
    // Higher quality = more wood, less rubber
    const woodPitch = 0.9 + quality * 0.2 + speed * 0.005;

    if (!ctx.skipBaseHitAudio && audio.hitRacket) {
      audio.hitRacket(speed, 0, quality < 0.4);
    }

    // ---- Layer 2: Rubber friction (spin sound) ----
    if (spinMag > 30) {
      if (audio.whoosh) {
        audio.whoosh(clamp(spinMag / 80, 0, 1));
      }
    }

    // ---- Layer 3: Air whoosh (speed sound) ----
    if (speed > 8 && spinMag <= 30) {
      if (audio.whoosh) {
        audio.whoosh(clamp((speed - 8) / 25, 0, 0.6));
      }
    }

    // ---- Layer 4: Special event sounds ----
    if (ctx.isNetCord && audio.hitNet) {
      audio.hitNet();
    }
    if (ctx.isEdge && audio.hitEdge) {
      audio.hitEdge();
    }
    if (ctx.isWinner && ctx.side > 0 && audio.point) {
      audio.point(true);
    }
  }

  /**
   * Haptic feedback: variable vibration patterns.
   */
  haptic(quality, speed, spinType, ctx) {
    if (!this._hapticEnabled) return;
    if (this.game && this.game.settings && this.game.settings.haptics === false) return;
    if (ctx.skipBaseHaptic && !ctx.isNetCord && !ctx.isEdge && !ctx.isWinner) return;

    // Quality-based pattern selection
    let pattern;

    if (ctx.isNetCord) {
      pattern = HIT_FEEDBACK.HAPTIC.NET_CORD;
    } else if (ctx.isEdge) {
      pattern = HIT_FEEDBACK.HAPTIC.EDGE_BALL;
    } else if (ctx.isWinner && ctx.side > 0) {
      pattern = HIT_FEEDBACK.HAPTIC.WINNER;
    } else if (quality > 0.8 && speed > 15) {
      pattern = HIT_FEEDBACK.HAPTIC.HIT.map(v => Math.floor(v * 1.3));
    } else if (quality > 0.5) {
      pattern = HIT_FEEDBACK.HAPTIC.HIT;
    } else if (speed < 3 && quality < 0.4) {
      pattern = HIT_FEEDBACK.HAPTIC.BLOCK;
    } else {
      pattern = [6, 20, 6];
    }

    if (pattern.length === 1) {
      pattern[0] = Math.floor(pattern[0] * (0.5 + speed * 0.05));
    }

    if (this.game && typeof this.game.buzz === 'function') {
      this.game.buzz(pattern);
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try { navigator.vibrate(pattern); } catch (e) {}
    }
  }

  /**
   * Camera feedback: multi-layer reaction.
   */
  camera(quality, speed, ctx) {
    const game = this.game;
    if (!game || game.reducedMotion) return;

    // Layer 1: Micro shake on impact
    const shakeBase = HIT_FEEDBACK.CAMERA.shakeBase;
    const shakeSpeed = speed * HIT_FEEDBACK.CAMERA.shakeSpeedMultiplier;
    const shakeQuality = quality * HIT_FEEDBACK.CAMERA.shakeQualityMultiplier;
    let shakeAmount = shakeBase + shakeSpeed + shakeQuality;
    shakeAmount = Math.min(HIT_FEEDBACK.CAMERA.maxShake, shakeAmount);

    if (shakeAmount > 0.005) {
      game.shake = Math.min(1.1, game.shake + shakeAmount);
      const dirX = (Math.random() - 0.5) * 0.5;
      const dirZ = (Math.random() - 0.5) * 0.5;
      game.shakeDir = V3.norm(V3.new(dirX, 0.3, dirZ), V3.new(dirX, 0.3, dirZ));
    }

    // Layer 2: Speed-based FOV pulse on big hits
    if (speed > 20 && quality > 0.6 && Number.isFinite(game.fov)) {
      const fovPulse = Math.min(2.2, (speed - 20) * 0.08);
      game.fov = game.fov + fovPulse;
    }

    // Layer 3: Judgement line flash on perfect shots
    if (quality > 0.9 && speed > 15) {
      game.hitFlash = Math.min(1, game.hitFlash + 0.15);
    }
  }

  /**
   * Post-hit visual effects — trail enhancement.
   */
  postHitVisuals(quality, speed, spinType, ctx) {
    const game = this.game;

    // Enhance trail on quality hits
    if (quality > 0.6 && game.settings.showTrail !== false) {
      // Trail already handled in drawFX, but we can boost settings temporarily
      // for better visual feedback
    }

    // Add contact decal (mark on table)
    if (quality > 0.3 && ctx.contactPoint) {
      const p = ctx.contactPoint;
      // Only on table
      if (p.y <= PH.TABLE_Y + 0.02) {
        game.addMark(p.x, p.z, speed);
      }
    }
  }

  /**
   * Enable/disable haptic feedback.
   */
  setHaptic(enabled) {
    this._hapticEnabled = enabled;
  }
}
