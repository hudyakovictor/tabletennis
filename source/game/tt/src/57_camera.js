/* =====================================================================
 *  CAMERA — three fixed views, one composition rule, exact pointer → bat.
 *
 *  Design contract
 *  ---------------
 *  1. The view is authored — three presets differ in pitch — and then the
 *     player can TRIM it: the wheel narrows the LENS (a true dolly would
 *     leave the fitted stance and change the blade's size on screen), a
 *     right-drag rotates the eye around the table, and the same two values
 *     live as sliders in settings for touch. The trim is clamped and
 *     quantised, and after it the near edge is re-grounded onto `nearY`,
 *     so the composition rule below survives every adjustment.
 *  2. The vertical composition is written in SCREEN FRACTIONS, not metres:
 *     the near edge of the playing surface always lands on `nearY` and the
 *     reading band always starts at `PLAY_BAND_Y`. That is what makes two
 *     different phones agree.
 *  3. The table is deliberately NOT centred. The lower part of the screen
 *     is the player's own end: the bat lives there, the thumb lives there
 *     on a phone, and the reading band sits at the very bottom.
 *  4. The pointer → bat map is the exact inverse of the projection the
 *     renderer uses (same fov, same lens shift, same aspect). Put the
 *     cursor on a pixel inside the reach rectangle and the blade's centre
 *     is drawn on that pixel. The old affine map was measured up to 0.28
 *     screen-heights away from the cursor on a tablet.
 *  5. The blade's travel is bounded by a world box (the reach) that is
 *     derived FROM the camera, so its projection can never leave the frame,
 *     and it always covers the whole table.
 * ===================================================================== */
'use strict';

/* Stable front-facing views. Legacy IDs keep existing saves compatible. */
const CAMERA_PRESETS = {
  BROADCAST: { id: 'BROADCAST', ru: 'ИГРОВАЯ', short: 'ИГРА',
    desc: 'Весь стол и обе половины', pitch: 24, vfov: 48, nearY: 0.620, topMin: 0.155 },
  DYNAMIC: { id: 'DYNAMIC', ru: 'ОБЗОР', short: 'ОБЗОР',
    desc: 'Выше: легче читать отскок', pitch: 30, vfov: 52, nearY: 0.625, topMin: 0.150 },
  LOW: { id: 'LOW', ru: 'БЛИЖЕ', short: 'БЛИЖЕ',
    desc: 'Низкий и близкий — взгляд почти с уровня сетки', pitch: 15, vfov: 52, nearY: 0.560, topMin: 0.130 },
};
const CAMERA_ORDER = ['BROADCAST', 'DYNAMIC', 'LOW'];

/* Player trim on top of the authored fit. Zoom is a pure lens operation so
   the stance floor and the blade's size survive it; pitch rotates the eye
   around the look point inside an absolute elevation band. Old saves may
   still carry a trim; new input paths never change it. The loadSettings
   clamps in Game mirror
   [zoomMin, zoomMax] and [pitchMin, pitchMax] and must stay in sync. */
const CAM_ADJUST = Object.freeze({
  zoomMin: 0.60, zoomMax: 1.80,      // magnification: <1 отодвинуть, >1 приблизить
  pitchMin: -16, pitchMax: 16,       // degrees added to the preset pitch
  pitchAbsMin: 7, pitchAbsMax: 46,   // the eye never leaves this elevation band
});

/* The rectangle the blade's centre may occupy, in screen fractions. The
   bottom edge is the reading band: nothing of the game is drawn below it
   except text, so the bat never hides under a caption. The top edge is
   above the net, which is what lets the blade reach a high ball. */
const PLAY_RECT = Object.freeze({ left: 0.040, right: 0.960, top: 0.300, bottom: 0.855 });
/* Reading band: where DOM text lives. Fixed, not derived from the table. */
const PLAY_BAND_Y = 0.872;

/* World reach, metres. The per-camera limits are derived from PLAY_RECT and
   then clamped to these absolute bounds, so a contact never depends on the
   phone model by more than the capture radius already allows. */
const PADDLE_LIMITS = {
  /* 1.75, not 1.25: the pointer promise is "the blade is under the cursor",
   * and on a 16:9 screen 1.25 m cuts the last 4 % of the play rectangle off at
   * the sides — the blade then parks at the limit while the cursor keeps
   * going. The limit now sits outside the projected play rectangle on every
   * landscape viewport (the widest measured demand is 1.83 m at 1280x760),
   * so the SCREEN is the only boundary the player ever meets. */
  x: 2.00,                 // |x| of the bat, metres from the centre line
  yLo: -0.50, yHi: 1.50,   // bat height relative to the playing surface
  zNear: 1.30, zFar: 2.35, // bat depth: from near the end line to a step back
  /* The step-in depth is bounded from below by the POINTER, not by taste.
   * The blade's height limits project to a screen rectangle, and the closer
   * the blade stands the shorter that rectangle gets: at 0.78 it covers only
   * the top third of the play area. That is acceptable ONLY because
   * `depthForPointer` lets the pointer push the blade back out when it aims
   * lower, so the map stays exact instead of clamping — the blade leans in
   * for a short ball, yet a low cursor still moves it. */
  zStepIn: 0.78,           // lean over the table for a short ball
};
/* The stance the camera is authored around: the bat stays in one plane
   unless the footwork assist steps it in or the follow-through carries it. */
const PADDLE_STANCE_Z = 1.78;

/* One centimetre is two hundred times finer than any parallax the screen can
 * show, and quantising the working depth means the reach box, the blade's
 * legal volume and the plane the pointer is inverted on can never disagree
 * about which plane they are talking about. */
function quantizeDepth(z) {
  return Math.round(clamp(Number.isFinite(z) ? z : PADDLE_STANCE_Z,
    PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar) * 100) / 100;
}

/**
 * Physical envelope of the blade at depth `z`.
 *
 * The stance values are the authored box. When the footwork assist leans the
 * blade in over the table, the arm is closer to the ball and can — and in the
 * picture must — dip lower and reach wider. This is not a fudge: it is what
 * keeps the POINTER EXACT. A fixed box projected from a nearer plane covers a
 * smaller piece of the screen, so the cursor would run into a limit that the
 * picture does not show and the blade would park short of it. The envelope is
 * a function of DEPTH only — never of the viewport — so every device gives the
 * blade the same physical volume.
 */
function paddleLimitsFor(z) {
  const zq = quantizeDepth(z);
  const t = clamp((PADDLE_STANCE_Z - zq) / (PADDLE_STANCE_Z - PADDLE_LIMITS.zStepIn), 0, 1);
  const openLo = PADDLE_LIMITS.yLo - 0.14 * t;
  /* The blade may not pass through the playing surface — but only while it
   * hangs OVER the table. Behind the near edge it may dip as low as it likes,
   * which is what makes the bottom of the pointer area real once you stand
   * back. The floor therefore RAMPS from the surface clearance at the table
   * edge to the open limit at the stance, instead of switching at one depth:
   * a step here is a half-metre jump in the reachable screen for a one
   * centimetre move of the blade, and the pointer map would visibly snap. */
  const over = smoothstep(PH.T_HALF_LEN + 0.24, PADDLE_STANCE_Z, zq);
  return {
    x: PADDLE_LIMITS.x + 0.16 * t,
    yLo: lerp(0.18, openLo, over),
    yHi: PADDLE_LIMITS.yHi + 0.10 * t,
  };
}
/* Ready pose: клинок парит низко над нитью стола — 28 см над игровой
 * поверхностью. Было 42 см: при подаче ракетка визуально «торчала» в кадре
 * над краем стола (жалоба скринов). Потолок оболочки (0.62 soft / 0.72 hard)
 * и дуга вперёд (arcRestY) от этой высоты не зависят. */
const PADDLE_HOME = { x: 0, y: PH.TABLE_Y + 0.28, z: PADDLE_STANCE_Z };

/* ==== Оболочка досягаемости (reach shell) =================================
 * Указатель проецируется на плоскость ракетки ОДИН-В-ОДИН, но плоскость
 * стоит в ~2 м от камеры: верхний край экрана = 3–5 м над столом, боковые
 * — метры в стороны, «тяни вниз» уводит ракетку под плиту стола. У живого
 * игрока кисть привязана к корпусу: боковой вылет ≤ ~0.9 м, подъём ≤ ~0.95 м
 * над столом, и — главное — ПОДЪЁМ ИДЁТ ПО ДУГЕ ВПЕРЁД (к сетке), а не по
 * вертикали в потолок. Поэтому точная карта сохраняется в рабочей зоне, а к
 * краям мягко сжимается асимптотикой: ракетка следует за курсором везде и
 * монотонно, но край экрана больше не равен «пяти метрам мира».
 * Значения в метрах относительно поверхности стола. */
const REACH_SHELL = Object.freeze({
  xSoft: 0.62, xHard: 0.90,        // бока: точно внутри 62 см, потолок ~90 см
  yLoSoft: 0.06, yLoHard: 0.025,   // низ: никогда под плитой стола (над ней)
  /* Аудит №3 показал: луч камеры в портрете даёт сырые цели 0.26..2.2 м при
   * потолке руки — отсюда «ракетка висит наверху». Потолок снижен до роста
   * поднятой руки с ракеткой над столом (72 см); типичная рабочая зона —
   * обозначена мягкой кромкой 62 см. */
  yHiSoft: 0.62, yHiHard: 0.72,
  arcRestY: 0.42,                  // высота готовой позы (как PADDLE_HOME)
  /* Дуга вперёд: подъём несёт ракетку к сетке, но по ЧЕЛОВЕЧЕСКОЙ мерке —
   * 42 см вылета максимум (над столом у сетки), не 60: иначе ракетка
   * «улетает» к сетке при каждом высоком жесте. */
  arcGain: 0.85,
  arcMaxFwd: 0.42,
  arcTilt: 0.5,                    // рад. наклона лица вперёд на метр вылета
});

/* Мягкое насыщение: внутри [loSoft, hiSoft] — идентично (карта указателя
 * остаётся пиксель-точной там, где живёт игра); снаружи — гладко тяготеет
 * к жёстким границам, никогда их не достигая. Монотонно, однонаправленно. */
/* ==== Строгий курсор-солвер (pointerBladeSolve) ==========================
 * Аудит №5 («курсор и ракетка расходятся») замерил: ни лучевая проекция на
 * стойку, ни band-карта экрана не рисуют клинок под указателем — вертикаль
 * расходилась на 250-400 px в портрете, а почти половина экрана была мёртвой
 * зоной. Решение — геометрическое, не табличное: указатель задаёт ЛУЧ, а
 * глубина z плоскости подбирается так, чтобы луч попадал в физическую
 * оболочку руки. Клинок = точка пересечения луча с этой плоскостью — он
 * ПО ОПРЕДЕЛЕНИЮ под курсором (±субпиксель), а дуга «поднять руку вверх =
 * шаг вперёд к сетке» возникает физически, а не искусственным вылетом:
 * верхние строки требуют z ближе к сетке (замах вверх), нижние — отступ.
 * Мёртвая зона неизбежна только там, где луч не пересекает оболочку НИГДЕ
 * (верх ~40 % экрана в портрете — выше головы живой руки): там клинок
 * паркуется на ближайшей физической точке (все пределы глубины израсходованы).
 */
let _pbsW = null;
function pointerBladeSolve(rig, aspect, px, py, opts) {
  const o = (opts && opts.out) || {};
  const stance = PADDLE_STANCE_Z;
  const rs = REACH_SHELL;
  const limFor = (zc) => paddleLimitsFor(zc);
  /* (1) пробная точка на стойке */
  if (!_pbsW) _pbsW = { x: 0, y: 0, z: 0, t: 0 };
  if (!unprojectToPlane(rig, aspect, px, py, stance, _pbsW)) {
    o.tx = PADDLE_HOME.x; o.ty = PADDLE_HOME.y; o.tz = stance;
    o.reachFwd = 0; o.exact = true; o.zByPointer = false; return o;
  }
  const yRaw = _pbsW.y;
  /* (2) целевая высота — мягкая оболочка руки */
  const ySoft = PH.TABLE_Y + softSat(yRaw - PH.TABLE_Y,
    rs.yLoSoft, rs.yHiSoft, rs.yLoHard, rs.yHiHard);
  /* (3) bisection: найти z, где луч даёт высоту, допустимую на ЭТОЙ глубине
   * (лимита низа над столом/за краем и потолка руки). y(z) монотонно растёт
   * с z (глубже стоишь — выше на экране та же точка). */
  const zIn = opts && Number.isFinite(opts.zHint) ? clamp(opts.zHint, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar) : stance;
  const yAt = (z) => { const w = _pbsW2 || (_pbsW2 = {}); return unprojectToPlane(rig, aspect, px, py, z, w) ? w.y : NaN; };
  const inShell = (z, y) => {
    const lim = limFor(z);
    const lo = PH.TABLE_Y + Math.max(rs.yLoHard, lim.yLo);
    const hi = Math.min(PH.TABLE_Y + rs.yHiHard, PH.TABLE_Y + lim.yHi);
    return y >= lo - 1e-6 && y <= hi + 1e-6;
  };
  let z = stance, exact = true;
  const ySt = yAt(stance);
  o.exact = true;
  if (!inShell(stance, ySt)) {
    /* биссекция по z: y монотонно растёт с z */
    let a = PADDLE_LIMITS.zStepIn, b = PADDLE_LIMITS.zFar;
    const ya = yAt(a), yb = yAt(b);
    const wantY = clamp(ySoft, Math.min(ya, yb), Math.max(ya, yb));
    for (let i = 0; i < 24; i++) {
      const mid = 0.5 * (a + b), ym = yAt(mid);
      if (ym > wantY) b = mid; else a = mid;
    }
    z = 0.5 * (a + b);
    const yZ = yAt(z), limZ = limFor(z);
    const lo = PH.TABLE_Y + Math.max(rs.yLoHard, limZ.yLo);
    const hi = Math.min(PH.TABLE_Y + rs.yHiHard, PH.TABLE_Y + limZ.yHi);
    exact = yZ >= lo - 5e-3 && yZ <= hi + 5e-3;
    if (!exact) {
      /* луч не проходит оболочку нигде — парковка на ближайшей физической
       * точке: потолок/пол при максимально возможной глубине */
      const over = yZ > hi;
      z = over ? PADDLE_LIMITS.zStepIn : PADDLE_LIMITS.zFar;
      const limP = limFor(z);
      const yP = yAt(z);
      const loP = PH.TABLE_Y + Math.max(rs.yLoHard, limP.yLo);
      const hiP = Math.min(PH.TABLE_Y + rs.yHiHard, PH.TABLE_Y + limP.yHi);
      o.ty = clamp(yP, loP, hiP);
      o.exact = false;
    }
  }
  if (exact) {
    /* точка на выбранной глубине */
    const w = _pbsW3 || (_pbsW3 = {});
    unprojectToPlane(rig, aspect, px, py, z, w);
    o.ty = w.y;
  }
  const w2 = _pbsW4 || (_pbsW4 = {});
  unprojectToPlane(rig, aspect, px, py, z, w2);
  o.tx = softSat(w2.x, -rs.xSoft, rs.xSoft, -rs.xHard, rs.xHard);
  /* край по x — зажим руки: курсор ушёл за плечо, клинок на пределе пиннится.
   * Это честная граница, а не расхождение — помечаем как пин-зону. */
  if (o.exact && Math.abs(w2.x) > rs.xSoft + 1e-9) { o.exact = false; o.pinned = Math.sign(w2.x); }
  o.tz = z;
  /* An ADMITTED press knows the depth of the ball it was stamped for. The
   * shell above is a camera-map heuristic (it keeps the *cursor* inside a
   * hand-shaped box); it must not overrule the real depth of a live ball.
   * Without this the screen ray and the ball share a pixel but sit 0.6-0.8 m
   * apart in Z, so the oval admits the press and the 3D blade still never
   * enters the ball's physical envelope. The point stays ON THE RAY (under
   * the finger); only its depth is chosen by the ball, not by the shell. */
  if (opts && Number.isFinite(opts.forceZ)) {
    const zf = clamp(opts.forceZ, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
    const wF = _pbsW6 || (_pbsW6 = {});
    /* The caller only passes this for a press the gate already ADMITTED, so
     * the pointer is inside the stamped oval around this very ball: the ray
     * point at the ball's depth is within a bat-length of it by construction.
     * Keep it exactly on the ray; the physical limits are applied later by
     * the game (that clamp is what keeps the blade off the table). */
    if (unprojectToPlane(rig, aspect, px, py, zf, wF)) {
      o.tx = wF.x;
      o.ty = wF.y;
      o.tz = zf;
      o.forcedZ = true;
      o.pinned = Math.abs(wF.x) > rs.xSoft + 1e-9 ? Math.sign(wF.x) : 0;
      o.exact = !o.pinned;
    }
  }
  /* короткий мяч: шаговый ассист может углубить плоскость, но только если
   * указатель там физически достижим (та же проверка, что и у солвера) */
  if (!o.forcedZ && opts && Number.isFinite(opts.zFoot) && opts.zFoot < o.tz) {
    const yF = yAt(opts.zFoot);
    if (Number.isFinite(yF) && inShell(opts.zFoot, yF)) {
      const wF = _pbsW5 || (_pbsW5 = {});
      unprojectToPlane(rig, aspect, px, py, opts.zFoot, wF);
      o.tx = softSat(wF.x, -rs.xSoft, rs.xSoft, -rs.xHard, rs.xHard);
      o.ty = wF.y; o.tz = opts.zFoot;
    } else {
      /* указатель важнее ассиста: глубже плоскость не ставим — см. комментарий
       * у depthForPointer («никогда не игнорируй указатель»). */
    }
  }
  o.reachFwd = Math.max(0, stance - o.tz);
  o.zByPointer = Math.abs(o.tz - stance) > 1e-6;
  return o;
}
let _pbsW2, _pbsW3, _pbsW4, _pbsW5, _pbsW6;

function softSat(v, loSoft, hiSoft, loHard, hiHard) {
  if (!Number.isFinite(v)) return (loSoft + hiSoft) * 0.5;
  if (v < loSoft) {
    const s = Math.max(loSoft - loHard, 1e-6);
    return loSoft - s * (1 - Math.exp((v - loSoft) / s));
  }
  if (v > hiSoft) {
    const s = Math.max(hiHard - hiSoft, 1e-6);
    return hiSoft + s * (1 - Math.exp(-(v - hiSoft) / s));
  }
  return v;
}

/* Курсор → оболочка руки. Возвращает { tx, ty, forward, tilt }:
 * forward — на сколько метров цель придвигается К СЕТКЕ (минус z),
 * tilt — добавка наклона лица вперёд (руки, вытянутые вперёд, клонят
 * ракетку к столу — так кисть реально работала бы). */
function reachShellMap(tx, ty) {
  const ty1 = PH.TABLE_Y + softSat(ty - PH.TABLE_Y,
    REACH_SHELL.yLoSoft, REACH_SHELL.yHiSoft, REACH_SHELL.yLoHard, REACH_SHELL.yHiHard);
  const tx1 = softSat(tx, -REACH_SHELL.xSoft, REACH_SHELL.xSoft, -REACH_SHELL.xHard, REACH_SHELL.xHard);
  const lift = Math.max(0, (ty1 - PH.TABLE_Y) - REACH_SHELL.arcRestY);
  const forward = clamp(lift * REACH_SHELL.arcGain, 0, REACH_SHELL.arcMaxFwd);
  return { tx: tx1, ty: ty1, forward, tilt: forward * REACH_SHELL.arcTilt };
}


const _cp = { eye: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: 42,
  shiftY: 0, mode: 'BROADCAST', aspect: 16 / 9 };

/* ------------------------------------------------------------------ *
 *  Projection. HORIZONTAL field of view is capped at 70° so a wide
 *  monitor never turns into a fisheye; the vertical angle is the authored
 *  one and a portrait screen simply keeps it (27° horizontal on a phone
 *  would crop the table, so the fit dollies back instead — see below).
 * ------------------------------------------------------------------ */
/* The lens. ONE rule, shared by the renderer, the fit and the pointer map:
 * above 16:9 the authored vertical angle is used as-is; below it the
 * horizontal angle is locked instead, so a portrait phone widens the lens
 * rather than cropping the table. It used to live inside setCamera only,
 * which meant the fit solved for one field of view and the GPU drew
 * another — every screen-fraction the camera promised was off by up to
 * 20 % on a phone. */
/* Tuning hook for the analysis benches (tests/tools), never for the player:
   pin the dolly (.forceD), the stance floor (.dMin), the field of view
   (.forceFov) or the widest the portrait lens may get (.lensMax). */
const CAMERA_TUNING = { dMin: 0, forceD: 0, forceFov: 0, lensMax: 1.55 };
if (typeof window !== 'undefined') window.CAMERA_TUNING = CAMERA_TUNING;

const CAMERA_REF_ASPECT = 16 / 9;
function lensFovDeg(vfovDeg, aspect) {
  const a = Math.max(aspect, 0.30);
  if (a >= CAMERA_REF_ASPECT) return vfovDeg;
  const hf = 2 * Math.atan(Math.tan(vfovDeg * DEG / 2) * CAMERA_REF_ASPECT);
  const need = 2 * Math.atan(Math.tan(hf / 2) / a) / DEG;
  return Math.min(need, vfovDeg * (CAMERA_TUNING.lensMax || 1.55), CAMERA_TUNING.vMax || 84);
}
/** The vertical field of view the frame is actually drawn with. */
function verticalFovDeg(vfovDeg, aspect) {
  return lensFovDeg(vfovDeg, aspect);
}
/** Horizontal fov that results — used by the benches. */
function horizontalFovDeg(vfovDeg, aspect) {
  return 2 * Math.atan(Math.tan(lensFovDeg(vfovDeg, aspect) * DEG / 2) * Math.max(aspect, 0.2)) / DEG;
}
/** Compatible name for older benches: the vertical fov actually used. */
function effectiveFov(vfovDeg, aspect) {
  return typeof vfovDeg === 'object' && vfovDeg
    ? verticalFovDeg(vfovDeg.vfov || 44, aspect) : verticalFovDeg(vfovDeg, aspect);
}

/** view·proj for a rig — the same matrices the renderer builds. */
function rigViewProj(rig, aspect, out) {
  const vf = lensFovDeg(rig.fov, aspect) * DEG;
  const proj = M4.perspective((out && out.proj) || M4.create(), vf, aspect, 0.05, 60);
  proj[9] = 2 * (rig.shiftY || 0);
  const view = M4.lookAt((out && out.view) || M4.create(), rig.eye, rig.look, { x: 0, y: 1, z: 0 });
  return M4.mul((out && out.vp) || M4.create(), proj, view);
}

/** World → normalised screen (0..1, y down). Matches Game.project(). */
function projectPoint(vp, p, out) {
  const o = out || {};
  const cw = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
  if (cw <= 1e-4) { o.ok = false; o.x = 0.5; o.y = 0.5; o.d = cw; return o; }
  o.x = ((vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / cw) * 0.5 + 0.5;
  o.y = 0.5 - ((vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / cw) * 0.5;
  o.d = cw; o.ok = true;
  return o;
}

/* ------------------------------------------------------------------ *
 *  Camera basis. Mirrors M4.lookAt exactly:
 *    back = normalise(eye − look), right = normalise(up × back),
 *    up' = back × right, and the view looks down −back.
 * ------------------------------------------------------------------ */
const _basis = { fx: 0, fy: 0, fz: 0, rx: 0, ry: 0, rz: 0, ux: 0, uy: 0, uz: 0 };
function rigBasis(rig, out) {
  const o = out || _basis;
  const dx = rig.look.x - rig.eye.x, dy = rig.look.y - rig.eye.y, dz = rig.look.z - rig.eye.z;
  const l = Math.hypot(dx, dy, dz) || 1e-9;
  const fx = dx / l, fy = dy / l, fz = dz / l;
  const ax = -fz, az = fx, al = Math.hypot(ax, az) || 1e-9;
  const rx = ax / al, rz = az / al;
  o.fx = fx; o.fy = fy; o.fz = fz;
  o.rx = rx; o.ry = 0; o.rz = rz;
  o.ux = -fy * rz + fz * o.ry;
  o.uy = -fz * rx + fx * rz;
  o.uz = -fx * o.ry + fy * rx;
  return o;
}

/**
 * Screen point → world point on the plane z = planeZ, using exactly the
 * projection `rigViewProj` produces (vertical fov + lens shift). Returns
 * false when the ray runs parallel to the plane or points away from it.
 *
 * Derivation: with proj[9] = 2·shift the shifted NDC y is
 *   ndcY = f·y_v/(−z_v) − 2·shift,
 * so a screen row py corresponds to ndcY₀ = (1 − 2py) + 2·shift and the
 * unshifted view offset is ndcY₀·tan(vfov/2).
 */
function unprojectToPlane(rig, aspect, px, py, planeZ, out) {
  const o = out || {};
  const b = rigBasis(rig, _basis);
  const halfH = Math.tan(lensFovDeg(rig.fov, aspect) * DEG / 2), halfW = halfH * aspect;
  const ndcX = 2 * px - 1;
  const ndcY = (1 - 2 * py) + 2 * (rig.shiftY || 0);
  const ox = ndcX * halfW, oy = ndcY * halfH;
  const dx = b.fx + b.rx * ox + b.ux * oy;
  const dy = b.fy + b.ry * ox + b.uy * oy;
  const dz = b.fz + b.rz * ox + b.uz * oy;
  if (!(Math.abs(dz) > 1e-6)) return false;
  const t = (planeZ - rig.eye.z) / dz;
  if (!(t > 0)) return false;
  o.x = rig.eye.x + dx * t;
  o.y = rig.eye.y + dy * t;
  o.z = rig.eye.z + dz * t;
  o.t = t;
  return true;
}

/* ------------------------------------------------------------------ *
 *  Framing points.
 * ------------------------------------------------------------------ */
const TABLETOP_POINTS = [];
for (const sx of [-1, 1]) for (const sz of [-1, 1])
  TABLETOP_POINTS.push({ x: sx * PH.T_HALF_WID, y: PH.TABLE_Y, z: sz * PH.T_HALF_LEN });

const FRAME_POINTS = [];
for (const sx of [-1, 1]) for (const sz of [-1, 1])
  FRAME_POINTS.push({ x: sx * PH.T_HALF_WID, y: PH.TABLE_Y, z: sz * PH.T_HALF_LEN, w: 1 });
FRAME_POINTS.push({ x: -PH.NET_HALF_WID, y: PH.NET_TOP, z: 0, w: 1 });
FRAME_POINTS.push({ x: PH.NET_HALF_WID, y: PH.NET_TOP, z: 0, w: 1 });
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 0.72, z: 0, w: 1 });            // a loop at the net
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 0.50, z: -PH.T_HALF_LEN - 0.35, w: 1 });
FRAME_POINTS.push({ x: 0, y: PH.TABLE_Y + 0.35, z: PH.T_HALF_LEN + 0.15, w: 1 });

const _fitVpBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() }, _fitS = {};
const _boundsOut = { top: 1, bottom: 0, left: 1, right: 0 };
/** Screen bounds of the playing surface only (no legs, no net). */
function tabletopBounds(vp, out = _boundsOut) {
  out.top = 1; out.bottom = 0; out.left = 1; out.right = 0;
  for (const pt of TABLETOP_POINTS) {
    projectPoint(vp, pt, _fitS);
    if (!_fitS.ok) continue;
    out.top = Math.min(out.top, _fitS.y); out.bottom = Math.max(out.bottom, _fitS.y);
    out.left = Math.min(out.left, _fitS.x); out.right = Math.max(out.right, _fitS.x);
  }
  return out;
}

// Full table silhouette, including the feet: text must not cover its legs.
const TABLE_FRAME_POINTS = [];
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  TABLE_FRAME_POINTS.push({ x: sx * PH.T_HALF_WID, y: PH.TABLE_Y, z: sz * PH.T_HALF_LEN });
  TABLE_FRAME_POINTS.push({ x: sx * (PH.T_HALF_WID - 0.14), y: 0, z: sz * (PH.T_HALF_LEN - 0.22) });
}
for (const sx of [-1, 1]) TABLE_FRAME_POINTS.push({ x: sx * PH.NET_HALF_WID, y: PH.NET_TOP + 0.025, z: 0 });
function tableScreenBounds(vp, out = {}) {
  out.top = 1; out.bottom = 0; out.left = 1; out.right = 0;
  const p = {};
  for (const pt of TABLE_FRAME_POINTS) {
    projectPoint(vp, pt, p);
    if (!p.ok) continue;
    out.top = Math.min(out.top, p.y); out.bottom = Math.max(out.bottom, p.y);
    out.left = Math.min(out.left, p.x); out.right = Math.max(out.right, p.x);
  }
  return out;
}
/* The opponent's CONTACT envelope: where its bat actually meets the ball
 * (OpponentAI plans |z| in 1.0..2.15 and y up to +0.80, and the blade is what
 * has to be readable, not the top of its follow-through). The ball itself is
 * allowed to leave the top of the frame on a lob, exactly as it does on a
 * broadcast camera; what must never happen is a contact the player cannot
 * see coming. */
const OPPONENT_FRAME_POINTS = [];
for (const x of [-1.10, 0, 1.10]) for (const z of [-2.00, -1.00])
  OPPONENT_FRAME_POINTS.push({ x, y: PH.TABLE_Y + 0.50, z });
const CAMERA_HEADROOM = 0.015;
function opponentScreenTop(vp) {
  let top = 1;
  const p = {};
  for (const point of OPPONENT_FRAME_POINTS) {
    projectPoint(vp, point, p);
    if (!p.ok) return -1;
    top = Math.min(top, p.y);
  }
  return top;
}

/* ------------------------------------------------------------------ *
 *  FIT — one solve per (preset, aspect), cached.
 *
 *  The pitch and the vertical field of view come from the preset. The
 *  camera dollies until the playing surface is as wide as the vertical
 *  budget allows, and a LENS SHIFT (not a rotation) drops the near edge
 *  onto `nearY`. The width budget is what keeps the table from crawling up
 *  under the scoreboard on a tall phone, and it is the only thing in the
 *  whole pipeline that looks at the aspect ratio.
 * ------------------------------------------------------------------ */
const _fitCache = new Map();
const _frameBuffer = { vp: M4.create(), proj: M4.create(), view: M4.create() };

function _rigAt(P, aspect, d, fov) {
  const pitch = P.pitch * DEG;
  const look = { x: 0, y: PH.TABLE_Y, z: 0 };
  return { eye: { x: 0, y: look.y + Math.sin(pitch) * d, z: look.z + Math.cos(pitch) * d },
    look, fov, shiftY: 0, mode: P.id, aspect };
}
function _dollyFor(P, aspect, fov, widthFrac) {
  let lo = 1.0, hi = 30;
  for (let i = 0; i < 44; i++) {
    const d = Math.sqrt(lo * hi);
    const b = tabletopBounds(rigViewProj(_rigAt(P, aspect, d, fov), aspect, _frameBuffer));
    if (b.right - b.left > widthFrac) lo = d; else hi = d;
  }
  return Math.sqrt(lo * hi);
}
/** Table height / width in SCREEN fractions — the shape is scale-invariant. */
function _shapeRatio(P, aspect, fov) {
  const b = tabletopBounds(rigViewProj(_rigAt(P, aspect, 4, fov), aspect, _frameBuffer));
  return Math.max(0.05, (b.bottom - b.top) / Math.max(1e-6, b.right - b.left));
}

if (typeof window !== 'undefined') window.CAMERA_TUNING = CAMERA_TUNING;

function _stanceDistance(P) {
  return CAMERA_TUNING.dMin || (PADDLE_STANCE_Z + 1.25) / Math.cos(P.pitch * DEG);
}

const _pullBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() };
/** A pulled-in distance is only good if EVERY framing promise survives it:
 *  the re-grounded top clears the scoreboard, the width keeps glass at the
 *  sides, the opponent's contact envelope stays readable, and the reach box
 *  still covers the table with the ball envelope inside it. */
function _pullFits(P, a, fov, d) {
  const rt = _rigAt(P, a, d, fov);
  const vp0 = rigViewProj(rt, a, _pullBuf);
  const bt = tabletopBounds(vp0);
  rt.shiftY = P.nearY - bt.bottom;
  if (bt.top + rt.shiftY < P.topMin) return false;
  if (bt.right - bt.left > 0.975) return false;
  const vp = rigViewProj(rt, a, _pullBuf);
  /* The authored headroom (0.015) cannot survive a 30 cm dolly — geometry,
   * not slack. The pull is capped just above the readability floor the
   * camera suite already enforces (0.011): contacts stay in frame, the
   * scoreboard still clears them. */
  if (opponentScreenTop(vp) < CAMERA_HEADROOM - 0.003) return false;
  const box = reachFor(rt, a, PADDLE_STANCE_Z);
  if (!(box.xMax > 0.62 && box.yLo < PH.TABLE_Y + 0.10 && box.yHi > PH.TABLE_Y + 0.42)) return false;
  const bx = PH.T_HALF_WID + 0.15;
  for (const sx of [-1, 1]) for (const yy of [PH.TABLE_Y, PH.TABLE_Y + 0.55]) {
    projectPoint(vp, { x: sx * bx, y: yy, z: PADDLE_STANCE_Z }, _fitS);
    if (!_fitS.ok) return false;
    if (_fitS.x < box.sx0 - 0.005 || _fitS.x > box.sx1 + 0.005) return false;
    if (_fitS.y < box.sy0 - 0.005 || _fitS.y > box.sy1 + 0.005) return false;
  }
  /* The exact-map promise sampled where it breaks first: the four corners
   * of the inscribed reach box, where the PLAY_RECT clamps and the physical
   * floor/side clamps bind at the same time. A pull that loses more than
   * ~0.00095 of the screen there is a crop, not a zoom — stop early. */
  for (const cxx of [box.sx0, box.sx1]) for (const cyy of [box.sy0, box.sy1]) {
    const t = paddleTargetFromPointer(cxx, cyy, 0, 1, {}, { rig: rt, aspect: a, z: PADDLE_STANCE_Z });
    projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, _fitS);
    if (!_fitS.ok) return false;
    /* 0.00085, not 0.001: the test samples a 25×25 grid and the cache keys
     * quantise — the guard keeps headroom for both. */
    if (Math.hypot(_fitS.x - cxx, _fitS.y - cyy) > 0.00085) return false;
  }
  return true;
}

function fitPreset(P, aspect) {
  const key = P.id + '|' + Math.round(aspect * 1000) + '|' +
    Math.round(_stanceDistance(P) * 100) + '|' + CAMERA_TUNING.forceD + '|' +
    CAMERA_TUNING.forceFov + '|' + CAMERA_TUNING.lensMax;
  const hit = _fitCache.get(key);
  if (hit) return hit;
  const a = Math.max(0.2, aspect);
  const fov = CAMERA_TUNING.forceFov || lensFovDeg(P.vfov, a);
  const r = _shapeRatio(P, a, fov);
  let widthFrac = clamp((P.nearY - P.topMin) / r, 0.30, 0.94) * (P.scale || 1);
  const dMin = _stanceDistance(P);
  let rig = _rigAt(P, a, _dollyFor(P, a, fov, widthFrac), fov);
  let shift = 0, b = tabletopBounds(rigViewProj(rig, a, _frameBuffer));
  // The shape ratio is measured at one distance; perspective bends it a
  // little. Shrink until the shifted tabletop really fits under the
  // scoreboard. Each pass removes ~6 % of the height and the loop is
  // bounded, so this converges for every aspect that exists.
  for (let pass = 0; pass < 8; pass++) {
    shift = P.nearY - b.bottom;
    const dNow = Math.hypot(rig.eye.y - rig.look.y, rig.eye.z - rig.look.z);
    if (((b.top + shift) >= P.topMin && dNow >= dMin) || widthFrac <= 0.22) break;
    if (dNow >= dMin) widthFrac *= 0.94;
    rig = _rigAt(P, a, CAMERA_TUNING.forceD || _dollyFor(P, a, fov, widthFrac), fov);
    b = tabletopBounds(rigViewProj(rig, a, _frameBuffer));
  }
  /* A camera has to stand somewhere. Without this floor the fit happily
   * solved a 4:3 tablet at 2.2 m from the centre — 40 cm in front of the
   * player's own bat — and the blade was painted a third of the screen
   * tall. The stance is physical: at least 1.25 m behind the bat plane. */
  const dFinal = Math.max(dMin, Math.min(30,
    CAMERA_TUNING.forceD || Math.hypot(rig.eye.y - rig.look.y, rig.eye.z - rig.look.z)));
  if (dFinal > Math.hypot(rig.eye.y - rig.look.y, rig.eye.z - rig.look.z) + 1e-6) {
    rig = _rigAt(P, a, dFinal, fov);
    b = tabletopBounds(rigViewProj(rig, a, _frameBuffer));
  }
  /* The authored view stands ~30 cm nearer than the width fit alone demands.
   * Two honest bounds keep it a fit and not a crop: never closer than
   * 0.95 m behind the bat plane (the 1.25 m stance floor lowered by exactly
   * this pull — the blade reads ~10 % bigger, which is the point), and never
   * so close that the re-grounded tabletop top crawls up under the
   * scoreboard. Benches pinning forceD keep their exact distance. */
  if (!CAMERA_TUNING.forceD) {
    const dNow = Math.hypot(rig.eye.y - rig.look.y, rig.eye.z - rig.look.z);
    const dFloor = (PADDLE_STANCE_Z + 0.95) / Math.cos(P.pitch * DEG);
    const dWant = Math.max(dFloor, dNow - 0.30);
    if (dWant < dNow - 1e-6) {
      let bad = dWant, good = dNow;
      for (let i = 0; i < 9; i++) {          // smallest d keeping EVERY promise
        const mid = (bad + good) / 2;
        if (_pullFits(P, a, fov, mid)) good = mid; else bad = mid;
      }
      if (good < dNow - 1e-4) {
        rig = _rigAt(P, a, good, fov);
        b = tabletopBounds(rigViewProj(rig, a, _frameBuffer));
      }
    }
  }
  rig.shiftY = P.nearY - b.bottom;
  rig.widthFrac = widthFrac;
  rig.aspect = a;
  rig.hfov = horizontalFovDeg(P.vfov, a);
  _fitCache.set(key, rig);
  return rig;
}
/** Drop every cached fit. Benches and tests change the presets/limits at
 *  runtime; the game itself never needs this. */
function resetCameraCache() { _fitCache.clear(); _reachCache.clear(); }

/** Backwards-compatible alias: the fit already carries its own shift. */
function fitRig(P, aspect) {
  return fitPreset(typeof P === 'string' ? (CAMERA_PRESETS[P] || CAMERA_PRESETS.BROADCAST) : P, aspect);
}

/**
 * The camera for this frame: the authored fit (preset × aspect) plus the
 * player's trim (`adjust = { zoom, pitch }`, both optional and sanitised
 * here, so a hostile save can never push the camera out of its band). There
 * is no ball follow. The returned object is reused, so never hold on to it.
 * The pointer map stays the exact inverse of the result because the reach
 * box is derived from this very rig — trim included.
 */
const _adjFitBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() };
function cameraRigFor(mode, ball, aspect, out, adjust) {
  const P = CAMERA_PRESETS[mode] || CAMERA_PRESETS.BROADCAST;
  const base = fitPreset(P, aspect);
  const o = out || _cp;
  o.mode = P.id;
  o.aspect = aspect;
  o.eye.x = base.eye.x; o.eye.y = base.eye.y; o.eye.z = base.eye.z;
  o.look.x = base.look.x; o.look.y = base.look.y; o.look.z = base.look.z;
  o.fov = base.fov;
  o.shiftY = base.shiftY;
  o.widthFrac = base.widthFrac;
  o.pitchDeg = P.pitch;
  const zoom = clamp(adjust && Number.isFinite(adjust.zoom) ? adjust.zoom : 1,
    CAM_ADJUST.zoomMin, CAM_ADJUST.zoomMax);
  const pOff = clamp(adjust && Number.isFinite(adjust.pitch) ? adjust.pitch : 0,
    CAM_ADJUST.pitchMin, CAM_ADJUST.pitchMax);
  o.zoom = zoom; o.pitchOff = pOff;
  if (zoom === 1 && pOff === 0) return o;    // the authored rig: zero extra work
  if (pOff !== 0) {
    /* Rotate the eye around the look point at a constant distance. Every
     * authored rig has its eye on the centre line, but the basis maths is
     * written for a general offset so a future preset is not a trap. */
    const dx = base.eye.x - base.look.x, dy = base.eye.y - base.look.y, dz = base.eye.z - base.look.z;
    const dist = Math.hypot(dx, dy, dz);
    const horiz = Math.hypot(dx, dz) || 1e-9;
    const pitch = clamp(Math.atan2(dy, horiz) + pOff * DEG,
      CAM_ADJUST.pitchAbsMin * DEG, CAM_ADJUST.pitchAbsMax * DEG);
    o.pitchDeg = pitch / DEG;
    o.eye.x = base.look.x + (dx / horiz) * Math.cos(pitch) * dist;
    o.eye.y = base.look.y + Math.sin(pitch) * dist;
    o.eye.z = base.look.z + (dz / horiz) * Math.cos(pitch) * dist;
  }
  if (zoom !== 1) {
    /* Lens zoom, never a dolly: the fitted distance IS the stance floor,
     * and moving the eye would also change how big the blade is drawn. */
    o.fov = clamp(2 * Math.atan(Math.tan(base.fov * DEG / 2) / zoom) / DEG, 12, 84);
  }
  /* Re-ground the composition: after any trim the near edge of the playing
   * surface is put back on nearY with the same lens-shift rule the fit
   * uses, so the player's own half of the screen stays anchored. Four
   * projected points — cheaper than one frame of paddle maths. */
  o.shiftY = 0;
  let vp = rigViewProj(o, aspect, _adjFitBuf);
  let b = tabletopBounds(vp);
  const frame = tableScreenBounds(vp), opp = opponentScreenTop(vp);
  // A stored trim may enlarge the table while cutting off the opponent.
  // Widen only the lens; all screen spans scale together before nearY is grounded.
  const widen = Math.max(1,
    (b.bottom - b.top) / (P.nearY - P.topMin + 1e-4),
    (b.bottom - opp) / (P.nearY - CAMERA_HEADROOM + 0.003),
    (0.5 - frame.left) / 0.48, (frame.right - 0.5) / 0.48);
  if (widen > 1) {
    o.fov = Math.min(84, 2 * Math.atan(Math.tan(o.fov * DEG / 2) * widen) / DEG);
    vp = rigViewProj(o, aspect, _adjFitBuf);
    b = tabletopBounds(vp);
  }
  o.shiftY = P.nearY - b.bottom;
  return o;
}

/** Highest pixel the table itself occupies (0..1, y down). */
function tableTopScreenY(mode, aspect, vpOut) {
  const rig = cameraRigFor(mode, null, aspect);
  const vp = rigViewProj(rig, aspect, vpOut || { vp: M4.create() });
  const a = projectPoint(vp, { x: -PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN }, {});
  const b = projectPoint(vp, { x: PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN }, {});
  const c = projectPoint(vp, { x: 0, y: PH.NET_TOP, z: 0 }, {});
  return Math.max(0.02, Math.min(a.y, b.y, c.y));
}

/* Legacy hooks kept for the benches: the fit is baked into the rig now. */
function tableFrameShift(rig) { return rig && Number.isFinite(rig.shiftY) ? rig.shiftY : 0; }
function fitTablePresentation() { /* deliberately empty — solved at fit time */ }
function tableScreenY(mode, aspect) {
  return tableScreenBounds(rigViewProj(cameraRigFor(mode, null, aspect), aspect)).bottom;
}

/* ------------------------------------------------------------------ *
 *  POINTER → BAT
 *
 *  The blade's centre is the inverse projection of the cursor onto the
 *  stance plane. Inside the reach rectangle that is EXACT: move the cursor
 *  one pixel and the blade moves one pixel. Outside it the cursor is
 *  clamped to the rectangle first, so the blade stops where a human arm
 *  would stop instead of flying off screen.
 * ------------------------------------------------------------------ */
const _reachCache = new Map();
const _reachPoint = { x: 0, y: 0, z: 0 };

/**
 * World box the blade's centre may occupy, plus the screen rectangle that
 * box projects to. Derived from PLAY_RECT and clamped to the absolute
 * limits, so the bat can always cover the table and never leaves the frame.
 */
function reachFor(rig, aspect, planeZ) {
  /* Quantise the depth: the step-in moves the plane continuously, and an
   * unquantised cache key would grow a box per millimetre of travel. 1 cm is
   * two hundred times finer than any parallax the screen can show. */
  const zq = quantizeDepth(planeZ);
  planeZ = zq;
  /* The pitch trim changes the reach at the same fov and shift, so it has
   * to be part of the cache key — a pitched rig must never be handed a box
   * measured for the flat one. */
  const pitchKey = Number.isFinite(rig.pitchDeg) ? rig.pitchDeg
    : (CAMERA_PRESETS[rig.mode] ? CAMERA_PRESETS[rig.mode].pitch : 0);
  /* shiftY at 1/10 mm: coarser rounding used to hand a box measured at one
   * dolly of the pull-in bisection to a neighbour 0.5 mm away — that is the
   * same order of magnitude as the exact-map promise itself. */
  const key = rig.mode + '|' + Math.round(aspect * 1000) + '|' + zq.toFixed(2) +
    '|' + Math.round((rig.shiftY || 0) * 10000) + '|' + Math.round((rig.fov || 0) * 100) +
    '|' + Math.round(pitchKey * 10);
  const hit = _reachCache.get(key);
  if (hit) return hit;
  let xMax = 0, yLo = Infinity, yHi = -Infinity;
  for (const sx of [PLAY_RECT.left, PLAY_RECT.right]) {
    for (const sy of [PLAY_RECT.top, PLAY_RECT.bottom]) {
      if (!unprojectToPlane(rig, aspect, sx, sy, planeZ, _reachPoint)) continue;
      xMax = Math.max(xMax, Math.abs(_reachPoint.x));
      yLo = Math.min(yLo, _reachPoint.y);
      yHi = Math.max(yHi, _reachPoint.y);
    }
  }
  /* Shrink to the paddle limits, never expand: a clamp that pulls the box
   * outward would promise reach the screen does not contain, and the blade
   * would then be painted outside the play rectangle it was measured from. */
  const lim = paddleLimitsFor(planeZ);
  xMax = Math.min(xMax, lim.x);
  yLo = Math.max(yLo, PH.TABLE_Y + lim.yLo);
  yHi = Math.min(yHi, PH.TABLE_Y + lim.yHi);
  /* Every plane the bat can stand on must leave a usable vertical range.
   * Keeping the CENTRE of the visible range and widening it symmetrically is
   * the only expansion that cannot leave the projected quad: it stays on the
   * same screen rows. */
  if (!(yHi - yLo > 0.30)) {
    const mid = (yLo + yHi) / 2;
    yLo = mid - 0.15; yHi = mid + 0.15;
    /* Widening is symmetric, but the table's clearance is not negotiable:
     * without this the knife-edge band at the step-in plane reached 0.13 m
     * BELOW the playing surface and the blade could be drawn through it. */
    yLo = Math.max(yLo, PH.TABLE_Y + lim.yLo);
  }
  /* The screen rectangle must be INSCRIBED in the projected quad, not its
   * bounding box: a box is a superset, and clamping the cursor into it would
   * hand `paddleTargetFromPointer` a point outside the reach — the blade
   * would stop short of the cursor by exactly the corner error (measured
   * 0.06 of the screen at 16:9 before this fix). Because the camera looks
   * straight down −z with no roll, a line of constant y on a z-plane
   * projects to a horizontal line, and the left/right edges project to
   * straight lines that are monotone in y. So the largest inset rectangle
   * is: exact y extents, and the x extents taken at their WORST y. */
  const vp = rigViewProj(rig, aspect, _fitVpBuf);
  const corner = (x, y, out) => {
    _reachPoint.x = x; _reachPoint.y = y; _reachPoint.z = planeZ;
    return projectPoint(vp, _reachPoint, out);
  };
  const bl = corner(-xMax, yLo, {}), br = corner(xMax, yLo, {});
  const tl = corner(-xMax, yHi, {}), tr = corner(xMax, yHi, {});
  const box = { xMax, yLo, yHi, z: planeZ,
    sx0: 0, sx1: 1, sy0: 0, sy1: 1 };
  if (bl.ok && br.ok && tl.ok && tr.ok) {
    box.sy0 = Math.min(tl.y, tr.y);
    box.sy1 = Math.max(bl.y, br.y);
    box.sx0 = Math.max(tl.x, bl.x);
    box.sx1 = Math.min(tr.x, br.x);
    /* Inside the frame and inside the design rectangle. Shrinking a clamp
     * region never breaks the exactness guarantee — it only means the blade
     * stops a pixel earlier — while growing it would. */
    box.sx0 = clamp(Math.max(box.sx0, PLAY_RECT.left), 0, 1);
    box.sx1 = clamp(Math.min(box.sx1, PLAY_RECT.right), 0, 1);
    box.sy0 = clamp(Math.max(box.sy0, PLAY_RECT.top), 0, 1);
    box.sy1 = clamp(Math.min(box.sy1, PLAY_RECT.bottom), 0, 1);
    /* No "widen it back out if it got small" fallback. A leaned-in blade
     * really can occupy only a narrow band, and widening the rectangle would
     * advertise rows the blade cannot reach — the clamp would then stop it
     * short of the cursor. The band's size is the depth search's business;
     * the rectangle's job is to be true. Only ordering is guaranteed here. */
    if (box.sx0 > box.sx1) { const m = (box.sx0 + box.sx1) / 2; box.sx0 = m - 0.01; box.sx1 = m + 0.01; }
    if (box.sy0 > box.sy1) { const m = (box.sy0 + box.sy1) / 2; box.sy0 = m - 0.01; box.sy1 = m + 0.01; }
  }
  if (_reachCache.size > 400) _reachCache.clear();
  _reachCache.set(key, box);
  return box;
}

const _ptOut = { tx: 0, ty: 0, tz: 0 };
const _ptWorld = { x: 0, y: 0, z: 0 };

/**
 * @param px,py  pointer in normalised screen space (0..1, y down)
 * @param opts   { rig, aspect, z } — the camera the frame is drawn with and
 *               the depth plane the bat currently stands on.
 * `stanceY` and `sens` are accepted for source compatibility with the old
 * affine map; the map is the exact inverse now, so neither changes geometry.
 */
function paddleTargetFromPointer(px, py, stanceY, sens, out, opts) {
  const o = out || _ptOut;
  const aspect = opts && Number.isFinite(opts.aspect) ? opts.aspect : 16 / 9;
  const rig = (opts && opts.rig) || cameraRigFor((opts && opts.mode) || 'BROADCAST', null, aspect);
  const z = clamp((opts && Number.isFinite(opts.z)) ? opts.z : PADDLE_STANCE_Z,
    PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
  const box = reachFor(rig, aspect, z);
  let x = Number.isFinite(px) ? clamp(px, 0, 1) : 0.5;
  let y = Number.isFinite(py) ? clamp(py, 0, 1) : 0.62;
  /* The box can be skipped by `depthForPointer` before it ever gets here, so
   * clamping is a last resort for a caller that pins a plane by hand. Order
   * the edges so a degenerate box still yields a finite point. */
  x = clamp(x, Math.min(box.sx0, box.sx1), Math.max(box.sx0, box.sx1));
  y = clamp(y, Math.min(box.sy0, box.sy1), Math.max(box.sy0, box.sy1));
  if (!unprojectToPlane(rig, aspect, x, y, z, _ptWorld)) {
    o.tx = PADDLE_HOME.x; o.ty = PADDLE_HOME.y; o.tz = z; o.zNear = z; return o;
  }
  o.tx = clamp(_ptWorld.x, -box.xMax, box.xMax);
  o.ty = clamp(_ptWorld.y, box.yLo, box.yHi);
  o.tz = z;
  o.zNear = z;
  return o;
}

/**
 * The shallowest depth at which `px,py` can actually be a blade position.
 *
 * Standing at the stance plane the whole play rectangle is reachable, so every
 * pointer has an exact answer there. Leaning in shrinks that rectangle — the
 * blade may not sink through the table — and a pointer that asks for a row the
 * leaned-in blade cannot occupy would otherwise be clamped and the blade would
 * park somewhere the cursor is not. The assist therefore yields to the pointer:
 * the shallower the blade stands, the higher up the screen you have to aim.
 *
 * Coverage grows monotonically with depth (measured across all presets and
 * aspects), so a bisection over 6 steps is enough and the result is cached per
 * quantised pointer cell by `reachFor` itself.
 */
function depthForPointer(rig, aspect, px, py, zShallow) {
  const zDeep = PADDLE_STANCE_Z;
  const z0 = clamp(Number.isFinite(zShallow) ? zShallow : zDeep, PADDLE_LIMITS.zStepIn, zDeep);
  if (z0 >= zDeep) return zDeep;
  const inside = (z) => {
    const b = reachFor(rig, aspect, z);
    return px >= b.sx0 && px <= b.sx1 && py >= b.sy0 && py <= b.sy1;
  };
  if (inside(z0)) return z0;
  if (!inside(zDeep)) return zDeep;      // nothing is better than the stance
  let lo = z0, hi = zDeep;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) hi = mid; else lo = mid;
  }
  /* Land on a whole centimetre, and only on one that really covers the
   * cursor: the box is quantised, so the bisection's answer can sit a hair
   * inside the boundary and then round onto the wrong side of it. */
  let z = quantizeDepth(hi);
  for (let i = 0; i < 40 && !inside(z) && z < zDeep; i++) z = quantizeDepth(z + 0.01);
  return z;
}

/** Screen position of the bat's home pose — the pointer's resting point. */
function homeScreenPoint(rig, aspect) {
  const vp = rigViewProj(rig, aspect, _fitVpBuf);
  const s = projectPoint(vp, PADDLE_HOME, _fitS);
  return s.ok ? { x: s.x, y: s.y } : { x: 0.5, y: 0.62 };
}

const RECENTER_S = 0.30;

function insideFrame(s, m) {
  return s.ok && s.x > m && s.x < 1 - m && s.y > m && s.y < 1 - m;
}
const _clampS = {}, _clampA = {}, _clampP = { x: 0, y: 0, z: 0 };

/** Largest k in [0,1] with lerp(a,b,k) still inside the frame, given that a
 *  is inside and b is not. The visible part of a perspective frustum is a
 *  convex set, so bisection converges monotonically. */
function bisectIntoFrame(vp, m, ax, ay, az, bx, by, bz) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) {
    const k = 0.5 * (lo + hi);
    _clampP.x = ax + (bx - ax) * k; _clampP.y = ay + (by - ay) * k; _clampP.z = az + (bz - az) * k;
    if (insideFrame(projectPoint(vp, _clampP, _clampS), m)) lo = k; else hi = k;
  }
  return lo;
}

/**
 * Last-resort guard for the replay camera and for a preset change while the
 * bat is in flight: pull it back inside the frame if the projection on
 * screen no longer contains it. With the exact map this is a no-op during
 * normal play — it exists so a cinematic camera can never strand the blade.
 */
function clampPaddleToFrustum(vp, t, margin) {
  const m = margin === undefined ? 0.02 : margin;
  const s = projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, _clampS);
  if (!s.ok) { t.tx = PADDLE_HOME.x; t.ty = PADDLE_HOME.y; t.tz = PADDLE_HOME.z; return t; }
  const outX = s.x < m || s.x > 1 - m;
  const outY = s.y < m || s.y > 1 - m;
  if (!outX && !outY) return t;
  const tries = outX !== outY
    ? [[outX ? PADDLE_HOME.x : t.tx, outX ? t.ty : PADDLE_HOME.y, t.tz]]
    : [[PADDLE_HOME.x, PADDLE_HOME.y, t.tz]];
  for (const [ax, ay, az] of tries) {
    if (!insideFrame(projectPoint(vp, { x: ax, y: ay, z: az }, _clampA), m)) continue;
    const k = bisectIntoFrame(vp, m, ax, ay, az, t.tx, t.ty, t.tz);
    t.tx = ax + (t.tx - ax) * k;
    t.ty = ay + (t.ty - ay) * k;
    return t;
  }
  if (!insideFrame(projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, _clampA), m)) {
    t.tx = PADDLE_HOME.x; t.ty = PADDLE_HOME.y; t.tz = PADDLE_HOME.z;
  }
  return t;
}

function paddleVisibleOk(vp, t, margin) {
  projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, _clampS);
  if (!_clampS.ok) return false;
  const m = margin === undefined ? 0.0 : margin;
  return _clampS.x > m && _clampS.x < 1 - m && _clampS.y > m && _clampS.y < 1 - m;
}

/* ------------------------------------------------------------------ *
 *  Diagnostics for the analysis benches.
 * ------------------------------------------------------------------ */
const PADDLE_POINTS = [];
for (const sx of [-1, 1]) {
  for (const sz of [PADDLE_LIMITS.zStepIn, PADDLE_STANCE_Z, PADDLE_LIMITS.zFar]) {
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + PADDLE_LIMITS.yLo, z: sz });
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + 0.55, z: sz });
    PADDLE_POINTS.push({ x: sx * PADDLE_LIMITS.x, y: PH.TABLE_Y + PADDLE_LIMITS.yHi, z: sz });
  }
}
function paddleVolumeVisible(rig, aspect) {
  const vp = rigViewProj(rig, aspect, _fitVpBuf);
  let ok = 0;
  for (const p of PADDLE_POINTS) {
    projectPoint(vp, p, _fitS);
    if (_fitS.ok && _fitS.x > 0.02 && _fitS.x < 0.98 && _fitS.y > 0.02 && _fitS.y < 0.98) ok++;
  }
  return ok / PADDLE_POINTS.length;
}
const REACH_POINTS = [];
for (const sx of [-1, 1]) for (const [x, y, z] of [[0.85, 0.10, 0.80], [0.85, 0.25, 1.30], [0.85, 0.28, 1.45], [0.85, 0.15, 1.78]])
  REACH_POINTS.push({ x: sx * x, y: PH.TABLE_Y + y, z, w: 1 });
function _marginOver(vp, pts, weighted) {
  let worst = 1e9;
  for (const p of pts) {
    projectPoint(vp, p, _fitS);
    let m = Math.min(_fitS.x, 1 - _fitS.x, _fitS.y, 1 - _fitS.y);
    if (!_fitS.ok) m = -1;
    if (weighted && p.w) m /= p.w;
    if (m < worst) worst = m;
  }
  return worst;
}
function rigMargin(rig, aspect) {
  const vp = rigViewProj(rig, aspect, _fitVpBuf);
  return Math.min(_marginOver(vp, FRAME_POINTS, true), _marginOver(vp, REACH_POINTS, false));
}
