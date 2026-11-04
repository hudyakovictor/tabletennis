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
  get SERVE() {
    const p = STROKE_CONFIG.motion.SERVE;
    return Object.freeze({ keys: Object.freeze([p.ready, p.prepare, p.contact, p.follow]), range: Object.freeze([...p.range]),
      roll: p.roll, follow: p.followTime, recover: p.recoverTime, hold: p.hold });
  },
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
  return { family, ready: pen ? 5 : k[0], prepare: k[1], contact,
    follow: loop ? contact + (forehand ? 7 : 12) : k[3],
    // Reverse-penhold backhand needs more wrist travel than the forehand.
    roll: base.roll * (pen ? (forehand ? 1.15 : 1.45) : 1),
    followTime: base.follow, recoverTime: base.recover, hold: base.hold ?? STROKE_CONFIG.racket.snapFrames / 60,
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

/** Bound displacement itself, including diagonal travel, not just telemetry. */
function stepPaddlePosition(current, target, rate, dt, maxSpeed, out = current) {
  const x = target.x - current.x, y = target.y - current.y, z = target.z - current.z;
  const distance = Math.hypot(x, y, z);
  if (!Number.isFinite(distance) || !(distance > 1e-9)) return V3.copy(out, current);
  const amount = stepPaddleAngle(0, distance, rate, dt, maxSpeed) / distance;
  return V3.set(out, current.x + x * amount, current.y + y * amount, current.z + z * amount);
}
function paddleFaceAngles(normal) {
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (!Number.isFinite(length) || length < 1e-8) return { yaw: 0, pitch: -15 * DEG };
  return { yaw: -Math.atan2(normal.x, -normal.z), pitch: Math.asin(clamp(normal.y / length, -1, 1)) };
}

/** Physical impact -> contact hold -> authored follow -> recovery.
 * The first sample is EXACTLY the assisted impact normal, even when physics
 * and drawing happen in the same render frame. No frame-counted timers. */
class PaddleStrokeMotion {
  constructor() { this.reset(); }
  reset() { this.active = false; this.stage = 'ready'; this.elapsed = 0; this.fresh = false; this.templateMotion = null; }
  contact(normal, roll, stroke, grip, hand, forehand = true, followEnabled = true, target) {
    this.profile = paddleGripProfile(grip, stroke, forehand);
    this.start = { ...paddleFaceAngles(normal), roll: Number.isFinite(roll) ? roll : 0 };
    this.hand = hand === 'left' ? -1 : 1;
    this.rollDirection = this.hand * (grip === 'penhold' ? -1 : 1);
    this.followEnabled = followEnabled;
    this.elapsed = 0; this.fresh = true; this.active = true; this.stage = 'contact';
    this.templateMotion = null;
    if (target && target.pose && target.racket && typeof compileStrokeTemplate === 'function' && PADDLE_TEMPLATES.strokes[stroke]) {
      const compiled = paddleTemplateFor(stroke, { grip, hand, forehand, side: target.side || 1 });
      const duration = (this.profile.hold + this.profile.followTime + this.profile.recoverTime) / (1 - compiled.contactPhase);
      const pose = target.pose;
      this.templateMotion = retargetStrokeTemplate(compiled, { point: pose.point, q: pose.q,
        normal, localPoint: pose.localPoint, vR: target.racket.vR, duration });
      this.templateOutput = this.templateOutput || createStrokeTemplateOutput();
    }
  }
  sample(dt, ready, interrupt = false) {
    if (interrupt) this.reset();
    if (!this.active) return null;
    if (this.fresh) this.fresh = false;
    else if (Number.isFinite(dt) && dt > 0) this.elapsed += dt;
    if (this.templateMotion) {
      const motion = this.templateMotion, phase = motion.contactPhase + this.elapsed / motion.duration;
      if (phase >= 1) { this.reset(); return null; }
      const pose = sampleStrokeTemplate(motion, phase, this.templateOutput);
      this.stage = pose.stage;
      const angles = paddleFaceAngles(pose.n);
      return { yaw: angles.yaw, pitch: angles.pitch, roll: this.start.roll, stage: pose.stage,
        p: pose.p, q: pose.q, normal: pose.n, v: pose.v, vR: pose.vR, point: pose.point, activeFace: pose.activeFace };
    }
    const p = this.profile, hold = p.hold;
    const follow = this.followEnabled ? p.followTime : 0;
    const end = hold + follow + p.recoverTime;
    if (this.elapsed >= end) { this.reset(); return null; }
    const delta = this.followEnabled ? -(p.follow - p.contact) * DEG : 0;
    const followPitch = clamp(this.start.pitch + delta, -1.15, 1.05);
    const followRoll = this.start.roll + (this.followEnabled ? this.rollDirection * p.roll : 0);
    if (this.elapsed <= hold) { this.stage = 'contact'; return { ...this.start, stage: this.stage }; }
    if (follow && this.elapsed < hold + follow) {
      this.stage = 'follow';
      const t = smoothstep(0, 1, (this.elapsed - hold) / follow);
      return { yaw: this.start.yaw, pitch: lerp(this.start.pitch, followPitch, t),
        roll: lerp(this.start.roll, followRoll, t), stage: this.stage };
    }
    this.stage = 'recover';
    const t = smoothstep(0, 1, (this.elapsed - hold - follow) / p.recoverTime);
    return { yaw: this.start.yaw + paddleAngleDelta(this.start.yaw, ready.yaw) * t,
      pitch: lerp(followPitch, ready.pitch, t),
      roll: followRoll + paddleAngleDelta(followRoll, ready.roll) * t, stage: this.stage };
  }
}

const PADDLE_TEMPLATE_CACHE = new Map();
function paddleTemplateFor(stroke, options = {}) {
  const key = [stroke, options.side || 1, options.hand || 'right', options.grip || 'shakehand', options.forehand !== false].join('|');
  if (!PADDLE_TEMPLATE_CACHE.has(key)) PADDLE_TEMPLATE_CACHE.set(key, compileStrokeTemplate(stroke, options));
  return PADDLE_TEMPLATE_CACHE.get(key);
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
  const clearance = paddleTableClearance(pos, normal, roll, tableY, halfWidth, halfLength);
  const lift = Math.max(0, .006 - clearance);
  pos.y += lift;
  return lift;
}

// The same 44-sided blade, rubbers and box handle that Scene renders.
const PADDLE_LOCAL_FACES = (() => {
  const faces = [];
  for (const [rx, ry, thick, cz] of [[.077, .082, .007, 0],
    [.072, .077, .0015, .0085], [.072, .077, .0015, -.0085]]) {
    const rings = [-thick, thick].map(z => Array.from({ length: 44 }, (_, i) =>
      [rx * Math.cos(i * TAU / 44), ry * Math.sin(i * TAU / 44), cz + z]));
    faces.push(...rings);
    for (let i = 0; i < 44; i++) {
      const j = (i + 1) % 44;
      faces.push([rings[0][i], rings[0][j], rings[1][j], rings[1][i]]);
    }
  }
  const corners = [];
  for (const x of [-.015, .015]) for (const y of [-.175, -.075]) for (const z of [-.011, .011]) corners.push([x, y, z]);
  for (const indices of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]])
    faces.push(indices.map(i => corners[i]));
  return faces;
})();

function paddlePoseQuaternion(normal, roll = 0, out = Q.new()) {
  Q.lookRotation(out, normal, { x: 0, y: 1, z: 0 });
  return Q.mul(out, out, Q.setAxisAngle(Q.new(), 0, 0, 1, Number.isFinite(roll) ? roll : 0));
}

/** Minimum surface clearance inside the actual tabletop footprint. Infinity
 * means no overlap: low recovery behind the end line is not penetration. */
function paddleTableClearance(pos, normal, roll, tableY = PH.TABLE_Y, halfWidth = PH.T_HALF_WID, halfLength = PH.T_HALF_LEN, quaternion) {
  if (!pos || ![pos.x, pos.y, pos.z].every(Number.isFinite)) return Infinity;
  if (Math.abs(pos.x) > halfWidth + .18 || Math.abs(pos.z) > halfLength + .18) return Infinity;
  const q = quaternion || paddlePoseQuaternion(normal || { x: 0, y: 0, z: -1 }, roll);
  if (!quaternion && Math.abs(pos.x) < halfWidth - .18 && Math.abs(pos.z) < halfLength - .18)
    return pos.y - paddleBottomExtent(normal || { x: 0, y: 0, z: -1 }, roll) - tableY;
  const matrix = M4.compose(M4.create(), pos, q, { x: 1, y: 1, z: 1 });
  if (Math.abs(pos.x) < halfWidth - .18 && Math.abs(pos.z) < halfLength - .18) {
    const bx = matrix[1], by = matrix[5], bz = matrix[9];
    const wood = -Math.hypot(.077 * bx, .082 * by) - Math.abs(.007 * bz);
    const rubber = -Math.hypot(.072 * bx, .077 * by) - Math.abs(.010 * bz);
    const handle = -.125 * by - Math.abs(.015 * bx) - Math.abs(.05 * by) - Math.abs(.011 * bz);
    return pos.y + Math.min(wood, rubber, handle) - tableY;
  }
  let minimum = Infinity;
  for (const face of PADDLE_LOCAL_FACES) {
    let polygon = face.map(([x, y, z]) => [matrix[0] * x + matrix[4] * y + matrix[8] * z + pos.x,
      matrix[1] * x + matrix[5] * y + matrix[9] * z + pos.y,
      matrix[2] * x + matrix[6] * y + matrix[10] * z + pos.z]);
    for (const [axis, sign, bound] of [[0, 1, halfWidth], [0, -1, halfWidth], [2, 1, halfLength], [2, -1, halfLength]]) {
      if (!polygon.length) break;
      const clipped = [];
      let a = polygon[polygon.length - 1], da = bound - sign * a[axis];
      for (const b of polygon) {
        const db = bound - sign * b[axis];
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db);
          clipped.push(a.map((value, i) => value + (b[i] - value) * t));
        }
        if (db >= 0) clipped.push(b);
        a = b; da = db;
      }
      polygon = clipped;
    }
    for (const p of polygon) minimum = Math.min(minimum, p[1] - tableY);
  }
  return minimum;
}

/** Anchor one rubber surface to the pre-impact ball, without a second radius
 * offset. Low contacts use the lower blade, not a separately lifted drawing. */
function paddleContactPose(ballP, racket, options = {}) {
  const normal = racket.normal, activeFace = options.forehand === false ? -1 : 1;
  const requestedRoll = Number.isFinite(options.roll) ? options.roll :
    (options.hand === 'left' ? -1 : 1) * (options.grip === 'penhold' ? Math.PI - .08 : .28);
  const point = V3.addScaled(V3.new(), ballP, normal, -PH.R);
  let best = null, bestCost = Infinity;
  for (const roll of [requestedRoll, Math.PI / 2, -Math.PI / 2]) {
    const face = V3.mul(V3.new(), normal, activeFace), q = paddlePoseQuaternion(face, roll);
    const matrix = M4.compose(M4.create(), { x: 0, y: 0, z: 0 }, q, { x: 1, y: 1, z: 1 });
    for (const [x, y] of [[0, .012], [0, -.07], [0, .07], [-.068, 0], [.068, 0]]) {
      const localPoint = { x, y, z: activeFace * .010 };
      const offset = V3.new(matrix[0] * x + matrix[4] * y + matrix[8] * localPoint.z,
        matrix[1] * x + matrix[5] * y + matrix[9] * localPoint.z,
        matrix[2] * x + matrix[6] * y + matrix[10] * localPoint.z);
      const pos = V3.sub(V3.new(), point, offset);
      const clearance = paddleTableClearance(pos, normal, roll, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN, q);
      if (clearance < -.001 - 1e-9) continue;
      const cost = Math.abs(paddleAngleDelta(requestedRoll, roll)) * .04 + Math.hypot(x, y - .012);
      if (cost >= bestCost) continue;
      bestCost = cost;
      best = { pos, normal: V3.clone(normal), q, roll, point, localPoint, activeFace, clearance };
    }
  }
  return best;
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
