'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { Game, Trainer, GS, PH, V3, Q, setCaptureForgiveness, getCaptureForgiveness } = load(
  ['10_math.js', '12_match_rules.js', '30_physics.js', '40_swipe.js', '70_game.js', '65_train.js'],
  ['Game', 'Trainer', 'GS', 'PH', 'V3', 'Q', 'setCaptureForgiveness', 'getCaptureForgiveness'], { CAMERA_ORDER: ['BROADCAST'] });

for (const scenario of [
  { name: 'enter practice after a match', baseline: 1, stage: 'practice', expected: 1.25, action: 'configureHelp' },
  { name: 'enter check after practice', baseline: 1.25, stage: 'check', expected: 1, action: 'configureHelp' },
  { name: 'leave training', baseline: 1.25, stage: 'practice', expected: 1, action: 'restoreHelp' },
]) test(`net-cord bonus is cleared when we ${scenario.name}`, () => {
  const g = Object.create(Game.prototype);
  Object.assign(g, { time: 5, _cordForgiveUntil: 5.9, _cordBaseForgive: scenario.baseline,
    ball: { live: false }, setSlowmoAllowed() {} });
  const trainer = Object.create(Trainer.prototype);
  Object.assign(trainer, { g, stage: scenario.stage, custom: { sparring: false } });
  setCaptureForgiveness(scenario.baseline * 1.5);
  try {
    trainer[scenario.action]();
    assert.equal(getCaptureForgiveness(), scenario.expected);
    assert.equal(g._cordForgiveUntil, 0);
    g.time = 6;
    g.stepPhysics(1 / 240);
    assert.equal(getCaptureForgiveness(), scenario.expected, 'old timeout must not restore the previous mode');
  } finally { setCaptureForgiveness(1); }
});

test('starting a match does not restore an old training capture setting in prepServe', () => {
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    time: 5, _cordForgiveUntil: 5.9, _cordBaseForgive: 1.25,
    network: { isInMatch: false }, career: { active: false }, sessionKind: 'ranked',
    moments: { reset() {} }, followThrough: {}, anticipation: {},
    audio: { stopAudience() {}, init() {}, resume() {} },
    settings: { camera: 'BROADCAST', difficulty: 1, adaptive: false },
    messages: [], slowmo: {}, ai: { reset() {}, setTrend() {} },
    analyst: { reset() {} }, director: { reset() {} },
    setSessionKind(k) { this.sessionKind = k; }, endReplay() {}, resetPaddle() {},
    trendFromHistory() { return 0; }, setSlowmoAllowed() {}, msg() {},
    // prepServe invokes the real cancellation helper before starting a point.
    prepServe() { this.clearCordCaptureBoost(); },
  });
  setCaptureForgiveness(1.875);
  try {
    g.startMatch();
    assert.equal(getCaptureForgiveness(), 1);
    assert.equal(g._cordForgiveUntil, 0);
  } finally { setCaptureForgiveness(1); }
});

for (const scenario of [
  { stage: 'practice', adaptive: false, helpLevel: 'guided', expected: 1.25 },
  { stage: 'practice', adaptive: true, helpLevel: 'guided', expected: 1.25 },
  { stage: 'practice', adaptive: true, helpLevel: 'ring', expected: 1.25 },
  { stage: 'practice', adaptive: true, helpLevel: 'independent', expected: 1 },
  { stage: 'check', adaptive: false, helpLevel: 'guided', expected: 1 },
  { stage: 'check', adaptive: true, helpLevel: 'guided', expected: 1 },
]) test(`real net-tape collisions never boost training capture: ${scenario.stage}/${scenario.adaptive}/${scenario.helpLevel}`, () => {
  const g = Object.create(Game.prototype), events = [];
  Object.assign(g, { time: 5, state: GS.RALLY, _cordForgiveUntil: 0, _cordBaseForgive: 1,
    ball: { live: true, p: V3.new(), v: V3.new(), w: V3.new(), q: Q.new(), lastHitBy: 1 },
    player: { lastHitT: 5 }, settings: { hint: true, showTrail: false }, rallyBounces: [],
    audio: { hitNet() {} }, moments: { addBounce() {} },
    msg() {}, emitParticles() {}, buzz() {}, tryPlayerHit() {}, setSlowmoAllowed() {} });
  const trainer = Object.create(Trainer.prototype);
  Object.assign(trainer, { g, phase: 'live', stage: scenario.stage, adaptive: scenario.adaptive,
    helpLevel: scenario.helpLevel, custom: { sparring: false, coach: 'ring' }, recordEvent(type, data) { events.push({ type, ...data }); } });
  g.training = trainer;
  setCaptureForgiveness(1);
  try {
    trainer.configureHelp(); assert.equal(getCaptureForgiveness(), scenario.expected);
    for (let i = 0; i < 2; i++) {
      V3.set(g.ball.p, 0, PH.NET_TOP + .003, .005); V3.set(g.ball.v, 0, 0, -6); V3.zero(g.ball.w);
      g.ball.live = true; g.time += .1; g.stepPhysics(PH.SIM_DT);
      assert.equal(events.at(-1).type, 'net'); assert.equal(events.at(-1).tape, true, 'must exercise the actual tape collision branch');
      assert.equal(g.netTouched, true); assert.equal(g._cordForgiveUntil, 0);
      assert.equal(getCaptureForgiveness(), scenario.expected); assert.ok(getCaptureForgiveness() <= 1.25);
    }
    g.ball.live = false; g.time += 2; g.stepPhysics(PH.SIM_DT);
    assert.equal(getCaptureForgiveness(), scenario.expected, 'no stale net-cord timer may restore extra assistance');
  } finally { setCaptureForgiveness(1); }
});

test('the non-training net-cord bonus still applies once and restores its original baseline', () => {
  const g = Object.create(Game.prototype);
  Object.assign(g, { time: 5, state: GS.RALLY, training: null,
    ball: { live: true, p: V3.new(), v: V3.new(), w: V3.new(), q: Q.new(), lastHitBy: -1 },
    player: { lastHitT: 5 }, settings: { showTrail: false },
    audio: { hitNet() {} }, moments: { addBounce() {} }, msg() {}, emitParticles() {}, buzz() {}, tryPlayerHit() {} });
  setCaptureForgiveness(1);
  try {
    for (let i = 0; i < 2; i++) {
      V3.set(g.ball.p, 0, PH.NET_TOP + .003, .005); V3.set(g.ball.v, 0, 0, -6); V3.zero(g.ball.w);
      g.time += .1; g.stepPhysics(PH.SIM_DT);
      assert.equal(g.netTouched, true); assert.equal(getCaptureForgiveness(), 1.5); assert.equal(g._cordBaseForgive, 1);
    }
    g.ball.live = false; g.time = g._cordForgiveUntil + .01; g.stepPhysics(PH.SIM_DT);
    assert.equal(getCaptureForgiveness(), 1); assert.equal(g._cordForgiveUntil, 0);
  } finally { setCaptureForgiveness(1); }
});
