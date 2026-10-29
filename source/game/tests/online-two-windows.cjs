/* Онлайн на двух окнах: поднимает tools/online-host.js, открывает лобби в одном
 * Chromium и ссылку ?room=КОД во втором, затем сверяет роль, счёт и знак z.
 * Браузер берётся из CHROME_BIN или из пакета Chromium на Linux.
 * Запуск из source/game: npm run test:online
 * В npm test не входит: медленный и требует браузер, как browser.cjs. */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawn, execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const PORT = Number(process.env.PORT || 3005);
const ROOT = path.resolve(__dirname, '../..');        // <repo>/source
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* движок живёт в iframe (srcdoc) — ищем тот фрейм, где есть __game.network */
async function frameOf(page) {
  for (let i = 0; i < 40; i++) {
    for (const f of page.frames()) {
      try { if (await f.evaluate(() => !!(window.__game && window.__game.network))) return f; } catch (e) {}
    }
    await sleep(250);
  }
  throw new Error('engine frame not found');
}

(async () => {
  // Like the other browser tests, provide the Linux libraries that Chromium's
  // npm package needs on minimal CI images. Honour an explicit CHROME_BIN.
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux') {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const chrome = process.env.CHROME_BIN || (process.platform === 'linux'
    ? await chromium.executablePath() : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const srv = spawn('node', ['tools/online-host.js', String(PORT)], { cwd: path.join(ROOT, 'game') });
  srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
  srv.stderr.on('data', (d) => process.stdout.write('[srv-err] ' + d));
  await sleep(900);

  const launch = () => puppeteer.launch({
    executablePath: chrome, headless: 'new',
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter) },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader',
      '--use-gl=angle', '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
  });
  /* два отдельных браузера = два устройства: в одном Chromium передняя
   * вкладка одна, и rAF второй страницы замирает — хост тогда ничего не шлёт */
  const browsers = [];
  const mk = async (i, url) => {
    const p = await browsers[i].newPage();
    await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    // Assertions below use Russian labels; do not depend on the host browser locale.
    await p.evaluateOnNewDocument(() => localStorage.setItem('ttu-v2', JSON.stringify({ v: 4, lang: 'ru', sfx: false, tutorialDone: true })));
    p.on('pageerror', (e) => console.log('[pageerr]', e.message));
    p.on('console', (m) => { if (m.type() === 'error') console.log('[console-err]', m.text().slice(0, 200)); });
    await p.goto(url, { waitUntil: 'domcontentloaded' });
    return p;
  };
  /* лобби перерисовывается по опросу статуса → ручки Puppeteer протухают,
   * кликаем напрямую в DOM */
  const clickSel = (p, sel) => p.evaluate((s) => {
    const el = document.querySelector(s); if (!el) throw new Error('нет элемента ' + s); el.click();
  }, sel);
  const lobbyText = (p) => p.$eval('#netBody', (e) => e.textContent).then((s) => s.replace(/\s+/g, ' ').slice(0, 140));
  let SENT = 0, RECV = 0;    // счётчики настоящих кадров state через NetworkManager
  let fails = 0;
  const check = (name, ok, detail) => { console.log((ok ? '  ok  ' : ' FAIL ') + name + (detail ? ' — ' + detail : '')); if (!ok) fails++; };

  try {
    browsers.push(await launch()); browsers.push(await launch());
    const a = await mk(0, `http://localhost:${PORT}/`);
    await a.waitForSelector('[data-modebtn="ranked"]', { timeout: 40000 });
    check('адрес реле берётся с той же страницы', /\/api\/relay$/.test(await a.evaluate(() => GameHost.relayUrl())),
      await a.evaluate(() => GameHost.relayUrl()));

    await clickSel(a, '[data-modebtn="ranked"]');
    await a.waitForSelector('[data-act="create"]', { timeout: 20000 });
    check('плитка «Онлайн» ведёт в лобби', await a.evaluate(() => String(Router.cur)) === 'online');
    check('в простаивающем лобби нет «связь потеряна»',
      !(await lobbyText(a)).includes('Связь потеряна'), await lobbyText(a));

    await clickSel(a, '[data-act="create"]');
    await a.waitForFunction(() => /^[A-Z0-9]{5}$/.test(((document.querySelector('.net-code') || {}).textContent || '').trim()), { timeout: 25000 });
    const code = await a.evaluate(() => document.querySelector('.net-code').textContent.trim());
    console.log('  комната', code);

    const b = await mk(1, `http://localhost:${PORT}/?room=${code}`);
    await b.waitForFunction(() => !!document.querySelector('#netBody'), { timeout: 40000 });
    check('ссылка ?room=КОД открывает лобби', await b.evaluate(() => String(Router.cur)) === 'online');
    // Software WebGL in CI can take longer than a fixed seven-second sleep.
    await Promise.all([a, b].map((p) => p.waitForFunction(() => Net.st === 'match', { timeout: 60000 })));
    await sleep(1200);
    check('хост и гость в матче',
      (await lobbyText(a)).includes('хост') && (await lobbyText(b)).includes('гость'),
      (await lobbyText(a)) + ' || ' + (await lobbyText(b)));

    const fa = await frameOf(a), fb = await frameOf(b);
    /* ловим реальный трафик: сколько state отправил хост и сколько дошло до гостя */
    await fa.evaluate(() => { const n = window.__game.network, s = n.sendGameState.bind(n); n.sendGameState = () => { window.__sent = (window.__sent || 0) + 1; return s(); }; });
    await fb.evaluate(() => { const n = window.__game.network, h = n._handle.bind(n); n._handle = (m) => { if (m && m.type === 'state') window.__recv = (window.__recv || 0) + 1; return h(m); }; });
    // Observe at least 20 real frames instead of assuming a particular FPS
    // on the software renderer used by CI.
    await Promise.all([
      fa.waitForFunction(() => window.__sent > 20, { timeout: 30000 }),
      fb.waitForFunction(() => window.__recv > 20, { timeout: 30000 })
    ]);
    SENT = await fa.evaluate(() => window.__sent || 0);
    RECV = await fb.evaluate(() => window.__recv || 0);
    console.log('  state: хост отправил', SENT, ', гость принял', RECV);
    check('поток state идёт через реле', SENT > 20 && RECV > 20, `sent ${SENT}, recv ${RECV}`);
    const roll = (f) => f.evaluate(() => {
      const g = window.__game, n = g.network;
      return { inMatch: n.isInMatch, side: n.side, connected: n.connected, score: g.score.slice(),
        server: g.server, hud: !!document.documentElement.classList.contains('tt-online'), z: Math.round(g.ball.p.z * 100) / 100,
        sentAt: n._lastStateT || 0, sentIn: n._lastInputT || 0, buf: (n._interpBuf || []).length };
    });
    const [ra, rb] = await Promise.all([roll(fa), roll(fb)]);
    console.log('  A', JSON.stringify(ra), '\n  B', JSON.stringify(rb));
    check('оба движка в матче', ra.inMatch && rb.inMatch);
    check('роли зеркальные', ra.side === -rb.side, `side ${ra.side}/${rb.side}`);
    check('счёт не расходится', ra.score.join(':') === rb.score.slice().reverse().join(':'),
      `${ra.score} против ${rb.score} (у гостя перевёрнут)`);
    check('табло движка включено у обоих', ra.hud && rb.hud);
    const liveHud = await fa.evaluate(() => {
      const score = document.querySelector('#score').getBoundingClientRect();
      return { right: score.right, width: score.width, names: [...document.querySelectorAll('#score .sb-nm')].map((e) => e.textContent),
        server: document.querySelector('#score .serve-dot.on')?.dataset.label };
    });
    const actions = await a.evaluate(() => {
      const status = document.querySelector('.screen.current .net-live'), box = status.getBoundingClientRect();
      const button = status.querySelector('[data-act=exit]');
      return { left: box.left, right: box.right, pointerEvents: getComputedStyle(button).pointerEvents,
        hudVisible: getComputedStyle(document.querySelector('.screen.current .hud')).display !== 'none' };
    });
    check('компактный счёт слева и статус справа не перекрываются',
      liveHud.width <= 204 && liveHud.right < actions.left && actions.right <= 390 && !actions.hudVisible,
      JSON.stringify({ liveHud, actions }));
    check('онлайн показывает участников и подачу, а не сложность бота',
      liveHud.names.join('/') === 'Ты/Соперник' && liveHud.server === 'Подача');
    check('кнопка выхода доступна во время матча', actions.pointerEvents === 'auto');
    /* гость может и сам разыграть очко — хост обязан это поправить своим point */
    await sleep(4000);
    const [r2a, r2b] = await Promise.all([roll(fa), roll(fb)]);
    check('сходится и через 4 с', r2a.score.join(':') === r2b.score.slice().reverse().join(':'),
      `${r2a.score} против ${r2b.score}`);
    // A host point must update the guest's visible, mirrored score and serve.
    await fa.evaluate(() => {
      const g = window.__game; g.paused = true; g.score = [2, 1]; g.server = -1; g.ui.syncScore();
      g.network._send({ type: 'point', who: 1, score: [2, 1], server: -1 });
    });
    await fb.waitForFunction(() => document.querySelector('#ptsA').textContent === '1' &&
      document.querySelector('#ptsB').textContent === '2' && document.querySelector('#servA').classList.contains('on'), { timeout: 20000 });
    check('гость видит обновлённые счёт и подачу хоста', true);
    const result = await b.evaluate(() => {
      const online = Router.screens.online;
      online.onOver({ won: false, score: [1, 2] });
      online.onNet({ st: 'match' }); // an in-flight status poll must not cover the result again
      return { state: Net.st, inGame: document.body.classList.contains('in-game'), again: !!document.querySelector('.screen.current [data-act=again]') };
    });
    check('итог остаётся доступен при запоздалом статусе сети', result.state === 'over' && !result.inGame && result.again, JSON.stringify(result));
    await a.click('.screen.current .net-live [data-act=exit]');
    await a.waitForFunction(() => Router.cur === 'hub', { timeout: 30000 });
    check('выход возвращает в меню', await a.evaluate(() => Router.cur === 'hub'));
    await b.click('.screen.current [data-act=again]');
    await b.waitForFunction(() => Net.st === 'idle', { timeout: 10000 });
    check('из результата можно создать новую комнату', true);
  } catch (e) {
    console.log('FAIL:', e.message);
    fails++;
  } finally {
    await Promise.allSettled(browsers.map((x) => x.close())); srv.kill();
    console.log(fails ? 'ИТОГ: провалов ' + fails : 'ИТОГ: чисто');
    process.exit(fails ? 1 : 0);
  }
})();
