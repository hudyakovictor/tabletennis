/* Exercise the complete bridge against source-loaded gameplay and host stores,
 * without requiring a rebuilt shell or a browser rendering a real JPEG. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, root } = require('./helpers.cjs');

function hostStores(failWrites = false) {
  const data = new Map();
  if (failWrites) { data.set('ttu-zone-stats', '[]'); data.set('ttu-match-log', '[]'); }
  const context = vm.createContext({ localStorage: { getItem: k => data.get(k) ?? null,
    setItem: (k, v) => { if (failWrites) throw new Error('quota'); data.set(k, v); }, removeItem: k => data.delete(k) } });
  const host = fs.readFileSync(path.resolve(root, '../src/services/game_host.js'), 'utf8');
  const zone = host.slice(host.indexOf('const ZoneStats ='), host.indexOf('\nfunction copyText'));
  vm.runInContext(zone + '\n' + fs.readFileSync(path.resolve(root, '../src/services/miss_shots.js'), 'utf8') +
    '\n;globalThis.stores = { ZoneStats, MissShots };', context);
  return { ...context.stores, data };
}

function fixture(pointerType = 'touch', cancelAtContact = false) {
  const handlers = new Map(), timers = new Map(), messages = [], stores = hostStores();
  const classList = { add() {}, toggle() {} }, style = {};
  const document = { readyState: 'complete', visibilityState: 'visible', addEventListener() {},
    body: { style, classList }, documentElement: { style, classList }, getElementById: () => null,
    createElement: () => ({ getContext: () => ({ drawImage() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, stroke() {}, fill() {}, save() {}, restore() {}, scale() {}, arc() {}, ellipse() {} }),
      toDataURL: () => 'data:image/jpeg;base64,RkFLRQ==' }) };
  const window = { addEventListener() {}, parent: { postMessage(message) {
    const m = JSON.parse(JSON.stringify(message)); messages.push(m);
    if (m.type === 'shot') stores.MissShots.add(m);
    if (m.type === 'shotresult') stores.MissShots.result(m.id, m);
    if (m.type === 'shotdrop') stores.MissShots.drop(m.id);
    if (m.type === 'attempt') stores.ZoneStats.add(m);
  } } };
  const lib = load(['10_math.js', '30_physics.js', '40_swipe.js', '56_rig.js', '57_camera.js',
    '70_game.js', '44_miss_shots.js'], ['Game', 'SwipeTracker', 'ShotJournal', 'V3', 'Q', 'PH', 'GS', 'STROKES', 'rigViewProj', 'integrateBall'],
    { window, document, setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; },
      clearTimeout: id => timers.delete(id), trainingCatalog: () => ({ version: 1, lessons: [] }), TRAIN_STEPS: [] });
  const { V3, PH, GS } = lib, width = pointerType === 'mouse' ? 1280 : 390, height = pointerType === 'mouse' ? 760 : 844;
  const g = Object.create(lib.Game.prototype);
  Object.assign(g, { time: 1, strokeTime: 1, timeScale: 1, frame: 0, stateT: 0, state: GS.RALLY,
    server: 1, recenterT: 0, shotId: 1, rally: 0, score: [0, 0],
    canvas: { width, height, style: {}, clientWidth: width, clientHeight: height, setPointerCapture() {},
      addEventListener: (type, fn) => handlers.set(type, fn),
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) },
    settings: { hand: 'right', grip: 'shakehand', followThrough: false, anticipationHint: false },
    swipe: new lib.SwipeTracker(), swipeReleasedAt: -Infinity,
    player: { pos: V3.new(.7, 1.04, 1.78), prev: V3.new(.7, 1.04, 1.78), prevPos: V3.new(.7, 1.04, 1.78),
      normal: V3.new(0, 0, -1), vel: V3.new(), roll: 0, lastHitT: -9 },
    ball: { p: V3.new(0, 1.05, 1.5), v: V3.new(0, -.1, 6), w: V3.new(), q: lib.Q.new(), hist: [], live: true, lastHitBy: -1 },
    isServeBall: false, rallyBounces: [1], replayer: { on: false }, career: { active: false },
    anticipation: { active: false, targetDir: V3.new(), visualOffset: V3.new() },
    audio: { init() {}, resume() {}, ui() {}, whoosh() {}, hitRacket() {}, onRallyHit() {} },
    equip: { forSide: () => ({ e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1, sweet: 1 }), vmagK: 1, sweetK: 1 },
    stats: { shots: 0, totalSpin: 0, maxSpeed: 0, maxSpin: 0, byStroke: {} },
    matchTasks: { topspin: 0, smash: 0, serves: 0 }, hitFlash: 0, shotJournal: new lib.ShotJournal(),
    recorder: { addShot() {} }, moments: { addContact() {} }, network: { on() {}, isInMatch: false },
    ui: { tick() {}, showShot() {} }, updateCamera() {}, update() {}, render() {},
    setCamPitch: undefined, setCamZoom: undefined,
    setState(state) { this.state = state; this.stateT = 0; },
    msg() {}, buzz() {}, shakeIt() {}, emitParticles() {}, logInput() {}, logSwipeRelease() {} });
  g._liveRig = { eye: V3.new(0, 1.68, 2.38), look: V3.new(0, .74, -.25), fov: 44, shiftY: 0 };
  g.R = { viewProj: lib.rigViewProj(g._liveRig, width / height), aspect: () => width / height };
  if (cancelAtContact) {
    const applyHit = g.applyHit;
    g.applyHit = function (...args) { const result = applyHit.apply(this, args); this.swipe.cancel(); return result; };
  }
  g.bindInput(); window.__game = g; window.__TT_EMBED = true;
  vm.runInContext(fs.readFileSync(path.join(root, 'tt/src/92_embed.js'), 'utf8'), lib.context);
  const send = (type, point = g.project(g.ball.p, {}), timestamp = g.time * 1000) => handlers.get(type)({
    type, pointerId: 1, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: point.x * width, clientY: point.y * height, timeStamp: timestamp, cancelable: true, preventDefault() {} });
  const press = (options = {}) => {
    g.swipe.down(.5, .7, g.time, g.strokeTime);
    const z = { accepted: false, reason: 'OUTSIDE_ZONE', shotId: g.shotId, pointerId: 1, pointerType,
      x: width / 2, y: height / 2, pointerX: width / 2, pointerY: height * .7,
      pressX: .5, pressY: .7, vw: width, vh: height, anchor: 'contact', sidePx: 23, backPx: 60, fwdPx: 75, kx: .5, ...options };
    g.swipe.pressZone = z; g.onPressZone({ ...z }, { t: .1 }, g.state === GS.SERVE_TOSS);
    const entry = g.shotJournal.create(g.swipe.gestureId, g.time); entry.pressZone = { ...z }; entry.outcome = 'outside';
    return z;
  };
  const swing = () => { g.swipe.move(.5, .5, g.time + .05, g.strokeTime + .05); };
  const contact = () => g.applyHit(1, { stroke: lib.STROKES.DRIVE, normal: V3.new(0, 0, -1), vR: V3.new(0, 1, -4), quality: .8 }, g.ball.p, .8);
  return { g, lib, messages, stores, send, press, swing, contact };
}

for (const input of ['touch', 'mouse']) test(input + ' release contacts before render without leaving a phantom image', () => {
  const f = fixture(input);
  f.send('pointerdown'); f.send('pointerup', f.g.project(f.g.ball.p, {}), 1050);
  assert.equal(f.g.ball.lastHitBy, 1, 'real input handler must resolve contact synchronously');
  const result = f.messages.find(m => m.type === 'shotresult'); assert.ok(result && result.contact);
  assert.equal(f.messages.some(m => m.type === 'shot'), false);
  f.g.render();
  assert.ok(f.messages.findIndex(m => m.type === 'shot') > f.messages.indexOf(result));
  assert.equal(f.stores.MissShots.get(result.id), null);
});

test('bridge flushes an early miss into the later captured frame', () => {
  const f = fixture(); f.press({ accepted: true, reason: null });
  f.g.logPressRejection('TIMING_EARLY'); f.g.setState(f.lib.GS.POINT); f.g.render();
  const result = f.messages.find(m => m.type === 'shotresult'), image = f.stores.MissShots.get(result.id);
  assert.equal(image.status, 'miss'); assert.equal(image.reason, 'TIMING_EARLY');
});

for (const kind of ['serve', 'backswing']) test(kind + ' promotion reaches host admission even when contact cancels the zone', () => {
  const f = fixture('touch', true), { g, lib } = f;
  if (kind === 'serve') { g.state = lib.GS.SERVE_TOSS; g.ball.lastHitBy = 0; g.tossStartY = .8; g.tossApex = 1.3; g.ball.p.y = 1.1; g.ball.v.y = -1; }
  const z = f.press(kind === 'serve' ? { pendingServeDrop: true, serving: true } : { pendingBackswing: true });
  f.swing();
  const point = g.project(g.ball.p, {});
  assert.equal(kind === 'serve' ? g.promotePendingServeZone() : g.promotePendingRallyBackswing(point), true);
  assert.equal(g.shotJournal.latest.pressZone.accepted, true, 'gameplay and journal promotion occurred');
  f.contact();
  assert.equal(g.swipe.pressZone, null);
  const attempt = f.messages.find(m => m.type === 'attempt');
  assert.equal(attempt.contact, true); assert.equal(attempt.accepted, true); assert.equal(attempt.zoneReason, null);
  assert.equal(attempt.acceptedAtPress, false); assert.equal(attempt.zoneReasonAtPress, 'OUTSIDE_ZONE');
  const saved = f.stores.ZoneStats.all()[0];
  assert.equal(saved.accepted, true); assert.equal(saved.acceptedAtPress, false);
  assert.equal(saved.gestureId, attempt.gestureId); assert.equal(saved.shotId, 1);
  assert.equal(z.accepted, true);
});

test('a promotion and contact for a different gesture or shot cannot rewrite the pending attempt', () => {
  for (const change of ['gesture', 'shot']) {
    const f = fixture(); f.press({ pendingBackswing: true });
    if (change === 'gesture') f.g.swipe.down(.5, .7, 1.1, 1.1);
    else f.g.shotId++;
    f.g.swipe.pressZone = { accepted: true, reason: null, shotId: f.g.shotId };
    f.contact(); f.g.setState(f.lib.GS.POINT);
    const attempt = f.messages.find(m => m.type === 'attempt');
    assert.equal(attempt.accepted, false, change); assert.equal(attempt.contact, false, change);
    assert.equal(attempt.zoneReason, 'OUTSIDE_ZONE', change);
  }
});

test('READY-started one-motion serve is recorded, while a plain toss tap is not', () => {
  for (const swipe of [false, true]) {
    const f = fixture(), { g, lib } = f;
    g.state = lib.GS.SERVE_READY; g.ball.lastHitBy = 0; g.ball.live = false;
    f.press({ pendingServeDrop: true, singleGestureToss: true, serving: true });
    g.render(); assert.equal(f.messages.some(m => m.type === 'shot'), false, 'a toss candidate must not encode a JPEG');
    if (swipe) f.swing();
    g.setState(lib.GS.SERVE_TOSS); g.ball.live = true; g.tossStartY = .8; g.tossApex = 1.3; g.ball.p.y = 1.1; g.ball.v.y = -1;
    assert.equal(g.promotePendingServeZone(), true);
    if (swipe) f.contact(); else g.setState(lib.GS.POINT);
    g.render();
    const attempts = f.messages.filter(m => m.type === 'attempt');
    assert.equal(attempts.length, swipe ? 1 : 0);
    assert.equal(f.stores.MissShots.all().length, 0, 'neither a successful serve nor a plain toss belongs in the miss gallery');
    if (swipe) { assert.equal(attempts[0].kind, 'serve'); assert.equal(attempts[0].accepted, true); }
  }
});

test('real READY down/move/up promotes the released serve without a second press', () => {
  for (const swipe of [false, true]) {
    const f = fixture(), { g, lib } = f, { V3, PH, GS } = lib;
    g.state = GS.SERVE_READY; g.isServeBall = true; g.ball.live = false; g.ball.lastHitBy = 0;
    V3.set(g.player.pos, 0, PH.TABLE_Y + .28, 1.78);
    V3.set(g.ball.p, 0, PH.TABLE_Y + .14, 1.74); V3.zero(g.ball.v);
    const point = g.project(g.ball.p, {}), start = { x: point.x, y: point.y + .06 };
    f.send('pointerdown', start);
    assert.equal(g.state, GS.SERVE_TOSS); assert.equal(g.ball.lastHitBy, 0);
    g.time += .04; g.strokeTime += .04;
    if (swipe) f.send('pointermove', { x: point.x, y: point.y - .06 });
    g.time += .04; g.strokeTime += .04;
    f.send('pointerup', swipe ? { x: point.x, y: point.y - .06 } : start);
    for (let i = 0; g.ball.v.y >= 0 && i < 600; i++) {
      lib.integrateBall(g.ball.p, g.ball.v, g.ball.w, PH.SIM_DT);
      g.tossApex = Math.max(g.tossApex, g.ball.p.y); g.time += PH.SIM_DT; g.strokeTime += PH.SIM_DT;
    }
    V3.copy(g.player.pos, g.ball.p); g.player.pos.y -= .04;
    g.tryPlayerHit(V3.clone(g.ball.p));
    assert.equal(g.ball.lastHitBy, swipe ? 1 : 0);
    g.setState(GS.POINT); g.render();
    const attempts = f.messages.filter(m => m.type === 'attempt');
    assert.equal(attempts.length, swipe ? 1 : 0);
    if (swipe) {
      assert.equal(attempts[0].contact, true); assert.equal(attempts[0].accepted, true);
      assert.equal(attempts[0].acceptedAtPress, false); assert.equal(attempts[0].gestureId, 1);
    }
    assert.equal(f.stores.MissShots.all().length, 0);
  }
});

test('passive block records its own admission before gameplay removes the press zone', () => {
  const f = fixture(), { g, lib } = f;
  f.press({ pendingBackswing: true }); f.swing();
  assert.equal(g.promotePendingRallyBackswing(g.project(g.ball.p, {})), true);
  g.swipe.realGestureId = g.swipe.gestureId;
  lib.V3.copy(g.player.pos, g.ball.p);
  assert.equal(g._tryPassiveBlock(g.player, g.ball), true);
  assert.equal(g.swipe.pressZone, null);
  const attempt = f.messages.find(m => m.type === 'attempt');
  assert.equal(attempt.contact, true); assert.equal(attempt.accepted, true); assert.equal(attempt.acceptedAtPress, false);
  g.render(); assert.equal(f.stores.MissShots.all().length, 0);
});

test('ZoneStats round-trip retains sanitized gate scale and normalizes phone coordinates', () => {
  const { ZoneStats, data } = hostStores();
  const ext = [23, 60, 75], rules = { contactSideTouchPx: 46, contactSideMousePx: 32, contactBackPx: 120, contactForwardPx: 150 };
  ZoneStats.add({ kind: 'rally', input: 'touch', dx: 23, dy: 75, ext, kx: .5 }); ext[0] = 99;
  const saved = JSON.parse(data.get(ZoneStats.KEY))[0];
  assert.deepEqual(saved.ext, [23, 60, 75]); assert.equal(saved.kx, .5);
  assert.deepEqual({ ...ZoneStats.norm(saved, rules) }, { dx: 46, dy: 150 });
  ZoneStats.add({ kind: 'rally', input: 'touch', dx: -23, dy: -60, ext: [23, 60, 75], kx: .5 });
  assert.deepEqual({ ...ZoneStats.norm(ZoneStats.all()[1], rules) }, { dx: -46, dy: -120 });
  for (const ext of [[0, 60, 75], [23, -1, 75], [23, 60, Infinity], [23, 60], ['23', 60, 75]]) {
    ZoneStats.add({ ext, kx: -1 });
    assert.equal(ZoneStats.all().at(-1).ext, null); assert.equal(ZoneStats.all().at(-1).kx, null);
  }
});

test('ZoneStats keeps new attempts and match summaries after storage quota failures', () => {
  const { ZoneStats, data } = hostStores(true);
  for (let i = 0; i < ZoneStats.MAX + 2; i++) ZoneStats.add({ kind: 'rally', dx: i, dy: 0, ext: [23, 60, 75], kx: .5 });
  assert.equal(ZoneStats.all().length, ZoneStats.MAX);
  assert.equal(ZoneStats.all()[0].dx, 2); assert.equal(ZoneStats.all().at(-1).dx, ZoneStats.MAX + 1);
  assert.equal(data.get(ZoneStats.KEY), '[]', 'the persisted data really stayed stale');
  for (let i = 0; i < 32; i++) ZoneStats.logMatch({ n: 3, pct: i, key: 'good' }, true);
  assert.equal(ZoneStats.matches().length, 30); assert.equal(ZoneStats.matches()[0].pct, 2);
  ZoneStats.clear(); assert.equal(ZoneStats.all().length, 0);
});
