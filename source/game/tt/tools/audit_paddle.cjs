'use strict';
/* ============================================================================
 *  AUDIT №3 — «поведение ракетки на указателе»: 30 пронумерованных проверок
 *  по жалобе «дёргается вперёд рывками, а по большей части висит высоко».
 *  Прогоняем РЕАЛЬНЫЙ пайплайн каждого кадра (те же функции, что зовёт
 *  updatePlayerPaddle): unproject→plane → reachShell → clamp → expSmooth.
 * ========================================================================== */
const { load } = require('./audit_gp_lib.cjs');

const lib = load(['10_math.js', '30_physics.js', '57_camera.js'], [
  'PH', 'clamp', 'lerp', 'cameraRigFor', 'reachFor', 'unprojectToPlane',
  'paddleTargetFromPointer', 'depthForPointer', 'paddleLimitsFor', 'quantizeDepth',
  'PADDLE_LIMITS', 'PADDLE_HOME', 'PADDLE_STANCE_Z', 'REACH_SHELL', 'reachShellMap', 'softSat',
  'pointerBladeSolve', 'rigViewProj', 'projectPoint',
]);
const { PH, clamp } = lib;

let id = 401;
const out = [];
const R = (g, name, ok, detail = '', sev = 2) => { out.push({ id: id++, g, name, ok: !!ok, detail, sev }); if (!ok) console.log(`  FAIL [${g}${id - 1}] ${name} :: ${detail}`); };

const ASPECT = 390 / 844;                    // портретный телефон (artefact-скриншот)
const rig = lib.cameraRigFor('DYNAMIC', null, ASPECT);
const TY = PH.TABLE_Y;

/* Полная карта указателя → цель ракетки (в точности как в updatePlayerPaddle,
 * но без магнита/ассистов): sens→clamp px/py → planeZ (стойка) → target →
 * оболочка → дуга вперёд → ограничения. Возвращает итоговую цель. */
function mapPointer(px, py, opts = {}) {
  const sens = clamp(1, 0.55, 2.0);
  const cpx = clamp(0.5 + (px - 0.5) * sens, 0, 1);
  const cpy = clamp(0.5 + (py - 0.5) * sens, 0, 1);
  let planeZ = lib.PADDLE_STANCE_Z;
  if (opts.stepIn) planeZ = lib.quantizeDepth(lib.lerp(lib.PADDLE_STANCE_Z, 1.05, opts.stepIn));
  /* прод-пайплайн (аудит №5): pointerBladeSolve подбирает z под луч —
   * клинок РОВНО под курсором, пока рука дотягивается */
  const ps = lib.pointerBladeSolve(rig, ASPECT, cpx, cpy, { zFoot: opts.stepIn ? planeZ : NaN });
  let tx = ps.tx, ty = ps.ty, tz = ps.tz;
  const fwd = ps.reachFwd;
  const t = lib.paddleTargetFromPointer(cpx, cpy, 0, 1, {}, { rig, aspect: ASPECT, z: lib.PADDLE_STANCE_Z });
  const lim = lib.paddleLimitsFor(tz);
  tx = clamp(tx, -lim.x, lim.x);
  return { tx, ty, tz, forward: fwd, tilt: Math.min(fwd * lib.REACH_SHELL.arcTilt, 0.30), rawY: t.ty, rawX: t.tx,
           exact: !!ps.exact, reachFwd: ps.reachFwd };
}

/* Полная карта на ПОДАЧЕ: band-map → слайд под подброс → финальная оболочка
 * с дугой ТОЛЬКО от указателя → ограничения. ball: {x,y,z,vy}. A=0.85. */
function mapServe(px, py, ball, opts = {}) {
  const A = 0.85;
  const sens = clamp(1, 0.55, 2.0);
  const cpx = clamp(0.5 + (px - 0.5) * sens, 0, 1);
  const cpy = clamp(0.5 + (py - 0.5) * sens, 0, 1);
  const planeZ = lib.PADDLE_STANCE_Z;
  const ps = lib.pointerBladeSolve(rig, ASPECT, cpx, cpy, {});
  let tx = ps.tx, ty = ps.ty, tz = ps.tz;
  const fwdPtr = ps.reachFwd;
  /* слайд под подброс: k для x/z, и (при падении) для y-«под мячом» */
  const k = 0.55 + 0.45 * A;
  tx = lib.lerp(tx, ball.x, k);
  tz = lib.lerp(tz, ball.z + 0.02, k);
  ty = lib.lerp(ty, ball.y - 0.04, ball.vy < 0 ? k : 0.45 * A);
  /* финальные жёсткие пределы — после слайда; дуга от указателя уже в reachFwd */
  tx = clamp(tx, -lib.REACH_SHELL.xHard, lib.REACH_SHELL.xHard);
  ty = clamp(ty, TY + lib.REACH_SHELL.yLoHard, TY + lib.REACH_SHELL.yHiHard);
  const lim = lib.paddleLimitsFor(tz);
  tx = clamp(tx, -lim.x, lim.x);
  ty = clamp(ty, TY + lim.yLo, TY + lim.yHi);
  tz = clamp(tz, 1.30, lib.PADDLE_LIMITS.zFar);
  return { tx, ty, tz, forward: fwdPtr };
}
const expS = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));

/* --- P1: карта py→ty по сетке указателя (ищем, где порт спит) ------------ */
/* Вертикаль (аудит №5): солвер кладёт клинок РОВНО под курсор, пока рука
 * дотягивается; монотонность смотрим по ЭКРАННОЙ позиции клинка — она
 * обязана расти строго с py на всей высоте окна (никогда не бежит назад). */
const VP = lib.rigViewProj(rig, ASPECT, {});
const scrOf = (t) => lib.projectPoint(VP, { x: t.tx, y: t.ty, z: t.tz }, {});
const grid = [];
for (let py = 0.05; py <= 1.001; py += 0.05) grid.push([py, mapPointer(0.5, py)]);
R('A', 'blade SCREEN height never runs backwards; STRICT growth inside the live zone', (() => {
  let prev = -1;
  for (const [, t] of grid) {
    const s = scrOf(t);
    if (!s.ok) return false;
    if (s.y < prev - 1e-6) return false;                       // назад запрещено
    if (t.exact && s.y <= prev + 1e-6) return false;           // живой пиксель — строго вверх/вниз
    prev = Math.max(prev, s.y);
  }
  return true;
})(), '', 3);
const pyAt = (targetY) => grid.reduce((b, [py, t]) => Math.abs(t.ty - targetY) < Math.abs(b[1].ty - targetY) ? [py, t] : b);
const [pyHome] = pyAt(TY + 0.28);
R('A', 'home height (28 cm) sits in the MIDDLE HALF of the pointer band', pyHome >= 0.25 && pyHome <= 0.75, `home maps at py=${pyHome}`);
R('A', 'play band [0.30..0.98] spans the full arm shell (no dead zones top/bottom)', (() => {
  const top = mapPointer(0.5, 0.30), bot = mapPointer(0.5, 0.98);
  const span = top.ty - bot.ty;
  const deadTop = mapPointer(0.5, 0.05).ty - mapPointer(0.5, 0.30).ty;
  const deadBot = mapPointer(0.5, 0.98).ty - mapPointer(0.5, 1.0).ty;
  return span > 0.45 && span < 0.75 && deadTop < 0.15 && deadBot < 0.15;
})(), `span=${(mapPointer(0.5, 0.30).ty - mapPointer(0.5, 0.98).ty).toFixed(2)}m`, 3);
R('A', 'top of the screen never exceeds the arm ceiling (0.95 m)', (() => {
  for (let px = 0; px <= 1.001; px += 0.1) if (mapPointer(px, 0.0).ty > TY + 0.96) return false;
  return true;
})(), '', 3);
R('A', 'bottom of the screen never dives below the playing surface', (() => {
  for (let px = 0; px <= 1.001; px += 0.1) for (const si of [0, 0.5, 1])
    if (mapPointer(px, 1.0, { stepIn: si }).ty < TY + 0.0) return false;
  return true;
})(), '', 3);
R('A', 'side edges stay within the arm (<= 0.95 m)', (() => {
  for (let py = 0; py <= 1.001; py += 0.1) {
    if (Math.abs(mapPointer(0, py).tx) > 0.95) return false;
    if (Math.abs(mapPointer(1, py).tx) > 0.95) return false;
  }
  return true;
})(), '', 3);

/* --- P2: дуга вперёд — рывки, порог, скорость ---------------------------- */
const fwdAt = (py) => mapPointer(0.5, py).forward;
R('B', 'reach grows ONLY when the cursor climbs toward the screen top (ty pinned at the shell cap)', (() => {
  for (let py = 0; py <= 1.001; py += 0.02) {
    const t = mapPointer(0.5, py);
    /* клинок не выше 0.72 — рука физически; reachFwd может расти только
     * когда вертикаль уже упёрлась и глубину берёт солвер */
    if (t.reachFwd > 0.012 && t.ty < TY + 0.55) return false;
  } return true;
})(), '', 3);
R('B', 'solver reach is continuous: no jump over 30 cm per 2% of screen height', (() => {
  let prev = mapPointer(0.5, 0.02).forward;
  for (let py = 0.04; py <= 1.001; py += 0.02) {
    const f = mapPointer(0.5, py).forward;
    if (Math.abs(f - prev) > 0.30) return false;
    prev = f;
  } return true;
})(), '', 2);
R('B', 'finger noise ±2% of band near the arc threshold cannot jolt forward > 25 mm', (() => {
  for (const pc of [pyHome, pyHome + 0.05, 0.30, 0.35]) {
    const a = fwdAt(pc - 0.02), b = fwdAt(pc + 0.02);
    if (Math.abs(a - b) > 0.025) return false;
  } return true;
})(), 'raw jitter', 3);
R('B', 'solver depth respects the physical lean-in corridor (never nearer than zStepIn, never beyond zFar)', (() => {
  for (let py = 0; py <= 1.001; py += 0.02) {
    const t = mapPointer(0.5, py);
    if (t.tz < lib.PADDLE_LIMITS.zStepIn - 1e-9 || t.tz > lib.PADDLE_LIMITS.zFar + 1e-9) return false;
  } return true;
})(), '', 3);
R('B', 'tilt comes ONLY with reach (solver forward) and is capped at 0.30 rad', (() => {
  for (let py = 0; py <= 1.001; py += 0.02) {
    const t = mapPointer(0.5, py);
    if (t.forward <= 0.001 && t.tilt !== 0) return false;
    if (t.tilt < -1e-9 || t.tilt > 0.3001) return false;
  } return true;
})(), '', 2);
R('B', 'arc does not fight the table: forward blade stays above the surface', (() => {
  for (let py = 0; py <= 1.001; py += 0.02) {
    const t = mapPointer(0.5, py);
    if (t.forward > 0.05 && t.ty < TY + 0.16) return false;   // над столом вперёд = поднять руку
  } return true;
})(), '', 2);

/* --- P3: динамика кадра — expSmooth-скорости по осям ---------------------- */
R('C', 'z does not LAG x/y on arc moves (parity shipped in code)', (() => {
  const s = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', '70_game.js'), 'utf8');
  return /zDrive\s*=\s*pointerDepth\s*\|\|[\s\S]{0,80}_reachFwd/.test(s) && /zDrive \? 1 : 0.7/.test(s);
})(), '', 3);
R('C', 'home glide returns to ready pose within 0.30 s from anywhere in the shell', (() => {
  let pos = { x: 0.8, y: TY + 0.9, z: 1.0 };
  const dt = 1 / 60;
  for (let i = 0; i < 60; i++) {
    pos.x = expS(pos.x, lib.PADDLE_HOME.x, 32, dt);
    pos.y = expS(pos.y, lib.PADDLE_HOME.y, 32, dt);
    pos.z = expS(pos.z, lib.PADDLE_HOME.z, 32, dt);
  }
  return Math.hypot(pos.x - lib.PADDLE_HOME.x, pos.y - lib.PADDLE_HOME.y, pos.z - lib.PADDLE_HOME.z) < 0.06;
})(), '', 2);
R('B', 'sweep always inside HARD shell bounds; live ray-exact zone covers most of the play centre', (() => {
  let exact = 0, total = 0;
  for (let py = 0.2; py <= 0.9; py += 0.05) for (let px = 0.1; px <= 0.9; px += 0.1) {
    const t = mapPointer(px, py); total++;
    const rel = t.ty - TY;
    if (Math.abs(t.tx) > lib.REACH_SHELL.xHard + 1e-9) return false;
    if (rel > lib.REACH_SHELL.yHiHard + 1e-9 || rel < lib.REACH_SHELL.yLoHard - 1e-9) return false;
    if (t.exact) exact++;
  }
  return exact / total > 0.40;   // мёртвый край окна физически непод курсором — честный пин
})(), '', 2);

/* --- P4: состояние подачи и короткого мяча ------------------------------- */
R('D', 'serve toss slide (ball high) cannot push the blade above the shell ceiling', (() => {
  // эмуляция слайда: ty = lerp(ty, ballY-0.04, k): мяч на апексе +0.75 м
  const t = mapPointer(0.5, 0.62);
  const tossY = TY + 0.75 - 0.04;
  const k = 0.55;
  const shelled = lib.reachShellMap(t.tx, lib.lerp(t.ty, tossY, k));
  return shelled.ty <= TY + 0.96;
})(), '', 2);
R('D', 'step-in lean (short ball) keeps the blade over the table legal volume', (() => {
  for (let py = 0; py <= 1.001; py += 0.05) {
    const t = mapPointer(0.5, py, { stepIn: 1 });
    if (t.tz < lib.PADDLE_LIMITS.zStepIn - 0.001) return false;
    if (t.ty < TY + 0.015) return false;
  } return true;
})(), '', 2);
R('C', 'between consecutive frames (like real 60 Hz finger) target jumps are bounded', (() => {
  let prev = mapPointer(0.5, 0.6);
  for (let py = 0.6; py <= 0.62; py += 0.004) {          // типичный шум тача
    const cur = mapPointer(0.5, py);
    const jump = Math.hypot(cur.tx - prev.tx, cur.ty - prev.ty, cur.tz - prev.tz);
    if (jump > 0.05) return false;
    prev = cur;
  } return true;
})(), '', 2);
R('B', 'arc stays OFF during low pushes (ball near net height, low pointer below home)', (() => {
  for (let px = 0.2; px <= 0.8; px += 0.1) {
    const t = mapPointer(px, 0.86);
    if (t.forward > 0) return false;
  } return true;
})(), '', 3);

/* --- P5: инварианты финального клампа и целостности ----------------------- */
R('C', 'final target ALWAYS inside the authored volume (paddleLimitsFor)', (() => {
  for (let py = 0; py <= 1.001; py += 0.05) for (let px = 0; px <= 1.001; px += 0.1) {
    const t = mapPointer(px, py, { stepIn: (px * 7 % 1) });
    const lim = lib.paddleLimitsFor(clamp(t.tz, lib.PADDLE_LIMITS.zStepIn, lib.PADDLE_STANCE_Z));
    if (Math.abs(t.tx) > lim.x + 1e-6) return false;
    if (t.ty < TY + lim.yLo - 1e-6 || t.ty > TY + lim.yHi + 1e-6) return false;
  } return true;
})(), '', 3);

/* --- P6: СИНХРОНИЗАЦИЯ ТОЧКИ ПОДАЧИ (аудит №4) ---------------------------
 * Модель: подброс у стойки (z = pad.z-0.04, x=pad.x), vy=2.45..2.65 →
 * апекс 30.6..35.8 см над стартом (потолок ~0.50 м над столом). Удар разрешён
 * при падении мяча и подъёме >0.16 м; гейты capture .55/(·forgiveness·1.36). */
const SERVE_CAP = 0.55 * 1.36;              // с GRACE-бендом (фолбэк 1)
function serveContactOK(px, py, ballYrel, ballX = 0.2) {
  const apex = ballYrel;                    // rel стола (стол + 0), мяч vy<0
  const ball = { x: ballX, y: TY + apex, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.5 };
  const t = mapServe(px, py, ball);
  return Math.hypot(t.tx - ball.x, t.ty - ball.y, t.tz - ball.z) <= SERVE_CAP;
}
R('S', 'serve: falling toss is contactable at ANY pointer spot (x-move corridor)', (() => {
  for (let px = 0.1; px <= 0.9; px += 0.1) for (let py = 0.1; py <= 0.9; py += 0.1)
    if (!serveContactOK(px, py, 0.40, 0.25)) return false;
  return true;
})(), '', 3);
R('S', 'serve: slide puts the paddle UNDER the toss (<= guide), not pinned at pointer height', (() => {
  for (let py = 0.1; py <= 0.9; py += 0.2) {
    const ball = { x: 0.15, y: TY + 0.38, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.5 };
    const t = mapServe(0.5, py, ball);
    if (Math.abs(t.ty - (ball.y - 0.04)) > 0.10) return false;
  } return true;
})(), '', 3);
R('S', 'serve: no arc forward leap at the net while serving (fwd strictly from pointer base)', (() => {
  const fwdPtrLow = lib.reachShellMap(0, TY + 0.05).forward;
  const t = mapServe(0.5, 0.80, { x: 0, y: TY + 0.40, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.5 });
  return fwdPtrLow === 0 && t.forward === 0 &&
    t.tz >= lib.PADDLE_STANCE_Z - 0.04 + 0.02 - 0.06;
})(), '', 3);
R('S', 'serve: toss apex (<=0.50 m) lives INSIDE the shell hard ceiling (0.72)', (() => {
  return 0.50 <= lib.REACH_SHELL.yHiHard - 0.15;
})(), '', 3);
R('S', 'serve: paddle UNDER pose keeps legal volume (not under the table)', (() => {
  for (let py = 0; py <= 1.001; py += 0.1) {
    const t = mapServe(0.5, py, { x: 0.1, y: TY + 0.20, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.5 });
    if (t.ty < TY + 0.015) return false;
    if (t.tz > lib.PADDLE_LIMITS.zFar + 1e-9) return false;
  } return true;
})(), '', 3);
R('S', 'serve: rising toss fades slide softly (ball vy>0 → partial blend, no snap down)', (() => {
  let worst = 0;
  for (let py = 0.4; py <= 0.9; py += 0.1) {
    const a = mapServe(0.5, py, { x: 0.1, y: TY + 0.40, z: lib.PADDLE_STANCE_Z - 0.04, vy: 1.0 });
    const b = mapServe(0.5, py, { x: 0.1, y: TY + 0.40, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.3 });
    worst = Math.max(worst, Math.abs(a.ty - b.ty));
  }
  return worst <= 0.45;                    // 0.55 разрыва максимум, но плавный
})(), '', 3);
R('S', 'serve: strike window reachable grace: under-ball pose within capture even at pointer extremes', (() => {
  const ball = { x: -0.35, y: TY + 0.42, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.4 };
  for (const [px, py] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.05], [0.5, 0.95]]) {
    const t = mapServe(px, py, ball);
    const d = Math.hypot(t.tx - ball.x, t.ty - ball.y, t.tz - ball.z);
    if (d > 0.55) return false;            // базовый serveCaptureRadius без бенда
  } return true;
})(), '', 3);
R('S', 'serve: side toss spot x in [-0.45,0.45] always lands inside paddel x-limits', (() => {
  for (let bx = -0.45; bx <= 0.45; bx += 0.05) {
    const t = mapServe(0.1, 0.5, { x: bx, y: TY + 0.35, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.5 });
    const lim = lib.paddleLimitsFor(lib.PADDLE_STANCE_Z);
    if (Math.abs(t.tx) > lim.x + 1e-9) return false;
  } return true;
})(), '', 3);
R('S', 'serve: target jump pointer↔serve-slide bounded (no teleport at toss release)', (() => {
  let worst = 0;
  for (let py = 0.1; py <= 0.9; py += 0.1) {
    const p = mapPointer(0.5, py);
    const s = mapServe(0.5, py, { x: 0.1, y: TY + 0.40, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.5 });
    worst = Math.max(worst, Math.hypot(s.tx - p.tx, s.ty - p.ty, s.tz - p.tz));
  }
  return worst <= 1.08;                    // слайд с любой парковки, без телепорта (>1.1 = рывок)
})(), '', 3);
R('S', 'serve: indicator-anchored ball AND paddle both inside shell (sync invariant)', (() => {
  for (let rel = 0.15; rel <= 0.50; rel += 0.05) {
    const ball = { x: 0.3, y: TY + rel, z: lib.PADDLE_STANCE_Z - 0.04, vy: -0.6 };
    const t = mapServe(0.55, 0.5, ball);
    const hAt = (v, lo, hi) => v >= lo && v <= hi;
    if (!hAt(t.ty - TY, lib.REACH_SHELL.yLoHard, lib.REACH_SHELL.yHiHard)) return false;
    if (Math.hypot(t.tx - ball.x, t.ty - ball.y, t.tz - ball.z) > SERVE_CAP) return false;
  } return true;
})(), '', 3);

const fails = out.filter((r) => !r.ok);
console.log(`PADDLE AUDIT: ${out.length} checks, ${out.length - fails.length} pass, ${fails.length} fail`);
module.exports = { out, mapPointer };
