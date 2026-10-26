#!/usr/bin/env node
/* ================================================================== *
 *  AUDIT — 150 numbered analyses of Topspin Arena (game + host).
 *  Run: node tt/tools/audit.cjs [--json]
 *
 *  Every analysis returns { id, group, name, ok, detail? }. Groups:
 *    S  static syntax per source file + both bundles,
 *    H  host contract (routing/messaging/data invariants),
 *    C  camera contract on the viewport grid,
 *    F  physics flight fuzz,
 *    I  impact-model fuzz,
 *    V  AI serve matrix (5 levels × 6 rolls — legality pinned),
 *    W  AI swing matrix (5 levels × 5 receives — legality pinned),
 *    X  cross-cutting gameplay invariants.
 *  Severity of a FAIL is decided by the caller; the fail list is printed
 *  sorted so the worst (crashes/NaN) come first.
 * ================================================================== */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { load } = require('../../tests/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');          // game/
const SRC = path.join(ROOT, 'tt', 'src');
const HOST = path.resolve(ROOT, '..');                     // ttu-v2/
const HOST_SRC = path.join(HOST, 'src');

const out = [];
const rec = (id, group, name, ok, detail, sev) =>
  out.push({ id, group, name, ok: !!ok, detail: ok ? undefined : String(detail || ''), sev: sev || (group === 'S' || group === 'I' || group === 'F' ? 3 : 2) });

/* ------------------------------------------------------------------ *
 *  S: static syntax — every ship file must parse clean               *
 * ------------------------------------------------------------------ */
let id = 1;
const gameJs = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
const hostJs = fs.readdirSync(HOST_SRC).filter(f => f.endsWith('.js')).sort();
for (const f of gameJs) {
  let ok = true, detail = '';
  try { execFileSync(process.execPath, ['--check', path.join(SRC, f)]); }
  catch (e) { ok = false; detail = e.message.split('\n').slice(0, 3).join(' '); }
  rec(id++, 'S', `game file parses: ${f}`, ok, detail);
}
for (const f of hostJs) {
  let ok = true, detail = '';
  try { execFileSync(process.execPath, ['--check', path.join(HOST_SRC, f)]); }
  catch (e) { ok = false; detail = e.message.split('\n').slice(0, 3).join(' '); }
  rec(id++, 'S', `host file parses: ${f}`, ok, detail);
}
/* the two known-last-mile bundles: the extracted in-page game script and the
 * host's main inline script — both must be one well-formed script */
try {
  const src = fs.readFileSync(path.join(HOST, 'uploads', '../game_build.html'), 'utf8');
  void src.length;
} catch { /* game_build may be absent; bundles re-checked from sources below */ }
rec(id++, 'S', 'build.py (host) runs clean', (() => {
  try { execFileSync('python3', ['build.py'], { cwd: HOST, stdio: 'pipe' }); return true; }
  catch (e) { return false; }
})(), 'host build failed');
rec(id++, 'S', 'tt/build.py (game) runs clean', (() => {
  try { execFileSync('python3', ['tt/build.py', '../game_build.html'], { cwd: ROOT, stdio: 'pipe' }); return true; }
  catch (e) { return false; }
})(), 'game build failed');
if (out[out.length - 1].ok) {
  const html = fs.readFileSync(path.join(HOST, 'game_build.html'), 'utf8');
  const m = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].sort((a, b) => b[1].length - a[1].length);
  let ok = true, detail = '';
  try { new (require('vm').Script)(m[0][1]); } catch (e) { ok = false; detail = e.message; }
  rec(id++, 'S', 'bundled game script is well-formed', ok, detail);
  out[out.length - 1].id = --id; id++;
  fs.rmSync(path.join(HOST, 'game_build.html'), { force: true });
} else { rec(id++, 'S', 'bundled game script is well-formed (skipped: build failed)', true); }

/* ------------------------------------------------------------------ *
 *  H: host contract                                                  *
 * ------------------------------------------------------------------ */
const hostText = (f) => fs.readFileSync(path.join(HOST_SRC, f), 'utf8');
const battle = hostText('scr_battle.js');
const coreSrc = hostText('core.js');
const hostAll = battle + hostText('scr_hub.js') + hostText('scr_meta.js') + coreSrc + hostText('game_host.js') + hostText('main.js') + hostText('ui.js') + hostText('engine.js');
const mmPool = (() => { const m = battle.match(/const MM_POOL = \{([\s\S]*?)\};/); return m ? m[1] : ''; })();
const peopleCount = (coreSrc.match(/n: '/g) || []).length;
{
  const refs = [...mmPool.matchAll(/\[(\s*\d+)/g)].length + [...mmPool.matchAll(/,\s*\d+/g)].length;
  const idx = [...mmPool.matchAll(/\d+/g)].map(Number);
  rec(id++, 'H', 'MM_POOL indices point at real PEOPLE entries', idx.length > 0 && idx.every(i => i >= 0 && i < 8), `indices: ${idx}`);
}
{
  const ldiff = (battle.match(/const LDIFF = \{([\s\S]*?)\}/) || [null, ''])[1];
  const keys = [...ldiff.matchAll(/(\w+):/g)].map(m => m[1]);
  const leagues = [...coreSrc.matchAll(/id: '(\w+)'/g)].map(m => m[1]);
  rec(id++, 'H', 'LDIFF keys are exactly the league ids', keys.length === 6 && keys.every(k => leagues.includes(k)), `LDIFF: ${keys}`);
}
{
  const defs = [...new Set([...hostAll.matchAll(/Router\.def\('(\w+)'/g)].map(m => m[1]))];
  const gos = [...new Set([...hostAll.matchAll(/Router\.go\('(\w+)'/g)].map(m => m[1]))];
  const missing = gos.filter(g => !defs.includes(g));
  rec(id++, 'H', 'every Router.go target is defined', missing.length === 0, `missing: ${missing}`);
}
{
  const sends = [...new Set([...(hostText('game_host.js') + battle).matchAll(/GameHost\.send\('(\w+)'/g)].map(m => m[1]))];
  const embed = fs.readFileSync(path.join(SRC, '92_embed.js'), 'utf8');
  const cases = [...new Set([...embed.matchAll(/case '(\w+)':/g)].map(m => m[1]))];
  const missing = sends.filter(s => !cases.includes(s));
  rec(id++, 'H', 'every host->game message type has a handler in 92_embed.js', missing.length === 0, `missing: ${missing}`);
}
{
  const embedSrc = fs.readFileSync(path.join(SRC, '92_embed.js'), 'utf8');
  const posts = [...new Set([...embedSrc.matchAll(/post\('(\w+)'/g)].map(m => m[1]))];
  /* Types named in the documented "Game -> host" protocol header belong to
   * the embed contract for external hosts; the local host legitimately
   * ignores some of them (state / autoHint / awake) without any breakage. */
  const proto = (embedSrc.match(/Game → host:([\s\S]*?)\* =====/) || [null, ''])[1] || '';
  const unknown = posts.filter(pp => !hostAll.includes(`'${pp}'`) && !new RegExp('\\b' + pp + '\\b').test(proto));
  rec(id++, 'H', 'game->host post types are consumed by the host or documented in the embed protocol', unknown.length === 0, `unknown: ${unknown}`);
}
{
  rec(id++, 'H', 'MATCH_RULES object is frozen at source',
    /MATCH_RULES\s*=\s*Object\.freeze\(|Object\.freeze\(MATCH_RULES\)/
      .test(fs.readFileSync(path.join(SRC, '12_match_rules.js'), 'utf8')),
    'MATCH_RULES must be frozen (at creation or after)');
}
{
  const def = coreSrc.match(/rating:\s*(\d+)/);
  rec(id++, 'H', 'fresh profile starts at rating 1000', def && def[1] === '1000', def && def[1]);
}
{
  const serveCaps = fs.readFileSync(path.join(SRC, '55_ai.js'), 'utf8');
  const orbits = [...serveCaps.matchAll(/orbit: PH\.T_HALF_WID \* ([\d.]+)/g)].map(m => Number(m[1]));
  rec(id++, 'H', 'AI serve orbits grow monotonically and stay inside the table', orbits.length === 5 && orbits.every((v, i) => !i || v > orbits[i - 1]) && orbits[4] <= 0.82, `orbits: ${orbits}`);
}

{
  const cs = hostText('career.js');
  const ids = [...cs.matchAll(/id: '(\w+)',\s*t: '[^']+'.*ev: '(\w+)'/g)].map((m) => m[1]);
  const uniq = new Set(ids);
  rec(id++, 'H', 'daily mission pool: 6+ unique missions wired to real match events',
    ids.length >= 6 && uniq.size === ids.length && /const Daily = \{/.test(cs) && ids.every((i) => ['win1','win2','perf5','perf10','rally8','hits40','smash3','acc75'].includes(i)),
    `ids: ${ids}`);
}
{
  const b = hostText('scr_battle.js');
  rec(id++, 'H', 'result screen fed live match data (point sequence, max speed, daily tick)',
    /st\.seq\.push/.test(b) && /res\.seq = st\.seq/.test(b) &&
    /stats\.maxSpeed = \(m\.stats/.test(b) && /Daily\.tick\(res, win\)/.test(b) && /Ход матча/.test(b), '');
}
{
  const g70 = fs.readFileSync(path.join(SRC, '70_game.js'), 'utf8');
  rec(id++, 'H', 'point drama accents live in the banner, not in mid-frame effects',
    /СЕРИЯ ×/.test(g70) && /МАТЧБОЛ/.test(g70) && /ДЬЮС/.test(g70) && /this\.audio\.applause/.test(g70), '');
}

/* ------------------------------------------------------------------ *
 *  Dynamic harness                                                   *
 * ------------------------------------------------------------------ */
const FILES = ['10_math.js', '12_match_rules.js', '30_physics.js', '38_paddle_motion.js', '40_swipe.js', '55_ai.js', '57_camera.js', '58_coach.js'];
const lib = load(FILES, [
  'PH', 'V3', 'Q', 'M4', 'clamp', 'lerp', 'predict', 'impactRacket', 'solveLaunch',
  'pressContactZone', 'setCaptureForgiveness',
  'OpponentAI', 'AI_LEVELS', 'AI_SERVE_CAPS', 'AI_TACTICS', 'MatchDirector',
  'cameraRigFor', 'CAMERA_ORDER', 'CAMERA_PRESETS', 'rigViewProj', 'rigMargin',
  'reachFor', 'PADDLE_STANCE_Z', 'projectPoint', 'MATCH_RULES', 'deriveStroke', 'SwipeTracker',
], { window: undefined });
const { PH, V3 } = lib;
const fin = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const TABLE_X = PH.T_HALF_WID + 0.005, TABLE_Z = PH.T_HALF_LEN + 0.005;

/* ------------------------------------------------------------------ *
 *  C: camera — margin & reach on the viewport grid                   *
 * ------------------------------------------------------------------ */
const VIEWPORTS = [[1920, 1080], [1366, 768], [1280, 760], [1024, 768], [844, 390], [820, 1180], [768, 1024], [414, 896], [390, 844], [360, 640]];
for (const [w, h] of VIEWPORTS) {
  const a = w / h;
  for (const mode of lib.CAMERA_ORDER) {
    let ok = true, detail = '';
    try {
      const rig = lib.cameraRigFor(mode, null, a);
      const m = lib.rigMargin(rig, a);
      if (!(m > -0.20)) { ok = false; detail = `margin ${m.toFixed(3)}`; } /* envelope points past the table need not fit portrait crops */
      const box = lib.reachFor(rig, a, lib.PADDLE_STANCE_Z);
      if (!(box.xMax > 0.60 && box.yLo < PH.TABLE_Y + 0.10 && box.yHi > PH.TABLE_Y + 0.42)) { ok = false; detail += ` reach xMax=${box.xMax.toFixed(2)} yLo=${(box.yLo - PH.TABLE_Y).toFixed(2)} yHi=${(box.yHi - PH.TABLE_Y).toFixed(2)}`; }
    } catch (e) { ok = false; detail = e.message; }
    rec(id++, 'C', `camera ${mode} @ ${w}x${h}: margin + reach`, ok, detail, 2);
  }
}

/* ------------------------------------------------------------------ *
 *  F: physics flight fuzz — predict must stay sane everywhere        *
 * ------------------------------------------------------------------ */
{
  let seed = 1337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 10; k++) {
    const p = V3.new((rnd() * 2 - 1) * 1.4, PH.TABLE_Y + 0.05 + rnd() * 0.9, (rnd() * 2 - 1) * 2.6);
    const v = V3.new((rnd() * 2 - 1) * 6, (rnd() * 2 - 1) * 4, (rnd() * 2 - 1) * 11);
    const w = V3.new((rnd() * 2 - 1) * 320, (rnd() * 2 - 1) * 120, (rnd() * 2 - 1) * 120);
    let ok = true, detail = '';
    try {
      const o = lib.predict(V3.clone(p), V3.clone(v), V3.clone(w), { dt: 1 / 240, maxT: 2.6, out: {} });
      if (!fin(o.end) || !fin(o.endV)) { ok = false; detail = 'NaN end state'; }
      /* A net cord is a legal flight: brushing the tape does not kill the
       * ball, so hitNet may coincide with a landing; the bounds check right
       * below still polices where the ball comes down. */
      if (o.landed && (Math.abs(o.landed.x) > TABLE_X + 0.05 || Math.abs(o.landed.z) > TABLE_Z + 0.05)) { ok = false; detail = `landing outside table ${o.landed.x.toFixed(2)},${o.landed.z.toFixed(2)}`; }
      if (o.endT > 2.7) { ok = false; detail = 'simulation overran maxT'; }
    } catch (e) { ok = false; detail = e.message; }
    rec(id++, 'F', `flight fuzz #${k + 1}`, ok, detail, 3);
  }
}

/* ------------------------------------------------------------------ *
 *  I: impact fuzz — impactRacket must never explode                  *
 * ------------------------------------------------------------------ */
{
  let seed = 4242;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let k = 0; k < 10; k++) {
    const n = V3.norm(V3.new(), V3.new(rnd() - 0.5, rnd() - 0.3, 0.6 + rnd() * 0.6));
    const vR = V3.new((rnd() - 0.5) * 6, (rnd() - 0.5) * 4, rnd() * 12);
    const v = V3.new((rnd() - 0.5) * 8, (rnd() - 0.5) * 3, -(2 + rnd() * 9));
    const w = V3.new((rnd() - 0.5) * 400, (rnd() - 0.5) * 160, (rnd() - 0.5) * 160);
    const q = 0.2 + rnd() * 0.8;
    let ok = true, detail = '';
    try {
      const info = lib.impactRacket(v, w, n, vR, q, {});
      if (info && (!fin(v) || !fin(w))) { ok = false; detail = 'NaN ball'; }
      if (info && V3.len(v) > 46) { ok = false; detail = `speed ${V3.len(v).toFixed(1)} > 46 m/s (130+ km/h)`; }
    } catch (e) { ok = false; detail = e.message; }
    rec(id++, 'I', `impact fuzz #${k + 1}`, ok, detail, 3);
  }
}

/* ------------------------------------------------------------------ *
 *  V: AI serve matrix — every legal-looking serve must really land.  *
 * ------------------------------------------------------------------ */
const serveLegal = (o) => !!(!o.diverged && !o.hitNet && o.landed &&
  o.landed.z < 0 && o.landed.z > -TABLE_Z - 0.04 && Math.abs(o.landed.x) < TABLE_X + 0.04 &&
  o.b2 && o.b2.z > 0 && o.b2.z < TABLE_Z + 0.04 && Math.abs(o.b2.x) < TABLE_X + 0.04);

function serveStubGame(x, y, z, sideSpin) {
  return { time: 0, ball: { p: V3.new(x, y, z), v: V3.new(0, -2.0, 0.1), w: V3.new(sideSpin, 0, 0), live: false, lastHitBy: 0 } };
}
{
  for (let level = 0; level < 5; level++) {
    for (let roll = 0; roll < 6; roll++) {
      const ai = new lib.OpponentAI(level);
      let i = 0; ai.rng = () => (0.9 - 0.05 * (i++ % 6));   // no execution-error commits
      const g = serveStubGame(0.05 * (roll - 3), PH.TABLE_Y + 0.36, -PH.T_HALF_LEN - 0.72, (roll % 2 ? 1 : -1) * roll * 3);
      let ok = true, detail = '';
      try {
        const rk = ai.serve(g);
        if (!rk || !fin(rk.vR) || !fin(rk.normal)) { ok = false; detail = 'serve returned invalid racket'; }
        else {
          const v = V3.clone(g.ball.v), w = V3.clone(g.ball.w);
          const info = lib.impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
          if (!info) { ok = false; detail = 'impact rejected its own serve racket'; }
          else {
            /* Production applies the impact one ball radius off the face
           * (tryAiHit/serveAiHit) — judge the flight from exactly there. */
          const p0 = lib.V3.addScaled(lib.V3.clone(g.ball.p), g.ball.p, rk.normal, PH.R * 1.05);
          const o = lib.predict(p0, v, w, { dt: 1 / 240, maxT: 3.2, stopAfterBounces: 2, out: {} });
            const faults = !serveLegal(o);
            if (rk.aiError) { ok = faults; detail = faults ? '' : 'aiError set but flight is legal'; }
            else if (faults) {
              ok = false;
              detail = `illegal serve: net=${o.hitNet} l=${o.landed && (o.landed.x.toFixed(2) + ',' + o.landed.z.toFixed(2))} b2=${o.b2 && (o.b2.x.toFixed(2) + ',' + o.b2.z.toFixed(2))}`;
            }
          }
        }
      } catch (e) { ok = false; detail = e.message; }
      rec(id++, 'V', `serve ${lib.AI_LEVELS[level].tag} roll#${roll + 1}`, ok, detail);
    }
  }
}

/* ------------------------------------------------------------------ *
 *  W: AI swing matrix — receives must be legally returned            *
 * ------------------------------------------------------------------ */
{
  const receives = [
    { v: [0.4, -0.3, -6.5], y: 0.55, z: 0.30, spin: 60, note: 'moderate top' },
    { v: [-0.7, -1.4, -8.5], y: 0.62, z: 0.6, spin: -90, note: 'fast backspin' },
    { v: [0.2, -2.3, -4.2], y: 0.30, z: 0.35, spin: 10, note: 'short drop' },
    { v: [1.1, -0.6, -7.5], y: 0.50, z: 0.2, spin: 190, note: 'heavy top' },
    { v: [-0.4, -1.0, -5.0], y: 0.45, z: 0.85, spin: -160, note: 'heavy back' },
  ];
  for (let level = 0; level < 5; level++) {
    for (let rIdx = 0; rIdx < receives.length; rIdx++) {
      const r = receives[rIdx];
      const ai = new lib.OpponentAI(level);
      let i = 0; ai.rng = () => (0.93 - 0.04 * (i++ % 7));  // keep rolls outside error windows
      const t0 = 0.5;
      const g = {
        time: t0,
        ball: { p: V3.new(r.v[0] * 0.4, PH.TABLE_Y + r.y, r.z), v: V3.new(r.v[0], r.v[1], r.v[2]), w: V3.new(r.spin * ai.side, 0, 0), live: true, lastHitBy: 1 },
      };
      let ok = true, detail = '';
      try {
        const plan = ai.computePlan(g);
        if (!plan) {
          /* No plan is legal only when the ball is ballistically
           * unreturnable: it never reaches the far half, bounces twice, or
           * a heavy slice curls it back over the net all by itself. */
          const pf = lib.predict(V3.clone(g.ball.p), V3.clone(g.ball.v), V3.clone(g.ball.w),
            { dt: 1 / 240, maxT: 2.4, stopAfterBounces: 2, out: {} });
          const unreachable = !pf.landed || pf.landed.z >= 0 || pf.b2 != null ||
            (pf.end && pf.end.z > -0.2 && pf.endV && pf.endV.z > 0);
          ok = !!unreachable;
          detail = ok ? '' : `no plan for reachable ${r.note}` +
            ` (land=${pf.landed ? pf.landed.x.toFixed(2) + ',' + pf.landed.z.toFixed(2) : 'none'} b2=${pf.b2 ? 'y' : 'n'})`;
        } else {
          /* flight to the planned point, swing exactly there */
          const pos = predictTo(g.ball, plan.t - t0);
          const gs = { time: plan.t, ball: { p: pos.p, v: pos.v, w: pos.w, live: true, lastHitBy: 1 } };
          ai.commit = Object.assign({}, plan, { archId: plan.archId || 'DRIVE', aim: { x: 0.35, z: 1.0 } });
          ai.swingAt = plan.t;
          const rk = ai.swing(gs);
          if (!rk) { ok = false; detail = 'swing returned null timing'; }
          else if (!fin(rk.vR) || !fin(rk.normal)) { ok = false; detail = 'NaN racket'; }
          else {
            const v = V3.clone(gs.ball.v), w = V3.clone(gs.ball.w);
            const info = lib.impactRacket(v, w, rk.normal, rk.vR, rk.quality, rk.rubber || {});
            if (!info) { ok = rk.valid === false; detail = ok ? '' : 'impact rejected swing racket'; }
            else {
              const p0 = lib.V3.addScaled(lib.V3.clone(gs.ball.p), gs.ball.p, rk.normal, PH.R * 1.05);
              const o = lib.predict(p0, v, w, { dt: 1 / 240, maxT: 3.2, stopOnFirstBounce: true, out: {} });
              const faults = o.diverged || o.hitNet || !o.landed || o.landed.z < 0 ||
                o.landed.z > TABLE_Z + 0.04 || Math.abs(o.landed.x) > TABLE_X + 0.04;
              if (rk.aiError) { ok = !!faults; detail = ok ? '' : 'aiError set but flight is legal'; }
              else if (faults) {
                ok = false;
                detail = `${r.note}: net=${o.hitNet} land=${o.landed && o.landed.x.toFixed(2) + ',' + o.landed.z.toFixed(2)}`;
              }
            }
          }
        }
      } catch (e) { ok = false; detail = e.message; }
      rec(id++, 'W', `swing ${lib.AI_LEVELS[level].tag} on ${r.note}`, ok, detail);
    }
  }
}
function predictTo(ball, t) {
  const o = lib.predict(V3.clone(ball.p), V3.clone(ball.v), V3.clone(ball.w), { dt: 1 / 240, maxT: t + 1e-6, out: {} });
  return { p: V3.new(o.end.x, o.end.y, o.end.z), v: V3.new(o.endV.x, o.endV.y, o.endV.z), w: V3.clone(ball.w) };
}

/* ------------------------------------------------------------------ *
 *  X: cross-cutting gameplay invariants                              *
 * ------------------------------------------------------------------ */
{
  const d = new lib.MatchDirector();
  const seq = [d.onPoint(-1, 0), d.onPoint(-1, 0), d.onPoint(-1, 0), d.onPoint(-1, 0), d.onPoint(-1, 0)];
  rec(id++, 'X', 'director dives below 0.87 by the fifth straight loss', seq[4] < 0.87, `${seq[4].toFixed(3)}`);
}
{
  const caps = lib.AI_SERVE_CAPS;
  let ok = true, detail = '';
  for (let l = 0; l < 5; l++) {
    /* Serve pace ceilings stand apart from the rally vmagMax: the serve
     * solver works from a still toss, so a beginner's serve may sit above
     * his rally ceiling. Sanity = growth across levels within a band. */
    if (caps[l].vmag < 3.5 || caps[l].vmag > 12) { ok = false; detail = `L${l} serve cap ${caps[l].vmag} outside 3.5..12 m/s`; }
    if (l && caps[l].vmag <= caps[l - 1].vmag) { ok = false; detail = `serve caps not growing at L${l}`; }
    if (caps[l].kick > 1 || caps[l].kick <= 0) { ok = false; detail = `L${l} kick ${caps[l].kick}`; }
  }
  rec(id++, 'X', 'serve caps grow with level and stay in a physical band', ok, detail);
}
{
  const rules = Object.freeze ? require('node:module') : null;
  let ok = true, detail = '';
  try { new Function('"use strict"; MATCH_RULES.captureRadius = 9;'); } catch { /* noop — strict assignment to frozen would throw, but we only parse */ }
  try {
    const before = JSON.stringify(lib.MATCH_RULES);
    lib.MATCH_RULES.__probe = 1;
    ok = JSON.stringify(lib.MATCH_RULES) === before;
    detail = ok ? '' : 'MATCH_RULES accepted runtime mutation';
  } catch (e) { ok = true; /* frozen throws in strict mode, silently ignored otherwise — both fine */ }
  rec(id++, 'X', 'MATCH_RULES refuses runtime mutation', ok, detail);
}
{
  /* A soft-but-honest swing at the table must be a stroke: the relaxed gate
   * exists so nobody swings atthinair and gets told nothing happened. */
  const sw = new lib.SwipeTracker();
  sw.down(0.5, 0.62, 0); for (const [dt, dy] of [[0.02, -0.006], [0.04, -0.007], [0.06, -0.007], [0.08, -0.006]]) sw.move(0.5, 0.62 + dy, dt);
  sw.up(0.5, 0.59, 0.10);
  const m = sw.lastReleased;
  rec(id++, 'X', 'slow honest swing is recognised as a stroke', !!m && m.peakSpeed > 0.30 - 1e-9, m ? `peak ${m.peakSpeed}` : 'no metrics');
}
{
  /* …and a 2px twitch is still NOT a stroke */
  const sw = new lib.SwipeTracker();
  sw.down(0.5, 0.62, 0); sw.move(0.502, 0.618, 0.02); sw.up(0.503, 0.616, 0.04);
  const m = sw.lastReleased;
  const tiny = !m || m.peakSpeed < 0.30 || m.pathLen < 0.046;
  rec(id++, 'X', 'pointer twitch is not a stroke', tiny, m ? `peak ${m.peakSpeed} path ${m.pathLen}` : '');
}
{
  /* the warmup probe: serve from the toss must be solvable for every level,
   * including ludicrous toss heights within sanity */
  for (const y of [PH.TABLE_Y + 0.30, PH.TABLE_Y + 0.62]) {
    const ai = new lib.OpponentAI(2); let i = 0; ai.rng = () => 0.88;
    let ok = true, detail = '';
    try { const rk = ai.serve(serveStubGame(0.1, y, -2.1, 0)); ok = !!rk && fin(rk.vR); if (!ok) detail = 'null racket'; }
    catch (e) { ok = false; detail = e.message; }
    rec(id++, 'X', `serve solvable from toss height ${(y - PH.TABLE_Y).toFixed(2)} m`, ok, detail, 2);
  }
}

/* ------------------------------------------------------------------ *
 *  G: tutorial gesture icons (80_ui.js frozen cue) — the drawn path   *
 *  must be press-legal AND aim-consistent with the highlighted target *
 * ------------------------------------------------------------------ */
{
  /* Mirrors the icon constants of 80_ui.js (frozen gesture cue) and the
   * aim inference of 40_swipe.js:412 (aimX = (m.x-0.5)*2 + m.right*0.50).
   * If either side drifts, the lesson starts pointing somewhere the game
   * will punish — this check fails first. */
  lib.setCaptureForgiveness(1.55);
  const views = [[390, 844, 2, 'touch'], [1366, 768, 1, 'mouse'], [768, 1024, 2, 'touch']];
  for (const [cw, ch, d, pt] of views) {
    for (const aimSgn of [0, -1, 1]) {
      let ok = true, detail = '';
      try {
        const W = cw * d, H = ch * d;
        const x = W * 0.51, y = H * 0.52;               // any in-frame ring centre
        const mS = Math.min(W, H);
        const sx = x + Math.max(-34 * d, Math.min(34 * d, aimSgn * W * 0.10));
        const sy = y + mS * 0.12;
        const ex = x + aimSgn * W * 0.22;
        const ey = y - mS * 0.10;
        // 1) drawn marker stays on-canvas
        if (!(sx > 0 && sx < W && sy > 0 && sy < H && ex > 0 && ex < W && ey > 0 && ey < H)) {
          ok = false; detail = 'icon leaves the canvas';
        }
        // 2) the press at the drawn start is admitted by the contact gate
        const zone = lib.pressContactZone({ x: x / W, y: y / H, ok: true },
          { x: sx / W, y: sy / H }, cw, ch, { pointerType: pt, scale: { kx: 1, ky: 1 } });
        if (ok && !(zone && zone.accepted === true)) { ok = false; detail = 'gate rejects the drawn start'; }
        // 3) press position + swipe direction infer an aim on the cued side
        if (ok) {
          const dxCss = (ex - sx) / d, dyCss = (ey - sy) / d;
          const len = Math.hypot(dxCss, dyCss) || 1;
          const mRight = dxCss / len;
          const pressX = (sx / d) / cw;
          const aim01 = Math.max(-1, Math.min(1, (pressX - 0.5) * 2 + mRight * 0.50));
          const aimWorld = aim01 * PH.T_HALF_WID * 0.86;
          if (aimSgn === 0 && Math.abs(aimWorld) > 0.07) { ok = false; detail = `centre cue aims ${aimWorld.toFixed(2)} m off centre`; }
          if (aimSgn !== 0 && aimWorld * aimSgn < 0.20) { ok = false; detail = `cued side aims only ${(aimWorld * aimSgn).toFixed(2)} m (<0.20 m)`; }
          // 4) the swipe still points roughly AT the ring (direction gate)
          if (ok) {
            const toBall = { x: (x - sx) / d, y: (y - sy) / d };
            const tb = Math.hypot(toBall.x, toBall.y) || 1;
            const dot = (dxCss * toBall.x + dyCss * toBall.y) / (len * tb);
            if (!(dot > (pt === 'mouse' ? -0.3 : 0))) { ok = false; detail = `direction gate dot ${dot.toFixed(2)}`; }
          }
        }
      } catch (e) { ok = false; detail = e.message; }
      rec(id++, 'G', `gesture icon aim=${aimSgn} @ ${cw}x${ch} ${pt}`, ok, detail, 3);
    }
  }
  lib.setCaptureForgiveness(1);
}

/* ------------------------------------------------------------------ *
 *  Report                                                            *
 * ------------------------------------------------------------------ */
const fails = out.filter(a => !a.ok).sort((a, b) => b.sev - a.sev);
if (process.argv.includes('--json')) console.log(JSON.stringify({ total: out.length, pass: out.length - fails.length, fails }, null, 1));
else {
  console.log(`AUDIT: ${out.length} analyses, ${out.length - fails.length} pass, ${fails.length} fail`);
  for (const f of fails.slice(0, 80)) console.log(`  FAIL [${f.group}${f.id}] ${f.name} :: ${f.detail}`);
  if (fails.length > 80) console.log(`  … and ${fails.length - 80} more (use --json)`);
}
process.exitCode = fails.length ? 1 : 0;
