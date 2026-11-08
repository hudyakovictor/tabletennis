/* Serve frames: racket height, left/right drift on toss. */
const puppeteer = require('puppeteer-core');
const chromium = process.env.CHROME_BIN ? null : require('@sparticuz/chromium');
const { appFrame } = require('./helpers.cjs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: process.env.CHROME_BIN ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/topspin-browser-libs/lib' }
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.setViewport({ width: 1280, height: 760 });
  const frame = await appFrame(page);
  // SERVE_READY: where does the bat sit?
  await frame.evaluate(() => {
    const g = window.__game;
    g.startMatch(2); g.paused = false; g.server = 1; g.prepServe();
    g.pointer = { x: 0.5, y: 0.62 }; g.pointerInside = true;
  });
  await new Promise(r => setTimeout(r, 900));
  const a = await frame.evaluate(() => ({ pos: { ...window.__game.player.pos }, st: window.__game.state }));
  await page.screenshot({ path: '/tmp/serve_ready.png' });
  // press and toss
  const bounds = await (await page.$('#gamelayer iframe')).boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .62);
  await page.mouse.down();
  await frame.evaluate(() => window.__game.startToss());
  await new Promise(r => setTimeout(r, 700));
  const b = await frame.evaluate(() => ({ pos: { ...window.__game.player.pos }, ball: { ...window.__game.ball.p }, st: window.__game.state }));
  await page.screenshot({ path: '/tmp/serve_toss.png' });
  // rally mid: drift after a few frames
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  console.log('READY', JSON.stringify(a), 'TOSS', JSON.stringify(b));
  await browser.close();
})();
