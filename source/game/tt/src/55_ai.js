/* =====================================================================
 *  OPPONENT AI  —  paddle-only stroke animation
 *
 *  Design brief, in plain words: the old bot was unreadable. It decided
 *  its stroke with a fresh coin flip at the moment of contact, swung with
 *  no wind-up, and hit at full power from the first ball of the rally.
 *  Nothing about it could be anticipated, so losing felt arbitrary.
 *
 *  This version is built around three ideas:
 *
 *  1. READABILITY. Every shot is committed ~0.3 s before contact and the
 *     bat physically pulls back into a visible backswing whose direction
 *     and face angle match the stroke. A player who watches the bat can
 *     tell a loop from a push before the ball is struck. Weaker levels
 *     telegraph longer; the Legend barely telegraphs at all.
 *
 *  2. RALLY SHAPE. Pace is not constant. A rally opens soft and escalates
 *     as the exchange goes on, exactly like a real one — the opponent
 *     feels out the ball, builds, then tries to finish. One parameter,
 *     `pace`, drives racket speed, stroke choice and placement risk.
 *
 *  3. HONEST MISTAKES. The bot has no "random whiff" die roll any more.
 *     It misreads spin (and then tilts the face the wrong way), it
 *     overhits under pressure, it goes for too much when it smells a
 *     winner. The error comes out of the same physics the player uses.
 *
 *  Paddle-only animation with smoother movement,
 *  follow-through, improved variety
 * ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
 *  LEVELS
 * ------------------------------------------------------------------- */
const AI_LEVELS = [
  {
    id: 0, name: 'EASY', tag: 'EASY', ru: 'ЛЁГКИЙ', elo: 900, style: 'PUSHER',
    react: 0.42, move: 1.7, posErr: 0.30, skill: 0.32, spinRead: 0.18,
    aggro: 0.08, variety: 0.30,
    vmagMin: 2.0, vmagMax: 3.8, paceOpen: 0.16, paceRamp: 0.02, paceMax: 0.32,
    windup: 0.38, errBase: 0.37, errPress: 0.16, deepness: 0.48, placeSkill: 0.12,
    counterRate: 0.01, smashRate: 0.01, dropRate: 0.02,
  },
  {
    id: 1, name: 'MEDIUM', tag: 'MEDIUM', ru: 'СРЕДНИЙ', elo: 1400, style: 'ALLROUND',
    react: 0.28, move: 2.55, posErr: 0.16, skill: 0.58, spinRead: 0.45,
    aggro: 0.25, variety: 0.60,
    vmagMin: 3.2, vmagMax: 6.8, paceOpen: 0.26, paceRamp: 0.045, paceMax: 0.62,
    windup: 0.30, errBase: 0.19, errPress: 0.09, deepness: 0.70, placeSkill: 0.36,
    counterRate: 0.08, smashRate: 0.20, dropRate: 0.05,
  },
  {
    id: 2, name: 'HARD', tag: 'HARD', ru: 'СЛОЖНЫЙ', elo: 1900, style: 'ATTACK',
    react: 0.17, move: 3.8, posErr: 0.06, skill: 0.79, spinRead: 0.72,
    aggro: 0.54, variety: 0.78,
    vmagMin: 5.0, vmagMax: 12.0, paceOpen: 0.38, paceRamp: 0.075, paceMax: 0.90,
    windup: 0.235, errBase: 0.075, errPress: 0.055, deepness: 0.86, placeSkill: 0.64,
    counterRate: 0.26, smashRate: 0.58, dropRate: 0.08,
  },
  {
    id: 3, name: 'WTF', tag: 'WTF', ru: 'WTF', elo: 2700, style: 'ATTACK',
    react: 0.09, move: 5.8, posErr: 0.023, skill: 0.95, spinRead: 0.965,
    aggro: 0.82, variety: 0.90,
    vmagMin: 6.6, vmagMax: 16.2, paceOpen: 0.50, paceRamp: 0.105, paceMax: 1.0,
    windup: 0.165, errBase: 0.017, errPress: 0.019, errPressAbs: true, deepness: 0.94, placeSkill: 0.94,
    counterRate: 0.66, smashRate: 0.92, dropRate: 0.135,
  },
];

/* Удары, которые считаются АТАКОЙ для серии агрессии. Бот не может лупить
 * ими подряд бесконечно: со третьего атакующего мяча к шансу ошибки
 * добавляется 1.5 %, и так до +4 %. Подставка/подрезка/свеча серию рвут. */
const AI_ATTACK_STROKES = new Set(['SMASH', 'COUNTER', 'LOOP', 'DRIVE', 'FLICK']);

/* ---------------------------------------------------------------------
 *  TACTICS
 * ------------------------------------------------------------------- */
const AI_TACTICS = {
  FEEL:   { id: 'FEEL',   pace: 0.72, risk: 0.30, depth: 0.55, wide: 0.35 },
  BUILD:  { id: 'BUILD',  pace: 0.92, risk: 0.50, depth: 0.80, wide: 0.55 },
  PRESS:  { id: 'PRESS',  pace: 1.12, risk: 0.78, depth: 0.88, wide: 0.80 },
  SAFE:   { id: 'SAFE',   pace: 0.55, risk: 0.16, depth: 0.60, wide: 0.25 },
  DEFEND: { id: 'DEFEND', pace: 0.62, risk: 0.22, depth: 0.72, wide: 0.30 },
};

/* Serve honesty table, per level: how hard the serve may leave the bat,
 * how far off-centre it may pitch, and how much bounce kick survives the
 * tame clamp. The complaint was real: a mail-slot serve + topspin kick is a
 * fair weapon only against someone who covers the table width by design. */
const AI_SERVE_CAPS = [
  { vmag: 4.4, orbit: PH.T_HALF_WID * 0.44, kick: 0.40 },  // EASY
  { vmag: 6.0, orbit: PH.T_HALF_WID * 0.55, kick: 0.55 },  // MEDIUM
  { vmag: 9.6, orbit: PH.T_HALF_WID * 0.70, kick: 0.85 },  // HARD
  { vmag: 11.0, orbit: PH.T_HALF_WID * 0.80, kick: 0.95 }, // WTF
];

const AI_BACKSWING = {
  LOOP:    { back: 0.30, lift: -0.16, side: 0.10, face: -0.30, name: 'накат' },
  COUNTER: { back: 0.18, lift: -0.06, side: 0.06, face: -0.18, name: 'контр' },
  DRIVE:   { back: 0.22, lift: -0.04, side: 0.08, face: -0.14, name: 'накат' },
  SMASH:   { back: 0.34, lift: 0.22, side: 0.08, face: -0.22, name: 'смеш' },
  FLICK:   { back: 0.10, lift: 0.04, side: 0.06, face: -0.10, name: 'флик' },
  PUSH:    { back: 0.06, lift: 0.08, side: 0.04, face: 0.18, name: 'подст' },
  CHOP:    { back: 0.20, lift: 0.14, side: 0.08, face: 0.24, name: 'чоп' },
  BLOCK:   { back: 0.04, lift: 0.00, side: 0.02, face: 0.00, name: 'блок' },
  LOB:     { back: 0.26, lift: 0.18, side: 0.06, face: -0.12, name: 'свеча' },
  HOOK:    { back: 0.18, lift: -0.04, side: 0.28, face: -0.14, name: 'хук' },
  FADE:    { back: 0.18, lift: -0.04, side: -0.28, face: -0.14, name: 'feyd' },
  DROP:    { back: 0.08, lift: 0.06, side: 0.04, face: 0.12, name: 'drop' },
};

function shotHitsNet(ball, racket) {
  const tv = V3.clone(ball.v), tw = V3.clone(ball.w), sv = V3.new(), sn = V3.new();
  strokeFrame(racket, 0, 0, 1, sv, sn);
  impactRacket(tv, tw, sn, sv, racket.quality, racket.rubber || {});
  const chk = {};
  predict(V3.clone(ball.p), tv, tw, { dt: PH.SIM_DT, maxT: 1.2, stopOnFirstBounce: true, out: chk });
  return !!chk.hitNet;
}

function makeRacket(side, archId, o) {
  const A = ARCH[archId] || ARCH.DRIVE;
  const st = STROKES[archId] || STROKES.DRIVE;
  return {
    stroke: st, arch: A, side,
    elev: o.elev !== undefined ? o.elev : A.elev,
    contact: o.contact !== undefined ? o.contact : A.contact,
    azSwing: o.azSwing || 0, azFace: o.azFace || 0,
    vmag: o.vmag !== undefined ? o.vmag : 11,
    aim: o.aim, quality: o.quality !== undefined ? o.quality : 0.85,
    isServe: !!o.isServe,
    netClear: o.netClear !== undefined ? o.netClear
      : (archId === 'LOB' ? 0.50 : archId === 'DROP' ? 0.035 : archId === 'SMASH' ? 0.04
        : (archId === 'PUSH' || archId === 'CHOP') ? 0.115 : 0.055),
    rubber: A.soft ? { e: PH.E_RACKET * A.soft, mu: PH.MU_RACKET, et: PH.ET_RACKET * (0.5 + 0.5 * A.soft) } : null,
    vR: V3.new(), normal: V3.new(0, 0, side > 0 ? -1 : 1),
    power: 0.6, spinIntent: 0.5, swipe: null,
  };
}

class OpponentAI {
  constructor(levelIndex = 2) {
    this.side = -1;
    this.faceNormal = V3.new(0, 0, 1);
    this.levelIndex = clamp(levelIndex, 0, AI_LEVELS.length - 1);
    this.L = AI_LEVELS[this.levelIndex];
    this.maxSpeed = this.L.move;
    this.pace = this.L.paceOpen;

    // State
    this.phase = 'IDLE';
    this.plan = null;
    this.commit = null;
    this.readT = 0;
    this.seenBallId = -1;
    this.exchange = 0;
    this.tactic = AI_TACTICS.FEEL;
    this.mood = 0;
    this.pressure = 0;
    this.handicap = 1;
    /* Серия агрессии (атакующих ударов подряд) и тренд игрока между
     * матчами — оба читаются в ошибке/тактике, оба живут вне розыгрыша. */
    this.aggrStreak = 0;
    this.trendRaw = 0;
    this.stats = OpponentAI._blankStats();

    // Home position
    this.home = V3.new(0, PH.TABLE_Y + 0.25, -1.45);
    this.target = V3.new(0, PH.TABLE_Y + 0.25, -1.45);
    this.pos = V3.clone(this.home);
    this.lastPos = V3.new(0, PH.TABLE_Y + 0.25, -1.45);
    this.vel = V3.new();

    // Swing state
    this.anim = { windup: 0, swing: 0, lean: 0 };
    this.swingAt = 0;
    this.backswingStart = 0;
    this.backswingPose = null;
    this.strokeHistory = [];

    // For smoother movement
    this._moveSmooth = V3.clone(this.home);
    this._poseSmooth = { windup: 0, swing: 0 };

    // Prediction cache
    this._pred = {};
    this._q = {};
    /* Чтение траектории и решение разведены: _percept — прогноз, по которому
     * бот двигается, _reactUntil — дедлайн реакции уровня. */
    this._percept = null;
    this._reactUntil = -Infinity;
    this._lastShort = false;
    /* Tests inject a deterministic stream here; the game never does. */
    this.rng = null;
  }

  _rand() { return this.rng ? this.rng() : Math.random(); }

  /* Симметричное и нормальное распределения из ТОГО ЖЕ потока, что _rand.
   * Глобальные rnd()/rndSym()/gauss() живут на Math.random: пока тактика и
   * выбор удара шли через них, матч нельзя было повторить, а юнит-тест —
   * проверить. */
  _sym(a) { return (this._rand() * 2 - 1) * a; }
  _gauss() {
    const u = Math.max(this._rand(), 1e-6);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * this._rand());
  }

  /** Счётчики, которые сбрасываются на матч (и на точку — в game.stats они тоже есть) */
  static _blankStats() {
    return {
      shots: 0, errors: 0, winners: 0, sumSpeed: 0, maxSpeed: 0,
      net: 0, long: 0,                    // фасовка ошибок: 50/50 в сетку / длинные
      sumOut: 0, maxOut: 0, outN: 0,      // скорость ОТВЕТА (не входящего мяча)
      sumRatio: 0, ratioN: 0,             // сила ответа / сила прилёта
      pressureErr: 0, errPos: null, aggrErr: 0,
      byStroke: {},
    };
  }

  /** Set level and update parameters */
  setLevel(idx) {
    /* Приводим индекс к числу: из UI уровень приходит и строкой ('2'), а
     * строка ломала сравнение levelIndex === AI_LEVELS.length - 1 в тренде. */
    const n = Math.round(Number(idx));
    this.levelIndex = clamp(Number.isFinite(n) ? n : 0, 0, AI_LEVELS.length - 1);
    this.L = AI_LEVELS[this.levelIndex];
    this.maxSpeed = this.L.move;
    this.pace = this.L.paceOpen;
  }

  /** Адаптация между матчами: -1 (игрок проигрывает) … +1 (игрок выигрывает).
   *  Внутри розыгрыша её нет и быть не может — это «резиновая сложность».
   *  Сила правки: ±4 % к агрессии и точности, у WTF — не больше ±2 %,
   *  чтобы уровень оставался приколом, а не подкрученным ботом. */
  setTrend(v) { this.trendRaw = clamp(Number(v) || 0, -1, 1); }

  _trendAmp() {
    const cap = this.levelIndex === AI_LEVELS.length - 1 ? 0.02 : 0.04;
    return clamp(this.trendRaw, -1, 1) * cap;
  }

  /** Сводка матча по боту: уровень, ошибки (сетка/длинный), скорость
   *  ответа и его отношение к прилёту, баланс ударов, давление в момент
   *  ошибки. Уходит в аналитику оболочки вместе с matchEnd (см. 92_embed). */
  telemetry() {
    const s = this.stats, n = Math.max(1, s.outN);
    const by = {};
    for (const k of Object.keys(s.byStroke)) by[k] = s.byStroke[k];
    return {
      level: this.levelIndex, name: this.L.name, style: this.L.style,
      shots: s.shots, errors: s.errors, net: s.net, long: s.long,
      avgOut: +(s.sumOut / n).toFixed(2), maxOut: +s.maxOut.toFixed(2),
      ratio: +(s.sumRatio / Math.max(1, s.ratioN)).toFixed(2),
      pressureErr: +(s.pressureErr / Math.max(1, s.errors)).toFixed(2),
      aggrErr: s.aggrErr, errPos: s.errPos || null,
      byStroke: by, trend: +this.trendRaw.toFixed(2),
    };
  }

  /** Full reset between matches */
  reset() {
    this.phase = 'IDLE'; this.plan = null; this.commit = null;
    this.readT = 0; this.seenBallId = -1; this._seenNetTouched = false; this._tacticRally = 0;
    this.maxSpeed = this.L.move;
    this.exchange = 0; this.pace = this.L.paceOpen;
    this.tactic = AI_TACTICS.FEEL;
    this.mood = 0; this.pressure = 0; this.handicap = 1;
    this.aggrStreak = 0;
    this._percept = null; this._reactUntil = -Infinity; this._lastShort = false;
    this.stats = OpponentAI._blankStats();
    V3.copy(this.target, this.home);
    V3.copy(this.pos, this.home);
    V3.set(this.faceNormal, 0, 0, 1);
    V3.copy(this.lastPos, this.home);
    V3.zero(this.vel);
    V3.copy(this._moveSmooth, this.home);
    this.anim = { windup: 0, swing: 0, lean: 0 };
    this.strokeHistory = [];
    this.backswingPose = null;
  }

  /** Called by the game whenever a point finishes */
  onPointEnd(who) {
    this.exchange = 0;
    this.pace = this.L.paceOpen;
    this.plan = null; this.commit = null;
    this.phase = 'IDLE';
    this.mood = clamp(this.mood + (who > 0 ? -0.22 : 0.18), -1, 1);
    this.tactic = this.rollTactic();
    this.backswingPose = null;
    this.aggrStreak = 0;
  }

  /** Scoreboard awareness */
  setPressure(myScore, theirScore, target) {
    const near = Math.max(myScore, theirScore) / Math.max(4, target - 1);
    const tight = 1 - clamp(Math.abs(myScore - theirScore) / 4, 0, 1);
    this.pressure = clamp(near * 0.6 + tight * 0.4, 0, 1) * clamp(near, 0, 1);
  }

  /** Dynamic difficulty. The window matches MatchDirector's escalating one:
   *  deep rescues must survive the clamp, or the director is a dead letter. */
  setHandicap(h) { this.handicap = clamp(h, 0.68, 1.08); }

  /* Pitch the racket face down/up around the world X axis without touching
   * its azimuth — the execution-error injection lives in this one degree of
   * freedom (and in racket speed). */
  static _pitchFace(n, deg) {
    const s = Math.sin(deg * DEG), c = Math.cos(deg * DEG);
    return V3.new(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
  }

  /**
   * Execution error — the reason even a prepared swing sometimes goes into
   * the net or sails long. `errBase`/`errPress` are the level's honest knobs
   * and this is THE reader of them: a serve rolls a third of the rate,
   * scoreboard pressure adds errPress on top, and a director handicap below
   * 1 widens everything. The bot does not "decide" the outcome it wants —
   * it perturbs the solved racket: face closed + slower arm (into the net)
   * or face open + faster arm (sails long), escalating until the SIMULATION
   * of exactly what the game will apply really faults. A perturbation that
   * still lands in is not an error, so after five escalations the solved
   * racket is returned untouched.
   */
  /* Доворот готового кадра подачи вокруг вертикальной оси так, чтобы
   * замеренное predict приземление (второй отскок) ушло из кромочной зоны
   * к центру. Кадр поворачивается целиком (normal и vR), поэтому удар
   * сохраняет свой характер; принимается только вариант, который уже по
   * быстрому rep легален (своя половина -> второй отскок на столе, без
   * сетки) и подтверждён _flightLegal. Null, если лучше не стало. */
  _yawServeToWidth(ball, racket, probe, cap, bx0) {
    const rotY = (v, ang) => {
      const c = Math.cos(ang), sn = Math.sin(ang);
      return V3.new(v.x * c + v.z * sn, v.y, -v.x * sn + v.z * c);
    };
    let best = null, bestAbs = Math.abs(bx0);
    for (const a of [0.10, 0.22, 0.38, 0.55]) {
      for (const dir of [-Math.sign(bx0), Math.sign(bx0)]) {
        const cand = { ...racket, normal: rotY(racket.normal, dir * a), vR: rotY(racket.vR, dir * a) };
        const rep = probe(cand);
        const bx = rep && rep.b2 ? rep.b2.x : null;
        if (bx === null || Math.abs(bx) >= bestAbs) continue;
        if (rep.hitNet || !rep.landed || Math.sign(rep.landed.z) !== Math.sign(ball.p.z)) continue;
        best = cand; bestAbs = Math.abs(bx);
        if (bestAbs <= cap) break;
      }
      if (best && bestAbs <= cap) break;
    }
    return best && this._flightLegal(ball, best, true) ? best : null;
  }

  applyExecutionError(game, racket, isServe) {
    if (!racket || racket.valid === false || !game || !game.ball) return racket;
    const L = this.L;
    const pressure = isServe ? 0 : clamp(this.pressure, 0, 1);
    /* Базовый процент уровня — не единственная причина ошибки. К нему
     * добавляются те же условия, что и у человека: очень быстрый мяч (+3–5 %),
     * короткий мяч у сетки (+2 %) и собственная серия атаки (+1.5–4 %).
     * У WTF errPress — АБСОЛЮТНЫЙ процент под давлением (1.7 % → 1.9 %),
     * иначе шкала уехала бы в 3.6 % и «почти идеальный» перестал бы им быть. */
    const inSpeed = isServe ? 0 : V3.len(game.ball.v);
    const fastAdd = isServe ? 0 : clamp((inSpeed - 14) / 6, 0, 1) * 0.05;
    const shortAdd = isServe || !this._lastShort ? 0 : 0.02;
    const streakAdd = isServe ? 0 : clamp((this.aggrStreak - 2) * 0.015, 0, 0.04);
    const base = isServe ? L.errBase / 3
      : (L.errPressAbs ? lerp(L.errBase, L.errPress, pressure) : L.errBase + L.errPress * pressure);
    const rate = clamp((base + fastAdd + shortAdd + streakAdd) / Math.max(this.handicap, 0.70), 0, 0.85);
    if (this._rand() >= rate) return racket;
    const b = game.ball;
    const isFault = (rk) => {
      /* The same sequence tryAiHit/serveAiHit applies: contact starts one
       * ball radius off the face, impactRacket mutates throwaway copies of
       * the ball, and the production predict() judges the flight. */
      const v = V3.clone(b.v), w = V3.clone(b.w);
      if (!impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {})) return false;
      const p = V3.addScaled(V3.clone(b.p), b.p, rk.normal, PH.R * 1.05);
      const o = predict(p, v, w, { dt: 1 / 240, maxT: 2.4, stopAfterBounces: 2, out: this._q });
      if (o.diverged) return true;
      if (isServe) {
        /* Legal serve: own side first, then the player's court. */
        return o.hitNet || !o.landed || o.landed.z >= 0 ||
          !o.b2 || o.b2.z < 0 || o.b2.z > PH.T_HALF_LEN + 0.005 ||
          Math.abs(o.b2.x) > PH.T_HALF_WID + 0.005;
      }
      /* Legal rally return: one bounce inside the player's court. */
      return o.hitNet || !o.landed || o.landed.z < 0 ||
        o.landed.z > PH.T_HALF_LEN + 0.005 || Math.abs(o.landed.x) > PH.T_HALF_WID + 0.005;
    };
    /* Честная монетка: половина ошибок — в сетку, половина — длинные. */
    const kind = this._rand() < 0.50 ? 'net' : 'long';
    for (let step = 1; step <= 5; step++) {
      const bad = Object.assign({}, racket);
      if (kind === 'net') {
        bad.normal = OpponentAI._pitchFace(racket.normal, 3.2 * step + 1.5);
        bad.vR = V3.mul(V3.clone(racket.vR), racket.vR, 1 - 0.055 * step);
      } else {
        bad.normal = OpponentAI._pitchFace(racket.normal, -(2.6 * step + 1.5));
        bad.vR = V3.mul(V3.clone(racket.vR), racket.vR, 1 + 0.060 * step);
      }
      if (isFault(bad)) {
        this.stats.errors++;
        if (kind === 'net') this.stats.net++; else this.stats.long++;
        this.stats.pressureErr += pressure;
        if (this.aggrStreak > this.stats.aggrErr) this.stats.aggrErr = this.aggrStreak;
        /* Где и под каким давлением родилась ошибка — для телеметрии матча. */
        const bp = game.ball.p;
        this.stats.errPos = {
          x: +bp.x.toFixed(2), z: +bp.z.toFixed(2), speed: Math.round(inSpeed * 3.6),
          px: game.player && game.player.pos ? +game.player.pos.x.toFixed(2) : null,
        };
        bad.aiError = kind;
        return bad;
      }
    }
    return racket;   // nothing we dialed in actually missed — it was never an error
  }

  /* Lenient legality check against the very simulation the game will run:
   * would this racket, applied to the live ball, play a legal ball?
   * Unlike the error-injection checker this does NOT veto net cords — a
   * cord that drops over the net is a lucky-but-legal ball. Passing
   * `racket.valid === false` is an automatic refuse: refineRacket already
   * told us the face envelope had no answer. */
  _flightLegal(b, racket, isServe) {
    if (!racket || racket.valid === false) return false;
    const v = V3.clone(b.v), w = V3.clone(b.w);
    if (!impactRacket(v, w, racket.normal, racket.vR, racket.quality, racket.rubber || {})) return false;
    const p = V3.addScaled(V3.clone(b.p), b.p, racket.normal, PH.R * 1.05);
    const o = predict(p, v, w, { dt: 1 / 240, maxT: 2.6, stopAfterBounces: 2, out: this._q });
    if (o.diverged || !o.landed) return false;
    if (isServe) {
      return o.landed.z < 0 && o.landed.z > -PH.T_HALF_LEN - 0.005 &&
        Math.abs(o.landed.x) <= PH.T_HALF_WID + 0.005 &&
        !!o.b2 && o.b2.z > 0 && o.b2.z <= PH.T_HALF_LEN + 0.005 &&
        Math.abs(o.b2.x) <= PH.T_HALF_WID + 0.005;
    }
    return o.landed.z >= 0 && o.landed.z <= PH.T_HALF_LEN + 0.005 &&
      Math.abs(o.landed.x) <= PH.T_HALF_WID + 0.005;
  }

  /* The solver occasionally comes back with mark `valid === false` — most
   * often at the extremes, where the level's vmag is huge and the face
   * pitch the launch needs slips outside the racket cone (a ROOKIE block
   * sailing three metres long, a LEGEND counter dying in its own net).
   * Shipping that puts out-balls in play without even the honesty of an
   * aiError tag. So when the solved stroke would not play a legal ball,
   * climb down the archetype ladder — a soft block/push carries an open
   * face and a modest tempo, and can find a legal face for anything that
   * is in reach at all. The aim is pulled toward the middle and the pace
   * to a rally tempo; legality beats tactics. The same pace cut the
   * handicap applies elsewhere is applied BEFORE the check, so what is
   * verified is what ships. Only when the whole ladder fails — a ball that
   * is simply unreturnable — is the original shipped, tagged as the miss
   * it is. */
  _ensureLegal(game, racket, plan, archId, isServe) {
    const ball = game.ball;
    if (this._flightLegal(ball, racket, isServe)) return racket;
    const L = this.L;
    const cut = this.handicap < 1 ? 1 - (1 - this.handicap) * 0.45 : 1;
    const aim = isServe
      ? { x: 0, z: PH.T_HALF_LEN * 0.60 }
      : { x: clamp(((plan.aim && plan.aim.x) || 0) * 0.5, -0.42, 0.42), z: PH.T_HALF_LEN * 0.62 };
    const ladder = isServe
      ? ['SERVE_TOP', 'SERVE_TOP', 'SERVE_BACK']
      : ['BLOCK', 'PUSH', 'LOOP'];
    for (let t = 0; t < ladder.length; t++) {
      const A2 = ARCH[ladder[t]];
      if (!A2) continue;
      const cand = makeRacket(-1, ladder[t], {
        elev: A2.elev, contact: A2.contact,
        azSwing: 0, azFace: 0,
        vmag: isServe
          ? clamp(AI_SERVE_CAPS[this.levelIndex].vmag * (0.85 - 0.11 * t), 3.6, AI_SERVE_CAPS[this.levelIndex].vmag)
          : clamp(plan.speed * 0.55, 2.2, Math.min(4.6, Math.max(3.0, L.vmagMin + 1.2))),
        aim, quality: 0.8 + 0.1 * L.skill,
        isServe, netClear: isServe ? 0.06 : 0.12,
      });
      strokeFrame(cand, 0, 0, 1, cand.vR, cand.normal);
      const solved = refineRacket(ball.p, ball.v, ball.w, cand,
        Math.max(L.skill, 0.85), cand.quality);
      if (solved && solved.vR && cut < 1) V3.mul(solved.vR, solved.vR, cut);
      if (this._flightLegal(ball, solved, isServe)) return solved;
    }
    /* Nothing on the ladder solves legally — the incoming ball is truly
     * unreturnable from here. Ship the best-effort stroke tagged as the
     * miss it honestly is, so stats and effects see it for what it is. */
    if (!racket.aiError) {
      const v = V3.clone(ball.v), w = V3.clone(ball.w);
      let dir = 'long';
      if (impactRacket(v, w, racket.normal, racket.vR, racket.quality, racket.rubber || {})) {
        const o = predict(V3.clone(ball.p), v, w, { dt: 1 / 240, maxT: 2.6, out: this._q });
        const wantZ = isServe ? 0 : 0;
        dir = (o.hitNet || !o.landed || (isServe ? o.landed.z <= wantZ : o.landed.z < wantZ)) ? 'net' : 'long';
      }
      racket.aiError = dir;
      this.stats.errors++;
    }
    return racket;
  }

  rollTactic() {
    const L = this.L;
    const r = this._rand();
    const aggro = clamp(L.aggro + this.mood * 0.12 - this.pressure * 0.10 + this._trendAmp(), 0, 1);
    if (L.style === 'PUSHER') return r < 0.72 ? AI_TACTICS.SAFE : AI_TACTICS.FEEL;
    if (r < 0.26 - aggro * 0.16) return AI_TACTICS.SAFE;
    if (r < 0.62 - aggro * 0.22) return AI_TACTICS.FEEL;
    if (r < 0.90 - aggro * 0.22) return AI_TACTICS.BUILD;
    return AI_TACTICS.PRESS;
  }

  /* ==================================================================
   *  PERCEPTION
   * ================================================================== */

  /** Where will the ball be when it is comfortable to hit it, and when? */
  computePlan(game) {
    const ball = game.ball;
    const o = this._pred;
    predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w), {
      dt: 1 / 240, maxT: 2.4, stopZ: -PH.T_HALF_LEN - 0.26, stopDir: -1,
      stopAtPlane: false, out: o,
    });

    if (o.landed && o.landed.z < 0) {
      const inSpeed = V3.len(ball.v);
      const topIn = this.side * ball.w.x;
      let zHit = -PH.T_HALF_LEN
        - clamp(0.10 + inSpeed * 0.030 + Math.max(0, topIn) * 0.00022, 0.08, 0.62);
      if (o.landed.z > -0.62) zHit = Math.max(zHit, o.landed.z - 0.52);
      zHit = clamp(zHit, -2.05, -0.95);

      const q = this._q;
      predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w),
        { dt: 1 / 240, maxT: 2.4, stopZ: zHit, stopDir: -1, stopAtPlane: true, out: q });

      let interceptT = q.endT;
      const sinceBounce = interceptT - o.landed.t;
      if (sinceBounce < 0.055) {
        interceptT = o.landed.t + clamp(0.055 + (0.16 - inSpeed * 0.008), 0.055, 0.19);
        predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w),
          { dt: 1 / 240, maxT: interceptT, out: q });
      }
      const simNow = Number.isFinite(game.strokeTime) ? game.strokeTime : game.time;
      /* Короткий мяч у сетки — ещё один честный источник ошибки (см.
       * applyExecutionError): его читают один раз на мяч, здесь. */
      this._lastShort = o.landed.z > -0.55;
      return {
        x: q.end.x,
        y: clamp(q.end.y, PH.TABLE_Y + 0.04, PH.TABLE_Y + 0.80),
        z: clamp(q.end.z, -2.15, -1.00),
        t: simNow + interceptT,
        speed: V3.len(q.endV),
        bounceT: o.landed.t,
        short: o.landed.z > -0.55,
        wide: Math.abs(o.landed.x) > PH.T_HALF_WID * 0.58,
        willLandIn: Math.abs(o.landed.x) <= PH.T_HALF_WID + PH.R,
        errUnitX: this._gauss(),
        errUnitY: this._gauss(),
      };
    }
    if (o.reach) {
      const simNow = Number.isFinite(game.strokeTime) ? game.strokeTime : game.time;
      this._lastShort = false;
      return {
        x: o.reach.x, y: clamp(o.reach.y, PH.TABLE_Y + 0.04, PH.TABLE_Y + 0.95),
        z: clamp(o.reach.z, -2.45, -1.05),
        t: simNow + o.reachT, speed: 8, bounceT: 0, short: false, wide: false,
        willLandIn: true,
        errUnitX: this._gauss(),
        errUnitY: this._gauss(),
      };
    }
    this._lastShort = false;
    return null;
  }

  /** Anticipation noise — coherent per-shot read error that sharpens as ball approaches */
  noisyTarget(plan, game) {
    const L = this.L;
    const simNow = Number.isFinite(game.strokeTime) ? game.strokeTime : game.time;
    const lead = clamp(plan.t - simNow, 0, 1.2);
    const blur = L.posErr * (0.35 + lead * 1.15) / this.handicap;
    const ex = Number.isFinite(plan.errUnitX) ? plan.errUnitX : 0;
    const ey = Number.isFinite(plan.errUnitY) ? plan.errUnitY : 0;
    return {
      x: clamp(plan.x + ex * blur, -1.12, 1.12),
      y: clamp(plan.y + ey * blur * 0.42, PH.TABLE_Y - 0.05, PH.TABLE_Y + 0.96),
      z: clamp(plan.z - 0.055, -2.5, -1.05),
    };
  }

  /* ==================================================================
   *  DECISION
   * ================================================================== */

  /** Pick the stroke */
  pickStroke(game, plan) {
    const L = this.L, T = this.tactic, ball = game.ball;
    const hNet = plan.y - PH.NET_TOP;
    const hTable = plan.y - PH.TABLE_Y;
    const topspin = this.side * ball.w.x;
    const backspin = topspin < -140;
    const heavyTop = topspin > 230;
    const inSpeed = plan.speed;
    const deepMe = plan.z < -PH.T_HALF_LEN - 0.52;
    const aggro = clamp((L.aggro * 0.7 + T.risk * 0.5) * (0.85 + this.pace * 0.3)
      + this.mood * 0.08 - this.pressure * 0.07 + this._trendAmp() * 0.8, 0, 1.1);
    const r = this._rand();

    if (hNet > 0.17 && inSpeed < 13.5) {
      if (r < L.smashRate * (0.55 + aggro * 0.6)) return 'SMASH';
      return 'DRIVE';
    }
    if (deepMe) {
      if (hTable > 0.26 && r < 0.42 + aggro * 0.34) return 'LOOP';
      if (r < 0.30) return 'LOB';
      return r < 0.62 ? 'DRIVE' : 'CHOP';
    }
    if (inSpeed > 17.5) {
      const block = 0.78 - aggro * 0.42;
      if (r < block) return 'BLOCK';
      return r < block + L.counterRate ? 'COUNTER' : 'DRIVE';
    }
    if (backspin) {
      if (hTable < 0.10 && plan.short) return r < 0.30 + aggro * 0.35 ? 'FLICK' : 'PUSH';
      if (r < 0.30 + aggro * 0.55) return 'LOOP';
      return 'PUSH';
    }
    if (plan.short && hTable < 0.16) {
      if (r < L.dropRate) return 'DROP';
      return r < 0.26 + aggro * 0.42 ? 'FLICK' : 'PUSH';
    }
    if (heavyTop && r < L.counterRate + aggro * 0.2) return 'COUNTER';

    if (L.style === 'PUSHER' && r < 0.55 - aggro * 0.3) return 'PUSH';
    if (r < 0.07 * L.variety * T.wide) return this._rand() < 0.5 ? 'HOOK' : 'FADE';
    if (r < 0.07 * L.variety * T.wide + 0.08 * (1 - aggro)) return 'PUSH';

    if (r < 0.34 + aggro * 0.46) return 'LOOP';
    return 'DRIVE';
  }

  /** Where to put it */
  pickTarget(game, plan, archId) {
    const L = this.L, T = this.tactic;
    const px = game.player.pos.x;
    const playerSide = sign(px || this._sym(1));
    const skill = clamp(L.placeSkill * this.handicap + this._trendAmp(), 0, 1);

    const roll = this._rand();
    let wantX;
    if (roll < 0.16 + (1 - skill) * 0.25) {
      wantX = px * 0.85;
    } else if (roll < 0.30) {
      wantX = px * 1.25;
    } else if (roll < 0.55 - skill * 0.3) {
      wantX = -playerSide * 0.70;
    } else if (roll < 0.75 - skill * 0.25) {
      wantX = playerSide * 0.85;
    } else {
      wantX = this._sym(0.80);
    }

    let wantZ;
    if (this.pace > 0.85) {
      wantZ = -PH.T_HALF_LEN * (0.65 + 0.30 * this._rand());
    } else if (T.depth > 0.7) {
      wantZ = -PH.T_HALF_LEN * (0.50 + 0.40 * this._rand());
    } else {
      wantZ = lerp(-0.55, -PH.T_HALF_LEN * 0.75, T.depth + 0.2 * this._rand());
    }

    if (plan.wide && roll < 0.4 + T.wide * 0.4) {
      wantX = playerSide * sign(wantX || 1) * (0.75 + 0.20 * this._rand());
    }

    return { x: wantX, z: Math.abs(wantZ) };
  }

  /** Серия агрессии: атакующий удар копит счётчик, любой другой его рвёт.
   *  Отдельным методом — чтобы штраф к ошибке можно было проверить тестом,
   *  не собирая целый swing с решателем ракетки. */
  noteStroke(archId) {
    this.aggrStreak = AI_ATTACK_STROKES.has(archId) ? this.aggrStreak + 1 : 0;
    return this.aggrStreak;
  }

  /* ==================================================================
   *  SWING EXECUTION — gameplay owns the impact
   * ================================================================== */

  /** Build a solved stroke without mutating the live ball */
  swing(game) {
    const now = Number.isFinite(game.strokeTime) ? game.strokeTime : game.time;
    if (!this.commit || now < this.swingAt) return null;

    const ball = game.ball;
    const L = this.L;
    const plan = this.commit;

    // Determine stroke archetype
    const archId = this.commit.archId || 'DRIVE';
    const A = ARCH[archId] || ARCH.DRIVE;

    // Compute racket state
    let racket = makeRacket(-1, archId, {
      elev: A.elev,
      contact: A.contact,
      azSwing: 0,
      azFace: 0,
      vmag: clamp(plan.speed * (0.7 + 0.3 * this.pace), L.vmagMin, L.vmagMax),
      aim: plan.aim,
      quality: 0.75 + 0.20 * L.skill,
      isServe: false,
    });

    // Solve on copies. The game applies the returned impact exactly once.
    strokeFrame(racket, 0, 0, 1, racket.vR, racket.normal);
    racket = refineRacket(ball.p, ball.v, ball.w, racket, L.skill, racket.quality);
    /* The rescue also bites into PACE, not only into error chance: at the
     * deepest dig the bot's ball is ~14% slower, which is exactly what
     * "больше мячей должно отбиваться" asks for. Applied BEFORE the
     * legality check below: what is verified is what ships. */
    if (this.handicap < 1 && racket && racket.vR)
      V3.mul(racket.vR, racket.vR, 1 - (1 - this.handicap) * 0.45);
    /* A solve that would sail long or dive into the net is not a stroke —
     * verify against the real flight and climb down to a safer archetype
     * if the first answer was hot garbage (solver extremes, mostly). */
    racket = this._ensureLegal(game, racket, plan, archId, false);
    /* Серия агрессии: атака копит счётчик, защита его рвёт. Именно его
     * applyExecutionError читает как растущий штраф к ошибке — бот не может
     * лупить смашами подряд без права на промах. */
    this.noteStroke(archId);
    /* Perfect on paper is not perfect on the table: the solved stroke can
     * still be misexecuted (net cord of the wrong kind, long sail). */
    racket = this.applyExecutionError(game, racket, false);
    V3.copy(this.faceNormal, racket.normal);
    this.lastStrokeId = archId;
    this.phase = 'SWING';
    this.anim.swing = 1;
    this.plan = null;
    this.commit = null;

    // Record for stats
    this.stats.shots++;
    this.stats.sumSpeed += V3.len(ball.v);
    if (V3.len(ball.v) > this.stats.maxSpeed) this.stats.maxSpeed = V3.len(ball.v);
    this.stats.byStroke[archId] = (this.stats.byStroke[archId] || 0) + 1;
    /* Скорость ОТВЕТА и её отношение к прилётевшему мячу — телеметрия
     * «бот не бьёт вдвое сильнее без ограничений»: меряем тем же импульсом,
     * который применит игра. */
    const vv = V3.clone(ball.v), ww = V3.clone(ball.w), inc = V3.len(ball.v);
    if (impactRacket(vv, ww, racket.normal, racket.vR, racket.quality, racket.rubber || {})) {
      const out = V3.len(vv);
      this.stats.sumOut += out; this.stats.outN++;
      if (out > this.stats.maxOut) this.stats.maxOut = out;
      if (inc > 0.5) { this.stats.sumRatio += out / inc; this.stats.ratioN++; }
    }
    this.strokeHistory.push({ archId, time: now, quality: racket.quality });
    if (this.strokeHistory.length > 50) this.strokeHistory.shift();

    return racket;
  }

  /** Serve — solved against both required bounces */
  serve(game) {
    const ball = game.ball;
    const L = this.L;

    // Pick serve type based on context
    const r = this._rand();
    let serveType;
    if (r < 0.35) serveType = 'SERVE_TOP';
    else if (r < 0.60) serveType = 'SERVE_BACK';
    else if (r < 0.80) serveType = 'SERVE_SIDE';
    else serveType = 'SERVE_FAST';

    const A = ARCH[serveType] || ARCH.SERVE_TOP;
    const st = STROKES[serveType] || STROKES.SERVE_TOP;

    const CAP = AI_SERVE_CAPS[this.levelIndex] || AI_SERVE_CAPS[0];

    // Aim — inside the orbit, biased middle; no more mail-slot corners on rookie
    let aimX = clamp(this._sym(0.50), -CAP.orbit, CAP.orbit);
    /* КРАЙ СТОЛА — НЕ ЦЕЛЬ. Слабая подача (НОВИЧОК/ЛЮБИТЕЛЬ, vmag <= 6) и
     * любая сильная боковая прицеливаются не шире половины полуширины:
     * слабый мяч с кромки уходит в аут от малейшей ошибки исполнения, а
     * SERVE_SIDE после отскока добирает боковой увод (Магнус + трение о
     * стол) и «убегает» за боковую линию даже при честном прицеле. Сильной
     * прямой подаче старших уровней широкий прицел оставлен. */
    if (CAP.vmag <= 6.0 || serveType === 'SERVE_SIDE') {
      /* Слабым — ещё уже: у новичка пост-решательная ошибка исполнения и
       * урезание темпа разносят приземление на ±0.3 м шире прицела
       * (замер картой подач), поэтому запас до кромки нужен больше. */
      const safeX = PH.T_HALF_WID * (CAP.vmag <= 6.0 ? 0.44 : 0.48);
      aimX = clamp(aimX, -safeX, safeX);
    }
    const aimZ = PH.T_HALF_LEN * (0.55 + 0.35 * this._rand());

    const racket = makeRacket(-1, serveType, {
      elev: A.elev,
      contact: A.contact,
      azSwing: 0,
      azFace: 0,
      vmag: Math.min(lerp(6, 11, L.skill), CAP.vmag) * (0.85 + 0.15 * this.pace),
      aim: { x: aimX, z: aimZ },
      quality: 0.80 + 0.15 * L.skill,
      isServe: true,
      netClear: 0.055,
    });

    this.lastStrokeId = serveType;

    // Solve the serve (use existing serve solver from game)
    const side = -1;
    const serveCtx = {
      side,
      isServe: true,
      ball: { y: ball.p.y, z: ball.p.z },
      ballSpin: ball.w, ballSpeed: V3.len(ball.v),
      powerScale: 1,
      moveYaw: 0,
      /* The racket falls back to the base rubber when the game has no
         equipment layer (a test harness, a bench, a failed shop init). An AI
         serve must never be the thing that throws. */
      equip: game && game.equip && typeof game.equip.forSide === 'function'
        ? game.equip.forSide(-1) : undefined,
      spinBias: 'norm',
    };

    const m = {
      right: aimX * 0.5,
      up: (A.elev / 66),
      dist: 0.2,
      curl: serveType === 'SERVE_SIDE' ? 0.34 : 0,
      speed: 1.5,
      peakSpeed: 1.5,
      releaseSpeed: 1.5,
      smooth: 0.9,
      straightness: 0.9,
      samples: 10,
      jerk: 0.1,
    };

    const racketFromStroke = deriveStroke(m, serveCtx);
    /* deriveStroke invents its own aim from the synthetic gesture metrics
     * (m.x is unset, so it sanitises to the centre): without this line the
     * placement rolled above never reaches the solver and every serve is
     * aimed within ~8 cm of the centre line at one fixed depth. */
    racketFromStroke.aim = { x: aimX, z: aimZ };
    racketFromStroke.vmag = racket.vmag;
    racketFromStroke.normal = racket.normal;
    racketFromStroke.vR = racket.vR;
    racketFromStroke.rubber = racket.rubber;
    racketFromStroke.quality = racket.quality;
    racketFromStroke.stroke = st;
    racketFromStroke.arch = A;
    racketFromStroke.isServe = true;

    // Use refineRacket for legal serve
    let finalRacket = refineRacket(ball.p, ball.v, ball.w, racketFromStroke,
      this.handicap, racket.quality);

    if (!finalRacket.valid && this.handicap < 0.999) {
      finalRacket = refineRacket(ball.p, ball.v, ball.w, racketFromStroke,
        1, racket.quality);
    }
    /* Pace cut first, verify after: what is checked is what ships. */
    if (this.handicap < 1 && finalRacket && finalRacket.vR)
      V3.mul(finalRacket.vR, finalRacket.vR, 1 - (1 - this.handicap) * 0.45);
    /* A solve can still produce an illegal serve (the rare one that
     * bounces at its own back line and dies short of the far court) —
     * verify against the real flight and retry softer toward the middle
     * before shipping anything. */
    finalRacket = this._ensureLegal(game, finalRacket, null, serveType, true);

    /* ПОСТ-ПРОВЕРКА ШИРИНЫ — тем же predict, что судит легальность, и ПОСЛЕ
     * всех мутаций (урезание темпа гандикапом выше уже применено). Замер
     * картой подач показал: на слабых уровнях решатель систематически
     * недооценивает боковой увод медленной кручёной подачи (длинный полёт,
     * Магнус и отскок с вращением), и мяч с прицелом 0.06 м приземлялся на
     * 0.71 м — у самой кромки. Зажатого прицела мало: проверяем само
     * ПРИЗЕМЛЕНИЕ и, если оно шире безопасной зоны, пере(решаем) с прицелом
     * заметно ближе к центру. Только для слабых уровней и боковых подач —
     * сильная прямая подача мастера в угол остаётся законным оружием. */
    if (CAP.vmag <= 6.0 || serveType === 'SERVE_SIDE') {
      const probe = (rk) => {
        if (!rk || !rk.normal || !rk.vR) return null;
        const v = V3.clone(ball.v), w = V3.clone(ball.w);
        if (!impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {})) return null;
        const pp = V3.addScaled(V3.clone(ball.p), ball.p, rk.normal, PH.R * 1.05);
        const rep = {};
        predict(pp, v, w, { dt: 1 / 240, maxT: 2.4, stopAfterBounces: 2, out: rep });
        return rep;
      };
      const landX = (rep) => (rep && rep.b2 ? rep.b2.x : null);
      const widthCap = PH.T_HALF_WID * (CAP.vmag <= 6.0 ? 0.60 : 0.66);
      let bx = landX(probe(finalRacket));
      if (bx !== null && Math.abs(bx) > widthCap) {
        /* Ступень 1 — прямой доворот кадра вокруг вертикали (дёшево: один
         * predict на кандидата). Решатель подач — эвристический спуск и
         * упирается в локальный оптимум (замер: приземление -0.59 при
         * прицеле -0.15 не чинилось пере-решениями). Доворот normal+vR
         * единым кадром сохраняет характер удара; легальность принятого
         * кадра подтверждает _flightLegal. */
        const yawed = this._yawServeToWidth(ball, finalRacket, probe, widthCap, bx);
        if (yawed) { finalRacket = yawed; bx = landX(probe(finalRacket)); }
      }
      if (bx !== null && Math.abs(bx) > widthCap) {
        /* Ступень 2 — пере-решение из приглушённого жеста. Не «тот же удар
         * с другим прицелом»: решатель ищет вокруг АВТОРСКОГО кадра жеста,
         * и сдвиг одного aim находит тот же широкий оптимум (замер: прицел
         * 0.34->0.01, а приземление -0.737 неизменно три итерации подряд).
         * Как в приглушении дикой подачи игрока, гасится сам жест (curl и
         * боковой замах) — меняется центр поиска, а не только цель. */
        const k = 0.45;
        const pulled = deriveStroke({ ...m, curl: (m.curl || 0) * k, right: aimX * k * 0.5 }, serveCtx);
        pulled.aim = { x: aimX * k, z: aimZ };
        pulled.vmag = racket.vmag; pulled.normal = racket.normal; pulled.vR = racket.vR;
        pulled.rubber = racket.rubber; pulled.quality = racket.quality;
        pulled.stroke = st; pulled.arch = A; pulled.isServe = true;
        let re = refineRacket(ball.p, ball.v, ball.w, pulled, 1, racket.quality);
        if (re && re.valid !== false) {
          if (this.handicap < 1 && re.vR) V3.mul(re.vR, re.vR, 1 - (1 - this.handicap) * 0.45);
          re = this._ensureLegal(game, re, null, serveType, true);
          if (re && re.valid !== false) {
            const bxRe = landX(probe(re));
            const yawed2 = bxRe !== null && Math.abs(bxRe) > widthCap
              ? this._yawServeToWidth(ball, re, probe, widthCap, bxRe) : null;
            finalRacket = yawed2 || re;
          }
        }
      }
    }

    // A serve can be faulted too — at a third of the rally error rate.
    finalRacket = this.applyExecutionError(game, finalRacket, true);

    return finalRacket;
  }

  /** Check if AI is ready to strike (timing) */
  readyToStrike(now) {
    if (!this.commit) return false;
    if (now < this.swingAt - 0.30) return false;  // too early
    if (now > this.swingAt + 0.15) return false;  // too late
    return true;
  }

  /** Think - main AI update */
  think(game, dt) {
    const now = Number.isFinite(game.strokeTime) ? game.strokeTime : game.time;
    const ball = game.ball;

    // Update readiness
    const incoming = ball.live && ball.lastHitBy === 1 && ball.v.z < 0;
    if (!incoming) {
      this.plan = null; this.commit = null; this.phase = 'IDLE'; this._percept = null;
    }
    if (incoming && (this.seenBallId !== game.shotId || !!game.netTouched !== !!this._seenNetTouched)) {
      this.seenBallId = game.shotId;
      this._seenNetTouched = !!game.netTouched;
      this.plan = null; this.commit = null; this.phase = 'IDLE'; this._percept = null;
    }
    if (incoming && ball.golden === 'win') {
      /* A PERFECT input (green trail) is not a ball you can play: the bot is
       * wrong-footed and lets it through. Precision has to pay — otherwise
       * nothing separates a pixel-perfect hit from a flail, and the user
       * explicitly called this out: "идеальный удар должен быть в
       * большинстве случаев гол". ~88% of green hits come flagged 'win'. */
      this.plan = null; this.commit = null; this.phase = 'IDLE'; this._percept = null;
      if (this.anim.lean < 0.5) this.anim.lean = 0.5;
      return;
    }
    if (incoming && this.phase === 'IDLE') {
      /* ГЛАЗА И РУКИ РАЗДЕЛЕНЫ. Прогноз траектории бот строит сразу — по нему
       * он едет к точке встречи. А РЕШЕНИЕ по удару ждёт реакцию уровня
       * (L.react): до этого дедлайна ракетка не начинает замах. Раньше поле
       * react не читал НИКТО, и все уровни видели мяч в момент отрыва от
       * ракетки игрока — на WTF это 90 мс, на EASY — 420 мс.
       * Опоздав по-настоящему (мяч быстрее реакции), бот не получает
       * подарка: swingAt уже в прошлом и настоящая физика решает за него. */
      if (!this._percept) {
        this._percept = this.computePlan(game);
        if (this._percept) this._reactUntil = now + Math.max(0.08, this.L.react);
      }
      const p = this._percept;
      if (p) {
        this.plan = p;                       // цель перемещения — ещё без удара
        if (now >= this._reactUntil) {
          p.archId = this.pickStroke(game, p);
          p.aim = this.pickTarget(game, p, p.archId);
          this.commit = p;
          this.swingAt = p.t;
          this.readT = now;
          this.phase = 'READY';
          this.backswingStart = now;
          this.backswingPose = {
            pos: V3.new(this.target.x, this.target.y, this.target.z),
            windup: 0,
          };
          this._percept = null;
        }
      }
    }

    // Update tactic once per rally milestone (not 60 times/sec while rally === 5)
    if (game.rally > 0 && game.rally % 5 === 0 && this._tacticRally !== game.rally) {
      this._tacticRally = game.rally;
      this.tactic = this.rollTactic();
    } else if (game.rally === 0) {
      this._tacticRally = 0;
    }

    // Update pace based on rally
    if (game.rally > 0) {
      this.exchange = game.rally;
      this.pace = clamp(this.L.paceOpen + (game.rally - 1) * this.L.paceRamp, 0, this.L.paceMax);
    }

    // Move towards target with smooth interpolation
    /* Движение — по прогнозу (plan), а не по решению: во время реакции
     * уровня бот уже выезжает к мячу, но ещё не выбрал удар. */
    if (this.plan) {
      const t = this.noisyTarget(this.plan, game);
      V3.copy(this.target, t);

      // Smooth movement (respects Career maxSpeed slowdown modifier if active)
      const moveBase = Number.isFinite(this.maxSpeed) && this.maxSpeed > 0 ? this.maxSpeed : this.L.move;
      const moveRate = clamp(moveBase * 2.5, 2, 12);
      this._moveSmooth.x = expSmooth(this._moveSmooth.x, this.target.x, moveRate, dt);
      this._moveSmooth.y = expSmooth(this._moveSmooth.y, this.target.y, moveRate, dt);
      this._moveSmooth.z = expSmooth(this._moveSmooth.z, this.target.z, moveRate * 0.9, dt);

      // Store position for rendering
      game.ai.pos = V3.new(
        this._moveSmooth.x,
        this._moveSmooth.y,
        this._moveSmooth.z
      );

      // Compute velocity for visual purposes
      V3.sub(this.vel, game.ai.pos, this.lastPos);
      V3.mul(this.vel, this.vel, 1 / Math.max(dt, 1e-4));
      V3.copy(this.lastPos, game.ai.pos);
    }

    // Swing timing
    if (this.plan && this.commit) {
      const timeToContact = this.commit.t - now;
      if (timeToContact < 0.35 && timeToContact > 0) {
        // Wind-up phase
        const windupProgress = 1 - timeToContact / 0.35;
        this.anim.windup = clamp(windupProgress, 0, 1) * this.L.windup;

      }
    }
    // The game owns contact timing/legality and calls swing in tryAiHit.

    // Decay animations
    this.anim.swing = Math.max(0, this.anim.swing - dt * 3);
    this.anim.windup = Math.max(0, this.anim.windup - dt * 2);
    this.anim.lean = Math.max(0, this.anim.lean - dt * 4);

    // Phase transition
    if (this.phase === 'SWING' && this.anim.swing < 0.1) {
      this.phase = 'RECOVER';
    }
    if (this.phase === 'RECOVER' && !ball.live) {
      this.phase = 'IDLE';
    }
  }
}
