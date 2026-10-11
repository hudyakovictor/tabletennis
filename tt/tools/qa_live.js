/* =====================================================================
 *  LIVE QA — boots the real bundle in headless Chromium (SwiftShader GL),
 *  plays it as a synthetic human (swipes spread over real frames, so the
 *  gesture tracker sees human-scale velocities), walks the onboarding,
 *  measures the default experience end to end, checks the phone layout,
 *  and screenshots every state.
 *
 *  Usage:  node tt/tools/qa_live.js [outdir]
 *  Env: QA_CHROME / QA_LIBS to use a specific Chromium binary and its
 *       library path when puppeteer's own download is unavailable.
 * ===================================================================== */
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const GAME = path.resolve(__dirname, '..', '..', 'table-tennis-topspin.html');
const OUT = process.argv[2] || path.resolve(__dirname, '..', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The headless browser: by default whatever puppeteer ships with.  In a bare
   sandbox with no system Chromium, point QA_CHROME at any Chromium binary and
   QA_LIBS at the directory holding its NSS libraries. */
const EXE = process.env.QA_CHROME || undefined;
if (process.env.QA_LIBS) process.env.LD_LIBRARY_PATH = process.env.QA_LIBS;

/* ---------------- in-page synthetic player ---------------- *
 * Gestures are spread across real frames: the driver is ticked once per
 * simulated frame, so the swipe tracker sees a realistic velocity profile
 * (0.3–3 screen-heights per second), exactly like a finger does.          */
const PLAYER = `
  const g = window.__game;
  const TY = 0.76;
  const toScreen = (wx, wy) => ({
    x: 0.5 + wx / (2.10 * g.settings.sensitivity),
    y: 0.18 + (TY + 0.62 - wy) / (0.95 * g.settings.sensitivity),
  });
  const aimAt = () => {
    const W = g._strike;
    let wx, wy;
    if (W && W.on) { wx = W.x; wy = W.y; } else { wx = g.ball.p.x; wy = g.ball.p.y; }
    if (g.state === 'SERVE_TOSS') { wx = g.ball.p.x; wy = TY + 0.16; }
    return toScreen(Math.max(-1.1, Math.min(1.1, wx)), Math.max(TY - 0.2, Math.min(TY + 0.85, wy)));
  };
  // shapes are screen-space offsets from the aim point (x right, y down)
  const GEST = {
    loop:  { pts: [[0.00, 0.10], [0.005, 0.02], [0.012, -0.06], [0.018, -0.13]], dur: 0.11 },
    push:  { pts: [[0.00, -0.09], [0.00, -0.01], [0.00, 0.07], [0.00, 0.14]], dur: 0.14 },
    side:  { pts: [[-0.04, 0.09], [-0.015, 0.03], [0.03, -0.02], [0.09, -0.05]], dur: 0.13 },
    block: { pts: [[0.00, 0.02], [0.004, 0.008], [0.008, -0.004]], dur: 0.07 },
    smash: { pts: [[-0.02, 0.05], [0.05, 0.02], [0.13, -0.01]], dur: 0.05 },
    serveUp: { pts: [[0.00, 0.13], [0.005, 0.04], [0.01, -0.05], [0.015, -0.14]], dur: 0.12 },
  };
  let plan = null;      // active gesture
  let lastStart = -9;
  const driver = {
    start(kind) {
      const G = GEST[kind] || GEST.loop;
      const a = aimAt();
      plan = {
        pts: G.pts.map(p => ({ x: Math.max(0.02, Math.min(0.98, a.x + p[0])), y: Math.max(0.02, Math.min(0.98, a.y + p[1])) })),
        dur: G.dur, t0: g.time, k: 1, off: false, kind,
      };
      const p0 = plan.pts[0];
      g.swipe.down(p0.x, p0.y, g.time);
      g.pointer = { x: p0.x, y: p0.y }; g.pointerDown = true;
      lastStart = g.time;
      return true;
    },
    tick() {
      if (!plan) return;
      const n = plan.pts.length;
      while (plan && plan.k < n && g.time - plan.t0 >= plan.dur * (plan.k / (n - 1))) {
        const p = plan.pts[plan.k];
        g.swipe.move(p.x, p.y, g.time);
        g.pointer = { x: p.x, y: p.y };
        plan.k++;
      }
      if (plan && plan.k >= n) {
        const p = plan.pts[n - 1];
        g.swipe.up(p.x, p.y, g.time);
        g.pointerDown = false; g.swipeReleasedAt = g.time; g.lastSwipeT = g.time;
        plan = null;
      }
    },
    busy() { return !!plan; },
    since() { return g.time - lastStart; },
  };
  return { g, driver, aimAt, GEST, TY, toScreen };
`;

(async () => {
  const br = await puppeteer.launch({
    executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox', '--window-size=1280,760', '--force-device-scale-factor=1'],
  });
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  const t0 = Date.now();
  await page.goto('file://' + GAME, { waitUntil: 'load' });
  await sleep(2200);
  console.log('boot to interactive:', Date.now() - t0, 'ms');
  await page.screenshot({ path: path.join(OUT, 'live-1-menu.png') });
  await page.click('#btnSettings'); await sleep(350);
  await page.screenshot({ path: path.join(OUT, 'live-2-settings.png') });
  await page.click('#setClose'); await sleep(250);

  /* ---------- onboarding walkthrough ---------- */
  await page.click('#train0'); await sleep(800);
  await page.screenshot({ path: path.join(OUT, 'live-3-training.png') });

  const train = await page.evaluate(async (PLAYER_SRC) => {
    const P = new Function(PLAYER_SRC)();
    const g = P.g, driver = P.driver;
    g.paused = true;                       // drive the clock ourselves
    const dt = 1 / 120;
    const log = [], msgs = [];
    const steps = [];
    let lastStep = -1, stepStart = 0, swipes = 0;
    for (let i = 0; i < 120 * 240; i++) {
      const tr = g.training;
      if (!tr) { log.push('trainer vanished at ' + g.time.toFixed(1)); break; }
      if (tr.step !== lastStep) {
        if (lastStep >= 0) steps.push({ id: steps._lastId, secs: +(g.time - stepStart).toFixed(1), swipes, done: tr.done, msg: msgs.slice(-1)[0] || '' });
        lastStep = tr.step; stepStart = g.time; swipes = 0; steps._lastId = tr.S.id;
        log.push('-- step ' + tr.step + ' ' + tr.S.id + ' @' + g.time.toFixed(1) + 's');
      }
      if (tr.msg && msgs[msgs.length - 1] !== tr.msg) msgs.push(tr.msg);
      if (tr.phase === 'done') { steps.push({ id: tr.S.id, secs: +(g.time - stepStart).toFixed(1), swipes, done: tr.done, msg: 'COMPLETE' }); break; }
      if ((tr.phase === 'intro') && tr.t > 0.45) g.pointerDown = true;

      g.update(dt);
      driver.tick();

      const W = g._strike;
      const idle = !driver.busy() && driver.since() > 0.30;
      const isServe = tr.S.id === 'SERVE';
      if (idle && isServe) {
        if (g.state === 'SERVE_READY' && g.server === 1) { g.startToss(); g.pointerDown = true; }
        else if (g.state === 'SERVE_TOSS' && g.ball.lastHitBy === 0 && g.ball.v.y < 0 && g.ball.p.y < TY + 0.42) {
          if (driver.start('serveUp')) swipes++;
        }
      } else if (idle && W && W.on && W.kind === 'rally' && W.ready > 0.5 && W.t <= 0.115) {
        // start the gesture so that it lands on the ball at contact
        const kind = tr.S.id === 'SMASH' ? 'smash' : tr.S.id === 'PUSH' ? 'push' : tr.S.id === 'SIDE' ? 'side' : 'loop';
        if (driver.start(kind)) swipes++;
      }
    }
    if (g.training) log.push('end: step ' + g.training.step + ' "' + g.training.S.id + '" phase ' + g.training.phase + ' msg ' + (g.training.msg || '-'));
    return { steps, log, msgs: msgs.slice(-8), done: !!(g.training && g.training.phase === 'done'), t: +g.time.toFixed(1) };
  }, PLAYER);
  console.log('\n--- ONBOARDING (player follows the coach ghost gestures) ---');
  console.log(train.log.slice(-16).join('\n'));
  console.log('completed:', train.done, ' simulated seconds:', train.t);
  console.log('last coach messages:', JSON.stringify(train.msgs.slice(-3)));
  await page.screenshot({ path: path.join(OUT, 'live-4-training-end.png') });

  /* ---------- match at three assist levels ---------- */
  const match = await page.evaluate(async (PLAYER_SRC) => {
    const P = new Function(PLAYER_SRC)();
    const g = P.g, driver = P.driver;
    const res = {};
    for (const assist of [0.72, 0.35, 0.0]) {
      g.settings.assist = assist;
      g.settings.posAssist = assist === 0 ? 0 : 0.8;
      g.startMatch(2);
      g.paused = true;
      const dt = 1 / 120;
      let swings = 0, rallies = [], lastR = 0;
      for (let i = 0; i < 120 * 120; i++) {
        if (g.state === 'MATCH_END') break;
        g.update(dt);
        driver.tick();
        const W = g._strike;
        const idle = !driver.busy() && driver.since() > 0.22;
        if (g.state === 'SERVE_READY' && g.server === 1) { g.startToss(); g.pointerDown = true; }
        if (idle && g.state === 'SERVE_TOSS' && g.ball.lastHitBy === 0 && g.ball.v.y < 0 && g.ball.p.y < 0.76 + 0.42) {
          if (driver.start('serveUp')) swings++;
        } else if (idle && W && W.on && W.kind === 'rally' && W.ready > 0.5 && W.t <= 0.115) {
          const high = (W.y > 0.99);
          if (driver.start(high ? 'smash' : 'loop')) swings++;
        }
        if (g.rally > lastR) { rallies.push(g.rally); lastR = g.rally; }
        if (g.state !== 'RALLY') lastR = 0;
      }
      res['assist_' + assist.toFixed(2)] = {
        score: g.score[0] + ':' + g.score[1], state: g.state,
        mySwings: swings, pointsWon: g.score[0],
        longestMyRally: rallies.length ? Math.max(...rallies) : 0,
      };
    }
    return res;
  }, PLAYER);
  console.log('\n--- MATCH vs PRO (synthetic player: always loop / smash, proper timing) ---');
  console.log(JSON.stringify(match, null, 1));

  await page.evaluate(() => { const g = window.__game; g.settings.assist = 0.72; g.settings.posAssist = 0.8; g.startMatch(2); });
  await sleep(1500);
  await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 40; i++) { g.update(1 / 120); } });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, 'live-5-match.png') });

  const perf = await page.evaluate(async () => {
    const g = window.__game;
    let n = 0; const t = performance.now();
    await new Promise((res) => { const tick = () => { n++; if (performance.now() - t > 2000) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    return { fpsSoftwareGL: +(n / ((performance.now() - t) / 1000)).toFixed(1), heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null };
  });
  console.log('perf:', JSON.stringify(perf), '(software rasteriser — not a device number)');

  /* ---------- phone ---------- */
  const phone = await br.newPage();
  await phone.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await phone.goto('file://' + GAME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(3000);
  await phone.screenshot({ path: path.join(OUT, 'live-6-phone-menu.png') });
  await phone.evaluate(() => { document.querySelectorAll('.screen').forEach(s => s.classList.remove('on')); window.__game.startMatch(2); window.__game.startToss(); });
  await sleep(1200);
  await phone.evaluate(() => { const g = window.__game; for (let i = 0; i < 90; i++) { g.update(1 / 120); g.pointer = { x: 0.5, y: 0.62 }; } });
  await sleep(500);
  await phone.screenshot({ path: path.join(OUT, 'live-7-phone-play.png') });
  const layout = await phone.evaluate(() => {
    const c = document.getElementById('gl');
    const boxes = ['.sb-side', '#shot', '#topright', '#train'].map((s) => {
      const el = document.querySelector(s); if (!el) return s + ':none';
      const r = el.getBoundingClientRect();
      return s + ' [' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']';
    });
    return { canvas: c.width + 'x' + c.height, css: c.clientWidth + 'x' + c.clientHeight, dpr: window.devicePixelRatio, boxes, state: window.__game.state };
  });
  console.log('\nphone layout:', JSON.stringify(layout));

  console.log('\nconsole/page errors:', errs.length ? errs.slice(0, 10).join('\n') : 'none');
  console.log('screenshots ->', OUT);
  await br.close();
})().catch((e) => { console.error('FAIL', e.stack); process.exit(1); });
