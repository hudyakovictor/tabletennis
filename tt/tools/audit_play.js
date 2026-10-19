/* Gameplay audit harness: drives the REAL bundled game in Chromium with
 * synthetic input and reports where a visible, legal ball fails to be hit and
 * where an unreachable ball is hit. Development tool, not shipped. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const root = path.resolve(__dirname, '../..');

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
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 760 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root, 'play/index.html')).href);
    await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
    await page.waitForFunction(() => window.__game.music._initialized);
    const result = await page.evaluate(() => {
      const g = window.__game;
      const out = { experiments: {}, samples: [] };
      g.paused = true;
      // silence the presentation layer: gameplay only
      for (const k of ['hitRacket', 'hitTable', 'hitNet', 'hitFloor', 'point', 'ui', 'whoosh', 'hitEdge', 'applause']) {
        if (typeof g.audio[k] === 'function') g.audio[k] = () => {};
      }
      g.msg = () => {};
      g.buzz = () => {};
      g.shakeIt = () => {};
      g.emitParticles = () => {};
      g.addMark = () => {};
      if (g.hitFeedback) g.hitFeedback.execute = () => {};
      g.ui.showShot = () => {};
      g.ui.showAiShot = () => {};
      g.ui.showNote = () => {};
      g.ui.syncScore = () => {};
      g.ui.flashMoment = () => {};
      g.moments.addContact = () => {};
      g.moments.push = () => {};
      g.recorder.addShot = () => {};
      g.recorder.addBounce = () => {};
      g.recorder.begin = () => {};
      g.ai.onPointEnd = () => {};
      g.ai.setPressure = () => {};
      g.ai.setHandicap = () => {};
      g.network.isInMatch = false;
      g.career.stop();
      g.training = null;
      g.demoMode = false;
      g._demoGesture = null;

      const V = V3;
      const dt = 1 / 60;

      function freshRally(opts = {}) {
        g.endReplay(false);
        g.startMatch(2);
        g.demoMode = false;
        g.training = null;
        g.career.stop();
        g.network.isInMatch = false;
        g.server = 1;
        g.setState(GS.RALLY);
        g.stateT = 0;
        g.isServeBall = false;
        g.rallyBounces = opts.bounces || [1];
        g.serveBounces = 0;
        g.ball.live = true;
        g.ball.lastHitBy = opts.lastHitBy === undefined ? -1 : opts.lastHitBy;
        g.ball.hist.length = 0;
        g.netTouched = false;
        g.recenterT = 0;
        g.followThrough.active = false;
        g.anticipation.active = false;
        g._acc = 0;
        g.pointerDown = false;
        g.swipe.cancel();
        g.pointer = { x: 0.5, y: 0.55 };
        g.pointerFine = true;
        g.swipeReleasedAt = -Infinity;
        g.player.lastHitT = -9;
        g.camVPReady = false;
        return g;
      }

      function setPaddle(x, y, z, normal) {
        V.set(g.player.pos, x, y, z);
        V.copy(g.player.prevPos, g.player.pos);
        V.copy(g.player.prev, g.player.pos);
        V.zero(g.player.vel);
        if (normal) V.copy(g.player.normal, normal); else V.set(g.player.normal, 0, 0, -1);
      }

      function setBall(p, v, w, live = true) {
        V.set(g.ball.p, p[0], p[1], p[2]);
        V.set(g.ball.v, v[0], v[1], v[2]);
        V.set(g.ball.w, (w && w[0]) || 0, (w && w[1]) || 0, (w && w[2]) || 0);
        g.ball.live = live;
        g.ball.speed = Math.hypot(v[0], v[1], v[2]);
        g.ball.restT = 0;
      }

      function gesture(x0, y0, x1, y1, duration = 0.11, steps = 6, startT = null) {
        const t0 = startT === null ? g.time - duration - 0.02 : startT;
        g.swipe.down(x0, y0, t0);
        for (let i = 1; i <= steps; i++) {
          const k = i / steps;
          g.swipe.move(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, t0 + duration * k);
        }
        g.swipe.up(x1, y1, t0 + duration);
        g.swipeReleasedAt = t0 + duration;
        g.pointer = { x: x1, y: y1 };
        g.pointerDown = false;
      }

      function liveGesture(x0, y0, x1, y1, duration = 0.2) {
        g.swipe.down(x0, y0, g.time);
        g.swipe.move(x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.5, g.time + duration * 0.5);
        g.pointer = { x: x1, y: y1 };
        g.pointerDown = true;
      }

      // A real pointer-down carries the screen-space admission zone. The
      // physics tests below can opt out of it to isolate capture geometry.
      function pressAtPointer(accepted = true) {
        if (g.swipe.pressZone) g.swipe.pressZone.accepted = accepted;
      }

      function step(frames = 1, each) {
        for (let i = 0; i < frames; i++) {
          if (each) each(i);
          g.update(dt);
        }
      }

      // ---------------------------------------------------------------
      // 1. endpoint capture: does every ball geometrically inside the
      //    documented cylinder actually produce a contact?
      // ---------------------------------------------------------------
      {
        let inside = 0, hit = 0, miss = 0, reasons = {}, examples = [];
        for (let ix = -6; ix <= 6; ix++) for (let iy = -6; iy <= 6; iy++) for (let iz = -6; iz <= 6; iz++) {
          const bx = ix * 0.06, by = 1.0 + iy * 0.06, bz = 1.40 + iz * 0.06;
          freshRally();
          setPaddle(0, 1.0, 1.40);
          setBall([bx, by, bz], [0, 0, 1.2], [0, 0, 0]);
          g.time += 1;
          const inRange = playerInCaptureRange(g.ball.p, g.player.pos, false);
          if (!inRange) continue;
          inside++;
          gesture(0.5, 0.7, 0.5, 0.4, 0.1, 6, g.time - 0.12);
          g.swipe.pressZone = { accepted: true };
          g.ball.v.z = 1.2;
          g.tryPlayerHit(V.clone(g.ball.p));
          if (g.ball.lastHitBy === 1) hit++;
          else {
            miss++;
            let why = 'capture';
            const closing = (g.ball.p.x - g.player.pos.x) * g.ball.v.x +
              (g.ball.p.y - g.player.pos.y) * g.ball.v.y +
              (g.ball.p.z - g.player.pos.z) * g.ball.v.z;
            if (!g.playerStrokeIntent(false)) why = 'gesture';
            else if (g.ball.v.z < 0 && g.ball.p.z < g.player.pos.z - 0.35) why = 'behind';
            /* A ball that has already passed the blade and is moving away
             * cannot be struck by a forward swing. Those are correct
             * refusals, not capture failures. */
            else if (closing > 0.02 && V.len(g.ball.v) > 0.2) why = 'passed';
            else {
              const o = {};
              predict(V.clone(g.ball.p), V.clone(g.ball.v), V.clone(g.ball.w), { dt: 1 / 240, maxT: 2, stopOnFirstBounce: true, out: o });
              const landsIn = o.landed && o.landed.z > 0.01 && Math.abs(o.landed.x) <= PH.T_HALF_WID + PH.R;
              if (!landsIn) why = 'volley-out';
              else if (o.landed.z > g.ball.p.z - 0.5) why = 'volley-early';
            }
            reasons[why] = (reasons[why] || 0) + 1;
            if (examples.length < 6) examples.push({ b: [bx, by, bz], why });
          }
        }
        /* volley-out / volley-early are CORRECT refusals (the rules forbid
         * returning that ball), not capture failures. Only 'capture',
         * 'gesture' and 'behind' are real misses. */
        const refused = (reasons['volley-out'] || 0) + (reasons['volley-early'] || 0) +
          (reasons['passed'] || 0);
        out.experiments.endpointCapture = { inside, hit, refused, miss: miss - refused, reasons, examples };
      }

      // ---------------------------------------------------------------
      // 2. same test with the real pointer-down admission created from
      //    the ball's projected position (nominal) and from the paddle.
      // ---------------------------------------------------------------
      {
        freshRally();
        setPaddle(0, 1.0, 1.40);
        setBall([0, 1.0, 1.40], [0, 0, 1], [0, 0, 0]);
        const rect = g.canvas.getBoundingClientRect();
        const bs = g.project(g.ball.p);
        const ps = g.project(g.player.pos);
        const dz = pressHitZone(bs, { x: bs.x, y: bs.y }, rect.width, rect.height);
        const dp = pressHitZone(bs, { x: ps.x, y: ps.y }, rect.width, rect.height);
        out.experiments.pressAdmission = {
          ball: { x: bs.x, y: bs.y }, paddle: { x: ps.x, y: ps.y },
          ballDistancePx: dz && dz.distancePx, paddleDistancePx: dp && dp.distancePx,
          radius: MATCH_RULES.pressRadiusPx,
          ballAccepted: !!(dz && dz.accepted), paddleAccepted: !!(dp && dp.accepted),
          rect: { w: rect.width, h: rect.height },
        };
      }

      // ---------------------------------------------------------------
      // 3. incoming rally ball: press 0..250 ms before contact at the
      //    paddle's screen position (what a player sees) and check whether
      //    the admission lets the stroke through.
      // ---------------------------------------------------------------
      {
        const leads = [0.02, 0.05, 0.08, 0.11, 0.14, 0.18, 0.22, 0.26, 0.32];
        const rows = [];
        for (const lead of leads) {
          freshRally();
          setPaddle(0, 1.02, 1.40);
          // ball 8 m/s, 0.35 m before the paddle plane
          const z = 1.40 - 0.35 - 8 * lead;
          setBall([0, 1.02, z], [0, 0, 8], [0, 0, 0]);
          g.time += 1;
          const rect = g.canvas.getBoundingClientRect();
          const ps = g.project(g.player.pos);
          const bs = g.project(g.ball.p);
          // press on the bat, wait for the ball: this is what a player does.
          const pz = pressHitZone(bs, { x: ps.x, y: ps.y }, rect.width, rect.height)
            || { accepted: false, radius: MATCH_RULES.pressRadiusPx, distancePx: null };
          pz.pressX = ps.x; pz.pressY = ps.y; pz.vw = rect.width; pz.vh = rect.height;
          const padZone = pressHitZone(ps, { x: ps.x, y: ps.y }, rect.width, rect.height);
          if (padZone && padZone.accepted) { pz.accepted = true; pz.via = 'paddle'; }
          g.swipe.pressZone = pz;
          const admittedAtPress = g.pressAdmitsBall();
          // ...then the ball actually arrives at the bat
          setBall([0, 1.02, 1.40], [0, 0, 8], [0, 0, 0]);
          const admittedOnArrival = g.pressAdmitsBall();
          rows.push({ lead, ballZ: z, distancePx: pz.distancePx, via: pz.via || null,
            admittedAtPress, admittedOnArrival });
        }
        out.experiments.pressLead = rows;
      }

      // ---------------------------------------------------------------
      // 4. serve: real state machine; press at the paddle, at the ball,
      //    and below the ball; swipe at realistic times.
      // ---------------------------------------------------------------
      {
        const rows = [];
        for (const place of ['ball', 'paddle', 'below']) for (const swipeAt of [0.12, 0.20, 0.28, 0.36, 0.44]) {
          freshRally();
          g.startMatch(2);
          g.demoMode = false;
          g.server = 1;
          g.prepServe();
          g.recenterT = 0;
          g.setState(GS.SERVE_READY);
          g.camVPReady = false;
          g.time += 1;
          g.updatePlayerPaddle(dt);
          const rect = g.canvas.getBoundingClientRect();
          const bs = g.project(g.ball.p);
          const ps = g.project(g.player.pos);
          const anchor = place === 'ball' ? bs : place === 'paddle' ? ps : { x: bs.x, y: bs.y + 60 / rect.height };
          g.swipe.down(anchor.x, anchor.y, g.time);
          g.swipe.pressZone = pressHitZone(bs, anchor, rect.width, rect.height);
          if (!g.swipe.pressZone) g.swipe.pressZone = { accepted: false };
          if (g.state === GS.SERVE_READY) g.startToss();
          const pressOK = g.swipe.pressZone.accepted;
          let t = 0, hitT = null, swiped = false, states = [], hitInfo = null;
          while (t < 2.0 && g.state === GS.SERVE_TOSS) {
            t += dt;
            if (!swiped && t >= swipeAt) {
              const y1 = anchor.y - 0.12;
              g.swipe.move(anchor.x + 0.005, (anchor.y + y1) / 2, g.time);
              g.swipe.move(anchor.x + 0.01, y1, g.time + 0.02);
              g.swipe.up(anchor.x + 0.01, y1, g.time + 0.03);
              g.swipeReleasedAt = g.time + 0.03;
              g.pointerDown = false;
              swiped = true;
            }
            states.push({ t: +t.toFixed(2), y: +g.ball.p.y.toFixed(2), vy: +g.ball.v.y.toFixed(2), st: g.state });
            g.update(dt);
            if (g.ball.lastHitBy === 1) {
              hitT = t;
              const c = g.shotJournal && g.shotJournal.latest && g.shotJournal.latest.contact;
              hitInfo = { v: [+g.ball.v.x.toFixed(2), +g.ball.v.y.toFixed(2), +g.ball.v.z.toFixed(2)],
                assist: c && c.assist, outgoing: c && c.outgoing && c.outgoing.v,
                normal: c && c.normal };
              break;
            }
            if (g.state !== GS.SERVE_TOSS) break;
          }
          const hitOk = g.ball.lastHitBy === 1;
          let legal = null, bounces = [];
          if (hitOk) {
            for (let i = 0; i < 60 * 3 && g.ball.live; i++) {
              const before = g.serveBounces;
              g.update(dt);
              if (g.serveBounces !== before) bounces.push(+g.ball.p.z.toFixed(2));
              if (!g.isServeBall) { legal = bounces.length >= 2 && bounces[0] * bounces[1] < 0; break; }
              if (g.state !== GS.RALLY) { legal = false; break; }
            }
          }
          rows.push({ place, swipeAt, pressOK, hitOk, hitT, legal, bounces, hitInfo,
            net: g.netTouched, serveBounces: g.serveBounces, point: g.lastPoint && g.lastPoint.reason,
            lastStates: states.slice(-3) });
          if (g.state !== GS.MENU) g.returnToMenu();
        }
        out.experiments.serve = rows;
      }

      // ---------------------------------------------------------------
      // 4b. serve: a natural press-and-swipe with no waiting (the way a
      //     player starts the gesture)  vs a held-press then flick.
      // ---------------------------------------------------------------
      {
        const rows = [];
        for (const mode of ['immediate', 'hold200', 'hold350']) {
          freshRally();
          g.startMatch(2); g.demoMode = false; g.server = 1; g.prepServe(); g.recenterT = 0;
          g.setState(GS.SERVE_READY); g.camVPReady = false; g.time += 1; g.updatePlayerPaddle(dt);
          const rect = g.canvas.getBoundingClientRect(), bs = g.project(g.ball.p);
          g.swipe.down(bs.x, bs.y, g.time);
          g.swipe.pressZone = pressHitZone(bs, bs, rect.width, rect.height) || { accepted: false };
          const pressOK = g.swipe.pressZone.accepted;
          if (g.state === GS.SERVE_READY) g.startToss();
          let t = 0, hit = false, hitAt = null;
          const wait = mode === 'immediate' ? 0.03 : mode === 'hold200' ? 0.22 : 0.36;
          let swiped = false;
          while (t < 1.5 && g.state === GS.SERVE_TOSS) {
            t += dt;
            if (!swiped && t >= wait) {
              const y1 = bs.y - 0.10;
              g.swipe.move(bs.x, (bs.y + y1) / 2, g.time);
              g.swipe.move(bs.x + 0.01, y1, g.time + 0.015);
              swiped = true; // keep the finger down
            }
            g.update(dt);
            if (g.ball.lastHitBy === 1) { hit = true; hitAt = t; break; }
            if (g.state !== GS.SERVE_TOSS) break;
          }
          if (!hit && g.ball.lastHitBy === 1) hit = true;
          rows.push({ mode, hit, hitAt, pressAccepted: pressOK });
          if (g.state !== GS.MENU) g.returnToMenu();
        }
        out.experiments.serveInput = rows;
      }

      // ---------------------------------------------------------------
      // 5. short ball: opponent's shot dies near the net. Can a swipe
      //    actually reach it with the shipped footwork assist?
      // ---------------------------------------------------------------
      {
        /* Short balls: the ball bounces on the receiver's side and dies there.
         * What makes it returnable is TIME, and time is set by the bounce
         * height, not by the depth. The old fixture used a fixed 6 cm drop and
         * 1.5 m/s of lift, which gives the receiver 0.34 s in total — so the
         * "late" rows were asking for a return the ball itself did not allow.
         * Here each row is a fraction of the ball's own flight before its
         * second bounce, so a miss means the game's step-in failed, not that
         * the experiment invented an impossible ball. */
        const rows = [];
        for (const landZ of [0.55, 0.75, 0.95]) for (const h of [0.10, 0.18, 0.26]) {
          const vy = Math.sqrt(2 * 9.81 * h);
          const flight = 2 * vy / 9.81;          // rise + fall back to the table
          for (const frac of [0.30, 0.50, 0.70]) {
            const lead = flight * frac;
            freshRally();
            setPaddle(0, 1.02, 1.44);
            setBall([0, PH.TABLE_Y + 0.01, landZ], [0, vy, 1.2], [0, 0, 0]);
            g.rallyBounces = [1];
            let hit = false, touchZ = null, minDist = 99, pressed = false, press = null;
            let tHit = null, why = null;
            for (let i = 0; i < 90 && g.ball.live; i++) {
              const sp = g.project(g.ball.p);
              if (sp.ok) g.pointer = { x: Math.min(0.9, Math.max(0.1, sp.x)), y: Math.min(0.9, Math.max(0.1, sp.y)) };
              minDist = Math.min(minDist, Math.hypot(g.ball.p.x - g.player.pos.x, g.ball.p.y - g.player.pos.y));
              if (!pressed && i * dt >= lead) {
                const rect = g.canvas.getBoundingClientRect();
                press = { x: sp.ok ? sp.x : .5, y: sp.ok ? sp.y : .5 };
                g.swipe.down(press.x, press.y, g.time);
                g.swipe.pressZone = pressHitZone(sp, { x: press.x, y: press.y }, rect.width, rect.height) || { accepted: true };
                g.pointerDown = true;
                pressed = true;
              }
              if (pressed) {
                const k = Math.min(1, (i * dt - lead) / 0.12);
                g.pointer = { x: press.x, y: Math.max(.12, press.y - .18 * k) };
                g.swipe.move(g.pointer.x, g.pointer.y, g.time);
              }
              g.update(dt);
              if (g.ball.lastHitBy === 1 && g.ball.live) { hit = true; touchZ = g.player.pos.z; tHit = i * dt; break; }
            }
            if (!hit) why = g.lastPoint ? g.lastPoint.reason : 'timeout';
            rows.push({ landZ, h, frac, lead: +lead.toFixed(2), hit, touchZ, tHit, why,
              minDist: +minDist.toFixed(3), ballLive: g.ball.live });
            g.swipe.cancel(); g.pointerDown = false;
          }
        }
        out.experiments.shortBall = rows;
      }

      // ---------------------------------------------------------------
      // 6. reachable high/wide balls: the ball crosses the documented
      //    capture cylinder while a valid gesture is held. Count misses.
      // ---------------------------------------------------------------
      {
        let total = 0, hits = 0, missed = [];
        for (const speed of [4, 7, 10, 14, 18, 24]) {
          /* The ball has to actually CROSS the documented capture cylinder
           * for a miss to mean anything. The old grid dropped the ball from a
           * fixed height over a 1.5 m approach: at 4 m/s gravity pulled it
           * 0.6 m below the blade, and at |x| = 0.6 it was outside the .361
           * lateral box all along — 15 "misses" that were the experiment,
           * not the game. Place it (and the test point) inside the cylinder. */
          const T2 = 1.5 / speed;
          const drop = 0.4 * T2 + 0.5 * (PH.G || 9.81) * T2 * T2;
          for (const x of [-0.30, 0, 0.30]) {
            for (const y of [0.86, 1.02, 1.18]) {
              freshRally();
              setPaddle(0, 1.02, 1.45);
              /* Hold the cursor still too: updatePlayerPaddle() follows the
               * pointer every frame, so a paddle parked by hand slides away
               * from the ball over the 40 frames this test runs. */
              g.pointer = { x: 0.5, y: 0.559 };
              setBall([x, y + drop, 1.45 - 1.5], [0, -0.4, speed], [0, 0, 0]);
              g.rallyBounces = [1];
              g.time += 1;
              /* Swipe when the ball is actually arriving, not half a second
               * before it: playerStrokeIntent() gives a released rally
               * gesture 250 ms of life, so the old fixed gesture at t-0.1
               * had already expired for the slowest ball. That was the
               * experiment timing out, not the game refusing a return. */
              g.swipe.pressZone = { accepted: true };
              g.pointerDown = false;
              let armed = false;
              let hit = false;
              for (let i = 0; i < 40; i++) {
                g.pointer = { x: 0.5, y: 0.559 };
                /* Arm the stroke ~180 ms before the ball reaches the blade,
                 * and stamp the gesture as ENDING NOW: playerStrokeIntent()
                 * gives a released rally gesture 250 ms of life and ignores
                 * one whose release time is in the future. The old code
                 * swiped at a fixed z with a timestamp 60 ms ahead, so the
                 * gesture was "not yet released" for exactly the frames the
                 * ball was inside the capture box — a miss in the harness. */
                if (!armed && g.ball.p.z >= 1.45 - speed * 0.18) {
                  gesture(0.5, 0.8, 0.5, 0.4, 0.08, 5, g.time - 0.08);
                  /* gesture() leaves the pointer at the END of the swipe;
                   * leaving it there drags the bat 0.6 m upfield. */
                  g.pointer = { x: 0.5, y: 0.559 };
                  g.pointerDown = false; armed = true;
                }
                g.update(dt);
                if (g.ball.lastHitBy === 1) { hit = true; break; }
                if (!g.ball.live) break;
              }
              total++;
              if (hit) hits++; else missed.push({ speed, x, y, z: +g.ball.p.z.toFixed(2), live: g.ball.live });
            }
          }
        }
        out.experiments.movingBalls = { total, hits, miss: total - hits, examples: missed.slice(0, 12) };
      }

      // ---------------------------------------------------------------
      // 7. far-from-paddle hits: with a valid fresh gesture, how far can
      //    the ball be from the visible blade and still be struck?
      // ---------------------------------------------------------------
      {
        const rows = [];
        for (const [dx, dy, dz] of [[0, 0, 0], [0.3, 0, 0], [0.36, 0, 0], [0.36, 0, 0.3], [0, 0, 0.34], [0.5, 0, 0], [0, 0.4, 0], [0.25, 0.25, 0.25]]) {
          freshRally();
          setPaddle(0, 1.02, 1.44);
          setBall([dx, 1.02 + dy, 1.44 + dz], [0, 0, 1.2], [0, 0, 0]);
          g.rallyBounces = [1];
          g.time += 1;
          gesture(0.5, 0.7, 0.5, 0.4, 0.1, 6, g.time - 0.12);
          g.swipe.pressZone = { accepted: true };
          g.tryPlayerHit(V.clone(g.ball.p));
          rows.push({ d: [dx, dy, dz], dist: +Math.hypot(dx, dy, dz).toFixed(3), hit: g.ball.lastHitBy === 1 });
        }
        out.experiments.farHits = rows;
      }

      // ---------------------------------------------------------------
      // 8. paddle lag: how far is the paddle from its target while a fast
      //    ball is incoming? (input responsiveness)
      // ---------------------------------------------------------------
      {
        freshRally();
        setPaddle(0, 1.02, 1.44);
        g.pointer = { x: .5, y: .55 };
        g.recenterT = 0;
        const settle = [];
        for (let i = 0; i < 60; i++) g.updatePlayerPaddle(dt);
        for (let i = 0; i < 30; i++) {
          g.pointer = { x: i < 15 ? .15 : .85, y: .55 };
          g.updatePlayerPaddle(dt);
          settle.push({ i, x: +g.player.pos.x.toFixed(3), targetX: (g.pointer.x - .5) * 2 * 1.02 });
        }
        out.experiments.paddleLag = { tail: settle.slice(-12) };
      }

      // ---------------------------------------------------------------
      // 9. invariant sweep: NaN/hostile inputs to the physics API
      // ---------------------------------------------------------------
      {
        let bad = 0, total = 0;
        const vals = [NaN, Infinity, -Infinity, 1e9, -1e9, 0, 1e-12];
        for (const a of vals) for (const b of vals) {
          total++;
          const v = V.new(1, 2, 3), w = V.new(4, 5, 6), n = V.new(a, b, 1);
          const info = impactSphere(v, w, n, null, 0.9, 0.4, 0);
          if (![v.x, v.y, v.z, w.x, w.y, w.z].every(Number.isFinite)) bad++;
          const v2 = V.new(1, 2, 3), w2 = V.new();
          const info2 = impactRacket(v2, w2, V.new(a, b, 1), V.new(NaN, 0, 0), 1, {});
          if (![v2.x, v2.y, v2.z, w2.x, w2.y, w2.z].every(Number.isFinite)) bad++;
        }
        out.experiments.hostile = { total, bad };
      }

      // ---------------------------------------------------------------
      // 10. solveLaunch accuracy over a grid of realistic launches
      // ---------------------------------------------------------------
      {
        let total = 0, ok = 0, net = 0, long = 0, maxErr = 0, sumErr = 0;
        for (const x of [-0.5, 0, 0.5]) for (const y of [0.86, 1.1, 1.4]) for (const z of [1.2, 1.6]) {
          for (const tx of [-0.6, 0, 0.6]) for (const tz of [-0.4, -0.9, -1.2]) {
            const spin = V.new(120, 0, 0);
            const sol = solveLaunch({ x, y, z }, { x: tx, z: tz }, spin, { speed: 8, netClear: 0.05, speedForgive: 0 });
            total++;
            if (!sol) { long++; continue; }
            if (Math.abs(sol.err) < 0.25) ok++; else if (sol.landed) long++; else net++;
            const e = sol.landed ? Math.hypot(sol.landed.x - tx, sol.landed.z - tz) : 9;
            maxErr = Math.max(maxErr, e); sumErr += e;
          }
        }
        out.experiments.solveLaunch = { total, ok, net, long, maxErr: +maxErr.toFixed(3), meanErr: +(sumErr / total).toFixed(3) };
      }

      // ---------------------------------------------------------------
      // 11. serve solver legality grid (the pure function the player uses)
      // ---------------------------------------------------------------
      {
        let total = 0, legal = 0, failed = 0, examples = [];
        for (const y of [0.90, 0.95, 1.00, 1.05]) for (const z of [1.38, 1.44, 1.50]) for (const vy of [-0.5, -1.5, -2.5]) {
          for (const need of ['SERVE_TOP', 'SERVE_BACK', 'SERVE_SIDE', 'SERVE_FAST']) {
            const m = { right: 0, up: need === 'SERVE_BACK' ? -0.5 : 0.5, dist: 0.22, curl: need === 'SERVE_SIDE' ? 0.6 : 0,
              speed: 1.6, peakSpeed: 1.7, releaseSpeed: 1.5, smooth: 0.9, straightness: 0.9, samples: 10, jerk: 0.1 };
            const raw = deriveStroke(m, { side: 1, grip: 'shakehand', forehand: true, isServe: true,
              ball: { y, z }, ballSpin: V.new(), ballSpeed: 2, movePitch: -0.15 });
            raw.isServe = true;
            const r = refineRacket({ x: 0, y, z }, V.new(0, vy, 0), V.new(), raw, 1, 0.9);
            total++;
            if (r.valid) legal++; else { failed++; if (examples.length < 8) examples.push({ y, z, vy, need, ok: r.valid, dElev: r.dElev }); }
          }
        }
        out.experiments.serveSolver = { total, legal, failed, examples };
      }

      // ---------------------------------------------------------------
      // 12. table / racket physics invariants over many impacts
      // ---------------------------------------------------------------
      {
        let gain = 0, nan = 0, worst = 0, rows = 0;
        for (let vi = 1; vi <= 20; vi++) for (let wi = 0; wi <= 600; wi += 100) for (const mu of [0.4, 1.05]) {
          const v = V.new(0, -vi, 0), w = V.new(wi, 0, 0);
          const before = V.len(v), beforeW = V.len(w);
          impactSphere(v, w, V.new(0, 1, 0), null, 0.9, mu, 0);
          const after = V.len(v), afterW = V.len(w);
          rows++;
          if (![after, afterW].every(Number.isFinite)) nan++;
          if (after > before * 1.0001 + 0.01) { gain++; worst = Math.max(worst, after / before); }
        }
        out.experiments.impacts = { rows, gain, nan, worst: +worst.toFixed(3) };
      }

      out.errors = [];
      return out;
    });
    console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
