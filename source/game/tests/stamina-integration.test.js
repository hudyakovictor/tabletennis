'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const noop = () => {};
const windowHandlers = new Map();
const classes = { add: noop, remove: noop, toggle: noop, contains: () => false };
const document = { hidden: false, addEventListener: noop, body: { style: {}, classList: classes },
  documentElement: { style: {} }, getElementById: () => ({ classList: classes }) };
const math = Object.create(Math); math.random = () => .5;
const lib = load(['10_math.js', '30_physics.js', '40_swipe.js', '55_ai.js', '56_rig.js', '57_camera.js', '70_game.js'],
  ['Game', 'GS', 'Stamina', 'STAMINA_CONFIG', 'SwipeTracker', 'ShotJournal', 'OpponentAI', 'PaddleStrokeMotion',
    'V3', 'Q', 'PH', 'PHYS_DT', 'TAU', 'STROKES', 'ARCH', 'CONTACT_CORRIDOR_RULES', 'rigViewProj',
    'describeStrokeEffort', 'describeProfileEffort', 'racketForStroke', 'refineRacket', 'racketEffortCap', 'isRealStroke'],
  { document, window: { addEventListener: (type, fn) => windowHandlers.set(type, fn) }, Math: math });
const { Game, GS, Stamina, V3, Q, PH, STROKES } = lib;
const json = value => JSON.parse(JSON.stringify(value));
const close = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-8, `${message || 'equal'}: ${a} != ${b}`);

function fixture() {
  const g = Object.create(Game.prototype), handlers = new Map(), events = [];
  const width = 390, height = 844;
  const paddle = z => ({ pos: V3.new(.7, 1.04, z), prev: V3.new(.7, 1.04, z), prevPos: V3.new(.7, 1.04, z),
    normal: V3.new(0, 0, z > 0 ? -1 : 1), vel: V3.new(), q: Q.new(), roll: 0, lastHitT: -9, forehand: true });
  Object.assign(g, {
    canvas: { style: {}, clientWidth: width, clientHeight: height, setPointerCapture: noop,
      addEventListener: (type, fn) => handlers.set(type, fn),
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height }) },
    time: 1, strokeTime: 1, timeScale: 1, targetTimeScale: 1, frame: 0, stateT: 0, stateSimT: 0,
    state: GS.MENU, paused: false, server: 1, recenterT: 0, shotId: 1, rally: 0, bestRally: 0,
    sessionKind: 'practice', freePlay: false, training: null, score: [0, 0], games: [0, 0], servesLeft: 2,
    settings: { hand: 'right', grip: 'shakehand', followThrough: false, anticipationHint: false,
      difficulty: 0, targetScore: 11, adaptive: false, camera: 'BROADCAST', showPredict: false, showTrail: false },
    swipe: new lib.SwipeTracker(), swipeReleasedAt: -Infinity, paddleMotion: new lib.PaddleStrokeMotion(),
    player: paddle(1.78), aiPaddle: paddle(-1.6),
    ball: { p: V3.new(), v: V3.new(), w: V3.new(), q: Q.new(), live: false, lastHitBy: 0, hist: [] },
    rallyBounces: [], serveBounces: 0, isServeBall: false, netTouched: false,
    replayer: { on: false, stop() { this.on = false; }, update: noop }, career: { active: false, stop: noop, save: noop },
    network: { isInMatch: false, isHost: true, disconnect: noop },
    followThrough: { active: false, t: 0, duration: .15, swingDir: V3.new() },
    anticipation: { active: false, targetDir: V3.new(), visualOffset: V3.new() },
    spinIndicator: { active: false }, marks: [], messages: [], contactFlashes: [], _contactFlashSeen: new Set(),
    audio: new Proxy({}, { get: () => noop }),
    equip: { forSide: () => ({ e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1, sweet: 1 }), vmagK: 1, sweetK: 1 },
    ai: new lib.OpponentAI(0), aiTrend: 0, analyst: { reset: noop, analyse: () => null },
    director: { reset: noop, onPoint: () => 1, streak: 0 },
    shotJournal: new lib.ShotJournal(), recorder: { begin: noop, addShot: noop, addBounce: noop },
    moments: { reset: noop, beginRally: noop, addContact: noop, endRally: () => null, push: noop, kept: [] },
    particles: { update: noop }, profile: { data: { stats: { minutes: 0 } }, maybeSave: noop, save: noop, touch: noop },
    slowmo: { energy: 1, on: false, active: false, allowed: true, used: 0 },
    hitFlash: 0, _acc: 0, _fpsN: 0, _fpsT: 0,
    msg: noop, buzz: noop, shakeIt: noop, logInput: noop, logSwipeRelease: noop, watchdogStroke: noop,
    watchdogArmFrame: noop, watchdogFrame: noop, updateCamera: noop, updateCameraReplay: noop,
    keepPaddleOnScreen: noop, clampPaddleVolume: noop, updatePlayerPaddle: noop,
    updateOpponentPose: noop, updateStrikeWindow: noop, recordBallTrail: noop,
    onMatchHud: snapshot => events.push(json(snapshot)),
  });
  g.aiEquip = g.equip;
  g.ai.think = noop;
  g._liveRig = { eye: V3.new(0, 1.68, 2.38), look: V3.new(0, .74, -.25), fov: 44, shiftY: 0 };
  g.R = { viewProj: lib.rigViewProj(g._liveRig, width / height), aspect: () => width / height,
    post: { radial: 0, ca: 0, flash: 0, sat: 1 } };
  assert.equal(g.startMatch(0), true);
  g.server = 1; g.setState(GS.RALLY); g.ball.live = true; g.ball.lastHitBy = -1; g.isServeBall = false;
  V3.set(g.player.pos, .7, 1.04, 1.78); V3.copy(g.player.prev, g.player.pos); V3.copy(g.player.prevPos, g.player.pos);
  V3.set(g.ball.p, 0, 1.05, 1.5); V3.set(g.ball.v, 0, -.1, 6); g.rallyBounces = [1];
  g.bindInput();
  const event = (type, p, timestamp, extra = {}) => ({ type, pointerId: 1, pointerType: 'touch', button: 0,
    buttons: type === 'pointerup' ? 0 : 1, clientX: p.x * width, clientY: p.y * height,
    timeStamp: timestamp, cancelable: true, preventDefault: noop, ...extra });
  const send = (type, p = g.project(g.ball.p, {}), timestamp = g.time * 1000, extra = {}) =>
    handlers.get(type)(event(type, p, timestamp, extra));
  const tick = (duration, dt = 1 / 60) => {
    let physical = 0;
    g.stepPhysics = step => { physical += step; };
    for (let t = 0; t < duration - 1e-10; t += dt) g.update(Math.min(dt, duration - t));
    return physical;
  };
  events.length = 0;
  return { g, send, event, events, tick, width, height };
}

function swing(f, { miss = false, release = true, timestamp = 1000 } = {}) {
  const p = f.g.project(f.g.ball.p, {}), start = { x: p.x, y: p.y + .09 };
  f.send('pointerdown', start, timestamp);
  if (miss) f.g.swipe.pressZone.accepted = false;
  f.send('pointermove', p, timestamp + 40);
  if (release) f.send('pointerup', { x: p.x, y: p.y - .03 }, timestamp + 60);
  return p;
}

test('full hardware hit and miss paths cost identically, including movement after consumed contact', () => {
  const hit = fixture(), miss = fixture();
  swing(hit); swing(miss, { miss: true });
  assert.equal(hit.g.stats.shots, 1, 'the real input/physics path confirmed contact');
  assert.equal(miss.g.stats.shots, 0);
  assert.ok(hit.g.stamina[0].energy < 100);
  assert.deepEqual(json(hit.g.stamina), json(miss.g.stamina));
  assert.equal(hit.g.swipe.active, false);
  assert.equal(hit.g._playerWork.held, false);
  assert.equal(hit.events.filter(e => e.event?.type === 'hit').length, 1);
  assert.equal(miss.g.getMatchSnapshot().contacts[0], null);
});

test('an actual outside press is charged before admission; coalesced hardware is charged once', () => {
  const f = fixture(), start = { x: .98, y: .9 }, end = { x: .98, y: .65 };
  f.send('pointerdown', start, 1000);
  assert.equal(f.g.swipe.pressZone.accepted, false);
  const fresh = json(f.g.stamina);
  assert.deepEqual(json(f.g.stamina), fresh, 'pointerdown is free');
  f.send('pointermove', end, 1060, { getCoalescedEvents: () => [
    f.event('pointermove', { x: .98, y: .81 }, 1020), f.event('pointermove', { x: .98, y: .72 }, 1040),
    f.event('pointermove', end, 1060),
  ] });
  const paid = f.g._playerWork.paid, state = json(f.g.stamina);
  assert.ok(paid > 0); assert.equal(f.g.stats.shots, 0);
  f.send('pointermove', end, 1060);
  for (let i = 0; i < 50; i++) f.g.tryPlayerHit(V3.clone(f.g.ball.p));
  f.send('pointerup', end, 1080);
  assert.deepEqual(json(f.g.stamina), state, 'duplicates, substeps and release are not a second fee');
  assert.equal(f.g._playerWork.paid, paid);
});

test('held repeated swings accumulate work after a hit, but jitter, stationary hold and follow-through do not', () => {
  const f = fixture(), p = swing(f, { release: false }), first = f.g.stamina[0].energy;
  assert.equal(f.g.stats.shots, 1); assert.equal(f.g.swipe.active, false); assert.equal(f.g._playerWork.held, true);
  f.send('pointermove', { x: p.x, y: p.y + .09 }, 1080);
  const second = f.g.stamina[0].energy;
  assert.ok(second < first, 'a second actual held swing must not be free');
  f.send('pointermove', p, 1120);
  assert.ok(f.g.stamina[0].energy < second);
  const before = json(f.g.stamina);
  for (let i = 0; i < 100; i++) f.send('pointermove', { x: p.x + (i % 2 ? .0002 : 0), y: p.y }, 1121 + i);
  f.g.followThrough.active = true;
  f.send('pointerup', p, 1250);
  assert.deepEqual(json(f.g.stamina), before);
  assert.equal(f.g.stats.shots, 1);
});

test('hover, toss tap and camera gestures are free; a released contact tap has only the small fee', () => {
  const hover = fixture();
  hover.send('pointermove', { x: .2, y: .3 });
  assert.equal(hover.g.stamina[0].energy, 100);
  const toss = fixture(); toss.g.prepServe(); toss.g.server = 1;
  toss.send('pointerdown'); toss.send('pointerup', undefined, 1050);
  assert.equal(toss.g.state, GS.SERVE_TOSS);
  assert.equal(toss.g.stamina[0].energy, 100);
  const camera = fixture();
  camera.send('pointerdown', { x: .5, y: .7 }, 1000, { button: 2 });
  camera.send('pointerup', { x: .5, y: .4 }, 1040, { button: 2 });
  assert.equal(camera.g.stamina[0].energy, 100);
  const pinch = fixture();
  pinch.send('pointerdown'); pinch.send('pointerdown', undefined, 1010, { pointerId: 2 });
  pinch.send('pointerup', undefined, 1040, { pointerId: 2 }); pinch.send('pointerup', undefined, 1050);
  assert.equal(pinch.g.stamina[0].energy, 100);
  const tap = fixture(); tap.send('pointerdown');
  assert.equal(tap.g.stamina[0].energy, 100);
  tap.send('pointerup', undefined, 1040);
  close(tap.g.stamina[0].energy, 100 - lib.STAMINA_CONFIG.tapCost);
  assert.equal(tap.g.stats.shots, 1);
  tap.send('pointerup', undefined, 1050);
  close(tap.g.stamina[0].energy, 100 - lib.STAMINA_CONFIG.tapCost);
});

test('one-motion serve swipe costs work; release waits for its full serve contact window before whiff', () => {
  const f = fixture(); f.g.prepServe(); f.g.server = 1;
  const p = f.g.project(f.g.ball.p, {});
  f.send('pointerdown', p, 1000);
  f.send('pointermove', { x: p.x, y: p.y - .16 }, 1050);
  f.send('pointerup', { x: p.x, y: p.y - .20 }, 1070);
  assert.ok(f.g.stamina[0].energy < 100);
  assert.equal(f.g.getMatchSnapshot().whiffs[0], null);
  const end = f.g._playerWork.expires;
  close(end - f.g.swipe.releaseSimTime, 1.15, 'the work ledger uses the real serve eligibility window');
  f.g.strokeTime = end - .001; f.g._expireSwingWork();
  assert.equal(f.g.getMatchSnapshot().whiffs[0], null);
  f.g.strokeTime = end; f.g._expireSwingWork();
  const whiff = f.g.getMatchSnapshot().whiffs[0];
  assert.ok(whiff); assert.equal(f.g.stats.shots, 0); assert.equal(f.g.rally, 0);
  f.g._expireSwingWork(); assert.equal(f.g.getMatchSnapshot().whiffs[0].id, whiff.id);
});

test('released rally attempts are not immediate whiffs and cancellation never refunds', () => {
  const f = fixture(); swing(f, { miss: true });
  const energy = f.g.stamina[0].energy;
  assert.equal(f.g.getMatchSnapshot().whiffs[0], null);
  f.g.strokeTime = f.g._playerWork.expires - .001; f.g._expireSwingWork();
  assert.equal(f.g.getMatchSnapshot().whiffs[0], null);
  f.g.cancelInput('camera');
  close(f.g.stamina[0].energy, energy);
  assert.ok(f.g.getMatchSnapshot().whiffs[0]);
  const id = f.g.getMatchSnapshot().whiffs[0].id;
  f.g.cancelInput('again'); assert.equal(f.g.getMatchSnapshot().whiffs[0].id, id);
});

test('a still-eligible released rally swipe can contact on its later legal bounce without a whiff', () => {
  const f = fixture(); f.g.rallyBounces = [];
  swing(f);
  assert.equal(f.g.stats.shots, 0);
  assert.equal(f.g.getMatchSnapshot().whiffs[0], null);
  const paid = f.g.stamina[0].energy;
  f.g.rallyBounces = [1]; f.g.strokeTime += .12;
  f.g._expireSwingWork(); f.g.tryInputHit(f.g.swipe.lastReleased);
  assert.equal(f.g.stats.shots, 1);
  assert.equal(f.g.getMatchSnapshot().whiffs[0], null);
  close(f.g.stamina[0].energy, paid, 'contact does not repay the released motion');
});

test('passive block has one common contact, true quality and legacy sweet, without repaying positioning', () => {
  const f = fixture(), g = f.g;
  g.swipe.down(.5, .7, 1, 1); g._beginPlayerWork(.5, .7, 1, 1);
  g.swipe.move(.5, .5, 1.06, 1.06); g._samplePlayerWork(.5, .5, 1.06, 1.06);
  g.swipe.realGestureId = g.swipe.gestureId;
  g.swipe.pressZone = { accepted: true, shotId: g.shotId };
  V3.set(g.player.pos, .05, PH.TABLE_Y + .25, PH.T_HALF_LEN + .45);
  V3.set(g.player.normal, 0, .15, -1); V3.zero(g.player.vel);
  V3.set(g.ball.p, g.player.pos.x + .03, g.player.pos.y - .02, g.player.pos.z - .12);
  V3.set(g.ball.v, .1, -.4, 4.8); V3.set(g.ball.w, -40, 0, 0);
  const before = json(g.stamina);
  assert.equal(g._tryPassiveBlock(g.player, g.ball), true);
  assert.deepEqual(json(g.stamina), before);
  const c = g.getMatchSnapshot().contacts[0];
  assert.equal(c.stroke, 'BLOCK'); assert.equal(c.quality, .30); assert.equal(c.sweet, .72);
  close(c.kmh, V3.len(g.ball.v) * 3.6); close(c.rps, V3.len(g.ball.w) / lib.TAU);
  assert.equal(g._tryPassiveBlock(g.player, g.ball), false);
  assert.equal(g.getMatchSnapshot().contacts[0].eventId, c.eventId);
});

test('scored practice marker and demo enable both sides; actual excluded modes suspend work and recovery', () => {
  const { g } = fixture();
  assert.equal(g.sessionKind, 'practice'); assert.equal(g.staminaEnabled(), true);
  g.startDemo(0); g.setState(GS.RALLY); g.ball.live = true;
  assert.equal(g.demoMode, true); assert.equal(g.staminaEnabled(), true);
  for (const side of [1, -1]) g._chargeStamina(side, 8);
  assert.deepEqual(json(g.stamina[0]), json(g.stamina[1]));
  for (const patch of [{ freePlay: true }, { training: {} }, { preview: { active: true } },
    { state: GS.MENU }, { network: { isInMatch: true } }, { lobbyScene: { active: true } }]) {
    const old = Object.fromEntries(Object.keys(patch).map(k => [k, g[k]])); Object.assign(g, patch);
    const before = json(g.stamina);
    g._chargeStamina(1, 20); g._chargeStamina(-1, 20); g._advanceStamina(10);
    assert.deepEqual(json(g.stamina), before);
    assert.equal(g.getEffortBudget(1, { requestedVmag: 10, freshVmagCap: 14 }), null);
    assert.equal(g.getMatchSnapshot().staminaEnabled, false);
    assert.equal(g.getMatchSnapshot().visible, !!patch.freePlay);
    Object.assign(g, old);
  }
});

test('recovery advances only eligible scaled physics steps, independently of update frame rate', () => {
  for (const scale of [1, .25]) for (const fps of [30, 60, 120]) {
    const f = fixture(), g = f.g;
    g.stamina = [Stamina.charge(Stamina.fresh(), 40), Stamina.charge(Stamina.fresh(), 20)];
    const before = json(g.stamina);
    g.timeScale = g.targetTimeScale = scale; g.inspectSlowmoRequested = g.inspectSlowmo = true; g.updateSlowmo = noop;
    const physical = f.tick(1.2, 1 / fps);
    close(physical + g._acc, 1.2 * scale, `scaled physics plus fractional remainder at ${fps} fps`);
    const expected = before.map(s => Stamina.advance(s, physical));
    for (let i = 0; i < 2; i++) {
      close(g.stamina[i].energy, expected[i].energy); close(g.stamina[i].regenDelayRemaining, expected[i].regenDelayRemaining);
    }
  }
});

test('ready, toss, point, pause, hidden, sleeping and replay never regenerate or debit', () => {
  for (const patch of [{ state: GS.SERVE_READY }, { state: GS.SERVE_TOSS }, { state: GS.POINT },
    { paused: true }, { _ttSleeping: true }, { replayer: { on: true, update: noop } }, { hidden: true }]) {
    const f = fixture(), g = f.g;
    g.stamina = [Stamina.charge(Stamina.fresh(), 30), Stamina.charge(Stamina.fresh(), 30)];
    const before = json(g.stamina); Object.assign(g, patch);
    if (patch.hidden) document.hidden = true;
    f.tick(.2);
    document.hidden = false;
    assert.deepEqual(json(g.stamina), before, JSON.stringify(patch));
  }
});

test('point recovery is armed once, consumed once at the next serve, and never granted for a let', () => {
  const { g } = fixture();
  g.stamina = [Stamina.charge(Stamina.fresh(), 40), Stamina.charge(Stamina.fresh(), 50)];
  const before = json(g.stamina);
  g.awardPoint(1, 'POINT'); g.awardPoint(1, 'DUPLICATE');
  assert.equal(g.score[0], 1); assert.deepEqual(json(g.stamina), before);
  g.prepServe();
  for (let i = 0; i < 2; i++) {
    close(g.stamina[i].energy, before[i].energy + 12); close(g.stamina[i].fatigue, before[i].fatigue);
    close(g.stamina[i].regenDelayRemaining, before[i].regenDelayRemaining);
  }
  const credited = json(g.stamina); g.prepServe(); assert.deepEqual(json(g.stamina), credited);
  g.setState(GS.RALLY); g.letServe(); g.prepServe(); assert.deepEqual(json(g.stamina), credited);
  assert.deepEqual(json(g.getMatchSnapshot().contacts), [null, null]);
  g.score = [7, 7]; assert.deepEqual(json(g.stamina), credited, 'score alone is not a fatigue trigger');
});

test('atomic match resume preserves both states, relative delays, credit, IDs and phase without fresh intermediate HUD', () => {
  const from = fixture(), to = fixture();
  swing(from, { miss: true }); from.g._chargeStamina(-1, 24); from.g._advanceStamina(.17);
  const saved = json(from.g.captureMatchResume());
  to.g.strokeTime = 400; to.g.time = 900; to.events.length = 0;
  assert.equal(to.g.startMatch(0, saved), true);
  assert.deepEqual(json(to.g.stamina), saved.stamina);
  assert.equal(to.g.state, saved.phase); assert.equal(to.g._matchId, saved.matchId);
  assert.equal(to.g._rallyId, saved.rallyId); assert.equal(to.g._serveId, saved.serveId);
  assert.equal(to.g._playerWork, null); assert.equal(to.g.swipe.active, false);
  assert.equal(to.events.length, 1); assert.ok(to.events[0].seq > saved.seq);
  assert.equal(to.events[0].players[0].energy, saved.stamina[0].energy);
  from.g.awardPoint(-1, 'POINT');
  const point = json(from.g.captureMatchResume());
  assert.equal(to.g.startMatch(0, point), true); to.g.prepServe();
  const credited = json(to.g.stamina), afterCredit = json(to.g.captureMatchResume());
  assert.equal(to.g.startMatch(0, afterCredit), true); to.g.prepServe();
  assert.deepEqual(json(to.g.stamina), credited, 'restoring credited data cannot grant a second +12');
});

test('invalid resume is side-effect free and terminal resume retains its winner; only new start resets fatigue', () => {
  const f = fixture(), g = f.g; g._chargeStamina(1, 35);
  const saved = json(g.captureMatchResume()), before = json(g.captureMatchResume());
  for (const mutate of [s => { s.stamina[0].energy = NaN; }, s => { s.target = 0; },
    s => { s.pendingCredit = s.creditedRally; }, s => { s.pendingCredit = s.rallyId; },
    s => { s.score = [2]; }, s => { s.winner = 1; }]) {
    const invalid = json(saved); mutate(invalid); const count = f.events.length;
    assert.equal(g.startMatch(3, invalid), false);
    assert.deepEqual(json(g.captureMatchResume()), before); assert.equal(f.events.length, count);
    assert.equal(g.settings.difficulty, 0);
  }
  g.score = [10, 4]; g.awardPoint(1, 'WIN'); g.setState(GS.MATCH_END);
  const terminal = json(g.captureMatchResume());
  assert.equal(g.startMatch(0, terminal), true);
  assert.equal(g.state, GS.MATCH_END); assert.equal(g.matchWinner, 1); assert.deepEqual([...g.score], [11, 4]);
  const finalStamina = json(g.stamina);
  assert.equal(g.prepServe(), false); assert.equal(g.state, GS.MATCH_END); assert.deepEqual(json(g.stamina), finalStamina);
  const oldId = g._matchId; assert.equal(g.startMatch(0), true);
  assert.notEqual(g._matchId, oldId); assert.deepEqual(json(g.stamina), [json(Stamina.fresh()), json(Stamina.fresh())]);
});

test('contact event IDs do not change during throttled energy publications; both fixed cells use actual vectors', () => {
  const f = fixture(), g = f.g; swing(f);
  const near = json(g.getMatchSnapshot().contacts[0]);
  V3.set(g.ball.v, .5, 1, 4); V3.set(g.ball.w, 30, -40, 0);
  g.applyHit(-1, { stroke: STROKES.PUSH, arch: lib.ARCH.PUSH, power: .2 }, V3.clone(g.ball.p), .83, null);
  const both = g.getMatchSnapshot();
  assert.equal(both.contacts.length, 2); assert.equal(both.contacts[0].eventId, near.eventId);
  assert.equal(both.contacts[1].side, -1); assert.equal(both.contacts[1].stroke, 'PUSH');
  close(both.contacts[1].kmh, Math.sqrt(17.25) * 3.6); close(both.contacts[1].rps, 50 / lib.TAU);
  assert.equal(g.lastShotInfo.side, 1, 'far-side publication does not overwrite the player journal');
  g.stamina[0] = { energy: 50, fatigue: 10, regenDelayRemaining: 0, low: false };
  f.events.length = 0; f.tick(1);
  assert.ok(f.events.length > 0 && f.events.length <= 10);
  for (const event of f.events) {
    assert.equal(event.contacts[0].eventId, near.eventId);
    assert.equal(event.contacts[1].eventId, both.contacts[1].eventId);
    assert.equal(event.event.id, both.event.id);
  }
  for (let i = 1; i < f.events.length; i++) assert.ok(f.events[i].seq > f.events[i - 1].seq);
  g.setPaused(true); assert.equal(f.events.at(-1).paused, true);
  g.setPaused(false); g.prepServe(); assert.deepEqual(json(g.getMatchSnapshot().contacts), [null, null]);
});

test('AI executed whiff debits once before reach, but ready planning and repeated searches do not debit', () => {
  const { g } = fixture();
  g.ball.lastHitBy = 1; g.rallyBounces = [-1]; V3.set(g.ball.p, 0, 1.12, -1.5); V3.set(g.ball.v, 0, -.3, -5);
  V3.set(g.ai.pos, 1, 1.12, -1.5);
  const plan = { archId: 'DRIVE', speed: 6, aim: { x: 0, z: .7 } };
  g.ai.plan = g.ai.commit = plan; g.ai.swingAt = g.strokeTime + .5;
  const before = json(g.stamina);
  for (let i = 0; i < 5; i++) { g.ai.describeEffort(g, plan); g.tryAiHit(); }
  assert.deepEqual(json(g.stamina), before);
  g.ai.swingAt = g.strokeTime; g.tryAiHit();
  assert.ok(g.stamina[1].energy < 100); assert.equal(g.stamina[0].energy, 100);
  assert.ok(g.getMatchSnapshot().whiffs[1]); assert.equal(g.stats.aiShots, 0);
  const paid = json(g.stamina);
  g.ai.plan = g.ai.commit = { ...plan };
  for (let i = 0; i < 10; i++) g.tryAiHit();
  assert.deepEqual(json(g.stamina), paid);
  const saved = json(g.captureMatchResume());
  assert.equal(g.startMatch(0, saved), true);
  g.ai.plan = g.ai.commit = { ...plan }; g.ai.swingAt = g.strokeTime;
  g.tryAiHit();
  assert.deepEqual(json(g.stamina), paid, 'GPU restore does not execute the already-missed incoming shot again');
});

test('near demo synthetic input uses the same work sampler without an AI surcharge', () => {
  const f = fixture(), g = f.g; g.demoMode = true;
  const point = g.project(g.ball.p, {});
  g.startDemoSwipe('rally', point);
  assert.equal(g.stamina[0].energy, 100);
  g.time += .05; g.strokeTime += .05; g.updateDemoPlayer(.05);
  g.time += .05; g.strokeTime += .05; g.updateDemoPlayer(.05);
  const work = g._playerWork;
  assert.ok(work.paid > 0); close(100 - g.stamina[0].energy, work.paid);
  assert.equal(g.stamina[1].energy, 100); assert.equal(work.held, false);
});

test('getters and request normalization are pure and budgets stay side-local', () => {
  const { g } = fixture();
  g.stamina[0] = { energy: 12, fatigue: 32, regenDelayRemaining: .2, low: true };
  const before = json(g.captureMatchResume());
  const request = Object.freeze({ strokeId: 'SMASH', effort: 1, requestedVmag: 14, freshVmagCap: 14 });
  for (let i = 0; i < 20; i++) {
    const near = g.getEffortBudget(1, request), far = g.getEffortBudget(-1, request);
    assert.ok(near.vmagCap < far.vmagCap); assert.equal(near.side, 1); assert.equal(far.side, -1);
    assert.equal(g.getStaminaState(1).energy, 12); assert.equal(g.getStaminaState(-1).energy, 100);
  }
  assert.deepEqual(json(g.captureMatchResume()), before);
});

test('real low-energy player contact preserves quality and obeys the final pre-impact effort cap', () => {
  const samples = [];
  for (const low of [false, true]) {
    const f = fixture(), g = f.g;
    if (low) g.stamina[0] = { energy: 5, fatigue: 40, regenDelayRemaining: 0, low: true };
    const apply = g.applyHit;
    g.applyHit = function(side, racket, ...rest) { samples.push({ racket, quality: rest[1] }); return apply.call(this, side, racket, ...rest); };
    swing(f);
    assert.equal(g.stats.shots, 1);
    const racket = samples.at(-1).racket, absorb = 1 - (racket.arch?.absorb || 0);
    assert.ok(V3.len(racket.vR) <= lib.racketEffortCap(racket) * absorb + 1e-8);
    assert.equal(g.getMatchSnapshot().contacts[0].limited, low);
  }
  close(samples[0].quality, samples[1].quality);
  assert.equal(samples[0].racket.stroke.id, samples[1].racket.stroke.id);
  assert.ok(samples[1].racket.vmag < samples[0].racket.vmag);
});

test('passive and glance routes consume the capped replacement frame without charging the contact', () => {
  const { g } = fixture();
  g.stamina[0] = { energy: 0, fatigue: 45, regenDelayRemaining: .2, low: true };
  const m = new lib.SwipeTracker(); m.down(.5, .7, 1, 1); m.move(.5, .4, 1.05, 1.05);
  const glance = g._glanceRacket(m.m, V3.clone(g.ball.p), false, g.equip.forSide(1));
  assert.ok(glance.effortBudget.limited);
  assert.ok(V3.len(glance.vR) <= lib.racketEffortCap(glance) + 1e-8);
  g.swipe.down(.5, .7, 1, 1); g.swipe.realGestureId = g.swipe.gestureId;
  g.swipe.pressZone = { accepted: true, shotId: g.shotId };
  V3.set(g.player.pos, 0, 1.1, 1.7); V3.set(g.player.normal, 0, .15, -1); V3.set(g.player.vel, 0, 0, -60);
  V3.set(g.ball.p, 0, 1.1, 1.6); V3.set(g.ball.v, 0, -.4, 4.8);
  let captured;
  g.shotJournal.capture = (id, time, racket) => { captured = racket; };
  const before = json(g.stamina);
  assert.equal(g._tryPassiveBlock(g.player, g.ball), true);
  assert.ok(V3.len(captured.vR) <= lib.racketEffortCap(captured) * (1 - captured.arch.absorb) + 1e-8);
  assert.deepEqual(json(g.stamina), before);
});

test('AI serve proposals are free, failed proposals stay free, validated physical execution pays once', () => {
  for (const invalid of [true, false]) {
    const f = fixture(), g = f.g;
    g.server = -1; g.setState(GS.SERVE_TOSS); g.stateSimT = .4;
    g.ball.lastHitBy = 0; g.isServeBall = true; g.aiSwingAt = g.strokeTime;
    V3.set(g.ball.p, 0, PH.TABLE_Y + .36, -1.55); V3.set(g.ball.v, 0, -.6, 0); V3.zero(g.ball.w);
    V3.copy(g.ai.pos, g.ball.p);
    if (invalid) g.ai.serve = () => null;
    const before = json(g.stamina), swingId = g._swingId;
    const proposal = g.ai.serve(g);
    assert.deepEqual(json(g.stamina), before);
    if (!invalid) assert.equal(proposal.valid, true, proposal.invalidReason);
    f.tick(.01);
    if (invalid) {
      assert.deepEqual(json(g.stamina), before); assert.equal(g._swingId, swingId); assert.equal(g.stats.aiShots, 0);
    } else {
      assert.ok(g.stamina[1].energy < 100); assert.equal(g.stamina[0].energy, 100);
      assert.equal(g.stats.aiShots, 1); assert.equal(g.getMatchSnapshot().contacts[1].side, -1);
      const paid = g._aiWork.paid;
      close(g.stamina[1].energy, 100 - paid);
      f.tick(.01); close(g.stamina[1].energy, 100 - paid); assert.equal(g.stats.aiShots, 1);
    }
  }
});
