/* Voluntary academy: explanation -> guided practice -> decision -> normal-
 * speed check. Stroke/accuracy practice is endless and never grants mastery. */
function detectInputMode(win = window, nav = navigator) {
  const matches = query => !!(win.matchMedia && win.matchMedia(query).matches);
  return matches('(pointer: coarse)') || ((nav.maxTouchPoints || 0) > 0 && !matches('(pointer: fine)')) ? 'touch' : 'mouse';
}
function trainingTip(step, mode) { return ET(mode === 'touch' ? step.tip : step.mouseTip); }
const COACH_FREEZE_T = .22;
let trainingSessionSequence = 0;

function trainingFeedBall(spec, n = 0, varied = false, displaced = false, backhandSide = 0) {
  const side = n % 2 ? -1 : 1;
  const lane = backhandSide ? Math.sign(backhandSide) * .35 : displaced ? -side * .42 : varied ? side * .16 : 0;
  const p = V3.new(lane, spec.y0 || PH.TABLE_Y + .32, -1.20);
  const w = V3.new(spec.top || 0, (spec.side || 0) * side, (spec.cork || 0) * side);
  const target = { x: backhandSide ? lane : varied ? -lane * .5 : 0, z: spec.depth || .62 };
  for (const speed of [spec.speed, spec.speed * 1.15, spec.speed * 1.30]) {
    let sol = solveLaunch(p, target, w, { speed, netClear: spec.clear, speedForgive: .45 });
    if (!sol && spec.y0) sol = solveLaunch(p, target, w, { speed, netClear: .16, speedForgive: .65 });
    if (!sol) continue;
    const v = V3.new(sol.vx, sol.vy, sol.vz);
    const test = predict(p, v, w, { dt: PH.SIM_DT, maxT: 3, stopOnFirstBounce: true });
    if (!test.hitNet && !test.diverged && test.landed && test.landed.z > .03) return { p, v, w };
  }
  return null;
}

function trainingPath(p, v, w, bounces = 2) {
  const flat = [];
  const result = predict(V3.clone(p), V3.clone(v), V3.clone(w),
    { dt: PH.SIM_DT, maxT: 3, maxPath: Math.ceil(3 / PH.SIM_DT) * 3, path: flat, stopAfterBounces: bounces });
  const path = [[p.x, p.y, p.z]];
  const stride = Math.max(1, Math.round(1 / 40 / PH.SIM_DT)) * 3;
  for (let i = 0; i < flat.length; i += stride) path.push([flat[i], flat[i + 1], flat[i + 2]]);
  // Downsampling must not omit the actual final contact from the diagram.
  const last = path[path.length - 1], end = result.end;
  if (end && [end.x, end.y, end.z].every(Number.isFinite) &&
      (last[0] !== end.x || last[1] !== end.y || last[2] !== end.z)) path.push([end.x, end.y, end.z]);
  return { path, result };
}

function trainingDiagram(stroke, target, feed, equip, technique = stroke, gesture) {
  if (typeof racketForStroke !== 'function' || typeof resolveRacketLaunch !== 'function') return null;
  const guide = TRAIN_GUIDES[technique];
  if (!guide || guide.stroke !== stroke) return null;
  const serve = stroke.startsWith('SERVE_'), cutBlock = stroke === 'CHOP_BLOCK', banana = stroke === 'BANANA';
  const p = V3.new(banana ? -.35 : 0, stroke === 'SMASH' ? 1.40 : serve ? 1.12 : 1.0, serve ? 1.55 : .92);
  const v = V3.new(0, serve ? -1.7 : -.5, serve ? 0 : cutBlock ? 9 : stroke === 'LOB' ? 3 : 5);
  const w = V3.new(serve ? 0 : cutBlock || stroke === 'COUNTER' ? 285 : 35, 0, 0);
  const zone = target || trainingTarget(stroke === 'DROP' ? 'short' : 'center');
  const aim = { x: (zone.x0 + zone.x1) / 2, z: (zone.z0 + zone.z1) / 2 };
  const model = gesture || guide.gesture;
  let racket = racketForStroke(stroke, { side: 1, ball: p, ballVelocity: v, ballSpin: w, ballSpeed: V3.len(v),
    forehand: !banana, hand: 'right', grip: 'shakehand', equip }, {
    vmag: stroke === 'SMASH' || stroke === 'SERVE_FAST' ? 10 : stroke === 'LOB' ? 3.5 : 6,
    aim, quality: .9, verticalBrush: model.verticalBrush || 0 });
  racket.netClear = stroke === 'LOB' ? .65 : stroke === 'DROP' ? .035 : .12;
  racket.preview = true;
  racket = refineRacket(p, v, w, racket, 1, .9);
  const launch = racket && racket.valid !== false && resolveRacketLaunch({ p, v, w }, racket, {});
  if (!launch || racket.stroke.id !== stroke || !strokeIdentityMatches(racket, launch)) return null;
  const spin = measureShotSpin(launch.w, launch.v), executed = trainingExecutedTechnique(racket.stroke.id, spin);
  if (technique !== stroke && executed !== technique) return null;
  const main = trainingPath(launch.p, launch.v, launch.w);
  const alternative = trainingPath(launch.p, launch.v, V3.new());
  const incoming = feed && trainingFeedBall(feed, 0, false, false, banana ? -1 : 0);
  return { incoming: incoming ? trainingPath(incoming.p, incoming.v, incoming.w).path : [],
    recommended: main.path, alternative: alternative.path, target: zone,
    stroke: racket.stroke.id, technique: executed, launch: { p: launch.p, v: launch.v, w: launch.w },
    spin, caption: ET('academy.model') };
}

function trainingExecutedTechnique(stroke, spin) {
  if (stroke !== 'SERVE_SIDE' || !spin || Math.abs(spin.sideRps) < 3) return stroke;
  return spin.topRps >= 3 ? 'SERVE_SIDE_TOP' : spin.topRps <= -3 ? 'SERVE_SIDE_BACK' : stroke;
}

function trainingContactEligible(incoming, expected) {
  return !!incoming && !(expected.forehand === false && incoming.forehand !== false ||
    expected.overTable && !(Math.abs(incoming.z) < PH.T_HALF_LEN - .02 && Math.abs(incoming.x) < PH.T_HALF_WID) ||
    Number.isFinite(expected.maxHeight) && !(incoming.y - PH.TABLE_Y < expected.maxHeight) ||
    Number.isFinite(expected.incomingTop) && !(incoming.spin && incoming.spin.topRps * TAU > expected.incomingTop) ||
    Number.isFinite(expected.incomingSpeed) && !(incoming.speed >= expected.incomingSpeed));
}

class Trainer {
  constructor(game, options = {}) {
    if (!options.progress && (typeof window === 'undefined' || !window.__TT_EMBED)) {
      try { options = { ...options, progress: JSON.parse(localStorage.getItem('tt-academy-v1') || 'null') }; } catch (e) {}
    }
    this.g = game;
    this.mode = ['course', 'stroke', 'accuracy'].includes(options.mode) ? options.mode : 'course';
    this.sessionId = 'train-' + (++trainingSessionSequence);
    this.profile = { version: TRAINING_VERSION, lessons: {}, lastLesson: null };
    for (const s of TRAIN_STEPS) {
      const old = options.progress && options.progress.lessons && options.progress.lessons[s.id];
      if (old && typeof old === 'object') this.profile.lessons[s.id] = {
        mastered: old.mastered === true, practiced: old.practiced === true,
        attempts: Math.max(0, Math.min(100000, Number(old.attempts) || 0)), correct: Math.max(0, Math.min(100000, Number(old.correct) || 0)) };
    }
    const lastLesson = options.progress && options.progress.lastLesson;
    if (TRAIN_STEPS.some(s => s.id === lastLesson)) this.profile.lastLesson = lastLesson;
    this.options = options;
    this.step = 0; this.done = 0; this.phase = 'intro'; this.stage = 'practice'; this.t = 0; this.simTime = 0;
    this.msg = ''; this.msgKey = null; this.msgCol = ''; this.lastShot = null;
    this.attempts = 0; this.total = 0; this.finished = false;
    this.ballNo = 0; this.fails = 0; this.frozen = false; this.heldOnce = false; this.nudge = 0;
    this._frozenDrills = new Set(); this.aimSide = 0; this.unfrozeAt = -9; this.revision = 0;
    this.stats = { attempts: 0, hits: 0, success: 0, streak: 0, bestStreak: 0 };
    this.lastCapturedShotId = -1;
    this.oldAiLevel = game.ai && game.ai.levelIndex;
  }
  get S() { return this.custom || TRAIN_STEPS[this.step]; }
  get guide() { return this.stage === 'check' || this.S.coach === 'none' ||
    (this.g.settings ? this.g.settings.hint === false : this.options.hint === false) ? 'none' : 'ring'; }
  get inputMode() { return this.g.ui && this.g.ui.inputMode === 'mouse' ? 'mouse' : 'touch'; }
  get feedbackText() { return this.feedback ? this.feedback.title + '. ' + this.feedback.correction : ''; }
  get allowAi() { return this.phase === 'live' && !this.frozen && !!this.S.sparring; }
  get coachText() {
    if (['ok', 'fail', 'review', 'question', 'done'].includes(this.phase)) return this.msg;
    if (this.S.serve && this.S.stroke !== 'SERVE_NO_SPIN' && this.g.state === GS.SERVE_READY)
      return ET(this.inputMode === 'touch' ? 'academy.touchServe' : 'academy.mouseServe');
    if (this.S.check && this.S.check.powerCycle) return ET(this.done % 2 ? 'academy.firm' : 'academy.soft');
    return trainingTip(this.S, this.inputMode);
  }
  begin() {
    const g = this.g;
    if (g.ball.hist) g.ball.hist.length = 0;
    g.ball.trailGrade = null; g.ball.golden = null;
    if (g.resetPaddle) g.resetPaddle(true);
    g.score = [0, 0]; g.rally = 0; g.server = 1; g.state = GS.RALLY; g.ball.live = false; g.isServeBall = false;
    let i = TRAIN_STEPS.findIndex(s => s.id === (this.options.lessonId || this.profile.lastLesson));
    if (this.mode === 'stroke') {
      const technique = TRAIN_GUIDES[this.options.stroke] ? this.options.stroke : 'DRIVE', guide = TRAIN_GUIDES[technique], id = guide.stroke;
      const base = TRAIN_STEPS.find(s => technique !== id ? s.technique === technique
        : !s.technique && s.check && s.check.strokes && s.check.strokes.length === 1 && s.check.strokes[0] === id) || TRAIN_STEPS[1];
      this.custom = { ...base, stroke: id, technique: technique !== id ? technique : undefined,
        check: { ...base.check, strokes: [id] }, rally: null, sparring: false,
        title: guide.title, tip: guide.briefTouch, mouseTip: guide.briefMouse,
        serve: id.startsWith('SERVE_'), feed: id.startsWith('SERVE_') ? null : base.feed, target: base.target || null };
      i = TRAIN_STEPS.indexOf(base);
    } else if (this.mode === 'accuracy') {
      const target = TRAIN_TARGETS.some(t => t.id === this.options.target) ? this.options.target : 'center';
      this.custom = { ...TRAIN_STEPS[3], title: 'academy.accuracy', target, check: {}, rally: null, serve: false };
      i = 3;
    }
    if (i < 0) i = Number.isFinite(this.options.step) ? this.options.step : 0;
    this.goStep(i);
    const resume = this.options.resume;
    if (this.mode === 'course' && resume && resume.stage === 'check' && resume.quizPassed && resume.practicePassed) {
      this.practicePassed = true; this.quizPassed = true; this.stage = 'check'; this.configureHelp(); this.sync();
    }
  }
  configureHelp() {
    // A pending cord bonus belongs to the previous mode, not this stage.
    this.g.clearCordCaptureBoost?.();
    if (typeof setCaptureForgiveness === 'function') setCaptureForgiveness(this.stage === 'practice' ? 1.25 : 1);
    if (this.g.setSlowmoAllowed) this.g.setSlowmoAllowed(this.stage !== 'check');
    if (this.S.sparring && this.g.ai) {
      this.g.ai.setLevel(0); this.g.ai.reset(); this.g.ai.setHandicap(1);
      if (this.g.ai.setTrend) this.g.ai.setTrend(0);
    }
  }
  goStep(i) {
    this.step = clamp(Number.isFinite(i) ? i : 0, 0, TRAIN_STEPS.length - 1);
    this.done = 0; this.attempts = 0; this.ballNo = 0; this.fails = 0; this.frozen = false; this.heldOnce = false; this.nudge = 0;
    this.phase = 'intro'; this.stage = 'practice'; this.t = 0; this.msg = ''; this.msgKey = null; this.lastShot = null; this.result = null;
    this.feedback = null; this.latestFeedback = null; this.inputMotion = null; this.flightTrace = null;
    this.reportedAttempts = 0; this.reportedCorrect = 0;
    this.motionContactGestureId = this.g.swipe && this.g.swipe.gestureId || 0;
    this.practicePassed = false; this.quizPassed = false; this.checkPassed = false; this.finished = false; this.turns = 0; this.replyReady = false;
    this._cueP = null; this._cueBall = -1; this.previousStroke = null; this.previousTechnique = null; this.currentTarget = trainingTarget(this.S.target, 0);
    if (this.mode === 'course') this.profile.lastLesson = this.S.id;
    this.diagram = null; this.g.ball.live = false; this.g.isServeBall = false; this.g.state = GS.RALLY; this.g.stateT = 0;
    if (this.g.cancelInput) this.g.cancelInput();
    this.configureHelp(); this.sync();
  }
  nextStep() {
    if (this.mode !== 'course') { this.goStep(this.step); return; }
    if (this.step + 1 >= TRAIN_STEPS.length) { this.complete(); return; }
    this.goStep(this.step + 1);
  }
  complete() {
    this.finished = true; this.phase = 'done'; this.g.ball.live = false; this.restoreHelp();
    this.sync(); this.g.ui && this.g.ui.trainDone(this);
  }
  restoreHelp() {
    this.g.clearCordCaptureBoost?.();
    if (typeof setCaptureForgiveness === 'function') setCaptureForgiveness(1);
    if (this.g.setSlowmoAllowed) this.g.setSlowmoAllowed(true);
    if (this.g.ai && this.g.ai.setLevel && Number.isFinite(this.oldAiLevel)) this.g.ai.setLevel(this.oldAiLevel);
  }
  quit() {
    this.restoreHelp(); this.frozen = false; this.replyReady = false; this.finished = true;
    if (this.g.cancelInput) this.g.cancelInput();
    this.g.training = null; this.g.ball.live = false; this.g.state = GS.MENU;
    this.g.ui && this.g.ui.trainHide();
  }
  sync() { this.revision++; this.g.ui && this.g.ui.trainSync(this); }
  localize() {
    for (const feedback of [this.feedback, this.latestFeedback]) {
      if (!feedback || !feedback.textKeys) continue;
      const keys = feedback.textKeys;
      feedback.actual.title = ET(keys.actual); feedback.expected.title = ET(keys.expected);
      feedback.title = ET('academy.feedback.' + feedback.code, { actual: feedback.actual.title, expected: feedback.expected.title });
      feedback.correction = ET(keys.correction);
    }
    if (this.msgKey) this.msg = ET(this.msgKey);
    else if (this.phase === 'fail' && this.feedback) this.msg = this.feedbackText;
    if (this.diagram) this.diagram.caption = ET('academy.model');
  }
  progress(practiced, mastered) {
    if (this.mode !== 'course') return;
    const old = this.profile.lessons[this.S.id] || {};
    const attempts = Math.max(0, this.attempts - this.reportedAttempts), correct = Math.max(0, this.done - this.reportedCorrect);
    if (!attempts && !correct && (!practiced || old.practiced) && (!mastered || old.mastered)) return;
    this.profile.lessons[this.S.id] = { mastered: old.mastered === true || !!mastered, practiced: old.practiced === true || !!practiced,
      attempts: (old.attempts || 0) + attempts, correct: (old.correct || 0) + correct };
    this.reportedAttempts = this.attempts; this.reportedCorrect = this.done;
    this.profile.lastLesson = this.S.id;
    if (this.g.ui && this.g.ui.trainProgress) this.g.ui.trainProgress(this);
  }
  action(action, answer) {
    if (action === 'restart') { this.goStep(this.step); return true; }
    if (action === 'retry') {
      if (this.phase === 'fail' || this.phase === 'ok') {
        this.phase = 'wait'; this.t = 0; this.g.ball.live = false; this.feedback = null; this.msg = ''; this.msgKey = null;
        if (this.g.cancelInput) this.g.cancelInput(); this.sync(); return true;
      }
      if (this.phase !== 'review') return false;
      this.done = 0; this.attempts = 0; this.phase = 'intro'; this.t = 0; this.result = null; this.msg = ''; this.msgKey = null;
      this.reportedAttempts = 0; this.reportedCorrect = 0;
      this.feedback = null;
      this.g.ball.live = false; this.frozen = false; if (this.g.cancelInput) this.g.cancelInput(); this.sync(); return true;
    }
    if (action === 'answer' && this.phase === 'question') {
      if (!this.S.quiz.options.includes(answer)) return false;
      if (answer !== this.S.quiz.answer) { this.msgKey = 'academy.wrongChoice'; this.msg = ET(this.msgKey); this.sync(); return false; }
      this.quizPassed = true; this.stage = 'check'; this.done = 0; this.attempts = 0; this.phase = 'intro'; this.t = 0;
      this.reportedAttempts = 0; this.reportedCorrect = 0;
      this.feedback = null; this.result = null;
      this.msgKey = 'academy.checkReady'; this.msg = ET(this.msgKey); this.configureHelp(); this.sync(); return true;
    }
    if (action === 'continue' && this.phase === 'review') {
      if (this.checkPassed) this.nextStep(); else { this.stage = 'practice'; this.goStep(this.step); }
      return true;
    }
    if (action === 'start' && this.phase === 'intro') {
      this.phase = 'wait'; this.t = 0; this.msg = ''; this.msgKey = null; if (this.g.cancelInput) this.g.cancelInput(); this.sync(); return true;
    }
    return false;
  }
  onPress(zone) {
    // Standalone fallback; embed uses explicit, separately hit-tested controls.
    if (this.phase === 'intro') {
      if (typeof window === 'undefined' || !window.__TT_EMBED) this.action('start');
      return;
    }
    if (this.phase === 'fail') { this.action('retry'); return; }
    if (!this.frozen) return;
    if (zone && zone.accepted) { this.frozen = false; this.unfrozeAt = this.g.time; this.nudge = 0; this.msg = ''; this.msgKey = null; }
    else { this.nudge = .6; this.msgKey = 'academy.feedback.zoneFix'; this.msg = ET(this.msgKey); this.g.audio && this.g.audio.ui && this.g.audio.ui('bad'); }
    this.sync();
  }
  serveTarget() { return this.aimSide < 0 ? 'left' : this.aimSide > 0 ? 'right' : 'center'; }
  serveAimSide() { return this.aimSide; }
  coachCue() {
    if (this.phase !== 'live') return null;
    const g = this.g, b = g.ball;
    if (this.guide === 'none') return this.currentTarget ? { kind: 'aim', side: this.aimSide, zone: this.currentTarget } : null;
    if (this.S.serve && g.state === GS.SERVE_READY) return { kind: 'tap', p: b.p, aim: this.aimSide, zone: this.currentTarget };
    if (!b.live || b.lastHitBy === 1) return this.currentTarget ? { kind: 'aim', side: this.aimSide, zone: this.currentTarget } : null;
    if (this.S.serve && g.state === GS.SERVE_TOSS && b.lastHitBy === 0)
      return { kind: 'contact', p: b.p, t: 0, level: this.frozen ? 'freeze' : 'ring', frozen: this.frozen, serve: true, aim: this.aimSide, zone: this.currentTarget,
        gesture: this.frozen ? trainingLessonView(this.S).gesture : null };
    const cp = g.contactPrediction && g.contactPrediction();
    if (!cp || b.v.z <= .05 || b.p.z > cp.p.z + .10) return this.currentTarget ? { kind: 'aim', side: this.aimSide, zone: this.currentTarget } : null;
    if (!this._cueP || this._cueBall !== g.shotId) { this._cueP = { ...cp.p }; this._cueBall = g.shotId; }
    return { kind: 'contact', p: this._cueP, t: cp.t, level: this.frozen ? 'freeze' : 'ring', frozen: this.frozen,
      nudge: this.nudge, aim: this.aimSide, zone: this.currentTarget,
      gesture: this.frozen ? trainingLessonView(this.S).gesture : null };
  }
  feed() {
    const g = this.g, b = g.ball, S = this.S;
    if (g.cancelInput) g.cancelInput();
    this.phase = 'wait'; this.t = 0; this.msg = ''; this.msgKey = null;
    this.lastShot = null; this.pending = null; this.result = null; this.feedback = null; this.inputMotion = null;
    this.flightTrace = null; this.motionContactGestureId = g.swipe && g.swipe.gestureId || 0;
    this.attemptJournalId = g.shotJournal && g.shotJournal.sequence || 0; this.turns = 0; this.replyReady = false;
    this.ballNo++; this.heldOnce = false; this.frozen = false; this.nudge = 0; this._cueP = null;
    const targetIndex = this.stage === 'check' ? this.attempts : this.done;
    const nextTarget = trainingTarget(S.target, targetIndex);
    if (['x0', 'x1', 'z0', 'z1'].some(k => (nextTarget && nextTarget[k]) !== (this.currentTarget && this.currentTarget[k]))) this.diagram = null;
    this.currentTarget = nextTarget;
    this.aimSide = this.currentTarget ? Math.sign(this.currentTarget.x0 + this.currentTarget.x1) : 0;
    if (g.marks) g.marks.length = 0;
    g.rallyBounces.length = 0; g.serveBounces = 0; g.netTouched = false; g.rally = 0;
    if (g.recorder && g.recorder.reset) g.recorder.reset();
    if (g.ai && g.ai.reset) g.ai.reset();
    if (S.serve) { g.server = 1; g.prepServe(); this.phase = 'live'; this.t = 0; this.sync(); return; }
    const kind = S.mix ? S.mix[(this.ballNo - 1) % S.mix.length] : Object.keys(TRAIN_FEEDS).find(k => TRAIN_FEEDS[k] === S.feed) || 'normal';
    this.incomingKind = kind;
    const F = S.mix ? TRAIN_FEEDS[kind] : S.feed || TRAIN_FEEDS.normal;
    const backhand = S.backhand ? g.settings && g.settings.hand === 'left' ? 1 : -1 : 0;
    const launch = trainingFeedBall(F, targetIndex, this.stage === 'check' || this.mode !== 'course', S.displaced, backhand);
    if (!launch) { this.onSystemFault('feeder'); return; }
    V3.copy(b.p, launch.p); V3.copy(b.v, launch.v); V3.copy(b.w, launch.w);
    Q.identity(b.q); b.live = true; b.hist.length = 0; b.lastHitBy = -1; b.golden = null; b.trailGrade = null;
    g.shotId = (g.shotId || 0) + 1; g.isServeBall = false; g.state = GS.RALLY; g.stateT = 0;
    if (g.ai) { V3.copy(g.ai.pos, launch.p); if (g.ai.anim) { g.ai.anim.swing = 1; g.ai.anim.windup = 0; } }
    if (g.aiPaddle) V3.copy(g.aiPaddle.pos, launch.p);
    this.phase = 'live'; this.t = 0; this.sync();
  }
  onPlayerHit(info, racket = {}, contactP) {
    if (this.phase !== 'live') return;
    if (!Number.isFinite(this.g.shotId) || this.g.shotId <= this.lastCapturedShotId) return;
    const stroke = racket.stroke && racket.stroke.id;
    if (!TRAIN_GUIDES[stroke] || TRAIN_GUIDES[stroke].stroke !== stroke) return;
    const b = this.g.ball, input = racket.contactInput || {};
    this.inputMotion = null;
    this.captureMotion(input.p || contactP || b.p);
    const spin = measureShotSpin(b.w, b.v), flight = trainingPath(b.p, b.v, b.w);
    this.lastShot = { ...info, stroke, technique: trainingExecutedTechnique(stroke, spin),
      gesture: { ...(input.gesture || racket.swipe || {}) }, spinMeasured: spin,
      physicalValid: [b.p, b.v, b.w].every(v => v && [v.x, v.y, v.z].every(Number.isFinite)),
      speed: V3.len(b.v) * 3.6, quality: Number.isFinite(info.quality) ? info.quality : 0,
      power: Number.isFinite(racket.power) ? racket.power : info.power,
      grade: b.trailGrade, shotId: this.g.shotId, contactP: contactP ? { ...contactP } : { ...b.p },
      outgoing: { p: { ...b.p }, v: { ...b.v }, w: { ...b.w } }, apex: flight.result.apex, path: flight.path,
      motion: this.inputMotion };
    this.lastShot.incoming = input.v && input.w ? { spin: measureShotSpin(input.w, input.v), speed: V3.len(input.v),
      x: input.p ? input.p.x : this.lastShot.contactP.x, y: input.p ? input.p.y : this.lastShot.contactP.y,
      z: input.p ? input.p.z : this.lastShot.contactP.z, forehand: input.context ? input.context.forehand : racket.forehand } : null;
    this.lastCapturedShotId = this.g.shotId;
    if (this.g.swipe) this.motionContactGestureId = this.g.swipe.gestureId;
    this.flightTrace = [[b.p.x, b.p.y, b.p.z]]; this.traceAt = this.simTime;
    this.pending = this.lastShot; this.stats.hits++; this.total++; this.hitAt = this.simTime;
    this.sync();
  }
  expectedStrokes(shot) {
    const C = this.S.check || {};
    let strokes = C.strokes;
    if (this.S.rally && this.S.rally.sequence) strokes = this.S.rally.sequence[this.turns];
    if (this.S.contextual && shot) {
      const incoming = shot.incoming;
      if (!incoming) return [];
      strokes = incoming.y > PH.TABLE_Y + PH.NET_H + .16 && incoming.speed < 8 ? ['SMASH', 'DRIVE', 'LOOP']
        : incoming.spin.topRps < -3 ? ['PUSH', 'LOOP', 'CHOP', 'FLICK', 'BANANA']
        : incoming.speed > 7 || incoming.spin.topRps > 12 ? ['BLOCK', 'COUNTER', 'LOOP', 'CHOP', 'LOB', 'CHOP_BLOCK']
         : ['DRIVE', 'BLOCK', 'LOOP', 'PUSH', 'CHOP', 'FLICK', 'DROP', 'HOOK', 'FADE', 'SIDE', 'LOB', 'BANANA'];
    }
    return strokes || null;
  }
  criterion(shot) {
    const C = this.S.check || {}, strokes = this.expectedStrokes(shot);
    if (shot.physicalValid === false) return 'spin';
    if (strokes && !strokes.includes(shot.stroke)) return 'stroke';
    if (C.tap && (!shot.gesture.tap || this.S.serve && !shot.gesture.serveTap)) return 'tap';
    const spin = shot.spinMeasured || {}, components = Array.isArray(C.spin) ? C.spin : C.spin ? [C.spin] : [];
    if (components.some(id => id === 'top' ? !(spin.topRps >= 3) : id === 'back' ? !(spin.topRps <= -3)
      : id === 'side' ? !(Math.abs(spin.sideRps) >= 3) : true)) return 'spin';
    if (Number.isFinite(C.maxSpin) && !(spin.totalRps < C.maxSpin)) return 'spin';
    if (C.context) {
      if (!trainingContactEligible(shot.incoming, C.context)) return 'context';
    }
    if (C.powerCycle && (this.stage === 'check' ? this.attempts : this.done) % 2 === 0 && !(shot.power <= .42)) return 'soft';
    if (C.powerCycle && (this.stage === 'check' ? this.attempts : this.done) % 2 === 1 && !(shot.power >= .60)) return 'firm';
    if (C.quality && shot.quality < C.quality || C.timed && !['green', 'yellow'].includes(shot.grade)) return 'timing';
    if (C.speed && shot.speed < C.speed) return 'speed';
    if (C.apex && shot.apex < C.apex) return 'height';
    if (C.vary && this.previousTechnique === trainingExecutedTechnique(shot.stroke, spin)) return 'vary';
    return null;
  }
  captureMotion(contactP) {
    const g = this.g, swipe = g.swipe, samples = swipe && swipe.samples;
    if (!samples || !samples.length || !Number.isFinite(swipe.gestureId) || swipe.gestureId <= this.motionContactGestureId) return;
    const rect = g.canvas && g.canvas.getBoundingClientRect();
    const zone = swipe.pressZone, contact = g.project && g.project(contactP || g.ball.p, {});
    const previous = this.inputMotion && this.inputMotion.ballId === g.shotId && this.inputMotion.gestureId === swipe.gestureId
      ? this.inputMotion.contact : null;
    const points = samples.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 64).map(p => [p.x, p.y]);
    if (!points.length) return;
    this.inputMotion = { points, ballId: g.shotId, gestureId: swipe.gestureId, viewport: rect ? [rect.width, rect.height] : [1, 1],
      contact: !contactP && previous ? previous : contact && contact.ok ? [contact.x, contact.y]
        : zone && zone.vw > 0 && zone.vh > 0 && Number.isFinite(zone.x) && Number.isFinite(zone.y) ? [zone.x / zone.vw, zone.y / zone.vh] : null };
  }
  feedbackFor(reason) {
    const shot = this.lastShot && (!Number.isFinite(this.lastShot.shotId) || this.lastShot.shotId === this.g.shotId) ? this.lastShot : null;
    const result = this.result || {}, strokes = this.expectedStrokes(shot);
    const expected = reason === 'vary' ? Object.keys(TRAIN_GUIDES).find(id => id.startsWith('SERVE_') && id !== this.previousTechnique)
      : strokes && strokes.length && !strokes.includes(this.S.stroke) ? strokes[0] : this.S.technique || this.S.stroke;
    const guide = trainingLessonView(this.S), wanted = TRAIN_GUIDES[expected];
    const gesture = shot && shot.gesture || {}, incoming = shot && shot.incoming;
    let code = reason || 'counted', fix = reason ? 'directionFix' : 'repeat';
    const fixes = { tap: 'tapOnly', spin: 'spinFix', soft: 'softer', firm: 'faster', timing: 'timingFix', speed: 'faster',
      height: 'lobLift', vary: 'changeServe', outside: 'aimRight', net: 'netFix', out: 'outFix',
      miss: 'missFix', serveFault: 'serveFix', rally: 'rallyFix', let: 'letFix', feeder: 'feederFix' };
    if (reason) fix = fixes[reason] || fix;
    if (reason === 'spin' && Number.isFinite(this.S.check && this.S.check.maxSpin)) fix = 'noSpinFix';
    else if (reason === 'spin' && Array.isArray(this.S.check && this.S.check.spin)) fix = 'mixedSpinFix';
    if (reason === 'context') fix = this.S.stroke === 'BANANA' ? 'backhandFix' : this.S.stroke === 'CHOP_BLOCK' ? 'topFastFix' : 'directionFix';
    if (reason === 'tap') code = 'needTap';
    if (reason === 'soft') code = 'fast';
    if (reason === 'firm') code = 'slow';
    if (reason === 'speed') code = 'ballSlow';
    if (reason === 'height') code = 'lobHeight';
    if (reason === 'serveFault') code = 'serve';
    if (reason === 'stroke') {
      const model = wanted && wanted.gesture;
      if (gesture.tap && model && model.kind !== 'tap') { code = 'tap'; fix = 'tapFix'; }
      else if (expected === 'SMASH' && incoming && incoming.y <= PH.TABLE_Y + PH.NET_H + .14) { code = 'height'; fix = 'highContact'; }
      else if (expected === 'FLICK' && incoming && Math.abs(incoming.z) >= PH.T_HALF_LEN - .02) { code = 'depth'; fix = 'overTable'; }
      else if (model && model.kind.startsWith('curve') && ['HOOK', 'FADE'].includes(shot.stroke)) { code = 'curveSide'; fix = 'reverseCurve'; }
      else if (model && model.kind.startsWith('curve') && Number.isFinite(gesture.curl)) { code = 'curve'; fix = 'curveFix'; }
      else if (model && Number.isFinite(gesture.up) && (model.kind === 'up' && gesture.up <= (this.S.serve ? .45 : .30) || model.kind === 'down' && gesture.up >= -.28)) { code = 'direction'; fix = 'directionFix'; }
      else if (expected === 'FLICK' && gesture.dist >= .13 || expected === 'PUSH' && shot.stroke === 'CHOP') { code = 'long'; fix = 'shorter'; }
      else if (expected === 'LOOP' && shot.stroke === 'FLICK' || expected === 'CHOP' && shot.stroke === 'PUSH') { code = 'short'; fix = 'longer'; }
      else if (expected === 'LOB' && ['LOOP', 'COUNTER'].includes(shot.stroke) || expected === 'DROP' && shot.stroke === 'PUSH') { code = 'fast'; fix = 'softer'; }
      else if (['LOOP', 'FLICK'].includes(expected) && shot.stroke === 'LOB') { code = 'slow'; fix = 'faster'; }
      else if (this.S.contextual) code = 'context';
    }
    if (reason === 'outside' && result.landing && this.currentTarget) {
      const p = result.landing, zone = this.currentTarget;
      fix = p.x < zone.x0 ? 'aimRight' : p.x > zone.x1 ? 'aimLeft' : p.z < zone.z0 ? 'aimShort' : 'aimDeep';
    }
    const journal = this.g.shotJournal && this.g.shotJournal.latest;
    const fresh = journal && journal.id > this.attemptJournalId && journal.outcome !== 'no_swipe';
    if (reason === 'miss' && fresh) {
      const admission = journal.pressZone;
      if (admission && admission.accepted === false) { code = 'zone'; fix = 'zoneFix'; }
      if (admission && admission.reason === 'BEFORE_BOUNCE') { code = 'bounce'; fix = 'bounceFix'; }
    }
    const recorded = shot && shot.motion || this.inputMotion;
    const actual = recorded && recorded.ballId === this.g.shotId ? recorded : null;
    const contact = actual && actual.contact;
    const motion = actual && contact ? { points: actual.points.map(p => [p[0] - contact[0], p[1] - contact[1]]),
      viewport: actual.viewport, tap: !!gesture.tap } : null;
    const actualTechnique = shot && trainingExecutedTechnique(shot.stroke, shot.spinMeasured);
    const actualKey = shot && TRAIN_GUIDES[actualTechnique] ? TRAIN_GUIDES[actualTechnique].title : 'academy.feedback.miss';
    const expectedKey = wanted ? wanted.title : (TRAIN_GUIDES[this.S.technique || this.S.stroke] || TRAIN_GUIDES.DRIVE).title;
    const correctionKey = reason === 'stroke' && code === 'stroke' ? this.inputMode === 'touch' ? this.S.tip : this.S.mouseTip : 'academy.feedback.' + fix;
    const actualTitle = ET(actualKey), expectedTitle = ET(expectedKey);
    return { code, title: ET('academy.feedback.' + code, { actual: actualTitle, expected: expectedTitle }),
      correction: ET(correctionKey), textKeys: { actual: actualKey, expected: expectedKey, correction: correctionKey },
      expected: { id: expected, stroke: wanted.stroke, title: expectedTitle,
        gesture: expected === (this.S.technique || this.S.stroke) ? guide.gesture : trainingGestureModel(wanted.gesture, wanted.stroke) },
      actual: { id: shot && shot.stroke || null, technique: actualTechnique || null, title: actualTitle, gesture: motion },
      neutral: reason === 'let' || reason === 'feeder', contact: result.contact === true, legal: result.legal === true,
      targetHit: result.targetHit === true, target: this.currentTarget, landing: result.landing || null };
  }
  onBounce(side, lastHitBy) {
    if (this.phase !== 'live' || lastHitBy !== 1 || !this.pending) return;
    const serving = this.S.serve && this.turns === 0 && this.g.isServeBall;
    if (serving && (side !== -1 || this.g.serveBounces < 1 || this.g.netTouched)) return;
    if (!serving && side !== -1) return;
    const shot = this.pending; this.pending = null;
    const p = this.g.ball.p, inTarget = trainingInTarget(p, this.currentTarget);
    const reason = this.criterion(shot) || (!inTarget ? 'outside' : null);
    this.result = { stroke: shot.stroke, contact: true, legal: true, targetHit: inTarget, reason,
      speed: shot.speed, topspin: shot.spinMeasured.topRps, sidespin: shot.spinMeasured.sideRps,
      corkspin: shot.spinMeasured.corkRps, landing: { x: p.x, z: p.z }, quality: shot.quality };
    if (this.flightTrace) this.flightTrace.push([p.x, p.y, p.z]);
    if (this.diagram) this.diagram.actual = (this.flightTrace || []).slice(-96);
    if (reason) { this.feedback = this.feedbackFor(reason); this.fail(this.feedback.title + '. ' + this.feedback.correction); return; }
    this.previousStroke = shot.stroke; this.previousTechnique = trainingExecutedTechnique(shot.stroke, shot.spinMeasured); this.turns++;
    if (this.S.sparring) { this.sync(); return; }
    if (this.S.rally && this.turns < this.S.rally.returns) {
      this.replyReady = true; this.replyAt = this.simTime + .08; this.sync(); return;
    }
    this.pass();
  }
  tryReply() {
    if (!this.replyReady || this.phase !== 'live' || this.simTime < this.replyAt) return false;
    const g = this.g, b = g.ball;
    if (!b.live || b.lastHitBy !== 1 || g.isServeBall || !g.rallyBounces.some(s => s < 0) || b.p.z >= 0) return false;
    const id = this.S.rally.replies[this.turns - 1] || 'DRIVE', contact = V3.clone(b.p);
    let selected = null;
    for (const vmag of id === 'LOB' ? [2.5, 3.5, 1.8] : [id === 'PUSH' ? 4.5 : 6]) {
      let racket = racketForStroke(id, { side: -1, ball: b.p, ballVelocity: b.v, ballSpin: b.w, ballSpeed: V3.len(b.v),
        grip: 'shakehand', hand: 'right', forehand: true, equip: g.ai && g.ai.equip }, { vmag,
        aim: { x: this.stage === 'check' ? (this.turns % 2 ? -.12 : .12) : 0, z: id === 'LOB' ? 1.12 : .62 }, quality: .9 });
      racket.netClear = id === 'LOB' ? .50 : .15;
      racket = refineRacket(b.p, b.v, b.w, racket, 1, .9);
      const launch = racket && racket.stroke.id === id && resolveRacketLaunch(b, racket, {});
      const legal = launch && strokeIdentityMatches(racket, launch) && predict(launch.p, launch.v, launch.w,
        { dt: PH.SIM_DT, maxT: 3, stopOnFirstBounce: true });
      if (legal && !legal.hitNet && legal.landed && legal.landed.z > 0 && (id !== 'LOB' || legal.apex >= 1.35)) {
        selected = { racket, launch }; break;
      }
    }
    if (!selected) {
      this.onSystemFault('feeder'); return false;
    }
    const { racket, launch } = selected;
    this.replyReady = false;
    V3.copy(b.p, launch.p); V3.copy(b.v, launch.v); V3.copy(b.w, launch.w);
    V3.copy(g.ai.pos, contact); V3.copy(g.aiPaddle.pos, contact); V3.copy(g.aiPaddle.normal, racket.normal);
    if (g.ai.anim) { g.ai.anim.swing = 1; g.ai.anim.windup = 0; }
    g.applyHit(-1, racket, contact, racket.quality, launch.info); this.sync(); return true;
  }
  onLet() {
    if (this.phase !== 'live') return;
    this.onSystemFault('let');
  }
  onSystemFault(reason = 'feeder') {
    if (this.finished || !['wait', 'live'].includes(this.phase)) return false;
    const neutral = reason === 'let' ? 'let' : 'feeder';
    this.g.ball.live = false; this.pending = null; this.frozen = false; this.replyReady = false;
    this.result = { reason: neutral, neutral: true, contact: !!(this.lastShot && this.lastShot.shotId === this.g.shotId),
      legal: neutral === 'let', targetHit: false };
    this.feedback = this.feedbackFor(neutral); this.latestFeedback = this.feedback;
    this.phase = 'fail'; this.t = 0; this.msg = this.feedbackText; this.msgKey = null; this.msgCol = '#9be8ff';
    if (this.g.cancelInput) this.g.cancelInput();
    this.sync(); return true;
  }
  onFault(who, reason) {
    if (this.phase !== 'live') return;
    if (who > 0) {
      if (this.S.sparring && this.turns > 0) this.pass();
      else this.onSystemFault('feeder');
      return;
    }
    this.captureMotion();
    if (this.lastShot && this.lastShot.shotId !== this.g.shotId) this.lastShot = null;
    const journal = this.g.shotJournal && this.g.shotJournal.latest;
    const key = this.S.serve && this.turns === 0 && String(reason).includes('ПОДАЧ') ? 'serveFault'
      : String(reason).includes('СЕТКУ') ? 'net' : String(reason).includes('АУТ') ? 'out'
      : this.S.rally ? 'rally' : 'miss';
    this.result = { stroke: this.lastShot && this.lastShot.stroke || null, contact: !!this.lastShot, legal: false,
      targetHit: false, reason: journal && journal.reason || key, speed: this.lastShot && this.lastShot.speed || 0,
      topspin: this.lastShot && this.lastShot.spinMeasured.topRps || 0, sidespin: this.lastShot && this.lastShot.spinMeasured.sideRps || 0 };
    if (this.diagram && this.flightTrace) this.diagram.actual = this.flightTrace.slice(-96);
    this.feedback = this.feedbackFor(key); this.fail(this.feedback.title + '. ' + this.feedback.correction);
  }
  settle(success, message) {
    this.attempts++; this.stats.attempts++;
    this.frozen = false; this.replyReady = false; this.pending = null; this.g.ball.live = false;
    this.latestFeedback = this.feedback;
    if (this.g.cancelInput) this.g.cancelInput();
    if (success) {
      this.done++; this.stats.success++; this.stats.streak++; this.stats.bestStreak = Math.max(this.stats.bestStreak, this.stats.streak); this.fails = 0;
    } else { this.fails++; this.stats.streak = 0; }
    this.msg = message; this.msgKey = success ? 'academy.counted' : null; this.msgCol = success ? '#4ee39a' : '#ffb066'; this.t = 0;
    if (this.g.audio && this.g.audio.ui) this.g.audio.ui(success ? 'good' : 'bad');
    if (this.mode === 'course' && this.stage === 'check' && this.attempts >= 4) {
      this.checkPassed = this.done >= 3 && this.practicePassed && this.quizPassed;
      this.phase = 'review'; this.msgKey = this.checkPassed ? 'academy.mastered' : 'academy.checkFailed'; this.msg = ET(this.msgKey);
      if (this.checkPassed) this.progress(true, true);
    } else if (this.mode === 'course' && this.stage === 'practice' && this.done >= this.S.need) {
      this.practicePassed = true; this.progress(true, false); this.phase = 'question'; this.msgKey = 'academy.practiceDone'; this.msg = ET(this.msgKey);
    } else this.phase = success ? 'ok' : 'fail';
    this.sync();
  }
  pass() { if (this.phase === 'live') { this.feedback = this.feedbackFor(null); this.settle(true, ET('academy.counted')); } }
  fail(why) { if (this.phase === 'live') this.settle(false, why); }
  skip() { if (!this.finished && this.mode === 'course') this.nextStep(); }
  snapshot() {
    const S = this.S;
    // null is uncomputed; false caches an invalid physical example.
    if (this.diagram === null) {
      const stroke = S.check && S.check.tap && !S.serve ? 'BLOCK' : S.stroke;
      const eq = this.g.equip && this.g.equip.forSide ? this.g.equip.forSide(stroke === 'BANANA' ? -1 : 1) : null;
      this.diagram = trainingDiagram(stroke, this.currentTarget, S.feed, eq, S.technique || stroke, S.gesture) || false;
    }
    return { sessionId: this.sessionId, mode: this.mode, id: S.id, step: this.step, total: TRAIN_STEPS.length,
      title: ET(S.title), goal: this.mode === 'accuracy' ? ET(TRAIN_TARGETS.find(t => t.id === S.target).title) : ET(S.goal),
      text: this.phase === 'intro' ? '' : this.coachText, tip: trainingTip(S, this.inputMode), lesson: trainingLessonView(S),
      inputMode: this.inputMode, stage: this.stage, phase: this.phase, done: this.done, need: this.stage === 'check' ? 4 : S.need,
      paddleHidden: this.g.playerPaddleVisible === false,
      attempts: this.attempts, stats: { ...this.stats }, msg: this.msg, frozen: this.frozen, nudge: this.nudge > 0, guide: this.guide,
      quiz: this.phase === 'question' ? trainingLessonView(S).quiz : null, result: this.result, feedback: this.feedback,
      latestFeedback: this.latestFeedback, feedbackText: this.feedbackText, diagram: this.diagram || null,
      target: this.currentTarget, checkPassed: !!this.checkPassed, practicePassed: !!this.practicePassed, quizPassed: !!this.quizPassed,
      rally: this.S.rally ? { done: this.turns, need: this.S.rally.returns } : null,
      mastery: trainingCoverage(this.profile.lessons) };
  }
  summary() {
    const mastered = TRAIN_STEPS.filter(s => this.profile.lessons[s.id] && this.profile.lessons[s.id].mastered).length;
    return { sessionId: this.sessionId, mode: this.mode, mastered, total: TRAIN_STEPS.length,
      coverage: trainingCoverage(this.profile.lessons).percent, courseComplete: this.mode === 'course' && mastered === TRAIN_STEPS.length };
  }
  update(dtReal, dtSim = dtReal) {
    dtReal = Number.isFinite(dtReal) ? Math.max(0, dtReal) : 0;
    dtSim = Number.isFinite(dtSim) ? Math.max(0, dtSim) : 0;
    if (this.nudge > 0) this.nudge = Math.max(0, this.nudge - dtReal);
    if (this.frozen || this.finished) return;
    this.simTime += dtSim;
    this.t += this.phase === 'live' ? dtSim : dtReal;
    const g = this.g;
    if (this.phase === 'live' && g.swipe && g.swipe.samples && g.swipe.samples.length) this.captureMotion();
    if (this.phase === 'live' && this.pending && g.ball.lastHitBy === 1 && this.simTime - this.traceAt >= 1 / 60) {
      const p = g.ball.p;
      if (this.flightTrace.length < 96) this.flightTrace.push([p.x, p.y, p.z]);
      this.traceAt = this.simTime;
    }
    if (this.phase === 'live' && this.stage === 'practice' && this.guide !== 'none' && !this._frozenDrills.has(this.S.id)) {
      const serving = this.S.serve && g.state === GS.SERVE_TOSS && g.ball.lastHitBy === 0;
      const cp = !serving && g.contactPrediction && g.contactPrediction();
      if (serving && g.ball.v.y < 0 && g.ball.p.y <= (g.tossApex || 0) - .05 ||
          !serving && cp && g.rallyBounces.some(s => s > 0) && cp.t <= COACH_FREEZE_T) {
        this._frozenDrills.add(this.S.id); this.frozen = true; this.heldOnce = true; this.sync(); return;
      }
    }
    if (this.phase === 'wait' && this.t >= .65) this.feed();
    else if (this.phase === 'ok' && this.t >= 1 || this.phase === 'fail' && this.t >= 1.5) this.feed();
    else if (this.phase === 'live' && this.t > (this.S.serve ? 25 : this.S.rally || this.S.sparring ? 35 : 10)) this.onFault(-1, 'miss');
    if (this.replyReady && g.ai && g.ai.pos) {
      const k = 1 - Math.exp(-18 * dtSim), b = g.ball;
      g.ai.pos.x += (b.p.x - g.ai.pos.x) * k; g.ai.pos.y += (b.p.y - g.ai.pos.y) * k; g.ai.pos.z += (b.p.z - g.ai.pos.z) * k;
      if (g.aiPaddle) V3.copy(g.aiPaddle.pos, g.ai.pos);
    }
  }
}
