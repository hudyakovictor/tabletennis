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
    id: 0, name: 'НОВИЧОК', tag: 'ROOKIE', elo: 900, style: 'PUSHER',
    react: 0.38, move: 1.55, posErr: 0.28, skill: 0.30, spinRead: 0.16,
    aggro: 0.06, variety: 0.35,
    vmagMin: 2.0, vmagMax: 3.8, paceOpen: 0.16, paceRamp: 0.02, paceMax: 0.32,
    windup: 0.38, errBase: 0.38, errPress: 0.16, deepness: 0.48, placeSkill: 0.12,
    counterRate: 0.01, smashRate: 0.0, dropRate: 0.02,
  },
  {
    id: 1, name: 'ЛЮБИТЕЛЬ', tag: 'AMATEUR', elo: 1400, style: 'ALLROUND',
    react: 0.26, move: 2.5, posErr: 0.15, skill: 0.58, spinRead: 0.45,
    aggro: 0.24, variety: 0.60,
    vmagMin: 3.2, vmagMax: 6.8, paceOpen: 0.26, paceRamp: 0.045, paceMax: 0.62,
    windup: 0.30, errBase: 0.20, errPress: 0.09, deepness: 0.70, placeSkill: 0.36,
    counterRate: 0.08, smashRate: 0.20, dropRate: 0.05,
  },
  {
    id: 2, name: 'ПРО', tag: 'PRO', elo: 1900, style: 'ALLROUND',
    react: 0.185, move: 3.5, posErr: 0.082, skill: 0.79, spinRead: 0.72,
    aggro: 0.44, variety: 0.78,
    vmagMin: 5.0, vmagMax: 10.8, paceOpen: 0.38, paceRamp: 0.075, paceMax: 0.90,
    windup: 0.235, errBase: 0.062, errPress: 0.055, deepness: 0.86, placeSkill: 0.64,
    counterRate: 0.26, smashRate: 0.58, dropRate: 0.08,
  },
  {
    id: 3, name: 'МАСТЕР СПОРТА', tag: 'MASTER', elo: 2300, style: 'ATTACK',
    react: 0.145, move: 4.3, posErr: 0.052, skill: 0.885, spinRead: 0.87,
    aggro: 0.60, variety: 0.84,
    vmagMin: 5.8, vmagMax: 13.2, paceOpen: 0.44, paceRamp: 0.090, paceMax: 1.0,
    windup: 0.195, errBase: 0.054, errPress: 0.040, deepness: 0.90, placeSkill: 0.80,
    counterRate: 0.40, smashRate: 0.74, dropRate: 0.09,
  },
  {
    id: 4, name: 'ЛЕГЕНДА', tag: 'LEGEND', elo: 2700, style: 'ATTACK',
    react: 0.108, move: 5.2, posErr: 0.032, skill: 0.95, spinRead: 0.95,
    aggro: 0.74, variety: 0.90,
    vmagMin: 6.6, vmagMax: 15.4, paceOpen: 0.50, paceRamp: 0.105, paceMax: 1.0,
    windup: 0.165, errBase: 0.040, errPress: 0.028, deepness: 0.94, placeSkill: 0.90,
    counterRate: 0.54, smashRate: 0.86, dropRate: 0.10,
  },
];

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

const AI_BACKSWING = {
  LOOP:    { back: 0.30, lift: -0.16, side: 0.10, face: -0.30, name: 'накат' },
  COUNTER: { back: 0.18, lift: -0.06, side: 0.06, face: -0.18, name: 'контр' },
  DRIVE:   { back: 0.22, lift: -0.04, side: 0.08, face: -0.14, name: 'накaт' },
  SMASH:   { back: 0.34, lift: 0.22, side: 0.08, face: -0.22, name: 'смеш' },
  FLICK:   { back: 0.10, lift: 0.04, side: 0.06, face: -0.10, name: 'флик' },
  PUSH:    { back: 0.06, lift: 0.08, side: 0.04, face: 0.18, name: 'подст' },
  CHOP:    { back: 0.20, lift: 0.14, side: 0.08, face: 0.24, name: 'чоп' },
  BLOCK:   { back: 0.04, lift: 0.00, side: 0.02, face: 0.00, name: 'блок' },
  LOB:     { back: 0.26, lift: 0.18, side: 0.06, face: -0.12, name: 'свеча' },
  HOOK:    { back: 0.18, lift: -0.04, side: 0.28, face: -0.14, name: 'хuk' },
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
    this.stats = { shots: 0, errors: 0, winners: 0, sumSpeed: 0, maxSpeed: 0 };

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
  }

  /** Set level and update parameters */
  setLevel(idx) {
    this.levelIndex = clamp(idx, 0, AI_LEVELS.length - 1);
    this.L = AI_LEVELS[this.levelIndex];
    this.maxSpeed = this.L.move;
    this.pace = this.L.paceOpen;
  }

  /** Full reset between matches */
  reset() {
    this.phase = 'IDLE'; this.plan = null; this.commit = null;
    this.readT = 0; this.seenBallId = -1;
    this.exchange = 0; this.pace = this.L.paceOpen;
    this.tactic = AI_TACTICS.FEEL;
    this.mood = 0; this.pressure = 0; this.handicap = 1;
    this.stats = { shots: 0, errors: 0, winners: 0, sumSpeed: 0, maxSpeed: 0 };
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
  }

  /** Scoreboard awareness */
  setPressure(myScore, theirScore, target) {
    const near = Math.max(myScore, theirScore) / Math.max(4, target - 1);
    const tight = 1 - clamp(Math.abs(myScore - theirScore) / 4, 0, 1);
    this.pressure = clamp(near * 0.6 + tight * 0.4, 0, 1) * clamp(near, 0, 1);
  }

  /** Dynamic difficulty */
  setHandicap(h) { this.handicap = clamp(h, 0.80, 1.05); }

  rollTactic() {
    const L = this.L;
    const r = Math.random();
    const aggro = clamp(L.aggro + this.mood * 0.12 - this.pressure * 0.10, 0, 1);
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
      return {
        x: q.end.x,
        y: clamp(q.end.y, PH.TABLE_Y + 0.04, PH.TABLE_Y + 0.80),
        z: clamp(q.end.z, -2.15, -1.00),
        t: game.time + interceptT,
        speed: V3.len(q.endV),
        bounceT: o.landed.t,
        short: o.landed.z > -0.55,
        wide: Math.abs(o.landed.x) > PH.T_HALF_WID * 0.58,
        willLandIn: Math.abs(o.landed.x) <= PH.T_HALF_WID + PH.R,
      };
    }
    if (o.reach) {
      return {
        x: o.reach.x, y: clamp(o.reach.y, PH.TABLE_Y + 0.04, PH.TABLE_Y + 0.95),
        z: clamp(o.reach.z, -2.45, -1.05),
        t: game.time + o.reachT, speed: 8, bounceT: 0, short: false, wide: false,
        willLandIn: true,
      };
    }
    return null;
  }

  /** Anticipation noise */
  noisyTarget(plan, game) {
    const L = this.L;
    const lead = clamp(plan.t - game.time, 0, 1.2);
    const blur = L.posErr * (0.45 + lead * 1.25) / this.handicap;
    return {
      x: clamp(plan.x + gauss(blur), -1.12, 1.12),
      y: clamp(plan.y + gauss(blur * 0.42), PH.TABLE_Y - 0.05, PH.TABLE_Y + 0.96),
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
      + this.mood * 0.08 - this.pressure * 0.07, 0, 1.1);
    const r = Math.random();

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
    if (r < 0.07 * L.variety * T.wide) return Math.random() < 0.5 ? 'HOOK' : 'FADE';
    if (r < 0.07 * L.variety * T.wide + 0.08 * (1 - aggro)) return 'PUSH';

    if (r < 0.34 + aggro * 0.46) return 'LOOP';
    return 'DRIVE';
  }

  /** Where to put it */
  pickTarget(game, plan, archId) {
    const L = this.L, T = this.tactic;
    const px = game.player.pos.x;
    const playerSide = sign(px || rndSym(1));
    const skill = L.placeSkill * this.handicap;

    const roll = Math.random();
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
      wantX = rndSym(0.80);
    }

    let wantZ;
    if (this.pace > 0.85) {
      wantZ = -PH.T_HALF_LEN * (0.65 + 0.30 * rnd());
    } else if (T.depth > 0.7) {
      wantZ = -PH.T_HALF_LEN * (0.50 + 0.40 * rnd());
    } else {
      wantZ = lerp(-0.55, -PH.T_HALF_LEN * 0.75, T.depth + 0.2 * rnd());
    }

    if (plan.wide && roll < 0.4 + T.wide * 0.4) {
      wantX = playerSide * sign(wantX || 1) * (0.75 + 0.20 * rnd());
    }

    return { x: wantX, z: Math.abs(wantZ) };
  }

  /* ==================================================================
   *  SWING EXECUTION — gameplay owns the impact
   * ================================================================== */

  /** Build a solved stroke without mutating the live ball */
  swing(game) {
    const now = game.time;
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
    racket = refineRacketRealtime(ball.p, ball.v, ball.w, racket, L.skill, racket.quality);
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
    this.strokeHistory.push({ archId, time: now, quality: racket.quality });
    if (this.strokeHistory.length > 50) this.strokeHistory.shift();

    return racket;
  }

  /** Serve — solved against both required bounces */
  serve(game) {
    const ball = game.ball;
    const L = this.L;

    // Pick serve type based on context
    const r = Math.random();
    let serveType;
    if (r < 0.35) serveType = 'SERVE_TOP';
    else if (r < 0.60) serveType = 'SERVE_BACK';
    else if (r < 0.80) serveType = 'SERVE_SIDE';
    else serveType = 'SERVE_FAST';

    const A = ARCH[serveType] || ARCH.SERVE_TOP;
    const st = STROKES[serveType] || STROKES.SERVE_TOP;

    // Aim
    const aimX = rndSym(0.50);
    const aimZ = PH.T_HALF_LEN * (0.55 + 0.35 * rnd());

    const racket = makeRacket(-1, serveType, {
      elev: A.elev,
      contact: A.contact,
      azSwing: 0,
      azFace: 0,
      vmag: lerp(6, 11, L.skill) * (0.85 + 0.15 * this.pace),
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
      equip: game.equip.forSide(-1),
      spinBias: 'norm',
    };

    const m = {
      right: aimX * 0.5,
      up: (A.elev / 66),
      dist: 0.2,
      curl: serveType === 'SERVE_SIDE' ? 0.5 : 0,
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
    let finalRacket = refineRacketRealtime(ball.p, ball.v, ball.w, racketFromStroke,
      this.handicap, racket.quality);


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
    const now = game.time;
    const ball = game.ball;

    // Update readiness
    const incoming = ball.live && ball.lastHitBy === 1 && ball.v.z < 0;
    if (!incoming) {
      this.plan = null; this.commit = null; this.phase = 'IDLE';
    }
    if (incoming && this.seenBallId !== game.shotId) {
      this.seenBallId = game.shotId;
      this.plan = null; this.commit = null; this.phase = 'IDLE';
    }
    if (incoming && this.phase === 'IDLE') {
      this.plan = this.computePlan(game);
      if (this.plan) {
        this.plan.archId = this.pickStroke(game, this.plan);
        this.plan.aim = this.pickTarget(game, this.plan, this.plan.archId);
        this.commit = this.plan;
        this.swingAt = this.plan.t;
        this.readT = now;
        this.phase = 'READY';
        this.backswingStart = now;
        this.backswingPose = {
          pos: V3.new(this.target.x, this.target.y, this.target.z),
          windup: 0,
        };
      }
    }

    // Update tactic based on rally progression
    if (game.rally > 0 && game.rally % 5 === 0) {
      this.tactic = this.rollTactic();
    }

    // Update pace based on rally
    if (game.rally > 0) {
      this.exchange = game.rally;
      this.pace = clamp(this.L.paceOpen + (game.rally - 1) * this.L.paceRamp, 0, this.L.paceMax);
    }

    // Move towards target with smooth interpolation
    if (this.plan && this.phase !== 'IDLE') {
      const t = this.noisyTarget(this.plan, game);
      V3.copy(this.target, t);

      // Smooth movement
      const moveRate = clamp(this.L.move * 2.5, 2, 12);
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
    if (this.plan && this.phase !== 'IDLE') {
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
