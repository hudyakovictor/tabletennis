/* Which branch lets an old held swipe hit a later ball? */
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');

(async () => {
  const html = 'file://' + path.join(__dirname, '..', 'play/index.html');
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, '--no-sandbox'],
    headless: 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/topspin-browser-libs/lib' }
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(html, { waitUntil: 'load' });
  await page.waitForFunction('window.__game && window.__game.R && window.__game.R.drawCalls > 0', { timeout: 30000 });
  const out = await page.evaluate(() => {
    const g = window.__game;
    const log = [];
    const incomingBall = () => {
      g.startMatch(2); g.setState(GS.RALLY); g.time += 1;
      g.isServeBall = false; g.rallyBounces = [1]; g.ball.live = true; g.ball.lastHitBy = -1;
      V3.copy(g.ball.p, g.player.pos); V3.set(g.ball.v, 0, -.1, 4); V3.zero(g.ball.w); g.swipe.cancel();
    };
    incomingBall();
    g.swipe.down(.5, .8, g.time - .6); g.swipe.move(.5, .5, g.time - .4);
    // instrument
    const pb = g._tryPassiveBlock.bind(g);
    g._tryPassiveBlock = (pad, b) => { const r = pb(pad, b); if (r) log.push('PASSIVE fired'); return r; };
    const intent = g.playerStrokeIntent(false);
    log.push('intent', intent ? 'non-null dist=' + intent.dist.toFixed(3) : 'null',
      'realGid', g.swipe.realGestureId, 'gid', g.swipe.gestureId,
      'm.isReal?', intent ? window.isRealStroke ? '?' : '?' : '-');
    g.tryPlayerHit(V3.clone(g.ball.p));
    log.push('after try hitBy=', g.ball.lastHitBy);
    return log;
  });
  console.log(out.join('\n'));
  await browser.close();
})();
