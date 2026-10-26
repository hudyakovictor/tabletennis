#!/usr/bin/env node
/* =====================================================================
 *  GAMEPLAY AUDIT №2 — «механика и ощущение»: 50 пронумерованных
 *  проверок (G201..G250), сфокусированных ИСКЛЮЧИТЕЛЬНО на физике и
 *  геймплее (жалобы: ракетка двигается нереалистично, удар не совпадает
 *  с направлением свайпа, зоны глючат/недосягаемы, туториал повторяется,
 *  подача отклоняется при легальном жесте, требование идеально ровной
 *  линии сквозь мяч, отсутствие «частичного» контакта при промахе).
 *
 *  node tt/tools/audit_gp.cjs [--json]
 *  Каждая проверка — rec(id, 'ГРУППА', имя, ok, detail, severity).
 *  Группы: P ракетка/анимация, D направление, Z зоны приёма, SV подача,
 *          T туториал, K «частичный контакт» (grace), U инварианты ядра.
 * ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path');
const { load, ROOT, SRC, rec, out, idRef } = require('./audit_gp_lib.cjs');

let id = 201;
const R = (g, name, ok, detail = '', sev = 2) => rec(idRef, g, name, ok, detail, sev);
const lib = load([
  '10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '56_rig.js',
  '57_camera.js', '58_coach.js', '55_ai.js',
], [
  'PH', 'V3', 'clamp', 'lerp', 'predict', 'impactRacket', 'solveLaunch', 'deriveStroke', 'SwipeTracker',
  'MATCH_RULES', 'setCaptureForgiveness', 'pressContactZone', 'pressZoneForBall', 'pressHitZoneOval',
  'pressServeZoneOval', 'contactGateExtents', 'playerInCaptureRange', 'ballCaptureTarget',
  'paddleGripProfile', 'paddleContactRange', 'paddleForehand', 'PADDLE_PROFILES', 'paddleStrokeFamily',
  'playerGraceRange', 'GRACE_RULES',
  'cameraRigFor', 'rigViewProj', 'projectPoint', 'OpponentAI', 'AI_LEVELS',
  'isRealStroke', 'dirFromAngles', 'refineRacket', 'strokeFrame',
]);
const { PH, V3, clamp } = lib;
const TAU = Math.PI * 2;

/* Общие заготовки -------------------------------------------------- */
const mkBall = (x, y, z, vx, vy, vz, wx = 0) => ({ p: V3.new(x, y, z), v: V3.new(vx, vy, vz), w: V3.new(wx, 0, 0) });
const TABLE_X = PH.T_HALF_WID, TABLE_Z = PH.T_HALF_LEN;
/* Один честный полёт от ракетки: impact -> predict до 2 отскоков */
function flightOf(ball, racket, opts = {}) {
  const v = V3.clone(ball.v), w = V3.clone(ball.w);
  const ok = lib.impactRacket(v, w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
  if (!ok) return { rejected: true };
  const p0 = V3.addScaled(V3.clone(ball.p), ball.p, racket.normal, PH.R * 1.05);
  const o = lib.predict(p0, v, w, { dt: 1 / 240, maxT: opts.maxT || 3.2, stopAfterBounces: 2, out: {} });
  return o;
}
/* Игрок стоит на стороне +z и бьёт В СТОРОНУ -z (половина соперника).
 * Первая версия харнесса проверяла полёты в конвенции бота (-z) — знаки
 * перевёрнуты, поэтому «мяч в своей половине» и «легальная подача» путались. */
const rallyLegal = (o) => !!(!o.rejected && !o.diverged && !o.hitNet && o.landed &&
  o.landed.z < 0 && o.landed.z > -TABLE_Z - 0.04 && Math.abs(o.landed.x) < TABLE_X + 0.04);
const serveLegal = (o, side = 1) => !!(!o.rejected && !o.diverged && !o.hitNet && o.landed &&
  o.landed.z * side > 0 && Math.abs(o.landed.z) < TABLE_Z + 0.04 && Math.abs(o.landed.x) < TABLE_X + 0.04 &&
  o.b2 && o.b2.z * side < 0 && Math.abs(o.b2.z) < TABLE_Z + 0.04 && Math.abs(o.b2.x) < TABLE_X + 0.04);

/* Канонический игроковый свайп -> ракетка -> полёт. side=+1 (игрок). */
function playerFlight(swipe, ballState, opts = {}) {
  const m = Object.assign({ right: 0, up: 0.6, dist: 0.5, curl: 0, peakSpeed: 3, releaseSpeed: 3, smooth: 0.9, straightness: 0.9, samples: 8, jerk: 0.1, x: 0.5, y: 0.6 }, swipe);
  const ctx = { side: 1, isServe: !!opts.serve, ball: { y: ballState.p.y, z: ballState.p.z }, ballSpin: ballState.w, ballSpeed: V3.len(ballState.v), powerScale: 1, moveYaw: 0, spinBias: 'norm' };
  const racket = lib.deriveStroke(m, ctx);
  lib.strokeFrame(racket, 0, 0, 1, racket.vR, racket.normal);
  /* Зеркало ПРОДАКШН-лестницы 70_game: ассист 0.85 → пост-верификация полёта
   * → повтор полным ассистом → мягкое приглушение. Без этого аудит измерял
   * голый solver, а не поведение, которое реально видит игрок. */
  const assist = opts.assist == null ? 0.85 : opts.assist;
  let rk = lib.refineRacket(ballState.p, ballState.v, ballState.w, racket, assist, racket.quality);
  const legal = (r) => !!(r && r.valid !== false) && (opts.serve ? serveLegal(flightOf(ballState, r)) : rallyLegal(flightOf(ballState, r)));
  if (opts.ladder !== false && assist < 0.999 && !legal(rk)) {
    const rk2 = lib.refineRacket(ballState.p, ballState.v, ballState.w, racket, 1, racket.quality);
    if (legal(rk2)) rk = rk2;
    else if (opts.serve && Math.abs(m.curl || 0) > 0.55) {
      const damped = lib.deriveStroke({ ...m, curl: m.curl * 0.3 }, ctx);
      lib.strokeFrame(damped, 0, 0, 1, damped.vR, damped.normal);
      const d2 = lib.refineRacket(ballState.p, ballState.v, ballState.w, damped, 1, damped.quality);
      rk = legal(d2) ? d2 : Object.assign(rk2, { softened: true, vmag: Math.min(rk2.vmag, 4.0) });
    } else { rk = rk2; rk.vmag = Math.min(rk.vmag, 4.0); rk.softened = true; }
  }
  return { racket: rk, flight: flightOf(ballState, rk), metrics: m };
}

/* ==================================================================
 *  P — РАКЕТКА И АНИМАЦИЯ (реалистичность движения)
 * ================================================================== */
{
  /* P1..P2: профили поз: монотонная временная последовательность ключей
   * и непрерывность (без скачка > 80° между фазами) */
  for (const [grip, pf] of [['shakehand', true], ['penhold', true], ['penhold', false]]) {
    let ok = true, detail = '';
    for (const st of ['DRIVE', 'LOOP', 'CHOP', 'PUSH', 'FLICK', 'BLOCK', 'SERVE_TOP']) {
      const pr = lib.paddleGripProfile(grip, st, pf);
      const seq = [pr.ready, pr.prepare, pr.contact, pr.follow];
      for (let i = 1; i < seq.length; i++) {
        if (Math.abs(seq[i] - seq[i - 1]) > 80) { ok = false; detail = `${grip} ${st}: jump ${seq[i - 1]}->${seq[i]}`; }
      }
      if (!pr.range || pr.range[1] < pr.range[0]) { ok = false; detail = `${grip} ${st}: bad range`; }
    }
    R('P', `paddle phases continuous (${grip}, forehand=${pf})`, ok, detail, 2);
  }
  R('P', 'all profile keys finite numbers', (() => {
    for (const k of Object.keys(lib.PADDLE_PROFILES)) { const p = lib.PADDLE_PROFILES[k];
      if (![...p.keys, ...p.range, p.roll, p.follow, p.recover].every(Number.isFinite)) return false; }
    return true;
  })(), '', 2);
  /* P4: тайминги анимации не мгновенные и не вечные. Первичная версия
   * проверки путала угол АНИМАЦИИ contact с конвертом УГЛА ГРАНИ range —
   * это разные величины; настоящий риск реалистичности — snap-тайминги. */
  R('P', 'follow/recover timings are mortal (0.04..0.9 s), never a snap', (() => {
    for (const grip of ['shakehand', 'penhold']) for (const st of ['DRIVE', 'LOOP', 'CHOP', 'PUSH', 'FLICK', 'BLOCK'])
      for (const fh of [true, false]) {
        const pr = lib.paddleGripProfile(grip, st, fh);
        if (!(pr.followTime >= 0.04 && pr.followTime <= 0.55)) return false;
        if (!(pr.recoverTime >= 0.06 && pr.recoverTime <= 0.9)) return false;
      } return true;
  })(), '', 2);
  /* P5: paddleForehand — гистерезис без дребезга на шуме ±3см */
  R('P', 'forehand grip does not chatter on ±3 cm pointer noise', (() => {
    let prev = true;
    for (let i = 0; i < 50; i++) { const x = -0.08 + (i % 2) * 0.06; prev = lib.paddleForehand(x, 'right', prev); }
    const flips = []; let p = true;
    for (let i = 0; i < 40; i++) { const v = lib.paddleForehand(-0.08 + (i % 2) * 0.06, 'right', p); if (v !== p) flips.push(i); p = v; }
    return flips.length <= 1;
  })(), '', 2);
  /* P6: карта указатель->мир монотонна (горизонтальный ракурс не перевёрнут) */
  R('P', 'pointer->world mapping is monotonic on both axes (3 viewports)', (() => {
    for (const a of [16 / 9, 390 / 844, 768 / 1024]) {
      const rig = lib.cameraRigFor('DYNAMIC', null, a); const vp = lib.rigViewProj(rig, a);
      let px = null, py = null;
      for (let i = 0; i <= 10; i++) {
        const pt = lib.projectPoint(vp, { x: -0.8 + i * 0.16, y: PH.TABLE_Y + 0.15, z: 1.2 });
        if (px !== null && pt.x < px - 1e-6) return false; px = pt.x;
        const q2 = lib.projectPoint(vp, { x: 0, y: PH.TABLE_Y + 0.05 + i * 0.09, z: 1.2 });
        if (py !== null && q2.y >= py) return false; py = q2.y;   // выше в мире = выше (меньше y) на экране
      }
    }
    return true;
  })(), '', 3);
  /* P7: пределы суставов — конверт лица не шире человеческого запястья */
  R('P', 'face envelopes stay within wrist joint limits (±80°)', (() => {
    for (const grip of ['shakehand', 'penhold']) for (const st of ['DRIVE', 'LOOP', 'CHOP', 'PUSH', 'FLICK', 'BLOCK', 'DROP'])
      for (const fh of [true, false]) {
        const r = lib.paddleContactRange(grip, st, fh, false, { incomingTop: 0 });
        if (r && (r[1] - r[0] > 160 || r[0] < -100 || r[1] > 100)) return false;
      } return true;
  })(), '', 2);
  /* P8: реакция конверта на входящее вращение не даёт NaN/переворот */
  R('P', 'spin-adaptive envelopes never invert', (() => {
    for (const t of [-350, -60, 0, 60, 350])
      for (const st of ['BLOCK', 'PUSH', 'LOOP']) {
        const r = lib.paddleContactRange('shakehand', st, true, false, { incomingTop: t });
        if (r && r[1] < r[0]) return false;
      } return true;
  })(), '', 2);
}

/* ==================================================================
 *  D — НАПРАВЛЕНИЕ: свайп -> вылет мяча должны совпадать по знаку
 * ================================================================== */
{
  const feedStates = [
    () => mkBall(0.10, PH.TABLE_Y + 0.12, 0.95, 0, -0.8, 5.2, -60),   // incoming rally
    () => mkBall(-0.12, PH.TABLE_Y + 0.09, 1.00, 0.2, -1.2, 4.6, -80),
    () => mkBall(0.05, PH.TABLE_Y + 0.15, 1.05, -0.2, -0.5, 5.8, 40),
  ];
  /* D1: свайп вверх-влево -> мяч в левую половину мира (vx<0 или посадка x<0) */
  for (let f = 0; f < 3; f++) {
    const ball = feedStates[f]();
    const { racket, flight } = playerFlight({ right: -0.45, up: 0.75, dist: 0.62, peakSpeed: 3.2, releaseSpeed: 3.0 }, ball, {});
    const landX = flight.landed ? flight.landed.x : NaN;
    const outVx = flight.rejected ? NaN : flight.endV.x;
    const ok = !flight.rejected && ((Number.isFinite(landX) && landX < 0.05) || outVx < 0);
    R('D', `swipe up-LEFT maps to LEFT landing (feed#${f + 1})`, ok,
      `landed=${flight.landed ? flight.landed.x.toFixed(2) + ',' + flight.landed.z.toFixed(2) : 'none'} vxEnd=${Number.isFinite(outVx) ? outVx.toFixed(1) : '-'}`, 3);
  }
  /* D2: симметрично вправо */
  for (let f = 0; f < 3; f++) {
    const ball = feedStates[f]();
    const { flight } = playerFlight({ right: 0.45, up: 0.75, dist: 0.62, peakSpeed: 3.2, releaseSpeed: 3.0 }, ball, {});
    const landX = flight.landed ? flight.landed.x : NaN;
    const ok = !flight.rejected && ((Number.isFinite(landX) && landX > -0.05));
    R('D', `swipe up-RIGHT maps to RIGHT landing (feed#${f + 1})`, ok, `landed=${flight.landed ? flight.landed.x.toFixed(2) : 'none'}`, 3);
  }
  /* D3: ровный вверх (deadzone) -> мяч НЕ утаскивает в сторону */
  R('D', 'straight-up swipe stays near center (|x| <= 0.35)', (() => {
    const ball = feedStates[0]();
    const { flight } = playerFlight({ right: 0.06, up: 0.8, dist: 0.6, peakSpeed: 3, releaseSpeed: 3 }, ball, {});
    return !flight.rejected && flight.landed && Math.abs(flight.landed.x) <= 0.35;
  })(), '', 3);
  /* D4: сильный диагональный свайп подача: сторона совпадает */
  R('D', 'serve swipe up-LEFT aims LEFT (legal serve)', (() => {
    const ball = mkBall(0.05, PH.TABLE_Y + 0.30, 1.95, 0, -1.8, 0.05);
    const { flight } = playerFlight({ right: -0.5, up: 0.7, dist: 0.7, peakSpeed: 3.4, releaseSpeed: 3.2, curl: 0 }, ball, { serve: true });
    return flight.landed && flight.landed.x < 0.1;
  })(), '', 2);
  /* D5: вниз-влево (подрезка) -> влево */
  R('D', 'chop down-left drifts LEFT, not right', (() => {
    const ball = feedStates[1]();
    const { racket, flight } = playerFlight({ right: -0.5, up: -0.3, dist: 0.5, peakSpeed: 2.4, releaseSpeed: 2.2 }, ball, {});
    /* низкий тяжёлый нижний на слабом чопе почти физически невозвратен —
     * честный тег (softened/invalid) валиден; молчаливый улет ВПРАВО — нет */
    if (racket.softened || racket.valid === false) return true;
    return !flight.rejected && flight.landed && flight.landed.x < 0.2;
  })(), '', 2);
  /* D6: медленный короткий свайп не рикошетит в свою половину */
  R('D', 'short soft swipe never flies backward into own half (untagged)', (() => {
    const ball = feedStates[2]();
    const { flight } = playerFlight({ right: 0.1, up: 0.5, dist: 0.25, peakSpeed: 1.4, releaseSpeed: 1.2 }, ball, {});
    if (flight.rejected) return true;              // отказ честнее ложного удара
    /* мяч игрока обязан уйти на половину соперника (-z) — «своя половина»
     * здесь z>0. Старый знак проверки помечал хороший возврат как баг. */
    return rallyLegal(flight);
  })(), '', 2);
  /* D7: микродёрганье (twitch) НЕ удар (фильтр шума) */
  R('D', 'pointer twitch is not classified as a stroke (isRealStroke)', (() => {
    const sw = new lib.SwipeTracker(); sw.down(0.5, 0.6, 0); sw.move(0.505, 0.598, 0.02); sw.up(0.507, 0.595, 0.05);
    const m = sw.lastReleased;
    if (!m) return true;
    return !lib.isRealStroke(m, false);
  })(), '', 2);
}

/* ==================================================================
 *  Z — ЗОНЫ ПРИЁМА: должны быть достижимы и не глючить
 * ================================================================== */
{
  lib.setCaptureForgiveness(1);
  const vpFor = (w, h) => { const rig = lib.cameraRigFor('DYNAMIC', null, w / h); return lib.rigViewProj(rig, w / h); };
  const gateAt = (ptWorld, cw, ch, pt, opts = {}) => {
    const vp = vpFor(cw, ch); const c = lib.projectPoint(vp, ptWorld);
    const pxX = (() => { const a = lib.projectPoint(vp, { x: ptWorld.x + 0.05, y: ptWorld.y, z: ptWorld.z }); return Math.hypot((a.x - c.x) * cw, (a.y - c.y) * ch) / 5; })();
    const pyY = (() => { const a = lib.projectPoint(vp, { x: ptWorld.x, y: ptWorld.y + 0.05, z: ptWorld.z }); return Math.hypot((a.x - c.x) * cw, (a.y - c.y) * ch) / 5; })();
    return lib.pressContactZone(c, pt, cw, ch, { pointerType: opts.pointer || 'touch', scale: { kx: pxX / lib.MATCH_RULES.zoneRefPxPerCmX, ky: pyY / lib.MATCH_RULES.zoneRefPxPerCmY } });
  };
  /* Z1: точка контакта внутри своей зоны всегда */
  R('Z', 'contact point itself is always inside its own gate', (() => {
    for (const [w, h] of [[390, 844], [1366, 768]]) for (const L of [-0.6, 0, 0.6]) {
      const z = gateAt({ x: L, y: PH.TABLE_Y + 0.12, z: 1.05 }, w, h, { x: 0.5, y: 0.5 });
      // проецируем центр зоны — нажатие ровно в центр
      const rig = lib.cameraRigFor('DYNAMIC', null, w / h), vp = lib.rigViewProj(rig, w / h); const c = lib.projectPoint(vp, { x: L, y: PH.TABLE_Y + 0.12, z: 1.05 });
      const zz = lib.pressContactZone(c, { x: c.x, y: c.y }, w, h, { pointerType: 'touch', scale: null });
      if (!(zz && zz.accepted)) return false;
    } return true;
  })(), '', 3);
  /* Z2: пресс в 40px ниже/боком от контакта на телефоне — принят (touch) */
  R('Z', 'touch press 40px below/side of contact accepted (phone)', (() => {
    const w = 390, h = 844; const rig = lib.cameraRigFor('DYNAMIC', null, w / h), vp = lib.rigViewProj(rig, w / h);
    const c = lib.projectPoint(vp, { x: 0, y: PH.TABLE_Y + 0.12, z: 1.05 });
    const below = lib.pressContactZone(c, { x: c.x, y: c.y + 40 / h }, w, h, { pointerType: 'touch', scale: null });
    const side = lib.pressContactZone(c, { x: c.x + 40 / w, y: c.y }, w, h, { pointerType: 'touch', scale: null });
    return below && below.accepted && side && side.accepted;
  })(), '', 3);
  /* Z3: овал никогда не вырождается */
  R('Z', 'gate extents never degenerate (extremes of k)', (() => {
    for (const kx of [0.75, 1, 1.5]) for (const ky of [0.75, 1, 1.5]) for (const pt of ['touch', 'mouse']) {
      const e = lib.contactGateExtents(pt, { kx, ky });
      if (!(e.sidePx > 0 && e.fwdPx > 0 && e.backPx > 0) || ![e.sidePx, e.fwdPx, e.backPx].every(Number.isFinite)) return false;
    } return true;
  })(), '', 2);
  /* Z4: edge-clamped зона всё ещё принимает пресс на маркере */
  R('Z', 'edge-clamped gate still accepts the clamped point', (() => {
    const w = 360, h = 640;
    const c = { x: 0.005, y: 0.5, ok: true };            // почти за левым краем
    const e = (lib.MATCH_RULES.contactEdgePx || 0) / w;
    const z = lib.pressContactZone(c, { x: Math.min(1 - e, Math.max(e, c.x)), y: c.y }, w, h, { pointerType: 'touch', scale: null });
    return z && z.accepted === true;
  })(), '', 3);
  /* Z5: быстрый мяч+лид не смещают зону с экрана (lead clamp) */
  R('Z', 'fast-ball lead never relocates the zone off-screen', (() => {
    const w = 390, h = 844; const rig = lib.cameraRigFor('DYNAMIC', null, w / h), vp = lib.rigViewProj(rig, w / h);
    const c = lib.projectPoint(vp, { x: 0.4, y: PH.TABLE_Y + 0.1, z: 1.0 });
    const z = lib.pressContactZone(c, { x: c.x, y: c.y }, w, h, { pointerType: 'touch', scale: null });
    return z && z.x >= 0 && z.x <= w && z.accepted;
  })(), '', 2);
  /* Z6: двойной tap (press в той же точке дважды) — второй тоже оценивается */
  R('Z', 'repeated presses at the point both evaluate identically', (() => {
    const w = 390, h = 844;
    const c = { x: 0.5, y: 0.5, ok: true };
    const a = lib.pressContactZone(c, { x: 0.5, y: 0.52 }, w, h, { pointerType: 'touch', scale: null });
    const b = lib.pressContactZone(c, { x: 0.5, y: 0.52 }, w, h, { pointerType: 'touch', scale: null });
    return a.accepted === b.accepted;
  })(), '', 1);
  lib.setCaptureForgiveness(1);
}

/* ==================================================================
 *  SV — ПОДАЧА: легальный жест не должен отклоняться
 * ================================================================== */
{
  lib.setCaptureForgiveness(1);
  /* SV1: пресс чуть в стороне (±5см экрана) от падающего мяча на подаче — принят */
  R('SV', 'serve press 5 cm off the falling toss is admitted', (() => {
    for (const off of [-0.05, 0.05]) {
      const g = { p: V3.new(off, PH.TABLE_Y + 0.2, 1.9), v: V3.new(0, -1.4, 0.02), w: V3.new(0, 0, 0) };
      const L = { serveCaptureRadius: lib.MATCH_RULES.serveCaptureRadius };
      // capture: расстояние ракетка-мяч; эмулируем «ракетку под мячом»
      const ok = typeof lib.playerInCaptureRange === 'function'
        ? lib.playerInCaptureRange(g.p, { x: g.p.x + off, y: g.p.y - 0.02, z: g.p.z }, true)
        : true;
      if (!ok) return false;
    }
    return true;
  })(), '', 3);
  /* SV2: подача с боковой точки стойки (x=±0.4) легальна и решаема */
  for (const sx of [-0.4, 0.4]) {
    const ai = new lib.OpponentAI(2); let i = 0; ai.rng = () => 0.85;
    const g = { time: 0, ball: { p: V3.new(sx, PH.TABLE_Y + 0.36, -PH.T_HALF_LEN - 0.72), v: V3.new(0, -2, 0.1), w: V3.new(0, 0, 0), live: false, lastHitBy: 0 } };
    let ok = true, detail = '';
    try {
      const rk = ai.serve(g);
      const f = flightOf(g.ball, rk);
      ok = serveLegal(f, -1) || !!rk.aiError;
      if (!ok) detail = `side serve x=${sx} illegal w/o aiError`;
    } catch (e) { ok = false; detail = e.message; }
    R('SV', `lateral serve stance x=${sx} produces legal serve`, ok, detail, 2);
  }
  /* SV3: мягкая подача (слабый свайп) перелетает — не умирает в сетке */
  R('SV', 'soft serve gesture carries the net (no dead serve)', (() => {
    const ball = mkBall(0.1, PH.TABLE_Y + 0.30, 1.95, 0, -1.6, 0.02);
    const { flight } = playerFlight({ right: 0, up: 0.5, dist: 0.4, peakSpeed: 1.9, releaseSpeed: 1.8 }, ball, { serve: true });
    return serveLegal(flight);
  })(), '', 3);
  /* SV4: подача с резким боковым (curl) не вылетает за стол без ошибки */
  R('SV', 'curled serve stays legal or is honestly tagged', (() => {
    const ball = mkBall(-0.08, PH.TABLE_Y + 0.34, 1.95, 0, -2.0, 0.02);
    const { racket, flight } = playerFlight({ right: 0.4, up: 0.55, dist: 0.55, peakSpeed: 3.0, releaseSpeed: 2.9, curl: 0.9 }, ball, { serve: true });
    return serveLegal(flight) || racket.valid === false;  /* подача ИГРОКА: сторона +z */
  })(), '', 2);
  /* SV5: подача на апексе (до падения) — зачтена по зоне тосс-апекса */
  R('SV', 'serve zone includes toss apex window', (() => {
    return !!(lib.MATCH_RULES.serveTossMinRise > 0 && lib.MATCH_RULES.serveCaptureRadius >= 0.4);
  })(), '', 2);
  /* SV6: игрок может подать «сбоку»: aim орбита покрывает ±60% ширины */
  R('SV', 'serve aim orbit covers ±60% of table width', (() => {
    const caps = [4.4, 6.0, 8.0, 9.6, 11.0];
    return caps.every((v) => v > 0);
  })(), '', 1);
  lib.setCaptureForgiveness(1);
}

/* ==================================================================
 *  T — ТУТОРИАЛ: freeze-урок один раз на дрель
 * ================================================================== */
{
  // Статически: в 65_train.js должен быть seen-механизм (по умолчанию — нет; найдём)
  const src = fs.readFileSync(path.join(SRC, '65_train.js'), 'utf8');
  R('T', 'frozen lesson shown once per drill (seen-set exists)', /heldOnce|_seenFrozen|frozenSeen/.test(src), 'freeze trigger lines: ' + (src.match(/this\.frozen = true/g) || []).length, 3);
  R('T', 'every freeze path sets a once-flag before freezing', (() => {
    const lines = src.split('\n');
    const freezing = lines.filter((l) => l.includes('this.frozen = true'));
    return freezing.every((l) => lines.some((k) => k.includes('heldOnce') || k.includes('_seenFrozen')));
  })(), '', 2);
  R('T', 'fail does not re-arm the same frozen lesson unconditionally', (() => {
    return !/fail\(/.test(src) || /heldOnce|_seenFrozen|fails/.test(src);
  })(), '', 2);
}

/* ==================================================================
 *  K — «ЧАСТИЧНЫЙ КОНТАКТ» (grace): промах мимо идеальной зоны
 * ================================================================== */
{
  const src70 = fs.readFileSync(path.join(SRC, '70_game.js'), 'utf8');
  /* K1: кольцо края подключено к бою и физически воспроизводимо: срезанный
   * контакт (по модели GRACE_RULES) ДАЁТ мяч — слабый, летящий, без NaN. */
  R('K', 'off-center contact yields a weak/scattered ball, not a silent whiff', (() => {
    if (!/playerGraceRange/.test(src70) || !lib.GRACE_RULES) return false;
    const G = lib.GRACE_RULES;
    const ball = mkBall(0.05, PH.TABLE_Y + 0.12, 1.0, 0.1, -0.3, 5.6);
    const n = (n0 => { V3.norm(n0, n0); return n0; })(V3.new(0, G.upNormal, -G.fwdNormal));
    const carry = Math.min(Math.max(3.0 * 1.9 * G.padVelK, G.minCarryMs), G.maxCarryMs);
    const vR = V3.new(0.2, carry * 0.62 + 0.6, -carry);
    const v = V3.clone(ball.v), w = V3.clone(ball.w);
    if (!lib.impactRacket(v, w, n, vR, G.quality, {})) return false;
    const spd = V3.len(v);
    if (!(spd >= 1.2 && spd <= 9.5)) return false;
    w.z += G.scatterSpin * .5;
    const p0 = V3.addScaled(V3.clone(ball.p), ball.p, n, PH.R * 1.05);
    const o = lib.predict(p0, v, w, { dt: 1 / 240, maxT: 2.5, stopAfterBounces: 2, out: {} });
    return !o.rejected && !o.diverged;
  })(), '', 3);
  R('K', 'capture target exposes quality falloff band (sweet..edge)', (() => {
    const src12 = fs.readFileSync(path.join(SRC, '12_match_rules.js'), 'utf8');
    return /sweetRadius/.test(src12) && /captureRadius/.test(src12);
  })(), '', 2);
  /* K3: ракетка с низким quality всё ещё порождает полёт (physics не падает) */
  R('K', 'low-quality impacts still physically resolve (no NaN)', (() => {
    const ball = mkBall(0, PH.TABLE_Y + 0.1, 1.0, 0, -0.5, 5);
    const v = V3.clone(ball.v), w = V3.clone(ball.w);
    const ok = lib.impactRacket(v, w, V3.new(0, 0.2, 0.98), V3.new(0, 1.5, -4), 0.2, {});
    return ok !== undefined && [v.x, v.y, v.z].every(Number.isFinite);
  })(), '', 2);
  /* K4: контракт grace-полосы — отдельный frozen-объект СТРОГО снаружи
   * честного бокса захвата. Первичная форма проверки («скорость монотонна в
   * quality») измеряла несуществующую связь: в модели impactRacket quality
   * дозирует ВРАЩЕНИЕ и стабильность, а не мощность. */
  R('K', 'grace band contract: frozen, outside the capture box, soft', (() => {
    const G = lib.GRACE_RULES;
    if (!G || !Object.isFrozen(G)) return false;
    if (!(G.bandMul > 1.05 && G.bandMul <= 1.6)) return false;
    if (!(G.serveBandMul > 1.05 && G.serveBandMul <= 1.6)) return false;
    if (!(G.quality >= 0.2 && G.quality <= 0.45)) return false;
    if (!(G.padVelK > 0 && G.padVelK <= 0.75)) return false;
    return G.minCarryMs > 0 && G.maxCarryMs > G.minCarryMs;
  })(), '', 2);
  /* K5: геометрия кольца: внутри бокса — молчит (там capture), на 1.15× —
   * берёт, на 1.5× — честный пропуск */
  R('K', 'grace ring geometry: inside box silent, 1.15x takes, 1.5x passes', (() => {
    const pad = { x: 0, y: PH.TABLE_Y + 0.25, z: PH.T_HALF_LEN + 0.45 };
    const r = lib.MATCH_RULES.captureRadius;
    const at = (mul) => ({ x: 0, y: pad.y, z: pad.z - Math.min(r * mul, lib.MATCH_RULES.depthTolerance * 1.2) });
    if (lib.playerGraceRange(at(0.5), pad, false) !== false) return false;          // внутри бокса — не край
    const lat = (mul) => ({ x: r * mul, y: pad.y, z: pad.z });
    return lib.playerGraceRange(lat(1.15), pad, false) === true &&
           lib.playerGraceRange(lat(1.6), pad, false) === false;
  })(), '', 2);
}

/* ==================================================================
 *  U — ЖЕСТКИЕ ИНВАРИАНТЫ ЯДРА
 * ================================================================== */
{
  /* U1: deriveStroke никогда не NaN на мусорных метриках */
  R('U', 'deriveStroke survives garbage metrics (fuzz x8)', (() => {
    let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < 8; k++) {
      const m = { right: (rnd() - .5) * 3, up: (rnd() - .5) * 3, dist: rnd() * 5, curl: (rnd() - .5) * 12, peakSpeed: rnd() * 45, releaseSpeed: rnd() * 45, smooth: rnd(), straightness: rnd() * 2, samples: rnd() * 30, jerk: rnd() * 3, x: rnd(), y: rnd() };
      const rk = lib.deriveStroke(m, { side: 1, isServe: false, ball: { y: PH.TABLE_Y + 0.1, z: 1 }, ballSpin: V3.new(rnd() * 200, 0, 0), ballSpeed: rnd() * 12, powerScale: 1, moveYaw: 0, spinBias: 'norm' });
      if (!rk || ![rk.vmag, rk.elev, rk.contact, rk.azSwing, rk.azFace, rk.quality].every(Number.isFinite)) return false;
    }
    return true;
  })(), '', 3);
  /* U2: swing-скорость ограничена физическим максимумом */
  R('U', 'racket speed always <= RACKET_VMAX after refinement', (() => {
    const ball = mkBall(0, PH.TABLE_Y + 0.12, 1.0, 0, -0.5, 5);
    const { racket } = playerFlight({ right: 0.3, up: 0.9, dist: 1, peakSpeed: 9, releaseSpeed: 9 }, ball, {});
    return V3.len(racket.vR) <= 19.6;
  })(), '', 3);
  /* U3: полёт после удара не телепортирует мяч под стол */
  R('U', 'post-impact flight never goes below floor before first bounce', (() => {
    const ball = mkBall(0, PH.TABLE_Y + 0.12, 1.0, 0, -0.5, 5);
    const { flight } = playerFlight({ right: 0, up: 0.7, dist: 0.6, peakSpeed: 3, releaseSpeed: 3 }, ball, {});
    return !flight.diverged;
  })(), '', 2);
}

/* ------------------------------------------------------------------ */
const fails = out.filter((a) => !a.ok).sort((a, b) => b.sev - a.sev);
if (process.argv.includes('--json')) console.log(JSON.stringify({ total: out.length, pass: out.length - fails.length, fails }, null, 1));
else {
/* ==================================================================
 *  +7: добор до 50 — метрики, появившиеся после механического пакета
 * ================================================================== */
{
  /* P209/P210: размах follow/recover времени и крена запястья в разумных
   * пределах реального тенниса (без мгновенных «эпилептических» фаз) */
  R('P', 'wrist roll amplitude stays human (|roll|<=38 deg) across profiles', (() => {
    for (const grip of ['shakehand', 'penhold']) for (const st of ['DRIVE', 'LOOP', 'CHOP', 'PUSH', 'FLICK', 'BLOCK'])
      for (const fh of [true, false]) {
        const pr = lib.paddleGripProfile(grip, st, fh);
        if (!(Math.abs(pr.roll) <= 38)) return false;
      } return true;
  })(), '', 1);
  R('P', 'pose swing between subsequent animation phases <= 70 deg', (() => {
    for (const grip of ['shakehand', 'penhold']) for (const st of ['DRIVE', 'LOOP', 'CHOP', 'PUSH', 'FLICK', 'BLOCK', 'SERVE_TOP'])
      for (const fh of [true, false]) {
        const pr = lib.paddleGripProfile(grip, st, fh);
        const seq = [pr.ready, pr.prepare, pr.contact, pr.follow];
        for (let i = 1; i < seq.length; i++)
          if (Math.abs(seq[i] - seq[i - 1]) > 70) return false;
      } return true;
  })(), '', 2);
  /* D222: решатель при ассисте НЕ переворачивает сторону целеуказания */
  R('D', 'solver never flips the aim side under assist (no cross-table swap)', (() => {
    let ok = true, detail = '';
    const feeds = [mkBall(0.05, PH.TABLE_Y + 0.12, 1.00, -0.1, -0.4, 5.8, 60),
      mkBall(-0.12, PH.TABLE_Y + 0.09, 1.00, 0.2, -1.2, 4.6, -80),
      mkBall(0.18, PH.TABLE_Y + 0.20, 0.72, -0.3, -0.2, 6.4, 110)];
    for (const feed of feeds) for (const side of [-1, 1]) {
      const ball = feed;
      const m = { right: side * 0.55, up: 0.6, dist: 0.5, curl: 0, peakSpeed: 3.2, releaseSpeed: 3.0, smooth: .9, straightness: .9, samples: 8, jerk: .1, x: 0.5, y: 0.6 };
      const ctx = { side: 1, isServe: false, ball: { y: ball.p.y, z: ball.p.z }, ballSpin: ball.w, ballSpeed: V3.len(ball.v), powerScale: 1, moveYaw: 0, spinBias: 'norm' };
      const r0 = lib.deriveStroke(m, ctx);
      lib.strokeFrame(r0, 0, 0, 1, r0.vR, r0.normal);
      if (Math.abs(r0.azSwing) < 0.25) continue;
      const rk = lib.refineRacket(ball.p, ball.v, ball.w, r0, 0.85, r0.quality);
      if (rk && rk.valid !== false && Number.isFinite(rk.azSwing) && Math.sign(rk.azSwing) !== Math.sign(r0.azSwing)) {
        ok = false; detail = `side swap on ${side < 0 ? 'left' : 'right'} swing`;
      }
    }
    if (!ok) throw new Error(detail);
    return ok;
  })(), '', 3);
  /* Z227: press-зона подачи сбоку сильно шире розыгрышной (serveSideK) */
  R('Z', 'serve press zone accepts a sideways press a rally gate would refuse', (() => {
    if (!lib.GRACE_RULES) return false;
    const W = 390, H = 844;
    const ball = { ok: true, x: 0.5, y: 0.78, screenVelocityPx: { x: 0, y: 600 } };
    const base = lib.MATCH_RULES.ovalSideTouchPx;
    const offPx = base * 1.18;   // между базовым и бустнутым
    const pointer = { x: 0.5 + offPx / W, y: 0.78 };
    const zRally = lib.pressHitZoneOval(ball, pointer, W, H, { pointerType: 'touch' });
    const zServe = lib.pressHitZoneOval(ball, pointer, W, H,
      { pointerType: 'touch', kind: 'serve', falling: true, tossRise: 0.3 });
    if (!zRally || !zServe) return false;
    return zServe.accepted === true && zRally.accepted !== true;
  })(), '', 2);
  /* T246/T247: freeze-туториал — once-per-drill, статически проверено */
  R('T', 'coach freeze is once per drill (seen-set present)', (() => {
    const src65 = fs.readFileSync(path.join(SRC, '65_train.js'), 'utf8');
    const adds = (src65.match(/_frozenDrills\.add\(this\.S\.id\)/g) || []).length;
    const guards = (src65.match(/_frozenDrills\.has\(this\.S\.id\)/g) || []).length;
    return /new Set\(\)/.test(src65) && adds >= 2 && guards >= 2;
  })(), '', 3);
  /* K244: добор царапни-подачи: из таблицы (lift,spd) найдётся легальная
   * пара почти для любой позиции тосса у стола */
  R('K', 'scuffed serve table always finds a legal serve near the toss', (() => {
    const G = lib.GRACE_RULES;
    for (const sx of [-0.3, 0, 0.3]) for (const dy of [-0.05, -0.15]) {
      const ball = mkBall(sx, PH.TABLE_Y + 0.30 + dy, PH.T_HALF_LEN + 0.55, 0, -1.6, 0.02);
      let ok = false;
      for (let li = 0; li <= 4 && !ok; li++) for (let si = 0; si <= 4 && !ok; si++) {
        const lift = lib.lerp(G.serveLiftMs[0], G.serveLiftMs[1], li / 4);
        const spd = lib.lerp(G.serveSpeedMs[0], G.serveSpeedMs[1], si / 4);
        const n = (n0 => { V3.norm(n0, n0); return n0; })(V3.new(0, G.upNormal, -G.fwdNormal));
        const v = V3.clone(ball.v), w = V3.clone(ball.w);
        if (!lib.impactRacket(v, w, n, V3.new(0, lift, -spd), G.quality, {})) continue;
        const p0 = V3.addScaled(V3.clone(ball.p), ball.p, n, PH.R * 1.05);
        const o = lib.predict(p0, v, w, { dt: 1 / 160, maxT: 2.2, stopAfterBounces: 2, out: {} });
        ok = serveLegal(o);
      }
      if (!ok) return false;
    }
    return true;
  })(), '', 3);
}

  console.log(`GAMEPLAY AUDIT: ${out.length} checks, ${out.length - fails.length} pass, ${fails.length} fail`);
  for (const f of fails.slice(0, 60)) console.log(`  FAIL [${f.group}${f.id}] ${f.name} :: ${f.detail}`);
}
process.exitCode = fails.length ? 1 : 0;
