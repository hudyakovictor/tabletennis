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
    this.active = false;
    this.samples = [];          // {x,y,t} normalized screen units (y down)
    this.maxSamples = 64;
    this.startT = 0;
    this.m = this.blankMetrics();
    this.lastReleased = null;
  }
  blankMetrics() {
    return {
      sx: 0, sy: 0, x: 0, y: 0, dx: 0, dy: 0,
      dist: 0, pathLen: 0, straightness: 1,
      speed: 0, peakSpeed: 0, releaseSpeed: 0, accel: 0,
      angle: 0, angleDeg: 0, up: 0, right: 0,
      curl: 0, dur: 0, samples: 0, jerk: 0, smooth: 1,
    };
  }
  down(x, y, t) {
    this.active = true; this.startT = t;
    this.samples.length = 0;
    this.samples.push({ x, y, t });
    this.m = this.blankMetrics();
    this.m.sx = x; this.m.sy = y; this.m.x = x; this.m.y = y;
  }
  move(x, y, t) {
    if (!this.active) return;
    const s = this.samples, last = s[s.length - 1];
    if (last && t - last.t < 0.0025) { last.x = x; last.y = y; return; }
    s.push({ x, y, t });
    if (s.length > this.maxSamples) s.shift();
    this.compute(t);
  }
  /** Abandon the gesture without producing a stroke — used when a second
   *  finger lands and the touch turns into a camera orbit. */
  cancel() {
    this.active = false;
    this.samples.length = 0;
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
  SERVE_BACK: { elev: -40, contact: 72, speed: 0.75, lat: 0.60, back: true },
  SERVE_SIDE: { elev: 10, contact: 62, speed: 0.85, lat: 2.00, back: false },
  SERVE_FAST: { elev: 2, contact: 26, speed: 1.00, lat: 0.60, back: false },
};

/** Pick the archetype. Ordering matters: situational shots win over generic. */
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

  if (ctx.isServe) {
    if (veryFast && Math.abs(u) < 0.45) return STROKES.SERVE_FAST;
    if (latMag > 0.70 || curly) return STROKES.SERVE_SIDE;
    if (u < -0.18) return STROKES.SERVE_BACK;
    return STROKES.SERVE_TOP;
  }
  // tiny gesture = touch play
  if (m.dist < 0.050 && sp01 < 0.45) {
    if (incSpeed > 7.0 || incomingTop > 220) return STROKES.BLOCK;
    return (overTable && hAboveTable < 0.34) ? STROKES.DROP : STROKES.BLOCK;
  }
  // finishing a high ball always beats everything else
  if (hAboveNet > 0.14 && sp01 > 0.52 && u < 0.52) return STROKES.SMASH;
  // downward gestures = backspin family
  if (u < -0.28) {
    if (depth > PH.T_HALF_LEN + 0.40 || (fast && m.dist > 0.20)) return STROKES.CHOP;
    if (sp01 < 0.22 && overTable && hAboveTable < 0.35) return STROKES.DROP;
    return STROKES.PUSH;
  }
  // a clearly curved sideways gesture = sidespin
  if (latMag > 0.58 && curly) return (r > 0) ? STROKES.HOOK : STROKES.FADE;
  // upward gestures = topspin family
  if (u > 0.70) {
    if (slow && hAboveTable < 0.55) return STROKES.LOB;
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

  let vmag = 2.0 + 15.5 * Math.pow(sp01, 0.82);
  vmag = clamp(vmag * A.speed * (Number.isFinite(ctx.powerScale) ? ctx.powerScale : 1), 0.8, 19.5);
  if (!Number.isFinite(vmag)) vmag = 4.0;          // last line of defence

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
  const phi = (A.back ? eR + vertContact : eR - vertContact);
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
    stroke: st, arch: A, vR, normal, vmag, aim: { x: aimX, z: aimZ },
    power: sp01, quality, elev, contact, azSwing, azFace, spinIntent, rubber,
    swipe: m, side, isServe: !!ctx.isServe,
    netClear: st.id === 'LOB' ? 0.50 : st.id === 'DROP' ? 0.035
      : st.id === 'SMASH' ? 0.040 : st.id === 'CHOP' ? 0.075 : 0.055,
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

function dirFromAngles(out, elev, az, fwd) {
  out.x = Math.sin(az) * Math.cos(elev);
  out.y = Math.sin(elev);
  out.z = fwd * Math.cos(az) * Math.cos(elev);
  return V3.norm(out, out);
}

/** Rebuild (swing, normal) for a stroke rotated by (dElev, dAz). */
function strokeFrame(racket, dElev, dAz, scale, outSwing, outNormal) {
  const fwd = -racket.side;
  const e = clamp(racket.elev * DEG + dElev, -1.30, 1.40);
  const a = clamp(racket.azSwing + dAz, -1.40, 1.40);
  const contact = racket.contact * DEG;
  const phi = clamp(racket.arch.back ? e + contact : e - contact, -1.25, 1.35);
  const af = clamp(racket.azFace + dAz, -1.10, 1.10);
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
function solveServeStroke(ballP, racket, evalStroke, side, assist) {
  const aimBase = racket.aim || { x: 0, z: -side * 0.95 };
  const v = V3.new(), w = V3.new();
  let legal = false, why = 'none';

  const score = (own, aim, dE, dA, sc, dmp, fine) => {
    evalStroke(dE, dA, sc, dmp, v, w);
    legal = false; why = 'none';
    if (v.z * side > -0.30) { why = 'back'; return 60; }      // not going forward
    predict(V3.clone(ballP), V3.clone(v), V3.clone(w),
      { dt: fine ? 1 / 300 : 1 / 160, maxT: 2.4, out: _svRep });
    const r = _svRep;
    if (r.bounces === 0) { why = r.hitNet ? 'net' : 'none'; return 40 + (r.hitNet ? 4 : 0); }
    if (Math.sign(r.landed.z) !== side) { why = 'wrongside'; return 26 + Math.abs(r.landed.z - own.z); }
    const d1 = Math.hypot(r.landed.x - own.x, r.landed.z - own.z);
    if (r.hitNet) { why = 'net'; return 12 + d1 * 0.3 + Math.max(0, PH.NET_TOP + PH.R - (r.netCross ? r.netCross.y : 0)) * 10; }
    if (!r.b2) {                                              // flew past the table
      why = 'long';
      const pc = r.floor || r.planeCross;
      const miss = pc ? Math.hypot(pc.x - aim.x, pc.z - aim.z) : 1.2;
      return 6 + miss * 0.6 + d1 * 0.15;                      // includes going wide
    }
    if (Math.sign(r.b2.z) === side) { why = 'own'; return 9 + d1; }   // double bounce, own half
    legal = true; why = 'ok';
    return Math.hypot(r.b2.x - aim.x, r.b2.z - aim.z) + d1 * 0.22;
  };

  const SC = [0.30, 0.45, 0.65, 0.88, 1.15, 1.45];
  const DMP = [1, 0.58];
  let bE = 0, bA = 0, bS = 1, bD = 1, bV = Infinity, bAim = aimBase, bOwn = null, solvedLegal = false;

  // A hard topspin serve simply cannot be aimed at the very back line and
  // stay legal on a bad toss, so shorten the target until it works.
  for (const depthF of [1.0, 0.70]) {
    const aim = { x: aimBase.x, z: aimBase.z * depthF };
    const own = { x: aim.x * 0.35, z: side * (0.40 + Math.abs(aim.z) * 0.16) };

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
    // The elevation range has to cover -0.6: a heavy backspin serve lives
    // down there with a big swing scale.
    let eBest = 0, sBest = 0.65, vBest = Infinity;
    for (let i = -4; i <= 4; i++) {
      const dE = i * 0.15;
      for (const sc of [0.45, 0.75, 1.10, 1.45]) {
        const sv = score(own, aim, dE, aBest, sc, 1, false);
        if (sv < vBest) { vBest = sv; eBest = dE; sBest = sc; }
      }
    }
    // stage 3 — swing scale and softness around that winner
    let dBest = 1;
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
    if (!solvedLegal && (why === 'long' || why === 'net' || why === 'own')) {
      let lo = 0.10, hi = 2.10, sTry = sBest;
      for (let j = 0; j < 9 && !solvedLegal && hi - lo > 0.02; j++) {
        if (why === 'long') hi = sTry; else lo = sTry;
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
    if (vBest < bV) { bV = vBest; bE = eBest; bA = aBest; bS = sBest; bD = dBest; bAim = aim; bOwn = own; }
    if (solvedLegal) { bE = eBest; bA = aBest; bS = sBest; bD = dBest; bAim = aim; bOwn = own; solvedLegal = true; break; }
  }

  // Safety net. If the player's gesture simply does not admit a legal serve
  // (a wild flick, a ball caught on the way up), play a plain, safe serve
  // instead of handing them a fault they cannot see coming. Losing a point
  // to the solver is the one thing a serve must never do.
  if (!solvedLegal) {
    const own = { x: 0, z: side * 0.55 };
    const aim = { x: 0, z: -side * 0.75 };
    let sB = 0.8, dB = 1, eB = 0.0, aB = 0.0, svBest = Infinity;
    for (const sc of [0.5, 0.7, 0.95, 1.25]) for (const dmp of DMP) {
      const sv = score(own, aim, 0, 0, sc, dmp, false);
      if (legal) { sB = sc; dB = dmp; solvedLegal = true; break; }
      if (sv < svBest) { svBest = sv; sB = sc; dB = dmp; }
    }
    if (!solvedLegal) for (const dE of [-0.3, -0.15, 0.15, 0.3, 0.45]) {
      const sv = score(own, aim, dE, 0, sB, dB, false);
      if (legal) { eB = dE; solvedLegal = true; break; }
      if (sv < svBest) { svBest = sv; eB = dE; }
    }
    if (!solvedLegal) for (const dA of [-0.35, 0.35, -0.6, 0.6]) {
      const sv = score(own, aim, eB, dA, sB, dB, false);
      if (legal) { aB = dA; solvedLegal = true; break; }
      if (sv < svBest) { svBest = sv; aB = dA; }
    }
    if (solvedLegal) { bE = eB; bA = aB; bS = sB; bD = dB; bAim = aim; bOwn = own; }
  }

  // A weaker player keeps part of their own error — but never to the point
  // of an illegal serve, which is simply not fun.
  const k = clamp(0.45 + 0.55 * assist, 0, 1);
  const fE = bE * k, fA = bA * k, fS = 1 + (bS - 1) * k, fD = 1 + (bD - 1) * k;
  score(bOwn, bAim, fE, fA, fS, fD, true);
  if (legal) return { dE: fE, dA: fA, sc: fS, dmp: fD, ok: true, target: bAim };
  // The player's own error would have produced an illegal serve: give them
  // the solved one instead. Only a truly absurd gesture can fail here.
  score(bOwn, bAim, bE, bA, bS, bD, true);
  return { dE: bE, dA: bA, sc: bS, dmp: bD, ok: legal, target: bAim };
}

function refineRacket(ballP, ballV, ballW, racket, assist, quality) {
  const fwd = -racket.side;
  const rubber = Object.assign({}, racket.rubber || {});
  const q = quality !== undefined ? quality : racket.quality;
  const side = racket.side;

  const evalStroke = (dE, dA, sc, dmp, outV, outW) => {
    strokeFrame(racket, dE, dA, sc, _rs, _rn);
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
    const srv = solveServeStroke(ballP, racket, evalStroke, side, assist);
    strokeFrame(racket, srv.dE, srv.dA, srv.sc, _rs, _rn);
    rubber.damp = srv.dmp;
    return Object.assign({}, racket, {
      normal: V3.clone(_rn), vR: V3.clone(_rs), rubber,
      dElev: srv.dE, dAz: srv.dA, scale: srv.sc, damp: srv.dmp,
      solved: true, valid: srv.ok, target: srv.target,
    });
  }

  /* ---- 1. what does the untouched gesture physically do? ---------- */
  evalStroke(0, 0, 1, 1, _rv, _rw);
  const rawReport = {};
  predict(V3.clone(ballP), V3.clone(_rv), V3.clone(_rw),
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

  /* ---- 3. converge the stroke rotation onto that target ----------- */
  let dE = 0, dA = 0, sc = 1, dmp = 1, sol = null, converged = false;
  for (let outer = 0; outer < 3; outer++) {
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
      const scLo = racket.arch.absorb ? 0.12 : 0.45, scHi = 1.50;
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
  const validate = (e_, a_, s_, d_, fine) => {
    evalStroke(e_, a_, s_, d_, _rv, _rw);
    predict(V3.clone(ballP), V3.clone(_rv), V3.clone(_rw),
      { dt: fine ? 1 / 280 : 1 / 150, maxT: 2.6, stopOnFirstBounce: true, out: chk });
    if (chk.hitNet) return -1;
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
      sc = clamp(sc * 1.05, 0.12, 2.20); dmp = Math.min(1, dmp * 1.05);
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
      sc = clamp(sc * 1.04, 0.12, 2.20);
    } else {                                // long
      dE -= 0.02 + j * 0.015;
      sc = clamp(sc * 0.98, 0.10, 2.20);
      dmp = Math.max(0.30, dmp * 0.96);
    }
    verdict = validate(dE, dA, sc, dmp, true);
  }

  const swing = V3.new(), normal = V3.new();
  strokeFrame(racket, dE, dA, sc, swing, normal);
  rubber.damp = dmp;
  return { ...racket, normal, vR: swing, rubber, dElev: dE, dAz: dA, scale: sc, damp: dmp, solved: sol, target, valid: verdict === 0 };
}

/** Cheap post-hoc report of where a struck ball will actually go. */
function shotReport(p, v, w, out) {
  return predict(V3.clone(p), V3.clone(v), V3.clone(w),
    { dt: 1 / 300, maxT: 2.6, stopOnFirstBounce: true, out: out || _rout });
}
