/* End-to-end diagnostics in the actual standalone and shipped shell. Chromium
 * mobile emulation is not a substitute for a physical phone/Telegram test. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { root, enginePage } = require('./helpers.cjs');
const repo = path.resolve(root, '../..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function download(pathname) {
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(pathname) && fs.statSync(pathname).size > 0) return fs.readFileSync(pathname);
    await pause(250);
  }
  throw new Error('Download not created: ' + pathname);
}
async function settled(page, selector, mobile = false) {
  await page.waitForSelector(selector, { visible: true, timeout: 30000 });
  // .open is applied before the bottom sheet has finished moving. Under
  // software WebGL, a fixed wall-clock delay is not enough: a tap can land
  // on a different button when the sheet finally renders its next frame.
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel), sheet = el && el.closest('.sheet');
    if (!el) return false;
    if (!sheet) return true;
    const transform = getComputedStyle(sheet).transform;
    return transform === 'none' || Math.abs(new DOMMatrix(transform).m42) < 1;
  }, { timeout: 30000, polling: 100 }, selector);
  await page.$eval(selector, el => {
    let parent = el.parentElement;
    while (parent && parent.id !== 'device') {
      if (parent.matches('.sbody,.pause-actions') && parent.scrollHeight > parent.clientHeight) {
        const p = parent.getBoundingClientRect(), r = el.getBoundingClientRect();
        parent.scrollTop += r.top - p.top - Math.max(0, (p.height - r.height) / 2);
      }
      parent = parent.parentElement;
    }
  });
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel); if (!el) return false;
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  }, { timeout: 30000, polling: 100 }, selector);
  const p = await page.$eval(selector, el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
}
async function setupIncoming(frame) {
  return frame.evaluate(() => {
    const g = window.__game;
    g._diagnosticsTestUpdate = g.update; g.update = () => {};
    g.cancelInput('test_setup'); g.setPaused(false); g.setState(GS.RALLY);
    g.server = -1; g.isServeBall = false; g.rallyBounces = [1]; g.recenterT = 0;
    V3.set(g.player.pos, 0, 1.05, 1.5); V3.copy(g.player.prevPos, g.player.pos);
    V3.set(g.player.normal, 0, 0, -1); V3.copy(g.ball.p, g.player.pos);
    V3.set(g.ball.v, 0, 0, 6); V3.zero(g.ball.w); g.ball.live = true; g.ball.lastHitBy = -1;
    g.player.lastHitT = g.time - 1; g.updateCamera(0);
    g._strike = { on: true, contactable: true, ready: 1, kind: 'rally', t: 0, k: 1 };
    const q = g.project(g.ball.p, {}), r = g.canvas.getBoundingClientRect();
    return { x: r.left + q.x * r.width, y: r.top + q.y * r.height };
  });
}
async function assertVisibleInScroll(page, containerSelector, selector) {
  // A sheet can have its .open class before its entrance animation settles,
  // especially while the debug renderer is busy. Assert the actual hit target.
  await page.waitForFunction((outerSelector, buttonSelector) => {
    const outer = document.querySelector(outerSelector), el = document.querySelector(buttonSelector);
    if (!outer || !el) return false;
    const o = outer.getBoundingClientRect(), r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return r.top >= Math.max(0, o.top) - 1 && r.bottom <= Math.min(innerHeight, o.bottom) + 1 &&
      !!hit && (hit === el || el.contains(hit));
  }, { timeout: 20000 }, containerSelector, selector);
  const geometry = await page.evaluate((outerSelector, buttonSelector) => {
    const outer = document.querySelector(outerSelector), el = document.querySelector(buttonSelector);
    if (!outer || !el) return null;
    const o = outer.getBoundingClientRect(), r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { visible: r.top >= Math.max(0, o.top) - 1 && r.bottom <= Math.min(innerHeight, o.bottom) + 1,
      clickable: !!hit && (hit === el || el.contains(hit)), top: r.top, bottom: r.bottom, container: [o.top, o.bottom] };
  }, containerSelector, selector);
  assert.ok(geometry && geometry.visible && geometry.clickable, JSON.stringify(geometry));
}
async function assertPngIsNotBlank(page, imageSelector) {
  const data = await page.$eval(imageSelector, async img => {
    await img.decode();
    const c = document.createElement('canvas'); c.width = 32; c.height = 32;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 32, 32);
    const pixels = ctx.getImageData(0, 0, 32, 32).data, colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) colors.add(`${pixels[i]},${pixels[i+1]},${pixels[i+2]}`);
    return { width: img.naturalWidth, height: img.naturalHeight, colors: colors.size };
  });
  assert.ok(data.width > 200 && data.height > 200 && data.colors > 20, JSON.stringify(data));
}
(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  fs.mkdirSync(libs, { recursive: true });
  const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
  execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  let checks = 0;
  const check = name => { checks++; console.log('ok', checks, name); };
  try {
    // Standalone: actual controls, detailed snapshot, download, and failure fallback.
    const standalone = await browser.newPage(), standaloneErrors = [];
    standalone.on('pageerror', e => standaloneErrors.push(e.message));
    await standalone.setViewport({ width: 960, height: 720 });
    const standaloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-standalone-diag-'));
    const cd = await standalone.createCDPSession();
    await cd.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: standaloneDir });
    await standalone.goto(pathToFileURL(enginePage()).href);
    await standalone.waitForFunction('window.__game && window.__game.R.drawCalls > 0', { timeout: 30000 });
    await standalone.evaluate(() => {
      document.querySelectorAll('.screen.on').forEach(e => e.classList.remove('on'));
      document.querySelector('#loading').classList.add('off');
      __game.startMatch(0); __game.setPaused(true);
    });
    await settled(standalone, '#diagnosticShotPause');
    await standalone.waitForSelector('#diagnosticPreview:not([hidden])');
    await assertPngIsNotBlank(standalone, '#diagnosticImage');
    await pause(200);
    await assertVisibleInScroll(standalone, '.pause-actions', '#diagnosticImageLink');
    assert.equal(await standalone.evaluate(() => !!__game.debugRecording), false);
    check('standalone pause shows an accessible screenshot and download without enabling recording');
    await settled(standalone, '#diagnosticRecordPause');
    await standalone.waitForFunction('__game.debugRecording === true');
    assert.equal(await standalone.$eval('#diagnosticRecordPause', e => e.checked), true);
    check('standalone pause enables detailed recording');
    await settled(standalone, '#pauseResume');
    const point = await setupIncoming(standalone.mainFrame());
    await standalone.mouse.click(point.x, point.y);
    const tap = await standalone.evaluate(() => {
      const g = __game; g.tryPlayerHit(V3.clone(g.ball.p));
      return g.inputLog.events(g.time).filter(e => e.type === 'pointerup').at(-1);
    });
    assert.equal(tap.outcome.recognized, 'tap'); assert.equal(tap.outcome.reason, null);
    assert.equal(tap.debug.gates.greenCue, true);
    assert.ok(tap.debug.gesture.pressZone && tap.debug.ball.velocity);
    check('real mouse press and tap recognition have detailed, truthful evidence');
    // Recreate an incoming moving ball in slow motion with a plausible 300 ms
    // press, rather than a stationary ball placed directly on the paddle.
    // Whether it hits is NOT locked in as a contract: if it misses, the report
    // must explain the held-through-window path so a future fix can change it.
    const moving = await standalone.evaluate(() => {
      const g = __game, update = g._diagnosticsTestUpdate.bind(g), startSeq = g.inputLog.sequence;
      g.startMatch(0); g.setPaused(false); g.setState(GS.RALLY); g.server = -1; g.isServeBall = false;
      g.rallyBounces = [1]; g.recenterT = 0; g.inspectSlowmo = true; g.timeScale = g.targetTimeScale = .3;
      g._acc = 0; g.shotId = 1; g.player.lastHitT = g.time - 2;
      V3.set(g.player.pos, 0, 1.06, 1.78); V3.copy(g.player.prevPos, g.player.pos); V3.set(g.player.normal, 0, 0, -1);
      V3.set(g.ball.p, 0, 1.10, 1.08); V3.set(g.ball.v, 0, 1, 9); V3.zero(g.ball.w);
      g.ball.live = true; g.ball.lastHitBy = -1; g.updateCamera(0); g._cpFrame = -1;
      const aim = g.project({ x: 0, y: 1.05, z: 1.78 }, {}); g.pointer = { x: aim.x, y: aim.y };
      let down = null, released = false, loops = 0;
      while (loops++ < 180 && g.ball.live && g.state === GS.RALLY && g.shotId === 1) {
        update(1 / 60);
        if (!down && g._strike.on && g._strike.contactable) {
          const q = g.project(g.ball.p, {}), r = g.canvas.getBoundingClientRect();
          const x = r.left + q.x * r.width, y = r.top + q.y * r.height;
          g.canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, pointerType: 'touch', button: 0, buttons: 1, bubbles: true, cancelable: true, clientX: x, clientY: y }));
          down = { time: g.time, x, y, accepted: g.swipe.pressZone && g.swipe.pressZone.accepted };
        }
        if (down && !released && g.time - down.time >= .3) {
          g.canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, pointerType: 'touch', button: 0, buttons: 0, bubbles: true, cancelable: true, clientX: down.x, clientY: down.y }));
          released = true;
        }
      }
      const rows = g.inputLog.events(g.time).filter(e => e.seq > startSeq);
      return { accepted: down && down.accepted, returned: g.ball.lastHitBy === 1, released,
        anomaly: rows.some(e => e.type === 'anomaly' && e.outcome.reason === 'GREEN_PRESS_HELD_PAST_CAPTURE'),
        stages: rows.filter(e => e.type === 'physics_gate').map(e => e.outcome.stage),
        release: rows.find(e => e.type === 'pointerup')?.outcome };
    });
    assert.equal(moving.accepted, true);
    if (!moving.returned) {
      assert.equal(moving.released, true); assert.equal(moving.release.recognized, 'tap');
      assert.equal(moving.anomaly, true); assert.ok(moving.stages.includes('no_stroke_intent'));
    }
    check('moving-ball slow-mo press records the held-window decision path (return observed: ' + moving.returned + ')');
    await standalone.evaluate(() => { __game.update = __game._diagnosticsTestUpdate; __game.setPaused(true); });
    await settled(standalone, '#diagnosticReportPause');
    await standalone.waitForSelector('#diagnosticReportLink:not([hidden])', { visible: true });
    await settled(standalone, '#diagnosticReportLink');
    const standaloneText = (await download(path.join(standaloneDir, 'topspin-diagnostics.json'))).toString('utf8');
    const standaloneJson = JSON.parse(standaloneText);
    assert.ok(!standaloneText.includes('\n'), 'report should remain compact for phone memory');
    assert.equal(standaloneJson.format, 'topspin-diagnostics');
    assert.ok(standaloneJson.events.some(e => e.type === 'pointerdown' && e.debug));
    assert.ok(standaloneJson.events.some(e => e.type === 'physics_gate'));
    assert.ok(standaloneJson.environment.webgl.renderer);
    assert.match(standaloneJson.environment.build, /[a-f0-9]{12}$/);
    check('standalone JSON download contains input, physics gates, device, renderer and build fingerprint');
    await standalone.waitForSelector('#diagnosticPreview:not([hidden])');
    await assertPngIsNotBlank(standalone, '#diagnosticImage');
    await settled(standalone, '#diagnosticImageLink');
    const standalonePng = await download(path.join(standaloneDir, 'topspin-frame.png'));
    assert.equal(standalonePng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    check('standalone screenshot is a nonblank downloadable PNG with an image fallback');
    const soloMarker = 'standalone-before-stop-' + Date.now();
    await standalone.evaluate(async marker => {
      __game.logInput('test_checkpoint', { outcome: { marker } });
      await __game.debugArchive.flush();
    }, soloMarker);
    await settled(standalone, '#diagnosticShotPause');
    await standalone.waitForFunction('__game.debugArchive.frameStatus === "saved"');
    const soloFrameTime = await standalone.evaluate(() => __game.ui._diagnosticBookmark.capturedAt);
    await settled(standalone, '#diagnosticRecordPause');
    await standalone.waitForFunction('__game.debugRecording === false');
    await standalone.evaluate(async () => __game.debugArchive.flush());
    await standalone.reload({ waitUntil: 'domcontentloaded' });
    await standalone.waitForFunction('window.__game && window.__game.R.drawCalls > 0', { timeout: 30000 });
    await standalone.evaluate(() => {
      document.querySelectorAll('.screen.on').forEach(e => e.classList.remove('on'));
      document.querySelector('#loading').classList.add('off');
      __game.startMatch(0); __game.setPaused(true); __game.ui.syncPauseControl();
    });
    await standalone.waitForFunction(expected => __game.ui._diagnosticBookmark && __game.ui._diagnosticBookmark.capturedAt === expected, { timeout: 10000 }, soloFrameTime);
    await standalone.waitForSelector('#diagnosticPreview:not([hidden])');
    assert.match(await standalone.$eval('#diagnosticFrameTime', e => e.textContent), /Время снимка:/);
    assert.equal(await standalone.$eval('#diagnosticRecordPause', e => e.checked), false);
    await settled(standalone, '#diagnosticReportPause');
    await standalone.waitForSelector('#diagnosticReportLink:not([hidden])');
    const soloRecovery = JSON.parse(await standalone.evaluate(() => __game.ui._diagnosticReportText));
    assert.equal(soloRecovery.recording.enabled, false);
    assert.equal(soloRecovery.recording.recovery.status, 'available');
    assert.ok(soloRecovery.events.some(e => e.type === 'test_checkpoint' && e.outcome.marker === soloMarker));
    check('standalone restores a stopped session and its marked frame without restarting recording');
    assert.deepEqual(standaloneErrors, []);
    await standalone.close();

    // The standalone pause has a scrollable diagnostics panel on a phone;
    // a document-wide touchmove preventDefault must not trap its controls.
    const small = await browser.newPage();
    await small.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await small.goto(pathToFileURL(enginePage()).href);
    await small.waitForFunction('window.__game && window.__game.R.drawCalls > 0', { timeout: 30000 });
    await small.evaluate(() => {
      document.querySelectorAll('.screen.on').forEach(e => e.classList.remove('on'));
      document.querySelector('#loading').classList.add('off');
      __game.startMatch(0); __game.setDiagnosticMode(true); __game.setPaused(true); __game.ui.syncPauseControl();
    });
    await small.waitForSelector('#diagnosticPreview:not([hidden])');
    await small.$eval('#diagnosticImage', img => img.decode());
    const scrollRect = await small.evaluate(() => {
      const el = document.querySelector('.pause-actions'), r = el.getBoundingClientRect(); el.scrollTop = 0;
      return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom, height: el.clientHeight, content: el.scrollHeight };
    });
    assert.ok(scrollRect.content > scrollRect.height, JSON.stringify(scrollRect));
    const touch = await small.createCDPSession();
    const startY = scrollRect.bottom - 30, endY = scrollRect.top + 30;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: scrollRect.x, y: startY, id: 1 }] });
    for (let i = 1; i <= 8; i++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: scrollRect.x, y: startY + (endY - startY) * i / 8, id: 1 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(500);
    assert.ok(await small.$eval('.pause-actions', el => el.scrollTop) > 20, 'standalone phone pause should scroll with touch');
    check('standalone mobile pause panel scrolls to diagnostics with touch');
    await small.close();

    // Shipped shell, mobile touchscreen, screenshot bookmark, downloaded report,
    // host/iframe events, error capture and reload recovery.
    const mobile = await browser.newPage(), mobileErrors = [];
    mobile.on('pageerror', e => mobileErrors.push(e.message));
    await mobile.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    const mobileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-mobile-diag-'));
    const md = await mobile.createCDPSession();
    await md.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: mobileDir });
    await mobile.goto(pathToFileURL(path.join(repo, 'play/index.html')).href + '?s=match');
    await mobile.waitForSelector('#gamelayer iframe', { timeout: 30000 });
    let frame = await (await mobile.$('#gamelayer iframe')).contentFrame();
    await frame.waitForFunction('window.__game && window.__game.R.drawCalls > 0', { timeout: 30000 });
    await mobile.waitForSelector('.mx.live', { timeout: 30000 });
    await settled(mobile, '[data-act=pause]', true);
    await mobile.waitForSelector('.sheet-wrap.open [data-a=screenshot]', { visible: true });
    await pause(700);
    await assertVisibleInScroll(mobile, '.sheet-wrap.open .sbody', '.sheet-wrap.open [data-a=screenshot]');
    await settled(mobile, '.sheet-wrap.open [data-a=screenshot]', true);
    await mobile.waitForSelector('[data-d-preview]:not([hidden])', { timeout: 10000 });
    await assertPngIsNotBlank(mobile, '[data-d-image]');
    await pause(700);
    await assertVisibleInScroll(mobile, '.sheet-wrap.open .sbody', '[data-d=download-shot]');
    assert.equal(await mobile.evaluate(() => GameHost.debug), false);
    await settled(mobile, '[data-d=download-shot]', true);
    const directPng = await download(path.join(mobileDir, 'topspin-frame.png'));
    assert.equal(directPng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    fs.unlinkSync(path.join(mobileDir, 'topspin-frame.png'));
    check('mobile pause directly shows and downloads a screenshot without recording');
    await settled(mobile, '[data-d=open-diagnostics]', true);
    await frame.waitForFunction('__game.paused === true', { timeout: 10000 });
    await settled(mobile, '.sheet-wrap.open [data-d=toggle]', true);
    await frame.waitForFunction('__game.debugRecording === true', { timeout: 10000 });
    await frame.waitForFunction('__game.debugArchive.status !== "opening"', { timeout: 10000 });
    assert.equal(await frame.evaluate(() => __game.debugArchive.status), 'available');
    check('shipped mobile shell exposes debug mode and local recovery without dev=1');
    await settled(mobile, '[data-d=done]', true);
    await mobile.waitForFunction('!Sheet.cur', { timeout: 10000 });
    await settled(mobile, '[data-act=slowmo]', true);
    await frame.waitForFunction('__game.inspectSlowmo === true');
    const pos = await setupIncoming(frame);
    const fr = await mobile.$eval('#gamelayer iframe', e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top }; });
    await mobile.touchscreen.tap(fr.x + pos.x, fr.y + pos.y);
    const input = await frame.evaluate(() => {
      const g = __game; g.tryPlayerHit(V3.clone(g.ball.p));
      const rows = g.inputLog.events(g.time);
      return { down: rows.filter(e => e.type === 'pointerdown').at(-1), up: rows.filter(e => e.type === 'pointerup').at(-1),
        gates: rows.filter(e => e.type === 'physics_gate').length };
    });
    assert.equal(input.down.dom.pointerType, 'touch'); assert.equal(input.up.outcome.recognized, 'tap');
    assert.equal(input.up.outcome.reason, null); assert.ok(input.gates > 0);
    check('emulated touch, slow motion and substep decisions are recorded inside the iframe');
    const cancel = await frame.evaluate(() => {
      const g = __game, r = g.canvas.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      g.canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 13, pointerType: 'touch', button: 0, buttons: 1, bubbles: true, cancelable: true, clientX: x, clientY: y }));
      g.canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 13, pointerType: 'touch', bubbles: true, clientX: x, clientY: y }));
      const e = g.inputLog.events(g.time).filter(e => e.type === 'input_cancel').at(-1);
      return { reason: e && e.outcome.reason, activeBefore: e && e.outcome.active, activeAfter: g.swipe.active };
    });
    assert.equal(cancel.reason, 'pointercancel'); assert.equal(cancel.activeBefore, true); assert.equal(cancel.activeAfter, false);
    check('pointer cancellation preserves its cause and does not create a stroke');
    await mobile.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'host-test-error', error: new Error('host-test-error') })));
    await settled(mobile, '[data-act=diag-mark]', true);
    await mobile.waitForFunction('HostDiagnostics.bookmark && HostDiagnostics.bookmark.dataUrl.length > 1000');
    await frame.waitForFunction('__game.debugArchive.frameStatus === "saved"', { timeout: 10000 });
    const markTime = await mobile.evaluate(() => HostDiagnostics.bookmark.capturedAt);
    await frame.evaluate(() => {
      __game.update = __game._diagnosticsTestUpdate;
      window.dispatchEvent(new ErrorEvent('error', { message: 'diagnostic-test-error', error: new Error('diagnostic-test-error') }));
    });
    await settled(mobile, '[data-act=pause]', true);
    await settled(mobile, '.sheet-wrap.open [data-a=screenshot]', true);
    await mobile.waitForSelector('[data-d-preview]:not([hidden])');
    assert.equal(await mobile.evaluate(() => HostDiagnostics.bookmark.capturedAt), markTime);
    await pause(700);
    await assertVisibleInScroll(mobile, '.sheet-wrap.open .sbody', '[data-d=download-shot]');
    await assertPngIsNotBlank(mobile, '[data-d-image]');
    await settled(mobile, '[data-d=open-diagnostics]', true);
    await mobile.waitForSelector('[data-d-preview]:not([hidden])');
    await settled(mobile, '[data-d=report]', true);
    await mobile.waitForSelector('[data-d=download-report]', { visible: true, timeout: 30000 });
    await settled(mobile, '[data-d=download-report]', true);
    const reportText = (await download(path.join(mobileDir, 'topspin-diagnostics.json'))).toString('utf8');
    const report = JSON.parse(reportText);
    assert.ok(!reportText.includes('\n'), 'shell report should remain compact for phone memory');
    assert.ok(report.errors.some(e => e.message === 'diagnostic-test-error'));
    assert.ok(report.host.errors.some(e => e.message === 'host-test-error'));
    assert.match(report.host.build, /^shell [a-f0-9]{12}$/);
    assert.ok(report.events.some(e => e.type === 'input_cancel' && e.outcome.reason === 'pointercancel'));
    assert.ok(report.events.some(e => e.type === 'host_event'));
    assert.ok(report.events.some(e => e.type === 'pointerup' && e.outcome.recognized === 'tap'));
    assert.ok(report.host.bookmarkedFrame && !report.host.bookmarkedFrame.dataUrl);
    await settled(mobile, '[data-d=download-shot]', true);
    const png = await download(path.join(mobileDir, 'topspin-frame.png'));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    check('mobile report and screenshot actually download; preview remains available for long-press');
    const marker = 'before-reload-' + Date.now();
    await frame.evaluate(async marker => {
      __game.logInput('test_checkpoint', { outcome: { marker } });
      await __game.debugArchive.flush();
    }, marker);
    await mobile.$eval('#gamelayer iframe', el => el.setAttribute('data-old-frame', '1'));
    const supportsLoss = await frame.evaluate(() => {
      const ext = __game.R.gl.getExtension('WEBGL_lose_context');
      if (!ext) return false; ext.loseContext(); return true;
    });
    assert.equal(supportsLoss, true, 'Chromium must expose context-loss test extension');
    await mobile.waitForFunction(() => {
      const f = document.querySelector('#gamelayer iframe'); return f && !f.hasAttribute('data-old-frame');
    }, { timeout: 30000 });
    frame = await (await mobile.$('#gamelayer iframe')).contentFrame();
    await frame.waitForFunction('window.__game && window.__game.debugRecording === true', { timeout: 30000 });
    const recoveredGpu = await frame.evaluate(async () => __game.diagnosticReport());
    assert.ok(recoveredGpu.events.some(e => e.type === 'test_checkpoint' && e.outcome.marker === marker));
    assert.ok(recoveredGpu.events.some(e => e.type === 'runtime_error' && e.outcome.kind === 'webglcontextlost'));
    const gpuFrame = await frame.evaluate(async () => __game.debugArchive.readFrame());
    assert.ok(gpuFrame && gpuFrame.dataUrl.startsWith('data:image/png'));
    check('GPU context loss is logged and recent evidence plus the bookmarked frame survive iframe recovery');
    await mobile.reload({ waitUntil: 'domcontentloaded' });
    await mobile.waitForSelector('#gamelayer iframe', { timeout: 30000 });
    frame = await (await mobile.$('#gamelayer iframe')).contentFrame();
    await frame.waitForFunction('window.__game && window.__game.debugRecording === true', { timeout: 30000 });
    const recovered = await frame.evaluate(async () => __game.diagnosticReport());
    assert.ok(recovered.events.some(e => e.type === 'test_checkpoint' && e.outcome.marker === marker));
    assert.equal(recovered.recording.recovery.status, 'available');
    const recoveredFrame = await frame.evaluate(async () => __game.debugArchive.readFrame());
    assert.ok(recoveredFrame && recoveredFrame.dataUrl.startsWith('data:image/png'));
    await mobile.waitForSelector('.mx.live', { timeout: 30000 });
    await settled(mobile, '[data-act=pause]', true);
    await settled(mobile, '.sheet-wrap.open [data-a=diagnostics]', true);
    await mobile.waitForFunction(expected => HostDiagnostics.bookmark && HostDiagnostics.bookmark.capturedAt === expected, { timeout: 10000 }, markTime);
    await mobile.waitForSelector('[data-d-preview]:not([hidden])');
    check('recent evidence and bookmarked screenshot survive reload and return to the diagnostics UI');

    // Stopping recording must not make the existing local evidence disappear
    // after a reload, nor should opening the sheet start recording again.
    await settled(mobile, '[data-d=toggle]', true);
    await frame.waitForFunction('__game.debugRecording === false');
    await frame.evaluate(async () => __game.debugArchive.flush());
    await mobile.reload({ waitUntil: 'domcontentloaded' });
    await mobile.waitForSelector('#gamelayer iframe', { timeout: 30000 });
    frame = await (await mobile.$('#gamelayer iframe')).contentFrame();
    await frame.waitForFunction('window.__game && !window.__game.debugRecording', { timeout: 30000 });
    await mobile.waitForSelector('.mx.live', { timeout: 30000 });
    await settled(mobile, '[data-act=pause]', true);
    await settled(mobile, '.sheet-wrap.open [data-a=diagnostics]', true);
    // The marked image is restored as soon as the sheet opens, not only
    // after the user has discovered and prepared the JSON report.
    await mobile.waitForFunction(expected => HostDiagnostics.bookmark && HostDiagnostics.bookmark.capturedAt === expected, { timeout: 10000 }, markTime);
    await mobile.waitForSelector('[data-d-preview]:not([hidden])');
    assert.equal(await mobile.$eval('[data-d=toggle]', e => e.getAttribute('aria-pressed')), 'false');
    await settled(mobile, '[data-d=report]', true);
    await mobile.waitForSelector('[data-d=download-report]', { visible: true, timeout: 30000 });
    const stopped = JSON.parse(await mobile.evaluate(() => HostDiagnostics.reportText));
    assert.equal(stopped.recording.enabled, false);
    assert.equal(stopped.recording.recovery.status, 'available');
    assert.ok(stopped.events.some(e => e.type === 'test_checkpoint' && e.outcome.marker === marker));
    check('stopped session restores report and marked frame after reload without restarting recording');
    assert.deepEqual(mobileErrors, []);
    await mobile.close();

    // Training has its own diagnostics entry point. Exercise its actual
    // touchscreen target so overlap with the skip button cannot regress.
    const training = await browser.newPage(), trainingErrors = [];
    training.on('pageerror', e => trainingErrors.push(e.message));
    await training.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await training.goto(pathToFileURL(path.join(repo, 'play/index.html')).href + '?s=train');
    await training.waitForSelector('.tx.live', { timeout: 30000 });
    await training.waitForSelector('#gamelayer iframe', { timeout: 30000 });
    const trainFrame = await (await training.$('#gamelayer iframe')).contentFrame();
    await trainFrame.waitForFunction('window.__game && window.__game.R.drawCalls > 0', { timeout: 30000 });
    const hitTargets = await training.evaluate(() => ['diagnostics', 'skip'].map(action => {
      const button = document.querySelector(`[data-act=${action}]`), r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { action, hit: hit && hit.closest('[data-act]') && hit.closest('[data-act]').dataset.act };
    }));
    assert.deepEqual(hitTargets.map(x => x.hit), ['diagnostics', 'skip']);
    await settled(training, '[data-act=diagnostics]', true);
    await trainFrame.waitForFunction('__game.paused === true', { timeout: 10000 });
    await settled(training, '[data-d=toggle]', true);
    await trainFrame.waitForFunction('__game.debugRecording === true', { timeout: 10000 });
    await settled(training, '[data-d=done]', true);
    await training.waitForFunction('!Sheet.cur', { timeout: 10000 });
    await trainFrame.waitForFunction('__game.paused === false', { timeout: 10000 });
    await settled(training, '[data-act=diag-mark]', true);
    await training.waitForFunction('HostDiagnostics.bookmark && HostDiagnostics.bookmark.dataUrl.length > 1000');
    await settled(training, '[data-act=diagnostics]', true);
    await training.waitForSelector('[data-d-preview]:not([hidden])');
    await assertPngIsNotBlank(training, '[data-d-image]');
    await settled(training, '[data-d=report]', true);
    await training.waitForSelector('[data-d=download-report]', { visible: true, timeout: 30000 });
    const trainReport = JSON.parse(await training.evaluate(() => HostDiagnostics.reportText));
    assert.equal(trainReport.recording.enabled, true);
    assert.deepEqual(trainingErrors, []);
    check('training diagnostics and skip have separate touch targets; recording, pause, frame and report work');
    await training.close();

    const desktop = await browser.newPage(), desktopErrors = [];
    desktop.on('pageerror', e => desktopErrors.push(e.message));
    await desktop.setViewport({ width: 1280, height: 760 });
    const desktopDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-desktop-shell-diag-'));
    const dd = await desktop.createCDPSession();
    await dd.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: desktopDir });
    await desktop.goto(pathToFileURL(path.join(repo, 'play/index.html')).href + '?s=match');
    await desktop.waitForSelector('.mx.live', { timeout: 30000 });
    await settled(desktop, '[data-act=pause]');
    await settled(desktop, '.sheet-wrap.open [data-a=diagnostics]');
    await settled(desktop, '.sheet-wrap.open [data-d=toggle]');
    await settled(desktop, '[data-d=shot]');
    await desktop.waitForSelector('[data-d-preview]:not([hidden])');
    await assertPngIsNotBlank(desktop, '[data-d-image]');
    await settled(desktop, '[data-d=report]');
    await desktop.waitForSelector('[data-d=download-report]', { visible: true, timeout: 30000 });
    await settled(desktop, '[data-d=download-report]');
    await settled(desktop, '[data-d=download-shot]');
    const desktopJson = JSON.parse((await download(path.join(desktopDir, 'topspin-diagnostics.json'))).toString('utf8'));
    const desktopPng = await download(path.join(desktopDir, 'topspin-frame.png'));
    assert.equal(desktopJson.format, 'topspin-diagnostics');
    assert.equal(desktopPng.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual(desktopErrors, []);
    check('desktop shipped shell downloads both JSON and a nonblank PNG');
    await desktop.close();

    const compact = await browser.newPage(), compactErrors = [];
    compact.on('pageerror', e => compactErrors.push(e.message));
    await compact.setViewport({ width: 360, height: 640, isMobile: true, hasTouch: true });
    await compact.goto(pathToFileURL(path.join(repo, 'play/index.html')).href + '?s=match');
    await compact.waitForSelector('.mx.live', { timeout: 30000 });
    await settled(compact, '[data-act=pause]', true);
    await compact.waitForSelector('.sheet-wrap.open [data-a=screenshot]', { visible: true });
    await pause(700);
    await assertVisibleInScroll(compact, '.sheet-wrap.open .sbody', '.sheet-wrap.open [data-a=screenshot]');
    await settled(compact, '.sheet-wrap.open [data-a=screenshot]', true);
    await compact.waitForSelector('[data-d-preview]:not([hidden])');
    await assertPngIsNotBlank(compact, '[data-d-image]');
    await pause(700);
    await assertVisibleInScroll(compact, '.sheet-wrap.open .sbody', '[data-d=download-shot]');
    assert.deepEqual(compactErrors, []);
    check('screenshot entry, image and download remain visible on a 360x640 phone viewport');
    await compact.close();

    // Storage denial must not break recording, export or gameplay.
    const denied = await browser.newPage();
    await denied.evaluateOnNewDocument(() => Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('storage denied'); } }));
    await denied.goto(pathToFileURL(enginePage()).href);
    await denied.waitForFunction('window.__game && window.__game.R.drawCalls > 0', { timeout: 30000 });
    const fallback = await denied.evaluate(async () => {
      __game.startMatch(0); __game.setDiagnosticMode(true);
      __game.logInput('test_storage_fallback', { outcome: { ok: true } });
      const report = await __game.diagnosticReport();
      return { storage: report.recording.recovery.status, rows: report.events.filter(e => e.type === 'test_storage_fallback').length,
        png: __game.captureDiagnosticFrame().dataUrl.startsWith('data:image/png') };
    });
    assert.equal(fallback.storage, 'unavailable'); assert.equal(fallback.rows, 1); assert.equal(fallback.png, true);
    check('denied IndexedDB is reported; live report and screenshot still work');
    await denied.close();
    console.log(`diagnostics browser checks passed: ${checks}`);
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
