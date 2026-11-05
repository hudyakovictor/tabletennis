const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/engine2d/engine.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

function fixture(options = {}, { width = 390, height = 844, motion = false, hidden = false, rm = false } = {}) {
  let now = 0, raf = 0, clears = 0, arcs = 0, ballDraws = 0;
  const listeners = [], events = [], timers = [], document = { hidden }, S = { quality: 'low', rm };
  const gradient = () => ({ addColorStop() {} });
  const ctx = new Proxy({
    clearRect() { clears++; },
    arc(x, y, radius) { assert.ok([x, y, radius].every(Number.isFinite) && radius >= 0); arcs++; },
    ellipse(x, y, rx, ry) { assert.ok([x, y, rx, ry].every(Number.isFinite) && rx >= 0 && ry >= 0); },
    createLinearGradient: gradient,
    createRadialGradient(x0, y0, r0, x1, y1, r1) { assert.ok([x0, y0, r0, x1, y1, r1].every(Number.isFinite) && r0 >= 0 && r1 >= 0); return gradient(); }
  }, { get: (obj, key) => obj[key] || (() => {}) });
  const cv = { getContext: () => ctx, getBoundingClientRect: () => ({ width, height }),
    addEventListener: type => listeners.push(type), removeEventListener() {} };
  const context = vm.createContext({ document, S, devicePixelRatio: 2,
    performance: { now: () => now }, requestAnimationFrame: () => ++raf, cancelAnimationFrame() {},
    window: { addEventListener: type => listeners.push(type), removeEventListener() {} },
    effectiveReducedMotion: () => motion, clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    lerp: (a, b, t) => a + (b - a) * t, rnd: (a, b) => (a + b) / 2,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; } });
  vm.runInContext(source + '\n;globalThis.Game2D = TT.Game;', context);
  const g = new context.Game2D(cv, { mode: 'demo', lobby: true, on: (...args) => events.push(args), ...options });
  const drawBall = g.drawBall;
  g.drawBall = function () { const previous = arcs; drawBall.call(this); if (arcs > previous) ballDraws++; };
  return { g, S, document, events, timers, listeners, clears: () => clears, ballDraws: () => ballDraws,
    motion: value => { motion = value; }, tick(ms = 16) { now += ms; g.loop(now); },
    ticks(n, ms = 16) { for (let i = 0; i < n; i++) { now += ms; g.loop(now); } } };
}

test('lobby readiness follows a real idle draw, with hidden ball and still bots', () => {
  const f = fixture(), { g } = f, ball = g.ball, ready = [];
  g.prepareLobby({ intro: true, requestId: 7, onReady: m => { assert.ok(f.clears() > 0); ready.push(plain(m)); } });
  assert.equal(ready.length, 0);
  const paddles = plain([g.pp, g.op]), camera = plain(g.cam);
  f.ticks(10);
  assert.deepEqual(ready, [{ type: 'lobbyReady', requestId: 7 }]);
  assert.equal(g.ball, ball); assert.equal(ball.live, false); assert.equal(f.ballDraws(), 0);
  assert.deepEqual(plain([g.pp, g.op]), paddles); assert.deepEqual(plain(g.cam), camera);
  assert.equal(g.dpr, 1.4); assert.equal(f.timers.length, 0);
});

for (const yaw of [-40, 40]) test(`same ball transfers to the projected left bot with yaw ${yaw}`, () => {
  const f = fixture({ cam: { yaw, swayAmp: .4 } }), { g } = f, ball = g.ball, camera = plain(g.cam);
  const frames = [], hits = [], bounces = new Map();
  g.prepareLobby({ intro: true, requestId: 11, onFrame(m) {
    assert.equal(g.ball, ball);
    const p = g.project(ball.x, ball.y, ball.z);
    close(m.x, p.x / g.W); close(m.y, p.y / g.H); close(m.diameter, .092 * p.s / g.W);
    if (!m.handoff) assert.equal(f.ballDraws(), 0);
    else assert.ok(f.ballDraws() > 0, 'the sphere must already be drawn in the handoff frame');
    frames.push(plain(m));
  }, onHit(m) {
    const P = m.side === 'p' ? g.pp : g.op;
    assert.equal(g.ball, ball); close(ball.x, P.x); close(ball.z, P.z);
    close(ball.y, m.side === 'p' ? -.3 : 3.04);
    hits.push({ message: plain(m), time: g.t });
  } });
  f.tick();
  const left = g.project(g.pp.x, -.3, g.pp.z).x < g.project(g.op.x, 3.04, g.op.z).x ? 'p' : 'o';
  assert.equal(left, yaw < 0 ? 'p' : 'o');
  assert.equal(g.launchLobby({ requestId: 10 }), false);
  assert.equal(g.launchLobby({ requestId: 11, x: .5, y: .48, diameter: .9 }), true);
  close(frames[0].x, .5); close(frames[0].y, .48); close(frames[0].diameter, .9);
  assert.equal(frames[0].progress, 0); assert.equal(frames[0].phase, 'flight');
  for (let i = 0; i < 85; i++) {
    f.tick();
    for (const mark of g.marks) bounces.set(mark.t, plain(mark));
  }
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].message, { type: 'lobbyHit', requestId: 11, side: left, first: true });
  assert.ok(hits[0].time >= 1.3 && hits[0].time < 1.33);
  assert.equal(bounces.size, 1);
  const bounce = [...bounces.values()][0];
  assert.ok(left === 'p' ? bounce.y < 1.37 : bounce.y > 1.37);
  assert.equal(frames.filter(m => m.handoff).length, 1);
  assert.ok(frames.at(-1).diameter * g.W <= 12);
  const frameCount = frames.length;
  f.ticks(300);
  assert.equal(frames.length, frameCount); assert.equal(hits.length, 1);
  assert.equal(g.ball, ball); assert.equal(ball.live, true); assert.ok(g.rally >= 5);
  assert.deepEqual(plain(g.cam), camera); assert.deepEqual(f.events, []); assert.equal(f.timers.length, 0);
});

test('plain exhibition starts without serve and resumes without reseeding on a later prepare', () => {
  const f = fixture(), { g } = f, ball = g.ball, contacts = [], lateral = new Set(), bounds = [];
  g.prepareLobby({ intro: false });
  assert.equal(ball.live, true); assert.equal(g.state, 'rally');
  const contact = g.lobbyContact;
  g.lobbyContact = function (side) { contacts.push(side); close(ball.x, side === 'p' ? g.pp.x : g.op.x); contact.call(this, side); };
  const drawRobot = g.drawRobot;
  g.drawRobot = function (P, y, col, far) {
    const inward = far ? -1 : 1, follow = Math.max(0, Math.min(1, 1 - (g.t - P.hitAt) / .42));
    const head = g.project(P.bodyX + P.lean, y - inward * .32 + inward * (.035 + follow * .07 - P.windup * .04), .83);
    bounds.push([head.x - head.s * .15, head.x + head.s * .15, head.y - head.s * .135, head.y + head.s * .135]);
    drawRobot.call(this, P, y, col, far);
  };
  f.ticks(1500);
  assert.ok(contacts.length >= 18); assert.deepEqual([...new Set(contacts)].sort(), ['o', 'p']);
  assert.ok(bounds.every(([left, right, top, bottom]) => left >= 0 && right <= g.W && top >= 0 && bottom <= g.H), 'both robot heads stay fully visible throughout the rally');
  assert.deepEqual(f.events, []); assert.equal(f.timers.length, 0); assert.equal(g.ball, ball);
  const position = plain(ball);
  g.prepareLobby({ requestId: 22, intro: false });
  assert.deepEqual(plain(ball), position);
  for (let i = 0; i < 60; i++) { f.tick(); lateral.add(g.pp.bodyX.toFixed(3)); }
  assert.ok(lateral.size > 10); assert.equal(f.timers.length, 0);
});

for (const preference of [{ motion: true }, { rm: true }, { hidden: true }]) {
  test(`quiet lobby skips incoming flight and remains stationary: ${JSON.stringify(preference)}`, () => {
    const f = fixture({ cam: { swayAmp: .4 } }, preference), { g } = f, ball = g.ball, messages = [];
    g.prepareLobby({ requestId: 3, intro: true, onFrame: m => messages.push(plain(m)), onHit: m => messages.push(plain(m)) });
    f.tick();
    assert.equal(g.launchLobby({ requestId: 3, x: .5, y: .48, diameter: .9 }), true);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].type, 'lobbyFrame'); assert.equal(messages[0].handoff, true);
    assert.equal(messages[0].phase, 'rally'); assert.equal(messages[0].progress, 1);
    assert.deepEqual(messages[1], { type: 'lobbyHit', requestId: 3, side: 'p', first: true });
    assert.ok(f.ballDraws() > 0);
    const position = plain(ball), camera = plain(g.cam), bots = plain([g.pp, g.op]);
    f.ticks(120);
    assert.equal(g.ball, ball); assert.deepEqual(plain(ball), position); assert.deepEqual(plain(g.cam), camera);
    assert.deepEqual(plain([g.pp, g.op]), bots); assert.equal(messages.length, 2);
  });
}

test('changing motion preference during a paused flight completes handoff, then resumes from the staged ball', () => {
  const f = fixture(), { g } = f, messages = [];
  g.prepareLobby({ intro: true, onFrame: m => messages.push(plain(m)), onHit: m => messages.push(plain(m)) });
  f.tick(); g.launchLobby(); f.ticks(10); g.paused = true; f.motion(true); f.tick();
  assert.equal(messages.at(-2).handoff, true); assert.equal(messages.at(-1).type, 'lobbyHit');
  const position = plain(g.ball); f.ticks(10); assert.deepEqual(plain(g.ball), position);
  f.motion(false); g.paused = false; f.tick(); assert.notEqual(g.ball.y, position.y);
  const count = messages.length; g.destroy(); f.ticks(10); assert.equal(messages.length, count);
});

test('ordinary play and legacy demo retain their camera, scoring, serve and motion semantics', () => {
  for (const mode of ['play', 'demo']) {
    const f = fixture({ mode, lobby: mode === 'play', cam: { swayAmp: .3 } }, { motion: true, rm: true, hidden: true });
    const { g } = f;
    assert.equal(g.lobby, false); assert.equal(g.cam.y, -1.05); assert.equal(g.cam.pitch, 36); assert.equal(g.F, g.W * 1.02);
    const position = plain(g.ball);
    assert.equal(g.prepareLobby({ intro: true }), false); assert.equal(g.launchLobby(), false);
    assert.deepEqual(plain(g.ball), position);
    g.serve('p'); assert.equal(g.state, 'serve-p');
    g.serve('o'); assert.equal(g.state, 'serve-o'); assert.equal(f.timers[0].ms, mode === 'demo' ? 500 : 850);
    Object.assign(g.ball, { live: true, y: .5, z: -.8, vx: 0, vy: 0, vz: -1, by: 'o', bounced: 'p' });
    g.state = 'rally'; g.step(.001, .001);
    assert.equal(g.state, 'over'); assert.equal(f.events.at(-1)[0], 'point');
    f.tick(); assert.ok(g.cam.sway > 0, 'lobby motion preferences must not change legacy camera motion');
    assert.equal(f.listeners.includes('pointerdown'), mode === 'play');
  }
});

test('real Chromium draws robots and ball transfer on portrait and landscape canvases', async t => {
  const { launchBrowser } = require('./shell-fixture.cjs');
  const browser = await launchBrowser(); t.after(() => browser.close());
  const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<body style="margin:0;background:#10182e"><canvas id="lobby" style="width:390px;height:844px"></canvas></body>');
  await page.addScriptTag({ content: `const S = { quality: 'low', rm: false };
    const clamp = (v,a,b) => Math.max(a, Math.min(b,v)), lerp = (a,b,t) => a+(b-a)*t, rnd = (a,b) => (a+b)/2;
    const effectiveReducedMotion = () => S.rm; requestAnimationFrame = () => 1; cancelAnimationFrame = () => {};
    ${source}\nwindow.Game2D = TT.Game;` });
  const result = await page.evaluate(() => {
    const reports = [], canvas = document.querySelector('canvas');
    for (const [width, height] of [[390, 844], [844, 390]]) {
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      const g = new Game2D(canvas, { mode: 'demo', lobby: true }), ball = g.ball, frames = [], hits = [], robots = [];
      const drawRobot = g.drawRobot; g.drawRobot = function (P, y, col, far) { robots.push(y); drawRobot.call(this, P, y, col, far); };
      g.prepareLobby({ intro: true, requestId: 9, onFrame: m => frames.push(m), onHit: m => hits.push(m) }); g.draw();
      g.launchLobby({ requestId: 9, x: .5, y: .48, diameter: .9 });
      let now = g.last;
      for (let i = 0; i < 100; i++) { now += 16; g.loop(now); }
      const image = g.ctx.getImageData(0, 0, canvas.width, canvas.height);
      reports.push({ width, same: g.ball === ball, first: frames[0], last: frames.at(-1), hits,
        robots: [...new Set(robots)], painted: image.data.some((v, i) => i % 4 === 3 && v > 0) });
      g.destroy();
    }
    return reports;
  });
  assert.deepEqual(errors, []);
  for (const report of result) {
    assert.equal(report.same, true); assert.equal(report.painted, true); assert.equal(report.hits.length, 1);
    close(report.first.x, .5); close(report.first.y, .48); close(report.first.diameter, .9);
    assert.equal(report.last.handoff, true); assert.ok(report.last.diameter * report.width <= 12);
    assert.deepEqual(report.robots.sort((a, b) => a - b), [-.3, 3.04]);
  }
  if (process.env.LOBBY2D_SCREENSHOT) {
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas'); canvas.style.width = '390px'; canvas.style.height = '844px';
      const g = new Game2D(canvas, { mode: 'demo', lobby: true }); g.prepareLobby({ intro: false });
      let now = g.last; for (let i = 0; i < 500; i++) { now += 16; g.loop(now); } g.destroy();
    });
    await page.screenshot({ path: process.env.LOBBY2D_SCREENSHOT });
  }
});
