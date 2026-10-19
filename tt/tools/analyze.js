#!/usr/bin/env node
/* =====================================================================
 *  analyze.js — headless measurement bench for TOPSPIN ARENA.
 *
 *  Loads the real source modules (no browser, no puppeteer) into one
 *  shared scope and runs a fixed battery of suites. Every number quoted
 *  in АНАЛИЗ-1000.md comes from here, so a claim can always be re-run:
 *
 *      node tt/tools/analyze.js            # full battery, report to stdout
 *      node tt/tools/analyze.js --suite serve --n 400
 *      node tt/tools/analyze.js --json /tmp/a.json
 *
 *  The point of the bench is that gameplay complaints ("the racket
 *  leaves the screen", "the bot serves into the net and I cannot reach
 *  it") become measurable quantities with a pass/fail line.
 * ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
/* Everything build.py ships, in the same order, minus 90_boot.js (the smoke
   suite performs the boot sequence itself so it can drive the frames). */
const MODULES = [
  '10_math.js', '12_match_rules.js', '20_gl.js', '25_career.js', '27_network.js', '30_physics.js',
  '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js', '50_audio.js', '55_ai.js', '56_rig.js', '57_camera.js',
  '58_coach.js', '59_replay.js', '60_scene.js', '65_train.js', '84_racket.js',
  '86_meta.js', '70_game.js', '80_ui.js',
];

/* ------------------------------------------------------------------ *
 *  Sandbox: the modules only touch the DOM inside constructors /
 *  methods, so a minimal stub is enough to eval them.
 * ------------------------------------------------------------------ */
const noop = () => {};
const styleStub = () => ({ setProperty: noop, removeProperty: noop, cssText: '' });
const CTX2D = ['clearRect', 'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo',
  'arc', 'ellipse', 'rect', 'fill', 'stroke', 'clip', 'fillText', 'strokeText', 'translate',
  'rotate', 'scale', 'setTransform', 'drawImage', 'putImageData', 'quadraticCurveTo',
  'bezierCurveTo', 'arcTo', 'setLineDash', 'fillRect', 'strokeRect'];
const ctx2dStub = (w, h) => {
  const c = { canvas: { width: w, height: h }, globalAlpha: 1, lineWidth: 1, font: '',
    fillStyle: '', strokeStyle: '', textAlign: '', textBaseline: '', filter: 'none',
    shadowBlur: 0, shadowColor: '', globalCompositeOperation: 'source-over',
    measureText: (t) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null, getImageData: () => ({ data: new Uint8Array(4) }) };
  for (const m of CTX2D) c[m] = noop;
  return c;
};
const elStub = (w = 0, h = 0) => ({
  style: styleStub(), classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  dataset: {}, children: [], parentNode: null,
  addEventListener: noop, removeEventListener: noop, appendChild: noop, removeChild: noop,
  remove: noop, focus: noop, blur: noop, click: noop, setAttribute: noop, getAttribute: () => null,
  querySelector: () => elStub(), querySelectorAll: () => [], closest: () => null,
  textContent: '', innerHTML: '', value: '', checked: false, disabled: false,
  width: w, height: h, clientWidth: w || 1280, clientHeight: h || 200,
  offsetWidth: w || 1280, offsetHeight: h || 200, scrollHeight: h || 200,
  getContext: (k) => (k === '2d' ? ctx2dStub(w || 1280, h || 720) : null),
  getBoundingClientRect: () => ({ left: 0, top: 0, right: w || 1280, bottom: h || 720, width: w || 1280, height: h || 720 }),
});
/* A WebGL2 context that behaves: every constant is a distinct integer, every
   create* returns an opaque handle, every *Parameter that gates a code path
   answers the way a healthy driver does. The smoke suite never reads a pixel
   back — it only needs the renderer not to throw so the GAME logic (update,
   physics, HUD, camera) can be driven end to end without a browser. */
function makeGL(canvas) {
  const consts = {};
  let seq = 0x1000;
  const obj = {};
  const answer = (k) => {
    switch (k) {
      case 'getError': return 0;
      case 'isContextLost': return false;
      case 'getShaderParameter': case 'getProgramParameter': return true;
      case 'getShaderInfoLog': case 'getProgramInfoLog': return '';
      case 'getExtension': return null;
      case 'getSupportedExtensions': return [];
      case 'getParameter': return 4096;
      case 'getAttribLocation': return 0;
      case 'getUniformLocation': return { __u: k };
      case 'getActiveAttrib': case 'getActiveUniform': return { name: 'a', size: 1, type: 1 };
      case 'checkFramebufferStatus': return 0x8cd5;
      case 'createShader': case 'createProgram': case 'createBuffer': case 'createTexture':
      case 'createFramebuffer': case 'createRenderbuffer': case 'createVertexArray':
      case 'fenceSync': case 'createQuery': return { __o: k };
      default: return undefined;
    }
  };
  return new Proxy(obj, {
    get(t, k) {
      if (k === 'canvas') return canvas;
      if (k === 'drawingBufferWidth') return canvas.width;
      if (k === 'drawingBufferHeight') return canvas.height;
      if (typeof k === 'symbol') return undefined;
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) { if (!(k in consts)) consts[k] = ++seq; return consts[k]; }
      if (k in t) return t[k];
      const r = answer(k);
      return (t[k] = (typeof r === 'function' ? r : () => r));
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas(w, h) {
  const c = elStub(w, h);
  c.getContext = (k) => (k === '2d' ? ctx2dStub(w, h) : makeGL(c));
  return c;
}

/* deterministic RNG so two runs of the bench agree digit for digit — it
   replaces Math.random INSIDE the modules too, so the AI's own rolls are
   reproducible as well */
let _seed = 20261012;
function srand() {                      // xorshift32
  _seed ^= _seed << 13; _seed >>>= 0;
  _seed ^= _seed >> 17;
  _seed ^= _seed << 5; _seed >>>= 0;
  return _seed / 4294967296;
}
const SMath = {};
for (const k of Object.getOwnPropertyNames(Math)) { try { SMath[k] = Math[k]; } catch (e) { /* accessor */ } }
SMath.random = srand;

let simNow = 0;
const timers = [];
const _nodes = {};
const sandbox = {
  console,
  Math: SMath, JSON, Date, Number, String, Array, Object, Float32Array, Int32Array,
  Uint8Array, Uint16Array, Map, Set, Promise, Symbol, Error, TypeError,
  isNaN, isFinite, parseInt, parseFloat, Infinity, NaN, undefined,
  performance: { now: () => simNow },
  setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, at: simNow + (ms || 0) }); return id; },
  clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  setInterval: () => 0, clearInterval: noop,
  WebSocket: function StubWS() { this.readyState = 0; this.close = noop; this.send = noop; },
  document: {
    createElement: () => elStub(),
    /* cached: the HUD is stateful (classes, text), and a fresh stub per call
       would silently throw away everything ui.tick() does. */
    getElementById: (id) => (_nodes[id] || (_nodes[id] = elStub(1280, 720))),
    querySelector: (sel) => (_nodes[sel] || (_nodes[sel] = elStub(1280, 720))),
    querySelectorAll: () => [],
    addEventListener: noop, body: elStub(1280, 720), readyState: 'complete',
    documentElement: elStub(1280, 720),
  },
  localStorage: { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; },
    setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; }, clear() { this._m = {}; } },
  window: {
    addEventListener: noop, removeEventListener: noop, innerWidth: 1280, innerHeight: 720,
    devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener: noop, addListener: noop }),
    requestAnimationFrame: noop, cancelAnimationFrame: noop, focus: noop,
    localStorage: null, navigator: { userAgent: 'node' },
    AudioContext: null, webkitAudioContext: null,
    setTimeout: null, clearTimeout: null,
  },
  navigator: { userAgent: 'node', vibrate: null, maxTouchPoints: 0 },
  requestAnimationFrame: noop,
};
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.setTimeout = sandbox.setTimeout;
sandbox.window.clearTimeout = sandbox.clearTimeout;
sandbox.window.performance = sandbox.performance;
sandbox.globalThis = sandbox;
sandbox.__DBG = (...a) => { if (process.env.DBGSOLVE) console.log('   [solve]', ...a); };
sandbox.self = sandbox;
sandbox.srand = srand;
sandbox.rndSeed = (s) => { _seed = (s >>> 0) || 1; };
vm.createContext(sandbox);

/* The modules declare everything with const/class, which lives in the
   script's lexical scope rather than on the global object — so they are
   evaluated as ONE script that ends by publishing the names the bench
   needs. Same code, same order as build.py, no copy-paste. */
const EXPORTS = ['TAU', 'DEG', 'clamp', 'lerp', 'smoothstep', 'sign', 'rnd', 'rndSym', 'gauss', 'expSmooth',
  'V3', 'M4', 'Q', 'PH', 'aeroAccel', 'integrateBall', 'impactSphere', 'impactRacket', 'bounceTable',
  'bounceNet', 'clipTape', 'predict', 'solveLaunch', 'SPIN_CAP',
  'SwipeTracker', 'STROKES', 'ARCH', 'classifyStroke', 'deriveStroke', 'refineRacket', 'strokeFrame',
  'solveServeStroke', 'shotReport', 'anglesFromNormal', 'solveBlockNormal', 'strokeFrame', 'AI_LEVELS', 'AI_TACTICS', 'AI_BACKSWING', 'OpponentAI', 'makeRacket',
  'PaddleRig', 'CAMERA_PRESETS', 'CAMERA_ORDER', 'PADDLE_LIMITS', 'effectiveFov', 'rigViewProj',
  'projectPoint', 'rigMargin', 'fitRig', 'cameraRigFor', 'tableTopScreenY', 'paddleTargetFromPointer',
  'clampPaddleToFrustum', 'paddleVisibleOk', 'MomentRecorder', 'BLADES', 'RUBBERS', 'Equipment', 'GS',
  'PHYS_DT', 'Game', 'UI', 'ICON', 'Renderer', 'Scene', 'AudioEngine', 'Particles',
  'Platform', 'Analytics', 'Profile', 'Shop', 'MomentPlayer', 'MomentRecorder',
  'RallyRecorder', 'PointAnalyst', 'MatchDirector', 'Trainer', 'Career', 'NetworkManager', 'GS'];
let bundle = '';
for (const f of MODULES) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) { console.error('analyze.js: missing module ' + f); process.exit(2); }
  bundle += `\n/* ===== ${f} ===== */\n` + fs.readFileSync(p, 'utf8').replace(/^'use strict';\s*$/m, '');
}
/* typeof-guarded so a name that a module does not define (or defines later)
   cannot take the whole bench down with a ReferenceError. */
bundle += `\n;globalThis.__X = {${EXPORTS.map((k) => `${k}: typeof ${k} !== 'undefined' ? ${k} : undefined`).join(',')}};\n`;
try { vm.runInContext(bundle, sandbox, { filename: 'bundle.js' }); }
catch (e) { console.error('analyze.js: bundle failed to evaluate — ' + (e && e.stack || e)); process.exit(2); }

/* shorthand handles into the sandbox */
const X = sandbox.__X;
const { PH, V3, Q, M4, clamp, lerp } = X;
const { predict, impactRacket, integrateBall, bounceTable, aeroAccel, solveLaunch } = X;
const { deriveStroke, refineRacket, classifyStroke, ARCH, STROKES, SwipeTracker, anglesFromNormal,
  solveBlockNormal, strokeFrame } = X;
const { OpponentAI, AI_LEVELS, makeRacket } = X;
const { CAMERA_PRESETS, cameraRigFor, rigViewProj, projectPoint } = X;
const { paddleTargetFromPointer, PADDLE_LIMITS, paddleVisibleOk, clampPaddleToFrustum } = X;
const { Equipment } = X;
const DEG = Math.PI / 180;
/* experiment hook: MU=0.25 node analyze.js --suite rally */
if (process.env.MUT) PH.MU_TABLE = +process.env.MUT;
if (process.env.ET) PH.ET_TABLE = +process.env.ET;
const srnd = (a = 1, b) => (b === undefined ? srand() * a : a + srand() * (b - a));
const srndSym = (a) => (srand() * 2 - 1) * a;

/* ------------------------------------------------------------------ *
 *  tiny stats helpers
 * ------------------------------------------------------------------ */
function quant(a, q) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const i = clamp(Math.round(q * (s.length - 1)), 0, s.length - 1);
  return s[i];
}
function stat(a) {
  if (!a.length) return { n: 0, mean: NaN, med: NaN, p05: NaN, p95: NaN, min: NaN, max: NaN };
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return { n: a.length, mean, med: quant(a, 0.5), p05: quant(a, 0.05), p95: quant(a, 0.95),
    min: Math.min.apply(null, a), max: Math.max.apply(null, a) };
}
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '  — ');
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : ' — ');
const pc = (v) => (100 * v).toFixed(1) + '%';

const RESULTS = {};
let CASES = 0;                       // every discrete analysis case counts

/* ------------------------------------------------------------------ *
 *  SUITE 1 — physics invariants (ITTF drop test, energy, spin cap)
 * ------------------------------------------------------------------ */
function suitePhysics() {
  const out = { cases: 0 };

  /* ITTF T3: a ball dropped from 30.0 cm onto the table must rebound
   * 23..26 cm. The standard specifies a DEAD ball — no spin. Spinning the
   * dropped ball makes the table friction throw it sideways, the extra
   * horizontal speed costs drag on the way back up, and the apex comes out
   * ~1.5 cm lower, which is a property of the test rig, not of the table.
   * So the pass/fail judgement uses spin = 0 only; the spin rows are kept as
   * a separate reading because they show how much the bounce steals. */
  const drops = [], spinDrops = [];
  for (const h of [0.300, 0.305]) {
    for (const spin of [0, 200, -200]) {
      const p = V3.new(0, PH.TABLE_Y + h + PH.R, 0), v = V3.new(0, 0, 0), w = V3.new(spin, 0, 0);
      const dt = 1 / 6000; let t = 0;
      while (p.y - PH.R > PH.TABLE_Y && t < 2) { integrateBall(p, v, w, dt); t += dt; }
      bounceTable(p, v, w);
      let maxY = p.y;
      const drift = Math.hypot(v.x, v.z);
      while (v.y > 0) { integrateBall(p, v, w, dt); if (p.y > maxY) maxY = p.y; }
      const cm = (maxY - PH.R - PH.TABLE_Y) * 100;
      (spin === 0 ? drops : spinDrops).push(cm);
      out.cases++;
    }
  }
  out.ittfDrop = stat(drops);
  out.ittfSpinDrop = stat(spinDrops);
  out.ittfPass = drops.length > 0 && drops.every((d) => d >= 23 && d <= 26);

  // energy in flight must never grow; spin must decay, never explode
  let grow = 0, spinGrow = 0, nan = 0;
  for (let i = 0; i < 200; i++) {
    const v = V3.new(srndSym(8), srnd(-2, 8), srndSym(14));
    const w = V3.new(srndSym(900), srndSym(900), srndSym(900));
    const p = V3.new(srndSym(1), PH.TABLE_Y + srnd(0.1, 1.2), srndSym(2));
    const e0 = 0.5 * V3.len(v) ** 2 + PH.G * p.y, s0 = V3.len(w);
    const rep = {};
    predict(V3.clone(p), V3.clone(v), V3.clone(w), { dt: 1 / 400, maxT: 1.6, stopOnFirstBounce: true, out: rep });
    const e1 = 0.5 * V3.len(rep.endV) ** 2 + PH.G * rep.end.y, s1 = V3.len({ x: 0, y: 0, z: 0 });
    if (e1 > e0 * 1.0001) grow++;
    if (!Number.isFinite(rep.end.x) || !Number.isFinite(rep.endV.z)) nan++;
    void s0; void s1;
    out.cases++;
  }
  out.energyGrow = grow; out.nan = nan;

  // spin cap: no racket impact may leave the ball above the documented cap
  let overCap = 0, maxSpin = 0;
  for (let i = 0; i < 200; i++) {
    const v = V3.new(srndSym(6), srnd(-3, 3), srndSym(10));
    const w = V3.new(srndSym(1400), srndSym(1400), srndSym(1400));
    const n = V3.norm(V3.new(), V3.new(srndSym(1), srndSym(1), -1));
    const vR = V3.mul(V3.new(), V3.norm(V3.new(), V3.new(srndSym(1), srndSym(1), 1)), srnd(2, 19));
    impactRacket(v, w, n, vR, srnd(), {});
    const l = V3.len(w);
    if (l > 1080 + 1e-6) overCap++;
    if (l > maxSpin) maxSpin = l;
    out.cases++;
  }
  out.spinOverCap = overCap; out.maxSpinRad = maxSpin;

  // hostile inputs must not produce NaN anywhere in the impact chain
  let hostileBad = 0;
  const hostile = [Infinity, -Infinity, NaN, 1e9, -1e9, 1e-9];
  for (const h of hostile) {
    for (const kind of ['v', 'w', 'n', 'vR']) {
      const v = V3.new(0, 0, -6), w = V3.new(0, 0, 0), n = V3.new(0, 0, -1), vR = V3.new(0, 0, 6);
      if (kind === 'v') v.x = h; if (kind === 'w') w.y = h;
      if (kind === 'n') { n.x = h; V3.norm(n, n); } if (kind === 'vR') vR.z = h;
      try {
        impactRacket(v, w, n, vR, 0.8, {});
        if (![v.x, v.y, v.z, w.x, w.y, w.z].every(Number.isFinite)) hostileBad++;
      } catch (e) { hostileBad++; }
      out.cases++;
    }
  }
  out.hostileBad = hostileBad;
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 2 — the opponent's serve: legal? deep? fast? REACHABLE?
 * ------------------------------------------------------------------ */
/* The box the bat can occupy (57_camera.js is the single source of truth),
   inflated by the hit radius so "reachable" means "a legal swing can meet
   it", not "the centre of the ball crosses a plane". */
/** Reproduce the game's REAL serve toss, so the bench measures the shipped
 *  game instead of an invented contact point.
 *    AI     — 70_game.js:1354  v.y = 3.10 from TABLE_Y+0.17, struck 0.42 s later.
 *    player — 70_game.js:411   v.y = 2.45..2.65 from TABLE_Y+0.14, struck while
 *             FALLING (ITTF 2.06), i.e. the first sample with v.y < 0. */
function tossState(side, who) {
  const AI_CONTACT = 0.36;                    // 70_game.js AI_SERVE_CONTACT_Y
  const p = { x: side * (who === 'ai' ? 0.26 : -0.26) * 0 + side * 0.02,
    y: PH.TABLE_Y + (who === 'ai' ? 0.17 : 0.14), z: side * (PH.T_HALF_LEN + 0.22) };
  const v = { x: 0, y: who === 'ai' ? 3.1 : 2.55, z: 0 };
  const w = { x: 0, y: 0, z: 0 };
  const dt = 1 / 480;
  let t = 0;
  if (who === 'ai') {
    while (t < 1.6 && !(v.y < 0 && p.y <= PH.TABLE_Y + AI_CONTACT)) { integrateBall(p, v, w, dt); t += dt; }
    p.y = PH.TABLE_Y + AI_CONTACT;
  } else {
    while (t < 2.0 && !(v.y < 0 && p.y <= PH.TABLE_Y + 0.20)) { integrateBall(p, v, w, dt); t += dt; }
    p.y = PH.TABLE_Y + 0.20;
  }
  return { p: { x: p.x, y: p.y, z: p.z }, v: { x: v.x, y: v.y, z: v.z }, t };
}

const REACH_PAD = 0.13;

function serveReachability(ballP, ballV, ballW) {
  /** The receiver may only strike AFTER the ball has bounced on their own
   *  half, so the search runs past the second bounce — that is exactly the
   *  window a short serve denies you. */
  const p = V3.clone(ballP), v = V3.clone(ballV), w = V3.clone(ballW);
  const dt = 1 / 480;
  let t = 0, bounced = 0, b2 = null, best = null, b2speed = 0;
  const L = PADDLE_LIMITS;
  while (t < 3.2) {
    integrateBall(p, v, w, dt); t += dt;
    if (p.y - PH.R <= PH.TABLE_Y && v.y < 0 &&
      Math.abs(p.x) <= PH.T_HALF_WID + PH.R && Math.abs(p.z) <= PH.T_HALF_LEN + PH.R) {
      bounceTable(p, v, w); bounced++;
      if (bounced === 2) { b2 = { x: p.x, y: p.y, z: p.z, t }; b2speed = V3.len(v) * 3.6; }
    }
    if (p.y - PH.R <= 0.0) break;                       // floor: point over
    if (bounced >= 2) {
      const inX = Math.abs(p.x) <= L.x + REACH_PAD;
      const inZ = p.z >= L.zStepIn - REACH_PAD && p.z <= L.zFar + REACH_PAD;
      const inY = (p.y - PH.TABLE_Y) >= L.yLo - REACH_PAD && (p.y - PH.TABLE_Y) <= L.yHi + REACH_PAD;
      if (inX && inZ && inY) { best = { t, x: p.x, y: p.y, z: p.z }; break; }
      if (V3.len(v) < 0.22) break;                      // the ball died
    }
  }
  return { reachable: !!best, at: best, b2, bounces: bounced, b2speed,
    windowT: best ? best.t - (b2 ? b2.t : 0) : -1 };
}

function suiteServe(n) {
  const out = { cases: 0, perLevel: [], contact: null };
  const c0 = tossState(-1, 'ai');
  out.contact = { aboveTable: c0.p.y - PH.TABLE_Y, vy: c0.v.y, t: c0.t };
  for (const L of AI_LEVELS) {
    const ai = new OpponentAI(L.id);
    const speeds = [], b2z = [], b2sp = [], cross = [], legal = [], reach = [], solveMs = [], win = [];
    const spinX = [], spinY = [], spinZ = [], kick = [];
    const archSp = {};
    let netted = 0, ownFault = 0, invalid = 0, weak = 0;
    for (let i = 0; i < n; i++) {
      ai.onPointEnd(i % 2 ? 1 : -1);
      ai.setPressure(i % 7, i % 5, 11);
      const st = tossState(-1, 'ai');
      const bp = { x: st.p.x + srndSym(0.20), y: st.p.y, z: st.p.z + srndSym(0.04) };
      const bv = { x: st.v.x + srndSym(0.04), y: st.v.y, z: st.v.z + srndSym(0.04) };
      const bw = { x: 0, y: 0, z: 0 };
      const t0 = process.hrtime.bigint();
      let r = ai.serve({ ball: { p: bp, v: bv, w: bw }, time: 0 });
      if (r.valid === false) { invalid++; r = refineRacket(bp, bv, bw, r, 1, r.quality); }
      solveMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
      const v = V3.clone(bv), w = V3.clone(bw);
      impactRacket(v, w, r.normal, r.vR, r.quality, r.rubber || {});
      const rep = {};
      predict(V3.clone(bp), V3.clone(v), V3.clone(w), { dt: PH.SIM_DT, maxT: 2.6, out: rep });
      const okServe = !!rep.landed && Math.sign(rep.landed.z) === -1 && !!rep.b2 && Math.sign(rep.b2.z) === 1 && !rep.hitNet;
      legal.push(okServe ? 1 : 0);
      if (rep.hitNet) netted++;
      if (rep.landed && Math.sign(rep.landed.z) !== -1) ownFault++;
      const sp = V3.len(v) * 3.6;
      speeds.push(sp);
      const ak = (r.stroke && r.stroke.short) || '?';
      const ar = archSp[ak] || (archSp[ak] = { sp: [], sc: [], q: [], wz: [], wy: [] });
      ar.sp.push(sp); ar.sc.push(r.scale === undefined ? 1 : r.scale); ar.q.push(r.quality || 0);
      /* magnitude: the SIGN of w.z follows the direction the serve is aimed
         at, so a median over signed values cancels itself out and reads as
         "no spin" when every serve has some. */
      ar.wz.push(Math.abs(w.z) / 1080); ar.wy.push(Math.abs(w.y) / 1080);
      if (sp < 25) weak++;
      if (rep.b2) { b2z.push(rep.b2.z); b2sp.push(rep.b2.speed * 3.6); }
      // where does it cross the paddle plane, and can the player get there?
      // what spin the serve actually carries, and what the table does with it
      spinX.push(Math.abs(w.x) / 1080); spinY.push(Math.abs(w.y) / 1080); spinZ.push(Math.abs(w.z) / 1080);
      {
        const q = V3.clone(bp), u = V3.clone(v), ww = V3.clone(w);
        const dtt = 1 / 300; let tt = 0, bn = 0, xAt = 0, done = false;
        while (tt < 2.0 && !done) {
          integrateBall(q, u, ww, dtt); tt += dtt;
          if (q.y - PH.R <= PH.TABLE_Y && u.y < 0 && Math.abs(q.x) <= PH.T_HALF_WID + PH.R &&
            Math.abs(q.z) <= PH.T_HALF_LEN + PH.R) {
            bounceTable(q, u, ww); bn++;
            if (bn === 2) { xAt = q.x; done = true; }
          }
        }
        let lat = 0;
        if (done) { const t2 = tt; while (tt < t2 + 0.35) { integrateBall(q, u, ww, dtt); tt += dtt; } lat = q.x - xAt; }
        kick.push(lat * 100);
      }
      const rr = serveReachability(bp, v, w);
      reach.push(rr.reachable ? 1 : 0);
      if (rr.b2) { cross.push(rr.b2.z); b2sp.push(rr.b2speed); if (rr.windowT >= 0) win.push(rr.windowT); }
      out.cases++;
    }
    out.perLevel.push({
      level: L.name, n,
      byArch: Object.keys(archSp).sort().map((k) => ({
        arch: k, n: archSp[k].sp.length, share: archSp[k].sp.length / n,
        kmh: stat(archSp[k].sp), scale: stat(archSp[k].sc),
        wz: stat(archSp[k].wz), wy: stat(archSp[k].wy),
      })),
      legal: legal.reduce((a, b) => a + b, 0) / n,
      invalidFirstPass: invalid / n,
      netted: netted / n, ownFault: ownFault / n, weak: weak / n,
      speedKmh: stat(speeds), b2z: stat(b2z), b2speed: stat(b2sp),
      reachable: reach.reduce((a, b) => a + b, 0) / n,
      windowS: stat(win), solveMs: stat(solveMs),
      spinX: stat(spinX), spinY: stat(spinY), spinZ: stat(spinZ), kickCm: stat(kick),
      shortServe: b2z.filter((z) => z < 0.62).length / Math.max(1, b2z.length),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 3 — the player's serve over the gesture space
 * ------------------------------------------------------------------ */
function gesture(name, o) {
  return Object.assign({
    sx: 0.5, sy: 0.6, x: 0.5, y: 0.5, dx: 0, dy: 0, dist: 0.3, pathLen: 0.32,
    straightness: 0.94, speed: 2.4, peakSpeed: 2.8, releaseSpeed: 2.4, accel: 0,
    angle: 0, angleDeg: 0, up: 0.9, right: 0.05, curl: 0.05, dur: 0.14,
    samples: 14, jerk: 1.2, smooth: 0.9, _name: name,
  }, o);
}
const GESTURES = [
  gesture('up slow', { up: 0.95, right: 0.05, dist: 0.30, speed: 1.8, peakSpeed: 2.2, releaseSpeed: 1.8 }),
  gesture('up fast', { up: 0.95, right: 0.05, dist: 0.42, speed: 3.9, peakSpeed: 4.3, releaseSpeed: 3.9 }),
  gesture('down chop', { up: -0.98, right: 0.0, dist: 0.33, speed: 2.4, peakSpeed: 2.8, releaseSpeed: 2.4 }),
  gesture('side curl', { up: 0.40, right: 0.85, dist: 0.30, speed: 2.6, peakSpeed: 3.0, releaseSpeed: 2.6, curl: 1.6, straightness: 0.7 }),
  gesture('side curl L', { up: 0.40, right: -0.85, dist: 0.30, speed: 2.6, peakSpeed: 3.0, releaseSpeed: 2.6, curl: -1.6, straightness: 0.7 }),
  gesture('flat fast', { up: 0.30, right: 0.12, dist: 0.40, speed: 4.4, peakSpeed: 4.8, releaseSpeed: 4.4, straightness: 0.98 }),
  gesture('weak tap', { up: 0.6, right: 0.1, dist: 0.06, speed: 0.5, peakSpeed: 0.7, releaseSpeed: 0.5, samples: 6 }),
  gesture('hook long', { up: 0.2, right: 0.95, dist: 0.55, speed: 3.2, peakSpeed: 3.6, releaseSpeed: 3.2, curl: 2.2, straightness: 0.55 }),
];

function suitePlayerServe(n) {
  const out = { cases: 0, rows: [] };
  for (const g of GESTURES) {
    for (const assist of [0, 0.25, 0.5, 0.72, 1.0]) {
      let legal = 0, speeds = [], b2z = [], ms = [];
      const per = Math.max(1, Math.round(n / GESTURES.length / 5));
      for (let i = 0; i < per; i++) {
        const m = Object.assign({}, g, { x: 0.5 + srndSym(0.2), y: 0.5 + srndSym(0.2) });
        const ts = tossState(1, 'player');
        const bp = { x: ts.p.x + srndSym(0.24), y: ts.p.y, z: ts.p.z + srndSym(0.06) };
        const bv = { x: ts.v.x + srndSym(0.03), y: ts.v.y * srnd(0.7, 1.15), z: ts.v.z + srndSym(0.03) };
        const bw = { x: 0, y: 0, z: 0 };
        const ctx = { side: 1, isServe: true, ball: { y: bp.y, z: bp.z }, ballSpin: bw, ballSpeed: 1.6 };
        const t0 = process.hrtime.bigint();
        let st = deriveStroke(m, ctx);
        let r = refineRacket(bp, bv, bw, st, assist, st.quality);
        // mirrors the game: no retry when the first pass was already at full assist
        if (r.valid === false && assist < 0.999) r = refineRacket(bp, bv, bw, r, 1, r.quality);
        ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
        const v = V3.clone(bv), w = V3.clone(bw);
        impactRacket(v, w, r.normal, r.vR, r.quality, r.rubber || {});
        const rep = {};
        // verified at the game's own step: a verdict taken at any other dt
        // disagrees about marginal net clips
        predict(V3.clone(bp), V3.clone(v), V3.clone(w), { dt: PH.SIM_DT, maxT: 2.6, out: rep });
        const ok = !!rep.landed && Math.sign(rep.landed.z) === 1 && !!rep.b2 && Math.sign(rep.b2.z) === -1 && !rep.hitNet;
        if (process.env.DBGPS && g._name === 'weak tap' && assist === 1 && i === 0) {
          console.log(`  [dbg] vmag=${st.vmag.toFixed(2)} elev=${st.elev.toFixed(1)} contact=${st.contact.toFixed(1)} azS=${st.azSwing.toFixed(2)} azF=${st.azFace.toFixed(2)} q=${st.quality.toFixed(2)}`);
          console.log(`  [dbg] solved dE=${(r.dElev||0).toFixed(2)} dA=${(r.dAz||0).toFixed(2)} sc=${(r.scale||0).toFixed(2)} valid=${r.valid} |vR|=${V3.len(r.vR).toFixed(2)}`);
          console.log(`  [dbg] n=(${r.normal.x.toFixed(2)},${r.normal.y.toFixed(2)},${r.normal.z.toFixed(2)}) out v=(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`);
          console.log(`  [dbg] landed=${rep.landed ? rep.landed.z.toFixed(2) : '-'} b2=${rep.b2 ? rep.b2.z.toFixed(2) : '-'} net=${rep.hitNet} bounces=${rep.bounces} floor=${rep.floor ? rep.floor.z.toFixed(2) : '-'} diverged=${rep.diverged}`);
        }
        if (ok) legal++;
        speeds.push(V3.len(v) * 3.6);
        if (rep.b2) b2z.push(rep.b2.z);
        out.cases++;
      }
      out.rows.push({ gesture: g._name, assist, n: per, legal: legal / per,
        speedKmh: stat(speeds), b2z: stat(b2z), ms: stat(ms) });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 4 — rally shots: does the assist keep the ball on the table?
 * ------------------------------------------------------------------ */
function suiteRally(n) {
  const out = { cases: 0, byAssist: [], byStroke: {}, solverMs: [], predicts: 0 };
  // count predict() calls to price the solver honestly
  for (const assist of [0, 0.25, 0.5, 0.72, 1.0]) {
    let onTable = 0, net = 0, own = 0, wide = 0, speeds = [], spins = [];
    for (let i = 0; i < n; i++) {
      const g = GESTURES[i % GESTURES.length];
      const m = Object.assign({}, g, { x: 0.5 + srndSym(0.3), y: 0.5 + srndSym(0.3) });
      const inc = srnd(4, 18), incTop = srndSym(700);
      const bp = { x: srndSym(0.8), y: PH.TABLE_Y + srnd(0.02, 0.55), z: 1.05 + srndSym(0.25) };
      const bv = { x: srndSym(2), y: srnd(-2, 3), z: inc };
      const bw = { x: incTop, y: srndSym(300), z: srndSym(200) };
      const ctx = {
        side: 1, isServe: false, ball: { y: bp.y, z: bp.z }, ballSpin: bw, ballSpeed: inc,
        equip: { e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1 },
      };
      const t0 = process.hrtime.bigint();
      let st = deriveStroke(m, ctx);
      let r = refineRacket(bp, bv, bw, st, assist, st.quality);
      if (r.valid === false) r = refineRacket(bp, bv, bw, r, Math.max(assist, 0.72), r.quality);
      out.solverMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
      const v = V3.clone(bv), w = V3.clone(bw);
      impactRacket(v, w, r.normal, r.vR, r.quality, r.rubber || {});
      const rep = {};
      predict(V3.clone(bp), V3.clone(v), V3.clone(w), { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: rep });
      speeds.push(V3.len(v) * 3.6); spins.push(V3.len(w) / (2 * Math.PI));
      const sid = st.stroke.id;
      const row = out.byStroke[sid] || (out.byStroke[sid] = { n: 0, onTable: 0, net: 0, own: 0, speed: [], spin: [] });
      row.n++; row.speed.push(V3.len(v) * 3.6); row.spin.push(V3.len(w) / (2 * Math.PI));
      if (rep.hitNet) { net++; row.net++; }
      else if (!rep.landed) {
        if (rep.planeCross && Math.abs(rep.planeCross.x) > PH.T_HALF_WID + PH.R) { wide++; }
      } else if (Math.sign(rep.landed.z) === 1) { own++; row.own++; }
      else { onTable++; row.onTable++; }
      out.cases++;
    }
    out.byAssist.push({ assist, n, onTable: onTable / n, net: net / n, own: own / n, wide: wide / n,
      speedKmh: stat(speeds), spinRps: stat(spins) });
  }
  out.solverMsStat = stat(out.solverMs);
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 5 — camera framing: is the whole table (and the reachable
 *  paddle volume) inside the frame, on every aspect ratio?
 * ------------------------------------------------------------------ */
const ASPECTS = [
  { name: '21:9 ultrawide', a: 21 / 9, w: 2560, h: 1080 },
  { name: '16:9 desktop', a: 16 / 9, w: 1920, h: 1080 },
  { name: '16:10 laptop', a: 16 / 10, w: 1440, h: 900 },
  { name: '4:3 tablet', a: 4 / 3, w: 1024, h: 768 },
  { name: '3:2 phone land', a: 3 / 2, w: 900, h: 600 },
  { name: '1:1 square', a: 1, w: 800, h: 800 },
  { name: '9:16 phone', a: 9 / 16, w: 430, h: 760 },
  { name: '9:19.5 tall', a: 9 / 19.5, w: 390, h: 844 },
];

function suiteCamera() {
  const out = { cases: 0, rows: [], band: [] };
  const modes = Object.keys(CAMERA_PRESETS);
  const BALLS = [
    { x: 0, y: PH.TABLE_Y + 0.2, z: 0 },
    { x: 0.7, y: PH.TABLE_Y + 0.9, z: -1.2 },
    { x: -0.7, y: PH.TABLE_Y + 0.05, z: 1.3 },
    { x: 0, y: PH.TABLE_Y + 1.6, z: 0.4 },
  ];
  for (const mode of modes) {
    for (const A of ASPECTS) {
      for (const ball of BALLS) {
        const rig = cameraRigFor(mode, ball, A.a);
        const vp = rigViewProj(rig, A.a);
        // 1. the four table corners + net tape must be on screen
        const pts = [];
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) pts.push({ x: sx * PH.T_HALF_WID, y: PH.TABLE_Y, z: sz * PH.T_HALF_LEN, k: 'corner' });
        pts.push({ x: -PH.NET_HALF_WID, y: PH.NET_TOP, z: 0, k: 'netW' });
        pts.push({ x: PH.NET_HALF_WID, y: PH.NET_TOP, z: 0, k: 'netE' });
        // 2. the whole volume the paddle can occupy must be on screen
        for (const px of [-PADDLE_LIMITS.x, PADDLE_LIMITS.x])
          for (const py of [PH.TABLE_Y + PADDLE_LIMITS.yLo, PH.TABLE_Y + PADDLE_LIMITS.yHi])
            for (const pz of [PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zNear, PADDLE_LIMITS.zFar])
              pts.push({ x: px, y: py, z: pz, k: pz === PADDLE_LIMITS.zStepIn ? 'step' : 'paddle' });
        let worst = 1e9, worstK = '', offTable = 0, offPaddle = 0, offStep = 0, nStep = 0;
        for (const p of pts) {
          const s = projectPoint(vp, p);
          const m = Math.min(s.x, 1 - s.x, s.y, 1 - s.y);
          if (m < worst) { worst = m; worstK = p.k; }
          if (p.k === 'step') nStep++;
          if (m < 0.0) {
            if (p.k === 'step') offStep++;
            else if (p.k === 'paddle') offPaddle++;
            else offTable++;
          }
          out.cases++;
        }
        // 3. where does the FAR end line sit on screen? (the text band must
        //    stay above it so no message ever lands on the table)
        const farL = projectPoint(vp, { x: -PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN });
        const farR = projectPoint(vp, { x: PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN });
        const netTop = projectPoint(vp, { x: 0, y: PH.NET_TOP, z: 0 });
        out.rows.push({
          mode, aspect: A.name, a: A.a, margin: worst, worstKind: worstK,
          offTable, offPaddle, offStep, nStep, tableTopY: Math.min(farL.y, farR.y), netTopY: netTop.y,
        });
        out.band.push({ mode, aspect: A.name, tableTopY: Math.min(farL.y, farR.y) });
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 6 — pointer → paddle: does the bat stay on screen and stay
 *  tied to the cursor, for every pointer position and sensitivity?
 * ------------------------------------------------------------------ */
function suitePointer(n) {
  /* Measures the SHIPPED path: paddleTargetFromPointer() -> the frustum clamp
     the game applies every frame -> projection. A target that is off-frame
     before the clamp is fine (that is what the clamp is for); after the clamp
     it is the bug the player reported ("the bat drifts off screen and stays
     there"). Swept over sensitivity, rig, aspect ratio and pointer position,
     including pointers outside the window, which is how the old code ended up
     parked off-frame for good. */
  const out = { cases: 0, offscreen: 0, worstOff: 0, rawOff: 0, rows: [], home: [] };
  const modes = Object.keys(CAMERA_PRESETS);
  for (const a of ASPECTS) {
    for (const mode of modes) {
      // the anchor the clamp pulls toward must itself be on screen, at every
      // depth the bat is allowed to occupy, or the clamp has nothing to do
      const rig0 = cameraRigFor(mode, { x: 0, y: PH.TABLE_Y + 0.3, z: 0.4 }, a.a);
      const vp0 = rigViewProj(rig0, a.a);
      let homeWorst = 1;
      for (const z of [PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zNear, 1.44, PADDLE_LIMITS.zFar]) {
        const hs = projectPoint(vp0, { x: 0, y: PH.TABLE_Y + 0.62, z }, {});
        if (hs.ok) homeWorst = Math.min(homeWorst, Math.min(hs.x, 1 - hs.x, hs.y, 1 - hs.y));
      }
      out.home.push({ mode, aspect: a.name, homeMargin: homeWorst });

      for (const sens of [0.5, 1.0, 1.4, 1.8]) {
        let off = 0, raw = 0, tot = 0, maxOut = 0;
        for (let i = 0; i < n; i++) {
          // deliberately wider than the window: a stuck or dragged-off cursor
          const pt = { x: srnd(-0.35, 1.35), y: srnd(-0.35, 1.35) };
          const t = paddleTargetFromPointer(pt.x, pt.y, pt.y, sens, {}, {});
          const rig = cameraRigFor(mode, { x: t.tx, y: t.ty, z: 0.4 }, a.a);
          const vp = rigViewProj(rig, a.a);
          const before = projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, {});
          if (before.ok && Math.max(-before.x, before.x - 1, -before.y, before.y - 1) > 0.005) raw++;
          clampPaddleToFrustum(vp, t, 0.05);
          const sp = projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, {});
          const outside = sp.ok ? Math.max(0.05 - sp.x, sp.x - 0.95, 0.05 - sp.y, sp.y - 0.95) : 9;
          if (outside > 0.002) { off++; if (outside > maxOut) maxOut = outside; }
          tot++; out.cases++;
        }
        out.rows.push({ sens, mode, aspect: a.name, rawOff: raw / tot, offscreen: off / tot, worst: maxOut });
        out.offscreen += off; out.rawOff += raw;
        out.worstOff = Math.max(out.worstOff, maxOut);
      }
    }
  }
  return out;
}

function suitePassive() {
  /* A block is the one contact where the player does NOT swipe: the ball
     meets a bat that is merely held there. What the player sees is the face,
     so the face has to decide where the ball goes. The old code handed
     refineRacket() only `normal`, and refineRacket rebuilds the frame from
     (elev, contact, azimuth) — i.e. from the BLOCK archetype — so the visible
     angle was thrown away and every block came back square. The shipped code
     encodes the visible face into the solver's frame first. Measured both. */
  const out = { cases: 0, rows: [] };
  const RUB = () => ({ e: PH.E_RACKET * 0.42, mu: PH.MU_RACKET, et: PH.ET_RACKET * 0.7 });
  for (const [yaw, tilt, pace] of [[-0.6, -0.05, 7.5], [-0.3, -0.05, 7.5], [0, -0.05, 7.5], [0.3, -0.05, 7.5],
    [0.6, -0.05, 7.5], [0, -0.30, 9.0], [-0.4, 0.22, 4.0], [0.25, -0.18, 11.0], [0, -0.05, 2.2]]) {
    const n = V3.norm(V3.new(), { x: Math.sin(yaw) * Math.cos(tilt), y: tilt, z: -Math.cos(yaw) * Math.cos(tilt) });
    const bp = { x: 0.1, y: PH.TABLE_Y + 0.22, z: 1.2 };
    const bv = { x: 0, y: -1.2, z: pace };
    const bw = { x: 300, y: 0, z: 0 };
    const vR = { x: 0.4, y: 0.1, z: -0.2 };

    // what the player expects: the visible face decides
    const vB = V3.clone(bv), wB = V3.clone(bw);
    impactRacket(vB, wB, n, vR, 0.45, RUB());
    const want = Math.atan2(vB.x, -vB.z);

    const lands = (v, w, from) => {
      const r = {};
      predict(V3.clone(from), V3.clone(v), V3.clone(w), { dt: 1 / 300, maxT: 2.4, out: r });
      return r.landed ? { x: r.landed.x, z: r.landed.z } : (r.hitNet ? 'NET' : 'OUT');
    };
    /* (a) what the game used to do: hand refineRacket() a BLOCK archetype and
       an overridden normal, and let the placement solver rebuild the frame. */
    const runOld = () => {
      const rk = makeRacket(1, 'BLOCK', { aim: { x: 0, z: -0.62 }, vmag: V3.len(vR), quality: 0.5 });
      rk.normal = V3.clone(n); rk.vR = V3.clone(vR); rk.rubber = RUB();
      const ref = refineRacket(bp, bv, bw, rk, 0.8, 0.45);
      const v = V3.clone(bv), w = V3.clone(bw);
      impactRacket(v, w, ref.normal, ref.vR, 0.45, ref.rubber || {});
      return { dot: V3.dot(ref.normal, n), outX: v.x, outZ: v.z, lift: 0,
        errDeg: Math.abs(Math.atan2(v.x, -v.z) - want) / DEG, lands: lands(v, w, bp) };
    };
    /* (b) shipped: the visible face decides, only a net-clearing lift allowed. */
    const runNow = () => {
      const rk = makeRacket(1, 'BLOCK', { aim: { x: 0, z: -0.62 }, vmag: V3.len(vR), quality: 0.5 });
      rk.rubber = RUB();
      const blk = solveBlockNormal(bp, bv, bw, n, vR, 0.45, rk.rubber, {});
      const v = V3.clone(bv), w = V3.clone(bw);
      impactRacket(v, w, blk.normal, vR, 0.45, rk.rubber);
      return { dot: V3.dot(blk.normal, n), outX: v.x, outZ: v.z, lift: blk.liftDeg,
        errDeg: Math.abs(Math.atan2(v.x, -v.z) - want) / DEG, lands: lands(v, w, bp) };
    };
    const old = runOld(), now = runNow();
    out.rows.push({ yawDeg: Math.round(yaw / DEG), tiltDeg: Math.round(tilt / DEG), pace, old, now });
    out.cases++;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 8 — AI return quality across levels (rally shape)
 * ------------------------------------------------------------------ */
/* Can the player get to it?
 *
 * "The opponent hits into the net" and "the opponent hits where I cannot
 * reach" are different defects with different fixes: the first is a free point
 * that feels broken, the second a lost point that feels unfair.
 *
 * The verdict is computed against the two planes the bat can actually be on:
 *   home (zNear .. zFar, where the bat already is) — needs reaction time only;
 *   step-in (zStepIn, leaning over the table)      — needs the feet to travel,
 *                                                   so the game gates it on
 *                                                   0.34 s to contact.
 * A shot counts as RETURNABLE if either plane offers an intercept inside the
 * bat's box with enough time. Landing depth is measured on a separate,
 * untruncated flight: asking predict to stop at a plane makes it stop BEFORE
 * the first bounce for any deep ball, which silently biased the median. */
function probePlane(p0, v0, w0, zPlane) {
  const r = {};
  predict(V3.clone(p0), V3.clone(v0), V3.clone(w0),
    { dt: PH.SIM_DT, maxT: 3.0, stopZ: zPlane, stopDir: 1, stopAtPlane: true, out: r });
  if (r.hitNet) return { net: true, reach: null, ttc: -1, yRel: null, x: null, bounces: r.bounces };
  const c = r.reach;
  if (!c) return { net: false, reach: null, ttc: -1, yRel: null, x: null, bounces: r.bounces };
  const yRel = c.y - PH.TABLE_Y;
  const inBox = Math.abs(c.x) <= PADDLE_LIMITS.x + 1e-6 &&
    yRel >= PADDLE_LIMITS.yLo - 1e-6 && yRel <= PADDLE_LIMITS.yHi + 1e-6;
  return { net: false, reach: c, ttc: r.reachT, yRel, x: c.x, inBox, bounces: r.bounces };
}

/* warnT is how long the player has already been watching this ball before the
 * clock of this flight starts. For a normal shot it is 0 (the clock starts at
 * the opponent's contact). For a net cord it is the approach flight to the
 * tape, which the game's own step-in gate has already been counting down every
 * frame — judging a dribbler from the instant it clips the tape would demand
 * that the player react before the ball arrives. Estimated as distance/speed,
 * i.e. a lower bound (drag makes the real flight longer), so the verdict stays
 * conservative. */
function shotPlayability(p0, v0, w0, warnT) {
  const full = {};
  predict(V3.clone(p0), V3.clone(v0), V3.clone(w0), { dt: PH.SIM_DT, maxT: 3.0, out: full });
  const home = probePlane(p0, v0, w0, 1.44);        // where the bat normally is
  const step = probePlane(p0, v0, w0, PADDLE_LIMITS.zStepIn);
  const wt = warnT > 0 ? warnT : 0;
  const okHome = home.reach && home.inBox && home.ttc + wt >= 0.22;
  const okStep = step.reach && step.inBox && step.ttc + wt >= 0.34;
  let verdict;
  if (full.hitNet) verdict = 'net fault';
  else if (okHome || okStep) verdict = 'RETURNABLE';
  else if (home.reach && home.inBox) verdict = 'too fast even at home';
  else if (step.reach && step.inBox) verdict = 'step-in too late';
  else if (full.bounces >= 2) verdict = 'died short (2 bounces)';
  else if (home.reach || step.reach) verdict = 'outside the bat box';
  else verdict = 'never arrived';
  return {
    verdict, net: !!full.hitNet,
    landedZ: full.landed ? full.landed.z : null,
    bounces: full.bounces,
    ttcHome: home.ttc, yHome: home.yRel,
    ttcStep: step.ttc, yStep: step.yRel,
    b2: full.b2 ? full.b2.z : null,
  };
}

/* 14. WHAT DOES AN OFF-CENTRE CONTACT COST?
 *
 * The whole miss model, copied line for line from tryPlayerHit, so the numbers
 * say what the shipped game does and not what a paraphrase of it would do:
 *   offMag  = |offset| / blade radius        (1.0 = the rim)
 *   sweet   = (1 - offMag) * sweetK          => offMag = 1 - sweet  when sweetK = 1
 *   miss    = (1 - sweet) * offMag
 *   vmag   *= 1 - 0.18 * miss
 *   azSwing += offLat * 0.23 * (1 - sweet)   (~13 deg at the rim)
 *   elev    -= offVer * 8.0  * (1 - sweet)   (~8 deg at the rim)
 *   quality = q * (0.55 + 0.45 sweet) * (0.70 + 0.30 timing) * tq, floor 0.18
 * and then refineRacket with the DEFAULT assist (0.72) and that quality.
 * The smoke run showed 70 % of all points ending as "the ball did not get over
 * the net" after the player's own hit, which is either a bad bot gesture or an
 * over-harsh miss model; this separates the two by sweeping the contact alone. */
function suiteMiss(n) {
  const out = { cases: 0, rows: [] };
  const DIRS = [
    { k: 'centre', lat: 0, ver: 0 },
    { k: 'top of blade', lat: 0, ver: 1 },        // ball above the bat centre
    { k: 'bottom of blade', lat: 0, ver: -1 },
    { k: 'side of blade', lat: 1, ver: 0 },
    { k: 'diagonal', lat: 0.7071, ver: 0.7071 },
  ];
  const SWEETS = [1.0, 0.8, 0.6, 0.45, 0.30, 0.15];
  const TIMINGS = [{ k: 'ТОЧНО', t: 1.0, tq: 1.08 }, { k: 'ПОЗДНО', t: 0.70, tq: 0.90 }];
  for (const T of TIMINGS) {
    for (const D of DIRS) {
      for (const sweet of SWEETS) {
        if (D.k !== 'centre' && sweet > 0.999) continue;
        let onTable = 0, net = 0, own = 0, wide = 0;
        const elev = [], speeds = [];
        for (let i = 0; i < n; i++) {
          const g = GESTURES[i % GESTURES.length];
          const m = Object.assign({}, g, { x: 0.5 + srndSym(0.3), y: 0.5 + srndSym(0.3) });
          const inc = srnd(4, 18);
          const bp = { x: srndSym(0.8), y: PH.TABLE_Y + srnd(0.02, 0.55), z: 1.05 + srndSym(0.25) };
          const bv = { x: srndSym(2), y: srnd(-2, 3), z: inc };
          const bw = { x: srndSym(700), y: srndSym(300), z: srndSym(200) };
          const offMag = clamp(1 - sweet, 0, 1);
          const offLat = clamp(D.lat * offMag, -1, 1), offVer = clamp(D.ver * offMag, -1, 1);
          const st = deriveStroke(m, {
            side: 1, isServe: false, ball: { y: bp.y, z: bp.z }, ballSpin: bw, ballSpeed: inc,
            equip: { e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1 },
            spinBias: 'norm',
          });
          const rk = Object.assign({}, st);
          const miss = (1 - sweet) * Math.hypot(offLat, offVer);
          rk.vmag *= 1 - 0.18 * miss;
          rk.azSwing = clamp(rk.azSwing + offLat * 0.23 * (1 - sweet), -1.35, 1.35);
          rk.elev = clamp(rk.elev - offVer * 8.0 * (1 - sweet), -70, 78);
          const q = clamp(st.quality * (0.55 + 0.45 * sweet) * (0.70 + 0.30 * T.t) * T.tq, 0.18, 1);
          rk.quality = q;
          let r = refineRacket(bp, bv, bw, rk, 0.72, q);
          elev.push(rk.elev);
          const v = V3.clone(bv), w = V3.clone(bw);
          impactRacket(v, w, r.normal, r.vR, r.quality, r.rubber || {});
          speeds.push(V3.len(v) * 3.6);
          const rep = {};
          predict(V3.clone(bp), V3.clone(v), V3.clone(w),
            { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: rep });
          if (rep.hitNet) net++;
          else if (!rep.landed) { if (rep.planeCross && Math.abs(rep.planeCross.x) > PH.T_HALF_WID + PH.R) wide++; }
          else if (Math.sign(rep.landed.z) === 1) own++;
          else onTable++;
          out.cases++;
        }
        out.rows.push({ timing: T.k, dir: D.k, sweet, n,
          onTable: onTable / n, net: net / n, own: own / n, wide: wide / n,
          elevMed: stat(elev).med, speedMed: stat(speeds).med });
      }
    }
  }
  return out;
}

function suiteAiReturn(n) {
  const out = { cases: 0, perLevel: [] };
  for (const L of AI_LEVELS) {
    const ai = new OpponentAI(L.id);
    const speeds = [], spins = [], onTable = [], net = [], long = [], wide = [], ms = [];
    const play = [];                 // playability of every shot the AI made
    for (let i = 0; i < n; i++) {
      // a realistic incoming ball: player's loop landing on the bot's half
      const land = { x: srndSym(0.5), z: -0.4 - srnd(0, 0.9) };
      const from = { x: srndSym(0.6), y: PH.TABLE_Y + 0.28, z: 1.25 };
      const spin = { x: -srnd(200, 800), y: srndSym(200), z: 0 };
      const sol = solveLaunch(from, land, spin, { speed: srnd(9, 16), netClear: 0.09, speedForgive: 0.3 });
      if (!sol) continue;
      const bv = { x: sol.vx, y: sol.vy, z: sol.vz };
      // let it bounce once on the bot's half, then meet it behind the table
      const p = V3.clone(from), v = V3.clone(bv), w = V3.clone(spin);
      const rep = {};
      predict(p, v, w, { dt: 1 / 300, maxT: 2.0, stopOnFirstBounce: true, out: rep });
      if (!rep.landed) continue;
      const p2 = V3.clone(from), v2 = V3.clone(bv), w2 = V3.clone(spin);
      const rep2 = {};
      predict(p2, v2, w2, { dt: 1 / 300, maxT: 2.0, stopZ: -1.62, stopDir: -1, stopAtPlane: true, out: rep2 });
      if (!rep2.reach) continue;
      const bp = rep2.reach, bvv = { x: rep2.reach.vx, y: rep2.reach.vy, z: rep2.reach.vz };
      ai.pace = clamp(0.3 + i / n * 0.6, 0, 1);
      ai.tactic = X.AI_TACTICS.BUILD;
      ai.plan = { x: bp.x, y: bp.y, z: bp.z, t: 0, speed: V3.len(bvv), short: false, wide: false };
      ai.commit = null;
      const archId = ai.pickStroke({ ball: { w: w2, p: bp, v: bvv }, player: { pos: { x: srndSym(0.5) } }, time: 0 }, ai.plan);
      const tgt = ai.pickTarget({ player: { pos: { x: srndSym(0.5) } } }, ai.plan, archId);
      ai.commit = { arch: archId, tgt, vmag: ai.pickPace(archId, ai.plan), at: 0, windup: 0.2, bs: null };
      const t0 = process.hrtime.bigint();
      const rk = ai.swing({ ball: { p: bp, v: bvv, w: w2, lastHitBy: 1 }, time: 0, shotId: i });
      ms.push(Number(process.hrtime.bigint() - t0) / 1e6);
      const v3 = V3.clone(bvv), w3 = V3.clone(w2);
      impactRacket(v3, w3, rk.normal, rk.vR, rk.quality, rk.rubber || {});
      const rep3 = {};
      predict(V3.clone(bp), V3.clone(v3), V3.clone(w3), { dt: 1 / 300, maxT: 2.6, stopOnFirstBounce: true, out: rep3 });
      speeds.push(V3.len(v3) * 3.6); spins.push(V3.len(w3) / (2 * Math.PI));
      // judged from the player's side: can the bat actually get to this ball?
      play.push(shotPlayability(bp, v3, w3));
      if (rep3.hitNet) { net.push(1); onTable.push(0); long.push(0); wide.push(0); }
      else if (!rep3.landed) {
        net.push(0); onTable.push(0); long.push(0);
        wide.push(rep3.planeCross && Math.abs(rep3.planeCross.x) > PH.T_HALF_WID + PH.R ? 1 : 0);
      } else if (Math.sign(rep3.landed.z) === -1) { net.push(0); onTable.push(0); long.push(1); wide.push(0); }
      else { net.push(0); onTable.push(1); long.push(0); wide.push(0); }
      out.cases++;
    }
    const s = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const verd = {};
    for (const p of play) verd[p.verdict] = (verd[p.verdict] || 0) + 1;
    const cnt = (k) => verd[k] || 0;
    const np = Math.max(1, play.length);
    const ttcs = play.filter((p) => p.ttcHome > 0).map((p) => p.ttcHome);
    const lands = play.filter((p) => p.landedZ !== null && p.landedZ > 0).map((p) => p.landedZ);
    out.perLevel.push({ level: L.name, n: speeds.length, onTable: s(onTable), net: s(net), long: s(long),
      wide: s(wide), speedKmh: stat(speeds), spinRps: stat(spins), ms: stat(ms),
      returnable: cnt('RETURNABLE') / np, tooFast: cnt('too fast even at home') / np,
      stepLate: cnt('step-in too late') / np, diedShort: cnt('died short (2 bounces)') / np,
      outBox: cnt('outside the bat box') / np, neverArrived: cnt('never arrived') / np,
      netFault: cnt('net fault') / np,
      ttc: stat(ttcs), landZ: stat(lands) });
  }

  /* Net cord: a ball that clips the tape is the most hated shot in the game,
   * because it arrives slow, low and short — exactly where the bat used to be
   * forbidden. clipTape is the game's own function, so this measures what the
   * game really produces and judges it with the same reach model. The user's
   * ask was "make those returnable at least", and this is the only honest way
   * to know whether they are. */
  const cord = [];
  for (const sp of [3, 5, 7, 9, 12]) {
    for (const dy of [-0.004, 0.0, 0.006, 0.014, 0.022]) {
      for (const x0 of [-0.5, 0.0, 0.5]) {
        sandbox.rndSeed(90210 + sp * 31 + Math.round(dy * 1000) + Math.round(x0 * 10));
        const p0 = { x: x0, y: PH.NET_TOP + PH.R + dy, z: 0.001 };
        const v0 = { x: srndSym(0.4), y: srnd(-0.6, 0.6), z: sp };
        const w0 = { x: srndSym(400), y: srndSym(200), z: srndSym(200) };
        X.clipTape(p0, v0, w0);
        cord.push(shotPlayability(p0, v0, w0, 1.55 / sp));
      }
    }
  }
  const over = cord.filter((c) => c.landedZ !== null && c.landedZ > 0);
  const cntC = (v) => cord.filter((c) => c.verdict === v).length / cord.length;
  out.netcord = {
    n: cord.length, over: over.length / cord.length,
    returnable: cntC('RETURNABLE'), diedShort: cntC('died short (2 bounces)'),
    outBox: cntC('outside the bat box'), stepLate: cntC('step-in too late'),
    neverArrived: cntC('never arrived'), netFault: cntC('net fault'),
    landZ: stat(over.map((c) => c.landedZ)),
    ttcStep: stat(cord.filter((c) => c.ttcStep > 0).map((c) => c.ttcStep)),
    strictReturnable: cord.filter((c) => c.verdict === 'RETURNABLE').length / cord.length,
    yStep: stat(cord.filter((c) => c.yStep !== null).map((c) => c.yStep)),
  };
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 9 — gesture fuzz: exceptions, NaN, classifier sanity
 * ------------------------------------------------------------------ */
function suiteFuzz(n) {
  const out = { cases: 0, exceptions: 0, nan: 0, classifier: {} };
  for (let i = 0; i < n; i++) {
    const m = {
      sx: srndSym(2), sy: srndSym(2), x: srndSym(2), y: srndSym(2),
      dx: srndSym(3), dy: srndSym(3), dist: srnd(0, 3), pathLen: srnd(0, 4),
      straightness: srnd(0, 1), speed: srnd(0, 40), peakSpeed: srnd(0, 40),
      releaseSpeed: srnd(0, 40), accel: srndSym(60), angle: srndSym(4),
      angleDeg: srndSym(200), up: srndSym(2), right: srndSym(2),
      curl: srndSym(6), dur: srnd(0.001, 1.4), samples: (srnd(60) | 0),
      jerk: srnd(0, 40), smooth: srnd(0, 1),
    };
    if (i % 97 === 0) { m.speed = NaN; m.dist = Infinity; m.curl = NaN; m.up = NaN; }
    const ctx = {
      side: i % 2 ? 1 : -1, isServe: i % 5 === 0,
      ball: { y: PH.TABLE_Y + srndSym(1.4), z: srndSym(3) },
      ballSpin: { x: srndSym(1400), y: srndSym(1400), z: srndSym(1400) },
      ballSpeed: srnd(0, 40),
    };
    try {
      const st = deriveStroke(m, ctx);
      const sid = st.stroke.id;
      out.classifier[sid] = (out.classifier[sid] || 0) + 1;
      const bad = [st.vmag, st.elev, st.contact, st.azSwing, st.azFace, st.normal.x, st.normal.y, st.normal.z,
        st.vR.x, st.vR.y, st.vR.z, st.quality].some((v) => !Number.isFinite(v));
      if (bad) out.nan++;
    } catch (e) { out.exceptions++; }
    out.cases++;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 10 — reach map: which parts of the player's half can the bat
 *  actually cover, given the pointer mapping and the paddle limits?
 * ------------------------------------------------------------------ */
function suiteReach() {
  const out = { cases: 0, rows: [], uncoveredShort: 0, grid: 0 };
  const rig = cameraRigFor('BROADCAST', { x: 0, y: PH.TABLE_Y + 0.3, z: 0 }, 16 / 9);
  const vp = rigViewProj(rig, 16 / 9);
  for (let z = 0.10; z <= 1.37; z += 0.05) {
    let cover = 0, tot = 0;
    for (let x = -PH.T_HALF_WID; x <= PH.T_HALF_WID; x += 0.05) {
      tot++; out.cases++;
      // can the paddle be at (x, z) at all?
      const ok = Math.abs(x) <= PADDLE_LIMITS.x && z >= PADDLE_LIMITS.zNear - 0.001;
      if (ok) cover++;
    }
    out.rows.push({ z: +z.toFixed(2), coverage: cover / tot });
    out.grid += tot;
    out.uncoveredShort += (tot - cover);
  }
  out.paddleScreen = (() => {
    const t = paddleTargetFromPointer(0.5, 0.55, 0.55, 1.0);
    return projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz });
  })();
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 12 — how the table answers spin
 *
 *  Three spin axes do three DIFFERENT things and the game only used one of
 *  them:
 *    w.x  topspin/backspin  -> the contact point slides along the flight
 *                              direction, friction kicks the ball forward
 *                              (or brakes it) at the bounce;
 *    w.y  spin about the vertical -> the contact point is ON the axis, so
 *                              the bounce does nothing at all; it only
 *                              curves the ball in flight (Magnus);
 *    w.z  corkscrew, spin about the flight axis -> the contact point slides
 *                              SIDEWAYS, so this is the axis that actually
 *                              throws the ball out of the table at the
 *                              bounce.
 *  A "sidespin" serve needs w.y (curve in the air) AND w.z (kick off the
 *  table); with only w.y it is a slow serve that bends a little and behaves
 *  like any other ball once it lands.
 * ------------------------------------------------------------------ */
function suiteBounce() {
  const out = { cases: 0, rows: [], edgeRows: [] };
  const CAP = 1080;
  const spins = [
    { name: 'no spin', wx: 0, wy: 0, wz: 0 },
    { name: 'topspin 50 %', wx: 0.5 * CAP, wy: 0, wz: 0 },
    { name: 'topspin 100 %', wx: CAP, wy: 0, wz: 0 },
    { name: 'backspin 50 %', wx: -0.5 * CAP, wy: 0, wz: 0 },
    { name: 'backspin 100 %', wx: -CAP, wy: 0, wz: 0 },
    { name: 'vertical 100 % (w.y)', wx: 0, wy: CAP, wz: 0 },
    { name: 'corkscrew 50 % (w.z)', wx: 0, wy: 0, wz: 0.5 * CAP },
    { name: 'corkscrew 100 % (w.z)', wx: 0, wy: 0, wz: CAP },
  ];
  for (const speed of [4, 8, 12]) {
    for (const dipDeg of [15, 30]) {
      for (const sp of spins) {
        const dip = dipDeg * DEG;
        const v0 = { x: 0, y: -speed * Math.sin(dip), z: speed * Math.cos(dip) };
        const p = { x: 0, y: PH.TABLE_Y + 0.30, z: -0.4 };
        const w0 = { x: sp.wx, y: sp.wy, z: sp.wz };
        // free flight to the table, then the bounce, then 0.45 s of flight
        const before = { v: V3.clone(v0), w: V3.clone(w0) };
        const rep = {};
        predict(V3.clone(p), V3.clone(v0), V3.clone(w0), { dt: 1 / 600, maxT: 1.2, stopOnFirstBounce: true, out: rep });
        const vv = V3.clone(rep.endV), ww = V3.clone({ x: 0, y: 0, z: 0 });
        // re-run to get the post-bounce state: integrate through the bounce
        const p2 = V3.clone(p), v2 = V3.clone(v0), w2 = V3.clone(w0);
        const dt = 1 / 600; let t = 0, bounced = false;
        const post = { v: null, w: null };
        while (t < 1.2) {
          integrateBall(p2, v2, w2, dt); t += dt;
          if (!bounced && p2.y - PH.R <= PH.TABLE_Y && v2.y < 0 &&
            Math.abs(p2.x) <= PH.T_HALF_WID + PH.R && Math.abs(p2.z) <= PH.T_HALF_LEN + PH.R) {
            const binfo = bounceTable(p2, v2, w2);
            bounced = true;
            post.v = V3.clone(v2); post.w = V3.clone(w2);
            post.info = binfo || {};
            post.t = t;
          }
          if (bounced && t > post.t + 0.45) break;
        }
        if (!post.v) continue;
        const hBefore = Math.hypot(before.v.x, before.v.z);
        const hAfter = Math.hypot(post.v.x, post.v.z);
        const angBefore = Math.atan2(-before.v.y, hBefore) / DEG;
        const angAfter = Math.atan2(post.v.y, hAfter) / DEG;
        // lateral drift over the 0.45 s after the bounce (Magnus + kick)
        const p3 = V3.clone(p2), v3 = V3.clone(post.v), w3 = V3.clone(post.w);
        let t3 = 0; const x3 = p3.x;
        while (t3 < 0.45) { integrateBall(p3, v3, w3, dt); t3 += dt; }
        out.rows.push({
          speed, dipDeg, spin: sp.name,
          dSpeedPct: (hAfter / hBefore - 1) * 100,
          angIn: angBefore, angOut: angAfter,
          lateral: p3.x - x3,
          vxKick: post.v.x,
          spinKeep: V3.len(post.w) / Math.max(1e-6, V3.len(spins.find((q) => q.name === sp.name) ? { x: sp.wx, y: sp.wy, z: sp.wz } : { x: 1 })),
          slipped: !!post.info.slipping,
        });
        out.cases++;
      }
    }
  }

  /* ---- calibration A/B: what should the table's friction be? ---------- *
   * MU_TABLE / ET_TABLE are the two numbers that decide how strongly the
   * table answers spin. Both are measured here against three things at once:
   * the ITTF dead-ball rebound (must stay 23..26 cm — it is unaffected by
   * friction because a dead vertical drop has no tangential slip), how much
   * a heavy loop kicks forward, how hard a heavy chop brakes, and how far a
   * corkscrew ball is thrown sideways. */
  const CAPC = 1080;
  const probe = (mu, et) => {
    const mu0 = PH.MU_TABLE, et0 = PH.ET_TABLE;
    PH.MU_TABLE = mu; PH.ET_TABLE = et;
    const one = (wx, wy, wz, speed, dipDeg) => {
      const dip = dipDeg * DEG;
      const p = { x: 0, y: PH.TABLE_Y + 0.30, z: -0.4 };
      const v = { x: 0, y: -speed * Math.sin(dip), z: speed * Math.cos(dip) };
      const w = { x: wx, y: wy, z: wz };
      const hIn = Math.hypot(v.x, v.z);
      const p2 = V3.clone(p), v2 = V3.clone(v), w2 = V3.clone(w);
      const dt = 1 / 600; let t = 0, done = false, hv = 0, lat = 0, tt = 0;
      while (t < 1.2 && !done) {
        integrateBall(p2, v2, w2, dt); t += dt;
        if (p2.y - PH.R <= PH.TABLE_Y && v2.y < 0 &&
          Math.abs(p2.x) <= PH.T_HALF_WID + PH.R && Math.abs(p2.z) <= PH.T_HALF_LEN + PH.R) {
          bounceTable(p2, v2, w2); done = true; hv = Math.hypot(v2.x, v2.z); tt = t;
        }
      }
      if (!done) return null;
      while (t < tt + 0.45) { integrateBall(p2, v2, w2, dt); t += dt; }
      lat = p2.x;
      return { dPct: (hv / hIn - 1) * 100, lat: lat * 100 };
    };
    // ITTF dead-ball rebound, spin = 0
    const drop = () => {
      const p = V3.new(0, PH.TABLE_Y + 0.300 + PH.R, 0), v = V3.new(0, 0, 0), w = V3.new(0, 0, 0);
      const dt = 1 / 6000; let t = 0;
      while (p.y - PH.R > PH.TABLE_Y && t < 2) { integrateBall(p, v, w, dt); t += dt; }
      bounceTable(p, v, w);
      let maxY = p.y;
      while (v.y > 0) { integrateBall(p, v, w, dt); if (p.y > maxY) maxY = p.y; }
      return (maxY - PH.R - PH.TABLE_Y) * 100;
    };
    const r = {
      mu, et, ittf: drop(),
      top8: one(CAPC, 0, 0, 8, 20), top12: one(CAPC, 0, 0, 12, 18),
      back4: one(-CAPC, 0, 0, 4, 25), back8: one(-CAPC, 0, 0, 8, 20),
      cork8: one(0, 0, CAPC, 8, 20), vert8: one(0, CAPC, 0, 8, 20),
    };
    PH.MU_TABLE = mu0; PH.ET_TABLE = et0;
    return r;
  };
  out.calib = [];
  for (const mu of [0.25, 0.32, 0.40, 0.48]) for (const et of [0, 0.10, 0.18]) out.calib.push(probe(mu, et));

  /* edge ball: the same shot, aimed at the side line and at the end line */
  for (const [label, x, z] of [['centre', 0, 0], ['side line', PH.T_HALF_WID - 0.004, -0.3],
    ['past side line', PH.T_HALF_WID + 0.010, -0.3], ['end line', 0.2, PH.T_HALF_LEN - 0.004],
    ['past end line', 0.2, PH.T_HALF_LEN + 0.012]]) {
    const v = { x: 0, y: -6, z: 6 }, w = { x: 300, y: 0, z: 0 };
    const p = { x, y: PH.TABLE_Y + PH.R + 1e-4, z };
    const vv = V3.clone(v), ww = V3.clone(w);
    const info = bounceTable(p, vv, ww) || {};
    const ang = Math.atan2(vv.y, Math.hypot(vv.x, vv.z)) / DEG;
    out.edgeRows.push({
      label, k: info.edge || 0, axis: info.edgeAxis || '-',
      speedOut: V3.len(vv), angOut: ang, vx: vv.x, vz: vv.z,
    });
    out.cases++;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 13 — can this stroke model make a corkscrew serve at all?
 *
 *  Spin about the flight axis (w.z) is the only component the TABLE answers
 *  sideways. It is made by friction, and friction is made by slip, so the
 *  question is purely geometric: which (face azimuth, face elevation, swing
 *  azimuth) combinations put enough lateral slip into the contact. Swept
 *  directly instead of guessed.
 * ------------------------------------------------------------------ */
function suiteCork() {
  const out = { cases: 0, rows: [] };
  const side = -1;                                  // the opponent serves
  const ts = tossState(side, 'ai');
  for (const azFace of [-0.7, -0.45, -0.2, 0, 0.2, 0.45, 0.7]) {
    for (const elev of [-30, -10, 10, 30, 50]) {
      for (const azSwing of [-0.5, 0, 0.5]) {
        const rk = makeRacket(side, 'SERVE_SIDE', {
          elev, contact: 62, azSwing, azFace, vmag: 9.0,
          aim: { x: 0.35, z: 1.0 }, isServe: true, quality: 0.9, netClear: 0.075,
        });
        // no solver: measure what the RAW frame does, then what the solver keeps
        const v = V3.clone(ts.v), w = V3.clone({ x: 0, y: 0, z: 0 });
        strokeFrame(rk, 0, 0, 1, rk.vR, rk.normal);
        impactRacket(v, w, rk.normal, rk.vR, 0.9, rk.rubber || {});
        const rep = {};
        predict(V3.clone(ts.p), V3.clone(v), V3.clone(w), { dt: PH.SIM_DT, maxT: 2.2, stopAfterBounces: 2, out: rep });
        const legal = !!rep.landed && Math.sign(rep.landed.z) === side && !!rep.b2 &&
          Math.sign(rep.b2.z) !== side && !rep.hitNet;
        out.rows.push({
          azFace, elev, azSwing,
          wx: w.x / 1080, wy: w.y / 1080, wz: w.z / 1080,
          speed: V3.len(v) * 3.6, legal,
          b2: rep.b2 ? rep.b2.z : null,
        });
        out.cases++;
      }
    }
  }
  /* ---- the explicit spin dial: one gesture, three settings ------------- *
   * Same incoming ball, same swipe, only settings.spinBias differs. If the
   * dial does not move both spin and pace in opposite directions it is
   * decoration, not a control. */
  out.dial = [];
  for (const bias of ['low', 'norm', 'high']) {
    const sp = [], km = [], ct = [];
    for (let i = 0; i < 80; i++) {
      const m = gesture('dial', { up: 0.72, right: 0.18, dist: 0.34, speed: 2.9,
        peakSpeed: 3.3, releaseSpeed: 2.9, curl: 0.5 + srnd(0.3), straightness: 0.86 });
      const st = deriveStroke(m, {
        side: 1, isServe: false, ball: { y: PH.TABLE_Y + 0.22, z: 1.15 },
        ballSpin: { x: 0, y: 0, z: 0 }, ballSpeed: 8, spinBias: bias,
      });
      const bp = { x: 0.05, y: PH.TABLE_Y + 0.22, z: 1.15 };
      const v = V3.new(0, -0.6, 8), w = V3.new(0, 0, 0);
      strokeFrame(st, 0, 0, 1, st.vR, st.normal);
      impactRacket(v, w, st.normal, st.vR, st.quality, st.rubber || {});
      km.push(V3.len(v) * 3.6); sp.push(V3.len(w) / (2 * Math.PI)); ct.push(st.contact);
      out.cases++;
    }
    out.dial.push({ bias, speed: stat(km), spin: stat(sp), contact: stat(ct) });
  }

  return out;
}

/* ------------------------------------------------------------------ *
 *  SUITE 11 — SMOKE: play whole matches headlessly
 *
 *  No browser is available in this sandbox, so this is the only end-to-end
 *  proof that the shipped code path runs: real Game, real UI, real renderer
 *  (against a behaving WebGL2 stub), real frame loop, real state machine.
 *  A crude bot moves the pointer at the ball and swipes; what is measured is
 *  not how well it plays but that nothing throws, nothing goes non-finite,
 *  the bat never leaves the frame, points get awarded and matches end.
 * ------------------------------------------------------------------ */
function drainTimers() {
  for (let i = timers.length - 1; i >= 0; i--) {
    if (timers[i].at <= simNow) {
      const t = timers.splice(i, 1)[0];
      try { t.fn(); } catch (e) { SMOKE_ERR.push({ where: 'timer', msg: String(e && e.message || e) }); }
    }
  }
}
const SMOKE_ERR = [];

function suiteSmoke(matches, frames) {
  const out = {
    cases: 0, matches: 0, frames: 0, points: 0, throws: SMOKE_ERR, states: {}, reasons: {},
    playerShots: [],
    rcNoServe: 0, rcFails: [], offFrame: 0, offFrameWorst: 0, offFrameLive: 0, offFrameLiveWorst: 0, offFrameReplay: 0, offFrameInfo: [], limitBreak: 0, nonFinite: 0, bandMin: 1, bandMax: 0,
    longestRally: 0, finished: 0, resets: 0, resetsOffCentre: 0, serveContact: [],
    slowmoFrames: 0, cameraSwitches: 0, timing: {}, sweet: [], stepInFrames: 0, edgeBalls: 0,
    contacts: 0, recentreX: [],
  };
  const GSX = X.GS;
  for (let mi = 0; mi < matches; mi++) {
    sandbox.rndSeed(700000 + mi * 7919);
    simNow = 0; timers.length = 0;
    let ui, game;
    try {
      ui = new X.UI();
      game = new X.Game(makeCanvas(mi % 2 ? 1280 : 720, mi % 2 ? 720 : 1280), ui);
      ui.attach(game);
      if (ui.bindCareer) ui.bindCareer();
      if (ui.bindOnline) ui.bindOnline();
    } catch (e) {
      out.throws.push({ where: 'boot', msg: String(e && e.message || e), stack: String(e && e.stack || '').split('\n').slice(1, 6).join('\n         ') });
      continue;
    }
    game.settings.targetScore = 5;
    try { game.startMatch(mi % 5); } catch (e) {
      out.throws.push({ where: 'startMatch', msg: String(e && e.message || e) }); continue;
    }
    out.matches++;
    /* Why do points actually end? awardPoint(who, reason) is the single funnel
     * every rule in the game goes through, so wrapping it turns an impression
     * ("the opponent keeps hitting into the net") into a count, and separates
     * a free point from a point the player lost by not reaching the ball. */
    try {
      const realAward = game.awardPoint.bind(game);
      game.awardPoint = (who, reason) => {
        /* The reason strings name the loser, not the hitter: 'ОШИБКА ПОДАЧИ'
         * says nothing about whose serve it was. lastHitBy at the moment of the
         * award does, so the tally is keyed by "who struck the ball that ended
         * the point" — the only form in which "the opponent keeps netting"
         * can be confirmed or refuted. */
        const by = game.ball.lastHitBy > 0 ? 'player' : game.ball.lastHitBy < 0 ? 'AI' : 'none';
        const key = String(reason || '?') + '  [last hit: ' + by + ']';
        const t = out.reasons[key] || (out.reasons[key] = { n: 0, toPlayer: 0, toAi: 0 });
        t.n++; if (who > 0) t.toPlayer++; else if (who < 0) t.toAi++;
        return realAward(who, reason);
      };
    } catch (e) { out.throws.push({ where: 'awardHook', msg: String(e && e.message || e) }); }
    let swipeT = 0, serveWait = 0, lastState = '', serveAge = 0, serveMin = 9;
    let gestF = -1, gestX = 0.5, gestY = 0.5, gestUp = 0.05;
    let rcOpen = false, rcAge = 0, rcMin = 9, rcTrace = [];
    let curShot = null, curShotT = -1;
    for (let f = 0; f < frames; f++) {
      const dt = 1 / 60;
      simNow += dt * 1000;
      drainTimers();

      /* ---- the bot: play off the game's own strike window ------------- *
       * The ring the player watches (#strike) is game._strike: it says where
       * the intercept is and how close to it the ball is. A human moves the
       * bat there early and flicks when the ring fills, so that is exactly
       * what the bot does — which also means the smoke test exercises the
       * positioning, the timing bands and the sweet spot, not just the idle
       * camera. */
      try {
        const w = game._strike;
        if (w && w.on) {
          const pr = game.project({ x: w.x, y: w.y, z: w.z }, {});
          if (pr && pr.ok) game.pointer = { x: clamp(pr.x, 0, 1), y: clamp(pr.y * 0.9 + 0.05, 0, 1) };
        } else {
          const pr = game.project(game.ball.p, {});
          if (pr && pr.ok) game.pointer = { x: clamp(pr.x, 0, 1), y: clamp(pr.y, 0, 1) };
        }
        if (serveWait > 0) serveWait--;
        const dir = ((mi * 37 + f) % 3 - 1) * 0.11;
        /* A real mouse does not press, drag and release inside one frame. The
         * swipe metric is integrated from samples stamped with game.time, and
         * the game only accepts a RELEASED gesture while swipeReleasedAt is
         * fresh — one of three fields the pointerup handler sets and a direct
         * swipe.up() call does not. Faking it in a single frame left every bot
         * contact a passive BLOCK: 26/26 shots, launch elev 0 deg, 5.6 km/h,
         * 0 % crossing the net, and 70 % of all points ending as "the ball did
         * not get over the net" — i.e. the end-to-end suite was measuring a
         * game nobody plays. Now the bot drags over 5 frames at ~3 units/s,
         * which is inside the range of the recorded human gestures. */
        /* Two separate acts, as for a human: a click starts the toss, and the
         * swing is timed off the strike window the game itself reports (which
         * covers serves — w.kind === 'serve' — as well as rallies). Swinging on
         * the click instead produced a gesture that had already expired by the
         * time the ball came down, and 30 % of the bot's serves were faults. */
        const wantServe = game.state === GSX.SERVE_READY && game.server === 1 && serveWait <= 0;
        const wantHit = !wantServe && !!(w && w.on && w.ready > 0.45);
        if (gestF < 0) {
          game.pointerDown = false;
          if (wantServe || (wantHit && swipeT <= 0)) {
            gestF = 0; gestUp = wantServe ? 0.055 : 0.050;
            gestX = game.pointer.x; gestY = game.pointer.y;
            game.pointerDown = true;
            /* a real pointerdown is what starts the toss; swiping alone does not */
            if (wantServe) { game.startToss(); serveWait = 30; continue; }
            game.swipe.down(gestX, gestY + gestUp * 2, game.time);
          }
        } else {
          gestF++;
          game.pointerDown = true;
          game.swipe.move(gestX + dir * 0.02 * gestF, gestY + gestUp * (2 - gestF), game.time);
          if (gestF >= 4) {
            game.swipe.up(gestX + dir * 0.08, gestY - gestUp * 2, game.time);
            game.pointerDown = false;
            game.swipeReleasedAt = game.time;   // <- what the real handler sets
            game.lastSwipeT = game.time;
            gestF = -1; swipeT = 10;
          }
        }
        if (swipeT > 0) swipeT--;
        if (f % 240 === 120) { game.setCameraPreset(X.CAMERA_ORDER[(mi + f / 240 | 0) % 4]); out.cameraSwitches++; }
        if (f % 400 === 200) game.setSlowmoHold(true);
        if (f % 400 === 260) game.setSlowmoHold(false);
        if (f % 900 === 700) { game.setPaused(true); }
        if (f % 900 === 720) { game.setPaused(false); }
      } catch (e) { out.throws.push({ where: 'input', msg: String(e && e.message || e) }); }

      /* ---- the frame the browser would run ---- */
      try { game.update(dt); } catch (e) {
        out.throws.push({ where: 'update@' + game.state, msg: String(e && e.message || e), stack: String(e && e.stack || '').split('\n')[1] || '' });
        break;
      }
      try { game.render(); } catch (e) { out.throws.push({ where: 'render', msg: String(e && e.message || e) }); break; }
      try { ui.tick(dt); } catch (e) { out.throws.push({ where: 'ui.tick', msg: String(e && e.message || e), stack: String(e && e.stack || '').split('\n')[1] || '' }); break; }
      out.frames++; out.cases++;
      out.states[game.state] = (out.states[game.state] || 0) + 1;
      if (game.slowmo && game.slowmo.active) out.slowmoFrames++;

      /* ---- invariants ---- */
      const pad = game.player, b = game.ball;
      const fin = (o) => Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z);
      if (!fin(pad.pos) || !fin(b.p) || (b.live && !fin(b.v)) ||
        !Number.isFinite(game.camPos.x) || !Number.isFinite(game.fov)) out.nonFinite++;
      const L = X.PADDLE_LIMITS;
      if (Math.abs(pad.pos.x) > L.x + 1e-3 || pad.pos.z < L.zStepIn - 1e-3 || pad.pos.z > L.zFar + 1e-3 ||
        pad.pos.y < PH.TABLE_Y + L.yLo - 1e-3 || pad.pos.y > PH.TABLE_Y + L.yHi + 1e-3) out.limitBreak++;
      if (game.camVPReady && game.state !== GSX.MENU) {
        const sp = X.projectPoint(game.camVP, pad.pos, {});
        if (sp.ok) {
          const over = Math.max(0.02 - sp.x, sp.x - 0.98, 0.02 - sp.y, sp.y - 0.98);
          if (over > 0) {
            out.offFrame++; out.offFrameWorst = Math.max(out.offFrameWorst, over);
            /* A replay owns the whole frame: physics is off, the bat pose comes
             * out of the recording and the camera is a filmmaker. "The bat must
             * never leave the screen" is an invariant about CONTROL, so it is
             * counted separately from the cinematic. */
            if (game.replayer && game.replayer.on) { out.offFrameReplay++; }
            else { out.offFrameLive++; out.offFrameLiveWorst = Math.max(out.offFrameLiveWorst, over); }
            if (out.offFrameInfo.length < 12) out.offFrameInfo.push({
              state: game.state, mode: game.cameraMode || game.camMode || '?', over: +over.toFixed(3),
              sx: +sp.x.toFixed(3), sy: +sp.y.toFixed(3),
              pad: { x: +pad.pos.x.toFixed(2), y: +(pad.pos.y - PH.TABLE_Y).toFixed(2), z: +pad.pos.z.toFixed(2) },
              stepIn: +(pad.stepIn || 0).toFixed(2), ball: { x: +b.p.x.toFixed(2), z: +b.p.z.toFixed(2) },
              recenter: +(game.recenterT || 0).toFixed(2), vpReady: !!game.camVPReady,
            });
          }
        } else if (out.offFrameInfo.length < 12) {
          out.offFrameInfo.push({ state: game.state, mode: '?', over: 9, note: 'projection not ok (behind camera)',
            pad: { x: +pad.pos.x.toFixed(2), y: +(pad.pos.y - PH.TABLE_Y).toFixed(2), z: +pad.pos.z.toFixed(2) } });
        }
      }
      if (game.hudBandY) { out.bandMin = Math.min(out.bandMin, game.hudBandY); out.bandMax = Math.max(out.bandMax, game.hudBandY); }
      if (game.rally > out.longestRally) out.longestRally = game.rally;
      if (game.state !== lastState) {
        if (game.state === GSX.SERVE_READY) { out.resets++; serveAge = 0; }
        /* The window that matters starts when the previous point ends, because
         * that is when the glide home is triggered — and it closes when the
         * serve is struck, because after that the bat legitimately follows the
         * ball (the toss assist). Judging "did it pass through the centre" on a
         * fixed slice of SERVE_READY either missed the serves that were started
         * on the first frame or, worse, counted the toss slide as a failure. */
        if (game.state === GSX.POINT || game.state === GSX.REPLAY) { rcOpen = true; rcAge = 0; rcMin = 9; }
        lastState = game.state;
      }
      if (rcOpen) {
        rcAge += dt;
        rcMin = Math.min(rcMin, Math.abs(pad.pos.x));
        if (rcTrace.length < 400) rcTrace.push({ age: +rcAge.toFixed(2), st: game.state,
          rc: +(game.recenterT || 0).toFixed(2), px: +pad.pos.x.toFixed(2),
          ptr: +game.pointer.x.toFixed(2), lhb: game.ball.lastHitBy,
          rep: !!(game.replayer && game.replayer.on) });
        /* "Struck" must mean struck LIVE. A replay owns update() and carries
         * the recorded lastHitBy of the point that just ended, so reading it
         * here closed the window on the first replay frame — before the glide
         * home had even started — and scored the bat's end-of-rally position as
         * a failure to re-centre. */
        const live = !(game.replayer && game.replayer.on) &&
          game.state !== GSX.POINT && game.state !== GSX.REPLAY;
        const struck = live && game.ball.lastHitBy !== 0;
        if (struck) {
          out.recentreX.push(rcMin);
          if (rcMin > 0.08) {
            out.resetsOffCentre++;
            if (out.rcFails.length < 3) out.rcFails.push({ min: +rcMin.toFixed(3), trace: rcTrace.slice(-26) });
          }
          rcOpen = false; rcMin = 9; rcTrace = [];
        } else if (rcAge > 5) {
          /* No serve followed inside 5 s: the match ended, or a replay ran
           * long. That is not a serve, so it is not a re-centring failure —
           * counting it here is what made the metric read 18/43 while the bat
           * was in fact going home on every real serve. */
          out.rcNoServe++;
          rcOpen = false; rcMin = 9; rcTrace = [];
        }
      }
      /* The window is "from the new point until the serve is struck", not
       * "0.60 s of SERVE_READY": a player (or this bot) can start the toss on
       * the very first frame, which used to drop the sample entirely and left
       * the metric judging a different population of serves than the one the
       * player experiences. */
      if (game.state === GSX.SERVE_READY) serveAge += dt;
      /* The bat glides back to the centre over ~0.55 s while the pointer is
         re-anchored, and after that it simply follows the cursor again — so
         judge it at 0.45 s, inside the re-centring window. */
      /* The honest question is "does the bat RETURN to the centre on a new
         point", not "where is it at one arbitrary instant": the bot teleports
         the cursor to the ball every frame, so any single sample after the
         re-centring window has decayed measures the bot, not the game. Track
         the closest the bat gets to the centre during the window. */

      /* evidence for the new gameplay mechanics */
      if (game.lastTiming) { out.timing[game.lastTiming] = (out.timing[game.lastTiming] || 0) + 1; game.lastTiming = ''; }
      if (game.lastSweet !== undefined && game.lastSweet !== null) {
        out.sweet.push(game.lastSweet); game.lastSweet = null;
      }
      if (pad.stepIn > 0.5) out.stepInFrames++;
      /* What the player's own hits actually look like: launch angle, pace and
       * whether the ball ever got to the far side. "МЯЧ НЕ ПЕРЕЛЕТЕЛ" being
       * 70 % of all points is only diagnosable from the shot itself. */
      const lsi = game.lastShotInfo;
      if (lsi && lsi.t !== curShotT) {
        curShotT = lsi.t;
        curShot = { elev: lsi.elev, speed: lsi.speed, sweet: lsi.sweet, quality: lsi.quality,
          stroke: lsi.stroke, timing: lsi.timing, crossed: false, minZ: game.ball.p.z };
        out.playerShots.push(curShot);
      }
      if (curShot && game.ball.live) {
        curShot.minZ = Math.min(curShot.minZ, game.ball.p.z);
        if (game.ball.p.z < 0) curShot.crossed = true;
      }
      if (game.state === GSX.POINT || game.state === GSX.SERVE_READY) curShot = null;
      out.edgeBalls = game.stats.edgeBalls || 0;
      if (game.state === GSX.MATCH_END) { out.finished++; break; }
    }
    out.points += game.score[0] + game.score[1];
    out.contacts += game.stats.shots || 0;
    if (game.ai && game.ai.lastShot && game.ai.lastShot.serveDepth) out.serveContact.push(game.ai.lastShot.serveDepth);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 *  runner
 * ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const only = arg('--suite', null);
const want = (s) => !only || only === s;
const t00 = Date.now();

console.log('TOPSPIN ARENA — analysis bench');
console.log('modules: ' + MODULES.join(', '));
console.log('');

if (want('physics')) RESULTS.physics = suitePhysics();
if (want('serve')) RESULTS.serve = suiteServe(+arg('--n', 120));
if (want('pserve')) RESULTS.pserve = suitePlayerServe(+arg('--pn', 400));
if (want('rally')) RESULTS.rally = suiteRally(+arg('--rn', 60));
if (want('camera')) RESULTS.camera = suiteCamera();
if (want('pointer')) RESULTS.pointer = suitePointer(+arg('--qn', 140));
if (want('passive')) RESULTS.passive = suitePassive();
if (want('aireturn')) RESULTS.aireturn = suiteAiReturn(+arg('--an', 60));
if (want('miss')) RESULTS.miss = suiteMiss(+arg('--mn', 24));
if (want('fuzz')) RESULTS.fuzz = suiteFuzz(+arg('--fn', 900));
if (want('reach')) RESULTS.reach = suiteReach();
if (want('bounce')) RESULTS.bounce = suiteBounce();
if (want('cork')) RESULTS.cork = suiteCork();
if (want('smoke')) RESULTS.smoke = suiteSmoke(+arg('--sn', 6), +arg('--frames', 5400));

CASES = Object.values(RESULTS).reduce((s, r) => s + (r.cases || 0), 0);

/* ---------------------------- reporting ---------------------------- */
function hr(t) { console.log('\n' + '='.repeat(78) + '\n' + t + '\n' + '='.repeat(78)); }

if (RESULTS.physics) {
  const p = RESULTS.physics;
  hr('1. PHYSICS INVARIANTS  (' + p.cases + ' cases)');
  console.log(`  ITTF drop test 30/30.5 cm  -> rebound ${f1(p.ittfDrop.min)}..${f1(p.ittfDrop.max)} cm (med ${f1(p.ittfDrop.med)})  window 23..26  ${p.ittfPass ? 'PASS' : 'FAIL'}`);
  console.log(`  same drop, ball spinning ±200 rad/s -> rebound ${f1(p.ittfSpinDrop.min)}..${f1(p.ittfSpinDrop.max)} cm (the bounce steals height and throws it sideways)`);
  console.log(`  energy growth in flight    -> ${p.energyGrow} / 200 flights  (must be 0)`);
  console.log(`  NaN in flight integration  -> ${p.nan}`);
  console.log(`  spin above cap after impact-> ${p.spinOverCap} / 200   max ${(p.maxSpinRad / (2 * Math.PI)).toFixed(0)} rev/s (cap 172)`);
  console.log(`  hostile inputs producing NaN/throw -> ${p.hostileBad} / 36`);
}

if (RESULTS.serve) {
  hr('2. OPPONENT SERVE  (' + RESULTS.serve.cases + ' cases)');
  console.log('  level      legal  invalid  net   own   speed km/h med[p05..p95]  2nd bounce z med[p05..p95]  short  REACH  window  solve ms');
  for (const r of RESULTS.serve.perLevel) {
    console.log(`  ${r.level.padEnd(10)} ${pc(r.legal).padStart(6)} ${pc(r.invalidFirstPass).padStart(7)} ${pc(r.netted).padStart(6)} ${pc(r.ownFault).padStart(5)}` +
      `   ${f1(r.speedKmh.med).padStart(5)} [${f1(r.speedKmh.p05)}..${f1(r.speedKmh.p95)}]`.padEnd(24) +
      `   ${f2(r.b2z.med).padStart(5)} [${f2(r.b2z.p05)}..${f2(r.b2z.p95)}]`.padEnd(26) +
      ` ${pc(r.shortServe).padStart(6)} ${pc(r.reachable).padStart(6)}  ${f2(r.windowS.med).padStart(4)}s   ${f1(r.solveMs.med)}`);
    console.log(`      |spin| as a fraction of the 1080 rad/s cap:  w.x ${f2(r.spinX.med)}  w.y ${f2(r.spinY.med)}  w.z ${f2(r.spinZ.med)} (w.z is the axis the table answers sideways)` +
      `   sideways throw off the table: med ${f1(r.kickCm.med)} cm  p95 ${f1(Math.abs(r.kickCm.p95))} cm`);
    for (const a of r.byArch) {
      console.log(`       ${a.arch.padEnd(12)} ${(a.share * 100).toFixed(0).padStart(3)}% of serves  ` +
        `${f1(a.kmh.med).padStart(5)} km/h [${f1(a.kmh.p05)}..${f1(a.kmh.p95)}]  swingScale ${f2(a.scale.med)}` +
        `  w.z ${f2(a.wz.med)} [${f2(a.wz.p05)}..${f2(a.wz.p95)}]  w.y ${f2(a.wy.med)}`);
    }
  }
}

if (RESULTS.pserve) {
  hr('3. PLAYER SERVE  (' + RESULTS.pserve.cases + ' cases)');
  for (const r of RESULTS.pserve.rows) {
    console.log(`  ${r.gesture.padEnd(12)} assist ${r.assist.toFixed(2)}  legal ${pc(r.legal).padStart(6)}  speed med ${f1(r.speedKmh.med).padStart(5)} km/h  2nd bounce z med ${f2(r.b2z.med)}  solve med ${f1(r.ms.med)} ms  p95 ${f1(r.ms.p95)} ms`);
  }
}

if (RESULTS.rally) {
  hr('4. PLAYER RALLY SHOTS  (' + RESULTS.rally.cases + ' cases)');
  for (const r of RESULTS.rally.byAssist) {
    console.log(`  assist ${r.assist.toFixed(2)}  on table ${pc(r.onTable).padStart(6)}  net ${pc(r.net).padStart(6)}  own half ${pc(r.own).padStart(6)}  wide ${pc(r.wide).padStart(6)}  speed med ${f1(r.speedKmh.med)} km/h  spin med ${f1(r.spinRps.med)} rev/s`);
  }
  console.log('  solver cost: med ' + f1(RESULTS.rally.solverMsStat.med) + ' ms  p95 ' + f1(RESULTS.rally.solverMsStat.p95) + ' ms  max ' + f1(RESULTS.rally.solverMsStat.max) + ' ms');
  console.log('  per archetype (assist 1.0 rows are the last entries):');
  for (const [k, v] of Object.entries(RESULTS.rally.byStroke)) {
    console.log(`    ${k.padEnd(11)} n=${String(v.n).padStart(4)}  onTable ${pc(v.onTable / v.n).padStart(6)}  net ${pc(v.net / v.n).padStart(6)}  own ${pc(v.own / v.n).padStart(6)}  speed med ${f1(stat(v.speed).med)} km/h  spin med ${f1(stat(v.spin).med)} rev/s`);
  }
}

if (RESULTS.camera) {
  hr('5. CAMERA FRAMING  (' + RESULTS.camera.cases + ' projected points)');
  const byMode = {};
  for (const r of RESULTS.camera.rows) {
    const k = r.mode;
    byMode[k] = byMode[k] || { worstMargin: 1e9, offTable: 0, offPaddle: 0, offStep: 0, nStep: 0, tableTopY: 1e9, aspects: {} };
    const b = byMode[k];
    b.worstMargin = Math.min(b.worstMargin, r.margin);
    b.offTable += r.offTable; b.offPaddle += r.offPaddle;
    b.offStep += r.offStep || 0; b.nStep += r.nStep || 0;
    b.tableTopY = Math.min(b.tableTopY, r.tableTopY);
    b.aspects[r.aspect] = { margin: +r.margin.toFixed(3), offTable: r.offTable, offPaddle: r.offPaddle, tableTopY: +r.tableTopY.toFixed(3), worst: r.worstKind };
  }
  for (const [k, b] of Object.entries(byMode)) {
    console.log(`  ${k.padEnd(10)} worst on-screen margin ${f2(b.worstMargin)}  table/net points outside frame ${b.offTable}  paddle-volume outside ${b.offPaddle}  STEP-IN plane outside ${b.offStep}/${b.nStep}  highest table pixel (min over aspects) y=${f2(b.tableTopY)}`);
    for (const [a, v] of Object.entries(b.aspects)) {
      console.log(`      ${a.padEnd(16)} margin ${f2(v.margin).padStart(6)}  off(table/paddle) ${v.offTable}/${v.offPaddle}  tableTopY ${f2(v.tableTopY)}  worst:${v.worst}`);
    }
  }
}

if (RESULTS.pointer) {
  hr('6. POINTER → PADDLE  (' + RESULTS.pointer.cases + ' cases · 4 rigs × 8 aspects × 4 sensitivities)');
  console.log('  Pointer positions are sampled from -0.35..1.35 of the window, i.e. including');
  console.log('  a cursor dragged off the edge. "raw" is what the pointer map asks for before');
  console.log('  the clamp, "on screen" is what the player actually sees. Both are the shipped path.');
  console.log('');
  console.log('  rig          sens   raw off-frame   AFTER CLAMP off-frame   worst overshoot');
  const P = RESULTS.pointer;
  const agg = {};
  for (const r of P.rows) {
    const k = r.mode + '|' + r.sens;
    const a = agg[k] || (agg[k] = { mode: r.mode, sens: r.sens, raw: 0, off: 0, n: 0, worst: 0 });
    a.raw += r.rawOff; a.off += r.offscreen; a.n++; a.worst = Math.max(a.worst, r.worst);
  }
  for (const k of Object.keys(agg)) {
    const a = agg[k];
    console.log(`  ${a.mode.padEnd(12)} ${a.sens.toFixed(1)}   ${(a.raw / a.n * 100).toFixed(1).padStart(8)} %   ` +
      `${(a.off / a.n * 100).toFixed(2).padStart(16)} %   ${f2(a.worst)}`);
  }
  const homeBad = P.home.filter((h) => h.homeMargin < 0.05);
  console.log(`\n  TOTAL after clamp: ${P.offscreen} / ${P.cases} off-frame (before clamp: ${(P.rawOff / P.cases * 100).toFixed(1)} %)   worst ${f2(P.worstOff)}`);
  console.log(`  clamp anchor (centred bat) margin < 5 % of screen in ${homeBad.length} / ${P.home.length} rig×aspect cells` +
    (homeBad.length ? ': ' + homeBad.map((h) => h.mode + '@' + h.aspect).join(', ') : ' — the anchor is always usable'));
}

if (RESULTS.passive) {
  hr('7. PASSIVE CONTACT — does the visible face decide?  (' + RESULTS.passive.cases + ' cases)');
  console.log('  A block with the bat turned to the given yaw. "lateral error" is the angle');
  console.log('  between where the ball actually goes and where the face you can see points it.');
  console.log('');
  console.log('  face            in    |      BEFORE the fix      |        SHIPPED');
  console.log('  yaw    tilt  km/h    |  dot   lat.err  out.x    |  dot   lat.err  out.x  lift  lands on opponent half');
  for (const r of RESULTS.passive.rows) {
    const L = typeof r.now.lands === 'string' ? r.now.lands : `${r.now.lands.x.toFixed(2)}, ${r.now.lands.z.toFixed(2)}`;
    const srt = RESULTS.passive.rows;
    console.log(`  ${(r.yawDeg + '°').padStart(5)} ${(r.tiltDeg + '°').padStart(6)} ${(r.pace * 3.6).toFixed(0).padStart(5)}    |` +
      ` ${r.old.dot.toFixed(3)}   ${r.old.errDeg.toFixed(0).padStart(5)}° ${r.old.outX.toFixed(2).padStart(7)}    |` +
      ` ${r.now.dot.toFixed(3)}   ${r.now.errDeg.toFixed(0).padStart(5)}° ${r.now.outX.toFixed(2).padStart(7)} ${(r.now.lift + '°').padStart(5)}  ${L}`);
  }
  const q = (k) => RESULTS.passive.rows.map((r) => r[k].errDeg).sort((a, b) => a - b);
  const medOld = q('old')[Math.floor(q('old').length / 2)], medNow = q('now')[Math.floor(q('now').length / 2)];
  const maxNow = q('now')[q('now').length - 1];
  const backOld = RESULTS.passive.rows.filter((r) => r.old.outZ > 0).length;
  const backNow = RESULTS.passive.rows.filter((r) => r.now.outZ > 0).length;
  console.log(`\n  median lateral error ${medOld.toFixed(0)}° -> ${medNow.toFixed(0)}°  (worst shipped ${maxNow.toFixed(0)}°)`);
  console.log(`  blocks that sent the ball BACKWARDS towards the player: ${backOld} / ${RESULTS.passive.rows.length} -> ${backNow} / ${RESULTS.passive.rows.length}`);
}

if (RESULTS.aireturn && RESULTS.aireturn.netcord) {
  const c = RESULTS.aireturn.netcord;
  console.log(`\n  NET CORD — a ball that clips the tape, run through the game's own clipTape (${c.n} cases):`);
  console.log(`     dribbles over onto your half ${pc(c.over)}    RETURNABLE ${pc(c.returnable)}    died short ${pc(c.diedShort)}    outside the bat box ${pc(c.outBox)}    step-in too late ${pc(c.stepLate)}    back into the net ${pc(c.netFault)}    never arrived ${pc(c.neverArrived)}`);
  console.log(`     lands past the net med ${f2(c.landZ.med)} m [${f2(c.landZ.p05)}..${f2(c.landZ.p95)}]    time to the step-in plane med ${c.ttcStep.med.toFixed(2)} s [${c.ttcStep.p05.toFixed(2)}..${c.ttcStep.p95.toFixed(2)}]    height there med ${f2(c.yStep.med)} m over the table`);
}

if (RESULTS.aireturn) {
  hr('8. OPPONENT RETURNS  (' + RESULTS.aireturn.cases + ' cases)');
  for (const r of RESULTS.aireturn.perLevel) {
    console.log(`  ${r.level.padEnd(12)} n=${String(r.n).padStart(3)}  onTable ${pc(r.onTable).padStart(6)}  net ${pc(r.net).padStart(6)}  long ${pc(r.long).padStart(6)}  wide ${pc(r.wide).padStart(6)}  speed med ${f1(r.speedKmh.med)} [${f1(r.speedKmh.p05)}..${f1(r.speedKmh.p95)}] km/h  spin med ${f1(r.spinRps.med)} rev/s  solve med ${f1(r.ms.med)} ms`);
    console.log(`     CAN THE PLAYER RETURN IT?   returnable ${pc(r.returnable)}   too fast at home ${pc(r.tooFast)}   step-in too late ${pc(r.stepLate)}   died short ${pc(r.diedShort)}   outside box ${pc(r.outBox)}   never arrived ${pc(r.neverArrived)}   net fault ${pc(r.netFault)}`);
    console.log(`     time to the bat at home med ${r.ttc.med.toFixed(2)} s [${r.ttc.p05.toFixed(2)}..${r.ttc.p95.toFixed(2)}]   landing depth past the net med ${f2(r.landZ.med)} m [${f2(r.landZ.p05)}..${f2(r.landZ.p95)}]`);
  }
}

if (RESULTS.fuzz) {
  hr('9. GESTURE FUZZ  (' + RESULTS.fuzz.cases + ' cases)');
  console.log(`  exceptions ${RESULTS.fuzz.exceptions}   non-finite stroke output ${RESULTS.fuzz.nan}`);
  const cl = Object.entries(RESULTS.fuzz.classifier).sort((a, b) => b[1] - a[1]);
  console.log('  classifier histogram: ' + cl.map(([k, v]) => `${k}=${v}`).join('  '));
}

if (RESULTS.bounce) {
  const B = RESULTS.bounce;
  hr('12. HOW THE TABLE ANSWERS SPIN  (' + B.cases + ' cases)');
  console.log('  in: speed / dip below horizontal / spin.  out: what the bounce did to it.');
  console.log('  dSpeed% > 0 = the ball ACCELERATES out of the table (topspin does this).');
  console.log('  lateral = sideways drift in the 0.45 s after the bounce, in cm.');
  console.log('');
  for (const speed of [4, 8, 12]) {
    for (const dip of [15, 30]) {
      console.log(`  incoming ${speed} m/s, ${dip} deg below horizontal`);
      console.log('    spin                     dSpeed%   angle in->out    lateral cm   vx kick   slip');
      for (const r of B.rows.filter((q) => q.speed === speed && q.dipDeg === dip)) {
        console.log(`    ${r.spin.padEnd(22)} ${r.dSpeedPct.toFixed(1).padStart(7)} %   ` +
          `${r.angIn.toFixed(0).padStart(4)} -> ${r.angOut.toFixed(0).padStart(3)} deg   ${(r.lateral * 100).toFixed(1).padStart(8)}   ${r.vxKick.toFixed(2).padStart(6)}   ${r.slipped ? 'yes' : 'grip'}`);
      }
    }
  }
  console.log('');
  console.log('  FRICTION CALIBRATION (A/B on PH.MU_TABLE and PH.ET_TABLE):');
  console.log('    dSpeed% of a heavy loop / heavy chop out of the table, lateral cm of a corkscrew.');
  console.log('    ittf = dead-ball rebound, must stay inside 23..26 cm.');
  console.log('    mu    et   ittf   top@8   top@12  back@4  back@8   cork@8 lat   vert@8 lat');
  for (const c of B.calib) {
    const f = (o, k) => (o ? o[k].toFixed(1) : ' — ');
    console.log(`    ${c.mu.toFixed(2)}  ${c.et.toFixed(2)}  ${c.ittf.toFixed(1)}  ` +
      `${f(c.top8, 'dPct').padStart(6)}%  ${f(c.top12, 'dPct').padStart(6)}%  ${f(c.back4, 'dPct').padStart(6)}%  ${f(c.back8, 'dPct').padStart(6)}%` +
      `   ${f(c.cork8, 'lat').padStart(6)}     ${f(c.vert8, 'lat').padStart(6)}`);
  }
  console.log('');
  console.log('  EDGE BALL (same shot, different contact point on the table):');
  console.log('    where it landed        edge k  axis   out speed  out angle     vx      vz');
  for (const e of B.edgeRows) {
    console.log(`    ${e.label.padEnd(20)} ${e.k.toFixed(2).padStart(6)}  ${String(e.axis).padStart(4)}   ${e.speedOut.toFixed(2).padStart(8)}  ${e.angOut.toFixed(0).padStart(7)} deg ${e.vx.toFixed(2).padStart(7)} ${e.vz.toFixed(2).padStart(7)}`);
  }
}

if (RESULTS.miss) {
  const M = RESULTS.miss;
  hr('14. COST OF AN OFF-CENTRE CONTACT  (' + M.cases + ' shots, assist 0.72)');
  let lastT = '';
  for (const r of M.rows) {
    if (r.timing !== lastT) { console.log(`  timing ${r.timing}`); lastT = r.timing; }
    console.log(`    ${r.dir.padEnd(18)} sweet ${r.sweet.toFixed(2)}  n=${String(r.n).padStart(3)}  onTable ${pc(r.onTable).padStart(6)}  NET ${pc(r.net).padStart(6)}  own half ${pc(r.own).padStart(6)}  wide ${pc(r.wide).padStart(6)}   launch elev med ${f1(r.elevMed)} deg   speed med ${f1(r.speedMed)} km/h`);
  }
}

if (RESULTS.cork) {
  const C = RESULTS.cork;
  hr('13. CAN THE STROKE MODEL MAKE A CORKSCREW SERVE?  (' + C.cases + ' raw contacts)');
  console.log('  Raw frame, no solver: face azimuth x face elevation x swing azimuth.');
  console.log('  w.z is the component the table answers sideways; it is what a real');
  console.log('  sidespin serve is made of. Fractions of the 1080 rad/s cap.');
  const best = C.rows.filter((r) => r.legal).sort((a, b) => Math.abs(b.wz) - Math.abs(a.wz)).slice(0, 12);
  console.log('  (sorted among LEGAL frames only — an illegal frame is not an option)');
  console.log('    azFace  elev  azSw   |   w.x     w.y     w.z   |  km/h  legal  b2 z');
  for (const r of best) {
    console.log(`    ${(r.azFace / DEG).toFixed(0).padStart(5)}° ${(r.elev + '°').padStart(5)} ${(r.azSwing.toFixed(2)).padStart(5)}   |` +
      ` ${r.wx.toFixed(3)}  ${r.wy.toFixed(3)}  ${r.wz.toFixed(3)}  | ${r.speed.toFixed(0).padStart(4)}  ${r.legal ? 'yes' : 'NO '}  ${r.b2 === null ? '  —  ' : r.b2.toFixed(2)}`);
  }
  console.log('');
  console.log('  THE SPIN DIAL (same gesture, same incoming ball, only the setting differs):');
  console.log('    setting    face contact   ball speed        spin');
  for (const d of C.dial) {
    console.log(`    ${d.bias.padEnd(9)} ${d.contact.med.toFixed(0).padStart(6)} deg   ` +
      `${f1(d.speed.med).padStart(5)} km/h [${f1(d.speed.p05)}..${f1(d.speed.p95)}]   ` +
      `${f1(d.spin.med).padStart(5)} rev/s [${f1(d.spin.p05)}..${f1(d.spin.p95)}]`);
  }
  const lo = C.dial[0], hi = C.dial[2];
  console.log(`    low -> high: spin ${((hi.spin.med / Math.max(0.001, lo.spin.med) - 1) * 100).toFixed(0)} %, speed ${((hi.speed.med / lo.speed.med - 1) * 100).toFixed(0)} %`);

  const legalRows = C.rows.filter((r) => r.legal);
  const maxWzLegal = legalRows.reduce((m, r) => Math.max(m, Math.abs(r.wz)), 0);
  const maxWyLegal = legalRows.reduce((m, r) => Math.max(m, Math.abs(r.wy)), 0);
  console.log(`\n  legal frames ${legalRows.length} / ${C.rows.length}   max |w.z| among legal ${maxWzLegal.toFixed(3)} of cap   max |w.y| ${maxWyLegal.toFixed(3)}`);
}

if (RESULTS.smoke) {
  const k = RESULTS.smoke;
  hr('11. SMOKE — whole matches played headlessly  (' + k.cases + ' frames)');
  console.log(`  matches booted ${k.matches}   frames simulated ${k.frames}   matches that reached MATCH_END ${k.finished}`);
  console.log(`  exceptions thrown anywhere in update/render/ui.tick/input: ${k.throws.length}`);
  for (const t of k.throws.slice(0, 8)) console.log(`      [${t.where}] ${t.msg}${t.stack ? '  @ ' + t.stack.trim() : ''}`);
  console.log(`  non-finite state (bat, ball, camera, fov)  -> ${k.nonFinite} frames`);
  console.log(`  bat outside its authored volume            -> ${k.limitBreak} frames`);
  console.log(`  BAT OFF SCREEN while you control it        -> ${k.offFrameLive} frames (${(100 * k.offFrameLive / Math.max(1, k.frames)).toFixed(2)} %), worst ${f2(k.offFrameLiveWorst)} of the screen`);
  console.log(`  bat off screen during a replay (cinema)    -> ${k.offFrameReplay} frames, worst ${f2(k.offFrameWorst)}`);
  for (const f of k.rcFails) {
    console.log(`  re-centring failure (closest ${f.min} m):`);
    for (const t of f.trace.slice(0, 10)) console.log(`      head ${JSON.stringify(t)}`);
    for (const t of f.trace.slice(-6)) console.log(`      tail ${JSON.stringify(t)}`);
  }
  if (k.offFrameInfo.length) {
    console.log('  first off-screen frames:');
    for (const i of k.offFrameInfo) console.log(`      ${JSON.stringify(i)}`);
  }
  console.log(`  HUD band (--band-y) seen between           -> ${f2(k.bandMin)} .. ${f2(k.bandMax)} of the viewport height`);
  const rx = k.recentreX.slice().sort((a, b) => a - b);
  if (rx.length) console.log(`     closest approach to the centre before the strike: med ${rx[Math.floor(rx.length / 2)].toFixed(3)} m, p90 ${rx[Math.floor(rx.length * 0.9)].toFixed(3)} m`);
  const rxD = k.recentreX.slice().sort((a, b) => b - a);
  console.log(`  bat returns to the centre on a new point   -> ${k.recentreX.length - k.resetsOffCentre} / ${k.recentreX.length} windows (from the point ending to the serve being struck; ${k.resets} SERVE_READY entries, ${k.rcNoServe} windows where no serve followed)` +
    (rxD.length ? `   worst closest-approach ${rxD[0].toFixed(3)} m of a 1.02 m half-width` : ''));
  console.log(`  player contacts ${k.contacts}   edge balls ${k.edgeBalls}   frames stepping in for a short ball ${k.stepInFrames}`);
  if (k.sweet.length) {
    const sw = k.sweet.slice().sort((a, b) => a - b);
    console.log(`  sweet-spot quality of those contacts: p10 ${sw[Math.floor(sw.length * 0.1)].toFixed(2)}  med ${sw[Math.floor(sw.length / 2)].toFixed(2)}  rim hits (<0.42) ${(100 * sw.filter((x) => x < 0.42).length / sw.length).toFixed(0)} %`);
  }
  const tk = Object.keys(k.timing).sort((a, b) => k.timing[b] - k.timing[a]);
  if (tk.length) console.log('  timing verdicts: ' + tk.map((x) => `${x}=${k.timing[x]}`).join('  '));
  console.log(`  points awarded ${k.points}   longest rally ${k.longestRally}   camera switches ${k.cameraSwitches}   slow-mo frames ${k.slowmoFrames}`);
  if (k.playerShots.length) {
    const ps = k.playerShots;
    const el = stat(ps.map((r) => r.elev)), sp = stat(ps.map((r) => r.speed)),
      qu = stat(ps.map((r) => r.quality || 0)), sw = stat(ps.map((r) => r.sweet === undefined ? 1 : r.sweet));
    const crossed = ps.filter((r) => r.crossed).length;
    console.log(`  PLAYER'S OWN HITS (${ps.length}): crossed to the far side ${crossed} (${(100 * crossed / ps.length).toFixed(0)} %), never crossed ${ps.length - crossed}`);
    console.log(`     launch elev med ${f1(el.med)} deg [${f1(el.p05)}..${f1(el.p95)}]   below 10 deg ${(100 * ps.filter((r) => r.elev < 10).length / ps.length).toFixed(0)} %   ball speed med ${f1(sp.med)} km/h [${f1(sp.p05)}..${f1(sp.p95)}]`);
    console.log(`     quality med ${f2(qu.med)}   sweet med ${f2(sw.med)}   strokes: ` +
      Object.entries(ps.reduce((a, r) => { const kk = (r.stroke && r.stroke.id) || '?'; a[kk] = (a[kk] || 0) + 1; return a; }, {}))
        .sort((a, b) => b[1] - a[1]).map(([kk, v]) => `${kk}=${v}`).join(' '));
    const byCross = {};
    for (const r of ps) { const kk = (r.stroke && r.stroke.id) || '?'; const c = byCross[kk] || (byCross[kk] = [0, 0]); c[0]++; if (r.crossed) c[1]++; }
    console.log('     crossed by stroke: ' + Object.entries(byCross).map(([kk, v]) => `${kk} ${v[1]}/${v[0]}`).join('  '));
  }
  const rk = Object.keys(k.reasons).sort((a, b) => k.reasons[b].n - k.reasons[a].n);
  if (rk.length) {
    const tot = rk.reduce((a, x) => a + k.reasons[x].n, 0);
    console.log(`  WHY EVERY POINT ENDED (${tot} points):`);
    for (const x of rk) {
      const r = k.reasons[x];
      console.log(`      ${x.padEnd(46)} ${String(r.n).padStart(4)}  (${(100 * r.n / tot).toFixed(0).padStart(2)} %)   point to: player ${r.toPlayer} / opponent ${r.toAi}`);
    }
  }
  const st = Object.keys(k.states).sort((a, b) => k.states[b] - k.states[a]);
  console.log('  frames per state: ' + st.map((x) => `${x}=${k.states[x]}`).join('  '));
}

if (RESULTS.reach) {
  hr('10. REACH MAP  (' + RESULTS.reach.cases + ' grid cells)');
  const rows = RESULTS.reach.rows.filter((r, i) => i % 4 === 0 || r.z > 1.1);
  console.log('  z (from net)   coverage of the half-width the bat can be at');
  for (const r of rows) console.log(`    ${r.z.toFixed(2)} m       ${pc(r.coverage)}`);
  console.log(`  uncovered cells inside the player's half: ${RESULTS.reach.uncoveredShort} / ${RESULTS.reach.grid}`);
  console.log(`  centred paddle projects to screen (${f2(RESULTS.reach.paddleScreen.x)}, ${f2(RESULTS.reach.paddleScreen.y)})`);
}

hr('TOTAL: ' + CASES + ' analysis cases in ' + ((Date.now() - t00) / 1000).toFixed(1) + ' s');

const j = arg('--json', null);
if (j) { fs.writeFileSync(j, JSON.stringify({ cases: CASES, ms: Date.now() - t00, results: RESULTS }, null, 1)); console.log('json -> ' + j); }
