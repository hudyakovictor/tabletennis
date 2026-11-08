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
  page.on('pageerror', e => errors.push((e.stack || e.message).split('\n').slice(0,4).join(' | ')));
  const frame = await appFrame(page, { match: { diff: 1 } });
  // Рендержить по "1 сек" и смотреть time
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const st = await frame.evaluate(() => {
      const g = window.__game;
      return { t: +g.time.toFixed(3), state: g.state, paused: g.paused, dc: g.R.drawCalls,
        ball: g.ball.live, vy: +g.ball.v.y.toFixed(2), by: +g.ball.p.y.toFixed(2), pad: { x:+g.player.pos.x.toFixed(2), y:+g.player.pos.y.toFixed(2), z:+g.player.pos.z.toFixed(2) }, server: g.server };
    });
    console.log('TICK', JSON.stringify(st), 'errors:', errors.length);
  }
  // симуляция тапа/свайпа
  // тап = подброс, затем ждём, затем свайп вверх по области мяча
  const bounds = await (await page.$('#gamelayer iframe')).boundingBox();
  await page.touchscreen.tap(bounds.x + 195, bounds.y + 550);
  await new Promise(r => setTimeout(r, 900));
  await new Promise(r => setTimeout(r, 500));
  // свайп снизу вверх
  await frame.evaluate(() => {
    const c = window.__game.canvas;
    const opts = (x,y) => ({ bubbles:true, clientX:x, clientY:y, pointerId:1, pointerType:'touch', isPrimary:true });
    c.dispatchEvent(new PointerEvent('pointerdown', opts(195, 620)));
  });
  await new Promise(r => setTimeout(r, 60));
  await frame.evaluate(() => {
    const c = window.__game.canvas;
    const opts = (x,y) => ({ bubbles:true, clientX:x, clientY:y, pointerId:1, pointerType:'touch', isPrimary:true });
    c.dispatchEvent(new PointerEvent('pointermove', opts(195, 460)));
  });
  await new Promise(r => setTimeout(r, 60));
  await frame.evaluate(() => {
    const c = window.__game.canvas;
    const opts = (x,y) => ({ bubbles:true, clientX:x, clientY:y, pointerId:1, pointerType:'touch', isPrimary:true });
    c.dispatchEvent(new PointerEvent('pointerup', opts(195, 420)));
  });
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 700));
    const st = await frame.evaluate(() => { const g = window.__game; return { t: +g.time.toFixed(3), state: g.state, ball: g.ball.live, score: g.score, reason: g.lastPoint && g.lastPoint.reason }; });
    console.log('AFTER', JSON.stringify(st), 'errors:', errors.length);
  }
  console.log('ERRORS', JSON.stringify(errors.slice(0, 6)));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
