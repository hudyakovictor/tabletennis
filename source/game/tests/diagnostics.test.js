const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load, root } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '42_shot_diagnostics.js', '43_input_telemetry.js', '44_diagnostics.js', '70_game.js'],
  ['Game', 'GS', 'V3', 'SwipeTracker', 'tapStrokeMetrics', 'InputTelemetryLog',
    'diagnosticSnapshot', 'diagErrorText', 'DiagnosticArchive']);

function fixture() {
  const g = Object.create(lib.Game.prototype), V = lib.V3;
  Object.assign(g, { time: 10, strokeTime: 4, frame: 21, fps: 60, timeScale: .3, targetTimeScale: .3,
    state: lib.GS.RALLY, server: -1, shotId: 17, score: [1, 2], rally: 3, rallyBounces: [1],
    ball: { p: V.new(.1, 1, 1.7), v: V.new(0, 0, 6), w: V.new(2, 3, 4), live: true, lastHitBy: -1 },
    player: { pos: V.new(.1, 1, 1.8), prevPos: V.new(.1, 1, 1.8), normal: V.new(0, 0, -1), vel: V.new() },
    settings: { camera: 'BROADCAST' }, swipe: new lib.SwipeTracker(), swipeReleasedAt: -Infinity,
    _strike: { on: true, contactable: true, ready: 1, kind: 'rally', t: 0 },
    _cp: { p: V.new(.2, 1.1, 1.8), t: .03 }, _cpFrame: 20, _cpTime: 9.98,
    R: { viewProj: [1, 2, 3], camPos: V.new(0, 2, 3) } });
  return g;
}

test('detailed snapshot records real gates and screen prediction without mutating the game', () => {
  const g = fixture();
  g.swipe.down(.5, .6, 10, 4);
  g.swipe.pressZone = { accepted: true, pressContactable: true, pointerType: 'touch', shotId: 17 };
  const before = JSON.stringify({ ball: g.ball, player: g.player, swipe: g.swipe });
  const d = lib.diagnosticSnapshot(g);
  assert.equal(d.gates.greenCue, true);
  assert.equal(d.gates.ownBounce, true);
  assert.equal(d.gates.inside, true);
  assert.equal(d.clocks.timeScale, .3);
  assert.deepEqual(Array.from(d.gates.predictedPoint), [.2, 1.1, 1.8]);
  assert.equal(d.gesture.pressShotId, 17);
  assert.deepEqual(Array.from(d.paddle.substepPosition || []), []);
  assert.equal(JSON.stringify({ ball: g.ball, player: g.player, swipe: g.swipe }), before);
  assert.doesNotThrow(() => JSON.stringify(d));
  g._acc = .005; g._subK = 1; g._subN = 3;
  g._subPad = { pos: g.player.pos, prevPos: g.player.prevPos, normal: g.player.normal };
  const sub = lib.diagnosticSnapshot(g);
  assert.ok(Math.abs(sub.clocks.substepSimulationStart - 3.995) < 1e-9);
  assert.equal(sub.clocks.substep, 1); assert.equal(sub.clocks.substeps, 3);
});

test('release evidence distinguishes a recognized tap from a stationary rejection', () => {
  const g = fixture(), records = [];
  g.logInput = (type, extra) => { records.push({ type, ...extra }); return records.at(-1); };
  g.swipe.down(.5, .6, 9.9, 3.97);
  g.swipe.pressZone = { accepted: true, serving: false, pointerType: 'touch', shotId: 17 };
  g.swipe.tapMaxMovePx = 0;
  g.swipe.up(.5, .6, 10, 4);
  g.swipe.lastReleased = lib.tapStrokeMetrics(g.swipe.lastReleased, .5, .6);
  g.logSwipeRelease();
  assert.equal(records.at(-1).outcome.recognized, 'tap');
  assert.equal(records.at(-1).outcome.reason, null);
  assert.equal(records.at(-1).outcome.sameShot, true);
  g.swipe.lastReleased.tap = false;
  g.swipe.lastReleased.pathLen = 0;
  g.logSwipeRelease();
  assert.equal(records.at(-1).outcome.reason, 'STATIC_CLICK');
});

test('diagnostics flag a green stationary press held until after the window without changing the collision decision', () => {
  const g = fixture(), records = [];
  g.debugRecording = true; g.swipe.down(.5, .6, 9.9, 3.97);
  g.swipe.pressZone = { accepted: true, pressContactable: true, shotId: 17 };
  g.ball.p.z = 2.2; g.logInput = (type, extra) => { records.push({ type, ...extra }); return records.at(-1); };
  const before = JSON.stringify(g.ball);
  g.logNoStrokeIntent(false); g.logNoStrokeIntent(false);
  assert.equal(records.filter(x => x.type === 'anomaly').length, 1);
  assert.equal(records.find(x => x.type === 'anomaly').outcome.reason, 'GREEN_PRESS_HELD_PAST_CAPTURE');
  assert.equal(JSON.stringify(g.ball), before);
});

test('substep tracing continues across slow-motion frames with fewer than six substeps', () => {
  const g = fixture(), rows = [];
  g.debugRecording = true;
  g.logInput = (type, extra) => rows.push({ type, ...extra });
  for (let i = 0; i < 60; i++) {
    g._subK = i % 3 + 1; // the per-frame counter never reaches six
    g.diagnosticPhysicsGate('no_stroke_intent');
  }
  assert.ok(rows.length >= 10, `only ${rows.length} samples were retained`);
  assert.ok(rows.every(e => e.outcome.stage === 'no_stroke_intent'));
});

test('ring identifies events across clock resets and reports actual bounds', () => {
  const log = new lib.InputTelemetryLog({ seconds: 2, maxEvents: 128 });
  for (let i = 0; i < 200; i++) log.record({ type: 'frame', t: i / 10 });
  const stats = log.stats(19.9), events = log.events(19.9);
  assert.ok(stats.dropped > 0);
  assert.ok(stats.retainedSeconds <= 2.01);
  assert.ok(Number.isFinite(stats.retainedWallSeconds));
  assert.ok(events.every(e => e.instance === log.instance && Number.isFinite(e.wallMs)));
  const lastSeq = events.at(-1).seq;
  log.resetClock(0, true); log.record({ type: 'frame', t: 0 });
  assert.ok(log.events()[0].seq > lastSeq);
});

test('archive failure is explicit and leaves live logging available', async () => {
  const archive = new lib.DiagnosticArchive('test');
  assert.equal(await archive.ready, false);
  assert.equal(archive.status, 'unavailable');
  assert.ok(archive.error);
  assert.deepEqual(Array.from(await archive.read()), []);
  archive.stop();
  assert.equal(lib.diagErrorText('https://example.test/game?token=secret#frag'), 'https://example.test/game');
});

test('the analyzer accepts detailed JSON reports as well as JSONL and summarizes failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-report-test-'));
  try {
    const file = path.join(dir, 'report.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'topspin-diagnostics', recording: { events: 4 }, events: [
      { type: 'physics_gate', outcome: { stage: 'no_stroke_intent' } },
      { type: 'anomaly', outcome: { reason: 'GREEN_PRESS_HELD_PAST_CAPTURE' } },
      { type: 'input_cancel', outcome: { reason: 'window_blur' } },
      { type: 'pointerup', outcome: { recognized: 'tap', reason: null } }
    ] }, null, 2));
    const run = spawnSync(process.execPath, ['tt/tools/analyze_input_log.cjs', file,
      '--csv', path.join(dir, 'out.csv'), '--png', path.join(dir, 'out.png')], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const summary = JSON.parse(run.stdout);
    assert.equal(summary.inputFormat, 'diagnostics-json');
    assert.equal(summary.physicsGates.no_stroke_intent, 1);
    assert.equal(summary.anomalies.GREEN_PRESS_HELD_PAST_CAPTURE, 1);
    assert.equal(summary.cancellations.window_blur, 1);
    assert.equal(summary.releases.tap, 1);
    assert.ok(fs.statSync(path.join(dir, 'out.png')).size > 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
