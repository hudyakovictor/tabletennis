/* One versioned player-control contract. Not difficulty, equipment, cosmetics
 * or handedness. Distances are metres; marker sizes are CSS pixels, NOT hit
 * radii. Keep input affordance, timing and physical capture separate. */
'use strict';
/* Тренировка расширяет честный захват мягким множителем: цель урока —
 * ВЫУЧИТЬ жест, а не проиграть на миллиметре. Матчевые радиусы строгие,
 * сам MATCH_RULES остаётся замороженным. */
let CAPTURE_FORGIVE = 1;
function setCaptureForgiveness(k) { CAPTURE_FORGIVE = (Number.isFinite(k) && k > 0) ? k : 1; }
function getCaptureForgiveness() { return CAPTURE_FORGIVE; }
const MATCH_RULES = Object.freeze(Object.assign({
  version: 4,
  zoneShape: 'oval',           // 'circle' keeps pressHitZone for A/B comparison
  pressRadiusPx: 96,           // legacy circle admission for real pointer-down events
  ovalLeadSec: .16,            // how far ahead of the ball a backswing may start
  ovalForwardPx: 24,           // fixed forward allowance, CSS px
  ovalForwardMaxPx: 120,       // hard cap on the forward half-axis, CSS px (simulator-selected)
  ovalBackPx: 18,              // allowance behind the ball, CSS px
  ovalSideMousePx: 44,         // transverse allowance for a mouse press
  ovalSideTouchPx: 60,         // transverse allowance for touch/pen (finger occludes the ball)
  ovalMinSpeedPx: 8,           // circle below this screen speed
  ovalFullSpeedPx: 120,        // full oval at/above this screen speed; smoothstep between
  ovalSampleDtSec: .05,        // projection interval for screen velocity
  serveTossMinRise: .16,       // ITTF minimum toss rise, metres above release
  trajectoryAssist: .85,
  positionAssist: .85,
  sensitivity: 1,
  captureRadius: .22,        // v3: about a blade plus a finger of forgiveness (was .62 — half a metre of invisible reach)
  depthTolerance: .22,      // v3: auto-footwork puts the blade at the ball's depth (was .62)
  serveCaptureRadius: .55,  // falling toss only; the bat already slides under the toss (was .88)
  sweetRadius: .15225,       // contact-quality reference, NOT capture radius
  timingMinPx: 8,
  timingMaxPx: 20,
  timingHorizon: .44,
  contactAtClosest: true,     // endpoint contact at the closest approach, not on entry into the box
  zoneAnchor: 'contact',       // 'ball' — oval around the ball at pointerdown; 'contact' — around the predicted meeting point at the bat plane
  /* v4 — the gate is laid out where the PHYSICS can return the ball (outcome map, tools/e2e/tzmap.py):
   * an upward swipe only ever returns a ball when it starts 0..170 px BELOW the meeting point
   * (0 % from anywhere above it), a downward push/chop only from 0..130 px ABOVE it (0 % from below).
   * v3 (fwd 100 / back 36) admitted the dead band just above the point for drives and turned away
   * both the deep backswing and almost every push. The press is admitted in this two-sided oval;
   * validatePressDirection then keeps only the side the swipe actually comes from. */
  contactForwardPx: 150,      // contact gate: how far BELOW the meeting point an upward swipe may start
  contactBackPx: 120,         // contact gate: how far ABOVE it a downward push/chop may start
  contactSideTouchPx: 64,     // contact gate half-width, finger (physics returns up to ~50 px off-line)
  contactSideMousePx: 46,     // contact gate half-width, mouse
  /* The px values above are REFERENCE pixels: 390×844 phone, BROADCAST camera, where a centimetre at the
   * meeting point is 2.94 px wide and 2.39 px tall. 'world' scales them by the local projection at the
   * meeting point, so the gate covers the same centimetres around the ball on every phone and camera
   * (v3 ranged 10.9..20.9 cm across devices and presets); the floors keep it finger-sized. */
  zoneScale: 'world',         // 'world' | 'px'
  zoneRefPxPerCmX: 2.94,
  zoneRefPxPerCmY: 2.39,
  zoneScaleMin: .75, zoneScaleMax: 1.5,
  contactMinSideTouchPx: 52, contactMinSideMousePx: 38, contactMinAlongPx: 70,
  contactEdgePx: 20,          // a meeting point past the screen edge is gated at the edge (finger can't go off-screen)
  magnet: 0,                  // visible lateral pull of the bat toward the predicted meeting point (0..1)
  magnetRadius: 0,            // metres; outside this the bat obeys the pointer exactly
  magnetHorizon: .45,
  autoFootwork: true,         // the bat's DEPTH follows the ball's best hitting point after its bounce (x/y stay under the finger)
  footworkHeight: .40,        // m above the table: the descending ball is struck at this height (or at the stance plane, whichever first)         // seconds before contact when the pull may start
}, (typeof globalThis !== 'undefined' && globalThis.__TT_RULES) || {}));

/** Read-only compatibility for old modules/saves. Setters deliberately ignore
 * legacy writes instead of crashing a strict-mode old career/perk caller.
 * Physics reads MATCH_RULES directly. These keys do not enter new saves. */
function installUnifiedControls(settings) {
  const fixed = { hitZone: .85, assist: MATCH_RULES.trajectoryAssist,
    posAssist: MATCH_RULES.positionAssist, sensitivity: MATCH_RULES.sensitivity, showZone: true };
  for (const [key, value] of Object.entries(fixed)) {
    Object.defineProperty(settings, key, { configurable: false, enumerable: false,
      get() { return value; }, set(_ignored) {} });
  }
  return settings;
}
function playerCaptureLimits(isServe) {
  return { radius: (isServe ? MATCH_RULES.serveCaptureRadius : MATCH_RULES.captureRadius) * CAPTURE_FORGIVE,
    depth: MATCH_RULES.depthTolerance * CAPTURE_FORGIVE, sweet: MATCH_RULES.sweetRadius };
}

/**
 * Describe a ball relative to the actual racket plane.  Old endpoint capture
 * used world XY plus world Z while CCD used the blade normal, so rotating a
 * racket silently changed one gate but not the other.  Passing a bare point
 * remains supported for tooling/legacy callers and retains that old world
 * fallback; live gameplay passes the full paddle with its normal.
 */
function paddleCaptureGeometry(ball, paddle) {
  const p = paddle && (paddle.pos || paddle);
  if (!ball || !p || ![ball.x, ball.y, ball.z, p.x, p.y, p.z].every(Number.isFinite)) return null;
  const dx = ball.x - p.x, dy = ball.y - p.y, dz = ball.z - p.z;
  const n = paddle && paddle.normal;
  if (n && [n.x, n.y, n.z].every(Number.isFinite)) {
    const nl = Math.hypot(n.x, n.y, n.z);
    if (nl > 1e-7 && Number.isFinite(nl)) {
      const nx = n.x / nl, ny = n.y / nl, nz = n.z / nl;
      const signedDepth = dx * nx + dy * ny + dz * nz;
      const rx = dx - nx * signedDepth, ry = dy - ny * signedDepth, rz = dz - nz * signedDepth;
      return { p, nx, ny, nz, signedDepth, depthGap: Math.abs(signedDepth),
        radial: Math.hypot(rx, ry, rz), distance: Math.hypot(dx, dy, dz), local: true };
    }
  }
  // Compatibility fallback for call sites which only have a centre point.
  return { p, nx: 0, ny: 0, nz: 1, signedDepth: dz, depthGap: Math.abs(dz),
    radial: Math.hypot(dx, dy), distance: Math.hypot(dx, dy, dz), local: false };
}

/** Endpoint capture used by impact AND the timing cue. CCD remains the
 * additional continuous path for a fast crossing between physical substeps.
 * This does not manufacture a stroke: callers still enforce fresh gestures,
 * bounce legality, toss height and the consumed-once rule. */
function playerInCaptureRange(ball, paddle, isServe = false) {
  const geo = paddleCaptureGeometry(ball, paddle);
  if (!geo) return false;
  const limits = playerCaptureLimits(isServe);
  return isServe ? geo.distance <= limits.radius
    : geo.radial <= limits.radius && geo.depthGap <= limits.depth;
}
/** Pure overlay model: cue follows the ball; no fake area-of-effect circle.
 * A warm solid bracket means an available time/position window, never an
 * automatic hit. Early dashed brackets differ by shape as well as colour. */
function strikeCueModel(window) {
  if (!window || !window.on || !['rally', 'serve'].includes(window.kind) || !Number.isFinite(window.t)
      || !Number.isFinite(window.k) || !Number.isFinite(window.ready)
      || window.t > MATCH_RULES.timingHorizon || window.k < .02) return null;
  const hot = window.contactable === true && window.ready > .82;
  return { radius: MATCH_RULES.timingMinPx + Math.min(1, Math.max(0, window.t / MATCH_RULES.timingHorizon))
      * (MATCH_RULES.timingMaxPx - MATCH_RULES.timingMinPx),
    hot, dashed: !hot, alpha: Math.min(1, Math.max(0, window.k)) * (hot ? .9 : .5) };
}

/** Inverse capture: where the bat centre may be for this actual ball.
 * Section is drawn at the bat's depth, not a misleading screen-space circle. */
/* ==== Grace band: срезанное касание краем ракетки =========================
 * Между честным захватом (contact box) и чистым пропуском мяча лежит
 * реальная полоса: игрок попал жестом в зону и довёл ракетку до мяча, но
 * не основанием, а краем. В настольном теннисе такой мяч НЕ пролетает мимо
 * бесшумно: он цепляет край основания или накладку и улетает слабо, криво,
 * с битым вращением — соперник его добирает, очко продолжается. Полоса
 * кольцевая, НАРУЖУ от честного бокса; константы отдельным frozen-контрактом,
 * чтобы MATCH_RULES (правила честного захвата) остались неизменными. */
const GRACE_RULES = Object.freeze({
  bandMul: 1.34,        // розыгрыш: кольцо (1 .. 1.34]×captureRadius по бокам
  serveBandMul: 1.36,   // подача: своё кольцо (мяч почти неподвижен, радиус иной)
  depthMul: 1.75,       // по глубине кольцо шире — догнать мяч вдоль полёта проще
  padVelK: 0.42,        // доля скорости замаха, передаваемая срезанным касанием
  minCarryMs: 2.6,      // минимальная скорость вылета у срезанного мяча
  maxCarryMs: 6.2,      // и его потолок — царапина не бывает пулей
  upNormal: 0.42,       // подъём синтетической грани: мяч несётся к столу, не в пол
  fwdNormal: 0.90,      // и насколько грань смотрит на чужую половину
  scatterYawRad: 0.11,  // ±6° случайный разворот грани (и результата)
  scatterPitchRad: 0.06,
  scatterSpin: 85,      // рад/с битого вращения срезанного касания
  quality: 0.30,        // фиксированное качество краевого контакта
  serveLiftMs: [1.55, 2.6],  // царапня-подача — МЕДЛЕННО и ВЫСОКО: срезанный
                             // мяч с ветром падения всё равно передаёт от биты,
                             // так что только низкоскоростной дуговой вариант
                             // сначала касается своей половины (проверено
                             // таблицей-добором по всей геометрии тосса)
  serveSpeedMs: [1.3, 3.0],  // скорость добора; быстрее — мяч перелетает за 1 отскок
  serveCounterAim: 0.9,      // контр-прицел к центру: боковой тосс тянем в стол
  serveSideK: 1.30,          // зона нажатия на подаче шире вбок (подача сбоку)
  serveFwdK: 1.15,           // и чуть длиннее вперёд (подающий рвётся вперёд)
});

/* Кольцо краевого контакта: та же геометрия, что у честного захвата, но
 * радиусы домножены на множители кольца. Внутри честного бокса grace не
 * нужен: вызывающий код проверяет capture ПЕРВЫМ, и эта функция тоже —
 * она никогда не возвращает true там, где уже сработал чистый захват. */
function playerGraceRange(ball, paddle, isServe = false) {
  const geo = paddleCaptureGeometry(ball, paddle);
  if (!geo || playerInCaptureRange(ball, paddle, isServe)) return false; // clean capture wins over an edge
  return isServe
    ? geo.distance <= MATCH_RULES.serveCaptureRadius * CAPTURE_FORGIVE * GRACE_RULES.serveBandMul
    : geo.radial <= MATCH_RULES.captureRadius * CAPTURE_FORGIVE * GRACE_RULES.bandMul
      && geo.depthGap <= MATCH_RULES.depthTolerance * CAPTURE_FORGIVE * GRACE_RULES.depthMul;
}

function capturePlaneBasis(geo) {
  /* Pick a stable perpendicular pair for the projected contact disk. */
  let ux = -geo.nz, uy = 0, uz = geo.nx;
  let ul = Math.hypot(ux, uy, uz);
  if (ul <= 1e-7) { ux = 1; uy = 0; uz = 0; ul = 1; }
  ux /= ul; uy /= ul; uz /= ul;
  return { ux, uy, uz,
    vx: geo.ny * uz - geo.nz * uy,
    vy: geo.nz * ux - geo.nx * uz,
    vz: geo.nx * uy - geo.ny * ux };
}
function ballCaptureTarget(paddle, ball, serving = false) {
  if (!paddle || !paddle.pos || !ball) return null;
  const geo = paddleCaptureGeometry(ball, paddle);
  if (!geo) return null;
  const limits = playerCaptureLimits(serving);
  const depth = serving ? limits.radius : limits.depth;
  const depthOk = geo.depthGap <= depth;
  const radius = serving ? Math.sqrt(Math.max(0, limits.radius ** 2 - geo.depthGap ** 2)) : limits.radius;
  /* Projection of the ball onto the blade plane. This is the same local plane
   * endpoint capture and CCD use, so the diagnostic ring cannot promise a
   * contact that the physical gate rejects. */
  const center = { x: ball.x - geo.nx * geo.signedDepth, y: ball.y - geo.ny * geo.signedDepth,
    z: ball.z - geo.nz * geo.signedDepth };
  const points = [];
  if (depthOk) {
    const basis = capturePlaneBasis(geo);
    for (let i = 0; i <= 48; i++) {
      const a = i / 48 * Math.PI * 2, c = Math.cos(a) * radius, q = Math.sin(a) * radius;
      points.push({ x: center.x + basis.ux * c + basis.vx * q,
        y: center.y + basis.uy * c + basis.vy * q,
        z: center.z + basis.uz * c + basis.vz * q });
    }
  }
  return { center, points, radius, limitRadius: limits.radius, depth, depthGap: geo.depthGap,
    signedDepth: geo.signedDepth, radial: geo.radial, localPlane: geo.local, depthOk,
    inside: playerInCaptureRange(ball, paddle, serving), serving };
}

/** Numeric evidence at one physical substep, before impact changes the ball.
 * Endpoint and continuous routes use the exact same disk/slab (or serving
 * sphere), allowing diagnostics to explain the contact the game actually saw. */
function measureCaptureAllowance(paddle, p0, p1, serving, endpointEligible) {
  const p = paddle && paddle.pos, previous = paddle && paddle.prevPos;
  if (!p || !previous || !p0 || !p1 ||
      ![p.x,p.y,p.z,previous.x,previous.y,previous.z,p0.x,p0.y,p0.z,p1.x,p1.y,p1.z].every(Number.isFinite)) return null;
  const end = paddleCaptureGeometry(p1, paddle);
  if (!end) return null;
  const limits = playerCaptureLimits(serving);
  const endpointRadius = endpointEligible && (serving || end.depthGap <= limits.depth)
    ? (serving ? end.distance : end.radial) : null;

  const r0x = p0.x - previous.x, r0y = p0.y - previous.y, r0z = p0.z - previous.z;
  const r1x = p1.x - p.x, r1y = p1.y - p.y, r1z = p1.z - p.z;
  const drx = r1x - r0x, dry = r1y - r0y, drz = r1z - r0z;
  let ccdRadius = null, ccdT = null, ccdDepthGap = null;
  if (serving) {
    /* Toss contact is intentionally spherical. Its continuous companion is
     * therefore the closest approach of the same moving sphere, not a blade
     * plane that could disagree at a high toss angle. */
    const dd = drx * drx + dry * dry + drz * drz;
    const t = dd > 1e-12 ? Math.max(0, Math.min(1, -(r0x * drx + r0y * dry + r0z * drz) / dd)) : 0;
    const ex = r0x + drx * t, ey = r0y + dry * t, ez = r0z + drz * t;
    ccdRadius = Math.hypot(ex, ey, ez); ccdT = t; ccdDepthGap = ccdRadius;
  } else if (end.local || (paddle && paddle.normal)) {
    const n = paddle.normal || { x: 0, y: 0, z: 1 };
    const nl = Math.hypot(n.x, n.y, n.z);
    if (Number.isFinite(nl) && nl > 1e-7) {
      const nx = n.x / nl, ny = n.y / nl, nz = n.z / nl;
      const d0 = r0x * nx + r0y * ny + r0z * nz;
      const d1 = r1x * nx + r1y * ny + r1z * nz;
      if (d0 > PH.R && d1 <= PH.R) {
        const t = Math.max(0, Math.min(1, (d0 - PH.R) / Math.max(d0 - d1, 1e-9)));
        const ex = r0x + drx * t, ey = r0y + dry * t, ez = r0z + drz * t;
        const dn = ex * nx + ey * ny + ez * nz;
        ccdRadius = Math.hypot(ex - nx * dn, ey - ny * dn, ez - nz * dn);
        ccdT = t; ccdDepthGap = Math.abs(dn);
      }
    }
  }
  const candidates = [endpointRadius, ccdRadius].filter(Number.isFinite);
  return { serving: !!serving, radius: limits.radius, depthLimit: limits.depth,
    lateral: end.radial, radial: end.radial, depthGap: end.depthGap, signedDepth: end.signedDepth,
    distance: end.distance, endpointEligible: !!endpointEligible,
    endpointRadius, ccdRadius, ccdT, ccdDepthGap, requiredRadius: candidates.length ? Math.min(...candidates) : null,
    score: serving ? end.distance / limits.radius : Math.max(end.radial / limits.radius, end.depthGap / limits.depth) };
}

const PRESS_REJECTION_REASONS = Object.freeze([
  'OUTSIDE_ZONE', 'NO_FRESH_SWIPE', 'STATIC_CLICK', 'DEPTH_FAIL', 'TIMING_LATE',
  'TIMING_EARLY', 'CONSUMED', 'SERVE_TOSS_LOW', 'WRONG_DIRECTION', 'BOUNCE_ILLEGAL',
]);

// Actual mouse/touch press admission, in CSS pixels. Independent of quality.
function pressHitZone(ballScreen, pointer, width, height, radius = MATCH_RULES.pressRadiusPx) {
  if (!ballScreen || !ballScreen.ok || !pointer || ![ballScreen.x,ballScreen.y,pointer.x,pointer.y,width,height,radius].every(Number.isFinite) || width<=0 || height<=0 || radius<=0) return null;
  const x=ballScreen.x*width,y=ballScreen.y*height;
  const distancePx=Math.hypot(pointer.x*width-x,pointer.y*height-y);
  const accepted=distancePx<=radius;
  return { x,y,radius,distancePx,pointerX:pointer.x*width,pointerY:pointer.y*height,accepted,
    shape:'circle', score:distancePx/radius, along:null, across:null,
    reason:accepted?null:'OUTSIDE_ZONE' };
}

function pressOvalSidePx(pointerType, opts = {}) {
  if (Number.isFinite(opts.sidePx) && opts.sidePx > 0) return opts.sidePx;
  return pointerType === 'mouse' ? MATCH_RULES.ovalSideMousePx : MATCH_RULES.ovalSideTouchPx;
}

function serveTossRise(tossApex, tossStartY, tableY) {
  const start = Number.isFinite(tossStartY) ? tossStartY
    : Number.isFinite(tableY) ? tableY + .14 : NaN;
  return Number.isFinite(tossApex) && Number.isFinite(start) ? tossApex - start : NaN;
}
/** A minimum toss is inclusive. The small tolerance only absorbs binary
 * floating-point noise at the documented boundary; it is not extra height. */
function serveTossIsLegal(rise) {
  return Number.isFinite(rise) && rise >= MATCH_RULES.serveTossMinRise - 1e-6;
}

/** Oval press admission, elongated along the ball's SCREEN velocity.
 *
 * `ball` may be a world ball ({p,v} or a position plus opts.velocity) when
 * opts.project is supplied, or an already projected point ({x,y,ok}) when
 * opts.screenVelocityPx / opts.screenVelocity is supplied. The screen
 * velocity is always the difference of two projections, never the raw world
 * vector, so perspective foreshortening is part of the shape. `along` is
 * positive ahead of the ball (where a backswing starts); `across` is the
 * signed transverse offset. Half-ellipses are glued at the ball: the forward
 * half uses |v|*lead+fwdPx, the rear half uses backPx. */
function pressOvalSmoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

function pressOvalReferenceAxis(center, width, height, opts, projectWorldPoint) {
  const fromVector = (x, y) => {
    const len = Math.hypot(x, y);
    return len > 1e-9 ? { x: x / len, y: y / len } : null;
  };
  const axisPx = opts.referenceAxisPx || opts.referenceAxis;
  if (axisPx && [axisPx.x, axisPx.y].every(Number.isFinite)) {
    const axis = fromVector(axisPx.x, axisPx.y);
    if (axis) return axis;
  }
  const referenceWorld = opts.referenceWorld || opts.referencePoint || opts.racketWorld || opts.playerWorld;
  if (referenceWorld && [referenceWorld.x, referenceWorld.y, referenceWorld.z].every(Number.isFinite) &&
      typeof projectWorldPoint === 'function') {
    const p = projectWorldPoint(referenceWorld);
    if (p && [p.x, p.y].every(Number.isFinite)) {
      const axis = fromVector(p.x - center.x, p.y - center.y);
      if (axis) return axis;
    }
  }
  const referencePx = opts.referencePx || opts.racketPx || opts.playerPx;
  if (referencePx && [referencePx.x, referencePx.y].every(Number.isFinite)) {
    const axis = fromVector(referencePx.x - center.x, referencePx.y - center.y);
    if (axis) return axis;
  }
  const referenceScreen = opts.referenceScreen || opts.racketScreen || opts.playerScreen;
  if (referenceScreen && [referenceScreen.x, referenceScreen.y].every(Number.isFinite)) {
    const axis = fromVector(referenceScreen.x * width - center.x,
      referenceScreen.y * height - center.y);
    if (axis) return axis;
  }
  // The player/racket side of the authored camera is screen-down. This is
  // only a fallback; live input passes the actual racket position.
  return { x: 0, y: 1 };
}

function pressOvalBlendAxis(reference, velocityAxis, blend) {
  if (!(blend > 0)) return reference;
  if (blend >= 1) return velocityAxis;
  const dot = Math.min(1, Math.max(-1, reference.x * velocityAxis.x + reference.y * velocityAxis.y));
  const angle = Math.acos(dot), step = angle * blend;
  let px = velocityAxis.x - reference.x * dot, py = velocityAxis.y - reference.y * dot;
  const plen = Math.hypot(px, py);
  if (plen <= 1e-9) { px = -reference.y; py = reference.x; }
  else { px /= plen; py /= plen; }
  const co = Math.cos(step), si = Math.sin(step);
  return { x: reference.x * co + px * si, y: reference.y * co + py * si };
}

function pressHitZoneOval(ball, pointer, width, height, opts = {}) {
  if (!ball || !pointer || ![pointer.x, pointer.y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  /* Подача разрешает нажатие заметно сбоку от точки встречи: подающий ставит
   * корпус и руку сбоку от мяча («подать чуть сбоку»), а не ровно за ним.
   * Расширяем стороны и вылет вперёд через GRACE_RULES — MATCH_RULES (рапсоди
   * честного захвата розыгрыша) при этом не меняется. */
  if (opts.kind === 'serve') {
    opts = { ...opts,
      sidePx: (Number.isFinite(opts.sidePx) && opts.sidePx > 0 ? opts.sidePx
        : pressOvalSidePx(opts.pointerType || opts.inputType || 'touch', opts)) * GRACE_RULES.serveSideK,
      fwdPx: (Number.isFinite(opts.fwdPx) && opts.fwdPx > 0 ? opts.fwdPx : MATCH_RULES.ovalForwardPx) * GRACE_RULES.serveFwdK,
      forwardMaxPx: (Number.isFinite(opts.forwardMaxPx) && opts.forwardMaxPx > 0
        ? opts.forwardMaxPx : MATCH_RULES.ovalForwardMaxPx) * GRACE_RULES.serveFwdK };
  }
  const lead = Number.isFinite(opts.leadSec) && opts.leadSec > 0 ? opts.leadSec : MATCH_RULES.ovalLeadSec;
  const fwdPx = Number.isFinite(opts.fwdPx) && opts.fwdPx > 0 ? opts.fwdPx : MATCH_RULES.ovalForwardPx;
  const forwardMaxPx = Number.isFinite(opts.forwardMaxPx) && opts.forwardMaxPx > 0
    ? opts.forwardMaxPx : MATCH_RULES.ovalForwardMaxPx;
  const backPx = Number.isFinite(opts.backPx) && opts.backPx > 0 ? opts.backPx : MATCH_RULES.ovalBackPx;
  const pointerType = opts.pointerType || opts.inputType || 'touch';
  const sidePx = pressOvalSidePx(pointerType, opts);
  if (!(lead > 0) || !(fwdPx > 0) || !(forwardMaxPx > 0) || !(backPx > 0) || !(sidePx > 0)) return null;

  let center = null, screenVx = 0, screenVy = 0, worldVelocity = null;
  let projectWorldPoint = null;
  const pos = ball.p && [ball.p.x, ball.p.y, ball.p.z].every(Number.isFinite) ? ball.p
    : [ball.x, ball.y, ball.z].every(Number.isFinite) ? ball : null;
  if (pos && typeof opts.project === 'function') {
    worldVelocity = ball.v && [ball.v.x, ball.v.y, ball.v.z].every(Number.isFinite) ? ball.v
      : opts.velocity && [opts.velocity.x, opts.velocity.y, opts.velocity.z].every(Number.isFinite) ? opts.velocity : null;
    if (!worldVelocity) return null;
    const dt = Number.isFinite(opts.sampleDtSec) && opts.sampleDtSec > 0
      ? Math.min(.25, opts.sampleDtSec) : MATCH_RULES.ovalSampleDtSec;
    const a0 = opts.project({ x: pos.x, y: pos.y, z: pos.z });
    if (!a0 || !a0.ok || ![a0.x, a0.y].every(Number.isFinite)) return null;
    const ax = a0.x, ay = a0.y; // copy: Game.project may reuse its out object
    const a1 = opts.project({ x: pos.x + worldVelocity.x * dt,
      y: pos.y + worldVelocity.y * dt, z: pos.z + worldVelocity.z * dt });
    if (!a1 || !a1.ok || ![a1.x, a1.y].every(Number.isFinite)) return null;
    center = { x: ax * width, y: ay * height };
    screenVx = (a1.x - ax) * width / dt;
    screenVy = (a1.y - ay) * height / dt;
    projectWorldPoint = (p) => {
      const q = opts.project({ x: p.x, y: p.y, z: p.z });
      return q && q.ok && [q.x, q.y].every(Number.isFinite)
        ? { x: q.x * width, y: q.y * height } : null;
    };
  } else if (ball.ok && [ball.x, ball.y].every(Number.isFinite)) {
    center = { x: ball.x * width, y: ball.y * height };
    const sv = opts.screenVelocityPx || opts.screenVelocity || ball.screenVelocityPx || ball.screenVelocity;
    if (sv) {
      if (![sv.x, sv.y].every(Number.isFinite)) return null;
      const inPx = !!opts.screenVelocityPx || !!ball.screenVelocityPx;
      screenVx = inPx ? sv.x : sv.x * width;
      screenVy = inPx ? sv.y : sv.y * height;
    }
    worldVelocity = ball.v && [ball.v.x, ball.v.y, ball.v.z].every(Number.isFinite) ? ball.v : opts.velocity || null;
    if (typeof opts.project === 'function') projectWorldPoint = (p) => {
      const q = opts.project({ x: p.x, y: p.y, z: p.z });
      return q && q.ok && [q.x, q.y].every(Number.isFinite)
        ? { x: q.x * width, y: q.y * height } : null;
    };
  } else return null;
  if (![screenVx, screenVy].every(Number.isFinite)) return null;

  const pointerX = pointer.x * width, pointerY = pointer.y * height;
  const dx = pointerX - center.x, dy = pointerY - center.y;
  const distancePx = Math.hypot(dx, dy);
  const speedPx = Math.hypot(screenVx, screenVy);
  const referenceAxis = pressOvalReferenceAxis(center, width, height, opts, projectWorldPoint);
  const velocityAxis = speedPx > 1e-9
    ? { x: screenVx / speedPx, y: screenVy / speedPx } : referenceAxis;
  const minSpeedPx = MATCH_RULES.ovalMinSpeedPx;
  const fullSpeedPx = Math.max(minSpeedPx + 1e-9, MATCH_RULES.ovalFullSpeedPx);
  const blend = pressOvalSmoothstep((speedPx - minSpeedPx) / (fullSpeedPx - minSpeedPx));
  /* A frozen/momentumless ball (training stops the world, a lob hangs at its
   * apex) has no travel to stretch along — and a pure speed-blend collapsed
   * the admitted area into a tiny halo AROUND the ball, while the coach kept
   * teaching "press below the ring". The player pressed where the lesson
   * showed and was told "палец ближе". As speed → 0 the zone eases back to
   * a teachable FORWARD oval (its long axis = the reference hand direction,
   * forward reach ≈ forwardMaxPx); `still` decays to zero by 4× the min
   * speed, so the shape stays continuous in speedPx. `blend` keeps its
   * telemetry meaning (how much BALL SPEED stretched the oval); `blendEff`
   * and `still` are what actually shape the gate. */
  const still = pressOvalSmoothstep(1 - speedPx / (minSpeedPx * 4));
  const blendEff = Math.max(blend, still);
  // still-ball zone points where the lesson points: toward the player's hand
  const axis = still >= blend ? referenceAxis
    : pressOvalBlendAxis(referenceAxis, velocityAxis, blend);
  const axisX = axis.x, axisY = axis.y;
  const along = dx * axisX + dy * axisY;
  const across = -dx * axisY + dy * axisX;
  const uncappedForwardPx = speedPx * lead + fwdPx;
  /* a still ball teaches "press well below and lift through": give the lead
   * that a real approach swing would have earned, eased out as speed returns */
  const cappedForwardPx = Math.min(forwardMaxPx, Math.max(uncappedForwardPx, forwardMaxPx * still));
  const forwardExtent = still >= blend
    ? sidePx + (cappedForwardPx - sidePx) * blendEff
    : sidePx + (cappedForwardPx - sidePx) * blend;
  const backExtent = still >= blend
    ? sidePx + (backPx - sidePx) * blendEff
    : sidePx + (backPx - sidePx) * blend;
  const longNorm = along >= 0 ? along / forwardExtent : -along / backExtent;
  const ovalScore = Math.hypot(longNorm, across / sidePx);
  // At blend=0 both long extents equal sidePx, so this is exactly the circle
  // score for any axis; interpolated extents make the ellipse itself smooth.
  const score = ovalScore;
  let accepted = score <= 1, reason = accepted ? null : 'OUTSIDE_ZONE';
  let directionDot = null, directionOk = null;
  const swipe = opts.swipe || opts.swipeDirection;
  if (swipe && [swipe.x, swipe.y].every(Number.isFinite)) {
    const sl = Math.hypot(swipe.x, swipe.y);
    if (sl > 1e-9) {
      directionDot = distancePx > 1e-9 ? -(swipe.x * dx + swipe.y * dy) / (sl * distancePx) : 1;
      /* Nobody draws a perfectly straight line with a mouse — a diagonal flick
       * still intends "towards the ball". Touch keeps the strict hemisphere so
       * an accidental backwards push is still pushed back. */
      const dotLimit = opts.pointerType === 'mouse' ? -0.3 : 0;
      directionOk = directionDot > dotLimit;
      if (accepted && !directionOk) { accepted = false; reason = 'WRONG_DIRECTION'; }
    }
  }
  if (opts.kind === 'serve' && accepted) {
    const falling = typeof opts.falling === 'boolean' ? opts.falling
      : worldVelocity ? worldVelocity.y < 0 : screenVy > 0;
    const rise = Number.isFinite(opts.tossRise) ? opts.tossRise
      : serveTossRise(opts.tossApex, opts.tossStartY, opts.tableY);
    if (!falling || !serveTossIsLegal(rise)) { accepted = false; reason = 'SERVE_TOSS_LOW'; }
  }
  return { x: center.x, y: center.y, radius: Math.max(forwardExtent, backExtent, sidePx),
    distancePx, pointerX, pointerY, accepted, shape: blendEff > 0 ? 'oval' : 'circle',
    score, along, across, reason, directionDot, directionOk,
    axisX, axisY, referenceAxisX: referenceAxis.x, referenceAxisY: referenceAxis.y,
    velocityAxisX: velocityAxis.x, velocityAxisY: velocityAxis.y, blend,
    screenVx, screenVy, speedPx, blendEff, leadSec: lead, pointerType: opts.pointerType || opts.inputType || 'touch',
    fwdPx: forwardExtent, uncappedForwardPx, forwardMaxPx,
    backPx: backExtent, sidePx, pointerType,
    kind: opts.kind === 'serve' ? 'serve' : 'rally' };
}

/** Serve press admission: same oval, but the toss must already be falling
 * from a legal rise. Screen "forward" is therefore down the fall line. */
function pressServeZoneOval(ball, pointer, width, height, opts = {}) {
  return pressHitZoneOval(ball, pointer, width, height, { ...opts, kind: 'serve' });
}

/** Contract v3 gate: a fixed oval around the predicted MEETING POINT of
 * ball and blade. The point does not move, so the shape is not stretched by
 * ball speed: it is taller below the point (a swipe starts under the ball
 * and goes up through it) and short above it. */
function contactGateExtents(pointerType, scale) {
  const mouse = (pointerType || 'touch') === 'mouse', R = MATCH_RULES;
  const world = R.zoneScale === 'world' && scale && Number.isFinite(scale.kx) && Number.isFinite(scale.ky);
  const lim = (k) => Math.min(R.zoneScaleMax || 1.5, Math.max(R.zoneScaleMin || .75, k));
  const kx = world ? lim(scale.kx) : 1, ky = world ? lim(scale.ky) : 1;
  const minSide = (mouse ? R.contactMinSideMousePx : R.contactMinSideTouchPx) || 0, minAlong = R.contactMinAlongPx || 0;
  return { kx, ky,
    sidePx: Math.max(minSide, (mouse ? R.contactSideMousePx : R.contactSideTouchPx) * kx),
    fwdPx: Math.max(minAlong, R.contactForwardPx * ky),
    backPx: R.contactBackPx > 0 ? Math.max(Math.min(minAlong, R.contactBackPx), R.contactBackPx * ky) : 1e-3 };
}
function pressContactZone(contactScreen, pointer, width, height, opts = {}) {
  if (!contactScreen || !contactScreen.ok) return null;
  const ext = contactGateExtents(opts.pointerType, opts.scale);
  // a meeting point past the edge is gated at the edge: the finger cannot follow it off the glass
  let cx = contactScreen.x, cy = contactScreen.y, clamped = false;
  const e = (MATCH_RULES.contactEdgePx || 0) / width;
  if (e > 0 && Number.isFinite(cx) && (cx < e || cx > 1 - e)) { cx = Math.min(1 - e, Math.max(e, cx)); clamped = true; }
  const z = pressHitZoneOval({ x: cx, y: cy, ok: true }, pointer, width, height, {
    ...opts, screenVelocityPx: { x: 0, y: 1000 }, leadSec: 1e-6,
    fwdPx: ext.fwdPx, forwardMaxPx: ext.fwdPx, backPx: ext.backPx, sidePx: ext.sidePx,
  });
  if (z) { z.anchor = 'contact'; z.kx = ext.kx; z.ky = ext.ky; z.edgeClamped = clamped; }
  return z;
}

/** The one dispatch used by live input and by the debug overlay. */
function pressZoneForBall(ball, pointer, width, height, opts = {}) {
  const shape = opts.shape || MATCH_RULES.zoneShape;
  if (shape === 'oval') {
    return opts.kind === 'serve' ? pressServeZoneOval(ball, pointer, width, height, opts)
      : pressHitZoneOval(ball, pointer, width, height, opts);
  }
  const screen = ball && ball.ok ? ball
    : typeof opts.project === 'function' ? opts.project(ball && ball.p ? ball.p : ball) : null;
  return screen ? pressHitZone(screen, pointer, width, height,
    Number.isFinite(opts.radius) ? opts.radius : MATCH_RULES.pressRadiusPx) : null;
}
