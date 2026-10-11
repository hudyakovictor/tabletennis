/* =====================================================================
 *  REPLAY — highlight capture and playback system.
 *
 *  Captures ball+racket state every frame into a ring buffer.
 *  After each point, scores the rally by peak speed, spin, rally length,
 *  shot type and winner/loser. Keeps only the TOP 5 highlights per match.
 *  Playback: slow-mo, free camera, follow-ball mode.
 * ===================================================================== */
'use strict';

const REPLAY_FPS = 60;
const REPLAY_MAX_SEC = 8;
const REPLAY_BUF_SIZE = REPLAY_FPS * REPLAY_MAX_SEC;  // ~480 frames
const REPLAY_KEEP_TOP = 5;  // best highlights per match

class ReplayRecorder {
  constructor() {
    this.buf = new Float32Array(REPLAY_BUF_SIZE * 16); // p(3)+v(3)+w(3)+rp(3)+rn(3)+sw(1) = 16 floats/frame
    this.writeIdx = 0;
    this.frameCount = 0;
    this.highlights = [];
    this._currentRallyStart = 0;
    this._currentRallyScore = 0;
  }

  reset() {
    this.writeIdx = 0;
    this.frameCount = 0;
    this.highlights = [];
    this._currentRallyStart = 0;
    this._currentRallyScore = 0;
  }

  /** Record one frame of state */
  record(ball, playerRacket, aiRacket, time) {
    const i = (this.writeIdx % REPLAY_BUF_SIZE) * 16;
    const b = ball;
    this.buf[i]    = b.p.x; this.buf[i+1]  = b.p.y; this.buf[i+2]  = b.p.z;
    this.buf[i+3]  = b.v.x; this.buf[i+4]  = b.v.y; this.buf[i+5]  = b.v.z;
    this.buf[i+6]  = b.w.x; this.buf[i+7]  = b.w.y; this.buf[i+8]  = b.w.z;
    this.buf[i+9]  = playerRacket.x; this.buf[i+10] = playerRacket.y; this.buf[i+11] = playerRacket.z;
    // time encoded in last slot
    this.buf[i+15] = time;
    this.writeIdx++;
    this.frameCount++;
  }

  /** Call at the start of each rally */
  onRallyStart() {
    this._currentRallyStart = this.writeIdx;
    this._currentRallyScore = 0;
  }

  /** Call when a shot is made — accumulate rally "interest" score */
  onShot(info) {
    if (!info) return;
    let pts = 0;
    pts += (info.speed || 0) * 1.5;     // fast shots are exciting
    pts += Math.abs(info.spin || 0) * 0.3; // spin is cool
    pts += Math.abs(info.sidespin || 0) * 0.4; // sidespin is rare and cool
    if (info.stroke && info.stroke.id === 'SMASH') pts += 30;
    if (info.stroke && info.stroke.id === 'HOOK') pts += 20;
    if (info.stroke && info.stroke.id === 'FADE') pts += 20;
    this._currentRallyScore += pts;
  }

  /** Call at the end of a point */
  onPointEnd(who, reason, rallyLen, maxSpeed) {
    const frameSpan = this.writeIdx - this._currentRallyStart;
    if (frameSpan < 10) return; // too short to be interesting

    let score = this._currentRallyScore;
    score += Math.min(rallyLen, 20) * 3;  // long rallies are exciting
    if (who > 0) score += 15;             // player winning is more exciting
    if (rallyLen >= 10) score += 25;      // marathon rallies
    if (maxSpeed > 80) score += 20;       // fast exchanges

    // only keep if it's in the top N
    const highlight = {
      score,
      startFrame: Math.max(0, this._currentRallyStart - 30), // 0.5s before rally
      endFrame: this.writeIdx,
      rallyLen,
      maxSpeed,
      who,
      reason,
    };
    this.highlights.push(highlight);
    this.highlights.sort((a, b) => b.score - a.score);
    if (this.highlights.length > REPLAY_KEEP_TOP) {
      this.highlights.length = REPLAY_KEEP_TOP;
    }
  }

  /** Get the frame data for a highlight */
  getHighlightFrames(idx) {
    const h = this.highlights[idx];
    if (!h) return null;
    const frames = [];
    // clamp to buffer window — older frames have been overwritten
    const end = h.endFrame;
    const start = Math.max(h.startFrame, end - REPLAY_BUF_SIZE);
    for (let f = start; f < end; f++) {
      const fi = (f % REPLAY_BUF_SIZE) * 16;
      frames.push({
        bp: { x: this.buf[fi], y: this.buf[fi+1], z: this.buf[fi+2] },
        bv: { x: this.buf[fi+3], y: this.buf[fi+4], z: this.buf[fi+5] },
        bw: { x: this.buf[fi+6], y: this.buf[fi+7], z: this.buf[fi+8] },
        rp: { x: this.buf[fi+9], y: this.buf[fi+10], z: this.buf[fi+11] },
        t: this.buf[fi+15],
      });
    }
    return { highlight: h, frames };
  }

  get hasHighlights() { return this.highlights.length > 0; }
  get highlightCount() { return this.highlights.length; }
}

/* ------------------------------------------------------------------ */
/*  REPLAY PLAYER — renders a highlight with slow-mo and camera        */
/* ------------------------------------------------------------------ */
class ReplayPlayer {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.frames = null;
    this.highlight = null;
    this.playIdx = 0;
    this.speed = 0.35;        // playback speed multiplier (slow-mo by default)
    this.paused = false;
    this.mode = 'follow';     // 'follow' = track ball, 'free' = orbit camera
    this.time = 0;
  }

  start(highlightIdx) {
    const data = this.game.replay.getHighlightFrames(highlightIdx);
    if (!data || data.frames.length < 5) return false;
    this.frames = data.frames;
    this.highlight = data.highlight;
    this.playIdx = 0;
    this.speed = 0.35;
    this.paused = false;
    this.time = 0;
    this.active = true;
    return true;
  }

  stop() {
    this.active = false;
    this.frames = null;
  }

  update(dt) {
    if (!this.active || this.paused || !this.frames) return;
    this.time += dt * this.speed;
    const targetFrame = Math.floor(this.time * REPLAY_FPS);
    if (targetFrame >= this.frames.length - 1) {
      // loop
      this.time = 0;
      this.playIdx = 0;
    }
    this.playIdx = Math.min(targetFrame, this.frames.length - 1);
  }

  /** Get interpolated state at current playback time */
  getState() {
    if (!this.frames || this.frames.length === 0) return null;
    const idx = Math.min(this.playIdx, this.frames.length - 1);
    return this.frames[idx];
  }

  setSpeed(s) { this.speed = clamp(s, 0.1, 2.0); }
  togglePause() { this.paused = !this.paused; }
  nextFrame() { this.playIdx = Math.min(this.playIdx + 1, this.frames.length - 1); }
  prevFrame() { this.playIdx = Math.max(this.playIdx - 1, 0); }
}