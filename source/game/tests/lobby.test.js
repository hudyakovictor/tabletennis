const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, root } = require('./helpers.cjs');

function fixture(width = 390, height = 844, dpr = 2) {
  const messages = [], draws = [], events = new Map(), images = [], presented = [];
  const classList = { add() {}, remove() {}, toggle() {} }, style = { setProperty() {} };
  const ctx = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }, { get: (o, k) => k in o ? o[k] : () => {} });
  const document = { readyState: 'complete', visibilityState: 'visible',
    documentElement: { classList, style }, body: { classList, style },
    addEventListener: (type, fn) => events.set('document:' + type, fn), getElementById: () => null,
    createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) };
  const window = { __TT_EMBED: false, addEventListener: (type, fn) => events.set(type, fn),
    parent: { postMessage: m => messages.push(JSON.parse(JSON.stringify(m))) } };
  const lib = load(['10_math.js', '20_gl.js', '30_physics.js', '56_rig.js', '57_camera.js',
    '60_scene.js', '70_game.js', '44_miss_shots.js'],
  ['Game', 'LobbyExhibition', 'PaddleRig', 'PH', 'GS', 'V3', 'Q', 'M4', 'rigViewProj', 'Scene', 'arenaImageTex'], {
    window, document, Image: class { constructor() { images.push(this); } },
    setTimeout: () => 1, clearTimeout() {}, trainingCatalog: () => ({ version: 1, lessons: [] }), TRAIN_STEPS: [],
  });
  const { Game, V3, Q, M4, GS } = lib;
  const canvas = { width: Math.round(width * dpr * 0.88), height: Math.round(height * dpr * 0.88),
    clientWidth: width, clientHeight: height, getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }),
    addEventListener: (type, fn) => events.set('canvas:' + type, fn) };
  const R = { _w: canvas.width, _h: canvas.height, viewProj: M4.create(), quality: 'medium', post: {},
    aspect() { return this._w / this._h; },
    setCamera(eye, look, up, fov, near, far, shiftY) {
      this.camPos = V3.clone(eye);
      M4.copy(this.viewProj, lib.rigViewProj({ eye, look, fov, shiftY }, this.aspect()));
    }, beginShadow: () => false, beginScene() {}, present: time => presented.push(time),
    draw: (mesh, matrix) => draws.push({ mesh, matrix: Array.from(matrix) }),
    drawShadow: (mesh, matrix) => draws.push({ mesh, matrix: Array.from(matrix), shadow: true }),
    mesh: geo => geo, dynMesh: () => ({}), texFromCanvas: () => ({}), gl: { getError: () => 0 } };
  const scene = { mesh: Object.fromEntries(['ball', 'box', 'sphere', 'capsule', 'blade', 'rubber', 'handle', 'quad'].map(n => [n, n])),
    mat: { ball: { color: [1, 1, 1], emissive: [0, 0, 0] }, courtGround: { asphalt: {} },
      bladeWood: {}, rubberRed: {}, rubberBlack: {}, handle: {} },
    _tmp: { m: M4.create(), scl: V3.new() }, hasPanorama: true,
    panoramaSettled: true, asphaltSettled: true, standsSettled: true,
    drawStatic() {}, drawNet() {}, blob() {} };
  const pad = z => ({ pos: V3.new(0.4, 1.1, z), normal: V3.new(0, 0, -Math.sign(z)), q: Q.new(),
    prev: V3.new(), prevPos: V3.new(), vel: V3.new(), swing: 0, roll: 0 });
  const g = Object.create(Game.prototype);
  Object.assign(g, { R, canvas, scene, state: GS.MENU, time: 42, strokeTime: 41, frame: 7,
    score: [3, 4], rally: 9, server: -1, stats: { shots: 12 }, sessionKind: 'free', paused: false,
    settings: { showPlayerPaddle: true, camera: 'BROADCAST', hand: 'right', quality: 'medium', targetScore: 11 },
    ball: { p: V3.new(), v: V3.new(), w: V3.new(), q: Q.new(), live: false, hist: [] },
    player: pad(1.78), aiPaddle: pad(-1.78), ai: { pos: V3.new(), anim: {}, roll: 0 },
    camPos: V3.new(), camLook: V3.new(), camPosT: V3.new(), camLookT: V3.new(),
    _liveRig: { eye: V3.new(), look: V3.new(), fov: 44, shiftY: 0 },
    _rigBuf: { vp: M4.create(), proj: M4.create(), view: M4.create() },
    rig: new lib.PaddleRig(), equip: {}, aiEquip: {}, _cal: { ballSize: 0.5 },
    ui: { tick() {}, inputMode: 'mouse' }, replayer: { on: false },
    audio: { setMuted() {}, setQuiet() {}, init() {}, resume() {} },
    network: { on() {}, isInMatch: false }, career: { active: false },
    profile: { maybeSave() {} }, swipe: { cancel() {} },
    paddleMats: () => ({}), updateCamera() { this.lobbyScene?.updateCamera(); },
    setCamPitch: undefined, setCamZoom: undefined,
    logInput: () => { throw Error('lobby called gameplay telemetry'); },
    stepPhysics: () => { throw Error('lobby called match physics'); },
    applyHit: () => { throw Error('lobby called match contact'); },
    awardPoint: () => { throw Error('lobby called scoring'); },
    drawFX: () => { throw Error('lobby inherited gameplay effects'); },
  });
  const controller = () => g.lobbyScene || (g.lobbyScene = new lib.LobbyExhibition(g, (type, data) =>
    messages.push(JSON.parse(JSON.stringify({ __tt: 1, type, ...data })))));
  const step = (dt = 1 / 60, render = true) => { g.update(dt); if (render) g.render(); };
  const prepare = (intro = true, requestId = 17) => { controller().prepare({ intro, requestId }); g.render(); };
  const launch = (options = {}) => { assert.equal(controller().launch({ requestId: 17, x: 0.5, y: 0.48, diameter: 1.1, ...options }), true); g.render(); };
  const gameplay = () => JSON.stringify([g.time, g.strokeTime, g.frame, g.score, g.rally, g.stats, g.player, g.aiPaddle]);
  return { ...lib, g, R, scene, canvas, window, document, events, images, messages, draws, presented, controller, prepare, launch, step, gameplay };
}

test('lobbyReady requires settled textures and a presented prepared scene; waiting bots cannot rally', () => {
  const f = fixture(), identity = f.g.ball, before = f.gameplay();
  f.scene.panoramaSettled = f.scene.asphaltSettled = false;
  assert.equal(f.controller().prepare({ intro: true, requestId: 17 }), true);
  assert.equal(f.messages.length, 0, 'preparation is not render readiness');
  f.g.render();
  assert.ok(f.presented.length > 0);
  assert.equal(f.messages.length, 0);
  assert.equal(f.draws.some(d => d.mesh === 'ball'), false, 'the splash owns the only visible ball');
  assert.equal(f.controller().launch({ requestId: 17, x: 0.5, y: 0.48, diameter: 1 }), false);
  f.scene.panoramaSettled = true; f.g.render(); assert.equal(f.messages.length, 0);
  f.scene.asphaltSettled = true; f.R.gl.isContextLost = () => true; f.g.render();
  assert.equal(f.messages.length, 0, 'an invalid GPU is not a ready scene');
  f.R.gl.isContextLost = () => false; f.g.render();
  assert.equal(f.messages[0].type, 'lobbyReady'); assert.equal(f.messages[0].requestId, 17);
  for (let i = 0; i < 180; i++) f.step();
  assert.equal(f.messages.filter(m => m.type === 'lobbyReady').length, 1);
  assert.equal(f.controller().phase, 'waiting'); assert.equal(f.controller().hits, 0);
  assert.ok(f.controller().bots.every(b => b.stage === 'idle'));
  assert.equal(f.g.ball, identity); assert.equal(f.gameplay(), before);
});

for (const [width, height, dpr] of [[1280, 760, 1], [1280, 760, 2], [390, 844, 2], [390, 844, 3]]) {
  test(`launch matches actual projection, CSS diameter and seamless handoff at ${width}x${height} DPR ${dpr}`, () => {
    const f = fixture(width, height, dpr), identity = f.g.ball, before = f.gameplay();
    f.prepare();
    const left = f.g.project({ x: 0, y: 1, z: f.controller().firstSide * 2 }, {});
    assert.ok(left.x < 0.5, 'the receiving bot projects screen-left');
    const x = width > 500 ? 0.58 : 0.5, y = 0.48, diameter = dpr === 3 ? 1.3 : 0.85;
    f.launch({ x, y, diameter });
    const initial = f.messages.find(m => m.type === 'lobbyFrame');
    assert.equal(initial.progress, 0); assert.equal(initial.phase, 'flight'); assert.equal(initial.handoff, false);
    assert.ok(Math.abs(initial.x - x) * width < 0.2, JSON.stringify(initial));
    assert.ok(Math.abs(initial.y - y) * height < 0.2, JSON.stringify(initial));
    assert.ok(Math.abs(initial.diameter - diameter) * width < 0.5, JSON.stringify(initial));
    const camera = Array.from(f.R.viewProj);
    let handoff = null, lastProgress = -1;
    for (let i = 0; i < 100 && !f.messages.some(m => m.type === 'lobbyHit'); i++) {
      f.draws.length = 0; f.step();
      if (f.controller().phase === 'flight') assert.deepEqual(Array.from(f.R.viewProj), camera);
      const frame = f.messages.filter(m => m.type === 'lobbyFrame').at(-1);
      assert.ok(frame.progress >= lastProgress); lastProgress = frame.progress;
      const spheres = f.draws.filter(d => d.mesh === 'ball');
      assert.equal(spheres.length, f.controller().handoff ? 1 : 0);
      if (frame.handoff && !handoff) {
        handoff = frame;
        assert.ok(frame.diameter * width <= 12.01, JSON.stringify(frame));
        const p = f.g.project(f.g.ball.p, {});
        assert.ok(Math.abs(frame.x - p.x) + Math.abs(frame.y - p.y) < 1e-6);
        for (const [axis, index] of [['x', 12], ['y', 13], ['z', 14]])
          assert.ok(Math.abs(spheres[0].matrix[index] - f.g.ball.p[axis]) < 1e-6);
      }
    }
    assert.ok(handoff, 'the sprite hands off before first contact');
    const hit = f.messages.find(m => m.type === 'lobbyHit');
    assert.deepEqual(hit, { __tt: 1, type: 'lobbyHit', requestId: 17, side: f.controller().firstSide, first: true });
    assert.equal(f.controller().phase, 'rally');
    assert.ok(f.controller().clock >= 1.35 && f.controller().clock < 1.37);
    const frameCount = f.messages.filter(m => m.type === 'lobbyFrame').length;
    for (let i = 0; i < 120; i++) f.step();
    assert.equal(f.messages.filter(m => m.type === 'lobbyFrame').length, frameCount, 'no messages after sphere handoff');
    assert.equal(f.messages.filter(m => m.type === 'lobbyHit').length, 1);
    assert.equal(f.g.ball, identity); assert.equal(f.gameplay(), before);
  });
}

test('incoming joins gravity continuously, bounces once on the receiving half and meets its paddle', () => {
  const f = fixture(); f.prepare(); f.launch(); const c = f.controller(), flight = c.flight;
  c._sampleFlight(flight.entry - 1e-7); const p = { ...f.g.ball.p }, v = { ...f.g.ball.v };
  c._sampleFlight(flight.entry + 1e-7);
  assert.ok(f.V3.dist(p, f.g.ball.p) < 1e-5); assert.ok(f.V3.dist(v, f.g.ball.v) < 1e-4);
  c._sampleFlight(flight.entry + flight.down);
  assert.ok(Math.abs(f.g.ball.p.y - f.PH.TABLE_Y - c.radius()) < 1e-8);
  assert.ok(f.g.ball.p.z * c.firstSide > 0 && Math.abs(f.g.ball.p.z) < f.PH.T_HALF_LEN);
  assert.ok(Math.abs(f.g.ball.p.x) < f.PH.T_HALF_WID && f.g.ball.v.y > 0);
  c.elapsed = 0; c._sampleFlight(0);
  const stages = new Set();
  for (let i = 0; i < 140; i++) { f.step(0.01, false); stages.add(c.bots.find(b => b.side === c.firstSide).stage); }
  assert.ok(stages.has('windup') && stages.has('contact') && stages.has('recovery'));
  const bot = c.bots.find(b => b.side === c.firstSide);
  assert.ok(f.V3.dist(bot.contact, flight.end) < 1e-8);
  c.clock = bot.hitAt; c._poseBots(0);
  assert.ok(Math.abs(f.V3.dist(bot.pad.pos, bot.contact) - c.radius() - 0.009) < 1e-8);
});

test('regular exhibition has deterministic gravity, legal table bounces, tracking and alternating contacts', () => {
  const a = fixture(), b = fixture(); a.prepare(false); b.prepare(false);
  const before = a.gameplay(), sides = [], seen = new Set();
  let lastHits = a.controller().hits, minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < 600; i++) {
    a.step(1 / 60, false);
    for (let k = 0; k < 2; k++) b.step(1 / 120, false);
    const c = a.controller(), s = c.shot, t = c.elapsed;
    const support = a.PH.TABLE_Y + c.radius();
    assert.ok(a.g.ball.p.y >= support - 1e-8);
    if (Math.abs(a.g.ball.p.z) < 0.06) assert.ok(a.g.ball.p.y > a.PH.NET_TOP + c.radius());
    assert.ok(Math.abs(s.bounce.x) < a.PH.T_HALF_WID && Math.abs(s.bounce.z) < a.PH.T_HALF_LEN);
    assert.ok(s.bounce.z * s.side > 0 && s.after.y > 0);
    if (t < s.down) assert.ok(Math.abs(a.g.ball.v.y - (s.before.y - a.PH.G * t)) < 1e-8);
    if (c.hits !== lastHits) { sides.push(a.g.ball.lastHitBy); lastHits = c.hits; }
    for (const bot of c.bots) { seen.add(bot.stage); minX = Math.min(minX, bot.x); maxX = Math.max(maxX, bot.x); }
    assert.equal(a.g.ball.live, false, 'real match physics stays disabled in MENU');
  }
  assert.ok(sides.length >= 10);
  assert.ok(sides.every((s, i) => i === 0 || s === -sides[i - 1]));
  assert.ok(seen.has('windup') && seen.has('contact') && seen.has('recovery'));
  assert.ok(maxX - minX > 0.35, 'robots follow lateral placement');
  assert.ok(a.V3.dist(a.g.ball.p, b.g.ball.p) < 1e-8, 'ball arcs are independent of frame rate');
  assert.equal(a.gameplay(), before);
});

test('plain lobby and repeated intro/launch commands preserve waiting, incoming and active rally', () => {
  const f = fixture(); f.prepare();
  for (const phase of ['waiting', 'flight', 'rally']) {
    if (phase === 'flight') f.launch();
    if (phase === 'rally') for (let i = 0; i < 100; i++) f.step(1 / 60, false);
    const c = f.controller(), before = JSON.stringify([c.clock, c.elapsed, c.phase, f.g.ball, c.shot]);
    c.prepare({}); c.prepare({ intro: true, requestId: 17 });
    if (phase !== 'waiting') assert.equal(c.launch({ requestId: 17, x: 0.1, y: 0.2, diameter: 1 }), false);
    assert.equal(JSON.stringify([c.clock, c.elapsed, c.phase, f.g.ball, c.shot]), before);
  }
});

test('hidden, sleeping and paused lobbies suspend their own clock without a resume catch-up', () => {
  const f = fixture(); f.prepare(false); f.step(); const c = f.controller();
  for (const reason of ['hidden', 'sleep', 'pause']) {
    const before = JSON.stringify([c.clock, f.g.ball, f.R.viewProj]);
    if (reason === 'hidden') f.document.visibilityState = 'hidden';
    if (reason === 'sleep') f.g._ttSleeping = true;
    if (reason === 'pause') c.paused = true;
    for (let i = 0; i < 20; i++) f.step(0.1, false);
    assert.equal(JSON.stringify([c.clock, f.g.ball, f.R.viewProj]), before);
    f.document.visibilityState = 'visible'; f.g._ttSleeping = false; c.paused = false;
    f.step(0.1, false);
    assert.equal(JSON.stringify([c.clock, f.g.ball, f.R.viewProj]), before, 'discard the resumed frame gap');
    f.step(0.01, false); assert.ok(c.clock > JSON.parse(before)[0]);
  }
});

test('effective reduced motion bypasses the flight and freezes autonomous ball, bots and camera', () => {
  const f = fixture(); f.g.reducedMotion = true; f.prepare(); f.launch();
  const c = f.controller(), frame = f.messages.find(m => m.type === 'lobbyFrame');
  assert.equal(frame.phase, 'rally'); assert.equal(frame.handoff, true); assert.equal(frame.progress, 1);
  assert.equal(f.messages.filter(m => m.type === 'lobbyHit').length, 1);
  const before = JSON.stringify([c.clock, c.bots, f.g.ball, f.R.viewProj]);
  for (let i = 0; i < 120; i++) f.step();
  assert.equal(JSON.stringify([c.clock, c.bots, f.g.ball, f.R.viewProj]), before);
  assert.equal(c.hits, 1); assert.equal(f.g.state, f.GS.MENU);
});

test('leaving MENU cancels the lobby and normal rendering contains no robot geometry', () => {
  const f = fixture(); f.prepare(false); f.g.setState(f.GS.RALLY);
  assert.equal(f.controller().active, false); assert.equal(f.controller().phase, 'off');
  f.draws.length = 0; f.g.drawDynamic(false);
  assert.deepEqual(f.draws.map(d => d.mesh), ['blade', 'rubber', 'rubber', 'handle', 'blade', 'rubber', 'rubber', 'handle']);
  for (const [name, next] of [['startMatch', 'setSessionKind'], ['startTraining', 'setSessionKind'], ['returnToMenu', 'endReplay']]) {
    let stopped = 0;
    const g = { lobbyScene: { stop: () => stopped++ }, network: {}, career: {}, [next]() { throw Error('next gameplay step'); } };
    assert.throws(() => f.Game.prototype[name].call(g), /next gameplay step/);
    assert.equal(stopped, 1, name + ' cancels before modifying live-game state');
  }
});

test('arena image loading settles honestly on upload, onerror, decode/upload failure and omitted assets', () => {
  const f = fixture(); const outcomes = [], uploads = [];
  const R = { texFromCanvas: () => ({}), gl: { getError: () => 0 } };
  f.arenaImageTex(R, 'ok', 4, 4, tx => uploads.push(tx), ok => outcomes.push(ok));
  assert.deepEqual(outcomes, []); f.images.at(-1).onload();
  assert.deepEqual(outcomes, [true]); assert.equal(uploads.length, 1);
  f.arenaImageTex(R, 'bad', 4, 4, tx => uploads.push(tx), ok => outcomes.push(ok));
  f.images.at(-1).onerror();
  f.arenaImageTex({ texFromCanvas() { throw Error('upload'); } }, 'throws', 4, 4, () => assert.fail('bad texture installed'), ok => outcomes.push(ok));
  f.images.at(-1).onload();
  f.arenaImageTex(R, '', 4, 4, () => assert.fail('missing asset installed'), ok => outcomes.push(ok));
  assert.deepEqual(outcomes, [true, false, false, false]);
  f.window.__TT_ARENA = { stands: 'stands', panorama: 'panorama', asphalt: 'asphalt' };
  const scene = new f.Scene(f.R), pending = f.images.slice(-3);
  assert.equal(scene.standsSettled || scene.panoramaSettled || scene.asphaltSettled, false);
  pending[0].onerror(); pending[1].onload(); pending[2].onerror();
  assert.equal(scene.standsSettled && scene.panoramaSettled && scene.asphaltSettled, true);
  assert.equal(scene.hasPanorama, true); assert.equal(!!scene.mat.courtGround.asphalt, false);
  f.window.__TT_ARENA = {};
  const fallback = new f.Scene(f.R);
  assert.equal(fallback.standsSettled && fallback.panoramaSettled && fallback.asphaltSettled, true);
  assert.equal(fallback.hasPanorama, false);
});

test('real embed bridge trusts only its parent, wakes for preparation and preserves the request across hub repaint', () => {
  const f = fixture();
  f.g.returnToMenu = () => { f.g.lobbyScene?.stop(); f.g.setState(f.GS.MENU); };
  f.g.startMatch = () => f.g.setState(f.GS.SERVE_READY);
  f.g.startTraining = () => f.g.setState(f.GS.SERVE_READY);
  f.g.trendFromHistory = () => 0;
  f.document.getElementById = id => id === 'gl' ? f.canvas : null;
  f.window.__TT_EMBED = true; f.window.__game = f.g;
  vm.runInContext(fs.readFileSync(path.join(root, 'tt/src/92_embed.js'), 'utf8'), f.context);
  const send = (type, data = {}, source = f.window.parent) => f.events.get('message')({ source, data: { __tt: 1, type, ...data } });
  assert.equal(f.messages.filter(m => m.type === 'ready').length, 1);
  f.g._ttSleeping = true;
  send('lobby', { intro: true, requestId: 17 }, {});
  assert.equal(f.g._ttSleeping, true); assert.equal(f.g.lobbyScene, undefined);
  send('lobby', { intro: true, requestId: 1.5 }); assert.equal(f.g.lobbyScene, undefined);
  f.scene.panoramaSettled = false;
  send('lobby', { intro: true, requestId: 17 });
  assert.equal(f.g._ttSleeping, false); assert.equal(f.controller().phase, 'waiting');
  assert.equal(f.messages.some(m => m.type === 'lobbyReady'), false);
  f.scene.panoramaSettled = true; f.g.render();
  assert.equal(f.messages.filter(m => m.type === 'lobbyReady').length, 1);
  send('lobby'); assert.equal(f.controller().phase, 'waiting');
  send('lobbyLaunch', { requestId: 18, x: 0.5, y: 0.48, diameter: 1 });
  assert.equal(f.controller().phase, 'waiting');
  send('lobbyLaunch', { requestId: 17, x: 0.5, y: 0.48, diameter: 1 });
  assert.equal(f.messages.find(m => m.type === 'lobbyFrame').progress, 0);
  f.step(); const ball = JSON.stringify(f.g.ball), clock = f.controller().clock;
  send('lobby'); assert.equal(JSON.stringify(f.g.ball), ball); assert.equal(f.controller().clock, clock);
  send('pause'); send('rm', { on: true });
  assert.equal(f.controller().phase, 'rally'); assert.equal(f.controller().handoff, true);
  assert.equal(f.messages.filter(m => m.type === 'lobbyHit').length, 1, 'RM completes even while the menu clock is paused');
  send('resume'); send('rm', { on: false });
  for (const type of ['attract', 'prematch', 'match', 'train', 'quit']) {
    if (f.g.state !== f.GS.MENU) f.g.returnToMenu();
    send('lobby'); assert.equal(f.controller().active, true);
    const eye = { ...f.g.camPos };
    send(type); assert.equal(f.controller().active, false, type);
    if (type === 'prematch') {
      f.g.updateCamera(0);
      assert.ok(f.V3.dist(eye, f.g.camPos) < 1e-8, 'prematch begins at the current lobby view');
    }
  }
  send('lobby', { intro: true, requestId: 19 });
  f.events.get('canvas:webglcontextlost')({ preventDefault() {} });
  assert.equal(f.controller().active, false); assert.equal(f.g._ttSleeping, true);
  assert.equal(f.messages.at(-1).type, 'glLost');
  const readyCount = f.messages.filter(m => m.type === 'lobbyReady').length;
  send('lobby', { intro: true, requestId: 20 });
  assert.equal(f.messages.filter(m => m.type === 'lobbyReady').length, readyCount, 'GPU reload must use a fresh iframe');
  assert.equal(f.g.ball.live, false);
  assert.ok(!f.messages.some(m => ['point', 'hit', 'attempt', 'matchEnd'].includes(m.type)));
});
