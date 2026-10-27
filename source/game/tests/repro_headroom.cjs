/* Headroom check in real Chromium: exact numbers behind the failing assert. */
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const path = require('path');
const { enginePage } = require('./helpers.cjs');
const { pathToFileURL } = require('url');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/topspin-browser-libs/lib' }
  });
  for (const [width, height] of [[1280, 760], [390, 844]]) {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log('PAGEERR', e.message));
    await page.setViewport({ width, height, isMobile: width < 600, hasTouch: width < 600 });
    await page.goto(pathToFileURL(enginePage()).href);
    await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0, { timeout: 30000 });
    const out = await page.evaluate(() => {
      const g = window.__game;
      g.startMatch(2); g.paused = false; g.setCameraPreset("DYNAMIC");
      for (let i = 0; i < 80; i++) g.updateCamera(.1);
      const b = tableScreenBounds(g.R.viewProj);
      const opp = opponentScreenTop(g.R.viewProj);
      return { top: b.top, bottom: b.bottom, opp, HEAD: CAMERA_HEADROOM,
        camera: g.settings.camera, zoom: g.settings.camZoom, pitch: g.settings.camPitch,
        eye: { ...g.camPos }, fov: g.fov, shift: g.camShiftY };
    });
    console.log(width, 'x', height, JSON.stringify(out));
    await page.close();
  }
  await browser.close();
})();
