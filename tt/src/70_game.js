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
    this.R = new Renderer(canvas, { quality: 'high' });
    this.scene = new Scene(this.R, 'arena');
    this.audio = new AudioEngine();
    this.ai = new OpponentAI(2);
    this.swipe = new SwipeTracker();
    this.particles = new Particles();
    this.rig = new PaddleRig();
    this.equip = new Equipment();
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
    this.replayer.onEnd = () => this.endReplay();

    this.settings = {
      assist: 0.72,
      posAssist: 0.80,
      difficulty: 2,
      quality: 'high',
      sound: true,
      volume: 0.9,
      camera: 'BROADCAST',
      hand: 'right',
      showTrail: true,
      showPredict: true,
      showZone: true,
      showTele: false,
      haptics: true,
      coach: true,                       // one-line point analysis
      adaptive: true,                    // dynamic difficulty
      showDebug: false,
      showPlayerPaddle: false,           // "ракетку скрой" - hide player paddle by default
      slowmoOnBigShots: true,
      slowmoPlayer: true,                // bullet time, for the player, in casual play only
      targetScore: 11,
      sensitivity: 1.0,
      spinBias: 'norm',                  // low | norm | high — see deriveStroke
    };
    /* Saved settings are applied AFTER the defaults exist. It used to run
     * 60 lines earlier, while this.settings was still undefined, so
     * Object.assign threw — and because boot() catches everything, a player
     * who had EVER changed a setting got the "WebGL недоступен" screen on
     * every following visit. A first visit worked (profile.data.settings is
     * null then), which is why it survived to here. Found by the headless
     * smoke suite: 2 of 3 matches failed to boot once localStorage was warm. */
    this.loadSettings();

    this.ball = {
      p: V3.new(0, PH.TABLE_Y + 0.3, 1.2), v: V3.new(), w: V3.new(),
      q: Q.new(), live: false, hist: [], lastHitBy: 0, speed: 0,
    };
    this.player = {
      pos: V3.new(0, PH.TABLE_Y + 0.25, 1.45),
      prev: V3.new(0, PH.TABLE_Y + 0.25, 1.45),
      vel: V3.new(), normal: V3.new(0, 0, -1),
      q: Q.new(), swing: 0, side: 1, hitRadius: 0.095, lastHitT: -9,
      prevPos: V3.new(0, PH.TABLE_Y + 0.25, 1.45),
    };
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
    /* The camera is a choice between four AUTHORED rigs (57_camera.js):
     * fixed distance, fixed angle, table always square to the frame. There
     * is deliberately no free orbit any more — hand-tuning yaw/pitch/zoom
     * cost players minutes per session and could park the bat off-screen,
     * and every framing it produced was worse than one of the four. */
    this.camRig = { eye: V3.new(0, 1.68, 2.38), look: V3.new(0, 0.74, -0.25), fov: 48, mode: 'BROADCAST' };
    this._rigBuf = { vp: M4.create(), proj: M4.create(), view: M4.create() };
    this.camVP = M4.create();          // view·proj of the authored rig, no shake
    this.hudBandY = 0.40;              // screen y where the table's far edge begins
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
      let x = (e.clientX - r.left) / w;
      let y = (e.clientY - r.top) / h;
      /* Outside the canvas the coordinates used to be clamped to
       * [-0.25 .. 1.25] — a quarter of a screen BEYOND each edge. That is
       * how the bat got parked somewhere the camera never shows and, since
       * no further move events arrive once the cursor leaves the window,
       * it stayed there. The pointer is now always inside 0..1. */
      if (!Number.isFinite(x)) x = 0.5; else x = clamp(x, 0, 1);
      if (!Number.isFinite(y)) y = 0.5; else y = clamp(y, 0, 1);
      return { x, y };
    };

    /* One input language: the pointer drives the bat and the swipe.
     *   one finger / left button  → the stroke, and where the bat stands
     *   a second finger           → throws the half-made stroke away
     * The camera is NOT on the pointer any more (four authored rigs, keys
     * 1..4 / C), so there is no orbit, no pinch-zoom and no wheel-zoom: a
     * framing that has to be rebuilt by hand every session is a framing
     * that is wrong most of the time. */
    const ptrs = new Map();
    const dropStroke = () => {
      this.swipe.cancel();
      this.pointerDown = false;
    };

    const down = (e) => {
      if (this.state === GS.MENU || this.state === GS.MATCH_END) return;
      this.audio.init(); this.audio.resume();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();

      if (this.replayer.on) { this.skipReplay(); return; }   // tap = skip the reel
      if (e.button === 2 || e.button === 1) {        // right / middle: not a stroke
        dropStroke();
        return;
      }
      if (ptrs.size >= 2) {                          // a second finger cancels
        dropStroke();
        return;
      }
      const n = norm(e);
      this.swipe.down(n.x, n.y, this.time);
      this._lastPointSwipe = {
        startT: this.time,
        sx: n.x, sy: n.y,
        samples: [{ x: n.x, y: n.y, t: this.time }],
        stroke: null
      };
      this.pointer = n; this.pointerDown = true;
      if (this.state === GS.SERVE_READY && this.server === 1) this.startToss();
    };

    /* Where the bat wants to be. Tracked on the WINDOW, not on the canvas:
     * a cursor that leaves the canvas keeps sending events here, so the bat
     * keeps following it instead of freezing at the last in-canvas position
     * (that freeze was the "bat and cursor are kilometres apart" bug). */
    const track = (e) => {
      const n = norm(e);
      this.pointer = n;
      this.pointerInside = n.x > 0.001 && n.x < 0.999 && n.y > 0.001 && n.y < 0.999;
      return n;
    };

    const move = (e) => {
      const p = ptrs.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      const n = track(e);
      if (this.swipe.active && ptrs.size < 2) {
        this.swipe.move(n.x, n.y, this.time);
        if (this._lastPointSwipe) {
          this._lastPointSwipe.samples.push({ x: n.x, y: n.y, t: this.time });
          if (this.liveStroke) this._lastPointSwipe.stroke = { ...this.liveStroke.stroke };
        }
        const sp = this.swipe.m.speed;
        if (sp > 1.6) this.audio.whoosh(clamp(sp / 4, 0, 1.4));
      }
      if (e.cancelable) e.preventDefault();
    };

    const up = (e) => {
      ptrs.delete(e.pointerId);
      if (e.button === 2 || e.button === 1) { e.preventDefault(); return; }
      if (ptrs.size >= 1) { e.preventDefault(); return; }   // still another finger down
      if (!this.swipe.active) return;
      const n = this.pointer || { x: 0.5, y: 0.5 };
      this.swipe.up(n.x, n.y, this.time);
      if (this._lastPointSwipe) {
        this._lastPointSwipe.samples.push({ x: n.x, y: n.y, t: this.time });
        this._lastPointSwipe.endT = this.time;
        this._lastPointSwipe.ex = n.x;
        this._lastPointSwipe.ey = n.y;
        this._lastPointSwipe.dist = Math.hypot(n.x - this._lastPointSwipe.sx, n.y - this._lastPointSwipe.sy);
        if (this.liveStroke) this._lastPointSwipe.stroke = { ...this.liveStroke.stroke };
      }
      this.pointerDown = false;
      this.swipeReleasedAt = this.time;
      this.lastSwipeT = this.time;
      e.preventDefault();
    };

    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); down(e); });
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    /* the bat follows the cursor across the whole window, so leaving the
       canvas can never strand it; the wheel no longer zooms (fixed rigs) */
    window.addEventListener('pointermove', (e) => { if (!ptrs.size) track(e); }, { passive: true });
    window.addEventListener('blur', () => { this.pointerDown = false; this.swipe.cancel(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
    }, { passive: false });
    c.style.touchAction = 'none';

    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') this.restart();
      if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') this.setPaused(!this.paused);
      if (e.key === 'F3') { this.settings.showDebug = !this.settings.showDebug; e.preventDefault(); }
      if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') {
        const i = CAMERA_ORDER.indexOf(this.settings.camera);
        this.setCameraPreset(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]);
      }
      /* --- the four authored rigs, straight off the keyboard --- */
      if (e.key >= '1' && e.key <= '4') {
        this.setCameraPreset(CAMERA_ORDER[+e.key - 1]);
        e.preventDefault();
      }
      if (e.key === '0' || e.key === ')') { this.setCameraPreset(CAMERA_ORDER[0]); e.preventDefault(); }
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.settings.quality === 'low' ? 1.25 : 2);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.R.resize(w, h, dpr);
    this.vw = w; this.vh = h;
  }

  /* --------------------------- match flow -------------------------- */
  startMatch(diff) {
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
    this.missedRallies = [];
    this.isDebugReplay = false;
    this.currentMissIndex = -1;
    this.server = Math.random() < 0.5 ? 1 : -1;
    this.servesLeft = 2;
    this.audio.init(); this.audio.resume();
    if (!this._keepDemo) this.demoMode = false;
    this._keepDemo = false;
    this.prepServe();
    if (this.demoMode) {
      this.msg('🤖 РЕЖИМ НАБЛЮДЕНИЯ: БОТ VS БОТ', 3.0, '#39c6ff', true);
      this.msg('СМОТРИТЕ НА ТРАЕКТОРИЮ СВАЙПОВ', 3.0, '#7fd4ff');
    } else {
      this.msg(this.server === 1 ? 'ВАША ПОДАЧА' : 'ПОДАЁТ СОПЕРНИК', 1.6, '#7fd4ff');
      this.msg('СВАЙП = УДАР · РАКЕТКА САМА ИДЁТ К МЯЧУ', 3.4, '#9fe0ff');
    }
  }
  startDemo(diff = 2) {
    this._keepDemo = true;
    this.demoMode = true;
    this.startMatch(diff);
  }
  restart() { this.startMatch(this.settings.difficulty); }

  /* --------------------------- training ---------------------------- */
  startTraining() {
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
    this._minBallPaddleDist = 99;
    this._lastPointSwipe = null;
    /* Every point begins from the same known state: bat back in the centre,
     * cursor binding re-anchored, no stale intercept from the last rally. */
    this.resetPaddle();
    this.setState(GS.SERVE_READY);
    this.recorder.begin(this.time, s);
    this.moments.beginRally(this.time, this.score);
    this.ai.setPressure(this.score[1], this.score[0], this.settings.targetScore);
    if (s < 0) this.aiServeTimer = rnd(0.7, 1.3);
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
    V3.set(b.p, pad.pos.x,
      PH.TABLE_Y + 0.14, clamp(pad.pos.z - 0.04, PH.T_HALF_LEN + 0.04, 2.0));
    V3.set(b.v, rndSym(0.03), 2.45 + rnd(0, 0.2), rndSym(0.03));
    this.tossApex = PH.TABLE_Y;
    V3.zero(b.w);
    b.live = true;
    this.isServeBall = true;
    this.setState(GS.SERVE_TOSS);
    this.audio.ui('toss');
  }

  /* ---------------------------- scoring ---------------------------- */
  awardPoint(who, reason) {
    if (this.training) {                 // drills have no score, only feedback
      this.training.onFault(who, reason);
      this.ball.live = false;
      return;
    }
    if (this.state === GS.POINT || this.state === GS.MATCH_END) return;
    const idx = who > 0 ? 0 : 1;
    this.score[idx]++;
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
    if (who === -1 && !this.training) {
      this.recordMissedPoint(reason);
    }
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
    if (!(info && info.edge > 0.25)) this.audio.hitTable(speed, this.ball.p.x);
    this.addMark(this.ball.p.x, this.ball.p.z, speed);
    this.particles.burst(this.ball.p.x, PH.TABLE_Y + 0.005, this.ball.p.z,
      4 + (speed > 9 ? 4 : 0), 0.5 + speed * 0.06, 0.26, 0.016, 1, 1, 0.92, { x: 0, y: 0.7, z: 0 });
    this.shakeIt(clamp(speed / 46, 0, 0.26), V3.new(0, 1, 0));

    const lh = this.ball.lastHitBy;
    this.rallyBounces.push(side);
    this.recorder.addBounce(side, this.ball.p.x, this.ball.p.z, lh);
    if (this.training) this.training.onBounce(side, lh);

    if (this.isServeBall) {
      this.serveBounces++;
      if (this.serveBounces === 1) {
        if (side !== lh) { this.awardPoint(-lh, 'ОШИБКА ПОДАЧИ'); return; }
      } else if (this.serveBounces === 2) {
        if (side !== -lh) { this.awardPoint(-lh, 'ОШИБКА ПОДАЧИ'); return; }
        this.isServeBall = false;      // serve is good, normal rally from here
        this.rallyBounces.length = 0;
        this.rallyBounces.push(side);  // ...and the receiver's half HAS been touched
      }
      return;
    }

    if (side === lh) { this.awardPoint(-lh, lh > 0 ? 'МЯЧ НЕ ПЕРЕЛЕТЕЛ' : 'СОПЕРНИК НЕ ПЕРЕЛЕТЕЛ'); return; }
    // second bounce on the receiver's side -> the receiver failed to return
    const onRecv = this.rallyBounces.filter((s) => s === -lh).length;
    if (onRecv >= 2) {
      this.awardPoint(lh, lh > 0 ? 'ОЧКО! СОПЕРНИК НЕ ДОСТАЛ' : 'ВЫ НЕ ДОСТАЛИ МЯЧ');
    }
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
    this.marks.push({ x, z, t: 0, life: 1.5, s: clamp(0.05 + speed * 0.004, 0.05, 0.12) });
    if (this.marks.length > 14) this.marks.shift();
  }

  shakeIt(amount, dir) {
    this.shake = Math.min(1.1, this.shake + amount);
    if (dir) V3.copy(this.shakeDir, V3.norm(dir, dir));
  }

  /* -------------------------- impact events ------------------------ */
  applyHit(side, racket, contactP, quality, info) {
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
    if (!this.isServeBall) this.rally++;

    const speed = V3.len(b.v), spin = V3.len(b.w);
    this.stats.shots++;
    this.stats.totalSpin += spin / TAU;
    if (speed * 3.6 > this.stats.maxSpeed) this.stats.maxSpeed = speed * 3.6;
    if (spin / TAU > this.stats.maxSpin) this.stats.maxSpin = spin / TAU;

    const name = racket.stroke ? racket.stroke.id : 'DRIVE';
    this.stats.byStroke[name] = (this.stats.byStroke[name] || 0) + 1;

    /* an off-centre contact sounds like wood, not like rubber */
    const softHit = !!(racket.arch && racket.arch.soft) || (side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.38);
    this.audio.hitRacket(speed, info ? info.contactSlip : 0, softHit);
    if (side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.30) this.buzz(16);
    const col = racket.stroke ? hexToRgb(racket.stroke.col) : [1, 1, 1];
    this.particles.burst(contactP.x, contactP.y, contactP.z,
      side > 0 ? 14 : 9, 0.7 + speed * 0.05, 0.32, 0.019, col[0], col[1], col[2],
      { x: -racket.normal.x * 0.6, y: -racket.normal.y * 0.6, z: -racket.normal.z * 0.6 });

    if (side > 0) {
      this.hitFlash = 1;
      this.lastShotInfo = {
        stroke: racket.stroke, speed: speed * 3.6, spin: spin / TAU,
        topspin: -b.w.x * side, sidespin: b.w.y, quality,
        power: racket.power, t: this.time,
        contact: racket.contact, elev: racket.elev,
        timing: side > 0 ? (this.lastTiming || '') : '',
        sweet: side > 0 ? (this.lastSweet !== undefined ? this.lastSweet : 1) : 1,
        rim: side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.42,
      };
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
      this.buzz(Math.round(lerp(8, 26, clamp(speed / 90, 0, 1))));
      this.shakeIt(clamp(speed / 55, 0.03, 0.38), V3.new(rndSym(0.4), 0.5, 1));
      if (this.settings.slowmoOnBigShots && speed * 3.6 > 78) this.punchSlowmo(0.42, 0.26);
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
    S.active = want;
    if (want) { this.targetTimeScale = 0.34; this.slowmoUntil = 0; }
    else if (!this.slowmoUntil) this.targetTimeScale = 1;
  }

  /** Career tournaments and online matches call this with false. */
  setSlowmoAllowed(v) { this.slowmo.allowed = !!v; if (!v) this.setSlowmoHold(false); }

  /* --------------------------- settings ---------------------------- */

  /** The player's preferences are part of the save: coming back to a game
   *  that has forgotten your sensitivity is coming back to a stranger. */
  saveSettings() {
    if (!this.profile) return;
    const s = this.settings;
    this.profile.data.settings = {
      assist: s.assist, posAssist: s.posAssist, difficulty: s.difficulty, quality: s.quality,
      sound: s.sound, volume: s.volume, camera: s.camera, hand: s.hand,
      showTrail: s.showTrail, showPredict: s.showPredict, showZone: s.showZone,
      showTele: s.showTele, haptics: s.haptics, coach: s.coach, adaptive: s.adaptive,
      slowmoPlayer: s.slowmoPlayer, targetScore: s.targetScore, sensitivity: s.sensitivity,
      spinBias: s.spinBias,
    };
    this.profile.touch();
  }

  loadSettings() {
    if (!this.settings || !this.profile || !this.profile.data.settings) return false;
    Object.assign(this.settings, this.profile.data.settings);
    if (this.settings.volume !== undefined) this.audio.setVolume(this.settings.volume);
    if (this.settings.sound === false) this.audio.setMuted(true);
    if (this.settings.difficulty !== undefined) this.ai.setLevel(this.settings.difficulty);
    if (this.settings.quality) this.R.quality = this.settings.quality;
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
    if (!this.replayer.play(moment, hero ? 0.35 : 0.5)) return false;
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
    if (this.isDebugReplay && this._missIndex !== undefined && this._missIndex < (this.missedRallies || []).length - 1) {
      this._missIndex++;
      this.watchMiss(this._missIndex, 0.22);
      return;
    }
    this.replayer.finish();
    this.endReplay();
  }

  endReplay() {
    this.ui && this.ui.replayShow(false);
    this.ui && this.ui.debugReplayShow && this.ui.debugReplayShow(false);
    if (typeof document !== 'undefined') {
      document.body.classList.remove('is-reel');
    }
    this.isDebugReplay = false;
    this.camFov = undefined;
    if (this.state === GS.REPLAY) this.setState(this.replayFrom || GS.POINT);
    const cb = this.replayAfter; this.replayAfter = null;
    if (cb) cb();
  }

  recordMissedPoint(reason) {
    if (!this.missedRallies) this.missedRallies = [];
    const clipData = this.moments.captureClip(this.time);
    const b = this.ball, pad = this.player;
    const curDist = V3.dist(b.p, pad.pos);
    const minDist = Math.min(this._minBallPaddleDist !== undefined ? this._minBallPaddleDist : 99, curDist);
    const rad = pad.hitRadius || 0.22;
    const hadSwipe = (this.time - (this.swipeReleasedAt || -99)) < 0.85 || (this.swipe && this.swipe.active);
    const strokeName = this.liveStroke ? (this.liveStroke.stroke.short || this.liveStroke.stroke.name)
      : (this.swipe.lastReleased ? 'СВАЙП' : 'НЕТ СВАЙПА');

    let verdict = '';
    let isReachIssue = false;
    if (!hadSwipe) {
      verdict = 'Свайп не был выполнен (пропуск мяча)';
    } else if (minDist > rad * 1.45) {
      verdict = `Не дотянулся: мяч в ${minDist.toFixed(2)} м (радиус ракетки ${rad.toFixed(2)} м)`;
      isReachIssue = true;
    } else if (reason === 'В СЕТКУ') {
      verdict = 'Удар выполнен, но мяч попал в сетку (слишком низкая дуга)';
    } else if (reason === 'АУТ') {
      verdict = 'Удар выполнен, но мяч улетел в аут (слишком сильный удар/высокая дуга)';
    } else if (reason === 'МЯЧ НЕ ПЕРЕЛЕТЕЛ') {
      verdict = 'Касание было, но мяч сорвался с ракетки';
    } else {
      verdict = `${reason} (дистанция до мяча ${minDist.toFixed(2)} м)`;
    }

    let sw = this._lastPointSwipe;
    if (!sw && this.swipe && this.swipe.lastReleased) {
      const lr = this.swipe.lastReleased;
      sw = {
        sx: lr.sx, sy: lr.sy,
        ex: lr.x, ey: lr.y,
        dist: lr.dist,
        samples: [{ x: lr.sx, y: lr.sy }, { x: lr.x, y: lr.y }],
        stroke: this.liveStroke ? { ...this.liveStroke.stroke } : null
      };
    } else if (!sw && this.swipe && this.swipe.active && this.swipe.samples && this.swipe.samples.length) {
      const s0 = this.swipe.samples[0], sN = this.swipe.samples[this.swipe.samples.length - 1];
      sw = {
        sx: s0.x, sy: s0.y,
        ex: sN.x, ey: sN.y,
        dist: Math.hypot(sN.x - s0.x, sN.y - s0.y),
        samples: this.swipe.samples.map(p => ({ x: p.x, y: p.y })),
        stroke: this.liveStroke ? { ...this.liveStroke.stroke } : null
      };
    }

    let swipeData = null;
    if (sw) {
      const sx = sw.sx, sy = sw.sy;
      const ex = sw.ex !== undefined ? sw.ex : sx;
      const ey = sw.ey !== undefined ? sw.ey : sy;
      const dx = ex - sx, dy = ey - sy;
      const dist = sw.dist !== undefined ? sw.dist : Math.hypot(dx, dy);

      let dirName = 'ТОЛЬКО КЛИК (БЕЗ СВАЙПА)';
      let arrow = '•';
      if (dist >= 0.02) {
        if (Math.abs(dy) > Math.abs(dx) * 1.5) {
          if (dy < 0) { dirName = 'СВАЙП ВВЕРХ (ТОПСПИН)'; arrow = '⬆'; }
          else { dirName = 'СВАЙП ВНИЗ (ПОДРЕЗКА)'; arrow = '⬇'; }
        } else if (Math.abs(dx) > Math.abs(dy) * 1.5) {
          if (dx > 0) { dirName = 'СВАЙП ВПРАВО'; arrow = '➡'; }
          else { dirName = 'СВАЙП ВЛЕВО'; arrow = '⬅'; }
        } else {
          if (dy < 0) {
            if (dx > 0) { dirName = 'СВАЙП ВВЕРХ-ВПРАВО'; arrow = '↗'; }
            else { dirName = 'СВАЙП ВВЕРХ-ВЛЕВО'; arrow = '↖'; }
          } else {
            if (dx > 0) { dirName = 'СВАЙП ВНИЗ-ВПРАВО'; arrow = '↘'; }
            else { dirName = 'СВАЙП ВНИЗ-ВЛЕВО'; arrow = '↙'; }
          }
        }
      }

      swipeData = {
        sx, sy, ex, ey, dx, dy, dist, dirName, arrow,
        samples: sw.samples && sw.samples.length ? sw.samples.map(p => ({ x: p.x, y: p.y })) : [{ x: sx, y: sy }, { x: ex, y: ey }],
        stroke: sw.stroke || (this.liveStroke ? { ...this.liveStroke.stroke } : null)
      };
    }

    const miss = {
      id: this.missedRallies.length + 1,
      time: this.time,
      score: [this.score[0], this.score[1]],
      reason,
      verdict,
      isReachIssue,
      shots: this.rally,
      minDist,
      hitRadius: rad,
      hadSwipe: !!swipeData,
      strokeName,
      swipeData,
      frames: clipData.frames,
      hz: clipData.hz,
      ballP: { x: b.p.x, y: b.p.y, z: b.p.z },
      paddleP: { x: pad.pos.x, y: pad.pos.y, z: pad.pos.z }
    };
    this.missedRallies.push(miss);
    if (this.missedRallies.length > 50) this.missedRallies.shift();
  }

  watchMiss(index, speed = 0.20) {
    if (!this.missedRallies || !this.missedRallies[index]) return false;
    const miss = this.missedRallies[index];
    this.currentMissIndex = index;
    this.isDebugReplay = true;
    this.setSlowmoHold(false);
    this.ball.live = true;

    // Use MomentPlayer to replay the miss clip at ultra slowmo
    this.replayer.play(miss, speed, () => {
      // Loop replay smoothly so player can inspect
      if (this.replayer && this.isDebugReplay) {
        this.replayer.i = 0;
        this.replayer.hold = 0;
        this.replayer.on = true;
      }
    });

    const back = this.state;
    this.replayFrom = back === GS.MATCH_END ? GS.MATCH_END : (this.paused ? GS.SERVE_READY : GS.POINT);
    this.setState(GS.REPLAY);
    if (typeof document !== 'undefined') {
      document.body.classList.add('is-reel');
      document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
    }
    this.ui && this.ui.debugReplayShow && this.ui.debugReplayShow(true, miss, index, this.missedRallies.length);
    return true;
  }

  playAllMissesSequential(onComplete) {
    if (!this.missedRallies || !this.missedRallies.length) {
      if (onComplete) onComplete();
      return;
    }
    this._missIndex = 0;
    this.replayAfter = () => {
      this._missIndex = 999;
      if (onComplete) onComplete();
    };

    const playCurrent = () => {
      if (this._missIndex >= this.missedRallies.length) {
        this.endReplay();
        if (onComplete) onComplete();
        return;
      }
      const miss = this.missedRallies[this._missIndex];
      this.currentMissIndex = this._missIndex;
      this.isDebugReplay = true;
      this.setSlowmoHold(false);
      this.ball.live = true;
      this.replayFrom = GS.MATCH_END;
      this.setState(GS.REPLAY);

      if (typeof document !== 'undefined') {
        document.body.classList.add('is-reel');
        document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
      }

      this.replayer.play(miss, 0.22, () => {
        this._missIndex++;
        playCurrent();
      });

      if (this.ui) {
        this.ui.debugReplayShow(true, miss, this._missIndex, this.missedRallies.length);
      }
    };

    playCurrent();
  }

  /** Everything that has to be written down when the last point lands. */
  settleMatch() {
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
      }
    } else b.restT = 0;
    const p0 = V3.clone(b.p);

    integrateBall(b.p, b.v, b.w, dt);
    Q.integrate(b.q, b.q, b.w, dt);
    b.speed = V3.len(b.v);

    /* --- table --- */
    if (b.p.y - PH.R <= PH.TABLE_Y && b.v.y < 0 && p0.y - PH.R > PH.TABLE_Y - 0.02) {
      const inX = Math.abs(b.p.x) <= PH.T_HALF_WID + PH.R * 0.5;
      const inZ = Math.abs(b.p.z) <= PH.T_HALF_LEN + PH.R * 0.5;
      if (inX && inZ) {
        const sp = -b.v.y;
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
    if ((p0.z > 0) !== (b.p.z > 0) || Math.abs(b.p.z) < PH.R + 0.004) {
      const a = Math.abs(p0.z) / (Math.abs(p0.z) + Math.abs(b.p.z) + 1e-9);
      const yAt = lerp(p0.y, b.p.y, a);
      const xAt = lerp(p0.x, b.p.x, a);
      if (Math.abs(xAt) < PH.NET_HALF_WID) {
        if (yAt - PH.R < PH.NET_TOP && yAt + PH.R > PH.NET_TOP - PH.TAPE_R * 2 && yAt + PH.R > PH.NET_TOP) {
          clipTape(b.p, b.v, b.w);
          this.audio.hitNet();
          this.msg('СЕТКА — ЭДЖ!', 1.1, '#ffd34d');
          this.particles.burst(xAt, PH.NET_TOP, 0, 8, 1.1, 0.3, 0.014, 1, 0.9, 0.5);
          if (this.isServeBall) { this.letServe(); return; }
        } else if (yAt < PH.NET_TOP) {
          bounceNet(b.p, b.v, b.w, Math.sign(p0.z) || 1);
          this.audio.hitNet();
          this.particles.burst(xAt, yAt, 0, 7, 0.7, 0.3, 0.013, 0.8, 0.85, 1);
          if (this.isServeBall) { this.letServe(); return; }
          this.netTouched = true;
          this.moments.addBounce(true);
        }
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

  tryPlayerHit(p0) {
    const pad = this.player, b = this.ball;
    if (!b.live) return;
    if (b.v.z < 0 && b.p.z < pad.pos.z - 0.25) return;
    const radius = pad.hitRadius;
    const serveCtx = this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0;
    let hit = this.sweepPaddle(pad, p0, b.p, radius);
    if (!hit && serveCtx) {
      // ITTF 2.06: the ball must be struck while FALLING from the toss.
      const rad = V3.dist(b.p, pad.pos);
      if (b.v.y < 0 && this.tossApex - PH.TABLE_Y > 0.14 && rad <= radius * 1.50) {
        const sw0 = this.swipe;
        const live = (sw0.active && sw0.m.samples >= 2)
          || (sw0.lastReleased && this.time - (this.swipeReleasedAt || -9) < 0.60);
        if (live) hit = { t: 1, x: b.p.x, y: b.p.y, z: b.p.z, rad: rad * 0.55, px: pad.pos.x, py: pad.pos.y, pz: pad.pos.z };
      }
    }
    if (!hit) {
      // Forgiving return reach for balls from opponent: after bouncing on player half or crossing deep,
      // a deliberate swipe when near the ball connects reliably!
      const receiveCtx = b.lastHitBy === -1 && (this.rallyBounces.some((s) => s > 0) || b.p.z >= 0.70);
      if (receiveCtx) {
        const rad = V3.dist(b.p, pad.pos);
        const sw0 = this.swipe;
        const live = (sw0.active && sw0.m.samples >= 1)
          || (sw0.lastReleased && this.time - (this.swipeReleasedAt || -9) < 0.90);
        const isNovice = this.ai && this.ai.levelIndex === 0;
        const hitTol = radius * (isNovice ? 2.6 : 1.85);
        if (live && rad <= hitTol) {
          hit = { t: 1, x: b.p.x, y: b.p.y, z: b.p.z, rad: rad * 0.45, px: pad.pos.x, py: pad.pos.y, pz: pad.pos.z };
        }
      }
    }
    if (!hit) return;
    if (b.lastHitBy === 1) return;                 // you already hit it

    // volley check: returning before the ball bounced on your own half.
    // A ball that was flying OUT anyway is not a point you can lose: the
    // bat simply never meets it, exactly like a player pulling their hand
    // away, so cheap "obstruction" losses can never happen.
    if (!this.isServeBall && b.lastHitBy === -1 && !this.rallyBounces.some((s) => s > 0) && b.p.z < PH.T_HALF_LEN) {
      const o = this._volleyPred || (this._volleyPred = {});
      predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
        { dt: 1 / 240, maxT: 2.0, stopOnFirstBounce: true, out: o });
      const landsIn = o.landed && o.landed.z > 0.01 && Math.abs(o.landed.x) <= PH.T_HALF_WID + PH.R;
      if (!landsIn) { this.hintOut = this.time; return; }
      // the ball is about to bounce right there: treat it as a normal return
      // instead of punishing a few centimetres of timing
      if (o.landed.z > b.p.z - 0.50) return;
      this.awardPoint(-1, 'УДАР С ЛЁТА НАД СТОЛОМ');
      b.live = false;
      return;
    }

    const isServeStroke = this.isServeBall && b.lastHitBy === 0 && this.server === 1;
    pad.lastHitT = this.time;
    const contact = V3.new(hit.x, hit.y, hit.z);
    /* the tolerance of THIS face: the frame's sweet spot scaled by how
       forgiving the rubber on it is (a soft topsheet costs less) */
    const sideParams = this.equip.forSide(1);
    const sweet = clamp((1 - hit.rad / radius) * (sideParams.sweet || this.equip.sweetK), 0, 1);
    /* WHICH side of the blade it arrived on. An off-centre contact does not
     * just lose pace (that part `quality` already did): the blade twists, so
     * the ball leaves at an angle to the face you were holding. Deterministic
     * by design — the same offset always costs the same — so it can be
     * learned instead of being read as the game cheating. */
    const offLat = clamp((hit.x - pad.pos.x) / Math.max(radius, 1e-4), -1, 1);
    const offVer = clamp((hit.y - pad.pos.y) / Math.max(radius, 1e-4), -1, 1);
    const offMag = clamp(Math.hypot(offLat, offVer), 0, 1);
    this.lastSweet = sweet;

    // ---- build the stroke from the live gesture --------------------
    const sw = this.swipe;
    let m = null;
    if (sw.active && sw.m.samples > 2) m = sw.m;
    else if (sw.lastReleased && this.time - (this.swipeReleasedAt || -9) < (this.isServeBall ? 0.60 : 0.26)) m = sw.lastReleased;

    let racket, quality;
    if (m && (m.speed > 0.22 || m.peakSpeed > 0.9)) {
      const timing = clamp(m.speed / Math.max(m.peakSpeed, 1e-3), 0.35, 1);
      /* Banded, and the band is printed on the shot badge. A continuous
       * multiplier is unteachable: the player cannot tell 0.83 from 0.79, but
       * he can tell "РАНОВATO" from "ТОЧНО", and then fix it. */
      const tband = timing >= 0.93 ? 'ТОЧНО' : timing >= 0.80 ? 'ХОРОШО'
        : timing >= 0.62 ? 'РАНОВАТО' : 'ПОЗДНО';
      const tq = timing >= 0.93 ? 1.08 : timing >= 0.80 ? 1.0 : timing >= 0.62 ? 0.90 : 0.74;
      this.lastTiming = tband;
      const ctx = {
        side: 1, isServe: isServeStroke,
        ball: { y: contact.y, z: contact.z },
        ballSpin: b.w, ballSpeed: V3.len(b.v),
        powerScale: 1,
        moveYaw: pad.yaw || 0,             // the face you see is the face that hits
        equip: sideParams,                 // the rubber object for this bat
        spinBias: this.settings.spinBias || 'norm',   // the explicit spin dial
      };
      racket = deriveStroke(m, ctx);
      racket.vmag *= this.equip.vmagK;     // swing weight of the frame
      /* Off-centre contact: pace off, and the launch twisted away from the
         face by up to ~13 deg sideways / ~8 deg vertically at the rim. */
      if (!isServeStroke) {
        const miss = (1 - sweet) * offMag;
        racket.vmag *= 1 - 0.18 * miss;
        racket.azSwing = clamp(racket.azSwing + offLat * 0.23 * (1 - sweet), -1.35, 1.35);
        racket.elev = clamp(racket.elev - offVer * 8.0 * (1 - sweet), -70, 78);
      }
      quality = clamp(racket.quality * (0.55 + 0.45 * sweet) * (0.70 + 0.30 * timing) * tq, 0.18, 1);
      racket.quality = quality;
      racket = refineRacket(contact, b.v, b.w, racket, this.settings.assist, quality);
      // Losing a point because the *solver* could not keep a serve on the
      // table is never acceptable: re-solve the serve with full execution
      // help, which is a legal serve by construction (ITTF 2.06.4).
      /* ...but only when the first attempt was not already at full assist:
       * the serve solver searches the same space with the same budget, so a
       * retry can only repeat the answer and doubles the worst-case cost of a
       * serve that was never going to be legal (measured 230 -> 460 ms of
       * frozen frames on a near-motionless tap). */
      if (isServeStroke && racket.valid === false && clamp(this.settings.assist, 0, 1) < 0.999) {
        racket = refineRacket(contact, b.v, b.w, racket, 1, quality);
      }
      racket.sweet = sweet; racket.timing = timing;
    } else {
      // Passive contact: the ball meets a bat that is not swinging. Real
      // soft hands absorb most of the pace, so this is a short, safe block
      // rather than an accidental rocket off the end of the table.
      const vR = V3.clone(pad.vel);
      const lim = V3.len(vR); if (lim > 2.6) V3.mul(vR, vR, 2.6 / lim);
      racket = makeRacket(1, 'BLOCK', { aim: { x: rndSym(0.26), z: -0.62 }, vmag: lim, quality: 0.5 });
      racket.vR = vR;
      racket.rubber = { e: PH.E_RACKET * 0.42, mu: PH.MU_RACKET, et: PH.ET_RACKET * 0.7 };
      quality = 0.45 * (0.5 + 0.5 * sweet);
      /* No placement solver on a block — see solveBlockNormal(). The face the
       * player holds decides; the only correction allowed is the smallest
       * lift that keeps the ball out of the tape. */
      const blk = solveBlockNormal(contact, b.v, b.w, pad.normal, vR, quality, racket.rubber, this._blk || (this._blk = {}));
      racket.normal = blk.normal;
      racket.elev = blk.liftDeg;
      racket.blockLift = blk.liftDeg;
      racket.valid = !blk.hitNet;
      racket.passive = true;
    }

    const info = impactRacket(b.v, b.w, racket.normal, racket.vR, quality, racket.rubber || {});
    V3.copy(b.p, contact);
    V3.addScaled(b.p, b.p, racket.normal, PH.R * 1.05);
    pad.swing = 1;
    if (isServeStroke) { this.serveBounces = 0; this.rallyBounces.length = 0; }
    else this.isServeBall = false;
    this.applyHit(1, racket, contact, quality, info);
    if (this.state === GS.SERVE_TOSS) this.setState(GS.RALLY);
  }

  tryAiHit() {
    if (this.training) return;           // the feeder never returns the ball
    const b = this.ball, pad = this.aiPaddle, ai = this.ai;
    if (!b.live || b.lastHitBy === -1) return;
    if (!ai.plan) return;
    // the bot only swings at the moment it committed to during the
    // backswing — that is what makes the shot readable in advance
    if (!ai.readyToStrike(this.time) && V3.dist(b.p, ai.pos) > 0.22) return;
    const reach = V3.dist(b.p, ai.pos);
    if (b.p.z > ai.pos.z + 0.08) return;
    if (reach > 0.42) return;

    // legality: AI must let the ball bounce on its own side first
    if (!this.isServeBall && !this.rallyBounces.some((s) => s < 0) && b.p.z > -PH.T_HALF_LEN) return;

    const racket = ai.swing(this);
    if (!racket) { return; }
    const contact = V3.clone(b.p);
    const info = impactRacket(b.v, b.w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
    V3.copy(pad.normal, racket.normal);
    V3.copy(pad.pos, b.p);
    if (this.isServeBall) { this.serveBounces = 0; this.rallyBounces.length = 0; this.isServeBall = false; }
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
    this.padYaw = 0; this.padRoll = 0;
    /* 0.40 s, not 0.55: the window has to be over before a serve can possibly
     * be struck, or the bat is still travelling when the ball is hit. Measured
     * in the headless matches at 0.55 s: the closest the bat got to the centre
     * before the strike was 0.081-0.173 m on 14 of 49 serves. */
    this.recenterT = RECENTER_S;         // no footwork assist while re-centring
    this.tossQueued = false;
    this.swipe.cancel();
    if (this._paddlePred) this._paddlePred.reach = null;
    if (this._strikePred) this._strikePred.reach = null;
    if (this._volleyPred) this._volleyPred.reach = null;
    const broken = ![pad.pos.x, pad.pos.y, pad.pos.z].every(Number.isFinite);
    if (hard || broken) {
      V3.set(pad.pos, 0, PH.TABLE_Y + 0.25, 1.44);
      V3.copy(pad.prevPos, pad.pos);
      V3.copy(pad.prev, pad.pos);
      V3.zero(pad.vel);
    }
    V3.set(pad.normal, 0, -0.05, -1); V3.norm(pad.normal, pad.normal);
    pad.swing = 0;
    this._ptTarget = { tx: 0, ty: PH.TABLE_Y + 0.25, tz: 1.44 };
  }

  updatePlayerPaddle(dt) {
    const pad = this.player;
    V3.copy(pad.prev, pad.pos);
    pad.prevPos = pad.prevPos || V3.clone(pad.pos);
    V3.copy(pad.prevPos, pad.pos);
    if (this.recenterT > 0) {
      this.recenterT = Math.max(0, this.recenterT - dt);
      /* release a serve the player asked for during the reset */
      if (this.recenterT === 0 && this.tossQueued) {
        this.tossQueued = false;
        if (this.state === GS.SERVE_READY && this.server === 1) this.startToss();
      }
    }

    let pt = this.pointer || { x: 0.5, y: 0.55 };
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      pt = { x: 0.5, y: 0.55 };
      this.pointer = pt;                 // self-heal: never stay broken
    }
    if (!Number.isFinite(this.stanceY)) this.stanceY = undefined;
    const sens = this.settings.sensitivity;
    // the depth of the stance is set when the hand lands, not by the swipe:
    // flicking the wrist upward must not lunge you over the table
    if (this.swipe.active && this.swipe.m.samples > 0) {
      if (this.stanceY === undefined) this.stanceY = this.swipe.m.sy;
    } else this.stanceY = pt.y;
    const depthY = this.stanceY !== undefined ? this.stanceY : pt.y;

    /* A ball that dies short is a real table-tennis problem, and it used to
     * be an impossible one: the bat's depth was hard-clamped at 1.18 m, so a
     * short serve simply could not be reached no matter what you did. Now a
     * predicted short ball grants the step-in depth. */
    let zNear = PADDLE_LIMITS.zNear;
    const A = this.settings.posAssist;
    const o = this._paddlePred || (this._paddlePred = {});
    const incoming = this.ball.live && this.ball.v.z > 0.4 && this.ball.lastHitBy === -1;
    if (incoming && this.frame % 4 === 0) {
      predict(V3.clone(this.ball.p), V3.clone(this.ball.v), V3.clone(this.ball.w),
        { dt: PHYS_DT, maxT: 1.6, stopZ: pad.pos.z, stopDir: 1, out: o });
      if (!o.reach && o.landed && o.landed.z > 0) {
        o.reach = { x: o.landed.x, y: PH.TABLE_Y + 0.22, z: clamp(o.landed.z + 0.25, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar), vx: 0, vy: 0, vz: 4 };
        o.reachT = Math.max(0.05, o.landed.t + 0.10);
      }
    }
    const shortBall = incoming && ((o.landed && o.landed.z > 0 && o.landed.z < 1.15) ||
      (o.reach && o.reach.z < PADDLE_LIMITS.zNear + 0.22) || this.ball.p.z < 1.15);
    if (shortBall) zNear = PADDLE_LIMITS.zStepIn;
    /* The step is visible: the body goes forward and down, the blade tips
       into the ball. Without this the bat simply appeared 16 cm closer. */
    pad.stepIn = expSmooth(pad.stepIn || 0, shortBall ? 1 : 0, 8, dt);

    const t = paddleTargetFromPointer(pt.x, pt.y, depthY, sens,
      this._ptTarget || (this._ptTarget = { tx: 0, ty: 0, tz: 0 }), { zNear });
    let tx = t.tx, ty = t.ty, tz = t.tz;

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
      tz = lerp(tz, 1.44, kHome);
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
      const k = 0.55 + 0.45 * A;
      tx = lerp(tx, this.ball.p.x, k);
      tz = lerp(tz, this.ball.p.z + 0.02, k);
      if (this.ball.v.y < 0) {          // meet the dropping ball
        ty = lerp(ty, this.ball.p.y, 0.30 * A);
      }
    }
    // positional assist: slide towards the predicted intercept
    if (A > 0.01 && incoming && this.recenterT <= 0) {
      if (o.reach) {
        // the closer the ball, the more the footwork assist commits
        const k = A * clamp(1.3 - o.reachT * 1.0, 0.30, 1);
        tx = lerp(tx, clamp(o.reach.x, -PADDLE_LIMITS.x, PADDLE_LIMITS.x), k);
        ty = lerp(ty, clamp(o.reach.y, PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi), k * 0.95);
        if (o.reach.z < tz) tz = Math.max(zNear, o.reach.z - 0.02);
      }
    }
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

    // re-centring after a point is a visible glide, not a teleport
    /* 20, not 13: the glide has to be over before a quick player can strike the
     * serve, or "the bat returns to the centre" is only true for people who
     * wait. Still visibly a glide (0.2-0.3 s), not a teleport. */
    const rate = this.recenterT > 0 ? 20 : 26;
    pad.pos.x = expSmooth(pad.pos.x, tx, rate, dt);
    pad.pos.y = expSmooth(pad.pos.y, ty, rate, dt);
    pad.pos.z = expSmooth(pad.pos.z, tz, rate * 0.7, dt);
    V3.sub(pad.vel, pad.pos, pad.prevPos);
    V3.mul(pad.vel, pad.vel, 1 / Math.max(dt, 1e-4));

    /* ---- the bat turns into the step ------------------------------- *
     * Move right and the face opens to the right; move left and it opens
     * to the left, with the wrist banking the way it does when you actually
     * cover ground. This is what makes the bat read as held by a body
     * instead of sliding around on a rail — and because the same yaw is fed
     * into the stroke at contact, the face you SEE is the face that hits. */
    const lat = clamp(pad.vel.x, -7, 7);
    this.padYaw = expSmooth(this.padYaw || 0, clamp(lat * 0.062, -0.46, 0.46), 11, dt);
    const handed = this.settings.hand === 'right' ? 1 : -1;
    this.padRoll = expSmooth(this.padRoll || 0, clamp(-lat * 0.040, -0.30, 0.30) * handed, 9, dt);
    pad.yaw = this.padYaw; pad.roll = this.padRoll;

    // orientation follows the live gesture so you SEE the face angle
    const sw = this.swipe;
    const m = sw.active && sw.m.samples > 1 ? sw.m : sw.lastReleased;
    let want = this._wantN || (this._wantN = V3.new(0, -0.05, -1));
    V3.set(want, 0, -0.05, -1);
    if (m) {
      const ctx = {
        side: 1, isServe: this.isServeBall, ball: { y: pad.pos.y, z: pad.pos.z },
        ballSpin: this.ball.w, ballSpeed: V3.len(this.ball.v), moveYaw: this.padYaw,
      };
      const st = deriveStroke(m, ctx);
      V3.copy(want, st.normal);
      this.liveStroke = st;
    } else this.liveStroke = null;
    // apply the step yaw to the resting face as well
    const cy = Math.cos(this.padYaw), sy = Math.sin(this.padYaw);
    const wx = want.x * cy + want.z * sy, wz = -want.x * sy + want.z * cy;
    want.x = wx; want.z = wz;
    V3.norm(want, want);
    pad.normal.x = expSmooth(pad.normal.x, want.x, 18, dt);
    pad.normal.y = expSmooth(pad.normal.y, want.y, 18, dt);
    pad.normal.z = expSmooth(pad.normal.z, want.z, 18, dt);
    V3.norm(pad.normal, pad.normal);
    pad.swing = Math.max(0, pad.swing - dt * 4.5);
    pad.hitRadius = lerp(0.080, 0.165, A) * (this.state === GS.SERVE_TOSS ? 1.5 : 1)
      * (zNear < PADDLE_LIMITS.zNear ? 1.12 : 1);
  }

  /**
   * The single most important piece of coaching in the whole game: WHEN do
   * I swipe. We predict the intercept, then expose a 0..1 "readiness" the
   * HUD renders as a ring that closes on the ball.
   */
  updateStrikeWindow(dt) {
    const w = this._strike || (this._strike = { on: false, t: 9, k: 0, x: 0, y: 0, z: 0, ready: 0, kind: '' });
    const b = this.ball;
    w.on = false;
    if (this.state === GS.SERVE_READY && this.server === 1) {
      w.on = true; w.kind = 'serve'; w.t = 0; w.ready = 1;
      w.x = this.player.pos.x; w.y = this.player.pos.y; w.z = this.player.pos.z;
    } else if (this.state === GS.SERVE_TOSS && this.server === 1 && b.lastHitBy === 0) {
      // contact happens on the way down, a little above the table
      const dy = b.p.y - (PH.TABLE_Y + 0.14);
      w.on = true; w.kind = 'serve'; w.x = b.p.x; w.y = b.p.y; w.z = b.p.z;
      w.t = b.v.y > 0 ? 0.6 : clamp(dy / 2.2, 0, 0.6);
      w.ready = b.v.y < 0 ? 1 : 0.35;
    } else if (this.state === GS.RALLY && b.live && b.lastHitBy === -1 && b.v.z > 0.2) {
      const o = this._strikePred || (this._strikePred = {});
      if (this.frame % 3 === 0) {
        predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
          { dt: 1 / 200, maxT: 1.8, stopZ: this.player.pos.z, stopDir: 1, stopAtPlane: true, out: o });
      }
      if (o.reach) {
        w.on = true; w.kind = 'rally';
        w.x = o.reach.x; w.y = o.reach.y; w.z = o.reach.z !== undefined ? o.reach.z : this.player.pos.z;
        w.t = o.reachT;
        // ready ramps up over the last ~0.32 s: swipe inside it and the
        // gesture lands on the ball instead of in front of it
        w.ready = clamp(1 - (o.reachT - 0.10) / 0.34, 0, 1);
      }
    }
    w.k = expSmooth(w.k === undefined ? 0 : w.k, w.on ? 1 : 0, 14, dt);
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

  /** Switch between the four authored rigs. Distance and angle belong to
   *  the rig (57_camera.js), not to the player: there is nothing left to
   *  fiddle with, so the table is square to the frame every single time. */
  setCameraPreset(mode) {
    const P = CAMERA_PRESETS[mode];
    if (!P) return;
    if (this.settings.camera === mode) return;
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
  }

  updateCamera(dt) {
    const aspect = this.R.aspect();
    const rig = cameraRigFor(this.settings.camera, this.ball.p, aspect, this.camRig);
    V3.set(this.camPosT, rig.eye.x, rig.eye.y, rig.eye.z);
    V3.set(this.camLookT, rig.look.x, rig.look.y, rig.look.z);
    this.fovT = rig.fov;
    this.applyCamera(dt);

    /* The same rig, without shake, as matrices: two things need to know
     * exactly what is on screen — the HUD text band (it must stop above the
     * table) and the bat clamp (it must never be pushed out of frame). */
    /* From the smoothed camera, not from the target rig: camVP is the contract
     * for "what is on screen right now" (the band, the bat clamp, the strike
     * ring), and applyCamera glides toward the rig over ~0.5 s, so building it
     * from the destination made the clamp correct for a frame that had not
     * happened yet. Shake is still excluded, as the field's comment promises. */
    const lrig = this._liveRig || (this._liveRig = { eye: V3.new(), look: V3.new(), fov: 40 });
    V3.copy(lrig.eye, this.camPos);
    V3.copy(lrig.look, this.camLook);
    lrig.fov = this.fov;
    this.camVP = rigViewProj(lrig, aspect, this._rigBuf);
    this.camVPReady = true;
    const farL = projectPoint(this.camVP, this._bandA || (this._bandA = { x: -PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN }), this._bp1 || (this._bp1 = {}));
    const farR = projectPoint(this.camVP, this._bandB || (this._bandB = { x: PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN }), this._bp2 || (this._bp2 = {}));
    const netT = projectPoint(this.camVP, this._bandC || (this._bandC = { x: 0, y: PH.NET_TOP, z: 0 }), this._bp3 || (this._bp3 = {}));
    const band = clamp(Math.min(farL.y, farR.y, netT.y) - 0.015, 0.16, 0.55);
    if (Math.abs(band - this.hudBandY) > 0.002) {
      this.hudBandY = band;
      /* Unitless on purpose: the stylesheet computes
       * calc((1 - var(--band-y)) * 100%), which needs a number, not a length. */
      const css = band.toFixed(4);
      if (css !== this._bandCss) {
        this._bandCss = css;
        if (typeof document !== 'undefined' && document.documentElement)
          document.documentElement.style.setProperty('--band-y', css);
      }
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

    // shake
    this.shake = Math.max(0, this.shake - dt * 3.4);
    const s = this.shake * this.shake * 0.055;
    const t = this.time * 46;
    const ox = (noise1(t) - 0.5) * s, oy = (noise1(t + 17.3) - 0.5) * s, oz = (noise1(t + 41.7) - 0.5) * s;
    const eye = V3.new(this.camPos.x + ox, this.camPos.y + oy, this.camPos.z + oz);
    const look = V3.new(this.camLook.x + ox * 0.5, this.camLook.y + oy * 0.5, this.camLook.z + oz * 0.5);
    this.R.setCamera(eye, look, { x: 0, y: 1, z: 0 }, this.fov, 0.05, 60);
    this.R.setLightFrustum(V3.new(0, PH.TABLE_Y, 0), 6.0, 2.35, 0.5, 14);
  }

  /** A replay is shot, not spectated: the camera drifts in from wide and
   *  swings over the ball for the contact, so the stroke reads like a
   *  photograph instead of a video of a game. */
  updateCameraReplay(dtReal) {
    const rp = this.replayer, b = this.ball.p;
    const prog = rp.moment ? clamp(rp.i / Math.max(1, rp.lastFrame), 0, 1) : 0;
    const t = clamp((prog - 0.42) / 0.5, 0, 1);
    const e = t * t * (3 - 2 * t);                     // smoothstep
    const wx = clamp(b.x * 0.35, -1.4, 1.4), wz = clamp(b.z * 0.25 + 3.35, 2.4, 4.0);
    const ox = clamp(b.x * 0.75, -1.5, 1.5), oz = clamp(b.z + 1.35, 0.55, 3.1);
    V3.set(this.camPosT, lerp(wx, ox, e), lerp(2.02, 1.34, e) + Math.sin(this.time * 0.7) * 0.02, lerp(wz, oz, e));
    V3.set(this.camLookT, b.x * 0.9, b.y * 0.9 + 0.06, b.z * 0.9);
    this.fovT = lerp(41, 34, e);
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
      if (this._lastPointSwipe) {
        this._lastPointSwipe.samples.push({ x: curX, y: curY, t: this.time });
      }

      if (progress >= 1) {
        this.swipe.up(g.x1, g.y1, this.time);
        if (this._lastPointSwipe) {
          this._lastPointSwipe.endT = this.time;
          this._lastPointSwipe.ex = g.x1;
          this._lastPointSwipe.ey = g.y1;
          this._lastPointSwipe.dist = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
        }
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
    this._lastPointSwipe = {
      startT: this.time, sx: x0, sy: y0,
      samples: [{ x: x0, y: y0, t: this.time }],
      stroke: { name: 'ТОПСПИН', short: 'ТОП', col: '#4ee39a' }
    };
    this._demoGesture = {
      x0, y0, x1, y1,
      t: 0,
      dur
    };
  }

  /* ------------------------------ update --------------------------- */
  update(dtReal) {
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

    // state machine
    switch (this.state) {
      case GS.SERVE_READY:
        if (this.server === -1) {
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
            PH.TABLE_Y + 0.14, clamp(this.player.pos.z - 0.04, PH.T_HALF_LEN + 0.04, 2.0));
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
        if (this.server === -1 && this.ball.lastHitBy === 0 && this.stateT > 0.10 &&
          ((this.ball.v.y < 0 && this.ball.p.y <= PH.TABLE_Y + AI_SERVE_CONTACT_Y) ||
            this.time > this.aiSwingAt + 0.6)) {
          let racket = this.ai.serve(this);
          // the opponent does not get to donate points either — but a level
          // whose skill is already 1.0 has been solved at full assist, and
          // re-solving the same problem is pure frame time
          if (racket.valid === false && clamp(this.ai.L.skill, 0, 1) < 0.999) {
            racket = refineRacket(this.ball.p, this.ball.v, this.ball.w, racket, 1, racket.quality);
          }
          const contact = V3.clone(this.ball.p);
          const info = impactRacket(this.ball.v, this.ball.w, racket.normal, racket.vR, racket.quality, racket.rubber || {});
          V3.copy(this.aiPaddle.pos, this.ball.p);
          V3.copy(this.aiPaddle.normal, racket.normal);
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
    // physics substeps
    if (this.ball.live) {
      this._acc += dt;
      let guard = 0;
      while (this._acc >= PHYS_DT && guard++ < 400) {
        this.stepPhysics(PHYS_DT);
        this._acc -= PHYS_DT;
        if (!this.ball.live) break;
      }
      // trail history
      const h = this.ball.hist;
      h.push(this.ball.p.x, this.ball.p.y, this.ball.p.z);
      if (h.length > 96 * 3) h.splice(0, 3);
    } else this._acc = 0;

    this.updatePlayerPaddle(dtReal);
    this.updateStrikeWindow(dtReal);
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
    if (this.profile) {
      this.profile.data.stats.minutes += dtReal / 60;
      this.profile.maybeSave(dtReal);
    }
    this.updateCamera(dtReal);
    this.keepPaddleOnScreen();

    // post-processing reacts to the action
    const P = this.R.post;
    const sp = clamp(V3.len(this.ball.v) / 30, 0, 1);
    P.radial = expSmooth(P.radial, this.ball.live ? sp * sp * 0.85 : 0, 5, dtReal);
    P.flash = expSmooth(P.flash, this.hitFlash * 0.05, 10, dtReal);
    P.sat = expSmooth(P.sat, 1.05 + (1 - this.timeScale) * 0.25, 4, dtReal);
    P.ca = expSmooth(P.ca, 0.55 + sp * 0.75, 4, dtReal);
    this.audio.setCrowd(clamp(this.rally / 18, 0, 1) * 0.6 + (this.state === GS.POINT ? 0.4 : 0));

    // network: sync state (host) or input (guest)
    if (this.network.isInMatch) {
      if (this.network.isHost) this.network.sendGameState();
      else this.network.sendInput();
    }
    // career: net-safe perk lifts the ball over the tape
    if (this._careerNetSafe && this.ball.live && this.ball.lastHitBy === 1) {
      const nearNet = Math.abs(this.ball.p.z) < 0.15;
      if (nearNet && this.ball.p.y < PH.NET_TOP + PH.R * 2 && this.ball.v.z < 0) {
        this.ball.v.y += 0.8;
      }
    }

    // fps
    this._fpsN++; this._fpsT += dtReal;
    if (this._fpsT > 0.5) { this.fps = this._fpsN / this._fpsT; this._fpsT = 0; this._fpsN = 0; }
  }

  /* ------------------------------ render --------------------------- */
  buildTrail() {
    const h = this.ball.hist, R = this.R, m = this.scene.mesh.trail;
    const n = h.length / 3;
    if (n < 3 || !this.settings.showTrail) { m.count = 0; return; }
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

    /* player paddle (hidden per user request: "ракетку скрой") */
    if (this.settings.showPlayerPaddle) {
      const pad = this.player;
      const PM = this.paddleMats(S) || ma;
      const pq = Q.lookRotation(Q.new(), pad.normal, { x: 0, y: 1, z: 0 });
      /* pad.roll is the lean the bat picks up while you move it sideways: the
         blade visibly turns into the direction of travel instead of staying
         square to the camera. */
      const roll = Q.setAxisAngle(Q.new(), 0, 0, 1,
        (this.settings.hand === 'right' ? -0.42 : 0.42) + pad.swing * 0.3 + (pad.roll || 0));
      Q.mul(pq, pq, roll);
      /* stepping in to a short ball tips the blade forward over the table */
      if (pad.stepIn > 0.01) {
        const lunge = Q.setAxisAngle(Q.new(), 1, 0, 0, -0.20 * pad.stepIn);
        Q.mul(pq, pq, lunge);
      }
      M4.compose(tmp.m, pad.pos, pq, V3.set(tmp.scl, 1, 1, 1));
      d(me.blade, tmp.m, PM.wood);
      if (!shadowPass) {
        M4.compose(tmp.m2, V3.addScaled(V3.new(), pad.pos, pad.normal, 0.0085), pq, V3.set(tmp.scl, 1, 1, 1));
        R.draw(me.rubber, tmp.m2, PM.black);
        M4.compose(tmp.m2, V3.addScaled(V3.new(), pad.pos, pad.normal, -0.0085), pq, V3.set(tmp.scl, 1, 1, 1));
        R.draw(me.rubber, tmp.m2, PM.red);
      }
      // handle
      {
        const off = V3.new(0, -0.125, 0);
        const wo = V3.new();
        M4.transformDir(wo, tmp.m, off);
        M4.compose(tmp.m2, V3.add(V3.new(), pad.pos, wo), pq, V3.set(tmp.scl, 1, 1, 1));
        d(me.handle, tmp.m2, PM.grip);
      }
    }

    /* the opponent: paddle, hand, forearm and sleeve, all solved from
       the paddle's own position and normal (see 56_rig.js) */
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
    if (shadowPass) {
      const aqS = Q.lookRotation(Q.new(), aiNorm, { x: 0, y: 1, z: 0 });
      M4.compose(tmp.m, ap.pos, aqS, V3.set(tmp.scl, 1, 1, 1));
      R.drawShadow(me.blade, tmp.m, null, 0);
    } else {
      this.rig.draw(R, S, {
        pos: ap.pos, normal: aiNorm, hand: this.settings.hand === 'right' ? 'left' : 'right',
        swing: -this.ai.anim.swing, windup: wd, roll: (this.ai.anim.lean || 0) * 0.22,
        mats: this.paddleMats(S, this.aiEquip),
      });
    }

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
    if (this.settings.showPlayerPaddle) {
      const pp = this.player.pos;
      if (onTable(pp.x, pp.z)) S.blob(R, pp.x, pp.y, pp.z, TY, 0.115, 0.42, 1.25);
      else S.blob(R, pp.x, pp.y, pp.z, 0, 0.16, 0.26, 1.25);
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
        emissive: [col[0] * k, col[1] * k, col[2] * k], opacity: 1,
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
      const pulse = 0.055 + Math.sin(this.time * 9) * 0.008;
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
    R.present(this.time);
  }
}

function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
