/* Captures the states worth looking at: mid-rally with the strike ring
   closing, the low camera, and telemetry on.  node tt/tools/qa_shots.js */
const puppeteer = require('puppeteer');
const path = require('path');
const GAME = path.resolve(__dirname, '..', '..', 'table-tennis-topspin.html');
const OUT = path.resolve(__dirname, '..', 'shots');
/* The headless browser: by default whatever puppeteer ships with.  In a bare
   sandbox with no system Chromium, point QA_CHROME at any Chromium binary and
   QA_LIBS at the directory holding its NSS/Qt libraries. */
const EXE = process.env.QA_CHROME || undefined;
if (process.env.QA_LIBS) process.env.LD_LIBRARY_PATH = process.env.QA_LIBS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const br = await puppeteer.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });
  const page = await br.newPage();
  await page.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
  await page.goto('file://' + GAME, { waitUntil: 'load' }); await sleep(2200);
  await page.evaluate(() => { document.querySelectorAll('.screen').forEach(s => s.classList.remove('on')); const g = window.__game; g.startMatch(1); g.paused = true; });

  // run until the moment the ring is closing on an incoming ball
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 120 * 25; i++) {
      g.update(1 / 120);
      if (g.state === 'SERVE_READY' && g.server === 1) g.startToss();
      const W = g._strike;
      if (g.state === 'SERVE_TOSS' && g.ball.lastHitBy === 0 && g.ball.v.y < 0 && g.ball.p.y < 0.95) {
        const a = { x: 0.5 + g.ball.p.x / 2.1, y: 0.18 + (0.76 + 0.62 - 0.92) / 0.95 };
        const t0 = g.time;
        g.swipe.down(a.x, a.y, t0); g.pointer = { x: a.x, y: a.y }; g.pointerDown = true;
        g.swipe.move(a.x + 0.005, a.y - 0.06, t0 + 0.05); g.swipe.move(a.x + 0.01, a.y - 0.13, t0 + 0.11);
        g.swipe.up(a.x + 0.01, a.y - 0.13, t0 + 0.11); g.pointerDown = false; g.swipeReleasedAt = g.time;
      }
      const R = g._strike;
      if (g.state === 'RALLY' && R && R.on && R.ready > 0.8 && R.t < 0.16) break;
    }
  });
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, 'shot-1-ring.png') });
  await page.evaluate(() => { const g = window.__game; g.settings.camera = 'LOW'; });
  await sleep(900); await page.screenshot({ path: path.join(OUT, 'shot-2-low.png') });
  await page.evaluate(() => { const g = window.__game; g.settings.camera = 'BROADCAST'; g.settings.showDebug = true; });
  await sleep(900); await page.screenshot({ path: path.join(OUT, 'shot-3-debug.png') });
  await br.close();
  console.log('ok ->', OUT);
})().catch((e) => { console.error('FAIL', e.stack); process.exit(1); });
