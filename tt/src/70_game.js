/* =====================================================================
 *  GAME — state machine, ITTF rules, continuous collision detection,
 *  camera rig, VFX, replay recorder.
 * ===================================================================== */
'use strict';

/* Where the opponent's bat meets its own toss, metres above the table. */
const AI_SERVE_CONTACT_Y = 0.36;

const GS = {
  MENU: 'MENU', SERVE_READY: 'SERVE_READY', SERVE_TOSS: 'SERVE_TOSS',
  RALLY: 'RALLY', POINT: 'POINT', REPLAY: 'REPLAY', MATCH_END: 'MATCH_END',
};

const PHYS_DT = PH.SIM_DT;        // 600 Hz — and the same step every solver verdicts on

/* Gesture vocabulary default. 'classic' plays backspin with a downward
 * swipe; 'safe' never needs one (see classifyStroke) because a downward
 * drag belongs to the host app — Telegram collapses the whole mini app on
 * swipe-down, and system gestures fight it elsewhere. Coarse pointers and
 * embedded apps start in 'safe'; a saved choice always wins. */
function defaultGestureProfile() {
  try {
    if (typeof window !== 'undefined' && window.__tgWebApp) return 'safe';
  } catch (e) { /* headless */ }
  try {
    return (typeof detectInputMode === 'function' ? detectInputMode() : 'mouse') === 'touch'
      ? 'safe' : 'classic';
  } catch (e) { return 'classic'; }
}

/* --------------------------- particles ----------------------------- */
class Particles {
  constructor(max = 260) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max); this.col = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, grav) {
    const i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.grav[i] = grav === undefined ? 4 : grav;
  }
  burst(x, y, z, n, speed, life, size, r, g, b, dir) {
    for (let i = 0; i < n; i++) {
      let vx = rndSym(1), vy = rndSym(1), vz = rndSym(1);
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      if (dir) { vx = vx * 0.5 + dir.x; vy = vy * 0.5 + dir.y; vz = vz * 0.5 + dir.z; }
      const s = speed * rnd(0.35, 1);
      this.spawn(x, y, z, vx * s, vy * s, vz * s, life * rnd(0.6, 1.2), size * rnd(0.6, 1.3), r, g, b);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      this.v[i * 3] *= 1 - 2.2 * dt; this.v[i * 3 + 2] *= 1 - 2.2 * dt;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
    }
  }
}

/* --------------------------- the game ------------------------------ */
class Game {
  constructor(canvas, ui) {
    this.canvas = canvas;
    this.ui = ui;
    /* Debug bisect switches, read once from the URL (?cut=hud,fx,blur,audio,path).
     * Each one hard-disables a whole group of effects, so a stutter can be
     * attributed to a subsystem by reloading the page, not by rebuilding it.
     * Not a player-facing option: nothing is persisted and no cut is on by
     * default. */
    this.cut = (() => {
      let params = null;
      try { params = new URLSearchParams(location.search); } catch (_) {}
      const q = (params && params.get('cut')) || '';
      const set = new Set(q.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
      return { hud: set.has('hud'), fx: set.has('fx'), blur: set.has('blur'),
        audio: set.has('audio'), path: set.has('path'),
        ft: set.has('ft'), antic: set.has('antic'), guard: set.has('guard') };
    })();
    /* ?diag=1 records frame durations and the events that surround them, then
     * downloads the report — the only way to see the numbers on a machine we
     * cannot profile (the console blocks pasting on the user's side). */
    this.diagMode = (() => {
      try { return new URLSearchParams(location.search).get('diag') === '1'; } catch (_) { return false; }
    })();
    if (this.diagMode) this.cut = { hud: false, fx: false, blur: false, audio: false, path: false,
      ft: false, antic: false, guard: false };
    this.R = new Renderer(canvas, { quality: 'high' });
    this.scene = new Scene(this.R, 'arena');
    this.audio = new AudioEngine();
    if (this.cut.audio) this.audio.disabled = true;
    this.ai = new OpponentAI(2);
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
      serveToss: 1.2,                // multiplier on the ~0.31 m ITTF toss rise
      /* Optional human-side help. Defaults keep the authored contract intact
       * (1 / .85 / 1 == MATCH_RULES); these only widen the PLAYER's own
       * capture window, press zone, assists and cursor gain — never the AI. */
      capScale: 1,           // physical reach window multiplier
      zoneScale: 1,          // press-zone admission multiplier
      aimAssist: 0.85,       // trajectory correction (authored .85)
      footAssist: 0.85,      // footwork auto-approach (authored .85)
      batSens: 1,            // cursor gain (authored 1)
      slowmoOnBigShots: false, // no automatic hit-stop; explicit slowmo remains available
      targetScore: 11,
      spinBias: 'norm',
      gestureProfile: defaultGestureProfile(),   // 'classic' | 'safe'
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
    if (this.cut.path) this.settings.showPredict = false;

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
    // Presets are the baseline; mouse controls are session-local and resettable.
    this.cameraControls = { zoom: 1, height: 0 };
    this.camShiftY = 0;
    this.camRig = { eye: V3.new(0, 1.68, 2.38), look: V3.new(0, 0.74, -0.25), fov: 48, mode: 'BROADCAST' };
    this._rigBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() };
    this.camVP = M4.create();          // view·proj of the authored rig, no shake
    this.hudBandY = 0.72;              // screen y below the full table's feet
    this.camPos = V3.new(0, 1.68, 2.38); this.camLook = V3.new(0, 0.74, -0.25);
    this.camPosT = V3.clone(this.camPos); this.camLookT = V3.clone(this.camLook);
    this.fov = 48; this.fovT = 48;
    this.marks = [];
    this.stats = {
      shots: 0, winners: 0, errors: 0, maxSpeed: 0, maxSpin: 0,
      byStroke: {}, totalSpin: 0, rallies: 0,
    };
    this.replayBuf = []; this.replayMax = 360; this.replay = null;
    this.slowmo = { on: false, energy: 1, active: false, allowed: true, used: 0 };
    this.predictPath = [];
    this.predictOut = {};
    this.lastShotInfo = null;
    this.messages = [];
    this.hitFlash = 0;
    this.serveHint = 0;
    this._acc = 0;
    this._fpsT = 0; this._fpsN = 0; this.fps = 60;
    this.peakMs = 0; this._peakAcc = 0;

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
  measurePressZone(pointer, pointerType) {
    const rect = this.canvas.getBoundingClientRect();
    const serveReady = this.state === GS.SERVE_READY && this.server === 1;
    const servePress = (serveReady || this.state === GS.SERVE_TOSS) && this.server === 1;
    /* Optional admission help: widen the press oval so a press a little
     * further from the ball still counts (default 1 = authored shape). */
    const zs = clamp(Number.isFinite(this.settings.zoneScale) ? this.settings.zoneScale : 1, 0.8, 2.5);
    /* The serve press-zone doubles on top of the accessibility slider so a
     * press anywhere near the tossed ball always registers. */
    const serveMul = servePress ? 2 : 1;
    const zoneSide = (pointerType === 'mouse' ? MATCH_RULES.ovalSideMousePx : MATCH_RULES.ovalSideTouchPx) * zs * serveMul;
    const ballZone = pressZoneForBall(this.ball, pointer, rect.width, rect.height, {
      project: point => this.project(point, {}), pointerType,
      referenceWorld: this.player && this.player.pos,
      kind: servePress ? 'serve' : 'rally',
      deferServeTiming: true,
      tossApex: this.tossApex, tossStartY: this.tossStartY, tableY: PH.TABLE_Y,
      sidePx: zoneSide, fwdPx: MATCH_RULES.ovalForwardPx * zs * serveMul,
      backPx: MATCH_RULES.ovalBackPx * zs * serveMul, forwardMaxPx: MATCH_RULES.ovalForwardMaxPx * zs * serveMul,
      radius: MATCH_RULES.pressRadiusPx * zs * serveMul,
    });
    const zone = ballZone || { accepted: false, shape: MATCH_RULES.zoneShape,
      radius: MATCH_RULES.pressRadiusPx, distancePx: null, score: null, along: null,
      across: null, reason: 'OUTSIDE_ZONE', pointerType };
    // The ready-state press is a TOSS command, not an attempt to hit the
    // pre-toss ball. The toss moves to the player's stance, so testing the
    // old ball position here rejects a valid first drag. Its actual stroke
    // still needs motion, a legal falling toss and physical capture.
    if (serveReady) {
      zone.accepted = true;
      zone.reason = null;
      zone.via = 'serve-init';
    }
    return zone;
  }

  /* ------------------------ training preview ----------------------- */
  /* A synthetic hand used by the training demo (65_train.js). It stamps the
   * SAME press zone, the same stance depth and the same gesture tracker as a
   * real pointerdown, because the preview must be admitted, aimed and captured
   * by the real rules — a bot that bypasses them would teach a stroke that
   * does not work. Only DOM bookkeeping (pointer capture, the shot journal,
   * which records human attempts) is skipped. */
  demoPress(x, y) {
    const n = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    const rect = this.canvas.getBoundingClientRect();
    this.swipe.down(n.x, n.y, this.time);
    this.stanceY = n.y;
    const zone = this.measurePressZone(n, 'mouse');
    zone.pressX = n.x; zone.pressY = n.y;
    zone.vw = rect.width; zone.vh = rect.height;
    zone.pointerId = -1;
    zone.pointerType = 'mouse';
    zone.pressT = this.time;
    zone.serving = this.state === GS.SERVE_READY || this.state === GS.SERVE_TOSS;
    this.swipe.pressZone = zone;
    this.demoPointer = { x: n.x, y: n.y };
    this.pointerFine = true;
    this.pointerDown = true;
    if (this.state === GS.SERVE_READY && this.server === 1) this.startToss();
  }

  /* `t` lets the preview emit several samples per frame: a swipe's curl is
   * the turning BETWEEN consecutive samples, so a fast gesture sampled once
   * a frame loses its curve. Absent, the sample is stamped with the frame. */
  demoMove(x, y, t) {
    const n = { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
    this.demoPointer = n;
    if (this.swipe.active) this.swipe.move(n.x, n.y, Number.isFinite(t) ? t : this.time);
  }

  demoRelease() {
    const p = this.demoPointer || { x: 0.5, y: 0.55 };
    if (this.swipe.active) this.swipe.up(p.x, p.y, this.time);
    this.pointerDown = false;
    this.swipeReleasedAt = this.time;
  }

  demoStop() {
    this.demoPointer = null;
    this.pointerDown = false;
    if (this.swipe.active) this.swipe.cancel();
  }

  bindInput() {
    const c = this.canvas;
    /* Screen → surface coordinates. A pointer event with a non-finite or
       absurd coordinate (broken touch driver, synthetic event, detached
       canvas with a zero-size rect) used to poison the paddle transform
       permanently: one NaN reached the smoothing filter and the racket
       never came back. Sanitise at the boundary, in one place. */
    const normXY = (e) => {
      const r = c.getBoundingClientRect();
      const w = r.width > 0 ? r.width : (c.clientWidth || 1);
      const h = r.height > 0 ? r.height : (c.clientHeight || 1);
      let x = (e.clientX - r.left) / w;
      let y = (e.clientY - r.top) / h;
      if (!Number.isFinite(x)) x = 0.5;
      if (!Number.isFinite(y)) y = 0.5;
      return { x, y };
    };
    /* Aiming is clamped: outside the canvas the bat used to be parked a
       quarter of a screen beyond the edge, where the camera never looks.
       The gesture is NOT clamped — dragging past the top of the window used
       to pin every following sample at y=0, so the release speed of a serve
       flick collapsed exactly when the hand left the page. */
    const norm = (e) => { const p = normXY(e); return { x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }; };
    const normRaw = normXY;

    // Left pointer = stroke. Right vertical drag = height; wheel = dolly.
    let cameraDrag = null;
    let strokePointerId = null;
    const ptrs = new Map();
    const dropStroke = () => {
      this.swipe.cancel();
      this.pointerDown = false;
      strokePointerId = null;
    };

    this.cancelInput = () => {
      ptrs.clear(); cameraDrag = null; dropStroke();
      this.tossQueued = false;
      if (this.anticipation) this.anticipation.active = false;
    };
    const down = (e) => {
      if (this.paused || this.state === GS.MENU || this.state === GS.MATCH_END) return;
      if (e.button === 2) {
        if (e.pointerType && e.pointerType !== 'mouse') return;
        this.cancelInput();
        cameraDrag = { id: e.pointerId, y: e.clientY };
        e.preventDefault(); return;
      }
      if (e.button === 1) { e.preventDefault(); return; }
      if (this.demoMode) this.stopDemo(); // a real stroke always takes control
      this.audio.init(); this.audio.resume();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();
      /* The training preview is not a shot. A press ends it and the drill
       * serves immediately (Trainer.exitDemo), so taking over costs one click
       * and never a rejected attempt. The first moments after the preview is
       * requested belong to the button, which sits over the same canvas on
       * some layouts — that press is swallowed, not read as a takeover. */
      if (this.training && this.training.isDemo && this.training.isDemo()) {
        if (this.time >= (this.training.demoGuardUntil || 0)) this.training.exitDemo();
        return;
      }

      if (this.replayer.on) { this.skipReplay(); return; }   // tap = skip the reel
      if (ptrs.size >= 2) {                          // a second finger cancels
        dropStroke();
        return;
      }
      const n = norm(e);

      // ---- ANTICIPATION TRIGGER ----
      // Before a swipe, pull the paddle back slightly to telegraph
      // the upcoming stroke. This is critical for game feel.
      if (this.settings.anticipationHint && !this.reducedMotion && !this.anticipation.active) {
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

      const raw = normRaw(e);
      this.swipe.down(raw.x, raw.y, this.time);
      strokePointerId = e.pointerId;
      this.stanceY = n.y;
      const rect = c.getBoundingClientRect();
      const pointerType = e.pointerType || (this.pointerFine === false ? 'touch' : 'mouse');
      this.swipe.pressZone = this.measurePressZone(n, pointerType);
      /* Admission is stamped once, here, from the ball at pointerdown.
       * Moving into the zone later, landing on the bat, position assist and
       * CCD are all downstream of this stamp and cannot rewrite it. */
      this.swipe.pressZone.pressX = n.x; this.swipe.pressZone.pressY = n.y;
      this.swipe.pressZone.vw = rect.width; this.swipe.pressZone.vh = rect.height;
      this.swipe.pressZone.pointerId = e.pointerId;
      this.swipe.pressZone.pointerType = pointerType;
      this.swipe.pressZone.pressT = this.time;
      this.swipe.pressZone.serving = this.state === GS.SERVE_READY || this.state === GS.SERVE_TOSS;
      if (this.shotJournal) {
        const attempt = this.shotJournal.create(this.swipe.gestureId, this.time);
        attempt.pressZone = { ...this.swipe.pressZone };
        attempt.deadline = this.time + (attempt.pressZone.serving ? 1.15 : .25);
        if (!attempt.pressZone.accepted) attempt.outcome = 'outside';
      }
      /* Mouse hover already drives the BAT. Committing that trail (or worse,
         inventing a 3.5 % upward flick) on button-down made a motionless
         click look like a stroke — the ball came off the rubber with no
         swing. Desktop now matches touch: the stroke is the drag while the
         button is down. Hover still aims; it does not hit. */
      this.pointer = n; this.pointerDown = true;
      this.pointerFine = e.pointerType !== 'touch' && e.pointerType !== 'pen';
      this.logInput('pointerdown', { pointer: n, pointerId: e.pointerId, buttons: e.buttons, inputType: pointerType });
      if (this.state === GS.SERVE_READY && this.server === 1) this.startToss();
    };

    // Hover aims only on the play surface. UI/paused/replay movement must
    // not overwrite the last gameplay target behind an overlay.
    const track = (e) => {
      const blocked = this.paused || this.replayer.on || this.state === GS.MENU ||
        this.state === GS.MATCH_END || this.state === GS.POINT;
      if (this.cut.guard && blocked) return this.pointer;
      const n = norm(e);
      this.pointer = n;
      if (e.pointerType) this.pointerFine = e.pointerType !== 'touch' && e.pointerType !== 'pen';
      if (e.pointerType === 'mouse') {
        this.mouseTrail = (this.mouseTrail || []).filter(p => this.time - p.t < 0.14);
        this.mouseTrail.push({ x: n.x, y: n.y, t: this.time });
        if (this.mouseTrail.length > 64) this.mouseTrail.shift();
      }
      this.pointerInside = n.x > 0.001 && n.x < 0.999 && n.y > 0.001 && n.y < 0.999;
      if (!this.swipe.active && e.pointerType === 'mouse' && !e.buttons) this.stanceY = n.y;
      return n;
    };

    const move = (e) => {
      if (cameraDrag && cameraDrag.id === e.pointerId) {
        if (!(e.buttons & 2)) { cameraDrag = null; return; }
        const dy = e.clientY - cameraDrag.y;
        cameraDrag.y = e.clientY;
        if (Number.isFinite(dy)) this.cameraControls.height = clamp(this.cameraControls.height - dy * 0.012, -1, 2.5);
        e.preventDefault(); return;
      }
      const p = ptrs.get(e.pointerId);
      // Only the pointer that began the stroke may contribute samples.
      // Multi-touch cancels until ALL fingers have lifted.
      if (this.cut.guard && ptrs.size && (ptrs.size > 1 || e.pointerId !== strokePointerId)) return;
      if (this.cut.guard && !p && (this.swipe.active || (e.pointerType && e.pointerType !== 'mouse'))) return;
      if (this.cut.guard && (this.paused || this.state === GS.MENU || this.state === GS.MATCH_END || this.replayer.on)) return;
      if (this.cut.guard && p && e.pointerType === 'mouse' && !(e.buttons & 1)) {
        this.cancelInput(); // recover from a button-up lost outside the tab
        track(e); return;
      }
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      const raw = normRaw(e);
      const n = track(e);
      if (this.swipe.active && ptrs.size < 2) {
        this.swipe.move(raw.x, raw.y, this.time);
        const sp = this.swipe.m.speed;
        if (sp > 1.6) this.audio.whoosh(clamp(sp / 4, 0, 1.4));
        this.logInput('pointermove', { pointer: n, pointerId: e.pointerId, buttons: e.buttons,
          inputType: e.pointerType || (this.pointerFine === false ? 'touch' : 'mouse') });
      }
      if (e.cancelable) e.preventDefault();
    };

    const up = (e) => {
      if (cameraDrag && cameraDrag.id === e.pointerId) { cameraDrag = null; e.preventDefault(); return; }
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (e.button === 2 || e.button === 1) { e.preventDefault(); return; }
      if (ptrs.size >= 1) { e.preventDefault(); return; }   // still another finger down
      if (!this.swipe.active) { this.pointerDown = false; return; }
      const n = norm(e);
      this.pointer = n;
      const raw = normRaw(e);
      this.swipe.up(raw.x, raw.y, this.time);
      strokePointerId = null;
      this.pointerDown = false;
      this.swipeReleasedAt = this.time;
      this.updateShotDiagnostics();
      this.logSwipeRelease({ pointer: n, pointerId: e.pointerId, buttons: e.buttons,
        inputType: e.pointerType || (this.pointerFine === false ? 'touch' : 'mouse') });
      this.lastSwipeT = this.time;
      e.preventDefault();
    };

    c.addEventListener('pointerdown', (e) => {
      down(e);
      if (ptrs.has(e.pointerId) || (cameraDrag && cameraDrag.id === e.pointerId)) {
        try { c.setPointerCapture(e.pointerId); } catch (_) { this.cancelInput(); }
      }
    });
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => this.cancelInput());
    c.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId) || (cameraDrag && cameraDrag.id === e.pointerId)) this.cancelInput(); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // Hover movement follows the bat, except while the right button owns the camera.
    window.addEventListener('pointermove', (e) => {
      if (e.target !== document.documentElement) return;
      if (!ptrs.size && !cameraDrag && !e.buttons && e.pointerType === 'mouse') track(e);
    }, { passive: true });
    window.addEventListener('blur', () => { this.cancelInput(); this.setPaused(true); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.cancelInput(); this.setPaused(true); this.profile.save(true); }
    });
    window.addEventListener('pagehide', () => { this.saveSettings(); this.profile.save(true); this.career.save(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.state === GS.MENU || this.state === GS.MATCH_END || this.replayer.on) return;
      const units = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1;
      const delta = clamp(e.deltaY * units, -200, 200);
      if (Number.isFinite(delta)) this.cameraControls.zoom = clamp(this.cameraControls.zoom * Math.exp(delta * 0.0015), 0.72, 1.6);
    }, { passive: false });
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
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.quality === 'low' ? 1.25 : 2);
    /* getBoundingClientRect is fractional and survives a not-yet-laid-out
     * canvas better than clientWidth; window.innerWidth is the last-resort
     * fallback only — in an embedded frame it can disagree with the CSS box
     * the canvas is actually stretched to, which skews the whole projection. */
    const r = this.canvas.getBoundingClientRect();
    const w = r.width || this.canvas.clientWidth || window.innerWidth;
    const h = r.height || this.canvas.clientHeight || window.innerHeight;
    this.R.resize(w, h, dpr);
    this.vw = w; this.vh = h;
  }

  /* The GL buffer must track the canvas' on-screen rect exactly: the 2D fx
   * overlay is normalised against that rect, and any drift (an embedder that
   * resizes the iframe without firing window `resize`, a boot-time layout that
   * settles after the first resize()) stretches the 3D projection away from
   * the cursor, the reticle and the strike ring. `resize()` early-exits inside
   * GL when nothing changed, so polling a fractional rect per frame is cheap. */
  syncSize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (Math.abs(r.width - this.vw) > 0.5 || Math.abs(r.height - this.vh) > 0.5) this.resize();
  }

  /* --------------------------- match flow -------------------------- */
  startMatch(diff) {
    this.endReplay(false); // cancel old callbacks; never complete an old match here
    this.moments.reset();
    if (this.inputLog && typeof this.inputLog.resetClock === 'function') this.inputLog.resetClock(this.time);
    this.shotJournal && this.shotJournal.reset();
    this.lastMoment = null;
    this._acc = 0;
    this.followThrough.active = false;
    this.anticipation.active = false;
    this.audio.stopAudience();
    this._demoGesture = null;
    this.matchTasks = { topspin: 0, smash: 0, serves: 0, moments: 0 };
    this.training = null;
    this.matchWinner = 0;
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
    // career: the chop perk slows the opponent, always from the base speed
    if (this.career.active && this._careerAISlowdown < 1) {
      this.ai.maxSpeed = this.ai.L.move * this._careerAISlowdown;
    }
    // career and online are scored modes: no bullet time there
    this.setSlowmoAllowed(!(this.career.active || this.network.isInMatch));
    this.score = [0, 0]; this.games = [0, 0];
    this.rally = 0; this.bestRally = 0;
    this.stats = { shots: 0, winners: 0, errors: 0, maxSpeed: 0, maxSpin: 0, byStroke: {}, totalSpin: 0, rallies: 0 };
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
    this._keepDemo = true;
    this.demoMode = true;
    this.startMatch(diff);
  }
  stopDemo() {
    this.demoMode = false;
    this._demoGesture = null;
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
  startTraining() {
    this.endReplay(false);
    this.shotJournal && this.shotJournal.reset();
    this.career.stop();
    this.network.disconnect();
    this.demoMode = false;
    this.setSlowmoAllowed(true);
    this.timeScale = this.targetTimeScale = 1; this.slowmoUntil = 0;
    this.resetPaddle(true);
    this.score = [0, 0]; this.rally = 0; this.bestRally = 0;
    this.matchWinner = 0;
    this.messages.length = 0;
    this.audio.init(); this.audio.resume();
    this.training = new Trainer(this);
    this.training.begin();
    this.ui && this.ui.trainShow(this.training);
    if (typeof document !== 'undefined' && document.body) document.body.classList.add('is-playing');
  }
  stopTraining() {
    if (this.training) this.training.quit();
    if (typeof document !== 'undefined' && document.body) document.body.classList.remove('is-playing');
  }

  setState(s) {
    this.state = s; this.stateT = 0; if (this.paused) this.setPaused(false);
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('is-playing', s !== GS.MENU && s !== GS.MATCH_END);
    }
  }

  /* Pause only makes sense during a live rally or serve prep; leaving the play
     state (restart, match end) always clears it so the overlay can't stick. */
  setPaused(v) {
    const play = this.state === GS.RALLY || this.state === GS.SERVE_READY ||
                 this.state === GS.SERVE_TOSS || this.state === GS.POINT;
    this.paused = !!v && play;
    if (this.paused && this.cancelInput) this.cancelInput();
    if (typeof document !== 'undefined' && document.body)
      document.body.classList.toggle('is-paused', this.paused);
  }

  msg(text, dur = 1.4, col = '#fff', big = false) {
    this.messages.push({ text, t: 0, dur, col, big });
    if (this.messages.length > 4) this.messages.shift();
  }

  /* --------------------------- serving ----------------------------- */
  prepServe() {
    const s = this.server;
    const b = this.ball;
    const x = s > 0 ? 0 : rndSym(0.26);
    V3.set(b.p, x, PH.TABLE_Y + 0.17, s * (PH.T_HALF_LEN + 0.20));
    V3.zero(b.v); V3.zero(b.w); Q.identity(b.q);
    b.live = false; b.hist.length = 0; b.lastHitBy = 0; this.netTouched = false;
    this.rallyBounces.length = 0;
    this.serveBounces = 0;
    this.isServeBall = true;
    /* Every point begins from the same known state: bat back in the centre,
     * cursor binding re-anchored, no stale intercept from the last rally. */
    this.resetPaddle();
    this.setState(GS.SERVE_READY);
    this.audio.resetRally();
    this.recorder.begin(this.time, s);
    this.moments.beginRally(this.time, this.score);
    this.ai.setPressure(this.score[1], this.score[0], this.settings.targetScore);
    if (s < 0) this.aiServeTimer = rnd(0.7, 1.3);
  }
  /** Keep the opponent's bat glued under the ball it is about to toss and
   *  strike, so its serve reads as one motion instead of a racket standing
   *  at home while the ball climbs away from it. */
  aiServeHold() {
    const b = this.ball;
    V3.set(this.ai.pos, b.p.x, b.p.y - 0.07, b.p.z);
    V3.copy(this.ai.target, this.ai.pos);
    V3.copy(this.ai._moveSmooth, this.ai.pos);
  }
  startToss() {
    /* Not while the bat is still gliding home. The requirement is that every
     * new point starts from the centre, and a toss struck mid-glide is struck
     * from wherever the last rally happened to leave the bat — which is how
     * "the racket drifts off and stays there" survived the reset. The click is
     * NOT swallowed: it is queued and fired the instant the reset finishes, so
     * serving immediately costs a third of a second of the intermission. */
    if (this.recenterT > 0) { this.tossQueued = true; return; }
    this.tossQueued = false;
    const b = this.ball;
    const pad = this.player;
    // ITTF requires a near-vertical toss of at least 16 cm; we throw ~30 cm
    /* The toss sits exactly where the player stands: only the legal serve
     * floor (just behind the end line) is enforced, while a deep stance is
     * honoured up to the full stance depth. Serving closer to or farther from
     * the table is therefore about footwork, not a fixed launch band — and it
     * does not touch the capture radius, which was never the real limiter. */
    V3.set(b.p, pad.pos.x,
      PH.TABLE_Y + 0.14, clamp(pad.pos.z - 0.04, PH.T_HALF_LEN + 0.04, PADDLE_LIMITS.zFar));
    /* The toss height is a player preference (settings.serveToss). The base
     * ~2.45 m/s launch rises the ITTF-minimum-legal ~0.31 m; since apex rise
     * scales with vy², the multiplier is applied under a sqrt so the slider
     * reads as a height ratio, not a speed ratio. */
    const tossMul = clamp(this.settings.serveToss || 1, 0.8, 2.2);
    V3.set(b.v, rndSym(0.03), 2.45 * Math.sqrt(tossMul) + rnd(0, 0.2), rndSym(0.03));
    this.tossStartY = b.p.y;
    this.tossApex = b.p.y;
    V3.zero(b.w);
    b.live = true;
    this.isServeBall = true;
    this.setState(GS.SERVE_TOSS);
    this.audio.ui('toss');
  }

  /* ---------------------------- scoring ---------------------------- */
  awardPoint(who, reason) {
    if (this.training) {                 // drills have no score, only feedback
      if (this.shotJournal) this.shotJournal.point(who, reason, this.ball.lastHitBy, this.time);
      this.training.onFault(who, reason);
      /* The preview is not an attempt: let the demonstration ball finish its
       * flight instead of vanishing where a point would have been awarded. */
      if (!(this.training.isDemo && this.training.isDemo())) this.ball.live = false;
      return;
    }
    if (this.state === GS.POINT || this.state === GS.MATCH_END) return;
    const idx = who > 0 ? 0 : 1;
    this.score[idx]++;
    if (this.shotJournal) this.shotJournal.point(who, reason, this.ball.lastHitBy, this.time);
    this.lastPoint = { who, reason };
    this.buzz(who > 0 ? [14, 50, 22] : 42);
    this.stats.rallies++;
    if (this.rally > this.bestRally) this.bestRally = this.rally;
    if (who > 0) this.stats.winners++; else this.stats.errors++;

    // why did that happen? one sentence, only when it helps
    this.lastSwipeLate = (this.time - this.lastSwipeT) > 0.75;
    this.pointNote = this.analyst.analyse(this.recorder, who, reason, this);
    if (this.pointNote && !this.training && this.ui) this.ui.showNote(this.pointNote);
    this.ai.onPointEnd(who);
    const h = this.director.onPoint(who, this.ai.levelIndex);
    this.ai.setHandicap(this.settings.adaptive ? h : 1);
    this.ai.setPressure(this.score[1], this.score[0], this.settings.targetScore);

    // serve rotation: every 2 points, every 1 from 10-10
    const total = this.score[0] + this.score[1];
    const deuce = this.score[0] >= this.settings.targetScore - 1 && this.score[1] >= this.settings.targetScore - 1;
    this.servesLeft--;
    if (deuce || this.servesLeft <= 0) { this.server = -this.server; this.servesLeft = deuce ? 1 : 2; }

    this.audio.point(who > 0);
    this.msg(reason, 1.5, who > 0 ? '#6ee7a8' : '#ff8a8a', true);
    // the filter: keep this rally only if it is worth watching again
    this.lastMoment = this.moments.endRally(this.time, this, {
      winner: who, reason, score: this.score, target: this.settings.targetScore,
    });
    if (this.lastMoment && this.ui) this.ui.flashMoment(this.lastMoment, this.moments.kept.indexOf(this.lastMoment));
    this.setState(GS.POINT);
    if (this.diagMode && typeof window !== 'undefined' && window.__diag)
      window.__diag.events.push({ t: Math.round(performance.now() - window.__diag.t0), k: 'point', who });
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
    this.recorder.addBounce(side, this.ball.p.x, this.ball.p.z, lh);
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
    if (this.reducedMotion || (this.cut && this.cut.fx)) return;
    this.shake = Math.min(1.1, this.shake + amount);
    if (dir) V3.copy(this.shakeDir, V3.norm(dir, dir));
  }

  /* -------------------------- impact events ------------------------ */
  applyHit(side, racket, contactP, quality, info) {
    const cutFx = !!(this.cut && this.cut.fx);   // ?cut=fx debug switch, absent in unit stubs
    if (side < 0 && this.shotJournal) this.shotJournal.returned(this.time);
    const b = this.ball;
    b.lastHitBy = side;
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
      if (sid === 'HOOK' || sid === 'SIDE' || sid === 'SERVE_SIDE') b.w.y *= this._careerSidespinBoost;
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
    this.stats.shots++;
    this.stats.totalSpin += spin / TAU;
    if (speed * 3.6 > this.stats.maxSpeed) this.stats.maxSpeed = speed * 3.6;
    if (spin / TAU > this.stats.maxSpin) this.stats.maxSpin = spin / TAU;

    const name = racket.stroke ? racket.stroke.id : 'DRIVE';
    this.stats.byStroke[name] = (this.stats.byStroke[name] || 0) + 1;
    if (this.diagMode && typeof window !== 'undefined' && window.__diag)
      window.__diag.events.push({ t: Math.round(performance.now() - window.__diag.t0),
        k: 'hit', side, speed: +speed.toFixed(2), stroke: name });

    // Dispatch once, after final physical/equipment velocity is known.
    // No duplicate sound, vibration, particle burst or camera impulse.
    if (this.hitFeedback && !cutFx) {
      this.hitFeedback.execute({ quality, speed, spin: b.w, contactPoint: contactP,
        contactNormal: racket.normal, stroke: name, side,
        isServeStroke: !!racket.isServe, contactSlip: info ? info.contactSlip : 0,
        softHit: !!(racket.arch && racket.arch.soft) ||
          (side > 0 && this.lastSweet !== undefined && this.lastSweet < .38) });
    } else if (!cutFx) {
      this.audio.hitRacket(speed, info ? info.contactSlip : 0, !!(racket.arch && racket.arch.soft));
    }

    if (side > 0) {
      if (!this.reducedMotion && !cutFx) this.hitFlash = Math.max(this.hitFlash, .35);
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
      if (this.training) this.training.onPlayerHit(this.lastShotInfo);
      this.moments.addContact(this.time, {
        by: 1, stroke: (racket.stroke && racket.stroke.id) || '?',
        speed: speed * 3.6, spin: spin / TAU, quality,
      });
      const sid = racket.stroke && racket.stroke.id;
      if (sid === 'LOOP' || sid === 'COUNTER') this.matchTasks.topspin++;
      else if (sid === 'SMASH') this.matchTasks.smash++;
      else if (sid === 'SERVE_TOP' || sid === 'SERVE_SIDE' || sid === 'SERVE_FAST' || sid === 'SERVE_BACK') this.matchTasks.serves++;
      // Live hits never change simulation time. Manual training slowmo and
      // replay speed are independent, explicit player choices.
      // refresh the landing preview
      if (this.settings.showPredict) {
        predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
          { dt: 1 / 240, maxT: 2.4, stopOnFirstBounce: true, out: this.predictOut, path: this.predictPath });
      }
    } else {
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
    S.active = want;
    if (want) { this.targetTimeScale = 0.34; this.slowmoUntil = 0; }
    else if (!this.slowmoUntil) this.targetTimeScale = 1;
  }

  /** Career tournaments and online matches call this with false. */
  setSlowmoAllowed(v) { this.slowmo.allowed = !!v; if (!v) this.setSlowmoHold(false); }

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
      sound: s.sound, volume: s.volume, camera: s.camera, hand: s.hand, grip: s.grip,
      showTrail: s.showTrail, showPredict: s.showPredict,
      showTele: s.showTele, haptics: s.haptics, coach: s.coach, adaptive: s.adaptive,
      showPlayerPaddle: s.showPlayerPaddle, serveToss: s.serveToss,
      capScale: s.capScale, zoneScale: s.zoneScale, aimAssist: s.aimAssist,
      footAssist: s.footAssist, batSens: s.batSens,
      slowmoPlayer: s.slowmoPlayer, targetScore: s.targetScore,
      spinBias: s.spinBias, gestureProfile: s.gestureProfile,
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
    const ranges = { difficulty: [0, 4], volume: [0, 1], serveToss: [0.8, 2.2],
      capScale: [0.8, 2.5], zoneScale: [0.8, 2.5], aimAssist: [0.5, 1],
      footAssist: [0, 1], batSens: [0.4, 2.2] };
    for (const [k, [lo, hi]] of Object.entries(ranges)) {
      if (Number.isFinite(raw[k])) s[k] = clamp(raw[k], lo, hi);
    }
    s.difficulty = Math.round(s.difficulty);
    for (const [k, values] of Object.entries({ quality: ['low', 'medium', 'high'],
      camera: CAMERA_ORDER, hand: ['left', 'right'], grip: ['shakehand', 'penhold'], spinBias: ['low', 'norm', 'high'],
      gestureProfile: ['classic', 'safe'], targetScore: [5, 11, 21] })) {
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

  /* --------------------------- equipment --------------------------- */

  /** Paddle materials for the equipped racket. Cached: the workshop is a
   *  menu, not a per-frame cost. The faces stay red and black (ITTF 2.04.8
   *  — a bat must have two differently coloured faces), and what the shop
   *  sells is the frame: the wood, the grip and the shade. */
  paddleMats(S, eq) {
    const e = eq || this.equip;
    if (!e) return null;
    const c = e.colours;
    const key = e.bladeId + '|' + e.fhId + '|' + e.bhId;
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
    p.taskProgress('topspin', 0, this.matchTasks.topspin >= 10 ? 10 : 0);
    p.taskProgress('smash', 0, this.matchTasks.smash >= 3 ? 3 : 0);
    p.taskProgress('serves', 0, this.matchTasks.serves >= 5 ? 5 : 0);
    if (this.bestRally >= 8) p.taskProgress('rally8', 0, 1);
    this.analytics && this.analytics.send('match:end', {
      won, score: this.score.join('-'), rally: this.bestRally, shots: this.stats.shots,
      moments: this.moments.kept.length, level: p.data.level, session: Math.round(this.analytics.sessionSec),
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
    Q.integrate(b.q, b.q, b.w, dt);
    b.speed = V3.len(b.v);

    /* --- SERVE HANG TIME ---
     * The ITTF strike band is only about `serveTossMinRise` tall (the ball
     * must be falling AND still >= that much above the toss start). At full
     * gravity the toss crosses that band in ~0.1 s, which no human can hit —
     * the serve felt "impossible" even though the capture radius and the
     * toss-riding bat were never the limiter. While the player's own toss has
     * NOT yet been struck and is falling inside the legal band, cap its descent
     * so the ball floats through the strike window. The falling rule and the
     * minimum rise still hold, so pressZoneForBall and the toss tests stay green. */
    if (this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0 &&
      this.tossRiseNow() > MATCH_RULES.serveTossMinRise && b.v.y < -0.75) {
      b.v.y = -0.75;
    }

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
          this.audio.hitEdge();
          this.msg(info.edgeAxis === 'x' ? 'РЕБРО СТОЛА!' : 'ЗАДНЯЯ КРОМКА!', 1.0, '#ffd34d');
          this.shakeIt(0.10 + 0.16 * info.edge, V3.new(0, 1, 0));
          this.stats.edgeBalls = (this.stats.edgeBalls || 0) + 1;
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
        this.msg('СЕТКА — ЭДЖ!', 1.1, '#ffd34d');
        this.emitParticles(nh.x, PH.NET_TOP, 0, 8, 1.1, 0.3, 0.014, 1, 0.9, 0.5);
        this.netTouched = true;
        if (b.lastHitBy === 1 && this.shotJournal) this.shotJournal.net();
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

    /* --- paddles (CCD) --- */
    if (this.time - this.player.lastHitT > 0.09) this.tryPlayerHit(p0);
  }

  /** net touch on a service: no point, the serve is simply taken again. */
  letServe() {
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
    journal.expire(this.time);
    if (![GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY].includes(this.state)) return;
    const m = sw.active ? sw.m : sw.lastReleased;
    if (!m || m.samples < 2) return;
    const serving = this.state === GS.SERVE_TOSS || this.state === GS.SERVE_READY;
    const forehand = (this.player.pos.x * (this.settings.hand === 'left' ? -1 : 1)) >= -.05;
    const ctx = { side: 1, isServe: serving, ball: this.ball.p, ballSpin: this.ball.w,
      grip: this.settings.grip, forehand, ballSpeed: this.ball.speed || V3.len(this.ball.v), movePitch: -.15,
      safeGestures: this.settings.gestureProfile === 'safe' };
    const r = isRealStroke(m, serving) ? deriveStroke(m, ctx) : null;
    const lastSample = sw.samples[sw.samples.length - 1];
    journal.observe(sw.gestureId, m, { time: this.time, isServe: serving, active: sw.active,
      sampleTime: sw.active && lastSample ? lastSample.t : this.swipeReleasedAt,
      strokeId: r && r.stroke.id });
  }

  logInput(type, extra = {}) {
    if (!this.inputLog || typeof makeInputLogEvent !== 'function') return null;
    const event = makeInputLogEvent(this, type, extra);
    if (!event) return null;
    this.inputLog.record(event);
    if ((type === 'pointerdown' || type === 'contact') && this.moments &&
        typeof this.moments.addInputDecision === 'function')
      this.moments.addInputDecision(event.t, event.decision, event.outcome, event.inputType);
    return event;
  }

  logSwipeRelease(extra = {}) {
    const serving = !!(this.swipe && this.swipe.pressZone && this.swipe.pressZone.serving);
    return this.logInput('pointerup', { ...extra, outcome: { released: true, contact: false,
      reason: isRealStroke(this.swipe && this.swipe.lastReleased, serving) ? null : 'STATIC_CLICK' } });
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
    const releasedAt = Number.isFinite(this.swipeReleasedAt) ? this.swipeReleasedAt : -Infinity;
    const deadWin = serving ? 1.15 : .25;
    if (!sw.active && isRealStroke(sw.lastReleased, serving) && this.time - releasedAt >= deadWin)
      return this.logPressRejection('TIMING_EARLY', { releasedAgeMs: (this.time - releasedAt) * 1000 });
    const heldWin = serving ? 1.15 : 2.5;
    const staleHeld = sw.active && sw.gestureId === sw.realGestureId &&
      this.time - (sw.realAt || 0) >= heldWin;
    const noGesture = !sw.active && !sw.lastReleased && !(sw.samples && sw.samples.length);
    if (staleHeld || noGesture) return this.logPressRejection('NO_FRESH_SWIPE');
    return null;
  }

  logNoContactReason(captureSample, serving = false) {
    if (serving || !this.ball || !this.player || !this.ball.p || !this.ball.v || !this.player.pos) return null;
    const b = this.ball, pad = this.player;
    const dz = b.p.z - pad.pos.z;
    const separating = (b.p.x - pad.pos.x) * b.v.x + (b.p.y - pad.pos.y) * b.v.y + dz * b.v.z;
    if (!(dz > MATCH_RULES.depthTolerance) || !(separating > 0)) return null;
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
    // A serve flick chooses spin/placement. The initiating press launches
    // the toss, and cannot be aimed at a ball that has not been tossed yet.
    if (pz.via === 'serve-init') return true;
    if (pz.directionOk === true) return true;
    if (pz.directionOk === false) return false;
    if (![pz.x, pz.y, pz.pointerX, pz.pointerY, m.dx, m.dy].every(Number.isFinite)) return true;
    const toBallX = pz.x - pz.pointerX, toBallY = pz.y - pz.pointerY;
    const swipeX = m.dx * (pz.vw > 0 ? pz.vw : 1), swipeY = m.dy * (pz.vh > 0 ? pz.vh : 1);
    const dist = Math.hypot(toBallX, toBallY), len = Math.hypot(swipeX, swipeY);
    if (dist < 4) { pz.directionDot = 1; pz.directionOk = true; return true; }
    if (!(len > 1e-9)) return false;
    const dot = (swipeX * toBallX + swipeY * toBallY) / (len * dist);
    pz.directionDot = dot; pz.directionOk = dot > 0;
    if (!pz.directionOk) {
      pz.accepted = false; pz.reason = 'WRONG_DIRECTION';
      if (this.shotJournal && typeof this.shotJournal.rejectPress === 'function')
        this.shotJournal.rejectPress(this.swipe.gestureId, 'WRONG_DIRECTION', pz);
      this.logInput('decision', { outcome: { contact: false, reason: 'WRONG_DIRECTION' } });
    }
    return pz.directionOk;
  }

  playerStrokeIntent(serving = false) {
    const sw = this.swipe;
    const lastSample = sw.samples[sw.samples.length - 1];
    const releasedAt = Number.isFinite(this.swipeReleasedAt) ? this.swipeReleasedAt : -Infinity;
    /* A serve is struck on the way down, often after the swipe has already
       finished or the hand is waiting at the end of the flick. 0.18 s of
       freshness (correct for a rally) dropped a legal toss strike. */
    const liveWin = serving ? 1.15 : 0.18;
    const deadWin = serving ? 1.15 : 0.25;
    /* A BLOCK is a real stroke that then stands still: the hand moves into
       position and waits for the ball. Sample freshness alone killed it
       180 ms after the finger stopped moving, so the one shot where holding
       still is the whole technique could not be played at all. Remember that
       THIS gesture has already been a real stroke; a tap (never real) still
       produces no intent, which the browser test pins down. */
    if (sw.active && sw.gestureId !== sw.realGestureId && isRealStroke(sw.m, serving)) {
      sw.realGestureId = sw.gestureId;
      sw.realAt = this.time;
    }
    const held = sw.active && sw.gestureId === sw.realGestureId &&
      this.time - (sw.realAt || 0) < (serving ? 1.15 : 2.5);
    const fresh = sw.active && lastSample && this.time - lastSample.t >= 0 && this.time - lastSample.t < liveWin;
    const m = fresh || held ? sw.m
      : !sw.active && this.time - releasedAt >= 0 && this.time - releasedAt < deadWin ? sw.lastReleased : null;
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

  /* The human-side capture multiplier (accessibility). Default 1 keeps the
   * authored envelope exactly; the AI never reads this. */
  capScale() { return clamp(Number.isFinite(this.settings.capScale) ? this.settings.capScale : 1, 0.8, 2.5); }
  /* Serve gets at least a 2x window on top of the player's capScale so the
   * tossed ball is essentially always in reach — the toss is the one moment
   * that should never be a coin-flip. The MATCH_RULES constant itself is
   * left untouched; only the game's own capture calls widen. */
  serveCapScale() { return Math.max(this.capScale(), 2); }

  tryPlayerHit(p0) {
    const pad = this.player, b = this.ball;
    if (!b.live) return;
    /* The point is over. A ball still in the air during the point-end pause
     * is scenery: striking it used to change lastHitBy, consume the gesture
     * and feed the journal a contact that belonged to no rally. */
    if (this.state !== GS.RALLY && this.state !== GS.SERVE_TOSS) return;
    /* A serve has to bounce on the receiver's side before it can be returned.
     * `isServeBall` alone did not stop the near side from volleying the
     * opponent's serve straight out of the toss. */
    if (this.pressConsumed()) { this.logPressRejection('CONSUMED'); return; }
    if (this.isServeBall && b.lastHitBy === -1) {
      if (this.pressAdmitsBall() && this.playerStrokeIntent(false)) this.logPressRejection('BOUNCE_ILLEGAL');
      return;
    }
    if (!this.pressAdmitsBall()) return;

    // The fixed envelope belongs to the racket, NOT the pointer marker.
    const cs = this.capScale();
    const serveCs = this.serveCapScale();
    const reachRadius = MATCH_RULES.captureRadius * cs;
    const serveReach = MATCH_RULES.serveCaptureRadius * serveCs;
    const depthTol = MATCH_RULES.depthTolerance * cs;

    const serveCtx = this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0;
    const sw = this.swipe, m = this.playerStrokeIntent(serveCtx);
    if (!m) { this.logNoStrokeIntent(serveCtx); return; }
    /* ITTF 2.07: a return must follow a bounce on the receiver's court.
     * Without this gate the generous endpoint envelope returned
     *   · a ball still on its way to the player (a volley, a fault), and
     *   · a ball that had already passed the end line and missed the table
     *     — a point the player had already won, turned back into a rally.
     * An out ball is allowed to finish its flight; the gesture is not
     * consumed, so it is still there for the real chance. */
    const ownBounce = this.rallyBounces.some((s) => s > 0);
    if (!serveCtx && !ownBounce) {
      this.logPressRejection('BOUNCE_ILLEGAL');
      if (b.p.z >= PH.T_HALF_LEN) this.hintOut = this.time;
      return;
    }
    const endpointEligible = serveCtx || (b.lastHitBy === -1 && (this.rallyBounces.some(s => s > 0) || b.p.z >= .50));
    const spad = this.staticPad(pad);
    const captureSample = measureCaptureAllowance(spad, p0, b.p, serveCtx, endpointEligible);
    if (captureSample && this.shotJournal) this.shotJournal.observeCapture(sw.gestureId, captureSample, this.time);
    if (b.v.z < 0 && b.p.z < pad.pos.z - .35) return;
    if (serveCtx && (b.v.y >= 0 || !(this.tossRiseNow() > MATCH_RULES.serveTossMinRise))) {
      if (b.v.y < 0) this.logPressRejection('SERVE_TOSS_LOW', { tossRise: this.tossRiseNow() });
      return;
    }
    let hit = null;

    if (serveCtx) {
      // ITTF 2.06: the ball must be struck while FALLING from the toss.
      const rad = V3.dist(b.p, pad.pos);
      if (b.v.y < 0 && this.tossRiseNow() > MATCH_RULES.serveTossMinRise && playerInCaptureRange(b.p, pad.pos, true, serveCs)) {
        hit = { t: 1, x: b.p.x, y: b.p.y, z: b.p.z, captureKind: 'serve', rad: rad * 0.40, px: pad.pos.x, py: pad.pos.y, pz: pad.pos.z };
      }
    } else if (ownBounce) {
      /* The endpoint route fires at the CLOSEST APPROACH of the ball to the
       * blade, not the instant it enters the assist box. The box is 0.62 m
       * wide and 0.62 m deep, so firing on entry put the contact up to 62 cm
       * in front of the racket — the ball left a place the blade visibly
       * never reached. While the ball is still closing, this substep simply
       * does not hit; the gesture stays alive and the next substep (or the
       * bat's own sweep) takes it at the blade. */
      const closing = (b.p.x - pad.pos.x) * b.v.x + (b.p.y - pad.pos.y) * b.v.y +
        (b.p.z - pad.pos.z) * b.v.z;
      const inside = playerInCaptureRange(b.p, pad.pos, false, cs);
      const still = b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z < 0.04;
      // r·v < 0 means the ball is APPROACHING the blade. Endpoint capture
      // belongs at closest approach / on departure, not on entry. The
      // inverted sign used to hit early balls and reject a fresh swing a
      // few centimetres after the plane had been crossed.
      if (inside && (closing >= -0.02 || still)) {
        const dx = b.p.x - p0.x, dy = b.p.y - p0.y, dz = b.p.z - p0.z;
        const dd = dx * dx + dy * dy + dz * dz;
        const u = dd > 1e-12
          ? clamp((-(p0.x - pad.pos.x) * dx - (p0.y - pad.pos.y) * dy - (p0.z - pad.pos.z) * dz) / dd, 0, 1)
          : 1;
        const cx = p0.x + dx * u, cy = p0.y + dy * u, cz = p0.z + dz * u;
        /* Quality is the NORMALISED distance inside the box, on both axes.
         * `dist2d * 0.35` ignored depth entirely: a ball 30 cm in front of
         * the blade scored as a dead-centre contact with the full sweet
         * spot. */
        const lat = Math.hypot(cx - pad.pos.x, cy - pad.pos.y);
        const frac = Math.max(lat / reachRadius,
          Math.abs(cz - pad.pos.z) / depthTol);
        hit = { t: u, x: cx, y: cy, z: cz, captureKind: 'endpoint',
          rad: clamp(frac, 0, 1) * reachRadius, px: pad.pos.x, py: pad.pos.y, pz: pad.pos.z };
      }
    }

    if (!hit) {
      hit = this.sweepPaddle(spad, p0, b.p, serveCtx ? serveReach : reachRadius);
    }
    if (!hit) { this.logNoContactReason(captureSample, serveCtx); return; }
    if (!this.validatePressDirection(m)) return;
    if (b.lastHitBy === 1) { this.logPressRejection('CONSUMED'); return; } // you already hit it

    const isServeStroke = this.isServeBall && b.lastHitBy === 0 && this.server === 1;
    const contact = V3.new(hit.x, hit.y, hit.z);
    const forehand = paddleForehand(pad.pos.x, this.settings.hand, pad.forehand);
    const grip = playerWristPose(pad.pos, pad.vel, this.settings.hand, { grip: this.settings.grip, forehand });
    const sideParams = this.equip.forSide(grip.forehand ? 1 : -1);
    const radius = MATCH_RULES.sweetRadius;
    const sweet = clamp((1 - hit.rad / reachRadius) * (sideParams.sweet || this.equip.sweetK), 0, 1);
    const offLat = clamp((hit.x - pad.pos.x) / Math.max(radius, 1e-4), -1, 1);
    const offVer = clamp((hit.y - pad.pos.y) / Math.max(radius, 1e-4), -1, 1);
    const offMag = clamp(Math.hypot(offLat, offVer), 0, 1);
    this.lastSweet = sweet;

    // ---- build the stroke from the live gesture --------------------
    let racket, quality;
    if (m) {
      const timing = clamp(m.speed / Math.max(m.peakSpeed, 1e-3), 0.35, 1);
      const tband = timing >= 0.93 ? 'ТОЧНО' : timing >= 0.80 ? 'ХОРОШО'
        : timing >= 0.62 ? 'РАНОВАТО' : 'ПОЗДНО';
      const tq = timing >= 0.93 ? 1.08 : timing >= 0.80 ? 1.0 : timing >= 0.62 ? 0.90 : 0.74;
      this.lastTiming = tband;
      const ctx = {
        side: 1, grip: this.settings.grip, forehand, isServe: isServeStroke,
        ball: { y: contact.y, z: contact.z },
        ballSpin: b.w, ballSpeed: V3.len(b.v),
        powerScale: 1,
        moveYaw: this.padYaw || 0, movePitch: this.padPitch || 0,
        equip: sideParams,
        spinBias: this.settings.spinBias || 'norm',
        safeGestures: this.settings.gestureProfile === 'safe',
      };
      racket = deriveStroke(m, ctx);
      racket.vmag *= this.equip.vmagK;
      if (!isServeStroke) {
        const miss = (1 - sweet) * offMag;
        racket.vmag *= 1 - 0.18 * miss;
        racket.azSwing = clamp(racket.azSwing + offLat * 0.23 * (1 - sweet), -1.35, 1.35);
        racket.elev = clamp(racket.elev - offVer * 8.0 * (1 - sweet), -70, 78);
      }
      quality = clamp(racket.quality * (0.60 + 0.40 * sweet) * (0.70 + 0.30 * timing) * tq, 0.25, 1);
      racket.quality = quality;
      // Trajectory assist: authored level, optionally raised by the player.
      const assistLvl = clamp(Number.isFinite(this.settings.aimAssist) ? this.settings.aimAssist : MATCH_RULES.trajectoryAssist, 0, 1);
      const rawSwing = V3.new(), rawNormal = V3.new();
      strokeFrame(racket, 0, 0, 1, rawSwing, rawNormal);
      const rawShotFrame = { normal: shotVec(rawNormal), vR: shotVec(rawSwing),
        faceElev: racket.faceElev, swingElevation: racket.elev, swingAzimuth: racket.azSwing,
        faceAzimuth: racket.azFace, speed: racket.vmag, rubber: { ...racket.rubber } };
      racket = refineRacketRealtime(contact, b.v, b.w, racket, assistLvl, quality);
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
    if (!info) return;
    // A wind-up must end at impact, not pull the DRAWN blade backwards
    // while the physical ball has already left the rubber.
    if (this.anticipation && !this.cut.antic) {
      this.anticipation.active = false;
      if (this.anticipation.visualOffset) V3.zero(this.anticipation.visualOffset);
    }
    {
      const bp = this.R && this.R.viewProj ? this.project(b.p, {}) : null;
      const pp = this.R && this.R.viewProj ? this.project(pad.pos, {}) : null;
      const distancePx = bp && pp && bp.ok && pp.ok && this.vw > 0 && this.vh > 0
        ? Math.hypot((bp.x - pp.x) * this.vw, (bp.y - pp.y) * this.vh) : null;
      this.logInput('contact', { outcome: { contact: true, route: hit.captureKind || 'ccd',
        distancePx, distanceM: captureSample ? captureSample.distance : V3.dist(b.p, pad.pos),
        pressToContactMs: this.swipe.pressZone && Number.isFinite(this.swipe.pressZone.pressT)
          ? (this.time - this.swipe.pressZone.pressT) * 1000 : null } });
    }
    pad.lastHitT = this.time;
    /* The blade is where the contact is. The old code left the bat up to one
     * full capture radius away and launched the ball from a point it visibly
     * never reached; the AI already snaps its paddle to the contact. prevPos is
     * moved too, so the next frame does not read the snap as 20 m/s of bat. */
    V3.copy(pad.pos, contact);
    V3.copy(pad.prevPos, pad.pos);
    V3.copy(pad.prev, pad.pos);
    V3.copy(b.p, contact);
    V3.addScaled(b.p, b.p, racket.normal, PH.R * 1.05);
    V3.copy(pad.normal, racket.normal); // show the assisted contact face too
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
      ft.followTime = motion.profile.followTime;
      ft.recoverTime = motion.profile.recoverTime;
      ft.duration = ft.followTime + ft.recoverTime;
      ft.amplitude = motion.profile.travel;
      ft.anchor = V3.clone(contact); ft.base = null;
      const spd = V3.len(racket.vR) || 1;
      V3.set(ft.swingDir, racket.vR.x / spd, racket.vR.y / spd, racket.vR.z / spd);
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
    if (this.training) return;           // the feeder never returns the ball
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
    if (!ai.readyToStrike(this.time) && V3.dist(b.p, ai.pos) > 0.22) return;
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
    V3.copy(pad.normal, racket.normal);
    V3.copy(pad.pos, b.p);
    /* Same separation as the player's contact: the flight the solver fitted
     * starts one radius off the face, so the live ball must too. */
    V3.addScaled(b.p, b.p, racket.normal, PH.R * 1.05);
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
    this.stanceY = undefined;
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
    this.recenterT = RECENTER_S;         // no footwork assist while re-centring
    this.tossQueued = false;
    if (this.cancelInput) this.cancelInput(); else this.swipe.cancel();
    if (this._paddlePred) this._paddlePred.reach = null;
    if (this._strikePred) this._strikePred.reach = null;
    if (this._volleyPred) this._volleyPred.reach = null;
    const broken = ![pad.pos.x, pad.pos.y, pad.pos.z].every(Number.isFinite);
    if (hard || broken) {
      V3.set(pad.pos, 0, PH.TABLE_Y + 0.25, 1.78);
      V3.copy(pad.prevPos, pad.pos);
      V3.copy(pad.prev, pad.pos);
      V3.zero(pad.vel);
    }
    V3.set(pad.normal, 0, Math.sin(this.padPitch), -Math.cos(this.padPitch));
    pad.swing = 0;
    this._ptTarget = { tx: 0, ty: PH.TABLE_Y + 0.25, tz: 1.78 };
  }

  updatePlayerPaddle(dt) {
    const pad = this.player;
    V3.copy(pad.prev, pad.pos);
    pad.prevPos = pad.prevPos || V3.clone(pad.pos);
    V3.copy(pad.prevPos, pad.pos);
    if (this.recenterT > 0) {
      this.recenterT = Math.max(0, this.recenterT - dt);
      /* release a serve the player asked for during the reset */
      // A ready-state tap requests a toss even if released before the bat
      // returns home. Pause/reset cancel the queue explicitly.
      if (this.recenterT === 0 && this.tossQueued) {
        this.tossQueued = false;
        if (this.state === GS.SERVE_READY && this.server === 1) this.startToss();
      }
    }

    /* The training preview owns the bat through a synthetic pointer, so the
     * pupil watches the real racket find the real ball. A real hover must not
     * fight it — but a broken ghost must never poison the transform either. */
    let pt = this.demoPointer || this.pointer || { x: 0.5, y: 0.55 };
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      this.demoPointer = null;
      pt = { x: 0.5, y: 0.55 };
      this.pointer = pt;                 // self-heal: never stay broken
    }
    if (!Number.isFinite(this.stanceY)) this.stanceY = undefined;
    const sens = clamp(Number.isFinite(this.settings.batSens) ? this.settings.batSens : MATCH_RULES.sensitivity, 0.4, 2.2);
    // the depth of the stance is set when the hand lands, not by the swipe:
    // flicking the wrist upward must not lunge you over the table
    if (this.swipe.active && this.swipe.m.samples > 0) {
      if (this.stanceY === undefined) this.stanceY = this.swipe.m.sy;
    } else if (this.stanceY === undefined) this.stanceY = pt.y;
    const depthY = this.stanceY !== undefined ? this.stanceY : pt.y;

    /* A ball that dies short is a real table-tennis problem, and it used to
     * be an impossible one: the bat's depth was hard-clamped at 1.18 m, so a
     * short serve simply could not be reached no matter what you did. Now a
     * predicted short ball grants the step-in depth. */
    let zNear = PADDLE_LIMITS.zNear;
    const A = clamp(Number.isFinite(this.settings.footAssist) ? this.settings.footAssist : MATCH_RULES.positionAssist, 0, 1);
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
    const shortBall = canReachShort && ((o.landed && o.landed.z > 0 && o.landed.z < 1.15) ||
      (o.reach && o.reach.z < PADDLE_LIMITS.zNear + 0.22) || this.ball.p.z < 1.15);
    if (shortBall) zNear = PADDLE_LIMITS.zStepIn;
    /* The step is visible: the body goes forward and down, the blade tips
       into the ball. Without this the bat simply appeared 16 cm closer. */
    pad.stepIn = expSmooth(pad.stepIn || 0, shortBall ? 1 : 0, 8, dt);

    /* Anticipation is a render cue, NOT a movement. It used to be added to
     * the physical target, so pressing pulled the blade up to 12 cm away from
     * the ball — backwards, opposite the stroke, exactly when the player was
     * trying to hit it. drawDynamic applies the same offset to the drawn pose
     * instead, where it cannot take a catchable ball out of the capture
     * volume. */
    const t = paddleTargetFromPointer(pt.x, pt.y, depthY, sens,
      this._ptTarget || (this._ptTarget = { tx: 0, ty: 0, tz: 0 }),
      { zNear, vp: this.camVPReady ? this.camVP : null });
    let tx = t.tx;
    let ty = t.ty;
    let tz = t.tz;
    const ft = this.followThrough;
    if (ft && ft.active && this.playerStrokeIntent(this.state === GS.SERVE_TOSS)) ft.active = false;

    /* On a new point the bat goes HOME first, and while that window is open
     * the cursor is deliberately not obeyed. Without this the reset is
     * cosmetic: the mapping is absolute, so a cursor sitting out at the edge
     * pulls the bat straight back out on the very next pointermove — mice
     * emit those constantly. Measured in the headless smoke run before this:
     * 9 of 29 serves began with the bat up to 0.59 m off centre. The blend
     * decays over the window, so control is handed back smoothly instead of
     * snapping, and the cursor and the bat are never permanently divorced. */
    if (this.recenterT > 0) {
      /* Hold the bat AT the centre for the first three quarters of the window
       * and hand control back over the last one. Blending from the very first
       * frame meant a cursor parked off centre only ever dragged the bat
       * partway home: measured closest approach 0.098-0.212 m on 14 of 49
       * serves, i.e. the "the bat returns to the centre on every serve"
       * requirement was visibly not met even though the glide was running. */
      const kHome = clamp((this.recenterT / RECENTER_S - 0.25) / 0.75, 0, 1);
      tx = lerp(tx, 0, kHome);
      ty = lerp(ty, PH.TABLE_Y + 0.25, kHome);
      tz = lerp(tz, 1.78, kHome);
    }

    // during your own toss the bat slides under the ball: serving is about
    // the stroke you choose, not about pixel-hunting a 40 mm sphere
    /* Not while the bat is still gliding home: the requirement is that the bat
     * returns to the centre on EVERY new point, and a player who serves the
     * instant the point ends would otherwise have the toss assist yank the bat
     * sideways mid-glide. Measured in the headless matches: 43/45 serves
     * re-centred, worst 0.234 m off, because the toss slide ran on top of the
     * re-centring window. Half a second of glide first, then the slide. */
    if (this.state === GS.SERVE_TOSS && this.server === 1 && this.ball.lastHitBy === 0 && this.recenterT <= 0) {
      /* Serving must never be "pixel-hunt a 40 mm sphere" (the authored intent
       * above). The bat RIDES the toss: it is pulled hard onto the ball on every
       * axis, both on the way up and on the way down, independent of the
       * footAssist slider. When footAssist was low, k=0.55+0.45*A and the
       * rising-phase ty assist (0.45*A) left the blade well away from the toss,
       * so a perfectly-timed flick met empty air while the pointer-centred cue
       * still burned green — the exact "I hit the circle but can't serve" trap.
       * The stroke you choose still decides WHERE the ball goes; this only
       * guarantees the blade is actually there to make it. */
      const k = 0.95;
      tx = lerp(tx, this.ball.p.x, k);
      tz = lerp(tz, this.ball.p.z + 0.02, k);
      const under = this.ball.p.y - 0.04;
      ty = lerp(ty, under, k);
    }
    /* Footwork follows INTENT, not swipe length. It used to require a
     * completed "real stroke", so a player who pressed and ran in at a short
     * ball — the only sane way to play one — got no step-in at all and the
     * bat stayed 0.45 m behind the ball until the point was awarded against
     * them. A live press in the admitted zone is intent. */
    if (A > 0.01 && canReachShort && this.recenterT <= 0 && this.pressAdmitsBall() && (this.swipe.active || this.playerStrokeIntent())) {
      if (o.reach) {
        // Footwork assist, not a magnet: a swipe on the far wing must not
        // teleport the bat onto a ball it was never near. The gate widened
        // 0.42 -> 0.52: on a phone the press lands where the ball is GOING,
        // and the pre-press bat can be a third of a metre from the crossing
        // point — outside the old gate meant no assist at all, which is
        // exactly the "only balls over the table are returnable" report.
        const near = Math.hypot(pad.pos.x - o.reach.x, pad.pos.y - o.reach.y)
          < 0.52 + 0.28 * A;
        if (near) {
          const k = A * clamp(1.3 - o.reachT * 1.0, 0.30, 1);
          tx = lerp(tx, clamp(o.reach.x, -PADDLE_LIMITS.x, PADDLE_LIMITS.x), k);
          ty = lerp(ty, clamp(o.reach.y, PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi), k * 0.95);
          /* Depth follows the intercept BOTH ways. The old line only stepped
           * IN, so a ball met past the end line left the stance frozen at
           * z 1.4 — a depth gap of 0.35-0.40 m failed the capture box by
           * itself, before any timing error. For a genuinely short ball
           * (front half of the table) the reach depth is the BALL's depth and
           * the bat leans in; for a deep one it now backs off to meet it. */
          const deepZ = shortBall ? Math.min(o.reach.z, this.ball.p.z) : o.reach.z;
          const wantZ = clamp(deepZ - 0.02, zNear, PADDLE_LIMITS.zFar);
          tz = clamp(lerp(tz, wantZ, clamp(A * 0.75, 0, 1)), zNear, PADDLE_LIMITS.zFar);
        }
      }
    } else if (A > 0.01 && canReachShort && this.recenterT <= 0 &&
        !this.pointerFine && !this.swipe.active && !this.playerStrokeIntent() && o.reach) {
      /* TOUCH PRE-AIM. A mouse has hover: the hand is already near the ball
       * when the button goes down. A finger has none — the bat froze where
       * the last swipe ended and every return depended on the press-time
       * jump alone. While the ball is incoming the game now leads the bat
       * toward the predicted crossing point, gently (a lead, not a magnet:
       * the fresh gesture still has to meet the ball). */
      const near = Math.hypot(pad.pos.x - o.reach.x, pad.pos.y - o.reach.y) < 0.85;
      if (near) {
        const k = A * 0.55 * clamp(1.15 - (o.reachT || 0.6) * 0.7, 0.18, 0.55);
        tx = lerp(tx, clamp(o.reach.x, -PADDLE_LIMITS.x, PADDLE_LIMITS.x), k);
        ty = lerp(ty, clamp(o.reach.y, PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi), k);
        const wantZ = clamp(o.reach.z, zNear, PADDLE_LIMITS.zFar);
        tz = clamp(lerp(tz, wantZ, k * 0.8), zNear, PADDLE_LIMITS.zFar);
      }
    }
    /* ---- game feel: raise = reach FORWARD, not straight up --------------
     * paddleTargetFromPointer is an exact inverse of the projection and the
     * camera suite depends on that, so the "the bat climbs to the ceiling and
     * pistons up and down" feel is authored here, on top of the geometry.
     * A table-tennis stroke is played FORWARD: lifting the hand now drives the
     * bat toward the net and only a little higher. The climb eases out (it
     * decelerates instead of slamming into an invisible ceiling) and tapers at
     * the very top, so the extreme of the gesture reaches OVER the table — the
     * height even dips slightly — rather than straight into the air. Downward
     * moves (chops, low balls, the serve toss slide) are left untouched. */
    const HOME_Y = PADDLE_HOME.y;                        // TABLE_Y + 0.62, the rest height
    if (ty > HOME_Y) {
      const UP_MAX = 0.22;                               // the bat climbs only this far above rest
      const up01 = clamp((ty - HOME_Y) / (PADDLE_LIMITS.yHi - 0.62), 0, 1);
      const eased = 1 - Math.exp(-up01 * 2.0);           // off the mark, then decelerating
      const taper = 1 - 0.18 * smoothstep(0.75, 1, up01);// the very top dips slightly forward
      ty = HOME_Y + UP_MAX * eased * taper;
      tz = clamp(tz - 0.40 * eased, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
      this._reachF = eased;
    } else {
      this._reachF = 0;
    }
    // One positional owner: authored contact path, with live pointer deltas.
    // Apply after stance/footwork, before all spatial safety constraints.
    t.tx = tx; t.ty = ty; t.tz = tz;
    /* Where the cursor alone wants the blade. If the authored path has to be
     * abandoned, this is where the bat is handed back — never the point on a
     * clamp it never wanted to be at. */
    const aimX = tx, aimY = ty, aimZ = tz;
    let contactPath = false;
    if (this.cut.ft) {
      // ?cut=ft: no authored contact path, old smoothed follow only.
      if (ft && ft.active) { ft.t += dt; if (ft.t >= ft.duration) ft.active = false; }
    } else if (ft && ft.active) {
      /* The same box the clamps below enforce, so the path can end itself
       * instead of being clipped into a parked blade. */
      if (!this._ftLim) this._ftLim = {
        xLo: -PADDLE_LIMITS.x, xHi: PADDLE_LIMITS.x,
        yLo: PH.TABLE_Y + PADDLE_LIMITS.yLo, yHi: PH.TABLE_Y + PADDLE_LIMITS.yHi,
        zLo: PADDLE_LIMITS.zNear, zHi: PADDLE_LIMITS.zFar };
      contactPath = paddleFollowPosition(ft, t, dt, this._ftLim);
    }
    const pathX = t.tx, pathY = t.ty, pathZ = t.tz;
    tx = t.tx; ty = t.ty; tz = t.tz;
    /* Neither the cursor nor the assist may ever park the bat outside the
     * frame — that is the bug that used to leave it stranded off-screen. */
    if (this.camVPReady) {
      t.tx = tx; t.ty = ty; t.tz = tz;
      clampPaddleToFrustum(this.camVP, t, 0.05);
      /* tz too: the clamp can now walk the depth back toward the body when the
       * pose asked for cannot be shown at all, and a correction the caller
       * throws away is the same as no correction. */
      tx = t.tx; ty = t.ty; tz = t.tz;
    }
    tx = clamp(tx, -PADDLE_LIMITS.x, PADDLE_LIMITS.x);
    ty = clamp(ty, PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi);
    tz = clamp(tz, zNear, PADDLE_LIMITS.zFar);
    /* The frustum clamp above is camera-dependent and can bite earlier than the
     * box, especially at the angles where the table fills the frame. When it
     * moves the authored path, the blade would sit against it for the rest of
     * the follow — end the phase so the bat goes back to the cursor instead. */
    if (contactPath) {
      const cx = tx - pathX, cy = ty - pathY, cz = tz - pathZ;
      if (cx * cx + cy * cy + cz * cz > 1e-4) {
        if (ft) ft.active = false;
        contactPath = false;
        tx = aimX; ty = aimY; tz = aimZ;
      }
    }

    // re-centring after a point is a visible glide, not a teleport
    /* 20, not 13: the glide has to be over before a quick player can strike the
     * serve, or "the bat returns to the centre" is only true for people who
     * wait. Still visibly a glide (0.2-0.3 s), not a teleport. */
    const rate = this.recenterT > 0 ? 20 : 26;
    pad.pos.x = contactPath ? tx : expSmooth(pad.pos.x, tx, rate, dt);
    pad.pos.y = contactPath ? ty : expSmooth(pad.pos.y, ty, rate, dt);
    pad.pos.z = contactPath ? tz : expSmooth(pad.pos.z, tz, rate * 0.7, dt);
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
    }, clamp(Math.max(intent.releaseSpeed, intent.peakSpeed * .78) / 4.2, 0, 1.45)).id : null;
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
    /* A raised bat plays the stroke FORWARD: tip the blade over the table so
     * it leans into the net instead of standing vertical in the air. */
    if (this._reachF > 0.001) {
      rest.y = lerp(rest.y, -0.6, this._reachF * 0.5);
      V3.norm(rest, rest);
    }
    if (m) {
      const ctx = {
        side: 1, grip: this.settings.grip, forehand: pad.forehand, isServe: servingNow, ball: { y: pad.pos.y, z: pad.pos.z },
        ballSpin: this.ball.w, ballSpeed: V3.len(this.ball.v), moveYaw: this.padYaw, movePitch: this.padPitch,
        safeGestures: this.settings.gestureProfile === 'safe',
      };
      const st = deriveStroke(m, ctx);
      /* First ~45 ms keep the ready face so the bat does not pop onto
         the archetype the frame a finger twitches. */
      const k = smoothstep(0, 0.045, m.dur || 0);
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
      if (b.v.y < 0 && this.tossRiseNow() > MATCH_RULES.serveTossMinRise) {
        w.on = true; w.kind = 'serve'; w.t = 0;
        w.contactable = playerInCaptureRange(b.p, pad.pos, true, this.serveCapScale());
        w.ready = w.contactable ? 1 : .4;
      }
    } else if (incoming && this.rallyBounces.some(side => side > 0)) {
      const o = this._strikePred || (this._strikePred = {});
      if (read) predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
        { dt: 1 / 200, maxT: 1.8, stopZ: pad.pos.z, stopDir: 1, stopAtPlane: true, out: o });
      w.contactable = playerInCaptureRange(b.p, pad.pos, false, this.capScale());
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

  /** A preset change resets both camera adjustments. */
  setCameraPreset(mode) {
    const P = CAMERA_PRESETS[mode];
    if (!P) return;
    this.cameraControls.zoom = 1; this.cameraControls.height = 0;
    this.settings.camera = mode;
    this.ui && this.ui.syncSettings && this.ui.syncSettings();
    this.audio.ui('click');
    this.msg('КАМЕРА · ' + P.ru, 1.1, '#9fd0ff');
    this.saveSettings();
  }
  /** Kept as an alias: "reset the camera" now means "the authored rig". */
  camReset() { this.setCameraPreset(CAMERA_ORDER[0]); }

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

  updateCamera(dt) {
    const aspect = this.R.aspect();
    const rig = cameraRigFor(this.settings.camera, this.ball.p, aspect, this.camRig, this.cameraControls);
    V3.set(this.camPosT, rig.eye.x, rig.eye.y, rig.eye.z);
    V3.set(this.camLookT, rig.look.x, rig.look.y, rig.look.z);
    this.fovT = rig.fov;
    this.applyCamera(dt);

    /* HUD and paddle constraints share the actual shifted projection.
     * Text begins below the full table, including its feet. */
    /* From the smoothed camera, not from the target rig: camVP is the contract
     * for "what is on screen right now" (the band, the bat clamp, the strike
     * ring), and applyCamera glides toward the rig over ~0.5 s, so building it
     * from the destination made the clamp correct for a frame that had not
     * happened yet. Shake is still excluded, as the field's comment promises. */
    const lrig = this._liveRig || (this._liveRig = { eye: V3.new(), look: V3.new(), fov: 40 });
    V3.copy(lrig.eye, this.camPos);
    V3.copy(lrig.look, this.camLook);
    lrig.fov = this.fov;
    lrig.shiftY = this.camShiftY;
    this.camVP = rigViewProj(lrig, aspect, this._rigBuf);
    this.camVPReady = true;
    const bounds = tableScreenBounds(this.camVP, this._hudTableBounds || (this._hudTableBounds = {}));
    const band = clamp(bounds.bottom, 0.2, 0.91);
    this.hudBandY = band;
    const css = band.toFixed(4);
    if (css !== this._bandCss) {
      this._bandCss = css;
      if (typeof document !== 'undefined' && document.documentElement)
        document.documentElement.style.setProperty('--table-bottom', css);
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
    this.camShiftY = this.replayer.on ? 0 : tableFrameShift({ eye: this.camPos, look: this.camLook, fov: this.fov }, this.R.aspect());
    this.R.setCamera(eye, look, { x: 0, y: 1, z: 0 }, this.fov, 0.05, 60, this.camShiftY);
    this.R.setLightFrustum(V3.new(0, PH.TABLE_Y, 0), 6.0, 2.35, 0.5, 14);
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
      this.pointer = { x: 0.50, y: 0.65 };
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
      if (sp.ok) {
        this.pointer = { x: clamp(sp.x, 0.35, 0.65), y: clamp(sp.y, 0.45, 0.75) };
      }
      // Start the stroke as soon as apex is crested
      if ((b.v.y <= 0.15 && this.stateT > 0.16) || b.p.y < (this.tossApex || 1) - 0.02) {
        this.startDemoSwipe('serve');
      }
      return;
    }

    // 3. Returning balls during a rally
    if (this.state === GS.RALLY && b.live && b.lastHitBy === -1) {
      // Guide the pointer towards the incoming ball
      const sp = this.project(b.p, this._pvDemo || (this._pvDemo = {}));
      if (sp.ok) {
        this.pointer = { x: clamp(sp.x, 0.20, 0.80), y: clamp(sp.y + 0.05, 0.45, 0.75) };
      }
      const w = this._strike;
      const canHit = (w && w.on && w.ready > 0.45) || (b.p.z >= PH.T_HALF_LEN && b.v.z > 0.2);
      if (canHit) {
        this.startDemoSwipe('rally');
      }
    }
  }

  startDemoSwipe(kind) {
    const sp = this.project(this.ball.p, this._pvDemo || (this._pvDemo = {}));
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
      dur = 0.10 + Math.random() * 0.02;
      const rand = Math.random();
      if (rand < 0.20) {
        // slice / push downward
        dy = 0.14;
        dx = (Math.random() - 0.5) * 0.04;
      } else if (rand < 0.45) {
        // sidespin curve
        dx = (Math.random() > 0.5 ? 1 : -1) * 0.16;
        dy = -0.20;
      }
    }

    const x0 = clamp(cx, 0.15, 0.85);
    const y0 = clamp(cy + 0.10, 0.25, 0.85);
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

  /** Worst frame of the last three seconds. The FPS readout is an average
   *  over half a second, so a single 60 ms hitch disappears into it; this is
   *  the number that answers "did the frame actually stall?" */
  noteFrame(ms) {
    if (!Number.isFinite(ms) || ms <= 0 || ms > 2000) return;  // ignore sleep/tab switches
    this._peakAcc = (this._peakAcc || 0) + ms;
    if (this._peakAcc > 3000) { this._peakAcc = 0; this.peakMs = 0; }
    if (ms > this.peakMs) this.peakMs = ms;
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
    this.stateT += dtReal;

    if (this.slowmoUntil && this.time > this.slowmoUntil) { this.targetTimeScale = 1; this.slowmoUntil = 0; }
    this.updateSlowmo(dtReal);
    this.timeScale = expSmooth(this.timeScale, this.targetTimeScale, 9, dtReal);

    if (this.demoMode && !this.paused) {
      this.updateDemoPlayer(dtReal);
    }

    this.updateShotDiagnostics();

    // state machine
    switch (this.state) {
      case GS.SERVE_READY:
        if (this.server === -1) {
          this.aiServeHold();
          this.aiServeTimer -= dtReal;
          if (this.aiServeTimer <= 0) {
            V3.set(this.ball.v, rndSym(0.05), 3.1, rndSym(0.05));
            this.ball.live = true;
            this.isServeBall = true;
            this.setState(GS.SERVE_TOSS);
            this.aiSwingAt = this.time + 0.42;
          }
        } else {
          this.serveHint = clamp(this.serveHint + dtReal, 0, 3);
          // the ball rests in front of the bat, aligned with the player
          V3.set(this.ball.p, this.player.pos.x,
            PH.TABLE_Y + 0.14, clamp(this.player.pos.z - 0.04, PH.T_HALF_LEN + 0.04, PADDLE_LIMITS.zFar));
        }
        break;
      case GS.SERVE_TOSS:
        /* The opponent tosses from its own stance: until it strikes, the bat
         * must rise WITH the ball, not stand frozen at home while the ball
         * climbs away from it (the "racket stands separately on the serve"
         * glitch). ai.think only drives the bat for an incoming ball, so this
         * hold is the bat's only position through the opponent's own toss. */
        if (this.server === -1 && this.ball.live && this.ball.lastHitBy === 0) this.aiServeHold();
        /* The opponent strikes at a HEIGHT, not at a deadline. `aiSwingAt`
         * is real seconds while the ball integrates scaled seconds, so under
         * slow-mo a fixed deadline met the ball 10-20 cm lower than intended
         * and every slowed-down serve came out a different serve. The height
         * is also what makes a fast serve geometrically possible: from 0.61 m
         * above the table even a full-speed flat swing cannot bounce on the
         * server's own half, so the solver used to halve it (measured: the
         * fast serve left the bat at 24 km/h at swing scale 0.50). At 0.36 m
         * on the way down it is a real serve. */
        if (this.server === -1 && this.ball.lastHitBy === 0 && this.stateT > 0.10 &&
          ((this.ball.v.y < 0 && this.ball.p.y <= PH.TABLE_Y + AI_SERVE_CONTACT_Y) ||
            this.time > this.aiSwingAt + 0.6)) {
          let racket = this.ai.serve(this);
          // the opponent does not get to donate points either — but a level
          // whose skill is already 1.0 has been solved at full assist, and
          // re-solving the same problem is pure frame time
          if (racket.valid === false && clamp(this.ai.L.skill, 0, 1) < 0.999) {
            racket = refineRacketRealtime(this.ball.p, this.ball.v, this.ball.w, racket, 1, racket.quality);
          }
          const contact = V3.clone(this.ball.p);
          const info = impactRacket(this.ball.v, this.ball.w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
          if (!info) break;
          V3.copy(this.aiPaddle.pos, this.ball.p);
          V3.copy(this.aiPaddle.normal, racket.normal);
          V3.addScaled(this.ball.p, this.ball.p, racket.normal, PH.R * 1.05);
          this.serveBounces = 0; this.rallyBounces.length = 0;
          this.applyHit(-1, racket, contact, racket.quality, info);
          this.setState(GS.RALLY);
        }
        if (this.server === 1 && this.ball.lastHitBy === 0) {
          this.tossApex = Math.max(this.tossApex || 0, this.ball.p.y);
          if (this.stateT > 3.4) this.awardPoint(-1, 'ПОДАЧА НЕ ВЫПОЛНЕНА');
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

    // physics substeps
    if (this.ball.live) {
      this._acc += dt;
      let guard = 0;
      /* How many physics steps this frame will take, so the paddle's own
       * frame-long travel can be split into exactly that many poses. */
      const nSub = Math.max(1, Math.min(400, Math.floor(this._acc / PHYS_DT + 1e-9)));
      this._subK = 0;
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
      if (h.length > 96 * 3) h.splice(0, 3);
    } else this._acc = 0;

    this.updateStrikeWindow(dtReal);
    this.logInput('frame', { dt: dtReal });
    if (this.state === GS.RALLY || this.state === GS.SERVE_TOSS) this.moments.push(this.time, this);
    if (this.training) this.training.update(dtReal);
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
        // Color based on spin type
        if (Math.abs(this.ball.w.x) > Math.abs(this.ball.w.y)) {
          this.spinIndicator.color = this.ball.w.x > 0 ? [1, 0.5, 0.1] : [1, 0.2, 0.2];
        } else {
          this.spinIndicator.color = this.ball.w.y > 0 ? [0.1, 0.8, 0.4] : [0.2, 0.4, 1];
        }
      } else {
        this.spinIndicator.color = [0.8, 0.8, 0.8];
      }
    } else {
      this.spinIndicator.active = false;
    }

    // Update momentum
    if (this.settings.momentumBar) {
      if (this.lastPoint && this.lastPoint.who > 0) {
        this.momentum.streak++;
        this.momentum.target = Math.min(1, this.momentum.streak / 5);
      } else if (this.lastPoint && this.lastPoint.who < 0) {
        this.momentum.streak = 0;
        this.momentum.target = 0;
      }
      this.momentum.current = expSmooth(this.momentum.current, this.momentum.target, 3, dtReal);
    }

    if (this.profile) {
      this.profile.data.stats.minutes += dtReal / 60;
      this.profile.maybeSave(dtReal);
    }
    this.updateCamera(dtReal);
    this.keepPaddleOnScreen();

    // post-processing reacts to the action
    const P = this.R.post;
    const sp = clamp(V3.len(this.ball.v) / 30, 0, 1);
    if (this.reducedMotion || (this.cut && this.cut.blur)) {
      P.radial = 0; P.flash = 0;
      if (this.cut && this.cut.blur) P.ca = 0;
    } else {
      P.radial = expSmooth(P.radial, this.ball.live ? sp * sp * 0.85 : 0, 5, dtReal);
      P.flash = expSmooth(P.flash, this.hitFlash * 0.05, 10, dtReal);
    }
    P.sat = expSmooth(P.sat, 1.05 + (1 - this.timeScale) * 0.25, 4, dtReal);
    P.ca = (this.cut && this.cut.blur) ? 0 : expSmooth(P.ca, 0.55 + sp * 0.75, 4, dtReal);
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
  buildTrail() {
    const h = this.ball.hist, R = this.R, m = this.scene.mesh.trail;
    const n = h.length / 3;
    if (n < 3 || !this.settings.showTrail || this.reducedMotion) { m.count = 0; return; }
    const cam = this.R.camPos;
    let nv = 0, ni = 0;
    const maxW = clamp(0.004 + V3.len(this.ball.v) * 0.0008, 0.004, 0.016);
    for (let i = 0; i < n; i++) {
      const x = h[i * 3], y = h[i * 3 + 1], z = h[i * 3 + 2];
      const nx = i < n - 1 ? h[(i + 1) * 3] : x, ny = i < n - 1 ? h[(i + 1) * 3 + 1] : y, nz = i < n - 1 ? h[(i + 1) * 3 + 2] : z;
      let dx = nx - x, dy = ny - y, dz = nz - z;
      if (i === n - 1 && n > 1) { dx = x - h[(i - 1) * 3]; dy = y - h[(i - 1) * 3 + 1]; dz = z - h[(i - 1) * 3 + 2]; }
      let vx = cam.x - x, vy = cam.y - y, vz = cam.z - z;
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      const t = i / (n - 1);
      const w = maxW * t * t;
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

  billboard(out, pos, size, roll) {
    const t = this._bb || (this._bb = { f: V3.new(), q: Q.new(), q2: Q.new(), s: V3.new(), up: V3.new(0, 1, 0) });
    V3.sub(t.f, this.R.camPos, pos); V3.norm(t.f, t.f);
    Q.lookRotation(t.q, t.f, t.up);
    if (roll) { Q.setAxisAngle(t.q2, t.f.x, t.f.y, t.f.z, roll); Q.mul(t.q, t.q2, t.q); }
    V3.set(t.s, size, size, size);
    return M4.compose(out, pos, t.q, t.s);
  }

  drawDynamic(shadowPass) {
    const R = this.R, S = this.scene, me = S.mesh, ma = S.mat;
    const tmp = S._tmp;
    const d = shadowPass
      ? (mesh, mat4, mat) => R.drawShadow(mesh, mat4, null, 0)
      : (mesh, mat4, mat) => R.draw(mesh, mat4, mat);

    /* ball */
    if (this.ball.live || this.state === GS.SERVE_READY) {
      M4.compose(tmp.m, this.ball.p, this.ball.q, V3.set(tmp.scl, 1, 1, 1));
      d(me.ball, tmp.m, ma.ball);
    }

    /* Paddle-only rendering. Physics and visuals share the same face normal;
       rendering must not mutate the simulation's orientation. */
    if (this.settings.showPlayerPaddle !== false) {
      const pp = this.player;
      /* The telegraph lives here and only here: the simulation keeps the
       * blade on the ball, the drawing pulls it back for the wind-up. */
      const ao = !this.reducedMotion && this.anticipation.active ? this.anticipation.visualOffset : null;
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
   *  the one cue that actually tells you how high the ball is. */
  drawContactShadows() {
    const R = this.R, S = this.scene, b = this.ball;
    const TY = PH.TABLE_Y, HW = PH.T_HALF_WID + 0.05, HL = PH.T_HALF_LEN + 0.05;
    S.blob(R, 0, 0, 0, 0, 1, 0.46, 1);                       // under the table
    const onTable = (x, z) => Math.abs(x) < HW && Math.abs(z) < HL;

    if (b.live || this.state === GS.SERVE_READY) {
      if (onTable(b.p.x, b.p.z) && b.p.y > TY - 0.02) S.blob(R, b.p.x, b.p.y, b.p.z, TY, 0.055, 0.62, 1);
      else S.blob(R, b.p.x, b.p.y, b.p.z, 0, 0.075, 0.40, 1);
    }
    const ap = this.aiPaddle.pos;
    if (onTable(ap.x, ap.z)) S.blob(R, ap.x, ap.y, ap.z, TY, 0.115, 0.42, 1.25);
    else S.blob(R, ap.x, ap.y, ap.z, 0, 0.16, 0.24, 1.25);
  }

  /** Short haptic pulse on touch devices. Silent no-op everywhere else. */
  buzz(ms) {
    if (!this.settings.haptics) return;
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
  }

  /** Reflections of the bright movers in the table top. Only things that
   *  actually add light get one: the ball, the red rubber, the net tape. */
  drawReflections() {
    const R = this.R, S = this.scene, b = this.ball;
    const cx = this.camPos.x, cz = this.camPos.z;
    if (b.live || this.state === GS.SERVE_READY) {
      S.gloss(R, b.p.x, b.p.y, b.p.z, cx, cz, 0.055, 1.70, [1.0, 0.96, 0.86]);
    }
    const pp = this.player.pos;
    if (this.settings.showPlayerPaddle !== false)
      S.gloss(R, pp.x, pp.y, pp.z, cx, cz, 0.095, 0.95, [0.95, 0.26, 0.22]);
    const ap = this.aiPaddle.pos;
    S.gloss(R, ap.x, ap.y, ap.z, cx, cz, 0.095, 0.40, [0.40, 0.50, 0.68]);
  }

  drawFX() {
    const R = this.R, S = this.scene, me = S.mesh;
    const tmp = S._tmp;
    /* trail */
    this.buildTrail();
    if (me.trail.count) {
      const w = this.ball.w;
      const top = -w.x, side2 = w.y;
      let col;
      const mag = V3.len(w);
      if (mag < 60) col = [0.55, 0.62, 0.75];
      else if (Math.abs(side2) > Math.abs(top) * 0.8) col = [0.22, 0.88, 0.55];
      else if (top > 0) col = [1.0, 0.48, 0.18];
      else col = [0.30, 0.62, 1.0];
      const k = clamp(mag / 700, 0.12, 1) * 0.9;
      R.draw(me.trail, M4.identity(tmp.m), {
        color: [1, 1, 1], rough: 1, blend: 'add', doubleSided: true,
        emissive: [col[0] * k, col[1] * k, col[2] * k], opacity: 0.20,
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

    /* predicted landing spot */
    if (this.settings.showPredict && this.ball.live && this.predictOut.landed && this.ball.lastHitBy === 1) {
      const L = this.predictOut.landed;
      const pulse = this.reducedMotion ? 0.055 : 0.055 + Math.sin(this.time * 9) * 0.008;
      M4.compose(tmp.m, V3.new(L.x, PH.TABLE_Y + 0.004, L.z),
        Q.setAxisAngle(Q.new(), 1, 0, 0, -Math.PI / 2), V3.new(pulse, pulse, pulse));
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

    /* ball glow so it reads against the dark hall */
    if (this.ball.live) {
      const g = clamp(0.03 + V3.len(this.ball.v) * 0.0022, 0.03, 0.09);
      this.billboard(tmp.m, this.ball.p, g, 0);
      R.draw(me.quad, tmp.m, {
        color: [1, 1, 1], tex: this.scene.tex.glow, blend: 'add', doubleSided: true,
        emissive: [0.42, 0.44, 0.40], rough: 1,
      });
    }
  }

  /** The opponent is deliberately NOT a character model: a floating bat
   *  reads the incoming stroke far better than a torso in the way of the
   *  ball, and nothing about a low-poly human helps you play. */
  drawOpponent() {}


  render() {
    const R = this.R;
    this.syncSize();
    if (R.beginShadow()) {
      this.scene.drawStatic(R, true);
      this.drawDynamic(true);
    }
    R.beginScene([0.018, 0.022, 0.032]);
    this.scene.drawStatic(R, false);   // opaque hall + table
    this.drawContactShadows();         // soft grounding shade (multiply-ish)
    this.drawReflections();            // glossy smear in the table top
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
