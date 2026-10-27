/* The opponent used to never miss on its own: AI_LEVELS shipped errBase and
 * errPress knobs and NOTHING read them, so "НОВИЧОК с 0.38" reached playing
 * as "бот достаёт всё". These tests pin the contract of the execution error:
 *
 *   1. errBase is the rally error rate, errPress piles on under scoreboard
 *      pressure, a serve rolls a third of the base rate.
 *   2. A committed error REALLY misses — the same impactRacket + predict
 *      pipeline the game runs proves the ball nets, sails or dies.
 *   3. Легенда barely errs (3 %), and a low director handicap widens every
 *      rate instead of being dead code too.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['10_math.js', '30_physics.js', '55_ai.js'],
  ['OpponentAI', 'AI_LEVELS', 'PH', 'V3', 'impactRacket', 'predict']);
const { PH, V3 } = lib;

function fixtureGame() {
  return { ball: { p: V3.new(0.15, PH.TABLE_Y + 0.30, -0.90), v: V3.new(0, -0.5, -5.5), w: V3.new(0, 0, 30) } };
}
function goodRacket() {
  // a solved-looking racket: measured through impactRacket+predict to clear
  // the net and land mid-court (z ≈ 0.88) on this fixture ball
  const n = V3.new(0, 0.12, 1);
  const l = V3.len(n);
  return { side: -1, normal: V3.new(n.x / l, n.y / l, n.z / l),
    vR: V3.new(0, 0.4, 1.0), quality: 0.9, valid: true };
}
function flightFaults(rk, game, isServe) {
  const v = V3.clone(game.ball.v), w = V3.clone(game.ball.w);
  lib.impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
  const p = V3.addScaled(V3.clone(game.ball.p), game.ball.p, rk.normal, PH.R * 1.05);
  const o = lib.predict(p, v, w, { dt: 1 / 240, maxT: 2.4, stopAfterBounces: 2, out: {} });
  if (o.diverged) return true;
  if (isServe) return o.hitNet || !o.landed || o.landed.z >= 0 ||
    !o.b2 || o.b2.z < 0 || o.b2.z > PH.T_HALF_LEN + 0.005 || Math.abs(o.b2.x) > PH.T_HALF_WID + 0.005;
  return o.hitNet || !o.landed || o.landed.z < 0 ||
    o.landed.z > PH.T_HALF_LEN + 0.005 || Math.abs(o.landed.x) > PH.T_HALF_WID + 0.005;
}
/* The vm sandbox has its OWN Math realm, so stubbing Math.random outside
 * never reaches the code under test — OpponentAI takes the injector instead. */
function withRandom(seq, fn) {
  const draw = () => (seq.length ? seq.shift() : 0.5);
  return fn(draw);
}
function rig(ai, seq) { let i = 0; ai.rng = () => (i < seq.length ? seq[i++] : 0.5); }


test('the fixture is honest: the unperturbed racket is a legal ball', () => {
  const g = fixtureGame();
  assert.equal(flightFaults(goodRacket(), g, false), false, 'base racket must land in');
});

test('errBase is read: a rookie errs when the roll is inside the rate and never outside it', () => {
  const ai = new lib.OpponentAI(0);                     // errBase 0.38
  const g = fixtureGame(), rk = goodRacket();
  const miss = (rig(ai, [0.20, 0.30]), ai.applyExecutionError(g, rk, false));
  assert.notEqual(miss, rk, 'roll 0.20 < 0.38 must commit an error');
  assert.equal(miss.aiError, 'net');                    // second roll 0.30 < 0.55 → into the net
  assert.equal(ai.stats.errors, 1);
  assert.equal(flightFaults(miss, g, false), true, 'a committed error must REALLY miss');
  assert.ok(Math.abs(V3.len(miss.normal) - 1) < 1e-6, 'perturbed face stays a unit vector');
  const ai2 = new lib.OpponentAI(0);
  const clean = goodRacket();
  const same = (rig(ai2, [0.90]), ai2.applyExecutionError(g, clean, false));
  assert.equal(same, clean, 'roll 0.90 ≥ 0.38 keeps the solved shot');
  assert.equal(ai2.stats.errors, 0);
});

test('both error flavours fault: face closed + dead arm nets, open face + hot arm sails', () => {
  for (const [roll, want] of [[0.30, 'net'], [0.90, 'long']]) {
    const ai = new lib.OpponentAI(1);
    const g = fixtureGame(), rk = goodRacket();
    const miss = (rig(ai, [0.10, roll]), ai.applyExecutionError(g, rk, false));
    assert.equal(miss.aiError, want, `kind roll ${roll}`);
    assert.equal(flightFaults(miss, g, false), true, `${want} error survived the flight check`);
  }
});

test('a serve rolls a THIRD of the base rate, and WTF barely errs', () => {
  const ai = new lib.OpponentAI(0);                     // serve rate = 0.38/3 ≈ 0.1267
  const g = fixtureGame();
  const noMiss = (rig(ai, [0.20]), ai.applyExecutionError(g, goodRacket(), true));
  assert.ok(!noMiss.aiError, 'roll 0.20 must not fault a serve (rate ≈ 0.127)');
  const miss = (rig(ai, [0.10, 0.30]), ai.applyExecutionError(g, goodRacket(), true));
  assert.equal(miss.aiError, 'net', 'roll 0.10 < 0.127 faults the serve');
  assert.equal(flightFaults(miss, g, true), true, 'a serve error is a serve fault by the rules');

  const wtf = new lib.OpponentAI(3);                    // WTF: errBase 0.017
  const cleanL = goodRacket();
  const safe = (rig(wtf, [0.10]), wtf.applyExecutionError(g, cleanL, false));
  assert.equal(safe, cleanL, 'WTF ignores a roll that would beat a rookie');
  const rare = (rig(wtf, [0.01, 0.30]), wtf.applyExecutionError(g, goodRacket(), false));
  assert.equal(rare.aiError, 'net', 'WTF errs only inside 2 %');
});

test('scoreboard pressure and the director handicap widen the rate', () => {
  const g = fixtureGame();
  const calm = new lib.OpponentAI(0);
  calm.pressure = 0; calm.handicap = 1;
  const kept = (rig(calm, [0.40]), calm.applyExecutionError(g, goodRacket(), false));
  assert.ok(!kept.aiError, 'roll 0.40 is outside 0.38 when calm');
  const pressed = new lib.OpponentAI(0);
  pressed.pressure = 1;                                  // +errPress 0.16 → 0.54
  const cracked = (rig(pressed, [0.40, 0.30]), pressed.applyExecutionError(g, goodRacket(), false));
  assert.equal(cracked.aiError, 'net', 'pressure turns roll 0.40 into an error');
  const rescued = new lib.OpponentAI(0);
  rescued.handicap = 0.70;                               // director rescue → /0.70 ≈ 0.543
  const shaky = (rig(rescued, [0.45, 0.30]), rescued.applyExecutionError(g, goodRacket(), false));
  assert.equal(shaky.aiError, 'net', 'a director rescue also plays through the error rate');
});
