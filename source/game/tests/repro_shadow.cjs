/* Screenshot during a rally: visible ball + paddle blob shadows on the table. */
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
  await page.evaluate(() => {
    const g = window.__game;
    g.startMatch(2); g.paused = false;
    // screenshots only the 3D view: hide DOM overlays (screens, HUD), keep canvas sizing intact
    document.querySelectorAll('.screen, #loading, #menu, #hud, #playband, #topright, #msghud, #fx').forEach(el => { el.style.display = 'none'; });
    g.setState(GS.RALLY);
    g.ball.live = true; g.ball.lastHitBy = -1; g.rallyBounces = [1];
    // hover the blade above the table through the normal pointer path
    g.pointer = { x: 0.38, y: 0.62 }; g.pointerInside = true;
    // pin the ball after every physics tick so it hangs over the table
    const u = g.update.bind(g);
    g.update = (dt) => { u(dt);
      g.ball.live = true; g.ball.lastHitBy = -1; g.rallyBounces = [1];
      V3.set(g.ball.p, 0.30, PH.TABLE_Y + 0.30, 0.35); V3.set(g.ball.v, 0, 0, 0); };
  });
  await new Promise(r => setTimeout(r, 900));
  await page.screenshot({ path: '/tmp/shadow_check.png' });
  console.log('shot saved');
  await browser.close();
})();
