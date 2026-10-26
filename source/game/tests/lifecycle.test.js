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

test('miss replay APIs and collectors are removed, not hidden', () => {
  const { g } = fixture();
  for (const name of ['watchMiss', 'recordMissedPoint', 'playAllMissesSequential'])
    assert.equal(typeof g[name], 'undefined');
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

test('replay v2 records penhold roll without increasing frame stride and normalizes faces', () => {
  const { g, MomentRecorder, MomentPlayer, V3 } = fixture();
  const recorder = new MomentRecorder();
  recorder.beginRally(0, null);
  V3.set(g.player.normal, 0, -.2, -1);
  V3.set(g.aiPaddle.normal, 0, .3, 1);
  for (let i = 0; i < 30; i++) {
    g.player.roll = 3.1 + i * .003;
    recorder.push(i / 30, g);
  }
  const clip = recorder.captureClip(1);
  assert.equal(clip.poseVersion, 2);
  assert.equal(clip.frames.length, clip.len * 16);
  const player = new MomentPlayer();
  player.play(clip, 1);
  player.update(.2, g);
  assert.ok(g.player.roll > 3 && g.player.roll < 3.3);
  assert.ok(Math.abs(V3.len(g.player.normal) - 1) < 1e-8);
  assert.ok(Math.abs(V3.len(g.aiPaddle.normal) - 1) < 1e-8);
});

test('legacy replay live-ball flag is never interpreted as a wrist angle', () => {
  const { g, clip, MomentPlayer } = fixture();
  g.settings = { grip: 'penhold', hand: 'left' };
  for (let i = 15; i < clip.frames.length; i += 16) clip.frames[i] = 1;
  const player = new MomentPlayer();
  player.play(clip, 1); player.update(.01, g);
  assert.ok(Math.abs(g.player.roll + Math.PI - .052) < 1e-8);
});
