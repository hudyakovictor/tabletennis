'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { Game, Trainer, setCaptureForgiveness, getCaptureForgiveness } = load(
  ['10_math.js', '12_match_rules.js', '30_physics.js', '40_swipe.js', '70_game.js', '65_train.js'],
  ['Game', 'Trainer', 'setCaptureForgiveness', 'getCaptureForgiveness'], { CAMERA_ORDER: ['BROADCAST'] });

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
