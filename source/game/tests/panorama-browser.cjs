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
    args: process.platform === 'linux' ? chromium.args : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], headless: true,
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

    // Real parent -> iframe messages, projected sprite transfer and MENU-only robots.
    const hostPath = path.join(tmp, 'lobby-host.html');
    fs.writeFileSync(hostPath, `<!doctype html><style>html,body{margin:0;width:100%;height:100%}iframe{border:0;width:100%;height:100%}</style>
      <iframe id="engine" src="${pageUrl}"></iframe><script>window.lobbyMessages=[];addEventListener('message',e=>{
        if(e.source===document.getElementById('engine').contentWindow&&e.data?.__tt===1)lobbyMessages.push(e.data);
      });</script>`);
    for (const [width, height, dpr] of [[640, 480, 1], [390, 844, 3]]) {
      const lobby = await browser.newPage(), errors = [];
      lobby.on('pageerror', e => errors.push(e.message));
      await lobby.setViewport({ width, height, deviceScaleFactor: dpr, isMobile: width < 500, hasTouch: width < 500 });
      await lobby.evaluateOnNewDocument(() => { if (window.parent !== window) window.__TT_EMBED = 1; });
      await lobby.goto(pathToFileURL(hostPath).href);
      await lobby.waitForFunction(() => window.lobbyMessages.some(m => m.type === 'ready'), { timeout: 45000 });
      const arena = lobby.frames().find(f => f.parentFrame());
      await arena.evaluate(() => {
        const g = window.__game, draw = g.R.draw.bind(g.R), render = g.render.bind(g);
        window.lobbyBall = g.ball; window.lobbyRenders = [];
        window.beforeLobby = JSON.stringify([g.time, g.strokeTime, g.frame, g.score, g.rally, g.stats, g.player, g.aiPaddle]);
        let balls = 0, robotParts = 0;
        g.R.draw = (mesh, matrix, mat) => {
          if (mesh === g.scene.mesh.ball) balls++;
          if (mesh === g.scene.mesh.sphere || mesh === g.scene.mesh.capsule) robotParts++;
          return draw(mesh, matrix, mat);
        };
        g.render = () => {
          balls = robotParts = 0; render();
          if (g.lobbyScene?.active) window.lobbyRenders.push({ phase: g.lobbyScene.phase,
            handoff: g.lobbyScene.handoff, clock: g.lobbyScene.clock, balls, robotParts,
            camera: Array.from(g.R.viewProj), x: g.project(g.ball.p, {}).x, y: g.project(g.ball.p, {}).y });
        };
      });
      const command = (type, data = {}) => lobby.evaluate(m => document.getElementById('engine').contentWindow.postMessage(m, '*'),
        { __tt: 1, type, ...data });
      await command('lobby', { intro: true, requestId: 101 });
      await lobby.waitForFunction(() => window.lobbyMessages.some(m => m.type === 'lobbyReady' && m.requestId === 101), { timeout: 45000 });
      const waiting = await arena.evaluate(() => {
        const g = window.__game, c = g.lobbyScene;
        g.render();
        return { phase: c.phase, hits: c.hits, ready: c.readySent,
          settled: g.scene.panoramaSettled && g.scene.asphaltSettled && g.scene.standsSettled,
          robots: c.bots.map(b => g.project({ x: b.x, y: 1.47, z: b.side * 2.04 }, {})),
          firstSide: c.firstSide, error: g.R.gl.getError(), render: window.lobbyRenders.at(-1) };
      });
      assert.equal(waiting.phase, 'waiting'); assert.equal(waiting.hits, 0);
      assert.equal(waiting.ready && waiting.settled, true); assert.equal(waiting.error, 0);
      assert.ok(waiting.robots.every(s => s.ok && s.x > 0.06 && s.x < 0.94 && s.y > 0.12 && s.y < 0.68));
      assert.equal(waiting.render.balls, 0); assert.ok(waiting.render.robotParts >= 20);
      await command('lobby'); // The hub reveals at impact, before launch.
      assert.equal(await arena.evaluate(() => window.__game.lobbyScene.phase), 'waiting');
      await command('lobbyLaunch', { requestId: 101, x: 0.5, y: 0.48, diameter: 0.9 });
      await lobby.waitForFunction(() => window.lobbyMessages.some(m => m.type === 'lobbyHit'), { timeout: 20000 });
      const transfer = await lobby.evaluate(() => window.lobbyMessages.filter(m => ['lobbyFrame', 'lobbyHit'].includes(m.type)));
      const first = transfer[0], handoff = transfer.find(m => m.type === 'lobbyFrame' && m.handoff);
      assert.equal(first.type, 'lobbyFrame'); assert.equal(first.progress, 0); assert.equal(first.handoff, false);
      assert.ok(Math.abs(first.x - 0.5) * width < 0.5 && Math.abs(first.y - 0.48) * height < 0.5, JSON.stringify(first));
      assert.ok(Math.abs(first.diameter - 0.9) * width < 0.5, JSON.stringify(first));
      assert.ok(handoff && handoff.diameter * width <= 12.1);
      assert.equal(transfer.filter(m => m.type === 'lobbyHit').length, 1);
      assert.equal(transfer.at(-1).side, waiting.firstSide);
      const rendered = await arena.evaluate(() => ({ frames: window.lobbyRenders,
        identity: window.__game.ball === window.lobbyBall,
        unchanged: window.beforeLobby === JSON.stringify([window.__game.time, window.__game.strokeTime, window.__game.frame,
          window.__game.score, window.__game.rally, window.__game.stats, window.__game.player, window.__game.aiPaddle]) }));
      assert.equal(rendered.identity && rendered.unchanged, true, 'MENU animation must not mutate live-game state');
      for (const frame of rendered.frames) assert.equal(frame.balls, frame.handoff ? 1 : 0, 'one visible owner of the ball');
      const flightFrames = rendered.frames.filter(f => f.phase === 'flight');
      assert.ok(flightFrames.length > 2);
      for (const frame of flightFrames) assert.deepEqual(frame.camera, flightFrames[0].camera, 'intro camera stays fixed through first hit');
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
      await command('match', { diff: 1, free: true });
      await arena.waitForFunction(() => window.__game.state !== 'MENU', { timeout: 10000 });
      const match = await arena.evaluate(() => {
        const g = window.__game; g.updateCamera(2); g.render();
        return { panorama: g.scene.hasPanorama, asphalt: !!g.scene.mat.courtGround.asphalt,
          shadow: !!g.scene.tex.tableGroundShadow, lobby: g.lobbyScene.active, error: g.R.gl.getError() };
      });
      assert.deepEqual(match, { panorama: true, asphalt: true, shadow: true, lobby: false, error: 0 });
      assert.deepEqual(errors, []);
      console.log(`ok: ${width}x${height} DPR${dpr}, real iframe readiness/ball handoff/robots/RM/match isolation`);
      await lobby.close();
    }

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
