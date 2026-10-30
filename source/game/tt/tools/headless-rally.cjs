#!/usr/bin/env node
/* ===================================================================== *
 *  HEADLESS RALLY — прогон сторожа на настоящем ИИ без браузера.
 *
 *  5 уровней × 200 ударов. Каждый удар — это НАСТОЯЩИЙ путь бота:
 *  think() → commit → swing() → refineRacket/_ensureLegal/applyExecutionError,
 *  затем impactRacket и полёт на живом интеграторе с отскоками от стола и
 *  сетки. Сторож кормится ровно теми же вызовами, что и в игре
 *  (substep / contact / stroke / frame), а кадровая проверка видимости
 *  считает проекцию настоящей камерой (cameraRigFor + rigViewProj).
 *
 *  Гейты (любой ненулевой счётчик — провал):
 *    · BALL_THROUGH_RACKET на клинке бота — 0
 *    · RACKET_UNDER_TABLE в кадре            — 0
 *    · SPEED_CEILING                         — 0
 *  Плюс печатает крайние значения: замах бота против его потолка, скорость
 *  мяча, сколько ударов бот отклонил сам (это законно) и стоимость сторожа.
 *
 *  node tt/tools/headless-rally.cjs [--json] [--strokes=200] [--levels=5]
 * ===================================================================== */
'use strict';
const path = require('node:path');
const { load } = require('../../tests/helpers.cjs');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const numArg = (name, dflt) => {
  const a = argv.find(x => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : dflt;
};
const STROKES = Math.max(1, numArg('strokes', 200));

const lib = load([
  '10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js',
  '55_ai.js', '57_camera.js', '46_physics_watchdog.js',
], [
  'PH', 'V3', 'predict', 'integrateBall', 'impactRacket', 'bounceTable', 'netContactKind',
  'OpponentAI', 'AI_LEVELS', 'PhysicsWatchdog', 'cameraRigFor', 'rigViewProj', 'projectPoint',
  'STROKE_CONFIG', 'MATCH_RULES', 'clipTape', 'keepPaddleAboveTable', 'paddleLimitsFor',
  'PADDLE_STANCE_Z',
]);

const { PH, V3, OpponentAI, AI_LEVELS, PhysicsWatchdog } = lib;
/* В движке ровно столько уровней, сколько объявлено в AI_LEVELS: гоняем по
 * всем (сейчас четыре), а не по выдуманному числу. */
const LEVELS = Math.max(1, Math.min(AI_LEVELS.length, numArg('levels', AI_LEVELS.length)));

/* Детерминированный поток: без него «ноль тикетов» не воспроизвести. */
let seed = 0x2f6e2b1;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const rndSym = (k) => (rnd() * 2 - 1) * k;
const rand = (a, b) => a + (b - a) * rnd();

/* Камера ровно та же, что у игры: game.project() = rigViewProj + projectPoint. */
const VIEW = { w: 1280, h: 760 };
const aspect = VIEW.w / VIEW.h;
const rig = lib.cameraRigFor('BROADCAST', null, aspect);
const vp = lib.rigViewProj(rig, aspect);
const project = (p) => lib.projectPoint(vp, p, {});

const GRAVITY_DT = 1 / 600;
const TABLE_Y = PH.TABLE_Y, BALL_R = PH.R;

/* Входящий мяч обязан быть ИГРАБЕЛЬНЫМ: он должен лечь на половину бота.
 * Иначе бот честно отказывается бить (computePlan → null), и прогон
 * проверял бы его вежливость, а не физику. */
const launchProbe = {};
function freshBall() {
  for (let k = 0; k < 64; k++) {
    const b = {
      p: V3.new(rand(-0.7, 0.7), rand(1.05, 1.5), rand(1.0, 1.7)),
      v: V3.new(rndSym(1.2), rand(-0.6, 1.0), -rand(5.5, 11)),
      w: V3.new(rndSym(180), rndSym(40), rndSym(40)),
      live: true, lastHitBy: 1, speed: 0,
    };
    lib.predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
      { dt: 1 / 240, maxT: 2.4, out: launchProbe });
    if (launchProbe.landed && launchProbe.landed.z < -0.1 && Math.abs(launchProbe.landed.x) < PH.T_HALF_WID &&
        launchProbe.landed.z > -(PH.T_HALF_LEN + 0.05)) return b;
  }
  return null;
}

function makeStub(aiPos) {
  return {
    time: 0, strokeTime: 0, shotId: 1, rally: 5, netTouched: false,
    state: 'RALLY', isServeBall: false,
    ai: { pos: V3.new(0, PH.TABLE_Y + 0.25, -1.45), lastShot: null },
    player: { pos: { x: 0, y: 1.05, z: 1.55 } },
    settings: { hand: 'right' },
    stats: { aiShots: 0 },
    ball: null,
  };
}

/* Один удар бота целиком: подлёт → замах → контакт → полёт отскока.
 * Каждый подшаг идёт через тот же интегратор, что в игре, отскоки — через
 * bounceTable/clipTape, а сторож кормится ровно как в 70_game.js. */
/* Клинок бота двигается как в игре: по горизонтали — к прогнозу точки
 * встречи на его плоскости, по вертикали — по высоте мяча, с лимитами
 * depth-зависимые (paddleLimitsFor) и скоростью уровня (AI_LEVELS.move).
 * Сглаживание экспоненциальное, как ai._moveSmooth: ровно поэтому позы
 * разные от кадра к кадру, а не один замороженный вектор. */
const _q = {};
const REACH_X = 1.12;
function moveBlade(stub, ball, dt, level) {
  const ai = stub.ai.pos;
  const stopZ = Math.max(-2.05, Math.min(-1.05, ai.z));
  lib.predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w),
    { dt: 1 / 240, maxT: 2.4, stopZ, stopDir: -1, stopAtPlane: true, out: _q });
  const aim = _q.end && Number.isFinite(_q.end.x) ? _q.end : ball.p;
  const lim = lib.paddleLimitsFor(stopZ);
  let tx = Math.max(-Math.min(REACH_X, lim.x), Math.min(REACH_X, lim.x, aim.x));
  let ty = Math.max(PH.TABLE_Y + Math.max(0.18, lim.yLo),
    Math.min(PH.TABLE_Y + Math.min(0.96, lim.yHi), aim.y));
  let tz = stopZ;
  const rate = Math.max(2, Math.min(12, level.move * 2.5));
  const k = 1 - Math.exp(-rate * dt);
  ai.x += (tx - ai.x) * k;
  ai.y += (ty - ai.y) * k;
  ai.z += (tz - ai.z) * k * 0.9;
  lib.keepPaddleAboveTable(ai, { x: 0, y: -0.1, z: 1 }, 0, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN);
  return { x: ai.x, y: ai.y, z: ai.z };
}

function strokeOnce(w, ball, stub, levelIndex, ai, stats) {
  const oppPad = { pos: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
  let prevOpp = { x: ai.pos.x, y: ai.pos.y, z: ai.pos.z };
  let t = stub.time;
  const frameDt = 1 / 60;
  let accFrame = 0;
  let swung = false;
  let hitSeq = 0;
  let botBounce = false;
  const contact = V3.new();

  for (let i = 0; i < 600 * 3 && ball.live; i++) {
    const p0 = V3.clone(ball.p);
    lib.integrateBall(ball.p, ball.v, ball.w, GRAVITY_DT);
    t += GRAVITY_DT;
    ball.speed = V3.len(ball.v);
    if (ball.speed > stats.maxBallSpeed) stats.maxBallSpeed = ball.speed;
    if (ball.p.y > stats.maxBallY) stats.maxBallY = ball.p.y;
    const ax = Math.abs(ball.p.x), az = Math.abs(ball.p.z);
    if (ax > stats.maxX) stats.maxX = ax;
    if (az > stats.maxZ) stats.maxZ = az;

    /* стол */
    if (ball.v.y < 0 && ball.p.y <= TABLE_Y + BALL_R && ball.p.y > TABLE_Y - 0.25 &&
        Math.abs(ball.p.x) <= PH.T_HALF_WID + BALL_R && Math.abs(ball.p.z) <= PH.T_HALF_LEN + BALL_R) {
      ball.p.y = TABLE_Y + BALL_R + 1e-5;
      const bt = lib.bounceTable(ball.p, ball.v, ball.w);
      w.tableContact({ time: t, edge: bt ? bt.edge : 0, edgeAxis: bt && bt.edgeAxis,
        side: Math.sign(ball.p.z) || 1, speed: Math.abs(ball.v.y) });
      if (ball.p.z < 0) botBounce = true;
      stats.bounces++;
    }
    /* сетка */
    if (p0.z * ball.p.z <= 0 && Math.abs(ball.p.z) < 0.2 && ball.p.y < PH.NET_TOP + BALL_R) {
      lib.clipTape(ball.p, ball.v, ball.w);
      stats.nets++;
    }

    /* поза клинка бота: та, которой он будет бить (ai.pos) */
    V3.copy(oppPad.pos, stub.ai.pos);
    const nn = { x: 0.4, y: -0.1, z: 1 };
    const l = Math.hypot(nn.x, nn.y, nn.z);
    oppPad.normal = { x: nn.x / l, y: nn.y / l, z: nn.z / l };

    w.substep({ dt: GRAVITY_DT, time: t, p0, p1: ball.p, ball,
      opp: { pad: oppPad, padPrev: prevOpp, hitRadius: 0.152 },
      pad: { pos: { x: 0, y: 1.05, z: 1.55 }, normal: { x: 0, y: 0, z: -1 } },
      padPrev: { x: 0, y: 1.05, z: 1.55 }, hitRadius: 0.152, hitSeq });

    accFrame += GRAVITY_DT;
    if (accFrame >= frameDt) {
      accFrame -= frameDt;
      stub.time += frameDt; stub.strokeTime += frameDt;
      ai.think(stub, frameDt);
      moveBlade(stub, ball, frameDt, lib.AI_LEVELS[levelIndex] || { move: 3 });
      stats.poses.add(`${stub.ai.pos.x.toFixed(3)},${stub.ai.pos.y.toFixed(3)},${stub.ai.pos.z.toFixed(3)}`);
      /* ровно условия 70_game.watchdogArmFrame: план есть, мяч летит к боту,
       * уже отскочил на его половине и ещё перед ним */
      w.armOpponent(!!(ai.commit && ball.live && ball.lastHitBy === 1 && botBounce &&
        ball.p.z > stub.ai.pos.z - 0.02),
        { shotId: stub.shotId, stroke: ai.commit ? ai.commit.archId : null, aiLevel: levelIndex });
      prevOpp = { x: oppPad.pos.x, y: oppPad.pos.y, z: oppPad.pos.z };

      /* бот бьёт только там, где мяч реально рядом (как tryAiHit) */
      if (!swung && ball.p.z < 0.2 && V3.dist(ball.p, stub.ai.pos) <= 0.42) {
        const racket = ai.swing(stub);
        if (racket) {
          const before = { v: V3.clone(ball.v), w: V3.clone(ball.w) };
          const info = lib.impactRacket(ball.v, ball.w, racket.normal, racket.vR,
            racket.quality, racket.rubber || {});
          if (info) {
            V3.copy(contact, ball.p);
            const vmag = Number.isFinite(racket.vmag) ? racket.vmag : V3.len(racket.vR);
            const limit = w.speedLimit({ side: -1, strokeId: (racket.stroke && racket.stroke.id) || null, aiLevel: levelIndex });
            stats.maxVmag = Math.max(stats.maxVmag, vmag);
            const L = lib.AI_LEVELS[levelIndex];
            if (L && L.vmagMax > 0) stats.maxVmagVsLevel = Math.max(stats.maxVmagVsLevel, vmag / L.vmagMax);
            if (limit > 0) stats.maxVmagRatio = Math.max(stats.maxVmagRatio, vmag / limit);
            w.contact({ time: t, side: -1, serve: false, aiLevel: levelIndex,
              contact, pad: { pos: stub.ai.pos }, padBefore: stub.ai.pos, racket });
            w.stroke({ time: t, side: -1, aiLevel: levelIndex, tactic: ai.tactic,
              strokeId: (racket.stroke && racket.stroke.id) || null, vmag, vR: racket.vR,
              quality: racket.quality, contact,
              racket: { pos: racket.pos || stub.ai.pos, normal: racket.normal },
              ball: { v: ball.v, w: ball.w }, ballBefore: before });
            V3.addScaled(ball.p, ball.p, racket.normal, BALL_R * lib.STROKE_CONFIG.racket.launchSeparation);
            ball.lastHitBy = -1;
            hitSeq++;
            swung = true;
            stats.swings++;
          }
        }
      }

      w.frame({ time: t, dt: frameDt, side: -1, aiLevel: levelIndex, ball,
        player: { pos: { x: 0, y: 1.05, z: 1.55 } }, opponent: oppPad,
        project, viewport: VIEW });
    }
    if (ball.p.y < -0.4) { ball.live = false; break; }
    if (swung && ball.p.z > 0.6) break;      /* мяч вернулся к игроку */
    if (!swung && ball.p.z < -(PH.T_HALF_LEN + 0.9)) break;
  }
  w.armOpponent(false, null);
}

function runLevel(levelIndex, strokes) {
  const w = new PhysicsWatchdog();
  w.onTicket = null;
  const ai = new OpponentAI(levelIndex);
  const stub = makeStub();
  const stats = { strokes: 0, swings: 0, declines: 0, bounces: 0, nets: 0, hitSeq: 0, poses: new Set(),
    maxVmagRatio: 0, maxVmag: 0, maxVmagVsLevel: 0, maxX: 0, maxZ: 0, maxBallSpeed: 0, maxBallY: 0, codes: {} };

  for (let n = 0; n < strokes; n++) {
    stats.strokes++;
    const ball = freshBall();
    if (!ball) { stats.declines++; continue; }
    ball.speed = V3.len(ball.v);
    stub.ball = ball;
    stub.time += 1;
    stub.strokeTime = stub.time;
    stub.shotId++;
    stub.netTouched = false;
    stub.rally = 5;
    ai.reset();
    w.resetShot();
    stats.hitSeq = 0;

    strokeOnce(w, ball, stub, levelIndex, ai, stats);
  }
  for (const code of Object.keys(w.counts)) if (w.counts[code]) stats.codes[code] = w.counts[code];
  stats.uniquePoses = stats.poses.size;
  delete stats.poses;
  stats.probe = { ...w.probe };
  stats.causes = w.report().causes;
  /* В гейт идут только аномалии движка: BALL_OFF_FRAME с cause='input' —
   * это «так ударили», а не «движок сломался». */
  stats.engineTickets = w.tickets.filter(t => !(t.code === 'BALL_OFF_FRAME' &&
    t.detail && t.detail.cause === 'input'));
  stats.inputTickets = w.tickets.filter(t => t.code === 'BALL_OFF_FRAME' &&
    t.detail && t.detail.cause === 'input');
  return { level: levelIndex, name: AI_LEVELS[levelIndex] && AI_LEVELS[levelIndex].name,
    gates: w.report().gates.status, stats,
    engine: stats.engineTickets.map(t => ({ code: t.code, time: t.time, side: t.side, aiLevel: t.aiLevel, detail: t.detail })),
    offFrameInput: stats.inputTickets.map(t => ({ code: t.code, time: t.time, side: t.side, aiLevel: t.aiLevel, detail: t.detail })) };
}

const results = [];
for (let lv = 0; lv < LEVELS; lv++) results.push(runLevel(lv, STROKES));

/* --- перф: сторож на 600 Гц ---------------------------------------- */
function bench() {
  const w = new PhysicsWatchdog();
  w.arm(true, { shotId: 1 });
  w.armOpponent(true, { shotId: 1, aiLevel: 3 });
  const pad = { pos: { x: 0, y: 1.1, z: 1.8 }, prevPos: { x: 0, y: 1.1, z: 1.8 }, normal: { x: 0, y: 0, z: -1 } };
  const opp = { pad: { pos: { x: 0, y: 1.1, z: -1.8 }, normal: { x: 0, y: 0, z: 1 } },
    padPrev: { x: 0, y: 1.1, z: -1.8 }, hitRadius: 0.152 };
  const ball = { p: { x: 0, y: 1.1, z: 1.2 }, v: { x: 0, y: -1, z: 5 }, w: { x: -40, y: 0, z: 0 }, speed: 5 };
  const frames = 2000;
  const t0 = process.hrtime.bigint();
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < 10; k++) {
      const p0 = { x: 0, y: 1.1, z: 1.2 + k * 0.001 };
      ball.p.z = p0.z + 0.001;
      w.substep({ dt: 1 / 600, time: f / 60 + k / 600, p0, p1: ball.p, ball, pad, padPrev: pad.prevPos,
        hitRadius: 0.152, opp, hitSeq: 0 });
    }
    w.frame({ time: f / 60, dt: 1 / 60, ball, player: pad, opponent: opp.pad, project, viewport: VIEW });
  }
  const sub = Number(process.hrtime.bigint() - t0) / 1e6 / frames;   // мс на кадр (10 подшагов + кадр)

  /* отдельно: только кадровая часть (позы + экран) */
  const t1 = process.hrtime.bigint();
  for (let f = 0; f < frames; f++) {
    w.frame({ time: f / 60, dt: 1 / 60, ball, player: pad, opponent: opp.pad, project, viewport: VIEW });
  }
  const fr = Number(process.hrtime.bigint() - t1) / 1e6 / frames;

  /* отдельно: 10 подшагов 600 Гц без кадра */
  const t2 = process.hrtime.bigint();
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < 10; k++) {
      const p0 = { x: 0, y: 1.1, z: 1.2 + k * 0.001 };
      ball.p.z = p0.z + 0.001;
      w.substep({ dt: 1 / 600, time: f / 60 + k / 600, p0, p1: ball.p, ball, pad, padPrev: pad.prevPos,
        hitRadius: 0.152, opp, hitSeq: 0 });
    }
  }
  const so = Number(process.hrtime.bigint() - t2) / 1e6 / frames;
  return { sub, frame: fr, substeps: so };
}
const benchOut = bench();
const msPerFrame = benchOut.sub;

/* В гейт идут только аномалии движка. BALL_OFF_FRAME с cause='input' —
 * законный исход удара: он печатается и считается отдельно. */
const gate = { total: 0, byCode: {} };
const causes = { input: 0, engine: 0 };
const total = { BALL_THROUGH_RACKET: 0, RACKET_UNDER_TABLE: 0, SPEED_CEILING: 0, RACKET_OFFSCREEN: 0, other: 0 };
let minPoses = Infinity;
for (const r of results) {
  minPoses = Math.min(minPoses, r.stats.uniquePoses);
  causes.input += r.stats.causes.input;
  causes.engine += r.stats.causes.engine;
  for (const t of r.stats.engineTickets) {
    gate.total++;
    gate.byCode[t.code] = (gate.byCode[t.code] || 0) + 1;
    if (t.code in total) total[t.code]++; else total.other++;
  }
}
const probeTotals = results.reduce((a, r) => {
  for (const [k, v] of Object.entries(r.stats.probe || {})) a[k] = (a[k] || 0) + v;
  return a;
}, {});
const covered = probeTotals.planeCrossings > 0 && probeTotals.armedSteps > 0 &&
  probeTotals.poses > 0 && probeTotals.strokes > 0;
/* Позы бота обязаны быть РАЗНЫМИ: если клинок стоит на месте, кадровая
 * проверка «ракетка под столом / за кадром» ничего не проверяет. */
const posesOk = results.every(r => r.stats.uniquePoses > 50);
const out = { strokes: STROKES, levels: LEVELS, perLevel: results, total, gate, causes, probe: probeTotals,
  uniquePoses: results.map(r => r.stats.uniquePoses), minPoses, posesOk,
  msPerFrame, msFrameOnly: benchOut.frame, msSubstepsOnly: benchOut.substeps,
  pass: gate.total === 0 && covered && posesOk && results.every(r => r.gates === 'green') };

if (argv.includes('--dump')) {
  for (const r of results) {
    for (const t of r.engine) console.log('ENGINE', JSON.stringify(t));
    for (const t of r.offFrameInput) console.log('INPUT', JSON.stringify(t));
  }
}
if (json) { console.log(JSON.stringify(out, null, 2)); process.exit(out.pass ? 0 : 1); }

console.log(`Headless rally: ${LEVELS} × ${STROKES} ударов бота\n`);
for (const r of results) {
  const s = r.stats;
  console.log(`${String(r.name).padEnd(6)} ударов ${String(s.strokes).padStart(3)} · замах ${String(s.swings).padStart(3)}` +
    ` · отказ ${String(s.declines).padStart(3)} · vmag ${s.maxVmag.toFixed(2)} (${(s.maxVmagRatio * 100).toFixed(0)}% потолка, ${(s.maxVmagVsLevel * 100).toFixed(0)}% уровня)` +
    ` · поз ${s.uniquePoses} · мяч ${(s.maxBallSpeed * 3.6).toFixed(0)} км/ч · apex ${s.maxBallY.toFixed(2)} м` +
    ` · вне кадра: input ${s.causes.input} / engine ${s.causes.engine}` +
    ` · клинок: ${s.probe.armedSteps} взведённых, ${s.probe.planeCrossings} пересеч.` +
    ` · гейты ${r.gates}` + (r.engine.length ? ` · ТИКЕТЫ ${JSON.stringify(gate.byCode)}` : ''));
}
console.log(`\nГейт (аномалии движка): ${gate.total}${gate.total ? ' ' + JSON.stringify(gate.byCode) : ''}` +
  ` · BALL_THROUGH_RACKET ${total.BALL_THROUGH_RACKET} · RACKET_UNDER_TABLE ${total.RACKET_UNDER_TABLE}` +
  ` · SPEED_CEILING ${total.SPEED_CEILING} · RACKET_OFFSCREEN ${total.RACKET_OFFSCREEN} · прочие ${total.other}`);
console.log(`Объяснено законным ударом (не в гейте): BALL_OFF_FRAME cause=input ${causes.input}` +
  ` · cause=engine ${causes.engine}`);
console.log(`Покрытие детекторов: ${probeTotals.substeps} подшагов (${probeTotals.armedSteps} взведённых) · ${probeTotals.planeCrossings} пересечений плоскости клинка` +
  ` · ${probeTotals.poses} поз ракеток в кадре · ${probeTotals.screens} кадров мяча вне экрана · ${probeTotals.strokes} ударов`);
console.log(`Позы клинка бота: мин ${minPoses} на уровень (требуется > 50) — ${posesOk ? 'ок' : 'ПРОВАЛ'}`);
console.log(`Сторож: ${msPerFrame.toFixed(4)} мс на кадр целиком (10 подшагов 600 Гц + кадр);` +
  ` подшаги ${benchOut.substeps.toFixed(4)} · кадр ${benchOut.frame.toFixed(4)} — бюджет 0.05`);
console.log(out.pass ? '\nГЕЙТЫ ЗЕЛЁНЫЕ' : '\nПРОВАЛ');
process.exit(out.pass ? 0 : 1);
