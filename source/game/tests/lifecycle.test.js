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

test('a low-FPS rally never borrows frames from the preceding rally or plays too fast', () => {
  const { g, MomentRecorder, MomentPlayer } = fixture(), recorder = new MomentRecorder();
  recorder.beginRally(0, null);
  for (let i = 0; i < 300; i++) { g.ball.p.x = -10; recorder.push(i / 30, g); }
  recorder.beginRally(10, [0, 0]);
  for (let i = 0; i < 60; i++) { g.ball.p.x = 100 + i; recorder.push(10 + i / 20, g); }
  for (let i = 0; i < 3; i++) recorder.addContact(10 + i, { by: 1, stroke: 'DRIVE', speed: 50, spin: 20 });
  const clip = recorder.endRally(13, g, { winner: 1, reason: 'POINT', score: [1, 0], target: 11 });
  assert.ok(clip);
  for (let i = 0; i < clip.frames.length; i += 16) assert.ok(clip.frames[i] >= 100, 'the clip contains an earlier rally');
  const player = new MomentPlayer(); player.play(clip, 1); player.i = 6;
  player.update(.2, g);
  assert.ok(Math.abs(g.ball.p.x - 108) < .01, `20 Hz input played at the wrong speed: ${g.ball.p.x}`);
});

test('recorded clips have the same fixed-rate timeline from 14 through 120 FPS', () => {
  for (const fps of [14, 20, 30, 60, 120]) {
    const { g, MomentRecorder } = fixture(), recorder = new MomentRecorder();
    recorder.beginRally(0, null);
    for (let i = 0; i <= fps * 3; i++) {
      g.ball.p.x = 100 + i / fps;
      recorder.push(i / fps, g);
    }
    const clip = recorder.captureClip(3);
    assert.equal(clip.hz, 30);
    assert.equal(clip.len, 91, `${fps} FPS produced ${clip.len} frames instead of a three-second timeline`);
    for (let i = 0; i < clip.len; i++) assert.ok(Math.abs(clip.frames[i * 16] - 100 - i / 30) < 1e-4);
  }
});

test('a new rally with no recorded frames cannot replay a previous rally', () => {
  const { g, MomentRecorder, MomentPlayer } = fixture(), recorder = new MomentRecorder();
  recorder.beginRally(0, null);
  for (let i = 0; i < 60; i++) recorder.push(i / 30, g);
  recorder.beginRally(5, null);
  assert.equal(recorder.captureClip(5), null);
  assert.equal(new MomentPlayer().play({ frames: new Float32Array(), hz: 30 }), false);
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
