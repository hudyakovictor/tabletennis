/* =====================================================================
 *  BEST MOMENTS — record the match, keep only the beautiful parts.
 *
 *  A replay of "every point" is a feature nobody watches twice. What
 *  people actually want is the two or three rallies they will tell a
 *  friend about: the long one, the smash that came back, the point at
 *  10-10. So the recorder is not a video tape, it is a filter:
 *
 *  · MomentRecorder keeps a short ring buffer of the last seconds of
 *    play (ball, both paddles, both normals) and every contact;
 *  · when a point ends, the rally is cut out of the ring, scored for
 *    beauty, and kept only if it makes the top few — a whole match
 *    costs a few hundred kilobytes;
 *  · MomentPlayer plays one back at 0.35× with its own camera, so the
 *    physics does the animating and the code only has to move the
 *    camera and the letterbox.
 * ===================================================================== */
'use strict';

const REPLAY_HZ = 30;             // 30 Hz is smooth at 0.35× and halves memory
const REPLAY_RING_S = 45;         // seconds of rolling history
const REPLAY_FLOATS = 16;         // ball(3) + myPos(3) + myNrm(3) + aiPos(3) + aiNrm(3) + playerRoll(1), poseVersion 2
const REPLAY_KEEP = 5;            // how many moments survive a whole match

/* --------------------------- scoring ------------------------------- */
/* Beauty is not one thing. A 22-shot rally of chops is beautiful in a
   different way from a 3-shot smash, so the score adds up several
   independent reasons to rewatch, and no single one can dominate. */
const BEAUTY = {
  rally(n) { return clamp((n - 4) / 12, 0, 1) * 0.30; },        // 4 shots = 0, 16+ = 0.30
  speed(kmh) { return clamp((kmh - 45) / 65, 0, 1) * 0.17; },   // 45 km/h = 0, 110+ = 0.17
  spin(rps) { return clamp((rps - 45) / 85, 0, 1) * 0.14; },    // 45 rev/s = 0, 130+ = 0.14
  finish(kind) {
    const k = String(kind || '').toLowerCase();
    return (k === 'smash' ? 0.14 : (k === 'loop' || k === 'counter') ? 0.11 : (k === 'fade' || k === 'hook' || k === 'flick') ? 0.10 : k === 'lob' ? 0.09 : 0.03);
  },
  clutch(meta) { return (meta.deuce ? 0.10 : 0) + (meta.matchPoint ? 0.09 : 0) + (meta.close ? 0.05 : 0); },
  comeback(meta) { return clamp(meta.deficit / 4, 0, 1) * 0.09; },
  netClip(meta) { return meta.netClip ? 0.05 : 0; },
};

class MomentRecorder {
  constructor() {
    this.cap = REPLAY_HZ * REPLAY_RING_S;
    this.f = new Float32Array(this.cap * REPLAY_FLOATS);
    this.inputPose = new Float32Array(REPLAY_FLOATS);
    this.previousPose = new Float32Array(REPLAY_FLOATS);
    this.n = 0; this.head = 0;          // ring state (n = filled, head = write cursor)
    this.beginT = 0; this.marks = [];   // indices into the ring for the current rally
    this.events = [];                   // contacts of the current rally
    this.inputDecisions = [];           // sparse press-gate evidence; frame size unchanged
    this.kept = [];                     // surviving moments, best first
    this.rallyStart = 0;                // ring index where the rally began
    this.lastClip = null;
  }

  reset() { this.lastClip = null; this.kept.length = 0; this.beginRally(0, null); this.n = 0; this.head = 0; this.lastT = -Infinity; }

  /** called when a rally starts: we remember the score so the filter can
   *  tell "3-0 up, easy point" from "0-4 down, that one" */
  beginRally(t, score) {
    this.events.length = 0;
    this.inputDecisions.length = 0;
    this.rallyStart = this.head;
    this.rallyT = t;
    this.rallyFrames = 0; this.lastT = -Infinity; this.lastInputT = -Infinity;
    this.netClip = false;
    this.deficit = score ? Math.max(0, score[1] - score[0]) : 0;
  }

  /** one frame of play: everything the renderer needs to show it again */
  push(t, g) {
    if (!Number.isFinite(t) || t < this.lastInputT) return false;
    const f = this.inputPose;
    const b = g.ball.p, p = g.player.pos, ap = g.aiPaddle.pos;
    f[0] = b.x; f[1] = b.y; f[2] = b.z;
    f[3] = p.x; f[4] = p.y; f[5] = p.z;
    f[6] = g.player.normal.x; f[7] = g.player.normal.y; f[8] = g.player.normal.z;
    f[9] = ap.x; f[10] = ap.y; f[11] = ap.z;
    f[12] = g.aiPaddle.normal.x; f[13] = g.aiPaddle.normal.y; f[14] = g.aiPaddle.normal.z;
    f[15] = Number.isFinite(g.player.roll) ? g.player.roll : 0;
    // Resample onto the playback clock even below 30 FPS. Simply throttling
    // slow input recorded 20 Hz poses that the player then ran at 30 Hz.
    const step = 1 / REPLAY_HZ, previous = this.previousPose;
    let next = Number.isFinite(this.lastT) ? this.lastT + step : t;
    const due = Math.floor((t - next) / step + 1e-6) + 1;
    if (due > this.cap) next += (due - this.cap) * step;
    let stored = false;
    for (; next <= t + 1e-6; next += step) {
      const u = Number.isFinite(this.lastInputT) && t > this.lastInputT
        ? clamp((next - this.lastInputT) / (t - this.lastInputT), 0, 1) : 1;
      const index = this.head * REPLAY_FLOATS;
      for (let k = 0; k < REPLAY_FLOATS; k++) this.f[index + k] = lerp(previous[k], f[k], u);
      const roll = Math.atan2(Math.sin(f[15] - previous[15]), Math.cos(f[15] - previous[15]));
      this.f[index + 15] = previous[15] + roll * u;
      this.head = (this.head + 1) % this.cap;
      this.n = Math.min(this.cap, this.n + 1);
      this.rallyFrames = Math.min(this.cap, this.rallyFrames + 1);
      this.lastT = next; this.t = next; stored = true;
    }
    previous.set(f); this.lastInputT = t;
    return stored;
  }

  /** @param e {by, stroke, speed, spin, quality, slip} */
  addContact(t, e) { this.events.push(Object.assign({ t }, e)); }

  /** One compact record per press/contact, NOT per frame: REPLAY_FLOATS and
   *  the 45 s ring keep their exact size. Cost is ~7 numbers + 2 short strings
   *  per player shot (a 20-shot rally adds well under 4 KB of JSON). */
  addInputDecision(t, decision, outcome, inputType) {
    if (!decision) return;
    this.inputDecisions.push({ t, shape: decision.shape || null,
      score: decision.score, along: decision.along, across: decision.across,
      accepted: !!decision.accepted, reason: decision.reason || null,
      inputType: inputType || null, contact: !!(outcome && outcome.contact) });
    if (this.inputDecisions.length > 256) this.inputDecisions.shift();
  }
  addBounce(isNet) { if (isNet) this.netClip = true; }

  /** Capture the current rally's frames for debug replay regardless of beauty score */
  captureClip(t) {
    const len = Math.min(this.n, this.rallyFrames);
    if (!len) return null;
    const clip = new Float32Array(len * REPLAY_FLOATS);
    for (let k = 0; k < len; k++) {
      const src = ((this.head - len + k) % this.cap + this.cap) % this.cap;
      clip.set(this.f.subarray(src * REPLAY_FLOATS, src * REPLAY_FLOATS + REPLAY_FLOATS), k * REPLAY_FLOATS);
    }
    return { frames: clip, hz: REPLAY_HZ, len, poseVersion: 2, inputDecisions: this.inputDecisions.slice() };
  }

  /**
   * Cut the rally out of the ring and decide whether it survives.
   * meta = { winner, reason, score, target, serve, tossT }
   */
  endRally(t, g, meta) {
    const shots = this.events.length;
    if (shots < 3) { this.beginRally(t, null); return null; }   // a 2-shot point is never beautiful

    const clip = this.captureClip(t);
    if (!clip) { this.beginRally(t, null); return null; }

    let peakSpeed = 0, peakSpin = 0, finish = 'drive', mine = 0;
    for (const e of this.events) {
      if (e.speed > peakSpeed) { peakSpeed = e.speed; finish = e.stroke || finish; }
      if (e.spin > peakSpin) peakSpin = e.spin;
      if (e.by > 0) mine++;
    }
    const myScore = meta.score[0], oppScore = meta.score[1];
    const T = meta.target;
    const wS = meta.winner > 0 ? myScore : oppScore, lS = meta.winner > 0 ? oppScore : myScore;
    const m = {
      deuce: myScore >= T - 1 && oppScore >= T - 1,
      matchPoint: wS >= T && wS - lS >= 2,     // this point ended the match
      close: Math.abs(myScore - oppScore) <= 1,
      deficit: this.deficit || 0,
      netClip: this.netClip,
    };
    const score = BEAUTY.rally(shots) + BEAUTY.speed(peakSpeed) + BEAUTY.spin(peakSpin)
      + BEAUTY.finish(finish) + BEAUTY.clutch(m) + BEAUTY.comeback(m) + BEAUTY.netClip(m);

    const moment = {
      score, shots, frames: clip.frames, hz: REPLAY_HZ, poseVersion: 2,
      speed: peakSpeed, spin: peakSpin, finish,
      events: this.events.slice(),
      inputDecisions: this.inputDecisions.slice(),
      winner: meta.winner, reason: meta.reason, mine,
      meta: m, t,
      crowd: meta.winner > 0 && m.matchPoint,
    };
    this.beginRally(t, null);

    // keep the top few. A quiet match still ends with something to watch.
    const kept = this.kept;
    kept.push(moment);
    kept.sort((a, b) => b.score - a.score);
    if (kept.length > REPLAY_KEEP) kept.length = REPLAY_KEEP;
    this.lastClip = moment;
    return moment;
  }

  get best() { return this.kept.length ? this.kept[0] : null; }
}

/* ------------------------- playback -------------------------------- */
/* The clip is data, not a video: the same renderer draws it, so a replay
   is exactly as detailed as the match was — and can be filmed from a
   camera that would have been impossible to play from. */
class MomentPlayer {
  constructor() {
    this.on = false;
    this.moment = null;
    this.i = 0;            // float frame cursor
    this.speed = 0.35;
    this.hold = 0;
    this.camPhase = 0;
    this.onEnd = null;
    this.titles = true;
  }

  play(moment, speed, onEnd) {
    if (!moment || !moment.frames || moment.frames.length < REPLAY_FLOATS) return false;
    this.moment = moment;
    this.i = 0; this.hold = 0; this.camPhase = 0;
    this.speed = speed || 0.35;
    this.on = true;
    this.onEnd = typeof onEnd === 'function' ? onEnd : null;
    return true;
  }

  stop() { this.on = false; this.moment = null; this.onEnd = null; }

  get lastFrame() { return this.moment ? this.moment.frames.length / REPLAY_FLOATS - 1 : 0; }

  /** advance and write the pose back into the live game objects */
  update(dtReal, g) {
    const mo = this.moment;
    if (!mo || !g || !g.ball) { this.on = false; return; }   // no world, no replay
    const F = mo.frames, last = this.lastFrame;
    // ease in: the first half second is slow, then settle to normal speed
    const sp = this.speed * (this.i < 6 ? 0.45 + 0.09 * this.i : 1);
    this.i += dtReal * mo.hz * sp;
    this.camPhase += dtReal;
    if (this.i >= last) { this.i = last; this.hold += dtReal; if (this.hold > 1.1) return this.finish(); }
    else this.hold = 0;

    const i0 = Math.floor(this.i), i1 = Math.min(i0 + 1, last), u = this.i - i0;
    const a = i0 * REPLAY_FLOATS, b = i1 * REPLAY_FLOATS;
    const L = (k) => lerp(F[a + k], F[b + k], u);
    V3.set(g.ball.p, L(0), L(1), L(2));
    V3.set(g.player.pos, L(3), L(4), L(5));
    V3.set(g.player.normal, L(6), L(7), L(8));
    V3.norm(g.player.normal, g.player.normal);
    if (mo.poseVersion >= 2) {
      const delta = Math.atan2(Math.sin(F[b + 15] - F[a + 15]), Math.cos(F[b + 15] - F[a + 15]));
      g.player.roll = F[a + 15] + delta * u;
    } else {
      // Legacy slot 15 was a live-ball flag, never an angle.
      const settings = g.settings || {};
      g.player.roll = (settings.hand === 'left' ? -1 : 1) * (settings.grip === 'penhold' ? Math.PI - .052 : .28);
    }
    g.player.pitch = Math.asin(clamp(g.player.normal.y, -1, 1));
    g.player.yaw = -Math.atan2(g.player.normal.x, -g.player.normal.z);
    V3.set(g.aiPaddle.pos, L(9), L(10), L(11));
    V3.set(g.aiPaddle.normal, L(12), L(13), L(14));
    V3.norm(g.aiPaddle.normal, g.aiPaddle.normal);
    V3.copy(g.ai.pos, g.aiPaddle.pos);
    g.ball.live = true;
    // trail: rebuild the last few frames of history so the ball draws a streak
    g.ball.hist.length = 0;
    if (g.ball.histTimes) g.ball.histTimes.length = 0;
    const back = Math.min(10, i0);
    for (let k = back; k >= 0; k--) {
      const o = (i0 - k) * REPLAY_FLOATS;
      g.ball.hist.push(F[o], F[o + 1], F[o + 2]);
    }
    const vx = (F[b] - F[a]) * mo.hz, vy = (F[b + 1] - F[a + 1]) * mo.hz, vz = (F[b + 2] - F[a + 2]) * mo.hz;
    V3.set(g.ball.v, vx, vy, vz);
    V3.set(g.ball.w, 0, 0, 0);
  }

  finish() {
    this.on = false;
    const cb = this.onEnd; this.onEnd = null;
    this.moment = null;
    if (cb) cb();
  }
}
