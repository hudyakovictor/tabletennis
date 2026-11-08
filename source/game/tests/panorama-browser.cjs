/* Offline WebGL regression: desktop / portrait, WebGL1, orbit and shadows. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = process.env.CHROME_BIN ? null : require('@sparticuz/chromium');
const { repo, appPage, appFrame } = require('./helpers.cjs');

(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux' && !process.env.CHROME_BIN) {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: process.env.CHROME_BIN ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required'] : chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-panorama-'));
  try {
    const pageUrl = pathToFileURL(appPage()).href;
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
      const frame = await appFrame(page);
      await frame.waitForFunction(() => window.__game && window.__game.scene.hasPanorama &&
        window.__game.scene.mat.courtGround.asphalt, { timeout: 45000 });
      const result = await frame.evaluate(() => {
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
      assert.deepEqual(external, [], 'the complete application must work offline');
      assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
      console.log(`ok: ${width}x${height}, ${gl1 ? 'WebGL1' : 'WebGL2'}, four orbit angles and visible shadows`);
      await page.close();
    }

    // The real hub owns readiness, the paddle-only exhibition and match transition.
    for (const [width, height, dpr] of [[640, 480, 1], [390, 844, 3]]) {
      const lobby = await browser.newPage(), errors = [];
      lobby.on('pageerror', e => errors.push(e.message));
      await lobby.setViewport({ width, height, deviceScaleFactor: dpr, isMobile: width < 500, hasTouch: width < 500 });
      await lobby.goto(pageUrl + '?s=hub');
      await lobby.waitForFunction(() => typeof GameHost !== 'undefined' && GameHost.ready, { timeout: 45000 });
      const arena = await (await lobby.$('#gamelayer iframe')).contentFrame();
      await arena.waitForFunction(() => window.__game?.lobbyScene?.active, { timeout: 45000 });
      await lobby.evaluate(() => {
        window.lobbyMessages=[];GameHost.on(m=>window.lobbyMessages.push(m));
        GameHost.send('attract');GameHost.send('lobby',{intro:true,requestId:101});
      });
      await lobby.waitForFunction(() => window.lobbyMessages.some(m => m.type === 'lobbyReady' && m.requestId === 101), { timeout: 45000 });
      await arena.evaluate(() => {
        const g = window.__game, draw = g.R.draw.bind(g.R), render = g.render.bind(g);
        g.paused=true;window.lobbyBall = g.ball; window.lobbyRenders = [];
        window.beforeLobby = JSON.stringify([g.time, g.strokeTime, g.frame, g.score, g.rally, g.stats, g.player, g.aiPaddle]);
        let balls = 0, robotParts = 0, paddles = 0;
        g.R.draw = (mesh, matrix, mat) => {
          if (mesh === g.scene.mesh.ball) balls++;
          if (mesh === g.scene.mesh.sphere || mesh === g.scene.mesh.capsule) robotParts++;
          if (mesh === g.scene.mesh.blade) paddles++;
          return draw(mesh, matrix, mat);
        };
        g.render = () => {
          balls = robotParts = paddles = 0; render();
          if (g.lobbyScene?.active) window.lobbyRenders.push({ phase: g.lobbyScene.phase,
            clock: g.lobbyScene.clock, balls, robotParts, paddles,
            camera: Array.from(g.R.viewProj), x: g.project(g.ball.p, {}).x, y: g.project(g.ball.p, {}).y });
        };
      });
      const command = (type, data = {}) => lobby.evaluate(({ type, data }) => GameHost.send(type, data), { type, data });
      const waiting = await arena.evaluate(() => {
        const g = window.__game, c = g.lobbyScene;
        g.render();
        return { phase: c.phase, hits: c.hits, ready: c.readySent,
          settled: g.scene.panoramaSettled && g.scene.asphaltSettled && g.scene.standsSettled,
          error: g.R.gl.getError(), render: window.lobbyRenders.at(-1) };
      });
      assert.equal(waiting.phase, 'waiting'); assert.equal(waiting.hits, 0);
      assert.equal(waiting.ready && waiting.settled, true); assert.equal(waiting.error, 0);
      assert.equal(waiting.render.balls, 0); assert.equal(waiting.render.robotParts, 0);
      assert.equal(waiting.render.paddles, 2);
      // Readiness is not a sprite launch: the shell leaves waiting and starts the hub rally.
      await command('attract'); await command('lobby');
      await arena.waitForFunction(() => window.__game.lobbyScene.phase === 'rally');
      await arena.evaluate(() => {
        const g=window.__game;window.lobbyRenders=[];
        for(let i=0;i<40;i++){g.lobbyScene.update(.1);g.updateCamera(0);g.render();}
      });
      const rendered = await arena.evaluate(() => ({ frames: window.lobbyRenders,
        identity: window.__game.ball === window.lobbyBall,
        unchanged: window.beforeLobby === JSON.stringify([window.__game.time, window.__game.strokeTime, window.__game.frame,
          window.__game.score, window.__game.rally, window.__game.stats, window.__game.player, window.__game.aiPaddle]) }));
      assert.equal(rendered.identity && rendered.unchanged, true, 'MENU animation must not mutate live-game state');
      assert.ok(rendered.frames.length >= 40);
      for (const frame of rendered.frames) {
        assert.equal(frame.balls, 1, 'one visible ball');
        assert.equal(frame.paddles, 2, 'the same two paddles on desktop and mobile');
        assert.equal(frame.robotParts, 0, 'no lobby characters');
      }
      const orbit = await arena.evaluate(() => {
        const g = window.__game; g.paused = true; const positions = [];
        for (let i = 0; i < 4; i++) {
          g.lobbyScene.clock += 13.1; g.updateCamera(0); g.render();
          positions.push({ eye: { ...g.R.camPos }, look: { ...g.camLook }, error: g.R.gl.getError() });
        }
        g.reducedMotion = true;
        const frozen = Array.from(g.R.viewProj); g.lobbyScene.update(0.1); g.updateCamera(2); g.render();
        return { positions, frozen: JSON.stringify(frozen) === JSON.stringify(Array.from(g.R.viewProj)) };
      });
      for (const p of orbit.positions) assert.equal(p.error, 0);
      assert.ok(Math.hypot(orbit.positions[0].eye.x - orbit.positions[1].eye.x, orbit.positions[0].eye.z - orbit.positions[1].eye.z) > 2);
      assert.equal(orbit.frozen, true, 'reduced motion stops camera orbit');
      await lobby.evaluate(() => Router.go('match', { mode: 'instant' }));
      await lobby.waitForSelector('.mx.live', { timeout: 45000 });
      await command('match', { diff: 1, free: true }); await command('live');
      await arena.waitForFunction(() => window.__game.state !== 'MENU', { timeout: 10000 });
      const match = await arena.evaluate(() => {
        const g = window.__game; g.updateCamera(2); g.render();
        return { panorama: g.scene.hasPanorama, asphalt: !!g.scene.mat.courtGround.asphalt,
          shadow: !!g.scene.tex.tableGroundShadow, lobby: g.lobbyScene.active, error: g.R.gl.getError() };
      });
      assert.deepEqual(match, { panorama: true, asphalt: true, shadow: true, lobby: false, error: 0 });
      assert.deepEqual(errors, []);
      console.log(`ok: ${width}x${height} DPR${dpr}, production hub readiness/paddles/orbit/RM/match isolation`);
      await lobby.close();
    }

    // The no-image build must still have a playable scene and table shade.
    const fallbackPath = path.join(tmp, 'no-arena.html');
    execFileSync('python3', [path.join(repo, 'source/build.py'), fallbackPath],
      { env: { ...process.env, TT_API_BASE: '', TT_NO_ARENA: '1' }, stdio: 'pipe' });
    const fallback = await browser.newPage();
    await fallback.setViewport({ width: 640, height: 480 });
    const fallbackFrame = await appFrame(fallback, { appPath: fallbackPath });
    const state = await fallbackFrame.evaluate(() => {
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
