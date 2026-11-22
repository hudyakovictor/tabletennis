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
  const entries = new Map([['ttu-v2', JSON.stringify(raw ?? null)]]), writes = [];
  return { entries, writes, getItem: key => entries.get(key) ?? null,
    setItem(key, value) { writes.push({ key, value }); entries.set(key, value); }, removeItem: key => entries.delete(key) };
}
function classes() {
  const values = new Set();
  return { contains: key => values.has(key), add: key => values.add(key), remove: key => values.delete(key),
    toggle(key, on) { if (on === undefined) on = !values.has(key); on ? values.add(key) : values.delete(key); return on; } };
}
const academyCatalog = { version: 1, skills: [{ id: 'tap' }, { id: 'LOOP' }],
  lessons: [{ id: 'CONTACT', skills: ['tap'] }, { id: 'TOPSPIN', skills: ['LOOP'] }] };
const masteredTraining = { version: 1, lastLesson: 'CONTACT', lessons: {
  CONTACT: { mastered: true, practiced: true, attempts: 7, correct: 6 },
  TOPSPIN: { mastered: true, practiced: true, attempts: 7, correct: 6 } } };
const trainSnapshot = (requestId, overrides = {}) => ({ type: 'train', requestId, sessionId: 'host-training', mode: 'course',
  id: 'CONTACT', stage: 'practice', phase: 'intro', attempts: 0, practicePassed: false, quizPassed: false,
  attemptReplay: { available: false, attemptId: null, truncated: false }, ...overrides });

function hostFixture(raw = {}) {
  const sent = [], frames = [], listeners = [], motionListeners = [];
  const localStorage = storage({ v: 8, ...raw });
  const query = { matches: false, addEventListener(type, fn) { motionListeners.push(fn); } };
  const layer = { classList: classes(), appendChild() {} }, body = { classList: classes() };
  const document = { body, querySelectorAll: () => [], addEventListener() {},
    createElement() { const frame = { contentWindow: { postMessage(m) { sent.push(plain(m)); } }, setAttribute() {}, remove() {} }; frames.push(frame); return frame; } };
  const window = { addEventListener(type, fn) { if (type === 'message') listeners.push(fn); }, matchMedia: () => query };
  const context = vm.createContext({ window, document, localStorage, sessionStorage: storage(null),
    structuredClone, URLSearchParams, console, clamp, setTimeout: () => 1, clearTimeout() {},
    location: { search: '', href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:' },
    I18n: { lang: 'ru' }, t: (key) => key, TGX: { w: null }, MODE: { id: 'ranked' }, Sfx: { sync() {} },
    GAME_HTML: '<head></head>', $: selector => selector === '#gamelayer' ? layer : null,
    matchMedia: () => ({ matches: false, addEventListener() {} }) });
  vm.runInContext(stateSource + '\n' + calSource + '\n' + hostSource + '\n;globalThis.api = { S, GameHost, ZoneStats, applyGameCalibrations, calibrationState };', context);
  const api = context.api; api.GameHost.ensure();
  const message = (data, source = api.GameHost.frame.contentWindow) => listeners.forEach(fn => fn({ data: { __tt: 1, ...data }, source }));
  const registry = vm.runInContext('CALIBRATION_REGISTRY', context);
  const ready = (preferences = {}, trainingCatalog = { version: 1, lessons: [] }) => message({ type: 'ready', rules: { captureRadius: .2 }, calibrationRegistry: plain(registry), calibrationPreferences: preferences, trainingCatalog });
  const snapshot = () => api.applyGameCalibrations({ settings: {}, sessionKind: api.GameHost.sessionKind, slowmo: { allowed: true } }, api.S.cal);
  return { ...api, sent, frames, ready, message, snapshot, body, query, motionListeners, localStorage };
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

test('ready and iframe reload resync current owned racket selection before mode, not stale equipment packets', () => {
  const f = hostFixture({ v: 9, owned: ['r-pan', 'r-void'], equipped: { racket: 'r-pan', rubber: 'r-void', trail: 't-gold', table: 'tb-neon' } });
  f.GameHost.send('equip', { equipped: { racket: 'r-standard', table: 'tb-neon' } });
  f.GameHost.send('train', { mode: 'course' }); f.ready();
  const packets = f.sent.filter(m => m.type === 'equip');
  assert.equal(packets.length, 1); assert.deepEqual(packets[0].equipped, { racket: 'r-pan' });
  assert.ok(f.sent.indexOf(packets[0]) < f.sent.findIndex(m => m.type === 'train'));
  assert.deepEqual(plain(f.S.owned), ['r-standard', 'r-pan']);
  f.S.equipped.racket = 'r-standard'; f.GameHost.reload();
  f.GameHost.send('equip', { equipped: { racket: 'r-pan', trail: 't-gold' } }); f.ready();
  assert.deepEqual(f.sent.findLast(m => m.type === 'equip').equipped, { racket: 'r-standard' });
  const unowned = hostFixture({ v: 9, owned: ['r-void'], equipped: { racket: 'r-pan', table: 'tb-neon' } });
  unowned.GameHost.send('equip', { equipped: { racket: 'r-pan' } }); unowned.ready();
  assert.deepEqual(unowned.sent.findLast(m => m.type === 'equip').equipped, { racket: 'r-standard' });
  assert.deepEqual(plain(unowned.S.owned), ['r-standard']);
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

function matchHudSnapshot(seq = 1) {
  return { schema: 1, matchId: 'match-test', seq, rallyId: 2, visible: true, free: false, staminaEnabled: true,
    phase: 'RALLY', score: [7, 7], target: 11, server: 1, rally: 3, paused: false, matchPoint: 0,
    players: [{ side: 1, energy: 48, capacity: 70, fatigue: 30, limited: true },
      { side: -1, energy: 56, capacity: 80, fatigue: 20, limited: false }],
    contacts: [null, null], whiffs: [null, null], event: null, result: null };
}

test('match snapshots reject a different frame, stale sequence, old request and malformed resources', () => {
  const f = hostFixture(); f.ready(); f.GameHost.send('match', { sessionKind: 'ranked' });
  const received = []; f.GameHost.on(m => { if (m.type === 'hud') received.push(m); });
  const hud = (snapshot, hudRequestId = f.GameHost.hudRequestId, source) => f.message({ type: 'hud', snapshot, hudRequestId }, source);
  hud(matchHudSnapshot(), undefined, {}); assert.equal(received.length, 0);
  hud(matchHudSnapshot()); assert.equal(received.length, 1);
  hud(matchHudSnapshot()); hud(matchHudSnapshot(0)); hud(matchHudSnapshot(2), f.GameHost.hudRequestId - 1);
  assert.equal(received.length, 1);
  const invalid = matchHudSnapshot(2); invalid.players[0].energy = 90;
  hud(invalid); assert.equal(received.length, 1);
  const fresh = matchHudSnapshot(2); hud(fresh); fresh.players[0].energy = 0;
  assert.equal(f.GameHost.matchSnapshot.players[0].energy, 48, 'cache is detached from incoming data');
  assert.equal(received.length, 2);
  f.GameHost.send('quit'); hud(matchHudSnapshot(3)); assert.equal(received.length, 2);
  f.GameHost.send('match', { sessionKind: 'practice' });
  const next = matchHudSnapshot(); next.matchId = 'next-match'; hud(next);
  assert.equal(f.GameHost.matchSnapshot.matchId, 'next-match');
});

test('the engine is the stroke palette source and invalid catalog entries are discarded', () => {
  const f = hostFixture(); f.message({ type: 'ready', strokeCatalog: [
    { id: 'LOOP', col: '#44aaff' }, { id: 'SERVE_TOP', col: '#44aaff' },
    { id: 'LOOP', col: '#ffffff' }, { id: 'BAD', col: 'url(javascript:bad)' }, { id: '__proto__', col: '#ffffff' }
  ] });
  assert.deepEqual(plain(f.GameHost.strokeCatalog), [{ id: 'LOOP', col: '#44aaff' }, { id: 'SERVE_TOP', col: '#44aaff' }]);
});

test('GPU recovery and an explicit iframe reload carry the full checkpoint, never just score', () => {
  const f = hostFixture(); f.ready(); f.GameHost.send('match', { sessionKind: 'ranked' });
  const checkpoint = { schema: 1, matchId: 'recovered', score: [7, 7], server: -1,
    players: [{ energy: 23, fatigue: 30, regenDelayRemaining: .31, low: true },
      { energy: 49, fatigue: 18, regenDelayRemaining: .09, low: false }], recoveredPointId: 13 };
  f.GameHost.frame.contentWindow.__game = { captureMatchResume: () => checkpoint };
  f.GameHost.send('pause'); f.GameHost.reload(); f.ready();
  assert.deepEqual(f.sent.findLast(m => m.type === 'match').resume, checkpoint);
  assert.equal(f.sent.at(-1).type, 'pause');
  checkpoint.players[0].energy = 0;
  assert.equal(f.GameHost.matchResume.players[0].energy, 23);
  f.GameHost.recover({ inMatch: true, resume: f.GameHost.matchResume, score: [7, 7], server: -1 }); f.ready();
  assert.equal(f.sent.findLast(m => m.type === 'match').resume.players[0].energy, 23);
  assert.equal(f.sent.findLast(m => m.type === 'match').resume.players[0].regenDelayRemaining, .31);
});

test('shell OS listener keeps effective reduced motion active while requested rm stays independent', () => {
  const f = hostFixture({ rm: true }); f.ready(); f.query.matches = false; f.motionListeners[0]({ matches: false });
  assert.equal(f.body.classList.contains('rm'), true); assert.equal(f.S.rm, true);
  assert.equal(f.sent.at(-1).type, 'rm'); assert.equal(f.sent.at(-1).on, true);
  f.S.rm = false; f.query.matches = true; f.motionListeners[0]({ matches: true });
  assert.equal(f.body.classList.contains('rm'), true); assert.equal(f.S.rm, false); assert.equal(f.sent.at(-1).on, false);
});

function embedFixture() {
  const sent = [], listeners = [], networkHandlers = new Map(), glListeners = [], trainStarts = [], previewOpens = [], previewCommands = [], pauses = [];
  let updates = 0, resizes = 0, captureCancels = 0, trainSequence = 0;
  const audio = { levels: { master: .8, effects: .9, music: .25, ambient: .2 }, muted: false, init() {}, resume() {},
    setMuted(on) { this.muted = on; }, setQuiet(on) { this.quiet = on; },
    setLevels(raw) { for (const key of Object.keys(this.levels)) if (Number.isFinite(raw[key])) this.levels[key] = clamp(raw[key], 0, 1); this.volume = this.levels.master; return { ...this.levels }; } };
  const ui = { inputMode: 'mouse', tick() {}, trainSync() {}, trainDone() {}, trainHide() {}, syncShotFeedback() {}, syncScore() {} };
  const g = { ui, audio, settings: { targetScore: 11, difficulty: 1, showTrail: true, quality: 'medium' }, sessionKind: 'free',
    time: 0, strokeTime: 0, timeScale: 1, state: 3, server: 1, score: [0, 0], shotId: 1, paused: false,
    hintContact: true, motionQuery: { matches: false }, slowmo: { allowed: true }, career: { active: false }, R: {},
    ball: { hist: [], live: true, lastHitBy: -1 }, rallyBounces: [1], scene: { mat: { table: { color: [0, 0, 0] } } },
    network: { state: 'LOBBY', isInMatch: false, on(type, fn) { networkHandlers.set(type, fn); }, leaveRoom() {}, disconnect() {} },
    swipe: {}, updateCamera() {}, update() { return ++updates; }, render() {}, resize() { resizes++; }, awardPoint() {},
    startMatch(diff) { this.settings.difficulty = diff; this.training = null; this.slowmo.allowed = true; },
    setAiTrend() {}, trendFromHistory() {},
    setInspectSlowmo(on) { this.inspectSlowmo = on && this.slowmo.allowed; return this.inspectSlowmo; },
    startTraining(m) {
      this.training?.quit(); trainStarts.push(plain(m));
      this.training = { mode: m.mode || 'course', stage: 'practice', phase: 'intro', finished: false,
        sessionId: 't' + (++trainSequence), revision: 0, options: m, step: 0, S: { id: m.lessonId || 'CONTACT' },
        attempts: 0, done: 0, practicePassed: false, quizPassed: false, attemptClip: null,
        action() { return false; }, skip() { return false; },
        quit() { this.finished = true; this.attemptClip = null; g.training = null; g.ball.live = false; },
        snapshot() { return { sessionId: this.sessionId, mode: this.mode, id: this.S.id, stage: this.stage, phase: this.phase,
          attempts: this.attempts, practicePassed: this.practicePassed, quizPassed: this.quizPassed,
          attemptReplay: { available: !!this.attemptClip, attemptId: this.attemptClip?.attemptId ?? null, truncated: !!this.attemptClip?.truncated } }; },
        summary() { return { sessionId: this.sessionId, mode: this.mode, courseComplete: false, practiceSet: this.practiceSet }; } };
    },
    setPaused(v) { pauses.push(v); this.paused = v; }, syncAudioQuiet() {} };
  g.preview = { active: false, error: null,
    open(options) { previewOpens.push(plain(options)); this.options = options; this.error = null; this.savedPause = g.paused; this.active = true; return true; },
    close(restore = true) { if (!this.active) return false; this.active = false; if (restore) g.paused = this.savedPause; return true; },
    command(command, value) { previewCommands.push({ command, value }); return true; },
    snapshot() { return { source: this.options?.source || 'example', active: this.active }; }, localize() {} };
  g.openTrainingPreview = options => g.preview.open(options);
  const window = { __TT_EMBED: true, __game: g, parent: { postMessage(m) { sent.push(plain(m)); } }, addEventListener(type, fn) { if (type === 'message') listeners.push(fn); } };
  const document = { readyState: 'complete', visibilityState: 'visible', addEventListener() {}, documentElement: { classList: classes() },
    getElementById: id => id === 'gl' ? { addEventListener(type, fn) { if (type === 'webglcontextlost') glListeners.push(fn); } } : null };
  const ET = key => key; ET.lang = () => 'ru'; ET.set = () => {};
  const context = vm.createContext({ window, document, clamp, ET, setTimeout: () => 1, clearTimeout() {},
    PH: { TABLE_Y: .76 }, GS: { MENU: 0, SERVE_READY: 1, SERVE_TOSS: 2, RALLY: 3, POINT: 4 },
    MATCH_RULES: { version: 4, captureRadius: .2, contactSideTouchPx: 48, contactSideMousePx: 40, contactBackPx: 120, contactForwardPx: 150 },
    TRAIN_STEPS: [], trainingCatalog: () => ({ version: 1, lessons: [] }),
    createMissShotCapture: () => ({ setEnabled() {}, setHalf() {}, getHalf: () => 350, request: () => null, cancel() { captureCancels++; }, fail() {} }),
    V3: {}, TAU: Math.PI * 2 });
  vm.runInContext(calSource + '\napplyGameCalibrations(window.__game, {});\n' + embedSource, context);
  const command = (type, data, source = window.parent) => listeners.forEach(fn => fn({ source, data: { __tt: 1, type, ...data } }));
  const loseContext = () => { let prevented = false; glListeners.forEach(fn => fn({ preventDefault() { prevented = true; } })); return prevented; };
  return { g, ui, audio, sent, command, loseContext, trainStarts, previewOpens, previewCommands, pauses,
    captureCancels: () => captureCancels, query: g.motionQuery, updates: () => updates, resizes: () => resizes, networkHandlers };
}

test('the common confirmed-contact record publishes one legacy hit and whiffs do not publish hits', () => {
  const f = embedFixture(); f.command('match', { hudRequestId: 8 });
  const snapshot = matchHudSnapshot();
  snapshot.contacts[0] = { matchId: snapshot.matchId, rallyId: 2, eventId: 5, swingId: 3, side: 1,
    stroke: 'BLOCK', kmh: 27.8, rps: 21, quality: .30, sweet: .72, energy: 48, capacity: 70, limited: true, x: .24, y: .62 };
  snapshot.event = { id: 5, type: 'hit', side: 1 };
  f.g.onMatchHud(snapshot); f.g.onMatchHud(snapshot);
  const hits = f.sent.filter(m => m.type === 'hit');
  assert.equal(hits.length, 1); assert.equal(hits[0].sweet, .72); assert.equal(hits[0].stroke, 'BLOCK');
  assert.equal(hits[0].kmh, 28); assert.equal(hits[0].x, .24);
  assert.equal(f.sent.findLast(m => m.type === 'hud').hudRequestId, 8);
  snapshot.seq++; snapshot.event = { id: 6, type: 'whiff', side: -1 }; f.g.onMatchHud(snapshot);
  assert.equal(f.sent.filter(m => m.type === 'hit').length, 1);
  snapshot.contacts[1] = { ...snapshot.contacts[0], eventId: 7, side: -1, stroke: 'LOOP', sweet: 0 };
  snapshot.event = { id: 7, type: 'hit', side: -1 }; f.g.onMatchHud(snapshot);
  assert.equal(f.sent.filter(m => m.type === 'hit').length, 2);
  assert.equal(f.sent.findLast(m => m.type === 'hit').by, -1);
});

test('embed recovery passes the checkpoint atomically without another prepServe or score rewrite', () => {
  const f = embedFixture(), calls = [], resume = { schema: 1, matchId: 'same-match', score: [7, 7], server: -1 };
  f.g.startMatch = (diff, state) => { calls.push({ diff, state }); f.g.score = [8, 7]; return true; };
  f.g.prepServe = () => { throw Error('duplicate preparation after atomic restore'); };
  f.command('match', { diff: 2, resume });
  assert.deepEqual(plain(calls), [{ diff: 2, state: resume }]);
  assert.deepEqual(f.g.score, [8, 7], 'bridge cannot overwrite restored Game data');
  f.g.startMatch = () => false; f.command('match', { diff: 2, resume: { corrupt: true } });
  assert.equal(f.g.paused, true); assert.equal(f.sent.findLast(m => m.type === 'error').code, 'invalid_match_resume');
});

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
  assert.match(f.view.querySelector('[data-calrow="camZoom"]').querySelector('[data-cal-effective]').textContent, /согласовывает/);
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
  assert.equal(row.querySelector('input').value, '0'); assert.match(row.querySelector('[data-cal-effective]').textContent, /согласовывает/);
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

test('training commands own IDs and only the latest matching acknowledgement is delivered once without resume', () => {
  const f = hostFixture(); f.ready(); const requestId = f.GameHost.send('train', { mode: 'course' });
  assert.equal(requestId, 1); assert.deepEqual(plain(f.GameHost.trainingIntent), { requestId, data: { mode: 'course', sessionKind: 'practice' }, sessionId: null });
  f.message(trainSnapshot(requestId), {}); f.message(trainSnapshot(requestId, { __tt: 0 }));
  f.message(trainSnapshot(requestId - 1)); f.message(trainSnapshot(requestId, { sessionId: null }));
  assert.equal(f.GameHost.trainSessionId, null);
  f.message(trainSnapshot(requestId));
  assert.deepEqual(plain(f.GameHost.trainingIntent), { requestId, data: { mode: 'course', sessionKind: 'practice', lessonId: 'CONTACT' }, sessionId: 'host-training' });
  const received = []; f.GameHost.on(m => { if (m.type === 'trainActionAck') received.push(plain(m)); });
  f.GameHost.send('pause'); const first = f.GameHost.send('trainAction', { action: 'start', actionId: 999 });
  assert.equal(first, 1); assert.deepEqual(f.sent.at(-1), { __tt: 1, type: 'trainAction', action: 'start', actionId: first, requestId, sessionId: 'host-training' });
  assert.equal(f.GameHost.send('resume'), false); assert.equal(f.GameHost.paused, true);
  const current = f.GameHost.send('trainAction', { action: 'pacing', value: 'flow' });
  const ack = { type: 'trainActionAck', actionId: current, requestId, sessionId: 'host-training', accepted: true };
  f.message({ ...ack, actionId: first }); f.message(ack, {}); f.message({ ...ack, __tt: 0 });
  f.message({ ...ack, requestId: requestId - 1 }); f.message({ ...ack, sessionId: 'retired' }); f.message({ ...ack, accepted: 1 });
  assert.equal(received.length, 0); assert.equal(f.GameHost.paused, true);
  f.message(ack); f.message({ ...ack, accepted: false });
  assert.equal(received.length, 1); assert.equal(f.GameHost.mode.data.pacing, 'flow'); assert.equal(f.GameHost.trainingIntent.data.pacing, 'flow'); assert.equal(f.GameHost.paused, true);
  const rejected = f.GameHost.send('trainAction', { action: 'retry' });
  f.message({ ...ack, actionId: rejected, accepted: false });
  assert.equal(received.length, 2); assert.equal(received.at(-1).accepted, false); assert.equal(f.GameHost.paused, true);
  const skipped = f.GameHost.send('skipStep');
  assert.equal(skipped, rejected + 1); assert.deepEqual(f.sent.at(-1), { __tt: 1, type: 'skipStep', actionId: skipped, requestId, sessionId: 'host-training' });
  f.message({ ...ack, actionId: skipped }); assert.equal(received.length, 3);
  const stale = f.GameHost.send('trainAction', { action: 'start', requestId: 0, sessionId: 'retired' });
  assert.equal(f.sent.at(-1).requestId, 0, 'explicit stale identities must not be relabelled as current');
  f.message({ ...ack, actionId: stale, requestId: 0, sessionId: 'retired', accepted: false });
  assert.equal(received.length, 3); assert.equal(f.sent.some(m => m.type === 'resume'), false);
});

test('new training requests retire old snapshots, progress, completion and acknowledgements while course rewards stay one-time', () => {
  const f = hostFixture({ v: 10, coins: 713, gems: 9, training: masteredTraining }); f.ready({}, academyCatalog);
  const received = []; f.GameHost.on(m => { if (['train', 'trainingProgress', 'trainDone', 'trainActionAck'].includes(m.type)) received.push(plain(m)); });
  const oldId = f.GameHost.send('train', { mode: 'course', lessonId: 'CONTACT' }); f.message(trainSnapshot(oldId, { sessionId: 'old' }));
  const actionId = f.GameHost.send('trainAction', { action: 'continue' });
  const requestId = f.GameHost.send('train', { mode: 'course', lessonId: 'CONTACT' });
  assert.equal(requestId, oldId + 1); assert.equal(f.GameHost.trainSnapshot, null); assert.equal(f.GameHost._pendingTrainAction, null);
  const before = plain(f.S), count = received.length;
  const progress = { type: 'trainingProgress', requestId, sessionId: 'current', mode: 'course', id: 'CONTACT', stage: 'check',
    attempts: 4, correct: 3, validated: true, practicePassed: true, quizPassed: true,
    profile: { lessons: { CONTACT: { attempts: 99, correct: 99, mastered: true } } } };
  const done = { type: 'trainDone', requestId, sessionId: 'current', mode: 'course', courseComplete: true };
  f.message(trainSnapshot(oldId, { sessionId: 'old' })); f.message({ ...done, requestId: oldId, sessionId: 'old' });
  f.message({ ...done, sessionId: 'old' }); f.message({ type: 'trainActionAck', actionId, requestId: oldId, sessionId: 'old', accepted: true });
  f.message(trainSnapshot(requestId, { mode: 'stroke' })); f.message(trainSnapshot(requestId), {});
  assert.equal(received.length, count); assert.deepEqual(plain(f.S), before);
  f.message(trainSnapshot(requestId, { sessionId: 'current' }));
  f.message(trainSnapshot(requestId, { sessionId: 'old', phase: 'live' }));
  f.message(progress, {}); f.message({ ...progress, __tt: 0 }); f.message({ ...progress, requestId: oldId });
  f.message({ ...progress, sessionId: 'old' }); f.message({ ...progress, mode: 'stroke' });
  f.message({ ...done, requestId: oldId }); f.message({ ...done, sessionId: 'old' }); f.message(done, {});
  assert.deepEqual(plain(f.S), before); assert.equal(f.GameHost.trainSnapshot.sessionId, 'current');
  f.message(done); const rewarded = received.at(-1);
  assert.equal(rewarded.rewarded, true); assert.equal(rewarded.mastered, 2); assert.equal(rewarded.coverage, 100);
  assert.equal(f.S.coins, 913); assert.equal(f.S.gems, 14);
  const writes = f.localStorage.writes.length, completedCount = received.length;
  f.message(done); f.message(progress); f.message({ type: 'trainActionAck', actionId, requestId, sessionId: 'current', accepted: true });
  assert.equal(received.length, completedCount); assert.equal(f.localStorage.writes.length, writes); assert.equal(f.S.coins, 913);
  const repeatedId = f.GameHost.send('train', { mode: 'course' }); f.message(trainSnapshot(repeatedId, { sessionId: 'repeat' }));
  f.message({ ...done, requestId: repeatedId, sessionId: 'repeat' });
  assert.equal(received.at(-1).rewarded, false); assert.equal(f.S.coins, 913); assert.equal(f.S.gems, 14);
  f.GameHost.send('quit'); f.message({ ...done, requestId: repeatedId, sessionId: 'repeat' });
  assert.equal(f.GameHost.trainingIntent, null); assert.equal(f.S.coins, 913);
});

test('stroke and accuracy sets preserve their separate statistics and cannot import mastery, save or reward even a full-course profile', () => {
  for (const mode of ['stroke', 'accuracy']) for (const training of [undefined, masteredTraining]) {
    const f = hostFixture({ v: 10, coins: 713, gems: 9, xp: 251, level: 4, rating: 1420, passXp: 60,
      ...(training ? { training } : {}) }); f.ready({}, academyCatalog);
    const before = plain(f.S), writes = f.localStorage.writes.length, received = [];
    f.GameHost.on(m => { if (m.type === 'trainDone') received.push(plain(m)); });
    const requestId = f.GameHost.send('train', { mode, setSize: 10 }); f.message(trainSnapshot(requestId, { mode }));
    const evidence = { type: 'trainingProgress', requestId, sessionId: 'host-training', mode, id: 'CONTACT', stage: 'check', attempts: 4,
      correct: 4, validated: true, practicePassed: true, quizPassed: true, profile: masteredTraining };
    f.message(evidence); f.message({ ...evidence, mode: 'course' });
    const practiceSet = { size: 10, attempted: 10, successful: 6, bestStreak: 3,
      errors: [{ code: 'TIMING_EARLY', count: 4, correction: 'Wait for contact.' }] };
    const done = { type: 'trainDone', requestId, sessionId: 'host-training', mode, practiceSet,
      mastered: 2, total: 44, coverage: 100, mastery: { percent: 100 }, profile: masteredTraining, courseComplete: true, rewarded: true };
    f.message(done); f.message(done);
    assert.equal(received.length, 1); assert.deepEqual(received[0].practiceSet, practiceSet);
    assert.equal(received[0].rewarded, false); assert.equal(received[0].courseComplete, false);
    for (const key of ['mastered', 'total', 'coverage', 'mastery', 'profile']) assert.equal(Object.hasOwn(received[0], key), false, `${mode}: ${key}`);
    assert.deepEqual(plain(f.S), before); assert.equal(f.localStorage.writes.length, writes);
    assert.equal(f.S.v, 10); assert.deepEqual(Object.keys(f.S.training).sort(), ['lastLesson', 'lessons', 'version']);
  }
});

test('host preview identity is separate from training and stale controls, close events and unfinished checks cannot affect the new session', () => {
  const f = hostFixture(); f.ready(); f.GameHost.send('train', { mode: 'stroke' });
  const requestId = f.GameHost.send('train', { mode: 'stroke' });
  const settled = trainSnapshot(requestId, { mode: 'stroke', phase: 'fail', attemptReplay: { available: true, attemptId: 17, truncated: true } });
  f.message(settled); assert.equal(f.GameHost.openPreview({ source: 'attempt' }), true);
  const packet = f.sent.findLast(m => m.type === 'previewOpen');
  assert.notEqual(packet.requestId, requestId); assert.equal(packet.trainRequestId, requestId); assert.equal(packet.sessionId, settled.sessionId); assert.equal(packet.attemptId, 17);
  const received = []; f.GameHost.on(m => { if (m.type === 'preview') received.push(plain(m)); });
  const preview = { type: 'preview', requestId: packet.requestId, trainRequestId: requestId, sessionId: settled.sessionId, attemptId: 17, active: true, paused: true };
  f.message(preview, {}); f.message({ ...preview, __tt: 0 }); f.message({ ...preview, requestId });
  f.message({ ...preview, trainRequestId: requestId - 1 }); f.message({ ...preview, sessionId: 'old' });
  assert.equal(f.GameHost.preview.pending, true); assert.equal(received.length, 0);
  f.message(preview); assert.equal(f.GameHost.preview.active, true);
  f.GameHost.send('previewCommand', { command: 'rate', value: .25 }); assert.equal(f.sent.at(-1).requestId, packet.requestId);
  const count = f.sent.length;
  assert.equal(f.GameHost.send('previewCommand', { requestId, command: 'seek', value: 1 }), false);
  assert.equal(f.GameHost.send('previewClose', { requestId }), false); assert.equal(f.GameHost.send('resume'), false); assert.equal(f.sent.length, count);
  f.GameHost.closePreview(); assert.equal(f.sent.at(-1).requestId, packet.requestId);
  f.message({ ...preview, active: false }); f.message({ ...preview, active: false, paused: false });
  assert.equal(received.length, 2); assert.equal(f.GameHost.paused, true, 'a duplicate close cannot undo a pause');
  assert.equal(f.GameHost.openPreview({ source: 'attempt', attemptId: 16 }), false);
  assert.equal(f.GameHost.openPreview({ source: 'example', sessionId: 'old' }), false);
  assert.equal(f.GameHost.openPreview({ source: 'example' }), true);
  const nextId = f.GameHost.send('train', { mode: 'course' }); assert.equal(f.GameHost.preview, null);
  f.message({ ...preview, active: false, paused: true }); f.message({ type: 'paused', requestId, sessionId: settled.sessionId, v: true });
  assert.equal(f.GameHost.paused, false); assert.equal(received.length, 2);
  f.message(trainSnapshot(nextId, { sessionId: 'check', stage: 'check', phase: 'live', attempts: 3 }));
  assert.equal(f.GameHost.openPreview({ source: 'example' }), false);
  f.message(trainSnapshot(nextId, { sessionId: 'check', stage: 'check', phase: 'review', attempts: 3 }));
  assert.equal(f.GameHost.openPreview({ source: 'example' }), false);
  f.message(trainSnapshot(nextId, { sessionId: 'check', stage: 'check', phase: 'review', attempts: 4 }));
  assert.equal(f.GameHost.openPreview({ source: 'example' }), true);
  assert.equal(f.sent.at(-1).trainRequestId, nextId); assert.equal(f.sent.at(-1).attemptId, null);
  assert.equal(f.sent.some(m => m.type === 'resume'), false);
});

test('GPU training recovery clears actions, previews and recordings and resends only lesson gates and in-memory options with an intro notice', () => {
  for (const mode of ['course', 'stroke']) {
    const f = hostFixture({ v: 10, training: masteredTraining }); f.ready({}, academyCatalog);
    const before = plain(f.S.training), received = []; f.GameHost.on(m => received.push(plain(m)));
    const options = { mode, lessonId: 'CONTACT', stroke: 'LOOP', pacing: 'coach', setSize: mode === 'course' ? null : 10,
      adaptive: true, variation: true, seed: 23 };
    const requestId = f.GameHost.send('train', options);
    const snapshot = trainSnapshot(requestId, { mode, stage: mode === 'course' ? 'check' : 'practice', phase: mode === 'course' ? 'live' : 'fail',
      attempts: mode === 'course' ? 2 : 7, practicePassed: mode === 'course', quizPassed: mode === 'course',
      attemptReplay: { available: true, attemptId: 12, truncated: false }, practiceSet: { attempted: 7 } });
    f.message(snapshot); f.GameHost.send('pause');
    const paceId = f.GameHost.send('trainAction', { action: 'pacing', value: 'flow' });
    f.message({ type: 'trainActionAck', actionId: paceId, requestId, sessionId: snapshot.sessionId, accepted: true });
    const pendingId = f.GameHost.send('trainAction', { action: 'retry' });
    if (mode === 'stroke') assert.equal(f.GameHost.openPreview({ source: 'attempt' }), true);
    f.S.hint = false; f.S.audioLevels.master = 0; const oldFrame = f.GameHost.frame;
    f.message({ type: 'glLost', inMatch: false, score: [0, 0], server: 1 });
    assert.equal(f.frames.length, 2); assert.equal(f.GameHost.ready, false); assert.equal(f.GameHost.trainSnapshot, null);
    assert.equal(f.GameHost.preview, null); assert.equal(f.GameHost._pendingTrainAction, null); assert.equal(f.GameHost._trainRecovery, null);
    const recoveredId = f.GameHost.trainRequestId;
    assert.equal(recoveredId, requestId + 1);
    assert.deepEqual(plain(f.GameHost.trainingIntent), { requestId: recoveredId, sessionId: null, data: { ...options, pacing: 'flow',
      sessionKind: snapshot.stage === 'check' ? 'check' : 'practice',
      resume: { stage: snapshot.stage, practicePassed: snapshot.practicePassed, quizPassed: snapshot.quizPassed } } });
    f.message({ type: 'trainActionAck', actionId: pendingId, requestId, sessionId: snapshot.sessionId, accepted: true }, oldFrame.contentWindow);
    f.ready({}, academyCatalog);
    const train = f.sent.findLast(m => m.type === 'train'), settings = f.sent.findLast(m => m.type === 'settings');
    assert.ok(f.sent.indexOf(settings) < f.sent.indexOf(train)); assert.equal(settings.hint, false); assert.equal(settings.audioLevels.master, 0);
    for (const key of ['mode', 'lessonId', 'stroke', 'setSize', 'adaptive', 'variation', 'seed']) assert.equal(train[key], options[key], key);
    assert.equal(train.pacing, 'flow'); assert.equal(train.requestId, recoveredId);
    assert.deepEqual(train.resume, { stage: snapshot.stage, practicePassed: snapshot.practicePassed, quizPassed: snapshot.quizPassed });
    for (const key of ['attempts', 'stats', 'attemptReplay', 'attemptClip', 'practiceSet']) assert.equal(Object.hasOwn(train, key), false, key);
    assert.deepEqual(received.findLast(m => m.type === 'ready').recovery,
      { type: 'train', requestId: recoveredId, lessonId: 'CONTACT', phase: 'intro', resetAttempts: true, replayAvailable: false });
    assert.equal(f.GameHost.paused, true); assert.deepEqual(plain(f.S.training), before);
    f.message(trainSnapshot(recoveredId, { mode, sessionId: 'recovered', attempts: 0 }));
    const ackCount = received.filter(m => m.type === 'trainActionAck').length;
    f.message({ type: 'trainActionAck', actionId: pendingId, requestId, sessionId: snapshot.sessionId, accepted: true });
    assert.equal(received.filter(m => m.type === 'trainActionAck').length, ackCount);
    assert.equal(f.GameHost.trainSnapshot.attemptReplay.available, false);
    assert.equal(f.GameHost.send('trainAction', { action: 'start' }), pendingId + 1);
  }
});

test('queued training replacement discards retired actions and a superseded GPU recovery notice before ready', () => {
  const f = hostFixture(); const oldId = f.GameHost.send('train', { mode: 'course' });
  f.GameHost.send('trainAction', { action: 'start', sessionId: 'old' }); f.GameHost.send('skipStep', { sessionId: 'old' });
  assert.equal(f.GameHost.send('previewOpen', { source: 'example', trainRequestId: oldId, sessionId: 'old' }), false);
  assert.equal(f.GameHost.preview, null);
  const requestId = f.GameHost.send('train', { mode: 'stroke', setSize: 20 }); f.ready();
  assert.deepEqual(f.sent.filter(m => m.type === 'train').map(m => m.requestId), [requestId]);
  assert.equal(f.sent.some(m => ['trainAction', 'skipStep', 'previewOpen'].includes(m.type)), false);
  assert.equal(f.GameHost._pendingTrainAction, null);
  f.message(trainSnapshot(requestId, { mode: 'stroke' }));
  const readyMessages = []; f.GameHost.on(m => { if (m.type === 'ready') readyMessages.push(plain(m)); });
  f.GameHost.recover({ inMatch: false });
  const recoveredId = f.GameHost.trainRequestId; assert.equal(f.GameHost._trainRecoveryNotice.requestId, recoveredId);
  const newestId = f.GameHost.send('train', { mode: 'accuracy', setSize: 10 }); f.ready();
  assert.equal(newestId, recoveredId + 1); assert.equal(readyMessages.at(-1).recovery, undefined);
  assert.deepEqual(f.sent.filter(m => m.type === 'train').map(m => m.requestId), [requestId, newestId]);
  assert.deepEqual(plain(f.GameHost.trainingIntent), { requestId: newestId, data: { mode: 'accuracy', setSize: 10, sessionKind: 'practice' }, sessionId: null });
});

test('a late GPU journal flush cannot replace a frame that was already reloaded', async () => {
  const f = hostFixture(); f.ready(); let finish;
  f.GameHost.debug = true; f.GameHost.frame.contentWindow.__game = { debugArchive: { flush: () => new Promise(resolve => { finish = resolve; }) } };
  f.message({ type: 'glLost', inMatch: false }); assert.equal(f.GameHost._glRecoveryPending, true);
  f.GameHost.reload(); finish(true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.frames.length, 2); assert.equal(f.GameHost._glRecoveryPending, false);
});

test('embed rejects wrong sources, requests, sessions and stale or repeated action IDs without waking or changing pause', () => {
  const f = embedFixture(); f.command('train', { mode: 'course', requestId: 10 });
  const t = f.g.training, calls = []; t.action = (action, value) => { calls.push({ action, value }); t.phase = 'wait'; return true; };
  f.command('pause'); f.command('sleep');
  const command = { action: 'start', requestId: 10, sessionId: t.sessionId, actionId: 1 };
  const count = f.sent.length; f.command('trainAction', command, {}); f.command('trainAction', { ...command, __tt: 0 });
  assert.equal(f.sent.length, count);
  for (const actionId of [undefined, null, 0, -1, 1.5, '1', Infinity]) f.command('trainAction', { ...command, actionId });
  f.command('trainAction', { ...command, requestId: 9 }); f.command('trainAction', { ...command, actionId: 2, sessionId: 'old' });
  f.command('trainAction', { ...command, actionId: 2 }); f.command('trainAction', command);
  assert.equal(calls.length, 0); assert.equal(f.g.paused, true); assert.equal(f.g._ttSleeping, true);
  assert.ok(f.sent.filter(m => m.type === 'trainActionAck').every(m => m.accepted === false));
  f.command('trainAction', { ...command, actionId: 3 });
  assert.equal(calls.length, 1); assert.equal(f.g.paused, false); assert.equal(f.g._ttSleeping, false);
  assert.deepEqual(f.sent.at(-1), { __tt: 1, type: 'trainActionAck', actionId: 3, requestId: 10, sessionId: t.sessionId, accepted: true });
  assert.deepEqual(f.sent.findLast(m => m.type === 'paused'), { __tt: 1, type: 'paused', v: false, host: true, requestId: 10, sessionId: t.sessionId });
  f.command('pause'); f.command('sleep'); f.command('trainAction', { ...command, actionId: 3, action: 'retry' });
  t.action = () => false; f.command('trainAction', { ...command, actionId: 4 });
  assert.equal(f.g.paused, true); assert.equal(f.g._ttSleeping, true); assert.equal(f.sent.at(-1).accepted, false);
  t.finished = true; t.phase = 'done'; t.action = t.skip = () => { throw Error('completed training cannot be changed'); };
  let actionId = 5;
  for (const action of ['start', 'retry', 'restart', 'continue', 'resume']) {
    f.command('trainAction', { ...command, actionId: actionId++, action }); assert.equal(f.sent.at(-1).accepted, false);
  }
  f.command('skipStep', { ...command, actionId: actionId++ }); assert.equal(f.sent.at(-1).accepted, false);
  assert.equal(f.g.paused, true); assert.equal(f.g._ttSleeping, true);
  f.command('train', { mode: 'course', requestId: 11 }); const next = f.g.training;
  f.command('sleep'); f.command('train', { requestId: 10 }); f.command('train', { requestId: 11 });
  assert.equal(f.trainStarts.length, 2); assert.equal(f.g.training, next); assert.equal(f.g._ttSleeping, true);
  next.action = () => { throw Error('old identity reached the new Trainer'); };
  f.command('trainAction', { ...command, actionId: actionId++ });
  f.command('trainAction', { ...command, actionId: actionId++, requestId: 11 });
  assert.equal(f.sent.at(-1).accepted, false); assert.equal(f.g.paused, true); assert.equal(f.g._ttSleeping, true);
});

test('embed uses boolean action results and answer-or-value, and pacing, restart and skip never unpause', () => {
  const f = embedFixture(); f.command('train', { mode: 'course', requestId: 7 }); const t = f.g.training;
  let actionId = 0;
  for (const scenario of [
    { action: 'start', accepted: true, unpause: true }, { action: 'retry', accepted: true, unpause: true },
    { action: 'continue', accepted: true, unpause: true }, { action: 'resume', accepted: true, unpause: true },
    { action: 'answer', value: 'correct', accepted: true, unpause: true },
    { action: 'answer', answer: 'correct', value: 'ignored', accepted: true, unpause: true },
    { action: 'pacing', answer: null, value: 'flow', accepted: true, unpause: false },
    { action: 'restart', accepted: true, unpause: false }, { action: 'answer', answer: 'wrong', accepted: false, unpause: false },
    { action: 'resume', accepted: false, unpause: false }, { action: 'start', accepted: 1, unpause: false }
  ]) {
    t.phase = 'fail'; t.quizPassed = true; f.command('pause');
    t.action = (action, value) => {
      assert.equal(action, scenario.action); assert.equal(value, scenario.answer ?? scenario.value);
      if (scenario.accepted === true && scenario.unpause) t.phase = 'wait';
      return scenario.accepted;
    };
    f.command('trainAction', { requestId: 7, sessionId: t.sessionId, actionId: ++actionId,
      action: scenario.action, answer: scenario.answer, value: scenario.value });
    assert.equal(f.sent.at(-1).accepted, scenario.accepted === true); assert.equal(f.g.paused, !scenario.unpause, scenario.action);
    if (scenario.action === 'pacing') assert.equal(t.phase, 'fail');
  }
  let skips = 0; t.skip = () => { skips++; t.phase = 'intro'; return true; }; f.command('pause');
  const skip = { requestId: 7, sessionId: t.sessionId, actionId: ++actionId };
  f.command('skipStep', skip); assert.equal(skips, 1); assert.equal(f.sent.at(-1).accepted, true); assert.equal(f.g.paused, true);
  f.command('skipStep', skip); assert.equal(skips, 1); assert.equal(f.sent.at(-1).accepted, false);
  t.skip = () => false; f.command('skipStep', { ...skip, actionId: ++actionId }); assert.equal(f.sent.at(-1).accepted, false); assert.equal(f.g.paused, true);
  f.command('resume'); assert.equal(f.g.paused, true);
  t.action = () => { t.finished = true; t.phase = 'done'; return true; };
  f.command('trainAction', { ...skip, actionId: ++actionId, action: 'continue' });
  assert.equal(f.sent.at(-1).accepted, true); assert.equal(f.g.paused, true, 'an applied continue that finishes cannot restart a ball');
  f.command('match'); f.command('pause'); f.command('resume'); assert.equal(f.g.paused, false, 'ordinary match resume stays available');
});

test('embed preview validates training and completed attempts, blocks unfinished checks and guards the separate command/close ID', () => {
  const f = embedFixture(); f.command('train', { mode: 'course', requestId: 20 }); const t = f.g.training;
  t.attemptClip = { attemptId: 11, truncated: false }; t.stage = 'check'; t.phase = 'live'; t.attempts = 2;
  f.command('pause'); f.command('sleep'); let previewId = 0;
  const open = options => f.command('previewOpen', { requestId: ++previewId, trainRequestId: 20, sessionId: t.sessionId, source: 'example', ...options });
  const count = f.sent.length;
  f.command('previewOpen', { requestId: 50, source: 'example' }, {}); f.command('previewOpen', { __tt: 0, requestId: 50, source: 'example' });
  f.command('previewOpen', { source: 'example' }); assert.equal(f.sent.length, count);
  open({ trainRequestId: 19 }); open({ sessionId: 'old' }); open({});
  t.phase = 'review'; t.attempts = 3; open({});
  t.stage = 'practice'; t.phase = 'fail'; open({ source: 'attempt', attemptId: 10 });
  t.phase = 'live'; open({ source: 'attempt', attemptId: 11 });
  assert.equal(f.previewOpens.length, 0); assert.equal(f.g.paused, true); assert.equal(f.g._ttSleeping, true);
  assert.ok(f.sent.filter(m => m.type === 'preview').every(m => m.active === false && m.opened === false));
  t.stage = 'check'; t.phase = 'review'; t.attempts = 4; open({}); const activeId = previewId;
  assert.notEqual(activeId, 20); assert.equal(f.previewOpens.length, 1); assert.equal(f.g.preview.active, true);
  assert.equal(f.sent.at(-1).requestId, activeId); assert.equal(f.sent.at(-1).trainRequestId, 20); assert.equal(f.sent.at(-1).sessionId, t.sessionId);
  const controls = f.sent.length, cancels = f.captureCancels();
  f.command('previewCommand', { requestId: 20, command: 'rate', value: 1 }); f.command('previewCommand', { command: 'rate', value: 1 });
  f.command('previewCommand', { requestId: activeId, command: 'rate', value: 1 }, {});
  f.command('previewClose', { requestId: 20 }); f.command('previewClose'); f.command('previewClose', { requestId: activeId }, {});
  assert.equal(f.sent.length, controls); assert.equal(f.previewCommands.length, 0); assert.equal(f.captureCancels(), cancels); assert.equal(f.g.preview.active, true);
  f.command('previewCommand', { requestId: activeId, command: 'rate', value: .25 }); assert.deepEqual(f.previewCommands, [{ command: 'rate', value: .25 }]);
  t.action = t.skip = () => { throw Error('preview changed live training'); };
  f.command('trainAction', { requestId: 20, sessionId: t.sessionId, actionId: 1, action: 'resume' }); assert.equal(f.sent.at(-1).accepted, false);
  f.command('skipStep', { requestId: 20, sessionId: t.sessionId, actionId: 2 }); assert.equal(f.sent.at(-1).accepted, false);
  f.command('resume'); assert.equal(f.g.paused, true); assert.equal(t.attempts, 4); assert.equal(t.attemptClip.attemptId, 11);
  f.command('previewClose', { requestId: activeId }); assert.equal(f.g.preview.active, false); assert.equal(f.g.paused, true);
  const closedCount = f.sent.length; f.command('previewClose', { requestId: activeId }); assert.equal(f.sent.length, closedCount);
  t.action = () => true; f.command('trainAction', { requestId: 20, sessionId: t.sessionId, actionId: 1, action: 'resume' });
  assert.equal(f.sent.at(-1).accepted, false, 'an action rejected during preview cannot be replayed after close');
  t.stage = 'practice'; t.phase = 'fail'; open({ source: 'attempt', attemptId: 11 });
  assert.equal(f.previewOpens.length, 2); assert.equal(f.previewOpens.at(-1).source, 'attempt');
  const oldPreviewId = previewId; f.command('train', { mode: 'stroke', requestId: 21 });
  assert.equal(f.g.preview.active, false); assert.equal(t.attemptClip, null); assert.notEqual(f.g.training.sessionId, t.sessionId);
  f.command('previewCommand', { requestId: oldPreviewId, command: 'rate', value: 1 }); f.command('previewClose', { requestId: oldPreviewId });
  assert.equal(f.previewCommands.length, 1); assert.equal(f.g.training.phase, 'intro');
  f.ui.trainSync(f.g.training); f.ui.trainDone(f.g.training);
  for (const type of ['train', 'trainDone']) {
    const message = f.sent.findLast(m => m.type === type);
    assert.equal(message.requestId, 21); assert.equal(message.sessionId, f.g.training.sessionId); assert.equal(message.mode, 'stroke');
  }
});

test('embed context loss disposes the old attempt and preview and no late action, train or wake can revive them', () => {
  const f = embedFixture(); f.command('train', { mode: 'course', requestId: 30 }); const t = f.g.training;
  t.phase = 'fail'; t.attemptClip = { attemptId: 12, truncated: true };
  f.command('previewOpen', { requestId: 1, trainRequestId: 30, sessionId: t.sessionId, source: 'attempt', attemptId: 12 });
  const cancels = f.captureCancels(); assert.equal(f.g.preview.active, true); assert.equal(f.loseContext(), true);
  assert.equal(t.attemptClip, null); assert.equal(t.finished, true); assert.equal(f.g.training, null); assert.equal(f.g.preview.active, false);
  assert.ok(f.captureCancels() > cancels); assert.equal(f.g._ttContextLost, true); assert.equal(f.g._ttSleeping, true);
  const loss = f.sent.findLast(m => m.type === 'glLost');
  assert.equal(loss.requestId, 30); assert.equal(loss.sessionId, t.sessionId); assert.equal(loss.inMatch, false); assert.equal(loss.training, 0);
  f.command('trainAction', { requestId: 30, sessionId: t.sessionId, actionId: 1, action: 'start' }); assert.equal(f.sent.at(-1).accepted, false);
  f.command('skipStep', { requestId: 30, sessionId: t.sessionId, actionId: 2 }); assert.equal(f.sent.at(-1).accepted, false);
  f.command('wake'); f.command('resume'); f.command('train', { requestId: 31 }); f.command('previewOpen', { requestId: 2, source: 'example' });
  f.g.update(.016); assert.equal(f.updates(), 0); assert.equal(f.trainStarts.length, 1); assert.equal(f.g.training, null); assert.equal(f.g._ttSleeping, true);
  f.loseContext(); assert.equal(f.sent.filter(m => m.type === 'glLost').length, 1); assert.equal(f.sent.some(m => m.type === 'trainDone'), false);
});

test('preview errors survive graceful close for unavailable fallback and a successful new open clears them without resume', () => {
  const f = embedFixture(); f.command('train', { mode: 'stroke', requestId: 9 }); const t = f.g.training;
  f.command('previewOpen', { requestId: 1, trainRequestId: 9, sessionId: t.sessionId, source: 'example' });
  f.g.preview.error = 'renderer_error'; f.g.preview.close();
  const closed = f.sent.at(-1);
  assert.equal(closed.type, 'preview'); assert.equal(closed.requestId, 1); assert.equal(closed.active, false); assert.equal(closed.error, 'renderer_error');
  assert.equal(closed.trainRequestId, 9); assert.equal(closed.sessionId, t.sessionId); assert.equal(f.g.paused, true);
  f.command('previewOpen', { requestId: 2, trainRequestId: 9, sessionId: t.sessionId, source: 'example' });
  assert.equal(f.sent.at(-1).error, null); f.command('previewClose', { requestId: 2 });
  assert.equal(f.sent.at(-1).error, null); assert.equal(f.g.paused, true); assert.equal(t.phase, 'intro');
  assert.equal(f.sent.some(m => m.type === 'trainDone' || m.type === 'paused' && m.v === false), false);
});

test('training intent retains detached clean options, latest lesson and pacing but never serialized progress or recording', () => {
  const f = hostFixture(); const options = { mode: 'course', lessonId: 'CONTACT', pacing: 'coach', adaptive: true, variation: true,
    resume: { stage: 'check', practicePassed: true, quizPassed: true } };
  const requestId = f.GameHost.send('train', options), oldIntent = f.GameHost.trainingIntent;
  assert.deepEqual(plain(oldIntent.data), { ...options, sessionKind: 'check' });
  assert.notEqual(oldIntent.data.resume, options.resume); assert.notEqual(oldIntent.data, f.GameHost.mode.data);
  for (const key of ['__tt', 'type', 'requestId', 'progress', 'attemptReplay', 'attemptClip']) assert.equal(Object.hasOwn(oldIntent.data, key), false, key);
  f.ready({}, academyCatalog);
  options.resume.quizPassed = false; options.lessonId = 'CONTACT_CHANGED'; options.pacing = 'flow';
  assert.equal(oldIntent.data.resume.quizPassed, true); assert.equal(oldIntent.data.lessonId, 'CONTACT'); assert.equal(oldIntent.data.pacing, 'coach');
  f.message(trainSnapshot(requestId, { id: 'TOPSPIN', pacing: 'flow' }));
  assert.equal(f.GameHost.trainingIntent.sessionId, 'host-training'); assert.equal(f.GameHost.trainingIntent.data.lessonId, 'TOPSPIN');
  assert.equal(f.GameHost.trainingIntent.data.pacing, 'flow'); assert.notEqual(f.GameHost.trainingIntent.data.resume, oldIntent.data.resume);
  assert.equal(oldIntent.data.lessonId, 'CONTACT'); assert.equal(oldIntent.data.pacing, 'coach');
  const actionId = f.GameHost.send('trainAction', { action: 'pacing', value: 'coach' });
  f.message({ type: 'trainActionAck', requestId, sessionId: 'host-training', actionId, accepted: true });
  assert.equal(f.GameHost.trainingIntent.data.pacing, 'coach'); assert.equal(f.GameHost.mode.data.pacing, 'coach');
  f.GameHost.reload(); const count = f.GameHost.trainSnapshot;
  f.message(trainSnapshot(requestId)); assert.equal(f.GameHost.trainSnapshot, count); assert.equal(f.GameHost.trainingIntent, null);
});

test('completed check done previews remain read-only while incomplete or malformed check counts cannot open either source', () => {
  const host = hostFixture(); host.ready(); const requestId = host.GameHost.send('train', { mode: 'course' });
  for (const attempts of [3, undefined, NaN, '4', 4.5]) {
    host.message(trainSnapshot(requestId, { stage: 'check', phase: 'done', attempts }));
    assert.equal(host.GameHost.openPreview({ source: 'example' }), false);
    assert.equal(host.GameHost.openPreview({ source: 'attempt' }), false);
  }
  host.message(trainSnapshot(requestId, { stage: 'check', phase: 'done', attempts: 4,
    attemptReplay: { available: true, attemptId: 15, truncated: false } }));
  host.message({ type: 'trainDone', requestId, sessionId: 'host-training', mode: 'course', courseComplete: false });
  assert.equal(host.GameHost.openPreview({ source: 'attempt' }), true);
  assert.equal(host.sent.at(-1).attemptId, 15); assert.equal(host.GameHost.paused, true);
  const f = embedFixture(); f.command('train', { mode: 'course', requestId: 8 }); const t = f.g.training;
  t.stage = 'check'; t.phase = 'done'; t.finished = true; t.attemptClip = { attemptId: 15, truncated: false };
  t.action = t.skip = () => { throw Error('completed preview must remain read-only'); };
  let previewId = 0;
  for (const attempts of [3, undefined, NaN, '4', 4.5]) {
    t.attempts = attempts;
    f.command('previewOpen', { requestId: ++previewId, trainRequestId: 8, sessionId: t.sessionId, source: 'example' });
    assert.equal(f.g.preview.active, false); assert.equal(f.sent.at(-1).opened, false);
  }
  t.attempts = 4;
  for (const source of ['attempt', 'example']) {
    f.command('previewOpen', { requestId: ++previewId, trainRequestId: 8, sessionId: t.sessionId, source, attemptId: source === 'attempt' ? 15 : null });
    assert.equal(f.g.preview.active, true); assert.equal(f.g.paused, true);
    f.command('previewClose', { requestId: previewId }); assert.equal(f.g.preview.active, false); assert.equal(f.g.paused, true);
  }
  f.command('trainAction', { requestId: 8, sessionId: t.sessionId, actionId: 1, action: 'restart' });
  assert.equal(f.sent.at(-1).accepted, false); assert.equal(t.attempts, 4); assert.equal(t.attemptClip.attemptId, 15);
});
