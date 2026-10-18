/* Diagnostic bench for the racket pose.
 *
 * Measures, in a real Chromium with the real bundle:
 *   1. held postures  — park the bat left/right/forward/back and read the face
 *   2. motion         — sweep the mouse in each of the four directions
 *   3. the click      — press and hold the left button, no travel at all
 *   4. the contact    — the wrist snap and the follow-through it decays into
 *   5. the mirror     — a right-hander reaching right must be the exact
 *      reflection of a left-hander reaching left, and BOTH must differ from
 *      the same hand reaching the other way
 *   6. handedness     — lefty and righty at the SAME world x must not match
 *
 * node tt/tools/_pose.js
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const root = path.resolve(__dirname, '../..');

const D = 180 / Math.PI;
const pad = (s, n) => String(s).padStart(n);

(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux') {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(pathToFileURL(path.join(root, 'play/index.html')).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);

  const out = await page.evaluate(() => {
    const g = window.__game, DEG = 180 / Math.PI;
    g.paused = true;

    const read = (pose, normal) => ({
      pitch: +(pose.pitch * DEG).toFixed(1),
      yaw: +(pose.yaw * DEG).toFixed(1),
      roll: +(pose.roll * DEG).toFixed(1),
      rollW: +(pose.rollWorld * DEG).toFixed(1),
      nx: +normal.x.toFixed(3), ny: +normal.y.toFixed(3), nz: +normal.z.toFixed(3),
      press: +pose.press.toFixed(2), snap: +pose.snap.toFixed(2),
    });

    /* ---------- module level: drive RacketPose directly ---------- */
    const box = { xLimit: 1.02, zIn: 1.02, zOut: 2.06, yLo: PH.TABLE_Y - 0.24, yHi: PH.TABLE_Y + 0.94 };
    const home = new RacketPose({ hand: 'right', side: 1 }).home;
    const mk = (hand, side) => new RacketPose({
      hand, side,
      home: side > 0 ? home : { x: 0, y: home.y, z: -home.z },
    });
    /* Hold a pose for 1.5 s so the smoothing has settled, then read it. */
    const hold = (pose, o, seconds) => {
      const n = Math.round((seconds || 1.5) * 120);
      for (let i = 0; i < n; i++) pose.update(1 / 120, o);
      return read(pose, pose.normal);
    };
    const at = (pose, x, y, z, extra) => Object.assign({
      x, y, z, vx: 0, vz: 0, pressing: false, followThrough: true,
    }, box, extra || {});

    const mod = { home: JSON.parse(JSON.stringify(home)), holds: {}, motion: {}, mirror: {} };

    for (const hand of ['right', 'left']) {
      const p = mk(hand, 1);
      mod.holds[hand] = {
        centre: hold(p, at(p, 0, home.y, home.z)),
        right: hold(p, at(p, +0.85, home.y, home.z)),
        left: hold(p, at(p, -0.85, home.y, home.z)),
        forward: hold(p, at(p, 0, home.y, 1.02)),
        back: hold(p, at(p, 0, home.y, 2.06)),
        high: hold(p, at(p, 0, PH.TABLE_Y + 0.90, home.z)),
        low: hold(p, at(p, 0, PH.TABLE_Y - 0.20, home.z)),
        rightFwd: hold(p, at(p, +0.85, home.y + 0.30, 1.02)),
        leftBack: hold(p, at(p, -0.85, home.y - 0.20, 2.06)),
      };
    }

    /* motion: how far the blade travels while the hand is actually moving */
    for (const hand of ['right', 'left']) {
      const p = mk(hand, 1);
      hold(p, at(p, 0, home.y, home.z));
      /* Peak of the SIGNED angle, in degrees, over the sweep. The comparison
       * has to be in the same units on both sides: an earlier version of this
       * bench compared radians against degrees and froze on the first sample. */
      const sweep = (o, frames) => {
        const peak = { pitch: 0, yaw: 0, roll: 0 };
        for (let i = 0; i < (frames || 40); i++) {
          p.update(1 / 120, o);
          const d = { pitch: p.pitch * DEG, yaw: p.yaw * DEG, roll: p.roll * DEG };
          for (const k in peak) if (Math.abs(d[k]) > Math.abs(peak[k])) peak[k] = +d[k].toFixed(1);
        }
        return peak;
      };
      mod.motion[hand] = {
        mouseRight: sweep(at(p, 0, home.y, home.z, { vx: 3.2, vz: 0, ptrX: 0.5, ptrY: 0.55 })),
        mouseLeft: sweep(at(p, 0, home.y, home.z, { vx: -3.2, vz: 0, ptrX: 0.5, ptrY: 0.55 })),
        mouseForward: sweep(at(p, 0, home.y, home.z, { vx: 0, vz: -2.4, ptrX: 0.5, ptrY: 0.55 })),
        mouseBack: sweep(at(p, 0, home.y, home.z, { vx: 0, vz: 2.4, ptrX: 0.5, ptrY: 0.55 })),
      };
      /* the raw pointer, with the bat pinned at the edge of its box: the
       * wrist must keep cocking after the arm has run out of reach */
      const q = mk(hand, 1);
      hold(q, at(q, 0, home.y, home.z));
      let px = 0.5, peak = 0;
      for (let i = 0; i < 90; i++) {
        px = Math.min(1.6, px + 0.02);
        q.update(1 / 120, at(q, 1.02, home.y, home.z, { vx: 0, vz: 0, ptrX: px, ptrY: 0.55 }));
        peak = Math.max(peak, Math.abs(q.yaw));
      }
      mod.motion[hand].ptrAtBoxEdgeYaw = +(peak * DEG).toFixed(1);
      let py = 0.55, peakP = 0;
      const r = mk(hand, 1); hold(r, at(r, 0, home.y, home.z));
      for (let i = 0; i < 90; i++) {
        py = Math.max(-0.6, py - 0.02);
        r.update(1 / 120, at(r, 0, home.y, home.z, { vx: 0, vz: 0, ptrX: 0.5, ptrY: py }));
        peakP = Math.max(peakP, Math.abs(r.pitch));
      }
      mod.motion[hand].ptrForwardPitch = +(peakP * DEG).toFixed(1);
    }

    /* press + contact */
    const pr = mk('right', 1); hold(pr, at(pr, 0.6, home.y, home.z));
    const before = read(pr, pr.normal);
    for (let i = 0; i < 8; i++) pr.update(1 / 120, at(pr, 0.6, home.y, home.z, { pressing: true }));
    const cocked = read(pr, pr.normal);
    pr.strike(1);
    for (let i = 0; i < 2; i++) pr.update(1 / 120, at(pr, 0.6, home.y, home.z));
    const snapped = read(pr, pr.normal);
    for (let i = 0; i < 40; i++) pr.update(1 / 120, at(pr, 0.6, home.y, home.z));
    const settled = read(pr, pr.normal);
    mod.press = { before, cocked, snapped, settled };

    /* mirror: righty reaching RIGHT  vs  lefty reaching LEFT */
    const rM = mk('right', 1), lM = mk('left', 1);
    const A = hold(rM, at(rM, +0.85, home.y, home.z));
    const B = hold(lM, at(lM, -0.85, home.y, home.z));
    mod.mirror.rightyRight = A;
    mod.mirror.leftyLeft = B;
    mod.mirror.mirrorOk = (Math.abs(A.pitch - B.pitch) < 0.05 && Math.abs(A.yaw + B.yaw) < 0.05
      && Math.abs(A.roll + B.roll) < 0.05 && Math.abs(A.nx + B.nx) < 0.002);
    /* handedness at the SAME world x must NOT match */
    const rS = mk('right', 1), lS = mk('left', 1);
    mod.mirror.rightyAtRight = hold(rS, at(rS, +0.85, home.y, home.z));
    mod.mirror.leftyAtRight = hold(lS, at(lS, +0.85, home.y, home.z));

    /* the far side of the table (side -1) must mirror in world z, not x */
    const far = mk('left', -1);
    mod.mirror.farSideHome = hold(far, { x: 0, y: home.y, z: -1.44, vx: 0, vz: 0, pressing: false,
      followThrough: true, xLimit: 1.02, zIn: -1.05, zOut: -2.5, yLo: box.yLo, yHi: box.yHi });
    mod.mirror.farSideLeanIn = hold(far, { x: 0, y: home.y, z: -1.05, vx: 0, vz: 0, pressing: false,
      followThrough: true, xLimit: 1.02, zIn: -1.05, zOut: -2.5, yLo: box.yLo, yHi: box.yHi });

    /* ---------- game level: the real pointer path ---------- */
    const game = {};
    const runGame = (hand, ptrs, framesEach) => {
      g.settings.hand = hand;
      g.startMatch(2); g.ball.live = false; g.recenterT = 0; g.swipe.cancel(); g.camVPReady = false;
      g.pointer = { x: 0.5, y: 0.55 };
      for (let i = 0; i < 90; i++) g.updatePlayerPaddle(1 / 60);
      const rest = read(g.pose, g.player.normal);
      for (const [x, y] of ptrs) {
        g.pointer = { x, y };
        for (let i = 0; i < (framesEach || 45); i++) g.updatePlayerPaddle(1 / 60);
      }
      return { rest, end: read(g.pose, g.player.normal), batX: +g.player.pos.x.toFixed(3), batZ: +g.player.pos.z.toFixed(3) };
    };
    for (const hand of ['right', 'left']) {
      for (const [label, x, y] of [['centre', .5, .55], ['right', .92, .55], ['left', .08, .55],
                                    ['forward', .5, .20], ['back', .5, .90],
                                    ['rightFwd', .92, .20], ['leftBack', .08, .90]]) {
        game[hand + '/' + label] = runGame(hand, [[x, y]]);
      }
    }

    /* game level, while the mouse is actually MOVING: the peak tilt seen
     * during a sweep is what the player perceives, the held value is not. */
    const sweepGame = (hand, from, to, steps) => {
      g.settings.hand = hand;
      g.startMatch(2); g.ball.live = false; g.recenterT = 0; g.swipe.cancel(); g.camVPReady = false;
      g.pointer = { x: 0.5, y: 0.55 };
      for (let i = 0; i < 90; i++) g.updatePlayerPaddle(1 / 60);
      const peak = { pitch: 0, yaw: 0, roll: 0 };
      for (let i = 1; i <= steps; i++) {
        g.pointer = { x: from[0] + (to[0] - from[0]) * i / steps, y: from[1] + (to[1] - from[1]) * i / steps };
        g.updatePlayerPaddle(1 / 60);
        const d = { pitch: g.pose.pitch * DEG, yaw: g.pose.yaw * DEG, roll: g.pose.roll * DEG };
        for (const k in peak) if (Math.abs(d[k]) > Math.abs(peak[k])) peak[k] = +d[k].toFixed(1);
      }
      /* and where it comes back to once the hand stops */
      for (let i = 0; i < 90; i++) g.updatePlayerPaddle(1 / 60);
      return { peak, held: read(g.pose, g.player.normal) };
    };
    for (const hand of ['right', 'left']) {
      game[hand + '/sweepRight'] = sweepGame(hand, [.5, .55], [1.0, .55], 8);
      game[hand + '/sweepLeft'] = sweepGame(hand, [.5, .55], [0.0, .55], 8);
      game[hand + '/sweepForward'] = sweepGame(hand, [.5, .60], [.5, .02], 8);
      game[hand + '/sweepBack'] = sweepGame(hand, [.5, .40], [.5, .98], 8);
    }

    /* the click, through the real input path */
    g.settings.hand = 'right';
    g.startMatch(2); g.ball.live = false; g.recenterT = 0; g.swipe.cancel(); g.camVPReady = false;
    g.pointer = { x: .5, y: .55 }; g.pointerDown = false;
    for (let i = 0; i < 90; i++) g.updatePlayerPaddle(1 / 60);
    const click = { rest: read(g.pose, g.player.normal) };
    g.pointerDown = true; g.swipe.down(.62, .55, g.time);
    for (let i = 0; i < 8; i++) g.updatePlayerPaddle(1 / 60);
    click.down = read(g.pose, g.player.normal);
    g.pointerDown = false; g.swipe.cancel();
    for (let i = 0; i < 60; i++) g.updatePlayerPaddle(1 / 60);
    click.up = read(g.pose, g.player.normal);
    game['right/click'] = click;

    g.settings.hand = 'right';
    g.returnToMenu();
    return { mod, game };
  });

  const line = (name, p) => `${name.padEnd(22)} pitch ${pad(p.pitch, 6)}°  yaw ${pad(p.yaw, 6)}°  roll ${pad(p.roll, 6)}°  n(${pad(p.nx, 6)},${pad(p.ny, 6)},${pad(p.nz, 6)})`;
  const peak = (name, p) => `${name.padEnd(22)} peak pitch ${pad(p.pitch, 6)}°  yaw ${pad(p.yaw, 6)}°  roll ${pad(p.roll, 6)}°`;

  console.log('\n=== 1. HELD POSTURE (module level, settled) ===');
  for (const hand of ['right', 'left']) {
    console.log(`-- ${hand}-handed, near side --`);
    for (const k of Object.keys(out.mod.holds[hand])) console.log(line(k, out.mod.holds[hand][k]));
  }

  console.log('\n=== 2. MOUSE MOTION (peak during a 0.2 s sweep) ===');
  for (const hand of ['right', 'left']) {
    console.log(`-- ${hand}-handed --`);
    for (const k of Object.keys(out.mod.motion[hand])) {
      const v = out.mod.motion[hand][k];
      if (typeof v === 'object') console.log(peak(k, v));
      else console.log(`${k.padEnd(22)} ${pad(v, 6)}°`);
    }
  }

  console.log('\n=== 3/4. THE CLICK AND THE CONTACT (right hand, bat at x=+0.60) ===');
  for (const k of ['before', 'cocked', 'snapped', 'settled']) {
    const p = out.mod.press[k];
    console.log(line(k, p) + `   press ${pad(p.press, 4)} snap ${pad(p.snap, 4)}`);
  }

  console.log('\n=== 5/6. MIRROR + HANDEDNESS ===');
  console.log(line('righty reach RIGHT', out.mod.mirror.rightyRight));
  console.log(line('lefty reach LEFT', out.mod.mirror.leftyLeft));
  console.log('mirror exact (pitch=, yaw/roll sign-flipped):', out.mod.mirror.mirrorOk);
  console.log(line('righty at x=+0.85', out.mod.mirror.rightyAtRight));
  console.log(line('lefty at x=+0.85', out.mod.mirror.leftyAtRight));
  console.log(line('far side home', out.mod.mirror.farSideHome));
  console.log(line('far side lean in', out.mod.mirror.farSideLeanIn));

  console.log('\n=== 7. GAME LEVEL, through the real pointer mapping ===');
  for (const k of Object.keys(out.game)) {
    const v = out.game[k];
    if (v.peak) {
      console.log(`${k.padEnd(20)} peak(${pad(v.peak.pitch, 6)},${pad(v.peak.yaw, 6)},${pad(v.peak.roll, 6)})`
        + `  held(${pad(v.held.pitch, 6)},${pad(v.held.yaw, 6)},${pad(v.held.roll, 6)})`);
    } else if (v.down) {
      for (const s of ['rest', 'down', 'up'])
        console.log(`${(k + ' ' + s).padEnd(20)} ` + line('', v[s]).trim()
          + `   press ${pad(v[s].press, 4)} snap ${pad(v[s].snap, 4)}`);
    } else {
      console.log(`${k.padEnd(20)} rest(${pad(v.rest.pitch, 6)},${pad(v.rest.yaw, 6)},${pad(v.rest.roll, 6)})`
        + ` -> end(${pad(v.end.pitch, 6)},${pad(v.end.yaw, 6)},${pad(v.end.roll, 6)})`
        + (v.batX !== undefined ? `  bat x=${pad(v.batX, 6)} z=${pad(v.batZ, 6)}` : ''));
    }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
