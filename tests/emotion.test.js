const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

function fixture() {
  const lib = load(['10_math.js', '76_emotion.js'], ['EmotionalSystem', 'EMOTION_STATE', 'V3'],
    { GS: { RALLY: 'RALLY' } });
  const messages = [];
  const game = {
    server: 1,
    settings: { targetScore: 11, haptics: false },
    music: null,
    hitFlash: 0,
    msg(...args) { messages.push(args); },
  };
  return { ...lib, game, messages, emotion: new lib.EmotionalSystem(game) };
}

function state(overrides = {}) {
  return {
    state: 'RALLY', rally: 0, ball: { v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 } },
    score: [3, 3], settings: { targetScore: 11, haptics: false },
    momentum: { current: 0 }, lastPoint: null, lastShotInfo: null,
    netTouched: false, server: 1, time: 3,
    ...overrides,
  };
}

test('match-point emotion reads the live game rather than an out-of-scope snapshot', () => {
  const { game, messages, emotion, EMOTION_STATE } = fixture();
  emotion.update(state({ score: [10, 8] }));
  assert.equal(messages.length, 1);
  assert.match(messages[0][0], /ВАША ПОДАЧА/);
  assert.equal(emotion.state, EMOTION_STATE.CLIMAX);
});

test('big-moment feedback updates the live game and safely sends its message', () => {
  const { game, messages, emotion } = fixture();
  emotion.update(state({ time: 3, lastShotInfo: { speed: 90 } }));
  assert.equal(game.hitFlash, 0.3);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 'ОЧКО!');
});

test('net-cord feedback applies its flash and message to the live game', () => {
  const { game, messages, emotion } = fixture();
  emotion.update(state({ time: 3, netTouched: true }));
  assert.equal(game.hitFlash, 0.2);
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0], 'СЕТКА!');
});
