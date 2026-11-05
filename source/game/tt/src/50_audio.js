/* =====================================================================
 *  AUDIO - embedded contact/swing samples, procedural fallback and room.
 *  Playback uses the audio clock, never simulation time or its RNG.
 * ===================================================================== */
'use strict';

const TT_AUDIO_LEVELS = Object.freeze({ master: 0.8, effects: 0.9, music: 0.25, ambient: 0.2 });
// Offsets are in gapless-decoded seconds. Measured single ball transients do
// not establish different materials, so both contact APIs share the variants.
// Gains leave headroom for MP3 overshoot; the swing is deliberately quieter.
const TT_AUDIO_MANIFEST = Object.freeze([
  Object.freeze({ key: 'ball1', events: Object.freeze(['hitRacket', 'hitTable']), offset: 0, duration: 0.12, gain: 0.62 }),
  Object.freeze({ key: 'ball2', events: Object.freeze(['hitRacket', 'hitTable']), offset: 0, duration: 0.12, gain: 0.51 }),
  Object.freeze({ key: 'ball3', events: Object.freeze(['hitRacket', 'hitTable']), offset: 0, duration: 0.15, gain: 0.61 }),
  Object.freeze({ key: 'swing', events: Object.freeze(['whoosh']), offset: 0.16, duration: 0.275, gain: 0.18 }),
]);

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
    this.levels = { ...TT_AUDIO_LEVELS }; this.volume = this.levels.master;
    this.ok = false; this.muted = false; this.quiet = false; this.master = null; this.ctx = null;
    this._effectSources = new Set(); this._musicSources = new Set(); this._ambientSources = new Set();
    this._audienceSources = new Set(); this._audienceBus = null;
    this._sourceNodes = new Map(); this._sampleBuffers = new Map(); this._sampleDecodes = new Map();
    this._sampleRotation = Object.create(null); this._eventIds = new Map(); this._decodeEpoch = 0;
    this._randomState = 0x51a7d10; this._unlockTarget = null; this._unlockHandler = null; this._unlocked = false;
    this._lastApplause = -Infinity; this._lastReaction = -Infinity; this._rallyMilestone = 0;
    this._noiseBuf = null; this._crowdGain = null; this._crowdAmount = 0.5;
    this._lastWhoosh = -Infinity; this._lastEdge = -Infinity;
  }
  init() {
    if (this.ok && this.ctx && this.ctx.state !== 'closed') return true;
    if (this.ctx) this.dispose();
    const w = typeof window === 'undefined' ? globalThis : window;
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return false;
    try {
      const c = this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = c.createGain();
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.knee.value = 24; this.comp.ratio.value = 7;
      this.comp.attack.value = 0.003; this.comp.release.value = 0.22;
      this.conv = c.createConvolver(); this.conv.buffer = this._makeIR(0.55, 3.1);
      this.wet = c.createGain(); this.wet.gain.value = 0.08;
      this.dry = c.createGain(); this.dry.gain.value = 1;
      // bus remains the effects output used by existing callers.
      this.bus = c.createGain(); this.musicBus = c.createGain(); this.ambientBus = c.createGain();
      this.bus.connect(this.dry); this.dry.connect(this.comp);
      this.bus.connect(this.conv); this.conv.connect(this.wet); this.wet.connect(this.comp);
      this.musicBus.connect(this.comp); this.ambientBus.connect(this.comp);
      this.comp.connect(this.master); this.master.connect(c.destination);
      this._noiseBuf = this._makeNoise(2);
      this.ok = true; this._applyLevels();
      if (c.state !== 'running') this._watchUnlock();
      return true;
    } catch (_) { this.dispose(); return false; }
  }
  resume() {
    if (!this.init()) return Promise.resolve(false);
    const c = this.ctx;
    let resumed;
    try { if (c.state !== 'running' && c.resume) resumed = c.resume(); }
    catch (_) { if (this.ctx === c && c.state !== 'closed') this._watchUnlock(); return Promise.resolve(false); }
    this.preloadSamples();
    return Promise.resolve(resumed).then(() => {
      if (this.ctx !== c || c.state === 'closed') return false;
      this._unlocked = !c.state || c.state === 'running';
      if (this._unlocked) { this._removeUnlock(); this._applyLevels(); }
      else this._watchUnlock();
      return this._unlocked;
    }, () => { if (this.ctx === c && c.state !== 'closed') this._watchUnlock(); return false; });
  }
  unlock() { return this.resume(); }
  _watchUnlock() {
    if (!this.ok || !this.ctx || this.ctx.state === 'closed' || this._unlockHandler ||
        typeof window === 'undefined' || !window.addEventListener) return;
    this._unlockTarget = window;
    this._unlockHandler = e => { if (!e || e.isTrusted !== false) this.resume(); };
    for (const event of ['pointerdown', 'touchstart', 'keydown'])
      window.addEventListener(event, this._unlockHandler, { capture: true, passive: true });
  }
  _removeUnlock() {
    if (this._unlockTarget && this._unlockTarget.removeEventListener)
      for (const event of ['pointerdown', 'touchstart', 'keydown'])
        this._unlockTarget.removeEventListener(event, this._unlockHandler, true);
    this._unlockTarget = null; this._unlockHandler = null;
  }
  setMuted(m) { this.muted = !!m; this._applyLevels(); }
  setQuiet(q) { this.quiet = !!q; this._applyLevels(); }
  setVolume(v) { this.setLevels({ master: v }); }
  setLevels(values) {
    if (values && typeof values === 'object') for (const key of Object.keys(TT_AUDIO_LEVELS)) {
      if (Number.isFinite(values[key])) this.levels[key] = Math.max(0, Math.min(1, values[key]));
    }
    this.volume = this.levels.master; this._applyLevels();
    return { ...this.levels };
  }
  _applyLevels() {
    const silent = this.muted || this.quiet || this.volume === 0;
    if (this.master) this.master.gain.value = silent ? 0 : this.volume;
    if (this.bus) this.bus.gain.value = this.levels.effects;
    if (this.musicBus) this.musicBus.gain.value = this.levels.music;
    if (this.ambientBus) this.ambientBus.gain.value = this.levels.ambient;
    if (silent || this.levels.effects === 0) this.stopEffects();
    if (silent || this.levels.music === 0) this.stopMusic();
    if (silent || this.levels.ambient === 0) { this.stopAudience(); this._stopAmbient(); }
    else if (this._unlocked) this._startCrowd();
  }
  canPlay(channel = 'effects') {
    const key = channel === 'audience' ? 'ambient' : channel;
    return this.ok && !!this.ctx && this.ctx.state !== 'closed' &&
      (!this.ctx.state || this.ctx.state === 'running' || typeof this.ctx.startRendering === 'function') &&
      !this.muted && !this.quiet && this.volume > 0 && this.levels[key] > 0;
  }
  preloadSamples() {
    if (!this.ok) return Promise.resolve([]);
    return Promise.all(TT_AUDIO_MANIFEST.map(sample => this._decodeSample(sample.key)));
  }
  _decodeSample(key) {
    if (this._sampleDecodes.has(key)) return this._sampleDecodes.get(key);
    const bank = typeof TT_AUDIO_SAMPLES === 'undefined' ? null : TT_AUDIO_SAMPLES;
    const encoded = bank && bank[key], c = this.ctx, epoch = this._decodeEpoch;
    const promise = new Promise(resolve => {
      let settled = false;
      const finish = buffer => {
        if (settled) return;
        settled = true;
        if (epoch !== this._decodeEpoch || !buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0) buffer = null;
        if (buffer) this._sampleBuffers.set(key, buffer);
        resolve(buffer);
      };
      try {
        if (typeof encoded !== 'string' || !encoded || !c || !c.decodeAudioData) { finish(null); return; }
        const binary = atob(encoded), bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        // Support both callback-only Safari and promise-returning decoders.
        const decoding = c.decodeAudioData(bytes.buffer, finish, () => finish(null));
        if (decoding && decoding.then) decoding.then(finish, () => finish(null));
      } catch (_) { finish(null); }
    });
    this._sampleDecodes.set(key, promise);
    return promise;
  }
  _once(event, id) {
    if (!(typeof id === 'string' || Number.isFinite(id))) return true;
    const key = event + ':' + typeof id + ':' + id;
    if (this._eventIds.has(key)) return false;
    this._eventIds.set(key, true);
    if (this._eventIds.size > 128) this._eventIds.delete(this._eventIds.keys().next().value);
    return true;
  }
  _playSample(event, level, pan = 0, rate = 1) {
    const variants = TT_AUDIO_MANIFEST.filter(sample => sample.events.includes(event));
    for (const sample of variants) this._decodeSample(sample.key);
    const ready = variants.filter(sample => {
      const buffer = this._sampleBuffers.get(sample.key);
      return buffer && Math.min(sample.duration, buffer.duration - sample.offset) > 0.005;
    });
    if (!ready.length) return false; // no replay when a pending decode finishes
    const index = this._sampleRotation[event] ?? 0, sample = ready[index % ready.length];
    this._sampleRotation[event] = index + 1;
    const c = this.ctx, buffer = this._sampleBuffers.get(sample.key);
    const duration = Math.min(sample.duration, buffer.duration - sample.offset), t = c.currentTime;
    let source;
    try {
      source = c.createBufferSource(); source.buffer = buffer;
      if (rate !== 1) source.playbackRate.value = rate;
      const gain = c.createGain(), nodes = [gain], volume = sample.gain * level;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.0004);
      gain.gain.setValueAtTime(volume, t + duration - 0.004);
      gain.gain.linearRampToValueAtTime(0, t + duration);
      source.connect(gain);
      if (pan !== 0 && c.createStereoPanner) {
        const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); nodes.push(p);
        gain.connect(p); p.connect(this.bus);
      } else gain.connect(this.bus);
      this._trackSource(source, nodes);
      source.start(t, sample.offset, duration);
      return true;
    } catch (_) { if (source) this._stopSource(source); return false; }
  }
  _trackSource(source, nodes, channel = 'effects', onEnded) {
    const sources = channel === 'music' ? this._musicSources : channel === 'audience' ? this._audienceSources :
      channel === 'ambient' ? this._ambientSources : this._effectSources;
    const limit = channel === 'effects' ? 24 : channel === 'audience' ? 40 : channel === 'music' ? 2 : 1;
    while (sources.size >= limit) this._stopSource(sources.values().next().value);
    while (this._sourceNodes.size >= 64) this._stopSource(this._sourceNodes.keys().next().value);
    let ended = false;
    const cleanup = () => {
      if (ended) return;
      ended = true; source.onended = null; sources.delete(source); this._sourceNodes.delete(source);
      for (const node of [source, ...nodes]) { try { node.disconnect(); } catch (_) {} }
      if (onEnded) onEnded();
    };
    sources.add(source); this._sourceNodes.set(source, cleanup); source.onended = cleanup;
  }
  _stopSource(source) {
    const cleanup = this._sourceNodes.get(source);
    try { source.stop(); } catch (_) {}
    if (cleanup) cleanup();
    else {
      for (const sources of [this._effectSources, this._musicSources, this._audienceSources, this._ambientSources]) sources.delete(source);
      try { source.disconnect(); } catch (_) {}
    }
  }
  stopEffects() {
    for (const source of [...this._effectSources]) this._stopSource(source);
    this._eventIds.clear(); this._lastWhoosh = -Infinity; this._lastEdge = -Infinity;
  }
  stopMusic() { for (const source of [...this._musicSources]) this._stopSource(source); }
  _stopAmbient() {
    for (const source of [...this._ambientSources]) this._stopSource(source);
    this._crowdGain = null;
  }
  dispose() {
    this._removeUnlock(); this.stopEffects(); this.stopMusic(); this.stopAudience(); this._stopAmbient();
    for (const key of ['master', 'bus', 'musicBus', 'ambientBus', 'comp', 'conv', 'wet', 'dry', '_audienceBus']) {
      if (this[key]) { try { this[key].disconnect(); } catch (_) {} }
      this[key] = null;
    }
    const c = this.ctx; this.ctx = null; this.ok = false; this._unlocked = false; this._noiseBuf = null;
    this._decodeEpoch++; this._sampleBuffers.clear(); this._sampleDecodes.clear();
    try { if (c && c.close && c.state !== 'closed') Promise.resolve(c.close()).catch(() => {}); } catch (_) {}
  }
  _random() {
    this._randomState = (Math.imul(1664525, this._randomState) + 1013904223) >>> 0;
    return this._randomState / 4294967296;
  }

  _makeNoise(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = this._random() * 2 - 1;
    return b;
  }
  _makeIR(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        d[i] = (this._random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 300 ? i / 300 : 1);
      }
    }
    return b;
  }
  _noise(dur, gainV, type, f, q, when) {
    if (!this.canPlay() || !(gainV > 0)) return null;
    const c = this.ctx, t = Number.isFinite(when) ? Math.max(c.currentTime, when) : c.currentTime;
    const s = c.createBufferSource(); s.buffer = this._noiseBuf; s.loop = true;
    s.playbackRate.value = 0.8 + this._random() * 0.4;
    const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainV, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt); flt.connect(g); g.connect(this.bus);
    this._trackSource(s, [flt, g]);
    s.start(t); s.stop(t + dur + 0.02);
    return { s, g, flt };
  }
  _tone(freq, dur, gainV, type, when, detune) {
    if (!this.canPlay() || !(gainV > 0)) return null;
    const c = this.ctx, t = Number.isFinite(when) ? Math.max(c.currentTime, when) : c.currentTime;
    const o = c.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
    if (detune) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * detune), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gainV, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.bus);
    this._trackSource(o, [g]);
    o.start(t); o.stop(t + dur + 0.02);
    return { o, g };
  }

  /* ---------------- gameplay events ---------------- */
  hitTable(speed, x, eventId) {
    if (!this.canPlay() || !this._once('hitTable', eventId)) return;
    const v = clamp((Number.isFinite(speed) ? Math.abs(speed) : 0) / 7, 0.08, 1.4);
    if (this._playSample('hitTable', 0.45 + v * 0.5, Number.isFinite(x) ? x * 0.7 : 0)) return;
    const t = this.ctx.currentTime;
    this._noise(0.055 + v * 0.02, 0.26 * v, 'bandpass', 2400 + v * 2600, 2.2, t);
    this._tone(820 + v * 340 + (this._random() * 2 - 1) * 40, 0.075, 0.30 * v, 'triangle', t, 0.55);
    this._tone(214 + (this._random() * 2 - 1) * 12, 0.15, 0.12 * v, 'sine', t, 0.6);
  }
  /** Contact speed sets level; slip shapes only an unavailable-sample fallback.
   *  boost > 0: higher playback rate and louder (strong clean hit). */
  hitRacket(speed, slip, soft, eventId, boost = 0) {
    if (!this.canPlay() || !this._once('hitRacket', eventId)) return;
    const v = clamp((Number.isFinite(speed) ? Math.abs(speed) : 0) / 13, 0.1, 1.5), t = this.ctx.currentTime;
    const rate = 1 + boost * 0.25; // up to 1.25× pitch for a clean power hit
    if (this._playSample('hitRacket', (0.45 + v * 0.5) * (soft ? 0.8 : 1) * (1 + boost * 0.4), 0, rate)) return;
    const body = soft ? 0.55 : 1;
    this._tone(300 + v * 240, 0.085, 0.34 * v * body * (1 + boost * 0.3), 'triangle', t, 0.42);
    this._noise(0.05, 0.16 * v * body, 'bandpass', 1300 + v * 1200, 1.4, t);
    const sl = clamp((Number.isFinite(slip) ? slip : 0) / 16, 0, 1);
    if (sl > 0.05) this._noise(0.10 + sl * 0.09, 0.14 * sl, 'bandpass', 3600 + sl * 3800, 0.9, t);
  }
  hitNet(eventId) {
    if (!this.canPlay() || !this._once('hitNet', eventId)) return;
    const t = this.ctx.currentTime;
    this._noise(0.14, 0.14, 'bandpass', 640, 1.0, t);
    this._tone(150, 0.17, 0.08, 'sine', t, 0.5);
  }
  hitEdge(eventId) {
    if (!this.canPlay() || !this._once('hitEdge', eventId)) return;
    const t = this.ctx.currentTime;
    if (!(typeof eventId === 'string' || Number.isFinite(eventId)) && t - this._lastEdge < 0.18) return;
    this._lastEdge = t;
    this._noise(0.035, 0.12, 'highpass', 3000, 0.7, t);
    this._tone(1050, 0.045, 0.055, 'triangle', t, 0.42);
  }
  hitFloor(speed, eventId) {
    if (!this.canPlay() || !this._once('hitFloor', eventId)) return;
    const v = clamp((Number.isFinite(speed) ? Math.abs(speed) : 0) / 6, 0.05, 1);
    this._tone(150 + v * 90, 0.1, 0.16 * v, 'sine', 0, 0.5);
    this._noise(0.06, 0.08 * v, 'lowpass', 900, 0.6);
  }
  whoosh(power, swingId) {
    if (!this.canPlay() || !this._once('whoosh', swingId)) return;
    const now = this.ctx.currentTime;
    if (!(typeof swingId === 'string' || Number.isFinite(swingId)) && now - this._lastWhoosh < 0.09) return;
    this._lastWhoosh = now;
    const v = clamp(Number.isFinite(power) ? power : 0, 0.1, 1.4);
    if (this._playSample('whoosh', 0.45 + v * 0.5)) return;
    const n = this._noise(0.16 + v * 0.06, 0.055 * v, 'bandpass', 500, 1.1, now);
    if (!n) return;
    n.flt.frequency.setValueAtTime(420, now);
    n.flt.frequency.exponentialRampToValueAtTime(2200 + v * 2200, now + 0.11);
    n.flt.frequency.exponentialRampToValueAtTime(600, now + 0.2);
  }
  point(won) {
    if (!this.canPlay() && !this.canPlay('ambient')) return;
    this._tone(won ? 660 : 392, 0.12, 0.035, 'sine');
    if (won) this.applause(0.35); // two nearby spectators, a couple of claps
  }
  gameOver(won) {
    if (!this.canPlay() && !this.canPlay('ambient')) return;
    const t = this.ctx.currentTime;
    this._tone(won ? 660 : 392, 0.22, 0.035, 'sine', t);
    if (won) {
      this._tone(880, 0.3, 0.025, 'sine', t + 0.16);
      this.applause(1.6); // six people, short and imperfectly synchronised
    } else this.applause(0.3);
  }
  ui(kind) {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    if (kind === 'good') {                       // rising third: "yes"
      this._tone(740, 0.09, 0.055, 'sine', t, 1.6);
      this._tone(1108, 0.16, 0.05, 'sine', t + 0.085, 1.6);
      return;
    }
    if (kind === 'bad') {                        // soft falling tone: "again"
      this._tone(430, 0.10, 0.045, 'sine', t, 1.4);
      this._tone(330, 0.18, 0.04, 'sine', t + 0.09, 1.4);
      return;
    }
    const f = kind === 'back' ? 420 : kind === 'hover' ? 1200 : 760;
    this._tone(f, 0.06, kind === 'hover' ? 0.025 : 0.06, 'sine', 0, 1.6);
  }
  _audienceOutput() {
    if (!this._audienceBus) {
      this._audienceBus = this.ctx.createGain();
      this._audienceBus.gain.value = 1;
      this._audienceBus.connect(this.ambientBus);
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
    this._trackSource(source, nodes, 'audience');
  }
  _clap(t, level, pan) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this._noiseBuf;
    s.playbackRate.value = 0.9 + this._random() * 0.25;
    const filter = c.createBiquadFilter(); filter.type = 'bandpass';
    filter.frequency.value = 1700 + this._random() * 1100; filter.Q.value = 0.65;
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
    s.start(t, this._random() * 0.8); s.stop(t + 0.10);
  }
  applause(amount) {
    if (!this.canPlay('ambient') || !Number.isFinite(amount) || amount <= 0) return;
    const now = this.ctx.currentTime;
    if (now - this._lastApplause < 0.8) return;
    this._lastApplause = now;
    for (const clap of spectatorClapPlan(amount, () => this._random())) this._clap(now + clap.t, clap.gain, clap.pan);
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
    if (!this.canPlay('ambient') || !Number.isFinite(hits) || hits < 4) return;
    const milestone = Math.floor(hits / 4);
    if (milestone <= this._rallyMilestone) return;
    this._rallyMilestone = milestone;
    const t = this.ctx.currentTime;
    if (t - this._lastReaction < 3.2) return; // never cover every ball impact
    this._lastReaction = t;
    const people = hits >= 12 ? 3 : 2;
    for (let i = 0; i < people; i++) this._spectatorOh(t + 0.08 + i * 0.09,
      hits >= 8 ? 0.9 : 0.65, 135 + i * 42 + this._random() * 18, i % 2 ? 0.55 : -0.55);
  }
  stopAudience() {
    for (const source of [...this._audienceSources]) this._stopSource(source);
    this._rallyMilestone = 0; this._lastReaction = -Infinity; this._lastApplause = -Infinity;
  }
  _startCrowd() {
    if (!this._unlocked || !this.canPlay('ambient') || this._ambientSources.size || !this._noiseBuf || this._crowdAmount === 0) return;
    // Barely audible room air; excitement comes from separate spectators.
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this._noiseBuf; s.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const g = c.createGain(); g.gain.value = 0.0008 * this._crowdAmount;
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.ambientBus);
    this._trackSource(s, [hp, lp, g], 'ambient', () => { this._crowdGain = null; }); s.start();
    this._crowdGain = g;
  }
  setCrowd(level) {
    if (!Number.isFinite(level)) return;
    this._crowdAmount = clamp(level, 0, 1);
    if (this._crowdAmount === 0) this._stopAmbient();
    else if (this._crowdGain) this._crowdGain.gain.setTargetAtTime(0.0008 * this._crowdAmount, this.ctx.currentTime, 0.3);
    else this._startCrowd();
  }
}
