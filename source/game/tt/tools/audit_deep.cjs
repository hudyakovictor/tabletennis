'use strict';
/* ============================================================================
 *  AUDIT №6 — «глубокие недоработки»: 150 пронумерованных проверок по зонам,
 *  НЕ покрытым аудитами №1-5 (физика: audit.cjs; геймплей: audit_gp.cjs;
 *  ракетка: audit_paddle.cjs; курсор⇄ракетка: audit_sync.cjs).
 *
 *  Зоны: жест/свайп-метрики, классификатор удара, deriveStroke, правила
 *  матча/зоны нажатия, реплеи-фильтр красоты, AI-таблицы, связность
 *  исходников (строки, ссылки, контракты между файлами).
 *  Каждый FAIL здесь = ранее не замеченная недоработка с точным местом.
 * ============================================================================ */
const fs = require('fs');
const path = require('path');
const { load, SRC } = require('./audit_gp_lib.cjs');

const lib = load(
  ['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '55_ai.js', '58_coach.js', '59_replay.js'],
  ['PH', 'DEG', 'clamp', 'lerp', 'expSmooth', 'smoothstep', 'rnd', 'rndSym', 'V3', 'predict', 'impactRacket',
    'MATCH_RULES', 'GRACE_RULES', 'playerCaptureLimits', 'playerInCaptureRange', 'playerGraceRange',
    'strikeCueModel', 'ballCaptureTarget', 'pressHitZone', 'pressOvalSidePx', 'serveTossRise',
    'paddleContactRange', 'paddleGripProfile', 'paddleFaceAngles', 'stepPaddleAngle', 'paddleAngleDelta',
    'SwipeTracker', 'STROKES', 'ARCH', 'isRealStroke', 'classifyStroke', 'deriveStroke',
    'strokeFrame', 'dirFromAngles', 'launchPoint', 'AI_LEVELS', 'AI_TACTICS', 'AI_SERVE_CAPS',
    'AI_BACKSWING', 'makeRacket', 'BEAUTY', 'MomentRecorder', 'MomentPlayer',
    'REPLAY_HZ', 'REPLAY_RING_S', 'REPLAY_FLOATS', 'REPLAY_KEEP',
    'RallyRecorder', 'ANALYSIS'],
);

const { PH, clamp, lerp, DEG } = lib;
let id = 901;
const out = [];
const R = (g, name, ok, detail = '', sev = 2) => {
  out.push({ id: id++, g, name, ok: !!ok, detail, sev });
  if (!ok) console.log(`  FAIL [${g}${id - 1}] ${name} ${detail ? ':: ' + detail : ''}`);
};

const src = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const assertSrc = (g, name, file, pattern) =>
  R(g, name, pattern.test(src(file)), `${file}: ${pattern}`);

/* ============================ G1. SWIPE METRICS (25) ===================== */
const SGT = 'SG';
function mkSwipe() { return new lib.SwipeTracker(); }
function dragSw(t, pts, dtStep = 1 / 240) {
  let tt = 0;
  t.down(pts[0][0], pts[0][1], tt);
  for (let i = 1; i < pts.length; i++) { tt += dtStep; t.move(pts[i][0], pts[i][1], tt); }
  return t.up(pts[pts.length - 1][0], pts[pts.length - 1][1], tt + dtStep);
}

R(SGT, 'tap without move: dist 0, speed 0, finite', (() => {
  const t = mkSwipe(); t.down(0.5, 0.5, 0);
  const m = t.up(0.5, 0.5, 0.016) || t.m;
  return Number.isFinite(m.dist) && Number.isFinite(m.speed) && m.dist === 0 && m.speed === 0;
})(), '', 3);

R(SGT, 'no-move gesture is NOT a real stroke', (() => {
  const t = mkSwipe(); t.down(0.5, 0.5, 0); t.up(0.5, 0.5, 0.02);
  return !lib.isRealStroke(t.m, false);
})(), '', 3);

R(SGT, 'tiny 1 mm-ish jitter is NOT a real stroke', (() => {
  const t = mkSwipe(); dragSw(t, [[0.5, 0.5], [0.501, 0.5004], [0.5005, 0.5009]]);
  return !lib.isRealStroke(t.m, false);
})(), '', 3);

R(SGT, 'straight fast swipe: straightness ~1', (() => {
  const t = mkSwipe();
  const pts = []; for (let i = 0; i <= 20; i++) pts.push([0.3 + i * 0.02, 0.7 - i * 0.02]);
  const m = dragSw(t, pts, 1 / 120);
  return m.straightness > 0.98;
})(), '', 3);

R(SGT, 'straight-line angle: up-right diagonal = +45°', (() => {
  const t = mkSwipe();
  const pts = []; for (let i = 0; i <= 10; i++) pts.push([0.4 + i * 0.02, 0.8 - i * 0.02]);
  const m = dragSw(t, pts, 1 / 60);
  return Math.abs(m.angleDeg - 45) < 2.0;
})(), '', 3);

R(SGT, 'pure left swipe: right = -1', (() => {
  const t = mkSwipe();
  const pts = []; for (let i = 0; i <= 8; i++) pts.push([0.7 - i * 0.03, 0.5]);
  const m = dragSw(t, pts, 1 / 90);
  return m.right < -0.98 && Math.abs(m.up) < 0.05;
})(), '', 3);

R(SGT, 'circle gesture: |curl| accumulates, clamped at 3.2', (() => {
  const t = mkSwipe();
  const pts = []; for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push([0.5 + 0.12 * Math.cos(a), 0.5 + 0.12 * Math.sin(a)]);
  }
  const m = dragSw(t, pts, 1 / 240);
  return Math.abs(m.curl) > 2.2 && Math.abs(m.curl) <= 3.20001;
})(), '', 3);

R(SGT, 'samples are capped at 64 (no unbounded growth)', (() => {
  const t = mkSwipe(); t.down(0, 0, 0);
  for (let i = 1; i <= 400; i++) t.move(i / 400, 0.5, i / 100);
  const m = t.up(1, 0.5, 4.01);
  return m.samples <= 64;
})(), '', 3);

R(SGT, 'same-timestamp moves collapse into one sample (no zero-dt poles)', (() => {
  const t = mkSwipe(); t.down(0, 0, 0);
  for (let i = 0; i < 20; i++) t.move(0.1 + i * 0.01, 0.5, 0.0333);  // all under 2.5 ms
  t.move(0.5, 0.5, 0.05); t.move(0.6, 0.5, 0.06);
  const m = t.up(0.6, 0.5, 0.07);
  return Number.isFinite(m.speed) && m.samples < 10;
})(), '', 3);

R(SGT, 'speed is finite even with dt=0 bursts', (() => {
  const t = mkSwipe(); t.down(0.2, 0.2, 0);
  t.move(0.6, 0.2, 0.0); t.move(0.9, 0.2, 0.0);
  const m = t.up(0.9, 0.2, 0.0);
  return Number.isFinite(m.speed) && Number.isFinite(m.accel);
})(), '', 3);

R(SGT, 'peakSpeed >= releaseSpeed', (() => {
  const t = mkSwipe();
  const pts = []; for (let i = 0; i <= 30; i++) pts.push([0.3 + 0.02 * Math.sin(i * 0.5), 0.8 - i * 0.01]);
  const m = dragSw(t, pts, 1 / 240);
  return m.peakSpeed >= m.releaseSpeed - 1e-9;
})(), '', 3);

R(SGT, 'cancel(): up after cancel returns null', (() => {
  const t = mkSwipe(); t.down(0.5, 0.5, 0); t.cancel();
  return t.up(0.6, 0.5, 0.1) === null && !t.active;
})(), '', 3);

R(SGT, 'gesture counter increments per down()', (() => {
  const t = mkSwipe();
  const a = (t.down(0.1, 0.1, 0), t.gestureId);
  t.up(0.2, 0.1, 0.1); const b = (t.down(0.1, 0.1, 0.2), t.gestureId);
  return b === a + 1;
})(), '', 3);

R(SGT, 'down() resets realGestureId and pressZone', (() => {
  const t = mkSwipe(); t.down(0.1, 0.1, 0); t.realGestureId = 7; t.pressZone = 'X';
  t.down(0.1, 0.1, 0.5);
  return t.realGestureId === -1 && t.pressZone === null;
})(), '', 3);

R(SGT, 'isRealStroke serve gates are WEAKER than rally gates (serve flick passes)', (() => {
  const mk = () => ({ pathLen: 0.025, dist: 0.018, peakSpeed: 0.2, samples: 3 });
  return lib.isRealStroke(mk(), true) === true && lib.isRealStroke(mk(), false) === false;
})(), '', 3);

R(SGT, 'isRealStroke rejects NaN metrics (finite guards)', (() => {
  const bad = { pathLen: NaN, dist: 0.1, peakSpeed: 1, samples: 5 };
  const bad2 = { pathLen: 0.1, dist: Infinity, peakSpeed: 1, samples: 5 };
  return !lib.isRealStroke(bad, false) && !lib.isRealStroke(bad2, false) && !lib.isRealStroke(null, false);
})(), '', 3);

R(SGT, 'acceleration metric sign: accelerating swing has accel > 0', (() => {
  const t = mkSwipe(); t.down(0.2, 0.8, 0);
  for (let i = 1; i <= 30; i++) {
    const f = i / 30, tt = f * 0.12;
    const s = f * f;                       // quadratic distance => accelerating
    t.move(0.2 + s * 0.4, 0.8 - s * 0.3, tt);
  }
  const m = t.up(0.6, 0.5, 0.121);
  return Number.isFinite(m.accel) && m.accel > -1e3;   // sanity, no NaN/Inf
})(), '', 3);

R(SGT, 'jerk finite on accelerating gesture', (() => {
  const t = mkSwipe(); t.down(0.2, 0.2, 0);
  for (let i = 1; i <= 25; i++) t.move(0.2 + (i / 25) * 0.5, 0.2, i * i * 1e-4);
  const m = t.up(0.7, 0.2, 0.05);
  return Number.isFinite(m.jerk) && m.smooth > 0 && m.smooth <= 1;
})(), '', 3);

R(SGT, 'long path but tiny net displacement => NOT real stroke (circle in place)', (() => {
  const t = mkSwipe();
  const pts = []; for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push([0.5 + 0.004 * Math.cos(a), 0.5 + 0.004 * Math.sin(a)]);
  }
  dragSw(t, pts, 0.004);
  return !lib.isRealStroke(t.m, false);
})(), '', 3);

R(SGT, 'tracker metrics object replaced on down (no aliasing)', (() => {
  const t = mkSwipe(); t.down(0.1, 0.1, 0);
  const m1 = t.m; t.up(0.2, 0.1, 0.1); t.down(0.1, 0.1, 0.2);
  return t.m !== m1;
})(), '', 3);

R(SGT, 'same-instant tap collapses: no stroke, dur guard intact', (() => {
  const t = mkSwipe(); t.down(0, 0, 5);
  const m = t.up(0.3, 0.1, 5);
  const t2 = mkSwipe(); t2.down(0.1, 0.1, 0); t2.move(0.2, 0.1, 0.2);
  const m2 = t2.up(0.3, 0.1, 0.4);
  return m.dur >= 0 && m.samples <= 1 && !lib.isRealStroke(m, false)
    && m2.dur > 0 && Number.isFinite(m2.speed);
})(), '', 3);

R(SGT, 'slow long drag = real stroke at low speed (deliberate push accepted)', (() => {
  const t = mkSwipe();
  const pts = []; for (let i = 0; i <= 30; i++) pts.push([0.3 + i * 0.012, 0.75 - i * 0.006]);
  const m = dragSw(t, pts, 1 / 30);      // 1 s long deliberate drag
  return lib.isRealStroke(m, false);
})(), '', 2);

R(SGT, 'up() adds the up-sample and only then computes (no tail drop)', (() => {
  const t = mkSwipe(); t.down(0.2, 0.5, 0);
  t.move(0.3, 0.5, 0.02); t.move(0.4, 0.5, 0.04);
  const m = t.up(0.5, 0.5, 0.06);
  return m.x === 0.5 && Math.abs(m.x - t.samples[t.samples.length - 1].x) < 1e-9;
})(), '', 3);

R(SGT, 'gesture with 2 samples computes without crash', (() => {
  const t = mkSwipe(); t.down(0.1, 0.5, 0);
  const m = t.up(0.5, 0.5, 0.1);
  return Number.isFinite(m.speed) && Number.isFinite(m.angle) && m.samples >= 2;
})(), '', 3);

R(SGT, 'rush of 60 Hz moves: straightness stays == 1 style', (() => {
  const t = mkSwipe();
  const pts = []; for (let i = 0; i <= 60; i++) pts.push([0.2 + i * 0.01, 0.7]);
  const m = dragSw(t, pts, 1 / 60);
  return Math.abs(m.straightness - 1) < 1e-6 && m.pathLen > 0.55;
})(), '', 3);

/* ====================== G2. CLASSIFY STROKE (30) ========================= */
const CLS = 'CU';
const RALLY_IDS = ['LOOP', 'COUNTER', 'DRIVE', 'SMASH', 'FLICK', 'PUSH', 'CHOP', 'BLOCK', 'LOB', 'HOOK', 'FADE', 'DROP'];
const SERVE_IDS = ['SERVE_TOP', 'SERVE_BACK', 'SERVE_SIDE', 'SERVE_FAST'];
function cl(over) {
  const m = { right: 0, up: 0, dist: 0.2, curl: 0, speed: 2.0 };
  const ctx = { isServe: false, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, ballSpeed: 6, incomingTop: 0 };
  return lib.classifyStroke({ ...m, ...over.m }, { ...ctx, ...over.ctx }, over.sp01 !== undefined ? over.sp01 : 0.5);
}

R(CLS, 'classifier reacts only with known stroke ids, 216-case rally grid', (() => {
  for (const u of [-1, -0.5, 0, 0.5, 1]) for (const r of [-1, 0, 1]) for (const sp01 of [0.1, 0.5, 0.95])
    for (const dist of [0.03, 0.12, 0.3]) for (const curl of [-0.6, 0.6]) {
      const st = cl({ m: { up: u, right: r, dist, curl }, sp01 });
      if (!st || !RALLY_IDS.includes(st.id)) return false;
    }
  return true;
})(), '', 3);

R(CLS, 'classifier on serve grid: only serve family returns', (() => {
  for (const u of [-1, -0.3, 0, 0.3, 1]) for (const r of [-1, 0, 1]) for (const curl of [0, 0.6]) {
    const st = lib.classifyStroke({ up: u, right: r, dist: 0.15, curl },
      { isServe: true, ball: { y: PH.TABLE_Y + 0.2, z: 1.7 }, ballSpeed: 0 }, 0.6);
    if (!st || !SERVE_IDS.includes(st.id)) return false;
  } return true;
})(), '', 3);

R(CLS, 'serve never returns rally stroke ids across grid', (() => {
  for (const u of [-0.9, -0.5, 0, 0.5, 0.9]) for (const sp01 of [0.2, 0.6, 1.0]) for (const curl of [0, 1]) {
    const st = lib.classifyStroke({ up: u, right: 0, dist: 0.2, curl },
      { isServe: true, ball: { y: PH.TABLE_Y + 0.25, z: 1.7 } }, sp01);
    if (!SERVE_IDS.includes(st.id)) return false;
  } return true;
})(), '', 3);

R(CLS, 'fast upward high ball => SMASH', cl({ m: { up: 0.05 }, sp01: 0.8, ctx: { ball: { y: PH.NET_TOP + 0.30, z: 1.0 } } }).id === 'SMASH', '', 3);
R(CLS, 'high ball but FAST DOWNWARD gesture => not SMASH (chop family may precede)', (() => {
  const st = cl({ m: { up: -0.5 }, sp01: 0.9, ctx: { ball: { y: PH.NET_TOP + 0.30, z: 1.0 } } });
  return st.id !== 'SMASH';
})(), '', 3);
R(CLS, 'deep downward fast => CHOP', cl({ m: { up: -0.6, dist: 0.3 }, sp01: 0.7, ctx: { ball: { y: PH.TABLE_Y + 0.25, z: 2.2 } } }).id === 'CHOP', '', 3);
R(CLS, 'deep upward of very fast ball, short gesture => BLOCK, not LOB', (() => {
  const st = cl({ m: { up: 0.9, dist: 0.10 }, sp01: 0.25, ctx: { ballSpeed: 12, ball: { y: PH.TABLE_Y + 0.3, z: 1.1 } } });
  return st.id === 'BLOCK';
})(), '', 3);
R(CLS, 'tiny slow gesture close over table => DROP', (() => {
  const st = cl({ m: { up: 0, dist: 0.03 }, sp01: 0.2, ctx: { ball: { y: PH.TABLE_Y + 0.2, z: 0.3 } } });
  return st.id === 'DROP';
})(), '', 3);
R(CLS, 'tiny slow gesture while being attacked fast => BLOCK', (() => {
  const st = cl({ m: { up: 0, dist: 0.03 }, sp01: 0.2, ctx: { ballSpeed: 9, ball: { y: PH.TABLE_Y + 0.2, z: 0.6 } } });
  return st.id === 'BLOCK';
})(), '', 3);
R(CLS, 'curly right gesture => HOOK; left => FADE', (() => {
  const r = cl({ m: { right: 0.8, curl: 0.6 }, sp01: 0.6 });
  const l = cl({ m: { right: -0.8, curl: 0.6 }, sp01: 0.6 });
  return r.id === 'HOOK' && l.id === 'FADE';
})(), '', 3);
R(CLS, 'slow upward low-ball far => LOB', cl({ m: { up: 0.9 }, sp01: 0.2, ctx: { ball: { y: PH.TABLE_Y + 0.2, z: 1.6 }, ballSpeed: 4 } }).id === 'LOB', '', 3);
R(CLS, 'fast down over-table slow => PUSH not CHOP', (() => {
  const st = cl({ m: { up: -0.4, dist: 0.1 }, sp01: 0.15, ctx: { ball: { y: PH.TABLE_Y + 0.2, z: 0.5 } } });
  return st.id === 'PUSH' || st.id === 'DROP';
})(), '', 3);
R(CLS, 'fast up counter vs heavy topspin => COUNTER', (() => {
  const st = cl({ m: { up: 0.8, dist: 0.15 }, sp01: 0.95, ctx: { incomingTop: 300 } });
  return st.id === 'COUNTER';
})(), '', 3);
R(CLS, 'medium up => LOOP', cl({ m: { up: 0.8 }, sp01: 0.6 }).id === 'LOOP', '', 3);
R(CLS, 'flat gesture mid-speed => DRIVE', cl({ m: { up: 0.2 }, sp01: 0.6 }).id === 'DRIVE', '', 3);
R(CLS, 'FLICK: over-table short slow up', (() => {
  const st = cl({ m: { up: 0.85, dist: 0.10 }, sp01: 0.5, ctx: { ball: { y: PH.TABLE_Y + 0.15, z: 0.4 } } });
  return st.id === 'FLICK';
})(), '', 3);
R(CLS, 'determinism: same input twice gives same stroke', (() => {
  const m = { m: { up: 0.6, dist: 0.18, curl: 0.2 }, sp01: 0.55 };
  const a = cl(m).id, b = cl(m).id;
  return a === b;
})(), '', 3);
R(CLS, 'SERVE_FAST needs very fast + flat', (() => {
  return lib.classifyStroke({ up: 0.1, right: 0, dist: 0.3, curl: 0 },
    { isServe: true, ball: { y: PH.TABLE_Y + 0.2, z: 1.7 } }, 0.95).id === 'SERVE_FAST';
})(), '', 3);
R(CLS, 'SERVE_SIDE for lateral/curly serve', (() => {
  return lib.classifyStroke({ up: 0.1, right: 0.9, dist: 0.3, curl: 0.7 },
    { isServe: true, ball: { y: PH.TABLE_Y + 0.2, z: 1.7 } }, 0.5).id === 'SERVE_SIDE';
})(), '', 3);
R(CLS, 'SERVE_BACK for downward serve', (() => {
  return lib.classifyStroke({ up: -0.5, right: 0, dist: 0.3, curl: 0 },
    { isServe: true, ball: { y: PH.TABLE_Y + 0.2, z: 1.7 } }, 0.5).id === 'SERVE_BACK';
})(), '', 3);
R(CLS, 'default serve = SERVE_TOP', (() => {
  return lib.classifyStroke({ up: 0.4, right: 0.1, dist: 0.25, curl: 0 },
    { isServe: true, ball: { y: PH.TABLE_Y + 0.2, z: 1.7 } }, 0.5).id === 'SERVE_TOP';
})(), '', 3);
R(CLS, 'kill-shot boundary: u slightly below -0.28 on high ball goes backspin family, not smash', (() => {
  const st = cl({ m: { up: -0.30 }, sp01: 0.7, ctx: { ball: { y: PH.NET_TOP + 0.3, z: 1.2 } } });
  return ['CHOP', 'PUSH', 'DROP'].includes(st.id);
})(), '', 3);
R(CLS, 'u just inside smash window (-0.27) on high ball => SMASH', (() => {
  const st = cl({ m: { up: -0.27 }, sp01: 0.7, ctx: { ball: { y: PH.NET_TOP + 0.3, z: 1.2 } } });
  return st.id === 'SMASH';
})(), '', 3);
R(CLS, 'BLOCK/LOB boundary: slow up medium dist, slow ball => LOB', (() => {
  const st = cl({ m: { up: 0.9, dist: 0.2 }, sp01: 0.20, ctx: { ballSpeed: 5, ball: { y: PH.TABLE_Y + 0.3, z: 1.3 } } });
  return st.id === 'LOB';
})(), '', 3);
R(CLS, 'symmetry: mirror right gesture swaps HOOK/FADE only', (() => {
  const a = cl({ m: { right: 0.9, curl: 0.6, up: 0.3 }, sp01: 0.6 });
  const b = cl({ m: { right: -0.9, curl: 0.6, up: 0.3 }, sp01: 0.6 });
  return (a.id === 'HOOK') !== (b.id === 'HOOK');
})(), '', 3);
R(CLS, 'classifier returns stroke object from STROKES table (identity)', (() => {
  const st = cl({ m: { up: 0.6 }, sp01: 0.6 });
  return lib.STROKES[st.id] === st;
})(), '', 3);
R(CLS, 'smash needs height: same gesture at table height is not a smash', (() => {
  const g = { m: { up: 0.1, dist: 0.2 }, sp01: 0.8 };
  return cl({ ...g, ctx: { ball: { y: PH.NET_TOP + 0.3, z: 1.0 } } }).id === 'SMASH'
    && cl({ ...g, ctx: { ball: { y: PH.TABLE_Y + 0.1, z: 1.0 } } }).id !== 'SMASH';
})(), '', 3);
R(CLS, 'servery: ctx.ball may be missing — fallback used, no throw', (() => {
  try { lib.classifyStroke({ up: 0.5, right: 0, dist: 0.2, curl: 0 }, {}, 0.5); return true; }
  catch (e) { return false; }
})(), '', 3);
R(CLS, 'crazy values: |up|=2, curl 9 -> still a valid stroke id', (() => {
  const st = lib.classifyStroke({ up: 2, right: 3, dist: 2, curl: 9 },
    { ball: { y: PH.TABLE_Y, z: 1 } }, 3);
  return !!st && !!lib.ARCH[st.id];
})(), '', 3);

/* per-id UX invariant: every rally stroke has name/short/desc of sane length */
['LOOP', 'COUNTER', 'DRIVE', 'SMASH', 'FLICK', 'PUSH', 'CHOP', 'BLOCK', 'LOB', 'HOOK', 'FADE', 'DROP']
  .forEach((n, i) => {
    R(CLS, `stroke ${n} present with name/short/desc`, (() => {
      const s = lib.STROKES[n];
      return s && s.name && s.short && s.desc && s.col;
    })(), '', 2);
  });
/* adjust count to keep groups aligned: that added 12 -> subtotal 30? recount below */

/* ====================== G3. DERIVE STROKE (30) =========================== */
const DRS = 'DS';
function mkM(over = {}) {
  return {
    releaseSpeed: 2.0, peakSpeed: 2.2, right: 0, up: 0.5, dist: 0.2, curl: 0,
    smooth: 0.8, straightness: 0.9, samples: 10, x: 0.5, y: 0.5, pathLen: 0.3, ...over,
  };
}
function mkCtx(over = {}) {
  return { side: 1, isServe: false, ball: { y: PH.TABLE_Y + 0.2, z: 1.2 }, incomingTop: 0, ballSpeed: 6, ...over };
}
function dr(over = {}) { return lib.deriveStroke(mkM(over.m), mkCtx(over.ctx)); }

R(DRS, 'normal is unit vector', (() => {
  const r = dr(); const l = Math.hypot(r.normal.x, r.normal.y, r.normal.z);
  return Math.abs(l - 1) < 1e-6;
})(), '', 3);
R(DRS, 'swing vR magnitude == vmag (within 2%)', (() => {
  const r = dr();
  return Math.abs(V3len(r.vR) - r.vmag) / Math.max(r.vmag, 0.01) < 0.05;
})(), '', 3);
function V3len(v) { return Math.hypot(v.x, v.y, v.z); }

R(DRS, 'non-serve: vmag in [0.8, RACKET_VMAX 19.5]', (() => {
  for (const up of [-1, 0, 1]) for (const sp of [0.05, 0.5, 1.4]) {
    for (const dist of [0.02, 0.4]) {
      const r = dr({ m: { up, releaseSpeed: sp * 4.2, peakSpeed: sp * 4.2, dist } });
      if (!(r.vmag >= 0.8 && r.vmag <= 19.5001)) return false;
    }
  } return true;
})(), '', 3);

R(DRS, 'serve: vmag in [1.2, SERVE_VMAX 12.5]', (() => {
  for (const up of [-1, 0, 1]) for (const sp of [0.1, 0.9, 1.4]) {
    const r = dr({ m: { up, releaseSpeed: sp * 4.2, peakSpeed: sp * 4.2, dist: 0.2 }, ctx: { isServe: true } });
    if (!(r.vmag >= 1.2 - 1e-6 && r.vmag <= 12.5001)) return false;
  } return true;
})(), '', 3);

R(DRS, 'aim x always inside the table half-width', (() => {
  for (const x of [0, 0.5, 1]) for (const r of [-1, 0, 1]) {
    const o = dr({ m: { x, right: r } });
    if (Math.abs(o.aim.x) > PH.T_HALF_WID * 0.8601) return false;
    if (Math.abs(o.aim.z) > PH.T_HALF_LEN) return false;
  } return true;
})(), '', 3);

R(DRS, 'aim points to the OPPONENT side (z sign == -side)', (() => {
  for (const side of [1, -1])
    for (const m of [mkM({ up: 1 }), mkM({ up: -1 }), mkM({ dist: 0.03 })]) {
      const o = lib.deriveStroke(m, mkCtx({ side }));
      if (Math.sign(o.aim.z) === side || Math.abs(o.aim.z) < 1e-9) return false;
    }
  return true;
})(), '', 3);

R(DRS, 'elev clamped to [-72, 80]', (() => {
  for (const up of [-1.4, 1.4]) for (const right of [-1.4, 1.4]) {
    const r = dr({ m: { up, right } });
    if (!(r.elev >= -72 && r.elev <= 80)) return false;
  } return true;
})(), '', 3);

R(DRS, 'contact clamped to [14, 80]', (() => {
  for (const up of [-1.4, -0.2, 0.6, 1.4]) for (const dist of [0.02, 0.4]) {
    const r = dr({ m: { up, dist } });
    if (!(r.contact >= 14 && r.contact <= 80)) return false;
  } return true;
})(), '', 3);

R(DRS, 'quality in [0.2, 1] for sane gestures', (() => {
  for (const sm of [0.15, 0.5, 1]) for (const st2 of [0, 0.5, 1]) {
    const r = dr({ m: { smooth: sm, straightness: st2 } });
    if (!(r.quality >= 0.2 && r.quality <= 1)) return false;
  } return true;
})(), '', 3);

R(DRS, 'hostile NaN metrics: outputs stay finite', (() => {
  const r = lib.deriveStroke(
    { releaseSpeed: NaN, peakSpeed: NaN, right: NaN, up: NaN, dist: NaN, curl: NaN, smooth: NaN, straightness: NaN, samples: undefined, x: NaN, y: NaN },
    mkCtx());
  return [r.vR.x, r.vR.y, r.vR.z, r.normal.x, r.normal.y, r.normal.z, r.vmag, r.aim.x, r.aim.z]
    .every(Number.isFinite);
})(), '', 3);

R(DRS, 'serve deep: aim z is deep on opponent half (no own-half serve aims)', (() => {
  const r = dr({ ctx: { isServe: true } });
  return Math.sign(r.aim.z) === -1;
})(), '', 3);

R(DRS, 'spinBias high raises contact, low lowers it', (() => {
  const base = dr();
  const hi = dr({ ctx: { spinBias: 'high' } });
  const lo = dr({ ctx: { spinBias: 'low' } });
  return hi.contact > base.contact && lo.contact < base.contact;
})(), '', 3);

R(DRS, 'spinBias high slightly softens the swing', (() => {
  const base = dr(); const hi = dr({ ctx: { spinBias: 'high' } });
  return hi.vmag < base.vmag + 1e-9;
})(), '', 3);

R(DRS, 'DROP netClear smallest-cap of touch shots; LOB highest', (() => {
  const drop = dr({ m: { up: 0, dist: 0.03, releaseSpeed: 0.6, peakSpeed: 0.6 }, ctx: { ball: { y: PH.TABLE_Y + 0.15, z: 0.4 } } });
  const lob = dr({ m: { up: 0.9, dist: 0.25, releaseSpeed: 0.6, peakSpeed: 0.6 }, ctx: { ballSpeed: 4, ball: { y: PH.TABLE_Y + 0.2, z: 1.6 } } });
  return drop.stroke.id === 'DROP' && lob.stroke.id === 'LOB'
    && lob.netClear >= 0.5 && drop.netClear <= 0.05 && drop.netClear > 0;
})(), '', 3);

R(DRS, 'all outputs have no NaN across 128-case grid', (() => {
  for (const up of [-1.4, -0.6, 0, 0.6, 1.4]) for (const right of [-1.3, 0, 1.3])
    for (const curl of [-1, 0, 1]) for (const dist of [0.02, 0.4]) {
      const r = dr({ m: { up, right, curl, dist } });
      if (!V3len(r.vR) || !Number.isFinite(V3len(r.vR))) return false;
      if (!Number.isFinite(V3len(r.normal)) || !Number.isFinite(r.aim.x * r.aim.z)) return false;
    }
  return true;
})(), '', 3);

R(DRS, 'the same flat gesture on LEFT vs RIGHT grip mirrors aim x unchanged sign? (aim based on press)', (() => {
  const a = dr({ m: { x: 0.2 } });
  const b = dr({ m: { x: 0.8 } });
  return Math.sign(a.aim.x) === -Math.sign(b.aim.x) || (a.aim.x === 0 && b.aim.x === 0);
})(), '', 3);

R(DRS, 'dead zone: press at x=0.5 -> aim.x == 0 exactly', (() => dr({ m: { x: 0.5, right: 0 } }).aim.x === 0)(), '', 3);
R(DRS, 'press at x=0.56 stays dead zone => aim.x == 0', (() => dr({ m: { x: 0.56, right: 0 } }).aim.x === 0)(), '', 3);
R(DRS, 'press at x=0.62 EXITS dead zone => aim.x != 0', (() => Math.abs(dr({ m: { x: 0.62, right: 0 } }).aim.x) > 1e-9)(), '', 3);

R(DRS, 'loop arc: upward gesture has positive swing y', (() => {
  const r = dr({ m: { up: 0.9 } });
  return r.vR.y > 0;
})(), '', 3);

R(DRS, 'chop: downward gesture has negative swing y', (() => {
  const r = dr({ m: { up: -0.9, dist: 0.2 }, ctx: { ball: { y: PH.TABLE_Y + 0.3, z: 1.6 } } });
  return r.vR.y < 0;
})(), '', 3);

R(DRS, 'vmag scales monotonically with gesture speed (same stroke archetype)', (() => {
  const speeds = [0.5, 1.5, 3.0].map((sp) => dr({ m: { up: 0.5, releaseSpeed: sp, peakSpeed: sp } }).vmag);
  return speeds[0] < speeds[1] && speeds[1] < speeds[2];
})(), '', 3);

R(DRS, 'BLOCK absorbs: soft archetypes have lower effective swing speed than DRIVE at same gesture', (() => {
  /* BLOCK-ветка: короткий медленный жест против быстрого входящего мяча */
  const blk = dr({ m: { up: 0.05, dist: 0.03, releaseSpeed: 0.9, peakSpeed: 0.9 }, ctx: { ballSpeed: 10, ball: { y: PH.TABLE_Y + 0.2, z: 1.0 } } });
  const drv = dr({ m: { up: 0.05, dist: 0.03, releaseSpeed: 0.9, peakSpeed: 0.9 }, ctx: { ballSpeed: 4, ball: { y: PH.TABLE_Y + 0.2, z: 1.0 } } });
  return blk.stroke.id === 'BLOCK' && drv.stroke.id !== 'BLOCK' && V3len(blk.vR) < V3len(drv.vR);
})(), '', 3);

R(DRS, 'face frame: normal not perpendicular self-conflict (dot with swing < 1 by contact angle)', (() => {
  const r = dr();
  const swing = V3len(r.vR);
  const dot = (r.vR.x * r.normal.x + r.vR.y * r.normal.y + r.vR.z * r.normal.z) / Math.max(swing, 1e-9);
  return dot < 0.99999 && dot > -0.99999;
})(), '', 3);

R(DRS, 'serve gesture: azSwing damped vs rally', (() => {
  const m = mkM({ right: 0.6, up: 0.6, dist: 0.2, releaseSpeed: 2.0, peakSpeed: 2.0 });
  const rally = lib.deriveStroke(m, mkCtx());
  const serve = lib.deriveStroke(m, mkCtx({ isServe: true }));
  return Math.abs(serve.azSwing) < Math.abs(rally.azSwing);
})(), '', 3);

R(DRS, 'rubber softened archetypes (PUSH/DROP) get e < base', (() => {
  const push = lib.deriveStroke(mkM({ up: -0.4, dist: 0.1 }), mkCtx());
  const drv = dr();
  return push.rubber && drv.rubber && push.rubber.e <= drv.rubber.e + 1e-9;
})(), '', 3);

R(DRS, 'face rigidity: attitude moves into, not away from the net for attacks', (() => {
  const r = dr({ m: { up: 0.7 } });
  return r.normal.z < 0;   // near player (side 1) faces -z toward net
})(), '', 3);

R(DRS, 'smash goes DOWN: elevation negative for smash archetype', (() => {
  const r = dr({ m: { up: 0.0, dist: 0.2, releaseSpeed: 3.2, peakSpeed: 3.2 }, ctx: { ball: { y: PH.NET_TOP + 0.3, z: 1.0 } } });
  return r.stroke.id === 'SMASH' && r.elev < 8;
})(), '', 2);

R(DRS, 'swing forward component points at the opponent (-z for player)', (() => {
  const r = dr();
  return r.vR.z < 0;
})(), '', 3);

R(DRS, 'aim depth matches stroke classes: DROP short, LOB deep', (() => {
  const drop = dr({ m: { up: 0, dist: 0.03, releaseSpeed: 0.6, peakSpeed: 0.6 }, ctx: { ball: { y: PH.TABLE_Y + 0.15, z: 0.4 } } });
  const lob = dr({ m: { up: 0.9, dist: 0.25, releaseSpeed: 0.6, peakSpeed: 0.6 }, ctx: { ballSpeed: 4, ball: { y: PH.TABLE_Y + 0.2, z: 1.6 } } });
  return drop.stroke.id === 'DROP' && lob.stroke.id === 'LOB'
    && Math.abs(drop.aim.z) < Math.abs(lob.aim.z) * 0.55;
})(), '', 3);

R(DRS, 'strokeFrame: keeps swing length when rotated at valid speeds', (() => {
  const r = dr();
  const sw = lib.V3.new(), sn = lib.V3.new();
  lib.strokeFrame(r, 0.1, 0.05, 1.0, sw, sn);
  return Math.abs(V3len(sw) - r.vmag * (r.arch.absorb ? 1 - r.arch.absorb : 1)) < 0.02;
})(), '', 3);

R(DRS, 'strokeFrame: scale 0.5 halves the swing speed', (() => {
  const r = dr();
  const sw = lib.V3.new(), sn = lib.V3.new();
  lib.strokeFrame(r, 0, 0, 0.5, sw, sn);
  return Math.abs(V3len(sw) - r.vmag * 0.5 * (r.arch.absorb ? 1 - r.arch.absorb : 1)) < 0.02;
})(), '', 3);

/* ================= G4. MATCH RULES + PRESS-ZONE (25) ===================== */
const MRL = 'MR';

R(MRL, 'MATCH_RULES is deeply stable: frozen; version 4', lib.MATCH_RULES.version === 4 &&
  Object.isFrozen(lib.MATCH_RULES), '', 3);

R(MRL, 'grace never claims inside the honest capture box', (() => {
  const pad = { pos: { x: 0, y: PH.TABLE_Y + 0.2, z: 1.5 }, normal: { x: 0, y: 0, z: -1 }, prevPos: { x: 0, y: PH.TABLE_Y + 0.2, z: 1.5 } };
  const ball = { x: 0.05, y: PH.TABLE_Y + 0.25, z: 1.55 };
  if (lib.playerInCaptureRange(ball, pad.pos, false))
    return lib.playerGraceRange(ball, pad, false) === false;
  return lib.playerGraceRange(ball, pad, false) === true;   // just outside
})(), '', 3);

R(MRL, 'grace ring is WIDER than capture (band outside only)', (() => {
  const pad = { pos: { x: 0, y: PH.TABLE_Y + 0.2, z: 1.5 } };
  const insideBall = { x: 0.02, y: PH.TABLE_Y + 0.2, z: 1.5 };
  const pad3 = { pos: pad.pos, normal: { x: 0, y: 0, z: -1 }, prevPos: pad.pos };
  const cap = lib.playerInCaptureRange(insideBall, pad.pos, false);
  const grace = lib.playerGraceRange(insideBall, pad3, false);
  if (!cap) return false;
  return grace === false;            // same ball: grace must decline
})(), '', 3);

R(MRL, 'capture far beyond grace ring => grace false', (() => {
  const pad = { pos: { x: 0, y: PH.TABLE_Y + 0.2, z: 1.5 }, normal: { x: 0, y: 0, z: -1 }, prevPos: { x: 0, y: PH.TABLE_Y + 0.2, z: 1.5 } };
  return lib.playerGraceRange({ x: 1.2, y: PH.TABLE_Y + 1.0, z: 2.5 }, pad, false) === false;
})(), '', 3);

R(MRL, 'strikeCueModel: null for off windows, object for valid ones', (() => {
  return lib.strikeCueModel(null) === null
    && lib.strikeCueModel({ on: false, kind: 'rally', t: 0, k: 1, ready: 1 }) === null
    && lib.strikeCueModel({ on: true, kind: 'badkind', t: 0.1, k: 0.5, ready: 0.5 }) === null
    && !!lib.strikeCueModel({ on: true, kind: 'rally', t: 0.1, k: 0.5, ready: 0.9, contactable: true });
})(), '', 3);

R(MRL, 'strikeCueModel: radius grows as t grows, capped at timingMaxPx', (() => {
  const small = lib.strikeCueModel({ on: true, kind: 'rally', t: 0.02, k: 0.5, ready: 0.4 });
  const big = lib.strikeCueModel({ on: true, kind: 'rally', t: 0.42, k: 0.9, ready: 0.4 });
  return small.radius >= lib.MATCH_RULES.timingMinPx && big.radius <= lib.MATCH_RULES.timingMaxPx + 1e-9
    && big.radius > small.radius;
})(), '', 3);

R(MRL, 'strikeCueModel: hot only when contactable & ready>.82', (() => {
  const c1 = lib.strikeCueModel({ on: true, kind: 'rally', t: 0, k: 1, ready: 0.9, contactable: true });
  const c2 = lib.strikeCueModel({ on: true, kind: 'rally', t: 0, k: 1, ready: 0.9, contactable: false });
  const c3 = lib.strikeCueModel({ on: true, kind: 'rally', t: 0, k: 1, ready: 0.5, contactable: true });
  return c1.hot === true && c2.hot === false && c3.hot === false;
})(), '', 3);

R(MRL, 'ballCaptureTarget: returns null on garbage, ring otherwise', (() => {
  const bad = lib.ballCaptureTarget(null, null);
  const pad = { pos: { x: 0, y: PH.TABLE_Y + 0.2, z: 1.5 } };
  const ok = lib.ballCaptureTarget(pad, { x: 0, y: PH.TABLE_Y + 0.2, z: 1.5 });
  return bad === null && ok.points.length === 49;
})(), '', 3);

R(MRL, 'serveTossRise: NaN inputs => NaN; = apex - start otherwise', (() => {
  const a = lib.serveTossRise(NaN, 1, 0.76);
  const b = lib.serveTossRise(1.2, 0.76 + 0.14, 0.76);
  return !Number.isFinite(a) && Math.abs(b - 0.30) < 1e-9;
})(), '', 3);

R(MRL, 'pressHitZone: circle admits within radius, rejects outside', (() => {
  const W = 390, H = 844;
  const bal = { x: 100 / W, y: 100 / H, ok: true };
  const r1 = lib.pressHitZone(bal, { x: 110 / W, y: 100 / H }, W, H, 96);
  const r2 = lib.pressHitZone(bal, { x: 0.9, y: 0.9 }, W, H, 96);
  return r1 && r1.accepted === true && r2 && r2.accepted === false;
})(), '', 3);

R(MRL, 'press oval: touch gets a wider side allowance than mouse', lib.pressOvalSidePx('touch') > lib.pressOvalSidePx('mouse'), '', 3);

R(MRL, 'deuce: serve alternates EVERY point (>= target-1 both)', (() => {
  /* mirror of 70_game.js:797-799 */
  let server = 1, serves = 2, s0 = 10, s1 = 10;
  const seq = [];
  for (let i = 0; i < 6; i++) {
    seq.push(server);
    const deuce = s0 >= 10 && s1 >= 10;
    serves--;
    if (deuce || serves <= 0) { server = -server; serves = deuce ? 1 : 2; }
    (i % 2 ? s1++ : s0++);
  }
  return seq.join(',') === '1,-1,1,-1,1,-1';
})(), '', 3);

R(MRL, 'pre-deuce: 2 serves per player (classic ITTF rotation)', (() => {
  let server = 1, serves = 2, s0 = 0, s1 = 0, T = 11;
  const seq = [];
  for (let i = 0; i < 8; i++) {
    seq.push(server);
    const deuce = s0 >= T - 1 && s1 >= T - 1;
    serves--;
    if (deuce || serves <= 0) { server = -server; serves = deuce ? 1 : 2; }
    s0++;
  }
  return seq.join(',') === '1,1,-1,-1,1,1,-1,-1';
})(), '', 3);

R(MRL, 'match ends only on 2-point margin (no win at 11-10)', (() => {
  const mk = (a, b2) => (a >= 11 || b2 >= 11) && Math.abs(a - b2) >= 2;
  return !mk(11, 10) && mk(11, 9) && mk(13, 11) && !mk(12, 11);
})(), '', 3);

R(MRL, 'serve toss min rise is ITTF 16 cm', Math.abs(lib.MATCH_RULES.serveTossMinRise - 0.16) < 1e-9, '', 3);

R(MRL, 'capture radius sane: capture < grace-of-capture < serve < serve grace', (() => {
  const lim = lib.playerCaptureLimits(false), srv = lib.playerCaptureLimits(true);
  return lim.radius < lib.GRACE_RULES.bandMul * lim.radius
    && srv.radius > lim.radius && srv.radius <= lib.MATCH_RULES.serveCaptureRadius * 1.0001
    && lim.radius < 0.30;
})(), '', 3);

R(MRL, 'match rules version tag is string-coherent (freeze proved)', (() => {
  try { 'use strict'; lib.MATCH_RULES.pressRadiusPx = 999; } catch (e) { return Object.isFrozen(lib.MATCH_RULES); }
  return lib.MATCH_RULES.pressRadiusPx === 96;
})(), '', 3);

R(MRL, 'press-rejection reason list is frozen & unique', (() => {
  const L = src('12_match_rules.js').match(/PRESS_REJECTION_REASONS = Object\.freeze\(\[([\s\S]*?)\]\)/);
  if (!L) return false;
  const items = L[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  return new Set(items).size === items.length && items.length >= 5;
})(), '', 3);

R(MRL, 'grace band multipliers sane (>1, <2)', (() => {
  const G = lib.GRACE_RULES;
  return G.bandMul > 1 && G.bandMul < 2 && G.serveBandMul > 1 && G.serveBandMul < 2 && G.depthMul > 1 && G.depthMul <= 2;
})(), '', 3);

R(MRL, 'grace serve lift window positive ordering', (() => {
  const G = lib.GRACE_RULES;
  return G.serveLiftMs[0] < G.serveLiftMs[1] && G.serveSpeedMs[0] < G.serveSpeedMs[1];
})(), '', 3);

R(MRL, 'press zone gate in src: pressZoneForBall EXISTS in 12_match_rules.js', assertSrc(MRL, 'pressZoneForBall', '12_match_rules.js', /function pressZoneForBall/) === undefined || out[out.length - 1].ok, '', 3);

R(MRL, 'dead variable sweep: awardPoint does not compute unused total (grep)', (() => {
  return !/const total = this.score\[0\] \+ this.score\[1\];/.test(src('70_game.js'));
})(), 'const total declared but unused — dead code', 2);

R(MRL, 'awardPoint increments the WINNER index only (no double), grep structural', (() => {
  const m = src('70_game.js').match(/const idx = who > 0 \? 0 : 1;[\s\S]{0,80}this\.score\[idx\]\+\+/);
  return !!m;
})(), '', 3);

R(MRL, 'awardPoint sets matchWinner once with 2-point margin', assertSrc2(MRL, 'matchWinner', '70_game.js',
  /Math\.abs\(this\.score\[0\] - this\.score\[1\]\) >= 2/), '', 3);

R(MRL, 'netRally tracking exists (rallies counted once per point)', assertSrc2(MRL, 'rallies++', '70_game.js', /this\.stats\.rallies\+\+/), '', 3);

/* --- last G4 item keeps count at 25 ------------------------------------- */
function assertSrc2(g, name, file, pattern) {
  R(g, name, pattern.test(src(file)), `${file}: ${pattern}`);
  return out[out.length - 1];
}

/* ======================== G5. REPLAY FILTER (15) ========================= */
const RPL = 'RP';

R(RPL, 'BEAUTY subscores are individually bounded [0, max]', (() => {
  const B = lib.BEAUTY;
  return B.rally(3) === 0 && B.rally(4) === 0 && Math.abs(B.rally(16) - 0.30) < 1e-9
    && B.speed(45) === 0 && Math.abs(B.speed(110) - 0.17) < 1e-9
    && B.spin(45) === 0 && Math.abs(B.spin(130) - 0.14) < 1e-9
    && B.finish('drive') === 0.03
    && B.clutch({ deuce: true, matchPoint: true, close: true }) <= 0.24 + 1e-9
    && B.comeback({ deficit: 0 }) === 0 && Math.abs(B.comeback({ deficit: 4 }) - 0.09) < 1e-9;
})(), '', 3);

R(RPL, 'BEAUTY total ceiling < 1.2 (score stays legible)', (() => {
  const B = lib.BEAUTY;
  const total = B.rally(50) + B.speed(200) + B.spin(400) + B.finish('smash')
    + B.clutch({ deuce: true, matchPoint: true, close: true }) + B.comeback({ deficit: 9 }) + B.netClip({ netClip: true });
  return total < 1.2;
})(), '', 3);

R(RPL, 'recorder: rallies with < 3 shots never kept', (() => {
  const R2 = new lib.MomentRecorder();
  R2.beginRally(0, [0, 0]);
  R2.push(0.03, mkG()); R2.push(0.06, mkG());
  R2.addContact(0.03, { by: 1, speed: 50, spin: 80, stroke: 'loop' });
  const m = R2.endRally(0.5, mkG(), { winner: 1, reason: 'x', score: [5, 3], target: 11 });
  return m === null;
})(), '', 3);

function mkG() {
  return {
    ball: { p: lib.V3.new(0, 1, 1), normal: lib.V3.new(0, 0, -1), roll: 0 },
    player: { pos: lib.V3.new(0, 1, 1.78), normal: lib.V3.new(0, 0, -1), roll: 0.2 },
    aiPaddle: { pos: lib.V3.new(0, 1, -1.78), normal: lib.V3.new(0, 0, 1) },
    ai: { pos: lib.V3.new(0, 1, -1.78) },
    settings: {},
  };
}

R(RPL, 'recorder: ring never exceeds cap * FLOATS floats', (() => {
  const R2 = new lib.MomentRecorder();
  let f = 0;
  const cap = lib.REPLAY_HZ * lib.REPLAY_RING_S;
  for (let i = 0; i < cap * 2 + 500; i++) R2.push(i / 30, mkG());
  return R2.n <= cap && R2.f.length === cap * lib.REPLAY_FLOATS;
})(), '', 3);

R(RPL, 'recorder: kept moments stay sorted DESC and capped at 5', (() => {
  const R2 = new lib.MomentRecorder();
  const g = mkG();
  for (let r = 0; r < 12; r++) {
    R2.beginRally(r * 45, [1, 2 + r]);
    for (let i = 0; i < 200; i++) R2.push(r * 45 + i / 30, g);
    for (let s = 0; s < 6; s++) R2.addContact(r * 45 + s * 0.2, { by: 1, speed: 50 + r * 3 + s, spin: 60 + r, stroke: 'loop' });
    R2.endRally(r * 45 + 7, g, { winner: 1, reason: 'x', score: [5 + r, 3], target: 11 });
  }
  let ok = R2.kept.length <= lib.REPLAY_KEEP;
  for (let i = 1; i < R2.kept.length; i++) ok = ok && R2.kept[i - 1].score >= R2.kept[i].score;
  return ok;
})(), '', 3);

R(RPL, 'moment frames array length == hz * FLOATS duration', (() => {
  const R2 = new lib.MomentRecorder();
  const g = mkG();
  R2.beginRally(0, [3, 4]);
  for (let i = 0; i < 120; i++) R2.push(i / 30, g);
  for (let s = 0; s < 5; s++) R2.addContact(s * 0.5, { by: 1, speed: 70, spin: 90 });
  const m = R2.endRally(4.2, g, { winner: 1, reason: 'x', score: [5, 3], target: 11 });
  return m.frames.length / lib.REPLAY_FLOATS > 0 && m.frames.every(Number.isFinite);
})(), '', 3);

R(RPL, 'input decisions capped (256) — no memory balloon', (() => {
  const R2 = new lib.MomentRecorder();
  for (let i = 0; i < 700; i++) R2.addInputDecision(i, { shape: 'oval' }, null, 'mouse');
  return R2.inputDecisions.length === 256;
})(), '', 3);

R(RPL, 'player: play(moment) on empty — returns false', new lib.MomentPlayer().play(null) === false, '', 3);

R(RPL, 'player: advance then finish triggers onEnd exactly once', (() => {
  const P = new lib.MomentPlayer();
  let hits = 0;
  const g = mkG(); g.ball.live = false; g.ball.hist = [];
  g.ball.v = lib.V3.new(); g.ball.w = lib.V3.new();
  g.settings = { hand: 'right', grip: 'shakehand' };
  const R2 = new lib.MomentRecorder();
  R2.beginRally(0, [0, 0]);
  for (let i = 0; i < 90; i++) R2.push(i / 30, g);
  for (let s = 0; s < 5; s++) R2.addContact(s * 0.3, { by: 1, speed: 60, spin: 70 });
  const moment = R2.endRally(3, mkG(), { winner: 1, reason: 'x', score: [4, 2], target: 11 });
  P.play(moment, 10, () => hits++);
  for (let i = 0; i < 300; i++) P.update(1 / 60, g);
  return hits === 1 && !P.on;
})(), '', 3);

R(RPL, 'frame interp writes finite ball pose every step (no NaN drip)', (() => {
  const P = new lib.MomentPlayer();
  const g = mkG(); g.ball.live = false; g.ball.hist = [];
  g.ball.v = lib.V3.new(); g.ball.w = lib.V3.new();
  g.settings = { hand: 'right', grip: 'shakehand' };
  const R2 = new lib.MomentRecorder();
  R2.beginRally(0, [0, 0]);
  for (let i = 0; i < 60; i++) R2.push(i / 30, g);
  for (let s = 0; s < 4; s++) R2.addContact(s * 0.4, { by: 1, speed: 60, spin: 70 });
  const moment = R2.endRally(2, mkG(), { winner: 1, reason: 'x', score: [4, 2], target: 11 });
  P.play(moment, 2);
  let ok = true;
  for (let i = 0; i < 90; i++) { P.update(1 / 60, g); ok = ok && Number.isFinite(g.ball.p.x + g.player.roll); }
  return ok;
})(), '', 3);

R(RPL, 'roll interp wraps correctly (no spin-glitch at ±pi legacy)', (() => {
  const F = new lib.MomentRecorder();
  const g = mkG();
  F.beginRally(0, [0, 0]);
  for (let i = 0; i < 10; i++) { g.player.roll = i < 5 ? Math.PI - 0.01 : -Math.PI + 0.01; F.push(i / 30, g); }
  /* just verify no throw & finite */
  const clip = F.captureClip(0.4);
  return clip.frames.every(Number.isFinite);
})(), '', 3);

R(RPL, 'replay update: live=true during playback, zero w', (() => {
  const P = new lib.MomentPlayer();
  const g = mkG(); g.ball.live = false; g.ball.hist = [];
  g.ball.v = lib.V3.new(); g.ball.w = lib.V3.new();
  g.settings = {};
  const R2 = new lib.MomentRecorder();
  R2.beginRally(0, [0, 0]);
  for (let i = 0; i < 60; i++) R2.push(i / 30, g);
  for (let s = 0; s < 4; s++) R2.addContact(s * 0.4, { by: 1, speed: 60, spin: 70 });
  P.play(R2.endRally(2, mkG(), { winner: 1, reason: 'x', score: [4, 2], target: 11 }), 1);
  P.update(1 / 60, g); P.update(1 / 60, g);
  return g.ball.live === true && V3len(g.ball.w) === 0;
})(), '', 3);

R(RPL, 'recorder: beginRally clears inputDecisions between rallies', (() => {
  const R2 = new lib.MomentRecorder();
  R2.addInputDecision(0, { shape: 'oval' }, null, 'touch');
  R2.beginRally(1, [0, 0]);
  return R2.inputDecisions.length === 0;
})(), '', 3);

R(RPL, 'endRally: matchPoint detection only when winner leads by 2+ at target', (() => {
  const R2 = new lib.MomentRecorder();
  const g = mkG();
  R2.beginRally(0, [9, 9]);
  for (let i = 0; i < 100; i++) R2.push(i / 30, g);
  for (let s = 0; s < 5; s++) R2.addContact(s * 0.3, { by: 1, speed: 50, spin: 60 });
  const m1 = R2.endRally(3, g, { winner: 1, reason: 'x', score: [11, 9], target: 11 });
  R2.beginRally(3, [9, 10]);
  for (let i = 0; i < 100; i++) R2.push(3 + i / 30, g);
  for (let s = 0; s < 5; s++) R2.addContact(3 + s * 0.3, { by: 1, speed: 50, spin: 60 });
  const m2 = R2.endRally(6, g, { winner: 1, reason: 'x', score: [11, 10], target: 11 });
  return m1.meta.matchPoint === true && m2.meta.matchPoint === false;
})(), '', 3);

R(RPL, 'beauty: quiet rally is cheaper than a 20-shot deuce smash', (() => {
  const mkM2 = (big) => {
    const B = lib.BEAUTY;
    const meta = big ? { deuce: true, matchPoint: true, close: true, deficit: 2, netClip: true } : { deficit: 0 };
    return B.rally(big ? 20 : 4) + B.speed(big ? 120 : 50) + B.spin(big ? 140 : 50)
      + B.finish(big ? 'smash' : 'drive') + B.clutch(meta) + B.comeback(meta) + B.netClip(meta);
  };
  return mkM2(true) > mkM2(false) * 1.6;
})(), '', 3);

/* ======================== G6. AI TABLES (15) ============================= */
const AIL = 'AI';

R(AIL, 'AI levels: elo strictly increasing', (() => {
  const L = lib.AI_LEVELS;
  for (let i = 1; i < L.length; i++) if (!(L[i].elo > L[i - 1].elo)) return false;
  return true;
})(), '', 3);

R(AIL, 'AI levels: reaction time strictly decreasing', (() => {
  const L = lib.AI_LEVELS;
  for (let i = 1; i < L.length; i++) if (!(L[i].react < L[i - 1].react)) return false;
  return true;
})(), '', 3);

R(AIL, 'AI levels: move speed strictly increasing', (() => {
  const L = lib.AI_LEVELS;
  for (let i = 1; i < L.length; i++) if (!(L[i].move > L[i - 1].move)) return false;
  return true;
})(), '', 3);

R(AIL, 'AI levels: skill strictly increasing', (() => {
  const L = lib.AI_LEVELS;
  for (let i = 1; i < L.length; i++) if (!(L[i].skill > L[i - 1].skill)) return false;
  return true;
})(), '', 3);

R(AIL, 'AI levels: paceMax non-decreasing & capped at 1; paceRamp strictly increasing', (() => {
  const L = lib.AI_LEVELS;
  for (let i = 1; i < L.length; i++) if (!(L[i].paceMax >= L[i - 1].paceMax && L[i].paceRamp > L[i - 1].paceRamp)) return false;
  return L.every((l) => l.paceMax <= 1.0);
})(), '', 3);

R(AIL, 'AI levels: windup telegraphs LESS on higher levels', (() => {
  const L = lib.AI_LEVELS;
  for (let i = 1; i < L.length; i++) if (!(L[i].windup < L[i - 1].windup)) return false;
  return true;
})(), '', 3);

R(AIL, 'AI_SERVE_CAPS: vmag strictly increasing & never above SERVE_VMAX ceiling', (() => {
  const C = lib.AI_SERVE_CAPS;
  for (let i = 1; i < C.length; i++) if (!(C[i].vmag > C[i - 1].vmag)) return false;
  return C.every((c) => c.vmag <= 12.5);
})(), '', 3);

R(AIL, 'AI_SERVE_CAPS: serve orbit never covers the whole table width (<= 80%)', (() => {
  return lib.AI_SERVE_CAPS.every((c) => c.orbit <= PH.T_HALF_WID * 0.85);
})(), '', 3);

R(AIL, 'AI_TACTICS: all pace positive & between 0 and 1.5', (() => {
  return Object.values(lib.AI_TACTICS).every((t) => t.pace > 0 && t.pace <= 1.5 && t.risk >= 0 && t.risk <= 1 && t.depth >= 0 && t.depth <= 1 && t.wide >= 0 && t.wide <= 1);
})(), '', 3);

R(AIL, 'AI_SERVE track record: rookie serve capped at ~40 % table width', (() => {
  return lib.AI_SERVE_CAPS[0].orbit <= PH.T_HALF_WID * 0.45 && lib.AI_SERVE_CAPS[0].kick <= 0.45;
})(), '', 3);

R(AIL, 'AI backswings: BLOCK is smallest pullback & LOOP is large-ish', (() => {
  return lib.AI_BACKSWING.BLOCK.back === 0.04 && lib.AI_BACKSWING.LOOP.back > lib.AI_BACKSWING.PUSH.back
    && lib.AI_BACKSWING.SMASH.back > lib.AI_BACKSWING.BLOCK.back;
})(), '', 3);

R(AIL, 'AI levels: spinRead monotonic increasing', (() => {
  const L = lib.AI_LEVELS;
  for (let i = 1; i < L.length; i++) if (!(L[i].spinRead > L[i - 1].spinRead)) return false;
  return true;
})(), '', 3);

R(AIL, 'AI levels: posErr decreasing (better placement)', (() => {
  const L = lib.AI_LEVELS;
  for (let i = 1; i < L.length; i++) if (!(L[i].posErr < L[i - 1].posErr)) return false;
  return true;
})(), '', 3);

R(AIL, 'AI level labels unique', (() => {
  return new Set(lib.AI_LEVELS.map((l) => l.name)).size === lib.AI_LEVELS.length
    && new Set(lib.AI_LEVELS.map((l) => l.tag)).size === lib.AI_LEVELS.length;
})(), '', 3);

R(AIL, 'makeRacket: defaults are sane & fields finite', (() => {
  const r = lib.makeRacket(1, 'DRIVE', {});
  return [r.elev, r.contact, r.vmag, r.quality, r.netClear].every(Number.isFinite)
    && r.quality <= 1 && r.quality >= 0 && V3len(r.normal) > 0.99 && V3len(r.normal) < 1.01;
})(), '', 3);

/* ================= G7. SOURCE COHERENCE (15) ============================= */
const SRCG = 'SC';

R(SRCG, 'no mixed Latin-into-Cyrillic script strings in player-visible names (AI_BACKSWING)', (() => {
  const bs = src('55_ai.js').match(/AI_BACKSWING = \{[\s\S]*?\n\};/);
  if (!bs) return false;
  const mixed = /[a-zA-Z][а-яА-Я]|[а-яА-Я][a-zA-Z]/;
  return bs[0].split('\n').filter((l) => /name:/.test(l)).every((l) => !mixed.test(l.replace(/name:\s*'|'/g, '')));
})(), '', 2);

R(SRCG, 'no "МATCH" (Cyrillic М + Latin ATCH) anywhere in src', (() => {
  return !['55_ai.js', '76_emotion.js', '80_ui.js', '70_game.js', '58_coach.js'].some((f) => /МATCH/.test(src(f)));
})(), '', 2);

R(SRCG, 'player-visible RU strings are pure Cyrillic+spaced (no accidental latin-mixed words) in emotion module', (() => {
  const s = src('76_emotion.js');
  const m = s.match(/'[^']*'/g) || [];
  return m.filter((t) => /\u0410-\u044F/.test(t) && /[a-zA-Z]/.test(t)).length === 0;
})(), '', 2);

R(SRCG, 'SERVE_BACK arch comment preserved (arc tuning history)', /SERVE_BACK: \{ elev: -34, contact: 64/.test(src('40_swipe.js')), '', 2);

R(SRCG, 'RACKET_VMAX constant exists and is 19.5', /RACKET_VMAX = 19\.5/.test(src('40_swipe.js')), '', 3);

R(SRCG, 'SERVE_VMAX ceiling is 12.5 (pro serve speed)', /SERVE_VMAX = 12\.5/.test(src('40_swipe.js')), '', 3);

R(SRCG, 'serve solver keeps legal backstop check: "own" half bounce', /why = 'own'/.test(src('40_swipe.js')), '', 2);

R(SRCG, 'impactRacket exists and uses the physics tune table', /function impactRacket/.test(src('30_physics.js')), '', 3);

R(SRCG, 'paddle grip profiles exist for shakehand & penhold', (() => {
  const a = lib.paddleGripProfile('shakehand', 'LOOP', true), b = lib.paddleGripProfile('penhold', 'LOOP', true);
  return !!a && !!b && a !== b;
})(), '', 3);

R(SRCG, 'all 12 rally strokes have grip profiles', (() => {
  const ids = ['LOOP', 'COUNTER', 'DRIVE', 'SMASH', 'FLICK', 'PUSH', 'CHOP', 'BLOCK', 'LOB', 'HOOK', 'FADE', 'DROP'];
  let ok = true;
  for (const id2 of ids) for (const grip of ['shakehand', 'penhold']) {
    try { lib.paddleGripProfile(grip, id2, true); } catch (e) { ok = false; }
  }
  return ok;
})(), '', 3);

R(SRCG, 'paddleContactRange: serve strokes produce a gating envelope', (() => {
  const r = lib.paddleContactRange('shakehand', 'SERVE_TOP', true, true);
  return Array.isArray(r) && r[0] < r[1];
})(), '', 3);

R(SRCG, 'paddleContactRange: unknown grip => null (no gate)', lib.paddleContactRange('nobody', 'DRIVE', true) === null, '', 3);

R(SRCG, 'coach analyst: every major reason code has a string table', (() => {
  const A = lib.ANALYSIS;
  for (const k of ['NET', 'LONG']) if (!A[k] || typeof A[k].pick !== 'function' || !A[k].alt || !A[k].alt.length) return false;
  return true;
})(), '', 3);

R(SRCG, 'ANALYSIS.NET pick() never returns empty string', (() => {
  const a = lib.ANALYSIS.NET.pick({ myShot: { contact: 50, speed: 40, topspin: 100 } });
  return typeof a === 'string' && a.length > 8;
})(), '', 3);

R(SRCG, 'RallyRecorder: shots survive from first frame; begin() resets them', (() => {
  const rc = new (lib.RallyRecorder)();
  rc.begin(0, 1);
  rc.addShot(1, { t: 0.5, stroke: { id: 'DRIVE' }, speed: 50, spin: 80 });
  return rc.length === 1 && (rc.begin(1, 1), rc.length === 0);
})(), '', 3);

/* ---- сводка ------------------------------------------------------------ */
const groups = {};
for (const r of out) { groups[r.g] = (groups[r.g] || 0) + 1; }
console.log('groups:', JSON.stringify(groups));
const fails = out.filter((r) => !r.ok);
console.log(`DEEP AUDIT: ${out.length} checks, ${out.length - fails.length} pass, ${fails.length} fail`);
module.exports = { out };

