const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { appFrame } = require('./helpers.cjs');
const chromium = process.env.CHROME_BIN ? null : require('@sparticuz/chromium');
(async () => {
  const libs = '/tmp/topspin-browser-libs';
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: process.env.CHROME_BIN ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push((e.stack || e.message).split('\n').slice(0, 4).join(' | ')));
  const frame = await appFrame(page, { match: { diff: 1 } });
  const probe = async (tag) => {
    const st = await frame.evaluate(() => { const g = window.__game; return {
      t: +g.time.toFixed(2), state: g.state, bLive: g.ball.live, score: JSON.stringify(g.score),
      lastHitBy: g.ball.lastHitBy, tossQ: g.tossQueued, rec: +g.recenterT.toFixed(2), vy: +g.ball.v.y.toFixed(2),
      py: +g.ball.p.y.toFixed(2),
    }; });
    console.log(tag, JSON.stringify(st));
  };
  await probe('BOOT');
  // тап на сервис: pointerdown+up
  await frame.evaluate(() => { const g = window.__game, c = g.canvas;
    const o = { bubbles: true, clientX: 195, clientY: 550, pointerId: 7, pointerType: 'touch', isPrimary: true };
    c.dispatchEvent(new PointerEvent('pointerdown', o));
    c.dispatchEvent(new PointerEvent('pointerup', o));
  });
  for (let i = 0; i < 16; i++) { await new Promise(r => setTimeout(r, 250)); await probe('T' + i); }
  console.log('ERRORS', JSON.stringify(errors.slice(0, 4)));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
