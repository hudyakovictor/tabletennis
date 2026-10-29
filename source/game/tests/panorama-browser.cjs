/* Offline WebGL regression: desktop / portrait, WebGL1, orbit and shadows. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { root, enginePage } = require('./helpers.cjs');

(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux') {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-panorama-'));
  try {
    const pageUrl = pathToFileURL(enginePage()).href;
    for (const [width, height, gl1] of [[640, 480, false], [390, 844, true]]) {
      const page = await browser.newPage();
      const errors = [], external = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
      await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
      if (gl1) await page.evaluateOnNewDocument(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type === 'webgl2' ? null : getContext.call(this, type, ...args);
        };
      });
      await page.goto(pageUrl);
      await page.waitForFunction(() => window.__game && window.__game.scene.hasPanorama &&
        window.__game.scene.mat.courtGround.asphalt, { timeout: 45000 });
      const result = await page.evaluate(() => {
        const g = window.__game, R = g.R, gl = R.gl, scene = g.scene;
        g.paused = true; g.reducedMotion = true;
        Object.assign(R.post, { grain: 0, ca: 0, bloom: 0, vignette: 0, radial: 0, flash: 0 });
        // Isolate the fixed court and table from moving props in pixel tests.
        g.drawDynamic = () => {}; g.drawFX = () => {}; g.drawReflections = () => {}; g.drawContactShadows = () => {};
        const pixels = () => {
          const p = new Uint8Array(R._w * R._h * 4);
          gl.readPixels(0, 0, R._w, R._h, gl.RGBA, gl.UNSIGNED_BYTE, p);
          return p;
        };
        const views = [];
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2, eye = { x: 4.3 * Math.sin(a), y: 3, z: 4.3 * Math.cos(a) };
          R.setCamera(eye, { x: 0, y: 0.45, z: 0 }, { x: 0, y: 1, z: 0 }, 52, 0.05, 60, 0);
          scene._shadowMat0.opacity = 1; g.render(); const withShadow = pixels();
          scene._shadowMat0.opacity = 0; g.render(); const noShadow = pixels();
          let darkened = 0, total = 0, hash = 0;
          for (let p = 0; p < withShadow.length; p += 4) {
            const d = noShadow[p] + noShadow[p + 1] + noShadow[p + 2] - withShadow[p] - withShadow[p + 1] - withShadow[p + 2];
            if (d > 12) darkened++;
            total += d;
            if (p % 160 === 0) hash = (Math.imul(hash, 31) + withShadow[p] + withShadow[p + 1] * 3 + withShadow[p + 2] * 7) | 0;
          }
          views.push({ darkened, total, hash, eye });
        }
        scene._shadowMat0.opacity = 1;
        // A failed/omitted asphalt image still draws the panorama without a GL error.
        const asphalt = scene.mat.courtGround.asphalt; scene.mat.courtGround.asphalt = null; g.render();
        const withoutAsphaltError = gl.getError(); scene.mat.courtGround.asphalt = asphalt; g.render();
        return { isGL2: R.isGL2, views, withoutAsphaltError, glError: gl.getError(), draws: R.drawCalls };
      });
      assert.equal(result.isGL2, !gl1, `WebGL version ${width}x${height}`);
      assert.equal(result.glError, 0, 'render produced a WebGL error');
      assert.equal(result.withoutAsphaltError, 0, 'missing asphalt must not break the panorama');
      assert.ok(result.draws > 0);
      assert.ok(new Set(result.views.map(v => v.hash)).size > 2, 'the fixed environment changes during a 360° orbit');
      for (const [index, v] of result.views.entries()) {
        assert.ok(v.darkened > 30 && v.total > 0, `visible table shadow at angle ${index}: ${JSON.stringify(v)}`);
      }
      assert.deepEqual(external, [], 'standalone engine must work offline');
      assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
      console.log(`ok: ${width}x${height}, ${gl1 ? 'WebGL1' : 'WebGL2'}, four orbit angles and visible shadows`);
      await page.close();
    }

    // Exercise the real embedded lobby camera, not only hand-set test views.
    const lobby = await browser.newPage();
    await lobby.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await lobby.evaluateOnNewDocument(() => { window.__TT_EMBED = 1; });
    await lobby.goto(pageUrl);
    await lobby.waitForFunction(() => window.__game && window.__game.scene.hasPanorama && window.__game.scene.mat.courtGround.asphalt,
      { timeout: 45000 });
    await lobby.evaluate(() => window.postMessage({ __tt: 1, type: 'lobby' }, '*'));
    await lobby.waitForFunction(() => window.__game && window.__game._idleStill, { timeout: 10000 });
    const orbit = await lobby.evaluate(() => {
      const g = window.__game; g.paused = true; const positions = [];
      for (let i = 0; i < 4; i++) {
        g.updateCamera(13.1); g.render();
        positions.push({ eye: { ...g.R.camPos }, look: { ...g.camLook }, error: g.R.gl.getError() });
      }
      return positions;
    });
    for (const p of orbit) {
      assert.equal(p.error, 0);
      assert.ok(Math.abs(p.look.x) < 1e-6 && Math.abs(p.look.z) < 0.11, 'lobby camera looks at the table/court centre');
    }
    assert.ok(Math.hypot(orbit[0].eye.x - orbit[1].eye.x, orbit[0].eye.z - orbit[1].eye.z) > 2, 'lobby camera actually orbits');
    await lobby.evaluate(() => window.postMessage({ __tt: 1, type: 'match', diff: 1, free: true }, '*'));
    await lobby.waitForFunction(() => window.__game && window.__game.state !== 'MENU', { timeout: 10000 });
    const match = await lobby.evaluate(() => {
      const g = window.__game; g.updateCamera(2); g.render();
      return { panorama: g.scene.hasPanorama, asphalt: !!g.scene.mat.courtGround.asphalt,
        shadow: !!g.scene.tex.tableGroundShadow, error: g.R.gl.getError() };
    });
    assert.deepEqual(match, { panorama: true, asphalt: true, shadow: true, error: 0 });
    console.log('ok: embedded lobby orbit and transition into a match');
    await lobby.close();

    // The no-image build must still have a playable scene and table shade.
    const fallbackPath = path.join(tmp, 'no-arena.html');
    execFileSync('python3', [path.join(root, 'tt/build.py'), fallbackPath],
      { env: { ...process.env, TT_NO_ARENA: '1', TT_NO_LOGO: '1' }, stdio: 'pipe' });
    const fallback = await browser.newPage();
    await fallback.setViewport({ width: 640, height: 480 });
    await fallback.goto(pathToFileURL(fallbackPath).href);
    await fallback.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0, { timeout: 45000 });
    const state = await fallback.evaluate(() => {
      const g = window.__game; g.render();
      return { hasPanorama: g.scene.hasPanorama, shadow: !!g.scene.tex.tableGroundShadow, error: g.R.gl.getError() };
    });
    assert.deepEqual(state, { hasPanorama: false, shadow: true, error: 0 });
    console.log('ok: TT_NO_ARENA fallback');
    await fallback.close();
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
