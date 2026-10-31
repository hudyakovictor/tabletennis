/* Isolated current sources, real Game/Scene/Renderer and Chromium WebGL.
 * No builder or boot RAF: the test supplies the parent's reference-only tick.
 * Run: node tt/tools/training_preview_browser.cjs (CHROME_BIN is optional). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const gameRequire = createRequire(path.resolve(__dirname, '../../package.json'));
const puppeteer = gameRequire('puppeteer-core');
const src = path.resolve(__dirname, '../src');
const read = name => fs.readFileSync(path.join(src, name), 'utf8');
const order = fs.readFileSync(path.resolve(__dirname, '../build.py'), 'utf8').match(/JS_ORDER\s*=\s*(\[[\s\S]*?\])/)[1]
  .match(/'[^']+\.js'/g).map(name => name.slice(1, -1)).filter(name => !['90_boot.js', '92_embed.js'].includes(name));
const sources = order.map(read).join('\n\n');
const css = ['05_style.css', '06_embed.css', '07_preview.css'].map(read).join('\n');
const body = read('02_body.html').replaceAll('{{BRAND_LOGO}}', 'data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=');
const hash = state => createHash('sha256').update(state).digest('hex');

async function setup(page, width, height, errors) {
  await page.setViewport({ width, height, isMobile: width < 600, hasTouch: true });
  await page.setRequestInterception(true); page.on('request', request => request.abort());
  await page.setContent(`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${body}</body></html>`);
  await page.addScriptTag({ content: sources + `
    window.__TT_EMBED = true;
    const previewTestUI = new UI(), previewTestGame = new Game(document.getElementById('gl'), previewTestUI);
    previewTestUI.attach(previewTestGame);
    const g = previewTestGame;
    for (const screen of document.querySelectorAll('.screen.on')) screen.classList.remove('on');
    document.getElementById('loading').classList.add('off');
    g.state = GS.RALLY; g.time = 19.25; g.strokeTime = 9.5; g.frame = 31;
    g.score = [3, 4]; g.ball.live = true; g.ball.lastHitBy = -1;
    V3.set(g.ball.p, .21, 1.09, .92); V3.set(g.ball.v, .1, -.4, 7); V3.set(g.ball.w, 320, 41, 13);
    g.training = new Trainer(g, { stage: 'practice', progress: { version: 1, cursor: 3, skills: {} } });
    g.training.phase = 'playing'; g.training.clock = 7.2; g.training.correct = 1; g.training.attempt = 3;
    g.swipe.down(.38, .64, 19.1, 9.4); g.swipe.move(.4, .6, 19.2, 9.45); g.pointerDown = true;
    g.audio.setLevels({ master: .43, effects: .51, music: 0, ambient: .17 }); g.audio.setMuted(true);
    g.ui.uiAnim.clear(); g.ui.hudAnim.anim.clear();
    g.ui.syncDialogFocus(); g.ui.syncNativeCursor();
    const opener = document.createElement('button'); opener.id = 'previewTestOpener'; opener.textContent = 'Open reference';
    opener.style.cssText = 'position:absolute;left:12px;top:12px;z-index:60'; document.getElementById('app').appendChild(opener); opener.focus();
    const trace = { contexts: 0, raf: 0, random: 0 };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(...args) { trace.contexts++; return getContext.apply(this, args); };
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = function(...args) { trace.raf++; return raf.apply(this, args); };
    const random = Math.random;
    Math.random = () => { trace.random++; throw Error('preview consumed RNG'); };
    const serialize = (presentation = true) => {
      const seen = new Map();
      const walk = (value, path) => {
        if (path === 'game.preview') return '[preview owner]';
        if (presentation && (path === 'game.paused' || path === 'game.audio.quiet')) return '[presentation]';
        if (typeof value === 'function') return '[function]';
        if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
        if (!value || typeof value !== 'object') return value;
        if (value instanceof Node) return '[DOM:' + value.nodeName + ':' + (value.id || '') + ']';
        if (seen.has(value)) return { ref: seen.get(value) }; seen.set(value, path);
        if (ArrayBuffer.isView(value)) return Array.from(value);
        if (value instanceof Map) return Array.from(value, ([k,v]) => [walk(k,path+'.key'),walk(v,path+'.value')]);
        if (value instanceof Set) return Array.from(value,v=>walk(v,path+'.value'));
        if (Array.isArray(value)) return value.map((v,i)=>walk(v,path+'.'+i));
        return Object.fromEntries(Object.keys(value).sort().map(k=>[k,walk(value[k],path+'.'+k)]));
      };
      return JSON.stringify(walk(g, 'game'));
    };
    const masks = () => JSON.stringify(Array.from(document.getElementById('app').children).filter(el => el.id !== 'ttPreview')
      .map(el => [el.id, el.inert, el.getAttribute('aria-hidden'), el.style.visibility, el.style.pointerEvents]));
    const tick = (dt = 0) => { g.preview.update(dt); g.preview.render(); };
    window.previewFixture = { g, trace, serialize, masks, tick, restore() {
      HTMLCanvasElement.prototype.getContext = getContext; window.requestAnimationFrame = raf; Math.random = random;
    } };
  ` });
  const initialized = await page.evaluate(() => !!(window.previewFixture && previewFixture.g.music._initialized));
  assert.ok(initialized, 'real Game fixture failed: ' + errors.join('; '));
  await page.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
}

async function run(page, width, height) {
  const before = await page.evaluate(() => ({ game: previewFixture.serialize(), exact: previewFixture.serialize(false), masks: previewFixture.masks() }));
  const results = await page.evaluate(() => {
    const f = previewFixture, g = f.g, p = g.preview, checks = [];
    const check = (name, ok) => { if (!ok) throw Error(name); checks.push(name); };
    check('real preview opens', p.open({ lessonId: 'BANANA', play: false })); f.tick();
    check('one dialog', document.querySelectorAll('#ttPreview[role=dialog]').length === 1);
    check('initial focus', document.activeElement === p.controls.close);
    const root = p.root.getBoundingClientRect(), stage = p._stage.getBoundingClientRect(), inset = p.root.querySelector('.tt-preview-inset-window').getBoundingClientRect();
    check('visible stage', stage.width > 150 && stage.height >= 95);
    check('all controls on screen', [...p.root.querySelectorAll('button,select,input')].every(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    }));
    check('contact inset inside dialog', inset.width > 50 && inset.height >= 65 && inset.left >= root.left && inset.right <= root.right);
    check('canvas preserved and masked', !g.canvas.style.visibility && g.canvas.inert && g.canvas.style.pointerEvents === 'none');
    const observed = [], draw = g.R.draw;
    g.R.draw = function(mesh, matrix, mat) {
      const gl = this.gl; observed.push({ vp: Array.from(gl.getUniform(this.progMain.p, this.progMain.u.uViewProj)),
        cam: Array.from(gl.getUniform(this.progMain.p, this.progMain.u.uCam)), mesh: mesh === g.scene.mesh.ball ? 'ball' : 'other' });
      return draw.call(this, mesh, matrix, mat);
    };
    p.command('contact'); f.tick(); delete g.R.draw;
    check('actual inset shader camera', JSON.stringify(observed[0].vp) !== JSON.stringify(observed.at(-1).vp));
    check('actual ball draw in both views', observed.filter(d => d.mesh === 'ball').length === 2);
    const gl = g.R.gl, r = p._glRect(p._inset), pixels = new Uint8Array(r[2] * r[3] * 4);
    gl.readPixels(r[0], r[1], r[2], r[3], gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let min = 255, max = 0; for (let i = 0; i < pixels.length; i += 4) { min = Math.min(min, pixels[i]); max = Math.max(max, pixels[i]); }
    check('rendered WebGL inset pixels', max - min > 30); check('WebGL has no error', gl.getError() === gl.NO_ERROR);
    const game = f.serialize(), ph = JSON.stringify([PH, STROKE_CONFIG]), warm = JSON.stringify(Array.from(SERVE_WARM));
    for (const id of Object.keys(PADDLE_TEMPLATES.strokes).concat(['SERVE_SIDE_TOP', 'SERVE_SIDE_BACK', 'HIT'])) {
      check('open ' + id, p.open({ ...(id === 'SERVE_SIDE_TOP' || id === 'SERVE_SIDE_BACK' || id === 'HIT' ? { lessonId: id } : { strokeId: id }), play: false }));
      for (const phase of [0, p.clip.compiled.contactPhase, 1]) { p.command('seek', phase); f.tick(); }
      const points = p._gesturePoints;
      check('gesture fits ' + id, points.every(point => point[0] >= 14 && point[0] <= 226 && point[1] >= 14 && point[1] <= 118));
      const circle = p.root.querySelector('.tt-preview-touch-window'), at = points[p.profile.gesture.contactIndex];
      check('contactIndex ' + id, Math.abs(Number(circle.getAttribute('cx')) - at[0]) < 1e-7 && Math.abs(Number(circle.getAttribute('cy')) - at[1]) < 1e-7);
      check('full Game unchanged ' + id, f.serialize() === game);
    }
    check('physics and warm cache unchanged', JSON.stringify([PH, STROKE_CONFIG]) === ph && JSON.stringify(Array.from(SERVE_WARM)) === warm);
    p.open({ lessonId: 'BANANA', play: false }); f.tick();
    p.command('seek', .37); p.command('rate', .8); f.tick();
    const data = p.clip, phase = p.phase, canvas = g.canvas;
    const title = p.root.querySelector('#ttPreviewTitle').textContent;
    ET.set(ET.lang() === 'ru' ? 'en' : 'ru'); p.localize(); f.tick();
    check('live localization', p.root.querySelector('#ttPreviewTitle').textContent !== title && p.clip === data && p.phase === phase && g.canvas === canvas);
    check('arbitrary playback rate labelled', p.controls.rate.value === '.8' || p.controls.rate.value === '0.8');
    check('no RAF, contexts or RNG', f.trace.raf === 0 && f.trace.contexts === 0 && f.trace.random === 0);
    return checks;
  });
  assert.equal(hash(await page.evaluate(() => previewFixture.serialize())), hash(before.game), 'all actual Game fields changed during render');

  await page.evaluate(() => {
    const p = previewFixture.g.preview, panel = p.root.querySelector('.tt-preview-details');
    panel.scrollTop = Math.min(40, Math.max(0, panel.scrollHeight - panel.clientHeight));
    panel.dispatchEvent(new Event('scroll')); previewFixture.tick();
    if (p._inset && p._insetClip && (p._insetClip.w > p._inset.w + 1e-7 || p._insetClip.h > p._inset.h + 1e-7)) throw Error('inset scroll clip stretches geometry');
    panel.scrollTop = 0; panel.dispatchEvent(new Event('scroll')); previewFixture.tick();
  });

  await page.focus('#ttPreview [data-preview=close]'); await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.preview), 'tableguide', 'modal focus trap');
  const slider = await page.$eval('#ttPreview [data-preview=seek]', el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
  await page.mouse.move(slider.x + slider.w * .25, slider.y); await page.mouse.down();
  await page.mouse.move(slider.x + slider.w * .75, slider.y, { steps: 5 }); await page.mouse.up();
  const scrub = await page.evaluate(() => { previewFixture.tick(); return previewFixture.g.preview.snapshot(); });
  assert.ok(scrub.phase > .60 && !scrub.playing, 'native slider works despite input capture');
  await page.select('#ttPreview [data-preview=camera]', 'side');
  await page.select('#ttPreview [data-preview=grip]', 'penhold');
  await page.select('#ttPreview [data-preview=hand]', 'left');
  await page.select('#ttPreview [data-preview=forehand]', 'fh');
  await page.click('#ttPreview [data-preview=tableguide]');
  assert.equal(await page.evaluate(() => previewFixture.g.preview.tableguide), false);
  const stage = await page.$eval('#ttPreview [data-preview-orbit]', el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * .45, y: r.top + r.height * .5 }; });
  const orbitBefore = await page.evaluate(() => ({ ...previewFixture.g.preview.orbit }));
  await page.mouse.move(stage.x, stage.y); await page.mouse.down(); await page.mouse.move(stage.x + 40, stage.y + 14, { steps: 4 }); await page.mouse.up();
  await page.mouse.wheel({ deltaY: -110 });
  const orbitAfter = await page.evaluate(() => { previewFixture.tick(); return { ...previewFixture.g.preview.orbit }; });
  assert.notEqual(orbitAfter.yaw, orbitBefore.yaw); assert.notEqual(orbitAfter.zoom, orbitBefore.zoom);
  const cdp = await page.createCDPSession();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: stage.x - 20, y: stage.y, id: 1 }, { x: stage.x + 20, y: stage.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: stage.x - 36, y: stage.y, id: 1 }, { x: stage.x + 36, y: stage.y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  assert.ok(await page.evaluate(() => previewFixture.g.preview._pointers.size === 0));
  await page.click('#ttPreview [data-preview=play]');
  assert.equal(await page.evaluate(() => previewFixture.g.preview.playing), true);
  await page.evaluate(() => { for (let i = 0; i < 60; i++) previewFixture.tick(1 / 60); });
  assert.equal(hash(await page.evaluate(() => previewFixture.serialize())), hash(before.game), 'native controls leaked into actual Game');
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => ({ active: previewFixture.g.preview.active, root: !!document.querySelector('#ttPreview'),
    focus: document.activeElement.id, game: previewFixture.serialize(false), masks: previewFixture.masks(), listeners: previewFixture.g.preview._listeners.length }));
  assert.equal(closed.active, false); assert.equal(closed.root, false); assert.equal(closed.focus, 'previewTestOpener');
  assert.equal(closed.masks, before.masks); assert.equal(hash(closed.game), hash(before.exact)); assert.equal(closed.listeners, 0);
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluate(() => { const p = previewFixture.g.preview; p.open({ lessonId: 'SERVE_NO_SPIN' }); previewFixture.tick(.1); });
  const reduced = await page.evaluate(() => { const p = previewFixture.g.preview; return { playing: p.playing, phase: p.phase, contact: p.clip.compiled.contactPhase,
    cursor: getComputedStyle(p.root.querySelector('.tt-preview-touch-cursor')).display,
    geometry: !!p.root.querySelector('.tt-preview-swipe').getAttribute('d'), spin: p.snapshot().contact.spin.totalRps }; });
  assert.equal(reduced.playing, false); assert.equal(reduced.phase, reduced.contact); assert.equal(reduced.cursor, 'none');
  assert.equal(reduced.geometry, true); assert.equal(reduced.spin, 0);
  await page.evaluate(() => previewFixture.g.preview.close(false));
  assert.equal(await page.evaluate(() => previewFixture.g.paused && previewFixture.g.audio.quiet), true);
  return { width, height, namedChecks: results.length, nativeControls: true, sourceMode: 'isolated-real-Game-WebGL', screenshots: false };
}

(async () => {
  const executablePath = process.env.CHROME_BIN || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : await gameRequire('@sparticuz/chromium').executablePath());
  const tempRoot = process.env.KILO_TEMP_ROOT || os.tmpdir(), profile = fs.mkdtempSync(path.join(tempRoot, 'tt-preview-browser-'));
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, userDataDir: profile, headless: true,
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'] });
    const reports = [];
    for (const [width, height] of [[1280, 760], [390, 844], [360, 640], [640, 360]]) {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try { await setup(page, width, height, errors); reports.push(await run(page, width, height)); assert.deepEqual(errors, []); }
      finally { await page.close(); }
    }
    process.stdout.write(JSON.stringify({ ok: true, reports, physicalDevice: false, integratedBoot: false }, null, 2) + '\n');
  } finally {
    if (browser) await browser.close(); fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
