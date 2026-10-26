const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
(async () => {
  const libs = '/tmp/topspin-browser-libs';
  const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });

  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(pathToFileURL('/home/user/ttu-v2/game/play/index.html').href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0, { timeout: 15000 });
  await page.waitForFunction(() => window.__game.music._initialized);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.paused = true;
    const incomingBall = () => {
      g.startMatch(2); g.setState(GS.RALLY); g.time+=1;
      g.isServeBall=false;g.rallyBounces=[1];g.ball.live=true;g.ball.lastHitBy=-1;
      V3.copy(g.ball.p,g.player.pos);V3.set(g.ball.v,0,-.1,4);V3.zero(g.ball.w);g.swipe.cancel();
    };
    const out = [];
    // master test case 1: press holds no movement
    incomingBall();
    g.swipe.down(.5,.6,g.time);
    //out.push(['down0 real?', g.swipe.realGestureId, 'isReal', isRealStroke(g.swipe.m, false)]);
    g.tryPlayerHit(V3.clone(g.ball.p));
    out.push(['after down hitBy', g.ball.lastHitBy, 'path', g.swipe.m.pathLen, 'dist', g.swipe.m.dist]);
    g.swipe.up(.5,.6,g.time+.01); g.swipeReleasedAt=g.time;
    g.tryPlayerHit(V3.clone(g.ball.p));
    out.push(['after up hitBy', g.ball.lastHitBy, g.swipe.m.pathLen, g.swipe.m.dist]);
    return out;
  });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
