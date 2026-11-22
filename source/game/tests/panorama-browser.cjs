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

async function inspectScene(frame, label, captureDir) {
  await frame.waitForFunction(() => window.__game?.scene.racketsSettled, { timeout: 45000 });
  const result = await frame.evaluate(capture => {
    const g = window.__game, R = g.R, gl = R.gl, scene = g.scene;
    const saved = { dynamic: g.drawDynamic, fx: g.drawFX, shadows: g.drawContactShadows, camera: g.updateCamera,
      paused: g.paused, reduced: g.reducedMotion, post: { ...R.post }, view: R.view.slice(), proj: R.proj.slice(),
      vp: R.viewProj.slice(), eye: { ...R.camPos }, draw: R.draw };
    const physical = () => JSON.stringify([g.time, g.frame, g.score, g.stats, g.player, g.aiPaddle,
      g.ball.p, g.ball.v, g.ball.w, g.ball.live, g.ball.lastHitBy]);
    const before = physical(), modelMeshes = new Set(Object.values(scene.rackets).flatMap(model => model.parts.map(part => part.mesh)));
    let parts = 0;
    R.draw = (mesh, matrix, mat) => { if (modelMeshes.has(mesh)) parts++; return saved.draw.call(R, mesh, matrix, mat); };
    g.paused = true; g.reducedMotion = true; g.drawFX = g.drawContactShadows = g.updateCamera = () => {};
    Object.assign(R.post, { ca: 0, grain: 0, radial: 0, flash: 0 });
    const centre = { x: 0, y: PH.T_H + .32, z: .15 }, views = [];
    const poses = [
      { name: 'end-near', eye: { x: 0, y: 1.2, z: R.aspect() < 1 ? 5.6 : 3.4 } },
      { name: 'end-far', eye: { x: 0, y: 1.2, z: R.aspect() < 1 ? -5.6 : -3.4 } },
      { name: 'standard-red', id: 'r-standard', q: Q.new(), face: 1 },
      { name: 'standard-black', id: 'r-standard', q: Q.setAxisAngle(Q.new(), 0, 1, 0, Math.PI), face: -1 },
      { name: 'standard-edge', id: 'r-standard', q: Q.fromEuler(Q.new(), .22, 1.18, .12), face: 1 },
      { name: 'pan-bottom', id: 'r-pan', q: Q.new(), face: 1 },
      { name: 'pan-edge', id: 'r-pan', q: Q.fromEuler(Q.new(), .18, 1.12, -.12), face: 1 },
    ];
    try {
      for (const pose of poses) {
        parts = 0;
        if (pose.id) {
          const matrix = M4.compose(M4.create(), V3.new(), pose.q, V3.new(1, 1, 1));
          const normal = M4.transformDir(V3.new(), matrix, V3.new(0, 0, pose.face));
          g.drawDynamic = () => g.rig.draw(R, scene, { pos: centre, q: pose.q, normal,
            activeFace: pose.face, hand: 'right', racket: pose.id });
          R.setCamera({ x: 0, y: centre.y + .08, z: centre.z + .75 }, centre, { x: 0, y: 1, z: 0 }, 48, .05, 60, 0);
        } else {
          g.drawDynamic = () => {};
          R.setCamera(pose.eye, { x: 0, y: .63, z: 0 }, { x: 0, y: 1, z: 0 }, 48, .05, 60, 0);
        }
        g.render();
        const p = projectPoint(R.viewProj, pose.id ? centre : { x: 0, y: PH.T_H, z: 0 }, {});
        const x = Math.max(0, Math.min(R._w - 16, Math.round(p.x * R._w) - 8));
        const y = Math.max(0, Math.min(R._h - 16, Math.round((1 - p.y) * R._h) - 8));
        const pixels = new Uint8Array(16 * 16 * 4); gl.readPixels(x, y, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const rgb = [0, 0, 0];
        for (let i = 0; i < pixels.length; i += 4) for (let channel = 0; channel < 3; channel++) rgb[channel] += pixels[i + channel] / 256;
        views.push({ name: pose.name, parts, expected: pose.id ? scene.rackets[pose.id].parts.length : 0,
          rgb, error: gl.getError(), png: capture ? g.canvas.toDataURL('image/png') : null });
      }
      const net = texNet(), context = net.getContext('2d');
      return { views, unchanged: physical() === before, quality: g.settings.quality,
        tape: Array.from(context.getImageData(512, 2, 1, 1).data), cord: Array.from(context.getImageData(512, 254, 1, 1).data) };
    } finally {
      R.draw = saved.draw; g.drawDynamic = saved.dynamic; g.drawFX = saved.fx; g.drawContactShadows = saved.shadows;
      g.updateCamera = saved.camera; g.paused = saved.paused; g.reducedMotion = saved.reduced;
      Object.assign(R.post, saved.post); M4.copy(R.view, saved.view); M4.copy(R.proj, saved.proj);
      M4.copy(R.viewProj, saved.vp); V3.copy(R.camPos, saved.eye);
      g.render();
    }
  }, !!captureDir);
  assert.equal(result.unchanged, true, 'view and model validation cannot change live gameplay');
  assert.ok(result.tape.slice(0, 3).every(channel => channel > 200) && result.tape[3] === 255, 'opaque white upper tape');
  assert.ok(result.cord.slice(0, 3).every(channel => channel < 30) && result.cord[3] > 200, 'black lower cord');
  for (const view of result.views) {
    assert.equal(view.error, 0, `${label}/${view.name}`); assert.equal(view.parts, view.expected, `${label}/${view.name}: imported geometry`);
    assert.ok(view.rgb.every(Number.isFinite) && view.rgb.some(channel => channel > 0), `${label}/${view.name}: finite visible pixels`);
    if (view.name.startsWith('pan-')) assert.ok(Math.max(...view.rgb) >= 14,
      `${label}/${view.name}: authored dark metal must remain readable, not a black silhouette: ${JSON.stringify(view.rgb)}`);
    if (captureDir) fs.writeFileSync(path.join(captureDir, `${label}-${view.name}.png`), Buffer.from(view.png.split(',')[1], 'base64'));
    delete view.png;
  }
  const red = result.views.find(view => view.name === 'standard-red'), black = result.views.find(view => view.name === 'standard-black');
  assert.ok(red.rgb[0] > red.rgb[1] * 1.2 && red.rgb[0] > red.rgb[2] * 1.2, `${label}: red rubber remains red: ${JSON.stringify(red.rgb)}`);
  assert.ok(red.rgb[0] > black.rgb[0] * 1.2, `${label}: opposite rubber faces remain distinct: ${JSON.stringify({red:red.rgb,black:black.rgb})}`);
  console.log(`ok: ${label} ${result.quality}, both table ends, red/black/edge paddle and pan bottom/edge: ${JSON.stringify(result.views)}`);
}

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
  const captureDir = process.env.TT_SCENE_CAPTURE ? path.resolve(process.env.TT_SCENE_CAPTURE) : null;
  if (captureDir) fs.mkdirSync(captureDir, { recursive: true });
  try {
    const pageUrl = pathToFileURL(appPage()).href;
    for (const [width, height, gl1] of [[640, 480, false], [390, 844, true]]) {
      const page = await browser.newPage();
      const errors = [], external = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', req => { if (/^https?:/.test(req.url())) external.push(req.url()); });
      await page.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
      await page.evaluateOnNewDocument(quality => localStorage.setItem('ttu-v2', JSON.stringify({ v: 10, quality, sfx: false })), gl1 ? 'low' : 'high');
      if (gl1) await page.evaluateOnNewDocument(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type === 'webgl2' ? null : getContext.call(this, type, ...args);
        };
      });
      const frame = await appFrame(page);
      await frame.waitForFunction(() => window.__game && window.__game.scene.hasPanorama, { timeout: 45000 });
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
        return { isGL2: R.isGL2, views, glError: gl.getError(), draws: R.drawCalls };
      });
      assert.equal(result.isGL2, !gl1, `WebGL version ${width}x${height}`);
      assert.equal(result.glError, 0, 'render produced a WebGL error');
      assert.ok(result.draws > 0);
      assert.ok(new Set(result.views.map(v => v.hash)).size > 2, 'the fixed environment changes during a 360° orbit');
      for (const [index, v] of result.views.entries()) {
        assert.ok(v.darkened > 30 && v.total > 0, `visible table shadow at angle ${index}: ${JSON.stringify(v)}`);
      }
      assert.deepEqual(external, [], 'the complete application must work offline');
      assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
      await inspectScene(frame, `scene-${width}x${height}-${gl1 ? 'gl1' : 'gl2'}`, captureDir);
      if (captureDir) await page.screenshot({ path: path.join(captureDir, `scene-${width}x${height}-shell.png`), fullPage: true });
      console.log(`ok: ${width}x${height}, ${gl1 ? 'WebGL1' : 'WebGL2'}, four orbit angles and visible shadows`);
      await page.close();
    }

    // The real hub owns readiness, the paddle-only exhibition and match transition.
    for (const [width, height, dpr, gl1, quality] of [[640, 480, 1, false, 'medium'], [390, 844, 3, false, 'high'], [390, 844, 1, true, 'low']]) {
      const lobby = await browser.newPage(), errors = [];
      lobby.on('pageerror', e => errors.push(e.message));
      await lobby.setViewport({ width, height, deviceScaleFactor: dpr, isMobile: width < 500, hasTouch: width < 500 });
      await lobby.evaluateOnNewDocument(quality => localStorage.setItem('ttu-v2', JSON.stringify({ v: 10, quality, sfx: false })), quality);
      if (gl1) await lobby.evaluateOnNewDocument(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type === 'webgl2' ? null : getContext.call(this, type, ...args);
        };
      });
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
        const racketMeshes = new Map();
        for (const [id, model] of Object.entries(g.scene.rackets))
          model.parts.forEach((part, index) => racketMeshes.set(part.mesh, { id, first: index === 0 }));
        let balls = 0, robotParts = 0, paddles = 0, racketParts = {};
        g.R.draw = (mesh, matrix, mat) => {
          if (mesh === g.scene.mesh.ball) balls++;
          if (mesh === g.scene.mesh.sphere || mesh === g.scene.mesh.capsule) robotParts++;
          const part = racketMeshes.get(mesh);
          if (part) {
            racketParts[part.id] = (racketParts[part.id] || 0) + 1;
            if (part.first) paddles++;
          } else if (mesh === g.scene.mesh.blade) paddles++;
          return draw(mesh, matrix, mat);
        };
        g.render = () => {
          balls = robotParts = paddles = 0; racketParts = {}; render();
          if (g.lobbyScene?.active) window.lobbyRenders.push({ phase: g.lobbyScene.phase,
            clock: g.lobbyScene.clock, balls, robotParts, paddles, racketParts,
            camera: Array.from(g.R.viewProj), x: g.project(g.ball.p, {}).x, y: g.project(g.ball.p, {}).y });
        };
      });
      const command = (type, data = {}) => lobby.evaluate(({ type, data }) => GameHost.send(type, data), { type, data });
      const waiting = await arena.evaluate(() => {
        const g = window.__game, c = g.lobbyScene;
        g.render();
        return { phase: c.phase, hits: c.hits, ready: c.readySent,
          settled: g.scene.panoramaSettled && g.scene.standsSettled && g.scene.racketsSettled,
          isGL2: g.R.isGL2, quality: g.settings.quality,
          error: g.R.gl.getError(), render: window.lobbyRenders.at(-1) };
      });
      assert.equal(waiting.phase, 'waiting'); assert.equal(waiting.hits, 0);
      assert.equal(waiting.ready && waiting.settled, true); assert.equal(waiting.error, 0);
      assert.equal(waiting.isGL2, !gl1); assert.equal(waiting.quality, quality);
      assert.equal(waiting.render.balls, 0); assert.equal(waiting.render.robotParts, 0);
      assert.equal(waiting.render.paddles, 2);
      assert.deepEqual(waiting.render.racketParts, { 'r-standard': 2 });
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
      for (const racket of ['r-pan', 'r-standard']) {
        await command('equip', { equipped: { racket } });
        const models = await arena.evaluate(() => {
          const g = window.__game; g.render();
          return { frame: window.lobbyRenders.at(-1), error: g.R.gl.getError(),
            parts: Object.fromEntries(Object.entries(g.scene.rackets).map(([id, model]) => [id, model.parts.length])) };
        });
        assert.equal(models.error, 0); assert.equal(models.frame.paddles, 2, 'model parts are not extra racket instances');
        assert.deepEqual(models.frame.racketParts, racket === 'r-pan'
          ? { 'r-pan': models.parts['r-pan'], 'r-standard': models.parts['r-standard'] }
          : { 'r-standard': 2 * models.parts['r-standard'] });
      }
      await lobby.evaluate(() => Router.go('match', { mode: 'instant' }));
      await lobby.waitForSelector('.mx.live', { timeout: 45000 });
      await command('match', { diff: 1, free: true }); await command('live');
      await arena.waitForFunction(() => window.__game.state !== 'MENU', { timeout: 10000 });
      const match = await arena.evaluate(() => {
        const g = window.__game; g.updateCamera(2); g.render();
        return { panorama: g.scene.hasPanorama, shadow: !!g.scene.tex.tableGroundShadow,
          lobby: g.lobbyScene.active, error: g.R.gl.getError() };
      });
      assert.deepEqual(match, { panorama: true, shadow: true, lobby: false, error: 0 });
      assert.deepEqual(errors, []);
      await inspectScene(arena, `hub-${width}x${height}-dpr${dpr}-${gl1 ? 'gl1' : 'gl2'}-${quality}`, captureDir);
      if (captureDir) await lobby.screenshot({ path: path.join(captureDir, `hub-${width}x${height}-dpr${dpr}-shell.png`), fullPage: true });
      console.log(`ok: ${width}x${height} DPR${dpr} ${gl1 ? 'WebGL1' : 'WebGL2'} ${quality}, production hub readiness/models/orbit/RM/match isolation`);
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
