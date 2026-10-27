/* =====================================================================
 *  TRAINING — a real, interactive coach.
 *
 *  One drill at a time. A read-only objective stays above play;
 *  no looping gesture overlay and no controls in the swipe area.
 *  Progress requires measured spin/speed and an actual legal bounce.
 * ===================================================================== */

// Capabilities first, then actual pointer events in UI: a narrow desktop is
// still a mouse device; a touchscreen laptop can switch without reloading.
function detectInputMode(win = window, nav = navigator) {
  const matches = query => !!(win.matchMedia && win.matchMedia(query).matches);
  return matches('(pointer: coarse)') || ((nav.maxTouchPoints || 0) > 0 && !matches('(pointer: fine)')) ? 'touch' : 'mouse';
}
function trainingTip(step, mode) { return ET(mode === 'touch' ? step.tip : step.mouseTip); }

/* The drills, in the order a beginner needs them: от САМОГО ПРОСТОГО к
 * сложному — сначала подать мяч в игру, потом отбить, потом управлять,
 * и только затем новые удары. Each drill holds the ball until the gesture. */
const TRAIN_STEPS = [
  {
    id: 'SERVE', goal: 'drill.serve.goal', title: 'drill.serve.title', need: 3, coach: 'serve',
    tip: 'drill.serve.tip', mouseTip: 'drill.serve.mouseTip',
    feed: null,
  },
  {
    id: 'HIT', goal: 'drill.hit.goal', title: 'drill.hit.title', need: 3, coach: 'hit',
    tip: 'drill.hit.tip', mouseTip: 'drill.hit.mouseTip',
    feed: { kind: 'normal', spin: -40, speed: 4.8 },
    check: () => true,
    failHint: 'drill.hit.fail',
  },
  {
    id: 'AIM', goal: 'drill.aim.goal', title: 'drill.aim.title', need: 2, coach: 'aim',
    tip: 'drill.aim.tip', mouseTip: 'drill.aim.mouseTip',
    feed: { kind: 'normal', spin: -55, speed: 5.0 },
    check: (g, s, T) => g.ball.p.x * T.aimSide > 0.10,
    failHint: 'drill.aim.fail',
  },
  {
    id: 'TOPSPIN', goal: 'drill.topspin.goal', title: 'drill.topspin.title', need: 2, coach: 'ring',
    tip: 'drill.topspin.tip', mouseTip: 'drill.topspin.mouseTip',
    feed: { kind: 'normal', spin: -95, speed: 6.0 },
    check: (g, s) => s.topspin > 45,
    failHint: 'drill.topspin.fail',
  },
  {
    id: 'PUSH', goal: 'drill.push.goal', title: 'drill.push.title', need: 2, coach: 'ring',
    tip: 'drill.push.tip', mouseTip: 'drill.push.mouseTip',
    feed: { kind: 'normal', spin: 40, speed: 5.2 },
    check: (g, s) => s.topspin < -30,
    failHint: 'drill.push.fail',
  },
  {
    id: 'RALLY', goal: 'drill.rally.goal', title: 'drill.rally.title', need: 3, coach: 'none',
    tip: 'drill.rally.tip', mouseTip: 'drill.rally.mouseTip',
    feed: { kind: 'mix', spin: -55, speed: 5.9 },
    check: () => true,
    failHint: 'drill.rally.fail',
  },
];

/** Seconds before the meeting point at which the guided ball is held — early
 *  enough that the pupil SEES the ball and the ring and then reaches for it. */
const COACH_FREEZE_T = 0.32;

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
    this.ballNo = 0;          // balls fed in this drill
    this.fails = 0;           // misses in a row (brings the crutches back)
    this.frozen = false;      // the ball is held in mid-air for the pupil
    /* ОДИН раз за сессию на урок: id встреченных заморозок. Пользовательская
     * боль «туториал повторяет одно и то же каждый раз» — freeze срабатывал
     * на КАЖДОЙ подаче/мяче заново, потому что heldOnce сбрасывается мяча к
     * мячу. Показал — запомнил — больше не прерываем. */
    this._frozenDrills = new Set();
    this.heldOnce = false;    // this ball has already been held
    this.nudge = 0;           // >0: the press missed the ring, shake it
    this.aimSide = 1;
    this.unfrozeAt = -9;
  }

  /** Тренировка — это обучение, а не экзамен: на шагах с подсказкой мяч
   *  ЖДЁТ жеста на КАЖДОМ мяче до конца урока. Никакой лесенки
   *  «усложнений» внутри шага, никакой эскалации раньше времени —
   *  костыли снимает только финальный шаг закрепления. */
  get guide() {
    return this.S.coach === 'none' ? 'none' : 'freeze';
  }

  /** The one sentence on screen right now. ОДНА короткая строка на шаг —
   *  никакой карусели текстов, которую не успевают прочитать. */
  get coachText() {
    if (this.phase === 'ok' || this.phase === 'fail') return this.msg;
    const S = this.S, touch = !(this.g.ui && this.g.ui.inputMode === 'mouse');
    if (S.id === 'SERVE' && this.g.state === GS.SERVE_READY)
      return touch ? ET('ui.tapBallTouch') : ET('ui.tapBallMouse');
    if (S.id === 'AIM')
      return this.aimSide > 0 ? 'Свайп вверх-вправо → в правую половину'
                              : 'Свайп вверх-влево → в левую половину';
    return trainingTip(S, touch ? 'touch' : 'mouse');
  }

  /** Called by Game when a press lands. Сначала — касание-«продолжить»:
   *  объявление урока и разбор ошибки НЕ исчезают по таймеру, они ждут,
   *  пока ученик их прочитает и коснётся экрана. */
  onPress(zone) {
    if (this.phase === 'intro') { this.phase = 'wait'; this.t = 0; this.sync(); return; }
    if (this.phase === 'fail') { this.g.ball.live = false; this.phase = 'wait'; this.t = 0; this.sync(); return; }
    if (!this.frozen) return;
    if (zone && zone.accepted) {
      this.frozen = false; this.unfrozeAt = this.g.time; this.nudge = 0;
      this.sync();
    } else {
      this.nudge = 0.6;
      this.g.audio && this.g.audio.ui && this.g.audio.ui('bad');
      this.sync();
    }
  }

  /** Per-frame coaching cue for the 2D layer (also used by the match hint). */
  coachCue() {
    const g = this.g, S = this.S, guide = this.guide;
    if (this.phase !== 'live' || guide === 'none') return null;
    if (S.id === 'SERVE') {
      /* зона подачи подсвечена всегда: текущая цель — центр/левая/правая */
      const aim = this.serveAimSide();
      if (g.state === GS.SERVE_READY) return { kind: 'tap', p: g.ball.p, aim };
      if (g.state === GS.SERVE_TOSS && g.ball.lastHitBy === 0 && g.ball.v.y < 0)
        return { kind: 'contact', p: g.ball.p, t: 0, level: this.frozen ? 'freeze' : 'ring', frozen: this.frozen, nudge: this.nudge, serve: true, aim };
      return { kind: 'aim', side: aim };
    }
    const b = g.ball;
    const cp = g.contactPrediction && g.contactPrediction();
    /* Кольцо живёт строго пока мяч реально летит к игроку: после пролёта
     * мимо точки (промах/виф) оно умирает мгновенно — без скольжения под
     * стол и без блужданий по экрану */
    const incoming = !!(b && b.live && b.v && b.v.z > 0.05);
    const passed = incoming && cp && b.p.z > cp.p.z + 0.10;
    if (!incoming || passed) {
      this._cueP = null;
      return S.coach === 'aim' ? { kind: 'aim', side: this.aimSide } : null;
    }
    if (!cp || !g.rallyBounces || (!g.rallyBounces.some((x) => x > 0) && cp.t > 0.9)) {
      /* прогноз пропал на мгновение (вершина лоба, перелёт сетки):
       * если точка уже приколочена — держим её, иначе цели нет */
      if (this._cueP && this._cueBall === this.ballNo)
        return { kind: 'contact', p: this._cueP, t: cp ? cp.t : .2, level: this.frozen ? 'freeze' : guide, frozen: this.frozen,
          nudge: this.nudge, aim: S.coach === 'aim' ? this.aimSide : 0 };
      this._cueP = null;
      return S.coach === 'aim' ? { kind: 'aim', side: this.aimSide } : null;
    }
    /* приколачиваем кольцо к точке в момент первого появления на ЭТОТ мяч —
     * дальше оно не пересчитывается и не ездит за прогнозом */
    if (!this._cueP || this._cueBall !== this.ballNo) {
      this._cueP = { x: cp.p.x, y: cp.p.y, z: cp.p.z };
      this._cueBall = this.ballNo;
    }
    return { kind: 'contact', p: this._cueP, t: cp.t, level: this.frozen ? 'freeze' : guide, frozen: this.frozen,
      nudge: this.nudge, aim: S.coach === 'aim' ? this.aimSide : 0 };
  }

  get S() { return TRAIN_STEPS[this.step]; }

  /* ---------------- serve targets: center → left → right -------------- */
  /** Текущая цель подачи: 'center' | 'left' | 'right' — по счётчику успехов. */
  serveTarget() { return ['center', 'left', 'right'][Math.min(this.done, 2)]; }
  serveAimSide() { const t = this.serveTarget(); return t === 'left' ? -1 : t === 'right' ? 1 : 0; }

  /* --------------------------- lifecycle -------------------------- */
  begin() {
    const g = this.g;
    /* в уроке захват шире: учим жест, а не ловим миллиметры */
    if (typeof setCaptureForgiveness === 'function') setCaptureForgiveness(1.55);
    /* чистый стол: никакого шлейфа от прошлого матча/демо-удара, ракетка
     * в центре, тренер у своей точки. Раньше первая секунда обучения
     * показывала артефакты предыдущей игры */
    if (g.ball.hist) g.ball.hist.length = 0;
    g.ball.trailGrade = null; g.ball.golden = null;
    if (typeof g.resetPaddle === 'function') g.resetPaddle();
    if (g.ai && g.ai.pos) V3.set(g.ai.pos, 0, PH.TABLE_Y + 0.25, -1.45);
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
    this.done = 0; this.attempts = 0; this.ballNo = 0; this.fails = 0;
    this.frozen = false; this.heldOnce = false; this.nudge = 0;
    this._cueP = null; this._cueBall = -1;
    this.phase = 'intro'; this.t = 0;
    this.msg = ''; this.lastShot = null;
    this.g.ball.live = false;
    this.g.isServeBall = false;
    this.g.state = GS.RALLY; this.g.stateT = 0;
    if (this.g.cancelInput) this.g.cancelInput();
    this.sync();
  }

  nextStep() {
    if (this.step + 1 >= TRAIN_STEPS.length) { this.complete(); return; }
    this.goStep(this.step + 1);
  }

  complete() {
    this.finished = true;
    this.phase = 'done';
    if (typeof setCaptureForgiveness === 'function') setCaptureForgiveness(1);
    this.g.ball.live = false;
    this.g.ui && this.g.ui.trainDone(this);
  }

  quit() {
    const g = this.g;
    if (typeof setCaptureForgiveness === 'function') setCaptureForgiveness(1);
    this.frozen = false;
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
    this.lastShot = null;
    this.ballNo++; this.heldOnce = false; this.frozen = false; this.nudge = 0;
    this._cueP = null;
    this.aimSide = this.ballNo % 2 ? 1 : -1;
    if (g.marks) g.marks.length = 0;
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
    /* The ball gets harder ONLY as the crutches come off, one notch at a
     * time: freeze = dead straight, approach = a whisper of drift, ring = a
     * little more, none = the full practice corridor. Before this the second
     * ball already jumped to the full ±0.3 lane with a new arc, and the
     * "now without the hint" ball felt like a different serve entirely. */
    const jit = { freeze: 0, approach: 0.10, ring: 0.20, none: 0.30 }[this.guide];
    const lane = jit ? rndSym(jit) : 0;
    const from = V3.new(lane, F.y0 !== undefined ? F.y0 : PH.TABLE_Y + 0.30, -1.22);
    const spin = V3.new(F.spin * TAU / 60 * 2.2, 0, 0);
    V3.copy(b.p, from);
    if (F.v) {
      // a hand-shaped lob: solvers always flatten these into a drive
      V3.set(b.v, -lane * 0.55 + rndSym(0.12), F.v[1], F.v[2]);
    } else {
      const target = { x: jit ? rndSym(jit * 1.1) : 0, z: 0.62 };   // same depth every ball: height & timing don't change
      const mix = F.kind === 'mix';
      if (mix) V3.set(spin, (Math.random() < 0.3 ? 32 : -42 - Math.random() * 33) * TAU / 60 * 2.2, 0, 0);
      const sol = solveLaunch(from, target, spin, {
        speed: mix ? F.speed + rndSym(0.8) : F.speed, netClear: F.kind === 'fast' ? 0.07 : 0.16, speedForgive: 0.3,
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
    /* тренер стоит ровно там, откуда вылетает мяч, и ВИДИМО по нему бьёт —
     * до этого мяч появлялся из пустоты в одном месте, а ракетка стояла
     * в другом */
    if (g.ai) {
      V3.set(g.ai.pos, from.x, PH.TABLE_Y + 0.25, from.z + 0.14);
      if (g.ai.anim) { g.ai.anim.swing = 1; g.ai.anim.windup = 0; }
    }
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
      // to know the serve crossed after touching the server's half.
      // Game.onBounce calls us BEFORE it bumps serveBounces, so the
      // crossing bounce is still counted as #1 here.
      // PLUS: the serve must land in the lit zone (center → left → right).
      if (lastHitBy === 1 && side === -1 && this.g.serveBounces >= 1 && !this.g.netTouched) {
        const x = this.g.ball.p.x, t = this.serveTarget();
        const ok = t === 'center' ? Math.abs(x) <= 0.28 : t === 'left' ? x < -0.20 : x > 0.20;
        if (ok) this.pass();
        else this.fail('Не в ту зону — цель подсвечена.');
      }
      return;
    }
    if (lastHitBy !== 1 || side !== -1) return;
    const s = this.lastShot;
    if (!s) return;
    if (!S.check || S.check(this.g, s, this)) this.pass();
    else this.fail(S.failHint ? ET(S.failHint) : ET('train.repeat'));
  }

  /** called instead of awardPoint while training */
  onFault(who, reason) {
    if (this.phase !== 'live') return;
    if (who > 0) return;                       // the feeder "lost" the point: ignore
    const S = this.S;
    let r = reason;
    if (reason === 'АУТ') r = ET('train.out');
    else if (reason === 'В СЕТКУ') r = ET('train.net');
    /* «Нет контакта» ни о чём не говорит ученику. Подсказка-ДЕЙСТВИЕ: */
    else if (reason === 'ВЫ НЕ ДОСТАЛИ МЯЧ' || reason === 'ОЧКО СОПЕРНИКУ')
      r = S.id === 'SERVE' ? ET('train.throughServe') : ET('train.through');
    else if (reason.indexOf('ПОДАЧ') >= 0) r = ET('train.serveFault');
    this.fail(r);
  }

  pass() {
    this.done++; this.fails = 0; this.frozen = false;
    this.phase = 'ok'; this.t = 0;
    if (this.S.id === 'SERVE') {
      /* диалог тренера: «Отлично! Теперь попробуй — в левую зону» */
      const next = this.serveTarget();
      const names = { center: ET('target.center'), left: ET('target.left'), right: ET('target.right') };
      this.msg = this.done >= this.S.need ? ET('train.serveDone') : ET('train.serveNext', { name: names[next] });
    } else {
      this.msg = this.done >= this.S.need ? ET('train.done') : ET('train.counted');
    }
    this.msgCol = '#4ee39a';
    this.g.audio.ui('good');
    this.sync();
  }

  fail(why) {
    this.phase = 'fail'; this.t = 0; this.frozen = false;
    this.fails++;
    if (this.S.id === 'RALLY') this.done = 0;   // three in a row means in a row
    this.msg = why;
    this.msgCol = '#ffb066';
    this.g.audio.ui('bad');
    this.sync();
  }

  skip() { if (this.phase !== 'done') this.nextStep(); }

  /* ------------------------------ tick ---------------------------- */
  update(dt) {
    const g = this.g;
    if (this.nudge > 0) this.nudge = Math.max(0, this.nudge - dt);
    if (this.frozen) return;            // the clock of the drill stops with the ball
    this.t += dt;
    // hold the ball for the pupil: once per guided ball, just before contact
    if (this.phase === 'live' && !this.heldOnce && this.guide === 'freeze') {
      if (this.S.id === 'SERVE') {
        if (g.state === GS.SERVE_TOSS && g.ball.lastHitBy === 0 && g.ball.v.y < 0 &&
            g.ball.p.y <= (g.tossApex || 0) - 0.05 && !this._frozenDrills.has(this.S.id)) {
          this._frozenDrills.add(this.S.id);
          this.frozen = true; this.heldOnce = true; this.sync(); return;
        }
      } else {
        const cp = g.contactPrediction && g.contactPrediction();
        if (cp && g.rallyBounces.some((x) => x > 0) && cp.t <= COACH_FREEZE_T &&
            !this._frozenDrills.has(this.S.id)) {
          this._frozenDrills.add(this.S.id);
          this.frozen = true; this.heldOnce = true; this.sync(); return;
        }
      }
    }
    switch (this.phase) {
      case 'intro':
        // ждёт касания (onPress): большое объявление урока не прячется
        // по таймеру — ученик читает сколько нужно
        break;
      case 'wait': {
        /* тренер ВИДИМО выходит в точку, откуда полетит мяч: мяч не
         * материализуется из пустоты — он вылетает из ракетки, которая к
         * этому моменту уже там */
        const ap = g.ai && g.ai.pos;
        if (ap) {
          const k = 1 - Math.exp(-8 * dt);
          ap.x += (0 - ap.x) * k;
          ap.z += (-1.08 - ap.z) * k;
          ap.y = PH.TABLE_Y + 0.25;
        }
        if (this.t > 0.9) this.feed();
        break;
      }
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
        /* ошибка читается спокойно (3.2 с), но НЕ блокирует поток:
         * касание — сразу дальше, без касания — сама подаёт следующий мяч */
        if (this.t > 3.2) { g.ball.live = false; this.phase = 'wait'; this.t = 0; }
        break;
    }
  }
}
