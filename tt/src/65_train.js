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
function trainingTip(step, mode, safe) {
  if (mode === 'touch') return (safe && step.safeTip) ? step.safeTip : step.tip;
  return (safe && (step.safeMouseTip || step.safeTip)) ? (step.safeMouseTip || step.safeTip) : step.mouseTip;
}

const TRAIN_STEPS = [
  {
    id: 'SERVE', goal: 'Подайте на стол', title: 'ПОДАЧА', need: 2, guide: 'up',
    tip: 'Проведите пальцем вверх.', mouseTip: 'Зажмите ЛКМ, ведите вверх.',
    feed: null,
  },
  {
    id: 'TOPSPIN', goal: 'Верхнее вращение на стол', title: 'ТОПСПИН', need: 3, guide: 'up',
    tip: 'Свайп вверх по мячу.', mouseTip: 'ЛКМ + вверх по мячу.',
    feed: { kind: 'normal', spin: -95, speed: 6.0 },
    check: (g, s) => s.topspin > 45,
    failHint: 'Длиннее вверх.',
  },
  {
    id: 'PUSH', goal: 'Нижнее вращение на стол', title: 'ПОДРЕЗКА', need: 2, guide: 'down',
    tip: 'Мягкий свайп вниз.', mouseTip: 'ЛКМ + мягкое движение вниз.',
    safeTip: 'Зажмите палец и мягко ведите вверх.',
    safeMouseTip: 'Зажмите ЛКМ и мягко ведите вверх.',
    /* Backspin feed aimed at 0.62 m past the net died there: after the bounce
     * it reached only z ~ 1.7 m, already below table level, so the drill could
     * not be returned. 1.0 m carries it through the bat's plane at ~0.35 m. */
    feed: { kind: 'normal', spin: 40, speed: 5.2, targetZ: 1.0 },
    check: (g, s) => s.topspin < -30,
    failHint: 'Ведите вниз.',
  },
  {
    id: 'SIDE', goal: 'Боковое вращение на стол', title: 'БОКОВОЕ', need: 2, guide: 'arc',
    tip: 'Нарисуйте пальцем дугу вбок.', mouseTip: 'ЛКМ + дуга вбок.',
    /* Same lesson as the push: a backspin feed dropped at 0.62 m died behind
     * the end line, so the bat met it at 0.75 m — below the net — and the
     * side-spin stroke had nothing to lift. 1.0 m arrives at bat height. */
    feed: { kind: 'normal', spin: -40, speed: 5.6, targetZ: 1.0, lane: -0.40, x: -0.38 },
    check: (g, s) => Math.abs(s.sidespin) > 32,
    failHint: 'Дугой, не по прямой.',
  },
  {
    id: 'TIMING', goal: 'Верните быстрый мяч', title: 'ТАЙМИНГ', need: 2, guide: 'up',
    tip: 'Свайп вверх после отскока.', mouseTip: 'После отскока — ЛКМ + вверх.',
    feed: { kind: 'fast', spin: -110, speed: 10.2 },
    check: () => true,
    failHint: 'Нет возврата на стол.',
  },
  {
    id: 'SMASH', goal: 'Удар на стол быстрее 55 км/ч', title: 'СМЕШ', need: 2, guide: 'side',
    tip: 'Резкий короткий свайп вбок.', mouseTip: 'ЛКМ + резкое движение вбок.',
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
    /* The preview is on demand (see TrainerDemo and Trainer.playDemo): the
     * pupil serves and plays from the first ball, and the bot only steps in
     * when the “show me” button is pressed. It used to start by itself at the
     * top of every step — so passing the serve drill threw the bot onto the
     * racket the pupil was still holding from their own serve. */
    this.demo = null;
    this.demoGuardUntil = -Infinity;
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
    this.stopDemo();
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
    this.stopDemo();
    this.g.ball.live = false;
    this.g.ui && this.g.ui.trainDone(this);
  }

  quit() {
    const g = this.g;
    this.stopDemo();
    g.training = null;
    g.ball.live = false;
    g.state = GS.MENU;
    g.ui && g.ui.trainHide();
  }

  /* --------------------------- the preview ------------------------ */
  /** The bot can demonstrate here: it needs a canvas to project into and the
   *  synthetic press hook. A test stub has neither, so drills stay inert. */
  canDemo() {
    const g = this.g;
    return !!this.S && !!g.canvas &&
      typeof g.demoPress === 'function' && typeof g.project === 'function';
  }

  isDemo() { return this.phase === 'demo'; }

  /** “Show me how it is done.” The preview is a BUTTON, never an automatic
   *  takeover: it used to open by itself at the top of every step, so passing
   *  the serve drill dropped the bot onto the racket the pupil was already
   *  swinging, and their next click closed the preview before they saw it.
   *  A ball in flight is dropped first: the bot must not demonstrate into the
   *  middle of the pupil's own rally. */
  playDemo() {
    const g = this.g;
    if (this.finished || !this.canDemo()) return false;
    /* Only between balls or mid-drill. During the one-second “зачтено” beat
     * the step is already changing, and a preview of the OLD lesson would
     * teach the wrong gesture. */
    if (this.phase !== 'wait' && this.phase !== 'live' && this.phase !== 'intro') return false;
    if (g.cancelInput) g.cancelInput();
    this.stopDemo();
    g.ball.live = false;
    g.isServeBall = false;
    this.lastShot = null;
    this.msg = '';
    this.startDemo();
    return true;
  }

  startDemo() {
    this.phase = 'demo'; this.t = 0;
    /* A canvas press in the first moments is the tail of the button press
     * leaking through on some browsers — never a pupil taking over. */
    this.demoGuardUntil = (this.g.time || 0) + 0.25;
    this.demo = new TrainerDemo(this);
    this.demo.begin();
    this.sync();
  }

  stopDemo() {
    if (this.demo) { this.demo.stop(); this.demo = null; }
  }

  /** The pupil took over: drop the preview and serve the ball immediately, so
   *  the click that ends the demo opens the drill instead of costing a turn. */
  exitDemo() {
    if (this.phase !== 'demo') return;
    this.stopDemo();
    this.phase = 'wait'; this.t = 0;
    this.feed();
    this.sync();
  }

  sync() { this.g.ui && this.g.ui.trainSync(this); }

  /* ----------------------------- feeder --------------------------- */
  /** Serve one practice ball from the far side, shaped for the drill.
   *  `isDemo` keeps the drill in the preview phase: the ball is real and the
   *  physics resolve it, but neither a bounce nor a fault may score it. */
  feed(isDemo) {
    const g = this.g, b = this.g.ball, S = this.S;
    const next = isDemo ? 'demo' : 'live';
    this.lastShot = null;
    g.marks.length = 0;
    g.rallyBounces.length = 0;
    g.serveBounces = 0;
    g.netTouched = false;
    if (!S.feed) {                       // the serve drill: you start the ball
      g.server = 1;
      g.prepServe();
      this.phase = next; this.t = 0;
      return;
    }
    const F = S.feed;
    const lane = F.lane !== undefined ? F.lane : rndSym(0.30);
    const from = V3.new(lane, F.y0 !== undefined ? F.y0 : PH.TABLE_Y + 0.30, -1.22);
    const spin = V3.new(F.spin * TAU / 60 * 2.2, 0, 0);
    V3.copy(b.p, from);
    if (F.v) {
      // a hand-shaped lob: solvers always flatten these into a drive
      V3.set(b.v, -lane * 0.55 + rndSym(0.12), F.v[1], F.v[2]);
    } else {
      /* Backspin dies at the first bounce: a feed aimed as short as a topspin
       * one lands near the net and then dives off the end of the table at
       * z ~ 1.6 m, below the bat, so the drill cannot be played. Each step can
       * ask for its own landing depth. `x` pins the lane: the hook yaws the
       * racket ~1.1 rad sideways, so a ball fed on the centre line is struck
       * back out over the right-hand sideline — feeding it left leaves the
       * demonstration's own shot room to bend back onto the table. */
      const target = { x: F.x !== undefined ? F.x : rndSym(0.34), z: F.targetZ !== undefined ? F.targetZ : 0.62 };
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
    this.phase = next; this.t = 0;
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
      if (lastHitBy === 1 && side === -1 && this.g.serveBounces >= 1 && !this.g.netTouched) this.pass();
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
    if (reason === 'АУТ') r = 'Аут.';
    else if (reason === 'В СЕТКУ') r = 'Сетка.';
    else if (reason === 'ВЫ НЕ ДОСТАЛИ МЯЧ' || reason === 'ОЧКО СОПЕРНИКУ') r = 'Нет контакта.';
    else if (reason.indexOf('ПОДАЧ') >= 0) r = 'Ошибка подачи.';
    this.fail(r);
  }

  pass() {
    this.done++;
    this.phase = 'ok'; this.t = 0;
    this.msg = this.done >= this.S.need ? 'Готово' : 'Зачтено';
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
        // A short settling interval, independent of pointer clicks.
        if (this.t > 1.0) { this.phase = 'wait'; this.t = 0; }
        break;
      case 'wait':
        /* Straight to the drill: the previous step never choreographs the
         * next ball. The pupil asks for the preview with the button. */
        if (this.t > 0.45) this.feed();
        break;
      case 'demo':
        if (!this.demo) { this.feed(); break; }
        this.demo.tick(dt);
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

/* =====================================================================
 *  TRAINER DEMO — the bot plays the drill, then loops it.
 *
 *  The pupil's complaint was concrete: the old one-shot glyph said WHAT to
 *  do but never WHERE to put the cursor. So this is not a cartoon. The bot
 *  drives the SAME input path a hand does: a synthetic pointer travels to
 *  the predicted meeting point, presses there (the real press oval is
 *  stamped and can reject it), feeds swipe samples along the drill's guide
 *  direction and releases. The bat on screen, the contact and the return
 *  are therefore the real ones — whatever the pupil is told to repeat is
 *  exactly what produced this ball.
 *
 *  The loop is the teacher: it repeats until the pupil presses, and that
 *  press just ends the preview (see Game.bindInput) so it can never be
 *  eaten as a failed attempt.
 * ===================================================================== */
class TrainerDemo {
  constructor(trainer) {
    this.tr = trainer;
    this.g = trainer.g;
    this.stopped = false;
    this.state = 'seek';          // seek -> press -> swing -> follow
    this.t = 0;
    this.st = 0;                  // time in the current state
    this.pos = { x: 0.5, y: 0.55 };   // the bot's cursor, normalised screen
    this.tgt = { x: 0.5, y: 0.55 };   // where the cursor has to go
    this.dir = { x: 0, y: -1 };   // the swipe, in screen direction
    this.near = 0;                // 0 far, 1 the ball is at the cursor
    this.loops = 0;
    this.baseAng = 0;             // heading of the strike, radians (y down)
    this.turn = 0;                // total turn of the arc, radians
  }

  begin() {
    this.stopped = false;
    this.loops = 0;
    this.state = 'seek'; this.t = 0; this.st = 0;
    this.near = 0;
    this.dir = this.guideDir();
    const p = this.paddlePoint();
    this.pos = p ? { x: p.x, y: p.y } : { x: 0.5, y: 0.55 };
    this.tgt = { x: this.pos.x, y: this.pos.y };
    /* The bat follows the ghost from the first frame, starting from where the
     * bat already is, so nothing teleports when the preview begins. */
    this.g.demoPointer = { x: this.pos.x, y: this.pos.y };
    this.tr.feed(true);
  }

  stop() {
    this.stopped = true;
    if (this.g.demoStop) this.g.demoStop();
  }

  /* ------------------------------ maths --------------------------- */
  guideShape() {
    let s = this.tr.S && this.tr.S.guide ? this.tr.S.guide : 'up';
    if (s === 'down' && this.g.settings && this.g.settings.gestureProfile === 'safe') s = 'up';
    return s;
  }

  /** Screen direction of the drill's gesture (y points down). */
  guideDir() {
    switch (this.guideShape()) {
      case 'down': return { x: 0, y: 1 };
      case 'side': return { x: 1, y: 0 };
      /* Leaves the ball up-and-right at ~62 deg and sweeps down to just above
       * horizontal. Two measured facts shaped this:
       *   · the swipe metrics live in aspect-NORMALISED space (x/W, y/H), so a
       *     turn in screen degrees is counted at roughly half its size;
       *   · the smash rule needs `up` between -.28 and .52 AND effort > .52,
       *     and a turn always drags `up` down — so a hook played hard is
       *     re-named a smash whenever the ball is high.
       * The arc is therefore played at ~1.9 screen widths per second (effort
       * .35, well under the smash gate). By the time the bat meets the ball
       * the sweep is nearly flat (measured up -.09..+.21, right .98) and the
       * ball bends right off the table edge — the shot the drill asks for. */
      case 'arc': return { x: 0.469, y: -0.883 };
      default: return { x: 0, y: -1 };
    }
  }

  point(world) {
    const g = this.g;
    if (!world || typeof g.project !== 'function') return null;
    const p = g.project(world, {});
    return p && p.ok && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null;
  }

  paddlePoint() { return this.g.player ? this.point(this.g.player.pos) : null; }

  ballPoint() { return this.g.ball ? this.point(this.g.ball.p) : null; }

  /** Where the cursor belongs: the predicted crossing of the bat's plane, so
   *  the pupil sees the hand ARRIVE and wait — the whole point of the demo. */
  aimPoint() {
    const g = this.g, S = this.tr.S;
    const serve = S && S.id === 'SERVE' &&
      (g.state === GS.SERVE_READY || g.state === GS.SERVE_TOSS);
    if (!serve) {
      const o = g._paddlePred;
      const p = o && o.reach ? this.point(o.reach) : null;
      if (p) return p;
    }
    return this.ballPoint();
  }

  /** 0..1: how close the ball is to the cursor on screen. */
  approach() {
    const bp = this.ballPoint();
    if (!bp) return 0;
    const W = Math.max(1, this.g.vw || 1280), H = Math.max(1, this.g.vh || 800);
    const d = Math.hypot((bp.x - this.pos.x) * W, (bp.y - this.pos.y) * H);
    return clamp(1 - d / 300, 0, 1);
  }

  /** ITTF-legal toss: the ball must be falling from a legal rise before the
   *  demonstration may swing, exactly as the drill's own strike test demands. */
  legalToss() {
    const g = this.g, b = g.ball;
    if (g.state !== GS.SERVE_TOSS || !b.live || !(b.v.y < 0)) return false;
    const rise = typeof g.tossRiseNow === 'function' ? g.tossRiseNow() : NaN;
    const min = typeof MATCH_RULES !== 'undefined' && MATCH_RULES.serveTossMinRise
      ? MATCH_RULES.serveTossMinRise : 0.16;
    return !Number.isFinite(rise) || rise > min;
  }

  /* ------------------------------ states -------------------------- */
  tick(dt) {
    if (this.stopped) return;
    const g = this.g;
    if (!g || !g.ball || !g.player) return;
    this.t += dt; this.st += dt;
    switch (this.state) {
      case 'seek': this.seek(dt); break;
      case 'press': this.hold(dt); break;
      case 'swing': this.swing(dt); break;
      case 'follow': this.follow(dt); break;
      default: break;
    }
  }

  seek(dt) {
    const g = this.g, S = this.tr.S;
    const aim = this.aimPoint();
    if (aim) this.tgt = aim;
    const k = 1 - Math.exp(-11 * dt);
    this.pos.x += (this.tgt.x - this.pos.x) * k;
    this.pos.y += (this.tgt.y - this.pos.y) * k;
    g.demoPointer = { x: this.pos.x, y: this.pos.y };
    /* A mouse hover re-anchors the stance depth every frame; the ghost does
     * the same, so the bat stands where this cursor would put it. */
    g.stanceY = this.pos.y;
    this.near = this.approach();

    if (S && S.id === 'SERVE') {
      if (g.state === GS.SERVE_READY && this.near > 0.86 && this.st > 0.5) this.press();
      else if (this.st > 4.5) this.restart();
      return;
    }
    if (!g.ball.live) { if (this.st > 2.5) this.restart(); return; }
    /* Press a step BEFORE the ball arrives: the gesture needs ~0.1 s to count
     * as a real stroke, and the contact window is 0.62 m deep. (The arc used
     * to press at 0.78 m for runway: its curl is now written sub-frame, so
     * every drill presses at the same depth again.) */
    const own = !!(g.rallyBounces && g.rallyBounces.some((s) => s > 0));
    const closing = g.ball.v.z > 0;
    const d = V3.dist(g.ball.p, g.player.pos);
    const pressAt = 0.60;
    if (own && closing && d < pressAt && this.st > 0.3) this.press();
    else if (this.st > 5.0) this.restart();       // the feed died: show it again
  }

  /** Only the serve separates the press (which tosses) from the strike. */
  needsToss() { const S = this.tr.S; return !!S && S.id === 'SERVE'; }

  press() {
    const g = this.g;
    const bp = this.ballPoint();
    /* Land the cursor exactly ON the ball. That is the lesson, and it also
     * means the admission oval sees distance 0 — the same trivial pass a
     * pupil gets when they put the hand on the ball. */
    if (bp) this.pos = { x: bp.x, y: bp.y };
    if (!g.demoPress) { this.stopped = true; return; }
    g.demoPress(this.pos.x, this.pos.y);
    this.baseAng = this.strikeAngle();
    this.turn = this.arcTurn();
    /* Every drill but the serve strikes straight out of the press: the swing
     * is measured the frame it becomes a legal gesture, so any waiting time
     * between press and motion is read as a slow hand. */
    this.state = this.needsToss() ? 'press' : 'swing';
    this.st = 0;
  }

  hold() {
    const g = this.g;
    g.demoPointer = { x: this.pos.x, y: this.pos.y };
    if (!this.needsToss()) { this.startSwing(); return; }
    if (!this.legalToss()) { if (this.st > 3.2) this.restart(); return; }  // toss never fell
    /* The toss and the strike are two gestures. Measured against a press that
     * is already half a second old, the flick reads as a dead-slow hand and
     * the demo served 4 km/h balls into the net. So the toss press is let go
     * and a fresh press lands on the falling ball — exactly what a server's
     * hand does, and the gesture is then timed honestly. */
    const bp = this.ballPoint();
    if (bp) this.pos = { x: bp.x, y: bp.y };
    if (g.demoRelease) g.demoRelease();
    if (g.demoPress) g.demoPress(this.pos.x, this.pos.y);
    this.startSwing();
  }

  /** px/s of the strike. The classifier reads speed AND length at the contact
   *  frame, so the speed is chosen per drill instead of globally:
   *   · down  — a fast, long downward swing is a CHOP, not the soft PUSH the
   *     drill's own tip asks for, so the push really is played softly;
   *   · side  — x is normalised by the screen WIDTH and y by the HEIGHT, so a
   *     sideways swipe reads ~1.6x slower than an upward one at the same
   *     speed. 2900 px/s gave 44-48 km/h and a DRIVE; the smash needs > 55
   *     even on the loops where the blade meets the ball off-centre;
   *   · arc   — deliberately under the .52 effort gate so a high ball cannot
   *     be read as a smash before the hook rule sees the curve. That gate is
   *     measured in NORMALISED units (x/W, y/H): the same 2400 px/s is effort
   *     .45 on a 1280 px screen but 1.45 on a 390 px phone, where the hook
   *     came out a 74 km/h smash. The speed therefore tracks the width, so the
   *     gesture is the same fraction of a screen per second everywhere. */
  strikeSpeed() {
    const guide = this.tr.S && this.tr.S.guide;
    if (guide === 'down') return 1600;
    if (guide === 'side') return 4300;
    if (guide === 'arc') return clamp(1.875 * (this.g.vw || 1280), 700, 3600);
    return 2900;
  }

  /** Heading of the strike, radians (screen y points down). For the arc this
   *  is only the START: the heading turns while the hand travels (see swing),
   *  because the classifier names a hook only when the hand is still moving
   *  mostly sideways (|right| > .58) AND the path really curves (|curl| > .38).
   *  A shallow bow along a straight chord is neither one. */
  strikeAngle() { return Math.atan2(this.dir.y, this.dir.x); }

  /** Screen turn of the arc, solved in the classifier's own frame.
   *  The swipe metrics live in aspect-NORMALISED space (x/W, y/H), where a
   *  screen heading `a` reads as `phi = atan2(-k·sin a, cos a)` with k=W/H.
   *  Two gates have to be met at the same time:
   *    · |curl| > .38 — the arc really turns;
   *    · u > -.28     — otherwise the CHOP/PUSH rule claims the stroke before
   *                     the hook rule ever sees it.
   *  A fixed measured turn cannot do both: 50° of curl is a 44° screen turn on
   *  a 16:10 desktop but 90° in portrait, which ends BELOW the push gate and
   *  the hook became a chop on a phone. So the END is pinned in measured space
   *  (phi = -.05, u = -.05, still above the gate) and the screen turn is solved
   *  from it — 64° landscape, 68° portrait. Measured after the change: the
   *  hook stays a hook on both, right .98-.99, curl .52-1.16. */
  arcTurn() {
    if (this.guideShape() !== 'arc') return 0;
    const W = Math.max(1, this.g.vw || 1280), H = Math.max(1, this.g.vh || 800);
    const a1 = Math.atan(0.050 * H / W);      // tan(.05) = .050
    return clamp(a1 - this.baseAng, 0.50, 1.90);
  }

  startSwing() {
    this.dir = this.guideDir();
    this.baseAng = this.strikeAngle();
    this.turn = this.arcTurn();
    this.state = 'swing'; this.st = 0;
  }

  swing(dt) {
    const g = this.g;
    /* A stroke is a SNAP: the hand leaves the press already fast and HOLDS
     * that speed through the ball, then relaxes. Two reasons it is not an
     * ease-out any more:
     *   · the classifier measures the gesture at the CONTACT frame, so a
     *     decelerating hand makes the verdict a lottery — the same drill
     *     returned 9 km/h on one loop and 48 km/h on the next;
     *   · a slow start was read as BLOCK, so the “topspin” lesson showed a
     *     dead ball that never crossed the net. */
    const VS = this.strikeSpeed(), T_END = 0.34;
    const W = Math.max(1, g.vw || 1280), H = Math.max(1, g.vh || 800);
    const guide = this.tr.S && this.tr.S.guide;
    const step = VS * dt;
    /* The gesture is sampled FINER than the frame rate — roughly every 12 ms.
     * A swipe's curl is the turning between CONSECUTIVE samples, so one sample
     * per frame turns a curved stroke into a polyline of straight chords and
     * the hook is read as a drive. The substep count follows the frame, so a
     * slow device still produces the same curve. */
    const SUB = clamp(Math.round(dt / 0.012), 1, 6);
    /* Timestamps are spread over the frame that just elapsed and end exactly
     * on the game clock. Starting from `g.time - dt` — never from `g.time`
     * plus a fraction — keeps the series monotonic from frame to frame. */
    const tStart = g.time - dt, st0 = this.st - dt;
    let moved = 0;
    for (let k = 1; k <= SUB; k++) {
      const stk = st0 + dt * (k / SUB);
      /* The turn has to be FINISHED before the bat meets the ball, or the same
       * gesture produces a different shot on every frame: contact happens
       * 0.06-0.16 s after the press, so a 0.2 s turn meant the heading at
       * contact ranged from 45° up to flat and the ball went from just over
       * the net to two metres long. 35 ms is done by ~90 % at the earliest
       * contact and keeps the whole curve inside the sample history. */
      const ang = guide === 'arc' ? this.baseAng + this.turn * (1 - Math.exp(-Math.max(0, stk) / 0.035)) : this.baseAng;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      /* Never let the pointer pin against a screen edge: a clamped sample
       * reads as a hand that stopped, which would turn a strike into a block.
       * When the room runs out the gesture simply ends — the release still
       * counts as a stroke for 0.25 s, so the ball is met either way. */
      const roomX = cs > 0 ? (1 - this.pos.x) * W : this.pos.x * W;
      const roomY = sn > 0 ? (1 - this.pos.y) * H : this.pos.y * H;
      const room = Math.min(cs !== 0 ? roomX / Math.abs(cs) : Infinity,
        sn !== 0 ? roomY / Math.abs(sn) : Infinity) - 10;
      const mv = Math.min(step / SUB, Math.max(0, room));
      this.pos = {
        x: clamp(this.pos.x + cs * mv / W, 0, 1),
        y: clamp(this.pos.y + sn * mv / H, 0, 1),
      };
      moved += mv;
      if (g.demoMove) g.demoMove(this.pos.x, this.pos.y, tStart + dt * (k / SUB));
      if (mv < step / SUB) break;
    }
    if (this.st >= T_END || moved < step) {
      if (g.demoRelease) g.demoRelease();
      this.state = 'follow'; this.st = 0;
    }
  }

  follow(dt) {
    const g = this.g;
    const k = 1 - Math.exp(-4.5 * dt);
    this.pos.x += (0.52 - this.pos.x) * k;
    this.pos.y += (0.62 - this.pos.y) * k;
    g.demoPointer = { x: this.pos.x, y: this.pos.y };
    /* A ball that comes to rest on the sideline keeps re-triggering the
     * bounce (sound, particles, mark) every frame. The demonstration shot is
     * over by then, so let it die instead of buzzing. */
    if (g.ball.live && this.st > 0.4 && V3.len(g.ball.v) < 0.5) g.ball.live = false;
    const wait = this.tr.S && this.tr.S.id === 'SERVE' ? 1.55 : 1.3;
    if (this.st > wait) this.restart();
  }

  restart() {
    if (this.stopped) return;
    this.loops++;
    if (this.g.ball) this.g.ball.live = false;
    this.state = 'seek'; this.st = 0;
    this.near = 0;
    this.dir = this.guideDir();
    this.tr.feed(true);
  }
}

