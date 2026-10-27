/* ТЗ «система сложности бота и выбор уровня».
 *
 * Четыре уровня (EASY / MEDIUM / HARD / WTF) должны быть ЧЕСТНЫМИ: никакой
 * мгновенной реакции, нулевой ошибки, бесконечной силы или идеального чтения
 * вращения. Эти тесты держат договор по всем пунктам, которые можно проверить
 * без браузера:
 *
 *   1. Таблица уровней в окнах ТЗ и анти-читерские минимумы.
 *   2. setLevel() переписывает ВСЕ параметры, индексы клампятся.
 *   3. MEET_ASSIST и AI_SERVE_CAPS синхронны с AI_LEVELS.
 *   4. Никакого Math.random, кроме инъектируемого _rand-фолбэка.
 *   5. Детерминизм: один сид — одна тактика, удар, цель.
 *   6. Микс ударов: EASY почти не бьёт SMASH/COUNTER, WTF — бьёт.
 *   7. Ошибки: WTF ≤ 2.5 % на обычном мяче, растут под давлением / на
 *      быстром / коротком мяче / после серии агрессии, делятся ~50/50.
 *   8. Реакция: восприятие сразу, решение — через L.react; на EASY бот
 *      реально опаздывает, на WTF — успевает.
 *   9. Телеметрия и тренд между матчами.
 *  10. «20 матчей на уровень»: чем выше уровень, тем меньше очков у игрока
 *      и тем длиннее ралли, но WTF всё-таки проигрывает очки.
 *
 * Игрок в интеграционном прогоне — тот же конвейер ошибки уровня MEDIUM:
 * так тест мерит ОТНОСИТЕЛЬНУЮ силу уровня на настоящем коде, а не выдуманную
 * вероятность возврата.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, root } = require('./helpers.cjs');

const lib = load(['10_math.js', '30_physics.js', '55_ai.js'],
  ['OpponentAI', 'AI_LEVELS', 'AI_TACTICS', 'AI_SERVE_CAPS', 'AI_ATTACK_STROKES', 'PH', 'V3', 'predict', 'impactRacket']);
const { PH, V3, AI_LEVELS } = lib;
const AI_SRC = fs.readFileSync(path.join(root, 'tt/src/55_ai.js'), 'utf8');

/* Окна из ТЗ §3.1–3.4. Значения вне окна — это уже другой уровень. */
const SPEC = [
  { style: 'PUSHER', react: [0.40, 0.45], move: [1.6, 1.8], posErr: [0.28, 0.32],
    errBase: [0.34, 0.40], aggro: [0.05, 0.10], vmagMax: [3.5, 4.0] },
  { style: 'ALLROUND', react: [0.26, 0.30], move: [2.4, 2.7], posErr: [0.14, 0.18],
    errBase: [0.16, 0.22], aggro: [0.22, 0.28], vmagMax: [6.5, 7.0] },
  { style: 'ATTACK', react: [0.16, 0.18], move: [3.6, 4.0], posErr: [0.05, 0.07],
    errBase: [0.06, 0.09], aggro: [0.50, 0.58], vmagMax: [11.5, 12.5] },
  { style: 'ATTACK', react: [0.085, 0.095], move: [5.6, 6.0], posErr: [0.020, 0.026],
    errBase: [0.014, 0.020], errPress: [0.016, 0.022], aggro: [0.80, 0.85], vmagMax: [16.0, 16.5],
    spinRead: [0.96, 0.97], placeSkill: [0.93, 0.95], counterRate: [0.62, 0.70],
    smashRate: [0.90, 0.94], dropRate: [0.12, 0.15] },
];

/* Детерминированный поток: тесты не должны зависеть от Math.random. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function rig(ai, seq) { let i = 0; ai.rng = () => (i < seq.length ? seq[i++] : 0.5); }

function fixtureGame(over = {}) {
  return {
    ball: { p: V3.new(0.15, PH.TABLE_Y + 0.30, -0.90), v: V3.new(0, -0.5, -5.5), w: V3.new(0, 0, 30),
      live: true, lastHitBy: 1, golden: null },
    player: { pos: V3.new(0.20, PH.TABLE_Y, 1.15) },
    ai: { pos: V3.new(0, PH.TABLE_Y, -1.2) },
    time: 0, strokeTime: 0, shotId: 1, netTouched: false, rally: 1,
    ...over,
  };
}
/* Ракетка, которая на фикстурном мяче РЕАЛЬНО играет в стол: всё, что
 * делают тесты ошибок, проверено тем же predict, что и в игре. */
function goodRacket() {
  const n = V3.new(0, 0.12, 1), l = V3.len(n);
  return { side: -1, normal: V3.new(n.x / l, n.y / l, n.z / l),
    vR: V3.new(0, 0.4, 1.0), quality: 0.9, valid: true };
}

/* ---------- 1. Таблица уровней ---------- */

test('четыре уровня: стили и все параметры внутри окон ТЗ', () => {
  assert.equal(AI_LEVELS.length, 4, 'ТЗ требует ровно 4 уровня');
  assert.deepEqual(AI_LEVELS.map((L) => L.name).join(','), 'EASY,MEDIUM,HARD,WTF');
  assert.deepEqual(AI_LEVELS.map((L) => L.ru).join(','), 'ЛЁГКИЙ,СРЕДНИЙ,СЛОЖНЫЙ,WTF');
  assert.deepEqual(AI_LEVELS.map((L) => L.id).join(','), '0,1,2,3');
  AI_LEVELS.forEach((L, i) => {
    const spec = SPEC[i];
    assert.equal(L.style, spec.style, `${L.name}: стиль`);
    for (const k of Object.keys(spec)) {
      if (k === 'style') continue;
      const [lo, hi] = spec[k];
      assert.ok(Number.isFinite(L[k]), `${L.name}.${k} объявлен`);
      assert.ok(L[k] >= lo && L[k] <= hi, `${L.name}.${k} = ${L[k]} вне окна ${lo}…${hi}`);
    }
  });
  // уровень реально растёт от строки к строке
  for (const k of ['move', 'aggro', 'vmagMax', 'skill', 'placeSkill', 'counterRate', 'smashRate'])
    for (let i = 1; i < AI_LEVELS.length; i++)
      assert.ok(AI_LEVELS[i][k] > AI_LEVELS[i - 1][k], `${k} должен расти: ${i}`);
  for (const k of ['react', 'posErr', 'errBase'])
    for (let i = 1; i < AI_LEVELS.length; i++)
      assert.ok(AI_LEVELS[i][k] < AI_LEVELS[i - 1][k], `${k} должен падать: ${i}`);
});

test('анти-читерские минимумы: ни мгновенной реакции, ни нулевой ошибки, ни бесконечной силы', () => {
  for (const L of AI_LEVELS) {
    assert.ok(L.react >= 0.08, `${L.name}: реакция не быстрее 80 мс (${L.react})`);
    assert.ok(L.posErr > 0, `${L.name}: posErr никогда не 0`);
    assert.ok(L.errBase > 0, `${L.name}: errBase никогда не 0`);
    assert.ok(Number.isFinite(L.vmagMax) && L.vmagMax > 0 && L.vmagMax <= 20, `${L.name}: конечный vmagMax`);
    assert.ok(L.vmagMax > L.vmagMin, `${L.name}: окно силы не перевёрнуто`);
    assert.ok(L.spinRead < 1, `${L.name}: вращение читается не идеально`);
    assert.ok(L.counterRate < 1 && L.smashRate <= 1, `${L.name}: удар выбирается не всегда`);
    assert.ok(L.windup > 0, `${L.name}: замах занимает время`);
  }
  // WTF — самый быстрый, но НЕ мгновенный: 85 мс — это предел честности
  assert.ok(AI_LEVELS[3].react > 0.08, 'WTF не ходит в будущее');
});

/* ---------- 2. setLevel ---------- */

test('setLevel переписывает все параметры и клампит индекс', () => {
  const ai = new lib.OpponentAI(0);
  assert.equal(ai.levelIndex, 0);
  const numeric = Object.keys(AI_LEVELS[0]).filter((k) => typeof AI_LEVELS[0][k] === 'number');
  for (let idx = 0; idx < AI_LEVELS.length; idx++) {
    ai.setLevel(idx);
    assert.equal(ai.L, AI_LEVELS[idx], `L указывает на уровень ${idx}`);
    assert.equal(ai.levelIndex, idx);
    assert.equal(ai.maxSpeed, AI_LEVELS[idx].move, 'maxSpeed идёт за уровнем');
    assert.equal(ai.pace, AI_LEVELS[idx].paceOpen, 'pace сбрасывается на уровень');
  }
  const before = numeric.filter((k) => ai.L[k] !== AI_LEVELS[0][k]);
  assert.ok(before.length > 10, `уровни отличаются по большинству параметров (${before.length})`);
  ai.setLevel(9); assert.equal(ai.levelIndex, 3, 'индекс выше — это WTF');
  ai.setLevel(-4); assert.equal(ai.levelIndex, 0, 'индекс ниже — это EASY');
  ai.setLevel('2'); assert.equal(ai.levelIndex, 2, 'строка тоже принимается');
  ai.setLevel(undefined); assert.equal(ai.levelIndex, 0, 'мусор не ломает уровень');
  assert.equal(new lib.OpponentAI(99).levelIndex, 3);
});

/* ---------- 3. Синхронность таблиц ---------- */

test('MEET_ASSIST и AI_SERVE_CAPS живут в том же счёте, что и AI_LEVELS', () => {
  assert.equal(lib.AI_SERVE_CAPS.length, AI_LEVELS.length, 'AI_SERVE_CAPS на 4 уровня');
  const gameSrc = fs.readFileSync(path.join(root, 'tt/src/70_game.js'), 'utf8');
  const m = gameSrc.match(/const MEET_ASSIST = \[([^\]]*)\]/);
  assert.ok(m, 'MEET_ASSIST объявлен в 70_game.js');
  const assist = m[1].split(',').map((x) => Number(x.trim()));
  assert.equal(assist.length, AI_LEVELS.length, 'MEET_ASSIST на 4 уровня');
  for (let i = 1; i < assist.length; i++) assert.ok(assist[i] < assist[i - 1], 'подсказка слабеет с уровнем');
  for (let i = 1; i < lib.AI_SERVE_CAPS.length; i++)
    assert.ok(lib.AI_SERVE_CAPS[i].vmag > lib.AI_SERVE_CAPS[i - 1].vmag, 'подача усиливается с уровнем');
});

/* ---------- 4–5. Детерминизм ---------- */

test('Math.random остался ровно один — инъектируемый фолбэк _rand', () => {
  const code = AI_SRC.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l)).join('\n');
  const hits = code.match(/Math\.random/g) || [];
  assert.equal(hits.length, 1, 'весь рандом бота идёт через this._rand()');
  const line = code.split('\n').find((l) => l.includes('Math.random'));
  assert.match(line, /_rand\(\)/, 'единственный Math.random — внутри _rand');
  for (const fn of ['rollTactic', 'pickStroke', 'pickTarget', 'computePlan', 'serve', 'applyExecutionError']) {
    const body = AI_SRC.slice(AI_SRC.indexOf(`  ${fn}(`)).split('\n\n  ')[0];
    assert.equal((body.match(/Math\.random/g) || []).length, 0, `${fn} не зовёт Math.random напрямую`);
  }
});

test('один сид — одна тактика, один удар, одна цель', () => {
  const plans = [
    { y: PH.TABLE_Y + 0.55, speed: 8, z: -1.2, short: false, wide: false, willLandIn: true },
    { y: PH.TABLE_Y + 0.10, speed: 9, z: -1.7, short: false, wide: true, willLandIn: true },
    { y: PH.TABLE_Y + 0.12, speed: 6, z: -1.1, short: true, wide: false, willLandIn: true },
  ];
  const run = (seed, level) => {
    const ai = new lib.OpponentAI(level);
    ai.rng = lcg(seed);
    const out = [];
    for (let i = 0; i < 30; i++) {
      const g = fixtureGame();
      const p = plans[i % plans.length];
      ai.tactic = ai.rollTactic();
      const arch = ai.pickStroke(g, p);
      const aim = ai.pickTarget(g, p, arch);
      out.push(ai.tactic.id + '/' + arch + '/' + aim.x.toFixed(3) + '/' + aim.z.toFixed(3));
    }
    return out;
  };
  for (let lv = 0; lv < AI_LEVELS.length; lv++) {
    assert.deepEqual(run(12345, lv), run(12345, lv), `уровень ${lv}: тот же сид — та же игра`);
    assert.notDeepEqual(run(12345, lv), run(54321, lv), `уровень ${lv}: другой сид — другая игра`);
  }
});

/* ---------- 6. Микс ударов ---------- */

const PLANS = [
  { h: 0.55, speed: 8, z: -1.2, short: false, wide: false },   // высокий — можно смашить
  { h: 0.55, speed: 8, z: -1.2, short: true, wide: false },
  { h: 0.10, speed: 8, z: -1.7, short: false, wide: true },    // глубокий с угла
  { h: 0.10, speed: 8, z: -1.7, short: false, wide: false },
  { h: 0.20, speed: 20, z: -1.4, short: false, wide: false },  // очень быстрый
  { h: 0.12, speed: 6, z: -1.1, short: true, wide: false },    // короткий у сетки
  { h: 0.30, speed: 10, z: -1.5, short: false, wide: true },
];
function strokeMix(level, seed = 777, reps = 300) {
  const ai = new lib.OpponentAI(level);
  ai.rng = lcg(seed);
  const count = Object.create(null);
  let n = 0;
  for (let r = 0; r < reps; r++) {
    for (const P of PLANS) {
      for (const wx of [-200, 0, 300]) {
        const g = fixtureGame({ ball: { p: V3.new(0.1, PH.TABLE_Y + 0.3, -1.0), v: V3.new(0, -0.4, -6), w: V3.new(wx, 0, 20) } });
        const plan = { x: 0, y: PH.TABLE_Y + P.h, z: P.z, speed: P.speed, short: P.short,
          wide: P.wide, willLandIn: true, t: 1, bounceT: 0 };
        ai.tactic = ai.rollTactic();
        ai.pace = 0.4 + 0.5 * ai._rand();
        const arch = ai.pickStroke(g, plan);
        count[arch] = (count[arch] || 0) + 1; n++;
      }
    }
  }
  const frac = (list) => list.reduce((s, k) => s + (count[k] || 0), 0) / n;
  return { n, count, frac };
}

test('EASY почти не бьёт SMASH и COUNTER, но и не стоит на месте', () => {
  const m = strokeMix(0);
  assert.ok(m.frac(['SMASH']) < 0.02, `SMASH у EASY: ${(m.frac(['SMASH']) * 100).toFixed(1)}%`);
  assert.ok(m.frac(['COUNTER']) < 0.02, `COUNTER у EASY: ${(m.frac(['COUNTER']) * 100).toFixed(1)}%`);
  assert.ok(m.frac(['PUSH', 'DRIVE', 'BLOCK']) > 0.55, 'основа EASY — раскатка и блок');
  assert.ok(m.frac(['DRIVE']) > 0.03, 'но нормальный DRIVE иногда есть — бот не «стоячий»');
  // тактика PUSHER: только SAFE / FEEL
  const ai = new lib.OpponentAI(0);
  ai.rng = lcg(4);
  const tactics = new Set();
  for (let i = 0; i < 200; i++) tactics.add(ai.rollTactic().id);
  assert.deepEqual([...tactics].sort().join(','), 'FEEL,SAFE');
});

test('WTF активно использует SMASH и COUNTER, HARD бьёт сильнее EASY', () => {
  const easy = strokeMix(0), hard = strokeMix(2), wtf = strokeMix(3);
  assert.ok(wtf.frac(['SMASH', 'COUNTER']) > 0.15,
    `атака WTF: ${(wtf.frac(['SMASH', 'COUNTER']) * 100).toFixed(1)}%`);
  assert.ok(wtf.frac(['SMASH']) > hard.frac(['SMASH']), 'SMASH у WTF чаще, чем у HARD');
  assert.ok(hard.frac(['SMASH']) > easy.frac(['SMASH']), 'SMASH у HARD чаще, чем у EASY');
});

/* ---------- 7. Ошибки ---------- */

test('WTF ошибается редко: ≤ 2.5 % на обычном мяче', () => {
  const ai = new lib.OpponentAI(3);
  ai.rng = lcg(99);
  const g = fixtureGame();
  let errs = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) if (ai.applyExecutionError(g, goodRacket(), false).aiError) errs++;
  const rate = errs / N;
  assert.ok(rate <= 0.025, `WTF ошибся ${(rate * 100).toFixed(2)}% > 2.5%`);
  assert.ok(rate > 0.004, `WTF вообще не ошибается (${(rate * 100).toFixed(2)}%) — это уже читер`);
  assert.equal(ai.stats.errors, errs, 'счётчик ошибок совпадает с наблюдением');
});

test('ошибки делятся примерно 50/50: сетка и длинные', () => {
  const ai = new lib.OpponentAI(0);
  ai.rng = lcg(5);
  const g = fixtureGame();
  for (let i = 0; i < 2500; i++) ai.applyExecutionError(g, goodRacket(), false);
  const s = ai.stats;
  assert.ok(s.errors > 500, `нужна статистика: ошибок ${s.errors}`);
  assert.equal(s.net + s.long, s.errors, 'каждая ошибка посчитана ровно один раз');
  const netShare = s.net / s.errors;
  assert.ok(netShare > 0.42 && netShare < 0.58, `доля сетки ${(netShare * 100).toFixed(1)}%`);
});

test('ошибка растёт под давлением, на быстром и коротком мяче, после серии агрессии', () => {
  const g = fixtureGame();
  // 1. Давление: у WTF errPress — АБСОЛЮТНЫЙ процент (1.7 → 1.9), а не слагаемое
  const calm = new lib.OpponentAI(3); calm.pressure = 0;
  rig(calm, [0.018, 0.30]);
  assert.ok(!calm.applyExecutionError(g, goodRacket(), false).aiError, 'без давления 1.8 % — это не ошибка');
  const pressed = new lib.OpponentAI(3); pressed.pressure = 1;
  rig(pressed, [0.018, 0.30]);
  assert.equal(pressed.applyExecutionError(g, goodRacket(), false).aiError, 'net', 'под давлением 1.8 % уже ошибка');

  // 2. Экстремально быстрый мяч: +3–6 %
  const fast = fixtureGame({ ball: { p: V3.new(0.15, PH.TABLE_Y + 0.30, -0.90), v: V3.new(0, -10, -17.3),
    w: V3.new(0, 0, 30), live: true, lastHitBy: 1, golden: null } });
  const vsFast = new lib.OpponentAI(3); rig(vsFast, [0.03, 0.30]);
  assert.equal(vsFast.applyExecutionError(fast, goodRacket(), false).aiError, 'net', 'быстрый мяч добавил ошибку');
  const vsSlow = new lib.OpponentAI(3); rig(vsSlow, [0.03, 0.30]);
  assert.ok(!vsSlow.applyExecutionError(g, goodRacket(), false).aiError, 'тот же бросок на медленном мяче — в игре');

  // 3. Короткий мяч у сетки: +1–3 %
  const shortAi = new lib.OpponentAI(3); shortAi._lastShort = true; rig(shortAi, [0.03, 0.30]);
  assert.equal(shortAi.applyExecutionError(g, goodRacket(), false).aiError, 'net', 'короткий мяч добавил ошибку');
  const longAi = new lib.OpponentAI(3); longAi._lastShort = false; rig(longAi, [0.03, 0.30]);
  assert.ok(!longAi.applyExecutionError(g, goodRacket(), false).aiError, 'глубокий мяч — без надбавки');

  // 4. Серия агрессии: после 2–3 атакующих ударов бот не может не промахиваться
  const streak = new lib.OpponentAI(3);
  for (let i = 0; i < 4; i++) streak.noteStroke('SMASH');
  assert.equal(streak.aggrStreak, 4, 'SMASH копит серию');
  rig(streak, [0.04, 0.30]);
  assert.equal(streak.applyExecutionError(g, goodRacket(), false).aiError, 'net', 'серия агрессии добавила ошибку');
  streak.noteStroke('PUSH');
  assert.equal(streak.aggrStreak, 0, 'защитный удар рвёт серию');
  rig(streak, [0.04, 0.30]);
  assert.ok(!streak.applyExecutionError(g, goodRacket(), false).aiError, 'после сброса серии бросок снова в игре');
});

test('WTF всё-таки ошибается, когда сам разгоняет серию агрессии', () => {
  const base = new lib.OpponentAI(3);
  base.rng = lcg(11);
  const g = fixtureGame();
  let baseErrs = 0;
  for (let i = 0; i < 1500; i++) if (base.applyExecutionError(g, goodRacket(), false).aiError) baseErrs++;

  const hot = new lib.OpponentAI(3);
  hot.rng = lcg(11);
  let hotErrs = 0;
  for (let i = 0; i < 1500; i++) {
    hot.noteStroke(i % 5 === 4 ? 'PUSH' : 'SMASH');   // 4 атаки, потом сброс
    if (hot.applyExecutionError(g, goodRacket(), false).aiError) hotErrs++;
  }
  assert.ok(hotErrs > baseErrs * 1.5, `серия должна кусаться: ${hotErrs} против ${baseErrs}`);
  assert.ok(hot.stats.aggrErr >= 3, 'максимальная серия попала в телеметрию');
});

/* ---------- 8. Реакция ---------- */

test('восприятие сразу, решение — через L.react: EASY опаздывает, WTF успевает', () => {
  for (let lv = 0; lv < AI_LEVELS.length; lv++) {
    const ai = new lib.OpponentAI(lv);
    ai.rng = lcg(31 + lv);
    const g = fixtureGame();
    ai.think(g, 1 / 60);
    assert.ok(ai.plan, `${ai.L.name}: прогноз построен сразу`);
    assert.equal(ai.commit, null, `${ai.L.name}: удар ещё не выбран`);
    g.strokeTime = ai.L.react - 0.01;
    ai.think(g, 1 / 60);
    assert.equal(ai.commit, null, `${ai.L.name}: раньше дедлайна не решаем`);
    g.strokeTime = ai.L.react + 0.01;
    ai.think(g, 1 / 60);
    assert.ok(ai.commit, `${ai.L.name}: после реакции удар выбран`);
    assert.ok(ai.commit.archId && ai.commit.aim, 'удар и цель заполнены');
    const ready = ai.readyToStrike(g.strokeTime);
    if (lv === 0) assert.equal(ready, false, 'EASY с 420 мс реакции реально опаздывает на этот мяч');
    if (lv === 3) assert.equal(ready, true, 'WTF с 90 мс успевает');
  }
  // дедлайны строго разнесены: скорость реакции — это то, что игрок чувствует
  const delays = AI_LEVELS.map((L) => L.react);
  assert.deepEqual(delays.join(','), [...delays].sort((a, b) => b - a).join(','), 'реакция ускоряется с уровнем');
  assert.ok(delays[0] / delays[3] > 4, 'разница между EASY и WTF больше чем в 4 раза');
});

/* Реальный прилёт: мяч уже отскочил на стороне игрока и идёт к боту. */
function incomingGame(speed, dx) {
  return fixtureGame({
    ball: { p: V3.new(dx, PH.TABLE_Y + 0.35, 0.55), v: V3.new(0, 1.2, -speed), w: V3.new(0, 0, 20),
      live: true, lastHitBy: 1, golden: null },
  });
}
/* Успевает ли уровень физически дотянуться: гоняем think и ищем кадр, где
 * ракетка уже замахнулась и окно удара открыто. Мгновенной реакции нет —
 * медленный уровень на быстрых мячах просто провожает мяч глазами. */
function capture(level, speed, reps = 20) {
  let hits = 0;
  for (let k = 0; k < reps; k++) {
    const ai = new lib.OpponentAI(level);
    ai.rng = lcg(100 + k);
    const g = incomingGame(speed, -0.5 + k * 0.05);
    for (let i = 0; i < 240; i++) {
      g.strokeTime = i / 120;
      ai.think(g, 1 / 120);
      if (ai.commit && ai.readyToStrike(g.strokeTime)) { hits++; break; }
    }
  }
  return hits / reps;
}

test('скорость реакции видна в игре: EASY не успевает на быстрый мяч, WTF успевает на всё', () => {
  const caps = AI_LEVELS.map((_, lv) => [5, 8, 12, 16].map((sp) => capture(lv, sp)));
  if (process.env.TT_AI_TABLE) {
    console.log('\nперехват по скоростям 5/8/12/16 м/с:');
    AI_LEVELS.forEach((L, lv) => console.log(`  ${L.name.padEnd(7)} ${caps[lv].map((c) => (c * 100).toFixed(0) + '%').join(' / ')}`));
  }
  assert.equal(caps[0][0], 1, 'EASY добирает медленный мяч');
  assert.equal(caps[0][1], 1, 'EASY добирает средний мяч');
  assert.equal(caps[0][2], 0, 'EASY физически опаздывает на 12 м/с — никакой мгновенной реакции');
  assert.equal(caps[0][3], 0, 'EASY не телепортируется на 16 м/с');
  for (let lv = 1; lv < AI_LEVELS.length; lv++)
    for (const c of caps[lv]) assert.equal(c, 1, `${AI_LEVELS[lv].name} обязан успевать`);
});

/* ---------- 9. Телеметрия и тренд ---------- */

test('телеметрия отдаёт уровень, разбивку ошибок, скорость ответа и место ошибки', () => {
  const ai = new lib.OpponentAI(2);
  ai.rng = lcg(17);
  const g = fixtureGame();
  for (let i = 0; i < 800; i++) ai.applyExecutionError(g, goodRacket(), false);
  const t = ai.telemetry();
  assert.equal(t.level, 2);
  assert.equal(t.name, 'HARD');
  assert.equal(t.style, 'ATTACK');
  assert.ok(t.errors > 0, 'ошибки есть');
  assert.equal(t.net + t.long, t.errors);
  assert.equal(typeof t.pressureErr, 'number');
  assert.ok(t.errPos && Number.isFinite(t.errPos.z) && Number.isFinite(t.errPos.x), 'место ошибки записано');
  assert.ok(t.errPos.speed > 0, 'скорость входящего мяча в момент ошибки');
  assert.ok(t.shots === 0 || t.shots > 0, 'shots — число');
  assert.equal(t.trend, 0);
  assert.ok(t.byStroke && typeof t.byStroke === 'object');
});

test('тренд между матчами: ±4 %, у WTF ±2 %, и он не трогает реакцию и ошибку', () => {
  const easy = new lib.OpponentAI(0);
  easy.setTrend(1); assert.equal(easy._trendAmp(), 0.04);
  easy.setTrend(-1); assert.equal(easy._trendAmp(), -0.04);
  easy.setTrend(9); assert.equal(easy._trendAmp(), 0.04, 'тренд клампится');
  const wtf = new lib.OpponentAI(3);
  wtf.setTrend(1); assert.equal(wtf._trendAmp(), 0.02, 'WTF почти не подкручивается');
  assert.equal(wtf.L.react, AI_LEVELS[3].react, 'реакция не адаптируется никогда');
  assert.equal(wtf.L.posErr, AI_LEVELS[3].posErr);
  assert.equal(wtf.L.errBase, AI_LEVELS[3].errBase);
  // адаптация видна в тактике: +тренд сдвигает распределение к PRESS, −тренд к SAFE
  const share = (trend) => {
    const ai = new lib.OpponentAI(1);
    ai.rng = lcg(23); ai.setTrend(trend);
    let press = 0, safe = 0;
    for (let i = 0; i < 4000; i++) {
      const id = ai.rollTactic().id;
      if (id === 'PRESS') press++;
      if (id === 'SAFE') safe++;
    }
    return { press: press / 4000, safe: safe / 4000 };
  };
  const hot = share(1), cold = share(-1);
  assert.ok(hot.press > cold.press + 0.01, `тренд сдвигает агрессию: ${hot.press} vs ${cold.press}`);
  assert.ok(cold.safe > hot.safe + 0.01, `и осторожность: ${cold.safe} vs ${hot.safe}`);
});

/* ---------- 10. 20 матчей на уровень ---------- */

/* Один «удар» стороны: настоящая тактика, настоящий выбор удара, настоящий
 * applyExecutionError на фикстурном мяче. Возврат легального мяча дальше не
 * симулируется — для сравнения уровней важен сам конвейер ошибки. */
function exchange(ai, game) {
  ai.tactic = ai.rollTactic();
  ai.pace = Math.min(1, ai.L.paceOpen + 0.06 * ai.exchange);
  const P = PLANS[(ai.exchange + (ai.levelIndex * 3)) % PLANS.length];
  const plan = { x: 0, y: PH.TABLE_Y + P.h, z: P.z, speed: P.speed, short: P.short,
    wide: P.wide, willLandIn: true, t: 1, bounceT: 0 };
  const arch = ai.pickStroke(game, plan);
  ai.noteStroke(arch);
  ai.exchange++;
  return ai.applyExecutionError(game, goodRacket(), false).aiError ? { err: true, arch } : { err: false, arch };
}

function simulate(level, matches = 20) {
  const bot = new lib.OpponentAI(level);
  const human = new lib.OpponentAI(1);          // «игрок» — тот же конвейер, уровень MEDIUM
  const rnd = lcg(1000 + level * 7919);
  bot.rng = rnd; human.rng = rnd;
  const g = fixtureGame();
  let playerPoints = 0, botPoints = 0, wins = 0, rallies = 0, exchanges = 0;
  const mix = Object.create(null);
  for (let m = 0; m < matches; m++) {
    const score = [0, 0];
    bot.reset(); human.reset();
    while (score[0] < 11 && score[1] < 11) {
      bot.exchange = 0; human.exchange = 0;
      let winner = null, ex = 0;
      while (ex < 40 && winner === null) {
        ex++;
        const b = exchange(bot, g);
        mix[b.arch] = (mix[b.arch] || 0) + 1;
        if (b.err) { winner = 0; break; }
        const h = exchange(human, g);
        if (h.err) winner = 1;
      }
      if (winner === null) winner = rnd() < 0.5 ? 0 : 1;
      score[winner]++;
      if (winner === 0) playerPoints++; else botPoints++;
      rallies += ex; exchanges++;
    }
    if (score[0] > score[1]) wins++;
  }
  return { level, wins, matches, playerPoints, botPoints, playerPointRate: playerPoints / (playerPoints + botPoints),
    avgRally: rallies / exchanges, mix, telemetry: bot.telemetry() };
}

test('20 матчей на уровень: выше уровень — меньше очков у игрока, длиннее ралли, WTF не идеален', () => {
  const rows = AI_LEVELS.map((_, lv) => simulate(lv));
  if (process.env.TT_AI_TABLE) {
    console.log('\nуровень | победы игрока | очки игрока | среднее ралли | ошибок бота');
    for (const r of rows)
      console.log(`  ${AI_LEVELS[r.level].name.padEnd(6)} | ${r.wins}/${r.matches}`.padEnd(30) +
        `| ${(r.playerPointRate * 100).toFixed(1)}%`.padEnd(14) + `| ${r.avgRally.toFixed(2)}`.padEnd(16) +
        `| ${r.telemetry.errors}`);
  }
  const [easy, medium, hard, wtf] = rows;

  // порядок силы: каждый следующий уровень строго тяжелее
  assert.ok(easy.playerPointRate > medium.playerPointRate + 0.05,
    `EASY должен отдавать больше MEDIUM: ${easy.playerPointRate} vs ${medium.playerPointRate}`);
  assert.ok(medium.playerPointRate > hard.playerPointRate + 0.05,
    `MEDIUM должен отдавать больше HARD: ${medium.playerPointRate} vs ${hard.playerPointRate}`);
  assert.ok(hard.playerPointRate > wtf.playerPointRate + 0.05,
    `HARD должен отдавать больше WTF: ${hard.playerPointRate} vs ${wtf.playerPointRate}`);

  // EASY слабый, но не «дерево»: игрок берёт большинство, но не всё
  assert.ok(easy.playerPointRate > 0.55 && easy.playerPointRate < 0.95,
    `винрейт EASY вне окна: ${(easy.playerPointRate * 100).toFixed(1)}%`);
  // WTF почти непобедим, но не 0 %
  assert.ok(wtf.playerPointRate > 0.01 && wtf.playerPointRate < 0.25,
    `винрейт WTF вне окна: ${(wtf.playerPointRate * 100).toFixed(1)}%`);
  assert.ok(wtf.playerPoints > 0, 'WTF обязан иногда проигрывать очко');

  // ралли удлиняется: бот реже ошибается
  assert.ok(wtf.avgRally > easy.avgRally * 1.6,
    `ралли WTF ${wtf.avgRally.toFixed(2)} должно быть заметно длиннее EASY ${easy.avgRally.toFixed(2)}`);

  // честные ошибки видны в телеметрии каждого уровня
  for (const r of rows) {
    const t = r.telemetry;
    assert.equal(t.level, r.level);
    assert.equal(t.net + t.long, t.errors, `${t.name}: сетка+длинные = все ошибки`);
    assert.ok(t.errors > 0, `${t.name}: ошибки обязательно есть`);
    assert.ok(t.net > 0 && t.long > 0, `${t.name}: ошибки обоих сортов`);
    assert.ok(t.aggrErr >= 0);
  }
  // миксы ударов уровня соответствуют ТЗ даже внутри матчей
  assert.ok(((easy.mix.SMASH || 0) / Object.values(easy.mix).reduce((a, b) => a + b, 0)) < 0.02,
    'EASY не смашит даже в матче');
  assert.ok((wtf.mix.SMASH || 0) > (easy.mix.SMASH || 0), 'WTF смашит чаще EASY');
});
