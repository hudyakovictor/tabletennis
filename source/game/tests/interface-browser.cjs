/* Real shell interactions: compact controls, settings, notices and match HUD.
 * Run from source/game: npm run test:interface */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const html = path.resolve(__dirname, '../../../play/index.html');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const settled = (page, id) => page.waitForFunction((screen) => Router.cur === screen && !Router.busy,
  { timeout: 30000 }, id);

(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux') {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    fs.createReadStream(html).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/?s=hub`;
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      if (!localStorage.getItem('ttu-v2')) localStorage.setItem('ttu-v2', JSON.stringify({ v: 4, lang: 'ru', sfx: false, tutorialDone: true }));
    });
    await page.goto(base, { waitUntil: 'load' });
    await settled(page, 'hub');
    await page.waitForFunction(() => GameHost.ready, { timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    await wait(1000); // entry choreography finishes before measuring positions

    const hub = await page.evaluate(() => {
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const cards = [...document.querySelectorAll('.screen.current .modebtn')];
      return {
        cards: cards.map((e) => ({ box: rect(e), icon: rect(e.querySelector('.mb-i')), text: rect(e.querySelector('.mb-t')),
          description: e.querySelector('small')?.textContent, title: e.querySelector('b').textContent })),
        nav: [...document.querySelectorAll('#nav .tab')].map((e) => ({ label: e.getAttribute('aria-label'), icon: !!e.querySelector('svg'),
          visibleLabel: !!e.querySelector('.tl'), stroke: e.querySelector('svg')?.getAttribute('stroke'), gradient: !!e.querySelector('linearGradient') })),
        avatar: !!document.querySelector('.hud .avatar'), title: !!document.querySelector('.arena-title'), difficulty: !!document.querySelector('.diffbar'),
        navTop: rect(document.querySelector('#nav')).y, notification: !!document.querySelector('.hud [data-act=notifications]')
      };
    });
    assert.equal(hub.cards.length, 4);
    for (const card of hub.cards) {
      assert.ok(card.box.height >= 80 && card.box.height <= 90, 'mode cards are approximately half the old height');
      assert.ok(card.icon.right <= card.text.x + 1, 'mode icon is left of its description');
      assert.ok(card.description && card.title, 'each mode has a title and a description');
      assert.ok(card.text.right <= card.box.right + 1 && card.text.bottom <= card.box.bottom + 1, 'mode text fits inside card');
      assert.ok(card.box.bottom <= hub.navTop + 1, 'mode cards are above the bottom navigation');
    }
    assert.deepEqual(hub.nav.map((x) => x.label), ['Главная', 'Турниры', 'Магазин', 'Настройки']);
    assert.ok(hub.nav.every((x) => x.icon && !x.visibleLabel && x.stroke === 'currentColor' && !x.gradient));
    assert.equal(hub.avatar, false); assert.equal(hub.title, false); assert.equal(hub.difficulty, false); assert.equal(hub.notification, true);

    await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
    const small = await page.evaluate(() => {
      const nav = document.querySelector('#nav').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.screen.current .modebtn')].map((b) => {
        const r = b.getBoundingClientRect(), text = b.querySelector('.mb-t').getBoundingClientRect();
        return { right: r.right, bottom: r.bottom, textRight: text.right, textBottom: text.bottom };
      });
      const sc = document.querySelector('.hub-content'); sc.scrollTop = sc.scrollHeight;
      const f = document.querySelector('.friends').getBoundingClientRect();
      return { cards, navTop: nav.top, friendBottom: f.bottom, scrollTop: sc.scrollTop };
    });
    assert.ok(small.cards.every((r) => r.right <= 320 && r.bottom <= small.navTop && r.textRight <= r.right + 1 && r.textBottom <= r.bottom + 1));
    assert.ok(small.scrollTop > 0 && small.friendBottom <= small.navTop, 'secondary content remains reachable above navigation on a short phone');
    await page.evaluate(() => { document.querySelector('.hub-content').scrollTop = 0; });
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    const landscape = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.screen.current .modebtn')].map((e) => e.getBoundingClientRect());
      return { tops: cards.map((r) => r.top), bottoms: cards.map((r) => r.bottom), navTop: document.querySelector('#nav').getBoundingClientRect().top };
    });
    assert.ok(Math.max(...landscape.tops) - Math.min(...landscape.tops) < 1, 'landscape has one compact row of modes');
    assert.ok(Math.max(...landscape.bottoms) <= landscape.navTop, 'landscape modes are not covered by the nav');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    console.log('ok: compact hub, monochrome accessible navigation, short and landscape layouts');

    // The bell is a real in-game list. Its count tracks claimable items, not invented remote pushes.
    assert.equal(await page.$eval('.screen.current .notice-count', (el) => el.textContent), '2');
    await page.click('.screen.current [data-act=notifications]'); await wait(850);
    assert.equal(await page.$$eval('#sheets [data-notice]', (rows) => rows.length), 2);
    await page.click('#sheets [data-notice=gifts]');
    await page.waitForSelector('#sheets .sheet [data-gift="1"]'); await wait(850);
    await page.click('#sheets .sheet [data-gift="1"]');
    await page.waitForFunction(() => !Sheet.cur);
    await wait(350);
    assert.equal(await page.$eval('.screen.current .notice-count', (el) => el.textContent), '1');
    const claimed = await page.evaluate(() => ({ coins: S.coins, freeAt: S.freeAt }));
    assert.equal(claimed.coins, 1880); assert.ok(claimed.freeAt > Date.now());
    await page.evaluate(() => { S.chests = S.chests.map(() => null); saveNow(); UI.refreshNotifications(); });
    assert.equal(await page.$eval('.screen.current .notice-count', (el) => el.hidden), true);
    await page.click('.screen.current [data-act=notifications]'); await wait(850);
    assert.ok(await page.$('#sheets .notice-empty'));
    await page.click('#sheets [data-notice-close]'); await wait(350);
    console.log('ok: reward notices open real destinations, update after claiming, and have an honest empty state');

    // Difficulty is only in settings; selecting it changes the description and persists.
    await page.click('#nav [data-tab=settings]');
    await page.waitForSelector('#sheets #dseg button[data-v="2"]'); await wait(850);
    await page.click('#sheets #dseg button[data-v="2"]');
    const difficulty = await page.evaluate(() => ({ value: S.diff, pressed: document.querySelector('#dseg button[data-v="2"]').getAttribute('aria-pressed'),
      description: document.querySelector('#diffDescription').textContent }));
    assert.equal(difficulty.value, 2); assert.equal(difficulty.pressed, 'true'); assert.ok(difficulty.description.includes('атакует'));
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('ttu-v2')).diff === 2);
    await page.click('#sheets #langseg button[data-v="en"]');
    await page.waitForFunction(() => I18n.lang === 'en' && !Sheet.cur && !Router.busy, { timeout: 30000 });
    assert.equal(await page.$eval('#nav [data-tab=hub]', (b) => b.getAttribute('aria-label')), 'Home');
    assert.equal(await page.$eval('#nav [data-tab=hub]', (b) => b.getAttribute('aria-current')), 'page');
    await page.reload({ waitUntil: 'load' }); await settled(page, 'hub');
    await page.waitForFunction(() => GameHost.ready, { timeout: 45000 });
    assert.equal(await page.evaluate(() => S.diff), 2);
    await page.click('#nav [data-tab=settings]');
    assert.equal(await page.$eval('#dseg button[data-v="2"]', (b) => b.getAttribute('aria-pressed')), 'true');
    await page.evaluate(() => Sheet.close(true));
    console.log('ok: difficulty is accessible in settings, persists across reload and language changes');

    // All original destinations and the separate training exit still work.
    for (const id of ['pass', 'shop']) { await page.click(`#nav [data-tab=${id}]`); await settled(page, id); }
    // A notice opened outside the hub routes to the real reward sheet there.
    await page.evaluate(() => { S.freeAt = 0; UI.refreshNotifications(); });
    await page.click('.screen.current [data-act=notifications]'); await wait(850);
    await page.click('#sheets [data-notice=gifts]'); await settled(page, 'hub'); await wait(850);
    assert.ok(await page.$('#sheets .gf-gift'));
    await page.evaluate(() => { S.freeAt = Date.now() + FREE_MS; saveNow(); UI.refreshNotifications(); Sheet.close(true); });
    await page.click('.screen.current [data-modebtn=ranked]'); await settled(page, 'online');
    assert.ok(await page.$('.screen.current .hud [data-act=notifications]'));
    await page.click('.screen.current [data-act=back]'); await settled(page, 'hub');
    await page.click('.screen.current [data-modebtn=career]'); await settled(page, 'profile');
    await page.click('#nav [data-tab=hub]'); await settled(page, 'hub');
    await page.click('.screen.current [data-modebtn=practice]'); await settled(page, 'train');
    await page.waitForSelector('.screen.current .tx.live');
    const exitBox = await page.$eval('.screen.current .m-pause', (e) => { const r = e.getBoundingClientRect(); return { left: r.left, bottom: r.bottom }; });
    assert.ok(exitBox.left < 30 && exitBox.bottom > 750, 'training exit remains bottom-left');
    await page.click('.screen.current [data-act=exit]'); await settled(page, 'hub');
    console.log('ok: menu destinations and training exit');

    await page.click('.screen.current [data-modebtn=free]');
    await page.waitForSelector('.screen.current[data-id=match] .mx.live', { timeout: 30000 });
    await page.waitForFunction(() => GameHost.frame.contentWindow.__game.freePlay && GameHost.frame.contentWindow.__game.settings.difficulty === 2,
      { timeout: 10000 });
    const free = await page.evaluate(() => ({ scores: document.querySelectorAll('.screen.current #scP,.screen.current #scO').length,
      dashes: [...document.querySelectorAll('.screen.current .sb-score')].map((e) => e.textContent), avatar: !!document.querySelector('.screen.current .mx .avatar'),
      noScoreLabel: document.querySelector('.screen.current .sb-in').getAttribute('aria-label'), level: GameHost.frame.contentWindow.__game.ai.levelIndex }));
    assert.equal(free.scores, 0); assert.deepEqual(free.dashes, ['—', '—']); assert.equal(free.avatar, false);
    assert.equal(free.noScoreLabel, 'no score'); assert.equal(free.level, 2);
    await page.evaluate(() => Router.screens.match.onMsg({ type: 'serve', server: 1 }));
    assert.equal(await page.$eval('.screen.current .srv[data-srv="1"]', (e) => e.getAttribute('aria-hidden')), 'false');
    await page.evaluate(() => Router.screens.match.onMsg({ type: 'serve', server: -1 }));
    assert.equal(await page.$eval('.screen.current .srv[data-srv="-1"]', (e) => e.classList.contains('on')), true);

    await page.click('.screen.current [data-act=slowmo]');
    await page.waitForFunction(() => GameHost.frame.contentWindow.__game.inspectSlowmo === true);
    assert.equal(await page.$eval('.screen.current [data-act=slowmo]', (e) => e.getAttribute('aria-pressed')), 'true');
    await page.click('.screen.current [data-act=slowmo]');
    await page.waitForFunction(() => GameHost.frame.contentWindow.__game.inspectSlowmo === false);
    await page.click('.screen.current [data-act=pause]');
    await page.waitForFunction(() => GameHost.frame.contentWindow.__game.paused === true);
    await wait(850); await page.click('#sheets [data-a=resume]');
    await page.waitForFunction(() => GameHost.frame.contentWindow.__game.paused === false);
    await wait(350);
    await page.click('.screen.current .match-actions [data-act=notifications]');
    await page.waitForFunction(() => GameHost.frame.contentWindow.__game.paused === true);
    assert.ok(await page.$('#sheets .notice-empty'));
    await wait(850); await page.click('#sheets [data-notice-close]');
    await page.waitForFunction(() => GameHost.frame.contentWindow.__game.paused === false);
    console.log('ok: free play, selected bot level, serve indicator, slow-mo, pause and paused notices');

    // In scored matches the same left-side display updates both numbers and service.
    await wait(600);
    await page.evaluate(async () => { MODE = MODES[0]; BATTLE = { opp: 0 }; await Router.go('match'); });
    await page.waitForSelector('.screen.current[data-id=match] .mx.live', { timeout: 30000 });
    await wait(900); // scoreboard and actions finish their live-entry transitions
    await page.evaluate(() => {
      const match = Router.screens.match;
      match.onMsg({ type: 'serve', server: 1 });
      match.onMsg({ type: 'point', who: 1, score: [2, 3], rally: 0, reason: 'out' });
    });
    const scored = await page.evaluate(() => ({ p: document.querySelector('.screen.current #scP').textContent,
      o: document.querySelector('.screen.current #scO').textContent, serve: document.querySelector('.screen.current .srv.on').dataset.srv }));
    assert.deepEqual(scored, { p: '2', o: '3', serve: '1' });
    await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => {
      const left = document.querySelector('.screen.current .sb').getBoundingClientRect();
      const right = document.querySelector('.screen.current .match-actions').getBoundingClientRect();
      return Math.abs(left.top - right.top) < 1;
    }, { timeout: 10000 });
    const matchLayout = await page.evaluate(() => {
      const left = document.querySelector('.screen.current .sb').getBoundingClientRect();
      const right = document.querySelector('.screen.current .match-actions').getBoundingClientRect();
      return { left: left.left, leftRight: left.right, rightLeft: right.left, right: right.right, top1: left.top, top2: right.top };
    });
    assert.ok(matchLayout.left >= 0 && matchLayout.leftRight < matchLayout.rightLeft && matchLayout.right <= 320 && Math.abs(matchLayout.top1 - matchLayout.top2) < 1, JSON.stringify(matchLayout));
    assert.deepEqual(errors, []);
    console.log('ok: scored HUD updates and its controls do not overlap on a narrow phone');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => { console.error(e); process.exit(1); });
