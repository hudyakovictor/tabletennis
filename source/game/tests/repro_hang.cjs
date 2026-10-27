const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const { enginePage } = require('./helpers.cjs');
const chromium = require('@sparticuz/chromium');
(async () => {
  const libs = '/tmp/topspin-browser-libs';
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push((e.stack || e.message).split('\n').slice(0,4).join(' | ')));
  await page.goto(pathToFileURL(enginePage()).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0, { timeout: 15000 });
  await page.evaluate(() => { const g = window.__game; g.startMatch(1); g.paused = false; });
  // Рендержить по "1 сек" и смотреть time
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => new Promise(r => setTimeout(r, 1000)));
    const st = await page.evaluate(() => {
      const g = window.__game;
      return { t: +g.time.toFixed(3), state: g.state, paused: g.paused, dc: g.R.drawCalls,
        ball: g.ball.live, vy: +g.ball.v.y.toFixed(2), by: +g.ball.p.y.toFixed(2), pad: { x:+g.player.pos.x.toFixed(2), y:+g.player.pos.y.toFixed(2), z:+g.player.pos.z.toFixed(2) }, server: g.server };
    });
    console.log('TICK', JSON.stringify(st), 'errors:', errors.length);
  }
  // симуляция тапа/свайпа
  // тап = подброс, затем ждём, затем свайп вверх по области мяча
  await page.touchscreen.tap(195, 550);
  await page.evaluate(() => new Promise(r => setTimeout(r, 900)));
  await page.evaluate(() => new Promise(r => setTimeout(r, 500)));
  // свайп снизу вверх
  await page.evaluate(() => {
    const c = window.__game.canvas;
    const opts = (x,y) => ({ bubbles:true, clientX:x, clientY:y, pointerId:1, pointerType:'touch', isPrimary:true });
    c.dispatchEvent(new PointerEvent('pointerdown', opts(195, 620)));
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 60)));
  await page.evaluate(() => {
    const c = window.__game.canvas;
    const opts = (x,y) => ({ bubbles:true, clientX:x, clientY:y, pointerId:1, pointerType:'touch', isPrimary:true });
    c.dispatchEvent(new PointerEvent('pointermove', opts(195, 460)));
  });
  await page.evaluate(() => new Promise(r => setTimeout(r, 60)));
  await page.evaluate(() => {
    const c = window.__game.canvas;
    const opts = (x,y) => ({ bubbles:true, clientX:x, clientY:y, pointerId:1, pointerType:'touch', isPrimary:true });
    c.dispatchEvent(new PointerEvent('pointerup', opts(195, 420)));
  });
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => new Promise(r => setTimeout(r, 700)));
    const st = await page.evaluate(() => { const g = window.__game; return { t: +g.time.toFixed(3), state: g.state, ball: g.ball.live, score: g.score, reason: g.lastPoint && g.lastPoint.reason }; });
    console.log('AFTER', JSON.stringify(st), 'errors:', errors.length);
  }
  console.log('ERRORS', JSON.stringify(errors.slice(0, 6)));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
