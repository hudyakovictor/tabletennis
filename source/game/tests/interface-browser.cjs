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
  const custom = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);
  const browser = await puppeteer.launch({ executablePath: custom || await chromium.executablePath(),
    args: custom ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] : chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      if (!localStorage.getItem('ttu-v2')) localStorage.setItem('ttu-v2', JSON.stringify({ v: 4, lang: 'ru', sfx: false, tutorialDone: true,
        owned: ['r-standard', 'r-pan'], equipped: { racket: 'r-pan' } }));
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
        cards: cards.map((e) => ({ primary: !e.classList.contains('sec'), id: e.dataset.modebtn || e.dataset.act,
          box: rect(e), icon: rect(e.querySelector('.mb-i')), text: rect(e.querySelector('.mb-t')),
          description: e.querySelector('small')?.textContent, title: e.querySelector('b').textContent })),
        nav: [...document.querySelectorAll('#nav .tab')].map((e) => ({ label: e.getAttribute('aria-label'), icon: !!e.querySelector('svg'),
          visibleLabel: !!e.querySelector('.tl')?.getClientRects().length, stroke: e.querySelector('svg')?.getAttribute('stroke'), gradient: !!e.querySelector('linearGradient') })),
        avatar: !!document.querySelector('.hud .avatar'), title: !!document.querySelector('.arena-title'), difficulty: !!document.querySelector('.diffbar'),
        navTop: rect(document.querySelector('#nav')).y, notification: !!document.querySelector('.hud [data-act=notifications]')
      };
    });
    assert.deepEqual(hub.cards.map(card => card.id), ['free', 'ranked', 'practice', 'quests', 'gifts']);
    for (const card of hub.cards) {
      assert.ok(card.box.width >= 44 && card.box.height >= 44, 'mode and reward cards retain accessible touch targets');
      assert.ok(card.primary ? card.icon.bottom <= card.text.y + 1 : card.icon.right <= card.text.x + 1,
        'mode stickers sit above titles; reward stickers sit left of descriptions');
      assert.ok(card.title); assert.equal(!!card.description, !card.primary);
      assert.ok(card.text.right <= card.box.right + 1 && card.text.bottom <= card.box.bottom + 1, 'mode text fits inside card');
      assert.ok(card.box.bottom <= hub.navTop + 1, 'mode cards are above the bottom navigation');
    }
    assert.deepEqual(hub.nav.map((x) => x.label), ['Главная', 'Турниры', 'Магазин', 'Настройки']);
    assert.ok(hub.nav.every((x) => x.icon && x.visibleLabel && x.stroke === 'currentColor' && !x.gradient));
    assert.equal(hub.avatar, false); assert.equal(hub.title, false); assert.equal(hub.difficulty, false); assert.equal(hub.notification, true);

    await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
    const small = await page.evaluate(() => {
      const nav = document.querySelector('#nav').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.screen.current .modebtn')].map((b) => {
        const r = b.getBoundingClientRect(), text = b.querySelector('.mb-t').getBoundingClientRect();
        return { right: r.right, bottom: r.bottom, textRight: text.right, textBottom: text.bottom };
      });
      const sc = document.querySelector('.hub-content'); sc.scrollTop = sc.scrollHeight;
      const rewards = document.querySelector('.grid-row2').getBoundingClientRect();
      return { cards, navTop: nav.top, rewardBottom: rewards.bottom, scrollTop: sc.scrollTop };
    });
    assert.ok(small.cards.every((r) => r.right <= 320 && r.textRight <= r.right + 1 && r.textBottom <= r.bottom + 1));
    assert.ok(small.scrollTop > 0 && small.rewardBottom <= small.navTop, 'secondary rewards remain reachable above navigation on a short phone');
    await page.evaluate(() => { document.querySelector('.hub-content').scrollTop = 0; });
    await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    const landscape = await page.evaluate(() => {
      const modes = [...document.querySelectorAll('.play-grid .modebtn')].map(e => e.getBoundingClientRect());
      const rewards = [...document.querySelectorAll('.grid-row2 .modebtn')].map(e => e.getBoundingClientRect());
      const sc = document.querySelector('.hub-content'); sc.scrollTop = sc.scrollHeight;
      return { modeTops: modes.map(r => r.top), rewardTops: rewards.map(r => r.top),
        rewardBottom: document.querySelector('.grid-row2').getBoundingClientRect().bottom,
        navTop: document.querySelector('#nav').getBoundingClientRect().top };
    });
    assert.ok(Math.max(...landscape.modeTops) - Math.min(...landscape.modeTops) < 1);
    assert.ok(Math.max(...landscape.rewardTops) - Math.min(...landscape.rewardTops) < 1);
    assert.ok(Math.min(...landscape.rewardTops) > Math.max(...landscape.modeTops), 'landscape preserves the three-plus-two card grouping');
    assert.ok(landscape.rewardBottom <= landscape.navTop, 'landscape rewards remain reachable above the nav');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.evaluate(() => { document.querySelector('.hub-content').scrollTop = 0; });
    console.log('ok: three-plus-two hub, monochrome accessible navigation, short and landscape layouts');

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
    await page.waitForFunction(() => I18n.lang === 'en' && Sheet.cur && !Router.busy
      && document.querySelector('#sheets #langseg button[data-v="en"]').getAttribute('aria-pressed') === 'true', { timeout: 30000 });
    assert.equal(await page.$eval('#nav [data-tab=hub]', (b) => b.getAttribute('aria-label')), 'Home');
    assert.equal(await page.$eval('#nav [data-tab=hub]', (b) => b.getAttribute('aria-current')), 'page');
    await page.evaluate(() => Sheet.close(true));
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
    await page.click('.screen.current [data-modebtn=ranked]'); await settled(page, 'mm');
    await page.click('.screen.current [data-act=cancel]'); await settled(page, 'hub');
    await page.click('.screen.current [data-modebtn=career]'); await settled(page, 'profile');
    assert.equal(await page.$$eval('.screen.current [data-equipment]', cards => cards.length), 2);
    const inventory = await page.evaluate(() => JSON.stringify([S.coins, S.gems, S.owned, S.rewardReceipts]));
    await page.click('.screen.current [data-equipment=r-standard]'); await wait(850);
    await page.click('#sheets [data-a=equip]');
    await page.waitForFunction(() => !Sheet.cur && document.querySelector('.screen.current [data-equipment=r-standard]').getAttribute('aria-pressed') === 'true'
      && GameHost.frame.contentWindow.__game._equippedRacket === 'r-standard');
    assert.equal(await page.evaluate(() => JSON.stringify([S.coins, S.gems, S.owned, S.rewardReceipts])), inventory);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ttu-v2')).equipped.racket), 'r-standard');
    await page.click('#nav [data-tab=hub]'); await settled(page, 'hub');
    await page.click('.screen.current [data-modebtn=practice]'); await settled(page, 'train');
    await page.waitForSelector('.screen.current .academy-lesson');
    assert.equal(await page.$eval('.screen.current .academy-live', el => el.hidden), true, 'entering the academy does not start a lesson');
    const exitBox = await page.$eval('.screen.current .academy-head [data-act=exit]', (e) => {
      const r = e.getBoundingClientRect(); return { top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    });
    assert.ok(exitBox.width >= 44 && exitBox.height >= 44 && exitBox.top >= 0 && exitBox.right <= 390 && exitBox.bottom <= 844,
      'the academy exit is an accessible viewport-safe action');
    await page.click('.screen.current .academy-head [data-act=exit]'); await settled(page, 'hub');
    console.log('ok: menu destinations, owned equipment selection and academy exit');

    await page.click('.screen.current [data-modebtn=free]');
    await page.waitForSelector('.screen.current[data-id=match] .mx.live', { timeout: 30000 });
    await page.waitForFunction(() => GameHost.frame.contentWindow.__game.freePlay && GameHost.frame.contentWindow.__game.settings.difficulty === 2,
      { timeout: 10000 });
    const free = await page.evaluate(() => ({ meters: document.querySelectorAll('.screen.current [role=meter]').length,
      scoresHidden: [...document.querySelectorAll('.screen.current .match-hud-score-window')].every(e => e.hidden),
      unlimited: [...document.querySelectorAll('.screen.current .match-hud-unlimited')].map(e => e.textContent),
      avatar: !!document.querySelector('.screen.current .mx .avatar'), level: GameHost.frame.contentWindow.__game.ai.levelIndex }));
    assert.equal(free.meters, 0); assert.equal(free.scoresHidden, true); assert.equal(free.avatar, false);
    assert.deepEqual(free.unlimited, ['Unlimited', 'Unlimited']); assert.equal(free.level, 2);
    for (const server of [1, -1]) {
      await page.evaluate(side => { const g = GameHost.frame.contentWindow.__game; g.server = side; g.prepServe(); }, server);
      await page.waitForFunction(side => !document.querySelector(`.screen.current .match-hud-player[data-side="${side}"] .match-hud-serve`).hidden, {}, server);
    }

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
      const g = GameHost.frame.contentWindow.__game;
      g.server = 1; g.prepServe(); g.score = [1, 3]; g.awardPoint(1, 'АУТ');
    });
    await page.waitForFunction(() => document.querySelector('.screen.current .match-hud-player[data-side="1"] .match-hud-score').textContent === '2');
    const scored = await page.evaluate(() => ({ p: document.querySelector('.screen.current .match-hud-player[data-side="1"] .match-hud-score').textContent,
      o: document.querySelector('.screen.current .match-hud-player[data-side="-1"] .match-hud-score').textContent,
      serve: document.querySelector('.screen.current .match-hud-serve:not([hidden])').closest('[data-side]').dataset.side }));
    assert.deepEqual(scored, { p: '2', o: '3', serve: '1' });
    await page.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => {
      const left = document.querySelector('.screen.current .match-hud').getBoundingClientRect();
      const right = document.querySelector('.screen.current .match-actions').getBoundingClientRect();
      return Math.abs(left.top - right.top) < 1;
    }, { timeout: 10000 });
    const matchLayout = await page.evaluate(() => {
      const left = document.querySelector('.screen.current .match-hud').getBoundingClientRect();
      const right = document.querySelector('.screen.current .match-actions').getBoundingClientRect();
      const controls = [...document.querySelectorAll('.screen.current .match-actions button')].map(button => {
        const r = button.getBoundingClientRect(); return { act: button.dataset.act, x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return { left: left.left, leftRight: left.right, width: left.width, height: left.height,
        rightLeft: right.left, right: right.right, top1: left.top, top2: right.top, controls,
        metrics: getComputedStyle(document.querySelector('.screen.current .match-hud-metrics')).display,
        cells: document.querySelectorAll('.screen.current .match-hud-contact').length };
    });
    assert.ok(matchLayout.left >= 0 && matchLayout.leftRight < matchLayout.rightLeft && matchLayout.right <= 320 && Math.abs(matchLayout.top1 - matchLayout.top2) < 1, JSON.stringify(matchLayout));
    assert.equal(matchLayout.width, 236); assert.ok(matchLayout.height >= 60 && matchLayout.height <= 66);
    assert.ok(matchLayout.width * matchLayout.height <= 244 * 108 * .6, 'only the upper-left HUD footprint is roughly halved');
    assert.equal(matchLayout.cells, 2); assert.equal(matchLayout.metrics, 'flex');
    assert.deepEqual(matchLayout.controls.map(c => c.act), ['notifications', 'slowmo', 'pause']);
    matchLayout.controls.forEach((c, i) => {
      assert.equal(c.width, 44); assert.equal(c.height, 44); assert.equal(c.x, 264); assert.equal(c.y, matchLayout.top2 + i * 52);
    });
    assert.deepEqual(errors, []);
    console.log('ok: compact scored HUD, fixed contact cells and unchanged nonoverlapping right controls');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((e) => { console.error(e); process.exit(1); });
