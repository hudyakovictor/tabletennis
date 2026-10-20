const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js'],
  ['SwipeTracker', 'classifyStroke', 'deriveStroke', 'isRealStroke', 'STROKES']);

const BALL = { y: 1.02, z: 1.44 };
const ctx = (extra = {}) => ({ side: 1, ball: BALL, incomingTop: 0, ballSpeed: 6, ...extra });
const M = (over = {}) => ({
  right: 0, up: 0, dist: .12, curl: 0, speed: 2, peakSpeed: 2, releaseSpeed: 2,
  smooth: .9, straightness: .9, samples: 8, jerk: .1, holdT: 0, x: .5, y: .55,
  sx: .5, sy: .55, pathLen: .14, ...over,
});

test('SwipeTracker measures how long the finger held still before moving', () => {
  const sw = new lib.SwipeTracker();
  sw.down(.5, .5, 0);
  sw.move(.5004, .5002, .05);   // jitter while held
  sw.move(.5006, .5003, .12);
  sw.move(.53, .47, .30);       // the stroke begins at t=.30
  sw.up(.56, .42, .38);
  const m = sw.lastReleased;
  assert.ok(m.holdT >= .14 && m.holdT <= .32, `holdT ${m.holdT}`);
  // a plain flick has essentially no hold
  const sw2 = new lib.SwipeTracker();
  sw2.down(.5, .5, 0); sw2.move(.52, .47, .02); sw2.up(.54, .42, .05);
  assert.ok(sw2.lastReleased.holdT < .12, `flick holdT ${sw2.lastReleased.holdT}`);
});

test('classic profile keeps the down-swipe backspin family', () => {
  assert.equal(lib.classifyStroke(M({ up: -.55, dist: .15 }), ctx(), .35).id, 'PUSH');
  assert.equal(lib.classifyStroke(M({ up: -.6, dist: .25, releaseSpeed: 3.4, peakSpeed: 3.4 }), ctx(), .85).id, 'CHOP');
});

test('safe profile: a held press is defence intent without any down-swipe', () => {
  const safe = ctx({ safeGestures: true });
  // hold, then a gentle up stroke = push
  assert.equal(lib.classifyStroke(M({ up: .25, holdT: .25 }), safe, .3).id, 'PUSH');
  // hold, then a long fast up stroke = chop (deep defence)
  assert.equal(lib.classifyStroke(M({ up: .5, dist: .26, holdT: .3 }), safe, .8).id, 'CHOP');
  // the same held press over a short low ball = drop
  assert.equal(lib.classifyStroke(M({ up: .15, dist: .09, holdT: .22 }), ctx({ safeGestures: true, ball: { y: .88, z: 1.2 } }), .15).id, 'DROP');
  // a held press is NOT a smash even on a high fast ball
  assert.equal(lib.classifyStroke(M({ up: .2, dist: .2, holdT: .2 }), ctx({ safeGestures: true, ball: { y: 1.35, z: 1.4 } }), .75).id, 'PUSH');
});

test('safe profile: a slow short stroke is a push, a fast one stays an attack', () => {
  const safe = ctx({ safeGestures: true });
  assert.equal(lib.classifyStroke(M({ up: .3, dist: .12 }), safe, .22).id, 'PUSH');
  // fast short up is still a flick / drive family, never a push
  const fast = lib.classifyStroke(M({ up: .55, dist: .11 }), safe, .62).id;
  assert.ok(['FLICK', 'DRIVE', 'COUNTER', 'LOOP'].includes(fast), fast);
  // classic profile keeps its old meaning for the same soft stroke
  assert.equal(lib.classifyStroke(M({ up: .3, dist: .12 }), ctx(), .22).id, 'DRIVE');
});

test('the serve hold is the toss ritual, not a backspin modifier', () => {
  const serveSafe = ctx({ safeGestures: true, isServe: true, ball: { y: 1.1, z: 1.4 } });
  // press-and-hold launches the toss; the strike flick comes after — a long
  // holdT must NOT flip a normal serve into a chop serve
  assert.equal(lib.classifyStroke(M({ up: .6, holdT: .5 }), serveSafe, .5).id, 'SERVE_TOP');
  // a genuinely soft serve flick is the safe backspin serve
  assert.equal(lib.classifyStroke(M({ up: .35, dist: .12, holdT: .05 }), serveSafe, .22).id, 'SERVE_BACK');
  // classic: the down flick is the backspin serve
  assert.equal(lib.classifyStroke(M({ up: -.35 }), ctx({ isServe: true, ball: { y: 1.1, z: 1.4 } }), .5).id, 'SERVE_BACK');
});

test('deriveStroke sanitises hostile holdT and stays finite', () => {
  const r = lib.deriveStroke(M({ holdT: NaN }), ctx({ safeGestures: true }));
  assert.ok(Number.isFinite(r.vmag) && Number.isFinite(r.normal.x + r.normal.y + r.normal.z));
  assert.equal(r.stroke.id, 'DRIVE');
});

test('a held-but-tiny gesture is still a block/tap, not defence', () => {
  const safe = ctx({ safeGestures: true, ballSpeed: 9 });
  assert.equal(lib.classifyStroke(M({ dist: .03, holdT: .4, peakSpeed: .2, releaseSpeed: .2, speed: .2 }), safe, .1).id, 'BLOCK');
});

test('moves in one RAF preserve pointerdown and recompute coalesced metrics', () => {
  const sw = new lib.SwipeTracker();
  sw.down(.5, .75, 0);
  sw.move(.51, .72, 0);
  sw.move(.53, .66, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(sw.samples[0])), { x: .5, y: .75, t: 0 });
  assert.equal(sw.m.sy, .75);
  assert.ok(sw.m.dist > .09);
  sw.up(.53, .66, .02);
  assert.equal(lib.isRealStroke(sw.lastReleased, true), true);
  assert.equal(sw.lastReleased.holdT, 0, 'motion at time zero is not a hold');
});

test('coalescing a high-frequency move keeps hold time and live metrics current', () => {
  const sw = new lib.SwipeTracker();
  sw.down(.5, .75, 1);
  sw.move(.501, .749, 1.01);
  sw.move(.53, .69, 1.011);
  assert.ok(sw.m.dist > .06);
  assert.ok(sw.m.holdT < .02);
  assert.equal(sw.m.x, .53);
  assert.ok(Number.isFinite(sw.m.speed));
});
