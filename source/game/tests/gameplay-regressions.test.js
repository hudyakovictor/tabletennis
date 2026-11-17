'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '40_swipe.js', '55_ai.js', '59_replay.js', '70_game.js'],
  ['V3', 'Q', 'PH', 'Stamina', 'predict', 'OpponentAI', 'PaddleStrokeMotion', 'paddleContactPose', 'MomentPlayer', 'Game', 'GS',
    'resolveRacketLaunch', 'resolvedRacketFrame', 'strokeIdentityMatches']);
const { V3, PH } = lib;

test('reused trajectory output does not report an earlier net or edge collision', () => {
  const out = {};
  lib.predict(V3.new(0, PH.TABLE_Y + .06, .1), V3.new(0, 0, -4), V3.new(), { out });
  assert.equal(out.hitNet, true);
  assert.ok(out.netKind > 0);
  out.edgeBounce = { x: 99 };
  lib.predict(V3.new(0, PH.TABLE_Y + 1, .7), V3.new(0, 1, 0), V3.new(), { maxT: .01, out });
  assert.equal(out.hitNet, false);
  assert.equal(out.netKind, null);
  assert.equal(out.edgeBounce, null);
  assert.equal(out.edge, 0);
});

test('invalid predictor time steps cannot trap the game in an infinite loop', () => {
  for (const dt of [-1, NaN, Infinity, 0]) {
    const result = lib.predict(V3.new(0, 2, 1), V3.new(), V3.new(), { dt, maxT: .02 });
    assert.ok(Number.isFinite(result.endT) && result.endT >= .02 && result.endT < .03);
  }
});

test('AI constructor normalizes difficulty exactly like a later level change', () => {
  for (const [value, expected] of [['2', 2], [1.6, 2], [NaN, 0], [Infinity, 0], [-4, 0], [100, 3]]) {
    const ai = new lib.OpponentAI(value);
    assert.equal(ai.levelIndex, expected);
    assert.ok(Number.isFinite(ai.maxSpeed));
  }
});

for (const scenario of ['invalid solve is a paid whiff', 'valid execution error still contacts', 'reversed short ball is returned']) {
  test(`AI contact pipeline: ${scenario}`, () => {
    const invalid = scenario === 'invalid solve is a paid whiff', reversed = scenario === 'reversed short ball is returned';
    const ai = new lib.OpponentAI(reversed ? 3 : 0), g = Object.create(lib.Game.prototype);
    ai.rng = () => .99;
    const ball = { p: V3.new(.15, invalid ? .8 : 1.06, invalid ? -.2 : -.9),
      v: V3.new(0, invalid ? .2 : -.5, invalid ? -2 : -5.5), w: V3.new(invalid ? 500 : 0, 0, invalid ? 0 : 30),
      q: lib.Q.new(), live: true, lastHitBy: 1 };
    V3.set(ai.pos, .15, invalid ? 1 : 1.06, invalid ? -.3 : -1);
    Object.assign(g, {
      ai, ball, time: 1, strokeTime: 1, state: lib.GS.RALLY, shotId: 1, rally: 1,
      isServeBall: false, rallyBounces: [-1], netTouched: false, network: { isInMatch: false },
      player: { pos: V3.new(.2, PH.TABLE_Y, 1.15) },
      aiPaddle: { pos: V3.clone(ai.pos), normal: V3.clone(ai.faceNormal), q: lib.Q.new(), roll: ai.roll },
      _matchId: 'ai-contact-regression', _rallyId: 1, _swingId: 0, _hudEventId: 0,
      _matchContacts: [null, null], _matchWhiffs: [null, null],
      stamina: [lib.Stamina.fresh(), lib.Stamina.fresh()], stats: {}, settings: { targetScore: 11 },
      audio: { onRallyHit() {}, hitRacket() {}, whoosh() {} }, recorder: { addShot() {} }, moments: { addContact() {} },
      _recordContactFlash() {}, _syncMatchHud() {}, shakeIt() {},
    });
    ai.plan = ai.commit = { archId: 'DRIVE', speed: V3.len(ball.v), aim: { x: 0, z: 1 } };
    ai.swingAt = g.strokeTime;
    let racket, incoming;
    const swing = ai.swing;
    ai.swing = function (game, budget) {
      incoming = { p: V3.clone(ball.p), v: V3.clone(ball.v), w: V3.clone(ball.w) };
      racket = swing.call(this, game, budget);
      if (!invalid && !reversed && racket) {
        assert.notEqual(racket.valid, false, 'the unperturbed real solve must be valid');
        // Force the same physical net-error perturbation without changing the planning RNG.
        racket = lib.resolvedRacketFrame(racket, lib.OpponentAI._pitchFace(racket.normal, 14.3),
          V3.mul(V3.new(), racket.vR, .78), { aiError: 'net' });
      }
      if (reversed && racket) {
        assert.ok(ball.v.z > .02 && ball.p.z > ai.pos.z + .08, 'exercise the removed reversed-ball veto');
        assert.ok(V3.dist(ball.p, ai.pos) < .42, 'contact is physically within reach');
      }
      return racket;
    };
    const before = JSON.stringify(ball);
    if (reversed) {
      V3.set(ball.p, .1, 1.01, -.25); V3.set(ball.v, .05, .5, .3); V3.zero(ball.w);
      V3.set(ai.pos, .1, 1.01, -.55); V3.copy(ai._moveSmooth, ai.pos); V3.copy(ai.lastPos, ai.pos);
      ai.plan = ai.commit = null;
      g.time = 100; g.strokeTime = 10;
      for (let i = 0; i < 80 && ball.lastHitBy === 1; i++) {
        const flight = lib.predict(ball.p, ball.v, ball.w, { dt: PH.SIM_DT, maxT: 1 / 120 - 1e-9, stopOnFirstBounce: true });
        assert.equal(flight.landed, null, 'return must precede the second own-court bounce');
        V3.copy(ball.p, flight.end); V3.copy(ball.v, flight.endV); V3.copy(ball.w, flight.endW);
        g.time += flight.endT; g.strokeTime += flight.endT;
        ai.think(g, 1 / 120); g.updateOpponentPose(1 / 120); g.tryAiHit();
      }
      assert.ok(g.strokeTime >= 10 + ai.L.react, 'the real level reaction delay is respected');
    } else g.tryAiHit();
    assert.ok(racket && incoming, 'the game calls the real swing');
    assert.ok(g._aiWork.paid > 0);
    assert.ok(Math.abs(g.stamina[1].energy - (100 - g._aiWork.paid)) < 1e-9, 'the swing is charged exactly once');
    assert.equal(g.stamina[0].energy, 100);
    const launch = lib.resolveRacketLaunch(incoming, racket);
    assert.ok(launch && lib.paddleContactPose(incoming.p, racket, { roll: ai.roll }), 'the frame is physically contactable');
    assert.equal(lib.strokeIdentityMatches(racket, launch), true);
    if (invalid) {
      assert.equal(racket.valid, false); assert.equal(racket.invalidReason, 'unreturnable');
      assert.equal(racket.aiError, undefined);
      assert.equal(JSON.stringify(ball), before, 'a rejected solve cannot mutate the live ball');
      assert.equal(g.stats.aiShots || 0, 0); assert.equal(ai.stats.shots, 0);
      assert.equal(g._aiWork.finished, true); assert.ok(g._matchWhiffs[1]);
      assert.equal(g._matchContacts[1], null);
    } else {
      assert.notEqual(racket.valid, false); assert.equal(ball.lastHitBy, -1);
      assert.equal(g.stats.aiShots, 1); assert.equal(ai.stats.shots, 1); assert.equal(g.shotId, 2);
      assert.equal(g._aiWork.contacted, true); assert.equal(g._matchWhiffs[1], null); assert.ok(g._matchContacts[1]);
      const flight = lib.predict(ball.p, ball.v, ball.w, { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true });
      if (reversed) { assert.equal(flight.hitNet, false); assert.ok(flight.landed && flight.landed.z > 0); }
      else { assert.equal(racket.aiError, 'net'); assert.ok(flight.hitNet || !flight.landed || flight.landed.z < 0); }
    }
    const paid = JSON.stringify(g.stamina);
    g.tryAiHit();
    assert.equal(JSON.stringify(g.stamina), paid, 'repeated contact checks cannot charge the same swing twice');
  });
}

test('disabled follow-through is honored for an actual template-backed contact', () => {
  for (const stroke of ['DRIVE', 'CHOP', 'SERVE_TOP']) {
    const normal = V3.new(0, 0, -1), racket = { normal, vR: V3.new(0, 0, -4) };
    const pose = lib.paddleContactPose(V3.new(0, PH.TABLE_Y + .4, 1.5), racket, { roll: .28 });
    assert.ok(pose);
    const motion = new lib.PaddleStrokeMotion();
    motion.contact(normal, pose.roll, stroke, 'shakehand', 'right', true, false, { pose, racket, side: 1 });
    assert.equal(motion.templateMotion, null);
    const ready = { yaw: 0, pitch: 0, roll: .28 };
    assert.equal(motion.sample(0, ready).stage, 'contact');
    assert.notEqual(motion.sample(motion.profile.hold + .001, ready).stage, 'follow');
  }
});

test('replay draws recorded faces rather than stale live quaternions', () => {
  const frames = new Float32Array(32);
  for (let i = 0; i < 2; i++) { frames[i * 16 + 8] = -1; frames[i * 16 + 14] = 1; frames[i * 16 + 15] = .3; }
  const player = new lib.MomentPlayer();
  const g = { ball: { p: V3.new(), v: V3.new(), w: V3.new(), hist: [] },
    player: { pos: V3.new(), normal: V3.new(), poseReady: true },
    aiPaddle: { pos: V3.new(), normal: V3.new(), poseReady: true }, ai: { pos: V3.new() } };
  assert.equal(player.play({ frames, hz: 30, poseVersion: 2 }, 1), true);
  player.update(.01, g);
  assert.equal(g.player.poseReady, false);
  assert.equal(g.aiPaddle.poseReady, false);
  assert.equal(g.player.normal.z, -1);
  assert.equal(g.aiPaddle.normal.z, 1);
});

test('invalid replay cannot make the live ball appear or change slow motion', () => {
  const g = Object.create(lib.Game.prototype);
  let changed = 0;
  Object.assign(g, { replayer: new lib.MomentPlayer(), ball: { live: false }, setSlowmoHold() { changed++; } });
  assert.equal(g.watchMoment({ frames: new Float32Array() }, false), false);
  assert.equal(g.ball.live, false);
  assert.equal(changed, 0);
});

test('table collision rejection is actually logged once per gesture', () => {
  const g = Object.create(lib.Game.prototype), log = [];
  Object.assign(g, { shotId: 7, swipe: { gestureId: 11 }, ball: { lastHitBy: -1 }, rallyBounces: [1],
    logInput(type, event) { log.push({ type, event }); return event; } });
  g.logPressRejection('RACKET_TABLE_COLLISION');
  g.logPressRejection('RACKET_TABLE_COLLISION');
  assert.equal(log.length, 1);
  assert.equal(log[0].event.outcome.reason, 'RACKET_TABLE_COLLISION');
});
