/* Shared paddle-only motion contract. Degrees in profiles: + closes toward
 * the net. World pitch has the opposite sign. No render-time mutation. */
'use strict';

const PADDLE_PROFILES = Object.freeze({
  DRIVE: Object.freeze({ keys: Object.freeze([15, 5, 15, 20]), range: Object.freeze([-20, -10]), roll: .16, follow: .11, recover: .19 }),
  LOOP: Object.freeze({ keys: Object.freeze([15, 12, 40, 48]), range: Object.freeze([-50, -30]), roll: .24, follow: .15, recover: .23 }),
  CHOP: Object.freeze({ keys: Object.freeze([15, -12, -30, -38]), range: Object.freeze([20, 40]), roll: -.20, follow: .16, recover: .23 }),
  PUSH: Object.freeze({ keys: Object.freeze([15, -10, -25, -30]), range: Object.freeze([15, 40]), roll: -.10, follow: .10, recover: .17 }),
  FLICK: Object.freeze({ keys: Object.freeze([15, 0, 20, 28]), range: Object.freeze([-30, -5]), roll: .20, follow: .09, recover: .16 }),
  BLOCK: Object.freeze({ keys: Object.freeze([15, 8, 8, 10]), range: Object.freeze([-15, 0]), roll: .03, follow: .06, recover: .13 }),
  SMASH: Object.freeze({ keys: Object.freeze([15, 2, 18, 38]), range: Object.freeze([-35, 5]), roll: .13, follow: .08, recover: .16 }),
  HOOK: Object.freeze({ keys: Object.freeze([15, 8, 22, 30]), range: Object.freeze([-45, 30]), roll: .34, follow: .11, recover: .17 }),
  FADE: Object.freeze({ keys: Object.freeze([15, 8, 22, 30]), range: Object.freeze([-45, 30]), roll: -.34, follow: .11, recover: .17 }),
  LOB: Object.freeze({ keys: Object.freeze([15, -15, -5, 12]), range: Object.freeze([-45, 45]), roll: .08, follow: .16, recover: .20 }),
  SERVE: Object.freeze({ keys: Object.freeze([15, -20, 0, 25]), range: Object.freeze([-45, 45]), roll: .20, follow: .12, recover: .20 }),
});
function paddleStrokeFamily(stroke) {
  if (typeof stroke !== 'string') return 'DRIVE';
  if (stroke.startsWith('SERVE')) return 'SERVE';
  if (stroke === 'COUNTER') return 'LOOP';
  if (stroke === 'DROP') return 'PUSH';
  return PADDLE_PROFILES[stroke] ? stroke : 'DRIVE';
}
function paddleGripProfile(grip, stroke, forehand = true) {
  const family = paddleStrokeFamily(stroke), base = PADDLE_PROFILES[family];
  const pen = grip === 'penhold', k = base.keys;
  const loop = pen && family === 'LOOP';
  const contact = loop ? (forehand ? 25 : 30) : k[2];
  const travel = { DRIVE: .13, LOOP: .18, CHOP: .15, PUSH: .055, FLICK: .09,
    BLOCK: .025, SMASH: .20, HOOK: .14, FADE: .14, LOB: .17, SERVE: .12 };
  const serveBack = stroke === 'SERVE_BACK';
  const sideRoll = stroke === 'SERVE_SIDE' ? .34 : base.roll;
  return { family, ready: pen ? 5 : k[0], prepare: k[1], contact,
    follow: loop ? contact + (forehand ? 7 : 12) : k[3],
    // Reverse-penhold backhand needs more wrist travel than the forehand.
    roll: (serveBack ? -.18 : sideRoll) * (pen ? (forehand ? 1.15 : 1.45) : 1),
    followTime: base.follow, recoverTime: base.recover,
    travel: travel[family] * (pen ? .85 : 1),
    yawTravel: (family === 'HOOK' ? .23 : family === 'FADE' ? -.23
      : family === 'BLOCK' ? .015 : .07) * (forehand ? 1 : -1),
    range: loop ? (forehand ? [-30, -10] : [-40, -15]) : base.range };
}
// A narrow dead band prevents tiny touch noise flipping the FH/BH grip.
function paddleForehand(x, hand, previous) {
  const lateral = (Number.isFinite(x) ? x : 0) * (hand === 'left' ? -1 : 1);
  if (typeof previous !== 'boolean') return lateral >= -.08;
  return previous ? lateral >= -.125 : lateral > -.035;
}
function paddleContactRange(grip, stroke, forehand = true, isServe = false, context = {}) {
  if (grip !== 'shakehand' && grip !== 'penhold') return null;
  // Lob, smash and sidespin keep their unconstrained physical archetypes.
  if (!isServe && !['DRIVE', 'LOOP', 'COUNTER', 'FLICK', 'CHOP', 'PUSH', 'DROP', 'BLOCK'].includes(stroke)) return null;
  const range = paddleGripProfile(grip, isServe ? 'SERVE' : stroke, forehand).range;
  if (!isServe && ['BLOCK', 'PUSH', 'DROP'].includes(stroke)) {
    /* A block is not always a closed face. Closed is right against topspin
     * — the incoming spin itself lifts the ball — but a flat or chopped ball
     * has no such help, and a face pinned at or below vertical cannot lift
     * it over the net from behind the baseline. Measured: a passive block of
     * an 18 m/s drive died on the hitter's own half every time, although
     * the same contact with an open face is a routine return. Open the
     * envelope by the amount the incoming spin does NOT supply. */
    const back = Number.isFinite(context.incomingTop) ? clamp(-context.incomingTop / 220, 0, 1) : 0;
    const flat = Number.isFinite(context.incomingTop) && context.incomingTop <= 60 ? 1 : 0;
    const opening = Math.min(26, Math.max(back * 22, flat * 20));
    return [range[0], range[1] + opening];
  }
  if (grip === 'shakehand' && !isServe && ['LOOP', 'COUNTER'].includes(stroke)) {
    // 30–50 degrees is a strong loop, not a universal joint limit. A weak
    // or below-net opening needs a more open face, especially off backspin.
    // Preserve a closed face, but do not turn a coaching guideline into an
    // impossible low-ball return in the actual friction/impulse model.
    const weak = Number.isFinite(context.swingSpeed) ? clamp((12 - context.swingSpeed) / 4, 0, 1) : 0;
    const low = Number.isFinite(context.contactY) ? clamp((1.10 - context.contactY) / .30, 0, 1) : 0;
    const back = Number.isFinite(context.incomingTop) ? clamp(-context.incomingTop / 300, 0, 1) : 0;
    const opening = Math.min(15, Math.max(weak * 15, low * 10, back * 12));
    return [range[0], range[1] + opening];
  }
  return range;
}
function wristStrokeKey(grip, stroke, preparation, follow, forehand = true) {
  const p = paddleGripProfile(grip, stroke, forehand);
  const a = smoothstep(0, 1, Number.isFinite(preparation) ? preparation : 0);
  const b = smoothstep(0, 1, Number.isFinite(follow) ? follow : 0);
  return { ready: p.ready, contact: p.contact,
    pitch: -lerp(lerp(p.ready, p.prepare, a), p.follow, b) * DEG };
}
function paddleAngleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
/** Exact solution of error' = -min(rate*error, maxSpeed). Unlike error-
 * dependent lerp coefficients this has the same response at 30/60/120 Hz.
 * Angular wrapping is opt-in: penhold +pi and -pi are the same grip. */
function stepPaddleAngle(current, target, rate, dt, maxSpeed = 12, wrap = false) {
  if (!Number.isFinite(target)) return Number.isFinite(current) ? current : 0;
  if (!Number.isFinite(current)) return target;
  if (!Number.isFinite(dt) || dt <= 0) return current;
  if (!(rate > 0) || !(maxSpeed > 0)) return current;
  const delta = wrap ? paddleAngleDelta(current, target) : target - current;
  let error = Math.abs(delta), t = Math.min(dt, 1);
  const boundary = maxSpeed / rate;
  const linearTime = Math.max(0, (error - boundary) / maxSpeed);
  if (t <= linearTime) return current + Math.sign(delta) * maxSpeed * t;
  const remaining = Math.min(error, boundary) * Math.exp(-rate * (t - linearTime));
  return current + Math.sign(delta) * (error - remaining);
}
function paddleFaceAngles(normal) {
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (!Number.isFinite(length) || length < 1e-8) return { yaw: 0, pitch: -15 * DEG };
  return { yaw: -Math.atan2(normal.x, -normal.z), pitch: Math.asin(clamp(normal.y / length, -1, 1)) };
}

/** Physical impact -> immediate follow -> recovery.
 * contact() installs the exact impact pose in Game before rendering.
 * sample(0) reads it; the very next positive dt MUST advance. There is no
 * contact hold, skipped first frame, hit-stop or second angular low-pass. */
class PaddleStrokeMotion {
  constructor() { this.reset(); }
  reset() { this.active = false; this.stage = 'ready'; this.elapsed = 0; this.fresh = false; }
  contact(normal, roll, stroke, grip, hand, forehand = true, followEnabled = true) {
    this.profile = paddleGripProfile(grip, stroke, forehand);
    this.start = { ...paddleFaceAngles(normal), roll: Number.isFinite(roll) ? roll : 0 };
    this.hand = hand === 'left' ? -1 : 1;
    this.rollDirection = this.hand * (grip === 'penhold' ? -1 : 1);
    this.followEnabled = followEnabled;
    this.elapsed = 0; this.fresh = false; this.active = true; this.stage = 'contact';
  }
  sample(dt, ready, interrupt = false) {
    if (interrupt) this.reset();
    if (!this.active) return null;
    if (Number.isFinite(dt) && dt > 0) this.elapsed += dt;
    const p = this.profile;
    const follow = this.followEnabled ? p.followTime : 0;
    const end = follow + p.recoverTime;
    if (this.elapsed >= end) { this.reset(); return null; }
    const delta = this.followEnabled ? -(p.follow - p.contact) * DEG : 0;
    const followPitch = clamp(this.start.pitch + delta, -1.15, 1.05);
    const followRoll = this.start.roll + (this.followEnabled ? this.rollDirection * p.roll : 0);
    if (this.elapsed === 0) { this.stage = 'contact'; return { ...this.start, stage: this.stage }; }
    const followYaw = this.start.yaw + (this.followEnabled ? this.hand * p.yawTravel : 0);
    if (follow && this.elapsed < follow) {
      this.stage = 'follow';
      // Non-zero exit velocity at contact; zero velocity at full extension.
      const u = clamp(this.elapsed / follow, 0, 1), t = 1 - (1 - u) ** 2;
      return { yaw: lerp(this.start.yaw, followYaw, t), pitch: lerp(this.start.pitch, followPitch, t),
        roll: lerp(this.start.roll, followRoll, t), stage: this.stage };
    }
    this.stage = 'recover';
    const t = smoothstep(0, 1, (this.elapsed - follow) / p.recoverTime);
    return { yaw: followYaw + paddleAngleDelta(followYaw, ready.yaw) * t,
      pitch: lerp(followPitch, ready.pitch, t),
      roll: followRoll + paddleAngleDelta(followRoll, ready.roll) * t, stage: this.stage };
  }
}

/** Contact-anchored positional path, in real seconds. The input target delta
 * is additive even during follow-through: animation never locks the mouse.
 * Called once per update, BEFORE the normal limits/table support.
 *
 * `lim` are the hard spatial limits applied later in updatePlayerPaddle. An
 * authored path that runs into one of them used to be clipped and then held
 * against the wall for the rest of the phase — the blade visibly parked at the
 * top of its range right after contact, which read as a freeze at the hit.
 * Now the phase ends the moment the path would leave the box, so the bat is
 * handed straight back to the cursor instead of being held in a clamp. */
function paddleFollowPosition(ft, target, dt, lim) {
  if (!ft || !ft.active) return false;
  if (!ft.base) ft.base = { ...target };
  if (Number.isFinite(dt) && dt > 0) ft.t += dt;
  const follow = ft.followTime, recover = ft.recoverTime;
  const u = clamp(ft.t / Math.max(follow, 1e-6), 0, 1);
  const reach = ft.amplitude * (1 - (1 - u) ** 2);
  const blend = smoothstep(0, 1, (ft.t - follow) / Math.max(recover, 1e-6));
  const out = {};
  for (const [key, axis] of [['tx', 'x'], ['ty', 'y'], ['tz', 'z']]) {
    const path = ft.anchor[axis] + ft.swingDir[axis] * reach + target[key] - ft.base[key];
    if (lim && (path < lim[axis + 'Lo'] || path > lim[axis + 'Hi'])) {
      ft.active = false;
      return false;
    }
    out[key] = lerp(path, target[key], blend);
  }
  target.tx = out.tx; target.ty = out.ty; target.tz = out.tz;
  if (ft.t >= follow + recover) ft.active = false;
  return true;
}

/** Exact vertical support of the meshes in 60_scene / 56_rig. Includes
 * both rubber layers and the offset rectangular handle (metres).
 * Y projection of a lookRotation basis depends only on normal.y and roll. */
function paddleBottomExtent(normal, roll) {
  const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
  const ny = Number.isFinite(len) && len > 1e-8 ? clamp(normal.y / len, -1, 1) : 0;
  roll = Number.isFinite(roll) ? roll : 0;
  const upright = Math.sqrt(Math.max(0, 1 - ny * ny));
  const by = upright * Math.cos(roll), bx = upright * Math.sin(roll);
  const blade = Math.hypot(.077 * bx, .082 * by) + .007 * Math.abs(ny);
  const rubber = Math.hypot(.072 * bx, .077 * by) + .010 * Math.abs(ny);
  const handle = .125 * by + .015 * Math.abs(bx) + .050 * Math.abs(by) + .011 * Math.abs(ny);
  return Math.max(blade, rubber, handle);
}
function keepPaddleAboveTable(pos, normal, roll, tableY, halfWidth, halfLength) {
  // Start lifting outside the conservative .18 m mesh footprint, so a
  // below-table bat does not teleport when it crosses the table edge.
  const x = smoothstep(halfWidth + .24, halfWidth + .18, Math.abs(pos.x));
  const z = smoothstep(halfLength + .24, halfLength + .18, Math.abs(pos.z));
  if (x * z <= 0) return 0;
  const minY = tableY + paddleBottomExtent(normal, roll) + .006;
  const lift = Math.max(0, minY - pos.y) * x * z;
  pos.y += lift;
  return lift;
}

/** Time-based tactical reads. frame % 4 would read at only 7.5 Hz on a
 * 30 FPS phone and at 36 Hz on a 144 Hz monitor. Cap work at 30 Hz. */
class PaddleReadClock {
  constructor() { this.reset(); }
  reset() { this.clock = 0; this.age = 0; this.shot = null; }
  advance(dt, incoming, shot) {
    if (!incoming) { this.reset(); return false; }
    const t = Number.isFinite(dt) ? clamp(dt, 0, .1) : 0;
    this.clock += t; this.age += t;
    if (shot !== this.shot || this.clock + 1e-9 >= 1 / 30) {
      this.clock = shot !== this.shot ? 0 : this.clock % (1 / 30);
      // Suppress a floating-point remainder infinitesimally below one tick.
      if (this.clock > 1 / 30 - 1e-9) this.clock = 0;
      this.age = 0; this.shot = shot;
      return true;
    }
    return false;
  }
}
