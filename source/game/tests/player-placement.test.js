'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const l = load(['10_math.js', '30_physics.js', '40_swipe.js'],
  ['V3', 'PH', 'STROKE_CONFIG', 'deriveStroke', 'refineRacket', 'resolveRacketLaunch', 'predict', 'SERVE_WARM']);

function stroke({ x = .65, right = -1, up = 0, speed = 2, serving = false, aim, id, screenX = .74, dist = .06, grip = 'shakehand' } = {}) {
  const ball = { p: l.V3.new(x, 1.10, 1.75), v: l.V3.new(0, -1, serving ? 0 : 5), w: l.V3.new(serving ? 0 : 120, 0, 0) };
  const raw = l.deriveStroke({ x: screenX, y: .6, sx: .8, sy: .6, right, up, speed, releaseSpeed: speed,
    peakSpeed: speed, dist, pathLen: dist, curl: 0, smooth: 1, straightness: 1, samples: 8 },
  { side: 1, playerControlled: true, grip, forehand: x >= 0, isServe: serving, strokeId: id,
    ball: ball.p, ballVelocity: ball.v, ballSpin: ball.w, ballSpeed: l.V3.len(ball.v), movePitch: -.15 });
  raw.quality = 1;
  if (aim) raw.aim = { ...aim };
  return { raw, ball };
}

function shot(options) {
  const { raw, ball } = stroke(options);
  l.SERVE_WARM.clear();
  const racket = l.refineRacket(ball.p, ball.v, ball.w, raw, .85, 1);
  const launch = l.resolveRacketLaunch(ball, racket);
  assert.ok(launch, 'placement must be produced by a closing physical racket face');
  const flight = l.predict(launch.p, launch.v, launch.w,
    { dt: l.PH.SIM_DT, maxT: 3, stopAfterBounces: options.serving ? 2 : 1, out: {} });
  const point = options.serving ? flight.b2 || flight.secondPlaneCross : flight.landed || flight.planeCross;
  return { raw, racket, launch, flight, point };
}

test('player direction comes from the swipe, not the absolute cursor position or how far it travelled before contact', () => {
  for (const x of [-.65, 0, .65]) for (const right of [-1, 0, 1]) for (const serving of [false, true]) {
    const early = stroke({ x, right, serving, screenX: .85, dist: .02 }).raw;
    const late = stroke({ x, right, serving, screenX: .15, dist: .24 }).raw;
    assert.equal(early.aim.x, late.aim.x, 'screen position must not steal lateral direction');
    if (right) assert.equal(Math.sign(early.aim.x - x), right);
    else assert.equal(early.aim.x, x, 'a straight swipe from a corner is down the line, not auto-centred');
  }
});

test('horizontal player strokes reach the sideline and excess force can go beyond it on serves and returns', () => {
  for (const x of [-.65, .65]) for (const serving of [false, true]) for (const grip of ['shakehand', 'penhold']) {
    const right = -Math.sign(x), label = `${serving ? 'serve' : 'return'}/${grip}/${x}`;
    const normal = shot({ x, serving, grip, right, speed: 1 });
    assert.ok(normal.point && !normal.flight.hitNet, `${label}: regular cross-court stroke must clear the net`);
    assert.ok(normal.point.x * right > .52, `${label}: regular stroke still pulled to the centre: ${JSON.stringify(normal.point)}`);
    const hard = shot({ x, serving, grip, right, speed: 6 });
    assert.equal(hard.racket.intentionalOut, true);
    assert.equal(hard.racket.valid, false, 'an intentional miss must not be reported as a legal shot');
    assert.ok(hard.point && !hard.flight.hitNet, `${label}: the hard shot must pass the net`);
    assert.ok(hard.point.x * right > l.PH.T_HALF_WID + .02, `${label}: excessive force was silently kept on the table: ${JSON.stringify(hard.point)}`);
    assert.ok(l.V3.len(hard.launch.v) > l.V3.len(normal.launch.v), `${label}: a harder stroke lost pace`);
    assert.equal(hard.racket.stroke.id, serving ? 'SERVE_SIDE' : 'SIDE');
    assert.ok(Math.abs(hard.launch.w.z) > 1, `${label}: placement must not erase the sidespin brush`);
    if (serving) assert.ok(hard.flight.landed && hard.flight.landed.z > 0, `${label}: serve must still bounce on the server court first`);
  }
});

test('near, middle and deep zones on either side are reachable from both corners and the centre', () => {
  for (const serving of [false, true]) for (const x of [-.65, 0, .65]) {
    for (const targetX of [-.58, 0, .58]) for (const depth of [.4, .8, 1.17]) {
      const aim = { x: targetX, z: -depth }, label = `${serving ? 'serve' : 'return'} ${x} -> ${JSON.stringify(aim)}`;
      const profiles = serving ? [['SERVE_TOP', 1], ['SERVE_BACK', -1], ['SERVE_SIDE', 0]]
        : [['DRIVE', .45], ['PUSH', -1], ['LOOP', 1], ['SIDE', 0]];
      let best = Infinity;
      for (const [id, up] of profiles) {
        const hit = shot({ x, serving, id, up, right: Math.sign(targetX - x), speed: depth < .6 ? 1 : 2.5, aim });
        if (!hit.racket.valid || hit.flight.hitNet || !hit.point) continue;
        best = Math.min(best, Math.hypot(hit.point.x - aim.x, hit.point.z - aim.z));
        if (best < .18) break;
      }
      assert.ok(best < .18, `${label}: no stroke can reach the zone (closest ${best.toFixed(3)} m)`);
    }
  }
});
