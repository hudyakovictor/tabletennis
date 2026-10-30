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
    this.originX = 0;
    this.originY = 0;
    this.originT = 0;
    this.evictedPathLen = 0;
    this.m = this.blankMetrics();
    this.lastReleased = null;
    /* Which gesture has already been a real swipe (see
     * Game.playerStrokeIntent). A held block must not die of sample
     * freshness; a stationary hold never qualifies. Taps are released separately. */
    this.realGestureId = -1;
    this.realAt = 0;
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
  down(x, y, t, simTime) {
    this.gestureId++;
    this.realGestureId = -1; this.realAt = 0; this.realAtSim = null;
    this.consumedGestureId = -1; this.consumedAt = -Infinity;
    this.pressZone = null;
    this.active = true; this.startT = t;
    this.originX = x; this.originY = y; this.originT = t;
    this.evictedPathLen = 0;
    // Gesture speed uses real time, but its opportunity to meet the ball
    // must age in the same (possibly slowed) time as the ball's physics.
    this.sampleSimTime = Number.isFinite(simTime) ? simTime : null;
    this.releaseSimTime = null;
    this.samples.length = 0;
    this.samples.push({ x, y, t });
    this.m = this.blankMetrics();
    this.m.sx = x; this.m.sy = y; this.m.x = x; this.m.y = y;
    this.m.samples = 1;
  }
  move(x, y, t, simTime) {
    if (!this.active) return;
    if (Number.isFinite(simTime)) this.sampleSimTime = simTime;
    const s = this.samples, last = s[s.length - 1];
    if (last && t < last.t) t = last.t;
    if (last && t - last.t < 0.0025) {
      // Several pointer events can arrive between animation frames. Never
      // overwrite the starting point: doing so erased fast drags completely.
      if (s.length === 1) s.push({ x, y, t });
      else { last.x = x; last.y = y; last.t = Math.max(last.t, t); }
      this.compute(t);
      return;
    }
    s.push({ x, y, t });
    if (s.length > this.maxSamples) {
      if (s.length >= 2) this.evictedPathLen += Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y);
      s.shift();
    }
    this.compute(t);
  }
  /** Abandon the gesture without producing a stroke — used when a second
   *  finger lands and the touch turns into a camera orbit. */
  cancel() {
    this.pressZone = null;
    this.active = false;
    this.realGestureId = -1; this.realAt = 0; this.realAtSim = null;
    this.sampleSimTime = null; this.releaseSimTime = null;
    this.evictedPathLen = 0;
    this.samples.length = 0;
    this.lastReleased = null;
    this.m = this.blankMetrics();
  }
  up(x, y, t, simTime) {
    if (!this.active) return null;
    this.releaseSimTime = Number.isFinite(simTime) ? simTime : null;
    if (Number.isFinite(simTime)) this.sampleSimTime = simTime;
    const last = this.samples[this.samples.length - 1];
    if (last && t < last.t) t = last.t;
    if (last && t - last.t < 0.0025) {
      /* Without any move() sample, a zero-dt down+up teleport is a synthetic
       * tap/glitch, not a real swipe ([SG921]). Keep s.length === 1. */
      if (this.samples.length > 1) { last.x = x; last.y = y; last.t = Math.max(last.t, t); }
    } else {
      this.samples.push({ x, y, t });
      if (this.samples.length > this.maxSamples) {
        if (this.samples.length >= 2) {
          this.evictedPathLen += Math.hypot(this.samples[1].x - this.samples[0].x, this.samples[1].y - this.samples[0].y);
        }
        this.samples.shift();
      }
    }
    this.compute(t);
    this.active = false;
    this.lastReleased = { ...this.m };
    return this.lastReleased;
  }
  compute(now) {
    const s = this.samples, n = s.length, m = this.m;
    m.samples = n;
    if (n < 2) return m;
    const b = s[n - 1];
    const ox = Number.isFinite(this.originX) ? this.originX : s[0].x;
    const oy = Number.isFinite(this.originY) ? this.originY : s[0].y;
    const ot = Number.isFinite(this.originT) ? this.originT : s[0].t;
    m.sx = ox; m.sy = oy; m.x = b.x; m.y = b.y;
    m.dx = b.x - ox; m.dy = b.y - oy;
    m.dist = Math.hypot(m.dx, m.dy);
    m.dur = Math.max(0.0025, b.t - ot);

    // path length + curl (signed turning, + = counter-clockwise on screen)
    let pl = this.evictedPathLen || 0, curl = 0, jerkAcc = 0, prevSpeed = 0, speedChanges = 0;
    let activePeak = 0;
    const peakCut = b.t - 0.28;
    for (let i = 1; i < n; i++) {
      const px = s[i].x - s[i - 1].x, py = s[i].y - s[i - 1].y;
      const seg = Math.hypot(px, py);
      pl += seg;
      const dt = Math.max(0.0025, s[i].t - s[i - 1].t);
      const sp = seg / dt;
      if (s[i].t >= peakCut || n <= 8) {
        if (sp > activePeak) activePeak = sp;
      }
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
    const wdt = Math.max(0.0025, b.t - w.t);
    const vx = (b.x - w.x) / wdt, vy = (b.y - w.y) / wdt;
    m.speed = Math.hypot(vx, vy);
    m.releaseSpeed = m.speed;
    m.peakSpeed = Math.max(activePeak, m.speed);
    // 25 ms acceleration (is the hand still accelerating into the ball?)
    let i1 = n - 1; while (i1 > 0 && b.t - s[i1].t < 0.025) i1--;
    const w1 = s[i1], wdt1 = Math.max(0.0025, b.t - w1.t);
    const sp1 = Math.hypot(b.x - w1.x, b.y - w1.y) / wdt1;
    m.accel = (sp1 - m.speed) / wdt1;

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
  SIDE: { id: 'SIDE', name: 'БОКОВОЙ УДАР', short: 'БОКОВОЙ', col: '#39e08b', desc: 'Горизонтальный свайп — боковое вращение' },
  SMASH: { id: 'SMASH', name: 'СМЕШ', short: 'СМЕШ', col: '#ff2d2d', desc: 'Завершающий плоский удар сверху' },
  FLICK: { id: 'FLICK', name: 'ФЛИК', short: 'ФЛИК', col: '#ff9f1c', desc: 'Короткий кистевой подкрут над столом' },
  PUSH: { id: 'PUSH', name: 'ПОДСТАВКА-ПОДРЕЗКА', short: 'ПОДРЕЗКА', col: '#4dd2ff', desc: 'Короткая подрезка открытой ракеткой' },
  CHOP: { id: 'CHOP', name: 'ЧОП', short: 'ЧОП', col: '#2f9bff', desc: 'Дальняя защита, тяжёлое нижнее вращение' },
  BLOCK: { id: 'BLOCK', name: 'БЛОК', short: 'БЛОК', col: '#a0b4c8', desc: 'Пассивный приём — гасит скорость соперника' },
  LOB: { id: 'LOB', name: 'СВЕЧА', short: 'СВЕЧА', col: '#b388ff', desc: 'Высокая оборонительная свеча с верхним вращением' },
  HOOK: { id: 'HOOK', name: 'ХУК (боковое)', short: 'ХУК', col: '#39e08b', desc: 'Боковое вращение — мяч уходит дугой' },
  FADE: { id: 'FADE', name: 'ФЕЙД (боковое)', short: 'ФЕЙД', col: '#39e0c8', desc: 'Обратное боковое вращение' },
  DROP: { id: 'DROP', name: 'УКОРОЧЕННЫЙ', short: 'УКОРОЧКА', col: '#8fd14f', desc: 'Мягкое гашение у сетки' },
  SERVE_TOP: { id: 'SERVE_TOP', name: 'ПОДАЧА-НАКАТ', short: 'НАКАТ', col: '#ff7a2f', desc: 'свайп вверх по мячу — верхнее вращение, мяч садится коротко и подскакивает' },
  SERVE_BACK: { id: 'SERVE_BACK', name: 'ПОДАЧА РЕЗАНАЯ', short: 'РЕЗАНАЯ', col: '#4dd2ff', desc: 'свайп вниз под мяч — нижнее вращение, мяч плоский и зависает' },
  SERVE_SIDE: { id: 'SERVE_SIDE', name: 'ПОДАЧА БОКОВАЯ', short: 'БОКОВАЯ', col: '#39e08b', desc: 'свайп поперёк мяча — боковое вращение, дуга в полёте и после стола' },
  SERVE_FAST: { id: 'SERVE_FAST', name: 'СТРЕМИТЕЛЬНАЯ ПОДАЧА', short: 'БЫСТРАЯ', col: '#ffd34d', desc: 'длинный быстрый свайп — плоская пуля без вращения' },
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
const ARCH = STROKE_CONFIG.archetypes;

/** A deliberate contact tap is a compact, neutral stroke. Only the pointer
 * handler can admit it; a toss tap, hover or raw stationary hold is not a shot. */
function tapStrokeMetrics(metrics, x, y, serving = false) {
  return { ...metrics, tap: true, serveTap: serving, sx: x, sy: y, x, y, dx: 0, dy: 0,
    dist: 0, pathLen: 0, samples: Math.max(2, metrics.samples || 0),
    speed: .8, peakSpeed: .8, releaseSpeed: .8, up: 1, right: 0, curl: 0 };
}

/** A quick compact wrist flick (14..42 px) inside an admitted contact zone is
 *  too large for `tapMaxMovePx` (14 px) yet shorter than a full-arm swipe
 *  (`0.046`). Promote it cleanly into a compact directional counter/block
 *  instead of dropping it into a dead band (`no_intent`). */
function compactStrokeMetrics(metrics, x, y) {
  const dx = Number.isFinite(metrics.dx) ? metrics.dx : 0;
  const dy = Number.isFinite(metrics.dy) ? metrics.dy : 0;
  const d = Math.hypot(dx, dy);
  const right = d > 1e-4 ? clamp(dx / d, -0.75, 0.75) : 0;
  const up = d > 1e-4 ? clamp(-dy / d, -0.55, 1) : 1;
  const sp = clamp(Math.max(metrics.peakSpeed || 0, metrics.releaseSpeed || 0, 0.95), 0.85, 1.55);
  return {
    ...metrics,
    tap: true,
    compactFlick: true,
    x, y,
    samples: Math.max(2, metrics.samples || 0),
    speed: sp, peakSpeed: sp, releaseSpeed: sp,
    up, right,
    curl: clamp(metrics.curl || 0, -0.6, 0.6),
  };
}

/** A small twitch or hover jitter is not a swipe. A contact tap is admitted
 * separately, and can serve only when stamped for a legal falling toss. */
function isRealStroke(m, serving) {
  if (!m || !Number.isFinite(m.samples) || m.samples < 2) return false;
  if (m.tap === true) return (!serving || m.serveTap === true) && Number.isFinite(m.sx) && Number.isFinite(m.sy);
  const limits = STROKE_CONFIG.classification.minGesture;
  const min = serving ? limits.serve : limits.rally;
  if (!Number.isFinite(m.pathLen) || m.pathLen < min.path) return false;
  /* Дуга «С» — настоящий удар, даже если хорда короткая: замкнутая дуга
   * почти не смещает палец, но несёт и путь, и поворот. */
  if (!Number.isFinite(m.dist) || m.dist < min.dist) {
    if (!(m.pathLen >= limits.arc.path && Math.abs(m.curl || 0) >= limits.arc.curl)) return false;
  }
  if (!Number.isFinite(m.peakSpeed) || m.peakSpeed < min.speed) return false;
  return true;
}

function classifyStroke(m, ctx, sp01) {
  ctx = ctx || {};
  const C = STROKE_CONFIG.classification;
  const r = m.right, u = m.up;
  const latMag = Math.abs(r);
  const curly = Math.abs(m.curl) > C.serveCurlThreshold;
  const fast = sp01 > C.fastSpeedThreshold, veryFast = sp01 > C.veryFastSpeedThreshold, slow = sp01 < C.slowSpeedThreshold;
  /* Классификатор — чистый вопрос «какой это вид удара», он не должен
   * рушиться там, где контекста уже нет (сетевой снапшот, реплей между
   * очками, обучалка на демо-полосе). Без мяча поведение — набор
   * нейтральных констант, берущий ту же ветку, что и обычный розыгрыш. */
  const b = ctx.ball || { y: PH.TABLE_Y + C.defaultBallHeight, z: C.defaultBallDepth };
  const hAboveNet = b.y - PH.NET_TOP;
  const hAboveTable = b.y - PH.TABLE_Y;
  const depth = Math.abs(b.z);
  const overTable = depth < PH.T_HALF_LEN - C.overTableMargin;
  const incomingTop = ctx.incomingTop || 0;
  const incSpeed = ctx.ballSpeed || C.defaultIncomingSpeed;

  if (ctx.isServe) {
    const lateral = latMag * STROKE_CONFIG.serve.sideK > C.serveSideLatThreshold;
    // Pure horizontal strokes stay lateral even at speed; a long forward
    // diagonal can punch flat instead. Curl always asks for a side brush.
    if (curly || (lateral && Math.abs(u) < C.serveHorizontalUMax)) return STROKES.SERVE_SIDE;
    if (sp01 > C.serveFastSpeedThreshold && Math.abs(u) < C.serveFastUMax
      && (!lateral || m.dist > C.serveFastDistMin)) return STROKES.SERVE_FAST;
    if (lateral) return STROKES.SERVE_SIDE;
    if (u < C.serveBackUMin) return STROKES.SERVE_BACK;
    return STROKES.SERVE_TOP;
  }
  // A straight horizontal brush is lateral without requiring a C-shaped curl.
  if (latMag > C.sideLatThreshold && Math.abs(u) < C.horizontalUMax &&
      Math.abs(m.curl || 0) <= C.sideCurlThreshold &&
      (m.compactFlick || (m.pathLen ?? m.dist ?? 0) >= C.minGesture.rally.path)) return STROKES.SIDE;
  // tiny gesture = touch play
  if (m.dist < C.touchDistMax && sp01 < C.touchSpeedMax) {
    if (incSpeed > C.blockIncomingSpeed || incomingTop > C.blockIncomingTop) return STROKES.BLOCK;
    return (overTable && hAboveTable < C.dropHeightMax) ? STROKES.DROP : STROKES.BLOCK;
  }
  /* ДУГА «С» = БОКОВАЯ ЗАКРУТКА. Жест рисует дугу: большой суммарный
   * поворот при заметно более длинном пути, чем хорда. Направление хорды
   * у дуги случайно (та же «С» сверху вниз и снизу вверх — один жест),
   * поэтому дуга проверяется ДО семейств «вверх/вниз по хорде», иначе
   * половина всех «С» уезжала в подставки, а вторая — в накаты. Буква «С»
   * (выпуклость влево, curl < 0) закручивает мяч влево — HOOK; зеркальная
   * дуга (curl > 0) — вправо, FADE: куда гнётся жест, туда и летит мяч.
   * Пороги масштабирует калибровка arcSens. */
  {
    const arcSens = clamp(Number.isFinite(ctx.arcSens) ? ctx.arcSens : 1, ...C.arcSensRange);
    const bend = m.dist > 0.001 ? (m.pathLen || 0) / m.dist : 0;
    /* Медленный сильный подъём — это свеча (LOB), даже если рука дрогнула
     * дугой: закрутка без темпа всё равно не полетит, а украденная свеча
     * ломает защиту. Быстрая дуга при любом направлении хорды — закрутка.
     * Порог curl=0.55/arcSens (было 0.85) — палец на телефоне не рисует
     * идеальную C: реалистичная дуга даёт 0.5–0.7 рад. */
    const lobLift = slow && u > C.liftUMin;
    if (!lobLift && Math.abs(m.curl) >= C.arcCurlThreshold / arcSens && m.dist >= C.arcDistMin &&
      (bend >= C.arcBendMin || (m.straightness <= C.arcStraightnessMax && Math.abs(m.curl) >= C.arcStrongCurlThreshold / arcSens))) {
      return m.curl < 0 ? STROKES.HOOK : STROKES.FADE;
    }
  }
  /* Finishing a high ball always beats everything else — but only if the
   * hand is actually going forward/up. A fast DOWNWARD gesture was caught
   * here before the backspin rule below could see it, so a defensive chop
   * on a ball above the tape was silently reclassified as a smash. The
   * assist then rotated the swing up until the chop "landed", and a 1.9 m/s
   * ball came back at 25 m/s off a hand that never swung forward. The
   * boundary is the same -0.24 the backspin family uses, so the two rules
   * cannot overlap. */
  if (hAboveNet > C.smashHeightMin && sp01 > C.smashSpeedMin && u > C.backUMin && u < C.smashUMax) return STROKES.SMASH;
  // downward gestures = backspin family
  if (u < C.backUMin) {
    if (depth > PH.T_HALF_LEN + C.chopDepthMargin || (fast && m.dist > C.chopDistMin)) return STROKES.CHOP;
    if (sp01 < C.dropSpeedMax && overTable && hAboveTable < C.dropTableHeightMax) return STROKES.DROP;
    return STROKES.PUSH;
  }
  // a clearly curved sideways gesture = sidespin
  if (latMag > C.sideLatThreshold && Math.abs(m.curl) > C.sideCurlThreshold) return (r > 0) ? STROKES.HOOK : STROKES.FADE;
  // upward gestures = topspin family
  if (u > C.liftUMin) {
    if (slow && hAboveTable < C.lobHeightMax) {
      /* A lob is a slow ball played with time. The same short, slow upward
       * hand against a FAST ball is a block: there is no time to swing, and
       * classifying it as a lob made the assist open the swing to 75°,
       * where the 80° frame ceiling froze the face and the block could not
       * be aimed at all (measured: 0 of 3 fast blocks returned). */
      if (incSpeed > C.fastBlockIncomingSpeed && m.dist < C.fastBlockDistMax && sp01 < C.fastBlockSpeedMax) return STROKES.BLOCK;
      return STROKES.LOB;
    }
    if (overTable && m.dist < C.flickDistMax && hAboveTable < C.flickHeightMax) return STROKES.FLICK;
    return (incomingTop > C.counterIncomingTop && fast) ? STROKES.COUNTER : STROKES.LOOP;
  }
  if (u > C.loopUMin) return (incomingTop > C.counterStrongIncomingTop && veryFast) ? STROKES.COUNTER : STROKES.LOOP;
  return STROKES.DRIVE;
}

/* ------------------------------------------------------------------ *
 *  Build the racket state from gesture metrics + ball context.
 *  side = +1 for the near player (hits towards -z)
 * ------------------------------------------------------------------ */
function deriveStroke(m, ctx) {
  const R = STROKE_CONFIG.racket, S = STROKE_CONFIG.spin;
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
  const raw = Math.max(m.releaseSpeed, m.peakSpeed * R.speed.peakK);
  const sp01 = clamp(raw / R.speed.inputScale, 0, R.speed.powerMax);

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
  const A = STROKE_CONFIG.archetypes[st.id] || STROKE_CONFIG.archetypes.DRIVE;

  /* ---- 4. continuous blend archetype <- raw gesture --------------- *
   * The archetype only biases; the actual numbers still follow the
   * player's hand, so two LOOPs are never identical.                  */
  const r = m.right, u = m.up;
  const gestureElev = u * R.gestureElev;
  let elev = clamp(A.elev * R.elevWeights[0] + gestureElev * R.elevWeights[1], ...R.elevRange);

  // spin intent: verticality + gesture length + wrist curl
  const weights = S.spinIntentWeights;
  const spinIntent = clamp(Math.pow(Math.abs(u), S.verticalExponent) * weights.u
    + clamp(m.dist * weights.dist, 0, S.distanceIntentMax)
    + Math.abs(m.curl) * weights.curl, ...S.intentRange);
  const contactRange = S.contactClampByArchetype[st.id]
    || (ctx.isServe ? STROKE_CONFIG.serve.contactAngleRange : S.contactAngleRange);
  let contact = A.contact * S.contactWeights[0] + lerp(...S.contactIntentRange, clamp(spinIntent, 0, 1)) * S.contactWeights[1];
  // a high ball wants a flatter contact; a ball below the net wants a graze
  contact += clamp(-hAboveNet * S.contactHeightK, ...S.contactHeightRange);
  contact = clamp(contact, ...contactRange);

  /* Калибровка силы закрутки (ползунок игрока, spinGain 0.5..1.6) — два
   * честных канала: малый сдвиг угла касания и трение резины (mu/et в
   * сборке rubber ниже) плюс глубина бокового разворота грани. Угол
   * сознательно не главный канал: замер показал, что за ~65° касание
   * уходит в проскальзывание и спин падает — ручка обязана быть
   * монотонной. Полёт дальше считает измеренная аэродинамика (Магнус). */
  const spinGain = clamp(Number.isFinite(ctx.spinGain) ? ctx.spinGain : 1, ...S.spinGainRange);
  if (spinGain !== 1) contact = clamp(contact + (spinGain - 1) * S.spinGainContactK, ...contactRange);

  /* How much of the brushing happens ACROSS the ball instead of up it.
   * A hook, a fade or a sidespin serve is not a topspin stroke that
   * happens to drift sideways: the bat is turned so the contact angle
   * itself lies in the horizontal plane and the ball is peeled round
   * the side. Only the genuinely lateral archetypes do this, so every
   * other stroke keeps exactly the numbers it had before.
   * Боковую щётку ведёт не только хорда: у чистой дуги «С» хорда почти
   * нулевая, а закрутка — вся в повороте жеста. rLat берёт знак и силу из
   * curl, когда хорда молчит, поэтому «С» округляет мяч, даже если палец
   * вернулся почти в исходную точку. Знак согласован с классификатором:
   * curl < 0 (буква «С») — удар вокруг левого бока мяча. */
  const rLat = Math.abs(r) >= S.lateralGestureMin ? r
    : clamp(-(m.curl || 0) / S.lateralCurlScale, -1, 1) * ((st.id === 'HOOK' || st.id === 'FADE' || st.id === 'SERVE_SIDE') ? 1 : S.nonSideCurlK);
  const latMix = clamp((A.lat - S.lateralArchetypeBase) / S.lateralArchetypeSpan, 0, 1) * clamp(Math.abs(rLat) * S.lateralIntentK, 0, 1);

  /* Азимут замаха и грани. На подаче корпус стоит прямо, и бок даёт ГРАНЬ, а не
   * зама́х вбок; чистый боковой свайп в розыгрысе обязан вести себя так же, иначе
   * удар физически некуда попасть. Замер прежней модели (замах 41° вбок): перебор
   * «подъём руки × азимут × темп» (306 клеток) дал ДВЕ легальные клетки из 306, и
   * обе при масштабе скорости 0.15. Мяч улетал ЗА БОКОВУЮ ЛИНИЮ, поэтому ни один
   * ассист не мог его спасти: игрок видел «боковое вращение не работает, мяч летит
   * непонятно куда». Теперь у SIDE замах почти по линии, а щётка берётся разворотом
   * грани ПОПЁК него — тот же угол атаки (23-27°), та же закрутка, но мяч летит на
   * стол. HOOK/FADE не затронуты: у них полёт вбок и есть задача удара. */
  const pureSide = !ctx.isServe && st.id === 'SIDE';
  const azK = pureSide ? R.azSwingK * Math.max(0, 1 - S.sideAzSwingDamp * latMix)
    : ctx.isServe ? STROKE_CONFIG.serve.azSwingK : R.azSwingK;
  const azSwing = clamp(r * A.lat * azK, ...R.azSwingRange);
  const chordK = pureSide
    ? S.faceGestureK * Math.max(0, 1 - S.sideFaceChordDamp * latMix) : S.faceGestureK;
  let azFace = clamp(r * A.lat * chordK + m.curl * S.faceCurlK, ...R.azFaceRange);

  /* Разворот грани ПОПЁК замаха — единственный канал, который реально даёт
   * ω вокруг вертикали. Замер: трение (mu), et и нижний потолок упругости
   * почти не двигают бок (контакт живёт в режиме «зацеп», не проскальзывание),
   * а вот угол между направлением замаха и нормалью — двигает: 14° дают 5 об/с,
   * 30° — уже 25 об/с. Отсюда отдельная ручка подачи: там latMix = 1 и боковая
   * щётка — единственный смысл жеста, а в розыгрысе её сила делится с LOOP. */
  const turnK = ctx.isServe ? S.lateralTurnKServe : S.lateralTurnK;
  const latTurn = -Math.sign(rLat || 1) * contact * DEG * turnK * latMix * (S.lateralGainWeights[0] + S.lateralGainWeights[1] * spinGain);
  azFace = clamp(azFace + latTurn, ...R.lateralFaceRange);

  /* The step yaw. The bat is turned into the direction it is moving (right
   * step -> face opens right), and the same yaw is applied here so the face
   * you SEE is the face that strikes. Without it the bat visibly banks one
   * way while the ball comes off a square face — a mismatch the eye reads
   * as the game cheating. */
  const moveYaw = Number.isFinite(ctx.moveYaw) ? clamp(ctx.moveYaw, ...R.moveYawRange) : 0;
  if (moveYaw) azFace = clamp(azFace + moveYaw * R.moveYawK, ...R.lateralFaceRange);

  /* Power still tracks gesture speed end to end: the floor is high enough
   * that a recognised-but-soft swing returns a playable ball, and the span
   * to the ceiling is what makes a fast, well-timed swipe dangerous. */
  let vmag = R.speed.floor + R.speed.span * Math.pow(sp01, R.speed.exponent);
  vmag = clamp(vmag * A.speed * (Number.isFinite(ctx.powerScale) ? ctx.powerScale : 1), R.vmin, R.vmax);
  /* A serve is not a smash. Through this impact model a 19.5 m/s bat with a
   * flat face launches the ball at ~30 m/s, and a fast swipe used to produce
   * a 105-137 km/h "serve" — faster than anything ever measured on a real
   * table, and unreturnable by design. Pro serves leave the bat at 10-15 m/s
   * and arrive at 40-70 km/h, which is what 12.5 m/s of bat gives here. */
  if (ctx.isServe) vmag = clamp(vmag, STROKE_CONFIG.serve.vmin, STROKE_CONFIG.serve.vmax);
  /* Боковой свайп в розыгрысе — не смеш: касание скользящее. Замер чистого
   * горизонтального жеста в e2e-состоянии (мяч 0.30 м над столом в 1.5 м за
   * своей линией): ракетка 11.2–11.7 м/с давала 89 км/ч и 24 об/с бока, мяч
   * улетал за конец стола, и ни одна ступень ассиста (0.85 → 1.0 → мягкий
   * темп) не оставляла его на столе. При 6.5 м/с тот же жест даёт ~50 км/ч и
   * законный полёт: закрутка остаётся, исчезает только пуля. */
  if (pureSide) vmag = Math.min(vmag, S.sideVmax);
  if (!Number.isFinite(vmag)) vmag = R.speed.fallback;

  /* The explicit spin dial (the chip in the top button row). The gesture
   * decides HOW you brush the ball; this decides how much of the contact is
   * brush and how much is punch — a more grazing face makes more spin and
   * less pace, a flatter one the reverse. It exists because spin was only
   * ever a side effect of the curl of a swipe: there was no way to ask for a
   * heavy low backspin on purpose, and no way to see what you had asked for.
   * Deterministic and persistent, so it can be learned. */
  const sb = ctx.spinBias === 'high' ? 1 : ctx.spinBias === 'low' ? -1 : 0;
  if (sb) {
    contact = clamp(contact + sb * S.biasContactK, ...contactRange);
    vmag = clamp(vmag * (1 - sb * S.biasSpeedK), R.vmin, ctx.isServe ? STROKE_CONFIG.serve.vmax : R.vmax);
  }

  /* spinGain применён выше: угол касания, разворот грани и трение резины. */

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
  const vertContact = contact * DEG * (1 - S.verticalContactLateralK * latMix);
  const movePitch = Number.isFinite(ctx.movePitch) ? clamp(ctx.movePitch, ...R.movePitchRange) : 0;
  let phi = clamp((A.back ? eR + vertContact : eR - vertContact) + movePitch, ...R.faceElevRangeRad);
  /* Attack lean: a drive/loop/smash tips the blade INTO the ball (closed
     face, head toward the net). Without this, elev ≈ contact left every
     loop sitting near vertical — the bat never visibly leaned forward. */
  if (!A.back && !A.absorb && !ctx.isServe && A.attackLean !== false) {
    phi = clamp(phi - (R.attackLeanRad[0] + R.attackLeanRad[1] * clamp(sp01, 0, 1)), ...R.faceElevRangeRad);
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
  /* Мёртвая зона по позиции нажатия: палец почти всегда чуть в стороне от
   * центра экрана, и без зоны КАЖДЫЙ честно-прямой свайп уезжал вбок от
   * «центр смещён» — удар не совпадал с замахом. Внутри ±0.14 смещение
   * игнорируется, дальше плавно продолжается до прежних границ. */
  const placement = R.placement, bxRaw = (m.x - 0.5) * 2;
  const bx = Math.abs(bxRaw) <= placement.deadZone ? 0
    : (bxRaw - Math.sign(bxRaw) * placement.deadZone) / (1 - placement.deadZone);
  const aimX = clamp(bx + r * placement.gestureK, -1, 1) * (PH.T_HALF_WID * placement.widthK);
  const depth = placement.depth[st.id];
  const depth01 = depth ? depth[0] + sp01 * depth[1]
    : clamp(placement.defaultDepth[0] + sp01 * placement.defaultDepth[1] + m.dist * placement.defaultDepth[2], ...placement.depthRange);
  const aimZ = -side * lerp(placement.netMargin, PH.T_HALF_LEN - placement.endMargin, depth01);

  /* ---- 7. execution quality --------------------------------------- */
  const QL = R.quality;
  const quality = clamp(QL.base + QL.smooth * m.smooth + QL.straightness * m.straightness
    + QL.samples * clamp(m.samples / QL.sampleCount, 0, 1)
    - QL.curlK * clamp(Math.abs(m.curl) - QL.curlStart, 0, QL.curlMax), ...QL.range);

  /* The rubber is the player's equipment (84_racket.js), modulated by the
     archetype: a soft, absorbing stroke presses the sponge, which costs
     restitution and gains dwell. Without equipment the base racket is
     used, so the physics is unchanged for anything that does not fit one. */
  const eq = ctx.equip || {}, base = R.rubber || {};
  const rubber = {
    e: (eq.e ?? base.e ?? PH.E_RACKET) * (A.soft ?? 1),
    mu: (eq.mu ?? base.mu ?? PH.MU_RACKET) * spinGain,
    et: (eq.et ?? base.et ?? PH.ET_RACKET) * (A.soft !== undefined ? S.rubberSoftWeights[0] + S.rubberSoftWeights[1] * A.soft : 1) * (S.rubberGainWeights[0] + S.rubberGainWeights[1] * spinGain),
    damp: eq.damp ?? base.damp ?? 1,
  };

  const racket = {
    stroke: st, arch: A, vR, normal, vmag, faceEnvelope: faceRange, grip: ctx.grip, forehand: ctx.forehand !== false, aim: { x: aimX, z: aimZ },
    power: sp01, quality, elev, contact, azSwing, azFace, faceElev: phi, spinIntent, rubber,
    swipe: m, side, isServe: !!ctx.isServe, ballVelocity: ctx.ballVelocity && V3.clone(ctx.ballVelocity),
    /* Air left over the tape. A push and a chop carry the least energy of any
       stroke, and at the default 55 mm they were the least reliable shots in
       the game (measured: 28.6 % on the table, 28.6 % into the net). */
    netClear: R.netClear[st.id] ?? R.netClear.default,
  };
  if (!ctx.isServe && st.id !== 'SIDE') return racket;
  strokeBrushVelocity(racket, vR, normal);
  return resolvedRacketFrame(racket, normal, vR);
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
  const separation = PH.R * STROKE_CONFIG.racket.launchSeparation;
  _launch.x = ballP.x + n.x * separation;
  _launch.y = ballP.y + n.y * separation;
  _launch.z = ballP.z + n.z * separation;
  return _launch;
}

function dirFromAngles(out, elev, az, fwd) {
  out.x = Math.sin(az) * Math.cos(elev);
  out.y = Math.sin(elev);
  out.z = fwd * Math.cos(az) * Math.cos(elev);
  return V3.norm(out, out);
}

function strokeBrushVelocity(racket, velocity, normal) {
  const lateral = racket.stroke?.id === 'SERVE_SIDE' || racket.stroke?.id === 'SIDE';
  if (!racket.isServe && !lateral) return velocity;
  const cfg = racket.isServe ? STROKE_CONFIG.serve : STROKE_CONFIG.spin;
  const vmax = racket.isServe ? STROKE_CONFIG.serve.vmax : STROKE_CONFIG.racket.vmax;
  const incoming = saneV(racket.ballVelocity) ? racket.ballVelocity : ZERO3;
  /* Доля «поперёк мяча» в жесте: 1 у чистого горизонта, 0 у чистого вертикального
   * свайпа. Прежний закон обнулялся уже при |up| = 0.45, то есть любая реальная
   * диагональ (~45°) целиком сохраняла свою вертикальную щётку и подача
   * вылетала с верхним вращением вместо бокового. Теперь диагональ отдаёт на
   * вертикаль ровно столько, сколько в ней вертикали. */
  const sw = racket.swipe || ZERO3;
  const latAbs = Math.abs(sw.right || 0), vertAbs = Math.abs(sw.up || 0);
  const lateralShare = latAbs / Math.max(1e-6, Math.hypot(latAbs, vertAbs));
  const brush = lateral
    ? clamp(cfg.sideBrushVerticalK * Math.pow(lateralShare, Math.max(cfg.sideBrushLateralExp, 1e-6)), 0, 1) : 0;
  if (brush && Math.abs(normal.z) > 1e-6) {
    // n x (ballV - racketV) has zero x torque for a horizontal brush.
    // Match incoming vertical motion instead of manufacturing top/back brush.
    const neutralY = incoming.y + (velocity.z - incoming.z) * normal.y / normal.z;
    velocity.y = lerp(velocity.y, neutralY, brush);
  }
  const speed = V3.len(velocity);
  if (speed > vmax) {
    if (brush) {
      // Scale relative to the toss so the speed ceiling preserves that axis.
      const x = velocity.x - incoming.x, y = velocity.y - incoming.y, z = velocity.z - incoming.z;
      const a = x * x + y * y + z * z, b = incoming.x * x + incoming.y * y + incoming.z * z;
      const disc = b * b - a * (V3.dot(incoming, incoming) - vmax * vmax);
      if (a > 1e-9 && disc >= 0) {
        const k = clamp((-b + Math.sqrt(disc)) / a, 0, 1);
        V3.set(velocity, incoming.x + x * k, incoming.y + y * k, incoming.z + z * k);
        return velocity;
      }
    }
    V3.mul(velocity, velocity, vmax / speed);
  }
  return velocity;
}

/** Rebuild (swing, normal) for a stroke rotated by (dElev, dAz). */
function strokeFrame(racket, dElev, dAz, scale, outSwing, outNormal, wristCorrection = 0) {
  const cfg = STROKE_CONFIG.racket;
  const fwd = -racket.side;
  const e = clamp(racket.elev * DEG + dElev, ...cfg.frameElevRangeRad);
  const a = clamp(racket.azSwing + dAz, ...cfg.frameSwingRangeRad);
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
    : (racket.arch.back ? e + contact : e - contact), ...cfg.faceElevRangeRad);
  phi += Number.isFinite(wristCorrection) ? wristCorrection : 0;
  const range = racket.faceEnvelope || paddleContactRange(racket.grip, racket.stroke && racket.stroke.id, racket.forehand !== false, racket.isServe);
  if (range) phi = clamp(phi, range[0] * DEG, range[1] * DEG);
  const af = clamp(racket.azFace + dAz, ...cfg.frameFaceRangeRad);
  dirFromAngles(outSwing, e, a, fwd);
  dirFromAngles(outNormal, phi, af, fwd);
  V3.mul(outSwing, outSwing, racket.vmag * (racket.arch.absorb ? 1 - racket.arch.absorb : 1) * scale);
  strokeBrushVelocity(racket, outSwing, outNormal);
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
const SERVE_VMAX = STROKE_CONFIG.serve.vmax;
/* The same ceiling on any OTHER stroke's bat speed, in m/s. deriveStroke()
 * clamps its raw vmag here; refineRacket()'s scale search has to respect it
 * too, or the "physical aim assist" quietly turns a wrist flick into a
 * 40 m/s arm. */
const RACKET_VMAX = STROKE_CONFIG.racket.vmax;
/* ...and the same ceiling expressed as ball speed, enforced inside the score
 * so the search never *chooses* a serve that is too fast to be played: at
 * 60 km/h off a 0.20 m contact the ball reaches the tape before it has had
 * time to rise over it, and the result was a serve that faulted into the net
 * in a third of attempts while looking like the player's own fault. */
const SERVE_BALL_MAX = STROKE_CONFIG.serve.ballMax;

const SERVE_WARM = new Map();
function serveWarmKey(side, racket) {
  const st = racket.stroke || {};
  const aim = racket.aim || {};
  /* Quantise to the 15x15 cell size (0.09 m), not to a third of a metre.
   * The old key merged nine neighbouring cells into one entry, so the first
   * solve of an area answered for all of them — measured: the depth of the
   * second bounce was the same for every cell in a 0.33 m band. */
  return side + '|' + (racket.grip || 'legacy') + '|' + (racket.forehand !== false ? 'fh' : 'bh') + '|' + (st.id || '?') + '|' +
    Math.round((aim.z || 0) / STROKE_CONFIG.serve.solver.warmGrid) + '|' + Math.round((aim.x || 0) / STROKE_CONFIG.serve.solver.warmGrid);
}
function ownFor(aim, side) {
  const own = STROKE_CONFIG.serve.solver.ownBounce;
  return { x: aim.x * own.lateralK, z: side * (own.depth + Math.abs(aim.z) * own.aimDepthK) };
}

function solveServeStroke(ballP, racket, evalStroke, side, assist) {
  const cfg = STROKE_CONFIG.serve, solver = cfg.solver, costs = solver.score;
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
  const PACE_W = solver.paceWeights[0];
  const PACE_W_UP = solver.paceWeights[1];
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
  const SPIN_W = solver.spinWeight;
  const spinWant = racket.spinWant || 0;
  /* Hard ceiling on the work one serve may do. The search is a heuristic and
   * a pathological gesture (a 6-sample tap) used to walk every ladder, every
   * recovery sweep and then be solved a second time by the caller: measured
   * 730 ms, i.e. 44 dropped frames, on a ball that was never going to be a
   * legal serve. Past the budget the search stops and returns the best
   * candidate it has, so the worst case is bounded and known. */
  const FLIGHT_BUDGET = solver.flightBudget;
  let flights = 0;
  /* Metres past the net a serve's second bounce must reach to be worth
   * playing (the bat's step-in limit is 0.86 m from the centre line). */
  const SERVE_MIN_PAST_NET = solver.minPastNet;
  /* Pace is charged against the swing the SERVER asked for — but a short
   * serve is soft by construction, and the old flat 0.85 per e-fold made it
   * strictly cheaper to ignore a short aim than to hit it (a serve at
   * sc 0.37 paid 0.85, more than a 0.6 m placement error). Weight the
   * penalty by how deep the aim is: softness is only "losing the player's
   * power" when the ball was supposed to be driven deep. Deep aims keep the
   * exact old cost (weight clamps at 1.0 for |z| >= 0.90 m). */
  const paceCost = (sc, aim) => {
    const l = Math.log(clamp(sc, ...solver.paceScaleRange));
    if (l >= 0) return PACE_W_UP * l;
    const w = clamp((Math.abs((aim && aim.z) || 0) - SERVE_MIN_PAST_NET) / solver.depthSpan, 0, 1);
    return PACE_W * -l * w;
  };

  const score = (own, aim, dE, dA, sc, dmp, fine) => {
    flights++;
    evalStroke(dE, dA, sc, dmp, v, w);
    legal = false; why = 'none';
    const pc0 = paceCost(sc, aim);
    if (v.z * side > -costs.forwardMin) { why = 'back'; return costs.back; }
    const spd = V3.len(v);
    if (spd > cfg.ballMax) { why = 'fast'; return costs.fast + (spd - cfg.ballMax) * costs.fastK; }
    predict(V3.clone(launchPoint(ballP, _rn)), V3.clone(v), V3.clone(w),
      /* maxT has to be the same for the coarse and the fine pass. Cutting the
       * coarse pass to 1.6 s looked like free speed, but a soft serve needs
       * ~1.8 s to complete BOTH bounces — so the search never saw a second
       * bounce, scored the good solution as 'long', and walked away from it.
       * That is why a weak tap was a fault in 100 % of cases at every assist
       * level. stopAfterBounces already ends fast serves early, so the honest
       * horizon costs almost nothing. */
      { dt: fine ? PH.SIM_DT : solver.coarseDt, maxT: solver.maxT, stopAfterBounces: 2, out: _svRep });
    const r = _svRep;
    if (r.bounces === 0) { why = r.hitNet ? 'net' : 'none'; return costs.noBounce + (r.hitNet ? costs.netTouch : 0); }
    if (Math.sign(r.landed.z) !== side) { why = 'wrongside'; return costs.wrongSide + Math.abs(r.landed.z - own.z) + pc0; }
    const d1 = Math.hypot(r.landed.x - own.x, r.landed.z - own.z);
    if (r.hitNet) { why = 'net'; return costs.net + d1 * costs.netOwnK + Math.max(0, PH.NET_TOP + PH.R - (r.netCross ? r.netCross.y : 0)) * costs.netHeightK + pc0; }
    if (!r.b2) {                                              // flew past the table
      why = 'long';
      const pc = r.floor || r.planeCross;
      const miss = pc ? Math.hypot(pc.x - aim.x, pc.z - aim.z) : costs.missingLanding;
      return costs.long + miss * costs.longMissK + d1 * costs.longOwnK + pc0;
    }
    if (Math.sign(r.b2.z) === side) { why = 'own'; return costs.doubleOwn + d1 + pc0; }
    /* ITTF 2.06.4: the second bounce must be ON the receiver's court. The
     * old test only looked at the SIDE of the bounce, so a serve that flew
     * 30 cm past the end line was certified legal and scored as if it had
     * landed on the table (its only cost was the distance to the aim).
     * Measured on the 15x15 grid: 15-23 % of requested placements were
     * "valid" serves that actually missed the court. */
    const offX = Math.abs(r.b2.x) - PH.T_HALF_WID - PH.R * costs.edgeRadiusK;
    const offZ = Math.abs(r.b2.z) - PH.T_HALF_LEN - PH.R * costs.edgeRadiusK;
    if (offX > 0 || offZ > 0) {
      why = 'out';
      const miss = Math.hypot(Math.max(0, offX), Math.max(0, offZ));
      return costs.out + miss * costs.outMissK + d1 * costs.longOwnK + pc0;
    }
    legal = true; why = 'ok';
    const spinCost = spinWant ? SPIN_W * Math.abs(w.z - spinWant) / STROKE_CONFIG.spin.cap : 0;
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
    const aimDeep = clamp((Math.abs(aim.z) - SERVE_MIN_PAST_NET) / solver.depthSpan, 0, 1);
    const dead = (pastNet < SERVE_MIN_PAST_NET && aimDeep > 0)
      ? (SERVE_MIN_PAST_NET - pastNet) * solver.deadZoneWeight * aimDeep : 0;
    return Math.hypot(r.b2.x - aim.x, r.b2.z - aim.z) + d1 * costs.ownK + pc0 + dead + spinCost;
  };

  const DMP = solver.damping;
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
    if (legal && _svRep.b2 && warmDeep && warmErr <= solver.warmErrorMax) {
      bE = warm.dE; bA = warm.dA; bS = warm.sc; bD = warm.dmp;
      bV = sv; bAim = aimW; bOwn = ownW; solvedLegal = true;
    }
  }

  const aimBase = aimReq;

  if (!solvedLegal) {
  // A hard topspin serve simply cannot be aimed at the very back line and
  // stay legal on a bad toss, so shorten the target until it works — but in
  // small steps. The old jump straight to 0.70 was what turned a slightly
  // mistossed serve into a ball that died behind the net and could not be
  // reached at all.
  for (const depthF of solver.depthFactors) {
    const aim = { x: aimBase.x, z: aimBase.z * depthF };
    /* Where the FIRST bounce is wanted. It used to be 0.40 m in front of the
     * net, i.e. ~0.9 m away from the server's own end line — a loopy ball
     * that has to be hit upwards to arrive at all, which is half of why
     * serves looked floaty. Real servers bounce it near their own end line
     * and drive it through; 0.78 + a little of the requested depth does that
     * and, measured, lifts the median second bounce from 0.44 m to ~1.1 m
     * past the net. */
    const own = ownFor(aim, side);

    // stage 1 — how far must the swing direction be pulled back to centre?
    let aBest = 0, aBestV = Infinity;
    for (let i = solver.azimuthIndices[0]; i <= solver.azimuthIndices[1]; i++) {
      const dA = i * solver.azimuthStep;
      const sv = score(own, aim, 0, dA, solver.initialScale, 1, false);
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
    let eBest = 0, sBest = solver.initialScale, vBest = Infinity;
    for (let i = solver.elevationIndices[0]; i <= solver.elevationIndices[1]; i++) {
      const dE = i * solver.elevationStep;
      for (const sc of solver.scales) {
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
    if (Math.abs(aim.z) < solver.shortAimMax) {
      for (const dE of solver.shortElevations) {
        for (const sc of solver.shortScales) {
          for (const dmp of DMP) {
            const sv = score(own, aim, dE, aBest, sc, dmp, false);
            if (sv < vBest) { vBest = sv; eBest = dE; sBest = sc; dBest = dmp; }
          }
        }
      }
    }
    // stage 3 — swing scale and softness around that winner
    for (const sMul of solver.scaleMultipliers) for (const dmp of DMP) {
      const sc = Math.max(solver.minScale, sBest * sMul);
      const sv = score(own, aim, eBest, aBest, sc, dmp, false);
      if (sv < vBest) { vBest = sv; sBest = sc; dBest = dmp; }
    }
    // stage 4 — local coordinate descent, confirmed at the production step
    for (let it = 0; it < solver.polishPasses; it++) {
      const sE = solver.polishSteps[0] / (it + 1), sA = solver.polishSteps[1] / (it + 1), sS = solver.polishSteps[2] / (it + 1);
      let improved = false;
      const fine = it === solver.polishPasses - 1;
      for (const [ddE, ddA, mulS] of [[sE, 0, 1], [-sE, 0, 1], [0, sA, 1], [0, -sA, 1], [0, 0, 1 + sS], [0, 0, 1 - sS]]) {
        const sc2 = Math.max(solver.minScale, sBest * mulS);
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
      let [lo, hi] = solver.recoveryScaleRange, sTry = sBest;
      for (let j = 0; j < solver.recoveryPasses && !solvedLegal && hi - lo > solver.recoveryScaleTolerance; j++) {
        if (why === 'long' || why === 'out') hi = sTry; else lo = sTry;
        sTry = 0.5 * (lo + hi);
        const s2 = score(own, aim, eBest, aBest, sTry, dBest, true);
        if (legal) { vBest = Math.min(vBest, s2); sBest = sTry; solvedLegal = true; break; }
        if (s2 < vBest) { vBest = s2; sBest = sTry; }
      }
      // last resort: the other hand softness, at whatever scale we settled on
      if (!solvedLegal) {
        for (const dmp of DMP) {
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
      for (const ddA of solver.recoveryAzimuths) {
        const s2 = score(own, aim, eBest, aBest + ddA, sBest, dBest, true);
        if (legal) { vBest = Math.min(vBest, s2); aBest += ddA; solvedLegal = true; break; }
        if (s2 < vBest) { vBest = s2; aBest += ddA; }
      }
    }
    if (!solvedLegal && why === 'net') {
      const e0 = eBest;
      for (const ddE of solver.recoveryElevations) {
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
      const maxScale = Math.min(solver.maxScaleWeights[0] + solver.maxScaleWeights[1] * clamp(assist, 0, 1),
        cfg.vmax / Math.max(0.5, racket.vmag || 1));
      for (const sc of solver.boostedScales) {
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
      const e0 = clamp(racket.elev * DEG, ...STROKE_CONFIG.racket.frameElevRangeRad);
      const cRad = clamp(racket.contact * DEG, 0, STROKE_CONFIG.racket.frameElevRangeRad[1]);
      const isBack = !!(racket.arch && racket.arch.back);
      const maxScale2 = Math.min(solver.maxScaleWeights[0] + solver.maxScaleWeights[1] * clamp(assist, 0, 1),
        cfg.vmax / Math.max(0.5, racket.vmag || 1));
      for (const phi of solver.fallbackFaceAnglesRad) {
        const eW = isBack ? phi - cRad : phi + cRad;
        const dE = clamp(eW - e0, -1.30, 1.30);
        for (const sc of solver.fallbackScales) {
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
      const maxScale = Math.min(solver.maxScaleWeights[0] + solver.maxScaleWeights[1] * clamp(assist, 0, 1),
        cfg.vmax / Math.max(0.5, racket.vmag || 1));
      let bestS = bS, bestV = Infinity;
      for (const mul of solver.depthBoostScales) {
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
    const own = { x: 0, z: side * solver.safeOwnDepth };
    const aim = { x: 0, z: -side * solver.safeAimDepth };
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
    const lifts = solver.safeElevations;
    const azes = solver.safeAzimuths;
    const scales = solver.safeScales;
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
  const k = clamp(solver.assistWeights[0] + solver.assistWeights[1] * assist, 0, 1);
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
    if (SERVE_WARM.size < solver.warmLimit) SERVE_WARM.set(warmKey, { dE: bE, dA: bA, sc: bS, dmp: bD });
    return { dE: fE, dA: fA, sc: fS, dmp: fD, ok: true, target: bAim };
  }
  // The player's own error would have produced an illegal serve: give them
  // the solved one instead. Only a truly absurd gesture can fail here.
  score(bOwn, bAim, bE, bA, bS, bD, true);
  if (legal && _svRep.b2 && SERVE_WARM.size < solver.warmLimit)
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

function refineRacket(ballP, ballV, ballW, racket, assist, quality) {
  if (racket.isServe || racket.stroke?.id === 'SIDE') racket = { ...racket, ballVelocity: V3.clone(ballV) };
  const fwd = -racket.side;
  const rubber = Object.assign({}, racket.rubber || {});
  const materialDamp = rubber.damp ?? STROKE_CONFIG.racket.rubber?.damp ?? 1;
  const q = quality !== undefined ? quality : racket.quality;
  const side = racket.side;
  let wristCorrection = 0;

  const evalStroke = (dE, dA, sc, dmp, outV, outW) => {
    strokeFrame(racket, dE, dA, sc, _rs, _rn, wristCorrection);
    // strokeFrame applies the same serve brush and speed ceiling in search and play.
    V3.copy(outV, ballV); V3.copy(outW, ballW);
    rubber.damp = materialDamp * dmp;
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
    rubber.damp = materialDamp * srv.dmp;
    return resolvedRacketFrame(racket, _rn, _rs, {
      rubber,
      dElev: srv.dE, dAz: srv.dA, scale: srv.sc, damp: srv.dmp,
      solved: true, valid: srv.ok, target: srv.target,
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
  const scCeil = STROKE_CONFIG.racket.vmax / Math.max(0.5, racket.vmag * absorbK);

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
  const validate = (e_, a_, s_, d_, fine) => {
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
    // A sideline miss has a plane crossing but no legal table landing.
    const crossing = chk.landed || chk.planeCross;
    const latErr = crossing ? crossing.x - target.x : 0;
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
    const crossing = chk.landed || chk.planeCross;
    if (crossing && Math.abs(crossing.x - target.x) > .16)
      dA = clamp(dA - Math.sign(crossing.x - target.x) * (.03 + j * .02), -1.15, 1.15);
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
    const maxScale = Math.min(1.35, STROKE_CONFIG.racket.vmax / Math.max(STROKE_CONFIG.racket.vmin, racket.vmag));
    for (const face of [envelope[1], (envelope[0] + envelope[1]) * .5, envelope[0]]) {
      for (const arm of [35, 50, 20, 65]) {
        for (const scale of [Math.min(1, maxScale), Math.min(.75, maxScale), maxScale]) {
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
  rubber.damp = materialDamp * dmp;
  return resolvedRacketFrame(racket, normal, swing, { rubber, dElev: dE, dAz: dA, dWrist: wristCorrection, scale: sc, damp: dmp, solved: sol, target, valid: verdict === 0 });
}

/** Cheap post-hoc report of where a struck ball will actually go. */
function shotReport(p, v, w, out) {
  return predict(V3.clone(p), V3.clone(v), V3.clone(w),
    { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: out || _rout });
}
