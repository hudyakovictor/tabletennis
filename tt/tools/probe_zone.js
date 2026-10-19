/* Temporary probe (kept as a research tool): how much of the screen can
 * actually serve, and where a return is accepted. Mirrors how
 * tests/browser.cjs drives a real page, but with real time instead of a
 * frozen RAF, because every setState un-pauses the game by design.
 *
 *   node tt/tools/probe_zone.js serve        # grid, desktop
 *   node tt/tools/probe_zone.js serve-touch  # grid, phone viewport
 *   node tt/tools/probe_zone.js return       # where is a return accepted?
 */
const path = require('path');
const os = require('os');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const root = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (!fs.existsSync(path.join(libs, 'lib'))) {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  });
  const mode = process.argv[2] || 'serve';
  const [width, height] = mode.endsWith('touch') ? [390, 844] : [1280, 760];
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: width < 600, hasTouch: width < 600 });
  page.on('pageerror', e => console.log('PAGEERR', e.message));
  await page.goto(pathToFileURL(path.join(root, 'play/index.html')).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
  if (mode === 'map') {
    const [mw, mh] = (process.env.TMAP_SIZE || '1280x760').split('x').map(Number);
    await page.setViewport({ width: mw, height: mh, isMobile: mw < 600, hasTouch: mw < 600 });
    await page.evaluate(() => { window.__game.startMatch(2); });
    await sleep(400);
    const stats = await page.evaluate(() => {
      const g = window.__game;
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
      const rect = g.canvas.getBoundingClientRect();
      const rows = 24, cols = 32;
      const cells = rows * cols;
      const at = (radius, serving) => {
        let inSide = 0;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const nx = (c + 0.5) / cols, ny = (r + 0.5) / rows;
          const ball = pressHitZone(g.project(g.ball.p), { x: nx, y: ny }, rect.width, rect.height, radius);
          const pad = pressHitZone(g.project(g.player.pos), { x: nx, y: ny }, rect.width, rect.height, radius);
          if ((ball && ball.accepted) || (pad && pad.accepted)) inSide++;
        }
        return inSide;
      };
      /* The rally gate is not a static disc: pressAdmitsBall() re-tests while
       * the gesture lives, so the admitted set is the ball's whole flight
       * corridor. Measured over the predicted path, not one frozen instant. */
      const corridor = (radius) => {
        const rep = {}; const path = [];
        predict(V3.clone(g.ball.p), V3.clone(g.ball.v), V3.clone(g.ball.w),
          { dt: 1 / 120, maxT: 0.6, out: rep, path });
        let inSide = 0;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const nx = (c + 0.5) / cols, ny = (r + 0.5) / rows;
          let hit = false;
          for (let i = 0; i + 2 < path.length; i += 3) {
            const p = project0({ x: path[i], y: path[i + 1], z: path[i + 2] });
            if (!p || !p.ok) continue;
            if (Math.hypot((p.x - nx) * rect.width, (p.y - ny) * rect.height) <= radius) { hit = true; break; }
          }
          if (hit) inSide++;
        }
        return inSide;
      };
      const project0 = (v) => g.project(v, {});
      const out = {};
      // rally pose: the bat at the end line, a ball arriving mid-half
      g.setState(GS.RALLY);
      V3.set(g.player.pos, 0, PH.TABLE_Y + 0.62, 1.78);
      V3.set(g.ball.p, 0, PH.TABLE_Y + 0.34, 1.0);
      out.rallyOld = at(72, false);
      out.rallyCorridor72 = corridor(72);
      out.rallyCorridor168 = corridor(168);
      // serve pose: ball resting in front of the bat, mid-toss included
      g.setState(GS.SERVE_READY); g.server = 1; g.recenterT = 0;
      V3.set(g.player.pos, 0, PH.TABLE_Y + 0.62, 1.78);
      V3.set(g.ball.p, 0, PH.TABLE_Y + 0.14, 1.74);
      out.serveOld = at(72, true);
      out.serveNew = at(MATCH_RULES.servePressRadiusPx, true);
      out.total = cells;
      out.pressRadius = MATCH_RULES.pressRadiusPx;
      out.serveRadius = MATCH_RULES.servePressRadiusPx;
      return out;
    });
    console.log(JSON.stringify(stats));
    console.log(`serve admission: ${stats.serveOld}/${stats.total} cells at ${stats.pressRadius} px →`
      + ` ${stats.serveNew}/${stats.total} at ${stats.serveRadius} px`
      + ` (${(100 * stats.serveOld / stats.total).toFixed(1)}% → ${(100 * stats.serveNew / stats.total).toFixed(1)}%)`);
    console.log(`rally admission, frozen instant: ${stats.rallyOld}/${stats.total} cells (${(100 * stats.rallyOld / stats.total).toFixed(1)}%)`);
    console.log(`rally admission, along the ball's path: ${stats.rallyCorridor72}/${stats.total} at 72 px`
      + `, ${stats.rallyCorridor168}/${stats.total} at 168 px`);
    await browser.close();
    return;
  }
  await page.click('#play');
  await sleep(600);

  await page.evaluate((kind) => {
    // A clean state with the bat parked at the serving pose, no screen over
    // the canvas, and a fresh gesture journal.
    window.__setup = (zBall) => {
      const g = window.__game;
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
      document.body.classList.add('is-playing');
      g.demoMode = false;
      if (kind === 'serve') {
        g.server = 1;
        g.setState(GS.SERVE_READY);
        g.recenterT = 0;
        V3.set(g.player.pos, 0, PH.TABLE_Y + 0.62, 1.78);
        V3.set(g.ball.v, 0, 0, 0);
        g.ball.live = false; g.ball.lastHitBy = 0;
        g.isServeBall = true; g.serveBounces = 0;
      } else {
        g.setState(GS.RALLY);
        g.recenterT = 0;
        g.isServeBall = false; g.serveBounces = 0;
        V3.set(g.player.pos, 0, PH.TABLE_Y + 0.62, 1.78);
        g.rallyBounces.length = 0; g.rallyBounces.push(1);   // it bounced on my half
        g.ball.lastHitBy = -1; g.ball.live = true;
        V3.set(g.ball.p, 0, PH.TABLE_Y + 0.34, 0.55);        // incoming drive
        V3.set(g.ball.v, 0, -0.35, 6.4);
        V3.zero(g.ball.w);
        g.player.lastHitT = g.time - 1;
      }
      V3.copy(g.player.prevPos, g.player.pos); V3.copy(g.player.prev, g.player.pos);
      g.netTouched = false;
      g.swipe.cancel(); g.swipeReleasedAt = -Infinity; g.swipe.lastReleased = null;
      g.pointerDown = false;
      g.shotJournal.reset();
    };
  }, mode === 'return' ? 'return' : 'serve');

  const rows = +(process.argv[3] || 6), cols = +(process.argv[4] || 6), out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols * width, y = (r + 0.5) / rows * height;
      await page.evaluate(() => window.__setup());
      await page.mouse.move(x, y);
      await page.mouse.down();          // the press: this is what is gated
      if (mode === 'serve') await sleep(400);   // the toss rises
      await page.mouse.move(x, y - 55, { steps: 3 });
      await sleep(60);
      await page.mouse.move(x, y - 115, { steps: 3 });
      await page.mouse.up();
      await sleep(mode === 'serve' ? 700 : 260);
      const res = await page.evaluate(() => {
        const g = window.__game;
        const e = g.shotJournal.latest || {};
        const c0 = e.contact;
        return { struck: g.ball.lastHitBy === 1, outcome: e.outcome || '-',
          stroke: e.strokeId || '-',
          accepted: !!(g.swipe.pressZone && g.swipe.pressZone.accepted),
          dist: e.pressZone && Number.isFinite(e.pressZone.distancePx) ? Math.round(e.pressZone.distancePx) : null,
          contactZ: c0 ? +c0.p[2].toFixed(2) : null,
          contactY: c0 ? +(c0.p[1] - PH.TABLE_Y).toFixed(2) : null,
          batZ: +g.player.pos.z.toFixed(2),
        };
      });
      out.push({ cell: `${c},${r}`, px: +(x / width).toFixed(2), py: +(y / height).toFixed(2), ...res });
    }
  }
  const ok = out.filter(o => o.struck).length;
  console.log(`${mode.toUpperCase()} grid ${cols}x${rows} @${width}x${height}: struck ${ok}/${out.length}`
    + `  (table half-length = 1.375 m, end line is z=1.375)`);
  console.log(out.map(o => o.struck ? 'X' : (o.outcome === 'outside' ? 'o' : '.')).join('')
    .replace(new RegExp(`.{${cols}}`, 'g'), '$&\n'));
  for (const o of out) console.log(JSON.stringify(o));
  await browser.close();
})();
