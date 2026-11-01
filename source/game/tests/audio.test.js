const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { load } = require('./helpers.cjs');

class Param {
  constructor(value = 1) { this.value = value; this.events = []; }
  setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
  linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) {
    assert.ok(value > 0); this.value = value; this.events.push(['exp', value, time]);
  }
  setTargetAtTime(value, time, constant) { this.value = value; this.events.push(['target', value, time, constant]); }
}
class Node {
  constructor(ctx, kind) {
    this.ctx = ctx; this.kind = kind; this.connections = []; this.disconnects = 0;
    this.gain = new Param(); this.frequency = new Param(); this.Q = new Param();
    this.pan = new Param(0); this.playbackRate = new Param(); this.starts = []; this.stops = [];
    ctx.nodes.push(this);
  }
  connect(node) { assert.ok(node, 'output must exist'); this.connections.push(node); return node; }
  disconnect() { this.disconnects++; this.connections = []; }
  start(...args) {
    if (this.ctx.options.startFails && this.buffer && this.buffer.key) throw Error('source start failed');
    this.starts.push(args);
  }
  stop(...args) { this.stops.push(args); if (this.ctx.options.stopFails) throw Error('already ended'); }
  finish() { if (this.onended) this.onended(); }
}
class Context {
  constructor(options = {}) {
    this.options = options; this.sampleRate = 4000; this.currentTime = 10;
    this.state = options.state ?? 'running'; this.nodes = []; this.destination = {};
    this.decodes = []; this.pending = []; this.resumeCalls = 0; this.closeCalls = 0;
  }
  createGain() { return new Node(this, 'gain'); }
  createBufferSource() { return new Node(this, 'source'); }
  createOscillator() { return new Node(this, 'oscillator'); }
  createBiquadFilter() { return new Node(this, 'filter'); }
  createStereoPanner() { return new Node(this, 'panner'); }
  createConvolver() { if (this.options.graphFails) throw Error('graph failed'); return new Node(this, 'convolver'); }
  createDynamicsCompressor() {
    const node = new Node(this, 'compressor');
    for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release']) node[key] = new Param();
    return node;
  }
  createBuffer(channels, length, rate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { duration: length / rate, length, sampleRate: rate, getChannelData: ch => data[ch] };
  }
  decodeAudioData(bytes, success, failure) {
    const key = Buffer.from(bytes).toString(); this.decodes.push(key);
    const buffer = { key, duration: this.options.duration ?? 1 };
    if (this.options.badKeys && this.options.badKeys.includes(key)) {
      if (this.options.mode === 'callback') { queueMicrotask(() => failure(Error('bad MP3'))); return; }
      return Promise.reject(Error('bad MP3'));
    }
    if (this.options.mode === 'deferred') return new Promise(resolve => this.pending.push(() => resolve(buffer)));
    if (this.options.mode === 'callback') { queueMicrotask(() => success(buffer)); return; }
    if (this.options.mode === 'both') success(buffer);
    return Promise.resolve(buffer);
  }
  resume() {
    this.resumeCalls++;
    if (this.options.resumeDeferred) return new Promise((resolve, reject) => { this.resumePending = { resolve, reject }; });
    if (this.options.resumeFails > 0) { this.options.resumeFails--; return Promise.reject(Error('gesture required')); }
    this.state = 'running'; return Promise.resolve();
  }
  close() { this.closeCalls++; this.state = 'closed'; return Promise.resolve(); }
}
function fixture(options = {}) {
  const listeners = new Map(), instances = [], offline = [];
  const win = {
    AudioContext: class extends Context { constructor() { super(options); instances.push(this); } },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const bank = Object.fromEntries(['ball1', 'ball2', 'ball3', 'swing'].map(key => [key, Buffer.from(key).toString('base64')]));
  const extra = { window: win, atob, TT_AUDIO_SAMPLES: options.bank ?? bank,
    fetch() { throw Error('audio must stay offline'); },
    GS: { MENU: 0, MATCH_END: 1, SERVE_READY: 2, SERVE_TOSS: 3, POINT: 4, RALLY: 5 },
    OfflineAudioContext: class extends Context {
      constructor() { super(); offline.push(this); }
      startRendering() { return Promise.resolve({ key: 'music' + offline.length, duration: 2 }); }
    },
  };
  const lib = load(['10_math.js', '50_audio.js', '75_music.js', '75_feedback.js'],
    ['AudioEngine', 'TT_AUDIO_LEVELS', 'TT_AUDIO_MANIFEST', 'MusicSystem', 'HitFeedbackSystem', 'V3', 'GS'], extra);
  const a = new lib.AudioEngine();
  const sources = () => a.ctx.nodes.filter(node => node.kind === 'source' || node.kind === 'oscillator');
  const effects = () => sources().filter(node => node.buffer && node.buffer.key && !node.buffer.key.startsWith('music'));
  return { ...lib, a, listeners, instances, offline, sources, effects };
}
async function ready(f) { assert.equal(f.a.init(), true); await f.a.preloadSamples(); return f.a; }
const peakGain = source => Math.max(...source.connections[0].gain.events.map(event => event[1]));

test('four audio defaults are real buses, and volume is the master alias', async () => {
  const f = fixture(), a = await ready(f);
  assert.deepEqual({ ...a.levels }, { master: .8, effects: .9, music: .25, ambient: .2 });
  assert.equal(a.master.gain.value, .8); assert.equal(a.bus.gain.value, .9);
  assert.equal(a.musicBus.gain.value, .25); assert.equal(a.ambientBus.gain.value, .2);
  assert.ok(a.musicBus.connections.includes(a.comp)); assert.ok(a.ambientBus.connections.includes(a.comp));
  a.setVolume(.31); assert.equal(a.levels.master, .31); assert.equal(a.master.gain.value, .31);
});
test('partial levels retain omitted and invalid values, clamp finite numbers, preserve zero', () => {
  const { a } = fixture();
  a.setLevels({ master: 0, effects: -5, music: 5, ambient: NaN, unknown: 1 });
  assert.deepEqual({ ...a.levels }, { master: 0, effects: 0, music: 1, ambient: .2 });
  a.setLevels({ master: undefined, effects: '0', music: Infinity, ambient: null });
  a.setVolume(NaN); a.setMuted(true); a.setQuiet(true); a.setMuted(false); a.setQuiet(false);
  assert.deepEqual({ ...a.levels }, { master: 0, effects: 0, music: 1, ambient: .2 });
});
test('master zero chosen before context survives init, unlock and mute changes', async () => {
  const f = fixture(), { a } = f; a.setVolume(0); a.setMuted(true);
  assert.equal(await a.unlock(), true); a.setMuted(false);
  assert.equal(a.volume, 0); assert.equal(a.master.gain.value, 0); assert.equal(f.sources().length, 0);
  a.hitRacket(15, 20); a.whoosh(1); a.ui('good'); a.applause(1);
  assert.equal(f.sources().length, 0);
});
test('unsupported or failed context creation stays not ok and cleans the partial graph', () => {
  const { AudioEngine } = load(['50_audio.js'], ['AudioEngine']);
  const a = new AudioEngine(); assert.equal(a.init(), false); assert.equal(a.ok, false);
  const f = fixture({ graphFails: true });
  assert.equal(f.a.init(), false); assert.equal(f.a.ok, false); assert.equal(f.a.ctx, null);
  assert.equal(f.instances[0].closeCalls, 1);
  assert.ok(f.instances[0].nodes.every(node => node.disconnects === 1));
});
test('embedded MP3s decode lazily once per key and resume shares the cache', async () => {
  const f = fixture(), { a } = f;
  assert.equal(f.instances.length, 0); a.init(); assert.equal(a.ctx.decodes.length, 0);
  await a.unlock(); await a.preloadSamples(); await a.resume(); await a.preloadSamples();
  assert.deepEqual(a.ctx.decodes, ['ball1', 'ball2', 'ball3', 'swing']);
  assert.equal(a._sampleBuffers.size, 4);
});
test('build bank may be a global lexical const rather than a window property', async () => {
  const f = fixture(), bank = Object.fromEntries(['ball1', 'ball2', 'ball3', 'swing'].map(key =>
    [key, Buffer.from('lexical-' + key).toString('base64')]));
  vm.runInContext('const TT_AUDIO_SAMPLES = ' + JSON.stringify(bank) + ';', f.context);
  const a = await ready(f);
  assert.deepEqual(a.ctx.decodes, ['lexical-ball1', 'lexical-ball2', 'lexical-ball3', 'lexical-swing']);
});
for (const mode of ['callback', 'both']) test('decode handles ' + mode + ' API without duplicate playback', async () => {
  const f = fixture({ mode }), a = await ready(f);
  a.hitRacket(13, 500, false, 0); a.hitRacket(13, 500, false, 0);
  assert.equal(f.sources().length, 1); assert.equal(f.effects()[0].buffer.key, 'ball1');
  assert.equal(a.ctx.decodes.length, 4);
});
test('pending decode uses only fallback and never replays that contact on completion', async () => {
  const f = fixture({ mode: 'deferred' }), { a } = f; a.init();
  a.hitRacket(13, 0, false, 'first');
  assert.equal(f.sources().length, 2); assert.equal(f.effects().length, 0);
  const decoding = a.preloadSamples(), before = f.sources().length;
  for (const finish of a.ctx.pending) finish(); await decoding;
  assert.equal(f.sources().length, before);
  a.hitRacket(13, 0, false, 'second');
  assert.equal(f.effects().length, 1); assert.equal(f.sources().length, before + 1);
});
test('missing, corrupt and unsupported sample decoders stay on fallback without retries', async () => {
  for (const options of [{ bank: {} }, { badKeys: ['ball1', 'ball2', 'ball3', 'swing'] }, { bank: { ball1: 'not base64!' } }]) {
    const f = fixture(options), a = await ready(f);
    a.hitTable(7, 0); a.whoosh(1); const decoded = a.ctx.decodes.length;
    assert.equal(f.effects().length, 0); assert.equal(f.sources().length, 4);
    await a.preloadSamples(); assert.equal(a.ctx.decodes.length, decoded);
  }
  const f = fixture(); f.a.init(); f.a.ctx.decodeAudioData = undefined;
  await f.a.preloadSamples(); assert.doesNotThrow(() => f.a.hitRacket(10, 0));
});
test('one ready variant is preferable to synthesizing over failed variants', async () => {
  const f = fixture({ badKeys: ['ball2', 'ball3'] }), a = await ready(f);
  for (let i = 0; i < 5; i++) a.hitRacket(12, 300, false, i);
  assert.deepEqual(f.effects().map(source => source.buffer.key), Array(5).fill('ball1'));
  assert.equal(f.sources().length, 5);
});
test('unusable trimmed buffers are excluded before choosing a healthy cached variant', async () => {
  const f = fixture(), a = await ready(f); a._sampleBuffers.get('ball1').duration = .001;
  a.hitRacket(12, 30, false, 0);
  assert.equal(f.sources().length, 1); assert.equal(f.effects()[0].buffer.key, 'ball2');
  a._sampleBuffers.get('swing').duration = .1; a.whoosh(1, 0);
  assert.equal(f.effects().length, 1); assert.equal(f.sources().length, 2);
});
test('physical contact and swing each play one sample with no synthetic layers', async () => {
  const f = fixture(), a = await ready(f);
  a.hitRacket(13, 500, false, 'player'); a.hitRacket(13, 500, false, 'ai');
  a.hitTable(7, .5, 'bounce'); a.whoosh(1, 'swing');
  assert.equal(f.sources().length, 4); assert.equal(f.effects().length, 4);
  assert.deepEqual(f.effects().map(source => source.buffer.key), ['ball1', 'ball2', 'ball1', 'swing']);
  assert.ok(f.effects().every(source => source.starts[0][0] === a.ctx.currentTime));
  /* Один сэмпл на событие и никаких синтетических слоёв — как и раньше. Но
   * стол и ракетка звучат РАЗНО: стол короче и выше (rate > 1), ракетка глуше
   * (rate < 1). До этого решения оба события играли один сэмпл с одним темпом,
   * и отскок от стола был на слух неотличим от удара ракеткой («странный стук»).
   * Транзиенты по-прежнему общие: различие — тембр события, не «материал». */
  const [hitA, hitB, table, swing] = f.effects();
  for (const hit of [hitA, hitB]) {
    assert.ok(hit.playbackRate.value < 1 && hit.playbackRate.value > 0.9, `racket rate ${hit.playbackRate.value}`);
    assert.equal(hit.starts[0][2] > 0.1, true, 'the racket keeps the whole measured transient');
  }
  assert.ok(table.playbackRate.value > 1 && table.playbackRate.value < 1.25, `table rate ${table.playbackRate.value}`);
  assert.ok(table.starts[0][2] < hitA.starts[0][2] * 0.75, 'the bounce is audibly shorter than the hit');
  assert.equal(swing.playbackRate.value, 1, 'the swing is untouched by the contact timbre map');
});

test('contact timbre is a bounded, deterministic map with no invented material', () => {
  const lib = load(['10_math.js', '05_stroke_config.js', '50_audio.js'], ['contactTimbre', 'TT_AUDIO_TIMBRE']);
  const { contactTimbre, TT_AUDIO_TIMBRE } = lib;
  assert.deepEqual(Object.keys(TT_AUDIO_TIMBRE).sort(), ['hitRacket', 'hitTable']);
  for (const event of ['hitTable', 'hitRacket']) {
    const cfg = TT_AUDIO_TIMBRE[event];
    for (const r of [0, 0.25, 0.5, 0.75, 1]) {
      const t = contactTimbre(event, () => r);
      assert.ok(t.rate > 0.5 && t.rate < 1.8, `${event} rate ${t.rate}`);
      assert.ok(t.trim > 0 && t.trim <= 1, `${event} trim ${t.trim}`);
      assert.ok(Math.abs(t.rate - cfg.rate) <= cfg.rate * cfg.jitter + 1e-9, 'jitter stays inside its band');
    }
    assert.ok(contactTimbre(event, () => 0.5).rate > 0);
  }
  const table = contactTimbre('hitTable'), racket = contactTimbre('hitRacket');
  assert.ok(table.rate > racket.rate * 1.05, 'a table bounce is always brighter than a racket hit');
  assert.ok(table.trim < racket.trim, 'and always shorter');
  const other = contactTimbre('whoosh', () => 0.5);   // объект из vm: сравниваем по полям
  assert.equal(other.rate, 1); assert.equal(other.trim, 1, 'other events are untouched');
});
test('manifest cuts measured silence/tails without assigning invented contact materials', async () => {
  const f = fixture(), a = await ready(f);
  const lengths = { ball1: .311519274, ball2: .251383220, ball3: .444195011, swing: 1.169319728 };
  for (const sample of f.TT_AUDIO_MANIFEST) {
    assert.ok(Object.isFrozen(sample)); assert.ok(Object.isFrozen(sample.events));
    assert.ok(sample.offset >= 0 && sample.duration > 0 && sample.offset + sample.duration <= lengths[sample.key]);
    assert.ok(sample.gain > 0 && sample.gain < 1);
    if (sample.key !== 'swing') assert.deepEqual([...sample.events], ['hitRacket', 'hitTable']);
  }
  a.whoosh(1, 0); const source = f.effects()[0];
  assert.deepEqual(source.starts[0], [10, .16, .275]);
  assert.equal(source.connections[0].gain.events.at(-1)[1], 0);
});
test('event IDs including zero deduplicate contact and the entire active swing', async () => {
  const f = fixture(), a = await ready(f);
  a.hitRacket(10, 0, false, 0); a.hitRacket(10, 0, false, 0);
  a.whoosh(1, 0); a.ctx.currentTime += 1; a.whoosh(1, 0);
  assert.equal(f.effects().length, 2);
  a.whoosh(1, 1); a.whoosh(1, 2); // distinct real swings are not pointermove throttles
  assert.equal(f.effects().length, 4);
});
test('legacy whoosh and edge throttles work at audio time zero', async () => {
  const f = fixture(), a = await ready(f); a.ctx.currentTime = 0;
  a.whoosh(1); a.whoosh(1); assert.equal(f.effects().length, 1);
  a.hitEdge(); a.hitEdge(); assert.equal(f.sources().length, 3);
  a.ctx.currentTime = .1; a.whoosh(1); assert.equal(f.effects().length, 2);
});
test('contact speed changes only bounded gain, independent of simulation tempo', async () => {
  const slow = fixture(), fast = fixture(), soft = fixture();
  await ready(slow); await ready(fast); await ready(soft);
  slow.a.timeScale = .35; fast.a.timeScale = 1.25;
  slow.a.hitRacket(13, 80, false); fast.a.hitRacket(13, 80, false); soft.a.hitRacket(13, 80, true);
  assert.equal(peakGain(slow.effects()[0]), peakGain(fast.effects()[0]));
  assert.ok(peakGain(soft.effects()[0]) < peakGain(slow.effects()[0]));
  fast.a.hitRacket(1000, 0); assert.ok(peakGain(fast.effects()[1]) <= .51 * 1.2);
});
test('sample rotation and procedural audience/noise never consume simulation RNG', async () => {
  const f = fixture(); vm.runInContext('Math.random = () => { throw Error("simulation RNG consumed"); };', f.context);
  const a = await ready(f);
  for (let i = 0; i < 5; i++) a.hitRacket(10, 0, false, i);
  a.hitTable(7, 0); a.hitNet(); a.hitFloor(4); a.applause(.3); a.onRallyHit(4);
  assert.deepEqual(f.effects().slice(0, 6).map(source => source.buffer.key), ['ball1', 'ball2', 'ball3', 'ball1', 'ball2', 'ball1']);
});
test('effect source and dedup history caps stay bounded during an event burst', async () => {
  const f = fixture(), a = await ready(f);
  for (let i = 0; i < 200; i++) a.hitRacket(13, 0, false, 'contact' + i);
  assert.equal(a._effectSources.size, 24); assert.equal(a._sourceNodes.size, 24); assert.equal(a._eventIds.size, 128);
  assert.ok(f.effects().slice(0, 176).every(source => source.stops.length === 1 && source.disconnects === 1 && source.onended === null));
});
test('onended releases source and connected nodes exactly once', async () => {
  const f = fixture(), a = await ready(f); a.hitTable(7, .5);
  const source = f.effects()[0], gain = source.connections[0], panner = gain.connections[0], ended = source.onended;
  source.finish(); ended();
  assert.equal(a._effectSources.size, 0); assert.equal(a._sourceNodes.size, 0);
  assert.equal(source.disconnects, 1); assert.equal(gain.disconnects, 1); assert.equal(panner.disconnects, 1);
  assert.equal(source.onended, null);
});
test('stopEffects cancels samples and scheduled fallback/UI notes with immediate disconnect', async () => {
  const f = fixture(), a = await ready(f);
  a.hitRacket(13, 0); a.hitNet(); a.ui('good');
  assert.equal(a._effectSources.size, 5);
  const voices = f.sources(); assert.ok(voices.some(source => source.starts[0][0] > a.ctx.currentTime));
  a.ctx.options.stopFails = true;
  a.stopEffects(); a.stopEffects();
  assert.equal(a._effectSources.size, 0); assert.equal(a._sourceNodes.size, 0);
  assert.ok(voices.every(source => source.stops.length > 0 && source.disconnects === 1 && source.onended === null));
});
test('failed sample start cleans its nodes before a single fallback', async () => {
  const f = fixture({ startFails: true }), a = await ready(f);
  assert.doesNotThrow(() => a.hitRacket(10, 0));
  assert.equal(a._effectSources.size, 2);
  assert.equal(f.effects()[0].disconnects, 1); assert.equal(f.effects()[0].onended, null);
});
for (const silence of ['mute', 'quiet', 'zero']) test(silence + ' stops every active channel and cannot schedule new audio', async () => {
  const f = fixture(), a = await ready(f); a._unlocked = true; a._startCrowd();
  a.hitRacket(13, 50); a.applause(.3);
  const musicSource = a.ctx.createBufferSource(), gain = a.ctx.createGain();
  musicSource.connect(gain); gain.connect(a.musicBus); a._trackSource(musicSource, [gain], 'music'); musicSource.start(10);
  const voices = f.sources();
  if (silence === 'mute') a.setMuted(true);
  else if (silence === 'quiet') a.setQuiet(true);
  else a.setVolume(0);
  assert.equal(a._sourceNodes.size, 0); assert.equal(a.master.gain.value, 0);
  assert.ok(voices.every(source => source.disconnects === 1 && source.onended === null));
  a.hitRacket(15, 200); a.whoosh(1); a.point(true); a.gameOver(true); a.ui('good'); a.applause(1); a.onRallyHit(8);
  await a.resume(); assert.equal(f.sources().length, voices.length);
});
test('individual zero channels do not mute other buses', async () => {
  const f = fixture(), a = await ready(f); a.setLevels({ effects: 0 });
  a.hitRacket(13, 0); assert.equal(f.effects().length, 0);
  a.point(true); assert.ok(a._audienceSources.size > 0);
  a.setLevels({ ambient: 0, effects: .9 });
  assert.equal(a._audienceSources.size, 0); a.hitRacket(13, 0); assert.equal(a._effectSources.size, 1);
  a.setLevels({ music: 0 }); assert.equal(a._effectSources.size, 1); assert.equal(a.master.gain.value, .8);
});
test('all source types share a global cap and audience scheduled nodes are released on quiet', async () => {
  const f = fixture(), a = await ready(f); a._unlocked = true; a._startCrowd();
  for (let i = 0; i < 2; i++) {
    const source = a.ctx.createBufferSource(), gain = a.ctx.createGain();
    source.connect(gain); gain.connect(a.musicBus); a._trackSource(source, [gain], 'music'); source.start(10);
  }
  for (let i = 0; i < 24; i++) a.hitRacket(13, 0, false, i);
  a.applause(1.6); a.onRallyHit(12);
  assert.equal(a._sourceNodes.size, 64);
  assert.ok(a._effectSources.size <= 24 && a._audienceSources.size <= 40 && a._musicSources.size <= 2);
  const voices = f.sources(); a.setQuiet(true);
  assert.equal(a._sourceNodes.size, 0); assert.equal(a._audienceSources.size, 0);
  assert.ok(voices.every(source => source.disconnects === 1 && source.onended === null));
});
test('OfflineAudioContext may schedule effects while ordinary suspended context cannot', async () => {
  const f = fixture({ state: 'suspended' }), a = await ready(f);
  a.hitRacket(13, 0); assert.equal(f.effects().length, 0);
  a.ctx.startRendering = () => Promise.resolve(); a.hitRacket(13, 0);
  assert.equal(f.effects().length, 1);
  a.setMuted(true); a.hitRacket(13, 0); assert.equal(f.effects().length, 1);
  a.setMuted(false); a.ctx.state = 'closed'; a.hitRacket(13, 0); assert.equal(f.effects().length, 1);
});
test('quiet is separate from user mute and never rewrites requested levels', async () => {
  const f = fixture(), a = await ready(f), requested = { ...a.levels };
  a.setQuiet(true); a.setMuted(true); a.setMuted(false);
  assert.equal(a.quiet, true); assert.equal(a.muted, false); assert.equal(a.master.gain.value, 0);
  a.setQuiet(false); assert.equal(a.master.gain.value, .8); assert.deepEqual({ ...a.levels }, requested);
});
test('room zero set before unlock is retained and room sources do not accumulate', async () => {
  const f = fixture(), { a } = f; a.setCrowd(0); await a.unlock(); a.setCrowd(NaN);
  assert.equal(a._ambientSources.size, 0);
  a.setCrowd(.5); a.setCrowd(.8); await a.resume(); assert.equal(a._ambientSources.size, 1);
  a.setCrowd(0); assert.equal(a._ambientSources.size, 0); assert.equal(a._crowdGain, null);
});
test('mobile unlock retries suspended/interrupted audio and removes gesture listeners on success', async () => {
  for (const state of ['suspended', 'interrupted']) {
    const f = fixture({ state, resumeFails: 1 }), { a } = f; a.init();
    assert.equal(f.listeners.size, 3); assert.equal(await a.resume(), false); assert.equal(f.listeners.size, 3);
    f.listeners.get('pointerdown')({ isTrusted: false }); assert.equal(a.ctx.resumeCalls, 1);
    f.listeners.get('touchstart')({ isTrusted: true }); await a.preloadSamples(); await Promise.resolve();
    assert.equal(a.ctx.resumeCalls, 2); assert.equal(a.ctx.state, 'running'); assert.equal(f.listeners.size, 0);
    assert.equal(a.ctx.decodes.length, 4);
  }
});
test('dispose removes unlock listeners, closes context and fences pending decoder callbacks', async () => {
  const f = fixture({ state: 'suspended', mode: 'deferred' }), { a } = f; a.init();
  const c = a.ctx, decoding = a.preloadSamples(); a.dispose();
  for (const finish of c.pending) finish(); await decoding;
  assert.equal(f.listeners.size, 0); assert.equal(c.closeCalls, 1); assert.equal(a.ok, false); assert.equal(a.ctx, null);
  assert.equal(a._sampleBuffers.size, 0); assert.equal(a._sampleDecodes.size, 0);
  a.setVolume(.2); assert.equal(a.init(), true); assert.equal(a.master.gain.value, .2);
});
test('late resume rejection after dispose cannot reattach unlock listeners', async () => {
  const f = fixture({ state: 'suspended', resumeDeferred: true }), { a } = f;
  const resumed = a.resume(), c = a.ctx; assert.equal(f.listeners.size, 3);
  a.dispose(); c.resumePending.reject(Error('context closed'));
  assert.equal(await resumed, false); assert.equal(f.listeners.size, 0); assert.equal(a.ctx, null);
});
test('feedback uses AudioEngine.ok, preserves quality zero and does not fabricate swing/special events', () => {
  const f = fixture(), calls = [];
  const game = { time: 0, particles: null, reducedMotion: true, settings: { haptics: false }, hitFlash: 0,
    audio: { ok: true, hitRacket: (...args) => calls.push(args),
      whoosh() { throw Error('impact is not a swing'); }, hitNet() { throw Error('duplicate net'); },
      hitEdge() { throw Error('duplicate edge'); }, point() { throw Error('duplicate point'); } } };
  const feedback = new f.HitFeedbackSystem(game);
  feedback.execute({ quality: 0, speed: 13, spin: f.V3.new(-400, 0, 0), side: 1, contactSlip: 5, contactId: 0,
    isWinner: true, isNetCord: true, isEdge: true });
  assert.deepEqual(calls, [[13, 5, true, 0]]);
  feedback.audio(1, 20, 'topspin', 500, { skipBaseHitAudio: true });
  feedback.audio(1, 20, 'topspin', 500, { preview: true }); assert.equal(calls.length, 1);
});
test('Game base contact plus feedback skip flag still produces exactly one contact sample', async () => {
  const f = fixture(), a = await ready(f); a.hitRacket(13, 80, false, 'hit');
  const feedback = new f.HitFeedbackSystem({ audio: a });
  feedback.audio(1, 13, 'topspin', 300, { contactId: 'hit', skipBaseHitAudio: true, isNetCord: true, isEdge: true, isWinner: true });
  assert.equal(f.sources().length, 1);
});
test('music init is silent/lazy and does not require an initialized context', async () => {
  const f = fixture(), music = new f.MusicSystem(f.a);
  assert.equal(await music.init(), true); assert.equal(f.instances.length, 0); assert.equal(f.offline.length, 0);
  music.update({ state: f.GS.SERVE_READY }); assert.equal(f.offline.length, 0);
  await f.a.unlock(); music.update({ state: f.GS.MENU }); assert.equal(f.offline.length, 0);
});
test('music routes bounded cached loops through music level and follows real audio time', async () => {
  const f = fixture(), a = await ready(f), music = new f.MusicSystem(a); await music.init();
  const game = { state: f.GS.RALLY, rally: 20, ball: { v: f.V3.new(30, 0, 0), w: f.V3.new(400, 0, 0) } };
  music.update(game); await music._texturePromise;
  for (let i = 0; i < 120; i++) music.update(game);
  assert.equal(f.offline.length, 2); assert.equal(music._sources.size, 2); assert.equal(a._musicSources.size, 2);
  for (const voice of music._sources.values()) {
    assert.ok(voice.gain.connections.includes(a.musicBus)); assert.equal(voice.source.loop, true);
    assert.deepEqual(voice.gain.gain.events.at(-1).slice(2), [10, .3]);
  }
  a.hitRacket(13, 0); a.setLevels({ music: 0 });
  assert.equal(music._sources.size, 0); assert.equal(a._musicSources.size, 0); assert.equal(a._effectSources.size, 1);
  a.setLevels({ music: .25 }); a.ctx.currentTime = 30; music.update(game);
  assert.equal(f.offline.length, 2); assert.equal(music._sources.size, 2);
  for (const voice of music._sources.values()) assert.equal(voice.source.starts[0][0], 30);
  a.setQuiet(true); assert.equal(music._sources.size, 0); assert.equal(a._sourceNodes.size, 0);
});
test('preview, pause, menu and mute cannot start music or musical stingers', async () => {
  const f = fixture(), a = await ready(f), music = new f.MusicSystem(a); await music.init();
  for (const game of [{ state: f.GS.MENU }, { state: f.GS.SERVE_READY, preview: true }, { state: f.GS.SERVE_READY, paused: true }]) music.update(game);
  music._triggerClimax(); music._playResolution('resolution_win'); music._playResolution('resolution_lose');
  assert.equal(f.sources().length, 0); assert.equal(f.offline.length, 0);
  a.setMuted(true); music.update({ state: f.GS.RALLY, rally: 12 });
  assert.equal(f.sources().length, 0); assert.equal(f.offline.length, 0);
});
