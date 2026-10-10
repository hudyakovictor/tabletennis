/* =====================================================================
 *  AUDIO — everything is synthesised at runtime (no asset downloads).
 *  Impact timbre is driven by the physics: impulse magnitude sets level
 *  and brightness, contact slip sets the amount of "brush" noise, the
 *  material sets the resonant body.
 * ===================================================================== */
'use strict';

class AudioEngine {
  constructor() {
    this.ok = false; this.muted = false; this.master = null; this.ctx = null;
    this._noiseBuf = null; this._crowdGain = null; this._lastWhoosh = 0;
  }
  init() {
    if (this.ok) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.9;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 24; this.comp.ratio.value = 7;
    this.comp.attack.value = 0.003; this.comp.release.value = 0.22;
    // a touch of hall so the venue feels big
    this.conv = c.createConvolver();
    this.conv.buffer = this._makeIR(1.5, 2.6);
    this.wet = c.createGain(); this.wet.gain.value = 0.22;
    this.dry = c.createGain(); this.dry.gain.value = 1.0;
    this.bus = c.createGain();
    this.bus.connect(this.dry); this.dry.connect(this.comp);
    this.bus.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(this.comp);
    this.comp.connect(this.master); this.master.connect(c.destination);
    this._noiseBuf = this._makeNoise(2.0);
    this._startCrowd();
    this.ok = true;
    return true;
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.9; }
  setVolume(v) { if (this.master) this.master.gain.value = this.muted ? 0 : v; }

  _makeNoise(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _makeIR(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 300 ? i / 300 : 1);
      }
    }
    return b;
  }
  _noise(dur, gainV, type, f, q, when) {
    const c = this.ctx, t = when || c.currentTime;
    const s = c.createBufferSource(); s.buffer = this._noiseBuf; s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainV, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(this.bus);
    s.start(t); s.stop(t + dur + 0.02);
    return { s, g, flt };
  }
  _tone(freq, dur, gainV, type, when, detune) {
    const c = this.ctx, t = when || c.currentTime;
    const o = c.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (detune) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * detune), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainV, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.bus);
    o.start(t); o.stop(t + dur + 0.02);
    return { o, g };
  }

  /* ---------------- gameplay events ---------------- */
  /** ball hits the table: bright celluloid "pock" + plywood body */
  hitTable(speed, x) {
    if (!this.ok) return;
    const v = clamp(speed / 7, 0.08, 1.4);
    const t = this.ctx.currentTime;
    this._noise(0.055 + v * 0.02, 0.26 * v, 'bandpass', 2400 + v * 2600, 2.2, t);
    this._tone(820 + v * 340 + rndSym(40), 0.075, 0.30 * v, 'triangle', t, 0.55);
    this._tone(214 + rndSym(12), 0.15, 0.12 * v, 'sine', t, 0.6);
  }
  /** ball meets rubber: duller, with a "brush" layer proportional to slip */
  hitRacket(speed, slip, soft) {
    if (!this.ok) return;
    const v = clamp(speed / 13, 0.1, 1.5), t = this.ctx.currentTime;
    const body = soft ? 0.55 : 1;
    this._tone(300 + v * 240, 0.085, 0.34 * v * body, 'triangle', t, 0.42);
    this._noise(0.05, 0.16 * v * body, 'bandpass', 1300 + v * 1200, 1.4, t);
    const sl = clamp(slip / 16, 0, 1);
    if (sl > 0.05) this._noise(0.10 + sl * 0.09, 0.14 * sl, 'bandpass', 3600 + sl * 3800, 0.9, t);
  }
  hitNet() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noise(0.14, 0.14, 'bandpass', 640, 1.0, t);
    this._tone(150, 0.17, 0.08, 'sine', t, 0.5);
  }
  hitEdge() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._noise(0.05, 0.3, 'highpass', 3600, 0.7, t);
    this._tone(1500, 0.06, 0.22, 'square', t, 0.3);
  }
  hitFloor(speed) {
    if (!this.ok) return;
    const v = clamp(speed / 6, 0.05, 1);
    this._tone(150 + v * 90, 0.1, 0.16 * v, 'sine', 0, 0.5);
    this._noise(0.06, 0.08 * v, 'lowpass', 900, 0.6);
  }
  whoosh(power) {
    if (!this.ok) return;
    const now = this.ctx.currentTime;
    if (now - this._lastWhoosh < 0.09) return;
    this._lastWhoosh = now;
    const v = clamp(power, 0.1, 1.4);
    const n = this._noise(0.16 + v * 0.06, 0.055 * v, 'bandpass', 500, 1.1, now);
    n.flt.frequency.setValueAtTime(420, now);
    n.flt.frequency.exponentialRampToValueAtTime(2200 + v * 2200, now + 0.11);
    n.flt.frequency.exponentialRampToValueAtTime(600, now + 0.2);
  }
  point(won) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const seq = won ? [523.25, 659.25, 783.99] : [392, 329.63];
    seq.forEach((f, i) => this._tone(f, 0.26, 0.10, 'triangle', t + i * 0.075));
    this.applause(won ? 1 : 0.4);
  }
  gameOver(won) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const seq = won ? [523.25, 659.25, 783.99, 1046.5] : [440, 392, 329.63, 261.63];
    seq.forEach((f, i) => { this._tone(f, 0.5, 0.11, 'triangle', t + i * 0.13); this._tone(f * 2, 0.4, 0.04, 'sine', t + i * 0.13); });
    this.applause(won ? 1.6 : 0.5);
  }
  ui(kind) {
    if (!this.ok) return;
    if (kind === 'good') {                       // rising third: "yes"
      this._tone(740, 0.09, 0.055, 'sine', 0, 1.6);
      setTimeout(() => this.ok && this._tone(1108, 0.16, 0.05, 'sine', 0, 1.6), 85);
      return;
    }
    if (kind === 'bad') {                        // soft falling tone: "again"
      this._tone(430, 0.10, 0.045, 'sine', 0, 1.4);
      setTimeout(() => this.ok && this._tone(330, 0.18, 0.04, 'sine', 0, 1.4), 90);
      return;
    }
    const f = kind === 'back' ? 420 : kind === 'hover' ? 1200 : 760;
    this._tone(f, 0.06, kind === 'hover' ? 0.025 : 0.06, 'sine', 0, 1.6);
  }
  applause(amount) {
    if (!this.ok || amount <= 0) return;
    const t = this.ctx.currentTime, dur = 0.8 + amount * 1.5;
    const s = this.ctx.createBufferSource(); s.buffer = this._noiseBuf; s.loop = true;
    const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.055 * amount, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this.bus);
    s.start(t); s.stop(t + dur + 0.05);
  }
  _startCrowd() {
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this._noiseBuf; s.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 760; lp.Q.value = 0.4;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180;
    const g = c.createGain(); g.gain.value = 0.012;
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.dry);
    s.start(t);
    this._crowdGain = g;
    // slow breathing modulation
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lg = c.createGain(); lg.gain.value = 0.006;
    lfo.connect(lg); lg.connect(g.gain); lfo.start(t);
  }
  setCrowd(level) { if (this._crowdGain) this._crowdGain.gain.value = 0.008 + level * 0.03; }
}
