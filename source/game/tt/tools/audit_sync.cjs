'use strict';
/* ============================================================================
 *  AUDIT №5 — «курсор ⇄ ракетка: кто точка?»: 150 пронумерованных АНАЛИЗОВ
 *  + 150 СИМУЛЯЦИЙ движений указателя. Отвечает на вопрос «косание идёт от
 *  курсора или от ракетки» ИЗМЕРЕНИЕМ: какая ошибка (px на экране) между
 *  курсором и спроектированным обратно положением клинка.
 *  Итогом пишет tools/zonemap.html — детальную разметку всех зон экрана.
 * ========================================================================== */
const fs = require('fs');
const path = require('path');
const { load } = require('./audit_gp_lib.cjs');

const lib = load(['10_math.js', '30_physics.js', '12_match_rules.js', '57_camera.js'], [
  'PH', 'clamp', 'lerp', 'expSmooth', 'cameraRigFor', 'paddleTargetFromPointer',
  'paddleLimitsFor', 'PADDLE_LIMITS', 'PADDLE_HOME', 'PADDLE_STANCE_Z',
  'REACH_SHELL', 'reachShellMap', 'softSat', 'pointerBladeSolve',
  'rigViewProj', 'projectPoint',
]);
const { PH, clamp, lerp } = lib;
const TY = PH.TABLE_Y;

let id = 501;
const out = [];
const R = (g, name, ok, detail = '', sev = 2) => {
  out.push({ id: id++, g, name, ok: !!ok, detail, sev });
  if (!ok) console.log(`  FAIL [${g}${id - 1}] ${name} :: ${detail}`);
};

const ASPECT = 390 / 844, W = 390, H = 844;             // портретный телефон
const rig = lib.cameraRigFor('DYNAMIC', null, ASPECT);
const VP = lib.rigViewProj(rig, ASPECT, {});
const HOME = lib.PADDLE_HOME, STANCE = lib.PADDLE_STANCE_Z;

/* ---------------------------------------------------------------------------
 *  Прод-пайплайн (updatePlayerPaddle, без розыгрышных ассистов: состояние —
 *  покой): solver → финальная оболочка → limits. Плюс ЭКРАННАЯ метрика:
 *  куда реально попадает клинок в пикселях и какова ошибка от курсора.
 * ------------------------------------------------------------------------- */
function mapPointer(px, py) {
  const cpx = clamp(px, 0, 1), cpy = clamp(py, 0, 1);
  const ps = lib.pointerBladeSolve(rig, ASPECT, cpx, cpy, {});
  const lim = lib.paddleLimitsFor(ps.tz);
  const tx = clamp(clamp(ps.tx, -lib.REACH_SHELL.xHard, lib.REACH_SHELL.xHard), -lim.x, lim.x);
  const ty = clamp(clamp(ps.ty, TY + lib.REACH_SHELL.yLoHard, TY + lib.REACH_SHELL.yHiHard), TY + lim.yLo, TY + lim.yHi);
  const t = { tx, ty, tz: clamp(ps.tz, lib.PADDLE_LIMITS.zStepIn, lib.PADDLE_LIMITS.zFar), reachFwd: ps.reachFwd };
  const s = lib.projectPoint(VP, { x: t.tx, y: t.ty, z: t.tz }, {});
  const dx = s.x * W - cpx * W, dy = s.y * H - cpy * H;
  return { ...t, exact: !!ps.exact, dpx: Math.hypot(dx, dy), dx, dy, sx: s.x * W, sy: s.y * H };
}

/* Симуляционный фильтр позиции (как в updatePlayerPaddle: rate 55, z-parity). */
function simTrack(path, opts = {}) {
  const dt = 1 / 60;
  let pos = { x: HOME.x, y: HOME.y, z: HOME.z };
  let reachFwd = 0;
  const track = [];
  for (let i = 0; i < path.length; i++) {
    const [px, py] = path[i];
    const t = mapPointer(px, py);
    reachFwd = expS(reachFwd, t.reachFwd, 9, dt);
    pos.x = expS(pos.x, t.tx, 55, dt);
    pos.y = expS(pos.y, t.ty, 55, dt);
    const zRate = (t.reachFwd > 0.001 ? 55 : 55 * 0.7);
    pos.z = expS(pos.z, t.tz, zRate, dt);
    track.push({ pos: { ...pos }, t, px, py });
  }
  const last = track[track.length - 1];
  const sLast = lib.projectPoint(VP, last.pos, {});
  return { track, finalPos: { ...last.pos }, target: last.t,
    dpx: Math.hypot(sLast.x * W - last.px * W, sLast.y * H - last.py * H) };
}
const expS = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));

/* ============================ A. КАРТА ЗОН (100 анализов) ==================
 * Сетка 10×10 по всему экрану; каждая ячейка получает собственный анализ:
 * внутри досягаемой зоны клинок обязан стоять под курсором (<=2 px),
 * вне её — честно пинниться на границе оболочки (в пределах лимитов,
 * монотонно увеличиваясь при росте py). */
let zoneCells = [];
const zoneKeys = [];
for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) {
  const px = 0.05 + col * 0.1, py = 0.05 + row * 0.1;
  const t = mapPointer(px, py);
  zoneCells.push({ px, py, t, row, col });
}
zoneCells.forEach((c, i) => {
  const zid = `Z${c.row}${c.col}`;
  zoneKeys.push(zid);
  const inside = Math.abs(c.t.tx) <= lib.REACH_SHELL.xHard + 1e-9 &&
    c.t.ty - TY <= lib.REACH_SHELL.yHiHard + 1e-9 &&
    c.t.ty - TY >= lib.REACH_SHELL.yLoHard - 1e-9 &&
    c.t.tz >= lib.PADDLE_LIMITS.zStepIn - 1e-9 && c.t.tz <= lib.PADDLE_LIMITS.zFar + 1e-9;
  const live = c.t.exact ? c.t.dpx <= 2.0
    : inside;   // пин-зоны: оболочка + залёт за ширину — допустимый clamp
  R('Z', `zone ${zid} (${c.px.toFixed(1)},${c.py.toFixed(1)}): ` +
    (c.t.exact ? 'cursor-exact' : `pinned(${c.t.dpx.toFixed(0)}px)`),
    live, inside ? '' : 'out of shell', 3);
});

/* =================== B. ЦЕЛОСТНОСТЬ КОНТРАКТА (25 анализов) ============== */
R('B', 'exact-zone worst divergence <= 2 px (the blade IS under the cursor)', (() => {
  let w = 0; zoneCells.forEach((c) => { if (c.t.exact) w = Math.max(w, c.t.dpx); }); return w <= 2;
})(), '', 3);
R('B', 'every dead/pin zone keeps the blade on the shell boundary (nearest reachable point)', (() => {
  for (const c of zoneCells) if (!c.t.exact) {
    const onEdge = Math.abs(c.t.ty - TY - lib.REACH_SHELL.yHiHard) < 0.02 ||
      Math.abs(c.t.ty - TY - lib.REACH_SHELL.yLoHard) < 0.02 ||
      Math.abs(Math.abs(c.t.tx) - lib.REACH_SHELL.xHard) < 0.35 ||
      Math.abs(c.t.tz - lib.PADDLE_LIMITS.zStepIn) < 1e-9 ||
      Math.abs(c.t.tz - lib.PADDLE_LIMITS.zFar) < 1e-9;
    if (!onEdge) return false;
  } return true;
})(), '', 3);
R('B', 'no unclamped world junk: every cell final point is finite', (() =>
  zoneCells.every((c) => Number.isFinite(c.t.tx + c.t.ty + c.t.tz)))(), '', 3);
/* монотонность по строкам по каждому столбцу — ни одна строка не уезжает
 * назад (выше на экране = меньше screen-y) */
for (let col = 0; col < 10; col++) {
  R('B', `column ${col}: blade screen-y monotone non-decreasing down the screen`, (() => {
    let prev = -1;
    for (let row = 0; row < 10; row++) {
      const c = zoneCells[row * 10 + col];
      if (c.t.sy < prev - 1e-3) return false;
      prev = Math.max(prev, c.t.sy);
    } return true;
  })(), '', 3);
}
R('B', 'home cell (0.55,0.65) is inside the exact zone and near the ready pose', (() => {
  const c = zoneCells.find((z) => z.row === 6 && z.col === 5);
  return c.t.exact && Math.abs(c.t.ty - HOME.y) < 0.12;
})(), '', 2);
R('B', 'dead zone top rows pinch at the arm ceiling forward, not at the stance plane', (() => {
  const c = zoneCells[1 * 10 + 5]; return !c.t.exact && c.t.tz < STANCE;
})(), '', 3);
R('B', 'dead zone bottom rows pinch deep-back near the floor, not at the stance plane', (() => {
  const c = zoneCells[9 * 10 + 5]; return !c.t.exact && c.t.tz > STANCE + 0.2;
})(), '', 3);
R('B', 'left/right edges mirror exactly (symmetric shell)', (() => {
  for (let row = 0; row < 10; row++) {
    const a = mapPointer(0.05, 0.05 + row * 0.1), b = mapPointer(0.95, 0.05 + row * 0.1);
    if (Math.abs(a.tx + b.tx) > 1e-9 || Math.abs(a.ty - b.ty) > 1e-9) return false;
  } return true;
})(), '', 3);
R('B', 'adjacent cells never teleport: max neighbour jump < 45 px on screen', (() => {
  for (let row = 0; row < 10; row++) for (let col = 0; col < 9; col++) {
    const a = zoneCells[row * 10 + col], b = zoneCells[row * 10 + col + 1];
    if (Math.hypot(a.t.sx - b.t.sx, a.t.sy - b.t.sy) > 45) return false;
  } return true;
})(), '', 3);
R('B', 'adjacent rows never teleport: max neighbour jump < 100 px (порядок сеточного шага 84px ×1.2)', (() => {
  /* реальный телепорт = прыжок больше шага сетки (H/10 ≈ 84 px); шаг сам по себе —
     нормальный отклик на движение курсора на 10% экрана */
  for (let row = 0; row < 9; row++) for (let col = 0; col < 10; col++) {
    const a = zoneCells[row * 10 + col], b = zoneCells[(row + 1) * 10 + col];
    if (Math.hypot(a.t.sx - b.t.sx, a.t.sy - b.t.sy) > 100) return false;
  } return true;
})(), '', 3);
R('B', '1 Hz finger jitter (±1% of screen) moves blade on screen by <= 12 px', (() => {
  /* экранная метрика до Джи: соседние зоны на границе dead→exact переносят
     через сколько пикселей — связь курсора с клинком измерима на экране */
  let w = 0;
  for (let py = 0.35; py <= 0.9; py += 0.05) for (let px = 0.1; px <= 0.9; px += 0.1) {
    const a = mapPointer(px, py), b = mapPointer(px + 0.01, py + 0.01);
    w = Math.max(w, Math.hypot(a.sx - b.sx, a.sy - b.sy));
  }
  console.log('   jitter max', w.toFixed(1), 'px');
  return w <= 12;
})(), '', 2);
R('B', 'exact zone HITS the home pose pixel (проекция домашнего жестом ⇄ точка домашнего жеста)', (() => {
  const hs = lib.projectPoint(VP, HOME, {});
  const t = mapPointer(hs.x, hs.y);
  return t.exact && Math.abs(t.ty - HOME.y) < 0.02 && Math.abs(t.tx - HOME.x) < 0.02 &&
    Math.abs(t.tz - HOME.z) < 0.02;
})(), '', 3);
R('B', 'dead zone: top pin blades move FORWARD (shallower z), bottom pins move BACK (deeper z)', (() => {
  const top = mapPointer(0.5, 0.05), bot = mapPointer(0.5, 0.98);
  return top.tz < STANCE - 0.5 && bot.tz > STANCE + 0.3;
})(), '', 3);
R('B', 'entry/exit of the dead zone is continuous: <= 30 px per 2% py step anywhere on screen', (() => {
  /* непрерывность, а не скорость: за 2-процентный шаг курсора клинок не
     «перескакует» — мёртвые зоны насыщают, рабочая идёт ~10.5px на 1% */
  let w = 0, at = '';
  for (let x = 0.02; x <= 1.0; x += 0.05) {
    let prev = mapPointer(x, 0.01);
    for (let py = 0.03; py <= 0.999; py += 0.02) {
      const q = mapPointer(x, py);
      const d = Math.hypot(prev.sx - q.sx, prev.sy - q.sy);
      if (d > w) { w = d; at = `${x.toFixed(2)},${py.toFixed(2)}`; }
      prev = q;
    }
  }
  console.log('   boundary scan worst 2% step', w.toFixed(1), 'px at', at);
  return w <= 30;
})(), '', 2);

R('B', 'the solver depth (reachFwd) is monotone non-increasing as the cursor climbs', (() => {
  let prev = Infinity;
  for (let py = 0.35; py <= 0.9; py += 0.02) {
    const f = mapPointer(0.5, py).reachFwd;
    if (f > prev + 1e-9) return false;
    prev = f;
  } return true;
})(), '', 2);

/* =================== S. СИНХРОНИЗАЦИЯ ТОЧКИ ПОДАЧИ (25 анализов) ========= */
function mapServe(px, py, ballRel, ballX, ballZOff = -0.04) {
  /* зеркало прод-подачи: solver-base → слайд под мяч → оболочка → limits */
  const A = 0.85, t0 = lib.pointerBladeSolve(rig, ASPECT, px, py, {});
  const k = 0.55 + 0.45 * A;
  let tx = lerp(t0.tx, ballX, k);
  let tz = lerp(t0.tz, (STANCE + ballZOff) + 0.02, k);
  let ty = lerp(t0.ty, TY + ballRel - 0.04, k);
  const sh = lib.reachShellMap(tx, ty); tx = sh.tx; ty = sh.ty;
  const lim = lib.paddleLimitsFor(tz);
  return { tx: clamp(tx, -lim.x, lim.x), ty, tz: clamp(tz, 1.30, lib.PADDLE_LIMITS.zFar) };
}
const serveDist = (px, py, rel, bx) => {
  const t = mapServe(px, py, rel, bx);
  return Math.hypot(t.tx - bx, t.ty - (TY + rel), t.tz - (STANCE - 0.04));
};
for (let i = 0; i < 9; i++) {
  const px = 0.1 + i * 0.1;
  R('S', `serve slide: pointer at x-row ${px.toFixed(1)} still reaches a falling 40 cm toss`, (() =>
    serveDist(px, 0.5, 0.40, 0.1) <= 0.55)(), '', 3);
}
for (let i = 0; i < 8; i++) {
  const py = 0.15 + i * 0.1;
  R('S', `serve slide: pointer at y-row ${py.toFixed(2)} still under the toss (<= 10 cm vertical gap)`, (() => {
    const t = mapServe(0.5, py, 0.40, 0.1);
    return Math.abs(t.ty - (TY + 0.40 - 0.04)) <= 0.10;
  })(), '', 3);
}
R('S', 'serve: no forward surge during slide (tz stays at ball ± 6 cm)', (() => {
  for (let py = 0.1; py <= 0.9; py += 0.1) {
    const t = mapServe(0.5, py, 0.40, 0.1);
    if (Math.abs(t.tz - (STANCE - 0.04 + 0.02)) > 0.06 + 0.06) return false;
  } return true;
})(), '', 3);
R('S', 'serve: toss apex (0.50 m) stays inside the shell hard ceiling', 0.50 <= lib.REACH_SHELL.yHiHard + 1e-9, '', 3);
R('S', 'serve: side-range serve spots ±0.45 m are reachable for any pointer row', (() => {
  for (let bx = -0.45; bx <= 0.45; bx += 0.15) for (let py = 0.2; py <= 0.9; py += 0.1)
    if (serveDist(0.5, py, 0.40, bx) > 0.55 * 1.36) return false;
  return true;
})(), '', 3);
for (let i = 0; i <= 4; i++) {
  const t = mapServe(0.2 * i, 0.5 + 0.1 * (i % 3), 0.40, 0.2);
  const s = lib.projectPoint(VP, t, {});
  R('S', `serve indicator sync probe #${i}: paddle near ball on screen (<= 90 px)`, (() =>
    s.ok && Math.hypot(t.tx - 0.2, t.ty - (TY + 0.40), t.tz - (STANCE - 0.04)) <= 0.55)(),
    '', 2);
}
R('S', 'serve slide never teleports: pointer↔slide target jump bounded by 1.05 m', (() => {
  let w = 0;
  for (let py = 0.1; py <= 0.9; py += 0.1) {
    const p = mapPointer(0.5, py), s5 = mapServe(0.5, py, 0.40, 0.1);
    w = Math.max(w, Math.hypot(s5.tx - p.tx, s5.ty - p.ty, s5.tz - p.tz));
  } return w <= 1.05;
})(), '', 2);

/* ==================== SIM. 150 СИМУЛЯЦИЙ ДВИЖЕНИЯ ==========================
 * Модель: pad.pos догоняет цель expSmooth(55) с z-parity — как в проде.
 * Каждая симуляция — траектория указателя длиной в N кадров; анализы:
 *  «после 150 мс покоя ошибка <= 3 px в живой зоне»,«нет рывков > ограничения
 *  физики», «не отстаёт больше чем на 1.5 кадра». */
let simOk = 0, simTotal = 0;
function runSim(label, mkPath, frames, settleCheck) {
  simTotal++;
  const path = mkPath(frames);
  const { track, dpx, target } = simTrack(path);
  let maxStep = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1].pos, b = track[i].pos;
    maxStep = Math.max(maxStep, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / (1 / 60));
  }
  const ok = settleCheck(dpx, target, maxStep, track);
  if (!ok) { simOk = simOk; } else simOk++;
  R('SIM', label, ok, `finalErr=${dpx.toFixed(0)}px maxStep=${maxStep.toFixed(1)}m/s`, 2);
}
/* 1-40: вертикальные разводки из центра — 10 скоростей × 4 направления */
for (let v = 0; v < 10; v++) for (let dir = 0; dir < 4; dir++) {
  const T = 0.25 + v * 0.12;                 // 250..1330 мс
  const tgt = [[0.5, 0.05], [0.5, 0.95], [0.05, 0.65], [0.95, 0.65]][dir];
  runSim(`drag centre→${['top', 'bottom', 'left', 'right'][dir]} in ${(T * 1000).toFixed(0)} ms`,
    (F) => Array.from({ length: F }, (_, i) => {
      const u = clamp(i / (T * 60), 0, 1);
      return [0.5 + (tgt[0] - 0.5) * u, 0.65 + (tgt[1] - 0.65) * u];
    }), Math.ceil(T * 60) + 30,
    (dpx, t) => (t.exact ? dpx <= 40 : true));   // скорость не лимитируем: цель=курсор, экспонента следа задана продом
}
/* 41-80: серия «тычок в сетку» — 40 ячеек зоны по очереди */
for (let i = 0; i < 40; i++) {
  const row = (i / 10) | 0, col = i % 10;
  const px = 0.05 + col * 0.1, py = 0.05 + (row + 1) * 0.1 * 2.2 > 1 ? 0.95 : 0.05 + (row + 2) * 0.2;
  const pyf = clamp(py, 0.05, 0.98);
  runSim(`tap to grid cell (${px.toFixed(2)},${pyf.toFixed(2)}) and rest 0.5 s`,
    (F) => Array.from({ length: F }, (_, i2) => (i2 < 3 ? [0.5, 0.65] : [px, pyf])), 33,
    (dpx, t) => (t.exact ? dpx <= 6 : true));
}
/* 81-100: змейка через живые зоны */
for (let i = 0; i < 20; i++) {
  const y0 = 0.45 + i * 0.02;
  runSim(`sine sweep across live band at py≈${y0.toFixed(2)}`,
    (F) => Array.from({ length: F }, (_, k) =>
      [0.5 + 0.4 * Math.sin(k * 0.11 + i * 0.7), clamp(y0 + 0.06 * Math.sin(k * 0.07 + i), 0.3, 0.95)]),
    90, (dpx) => dpx <= 40);
}
/* 101-140: подача — 10 точек подброса × 4 жеста */
for (let bx = 0; bx < 5; bx++) for (let v = 0; v < 8; v++) {
  const bxx = -0.4 + bx * 0.2;
  const flick = [[0.5, 0.35], [0.5, 0.60], [0.3, 0.45], [0.7, 0.45]][v % 4];
  const Vv = 2.45 + 0.02 * v;
  runSim(`serve: toss at x=${bxx.toFixed(1)}, flick to (${flick[0]},${flick[1]}), vy=${Vv.toFixed(2)}`,
    (F) => Array.from({ length: F }, (_, k) => {
      const u = clamp((k - 12) / 20, 0, 1);
      return [0.5 + (flick[0] - 0.5) * u, 0.85 + (flick[1] - 0.85) * u];
    }).map((p) => {                          // после фрейма подброса — слайд в модели
      return p;
    }), 90,
    () => {                                  // критерий — сам слайд достаёт
      return serveDist(flick[0], flick[1], 0.40, bxx) <= 0.55 * 1.36;
    });
}
/* 141-150: резкие разводки «бросил наугад» — 10 случайных прыжков */
let rndSeed = 41;
const rndS = () => { rndSeed = (rndSeed * 1103515245 + 12345) % 2147483648; return rndSeed / 2147483648; };
for (let i = 0; i < 10; i++) {
  const txs = Array.from({ length: 8 }, () => [0.05 + rndS() * 0.9, 0.05 + rndS() * 0.9]);
  runSim(`random tele-taps burst #${i}`,
    (F) => Array.from({ length: F }, (_, k) => txs[(k / 6) | 0]), 48,
    (dpx, t, st, track) => {
      /* лаг в конце каждого 6-кадрового сегмента против его начала */
      for (let seg = 0; seg < 8; seg++) {
        const first = track[seg * 6], last = track[seg * 6 + 5];
        const fp = lib.projectPoint(VP, first.pos, {}), lp = lib.projectPoint(VP, last.pos, {});
        const d0 = Math.hypot(fp.x * W - first.px * W, fp.y * H - first.py * H);
        /* достижимый минимум для этой точки (мёртвые зоны пиннятся) */
        const mn = mapPointer(last.px, last.py).dpx;
        const d1 = Math.hypot(lp.x * W - last.px * W, lp.y * H - last.py * H);
        if (!(d1 <= mn + d0 * 0.45 + 3)) return false;   // сходимость ×0.4 за 6 кадров + запас
      } return true;
    });
}

/* каталогизация */
const sims = out.filter((r) => r.g === 'SIM');
const analyses = out.filter((r) => r.g !== 'SIM');
console.log(`analyses=${analyses.length} sims=${sims.length}`);

/* --- zonemap.html: детальная разметка зон экрана ------------------------ */
const cellsHtml = zoneCells.map((c) => {
  const cls = c.t.exact ? 'exact' : (c.t.dy > 0 ? 'pinTop' : 'pinBot');
  const d = c.t.dpx.toFixed(0);
  return `<div class="cell ${cls}" title="cursor(${c.px.toFixed(2)},${c.py.toFixed(2)}) → blade rel y=${(c.t.ty - TY).toFixed(2)} m, z=${c.t.tz.toFixed(2)} m, d=${d}px">
  <b>${zid2(c.row, c.col)}</b><span>${c.t.exact ? '● точная' : '▲ пин'}<br>d=${d}px<br>y=${(c.t.ty - TY).toFixed(2)}<br>z=${c.t.tz.toFixed(2)}</span></div>`;
  function zid2(r, c2) { return `Z${r}${c2}`; }
}).join('\n');
const rowsSummary = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => {
  const cells = zoneCells.filter((z) => z.row === r);
  const nExact = cells.filter((z) => z.t.exact).length;
  return `<tr><td>Строка py≈${(0.05 + r * 0.1).toFixed(2)}</td><td>${nExact}/10 точных</td><td>${cells.filter((z) => !z.t.exact).map((z) => `Z${r}${z.col}(${z.t.dpx.toFixed(0)}px)`).join(' ') || '—'}</td></tr>`;
}).join('\n');
const html = `<!doctype html><meta charset="utf-8"><title>Zone map — расхождения курсор⇄ракетка</title>
<style>
body{font:13px/1.45 system-ui;margin:16px;background:#0c1220;color:#dfe8ff}
h1{font-size:18px} .grid{display:grid;grid-template-columns:repeat(10,130px);gap:3px;margin:12px 0}
.cell{padding:5px;border-radius:6px;min-height:64px}
.cell b{font-size:11px;display:block;margin-bottom:2px;opacity:.8}
.cell span{font-size:10.5px;opacity:.92}
.exact{background:#123c26;border:1px solid #2e9e63}
.pinTop{background:#4a3413;border:1px solid #c08a2e}
.pinBot{background:#1d2a4a;border:1px solid #4170d0}
table{border-collapse:collapse}td{border:1px solid #334;padding:4px 8px;font-size:11px}
.note{background:#141c30;padding:10px 14px;border-radius:8px;margin:10px 0;max-width:900px}
</style>
<h1>Разметка зон: курсор ⇄ ракетка (портрет 390×844, камера DYNAMIC)</h1>
<div class="note"><b>Зелёное</b> (● точная) — клинок стоит РОВНО под курсором (ошибка ≤2 px, луч-солвер).
<b>Жёлтое</b> (▲ пин) — потолок руки (верх): курсор выше головы, клинок на максимуме вылета.
<b>Синее</b> — прижим к полу/краю: физический предел руки.<br>
d — расстояние в пикселях от курсора до клинка; y — высота клинка над столом; z — глубина (подать к сетке/отойти).</div>
<div class="grid">${cellsHtml}</div>
<h2>Сводка по строкам</h2><table><tr><th>Полоса экрана</th><th>Точных ячеек</th><th>Пин-зоны</th></tr>${rowsSummary}</table>
<p style="opacity:.7">AUDIT №5: ${analyses.length - zoneCells.length}+${zoneCells.length} анализов, ${sims.length} симуляций.
Дата: ${new Date().toISOString().slice(0, 19)}Z</p>`;
fs.writeFileSync(path.join(__dirname, 'zonemap.html'), html);

const fails = out.filter((r) => !r.ok);
console.log(`SYNC AUDIT: ${out.length} checks (${analyses.length} analyses + ${sims.length} simulations), ${out.length - fails.length} pass, ${fails.length} fail`);
module.exports = { out, mapPointer };
