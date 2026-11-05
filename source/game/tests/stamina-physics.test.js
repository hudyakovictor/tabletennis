'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

function fresh() {
  return load(['10_math.js', '30_physics.js', '40_swipe.js', '55_ai.js'], [
    'Stamina', 'STROKES', 'STROKE_CONFIG', 'ARCH', 'PH', 'V3', 'TAU', 'OpponentAI', 'AI_LEVELS',
    'AI_SERVE_CAPS', 'SERVE_WARM', 'serveWarmKey', 'deriveStroke', 'racketForStroke',
    'describeStrokeEffort', 'describeProfileEffort', 'enforceRacketEffort', 'racketEffortCap',
    'strokeFrame', 'resolvedRacketFrame', 'refineRacket', 'resolveRacketLaunch', 'strokeIdentityMatches',
    'impactRacket', 'predict', 'integrateBall', 'tableContact', 'bounceTable', 'netContactStep',
  ]);
}

const STATES = [
  { name: 'fresh', energy: 100, fatigue: 0, capacity: 100, enabled: true },
  { name: 'middle', energy: 30, fatigue: 15, capacity: 85, enabled: true },
  { name: 'empty', energy: 0, fatigue: 45, capacity: 55, enabled: true },
];
const SERVES = { SERVE_TOP: .10, SERVE_BACK: .40, SERVE_SIDE: .65, SERVE_FAST: .80, SERVE_NO_SPIN: .95 };
const near = (a, b, label = '', epsilon = 1e-8) => assert.ok(Math.abs(a - b) <= epsilon, `${label}: ${a} != ${b}`);
const plain = value => JSON.parse(JSON.stringify(value));
function metrics(overrides = {}) {
  return { samples: 12, dist: .24, pathLen: .24, speed: 4, releaseSpeed: 4, peakSpeed: 4,
    right: 0, up: 1, curl: 0, smooth: .95, straightness: .95, x: .5, y: .5, ...overrides };
}

function fixture(l, id, side = 1, grip = 'shakehand') {
  const serve = id.startsWith('SERVE_'), cut = id === 'CHOP_BLOCK', short = cut || id === 'BANANA' || id === 'DROP';
  const ball = {
    p: l.V3.new(id === 'BANANA' ? -.35 * side : 0, short ? .95 : id === 'SMASH' ? 1.4 : 1.12, side * (short ? .92 : 1.65)),
    v: l.V3.new(0, serve ? -1 : -.1, serve ? 0 : side * (cut ? 9 : 6)),
    w: l.V3.new(serve ? 0 : side * (cut ? 285 : short ? 35 : 120), 0, 0),
  };
  return { ball, ctx: { side, grip, forehand: id !== 'BANANA', ball: ball.p, ballVelocity: ball.v,
    ballSpin: ball.w, ballSpeed: l.V3.len(ball.v), isServe: serve },
  options: { quality: .93, aim: { x: 0, z: -side * .85 } } };
}

function budgetFor(l, state, request, side = 1, actionId = 'swing') {
  return l.Stamina.deriveEffortBudget(state, { ...request, side, actionId });
}

function assertCap(l, racket, budget, label) {
  assert.equal(racket.effortBudget, budget, `${label}: immutable action budget retained`);
  const cap = l.racketEffortCap(racket);
  assert.ok(racket.vmag <= cap + 1e-8, `${label}: pre-absorb speed ${racket.vmag} > ${cap}`);
  assert.ok(l.V3.len(racket.vR) <= cap * (1 - (racket.arch.absorb || 0)) + 1e-8, `${label}: actual blade cap`);
  near(racket.vmag * (1 - (racket.arch.absorb || 0)), l.V3.len(racket.vR), label);
}

function checkedSolve(l, ball, racket, assist = 1) {
  const impact = l.context.impactRacket;
  const cap = l.racketEffortCap(racket) * (1 - (racket.arch.absorb || 0));
  let evaluations = 0;
  l.context.impactRacket = (v, w, normal, swing, quality, rubber) => {
    evaluations++;
    assert.ok(l.V3.len(swing) <= cap + 1e-8, `${racket.stroke.id}: a search candidate exceeded ${cap}`);
    near(quality, racket.quality, 'fatigue is not contact quality');
    return impact(v, w, normal, swing, quality, rubber);
  };
  try {
    const solved = l.refineRacket(ball.p, ball.v, ball.w, racket, assist, racket.quality);
    assert.ok(evaluations > 0);
    return solved;
  } finally { l.context.impactRacket = impact; }
}

// Independently integrate the actual contact, including the two serve bounces.
function flight(l, launch, count) {
  const p = { ...launch.p }, v = { ...launch.v }, w = { ...launch.w }, bounces = [];
  const hit = l.V3.new(), net = l.V3.new();
  for (let t = 0; t < 2.6; t += l.PH.SIM_DT) {
    const previous = { ...p };
    l.integrateBall(p, v, w, l.PH.SIM_DT);
    if (l.netContactStep(previous.x, previous.y, previous.z, p.x, p.y, p.z, net)) return { bounces, net: true };
    if (v.y < 0 && l.tableContact(previous.x, previous.y, previous.z, p.x, p.y, p.z, hit)) {
      bounces.push({ ...hit });
      if (bounces.length === count) break;
      l.V3.copy(p, hit); p.y += 1e-5; l.bounceTable(p, v, w);
    }
    if (p.y < .02) break;
  }
  return { bounces, net: false };
}

function assertLegal(l, ball, racket, label) {
  assert.notEqual(racket.valid, false, `${label}: reported invalid`);
  const launch = l.resolveRacketLaunch(ball, racket);
  assert.ok(launch, `${label}: contact`);
  assert.ok(l.strokeIdentityMatches(racket, launch), `${label}: technique spin identity`);
  if (racket.stroke.id === 'SERVE_TOP' || racket.stroke.id === 'SERVE_BACK') {
    const top = (launch.w.x * launch.v.z - launch.w.z * launch.v.x) / Math.hypot(launch.v.x, launch.v.z);
    assert.ok(racket.stroke.id === 'SERVE_TOP' ? top > 0 : top < 0, `${label}: actual top/back serve identity`);
  }
  const report = flight(l, launch, racket.isServe ? 2 : 1);
  assert.equal(report.net, false, `${label}: net`);
  assert.equal(report.bounces.length, racket.isServe ? 2 : 1, `${label}: missing bounce`);
  if (racket.isServe) assert.equal(Math.sign(report.bounces[0].z), racket.side, label);
  assert.equal(Math.sign(report.bounces.at(-1).z), -racket.side, label);
  for (const point of report.bounces) {
    assert.ok(Math.abs(point.x) <= l.PH.T_HALF_WID + .005 && Math.abs(point.z) <= l.PH.T_HALF_LEN + .005, label);
  }
  const v = { ...ball.v }, w = { ...ball.w };
  assert.ok(l.impactRacket(v, w, racket.normal, racket.vR, racket.quality, racket.rubber));
  near(l.V3.dist(v, launch.v), 0, 'no post-impact speed scale');
  near(l.V3.dist(w, launch.w), 0, 'no post-impact spin scale');
  return launch;
}

test('pure effort descriptors retain fresh requested work, profile overrides and identical human/AI normalization', () => {
  const l = fresh(), beforeConfig = plain(l.STROKE_CONFIG);
  for (const id of Object.keys(l.STROKES)) for (const side of [-1, 1]) {
    const { ctx, options } = fixture(l, id, side), m = Object.freeze(metrics());
    const context = Object.freeze({ ...ctx, strokeId: id, powerScale: .7 });
    const before = plain(context), request = l.describeStrokeEffort(m, context);
    const raw = l.deriveStroke({ ...m }, { ...context });
    assert.equal(request.strokeId, id);
    near(request.requestedVmag, raw.requestedVmag);
    near(request.effort, request.requestedVmag / request.freshVmagCap);
    assert.deepEqual(plain(context), before, 'descriptor cannot mutate the input/context');
    const budget = budgetFor(l, STATES[2], request, side);
    assert.deepEqual(plain(l.describeStrokeEffort(m, { ...context, effortBudget: budget })), plain(request));
    const profile = l.describeProfileEffort(id, { ...ctx, powerScale: .5, effortBudget: budget }, { ...options, vmag: 5 });
    const explicit = l.describeProfileEffort(id, { ...ctx, powerScale: 1.4 }, { ...options, vmag: 5 });
    assert.deepEqual(plain(profile), plain(explicit), 'explicit vmag overrides, rather than multiplying powerScale again');
    near(profile.requestedVmag, 5);
    const matching = l.describeStrokeEffort(m, context);
    near(profile.freshVmagCap, matching.freshVmagCap, 'no cheaper AI denominator');
  }
  assert.deepEqual(plain(l.STROKE_CONFIG), beforeConfig);
  assert.equal(l.SERVE_WARM.size, 0, 'description neither solves nor changes serve cache');
});

test('no budget retains original frames and initial attenuation happens only once, before assistance', () => {
  const l = fresh();
  for (const id of Object.keys(l.STROKES)) {
    const { ctx, options } = fixture(l, id), request = l.describeProfileEffort(id, ctx, options);
    const original = l.racketForStroke(id, ctx, options);
    const full = l.racketForStroke(id, { ...ctx, effortBudget: budgetFor(l, STATES[0], request) }, options);
    const unlimited = l.racketForStroke(id, { ...ctx, effortBudget: null }, options);
    for (const frame of [full, unlimited]) {
      near(l.V3.dist(frame.vR, original.vR), 0, id);
      near(l.V3.dist(frame.normal, original.normal), 0, id);
      assert.deepEqual(plain(frame.rubber), plain(original.rubber));
      near(frame.quality, original.quality);
    }
    assert.equal(l.enforceRacketEffort(unlimited), unlimited);
  }
  const { ctx } = fixture(l, 'DRIVE'), options = { vmag: 8, quality: .94 };
  const request = l.describeProfileEffort('DRIVE', ctx, options), budget = budgetFor(l, STATES[2], request);
  let frame = l.racketForStroke('DRIVE', { ...ctx, effortBudget: budget }, options);
  near(frame.vmag, request.requestedVmag * budget.effortScale, 'submaximal request is attenuated too');
  const speed = frame.vmag;
  for (let i = 0; i < 5; i++) {
    frame = l.enforceRacketEffort(frame);
    const v = l.V3.new(), n = l.V3.new();
    l.strokeFrame(frame, 0, 0, 1, v, n); frame = l.resolvedRacketFrame(frame, n, v);
    near(frame.vmag, speed, 'no repeated q multiplication during reconstruction');
  }
  const tinyFatigue = budgetFor(l, { ...STATES[0], fatigue: .000001 }, request);
  near(tinyFatigue.vmagCap, request.freshVmagCap, 'no cap cliff at first work', 1e-6);
});

test('fresh, middle and empty budgets constrain all 20 frames, both sides and grips, before every simulated impact', () => {
  const l = fresh(), ids = Object.keys(l.STROKES);
  assert.equal(ids.length, 20);
  for (const state of STATES) for (const id of ids) for (const side of [-1, 1]) for (const grip of ['shakehand', 'penhold']) {
    const { ball, ctx, options } = fixture(l, id, side, grip), before = plain(ball);
    const request = l.describeProfileEffort(id, ctx, options), budget = budgetFor(l, state, request, side);
    const raw = l.racketForStroke(id, { ...ctx, effortBudget: budget }, options), label = `${state.name}/${id}/${side}/${grip}`;
    assertCap(l, raw, budget, label);
    const swing = l.V3.new(), normal = l.V3.new();
    l.strokeFrame(raw, .15, -.12, 8, swing, normal);
    assertCap(l, l.resolvedRacketFrame(raw, normal, swing), budget, label + '/boost');
    const oversized = l.V3.mul(l.V3.new(), raw.vR, 20);
    assertCap(l, l.resolvedRacketFrame(raw, raw.normal, oversized), budget, label + '/external');
    const solved = checkedSolve(l, ball, raw);
    assertCap(l, solved, budget, label + '/solve');
    assert.equal(solved.stroke.id, id);
    near(solved.quality, raw.quality);
    l.strokeFrame(solved, 0, 0, 1, swing, normal);
    near(l.V3.dist(swing, solved.vR), 0, label + '/frame roundtrip');
    near(l.V3.dist(normal, solved.normal), 0, label + '/normal roundtrip');
    assertLegal(l, ball, solved, label);
    assert.deepEqual(plain(ball), before, 'planning does not mutate live ball');
  }
});

test('raw derive, assist zero and failed inverse solving cannot bypass or multiply the execution cap', () => {
  const l = fresh();
  for (const id of ['LOOP', 'SMASH', 'BLOCK', 'CHOP_BLOCK', 'DROP', 'SIDE']) {
    const { ball, ctx } = fixture(l, id), m = metrics({ speed: 8, releaseSpeed: 8, peakSpeed: 8 });
    const request = l.describeStrokeEffort(m, { ...ctx, strokeId: id });
    const budget = budgetFor(l, STATES[2], request);
    const raw = l.deriveStroke(m, { ...ctx, strokeId: id, effortBudget: budget });
    for (const assist of [0, 1]) {
      const solve = l.context.solveLaunch;
      l.context.solveLaunch = () => null;
      try {
        const result = checkedSolve(l, ball, raw, assist);
        assertCap(l, result, budget, id);
        near(l.V3.dist(result.vR, l.enforceRacketEffort(result).vR), 0, 'idempotent, no squared penalty');
        assert.equal(result.stroke, raw.stroke);
      } finally { l.context.solveLaunch = solve; }
    }
    assert.equal(l.enforceRacketEffort({ ...raw, effortBudget: null }).effortBudget, null);
    const corrupted = { ...raw, vR: l.V3.mul(l.V3.new(), raw.vR, 100) };
    assert.equal(l.resolveRacketLaunch(ball, corrupted), null, 'never certify a clipped clone of an unbounded live frame');
    assertCap(l, l.enforceRacketEffort(corrupted), budget, id);
    assertCap(l, l.resolvedRacketFrame(raw, raw.normal, corrupted.vR,
      { vmagCap: 100, effortBudget: { vmagCap: 100 } }), budget, 'reconstruction cannot replace the action budget');
  }
});

test('empty energy still permits all five serve families, signed mixed spin, both grips and both sides', () => {
  const l = fresh();
  for (const state of STATES) for (const id of Object.keys(SERVES)) for (const side of [-1, 1]) {
    for (const grip of ['shakehand', 'penhold']) for (const verticalBrush of id === 'SERVE_SIDE' ? [-.4, 0, .4] : [0]) {
      const { ball, ctx, options } = fixture(l, id, side, grip);
      options.verticalBrush = verticalBrush; options.direction = side;
      const request = l.describeProfileEffort(id, ctx, options), budget = budgetFor(l, state, request, side);
      const raw = l.racketForStroke(id, { ...ctx, effortBudget: budget }, options);
      const solved = checkedSolve(l, ball, raw), label = `${state.name}/${id}/${side}/${grip}/${verticalBrush}`;
      assertCap(l, solved, budget, label);
      const launch = assertLegal(l, ball, solved, label);
      if (id === 'SERVE_NO_SPIN') assert.ok(l.V3.len(launch.w) / l.TAU < 1, label);
      if (id === 'SERVE_SIDE') {
        assert.equal(Math.sign(launch.w.y), side * options.direction, label);
        if (verticalBrush === 0) near(launch.w.x, 0, label);
      }
    }
  }
});

test('a genuine no-spin contact tap remains a legal two-bounce serve at empty energy', () => {
  const l = fresh();
  for (const side of [-1, 1]) for (const grip of ['shakehand', 'penhold']) {
    const { ball, ctx } = fixture(l, 'SERVE_NO_SPIN', side, grip);
    const m = metrics({ tap: true, serveTap: true, dist: 0, pathLen: 0, samples: 2,
      speed: .8, peakSpeed: .8, releaseSpeed: .8 });
    const request = l.describeStrokeEffort(m, ctx), budget = budgetFor(l, STATES[2], request, side);
    const raw = l.deriveStroke(m, { ...ctx, effortBudget: budget });
    assert.equal(raw.stroke.id, 'SERVE_NO_SPIN');
    const solved = checkedSolve(l, ball, raw);
    assertCap(l, solved, budget, 'contact tap');
    assert.ok(l.V3.len(assertLegal(l, ball, solved, 'contact tap').w) / l.TAU < 1);
  }
});

test('reduced own effort is smooth and preserves technique, quality, face and incoming momentum', () => {
  const l = fresh();
  for (const id of ['LOOP', 'SMASH']) {
    const { ball, ctx } = fixture(l, id), options = { vmag: 19.5, quality: .94 };
    ctx.grip = 'penhold';
    l.V3.zero(ball.v); l.V3.zero(ball.w);
    const request = l.describeProfileEffort(id, ctx, options), frames = STATES.map(state =>
      l.racketForStroke(id, { ...ctx, effortBudget: budgetFor(l, state, request) }, options));
    for (let i = 1; i < frames.length; i++) {
      assert.ok(l.V3.len(frames[i].vR) < l.V3.len(frames[i - 1].vR), id);
      near(l.V3.dist(frames[i].normal, frames[0].normal), 0, 'same face/contact quality');
      near(frames[i].quality, frames[0].quality);
      assert.equal(frames[i].stroke, frames[0].stroke);
    }
    const launches = frames.map(racket => l.resolveRacketLaunch(ball, racket));
    assert.ok(l.V3.len(launches[2].v) < l.V3.len(launches[0].v));
    assert.ok(l.V3.len(launches[2].w) < l.V3.len(launches[0].w), `${id}: reduced racket-created spin`);
    const around = [29.999, 30.001].map(energy => l.racketForStroke(id,
      { ...ctx, effortBudget: budgetFor(l, { ...STATES[1], energy }, request) }, options));
    assert.ok(l.V3.dist(around[0].vR, around[1].vR) < .01, 'continuous at neighboring reserve values');
  }
  const { ball, ctx, options } = fixture(l, 'BLOCK'); options.vmag = 2.5;
  const request = l.describeProfileEffort('BLOCK', ctx, options);
  const raw = l.racketForStroke('BLOCK', { ...ctx, effortBudget: budgetFor(l, STATES[2], request) }, options);
  const solved = checkedSolve(l, ball, raw), launch = assertLegal(l, ball, solved, 'empty defensive return');
  assert.ok(l.V3.len(launch.v) > l.V3.len(solved.vR), 'incoming momentum is not a stamina charge or ball-speed cap');
});

test('second and third submaximal attacks lose actual racket work and created spin after significant load', () => {
  const l = fresh();
  for (const id of ['SMASH', 'LOOP']) for (const side of [-1, 1]) {
    const { ball, ctx, options } = fixture(l, id, side, 'penhold'); options.vmag = 19.5 * .8;
    const request = l.describeProfileEffort(id, ctx, options);
    near(request.effort, .8);
    let state = { energy: 45, fatigue: 30, regenDelayRemaining: 0, low: false };
    const measurements = [];
    for (let i = -1; i < 3; i++) {
      const current = i < 0 ? l.Stamina.fresh() : state, before = plain(current);
      const budget = budgetFor(l, current, request, side);
      const raw = l.racketForStroke(id, { ...ctx, effortBudget: budget }, options);
      const solved = checkedSolve(l, ball, raw);
      assertCap(l, solved, budget, id); assertLegal(l, ball, solved, id);
      const ownV = l.V3.new(), ownW = l.V3.new();
      assert.ok(l.impactRacket(ownV, ownW, solved.normal, solved.vR, solved.quality, solved.rubber));
      measurements.push({ speed: solved.vmag, spin: l.V3.len(ownW) });
      assert.deepEqual(plain(current), before, 'solving does not pay or recover');
      assert.equal(solved.stroke.id, id); near(solved.quality, options.quality);
      if (i >= 0) state = l.Stamina.advance(l.Stamina.charge(state, l.Stamina.cost(request)), 1.2);
    }
    for (let i = 1; i < measurements.length; i++) {
      assert.ok(measurements[i].speed < measurements[i - 1].speed, `${id}: actual own speed`);
      assert.ok(measurements[i].spin < measurements[i - 1].spin, `${id}: actual created spin`);
    }
    assert.ok(measurements[3].speed < measurements[1].speed * .95, `${id}: third attack noticeably slower`);
    assert.ok(measurements[3].spin < measurements[1].spin * .90, `${id}: third attack produces less spin`);
  }
});

test('serve warm starts separate budgets, reuse equivalent actions and revalidate malicious cached boosts within the cap', () => {
  const l = fresh(), { ball, ctx, options } = fixture(l, 'SERVE_TOP');
  const request = l.describeProfileEffort('SERVE_TOP', ctx, options);
  const raw = state => l.racketForStroke('SERVE_TOP', { ...ctx, effortBudget: budgetFor(l, state, request) }, options);
  const high = raw(STATES[0]), low = raw(STATES[2]), key = l.serveWarmKey(1, low);
  assert.notEqual(key, l.serveWarmKey(1, high));
  assert.equal(key, l.serveWarmKey(1, { ...low, effortBudget: { ...low.effortBudget, actionId: 'next-swing' } }));
  checkedSolve(l, ball, high);
  l.SERVE_WARM.set(key, { dE: 0, dA: 0, sc: 1000, dmp: 1 });
  const solved = checkedSolve(l, ball, low);
  assertCap(l, solved, low.effortBudget, 'cached boost');
  assertLegal(l, ball, solved, 'cached boost');
  const before = plain(Array.from(l.SERVE_WARM));
  checkedSolve(l, ball, { ...low, preview: true });
  assert.deepEqual(plain(Array.from(l.SERVE_WARM)), before, 'preview cannot touch the live cache');
  const limit = l.STROKE_CONFIG.serve.solver.warmLimit;
  while (l.SERVE_WARM.size < limit) l.SERVE_WARM.set('old-' + l.SERVE_WARM.size, {});
  const middle = raw(STATES[1]), middleKey = l.serveWarmKey(1, middle);
  checkedSolve(l, ball, middle);
  assert.equal(l.SERVE_WARM.size, limit, 'budget dimensions do not grow the cache without bound');
  assert.ok(l.SERVE_WARM.has(middleKey), 'a full cache must still learn the current budget');
});

test('AI request uses existing level powerK, quotes its own side, and planning never pays', () => {
  const l = fresh(), config = plain(l.AI_LEVELS);
  for (const side of [-1, 1]) for (let level = 0; level < 4; level++) {
    const ai = new l.OpponentAI(level); ai.side = side; ai.rng = () => .999;
    const { ball } = fixture(l, 'DRIVE', side), state = { ...STATES[2] }, before = plain(state), calls = [];
    const game = { ball, strokeTime: 0, getEffortBudget(actualSide, request) {
      calls.push(actualSide); assert.equal(actualSide, side);
      return budgetFor(l, state, request, actualSide);
    } };
    ai.commit = { archId: 'DRIVE', speed: 9, aim: { x: 0, z: -side * .85 } }; ai.swingAt = 0;
    const request = ai.describeEffort(game), L = ai.L;
    near(request.requestedVmag, Math.min(L.vmagMax, Math.max(L.vmagMin, 9 * (.7 + .3 * ai.pace) * .92 * L.powerK)));
    near(request.freshVmagCap, 19.5, 'level is not a cheaper cost denominator');
    const racket = ai.swing(game);
    assert.deepEqual(plain(racket.effortRequest), plain(request));
    assertCap(l, racket, racket.effortBudget, 'AI swing');
    assert.equal(calls.length, 1, 'fallbacks must retain the quote, not request a new budget');
    assert.deepEqual(plain(state), before);
    assert.equal(ai.stats.shots, 0, 'only Game owns execution/contact accounting');
  }
  assert.deepEqual(plain(l.AI_LEVELS), config, 'no difficulty-table stamina mutation');
});

test('AI legality fallback, execution errors and handicap keep the same immutable pre-impact budget', () => {
  const l = fresh(), ai = new l.OpponentAI(0), { ball, ctx, options } = fixture(l, 'DRIVE', -1);
  const request = l.describeProfileEffort('DRIVE', ctx, { ...options, vmag: 19.5 });
  const budget = budgetFor(l, STATES[2], request, -1);
  const raw = l.racketForStroke('DRIVE', { ...ctx, effortBudget: budget }, { ...options, vmag: 19.5 });
  raw.effortRequest = request;
  const game = { ball, strokeTime: 1, getEffortBudget() { throw new Error('fallback requoted executed work'); } };
  const legal = ai._flightLegal; let calls = 0;
  ai._flightLegal = () => calls++ > 0;
  const fallback = ai._ensureLegal(game, raw, { speed: 7, aim: options.aim });
  ai._flightLegal = legal;
  assert.equal(fallback.stroke.id, 'BLOCK');
  assert.equal(fallback.effortRequest, request);
  assertCap(l, fallback, budget, 'fallback');
  ai.setHandicap(.7);
  assertCap(l, ai._scaleRacket(raw, 40), budget, 'handicap');
  const impact = l.context.impactRacket;
  let candidates = 0;
  l.context.impactRacket = (v, w, normal, swing, ...rest) => {
    candidates++;
    assert.ok(l.V3.len(swing) <= budget.vmagCap + 1e-8, 'execution error was capped before its prediction');
    return impact(v, w, normal, swing, ...rest);
  };
  try {
    for (const long of [false, true]) {
      const draws = [0, long ? .99 : 0]; ai.rng = () => draws.length ? draws.shift() : .99;
      const actual = ai.applyExecutionError(game, raw, false);
      assertCap(l, actual, budget, long ? 'long error' : 'net error');
    }
    assert.ok(candidates >= 2);
  } finally { l.context.impactRacket = impact; }
});

test('low AI reserves gradually reduce costly choices without banning suitable attacks or changing RNG', () => {
  const l = fresh();
  for (const side of [-1, 1]) {
    const counts = [];
    for (const state of STATES) {
      const ai = new l.OpponentAI(3); ai.side = side;
      const { ball } = fixture(l, 'SMASH', side);
      const game = { ball, getEffortBudget(actualSide, request) {
        assert.equal(actualSide, side); return budgetFor(l, state, request, side);
      } };
      const plan = { x: 0, y: 1.4, z: -1.2, speed: 8, short: false };
      let smashes = 0, draws = 0;
      for (let i = 0; i < 1000; i++) {
        ai.rng = () => { draws++; return (i + .5) / 1000; };
        const id = ai.pickStroke(game, plan);
        if (id === 'SMASH') smashes++;
        else assert.equal(id, 'DRIVE', 'low reserves do not force block-only play');
      }
      assert.equal(draws, 1000, 'no rejection rerolls'); counts.push(smashes);
    }
    assert.ok(counts[0] > counts[1] && counts[1] > counts[2] && counts[2] > 0, counts.join('/'));
  }
});

test('AI technical serve proposals preserve the same quote through retries and never debit planning', () => {
  const l = fresh();
  for (let level = 0; level < 4; level++) for (const id of Object.keys(SERVES)) for (const side of [-1, 1]) {
    const ai = new l.OpponentAI(level); ai.side = side;
    const draws = [SERVES[id], .5, .5, .9, .5]; ai.rng = () => draws.length ? draws.shift() : .5;
    const { ball, ctx } = fixture(l, id, side);
    l.V3.set(ball.p, 0, l.PH.TABLE_Y + .36, side * (l.PH.T_HALF_LEN + .20)); l.V3.set(ball.v, 0, -2.43, 0);
    const request = l.describeProfileEffort(id, ctx, { vmag: 8 });
    const budget = budgetFor(l, STATES[2], request, side), before = plain(ball);
    const racket = ai.serve({ ball, strokeTime: 0 }, budget);
    assertCap(l, racket, budget, id);
    assert.equal(racket.stroke.id, id);
    assertLegal(l, ball, racket, `${id}/AI${level}/${side}`);
    assert.equal(ai.stats.shots, 0); assert.equal(ai.stats.errors, 0);
    assert.deepEqual(plain(ball), before);
    if (level !== 2) continue;
    const resolve = l.context.resolveRacketLaunch;
    l.context.resolveRacketLaunch = () => null;
    const retry = [SERVES[id], .5, .5, .9, .5]; ai.rng = () => retry.length ? retry.shift() : .5;
    try {
      const failed = ai.serve({ ball }, budget);
      assert.equal(failed.valid, false); assert.equal(failed.stroke.id, id);
      assertCap(l, failed, budget, id + '/failed retry');
      assert.equal(failed.aiServeDiagnostic.attempts, 2);
      assert.equal(ai.stats.shots, 0); assert.equal(ai.stats.errors, 0);
    } finally { l.context.resolveRacketLaunch = resolve; }
  }
});
