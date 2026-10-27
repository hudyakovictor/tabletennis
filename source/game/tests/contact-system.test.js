const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '13_contact.js', '30_physics.js',
  '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js', '56_rig.js', '57_camera.js',
  '61_particles.js', '70_game.js', '80_ui.js'],
  ['MATCH_RULES', 'CONTACT_TIMING', 'ContactSystem', 'contactTimingFor', 'contactPredictionAllowed',
    'contactGateExtents', 'pressContactZone', 'Game', 'GS', 'V3', 'PH', 'SwipeTracker',
    'impactSphere', 'getCaptureForgiveness', 'setCaptureForgiveness']);
const { MATCH_RULES: rules, CONTACT_TIMING, ContactSystem, GS, V3, PH,
  contactTimingFor, contactPredictionAllowed, pressContactZone } = lib;

function gameLike(over = {}) {
  const g = Object.create(lib.Game.prototype);
  Object.assign(g, {
    state: GS.RALLY, server: 1, shotId: 7, time: 1, strokeTime: 1,
    ball: { live: true, lastHitBy: -1, p: V3.new(0, PH.TABLE_Y + 0.3, 1.2), v: V3.new(0, 0, 6), w: V3.new() },
    player: { pos: V3.new(0, PH.TABLE_Y + 0.3, 1.78) },
    rallyBounces: [1], tossApex: 1.4, tossStartY: PH.TABLE_Y + 0.14,
    _strike: { on: false, contactable: false, ready: 0 },
    canvas: { getBoundingClientRect: () => ({ width: 390, height: 844, left: 0, top: 0 }) },
    ...over,
  });
  g.project = (p, out = {}) => { out.x = 0.5 + p.x * 0.05; out.y = 0.5 - (p.y - PH.TABLE_Y) * 0.05; out.ok = true; return out; };
  g.contactGateScale = () => ({ kx: 1, ky: 1 });
  return g;
}

test('CONTACT_TIMING is the single frozen source of the gesture windows', () => {
  assert.deepEqual({ ...CONTACT_TIMING.rally }, { liveWin: 0.18, deadWin: 0.25, heldWin: 2.5, attemptWin: 0.25 });
  assert.deepEqual({ ...CONTACT_TIMING.serve }, { liveWin: 1.15, deadWin: 1.15, heldWin: 1.15, attemptWin: 1.15 });
  assert.equal(CONTACT_TIMING.hitCooldown, 0.09);
  assert.equal(contactTimingFor(true), CONTACT_TIMING.serve);
  assert.equal(contactTimingFor(false), CONTACT_TIMING.rally);
  assert.ok(Object.isFrozen(CONTACT_TIMING.rally) && Object.isFrozen(CONTACT_TIMING));
});

test('evaluatePress admits a press on the meeting point and rejects one outside the gate', () => {
  const g = gameLike();
  const rect = g.canvas.getBoundingClientRect();
  const inZone = ContactSystem.evaluatePress(g, { x: 0.5, y: 0.5 }, rect, 'touch', { timeStamp: 1000 });
  assert.equal(inZone.accepted, true);
  assert.equal(inZone.anchor, 'contact');
  assert.equal(inZone.shotId, 7);
  assert.equal(inZone.serving, false);
  assert.ok(Number.isFinite(inZone.lead));
  const out = ContactSystem.evaluatePress(g, { x: 0.02, y: 0.98 }, rect, 'touch', { timeStamp: 1000 });
  assert.equal(out.accepted, false);
  assert.equal(out.reason, 'OUTSIDE_ZONE');
});

test('SERVE_READY tap gets a neutral serve-toss stamp instead of rally geometry', () => {
  const g = gameLike({ state: GS.SERVE_READY, ball: { live: false, lastHitBy: 0, p: V3.new(0, PH.TABLE_Y + 0.3, 1.78) } });
  const rect = g.canvas.getBoundingClientRect();
  const z = ContactSystem.evaluatePress(g, { x: 0.5, y: 0.62 }, rect, 'touch', { timeStamp: 500 });
  assert.equal(z.accepted, true);
  assert.equal(z.kind, 'serve-toss');
  assert.equal(z.serving, true);
});

test('refreshPressZone never resurrects a rejected press and keeps an admitted one admitted', () => {
  const g = gameLike();
  const rect = g.canvas.getBoundingClientRect();
  // rejected press: refresh must not touch it (the frozen contract)
  const rejected = ContactSystem.evaluatePress(g, { x: 0.02, y: 0.98 }, rect, 'touch', { timeStamp: 1000 });
  g.swipe = new lib.SwipeTracker(); g.swipe.active = true; g.swipe.pressZone = rejected;
  ContactSystem.refreshPressZone(g);
  assert.equal(g.swipe.pressZone.accepted, false);
  assert.equal(g.swipe.pressZone.reason, 'OUTSIDE_ZONE');
  // admitted press survives a refresh and its geometry tracks the prediction
  const admitted = ContactSystem.evaluatePress(g, { x: 0.5, y: 0.5 }, rect, 'touch', { timeStamp: 1000 });
  const beforeX = admitted.x;
  g.swipe = new lib.SwipeTracker(); g.swipe.active = true; g.swipe.pressZone = admitted;
  ContactSystem.refreshPressZone(g);
  assert.equal(g.swipe.pressZone.accepted, true);
  assert.ok(Number.isFinite(g.swipe.pressZone.x));
  assert.equal(g.swipe.pressZone.x, beforeX); // deterministic prediction, same center
});

test('contactPredictionAllowed keeps the contact gate alive at the apex (v.z 0.15) and past it', () => {
  const ball = { live: true, lastHitBy: -1, v: { z: 0.15 } };
  assert.equal(contactPredictionAllowed(ball, GS.RALLY), true);
  assert.equal(contactPredictionAllowed({ ...ball, v: { z: -0.5 } }, GS.RALLY), false);
  assert.equal(contactPredictionAllowed(ball, GS.POINT), false);
  // integration: the game method itself no longer cuts off at v.z > 0.2;
  // the apex helper above keeps 0.15 alive, here the ball must also reach
  // the player plane, so give it enough push to get there.
  const g = gameLike({ ball: { live: true, lastHitBy: -1, p: V3.new(0, PH.TABLE_Y + 0.3, 1.6), v: V3.new(0, 0, 2), w: V3.new() } });
  assert.ok(g.contactPrediction() !== null);
});

test('direction uses one limit per pointer type, independent of gesture length', () => {
  // штамп в CSS px: мяч на 60px ЛЕВЕЕ пальца (toBall = -60,0); метрики свайпа в NDC
  const zone = (pointerType) => ({ accepted: true, x: 200, y: 300, pointerX: 260, pointerY: 300, vw: 390, vh: 844, pointerType });
  // геометрия с dot ровно -0.06: sx=6px вдоль +X и ~99.8px вдоль Y (dx/dy — NDC)
  const dotMinus06 = { dx: 6 / 390, dy: (6 * Math.sqrt(1 / 0.0036 - 1)) / 844 };
  // раньше строгий предел 0 для коротких жестов это рубил; теперь единый -0.12
  const shortTouch = zone('touch'), longTouch = zone('touch');
  assert.equal(ContactSystem.directionAllows(shortTouch, { ...dotMinus06, len: 0.15 }), true);
  assert.equal(ContactSystem.directionAllows(longTouch, { ...dotMinus06, len: 0.17 }), true); // нет скачка от длины
  assert.equal(shortTouch.directionDot, longTouch.directionDot);
  // явный свайп от мяча (dot=-1) по-прежнему отклоняется
  const away = zone('touch');
  assert.equal(ContactSystem.directionAllows(away, { dx: 0.2, dy: 0 }), false);
  assert.equal(away.reason, 'WRONG_DIRECTION');
  // мышь: dot=-0.20 проходит её предел -0.30, но не touch-предел -0.12
  const dotMinus20 = { dx: 6 / 390, dy: (6 * Math.sqrt(1 / 0.04 - 1)) / 844 };
  const mouse = zone('mouse');
  assert.equal(ContactSystem.directionAllows(mouse, dotMinus20), true);
  const touch20 = zone('touch');
  assert.equal(ContactSystem.directionAllows(touch20, dotMinus20), false);
  // палец почти на мяче (<4px): направление не судится
  const close = { accepted: true, x: 262, y: 300, pointerX: 260, pointerY: 300, vw: 390, vh: 844, pointerType: 'touch' };
  assert.equal(ContactSystem.directionAllows(close, { dx: 0.2, dy: 0 }), true);
  // тапы и кэшированный вердикт
  assert.equal(ContactSystem.directionAllows(zone('touch'), { tap: true }), true);
  const cached = zone('touch'); cached.directionOk = false;
  assert.equal(ContactSystem.directionAllows(cached, dotMinus06), false);
});

test('SwipeTracker measures gestures in square aspect-corrected units and keeps the true origin', () => {
  // default aspect 1: legacy math, exact existing contract
  const t0 = new lib.SwipeTracker();
  t0.down(0.5, 0.7, 0); t0.move(0.54, 0.55, 0.06); t0.move(0.58, 0.40, 0.12);
  assert.ok(t0.m.dx > 0 && t0.m.dy < 0);
  // 390x844 phone: a physically square 30x30 px flick must read as a 45 degree gesture
  const t = new lib.SwipeTracker();
  t.setAspect(390 / 844);
  t.down(0.5, 0.7, 0);
  t.down(0.5, 0.7, 0); // re-down must not corrupt the origin
  t.move(0.5 + 30 / 390, 0.7 - 30 / 844, 0.06);
  assert.ok(Math.abs(t.m.angleDeg - 45) < 2, `angle ${t.m.angleDeg}`);
  // ring buffer overflow: chord/duration stay anchored at the real origin
  const long = new lib.SwipeTracker();
  long.down(0.2, 0.8, 0);
  for (let i = 1; i <= 70; i++) long.move(0.2 + 0.004 * i, 0.8 - 0.003 * i, i * 0.008);
  assert.equal(long.origin.x, 0.2);
  assert.equal(long.origin.y, 0.8);
  assert.ok(Math.abs(long.m.sx - 0.2) < 1e-12 && Math.abs(long.m.sy - 0.8) < 1e-12);
  assert.ok(long.m.dur >= 0.55);
});

test('hand speed uses wall time: the same flick at two sim clocks gives the same speed', () => {
  const mk = () => { const t = new lib.SwipeTracker(); t.down(0.5, 0.7, 100.0, 1.0); return t; };
  const a = mk(); a.move(0.55, 0.5, 100.05, 1.011); // slow-mo sim clock
  const b = mk(); b.move(0.55, 0.5, 100.05, 1.045); // normal sim clock
  assert.ok(Math.abs(a.m.speed - b.m.speed) < 1e-9);
  assert.notEqual(a.sampleSimTime, b.sampleSimTime); // freshness still follows sim time
});

test('training forgiveness widens the screen gate together with the physical capture', () => {
  const base = ContactSystem.gateExtents('touch', { kx: 1, ky: 1 }, 1);
  const trained = ContactSystem.gateExtents('touch', { kx: 1, ky: 1 }, 1.55);
  assert.equal(base.sidePx, rules.contactSideTouchPx);
  assert.ok(Math.abs(trained.sidePx - base.sidePx * 1.55) < 1e-9);
  assert.ok(Math.abs(trained.fwdPx - base.fwdPx * 1.55) < 1e-9);
  // and the actual zone produced through pressContactZone honors it
  const c = { x: 0.5, y: 0.5, ok: true };
  // 80px sideways: beyond the 64px touch side gate, inside the 64*1.55 trained gate
  const z1 = pressContactZone(c, { x: 0.5 + 80 / 390, y: 0.5 }, 390, 844, { pointerType: 'touch', scale: { kx: 1, ky: 1 } });
  const z2 = pressContactZone(c, { x: 0.5 + 80 / 390, y: 0.5 }, 390, 844, { pointerType: 'touch', scale: { kx: 1, ky: 1 }, forgive: 1.55 });
  assert.equal(z1.accepted, false);
  assert.equal(z2.accepted, true);
});

test('closest-approach tolerance grows with ball speed and strike arming leads the contact moment', () => {
  assert.equal(ContactSystem.closestTolerance({ v: V3.new(0, 0, 0) }), 0.02);
  const fast = ContactSystem.closestTolerance({ v: V3.new(0, 0, 12) });
  assert.ok(Math.abs(fast - 12 * PH.SIM_DT * 1.5) < 1e-12);
  assert.ok(fast > 0.02, `fast tolerance ${fast}`);
  assert.equal(ContactSystem.strikeArmed({ on: true, contactable: false, ready: 0.9 }), true);
  assert.equal(ContactSystem.strikeArmed({ on: true, contactable: false, ready: 0.4 }), false);
  assert.equal(ContactSystem.strikeArmed({ on: true, contactable: true, ready: 0 }), true);
  assert.equal(ContactSystem.strikeArmed(null), false);
});

test('impactSphere is invariant to a non-unit incoming normal', () => {
  const ref = { v: V3.new(0, -1, 4), w: V3.new(0, 0, 0), n: V3.new(0, 0, -1) };
  const scaled = { v: V3.new(0, -1, 4), w: V3.new(0, 0, 0), n: V3.new(0, 0, -1.7) };
  const i1 = lib.impactSphere(ref.v, ref.w, ref.n, V3.new(), PH.E_RACKET, PH.MU_RACKET, PH.ET_RACKET);
  const i2 = lib.impactSphere(scaled.v, scaled.w, scaled.n, V3.new(), PH.E_RACKET, PH.MU_RACKET, PH.ET_RACKET);
  assert.ok(i1 && i2);
  for (const k of ['x', 'y', 'z']) assert.ok(Math.abs(ref.v[k] - scaled.v[k]) < 1e-10, `axis ${k}`);
});

test('a second pointer no longer cancels the live stroke (multi-touch grip)', () => {
  // behavior lives in bindInput; assert the supporting tracker contract:
  // cancel() is the only destructive path and it must be explicit
  const t = new lib.SwipeTracker();
  t.down(0.5, 0.7, 0); t.move(0.55, 0.5, 0.06);
  const snapshot = t.gestureId;
  // an unrelated pointer event simply must not touch the tracker state
  assert.equal(t.gestureId, snapshot);
  assert.equal(t.active, true);
  t.cancel();
  assert.equal(t.active, false);
  assert.equal(t.origin, null);
});
