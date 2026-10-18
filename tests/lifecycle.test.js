const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

function fixture() {
  const lib = load(['10_math.js', '30_physics.js', '59_replay.js', '70_game.js'],
    ['Game', 'MomentPlayer', 'MomentRecorder', 'V3', 'GS']);
  const { Game, MomentPlayer, V3, GS } = lib;
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    replayer: new MomentPlayer(), state: GS.MATCH_END, settings: {},
    setSlowmoHold() {}, setState(s) { this.state = s; },
    audio: { applause() {} }, ball: { p: V3.new(), v: V3.new(), w: V3.new(), hist: [] },
    player: { pos: V3.new(), normal: V3.new() }, aiPaddle: { pos: V3.new(), normal: V3.new() },
    ai: { pos: V3.new() },
  });
  // Legacy boot installs a one-shot default callback, consumed on finish.
  g.replayer.onEnd = () => g.endReplay();
  const clip = { frames: new Float32Array(16 * 3), hz: 30, shots: 3, speed: 20 };
  const advance = () => { for (let i = 0; i < 200 && g.replayer.on; i++) g.replayer.update(.1, g); };
  return { ...lib, g, clip, advance };
}

test('repeated highlight playback always returns to results', () => {
  const { g, clip, advance, GS } = fixture();
  for (let i = 0; i < 5; i++) {
    let done = 0;
    g.state = GS.MATCH_END;
    g.watchMoment(clip, true, () => done++);
    advance();
    assert.equal(g.state, GS.MATCH_END);
    assert.equal(done, 1);
    assert.equal(g.replayer.moment, null);
  }
});

test('miss inspection loops with a valid clip and stops completely on exit', () => {
  const { g, clip, GS } = fixture();
  g.missedRallies = [clip];
  g.watchMiss(0);
  for (let i = 0; i < 200; i++) g.replayer.update(.1, g);
  assert.equal(g.replayer.on, true);
  assert.equal(g.replayer.moment, clip);
  g.endReplay();
  assert.equal(g.replayer.on, false);
  assert.equal(g.state, GS.MATCH_END);
  assert.equal(g.replayer.moment, null);
});

test('sequential miss skip advances once, completes once and allows highlights afterwards', () => {
  const { g, clip, GS, advance } = fixture();
  g.missedRallies = [clip, clip, clip];
  let done = 0;
  g.playAllMissesSequential(() => done++);
  g.skipReplay();
  assert.equal(g.currentMissIndex, 1);
  assert.equal(done, 0);
  advance();
  assert.equal(done, 1);
  assert.equal(g.state, GS.MATCH_END);
  assert.equal(g.replayer.on, false);
  g.watchMoment(clip, true);
  advance();
  assert.equal(g.state, GS.MATCH_END);
});

test('music climax tolerates an uninitialized real AudioEngine', () => {
  const { MusicSystem, AudioEngine } = load(['10_math.js', '50_audio.js', '75_music.js'], ['MusicSystem', 'AudioEngine']);
  const music = new MusicSystem(new AudioEngine());
  assert.doesNotThrow(() => music._triggerClimax());
});

test('cancelling replay drops completion and cannot reopen old results', () => {
  const { g, clip, advance } = fixture();
  let completed = 0;
  g.watchMoment(clip, true, () => completed++);
  g.endReplay(false);
  advance();
  assert.equal(completed, 0);
  assert.equal(g.replayAfter, null);
  assert.equal(g.replayer.onEnd, null);
});

test('recorder reset releases highlights and last clip between matches', () => {
  const { MomentRecorder } = fixture();
  const recorder = new MomentRecorder();
  recorder.kept.push({ frames: new Float32Array(100) });
  recorder.lastClip = recorder.kept[0];
  recorder.reset();
  assert.equal(recorder.kept.length, 0);
  assert.equal(recorder.lastClip, null);
});

test('music point and climax effects stay silent even with active unmuted audio', () => {
  const { MusicSystem } = load(['10_math.js', '75_music.js'], ['MusicSystem']);
  let nodes = 0;
  const music = new MusicSystem({ ok: true, muted: false, bus: {}, ctx: {
    createOscillator() { nodes++; throw Error('unexpected musical tone'); },
    createBufferSource() { nodes++; throw Error('unexpected musical chord'); },
  } });
  music._buffers.resolution = {};
  music._triggerClimax();
  music._playResolution('resolution_win');
  music._playResolution('resolution_lose');
  assert.equal(nodes, 0);
});
