/* MatchDirector used to cap its rescue at 0.86 no matter how deep the rout
 * ran — eight lost points in a row against a much stronger bot still left
 * the handicap at 0.86. The window now BREATHES with the streak: −4 keeps
 * the old floor, every further lost point digs ~0.04 deeper down to 0.70.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '58_coach.js'], ['MatchDirector']);

test('a losing streak escalates the rescue past the old 0.86 floor', () => {
  const d = new lib.MatchDirector();
  const seen = [];
  for (let i = 0; i < 10; i++) seen.push(d.onPoint(-1, 0));
  // monotonically deeper while the rout runs
  for (let i = 5; i < seen.length; i++) assert.ok(seen[i] <= seen[i - 1] + 1e-9, `recovered during a rout: ${seen}`);
  assert.ok(seen[3] > 0.83 && seen[3] < 0.95, `4 losses: ${seen[3]}`);          // the old floor neighbourhood
  assert.ok(seen[9] <= 0.76, `10 straight losses must dig well past 0.86, got ${seen[9]}`);
  assert.ok(seen[9] >= 0.66, `the dive must still bottom out, got ${seen[9]}`);
});

test('a hot streak hardens the opponent instead of throwing the match', () => {
  const d = new lib.MatchDirector();
  let h = 1;
  for (let i = 0; i < 10; i++) h = d.onPoint(1, 0);
  assert.ok(h > 1.0 && h <= 1.06, `hot streak: ${h}`);
});

test('legend and a disabled director are never steered', () => {
  const legend = new lib.MatchDirector();
  for (let i = 0; i < 10; i++) assert.equal(legend.onPoint(-1, 4), 1);
  const off = new lib.MatchDirector();
  off.enabled = false;
  for (let i = 0; i < 10; i++) assert.equal(off.onPoint(-1, 0), 1);
});

test('the rescue lets go once the player starts trading points again', () => {
  const d = new lib.MatchDirector();
  for (let i = 0; i < 8; i++) d.onPoint(-1, 0);
  const deep = d.handicap;
  assert.ok(deep < 0.8, `rout floor: ${deep}`);
  for (let i = 0; i < 8; i++) d.onPoint(1, 0);
  assert.ok(d.handicap > deep, 'winning points must relax the handicap back');
});
