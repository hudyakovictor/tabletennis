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
  'paddleTableClearance', 'sampleStrokeTemplate', 'createStrokeTemplateOutput', 'projectPoint'];
const lib = load(files, names, { Math: Object.create(Math) });
const strokes = Object.keys(lib.PADDLE_TEMPLATES.strokes);
const near = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const vectorNear = (a, b, epsilon) => { for (const k of ['x', 'y', 'z']) near(a[k], b[k], epsilon); };

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

test('real-time playback is frame-rate independent and reduced motion remains static', () => {
  const { p, g } = fixture(); const phases = [];
  for (const fps of [30, 60, 120]) {
    p.open({ strokeId: 'DRIVE', rate: .75 });
    for (let i = 0; i < fps; i++) p.update(1 / fps);
    phases.push(p.phase);
  }
  for (const phase of phases) near(phase, .75 / 2.4);
  g.motionOff = true; p.open({ strokeId: 'DRIVE' });
  near(p.phase, p.clip.compiled.contactPhase); assert.equal(p.playing, false);
  assert.equal(p.command('play'), false);
  p.update(.1); near(p.phase, p.clip.compiled.contactPhase);
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
  const before = gameHash(g), viewport = state.viewport.slice(), scissor = state.scissor.slice();
  g.R.draw = () => { throw Error('synthetic GL failure'); };
  assert.throws(() => p.render(), /synthetic GL failure/); delete g.R.draw;
  assert.equal(gameHash(g), before); assert.deepEqual(state.viewport, viewport); assert.deepEqual(state.scissor, scissor);
  p.close();
});

test('close restores exact paused, quiet, mute and levels; mode close cannot wake audio', () => {
  for (const paused of [false, true]) for (const quiet of [false, true]) for (const muted of [false, true]) {
    const { p, g } = fixture(); g.paused = paused; g.audio.setQuiet(quiet); g.audio.setMuted(muted);
    const before = gameHash(g, false), levels = { ...g.audio.levels };
    p.open({ strokeId: 'DRIVE' });
    assert.equal(g.paused, true); assert.equal(g.audio.quiet, true);
    g.audio.setLevels({ master: .9, effects: 0, music: .8 }); g.audio.setMuted(!muted);
    p.close(); assert.equal(g.paused, paused); assert.equal(g.audio.quiet, quiet); assert.equal(g.audio.muted, muted);
    assert.deepEqual({ ...g.audio.levels }, levels); assert.equal(gameHash(g, false), before);
    assert.equal(p.close(), false); assert.equal(p._cache.size, 0); assert.equal(p.clip, null);
  }
  const { p, g } = fixture(); p.open({ strokeId: 'DRIVE' }); p.close(false);
  assert.equal(g.paused, true); assert.equal(g.audio.quiet, true);
  assert.equal(p._listeners.length, 0); assert.equal(p._pointers.size, 0);
});
