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
const AI_ATTACK_STROKES = new Set(['SMASH', 'COUNTER', 'LOOP', 'DRIVE', 'FLICK', 'BANANA']);

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

/* Serve pace and placement limits apply to the racket BEFORE the verified
 * launch. Spin is never changed after impact to disguise a different flight. */
const AI_SERVE_CAPS = [
  { vmag: 4.4, orbit: PH.T_HALF_WID * 0.44 },  // EASY
  { vmag: 6.0, orbit: PH.T_HALF_WID * 0.55 },  // MEDIUM
  { vmag: 9.6, orbit: PH.T_HALF_WID * 0.70 },  // HARD
  { vmag: 11.0, orbit: PH.T_HALF_WID * 0.80 }, // WTF
];

/* Минимальный запас от сетки для первого отскока подачи, метры.
 * Отскок вплотную к ленте не оставляет второй дуге места: мяч цепляет сетку
 * и падает обратно за своей половиной — «ОШИБКА ПОДАЧИ». */
const AI_SERVE_NET_ROOM = 0.16;
const AI_SERVE_APEX = 0.85;
const AI_SERVE_SOLVES = 2;
const AI_SERVE_FRAME_TRIES = 8;

const AI_BACKSWING = {
  LOOP:    { back: 0.30, lift: -0.16, side: 0.10, face: -0.30, name: 'накат' },
  COUNTER: { back: 0.18, lift: -0.06, side: 0.06, face: -0.18, name: 'контр' },
  DRIVE:   { back: 0.22, lift: -0.04, side: 0.08, face: -0.14, name: 'накат' },
  SMASH:   { back: 0.34, lift: 0.22, side: 0.08, face: -0.22, name: 'смеш' },
  FLICK:   { back: 0.10, lift: 0.04, side: 0.06, face: -0.10, name: 'флик' },
  SIDE:    { back: 0.12, lift: 0.00, side: 0.18, face: -0.06, name: 'side' },
  BANANA:  { back: 0.08, lift: -0.04, side: 0.16, face: -0.12, name: 'banana' },
  PUSH:    { back: 0.06, lift: 0.08, side: 0.04, face: 0.18, name: 'подст' },
  CHOP:    { back: 0.20, lift: 0.14, side: 0.08, face: 0.24, name: 'чоп' },
  CHOP_BLOCK: { back: 0.04, lift: 0.06, side: 0.02, face: 0.16, name: 'chop block' },
  BLOCK:   { back: 0.04, lift: 0.00, side: 0.02, face: 0.00, name: 'блок' },
  LOB:     { back: 0.26, lift: 0.18, side: 0.06, face: -0.12, name: 'свеча' },
  HOOK:    { back: 0.18, lift: -0.04, side: 0.28, face: -0.14, name: 'хук' },
  FADE:    { back: 0.18, lift: -0.04, side: -0.28, face: -0.14, name: 'feyd' },
  DROP:    { back: 0.08, lift: 0.06, side: 0.04, face: 0.12, name: 'drop' },
};

function shotHitsNet(ball, racket) {
  const launch = resolveRacketLaunch(ball, racket);
  if (!launch) return false;
  const chk = {};
  predict(launch.p, launch.v, launch.w, { dt: PH.SIM_DT, maxT: 1.2, stopOnFirstBounce: true, out: chk });
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
    this.hand = 'right';
    this.grip = 'shakehand';
    this.forehand = true;
    this.roll = 0.28;
    this.faceNormal = V3.new(0, -Math.sin(15 * DEG), Math.cos(15 * DEG));
    this.lastStrokeId = null;
    this.setLevel(levelIndex);

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
    this.home = V3.new(0, PH.TABLE_Y + 0.20, -(PH.T_HALF_LEN + 0.25));
    this.target = V3.clone(this.home);
    this.pos = V3.clone(this.home);
    this.lastPos = V3.clone(this.home);
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
    this._servePath = [];
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
    V3.set(this.faceNormal, 0, -Math.sin(15 * DEG), -this.side * Math.cos(15 * DEG));
    this.roll = (this.hand === 'left' ? -1 : 1) * (this.grip === 'penhold' ? Math.PI - 0.052 : 0.28);
    this.forehand = true;
    this.lastStrokeId = null;
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

  _strokeContext(game) {
    const b = game.ball;
    this.forehand = paddleForehand(b.p.x * this.side, this.hand, this.forehand);
    return {
      side: this.side, ball: b.p, ballSpin: b.w, ballVelocity: b.v,
      ballSpeed: V3.len(b.v), incomingTop: this.side * b.w.x,
      hand: this.hand, grip: this.grip, forehand: this.forehand,
      equip: (game.aiEquip || game.equip) && typeof (game.aiEquip || game.equip).forSide === 'function'
        ? (game.aiEquip || game.equip).forSide(this.forehand ? 1 : -1) : undefined,
      powerScale: 1, spinBias: 'norm',
    };
  }

  _scaleRacket(racket, cap) {
    if (!racket || !racket.vR) return racket;
    const cut = this.handicap < 1 ? 1 - (1 - this.handicap) * 0.45 : 1;
    const scale = Math.min(1, cap / Math.max(racket.vmag, 0.5)) * cut;
    if (scale >= 1) return racket;
    const swing = V3.new(), normal = V3.new();
    strokeFrame(racket, 0, 0, scale, swing, normal);
    return resolvedRacketFrame(racket, normal, swing);
  }

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
   * and this is THE reader of them for rallies only. Technical serves do
   * not donate points or consume this random stream. In a rally,
   * scoreboard pressure adds errPress on top, and a director handicap below
   * 1 widens everything. The bot does not "decide" the outcome it wants —
   * it perturbs the solved racket: face closed + slower arm (into the net)
   * or face open + faster arm (sails long), escalating until the SIMULATION
   * of exactly what the game will apply really faults. A perturbation that
   * still lands in is not an error, so after five escalations the solved
   * racket is returned untouched.
   */
  applyExecutionError(game, racket, isServe) {
    if (isServe || !racket || racket.valid === false || !game || !game.ball) return racket;
    const L = this.L;
    const pressure = clamp(this.pressure, 0, 1);
    /* Базовый процент уровня — не единственная причина ошибки. К нему
     * добавляются те же условия, что и у человека: очень быстрый мяч (+3–5 %),
     * короткий мяч у сетки (+2 %) и собственная серия атаки (+1.5–4 %).
     * У WTF errPress — АБСОЛЮТНЫЙ процент под давлением (1.7 % → 1.9 %),
     * иначе шкала уехала бы в 3.6 % и «почти идеальный» перестал бы им быть. */
    const inSpeed = V3.len(game.ball.v);
    const fastAdd = clamp((inSpeed - 14) / 6, 0, 1) * 0.05;
    const shortAdd = this._lastShort ? 0.02 : 0;
    const streakAdd = clamp((this.aggrStreak - 2) * 0.015, 0, 0.04);
    const base = L.errPressAbs ? lerp(L.errBase, L.errPress, pressure) : L.errBase + L.errPress * pressure;
    const rate = clamp((base + fastAdd + shortAdd + streakAdd) / Math.max(this.handicap, 0.70), 0, 0.85);
    if (this._rand() >= rate) return racket;
    const b = game.ball;
    const isFault = (rk) => {
      const launch = resolveRacketLaunch(b, rk);
      if (!launch) return false;
      const o = predict(launch.p, launch.v, launch.w,
        { dt: PH.SIM_DT, maxT: 2.4, stopOnFirstBounce: true, out: this._q });
      if (o.diverged) return true;
      return o.hitNet || !o.landed || o.landed.z * rk.side > 0 ||
        Math.abs(o.landed.z) > PH.T_HALF_LEN + 0.005 || Math.abs(o.landed.x) > PH.T_HALF_WID + 0.005;
    };
    /* Честная монетка: половина ошибок — в сетку, половина — длинные. */
    const kind = this._rand() < 0.50 ? 'net' : 'long';
    for (let step = 1; step <= 5; step++) {
      let bad = Object.assign({}, racket);
      if (kind === 'net') {
        bad.normal = OpponentAI._pitchFace(racket.normal, 3.2 * step + 1.5);
        bad.vR = V3.mul(V3.clone(racket.vR), racket.vR, 1 - 0.055 * step);
      } else {
        bad.normal = OpponentAI._pitchFace(racket.normal, -(2.6 * step + 1.5));
        bad.vR = V3.mul(V3.clone(racket.vR), racket.vR, 1 + 0.060 * step);
      }
      if (racket.arch) bad = resolvedRacketFrame(bad, bad.normal, bad.vR);
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
    if (isServe) return this._serveVerdict(b, racket).reason === 'ok';
    const launch = resolveRacketLaunch(b, racket);
    if (!launch || !strokeIdentityMatches(racket, launch)) return false;
    const o = predict(launch.p, launch.v, launch.w,
      { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: this._q });
    if (o.diverged || !o.landed) return false;
    return o.landed.z * racket.side <= 0 && Math.abs(o.landed.z) <= PH.T_HALF_LEN + 0.005 &&
      Math.abs(o.landed.x) <= PH.T_HALF_WID + 0.005;
  }

  _serveVerdict(ball, racket) {
    const diagnostic = { reason: 'solver', dt: PH.SIM_DT,
      firstBounce: null, secondBounce: null, postBounceApex: null };
    if (!racket) return diagnostic;
    // A budget-limited solve is only a proposal; this exact flight is the verdict.
    const launch = resolveRacketLaunch(ball, racket);
    if (!launch) { diagnostic.reason = 'separating'; return diagnostic; }
    diagnostic.launch = launch;
    if (!strokeIdentityMatches(racket, launch)) { diagnostic.reason = 'stroke_identity'; return diagnostic; }
    const cap = AI_SERVE_CAPS[this.levelIndex];
    if (racket.vmag > cap.vmag + 1e-6 || V3.len(launch.v) > STROKE_CONFIG.serve.ballMax + 1e-6) {
      diagnostic.reason = 'speed_cap'; return diagnostic;
    }
    const maxT = STROKE_CONFIG.serve.solver.maxT;
    const path = this._servePath;
    const o = predict(launch.p, launch.v, launch.w, { dt: PH.SIM_DT, maxT,
      stopAfterBounces: 2, path, maxPath: 3 * (Math.ceil(maxT / PH.SIM_DT) + 1), out: {} });
    diagnostic.firstBounce = o.landed;
    diagnostic.secondBounce = o.b2;
    if (o.landed) {
      let apex = PH.TABLE_Y + PH.R;
      // predict stores one point per production step BEFORE resolving contact.
      const firstAfterBounce = Math.round(o.landed.t / PH.SIM_DT) * 3 + 1;
      for (let i = firstAfterBounce; i < path.length; i += 3) apex = Math.max(apex, path[i]);
      diagnostic.postBounceApex = apex - PH.TABLE_Y;
    }
    const side = racket.side;
    if (o.diverged) diagnostic.reason = 'diverged';
    else if (o.hitNet) diagnostic.reason = 'net';
    else if (!o.landed) diagnostic.reason = 'first_bounce_missing';
    else if (o.landed.z * side <= AI_SERVE_NET_ROOM) diagnostic.reason = 'first_bounce_net_room';
    else if (Math.abs(o.landed.z) > PH.T_HALF_LEN + 0.005 || Math.abs(o.landed.x) > PH.T_HALF_WID + 0.005)
      diagnostic.reason = 'first_bounce_out';
    else if (!o.b2) diagnostic.reason = 'second_bounce_missing';
    else if (o.b2.z * side >= 0) diagnostic.reason = 'second_bounce_side';
    else if (Math.abs(o.b2.z) > PH.T_HALF_LEN + 0.005 || Math.abs(o.b2.x) > PH.T_HALF_WID + 0.005)
      diagnostic.reason = 'second_bounce_out';
    else if (diagnostic.postBounceApex > AI_SERVE_APEX) diagnostic.reason = 'post_bounce_apex';
    else if ((cap.vmag <= 6 || racket.stroke.id === 'SERVE_SIDE') &&
      Math.abs(o.b2.x) > PH.T_HALF_WID * (cap.vmag <= 6 ? 0.60 : 0.66)) diagnostic.reason = 'width_cap';
    else diagnostic.reason = 'ok';
    return diagnostic;
  }

  // Only rallies may switch to a defensive family; serves preserve their intent.
  _ensureLegal(game, racket, plan) {
    const ball = game.ball;
    if (this._flightLegal(ball, racket, false)) return racket;
    const L = this.L;
    const aim = { x: clamp(((plan.aim && plan.aim.x) || 0) * 0.5, -0.42, 0.42),
      z: -this.side * PH.T_HALF_LEN * 0.62 };
    const ctx = this._strokeContext(game);
    for (const id of ['BLOCK', 'PUSH', 'LOOP']) {
      const cand = racketForStroke(id, ctx, {
        vmag: clamp(plan.speed * 0.55, 2.2, Math.min(4.6, Math.max(3.0, L.vmagMin + 1.2))),
        aim, quality: 0.8 + 0.1 * L.skill,
      });
      cand.netClear = 0.12;
      const solved = this._scaleRacket(refineRacket(ball.p, ball.v, ball.w, cand,
        Math.max(L.skill, 0.85), cand.quality), L.vmagMax);
      if (this._flightLegal(ball, solved, false)) return solved;
    }
    racket.valid = false;
    racket.invalidReason = 'unreturnable';
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
  computePlan(game, read = null) {
    const ball = game.ball;
    const ownBounces = Array.isArray(game.rallyBounces) ? game.rallyBounces.filter(s => s === this.side).length : 0;
    this._lastShort = false;
    if (ownBounces > 1) return null;
    const bounced = ownBounces === 1;
    const serveOwnBounce = game.isServeBall && game.serveBounces === 0;
    const dt = PH.SIM_DT;
    const o = this._pred;
    predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w), {
      dt, maxT: 2.4, stopAfterBounces: bounced ? 1 : serveOwnBounce ? 3 : 2, out: o,
    });

    // After the real own-court bounce, predict.landed is the DEAD second bounce.
    // A deep-plane crossing alone does not make an unbounced out ball playable.
    const landing = bounced ? { x: ball.p.x, z: ball.p.z, t: 0 }
      : serveOwnBounce && o.landed && o.landed.z > 0 ? o.b2 : o.landed;
    if (o.diverged || !landing || landing.z >= 0 || (!bounced &&
      (Math.abs(landing.x) > PH.T_HALF_WID + PH.R || Math.abs(landing.z) > PH.T_HALF_LEN + PH.R))) return null;
    const latestT = o.endT - 2 * dt;
    if (latestT <= landing.t + dt) return null;

    const inSpeed = V3.len(ball.v);
    const topIn = this.side * ball.w.x;
    let zHit = -PH.T_HALF_LEN
      - clamp(0.10 + inSpeed * 0.030 + Math.max(0, topIn) * 0.00022, 0.08, 0.62);
    if (landing.z > -0.62) zHit = Math.max(zHit, landing.z - 0.52);
    zHit = clamp(zHit, -2.05, -PH.R);

    const q = this._q;
    predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w),
      { dt, maxT: latestT, stopZ: zHit, stopDir: -1, stopAtPlane: true, out: q });
    if (!q.reach || q.endT - landing.t < (bounced ? dt : 0.055) || q.end.y < PH.TABLE_Y + PH.R) {
      // A short/stationary/reversing ball may never reach the comfortable plane.
      // Meet its real post-bounce flight instead, before the next bounce/net/floor.
      const interceptT = Math.min(latestT,
        landing.t + clamp(0.055 + (0.16 - inSpeed * 0.008), 0.055, 0.19));
      predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w),
        { dt, maxT: interceptT, out: q });
    }
    if (q.diverged || q.hitNet || q.endT >= o.endT || q.endT <= landing.t ||
      q.end.z >= -PH.R || q.end.z < -2.45 || q.end.y < PH.TABLE_Y + PH.R) return null;
    const simNow = Number.isFinite(game.strokeTime) ? game.strokeTime : game.time;
    this._lastShort = read ? read.short : landing.z > -0.55;
    return {
      x: q.end.x,
      y: clamp(q.end.y, PH.TABLE_Y + 0.04, PH.TABLE_Y + 0.80),
      z: q.end.z,
      t: simNow + q.endT,
      speed: V3.len(q.endV),
      bounceT: landing.t,
      short: this._lastShort,
      wide: read ? read.wide : Math.abs(landing.x) > PH.T_HALF_WID * 0.58,
      willLandIn: true,
      errUnitX: read ? read.errUnitX : this._gauss(),
      errUnitY: read ? read.errUnitY : this._gauss(),
    };
  }

  /** Anticipation noise — coherent per-shot read error that sharpens as ball approaches */
  noisyTarget(plan, game) {
    const L = this.L;
    const simNow = Number.isFinite(game.strokeTime) ? game.strokeTime : game.time;
    const lead = clamp(plan.t - simNow, 0, 1.2);
    const blur = L.posErr * (0.35 + lead * 1.15) / this.handicap;
    const ex = Number.isFinite(plan.errUnitX) ? plan.errUnitX : 0;
    const ey = Number.isFinite(plan.errUnitY) ? plan.errUnitY : 0;
    const target = {
      x: clamp(plan.x + ex * blur, -1.12, 1.12),
      y: clamp(plan.y + ey * blur * 0.42, PH.TABLE_Y - 0.05, PH.TABLE_Y + 0.96),
      z: clamp(plan.z - 0.055, -2.5, -PH.R),
    };
    const pose = game.aiPaddle;
    keepPaddleAboveTable(target, pose ? pose.normal : this.faceNormal, pose ? pose.roll : this.roll,
      PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN);
    return target;
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
    const overTable = Math.abs(plan.z) < PH.T_HALF_LEN - 0.02 && Math.abs(plan.x || 0) < PH.T_HALF_WID - 0.03;
    const backhand = !paddleForehand((plan.x || 0) * this.side, this.hand, this.forehand);
    const aggro = clamp((L.aggro * 0.7 + T.risk * 0.5) * (0.85 + this.pace * 0.3)
      + this.mood * 0.08 - this.pressure * 0.07 + this._trendAmp() * 0.8, 0, 1.1);
    const r = this._rand();

    if (this.levelIndex >= 2 && plan.short && overTable && backhand && hTable >= 0.04 && hTable <= 0.28 &&
      inSpeed < 12 && r < 0.12 + (this.levelIndex - 2) * 0.10) return 'BANANA';
    if (heavyTop && inSpeed > 8 && overTable && hTable >= 0.04 && hTable < 0.26 &&
      r < 0.10 * L.spinRead) return 'CHOP_BLOCK';

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
    if (r < 0.07 * L.variety * T.wide) {
      const lateral = this._rand();
      return lateral < 1 / 3 ? 'SIDE' : lateral < 2 / 3 ? 'HOOK' : 'FADE';
    }
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

    const archId = plan.archId || 'DRIVE';
    let racket = racketForStroke(archId, this._strokeContext(game), {
      // Ease rally pace before solving so the chosen shot is re-aimed at its
      // target, rather than slowing an already-solved ball in flight.
      vmag: clamp(plan.speed * (0.7 + 0.3 * this.pace) * .92, L.vmagMin, L.vmagMax),
      aim: plan.aim,
      quality: 0.75 + 0.20 * L.skill,
    });

    // Solve on copies. The game applies the returned impact exactly once.
    racket = this._scaleRacket(refineRacket(ball.p, ball.v, ball.w, racket, L.skill, racket.quality), L.vmagMax);
    racket = this._ensureLegal(game, racket, plan);
    // Error pressure includes this attack, but only the executed family counts.
    if (racket.valid !== false) this.noteStroke(racket.stroke.id);
    racket = this.applyExecutionError(game, racket, false);
    V3.copy(this.faceNormal, racket.normal);
    this.phase = racket.valid === false ? 'RECOVER' : 'SWING';
    this.anim.swing = racket.valid === false ? 0 : 1;
    this.plan = null;
    this.commit = null;

    return racket;
  }

  /** Called after the game has actually applied the contact, for both serves
   * and rallies. Solving or retrying a serve is not an executed shot. */
  recordHit(ball, racket, launch, now) {
    if (!racket || racket.valid === false || !launch || !launch.info) return false;
    const id = racket.stroke.id;
    this.lastStrokeId = id;
    V3.copy(this.faceNormal, racket.normal);
    this.stats.shots++;
    const inc = V3.len(ball.v), out = V3.len(launch.v);
    this.stats.sumSpeed += inc;
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, inc);
    this.stats.byStroke[id] = (this.stats.byStroke[id] || 0) + 1;
    this.stats.sumOut += out; this.stats.outN++;
    this.stats.maxOut = Math.max(this.stats.maxOut, out);
    if (inc > 0.5) { this.stats.sumRatio += out / inc; this.stats.ratioN++; }
    this.strokeHistory.push({ archId: id, time: now, quality: racket.quality });
    if (this.strokeHistory.length > 50) this.strokeHistory.shift();
    return true;
  }

  /** Serve — solved against both required bounces */
  serve(game) {
    const ball = game.ball;
    const L = this.L;

    const r = this._rand();
    const serveType = r < 0.30 ? 'SERVE_TOP' : r < 0.55 ? 'SERVE_BACK' : r < 0.75 ? 'SERVE_SIDE'
      : r < 0.90 ? 'SERVE_FAST' : 'SERVE_NO_SPIN';
    const CAP = AI_SERVE_CAPS[this.levelIndex];
    let aimX = clamp(this._sym(0.50), -CAP.orbit, CAP.orbit);
    if (CAP.vmag <= 6 || serveType === 'SERVE_SIDE')
      aimX = clamp(aimX, -PH.T_HALF_WID * 0.44, PH.T_HALF_WID * 0.44);
    const aimZ = -this.side * PH.T_HALF_LEN * (0.55 + 0.35 * this._rand());
    const direction = this._rand() < 0.5 ? -1 : 1;
    const mixed = serveType === 'SERVE_SIDE' ? this._rand() : 0.5;
    const verticalBrush = mixed < 1 / 3 ? -0.40 : mixed > 2 / 3 ? 0.40 : 0;
    const vmag = Math.min(lerp(6, 11, L.skill), CAP.vmag) * (0.85 + 0.15 * this.pace);
    const ctx = this._strokeContext(game);
    let finalRacket, diagnostic, frameTries = 0;
    for (let attempt = 0; attempt < AI_SERVE_SOLVES; attempt++) {
      const prototype = racketForStroke(serveType, ctx, { direction, verticalBrush,
        vmag: vmag * (attempt ? 0.78 : 1), quality: 0.80 + 0.15 * L.skill,
        aim: attempt ? { x: aimX * 0.35, z: -this.side * PH.T_HALF_LEN * 0.72 } : { x: aimX, z: aimZ } });
      prototype.vmagCap = CAP.vmag;
      finalRacket = this._scaleRacket(refineRacket(ball.p, ball.v, ball.w, prototype, 1, prototype.quality), CAP.vmag);
      diagnostic = this._serveVerdict(ball, finalRacket);
      if (diagnostic.reason !== 'ok') {
        const lateral = diagnostic.secondBounce ? Math.sign(diagnostic.secondBounce.x) : direction;
        const yaw = diagnostic.secondBounce ? clamp(Math.atan2(-diagnostic.secondBounce.x,
          Math.abs(diagnostic.secondBounce.z - ball.p.z)), -0.40, 0.40) : 0;
        const tweaks = diagnostic.reason === 'width_cap'
          ? [[0, -lateral * 0.12, 1], [0, lateral * 0.12, 1], [0, -lateral * 0.26, 1], [0, lateral * 0.26, 1]]
          : diagnostic.reason === 'post_bounce_apex'
            ? [[0.20, yaw, 0.85], [0.20, yaw, 0.75], [0.50, yaw, serveType === 'SERVE_NO_SPIN' ? 0.80 : 0.55], [0.60, yaw, 0.50]]
          : [[-0.08, 0, 0.88], [0.08, 0, 0.88], [-0.16, 0, 0.72], [0.16, 0, 0.72]];
        for (const [e, az, scale] of tweaks) {
          if (frameTries >= AI_SERVE_FRAME_TRIES) break;
          frameTries++;
          const swing = V3.new(), normal = V3.new();
          strokeFrame(finalRacket, e, az, scale, swing, normal);
          const candidate = resolvedRacketFrame(finalRacket, normal, swing, { valid: true });
          const verdict = this._serveVerdict(ball, candidate);
          if (verdict.reason === 'ok') { finalRacket = candidate; diagnostic = verdict; break; }
        }
      }
      diagnostic.attempts = attempt + 1;
      diagnostic.frameTries = frameTries;
      if (diagnostic.reason === 'ok') break;
    }
    finalRacket.aiServeDiagnostic = diagnostic;
    finalRacket.valid = diagnostic.reason === 'ok';
    if (!finalRacket.valid) finalRacket.invalidReason = diagnostic.reason;
    return this.applyExecutionError(game, finalRacket, true);
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
    const ownBounces = Array.isArray(game.rallyBounces) ? game.rallyBounces.filter(s => s === this.side).length : 0;
    const incoming = ball.live && ball.lastHitBy === 1 && ownBounces < 2 && (ball.v.z < 0 || ball.p.z < 0);
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
    if (incoming && ownBounces === 1 && this.plan && this.plan.bounceT > 0) {
      const previous = this.plan;
      const p = this.computePlan(game, previous);
      this.plan = p;
      if (p && this.commit) {
        p.archId = previous.archId; p.aim = previous.aim;
        this.commit = p; this.swingAt = p.t;
      } else if (p) this._percept = p;
      else { this.commit = null; this._percept = null; this.phase = 'IDLE'; }
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

      // Limit actual translation, including Career slowdown, from the live pose.
      const moveBase = Number.isFinite(this.maxSpeed) && this.maxSpeed >= 0 ? this.maxSpeed : this.L.move;
      const moveRate = clamp(moveBase * 2.5, 2, 12);
      const moveDt = Number.isFinite(dt) ? clamp(dt, 0, 1) : 0;
      V3.copy(this.lastPos, this.pos);
      stepPaddlePosition(this.pos, this.target, moveRate, moveDt, moveBase, this._moveSmooth);

      // The same constrained center is used for contact, drawing and diagnostics.
      const pose = game.aiPaddle;
      const lift = keepPaddleAboveTable(this._moveSmooth, pose ? pose.normal : this.faceNormal, pose ? pose.roll : this.roll,
        PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN);
      if (lift > 0 && V3.dist(this._moveSmooth, this.pos) > moveBase * moveDt + 1e-9) {
        // Get above the edge before translating across it; a collision lift is not a speed exemption.
        V3.set(this._moveSmooth, this.pos.x, Math.max(this.pos.y, this._moveSmooth.y), this.pos.z);
        stepPaddlePosition(this.pos, this._moveSmooth, moveRate, moveDt, moveBase, this._moveSmooth);
      }
      V3.copy(this.pos, this._moveSmooth);
      if (game.ai !== this) V3.copy(game.ai.pos, this.pos);

      // Compute velocity for visual purposes
      V3.sub(this.vel, this.pos, this.lastPos);
      V3.mul(this.vel, this.vel, 1 / Math.max(dt, 1e-4));
      V3.copy(this.lastPos, this.pos);
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
