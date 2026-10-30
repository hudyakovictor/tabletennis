/* =====================================================================
 *  GAME — state machine, ITTF rules, continuous collision detection,
 *  camera rig, VFX, replay recorder.
 * ===================================================================== */
'use strict';

/* Where the opponent's bat meets its own toss, metres above the table. */
const AI_SERVE_CONTACT_Y = STROKE_CONFIG.serve.toss.aiContactHeight;

const GS = {
  MENU: 'MENU', SERVE_READY: 'SERVE_READY', SERVE_TOSS: 'SERVE_TOSS',
  RALLY: 'RALLY', POINT: 'POINT', REPLAY: 'REPLAY', MATCH_END: 'MATCH_END',
};

const PHYS_DT = PH.SIM_DT;        // 600 Hz — and the same step every solver verdicts on

/* --------------------------- particles ----------------------------- */
/* Particles — см. 61_particles.js (пул спрайт-вспышек, вынесен из Game). */
/* --------------------------- the game ------------------------------ */
/** How much the bat slides toward the predicted meeting point while the
 *  ball approaches the blade's plane — indexed by difficulty level. The
 *  harder the opponent, the more honest the geometry: 0.85 with a rookie,
 *  nearly nothing with WTF. The point itself is solved ON the bat's own
 *  plane by contactPrediction(), so the pull can never run along a wrong
 *  depth.
 *  Таблица обязана иметь ровно столько же строк, сколько AI_LEVELS
 *  (это проверяет tests/ai-levels.test.js): раньше их было пять, пока
 *  уровней было пять, и после перебалансировки осталась строка-сирота. */
const MEET_ASSIST = [0.85, 0.60, 0.30, 0.10];
const MEET_ASSIST_RADIUS = 0.62;   // metres — outside this the bat is the pointer's
const MEET_ASSIST_HORIZON = 0.60;  // seconds to the meeting point

/* Шлейф мяча: одна ширина на всю ленту и короткий хвост в точках истории.
 * 32 точки — это ≈0.17 с полёта: направление видно, «облако» не рисуется. */
const TRAIL_WIDTH = 0.011;   // metres — half-width of the ribbon
const TRAIL_POINTS = 32;

/* Ориентация мяча — ТОЛЬКО визуал: по ней ничего не считается (b.q нужен
 * только M4.compose в отрисовке). Честные 300 рад/с — это ~48 об/с, а мяч на
 * экране 6–10 px: шов превращается в стробоскоп и направление крутки не
 * читается вообще. Для маски мяча скорость сжимается до читаемого предела,
 * ОСЬ и ЗНАК сохраняются — куда мяч крутится, туда и бежит рисунок. */
const SPIN_VISUAL_CAP = 34;  // rad/s ≈ 5.4 об/с — самый быстрый читаемый бег шва
function spinVisualRate(w, out) {
  const l = V3.len(w);
  if (!(l > SPIN_VISUAL_CAP)) return V3.copy(out, w);
  return V3.mul(out, w, SPIN_VISUAL_CAP / l);
}

function parkServeBall(out, pad, hand) {
  const toss = STROKE_CONFIG.serve.toss;
  // The free hand holds the real ball beside the blade, not behind its handle.
  return V3.set(out, pad.pos.x + (hand === 'left' ? 1 : -1) * toss.lateralOffset,
    PH.TABLE_Y + toss.height,
    clamp(pad.pos.z - toss.paddleZOffset, PH.T_HALF_LEN + toss.endLineMargin, toss.farZ));
}

/* Насколько мяч зелёный в этом кадре: 0 — белый, 1 — «бей сейчас».
 * Единственный носитель тайминга в матче. Тон считается по ВРЕМЕНИ до
 * контакта, а не по факту пересечения бокса захвата: по замерам живого
 * матча честное окно захвата — 1 кадр (17–33 мс), глаз его не ловит.
 * lead — с какого запаса цвет начинается, full — с какого он уже полный. */
function strikeGreenTint(w, lead, full) {
  if (!w || !w.on) return 0;
  if (w.contactable) return 1;
  const t = Number.isFinite(w.t) ? w.t : Infinity;
  return clamp((lead - t) / (lead - full), 0, 1);
}

class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    this.R = new Renderer(canvas, { quality: 'high' });
    this.scene = new Scene(this.R, 'arena');
    this.audio = new AudioEngine();
    this.ai = new OpponentAI(0);
    /* Тренд адаптации между матчами (−1…+1): его ставит хост (S.form) или
     * своя история результатов в автономном меню движка. */
    this.aiTrend = 0;
    this.swipe = new SwipeTracker();
    this.particles = new Particles();
    this.rig = new PaddleRig();
    this.equip = new Equipment();

    // Hit feedback system (99-level multi-sensory response)
    this.hitFeedback = new HitFeedbackSystem(this);

    // Music system (99-level emotional audio)
    this.music = new MusicSystem(this.audio);

    // Emotional design system (99-level dramatic arc)
    this.emotion = new EmotionalSystem(this);
    this.aiEquip = new Equipment('b_carb', 'r_base', 'r_base');
    /* the commercial layer: profile, shop, analytics, and where we run */
    this.platform = new Platform(typeof navigator !== 'undefined' ? navigator : null);
    this.analytics = new Analytics(this.platform);
    this.profile = new Profile(this.platform);
    this.shop = new Shop(this.profile, this.platform, this.analytics);
    this.applyEquipment();
    this.matchTasks = { topspin: 0, smash: 0, serves: 0, moments: 0 };
    this.iap = null;                     // the mobile wrapper sets this
    this.moments = new MomentRecorder();
    this.replayer = new MomentPlayer();

    this.settings = {
      difficulty: 0,
      quality: 'high',
      sound: true,
      volume: 0.9,
      camera: 'BROADCAST',
      camZoom: 1,                    // legacy-подстройка из старых сейвов; новый ввод её не трогает
      camPitch: 0,                   // to же, в градусах поверх пресета
      hand: 'right',
      grip: 'shakehand',
      showTrail: true,
      showPredict: true,
      showTele: false,
      haptics: true,
      coach: true,
      adaptive: true,
      showDebug: false,
      showPlayerPaddle: true,
      slowmoOnBigShots: false,          // slow-mo в момент удара деформирует твой же тайминг; ручной режим — в настройках
      targetScore: 11,
      spinBias: 'norm',
      spinGain: 1,        // калибровка: сила закрутки мяча (0.5..1.6)
      arcSens: 1,         // калибровка: чувствительность дуги «С» (0.6..1.8)
      // NEW: Enhanced gameplay settings
      showSpinIndicator: true,
      followThrough: true,
      anticipationHint: true,
      shotFeedback: true,
      momentumBar: true,
      replaySlowmo: true,
    };
    /* Saved settings are applied AFTER the defaults exist. It used to run
     * 60 lines earlier, while this.settings was still undefined, so
     * Object.assign threw — and because boot() catches everything, a player
     * who had EVER changed a setting got the "WebGL недоступен" screen on
     * every following visit. A first visit worked (profile.data.settings is
     * null then), which is why it survived to here. Found by the headless
     * smoke suite: 2 of 3 matches failed to boot once localStorage was warm. */
    installUnifiedControls(this.settings);
    this.loadSettings();
    this.ai.setLevel(this.settings.difficulty);

    this.ball = {
      p: V3.new(0, PH.TABLE_Y + 0.3, 1.2), v: V3.new(), w: V3.new(),
      q: Q.new(), live: false, hist: [], lastHitBy: 0, speed: 0,
    };
    this.player = {
      pos: V3.new(0, PH.TABLE_Y + 0.25, 1.78),
      prev: V3.new(0, PH.TABLE_Y + 0.25, 1.78),
      vel: V3.new(), normal: V3.new(0, 0, -1),
      q: Q.new(), swing: 0, side: 1, hitRadius: MATCH_RULES.sweetRadius, lastHitT: -9,
      prevPos: V3.new(0, PH.TABLE_Y + 0.25, 1.78),
    };
    this.paddleMotion = new PaddleStrokeMotion();
    this.aiPaddle = {
      pos: V3.new(0, PH.TABLE_Y + 0.25, -1.45), normal: V3.new(0, 0, 1),
      q: Q.new(), side: -1,
    };

    this.recorder = new RallyRecorder();
    this.analyst = new PointAnalyst();
    this.director = new MatchDirector();
    this.shotId = 0;                     // bumped on every contact
    this.lastSwipeT = -9;
    this.lastSwipeLate = false;
    this.pointNote = null;               // one-line diagnosis of the last point
    this.pointerFine = true;             // mouse/pen vs finger: wrist follow rate

    this.state = GS.MENU;
    this.paused = false;
    this.training = null;
    this.time = 0; this.frame = 0; this.stateT = 0;
    /* Внутренний масштаб рендера: 1 — как выбрал игрок в quality, ниже —
     * движок сам экономит пиксели на слабом телефоне (решает PerfMonitor). */
    this.renderScale = 1;
    this.strokeTime = 0;                // same scaled clock as the ball, for input freshness
    this.score = [0, 0];                 // [player, ai]
    this.games = [0, 0];
    this.server = 1;                     // +1 player serves
    this.servesLeft = 2;
    this.rally = 0; this.bestRally = 0;
    this.rallyBounces = [];
    this.serveBounces = 0;
    this.isServeBall = false;
    this.lastPoint = null;
    this.timeScale = 1; this.targetTimeScale = 1;
    this.shake = 0; this.shakeDir = V3.new();

    // Follow-through state
    this.followThrough = {
      active: false,
      t: 0,
      swingDir: V3.new(),
      duration: 0.15,
    };

    // Anticipation state
    this.anticipation = {
      active: false,
      t: 0,
      duration: 0.12,
      targetDir: V3.new(0, 0, -1),
      intensity: 0,
      visualOffset: V3.new(),
    };

    this.shotJournal = new ShotJournal();
    this.inputLog = typeof InputTelemetryLog !== 'undefined' ? new InputTelemetryLog() : null;
    /* Сторож физики: пять классов геймплейных багов детектируются сами,
     * без записи кадров и без участия человека. Тикеты живут в памяти
     * (кольцо на 64) и попадают в отчёт; при включённой записи — ещё и в
     * журнал событий как 'watchdog'. Ничего наружу не уходит. */
    this.watchdog = typeof PhysicsWatchdog !== 'undefined' ? new PhysicsWatchdog() : null;
    if (this.watchdog) {
      this.watchdog.onTicket = (row) => {
        if (this.debugRecording && typeof this.logInput === 'function') this.logInput('watchdog', { outcome: row });
      };
    }
    this._hitSeq = 0;

    // Momentum tracking
    this.momentum = {
      current: 0,
      target: 0,
      streak: 0,
      lastWinner: 0,
    };

    // Spin indicator state
    this.spinIndicator = {
      active: false,
      w: V3.new(),
      color: [1, 1, 1],
    };

    this.motionQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = !!(this.motionQuery && this.motionQuery.matches);
    if (this.motionQuery) {
      const onMotionPreference = (event) => {
        this.reducedMotion = !!event.matches;
        if (this.reducedMotion) {
          this.shake = 0; this.hitFlash = 0;
          this.marks.length = 0; this.particles.n = 0;
          if (this.R && this.R.post) { this.R.post.radial = 0; this.R.post.flash = 0; }
        }
      };
      if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', onMotionPreference);
      else if (this.motionQuery.addListener) this.motionQuery.addListener(onMotionPreference);
    }
    /* No zoom, no manual height: the view is authored, fitted once per
       aspect ratio and only changes when the player picks another preset. */
    this.camShiftY = 0;
    this.camRig = { eye: V3.new(0, 1.68, 2.38), look: V3.new(0, 0.74, -0.25), fov: 44, shiftY: 0, mode: 'BROADCAST' };
    this._rigBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() };
    this.camVP = M4.create();          // view·proj of the camera on screen, no shake
    this.hudBandY = PLAY_BAND_Y;       // screen y of the reading band
    this.camPos = V3.new(0, 1.68, 2.38); this.camLook = V3.new(0, 0.74, -0.25);
    this.camPosT = V3.clone(this.camPos); this.camLookT = V3.clone(this.camLook);
    this.fov = 44; this.fovT = 44;
    this._liveRig = { eye: V3.new(0, 1.68, 2.38), look: V3.new(0, 0.74, -0.25), fov: 44, shiftY: 0 };
    this.marks = [];
    this.stats = {
      shots: 0, winners: 0, errors: 0, maxSpeed: 0, maxSpin: 0,
      byStroke: {}, totalSpin: 0, rallies: 0,
    };
    this.replayBuf = []; this.replayMax = 360; this.replay = null;
    this.slowmo = { on: false, energy: 1, active: false, allowed: true, used: 0 };
    this.inspectSlowmo = false;   // тумблер разбора траектории (кнопка слоу-мо)
    this.freePlay = false;        // свободная игра: очки идут, счёт и матч — нет
    this.predictPath = [];
    this.predictOut = {};
    this.lastShotInfo = null;
    this.messages = [];
    this.hitFlash = 0;
    this.serveHint = 0;
    this._acc = 0;
    this._fpsT = 0; this._fpsN = 0; this.fps = 60;

    this.bindInput();

    // Career mode (roguelike tournament progression, ported from PR #1)
    this.career = new Career(this);
    this._careerSpinBoost = 1; this._careerSpeedBoost = 1;
    this._careerTopspinBoost = 1; this._careerBackspinPenalty = 1;
    this._careerSmashBoost = 1; this._careerCounterBoost = 1;
    this._careerChopBoost = 1; this._careerSidespinBoost = 1;
    this._careerDecisiveBoost = 0; this._careerNetSafe = false;
    this._careerAISlowdown = 1;

    // Online multiplayer over the relay (experimental)
    this.network = new NetworkManager(this);

    this.resize();
    this.updateCamera(0);

    // Initialize music system
    if (this.music) {
      this.music.init().then(() => {
        // Music ready
      }).catch(e => {
        console.warn('Music init failed:', e);
      });
    }

    window.addEventListener('resize', () => this.resize());
  }

  /* ----------------------------- input ---------------------------- */
  bindInput() {
    const c = this.canvas;
    /* Screen → surface coordinates. A pointer event with a non-finite or
       absurd coordinate (broken touch driver, synthetic event, detached
       canvas with a zero-size rect) used to poison the paddle transform
       permanently: one NaN reached the smoothing filter and the racket
       never came back. Sanitise at the boundary, in one place. */
    const norm = (e) => {
      const r = c.getBoundingClientRect();
      const w = r.width > 0 ? r.width : (c.clientWidth || 1);
      const h = r.height > 0 ? r.height : (c.clientHeight || 1);
      const xr = (e.clientX - r.left) / w;
      const yr = (e.clientY - r.top) / h;
      const x = Number.isFinite(xr) ? clamp(xr, 0, 1) : 0.5;
      const y = Number.isFinite(yr) ? clamp(yr, 0, 1) : 0.5;
      /* Raw gesture coordinates preserve swipe velocity & angle when a fast
       * flick travels past the canvas border, while x/y stay inside 0..1 so
       * the 3D paddle can never park off-screen. */
      const rawX = Number.isFinite(xr) ? clamp(xr, -0.35, 1.35) : x;
      const rawY = Number.isFinite(yr) ? clamp(yr, -0.35, 1.35) : y;
      return { x, y, rawX, rawY };
    };

    // Monotonic hardware-timestamp gesture clock anchored to `this.time` so
    // multi-event bursts within one rAF frame keep true millisecond spacing.
    let _domT0 = null, _gameT0 = 0, _lastEvT = 0;
    const evTime = (e) => {
      const ts = e && Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : null;
      if (ts === null) {
        _lastEvT = Math.max(_lastEvT, this.time);
        return _lastEvT;
      }
      if (_domT0 === null || Math.abs((this.time - _gameT0) - (ts - _domT0) * 0.001) > 0.22) {
        _domT0 = ts;
        _gameT0 = this.time;
      }
      const mapped = _gameT0 + Math.max(0, (ts - _domT0) * 0.001);
      _lastEvT = Math.max(_lastEvT, mapped);
      return _lastEvT;
    };
    const evSimTime = (tReal) => this.strokeTime + Math.max(0, tReal - this.time) * (this.timeScale || 1);

    // Left pointer = stroke. The camera is fixed: no right-drag, no wheel.
    const ptrs = new Map();
    let activeStrokePointerId = null;
    const domEvent = e => ({ type: e.type, pointerId: e.pointerId, pointerType: e.pointerType || null,
      clientX: Number.isFinite(e.clientX) ? e.clientX : null, clientY: Number.isFinite(e.clientY) ? e.clientY : null,
      button: e.button, buttons: e.buttons, pressure: Number.isFinite(e.pressure) ? e.pressure : null,
      width: Number.isFinite(e.width) ? e.width : null, height: Number.isFinite(e.height) ? e.height : null,
      timestamp: Number.isFinite(e.timeStamp) ? e.timeStamp : null,
      receivedAt: typeof performance !== 'undefined' ? performance.now() : null,
      trusted: !!e.isTrusted, cancelable: !!e.cancelable });
    const dropStroke = () => {
      activeStrokePointerId = null;
      this.swipe.cancel();
      this.pointerDown = false;
    };

    this.cancelInput = (reason = 'unspecified', event = null) => {
      if (this.debugRecording) this.logInput('input_cancel', { dom: event ? domEvent(event) : null,
        outcome: { reason, active: !!this.swipe.active, pointerDown: !!this.pointerDown, pointers: ptrs.size } });
      ptrs.clear(); dropStroke();
    };
    const down = (e) => {
      if (this.paused || this.state === GS.MENU || this.state === GS.MATCH_END) {
        if (this.debugRecording) this.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: this.paused ? 'PAUSED' : 'NON_PLAY_STATE' } });
        return;
      }
      if (e.button === 2 || e.button === 1) {
        if (this.debugRecording) this.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'NON_PRIMARY_BUTTON' } });
        e.preventDefault(); return;
      }
      if (this.demoMode) this.stopDemo(); // a real stroke always takes control
      this.audio.init(); this.audio.resume();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();

      if (this.replayer.on) {
        if (this.debugRecording) this.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'REPLAY_SKIPPED' } });
        this.skipReplay(); return;
      }
      if (ptrs.size >= 2) {                          // a second finger cancels
        if (this.debugRecording) this.logInput('input_cancel', { dom: domEvent(e), outcome: { reason: 'SECOND_POINTER', pointers: ptrs.size } });
        dropStroke();
        return;
      }
      const n = norm(e);

      // ---- ANTICIPATION TRIGGER ----
      // Before a swipe, pull the paddle back slightly to telegraph
      // the upcoming stroke. This is critical for game feel.
      if (this.settings.anticipationHint && !this.anticipation.active) {
        const centerX = 0.5;
        const dx = n.x - centerX;
        const dy = n.y - 0.55;
        const mag = Math.hypot(dx, dy) || 0.1;
        if (mag > 0.1) {
          const normX = dx / mag;
          const normY = dy / mag;
          this.anticipation.active = true;
          this.anticipation.t = 0;
          this.anticipation.targetDir = V3.norm(V3.new(),
            V3.new(normX * 0.3, normY * 0.2, 0.5));
          this.anticipation.intensity = clamp(mag * 2, 0.3, 1.0);
          this.anticipation.duration = 0.08 + 0.06 * this.anticipation.intensity;
        }
      }

      activeStrokePointerId = e.pointerId;
      const tEv = evTime(e), simEv = evSimTime(tEv);
      const pointerType = e.pointerType || (this.pointerFine === false ? 'touch' : 'mouse');
      this.pointer = { x: n.x, y: n.y };
      this.pointerFine = pointerType !== 'touch' && pointerType !== 'pen';

      this.swipe.down(n.rawX, n.rawY, tEv, simEv);
      this.swipe.tapMaxMovePx = 0;
      const rect = c.getBoundingClientRect();
      const serveReadyPress = this.state === GS.SERVE_READY && this.server === 1;
      const servePress = this.state === GS.SERVE_TOSS && this.server === 1;
      const cpGate = (!servePress && !serveReadyPress && MATCH_RULES.zoneAnchor === 'contact')
        ? this.contactPrediction() : null;
      const corridor = (!servePress && !serveReadyPress && MATCH_RULES.zoneAnchor === 'contact')
        ? this.strikeCorridor() : null;

      let ballZone = null;
      if (!servePress && !serveReadyPress && MATCH_RULES.zoneAnchor === 'contact') {
        ballZone = evaluateContactZone(
          corridor,
          this.ball,
          n,
          rect.width,
          rect.height,
          point => this.project(point, {}),
          point => this.contactGateScale(point, rect),
          {
            pointerType,
            frozen: !!(this.training && this.training.frozen),
            referenceWorld: this.player && this.player.pos,
          }
        );
        if (ballZone && ballZone.accepted && ballZone.worldTarget && Number.isFinite(ballZone.worldTarget.z)) {
          this._footZ = clamp(ballZone.worldTarget.z, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
        }
      } else {
        ballZone = pressZoneForBall(this.ball, n, rect.width, rect.height, {
          project: point => this.project(point, {}), pointerType,
          referenceWorld: this.player && this.player.pos,
          kind: (servePress || serveReadyPress) ? 'serve' : 'rally',
          tossApex: this.tossApex, tossStartY: this.tossStartY, tableY: PH.TABLE_Y,
        });
      }

      this.swipe.pressZone = ballZone || { accepted: false, shape: MATCH_RULES.zoneShape,
        radius: MATCH_RULES.pressRadiusPx, distancePx: null, score: null, along: null,
        across: null, reason: 'OUTSIDE_ZONE', pointerType };

      // Seamless early-serve backswing continuity: if the player begins their
      // serve gesture during SERVE_READY (one-motion toss+strike) or while the
      // toss is still rising towards its apex, arm `pendingServeDrop` when the
      // press is horizontally aligned with the toss column.
      if ((servePress || serveReadyPress) && !this.swipe.pressZone.accepted) {
        const rising = serveReadyPress || (this.ball && this.ball.v && this.ball.v.y >= -0.05);
        if (rising && canArmEarlyServeSwipe(this.project(this.ball.p, {}), n, rect.width, rect.height, pointerType)) {
          this.swipe.pressZone.pendingServeDrop = true;
          this.swipe.pressZone.singleGestureToss = serveReadyPress;
        }
      } else if (!servePress && !serveReadyPress && !this.swipe.pressZone.accepted &&
          this.state === GS.RALLY && corridor && corridor.valid) {
        /* A deep loop/push backswing legitimately starts far below the
         * meeting point (real players begin the swing a foot under the ball).
         * Arm it as a `pendingBackswing` when it starts on the ball's lateral
         * line; it is only ADMITTED later, when the live stroke actually
         * sweeps inside the corridor (`promotePendingRallyBackswing`). */
        const pz0 = this.swipe.pressZone;
        if (Number.isFinite(pz0.across) && Number.isFinite(pz0.along) &&
            Number.isFinite(pz0.sidePx) && Number.isFinite(pz0.fwdPx) &&
            Math.abs(pz0.across) <= pz0.sidePx * 2.6 &&
            pz0.along > pz0.fwdPx && pz0.along <= pz0.fwdPx * 4.5) {
          pz0.pendingBackswing = true;
        }
      }

      this.swipe.pressZone.pressX = n.x; this.swipe.pressZone.pressY = n.y;
      this.swipe.pressZone.vw = rect.width; this.swipe.pressZone.vh = rect.height;
      this.swipe.pressZone.pointerId = e.pointerId;
      this.swipe.pressZone.pointerType = pointerType;
      this.swipe.pressZone.pressT = tEv;
      if (this.debugRecording && Number.isFinite(e.timeStamp)) this.swipe.pressZone.domTimestamp = e.timeStamp;
      this.swipe.pressZone.pressContactable = !!(this._strike && this._strike.on && this._strike.contactable);
      this.swipe.pressZone.shotId = this.shotId;
      this.swipe.pressZone.serving = serveReadyPress || servePress;
      const ballAtPress = this.project(this.ball.p, {});
      this.swipe.pressZone.tapAtPress = this.swipe.pressZone.accepted === true && ballAtPress.ok &&
        Math.hypot((n.x - ballAtPress.x) * rect.width, (n.y - ballAtPress.y) * rect.height) <= CONTACT_CORRIDOR_RULES.tapContactRadiusPx;
      if (this.training && typeof this.training.onPress === 'function') this.training.onPress(this.swipe.pressZone);
      if (typeof this.onPressZone === 'function') this.onPressZone(this.swipe.pressZone, cpGate, servePress);
      if (this.shotJournal) {
        const attempt = this.shotJournal.create(this.swipe.gestureId, tEv);
        attempt.pressZone = { ...this.swipe.pressZone };
        const win = attempt.pressZone.serving ? 1.15 : .25;
        attempt.deadline = tEv + win;
        attempt.deadlineSim = simEv + win;
        if (!attempt.pressZone.accepted) attempt.outcome = 'outside';
      }
      this.pointerDown = true;
      this.logInput('pointerdown', { pointer: { x: n.x, y: n.y }, pointerId: e.pointerId, buttons: e.buttons, inputType: pointerType,
        dom: this.debugRecording ? domEvent(e) : null,
        outcome: { greenAtPress: !!this.swipe.pressZone.pressContactable,
          gateAnchor: corridor && corridor.valid ? 'strike_corridor' : (cpGate ? 'predicted_contact' : 'current_ball'),
          predictedEta: cpGate ? cpGate.t : null } });
      if (this.debugRecording) this._debugLastPress = { shotId: this.shotId, gestureId: this.swipe.gestureId,
        green: !!this.swipe.pressZone.pressContactable, accepted: !!this.swipe.pressZone.accepted, time: tEv };
      if (serveReadyPress) this.startToss();
    };

    const track = (e) => {
      const n = norm(e);
      this.pointer = { x: n.x, y: n.y };
      const tEv = evTime(e);
      if (e.pointerType) this.pointerFine = e.pointerType !== 'touch' && e.pointerType !== 'pen';
      if (e.pointerType === 'mouse') {
        this.mouseTrail = (this.mouseTrail || []).filter(p => tEv - p.t < 0.14);
        this.mouseTrail.push({ x: n.x, y: n.y, t: tEv });
        if (this.mouseTrail.length > 64) this.mouseTrail.shift();
      }
      this.pointerInside = n.x > 0.001 && n.x < 0.999 && n.y > 0.001 && n.y < 0.999;
      return n;
    };

    const move = (e) => {
      const p = ptrs.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (this.swipe.active && activeStrokePointerId !== null && e.pointerId !== activeStrokePointerId) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      const n = track(e);
      if (this.swipe.active && ptrs.size < 2) {
        const tEv = evTime(e), simEv = evSimTime(tEv);
        const z = this.swipe.pressZone;
        if (z) this.swipe.tapMaxMovePx = Math.max(this.swipe.tapMaxMovePx || 0,
          Math.hypot((n.rawX - z.pressX) * z.vw, (n.rawY - z.pressY) * z.vh));
        this.swipe.move(n.rawX, n.rawY, tEv, simEv);
        this.promotePendingServeZone();
        this.promotePendingRallyBackswing(n);
        const sp = this.swipe.m.speed;
        if (sp > 1.6) this.audio.whoosh(clamp(sp / 4, 0, 1.4));
        this.logInput('pointermove', { pointer: { x: n.x, y: n.y }, pointerId: e.pointerId, buttons: e.buttons,
          inputType: e.pointerType || (this.pointerFine === false ? 'touch' : 'mouse'),
          dom: this.debugRecording ? domEvent(e) : null });
        this.tryInputHit(this.swipe.m);
      }
      if (e.cancelable) e.preventDefault();
    };

    const up = (e) => {
      ptrs.delete(e.pointerId);
      if (e.button === 2 || e.button === 1) {
        e.preventDefault();
        return;
      }
      if (activeStrokePointerId !== null && e.pointerId !== activeStrokePointerId) {
        if (this.debugRecording) this.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'NON_OWNER_POINTER_RELEASE' } });
        e.preventDefault(); return;
      }
      if (ptrs.size >= 1) {
        if (this.debugRecording) this.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'OTHER_POINTER_STILL_DOWN' } });
        e.preventDefault(); return;
      }
      if (!this.swipe.active) {
        activeStrokePointerId = null;
        if (this.debugRecording) this.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'RELEASE_WITHOUT_ACTIVE_PRESS' } });
        this.pointerDown = false; return;
      }
      activeStrokePointerId = null;
      const n = norm(e);
      const tEv = evTime(e), simEv = evSimTime(tEv);
      this.pointer = { x: n.x, y: n.y };
      const sw = this.swipe, zone = sw.pressZone;
      if (zone) sw.tapMaxMovePx = Math.max(sw.tapMaxMovePx || 0,
        Math.hypot((n.rawX - zone.pressX) * zone.vw, (n.rawY - zone.pressY) * zone.vh));
      this.promotePendingServeZone();
      sw.up(n.rawX, n.rawY, tEv, simEv);
      // Only a stationary toss tap is disarmed. A completed early serve swipe
      // must survive release and meet the ball when the toss starts falling.
      if (zone && zone.singleGestureToss && !isRealStroke(sw.lastReleased, true)) {
        zone.pendingServeDrop = false;
      }
      this.pointerDown = false;
      this.swipeReleasedAt = tEv;
      const tapAge = tEv - sw.startT;
      const tapSlop = zone && zone.pointerType === 'mouse' ? 10 : 14;
      const flickMax = CONTACT_CORRIDOR_RULES.compactFlickMaxPx;
      const rallyTap = this.state === GS.RALLY && this.ball.live && this.ball.lastHitBy === -1;
      const serveTap = zone && zone.serving && !zone.singleGestureToss &&
        this.state === GS.SERVE_TOSS && this.server === 1 && this.ball.live && this.ball.lastHitBy === 0 &&
        this.ball.v.y < 0 && this.tossRiseNow() >= MATCH_RULES.serveTossMinRise - 1e-6;
      if (zone && zone.shotId === this.shotId && (rallyTap || serveTap) &&
          tapAge >= 0 && tapAge <= CONTACT_CORRIDOR_RULES.compactFlickMaxSec &&
          !isRealStroke(sw.lastReleased, !!serveTap)) {
        if (sw.tapMaxMovePx <= tapSlop) {
          sw.lastReleased = tapStrokeMetrics(sw.lastReleased, zone.pressX, zone.pressY, !!serveTap);
        } else if (!zone.serving && zone.accepted && sw.tapMaxMovePx <= flickMax) {
          sw.lastReleased = compactStrokeMetrics(sw.lastReleased, n.x, n.y);
        }
      }
      this.updateShotDiagnostics();
      this.logSwipeRelease({ pointer: { x: n.x, y: n.y }, pointerId: e.pointerId, buttons: e.buttons,
        inputType: e.pointerType || (this.pointerFine === false ? 'touch' : 'mouse'),
        dom: this.debugRecording ? domEvent(e) : null });
      this.lastSwipeT = tEv;
      this.tryInputHit(sw.lastReleased);
      e.preventDefault();
    };

    c.addEventListener('pointerdown', (e) => {
      /* A synthetic or already-released pointer has no capture target, and
       * setPointerCapture throws for it — which used to abort the whole
       * handler, so the press never became a stroke. */
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer */ }
      down(e);
    });
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this.cancelInput('pointercancel', e));
    c.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) this.cancelInput('lostpointercapture', e); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // Hover movement follows the bat. A held right button is not a camera command.
    window.addEventListener('pointermove', (e) => { if (!ptrs.size && !this.swipe.active) track(e); }, { passive: true });
    window.addEventListener('blur', () => { this.cancelInput('window_blur'); this.setPaused(true); });
    document.addEventListener('visibilitychange', () => {
      if (this.debugRecording) this.logInput('visibility', { outcome: { state: document.visibilityState } });
      if (document.hidden) { this.cancelInput('document_hidden'); this.setPaused(true); this.profile.save(true); }
    });
    window.addEventListener('pagehide', (e) => {
      if (this.debugRecording) this.logInput('pagehide', { outcome: { persisted: !!e.persisted } });
      if (this.debugArchive) this.debugArchive.flush();
      this.saveSettings(); this.profile.save(true); this.career.save();
    });
    // The wheel used to dolly the camera. A page that scrolls nowhere should
    // still not jump, so it is swallowed — but it changes nothing on screen.
    c.addEventListener('wheel', (e) => { e.preventDefault(); }, { passive: false });
    c.style.touchAction = 'none';

    /* Keep vertical gestures in the mini app when Telegram supports the API;
     * retain the DOM fallback for older Telegram clients and embedded webviews. */
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (tg && typeof tg.setupSwipeBehavior === 'function') {
        tg.setupSwipeBehavior({ allow_vertical_swipe: false });
      }
    } catch (e) { console.debug('Telegram swipe behavior unavailable', e); }
    document.addEventListener('touchmove', (e) => {
      // The pause actions are a real scroll area on small phones. Do not
      // swallow its touch scroll while preventing rubber-banding during play.
      const scroll = e.target && e.target.closest && e.target.closest('.pause-actions');
      if (this.paused && scroll) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    /* Prevent iOS rubber-banding / pull-to-refresh on the body. */
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';

    window.addEventListener('keydown', (e) => {
      if (document.getElementById('settings').classList.contains('on') || document.getElementById('shotLab').classList.contains('on')) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey ||
          (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))) return;
      if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') this.restart();
      if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') this.setPaused(!this.paused);
      if (e.key === 'F3') { this.settings.showDebug = !this.settings.showDebug; e.preventDefault(); }
      if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') { this.camReset(); e.preventDefault(); }
      if (e.key >= '1' && e.key <= '3') {
        this.setCameraPreset(CAMERA_ORDER[+e.key - 1]); e.preventDefault();
      }
      if (e.key === '0' || e.key === ')') { this.setCameraPreset(CAMERA_ORDER[0]); e.preventDefault(); }
    });
  }

  resize() {
    // renderScale — авто-экономия пикселей поверх выбранного качества
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.quality === 'low' ? 1.25 : 2) * (this.renderScale || 1);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.R.resize(w, h, dpr);
    this.vw = w; this.vh = h;
    /* Refit in the same tick: the pointer map inverts the camera that is
     * actually on screen, so a resize must never leave a stale projection
     * behind for even one frame of aiming. */
    if (this.camRig && this.settings) this.updateCamera(0);
  }

  /** Авто-масштаб рендера (0.6…1) от PerfMonitor: качество (quality) остаётся
   *  выбором игрока, мы меняем только реальное число пикселей за кадром. */
  setRenderScale(k) {
    const n = Number(k);
    const v = Number.isFinite(n) ? clamp(n, 0.6, 1) : 1;
    if (Math.abs(v - (this.renderScale || 1)) < 0.001) return this.renderScale;
    this.renderScale = v;
    this.resize();
    return v;
  }

  /* --------------------------- match flow -------------------------- */
  startMatch(diff) {
    this.endReplay(false); // cancel old callbacks; never complete an old match here
    this.moments.reset();
    if (this.inputLog && typeof this.inputLog.resetClock === 'function') this.inputLog.resetClock(this.time);
    this.shotJournal && this.shotJournal.reset();
    this.watchdog && this.watchdog.reset();
    this.lastMoment = null;
    this._acc = 0;
    this.followThrough.active = false;
    this.anticipation.active = false;
    this.audio.stopAudience();
    this._demoGesture = null;
    this.matchTasks = { topspin: 0, smash: 0, serves: 0, moments: 0 };
    this.training = null;
    /* Тренировка поднимает CAPTURE_FORGIVE до 1.55 и снимает его только в
     * complete()/quit(). Здесь учебник сбрасывается мимо них: без этой
     * строки свободная игра могла остаться с учебным захватом (×1.55 ко
     * всем осям) — мяч бьётся «дальше кольца» до самого конца сессии. */
    if (typeof setCaptureForgiveness === 'function') setCaptureForgiveness(1);
    this.matchWinner = 0;
    this._idleStill = false;           // витрина «ракетки на столе» — только в меню/лобби
    this.messages.length = 0;
    this.pointNote = null;
    this.slowmo.energy = 1; this.slowmo.on = false; this.slowmo.active = false;
    this.targetTimeScale = 1; this.timeScale = 1; this.slowmoUntil = 0;
    if (CAMERA_ORDER.indexOf(this.settings.camera) < 0) this.settings.camera = CAMERA_ORDER[0];
    this.resetPaddle(true);            // hard: the bat is placed, not glided
    this.ai.reset();
    this.analyst.reset();
    this.director.reset();
    this.director.enabled = this.settings.adaptive;
    this.pointNote = null;
    if (diff !== undefined) { this.settings.difficulty = diff; this.ai.setLevel(diff); }
    /* Адаптация работает ТОЛЬКО между матчами: значение посчитано до первого
     * мяча и внутри розыгрыша не меняется — резиновой сложности здесь нет. */
    this.ai.setTrend(this.aiTrend !== undefined ? this.aiTrend : this.trendFromHistory());
    // career: the chop perk slows the opponent, always from the base speed
    if (this.career.active && this._careerAISlowdown < 1) {
      this.ai.maxSpeed = this.ai.L.move * this._careerAISlowdown;
    }
    // career and online are scored modes: no bullet time there
    this.setSlowmoAllowed(!(this.career.active || this.network.isInMatch));
    this.score = [0, 0]; this.games = [0, 0];
    this.rally = 0; this.bestRally = 0;
    this.stats = { shots: 0, aiShots: 0, winners: 0, errors: 0, blocks: 0, edgeHits: 0, edgeBalls: 0,
      maxSpeed: 0, maxSpin: 0, byStroke: {}, totalSpin: 0, rallies: 0 };
    this.server = Math.random() < 0.5 ? 1 : -1;
    this.servesLeft = 2;
    this.audio.init(); this.audio.resume();
    if (!this._keepDemo) this.demoMode = false;
    this._keepDemo = false;
    this.prepServe();
    if (this.demoMode) {
      this.msg('РЕЖИМ НАБЛЮДЕНИЯ · БОТ ПРОТИВ БОТА', 3.0, '#39c6ff', true);
    } else {
      this.msg(this.server === 1 ? 'ВАША ПОДАЧА' : 'ПОДАЁТ СОПЕРНИК', 1.6, '#7fd4ff');
    }
  }
  startDemo(diff = 2) {
    this.career.stop();
    this.network.disconnect();
    this.freePlay = false;
    this._keepDemo = true;
    this.demoMode = true;
    this._demoPos = null;          // автопилот начинает наведение с чистого листа
    this.startMatch(diff);
  }
  stopDemo() {
    this.demoMode = false;
    this._demoGesture = null;
    this._demoPos = null;
    this.cancelInput && this.cancelInput();
    this.swipeReleasedAt = -Infinity;
  }
  restart() {
    if (this.state === GS.MENU || this.network.isInMatch ||
        (this.career.active && this.career.state !== 'MATCH')) return;
    this.startMatch(this.settings.difficulty);
  }

  returnToMenu() {
    this.endReplay(false);
    this.freePlay = false;
    this.stopTraining();
    this.career.save();
    this.career.stop();
    this.network.disconnect();
    this.stopDemo();
    this.audio.stopAudience();
    this.ball.live = false;
    this._acc = 0;
    this.cancelInput && this.cancelInput();
    this.setState(GS.MENU);
    this.setSlowmoAllowed(true);
    this.slowmo.on = false; this.slowmo.active = false;
    this.timeScale = this.targetTimeScale = 1; this.slowmoUntil = 0;
    this.saveSettings(); this.profile.save(true);
  }

  /* --------------------------- training ---------------------------- */
  get playerPaddleVisible() {
    return this.settings.showPlayerPaddle !== false &&
      (this.state === GS.MENU || (this.ui ? this.ui.inputMode !== 'touch' : this.pointerFine !== false));
  }
  startTraining(options = {}) {
    this.stopTraining();
    this.endReplay(false);
    this.shotJournal && this.shotJournal.reset();
    this.watchdog && this.watchdog.reset();
    this.career.stop();
    this.network.disconnect();
    this.demoMode = false;
    this.freePlay = false;
    this.setSlowmoAllowed(true);
    this.timeScale = this.targetTimeScale = 1; this.slowmoUntil = 0;
    this.resetPaddle(true);
    this.score = [0, 0]; this.rally = 0; this.bestRally = 0;
    this.matchWinner = 0;
    this.messages.length = 0;
    this.audio.init(); this.audio.resume();
    this.training = new Trainer(this, options);
    this.training.begin();
    this.ui && this.ui.trainShow(this.training);
    if (typeof document !== 'undefined' && document.body) document.body.classList.add('is-playing');
  }
  stopTraining() {
    if (this.training) this.training.quit();
    if (typeof document !== 'undefined' && document.body) document.body.classList.remove('is-playing');
  }

  setState(s) {
    const previous = this.state;
    this.state = s; this.stateT = 0; if (this.paused) this.setPaused(false);
    if (this.debugRecording && previous !== s) this.logInput('state_change', { outcome: { from: previous, to: s } });
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('is-playing', s !== GS.MENU && s !== GS.MATCH_END);
    }
  }

  /* Pause only makes sense during a live rally or serve prep; leaving the play
     state (restart, match end) always clears it so the overlay can't stick. */
  setPaused(v) {
    const play = this.state === GS.RALLY || this.state === GS.SERVE_READY ||
                 this.state === GS.SERVE_TOSS || this.state === GS.POINT;
    const wasPaused = !!this.paused, next = !!v && play;
    if (next && !wasPaused && this.debugRecording && typeof this.captureDiagnosticFrame === 'function') {
      try { this.captureDiagnosticFrame(); }
      catch (e) { this.diagnosticIssue('screenshot', e && e.message || e, e && e.stack); }
    }
    this.paused = next;
    if (this.paused && this.cancelInput) this.cancelInput('pause');
    if (this.debugRecording && wasPaused !== this.paused) this.logInput('pause', { outcome: { paused: this.paused, requested: !!v } });
    if (typeof document !== 'undefined' && document.body)
      document.body.classList.toggle('is-paused', this.paused);
  }

  msg(text, dur = 1.4, col = '#fff', big = false) {
    this.messages.push({ text, t: 0, dur, col, big });
    if (this.messages.length > 4) this.messages.shift();
  }

  /* --------------------------- serving ----------------------------- */
  prepServe() {
    const toss = STROKE_CONFIG.serve.toss;
    const s = this.server;
    const b = this.ball;
    const x = s > 0 ? 0 : rndSym(toss.readyXJitter);
    V3.set(b.p, x, PH.TABLE_Y + toss.readyHeight, s * (PH.T_HALF_LEN + toss.readyEndMargin));
    V3.zero(b.v); V3.zero(b.w); Q.identity(b.q);
    b.live = false; b.hist.length = 0; b.lastHitBy = 0; this.netTouched = false;
    b.trailGrade = null; b.golden = null;
    this.rallyBounces.length = 0;
    this.serveBounces = 0;
    this.isServeBall = true;
    this._footZ = PADDLE_STANCE_Z;
    if (this._cordForgiveUntil) {
      this._cordForgiveUntil = 0;
      if (typeof setCaptureForgiveness === 'function') {
        setCaptureForgiveness(Number.isFinite(this._cordBaseForgive) ? this._cordBaseForgive : 1);
      }
    }
    /* Every point begins from the same known state: bat back in the centre,
     * cursor binding re-anchored, no stale intercept from the last rally. */
    this.resetPaddle();
    if (s > 0) parkServeBall(b.p, this.player, this.settings.hand);
    this.setState(GS.SERVE_READY);
    this.audio.resetRally();
    this.recorder.begin(this.time, s);
    this.moments.beginRally(this.time, this.score);
    this.ai.setPressure(this.score[1], this.score[0], this.settings.targetScore);
    if (s < 0) {
      this.aiServeTimer = rnd(...toss.aiReadyDelay);
      /* точка подачи выбирается один раз на подачу — умеренно у края или
       * по центру, НИКОГДА с последней позиции розыгрыша */
      this.aiServeX = rndSym(toss.aiServeXJitter);
    }
  }
  startToss() {
    /* Not while the bat is still gliding home. The requirement is that every
     * new point starts from the centre, and a toss struck mid-glide is struck
     * from wherever the last rally happened to leave the bat — which is how
     * "the racket drifts off and stays there" survived the reset. The click is
     * NOT swallowed: it is queued and fired the instant the reset finishes, so
     * serving immediately costs a third of a second of the intermission. */
    if (this.recenterT > 0) { this.tossQueued = true; this.tossQueuedAt = this.time; return; }
    this.tossQueued = false;
    const b = this.ball;
    const pad = this.player;
    const toss = STROKE_CONFIG.serve.toss;
    // ITTF requires a near-vertical toss of at least 16 cm; we throw ~30 cm
    parkServeBall(b.p, pad, this.settings && this.settings.hand);
    /* Высота подброса из калибровки: 2.10..2.85 м/с throw (нейтраль 0.45 →
     * прежние ~2.45). Выше — больше времени на замах, ниже — быстрее темп. */
    const tossK = (this._cal && Number.isFinite(this._cal.tossHeight)) ? clamp(this._cal.tossHeight, 0, 1) : toss.calibrationDefault;
    V3.set(b.v, rndSym(toss.lateralJitter), toss.speed + tossK * toss.speedSpan + rnd(0, toss.speedJitter), rndSym(toss.lateralJitter));
    this.tossStartY = b.p.y;
    this.tossApex = b.p.y;
    V3.zero(b.w);
    b.live = true;
    this.isServeBall = true;
    this.setState(GS.SERVE_TOSS);
    this.audio.ui('toss');
  }

  /** How many reference pixels one centimetre at the meeting point is on THIS screen and camera:
   *  kx/ky = local px per cm ÷ MATCH_RULES.zoneRefPxPerCm. The contact gate multiplies its reference
   *  px by these, so it covers the same patch of space round the ball whatever the phone or preset. */
  contactGateScale(p, rect) {
    if (!p || MATCH_RULES.zoneScale !== 'world') return null;
    const W = rect && rect.width, H = rect && rect.height;
    if (!(W > 0) || !(H > 0)) return null;
    const c = this.project(p, {}); if (!c || !c.ok) return null;
    const cx = c.x, cy = c.y;
    const ax = this.project({ x: p.x + .05, y: p.y, z: p.z }, {}), ay = this.project({ x: p.x, y: p.y + .05, z: p.z }, {});
    if (!ax || !ax.ok || !ay || !ay.ok) return null;
    const pxX = Math.hypot((ax.x - cx) * W, (ax.y - cy) * H) / 5, pxY = Math.hypot((ay.x - cx) * W, (ay.y - cy) * H) / 5;
    if (!(pxX > 0) || !(pxY > 0)) return null;
    return { kx: pxX / MATCH_RULES.zoneRefPxPerCmX, ky: pxY / MATCH_RULES.zoneRefPxPerCmY, pxX, pxY };
  }

  /** Multi-anchor 3D post-bounce strike corridor for the current frame. */
  strikeCorridor() {
    const b = this.ball, pad = this.player;
    if (!b || !b.live || b.lastHitBy !== -1 || this.state !== GS.RALLY) return null;
    if (this._scFrame === this.frame && this._scTime === this.time) return this._sc;
    this._scFrame = this.frame; this._scTime = this.time;
    this._sc = solveStrikeCorridor(b, pad, this.rallyBounces, predict, {
      tableY: PH.TABLE_Y,
      stanceZ: PADDLE_STANCE_Z,
      minStepInZ: PADDLE_LIMITS.zStepIn,
      maxReachZ: PADDLE_LIMITS.zFar,
      allowVolley: !!(this.training && this.training.frozen),
    });
    return this._sc;
  }

  /** Promote an early-started serve swipe (begun in SERVE_READY or while the
   *  toss was still rising) once the ball crests its apex and enters the legal
   *  falling window. Never promotes horizontally off-line presses. */
  promotePendingServeZone() {
    const sw = this.swipe;
    const pz = sw && sw.pressZone;
    if (!pz || pz.accepted || !pz.pendingServeDrop) return false;
    if (this.state !== GS.SERVE_TOSS || this.server !== 1 || !this.ball || this.ball.lastHitBy !== 0) return false;
    const rise = this.tossRiseNow();
    if (!(this.ball.v && this.ball.v.y < 0 && rise >= MATCH_RULES.serveTossMinRise - 1e-6)) return false;
    pz.accepted = true;
    pz.reason = null;
    pz.pendingServeDrop = false;
    pz.tossRise = rise;
    if (this.shotJournal && typeof this.shotJournal.promotePress === 'function') {
      this.shotJournal.promotePress(sw.gestureId, pz);
    }
    return true;
  }

  /** Promote a deep low-started topspin backswing ONLY when it began on the
   *  ball's lateral line (`|across| <= 1.15 * sidePx`) and the active upward
   *  stroke physically sweeps inside the live 3D strike corridor. */
  promotePendingRallyBackswing(n) {
    const sw = this.swipe;
    const pz = sw && sw.pressZone;
    if (!pz || pz.accepted || !pz.pendingBackswing || !n) return false;
    if (this.state !== GS.RALLY || !this.ball || !this.ball.live || this.ball.lastHitBy !== -1 || pz.shotId !== this.shotId) return false;
    if (!sw.m || !(sw.m.dy < -0.04)) return false;
    const rect = this.canvas ? this.canvas.getBoundingClientRect() : { width: pz.vw || 390, height: pz.vh || 844 };
    const corridor = this.strikeCorridor();
    if (!corridor || !corridor.valid) return false;
    const liveZone = evaluateContactZone(
      corridor,
      this.ball,
      n,
      rect.width,
      rect.height,
      point => this.project(point, {}),
      point => this.contactGateScale(point, rect),
      {
        pointerType: pz.pointerType || 'touch',
        frozen: !!(this.training && this.training.frozen),
        referenceWorld: this.player && this.player.pos,
      }
    );
    if (!liveZone || !liveZone.accepted) return false;
    pz.accepted = true;
    pz.reason = null;
    pz.pendingBackswing = false;
    pz.x = liveZone.x; pz.y = liveZone.y;
    pz.worldTarget = liveZone.worldTarget;
    if (liveZone.worldTarget && Number.isFinite(liveZone.worldTarget.z)) {
      this._footZ = clamp(liveZone.worldTarget.z, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
    }
    if (this.shotJournal && typeof this.shotJournal.promotePress === 'function') {
      this.shotJournal.promotePress(sw.gestureId, pz);
    }
    return true;
  }

  /** Where (and in how long) the incoming ball meets the plane the bat stands
   *  on (or the multi-anchor strike corridor's primary intercept when the ball
   *  dies short of the baseline). One cached prediction per simulated frame. */
  contactPrediction() {
    const b = this.ball, pad = this.player;
    if (!b.live || b.lastHitBy !== -1 || !(b.v.z > .08 || (b.p.z > 0.15 && b.v.z > -0.35)) || this.state !== GS.RALLY) return null;
    if (this._cpFrame === this.frame && this._cpTime === this.time) return this._cp;
    this._cpFrame = this.frame; this._cpTime = this.time;
    const o = this._cpOut || (this._cpOut = {});
    o.reach = null;
    const stopPlane = Number.isFinite(this._footZ) ? clamp(this._footZ, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar) : pad.pos.z;
    predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
      { dt: PHYS_DT, maxT: 1.6, stopZ: stopPlane,
        stopDir: 1, stopAtPlane: true, out: o });
    if (o.reach && Number.isFinite(o.reachT)) {
      this._cp = { p: { x: o.reach.x, y: o.reach.y, z: o.reach.z }, t: o.reachT };
      return this._cp;
    }
    const sc = this.strikeCorridor();
    this._cp = sc && sc.valid && sc.primary
      ? { p: { x: sc.primary.x, y: sc.primary.y, z: sc.primary.z }, t: sc.primary.t }
      : null;
    return this._cp;
  }

  /* ---------------------------- scoring ---------------------------- */
  awardPoint(who, reason) {
    if (this.watchdog) this.watchdog.point();
    /* Гость в онлайне не ведёт счёт: хост единственный источник очков. Собственная
     * физика гостя может определить финал розыгрыша иначе и счёт разойдётся.
     * Гостю достаточно остановить мяч — следующий point-пакет синхронизирует счёт. */
    if (this.network.isInMatch && !this.network.isHost) {
      this.ball.live = false; this.ball.hist.length = 0;
      this.ball.trailGrade = null; this.ball.golden = null;
      return;
    }
    if (this.debugRecording) {
      this.logInput('point', { outcome: { winner: who, reason } });
      const press = this._debugLastPress;
      if (who < 0 && press && press.shotId === this.shotId && press.green && this.ball.lastHitBy === -1) {
        this.logInput('anomaly', { outcome: { reason: 'GREEN_PRESS_WITHOUT_RETURN', press,
          note: 'Observation only; inspect input, cancellation and physics_gate events for the cause.' } });
      }
    }
    if (this.training) {                 // drills have no score, only feedback
      if (this.shotJournal) this.shotJournal.point(who, reason, this.ball.lastHitBy, this.time);
      this.training.onFault(who, reason);
      this.ball.live = false;
      this.ball.hist.length = 0; this.ball.trailGrade = null; this.ball.golden = null;
      return;
    }
    if (this.state === GS.POINT || this.state === GS.MATCH_END) return;
    /* очко закончилось — шлейф мёртвого мяча умирает вместе с ним,
     * а не висит «мерзкой полосой» до следующей подачи */
    this.ball.hist.length = 0; this.ball.trailGrade = null; this.ball.golden = null;
    const idx = who > 0 ? 0 : 1;
    /* Свободная игра: мяч разыгрывается как обычно, но счёт не растёт —
     * партия не может закончиться, подача ротируется, розыгрыш идёт дальше. */
    if (!this.freePlay) this.score[idx]++;
    if (this.shotJournal) this.shotJournal.point(who, reason, this.ball.lastHitBy, this.time);
    const lh = this.ball.lastHitBy;
    this.stats.rallies++;
    this.lastPoint = { who, reason, at: this.time, seq: this.stats.rallies };
    this.buzz(who > 0 ? [14, 50, 22] : 42);
    if (this.rally > this.bestRally) this.bestRally = this.rally;
    if (who > 0) {
      if (lh === 1) this.stats.winners++;
    } else {
      const ownFault = lh === 1 || (this.isServeBall && this.server === 1 && lh === 0);
      if (ownFault) this.stats.errors++;
    }

    // why did that happen? one sentence, only when it helps
    this.lastSwipeLate = (this.time - this.lastSwipeT) > 0.75;
    this.pointNote = this.analyst.analyse(this.recorder, who, reason, this);
    if (this.pointNote && !this.training && this.ui) this.ui.showNote(this.pointNote);
    this.ai.onPointEnd(who);
    const h = this.director.onPoint(who, this.ai.levelIndex);
    this.ai.setHandicap(this.settings.adaptive ? h : 1);
    this.ai.setPressure(this.score[1], this.score[0], this.settings.targetScore);

    // serve rotation: every 2 points, every 1 from 10-10
    const deuce = this.score[0] >= this.settings.targetScore - 1 && this.score[1] >= this.settings.targetScore - 1;
    this.servesLeft--;
    if (deuce || this.servesLeft <= 0) { this.server = -this.server; this.servesLeft = deuce ? 1 : 2; }
    /* Онлайн-матч: хост всегда подаёт (подача гостя ещё не сведена, см. TODO),
     * поэтому после ротации подача всегда возвращается хосту. */
    if (this.network.isInMatch) { this.server = 1; this.servesLeft = 2; }

    this.audio.point(who > 0);
    /* Драма момента — текстом в том же баннере у табло и ростом толпы,
     * НЕ мусором в кадре: серия игрока, дьюс и матчбол названы явно. */
    const streak = this.director.streak;   // + = очки игрока подряд
    const tgt = this.settings.targetScore;
    const matchPoint = (this.score[0] >= tgt - 1 && this.score[0] > this.score[1]) ||
                       (this.score[1] >= tgt - 1 && this.score[1] > this.score[0]);
    let tag = '';
    if (matchPoint) tag = who > 0 ? ' · МАТЧБОЛ!' : ' · МАТЧБОЛ СОПЕРНИКА';
    else if (deuce) tag = ' · ДЬЮС';
    if (who > 0 && streak >= 3) {
      tag += ` · СЕРИЯ ×${streak}`;
      this.audio.applause(clamp(0.3 + (streak - 2) * 0.25, 0.3, 1.5));  // зал подхватывает серию
      this.audio.setCrowd(clamp(0.30 + streak * 0.10, 0, 0.9));
    }
    this.msg(reason + tag, 1.5, who > 0 ? '#6ee7a8' : '#ff8a8a', true);
    // the filter: keep this rally only if it is worth watching again
    this.lastMoment = this.moments.endRally(this.time, this, {
      winner: who, reason, score: this.score, target: this.settings.targetScore,
    });
    if (this.lastMoment && this.ui) this.ui.flashMoment(this.lastMoment, this.moments.kept.indexOf(this.lastMoment));
    this.setState(GS.POINT);
    this.shakeIt(0.5, V3.new(rndSym(1), 1, 0));

    const T = this.settings.targetScore;
    if ((this.score[0] >= T || this.score[1] >= T) && Math.abs(this.score[0] - this.score[1]) >= 2) {
      this.matchWinner = this.score[0] > this.score[1] ? 1 : -1;
    }
    // network: relay the point to the peer
    if (this.network.isInMatch) {
      this.network._send({ type: 'point', who, reason, score: this.score.slice() });
    }
    // career: the decisive perk arms itself on match point and pays out
    // on the player's next shot (see applyHit)
    if (this.career.active && this._careerDecisiveBoost > 0) {
      const isMatchPoint = (this.score[0] >= T - 1 && this.score[0] > this.score[1]) ||
                           (this.score[1] >= T - 1 && this.score[1] > this.score[0]);
      if (isMatchPoint) this._careerDecisiveActive = true;
    }
    this.ui && this.ui.syncScore();
  }

  /* ------------------------- ball <-> world ------------------------ */
  onBounce(side, speed, info) {
    if (this.ball.lastHitBy === 1 && this.shotJournal) this.shotJournal.bounce(side, this.time);
    if (!(info && info.edge > 0.25)) this.audio.hitTable(speed, this.ball.p.x);
    this.addMark(this.ball.p.x, this.ball.p.z, speed);
    this.emitParticles(this.ball.p.x, PH.TABLE_Y + 0.005, this.ball.p.z,
      4 + (speed > 9 ? 4 : 0), 0.5 + speed * 0.06, 0.26, 0.016, 1, 1, 0.92, { x: 0, y: 0.7, z: 0 });
    this.shakeIt(clamp(speed / 46, 0, 0.26), V3.new(0, 1, 0));

    const lh = this.ball.lastHitBy;
    this.rallyBounces.push(side);
    if (this.debugRecording) this.logInput('bounce', { outcome: { side, speed, lastHitBy: lh,
      edge: info && Number.isFinite(info.edge) ? info.edge : null } });
    this.recorder.addBounce(side, this.ball.p.x, this.ball.p.z, lh);
    if (this.watchdog) this.watchdog.tableContact({ time: this.time, side,
      edge: info && Number.isFinite(info.edge) ? info.edge : 0,
      edgeAxis: info && info.edgeAxis ? info.edgeAxis : null, speed });
    if (this.training) this.training.onBounce(side, lh);

    if (this.isServeBall) {
      this.serveBounces++;
      /* Before the strike `lastHitBy` is 0, and `-lh` is also 0 — which
       * `awardPoint` reads as "the AI won the point". A toss that bounced on
       * the server's own table (a fault) therefore gave the point to the AI
       * even when the AI was the server. Resolve 0 to the actual server. */
      const server = lh === 0 ? this.server : lh;
      if (this.serveBounces === 1) {
        if (side !== server) { this.awardPoint(-server, 'ОШИБКА ПОДАЧИ'); return; }
        if (lh === 0) { this.awardPoint(-server, 'ОШИБКА ПОДАЧИ'); return; }
      } else if (this.serveBounces === 2) {
        if (side !== -server) { this.awardPoint(-server, 'ОШИБКА ПОДАЧИ'); return; }
        if (this.netTouched) { this.letServe(); return; }
        this.isServeBall = false;      // serve is good, normal rally from here
        this.rallyBounces.length = 0;
        this.rallyBounces.push(side);  // ...and the receiver's half HAS been touched
      }
      return;
    }

    if (side === lh) {
      /* The ball bounced back onto the hitter's own half. If it had ALREADY
       * touched the opponent's court, that was a legal return and the
       * opponent failed to play it (ITTF 2.10.1): the point belongs to the
       * hitter, not against them. Only a ball that never crossed is a
       * 「did not go over」 fault. */
      const crossed = this.rallyBounces.filter((s) => s === -lh).length > 0;
      if (crossed) { this.awardPoint(lh, lh > 0 ? 'ОЧКО! СОПЕРНИК НЕ ДОСТАЛ' : 'ВЫ НЕ ДОСТАЛИ МЯЧ'); return; }
      this.awardPoint(-lh, lh > 0 ? 'МЯЧ НЕ ПЕРЕЛЕТЕЛ' : 'СОПЕРНИК НЕ ПЕРЕЛЕТЕЛ');
      return;
    }
    // second bounce on the receiver's side -> the receiver failed to return
    const onRecv = this.rallyBounces.filter((s) => s === -lh).length;
    if (onRecv >= 2) {
      this.awardPoint(lh, lh > 0 ? 'ОЧКО! СОПЕРНИК НЕ ДОСТАЛ' : 'ВЫ НЕ ДОСТАЛИ МЯЧ');
    }
  }

  /** A ball that has stopped on the table is out of play. Resolved by the
   *  same rule the floor uses: whoever failed to make the return loses. */
  settleDeadBall() {
    const b = this.ball, lh = b.lastHitBy;
    b.live = false;
    if (this.isServeBall) { this.awardPoint(-this.server, 'ПОДАЧА НЕ ВЫПОЛНЕНА'); return; }
    if (lh === 0) return;
    const onRecv = this.rallyBounces.filter((s) => s === -lh).length;
    if (onRecv >= 1) this.awardPoint(lh, lh > 0 ? 'ОЧКО! СОПЕРНИК НЕ ДОСТАЛ' : 'ВЫ НЕ ДОСТАЛИ МЯЧ');
    else this.awardPoint(-lh, lh > 0 ? 'МЯЧ НЕ ПЕРЕЛЕТЕЛ' : 'СОПЕРНИК НЕ ПЕРЕЛЕТЕЛ');
  }

  onFloor() {
    const lh = this.ball.lastHitBy;
    this.audio.hitFloor(V3.len(this.ball.v));
    if (this.state === GS.POINT || this.state === GS.MATCH_END) { this.ball.live = false; return; }
    if (this.isServeBall && this.serveBounces < 2) {
      this.awardPoint(-lh || -this.server, lh === 0 ? 'ПОДАЧА НЕ ВЫПОЛНЕНА' : 'ОШИБКА ПОДАЧИ');
      return;
    }
    const bouncedOnReceiver = this.rallyBounces.some((s) => s === -lh);
    if (!bouncedOnReceiver && lh !== 0) {
      const inNet = this.netTouched;
      this.awardPoint(-lh, inNet ? (lh > 0 ? 'В СЕТКУ' : 'СОПЕРНИК В СЕТКУ')
        : (lh > 0 ? 'АУТ' : 'СОПЕРНИК В АУТЕ'));
    } else {
      this.awardPoint(lh, lh > 0 ? 'ОЧКО!' : 'ОЧКО СОПЕРНИКУ');
    }
  }

  addMark(x, z, speed) {
    if (this.reducedMotion) return;
    this.marks.push({ x, z, t: 0, life: 1.5, s: clamp(0.05 + speed * 0.004, 0.05, 0.12) });
    if (this.marks.length > 14) this.marks.shift();
  }

  emitParticles(...args) {
    if (!this.reducedMotion) this.particles.burst(...args);
  }

  shakeIt(amount, dir) {
    if (this.reducedMotion) return;
    this.shake = Math.min(1.1, this.shake + amount);
    if (dir) V3.copy(this.shakeDir, V3.norm(dir, dir));
  }

  /* -------------------------- impact events ------------------------ */
  /* Grade the INPUT of the hit, not the stroke class:
   *  placeErr  = how far the press started from the ideal meeting point;
   *  timingErr = how far the fastest part of the swipe was from the contact.
   *  Green needs BOTH to be truly human-hard (≈<25 px, ≈<50 ms) — that is
   *  the shot that should (almost) always be a point. */
  hitInputGrade(metrics) {
    const pz = this.swipe.pressZone, S = this.swipe.samples;
    // A click is a deliberately simple return, not a failed swipe and not an
    // "ideal" power shot with its near-guaranteed winner bonus.
    const m = metrics || (this.swipe.active ? this.swipe.m : this.swipe.lastReleased);
    if (pz && pz.accepted && m && m.tap) return 'yellow';
    if (!pz || pz.accepted !== true || !Number.isFinite(pz.distancePx) || !S || S.length < 3) return 'red';
    let peak = 0, peakT = null;
    for (let i = 1; i < S.length; i++) {
      const dt = S[i].t - S[i - 1].t;
      if (dt <= 0) continue;
      const v = Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y) / dt;
      if (v > peak) { peak = v; peakT = S[i].t; }
    }
    const timingErr = peakT === null ? 1 : Math.abs(this.time - peakT);
    const placeErr = pz.distancePx;
    /* "идеальное движение" на мыши и на пальце — это не 50 мс ровно. Окна
     * подняты до стабильно программируемых значений: зелёный — ≈<60 мс и
     * ≈<26 px, жёлтый — ≈<140 мс и ≈<48 px. Механика награды не меняется:
     * зелёный всё так же почти всегда гол, просто стал достижимым. */
    if (placeErr <= 26 && timingErr <= .06) return 'green';
    if (placeErr <= 48 && timingErr <= .14) return 'yellow';
    return 'red';
  }

  applyHit(side, racket, contactP, quality, info) {
    if (side === 1) {
      if (this.demoMode) { b_gradeAssign(this, null); }
      else {
        const grade = this.hitInputGrade(racket.contactInput && racket.contactInput.gesture);
        b_gradeAssign(this, grade);
        if (grade === 'green' && !this.training)
          this.msg('ИДЕАЛЬНО!', 1.1, '#7CFF9E');
      }
    } else { b_gradeAssign(this, null); }
    function b_gradeAssign(g2, grade) {
      g2.ball.trailGrade = grade;
      g2.ball.golden = (grade === 'green' && !g2.training && Math.random() < 0.88) ? 'win' : null;
    }
    if (side < 0 && this.shotJournal) this.shotJournal.returned(this.time);
    const b = this.ball;
    b.lastHitBy = side;
    this._hitSeq = (this._hitSeq || 0) + 1;   // сторож: в этом подшаге контакт был
    this.shotId++;                       // the opponent reacts once per shot
    this.rallyBounces.length = 0;
    this.netTouched = false;
    // career perks act on the player's own shots: the chosen boosts scale
    // speed/spin right after the impact resolves, before anything reads them
    if (side > 0 && this.career.active) {
      const sid = (racket.stroke && racket.stroke.id) || 'DRIVE';
      let vm = this._careerSpeedBoost;
      let wm = this._careerSpinBoost;
      if (sid === 'LOOP' || sid === 'DRIVE' || sid === 'SMASH' || sid === 'COUNTER') wm *= this._careerTopspinBoost;
      if (sid === 'PUSH' || sid === 'CHOP') wm *= this._careerBackspinPenalty;
      if (sid === 'SMASH') vm *= this._careerSmashBoost;
      if (sid === 'COUNTER') vm *= this._careerCounterBoost;
      if (sid === 'CHOP') wm *= this._careerChopBoost;
      if (sid === 'HOOK' || sid === 'FADE' || sid === 'SIDE' || sid === 'SERVE_SIDE') b.w.y *= this._careerSidespinBoost;
      if (this._careerDecisiveActive) { vm *= 1 + this._careerDecisiveBoost; this._careerDecisiveActive = false; }
      if (vm !== 1) { b.v.x *= vm; b.v.y *= vm; b.v.z *= vm; }
      if (wm !== 1) { b.w.x *= wm; b.w.y *= wm; b.w.z *= wm; }
    }
    if (!this.isServeBall) {
      this.rally++;
      if (!this.training && !this.demoMode) this.audio.onRallyHit(this.rally, side);
    }

    // Difficulty belongs to OpponentAI's launch solver. Clamping velocity
    // here invalidated its legal serves after they had already been solved.

    const speed = V3.len(b.v), spin = V3.len(b.w);
    const name = racket.stroke ? racket.stroke.id : 'DRIVE';
    if (side > 0) {
      this.stats.shots++;
      this.stats.totalSpin += spin / TAU;
      if (speed * 3.6 > this.stats.maxSpeed) this.stats.maxSpeed = speed * 3.6;
      if (spin / TAU > this.stats.maxSpin) this.stats.maxSpin = spin / TAU;
      this.stats.byStroke[name] = (this.stats.byStroke[name] || 0) + 1;
    } else {
      this.stats.aiShots = (this.stats.aiShots || 0) + 1;
    }

    /* an off-centre contact sounds like wood, not like rubber */
    const softHit = !!(racket.arch && racket.arch.soft) || (side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.38);
    this.audio.hitRacket(speed, info ? info.contactSlip : 0, softHit);
    if (side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.30) this.buzz(16);
    if (this.feedback) {
      this.feedback.execute({
        quality: quality ?? 0.8,
        speed,
        spin: b.w,
        stroke: racket.stroke,
        contactPoint: contactP,
        side,
        skipBaseHitAudio: true,
        skipBaseHaptic: true,
      });
    }
    /* Контактная вспышка = ВЕРДИКТ ввода (зелёный/жёлтый/красный), как и
     * шлейф. Фирменный цвет удара (stroke.col: оранжевый топспин, синяя
     * подрезка) отсюда удалён — именно он рисовал «синий при свайпе вниз,
     * оранжевый при свайпе вверх» и конфликтовал с языком вердиктов.
     * Сам всплеск частиц теперь гаснет в матчах: салют ровно в точке, куда
     * игрок смотрит, — чистая помеха. В ОБУЧЕНИИ он остаётся: там учитель
     * должен отмечать контакт. */
    const vg = side > 0 ? this.ball.trailGrade : null;
    const col = vg === 'green' ? [0.18, 1.0, 0.42]
      : vg === 'yellow' ? [1.0, 0.80, 0.16]
      : vg === 'red' ? [1.0, 0.13, 0.12] : [0.92, 0.94, 0.97];
    if (this.training) {
      this.emitParticles(contactP.x, contactP.y, contactP.z,
        side > 0 ? 14 : 9, 0.7 + speed * 0.05, 0.32, 0.019, col[0], col[1], col[2],
        { x: -racket.normal.x * 0.6, y: -racket.normal.y * 0.6, z: -racket.normal.z * 0.6 });
    }

    if (side > 0) {
      this.hitFlash = Math.min(this.hitFlash + 0.55, 1);   // периферия, не точка контакта
      this.lastShotInfo = {
        stroke: racket.stroke, speed: speed * 3.6, spin: spin / TAU,
        topspin: -b.w.x * side, sidespin: b.w.y, quality,
        power: racket.power, t: this.time,
        contact: racket.contact, elev: racket.elev,
        timing: side > 0 ? (this.lastTiming || '') : '',
        sweet: side > 0 ? (this.lastSweet !== undefined ? this.lastSweet : 1) : 1,
        rim: side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.42,
      };
      if (this.shotJournal) this.shotJournal.capture(this.swipe.gestureId, this.time,
        { ...racket, quality }, b, { grip: this.settings.grip, hand: this.settings.hand, shotId: this.shotId });
      this.ui && this.ui.showShot(this.lastShotInfo);
      this.recorder.addShot(1, Object.assign({
        x: contactP.x, y: contactP.y, z: contactP.z, quality,
      }, this.lastShotInfo));
      if (this.training) this.training.onPlayerHit(this.lastShotInfo, racket, contactP);
      this.moments.addContact(this.time, {
        by: 1, stroke: (racket.stroke && racket.stroke.id) || '?',
        speed: speed * 3.6, spin: spin / TAU, quality,
      });
      const sid = racket.stroke && racket.stroke.id;
      if (sid === 'LOOP' || sid === 'COUNTER') this.matchTasks.topspin++;
      else if (sid === 'SMASH') this.matchTasks.smash++;
      else if (sid === 'SERVE_TOP' || sid === 'SERVE_SIDE' || sid === 'SERVE_FAST' || sid === 'SERVE_BACK') this.matchTasks.serves++;
      this.buzz(Math.round(lerp(8, 26, clamp(speed / 90, 0, 1))));
      this.shakeIt(clamp(speed / 55, 0.03, 0.38) * 0.45, V3.new(rndSym(0.4), 0.5, 1));
      if (this.settings.slowmoOnBigShots && speed * 3.6 > 92) this.punchSlowmo(0.42, 0.26);
      // refresh the landing preview
      if (this.settings.showPredict) {
        predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
          { dt: 1 / 240, maxT: 2.4, stopOnFirstBounce: true, out: this.predictOut, path: this.predictPath });
      }
    } else {
      this.shakeIt(clamp(speed / 90, 0.02, 0.18), V3.new(rndSym(0.4), 0.4, -1));
      this.recorder.addShot(-1, {
        stroke: racket.stroke, speed: speed * 3.6, spin: spin / TAU,
        topspin: b.w.x, sidespin: b.w.y, quality, t: this.time,
        contact: racket.contact, elev: racket.elev,
        x: contactP.x, y: contactP.y, z: contactP.z,
        slip: !!(this.ai.lastShot && this.ai.lastShot.slip),
      });
      this.ui && this.ui.showAiShot(racket.stroke);
      this.moments.addContact(this.time, {
        by: -1, stroke: (racket.stroke && racket.stroke.id) || '?',
        speed: speed * 3.6, spin: spin / TAU, quality,
      });
    }
  }

  punchSlowmo(scale, dur) {
    this.targetTimeScale = scale;
    this.slowmoUntil = this.time + dur;
  }

  /* ------------------------- player slow-mo ------------------------ *
   * Bullet time for the player, and only for the player. It is a
   * reaction aid, not a way to win: the ball slows, but so does the
   * opponent's racket and your own swing window, so the shot you
   * produce is the shot you produce. It is switched off entirely in
   * career tournaments and online matches, where the score counts. */
  setSlowmoHold(v) {
    const S = this.slowmo;
    if (v && !this.slowmoAvailable()) return;
    S.on = !!v;
    if (S.on && !S.active) this.audio.slowIn && this.audio.slowIn();
  }

  slowmoAvailable() {
    const S = this.slowmo;
    return this.settings.slowmoPlayer !== false && S.allowed && !this.training &&
      (this.state === GS.RALLY || this.state === GS.SERVE_TOSS || this.state === GS.SERVE_READY);
  }

  updateSlowmo(dtReal) {
    const S = this.slowmo;
    const want = S.on && this.slowmoAvailable() && S.energy > 0.015;
    if (want) {
      S.energy = Math.max(0, S.energy - dtReal * 0.40);     // ~2.5 s from full
      S.used += dtReal;
    } else {
      S.energy = Math.min(1, S.energy + dtReal * 0.09);     // ~11 s to refill
      S.on = S.on && S.energy > 0.015;                      // ran dry → release
    }
    if (this.inspectSlowmo &&
      (this.state === GS.RALLY || this.state === GS.SERVE_TOSS || this.state === GS.SERVE_READY)) {
      /* Глубина разбора из калибровки: 0.55 (мягко) .. 0.12 (почти стоп-кадр),
       * нейтраль 0.60 → прежние 0.30. Боевое слоу-мо не трогаем. */
      const depth = (this._cal && Number.isFinite(this._cal.slowmoDepth))
        ? lerp(0.55, 0.12, clamp(this._cal.slowmoDepth, 0, 1)) : 0.30;
      S.active = true; this.targetTimeScale = depth; return;
    }
    S.active = want;
    if (want) { this.targetTimeScale = 0.34; this.slowmoUntil = 0; }
    else if (!this.slowmoUntil) this.targetTimeScale = 1;
  }

  /* Инспекторское замедление: свободный тумблер «разобрать траекторию
   * удара». В отличие от боевого слоу-мо не тратит энергию и не отпускает
   * само; работает в розыгрыше и на подаче, между розыгрышами скорость
   * обычная. Честность та же, что у боевого режима: allowed=false
   * (карьерные турниры, онлайн) закрывает и этот переключатель. */
  setInspectSlowmo(on) {
    const ok = this.slowmo && this.slowmo.allowed && !(this.network && this.network.isInMatch);
    this.inspectSlowmo = !!on && ok;
    if (this.debugRecording) this.logInput('slowmo', { outcome: { requested: !!on, enabled: this.inspectSlowmo, allowed: !!ok } });
    return this.inspectSlowmo;
  }

  /** Career tournaments and online matches call this with false. */
  setSlowmoAllowed(v) { this.slowmo.allowed = !!v; if (!v) { this.setSlowmoHold(false); this.inspectSlowmo = false; } }

  /* --------------------------- settings ---------------------------- */

  changePaddlePreference(key, value) {
    const choices = { hand: ['left', 'right'], grip: ['shakehand', 'penhold'] };
    if (!choices[key] || !choices[key].includes(value)) return false;
    if (this.settings[key] === value) return true;
    this.settings[key] = value;
    if (this.paddleMotion) this.paddleMotion.reset();
    if (this.followThrough) this.followThrough.active = false;
    if (this.swipe) this.swipe.cancel();
    this.pointerDown = false; this.swipeReleasedAt = -Infinity;
    this._prep = 0; this.liveStroke = null; this._settlePaddleFace = true;
    this.player.forehand = paddleForehand(this.player.pos.x, this.settings.hand);
    return true;
  }

  /** Save personal preferences, never private versions of control rules. */
  saveSettings() {
    if (!this.profile) return;
    const s = this.settings;
    this.profile.data.settings = {
      rulesVersion: MATCH_RULES.version, difficulty: s.difficulty, quality: s.quality,
      sound: s.sound, volume: s.volume, camera: s.camera, camZoom: s.camZoom, camPitch: s.camPitch,
      hand: s.hand, grip: s.grip,
      showTrail: s.showTrail, showPredict: s.showPredict,
      showTele: s.showTele, haptics: s.haptics, coach: s.coach, adaptive: s.adaptive,
      targetScore: s.targetScore,
      spinBias: s.spinBias, spinGain: s.spinGain, arcSens: s.arcSens,
    };
    if (this.career && this.career.active && this.career._baseSettings)
      this.profile.data.settings.difficulty = this.career._baseSettings.difficulty;
    this.profile.touch();
  }

  loadSettings() {
    if (!this.settings || !this.profile || !this.profile.data.settings) return false;
    const raw = this.profile.data.settings, s = this.settings;
    // Only known keys cross the save boundary. Never merge arbitrary keys/prototypes.
    for (const k of Object.keys(s)) {
      if (typeof s[k] === 'boolean' && typeof raw[k] === 'boolean') s[k] = raw[k];
    }
    // camZoom/camPitch mirror CAM_ADJUST.zoomMin..Max / pitchMin..Max — keep in sync.
    const ranges = { difficulty: [0, 3], volume: [0, 1], camZoom: [0.6, 1.8], camPitch: [-16, 16], spinGain: [0.5, 1.6], arcSens: [0.6, 1.8] };
    for (const [k, [lo, hi]] of Object.entries(ranges)) {
      if (Number.isFinite(raw[k])) s[k] = clamp(raw[k], lo, hi);
    }
    s.difficulty = Math.round(s.difficulty);
    for (const [k, values] of Object.entries({ quality: ['low', 'medium', 'high'],
      camera: CAMERA_ORDER, hand: ['left', 'right'], grip: ['shakehand', 'penhold'], spinBias: ['low', 'norm', 'high'], targetScore: [5, 11, 21] })) {
      if (values.includes(raw[k])) s[k] = raw[k];
    }
    if (this.settings.volume !== undefined) this.audio.setVolume(this.settings.volume);
    if (this.settings.sound === false) this.audio.setMuted(true);
    if (this.settings.difficulty !== undefined) this.ai.setLevel(this.settings.difficulty);
    if (this.settings.quality) this.R.quality = this.settings.quality;
    if (raw.rulesVersion !== MATCH_RULES.version || ['hitZone', 'assist', 'posAssist', 'sensitivity', 'showZone'].some(k => Object.prototype.hasOwnProperty.call(raw, k)))
      this.saveSettings(); // one-way migration: never re-persist private control rules
    return true;
  }

  setDifficulty(idx) {
    /* Уровень приходит из UI и оболочки — иногда строкой; мусор не должен
     * записать в профиль NaN и оставить бота без уровня. */
    const n = Math.round(Number(idx));
    this.settings.difficulty = Number.isFinite(n)
      ? clamp(n, 0, AI_LEVELS.length - 1)
      : this.settings.difficulty;
    this.ai.setLevel(this.settings.difficulty);
    this.saveSettings();
    return this.settings.difficulty;
  }

  /* ------------------------- difficulty trend ---------------------- */
  /** Адаптация бота между матчами: −1 (игрок всё проигрывает) … +1 (выигрывает).
   *  Внутри розыгрыша не меняется никогда; WTF ограничен ±2 % внутри AI. */
  setAiTrend(v) {
    this.aiTrend = clamp(Number(v) || 0, -1, 1);
    this.ai.setTrend(this.aiTrend);
    return this.aiTrend;
  }

  /** Тренд из последних матчей своего профиля (автономное меню движка). */
  trendFromHistory() {
    const d = this.profile && this.profile.data;
    const h = d && Array.isArray(d.aiHistory) ? d.aiHistory.slice(-10) : [];
    if (h.length < 3) return 0;
    const w = h.reduce((n, x) => n + (x ? 1 : 0), 0), l = h.length - w;
    return clamp((w - l) / h.length, -1, 1);
  }

  /* --------------------------- equipment --------------------------- */

  /** Paddle materials for the equipped racket. Cached: the workshop is a
   *  menu, not a per-frame cost. The faces stay red and black (ITTF 2.04.8
   *  — a bat must have two differently coloured faces), and what the shop
   *  sells is the frame: the wood, the grip and the shade. */
  paddleMats(S, eq) {
    const e = eq || this.equip;
    if (!e) return null;
    const c = e.colours;
    const key = e.bladeId + '|' + e.fhId + '|' + e.bhId + '|' + (e._tintKey || '');
    this._eqCache = this._eqCache || {};
    if (this._eqCache[key]) return this._eqCache[key];
    const ma = S.mat;
    const tint = (col, base, k) => [0, 1, 2].map((i) => base.color[i] * (1 - k + k * col[i] * 2.2));
    this._eqMats = {
      wood: Object.assign({}, ma.bladeWood, {
        color: tint(c.wood, ma.bladeWood, 0.85),
        emissive: [0.055 * c.wood[0], 0.042 * c.wood[1], 0.028 * c.wood[2]],
      }),
      grip: Object.assign({}, ma.handle, { color: tint(c.grip, ma.handle, 0.8) }),
      red: Object.assign({}, ma.rubberRed, { color: tint(c.fore, ma.rubberRed, 0.22) }),
      black: Object.assign({}, ma.rubberBlack, { color: tint(c.back, ma.rubberBlack, 0.22) }),
    };
    this._eqCache[key] = this._eqMats;
    return this._eqMats;
  }

  /** Pull the fitted racket out of the profile and into the physics. */
  applyEquipment() {
    const e = this.profile ? this.profile.data.equip : { blade: 'b_base', fh: 'r_base', bh: 'r_base' };
    this.equip.set(e.blade, e.fh, e.bh);
    return this.equip;
  }

  /* ---------------------------- replay ----------------------------- */

  /** Play a recorded moment. `after` runs when the clip ends or is skipped. */
  watchMoment(moment, hero, after) {
    if (!moment) return false;
    this.setSlowmoHold(false);
    this.ball.live = true;
    if (!this.replayer.play(moment, hero ? 0.35 : 0.5, () => this.endReplay())) return false;
    this.replayAfter = after || null;
    const back = this.state;
    this.replayFrom = back === GS.MATCH_END ? GS.MATCH_END : GS.POINT;
    this.setState(GS.REPLAY);
    if (typeof document !== 'undefined') {
      document.body.classList.add('is-reel');
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
    }
    this.ui && this.ui.replayShow(true, moment, !!hero);
    this.audio.applause(hero ? 1.4 : 0.6);
    if (this.profile) this.profile.taskProgress('replay', 0, 1);
    this.analytics && this.analytics.send('replay:watch', { shots: moment.shots, speed: Math.round(moment.speed), hero: !!hero });
    return true;
  }

  skipReplay() {
    if (!this.replayer.on) return;
    this.replayer.finish();
  }

  endReplay(complete = true) {
    this.replayer.stop();
    this.ui && this.ui.replayShow(false);
    if (typeof document !== 'undefined') document.body.classList.remove('is-reel');
    this.camFov = undefined;
    if (this.state === GS.REPLAY) {
      this.ball.live = false;
      this.setState(this.replayFrom || GS.POINT);
    }
    const cb = this.replayAfter;
    this.replayAfter = null;
    if (complete && cb) cb();
  }

  /** Everything that has to be written down when the last point lands. */
  settleMatch() {
    if (this.demoMode) { this.lastReward = null; return; }
    const won = this.matchWinner > 0;
    const p = this.profile;
    if (!p) return;
    const res = p.onMatchEnd(won, this.score, this.stats, this.moments.kept.length);
    /* История для адаптации между матчами — копится здесь, читается в
     * startMatch (trendFromHistory). Больше 10 матчей не держим. */
    if (p.data) {
      const h = Array.isArray(p.data.aiHistory) ? p.data.aiHistory : (p.data.aiHistory = []);
      h.push(won ? 1 : 0);
      if (h.length > 10) h.splice(0, h.length - 10);
      /* Локальный лог телеметрии бота — для балансировки уровней без сервера:
       * уровень, ошибки (сетка/длинные), скорость ответа, давление, удары.
       * Храним последние 20 матчей; читается в отчёте диагностики (aiLog). */
      const log = Array.isArray(p.data.aiLog) ? p.data.aiLog : (p.data.aiLog = []);
      log.push({ t: Date.now(), won, score: this.score.join('-'), rally: this.bestRally,
        diff: this.ai.levelIndex, ai: this.ai.telemetry() });
      if (log.length > 20) log.splice(0, log.length - 20);
    }
    p.taskProgress('topspin', 0, this.matchTasks.topspin >= 10 ? 10 : 0);
    p.taskProgress('smash', 0, this.matchTasks.smash >= 3 ? 3 : 0);
    p.taskProgress('serves', 0, this.matchTasks.serves >= 5 ? 5 : 0);
    if (this.bestRally >= 8) p.taskProgress('rally8', 0, 1);
    this.analytics && this.analytics.send('match:end', {
      won, score: this.score.join('-'), rally: this.bestRally, shots: this.stats.shots,
      moments: this.moments.kept.length, level: p.data.level, session: Math.round(this.analytics.sessionSec),
      /* Телеметрия бота по уровням: без неё балансировка WTF/EASY — гадание. */
      ai: this.ai.telemetry(),
    });
    this.lastReward = res;
    this.ui && this.ui.refreshMenuBits && this.ui.refreshMenuBits();
  }

  /** After the final point: a short reel of the best rally, then the score. */
  playBestMoments() {
    const m = this.moments.best;
    if (!m) return false;
    return this.watchMoment(m, true, null);
  }

  /* ----------------- continuous collision: ball vs paddle ---------- */
  sweepPaddle(pad, p0, p1, radius) {
    const n = pad.normal;
    const d0 = (p0.x - pad.prevPos.x) * n.x + (p0.y - pad.prevPos.y) * n.y + (p0.z - pad.prevPos.z) * n.z;
    const d1 = (p1.x - pad.pos.x) * n.x + (p1.y - pad.pos.y) * n.y + (p1.z - pad.pos.z) * n.z;
    const R = PH.R;
    if (d0 > R && d1 <= R) {
      const t = clamp((d0 - R) / Math.max(d0 - d1, 1e-9), 0, 1);
      const cx = lerp(p0.x, p1.x, t), cy = lerp(p0.y, p1.y, t), cz = lerp(p0.z, p1.z, t);
      const px = lerp(pad.prevPos.x, pad.pos.x, t), py = lerp(pad.prevPos.y, pad.pos.y, t), pz = lerp(pad.prevPos.z, pad.pos.z, t);
      const ex = cx - px, ey = cy - py, ez = cz - pz;
      const dn = ex * n.x + ey * n.y + ez * n.z;
      const rx = ex - n.x * dn, ry = ey - n.y * dn, rz = ez - n.z * dn;
      const rad = Math.hypot(rx, ry, rz);
      if (rad <= radius) return { t, x: cx, y: cy, z: cz, rad, px, py, pz };
    }
    return null;
  }

  /* ------------------------------ step ----------------------------- */
  stepPhysics(dt) {
    const b = this.ball;
    if (this._cordForgiveUntil && this.time >= this._cordForgiveUntil) {
      this._cordForgiveUntil = 0;
      if (typeof setCaptureForgiveness === 'function') setCaptureForgiveness(this._cordBaseForgive || 1);
    }
    if (!b.live) return;
    // a ball that has run out of energy settles instead of micro-bouncing
    if (b.p.y - PH.R <= PH.TABLE_Y + 0.004 && Math.abs(b.v.y) < 0.30 &&
      Math.abs(b.p.x) <= PH.T_HALF_WID && Math.abs(b.p.z) <= PH.T_HALF_LEN) {
      b.restT = (b.restT || 0) + dt;
      if (b.restT > 0.9 || V3.len(b.v) < 0.45) {
        if (this.state === GS.POINT || this.state === GS.MATCH_END) { b.live = false; return; }
        /* The ball came to rest ON the table during a rally. Nothing else
         * would ever resolve it: no bounce, no floor, no point — the rally
         * hung with a motionless ball until the player left the match.
         * `restT` (0.9 s of sitting on the table), not the instantaneous
         * speed: a short ball still trickling at 0.3 m/s is a ball the
         * player can and should be able to run in and flick, and the old
         * speed test killed exactly those. */
        if ((this.state === GS.RALLY || this.state === GS.SERVE_TOSS) && b.restT > 0.9) { this.settleDeadBall(); return; }
      }
    } else b.restT = 0;
    const p0 = V3.clone(b.p);

    integrateBall(b.p, b.v, b.w, dt);
    Q.integrate(b.q, b.q, spinVisualRate(b.w, this._spinVis || (this._spinVis = V3.new())), dt);
    b.speed = V3.len(b.v);

    /* --- table --- */
    /* tableContact() is the same function predict() runs: it rejects a ball
     * that was already below the surface at the start of the step and it
     * returns the INTERPOLATED touch point, not the end of the step. At
     * 30 m/s the end of a 1/600 s step is 5 cm past the line, which is how a
     * ball that landed inside the line got recorded outside it. */
    if (b.v.y < 0) {
      const tb = tableContact(p0.x, p0.y, p0.z, b.p.x, b.p.y, b.p.z, this._tabHit || (this._tabHit = { x: 0, y: 0, z: 0 }));
      if (tb) {
        const sp = -b.v.y;
        b.p.x = tb.x; b.p.y = tb.y + 1e-5; b.p.z = tb.z;
        /* The white line is physics now (bounceTable tilts the contact normal
         * outward and takes a third of the restitution off). The old handler
         * did its own thing on top of it — v.y *= 0.45 and rndSym(1.2) m/s of
         * sideways velocity — so the effect was applied twice and, worse, the
         * same shot gave a different answer every time. An edge ball should be
         * unreadable for the RECEIVER, not random for the game. */
        const info = bounceTable(b.p, b.v, b.w);
        if (info && info.edge > 0.25) {
          /* FIX «прилипает на кромке и трещит»: мяч с остаточной скоростью
           * елозил по белой линии и давал контакт рёбра на КАЖДОМ подшаге
           * (240 Гц) — ребро-звук повторялся серией, мяч полз как по рельсе.
           * Настоящий шарик с рёбра стола СКАЧЕТ прочь: решительный подхват
           * вверх + выталкивание из полосы кромки устраняют повторные
           * контакты физически, а событие-эффект защёлкнут на 0.45 с. */
          b.v.y = Math.max(b.v.y, 0.55);
          if (info.edgeAxis === 'x') b.p.x += Math.sign(b.p.x || 1) * 0.003;
          else b.p.z += Math.sign(b.p.z || 1) * 0.003;
          if (this.time - (this._edgeFxT || -9) > 0.45) {
            this._edgeFxT = this.time;
            this.audio.hitEdge();
            this.msg(info.edgeAxis === 'x' ? 'РЕБРО СТОЛА!' : 'ЗАДНЯЯ КРОМКА!', 1.0, '#ffd34d');
            this.shakeIt(0.10 + 0.16 * info.edge, V3.new(0, 1, 0));
            this.stats.edgeBalls = (this.stats.edgeBalls || 0) + 1;
          }
        }
        this.onBounce(Math.sign(b.p.z) || 1, sp, info);
      }
    }

    /* --- net --- */
    /* netContactStep() is the same model predict() and every solver use:
     * 0 clean, 1 mesh, 2 white tape. A ball whose whole body is under the
     * table passes BENEATH the net — the plane used to reflect it, so a ball
     * that had already fallen off the table bounced off an invisible wall. */
    const nk = netContactStep(p0.x, p0.y, p0.z, b.p.x, b.p.y, b.p.z,
      this._netHit || (this._netHit = { x: 0, y: 0, z: 0 }));
    if (nk > 0) {
      const nh = this._netHit;
      if (nk === 2) {
        clipTape(b.p, b.v, b.w);
        this.audio.hitNet();
        this.msg('СЕТКА — ШНУР!', 1.1, '#ffd34d');
        this.emitParticles(nh.x, PH.NET_TOP, 0, 8, 1.1, 0.3, 0.014, 1, 0.9, 0.5);
        this.netTouched = true;
        if (b.lastHitBy === 1 && this.shotJournal) this.shotJournal.net();
        /* Шнур — не сухой лотерейный аут, а отыгрываемая драма: короткий
         * буллет-тайм (0.5×, 0.35 с) и временно расширенное окно приёма
         * (×1.5 на 0.9 с), чтобы обе стороны имели честный шанс вытащить
         * «счастливый» мяч. Базовый forgive восстанавливается в stepPhysics. */
        this.punchSlowmo(0.5, 0.35);
        if (typeof getCaptureForgiveness === 'function' && typeof setCaptureForgiveness === 'function') {
          if (!(this._cordForgiveUntil > this.time)) {
            this._cordBaseForgive = getCaptureForgiveness();
          }
          setCaptureForgiveness(this._cordBaseForgive * 1.5);
          this._cordForgiveUntil = this.time + 0.9;
        }
        this.buzz([12, 22, 12]);
      } else {
        bounceNet(b.p, b.v, b.w, Math.sign(p0.z) || 1);
        this.audio.hitNet();
        this.emitParticles(nh.x, nh.y, 0, 7, 0.7, 0.3, 0.013, 0.8, 0.85, 1);
        this.netTouched = true;
        if (b.lastHitBy === 1 && this.shotJournal) this.shotJournal.net();
        this.moments.addBounce(true);
      }
    }

    /* --- floor --- */
    if (b.p.y - PH.R <= 0.0 && b.v.y < 0) {
      b.p.y = PH.R;
      impactSphere(b.v, b.w, N_UP, ZERO3, PH.E_FLOOR, PH.MU_FLOOR, 0);
      this.onFloor();
      if (V3.len(b.v) < 0.6) b.live = false;
    }

    /* --- out of bounds safety --- */
    if (Math.abs(b.p.x) > 9 || Math.abs(b.p.z) > 11 || b.p.y > 9) {
      b.live = false;
      // The ball escaped the arena without ever reaching the floor check that
      // normally resolves a point (a wide or sky-high shot). Award the point so
      // the rally state can't hang forever with a dead ball.
      if (this.state === GS.RALLY) {
        const lh = b.lastHitBy;
        if (lh !== 0) {
          const onRecv = this.rallyBounces.filter((s) => s === -lh).length;
          if (onRecv === 0) this.awardPoint(-lh, lh > 0 ? 'АУТ' : 'СОПЕРНИК В АУТЕ');
          else this.awardPoint(lh, lh > 0 ? 'ОЧКО! СОПЕРНИК НЕ ДОСТАЛ' : 'ВЫ НЕ ДОСТАЛИ МЯЧ');
        }
      }
    }

    this._trailCrumb(b);

    /* --- paddles (CCD) --- */
    if (this.time - this.player.lastHitT > 0.09) this.tryPlayerHit(p0);
    else this.debugRecording && this.diagnosticPhysicsGate('hit_cooldown', { elapsedReal: this.time - this.player.lastHitT, requiredReal: .09 });

    this.watchdogSubstep(p0);
  }

  /** net touch on a service: no point, the serve is simply taken again. */
  letServe() {
    if (this.training) { this.training.onLet(); return; }
    this.msg('ПЕРЕИГРОВКА (LET)', 1.4, '#9fd0ff');
    this.audio.ui();
    this.ball.live = false;
    this.lastPoint = null;
    this.setState(GS.POINT);
    this.stateT = 0.35;              // short pause, nothing is scored
  }

  updateShotDiagnostics() {
    const journal = this.shotJournal, sw = this.swipe;
    if (!journal || !sw) return;
    journal.expire(this.time, this.strokeTime);
    if (![GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY].includes(this.state)) return;
    const m = sw.active ? sw.m : sw.lastReleased;
    if (!m || m.samples < 2) return;
    const serving = this.state === GS.SERVE_TOSS || this.state === GS.SERVE_READY;
    const forehand = (this.player.pos.x * (this.settings.hand === 'left' ? -1 : 1)) >= -.05;
    const ctx = { side: 1, isServe: serving, ball: this.ball.p, ballSpin: this.ball.w,
      grip: this.settings.grip, forehand, ballSpeed: this.ball.speed || V3.len(this.ball.v), movePitch: -.15,
      spinGain: this.settings.spinGain ?? 1, arcSens: this.settings.arcSens ?? 1 };
    const r = isRealStroke(m, serving) ? deriveStroke(m, ctx) : null;
    const lastSample = sw.samples[sw.samples.length - 1];
    const heldStroke = sw.active && sw.realGestureId === sw.gestureId;
    journal.observe(sw.gestureId, m, { time: this.time, isServe: serving, active: sw.active,
      sampleTime: heldStroke ? sw.realAt : sw.active && lastSample ? lastSample.t : this.swipeReleasedAt,
      sampleSimTime: heldStroke ? sw.realAtSim : sw.active ? sw.sampleSimTime : sw.releaseSimTime,
      simTime: this.strokeTime, windowSec: serving ? 1.15 : heldStroke ? 2.5 : sw.active ? .18 : .25,
      strokeId: r && r.stroke.id });
  }

  logInput(type, extra = {}) {
    if (!this.inputLog || typeof makeInputLogEvent !== 'function') return null;
    const event = makeInputLogEvent(this, type, extra);
    if (!event) return null;
    if (this.debugRecording && typeof diagnosticSnapshot === 'function') {
      try {
        event.debug = diagnosticSnapshot(this);
        if (extra.dom) event.dom = extra.dom;
      } catch (e) {
        // Diagnostics must not break the input or physics path they observe.
        this._diagnosticInternalError = typeof diagErrorText === 'function' ? diagErrorText(e && e.stack || e) : String(e);
      }
    }
    this.inputLog.record(event);
    if (this.debugRecording && this.debugArchive) this.debugArchive.add(event);
    if ((type === 'pointerdown' || type === 'contact') && this.moments &&
        typeof this.moments.addInputDecision === 'function')
      this.moments.addInputDecision(event.t, event.decision, event.outcome, event.inputType);
    return event;
  }

  logSwipeRelease(extra = {}) {
    const sw = this.swipe || {}, zone = sw.pressZone;
    const serving = !!(zone && zone.serving), released = sw.lastReleased;
    const valid = isRealStroke(released, serving);
    const age = this.time - sw.startT, slop = zone && zone.pointerType === 'mouse' ? 10 : 14;
    return this.logInput('pointerup', { ...extra, outcome: { released: true, contact: false,
      recognized: valid ? (released.tap ? 'tap' : 'swipe') : 'none',
      reason: valid ? null : 'STATIC_CLICK', tapDurationGameSeconds: Number.isFinite(age) ? age : null,
      tapDurationEventMs: zone && extra.dom && Number.isFinite(zone.domTimestamp) && Number.isFinite(extra.dom.timestamp)
        ? Math.max(0, extra.dom.timestamp - zone.domTimestamp) : null,
      tapMaxDuration: .35, tapMovePx: Number.isFinite(sw.tapMaxMovePx) ? sw.tapMaxMovePx : null,
      tapSlopPx: slop, sameShot: !!(zone && zone.shotId === this.shotId),
      pressAccepted: zone ? !!zone.accepted : null } });
  }

  setDiagnosticMode(on) {
    on = !!on;
    if (on === !!this.debugRecording) return on;
    if (on && typeof DiagnosticArchive !== 'undefined') {
      if (!this.debugArchive || this.debugArchive.status === 'unavailable') {
        this.debugArchive = new DiagnosticArchive(diagnosticSessionId());
        // The ordinary 30-second ring can still provide pre-enable context,
        // though only events recorded after enabling have detailed snapshots.
        for (const event of this.inputLog.events(this.time)) this.debugArchive.add(event);
      } else this.debugArchive.start();
    }
    this.debugRecording = on;
    if (this.ui) this.ui.captureDebug = on;
    this.logInput('diagnostics', { outcome: { enabled: on } });
    if (!on && this.debugArchive) this.debugArchive.stop();
    return on;
  }

  diagnosticIssue(kind, message, stack = '') {
    if (typeof diagErrorText !== 'function') return;
    const issue = { kind: diagErrorText(kind, 100), message: diagErrorText(message),
      stack: diagErrorText(stack, 4000), wallMs: Date.now(), gameSeconds: this.time };
    const list = this._diagnosticErrors || (this._diagnosticErrors = []);
    list.push(issue); if (list.length > 100) list.shift();
    if (this.debugRecording) this.logInput('runtime_error', { outcome: issue });
  }

  // Opening an existing session does not turn recording back on. It lets the
  // pause UI restore the last bookmarked frame even after recording was
  // stopped and the page reloaded, before a report has been prepared.
  diagnosticRecoveryArchive() {
    if (!this.debugArchive && typeof DiagnosticArchive !== 'undefined') {
      try {
        const previous = sessionStorage.getItem(DIAGNOSTIC_SESSION_KEY);
        if (previous) { this.debugArchive = new DiagnosticArchive(previous); this.debugArchive.stop(); }
      } catch (e) {}
    }
    return this.debugArchive || null;
  }

  async diagnosticReport() {
    if (this.debugRecording) this.logInput('report_requested', { outcome: { paused: !!this.paused } });
    this.diagnosticRecoveryArchive();
    const archived = this.debugArchive ? await this.debugArchive.read() : [];
    const current = this.inputLog ? this.inputLog.events(this.time) : [];
    const byId = new Map();
    for (const e of archived.concat(current)) byId.set(`${e.instance}:${e.seq}`, e);
    const events = Array.from(byId.values());
    const archive = this.debugArchive;
    const safeSettings = {};
    for (const key of ['difficulty', 'quality', 'camera', 'camZoom', 'camPitch', 'hand', 'grip',
      'spinGain', 'arcSens', 'showTrail', 'showPredict', 'targetScore', 'adaptive']) safeSettings[key] = this.settings[key];
    const calibration = {};
    for (const key of ['camHeight', 'camZoom', 'camSway', 'padSpeed', 'padSmooth', 'ballSize', 'trailLen',
      'tableGlow', 'flytime', 'hintRadius', 'spinGain', 'arcSens'])
      if (this._cal && Number.isFinite(this._cal[key])) calibration[key] = this._cal[key];
    return { format: 'topspin-diagnostics', version: DIAGNOSTIC_VERSION, createdAt: new Date().toISOString(),
      sessionId: archive ? archive.sessionId : null,
      privacy: 'Local only. No automatic transmission. Review before sharing; contains device details, input coordinates and game state.',
      recording: { enabled: !!this.debugRecording, memory: this.inputLog && this.inputLog.stats(this.time),
        recovery: { status: archive ? archive.status : 'not_enabled', error: archive && archive.error,
          pendingDropped: archive ? archive.dropped : 0, chunksPrunedThisInstance: archive ? archive.pruned : 0,
          bookmarkedFrame: archive ? archive.frameStatus : 'unavailable', frameError: archive && archive.frameError || null,
          maxChunks: 64, maxEventsPerChunk: 256, flushIntervalSeconds: 3 },
        events: events.length, firstWallMs: events.length ? events[0].wallMs : null,
        lastWallMs: events.length ? events[events.length - 1].wallMs : null, includesPreEnableSummary: true,
        note: 'Memory and recovery are capped; older events may be overwritten. A crash may lose the last unflushed batch.' },
      environment: diagnosticEnvironment(this), settings: safeSettings, calibration,
      rules: typeof MATCH_RULES !== 'undefined' ? MATCH_RULES : null,
      graceRules: typeof GRACE_RULES !== 'undefined' ? GRACE_RULES : null,
      physics: typeof PH !== 'undefined' ? PH : null,
      current: diagnosticSnapshot(this), errors: (this._diagnosticErrors || []).slice(),
      diagnosticInternalError: this._diagnosticInternalError || null,
      /* Последние 20 матчей с телеметрией бота: по ним видно, ошибается ли
       * WTF, жива ли сетка/длинная ошибка и какова сила ответа по уровням. */
      /* Сторож физики: тикеты по пяти классам геймплейных багов, счётчики
       * и гейты самопроверки. Читается без разбора 20 МБ событий. */
      watchdog: this.watchdog ? this.watchdog.report() : null,
      aiLog: (this.profile && this.profile.data && this.profile.data.aiLog) || [],
      /* Цена кадра по подсистемам и текущий авто-масштаб: по этому блоку
       * видно, тормозит ли телефон из-за рендера, физики или оболочки. */
      perf: this.perf && typeof this.perf.snapshot === 'function' ? this.perf.snapshot() : null,
      shots: this.shotJournal ? this.shotJournal.exportData().records : [], events };
  }

  captureDiagnosticFrame(bookmark = false) {
    if (!this.canvas || !this.R || !this.R.gl || this.R.gl.isContextLost()) throw new Error('WebGL context unavailable');
    if (!this.canvas.width || !this.canvas.height) throw new Error('Empty game canvas');
    // The drawing buffer is not preserved. Draw and copy immediately in the
    // same task, before the browser clears it. No DOM/shell controls are in it.
    this.render();
    const out = document.createElement('canvas'); out.width = this.canvas.width; out.height = this.canvas.height;
    const ctx = out.getContext('2d'); if (!ctx) throw new Error('2D canvas unavailable');
    ctx.drawImage(this.canvas, 0, 0);
    if (this.ui && this.ui.fx && this.ui.fx.width && this.ui.fx.height)
      ctx.drawImage(this.ui.fx, 0, 0, out.width, out.height);
    const result = { dataUrl: out.toDataURL('image/png'), capturedAt: new Date().toISOString(),
      gameSeconds: this.time, state: this.state, width: out.width, height: out.height,
      includes: 'game WebGL and 2D canvases only; shell DOM/scoreboard omitted' };
    this._diagnosticFrame = result;
    if (bookmark && this.debugArchive) this.debugArchive.saveFrame(result);
    if (this.debugRecording) this.logInput('frame_captured', { outcome: { ...result, dataUrl: undefined, bookmark: !!bookmark } });
    return result;
  }

  pressConsumed() {
    const sw = this.swipe;
    return !!(sw && !sw.pressZone && Number.isFinite(sw.consumedGestureId) &&
      sw.consumedGestureId === sw.gestureId);
  }

  /** One diagnostic decision per shot/gesture/reason. tryPlayerHit runs on
   * physics substeps, so unguarded logging would drown the 30 s ring. */
  logPressRejection(reason, detail = {}) {
    if (typeof PRESS_REJECTION_REASONS === 'undefined' || !PRESS_REJECTION_REASONS.includes(reason)) return null;
    const sw = this.swipe || {}, b = this.ball || {};
    const seen = this._pressRejectionLogKeys || (this._pressRejectionLogKeys = new Set());
    if (seen.size > 512) seen.clear();
    const key = [this.shotId || 0, Number.isFinite(sw.gestureId) ? sw.gestureId : 0,
      Number.isFinite(b.lastHitBy) ? b.lastHitBy : 0,
      Array.isArray(this.rallyBounces) ? this.rallyBounces.join(',') : '', reason].join('|');
    if (seen.has(key)) return null;
    seen.add(key);
    return this.logInput('decision', { outcome: { contact: false, ...detail, reason } });
  }

  logNoStrokeIntent(serving = false) {
    const sw = this.swipe, b = this.ball, pad = this.player;
    if (!sw || !b || !pad || !b.p || !pad.pos) return null;
    const ownBounce = Array.isArray(this.rallyBounces) && this.rallyBounces.some(side => side > 0);
    if (!serving && !ownBounce) return null;
    if (serving && b.v && b.v.y >= 0) return null; // no legal serve contact opportunity yet
    const inRange = typeof playerInCaptureRange === 'function' && playerInCaptureRange(b.p, pad.pos, serving);
    const passed = Number.isFinite(b.p.z) && Number.isFinite(pad.pos.z) &&
      b.p.z > pad.pos.z + MATCH_RULES.depthTolerance;
    if (!inRange && !passed) return null;
    if (this.debugRecording && passed && sw.active && sw.pressZone && sw.pressZone.accepted &&
        sw.pressZone.pressContactable && !isRealStroke(sw.m, serving)) {
      const key = `${this.shotId}:${sw.gestureId}`;
      if (this._debugHeldPastWindow !== key) {
        this._debugHeldPastWindow = key;
        this.logInput('anomaly', { outcome: { reason: 'GREEN_PRESS_HELD_PAST_CAPTURE',
          note: 'The stationary press is not a tap until release; this records an observation, not a root cause.' } });
      }
    }
    const releasedAt = Number.isFinite(this.swipeReleasedAt) ? this.swipeReleasedAt : -Infinity;
    const releasedAge = this.strokeAge(sw.releaseSimTime, releasedAt);
    const deadWin = serving ? 1.15 : .25;
    if (!sw.active && isRealStroke(sw.lastReleased, serving) && releasedAge >= deadWin)
      return this.logPressRejection('TIMING_EARLY', { releasedAgeMs: (this.time - releasedAt) * 1000, simulationAgeMs: releasedAge * 1000 });
    const heldWin = serving ? 1.15 : 2.5;
    const staleHeld = sw.active && sw.gestureId === sw.realGestureId &&
      this.strokeAge(sw.realAtSim, sw.realAt || 0) >= heldWin;
    const noGesture = !sw.active && !sw.lastReleased && !(sw.samples && sw.samples.length);
    if (staleHeld || noGesture) return this.logPressRejection('NO_FRESH_SWIPE');
    return null;
  }

  logNoContactReason(captureSample, serving = false) {
    if (serving || !this.ball || !this.player || !this.ball.p || !this.ball.v || !this.player.pos) return null;
    const b = this.ball, pad = this.player;
    const dz = b.p.z - pad.pos.z;
    const separating = (b.p.x - pad.pos.x) * b.v.x + (b.p.y - pad.pos.y) * b.v.y + dz * b.v.z;
    /* A ball that has reached the blade's depth band and is already leaving
     * is a miss on EITHER side of the depth tolerance. The old guard demanded
     * `dz > depthTolerance`, so a lateral miss that happened exactly at the
     * blade's depth (|dz| <= tolerance) produced no code at all — those are
     * the "admitted press vanished without a reason" reports. Once the ball
     * is past the bat there is always something to say: lateral → TIMING_LATE,
     * depth → DEPTH_FAIL. While it is still approaching, stay silent. */
    if (!(dz > -MATCH_RULES.depthTolerance) || !(separating > 0)) return null;
    const lateral = captureSample && Number.isFinite(captureSample.lateral)
      ? captureSample.lateral : Math.hypot(b.p.x - pad.pos.x, b.p.y - pad.pos.y);
    const depthGap = captureSample && Number.isFinite(captureSample.depthGap)
      ? captureSample.depthGap : Math.abs(dz);
    return lateral <= MATCH_RULES.captureRadius
      ? this.logPressRejection('DEPTH_FAIL', { depthGap, lateral })
      : this.logPressRejection('TIMING_LATE', { depthGap, lateral });
  }

  tossRiseNow() {
    return typeof serveTossRise === 'function'
      ? serveTossRise(this.tossApex, this.tossStartY, PH.TABLE_Y) : NaN;
  }

  /** Direction is judged at the contact candidate, from the whole gesture:
   * an early backswing segment may still be moving away from the ball. This
   * can only reject an admitted press; it can never admit an outside one. */
  validatePressDirection(m) {
    const pz = this.swipe && this.swipe.pressZone;
    if (!pz || !pz.accepted || !m) return this.pressAdmitsBall();
    if (m.tap === true) return true;
    if (pz.directionOk === true) return true;
    if (pz.directionOk === false) return false;
    if (![pz.x, pz.y, pz.pointerX, pz.pointerY, m.dx, m.dy].every(Number.isFinite)) return true;

    if (pz.anchor === 'contact') {
      const ok = evaluateStrokeDirection(pz, m);
      pz.directionOk = ok;
      if (!ok) {
        pz.accepted = false; pz.reason = 'WRONG_DIRECTION';
        if (this.shotJournal && typeof this.shotJournal.rejectPress === 'function')
          this.shotJournal.rejectPress(this.swipe.gestureId, 'WRONG_DIRECTION', pz);
        this.logInput('decision', { outcome: { contact: false, reason: 'WRONG_DIRECTION' } });
      }
      return ok;
    }

    const toBallX = pz.x - pz.pointerX, toBallY = pz.y - pz.pointerY;
    const swipeX = m.dx * (pz.vw > 0 ? pz.vw : 1), swipeY = m.dy * (pz.vh > 0 ? pz.vh : 1);
    const dist = Math.hypot(toBallX, toBallY), len = Math.hypot(swipeX, swipeY);
    if (dist < 4) { pz.directionDot = 1; pz.directionOk = true; return true; }
    if (!(len > 1e-9)) return false;
    const dot = (swipeX * toBallX + swipeY * toBallY) / (len * dist);
    const fast = Math.hypot(m.dx, m.dy) > 0.16;
    const dotLimit = pz.pointerType === 'mouse' ? -0.3 : (fast ? -0.12 : 0);
    pz.directionDot = dot; pz.directionOk = dot > dotLimit;
    if (!pz.directionOk) {
      pz.accepted = false; pz.reason = 'WRONG_DIRECTION';
      if (this.shotJournal && typeof this.shotJournal.rejectPress === 'function')
        this.shotJournal.rejectPress(this.swipe.gestureId, 'WRONG_DIRECTION', pz);
      this.logInput('decision', { outcome: { contact: false, reason: 'WRONG_DIRECTION' } });
    }
    return pz.directionOk;
  }

  /* ==== Край ракетки: физика срезанного контакта ========================
   * Не ассист и не решатель цели: отдельная маленькая модель «царапины».
   * Грань смотрит вверх-вперёд (царапина почти всегда открыта), скорость из
   * реальной скорости биты и скорости жеста, капитально срезанная, с
   * случайным разворотом на несколько градусов и битым вращением. Для
   * подачи пара (подъём, скорость) добирается из честной таблицы, пока
   * симуляция не подтвердит легальную подачу — «мяч не подаётся, хотя в
   * реальности подался бы» больше не бывает. Для розыгрыша карабкание не
   * нужно: срезанный мяч честно летит куда ушёл (иногда в сетку/за стол —
   * это увидено и объяснимо, в отличие от беззвучного промаха). */
  _glanceRacket(m, contact, isServe, sideParams) {
    const R = GRACE_RULES, b = this.ball;
    const pv = this.player.vel ? V3.len(this.player.vel) : 0;
    const swipeSpd = m && Number.isFinite(m.releaseSpeed) ? m.releaseSpeed * 1.9
      : m && Number.isFinite(m.peakSpeed) ? m.peakSpeed * 1.9 : 0;
    const carry = clamp(Math.max(pv, swipeSpd) * R.padVelK, R.minCarryMs, R.maxCarryMs);
    const rand = () => (Math.random() * 2 - 1);
    const lat = m ? clamp(m.right || 0, -1, 1) * 0.55 : 0;
    const mkNormal = () => {
      /* грань царапины: вверх и на чужую половину + пара градусов дрейфа */
      const yaw = rand() * R.scatterYawRad, pit = rand() * R.scatterPitchRad;
      const n = V3.new(lat * 0.30, R.upNormal + pit, -R.fwdNormal);
      const yx = n.x * Math.cos(yaw) - n.z * Math.sin(yaw);
      const yz = n.x * Math.sin(yaw) + n.z * Math.cos(yaw);
      n.x = yx; n.z = yz;
      return V3.norm(n, n);
    };
    const rubber = sideParams || {};
    const strokeRef = { id: 'BLOCK', family: 'BLOCK' };
    if (isServe) {
      const serve = STROKE_CONFIG.serve, glance = serve.glance;
      /* Таблица добора: первые же легальные пары обычно в центре диапазона,
       * так что средняя царапня-подача — это недорезанный мяч едва через
       * сетку, а не пуля и не фол. */
      for (let li = 0; li <= glance.steps; li++) for (let si = 0; si <= glance.steps; si++) {
        const lift = lerp(...glance.liftMs, li / glance.steps);
        const spd = lerp(...glance.speedMs, si / glance.steps);
        /* тосс сбоку тянем обратно к столу, иначе боковая царапня уходит
         * в белую линию или вылетает за боковушку */
        const vR = V3.new(clamp(-contact.x * glance.counterAim + lat * 0.35, -.7, .7), lift, -spd);
        const n = mkNormal();
        const v = V3.clone(b.v), w = V3.clone(b.w);
        if (!impactRacket(v, w, n, vR, R.quality, rubber)) continue;
        const p0 = V3.addScaled(V3.clone(contact), contact, n, PH.R * STROKE_CONFIG.racket.launchSeparation);
        const o = predict(p0, v, w, { dt: glance.coarseDt, maxT: serve.solver.maxT, stopAfterBounces: 2, out: {} });
        if (o.landed && !o.hitNet && !o.diverged &&
            o.landed.z > 0 && Math.abs(o.landed.x) <= PH.T_HALF_WID + glance.courtMargin &&
            o.b2 && o.b2.z < 0 && o.b2.z >= -PH.T_HALF_LEN - glance.courtMargin &&
            Math.abs(o.b2.x) <= PH.T_HALF_WID + glance.courtMargin) {
          return { normal: n, vR, vmag: V3.len(vR), quality: R.quality, valid: true,
            stroke: strokeRef, rubber: { ...rubber }, sweet: 0, timing: .5, glance: true,
            azSwing: lat * .3, azFace: lat * .3, elev: 25, faceElev: 25 };
        }
      }
      /* ничего не подошло (тосс улетел над сеткой и т.п.) — всё равно бей,
       * но коротко и честно: пусть это будет видимый недолёт, а не тишина */
      const n = mkNormal();
      return { normal: n, vR: V3.new(lat * .6, 1.45, -3.3), vmag: 3.6, quality: R.quality,
        valid: false, stroke: strokeRef, rubber: { ...rubber }, sweet: 0, timing: .5,
        glance: true, azSwing: 0, azFace: 0, elev: 24, faceElev: 24 };
    }
    // розыгрыш: срезанный возврат с приоритетом «через сетку, мягко»
    const n = mkNormal();
    const vR = V3.new(lat * 0.9, carry * 0.62 + 0.6, -carry);
    b.w.x += rand() * R.scatterSpin * .5;
    b.w.z += rand() * R.scatterSpin;   // боковое битое вращение — фирменный признак края
    return { normal: n, vR, vmag: V3.len(vR), quality: R.quality, valid: true,
      stroke: strokeRef, rubber: { ...rubber }, sweet: 0, timing: .5, glance: true,
      azSwing: lat * .3, azFace: lat * .3, elev: 30, faceElev: 30 };
  }

  /* ==== Видимость вращения: крошка-шлейф раскрашивает дугу ================
   * Кручёный мяч у настоящего тенниса читается по дуге. У нас дуга
   * физически ЕСТЬ (Магнус на w), но на 40-мм шарике не видна. Каждые
   * ~29 мс живой полёт роняет неподвижную, нетяжёлую крошку (grav=0,
   * v=0, 0.5 с затухания): верхнее — оранжевое, нижнее — голубое, боковое —
   * зелёное; плоская пуля быстрее 8.5 м/с — седой шлейф. Без вращения и на
   * малой скорости — ничего: обычный обмен остаётся чистым. */
  _trailCrumb(b) {
    if (this.reducedMotion || !this.particles || typeof this.particles.spawn !== 'function') return;
    /* Цветная крошка — второй носитель закрутки (первый — шевроны). В матче
     * оба выключены: на скорости это бусины поверх траектории, которые
     * спорят с главным сигналом — зелёным мячом. Тип закрутки в матче
     * читается в строке удара. Крошка остаётся в тренировке и свободном
     * полёте, где дугу разбирают намеренно. */
    if (!this.training && !this.freePlay) return;
    if (this.time - (this._crumbT || -1) < 0.029) return;
    const measured = measureShotSpin(b.w, b.v);
    const spinTopBack = -measured.topRps * TAU, spinSide = measured.sideRps * TAU;
    const spinMag = Math.hypot(spinTopBack, spinSide);
    const spd = b.speed || 0;
    let r, g, bl;
    if (Math.abs(spinSide) > Math.abs(spinTopBack) && Math.abs(spinSide) > 55) { r = .22; g = .88; bl = .42; }
    else if (spinTopBack < -55) { r = 1; g = .48; bl = .18; }
    else if (spinTopBack > 55) { r = .30; g = .82; bl = 1; }
    else if (spd > 8.5) { r = .62; g = .66; bl = .75; }
    else return;
    this._crumbT = this.time;
    this.particles.spawn(b.p.x, b.p.y, b.p.z, 0, 0, 0, 0.5, 0.011 + spd * 0.0004, r, g, bl, 0);
  }

  /* ==== Пассивный блок «стенка» ==========================================
   * Держим палец — держим ракетку. Без замаха жеста мяч в честном боксе
   * отражается от почти неподвижной грани: низкое качество контакта,
   * никакого ассиста цели, направление — куда смотрит лицо. Это не сильный
   * удар (мяч всплывает), а спасательный — успевший защитник получает
   * продолжение розыгрыша вместо «мяч пролетел сквозь биту». */
  _tryPassiveBlock(pad, b) {
    if (!this.swipe || !this.swipe.active) return false;          // только «держание»
    if (b.lastHitBy === 1) return false;
    /* Гейт «стенки»: этот жест должен был хотя бы раз классифицироваться
     * реальным замахом (рука осознанно подвела ракетку к мячу). Пока held-окно
     * живо, такой жест отбивается обычным путём; «стенка» достаёт паркующуюся
     * за его пределами руку. Голый тап — samples≈1, path≈0, realGestureId не
     * выставлен — мяч отражать не имеет права: браузерный тест «тап без
     * движения не бьёт» это формально запрещает. */
    if (this.swipe.realGestureId !== this.swipe.gestureId) return false;
    if (!this.pressAdmitsBall()) return false;
    if (!playerInCaptureRange(b.p, pad.pos, false)) return false; // честный бокс, не кольцо края
    if (!this.rallyBounces.some((s) => s > 0)) return false;      // ITTF: сначала свой отскок
    const closing = (b.p.x - pad.pos.x) * b.v.x + (b.p.y - pad.pos.y) * b.v.y + (b.p.z - pad.pos.z) * b.v.z;
    if (closing > 0.05) return false;                             // мяч уже уходит
    const n = V3.norm(V3.new(), pad.normal);
    if (n.x * b.v.x + n.y * b.v.y + n.z * b.v.z > 0) return false; // грань отвернута от мяча
    const gripped = playerWristPose(pad.pos, pad.vel, this.settings.hand, { grip: this.settings.grip, forehand: pad.forehand });
    const rubber = this.equip ? (this.equip.forSide(gripped.forehand ? 1 : -1) || {}) : {};
    const vR = V3.mul(V3.new(), pad.vel || V3.new(), 0.4);
    vR.z -= 0.9;                                    // лёгкий выпад навстречу — «стенка» живая
    const v0 = V3.clone(b.v), w0 = V3.clone(b.w);
    const info = impactRacket(b.v, b.w, n, vR, 0.30, rubber);
    if (!info) { V3.copy(b.v, v0); V3.copy(b.w, w0); return false; }
    V3.addScaled(b.p, b.p, n, PH.R * 0.6);          // отлепить от грани для CCD следующего шага
    b.lastHitBy = 1;
    this.shotId++;
    this._hitSeq = (this._hitSeq || 0) + 1;   // «стенка» — тоже контакт для сторожа
    this.rallyBounces.length = 0;
    this.netTouched = false;
    if (!this.isServeBall) {
      this.rally++;
      if (!this.training && !this.demoMode && this.audio && this.audio.onRallyHit) this.audio.onRallyHit(this.rally, 1);
    }
    this.swipe.consumedGestureId = this.swipe.gestureId;
    this.swipe.consumedAt = this.time;
    this.swipe.pressZone = null;
    pad.lastHitT = this.time;
    pad.swing = 1;
    const motion = this.paddleMotion || (this.paddleMotion = new PaddleStrokeMotion());
    motion.contact(n, pad.roll || 0, 'BLOCK', this.settings.grip, this.settings.hand,
      gripped.forehand, this.settings.followThrough !== false);
    if (this.audio && this.audio.hitRacket) this.audio.hitRacket(V3.len(b.v) + 1.5, 0.5, true);
    this.msg('СТЕНКА!', 0.7, '#9fd0ff');
    this.buzz([4, 12]);
    this.emitParticles(b.p.x, b.p.y, b.p.z, 5, 0.5, 0.25, 0.010, 0.62, 0.82, 1);
    if (this.stats) {
      this.stats.blocks = (this.stats.blocks || 0) + 1;
      this.stats.shots = (this.stats.shots || 0) + 1;
      if (this.stats.byStroke) this.stats.byStroke.BLOCK = (this.stats.byStroke.BLOCK || 0) + 1;
    }
    if (this.shotJournal && typeof this.shotJournal.noteOutcome === 'function')
      this.shotJournal.noteOutcome('BLOCK');
    if (this.training) {
      const racket = { stroke: STROKES.BLOCK, arch: ARCH.BLOCK, normal: n, vR, quality: .30,
        rubber, contactInput: { p: V3.clone(pad.pos), v: v0, w: w0, gesture: { ...this.swipe.m } } };
      if (this.shotJournal) this.shotJournal.capture(this.swipe.gestureId, this.time, racket, b, { shotId: this.shotId });
      this.training.onPlayerHit({ stroke: STROKES.BLOCK, quality: .30, power: 0 }, racket, b.p);
    }
    this.logInput('contact', { outcome: { contact: true, route: 'passive_block',
      distanceM: V3.dist(b.p, pad.pos) } });
    return true;
  }

  /* Пост-верификация итогового удара игрока: та же идея, что у AI
   * (_flightLegal), но с игровой стороны стола. Решатель при ассисте <1
   * может вернуть формально valid удар, который в физике идёт в сетку или
   * обратно в свою половину — для игрока это выглядит как «удар не туда».
   * Проверяем одним лёгким прогоном predict (удар — событие редкое, дешевле
   * чем кадр рендера). */
  _playerFlightLegal(contact, racket, isServe) {
    if (!racket || racket.valid === false || !racket.normal || !racket.vR) return false;
    const b = this.ball;
    const v = V3.clone(b.v), w = V3.clone(b.w);
    if (!impactRacket(v, w, racket.normal, racket.vR, racket.quality ?? .5, racket.rubber || {})) return false;
    const p = V3.addScaled(V3.clone(contact), contact, racket.normal, PH.R * STROKE_CONFIG.racket.launchSeparation);
    const validation = isServe ? STROKE_CONFIG.serve.solver : STROKE_CONFIG.racket.validation;
    const o = predict(p, v, w, { dt: validation.coarseDt,
      maxT: validation.maxT, stopAfterBounces: 2, out: this._q || (this._q = {}) });
    if (o.diverged || o.hitNet || !o.landed) return false;
    if (isServe) {
      return o.landed.z > 0 && Math.abs(o.landed.x) <= PH.T_HALF_WID + 0.01 &&
        !!o.b2 && o.b2.z < 0 && o.b2.z >= -PH.T_HALF_LEN - 0.01 &&
        Math.abs(o.b2.x) <= PH.T_HALF_WID + 0.01;
    }
    return o.landed.z < 0 && o.landed.z >= -PH.T_HALF_LEN - 0.01 &&
      Math.abs(o.landed.x) <= PH.T_HALF_WID + 0.01;
  }

  /* The exact zone that would admit a press RIGHT NOW (same call chain as
   * down()). The coach overlay draws this and anchors its ghost hand inside
   * it, so the lesson can never point somewhere the gate would reject. */
  previewPressZone() {
    if (this._pzpT !== undefined && this.time - this._pzpT < .1) return this._pzpCache;
    const rect = this.canvas.getBoundingClientRect();
    let zone = null;
    if (rect.width > 0 && rect.height > 0) {
      const pointerType = this.pointerFine === false ? 'touch' : 'mouse';
      const servePress = this.state === GS.SERVE_TOSS && this.server === 1;
      const dummyPointer = this.pointer && Number.isFinite(this.pointer.x) ? this.pointer : { x: 0.5, y: 0.62 };
      try {
        if (!servePress && MATCH_RULES.zoneAnchor === 'contact') {
          const corridor = this.strikeCorridor();
          zone = evaluateContactZone(
            corridor,
            this.ball,
            dummyPointer,
            rect.width,
            rect.height,
            point => this.project(point, {}),
            point => this.contactGateScale(point, rect),
            { pointerType, frozen: !!(this.training && this.training.frozen), referenceWorld: this.player && this.player.pos }
          );
        } else {
          zone = pressZoneForBall(this.ball, dummyPointer, rect.width, rect.height, {
            project: point => this.project(point, {}), pointerType,
            referenceWorld: this.player && this.player.pos,
            kind: servePress ? 'serve' : 'rally',
            tossApex: this.tossApex, tossStartY: this.tossStartY, tableY: PH.TABLE_Y,
          });
        }
      } catch (e) { zone = null; }
    }
    this._pzpT = this.time; this._pzpCache = zone;
    return zone;
  }

  /** Prefer elapsed physics time for real pointer events. Synthetic/demo
   * gestures without a simulation timestamp keep their existing real clock. */
  strokeAge(simStamp, realStamp) {
    return Number.isFinite(this.strokeTime) && Number.isFinite(simStamp)
      ? this.strokeTime - simStamp : this.time - realStamp;
  }

  playerStrokeIntent(serving = false) {
    const sw = this.swipe;
    const lastSample = sw.samples[sw.samples.length - 1];
    const releasedAt = Number.isFinite(this.swipeReleasedAt) ? this.swipeReleasedAt : -Infinity;
    /* A serve is struck on the way down, often after the swipe has already
       finished or the hand is waiting at the end of the flick. 0.18 s of
       freshness (correct for a rally) dropped a legal toss strike. */
    const liveWin = serving ? 1.15 : 0.18;
    /* An EARLY swing is a real table-tennis stroke: the hand accelerates
     * before the ball arrives and the blade is already waiting where it will
     * meet it. A 0.25 s release window expired mid-backswing and the ball
     * then passed a perfectly placed racket. The attempt therefore stays
     * bound to the SHOT it was pressed for (`pressZone.shotId`) and to an
     * ADMITTED press; a gesture stamped `outside` — or a gesture with no
     * press stamp at all, which is what the "an old released swipe cannot hit
     * a later ball" contract exercises — keeps the original 0.25 s and can
     * never re-arm itself. */
    const admittedAttempt = !!(sw.pressZone && sw.pressZone.accepted === true &&
      sw.pressZone.shotId === this.shotId);
    const deadWin = serving ? 1.15
      : admittedAttempt ? Math.max(0.25, CONTACT_CORRIDOR_RULES.strokeReleaseWindowSec) : 0.25;
    /* A real swipe can be held in position for a block. Only a fresh sample
       may start that hold: discovering an old motion late must not re-arm it.
       A stationary hold is not a swipe; a tap is recognised on release. */
    const sampleAge = lastSample ? this.strokeAge(sw.sampleSimTime, lastSample.t) : Infinity;
    if (sw.active && sw.gestureId !== sw.realGestureId && sampleAge >= 0 && sampleAge < liveWin &&
        isRealStroke(sw.m, serving)) {
      sw.realGestureId = sw.gestureId;
      sw.realAt = this.time;
      sw.realAtSim = Number.isFinite(sw.sampleSimTime) ? this.strokeTime : null;
    }
    const heldAge = this.strokeAge(sw.realAtSim, sw.realAt || 0);
    const releasedAge = this.strokeAge(sw.releaseSimTime, releasedAt);
    const held = sw.active && sw.gestureId === sw.realGestureId && heldAge >= 0 && heldAge < (serving ? 1.15 : 2.5);
    const fresh = sw.active && lastSample && sampleAge >= 0 && sampleAge < liveWin;
    const m = fresh || held ? sw.m
      : !sw.active && releasedAge >= 0 && releasedAge < deadWin ? sw.lastReleased : null;
    if (!isRealStroke(m, serving)) return null;
    return m;
  }

  /** The press gate is the oval/circle stamped at pointerdown (see
   *  pressZoneForBall). The oval already reaches ahead of the ball along its
   *  screen trajectory, which is where a backswing starts; anything later
   *  may only reject (wrong swipe direction), never admit. */
  pressAdmitsBall() {
    const pz = this.swipe && this.swipe.pressZone;
    /* A missing zone means a synthetic/internal swipe (demo stamps its own,
     * tools call SwipeTracker directly). Every real pointerdown stamps one
     * before any physics runs, and that stamp is final: no path, paddle,
     * assist or CCD re-evaluation may turn an outside press into a hit. */
    if (this.pressConsumed()) return false;
    if (!pz) return true;
    return pz.accepted === true;
  }

  /** The pose the blade is drawn with this frame. The continuous test must use
   *  it, not prevPos -> pos replayed once per physics substep: that multiplied
   *  a frame of bat travel by the number of substeps and manufactured
   *  interceptions the blade never made. */
  staticPad(pad) {
    /* During the substep loop the blade is a MOVING body: its frame-long
     * travel is distributed over the physics steps (substepPadPose), so the
     * CCD sees a real sweep instead of a teleport. Outside the loop the
     * blade is still for the whole test. */
    if (this._subPad) return this._subPad;
    const s = this._staticPad || (this._staticPad = { pos: V3.new(), prevPos: V3.new(), normal: V3.new() });
    V3.copy(s.pos, pad.pos); V3.copy(s.prevPos, pad.pos); V3.copy(s.normal, pad.normal);
    return s;
  }

  /** The blade pose for substep k of n. One frame-long move is split into n
   *  equal pieces, so the bat cannot pass through a ball between physics
   *  steps (the old single pose per frame both missed real contacts and
   *  manufactured phantom ones) and it cannot travel n times as far either. */
  substepPadPose(k, n) {
    const p = this.player;
    const s = this._subPadBuf || (this._subPadBuf = { pos: V3.new(), prevPos: V3.new(), normal: V3.new() });
    const a0 = n > 1 ? k / n : 0, a1 = n > 1 ? (k + 1) / n : 1;
    s.prevPos.x = lerp(p.prevPos.x, p.pos.x, a0);
    s.prevPos.y = lerp(p.prevPos.y, p.pos.y, a0);
    s.prevPos.z = lerp(p.prevPos.z, p.pos.z, a0);
    s.pos.x = lerp(p.prevPos.x, p.pos.x, a1);
    s.pos.y = lerp(p.prevPos.y, p.pos.y, a1);
    s.pos.z = lerp(p.prevPos.z, p.pos.z, a1);
    V3.copy(s.normal, p.normal);
    return s;
  }

  /* ------------------------------------------------------------------
   * Сторож физики: см. tt/src/46_physics_watchdog.js.
   *
   * arm() считается раз в кадр (жест уже разрешён гейтом), substep() — на
   * каждом подшаге, но читает только числа и делает 3-4 сравнения: 600 Гц
   * не должны стоить кадра. Контакт и отскок приходят отдельными вызовами,
   * потому что там уже известны нормаль, точка и тип кромки.
   * ------------------------------------------------------------------ */
  watchdogArmFrame() {
    const w = this.watchdog;
    if (!w) return;
    const b = this.ball, pad = this.player, sw = this.swipe;
    const serving = this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0;
    const zone = sw && sw.pressZone;
    const m = sw && sw.active ? sw.m : sw.lastReleased;
    const ownBounce = Array.isArray(this.rallyBounces) && this.rallyBounces.includes(1);
    /* Условия те же, что в tryPlayerHit: если гейт отказал бы нажатию
     * (свой отскок, повторный контакт, кулдаун, направление), пролёт мимо
     * клинка — не баг физики, а честный вердикт ввода. */
    const armed = !!(b.live && !this.paused && !(this.recenterT > 0) &&
      zone && zone.accepted && zone.directionOk !== false &&
      zone.shotId === this.shotId && this.time - pad.lastHitT > .09 &&
      !this.pressConsumed() &&
      (serving || (this.state === GS.RALLY && b.lastHitBy === -1 && ownBounce)) &&
      typeof isRealStroke === 'function' && isRealStroke(m, serving));
    w.arm(armed, { shotId: this.shotId, serving, gestureId: sw && sw.gestureId });
  }

  watchdogSubstep(p0) {
    const w = this.watchdog;
    if (!w) return;
    const pad = this._subPad || this.player;
    w.substep({
      dt: PHYS_DT, time: this.time, p0, p1: this.ball.p, ball: this.ball,
      pad, padPrev: pad.prevPos || this.player.prevPos, hitRadius: this.player.hitRadius,
      hitSeq: this._hitSeq || 0,
    });
  }

  diagnosticPhysicsGate(stage, detail = {}) {
    if (!this.debugRecording || !this.ball || !this.ball.live || !this.ball.p || !this.player || !this.player.pos) return;
    // Detailed substep samples near the player, not 600 full snapshots per
    // second of ordinary flight. Log every stage transition immediately.
    if (this.ball.lastHitBy !== -1 && this.state !== GS.SERVE_TOSS) return;
    if (Math.abs(this.ball.p.z - this.player.pos.z) > .9 && !(this.swipe && this.swipe.active)) return;
    const key = [stage, this.shotId, this.swipe && this.swipe.gestureId].join(':');
    const changed = this._debugPhysicsKey !== key;
    this._debugPhysicsKey = key;
    // Count across frames: at 0.3x a frame often has fewer than six
    // substeps, so using the per-frame index would silently skip them all.
    this._debugPhysicsSamples = (this._debugPhysicsSamples || 0) + 1;
    if (!changed && this._debugPhysicsSamples % 6 !== 0) return;
    this.logInput('physics_gate', { outcome: { stage, ...detail } });
  }

  /** Resolve fresh input against the current ball, not a smoothed paddle pose
   * or a later animation frame. Misses leave the gesture free to become a swipe. */
  tryInputHit(m) {
    const b = this.ball, pad = this.player, zone = this.swipe && this.swipe.pressZone;
    const serving = this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0;
    if (this.paused || !b.live || this.recenterT > 0 || !zone || !zone.accepted ||
        zone.shotId !== this.shotId ||
        this.time - pad.lastHitT <= .09 || !isRealStroke(m, serving) ||
        !(serving || (this.state === GS.RALLY && b.lastHitBy === -1))) return;
    let pointer = this.pointer;
    if (m.tap === true) {
      const p = this.project(b.p, {}), rect = this.canvas.getBoundingClientRect();
      if (!p.ok || (!zone.tapAtPress && Math.hypot((pointer.x - p.x) * rect.width, (pointer.y - p.y) * rect.height)
          > CONTACT_CORRIDOR_RULES.tapContactRadiusPx)) return;
      // A confirmed stationary click follows its own moving ball, never rewinds it.
      if (zone.tapAtPress && !m.compactFlick) pointer = p;
    }
    const calSpeed = this._cal && Number.isFinite(this._cal.padSpeed)
      ? lerp(.84, 1.20, clamp(this._cal.padSpeed, 0, 1)) : 1;
    const sens = clamp(MATCH_RULES.sensitivity * calSpeed, .55, 2);
    const target = pointerBladeSolve(this._liveRig, this.R.aspect(),
      clamp(.5 + (pointer.x - .5) * sens, 0, 1),
      clamp(.5 + (pointer.y - .5) * sens, 0, 1),
      /* Глубина фантома = плоскость мяча: курсор в 2D глубину выразить не
       * может. Клик подтверждается отпусканием, свайп — свежим движением,
       * без ожидания кадра анимации. Строгость здесь несут другие гейты —
       * press-зона, tapContactRadiusPx, обязательный отскок на своей
       * половину, лимиты подачи REACH_SHELL и ползунок «Зона приёма». */
      { forceZ: quantizeDepth(b.p.z) });
    if (this.camVPReady) clampPaddleToFrustum(this.camVP, target, .012);
    const lim = paddleLimitsFor(target.tz);
    const pos = V3.new(clamp(target.tx, -Math.min(REACH_SHELL.xHard, lim.x), Math.min(REACH_SHELL.xHard, lim.x)),
      clamp(target.ty, PH.TABLE_Y + Math.max(REACH_SHELL.yLoHard, lim.yLo),
        PH.TABLE_Y + Math.min(REACH_SHELL.yHiHard, lim.yHi)), target.tz);
    keepPaddleAboveTable(pos, pad.normal, pad.roll || 0, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN);
    if (!playerInCaptureRange(b.p, pos, serving) && !playerGraceRange(b.p, pos, serving)) return;
    this.tryPlayerHit(V3.clone(b.p), m, { pos, prevPos: pos, normal: pad.normal });
  }

  tryPlayerHit(p0, inputMetrics = null, inputPad = null) {
    const pad = this.player, b = this.ball;
    if (!b.live) return;
    /* The point is over. A ball still in the air during the point-end pause
     * is scenery: striking it used to change lastHitBy, consume the gesture
     * and feed the journal a contact that belonged to no rally. */
    if (this.state !== GS.RALLY && this.state !== GS.SERVE_TOSS) return;
    /* A serve has to bounce on the receiver's side before it can be returned.
     * `isServeBall` alone did not stop the near side from volleying the
     * opponent's serve straight out of the toss. */
    if (this.pressConsumed()) { this.debugRecording && this.diagnosticPhysicsGate('consumed'); this.logPressRejection('CONSUMED'); return; }
    if (this.isServeBall && b.lastHitBy === -1) {
      this.debugRecording && this.diagnosticPhysicsGate('opponent_serve_not_returnable');
      if (this.pressAdmitsBall() && this.playerStrokeIntent(false)) this.logPressRejection('BOUNCE_ILLEGAL');
      return;
    }
    if (this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0) {
      this.promotePendingServeZone();
    }
    if (!this.pressAdmitsBall()) { this.debugRecording && this.diagnosticPhysicsGate('press_not_admitted'); return; }

    // The fixed envelope belongs to the racket, NOT the pointer marker.
    const reachRadius = MATCH_RULES.captureRadius;
    const serveReach = MATCH_RULES.serveCaptureRadius;

    const serveCtx = this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0;
    const sw = this.swipe, m = inputMetrics || this.playerStrokeIntent(serveCtx);
    if (!m) {
      /* Палец держит ракетку без замаха — «стенка»: пассивный блок с честной
       * физикой отражения, но только когда ЭТОТ же жест уже вывел ракетку в
       * позицию (стал реальным ударом). Удержание без движения само по себе
       * не отражает мяч; короткий тап распознаётся отдельно при отпускании. */
      if (!serveCtx && this._tryPassiveBlock(pad, b)) { this.debugRecording && this.diagnosticPhysicsGate('passive_block'); return; }
      this.debugRecording && this.diagnosticPhysicsGate('no_stroke_intent', { serving: serveCtx });
      this.logNoStrokeIntent(serveCtx);
      return;
    }
    /* ITTF 2.07: a return must follow a bounce on the receiver's court.
     * Without this gate the generous endpoint envelope returned
     *   · a ball still on its way to the player (a volley, a fault), and
     *   · a ball that had already passed the end line and missed the table
     *     — a point the player had already won, turned back into a rally.
     * An out ball is allowed to finish its flight; the gesture is not
     * consumed, so it is still there for the real chance. */
    const ownBounce = this.rallyBounces.some((s) => s > 0);
    if (!serveCtx && !ownBounce) {
      this.debugRecording && this.diagnosticPhysicsGate('bounce_illegal');
      this.logPressRejection('BOUNCE_ILLEGAL');
      if (b.p.z >= PH.T_HALF_LEN) this.hintOut = this.time;
      return;
    }
    const endpointEligible = serveCtx || (b.lastHitBy === -1 && (this.rallyBounces.some(s => s > 0) || b.p.z >= .50));
    const spad = inputPad || this.staticPad(pad);
    const captureSample = measureCaptureAllowance(spad, p0, b.p, serveCtx, endpointEligible);
    if (captureSample && this.shotJournal) this.shotJournal.observeCapture(sw.gestureId, captureSample, this.time);
    if (b.v.z < 0 && b.p.z < spad.pos.z - .35) {
      this.debugRecording && this.diagnosticPhysicsGate('moving_away', { capture: captureSample }); return;
    }
    if (serveCtx && (b.v.y >= 0 || !(this.tossRiseNow() >= MATCH_RULES.serveTossMinRise - 1e-6))) {
      this.debugRecording && this.diagnosticPhysicsGate('serve_not_legal', { tossRise: this.tossRiseNow(), capture: captureSample });
      if (b.v.y < 0) this.logPressRejection('SERVE_TOSS_LOW', { tossRise: this.tossRiseNow() });
      return;
    }
    let hit = null, gateDetail = null;

    if (serveCtx) {
      // ITTF 2.06: the ball must be struck while FALLING from the toss.
      const rad = V3.dist(b.p, spad.pos);
      const serveIn = playerInCaptureRange(b.p, spad.pos, true);
      const serveEdge = !serveIn && playerGraceRange(b.p, spad.pos, true);
      if (b.v.y < 0 && this.tossRiseNow() >= MATCH_RULES.serveTossMinRise - 1e-6 && (serveIn || serveEdge)) {
        hit = { t: 1, x: b.p.x, y: b.p.y, z: b.p.z,
          captureKind: serveIn ? 'serve' : 'serve_edge',
          rad: serveIn ? rad * STROKE_CONFIG.serve.qualityRadiusK : serveReach, px: spad.pos.x, py: spad.pos.y, pz: spad.pos.z,
          edge: !serveIn };
      }
    } else if (ownBounce) {
      const pp = spad.pos;
      const closing = (b.p.x - pp.x) * b.v.x + (b.p.y - pp.y) * b.v.y +
        (b.p.z - pp.z) * b.v.z;
      const swept = bladePlaneCapture(b.p, p0, pp, spad.prevPos, spad.normal, false);
      const inside = playerInCaptureRange(b.p, pp) || swept.ok;
      const grazing = !inside && (playerGraceRange(b.p, pp) || swept.grace);
      const still = b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z < 0.04;
      const atClosest = MATCH_RULES.contactAtClosest ? (closing >= -0.02 || swept.t < 0.999) : closing <= 0.02;
      if (this.debugRecording) gateDetail = { inside, grazing, still, closing, atClosest, tap: m.tap === true,
        capture: captureSample, previousBall: inputLogVec(p0),
        paddleStart: inputLogVec(spad.prevPos), paddleEnd: inputLogVec(spad.pos) };
      /* v4.2: курсорный путь (inputPad) остаётся в гейте — мгновенный ввод
       * зафиксирован тестами, и фантом стоит в плоскости мяча, поэтому
       * atClosest для него вырожден (сближение ≈ 0). Тяжесть блока держат
       * магнит ракетки (ослаблен), grace-полоса и «Зона приёма». */
      if ((inside || grazing) && (inputPad || (m.tap === true && inside) || atClosest || still)) {
        const cx = swept.point ? swept.point.x : b.p.x;
        const cy = swept.point ? swept.point.y : b.p.y;
        const cz = swept.point ? swept.point.z : b.p.z;
        const pxHit = swept.padPoint ? swept.padPoint.x : pp.x;
        const pyHit = swept.padPoint ? swept.padPoint.y : pp.y;
        const pzHit = swept.padPoint ? swept.padPoint.z : pp.z;
        const lat = Number.isFinite(swept.lat) ? swept.lat : Math.hypot(cx - pxHit, cy - pyHit);
        const dzEff = Number.isFinite(swept.dzEff) ? swept.dzEff : Math.abs(cz - pzHit);
        const frac = Math.max(lat / reachRadius, dzEff / MATCH_RULES.depthTolerance);
        hit = { t: swept.t ?? 1, x: cx, y: cy, z: cz, captureKind: inside ? 'endpoint' : 'edge',
          rad: clamp(frac, 0, 1) * reachRadius, px: pxHit, py: pyHit, pz: pzHit,
          edge: !inside };
      }
    }

    if (!hit) {
      hit = this.sweepPaddle(spad, p0, b.p, serveCtx ? serveReach : reachRadius);
    }
    if (!hit) {
      this.debugRecording && this.diagnosticPhysicsGate('no_intersection', gateDetail || { capture: captureSample });
      this.logNoContactReason(captureSample, serveCtx); return;
    }
    this.debugRecording && this.diagnosticPhysicsGate('hit_candidate', { ...(gateDetail || {}), hit: { ...hit } });
    if (!this.validatePressDirection(m)) { this.debugRecording && this.diagnosticPhysicsGate('wrong_direction'); return; }
    if (b.lastHitBy === 1) { this.debugRecording && this.diagnosticPhysicsGate('already_hit'); this.logPressRejection('CONSUMED'); return; } // you already hit it

    const isServeStroke = this.isServeBall && b.lastHitBy === 0 && this.server === 1;
    const contact = V3.new(hit.x, hit.y, hit.z);
    const strokePos = inputPad ? inputPad.pos : pad.pos;
    const forehand = paddleForehand(strokePos.x, this.settings.hand, pad.forehand);
    const grip = playerWristPose(strokePos, pad.vel, this.settings.hand, { grip: this.settings.grip, forehand });
    const sideParams = this.equip.forSide(grip.forehand ? 1 : -1);
    const radius = MATCH_RULES.sweetRadius;
    const sweet = clamp((1 - hit.rad / reachRadius) * (sideParams.sweet || this.equip.sweetK), 0, 1);
    const offLat = clamp((hit.x - hit.px) / Math.max(radius, 1e-4), -1, 1);
    const offVer = clamp((hit.y - hit.py) / Math.max(radius, 1e-4), -1, 1);
    const offMag = clamp(Math.hypot(offLat, offVer), 0, 1);
    this.lastSweet = sweet;

    // ---- build the stroke from the live gesture --------------------
    let racket, quality;
    if (hit.edge) {
      racket = this._glanceRacket(m, contact, isServeStroke, sideParams);
      quality = GRACE_RULES.quality;
      racket.quality = quality;
    } else if (m) {
      const contactCfg = STROKE_CONFIG.racket.contact, thresholds = contactCfg.timingThresholds;
      const timing = clamp(m.speed / Math.max(m.peakSpeed, 1e-3), contactCfg.timingMin, 1);
      const timingIndex = timing >= thresholds[0] ? 0 : timing >= thresholds[1] ? 1 : timing >= thresholds[2] ? 2 : 3;
      const tband = ['ТОЧНО', 'ХОРОШО', 'РАНОВАТО', 'ПОЗДНО'][timingIndex];
      const tq = contactCfg.timingQuality[timingIndex];
      this.lastTiming = tband;
      const ctx = {
        side: 1, grip: this.settings.grip, forehand, isServe: isServeStroke,
        ball: { y: contact.y, z: contact.z },
        ballSpin: b.w, ballSpeed: V3.len(b.v), ballVelocity: b.v,
        powerScale: 1,
        moveYaw: this.padYaw || 0, movePitch: this.padPitch || 0,
        equip: sideParams,
        spinBias: this.settings.spinBias || 'norm',
        spinGain: this.settings.spinGain ?? 1, arcSens: this.settings.arcSens ?? 1,
      };
      racket = deriveStroke(m, ctx);
      racket.vmag *= this.equip.vmagK;
      /* Precision pays twice: a swipe peaking exactly at the contact gets a
       * pace bonus on top of the tq quality bonus — this is what makes the
       * exact hit a winner, not just a neat one. */
      if (timing >= thresholds[0]) racket.vmag *= contactCfg.speedBonus;
      if (!isServeStroke) {
        const miss = (1 - sweet) * offMag;
        racket.vmag *= 1 - contactCfg.missSpeedK * miss;
        racket.azSwing = clamp(racket.azSwing + offLat * contactCfg.missAzimuthK * (1 - sweet), ...STROKE_CONFIG.racket.azSwingRange);
        racket.elev = clamp(racket.elev - offVer * contactCfg.missElevationK * (1 - sweet), ...contactCfg.missElevationRange);
      }
      /* Потолок темпа чистого бокового удара. deriveStroke ограничивает vmag
       * ДО того, как здесь поработают множители (экипировка, бонус за точный
       * контакт, штраф за промах), и быстрый свайп снова улетал за потолок:
       * на мобильном вьюпорте 31 пиксель свайпа давали 11.6 м/с замаха,
       * 86 км/ч и 36 об/с бока — мяч уводило за боковую линию, и ни одна
       * ступень лестницы ассиста не возвращала его в игру (e2e
       * mouse/1/rally). Потолок про физику удара, а не про щедрость формулы,
       * поэтому применяется ПОСЛЕ множителей. */
      if (!isServeStroke && racket.stroke && racket.stroke.id === 'SIDE')
        racket.vmag = Math.min(racket.vmag, STROKE_CONFIG.spin.sideVmax);
      quality = clamp(racket.quality * (contactCfg.sweetWeights[0] + contactCfg.sweetWeights[1] * sweet)
        * (contactCfg.timingWeights[0] + contactCfg.timingWeights[1] * timing) * tq, ...contactCfg.qualityRange);
      racket.quality = quality;
      // One authored trajectory assist level, shared by every player.
      const assistLvl = MATCH_RULES.trajectoryAssist;
      const rawSwing = V3.new(), rawNormal = V3.new();
      strokeFrame(racket, 0, 0, 1, rawSwing, rawNormal);
      const rawShotFrame = { normal: shotVec(rawNormal), vR: shotVec(rawSwing),
        faceElev: racket.faceElev, swingElevation: racket.elev, swingAzimuth: racket.azSwing,
        faceAzimuth: racket.azFace, speed: racket.vmag, rubber: { ...racket.rubber } };
      racket = refineRacket(contact, b.v, b.w, racket, assistLvl, quality);
      if (racket.valid === false && clamp(assistLvl, 0, 1) < 0.999) {
        /* Не только подача: в розыгрыше ассист 0.85 тоже мог не найти лега —
         * и игрок получал «мусорный» удар: в свою половину, в сетку с места,
         * или вообще не поперёк свайпа. Пере(решаем) с полным ассистом — он
         * находит легал почти всегда. */
        racket = refineRacket(contact, b.v, b.w, racket, 1, quality);
      }
      if (racket && clamp(assistLvl, 0, 1) < 0.999 &&
          !this._playerFlightLegal(contact, racket, isServeStroke)) {
        /* Пост-верификация: решатель «без повторной проверки» формально
         * valid, но мяч уходит в свою половину/в сетку — для игрока это
         * неотличимо от «удар не в ту сторону». Карабкаемся по лестнице:
         * (1) пере(решаем) полным ассистом; (2) если и тот нелегален —
         * честно приглушаем темп (смягченный удар виден и объясним), а не
         * отсылаем абсурдную пулю в стол. Нелегальный СОВСЕМ (valid:false)
         * тоже идёт сюда: быстрый боковой свайп давал 24 об/с бока и 89 км/ч
         * с места в 1.5 м за своей линией — решатель такой мяч не удерживает,
         * и без этой ветки игрок получал пулю за стол. */
        const safer = refineRacket(contact, b.v, b.w, racket, 1, Math.min(quality, contactCfg.fallbackQualityMax));
        if (this._playerFlightLegal(contact, safer, isServeStroke)) racket = safer;
        else {
          /* (2) дикий боковой завиток подачи приглушаем до игрового — это та
           * самая «подача-рыба в сетку» из жалоб: жест честный, цель живая,
           * но curl=0.9 физически непопадаем; ассист усмиряет его ДО удара. */
          let dampedOk = false;
          if (isServeStroke && m && Math.abs(m.curl || 0) > STROKE_CONFIG.serve.curlRecoveryThreshold) {
            const damped = deriveStroke({ ...m, curl: (m.curl || 0) * STROKE_CONFIG.serve.curlRecoveryK }, ctx);
            strokeFrame(damped, 0, 0, 1, damped.vR, damped.normal);
            damped.vmag *= this.equip.vmagK;
            const d2 = refineRacket(contact, b.v, b.w, damped, 1, quality);
            if (this._playerFlightLegal(contact, d2, true)) { racket = d2; dampedOk = true; }
          }
          if (!dampedOk) {
            /* (3) ничего легального не нашлось даже полным ассистом — честно
             * приглушаем темп: смягчённый удар виден и объясним, вместо
             * абсурдной пули в стол молча. Но один только темп убивает удар
             * в другом месте: медленный мяч с прежней закрытой гранью (−15°)
             * идёт в сетку (замер temp/side-browser-probe.cjs: 4 м/с → «в
             * сетку»). Поэтому перебираем несколько честных пар «подъём
             * грани × темп» и берём первую законную; если ни одна не
             * подошла — гасим ТОЛЬКО темп, не трогая грань. Поднятая грань без
             * законного полёта опасна: разворачивая лицо от мяча, она
             * превращает удар в «нет контакта» (impactRacket отвергает
             * расходящуюся грань), и на мобильном вьюпорте свежий жест просто
             * переставал быть ударом. */
            const sw = V3.new(), nm = V3.new();
            let gentle = null;
            for (const [lift, target] of contactCfg.softening) {
              const scale = Math.min(1, target * (this.equip.vmagK || 1) / Math.max(racket.vmag, 1e-6));
              strokeFrame(racket, (racket.dElev || 0) + lift, racket.dAz || 0, scale, sw, nm);
              const cand = { ...racket, valid: true, softened: true, vmag: racket.vmag * scale,
                vR: V3.clone(sw), normal: V3.clone(nm) };
              if (this._playerFlightLegal(contact, cand, isServeStroke)) { gentle = cand; break; }
            }
            if (gentle) racket = gentle;
            else {
              const floor = contactCfg.softening[0][1] * (this.equip.vmagK || 1);
              racket.vmag = Math.min(racket.vmag, floor);
              if (racket.vR) V3.mul(racket.vR, racket.vR, Math.min(1, floor / Math.max(V3.len(racket.vR), 1e-6)));
              racket.softened = true;
            }
          }
        }
      }
      racket.sweet = sweet; racket.timing = timing;
      racket.unassisted = rawShotFrame;
    }

    racket.contactInput = { pressZone: this.swipe.pressZone && { ...this.swipe.pressZone }, capture: captureSample && { ...captureSample, route: hit.captureKind || 'ccd' }, p: shotVec(contact), v: shotVec(b.v), w: shotVec(b.w), gesture: { ...m },
      context: { grip: this.settings.grip, hand: this.settings.hand, forehand, isServe: isServeStroke,
        equip: { ...sideParams }, vmagK: this.equip.vmagK, moveYaw: this.padYaw || 0, movePitch: this.padPitch || 0 } };
    const info = impactRacket(b.v, b.w, racket.normal, racket.vR, quality, racket.rubber || {});
    /* A separating face returns null and leaves the ball untouched. Consuming
     * the gesture (and the 90 ms hit cooldown, and the paddle's position) on a
     * null impact is how a ball that never touched the rubber still counted as
     * returned — and why the next, real attempt was ignored. */
    if (!info) { this.debugRecording && this.diagnosticPhysicsGate('impact_separating_face', { hit: { ...hit }, quality }); return; }
    {
      const bp = this.R && this.R.viewProj ? this.project(b.p, {}) : null;
      const pp = this.R && this.R.viewProj ? this.project(pad.pos, {}) : null;
      const distancePx = bp && pp && bp.ok && pp.ok && this.vw > 0 && this.vh > 0
        ? Math.hypot((bp.x - pp.x) * this.vw, (bp.y - pp.y) * this.vh) : null;
      this.logInput('contact', { outcome: { contact: true, route: hit.captureKind || 'ccd',
        distancePx, distanceM: captureSample ? captureSample.distance : V3.dist(b.p, pad.pos),
        pressToContactMs: this.swipe.pressZone && Number.isFinite(this.swipe.pressZone.pressT)
          ? Math.max(0, this.time - this.swipe.pressZone.pressT) * 1000 : null } });
    }
    pad.lastHitT = this.time;
    this.anticipation.active = false;
    V3.zero(this.anticipation.visualOffset);
    if (hit.edge) {
      /* Видимая пометка краевого контакта — короткая и НЕ праздничная:
       * никаких эффектов поверх мяча, только слово на табло сообщений и
       * запись в статистику. Игрок должен ПОНЯТЬ, что произошло: он не
       * «промахнулся в никуда», а задел краем. */
      const edgeServe = this.state === GS.SERVE_TOSS;
      this.msg(edgeServe ? 'СРЕЗАЛ КРАЕМ…' : 'КРАЙ РАКЕТКИ!', .9, '#ffd77a');
      if (this.stats) this.stats.edgeHits = (this.stats.edgeHits || 0) + 1;
      if (this.shotJournal && typeof this.shotJournal.noteOutcome === 'function')
        this.shotJournal.noteOutcome(hit.captureKind === 'serve_edge' ? 'SERVE_EDGE' : 'EDGE', { q: quality });
    }
    /* Сторож видит позу клинка ДО «прилипания» к мячу: именно эта дистанция
     * и есть ответ на «подача не от ракетки»/«контакт не на ракетке». */
    if (this.watchdog) this.watchdog.contact({ time: this.time, side: 1, serve: isServeStroke,
      contact, pad, padBefore: pad.pos, racket });
    /* The blade is where the contact is. The old code left the bat up to one
     * full capture radius away and launched the ball from a point it visibly
     * never reached; the AI already snaps its paddle to the contact. prevPos is
     * moved too, so the next frame does not read the snap as 20 m/s of bat. */
    V3.copy(pad.pos, contact);
    pad.forehand = forehand;
    V3.copy(pad.prevPos, pad.pos);
    V3.copy(pad.prev, pad.pos);
    V3.copy(b.p, contact);
    V3.addScaled(b.p, b.p, racket.normal, PH.R * STROKE_CONFIG.racket.launchSeparation);
    V3.copy(pad.normal, racket.normal); // show the assisted contact face too
    if (isServeStroke && !hit.edge && racket.stroke && /^SERVE_/.test(racket.stroke.id) && typeof STROKES !== 'undefined') {
      /* Стиль подачи ВЫРАСТАЕТ из жеста (тот же свайп, четыре направления):
       * вверх — накат, вниз — резаная, поперёк — боковая, длинный быстрый —
       * стремительная. Называем её словом и цветом: подачи перестают быть
       * визуально одинаковыми, и игрок чувствует разницу стилей. */
      const stInfo = STROKES[racket.stroke.id];
      if (stInfo) this.msg(stInfo.name, 1.0, stInfo.col || '#ffd34d');
      const key = 'serve' + racket.stroke.id.slice(6, 7) + racket.stroke.id.slice(7).toLowerCase();
      if (this.stats) this.stats[key] = (this.stats[key] || 0) + 1;
    }
    pad.swing = 1;
    const motion = this.paddleMotion || (this.paddleMotion = new PaddleStrokeMotion());
    motion.contact(racket.normal, pad.roll, racket.stroke.id, this.settings.grip,
      this.settings.hand, forehand, this.settings.followThrough !== false);
    const impactAngles = paddleFaceAngles(racket.normal);
    pad.pitch = impactAngles.pitch; pad.yaw = impactAngles.yaw; pad.motionStage = 'contact';
    if (this.settings.followThrough && racket.vR) {
      const ft = this.followThrough;
      ft.active = true;
      ft.t = 0;
      ft.duration = motion.profile.hold + motion.profile.followTime + motion.profile.recoverTime * .5;
      ft.amplitude = (motion.profile.family === 'BLOCK' ? .025 : motion.profile.family === 'PUSH' ? .055 : .14)
        * (this.settings.grip === 'penhold' ? .85 : 1);
      const spd = V3.len(racket.vR) || 1;
      V3.set(ft.swingDir, racket.vR.x / spd, racket.vR.y / spd, racket.vR.z / spd);
    }

    // Multi-sensory hit feedback (99-level)
    if (this.hitFeedback) {
      this.hitFeedback.execute({
        quality,
        speed: V3.len(b.v) || 0,
        spin: b.w,
        contactPoint: contact,
        contactNormal: racket.normal,
        stroke: racket.stroke ? racket.stroke.id : 'DRIVE',
        power: racket.power,
        isServeStroke,
        isNetCord: this.netTouched,
        isEdge: info && info.edge > 0.25,
        side: 1,
      });
    }

    if (isServeStroke) { this.serveBounces = 0; this.rallyBounces.length = 0; }
    else this.isServeBall = false;
    this.applyHit(1, racket, contact, quality, info);
    sw.consumedGestureId = sw.gestureId; sw.consumedAt = this.time;
    sw.cancel();
    this.pointerDown = false;
    this.swipeReleasedAt = -Infinity;
    if (this.state === GS.SERVE_TOSS) this.setState(GS.RALLY);
  }

  tryAiHit() {
    if (this.training && !this.training.allowAi) { if (this.training.tryReply) this.training.tryReply(); return; }
    /* В онлайн-матче удары соперника приходят как 'guestHit'-сообщения,
     * а не через ботовы план; здесь ловить нечего. */
    if (this.network.isInMatch) return;
    /* The point is over: the bot may not touch a ball that is only still
     * flying through the point-end pause. Its plan used to survive the point
     * and pull the next serve into a phantom backswing. */
    if (this.state !== GS.RALLY) return;
    const b = this.ball, pad = this.aiPaddle, ai = this.ai;
    if (!b.live || b.lastHitBy === -1) return;
    /* A serve must bounce on the receiver's side before it can be returned.
     * The old code skipped the bounce rule for `isServeBall`, so the AI could
     * (and did) volley the player's serve out of the toss — and even reset the
     * serve state, turning a valid serve into a rally it had already won. */
    if (this.isServeBall) return;
    if (!ai.plan) return;
    // the bot only swings at the moment it committed to during the
    // backswing — that is what makes the shot readable in advance
    const aiSimNow = Number.isFinite(this.strokeTime) ? this.strokeTime : this.time;
    if (!ai.readyToStrike(aiSimNow) && V3.dist(b.p, ai.pos) > 0.22) return;
    const reach = V3.dist(b.p, ai.pos);
    if (b.p.z > ai.pos.z + 0.08) return;
    if (reach > 0.42) return;

    /* ITTF 2.07: the ball must touch the AI's court before the AI returns
     * it. The old test only refused while the ball was still over the table,
     * so a ball that had already flown past the end line — a point the bot
     * had won — could still be “returned” and the rally carried on from a
     * dead ball. */
    if (!this.rallyBounces.some((s) => s < 0)) return;

    const racket = ai.swing(this);
    if (!racket) { return; }
    const contact = V3.clone(b.p);
    const info = impactRacket(b.v, b.w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
    if (!info) return;
    if (this.watchdog) this.watchdog.contact({ time: this.time, side: -1, serve: false,
      contact, pad, padBefore: pad.pos, racket });
    V3.copy(pad.normal, racket.normal);
    V3.copy(pad.pos, b.p);
    /* Same separation as the player's contact: the flight the solver fitted
     * starts one radius off the face, so the live ball must too. */
    V3.addScaled(b.p, b.p, racket.normal, PH.R * STROKE_CONFIG.racket.launchSeparation);
    this.applyHit(-1, racket, contact, racket.quality, info);
  }

  /* ------------------------- paddle driving ------------------------ */
  /**
   * Every new point starts from a known state. The bat glides back to the
   * centre, the cursor binding is re-anchored, and any intercept the
   * previous rally left behind is thrown away — so the assist can never
   * carry a stale target into the next point and strand the bat somewhere
   * the cursor is not.
   */
  resetPaddle(hard) {
    const pad = this.player;
    this.pointer = { x: 0.5, y: 0.55 };
    this.pointerInside = true;
    this.pointerDown = false;
    this.padYaw = 0;
    this.padRoll = (this.settings.hand === 'left' ? -1 : 1)
      * (this.settings.grip === 'penhold' ? Math.PI - 0.052 : 0.28);
    this.padPitch = -(this.settings.grip === 'penhold' ? 5 : 15) * Math.PI / 180;
    if (this.paddleMotion) this.paddleMotion.reset();
    if (this.paddleReadClock) this.paddleReadClock.reset();
    if (this.strikeReadClock) this.strikeReadClock.reset();
    if (this._strike) { this._strike.on = false; this._strike.k = 0; }
    pad.forehand = true; pad.motionStage = 'ready';
    this.liveStroke = null;
    this._prep = 0;
    this._settlePaddleFace = false;
    this.mouseTrail = [];
    pad.yaw = 0; pad.pitch = this.padPitch; pad.roll = this.padRoll;
    if (this.followThrough) this.followThrough.active = false;
    /* 0.40 s, not 0.55: the window has to be over before a serve can possibly
     * be struck, or the bat is still travelling when the ball is hit. Measured
     * in the headless matches at 0.55 s: the closest the bat got to the centre
     * before the strike was 0.081-0.173 m on 14 of 49 serves. */
    /* Ракетка в конце розыгрыша НЕ едет в стартовую позицию: окно возврата
     * «домой» (RECENTER_S) отключаем по требованию игрока — бат остаётся
     * ровно там, где его держит рука, управление ни на кадр не блокируется
     * и смена розыгрышей не дёргает ракетку через весь стол. Очередь подачи
     * (tossQueued) при нулевом окне просто не используется. */
    this.recenterT = 0;
    this.tossQueued = false;
    this.tossQueuedAt = -9;
    this.swipe.cancel();
    if (this._paddlePred) this._paddlePred.reach = null;
    if (this._strikePred) this._strikePred.reach = null;
    if (this._volleyPred) this._volleyPred.reach = null;
    const broken = ![pad.pos.x, pad.pos.y, pad.pos.z].every(Number.isFinite);
    if (hard || broken) {
      V3.set(pad.pos, PADDLE_HOME.x, PADDLE_HOME.y, PADDLE_HOME.z);
      V3.copy(pad.prevPos, pad.pos);
      V3.copy(pad.prev, pad.pos);
      V3.zero(pad.vel);
    }
    V3.set(pad.normal, 0, Math.sin(this.padPitch), -Math.cos(this.padPitch));
    pad.swing = 0;
    this._ptTarget = { tx: PADDLE_HOME.x, ty: PADDLE_HOME.y, tz: PADDLE_HOME.z };
  }

  updatePlayerPaddle(dt) {
    const cfg = STROKE_CONFIG.racket;
    const pad = this.player;
    V3.copy(pad.prev, pad.pos);
    pad.prevPos = pad.prevPos || V3.clone(pad.pos);
    V3.copy(pad.prevPos, pad.pos);
    if (this.recenterT > 0) {
      this.recenterT = Math.max(0, this.recenterT - dt);
      /* release a serve the player asked for during the reset */
      /* Only a finger that is STILL on the screen may release a queued toss.
       * A tap during the bat's glide home queued the toss, the finger came
       * up, and the toss fired anyway — the ball then dropped with no stroke
       * behind it and the point was lost to «ПОДАЧА НЕ ВЫПОЛНЕНА». */
      if (this.recenterT === 0 && this.tossQueued) {
        /* A queued toss used to need the finger to STILL be down, so a normal
         * quick click during the glide was swallowed without a trace: the
         * player pressed to serve, nothing happened, and the only way to find
         * out was to press again. A tap is a request to serve, so it is
         * honoured if it is FRESH — the timeout is what keeps the original
         * bug fixed (a toss that fires seconds after the player has moved on
         * drops a ball nobody asked for). */
        const fresh = this.time - (this.tossQueuedAt === undefined ? -9 : this.tossQueuedAt) < STROKE_CONFIG.serve.toss.queuedWindow;
        this.tossQueued = false;
        if (this.state === GS.SERVE_READY && this.server === 1 && (this.pointerDown || fresh)) this.startToss();
      }
    }

    let pt = this.pointer || { x: 0.5, y: 0.55 };
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      pt = { x: 0.5, y: 0.55 };
      this.pointer = pt;                 // self-heal: never stay broken
    }
    /* A ball that dies short is a real table-tennis problem: with a bat
     * plane fixed 1.78 m back, a ball that dies at 0.4 m cannot be reached.
     * The step-in is DEPTH ONLY — it never moves the blade sideways — so it
     * cannot break the pointer contract, and it is the one piece of footwork
     * the player is not asked to perform with a mouse. */
    let zNear = PADDLE_LIMITS.zNear;
    const A = MATCH_RULES.positionAssist;
    const o = this._paddlePred || (this._paddlePred = {});
    const incoming = this.ball.live && this.ball.v.z > 0.4 && this.ball.lastHitBy === -1;
    /* A ball that has already bounced and died short is not "not incoming":
     * it is the one ball the step-in exists for. The old test also demanded
     * v.z > 0.4, so a dead or trickling ball never advanced the read clock,
     * never predicted a reach, and the bat stayed 0.47 m behind it — measured
     * in the dead-short probe: 120 frames, bat never closer than z 1.43, a
     * point awarded against the player who was never allowed to touch it. */
    const looseShort = this.ball.live && this.ball.lastHitBy === -1 &&
      this.ball.p.z > 0.02 && this.ball.p.z < 1.30 &&
      this.ball.p.y < PH.TABLE_Y + 0.60;
    const canReachShort = incoming || looseShort;
    const readClock = this.paddleReadClock || (this.paddleReadClock = new PaddleReadClock());
    if (readClock.advance(dt, canReachShort, this.shotId)) {
      predict(V3.clone(this.ball.p), V3.clone(this.ball.v), V3.clone(this.ball.w),
        { dt: PHYS_DT, maxT: 1.6, stopZ: pad.pos.z, stopDir: 1, out: o });
      if (!o.reach) {
        const rz = o.landed && o.landed.z > 0 ? o.landed.z + 0.25 : (looseShort ? this.ball.p.z : NaN);
        if (Number.isFinite(rz)) {
          o.reach = { x: o.landed ? o.landed.x : this.ball.p.x, y: PH.TABLE_Y + 0.22,
            z: clamp(rz, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar), vx: 0, vy: 0, vz: 4 };
          o.reachT = Math.max(0.05, (o.landed ? o.landed.t : 0) + 0.10);
        }
      }
    }
    /* A SHORT ball, not every ball that happens to be past the net. The old
     * trigger fired on `ball.p.z < 1.15`, which is true for the whole flight
     * of almost every rally ball — measured 2982 of 10 551 frames with the
     * blade leaned in, i.e. the player spent a third of the match reaching
     * over the table for no reason and losing the bottom of the pointer area
     * to the table's own clearance rule. A lunge is for a ball that will
     * BOUNCE short (inside 0.95 m of the net) or is already dying there. */
    const shortBall = canReachShort && (
      (o.landed && o.landed.z > 0 && o.landed.z < 0.95) ||
      (looseShort && this.ball.p.z < 0.95 && this.ball.p.y < PH.TABLE_Y + 0.45));
    if (shortBall) zNear = PADDLE_LIMITS.zStepIn;
    /* The step is visible: the body goes forward and down, the blade tips
       into the ball. Without this the bat simply appeared 16 cm closer. */
    pad.stepIn = expSmooth(pad.stepIn || 0, shortBall ? 1 : 0, 8, dt);

    /* THE POINTER CONTRACT. The blade's centre is the exact inverse
     * projection of the pointer onto the plane it stands on, so the blade is
     * drawn under the cursor — always, at every preset and aspect ratio.
     * `sens` is the player's sensitivity setting: it scales how far the bat
     * travels per pixel of cursor travel (1 = the exact map). */
    const calSpeedK = (this._cal && Number.isFinite(this._cal.padSpeed))
      ? lerp(0.84, 1.20, clamp(this._cal.padSpeed, 0, 1)) : 1;
    const sens = clamp((Number.isFinite(MATCH_RULES.sensitivity) ? MATCH_RULES.sensitivity : 1) * calSpeedK, 0.55, 2.0);
    const px = clamp(0.5 + (pt.x - 0.5) * sens, 0, 1);
    const py = clamp(0.5 + (pt.y - 0.5) * sens, 0, 1);

    /* Footwork depth plane (`this._footZ`): standing still the bat lives at
     * PADDLE_STANCE_Z, while an incoming short or deep ball shifts the feet
     * smoothly toward the optimal strike plane when `autoFootwork` is active. */
    /* An admitted press is a promise: the player has already been told "this
     * ball is yours". From that moment the FEET follow the live ball's depth
     * (the finger keeps drawing the stroke on screen), so the 3D blade and the
     * screen oval live on the same depth plane. A stationary hold gains no
     * strike rights from this — `playerStrokeIntent` stays null and only a
     * release/tap or a real swing can consume the contact. */
    const pressFoot = !!(this.swipe && this.swipe.pressZone &&
      this.swipe.pressZone.accepted === true && this.swipe.pressZone.shotId === this.shotId &&
      this.state === GS.RALLY && this.ball && this.ball.live && this.ball.lastHitBy === -1 &&
      this.recenterT <= 0 && this.ball.p &&
      this.ball.p.z > PADDLE_LIMITS.zStepIn - 0.35);
    let wantFootZ = PADDLE_STANCE_Z;
    if (pressFoot) {
      wantFootZ = clamp(this.ball.p.z - 0.02, PADDLE_LIMITS.zStepIn, PADDLE_STANCE_Z);
    } else if (shortBall) {
      wantFootZ = clamp(Math.min(o.reach ? o.reach.z : this.ball.p.z, this.ball.p.z) - 0.02,
        PADDLE_LIMITS.zStepIn, PADDLE_STANCE_Z);
    } else if (MATCH_RULES.autoFootwork && this.state === GS.RALLY && canReachShort) {
      const pz = this.swipe && this.swipe.pressZone;
      if (pz && pz.accepted && pz.shotId === this.shotId && pz.worldTarget && Number.isFinite(pz.worldTarget.z)) {
        wantFootZ = clamp(pz.worldTarget.z, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
      } else {
        const sc = this.strikeCorridor();
        if (sc && sc.valid && Number.isFinite(sc.footZ)) {
          wantFootZ = clamp(sc.footZ, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
        }
      }
    }
    this._footZ = expSmooth(Number.isFinite(this._footZ) ? this._footZ : PADDLE_STANCE_Z,
      wantFootZ, pressFoot ? 24 : shortBall ? 14 : 11, dt);

    const zFootArg = (pressFoot || shortBall ||
      (MATCH_RULES.autoFootwork && canReachShort && this._footZ < PADDLE_STANCE_Z - 0.02))
      ? quantizeDepth(this._footZ) : undefined;
    /* Forcing the depth is only safe for a ball this press was stamped for:
     * the point stays on the pointer ray (under the finger), only Z follows
     * the physical ball instead of the camera's hand-box. */
    const forceZ = pressFoot && Number.isFinite(this._footZ) ? quantizeDepth(this._footZ) : undefined;
    /* The solver's 5th argument is an OPTIONS object (`out`, `zHint`, `zFoot`),
     * not a result buffer: the old six-argument call passed `_ptTarget` as
     * `opts` and `zFoot` as an ignored 6th argument, so auto-footwork never
     * reached the blade. The blade stayed on the stance plane while the ball
     * was up to 0.8 m nearer, and an admitted press could not enter the
     * physical envelope no matter where the finger was. */
    const t = pointerBladeSolve(
      this._liveRig,
      this.R.aspect(),
      px,
      py,
      { out: this._ptTarget || (this._ptTarget = { tx: 0, ty: 0, tz: 0 }), zFoot: zFootArg, forceZ }
    );
    let tx = t.tx;
    let ty = t.ty;
    let tz = t.tz;
    const pointerDepth = !!t.zByPointer;
    this._reachFwd = expSmooth(this._reachFwd || 0, t.reachFwd || 0, 9, dt);
    this._reachTilt = this._reachFwd * REACH_SHELL.arcTilt;
    if (!pointerDepth && MATCH_RULES.autoFootwork && canReachShort && Number.isFinite(this._footZ) && this._footZ > tz + 0.03) {
      tz = clamp(this._footZ, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
    }

    // Position follow-through uses the SAME smoothed/clamped target path.
    const ft = this.followThrough;
    if (ft && ft.active) {
      if (this.playerStrokeIntent(this.state === GS.SERVE_TOSS)) ft.active = false;
      else {
        const progress = clamp(ft.t / ft.duration, 0, 1);
        const reach = (ft.amplitude || .14) * Math.sin(progress * Math.PI) ** 2;
        tx += ft.swingDir.x * reach;
        ty += ft.swingDir.y * reach;
        tz += ft.swingDir.z * reach;
      }
    }

    if (this.recenterT > 0) {
      const kHome = 1;
      tx = lerp(tx, PADDLE_HOME.x, kHome);
      ty = lerp(ty, PADDLE_HOME.y, kHome);
      tz = lerp(tz, PADDLE_HOME.z, kHome);
    }

    // during your own toss the bat slides under the ball: serving is about
    // the stroke you choose, not about pixel-hunting a 40 mm sphere
    const serveSlide = this.state === GS.SERVE_TOSS && this.server === 1 &&
      this.ball.lastHitBy === 0 && this.recenterT <= 0;
    if (serveSlide) {
      const tracking = STROKE_CONFIG.serve.tracking;
      const k = tracking.weights[0] + tracking.weights[1] * A;
      tx = lerp(tx, this.ball.p.x, k);
      tz = lerp(tz, this.ball.p.z + tracking.zOffset, k);
      const under = this.ball.p.y - tracking.underBall;
      ty = lerp(ty, under, k);
    }

    /* Rally stroke contact anchor: once an admitted gesture is actively
     * swinging (`rallyIntent != null`) at an incoming ball, keep the blade on
     * the ball's post-bounce 3D intercept while the finger draws the stroke's
     * direction & spin vector across the screen. Never engages during hover,
     * stationary hold prior to release, or un-admitted presses. */
    const rallyStrokeActive = !serveSlide && this.recenterT <= 0 &&
      this.state === GS.RALLY && this.ball.live && this.ball.lastHitBy === -1 &&
      !(this.isServeBall && this.ball.lastHitBy === -1) &&
      this.pressAdmitsBall();
    this._lockDbg = { active: rallyStrokeActive };
    if (rallyStrokeActive) {
      const rallyIntent = this.playerStrokeIntent(false);
      this._lockDbg.intent = !!rallyIntent;
      if (rallyIntent) {
        const pz = this.swipe && this.swipe.pressZone;
        const sc = this.strikeCorridor();
        let mx = NaN, my = NaN, mz = NaN;
        const ownBounced = this.rallyBounces.some(s => s > 0);
        if (ownBounced) {
          const dtMeet = (this.ball.v.z > 0.25 && Number.isFinite(tz) && tz > this.ball.p.z)
            ? clamp((tz - this.ball.p.z) / this.ball.v.z, 0, 0.14) : 0;
          mx = this.ball.p.x + this.ball.v.x * dtMeet;
          my = this.ball.p.y + this.ball.v.y * dtMeet - 0.5 * PH.G * dtMeet * dtMeet;
          mz = clamp(this.ball.p.z + this.ball.v.z * dtMeet, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
        } else if (sc && sc.valid && sc.primary && sc.primary.t <= 0.34) {
          mx = sc.primary.x; my = sc.primary.y; mz = sc.primary.z;
        } else if (pz && pz.worldTarget) {
          mx = pz.worldTarget.x; my = pz.worldTarget.y; mz = pz.worldTarget.z;
        }
        this._lockDbg = { ownBounced, mx, my, mz, intent: !!rallyIntent, active: rallyStrokeActive };
        if (Number.isFinite(mx) && Number.isFinite(my) && Number.isFinite(mz)) {
          /* Помощь, а не автопилот (v4.1). 0.90/0.72 тянули цель клика на
           * точку перехвата КАЖДЫЙ кадр: клинок доезжал до мяча за 2–3 кадра
           * из любой точки, поэтому блок был бесплатным и контакт случался
           * там, где нарисованная ракетка ещё не была. Теперь пропорция
           * меньше и дополнительно ограничена в метрах за кадр — до мяча всё
           * ещё надо привести ракетку, игра лишь доводит пару сантиметров. */
          const help = ownBounced ? cfg.snapAssist[0] : cfg.snapAssist[1], capMetres = cfg.snapDistance;
          tx += clamp((mx - tx) * help, -capMetres, capMetres);
          ty += clamp((my - ty) * help, -capMetres, capMetres);
          tz += clamp((mz - tz) * help, -capMetres, capMetres);
        }
      }
    }

    if (this.camVPReady) {
      t.tx = tx; t.ty = ty; t.tz = tz;
      clampPaddleToFrustum(this.camVP, t, 0.012);
      tx = t.tx; ty = t.ty; tz = t.tz;
    }

    const lim = paddleLimitsFor(clamp(tz, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar));
    tx = clamp(clamp(tx, -REACH_SHELL.xHard, REACH_SHELL.xHard), -lim.x, lim.x);
    ty = clamp(clamp(ty, PH.TABLE_Y + REACH_SHELL.yLoHard, PH.TABLE_Y + REACH_SHELL.yHiHard),
      PH.TABLE_Y + lim.yLo, PH.TABLE_Y + lim.yHi);
    tz = clamp(tz, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);

    /* Ползунок калибровки «Зона приёма»: читается каждый кадр, применяется на
     * лету — как padSpeed/padSmooth. 0 → жёсткий приём (0.85×), 50 → честный
     * контракт (1.00×), 100 → учебный (1.30×). Скрытый дев-множитель
     * CAPTURE_FORGIVE, на котором жила тренировка, теперь только про учебника
     * и сет-корд; вкус игрока живёт здесь. */
    const capV = (this._cal && Number.isFinite(this._cal.captureK)) ? clamp(this._cal.captureK, 0, 1) : 0.5;
    const capK = capV < 0.5 ? lerp(0.85, 1, capV * 2) : lerp(1, 1.30, (capV - 0.5) * 2);
    if (capK !== this._capCalK) {
      this._capCalK = capK;
      if (typeof setCaptureCalibration === 'function') setCaptureCalibration(capK);
    }

    const calRate = (this._cal && Number.isFinite(this._cal.padSmooth))
      ? lerp(1 / cfg.trackingLagRange[0], 1 / cfg.trackingLagRange[1], clamp(this._cal.padSmooth, 0, 1)) : 1 / cfg.trackingLag;
    const rate = this.recenterT > 0 ? 1 / cfg.resetTrackingLag : calRate;
    const zDrive = pointerDepth || this._reachFwd > 1e-4;
    this._padTarget = { tx, ty, tz, rate, lock: rallyStrokeActive && !!(this.swipe && this.swipe.realGestureId === this.swipe.gestureId), footZ: this._footZ };
    pad.pos.x = expSmooth(pad.pos.x, tx, rate, dt);
    pad.pos.y = expSmooth(pad.pos.y, ty, rate, dt);
    pad.pos.z = expSmooth(pad.pos.z, tz, rate * (zDrive ? 1 : cfg.depthTrackingK), dt);
    V3.sub(pad.vel, pad.pos, pad.prevPos);
    V3.mul(pad.vel, pad.vel, 1 / Math.max(dt, 1e-4));

    // Ready -> preparation -> contact -> recovery. Position chooses the
    // stance, not a literal clock angle; left hand mirrors the same model.
    const intent = this.playerStrokeIntent(this.state === GS.SERVE_TOSS);
    const servingNow = this.state === GS.SERVE_TOSS && this.server === 1;
    const fine = this.pointerFine !== false;
    const eta = incoming && Number.isFinite(o.reachT) ? Math.max(0, o.reachT - readClock.age) : undefined;
    const spdIn = incoming ? V3.len(this.ball.v) : 0;
    this._prep = expSmooth(this._prep || 0, (this.pointerDown && !intent) ? 1 : 0, 14, dt);

    let aimYaw = 0, aimPitch = 0;
    if (fine && !intent) {
      const trail = this.mouseTrail;
      if (trail && trail.length >= 2 && this.time - trail[trail.length - 1].t < .18) {
        const a = trail[Math.max(0, trail.length - 6)], b = trail[trail.length - 1];
        const tdt = Math.max(1e-3, b.t - a.t);
        const freshness = Math.exp(-Math.max(0, this.time - b.t) * 30);
        aimYaw = clamp((b.x - a.x) / tdt * 0.12, -0.10, 0.10) * freshness;
        aimPitch = clamp(-(b.y - a.y) / tdt * 0.14, -0.12, 0.12) * freshness;
      }
    }

    pad.forehand = paddleForehand(pad.pos.x, this.settings.hand, pad.forehand);
    // Recognize the CURRENT gesture, never last frame's liveStroke.
    const intentType = intent ? classifyStroke(intent, {
      ball: { y: pad.pos.y, z: pad.pos.z }, isServe: servingNow,
      incomingTop: this.ball.w.x, ballSpeed: V3.len(this.ball.v),
      arcSens: this.settings.arcSens ?? 1,
    }, clamp(Math.max(intent.releaseSpeed, intent.peakSpeed * cfg.speed.peakK) / cfg.speed.inputScale, 0, cfg.speed.powerMax)).id : null;
    if (intent && this.followThrough) this.followThrough.active = false;
    const wrist = playerWristPose(pad.pos, pad.vel, this.settings.hand, {
      grip: this.settings.grip,
      forehand: pad.forehand,
      stroke: intentType || 'DRIVE',
      preparation: this._prep,
      follow: 0,
      // Stance depth freezes during a swipe; wrist flexion must not freeze.
      gesturePitch: intent ? clamp(intent.dy * 1.6, -0.35, 0.35) : 0,
      gestureYaw: intent ? clamp((intent.right || 0) * 0.22 + (intent.curl || 0) * 0.07, -0.32, 0.32) : 0,
      ballX: incoming ? ((o.reach && Number.isFinite(o.reach.x)) ? o.reach.x : this.ball.p.x) : undefined,
      ballY: incoming ? this.ball.p.y : undefined,
      contactY: incoming && o.reach && Number.isFinite(o.reach.y) ? o.reach.y : undefined,
      incomingTop: incoming ? this.ball.w.x : undefined,
      incomingSide: incoming ? this.ball.w.y : undefined,
      ballSpeed: incoming ? spdIn : undefined,
      eta,
      compact: incoming ? clamp((spdIn - 8) / 10, 0, 1) * clamp(1 - (Number.isFinite(eta) ? eta : 0.5) / 0.28, 0, 1) : 0,
      snap: intent ? clamp((intent.releaseSpeed || 0) / 5.5, 0, 1) * clamp(intent.up || 0, -1, 1) : 0,
      attackLean: intent ? clamp(0.30 + (intent.up || 0) * 0.55, 0, 1)
        : 0,
      aimYaw, aimPitch,
      stepIn: pad.stepIn || 0,
      serving: servingNow,
    });
    /* Вытянутая вперёд рука клонит лицо к столу (механика кисти), иначе
     * ракетка летит вперёд «вертикально стоя» и смотрится картонно. */
    if (this._reachTilt > 0) wrist.pitch = clamp(wrist.pitch + this._reachTilt, -1.05, 1.05);
    /* Mouse is a precise 2-D pointer: catch up fast on a big read.
       A finger is a noisy 60 Hz sample — slower follow hides jitter
       without changing the pose the physics will actually strike. */
    const catchUp = (cur, target, base, maxSpeed = 14, wrap = false) =>
      stepPaddleAngle(cur, target, base, dt, maxSpeed, wrap);
    const yawRate = fine ? 17 : 10;
    const pitchRate = fine ? 16 : 9;
    const rollRate = fine ? 17 : 11;
    this.padYaw = catchUp(this.padYaw || 0, wrist.yaw, yawRate);
    this.padPitch = catchUp(this.padPitch || 0, wrist.pitch, pitchRate);
    this.padRoll = paddleAngleDelta(0, catchUp(this.padRoll || 0, wrist.roll, rollRate, 10, true));
    pad.yaw = this.padYaw; pad.pitch = this.padPitch; pad.roll = this.padRoll;

    // orientation follows the live gesture so you SEE the face angle
    const m = intent;
    let want = this._wantN || (this._wantN = V3.new(0, -0.05, -1));
    const rest = this._restN || (this._restN = V3.new());
    faceFromWrist(rest, this.padYaw, this.padPitch, 1);
    if (m) {
      const ctx = {
        side: 1, grip: this.settings.grip, forehand: pad.forehand, isServe: servingNow, ball: { y: pad.pos.y, z: pad.pos.z },
        ballSpin: this.ball.w, ballSpeed: V3.len(this.ball.v), ballVelocity: this.ball.v, moveYaw: this.padYaw, movePitch: this.padPitch,
      };
      const st = deriveStroke(m, ctx);
      /* First ~45 ms keep the ready face so the bat does not pop onto
         the archetype the frame a finger twitches. */
      const k = smoothstep(0, cfg.contact.readyBlendTime, m.dur || 0);
      want.x = lerp(rest.x, st.normal.x, k);
      want.y = lerp(rest.y, st.normal.y, k);
      want.z = lerp(rest.z, st.normal.z, k);
      this.liveStroke = st;
    } else {
      V3.copy(want, rest);
      this.liveStroke = null;
    }
    V3.norm(want, want);
    if (m || this._settlePaddleFace) {
      const current = paddleFaceAngles(pad.normal), target = paddleFaceAngles(want);
      faceFromWrist(pad.normal,
        catchUp(current.yaw, target.yaw, fine ? 28 : 22, 18, true),
        catchUp(current.pitch, target.pitch, fine ? 28 : 22, 18), 1);
      if (V3.dist(pad.normal, want) < 1e-4) this._settlePaddleFace = false;
    } else {
      // No second low-pass on an already smoothed ready wrist.
      V3.copy(pad.normal, rest);
    }
    const motion = this.paddleMotion || (this.paddleMotion = new PaddleStrokeMotion());
    const strokePose = motion.sample(dt, { yaw: this.padYaw, pitch: this.padPitch, roll: this.padRoll }, !!intent);
    if (strokePose) {
      faceFromWrist(pad.normal, strokePose.yaw, strokePose.pitch, 1);
      pad.roll = paddleAngleDelta(0, strokePose.roll);
      this.padRoll = pad.roll;
    }
    const face = paddleFaceAngles(pad.normal);
    pad.pitch = face.pitch; pad.yaw = face.yaw;
    pad.motionStage = strokePose ? strokePose.stage : intent ? 'swing' : this._prep > .02 ? 'prepare' : 'ready';
    const lifted = keepPaddleAboveTable(pad.pos, pad.normal, pad.roll, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN);
    if (lifted) pad.vel.y = (pad.pos.y - pad.prevPos.y) / Math.max(dt, 1e-4);
    pad.swing = Math.max(0, pad.swing - dt * 4.5);
    pad.hitRadius = MATCH_RULES.sweetRadius;
  }

  /**
   * Time and legal/spatial availability, not a rendered capture radius.
   * Predict an intercept on a time-based clock; the HUD stays on the ball.
   */
  updateStrikeWindow(dt) {
    const w = this._strike || (this._strike = { on: false, t: 9, k: 0, ready: 0 });
    const b = this.ball, pad = this.player;
    w.on = false; w.ready = 0; w.contactable = false; w.kind = 'none';
    const clock = this.strikeReadClock || (this.strikeReadClock = new PaddleReadClock());
    const incoming = this.state === GS.RALLY && b.live && b.lastHitBy === -1 && b.v.z > .2;
    const read = clock.advance(dt, incoming, this.shotId);
    if (this.paused || (this.replayer && this.replayer.on)) { w.k = 0; return; }
    if (this.state === GS.SERVE_TOSS && this.server === 1 && b.live && b.lastHitBy === 0) {
      // No ready circle on the paddle and no "hit now" while the toss rises.
      if (b.v.y < 0 && this.tossRiseNow() >= MATCH_RULES.serveTossMinRise - 1e-6) {
        w.on = true; w.kind = 'serve'; w.t = 0;
        w.contactable = playerInCaptureRange(b.p, pad.pos, true) || playerGraceRange(b.p, pad.pos, true);
        w.ready = w.contactable ? 1 : .4;
      }
    } else if (incoming && this.rallyBounces.some(side => side > 0)) {
      const o = this._strikePred || (this._strikePred = {});
      if (read) predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
        { dt: 1 / 200, maxT: 1.8, stopZ: pad.pos.z, stopDir: 1, stopAtPlane: true, out: o });
      w.contactable = playerInCaptureRange(b.p, pad.pos) || playerGraceRange(b.p, pad.pos);
      const eta = o.reach && Number.isFinite(o.reachT) ? Math.max(0, o.reachT - clock.age) : Infinity;
      if (w.contactable || eta <= MATCH_RULES.timingHorizon) {
        w.on = true; w.kind = 'rally'; w.t = w.contactable ? 0 : eta;
        w.ready = w.contactable ? 1 : Math.min(.65, clamp(1 - (eta - .1) / .34, 0, 1));
      }
    }
    // The marker is anchored to the actual ball, never a predicted phantom
    // ball or the bat. Radius expresses time, not physical capture size.
    w.x = b.p.x; w.y = b.p.y; w.z = b.p.z;
    w.k = expSmooth(Number.isFinite(w.k) ? w.k : 0, w.on ? 1 : 0, 14, dt);
  }

  /** World -> normalised screen space, so the 2D layer can point at things
   *  that live in 3D (the ball, your bat, the strike window). */
  project(p, out) {
    const m = this.R.viewProj;
    const cw = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    const o = out || {};
    if (cw <= 1e-4) { o.ok = false; return o; }
    o.x = ((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / cw) * 0.5 + 0.5;
    o.y = 0.5 - ((m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / cw) * 0.5;
    o.d = cw; o.ok = true;
    return o;
  }

  /* ----------------------------- camera ---------------------------- */

  /** Switching presets is instant and exact: there is nothing to adjust. */
  setCameraPreset(mode) {
    const P = CAMERA_PRESETS[mode];
    if (!P) return;
    this.settings.camera = mode;
    this.ui && this.ui.syncSettings && this.ui.syncSettings();
    this.audio.ui('click');
    this.msg('КАМЕРА · ' + P.ru, 1.1, '#9fd0ff');
    this.saveSettings();
  }
  /** Lens zoom trim. 1 = the authored fit, >1 = closer. Quantised to whole
   *  percents so the fit and reach caches see steps, not a continuum. */
  setCamZoom(z) {
    const s = this.settings;
    const v = clamp(Math.round((Number.isFinite(z) ? z : 1) * 100) / 100, CAM_ADJUST.zoomMin, CAM_ADJUST.zoomMax);
    if (v === s.camZoom) return;
    s.camZoom = v;
    this.saveSettings();
    if (this.ui && this.ui.syncCameraControls) this.ui.syncCameraControls();
  }
  /** Pitch trim in degrees on top of the preset, quantised to 0.5°.
   *  + = camera higher, looking down more; − = closer to the net's eye level. */
  setCamPitch(p) {
    const s = this.settings;
    const v = clamp(Math.round((Number.isFinite(p) ? p : 0) * 2) / 2, CAM_ADJUST.pitchMin, CAM_ADJUST.pitchMax);
    if (v === s.camPitch) return;
    s.camPitch = v;
    this.saveSettings();
    if (this.ui && this.ui.syncCameraControls) this.ui.syncCameraControls();
  }
  /** Reset the view: the authored preset AND a clean trim. */
  camReset() {
    this.settings.camZoom = 1;
    this.settings.camPitch = 0;
    this.setCameraPreset(CAMERA_ORDER[0]);
  }

  /* The camera is rebuilt AFTER the paddle has been placed, so the clamp
   * inside updatePlayerPaddle always works against the previous frame's view
   * matrix. That is invisible while the rig is still and blatant during the
   * point-end and replay cinematics, where the camera travels and leaves the
   * bat parked outside the frame — measured 109 of 18 226 headless match
   * frames, worst 20 % of the viewport past the bottom edge, with the bat
   * frozen in POINT and REPLAY. One cheap re-check against the matrix this
   * frame will actually be drawn with closes it. */
  keepPaddleOnScreen() {
    if (!this.camVPReady) return;
    const pad = this.player;
    const s = projectPoint(this.camVP, pad.pos, this._kosS || (this._kosS = {}));
    const m = 0.05;
    if (s.ok && s.x >= m && s.x <= 1 - m && s.y >= m && s.y <= 1 - m) return;
    const t = this._kosT || (this._kosT = { tx: 0, ty: 0, tz: 0 });
    t.tx = pad.pos.x; t.ty = pad.pos.y; t.tz = pad.pos.z;
    clampPaddleToFrustum(this.camVP, t, m);
    pad.pos.x = t.tx; pad.pos.y = t.ty; pad.pos.z = t.tz;
    /* A correction the physics can see as motion is worse than no
     * correction: prevPos/vel used to keep the OLD pose, so the next frame
     * looked like a half-metre bat sweep through whatever was in the way. */
    V3.copy(pad.prevPos, pad.pos);
    V3.copy(pad.prev, pad.pos);
    V3.zero(pad.vel);
  }

  /** The last word on where the bat may be. `updatePlayerPaddle` already
   *  clamps its target, but a cinematic clamp, a follow-through offset and a
   *  table lift all touch the pose afterwards. One hard clamp here makes
   *  "the bat is always inside its authored volume" a property of the frame,
   *  not of the order of those edits. */
  clampPaddleVolume() {
    const pad = this.player;
    pad.pos.z = clamp(pad.pos.z, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
    const lim = paddleLimitsFor(clamp(pad.pos.z, PADDLE_LIMITS.zStepIn, PADDLE_STANCE_Z));
    pad.pos.x = clamp(pad.pos.x, -lim.x, lim.x);
    pad.pos.y = clamp(pad.pos.y, PH.TABLE_Y + lim.yLo, PH.TABLE_Y + lim.yHi);
  }

  updateCamera(dt) {
    const aspect = this.R.aspect();
    const rig = cameraRigFor(this.settings.camera, null, aspect, this.camRig, {
      zoom: this.settings.camZoom,
      pitch: this.settings.camPitch,
    });
    const swayAmt = (this._swayCal !== undefined && Number.isFinite(this._swayCal) && !this.reducedMotion && this.ball && this.ball.live)
      ? clamp(this.ball.p.x * 0.08 * clamp(this._swayCal, 0, 1), -0.09, 0.09) : 0;
    V3.set(this.camPos, rig.eye.x, rig.eye.y, rig.eye.z);
    V3.set(this.camLook, rig.look.x + swayAmt, rig.look.y, rig.look.z);
    V3.set(this.camPosT, rig.eye.x, rig.eye.y, rig.eye.z);
    V3.set(this.camLookT, rig.look.x + swayAmt, rig.look.y, rig.look.z);
    this.fovT = rig.fov;
    if (!Number.isFinite(this.fov) || Math.abs(this.fov - rig.fov) > 8) this.fov = rig.fov;
    this.camShiftY = rig.shiftY;
    this.applyCamera(dt);

    /* HUD and paddle constraints share the exact un-pulsed rig projection so
     * pointerBladeSolve never shifts during impact FOV punches. */
    const lrig = this._liveRig;
    V3.set(lrig.eye, rig.eye.x, rig.eye.y, rig.eye.z);
    V3.set(lrig.look, rig.look.x + swayAmt, rig.look.y, rig.look.z);
    lrig.fov = rig.fov;
    lrig.shiftY = this.camShiftY;
    this.camVP = rigViewProj(lrig, aspect, this._rigBuf);
    this.camVPReady = true;
    this.hudBandY = PLAY_BAND_Y;
    const css = PLAY_BAND_Y.toFixed(4);
    if (css !== this._bandCss) {
      this._bandCss = css;
      if (typeof document !== 'undefined' && document.documentElement)
        document.documentElement.style.setProperty('--band-top', css);
    }
  }

  /** Smoothing, shake and the actual setCamera call — shared by the live
   *  camera and the replay camera. */
  applyCamera(dt) {
    const k = 6.5;
    this.camPos.x = expSmooth(this.camPos.x, this.camPosT.x, k, dt);
    this.camPos.y = expSmooth(this.camPos.y, this.camPosT.y, k, dt);
    this.camPos.z = expSmooth(this.camPos.z, this.camPosT.z, k, dt);
    this.camLook.x = expSmooth(this.camLook.x, this.camLookT.x, k * 1.2, dt);
    this.camLook.y = expSmooth(this.camLook.y, this.camLookT.y, k * 1.2, dt);
    this.camLook.z = expSmooth(this.camLook.z, this.camLookT.z, k * 1.2, dt);
    this.fov = expSmooth(this.fov, this.fovT, 5, dt);

    // Camera shake is an optional impact effect, not part of the simulation.
    this.shake = this.reducedMotion ? 0 : Math.max(0, this.shake - dt * 3.4);
    const s = this.reducedMotion ? 0 : this.shake * this.shake * 0.055;
    const t = this.time * 46;
    const ox = (noise1(t) - 0.5) * s, oy = (noise1(t + 17.3) - 0.5) * s, oz = (noise1(t + 41.7) - 0.5) * s;
    const eye = V3.new(this.camPos.x + ox, this.camPos.y + oy, this.camPos.z + oz);
    const look = V3.new(this.camLook.x + ox * 0.5, this.camLook.y + oy * 0.5, this.camLook.z + oz * 0.5);
    this.R.setCamera(eye, look, { x: 0, y: 1, z: 0 }, this.fov, 0.05, 60, this.camShiftY);
  }

  /** A replay is shot, not spectated: the camera drifts in from wide and
   *  swings over the ball for the contact, so the stroke reads like a
   *  photograph instead of a video of a game. */
  updateCameraReplay(dtReal) {
    const rp = this.replayer, b = this.ball.p;
    if (this.reducedMotion) {
      // Keep the live framing fixed; the ball still follows its full replay trajectory.
      V3.copy(this.camPosT, this.camPos);
      V3.copy(this.camLookT, this.camLook);
      this.fovT = this.fov;
    } else {
      const prog = rp.moment ? clamp(rp.i / Math.max(1, rp.lastFrame), 0, 1) : 0;
      const t = clamp((prog - 0.42) / 0.5, 0, 1);
      const e = t * t * (3 - 2 * t);                     // smoothstep
      const wx = clamp(b.x * 0.35, -1.4, 1.4), wz = clamp(b.z * 0.25 + 3.35, 2.4, 4.0);
      const ox = clamp(b.x * 0.75, -1.5, 1.5), oz = clamp(b.z + 1.35, 0.55, 3.1);
      V3.set(this.camPosT, lerp(wx, ox, e), lerp(2.02, 1.34, e) + Math.sin(this.time * 0.7) * 0.02, lerp(wz, oz, e));
      V3.set(this.camLookT, b.x * 0.9, b.y * 0.9 + 0.06, b.z * 0.9);
      this.fovT = lerp(41, 34, e);
    }
    /* A replay is shot with a plain lens: the authored lens shift belongs to
     * the play frame, and sliding the image during a cinematic reads as a
     * broken projector. */
    this.camShiftY = 0;
    this.applyCamera(dtReal);
    /* camVP is the matrix everything on screen is projected with — the HUD text
     * band, the bat clamp, the strike ring, the projected cursor. During a
     * replay update() returns before updateCamera runs, so camVP used to stay
     * frozen at whatever the LIVE camera last was while the picture was a
     * 34-degree close-up swinging over the ball: every one of those overlays
     * was anchored to a camera that no longer existed. Rebuild it from the
     * camera the replay is actually drawing with. */
    const rg = this._replayRig || (this._replayRig = { eye: V3.new(), look: V3.new(), fov: 40 });
    V3.copy(rg.eye, this.camPos);
    V3.copy(rg.look, this.camLook);
    rg.fov = this.fov;
    rg.shiftY = this.camShiftY;
    this.camVP = rigViewProj(rg, this.R.aspect(), this._rigBuf);
    this.camVPReady = true;
  }

  /* --------------------------- demo bot player ---------------------- */
  updateDemoPlayer(dtReal) {
    if (!this.demoMode) return;
    const b = this.ball;
    /* Автопилот демо: указатель едет к цели С ОГРАНИЧЕНИЕМ СКОРОСТИ —
     * никаких телепортов ракетки на метры. Раньше pointer присваивался
     * напрямую под проекцию мяча каждый кадр: ракетка «прыгала» над столом */
    const steer = (tx, ty) => {
      const p = this._demoPos || (this._demoPos = { x: 0.50, y: 0.65 });
      const vx = tx - p.x, vy = ty - p.y, d = Math.hypot(vx, vy);
      const step = Math.min(d, 1.05 * dtReal);   // ~экран в секунду: спокойно и читаемо
      if (d > 1e-6) { p.x += vx / d * step; p.y += vy / d * step; }
      this.pointer = { x: p.x, y: p.y };
    };

    // Handle active demo gesture progression
    if (this._demoGesture) {
      const g = this._demoGesture;
      g.t += dtReal;
      const progress = clamp(g.t / g.dur, 0, 1);
      const curX = lerp(g.x0, g.x1, progress);
      const curY = lerp(g.y0, g.y1, progress);
      this.pointer = { x: curX, y: curY };
      this.pointerDown = true;
      this.swipe.move(curX, curY, this.time);

      if (progress >= 1) {
        this.swipe.up(g.x1, g.y1, this.time);
        this.pointerDown = false;
        this.swipeReleasedAt = this.time;
        this.lastSwipeT = this.time;
        this._demoPos = { x: g.x1, y: g.y1 };   // продолжить отсюда, без отскока назад
        this._demoGesture = null;
        this._demoCooldown = 0.22;
      }
      return;
    }

    if (this._demoCooldown > 0) {
      this._demoCooldown -= dtReal;
      return;
    }

    // 1. Serving as player 1
    if (this.state === GS.SERVE_READY && this.server === 1) {
      steer(0.50, 0.65);
      this._demoServeWait = (this._demoServeWait || 0) + dtReal;
      if (this._demoServeWait > 0.6) {
        this._demoServeWait = 0;
        this.startToss();
      }
      return;
    }

    // 2. Striking the toss right as it reaches apex and begins falling
    if (this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0) {
      const sp = this.project(b.p, this._pvDemo || (this._pvDemo = {}));
      if (sp.ok) steer(clamp(sp.x, 0.35, 0.65), clamp(sp.y, 0.45, 0.75));
      // Start the stroke as soon as apex is crested
      if ((b.v.y <= 0.15 && this.stateT > 0.16) || b.p.y < (this.tossApex || 1) - 0.02) {
        this.startDemoSwipe('serve');
      }
      return;
    }

    // 3. Returning balls during a rally
    if (this.state === GS.RALLY && b.live && b.lastHitBy === -1) {
      // Guide the pointer towards the incoming ball — плавно
      const sp = this.project(b.p, this._pvDemo || (this._pvDemo = {}));
      if (sp.ok) steer(clamp(sp.x, 0.20, 0.80), clamp(sp.y + 0.05, 0.45, 0.75));
      /* Contract v3: the stroke has to pass through the meeting point, so the
       * bot reads the same prediction the coach ring shows and puts its
       * finger down just before the ball gets there — like a good player. */
      const cp = this.rallyBounces.some((s) => s > 0) ? this.contactPrediction() : null;
      if (cp && cp.t <= 0.06 && this._demoShot !== this.shotId) {
        this._demoShot = this.shotId;
        const q = this.project(cp.p, this._pvDemo2 || (this._pvDemo2 = {}));
        if (q && q.ok) this.startDemoSwipe('rally', q);
      }
    }
  }

  startDemoSwipe(kind, at) {
    const sp = at || this.project(this.ball.p, this._pvDemo || (this._pvDemo = {}));
    const cx = sp.ok ? clamp(sp.x, 0.25, 0.75) : 0.50;
    const cy = sp.ok ? clamp(sp.y, 0.40, 0.80) : 0.65;

    let dx = (Math.random() - 0.5) * 0.04;
    let dy = -0.25; // default: crisp topspin swipe upward
    let dur = 0.08;

    if (kind === 'serve') {
      dy = -0.28; // fast, solid upward swipe for serve
      dx = (Math.random() - 0.5) * 0.03;
      dur = 0.07;
    } else {
      // through the meeting point: a short stroke from just below it
      dur = 0.10;
      dy = -0.14 - Math.random() * 0.03;
      dx = (Math.random() - 0.5) * 0.20;      // placement: left / centre / right
    }

    const x0 = clamp(cx, 0.15, 0.85);
    const y0 = clamp(cy + (kind === 'rally' ? 0.047 : 0.10), 0.25, 0.85);
    const x1 = clamp(x0 + dx, 0.10, 0.90);
    const y1 = clamp(y0 + dy, 0.15, 0.90);

    this.pointer = { x: x0, y: y0 };
    this.pointerDown = true;
    this.swipe.down(x0, y0, this.time);
    /* The attract-mode bot does not go through pointerdown, so it must not
     * inherit a rejected press zone from the last human gesture. */
    const rectD = this.canvas && this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : null;
    this.swipe.pressZone = { accepted: true, via: 'demo', shape: MATCH_RULES.zoneShape,
      score: 0, along: 0, across: 0, reason: null, pointerType: 'demo',
      radius: MATCH_RULES.pressRadiusPx,
      pressX: x0, pressY: y0, vw: rectD ? rectD.width : 1, vh: rectD ? rectD.height : 1 };
    this._demoGesture = {
      x0, y0, x1, y1,
      t: 0,
      dur
    };
  }

  /* ------------------------------ update --------------------------- */
  update(dtReal) {
    if (!Number.isFinite(dtReal) || dtReal <= 0) return;
    dtReal = Math.min(dtReal, 0.1);
    if (this.state === GS.MENU) {
      this.updateCamera(dtReal);
      this.profile.maybeSave(dtReal);
      return;
    }
    /* ---- the coach is holding the ball in mid-air: the world stops, the
       bat still follows the finger so the pupil can line it up ---- */
    if (this.training && this.training.frozen) {
      this.training.update(dtReal);
      this.updatePlayerPaddle(dtReal);
      this.updateCamera(dtReal);
      return;
    }
    this.frame++;
    /* ---- a replay owns the whole update: physics is off, the clip is
       the truth, and the camera is a filmmaker rather than a spectator ---- */
    if (this.replayer.on) {
      this.time += dtReal;
      this.replayer.update(dtReal, this);
      this.particles.update(dtReal);
      this.updateCameraReplay(dtReal);
      return;
    }
    const ts = this.timeScale;
    const dt = Math.min(dtReal, 0.05) * ts;
    this.time += dtReal;
    this.strokeTime += dt;
    this.stateT += dtReal;

    if (this.slowmoUntil && this.time > this.slowmoUntil) { this.targetTimeScale = 1; this.slowmoUntil = 0; }
    this.updateSlowmo(dtReal);
    /* Калибровка «Скорость мяча» (flytime 0..1): общий темп матча,
     * тренировочная насадка. Регламентную физику не трогает — это
     * честное замедление времени как у существующего slow-mo. */
    const ft = (this._cal && this._cal.flytime !== undefined) ? (0.78 + this._cal.flytime * 0.4) : 1;
    this.timeScale = expSmooth(this.timeScale, this.targetTimeScale * ft, 9, dtReal);

    if (this.demoMode && !this.paused) {
      this.updateDemoPlayer(dtReal);
    }

    this.updateShotDiagnostics();

    // state machine
    switch (this.state) {
      case GS.SERVE_READY:
        if (this.server === -1) {
          /* сначала бот ВЫХОДИТ в позицию подачи. Раньше мяч парковался у
           * ракетки там, куда бот дотянулся в прошлом розыгрыше (край стола,
           * под самой сеткой) — и подача летела из того же угла */
          {
            const toss = STROKE_CONFIG.serve.toss;
            const tx = clamp(this.aiServeX || 0, -toss.aiReadyXMax, toss.aiReadyXMax);
            const tz = -(PH.T_HALF_LEN + toss.aiEndMargin);
            const k = 1 - Math.exp(-toss.aiApproachRate * dtReal);
            this.ai.pos.x += (tx - this.ai.pos.x) * k;
            this.ai.pos.z += (tz - this.ai.pos.z) * k;
            this.ai.pos.x = clamp(this.ai.pos.x, -toss.aiPositionXMax, toss.aiPositionXMax);
            if (this.ai.pos.z > -toss.aiZMin) this.ai.pos.z = -toss.aiZMin;
            this.ai.pos.y = PH.TABLE_Y + toss.aiPaddleHeight;
          }
          /* park the ball in front of the AI's OWN bat every frame — a serve
           * tossed 25 cm away from the paddle reads as ball and racket living
           * in different worlds */
          V3.set(this.ball.p, this.ai.pos.x,
            PH.TABLE_Y + STROKE_CONFIG.serve.toss.height,
            clamp(this.ai.pos.z + STROKE_CONFIG.serve.toss.aiPaddleZOffset,
              -(PH.T_HALF_LEN + STROKE_CONFIG.serve.toss.aiFarMargin), -STROKE_CONFIG.serve.toss.aiNearZ));
          this.aiServeTimer -= dtReal;
          if (this.aiServeTimer <= 0) {
            const toss = STROKE_CONFIG.serve.toss;
            V3.set(this.ball.v, rndSym(toss.aiLateralJitter), toss.aiSpeed, rndSym(toss.aiLateralJitter));
            this.ball.live = true;
            this.isServeBall = true;
            this.setState(GS.SERVE_TOSS);
            this.aiSwingAt = this.time + toss.aiSwingDelay;
          }
        } else {
          this.serveHint = clamp(this.serveHint + dtReal, 0, 3);
          parkServeBall(this.ball.p, this.player, this.settings.hand);
        }
        break;
      case GS.SERVE_TOSS:
        /* The opponent strikes at a HEIGHT, not at a deadline. `aiSwingAt`
         * is real seconds while the ball integrates scaled seconds, so under
         * slow-mo a fixed deadline met the ball 10-20 cm lower than intended
         * and every slowed-down serve came out a different serve. The height
         * is also what makes a fast serve geometrically possible: from 0.61 m
         * above the table even a full-speed flat swing cannot bounce on the
         * server's own half, so the solver used to halve it (measured: the
         * fast serve left the bat at 24 km/h at swing scale 0.50). At 0.36 m
         * on the way down it is a real serve. */
        if (this.server === -1 && this.ball.lastHitBy === 0 && this.stateT > STROKE_CONFIG.serve.toss.aiContactDelay &&
          ((this.ball.v.y < 0 && this.ball.p.y <= PH.TABLE_Y + STROKE_CONFIG.serve.toss.aiContactHeight) ||
            this.time > this.aiSwingAt + STROKE_CONFIG.serve.toss.aiTimeout)) {
          let racket = this.ai.serve(this);
          // the opponent does not get to donate points either — but a level
          // whose skill is already 1.0 has been solved at full assist, and
          // re-solving the same problem is pure frame time
          if (racket.valid === false && clamp(this.ai.L.skill, 0, 1) < 0.999) {
            racket = refineRacket(this.ball.p, this.ball.v, this.ball.w, racket, 1, racket.quality);
          }
          const contact = V3.clone(this.ball.p);
          const info = impactRacket(this.ball.v, this.ball.w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
          if (!info) break;
          /* Tame the serve bounce at the levels where the player cannot yet
           * cover the width: the spin component that makes the ball hop up
           * (and the side-skip off SERVE_SIDE) is scaled toward the level's
           * kick cap. Rookie serves land and run dead flat. */
          if (this.ai.levelIndex < AI_SERVE_CAPS.length - 1) {
            const kk = AI_SERVE_CAPS[this.ai.levelIndex].kick;
            this.ball.w.x *= kk;   // top/back kick grown by the bounce
            this.ball.w.y *= kk;   // side-skip off the bounce
          }
          if (this.watchdog) this.watchdog.contact({ time: this.time, side: -1, serve: true,
            contact, pad: this.aiPaddle, padBefore: this.aiPaddle.pos, racket });
          V3.copy(this.aiPaddle.pos, this.ball.p);
          V3.copy(this.aiPaddle.normal, racket.normal);
          V3.addScaled(this.ball.p, this.ball.p, racket.normal, PH.R * STROKE_CONFIG.racket.launchSeparation);
          this.serveBounces = 0; this.rallyBounces.length = 0;
          this.applyHit(-1, racket, contact, racket.quality, info);
          this.setState(GS.RALLY);
        }
        if (this.server === 1 && this.ball.lastHitBy === 0) {
          this.tossApex = Math.max(this.tossApex || 0, this.ball.p.y);
          if (this.stateT > STROKE_CONFIG.serve.toss.timeout) this.awardPoint(-1, 'ПОДАЧА НЕ ВЫПОЛНЕНА');
        }
        break;
      case GS.POINT:
        if (this.matchWinner && this.stateT > 1.35) {
          this.setState(GS.MATCH_END);
          this.audio.gameOver(this.matchWinner > 0);
          this.settleMatch();
          this.ui && this.ui.showMatchEnd(this.matchWinner > 0);
          // career progression over the results screen
          if (this.career.active) {
            this.career.onMatchEnd(this.matchWinner);
            if (this.career.state === 'RUN_END') this.ui && this.ui.showCareerRunEnd(this.career);
            else if (this.career.state === 'TOURNAMENT_END') this.ui && this.ui.showCareerTournamentEnd(this.career);
            else if (this.career.state === 'PERK_SELECT') this.ui && this.ui.showCareerPerks(this.career);
            // a win with no perk on offer still needs a way forward: PR #1
            // left this branch with no screen and the run silently stalled
            else if (this.career.state === 'OPPONENT_SELECT') this.ui && this.ui.showCareerOpponentSelect(this.career);
            this.career.save();
          }
        } else if (this.stateT > 1.35) {
          this.rally = 0;
          this.prepServe();
        }
        break;
    }
    /* Move the player's paddle BEFORE the ball. The capture test used to run
     * against the previous frame's pose (the paddle was updated after the
     * substeps), so a bat that had visibly arrived was still a frame behind
     * for the contact — 0.1-0.2 m at a normal swipe speed. */
    this.updatePlayerPaddle(dtReal);
    this.watchdogArmFrame();

    // physics substeps
    if (this.ball.live) {
      this._acc += dt;
      let guard = 0;
      /* How many physics steps this frame will take, so the paddle's own
       * frame-long travel can be split into exactly that many poses. */
      const nSub = Math.max(1, Math.min(400, Math.floor(this._acc / PHYS_DT + 1e-9)));
      this._subK = 0; this._subN = nSub;
      while (this._acc >= PHYS_DT && guard++ < 400) {
        this._subPad = this.substepPadPose(this._subK++, nSub);
        this.stepPhysics(PHYS_DT);
        this._acc -= PHYS_DT;
        if (!this.ball.live) break;
      }
      this._subPad = null;
      // trail history
      const h = this.ball.hist;
      h.push(this.ball.p.x, this.ball.p.y, this.ball.p.z);
      /* Короткий хвост (24 кадра вместо 32) — и вдвое реже точек в буфере. */
      const tcap = Math.round((this._cal && this._cal.trailLen !== undefined ? this._cal.trailLen : 0.33) * TRAIL_POINTS);
      if (!tcap) h.length = 0; else if (h.length > tcap * 3) h.splice(0, 3);
    } else this._acc = 0;

    this.updateStrikeWindow(dtReal);
    this.logInput('frame', { dt: dtReal });
    if (this.state === GS.RALLY || this.state === GS.SERVE_TOSS) this.moments.push(this.time, this);
    if (this.training) {
      this.training.update(dtReal);
      if (this.training.allowAi) this.ai.think(this, dt);
    }
    else if (this.network.isInMatch) {
      // online: the far paddle belongs to the peer, not to the AI
      const op = this.network.opponentRacket;
      V3.copy(this.aiPaddle.pos, op.pos);
      V3.copy(this.aiPaddle.normal, op.normal);
    }
    else this.ai.think(this, dt);
    this.tryAiHit();
    this.particles.update(dt);
    for (const m of this.marks) m.t += dtReal;
    while (this.marks.length && this.marks[0].t > this.marks[0].life) this.marks.shift();
    for (const m of this.messages) m.t += dtReal;
    while (this.messages.length && this.messages[0].t > this.messages[0].dur) this.messages.shift();
    this.hitFlash = Math.max(0, this.hitFlash - dtReal * 3.2);

    // Only the timer advances here. Position and orientation each have one
    // owner in updatePlayerPaddle / PaddleStrokeMotion, before rendering.
    if (this.followThrough.active) {
      this.followThrough.t += dtReal;
      if (this.followThrough.t >= this.followThrough.duration) this.followThrough.active = false;
    }

    // Update anticipation
    if (this.settings.anticipationHint) {
      if (this.anticipation.active) {
        this.anticipation.t += dtReal;
        const progress = this.anticipation.t / this.anticipation.duration;
        if (progress >= 1) {
          this.anticipation.active = false;
        } else {
          // Backswing pull-back — pulls paddle opposite to swipe direction
          const pullAmount = Math.sin(progress * Math.PI) * this.anticipation.intensity * 0.12;
          const offset = V3.mul(V3.new(), this.anticipation.targetDir, -pullAmount);
          V3.copy(this.anticipation.visualOffset, offset);
        }
      } else {
        V3.zero(this.anticipation.visualOffset);
      }
    }

    // Update spin indicator
    if (this.settings.showSpinIndicator && this.ball.live) {
      this.spinIndicator.active = true;
      V3.copy(this.spinIndicator.w, this.ball.w);
      const spinMag = V3.len(this.ball.w);
      if (spinMag > 50) {
        // Color based on spin type relative to ball flight direction:
        // topspin = orange, backspin = blue-cyan, right/left sidespin = green/violet
        const travelSign = this.ball.v.z < 0 ? 1 : -1;
        const topSigned = -travelSign * this.ball.w.x;
        if (Math.abs(this.ball.w.x) > Math.abs(this.ball.w.y)) {
          this.spinIndicator.color = topSigned > 0 ? [1, 0.52, 0.12] : [0.22, 0.68, 1];
        } else {
          this.spinIndicator.color = this.ball.w.y > 0 ? [0.1, 0.85, 0.45] : [0.78, 0.35, 1];
        }
      } else {
        this.spinIndicator.color = [0.8, 0.8, 0.8];
      }
    } else {
      this.spinIndicator.active = false;
    }

    // Update momentum (once per scored point, never per animation frame)
    if (this.settings.momentumBar) {
      const ptSeq = this.lastPoint ? (this.lastPoint.seq || this.lastPoint.at || 1) : 0;
      if (ptSeq && ptSeq !== this._momentumSeenSeq) {
        this._momentumSeenSeq = ptSeq;
        if (this.lastPoint.who > 0) {
          this.momentum.streak++;
          this.momentum.target = Math.min(1, this.momentum.streak / 5);
        } else if (this.lastPoint.who < 0) {
          this.momentum.streak = 0;
          this.momentum.target = 0;
        }
      }
      this.momentum.current = expSmooth(this.momentum.current, this.momentum.target, 3, dtReal);
    }

    if (this.profile) {
      this.profile.data.stats.minutes += dtReal / 60;
      this.profile.maybeSave(dtReal);
    }
    this.updateCamera(dtReal);
    this.keepPaddleOnScreen();
    this.clampPaddleVolume();

    // post-processing: оставлен только тонмап/виньетка. Радиальное «мыло»
    // и хроматический аберрационный сдвиг убраны совсем: они размывали и
    // расщепляли на цветные копии именно мяч в точке удара.
    const P = this.R.post;
    P.radial = 0; P.ca = 0;
    P.flash = this.reducedMotion ? 0 : expSmooth(P.flash, this.hitFlash * 0.03, 10, dtReal);
    P.sat = expSmooth(P.sat, 1.05 + (1 - this.timeScale) * 0.25, 4, dtReal);
    this.audio.setCrowd(clamp(this.rally / 18, 0, 1) * 0.6 + (this.state === GS.POINT ? 0.4 : 0));

    // network: sync state (host) or input (guest)
    if (this.network.isInMatch) {
      if (this.network.isHost) this.network.sendGameState();
      else this.network.sendInput();
    }
    // fps
    this._fpsN++; this._fpsT += dtReal;
    if (this._fpsT > 0.5) { this.fps = this._fpsN / this._fpsT; this._fpsT = 0; this._fpsN = 0; }

    // Update music system — dynamic soundtrack based on game state
    if (this.music && this.music._initialized) {
      this.music.update({
        state: this.state,
        rally: this.rally,
        ball: this.ball,
        settings: this.settings,
        momentum: this.momentum,
        lastPoint: this.lastPoint,
      });
    }

    // Update emotional system — dramatic moments and arc
    if (this.emotion) {
      this.emotion.update(this);
    }

    // Update UI animations
    if (this.ui && this.ui.uiAnim) {
      this.ui.uiAnim.update(performance.now());
    }
    if (this.ui && this.ui.hudAnim) {
      this.ui.hudAnim.update(performance.now());
    }
  }

  /* ------------------------------ render --------------------------- */
  /* Шлейф мяча — тонкая лента постоянной ширины. Раньше ширина росла от
   * скорости и затухала кубом к хвосту, а сама история держалась в 96 точек:
   * получалось почти круглое пятно-облако из десятков аддитивных треугольников.
   * Теперь — одна ширина, короткий хвост, вчетверо меньше геометрии. */
  buildTrail() {
    const h = this.ball.hist, R = this.R, m = this.scene.mesh.trail;
    const n = h.length / 3;
    if (n < 3 || !this.settings.showTrail || this.reducedMotion) { m.count = 0; return; }
    const cam = this.R.camPos;
    let nv = 0, ni = 0;
    const wid = TRAIL_WIDTH;
    for (let i = 0; i < n; i++) {
      const x = h[i * 3], y = h[i * 3 + 1], z = h[i * 3 + 2];
      const nx = i < n - 1 ? h[(i + 1) * 3] : x, ny = i < n - 1 ? h[(i + 1) * 3 + 1] : y, nz = i < n - 1 ? h[(i + 1) * 3 + 2] : z;
      let dx = nx - x, dy = ny - y, dz = nz - z;
      if (i === n - 1 && n > 1) { dx = x - h[(i - 1) * 3]; dy = y - h[(i - 1) * 3 + 1]; dz = z - h[(i - 1) * 3 + 2]; }
      let vx = cam.x - x, vy = cam.y - y, vz = cam.z - z;
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const t = i / (n - 1);
      const w = wid * t;   // линейное сужение к хвосту — без кубов и степени
      sx = sx / sl * w; sy = sy / sl * w; sz = sz / sl * w;
      m.pos[nv * 3] = x - sx; m.pos[nv * 3 + 1] = y - sy; m.pos[nv * 3 + 2] = z - sz;
      m.nrm[nv * 3] = 0; m.nrm[nv * 3 + 1] = 1; m.nrm[nv * 3 + 2] = 0;
      m.uv[nv * 2] = t; m.uv[nv * 2 + 1] = 0; nv++;
      m.pos[nv * 3] = x + sx; m.pos[nv * 3 + 1] = y + sy; m.pos[nv * 3 + 2] = z + sz;
      m.nrm[nv * 3] = 0; m.nrm[nv * 3 + 1] = 1; m.nrm[nv * 3 + 2] = 0;
      m.uv[nv * 2] = t; m.uv[nv * 2 + 1] = 1; nv++;
      if (i > 0) {
        const a = (i - 1) * 2;
        m.idx[ni++] = a; m.idx[ni++] = a + 1; m.idx[ni++] = a + 2;
        m.idx[ni++] = a + 1; m.idx[ni++] = a + 3; m.idx[ni++] = a + 2;
      }
    }
    R.uploadDyn(m, nv, ni);
  }

  billboard(out, pos, size, roll, sy) {
    const t = this._bb || (this._bb = { f: V3.new(), q: Q.new(), q2: Q.new(), s: V3.new(), up: V3.new(0, 1, 0) });
    V3.sub(t.f, this.R.camPos, pos); V3.norm(t.f, t.f);
    Q.lookRotation(t.q, t.f, t.up);
    if (roll) { Q.setAxisAngle(t.q2, t.f.x, t.f.y, t.f.z, roll); Q.mul(t.q, t.q2, t.q); }
    V3.set(t.s, size, sy === undefined ? size : sy, size);
    return M4.compose(out, pos, t.q, t.s);
  }

  drawDynamic(shadowPass) {
    const R = this.R, S = this.scene, me = S.mesh, ma = S.mat;
    const tmp = S._tmp;
    const d = shadowPass
      ? (mesh, mat4, mat) => R.drawShadow(mesh, mat4, null, 0)
      : (mesh, mat4, mat) => R.draw(mesh, mat4, mat);

    /* ball: зелёный мяч — единственный носитель «бей сейчас».
     * Прежняя логика («зелёный = мяч внутри бокса захвата») по замерам в
     * живом матче давала 1 кадр, 17–33 мс: сигнал загорался в тот же миг,
     * когда удар уже случается, и глазами не ловился.
     * Трасса приёма покадрово: окно вообще открывается лишь после отскока
     * на своей стороне и live 2–4 кадра (eta на момент открытия 0.09–0.18 с)
     * — это физический предел честного «бей сейчас». Поэтому тон считается
     * по ВРЕМЕНИ до контакта: с 0.30 с мяч трогается зелёным, с 0.15 с он
     * уже целиком зелёный и держит цвет до удара — то есть зелёный ВСЁ
     * подлетное окно, а не последний кадр.
     * Тонировка идёт по альбедо (сам мяч зелёный), а не по rim-блику:
     * «ёмит+обводка» читались как едва заметный зелёный зайчик.
     * Спекуляр приглушён — белый блик на стеклянном шаре съедал цвет. */
    const STRIKE_FULL = 0.15;
    // помощь хосту (g.hintContact): заевшемуся игроку мяч зеленеет заранее
    const STRIKE_LEAD = this.hintContact ? 0.45 : 0.30;
    if (this.ball.live || this.state === GS.SERVE_READY || this._idleStill) {
      const BS = (this._cal && this._cal.ballSize !== undefined) ? (0.8 + this._cal.ballSize * 0.5) : 1;
      M4.compose(tmp.m, this.ball.p, this.ball.q, V3.set(tmp.scl, BS, BS, BS));
      const gk = shadowPass ? 0 : strikeGreenTint(this._strike, STRIKE_LEAD, STRIKE_FULL);
      if (gk > 0.02) {
        let gm = this._ballGreen;
        if (!gm) {
          gm = this._ballGreen = Object.assign({}, ma.ball);
          // Object.assign делит массивы с базовым материалом — own copies
          gm.color = ma.ball.color.slice();
          gm.emissive = ma.ball.emissive.slice();
        }
        const bc = ma.ball.color, be = ma.ball.emissive, c = gm.color, e = gm.emissive;
        c[0] = lerp(bc[0], 0.26, gk); c[1] = lerp(bc[1], 1.0, gk); c[2] = lerp(bc[2], 0.42, gk);
        e[0] = lerp(be[0], 0.03, gk); e[1] = lerp(be[1], 0.42, gk); e[2] = lerp(be[2], 0.13, gk);
        gm.specTint = lerp(ma.ball.specTint, 0.35, gk);
        gm.rim = lerp(ma.ball.rim, 0.12, gk);
        gm.rimCol = [0.3, 1.0, 0.45]; gm.rimPower = 2.8;
        d(me.ball, tmp.m, gm);
      } else {
        d(me.ball, tmp.m, ma.ball);
      }
    }

    /* Paddle-only rendering. Physics and visuals share the same face normal;
       rendering must not mutate the simulation's orientation. */
    if (this.playerPaddleVisible) {
      const pp = this.player;
      /* The telegraph lives here and only here: the simulation keeps the
       * blade on the ball, the drawing pulls it back for the wind-up. */
      const ao = this.anticipation.active ? this.anticipation.visualOffset : null;
      const dpos = this._drawPadPos || (this._drawPadPos = V3.new());
      if (ao && (ao.x || ao.y || ao.z)) V3.set(dpos, pp.pos.x + ao.x, pp.pos.y + ao.y, pp.pos.z + ao.z);
      else V3.copy(dpos, pp.pos);
      this.rig.draw(R, S, {
        pos: dpos, normal: pp.normal, hand: this.settings.hand, shadowPass,
        swing: pp.swing, roll: pp.roll || 0, absoluteRoll: true,
        mats: this.paddleMats(S, this.equip),
      });
    }

    // Opponent paddle; no hand, forearm or sleeve geometry.
    const ap = this.aiPaddle;
    if (this._idleStill) {
      /* Витрина: ракетка ИИ лежит плашмя на дальней половине стола —
       * та же заготовка, что и у игрока в stageIdleArena. */
      const flat = V3.set(V3.new(), 0.05, 1, -0.16); V3.norm(flat, flat);
      this.rig.draw(R, S, {
        pos: this.ai.pos, normal: flat, hand: this.settings.hand === 'right' ? 'left' : 'right',
        swing: 0, roll: 0, mats: this.paddleMats(S, this.aiEquip), shadowPass,
      });
      return;
    }
    const an = V3.norm(V3.new(), V3.sub(V3.new(), this.ball.p, this.ai.pos));
    an.z = Math.abs(an.z) * 1 || 1;
    // Blend "look at the ball" with the stroke's own face angle, so the
    // backswing visibly opens for a chop and closes for a loop.
    const fn = this.ai.faceNormal, wd = clamp(this.ai.anim.windup, 0, 1);
    const aiNorm = V3.norm(V3.new(), V3.new(
      an.x * 0.4 * (1 - wd * 0.5),
      lerp(-0.1 + an.y * 0.3, fn.y * 1.5, wd),
      1));
    V3.copy(ap.normal, aiNorm);
    V3.copy(ap.pos, this.ai.pos);

    this.rig.draw(R, S, {
      pos: ap.pos, normal: aiNorm, hand: this.settings.hand === 'right' ? 'left' : 'right',
      swing: -this.ai.anim.swing, roll: (this.ai.anim.lean || 0) * 0.22,
      mats: this.paddleMats(S, this.aiEquip), shadowPass,
    });

  }

  /** Everything that touches a horizontal surface gets a soft blob of shade:
   *  the one cue that actually tells you how high the ball is.
   *  Намеренно просто: три круга, без промежуточных веток «на столе / не на
   *  столе» и без масштабирования от высоты — пятна читаются, а альфы и
   *  геометрии вдвое меньше. */
  drawContactShadows() {
    const R = this.R, S = this.scene, b = this.ball;
    const TY = PH.TABLE_Y, HW = PH.T_HALF_WID + 0.05, HL = PH.T_HALF_LEN + 0.05;
    S.blob(R, 0, 0, 0, 0, 1, 0.23, 1);                       // under the table
    const onTable = (x, z) => Math.abs(x) < HW && Math.abs(z) < HL;

    if ((b.live || this.state === GS.SERVE_READY) && onTable(b.p.x, b.p.z) && b.p.y > TY - 0.02) {
      S.blob(R, b.p.x, b.p.y, b.p.z, TY, 0.085, 0.40, 1);
    }
    /* Ракетки: одно пятно, только когда ракетка над столом. Тень за его
     * пределами игроку ничего не сообщает, а кадр заливает. */
    const pp = this.player.pos;
    if (onTable(pp.x, pp.z)) S.blob(R, pp.x, pp.y, pp.z, TY, 0.16, 0.33, 1.1);
    const ap = this.aiPaddle.pos;
    if (onTable(ap.x, ap.z)) S.blob(R, ap.x, ap.y, ap.z, TY, 0.15, 0.27, 1.15);
  }

  /** Short haptic pulse on touch devices. Silent no-op everywhere else. */
  buzz(ms) {
    if (!this.settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
  }

  drawFX() {
    const R = this.R, S = this.scene, me = S.mesh;
    const tmp = S._tmp;
    /* trail */
    this.buildTrail();
    if (me.trail.count) {
      /* Trail = the VERDICT on your input, not the spin family:
       *  green  = perfect place AND perfect timing (nearly always a winner),
       *  yellow = counted, but on the edge of a miss,
       *  red    = wrong place or wrong time.
       *  The opponent's returns keep the old spin palette. */
      let col, k;
      const grade = this.ball.trailGrade && this.ball.lastHitBy === 1 ? this.ball.trailGrade : null;
      if (grade) {
        if (grade === 'green' && Array.isArray(this._customTrailCol)) {
          col = this._customTrailCol;
        } else {
          col = { green: [0.18, 1.0, 0.42], yellow: [1.0, 0.80, 0.16], red: [1.0, 0.13, 0.12] }[grade];
        }
        k = grade === 'green' ? 1.0 : 0.9;
      } else if (this.ball.lastHitBy === 1 && Array.isArray(this._customTrailCol)) {
        col = this._customTrailCol;
        k = 0.72;
      } else {
        col = [0.9, 0.92, 0.95];
        k = 0.4;
      }
      R.draw(me.trail, M4.identity(tmp.m), {
        color: [1, 1, 1], rough: 1, blend: 'add', doubleSided: true,
        emissive: [col[0] * k, col[1] * k, col[2] * k], opacity: grade ? 0.42 : 0.12,
      });
    }

    /* bounce marks */
    for (const mk of this.marks) {
      const a = clamp(1 - mk.t / mk.life, 0, 1);
      const sz = mk.s * (1 + (1 - a) * 1.8);
      M4.compose(tmp.m, V3.new(mk.x, PH.TABLE_Y + 0.0035, mk.z),
        Q.setAxisAngle(Q.new(), 1, 0, 0, -Math.PI / 2), V3.new(sz, sz, sz));
      R.draw(me.quad, tmp.m, {
        color: [1, 1, 1], tex: this.scene.tex.ring, blend: 'add', doubleSided: true,
        emissive: [a * 0.9, a * 0.85, a * 0.6], rough: 1,
      });
    }

    /* predicted landing spot: без пульсации — мигающая метка на столе
     * только шумела, место приземления читается и статичной */
    if (this.settings.showPredict && this.ball.live && this.predictOut.landed && this.ball.lastHitBy === 1) {
      const L = this.predictOut.landed;
      M4.compose(tmp.m, V3.new(L.x, PH.TABLE_Y + 0.004, L.z),
        Q.setAxisAngle(Q.new(), 1, 0, 0, -Math.PI / 2), V3.new(0.055, 0.055, 0.055));
      R.draw(me.quad, tmp.m, {
        color: [1, 1, 1], tex: this.scene.tex.ring, blend: 'add', doubleSided: true,
        emissive: [0.15, 0.95, 0.55], rough: 1,
      });
    }

    /* particles */
    const P = this.particles;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      const a = P.life[i] / P.maxLife[i];
      const sz = P.size[i] * (0.4 + a * 1.4);
      this.billboard(tmp.m, V3.new(P.p[i * 3], P.p[i * 3 + 1], P.p[i * 3 + 2]), sz, 0);
      R.draw(me.quad, tmp.m, {
        color: [1, 1, 1], tex: this.scene.tex.glow, blend: 'add', doubleSided: true,
        emissive: [P.col[i * 3] * a * 1.6, P.col[i * 3 + 1] * a * 1.6, P.col[i * 3 + 2] * a * 1.6], rough: 1,
      });
    }

    /* Свечение вокруг мяча убрано: аддитивный ореол поверх и без того
     * светлого мяча размывал его силуэт именно там, где надо бить.
     * Мяч держится в кадре за счёт emissive в материале и тёмной арены. */
  }

  /** The opponent is deliberately NOT a character model: a floating bat
   *  reads the incoming stroke far better than a torso in the way of the
   *  ball, and nothing about a low-poly human helps you play. */
  drawOpponent() {}


  render() {
    const R = this.R;
    if (R.beginShadow()) {
      this.scene.drawStatic(R, true);
      this.drawDynamic(true);
    }
    R.beginScene([0.018, 0.022, 0.032]);
    this.scene.drawStatic(R, false);   // court, grounded table and shadows
    this.drawContactShadows();         // soft grounding shade — единственная «подложка» мяча
    this.drawDynamic(false);           // ball + bats (opaque)
    this.scene.drawNet(R);             // alpha-blended net on top of them
    this.drawFX();                     // additive trail / particles / decals
    R.present(this.reducedMotion ? 0 : this.time);
  }
}

function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
