/* Serve frames: racket height, left/right drift on toss. */
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/topspin-browser-libs/lib' }
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.setViewport({ width: 1280, height: 760 });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'play/index.html')).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0, { timeout: 30000 });
  // SERVE_READY: where does the bat sit?
  await page.evaluate(() => {
    const g = window.__game;
    document.querySelectorAll('.screen, #loading, #menu, #hud, #playband, #topright, #msghud, #fx').forEach(el => el.style.display = 'none');
    g.startMatch(2); g.paused = false; g.server = 1; g.prepServe();
    g.pointer = { x: 0.5, y: 0.62 }; g.pointerInside = true;
  });
  await new Promise(r => setTimeout(r, 900));
  const a = await page.evaluate(() => ({ pos: { ...window.__game.player.pos }, st: window.__game.state }));
  await page.screenshot({ path: '/tmp/serve_ready.png' });
  // press and toss
  await page.mouse.move(640, 470);
  await page.mouse.down();
  await page.evaluate(() => window.__game.startToss());
  await new Promise(r => setTimeout(r, 700));
  const b = await page.evaluate(() => ({ pos: { ...window.__game.player.pos }, ball: { ...window.__game.ball.p }, st: window.__game.state }));
  await page.screenshot({ path: '/tmp/serve_toss.png' });
  // rally mid: drift after a few frames
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  console.log('READY', JSON.stringify(a), 'TOSS', JSON.stringify(b));
  await browser.close();
})();
