const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { load } = require('./helpers.cjs');

const files = ['10_math.js', '20_gl.js', '30_physics.js', '40_swipe.js', '42_shot_diagnostics.js',
  '50_audio.js', '55_ai.js', '56_rig.js', '57_camera.js', '59_replay.js', '65_train.js',
  '66_training_preview.js', '84_racket.js', '70_game.js'];
const names = ['TrainingPreview', 'Renderer', 'Game', 'GS', 'PH', 'STROKE_CONFIG', 'SERVE_WARM',
  'V3', 'Q', 'M4', 'SwipeTracker', 'PaddleRig', 'PaddleStrokeMotion', 'AudioEngine', 'OpponentAI',
  'Equipment', 'MomentRecorder', 'Trainer', 'TRAIN_STEPS', 'TRAIN_FEEDS', 'TRAIN_GUIDES', 'PADDLE_TEMPLATES',
  'trainingFeedBall', 'racketForStroke', 'resolveRacketLaunch', 'predict', 'integrateBall',
  'tableContact', 'netContactStep', 'bounceTable', 'measureShotSpin', 'strokeIdentityMatches',
  'paddleTableClearance', 'sampleStrokeTemplate', 'createStrokeTemplateOutput', 'projectPoint',
  'TrainingAttemptRecorder', 'validTrainingAttempt', 'sampleTrainingAttempt',
  'TRAIN_ATTEMPT_CAP', 'TRAIN_ATTEMPT_STRIDE', 'TRAIN_ATTEMPT_HZ', 'ET',
  'paddleContactPose', 'getCaptureForgiveness', 'setCaptureForgiveness', 'gameplayCalibrationLocked'];
const lib = load(files, names, { Math: Object.create(Math) });
const strokes = Object.keys(lib.PADDLE_TEMPLATES.strokes);
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const vectorNear = (a, b, epsilon) => { for (const k of ['x', 'y', 'z']) near(a[k], b[k], epsilon); };
const quaternionNear = (a, b, epsilon = 1e-8) => {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  for (const key of ['x', 'y', 'z', 'w']) near(a[key], sign * b[key], epsilon);
};
const plain = value => JSON.parse(JSON.stringify(value));
const attemptOutput = () => ({ ball: { p: {}, v: {}, w: {}, q: {} },
  player: { pos: {}, q: {}, normal: {} }, opponent: { pos: {}, q: {}, normal: {} } });

function setRecordedState(g, seconds) {
  lib.V3.set(g.ball.p, .1 + seconds, 1.2 + seconds * .2, .9 - seconds * .3);
  lib.V3.set(g.ball.v, 1, .2, -.3); lib.V3.set(g.ball.w, 320 + seconds, -73, 19);
  lib.Q.setAxisAngle(g.ball.q, 0, 1, 0, seconds * .31);
  for (const [pad, side] of [[g.player, 1], [g.aiPaddle, -1]]) {
    lib.V3.set(pad.pos, side * (.2 + seconds * .1), 1.3 + seconds * .05, side * 1.7);
    lib.V3.set(pad.normal, 0, 0, -side); lib.Q.setAxisAngle(pad.q, 0, 0, 1, seconds * side * .2);
    pad.roll = .23 + seconds * side; pad.activeFace = seconds < .5 ? side : -side; pad.poseReady = true;
  }
  g.playerPaddleVisible = seconds < .7;
}

function recordingFixture(options = {}) {
  const f = fixture(), { g } = f;
  for (const method of ['setPaused', 'update', 'applyHit']) delete g[method];
  g.resetPaddle = () => {};
  g.cancelInput = () => { g.training?.captureAttemptGesture(); g.swipe.cancel(); g.pointerDown = false; };
  g.ui = { inputMode: options.inputMode === 'mouse' ? 'mouse' : 'touch', trainSync() {}, trainProgress() {}, trainDone() {}, trainHide() {}, showShot() {} };
  g.settings.hint = options.hint === true; g.settings.showTrail = g.settings.showPredict = false;
  g.hintRequested = g.hintContact = g.settings.hint; g.sessionKind = 'practice';
  g._playerFace = 1; g.player.prev = lib.V3.clone(g.player.pos);
  for (const pad of [g.player, g.aiPaddle]) { pad.poseReady = true; pad.activeFace = 1; pad.roll = .23; }
  g.slowmo = { on: false, active: false, allowed: true, energy: 1, used: 0 };
  g.recorder = { reset() {}, addShot() {}, addBounce() {} };
  g.moments = { push() {}, addContact() {}, addBounce() {} };
  g.matchTasks = { topspin: 0, smash: 0, serves: 0, moments: 0 };
  g.stats.totalSpin = g.stats.maxSpeed = 0;
  g._recordContactFlash = g.shakeIt = g.buzz = () => {};
  g.training = new lib.Trainer(g, { mode: 'stroke', stroke: 'DRIVE', pacing: 'coach', seed: 73,
    requestId: 91, progress: { version: 1, lessons: {} }, ...options });
  g.training.begin(); assert.equal(g.training.action('start'), true); g.training.feed();
  return f;
}

// The real dispatcher, pause, substep physics and Trainer recording remain in
// charge. Only unrelated presentation/CCD input owners are fixture callbacks.
function gameLoopFixture(options = {}) {
  const f = recordingFixture(options), { g } = f;
  for (const method of ['updateShotDiagnostics', 'updatePlayerPaddle', 'updateStrikeWindow',
    'updateOpponentPose', 'tryAiHit', 'tryPlayerHit', 'updateCamera', 'keepPaddleOnScreen',
    'clampPaddleVolume', 'logInput', 'emitParticles']) g[method] = () => {};
  g.substepPadPose = () => null; g.contactPrediction = () => null;
  g.particles = { update() {} }; g.anticipation = { active: false, visualOffset: lib.V3.new() };
  g.replayer = { on: false }; g.spinIndicator = { active: false };
  g.messages = []; g.hitFlash = 0;
  g.followThrough.active = false; g.inspectSlowmo = false;
  g.profile.data.stats.minutes = 0; g.profile.maybeSave = () => {};
  g.vw = g.R._w; g.vh = g.R._h; g._fpsN = g._fpsT = g._acc = 0;
  g._calPolicyKey = ['practice', 'practice', false, false].join('|');
  return f;
}

function completedAttempt(options = {}) {
  const f = gameLoopFixture(options), { g } = f, t = g.training;
  for (let i = 0; i < 300 && t.phase === 'live'; i++) g.update(1 / 60);
  assert.notEqual(t.phase, 'live', 'real physics must settle the missed feed');
  assert.ok(lib.validTrainingAttempt(t.attemptClip));
  return f;
}

// Real Renderer methods below run against a GL recorder, not empty draw stubs.
// This catches missing camera uniforms when changing only a viewport for an inset.
function renderer(width = 1280, height = 760) {
  const state = { viewport: [7, 13, width - 20, height - 30], scissor: [11, 19, 310, 270],
    enabled: new Set(['SCISSOR_TEST']), depthMask: false, framebuffer: 'original-fbo', program: 'original-program' };
  const uniforms = new Map(), draws = [], clears = [];
  let buffer;
  const gl = {};
  for (const key of ['VIEWPORT', 'SCISSOR_BOX', 'SCISSOR_TEST', 'DEPTH_WRITEMASK', 'FRAMEBUFFER_BINDING',
    'CURRENT_PROGRAM', 'FRAMEBUFFER', 'ARRAY_BUFFER', 'ELEMENT_ARRAY_BUFFER', 'DEPTH_TEST', 'CULL_FACE',
    'BLEND', 'TEXTURE_2D', 'TEXTURE0', 'TEXTURE1', 'FLOAT', 'TRIANGLES', 'UNSIGNED_SHORT', 'SRC_ALPHA', 'ONE', 'ONE_MINUS_SRC_ALPHA', 'LEQUAL', 'BACK']) gl[key] = key;
  gl.COLOR_BUFFER_BIT = 1; gl.DEPTH_BUFFER_BIT = 2;
  gl.getParameter = key => key === gl.VIEWPORT ? state.viewport.slice() : key === gl.SCISSOR_BOX ? state.scissor.slice()
    : key === gl.DEPTH_WRITEMASK ? state.depthMask : key === gl.FRAMEBUFFER_BINDING ? state.framebuffer
      : key === gl.CURRENT_PROGRAM ? state.program : null;
  gl.isEnabled = key => state.enabled.has(key);
  gl.enable = key => state.enabled.add(key); gl.disable = key => state.enabled.delete(key);
  gl.viewport = (...v) => { state.viewport = v; }; gl.scissor = (...v) => { state.scissor = v; };
  gl.depthMask = value => { state.depthMask = value; };
  gl.bindFramebuffer = (target, value) => { state.framebuffer = value; };
  gl.useProgram = value => { state.program = value; };
  gl.bindBuffer = (target, value) => { if (target === gl.ELEMENT_ARRAY_BUFFER) buffer = value; };
  gl.uniformMatrix4fv = (key, transpose, value) => { uniforms.set(key, Array.from(value)); };
  gl.uniformMatrix3fv = (key, transpose, value) => { uniforms.set(key, Array.from(value)); };
  gl.uniform3f = (key, ...v) => { uniforms.set(key, v); };
  gl.uniform1f = (key, value) => { uniforms.set(key, value); };
  gl.uniform1i = gl.uniform1f;
  gl.uniform2f = gl.uniform3f;
  gl.drawElements = () => {
    assert.equal(state.program, 'main');
    const vp = uniforms.get('uViewProj'), cam = uniforms.get('uCam');
    assert.equal(vp.length, 16); assert.ok(vp.every(Number.isFinite)); assert.ok(cam.every(Number.isFinite));
    draws.push({ buffer, vp: vp.slice(), cam: cam.slice(), model: uniforms.get('uModel').slice(), viewport: state.viewport.slice(), scissor: state.scissor.slice() });
  };
  gl.drawArrays = () => { draws.push({ present: true, program: state.program }); };
  gl.clear = mask => { clears.push({ mask, scissor: state.scissor.slice(), scoped: state.enabled.has('SCISSOR_TEST'), depthMask: state.depthMask }); };
  for (const method of ['clearColor', 'depthFunc', 'cullFace', 'activeTexture', 'bindTexture', 'blendFunc', 'enableVertexAttribArray', 'disableVertexAttribArray', 'vertexAttribPointer']) gl[method] = () => {};
  gl.isContextLost = () => false;
  const uniformNames = new Proxy({}, { get: (target, key) => key });
  const R = Object.create(lib.Renderer.prototype);
  Object.assign(R, { gl, _w: width, _h: height, _dpr: 1, quality: 'low', useShadowMap: false, shadowFBO: null,
    progMain: { p: 'main', u: uniformNames }, progComp: { p: 'composite', u: uniformNames },
    progBright: { p: 'bright', u: uniformNames }, progBlur: { p: 'blur', u: uniformNames },
    viewProj: lib.M4.create(), view: lib.M4.create(), proj: lib.M4.create(), camPos: lib.V3.new(2, 3, 4),
    lightVP: lib.M4.create(), nrmMat: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    drawCalls: 29, tris: 913, _cur: null, fsQuad: {}, white: {}, rtScene: { fbo: 'scene-fbo', tex: {} },
    rtA: { fbo: {}, tex: {} }, rtB: { fbo: {}, tex: {} },
    post: { bloom: .2, exposure: 1, grain: 0, threshold: .9, soft: .4, focus: [.5, .5], vignette: .19, radial: .11, sat: 1.05, flash: .03, ca: .02 },
    env: { fogDensity: .05, fogCol: lib.V3.new(.1, .1, .1), sky: lib.V3.new(.2, .2, .2), ground: lib.V3.new(.1, .1, .1),
      fill1: { p: lib.V3.new(1, 2, 0), c: lib.V3.new(.2, .2, .2) }, fill2: { p: lib.V3.new(-1, 2, 0), c: lib.V3.new(.2, .2, .2) },
      lightDir: lib.V3.new(1, 2, 3), lightCol: lib.V3.new(.9, .9, .9) } });
  return { R, gl, state, draws, clears, uniforms };
}

function fixture(width, height) {
  const r = renderer(width, height), g = Object.create(lib.Game.prototype), V = lib.V3;
  const mesh = id => ({ vbo: {}, ibo: id, count: 36 });
  const S = { mesh: Object.fromEntries(['ball', 'sphere', 'box', 'blade', 'rubber', 'handle'].map(id => [id, mesh(id)])),
  mat: { ball: { color: [1, 1, 1] }, rubberRed: { color: [.8, .1, .1] }, rubberBlack: { color: [.04, .04, .04] },
    bladeWood: { color: [.7, .4, .2] }, handle: { color: [.3, .2, .1] } },
  drawStatic(R) { R.draw(this.mesh.box, lib.M4.create(), this.mat.bladeWood); }, drawNet() {} };
  Object.assign(g, { canvas: { style: { cursor: 'none' }, getBoundingClientRect: () => ({ left: 0, top: 0, width: r.R._w, height: r.R._h }) },
    R: r.R, scene: S, rig: new lib.PaddleRig(), state: lib.GS.RALLY, stateT: 4.2, stateSimT: 2.9, paused: false,
    time: 12.2, strokeTime: 8.3, frame: 51, _acc: .0012, score: [3, 4], games: [0, 1], server: -1,
    rally: 7, bestRally: 9, rallyBounces: [1], serveBounces: 0, isServeBall: false, shotId: 24,
    ball: { live: true, p: V.new(.2, 1.12, .9), v: V.new(.3, -.5, 7), w: V.new(330, 50, 17), q: lib.Q.new(), hist: [.1, .2, .3], lastHitBy: -1 },
    player: { pos: V.new(.2, 1.14, 1.1), prevPos: V.new(.18, 1.13, 1.12), normal: V.new(0, 0, -1),
      q: lib.Q.new(), vel: V.new(.2, .1, -.4), roll: .12, side: 1, lastHitT: 10.3 },
    aiPaddle: { pos: V.new(.1, 1, -1.3), q: lib.Q.new(), normal: V.new(0, 0, 1) }, ai: new lib.OpponentAI(2),
    settings: { grip: 'shakehand', hand: 'right', camera: 'BROADCAST', hint: false, volume: .43, cal: { strokeGain: .61 } },
    equip: new lib.Equipment(), profile: { data: { coins: 713, elo: 1201, skillProgress: { DRIVE: { attempts: 9 } }, stats: { shots: 11 } } },
    swipe: new lib.SwipeTracker(), paddleMotion: new lib.PaddleStrokeMotion(), audio: new lib.AudioEngine(),
    pointer: { x: .4, y: .65 }, pointerDown: true, pointerInside: true, pointerFine: false, _touchIds: new Set([99]),
    lastSwipeT: 11.8, swipeReleasedAt: 11.9, lastSwipeLate: false,
    recorder: { frames: [1, 2, 3], points: [{ winner: 1 }] }, moments: new lib.MomentRecorder(),
    director: { rng: { seed: 71 }, phase: 'rally', events: [{ id: 8 }] },
    stats: { shots: 8, errors: 1, winners: 3, maxSpin: 102, byStroke: { DRIVE: 4 } },
    _cal: { spinK: .73, flytime: .8 }, _calEffective: { spinK: .6 }, calibrationState: { allowed: true },
    camVP: lib.M4.create(), camPos: V.new(0, 1.6, 3), camLook: V.new(0, .9, -.2), camShiftY: .08,
    camRig: { eye: V.new(0, 1.6, 3), look: V.new(0, .9, -.2), fov: 44 }, cameraMode: 'BROADCAST',
    shake: .12, shakeDir: V.new(.1, 0, .2), marks: [{ t: .2 }], particles: { n: 3, life: new Float32Array([.1, .2, .3]) },
    followThrough: { active: true, t: .03, duration: .16, swingDir: V.new(1, 2, 3) },
    slowmo: { on: true, active: true, energy: .71 }, timeScale: .3, targetTimeScale: .3,
    network: { isInMatch: false, outbox: ['pending'], sequence: 3 }, career: { active: false, level: 2 },
    ui: { inputMode: 'touch', overlayTimer: .1, shotTimer: .3, _cur: 'neutral' } });
  g.swipe.down(.4, .65, 11.9, 8.1); g.swipe.move(.45, .6, 12, 8.2);
  g.audio.setLevels({ master: .43, effects: .51, music: 0, ambient: .17 }); g.audio.setMuted(true);
  g.training = new lib.Trainer(g, { stage: 'practice', progress: { version: 1, skills: {}, cursor: 3 } });
  for (const method of ['cancelInput', 'setPaused', 'updateCamera', 'update', 'render', 'resetPaddle', 'applyHit'])
    g[method] = () => { throw Error(`preview called Game.${method}`); };
  g.profile.touch = () => { throw Error('preview saved progress'); };
  g.audio.init = g.audio.resume = () => { throw Error('preview unlocked audio'); };
  g.preview = new lib.TrainingPreview(g);
  return { g, p: g.preview, ...r };
}

// No selective list of gameplay fields: new fixture fields are included too.
// Only the preview's own object, the pause flag and quiet presentation bit differ.
function gameHash(g, presentation = true) {
  const seen = new Map();
  const walk = (value, path) => {
    if (path === 'game.preview') return '[preview owner]';
    if (presentation && (path === 'game.paused' || path === 'game.audio.quiet')) return '[presentation]';
    if (typeof value === 'function') return '[function]';
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return { ref: seen.get(value) };
    seen.set(value, path);
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (value instanceof Map || Object.prototype.toString.call(value) === '[object Map]') return Array.from(value, ([k, v]) => [walk(k, path + '.key'), walk(v, path + '.value')]);
    if (value instanceof Set || Object.prototype.toString.call(value) === '[object Set]') return Array.from(value, v => walk(v, path + '.value'));
    if (Array.isArray(value)) return value.map((v, i) => walk(v, `${path}.${i}`));
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, walk(value[k], path + '.' + k)]));
  };
  return createHash('sha256').update(JSON.stringify(walk(g, 'game'))).digest('hex');
}

function independentFlight(initial, seconds, wanted) {
  const V = lib.V3, b = { p: V.clone(initial.p), v: V.clone(initial.v), w: V.clone(initial.w) }, bounces = [];
  const hit = V.new(), net = V.new();
  for (let i = 0; i < Math.ceil(seconds / lib.PH.SIM_DT); i++) {
    const { x, y, z } = b.p;
    lib.integrateBall(b.p, b.v, b.w, lib.PH.SIM_DT);
    assert.equal(lib.netContactStep(x, y, z, b.p.x, b.p.y, b.p.z, net), 0, 'preview ball hit net');
    if (b.v.y < 0 && lib.tableContact(x, y, z, b.p.x, b.p.y, b.p.z, hit)) {
      V.copy(b.p, hit); b.p.y += 1e-5; bounces.push({ x: hit.x, z: hit.z, t: (i + 1) * lib.PH.SIM_DT });
      lib.bounceTable(b.p, b.v, b.w);
      if (bounces.length === wanted) break;
    }
  }
  return bounces;
}

test('preview validates narrow start commands before taking ownership', () => {
  const { g, p } = fixture(), before = gameHash(g, false);
  for (const options of [{}, { lessonId: 'missing' }, { skillId: 'missing' }, { strokeId: 'unknown' },
    { strokeId: 'DRIVE', grip: 'other' }, { strokeId: 'DRIVE', hand: 'both' }, { strokeId: 'DRIVE', forehand: 1 },
    { strokeId: 'DRIVE', technique: 'SERVE_SIDE_TOP' }]) assert.equal(p.open(options), false);
  assert.equal(p.active, false); assert.equal(gameHash(g, false), before);
  assert.equal(p.command('seek', .5), false);
  assert.equal(p.command('start', { lessonId: 'DRIVE' }), true);
  const active = p.snapshot();
  assert.equal(p.open({ strokeId: 'missing' }), false);
  assert.equal(p.snapshot().strokeId, active.strokeId); assert.equal(p.active, true);
  p.close(); assert.equal(gameHash(g, false), before);
});

test('foundation tap reference has a static touch window and no zero-length draw segment', () => {
  const { p, g } = fixture(), before = gameHash(g);
  assert.equal(p.open({ lessonId: 'HIT' }), true); p.render();
  assert.equal(p.profile.gesture.kind, 'tap');
  assert.equal(p._gestureMatrices.length, 0);
  assert.equal(p.command('contact'), true); p.render();
  assert.equal(gameHash(g), before); p.close();
});

test('preview and contact inset read the current racket selector without rebuilding the physical clip', () => {
  const { g, p } = fixture(), options = [];
  p._rig.draw = (R, S, o) => options.push({ racket: o.racket, face: o.activeFace });
  g._equippedRacket = 'r-pan';
  assert.equal(p.open({ strokeId: 'LOOP', forehand: false }), true);
  p.command('contact'); p.render();
  assert.ok(options.length > 0);
  assert.ok(options.every(o => o.racket === 'r-pan' && o.face === -1));
  const clip = p.clip;
  g._equippedRacket = 'r-standard'; options.length = 0;
  p.render();
  assert.equal(p.clip, clip);
  assert.ok(options.every(o => o.racket === 'r-standard' && o.face === -1));
  p.close();
});

test('all 44 lessons open their physical family without progressing the active lesson', () => {
  const { p, g } = fixture(), before = gameHash(g);
  for (const step of lib.TRAIN_STEPS) {
    assert.equal(p.open({ lessonId: step.id }), true, `${step.id}: ${p.error}`);
    assert.equal(p.snapshot().lessonId, step.id);
    assert.equal(p.clip.racket.stroke.id, step.stroke);
    p.command('contact'); p.render(); assert.equal(gameHash(g), before);
  }
  p.close(); assert.equal(gameHash(g), before);
});

test('serve preview neither reads nor writes the live serve warm cache', () => {
  const { p } = fixture(), warm = lib.SERVE_WARM;
  const previous = JSON.stringify(Array.from(warm)), get = Object.getOwnPropertyDescriptor(warm, 'get'), set = Object.getOwnPropertyDescriptor(warm, 'set');
  Object.defineProperty(warm, 'get', { configurable: true, value() { throw Error('preview read match warm cache'); } });
  Object.defineProperty(warm, 'set', { configurable: true, value() { throw Error('preview wrote match warm cache'); } });
  try {
    for (const id of ['SERVE_TOP', 'SERVE_BACK', 'SERVE_SIDE', 'SERVE_FAST', 'SERVE_NO_SPIN', 'SERVE_SIDE_TOP', 'SERVE_SIDE_BACK'])
      assert.equal(p.open(id === 'SERVE_SIDE_TOP' || id === 'SERVE_SIDE_BACK' ? { lessonId: id } : { strokeId: id }), true, p.error);
    assert.equal(JSON.stringify(Array.from(warm)), previous);
  } finally {
    p.close();
    if (get) Object.defineProperty(warm, 'get', get); else delete warm.get;
    if (set) Object.defineProperty(warm, 'set', set); else delete warm.set;
  }
});

for (const id of strokes.concat(['SERVE_SIDE_TOP', 'SERVE_SIDE_BACK'])) {
  test(`physical 60-frame reference: ${id}`, () => {
    const { g, p } = fixture(), before = gameHash(g), config = JSON.stringify([lib.PH, lib.STROKE_CONFIG]);
    const options = id === 'SERVE_SIDE_TOP' || id === 'SERVE_SIDE_BACK' ? { lessonId: id } : { strokeId: id };
    assert.equal(p.open(options), true, p.error);
    const c = p.clip, launch = lib.resolveRacketLaunch(c.ball, c.racket, {});
    assert.equal(lib.strokeIdentityMatches(c.racket, c.launch), true);
    for (const field of ['p', 'v', 'w']) vectorNear(launch[field], c.launch[field]);
    near(c.inbound.duration / lib.PH.SIM_DT, c.inbound.count - 1);
    const actualBounces = independentFlight(c.launch, 3, id.startsWith('SERVE_') ? 2 : 1);
    assert.equal(actualBounces.length, id.startsWith('SERVE_') ? 2 : 1);
    for (let i = 0; i < actualBounces.length; i++) for (const key of ['x', 'z', 't']) near(actualBounces[i][key], c.outbound.bounces[i][key]);
    assert.ok(id.startsWith('SERVE_') ? actualBounces[0].z > 0 && actualBounces[1].z < 0 : actualBounces[0].z < 0);
    const ballRefs = [p.ball, p.ball.p, p.ball.v, p.ball.w, p.ball.q], racketRefs = [p.racket, p.racket.p, p.racket.q, p.racket.v, p.racket.w];
    const frames = [];
    for (let i = 0; i <= 60; i++) {
      p.command('seek', i / 60); p.render();
      for (const v of [p.ball.p, p.ball.v, p.ball.w, p.racket.p, p.racket.n, p.racket.vR]) assert.ok(Object.values(v).every(Number.isFinite));
      near(Math.hypot(...Object.values(p.ball.q)), 1); near(Math.hypot(...Object.values(p.racket.q)), 1);
      assert.ok(lib.paddleTableClearance(p.racket.p, p.racket.n, 0, lib.PH.TABLE_Y, lib.PH.T_HALF_WID, lib.PH.T_HALF_LEN, p.racket.q) >= -1e-5);
      assert.equal(gameHash(g), before, 'preview mutated a game-owned field');
      frames.push({ phase: p.phase, p: { ...p.racket.p }, stage: p.racket.stage });
    }
    [p.ball, p.ball.p, p.ball.v, p.ball.w, p.ball.q].forEach((value, i) => assert.equal(value, ballRefs[i]));
    [p.racket, p.racket.p, p.racket.q, p.racket.v, p.racket.w].forEach((value, i) => assert.equal(value, racketRefs[i]));
    assert.equal(frames[0].stage, 'ready'); assert.equal(frames[60].stage, 'recover');
    p.command('contact');
    vectorNear(p.ball.p, c.ball.p); vectorNear(p.racket.p, c.pose.pos); vectorNear(p.racket.n, c.racket.normal);
    vectorNear(p.racket.vR, c.racket.vR);
    const poseMatrix = lib.M4.compose(lib.M4.create(), p.racket.p, c.pose.q, lib.V3.new(1, 1, 1));
    const point = lib.M4.transformPoint(lib.V3.new(), poseMatrix, c.pose.localPoint);
    vectorNear(point, c.pose.point, 1e-7); // GPU model matrices are Float32.
    near(lib.V3.dist(c.ball.p, c.pose.point), lib.PH.R);
    const centerToBall = lib.V3.sub(lib.V3.new(), c.ball.p, c.pose.pos);
    near(lib.V3.dot(centerToBall, c.racket.normal), lib.PH.R + .010);
    const h = 1e-7, a = lib.createStrokeTemplateOutput(), b = lib.createStrokeTemplateOutput();
    p._samplePaddle(c, c.compiled.contactPhase - h, a); p._samplePaddle(c, c.compiled.contactPhase + h, b);
    const velocity = lib.V3.mul(lib.V3.new(), lib.V3.sub(lib.V3.new(), b.point, a.point), 1 / (2 * h * c.physicalDuration));
    vectorNear(velocity, c.racket.vR, 4e-5); // Quaternion derivative in the shared retargeter is numerical.
    assert.equal(JSON.stringify([lib.PH, lib.STROKE_CONFIG]), config);
    p.close(); assert.equal(gameHash(g), before);
  });
}

test('all twenty plus mixed references support both grips and hands with no RNG or PH mutation', () => {
  const { g, p } = fixture(), before = gameHash(g), math = lib.context.Math, random = math.random;
  const config = JSON.stringify([lib.PH, lib.STROKE_CONFIG]), warm = JSON.stringify(Array.from(lib.SERVE_WARM));
  let calls = 0;
  math.random = () => { calls++; throw Error('preview consumed global RNG'); };
  try {
    for (const grip of ['shakehand', 'penhold']) for (const hand of ['right', 'left'])
      for (const id of strokes.concat(['SERVE_SIDE_TOP', 'SERVE_SIDE_BACK'])) {
        assert.equal(p.open({ ...(id === 'SERVE_SIDE_TOP' || id === 'SERVE_SIDE_BACK' ? { lessonId: id } : { strokeId: id }), grip, hand }), true, `${id}/${grip}/${hand}: ${p.error}`);
        const active = p.profile.forehand ? 1 : -1;
        assert.equal(p.clip.pose.activeFace, active);
        const matrix = lib.M4.compose(lib.M4.create(), lib.V3.new(), p.clip.pose.q, lib.V3.new(1, 1, 1));
        const normal = lib.M4.transformDir(lib.V3.new(), matrix, lib.V3.new(0, 0, active));
        vectorNear(normal, p.clip.racket.normal, 1e-7);
        assert.equal(gameHash(g), before);
      }
    assert.equal(calls, 0); assert.equal(JSON.stringify([lib.PH, lib.STROKE_CONFIG]), config);
    assert.equal(JSON.stringify(Array.from(lib.SERVE_WARM)), warm, 'preview warmed match serve solver');
  } finally { math.random = random; p.close(); }
});

test('opposite-court references rotate the physical feed and canonical player camera together', () => {
  const { p, g } = fixture(), before = gameHash(g);
  for (const id of strokes) {
    assert.equal(p.open({ strokeId: id, side: -1, play: false }), true, `${id}: ${p.error}`);
    p.command('contact'); p.render();
    near(p.orbit.yaw, Math.PI);
    assert.ok(p.clip.ball.p.z < 0 && p._cameraRig.eye.z < p._cameraRig.look.z);
    assert.ok(p._guideRig.eye.z < p._guideRig.look.z);
    const bounces = p.clip.outbound.bounces;
    assert.ok(id.startsWith('SERVE_') ? bounces[0].z < 0 && bounces[1].z > 0 : bounces[0].z > 0);
    assert.equal(gameHash(g), before);
  }
  p.close();
});

test('mixed signed spin and no-spin are measured from the actual launch, not a recipe label', () => {
  const { p } = fixture();
  for (const [lessonId, sign] of [['SERVE_SIDE_TOP', 1], ['SERVE_SIDE_BACK', -1]]) {
    assert.equal(p.open({ lessonId }), true, p.error);
    const s = p.snapshot(); assert.ok(s.contact.spin.sideRps > 3 && s.contact.spin.topRps * sign > 3);
    near(s.contact.spin.totalRps, Math.hypot(s.contact.launch.w.x, s.contact.launch.w.y, s.contact.launch.w.z) / (2 * Math.PI));
  }
  assert.equal(p.open({ lessonId: 'SERVE_NO_SPIN' }), true, p.error);
  assert.equal(p.snapshot().contact.spin.totalRps, 0);
  assert.ok(p.clip.outbound.bounces.length === 2);
  const i = p.clip.outbound.bounces[0].index * 14;
  assert.ok(Math.hypot(p.clip.outbound.states[i + 7], p.clip.outbound.states[i + 8], p.clip.outbound.states[i + 9]) > 0,
    'physical table bounce should spin a formerly spinless ball');
  p.close();
});

test('profile controls remain preview-local and preserve phase and the gameplay camera', () => {
  const { g, p } = fixture(), before = gameHash(g);
  assert.equal(p.open({ skillId: 'BANANA' }), true);
  p.command('seek', .37);
  for (const grip of ['penhold', 'shakehand']) for (const hand of ['left', 'right']) for (const forehand of [true, false]) {
    assert.equal(p.command('grip', { grip }), true); assert.equal(p.command('hand', { hand }), true);
    assert.equal(p.command('forehand', { forehand }), true); near(p.phase, .37);
    assert.equal(p.snapshot().contact.activeFace, forehand ? 1 : -1);
    p.render(); assert.equal(gameHash(g), before);
  }
  for (const value of [null, NaN, Infinity]) assert.equal(p.command('seek', value), false);
  assert.equal(p.command('grip', 'unknown'), false); assert.equal(p.command('camera', 'unknown'), false);
  assert.equal(p.command('not-an-api', {}), false);
  p.close(); assert.equal(gameHash(g), before);
});

test('physics and trajectory buffers are not regenerated by playback, scrub, rate or orbit', () => {
  const { p } = fixture(); assert.equal(p.open({ strokeId: 'DRIVE' }), true); p.render();
  const c = p.clip, states = [c.inbound.states, c.outbound.states, c.path, c.motion], saved = {};
  for (const name of ['integrateBall', 'refineRacket', 'resolveRacketLaunch', 'trainingFeedBall', 'predict']) {
    saved[name] = lib.context[name]; lib.context[name] = () => { throw Error(`per-frame ${name}`); };
  }
  const newV = lib.V3.new, newQ = lib.Q.new;
  try {
    lib.V3.new = lib.Q.new = () => { throw Error('per-frame ball or sample allocation'); };
    for (let frame = 0; frame < 120; frame++) { p.update(1 / 120); p.render(); }
    lib.V3.new = newV; lib.Q.new = newQ;
    for (let frame = 0; frame < 60; frame++) {
      p.command('seek', frame / 60); p.command('rate', .25 + frame / 80);
      p.command('camera', { yaw: frame * .1, pitch: .5 }); p.render();
    }
    assert.equal(p.clip, c); [c.inbound.states, c.outbound.states, c.path, c.motion].forEach((value, i) => assert.equal(value, states[i]));
  } finally {
    lib.V3.new = newV; lib.Q.new = newQ;
    for (const name of Object.keys(saved)) lib.context[name] = saved[name];
    p.close();
  }
});

test('real-time reference playback follows physical timestamps at every rate and frame rate', () => {
  const { p, g } = fixture();
  for (const strokeId of ['DRIVE', 'LOB', 'SERVE_FAST']) for (const rate of [1, .75, .5, .25]) {
    const phases = [];
    for (const fps of [30, 60, 120]) {
      assert.equal(p.open({ strokeId, rate }), true);
      const c = p.clip;
      near(c.compiled.duration, 2.4, 1e-7);
      near(c.contactTime, Math.max(c.inbound.duration, c.physicalDuration * c.compiled.contactPhase));
      near(p.duration, c.contactTime + Math.max(c.outbound.duration, c.physicalDuration * (1 - c.compiled.contactPhase)));
      near(c.contactPhase, c.contactTime / p.duration);
      assert.ok(Math.abs(p.duration - 2.4) > .01, 'physical flight must not be stretched to the motion template');
      for (let i = 0; i < fps / 2; i++) p.update(1 / fps);
      near(p.phase * p.duration, rate / 2); phases.push(p.phase);
    }
    phases.forEach(phase => near(phase, phases[0]));
    p.command('contact'); near(p.phase, p.clip.contactPhase);
    vectorNear(p.ball.p, p.clip.ball.p);
    p.command('seek', (p.clip.contactTime + p.clip.outbound.bounces[0].t) / p.duration);
    vectorNear(p.ball.p, p.clip.outbound.bounces[0], 1e-7);
  }
  p.close();
});

test('reduced motion uses physical contact phase and never starts reference autoplay', () => {
  const { p, g } = fixture();
  g.motionOff = true; p.open({ strokeId: 'DRIVE' });
  near(p.phase, p.clip.contactPhase); assert.equal(p.playing, false);
  assert.ok(Math.abs(p.clip.contactPhase - p.clip.compiled.contactPhase) > .01);
  assert.equal(p.command('play'), false);
  p.update(.1); near(p.phase, p.clip.contactPhase);
  p.command('repeat'); assert.equal(p.playing, false); near(p.phase, 0);
  p.command('contact'); vectorNear(p.ball.p, p.clip.ball.p);
  p.command('seek', .25); p.update(.1); near(p.phase, .25);
  g.motionOff = false; g.reducedMotion = true; p.update(.1); assert.equal(p.reducedMotion, true);
  g.reducedMotion = false; p.update(.1); assert.equal(p.reducedMotion, false);
  p.command('play'); p.update(.8); assert.equal(p.playing, false);
  p.close();
});

test('player, side, top and orbit fit the full physical clip at safe mobile and desktop aspects', () => {
  for (const [w, h] of [[1280, 760], [390, 844], [360, 640], [844, 390]]) {
    const { p } = fixture(w, h); assert.equal(p.open({ strokeId: 'LOB' }), true);
    for (const camera of ['player', 'side', 'top']) {
      p.command('camera', camera); p.render();
      for (const point of p.clip.bounds) {
        const s = lib.projectPoint(p._cameraBuf.vp, point, {});
        assert.ok(s.ok && s.x >= .0749 && s.x <= .9251 && s.y >= .0849 && s.y <= .9151, `${w}/${h}/${camera}`);
      }
    }
    p.command('camera', { yaw: Math.PI * 1.32, pitch: .18 }); p.render();
    for (const point of p.clip.bounds) assert.equal(lib.projectPoint(p._cameraBuf.vp, point, {}).ok, true);
    p.command('camera', 'contact'); p.render();
    const contact = lib.projectPoint(p._cameraBuf.vp, p.clip.pose.point, {}); near(contact.x, .5, 2e-6); near(contact.y, .5, 2e-6);
    assert.ok(lib.V3.dot(lib.V3.sub(lib.V3.new(), p._cameraRig.eye, p.clip.pose.point), p.clip.racket.normal) > 0,
      'contact view should face the active rubber, not its passive back');
    p.close();
  }
});

test('table gesture rays are world-fixed, metre labels project with VP and invalid rays are gaps', () => {
  const { p } = fixture(); assert.equal(p.open({ strokeId: 'BANANA' }), true); p.render();
  const world = JSON.stringify(p.snapshot().gesture.world), vp = Array.from(p._cameraBuf.vp);
  for (const point of p._worldGuide) if (point) near(point.y, lib.PH.TABLE_Y + .003);
  const anchor = lib.projectPoint(p._guideBuf.vp, { x: p.clip.ball.p.x, y: lib.PH.TABLE_Y + .003, z: p.clip.ball.p.z }, {});
  for (let i = 0; i < p._worldGuide.length; i++) if (p._worldGuide[i]) {
    const screen = lib.projectPoint(p._guideBuf.vp, p._worldGuide[i], {});
    near(screen.x, anchor.x + p.profile.gesture.points[i][0], 1e-7);
    near(screen.y, anchor.y + p.profile.gesture.points[i][1], 1e-7);
  }
  p.command('camera', { yaw: 2.2, pitch: .7 }); p.render();
  assert.notDeepEqual(Array.from(p._cameraBuf.vp), vp); assert.equal(JSON.stringify(p.snapshot().gesture.world), world);
  assert.equal(p._tableRay(.5, -10, lib.V3.new()), null);
  assert.equal(p._tableRay(10, .5, lib.V3.new()), null);
  assert.ok(p._labels.every(label => label.text.includes('m')));
  p.close();
});

test('contact camera renders the requested timeline sample; only its reference inset stays frozen', () => {
  const { p, draws } = fixture(); assert.equal(p.open({ strokeId: 'DRIVE' }), true);
  p.command('camera', 'contact'); p.command('seek', .52); p.render();
  const ball = draws.find(draw => draw.buffer === 'ball'), blade = draws.find(draw => draw.buffer === 'blade');
  for (const [i, key] of [[12, 'x'], [13, 'y'], [14, 'z']]) {
    near(ball.model[i], p.ball.p[key], 1e-7); near(blade.model[i], p.racket.p[key], 1e-7);
  }
  assert.ok(lib.V3.dist(p.ball.p, p.clip.ball.p) > .005, 'scrub sample must differ from fixed contact');
  p.close();
});

test('imported preview models keep the same physical playing plane for both standard faces and the pan bottom', () => {
  for (const racket of ['r-standard', 'r-pan']) for (const forehand of [true, false]) {
    const { p, g, draws } = fixture();
    g._equippedRacket = racket;
    g.scene.rackets = {
      'r-standard': { faceOffset: .0043, singleFace: false, parts: [{ mesh: { ...g.scene.mesh.blade, ibo: 'atlas-paddle' }, mat: { color: [1, 1, 1] } }] },
      'r-pan': { faceOffset: .010, singleFace: true, parts: [{ mesh: { ...g.scene.mesh.blade, ibo: 'pan-bottom' }, mat: { color: [.2, .2, .2], metal: .9 } }] },
    };
    assert.equal(p.open({ strokeId: 'DRIVE', forehand }), true);
    p.command('camera', 'contact'); p.command('seek', .52);
    const before = gameHash(g); p.render();
    const model = g.scene.rackets[racket], drawn = draws.find(draw => draw.buffer === model.parts[0].mesh.ibo);
    assert.ok(drawn); assert.ok(!draws.some(draw => draw.buffer === 'blade'), 'imported geometry replaces the procedural paddle');
    const face = model.singleFace ? 1 : p.racket.activeFace;
    const point = lib.M4.transformPoint(lib.V3.new(), drawn.model, lib.V3.new(0, 0, face * model.faceOffset));
    const pose = lib.M4.compose(lib.M4.create(), p.racket.p, p.racket.q, lib.V3.new(1, 1, 1));
    vectorNear(point, lib.M4.transformPoint(lib.V3.new(), pose, lib.V3.new(0, 0, p.racket.activeFace * .010)), 1e-6);
    assert.equal(gameHash(g), before, 'preview renders cannot mutate game state');
    const elements = new Map(), element = selector => {
      if (!elements.has(selector)) elements.set(selector, { setAttribute() {} });
      return elements.get(selector);
    };
    p.root = { querySelector: element, querySelectorAll: () => [], toggleAttribute() {} };
    p.localize();
    assert.equal(element('.tt-preview-face').textContent, p._text(racket === 'r-pan' ? 'pan' : forehand ? 'red' : 'black'));
    p.root = null; p.close();
  }
});

test('same WebGL contact inset uploads its own camera, clears only scoped depth and restores presentation', () => {
  const { p, g, draws, clears, state, uniforms } = fixture(); assert.equal(p.open({ strokeId: 'CHOP_BLOCK' }), true);
  p.render();
  const vp = g.R.viewProj, cam = g.R.camPos, proj = g.R.proj, view = g.R.view;
  const expected = { viewport: state.viewport.slice(), scissor: state.scissor.slice(), scissorOn: state.enabled.has('SCISSOR_TEST'),
    depthMask: state.depthMask, framebuffer: state.framebuffer, program: state.program };
  draws.length = clears.length = 0; p._inset = { x: .78, y: .15, w: .17, h: .22 };
  p._insetClip = { x: .80, y: .20, w: .10, h: .14 };
  p.render();
  assert.equal(g.R.viewProj, vp); assert.equal(g.R.camPos, cam); assert.equal(g.R.proj, proj); assert.equal(g.R.view, view);
  const worldDraws = draws.filter(draw => !draw.present), main = worldDraws[0], last = worldDraws.at(-1);
  assert.notDeepEqual(main.vp, last.vp); assert.notDeepEqual(main.cam, last.cam);
  assert.deepEqual(last.vp, Array.from(p._insetBuf.vp));
  assert.deepEqual(last.cam, Object.values(p._insetRig.eye));
  assert.ok(last.viewport[2] > last.scissor[2] && last.viewport[3] > last.scissor[3],
    'scroll clipping must crop the inset, not stretch its camera viewport');
  assert.ok(clears.some(clear => clear.mask === 2 && clear.scoped && clear.depthMask && clear.scissor[2] < g.R._w));
  assert.equal(draws.at(-1).program, 'composite');
  assert.deepEqual(uniforms.get('uViewProj'), Array.from(vp)); assert.deepEqual(uniforms.get('uCam'), Object.values(cam));
  assert.deepEqual(state.viewport, expected.viewport); assert.deepEqual(state.scissor, expected.scissor);
  assert.equal(state.enabled.has('SCISSOR_TEST'), expected.scissorOn); assert.equal(state.depthMask, expected.depthMask);
  assert.equal(state.framebuffer, expected.framebuffer); assert.equal(state.program, expected.program);
  p.close();
});

test('render failures restore the exact gameplay matrices and GL viewport/scissor', () => {
  const { p, g, state } = fixture(); p.open({ strokeId: 'DRIVE' }); p.render();
  const before = gameHash(g), viewport = state.viewport.slice(), scissor = state.scissor.slice(),
    enabled = new Set(state.enabled), depthMask = state.depthMask, framebuffer = state.framebuffer, program = state.program;
  g.R.draw = () => { throw Error('synthetic GL failure'); };
  assert.equal(p.render(), false); delete g.R.draw;
  assert.equal(p.active, false); assert.equal(p.clip, null); assert.equal(p.error, lib.ET('preview.unavailable'));
  assert.equal(gameHash(g), before); assert.deepEqual(state.viewport, viewport); assert.deepEqual(state.scissor, scissor);
  assert.deepEqual(state.enabled, enabled); assert.equal(state.depthMask, depthMask);
  assert.equal(state.framebuffer, framebuffer); assert.equal(state.program, program);
  assert.equal(p.command('play'), false); assert.equal(p.close(), false);
});

test('close restores exact unmodified pause/audio state but preserves sound changes made during preview', () => {
  for (const paused of [false, true]) for (const quiet of [false, true]) for (const muted of [false, true]) {
    const { p, g } = fixture(); g.paused = paused; g.audio.setQuiet(quiet); g.audio.setMuted(muted);
    const before = gameHash(g, false), levels = { ...g.audio.levels };
    p.open({ strokeId: 'DRIVE' });
    assert.equal(g.paused, true); assert.equal(g.audio.quiet, true);
    p.close(); assert.equal(g.paused, paused); assert.equal(g.audio.quiet, quiet); assert.equal(g.audio.muted, muted);
    assert.deepEqual({ ...g.audio.levels }, levels); assert.equal(gameHash(g, false), before);
    assert.equal(p.close(), false); assert.equal(p._cache.size, 0); assert.equal(p.clip, null);
    g.audio.setLevels({ master: .9, effects: 0, music: .8 }); g.audio.setMuted(!muted); g.settings.volume = .9;
    const changed = gameHash(g, false), changedLevels = { ...g.audio.levels };
    g.audio.setLevels(levels); g.audio.setMuted(muted); g.settings.volume = .43;
    p.open({ strokeId: 'DRIVE' });
    g.audio.setLevels(changedLevels); g.audio.setMuted(!muted); g.settings.volume = .9;
    p.close(); assert.equal(g.paused, paused); assert.equal(g.audio.quiet, quiet); assert.equal(g.audio.muted, !muted);
    assert.deepEqual({ ...g.audio.levels }, changedLevels); near(g.audio.volume, .9); near(g.settings.volume, .9);
    assert.equal(gameHash(g, false), changed, 'close must not overwrite newly selected mute, levels or volume');
  }
  const { p, g } = fixture(); p.open({ strokeId: 'DRIVE' }); p.close(false);
  assert.equal(g.paused, true); assert.equal(g.audio.quiet, true);
  assert.equal(p._listeners.length, 0); assert.equal(p._pointers.size, 0);
});

for (const fps of [30, 60, 120]) test(`attempt recorder resamples ${fps}fps into the exact 43-float 30Hz layout`, () => {
  const { g } = fixture(), meta = { attemptId: 7, sessionId: 'record-test' };
  const r = new lib.TrainingAttemptRecorder(g, meta);
  assert.equal(lib.TRAIN_ATTEMPT_HZ, 30); assert.equal(lib.TRAIN_ATTEMPT_STRIDE, 43); assert.equal(lib.TRAIN_ATTEMPT_CAP, 240);
  const buffer = r.frames;
  for (let i = 0; i <= fps; i++) { setRecordedState(g, i / fps); assert.equal(r.push(i / fps, i / fps * .65), true); }
  const c = r.finish({ success: false, reason: 'miss' });
  assert.equal(r.frames, buffer); assert.equal(buffer.length, 240 * 43);
  assert.equal(Object.prototype.toString.call(c.frames), '[object Float64Array]');
  assert.notEqual(c.frames.buffer, r.frames.buffer); assert.equal(c.frames.length, c.count * 43);
  assert.equal(c.schema, 1); assert.equal(c.hz, 30); assert.equal(c.stride, 43); assert.equal(c.count, 31);
  assert.equal(c.truncated, false); assert.ok(lib.validTrainingAttempt(c));
  for (let i = 0; i < c.count; i++) { near(c.frames[i * 43], i / 30); near(c.frames[i * 43 + 1], i / 30 * .65); }
  const f = Array.from(c.frames.slice(-43));
  const values = v => ['x', 'y', 'z'].map(key => v[key]), quat = q => ['x', 'y', 'z', 'w'].map(key => q[key]);
  const expected = [1, .65, ...values(g.ball.p), ...values(g.ball.v), ...values(g.ball.w), ...quat(g.ball.q),
    ...values(g.player.pos), ...quat(g.player.q), ...values(g.player.normal), g.player.roll, -1, 0,
    ...values(g.aiPaddle.pos), ...quat(g.aiPaddle.q), ...values(g.aiPaddle.normal), g.aiPaddle.roll, 1, 1, -1, 1];
  f.forEach((value, i) => near(value, expected[i]));
  assert.ok(Math.hypot(...f.slice(8, 11)) > 300, 'physical spin is not the visual quaternion rate');
  near(Math.hypot(...f.slice(11, 15)), 1);
});

test('attempt sampler interpolates both complete paddle poses and separate physical spin/display orientation without physics or RNG', () => {
  const { g } = fixture(), r = new lib.TrainingAttemptRecorder(g, {});
  setRecordedState(g, 0); r.push(0, 0); setRecordedState(g, 1); r.push(1, .65);
  const c = r.finish({ success: false }), out = attemptOutput(), before = gameHash(g, false), copy = Array.from(c.frames);
  const refs = [out.ball.p, out.ball.v, out.ball.w, out.ball.q, out.player.pos, out.player.q, out.player.normal,
    out.opponent.pos, out.opponent.q, out.opponent.normal];
  const saved = {}, math = lib.context.Math, random = math.random, newV = lib.V3.new, newQ = lib.Q.new;
  for (const name of ['integrateBall', 'predict', 'trainingFeedBall', 'resolveRacketLaunch', 'racketForStroke']) {
    saved[name] = lib.context[name]; lib.context[name] = () => { throw Error(`actual sampler called ${name}`); };
  }
  try {
    math.random = lib.V3.new = lib.Q.new = () => { throw Error('actual sampler allocated or consumed RNG'); };
    for (const seconds of [-1, 0, .017, .123, .515, .999, 1, 4]) {
      assert.equal(lib.sampleTrainingAttempt(c, seconds, out), out);
      const time = Math.max(0, Math.min(1, seconds)); near(out.real, time); near(out.simulation, time * .65);
      vectorNear(out.ball.p, { x: .1 + time, y: 1.2 + time * .2, z: .9 - time * .3 });
      vectorNear(out.ball.v, { x: 1, y: .2, z: -.3 }); vectorNear(out.ball.w, { x: 320 + time, y: -73, z: 19 });
      for (const [pad, side] of [[out.player, 1], [out.opponent, -1]]) {
        vectorNear(pad.pos, { x: side * (.2 + time * .1), y: 1.3 + time * .05, z: side * 1.7 });
        vectorNear(pad.normal, { x: 0, y: 0, z: -side }); near(pad.roll, .23 + time * side);
        near(Math.hypot(...Object.values(pad.q)), 1);
      }
      near(Math.hypot(...Object.values(out.ball.q)), 1); assert.equal(out.ball.lastHitBy, -1); assert.equal(out.gap, false);
    }
    for (const seconds of [NaN, Infinity, undefined]) assert.equal(lib.sampleTrainingAttempt(c, seconds, out), false);
    assert.equal(lib.sampleTrainingAttempt(null, .1, out), false);
    assert.equal(gameHash(g, false), before); assert.deepEqual(Array.from(c.frames), copy);
    [out.ball.p, out.ball.v, out.ball.w, out.ball.q, out.player.pos, out.player.q, out.player.normal,
      out.opponent.pos, out.opponent.q, out.opponent.normal].forEach((value, i) => assert.equal(value, refs[i]));
  } finally {
    math.random = random; lib.V3.new = newV; lib.Q.new = newQ;
    for (const name of Object.keys(saved)) lib.context[name] = saved[name];
  }
});

test('attempt recorder preserves off-grid exact contact/outcome, bounds long clips and refuses interpolation across trimmed gaps', () => {
  const { g } = fixture(), r = new lib.TrainingAttemptRecorder(g, {});
  setRecordedState(g, 0); r.push(0, 0);
  setRecordedState(g, .12345); r.event('contact', .12345, .0802425, { side: 1, strokeId: 'DRIVE' });
  const contact = Array.from(r.input);
  for (let i = 16; i <= 1800; i++) { setRecordedState(g, i / 120); r.push(i / 120, i / 120 * .65); }
  r.event('outcome', 15.012345, 9.75802425, { success: false, reason: 'miss' });
  const c = r.finish({ success: false, reason: 'miss' });
  assert.equal(c.count, 240); assert.equal(c.truncated, true); assert.ok(lib.validTrainingAttempt(c));
  assert.deepEqual(Array.from(c.frames.slice(0, 43)), contact);
  near(c.frames[(c.count - 1) * 43], 15.012345); near(c.frames[(c.count - 1) * 43 + 1], 9.75802425);
  assert.equal(c.events.at(-1).type, 'outcome'); assert.equal(c.events.find(e => e.type === 'contact').real, .12345);
  assert.equal(c.outcome.reason, 'miss'); assert.equal(c.gaps.length, 1);
  const gap = c.gaps[0], out = attemptOutput(); assert.ok(gap.to > gap.from + 1);
  lib.sampleTrainingAttempt(c, (gap.to - gap.from) / 2, out); assert.equal(out.gap, true);
  vectorNear(out.ball.p, { x: contact[2], y: contact[3], z: contact[4] });
  vectorNear(out.ball.w, { x: contact[8], y: contact[9], z: contact[10] });
  near(out.simulation, contact[1]);
  lib.sampleTrainingAttempt(c, gap.to - c.startReal, out); assert.equal(out.gap, false);
  vectorNear(out.ball.p, { x: c.frames[45], y: c.frames[46], z: c.frames[47] });
  for (let i = 1; i < c.count; i++) assert.ok(c.frames[i * 43] >= c.frames[(i - 1) * 43]);
});

test('Game.update records only active real/simulation time through pause, freeze and guided 0.65 tempo', () => {
  const { g } = gameLoopFixture({ adaptive: true, hint: true }), t = g.training;
  for (let i = 0; i < 12; i++) g.update(1 / 60);
  near(t.activeReal, .2); near(t.activeSim, .13); near(g.timeScale, .65);
  const n = t.recording.n, time = g.time, sim = g.strokeTime, active = [t.activeReal, t.activeSim], ball = plain(g.ball);
  g.setPaused(true); assert.equal(g.paused, true);
  for (let i = 0; i < 120; i++) g.update(1 / 60);
  near(g.time, time); near(g.strokeTime, sim); assert.deepEqual([t.activeReal, t.activeSim], active); assert.equal(t.recording.n, n);
  assert.deepEqual(plain(g.ball), ball);
  g.setPaused(false); t.frozen = true;
  for (let i = 0; i < 120; i++) g.update(1 / 60);
  near(g.time, time); near(g.strokeTime, sim); assert.deepEqual([t.activeReal, t.activeSim], active); assert.equal(t.recording.n, n);
  assert.deepEqual(plain(g.ball), ball);
  g.setPaused(true); g.settings.hint = g.hintRequested = false; g.update(1 / 60);
  assert.equal(t.frozen, false); assert.equal(g.paused, true); assert.deepEqual([t.activeReal, t.activeSim], active);
  g.setPaused(false); for (let i = 0; i < 6; i++) g.update(1 / 60);
  near(t.activeReal, .3); near(t.activeSim, .23); near(g.timeScale, 1);
  assert.notDeepEqual(plain(g.ball.p), ball.p, 'the real physics resumes at normal tempo after hint OFF');
  t.onFault(-1, 'miss'); const c = t.attemptClip;
  near(c.endReal, .3); near(c.frames[(c.count - 1) * 43 + 1], .23);
  assert.ok(c.endReal < 1, 'paused and frozen menu time must not enter playback');
  lib.setCaptureForgiveness(1);
});

test('Game.update begins recording before owners and samples after both paddle owners and final clamps', () => {
  const { g } = gameLoopFixture(), t = g.training, order = [];
  g.ball.live = false;
  const begin = t.beginRecordingFrame.bind(t), capture = t.captureRecordingFrame.bind(t);
  t.beginRecordingFrame = (...args) => { order.push('begin'); begin(...args); };
  g.updatePlayerPaddle = () => { order.push('player'); lib.V3.set(g.player.pos, .3, 1.4, 1.6); };
  g.updateOpponentPose = () => { order.push('opponent'); lib.V3.set(g.aiPaddle.pos, -.4, 1.5, -1.6); };
  g.keepPaddleOnScreen = () => { order.push('screen'); g.player.pos.x = .25; };
  g.clampPaddleVolume = () => { order.push('clamp'); g.player.pos.y = 1.35; };
  t.captureRecordingFrame = () => { order.push('capture'); capture(); };
  g.update(1 / 30);
  assert.deepEqual(order, ['begin', 'player', 'opponent', 'screen', 'clamp', 'capture']);
  const c = t.recording.finish({ success: false }), out = attemptOutput(); lib.sampleTrainingAttempt(c, 1 / 30, out);
  vectorNear(out.player.pos, g.player.pos); vectorNear(out.opponent.pos, g.aiPaddle.pos);
});

test('actual contact pipeline copies original gesture timestamps before cancel and preserves exact incoming/outgoing/terminal frames', () => {
  const { g, p } = gameLoopFixture({ stroke: 'BLOCK' }), t = g.training, V = lib.V3;
  V.set(g.ball.p, .12, 1.12, .9); V.set(g.ball.v, .3, -.5, 7); V.set(g.ball.w, 35, 9, -3);
  lib.Q.setAxisAngle(g.ball.q, 0, 1, 0, .48); const incoming = plain(g.ball);
  g.rallyBounces = [1]; g.swipe.down(.4, .6, 42.001, 12.003); g.swipe.up(.4, .6, 42.045, 12.047);
  g.swipe.pressZone = { accepted: true, shotId: g.shotId, distancePx: 0, pressT: 42.001 };
  const points = plain(g.swipe.samples), gestureId = g.swipe.gestureId;
  const m = lib.context.tapStrokeMetrics({ ...g.swipe.lastReleased }, .4, .6, false);
  t.beginRecordingFrame(.1, .065); g._trainingSubFraction = .375;
  g.tryPlayerHit = lib.Game.prototype.tryPlayerHit;
  g.tryPlayerHit(V.clone(g.ball.p), m, { pos: V.clone(g.ball.p), prevPos: V.clone(g.ball.p), normal: V.new(0, 0, -1) });
  assert.ok(t.lastShot, 'real input/contact pipeline must physically hit'); assert.equal(t.lastShot.stroke, 'BLOCK');
  assert.equal(g.swipe.samples.length, 0, 'the real Game hit consumes the swipe');
  const event = t.recording.events.find(e => e.type === 'contact'), gesture = t.recording.gestures.find(e => e.gestureId === gestureId);
  near(event.real, .0375); near(event.simulation, .024375); assert.equal(event.gestureId, gestureId);
  assert.deepEqual(plain(gesture.points), points); near(gesture.contactReal, event.real);
  near(gesture.startSimTime, 12.003); near(gesture.sampleSimTime, 12.047);
  for (const key of ['p', 'v', 'w']) vectorNear(event.incoming[key], incoming[key]); quaternionNear(event.incoming.q, incoming.q);
  const outgoing = plain(g.ball), pose = plain(g.player);
  for (const key of ['p', 'v', 'w']) vectorNear(event.outgoing[key], outgoing[key]); quaternionNear(event.outgoing.q, incoming.q);
  assert.ok(event.pose); vectorNear(event.pose.pos, pose.pos); quaternionNear(event.pose.q, pose.q);
  g._trainingSubFraction = null; t.captureRecordingFrame(); g.tryPlayerHit = () => {};
  let terminalTime, terminalBall;
  const physics = g.stepPhysics;
  g.stepPhysics = function(dt) {
    const time = t.recordingTime(); physics.call(this, dt);
    if (t.attemptClip && !terminalTime) { terminalTime = time; terminalBall = plain(this.ball); }
  };
  for (let i = 0; i < 300 && t.phase === 'live'; i++) g.update(1 / 60);
  const c = t.attemptClip; assert.ok(lib.validTrainingAttempt(c)); assert.ok(terminalTime);
  assert.equal(c.outcome.contact, true); assert.equal(c.outcome.legal, true); assert.ok(c.events.some(e => e.type === 'bounce'));
  const terminal = c.events.at(-1); assert.equal(terminal.type, 'outcome');
  near(terminal.real, terminalTime[0]); near(terminal.simulation, terminalTime[1]); near(c.endReal, terminal.real);
  const last = (c.count - 1) * 43; near(c.frames[last + 1], terminal.simulation);
  for (const [offset, value] of [[2, terminalBall.p], [5, terminalBall.v], [8, terminalBall.w]])
    ['x', 'y', 'z'].forEach((key, i) => near(c.frames[last + offset + i], value[key]));
  const exact = Array.from({ length: c.count }, (_, i) => i * 43).filter(i => Math.abs(c.frames[i] - event.real) < 1e-12);
  assert.ok(exact.length >= 2, 'pre-impulse and post-impulse contact states are both exact');
  for (const [at, ball] of [[exact[0], incoming], [exact.at(-1), outgoing]])
    for (const [offset, value] of [[2, ball.p], [5, ball.v], [8, ball.w]]) ['x', 'y', 'z'].forEach((key, i) => near(c.frames[at + offset + i], value[key]));
  assert.equal(p.open({ source: 'attempt', attemptId: c.attemptId, play: false }), true);
  assert.equal(p.command('contact'), true); near(p.phase, p.clip.contactPhase);
  const s = p.snapshot(); near(s.sample.real, event.real); near(s.sample.simulation, event.simulation);
  for (const key of ['p', 'v', 'w']) vectorNear(s.sample.ball[key], outgoing[key]); quaternionNear(s.sample.ball.q, outgoing.q);
  vectorNear(s.sample.player.pos, pose.pos); quaternionNear(s.sample.player.q, pose.q);
  assert.deepEqual(plain(s.gesture.points), points); assert.equal(s.contact.gestureId, gestureId); assert.equal(p.render(), true);
  p.close();
});

test('a real missed feed produces an actual 3D clip without inventing a contact or generating an example', () => {
  const { g, p, draws } = completedAttempt({ inputMode: 'mouse' }), t = g.training, c = t.attemptClip;
  assert.equal(c.outcome.success, false); assert.equal(c.outcome.contact, false);
  assert.equal(c.events.some(e => e.type === 'contact'), false); assert.ok(c.events.some(e => e.type === 'bounce'));
  assert.ok(c.events.some(e => e.type === 'floor')); assert.equal(c.events.at(-1).type, 'outcome');
  assert.equal(c.attemptId, c.metadata.attemptId); assert.equal(c.sessionId, c.metadata.sessionId);
  assert.equal(c.metadata.hand, g.settings.hand); assert.equal(c.metadata.grip, g.settings.grip);
  assert.deepEqual(plain(t.snapshot().attemptReplay), { available: true, attemptId: c.attemptId, truncated: false });
  const before = gameHash(g), duration = c.endReal - c.startReal;
  p._prepare = () => { throw Error('miss actual must never generate example'); };
  assert.equal(p.open({ source: 'attempt', attemptId: c.attemptId, rate: 1, play: false }), true, p.error);
  p.command('seek', .37); assert.equal(p.render(), true);
  const s = p.snapshot(), out = attemptOutput(); lib.sampleTrainingAttempt(c, duration * .37, out);
  assert.equal(s.source, 'attempt'); assert.equal(s.attemptId, c.attemptId); assert.equal(s.contact, null); assert.equal(s.contactPhase, null);
  assert.equal(s.physics.recorded, true); assert.equal(s.physics.hz, 30); assert.equal(s.physics.frames, c.count);
  near(s.physics.startReal, c.startReal); near(s.physics.endReal, c.endReal); near(s.duration, duration);
  assert.deepEqual(plain(s.outcome), plain(c.outcome)); near(s.sample.real, out.real); near(s.sample.simulation, out.simulation);
  for (const key of ['p', 'v', 'w']) vectorNear(s.sample.ball[key], out.ball[key]); quaternionNear(s.sample.ball.q, out.ball.q);
  for (const side of ['player', 'opponent']) { vectorNear(s.sample[side].pos, out[side].pos); quaternionNear(s.sample[side].q, out[side].q); vectorNear(s.sample[side].normal, out[side].normal); }
  const blades = draws.filter(draw => draw.buffer === 'blade'); assert.equal(blades.length, 2);
  for (const [draw, pad] of [[blades[0], out.player], [blades[1], out.opponent]])
    for (const [i, key] of [[12, 'x'], [13, 'y'], [14, 'z']]) near(draw.model[i], pad.pos[key], 1e-7);
  const phase = p.phase; assert.equal(p.command('contact'), false); near(p.phase, phase);
  assert.equal(gameHash(g), before); p.close();
});

test('actual playback controls change only preview clocks and preserve Trainer/RNG/physics/live state', () => {
  const { p, g } = completedAttempt({ variation: true, adaptive: true }), c = g.training.attemptClip;
  const before = gameHash(g), config = JSON.stringify([lib.PH, lib.STROKE_CONFIG]), saved = {};
  for (const name of ['integrateBall', 'predict', 'trainingFeedBall', 'racketForStroke', 'resolveRacketLaunch']) {
    saved[name] = lib.context[name]; lib.context[name] = () => { throw Error(`actual preview called ${name}`); };
  }
  const random = lib.context.Math.random, trainerRandom = g.training.random;
  lib.context.Math.random = g.training.random = () => { throw Error('actual preview consumed RNG'); };
  try {
    for (const rate of [1, .5, .25]) for (const fps of [30, 60, 120]) {
      assert.equal(g.openTrainingPreview({ source: 'attempt', attemptId: c.attemptId, rate }), true);
      g.update(.1); g.setPaused(false); assert.equal(g.paused, true);
      for (let i = 0; i < fps / 2; i++) p.update(1 / fps);
      near(p.phase * p.duration, rate * .5); assert.equal(p.command('pause'), true);
      const phase = p.phase; p.update(.1); near(p.phase, phase);
      p.command('camera', { yaw: 1.2, pitch: .5 }); assert.equal(p.render(), true);
      p.command('repeat'); near(p.phase, 0); assert.equal(p.playing, true);
      p.snapshot(); assert.equal(gameHash(g), before);
    }
    p.close(); assert.equal(gameHash(g), before); assert.equal(JSON.stringify([lib.PH, lib.STROKE_CONFIG]), config);
  } finally {
    p.close(); lib.context.Math.random = random; g.training.random = trainerRandom;
    for (const name of Object.keys(saved)) lib.context[name] = saved[name];
  }
});

test('completed actual buffers stay detached across next feed, replacement, neutral cleanup and monotonic restart IDs', () => {
  const { g } = completedAttempt(), t = g.training, first = t.attemptClip, hash = gameHash({ first }, false), id = first.attemptId;
  t.feed(); assert.equal(t.attemptId, id + 1); assert.equal(t.getAttemptClip(id), first);
  g.ball.p.x = 99; g.ball.v.y = 88; g.ball.w.z = 77; g.ball.q.x = .2; g.player.pos.x = .8; g.aiPaddle.pos.z = -8;
  g.settings.hand = 'left'; g.settings.grip = 'penhold'; t.recording.frames.fill(0);
  assert.equal(gameHash({ first }, false), hash); assert.equal(first.metadata.hand, 'right'); assert.equal(first.metadata.grip, 'shakehand');
  t.onSystemFault('feeder'); assert.equal(t.recording, null); assert.equal(t.recordingFrame, null);
  assert.equal(t.getAttemptClip(id), null); assert.equal(t.snapshot().attemptReplay.available, false);
  t.feed(); assert.equal(t.attemptId, id + 2); g.ball.q.x = 0;
  for (let i = 0; i < 300 && t.phase === 'live'; i++) g.update(1 / 60);
  assert.ok(t.attemptClip); assert.ok(t.attemptClip.attemptId > id); assert.equal(t.getAttemptClip(id), null);
  assert.equal(gameHash({ first }, false), hash);
  const previous = t.attemptId; assert.equal(t.action('restart'), true); assert.equal(t.attemptClip, null); assert.equal(t.recording, null);
  t.action('start'); t.feed(); assert.ok(t.attemptId > previous); assert.equal(t.getAttemptClip(id), null);
  t.quit(); assert.equal(t.recording, null); assert.equal(t.attemptClip, null); assert.equal(g.training, null);
});

test('actual missing/stale IDs and unsupported clip formats never take ownership or silently become examples', async t => {
  const { g, p } = completedAttempt(), trainer = g.training, c = trainer.attemptClip;
  for (const [name, options] of [
    ['missing', { source: 'attempt' }], ['stale', { source: 'attempt', attemptId: c.attemptId + 1 }],
    ['string ID', { source: 'attempt', attemptId: String(c.attemptId) }], ['fractional ID', { source: 'attempt', attemptId: 1.5 }],
    ['session', { source: 'attempt', attemptId: c.attemptId, sessionId: 'retired' }],
    ['request', { source: 'attempt', attemptId: c.attemptId, trainRequestId: 999 }], ['source', { source: 'predicted', strokeId: 'DRIVE' }],
  ]) await t.test(name, () => {
    const before = gameHash(g, false); assert.equal(g.openTrainingPreview(options), false);
    assert.equal(p.active, false); assert.equal(gameHash(g, false), before);
  });
  for (const [name, patch] of [
    ['schema', { schema: 2 }], ['hz', { hz: 60 }], ['stride', { stride: 16 }], ['too short', { count: 1 }],
    ['over cap', { count: 241 }], ['missing frames', { frames: null }], ['unfinished time', { endReal: c.startReal }],
    ['non-finite frame', { frames: c.frames.map((value, i) => i === 8 ? NaN : value) }],
    ['wrong precision', { frames: Float32Array.from(c.frames) }],
  ]) await t.test(name, () => {
    trainer.attemptClip = { ...c, ...patch };
    try {
      const before = gameHash(g, false); assert.equal(lib.validTrainingAttempt(trainer.attemptClip), false);
      assert.equal(trainer.getAttemptClip(c.attemptId), null); assert.equal(p.open({ source: 'attempt', attemptId: c.attemptId }), false);
      assert.equal(p.error, lib.ET('preview.unavailable')); assert.equal(p.active, false); assert.equal(gameHash(g, false), before);
    } finally { p.close(); trainer.attemptClip = c; }
  });
});

test('unfinished checks block both sources, but completed four-attempt reviews/done permit read-only actual under calibration lock', () => {
  const { g, p } = completedAttempt(), t = g.training, c = t.attemptClip;
  t.stage = 'check'; assert.equal(lib.gameplayCalibrationLocked(g), true);
  for (const phase of ['live', 'fail', 'review', 'done']) for (const attempts of [0, 1, 3]) {
    t.phase = phase; t.attempts = attempts;
    assert.equal(t.getAttemptClip(c.attemptId), null);
    for (const source of ['attempt', 'example']) assert.equal(g.openTrainingPreview({ source, attemptId: c.attemptId, strokeId: 'DRIVE' }), false);
  }
  for (const phase of ['review', 'done']) {
    t.phase = phase; t.attempts = 4; t.finished = phase === 'done';
    const before = gameHash(g);
    assert.equal(t.getAttemptClip(c.attemptId), c);
    assert.equal(g.openTrainingPreview({ source: 'attempt', attemptId: c.attemptId }), true, p.error);
    p.command('seek', .5); assert.equal(p.render(), true); p.close(); assert.equal(gameHash(g), before);
  }
});

test('actual profile is immutable and source switching is sequential/local without losing the recorded attempt', () => {
  const { p, g } = completedAttempt(), c = g.training.attemptClip, before = gameHash(g);
  assert.equal(p.open({ source: 'attempt', attemptId: c.attemptId, play: false }), true);
  const profile = plain(p.profile), frames = c.frames;
  for (const [action, value] of [['hand', 'left'], ['grip', 'penhold'], ['forehand', false]]) {
    assert.equal(p.command(action, value), false); assert.deepEqual(plain(p.profile), profile);
  }
  assert.equal(p.command('source', 'example'), true); assert.equal(p.snapshot().source, 'example'); assert.equal(p.playing, false);
  assert.equal(p.command('hand', 'left'), true); assert.equal(p.command('grip', 'penhold'), true);
  assert.equal(p.command('source', 'attempt'), true); assert.equal(p.snapshot().source, 'attempt'); assert.equal(p.clip.record, c);
  assert.deepEqual(plain(p.profile), profile); assert.equal(c.frames, frames); assert.equal(p.playing, false);
  assert.equal(p.command('source', 'unknown'), false); assert.equal(p.clip.record, c); assert.equal(gameHash(g), before);
  p.close(); assert.equal(gameHash(g), before);
});

test('reduced-motion actual never autoplays and resize refits presentation without advancing any clock or simulation', () => {
  const { p, g } = completedAttempt(), c = g.training.attemptClip;
  g.reducedMotion = true; assert.equal(p.open({ source: 'attempt', attemptId: c.attemptId, play: true }), true);
  assert.equal(p.playing, false); assert.equal(p.command('play'), false); p.command('repeat'); assert.equal(p.playing, false);
  p.command('seek', .4); p.update(.1); near(p.phase, .4); p.render();
  const sample = plain(p.snapshot().sample), vp = Array.from(p._cameraBuf.vp), frames = c.frames;
  g.R._w = 390; g.R._h = 844; const before = gameHash(g); assert.equal(p.render(), true);
  assert.notDeepEqual(Array.from(p._cameraBuf.vp), vp); assert.deepEqual(plain(p.snapshot().sample), sample);
  assert.equal(c.frames, frames); assert.equal(gameHash(g), before);
  for (const point of p.clip.bounds) { const s = lib.projectPoint(p._cameraBuf.vp, point, {}); assert.ok(s.ok && s.x >= .0749 && s.x <= .9251 && s.y >= .0849 && s.y <= .9151); }
  p.close();
});

test('attempt recorder discards incomplete or poisoned data and rejects backwards/non-finite real timestamps', () => {
  const { g } = fixture(), r = new lib.TrainingAttemptRecorder(g, {});
  r.push(0, 0); assert.equal(r.finish({ success: false }), null);
  r.push(.1, .065); const count = r.n;
  for (const real of [-.1, NaN, Infinity]) assert.equal(r.push(real, .07, true), false);
  assert.equal(r.n, count); assert.equal(r.push(.2, Infinity), false);
  g.ball.w.x = NaN; assert.equal(r.push(.2, .13), false); assert.equal(r.finish({ success: false }), null);
});

test('attempt sampler follows the shortest quaternion arc and keeps face/visibility flags discrete', () => {
  const { g } = fixture(), r = new lib.TrainingAttemptRecorder(g, {});
  setRecordedState(g, 0); r.push(0, 0); setRecordedState(g, 1); r.push(1, .65);
  const c = r.finish({ success: false }), out = attemptOutput();
  for (let i = 0; i < c.count; i++) {
    const at = i * 43;
    for (const start of [11, 18, 31]) for (let j = 0; j < 4; j++) c.frames[at + start + j] = (i % 2 ? -1 : 1) * (j === 3 ? 1 : 0);
    c.frames[at + 26] = i < 15 ? 1 : -1; c.frames[at + 27] = i < 15 ? 1 : 0;
    c.frames[at + 39] = i < 15 ? -1 : 1; c.frames[at + 40] = i < 15 ? 0 : 1;
  }
  for (const seconds of [.017, .123, .499, .5, .515, .999]) {
    lib.sampleTrainingAttempt(c, seconds, out);
    for (const q of [out.ball.q, out.player.q, out.opponent.q]) quaternionNear(q, { x: 0, y: 0, z: 0, w: 1 });
    assert.equal(out.player.activeFace, seconds < .5 ? 1 : -1); assert.equal(out.player.visible, seconds < .5);
    assert.equal(out.opponent.activeFace, seconds < .5 ? -1 : 1); assert.equal(out.opponent.visible, seconds >= .5);
  }
});

test('attempt gesture/event/outcome data is bounded, timestamp-faithful and detached after finish', () => {
  const { g } = fixture(), r = new lib.TrainingAttemptRecorder(g, {});
  r.push(0, 0); r.push(.2, .13);
  const swipe = { gestureId: 1, samples: Array.from({ length: 100 }, (_, i) => ({ x: i / 100, y: .7 - i / 200, t: 83.001 + i * .001 })),
    startSimTime: 12.345, sampleSimTime: 12.409, evictedPathLen: .1, originX: .1, originY: .7, originT: 83.001 };
  for (let id = 1; id <= 40; id++) { swipe.gestureId = id; r.gesture(swipe, .2, .13, id === 40); }
  const data = { point: { x: .12, y: 1.2, z: .9 } }, outcome = { success: false, landing: { x: .1, z: -1 } };
  r.event('contact', .212345, .13802425, { ...data, side: 1, strokeId: 'DRIVE' });
  r.event('outcome', .3, .195, outcome); const c = r.finish(outcome), hash = gameHash({ c }, false);
  assert.equal(c.gestures.length, 32); const gesture = c.gestures.at(-1);
  assert.equal(gesture.gestureId, 40); assert.equal(gesture.points.length, 64); assert.equal(gesture.truncated, true);
  assert.deepEqual(plain(gesture.points.at(-1)), swipe.samples.at(-1));
  near(gesture.startSimTime, 12.345); near(gesture.sampleSimTime, 12.409); near(gesture.contactReal, .2);
  r.frames.fill(0); r.events[0].point.x = 88; r.gestures.at(-1).points.at(-1).t = 99; outcome.landing.x = 77; swipe.samples.length = 0;
  assert.equal(gameHash({ c }, false), hash);
});

test('touch actual preserves recorded hidden-player visibility without replacing either recorded pose', () => {
  const { p, g, draws } = completedAttempt(), c = g.training.attemptClip;
  assert.equal(p.open({ source: 'attempt', attemptId: c.attemptId, play: false }), true); p.command('seek', .4);
  assert.equal(p._attemptSample.player.visible, false); assert.equal(p._attemptSample.opponent.visible, true);
  assert.equal(p.render(), true); assert.equal(draws.filter(draw => draw.buffer === 'blade').length, 1);
  const out = attemptOutput(); lib.sampleTrainingAttempt(c, p.phase * p.duration, out);
  vectorNear(p.racket.p, out.player.pos); vectorNear(p._attemptSample.opponent.pos, out.opponent.pos); p.close();
});

test('attempt bounded event history retains the last player contact and final outcome after later bounce overflow', () => {
  const { g } = fixture(), r = new lib.TrainingAttemptRecorder(g, {});
  setRecordedState(g, 0); r.push(0, 0); setRecordedState(g, .12345);
  r.event('contact', .12345, .0802425, { side: 1, strokeId: 'DRIVE', point: { ...g.ball.p } });
  for (let i = 1; i <= 100; i++) {
    const real = .2 + i * .1; setRecordedState(g, real);
    r.event('bounce', real, real * .65, { side: i % 2 ? -1 : 1, point: { ...g.ball.p } });
  }
  r.event('outcome', 10.212345, 6.63802425, { success: false, reason: 'miss' });
  const c = r.finish({ success: false, reason: 'miss' });
  assert.ok(c.truncated); assert.ok(c.events.length <= 64); assert.ok(c.count <= 240);
  const contact = c.events.find(e => e.type === 'contact' && e.side === 1);
  assert.ok(contact, 'trimming later bounce history must not turn a real contact into a no-contact replay');
  near(contact.real, .12345); assert.equal(c.events.at(-1).type, 'outcome'); near(c.endReal, 10.212345);
});

test('truncated actual preview exposes the gap and skips missing ball/paddle motion instead of synthesizing it', () => {
  const { g, p } = completedAttempt({ inputMode: 'mouse' }), t = g.training, metadata = t.attemptClip.metadata;
  const r = new lib.TrainingAttemptRecorder(g, metadata);
  setRecordedState(g, 0); r.push(0, 0); setRecordedState(g, .12345);
  r.event('contact', .12345, .0802425, { side: 1, strokeId: 'DRIVE', point: { ...g.ball.p },
    outgoing: { p: { ...g.ball.p }, v: { ...g.ball.v }, w: { ...g.ball.w }, q: { ...g.ball.q } } });
  for (let i = 16; i <= 1200; i++) { setRecordedState(g, i / 120); r.push(i / 120, i / 120 * .65); }
  r.event('outcome', 10.012345, 6.50802425, { success: false, reason: 'miss' });
  const c = { ...r.finish({ success: false, reason: 'miss', contact: true }), attemptId: t.attemptId, sessionId: t.sessionId };
  t.attemptClip = c; const gap = c.gaps[0], out = attemptOutput();
  assert.equal(p.open({ source: 'attempt', attemptId: c.attemptId, play: false }), true);
  const seconds = (gap.from + gap.to) / 2 - c.startReal;
  p.command('seek', seconds / p.duration); lib.sampleTrainingAttempt(c, seconds, out);
  const s = p.snapshot(); assert.equal(s.source, 'attempt'); assert.equal(s.truncated, true); assert.equal(s.sample.gap, true);
  vectorNear(s.sample.ball.p, out.ball.p); vectorNear(s.sample.player.pos, out.player.pos); vectorNear(s.sample.opponent.pos, out.opponent.pos);
  for (const line of p.clip.pathLines) assert.ok(Math.hypot(line[8], line[9], line[10]) < .02, 'racket path must not bridge the trimmed gap');
  assert.equal(p.command('contact'), true); near(p.snapshot().sample.real, .12345); assert.equal(p.snapshot().sample.gap, false);
  p.close();
});
