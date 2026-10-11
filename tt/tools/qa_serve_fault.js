/* A player presses to toss the ball and does not swipe.
   Does the assisted bat touch the ball on its own, and what does the rules
   engine award?  Hooks awardPoint() to capture the exact reason. */
const puppeteer = require('puppeteer');
const path = require('path');
const GAME = path.resolve(__dirname, '..', '..', 'table-tennis-topspin.html');
const EXE = process.env.QA_CHROME || undefined;
if (process.env.QA_LIBS) process.env.LD_LIBRARY_PATH = process.env.QA_LIBS;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const br = await puppeteer.launch({ executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });
  const page = await br.newPage(); await page.setViewport({ width: 1280, height: 760 });
  await page.goto('file://' + GAME, { waitUntil: 'load' }); await sleep(2200);
  const out = await page.evaluate(async () => {
    const g = window.__game;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    g.training = null; g.ui.trainHide();
    const log = [];
    const origAward = g.awardPoint.bind(g);
    g.awardPoint = (who, why) => { log.push('AWARD point to ' + (who > 0 ? 'player' : 'ai') + ' — reason: ' + why); return origAward(who, why); };
    g.startMatch(2); g.paused = true;
    g.server = 1; g.setState('SERVE_READY');
    const dt = 1 / 240;
    let lastH = -9, lastB = 0, tossed = false, scoreAt = g.score[0] + g.score[1];
    for (let i = 0; i < 240 * 15; i++) {
      g.update(dt);
      const b = g.ball;
      if (b.lastHitBy !== lastH) { log.push('  hitBy ' + b.lastHitBy + ' @' + g.time.toFixed(3) + ' y=' + b.p.y.toFixed(3) + ' z=' + b.p.z.toFixed(2) + ' |v|=' + (Math.hypot(b.v.x, b.v.y, b.v.z) * 3.6).toFixed(1) + ' km/h' + (g.swipe.active ? ' [swipe active]' : '')); lastH = b.lastHitBy; }
      if (g.rallyBounces.length !== lastB) { lastB = g.rallyBounces.length; log.push('  bounce side=' + g.rallyBounces.slice(-1)[0] + ' @' + g.time.toFixed(3) + ' y=' + b.p.y.toFixed(3) + ' z=' + b.p.z.toFixed(2) + ' isServe=' + g.isServeBall + ' serveBounces=' + g.serveBounces); }
      if (!tossed && g.state === 'SERVE_READY' && g.server === 1) { g.startToss(); g.pointerDown = true; tossed = true; log.push('== TOSS @' + g.time.toFixed(3) + ' — and then the player does nothing'); }
      if (g.score[0] + g.score[1] > scoreAt) { log.push('  (point awarded)'); break; }
      if (g.state === 'SERVE_TOSS' && g.ball.lastHitBy !== 0 && i % 24 === 0) { /* keep going */ }
    }
    return log;
  });
  console.log(out.join('\n'));
  await br.close();
})().catch((e) => { console.error('FAIL', e.stack); process.exit(1); });
