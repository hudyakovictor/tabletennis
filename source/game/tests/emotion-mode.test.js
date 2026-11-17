'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { EmotionalSystem } = load(['10_math.js', '76_emotion.js'], ['EmotionalSystem']);

test('match-point cues are limited to scored matches, including after switching modes', () => {
  let buzzes = 0;
  const g = { score: [10, 8], settings: { targetScore: 11 }, training: null, demoMode: false, freePlay: false,
    buzz() { buzzes++; } };
  const emotions = new EmotionalSystem(g);
  emotions._computeIntensity = () => 0;
  emotions._detectBigMoments = () => {};
  emotions._determineState = () => 'neutral';
  for (const mode of [{ training: {} }, { demoMode: true }, { freePlay: true }]) {
    Object.assign(g, { training: null, demoMode: false, freePlay: false }, mode);
    emotions.update(g);
    assert.equal(buzzes, 0, JSON.stringify(mode));
    assert.equal(emotions.matchPointTriggered, false);
  }
  Object.assign(g, { training: null, demoMode: false, freePlay: false });
  emotions.update(g); emotions.update(g);
  assert.equal(buzzes, 1, 'a real match point triggers once');
  g.training = {}; emotions.update(g);
  assert.equal(emotions.matchPointTriggered, false, 'leaving a match clears its cue');
});
