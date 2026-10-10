/* =====================================================================
 *  OPPONENT AI  —  v2
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
 *  As before the AI is not allowed to cheat: it goes through the same
 *  racket/impact pipeline. It only differs in how well it reads spin,
 *  how fast it moves and how much execution noise it carries.
 * ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
 *  LEVELS
 *
 *  Pace numbers are racket speeds in m/s, not ball speeds. As a sanity
 *  anchor, through this impact model a 9 m/s racket on a neutral ball
 *  produces roughly 45-55 km/h out; 14 m/s produces roughly 80-90.
 *  "ПРО" is meant to be a solid club player, not a machine: mid-forties
 *  to low-sixties km/h in the rally with the odd 75 km/h put-away.
 * ------------------------------------------------------------------- */
const AI_LEVELS = [
  {
    id: 0, name: 'НОВИЧОК', tag: 'ROOKIE', elo: 900, style: 'PUSHER',
    react: 0.30, move: 2.1, posErr: 0.185, skill: 0.50, spinRead: 0.32,
    aggro: 0.14, variety: 0.55,
    vmagMin: 3.0, vmagMax: 5.5, paceOpen: 0.28, paceRamp: 0.045, paceMax: 0.54,
    windup: 0.30, errBase: 0.165, errPress: 0.10, deepness: 0.52, placeSkill: 0.30,
    counterRate: 0.06, smashRate: 0.22, dropRate: 0.05,
  },
  {
    id: 1, name: 'ЛЮБИТЕЛЬ', tag: 'AMATEUR', elo: 1400, style: 'ALLROUND',
    react: 0.235, move: 2.9, posErr: 0.125, skill: 0.66, spinRead: 0.52,
    aggro: 0.30, variety: 0.68,
    vmagMin: 4.0, vmagMax: 8.0, paceOpen: 0.32, paceRamp: 0.060, paceMax: 0.74,
    windup: 0.265, errBase: 0.112, errPress: 0.075, deepness: 0.62, placeSkill: 0.48,
    counterRate: 0.14, smashRate: 0.40, dropRate: 0.07,
  },
  {
    id: 2, name: 'ПРО', tag: 'PRO', elo: 1900, style: 'ALLROUND',
    react: 0.185, move: 3.5, posErr: 0.082, skill: 0.79, spinRead: 0.72,
    aggro: 0.44, variety: 0.78,
    vmagMin: 5.0, vmagMax: 10.8, paceOpen: 0.38, paceRamp: 0.075, paceMax: 0.90,
    windup: 0.235, errBase: 0.062, errPress: 0.055, deepness: 0.70, placeSkill: 0.64,
    counterRate: 0.26, smashRate: 0.58, dropRate: 0.08,
  },
  {
    id: 3, name: 'МАСТЕР СПОРТА', tag: 'MASTER', elo: 2300, style: 'ATTACK',
    react: 0.145, move: 4.3, posErr: 0.052, skill: 0.885, spinRead: 0.87,
    aggro: 0.60, variety: 0.84,
    vmagMin: 5.8, vmagMax: 13.2, paceOpen: 0.44, paceRamp: 0.090, paceMax: 1.0,
    windup: 0.195, errBase: 0.054, errPress: 0.040, deepness: 0.78, placeSkill: 0.80,
    counterRate: 0.40, smashRate: 0.74, dropRate: 0.09,
  },
  {
    id: 4, name: 'ЛЕГЕНДА', tag: 'LEGEND', elo: 2700, style: 'ATTACK',
    react: 0.108, move: 5.2, posErr: 0.032, skill: 0.95, spinRead: 0.95,
    aggro: 0.74, variety: 0.90,
    vmagMin: 6.6, vmagMax: 15.4, paceOpen: 0.50, paceRamp: 0.105, paceMax: 1.0,
    windup: 0.165, errBase: 0.040, errPress: 0.028, deepness: 0.84, placeSkill: 0.90,
    counterRate: 0.54, smashRate: 0.72, dropRate: 0.12,
  },
];

/* ---------------------------------------------------------------------
 *  TACTICS
 *  A rally is not a sequence of independent decisions. The bot picks an
 *  intent when the rally starts and sticks to it until the ball forces a
 *  change. That consistency is what makes it possible to anticipate.
 * ------------------------------------------------------------------- */
const AI_TACTICS = {
  FEEL:   { id: 'FEEL',   pace: 0.72, risk: 0.30, depth: 0.55, wide: 0.35 },
  BUILD:  { id: 'BUILD',  pace: 0.92, risk: 0.50, depth: 0.80, wide: 0.55 },
  PRESS:  { id: 'PRESS',  pace: 1.12, risk: 0.78, depth: 0.88, wide: 0.80 },
  SAFE:   { id: 'SAFE',   pace: 0.55, risk: 0.16, depth: 0.60, wide: 0.25 },
  DEFEND: { id: 'DEFEND', pace: 0.62, risk: 0.22, depth: 0.72, wide: 0.30 },
};

/** Build a racket descriptor that refineRacket() understands. */
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
      : (archId === 'LOB' ? 0.50 : archId === 'DROP' ? 0.035 : archId === 'SMASH' ? 0.04 : 0.055),
    rubber: A.soft ? { e: PH.E_RACKET * A.soft, mu: PH.MU_RACKET, et: PH.ET_RACKET * (0.5 + 0.5 * A.soft) } : null,
    vR: V3.new(), normal: V3.new(0, 0, side > 0 ? -1 : 1),
    power: 0.6, spinIntent: 0.5, swipe: null,
  };
}

/* ---------------------------------------------------------------------
 *  Backswing shapes. Offsets are in metres, in the AI's own frame
 *  (+z is towards its own end line, i.e. "back"). They are what the
 *  human actually sees, so they must differ enough to be legible at a
 *  glance: a loop drops the bat low and behind, a push opens it in front
 *  of the body, a smash cocks it high.
 * ------------------------------------------------------------------- */
const AI_BACKSWING = {
  LOOP:    { back: 0.30, lift: -0.16, side: 0.10, face: -0.30, name: 'накат' },
  COUNTER: { back: 0.24, lift: -0.05, side: 0.10, face: -0.22, name: 'контр' },
  DRIVE:   { back: 0.22, lift: -0.02, side: 0.08, face: -0.12, name: 'драйв' },
  SMASH:   { back: 0.24, lift: 0.26, side: 0.12, face: -0.06, name: 'смеш' },
  FLICK:   { back: 0.13, lift: -0.08, side: 0.05, face: -0.24, name: 'флик' },
  PUSH:    { back: 0.17, lift: 0.11, side: 0.03, face: 0.34, name: 'подрезка' },
  CHOP:    { back: 0.26, lift: 0.22, side: 0.05, face: 0.42, name: 'чоп' },
  BLOCK:   { back: 0.05, lift: 0.01, side: 0.01, face: 0.04, name: 'блок' },
  LOB:     { back: 0.20, lift: -0.22, side: 0.04, face: -0.10, name: 'свеча' },
  HOOK:    { back: 0.24, lift: -0.08, side: 0.26, face: -0.18, name: 'хук' },
  FADE:    { back: 0.24, lift: -0.08, side: -0.26, face: -0.18, name: 'фейд' },
  DROP:    { back: 0.09, lift: 0.07, side: 0.02, face: 0.22, name: 'укорот' },
};
const AI_BACKSWING_DEFAULT = AI_BACKSWING.DRIVE;

class OpponentAI {
  constructor(level = 2) {
    this.setLevel(level);
    this.side = -1;                       // far side of the table
    this.pos = V3.new(0, PH.TABLE_Y + 0.22, -1.55);
    this.target = V3.new(0, PH.TABLE_Y + 0.22, -1.55);
    this.home = V3.new(0, PH.TABLE_Y + 0.24, -1.52);
    this.vel = V3.new();
    this.faceNormal = V3.new(0, 0.12, 1);

    this.phase = 'IDLE';                  // IDLE READ TRACK WINDUP RECOVER
    this.plan = null;                     // {x,y,z,t,speed}
    this.commit = null;                   // the shot decided in advance
    this.readT = 0;                       // reaction timer
    this.seenBallId = -1;                 // so reaction fires once per shot

    this.pace = 0.4;                      // rally escalation, 0..1
    this.tactic = AI_TACTICS.FEEL;
    this.exchange = 0;                    // own shots inside this rally
    this.lastArch = 'DRIVE';
    this.repeat = 0;                      // how many times in a row
    this.mood = 0;                        // -1 rattled .. +1 confident
    this.pressure = 0;                    // 0..1 scoreboard pressure
    this.handicap = 1;                    // dynamic difficulty multiplier

    this.lastShot = null;
    this.tell = { kind: '', t: 0, strength: 0 };
    this._pred = {};
    this._q = {};
    this.anim = { swing: 0, lean: 0, arm: 0, windup: 0 };
    this.stats = { shots: 0, errors: 0, winners: 0, sumSpeed: 0, maxSpeed: 0 };
  }

  setLevel(i) {
    this.levelIndex = clamp(i | 0, 0, AI_LEVELS.length - 1);
    this.L = AI_LEVELS[this.levelIndex];
    this.maxSpeed = this.L.move;
    this.pace = this.L.paceOpen;
  }

  setHandicap(h) {
    this.handicap = clamp(h, 0.5, 1.5);
  }

  /** full reset between matches */
  reset() {
    this.phase = 'IDLE'; this.plan = null; this.commit = null;
    this.readT = 0; this.seenBallId = -1;
    this.exchange = 0; this.pace = this.L.paceOpen;
    this.tactic = AI_TACTICS.FEEL;
    this.mood = 0; this.pressure = 0; this.handicap = 1;
    this.stats = { shots: 0, errors: 0, winners: 0, sumSpeed: 0, maxSpeed: 0 };
    V3.copy(this.target, this.home);
  }

  /** called by the game whenever a point finishes */
  onPointEnd(who) {
    this.exchange = 0;
    this.pace = this.L.paceOpen;
    this.plan = null; this.commit = null;
    this.phase = 'IDLE';
    this.mood = clamp(this.mood + (who > 0 ? -0.22 : 0.18), -1, 1);
    // pick the intent for the next rally from style + mood
    this.tactic = this.rollTactic();
  }

  /** Scoreboard awareness: 9-9 is not the same ball as 3-0. */
  setPressure(myScore, theirScore, target) {
    const near = Math.max(myScore, theirScore) / Math.max(4, target - 1);
    const tight = 1 - clamp(Math.abs(myScore - theirScore) / 4, 0, 1);
    this.pressure = clamp(near * 0.6 + tight * 0.4, 0, 1) * clamp(near, 0, 1);
  }

  /** Dynamic difficulty: a long losing streak quietly softens the bot by
   *  up to 12 %. Off by default on the two top levels, where the player
   *  has explicitly asked for a wall. */
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

  /** Where will the ball be when it is comfortable to hit it, and when?
   *  Everything downstream keys off this single estimate. */
  computePlan(game) {
    const ball = game.ball;
    const o = this._pred;
    predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w), {
      dt: 1 / 240, maxT: 2.4, stopZ: -PH.T_HALF_LEN - 0.26, stopDir: -1,
      stopAtPlane: false, out: o,
    });

    if (o.landed && o.landed.z < 0) {
      // Where a real player stands. You do NOT drift backwards for a
      // whole fixed delay after the bounce: you pick a hitting plane a
      // short step behind your end line and meet the ball there. Pace
      // and heavy topspin push that plane back, floaters pull it in so
      // the ball can be taken at the top of the bounce.
      const inSpeed = V3.len(ball.v);
      const topIn = this.side * ball.w.x;             // >0 = topspin at me
      let zHit = -PH.T_HALF_LEN
        - clamp(0.10 + inSpeed * 0.030 + Math.max(0, topIn) * 0.00022, 0.08, 0.62);
      // Short balls have to be taken in, over the table, or they die.
      if (o.landed.z > -0.62) zHit = Math.max(zHit, o.landed.z - 0.52);
      zHit = clamp(zHit, -2.05, -0.95);

      const q = this._q;
      predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w),
        { dt: 1 / 240, maxT: 2.4, stopZ: zHit, stopDir: -1, stopAtPlane: true, out: q });

      // If the plane is crossed too soon after the bounce the ball is
      // still rising awkwardly: nudge the contact later, but by time,
      // never past the top of the bounce.
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

  /** Anticipation noise: far from the ball the bot guesses, close to it
   *  it knows. This is what makes wrong-footing possible. */
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

  /** Pick the stroke. Deterministic enough to be learnable: the same
   *  ball in the same tactic gets the same answer most of the time, and
   *  the bot likes repeating what just worked. */
  pickStroke(game, plan) {
    const L = this.L, T = this.tactic, ball = game.ball;
    const hNet = plan.y - PH.NET_TOP;
    const hTable = plan.y - PH.TABLE_Y;
    const topspin = this.side * ball.w.x;      // >0 = topspin coming at me
    const backspin = topspin < -140;
    const heavyTop = topspin > 230;
    const inSpeed = plan.speed;
    const deepMe = plan.z < -PH.T_HALF_LEN - 0.52;
    const aggro = clamp((L.aggro * 0.7 + T.risk * 0.5) * (0.85 + this.pace * 0.3)
      + this.mood * 0.08 - this.pressure * 0.07, 0, 1.1);
    const r = Math.random();

    // --- forced / obvious situations first -------------------------
    if (hNet > 0.17 && inSpeed < 13.5) {              // a sitter
      if (r < L.smashRate * (0.55 + aggro * 0.6)) return 'SMASH';
      return 'DRIVE';
    }
    if (deepMe) {                                      // genuinely pushed back
      if (hTable > 0.26 && r < 0.42 + aggro * 0.34) return 'LOOP';
      if (r < 0.30) return 'LOB';
      return r < 0.62 ? 'DRIVE' : 'CHOP';
    }
    if (inSpeed > 17.5) {                              // heavy incoming pace
      const block = 0.78 - aggro * 0.42;
      if (r < block) return 'BLOCK';
      return r < block + L.counterRate ? 'COUNTER' : 'DRIVE';
    }
    if (backspin) {                                    // must be lifted
      if (hTable < 0.10 && plan.short) return r < 0.30 + aggro * 0.35 ? 'FLICK' : 'PUSH';
      if (r < 0.30 + aggro * 0.55) return 'LOOP';
      return 'PUSH';
    }
    if (plan.short && hTable < 0.16) {                 // short over the table
      if (r < L.dropRate) return 'DROP';
      return r < 0.26 + aggro * 0.42 ? 'FLICK' : 'PUSH';
    }
    if (heavyTop && r < L.counterRate + aggro * 0.2) return 'COUNTER';

    // --- stylistic colour -----------------------------------------
    if (L.style === 'PUSHER' && r < 0.55 - aggro * 0.3) return 'PUSH';
    if (r < 0.07 * L.variety * T.wide) return Math.random() < 0.5 ? 'HOOK' : 'FADE';
    if (r < 0.07 * L.variety * T.wide + 0.08 * (1 - aggro)) return 'PUSH';

    // --- the bread and butter --------------------------------------
    if (r < 0.34 + aggro * 0.46) return 'LOOP';
    return 'DRIVE';
  }

  /** Where to put it. Placement is a skill: weak levels aim at the middle
   *  and miss their intention anyway, strong ones work the corners and
   *  wrong-foot you on purpose. */
  pickTarget(game, plan, archId) {
    const L = this.L, T = this.tactic;
    const px = game.player.pos.x;
    const playerSide = sign(px || rndSym(1));
    const skill = L.placeSkill * this.handicap;

    // intent: away from the player, at the body, or behind them
    const roll = Math.random();
    let wantX;
    if (roll < 0.16 + (1 - skill) * 0.25) {
      wantX = px * 0.85;                                   // at the body
    } else if (roll < 0.30) {
      wantX = px * 1.25;                                   // wrong-foot: behind
    } else {
      wantX = -playerSide * PH.T_HALF_WID * lerp(0.30, 0.86, T.wide * skill);
    }
    wantX += gauss(0.26 * (1 - skill) + 0.045);

    // depth: short balls pull the player in, deep ones pin them back
    let depth;
    if (archId === 'DROP') depth = rnd(0.06, 0.20);
    else if (archId === 'PUSH' || archId === 'CHOP') depth = rnd(0.55, 0.95) * T.depth + 0.08;
    else if (archId === 'SMASH') depth = rnd(0.45, 0.80);
    else depth = clamp(L.deepness * T.depth + rndSym(0.18), 0.22, 0.97);

    const edge = PH.T_HALF_WID * (0.86 + T.risk * 0.08);
    return {
      x: clamp(wantX, -edge, edge),
      z: lerp(0.14, PH.T_HALF_LEN - 0.06, clamp(depth, 0, 1)),
      depth,
    };
  }

  /** Racket speed for this ball. Everything that makes the bot feel
   *  "impossibly fast" lives here, so it is deliberately conservative
   *  and clamped at both ends. */
  pickPace(archId, plan) {
    const L = this.L, T = this.tactic;
    const A = ARCH[archId] || ARCH.DRIVE;
    // rally escalation, tactic multiplier, a touch of mood
    let p = clamp(this.pace * T.pace + this.mood * 0.04, 0.12, L.paceMax);
    if (archId === 'SMASH') p = clamp(p + 0.22, 0.4, 1.05);
    if (archId === 'BLOCK' || archId === 'DROP') p = Math.min(p, 0.45);
    if (archId === 'PUSH' || archId === 'CHOP') p = Math.min(p, 0.62);
    // pressure makes it shorten the swing rather than swing harder
    p *= 1 - this.pressure * 0.10;
    p *= this.handicap;
    const base = lerp(L.vmagMin, L.vmagMax, clamp(p, 0, 1));
    const v = base * (A.speed || 1) * (0.93 + Math.random() * 0.14);
    return clamp(v, 1.2, 17.5);
  }

  /* ==================================================================
   *  THINK  —  called every frame
   * ================================================================== */
  think(game, dt) {
    const ball = game.ball, L = this.L;
    this.anim.swing = Math.max(0, this.anim.swing - dt * 5.2);
    if (this.tell.t > 0) this.tell.t -= dt;

    const playing = game.state === GS.RALLY || game.state === 'SERVE_FLIGHT';
    const incoming = playing && ball.live && ball.lastHitBy === 1
      && (ball.v.z < -0.2 || (ball.p.z < 0 && ball.v.z < 1));

    if (!incoming) {
      this.idle(game, dt);
      return;
    }

    /* --- reaction: the bot does not know instantly ----------------- */
    if (this.seenBallId !== game.shotId) {
      this.seenBallId = game.shotId;
      this.readT = L.react * (1 + this.pressure * 0.18) / this.handicap;
      this.phase = 'READ';
      this.plan = null;
      this.commit = null;
    }
    if (this.readT > 0) {
      this.readT -= dt;
      // during the reaction window it only drifts towards the middle of
      // the likely spread — this is the window where you can wrong-foot it
      this.target.x = lerp(this.target.x, ball.p.x * 0.35, 1 - Math.exp(-5 * dt));
      this.target.y = lerp(this.target.y, PH.TABLE_Y + 0.26, 1 - Math.exp(-5 * dt));
      this.target.z = lerp(this.target.z, -1.52, 1 - Math.exp(-5 * dt));
      this.move(dt, 0.75);
      return;
    }

    /* --- tracking --------------------------------------------------- */
    if (!this.plan || game.frame % 3 === 0) {
      const p = this.computePlan(game);
      if (p) this.plan = p;
    }
    if (!this.plan) { this.move(dt, 1); return; }

    const lead = this.plan.t - game.time;

    /* --- commit + backswing ----------------------------------------- */
    const windup = L.windup * (0.8 + (1 - this.pace) * 0.4);
    if (!this.commit && lead < windup && lead > 0.012) {
      const archId = this.pickStroke(game, this.plan);
      const tgt = this.pickTarget(game, this.plan, archId);
      this.commit = {
        arch: archId, tgt,
        vmag: this.pickPace(archId, this.plan),
        at: this.plan.t,
        windup,
        bs: AI_BACKSWING[archId] || AI_BACKSWING_DEFAULT,
      };
      this.phase = 'WINDUP';
      this.tell = { kind: archId, t: windup + 0.25, strength: clamp(windup / 0.3, 0, 1) };
      // repeating a pattern is human and makes the bot learnable
      this.repeat = archId === this.lastArch ? this.repeat + 1 : 0;
      this.lastArch = archId;
    }

    const aim = this.noisyTarget(this.plan, game);

    if (this.commit) {
      // 0 at commit -> 1 at contact
      const k = clamp(1 - (this.commit.at - game.time) / Math.max(this.commit.windup, 1e-3), 0, 1);
      // pull back on the first 55 %, drive through on the rest
      const pull = k < 0.55 ? (k / 0.55) : (1 - (k - 0.55) / 0.45);
      const bs = this.commit.bs;
      this.anim.windup = pull;
      V3.set(this.target,
        aim.x - bs.side * pull * sign(this.commit.tgt.x - this.plan.x || 1),
        aim.y + bs.lift * pull,
        aim.z - bs.back * pull);
      // the bat face tilts during the backswing: open for chop/push,
      // closed for loop/drive. This is the readable part.
      const f = bs.face * pull;
      V3.norm(this.faceNormal, V3.set(this.faceNormal, this.faceNormal.x * 0.6, f, 1));
      this.move(dt, clamp(1.4 + pull * 1.2, 0.8, 2.6));
    } else {
      this.anim.windup = expSmooth(this.anim.windup, 0, 8, dt);
      V3.copy(this.target, aim);
      V3.norm(this.faceNormal, V3.set(this.faceNormal, this.faceNormal.x * 0.7, 0.10, 1));
      this.move(dt, clamp(1.7 - lead, 0.65, 2.0));
    }
  }

  idle(game, dt) {
    this.plan = null;
    this.commit = null;
    this.phase = 'IDLE';
    this.anim.windup = expSmooth(this.anim.windup, 0, 7, dt);
    const k = 1 - Math.exp(-2.6 * dt);
    this.target.x = lerp(this.target.x, 0, k);
    this.target.y = lerp(this.target.y, PH.TABLE_Y + 0.24, k);
    this.target.z = lerp(this.target.z, -1.52, k);
    V3.norm(this.faceNormal, V3.set(this.faceNormal, this.faceNormal.x * 0.8, 0.12, 1));
    this.move(dt, 0.9);
  }

  move(dt, urgency) {
    const sp = this.maxSpeed * urgency;
    const d = V3.sub(V3.new(), this.target, this.pos);
    const dist = V3.len(d);
    if (dist > 1e-5) {
      const step = Math.min(dist, sp * dt);
      V3.addScaled(this.pos, this.pos, V3.mul(d, d, 1 / dist), step);
      V3.mul(this.vel, d, step / Math.max(dt, 1e-4));
    } else V3.mul(this.vel, this.vel, 0.6);
    // A bat with no player behind it has to stay somewhere believable,
    // otherwise it reads as a UFO hovering over the hall.
    this.pos.y = clamp(this.pos.y, PH.TABLE_Y - 0.16, PH.TABLE_Y + 0.70);
    this.pos.x = clamp(this.pos.x, -1.25, 1.25);
    this.pos.z = clamp(this.pos.z, -2.45, -1.16);
    this.anim.lean = expSmooth(this.anim.lean, clamp(this.pos.x * 0.8, -1, 1), 6, dt);
  }

  /** has the bot committed and is it time to strike? */
  readyToStrike(time) {
    return !!this.commit && time >= this.commit.at - 0.012;
  }

  /* ==================================================================
   *  EXECUTION
   * ================================================================== */
  swing(game) {
    const ball = game.ball, L = this.L;
    const C = this.commit || {
      arch: 'DRIVE', tgt: { x: rndSym(0.5), z: 0.7 }, vmag: lerp(L.vmagMin, L.vmagMax, 0.4),
    };
    const archId = C.arch;
    const A = ARCH[archId] || ARCH.DRIVE;
    const inSpeed = V3.len(ball.v);

    /* --- error model -------------------------------------------------
     * No magic "whiff" roll. Three things go wrong for real players and
     * all three are modelled as a distortion of the stroke, so the ball
     * still obeys physics and the miss is explainable on screen.       */
    const press = this.pressure * L.errPress;
    const paceStrain = clamp((this.pace - 0.6) * 0.5, 0, 0.3);
    const errChance = (L.errBase + press + paceStrain * 0.4) / this.handicap;
    const slip = Math.random() < errChance;

    // spin misread: the face goes the wrong way by a fraction of the spin
    const read = clamp(L.spinRead + gauss(0.05), 0, 1);
    const misread = (1 - read) * (ball.w.x * this.side) / 820;

    let contact = A.contact + gauss(6.5 * (1 - L.skill)) + misread * 20;
    let elev = A.elev + gauss(5.0 * (1 - L.skill)) - misread * 15;
    let vmag = C.vmag * this.handicap;

    if (slip) {
      // one of: too flat (net), too long, or badly timed (weak + wide)
      const kind = Math.random();
      if (kind < 0.40) { contact -= 11 + Math.random() * 9; elev -= 7; }        // into the net
      else if (kind < 0.78) { elev += 9 + Math.random() * 8; vmag *= 1.18; }    // long
      else { vmag *= 0.6; contact += 9; }                                       // mistimed
      this.stats.errors++;
    }

    contact = clamp(contact, 12, 84);
    const azS = clamp((C.tgt.x - ball.p.x) * 0.21 + gauss(0.055 * (1 - L.skill)), -1.15, 1.15);

    const racket = makeRacket(this.side, archId, {
      elev, contact, azSwing: azS, azFace: azS * 0.45,
      vmag: clamp(vmag, 1.2, 18),
      aim: { x: C.tgt.x, z: C.tgt.z },
      quality: clamp(0.56 + L.skill * 0.44 + gauss(0.05) - (slip ? 0.22 : 0), 0.28, 1),
    });
    const refined = refineRacket(ball.p, ball.v, ball.w, racket,
      clamp(L.skill * this.handicap + gauss(0.045), 0, 1), racket.quality);

    // residual execution noise: even a master is not a robot
    const n = (1 - L.skill) * 0.9;
    const jitter = Q.setAxisAngle(Q.new(), rndSym(1), rndSym(1), rndSym(1), gauss(0.030 * n + 0.006));
    rotateVecQuat(refined.normal, refined.normal, jitter);
    V3.mul(refined.vR, refined.vR, 1 + gauss(0.045 * n));

    /* --- rally bookkeeping ------------------------------------------ */
    this.exchange++;
    this.pace = clamp(this.pace + L.paceRamp * (0.6 + this.tactic.risk * 0.8), 0, L.paceMax);
    // a hard ball coming back raises the tempo on its own
    if (inSpeed > 14) this.pace = clamp(this.pace + 0.03, 0, L.paceMax);
    if (this.exchange === 3 && this.tactic === AI_TACTICS.FEEL) this.tactic = AI_TACTICS.BUILD;
    if (this.exchange >= 6 && Math.random() < 0.25) this.tactic = AI_TACTICS.PRESS;

    this.anim.swing = 1;
    this.anim.windup = 0;
    this.stats.shots++;
    this.commit = null;
    this.phase = 'RECOVER';
    this.lastShot = {
      arch: archId, stroke: STROKES[archId], target: C.tgt, racket: refined,
      slip, pace: this.pace, tactic: this.tactic.id,
    };
    return refined;
  }

  /* ==================================================================
   *  SERVE
   * ================================================================== */
  serve(game) {
    const L = this.L;
    // A server does not roll dice every time: it runs a short pattern and
    // then changes it, which is exactly what a human does.
    if (!this._servePlan || this._servePlan.left <= 0) {
      const kinds = ['SERVE_TOP', 'SERVE_BACK', 'SERVE_SIDE', 'SERVE_FAST'];
      const w = L.style === 'PUSHER' ? [0.22, 0.46, 0.26, 0.06]
        : L.style === 'ATTACK' ? [0.26, 0.24, 0.30, 0.20]
          : [0.26, 0.32, 0.30, 0.12];
      let r = Math.random(), k = 0, acc = 0;
      for (let i = 0; i < 4; i++) { acc += w[i]; if (r <= acc) { k = i; break; } }
      this._servePlan = { arch: kinds[k], left: 1 + (Math.random() < 0.45 ? 1 : 0), sideX: rndSym(1) };
    }
    this._servePlan.left--;

    const archId = this._servePlan.arch;
    const A = ARCH[archId];
    const wide = clamp(L.placeSkill, 0.2, 0.92);
    const tx = sign(this._servePlan.sideX) * PH.T_HALF_WID * rnd(0.18, 0.74 * wide + 0.12);
    const tz = archId === 'SERVE_FAST' ? rnd(0.85, PH.T_HALF_LEN - 0.12) : rnd(0.30, 1.05);

    const racket = makeRacket(this.side, archId, {
      elev: A.elev + gauss(4.5 * (1 - L.skill) + 1.5),
      contact: A.contact + gauss(5.5 * (1 - L.skill) + 1.5),
      azSwing: rndSym(0.45), azFace: rndSym(0.22),
      vmag: clamp((2.9 + 4.4 * (0.5 + L.skill * 0.5)) * (A.speed || 1) * (0.92 + Math.random() * 0.16), 2, 10.5),
      aim: { x: tx, z: tz },
      isServe: true,
      quality: clamp(0.58 + L.skill * 0.42 + gauss(0.04), 0.3, 1),
      netClear: 0.055,
    });
    this.anim.swing = 1;
    this.tell = { kind: archId, t: 0.5, strength: 0.6 };
    this.lastShot = { arch: archId, stroke: STROKES[archId], racket, slip: false };
    this.exchange = 0;
    this.pace = this.L.paceOpen;
    return refineRacket(game.ball.p, game.ball.v, game.ball.w, racket, clamp(L.skill, 0, 1), racket.quality);
  }
}

/** rotate a vector by a quaternion (in place safe) */
function rotateVecQuat(out, v, q) {
  const { x, y, z } = v, qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}
