/* Real shell/iframe automatic miss-gallery flow in Chromium. Mobile viewport
 * emulation is not a physical-phone or Telegram validation. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const repo = path.resolve(__dirname, '../../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function activate(page, selector) {
  await page.waitForSelector(selector, { visible: true, timeout: 30000 });
  // .open is applied before the sheet's transform has reached its final
  // position. Software WebGL can delay that transition well past 700 ms.
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel), sheet = el && el.closest('.sheet');
    if (!el) return false;
    if (!sheet) return true;
    const transform = getComputedStyle(sheet).transform;
    return transform === 'none' || Math.abs(new DOMMatrix(transform).m42) < 1;
  }, { timeout: 30000, polling: 100 }, selector);
  await page.$eval(selector, e => {
    // Scroll only the sheet/zoom contents, not #device (overflow:hidden is
    // still programmatically scrollable and moves the whole application).
    let parent = e.parentElement;
    while (parent && parent.id !== 'device') {
      if (parent.matches('.sbody,.miss-grid,.miss-zoom-body') && parent.scrollHeight > parent.clientHeight) {
        const p = parent.getBoundingClientRect(), r = e.getBoundingClientRect();
        parent.scrollTop += r.top - p.top - Math.max(0, (p.height - r.height) / 2);
      }
      parent = parent.parentElement;
    }
  });
  await delay(500);
  const p = await page.$eval(selector, el => {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, ok: !!hit && (hit === el || el.contains(hit)) };
  });
  assert.ok(p.ok, `control not hit-testable: ${selector} at ${p.x},${p.y}`);
  await page.touchscreen.tap(p.x, p.y);
}
async function incoming(frame) {
  return frame.evaluate(() => {
    const g = __game;
    if (!g._galleryTestUpdate) g._galleryTestUpdate = g.update;
    g.update = () => {};
    g.cancelInput('gallery_test'); g.setPaused(false); g.setState(GS.RALLY);
    g.server = -1; g.isServeBall = false; g.rallyBounces = [1]; g.recenterT = 0;
    V3.set(g.player.pos, 0, 1.05, 1.5); V3.copy(g.player.prevPos, g.player.pos);
    V3.set(g.player.normal, 0, 0, -1); V3.copy(g.ball.p, g.player.pos);
    V3.set(g.ball.v, 0, 0, 6); V3.zero(g.ball.w); g.ball.live = true; g.ball.lastHitBy = -1;
    g.player.lastHitT = g.time - 1; g.updateCamera(0);
    g._strike = { on: true, contactable: true, ready: 1, kind: 'rally', t: 0, k: 1 };
    const q = g.project(g.ball.p, {}), r = g.canvas.getBoundingClientRect();
    return { x: r.left + q.x * r.width, y: r.top + q.y * r.height, time: g.time };
  });
}
async function touchPoint(page, frame, cdp, keepDown = false) {
  const p = await incoming(frame);
  const fr = await page.$eval('#gamelayer iframe', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fr.x + p.x, y: fr.y + p.y, id: 1 }] });
  if (!keepDown) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return p;
}
async function readImage(page, selector) {
  return page.$eval(selector, async img => {
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const cx = c.getContext('2d'); cx.drawImage(img, 0, 0);
    const p = cx.getImageData(0, 0, c.width, c.height).data, colors = new Set(); let red = 0;
    for (let i = 0; i < p.length; i += 4) {
      colors.add(`${p[i]},${p[i+1]},${p[i+2]}`);
      if (p[i] > 150 && p[i] > p[i+1] * 1.5 && p[i] > p[i+2] * 1.4) red++;
    }
    return { w: c.width, h: c.height, colors: colors.size, red };
  });
}
async function download(dir) {
  for (let i = 0; i < 40; i++) {
    const name = fs.readdirSync(dir).find(x => x.endsWith('.jpg'));
    if (name) return fs.readFileSync(path.join(dir, name));
    await delay(200);
  }
  throw new Error('JPEG was not downloaded');
}
(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs'); fs.mkdirSync(libs, { recursive: true });
  const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
  execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  let checks = 0; const check = name => console.log('ok', ++checks, name);
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument(() => {
      if (window.top !== window || sessionStorage.getItem('gallery-migration-tested')) return;
      sessionStorage.setItem('gallery-migration-tested', '1');
      localStorage.setItem('ttu-v2', JSON.stringify({ v: 2, rating: 1105, missShots: true, missShotHalf: 20 }));
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-gallery-'));
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    await page.goto(pathToFileURL(path.join(repo, 'play/index.html')).href + '?s=match');
    await page.waitForSelector('.mx.live', { timeout: 30000 });
    const frame = await (await page.$('#gamelayer iframe')).contentFrame();
    await frame.waitForFunction('window.__game && window.__game.R.drawCalls > 0', { timeout: 30000 });
    await page.waitForFunction('GameHost.ready && S.missShots !== false');
    assert.deepEqual(await page.evaluate(() => ({ v: S.v, radius: S.missShotHalf, rating: S.rating })),
      { v: 3, radius: 350, rating: 1105 });
    check('existing narrow-crop save upgrades to ±350 without losing player progress');
    await page.evaluate(() => { I18n.lang = 'ru'; document.documentElement.lang = 'ru'; MissShots.clear(); });
    const before = await touchPoint(page, frame, cdp, true);
    await page.waitForFunction('MissShots.all().length === 1', { timeout: 30000 });
    const first = await page.evaluate(() => ({ shot: MissShots.all()[0], recording: GameHost.debug, storage: MissShots.storage }));
    assert.equal(first.recording, false, 'gallery works without debug recording');
    assert.equal(first.shot.status, 'pending'); assert.equal(first.shot.half, 350);
    assert.equal(first.shot.gameTime, before.time);
    const expected = (press, size, half) => Math.min(Math.ceil(size), Math.round(press + half) + 1) - Math.max(0, Math.round(press - half));
    assert.equal(first.shot.w, expected(first.shot.pressX, first.shot.vw, 350));
    assert.equal(first.shot.h, expected(first.shot.pressY, first.shot.vh, 350));
    const scale = await frame.evaluate(() => ({ x: __game.canvas.width / __game.canvas.clientWidth, y: __game.canvas.height / __game.canvas.clientHeight }));
    assert.equal(first.shot.imageWidth, Math.round(first.shot.w * scale.x));
    assert.equal(first.shot.imageHeight, Math.round(first.shot.h * scale.y));
    assert.ok(first.shot.imageWidth > first.shot.w && first.shot.imageHeight > first.shot.h, 'DPR 2 frame keeps real render pixels');
    assert.equal(first.storage, 'saved');
    assert.equal(await frame.evaluate(() => __game.swipe.active), true, 'image exists before release or pause');
    check('first pointerdown captures ±350 px at actual render resolution, clipped at screen edges');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frame.evaluate(() => __game.setState(GS.POINT));
    await page.waitForFunction(id => MissShots.get(id) && MissShots.get(id).status === 'miss', {}, first.shot.id);
    const stored = await page.evaluate(id => JSON.parse(localStorage.getItem('ttu-miss-shots')).find(s => s.id === id), first.shot.id);
    assert.ok(stored && stored.img && stored.status === 'miss');
    check('a missed attempt remains in local storage with its outcome');

    await activate(page, '[data-act=pause]');
    await activate(page, '.sheet-wrap.open [data-a=settings]');
    await page.waitForSelector('.miss-gallery');
    await activate(page, '.miss-thumb');
    await page.waitForSelector('.miss-zoom img', { visible: true });
    const img = await readImage(page, '.miss-zoom img');
    assert.equal(img.w, first.shot.imageWidth); assert.equal(img.h, first.shot.imageHeight);
    assert.ok(img.colors > 100 && img.red > 5, JSON.stringify(img));
    await page.screenshot({ path: path.join(os.tmpdir(), 'tabletennis-gallery-350.png') });
    const meta = await page.$eval('.mz-meta', e => e.textContent);
    assert.match(meta, /Контакт не зафиксирован/);
    await activate(page, '[data-miss-download]');
    const bytes = await download(dir);
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
    check('calibration gallery opens a real nonblank marked JPEG and downloads it');
    await activate(page, '[data-miss-close]');
    await page.select('[data-miss-size]', '400');
    await page.waitForFunction('S.missShotHalf === 400');
    await delay(300);
    await page.evaluate(() => Sheet.close());
    await page.waitForFunction('!Sheet.cur');
    await frame.waitForFunction('__game.paused === false', { timeout: 15000 });
    await touchPoint(page, frame, cdp);
    await page.waitForFunction('MissShots.all().length === 2', { timeout: 30000 });
    const second = await page.evaluate(() => MissShots.all().at(-1));
    assert.equal(second.half, 400);
    assert.equal(second.w, expected(second.pressX, second.vw, 400));
    assert.equal(second.h, expected(second.pressY, second.vh, 400));
    assert.notEqual(second.id, first.shot.id);
    // In this fixed incoming-ball fixture, a released valid tap reaches the
    // paddle. It tests that only the matching successful image is removed.
    const contact = await frame.evaluate(() => { const g = __game; g.tryPlayerHit(V3.clone(g.ball.p)); return g.ball.lastHitBy; });
    assert.equal(contact, 1, 'controlled fixture should make a contact');
    await page.waitForFunction(id => !MissShots.get(id), {}, second.id);
    assert.ok(await page.evaluate(id => !!MissShots.get(id), first.shot.id));
    check('±400 mode works, and a contact removes only its own image');

    await page.reload();
    await page.waitForSelector('.mx.live', { timeout: 30000 });
    await page.waitForFunction(id => !!MissShots.get(id), {}, first.shot.id);
    assert.equal(await page.evaluate(() => S.missShotHalf), 400);
    check('gallery and crop choice survive a reload on the same origin');

    const frame2 = await (await page.$('#gamelayer iframe')).contentFrame();
    await frame2.waitForFunction('window.__game && window.__game.R.drawCalls > 0');
    await page.waitForFunction('GameHost.ready');
    // Force a gallery-only quota failure. The old and new images must stay
    // visible in memory and the settings sheet must explain the limitation.
    await page.evaluate(() => {
      const old = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === 'ttu-miss-shots') throw new Error('quota test'); return old.call(this, k, v); };
    });
    await touchPoint(page, frame2, cdp);
    await page.waitForFunction('MissShots.storage === "memory" && MissShots.all().length === 2', { timeout: 30000 });
    await activate(page, '[data-act=pause]'); await activate(page, '.sheet-wrap.open [data-a=settings]');
    const warning = await page.$eval('[data-miss-storage]', e => e.textContent);
    assert.match(warning, /только до закрытия страницы|only until this page is closed/);
    assert.equal(await page.$$eval('.miss-thumb', els => els.length), 2);
    check('storage failure is visible and the current session keeps both screenshots');
    await activate(page, '[data-k=missShots]');
    assert.equal(await page.evaluate(() => S.missShots), false);
    await page.evaluate(() => Sheet.close());
    await page.waitForFunction('!Sheet.cur');
    await frame2.waitForFunction('__game.paused === false', { timeout: 15000 });
    await delay(400);
    await touchPoint(page, frame2, cdp);
    await delay(1200);
    assert.equal(await page.evaluate(() => MissShots.all().length), 2);
    check('the settings switch disables future automatic captures');
    assert.deepEqual(errors, []);
    console.log(`miss-gallery browser checks passed: ${checks}`);
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
