/* =====================================================================
 *  SWIPE  ->  STROKE
 *  The gesture is never "a button that plays an animation". It is turned
 *  into a real racket state (3-D velocity + face normal + contact point)
 *  and the ball is then resolved by the rigid-body impact solver.
 *  Everything the player feels (speed, spin, curve, placement, mishits)
 *  is an emergent property of that racket state.
 * ===================================================================== */
'use strict';

/* --------------------------- gesture tracker ----------------------- */
class SwipeTracker {
  constructor() {
    this.gestureId = 0;
    this.active = false;
    this.samples = [];          // {x,y,t} normalized screen units (y down)
    this.maxSamples = 64;
    this.startT = 0;
    this.m = this.blankMetrics();
    this.lastReleased = null;
    /* Which gesture has already been a real stroke (see
     * Game.playerStrokeIntent). A held block must not die of sample
     * freshness; a tap must never qualify. */
    this.realGestureId = -1;
    this.realAt = 0;
  }
  blankMetrics() {
    return {
      sx: 0, sy: 0, x: 0, y: 0, dx: 0, dy: 0,
      dist: 0, pathLen: 0, straightness: 1,
      speed: 0, peakSpeed: 0, releaseSpeed: 0, accel: 0,
      angle: 0, angleDeg: 0, up: 0, right: 0,
      curl: 0, dur: 0, samples: 0, jerk: 0, smooth: 1, holdT: 0,
    };
  }
  down(x, y, t) {
    this.gestureId++;
    this.realGestureId = -1; this.realAt = 0;
    this.consumedGestureId = -1; this.consumedAt = -Infinity;
    this.pressZone = null;
    this.active = true; this.startT = t;
    this.samples.length = 0;
    this.samples.push({ x, y, t });
    this.m = this.blankMetrics();
    this.m.sx = x; this.m.sy = y; this.m.x = x; this.m.y = y;
    /* How long the finger sat still BEFORE the stroke began. Tracked live
     * (not from the sample window, which truncates) so a deliberate hold is
     * readable even after a long jittery press. */
    this._pathAcc = 0; this._movedT = null;
  }
  move(x, y, t) {
    if (!this.active) return;
    const s = this.samples, last = s[s.length - 1];
    if (this._movedT === null && last) {
      this._pathAcc += Math.hypot(x - last.x, y - last.y);
      if (this._pathAcc > 0.012) this._movedT = t;
    }
    // Never coalesce into pointerdown: multiple events can arrive between
    // two RAF ticks and must not erase the origin of the stroke.
    if (s.length > 1 && last && t - last.t < 0.0025) {
      last.x = x; last.y = y; last.t = Math.max(last.t, t);
      this.compute(t);
      return;
    }
    s.push({ x, y, t });
    if (s.length > this.maxSamples) s.shift();
    this.compute(t);
  }
  /** Abandon the gesture without producing a stroke — used when a second
   *  finger lands and the touch turns into a camera orbit. */
  cancel() {
    this.pressZone = null;
    this.active = false;
    this.realGestureId = -1; this.realAt = 0;
    this.samples.length = 0;
    this.lastReleased = null;
    this.m = this.blankMetrics();
  }
  up(x, y, t) {
    if (!this.active) return null;
    this.samples.push({ x, y, t });
    this.compute(t);
    this.active = false;
    this.lastReleased = { ...this.m };
    return this.lastReleased;
  }
  compute(now) {
    const s = this.samples, n = s.length, m = this.m;
    if (n < 2) return m;
    const a = s[0], b = s[n - 1];
    m.sx = a.x; m.sy = a.y; m.x = b.x; m.y = b.y;
    m.dx = b.x - a.x; m.dy = b.y - a.y;
    m.dist = Math.hypot(m.dx, m.dy);
    m.dur = Math.max(1e-3, b.t - a.t);
    m.samples = n;

    // path length + curl (signed turning, + = counter-clockwise on screen)
    let pl = 0, curl = 0, jerkAcc = 0, prevSpeed = 0, speedChanges = 0;
    for (let i = 1; i < n; i++) {
      const px = s[i].x - s[i - 1].x, py = s[i].y - s[i - 1].y;
      const seg = Math.hypot(px, py);
      pl += seg;
      const dt = Math.max(1e-4, s[i].t - s[i - 1].t);
      const sp = seg / dt;
      if (i > 1) { jerkAcc += Math.abs(sp - prevSpeed); speedChanges++; }
      prevSpeed = sp;
      if (i > 1) {
        const qx = s[i - 1].x - s[i - 2].x, qy = s[i - 1].y - s[i - 2].y;
        const cr = qx * py - qy * px, dp = qx * px + qy * py;
        if (seg > 1e-5) curl += Math.atan2(cr, dp);     // signed turn, radians
      }
    }
    m.pathLen = pl;
    m.holdT = clamp((this._movedT ?? b.t) - this.startT, 0, 3);
    m.straightness = pl > 1e-5 ? clamp(m.dist / pl, 0, 1) : 1;
    m.curl = clamp(curl, -3.2, 3.2);          // total signed turning [rad]
    m.jerk = speedChanges ? jerkAcc / speedChanges : 0;

    // velocity over the trailing 55 ms window (what the hand is doing *now*)
    const W = 0.055;
    let i0 = n - 1;
    while (i0 > 0 && b.t - s[i0].t < W) i0--;
    const w = s[i0];
    const wdt = Math.max(1e-3, b.t - w.t);
    const vx = (b.x - w.x) / wdt, vy = (b.y - w.y) / wdt;
    m.speed = Math.hypot(vx, vy);
    m.releaseSpeed = m.speed;
    if (m.speed > m.peakSpeed) m.peakSpeed = m.speed;
    // 25 ms acceleration (is the hand still accelerating into the ball?)
    let i1 = n - 1; while (i1 > 0 && b.t - s[i1].t < 0.025) i1--;
    const w1 = s[i1], wdt1 = Math.max(1e-3, b.t - w1.t);
    const sp1 = Math.hypot(b.x - w1.x, b.y - w1.y) / wdt1;
    m.accel = (sp1 - m.speed) / Math.max(wdt1, 1e-3);

    // direction: blend of overall displacement and current velocity
    let dirx = vx, diry = vy;
    if (m.speed < 0.08) { dirx = m.dx; diry = m.dy; }
    else { dirx = vx * 0.72 + m.dx / m.dur * 0.28; diry = vy * 0.72 + m.dy / m.dur * 0.28; }
    m.angle = Math.atan2(-diry, dirx);      // screen y is down -> flip
    m.angleDeg = m.angle / DEG;
    m.right = Math.cos(m.angle);
    m.up = Math.sin(m.angle);
    m.smooth = clamp(1 - m.jerk / 14, 0.15, 1);
    return m;
  }
}

/* ------------------------- stroke archetypes ----------------------- */
/** Every archetype describes how the arm behaves, not how the ball flies. */
const STROKES = {
  LOOP: { id: 'LOOP', name: 'ТОПСПИН-ЛУП', short: 'ЛУП', col: '#ff7a2f', desc: 'Касательный разгон вверх — мощное верхнее вращение' },
  COUNTER: { id: 'COUNTER', name: 'КОНТРНАКАТ', short: 'КОНТРА', col: '#ff4d6d', desc: 'Встречный топспин по восходящему мячу' },
  DRIVE: { id: 'DRIVE', name: 'НАКАТ', short: 'НАКАТ', col: '#ffd34d', desc: 'Плоско-поступательный удар с лёгким верхним' },
  SMASH: { id: 'SMASH', name: 'СМЕШ', short: 'СМЕШ', col: '#ff2d2d', desc: 'Завершающий плоский удар сверху' },
  FLICK: { id: 'FLICK', name: 'ФЛИК', short: 'ФЛИК', col: '#ff9f1c', desc: 'Короткий кистевой подкрут над столом' },
  PUSH: { id: 'PUSH', name: 'ПОДСТАВКА-ПОДРЕЗКА', short: 'ПОДРЕЗКА', col: '#4dd2ff', desc: 'Короткая подрезка открытой ракеткой' },
  CHOP: { id: 'CHOP', name: 'ЧОП', short: 'ЧОП', col: '#2f9bff', desc: 'Дальняя защита, тяжёлое нижнее вращение' },
  BLOCK: { id: 'BLOCK', name: 'БЛОК', short: 'БЛОК', col: '#a0b4c8', desc: 'Пассивный приём — гасит скорость соперника' },
  LOB: { id: 'LOB', name: 'СВЕЧА', short: 'СВЕЧА', col: '#b388ff', desc: 'Высокая оборонительная свеча с верхним вращением' },
  HOOK: { id: 'HOOK', name: 'ХУК (боковое)', short: 'ХУК', col: '#39e08b', desc: 'Боковое вращение — мяч уходит дугой' },
  FADE: { id: 'FADE', name: 'ФЕЙД (боковое)', short: 'ФЕЙД', col: '#39e0c8', desc: 'Обратное боковое вращение' },
  DROP: { id: 'DROP', name: 'УКОРОЧЕННЫЙ', short: 'УКОРОЧКА', col: '#8fd14f', desc: 'Мягкое гашение у сетки' },
  SERVE_TOP: { id: 'SERVE_TOP', name: 'ПОДАЧА: ВЕРХНЕЕ', short: 'ПОД.ВЕРХ', col: '#ff7a2f', desc: '' },
  SERVE_BACK: { id: 'SERVE_BACK', name: 'ПОДАЧА: НИЖНЕЕ', short: 'ПОД.НИЗ', col: '#4dd2ff', desc: '' },
  SERVE_SIDE: { id: 'SERVE_SIDE', name: 'ПОДАЧА: БОКОВОЕ', short: 'ПОД.БОК', col: '#39e08b', desc: '' },
  SERVE_FAST: { id: 'SERVE_FAST', name: 'ПОДАЧА: БЫСТРАЯ', short: 'ПОД.БЫСТР', col: '#ffd34d', desc: '' },
};

/* ------------------------------------------------------------------ *
 *  Stroke archetypes expressed the way a coach describes them:
 *    elev    - elevation of the swing path (deg, + = upward)
 *    contact - angle between the swing path and the racket face normal.
 *              THIS is the speed <-> spin dial of real table tennis:
 *              small = flat/pure speed, large = grazing/pure spin.
 *    lat     - how much the gesture's sideways part rotates the swing
 *    speed   - effort multiplier, soft = compliant (absorbing) contact
 * ------------------------------------------------------------------ */
const ARCH = {
  LOOP: { elev: 58, contact: 63, speed: 1.00, lat: 0.50, back: false },
  COUNTER: { elev: 46, contact: 56, speed: 1.06, lat: 0.50, back: false },
  DRIVE: { elev: 24, contact: 33, speed: 1.00, lat: 0.60, back: false },
  SMASH: { elev: -5, contact: 22, speed: 1.10, lat: 0.45, back: false },
  FLICK: { elev: 50, contact: 58, speed: 0.90, lat: 0.60, back: false },
  PUSH: { elev: -28, contact: 64, speed: 0.56, lat: 0.45, back: true, soft: 0.84 },
  CHOP: { elev: -50, contact: 68, speed: 0.66, lat: 0.40, back: true },
  BLOCK: { elev: 11, contact: 26, speed: 0.30, lat: 0.35, back: false, soft: 0.62, absorb: 0.26 },
  LOB: { elev: 66, contact: 50, speed: 0.60, lat: 0.35, back: false },
  HOOK: { elev: 28, contact: 56, speed: 1.00, lat: 1.70, back: false },
  FADE: { elev: 28, contact: 56, speed: 1.00, lat: 1.70, back: false },
  DROP: { elev: -10, contact: 58, speed: 0.34, lat: 0.30, back: true, soft: 0.55, absorb: 0.30 },
  SERVE_TOP: { elev: 46, contact: 58, speed: 0.80, lat: 0.60, back: false },
  /* 0.75 -> 0.86: with the table's calibrated friction (MU_TABLE 0.40) a
     heavy chop serve brakes hard at the first bounce and used to die 25 cm
     past the net. Tuned for clean returnable depth. */
  SERVE_BACK: { elev: -34, contact: 64, speed: 0.95, lat: 0.50, back: true },
  SERVE_SIDE: { elev: 10, contact: 62, speed: 0.85, lat: 2.00, back: false },
  /* A fast serve is struck DOWN into the table, not flat: from a contact
   * ~0.5 m above the playing surface a level launch has to crawl at 4 m/s to
   * bounce on the server's own half at all. -13 deg buys a legal first
   * bounce at full swing speed (measured: 24 -> 40+ km/h). */
  SERVE_FAST: { elev: -13, contact: 24, speed: 1.12, lat: 0.60, back: false },
};

/** A click, a 2-pixel twitch or hover jitter is not a stroke.
 *  The bat may only fire if the pointer actually travelled.
 *  A serve is a shorter, slower flick (often down+up with one move) — the
 *  rally gate would reject a legal toss strike.
 *  The rally gate is calibrated on a DELIBERATE but soft stroke, because the
 *  push/chop drill asks for exactly that in words (“мягкое движение вниз”).
 *  Measured on the drill: a 35 px downward drag at ~250 px/s produced
 *  pathLen .044 / dist .044 / peakSpeed .31 and was dropped as a non-stroke,
 *  so the gesture never reached the ball at all (the trainer only ever said
 *  “Нет контакта”). 0.040 / 0.034 / 0.20 still rejects a click (0.002) and a
 *  2 % twitch (0.028) with a margin, and admits the soft push. */
function isRealStroke(m, serving) {
  if (!m || !Number.isFinite(m.samples) || m.samples < (serving ? 2 : 3)) return false;
  const minPath = serving ? 0.022 : 0.040;
  const minDist = serving ? 0.016 : 0.034;
  const minSp = serving ? 0.14 : 0.20;
  if (!Number.isFinite(m.pathLen) || m.pathLen < minPath) return false;
  if (!Number.isFinite(m.dist) || m.dist < minDist) return false;
  if (!Number.isFinite(m.peakSpeed) || m.peakSpeed < minSp) return false;
  return true;
}

function classifyStroke(m, ctx, sp01) {
  const r = m.right, u = m.up;
  const latMag = Math.abs(r);
  const curly = Math.abs(m.curl) > 0.38;
  const fast = sp01 > 0.60, veryFast = sp01 > 0.92, slow = sp01 < 0.30;
  const b = ctx.ball;
  const hAboveNet = b.y - PH.NET_TOP;
  const hAboveTable = b.y - PH.TABLE_Y;
  const depth = Math.abs(b.z);
  const overTable = depth < PH.T_HALF_LEN - 0.02;
  const incomingTop = ctx.incomingTop || 0;
  const incSpeed = ctx.ballSpeed || 6;
  /* SAFE GESTURE PROFILE (Telegram mini-apps, phones). A downward drag is
   * owned by the host app — Telegram collapses the whole mini app on
   * swipe-down — so a stroke must not REQUIRE one. Two honest substitutes:
   *   · hold the press, then move = explicit "open racket / defence" intent
   *     (rallies only: on a serve the press-and-hold IS the toss ritual);
   *   · a slow short stroke = soft hands = push/chop family.
   * Classic downward gestures keep working wherever the platform passes
   * them, so no player loses a shot they already had. */
  const safe = !!ctx.safeGestures;
  const holdDef = safe && !ctx.isServe && (m.holdT || 0) >= 0.18;

  if (ctx.isServe) {
    if (veryFast && Math.abs(u) < 0.45) return STROKES.SERVE_FAST;
    if (latMag > 0.70 || curly) return STROKES.SERVE_SIDE;
    if (u < -0.18) return STROKES.SERVE_BACK;
    // soft serve without a down-swipe: gentle = backspin serve
    if (safe && slow && m.dist < 0.24) return STROKES.SERVE_BACK;
    return STROKES.SERVE_TOP;
  }
  // tiny gesture = touch play
  if (m.dist < 0.050 && sp01 < 0.45) {
    if (incSpeed > 7.0 || incomingTop > 220) return STROKES.BLOCK;
    return (overTable && hAboveTable < 0.34) ? STROKES.DROP : STROKES.BLOCK;
  }
  /* Finishing a high ball always beats everything else — but only if the
   * hand is actually going forward/up. A fast DOWNWARD gesture was caught
   * here before the backspin rule below could see it, so a defensive chop
   * on a ball above the tape was silently reclassified as a smash. The
   * assist then rotated the swing up until the chop "landed", and a 1.9 m/s
   * ball came back at 25 m/s off a hand that never swung forward. The
   * boundary is the same -0.28 the backspin family uses, so the two rules
   * cannot overlap. A held press is defence intent and skips the smash too. */
  if (hAboveNet > 0.14 && sp01 > 0.52 && u > -0.28 && u < 0.52 && !holdDef) return STROKES.SMASH;
  // downward gestures (or a held press in the safe profile) = backspin family
  if (u < -0.28 || holdDef) {
    if (depth > PH.T_HALF_LEN + 0.40 || (fast && m.dist > 0.20)) return STROKES.CHOP;
    if (sp01 < 0.22 && overTable && hAboveTable < 0.35) return STROKES.DROP;
    return STROKES.PUSH;
  }
  // a clearly curved sideways gesture = sidespin
  if (latMag > 0.58 && curly) return (r > 0) ? STROKES.HOOK : STROKES.FADE;
  /* Safe profile: soft hands without a hold — a slow, short, unhurried
   * stroke is a push, never a drive. Fast short strokes stay flicks. */
  if (safe && slow && m.dist < 0.16) {
    if (sp01 < 0.22 && overTable && hAboveTable < 0.35) return STROKES.DROP;
    return STROKES.PUSH;
  }
  // upward gestures = topspin family
  if (u > 0.70) {
    if (slow && hAboveTable < 0.55) {
      /* A lob is a slow ball played with time. The same short, slow upward
       * hand against a FAST ball is a block: there is no time to swing, and
       * classifying it as a lob made the assist open the swing to 75°,
       * where the 80° frame ceiling froze the face and the block could not
       * be aimed at all (measured: 0 of 3 fast blocks returned). */
      if (incSpeed > 8.0 && m.dist < 0.18 && sp01 < 0.62) return STROKES.BLOCK;
      return STROKES.LOB;
    }
    if (overTable && m.dist < 0.13 && hAboveTable < 0.30) return STROKES.FLICK;
    return (incomingTop > 170 && fast) ? STROKES.COUNTER : STROKES.LOOP;
  }
  if (u > 0.34) return (incomingTop > 260 && veryFast) ? STROKES.COUNTER : STROKES.LOOP;
  return STROKES.DRIVE;
}

/* ------------------------------------------------------------------ *
 *  Build the racket state from gesture metrics + ball context.
 *  side = +1 for the near player (hits towards -z)
 * ------------------------------------------------------------------ */
function deriveStroke(m, ctx) {
  const side = ctx.side || 1;
  const fwd = -side;

  /* ---- 0. hostile input never reaches the physics ----------------- *
   * The metrics come straight from touch events: a dropped gesture, a
   * cancelled one or a device that reports nonsense must not be able to
   * push a NaN into the impact solver, where it would poison the ball
   * state for the rest of the match. Sanitise once, here.               */
  if (m) {
    const sane = (v, lo, hi, fb) => (Number.isFinite(v) ? clamp(v, lo, hi) : fb);
    m.releaseSpeed = sane(m.releaseSpeed, 0, 40, 0);
    m.peakSpeed = sane(m.peakSpeed, 0, 40, 0);
    m.right = sane(m.right, -1.4, 1.4, 0);
    m.up = sane(m.up, -1.4, 1.4, 0);
    m.dist = sane(m.dist, 0, 4, 0);
    m.curl = sane(m.curl, -6, 6, 0);
    m.smooth = sane(m.smooth, 0.15, 1, 0.6);
    m.straightness = sane(m.straightness, 0, 1, 1);
    m.holdT = sane(m.holdT, 0, 3, 0);
    m.samples = Number.isFinite(m.samples) ? m.samples : 0;
    m.x = sane(m.x, -2, 3, 0.5);
    m.y = sane(m.y, -2, 3, 0.5);
  }

  /* ---- 1. effort ------------------------------------------------- */
  const raw = Math.max(m.releaseSpeed, m.peakSpeed * 0.78);
  const sp01 = clamp(raw / 4.2, 0, 1.45);

  /* ---- 2. context ------------------------------------------------ */
  const b = ctx.ball || { y: PH.TABLE_Y + 0.15, z: side * 1.2 };
  ctx.ball = b;
  // Spin sign, stated once so it cannot drift again: for a ball travelling
  // towards the player (+z) a POSITIVE w.x is TOPSPIN (the top of the ball
  // moves forward, Magnus pushes it down — verified against aeroAccel in
  // 30_physics.js). "Incoming topspin is positive" therefore means
  // side * w.x, which is also the convention OpponentAI already uses.
  const incomingTop = ctx.incomingTop !== undefined ? ctx.incomingTop
    : side * ((ctx.ballSpin && ctx.ballSpin.x) || 0);
  ctx.incomingTop = incomingTop;
  const hAboveNet = b.y - PH.NET_TOP;
  const hAboveTable = b.y - PH.TABLE_Y;

  /* ---- 3. archetype ---------------------------------------------- */
  const st = classifyStroke(m, ctx, sp01);
  const A = ARCH[st.id] || ARCH.DRIVE;

  /* ---- 4. continuous blend archetype <- raw gesture --------------- *
   * The archetype only biases; the actual numbers still follow the
   * player's hand, so two LOOPs are never identical.                  */
  const r = m.right, u = m.up;
  const gestureElev = u * 66;                       // deg
  let elev = clamp(A.elev * 0.52 + gestureElev * 0.62, -72, 80);

  // spin intent: verticality + gesture length + wrist curl
  const spinIntent = clamp(Math.pow(Math.abs(u), 1.25) * 0.78
    + clamp(m.dist * 1.6, 0, 0.35)
    + Math.abs(m.curl) * 0.08, 0, 1.15);
  let contact = A.contact * 0.62 + lerp(20, 74, clamp(spinIntent, 0, 1)) * 0.46;
  // a high ball wants a flatter contact; a ball below the net wants a graze
  contact += clamp(-hAboveNet * 42, -16, 10);
  contact = clamp(contact, 14, 80);

  // azimuth of the swing / of the face.  On a serve the body stays square
  // and the sidespin comes from the FACE, not from slinging the arm across.
  const azSwing = clamp(r * A.lat * (ctx.isServe ? 0.30 : 0.72), -1.35, 1.35);
  let azFace = clamp(r * A.lat * 0.34 + m.curl * 0.10, -0.80, 0.80);

  // How much of the brushing happens ACROSS the ball instead of up it.
  // A hook, a fade or a sidespin serve is not a topspin stroke that
  // happens to drift sideways: the bat is turned so the contact angle
  // itself lies in the horizontal plane and the ball is peeled round
  // the side. Only the genuinely lateral archetypes do this, so every
  // other stroke keeps exactly the numbers it had before.
  const latMix = clamp((A.lat - 0.60) / 1.40, 0, 1) * clamp(Math.abs(r) * 1.35, 0, 1);
  const latTurn = -Math.sign(r || 1) * contact * DEG * 0.62 * latMix;
  azFace = clamp(azFace + latTurn, -1.25, 1.25);

  /* The step yaw. The bat is turned into the direction it is moving (right
   * step -> face opens right), and the same yaw is applied here so the face
   * you SEE is the face that strikes. Without it the bat visibly banks one
   * way while the ball comes off a square face — a mismatch the eye reads
   * as the game cheating. */
  const moveYaw = Number.isFinite(ctx.moveYaw) ? clamp(ctx.moveYaw, -0.6, 0.6) : 0;
  if (moveYaw) azFace = clamp(azFace + moveYaw * 0.85, -1.25, 1.25);

  let vmag = 2.0 + 15.5 * Math.pow(sp01, 0.82);
  vmag = clamp(vmag * A.speed * (Number.isFinite(ctx.powerScale) ? ctx.powerScale : 1), 0.8, RACKET_VMAX);
  /* A serve is not a smash. Through this impact model a 19.5 m/s bat with a
   * flat face launches the ball at ~30 m/s, and a fast swipe used to produce
   * a 105-137 km/h "serve" — faster than anything ever measured on a real
   * table, and unreturnable by design. Pro serves leave the bat at 10-15 m/s
   * and arrive at 40-70 km/h, which is what 12.5 m/s of bat gives here. */
  if (ctx.isServe) vmag = clamp(vmag, 1.2, SERVE_VMAX);
  if (!Number.isFinite(vmag)) vmag = 4.0;          // last line of defence

  /* The explicit spin dial (the chip in the top button row). The gesture
   * decides HOW you brush the ball; this decides how much of the contact is
   * brush and how much is punch — a more grazing face makes more spin and
   * less pace, a flatter one the reverse. It exists because spin was only
   * ever a side effect of the curl of a swipe: there was no way to ask for a
   * heavy low backspin on purpose, and no way to see what you had asked for.
   * Deterministic and persistent, so it can be learned. */
  const sb = ctx.spinBias === 'high' ? 1 : ctx.spinBias === 'low' ? -1 : 0;
  if (sb) {
    contact = clamp(contact + sb * 9, 14, 80);
    vmag = clamp(vmag * (1 - sb * 0.08), 0.8, 19.5);
  }

  /* ---- 5. build the 3-D racket frame ------------------------------ */
  const eR = elev * DEG;
  const swing = V3.new(
    Math.sin(azSwing) * Math.cos(eR),
    Math.sin(eR),
    fwd * Math.cos(azSwing) * Math.cos(eR));
  V3.norm(swing, swing);
  const vR = V3.mul(V3.new(), swing, vmag);
  if (A.absorb) { V3.mul(vR, vR, 1 - A.absorb); }       // soft hands recoil

  // face normal: rotate away from the swing by the contact angle
  const vertContact = contact * DEG * (1 - 0.58 * latMix);
  const movePitch = Number.isFinite(ctx.movePitch) ? clamp(ctx.movePitch, -0.55, 0.55) : 0;
  let phi = clamp((A.back ? eR + vertContact : eR - vertContact) + movePitch, -1.35, 1.35);
  /* Attack lean: a drive/loop/smash tips the blade INTO the ball (closed
     face, head toward the net). Without this, elev ≈ contact left every
     loop sitting near vertical — the bat never visibly leaned forward. */
  if (!A.back && !A.absorb && !ctx.isServe) {
    phi = clamp(phi - (0.18 + 0.10 * clamp(sp01, 0, 1)), -1.35, 1.35);
  }
  const faceRange = paddleContactRange(ctx.grip, st.id, ctx.forehand !== false, ctx.isServe,
    { swingSpeed: vmag, contactY: b.y, incomingTop });
  if (faceRange) phi = clamp(phi, faceRange[0] * DEG, faceRange[1] * DEG);
  const normal = V3.new(
    Math.sin(azFace) * Math.cos(phi),
    Math.sin(phi),
    fwd * Math.cos(azFace) * Math.cos(phi));
  V3.norm(normal, normal);

  /* ---- 6. intended placement -------------------------------------- */
  const aimX = clamp((m.x - 0.5) * 2.0 + r * 0.50, -1, 1) * (PH.T_HALF_WID * 0.86);
  let depth01;
  switch (st.id) {
    case 'DROP': depth01 = 0.13; break;
    case 'PUSH': depth01 = 0.46 + sp01 * 0.30; break;
    case 'FLICK': depth01 = 0.55; break;
    case 'BLOCK': depth01 = 0.45 + sp01 * 0.3; break;
    case 'LOB': depth01 = 0.90; break;
    case 'SMASH': depth01 = 0.72; break;
    case 'CHOP': depth01 = 0.58; break;
    default: depth01 = clamp(0.34 + sp01 * 0.44 + m.dist * 0.26, 0.2, 0.96);
  }

  /* A serve's DEPTH is driven by the swing, not silently averaged away. Before
   * this, every archetype fell through the default branch above and the serve
   * solver then pulled it to a safe mid-length, so a tap and a hard whip felt
   * identical. Here the player's effort maps straight onto how deep the ball is
   * asked to land: a soft flick sits short, a strong drive reaches the far
   * line. solveServeStroke keeps the requested landing legal (on the table),
   * so this changes WHERE a good serve goes without turning power into a
   * coin-flip fault. The wider the power, the deeper and faster the serve. */
  if (ctx.isServe) {
    depth01 = clamp(0.18 + sp01 * 0.60 + Math.max(0, m.dist) * 0.16, 0.12, 0.98);
  }

  const aimZ = -side * lerp(0.16, PH.T_HALF_LEN - 0.07, depth01);

  /* ---- 7. execution quality --------------------------------------- */
  const quality = clamp(
    0.46
    + 0.24 * m.smooth
    + 0.16 * m.straightness
    + 0.14 * clamp(m.samples / 12, 0, 1)
    - 0.10 * clamp(Math.abs(m.curl) - 1.4, 0, 1.6), 0.2, 1);

  /* The rubber is the player's equipment (84_racket.js), modulated by the
     archetype: a soft, absorbing stroke presses the sponge, which costs
     restitution and gains dwell. Without equipment the base racket is
     used, so the physics is unchanged for anything that does not fit one. */
  const eq = ctx.equip || { e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1 };
  const rubber = {
    e: eq.e * (A.soft || 1),        // soft archetypes press the sponge
    mu: eq.mu,
    et: eq.et * (A.soft ? 0.5 + 0.5 * A.soft : 1),
    damp: eq.damp,
  };

  return {
    stroke: st, arch: A, vR, normal, vmag, faceEnvelope: faceRange, grip: ctx.grip, forehand: ctx.forehand !== false, aim: { x: aimX, z: aimZ },
    power: sp01, quality, elev, contact, azSwing, azFace, faceElev: phi, spinIntent, rubber,
    swipe: m, side, isServe: !!ctx.isServe,
    /* Air left over the tape. A push and a chop carry the least energy of any
       stroke, and at the default 55 mm they were the least reliable shots in
       the game (measured: 28.6 % on the table, 28.6 % into the net). */
    netClear: st.id === 'LOB' ? 0.50 : st.id === 'DROP' ? 0.035
      : (st.id === 'PUSH' || st.id === 'CHOP') ? 0.115
      : st.id === 'SMASH' ? 0.040 : 0.055,
  };
}

/* ------------------------------------------------------------------ *
 *  PHYSICAL AIM ASSIST
 *  The ball is never teleported. We rotate the player's WHOLE stroke
 *  (swing path + racket face together, so the contact angle and hence
 *  the spin character are preserved — exactly what a real player does
 *  when aiming) and scale the swing speed, until the shot physically
 *  lands where the gesture asked for.
 *    assist = 0 -> pure simulation, your technique or nothing
 *    assist = 1 -> flawless professional execution
 * ------------------------------------------------------------------ */
const _rv = V3.new(), _rw = V3.new(), _rn = V3.new(), _rs = V3.new(), _rvr = V3.new(), _rout = {};
const _launch = { x: 0, y: 0, z: 0 };

/** Where the ball actually starts its flight after a contact.
 *
 *  Both sides separate the ball from the face by one radius before the next
 *  physics step (70_game.js: `b.p = contact + normal * R * 1.05`), so every
 *  solver flight has to start from that point as well. It used to start from
 *  the contact point itself, i.e. ~2 cm lower and further back than the ball
 *  the player gets. The search then certified a shot that cleared the tape by
 *  six millimetres, while the real ball clipped it by half a millimetre — a
 *  serve fault nobody could have seen coming. */
function launchPoint(ballP, n) {
  _launch.x = ballP.x + n.x * PH.R * 1.05;
  _launch.y = ballP.y + n.y * PH.R * 1.05;
  _launch.z = ballP.z + n.z * PH.R * 1.05;
  return _launch;
}

function dirFromAngles(out, elev, az, fwd) {
  out.x = Math.sin(az) * Math.cos(elev);
  out.y = Math.sin(elev);
  out.z = fwd * Math.cos(az) * Math.cos(elev);
  return V3.norm(out, out);
}

/** Rebuild (swing, normal) for a stroke rotated by (dElev, dAz). */
function strokeFrame(racket, dElev, dAz, scale, outSwing, outNormal, wristCorrection = 0) {
  const fwd = -racket.side;
  const e = clamp(racket.elev * DEG + dElev, -1.30, 1.40);
  const a = clamp(racket.azSwing + dAz, -1.40, 1.40);
  const contact = racket.contact * DEG;
  // Preserve the actual contact face, including wrist pitch and lateral
  // brushing. Rebuilding only from contact degrees silently discarded both.
  /* The face follows the REQUESTED rotation, not the clamped one. `dElev`
   * and `e - racket.elev*DEG` are the same number until the swing hits the
   * +80° ceiling; past it the old expression froze the face, so a lob (whose
   * swing sits at 75°) could not be aimed at all: every assist rotation
   * above 0.09 rad was silently discarded and the shot stayed where the raw
   * gesture left it. The wrist keeps its own travel, and the grip envelope
   * below still bounds it. */
  let phi = clamp(Number.isFinite(racket.faceElev)
    ? racket.faceElev + dElev
    : (racket.arch.back ? e + contact : e - contact), -1.35, 1.35);
  phi += Number.isFinite(wristCorrection) ? wristCorrection : 0;
  const range = racket.faceEnvelope || paddleContactRange(racket.grip, racket.stroke && racket.stroke.id, racket.forehand !== false, racket.isServe);
  if (range) phi = clamp(phi, range[0] * DEG, range[1] * DEG);
  const af = clamp(racket.azFace + dAz, -1.35, 1.35);
  dirFromAngles(outSwing, e, a, fwd);
  dirFromAngles(outNormal, phi, af, fwd);
  V3.mul(outSwing, outSwing, racket.vmag * (racket.arch.absorb ? 1 - racket.arch.absorb : 1) * scale);
  return outSwing;
}

/**
 * Serve solver (ITTF 2.06.4: own bounce, over the net, receiver's bounce).
 *
 * Two things matter here and the previous version got both wrong:
 *   · it burned ~350 full flights per serve (measured 304 ms) — a visible
 *     freeze every time anyone served;
 *   · it happily returned a serve that flew long and then handed it to the
 *     player anyway, because nothing checked legality at the end. Measured
 *     result: one serve in four was illegal, at every assist level.
 *
 * The search is now a coordinate descent (azimuth → elevation × scale →
 * scale × softness → local polish) at a cheap integration step, and it walks
 * the placement target back towards the net until it finds a serve that is
 * genuinely legal. Legality is returned, not implied.
 */
const _svRep = {};
/* Warm starts for the serve search, keyed loosely (side, archetype, aim
 * bucket). The toss is authored, so consecutive serves differ only slightly
 * and the candidate that solved the last one usually solves this one. Every
 * warm start is re-verified at the production step before it is used, so a
 * stale entry can never produce an illegal serve: it costs one flight and
 * falls through to the full search. */
/* Ceiling on the bat speed a serve may actually be given, in m/s. The search
 * is allowed to scale the gesture up to make a serve legal and deep, and
 * without this it scaled a capped 12.5 m/s swing by 4.2 and produced an
 * 88 km/h "serve" — faster than any real serve ever measured, and a free
 * point rather than a rally. 12.5 m/s of bat through this impact model is
 * ~65-70 km/h of ball, which is the top of the professional range. */
const SERVE_VMAX = 12.5;
/* The same ceiling on any OTHER stroke's bat speed, in m/s. deriveStroke()
 * clamps its raw vmag here; refineRacket()'s scale search has to respect it
 * too, or the "physical aim assist" quietly turns a wrist flick into a
 * 40 m/s arm. */
const RACKET_VMAX = 19.5;
/* ...and the same ceiling expressed as ball speed, enforced inside the score
 * so the search never *chooses* a serve that is too fast to be played: at
 * 60 km/h off a 0.20 m contact the ball reaches the tape before it has had
 * time to rise over it, and the result was a serve that faulted into the net
 * in a third of attempts while looking like the player's own fault. */
const SERVE_BALL_MAX = 17.5;                 // m/s = 63 km/h

const SERVE_WARM = new Map();
function serveWarmKey(side, racket) {
  const st = racket.stroke || {};
  const aim = racket.aim || {};
  /* Quantise to the 15x15 cell size (0.09 m), not to a third of a metre.
   * The old key merged nine neighbouring cells into one entry, so the first
   * solve of an area answered for all of them — measured: the depth of the
   * second bounce was the same for every cell in a 0.33 m band. */
  return side + '|' + (racket.grip || 'legacy') + '|' + (racket.forehand !== false ? 'fh' : 'bh') + '|' + (st.id || '?') + '|' +
    Math.round((aim.z || 0) / 0.09) + '|' + Math.round((aim.x || 0) / 0.09);
}
function ownFor(aim, side) {
  return { x: aim.x * 0.35, z: side * (0.78 + Math.abs(aim.z) * 0.16) };
}

// The live solver has a single call-wide ceiling, including every fallback
// and fine confirmation. Offline calibration keeps the exhaustive reference.
// A private sentinel unwinds nested searches without swallowing real errors.
function solveServeStroke(ballP, racket, evalStroke, side, assist, realtime = false) {
  if (!realtime) return searchServeStroke(ballP, racket, evalStroke, side, assist);
  const work = { limit: 128, flights: 0, best: null };
  try {
    const result = searchServeStroke(ballP, racket, evalStroke, side, assist, work);
    return { ...(result.ok ? result : work.best || result), flights: work.flights, budgeted: true };
  }
  catch (stop) {
    if (stop !== work) throw stop;
    const result = work.accepted || work.best || { dE: 0, dA: 0, sc: 1, dmp: 1, ok: false, target: racket.aim };
    if (result.ok) {
      const key = serveWarmKey(side, racket);
      if (SERVE_WARM.size >= 96 && !SERVE_WARM.has(key)) SERVE_WARM.delete(SERVE_WARM.keys().next().value);
      SERVE_WARM.set(key, result);
    }
    return { ...result, flights: work.flights, budgeted: true };
  }
}
function searchServeStroke(ballP, racket, evalStroke, side, assist, work = null) {
  const aimReq = racket.aim || { x: 0, z: -side * 0.95 };
  const v = V3.new(), w = V3.new();
  let legal = false, why = 'none';

  /* Pace is part of the cost. The caller (AI level, tactic, or the player's
   * own gesture) asked for racket.vmag; `sc` is how much of it survived the
   * search. Geometry alone made the descent perfectly happy to halve the
   * swing whenever a softer ball happened to sit 3 cm closer to the aim
   * point — which is exactly why every serve in the game arrived at
   * 17 km/h no matter who was serving or what they had chosen. log() keeps
   * the penalty symmetric around the requested pace, and its weight is well
   * below the cheapest illegal branch (6.0), so a fast serve is never
   * bought with a fault. */
  /* One-sided on purpose. Slowing the swing down below what was asked for is
   * what produced the 17 km/h serve: geometry alone was happy to halve the
   * swing whenever a softer ball sat a few cm closer to the aim point, and a
   * symmetric penalty kept that habit. Going a little FASTER than asked is
   * the normal way to make a serve both legal and deep, so it is charged at a
   * fifth of the rate. */
  const PACE_W = 0.85;
  const PACE_W_UP = 0.17;
  /* What the caller wanted the ball to LEAVE with, along the flight axis
   * (rad/s). The search optimises placement and knows nothing about spin, so
   * left alone it walks to whatever geometry lands best and quietly throws the
   * corkscrew away: measured, a face turned 26 deg makes w.z = 0.10 of the cap
   * raw and 0.00 after the solve. Charging for the loss keeps the character of
   * the serve the server actually chose. Weight is well under the cheapest
   * illegal branch, so spin is never bought with a fault. */
  /* Weight sized against the rest of the score: losing the whole corkscrew
   * (~120 rad/s) costs ~0.9, which outweighs a 90 cm placement error but is
   * still an order of magnitude below the cheapest illegal branch (6.0), so
   * spin can never be bought with a fault. At 2.5 the solver happily traded
   * the entire w.z for a slightly better landing spot (measured: wanted
   * -128 rad/s, delivered -16). */
  const SPIN_W = 7.0;
  const spinWant = racket.spinWant || 0;
  /* Reference-search recovery cutoff, NOT a call-wide ceiling. The live
   * wrapper above enforces the actual 128-flight cap in score() itself.
   * The search is a heuristic and
   * a pathological gesture (a 6-sample tap) used to walk every ladder, every
   * recovery sweep and then be solved a second time by the caller: measured
   * 730 ms, i.e. 44 dropped frames, on a ball that was never going to be a
   * legal serve. Past the budget the search stops and returns the best
   * candidate it has, so the worst case is bounded and known. */
  const FLIGHT_BUDGET = 70;
  let flights = 0;
  /* Metres past the net a serve's second bounce must reach to be worth
   * playing (the bat's step-in limit is 0.86 m from the centre line). */
  const SERVE_MIN_PAST_NET = 0.70;
  /* Pace is charged against the swing the SERVER asked for — but a short
   * serve is soft by construction, and the old flat 0.85 per e-fold made it
   * strictly cheaper to ignore a short aim than to hit it (a serve at
   * sc 0.37 paid 0.85, more than a 0.6 m placement error). Weight the
   * penalty by how deep the aim is: softness is only "losing the player's
   * power" when the ball was supposed to be driven deep. Deep aims keep the
   * exact old cost (weight clamps at 1.0 for |z| >= 0.90 m). */
  const paceCost = (sc, aim) => {
    const l = Math.log(clamp(sc, 0.16, 4.5));
    if (l >= 0) return PACE_W_UP * l;
    const w = clamp((Math.abs((aim && aim.z) || 0) - SERVE_MIN_PAST_NET) / 0.50, 0, 1);
    return PACE_W * -l * w;
  };

  const score = (own, aim, dE, dA, sc, dmp, fine) => {
    if (work && work.flights >= work.limit) throw work;
    flights++;
    if (work) work.flights++;
    evalStroke(dE, dA, sc, dmp, v, w);
    legal = false; why = 'none';
    const pc0 = paceCost(sc, aim);
    if (v.z * side > -0.30) { why = 'back'; return 60; }      // not going forward
    const spd = V3.len(v);
    if (spd > SERVE_BALL_MAX) { why = 'fast'; return 7 + (spd - SERVE_BALL_MAX) * 0.6; }
    predict(V3.clone(launchPoint(ballP, _rn)), V3.clone(v), V3.clone(w),
      /* maxT has to be the same for the coarse and the fine pass. Cutting the
       * coarse pass to 1.6 s looked like free speed, but a soft serve needs
       * ~1.8 s to complete BOTH bounces — so the search never saw a second
       * bounce, scored the good solution as 'long', and walked away from it.
       * That is why a weak tap was a fault in 100 % of cases at every assist
       * level. stopAfterBounces already ends fast serves early, so the honest
       * horizon costs almost nothing. */
      { dt: fine ? PH.SIM_DT : 1 / 170, maxT: 2.2, stopAfterBounces: 2, out: _svRep });
    const r = _svRep;
    if (r.bounces === 0) { why = r.hitNet ? 'net' : 'none'; return 40 + (r.hitNet ? 4 : 0); }
    if (Math.sign(r.landed.z) !== side) { why = 'wrongside'; return 26 + Math.abs(r.landed.z - own.z) + pc0; }
    const d1 = Math.hypot(r.landed.x - own.x, r.landed.z - own.z);
    if (r.hitNet) { why = 'net'; return 12 + d1 * 0.3 + Math.max(0, PH.NET_TOP + PH.R - (r.netCross ? r.netCross.y : 0)) * 10 + pc0; }
    if (!r.b2) {                                              // flew past the table
      why = 'long';
      const pc = r.floor || r.planeCross;
      const miss = pc ? Math.hypot(pc.x - aim.x, pc.z - aim.z) : 1.2;
      return 6 + miss * 0.6 + d1 * 0.15 + pc0;                // includes going wide
    }
    if (Math.sign(r.b2.z) === side) { why = 'own'; return 9 + d1 + pc0; }   // double bounce, own half
    /* ITTF 2.06.4: the second bounce must be ON the receiver's court. The
     * old test only looked at the SIDE of the bounce, so a serve that flew
     * 30 cm past the end line was certified legal and scored as if it had
     * landed on the table (its only cost was the distance to the aim).
     * Measured on the 15x15 grid: 15-23 % of requested placements were
     * "valid" serves that actually missed the court. */
    const offX = Math.abs(r.b2.x) - PH.T_HALF_WID - PH.R * .5;
    const offZ = Math.abs(r.b2.z) - PH.T_HALF_LEN - PH.R * .5;
    if (offX > 0 || offZ > 0) {
      why = 'out';
      const miss = Math.hypot(Math.max(0, offX), Math.max(0, offZ));
      return 5.5 + miss * 2 + d1 * 0.15 + pc0;
    }
    legal = true; why = 'ok';
    const spinCost = spinWant ? SPIN_W * Math.abs(w.z - spinWant) / 1080 : 0;
    /* A serve whose second bounce dies just behind the net is the single
     * least playable ball in the game: it is legal, unreachable at pace, and
     * the descent used to be happy to produce it because it happened to sit
     * close to a shortened aim point. Penalise the dead zone hard — still far
     * below the cheapest illegal branch, so it can never buy a fault. */
    /* The dead zone exists so that a serve asked to go DEEP does not quietly
     * die behind the net, where it is legal but unplayable. It used to apply
     * to every aim at 5.0 per metre — five times the price of a placement
     * error — so for any SHORT aim the cheapest serve was always the deepest
     * legal one. Measured on the 15x15 grid: depth bias -0.24..-0.35 m on all
     * four serve types, 2-13 of 225 cells hit, while 98-165 cells are
     * physically reachable (reach_envelope.js; e.g. cell (7,12) is served by
     * dE -0.196, dA 0.013, sc 0.367, damp 0.58 to within 21 mm). Weight the
     * penalty by how deep the SERVER asked to go: an explicitly short serve
     * must be allowed to pay for itself. */
    const pastNet = Math.abs(r.b2.z);
    const aimDeep = clamp((Math.abs(aim.z) - SERVE_MIN_PAST_NET) / 0.50, 0, 1);
    const dead = (pastNet < SERVE_MIN_PAST_NET && aimDeep > 0)
      ? (SERVE_MIN_PAST_NET - pastNet) * 5.0 * aimDeep : 0;
    const error = Math.hypot(r.b2.x - aim.x, r.b2.z - aim.z);
    const cost = error + d1 * .22 + pc0 + dead + spinCost;
    if (work) {
      if (fine && (!work.best || cost < work.best.cost))
        work.best = { dE, dA, sc, dmp, ok: true, target: { ...aim }, cost };
      // A live contact needs a good legal answer, not every local optimum.
      // Production-step confirmation is mandatory before the early exit.
      const playable = Math.abs(aim.z) < SERVE_MIN_PAST_NET || pastNet >= SERVE_MIN_PAST_NET;
      if (playable && error <= .24 && pc0 + spinCost < .45) {
        if (!fine) score(own, aim, dE, dA, sc, dmp, true);
        else {
          work.accepted = { dE, dA, sc, dmp, ok: true, target: { ...aim }, cost };
          throw work;
        }
      }
    }
    return cost;
  };

  const SC = [0.30, 0.45, 0.65, 0.88, 1.15, 1.45];
  const DMP = [1, 0.58];
  let bE = 0, bA = 0, bS = 1, bD = 1, bV = Infinity, bAim = aimReq, bOwn = null, solvedLegal = false;

  /* --- warm start: one verified flight instead of a whole search --------- */
  const warmKey = serveWarmKey(side, racket);
  const warm = SERVE_WARM.get(warmKey);
  if (warm) {
    const aimW = { x: aimReq.x, z: aimReq.z };
    const ownW = ownFor(aimW, side);
    const sv = score(ownW, aimW, warm.dE, warm.dA, warm.sc, warm.dmp, true);
    /* A cached serve is only an answer to THIS aim. The old test asked only
     * "legal and not dead behind the net", so a serve solved for a far
     * corner was reused for a near-net cell 0.3 m away — the placement
     * matrix showed a nearly constant second-bounce depth across the whole
     * grid (mean dz -0.24..-0.35 m on all four serve types). */
    const warmErr = _svRep.b2 ? Math.hypot(_svRep.b2.x - aimW.x, _svRep.b2.z - aimW.z) : Infinity;
    const warmDeep = !_svRep.b2 ? false
      : (Math.abs(aimW.z) >= SERVE_MIN_PAST_NET
        ? Math.abs(_svRep.b2.z) >= SERVE_MIN_PAST_NET : true);
    if (legal && _svRep.b2 && warmDeep && warmErr <= 0.16) {
      bE = warm.dE; bA = warm.dA; bS = warm.sc; bD = warm.dmp;
      bV = sv; bAim = aimW; bOwn = ownW; solvedLegal = true;
    }
  }

  const aimBase = aimReq;

  // Live geometric seeds: express the face in world space, not as a guessed
  // correction to one particular swipe. These are only starting points;
  // every accepted answer still passes the actual impulse + two-bounce sim.
  if (work && !solvedLegal && ['SERVE_TOP', 'SERVE_BACK'].includes(racket.stroke && racket.stroke.id)) {
    const back = racket.stroke.id === 'SERVE_BACK';
    const faces = back ? [.05, -.10, .20] : [-.55, -.70, -.40];
    const az = clamp(Math.atan2(aimReq.x - ballP.x, side * (ballP.z - aimReq.z)) - racket.azFace, -1, 1);
    const speed = (back ? 4 : 2.8) + racket.vmag * .30;
    const seedScale = clamp(speed / Math.max(1.2, racket.vmag), .20, 3);
    for (const face of faces) for (const factor of [1, .85, 1.15]) {
      score(ownFor(aimReq, side), aimReq, face - racket.faceElev, az, seedScale * factor, 1, false);
    }
  }

  if (!solvedLegal) {
  // A hard topspin serve simply cannot be aimed at the very back line and
  // stay legal on a bad toss, so shorten the target until it works — but in
  // small steps. The old jump straight to 0.70 was what turned a slightly
  // mistossed serve into a ball that died behind the net and could not be
  // reached at all.
  for (const depthF of [1.0, 0.92, 0.84]) {
    const aim = { x: aimBase.x, z: aimBase.z * depthF };
    /* Where the FIRST bounce is wanted. It used to be 0.40 m in front of the
     * net, i.e. ~0.9 m away from the server's own end line — a loopy ball
     * that has to be hit upwards to arrive at all, which is half of why
     * serves looked floaty. Real servers bounce it near their own end line
     * and drive it through; 0.78 + a little of the requested depth does that
     * and, measured, lifts the median second bounce from 0.44 m to ~1.1 m
     * past the net. */
    const own = { x: aim.x * 0.35, z: side * (0.78 + Math.abs(aim.z) * 0.16) };

    // stage 1 — how far must the swing direction be pulled back to centre?
    let aBest = 0, aBestV = Infinity;
    for (let i = -3; i <= 3; i++) {
      const dA = i * 0.26;
      const sv = score(own, aim, 0, dA, 0.65, 1, false);
      if (sv < aBestV) { aBestV = sv; aBest = dA; }
    }
    // stage 2 — JOINT grid over elevation and swing scale. These two
    // interact (a lower face needs a longer swing to still carry the ball
    // over the net), so sweeping them one after the other walks into the
    // wrong valley and misses perfectly legal serves that are 20 cm away.
    // The range has to reach -0.9, not -0.6: a low contact (3-14 cm over
    // the table) with the ball still falling needs a downward swing over an
    // open face to bounce on the server's own half and then clear the tape.
    // Measured on the y=.90/.95 tosses in the solver grid: the legal serves
    // were all at dE -0.7..-0.9, outside the old grid, so the search fell
    // back to a soft serve that died on its own half.
    let eBest = 0, sBest = 0.65, vBest = Infinity;
    for (let i = -6; i <= 4; i++) {
      const dE = i * 0.15;
      for (const sc of [0.45, 0.75, 1.10, 1.45]) {
        const sv = score(own, aim, dE, aBest, sc, 1, false);
        if (sv < vBest) { vBest = sv; eBest = dE; sBest = sc; }
      }
    }
    /* A SHORT serve lives in a corner of the space the ladder above cannot
     * reach: it needs BOTH a small swing scale (~0.37 of the gesture) AND
     * soft hands (damp 0.58). Stage 2 sweeps elevation x scale with damp
     * fixed at 1, and stage 3 only scales that winner by 0.8-1.5x, so
     * (0.37, 0.58) is never evaluated — measured on the 15x15 grid: 2-13 of
     * 225 near-net cells hit, while witnesses for them exist
     * (dE -0.196, dA 0.013, sc 0.367, damp 0.58 lands within 21 mm of cell
     * (7,12)). Probe that corner explicitly, and only when the aim is short
     * enough for it to matter. */
    let dBest = 1;
    if (Math.abs(aim.z) < 0.80) {
      for (const dE of [-0.45, -0.30, -0.20, -0.05]) {
        for (const sc of [0.30, 0.37, 0.45, 0.55]) {
          for (const dmp of [1, 0.58]) {
            const sv = score(own, aim, dE, aBest, sc, dmp, false);
            if (sv < vBest) { vBest = sv; eBest = dE; sBest = sc; dBest = dmp; }
          }
        }
      }
    }
    // stage 3 — swing scale and softness around that winner
    for (const sMul of [0.8, 0.9, 1.0, 1.1, 1.25, 1.5]) for (const dmp of DMP) {
      const sc = Math.max(0.16, sBest * sMul);
      const sv = score(own, aim, eBest, aBest, sc, dmp, false);
      if (sv < vBest) { vBest = sv; sBest = sc; dBest = dmp; }
    }
    // stage 4 — local coordinate descent, confirmed at the production step
    for (let it = 0; it < 3; it++) {
      const sE = 0.05 / (it + 1), sA = 0.10 / (it + 1), sS = 0.10 / (it + 1);
      let improved = false;
      const fine = it === 2;
      for (const [ddE, ddA, mulS] of [[sE, 0, 1], [-sE, 0, 1], [0, sA, 1], [0, -sA, 1], [0, 0, 1 + sS], [0, 0, 1 - sS]]) {
        const sc2 = Math.max(0.16, sBest * mulS);
        const sv = score(own, aim, eBest + ddE, aBest + ddA, sc2, dBest, fine);
        if (sv < vBest) { vBest = sv; eBest += ddE; aBest += ddA; sBest = sc2; improved = true; }
      }
      if (!improved) break;
    }
    const sv = score(own, aim, eBest, aBest, sBest, dBest, true);
    if (sv <= vBest) { vBest = sv; solvedLegal = legal; }
    // Targeted recovery. The descent stops at the first local optimum; if
    // that optimum is still illegal, the simulation has just told us *why*,
    // and the response to swing scale is monotone: too slow dies on our own
    // half or in the net, too fast flies long. So bracket the scale and
    // bisect — a handful of flights, versus another full grid. This is what
    // used to cost a point every fourth serve.
    if (!solvedLegal && (why === 'long' || why === 'net' || why === 'own' || why === 'out')) {
      let lo = 0.10, hi = 2.10, sTry = sBest;
      for (let j = 0; j < 9 && !solvedLegal && hi - lo > 0.02; j++) {
        if (why === 'long' || why === 'out') hi = sTry; else lo = sTry;
        sTry = 0.5 * (lo + hi);
        const s2 = score(own, aim, eBest, aBest, sTry, dBest, true);
        if (legal) { vBest = Math.min(vBest, s2); sBest = sTry; solvedLegal = true; break; }
        if (s2 < vBest) { vBest = s2; sBest = sTry; }
      }
      // last resort: the other hand softness, at whatever scale we settled on
      if (!solvedLegal) {
        for (const dmp of [1, 0.58]) {
          const s2 = score(own, aim, eBest, aBest, sBest, dmp, true);
          if (legal) { vBest = Math.min(vBest, s2); dBest = dmp; solvedLegal = true; break; }
          if (s2 < vBest) { vBest = s2; dBest = dmp; }
        }
      }
    }
    // A serve that lands just past the sideline is a lateral miss: no amount
    // of swing scale will save it. Sweep the azimuth, then lift the face if
    // the ball is still finding the net.
    if (!solvedLegal) {
      for (const ddA of [0, -0.12, 0.12, -0.26, 0.26, -0.42, 0.42]) {
        const s2 = score(own, aim, eBest, aBest + ddA, sBest, dBest, true);
        if (legal) { vBest = Math.min(vBest, s2); aBest += ddA; solvedLegal = true; break; }
        if (s2 < vBest) { vBest = s2; aBest += ddA; }
      }
    }
    if (!solvedLegal && why === 'net') {
      const e0 = eBest;
      for (const ddE of [0.10, 0.20, 0.32]) {
        const s2 = score(own, aim, e0 + ddE, aBest, sBest, dBest, true);
        if (legal) { vBest = Math.min(vBest, s2); eBest = e0 + ddE; solvedLegal = true; break; }
        if (s2 < vBest) { vBest = s2; eBest = e0 + ddE; }
      }
    }
    /* Nothing legal at the speed the gesture produced. A weak tap is not a
     * serve at all — the ball would double-bounce on the server's own half —
     * and with assist on that must not become a fault: swing THROUGH it,
     * harder, until the ball is at least a legal serve. The ceiling follows
     * the assist slider, so assist 0 keeps the honest (faulting) result and
     * assist 1 guarantees a playable one. Measured before this: a weak tap
     * was legal in 0 % of cases even at full assist. */
    if (!solvedLegal) {
      const maxScale = Math.min(1.6 + 2.6 * clamp(assist, 0, 1),
        SERVE_VMAX / Math.max(0.5, racket.vmag || 1));
      for (const sc of [1.6, 2.2, 3.0, 4.0, 5.2]) {
        if (sc > maxScale || sc <= sBest) continue;
        const s2 = score(own, aim, eBest, aBest, sc, dBest, true);
        if (legal) { vBest = s2; sBest = sc; solvedLegal = true; break; }
        if (s2 < vBest) { vBest = s2; sBest = sc; }
      }
    }
    /* A tap is a downward flick: the swing points at the floor, and no amount
     * of scale turns a downward swing into a forward serve (score() rejects it
     * as 'back' before it ever simulates). Rotate the launch into the narrow
     * window a serve actually lives in — 30 deg down to 6 deg up — and re-solve
     * the speed there. Measured before this: a weak tap was a fault in 100 % of
     * cases at EVERY assist level, and the search burned 390 ms proving it. */
    if (!solvedLegal && flights <= FLIGHT_BUDGET) {
      /* Aim the FACE, not the swing. strokeFrame builds the face as
       * phi = e - contact (or e + contact for a backspin arch), so a target
       * written as a swing elevation means something completely different for
       * a grazing 56 deg contact: it turned the face 86 deg down and slammed
       * the ball into the server's own half. Expressed as a face angle, the
       * four candidates below are the window a real serve lives in — from a
       * slightly open face (slow, heavy) to a closed one (flat, fast). */
      const e0 = clamp(racket.elev * DEG, -1.30, 1.40);
      const cRad = clamp(racket.contact * DEG, 0, 1.40);
      const isBack = !!(racket.arch && racket.arch.back);
      const maxScale2 = Math.min(1.6 + 2.6 * clamp(assist, 0, 1),
        SERVE_VMAX / Math.max(0.5, racket.vmag || 1));
      for (const phi of [-0.26, -0.10, 0.06, 0.22]) {
        const eW = isBack ? phi - cRad : phi + cRad;
        const dE = clamp(eW - e0, -1.30, 1.30);
        for (const sc of [1.0, 1.5, 2.2, 3.2]) {
          if (sc > maxScale2) break;
          const s2 = score(own, aim, dE, aBest, sc, dBest, true);
          if (legal) { vBest = s2; eBest = dE; sBest = sc; solvedLegal = true; break; }
          if (s2 < vBest) { vBest = s2; eBest = dE; sBest = sc; }
        }
        if (solvedLegal || flights > FLIGHT_BUDGET) break;
      }
    }
    /* Only a DEPTH failure justifies another pass down the ladder. Walking
     * the target shorter cannot fix a swing that points at the floor ('back'),
     * a ball that finds the tape ('net') or one that goes wide — and each pass
     * is a full search (~55 flights). Pruning on `why` is what took a failing
     * soft serve from three searches to one. */
    if (vBest < bV) { bV = vBest; bE = eBest; bA = aBest; bS = sBest; bD = dBest; bAim = aim; bOwn = own; }
    if (solvedLegal) { bE = eBest; bA = aBest; bS = sBest; bD = dBest; bAim = aim; bOwn = own; solvedLegal = true; break; }
    /* Only a DEPTH failure justifies another pass down the ladder: walking the
     * target shorter cannot fix a swing that points at the floor ('back'), a
     * ball that finds the tape ('net') or one that goes wide — and each pass is
     * a full search (~55 flights). */
    if (why !== 'long' && why !== 'own') break;
    if (flights > FLIGHT_BUDGET) break;
  }
  }


  /* If the winner is legal but its second bounce dies behind the net, buy the
   * depth with swing speed rather than with another whole search: the flight
   * is what it is, and a deeper serve is the same stroke hit harder. */
  /* ...but ONLY when the serve was asked to go past that line. This block
   * used to fire on every legal serve, including one the player deliberately
   * placed near the net: it then multiplied the swing by 1.3-3.8 until the
   * second bounce cleared 0.70 m, undoing the aim. Measured on the 15x15
   * grid: the second bounce depth was the same for every near-net cell
   * (mean dz -0.24..-0.35 m), so no short cell could ever be hit even though
   * witnesses for them exist. */
  if (solvedLegal && Math.abs(bAim.z) >= SERVE_MIN_PAST_NET) {
    score(bOwn, bAim, bE, bA, bS, bD, true);
    let bz = _svRep.b2 ? Math.abs(_svRep.b2.z) : 0;
    if (bz < SERVE_MIN_PAST_NET) {
      const maxScale = Math.min(1.6 + 2.6 * clamp(assist, 0, 1),
        SERVE_VMAX / Math.max(0.5, racket.vmag || 1));
      let bestS = bS, bestV = Infinity;
      for (const mul of [1.3, 1.7, 2.2, 2.9, 3.8]) {
        const sc = bS * mul;
        if (sc > maxScale) break;
        const s2 = score(bOwn, bAim, bE, bA, sc, bD, true);
        if (!legal) continue;
        const z2 = _svRep.b2 ? Math.abs(_svRep.b2.z) : 0;
        if (s2 < bestV) { bestV = s2; bestS = sc; }
        if (z2 >= SERVE_MIN_PAST_NET) { bestV = s2; bestS = sc; break; }
      }
      if (bestV < Infinity) { bS = bestS; score(bOwn, bAim, bE, bA, bS, bD, true); }
    }
  }

  // Safety net. If the player's gesture simply does not admit a legal serve
  // (a wild flick, a ball caught on the way up), play a plain, safe serve
  // instead of handing them a fault they cannot see coming. Losing a point
  // to the solver is the one thing a serve must never do.
  if (!solvedLegal) {
    const own = { x: 0, z: side * 0.55 };
    const aim = { x: 0, z: -side * 1.00 };   // deep and central: always reachable
    let sB = 0.8, dB = 1, eB = 0.0, aB = 0.0, svBest = Infinity;
    /* The descent is a local optimiser: it can settle in a valley where the
     * only legal serves need BOTH a downward swing and a square face, e.g. a
     * toss caught 14 cm over the table and still falling. The old fallback
     * only varied scale and lift around dE=0, so it never left that valley
     * (measured: 3 of 144 solver-grid serves still faulted, all with the
     * legal solution at dE -0.6..-0.9). This is the bounded global sweep that
     * exists for exactly those gestures; it stops at the first legal serve. */
    /* A LATE toss needs the bottom of this ladder. The ball is caught ~0.15 s
     * after the apex with the bat already under it, so the only legal serves
     * swing LEVEL over a steeply open face: measured on the real 0.44 s serve,
     * every legal candidate sat at dE <= -1.05, outside the old -0.9 floor,
     * and the solver handed the player a 2 m/s poke that bounced on their own
     * half and died. -1.25 is the bottom of strokeFrame()'s own clamp. */
    const lifts = [-1.25, -1.05, -0.9, -0.75, -0.6, -0.3, 0, 0.3];
    const azes = [0, -0.3, 0.3];
    const scales = [0.7, 0.4, 0.55, 0.95, 1.25];
    let found = false;
    for (const dE of lifts) {
      for (const sc of scales) {
        for (const dA of azes) {
          const sv = score(own, aim, dE, dA, sc, 1, false);
          /* The sweep scans at the cheap step, so a candidate it calls legal
           * can still fault at the production step. The old code accepted the
           * first coarse "legal" and confirmed nothing — with a bad toss the
           * serve it certified was a net fault in the live frame. Confirm the
           * winner here, exactly as the main descent does in stage 4. */
          if (legal) {
            const svF = score(own, aim, dE, dA, sc, 1, true);
            if (legal) { eB = dE; aB = dA; sB = sc; dB = 1; solvedLegal = true; found = true; break; }
            if (svF < svBest) { svBest = svF; eB = dE; aB = dA; sB = sc; }
            continue;
          }
          if (sv < svBest) { svBest = sv; eB = dE; aB = dA; sB = sc; }
        }
        if (found) break;
      }
      if (found) break;
    }
    if (solvedLegal) { bE = eB; bA = aB; bS = sB; bD = dB; bAim = aim; bOwn = own; }
  }

  // A weaker player keeps part of their own error — but never to the point
  // of an illegal serve, which is simply not fun.
  const k = clamp(0.45 + 0.55 * assist, 0, 1);
  const fE = bE * k, fA = bA * k, fS = 1 + (bS - 1) * k, fD = 1 + (bD - 1) * k;
  score(bOwn, bAim, fE, fA, fS, fD, true);
  /* ...and never to the point of a ball that dies behind the net. The
   * retained error is applied AFTER the search, so the search cannot see it:
   * a weak server could ask for 1.05 m, solve it, then keep enough of its own
   * wobble to drop the second bounce 25 cm past the net — legal, and
   * unreturnable at pace. Inaccuracy should cost the opponent placement, not
   * the receiver the point. Measured before this guard: 32.5 % of a beginner's
   * serves landed shorter than 0.62 m; the solve itself was already deep. */
  const deepEnough = legal && _svRep.b2 && Math.abs(_svRep.b2.z) >= SERVE_MIN_PAST_NET;
  if (globalThis.__svDbg) globalThis.__svDbg.push({ tag: 'final', legal, deepEnough,
    f: [fE, fA, fS, fD], b: [bE, bA, bS, bD], aim: bAim && { x: bAim.x, z: bAim.z },
    own: bOwn && { x: bOwn.x, z: bOwn.z }, b2: _svRep.b2 && { x: _svRep.b2.x, z: _svRep.b2.z },
    landed: _svRep.landed && { x: _svRep.landed.x, z: _svRep.landed.z } });
  if (deepEnough) {
    if (SERVE_WARM.size < 96) SERVE_WARM.set(warmKey, { dE: bE, dA: bA, sc: bS, dmp: bD });
    return { dE: fE, dA: fA, sc: fS, dmp: fD, ok: true, target: bAim };
  }
  // The player's own error would have produced an illegal serve: give them
  // the solved one instead. Only a truly absurd gesture can fail here.
  score(bOwn, bAim, bE, bA, bS, bD, true);
  if (legal && _svRep.b2 && SERVE_WARM.size < 96)
    SERVE_WARM.set(warmKey, { dE: bE, dA: bA, sc: bS, dmp: bD });
  return { dE: bE, dA: bA, sc: bS, dmp: bD, ok: legal, target: bAim };
}

/** Recover (face elevation, azimuth) from a world-space face normal, in the
 *  exact convention strokeFrame() builds it with. Used whenever the bat's
 *  real orientation — not an archetype — has to drive the impact, otherwise
 *  the assist rebuilds a square face and the player's angle is thrown away. */
function anglesFromNormal(n, side) {
  const fwd = -side;
  const ny = clamp(Number.isFinite(n.y) ? n.y : 0, -1, 1);
  const phi = Math.asin(ny);
  let az = Math.atan2(n.x || 0, fwd * (n.z || -fwd));
  if (!Number.isFinite(az)) az = 0;
  return { phi, az, elevDeg: phi / DEG, azDeg: az / DEG };
}

/**
 * Passive contact (a block): the ball arrives at a bat that is not swinging.
 *
 * The face the player can see IS the physics here. Running the placement
 * solver on a block was actively wrong: the assist chased an aim point a dead
 * rubber cannot reach, lifted the face by up to 46 deg, returned valid=false,
 * and popped the ball up and back towards the player at 4.6 m/s no matter
 * which angle they were holding (measured, suite 7: lateral error 181 deg at a
 * square face, i.e. the ball went the wrong way).
 *
 * So: keep the face, keep the bat's own velocity, and allow exactly one
 * correction — if the block would go into the tape, lift the launch by the
 * smallest of a few fixed steps that clears it. The lift is a pure +y offset
 * on the normal, which leaves the x/z ratio untouched, so the lateral angle
 * the player is holding survives exactly.
 *
 * @returns {{normal:object, liftDeg:number, hitNet:boolean}}
 */
const _blkV = V3.new(), _blkW = V3.new(), _blkRep = {};
const BLOCK_LIFTS = [0, 4, 8, 13, 20];
function solveBlockNormal(ballP, ballV, ballW, face, vR, quality, rubber, out) {
  const o = out || {};
  const up = { x: 0, y: 1, z: 0 };
  let chosen = null, chosenLift = 0, clears = false;
  for (let i = 0; i < BLOCK_LIFTS.length; i++) {
    const lift = BLOCK_LIFTS[i];
    const nl = V3.norm(V3.new(),
      V3.addScaled(V3.new(), face, up, Math.tan(lift * DEG) * V3.len(face)));
    V3.copy(_blkV, ballV); V3.copy(_blkW, ballW);
    impactRacket(_blkV, _blkW, nl, vR, quality, rubber || {});
    predict(V3.clone(ballP), V3.clone(_blkV), V3.clone(_blkW),
      { dt: PH.SIM_DT, maxT: 1.4, stopOnFirstBounce: true, out: _blkRep });
    if (!chosen) { chosen = nl; chosenLift = lift; }
    if (!_blkRep.hitNet) { chosen = nl; chosenLift = lift; clears = true; break; }
  }
  o.normal = chosen || V3.clone(face);
  o.liftDeg = chosenLift;
  o.hitNet = !clears;
  return o;
}

/** A refined stroke is a new physical frame, not just a replacement normal.
 * Keep its angle metadata consistent, so a second refinement starts from
 * the frame the player actually sees rather than the unassisted gesture. */
function resolvedRacketFrame(racket, normal, swing, extra) {
  const n = V3.norm(V3.new(), normal), v = V3.clone(swing);
  const fwd = -racket.side, speed = V3.len(v);
  const absorb = racket.arch.absorb ? 1 - racket.arch.absorb : 1;
  return { ...racket, ...extra, normal: n, vR: v,
    faceElev: Math.asin(clamp(n.y, -1, 1)), azFace: Math.atan2(n.x, n.z * fwd),
    elev: Math.asin(clamp(v.y / (speed || 1), -1, 1)) / DEG,
    azSwing: Math.atan2(v.x, v.z * fwd), vmag: speed / absorb };
}

function refineRacket(ballP, ballV, ballW, racket, assist, quality, realtime = false) {
  const fwd = -racket.side;
  const rubber = Object.assign({}, racket.rubber || {});
  const q = quality !== undefined ? quality : racket.quality;
  const side = racket.side;
  let wristCorrection = 0;

  const evalStroke = (dE, dA, sc, dmp, outV, outW) => {
    strokeFrame(racket, dE, dA, sc, _rs, _rn, wristCorrection);
    /* The serve ceiling has to live inside the search, not only after it.
     * The search was free to validate a swing at scale 1.25-1.5 and
     * `refineRacket` then clamped the returned velocity to SERVE_VMAX, so the
     * ball that flew was slower than the one that was proven legal — measured
     * on a late toss: the solver accepted a 15.6 m/s swing, the clamp cut it
     * to 12.5, and the serve died on the server's own half (1 bounce, fault). */
    if (racket.isServe) {
      const sp = V3.len(_rs);
      if (sp > SERVE_VMAX) V3.mul(_rs, _rs, SERVE_VMAX / sp);
    }
    V3.copy(outV, ballV); V3.copy(outW, ballW);
    rubber.damp = dmp;
    impactRacket(outV, outW, _rn, _rs, q, rubber);
  };

  /* ---- 0. a SERVE is a different problem ------------------------- *
   *  Rule 2.06.4: the ball must first bounce on the server's own court,
   *  pass over (or around) the net, then bounce on the receiver's court.
   *  A single-landing solver cannot express that, so serves get their own
   *  search that scores the WHOLE flight, two bounces included.        */
  if (racket.isServe) {
    const srv = solveServeStroke(ballP, racket, evalStroke, side, assist, realtime);
    strokeFrame(racket, srv.dE, srv.dA, srv.sc, _rs, _rn);
    /* Last line of defence: whatever the search settled on, a serve never
       leaves the bat faster than SERVE_VMAX. */
    const spd = V3.len(_rs);
    if (spd > SERVE_VMAX) V3.mul(_rs, _rs, SERVE_VMAX / spd);
    rubber.damp = srv.dmp;
    return resolvedRacketFrame(racket, _rn, _rs, {
      rubber,
      dElev: srv.dE, dAz: srv.dA, scale: srv.sc, damp: srv.dmp,
      solved: true, valid: srv.ok, target: srv.target, solveFlights: srv.flights || null,
    });
  }

  /* ---- 1. what does the untouched gesture physically do? ---------- */
  evalStroke(0, 0, 1, 1, _rv, _rw);
  const rawReport = {};
  predict(V3.clone(launchPoint(ballP, _rn)), V3.clone(_rv), V3.clone(_rw),
    { dt: 1 / 280, maxT: 2.6, stopOnFirstBounce: true, out: rawReport });
  racket.rawReport = rawReport;
  if (assist <= 0.001) return racket;

  // where did the raw shot "want" to go?
  let rawX, rawZ;
  if (rawReport.landed) { rawX = rawReport.landed.x; rawZ = rawReport.landed.z; }
  else if (rawReport.hitNet) {
    rawX = rawReport.netCross ? rawReport.netCross.x : ballP.x;
    rawZ = -side * 0.12;                          // just over the net
  } else if (rawReport.planeCross) { rawX = rawReport.planeCross.x; rawZ = rawReport.planeCross.z; }
  else { rawX = racket.aim.x; rawZ = racket.aim.z; }
  // keep the blend sane
  rawX = clamp(rawX, -2.2, 2.2); rawZ = clamp(rawZ, -3.2, 3.2);

  /* ---- 2. the assisted target is a blend of mistake and intent ---- */
  const target = {
    x: lerp(rawX, racket.aim.x, assist),
    z: lerp(rawZ, racket.aim.z, assist),
  };
  // never aim into your own half
  if (Math.sign(target.z) === side || Math.abs(target.z) < 0.10) target.z = -side * 0.22;

  /* The human ceiling on bat speed, shared with deriveStroke(). `sc` is a
   * MULTIPLIER on the gesture the player actually made, and the guard pass
   * below used to raise it to 2.20 regardless of how fast that gesture
   * already was. A fast downward flick (vmag ~19) therefore left the bat at
   * 43 m/s and a 1.9 m/s ball came back at 25 m/s — a return nobody could
   * have produced. The assist may rotate technique freely; it may not make
   * the arm faster than the archetype model allows. */
  const absorbK = racket.arch && racket.arch.absorb ? 1 - racket.arch.absorb : 1;
  const scCeil = RACKET_VMAX / Math.max(0.5, racket.vmag * absorbK);

  /* ---- 3. converge the stroke rotation onto that target ----------- */
  let dE = 0, dA = 0, sc = 1, dmp = 1, sol = null, converged = false;
  for (let outer = 0; outer < (realtime ? 1 : 3); outer++) {
    sol = solveLaunch(ballP, target, _rw, {
      speed: V3.len(_rv),
      netClear: racket.netClear,
      speedForgive: 0,                       // power is the player's business
    });
    if (!sol) break;
    // if even the flattest trajectory overshoots, soften the hands
    if (sol.err > 0.22 && dmp > 0.42) { dmp = Math.max(0.42, dmp * 0.80); }
    const want = V3.new(sol.vx, sol.vy, sol.vz);
    const wantLen = V3.len(want);
    const wd = V3.norm(V3.new(), want);
    const wE = Math.asin(clamp(wd.y, -1, 1));
    const wA = Math.atan2(wd.x, fwd * wd.z);
    for (let it = 0; it < 9; it++) {
      evalStroke(dE, dA, sc, dmp, _rv, _rw);
      const got = V3.len(_rv);
      if (got < 0.3) { sc *= 1.4; continue; }
      const gd = V3.norm(V3.new(), _rv);
      const gE = Math.asin(clamp(gd.y, -1, 1));
      const gA = Math.atan2(gd.x, fwd * gd.z);
      const eErr = wE - gE, aErr = wA - gA, sErr = wantLen / got;
      const relax = it < 3 ? 0.82 : 0.52;
      dE = clamp(dE + eErr * relax, -1.05, 1.15);
      dA = clamp(dA + aErr * relax * 0.9, -1.0, 1.0);
      // The assist polishes technique; it may NOT make you a different
      // athlete. Swing scale stays inside a believable human band and the
      // only other lever is how softly the hand holds the bat (damp).
      const scLo = racket.arch.absorb ? 0.12 : 0.45, scHi = Math.min(1.50, scCeil);
      if (sErr < 1) {
        const next = sc * Math.pow(sErr, 0.55);
        sc = clamp(next, scLo, scHi);
        if (next < scLo && dmp > 0.30) dmp = Math.max(0.30, dmp * 0.85);
      } else {
        if (dmp < 1 && sc > scHi * 0.92) dmp = Math.min(1, dmp * 1.18);
        sc = clamp(sc * Math.pow(sErr, 0.60), scLo, scHi);
      }
      if (Math.abs(eErr) < 0.004 && Math.abs(aErr) < 0.006 && Math.abs(sErr - 1) < 0.015) {
        // The frame now reproduces the wanted launch exactly: re-solving with
        // a fresher spin vector cannot improve it, and each extra solve costs
        // a dozen full flights inside the contact frame.
        converged = true;
        break;
      }
    }
    if (converged || sol.err < 0.12) break;
  }
  if (!sol) return racket;

  /* ---- 3b. apply the polish IN PROPORTION to the help asked for ---*
   * Without this the solver is all-or-nothing: any assist above zero
   * converged the stroke completely onto the target and the slider did
   * nothing between 0.1 and 1.0. The correction is a rotation of the
   * player's own stroke, so scaling it is physically meaningful — it is
   * the difference between a trained arm and an untrained one.         */
  const polish = Math.pow(clamp(assist, 0, 1), 1.18);
  dE *= polish; dA *= polish;
  sc = 1 + (sc - 1) * polish;
  dmp = 1 + (dmp - 1) * polish;

  /* ---- 4. guarantee pass: never leave the player with a shot that
   *        clips the net or dies on their own half when they asked for
   *        a clean one. Nudges the elevation in small physical steps.
   *        How hard it tries is itself a function of the assist, so a
   *        low setting really does let the ball go into the net.       */
  const chk = {};
  let validationFlights = 0;
  const validate = (e_, a_, s_, d_, fine) => {
    validationFlights++;
    evalStroke(e_, a_, s_, d_, _rv, _rw);
    /* The confirmation runs at the PRODUCTION step (PH.SIM_DT), the same
     * integration the live ball gets, and demands a little clearance over
     * the tape. At 1/280 a chop off a low ball stepped straight over the
     * net while the live 1/600 ball clipped it — `valid: true`, net ball. */
    predict(V3.clone(launchPoint(ballP, _rn)), V3.clone(_rv), V3.clone(_rw),
      { dt: fine ? PH.SIM_DT : 1 / 150, maxT: 2.6, stopOnFirstBounce: true, out: chk });
    if (chk.hitNet) return -1;
    if (fine && chk.netCross && chk.clear < 0.004) return -1;
    if (!chk.landed) return 1;
    if (Math.sign(chk.landed.z) === side) return -1;
    return 0;
  };
  const guard = Math.round(clamp((assist - 0.22) / 0.78, 0, 1) * 16);
  let verdict = validate(dE, dA, sc, dmp, false);
  for (let k = 0; k < guard && verdict !== 0; k++) {
    const step = 0.035 + k * 0.012;
    // Where did the shot actually end up? Correction used to be vertical
    // only, which is why a hook that curved past the sideline simply could
    // not be saved: the error was lateral, so it has to be answered with
    // azimuth, not with elevation.
    const latErr = chk.landed ? chk.landed.x - target.x : 0;
    if (verdict < 0) {
      dE += step;
      if (Math.abs(latErr) > 0.16) dA = clamp(dA - Math.sign(latErr) * step * 0.85, -1.15, 1.15);
      sc = clamp(sc * 1.05, 0.12, Math.min(2.20, scCeil)); dmp = Math.min(1, dmp * 1.05);
    } else {
      dE -= step * 0.8;
      if (Math.abs(latErr) > 0.16) dA = clamp(dA - Math.sign(latErr) * step * 0.85, -1.15, 1.15);
      dmp = Math.max(0.26, dmp * 0.94); sc = clamp(sc * 0.97, 0.10, 2.20);
    }
    verdict = validate(dE, dA, sc, dmp, k > guard - 4);
  }
  // The cheap checks can flatter a shot; confirm at the production step, and
  // keep nudging if the fine integration disagrees with the coarse one.
  // (validate returns 0 for a legal shot, so the test is `!== 0`, not `!`.)
  verdict = validate(dE, dA, sc, dmp, true);
  for (let j = 0; j < 6 && verdict !== 0; j++) {
    if (verdict < 0) {                      // net, or died on our own half
      dE += 0.03 + j * 0.02;
      sc = clamp(sc * 1.04, 0.12, Math.min(2.20, scCeil));
    } else {                                // long
      dE -= 0.02 + j * 0.015;
      sc = clamp(sc * 0.98, 0.10, 2.20);
      dmp = Math.max(0.30, dmp * 0.96);
    }
    verdict = validate(dE, dA, sc, dmp, true);
  }

  // A grip-constrained face can reach its limit before the arm has found a
  // useful path. Rotating both together then has a flat/reversed gradient.
  // Separate wrist flexion from arm elevation, as a real loop does. This
  // bounded recovery is only for high assistance and an otherwise illegal
  // shot; it never edits ball velocity or escapes the grip's face envelope.
  const envelope = racket.faceEnvelope || paddleContactRange(racket.grip, racket.stroke && racket.stroke.id, racket.forehand !== false, false);
  if (verdict !== 0 && assist >= .65 && envelope) {
    const candidates = [];
    const aimAz = clamp(Math.atan2(target.x - ballP.x, fwd * (target.z - ballP.z)) - racket.azFace, -1, 1);
    const maxScale = Math.min(1.35, 19.5 / Math.max(.8, racket.vmag));
    for (const face of [envelope[1], (envelope[0] + envelope[1]) * .5, envelope[0]]) {
      for (const arm of [35, 50, 20, 65]) {
        for (const scale of [Math.min(1, maxScale), Math.min(.75, maxScale), maxScale]) {
          if (realtime && validationFlights >= 42) continue; // reserve six fine confirmations
          const de = arm * DEG - racket.elev * DEG;
          wristCorrection = face * DEG - (racket.faceElev + de);
          if (validate(de, aimAz, scale, 1, false) !== 0) continue;
          const distance = Math.hypot(chk.landed.x - target.x, chk.landed.z - target.z);
          const cost = distance + Math.abs(de) * .08 + Math.abs(wristCorrection) * .08 + Math.abs(1 - scale) * .1;
          candidates.push({ de, da: aimAz, scale, wrist: wristCorrection, cost });
        }
      }
    }
    candidates.sort((a, b) => a.cost - b.cost);
    wristCorrection = 0;
    for (const candidate of candidates.slice(0, 6)) {
      wristCorrection = candidate.wrist;
      if (validate(candidate.de, candidate.da, candidate.scale, 1, true) !== 0) { wristCorrection = 0; continue; }
      dE = candidate.de; dA = candidate.da; sc = candidate.scale; dmp = 1;
      verdict = 0; break;
    }
  }

  const swing = V3.new(), normal = V3.new();
  strokeFrame(racket, dE, dA, sc, swing, normal, wristCorrection);
  rubber.damp = dmp;
  return resolvedRacketFrame(racket, normal, swing, { rubber, dElev: dE, dAz: dA, dWrist: wristCorrection, scale: sc, damp: dmp, solved: sol, target, valid: verdict === 0 });
}

/** Live contacts use bounded search; calibration remains exhaustive. */
function refineRacketRealtime(ballP, ballV, ballW, racket, assist, quality) {
  return refineRacket(ballP, ballV, ballW, racket, assist, quality, true);
}

/** Cheap post-hoc report of where a struck ball will actually go. */
function shotReport(p, v, w, out) {
  return predict(V3.clone(p), V3.clone(v), V3.clone(w),
    { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: out || _rout });
}
