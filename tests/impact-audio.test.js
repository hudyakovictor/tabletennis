const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

/* ===================== the mixer: one voice per event ==================== *
 * The physics runs at 600 Hz. A ball that dribbles along the white line or
 * rests on the net tape therefore reports a contact on almost every substep,
 * and "play a short tone" repeated 600 times a second is not an impact — it
 * is a loud sustained beep. The gate and the voice budget are what keep that
 * class of bug audible-but-brief instead of unbearable.
 * ======================================================================== */
function mixerFixture() {
  const { AudioEngine } = load(['10_math.js', '50_audio.js'], ['AudioEngine']);
  const a = new AudioEngine();
  a.ok = true; a.muted = false;
  const calls = [];
  a.ctx = { currentTime: 1 };
  a._tone = (freq, dur, gain, type) => { calls.push({ kind: 'tone', freq, dur, gain, type }); };
  a._noise = (dur, gain, type, f) => { calls.push({ kind: 'noise', dur, gain, type, f }); };
  return { a, calls };
}

test('a 600 Hz stream of edge contacts collapses to a handful of ticks', () => {
  const { a, calls } = mixerFixture();
  for (let i = 0; i < 300; i++) { a.ctx.currentTime = 1 + i / 600; a.hitEdge(); }
  assert.ok(calls.length > 0, 'the edge ball is still audible');
  // one tick every 0.16 s at most, and one tick is three voices
  assert.ok(calls.length <= 4 * 3, `expected at most 4 ticks in half a second, got ${calls.length} voices`);
});

test('the edge tick is a quiet wooden knock, never a square wave', () => {
  const { a, calls } = mixerFixture();
  a.hitEdge();
  assert.ok(calls.length >= 2);
  for (const c of calls) {
    assert.notEqual(c.type, 'square', 'a square wave reads as an error beep');
    assert.ok(c.gain <= 0.2, `impact voice is over-driven: ${c.gain}`);
  }
});

test('table, net and floor contacts are gated the same way', () => {
  const { AudioEngine } = load(['10_math.js', '50_audio.js'], ['AudioEngine']);
  const events = (name, arg) => {
    const a = new AudioEngine(); a.ok = true; a.ctx = { currentTime: 1 };
    let n = 0;
    a._tone = () => n++; a._noise = () => n++;
    for (let i = 0; i < 120; i++) { a.ctx.currentTime = 1 + i / 600; a[name](arg, 0); }
    return n;
  };
  // 0.2 s of substep-spam: nobody gets more than a couple of voices through.
  assert.ok(events('hitNet') <= 6, 'net');
  assert.ok(events('hitFloor', 4) <= 8, 'floor');
  assert.ok(events('hitTable', 6) <= 24, 'table');
  assert.ok(events('hitRacket', 9) <= 33, 'racket');
  // the shared voice budget is the second line of defence
  const { a: b, calls } = mixerFixture();
  b._voices = 12;                                      // budget already spent
  b.hitTable(6, 0); b.hitEdge(); b.hitNet();
  assert.equal(calls.length, 0, 'nothing is queued while the budget is spent');
  b._voices = 0; b.hitTable(6, 0);
  assert.ok(calls.length > 0, 'and it recovers');
});

test('a muted engine never queues impact voices', () => {
  const { a, calls } = mixerFixture();
  a.muted = true;
  a.hitTable(6, 0); a.hitEdge(); a.hitRacket(9, 2, false);
  assert.equal(calls.length, 0);
});

/* ===================== the sim: one contact per sequence ================= *
 * The gate above is the last line; the first line is that the game must not
 * call it 600 times. Same dribbling ball, measured at the step function.
 * ======================================================================== */
function dribbleFixture(lib) {
  const { Game, V3, Q, GS, PH } = lib;
  let edges = 0, bounces = 0, tables = 0;
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    time: 0, state: GS.RALLY, isServeBall: false, netTouched: false, server: 1,
    stats: {}, rallyBounces: [], serveBounces: 0, marks: [], predictPath: [], predictOut: {},
    settings: { showPredict: false, haptics: false },
    ball: {
      live: true, q: Q.new(), lastHitBy: 1, hist: [],
      // dead on the sideline, moving slowly: every substep is a new contact
      p: V3.new(PH.T_HALF_WID - 0.005, PH.TABLE_Y + PH.R + 1e-5, 1.0),
      v: V3.new(0, 0.04, 0.35), w: V3.new(0, 0, 0),
    },
    // Infinity keeps the bat's own hit cooldown out of this fixture.
    player: { lastHitT: Infinity, pos: V3.new(0, 1, 1.6) },
    audio: { hitEdge() { edges++; }, hitTable() { tables++; }, hitNet() {}, hitFloor() {} },
    msg() {}, shakeIt() {}, buzz() {}, addMark() {}, emitParticles() {},
    onBounce(side) { bounces++; g.rallyBounces.push(side); },
    onFloor() {}, settleDeadBall() { g.ball.live = false; },
  });
  return { g, counts: () => ({ edges, bounces, tables }) };
}

test('a ball trickling along the white line is one bounce, not hundreds', () => {
  const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '70_game.js'],
    ['Game', 'V3', 'Q', 'GS', 'PH', 'tableContact', 'bounceTable']);
  const { g, counts } = dribbleFixture(lib);
  const before = g.ball.p.y;
  for (let i = 0; i < 240 && g.ball.live; i++) g.stepPhysics(1 / 600);
  const c = counts();
  assert.ok(c.bounces >= 1, 'the contact is still a real bounce');
  assert.equal(c.bounces, 1, `the same dribble was reported ${c.bounces} times`);
  assert.equal(c.edges, 1, `the edge sound fired ${c.edges} times`);
  assert.ok(Math.abs(g.ball.p.y - before) < 0.05, 'the ball stays on the table');
  assert.equal(g.stats.edgeBalls, 1, 'the stat line counted the dribble once');
});

test('a normal bounce after a dribble is reported again', () => {
  const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '70_game.js'],
    ['Game', 'V3', 'Q', 'GS', 'PH', 'tableContact', 'bounceTable']);
  const { g, counts } = dribbleFixture(lib);
  const { V3, PH } = lib;
  for (let i = 0; i < 6 && g.ball.live; i++) g.stepPhysics(1 / 600);
  assert.equal(counts().bounces, 1);
  // thrown back up properly, clear of the line: a real bounce, so a real
  // report — the dribble must not have disarmed the reporter forever. A lob
  // at 6.5 m/s needs ~1.4 s of integration before it reaches the table again.
  V3.set(g.ball.v, 0, 6.5, 0.6);
  V3.set(g.ball.p, 0.2, PH.TABLE_Y + 0.6, 0.5);
  for (let i = 0; i < 1200 && g.ball.live && counts().bounces < 2; i++) g.stepPhysics(1 / 600);
  assert.ok(counts().bounces >= 2, 'the next genuine bounce is not swallowed');
});
