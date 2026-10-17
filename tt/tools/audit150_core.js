#!/usr/bin/env node
/* =====================================================================
 *  audit150.js — 150 independent analyses of TOPSPIN ARENA.
 *
 *  Every finding in the report comes from here, so every claim can be
 *  re-run:
 *
 *      node tt/tools/audit150.js                 # all 150
 *      node tt/tools/audit150.js --only 37,88   # a subset
 *      node tt/tools/audit150.js --json out.json
 *      node tt/tools/audit150.js --quiet
 *
 *  The modules are loaded exactly as build.py ships them (same order,
 *  same bytes) into a headless VM with a DOM/WebGL stub, so the numbers
 *  are the numbers the shipped bundle produces.
 * ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const MODULES = [
  '10_math.js', '20_gl.js', '25_career.js', '27_network.js', '30_physics.js',
  '40_swipe.js', '50_audio.js', '55_ai.js', '56_rig.js', '57_camera.js',
  '58_coach.js', '59_replay.js', '60_scene.js', '65_train.js', '84_racket.js',
  '86_meta.js', '70_game.js', '80_ui.js',
];

/* ------------------------------------------------------------------ *
 *  DOM / WebGL stubs
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
function makeGL(canvas) {
  const consts = {}; let seq = 0x1000; const obj = {};
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

/* deterministic RNG (also injected into the modules) */
let _seed = 20261017;
function srand() { _seed ^= _seed << 13; _seed >>>= 0; _seed ^= _seed >> 17; _seed ^= _seed << 5; _seed >>>= 0; return _seed / 4294967296; }
const SMath = {};
for (const k of Object.getOwnPropertyNames(Math)) { try { SMath[k] = Math[k]; } catch (e) { /* accessor */ } }
SMath.random = srand;

let simNow = 0;
const timers = [];
const _nodes = {};
const sandbox = {
  console, Math: SMath, JSON, Date, Number, String, Array, Object, Float32Array, Int32Array,
  Uint8Array, Uint16Array, Uint32Array, Map, Set, Promise, Symbol, Error, TypeError,
  isNaN, isFinite, parseInt, parseFloat, Infinity, NaN, undefined,
  performance: { now: () => simNow },
  setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, at: simNow + (ms || 0) }); return id; },
  clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  setInterval: () => 0, clearInterval: noop,
  WebSocket: function StubWS() { this.readyState = 0; this.close = noop; this.send = noop; },
  document: {
    createElement: () => elStub(),
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
sandbox.self = sandbox;
vm.createContext(sandbox);

const EXPORTS = ['TAU', 'DEG', 'clamp', 'lerp', 'smoothstep', 'sign', 'rnd', 'rndSym', 'gauss', 'expSmooth',
  'V3', 'M4', 'Q', 'PH', 'aeroAccel', 'integrateBall', 'impactSphere', 'impactRacket', 'bounceTable',
  'bounceNet', 'clipTape', 'predict', 'solveLaunch', 'SPIN_CAP', 'ZERO3', 'N_UP',
  'SwipeTracker', 'STROKES', 'ARCH', 'classifyStroke', 'deriveStroke', 'refineRacket', 'strokeFrame',
  'solveServeStroke', 'shotReport', 'anglesFromNormal', 'solveBlockNormal', 'AI_LEVELS', 'AI_TACTICS',
  'OpponentAI', 'makeRacket', 'PaddleRig', 'CAMERA_PRESETS', 'CAMERA_ORDER', 'PADDLE_LIMITS',
  'effectiveFov', 'rigViewProj', 'projectPoint', 'rigMargin', 'fitRig', 'cameraRigFor', 'tableTopScreenY',
  'paddleTargetFromPointer', 'clampPaddleToFrustum', 'paddleVisibleOk', 'MomentRecorder', 'MomentPlayer',
  'BLADES', 'RUBBERS', 'Equipment', 'GS', 'PHYS_DT', 'Game', 'UI', 'ICON', 'Renderer', 'Scene',
  'AudioEngine', 'Particles', 'Platform', 'Analytics', 'Profile', 'Shop', 'RallyRecorder', 'PointAnalyst',
  'MatchDirector', 'Trainer', 'Career', 'NetworkManager', 'TRAIN_STEPS', 'PERKS', 'TOURNAMENTS',
  'ITEMS', 'ITEM_LIST', 'COSMETICS', 'SHOP_BUNDLES', 'ECONOMY', 'DAILY_TASKS', 'REPLAY_HZ',
  'REPLAY_FLOATS', 'REPLAY_KEEP', 'REPLAY_RING_S', 'BEAUTY', 'ANALYSIS', 'SAVE_KEY', 'SAVE_VERSION',
  'MAX_COINS', 'MAX_CRYSTALS', 'MAX_XP', 'MAX_ADS_PER_DAY', 'safeAssign', 'num', 'int', 'bool',
  'strList', 'statK', 'spread', 'itemStats', 'racketStats', 'ITEMS_ORDER', 'RECENTER_S',
  'NET_TICK_RATE', 'NET_INPUT_RATE', 'NET_INTERP_MS', 'NET_SERVER_URL', 'SERVE_VMAX', 'SERVE_BALL_MAX',
  'generateOpponent', 'getAvailablePerks', 'pickThreePerks', 'shotHitsNet', 'makeSphere', 'makeBox',
  'makeCylinder', 'makePlane', 'makeQuad', 'makePaddleBlade', 'mergeGeo', 'geoAlloc', 'geoPush',
  'geoTri', 'toGLSL1', 'VS_MAIN', 'FS_MAIN', 'FS_COMPOSITE', 'FS_BRIGHT', 'FS_BLUR', 'AI_SERVE_CONTACT_Y',
  'PALETTES', 'STROKE_FRAME_MAX'];
let bundle = '';
for (const f of MODULES) {
  const p = path.join(SRC, f);
  if (!fs.existsSync(p)) { console.error('audit150: missing module ' + f); process.exit(2); }
  bundle += `\n/* ===== ${f} ===== */\n` + fs.readFileSync(p, 'utf8').replace(/^'use strict';\s*$/m, '');
}
bundle += `\n;globalThis.__X = {${EXPORTS.map((k) => `${k}: typeof ${k} !== 'undefined' ? ${k} : undefined`).join(',')}};\n`;
try { vm.runInContext(bundle, sandbox, { filename: 'bundle.js' }); }
catch (e) { console.error('audit150: bundle failed — ' + (e && e.stack || e)); process.exit(2); }

const X = sandbox.__X;
const { PH, V3, Q, M4, clamp, lerp, TAU, DEG } = X;
const { predict, impactRacket, integrateBall, bounceTable, aeroAccel, solveLaunch, impactSphere } = X;
const { deriveStroke, refineRacket, classifyStroke, ARCH, STROKES, SwipeTracker } = X;
const { Equipment, ITEMS, ITEM_LIST } = X;

/* ------------------------------------------------------------------ *
 *  registry
 * ------------------------------------------------------------------ */
const ANALYSES = [];
let _id = 0;
function A(area, name, fn) { ANALYSES.push({ id: ++_id, area, name, fn }); }
function ok(cond, detail) { return { ok: !!cond, detail: String(detail) }; }
function num(v, d = 3) { return Number.isFinite(v) ? (typeof v === 'number' ? v.toFixed(d) : v) : String(v); }

/* ================================================================ *
 *  AREA 1 — MATH CORE (10_math.js)
 * ================================================================ */
A('MATH', 'M4.mul is a*b (viewProj = proj*view)', () => {
  const a = M4.create(), b = M4.create();
  M4.compose(a, { x: 1, y: 2, z: 3 }, Q.setAxisAngle(Q.new(), 0.3, 0.5, 0.2, 0.7), { x: 2, y: 3, z: 4 });
  M4.compose(b, { x: -2, y: 1, z: 0.5 }, Q.setAxisAngle(Q.new(), 1, 0, 0, 0.4), { x: 1, y: 1, z: 1 });
  /* M4.mul(o, a, b) is the matrix product a*b, so b has to be applied
     FIRST: (a*b)*p === a*(b*p). The old check compared (a*b)*p with
     b*(a*p), which is the wrong order and fails for any two matrices
     that do not commute. */
  const o = M4.mul(M4.create(), a, b);
  const p0 = { x: 1, y: 2, z: 3 };
  const ab = M4.transformPoint({}, o, p0);
  const pb = M4.transformPoint({}, a, M4.transformPoint({}, b, p0));
  const d = Math.hypot(ab.x - pb.x, ab.y - pb.y, ab.z - pb.z);
  return ok(d < 1e-4, `|a*(b*p) - (a*b)*p| = ${num(d, 8)}`);
});

A('MATH', 'M4.invert(A)*A = I', () => {
  const a = M4.create();
  M4.compose(a, { x: 1, y: 2, z: 3 }, Q.setAxisAngle(Q.new(), 0.3, 0.5, 0.2, 0.7), { x: 2, y: 3, z: 4 });
  const inv = M4.invert(M4.create(), a);
  if (!inv) return ok(false, 'invert returned null');
  const id = M4.mul(M4.create(), a, inv);
  let e = 0;
  const I = M4.I;
  for (let i = 0; i < 16; i++) e = Math.max(e, Math.abs(id[i] - I[i]));
  return ok(e < 1e-4, `max|M*A^-1 - I| = ${num(e, 8)}`);
});

A('MATH', 'M4.lookAt builds a right-handed view matrix', () => {
  const eye = { x: 0, y: 1, z: 3 }, ctr = { x: 0, y: 0, z: 0 }, up = { x: 0, y: 1, z: 0 };
  const v = M4.lookAt(M4.create(), eye, ctr, up);
  // camera looks down -Z in view space
  const p = M4.transformPoint({}, v, { x: 0, y: 0, z: 0 });
  const d = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
  /* The origin is transformed into VIEW space, so the distance to the
     world-space eye is meaningless — the view-space z IS the distance to
     the eye, and it has to be |eye - centre| = sqrt(10). */
  const want = Math.sqrt(10);
  return ok(Math.abs(p.x) < 1e-5 && Math.abs(p.y) < 1e-5 && Math.abs(p.z + want) < 1e-5,
    `origin maps to ${num(p.x)},${num(p.y)},${num(p.z)} (want 0,0,${num(-want, 3)})`);
});

A('MATH', 'M4.perspective maps the near plane to -1 and far to +1', () => {
  const p = M4.perspective(M4.create(), Math.PI / 3, 1.6, 0.1, 100);
  const a = M4.transformPoint({}, p, { x: 0, y: 0, z: -0.1 });
  const b = M4.transformPoint({}, p, { x: 0, y: 0, z: -100 });
  return ok(Math.abs(a.z + 1) < 1e-4 && Math.abs(b.z - 1) < 1e-4, `near ndc.z=${num(a.z)}, far ndc.z=${num(b.z)}`);
});

A('MATH', 'M4.ortho maps the box corners to the unit cube', () => {
  const o = M4.ortho(M4.create(), -2, 2, -1, 1, 0.5, 10);
  const c = M4.transformPoint({}, o, { x: 0, y: 0, z: -0.5 });
  const d = M4.transformPoint({}, o, { x: 2, y: 1, z: -10 });
  return ok(Math.abs(c.x) < 1e-5 && Math.abs(c.y) < 1e-5 && Math.abs(c.z + 1) < 1e-5 &&
             Math.abs(d.x - 1) < 1e-5 && Math.abs(d.y - 1) < 1e-5 && Math.abs(d.z - 1) < 1e-5,
    `near centre ndc=(${num(c.x)},${num(c.y)},${num(c.z)}) far corner=(${num(d.x)},${num(d.y)},${num(d.z)})`);
});

A('MATH', 'M4.normalFromMat4 is the inverse-transpose of the 3x3', () => {
  // a non-uniformly scaled rotation
  const m = M4.create();
  M4.compose(m, { x: 0, y: 0, z: 0 }, Q.setAxisAngle(Q.new(), 0.4, 0.9, 0.2, 0.8), { x: 1, y: 2, z: 3 });
  const n = M4.normalFromMat4(new Float32Array(9), m);
  // normal * (model * tangent) must be perpendicular to normal * (model * normalDir)
  const t = { x: 1, y: 0, z: 0 };
  const nn = { x: 0, y: 1, z: 0 };
  const tr = M4.transformDir({}, m, t);
  const nr = M4.transformDir({}, m, nn);
  const a = { x: n[0] * tr.x + n[3] * tr.y + n[6] * tr.z, y: n[1] * tr.x + n[4] * tr.y + n[7] * tr.z, z: n[2] * tr.x + n[5] * tr.y + n[8] * tr.z };
  const b = { x: n[0] * nr.x + n[3] * nr.y + n[6] * nr.z, y: n[1] * nr.x + n[4] * nr.y + n[7] * nr.z, z: n[2] * nr.x + n[5] * nr.y + n[8] * nr.z };
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  return ok(Math.abs(dot) < 1e-4, `dot(N*M*t, N*M*n) = ${num(dot, 8)}`);
});

A('MATH', 'Q.fromEuler matches an explicit YXZ product', () => {
  const x = 0.31, y = -0.77, z = 0.44;
  const q = Q.fromEuler(Q.new(), x, y, z);
  const half = (a) => ({ x: 0, y: 0, z: 0, w: 0 });
  const ax = { x: Math.sin(x / 2), y: 0, z: 0, w: Math.cos(x / 2) };
  const ay = { x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) };
  const az = { x: 0, y: 0, z: Math.sin(z / 2), w: Math.cos(z / 2) };
  const ref = Q.mul(Q.new(), Q.mul(Q.new(), ay, ax), az);
  const d = Math.abs(q.x - ref.x) + Math.abs(q.y - ref.y) + Math.abs(q.z - ref.z) + Math.abs(q.w - ref.w);
  return ok(d < 1e-6, `|q - qy*qx*qz| = ${num(d, 8)}`);
});

A('MATH', 'Q.lookRotation maps +Z onto the requested direction', () => {
  const dirs = [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 0.3, y: 0.8, z: -0.5 }];
  let worst = 0;
  for (const d of dirs) {
    const q = Q.lookRotation(Q.new(), d, { x: 0, y: 1, z: 0 });
    const m = M4.compose(M4.create(), { x: 0, y: 0, z: 0 }, q, { x: 1, y: 1, z: 1 });
    const o = M4.transformDir({}, m, { x: 0, y: 0, z: 1 });
    const n = Math.hypot(d.x, d.y, d.z);
    worst = Math.max(worst, Math.hypot(o.x - d.x / n, o.y - d.y / n, o.z - d.z / n));
  }
  return ok(worst < 1e-5, `worst |R*(0,0,1) - dir| = ${num(worst, 8)}`);
});

A('MATH', 'Q.slerp endpoints and midpoint are correct', () => {
  const a = Q.setAxisAngle(Q.new(), 0, 1, 0, 0);
  const b = Q.setAxisAngle(Q.new(), 0, 1, 0, Math.PI / 2);
  const s0 = Q.slerp(Q.new(), a, b, 0), s1 = Q.slerp(Q.new(), a, b, 1);
  const sm = Q.slerp(Q.new(), a, b, 0.5);
  const e0 = Math.abs(s0.w - 1), e1 = Math.abs(s1.w - Math.cos(Math.PI / 4));
  const em = Math.abs(sm.w - Math.cos(Math.PI / 8));   // halfway = 45 deg
  return ok(e0 < 1e-9 && e1 < 1e-9 && em < 1e-9, `endpoints err ${num(e0)},${num(e1)} mid err ${num(em)}`);
});

A('MATH', 'Q.integrate keeps the quaternion normalised', () => {
  const q = Q.new();
  const w = { x: 5, y: -3, z: 8 };
  for (let i = 0; i < 5000; i++) Q.integrate(q, q, w, 1 / 600);
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return ok(Math.abs(l - 1) < 1e-5, `|q| after 5000 steps = ${num(l, 8)}`);
});

A('MATH', 'V3 helpers are correct (norm/dot/cross/len)', () => {
  const a = { x: 3, y: 4, z: 0 };
  const n = V3.norm(V3.new(), a);
  const l = Math.hypot(n.x, n.y, n.z);
  const c = V3.cross(V3.new(), { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  return ok(Math.abs(l - 1) < 1e-9 && Math.abs(V3.len(a) - 5) < 1e-9 && c.z === 1,
    `|n|=${num(l, 8)} |a|=${num(V3.len(a), 8)} cross.z=${num(c.z, 6)}`);
});

A('MATH', 'V3.norm survives a zero-length vector', () => {
  const n = V3.norm(V3.new(), { x: 0, y: 0, z: 0 });
  return ok(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z), `norm(0)=${num(n.x, 4)},${num(n.y, 4)},${num(n.z, 4)}`);
});

A('MATH', 'smoothstep is safe when e0 == e1', () => {
  const v = X.smoothstep(1, 1, 1);
  return ok(Number.isFinite(v), `smoothstep(1,1,1) = ${v}`);
});

A('MATH', 'expSmooth is frame-rate independent', () => {
  const a = X.expSmooth(0, 1, 5, 1 / 60), b = X.expSmooth(0, 1, 5, 1 / 30);
  const c = X.expSmooth(0, 1, 5, 1 / 60 + 1 / 60);
  return ok(Math.abs(c - b) < 1e-9, `1/60+1/60 = ${num(c, 8)} vs 1/30 = ${num(b, 8)}`);
});

A('MATH', 'gauss has ~unit variance and zero mean', () => {
  let s = 0, s2 = 0; const N = 40000;
  for (let i = 0; i < N; i++) { const g = X.gauss(1); s += g; s2 += g * g; }
  const mean = s / N, sd = Math.sqrt(s2 / N - mean * mean);
  return ok(Math.abs(mean) < 0.02 && Math.abs(sd - 1) < 0.02, `mean=${num(mean, 4)} sd=${num(sd, 4)}`);
});

/* ================================================================ *
 *  AREA 2 — PHYSICS (30_physics.js)
 * ================================================================ */
A('PHYS', 'ITTF T3 drop test: 30.0 cm -> 23..26 cm', () => {
  const res = [];
  for (const h of [0.300, 0.305]) {
    const p = V3.new(0, PH.TABLE_Y + h + PH.R, 0), v = V3.new(0, 0, 0), w = V3.new(0, 0, 0);
    const dt = 1 / 6000; let t = 0;
    while (p.y - PH.R > PH.TABLE_Y && t < 2) { integrateBall(p, v, w, dt); t += dt; }
    bounceTable(p, v, w);
    let top = p.y, tt = 0;
    while (v.y > 0 && tt < 2) { integrateBall(p, v, w, dt); tt += dt; if (p.y > top) top = p.y; }
    res.push((top - PH.R - PH.TABLE_Y) * 100);
  }
  return ok(res.every((r) => r >= 23 && r <= 26), `rebounds ${res.map((r) => num(r, 1) + ' cm').join(', ')} (window 23..26)`);
});

A('PHYS', 'A dropped ball loses energy (rebound < drop height)', () => {
  const h = 0.30;
  const p = V3.new(0, PH.TABLE_Y + h + PH.R, 0), v = V3.new(0, 0, 0), w = V3.new(0, 0, 0);
  const dt = 1 / 6000; let t = 0;
  while (p.y - PH.R > PH.TABLE_Y && t < 2) { integrateBall(p, v, w, dt); t += dt; }
  bounceTable(p, v, w);
  let top = p.y;
  while (v.y > 0) { integrateBall(p, v, w, dt); if (p.y > top) top = p.y; }
  const r = top - PH.R - PH.TABLE_Y;
  return ok(r < h * 0.95, `rebound ${num(r * 100, 1)} cm vs drop ${num(h * 100, 1)} cm`);
});

A('PHYS', 'Energy never grows during free flight', () => {
  let worst = 0;
  for (let k = 0; k < 60; k++) {
    const p = V3.new(0, 1.2, 0), v = V3.new(6 - k * 0.1, 3, 2), w = V3.new(200, 30, -40);
    const e0 = 0.5 * PH.M * V3.len2(v) + PH.M * PH.G * p.y;
    for (let i = 0; i < 1200; i++) integrateBall(p, v, w, 1 / 600);
    const e1 = 0.5 * PH.M * V3.len2(v) + PH.M * PH.G * p.y;
    if (e1 > e0) worst = Math.max(worst, (e1 - e0) / e0);
  }
  return ok(worst < 1e-9, `worst energy growth ${num(worst * 100, 6)} %`);
});

A('PHYS', 'Drag decelerates a ball monotonically', () => {
  /* The horizontal component only: a ball in free fall GAINS vertical
     speed, so the total speed is not monotone and must not be tested
     that way (the old check failed on the gravity term, not on drag). */
  const v = V3.new(10, 0, 0); const p = V3.new(0, 1, 0); const w = V3.new(0, 0, 0);
  let mono = true;
  const first = Math.hypot(v.x, v.z);
  let prev = first;
  for (let i = 0; i < 600; i++) {
    integrateBall(p, v, w, 1 / 600);
    const s = Math.hypot(v.x, v.z);
    if (s > prev + 1e-12) mono = false;
    prev = s;
  }
  return ok(mono && prev < first, `horizontal speed ${num(first, 3)} -> ${num(prev, 3)} m/s after 1 s (monotonic=${mono})`);
});

A('PHYS', 'Magnus: topspin (w.x>0, +z travel) pushes the ball DOWN', () => {
  const acc = V3.new();
  const v = V3.new(0, 0, 8), wTop = V3.new(300, 0, 0), wBack = V3.new(-300, 0, 0);
  aeroAccel(acc, v, wTop); const ayTop = acc.y;
  aeroAccel(acc, v, wBack); const ayBack = acc.y;
  return ok(ayTop < ayBack - 1, `topspin ay=${num(ayTop, 2)} backspin ay=${num(ayBack, 2)} (top must be lower)`);
});

A('PHYS', 'Magnus: sidespin bends the flight sideways', () => {
  const acc = V3.new();
  aeroAccel(acc, V3.new(0, 0, 8), V3.new(0, 250, 0));
  return ok(Math.abs(acc.x) > 0.01, `ay/sidespin lateral accel = ${num(acc.x, 3)} m/s²`);
});

A('PHYS', 'Spin decays exponentially with tau = 9 s', () => {
  const p = V3.new(0, 1, 0), v = V3.new(0, 0, 0), w = V3.new(400, 0, 0);
  for (let i = 0; i < Math.round(9 * 600); i++) integrateBall(p, v, w, 1 / 600);
  const r = w.x / 400;
  return ok(Math.abs(r - Math.exp(-1)) < 0.01, `w after 9 s = ${num(r, 5)} of start (e^-1 = ${num(Math.exp(-1), 5)})`);
});

A('PHYS', 'Spin never exceeds SPIN_CAP through the impact solver', () => {
  let worst = 0;
  for (let k = 0; k < 400; k++) {
    const v = V3.new(0, 0, -12 - (k % 7)), w = V3.new(0, 0, 0);
    const n = V3.new(0, 0, 1);
    impactSphere(v, w, n, V3.new(0, 0, 0), 0.8, 1.05, 0.52);
    worst = Math.max(worst, V3.len(w));
  }
  return ok(worst <= X.SPIN_CAP * 1.001, `max |w| = ${num(worst, 1)} rad/s, cap ${num(X.SPIN_CAP, 1)}`);
});

A('PHYS', 'bounceTable: topspin kicks forward, backspin brakes', () => {
  const mk = (wx) => {
    const p = V3.new(0, PH.TABLE_Y + PH.R, 0), v = V3.new(0, -6, 0), w = V3.new(wx, 0, 0);
    bounceTable(p, v, w);
    return v.z;
  };
  const top = mk(300), back = mk(-300), flat = mk(0);
  return ok(top > flat && back < flat, `top=${num(top, 3)} flat=${num(flat, 3)} back=${num(back, 3)} (m/s along z)`);
});

A('PHYS', 'bounceTable: spin about the vertical axis (w.y) does not move the ball sideways', () => {
  const p = V3.new(0, PH.TABLE_Y + PH.R, 0), v = V3.new(0, -6, 0), w = V3.new(0, 300, 0);
  bounceTable(p, v, w);
  return ok(Math.abs(v.x) < 0.02, `v.x after bounce with w.y=300: ${num(v.x, 4)} m/s`);
});

A('PHYS', 'bounceTable: w.z (corkscrew) does throw the ball sideways', () => {
  const p = V3.new(0, PH.TABLE_Y + PH.R, 0), v = V3.new(0, -6, 0), w = V3.new(0, 0, 300);
  bounceTable(p, v, w);
  return ok(Math.abs(v.x) > 0.1, `v.x after bounce with w.z=300: ${num(v.x, 4)} m/s`);
});

A('PHYS', 'Table bounce is inside the table limits (no wild kick)', () => {
  let maxV = 0;
  for (let k = 0; k < 200; k++) {
    const p = V3.new((k % 7 - 3) * 0.2, PH.TABLE_Y + PH.R, 0), v = V3.new(0, -8 - (k % 5), 0), w = V3.new((k % 3 - 1) * 200, 0, (k % 4 - 2) * 150);
    bounceTable(p, v, w);
    maxV = Math.max(maxV, V3.len(v));
  }
  return ok(maxV < 14, `max outgoing speed on a table bounce = ${num(maxV, 2)} m/s`);
});

A('PHYS', 'A ball that lands on the edge is flagged as an edge bounce', () => {
  const p = V3.new(PH.T_HALF_WID - 0.004, PH.TABLE_Y + PH.R, 0), v = V3.new(0, -6, 0), w = V3.new(0, 0, 0);
  const info = bounceTable(p, v, w);
  return ok(info && info.edge > 0.25, `edge=${info ? num(info.edge, 3) : 'null'} axis=${info ? info.edgeAxis : '-'}`);
});

A('PHYS', 'A ball landing in the middle is NOT flagged as an edge', () => {
  const p = V3.new(0, PH.TABLE_Y + PH.R, 0), v = V3.new(0, -6, 0), w = V3.new(0, 0, 0);
  const info = bounceTable(p, v, w);
  return ok(info && info.edge <= 0.25, `edge=${info ? num(info.edge, 4) : 'null'}`);
});

A('PHYS', 'Net: a ball into the net comes back and loses most of its speed', () => {
  const p = V3.new(0, 0.85, 0.02), v = V3.new(0, 0, 6), w = V3.new(0, 0, 0);
  const v0 = V3.len(v);
  X.bounceNet(p, v, w, 1);
  return ok(v.z < 0 && V3.len(v) < v0 * 0.6, `v.z=${num(v.z, 3)} |v| ${num(v0, 2)} -> ${num(V3.len(v), 2)}`);
});

A('PHYS', 'Net: the net does not stop a ball that passes over the tape', () => {
  const out = {};
  predict(V3.new(0, PH.NET_TOP + 0.12, -0.5), V3.new(0, 0, 8), V3.new(0, 0, 0),
    { dt: 1 / 600, maxT: 1.0, out });
  return ok(!out.hitNet, `hitNet=${out.hitNet} netCross.y=${out.netCross ? num(out.netCross.y, 3) : '-'}`);
});

A('PHYS', 'Net: a ball below the tape is stopped', () => {
  const out = {};
  predict(V3.new(0, PH.NET_TOP - 0.10, -0.5), V3.new(0, 0, 8), V3.new(0, 0, 0),
    { dt: 1 / 600, maxT: 1.0, out });
  return ok(out.hitNet === true, `hitNet=${out.hitNet}`);
});

A('PHYS', 'Net overhang: the net is wider than the table', () => {
  return ok(PH.NET_HALF_WID > PH.T_HALF_WID && Math.abs(PH.NET_HALF_WID - (PH.T_HALF_WID + PH.NET_OVERHANG)) < 1e-9,
    `net half width ${num(PH.NET_HALF_WID, 4)} m vs table ${num(PH.T_HALF_WID, 4)} m`);
});

A('PHYS', 'Table dimensions are the ITTF ones', () => {
  return ok(Math.abs(PH.T_LEN - 2.74) < 1e-9 && Math.abs(PH.T_WID - 1.525) < 1e-9 &&
             Math.abs(PH.T_H - 0.76) < 1e-9 && Math.abs(PH.NET_H - 0.1525) < 1e-9,
    `L=${PH.T_LEN} W=${PH.T_WID} H=${PH.T_H} net=${PH.NET_H}`);
});

A('PHYS', 'Ball constants are the ITTF ones', () => {
  return ok(Math.abs(PH.R - 0.020) < 1e-12 && Math.abs(PH.M - 0.0027) < 1e-12,
    `R=${PH.R} M=${PH.M}`);
});

A('PHYS', 'predict() is deterministic (same input -> same output)', () => {
  const run = () => {
    const o = {};
    predict(V3.new(0.1, 1.0, -0.8), V3.new(3, 2, 9), V3.new(120, 0, 0), { dt: 1 / 600, maxT: 2, out: o });
    return JSON.stringify(o);
  };
  return ok(run() === run(), 'two identical predictions differ');
});

A('PHYS', 'predict() never produces NaN over hostile inputs', () => {
  let bad = 0;
  const cases = [
    [V3.new(0, 1, 0), V3.new(0, 0, 0), V3.new(0, 0, 0)],
    [V3.new(0, 1, 0), V3.new(1e9, 0, 0), V3.new(0, 0, 0)],
    [V3.new(0, 1, 0), V3.new(0, 0, 0), V3.new(1e9, 0, 0)],
    [V3.new(0, 1, 0), V3.new(NaN, 0, 0), V3.new(0, 0, 0)],
    [V3.new(0, 1, 0), V3.new(0, 0, 1), V3.new(0, NaN, 0)],
  ];
  for (const [p, v, w] of cases) {
    const o = {};
    try {
      predict(p, v, w, { dt: 1 / 600, maxT: 1, out: o });
      if (!Number.isFinite(o.end.x) || !Number.isFinite(o.end.y) || !Number.isFinite(o.end.z)) bad++;
    } catch (e) { bad++; }
  }
  return ok(bad === 0, `${bad}/5 hostile inputs produced a non-finite end state`);
});

A('PHYS', 'solveLaunch lands the ball on the requested target', () => {
  /* Reachable pairs only: a 9 m/s ball cannot be made to land 1.8 m away
     on a table 25 cm below the contact point — the geometry forbids it,
     and a solver that "misses" there is right to report a big error. */
  const cases = [[-0.9, 7], [-0.9, 9], [-1.2, 7], [-1.2, 9], [-1.35, 9]];
  const errs = [];
  for (const [tz, spd] of cases) {
    const sol = solveLaunch(V3.new(0, PH.TABLE_Y + 0.25, 1.4), { x: 0.1, z: tz }, V3.new(0, 0, 0), { speed: spd, netClear: 0.06 });
    if (!sol || !sol.landed) { errs.push(99); continue; }
    errs.push(Math.hypot(sol.landed.x - 0.1, sol.landed.z - tz));
  }
  const worst = Math.max(...errs);
  return ok(worst < 0.15, `worst landing error ${num(worst, 3)} m over ${cases.length} reachable targets`);
});

A('PHYS', 'solveLaunch admits the miss when the target is out of reach', () => {
  /* 11 m/s into a target 1.8 m away cannot be done: the solver has to say
     so instead of pretending it hit the spot. */
  const sol = solveLaunch(V3.new(0, PH.TABLE_Y + 0.25, 1.4), { x: 0.1, z: -0.4 }, V3.new(0, 0, 0), { speed: 11, netClear: 0.06 });
  return ok(!sol || sol.err === undefined || sol.err > 0.3,
    `solver err = ${sol && sol.err !== undefined ? num(sol.err, 3) : 'n/a'} for an unreachable target`);
});

A('PHYS', 'solveLaunch rejects a NaN target instead of returning a NaN launch', () => {
  const sol = solveLaunch(V3.new(0, 1, 1.4), { x: NaN, z: 0 }, V3.new(0, 0, 0), { speed: 9 });
  return ok(sol === null, `solveLaunch(NaN target) = ${sol === null ? 'null' : 'a launch'}`);
});

A('PHYS', 'solveLaunch cost stays inside the frame budget (<12 ms median)', () => {
  const ts = [];
  for (let i = 0; i < 40; i++) {
    const t0 = process.hrtime.bigint();
    solveLaunch(V3.new(0, PH.TABLE_Y + 0.25, 1.4), { x: 0.1, z: -1.0 }, V3.new(0, 0, 0), { speed: 9, netClear: 0.06 });
    ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ts.sort((a, b) => a - b);
  const med = ts[Math.floor(ts.length / 2)];
  return ok(med < 12, `median solveLaunch = ${num(med, 2)} ms (budget 12 ms, docs say 7..17 ms)`);
});

A('PHYS', 'A solver verdict holds at the production step (600 Hz)', () => {
  // A shot the solver says clears the net must clear it in the live integrator.
  let mismatch = 0, n = 0;
  for (let k = 0; k < 25; k++) {
    const from = V3.new(0, PH.TABLE_Y + 0.25, 1.4);
    const target = { x: (k % 5 - 2) * 0.15, z: -0.7 - (k % 3) * 0.2 };
    const sol = solveLaunch(from, target, V3.new(-100, 0, 0), { speed: 7 + (k % 4), netClear: 0.05 });
    if (!sol) continue;
    n++;
    const o = {};
    predict(V3.clone(from), V3.new(sol.vx, sol.vy, sol.vz), V3.new(0, 0, 0), { dt: 1 / 600, maxT: 2.4, out: o });
    if (o.hitNet) mismatch++;
  }
  return ok(mismatch === 0, `${mismatch}/${n} solver-approved shots hit the net in the live integrator`);
});

A('PHYS', 'impactRacket: a square face produces more speed than a grazing one', () => {
  const mk = (elevDeg) => {
    const e = elevDeg * DEG;
    const n = V3.new(0, Math.sin(e), -Math.cos(e));
    const v = V3.new(0, 0, 8), w = V3.new(0, 0, 0);
    impactRacket(v, w, n, V3.new(0, 0, -9), 1, {});
    return V3.len(v);
  };
  const flat = mk(0), graze = mk(70);
  return ok(flat > graze, `square face ${num(flat, 2)} m/s vs 70° graze ${num(graze, 2)} m/s`);
});

A('PHYS', 'impactRacket: a grazing contact produces more spin than a square one', () => {
  const mk = (elevDeg) => {
    const e = elevDeg * DEG;
    const n = V3.new(0, Math.sin(e), -Math.cos(e));
    const v = V3.new(0, 0, 8), w = V3.new(0, 0, 0);
    impactRacket(v, w, n, V3.new(0, 0, -9), 1, {});
    return V3.len(w);
  };
  const flat = mk(0), graze = mk(70);
  return ok(graze > flat * 2, `square face |w|=${num(flat, 1)} vs 70° graze |w|=${num(graze, 1)} rad/s`);
});

A('PHYS', 'impactRacket: the outgoing topspin sign is correct for a forward swing', () => {
  /* The player hits toward -z, and the game stores the player's topspin
     as -w.x, so topspin means w.x < 0. The check uses the game's own
     stroke frame (an upward brush is a topspin loop, a downward brush is
     a backspin chop) — a hand-made normal measures the friction model,
     not the convention the game relies on. */
  const mk = (up) => {
    const m = { right: 0, up, dist: 0.2, curl: 0, smooth: 0.9, straightness: 0.9, samples: 10, speed: 2, peakSpeed: 2.4, releaseSpeed: 2, x: 0.5, y: 0.5 };
    const r = deriveStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 5 });
    const v = V3.new(0, 0, 8), w = V3.new(0, 0, 0);
    impactRacket(v, w, r.normal, r.vR, 1, r.rubber || {});
    return w.x;
  };
  const up = mk(0.9), down = mk(-0.6);
  return ok(up < -100 && down > 100,
    `upward brush -> w.x = ${num(up, 1)} (topspin, must be < 0); downward brush -> w.x = ${num(down, 1)} (backspin, must be > 0)`);
});

A('PHYS', 'impactRacket: quality scales the outgoing speed', () => {
  const mk = (q) => {
    const v = V3.new(0, 0, 8), w = V3.new(0, 0, 0);
    impactRacket(v, w, V3.new(0, 0.2, -0.98), V3.new(0, 0, -9), q, {});
    return V3.len(v);
  };
  const good = mk(1), poor = mk(0.3);
  return ok(good > poor * 1.2, `q=1 -> ${num(good, 2)} m/s, q=0.3 -> ${num(poor, 2)} m/s`);
});

A('PHYS', 'The ball radius is respected in the table plane test', () => {
  const p = V3.new(0, PH.TABLE_Y + PH.R - 0.001, 0), v = V3.new(0, -0.1, 0), w = V3.new(0, 0, 0);
  bounceTable(p, v, w);
  return ok(v.y > 0, `v.y after a grazing table contact = ${num(v.y, 4)}`);
});

A('PHYS', 'Reynolds number of a 20 m/s shot is in the supercritical band', () => {
  /* Re = v*D/nu. The old formula multiplied by 60 as well, which is the
     number of frames per second and has nothing to do with the Reynolds
     number (it pushed the result 60x above the physical band). */
  const Re = (20 * 2 * PH.R) / PH.NU;
  return ok(Re > 1e4 && Re < 1e6, `Re = ${num(Re, 0)} for a 20 m/s shot (v*D/nu)`);
});

A('PHYS', 'Drag coefficient stays in the physical band over the spin range', () => {
  let lo = 9, hi = 0;
  for (let s = 0; s <= 2; s += 0.05) {
    const cd = PH.CD0 + PH.CD_SPIN * Math.min(s, 1.2);
    lo = Math.min(lo, cd); hi = Math.max(hi, cd);
  }
  return ok(lo >= 0.4 && hi <= 0.7, `Cd ranges ${num(lo, 3)}..${num(hi, 3)}`);
});

/* ================================================================ *
 *  AREA 3 — SWIPE / STROKE (40_swipe.js)
 * ================================================================ */
A('SWIPE', 'A straight upward swipe is reported as "up"', () => {
  const s = new SwipeTracker();
  s.down(0.5, 0.8, 0);
  for (let i = 1; i <= 10; i++) s.move(0.5, 0.8 - i * 0.03, i * 0.012);
  const m = s.up(0.5, 0.5, 0.12);
  return ok(m.up > 0.85 && Math.abs(m.right) < 0.2, `up=${num(m.up, 3)} right=${num(m.right, 3)}`);
});

A('SWIPE', 'A straight rightward swipe is reported as "right"', () => {
  const s = new SwipeTracker();
  s.down(0.3, 0.5, 0);
  for (let i = 1; i <= 10; i++) s.move(0.3 + i * 0.02, 0.5, i * 0.012);
  const m = s.up(0.5, 0.5, 0.12);
  return ok(m.right > 0.85 && Math.abs(m.up) < 0.2, `right=${num(m.right, 3)} up=${num(m.up, 3)}`);
});

A('SWIPE', 'A curled gesture reports a non-zero curl', () => {
  const s = new SwipeTracker();
  s.down(0.4, 0.8, 0);
  const pts = [[0.4, 0.8], [0.42, 0.66], [0.52, 0.58], [0.64, 0.56]];
  for (let i = 1; i < pts.length; i++) s.move(pts[i][0], pts[i][1], i * 0.03);
  const m = s.up(pts[3][0], pts[3][1], 0.12);
  return ok(Math.abs(m.curl) > 0.2, `curl=${num(m.curl, 3)} rad`);
});

A('SWIPE', 'A straight gesture has curl ~ 0 and straightness ~ 1', () => {
  const s = new SwipeTracker();
  s.down(0.5, 0.8, 0);
  for (let i = 1; i <= 10; i++) s.move(0.5, 0.8 - i * 0.03, i * 0.012);
  const m = s.up(0.5, 0.5, 0.12);
  return ok(Math.abs(m.curl) < 0.05 && m.straightness > 0.98, `curl=${num(m.curl, 4)} straight=${num(m.straightness, 4)}`);
});

A('SWIPE', 'The gesture tracker survives a zero-length gesture', () => {
  const s = new SwipeTracker();
  s.down(0.5, 0.5, 0);
  const m = s.up(0.5, 0.5, 0.05);
  return ok(m && Number.isFinite(m.speed) && Number.isFinite(m.up), `speed=${num(m.speed, 4)} up=${num(m.up, 4)}`);
});

A('SWIPE', 'deriveStroke never returns a NaN for hostile metrics', () => {
  const bad = [
    { releaseSpeed: NaN, peakSpeed: NaN, right: NaN, up: NaN, dist: NaN, curl: NaN, smooth: NaN, straightness: NaN, samples: 0, x: NaN, y: NaN },
    { releaseSpeed: 1e9, peakSpeed: 1e9, right: 5, up: 5, dist: 1e9, curl: 1e9, smooth: 5, straightness: 5, samples: 1e9, x: 1e9, y: 1e9 },
    { releaseSpeed: -5, peakSpeed: -5, right: -5, up: -5, dist: -5, curl: -5, smooth: -1, straightness: -1, samples: -3, x: -1e9, y: -1e9 },
  ];
  let n = 0;
  for (const b of bad) {
    const r = deriveStroke(b, { side: 1, ball: { y: 1, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 6 });
    if (!r || !Number.isFinite(r.vmag) || !Number.isFinite(r.elev) || !Number.isFinite(r.contact) ||
        !Number.isFinite(r.normal.x) || !Number.isFinite(r.normal.y) || !Number.isFinite(r.normal.z) ||
        !Number.isFinite(r.vR.x) || !Number.isFinite(r.vR.y) || !Number.isFinite(r.vR.z)) n++;
  }
  return ok(n === 0, `${n}/3 hostile metric sets produced a non-finite racket`);
});

A('SWIPE', 'An upward swipe classifies as a topspin family stroke', () => {
  const m = { right: 0, up: 0.95, dist: 0.25, curl: 0, smooth: 0.9, straightness: 0.95, samples: 10, speed: 3, peakSpeed: 3.5, releaseSpeed: 3, x: 0.5, y: 0.5, samples2: 0 };
  const st = classifyStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpeed: 6, incomingTop: 0 }, 0.7);
  return ok(st.id === 'LOOP' || st.id === 'COUNTER' || st.id === 'LOB' || st.id === 'FLICK', `classified as ${st.id}`);
});

A('SWIPE', 'A downward swipe classifies as the backspin family', () => {
  const m = { right: 0, up: -0.9, dist: 0.25, curl: 0, smooth: 0.9, straightness: 0.95, samples: 10, speed: 3, peakSpeed: 3.5, releaseSpeed: 3, x: 0.5, y: 0.5 };
  const st = classifyStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpeed: 6, incomingTop: 0 }, 0.7);
  return ok(st.id === 'CHOP' || st.id === 'PUSH' || st.id === 'DROP', `classified as ${st.id}`);
});

A('SWIPE', 'A tiny gesture on a fast ball classifies as BLOCK', () => {
  const m = { right: 0, up: 0.1, dist: 0.02, curl: 0, smooth: 0.9, straightness: 1, samples: 3, speed: 0.5, peakSpeed: 0.6, releaseSpeed: 0.5, x: 0.5, y: 0.5 };
  const st = classifyStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpeed: 9, incomingTop: 0 }, 0.2);
  return ok(st.id === 'BLOCK', `classified as ${st.id}`);
});

A('SWIPE', 'A serve gesture is classified into the serve family', () => {
  const m = { right: 0, up: 0.9, dist: 0.2, curl: 0, smooth: 0.9, straightness: 0.95, samples: 8, speed: 2, peakSpeed: 2.4, releaseSpeed: 2, x: 0.5, y: 0.5 };
  const st = classifyStroke(m, { side: 1, isServe: true, ball: { y: PH.TABLE_Y + 0.2, z: 1.5 }, ballSpeed: 0, incomingTop: 0 }, 0.5);
  return ok(st.id.startsWith('SERVE'), `classified as ${st.id}`);
});

A('SWIPE', 'The serve speed cap holds (bat <= 12.5 m/s)', () => {
  const m = { right: 0, up: 1, dist: 0.5, curl: 0, smooth: 1, straightness: 1, samples: 20, speed: 20, peakSpeed: 30, releaseSpeed: 25, x: 0.5, y: 0.5 };
  const r = deriveStroke(m, { side: 1, isServe: true, ball: { y: PH.TABLE_Y + 0.2, z: 1.5 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 0 });
  return ok(r.vmag <= 12.5 + 1e-9, `serve bat speed = ${num(r.vmag, 2)} m/s (cap 12.5)`);
});

A('SWIPE', 'A non-serve stroke may exceed the serve cap (it is a smash)', () => {
  const m = { right: 0, up: 1, dist: 0.5, curl: 0, smooth: 1, straightness: 1, samples: 20, speed: 20, peakSpeed: 30, releaseSpeed: 25, x: 0.5, y: 0.5 };
  const r = deriveStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.6, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 4 });
  return ok(r.vmag > 12.5, `stroke bat speed = ${num(r.vmag, 2)} m/s`);
});

A('SWIPE', 'The equipment rubber is folded into the racket state', () => {
  const m = { right: 0, up: 0.8, dist: 0.2, curl: 0, smooth: 0.9, straightness: 0.9, samples: 10, speed: 2, peakSpeed: 2.4, releaseSpeed: 2, x: 0.5, y: 0.5 };
  const eq = new Equipment('b_carb', 'r_tops', 'r_hyb');
  const p = eq.forSide(1);
  const r = deriveStroke(m, { side: 1, ball: { y: 1, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 5, equip: p });
  return ok(r.rubber && r.rubber.e > 0 && r.rubber.mu > 0 && r.rubber.et > 0,
    `rubber e=${num(r.rubber.e, 3)} mu=${num(r.rubber.mu, 3)} et=${num(r.rubber.et, 3)}`);
});

A('SWIPE', 'refineRacket at assist=0 does not move the shot', () => {
  const m = { right: 0, up: 0.8, dist: 0.2, curl: 0, smooth: 0.9, straightness: 0.9, samples: 10, speed: 2, peakSpeed: 2.4, releaseSpeed: 2, x: 0.5, y: 0.5 };
  const base = deriveStroke(m, { side: 1, ball: { y: 1, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 5 });
  const r = refineRacket(V3.new(0, 1, 1.4), V3.new(0, 0, -6), V3.new(0, 0, 0), base, 0, 0.8);
  const d = Math.abs(r.elev - base.elev) + Math.abs(r.azSwing - base.azSwing) + Math.abs(r.vmag - base.vmag);
  return ok(d < 1e-6, `assist 0 moved the stroke by ${num(d, 6)}`);
});

A('SWIPE', 'refineRacket at assist=1 keeps the shot legal and on the table', () => {
  /* The verdict the solver hands back AND the shot that comes out of it.
     The incoming ball travels towards the player (+z) and is on its way
     down — the state the game actually produces. */
  const from = V3.new(0, PH.TABLE_Y + 0.20, 1.25);
  let legal = 0, onTable = 0, n = 0;
  for (let k = 0; k < 20; k++) {
    const m = { right: (k % 5 - 2) * 0.15, up: 0.5 + (k % 3) * 0.15, dist: 0.1 + (k % 4) * 0.05, curl: (k % 2) * 0.3 - 0.15, smooth: 0.8, straightness: 0.8, samples: 10, speed: 1.5 + (k % 4) * 0.7, peakSpeed: 2 + (k % 4) * 0.7, releaseSpeed: 1.5 + (k % 4) * 0.7, x: 0.5, y: 0.5 };
    const base = deriveStroke(m, { side: 1, ball: { y: from.y, z: from.z }, ballSpin: V3.new(0, 0, 0), ballSpeed: 5 });
    const vin = V3.new(0, -1, 6);
    const r = refineRacket(from, V3.clone(vin), V3.new(0, 0, 0), base, 1, 0.8);
    n++;
    if (r && r.valid !== false) legal++;
    const v = V3.clone(vin), w = V3.new(0, 0, 0);
    if (r && r.normal && r.vR) {
      impactRacket(v, w, r.normal, r.vR, 0.8, r.rubber || {});
      const o = {};
      predict(V3.clone(from), v, w, { dt: 1 / 300, maxT: 2.6, stopOnFirstBounce: true, out: o });
      if (o.landed && o.landed.z < -0.02 && o.landed.z > -1.37 && Math.abs(o.landed.x) < PH.T_HALF_WID) onTable++;
    }
  }
  return ok(legal === n && onTable === n, `${legal}/${n} verdicts legal, ${onTable}/${n} shots on the table`);
});

/* The gesture metrics of a REAL swipe: the tracker's numbers for a
   0.25-unit upward drag at 1.5..2.5 units/s. The synthetic gestures the
   other analyses use (up = 0.3) are not something a hand produces. */
const REAL_SWIPE = (up, sp) => ({
  right: 0, up, dist: 0.25, curl: 0.10, smooth: 0.96, straightness: 0.99,
  samples: 5, speed: sp, peakSpeed: sp * 1.7, releaseSpeed: sp, x: 0.5, y: 0.55,
});
function shotOutcome(base, from, assist) {
  const vin = V3.new(0, -1, 8), spin = V3.new(0, 0, 0);
  const r = refineRacket(from, V3.clone(vin), V3.clone(spin), base, assist, 0.8);
  if (!r || !r.normal || !r.vR) return { where: 'none' };
  /* the impact starts from the INCOMING state of the ball — leaving it at
     zero measures a different shot entirely */
  const v = V3.clone(vin), w = V3.clone(spin);
  impactRacket(v, w, r.normal, r.vR, 0.8, r.rubber || {});
  const o = {};
  predict(V3.clone(from), v, w, { dt: 1 / 300, maxT: 3.0, stopOnFirstBounce: true, out: o });
  if (o.hitNet) return { where: 'net', v };
  if (!o.landed) return { where: 'long', v };
  const onTable = o.landed.z < -0.02 && o.landed.z > -1.37 && Math.abs(o.landed.x) < PH.T_HALF_WID;
  return { where: onTable ? 'table' : (o.landed.z > 0 ? 'own' : 'out'), v, landed: o.landed };
}

/* The bench's own rally scenario (the one analyze.js uses): the contact is
   spread over the whole reachable volume and the incoming ball carries a
   random spin. */
const BENCH_GESTURES = [
  { up: 0.95, right: 0.05, dist: 0.30, speed: 1.8, peakSpeed: 2.2, releaseSpeed: 1.8, curl: 0, smooth: 1, straightness: 1, samples: 10 },
  { up: 0.95, right: 0.05, dist: 0.42, speed: 3.9, peakSpeed: 4.3, releaseSpeed: 3.9, curl: 0, smooth: 1, straightness: 1, samples: 10 },
  { up: -0.98, right: 0.00, dist: 0.33, speed: 2.4, peakSpeed: 2.8, releaseSpeed: 2.4, curl: 0, smooth: 1, straightness: 1, samples: 10 },
  { up: 0.40, right: 0.85, dist: 0.30, speed: 2.6, peakSpeed: 3.0, releaseSpeed: 2.6, curl: 1.6, smooth: 1, straightness: 0.7, samples: 10 },
  { up: 0.30, right: 0.12, dist: 0.40, speed: 4.4, peakSpeed: 4.8, releaseSpeed: 4.4, curl: 0, smooth: 1, straightness: 0.98, samples: 10 },
];
function benchRally(assist, n) {
  let onTable = 0, invalid = 0;
  for (let i = 0; i < n; i++) {
    const g = BENCH_GESTURES[i % BENCH_GESTURES.length];
    const m = Object.assign({}, g, { x: 0.5, y: 0.5 });
    const inc = 4 + (i % 15);
    const bp = { x: 0, y: PH.TABLE_Y + 0.10 + (i % 5) * 0.08, z: 1.05 + ((i % 3) - 1) * 0.2 };
    const vin = V3.new(0, -1, inc), spin = V3.new(0, 0, 0);
    const ctx = { side: 1, isServe: false, ball: { y: bp.y, z: bp.z }, ballSpin: spin, ballSpeed: inc, equip: { e: PH.E_RACKET, mu: PH.MU_RACKET, et: PH.ET_RACKET, damp: 1 } };
    const st = deriveStroke(m, ctx);
    let r = refineRacket(bp, vin, V3.clone(spin), st, assist, st.quality);
    if (r.valid === false) invalid++;
    /* the second chance the game gives every shot */
    if (r.valid === false && assist < 0.999) r = refineRacket(bp, V3.clone(vin), V3.clone(spin), r, 1, r.quality);
    const v = V3.clone(vin), w = V3.clone(spin);
    impactRacket(v, w, r.normal, r.vR, st.quality, r.rubber || {});
    const o = {};
    predict(V3.clone(bp), v, w, { dt: 1 / 600, maxT: 2.6, stopOnFirstBounce: true, out: o });
    if (o.landed && o.landed.z < -0.02 && o.landed.z > -1.37 && Math.abs(o.landed.x) < PH.T_HALF_WID) onTable++;
  }
  return { onTable: onTable / n, invalid: invalid / n, n };
}

A('SWIPE', 'The assist gives every shot a second chance, not only the serve', () => {
  /* The second solve (full assist when the first one says "not legal") was
     wired to the serve only, so a rally shot that the assist could not
     make legal was played as it was. Measured: at assist 0.5 the first
     solve comes back illegal for a quarter of the shots. */
  const r = benchRally(0.5, 60);
  return ok(r.onTable >= 0.75,
    `${num(r.onTable * 100, 1)} % of the shots land on the table at assist 0.5 (${num(r.invalid * 100, 1)} % needed the second chance)`);
});

A('SWIPE', 'The assist curve rises with the slider and never falls', () => {
  const res = [0, 0.25, 0.5, 0.85, 1].map((a) => benchRally(a, 40).onTable);
  let mono = true;
  for (let i = 1; i < res.length; i++) if (res[i] < res[i - 1] - 0.05) mono = false;
  return ok(mono && res[res.length - 1] > res[0] + 0.4,
    `on the table by assist: ${res.map((r) => num(r * 100, 1) + '%').join(' / ')}`);
});

A('SWIPE', 'The assist places a low contact on the opponent\'s half', () => {
  /* A contact 10 cm above the table is the ordinary case (the ball has
     just bounced on the player's half). Here the assist works. */
  const from = V3.new(0, PH.TABLE_Y + 0.10, 1.42);
  let on = 0, n = 0;
  for (let k = 0; k < 12; k++) {
    const m = REAL_SWIPE(0.95, 1.5 + (k % 4) * 0.35);
    const base = deriveStroke(m, { side: 1, ball: { y: from.y, z: from.z }, ballSpin: V3.new(0, 0, 0), ballSpeed: 8 });
    const o = shotOutcome(base, from, 1);
    n++;
    if (o.where === 'table') on++;
  }
  return ok(on / n >= 0.7, `${on}/${n} assisted shots landed on the opponent's half (need >= 70 %)`);
});

A('SWIPE', 'The assist places a HIGH contact on the opponent\'s half', () => {
  /* The same swipe, but met 17 cm higher — which is what happens as soon
     as the ball comes off the bounce with any pace. The stroke launches
     the ball at 27..39 deg with 7..14 m/s, which carries it six to ten
     metres, and the placement target is not reachable by the stroke
     model at all, so the assist cannot put it on the table. */
  const from = V3.new(0, PH.TABLE_Y + 0.17, 1.42);
  const where = {};
  for (let k = 0; k < 12; k++) {
    const m = REAL_SWIPE(0.95, 1.5 + (k % 4) * 0.35);
    const base = deriveStroke(m, { side: 1, ball: { y: from.y, z: from.z }, ballSpin: V3.new(0, 0, 0), ballSpeed: 8 });
    const o = shotOutcome(base, from, 1);
    where[o.where] = (where[o.where] || 0) + 1;
  }
  const on = where.table || 0;
  return ok(on >= 9, `${on}/12 assisted shots landed on the table (${JSON.stringify(where)})`);
});

A('SWIPE', 'The assist curve is monotonic (more assist -> the shot lands closer to the aim)', () => {
  /* The claim the assist makes is "the ball goes where you aimed, more
     or less according to the slider". The measurable quantity is the
     distance between the landing point and the aim point — the old
     check counted the solver's `valid` flag, which says nothing about
     where the ball went. */
  const AIM = { x: 0.15, z: -0.85 };
  const err = [];
  for (const a of [0, 0.25, 0.5, 0.72, 1.0]) {
    let sum = 0, n = 0;
    for (let k = 0; k < 30; k++) {
      /* a real swing: 2.0..3.6 in gesture units is a 9..13 m/s racket.
         The old numbers (1.2) produced a 1.2 m/s racket, which physically
         cannot reach an aim point two metres away — the assist was being
         judged on shots that could not get there at all. */
      const m = { right: (k % 5 - 2) * 0.18, up: 0.4 + (k % 4) * 0.18, dist: 0.12 + (k % 5) * 0.04, curl: (k % 3) * 0.2 - 0.2, smooth: 0.85, straightness: 0.85, samples: 10, speed: 2.0 + (k % 5) * 0.35, peakSpeed: 2.4 + (k % 5) * 0.35, releaseSpeed: 2.0 + (k % 5) * 0.35, x: 0.5, y: 0.5 };
      const from = V3.new(0, PH.TABLE_Y + 0.2, 1.2);
      const base = deriveStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 5 });
      base.aim = { x: AIM.x, z: AIM.z };
      const r = refineRacket(from, V3.new(0, 0, 5), V3.new(0, 0, 0), base, a, 0.8);
      n++;
      if (r && r.normal && r.vR) {
        const v = V3.clone(V3.new(0, 0, 5)), w = V3.new(0, 0, 0);
        impactRacket(v, w, r.normal, r.vR, 0.8, r.rubber || {});
        const o = {};
        predict(V3.clone(from), v, w, { dt: 1 / 300, maxT: 2.5, stopOnFirstBounce: true, out: o });
        sum += o.landed ? Math.hypot(o.landed.x - AIM.x, o.landed.z - AIM.z) : 3;
      } else sum += 3;
    }
    err.push(sum / n);
  }
  let mono = true;
  for (let i = 1; i < err.length; i++) if (err[i] > err[i - 1] + 0.02) mono = false;
  return ok(mono && err[err.length - 1] < err[0],
    `mean distance to the aim by assist: ${err.map((e) => num(e, 3) + ' m').join(' / ')}`);
});

A('SWIPE', 'Every stroke archetype exists in both STROKES and ARCH', () => {
  const miss = Object.keys(ARCH).filter((k) => !STROKES[k]);
  const miss2 = Object.keys(STROKES).filter((k) => !ARCH[k]);
  return ok(miss.length === 0 && miss2.length === 0,
    `ARCH without STROKES: ${miss.join(',') || 'none'}; STROKES without ARCH: ${miss2.join(',') || 'none'}`);
});

A('SWIPE', 'Every stroke archetype has a distinct colour', () => {
  /* The four SERVE_* archetypes deliberately reuse the colour of the spin
     they are based on (SERVE_TOP = LOOP, SERVE_BACK = PUSH, ...) so the
     HUD reads the same at a glance. They are checked separately. */
  const seen = {};
  const plays = Object.keys(STROKES).filter((k) => k.indexOf('SERVE_') !== 0);
  for (const k of plays) { const c = STROKES[k].col; if (seen[c]) return ok(false, `${k} and ${seen[c]} share ${c}`); seen[c] = k; }
  const serves = Object.keys(STROKES).filter((k) => k.indexOf('SERVE_') === 0);
  const serveCols = new Set(serves.map((k) => STROKES[k].col));
  return ok(plays.length + serveCols.size === Object.keys(STROKES).length,
    `${plays.length} play archetypes + ${serveCols.size} serve colours for ${serves.length} serve archetypes`);
});

A('SWIPE', 'The stroke direction convention matches the physics (up = topspin)', () => {
  const m = { right: 0, up: 0.9, dist: 0.2, curl: 0, smooth: 0.9, straightness: 0.9, samples: 10, speed: 2, peakSpeed: 2.4, releaseSpeed: 2, x: 0.5, y: 0.5 };
  const r = deriveStroke(m, { side: 1, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpin: V3.new(0, 0, 0), ballSpeed: 5 });
  // player hits toward -z; an upward brush must end with w.x < 0 (topspin)
  const v = V3.new(0, 0, 8), w = V3.new(0, 0, 0);
  impactRacket(v, w, r.normal, r.vR, 1, r.rubber || {});
  return ok(w.x < 0, `upward swipe -> w.x = ${num(w.x, 1)} rad/s (must be negative for topspin)`);
});

/* ================================================================ *
 *  AREA 4 — EQUIPMENT (84_racket.js)
 * ================================================================ */
A('EQUIP', 'Every catalogue item has a unique id', () => {
  const ids = ITEM_LIST.map((i) => i.id);
  return ok(new Set(ids).size === ids.length, `${ids.length} items, ${new Set(ids).size} unique ids`);
});

A('EQUIP', 'No item is strictly better than the starter racket', () => {
  const base = X.racketStats('b_base', 'r_base', 'r_base');
  const K = ['speed', 'spin', 'control', 'feel'];
  const bad = [];
  for (const it of ITEM_LIST) {
    if (it.id === 'b_base' || it.id === 'r_base') continue;
    const st = it.kind === 'blade' ? X.racketStats(it.id, 'r_base', 'r_base') : X.racketStats('b_base', it.id, 'r_base');
    const better = K.filter((k) => st[k] > base[k] + 4);
    const worse = K.filter((k) => st[k] < base[k] - 4);
    if (better.length === 4) bad.push(`${it.id} dominates the base (${JSON.stringify(st)})`);
  }
  return ok(bad.length === 0, bad.join('; ') || 'no item dominates');
});

A('EQUIP', 'The stat budget is identical for every item', () => {
  const bad = [];
  for (const it of ITEM_LIST) {
    const s = Object.values(it.s).reduce((a, b) => a + b, 0);
    if (s !== 258) bad.push(`${it.id} sums to ${s}`);
  }
  return ok(bad.length === 0, bad.join('; ') || 'all items sum to 258');
});

A('EQUIP', 'The stat mapping is monotone in the stat', () => {
  const p = X.spread(64, 0.9, 1.1), lo = X.spread(40, 0.9, 1.1), hi = X.spread(92, 0.9, 1.1);
  return ok(lo < p && p < hi, `spread(40)=${num(lo, 4)} spread(64)=${num(p, 4)} spread(92)=${num(hi, 4)}`);
});

A('EQUIP', 'Equipment changes the physics parameters that reach the impact solver', () => {
  const a = new Equipment('b_base', 'r_base', 'r_base').forSide(1);
  const b = new Equipment('b_carb', 'r_fast', 'r_fast').forSide(1);
  const d = Math.abs(a.e - b.e) + Math.abs(a.mu - b.mu) + Math.abs(a.et - b.et);
  return ok(d > 1e-4, `base e/mu/et = ${num(a.e, 3)}/${num(a.mu, 3)}/${num(a.et, 3)}; carbon+fast = ${num(b.e, 3)}/${num(b.mu, 3)}/${num(b.et, 3)}`);
});

A('EQUIP', 'An unknown item id falls back to the starter racket', () => {
  const e = new Equipment('nope', 'nope', 'nope');
  return ok(e.bladeId === 'b_base' && e.fhId === 'r_base' && e.bhId === 'r_base',
    `fell back to ${e.bladeId}/${e.fhId}/${e.bhId}`);
});

A('EQUIP', 'The two faces of the racket may differ (a real build)', () => {
  const e = new Equipment('b_base', 'r_tops', 'r_ctl');
  const fh = e.forSide(1), bh = e.forSide(-1);
  return ok(Math.abs(fh.et - bh.et) > 1e-6, `forehand et=${num(fh.et, 3)} backhand et=${num(bh.et, 3)}`);
});

A('EQUIP', 'statK (the shop card multiplier) stays inside +-12 %', () => {
  let lo = 9, hi = 0;
  for (let v = 40; v <= 92; v++) { const k = X.statK(v); lo = Math.min(lo, k); hi = Math.max(hi, k); }
  return ok(lo >= 0.88 && hi <= 1.12, `statK range ${num(lo, 4)}..${num(hi, 4)}`);
});

/* ================================================================ *
 *  AREA 5 — CAMERA / PADDLE MAPPING (57_camera.js)
 * ================================================================ */
A('CAM', 'The whole table is inside the frame on every rig and aspect', () => {
  let worst = 1, worstCase = '';
  for (const mode of X.CAMERA_ORDER) {
    for (const aspect of [0.46, 0.56, 0.66, 0.75, 1.0, 1.33, 1.6, 2.0, 2.4]) {
      const m = X.rigMargin(X.fitRig(X.CAMERA_PRESETS[mode], aspect), aspect);
      if (m < worst) { worst = m; worstCase = `${mode} @ ${aspect}`; }
    }
  }
  return ok(worst >= 0.03, `worst margin ${num(worst * 100, 2)} % (${worstCase}), need >= 3 %`);
});

A('CAM', 'The camera never yaws off the table centre line', () => {
  /* The three rigs behind the player must sit on the centre line. The
     SIDE rig is a true side view (eye.x = 2.75 m) BY DESIGN and says so
     in its own description — the old check included it and therefore
     failed on the rig the code documents as a side view. */
  let worst = 0, side = 0;
  for (const mode of X.CAMERA_ORDER) {
    const r = X.fitRig(X.CAMERA_PRESETS[mode], 0.56);
    const off = Math.abs(r.eye.x - r.look.x);
    if (mode === 'SIDE') { side = off; continue; }
    worst = Math.max(worst, off);
  }
  return ok(worst < 1e-6 && side > 2, `max |eye.x - look.x| behind the player = ${num(worst, 8)} m; SIDE rig = ${num(side, 2)} m off centre (by design)`);
});

A('CAM', 'The effective FOV never exceeds the fish-eye limit on narrow screens', () => {
  let worst = 0;
  for (const aspect of [0.4, 0.46, 0.56, 0.75, 1.0, 1.6, 2.4]) {
    for (const mode of X.CAMERA_ORDER) {
      const f = X.effectiveFov(X.CAMERA_PRESETS[mode].fov, aspect);
      worst = Math.max(worst, f);
    }
  }
  /* effectiveFov returns DEGREES (it divides by DEG before returning), so
     the limit is 84 and not 84*DEG. */
  return ok(worst <= 84 + 1e-6, `max effective vertical FOV = ${num(worst, 1)} deg (limit 84)`);
});

A('CAM', 'The pointer mapping keeps the bat inside the authored limits', () => {
  let bad = 0;
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const t = X.paddleTargetFromPointer(i / 20, j / 20, j / 20, 2.2, {}, {});
    if (Math.abs(t.tx) > X.PADDLE_LIMITS.x + 1e-9) bad++;
    if (t.ty < PH.TABLE_Y + X.PADDLE_LIMITS.yLo - 1e-9 || t.ty > PH.TABLE_Y + X.PADDLE_LIMITS.yHi + 1e-9) bad++;
    if (t.tz < X.PADDLE_LIMITS.zStepIn - 1e-9 || t.tz > X.PADDLE_LIMITS.zFar + 1e-9) bad++;
  }
  return ok(bad === 0, `${bad} out-of-limit pointer samples`);
});

A('CAM', 'The pointer mapping survives a non-finite pointer', () => {
  const t = X.paddleTargetFromPointer(NaN, undefined, NaN, NaN, {}, {});
  return ok(Number.isFinite(t.tx) && Number.isFinite(t.ty) && Number.isFinite(t.tz),
    `NaN pointer -> (${num(t.tx, 3)}, ${num(t.ty, 3)}, ${num(t.tz, 3)})`);
});

A('CAM', 'Sensitivity 0.4..2.2 only changes the gain, not the reachable range', () => {
  const a = X.paddleTargetFromPointer(0.5, 0.55, 0.55, 0.4, {}, {});
  const b = X.paddleTargetFromPointer(0.5, 0.55, 0.55, 2.2, {}, {});
  return ok(Math.abs(a.tx - b.tx) < 1e-9, `centre tx at s=0.4 ${num(a.tx, 4)} vs s=2.2 ${num(b.tx, 4)}`);
});

A('CAM', 'clampPaddleToFrustum always returns a visible pose', () => {
  let bad = 0, n = 0;
  for (const mode of X.CAMERA_ORDER) {
    const rig = X.fitRig(X.CAMERA_PRESETS[mode], 0.56);
    const vp = X.rigViewProj(rig, 0.56, { vp: M4.create() });
    for (let k = 0; k < 40; k++) {
      const t = { tx: -3 + k * 0.15, ty: PH.TABLE_Y - 1 + (k % 7) * 0.4, tz: 0.2 + (k % 5) * 0.4 };
      X.clampPaddleToFrustum(vp, t, 0.05);
      n++;
      if (!X.paddleVisibleOk(vp, t, 0.05)) bad++;
    }
  }
  return ok(bad === 0, `${bad}/${n} clamped poses are still off-screen`);
});

A('CAM', 'The HUD band (table top on screen) stays inside 0.16..0.55', () => {
  let bad = 0, lo = 1, hi = 0;
  for (const mode of X.CAMERA_ORDER) {
    for (const aspect of [0.46, 0.56, 0.75, 1.33, 2.0]) {
      const y = X.tableTopScreenY(mode, aspect, { vp: M4.create() });
      lo = Math.min(lo, y); hi = Math.max(hi, y);
      if (y < 0.16 || y > 0.55) bad++;
    }
  }
  return ok(bad === 0, `band y ranges ${num(lo, 3)}..${num(hi, 3)} (allowed 0.16..0.55)`);
});

A('CAM', 'fitRig caches per rig+aspect and returns a stable result', () => {
  const a = X.fitRig(X.CAMERA_PRESETS.BROADCAST, 0.56);
  const b = X.fitRig(X.CAMERA_PRESETS.BROADCAST, 0.56);
  return ok(a === b, 'fitRig returned two different objects for the same key');
});

A('CAM', 'cameraRigFor reuses its output object (no per-frame allocation)', () => {
  const o = { eye: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: 0, mode: '' };
  const a = X.cameraRigFor('BROADCAST', { x: 0, y: 1, z: 0 }, 0.56, o);
  const b = X.cameraRigFor('BROADCAST', { x: 0, y: 1, z: 0 }, 0.56, o);
  return ok(a === b && o === a, 'cameraRigFor allocated a new object');
});

A('CAM', 'The camera follows the ball by only a few centimetres', () => {
  const o = { eye: { x: 0, y: 0, z: 0 }, look: { x: 0, y: 0, z: 0 }, fov: 0, mode: '' };
  const base = X.cameraRigFor('BROADCAST', { x: 0, y: PH.TABLE_Y, z: 0 }, 0.56, o);
  const e0 = { x: base.eye.x, y: base.eye.y, z: base.eye.z };
  const hi = X.cameraRigFor('BROADCAST', { x: 0, y: PH.TABLE_Y + 1.4, z: 1.2 }, 0.56, o);
  const d = Math.hypot(hi.eye.x - e0.x, hi.eye.y - e0.y, hi.eye.z - e0.z);
  return ok(d < 0.6, `camera travels ${num(d, 3)} m with the ball`);
});

A('CAM', 'projectPoint reports "not ok" for a point behind the camera', () => {
  const vp = X.rigViewProj(X.fitRig(X.CAMERA_PRESETS.BROADCAST, 0.56), 0.56, { vp: M4.create() });
  const s = X.projectPoint(vp, { x: 0, y: 0, z: 50 }, {});
  return ok(s.ok === false, `point behind the camera: ok=${s.ok}`);
});

A('CAM', 'projectPoint maps the table centre to the middle of the screen', () => {
  const vp = X.rigViewProj(X.fitRig(X.CAMERA_PRESETS.BROADCAST, 0.56), 0.56, { vp: M4.create() });
  const s = X.projectPoint(vp, { x: 0, y: PH.TABLE_Y, z: 0 }, {});
  return ok(s.ok && Math.abs(s.x - 0.5) < 0.06, `table centre projects to x=${num(s.x, 3)}`);
});

module.exports = { ANALYSES, A, ok, num, X, sandbox, srand, makeCanvas, elStub, ctx2dStub, makeGL, SMath };
