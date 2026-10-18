/* =====================================================================
 *  EMOTIONAL DESIGN SYSTEM — crafted moments and dramatic arc
 *
 *  Creates emotional peaks through:
 *   1. Match point tension
 *   2. Comeback hope
 *   3. Winner celebration
 *   4. Net cord drama
 *   5. Edge ball surprise
 *
 *  This is what separates a good game from an award-winning one.
 * ===================================================================== */
'use strict';

const EMOTION_STATE = {
  NEUTRAL: 'neutral',
  TENSION: 'tension',
  HOPE: 'hope',
  CLIMAX: 'climax',
  TRIUMPH: 'triumph',
  DEFEAT: 'defeat',
  SURPRISE: 'surprise',
};

class EmotionalSystem {
  constructor(game) {
    this.game = game;
    this.state = EMOTION_STATE.NEUTRAL;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.momentum = 0;
    this.matchPointTriggered = false;
    this.lastBigMoment = 0;
    this._cooldown = 2.0;  // seconds between big moments
  }

  /**
   * Update emotional state based on game.
   */
  update(gameState) {
    const g = gameState;
    if (!g) return;

    // Detect match point
    const isMatchPoint = this._detectMatchPoint(g);
    if (isMatchPoint && !this.matchPointTriggered) {
      this.matchPointTriggered = true;
      this._triggerMatchPoint();
    }
    if (!isMatchPoint) {
      this.matchPointTriggered = false;
    }

    // Compute intensity from game state
    this.targetIntensity = this._computeIntensity(g);
    this.intensity = lerp(this.intensity, this.targetIntensity, 0.05);

    // Detect big moments
    this._detectBigMoments(g);

    // Update state
    this.state = this._determineState(g);
  }

  /**
   * Detect match point situation.
   */
  _detectMatchPoint(g) {
    if (!g.score) return false;
    const target = g.settings?.targetScore || 11;
    const [pScore, aiScore] = g.score;

    // Player serving for match
    if (pScore >= target - 1 && pScore > aiScore) {
      return true;
    }
    // Player receiving against match point
    if (aiScore >= target - 1 && aiScore > pScore) {
      return true;
    }
    return false;
  }

  /**
   * Trigger match point atmosphere.
   */
  _triggerMatchPoint() {
    // Music: increase tension
    if (this.game.music && this.game.music._initialized) {
      this.game.music.targetLayerGain.tension = 0.8;
    }

    // Visual: subtle vignette darkening
    // Could add CSS class to canvas

    // Text message
    const isPlayerServing = this.game.server === 1;
    const msg = isPlayerServing
      ? 'МATCH POINT — ВАША ПОДАЧА'
      : 'МATCH POINT — СОПЕРНИК ПОДАЁТ';
    this.game.msg(msg, 2.0, '#ffd34d', true);

    // Haptic
    if (navigator.vibrate) {
      try { navigator.vibrate([10, 30, 10]); } catch (e) {}
    }

    // Camera: subtle push-in
    // Could adjust camera target
  }

  /**
   * Compute emotional intensity.
   */
  _computeIntensity(g) {
    let intensity = 0;

    // Rally length
    if (g.rally) {
      intensity += clamp(g.rally / 20, 0, 0.4);
    }

    // Ball speed
    if (g.ball && g.ball.v) {
      const speed = V3.len(g.ball.v) || 0;
      intensity += clamp((speed - 5) / 25, 0, 0.3);
    }

    // Score differential (closer = more tension)
    if (g.score) {
      const [p, a] = g.score;
      const diff = Math.abs(p - a);
      if (diff <= 2) {
        intensity += (2 - diff) * 0.1;
      }
    }

    // Momentum
    if (g.momentum && g.momentum.current) {
      intensity += g.momentum.current * 0.2;
    }

    // Net cord recent
    if (g.netTouched) {
      intensity += 0.15;
    }

    return clamp(intensity, 0, 1);
  }

  /**
   * Detect and trigger big moments.
   */
  _detectBigMoments(g) {
    const now = g.time;
    if (now - this.lastBigMoment < this._cooldown) return;

    // Big winners
    if (g.lastShotInfo && g.lastShotInfo.speed > 85) {
      this._triggerBigMoment('winner', g);
      this.lastBigMoment = now;
    }

    // Net cords
    if (g.netTouched && g.state === GS.RALLY) {
      this._triggerBigMoment('net_cord', g);
      this.lastBigMoment = now;
    }

    // Edge balls
    if (g.lastPoint && g.lastPoint.reason === 'РЕБРО СТОЛА!' ||
        g.lastPoint && g.lastPoint.reason === 'ЗАДНЯЯ КРОМКА!') {
      this._triggerBigMoment('edge', g);
      this.lastBigMoment = now;
    }
  }

  /**
   * Trigger a big moment.
   */
  _triggerBigMoment(type, g) {
    switch (type) {
      case 'winner':
        this._onWinner(g);
        break;
      case 'net_cord':
        this._onNetCord(g);
        break;
      case 'edge':
        this._onEdge(g);
        break;
    }
  }

  /**
   * Winner moment.
   */
  _onWinner(g) {
    // Flash effect
    g.hitFlash = Math.min(1, g.hitFlash + 0.3);

    // Music spike
    if (this.game.music && this.game.music._initialized) {
      this.game.music._triggerClimax();
    }

    // Message
    g.msg('ОЧКО!', 1.2, '#6ee7a8', true);

    // Haptic celebration
    if (navigator.vibrate && g.settings?.haptics) {
      try { navigator.vibrate([15, 30, 15, 30]); } catch (e) {}
    }
  }

  /**
   * Net cord moment.
   */
  _onNetCord(g) {
    // Flash
    g.hitFlash = Math.min(1, g.hitFlash + 0.2);

    // Message
    g.msg('СЕТКА!', 1.0, '#ffd34d', true);

    // Haptic
    if (navigator.vibrate && g.settings?.haptics) {
      try { navigator.vibrate([10, 20, 10]); } catch (e) {}
    }
  }

  /**
   * Edge ball moment.
   */
  _onEdge(g) {
    // Flash
    g.hitFlash = Math.min(1, g.hitFlash + 0.25);

    // Already has message from physics, but enhance
    // Haptic surprise
    if (navigator.vibrate && g.settings?.haptics) {
      try { navigator.vibrate([8, 30, 8]); } catch (e) {}
    }
  }

  /**
   * Determine emotional state.
   */
  _determineState(g) {
    if (!g.score) return EMOTION_STATE.NEUTRAL;

    const target = g.settings?.targetScore || 11;
    const [p, a] = g.score;
    const diff = Math.abs(p - a);

    // Match point
    if (p >= target - 1 && p > a) return EMOTION_STATE.CLIMAX;
    if (a >= target - 1 && a > p) return EMOTION_STATE.CLIMAX;

    // Close score
    if (diff <= 2 && g.rally > 5) return EMOTION_STATE.TENSION;

    // On winning streak
    if (g.momentum && g.momentum.current > 0.5) return EMOTION_STATE.HOPE;

    return EMOTION_STATE.NEUTRAL;
  }

  /**
   * Get current emotion parameters.
   */
  getParams() {
    return {
      state: this.state,
      intensity: this.intensity,
      matchPoint: this.matchPointTriggered,
      lastBigMoment: this.lastBigMoment,
    };
  }
}
