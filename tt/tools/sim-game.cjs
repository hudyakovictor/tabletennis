/* =====================================================================
 *  Headless gameplay harness.
 *  Loads the real gameplay modules into one VM context and builds a Game
 *  whose rendering / audio / persistence are inert.  Everything that
 *  decides whether a ball is hit, whether a serve is legal and where the
 *  bat can go is the production code, unmodified.
 * ===================================================================== */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const SRC = f => path.join(root, 'tt/src', f);

function noop() {}
function anyObject() {
  const make = () => new Proxy(function () {}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive || k === 'toString' || k === 'valueOf') return () => 0;
      const v = make();
      t[k] = v;
      return v;
    },
    set(t, k, v) { t[k] = v; return true; },
    apply() { return undefined; },
    construct() { return make(); },
  });
  return make();
}

function buildContext() {
  const saved = new Map();
  const win = {
    devicePixelRatio: 1, innerWidth: 1280, innerHeight: 760,
    addEventListener: noop, removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
  };
  const doc = {
    body: { classList: { toggle: noop, add: noop, remove: noop } },
    documentElement: { style: { setProperty: noop } },
    addEventListener: noop, removeEventListener: noop, hidden: false,
    getElementById: () => ({ classList: { contains: () => false, toggle: noop, add: noop, remove: noop }, style: {}, appendChild: noop, addEventListener: noop }),
    querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, addEventListener: noop }),
  };
  const ctx = {
    console, setInterval, clearInterval, setTimeout, clearTimeout,
    performance: { now: () => Date.now() },
    navigator: { userAgent: 'node', maxTouchPoints: 0, platform: 'linux' },
    window: win, document: doc, self: win,
    URLSearchParams,
    localStorage: {
      getItem: k => (saved.has(k) ? saved.get(k) : null),
      setItem: (k, v) => saved.set(k, String(v)),
      removeItem: k => saved.delete(k),
    },
    Math, JSON, Date, Number, String, Object, Array, Map, Set, Float32Array,
    Uint16Array, Uint32Array, Int32Array, Uint8Array, Int8Array, Int16Array,
    Float64Array, isFinite, isNaN, parseInt, parseFloat,
    __saved: saved,
  };
  ctx.globalThis = ctx;
  ctx.window.document = doc;
  return ctx;
}

const STUBS = `
class Renderer {
  constructor(){ this.post={radial:0,flash:0,sat:1,ca:0,bloom:0,grain:0}; this.viewProj=M4.create(); this.drawCalls=0; this.camPos=V3.new(0,1.7,2.4); this.ready=true; }
  aspect(){ return 16/9; }
  resize(){}
  setCamera(){}
  setLightFrustum(){}
  uploadDyn(){}
}
class Scene { constructor(){ this.mesh={}; this.mat={}; } }
class HitFeedbackSystem { constructor(){} execute(){} }
class Platform { constructor(){} }
class Analytics { constructor(){ this.sessionSec=0; } send(){} }
class Profile {
  constructor(){ this.data={ settings:null, stats:{minutes:0}, equip:{ blade:'b_base', fh:'r_base', bh:'r_base' } }; }
  save(){} maybeSave(){} onMatchEnd(){ return null; } taskProgress(){}
}
class Shop { constructor(){} }
class MusicSystem { constructor(){ this._initialized=false; } init(){ return Promise.resolve(); } update(){} }
class EmotionalSystem { constructor(){} update(){} }
class NetworkManager { constructor(){ this.isInMatch=false; this.isHost=true; this.opponentRacket={pos:V3.new(),normal:V3.new()}; } _send(){} sendGameState(){} sendInput(){} }
class Career { constructor(g){ this.g=g; this.active=false; } save(){} load(){ return false; } start(){} stop(){} onMatchEnd(){} }
`;

function loadGameModules() {
  const ctx = buildContext();
  vm.createContext(ctx);
  const files = ['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js',
    '40_swipe.js', '42_shot_diagnostics.js', '50_audio.js', '55_ai.js', '56_rig.js',
    '57_camera.js', '58_coach.js', '59_replay.js', '84_racket.js', '70_game.js'];
  const source = files.map(f => fs.readFileSync(SRC(f), 'utf8')).join('\n');
  vm.runInContext(source + '\n;globalThis.__api = { Game, GS, PH, V3, Q, M4, MATCH_RULES, ' +
    'SwipeTracker, isRealStroke, deriveStroke, classifyStroke, refineRacket, predict, integrateBall, ' +
    'bounceTable, bounceNet, clipTape, impactRacket, impactSphere, playerInCaptureRange, ' +
    'playerCaptureLimits, pressHitZone, ballCaptureTarget, measureCaptureAllowance, strikeCueModel, ' +
    'solveLaunch, solveServeStroke, strokeFrame, resolvedRacketFrame, anglesFromNormal, shotReport, ' +
    'paddleTargetFromPointer, PADDLE_LIMITS, clampPaddleToFrustum, rigViewProj, paddleFaceAngles, ' +
    'faceFromWrist, playerWristPose, paddleForehand, keepPaddleAboveTable, paddleBottomExtent, stepPaddleAngle, ' +
    'PaddleStrokeMotion, Equipment, ShotJournal, OpponentAI, STROKES, ARCH, SHOT_OUTCOMES, ' +
    'shotFeedbackView, shotHudView };\n', ctx);
  return ctx;
}

function makeGame(opts = {}) {
  const ctx = loadGameModules();
  vm.runInContext(STUBS, ctx);
  const api = ctx.__api;
  const ui = anyObject();
  const g = new api.Game({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 760 }),
    addEventListener: noop, style: {}, clientWidth: 1280, clientHeight: 760 },
  ui);
  // The physics loop must not depend on rendering, but the camera clamp is a
  // real gameplay constraint: keep it available with a fixed rig.
  g.camVPReady = true;
  g.camVP = ctx.rigViewProj({ eye: { x: 0, y: 2.25, z: 3.2 }, look: { x: 0, y: 0.76, z: 0 }, fov: 43, shiftY: 0 }, 16 / 9, { vp: api.M4.create(), proj: api.M4.create(), view: api.M4.create() });
  g.settings.anticipationHint = false;
  g.settings.followThrough = false;
  g.settings.showSpinIndicator = false;
  g.settings.momentumBar = false;
  g.settings.slowmoOnBigShots = false;
  g.settings.adaptive = false;
  if (opts.settings) Object.assign(g.settings, opts.settings);
  if (opts.noAi) g.ai = { think: noop, reset: noop, setLevel: noop, onPointEnd: noop,
    setHandicap: noop, setPressure: noop, readyToStrike: () => true, swing: () => null,
    serve: () => null, plan: null, pos: api.V3.new(0, 1, -1.45), L: { move: 3, skill: .5 } };
  return { g, ctx, api };
}

module.exports = { makeGame, loadGameModules, root };
