/* =====================================================================
 *  INDEPENDENT AUDIT HARNESS (no browser required)
 *
 *  Loads the DOM-free modules of TOPSPIN ARENA into a Node vm context and
 *  re-runs the headline claims published in the design document, so the
 *  numbers in an evaluation are measured, not quoted:
 *
 *    · ITTF 30 cm drop/rebound test
 *    · the stroke matrix (speed / spin per archetype)
 *    · the serve solver's legality over a grid of gestures x assist
 *    · the aim-assist curve (assist -> shots in play)
 *    · reachability of the 16 stroke classes from the gesture space
 *    · physics cost per simulated frame (mobile budget check)
 *
 *  Usage:  node tt/tools/audit.js
 * ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const MODULES = ['10_math.js', '30_physics.js', '40_swipe.js', '55_ai.js', '58_coach.js', '65_train.js'];
const ctx = vm.createContext({ Math, console, Date, JSON, NL: String.fromCharCode(10) });
for (const f of MODULES) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const run = (code) => vm.runInContext(`(function(){ ${code} })()`, ctx);

const out = [];
const say = (s) => { out.push(s); console.log(s); };
const line = (t) => say('\n== ' + t + ' ' + '='.repeat(Math.max(0, 66 - t.length)));
const f2 = (x) => (Math.round(x * 100) / 100).toFixed(2);

/* ---------------------------------------------------------------- *
 * 1. ITTF 30 cm drop -> rebound height
 * ---------------------------------------------------------------- */
line('ITTF drop test (ball released 30 cm above the table)');
say(run(`
  const p = V3.new(0, PH.TABLE_Y + 0.30, 0), v = V3.new(), w = V3.new();
  let maxY = 0, bounced = 0, t = 0;
  const dt = 1/2000;
  while (t < 4 && bounced < 2) {
    integrateBall(p, v, w, dt); t += dt;
    if (bounced === 0 && p.y <= PH.TABLE_Y + PH.R) {
      bounceTable(p, v, w); bounced = 1; maxY = PH.TABLE_Y;
    } else if (bounced === 1) { maxY = Math.max(maxY, p.y); }
  }
  return (maxY - PH.TABLE_Y) * 100;
`).toFixed(2) + ' cm  (ITTF-typical 22-25 cm, design doc claims 22.9)');

/* ---------------------------------------------------------------- *
 * 2. Stroke matrix + dispersion
 *    Reproduction of the method used by the project's own strokes.js
 *    (force one archetype, random valid gesture, average the outcome),
 *    plus the number the design doc does not print: how often a random
 *    gesture of the RIGHT archetype actually lands in play with no aim
 *    assist.  That dispersion is what the assist slider exists to hide.
 * ---------------------------------------------------------------- */
line('Stroke matrix — mean over 40 random gestures per archetype');
say(run(`
  let seed = 4711;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const realClassify = classifyStroke;
  const rows = [];
  for (const id of Object.keys(ARCH)) {
    classifyStroke = () => ({ id, col: '#fff', name: id });
    const serve = id.indexOf('SERVE') === 0;
    const back = !!ARCH[id].back;
    let n = 0, spd = 0, top = 0, side = 0, inPlay = 0, net = 0, over = 0, clear = 0;
    for (let k = 0; k < 40; k++) {
      const ang = (back ? -1 : 1) * (0.55 + rnd() * 0.75);
      const lateral = /HOOK|FADE|SERVE_SIDE/.test(id) ? (id === 'FADE' ? -1 : 1) * (0.62 + rnd() * 0.30)
        : Math.sin((k % 6 - 2.5) * 0.20) * 0.45;
      const m = { right: lateral, up: Math.sin(ang), dist: 0.26 + rnd() * 0.22,
        curl: (rnd() - 0.5) * 0.9, straightness: 0.82, smooth: 0.84, samples: 14,
        releaseSpeed: 2.0 + rnd() * 2.0, peakSpeed: 2.6 + rnd() * 2.2, x: 0.5, y: 0.5 };
      const ctx = { side: 1, isServe: serve, ball: { x: 0.08, y: PH.TABLE_Y + (serve ? 0.18 : 0.16), z: 1.40 },
        ballSpin: { x: -130, y: 8, z: 0 }, ballVel: { x: -0.2, y: 1.1, z: 7.2 }, incomingTop: 130 };
      const rk = deriveStroke(m, ctx);
      const v = { x: -0.2, y: 1.1, z: 7.2 }, w = { x: -130, y: 8, z: 0 };
      if (serve) { v.x = 0; v.y = -2.2; v.z = 0; w.x = 0; w.y = 0; w.z = 0; }
      impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
      const o = {};
      predict({ x: 0.08, y: ctx.ball.y, z: 1.40 }, { x: v.x, y: v.y, z: v.z }, { x: w.x, y: w.y, z: w.z },
        { dt: 1 / 480, maxT: 3.0, stopOnFirstBounce: true, out: o });
      n++; spd += Math.hypot(v.x, v.y, v.z) * 3.6; top += -w.x / TAU; side += w.y / TAU;
      if (o.netCross) clear += o.netCross.y - PH.NET_TOP;
      if (o.hitNet) net++;
      const L = o.landed;
      if (L && Math.abs(L.x) < PH.T_HALF_WID && Math.abs(L.z) < PH.T_HALF_LEN && L.z < 0) inPlay++;
      if (L && (Math.abs(L.x) > PH.T_HALF_WID || Math.abs(L.z) > PH.T_HALF_LEN)) over++;
    }
    classifyStroke = realClassify;
    rows.push([id, spd / n, Math.abs(top / n), side / n, 100 * inPlay / n, 100 * net / n, 100 * over / n, clear / n]);
  }
  return 'удар        км/ч   об/с   бок  | в стол%  сет%  аут% | над сеткой, м' + NL +
    rows.map(r => r[0].padEnd(11) + r[1].toFixed(1).padStart(5) + r[2].toFixed(0).padStart(7) + r[3].toFixed(0).padStart(6) +
      '  | ' + r[4].toFixed(0).padStart(6) + r[5].toFixed(0).padStart(6) + r[6].toFixed(0).padStart(6) + ' | ' + (r[7] >= 0 ? r[7].toFixed(2) : '--')).join(NL);
`));

/* ---------------------------------------------------------------- *
 * 3. Serve legality grid
 * ---------------------------------------------------------------- */
line('Serve solver: legality over 5 gestures x 4 assist levels');
say(run(`
  const GEST = [
    ['up slow',   { right: 0.05, up: 0.95, dist: 0.30, speed: 1.8, peakSpeed: 2.2, releaseSpeed: 1.8, curl: 0.1, smooth: .9, straightness: .95, samples: 14, x: 0.5, y: 0.5 }],
    ['up fast',   { right: 0.05, up: 0.95, dist: 0.42, speed: 3.9, peakSpeed: 4.3, releaseSpeed: 3.9, curl: 0.1, smooth: .9, straightness: .95, samples: 14, x: 0.5, y: 0.5 }],
    ['down',      { right: 0.0,  up: -0.98, dist: 0.33, speed: 2.4, peakSpeed: 2.8, releaseSpeed: 2.4, curl: 0.05, smooth: .9, straightness: .95, samples: 14, x: 0.5, y: 0.5 }],
    ['side curl', { right: 0.85, up: 0.40, dist: 0.30, speed: 2.6, peakSpeed: 3.0, releaseSpeed: 2.6, curl: 1.6, smooth: .85, straightness: .7, samples: 16, x: 0.5, y: 0.5 }],
    ['flat fast', { right: 0.12, up: 0.30, dist: 0.40, speed: 4.4, peakSpeed: 4.8, releaseSpeed: 4.4, curl: 0.0, smooth: .95, straightness: .98, samples: 12, x: 0.5, y: 0.5 }],
  ];
  const lines = [];
  let legal = 0, total = 0;
  for (const [name, m] of GEST) {
    const row = [];
    for (const assist of [0.2, 0.5, 0.72, 1.0]) {
      const ctx = { side: 1, isServe: true, ball: { y: PH.TABLE_Y + 0.20, z: 1.44 }, ballSpin: { x: 0, y: 0, z: 0 }, ballSpeed: 1.6 };
      const st = deriveStroke(m, ctx);
      const rk = refineRacket(V3.new(0, PH.TABLE_Y + 0.20, 1.44), V3.new(0, -1.6, 0), V3.new(), st, assist, st.quality);
      const v = V3.new(0, -1.6, 0), w = V3.new();
      impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
      const rep = {};
      predict(V3.new(0, PH.TABLE_Y + 0.20, 1.44), V3.new(v.x, v.y, v.z), V3.new(w.x, w.y, w.z), { dt: 1/600, maxT: 3, out: rep });
      const own = rep.landed && rep.landed.z > 0.02 && Math.abs(rep.landed.x) < PH.T_HALF_WID;
      const over = !rep.hitNet;
      const opp = rep.b2 && rep.b2.z < -0.02 && Math.abs(rep.b2.x) < PH.T_HALF_WID;
      const ok = own && over && opp;
      total++; if (ok) legal++;
      row.push(name + ' a=' + assist.toFixed(2) + (ok ? ' LEGAL ' : ' illegal') +
        '  b1=' + (rep.landed ? '(' + rep.landed.x.toFixed(2) + ',' + rep.landed.z.toFixed(2) + ')' : '--') +
        ' net=' + (rep.hitNet ? 'Y' : 'n') +
        ' b2=' + (rep.b2 ? '(' + rep.b2.x.toFixed(2) + ',' + rep.b2.z.toFixed(2) + ')' : '--'));
    }
    lines.push(row.join(NL));
  }
  return lines.join(NL) + NL + 'LEGAL: ' + legal + '/' + total + ' (' + (100 * legal / total).toFixed(0) + '%)';
`));

/* ---------------------------------------------------------------- *
 * 4. Aim-assist curve
 * ---------------------------------------------------------------- */
line('Aim assist: share of shots that land in play (random gestures, rally)');
say(run(`
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const rows = [];
  for (const assist of [0, 0.25, 0.5, 0.72, 1.0]) {
    let inPlay = 0, net = 0, outN = 0, N = 500;
    for (let i = 0; i < N; i++) {
      const up = rnd() * 1.9 - 1.0, right = rnd() * 1.6 - 0.8;
      const m = { right, up, dist: 0.12 + rnd() * 0.35, speed: 0.8 + rnd() * 3.6, peakSpeed: 0, releaseSpeed: 0, curl: rnd() * 2 - 1, smooth: 0.6 + rnd() * 0.4, straightness: 0.5 + rnd() * 0.5, samples: 6 + (rnd() * 10 | 0), x: 0.3 + rnd() * 0.4, y: 0.5 };
      m.peakSpeed = m.speed * 1.05; m.releaseSpeed = m.speed;
      const ballY = PH.TABLE_Y + 0.10 + rnd() * 0.65, ballZ = 1.1 + rnd() * 0.2;
      const incomingTop = -60 + rnd() * 160;
      const ctx = { side: 1, isServe: false, ball: { y: ballY, z: ballZ }, ballSpin: { x: incomingTop }, ballSpeed: 5 + rnd() * 5 };
      const st = deriveStroke(m, ctx);
      const p = V3.new(right * 0.3, ballY, ballZ);
      const bv = V3.new(0, -2, -6), bw = V3.new(incomingTop, 0, 0);
      const rk = assist > 0 ? refineRacket(p, bv, bw, st, assist, st.quality) : st;
      const v = V3.clone(bv), w = V3.clone(bw);
      impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
      const rep = {};
      predict(V3.clone(p), V3.clone(v), V3.clone(w), { dt: 1/400, maxT: 2.4, stopOnFirstBounce: true, out: rep });
      const hitNet2 = rep.hitNet;
      const landed = rep.landed;
      const oppSide = landed && landed.z < -0.01;
      const onTable = landed && Math.abs(landed.x) < PH.T_HALF_WID && Math.abs(landed.z) < PH.T_HALF_LEN;
      if (hitNet2) net++;
      else if (landed && !(oppSide && onTable)) outN++;
      else if (landed && oppSide && onTable) inPlay++;
      else outN++;
    }
    rows.push('assist ' + assist.toFixed(2).padStart(4) + '   IN ' + (100 * inPlay / N).toFixed(0).padStart(3) + '%   net ' + (100 * net / N).toFixed(0).padStart(3) + '%   out/miss ' + (100 * outN / N).toFixed(0).padStart(3) + '%');
  }
  return rows.join(NL);
`));

/* ---------------------------------------------------------------- *
 * 5. Classifier reachability
 * ---------------------------------------------------------------- */
line('Stroke classifier: classes reachable from random gestures');
say(run(`
  let seed = 999;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const hits = {};
  for (let i = 0; i < 40000; i++) {
    const m = { right: rnd() * 2 - 1, up: rnd() * 2 - 1, dist: rnd() * 0.5, speed: rnd() * 4.5, peakSpeed: 0, releaseSpeed: 0, curl: rnd() * 3 - 1.5, smooth: rnd(), straightness: rnd(), samples: 4 + (rnd() * 16 | 0), x: rnd(), y: rnd() };
    m.peakSpeed = m.speed * 1.05; m.releaseSpeed = m.speed;
    const serve = rnd() < 0.25;
    const ctx = { side: 1, isServe: serve, ball: { y: PH.TABLE_Y + rnd() * 0.7, z: 1.2 }, ballSpin: { x: rnd() * 200 - 100 }, ballSpeed: rnd() * 12 };
    const st = deriveStroke(m, ctx);
    hits[st.stroke.id] = (hits[st.stroke.id] || 0) + 1;
  }
  const all = Object.keys(hits).sort((a, b) => hits[b] - hits[a]);
  return all.length + ' distinct classes reached' + NL + all.map(k => k.padEnd(12) + String(hits[k]).padStart(6) + '  ' + (100 * hits[k] / 40000).toFixed(2) + '%').join(NL);
`));

/* ---------------------------------------------------------------- *
 * 6. Cost
 * ---------------------------------------------------------------- */
line('Cost: physics stepping budget (Node, single core)');
say(run(`
  const p = V3.new(0, PH.TABLE_Y + 0.3, 1.2), v = V3.new(1.2, 1.5, -7), w = V3.new(60, 0, 20);
  const N = 600 * 60;                       // 60 s of game time at 600 Hz
  const t0 = Date.now();
  for (let i = 0; i < N; i++) { integrateBall(p, v, w, 1 / 600); if (p.y < 0.5) { p.y = PH.TABLE_Y + 0.3; } }
  const ms = Date.now() - t0;
  return N + ' steps in ' + ms + ' ms  ->  ' + (ms / 60).toFixed(2) + ' ms of CPU per second of play (ball only, no render)';
`));

/* ---------------------------------------------------------------- *
 * 7. Determinism / step-size sensitivity
 * ---------------------------------------------------------------- */
line('Determinism and step-size sensitivity');
say(run(`
  // the player's own loop leaving the racket towards the far half
  const make = () => ({ p: { x: 0.10, y: 1.00, z: 1.44 }, v: { x: 0.05, y: 2.0, z: -8.0 }, w: { x: -70, y: 0, z: 6 } });
  const shot = (dt) => {
    const s = make(); const rep = {};
    predict({ x: s.p.x, y: s.p.y, z: s.p.z }, { x: s.v.x, y: s.v.y, z: s.v.z }, { x: s.w.x, y: s.w.y, z: s.w.z },
      { dt, maxT: 3.0, out: rep });
    return rep;
  };
  const fmt = (r) => 'landed=' + (r.landed ? '(' + r.landed.x.toFixed(3) + ',' + r.landed.z.toFixed(3) + ')' : 'none') +
    ' net=' + (r.hitNet ? 'Y' : 'n') + ' b2=' + (r.b2 ? '(' + r.b2.x.toFixed(2) + ',' + r.b2.z.toFixed(2) + ')' : '--');
  const a = shot(1 / 600), b = shot(1 / 600), c = shot(1 / 1200), d = shot(1 / 300);
  const z = (r) => (r.landed ? r.landed.z : NaN);
  return '1/600   ' + fmt(a) + NL +
    'repeat  ' + fmt(b) + '   bit-identical: ' + (z(a) === z(b)) + NL +
    '1/1200  ' + fmt(c) + NL +
    '1/300   ' + fmt(d) + NL +
    'drift 600->1200: ' + (Math.abs(z(a) - z(c)) * 1000).toFixed(2) + ' mm    600->300: ' + (Math.abs(z(a) - z(d)) * 1000).toFixed(2) + ' mm';
`));

/* ---------------------------------------------------------------- *
 * 8. AI parameter spread
 * ---------------------------------------------------------------- */
line('AI levels — parameter spread (readability inputs)');
say(run(`
  return AI_LEVELS.map((L, i) => ['NOVICE', 'AMATEUR', 'PRO', 'MASTER', 'LEGEND'][i].padEnd(8) +
    ' react ' + L.react.toFixed(3) + 's  windup ' + L.windup.toFixed(3) + 's  move ' + L.move.toFixed(1) + ' m/s  skill ' + L.skill.toFixed(2) + '  spinRead ' + L.spinRead.toFixed(2) + '  errBase ' + L.errBase.toFixed(3)).join(NL);
`));

/* ---------------------------------------------------------------- *
 * 9. Rules engine sanity (static scan of 70_game.js)
 * ---------------------------------------------------------------- */
line('Rules engine — covered outcomes (static scan of 70_game.js)');
{
  const game = fs.readFileSync(path.join(SRC, '70_game.js'), 'utf8');
  const wanted = ['LET', 'NET', 'LONG', 'WIDE', 'SERVE_FAIL', 'VOLLEY', 'EDGE', 'DOUBLE', 'deuce', 'DEUCE'];
  const found = wanted.filter((w) => new RegExp(w, 'i').test(game));
  say('reason codes present in source: ' + found.join(', '));
  const stores = /localStorage|sessionStorage|indexedDB/.test(game + fs.readFileSync(path.join(SRC, '80_ui.js'), 'utf8'));
  say('client-side persistence (localStorage/IndexedDB): ' + (stores ? 'present' : 'NOT PRESENT'));
  const i18n = /i18n|locale|LANG|translat/i.test(require('child_process').execSync('cat ' + JSON.stringify(SRC) + '/*.js').toString());
  say('localisation layer: ' + (i18n ? 'present' : 'NOT PRESENT (UI strings are hard-coded Russian)'));
  const analytics = /gtag|analytics|posthog|amplitude|sentry|firebase/i.test(require('child_process').execSync('cat ' + JSON.stringify(SRC) + '/*.js').toString());
  say('telemetry / analytics / crash reporting hooks: ' + (analytics ? 'present' : 'NOT PRESENT'));
  const net = /fetch\(|XMLHttpRequest|WebSocket|EventSource/.test(require('child_process').execSync('cat ' + JSON.stringify(SRC) + '/*.js').toString());
  say('outbound network calls anywhere in the client: ' + (net ? 'present' : 'NONE (fully offline)'));
  const audio = require('child_process').execSync('cat ' + JSON.stringify(SRC) + '/50_audio.js').toString();
  say('audio files referenced: ' + (/\.(mp3|wav|ogg|m4a)/.test(audio) ? 'yes' : 'none (all synthesis)'));
  const css = fs.readFileSync(path.join(SRC, '05_style.css'), 'utf8');
  say('CSS media queries: ' + (css.match(/@media/g) || []).length + ' · prefers-reduced-motion: ' + (/prefers-reduced-motion/.test(css) ? 'yes' : 'NO') + ' · safe-area insets: ' + (/safe-area-inset/.test(css) ? 'yes' : 'no'));
  say('touch-action / user-select guards: ' + (/touch-action/.test(css) ? 'touch-action ok' : 'missing') + ' / ' + (/user-select/.test(css) ? 'user-select ok' : 'missing'));
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'table-tennis-topspin.html'), 'utf8');
  say('bundle size: ' + (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB   external requests: ' + ((html.match(/https?:\/\//g) || []).length) + ' (URL strings: ' + ((html.match(/https?:\/\/[^"' ]+/g) || []).slice(0, 4).join(' ') || 'none') + ')');
}

console.log('\n--- audit complete ---');
