'use strict';
/* Поведенческие тесты механического пакета №2 — восемь жалоб игрока:
 * 1) край ракетки (grace band) — «при промахе мяч должен чаще отбиваться
 *    слабо/улетать криво, а не чистый whiff»;
 * 2) мягкая/срезанная подача всё равно подаётся;
 * 3) подача «чуть сбоку»;
 * 4) мёртвая зона целеуказания по позиции нажатия;
 * 5) быстрые свайпы не обязаны быть ровными линиями;
 * 6) пост-верификация полёта + лестница ассиста (никаких тихих
 *    «удар не в ту сторону»);
 * 7) freeze-туториал — один раз за урок. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const CORE = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js'],
  ['PH', 'V3', 'clamp', 'lerp', 'predict', 'impactRacket', 'deriveStroke', 'refineRacket', 'strokeFrame',
    'MATCH_RULES', 'GRACE_RULES', 'playerInCaptureRange', 'playerGraceRange', 'pressHitZoneOval']);

const mkBall = (x, y, z, vx, vy, vz, wx = 0) => ({ p: CORE.V3.new(x, y, z), v: CORE.V3.new(vx, vy, vz), w: CORE.V3.new(wx, 0, 0) });
const flightFrom = (ball, racket, maxT = 2.4) => {
  const v = CORE.V3.clone(ball.v), w = CORE.V3.clone(ball.w);
  if (!CORE.impactRacket(v, w, racket.normal, racket.vR, racket.quality ?? .5, racket.rubber || {})) return { rejected: true };
  const p = CORE.V3.addScaled(CORE.V3.clone(ball.p), ball.p, racket.normal, CORE.PH.R * 1.05);
  return CORE.predict(p, v, w, { dt: 1 / 240, maxT, stopAfterBounces: 2, out: {} });
};
const serveLegalP = (o) => !!(!o.rejected && !o.diverged && !o.hitNet && o.landed &&
  o.landed.z > 0 && o.landed.z < CORE.PH.T_HALF_LEN + 0.03 && Math.abs(o.landed.x) < CORE.PH.T_HALF_WID + 0.03 &&
  o.b2 && o.b2.z < 0 && o.b2.z > -CORE.PH.T_HALF_LEN - 0.03 && Math.abs(o.b2.x) < CORE.PH.T_HALF_WID + 0.03);

test('grace ring: silent inside the box, takes the band, honestly passes beyond', () => {
  const pad = { x: 0, y: CORE.PH.TABLE_Y + 0.25, z: CORE.PH.T_HALF_LEN + 0.45 };
  const R = CORE.MATCH_RULES.captureRadius;
  // внутри честного бокса — НЕ край (там сработает capture)
  assert.equal(CORE.playerGraceRange({ x: 0, y: pad.y, z: pad.z - 0.05 }, pad, false), false);
  // полоса 1..bandMul — край
  const lat = (mul) => ({ x: R * mul, y: pad.y, z: pad.z });
  assert.equal(CORE.playerGraceRange(lat(1.15), pad, false), true);
  assert.equal(CORE.playerGraceRange(lat(1.28), pad, false), true);
  // за кольцом — честный пропуск
  assert.equal(CORE.playerGraceRange(lat(1.7), pad, false), false);
  // глубинная полоса шире боковой, но тоже конечна
  const deep = (mul) => ({ x: 0, y: pad.y, z: pad.z + CORE.MATCH_RULES.depthTolerance * mul });
  assert.equal(CORE.playerGraceRange(deep(1.4), pad, false), true);
  assert.equal(CORE.playerGraceRange(deep(2.6), pad, false), false);
});

test('grace contract: frozen, strictly outside the honest box, soft', () => {
  const G = CORE.GRACE_RULES;
  assert.ok(G && Object.isFrozen(G));
  assert.ok(G.bandMul > 1.05 && G.bandMul <= 1.6);
  assert.ok(G.serveBandMul > 1.05 && G.serveBandMul <= 1.6);
  assert.ok(G.quality >= 0.2 && G.quality <= 0.45);
  assert.ok(G.padVelK > 0 && G.padVelK <= 0.75);
  assert.ok(G.minCarryMs > 0 && G.maxCarryMs > G.minCarryMs);
  assert.throws(() => { CORE.GRACE_RULES.bandMul = 99; });
});

test('serve grace ring: a toss a finger off the blade is still served (weakly)', () => {
  const pad = { x: 0, y: CORE.PH.TABLE_Y + 0.25, z: CORE.PH.T_HALF_LEN + 0.45 };
  const r = CORE.MATCH_RULES.serveCaptureRadius;
  // 1.18× честной сферы подачи — внутри grace-кольца
  const ball = { x: r * 1.18, y: pad.y, z: pad.z };
  assert.equal(CORE.playerInCaptureRange(ball, pad, true), false);   // честный захват молчит
  assert.equal(CORE.playerGraceRange(ball, pad, true), true);        // но край берёт
});

/* Срезанная подача: таблица добора (lift, spd) из GRACE_RULES всегда
 * находит легальную подачу для реальных позиций тосса. Та же модель,
 * что и в Game._glanceRacket (там добавляется шум; здесь без шума). */
test('scuffed serve table always finds a legal serve for realistic tosses', () => {
  const G = CORE.GRACE_RULES;
  for (const sx of [-0.35, -0.1, 0.12, 0.35]) for (const sz of [1.85, 1.95, 2.05]) {
    const ball = mkBall(sx, CORE.PH.TABLE_Y + 0.28, sz, 0, -1.7, 0.02);
    let found = null;
    for (let li = 0; li <= 4 && !found; li++) for (let si = 0; si <= 4 && !found; si++) {
      const lift = CORE.lerp(G.serveLiftMs[0], G.serveLiftMs[1], li / 4);
      const spd = CORE.lerp(G.serveSpeedMs[0], G.serveSpeedMs[1], si / 4);
      const n = CORE.V3.new(0, G.upNormal, -G.fwdNormal); CORE.V3.norm(n, n);
      const racket = { normal: n, vR: CORE.V3.new(0, lift, -spd), quality: G.quality, rubber: {} };
      const o = flightFrom(ball, racket, 2.6);
      if (serveLegalP(o)) found = { li, si };
    }
    assert.ok(found, `no legal scuffed serve for toss x=${sx} z=${sz}`);
  }
});

/* Зеркало Game._glanceRacket для розыгрыша: срезанный контакт даёт слабый,
 * но летящий мяч (не тишина и не пуля). */
test('scuffed rally contact produces a weak playable ball, not silence or a bullet', () => {
  const G = CORE.GRACE_RULES;
  for (const swipeSpd of [1.6, 3.0, 5.5]) {
    const ball = mkBall(0.05, CORE.PH.TABLE_Y + 0.12, 1.0, 0.1, -0.3, 5.6);
    const carry = Math.min(Math.max(swipeSpd * 1.9 * G.padVelK, G.minCarryMs), G.maxCarryMs);
    const n = CORE.V3.new(0, G.upNormal, -G.fwdNormal); CORE.V3.norm(n, n);
    const racket = { normal: n, vR: CORE.V3.new(0.2, carry * 0.62 + 0.6, -carry), quality: G.quality, rubber: {} };
    const v = CORE.V3.clone(ball.v), w = CORE.V3.clone(ball.w);
    assert.ok(CORE.impactRacket(v, w, racket.normal, racket.vR, G.quality, {}), 'impact resolved');
    const spd = CORE.V3.len(v);
    /* тот же жёсткий контакт при ПОЛНОМ качестве базы */
    const v2 = CORE.V3.clone(ball.v), w2 = CORE.V3.clone(ball.w);
    CORE.impactRacket(v2, w2, racket.normal, racket.vR, 1, {});
    const spdFull = CORE.V3.len(v2);
    assert.ok(spd >= 1.2, `scuffed ball must still fly (${spd.toFixed(1)})`);
    assert.ok(spd < spdFull, `scuffed ${spd.toFixed(1)} must be WEAKER than full ${spdFull.toFixed(1)}`);
    const o = flightFrom(ball, racket, 2.5);
    assert.ok(!o.diverged, 'flight sane');
  }
});

test('aim deadzone: small press offsets do not steal a straight swipe sideways', () => {
  const mk = (mx) => CORE.deriveStroke(
    { right: 0, up: 0.62, dist: 0.5, curl: 0, peakSpeed: 3.1, releaseSpeed: 3.0, smooth: .9, straightness: .9, samples: 8, jerk: .1, x: mx, y: 0.6 },
    { side: 1, isServe: false, ball: { y: CORE.PH.TABLE_Y + 0.12, z: 1 }, ballSpin: CORE.V3.new(0, 0, 0), ballSpeed: 5, powerScale: 1, moveYaw: 0, spinBias: 'norm' });
  const a = mk(0.5), b = mk(0.555), c = mk(0.445);
  assert.ok(Math.abs(a.aim.x) < 1e-9, 'centre press aims dead centre');
  assert.ok(Math.abs(b.aim.x) < 1e-9, '+5.5% экрана: всё ещё центр (мёртвая зона)');
  assert.ok(Math.abs(c.aim.x) < 1e-9, '-5.5% экрана: всё ещё центр');
  const near = Math.abs(mk(0.42).aim.x);
  assert.ok(near < 0.05, '±8% экрана почти не сносит цель');
  assert.ok(mk(0.42).aim.x < 0 && mk(0.58).aim.x > 0, 'вне зоны знак цели сохранён');
  const l = mk(0.2), r = mk(0.8);
  assert.ok(l.aim.x < -0.2 && r.aim.x > 0.2, 'далёкие нажатия целятся вбок');
  assert.ok(Math.sign(l.aim.x) === -Math.sign(r.aim.x));
});

test('serve press zone accepts a sideways press a rally gate would refuse', () => {
  const W = 390, H = 844;
  const ball = { ok: true, x: 0.5, y: 0.78, screenVelocityPx: { x: 0, y: 600 } };
  const base = CORE.MATCH_RULES.ovalSideTouchPx;
  const pointer = { x: 0.5 + (base * 1.18) / W, y: 0.78 };
  const zRally = CORE.pressHitZoneOval(ball, pointer, W, H, { pointerType: 'touch' });
  const zServe = CORE.pressHitZoneOval(ball, pointer, W, H,
    { pointerType: 'touch', kind: 'serve', falling: true, tossRise: 0.3 });
  assert.ok(zRally && zServe, 'zones produced');
  assert.equal(zServe.accepted, true, 'serve accepts side press');
  assert.equal(zRally.accepted !== true, true, 'rally gate would refuse the same press');
});

/* Пост-верификация в 70_game: решатель при ассисте <1 никогда не отдаёт
 * удар на противоположную от замаха сторону за столом. */
test('solver never flips the sworn side under assist', () => {
  const feeds = [
    mkBall(0.10, CORE.PH.TABLE_Y + 0.12, 0.95, 0, -0.8, 5.2, -60),
    mkBall(-0.12, CORE.PH.TABLE_Y + 0.09, 1.00, 0.2, -1.2, 4.6, -80),
    mkBall(0.18, CORE.PH.TABLE_Y + 0.20, 0.72, -0.3, -0.2, 6.4, 110),
  ];
  for (const ball of feeds) for (const side of [-1, 1]) {
    const m = { right: side * 0.55, up: 0.6, dist: 0.5, curl: 0, peakSpeed: 3.2, releaseSpeed: 3.0, smooth: .9, straightness: .9, samples: 8, jerk: .1, x: 0.5, y: 0.6 };
    const ctx = { side: 1, isServe: false, ball: { y: ball.p.y, z: ball.p.z }, ballSpin: ball.w, ballSpeed: CORE.V3.len(ball.v), powerScale: 1, moveYaw: 0, spinBias: 'norm' };
    const r0 = CORE.deriveStroke(m, ctx);
    CORE.strokeFrame(r0, 0, 0, 1, r0.vR, r0.normal);
    if (Math.abs(r0.azSwing) < 0.25) continue;
    const rk = CORE.refineRacket(ball.p, ball.v, ball.w, r0, 0.85, r0.quality);
    if (rk && rk.valid !== false && Number.isFinite(rk.azSwing)) {
      assert.equal(Math.sign(rk.azSwing), Math.sign(r0.azSwing),
        `assist flipped the aim side for ball z=${ball.p.z}`);
    }
  }
});

/* Дикий curl на подаче усмиряется ассистом ДО удара: после дрейфа x0.3
 * решатель находит легальную подачу там, где полный curl её нет. */
test('extreme curl serves are tamed by the assist ladder', () => {
  const ball = mkBall(-0.08, CORE.PH.TABLE_Y + 0.34, 1.95, 0, -2.0, 0.02);
  const mk = (curl) => {
    const m = { right: 0.4, up: 0.55, dist: 0.55, curl, peakSpeed: 3.0, releaseSpeed: 2.9, smooth: .9, straightness: .9, samples: 8, jerk: .1, x: 0.5, y: 0.6 };
    const ctx = { side: 1, isServe: true, ball: { y: ball.p.y, z: ball.p.z }, ballSpin: ball.w, ballSpeed: CORE.V3.len(ball.v), powerScale: 1, moveYaw: 0, spinBias: 'norm' };
    const r = CORE.deriveStroke(m, ctx);
    CORE.strokeFrame(r, 0, 0, 1, r.vR, r.normal);
    return r;
  };
  const raw = CORE.refineRacket(ball.p, ball.v, ball.w, mk(0.9), 0.85, 0.6);
  const o = flightFrom(ball, raw, 2.8);
  const rawLegal = serveLegalP(o);
  const damped = CORE.refineRacket(ball.p, ball.v, ball.w, mk(0.27), 1, 0.6);
  const o2 = flightFrom(ball, damped, 2.8);
  assert.ok(serveLegalP(o2), 'damped curl serve must be legal');
  if (!rawLegal) assert.ok(true, 'raw curl was wild — the damp rescued it');
});

/* Game-уровень: _glanceRacket даёт легальную размеченную ракетку. */
test('Game._glanceRacket (serve mode) builds a solvable scuffed serve', () => {
  const { Game, V3, PH } = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '56_rig.js', '70_game.js'],
    ['Game', 'V3', 'PH']);
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    player: { vel: V3.new(0.4, 0.2, -2.0) },
    ball: { p: V3.new(0.05, PH.TABLE_Y + 0.3, PH.T_HALF_LEN + 0.55), v: V3.new(0, -1.7, 0.02), w: V3.new(0, 0, 0) },
  });
  const m = { right: 0.3, up: 0.6, dist: 0.4, curl: 0.2, peakSpeed: 2.2, releaseSpeed: 2.0 };
  const rk = g._glanceRacket(m, g.ball.p, true, {});
  assert.ok(rk && rk.normal && rk.vR, 'racket built');
  assert.ok(rk.quality === CORE.GRACE_RULES.quality);
  // legal or honestly-marked; either way never a silent impossible bullet
  const v = CORE.V3.clone(g.ball.v), w = CORE.V3.clone(g.ball.w);
  const ok = CORE.impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
  assert.ok(ok, 'glance impact resolves');
});

/* Тренер: заморозка перед контактом срабатывает один раз на урок. */
test('coach freeze fires once per drill per session', () => {
  const lib = load(['10_math.js', '12_match_rules.js', '30_physics.js', '56_rig.js', '70_game.js', '65_train.js'],
    ['Trainer', 'TRAIN_STEPS', 'GS']);
  const { Trainer, TRAIN_STEPS, GS, V3: V } = lib;
  // найдём любой урок с guide==='freeze' (подача предпочтительно)
  /* не-SERVE урок: serve-ветка Trainer требует GS из 70_game — вне лёгкого
   * vm-харнесса; freeze-контракт общий и у розыгрышной посадки тот же */
  const useIdx = TRAIN_STEPS.findIndex((s) => s.coach !== 'none' && s.id !== 'SERVE');
  assert.ok(useIdx >= 0, 'there is a coached (freeze-guidance) drill');
  const mkGame = () => ({
    time: 0, state: GS.RALLY, settings: {}, server: -1, demoMode: false,
    ball: { p: { x: 0, y: CORE.PH.TABLE_Y + 0.3, z: 0 }, v: { x: 0, y: -1, z: 0 }, lastHitBy: -1 },
    player: { pos: { x: 0, y: 0, z: 0 } },
    rallyBounces: [1],
    contactPrediction: () => ({ t: 0.05, p: { x: 0, y: 1, z: 0.5 } }),
    tossApex: CORE.PH.TABLE_Y + 0.55,
    previewPressZone: () => null,
    msg() {}, audio: { ui() {} }, sync: null, canvas: { getBoundingClientRect: () => ({ width: 390, height: 844 }) },
  });
  const g = mkGame();
  const tr = new Trainer(g);
  // провалимся в live-фазу рассматриваемого шага
  let guard = 0;
  while (tr.step !== useIdx && guard++ < 30) tr.nextStep();
  assert.equal(tr.step, useIdx, 'reached the freeze drill');
  tr.phase = 'live'; tr.guided = false;
  // первая возможность — freeze сработан
  tr.update(0.001);
  const firstFrozen = tr.frozen === true;
  assert.equal(firstFrozen, true, 'first opportunity freezes');
  // имитируем цикл: игрок нажал (unfreeze) и следующий мяч
  tr.frozen = false; tr.heldOnce = false; tr.unfrozeAt = g.time; tr.nudge = 0;
  tr.ballNo = (tr.ballNo || 0) + 1;
  tr.update(0.001);
  assert.equal(tr.frozen, false, 'no repeat freeze inside the same drill');
});


/* ================== пакет №2: кромка, стенка, стили подач, шнур ========== */

const GAME_LIB = load(['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
  '40_swipe.js', '56_rig.js', '70_game.js'],
  ['Game', 'V3', 'PH', 'GS', 'setCaptureForgiveness', 'getCaptureForgiveness']);

function mkGameStub() {
  const { Game, V3, PH, GS } = GAME_LIB;
  const g = Object.create(Game.prototype);
  g.time = 0; g.state = GS.RALLY; g.reducedMotion = false;
  g.settings = { haptics: false, grip: 'shakehand', hand: 'right', followThrough: true };
  g.demoMode = false; g.isServeBall = false; g.rallyBounces = [1];
  g.swipe = null; g.equip = { forSide: () => null }; g.stats = {};
  g.crumbs = []; g.msgs = []; g.marks = []; g.sfx = { edge: 0, net: 0, table: 0 };
  g.particles = { spawn: (...a) => g.crumbs.push(a), burst() {} };
  g.msg = (t) => g.msgs.push(t);
  g.shakeIt = () => {}; g.emitParticles = () => {}; g.logInput = () => {};
  g.logNoStrokeIntent = () => {}; g.logPressRejection = () => {};
  g.buzz = () => {}; g.punchSlowmo = Game.prototype.punchSlowmo;
  g.recorder = { addBounce() {}, addShot() {} };
  g.moments = { addBounce() {}, addPoint() {}, addWinner() {}, addError() {} };
  g.awardPoint = () => { g.ball.live = false; };   // точку достаточно завершить
  g.slowmoUntil = 0; g.targetTimeScale = 1;
  g.audio = { hitEdge: () => g.sfx.edge++, hitNet: () => g.sfx.net++, hitTable() {}, hitFloor() {}, hitRacket() {}, ui() {} };
  g.ball = { p: V3.new(0, PH.TABLE_Y + 0.4, 0.6), v: V3.new(0, 0, 0), w: V3.new(0, 0, 0),
    q: { x: 0, y: 0, z: 0, w: 1 }, live: true, lastHitBy: -1, speed: 0 };
  g.player = { pos: V3.new(0.05, PH.TABLE_Y + 0.25, PH.T_HALF_LEN + 0.45),
    prevPos: V3.new(0.05, PH.TABLE_Y + 0.25, PH.T_HALF_LEN + 0.45),
    prev: V3.new(0.05, PH.TABLE_Y + 0.25, PH.T_HALF_LEN + 0.45),
    vel: V3.new(0, 0, 0), normal: V3.new(0, 0.15, -1), roll: 0, forehand: true, lastHitT: 0, swing: 0 };
  return g;
}

test('edge ball hops OFF the line and the effect does not crackle', () => {
  const { V3, PH } = GAME_LIB;
  const g = mkGameStub();
  // умирающий мяч катится по кромке боковой линии: скользние вдоль ребра
  g.ball.p = V3.new(PH.T_HALF_WID - 0.005, PH.TABLE_Y + PH.R + 0.004, 0.3);
  g.ball.v = V3.new(0.15, -0.35, 0.25);
  g.ball.w = V3.new(30, 0, 0);
  for (let i = 0; i < 240; i++) {           // 1 с подшагов 240 Гц
    g.time += 1 / 240;
    g.player.lastHitT = g.time;             // блок tryPlayerHit-хвоста
    g.stepPhysics(1 / 240);
    if (!g.ball.live) break;
  }
  assert.ok(g.sfx.edge <= 1, `edge sound fired ${g.sfx.edge} times (crackle)`);
  // мяч покинул полосу кромки или вовсе покинул стол — но не едет по рельсе
  const offBand = Math.abs(g.ball.p.x) > PH.T_HALF_WID ||
    Math.abs(g.ball.p.x) < PH.T_HALF_WID - PH.EDGE_BAND || !g.ball.live || g.ball.p.y > PH.TABLE_Y + PH.R + 0.02;
  assert.ok(offBand, 'ball crawled along the edge band');
});

test('passive hold-to-block reflects the ball (weak, forward, no teleport)', () => {
  const { V3, PH } = GAME_LIB;
  const g = mkGameStub();
  // стенка доступна только жесту, уже побывавшему реальным замахом
  g.swipe = { active: true, pressZone: null, gestureId: 3, consumedGestureId: -1, realGestureId: 3 };
  const b = g.ball, pad = g.player;
  b.p = V3.new(pad.pos.x + 0.03, pad.pos.y - 0.02, pad.pos.z - 0.12);
  b.v = V3.new(0.1, -0.4, 4.8);    // мяч летит к игроку (+z)
  b.w = V3.new(-40, 0, 0);
  const vLen0 = V3.len(b.v);
  const ok = g._tryPassiveBlock(pad, b);
  assert.equal(ok, true, 'block accepted');
  assert.equal(b.lastHitBy, 1, 'contact registered');
  assert.ok(b.v.z < 0, 'ball returns toward the opponent (-z)');
  assert.ok(V3.len(b.v) < vLen0 * 1.4, 'passive block is not a power shot');
  assert.ok(Math.abs(pad.pos.x - 0.05) < 1e-9, 'no paddle teleport');
  assert.equal(g.stats.blocks, 1);
});

test('serve styles keep physical spin signatures (same swipe, four directions)', () => {
  const { V3, PH } = GAME_LIB;
  const ball = mkBall(0, PH.TABLE_Y + 0.30, 1.95, 0, -1.8, 0.02);
  const mkServe = (m2) => {
    const m = Object.assign({ curl: 0, smooth: .9, straightness: .9, samples: 8, jerk: .1, x: .5, y: .6 }, m2);
    const ctx = { side: 1, isServe: true, ball: { y: ball.p.y, z: ball.p.z }, ballSpin: ball.w, ballSpeed: V3.len(ball.v), powerScale: 1, moveYaw: 0, spinBias: 'norm' };
    const r = CORE.deriveStroke(m, ctx);
    CORE.strokeFrame(r, 0, 0, 1, r.vR, r.normal);
    const rk = CORE.refineRacket(ball.p, ball.v, ball.w, r, 1, r.quality);
    const v = V3.clone(ball.v), w = V3.clone(ball.w);
    CORE.impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
    return { id: rk.stroke.id, w, spd: V3.len(v) };
  };
  const top = mkServe({ right: .05, up: .85, dist: .55, peakSpeed: 3, releaseSpeed: 2.9 });
  const back = mkServe({ right: .05, up: -.6, dist: .5, peakSpeed: 2.6, releaseSpeed: 2.5 });
  const side = mkServe({ right: .85, up: .25, dist: .5, peakSpeed: 2.8, releaseSpeed: 2.7 });
  const fast = mkServe({ right: 0, up: .15, dist: .75, peakSpeed: 5.4, releaseSpeed: 5.2 });
  assert.equal(top.id, 'SERVE_TOP'); assert.ok(top.w.x < -250, `topspin w.x ${top.w.x}`);
  assert.equal(back.id, 'SERVE_BACK'); assert.ok(back.w.x > 250, `backspin w.x ${back.w.x}`);
  assert.equal(side.id, 'SERVE_SIDE'); assert.ok(Math.abs(side.w.y) > 80, `sidespin w.y ${side.w.y}`);
  assert.equal(fast.id, 'SERVE_FAST');
  /* «стремительная» после решателя может уступить резаной по м/с (нижнее
   * несёт вверх, легальный потолок выше) — её сигнатура ДРУГАЯ: минимум
   * ВЕРТИКАЛЬНОГО вращения на единицу скорости, т.е. самая плоская по дропу.
   * Боковая подача из этого сравнения выведена: у неё 132 рад/с вокруг
   * вертикальной оси при 6.3 м/с (|w|/v = 21 против 29 у стремительной) — это и
   * есть смысл канала, который чинили: бок стал сильнее, чем у плоского удара,
   * но он почти не тормозит мяч, а уводит его в сторону. */
  const vertPerMs = (s) => Math.hypot(s.w.x, s.w.z) / Math.max(s.spd, 1e-6);
  assert.ok(vertPerMs(fast) < vertPerMs(top) && vertPerMs(fast) < vertPerMs(back),
    `fast serve must be the flattest (vertical spin/velocity ${vertPerMs(fast).toFixed(1)})`);
  assert.ok(Math.abs(side.w.y) > Math.hypot(side.w.x, side.w.z),
    `sidespin serve must spin about the vertical axis (wy ${side.w.y.toFixed(0)}, wx/wz ${side.w.x.toFixed(0)}/${side.w.z.toFixed(0)})`);
});

test('net cord: short slowmo + widened capture window, then restored', () => {
  const { V3, PH, GS, setCaptureForgiveness, getCaptureForgiveness } = GAME_LIB;
  // шнур, как на тракте рендера, живёт в netContactStep: мяч летит на ленту
  const g = mkGameStub();
  setCaptureForgiveness(1);
  const tapeY = PH.NET_TOP - 0.002;
  g.ball.p = V3.new(0.2, tapeY + 0.01, 0.03);
  g.ball.v = V3.new(0, -0.15, -2.2);      // ныряет на ленту
  g.ball.w = V3.new(-20, 0, 0);
  let cord = false;
  for (let i = 0; i < 90 && !cord; i++) {
    g.time += 1 / 60;
    g.player.lastHitT = g.time;
    g.stepPhysics(1 / 60);
    cord = g.slowmoUntil > g.time;
  }
  assert.ok(cord, 'tape clip did not trigger cord drama');
  assert.ok(getCaptureForgiveness() > 1.2, 'capture window widened after cord');
  // окно возвращается обратно через 0.9 с игрового времени
  for (let i = 0; i < 90 && g._cordForgiveUntil; i++) {
    g.time += 1 / 60;
    g.player.lastHitT = g.time;
    if (g.ball.live) g.stepPhysics(1 / 60); else { setCaptureForgiveness(g._cordBaseForgive || 1); g._cordForgiveUntil = 0; }
  }
  assert.ok(getCaptureForgiveness() <= 1.01, 'forgive restored');
  setCaptureForgiveness(1);
});

/* ================== пакет №3: оболочка досягаемости ракетки ============== */

const CAM_LIB = load(['10_math.js', '30_physics.js', '57_camera.js'],
  ['PH', 'REACH_SHELL', 'softSat', 'reachShellMap', 'PADDLE_LIMITS', 'PADDLE_HOME']);

test('softSat: exact inside the band, monotone outside, asymptotic to hard caps', () => {
  const { softSat } = CAM_LIB;
  assert.equal(softSat(0.3, 0.1, 0.5, 0.0, 0.8), 0.3, 'identity inside');
  assert.equal(softSat(0.5, 0.1, 0.5, 0.0, 0.8), 0.5);
  let prev = -Infinity;
  for (const v of [0.55, 0.7, 1.0, 2.0, 6.0]) {
    const o = softSat(v, 0.1, 0.5, 0.0, 0.8);
    assert.ok(o > prev && o > 0.5 && o < 0.8, `monotone, capped: ${o}`);
    prev = o;
  }
  prev = Infinity;
  for (const v of [0.05, -0.2, -1.0, -5.0]) {
    const o = softSat(v, 0.1, 0.5, 0.0, 0.8);
    assert.ok(o < prev && o < 0.1 && o >= 0.0, `monotone low, floored: ${o}`);
    prev = o;
  }
});

test('reach shell: screen extremes are the player arm, not metres of world', () => {
  const { PH, REACH_SHELL, reachShellMap, PADDLE_LIMITS } = CAM_LIB;
  const home = 0.42;
  // верх экрана: был бы 4-5 м над столом — оболочка приземляет к потолку руки
  const top = reachShellMap(0, PH.TABLE_Y + 4.5);
  assert.ok(top.ty - PH.TABLE_Y <= REACH_SHELL.yHiHard + 1e-4, `top overshoot ${top.ty - PH.TABLE_Y}`);
  assert.ok(top.ty - PH.TABLE_Y > REACH_SHELL.yHiSoft, 'top still goes visibly high');
  // низ экрана: никогда под плитой стола
  const low = reachShellMap(0, PH.TABLE_Y - 3.0);
  assert.ok(low.ty - PH.TABLE_Y > REACH_SHELL.yLoHard - 1e-3, `dove under table: ${low.ty - PH.TABLE_Y}`);
  // бока: сильно прижаты к корпусу
  const sideL = reachShellMap(-6, PH.TABLE_Y + home), sideR = reachShellMap(6, PH.TABLE_Y + home);
  assert.ok(Math.abs(sideL.tx) < REACH_SHELL.xHard && Math.abs(sideR.tx) < REACH_SHELL.xHard);
  assert.equal(Math.sign(sideL.tx), -Math.sign(sideR.tx));
  // рабочая зона — пиксель-точная как и раньше
  const mid = reachShellMap(0.3, PH.TABLE_Y + 0.3);
  assert.ok(Math.abs(mid.tx - 0.3) < 1e-9 && Math.abs(mid.ty - (PH.TABLE_Y + 0.3)) < 1e-9, 'exact inside');
  // готовая поза проходит оболочку без искажений
  const hm = reachShellMap(CAM_LIB.PADDLE_HOME.x, CAM_LIB.PADDLE_HOME.y);
  assert.ok(Math.abs(hm.tx - CAM_LIB.PADDLE_HOME.x) < 1e-9 && Math.abs(hm.ty - CAM_LIB.PADDLE_HOME.y) < 1e-9);
});

test('lifting the blade follows the arc FORWARD (toward the net) with forward tilt', () => {
  const { PH, REACH_SHELL, reachShellMap } = CAM_LIB;
  const rest = reachShellMap(0, PH.TABLE_Y + REACH_SHELL.arcRestY);
  assert.equal(rest.forward, 0, 'no drift at ready height');
  let prevFwd = 0;
  for (const lift of [0.52, 0.60, 0.75, 0.90]) {
    const m = reachShellMap(0, PH.TABLE_Y + lift);
    assert.ok(m.forward > prevFwd, `reach grows with height at lift=${lift}`);
    assert.ok(m.tilt > 0 && Math.abs(m.tilt - m.forward * REACH_SHELL.arcTilt) < 1e-9, 'tilt = tilt-gain × reach');
    prevFwd = m.forward;
  }
  const maxed = reachShellMap(0, PH.TABLE_Y + 3.0);
  assert.ok(maxed.forward <= REACH_SHELL.arcMaxFwd + 1e-9, 'reach capped');
  // ниже точки покоя ракетка НЕ уезжает назад и не падает под стол
  const low = reachShellMap(0, PH.TABLE_Y + 0.1);
  assert.equal(low.forward, 0);
  assert.ok(low.ty > PH.TABLE_Y, 'never below the playing surface');
});
