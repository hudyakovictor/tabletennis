'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '30_physics.js', '40_swipe.js', '55_ai.js'], [
  'OpponentAI', 'AI_LEVELS', 'AI_BACKSWING', 'AI_SERVE_CAPS', 'AI_SERVE_NET_ROOM', 'AI_SERVE_APEX',
  'AI_SERVE_SOLVES', 'AI_SERVE_FRAME_TRIES', 'PH', 'V3', 'TAU', 'STROKE_CONFIG', 'SERVE_WARM',
  'racketForStroke', 'resolveRacketLaunch', 'strokeIdentityMatches', 'strokeFrame', 'resolvedRacketFrame',
  'impactRacket', 'integrateBall', 'tableContact', 'bounceTable', 'netContactStep', 'paddleTableClearance',
]);
const { PH, V3 } = lib;
const SERVES = { SERVE_TOP: .10, SERVE_BACK: .40, SERVE_SIDE: .65, SERVE_FAST: .80, SERVE_NO_SPIN: .95 };

function random(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function serveFixture(level, id, side, direction, verticalBrush, seed, handicap = 1, equipment) {
  const rng = random(seed), ai = new lib.OpponentAI(level);
  ai.side = side; ai.setHandicap(handicap);
  const draws = [SERVES[id], .35 + rng() * .30, .30 + rng() * .40,
    direction < 0 ? .10 : .90, verticalBrush < 0 ? .10 : verticalBrush > 0 ? .90 : .50];
  ai.rng = () => draws.length ? draws.shift() : rng();
  const ball = {
    p: V3.new((rng() * 2 - 1) * .20, PH.TABLE_Y + lib.STROKE_CONFIG.serve.toss.aiContactHeight,
      side * (PH.T_HALF_LEN + .20)),
    v: V3.new((rng() * 2 - 1) * .05, -2.43, (rng() * 2 - 1) * .05),
    w: V3.new(), live: true, lastHitBy: 0,
  };
  const game = { ball, time: 0, strokeTime: 0, equip: { forSide: () => equipment ||
    { e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1 } } };
  return { ai, ball, game };
}

// Independent cloned production loop. Do not reuse AI's path/apex indexing.
function flight(launch) {
  const p = V3.clone(launch.p), v = V3.clone(launch.v), w = V3.clone(launch.w);
  const hit = V3.new(), net = V3.new(), bounces = [];
  let postBounceApex = PH.R, hitNet = false;
  for (let t = 0; t < lib.STROKE_CONFIG.serve.solver.maxT; t += PH.SIM_DT) {
    const previous = V3.clone(p);
    lib.integrateBall(p, v, w, PH.SIM_DT);
    if (bounces.length === 1) postBounceApex = Math.max(postBounceApex, p.y - PH.TABLE_Y);
    if (lib.netContactStep(previous.x, previous.y, previous.z, p.x, p.y, p.z, net)) { hitNet = true; break; }
    if (v.y < 0 && lib.tableContact(previous.x, previous.y, previous.z, p.x, p.y, p.z, hit)) {
      V3.copy(p, hit); p.y += 1e-5;
      bounces.push({ x: hit.x, z: hit.z, t: t + PH.SIM_DT });
      if (bounces.length === 2) break;
      lib.bounceTable(p, v, w);
    }
    if (p.y < .02) break;
  }
  return { bounces, hitNet, postBounceApex };
}

function sameVector(actual, expected, label) {
  for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(actual[axis] - expected[axis]) < 1e-11,
    `${label}.${axis}: ${actual[axis]} != ${expected[axis]}`);
}

function assertLaunch(ball, racket, launch) {
  const v = V3.clone(ball.v), w = V3.clone(ball.w);
  const info = lib.impactRacket(v, w, racket.normal, V3.clone(racket.vR), racket.quality, racket.rubber || {});
  assert.ok(info, 'verified racket must really contact the incoming ball');
  const p = V3.addScaled(V3.clone(ball.p), ball.p, racket.normal, PH.R * lib.STROKE_CONFIG.racket.launchSeparation);
  sameVector(launch.p, p, 'launch p'); sameVector(launch.v, v, 'launch v'); sameVector(launch.w, w, 'launch w');
  sameVector(racket.aiServeDiagnostic.launch.p, p, 'validated p');
  sameVector(racket.aiServeDiagnostic.launch.v, v, 'validated v');
  sameVector(racket.aiServeDiagnostic.launch.w, w, 'validated w');
  const vr = V3.new(), normal = V3.new();
  lib.strokeFrame(racket, 0, 0, 1, vr, normal);
  sameVector(normal, racket.normal, 'resolved normal');
  sameVector(vr, racket.vR, 'resolved racket velocity');
}

test('seed matrix: all five serves, four levels, both sides and signed mixed directions use the exact production launch', t => {
  lib.SERVE_WARM.clear();
  const times = lib.AI_LEVELS.map(() => []), failed = [];
  let cases = 0, valid = 0, seed = 20261101;
  for (let level = 0; level < lib.AI_LEVELS.length; level++) {
    for (const id of Object.keys(SERVES)) for (const side of [-1, 1]) for (const direction of [-1, 1]) {
      for (const brush of id === 'SERVE_SIDE' ? [-.40, 0, .40] : [0]) {
        const { ai, ball, game } = serveFixture(level, id, side, direction, brush, seed++);
        const before = JSON.stringify(ball), originalRefine = lib.context.refineRacket;
        let solves = 0;
        lib.context.refineRacket = (...args) => { solves++; return originalRefine(...args); };
        const start = performance.now();
        let racket;
        try { racket = ai.serve(game); } finally { lib.context.refineRacket = originalRefine; }
        times[level].push(performance.now() - start); cases++;
        const label = `${id}/L${level}/side${side}/dir${direction}/brush${brush}`;
        assert.equal(JSON.stringify(ball), before, `${label}: solving must not mutate live p/v/w`);
        assert.equal(racket.stroke.id, id, `${label}: retries must not switch families`);
        if (id === 'SERVE_SIDE') assert.equal(racket.verticalBrush, brush, `${label}: signed brush retained`);
        assert.equal(ai.stats.shots, 0, `${label}: a solve is not a hit`);
        assert.equal(ai.stats.errors, 0, `${label}: technical failures are not donated errors`);
        assert.equal(racket.aiServeDiagnostic.attempts, solves);
        assert.ok(solves <= lib.AI_SERVE_SOLVES && racket.aiServeDiagnostic.frameTries <= lib.AI_SERVE_FRAME_TRIES);
        if (!racket.valid) {
          assert.equal(racket.invalidReason, racket.aiServeDiagnostic.reason);
          assert.notEqual(racket.invalidReason, 'ok');
          failed.push(`${label}:${racket.invalidReason}`);
          continue;
        }
        valid++;
        const launch = lib.resolveRacketLaunch(ball, racket);
        assert.ok(lib.strokeIdentityMatches(racket, launch), `${label}: actual spin identity`);
        assertLaunch(ball, racket, launch);
        assert.equal(JSON.stringify(ball), before, `${label}: launch remains cloned`);
        assert.ok(racket.vmag <= lib.AI_SERVE_CAPS[level].vmag + 1e-6, `${label}: level cap before impact`);
        const report = flight(launch);
        assert.equal(report.hitNet, false, label);
        assert.equal(report.bounces.length, 2, label);
        assert.ok(report.bounces[0].z * side > lib.AI_SERVE_NET_ROOM, `${label}: own bounce away from net`);
        assert.ok(report.bounces[1].z * side < 0, `${label}: receiver bounce`);
        for (const point of report.bounces) {
          assert.ok(Math.abs(point.x) <= PH.T_HALF_WID + .005 && Math.abs(point.z) <= PH.T_HALF_LEN + .005, label);
        }
        assert.ok(report.postBounceApex <= lib.AI_SERVE_APEX, `${label}: post-own-bounce apex ${report.postBounceApex}`);
        assert.ok(Math.abs(report.postBounceApex - racket.aiServeDiagnostic.postBounceApex) < 1e-11, label);
        if (id === 'SERVE_NO_SPIN') assert.ok(V3.len(launch.w) / lib.TAU < 1, `${label}: no-spin is checked BEFORE table spin`);
        if (id === 'SERVE_SIDE') assert.equal(Math.sign(launch.w.y), side * direction, `${label}: lateral spin direction`);
        const horizontal = Math.hypot(launch.v.x, launch.v.z);
        const top = (launch.w.x * launch.v.z - launch.w.z * launch.v.x) / horizontal;
        if (id === 'SERVE_TOP') assert.ok(top > 0, `${label}: actual topspin, not a donated neutral serve`);
        if (id === 'SERVE_BACK') assert.ok(top < 0, `${label}: actual backspin, not a relabeled topspin fallback`);
        assert.equal(ai.recordHit(ball, racket, launch, game.strokeTime), true);
        assert.equal(ai.telemetry().byStroke[id], 1, `${label}: executed family telemetry`);
      }
    }
  }
  assert.equal(cases, 112);
  assert.ok(valid / cases >= .95, `standard toss valid ${valid}/${cases}; ${failed.join(', ')}`);
  const p95 = times.map(samples => samples.sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1]);
  t.diagnostic(`Seeded Node VM ${valid}/${cases}; p95 ms EASY/MEDIUM/HARD/WTF: ${p95.map(x => x.toFixed(1)).join('/')}`);
  assert.ok(p95.every(ms => ms < 500), `bounded host solver p95: ${p95.join('/')}; not device validation`);
  assert.ok(lib.STROKE_CONFIG.serve.solver.flightBudget <= 70, 'the shared full-solver budget was not inflated');
});

test('no-spin and signed mixed launch identity survives incoming drift, equipment and director pace', () => {
  const equipment = { e: .72, mu: .95, et: .45, damp: .90 };
  for (let level = 0; level < lib.AI_LEVELS.length; level++) {
    for (const [id, brush] of [['SERVE_NO_SPIN', 0], ['SERVE_SIDE', -.40], ['SERVE_SIDE', .40]]) {
      const { ai, ball, game } = serveFixture(level, id, -1, -1, brush, 810 + level, .70, equipment);
      V3.set(ball.v, .08, -2.20, -.07);
      const before = JSON.stringify(ball), racket = ai.serve(game);
      assert.equal(JSON.stringify(ball), before);
      assert.equal(racket.stroke.id, id);
      if (!racket.valid) {
        assert.ok(racket.invalidReason && racket.invalidReason !== 'ok');
        continue;
      }
      const launch = lib.resolveRacketLaunch(ball, racket);
      assert.ok(lib.strokeIdentityMatches(racket, launch), `${id}/L${level}/handicap`);
      assertLaunch(ball, racket, launch);
      assert.ok(flight(launch).postBounceApex <= lib.AI_SERVE_APEX);
    }
  }
});

test('failed same-family search is diagnostic, bounded, mutation-free and never relabeled SERVE_TOP', () => {
  const refine = lib.context.refineRacket, resolve = lib.context.resolveRacketLaunch;
  try {
    for (const id of Object.keys(SERVES)) {
      const calls = [];
      lib.context.refineRacket = (p, v, w, racket) => { calls.push(racket.stroke.id); return { ...racket, valid: true }; };
      lib.context.resolveRacketLaunch = () => null;
      const { ai, ball, game } = serveFixture(2, id, -1, 1, -.40, 67);
      const before = JSON.stringify(ball), racket = ai.serve(game);
      assert.equal(racket.valid, false);
      assert.equal(racket.stroke.id, id);
      assert.equal(racket.invalidReason, 'separating');
      assert.equal(racket.aiServeDiagnostic.reason, 'separating');
      assert.ok(calls.length <= lib.AI_SERVE_SOLVES && calls.every(value => value === id));
      assert.ok(racket.aiServeDiagnostic.frameTries <= lib.AI_SERVE_FRAME_TRIES);
      assert.equal(JSON.stringify(ball), before);
      assert.equal(ai.stats.shots, 0); assert.equal(ai.stats.errors, 0);
      assert.equal(ai.recordHit(ball, racket, null, 0), false);
    }
  } finally { lib.context.refineRacket = refine; lib.context.resolveRacketLaunch = resolve; }
});

test('a physically legal but excessively high no-spin serve is rejected after its first bounce', () => {
  const { ai, ball } = serveFixture(3, 'SERVE_NO_SPIN', -1, 1, 0, 88);
  V3.set(ball.p, 0, PH.TABLE_Y + .36, -(PH.T_HALF_LEN + .20)); V3.set(ball.v, 0, -2.43, 0);
  const prototype = lib.racketForStroke('SERVE_NO_SPIN', { side: -1, ball: ball.p, ballSpin: ball.w, ballVelocity: ball.v });
  const normal = V3.new(0, -Math.sin(.70), Math.cos(.70));
  const vR = V3.addScaled(V3.new(), ball.v, normal, 3.40);
  const racket = lib.resolvedRacketFrame(prototype, normal, vR, { valid: true });
  const report = flight(lib.resolveRacketLaunch(ball, racket));
  assert.equal(report.bounces.length, 2, 'two legal bounces alone are insufficient');
  assert.equal(report.hitNet, false);
  assert.ok(report.postBounceApex > lib.AI_SERVE_APEX);
  assert.equal(ai._serveVerdict(ball, racket).reason, 'post_bounce_apex');
  assert.equal(ai._flightLegal(ball, racket, true), false);
});

test('HOOK and FADE are distinct shared physical frames, not identical shots with different labels', () => {
  for (const id of ['SIDE', 'BANANA', 'CHOP_BLOCK']) assert.ok(lib.AI_BACKSWING[id], `${id}: readable preparation`);
  assert.ok(lib.AI_BACKSWING.BANANA.back < lib.AI_BACKSWING.HOOK.back, 'banana is a compact flick, not a full hook');
  assert.ok(lib.AI_BACKSWING.CHOP_BLOCK.back < lib.AI_BACKSWING.CHOP.back, 'chop block has compact preparation');
  const refine = lib.context.refineRacket;
  lib.context.refineRacket = (p, v, w, racket) => racket;
  try {
    const results = [];
    for (const id of ['HOOK', 'FADE']) {
      const ai = new lib.OpponentAI(2), ball = { p: V3.new(0, PH.TABLE_Y + .30, -1.10),
        v: V3.new(0, -.5, -5), w: V3.new() };
      ai.rng = () => .99; ai.swingAt = 0;
      ai.commit = { archId: id, speed: 7, aim: { x: 0, z: .9 } };
      ai._ensureLegal = (game, racket) => racket;
      const racket = ai.swing({ ball, strokeTime: 0 });
      assert.equal(racket.stroke.id, id);
      results.push({ racket, launch: lib.resolveRacketLaunch(ball, racket) });
    }
    const [hook, fade] = results;
    assert.ok(hook.racket.normal.x * fade.racket.normal.x < 0);
    assert.ok(hook.racket.vR.x * fade.racket.vR.x < 0);
    assert.ok(hook.launch.w.y * fade.launch.w.y < 0, 'actual sidespin must reverse');
    assert.ok(Math.abs(hook.launch.w.y) / lib.TAU > 3 && Math.abs(fade.launch.w.y) / lib.TAU > 3);
  } finally { lib.context.refineRacket = refine; }
});

test('the serve ceiling does not veto an actual high rally LOB', () => {
  const ai = new lib.OpponentAI(2), ball = { p: V3.new(0, PH.TABLE_Y + .36, -1.55),
    v: V3.new(0, -.5, -5.5), w: V3.new() };
  const prototype = lib.racketForStroke('LOB', { side: -1, ball: ball.p, ballVelocity: ball.v, ballSpin: ball.w },
    { vmag: 3.5, quality: .95, aim: { x: 0, z: 1.10 } });
  const racket = lib.context.refineRacket(ball.p, ball.v, ball.w, prototype, 1, prototype.quality);
  const launch = lib.resolveRacketLaunch(ball, racket);
  const report = lib.context.predict(launch.p, launch.v, launch.w,
    { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: {} });
  assert.ok(report.apex - PH.TABLE_Y > lib.AI_SERVE_APEX);
  assert.equal(ai._flightLegal(ball, racket, false), true);
});

test('telemetry records the physically executed fallback, never the first planned family', () => {
  const ai = new lib.OpponentAI(2), ball = { p: V3.new(.1, PH.TABLE_Y + .30, -.9),
    v: V3.new(0, -.5, -5.5), w: V3.new() };
  ai.rng = () => .99; ai.swingAt = 0;
  ai.commit = { archId: 'SMASH', speed: 8, aim: { x: 0, z: .9 } };
  const refine = lib.context.refineRacket;
  lib.context.refineRacket = (p, v, w, racket) => racket;
  ai._ensureLegal = game => lib.racketForStroke('BLOCK', ai._strokeContext(game), { vmag: 1.5, quality: .9 });
  try {
    const racket = ai.swing({ ball, strokeTime: 1 });
    assert.equal(racket.stroke.id, 'BLOCK');
    assert.equal(ai.stats.shots, 0);
    const launch = lib.resolveRacketLaunch(ball, racket);
    assert.equal(ai.recordHit(ball, racket, launch, 1), true);
    assert.equal(ai.lastStrokeId, 'BLOCK');
    assert.equal(ai.telemetry().byStroke.BLOCK, 1);
    assert.equal(ai.telemetry().byStroke.SMASH, undefined);
    assert.equal(ai.strokeHistory[0].archId, 'BLOCK');
    assert.equal(ai.aggrStreak, 0, 'defensive executed fallback breaks the attack streak');
    assert.equal(ai.stats.sumOut, V3.len(launch.v));
  } finally { lib.context.refineRacket = refine; }
});

test('AI target/center uses one shared geometry-safe pose and permits genuinely outside low recovery', () => {
  const ai = new lib.OpponentAI(0);
  assert.equal(ai.grip, 'shakehand'); assert.ok(ai.roll > 0);
  assert.ok(ai.home.y <= PH.TABLE_Y + .20 + 1e-9, 'readable low resting grip');
  const plan = { x: 0, y: PH.TABLE_Y - .04, z: -1.10, t: 1, speed: 5, errUnitX: 0, errUnitY: 0 };
  const game = { ball: { p: V3.new(0, PH.TABLE_Y + .3, -.8), v: V3.new(0, 0, -5),
    w: V3.new(), live: true, lastHitBy: 1 }, ai, aiPaddle: { normal: ai.faceNormal, roll: ai.roll },
    time: 0, strokeTime: 0, shotId: 1, netTouched: false, rally: 1 };
  const target = ai.noisyTarget(plan, game);
  assert.ok(lib.paddleTableClearance(target, ai.faceNormal, ai.roll) >= .0059);
  const outsidePlan = { ...plan, z: -(PH.T_HALF_LEN + .15) + .055 };
  const outside = ai.noisyTarget(outsidePlan, game);
  assert.equal(lib.paddleTableClearance(outside, ai.faceNormal, ai.roll), Infinity, 'actual mesh footprint is outside');
  assert.equal(outside.y, plan.y, 'outside recovery must not receive a phantom table lift');
  V3.copy(ai.pos, outside); V3.copy(ai._moveSmooth, outside);
  ai.seenBallId = 1; ai.phase = 'READY'; ai.plan = plan;
  const position = ai.pos;
  for (let i = 0; i < 40; i++) {
    ai.think(game, 1 / 60); game.strokeTime += 1 / 60;
    assert.equal(ai.pos, position, 'do not allocate a separate rendered center');
    assert.ok(lib.paddleTableClearance(ai.pos, ai.faceNormal, ai.roll) >= -1e-6, 'moving mesh never penetrates tabletop');
  }
});
