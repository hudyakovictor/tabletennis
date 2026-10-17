/* =====================================================================
 *  TRAINING — a real, interactive coach.
 *
 *  Not a wall of text: a ball feeder, one skill at a time, an animated
 *  ghost gesture drawn right where your finger has to go, and a pass
 *  condition read straight out of the physics (actual spin, actual
 *  landing point). You cannot "read" your way past a step — you have to
 *  hit it.
 * ===================================================================== */

// Capabilities first, then actual pointer events in UI: a narrow desktop is
// still a mouse device; a touchscreen laptop can switch without reloading.
function detectInputMode(win = window, nav = navigator) {
  const matches = query => !!(win.matchMedia && win.matchMedia(query).matches);
  return matches('(pointer: coarse)') || ((nav.maxTouchPoints || 0) > 0 && !matches('(pointer: fine)')) ? 'touch' : 'mouse';
}
function trainingTip(step, mode) { return mode === 'touch' ? step.tip : step.mouseTip; }

const TRAIN_STEPS = [
  {
    id: 'SERVE', title: 'ПОДАЧА', need: 2,
    tip: 'Проведите пальцем вверх.', mouseTip: 'Зажмите ЛКМ, ведите вверх.',
    gesture: [[0.50, 0.80], [0.50, 0.50]], speed: 1.0, dur: 0.15,
    feed: null,
  },
  {
    id: 'TOPSPIN', title: 'ТОПСПИН', need: 3,
    tip: 'Свайп вверх при замыкании кольца.', mouseTip: 'ЛКМ + вверх при замыкании кольца.',
    gesture: [[0.49, 0.82], [0.525, 0.46]], speed: 1.0, dur: 0.16,
    feed: { kind: 'normal', spin: -95, speed: 6.0 },
    check: (g, s) => s.topspin > 45,
    failHint: 'Длиннее вверх.',
  },
  {
    id: 'PUSH', title: 'ПОДРЕЗКА', need: 2,
    tip: 'Мягкий свайп вниз.', mouseTip: 'ЛКМ + мягкое движение вниз.',
    gesture: [[0.50, 0.52], [0.50, 0.80]], speed: 0.8, dur: 0.20,
    feed: { kind: 'normal', spin: 40, speed: 5.2 },
    check: (g, s) => s.topspin < -30,
    failHint: 'Ведите вниз.',
  },
  {
    id: 'SIDE', title: 'БОКОВОЕ ВРАЩЕНИЕ', need: 2,
    tip: 'Нарисуйте пальцем дугу вбок.', mouseTip: 'ЛКМ + дуга вбок.',
    gesture: [[0.455, 0.82], [0.472, 0.695], [0.517, 0.615], [0.605, 0.588]], speed: 1.1, dur: 0.15,
    feed: { kind: 'normal', spin: -40, speed: 5.6 },
    check: (g, s) => Math.abs(s.sidespin) > 32,
    failHint: 'Дугой, не по прямой.',
  },
  {
    id: 'TIMING', title: 'ТАЙМИНГ', need: 2,
    tip: 'Кольцо замкнулось — свайп вверх.', mouseTip: 'Кольцо замкнулось — ЛКМ + вверх.',
    gesture: [[0.50, 0.80], [0.515, 0.54]], speed: 1.25, dur: 0.13,
    feed: { kind: 'fast', spin: -110, speed: 10.2 },
    check: () => true,
    failHint: 'Дождитесь замыкания кольца.',
  },
  {
    id: 'SMASH', title: 'СМЕШ', need: 2,
    tip: 'Резкий короткий свайп вбок.', mouseTip: 'ЛКМ + резкое движение вбок.',
    gesture: [[0.435, 0.655], [0.600, 0.690]], speed: 1.7, dur: 0.055,
    feed: { kind: 'high', spin: -15, v: [0, 3.6, 3.2], y0: 1.02 },
    check: (g, s) => s.speed > 55,
    failHint: 'Быстрее и резче.',
  },
];

class Trainer {
  constructor(game) {
    this.g = game;
    this.step = 0;
    this.done = 0;
    this.phase = 'intro';
    this.t = 0;
    this.msg = '';
    this.msgCol = '';
    this.lastShot = null;
    this.attempts = 0;
    this.total = 0;
    this.finished = false;
  }

  get S() { return TRAIN_STEPS[this.step]; }

  /* --------------------------- lifecycle -------------------------- */
  begin() {
    const g = this.g;
    g.score = [0, 0];
    g.rally = 0;
    g.server = 1;
    g.state = GS.RALLY;
    g.ball.live = false;
    g.isServeBall = false;
    this.goStep(0);
  }

  goStep(i) {
    this.step = clamp(i, 0, TRAIN_STEPS.length - 1);
    this.done = 0; this.attempts = 0;
    this.phase = 'intro'; this.t = 0;
    this.msg = ''; this.lastShot = null;
    this.g.ball.live = false;
    this.g.isServeBall = false;
    this.sync();
  }

  nextStep() {
    if (this.step + 1 >= TRAIN_STEPS.length) { this.complete(); return; }
    this.goStep(this.step + 1);
  }

  complete() {
    this.finished = true;
    this.phase = 'done';
    this.g.ball.live = false;
    this.g.ui && this.g.ui.trainDone(this);
  }

  quit() {
    const g = this.g;
    g.training = null;
    g.ball.live = false;
    g.state = GS.MENU;
    g.ui && g.ui.trainHide();
  }

  sync() { this.g.ui && this.g.ui.trainSync(this); }

  /* ----------------------------- feeder --------------------------- */
  /** Serve one practice ball from the far side, shaped for the drill. */
  feed() {
    const g = this.g, b = this.g.ball, S = this.S;
    g.marks.length = 0;
    g.rallyBounces.length = 0;
    g.serveBounces = 0;
    g.netTouched = false;
    if (!S.feed) {                       // the serve drill: you start the ball
      g.server = 1;
      g.prepServe();
      this.phase = 'live'; this.t = 0;
      return;
    }
    const F = S.feed;
    const lane = rndSym(0.30);
    const from = V3.new(lane, F.y0 !== undefined ? F.y0 : PH.TABLE_Y + 0.30, -1.22);
    const spin = V3.new(F.spin * TAU / 60 * 2.2, 0, 0);
    V3.copy(b.p, from);
    if (F.v) {
      // a hand-shaped lob: solvers always flatten these into a drive
      V3.set(b.v, -lane * 0.55 + rndSym(0.12), F.v[1], F.v[2]);
    } else {
      const target = { x: rndSym(0.34), z: 0.62 };
      const sol = solveLaunch(from, target, spin, {
        speed: F.speed, netClear: F.kind === 'fast' ? 0.07 : 0.16, speedForgive: 0.3,
      });
      if (sol) V3.set(b.v, sol.vx, sol.vy, sol.vz);
      else V3.set(b.v, 0, 1.6, 5.4);
    }
    V3.copy(b.w, spin);
    Q.identity(b.q);
    b.live = true; b.hist.length = 0; b.lastHitBy = -1;
    g.isServeBall = false;
    g.rallyBounces.length = 0;
    g.state = GS.RALLY;
    V3.copy(g.aiPaddle.pos, from);
    this.phase = 'live'; this.t = 0;
  }

  /* ------------------------- event handlers ----------------------- */
  /** called from Game.applyHit for the pupil's own shots */
  onPlayerHit(info) {
    if (this.phase !== 'live') return;
    this.lastShot = info;
    this.attempts++; this.total++;
    this.hitAt = this.g.time;
  }

  /** called from Game.onBounce */
  onBounce(side, lastHitBy) {
    if (this.phase !== 'live') return;
    const S = this.S;
    if (S.id === 'SERVE') {
      // ITTF legality is already tracked by the match code; we only need
      // to know the serve crossed after touching the server's half
      // Game.onBounce calls us BEFORE it bumps serveBounces, so the
      // crossing bounce is still counted as #1 here.
      if (lastHitBy === 1 && side === -1 && this.g.serveBounces >= 1) this.pass();
      return;
    }
    if (lastHitBy !== 1 || side !== -1) return;
    const s = this.lastShot;
    if (!s) return;
    if (!S.check || S.check(this.g, s)) this.pass();
    else this.fail(S.failHint || 'Повторите жест.');
  }

  /** called instead of awardPoint while training */
  onFault(who, reason) {
    if (this.phase !== 'live') return;
    if (who > 0) return;                       // the feeder "lost" the point: ignore
    const S = this.S;
    let r = reason;
    if (reason === 'АУТ') r = 'Аут. Бейте мягче.';
    else if (reason === 'В СЕТКУ') r = 'Сетка. Ведите длиннее вверх.';
    else if (reason === 'ВЫ НЕ ДОСТАЛИ МЯЧ' || reason === 'ОЧКО СОПЕРНИКУ') r = 'Бейте при замыкании кольца.';
    else if (reason.indexOf('ПОДАЧ') >= 0) r = 'Сначала отскок на своей половине.';
    this.fail(r);
  }

  pass() {
    this.done++;
    this.phase = 'ok'; this.t = 0;
    this.msg = this.done >= this.S.need ? 'ШАГ ПРОЙДЕН' : 'ОТЛИЧНО!';
    this.msgCol = '#4ee39a';
    this.g.audio.ui('good');
    this.sync();
  }

  fail(why) {
    this.phase = 'fail'; this.t = 0;
    this.msg = why;
    this.msgCol = '#ffb066';
    this.g.audio.ui('bad');
    this.sync();
  }

  skip() { if (this.phase !== 'done') this.nextStep(); }

  /* ------------------------------ tick ---------------------------- */
  update(dt) {
    this.t += dt;
    const g = this.g;
    switch (this.phase) {
      case 'intro':
        // read the card, watch the ghost loop once, then go (tap skips)
        if (this.t > 2.8 || (this.t > 0.4 && g.pointerDown)) { this.phase = 'wait'; this.t = 0; }
        break;
      case 'wait':
        if (this.t > 0.45) this.feed();
        break;
      case 'live': {
        // the serve drill parks the ball in your hand: that is not "dead"
        const serving = g.state === GS.SERVE_READY || g.state === GS.SERVE_TOSS;
        if (!serving && !g.ball.live && this.t > 0.6) { this.phase = 'wait'; this.t = 0; }
        if (this.t > (serving ? 22 : 11)) { this.phase = 'wait'; this.t = 0; }
        break;
      }
      case 'ok':
        if (this.t > 1.0) {
          g.ball.live = false;
          if (this.done >= this.S.need) this.nextStep();
          else { this.phase = 'wait'; this.t = 0; }
        }
        break;
      case 'fail':
        if (this.t > 1.5) { g.ball.live = false; this.phase = 'wait'; this.t = 0; }
        break;
    }
  }
}
