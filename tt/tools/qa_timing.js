/* =====================================================================
 *  INPUT WINDOW — where in the ring's closure must the swipe be?
 *
 *  For a fixed gesture, sweep the moment the swipe STARTS relative to the
 *  frame the strike ring first opens its contact window (W.t <= 0.09 s)
 *  and report what physically happens: contact or not, and where the ball
 *  lands (z < 0 = the opponent's half, z < -1.37 = past the far edge).
 *
 *  Usage: node tt/tools/qa_timing.js
 *  Env:   QA_CHROME / QA_LIBS for a specific Chromium (see qa_live.js)
 * ===================================================================== */
const puppeteer = require('puppeteer');
const path = require('path');
const GAME = path.resolve(__dirname, '..', '..', 'table-tennis-topspin.html');
const EXE = process.env.QA_CHROME || undefined;
if (process.env.QA_LIBS) process.env.LD_LIBRARY_PATH = process.env.QA_LIBS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const br = await puppeteer.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  await page.goto('file://' + GAME, { waitUntil: 'load' }); await sleep(2200);

  const res = await page.evaluate(async () => {
    const g = window.__game;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    g.paused = true;
    const DT = 1 / 240;
    const aimAt = () => {
      const W = g._strike;
      const wx = (W && W.on) ? W.x : g.ball.p.x, wy = (W && W.on) ? W.y : g.ball.p.y;
      return { x: 0.5 + wx / 2.1, y: 0.18 + (0.76 + 0.62 - Math.max(0.56, Math.min(1.61, wy))) / 0.95 };
    };
    /* Deterministic sweep: advance once to the frame the ring opens, snapshot
       the world, then replay the SAME rally from that snapshot with the swipe
       starting at a different offset.  Nothing but the offset changes. */
    const snapshotOf = (g) => JSON.stringify({
      t: g.time, state: g.state, ball: { p: g.ball.p, v: g.ball.v, w: g.ball.w, live: g.ball.live, lastHitBy: g.ball.lastHitBy },
      pad: { pos: g.player.pos, normal: g.player.normal, vel: g.player.vel, lastHitT: g.player.lastHitT },
      rallies: g.rallyBounces, shotId: g.shotId,
    });
    const restore = (g, s) => {
      const o = JSON.parse(s);
      g.time = o.t; g.state = o.state;
      Object.assign(g.ball.p, o.ball.p); Object.assign(g.ball.v, o.ball.v); Object.assign(g.ball.w, o.ball.w);
      g.ball.live = o.ball.live; g.ball.lastHitBy = o.ball.lastHitBy;
      Object.assign(g.player.pos, o.pad.pos); Object.assign(g.player.normal, o.pad.normal); Object.assign(g.player.vel, o.pad.vel);
      g.player.lastHitT = o.pad.lastHitT;
      g.rallyBounces.length = 0; o.rallies.forEach((r) => g.rallyBounces.push(r));
      g.shotId = o.shotId;
      g.slowmoUntil = 0; g.targetTimeScale = 1; g.timeScale = 1;
    };

    g.ui.trainHide(); g.training = null; g.startTraining();
    let tr = g.training;
    while (tr.step < 1) tr.nextStep();
    let snap = null;
    for (let i = 0; i < 240 * 8; i++) {
      g.update(DT);
      const W = g._strike;
      if (W && W.on && W.kind === 'rally' && W.ready > 0.5 && W.t <= 0.09) { snap = snapshotOf(g); break; }
    }
    const tSnap = JSON.parse(snap).t;

    const runTrial = (offset) => {
      restore(g, snap);
      g.swipe.cancel(); g.pointerDown = false; g.swipeReleasedAt = -9;
      const tr2 = g.training;
      tr2.phase = 'live'; tr2.t = 0; tr2.done = 0; tr2.msg = '';
      const tC = tSnap;
      let started = false, contacted = false, landZ = null, verdict = '';
      for (let i = 0; i < 240 * 4; i++) {
        g.update(DT);
        if (!started && g.time >= tC + offset) {
          started = true;
          const a = aimAt(), t0 = g.time, dur = 0.13;
          const pts = [[0, 0.10], [0.005, 0.02], [0.010, -0.06], [0.015, -0.13]];
          g.swipe.down(a.x, a.y, t0); g.pointer = { x: a.x, y: a.y }; g.pointerDown = true;
          for (let k = 1; k < pts.length; k++) g.swipe.move(a.x + pts[k][0], a.y + pts[k][1], t0 + dur * k / (pts.length - 1));
          g.swipe.up(a.x + pts[pts.length - 1][0], a.y + pts[pts.length - 1][1], t0 + dur);
          g.pointerDown = false; g.swipeReleasedAt = g.time;
        }
        if (g.ball.lastHitBy === 1) contacted = true;   // side +1 = the human
        if (contacted && g.rallyBounces.length && landZ === null) landZ = +g.ball.p.z.toFixed(2);
        if (tr2.done > 0 || (tr2.msg && i > 24)) { verdict = tr2.msg || 'HIT'; break; }
      }
      return { offset, contact: contacted, landZ, done: tr2.done, verdict };
    };
    const out = [];
    for (const off of [-0.30, -0.25, -0.20, -0.16, -0.12, -0.08, -0.04, 0.0, 0.04, 0.08, 0.12, 0.16]) {
      out.push(runTrial(off));
    }
    return out;
  });

  console.log('детерминированный свип: один и тот же момент розыгрыша, меняется только старт жеста');
  console.log('смещение старта | удар | done | вердикт тренера');
  for (const r of res) {
    console.log('  ' + (r.offset * 1000).toFixed(0).padStart(5) + ' ms      ' + (r.contact ? ' да ' : ' нет') + '   ' + String(r.done).padStart(2) + '   ' + r.verdict);
  }
  await br.close();
})().catch((e) => { console.error('FAIL', e.stack); process.exit(1); });
