const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load, root } = require('./helpers.cjs');
const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js'],
  ['ShotJournal', 'SwipeTracker', 'measureShotSpin', 'shotFeedbackView', 'shotHudView', 'runShotCalibration', 'summarizeCaptureCalibration', 'shotCalibrationCases', 'V3', 'TAU', 'STROKES']);
const { ShotJournal, SwipeTracker, V3, TAU, STROKES } = lib;
function gesture() {
  const sw = new SwipeTracker(); sw.down(.5, .7, 0); sw.move(.52, .5, .05); sw.up(.54, .3, .1); return sw;
}
function attempt(j = new ShotJournal()) {
  const sw = gesture(); j.observe(sw.gestureId, sw.lastReleased, { time: .1, sampleTime: .1, active: false, isServe: false, strokeId: 'LOOP' }); return j;
}
function contact(j = attempt(), isServe = false) {
  const b = { v: V3.new(0, 1, -10), w: V3.new(-20 * TAU, 5 * TAU, 0) };
  j.capture(1, .15, { stroke: STROKES.LOOP, isServe, quality: .8, normal: V3.new(0, -.2, -.98), vR: V3.new(0, 4, -5),
    contactInput: { v: V3.new(0, -1, 6), w: V3.new(0, 0, 0) } }, b);
  return { j, b };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('gesture IDs survive cancellation but each new down has a distinct ID', () => {
  const sw = gesture(); const id = sw.gestureId; sw.cancel(); assert.equal(sw.gestureId, id); sw.down(.5, .5, .2); assert.equal(sw.gestureId, id + 1);
});
test('recognition alone is never a hit, spin or successful return', () => {
  const j = attempt(); assert.equal(j.latest.valid, true); assert.equal(j.latest.contact, null);
  assert.equal(lib.shotFeedbackView(j.latest).metrics, ''); assert.equal(j.latest.outcome, 'pending');
  j.expire(.36); assert.equal(j.latest.outcome, 'no_contact');
  /* no capture sample was ever seen → the report must still name the miss */
  assert.equal(j.latest.reason, 'TIMING_EARLY');
  assert.match(lib.shotFeedbackView(j.latest).detail, /касания мяча не было/);
});
test('stationary click is rejected, not classified as a topspin', () => {
  const sw = new SwipeTracker(); sw.down(.5, .5, 0); sw.up(.5, .5, .1); const j = new ShotJournal();
  j.observe(1, sw.lastReleased, { time: .1, sampleTime: .1, active: false, isServe: false, strokeId: 'LOOP' });
  assert.equal(j.latest.outcome, 'rejected'); assert.equal(j.latest.strokeId, null);
  j.expire(.2); assert.equal(j.latest.reason, 'STATIC_CLICK');
});
test('one gesture updates one record; holding can resume but never duplicates contact', () => {
  const j = attempt(), sw = gesture(); j.expire(.4);
  j.observe(1, sw.lastReleased, { time: .41, sampleTime: .41, active: true, isServe: false, strokeId: 'LOOP' });
  assert.equal(j.latest.outcome, 'pending'); assert.equal(j.records.length, 1);
  contact(j); j.observe(1, sw.lastReleased, { time: .5, sampleTime: .5, active: false, strokeId: 'CHOP' });
  assert.equal(j.latest.strokeId, 'LOOP'); assert.equal(j.records.length, 1);
});
test('actual contact snapshots measured vectors, not mutable ball references', () => {
  const { j, b } = contact(); near(j.latest.contact.spin.topRps, 20); near(j.latest.contact.spin.sideRps, 5);
  near(j.latest.contact.speedKmh, Math.sqrt(101) * 3.6); b.w.x = 0; b.v.z = 0;
  near(j.latest.contact.outgoing.w.x, -20 * TAU); near(j.latest.contact.spinChangeRps, Math.sqrt(425));
  assert.equal(j.latest.outcome, 'pending');
});
test('topspin measurement rotates with diagonal outgoing direction and converts rad/s', () => {
  for (const [v, w] of [[V3.new(0, 0, -5), V3.new(-TAU * 10, 0, 0)], [V3.new(5, 0, 0), V3.new(0, 0, -TAU * 10)],
    [V3.new(3, 0, -4), V3.new(-TAU * 8, 0, -TAU * 6)]]) {
    const spin = lib.measureShotSpin(w, v); near(spin.topRps, 10); near(spin.totalRps, 10); near(spin.corkRps, 0);
  }
});
test('component decomposition preserves total spin energy and separates backspin', () => {
  const spin = lib.measureShotSpin(V3.new(20, -30, 40), V3.new(4, 2, -3));
  near(spin.totalRps ** 2, spin.topRps ** 2 + spin.sideRps ** 2 + spin.corkRps ** 2);
  assert.ok(spin.topRps < 0); assert.ok(spin.sideRps < 0);
});
test('table success is based on bounce, not predicted flight or gesture name', () => {
  const { j } = contact(); j.bounce(-1, .3); assert.equal(j.latest.outcome, 'table');
  j.returned(.4); j.point(-1, 'ОЧКО СОПЕРНИКУ', -1, 1); assert.equal(j.records[0].outcome, 'table');
  assert.equal(j.latest.outcome, 'no_swipe'); assert.equal(j.records[0].point.won, false);
});
test('net cord can still be a legal return', () => {
  const { j } = contact(); j.net(); assert.equal(j.latest.outcome, 'pending'); j.bounce(-1, .3); assert.equal(j.latest.outcome, 'table');
});
test('own-half, net and out are different actual results', () => {
  const own = contact().j; own.bounce(1, .3); assert.equal(own.latest.outcome, 'own_half');
  for (const [reason, outcome] of [['В СЕТКУ', 'net'], ['АУТ', 'out'], ['ОШИБКА ПОДАЧИ', 'serve_fault']]) {
    const { j } = contact(); j.point(-1, reason, 1, .8); assert.equal(j.latest.outcome, outcome); assert.equal(j.flight, null);
  }
});
test('serve success requires two correct bounces; tape plus two bounces means let', () => {
  for (const net of [false, true]) {
    const { j } = contact(undefined, true); if (net) j.net(); j.bounce(1, .3); assert.equal(j.latest.outcome, 'pending');
    j.bounce(-1, .5); assert.equal(j.latest.outcome, net ? 'let' : 'table');
    if (net) { const letEntry = j.latest; assert.equal(j.flight, null); j.point(-1, 'ПОДАЧА НЕ ВЫПОЛНЕНА', 0, 2); assert.equal(letEntry.point, undefined); }
  }
  const bad = contact(undefined, true).j; bad.bounce(-1, .3); assert.equal(bad.latest.outcome, 'serve_fault');
});
test('a newer failed gesture does not steal the preceding shot flight result', () => {
  const { j } = contact(); const sw = gesture();
  j.observe(2, sw.lastReleased, { time: .2, sampleTime: .2, active: false, strokeId: 'LOOP' }); j.bounce(-1, .3); j.expire(.6);
  assert.equal(j.records[0].outcome, 'table'); assert.equal(j.latest.outcome, 'no_contact');
});
test('new rallies cannot overwrite an earlier shot point', () => {
  const { j } = contact(); j.bounce(-1, .3); j.point(1, 'ОЧКО!', 1, 1);
  j.point(-1, 'ОШИБКА ПОДАЧИ', 0, 3); assert.equal(j.records[0].point.won, true);
});
test('journal is bounded and export is detached and includes tuning context', () => {
  const j = new ShotJournal(3); for (let i = 1; i <= 10; i++) j.create(i, i);
  assert.equal(j.records.length, 3); const data = j.exportData(); data.records[0].outcome = 'modified';
  assert.notEqual(j.records[0].outcome, 'modified'); assert.ok(data.physics.G && data.rules && data.profiles && data.archetypes);
  assert.equal('frames' in data.records[0], false);
});
test('miss collectors, playback UI and automatic miss cinema are absent from source', () => {
  for (const file of ['70_game.js', '80_ui.js', '02_body.html', '05_style.css']) {
    const s = fs.readFileSync(`${root}/tt/src/${file}`, 'utf8');
    assert.doesNotMatch(s, /missedRallies|watchMiss|playAllMisses|debugMisses|debugReplay|_lastPointSwipe|_minBallPaddleDist/);
  }
});
test('144 deterministic calibration fixtures cover both grips/hands/faces without changing the rules', async () => {
  const first = await lib.runShotCalibration(), second = await lib.runShotCalibration();
  assert.equal(JSON.stringify(first), JSON.stringify(second)); assert.equal(first.total, 144); assert.equal(first.invariantFailures, 0);
  // Every fixture is a stroke a human can make with the assist on. The two
  // low, deep penhold backhand loops used to hit the net because the solver
  // simulated the flight from the contact point instead of from the ball's
  // one-radius separation off the face; with that fixed they land.
  assert.equal(first.legal, 144);
  const failures = first.results.filter(r => !r.legal);
  assert.equal(failures.length, 0);
  assert.equal(new Set(first.results.map(r => `${r.grip}/${r.hand}/${r.forehand}`)).size, 8);
});
test('calibration cancellation returns partial data without reporting a completed success', async () => {
  let n = 0; const report = await lib.runShotCalibration({ progress: k => { n = k; }, cancelled: () => n === 2 });
  assert.equal(report.cancelled, true); assert.equal(report.results.length, 2); assert.equal(report.total, undefined);
});
test('calibration CLI refuses to overwrite its comparison baseline', () => {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['tt/tools/calibrate.cjs', '--baseline', 'test-results/shared.json', '--output', 'test-results/shared.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /refusing to overwrite baseline/);
});
test('resuming an initially too-weak held gesture clears the old rejection', () => {
  const sw = new SwipeTracker(), j = new ShotJournal(); sw.down(.5, .7, 0); sw.move(.5, .7, .05);
  j.observe(1, sw.m, { time: .05, sampleTime: .05, active: true, isServe: false, strokeId: null }); j.expire(.3);
  assert.equal(j.latest.outcome, 'rejected'); sw.move(.5, .3, .35);
  j.observe(1, sw.m, { time: .35, sampleTime: .35, active: true, isServe: false, strokeId: 'LOOP' });
  assert.equal(j.latest.outcome, 'pending'); assert.equal(j.latest.valid, true);
});

test('live HUD uses a short stroke/result and one spin component; full details stay in journal', () => {
  const j = attempt(); assert.equal(lib.shotHudView(j.latest), null);
  contact(j); j.bounce(-1, .3);
  const hud = lib.shotHudView(j.latest);
  assert.equal(hud.title, 'ЛУП'); assert.equal(hud.status, 'На стол');
  assert.equal(hud.metrics, 'Верхнее 20 об/с');
  assert.doesNotMatch(hud.metrics, /км|боковое/);
  assert.match(lib.shotFeedbackView(j.latest).metrics, /км\/ч/);
});

test('radius sensitivity is split by serve/return and reports recorded positions, not a success prediction', () => {
  const records=[.1,.2,.3].map(requiredRadius=>({contact:{incoming:{capture:{serving:false,radius:.361,requiredRadius,
    endpointEligible:true,lateral:requiredRadius,depthGap:.30,depthLimit:.347,ccdRadius:null}}}}));
  records.push({contact:{incoming:{capture:{serving:true,radius:.618,requiredRadius:.59}}}});
  records.push({outcome:'no_contact'});
  const [returns,serves]=lib.summarizeCaptureCalibration(records);
  assert.equal(returns.count,3);assert.equal(serves.count,1);assert.equal(returns.nearEdge,1);
  assert.deepEqual(Array.from(returns.trials,t=>t.kept),[3,3,2,2]);
  assert.deepEqual(Array.from(returns.depthTrials,t=>t.kept),[3,0,0]);
  assert.equal(serves.depthTrials.length,0);assert.equal(serves.trials[1].kept,0);
});
test('nearest miss evidence is bounded and detached from the changing sample object', () => {
  const j=attempt();const sample={score:2,lateral:.5,depthGap:.1};
  j.observeCapture(1,sample,.1);sample.score=0;j.observeCapture(1,{score:3},.11);
  assert.equal(j.latest.closest.score,2);j.observeCapture(1,{score:.8,lateral:.2},.12);
  assert.equal(j.latest.closest.score,.8);assert.equal(j.records.length,1);
});
