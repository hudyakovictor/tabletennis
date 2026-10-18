/* Renders the blade in a set of authored postures and saves a cropped PNG of
 * each, so the tilt can be looked at rather than only measured.
 * node tt/tools/_posesnap.js [outdir] */
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const zlib = require('node:zlib'); const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core'); const chromium = require('@sparticuz/chromium');
const root = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(os.homedir(), 'shots'));

const CASES = [
  ['01-right-hand-forehand-side', 'right', { x: .93, y: .55 }, null],
  ['02-right-hand-backhand-side', 'right', { x: .07, y: .55 }, null],
  ['03-left-hand-at-right',       'left',  { x: .93, y: .55 }, null],
  ['04-left-hand-at-left',        'left',  { x: .07, y: .55 }, null],
  ['05-lean-in-face-closes',      'right', { x: .50, y: .04 }, null],
  ['06-sit-back-face-opens',      'right', { x: .50, y: .96 }, null],
  ['07-button-down-cocks',        'right', { x: .70, y: .45 }, 'press'],
  ['08-contact-snap',             'right', { x: .70, y: .45 }, 'strike'],
  ['09-ready',                    'right', { x: .50, y: .55 }, null],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux') {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 700, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(pathToFileURL(path.join(root, 'play/index.html')).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
  /* The brand splash is a full-screen overlay until dismissed; without this
     every shot is a picture of a logo on black. */
  await page.evaluate(() => {
    const l = document.getElementById('loading'); if (l) l.classList.add('off');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  });

  const report = [];
  for (const [name, hand, ptr, act] of CASES) {
    const info = await page.evaluate((hand, ptr, act) => {
      const g = window.__game;
      g.paused = true;
      g.settings.hand = hand;
      g.startMatch(2);
      g.ball.live = false; g.recenterT = 0; g.swipe.cancel(); g.camVPReady = false;
      g.settings.showTrail = false;
      /* hide the 2-D HUD so only the arena and the blade are in the shot */
      document.body.classList.add('is-playing');
      const l = document.getElementById('loading'); if (l) l.classList.add('off');
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
      for (const id of ['hud', 'topbar', 'msgs', 'dbg', 'spin', 'slow', 'gestureCue', 'timingCue']) {
        const el = document.getElementById(id); if (el) el.style.display = 'none';
      }
      g.pointer = { x: ptr.x, y: ptr.y };
      g.pointerDown = false;
      for (let i = 0; i < 150; i++) g.updatePlayerPaddle(1 / 60);
      if (act === 'press') {
        g.pointerDown = true; g.swipe.down(ptr.x, ptr.y, g.time);
        for (let i = 0; i < 12; i++) g.updatePlayerPaddle(1 / 60);
      } else if (act === 'strike') {
        g.pointerDown = true; g.swipe.down(ptr.x, ptr.y, g.time);
        for (let i = 0; i < 12; i++) g.updatePlayerPaddle(1 / 60);
        g.pose.strike(1.2); g.player.swing = 1;
        g.pointerDown = false;
        for (let i = 0; i < 3; i++) g.updatePlayerPaddle(1 / 60);
      }
      const s = g.project(g.player.pos, {});
      for (let i = 0; i < 4; i++) g.render();
      const rig = g.rig;
      const q = rig.paddleQuat(Q.new(), g.player.normal, hand, g.player.swing, g.player.roll || 0);
      const m = M4.compose(M4.create(), V3.new(), q, V3.new(1, 1, 1));
      const h = M4.transformDir(V3.new(), m, V3.new(0, -1, 0));
      return {
        sx: s.x, sy: s.y,
        pitch: +(g.pose.pitch * 180 / Math.PI).toFixed(1),
        yaw: +(g.pose.yaw * 180 / Math.PI).toFixed(1),
        roll: +(g.pose.roll * 180 / Math.PI).toFixed(1),
        handleTilt: +(Math.atan2(-h.x, -h.y) * 180 / Math.PI).toFixed(1),
        press: +g.pose.press.toFixed(2), snap: +g.pose.snap.toFixed(2),
        W: window.innerWidth, H: window.innerHeight,
      };
    }, hand, ptr, act);

    const w = 300, hgt = 300;
    const clip = {
      x: Math.max(0, Math.min(info.W - w, info.sx * info.W - w / 2)),
      y: Math.max(0, Math.min(info.H - hgt, info.sy * info.H - hgt / 2)),
      width: w, height: hgt,
    };
    const file = path.join(OUT, name + '.png');
    await page.screenshot({ path: file, clip });
    report.push({ name, file, ...info });
    console.log(`${name.padEnd(30)} pitch ${String(info.pitch).padStart(6)}° yaw ${String(info.yaw).padStart(6)}° `
      + `poseRoll ${String(info.roll).padStart(6)}°  handle ${String(info.handleTilt).padStart(6)}° `
      + `press ${info.press} snap ${info.snap}`);
  }
  await page.evaluate(() => { window.__game.returnToMenu(); });
  await browser.close();
  console.log('\nwrote ' + report.length + ' images to ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
