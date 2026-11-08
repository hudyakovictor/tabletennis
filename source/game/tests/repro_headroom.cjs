/* Headroom check in real Chromium: exact numbers behind the failing assert. */
const puppeteer = require('puppeteer-core');
const chromium = process.env.CHROME_BIN ? null : require('@sparticuz/chromium');
const { appFrame } = require('./helpers.cjs');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: process.env.CHROME_BIN ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/topspin-browser-libs/lib' }
  });
  for (const [width, height] of [[1280, 760], [390, 844]]) {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log('PAGEERR', e.message));
    await page.setViewport({ width, height, isMobile: width < 600, hasTouch: width < 600 });
    const frame = await appFrame(page);
    const out = await frame.evaluate(() => {
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
