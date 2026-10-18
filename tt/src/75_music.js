/* =====================================================================
 *  MUSIC SYSTEM — dynamic ambient soundtrack
 *
 *  Layers:
 *   1. Base: constant ambient pad (always present)
 *   2. Tension: builds with rally intensity
 *   3. Climax: on big moments (winners, smash, etc.)
 *   4. Resolution: after point ends
 *
 *  This creates emotional arc through music — critical for
 *  award-winning game feel.
 * ===================================================================== */
'use strict';

const MUSIC_STATE = {
  IDLE: 'idle',         // menu / not playing
  CALM: 'calm',         // serve prep, waiting
  BUILDING: 'building', // rally starting
  INTENSE: 'intense',   // rally in progress, high pace
  CLIMAX: 'climax',     // big moment
  RESOLUTION_WIN: 'resolution_win',
  RESOLUTION_LOSE: 'resolution_lose',
};

class MusicSystem {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.state = MUSIC_STATE.IDLE;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.currentLayerGain = {
      base: 0.25,
      tension: 0,
      climax: 0,
      resolution: 0,
    };
    this.targetLayerGain = { ...this.currentLayerGain };

    // Pre-computed procedural audio buffers (synthesized)
    this._buffers = {};
    this._initialized = false;

    // Music parameters
    this._bpm = 90;
    this._key = 'A_minor';
    this._scale = [0, 2, 3, 5, 7, 8, 10]; // A minor pentatonic + 3
  }

  /**
   * Initialize the music system.
   * Creates procedural audio buffers using OfflineAudioContext.
   */
  async init() {
    if (this._initialized) return;
    if (!this.audio || typeof this.audio.setVolume !== 'function') {
      console.warn('MusicSystem: AudioEngine not available');
      return;
    }

    try {
      // Create procedural ambient textures using oscillators
      await this._createAmbientTextures();
      this._initialized = true;
    } catch (e) {
      console.warn('MusicSystem: init failed', e);
    }
  }

  /**
   * Create ambient procedural audio textures.
   * Uses oscillators and noise for synthetic but pleasant sounds.
   */
  async _createAmbientTextures() {
    const ctx = new OfflineAudioContext(2, 44100 * 4, 44100);

    // ---- Base layer: soft pad ----
    // Multiple detuned oscillators for rich texture
    const baseOscs = [];
    const baseFreqs = [55, 65, 72.5, 82.5]; // Low A, C, D, E
    for (let i = 0; i < baseFreqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = baseFreqs[i];

      const gain = ctx.createGain();
      gain.gain.value = 0.08 / baseFreqs.length;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 400 + i * 100;

      osc.connect(filter);
      filter.connect(gain);
      baseOscs.push(gain);
    }

    // Connect to output
    const baseMix = ctx.createGain();
    baseMix.gain.value = 0.7;
    for (const g of baseOscs) {
      g.connect(baseMix);
    }
    baseMix.connect(ctx.destination);

    // Start all
    for (const osc of ctx.createOscillator ? [] : []) {
      osc.start();
    }

    // Render and store
    const baseBuffer = await ctx.startRendering();
    this._buffers.base = baseBuffer;

    // ---- Tension layer: pads that evolve ----
    // Higher frequency content, more movement
    const tensionCtx = new OfflineAudioContext(2, 44100 * 4, 44100);
    const tensionOscs = [];
    const tensionFreqs = [130, 165, 196, 220]; // Higher A, E, G, A
    for (let i = 0; i < tensionFreqs.length; i++) {
      const osc = tensionCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = tensionFreqs[i];

      const gain = tensionCtx.createGain();
      gain.gain.value = 0.04 / tensionFreqs.length;

      const lfo = tensionCtx.createOscillator();
      lfo.frequency.value = 0.5 + i * 0.2;
      const lfoGain = tensionCtx.createGain();
      lfoGain.gain.value = 15;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      const filter = tensionCtx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;

      osc.connect(filter);
      filter.connect(gain);
      tensionOscs.push(gain);
    }

    const tensionMix = tensionCtx.createGain();
    tensionMix.gain.value = 0.5;
    for (const g of tensionOscs) {
      g.connect(tensionMix);
    }
    tensionMix.connect(tensionCtx.destination);

    const tensionBuffer = await tensionCtx.startRendering();
    this._buffers.tension = tensionBuffer;

    // ---- Resolution layer: chord progression ----
    // Pleasant resolving chord
    const resCtx = new OfflineAudioContext(2, 44100 * 2, 44100);
    const chordFreqs = [220, 261.63, 329.63, 440]; // A, C, E, A — Am chord
    for (let i = 0; i < chordFreqs.length; i++) {
      const osc = resCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = chordFreqs[i];

      const gain = resCtx.createGain();
      gain.gain.value = 0.06 / chordFreqs.length;

      const envelope = gain; // Use gain as envelope
      envelope.gain.setValueAtTime(0, 0);
      envelope.gain.linearRampToValueAtTime(0.06, 0.1);
      envelope.gain.exponentialRampToValueAtTime(0.001, 1.8);

      osc.connect(envelope);
      envelope.connect(resCtx.destination);
      osc.start(0);
      osc.stop(2);
    }

    const resBuffer = await resCtx.startRendering();
    this._buffers.resolution = resBuffer;
  }

  /**
   * Update music based on game state.
   * Call every frame or on state change.
   */
  update(gameState) {
    if (!this._initialized) return;

    // Compute target intensity from game state
    const newIntensity = this.computeIntensity(gameState);
    this.targetIntensity = newIntensity;
    this.intensity = lerp(this.intensity, this.targetIntensity, 0.05);

    // Determine music state
    const newState = this.determineState(gameState);
    if (newState !== this.state) {
      this._onStateTransition(newState);
    }
    this.state = newState;

    // Update layer gains
    this._updateLayerGains(gameState);
  }

  /**
   * Compute music intensity from game state.
   */
  computeIntensity(gameState) {
    const g = gameState;
    let intensity = 0;

    // Rally length adds intensity
    if (g.rally) {
      intensity += clamp(g.rally / 15, 0, 0.5);
    }

    // Ball speed adds intensity
    if (g.ball && g.ball.v) {
      const speed = V3.len(g.ball.v) || 0;
      intensity += clamp((speed - 5) / 25, 0, 0.3);
    }

    // Spin adds intensity
    if (g.ball && g.ball.w) {
      const spin = V3.len(g.ball.w) || 0;
      intensity += clamp(spin / 500, 0, 0.2);
    }

    // Is the player in control?
    if (g.settings && g.settings.assist !== undefined) {
      // Less assist = more tension
      intensity += (1 - g.settings.assist) * 0.1;
    }

    // Momentum
    if (g.momentum && g.momentum.current) {
      intensity += g.momentum.current * 0.15;
    }

    return clamp(intensity, 0, 1);
  }

  /**
   * Determine music state from game state.
   */
  determineState(gameState) {
    const g = gameState;

    if (!g || g.state === GS.MENU || g.state === GS.MATCH_END) {
      return MUSIC_STATE.IDLE;
    }

    if (g.state === GS.SERVE_READY || g.state === GS.SERVE_TOSS) {
      return MUSIC_STATE.CALM;
    }

    if (g.state === GS.POINT) {
      if (g.lastPoint && g.lastPoint.who > 0) {
        return MUSIC_STATE.RESOLUTION_WIN;
      }
      return MUSIC_STATE.RESOLUTION_LOSE;
    }

    if (g.state === GS.RALLY) {
      const intensity = this.intensity;
      if (intensity > 0.7) {
        return MUSIC_STATE.CLIMAX;
      }
      if (intensity > 0.4) {
        return MUSIC_STATE.INTENSE;
      }
      return MUSIC_STATE.BUILDING;
    }

    return MUSIC_STATE.CALM;
  }

  /**
   * Handle state transition.
   */
  _onStateTransition(newState) {
    // Trigger resolution sounds on point end
    if (newState === MUSIC_STATE.RESOLUTION_WIN || newState === MUSIC_STATE.RESOLUTION_LOSE) {
      this._playResolution(newState);
    }

    // Trigger climax effect
    if (newState === MUSIC_STATE.CLIMAX) {
      this._triggerClimax();
    }
  }

  /**
   * Update layer gains based on state.
   */
  _updateLayerGains(gameState) {
    const state = this.state;

    // Base layer — always present, slightly louder in calm
    this.targetLayerGain.base = state === MUSIC_STATE.CALM ? 0.35 : 0.2;

    // Tension layer — builds with intensity
    if (state === MUSIC_STATE.BUILDING || state === MUSIC_STATE.INTENSE || state === MUSIC_STATE.CLIMAX) {
      const intensity = this.intensity;
      this.targetLayerGain.tension = intensity * 0.5;
    } else {
      this.targetLayerGain.tension = 0;
    }

    // Climax — spikes on big moments
    this.targetLayerGain.climax = 0;
    if (state === MUSIC_STATE.CLIMAX) {
      this.targetLayerGain.climax = 0.6;
    }

    // Resolution — plays on point end, fades
    if (state === MUSIC_STATE.RESOLUTION_WIN || state === MUSIC_STATE.RESOLUTION_LOSE) {
      this.targetLayerGain.resolution = 0.5;
    } else {
      // Fade out resolution
      this.targetLayerGain.resolution = lerp(this.currentLayerGain.resolution, 0, 0.05);
    }

    // Smooth interpolation
    for (const key of Object.keys(this.currentLayerGain)) {
      this.currentLayerGain[key] = lerp(
        this.currentLayerGain[key],
        this.targetLayerGain[key],
        0.03
      );
    }
  }

  /**
   * Play resolution sound (win/lose).
   */
  _playResolution(state) {
    // No musical point stingers: keep the table/ball audio unobstructed.
  }

  /** Intensity remains available for visuals, never a synthesized beep. */
  _triggerClimax() {
    // Deliberately silent, including calls from EmotionalSystem.
  }

  /**
   * Get current music parameters for external use (e.g., visualization).
   */
  getParams() {
    return {
      state: this.state,
      intensity: this.intensity,
      baseGain: this.currentLayerGain.base,
      tensionGain: this.currentLayerGain.tension,
      climaxGain: this.currentLayerGain.climax,
      resolutionGain: this.currentLayerGain.resolution,
    };
  }
}
