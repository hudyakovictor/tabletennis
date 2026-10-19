const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
function careerFixture() {
  const lib = load(['10_math.js', '25_career.js'], ['Career', 'PERKS', 'TOURNAMENTS']);
  const game = { settings: { assist: .6, posAssist: .7, difficulty: 2 },
    ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [11, 5], stats: { maxSpeed: 80 } };
  const c = new lib.Career(game); c.start();
  return { ...lib, game, c };
}
test('career restores the exact remaining bracket and round', () => {
  const { c, game, Career } = careerFixture();
  c.readyForOpponentSelect(); c.selectOpponent(1); c.onMatchEnd(1); c.save();
  const bracket = JSON.stringify(c.opponents);
  const restored = new Career(game);
  assert.equal(restored.load(), true);
  assert.equal(restored.currentRound, 1);
  assert.equal(JSON.stringify(restored.opponents), bracket);
});
test('career settings do not accumulate on repeated load', () => {
  const { c, PERKS, game } = careerFixture();
  const perk = PERKS.find(p => p.id === 'heavy_spin');
  c.perks.push(perk); perk.apply(game); c.save();
  const assist = game.settings.assist;
  const spin = game._careerSpinBoost;
  assert.equal(c.load(), true); assert.equal(game.settings.assist, assist); assert.equal(game._careerSpinBoost, spin);
  assert.equal(c.load(), true); assert.equal(game.settings.assist, assist); assert.equal(game._careerSpinBoost, spin);
});
test('leaving career removes all bonuses and restores preferences', () => {
  const { c, game, PERKS } = careerFixture();
  PERKS.find(p => p.id === 'heavy_spin').apply(game); game._careerNetSafe = true;
  c.stop(); assert.equal(game.settings.assist, .6); assert.equal(game._careerNetSafe, false);
  assert.equal(c.active, false);
});
test('career terminal save is deleted rather than resurrected', () => {
  const { c, saved } = careerFixture(); c.state = 'RUN_END'; c.save();
  assert.equal(saved.has('topspin_career'), false); assert.equal(c.load(), false);
});
test('career completed tournament resumes at the next-transition checkpoint', () => {
  const { c } = careerFixture(); c.currentRound = 3; c.opponents = []; c.state = 'TOURNAMENT_END'; c.save();
  assert.equal(c.load(), true); assert.equal(c.state, 'TOURNAMENT_END');
  c.advanceTournament(); assert.equal(c.currentTournament, 1); c.advanceTournament(); assert.equal(c.currentTournament, 1);
});
test('pending perk choice survives reload without re-rolling', () => {
  const { c, PERKS } = careerFixture(); c.currentTournament = 1; c.enterTournament();
  c.state = 'PERK_SELECT'; c.pendingPerks = PERKS.slice(0, 3); c.save();
  assert.equal(c.load(), true); assert.equal(c.state, 'PERK_SELECT');
  assert.equal(c.pendingPerks.map(p => p.id).join(), PERKS.slice(0, 3).map(p => p.id).join());
});
test('career invalid selections and repeated match end are harmless', () => {
  const { c } = careerFixture(); c.selectOpponent(0); assert.equal(c.state, 'TOURNAMENT_INTRO');
  c.readyForOpponentSelect(); c.selectOpponent(.5); assert.equal(c.state, 'OPPONENT_SELECT');
  c.selectOpponent(0); c.onMatchEnd(1); c.onMatchEnd(1); assert.equal(c.totalWins, 1);
});
for (const raw of ['null', '[]', '{"currentTournament":999,"currentRound":0}', '{"currentTournament":0,"currentRound":-1}',
  '{"currentTournament":0,"currentRound":0,"perks":{},"v":2,"opponents":[]}']) {
  test('reject corrupt career save: ' + raw, () => {
    const { c, saved } = careerFixture(); saved.set('topspin_career', raw);
    assert.equal(c.load(), false);
  });
}
test('cancelling a swipe never reuses the previous released stroke', () => {
  const { SwipeTracker } = load(['10_math.js', '30_physics.js', '40_swipe.js'], ['SwipeTracker']);
  const s = new SwipeTracker(); s.down(.5, .8, 1); s.up(.5, .4, 1.15); assert.ok(s.lastReleased);
  s.down(.5, .7, 2); s.cancel(); assert.equal(s.active, false); assert.equal(s.lastReleased, null);
});
test('a click with no travel cannot pass the stroke gate', () => {
  const { SwipeTracker, isRealStroke } = load(
    ['10_math.js', '30_physics.js', '40_swipe.js'], ['SwipeTracker', 'isRealStroke']);
  const s = new SwipeTracker();
  s.down(.5, .55, 1);
  s.move(.5, .55, 1.01);
  const m = s.up(.501, .549, 1.04);
  assert.equal(isRealStroke(m, false), false, 'stationary click is not a stroke');
  s.down(.5, .62, 2);
  s.move(.51, .61, 2.02); // tiny drag in a random direction
  const twitch = s.up(.52, .60, 2.04);
  assert.equal(isRealStroke(twitch, false), false, 'a 2 % twitch in any direction is not a stroke');
  s.down(.5, .70, 3);
  s.move(.52, .58, 3.05);
  s.move(.55, .42, 3.12);
  const flick = s.up(.56, .38, 3.16);
  assert.equal(isRealStroke(flick, false), true, 'a real drag still counts as a stroke');
  s.down(.50, .62, 4);
  s.move(.50, .50, 4.08);
  const serveFlick = s.up(.50, .44, 4.14);
  assert.equal(isRealStroke(serveFlick, true), true, 'a short upward serve flick is a serve stroke');
});
test('physical drop rebounds within table-tennis calibration range', () => {
  const { PH, V3, integrateBall, bounceTable } = load(['10_math.js', '30_physics.js'], ['PH', 'V3', 'integrateBall', 'bounceTable']);
  const p = V3.new(0, PH.TABLE_Y + PH.R + .305, .4), v = V3.new(), w = V3.new();
  for (let i = 0; p.y > PH.TABLE_Y + PH.R && i < 10000; i++) integrateBall(p, v, w, 1/4000);
  bounceTable(p, v, w); let peak = p.y;
  for (let i = 0; v.y > 0 && i < 10000; i++) { integrateBall(p, v, w, 1/4000); peak = Math.max(peak, p.y); }
  const height = peak - PH.TABLE_Y - PH.R;
  assert.ok(height > .23 && height < .27, `rebound ${height}`);
});
test('predict clears reused result fields between flights', () => {
  const { predict, V3 } = load(['10_math.js', '30_physics.js'], ['predict', 'V3']);
  const out = {};
  predict(V3.new(0, 1, 1), V3.new(0, 0, -6), V3.new(), { out });
  predict(V3.new(0, 1, 1), V3.new(0, 0, 0), V3.new(), { out, maxT: .01 });
  assert.equal(out.netCross, null); assert.equal(out.floor, null); assert.equal(out.landed, null);
});

test('pagehide after leaving career preserves the suspended checkpoint', () => {
  const { c, saved } = careerFixture(); c.readyForOpponentSelect(); c.save();
  const checkpoint = saved.get('topspin_career'); c.stop(); c.save();
  assert.equal(saved.get('topspin_career'), checkpoint);
});

test('volume chosen before AudioContext creation survives mute/unmute', () => {
  const { AudioEngine } = load(['50_audio.js'], ['AudioEngine']);
  const a = new AudioEngine(); a.setVolume(.2); a.setMuted(true);
  a.master = { gain: { value: 0 } }; a.setMuted(false);
  assert.equal(a.master.gain.value,.2);
  a.setMuted(true); a.setVolume(.3); assert.equal(a.master.gain.value,0);
  a.setMuted(false); assert.equal(a.master.gain.value,.3);
  a.setVolume(NaN); assert.equal(a.master.gain.value,.3);
});
