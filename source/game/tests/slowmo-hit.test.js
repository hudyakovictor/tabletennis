const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const windowHandlers = new Map();

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '42_shot_diagnostics.js', '56_rig.js', '57_camera.js', '84_racket.js', '70_game.js'],
  ['Game', 'SwipeTracker', 'PaddleStrokeMotion', 'isRealStroke', 'tapStrokeMetrics', 'ShotJournal', 'V3', 'PH', 'GS',
    'STROKES', 'SERVE_STROKE_ALIAS', 'STROKE_CONFIG', 'bladePlaneCapture', 'deriveStroke', 'describeStrokeEffort',
    'rigViewProj', 'integrateBall', 'predict', 'solveStrikeCorridor', 'PADDLE_LIMITS', 'PADDLE_STANCE_Z', 'Equipment', 'M4', 'Q'],
  { window: { addEventListener(type, handler) { windowHandlers.set(type, handler); } }, document: { addEventListener() {},
    body: { style: {}, classList: { toggle() {} } }, documentElement: { style: {} } } });

function inputGame(pointerType = 'touch', scale = 1, viewport) {
  const { V3, PH, GS } = lib, handlers = new Map();
  const g = Object.create(lib.Game.prototype), width = viewport?.width ?? (pointerType === 'mouse' ? 1280 : 390), height = viewport?.height ?? (pointerType === 'mouse' ? 760 : 844);
  g.canvas = { style: {}, clientWidth: width, clientHeight: height, setPointerCapture() {},
    addEventListener: (type, fn) => handlers.set(type, fn),
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) };
  g.time = 1; g.strokeTime = 1; g.timeScale = scale; g.frame = 0; g.stateT = 0;
  g.state = GS.RALLY; g.server = 1; g.recenterT = 0; g.shotId = 1; g.rally = 0;
  g.settings = { hand: 'right', grip: 'shakehand', followThrough: false, anticipationHint: true };
  g.swipe = new lib.SwipeTracker(); g.swipeReleasedAt = -Infinity;
  g.player = { pos: V3.new(.7, 1.04, 1.78), prev: V3.new(.7, 1.04, 1.78),
    prevPos: V3.new(.7, 1.04, 1.78), normal: V3.new(0, 0, -1), vel: V3.new(), roll: 0, lastHitT: -9 };
  g.ball = { p: V3.new(0, 1.05, 1.5), v: V3.new(0, -.1, 6), w: V3.new(), live: true, lastHitBy: -1 };
  g.isServeBall = false; g.rallyBounces = [1]; g.replayer = { on: false }; g.career = { active: false };
  g.contactFlashes = []; g._contactFlashSeen = new Set();
  g.anticipation = { active: false, targetDir: V3.new(), visualOffset: V3.new(.05, .04, .08) };
  g.audio = { init() {}, resume() {}, ui() {}, whoosh() {}, hitRacket() {}, onRallyHit() {} };
  g.equip = { forSide: () => ({ e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1, sweet: 1 }), vmagK: 1, sweetK: 1 };
  g.stats = { shots: 0, totalSpin: 0, maxSpeed: 0, maxSpin: 0, byStroke: {} };
  g.matchTasks = { topspin: 0, smash: 0, serves: 0 }; g.hitFlash = 0;
  g.shotJournal = new lib.ShotJournal(); g.recorder = { addShot() {} }; g.moments = { addContact() {} };
  g.msg = () => {}; g.buzz = () => {}; g.shakeIt = () => {}; g.logInput = () => {}; g.logSwipeRelease = () => {};
  g._liveRig = { eye: V3.new(0, 1.68, 2.38), look: V3.new(0, .74, -.25), fov: 44, shiftY: 0 };
  g.R = { viewProj: lib.rigViewProj(g._liveRig, width / height), aspect: () => width / height };
  g.bindInput();
  const event = (type, point, timestamp, extra) => ({
    type, pointerId: 1, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: point.x * width, clientY: point.y * height, timeStamp: timestamp, cancelable: true, preventDefault() {}, ...extra });
  const send = (type, point = g.project(g.ball.p, {}), timestamp = g.time * 1000, extra = {}) =>
    handlers.get(type)(event(type, point, timestamp, extra));
  const sendWindow = (type, point = g.project(g.ball.p, {}), timestamp = g.time * 1000, extra = {}) =>
    windowHandlers.get(type)(event(type, point, timestamp, extra));
  return { g, send, sendWindow, width, height };
}

function idleMouseCircle(f, direction = 1, coalesced = false, buttons = 0) {
  const { g, width, height, send } = f, start = g.time;
  const points = Array.from({ length: 41 }, (_, i) => ({
    x: .5 + 55 * Math.cos(direction * Math.PI * 2 * i / 40) / width,
    y: .6 + 55 * Math.sin(direction * Math.PI * 2 * i / 40) / height,
  }));
  const timestamp = i => 1000 + (start + i * .012) * 1000;
  if (coalesced) {
    g.time = start + .48;
    send('pointermove', points[40], timestamp(40), { buttons,
      getCoalescedEvents: () => points.map((p, i) => ({ pointerId: 1, pointerType: 'mouse',
        clientX: p.x * width, clientY: p.y * height, timeStamp: timestamp(i) })) });
  } else for (const [i, point] of points.entries()) {
    g.time = start + i * .012;
    send('pointermove', point, timestamp(i), { buttons });
  }
}

test('native-style mouse circles toss only the idle standard racket and catch its opposite face without changing the ball', () => {
  for (const grip of ['shakehand', 'penhold']) for (const hand of ['left', 'right']) {
  for (const direction of [-1, 1]) for (const coalesced of [false, true]) {
    const f = inputGame('mouse'), { g } = f;
    g.settings.grip = grip; g.settings.hand = hand;
    g.state = lib.GS.POINT; g.ball.live = false; g._equippedRacket = 'r-standard'; g.resetPaddle(true);
    const before = JSON.stringify({ ball: g.ball, stats: g.stats, shotId: g.shotId, work: g._playerWork });
    const originalNormal = lib.V3.clone(g.player.normal), originalRoll = g.player.roll;
    const expectedCatch = lib.Q.mul(lib.Q.new(), g.player.q, lib.Q.setAxisAngle(lib.Q.new(), 0, 1, 0, direction * 3 * Math.PI));
    idleMouseCircle(f, direction, coalesced);
    assert.equal(g.paddleTrick?.active, true); assert.equal(g.paddleTrick.direction, direction);
    assert.equal(g.playerActiveFace, 1, 'side changes on the catch, not at takeoff');
    g.time = g.paddleTrick.startedAt + .36; g.updatePaddleTrick();
    const pose = g.paddleTrick.pose(g.player);
    assert.ok(pose.pos.y > g.player.pos.y + .17);
    assert.equal(JSON.stringify({ ball: g.ball, stats: g.stats, shotId: g.shotId, work: g._playerWork }), before);
    g.time = g.paddleTrick.startedAt + .72; g.updatePaddleTrick();
    assert.equal(g.paddleTrick.active, false); assert.equal(g.playerActiveFace, -1); assert.equal(g.player.activeFace, -1);
    nearInput(g.player.roll, -originalRoll); nearInput(lib.V3.dist(g.player.normal, originalNormal), 0);
    const q = g.player.q;
    const redNormal = lib.V3.new(2 * (q.x * q.z + q.w * q.y), 2 * (q.y * q.z - q.w * q.x), 1 - 2 * (q.x * q.x + q.y * q.y));
    nearInput(lib.V3.dot(redNormal, originalNormal), -1);
    nearInput(Math.abs(q.x * expectedCatch.x + q.y * expectedCatch.y + q.z * expectedCatch.z + q.w * expectedCatch.w), 1);
    g.cancelInput('after_catch'); g.resetPaddle(false); g.setPaused(true); g.setPaused(false);
    assert.equal(g.playerActiveFace, -1); assert.equal(g.player.activeFace, -1);
    assert.equal(JSON.stringify({ ball: g.ball, stats: g.stats, shotId: g.shotId, work: g._playerWork }), before);
  }
  }
});

test('mouse-circle gestures are cosmetic, standard-only and disabled in every unsafe input state', () => {
  const unsafe = [g => { g._equippedRacket = 'r-pan'; }, g => { g._equippedRacket = 'unknown'; }, g => { g.ball.live = true; },
    g => { g.paused = true; }, g => { g.replayer.on = true; }, g => { g.preview = { active: true }; },
    g => { g.training = {}; }, g => { g.demoMode = true; }, g => { g.network = { isInMatch: true }; },
    g => { g._ttSleeping = true; }, g => { g._ttContextLost = true; }, g => { g.pointerDown = true; },
    g => { g.swipe.active = true; }, g => { g.state = lib.GS.MENU; }, g => { g.state = lib.GS.SERVE_TOSS; },
    g => { g.state = lib.GS.REPLAY; }, g => { g.state = lib.GS.MATCH_END; },
    g => { g.state = lib.GS.SERVE_READY; g.server = -1; }];
  for (const change of unsafe) {
    const f = inputGame('mouse'), { g } = f; g.state = lib.GS.POINT; g.ball.live = false; g._equippedRacket = 'r-standard';
    change(g);
    const before = JSON.stringify({ ball: g.ball, stats: g.stats, shotId: g.shotId });
    idleMouseCircle(f);
    assert.notEqual(g.paddleTrick?.active, true); assert.equal(g.playerActiveFace, 1);
    assert.equal(JSON.stringify({ ball: g.ball, stats: g.stats, shotId: g.shotId }), before);
  }
  for (const type of ['touch', 'pen']) {
    const f = inputGame(type), { g } = f; g.state = lib.GS.POINT; g.ball.live = false;
    // The outer PointerEvent's actual type remains authoritative.
    idleMouseCircle(f, 1, false);
    assert.notEqual(g.paddleTrick?.active, true); assert.equal(g.playerActiveFace, 1);
  }
  const held = inputGame('mouse'); held.g.state = lib.GS.POINT; held.g.ball.live = false;
  idleMouseCircle(held, 1, false, 1); assert.notEqual(held.g.paddleTrick?.active, true);
});

test('a hover packet cannot reuse a button-held coalesced path as an idle circle', () => {
  const { g, send, width, height } = inputGame('mouse');
  g.state = lib.GS.POINT; g.ball.live = false;
  const samples = Array.from({ length: 41 }, (_, i) => ({ pointerId: 1, pointerType: 'mouse', buttons: 1,
    clientX: width * .5 + 55 * Math.cos(Math.PI * 2 * i / 40),
    clientY: height * .6 + 55 * Math.sin(Math.PI * 2 * i / 40), timeStamp: 1000 + i * 14 }));
  send('pointermove', { x: .5 + 55 / width, y: .6 }, 1580, { buttons: 0, getCoalescedEvents: () => samples });
  assert.notEqual(g.paddleTrick?.active, true); assert.equal(g.playerActiveFace, 1); assert.equal(g.stats.shots, 0);
});

test('abort clears only the transient trick; reduced motion changes the side without a toss', () => {
  for (const abort of [f => f.g.cancelInput('cancel'), f => f.g.setPaused(true),
    f => f.send('pointerleave'), f => f.sendWindow('blur'),
    f => { f.g.ball.live = true; f.g.updatePaddleTrick(); },
    f => { f.g._equippedRacket = 'r-pan'; f.g.updatePaddleTrick(); },
    f => { f.g.reducedMotion = true; f.g.updatePaddleTrick(); }]) {
    const f = inputGame('mouse'); f.g.state = lib.GS.POINT; f.g.ball.live = false; f.g.resetPaddle(true);
    idleMouseCircle(f); assert.equal(f.g.paddleTrick?.active, true);
    f.g.time = f.g.paddleTrick.startedAt + .36; f.g.updatePaddleTrick(); abort(f);
    assert.equal(f.g.paddleTrick.active, false); assert.equal(f.g.paddleTrick.points.length, 0);
    assert.equal(f.g._playerFace ?? 1, 1, 'an aborted toss has not selected the opposite standard face');
  }
  const rm = inputGame('mouse'); rm.g.state = lib.GS.POINT; rm.g.ball.live = false; rm.g.reducedMotion = true; rm.g.resetPaddle(true);
  idleMouseCircle(rm);
  assert.equal(rm.g.playerActiveFace, -1); assert.equal(rm.g.paddleTrick.active, false);
  assert.equal(rm.g.paddleTrick.pose(rm.g.player), null); assert.equal(rm.g.stats.shots, 0);
});

test('the caught standard face survives the next accepted stroke and its recovery', () => {
  const f = inputGame('mouse'), { g, send } = f;
  g.state = lib.GS.POINT; g.ball.live = false; g.resetPaddle(true); idleMouseCircle(f);
  g.time = g.paddleTrick.startedAt + .72; g.updatePaddleTrick();
  assert.equal(g.playerActiveFace, -1);
  g.state = lib.GS.RALLY; g.ball.live = true; g.ball.lastHitBy = -1; g.rallyBounces = [1];
  lib.V3.copy(g.player.pos, g.ball.p); g.player.pos.y -= .04;
  lib.V3.copy(g.player.prevPos, g.player.pos); lib.V3.copy(g.player.prev, g.player.pos);
  g._paddleHold = null; g._calValues = { captureK: 1 };
  const point = g.project(g.ball.p, {}), end = { x: point.x, y: point.y - .08 };
  send('pointerdown', point, 10000); send('pointermove', end, 10040); send('pointerup', end, 10080);
  assert.equal(g.stats.shots, 1); assert.equal(g.player.activeFace, -1); assert.equal(g.player.contactPose.activeFace, -1);
  assert.equal(g.player.contactPose.localPoint.z, -.010);
  for (let i = 0; i < 40; i++) {
    g.updatePlayerPaddle(1 / 60); assert.equal(g.player.activeFace, -1); assert.equal(g.playerActiveFace, -1);
  }
});

function releasedSwipe() {
  const g = Object.create(lib.Game.prototype);
  g.time = 10; g.strokeTime = 5; g.swipeReleasedAt = -Infinity;
  g.swipe = new lib.SwipeTracker();
  g.swipe.down(.5, .7, 9.9, 4.97);
  g.swipe.move(.5, .52, 9.95, 4.985);
  g.swipe.up(.5, .4, 10, 5);
  g.swipeReleasedAt = 10;
  return g;
}

test('a compact horizontal serve with the actual standard equipment has two legal production bounces', () => {
  for (const direction of [-1, 1]) for (const face of [-1, 1]) {
    const { g, send } = inputGame('mouse', .3);
    g.equip = new lib.Equipment(); g._playerFace = face;
    g.state = lib.GS.SERVE_TOSS; g.server = 1; g.isServeBall = true; g.rallyBounces = [];
    lib.V3.set(g.player.pos, 0, lib.PH.TABLE_Y + .28, 1.78);
    lib.V3.copy(g.player.prevPos, g.player.pos);
    lib.V3.set(g.ball.p, 0, lib.PH.TABLE_Y + .30, 1.6);
    lib.V3.set(g.ball.v, 0, -1, -.02); lib.V3.zero(g.ball.w); g.ball.lastHitBy = 0;
    g.tossStartY = lib.PH.TABLE_Y + .14; g.tossApex = lib.PH.TABLE_Y + .40;
    const p = g.project(g.ball.p, {});
    send('pointerdown', p, 1000);
    for (let i = 1; i <= 4; i++) send('pointermove', { x: p.x + direction * .02 * i, y: p.y }, 1000 + i * 20.1);
    assert.equal(g.stats.shots, 1);
    const flight = lib.predict(g.ball.p, g.ball.v, g.ball.w,
      { dt: lib.PH.SIM_DT, maxT: 2.6, stopAfterBounces: 2 });
    assert.equal(flight.hitNet, false);
    assert.ok(flight.landed && flight.landed.z > 0 && flight.b2 && flight.b2.z < 0,
      JSON.stringify({ direction, face, first: flight.landed, second: flight.b2, quality: g.lastShotInfo?.quality }));
  }
});

test('a released stroke stays fresh in ball time, not wall time, through slowmo transitions', () => {
  const g = releasedSwipe();
  assert.ok(g.playerStrokeIntent(false));
  // 700 ms of real time at 0.3x: the ball has only advanced 210 ms.
  g.time += .7; g.strokeTime += .21;
  assert.ok(g.playerStrokeIntent(false), 'stroke expired while the slowed ball was still approaching');
  // Speed can change mid-flight: elapsed simulated time is accumulated, not
  // recomputed by multiplying the whole gesture by the current timeScale.
  g.time += .04; g.strokeTime += .04;
  assert.equal(g.playerStrokeIntent(false), null, 'expired input cannot return a later ball');
});

test('normal speed still expires the released stroke after the same simulation window', () => {
  const g = releasedSwipe();
  g.time += .26; g.strokeTime += .26;
  assert.equal(g.playerStrokeIntent(false), null);
});

test('a stationary hold is not a shot and an old unrecognised drag cannot re-arm itself', () => {
  const g = Object.create(lib.Game.prototype);
  g.time = 1; g.strokeTime = 1; g.swipeReleasedAt = -Infinity;
  g.swipe = new lib.SwipeTracker();
  g.swipe.down(.5, .6, 1, 1);
  assert.equal(g.playerStrokeIntent(false), null);
  g.swipe.move(.5, .4, 1.01, 1.01);
  g.time = 2; g.strokeTime = 2;
  assert.equal(g.playerStrokeIntent(false), null);
});

test('a neutral rally tap is not a serve unless explicitly stamped for a contact serve tap', () => {
  const sw = new lib.SwipeTracker();
  sw.down(.5, .5, 0); sw.up(.5, .5, .08);
  assert.equal(lib.isRealStroke(sw.lastReleased, false), false);
  const tap = lib.tapStrokeMetrics(sw.lastReleased, .5, .5);
  assert.equal(lib.isRealStroke(tap, false), true);
  assert.equal(lib.isRealStroke(tap, true), false);
  assert.equal(lib.isRealStroke(lib.tapStrokeMetrics(sw.lastReleased, .5, .5, true), true), true);
  assert.equal(tap.dx, 0); assert.equal(tap.dy, 0); assert.equal(tap.curl, 0);
});

function renderedContactBall(g) {
  const pad = g.player, local = pad.contactPose.localPoint;
  const m = lib.M4.compose(lib.M4.create(), pad.pos, pad.q, lib.V3.new(1, 1, 1));
  return lib.V3.new(m[0] * local.x + m[4] * local.y + m[8] * local.z + m[12] + pad.normal.x * lib.PH.R,
    m[1] * local.x + m[5] * local.y + m[9] * local.z + m[13] + pad.normal.y * lib.PH.R,
    m[2] * local.x + m[6] * local.y + m[10] * local.z + m[14] + pad.normal.z * lib.PH.R);
}

test('mouse and touch confirm a click on release without waiting for any animation frame', () => {
  for (const type of ['mouse', 'touch']) for (const scale of [1, .3]) {
    const { g, send } = inputGame(type, scale), contact = lib.V3.clone(g.ball.p), time = g.time;
    send('pointerdown');
    assert.equal(g.ball.lastHitBy, -1, `${type}/${scale}: down must leave room for a swipe`);
    assert.equal(g.stats.shots, 0);
    send('pointerup');
    assert.equal(g.ball.lastHitBy, 1, `${type}/${scale}: release did not confirm the tap`);
    assert.ok(g.ball.v.z < 0);
    assert.equal(g.time, time, 'input must not advance the game clock');
    assert.equal(g.stats.shots, 1);
    assert.equal(g.ball.trailGrade, 'yellow');
    assert.equal(g.shotJournal.latest.contact.incoming.gesture.tap, true);
    assert.ok(lib.V3.dist(renderedContactBall(g), contact) < 1e-6, 'the rendered rubber, not the blade center, must touch the actual ball');
    assert.equal(g.anticipation.active, false);
    assert.equal(lib.V3.len(g.anticipation.visualOffset), 0);
    send('pointerup');
    assert.equal(g.stats.shots, 1, 'release must not repeat the same contact');
    g.ball.lastHitBy = -1; g.rallyBounces = [1];
    lib.V3.copy(g.ball.p, g.player.pos); lib.V3.set(g.ball.v, 0, 0, 6);
    g.tryPlayerHit(lib.V3.clone(g.ball.p));
    assert.equal(g.ball.lastHitBy, -1, 'the press cannot return a second ball');
  }
});

test('a backswing remains a swipe and fresh movement can strike without waiting for rAF', () => {
  const { g, send } = inputGame(), p = g.project(g.ball.p, {});
  send('pointerdown', { x: p.x, y: p.y + .09 }, 1000);
  assert.equal(g.ball.lastHitBy, -1, 'a press below the ball must not become an immediate tap');
  assert.ok(g.swipe.pressZone.accepted);
  send('pointermove', p, 1040);
  assert.equal(g.ball.lastHitBy, 1, 'fresh hardware input must not wait for simulation time to catch up');
  assert.notEqual(g.shotJournal.latest.contact.incoming.gesture.tap, true);
});

test('instant input keeps bounce, reach, pause and cancellation gates', () => {
  const volley = inputGame(); volley.g.rallyBounces = [];
  volley.send('pointerdown'); volley.send('pointerup');
  assert.equal(volley.g.ball.lastHitBy, -1, 'a tap cannot volley');
  const far = inputGame(); far.g.ball.p.z = 2.9;
  far.send('pointerdown'); far.send('pointerup');
  assert.equal(far.g.ball.lastHitBy, -1, 'a tap cannot reach beyond the physical limits');
  const paused = inputGame(); paused.g.paused = true;
  paused.send('pointerdown'); paused.send('pointerup');
  assert.equal(paused.g.ball.lastHitBy, -1);
  const cancelled = inputGame(), p = cancelled.g.project(cancelled.g.ball.p, {});
  cancelled.send('pointerdown', { x: p.x, y: p.y + .09 });
  cancelled.send('pointercancel'); cancelled.send('pointerup', p);
  assert.equal(cancelled.g.ball.lastHitBy, -1, 'cancelling before contact cannot produce a release shot');
  const cancelledTap = inputGame();
  cancelledTap.send('pointerdown'); cancelledTap.send('pointercancel'); cancelledTap.send('pointerup');
  assert.equal(cancelledTap.g.ball.lastHitBy, -1, 'a cancelled pending click cannot hit');
});

test('held and released mouse and touch gestures cannot return a different shot', () => {
  for (const type of ['mouse', 'touch']) for (const released of [false, true]) {
    const { g, send } = inputGame(type);
    g.ball.lastHitBy = 1; g.ball.v.z = -6;
    const p = g.project(g.ball.p, {}), end = { x: p.x, y: p.y - .08 };
    send('pointerdown', p, 1000); send('pointermove', end, 1040);
    if (released) send('pointerup', end, 1080);
    assert.equal(g.swipe.pressZone.accepted, true);
    assert.equal(g.swipe.pressZone.shotId, g.shotId);
    g.shotId++; g.ball.lastHitBy = -1; g.ball.v.z = 6;
    g.rallyBounces = [1]; g.time += .15; g.strokeTime += .15;
    lib.V3.copy(g.player.pos, g.ball.p); lib.V3.copy(g.player.prevPos, g.player.pos);
    assert.ok(g.playerStrokeIntent(false), 'the old gesture is still fresh, not merely expired');
    assert.equal(g.pressAdmitsBall(), false);
    const before = JSON.stringify(g.ball);
    g.tryInputHit(released ? g.swipe.lastReleased : g.swipe.m);
    g.tryPlayerHit(lib.V3.clone(g.ball.p));
    assert.equal(g.stats.shots, 0, `${type}/${released}: old press returned a new shot`);
    assert.equal(JSON.stringify(g.ball), before);
    assert.equal(g.pressConsumed(), false);
  }
});

test('the final pointerup promotes a real rally backswing just like pointermove', () => {
  for (const type of ['mouse', 'touch']) for (const finalEvent of ['pointerup', 'pointermove']) {
    const { g, send } = inputGame(type);
    lib.V3.set(g.ball.p, 0, 1.7, 1.3); lib.V3.set(g.ball.v, 0, 1, 12);
    const p = g.project(g.ball.p, {});
    send('pointerdown', { x: .5, y: .55 }, 1000);
    send('pointermove', { x: .5, y: .53 }, 1020);
    assert.equal(g.swipe.pressZone.accepted, false);
    assert.equal(g.swipe.pressZone.pendingBackswing, true);
    send(finalEvent, p, 1100);
    assert.equal(g.stats.shots, 1, `${type}/${finalEvent}: final stroke point was ignored`);
    assert.equal(g.ball.lastHitBy, 1);
    assert.notEqual(g.shotJournal.latest.contact.incoming.gesture.tap, true);
    send('pointerup', p, 1120);
    assert.equal(g.stats.shots, 1, 'a later release cannot repeat the contact');
  }
});

test('a tilted blade cannot mix lateral and depth allowances from different capture frames', () => {
  for (const type of ['mouse', 'touch']) for (const direction of [-1, 1]) {
    const { g, send } = inputGame(type), { V3 } = lib;
    g.tryInputHit = () => {};
    const p = g.project(g.ball.p, {});
    send('pointerdown', p, 1000); send('pointermove', { x: p.x, y: p.y - .08 }, 1040);
    g.time += .1; g.strokeTime += .1;
    V3.set(g.ball.p, direction * .2, 1.05, 1.9); V3.set(g.ball.v, 0, 0, 6);
    V3.set(g.player.pos, 0, 1.05, 1.5); V3.copy(g.player.prevPos, g.player.pos);
    V3.norm(g.player.normal, V3.new(direction, 0, -1));
    const capture = lib.bladePlaneCapture(g.ball.p, g.ball.p, g.player.pos, g.player.pos, g.player.normal);
    assert.equal(capture.ok, false); assert.equal(capture.grace, false);
    nearInput(capture.lat, .2); nearInput(capture.dzEff, .4);
    const before = JSON.stringify(g.ball);
    g.tryPlayerHit(V3.clone(g.ball.p));
    assert.equal(g.stats.shots, 0, `${type}/${direction}: phantom tilted-blade contact`);
    assert.equal(JSON.stringify(g.ball), before);
    // Both whole capture frames remain independently usable.
    for (const [dx, dz, lateral, depth] of [[.1, .2, .1, .2], [.26, .02, .28 / Math.SQRT2, .24 / Math.SQRT2]]) {
      const ball = V3.new(direction * dx, 1.05, 1.5 + dz);
      const legal = lib.bladePlaneCapture(ball, ball, g.player.pos, g.player.pos, g.player.normal);
      assert.equal(legal.ok, true); assert.equal(legal.grace, false);
      nearInput(legal.lat, lateral); nearInput(legal.dzEff, depth);
    }
  }
});

test('stationary sample density and eviction preserve held and released swipe eligibility without old power', () => {
  for (const type of ['mouse', 'touch']) for (const released of [false, true]) for (const moves of [0, 24, 128]) {
    const { g, send } = inputGame(type), { V3 } = lib;
    g.tryInputHit = () => {};
    const p = g.project(g.ball.p, {});
    send('pointerdown', { x: p.x, y: p.y + .10 }, 1000);
    g.time = g.strokeTime = 1.05;
    send('pointermove', p, 1050);
    assert.ok(g.playerStrokeIntent(false));
    const peak = g.swipe.m.peakSpeed;
    for (let i = 1; i <= moves; i++) {
      g.time = g.strokeTime = 1.05 + .5 * i / (moves + 1);
      send('pointermove', p, g.time * 1000);
    }
    g.time = g.strokeTime = 1.55;
    send(released ? 'pointerup' : 'pointermove', p, 1550);
    const metrics = released ? g.swipe.lastReleased : g.swipe.m;
    assert.equal(lib.isRealStroke(metrics, false), true);
    assert.equal(lib.isRealStroke(metrics, true), true);
    assert.ok(g.playerStrokeIntent(false));
    nearInput(metrics.gesturePeakSpeed, peak); nearInput(metrics.pathLen, .10);
    nearInput(metrics.peakSpeed, 0); nearInput(metrics.speed, 0); nearInput(metrics.releaseSpeed, 0);
    if (moves > g.swipe.maxSamples) {
      assert.equal(metrics.samples, g.swipe.maxSamples);
      assert.ok(g.swipe.evictedPathLen > .09, 'the original moving segment was evicted');
    }
    const ctx = g._playerEffortContext(false), neutral = { ...metrics, gesturePeakSpeed: 0 };
    assert.equal(lib.deriveStroke({ ...metrics }, { ...ctx }).power, 0);
    assert.deepEqual(lib.describeStrokeEffort(metrics, ctx), lib.describeStrokeEffort(neutral, ctx));
    V3.copy(g.player.pos, g.ball.p); V3.copy(g.player.prevPos, g.player.pos);
    g.tryPlayerHit(V3.clone(g.ball.p));
    assert.equal(g.stats.shots, 1, `${type}/${released}/${moves}: recognized stroke disappeared`);
  }
});

test('recognition peak resets on down and cancel and never admits a stationary or too-slow gesture', () => {
  const sw = new lib.SwipeTracker();
  sw.down(.5, .7, 0); sw.move(.5, .6, .05);
  assert.equal(lib.isRealStroke(sw.m, false), true);
  const fast = { ...sw.m };
  delete fast.gesturePeakSpeed;
  assert.equal(lib.isRealStroke(fast, false), true, 'internal profiles still use their explicit peakSpeed');
  sw.down(.5, .7, 1);
  assert.equal(sw.m.gesturePeakSpeed, 0);
  sw.move(.5, .7, 1.1); sw.up(.5, .7, 1.2);
  assert.equal(lib.isRealStroke(sw.lastReleased, false), false);
  sw.down(.5, .7, 2); sw.move(.5, .6, 2.05); sw.cancel();
  assert.equal(sw.m.gesturePeakSpeed, 0); assert.equal(sw.lastReleased, null);
  sw.down(.5, .7, 3); sw.move(.5, .6, 5); sw.up(.5, .6, 5.1);
  assert.ok(sw.lastReleased.pathLen > .09);
  assert.equal(lib.isRealStroke(sw.lastReleased, false), false);
  assert.equal(lib.isRealStroke(sw.lastReleased, true), false);
});

test('a legal falling toss can be served by a confirmed click; a rising toss cannot', () => {
  for (const vy of [1, -1]) {
    const { g, send } = inputGame();
    g.state = lib.GS.SERVE_TOSS; g.isServeBall = true; g.ball.lastHitBy = 0;
    g.tossStartY = lib.PH.TABLE_Y + .14; g.tossApex = lib.PH.TABLE_Y + .40;
    lib.V3.set(g.ball.p, 0, lib.PH.TABLE_Y + .30, 1.6); lib.V3.set(g.ball.v, 0, vy, -.02);
    send('pointerdown');
    assert.equal(g.ball.lastHitBy, 0, 'down cannot choose tap over the intended swipe');
    send('pointerup');
    assert.equal(g.ball.lastHitBy, vy < 0 ? 1 : 0);
    if (vy < 0) {
      assert.equal(g.state, lib.GS.RALLY);
      assert.equal(g.matchTasks.serves, 1);
      assert.equal(g.shotJournal.latest.strokeId, 'SERVE_NO_SPIN');
      assert.ok(lib.V3.len(g.ball.w) / (2 * Math.PI) < 1, 'flat serve spin is tested before the first bounce');
      const flight = lib.predict(lib.V3.clone(g.ball.p), lib.V3.clone(g.ball.v), lib.V3.clone(g.ball.w),
        { dt: lib.PH.SIM_DT, maxT: 2.2, stopAfterBounces: 2, out: {} });
      assert.ok(flight.landed && flight.landed.z > 0 && flight.b2 && flight.b2.z < 0 && !flight.hitNet,
        'the tap serve must bounce on both halves and clear the net');
    }
  }
});

test('a confirmed short click follows the same moving ball without rewinding the contact', () => {
  for (const type of ['mouse', 'touch']) for (const scale of [1, .3]) {
    const { g, send } = inputGame(type, scale), start = g.project(g.ball.p, {});
    send('pointerdown', start, 1000);
    const simDt = .06 * scale;
    for (let t = 0; t < simDt; t += lib.PH.SIM_DT) lib.integrateBall(g.ball.p, g.ball.v, g.ball.w, Math.min(lib.PH.SIM_DT, simDt - t));
    g.time += .06; g.strokeTime += simDt;
    const contact = lib.V3.clone(g.ball.p);
    send('pointerup', start, 1060);
    assert.equal(g.ball.lastHitBy, 1, `${type}/${scale}: the original short click lost its moving ball`);
    assert.ok(lib.V3.dist(renderedContactBall(g), contact) < 1e-6, 'the rendered contact must use the current ball, not the down snapshot');
    assert.equal(g.stats.shots, 1);
  }
});

test('on-ball horizontal mouse and touch drags create signed sidespin in rally and serve', () => {
  for (const type of ['mouse', 'touch']) for (const scale of [1, .3]) {
    for (const serving of [false, true]) for (const direction of [-1, 1]) {
      for (const incomingTop of serving ? [0] : [0, 120, -120]) {
        const { g, send } = inputGame(type, scale);
        if (serving) {
          g.state = lib.GS.SERVE_TOSS; g.isServeBall = true; g.ball.lastHitBy = 0;
          g.tossStartY = lib.PH.TABLE_Y + .14; g.tossApex = lib.PH.TABLE_Y + .40;
          lib.V3.set(g.ball.p, 0, lib.PH.TABLE_Y + .30, 1.6); lib.V3.set(g.ball.v, 0, -1, -.02);
        }
        lib.V3.set(g.ball.w, incomingTop, 0, 0);
        const start = g.project(g.ball.p, {}), before = g.ball.lastHitBy;
        const end = { x: start.x + direction * .08, y: start.y };
        send('pointerdown', start, 1000);
        assert.equal(g.ball.lastHitBy, before, 'pressing the ball must not consume the horizontal gesture');
        send('pointermove', end, 1040);
        const label = `${type}/${scale}/${serving ? 'serve' : 'rally'}/${direction}/${incomingTop}`;
        assert.equal(g.ball.lastHitBy, 1, `${label}: real movement did not strike`);
        assert.equal(g.lastShotInfo.stroke.id, serving ? 'SERVE_SIDE' : 'SIDE', label);
        const gesture = g.shotJournal.latest.contact.incoming.gesture;
        assert.notEqual(gesture.tap, true, `${label}: swipe became a tap`);
        assert.ok(Math.abs(gesture.curl) < 1e-6, `${label}: sidespin cannot require a C-shaped gesture`);
        assert.ok(Math.abs(g.ball.w.y) > Math.abs(g.ball.w.x), `${label}: vertical spin dominates ${JSON.stringify(g.ball.w)}`);
        assert.ok(direction * g.ball.w.y > 0, `${label}: sideways brush sign does not follow its direction ${JSON.stringify({
          v: g.ball.v, w: g.ball.w, normal: g.lastShotInfo.normal, vR: g.lastShotInfo.vR,
          elev: g.lastShotInfo.elev, contact: g.lastShotInfo.contact, azFace: g.lastShotInfo.azFace, azSwing: g.lastShotInfo.azSwing })}`);
        const flight = lib.predict(lib.V3.clone(g.ball.p), lib.V3.clone(g.ball.v), lib.V3.clone(g.ball.w),
          { dt: lib.PH.SIM_DT, maxT: 2.6, stopAfterBounces: serving ? 2 : 1, stopOnFirstBounce: !serving, out: {} });
        assert.equal(flight.hitNet, false, `${label}: sidespin struck the net`);
        assert.equal(Math.sign(flight.landed?.z), serving ? 1 : -1, `${label}: sidespin missed the playable court ${JSON.stringify({
          v:g.ball.v,w:g.ball.w,kind:flight.kind,plane:flight.planeCross,elev:g.lastShotInfo.elev,contact:g.lastShotInfo.contact
        })}`);
        if (serving) assert.equal(Math.sign(flight.b2?.z), -1, `${label}: sidespin serve missed the receiver's court`);
        send('pointerup', end, 1080);
        assert.equal(g.stats.shots, 1, `${label}: release duplicated the contact`);
      }
    }
  }
});

test('a released single-motion serve swipe survives until the toss falls; a toss tap does not', () => {
  for (const swipe of [false, true]) {
    const { g, send } = inputGame(), { V3, PH, GS } = lib;
    g.state = GS.SERVE_READY; g.isServeBall = true; g.ball.live = false; g.ball.lastHitBy = 0;
    V3.set(g.player.pos, 0, PH.TABLE_Y + .28, 1.78);
    V3.set(g.ball.p, 0, PH.TABLE_Y + .14, 1.74); V3.zero(g.ball.v);
    const p = g.project(g.ball.p, {}), start = { x: p.x, y: p.y + .06 };
    send('pointerdown', start);
    assert.equal(g.state, GS.SERVE_TOSS);
    assert.equal(g.ball.lastHitBy, 0, 'the initial press is only the toss');
    g.time += .04; g.strokeTime += .04;
    if (swipe) send('pointermove', { x: p.x, y: p.y - .06 });
    g.time += .04; g.strokeTime += .04;
    send('pointerup', swipe ? { x: p.x, y: p.y - .06 } : start);
    assert.equal(g.swipe.pressZone.pendingServeDrop, swipe, 'only a real early swipe stays armed');
    while (g.ball.v.y >= 0) {
      lib.integrateBall(g.ball.p, g.ball.v, g.ball.w, PH.SIM_DT);
      g.tossApex = Math.max(g.tossApex, g.ball.p.y);
      g.time += PH.SIM_DT; g.strokeTime += PH.SIM_DT;
    }
    V3.copy(g.player.pos, g.ball.p); g.player.pos.y -= .04;
    g.tryPlayerHit(V3.clone(g.ball.p));
    assert.equal(g.ball.lastHitBy, swipe ? 1 : 0, 'the saved swipe must strike, without a second press');
    if (swipe) assert.equal(g.state, GS.RALLY);
  }
});

test('one stationary mouse hold serves once on the falling toss at any slowmo scale', () => {
  for (const [initialScale, nextScale] of [[1, 1], [.3, .3], [1, .3], [.3, 1]]) {
    const { g, send } = inputGame('mouse', initialScale), { V3, PH, GS } = lib;
    g.state = GS.SERVE_READY; g.isServeBall = true; g.ball.live = false; g.ball.lastHitBy = 0;
    V3.set(g.player.pos, 0, PH.TABLE_Y + .28, 1.78);
    V3.set(g.ball.p, 0, PH.TABLE_Y + .14, 1.74); V3.zero(g.ball.v);
    send('pointerdown');
    const gestureId = g.swipe.gestureId;
    for (let simT = 0; simT < .7 && g.ball.lastHitBy === 0; simT += PH.SIM_DT) {
      const scale = simT < .1 ? initialScale : nextScale;
      g.timeScale = scale; g.time += PH.SIM_DT / scale; g.strokeTime += PH.SIM_DT;
      const before = V3.clone(g.ball.p);
      lib.integrateBall(g.ball.p, g.ball.v, g.ball.w, PH.SIM_DT);
      g.tossApex = Math.max(g.tossApex, g.ball.p.y);
      const rising = g.ball.v.y >= 0;
      g.tryPlayerHit(before);
      if (rising) assert.equal(g.stats.shots, 0, 'hold cannot serve the rising toss');
    }
    const label = `${initialScale}->${nextScale}`;
    assert.equal(g.stats.shots, 1, `${label}: a single stationary hold did not serve`);
    assert.equal(g.ball.lastHitBy, 1, label);
    assert.equal(g.shotJournal.latest.strokeId, 'SERVE_NO_SPIN', label);
    assert.equal(g.swipe.consumedGestureId, gestureId, 'the held press must be consumed');
    g.ball.lastHitBy = -1; g.rallyBounces = [1]; g.pointerDown = true;
    V3.copy(g.ball.p, g.player.pos); V3.set(g.ball.v, 0, 0, 6);
    g.tryPlayerHit(V3.clone(g.ball.p));
    assert.equal(g.ball.lastHitBy, -1, 'keeping the same mouse button down cannot return the next ball');
  }
});

test('a falling mouse hold has a brief swipe window but needs no release to serve', () => {
  for (const scale of [1, .3]) {
    const { g, send } = inputGame('mouse', scale), { V3, PH, GS } = lib;
    g.state = GS.SERVE_TOSS; g.isServeBall = true; g.ball.lastHitBy = 0;
    g.tossStartY = PH.TABLE_Y + .14; g.tossApex = PH.TABLE_Y + .40;
    V3.set(g.ball.p, 0, PH.TABLE_Y + .30, 1.6); V3.set(g.ball.v, 0, -1, 0);
    V3.copy(g.player.pos, g.ball.p); g.player.pos.y -= .02;
    send('pointerdown');
    g.time += .025; g.strokeTime += .025 * scale;
    g.tryPlayerHit(V3.clone(g.ball.p));
    assert.equal(g.stats.shots, 0, 'down must still leave room for a directional swipe');
    g.time += .05; g.strokeTime += .05 * scale;
    g.tryPlayerHit(V3.clone(g.ball.p));
    assert.equal(g.stats.shots, 1, `${scale}: falling hold required a second click or release`);
  }
});

test('a short toss click or cancelled mouse hold cannot later serve itself', () => {
  for (const scale of [1, .3]) for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    const { g, send } = inputGame('mouse', scale), { V3, PH, GS } = lib;
    g.state = GS.SERVE_READY; g.isServeBall = true; g.ball.live = false; g.ball.lastHitBy = 0;
    V3.set(g.player.pos, 0, PH.TABLE_Y + .28, 1.78);
    V3.set(g.ball.p, 0, PH.TABLE_Y + .14, 1.74); V3.zero(g.ball.v);
    send('pointerdown');
    g.time += .02; g.strokeTime += .02 * scale;
    send(ending, g.project(g.ball.p, {}), 1020);
    for (let simT = 0; simT < .6; simT += PH.SIM_DT) {
      g.time += PH.SIM_DT / scale; g.strokeTime += PH.SIM_DT;
      const before = V3.clone(g.ball.p);
      lib.integrateBall(g.ball.p, g.ball.v, g.ball.w, PH.SIM_DT);
      g.tossApex = Math.max(g.tossApex, g.ball.p.y);
      g.tryPlayerHit(before);
    }
    assert.equal(g.stats.shots, 0, `${scale}/${ending}: abandoned press served automatically`);
  }
});

test('a stationary serve click ages in ball time on release, not in slowmo wall time', () => {
  for (const scale of [1, .3]) {
    const { g, send } = inputGame('mouse', scale), { V3, PH, GS } = lib;
    g.state = GS.SERVE_TOSS; g.isServeBall = true; g.ball.lastHitBy = 0;
    g.tossStartY = PH.TABLE_Y + .14; g.tossApex = PH.TABLE_Y + .40;
    V3.set(g.ball.p, 0, PH.TABLE_Y + .30, 1.6); V3.set(g.ball.v, 0, -1, 0);
    send('pointerdown');
    g.time += .12 / scale; g.strokeTime += .12;
    send('pointerup', g.project(g.ball.p, {}), 1000 + .12 / scale * 1000);
    assert.equal(g.stats.shots, 1, `${scale}: the same ball-time click expired on release`);
  }
});

test('fast drags delivered in the same animation frame keep their start point', () => {
  const sw = new lib.SwipeTracker();
  sw.down(.5, .75, 1, 1);
  sw.move(.5, .60, 1, 1);
  sw.move(.5, .45, 1, 1);
  sw.up(.5, .40, 1, 1);
  assert.equal(sw.lastReleased.sy, .75);
  assert.ok(sw.lastReleased.dy < -.30);
  assert.equal(lib.isRealStroke(sw.lastReleased, false), true);
});

test('a fast cross-court mouse stroke is not re-centred or softened back onto the table by Game', () => {
  for (const scale of [1, .3]) for (const serving of [false, true]) for (const x of [-.55, .55]) {
    const { g, send } = inputGame('mouse', scale), { V3, PH, GS } = lib;
    V3.set(g.ball.p, x, 1.10, 1.6); V3.set(g.ball.v, 0, -1, serving ? 0 : 5);
    V3.copy(g.player.pos, g.ball.p); V3.copy(g.player.prevPos, g.player.pos); V3.copy(g.player.prev, g.player.pos);
    if (serving) {
      g.state = GS.SERVE_TOSS; g.isServeBall = true; g.ball.lastHitBy = 0;
      g.tossStartY = .9; g.tossApex = 1.3;
    }
    const point = g.project(g.ball.p, {}), direction = -Math.sign(x), originalApply = g.applyHit;
    let accepted;
    g.applyHit = function (side, racket, ...args) { accepted = racket; return originalApply.call(this, side, racket, ...args); };
    send('pointerdown', point, 1000);
    send('pointermove', { x: point.x + direction * .07, y: point.y }, 1012);
    const label = `${scale}/${serving ? 'serve' : 'return'}/${x}`;
    assert.equal(g.stats.shots, 1, `${label}: the swipe must make contact`);
    assert.equal(accepted.playerControlled, true, label);
    assert.equal(accepted.intentionalOut, true, label);
    assert.equal(!!accepted.softened, false, `${label}: the safety ladder overruled the player's power`);
    const flight = lib.predict(g.ball.p, g.ball.v, g.ball.w,
      { dt: PH.SIM_DT, maxT: 3, stopAfterBounces: serving ? 2 : 1, out: {} });
    const landing = serving ? flight.b2 || flight.secondPlaneCross : flight.landed || flight.planeCross;
    assert.ok(landing && landing.x * direction > PH.T_HALF_WID,
      `${label}: the hard swipe was re-aimed to the centre: ${JSON.stringify(landing)}`);
  }
});

test('hardware gesture timing survives a stalled render clock without collapsing later samples', () => {
  const { g, send } = inputGame();
  g.tryInputHit = () => {};
  send('pointerdown', { x: .5, y: .7 }, 1000);
  send('pointermove', { x: .5, y: .6 }, 1200);
  send('pointermove', { x: .5, y: .5 }, 1500);
  send('pointerup', { x: .5, y: .4 }, 1600);
  assert.ok(Math.abs(g.swipe.lastReleased.dur - .6) < 1e-9);
  assert.ok(Math.abs(g.swipe.samples.at(-1).t - g.swipe.samples.at(-2).t - .1) < 1e-9);
  assert.equal(g.time, 1, 'hardware input must not advance the simulation');
});

test('coalesced pointer samples retain the curved path instead of only its short chord', () => {
  const { g, send, width, height } = inputGame();
  g.tryInputHit = () => {};
  const points = [[.50, .70], [.42, .66], [.38, .58], [.42, .50], [.50, .46], [.56, .50]];
  send('pointerdown', { x: points[0][0], y: points[0][1] }, 1000);
  const samples = points.slice(1).map(([x, y], i) => ({ pointerId: 1, pointerType: 'touch',
    clientX: x * width, clientY: y * height, timeStamp: 1020 + i * 20 }));
  send('pointermove', { x: points.at(-1)[0], y: points.at(-1)[1] }, 1100,
    { getCoalescedEvents: () => samples });
  assert.ok(g.swipe.m.samples >= points.length);
  assert.ok(g.swipe.m.pathLen > .40, `path was reduced to ${g.swipe.m.pathLen}`);
  assert.ok(Math.abs(g.swipe.m.curl) > 2, `curve was reduced to ${g.swipe.m.curl}`);
});

test('a coalesced future curve cannot steal or relabel an earlier real straight contact', () => {
  const records = [];
  for (const coalesced of [false, true]) {
    const { g, send, width, height } = inputGame('mouse'), p = g.project(g.ball.p, {});
    const points = [[p.x + .07, p.y], [p.x + .09, p.y + .025], [p.x + .07, p.y + .06],
      [p.x + .02, p.y + .08], [p.x - .02, p.y + .06]];
    send('pointerdown', p, 1000);
    if (coalesced) {
      const samples = points.map(([x, y], i) => ({ pointerId: 1, pointerType: 'mouse',
        clientX: x * width, clientY: y * height, timeStamp: 1040 + i * 20 }));
      const last = points.at(-1);
      send('pointermove', { x: last[0], y: last[1] }, 1120, { getCoalescedEvents: () => samples });
    } else for (const [i, [x, y]] of points.entries()) send('pointermove', { x, y }, 1040 + i * 20);
    assert.equal(g.stats.shots, 1);
    assert.equal(g.shotJournal.latest.strokeId, 'SIDE');
    const gesture = g.shotJournal.latest.contact.incoming.gesture;
    nearInput(gesture.curl, 0); nearInput(gesture.pathLen, .07);
    records.push(JSON.parse(JSON.stringify({ gesture, v: g.ball.v, w: g.ball.w })));
  }
  assert.deepEqual(records[1], records[0], 'event batching must preserve the earliest real contact');
});

test('a coalesced path from before pointer-down cannot steal the current contact or produce maximal force', () => {
  const accepted = [];
  for (const stale of [false, true]) {
    const { g, send, width, height } = inputGame('mouse'), p = g.project(g.ball.p, {});
    send('pointerdown', p, 1000);
    const end = { x: p.x + .07, y: p.y };
    const samples = stale ? [{ pointerId: 1, pointerType: 'mouse', timeStamp: 980,
      clientX: (p.x - .3) * width, clientY: (p.y - .2) * height },
      { pointerId: 1, pointerType: 'mouse', timeStamp: 995,
        clientX: (p.x + .2) * width, clientY: (p.y + .1) * height }] : [];
    send('pointermove', end, 1040, { getCoalescedEvents: () => samples });
    assert.equal(g.stats.shots, 1); assert.equal(g.shotJournal.latest.strokeId, 'SIDE');
    const gesture = g.shotJournal.latest.contact.incoming.gesture;
    nearInput(gesture.pathLen, .07); nearInput(gesture.curl, 0); nearInput(gesture.peakSpeed, 1.75);
    accepted.push(JSON.parse(JSON.stringify({ gesture, v: g.ball.v, w: g.ball.w })));
  }
  assert.deepEqual(accepted[1], accepted[0]);
});

function nearInput(a, b) { assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`); }

test('modest curves already observed before the first legal contact survive individual and coalesced input', () => {
  for (const [width, height] of [[1280, 760], [390, 844], [320, 480]]) for (const direction of [-1, 1]) {
    const accepted = [];
    for (const coalesced of [false, true]) {
      const { g, send } = inputGame(width > height ? 'mouse' : 'touch', 1, { width, height });
      const start = g.project(g.ball.p, {}), points = Array.from({ length: 13 }, (_, i) => {
        const angle = -Math.PI / 2 + 75 * Math.PI / 180 * i / 12;
        return { x: start.x + direction * 42 * Math.cos(angle) / width,
          y: start.y + 42 * (Math.sin(angle) + 1) / height };
      });
      g.rallyBounces = [];
      send('pointerdown', points[0], 1000);
      for (let i = 1; i <= 9; i++) send('pointermove', points[i], 1000 + i * 6);
      assert.equal(g.stats.shots, 0, 'an unbounced ball cannot be returned');
      g.rallyBounces = [1];
      if (coalesced) {
        const samples = points.slice(10).map((p, i) => ({ pointerId: 1,
          pointerType: width > height ? 'mouse' : 'touch', clientX: p.x * width,
          clientY: p.y * height, timeStamp: 1060 + i * 6 }));
        send('pointermove', points[12], 1072, { getCoalescedEvents: () => samples });
      } else for (let i = 10; i <= 12; i++) send('pointermove', points[i], 1000 + i * 6);
      const label = `${width}x${height}/${direction}/${coalesced}`;
      assert.equal(g.stats.shots, 1, `${label}: earliest legal contact must be real`);
      assert.equal(g.shotJournal.latest.strokeId, direction < 0 ? 'HOOK' : 'FADE', label);
      const gesture = g.shotJournal.latest.contact.incoming.gesture;
      assert.ok(Math.abs(gesture.curl) >= .55 && Math.abs(gesture.curl) < 75 * Math.PI / 180,
        'the saved contact uses the available prefix, not the completed future arc');
      accepted.push(JSON.parse(JSON.stringify({ gesture, v: g.ball.v, w: g.ball.w })));
    }
    assert.deepEqual(accepted[1], accepted[0], `${width}x${height}/${direction}: identical accepted prefixes`);
  }
});

test('a late cancellation from a different pointer cannot abandon the current stroke', () => {
  const { g, send } = inputGame();
  send('pointerdown');
  send('pointercancel', undefined, 1010, { pointerId: 9 });
  assert.equal(g.swipe.active, true);
  assert.equal(g.pointerDown, true);
  send('pointercancel');
  assert.equal(g.swipe.active, false);
});

test('window release completes a stroke when pointer capture was unavailable', () => {
  const { g, send, sendWindow } = inputGame('mouse');
  g.canvas.setPointerCapture = () => { throw Error('capture unavailable'); };
  g.tryInputHit = () => {};
  send('pointerdown', { x: .5, y: .7 }, 1000);
  sendWindow('pointermove', { x: .5, y: .5 }, 1050);
  sendWindow('pointerup', { x: .5, y: .4 }, 1100);
  assert.equal(g.pointerDown, false);
  assert.equal(g.swipe.active, false);
  assert.equal(lib.isRealStroke(g.swipe.lastReleased, false), true);
});

test('paddle tracking bounds actual three-dimensional travel, not only the logged velocity', () => {
  for (const fps of [30, 60, 120, 240]) {
    const { g } = inputGame();
    g.ball.live = false; g._calValues = { captureK: 1 };
    g.pointer = { x: .05, y: .35 };
    const start = lib.V3.clone(g.player.pos);
    g.updatePlayerPaddle(1 / fps);
    const actualSpeed = lib.V3.dist(start, g.player.pos) * fps;
    assert.ok(actualSpeed <= 15 + 1e-6, `${fps} Hz: actual travel reached ${actualSpeed} m/s`);
    assert.ok(Math.abs(actualSpeed - lib.V3.len(g.player.vel)) < 1e-6, 'telemetry must describe actual travel');
  }
});

test('post-contact recovery remains bounded after the gesture has been released', () => {
  for (const fps of [30, 60, 120, 240]) {
    const { g } = inputGame();
    g.ball.live = false; g._calValues = { captureK: 1 };
    g.pointer = { x: .05, y: .35 };
    g.paddleMotion = new lib.PaddleStrokeMotion();
    g.paddleMotion.contact(lib.V3.new(0, -.2, -1), .28, 'DRIVE', 'shakehand', 'right');
    for (let frame = 0; frame < fps * .2; frame++) {
      const start = lib.V3.clone(g.player.pos);
      g.updatePlayerPaddle(1 / fps);
      assert.ok(lib.V3.dist(start, g.player.pos) * fps <= 6 + 1e-6, `${fps} Hz: released recovery exceeded 6 m/s`);
    }
  }
});

test('a new point preserves the pointer and paddle instead of travelling home and back', () => {
  const { g } = inputGame('mouse');
  g.ball.live = false; g._calValues = { captureK: 1 };
  g.pointer = g.project(lib.V3.new(.35, 1.15, 1.78), {});
  const pointer = { ...g.pointer }, position = lib.V3.clone(g.player.pos);
  g.resetPaddle();
  assert.deepEqual(g.pointer, pointer);
  for (let i = 0; i < 60; i++) {
    g.time += 1 / 60;
    g.updatePlayerPaddle(1 / 60);
    g.clampPaddleVolume();
    assert.ok(lib.V3.dist(position, g.player.pos) < 1e-8, 'a new round moved the paddle without input');
  }
  g.pointer.x += .002;
  for (let i = 0; i < 30; i++) g.updatePlayerPaddle(1 / 60);
  const screen = g.project(g.player.pos, {});
  assert.ok(Math.hypot(screen.x - g.pointer.x, screen.y - g.pointer.y) < 1e-4,
    'the first new movement must restore absolute cursor binding, not keep the round-start offset');
});

test('a real strike never replays a second positional stroke or returns the paddle without input', () => {
  for (const scale of [1, .3]) for (const fps of [30, 60, 144]) {
    const { g, send } = inputGame('mouse', scale);
    g.settings.followThrough = true; g._calValues = { captureK: 1 };
    g.followThrough = { active: false, t: 0, swingDir: lib.V3.new() };
    const p = g.project(g.ball.p, {});
    send('pointerdown', { x: p.x, y: p.y + .08 }, 1000);
    send('pointermove', p, 1040);
    send('pointerup', p, 1080);
    assert.equal(g.stats.shots, 1);
    const position = lib.V3.clone(g.player.pos), normal = lib.V3.clone(g.player.normal);
    g.ball.live = false;
    for (let i = 0; i < fps; i++) {
      g.time += 1 / fps; g.strokeTime += scale / fps;
      g.updatePlayerPaddle(1 / fps, scale / fps);
      g.keepPaddleOnScreen(); g.clampPaddleVolume();
      assert.ok(lib.V3.dist(position, g.player.pos) < 1e-8, `${scale}/${fps}: animation moved the paddle after contact`);
      assert.ok(lib.V3.dist(normal, g.player.normal) < 1e-8, `${scale}/${fps}: animation replayed the racket face`);
    }
    assert.equal(g.paddleMotion.templateMotion, null, 'the complete authored motion must not replay after a live hit');
    g.pointer.x += .002;
    for (let i = 0; i < fps / 2; i++) g.updatePlayerPaddle(1 / fps, scale / fps);
    const screen = g.project(g.player.pos, {});
    assert.ok(Math.hypot(screen.x - g.pointer.x, screen.y - g.pointer.y) < 1e-4,
      `${scale}/${fps}: the contact-to-cursor offset survived new input`);
    assert.equal(g.stats.shots, 1, 'manual recovery cannot create another strike');
  }
});

test('mouse movement and release after impact use absolute cursor coordinates without a retained offset', () => {
  for (const scale of [1, .3]) {
    const { g, send, width, height } = inputGame('mouse', scale), { V3 } = lib;
    g._calValues = { captureK: 1 };
    const contact = g.project(g.ball.p, {});
    send('pointerdown', { x: contact.x, y: contact.y + .08 }, 1000);
    send('pointermove', contact, 1040);
    assert.equal(g.stats.shots, 1);
    g.ball.live = false;
    for (const [type, x, y, time] of [['pointermove', .35, 1.3, 1080], ['pointerup', -.25, 1.26, 1120],
      ['pointermove', .1, 1.34, 1160]]) {
      const cursor = g.project(V3.new(x, y, 1.78), {});
      assert.ok(cursor.x > 0 && cursor.x < 1 && cursor.y > 0 && cursor.y < 1, 'fixture cursor must stay on screen');
      send(type, cursor, time);
      for (let i = 0; i < 30; i++) {
        g.time += 1 / 60; g.strokeTime += scale / 60;
        g.updatePlayerPaddle(1 / 60, scale / 60);
        g.keepPaddleOnScreen(); g.clampPaddleVolume();
      }
      const blade = g.project(g.player.pos, {});
      const errorPx = Math.hypot((blade.x - cursor.x) * width, (blade.y - cursor.y) * height);
      assert.ok(errorPx < 1, `${scale}/${type}: racket remains ${errorPx.toFixed(1)} px from the cursor ` +
        JSON.stringify({ cursor, pointer: g.pointer, blade, pos: g.player.pos, target: g._padTarget }));
      assert.equal(g.stats.shots, 1, 'continuing the same physical stroke must not hit a second time');
    }
  }
});

test('the serve keeps one continuous backswing and forward animation until contact', () => {
  for (const x of [-.6, 0, .6]) for (const scale of [1, .3]) {
    const { g } = inputGame('mouse', scale), { V3, PH, GS } = lib;
    g.state = GS.SERVE_TOSS; g.server = 1; g.ball.lastHitBy = 0; g.isServeBall = true;
    g._calValues = { captureK: 1 }; g.tossStartY = .9; g.tossApex = 1.2;
    V3.set(g.player.pos, x, 1.04, 1.78);
    g.pointer = g.project(g.player.pos, {});
    /* The backswing lives on the ASCENT. A serve may only be struck while the
     * ball is falling, so the bat has to be at the toss for the whole legal
     * contact window; the old animation still held a 0.55 m pull-back at the
     * apex and released it at the table, which snapped the blade forward in
     * one frame on every serve. */
    V3.set(g.ball.p, x, .91, 1.5); V3.set(g.ball.v, 0, .00001, 0);
    g.updatePlayerPaddle(1 / 60, scale / 60);
    const start = { ...g._padTarget };
    g.ball.p.y = 1.05;
    g.updatePlayerPaddle(1 / 60, scale / 60);
    const midRise = { ...g._padTarget };
    g.ball.p.y = 1.2;
    g.updatePlayerPaddle(1 / 60, scale / 60);
    const apex = { ...g._padTarget };
    g.ball.v.y = -.00001;
    g.updatePlayerPaddle(1 / 60, scale / 60);
    const apexFalling = { ...g._padTarget };
    assert.ok(Math.abs(apexFalling.tz - apex.tz) < 1e-6 && Math.abs(apexFalling.ty - apex.ty) < 1e-6,
      'changing toss direction must not reverse the racket target');
    assert.ok(Math.abs(start.tz - apex.tz) < .08, 'the windup must start and end at the ball');
    assert.ok(midRise.tz - apex.tz > .35, 'the serve lost its backswing');
    const contactY = PH.TABLE_Y + lib.STROKE_CONFIG.serve.windup.contactY;
    g.ball.p.y = (1.2 + contactY) / 2;
    g.updatePlayerPaddle(1 / 60, scale / 60);
    const forward = { ...g._padTarget };
    g.ball.p.y = contactY;
    g.updatePlayerPaddle(1 / 60, scale / 60);
    const finish = { ...g._padTarget };
    assert.ok(Math.abs(forward.tz - apex.tz) < 1e-6 && Math.abs(finish.tz - apex.tz) < 1e-6,
      'the bat must stay on the ball through the entire falling contact window');
    assert.ok(midRise.tz > forward.tz, 'the backswing only exists while the ball rises');
  }
});

test('downward mouse and touch swipes return short post-bounce balls near the net', () => {
  for (const type of ['mouse', 'touch']) for (const scale of [1, .3]) {
    for (const z of [.45, .65, .90]) {
      const { g, send } = inputGame(type, scale);
      lib.V3.set(g.ball.p, .05, lib.PH.TABLE_Y + .20, z);
      lib.V3.set(g.ball.v, 0, -.1, .5); lib.V3.set(g.ball.w, -120, 0, 0);
      const p = g.project(g.ball.p, {});
      send('pointerdown', { x: p.x, y: p.y - .09 }, 1000);
      send('pointermove', p, 1040);
      assert.equal(g.ball.lastHitBy, 1, `${type}/${scale}/z=${z}: short ball was unreachable`);
      assert.ok(g.ball.v.z < 0, 'the return must travel toward the opponent');
      assert.notEqual(g.shotJournal.latest.contact?.incoming.gesture.tap, true);
      const flight = lib.predict(g.ball.p, g.ball.v, g.ball.w,
        { dt: lib.PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: {} });
      assert.ok(!flight.hitNet && flight.landed?.z < 0, `${type}/${scale}/z=${z}: short return did not clear the net`);
    }
  }
});

test('the shot journal follows the same scaled expiry as collision detection', () => {
  const g = releasedSwipe(), journal = new lib.ShotJournal();
  const entry = journal.observe(g.swipe.gestureId, g.swipe.lastReleased,
    { time: 10, sampleTime: 10, sampleSimTime: 5, simTime: 5, active: false, isServe: false, strokeId: 'LOOP' });
  journal.expire(10.7, 5.21);
  assert.equal(entry.outcome, 'pending');
  journal.expire(10.9, 5.26);
  assert.equal(entry.outcome, 'no_contact');
});

test('holding a press prepares the racket only during the player serve', () => {
  for (const type of ['mouse', 'touch']) {
    const resting = inputGame(type).g, held = inputGame(type).g;
    for (const g of [resting, held]) {
      g.ball.live = false; g._calValues = { captureK: 1 }; g.pointer = { x: .5, y: .55 };
    }
    held.pointerDown = true;
    for (let i = 0; i < 25; i++) { resting.updatePlayerPaddle(1 / 60); held.updatePlayerPaddle(1 / 60); }
    assert.equal(held._prep, 0, `${type}: rally press must not trigger a backswing`);
    assert.notEqual(held.player.motionStage, 'prepare');
    assert.ok(lib.V3.dist(resting.player.normal, held.player.normal) < 1e-8, 'the racket face is not cocked backwards');
    assert.ok(Math.abs(resting.player.roll - held.player.roll) < 1e-8);
    held.state = lib.GS.SERVE_TOSS; held.server = 1; held.ball.lastHitBy = 0;
    for (let i = 0; i < 25; i++) held.updatePlayerPaddle(1 / 60);
    assert.ok(held._prep > .5, `${type}: serve preparation remains`);
    held.state = lib.GS.RALLY; held.updatePlayerPaddle(1 / 60);
    assert.equal(held._prep, 0, 'a serve backswing must not leak into the rally');
  }
});

test('press anticipation is limited to the player serve, not rally shots', () => {
  for (const type of ['mouse', 'touch']) {
    const rally = inputGame(type); rally.send('pointerdown', { x: .7, y: .7 });
    assert.equal(rally.g.anticipation.active, false);
    const serve = inputGame(type); serve.g.state = lib.GS.SERVE_TOSS;
    serve.g.server = 1; serve.g.ball.lastHitBy = 0;
    serve.send('pointerdown', { x: .7, y: .7 });
    assert.equal(serve.g.anticipation.active, true);
  }
});

test('plain mouse and touch taps produce a controlled, legal return on both sides', () => {
  for (const type of ['mouse', 'touch']) for (const hand of ['left', 'right']) for (const x of [-.35, 0, .35]) {
    const { g, send } = inputGame(type); g.settings.hand = hand;
    g.ball.p.x = x; g.player.pos.x = x; g.player.prevPos.x = x;
    send('pointerdown'); send('pointerup');
    assert.equal(g.stats.shots, 1, `${type}/${hand}/${x} did not make contact`);
    assert.equal(g.player.activeFace, 1);
    assert.ok(lib.V3.len(g.ball.v) < 14, `${type}/${hand}/${x}: ${lib.V3.len(g.ball.v)} m/s`);
    const flight = lib.predict(lib.V3.clone(g.ball.p), lib.V3.clone(g.ball.v), lib.V3.clone(g.ball.w),
      { dt: lib.PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: {} });
    assert.ok(flight.landed && flight.landed.z < 0 && Math.abs(flight.landed.z) <= lib.PH.T_HALF_LEN && Math.abs(flight.landed.x) <= lib.PH.T_HALF_WID,
      `${type}/${hand}/${x}: ${JSON.stringify(flight.landed)}`);
  }
});

test('normal game time ignores legacy pace and clamps any accelerated target; explicit slowmo remains', () => {
  for (const flytime of [0, .5, 1]) for (const mode of ['normal', 'slow', 'badScale']) {
    const { g } = inputGame();
    Object.assign(g, { frame: 0, stateT: 0, stateSimT: 0, sessionKind: 'free',
      network: { isInMatch: false }, _cal: { flytime }, _calEffective: { flytime },
      _calPolicyKey: 'free|||false', slowmoUntil: mode === 'badScale' ? 10 : 0,
      targetTimeScale: mode === 'badScale' ? 1.8 : mode === 'slow' ? .34 : 1,
      timeScale: mode === 'badScale' ? 1.7 : 1, inspectSlowmo: false,
      slowmo: { allowed: true, active: mode === 'slow' } });
    g.updateSlowmo = () => {};
    g.updateShotDiagnostics = () => { throw new Error('stop-after-clock'); };
    assert.throws(() => g.update(.016), /stop-after-clock/);
    assert.ok(g.timeScale <= 1, `${flytime}/${mode}: ${g.timeScale}`);
    if (mode === 'normal') assert.equal(g.timeScale, 1);
    if (mode === 'slow') assert.ok(g.timeScale < 1);
  }
});

/* ---------------- контактная вспышка принятого удара (фаза 1) -------------- */

function rgbOf(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function paletteOf(id) { return rgbOf(lib.STROKES[lib.SERVE_STROKE_ALIAS[id] || id].col); }
function sameRgb(a, b) { return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6; }

test('a real mouse and touch contact flashes once in the colour of the accepted stroke', () => {
  for (const type of ['mouse', 'touch']) {
    const { g, send } = inputGame(type);
    send('pointerdown'); send('pointerup');
    assert.equal(g.stats.shots, 1, `${type}: the tap did not make contact`);
    assert.equal(g.contactFlashes.length, 1, `${type}: one pulse per accepted contact`);
    const f = g.contactFlashes[0];
    assert.equal(f.side, 1, `${type}: the pulse belongs to the striking side`);
    assert.ok(sameRgb([f.r, f.g, f.b], paletteOf(f.id)), `${type}/${f.id}: ${JSON.stringify([f.r, f.g, f.b])}`);
    assert.ok(f.life >= 0.1 && f.life <= 0.15, `${type}: about 120 ms of match time, got ${f.life}`);
    /* шлейф и его длина — отдельная настройка; вспышка от них не зависит */
    const noTrail = inputGame(type); noTrail.g.settings.showTrail = false;
    noTrail.g._calValues = { trailLen: 0 };
    noTrail.send('pointerdown'); noTrail.send('pointerup');
    assert.equal(noTrail.g.contactFlashes.length, 1, `${type}: turning the ribbon off cannot kill the contact flash`);
  }
});

test('a served ball flashes the stroke the serve executes', () => {
  const { g, send } = inputGame();
  g.state = lib.GS.SERVE_TOSS; g.isServeBall = true; g.ball.lastHitBy = 0;
  g.tossStartY = lib.PH.TABLE_Y + .14; g.tossApex = lib.PH.TABLE_Y + .40;
  lib.V3.set(g.ball.p, 0, lib.PH.TABLE_Y + .30, 1.6); lib.V3.set(g.ball.v, 0, -1, -.02);
  send('pointerdown'); send('pointerup');
  assert.equal(g.shotJournal.latest.strokeId, 'SERVE_NO_SPIN');
  assert.equal(g.contactFlashes.length, 1, 'the serve contact is an accepted contact');
  const f = g.contactFlashes[0];
  assert.equal(f.id, 'SERVE_NO_SPIN');
  assert.ok(sameRgb([f.r, f.g, f.b], paletteOf('SERVE_NO_SPIN')), 'flat serve uses the serve palette');
  assert.ok(!sameRgb([f.r, f.g, f.b], rgbOf(lib.STROKES.BLOCK.col)), 'flat serve is steel-blue, not the white of BLOCK');
});

test('volley, unreachable, paused and cancelled inputs never spawn a pulse', () => {
  const volley = inputGame(); volley.g.rallyBounces = [];
  volley.send('pointerdown'); volley.send('pointerup');
  assert.equal(volley.g.contactFlashes.length, 0, 'a volley is not a contact');
  const far = inputGame(); far.g.ball.p.z = 2.9;
  far.send('pointerdown'); far.send('pointerup');
  assert.equal(far.g.contactFlashes.length, 0, 'an unreachable ball is not a contact');
  const paused = inputGame(); paused.g.paused = true;
  paused.send('pointerdown'); paused.send('pointerup');
  assert.equal(paused.g.contactFlashes.length, 0, 'a paused world must not paint new contacts');
  const cancelled = inputGame();
  cancelled.send('pointerdown'); cancelled.send('pointercancel'); cancelled.send('pointerup');
  assert.equal(cancelled.g.contactFlashes.length, 0, 'a cancelled click is not a contact');
});

test('player paddle runs the idempotent table-clearance guard once per update', () => {
  const vm = require('node:vm');
  const { g } = inputGame('mouse');
  g._calValues = { captureK: 1 };
  vm.runInContext(`globalThis.__auditOriginalGuard = enforcePaddleTableClearance;
    globalThis.__auditGuardCalls = 0;
    enforcePaddleTableClearance = function (...args) { globalThis.__auditGuardCalls++; return globalThis.__auditOriginalGuard(...args); };`, lib.context);
  try {
    g.updatePlayerPaddle(1 / 60);
    assert.equal(lib.context.__auditGuardCalls, 1);
  } finally {
    vm.runInContext('enforcePaddleTableClearance = globalThis.__auditOriginalGuard; delete globalThis.__auditOriginalGuard; delete globalThis.__auditGuardCalls;', lib.context);
  }
});

test('stationary intercept assist target does not accumulate per frame at 30, 60 or 120 Hz', () => {
  const results = [];
  for (const fps of [30, 60, 120]) {
    const { g } = inputGame('mouse');
    g._calValues = { captureK: 1 };
    g.pointer = { x: .35, y: .55 };
    g.pressAdmitsBall = () => true;
    g.playerStrokeIntent = () => ({ dx: 0, dy: -.1, up: .5, right: 0, releaseSpeed: 1, peakSpeed: 1 });
    g.swipe.pressZone = { accepted: true, shotId: g.shotId };
    // The ball and pointer are deliberately stationary; this is not a full rally.
    for (let i = 0; i < fps / 5; i++) { g.time += 1 / fps; g.updatePlayerPaddle(1 / fps); }
    assert.equal(g._lockDbg.active, true);
    assert.equal(g._lockDbg.intent, true);
    results.push({ pos: { ...g.player.pos }, target: { ...g._padTarget } });
  }
  for (const result of results.slice(1)) {
    assert.ok(lib.V3.dist(result.pos, results[0].pos) < .0001);
    assert.ok(lib.V3.dist({ x: result.target.tx, y: result.target.ty, z: result.target.tz },
      { x: results[0].target.tx, y: results[0].target.ty, z: results[0].target.tz }) < .0001);
  }
});

test('frozen training invalidates the strike corridor when the paddle depth or ball changes', () => {
  const { g } = inputGame('mouse');
  g.training = { frozen: true };
  g.player.pos.z = 1.2;
  const first = g.strikeCorridor();
  assert.strictEqual(g.strikeCorridor(), first, 'unchanged inputs should reuse the cache');
  g.player.pos.z = 2.1; // the game clock and frame remain frozen while the player aims
  const moved = g.strikeCorridor();
  const direct = lib.solveStrikeCorridor(g.ball, g.player, g.rallyBounces, lib.predict, {
    tableY: lib.PH.TABLE_Y, stanceZ: lib.PADDLE_STANCE_Z, minStepInZ: lib.PADDLE_LIMITS.zStepIn,
    maxReachZ: lib.PADDLE_LIMITS.zFar, allowVolley: true,
  });
  assert.notStrictEqual(moved, first);
  assert.deepEqual(JSON.parse(JSON.stringify(moved)), JSON.parse(JSON.stringify(direct)));
  g.ball.p.x += .04;
  const repositioned = g.strikeCorridor();
  assert.notStrictEqual(repositioned, moved, 'a repositioned training ball must invalidate the cache');
  g.training.frozen = false;
  assert.notStrictEqual(g.strikeCorridor(), repositioned, 'leaving frozen mode changes volley eligibility');
});

test('frozen contact prediction follows a changed footwork plane without advancing game time', () => {
  const { g } = inputGame('mouse');
  g.training = { frozen: true };
  g._footZ = 1.6;
  const first = g.contactPrediction();
  assert.ok(first);
  assert.strictEqual(g.contactPrediction(), first);
  g._footZ = 1.9;
  const next = g.contactPrediction();
  assert.ok(next);
  assert.notStrictEqual(next, first);
  assert.ok(Math.abs(next.p.z - first.p.z) > .1, `${first.p.z} -> ${next.p.z}`);
});
