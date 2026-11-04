const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const stateSource = read('src/core/state.js'), audioSource = read('src/core/audio.js');
const hostSource = read('src/services/game_host.js'), settingsSource = read('src/screens/settings.js');
const i18nSource = read('src/core/i18n.js');
const calSource = read('game/tt/src/06_calibration.js'), embedSource = read('game/tt/src/92_embed.js');
const plain = value => JSON.parse(JSON.stringify(value));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function storage(raw) {
  const entries = new Map([['ttu-v2', JSON.stringify(raw ?? null)]]);
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
}
function classes() {
  const values = new Set();
  return { contains: key => values.has(key), add: key => values.add(key), remove: key => values.delete(key),
    toggle(key, on) { if (on === undefined) on = !values.has(key); on ? values.add(key) : values.delete(key); return on; } };
}

function hostFixture(raw = {}) {
  const sent = [], frames = [], listeners = [], motionListeners = [];
  const query = { matches: false, addEventListener(type, fn) { motionListeners.push(fn); } };
  const layer = { classList: classes(), appendChild() {} }, body = { classList: classes() };
  const document = { body, querySelectorAll: () => [], addEventListener() {},
    createElement() { const frame = { contentWindow: { postMessage(m) { sent.push(plain(m)); } }, setAttribute() {}, remove() {} }; frames.push(frame); return frame; } };
  const window = { addEventListener(type, fn) { if (type === 'message') listeners.push(fn); }, matchMedia: () => query };
  const context = vm.createContext({ window, document, localStorage: storage({ v: 8, ...raw }), sessionStorage: storage(null),
    structuredClone, URLSearchParams, console, clamp, setTimeout: () => 1, clearTimeout() {},
    location: { search: '', href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:' },
    I18n: { lang: 'ru' }, TGX: { w: null }, MODE: { id: 'ranked' }, Sfx: { sync() {} },
    GAME_HTML: '<head></head>', $: selector => selector === '#gamelayer' ? layer : null,
    matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vm.runInContext(stateSource + '\n' + calSource + '\n' + hostSource + '\n;globalThis.api = { S, GameHost, ZoneStats, applyGameCalibrations, calibrationState };', context);
  const api = context.api; api.GameHost.ensure();
  const message = data => listeners.forEach(fn => fn({ data: { __tt: 1, ...data }, source: api.GameHost.frame.contentWindow }));
  const registry = vm.runInContext('CALIBRATION_REGISTRY', context);
  const ready = (preferences = {}) => message({ type: 'ready', rules: { captureRadius: .2 }, calibrationRegistry: plain(registry), calibrationPreferences: preferences, trainingCatalog: { version: 1, lessons: [] } });
  const snapshot = () => api.applyGameCalibrations({ settings: {}, sessionKind: api.GameHost.sessionKind, slowmo: { allowed: true } }, api.S.cal);
  return { ...api, sent, frames, ready, message, snapshot, body, query, motionListeners };
}

test('ready sends current settings before mode, discards old hint/cal packets and waits for acknowledgement', () => {
  const f = hostFixture({ hint: false, cal: { flytime: 0 }, audioLevels: { master: 0, effects: .9, music: .25, ambient: .2 } });
  f.GameHost.send('match', { hint: false, target: 11 }); f.GameHost.send('hint', { on: false });
  f.GameHost.send('cal', { k: 'flytime', v: 20 }); f.S.hint = true;
  f.ready();
  const settings = f.sent.find(m => m.type === 'settings'), match = f.sent.find(m => m.type === 'match');
  assert.ok(f.sent.indexOf(settings) < f.sent.indexOf(match)); assert.equal(settings.hint, true);
  assert.equal(settings.audioLevels.master, 0); assert.equal(settings.calibrations.flytime, undefined);
  assert.equal(match.sessionKind, 'ranked'); assert.equal(Object.hasOwn(match, 'hint'), false);
  assert.equal(Object.hasOwn(f.GameHost.mode.data, 'hint'), false);
  assert.equal(f.sent.some(m => m.type === 'hint' || m.type === 'cal'), false);
  assert.equal(f.GameHost.calibrationRegistry.length, 17); assert.equal(f.GameHost.calibrationReady, false); assert.equal(f.GameHost.calibration, null);
  f.message({ type: 'settings', requestId: settings.requestId, calibration: plain(f.snapshot()) });
  assert.equal(f.GameHost.calibrationReady, true); assert.equal(f.GameHost.calibration.requested.flytime, 0);
  assert.equal(f.GameHost.calibration.effective.flytime, .5);
});

test('stale calibration acknowledgements cannot overwrite a newer request', () => {
  const f = hostFixture(); f.ready();
  f.GameHost.send('cal', { k: 'flytime', v: 0 }); const oldId = f.GameHost.calibrationRequestId;
  f.S.cal.flytime = 100; f.GameHost.send('cal', { k: 'flytime', v: 100 }); const currentId = f.GameHost.calibrationRequestId;
  f.message({ type: 'calibration', requestId: oldId, calibration: plain(f.snapshot()) });
  assert.equal(f.GameHost.calibrationReady, false); assert.equal(f.GameHost.calibration, null);
  f.message({ type: 'calibration', requestId: currentId, calibration: plain(f.snapshot()) });
  assert.equal(f.GameHost.calibrationReady, true); assert.equal(f.GameHost.calibration.requested.flytime, 1);
});

test('ready imports only real stored engine keys once, with explicit shell values including zero taking precedence', () => {
  const f = hostFixture({ cal: { flytime: 0 } });
  f.ready({ flytime: 90, camHeight: 10, camZoom: 0, spinGain: 73.25, arcSens: null, unknown: 100 });
  assert.deepEqual(plain(f.S.cal), { flytime: 0, camHeight: 10, camZoom: 0, spinGain: 73.25 });
  assert.deepEqual(f.sent.find(m => m.type === 'settings').calibrations, { camHeight: 10, camZoom: 0 });
  f.GameHost.reload(); f.ready({ tableGlow: 100 }); assert.equal(Object.hasOwn(f.S.cal, 'tableGlow'), false);
  const fresh = hostFixture(); fresh.ready(); assert.deepEqual(plain(fresh.S.cal), {});
});

test('zone signatures use the actual acknowledged capture radius, not the ready-time baseline', () => {
  const f = hostFixture(); f.ready(); const state = plain(f.snapshot()); state.capture.radius = .286;
  f.message({ type: 'calibration', requestId: f.GameHost.calibrationRequestId, calibration: state });
  assert.equal(f.ZoneStats.sigNow('touch').split('/')[3], '0.29');
});

test('GPU recovery replays current preferences before the saved mode and preserves requested inspector state', () => {
  const f = hostFixture({ cal: { flytime: 0 } }); f.ready(); f.GameHost.send('match', { sessionKind: 'practice', hint: true });
  f.GameHost.inspector = { requested: true, effective: true }; f.S.hint = false; f.S.audioLevels.master = 0;
  f.sent.length = 0; f.GameHost.recover({ inMatch: true, score: [3, 4], server: -1 });
  assert.equal(f.GameHost.calibrationReady, false); assert.equal(f.GameHost.calibrationRegistry.length, 0); assert.equal(f.frames.length, 2);
  f.ready();
  const settings = f.sent.find(m => m.type === 'settings'), match = f.sent.find(m => m.type === 'match'), inspector = f.sent.find(m => m.type === 'slowmo');
  assert.ok(f.sent.indexOf(settings) < f.sent.indexOf(match)); assert.ok(f.sent.indexOf(match) < f.sent.indexOf(inspector));
  assert.equal(settings.hint, false); assert.equal(settings.audioLevels.master, 0); assert.equal(settings.calibrations.flytime, undefined);
  assert.equal(match.sessionKind, 'practice'); assert.equal(Object.hasOwn(match, 'hint'), false); assert.deepEqual(match.resume.score, [3, 4]);
  assert.equal(inspector.on, true);
});

test('shell OS listener keeps effective reduced motion active while requested rm stays independent', () => {
  const f = hostFixture({ rm: true }); f.ready(); f.query.matches = false; f.motionListeners[0]({ matches: false });
  assert.equal(f.body.classList.contains('rm'), true); assert.equal(f.S.rm, true);
  assert.equal(f.sent.at(-1).type, 'rm'); assert.equal(f.sent.at(-1).on, true);
  f.S.rm = false; f.query.matches = true; f.motionListeners[0]({ matches: true });
  assert.equal(f.body.classList.contains('rm'), true); assert.equal(f.S.rm, false); assert.equal(f.sent.at(-1).on, false);
});

function embedFixture() {
  const sent = [], listeners = [], networkHandlers = new Map(); let updates = 0, resizes = 0;
  const audio = { levels: { master: .8, effects: .9, music: .25, ambient: .2 }, muted: false, init() {}, resume() {},
    setMuted(on) { this.muted = on; }, setQuiet(on) { this.quiet = on; },
    setLevels(raw) { for (const key of Object.keys(this.levels)) if (Number.isFinite(raw[key])) this.levels[key] = clamp(raw[key], 0, 1); this.volume = this.levels.master; return { ...this.levels }; } };
  const ui = { inputMode: 'mouse', tick() {}, trainSync() {}, syncShotFeedback() {}, syncScore() {} };
  const g = { ui, audio, settings: { targetScore: 11, difficulty: 1, showTrail: true, quality: 'medium' }, sessionKind: 'free',
    time: 0, strokeTime: 0, timeScale: 1, state: 3, server: 1, score: [0, 0], shotId: 1,
    hintContact: true, motionQuery: { matches: false }, slowmo: { allowed: true }, career: { active: false }, R: {},
    ball: { hist: [], live: true, lastHitBy: -1 }, rallyBounces: [1], scene: { mat: { table: { color: [0, 0, 0] } } },
    network: { state: 'LOBBY', isInMatch: false, on(type, fn) { networkHandlers.set(type, fn); }, leaveRoom() {}, disconnect() {} },
    swipe: {}, updateCamera() {}, update() { return ++updates; }, render() {}, resize() { resizes++; }, awardPoint() {},
    startMatch(diff) { this.settings.difficulty = diff; this.training = null; this.slowmo.allowed = true; },
    setAiTrend() {}, trendFromHistory() {},
    setInspectSlowmo(on) { this.inspectSlowmo = on && this.slowmo.allowed; return this.inspectSlowmo; },
    startTraining(m) { this.training = { stage: 'practice', sessionId: 't1', revision: 0, options: m, snapshot() { return { stage: this.stage }; } }; },
    setPaused(v) { this.paused = v; }, syncAudioQuiet() {} };
  const window = { __TT_EMBED: true, __game: g, parent: { postMessage(m) { sent.push(plain(m)); } }, addEventListener(type, fn) { if (type === 'message') listeners.push(fn); } };
  const document = { readyState: 'complete', visibilityState: 'visible', documentElement: { classList: classes() }, getElementById: () => null };
  const ET = key => key; ET.lang = () => 'ru'; ET.set = () => {};
  const context = vm.createContext({ window, document, clamp, ET, setTimeout: () => 1, clearTimeout() {},
    PH: { TABLE_Y: .76 }, GS: { MENU: 0, SERVE_READY: 1, SERVE_TOSS: 2, RALLY: 3, POINT: 4 },
    MATCH_RULES: { version: 4, captureRadius: .2, contactSideTouchPx: 48, contactSideMousePx: 40, contactBackPx: 120, contactForwardPx: 150 },
    TRAIN_STEPS: [], trainingCatalog: () => ({ version: 1, lessons: [] }),
    createMissShotCapture: () => ({ setEnabled() {}, setHalf() {}, getHalf: () => 350, request: () => null, cancel() {}, fail() {} }),
    V3: {}, TAU: Math.PI * 2 });
  vm.runInContext(calSource + '\napplyGameCalibrations(window.__game, {});\n' + embedSource, context);
  const command = (type, data) => listeners.forEach(fn => fn({ data: { __tt: 1, type, ...data } }));
  return { g, ui, audio, sent, command, query: g.motionQuery, updates: () => updates, resizes: () => resizes, networkHandlers };
}

test('embed ready publishes the registry and cal/settings/slowmo/status do not wake a sleeping arena', () => {
  const f = embedFixture(); assert.equal(f.sent.find(m => m.type === 'ready').calibrationRegistry.length, 17);
  f.command('sleep'); f.command('cal', { k: 'flytime', v: 0, requestId: 1 });
  f.command('settings', { sound: true, audioLevels: { master: 0 }, quality: 'mid', requestId: 2 });
  f.command('settings', { audioLevels: { effects: 0 }, quality: 'mid' });
  f.command('settings', { quality: '__proto__' }); f.command('quality', { q: '__proto__' });
  assert.equal(f.resizes(), 1); assert.equal(f.g.settings.quality, 'medium');
  f.command('slowmo', { on: true }); f.command('net', { cmd: 'status' }); f.g.update(.016);
  assert.equal(f.updates(), 0); assert.equal(f.sent.some(m => m.type === 'awake'), false);
  assert.equal(f.g._cal.flytime, 0); assert.equal(f.audio.levels.master, 0); assert.equal(f.audio.muted, false);
  f.command('wake'); f.g.update(.016); assert.equal(f.updates(), 1); assert.equal(f.sent.filter(m => m.type === 'awake').length, 1);
});

test('embed ranked policy preserves requests, ignores obsolete match hint and acknowledges rejected inspector', () => {
  const f = embedFixture();
  f.command('settings', { calibrations: { flytime: 0, captureK: 100 }, hint: false, audioLevels: { master: 0 }, requestId: 1 });
  f.command('match', { sessionKind: 'ranked', hint: true, diff: 1 }); f.command('slowmo', { on: true });
  const ack = f.sent.findLast(m => m.type === 'slowmo');
  assert.equal(f.g._cal.flytime, 0); assert.equal(f.g._cal.captureK, 1); assert.equal(f.g._calEffective.flytime, .5); assert.equal(f.g._calEffective.captureK, .5);
  assert.equal(f.g.hintRequested, false); assert.equal(f.g.hintContact, false); assert.equal(f.g.settings.hint, false); assert.equal(f.audio.levels.master, 0);
  assert.equal(ack.requested, true); assert.equal(ack.allowed, false); assert.equal(ack.on, false);
  for (let i = 0; i < 4; i++) f.g.awardPoint(-1);
  assert.equal(f.g.hintContact, false); assert.equal(f.sent.some(m => m.type === 'autoHint' && m.on), false);
});

test('automatic training check stage refreshes effective policy without erasing saved pace/capture', () => {
  const f = embedFixture(); f.command('cal', { values: { flytime: 0, captureK: 100 } }); f.command('train', { mode: 'course', sessionKind: 'practice', requestId: 3 });
  f.g.training.stage = 'check'; f.g.update(.016);
  const check = f.sent.findLast(m => m.type === 'calibration').calibration;
  assert.equal(check.sessionKind, 'check'); assert.equal(check.pace, 1); assert.equal(f.g._capCalK, 1);
  assert.equal(f.g._cal.flytime, 0); assert.equal(f.g._cal.captureK, 1);
  f.g.training.stage = 'practice'; f.g.update(.016);
  assert.equal(f.sent.findLast(m => m.type === 'calibration').calibration.pace, 1); assert.equal(f.g._capCalK, 1.3);
});

test('embed stores requested motionOff and propagates OS OR user motion to Game and UI', () => {
  const f = embedFixture(); f.query.matches = true; f.command('rm', { on: false });
  assert.equal(f.g.motionOff, false); assert.equal(f.g.reducedMotion, true); assert.equal(f.ui.reducedMotion, true);
  f.query.matches = false; f.command('rm', { on: true });
  assert.equal(f.g.motionOff, true); assert.equal(f.g.reducedMotion, true); assert.equal(f.ui.reducedMotion, true);
});

test('engine attempt signatures use the same actual capture radius as host comparisons', () => {
  const f = embedFixture(); f.command('cal', { k: 'captureK', v: 100 });
  f.g.onPressZone({ pointerType: 'touch', accepted: true, pointerX: 1, pointerY: 1, x: 1, y: 1, pressX: .1, pressY: .1, vw: 390, vh: 844 }, { t: .1 }, false);
  f.g.awardPoint(-1);
  assert.equal(f.sent.findLast(m => m.type === 'attempt').sig, '48/120/150/0.26');
});

function audioFixture(raw) {
  const sources = [], gains = [];
  const param = () => ({ value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  const source = () => { const s = { ...node(), frequency: param(), starts: [], stops: [], start(t) { this.starts.push(t); }, stop(t) { this.stops.push(t); } }; sources.push(s); return s; };
  class AudioContext {
    constructor() { this.currentTime = 1; this.sampleRate = 16; this.state = 'running'; this.destination = node(); }
    createGain() { const gain = { ...node(), gain: param() }; gains.push(gain); return gain; }
    createDynamicsCompressor() { return { ...node(), threshold: param(), ratio: param() }; }
    createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
    createOscillator() { return source(); }
    createBufferSource() { return source(); }
    createBiquadFilter() { return { ...node(), frequency: param(), Q: param() }; }
  }
  const context = vm.createContext({ window: { AudioContext }, localStorage: storage({ v: 8, ...raw }), structuredClone, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(stateSource + '\n' + audioSource + '\n;globalThis.api = { S, Sfx };', context);
  return { ...context.api, sources, gains };
}

test('shell mute cancels already queued effects immediately and unmute cannot revive them', () => {
  const f = audioFixture(); f.Sfx.win(); assert.equal(f.sources.length, 10);
  f.S.sfx = false; f.Sfx.sync(); assert.equal(f.gains[0].gain.value, 0);
  assert.ok(f.sources.every(source => source.stops.length === 2 && source.stops.at(-1) === undefined && source.disconnected && source.onended === null));
  f.Sfx.tap(); assert.equal(f.sources.length, 10);
  f.S.sfx = true; f.Sfx.sync(); assert.equal(f.sources.length, 10); assert.equal(f.gains[0].gain.value, .55 * .8 * .9);
  f.Sfx.tap(); assert.equal(f.sources.length, 11);
});

test('master/effects zero before or after unlock stays zero and prevents shell sound playback', () => {
  const f = audioFixture({ audioLevels: { master: 0, effects: .9, music: .25, ambient: .2 } });
  f.Sfx.unlock(); f.Sfx.tap(); assert.equal(f.gains[0].gain.value, 0); assert.equal(f.sources.length, 0);
  f.S.sfx = false; f.Sfx.sync(); f.S.sfx = true; f.Sfx.sync(); assert.equal(f.gains[0].gain.value, 0);
  f.S.audioLevels.master = .8; f.Sfx.win(); assert.equal(f.sources.length, 10);
  f.S.audioLevels.effects = 0; f.Sfx.sync(); assert.equal(f.gains[0].gain.value, 0); assert.ok(f.sources.every(source => source.stops.length === 2));
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.className = ''; this.events = {}; this.textContent = ''; }
  set value(value) { this._value = String(value); } get value() { return this._value || ''; }
  setAttribute(key, value) { this.attrs[key] = String(value); if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  replaceChildren() { this.children.forEach(child => { child.parentNode = null; }); this.children = []; }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    if (selector.startsWith('#')) return this.attrs.id === selector.slice(1);
    const match = selector.match(/^(\w+)?\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);
    if (!match) return selector === this.tag;
    if (match[1] && match[1] !== this.tag) return false;
    const key = match[2].startsWith('data-') ? match[2].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()) : match[2];
    const attrs = match[2].startsWith('data-') ? this.dataset : this.attrs;
    return Object.hasOwn(attrs, key) && (match[3] === undefined || attrs[key] === match[3]);
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let el = this; el; el = el.parentNode) if (el.matches(selector)) return el; return null; }
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  dispatch(type, target) { (this.events[type] || []).forEach(fn => fn({ target })); }
  get isConnected() { return !!this.parentNode; }
  set innerHTML(html) {
    if (!html.startsWith('<div class="cal-t">')) throw new Error('Unexpected test markup');
    const title = new Element('div'); title.className = 'cal-t'; title.appendChild(new Element('b'));
    for (const key of ['data-cal-description', 'data-cal-effective']) { const note = new Element('small'); note.setAttribute(key, ''); title.appendChild(note); }
    const control = new Element('div'); control.className = 'cal-c'; control.appendChild(new Element('input'));
    const value = new Element('span'); value.className = 'cal-v num'; control.appendChild(value); this.append(title, control);
  }
}
function settingsFixture(raw = {}) {
  const root = new Element('div'), view = root.appendChild(new Element('div')), messages = [], audioEvents = [], subs = new Set(), segments = new Map();
  const add = (tag, attribute, value = '') => { const el = new Element(tag); el.setAttribute(attribute, value); return view.appendChild(el); };
  const audioList = add('div', 'data-audio-list'); audioList.className = 'cal-list'; audioList.textContent = 'audio must remain';
  for (const key of ['master', 'effects', 'music', 'ambient']) { add('input', 'data-audio', key); add('span', 'data-audiov', key); }
  for (const key of ['data-cal-list', 'data-cal-summary', 'data-motion-state', 'data-hint-state', 'data-audio-state', 'data-miss-stat', 'data-miss-storage', 'data-miss-error']) add('div', key);
  const reset = add('button', 'data-a', 'calReset'); add('select', 'data-miss-size'); add('button', 'data-a', 'missClear');
  for (const id of ['qseg', 'dseg', 'langseg']) add('div', 'id', id);
  const grid = add('div', 'data-grid'); grid.className = 'miss-grid';
  const query = { matches: false }, document = { addEventListener() {}, createElement: tag => new Element(tag), getElementById: id => view.querySelector('#' + id) };
  let api, cleanup, opens = 0, localizations = 0;
  const host = { frame: {}, ready: false, calibrationReady: false, calibrationRegistry: [], calibration: null, calibrationRequestId: 0, calibrationAckId: 0, debug: false,
    on(fn) { subs.add(fn); return () => subs.delete(fn); }, ensure() {},
    send(type, data) { if (type === 'cal') this.calibrationRequestId++; messages.push({ type, ...plain(data) }); },
    syncSettings() { audioEvents.push('host'); messages.push({ type: 'settings', audioLevels: plain(api.S.audioLevels) }); },
    setDebug(on) { return this.debug = on; } };
  const context = vm.createContext({ document, window: { matchMedia: () => query, addEventListener() {} }, localStorage: storage({ v: 8, ...raw }),
    structuredClone, setTimeout: () => 1, clearTimeout() {}, clamp, I18n: { lang: 'ru', LANGS: [], setLang() {} },
    GameHost: host, Art: { icon: () => '' }, DIFFS: [{ id: 1, tk: 'diff.medium' }], diffOf: () => ({ sk: 'diff.hint' }),
    t: key => key, $: (selector, w) => w.querySelector(selector), UI: { seg(el, callback) { if (el) segments.set(el.attrs.id, callback); } },
    Sfx: { soft() {}, sync() { audioEvents.push('sync'); } }, haptic() {}, toast() {},
    MissShots: { all: () => [], storage: 'local', captureError: null },
    Router: { refreshLocale() { localizations++; return true; } },
    Sheet: { open(html, { onOpen }) {
      if (cleanup) cleanup(); opens++;
      const list = view.querySelector('[data-cal-list]'); list.replaceChildren(); delete list.dataset.keys;
      cleanup = onOpen(view);
    } } });
  vm.runInContext(stateSource + '\n' + calSource + '\n' + settingsSource + '\n;globalThis.api = { S, openSettings, refreshSettingsCalibration, applyGameCalibrations, calibrationState, CALIBRATION_REGISTRY };', context);
  api = context.api;
  const g = { settings: {}, sessionKind: 'free', slowmo: { allowed: true } };
  host.calibrationRegistry = api.CALIBRATION_REGISTRY; host.calibration = api.applyGameCalibrations(g, api.S.cal);
  return { ...api, g, host, view, reset, query, messages, audioEvents, subs, audioList, segments,
    close: () => cleanup && cleanup(), opens: () => opens, localizations: () => localizations,
    useActualI18n() { vm.runInContext(i18nSource + '\nI18n.add("ru", {}); I18n.add("en", {});', context); } };
}

test('settings never presents calibrations as applied before ready/ack and rebuilds after recovery', () => {
  const f = settingsFixture(); f.refreshSettingsCalibration(f.view);
  assert.equal(f.view.querySelectorAll('input[data-cal]').length, 0); assert.equal(f.reset.disabled, true);
  f.host.ready = true; f.refreshSettingsCalibration(f.view); assert.equal(f.view.querySelectorAll('input[data-cal]').length, 0);
  f.host.calibrationReady = true; f.refreshSettingsCalibration(f.view);
  assert.equal(f.view.querySelectorAll('input[data-cal]').length, 9); assert.equal(f.reset.disabled, false);
  const speed = f.view.querySelector('[data-calrow="camZoom"]');
  assert.equal(speed.querySelector('input').step, 'any'); assert.equal(+speed.querySelector('input').value, 50);
  assert.equal(speed.querySelector('.cal-v').textContent, '1.00x'); assert.equal(f.audioList.textContent, 'audio must remain');
  f.host.ready = false; f.host.calibrationReady = false; f.refreshSettingsCalibration(f.view);
  f.host.ready = true; f.host.calibrationReady = true; f.refreshSettingsCalibration(f.view);
  assert.equal(f.view.querySelectorAll('input[data-cal]').length, 9);
});

test('settings hides physics and simulation pace while retaining player preferences', () => {
  const f = settingsFixture({ cal: { flytime: 0, captureK: 100 } }); f.g.sessionKind = 'ranked';
  f.host.ready = f.host.calibrationReady = true; f.host.calibration = f.applyGameCalibrations(f.g, f.S.cal); f.refreshSettingsCalibration(f.view);
  for (const key of ['flytime', 'captureK', 'spinGain', 'padSpeed', 'slowmoDepth']) assert.equal(f.view.querySelector(`[data-calrow="${key}"]`), null);
  for (const key of ['camZoom', 'camHeight', 'trailLen', 'hintRadius']) assert.ok(f.view.querySelector(`[data-calrow="${key}"]`));
  assert.equal(f.S.cal.flytime, 0); assert.equal(f.S.cal.captureK, 100);
});

test('check-stage hint restrictions describe training hints, not the inspector', () => {
  const f = settingsFixture(); f.g.training = { stage: 'check' };
  f.host.ready = f.host.calibrationReady = true; f.host.calibration = f.applyGameCalibrations(f.g, {}); f.refreshSettingsCalibration(f.view);
  const row = f.view.querySelector('[data-calrow="hintRadius"]'), note = row.querySelector('[data-cal-effective]').textContent;
  assert.equal(row.querySelector('input').disabled, true); assert.match(note, /Учебные подсказки/); assert.doesNotMatch(note, /Инспектор/);
});

test('settings reset sends all registry defaults in one packet and never resets sound, inventory or mastery', () => {
  const f = settingsFixture({ cal: { flytime: 0, captureK: 100 }, audioLevels: { master: 0, effects: .2, music: 0, ambient: .1 },
    owned: ['r-earned'], coins: 721, tutorialRewarded: true,
    training: { version: 1, lessons: { TOPSPIN: { mastered: true, practiced: true, attempts: 7, correct: 6 } }, lastLesson: 'TOPSPIN' } });
  f.host.ready = f.host.calibrationReady = true; const before = plain(f.S); delete before.cal;
  f.openSettings(); f.view.dispatch('click', f.reset);
  const after = plain(f.S); delete after.cal; assert.deepEqual(after, before);
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].type, 'cal'); assert.equal(Object.keys(f.messages[0].values).length, 17);
  for (const entry of f.CALIBRATION_REGISTRY) assert.equal(f.messages[0].values[entry.key], entry.default);
  assert.match(f.view.querySelector('[data-calrow="camZoom"]').querySelector('[data-cal-effective]').textContent, /подтверждения/);
});

test('volume slider saves explicit zero, updates the old stored alias and synchronizes mute before host traffic', () => {
  const f = settingsFixture({ volume: .2 }); f.host.ready = f.host.calibrationReady = true; f.openSettings();
  const input = f.view.querySelector('input[data-audio="master"]'); input.value = '0'; f.view.dispatch('input', input);
  assert.equal(f.S.audioLevels.master, 0); assert.equal(f.S.volume, 0); assert.deepEqual(f.audioEvents.slice(-2), ['sync', 'host']);
  assert.equal(f.messages.at(-1).audioLevels.master, 0); assert.match(f.view.querySelector('[data-audio-state]').textContent, /0%/);
});

test('closing a settings sheet synchronously releases its host subscription without waiting for engine messages', () => {
  const f = settingsFixture(); f.openSettings(); assert.equal(f.subs.size, 1);
  f.close(); assert.equal(f.subs.size, 0);
});

test('current locale callback replaces the settings sheet without resuming or restarting a paused live session', () => {
  const f = settingsFixture({ cal: { flytime: 0 }, coins: 721 }); f.useActualI18n();
  f.host.ready = f.host.calibrationReady = f.host.paused = true; f.openSettings();
  const before = plain(f.S); delete before.lang; f.segments.get('langseg')('en');
  const after = plain(f.S); delete after.lang;
  assert.equal(f.S.lang, 'en'); assert.equal(f.host.paused, true); assert.equal(f.opens(), 2); assert.equal(f.localizations(), 1);
  assert.equal(f.subs.size, 1); assert.deepEqual(f.messages.map(m => m.type), ['locale']); assert.deepEqual(after, before);
});

test('reopening settings retains a saved but unacknowledged slider position and reports it as pending', () => {
  const f = settingsFixture(); f.host.ready = f.host.calibrationReady = true; f.openSettings();
  const input = f.view.querySelector('[data-calrow="camZoom"]').querySelector('input'); input.value = '0'; f.view.dispatch('input', input);
  f.openSettings(); const row = f.view.querySelector('[data-calrow="camZoom"]');
  assert.equal(row.querySelector('input').value, '0'); assert.match(row.querySelector('[data-cal-effective]').textContent, /подтверждения/);
  f.host.calibration = f.applyGameCalibrations(f.g, f.S.cal); f.host.calibrationAckId = f.host.calibrationRequestId;
  f.refreshSettingsCalibration(f.view, { requestId: f.host.calibrationRequestId });
  assert.equal(row.querySelector('.cal-v').textContent, '0.60x'); assert.equal(row.querySelector('[data-cal-effective]').hidden, true);
});

test('camera gesture preferences update the host and are sent on the next session', () => {
  const f = hostFixture(); f.ready();
  f.message({type: 'settings', requestId: f.GameHost.calibrationRequestId, calibration: plain(f.snapshot())});
  const state = plain(f.applyGameCalibrations({settings: {}, sessionKind: 'free', slowmo: {allowed: true}}, {camHeight: 75, camZoom: 80}));
  f.message({type: 'cameraCalibration', values: {camHeight: 75, camZoom: 80, captureK: 100}, calibration: state});
  assert.equal(f.S.cal.camHeight, 75); assert.equal(f.S.cal.camZoom, 80); assert.equal(f.S.cal.captureK, undefined);
  assert.equal(f.GameHost.calibration.raw.camZoom, 80);
  f.GameHost.syncSettings();
  const packet = f.sent.findLast(m => m.type === 'settings');
  assert.equal(packet.calibrations.camHeight, 75); assert.equal(packet.calibrations.camZoom, 80);
});
