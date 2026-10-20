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
    qualityMultiplier: 10,
    speedMultiplier: 0.6,
    maxCount: 24,
    minSize: 0.004,
    maxSize: 0.012,
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
    this._lastHitTime = -Infinity;
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
    if (now >= this._lastHitTime && now - this._lastHitTime < this._cooldown) return;
    this._lastHitTime = now;

    // Determine spin characteristics
    const spin = ctx.spin || V3.new();
    const spinMag = V3.len(spin);
    const spinType = this.determineSpinType({ ...spin, x: spin.x * (ctx.side || 1) });

    // Quality-based scaling
    const quality = clamp(Number.isFinite(ctx.quality) ? ctx.quality : 1, 0, 1);
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
   * Convention for the near player: -w.x = topspin; mirror for far side
   */
  determineSpinType(spin) {
    const w = spin;
    const top = Math.abs(w.x);
    const side = Math.abs(w.y);
    const slice = Math.abs(w.z);

    if (top > side * 1.5 && top > slice * 1.5) {
      return w.x < 0 ? 'topspin' : 'backspin';
    }
    if (side > top * 1.2 && side > slice * 1.2) {
      return w.y > 0 ? 'sidespin-right' : 'sidespin-left';
    }
    return 'mixed';
  }

  /**
   * Visual feedback: particles, glow, effects.
   */
  visual(quality, speed, spinType, spinMag, ctx) {
    const game = this.game;
    if (game.reducedMotion) return;

    // ---- Particle burst ----
    const baseCount = HIT_FEEDBACK.PARTICLES.baseCount;
    const compact = ['BLOCK', 'PUSH', 'DROP'].includes(ctx.stroke);
    const weight = compact ? .45 : ctx.isServeStroke ? .70 : 1;
    const count = Math.min(HIT_FEEDBACK.PARTICLES.maxCount,
      Math.floor((baseCount + quality * HIT_FEEDBACK.PARTICLES.qualityMultiplier
        + speed * HIT_FEEDBACK.PARTICLES.speedMultiplier) * weight));

    // Particle colors based on spin type
    let colors;
    switch (spinType) {
      case 'topspin':
        colors = { r: 1.0, g: 0.45, b: 0.15, intensity: 1.2 };
        break;
      case 'backspin':
        colors = { r: 0.2, g: 0.6, b: 1.0, intensity: 1.2 };
        break;
      case 'sidespin-right':
        colors = { r: 0.1, g: 0.9, b: 0.5, intensity: 1.1 };
        break;
      case 'sidespin-left':
        colors = { r: 0.9, g: 0.2, b: 0.8, intensity: 1.1 };
        break;
      case 'mixed':
      default:
        colors = { r: 0.8, g: 0.8, b: 0.8, intensity: 1.0 };
    }

    // Size variation
    const sizeBase = HIT_FEEDBACK.PARTICLES.minSize;
    const sizeRange = HIT_FEEDBACK.PARTICLES.maxSize - HIT_FEEDBACK.PARTICLES.minSize;

    // Direction — particles fly away from contact normal
    const dir = ctx.contactNormal || V3.new(0, 0, 1);

    // Burst particles
    const contactP = ctx.contactPoint || game.ball.p;
    game.emitParticles(
      contactP.x, contactP.y, contactP.z,
      count,
      0.8 + speed * 0.04,
      0.10 + quality * 0.12,
      sizeBase + sizeRange * quality,
      colors.r, colors.g, colors.b,
      { x: -dir.x * 0.5, y: -dir.y * 0.5, z: -dir.z * 0.5 }
    );

    // ---- Screen flash ----
    // Only on good quality hits
    if (quality > 0.5 && speed > 5) {
      const flashIntensity = Math.min(1, (quality - 0.5) * 0.8 + speed * 0.012);
      game.hitFlash = Math.min(1, game.hitFlash + flashIntensity * 0.15);
    }

    // ---- Contact glow ----
    // Small glow at contact point (decorative)
    if (game.settings.showDebug) {
      // Debug visualization
    }
  }

  /**
   * Audio feedback: layered sounds.
   */
  audio(quality, speed, spinType, spinMag, ctx) {
    const audio = this._audio;
    if (!audio || !audio.ok) return;

    // Body and rubber brush share one correctly-scaled impulse sound.
    if (audio.hitRacket) {
      audio.hitRacket(speed, ctx.contactSlip || 0, !!ctx.softHit || quality < 0.4);
    }

    // One optional air layer, never two overlapping whooshes. Rubber
    // brush is already proportional to contactSlip inside hitRacket().
    if (audio.whoosh && speed > 12 && !ctx.isServeStroke)
      audio.whoosh(clamp((speed - 12) / 24, 0, .4));

    // ---- Layer 4: Special event sounds ----
    if (ctx.isNetCord) {
      audio.hitNet();
    }
    if (ctx.isEdge) {
      audio.hitEdge();
    }
    if (ctx.isWinner && ctx.side > 0) {
      // Winner sound — brief celebration
      audio.point(true);
    }
  }

  /**
   * Haptic feedback: variable vibration patterns.
   */
  haptic(quality, speed, spinType, ctx) {
    if (!this._hapticEnabled || ctx.side < 0 || !this.game.settings.haptics) return;

    // Quality-based pattern selection
    let pattern;

    if (ctx.isNetCord) {
      pattern = HIT_FEEDBACK.HAPTIC.NET_CORD;
    } else if (ctx.isEdge) {
      pattern = HIT_FEEDBACK.HAPTIC.EDGE_BALL;
    } else if (ctx.isWinner && ctx.side > 0) {
      pattern = HIT_FEEDBACK.HAPTIC.WINNER;
    } else if (ctx.isServeStroke) {
      pattern = HIT_FEEDBACK.HAPTIC.SERVE;
    } else if (['BLOCK', 'PUSH', 'DROP'].includes(ctx.stroke)) {
      pattern = HIT_FEEDBACK.HAPTIC.BLOCK;
    } else if (quality > 0.8 && speed > 15) {
      // Big hit — sharp
      pattern = HIT_FEEDBACK.HAPTIC.HIT.map(v => Math.floor(v * 1.3));
    } else if (quality > 0.5) {
      pattern = HIT_FEEDBACK.HAPTIC.HIT;
    } else if (speed < 3 && quality < 0.4) {
      // Soft/block — gentle
      pattern = HIT_FEEDBACK.HAPTIC.BLOCK;
    } else {
      // Default — medium
      pattern = [6, 20, 6];
    }

    // Scale by speed
    if (pattern.length === 1) {
      pattern[0] = Math.floor(pattern[0] * (0.5 + speed * 0.05));
    }

    this.game.buzz(pattern);
  }

  /**
   * Camera feedback: multi-layer reaction.
   */
  camera(quality, speed, ctx) {
    const game = this.game;
    if (game.reducedMotion) return;

    // Layer 1: Micro shake on impact
    const shakeBase = HIT_FEEDBACK.CAMERA.shakeBase;
    const shakeSpeed = speed * HIT_FEEDBACK.CAMERA.shakeSpeedMultiplier;
    const shakeQuality = quality * HIT_FEEDBACK.CAMERA.shakeQualityMultiplier;
    let shakeAmount = shakeBase + shakeSpeed + shakeQuality;
    const compact = ['BLOCK', 'PUSH', 'DROP'].includes(ctx.stroke);
    shakeAmount *= ctx.side < 0 ? .35 : compact ? .40 : 1;
    shakeAmount = Math.min(HIT_FEEDBACK.CAMERA.maxShake, shakeAmount);

    if (shakeAmount > 0.005) {
      game.shake = Math.min(1.1, game.shake + shakeAmount);
      const dirX = (Math.random() - 0.5) * 0.5;
      const dirZ = (Math.random() - 0.5) * 0.5;
      game.shakeDir = V3.norm(V3.new(dirX, 0.3, dirZ), V3.new(dirX, 0.3, dirZ));
    }

    // No permanent FOV mutation on impact: the camera must not drift
    // further away on every smash.

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
