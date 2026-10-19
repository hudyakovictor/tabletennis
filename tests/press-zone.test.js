const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load, root } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '25_career.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '42_shot_diagnostics.js', '43_input_telemetry.js', '55_ai.js', '56_rig.js', '57_camera.js',
  '59_replay.js', '70_game.js', '80_ui.js'],
  ['MATCH_RULES', 'PRESS_REJECTION_REASONS', 'pressHitZone', 'pressHitZoneOval', 'pressServeZoneOval',
    'pressZoneForBall', 'serveTossRise', 'InputTelemetryLog', 'makeInputLogEvent', 'benchmarkInputTelemetry',
    'ZoneCalibrationSession', 'ZONE_CALIBRATION_STEPS', 'ShotJournal', 'SwipeTracker', 'isRealStroke',
    'Game', 'GS', 'V3', 'PH', 'MomentRecorder', 'REPLAY_FLOATS', 'installUnifiedControls']);
const rules = lib.MATCH_RULES, { V3, GS, PH } = lib;
const W = 1000, H = 500, center = { x: .5, y: .5, ok: true };
const atPx = (dx, dy) => ({ x: .5 + dx / W, y: .5 + dy / H });
const ovalAt = (dx, dy, opts = {}) => lib.pressHitZoneOval(center, atPx(dx, dy), W, H,
  { screenVelocityPx: { x: 1000, y: 0 }, pointerType: 'mouse', ...opts });

function gameFixture() {
  const g = Object.create(lib.Game.prototype);
  Object.assign(g, { settings: lib.installUnifiedControls({ hand: 'right', grip: 'shakehand', difficulty: 2 }),
    state: GS.RALLY, server: 1, paused: false, shotId: 2, replayer: { on: false }, time: 1, frame: 7, fps: 60,
    ball: { live: true, p: V3.new(0, 1, 1.5), v: V3.new(0, 0, 6), w: V3.new(), lastHitBy: -1 },
    player: { pos: V3.new(0, 1, 1.5), normal: V3.new(0, 0, -1), motionStage: 'ready' },
    rallyBounces: [1], tossApex: 1.4, pointer: { x: .5, y: .5 }, pointerFine: true, vw: W, vh: H,
    R: { viewProj: [] }, inputLog: new lib.InputTelemetryLog(), moments: null,
  });
  g.project = (p, out = {}) => { out.x = .5 + p.x * .05; out.y = .5 - (p.y - 1) * .05; out.ok = true; return out; };
  return g;
}

test('rules v2 publish one shared oval contract and the rejection code list', () => {
  assert.equal(rules.version, 2);
  assert.equal(rules.zoneShape, 'oval');
  assert.equal(rules.ovalLeadSec, .16); assert.equal(rules.ovalForwardPx, 24);
  assert.equal(rules.ovalForwardMaxPx, 120); assert.equal(rules.ovalMinSpeedPx, 8);
  assert.equal(rules.ovalFullSpeedPx, 120);
  assert.equal(rules.ovalBackPx, 18); assert.equal(rules.ovalSideMousePx, 44);
  assert.equal(rules.ovalSideTouchPx, 60); assert.equal(rules.serveTossMinRise, .16);
  assert.deepEqual([...lib.PRESS_REJECTION_REASONS], ['OUTSIDE_ZONE', 'NO_FRESH_SWIPE', 'STATIC_CLICK',
    'DEPTH_FAIL', 'TIMING_LATE', 'TIMING_EARLY', 'CONSUMED', 'SERVE_TOSS_LOW', 'WRONG_DIRECTION', 'BOUNCE_ILLEGAL']);
});

test('oval degenerates to a finite circle at zero screen speed', () => {
  const zone = lib.pressHitZoneOval(center, atPx(44, 0), W, H,
    { screenVelocityPx: { x: 0, y: 0 }, pointerType: 'mouse' });
  assert.equal(zone.shape, 'circle'); assert.equal(zone.accepted, true);
  assert.ok(Number.isFinite(zone.score) && Math.abs(zone.score - 1) < 1e-12);
  assert.equal(lib.pressHitZoneOval(center, atPx(45, 0), W, H,
    { screenVelocityPx: { x: 0, y: 0 }, pointerType: 'mouse' }).accepted, false);
});

test('stationary along/across use the ball-to-racket reference, not screen axes', () => {
  const opts = { screenVelocityPx: { x: 0, y: 0 }, pointerType: 'mouse',
    referenceScreen: { x: .5, y: 1 } }; // racket/player is screen-down from the ball
  const closer = lib.pressHitZoneOval(center, atPx(0, 20), W, H, opts);
  const farther = lib.pressHitZoneOval(center, atPx(0, -20), W, H, opts);
  const side = lib.pressHitZoneOval(center, atPx(20, 0), W, H, opts);
  assert.ok(closer.along > 0); assert.ok(farther.along < 0);
  assert.ok(Math.abs(side.along) < 1e-9); assert.ok(Math.abs(side.across + 20) < 1e-9);
  assert.equal(closer.referenceAxisX, 0); assert.equal(closer.referenceAxisY, 1);
});

test('oval blend is continuous across the 8 px/s threshold and capped at 5000 px/s', () => {
  const atSpeed = (speed) => lib.pressHitZoneOval(center, atPx(30, 10), W, H,
    { screenVelocityPx: { x: speed, y: 0 }, pointerType: 'mouse', referenceScreen: { x: .5, y: 1 } });
  const z7 = atSpeed(7), z8 = atSpeed(8), z9 = atSpeed(9);
  assert.equal(z7.accepted, z8.accepted); assert.equal(z8.accepted, z9.accepted);
  for (const [a, b] of [[z7, z8], [z8, z9]])
    assert.ok(Math.abs(a.score - b.score) <= .05 * Math.max(1, Math.abs(a.score)),
      `${a.score} -> ${b.score}`);
  assert.equal(z7.blend, 0); assert.equal(z8.blend, 0); assert.ok(z9.blend > 0 && z9.blend < .001);
  const fast = lib.pressHitZoneOval(center, atPx(0, 0), W, H,
    { screenVelocityPx: { x: 5000, y: 0 }, pointerType: 'mouse' });
  assert.equal(fast.fwdPx, rules.ovalForwardMaxPx);
  assert.ok(fast.uncappedForwardPx > rules.ovalForwardMaxPx);
});

test('oval reaches forward by screen speed, barely backward, and mouse/touch widths differ', () => {
  const ahead = ovalAt(120, 0);               // uncapped 184 px, hard-capped forward axis
  assert.equal(ahead.shape, 'oval'); assert.equal(ahead.accepted, true);
  assert.equal(ahead.fwdPx, rules.ovalForwardMaxPx); assert.ok(Math.abs(ahead.along - 120) < 1e-9);
  assert.equal(ovalAt(180, 0).accepted, false);
  assert.equal(ovalAt(-18, 0).accepted, true);
  assert.equal(ovalAt(-19, 0).accepted, false);
  assert.equal(ovalAt(-19, 0).reason, 'OUTSIDE_ZONE');
  assert.equal(ovalAt(0, 45).accepted, false);                       // mouse side 44
  assert.equal(ovalAt(0, 58, { pointerType: 'touch' }).accepted, true); // touch side 60
  for (const speed of [120, 300, 900]) {
    const inside = lib.pressHitZoneOval(center, atPx(speed * .16 * .5, 5), W, H,
      { screenVelocityPx: { x: speed, y: 0 }, pointerType: 'mouse', swipe: { x: -1, y: 0 } });
    assert.equal(inside.accepted, true, `zero-noise point at ${speed} px/s`);
    const behind = lib.pressHitZoneOval(center, atPx(-rules.ovalBackPx - 1, 0), W, H,
      { screenVelocityPx: { x: speed, y: 0 }, pointerType: 'mouse' });
    assert.equal(behind.accepted, false, `behind-ball point at ${speed} px/s`);
  }
});

test('oval survives screen edges and rejects impossible geometry instead of admitting it', () => {
  const edge = lib.pressHitZoneOval({ x: .01, y: .99, ok: true }, { x: 0, y: 1 }, W, H,
    { screenVelocityPx: { x: -500, y: 400 }, pointerType: 'touch' });
  assert.ok(edge && [edge.score, edge.along, edge.across].every(Number.isFinite));
  assert.equal(lib.pressHitZoneOval(center, atPx(0, 0), 0, H, {}), null);
  assert.equal(lib.pressHitZoneOval(center, atPx(0, 0), W, 0, {}), null);
  assert.equal(lib.pressHitZoneOval(center, { x: NaN, y: .5 }, W, H, {}), null);
  assert.equal(lib.pressHitZoneOval({ x: NaN, y: .5, ok: true }, atPx(0, 0), W, H, {}), null);
  assert.equal(lib.pressHitZoneOval(center, atPx(0, 0), W, H, { screenVelocityPx: { x: Infinity, y: 0 } }), null);
  assert.equal(lib.pressHitZoneOval({ p: { x: 0, y: 1, z: 1 }, v: { x: NaN, y: 0, z: 0 } },
    atPx(0, 0), W, H, { project: () => ({ x: .5, y: .5, ok: true }) }), null);
  assert.equal(lib.pressHitZoneOval({ p: { x: 0, y: 1, z: 1 }, v: { x: 0, y: 0, z: 5 } },
    atPx(0, 0), W, H, { project: () => ({ ok: false }) }), null);
});

test('screen velocity comes from two projections, not from the world vector', () => {
  const project = (p, out = {}) => {
    const d = 3 - p.z; out.x = .5 + .2 * p.x / d; out.y = .5 - .2 * (p.y - 1) / d; out.ok = d > .2; return out;
  };
  const ball = { p: { x: .3, y: 1.1, z: 1 }, v: { x: 0, y: 0, z: 5 } };
  const zone = lib.pressHitZoneOval(ball, project(ball.p, {}), W, H, { project, pointerType: 'mouse' });
  const dt = rules.ovalSampleDtSec;
  const a = project(ball.p, {}), b = project({ x: .3, y: 1.1, z: 1 + 5 * dt }, {});
  assert.ok(Math.abs(zone.screenVx - (b.x - a.x) * W / dt) < 1e-9);
  assert.ok(Math.abs(zone.screenVy - (b.y - a.y) * H / dt) < 1e-9);
  assert.ok(zone.speedPx > 0); // pure +z world motion still moves on screen in perspective
});

test('swipe direction must have a positive component towards the ball', () => {
  assert.equal(ovalAt(100, 0, { swipe: { x: -1, y: 0 } }).accepted, true);
  const away = ovalAt(100, 0, { swipe: { x: 1, y: 0 } });
  assert.equal(away.accepted, false); assert.equal(away.reason, 'WRONG_DIRECTION');
  assert.ok(away.directionDot < 0);
  assert.equal(ovalAt(0, 0, { swipe: { x: 1, y: 0 } }).accepted, true); // on the ball: no direction to fail
});

test('serve oval follows the fall line and requires a legal falling toss', () => {
  const opts = { screenVelocityPx: { x: 0, y: 300 }, pointerType: 'touch', falling: true, tossRise: .30 };
  const below = lib.pressServeZoneOval(center, atPx(0, 60), W, H, opts);
  assert.equal(below.accepted, true); assert.ok(below.along > 0);
  assert.equal(lib.pressServeZoneOval(center, atPx(0, 60), W, H, { ...opts, tossRise: .10 }).reason, 'SERVE_TOSS_LOW');
  assert.equal(lib.pressServeZoneOval(center, atPx(0, 60), W, H, { ...opts, falling: false }).reason, 'SERVE_TOSS_LOW');
  assert.ok(Math.abs(lib.serveTossRise(1.2, .9, PH.TABLE_Y) - .3) < 1e-12);
  // The authored toss rises ~0.31-0.36 m from release (vy 2.45-2.65, g 9.81).
  assert.ok(2.45 ** 2 / (2 * PH.G) > rules.serveTossMinRise);
});

test('zoneShape switch keeps the legacy circle available for A/B comparison', () => {
  const circle = lib.pressZoneForBall(center, atPx(rules.pressRadiusPx, 0), W, H, { shape: 'circle' });
  assert.equal(circle.shape, 'circle'); assert.equal(circle.accepted, true);
  const oval = lib.pressZoneForBall(center, atPx(rules.pressRadiusPx, 0), W, H,
    { shape: 'oval', screenVelocityPx: { x: 0, y: 0 }, pointerType: 'mouse' });
  assert.equal(oval.accepted, false); // stationary oval = 44 px mouse circle
});

test('outside press stays outside: later ball arrival, assist and CCD cannot resurrect it', () => {
  const g = gameFixture();
  g.swipe = { gestureId: 1, pressZone: { accepted: false, reason: 'OUTSIDE_ZONE', pressX: .5, pressY: .5, vw: W, vh: H, radius: 40 } };
  assert.equal(g.pressAdmitsBall(), false);
  V3.set(g.ball.p, 0, 1, 1.5); // ball now exactly under the original press projection
  assert.equal(g.pressAdmitsBall(), false);
  g.sweepPaddle = () => { throw Error('CCD must not run'); };
  const before = JSON.stringify(g.ball);
  g.tryPlayerHit(V3.new());
  assert.equal(JSON.stringify(g.ball), before);
});


test('every rejection reason is generated by a game scenario and visible to analyze:log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-reasons-'));
  const events = [];
  const take = (g) => events.push(...g.inputLog.events(g.time));
  const realSwipe = (g, { released = false, at = 0, serving = false } = {}) => {
    const sw = new lib.SwipeTracker();
    sw.down(.5, .72, at); sw.move(.52, .55, at + .06); sw.move(.54, .40, at + .12);
    if (released) sw.up(.54, .40, at + .12);
    sw.pressZone = { accepted: true, shape: 'oval', score: .5, along: 20, across: 2, reason: null,
      pointerType: 'mouse', serving, pressT: at, vw: W, vh: H, x: 500, y: 250, pointerX: 480, pointerY: 250 };
    g.swipe = sw; g.swipeReleasedAt = released ? at + .12 : -Infinity;
    return sw;
  };
  try {
    let g = gameFixture(); // OUTSIDE_ZONE at pointerdown
    const outside = lib.pressZoneForBall(center, atPx(200, 0), W, H,
      { screenVelocityPx: { x: 0, y: 0 }, pointerType: 'mouse' });
    g.swipe = { gestureId: 1, active: true, pressZone: outside };
    g.logInput('pointerdown', { pointer: atPx(200, 0), inputType: 'mouse' }); take(g);

    g = gameFixture(); // WRONG_DIRECTION at the contact candidate
    g.swipe = { gestureId: 2, pressZone: { accepted: true, shape: 'oval', x: 500, y: 250,
      pointerX: 600, pointerY: 250, score: .5, along: 100, across: 0, vw: W, vh: H } };
    assert.equal(g.validatePressDirection({ dx: .1, dy: 0 }), false); take(g);

    g = gameFixture(); // STATIC_CLICK on release
    g.swipe = new lib.SwipeTracker(); g.swipe.down(.5, .5, 0); g.swipe.up(.5, .5, .1);
    g.swipe.pressZone = { accepted: true, serving: false };
    g.logSwipeRelease({ pointer: { x: .5, y: .5 }, inputType: 'mouse' }); take(g);

    g = gameFixture(); // NO_FRESH_SWIPE at a physical opportunity
    g.swipe = new lib.SwipeTracker(); g.swipeReleasedAt = -Infinity;
    g.tryPlayerHit(V3.clone(g.ball.p)); take(g);

    g = gameFixture(); // TIMING_EARLY: a real released swipe has expired
    g.time = 2; realSwipe(g, { released: true, at: 0 });
    g.tryPlayerHit(V3.clone(g.ball.p)); take(g);

    g = gameFixture(); // CONSUMED: this gesture already produced the contact
    g.swipe = new lib.SwipeTracker(); g.swipe.down(.5, .5, 0);
    g.swipe.consumedGestureId = g.swipe.gestureId; g.swipe.pressZone = null;
    g.tryPlayerHit(V3.clone(g.ball.p)); take(g);

    g = gameFixture(); // BOUNCE_ILLEGAL: real intent before the receiver bounce
    g.rallyBounces = []; realSwipe(g);
    g.tryPlayerHit(V3.clone(g.ball.p)); take(g);

    g = gameFixture(); // SERVE_TOSS_LOW: falling, but only 0.10 m of rise
    g.state = GS.SERVE_TOSS; g.ball.lastHitBy = 0; V3.set(g.ball.v, 0, -1, 0);
    g.tossStartY = 1; g.tossApex = 1.1; g.rallyBounces = []; realSwipe(g, { serving: true });
    g.tryPlayerHit(V3.clone(g.ball.p)); take(g);

    g = gameFixture(); // DEPTH_FAIL: aligned laterally, already past in depth
    V3.set(g.ball.p, 0, 1, 2.5); V3.set(g.ball.v, 0, 0, 6); realSwipe(g);
    g.tryPlayerHit(V3.new(0, 1, 2.49)); take(g);

    g = gameFixture(); // TIMING_LATE: past the paddle and outside laterally too
    V3.set(g.ball.p, 1, 1, 2.5); V3.set(g.ball.v, 1, 0, 6); realSwipe(g);
    g.tryPlayerHit(V3.new(1, 1, 2.49)); take(g);

    const logPath = path.join(dir, 'reasons.jsonl');
    fs.writeFileSync(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    const analyzed = spawnSync(process.execPath, ['tt/tools/analyze_input_log.cjs', logPath,
      '--csv', path.join(dir, 'reasons.csv'), '--png', path.join(dir, 'reasons.png')],
      { cwd: root, encoding: 'utf8' });
    assert.equal(analyzed.status, 0, analyzed.stderr);
    const summary = JSON.parse(analyzed.stdout);
    for (const reason of lib.PRESS_REJECTION_REASONS)
      assert.ok(summary.reasons[reason] >= 1, `${reason}: ${JSON.stringify(summary.reasons)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wrong-direction rejection is written back into the journal copy of the gate', () => {
  const g = gameFixture();
  const zone = { accepted: true, shape: 'oval', x: 500, y: 250, pointerX: 600, pointerY: 250, score: .5, along: 100, across: 0 };
  g.swipe = { gestureId: 3, pressZone: { ...zone } };
  g.shotJournal = new lib.ShotJournal();
  g.shotJournal.create(3, 0).pressZone = { ...zone };
  assert.equal(g.validatePressDirection({ dx: .1, dy: 0 }), false); // swiping away from the ball
  assert.equal(g.swipe.pressZone.reason, 'WRONG_DIRECTION');
  assert.equal(g.shotJournal.records[0].pressZone.accepted, false);
  assert.equal(g.shotJournal.records[0].outcome, 'outside');
});

test('same physical swipe is a real stroke at 30, 60 and 120 FPS sampling', () => {
  for (const fps of [30, 60, 120]) {
    const sw = new lib.SwipeTracker();
    const frames = Math.max(3, Math.round(fps * .12));
    sw.down(.5, .72, 0);
    for (let i = 1; i <= frames; i++) sw.move(.5 + .04 * i / frames, .72 - .32 * i / frames, .12 * i / frames);
    assert.equal(lib.isRealStroke(sw.m, false), true, `${fps} FPS`);
    assert.ok(sw.m.dx > 0 && sw.m.dy < 0);
  }
  const click = new lib.SwipeTracker();
  click.down(.5, .5, 0); click.up(.5, .5, .1);
  assert.equal(lib.isRealStroke(click.lastReleased, false), false);
});

test('input log ring keeps only the last 30 seconds and round-trips as JSONL', () => {
  const log = new lib.InputTelemetryLog({ seconds: 30, maxEvents: 512 });
  for (let t = 0; t <= 40; t += .5) log.record({ type: 'frame', t, frame: t * 2 });
  const events = log.events(40);
  assert.ok(events.every(e => e.t >= 10));
  assert.equal(events[0].schema, 1); assert.equal(events[0].rulesVersion, 2);
  const parsed = log.toJSONL(40).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(parsed.length, events.length);
  assert.ok(log.stats(40).inWindow === events.length);
  const bench = lib.benchmarkInputTelemetry(3000);
  assert.ok(bench.msPerEvent < .3, `snapshot+record took ${bench.msPerEvent} ms/event`);
  assert.equal(bench.projectionCalls, 6000); // two real Game.project calls per event
  assert.equal(bench.projectionsPerEvent, 2);
  assert.match(bench.projection, /Game\.prototype\.project/);

  // Two matches in a row if a future Game reset rewinds time: the old epoch
  // must not make the new clock's events fall outside the 30 s window.
  const matches = new lib.InputTelemetryLog({ seconds: 30 });
  matches.record({ type: 'frame', t: 100, match: 1 });
  assert.equal(matches.resetClock(0), true);
  matches.record({ type: 'frame', t: 0, match: 2 });
  matches.record({ type: 'frame', t: 1, match: 2 });
  assert.equal(matches.lastT, 1);
  assert.equal(JSON.stringify(matches.events().map(e => [e.match, e.t])), JSON.stringify([[2, 0], [2, 1]]));
  matches.record({ type: 'frame', t: 0, match: 3 }); // automatic rollback, no explicit reset
  assert.equal(JSON.stringify(matches.events().map(e => e.match)), JSON.stringify([3]));
});

test('input log snapshot carries ball, paddle, screen motion and the decision', () => {
  const g = gameFixture();
  g.swipe = { gestureId: 9, active: true, m: { samples: 4, dist: .1, pathLen: .12, speed: 1, peakSpeed: 1.3 },
    pressZone: { shape: 'oval', accepted: true, score: .4, along: 30, across: 4, speedPx: 200, pointerType: 'touch' } };
  const event = lib.makeInputLogEvent(g, 'frame', { dt: 1 / 60 });
  assert.equal(event.inputType, 'touch'); assert.equal(event.gestureId, 9);
  assert.equal(event.ball.p.length, 3); assert.equal(event.ball.screen.length, 2);
  assert.equal(event.paddle.normal.length, 3); assert.equal(event.decision.along, 30);
  assert.ok(Number.isFinite(event.decision.timingErrorMs));
  g.logInput('pointerdown', { pointer: { x: .5, y: .5 }, pointerId: 4 });
  assert.equal(g.inputLog.events(g.time).length, 1);
});

test('guided zone calibration advances per device and never mutates the shared rules', () => {
  const before = JSON.stringify(rules);
  const session = new lib.ZoneCalibrationSession();
  assert.equal(session.record({ inputType: 'touch', errorPx: 3 }), null); // mouse pass first
  for (let guard = 0; guard < 500 && !session.done; guard++) {
    session.record({ inputType: session.pass, label: 'front', errorPx: 5, along: 63, across: 12,
      gesturePath: .2, ballSpeedKmh: 40, spin: { totalRps: 10 } });
  }
  assert.equal(session.done, true);
  const totalNeed = lib.ZONE_CALIBRATION_STEPS.reduce((a, s) => a + s.need, 0) * 2;
  assert.equal(session.samples.length, totalNeed);
  const data = session.exportData();
  assert.equal(data.summaries.filter(s => s.count > 0).length, 12);
  assert.match(data.summaries.find(s => s.stepId === 'slow').recommendation, /63 px вперёд/);
  assert.equal(data.slowVsFast[0].growsWithSpeed, false);
  assert.equal(JSON.stringify(rules), before);
});

test('replay input decisions are a sparse sidecar; the frame layout does not grow', () => {
  assert.equal(lib.REPLAY_FLOATS, 16);
  const recorder = new lib.MomentRecorder();
  recorder.beginRally(0, [0, 0]);
  recorder.addInputDecision(.5, { shape: 'oval', score: .4, along: 20, across: 2, accepted: true }, { contact: true }, 'mouse');
  const clip = recorder.captureClip(1);
  assert.equal(clip.frames.length % lib.REPLAY_FLOATS, 0);
  assert.equal(clip.inputDecisions.length, 1); assert.equal(clip.inputDecisions[0].along, 20);
});

test('AI serve keeps the placement it rolled instead of re-aiming at the centre', () => {
  let i = 0; const seq = [.1, .9, .5];
  const seeded = Object.create(Math); seeded.random = () => i < seq.length ? seq[i++] : .5;
  const aiLib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '55_ai.js'],
    ['OpponentAI', 'V3', 'PH'], { Math: seeded });
  const ai = new aiLib.OpponentAI(2);
  const ball = { p: aiLib.V3.new(0, aiLib.PH.TABLE_Y + .36, -1.57),
    v: aiLib.V3.new(0, -2.43, 0), w: aiLib.V3.new() };
  const racket = ai.serve({ ball, time: 0,
    equip: { forSide: () => ({ e: aiLib.PH.E_RACKET, mu: aiLib.PH.MU_RACKET, et: aiLib.PH.ET_RACKET, damp: 1 }) } });
  assert.ok(Math.abs(racket.aim.x - .4) < 1e-12);       // rndSym(.5) at random .9
  assert.ok(Math.abs(racket.target.x - .4) < 1e-9);
  assert.equal(racket.valid, true);
});

test('PNG writer, log analyzer and deterministic noise simulator produce real artifacts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-zone-'));
  try {
    const log = path.join(dir, 'log.jsonl');
    const rows = [];
    for (let k = 0; k < 20; k++) {
      const accepted = k % 3 !== 0;
      rows.push({ type: 'pointerdown', t: k / 10, rulesVersion: 2, inputType: k % 2 ? 'touch' : 'mouse',
        ball: { screenV: [250, 80] },
        decision: { shape: 'oval', accepted, reason: accepted ? null : 'OUTSIDE_ZONE', score: accepted ? .5 : 1.5,
          along: accepted ? 50 : 110, across: accepted ? 5 : 75, timingErrorMs: 0 } });
      if (accepted) rows.push({ type: 'contact', t: k / 10, rulesVersion: 2, ball: { screenV: [250, 80] },
        decision: rows[rows.length - 1].decision, outcome: { contact: true } });
    }
    fs.writeFileSync(log, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const csv = path.join(dir, 'a.csv'), png = path.join(dir, 'a.png');
    const analyzed = spawnSync(process.execPath,
      ['tt/tools/analyze_input_log.cjs', log, '--csv', csv, '--png', png], { cwd: root, encoding: 'utf8' });
    assert.equal(analyzed.status, 0, analyzed.stderr);
    assert.match(fs.readFileSync(csv, 'utf8'), /reason,OUTSIDE_ZONE/);
    assert.deepEqual([...fs.readFileSync(png).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

    const runNoise = (sub) => {
      const out = path.join(dir, sub);
      const run = spawnSync(process.execPath, ['tt/tools/noise_zone_sim.cjs', '--out', out],
        { cwd: root, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      return fs.readFileSync(path.join(out, 'noise-zone.json'), 'utf8');
    };
    const first = runNoise('n1'), second = runNoise('n2');
    assert.equal(first, second); // fixed seed, bit-repeatable report
    const report = JSON.parse(first);
    assert.equal(report.scenarios, 144);
    for (const dataset of ['lead', 'worldDistance']) {
      const oval = report.datasets[dataset].oval;
      const circle96 = report.datasets[dataset]['circle-96-current-legacy'];
      assert.ok(oval.goodAcceptRate >= .95, `${dataset} oval good ${oval.goodAcceptRate}`);
      assert.ok(oval.badRejectRate >= .95, `${dataset} oval bad ${oval.badRejectRate}`);
      for (const input of ['mouse', 'touch']) {
        assert.ok(oval.byInput[input].goodAcceptRate >= .95, `${dataset}/${input} good`);
        assert.ok(oval.byInput[input].badRejectRate >= .95, `${dataset}/${input} bad`);
      }
      assert.ok(circle96.goodAcceptRate - oval.goodAcceptRate <= .02,
        `${dataset}: oval good-rate drop vs circle-96 exceeds 2 pp`);
      assert.ok(oval.badRejectRate > circle96.badRejectRate, `${dataset}: oval must reject more bad`);
    }
    assert.equal(report.capSelection.selectedPx, rules.ovalForwardMaxPx);
    assert.equal(report.capSelection.matchesRules, true);
    const noiseCsv = fs.readFileSync(path.join(dir, 'n1', 'noise-zone.csv'), 'utf8');
    for (const row of ['lead,circle-96-current-legacy,overall,all', 'lead,circle-72,fps,144',
      'worldDistance,oval,input,mouse', 'worldDistance,oval,input,touch'])
      assert.ok(noiseCsv.includes(row), `missing CSV row ${row}`);
    const docs = spawnSync(process.execPath, ['tt/tools/render_rules_table.cjs', '--check'],
      { cwd: root, encoding: 'utf8' });
    assert.equal(docs.status, 0, docs.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
