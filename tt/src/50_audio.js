/* =====================================================================
 *  AUDIO — everything is synthesised at runtime (no asset downloads).
 *  Impact timbre is driven by the physics: impulse magnitude sets level
 *  and brightness, contact slip sets the amount of "brush" noise, the
 *  material sets the resonant body.
 * ===================================================================== */
'use strict';

// A handful of individual spectators, never a continuous stadium noise wash.
function spectatorClapPlan(amount, random = Math.random) {
  const a = clamp(Number.isFinite(amount) ? amount : 0, 0, 1.6);
  if (a <= 0) return [];
  const people = a < 0.5 ? 2 : a < 1.2 ? 4 : 6;
  const cycles = 2 + Math.ceil(a * 2), plan = [];
  for (let person = 0; person < people; person++) {
    const interval = 0.24 + random() * 0.12;
    const start = 0.06 + random() * 0.22;
    const pan = -0.72 + 1.44 * person / Math.max(1, people - 1);
    for (let i = 0; i < cycles; i++) plan.push({
      person, t: start + i * interval + random() * 0.035,
      pan, gain: (0.010 + random() * 0.008) * Math.min(1, 0.55 + a * 0.4) * (1 - i / (cycles * 1.6)),
    });
  }
  return plan.sort((a, b) => a.t - b.t);
}

class AudioEngine {
  constructor() {
    this.volume = 0.9;
    this.ok = false; this.muted = false; this.master = null; this.ctx = null;
    this._audienceSources = new Set(); this._audienceBus = null;
    this._lastApplause = -Infinity; this._lastReaction = -Infinity; this._rallyMilestone = 0;
    this._noiseBuf = null; this._crowdGain = null; this._lastWhoosh = 0;
    /* Real recorded samples, embedded by build.py as window.__AUDIO_SAMPLES__
     * (a map of data-URIs). Read through a global rather than a literal in this
     * file so the node test suite can still load 50_audio.js directly — there
     * the object is simply absent and every playback path falls back to the
     * runtime synth. Decoded lazily into AudioBuffers once the context exists. */
    this._samples = {}; this._sampleDecoded = false;
    this._menuSrc = null; this._menuWanted = false; this._tileFlip = 0;
    /* Debug bisect switch (?cut=audio): the context is never created, so every
     * playback entry point sees ok === false and returns without touching the
     * audio thread. Nothing else in the game changes. */
    this.disabled = false;
  }
  init() {
    if (this.ok) return true;
    if (this.disabled) return false;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return false; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 24; this.comp.ratio.value = 7;
    this.comp.attack.value = 0.003; this.comp.release.value = 0.22;
    // A small club room, not an arena-sized reverb tail.
    this.conv = c.createConvolver();
    this.conv.buffer = this._makeIR(0.55, 3.1);
    this.wet = c.createGain(); this.wet.gain.value = 0.08;
    this.dry = c.createGain(); this.dry.gain.value = 1.0;
    this.bus = c.createGain();
    this.bus.connect(this.dry); this.dry.connect(this.comp);
    this.bus.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(this.comp);
    this.comp.connect(this.master); this.master.connect(c.destination);
    this._noiseBuf = this._makeNoise(2.0);
    this._startCrowd();
    this.ok = true;
    this._decodeSamples();
    if (this._menuWanted) this.menuMusic(true);
    return true;
  }

  /* ---------------- recorded samples (ball / applause / menu) ---------------- */
  _b64ToBuf(b64) {
    const bin = atob(b64), n = bin.length, u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  _decodeSamples() {
    if (this._sampleDecoded) return;
    const src = (typeof window !== 'undefined' && window.__AUDIO_SAMPLES__) || null;
    const c = this.ctx;
    if (!src || !c) return;
    this._sampleDecoded = true;
    for (const key of Object.keys(src)) {
      const uri = src[key];
      if (typeof uri !== 'string' || uri.indexOf('base64,') < 0) continue;
      let ab; try { ab = this._b64ToBuf(uri.slice(uri.indexOf('base64,') + 7)); } catch (_) { continue; }
      const done = (buf) => {
        if (!buf) return;
        this._samples[key] = buf;
        if (key === 'menu' && this._menuWanted && !this._menuSrc) this.menuMusic(true);
      };
      try {
        const p = c.decodeAudioData(ab, done);   // modern engines also return a Promise
        if (p && p.then) p.then(done).catch(() => {});
      } catch (_) { /* unsupported codec: the synth fallback stays */ }
    }
  }
  /** Play an embedded sample once (or looped). Returns the source so a
   *  long-lived one (menu music) can be stopped later. Silent no-op until the
   *  buffer has decoded, so callers never have to wait for it. */
  _playSample(key, opt) {
    const buf = this._samples[key];
    if (!buf || !this.ok || this.muted) return null;
    const c = this.ctx, t = (opt && opt.when) || c.currentTime;
    const s = c.createBufferSource(); s.buffer = buf; s.loop = !!(opt && opt.loop);
    if (opt && opt.rate) s.playbackRate.value = opt.rate;
    const g = c.createGain(); g.gain.value = (opt && opt.gain != null) ? opt.gain : 1;
    let tail = g;
    if (opt && opt.pan && c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = opt.pan; g.connect(p); tail = p;
    }
    s.connect(g); tail.connect(this.bus);
    try { s.start(t, (opt && opt.offset) || 0); } catch (_) { return null; }
    if (!s.loop) s.stop(t + buf.duration / (s.playbackRate.value || 1) + 0.05);
    return s;
  }
  /** Loop the menu soundtrack. Safe to call before audio is unlocked or before
   *  the sample has decoded: the intent is remembered and picked up later. */
  menuMusic(on) {
    this._menuWanted = !!on;
    if (!this.ok) return;
    if (on) {
      if (this._menuSrc || this.muted || !this._samples.menu) return;
      this._menuSrc = this._playSample('menu', { gain: 0.5, loop: true });
    } else if (this._menuSrc) {
      try { this._menuSrc.stop(); } catch (_) {}
      try { this._menuSrc.disconnect(); } catch (_) {}
      this._menuSrc = null;
    }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = !!m; if (this.muted) { this.stopAudience(); this.menuMusic(false); } if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; if (!this.muted && this._menuWanted) this.menuMusic(true); }
  setVolume(v) {
    if (!Number.isFinite(v)) return;
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

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
    /* The recorded tile click IS the ball-on-table transient; alternate the
     * two takes so repeats do not phase into a machine-gun. A quiet synth sine
     * is kept underneath for the plywood body and low weight. Before the
     * sample decodes (or with no sample baked in) the full synth plays. */
    const key = (this._tileFlip ^= 1) ? 'tileA' : 'tileB';
    if (this._samples[key]) {
      this._playSample(key, { when: t, gain: clamp(0.4 + v * 0.55, 0, 1.1),
        rate: clamp(0.94 + v * 0.10, 0.85, 1.18), pan: clamp((x || 0) / 1.0, -1, 1) * 0.35 });
      this._tone(214 + rndSym(12), 0.15, 0.07 * v, 'sine', t, 0.6);
      return;
    }
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
    if (t - (this._lastEdge || -Infinity) < 0.18) return;
    this._lastEdge = t;
    this._noise(0.035, 0.12, 'highpass', 3000, 0.7, t);
    this._tone(1050, 0.045, 0.055, 'triangle', t, 0.42);
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
    this._tone(won ? 660 : 392, 0.12, 0.035, 'sine');
    if (won) this.applause(0.35); // two nearby spectators, a couple of claps
  }
  gameOver(won) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone(won ? 660 : 392, 0.22, 0.035, 'sine', t);
    if (won) this._tone(880, 0.3, 0.025, 'sine', t + 0.16);
    /* The recorded crowd applause closes the match; the synthesised claps stay
     * as the fallback for a build without the sample baked in. */
    if (this._samples.applause) {
      this._playSample('applause', { when: t + (won ? 0.12 : 0.05), gain: won ? 1.0 : 0.45 });
    } else if (won) {
      this.applause(1.6); // six people, short and imperfectly synchronised
    } else this.applause(0.3);
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
  _audienceOutput() {
    if (!this._audienceBus) {
      this._audienceBus = this.ctx.createGain();
      this._audienceBus.gain.value = 1;
      this._audienceBus.connect(this.bus);
    }
    return this._audienceBus;
  }
  _pan(pan) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
    if (p.pan) p.pan.value = pan;
    p.connect(this._audienceOutput());
    return p;
  }
  _trackAudience(source, nodes) {
    this._audienceSources.add(source);
    source.onended = () => {
      this._audienceSources.delete(source);
      source.disconnect();
      for (const node of nodes) node.disconnect();
    };
  }
  _clap(t, level, pan) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this._noiseBuf;
    s.playbackRate.value = 0.9 + Math.random() * 0.25;
    const filter = c.createBiquadFilter(); filter.type = 'bandpass';
    filter.frequency.value = 1700 + Math.random() * 1100; filter.Q.value = 0.65;
    const g = c.createGain(), p = this._pan(pan);
    // Two close palm transients, then a short dry decay — audible claps,
    // unlike the old 3-second loop of filtered white noise.
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.001);
    g.gain.exponentialRampToValueAtTime(level * 0.28, t + 0.009);
    g.gain.linearRampToValueAtTime(level * 0.68, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.00001, t + 0.085);
    s.connect(filter); filter.connect(g); g.connect(p);
    this._trackAudience(s, [filter, g, p]);
    s.start(t, Math.random() * 0.8); s.stop(t + 0.10);
  }
  applause(amount) {
    if (!this.ok || this.muted || !Number.isFinite(amount) || amount <= 0) return;
    const now = this.ctx.currentTime;
    if (now - this._lastApplause < 0.8) return;
    this._lastApplause = now;
    for (const clap of spectatorClapPlan(amount)) this._clap(now + clap.t, clap.gain, clap.pan);
  }
  _spectatorOh(t, strength, pitch, pan) {
    const c = this.ctx, o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(pitch, t);
    o.frequency.exponentialRampToValueAtTime(pitch * 1.16, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.92, t + 0.42);
    const formant1 = c.createBiquadFilter(); formant1.type = 'bandpass'; formant1.frequency.value = 490; formant1.Q.value = 3;
    const formant2 = c.createBiquadFilter(); formant2.type = 'bandpass'; formant2.frequency.value = 920; formant2.Q.value = 4;
    const g = c.createGain(), p = this._pan(pan);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.012 * strength, t + 0.075);
    g.gain.exponentialRampToValueAtTime(0.00001, t + 0.5);
    o.connect(formant1); o.connect(formant2); formant1.connect(g); formant2.connect(g); g.connect(p);
    this._trackAudience(o, [formant1, formant2, g, p]);
    o.start(t); o.stop(t + 0.53);
  }
  resetRally() { this._rallyMilestone = 0; }
  onRallyHit(hits) {
    if (!this.ok || this.muted || !Number.isFinite(hits) || hits < 4) return;
    const milestone = Math.floor(hits / 4);
    if (milestone <= this._rallyMilestone) return;
    this._rallyMilestone = milestone;
    const t = this.ctx.currentTime;
    if (t - this._lastReaction < 3.2) return; // never cover every ball impact
    this._lastReaction = t;
    const people = hits >= 12 ? 3 : 2;
    for (let i = 0; i < people; i++) this._spectatorOh(t + 0.08 + i * 0.09,
      hits >= 8 ? 0.9 : 0.65, 135 + i * 42 + Math.random() * 18, i % 2 ? 0.55 : -0.55);
  }
  stopAudience() {
    for (const source of this._audienceSources) { try { source.stop(); } catch (_) {} }
    this._audienceSources.clear();
    this._rallyMilestone = 0;
  }
  _startCrowd() {
    // Barely audible room air; excitement comes from separate spectators.
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noiseBuf; s.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const g = c.createGain(); g.gain.value = 0.0004;
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.dry); s.start();
    this._crowdGain = g;
  }
  setCrowd(level) {
    if (this._crowdGain && Number.isFinite(level))
      this._crowdGain.gain.setTargetAtTime(0.00035 + clamp(level, 0, 1) * 0.0005, this.ctx.currentTime, 0.3);
  }
}
