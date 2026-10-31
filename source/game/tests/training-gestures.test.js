const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '30_physics.js', '40_swipe.js', '42_shot_diagnostics.js', '65_train.js'],
  ['TRAIN_STEPS', 'SwipeTracker', 'trainingLessonView', 'trainingGestureModel', 'classifyBaseStroke', 'classifyStroke',
    'isRealStroke', 'tapStrokeMetrics', 'PH']);
const effort = m => Math.max(m.releaseSpeed, .78 * m.peakSpeed) / 4.2;

// Independent pre-overhaul advertising fixtures. Neither their recipes nor
// their context is obtained from the current curriculum or classifier config.
const LEGACY = [
  ['DRIVE', 'forward', 'medium', 'medium'], ['BLOCK', 'tap', 'short', 'soft'],
  ['LOOP', 'up', 'long', 'fast'], ['PUSH', 'down', 'short', 'medium'],
  ['FLICK', 'up', 'short', 'fast'], ['COUNTER', 'up', 'long', 'fast'],
  ['SMASH', 'forward', 'long', 'fast'], ['DROP', 'down', 'short', 'soft'],
  ['HOOK', 'curveLeft', 'long', 'medium'], ['FADE', 'curveRight', 'long', 'medium'],
  ['SIDE', 'side', 'long', 'medium'], ['CHOP', 'down', 'long', 'fast'],
  ['LOB', 'up', 'long', 'soft'], ['SERVE_TOP', 'up', 'medium', 'medium'],
  ['SERVE_BACK', 'down', 'medium', 'medium'], ['SERVE_SIDE', 'curveLeft', 'medium', 'medium'],
  ['SERVE_FAST', 'forward', 'long', 'fast'],
].map(([id, kind, length, pace]) => Object.freeze({ id, kind, length, pace,
  context: Object.freeze({ isServe: id.startsWith('SERVE_'),
    ball: Object.freeze({ y: id === 'SMASH' ? 1.4 : .95, z: .92 }),
    incomingTop: id === 'COUNTER' ? 285 : 35, ballSpeed: id === 'BLOCK' ? 9 : 4 }) }));
Object.freeze(LEGACY);

function legacyGesture(row) {
  const span = { short: .10, medium: .16, long: .28 }[row.length];
  let points;
  if (row.kind === 'tap') points = [[0, 0]];
  else if (row.kind.startsWith('curve')) {
    const sign = row.kind === 'curveLeft' ? 1 : -1;
    points = Array.from({ length: 17 }, (_, i) => {
      const t = i / 16, u = 1 - t;
      return [sign * span * (.55 * (u * u * u + t * t * t) - 1.2 * u * t + .1625),
        -span * (.5 * u * u * u + 1.5 * u * u * t - 1.5 * u * t * t - .5 * t * t * t)];
    });
  } else {
    const [x, y] = row.kind === 'up' ? [0, -1] : row.kind === 'down' ? [.18, 1] : row.kind === 'side' ? [1, 0] : [1, -.20];
    const start = row.length === 'short' ? .8 : .6;
    points = [[-x * span * start, -y * span * start], [0, 0], [x * span * (1 - start), y * span * (1 - start)]];
  }
  const distance = points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);
  const speed = row.id === 'SERVE_FAST' ? 4.6 : { soft: .8, medium: 1.9, fast: 2.9 }[row.pace];
  return { kind: row.kind, points, duration: row.kind === 'tap' ? 180 : Math.round(distance / speed * 1000), contactIndex: 0 };
}

function trace(gesture, serving = false, mirror = 1) {
  const sw = new lib.SwipeTracker(), ps = gesture.points;
  const length = ps.slice(1).reduce((sum, p, i) => sum + Math.hypot(p[0] - ps[i][0], p[1] - ps[i][1]), 0);
  let time = 0, prefix;
  sw.down(.5 + mirror * ps[0][0], .5 + ps[0][1], time);
  for (let i = 1; i < ps.length; i++) {
    time += Math.hypot(ps[i][0] - ps[i - 1][0], ps[i][1] - ps[i - 1][1]) / length * gesture.duration / 1000;
    sw.move(.5 + mirror * ps[i][0], .5 + ps[i][1], time);
    if (i === gesture.contactIndex) prefix = { ...sw.m };
  }
  if (gesture.kind === 'tap') prefix = lib.tapStrokeMetrics(sw.m, .5, .5, serving);
  return { full: gesture.kind === 'tap' ? prefix : { ...sw.m }, prefix, sw };
}

test('all 17 frozen legacy advertising gestures keep their original contextual classification', () => {
  assert.equal(LEGACY.length, 17);
  for (const row of LEGACY) {
    const { full } = trace(legacyGesture(row), row.context.isServe);
    assert.equal(lib.isRealStroke(full, row.context.isServe), true, row.id);
    assert.equal(lib.classifyBaseStroke(full, row.context, effort(full)).id, row.id, `frozen base ${row.id}`);
    assert.equal(lib.classifyStroke(full, row.context, effort(full)).id, row.id, `legacy ${row.id}`);
  }
});

test('every assessable lesson recipe advertises the actual contact prefix, not just its completed path', () => {
  for (const step of lib.TRAIN_STEPS.filter(s => s.check && s.check.strokes && s.check.strokes.length === 1)) {
    const gesture = lib.trainingLessonView(step).gesture;
    const context = { isServe: !!step.serve, forehand: step.stroke !== 'BANANA',
      ball: { x: step.stroke === 'BANANA' ? -.35 : 0, y: step.stroke === 'SMASH' ? 1.4 : .95, z: .92 },
      incomingTop: ['COUNTER', 'CHOP_BLOCK'].includes(step.stroke) ? 285 : 35,
      ballSpeed: ['BLOCK', 'CHOP_BLOCK'].includes(step.stroke) ? 9 : 4 };
    assert.deepEqual(Array.from(gesture.points[gesture.contactIndex]), [0, 0], step.id);
    const traced = trace(gesture, context.isServe);
    for (const [phase, metrics] of Object.entries({ prefix: traced.prefix, full: traced.full })) {
      assert.equal(lib.isRealStroke(metrics, context.isServe), true, `${step.id} ${phase}`);
      assert.equal(lib.classifyStroke(metrics, context, effort(metrics)).id, step.stroke, `${step.id} ${phase}`);
    }
  }
});

test('new recipes work with both lateral signs and preserve signed mixed-serve lift', () => {
  for (const id of ['BANANA', 'CHOP_BLOCK', 'SERVE_NO_SPIN', 'SERVE_SIDE_TOP', 'SERVE_SIDE_BACK']) {
    const step = lib.TRAIN_STEPS.find(s => s.id === id), gesture = lib.trainingLessonView(step).gesture;
    for (const mirror of [-1, 1]) {
      const ctx = { isServe: !!step.serve, forehand: false, side: 1,
        ball: { x: -.35 * mirror, y: .95, z: .92 }, incomingTop: 285, ballSpeed: 9 };
      const { prefix, full } = trace(gesture, ctx.isServe, mirror);
      for (const metrics of [prefix, full]) assert.equal(lib.classifyStroke(metrics, ctx, effort(metrics)).id, step.stroke, id);
      if (id.startsWith('SERVE_SIDE_')) assert.equal(Math.sign(prefix.up), id === 'SERVE_SIDE_TOP' ? 1 : -1);
      if (id === 'BANANA') assert.ok(['HOOK', 'FADE'].includes(lib.classifyBaseStroke(prefix, ctx, effort(prefix)).id));
      if (id === 'CHOP_BLOCK') assert.equal(lib.classifyBaseStroke(prefix, ctx, effort(prefix)).id, 'PUSH');
    }
  }
});

test('banana refinement cannot steal forehand, high, deep, long, soft or non-curved strokes', () => {
  const gesture = lib.trainingLessonView(lib.TRAIN_STEPS.find(s => s.id === 'BANANA')).gesture;
  const { prefix: m } = trace(gesture), ctx = { ball: { x: -.35, y: .95, z: .92 }, forehand: false, incomingTop: 35, ballSpeed: 4 };
  assert.equal(lib.classifyStroke(m, ctx, effort(m)).id, 'BANANA');
  for (const [metrics, context, power] of [
    [m, { ...ctx, forehand: true }, effort(m)], [m, { ...ctx, forehand: undefined }, effort(m)],
    [m, { ...ctx, ball: { ...ctx.ball, y: lib.PH.TABLE_Y + .280001 } }, effort(m)],
    [m, { ...ctx, ball: { ...ctx.ball, y: lib.PH.TABLE_Y + .28 } }, effort(m)],
    [m, { ...ctx, ball: { ...ctx.ball, x: lib.PH.T_HALF_WID + .01 } }, effort(m)],
    [m, { ...ctx, ball: { ...ctx.ball, z: 1.36 } }, effort(m)],
    [{ ...m, dist: .049 }, ctx, effort(m)], [{ ...m, dist: .121 }, ctx, effort(m)],
    [{ ...m, pathLen: .079 }, ctx, effort(m)], [{ ...m, pathLen: .171 }, ctx, effort(m)],
    [m, ctx, .449], [m, ctx, .851],
    [{ ...m, right: 1, up: 0, curl: 0, straightness: 1, pathLen: .10 }, ctx, .6],
    [{ ...m, right: 0, up: 1, curl: 0, straightness: 1, pathLen: .10 }, ctx, .6],
  ]) {
    const original = lib.classifyBaseStroke(metrics, context, power).id;
    assert.equal(lib.classifyStroke(metrics, context, power).id, original);
  }
});

test('chop block requires fast topspin together and never steals tap BLOCK, soft DROP or long CHOP', () => {
  const gesture = lib.trainingLessonView(lib.TRAIN_STEPS.find(s => s.id === 'CHOP_BLOCK')).gesture;
  const { prefix: m } = trace(gesture), ctx = { ball: { x: 0, y: .95, z: .92 }, incomingTop: 285, ballSpeed: 9 };
  assert.equal(lib.classifyStroke(m, ctx, effort(m)).id, 'CHOP_BLOCK');
  for (const [metrics, context, power] of [
    [m, { ...ctx, incomingTop: 219.99 }, effort(m)], [m, { ...ctx, incomingTop: 220 }, effort(m)],
    [m, { ...ctx, ballSpeed: 6.99 }, effort(m)],
    [m, { ...ctx, incomingTop: -285 }, effort(m)],
    [m, { ...ctx, ball: { ...ctx.ball, y: lib.PH.TABLE_Y + .280001 } }, effort(m)],
    [m, { ...ctx, ball: { ...ctx.ball, y: lib.PH.TABLE_Y + .28 } }, effort(m)],
    [{ ...m, dist: .049 }, ctx, effort(m)], [{ ...m, dist: .121 }, ctx, effort(m)],
    [{ ...m, curl: .201 }, ctx, effort(m)], [m, ctx, .299], [m, ctx, .851],
    [{ ...m, tap: true, dist: 0, pathLen: 0 }, ctx, .19],
    [{ ...m, dist: .08 }, ctx, .15], [{ ...m, dist: .30, pathLen: .30 }, ctx, .8],
  ]) assert.equal(lib.classifyStroke(metrics, context, power).id, lib.classifyBaseStroke(metrics, context, power).id);
});

test('only a separately admitted serve-contact tap asks for no spin', () => {
  const m = lib.tapStrokeMetrics({ samples: 2 }, .5, .5, true), ctx = { isServe: true, ball: { y: 1.12, z: 1.55 } };
  assert.equal(lib.isRealStroke(m, true), true); assert.equal(lib.classifyStroke(m, ctx, effort(m)).id, 'SERVE_NO_SPIN');
  const firstPress = { ...m, serveTap: false };
  assert.equal(lib.isRealStroke(firstPress, true), false);
  assert.notEqual(lib.classifyStroke(firstPress, ctx, effort(firstPress)).id, 'SERVE_NO_SPIN');
  assert.equal(lib.isRealStroke({ ...m, tap: false, peakSpeed: 0 }, true), false, 'a stationary hold is not another contact');
});
