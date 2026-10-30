const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '42_shot_diagnostics.js', '56_rig.js', '57_camera.js', '70_game.js'],
  ['Game', 'SwipeTracker', 'isRealStroke', 'tapStrokeMetrics', 'ShotJournal', 'V3', 'PH', 'GS',
    'rigViewProj', 'integrateBall', 'predict'],
  { window: { addEventListener() {} }, document: { addEventListener() {},
    body: { style: {}, classList: { toggle() {} } }, documentElement: { style: {} } } });

function inputGame(pointerType = 'touch', scale = 1) {
  const { V3, PH, GS } = lib, handlers = new Map();
  const g = Object.create(lib.Game.prototype), width = pointerType === 'mouse' ? 1280 : 390, height = pointerType === 'mouse' ? 760 : 844;
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
  const send = (type, point = g.project(g.ball.p, {}), timestamp = g.time * 1000) => handlers.get(type)({
    type, pointerId: 1, pointerType, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: point.x * width, clientY: point.y * height, timeStamp: timestamp, cancelable: true, preventDefault() {} });
  return { g, send };
}

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
    assert.ok(lib.V3.dist(g.player.pos, contact) < 1e-9, 'the drawn paddle must be at the actual contact');
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
    assert.ok(lib.V3.dist(g.player.pos, contact) < 1e-9, 'contact must use the current ball, not the down snapshot');
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
        assert.ok(direction * g.ball.w.y > 0, `${label}: sideways brush sign does not follow its direction`);
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

test('the shot journal follows the same scaled expiry as collision detection', () => {
  const g = releasedSwipe(), journal = new lib.ShotJournal();
  const entry = journal.observe(g.swipe.gestureId, g.swipe.lastReleased,
    { time: 10, sampleTime: 10, sampleSimTime: 5, simTime: 5, active: false, isServe: false, strokeId: 'LOOP' });
  journal.expire(10.7, 5.21);
  assert.equal(entry.outcome, 'pending');
  journal.expire(10.9, 5.26);
  assert.equal(entry.outcome, 'no_contact');
});
