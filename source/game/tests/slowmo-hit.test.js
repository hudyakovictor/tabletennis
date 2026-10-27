const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '42_shot_diagnostics.js', '56_rig.js', '70_game.js'],
  ['Game', 'SwipeTracker', 'isRealStroke', 'tapStrokeMetrics', 'ShotJournal']);

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

test('explicit tap metrics are a neutral rally stroke but never a toss/serve or a raw hold', () => {
  const sw = new lib.SwipeTracker();
  sw.down(.5, .5, 0); sw.up(.5, .5, .08);
  assert.equal(lib.isRealStroke(sw.lastReleased, false), false);
  const tap = lib.tapStrokeMetrics(sw.lastReleased, .5, .5);
  assert.equal(lib.isRealStroke(tap, false), true);
  assert.equal(lib.isRealStroke(tap, true), false);
  assert.equal(tap.dx, 0); assert.equal(tap.dy, 0); assert.equal(tap.curl, 0);
});

test('coalesced geometry keeps its start but zero-time movement cannot invent a power swipe', () => {
  const sw = new lib.SwipeTracker();
  sw.down(.5, .75, 1, 1);
  sw.move(.5, .60, 1, 1);
  sw.move(.5, .45, 1, 1);
  sw.up(.5, .40, 1, 1);
  assert.equal(sw.lastReleased.sy, .75);
  assert.ok(sw.lastReleased.dy < -.30);
  assert.equal(sw.lastReleased.peakSpeed, 0);
  assert.equal(lib.isRealStroke(sw.lastReleased, false), false);

  // The identical physical path is a real stroke once its DOM event times are
  // available — no game-frame clock or epsilon denominator is required.
  const timed = new lib.SwipeTracker();
  timed.down(.5, .75, 1, 1);
  timed.move(.5, .60, 1.006, 1.006);
  timed.move(.5, .45, 1.012, 1.012);
  timed.up(.5, .40, 1.016, 1.016);
  assert.equal(lib.isRealStroke(timed.lastReleased, false), true);
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
