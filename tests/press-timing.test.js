const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { pressZoneForBall } = load(['10_math.js','12_match_rules.js'], ['pressZoneForBall']);

test('serve input can be admitted during ascent without weakening strict diagnostics', () => {
  const ball = { x: .5, y: .5, ok: true };
  const opts = { kind: 'serve', pointerType: 'touch', screenVelocityPx: { x: 0, y: -200 },
    falling: false, tossRise: .30 };
  const strict = pressZoneForBall(ball, { x: .5, y: .5 }, 390, 844, opts);
  const input = pressZoneForBall(ball, { x: .5, y: .5 }, 390, 844, { ...opts, deferServeTiming: true });
  assert.equal(strict.accepted, false);
  assert.equal(strict.reason, 'SERVE_TOSS_LOW');
  assert.equal(input.accepted, true);
  assert.equal(input.score, strict.score);
});

test('deferring serve contact timing does not admit a spatially outside press', () => {
  const ball = { x: .5, y: .5, ok: true };
  const zone = pressZoneForBall(ball, { x: .01, y: .01 }, 1280, 760, {
    kind: 'serve', deferServeTiming: true, falling: false, tossRise: 0,
    screenVelocityPx: { x: 0, y: -200 }, pointerType: 'mouse' });
  assert.equal(zone.accepted, false);
  assert.equal(zone.reason, 'OUTSIDE_ZONE');
});
