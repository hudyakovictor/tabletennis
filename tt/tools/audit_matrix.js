'use strict';
/* Iteration 4 of the gameplay audit: the areas earlier runs never touched —
 * net/table contact parity between solver and live physics, serve-rule
 * attribution, ball rest, CCD between frames, held gestures, and the
 * per-level sanity of what the bot actually produces. */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core'), chromium = require('@sparticuz/chromium');
const root = path.resolve(__dirname, '../..');

(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  fs.mkdirSync(libs, { recursive: true });
  const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
  execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
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
      const out = { sections: {}, failures: [] };
      g.paused = true;
      for (const k of ['hitRacket', 'hitTable', 'hitNet', 'hitFloor', 'point', 'ui', 'whoosh', 'hitEdge', 'applause']) {
        if (typeof g.audio[k] === 'function') g.audio[k] = () => {};
      }
      g.msg = () => {}; g.buzz = () => {}; g.shakeIt = () => {}; g.emitParticles = () => {}; g.addMark = () => {};
      if (g.hitFeedback) g.hitFeedback.execute = () => {};
      for (const fn of ['showShot', 'showAiShot', 'showNote', 'syncScore', 'flashMoment']) g.ui[fn] = () => {};
      for (const fn of ['addContact', 'push']) g.moments[fn] = () => {};
      for (const fn of ['addShot', 'addBounce', 'begin']) g.recorder[fn] = () => {};
      g.ai.onPointEnd = () => {}; g.ai.setPressure = () => {}; g.ai.setHandicap = () => {};
      g.network.isInMatch = false; g.career.stop(); g.training = null; g.demoMode = false;

      const V = V3, PHh = PH;
      const isRealStroke = window.isRealStroke || ((m, s) => m && m.samples >= (s ? 2 : 3));
      const dt = 1 / 60;
      let checks = 0;
      const sec = (name) => { out.sections[name] = { checks: 0, fail: 0 }; return name; };
      const check = (name, ok, info) => {
        checks++;
        const s = out.sections[name]; s.checks++;
        if (!ok) { s.fail++; if (out.failures.length < 60) out.failures.push({ section: name, info }); }
      };
      const fresh = (opts = {}) => {
        g.startMatch(2); g.demoMode = false; g.training = null; g.career.stop(); g.network.isInMatch = false;
        g.server = 1; g.setState(GS.RALLY); g.stateT = 0; g.isServeBall = false;
        g.rallyBounces = opts.bounces || []; g.serveBounces = 0;
        g.ball.live = true; g.ball.lastHitBy = opts.lastHitBy === undefined ? -1 : opts.lastHitBy;
        g.ball.hist.length = 0; g.netTouched = false; g.recenterT = 0;
        g.followThrough.active = false; g.anticipation.active = false; g._acc = 0;
        g.pointerDown = false; g.swipe.cancel(); g.pointer = { x: .5, y: .55 };
        g.swipeReleasedAt = -Infinity; g.player.lastHitT = -9; g.camVPReady = false;
        g.score = [0, 0];
        return g;
      };
      const put = (p, v, w) => {
        V.set(g.ball.p, p[0], p[1], p[2]);
        V.set(g.ball.v, v[0], v[1], v[2]);
        V.set(g.ball.w, (w && w[0]) || 0, (w && w[1]) || 0, (w && w[2]) || 0);
        g.ball.live = true; g.ball.speed = Math.hypot(v[0], v[1], v[2]); g.ball.restT = 0;
      };
      const padTo = (x, y, z) => {
        V.set(g.player.pos, x, y, z); V.copy(g.player.prevPos, g.player.pos);
        V.copy(g.player.prev, g.player.pos); V.zero(g.player.vel); V.set(g.player.normal, 0, 0, -1);
      };
      const step = (n = 1) => { for (let i = 0; i < n; i++) g.update(dt); };
      const simPhysics = (n) => { for (let i = 0; i < n; i++) g.stepPhysics(1 / 600); };

      // ---------------------------------------------------------------
      // 1. a ball under the table passes UNDER the net (regression B43)
      // ---------------------------------------------------------------
      sec('underNet');
      for (const y of [0.25, 0.40, 0.55, 0.68, 0.74]) {
        fresh(); put([0, y, 1.0], [0, -0.2, -3]);
        let crossed = false, reflected = false;
        for (let i = 0; i < 1800; i++) { simPhysics(1); if (g.ball.p.z < 0) crossed = true; if (g.ball.v.z > 0.2 && g.ball.p.z > 0) reflected = true; if (crossed) break; }
        check('underNet', crossed && !reflected, { y, z: +g.ball.p.z.toFixed(2), vz: +g.ball.v.z.toFixed(2) });
      }
      // a ball that is NOT under the table must still be stopped by the net
      for (const y of [PHh.TABLE_Y + 0.06, PHh.TABLE_Y + 0.10]) {
        fresh(); put([0, y, 1.0], [0, 0, -3]);
        simPhysics(300);
        check('underNet', g.ball.p.z > -0.2 && g.ball.v.z >= 0 || g.netTouched, { y, z: +g.ball.p.z.toFixed(2), net: g.netTouched });
      }

      // ---------------------------------------------------------------
      // 2. predict() and the live step agree about the net/tape band
      // ---------------------------------------------------------------
      sec('netParity');
      for (let i = 0; i < 12; i++) {
        const y = PHh.TABLE_Y + 0.10 + i * 0.01;
        fresh(); put([0, y, 0.5], [0, 0, -6]);
        g.netTouched = false;
        simPhysics(120);
        const liveHit = g.netTouched;
        const o = {};
        predict(V3.new(0, y, 0.5), V3.new(0, 0, -6), V3.new(), { dt: 1 / 600, maxT: 1.0, out: o });
        check('netParity', liveHit === !!o.hitNet, { y: +y.toFixed(3), live: liveHit, pred: !!o.hitNet });
      }

      // ---------------------------------------------------------------
      // 3. predict() never bounces a ball that is below the table
      // ---------------------------------------------------------------
      sec('belowTable');
      for (const y of [0.20, 0.40, 0.60, 0.72]) for (const vy of [-1, -3]) {
        const o = {};
        predict(V3.new(0, y, 0.6), V3.new(0, vy, 0), V3.new(), { dt: 1 / 600, maxT: 2.0, out: o });
        check('belowTable', o.bounces === 0 || o.landed === null || o.landed === undefined, { y, vy, bounces: o.bounces });
      }

      // ---------------------------------------------------------------
      // 4. the recorded contact point is the surface, not the step end
      // ---------------------------------------------------------------
      sec('contactPoint');
      for (const speed of [8, 18, 30]) for (const z0 of [1.10, 1.25, 1.33]) {
        const vy = -speed * 0.6, vz = -speed * 0.8;
        /* Reference: the same flight at 3 kHz. The production 600 Hz step
         * must report the same contact point, because the contact is
         * interpolated inside the step instead of being taken at its end. */
        const ref = {};
        predict(V3.new(0, 1.5, z0), V3.new(0, vy, vz), V3.new(), { dt: 1 / 3000, maxT: 1.0, stopOnFirstBounce: true, out: ref });
        const o = {};
        predict(V3.new(0, 1.5, z0), V3.new(0, vy, vz), V3.new(), { dt: 1 / 600, maxT: 1.0, stopOnFirstBounce: true, out: o });
        check('contactPoint', o.landed && ref.landed && Math.abs(o.landed.z - ref.landed.z) < 0.012,
          { speed, z0, ref: ref.landed && +ref.landed.z.toFixed(3), got: o.landed && +o.landed.z.toFixed(3) });
      }
      // a ball that lands 2 mm inside the end line must be a legal bounce
      for (const speed of [20, 30]) {
        const z0 = 1.0, y0 = 1.32, vy = -6, vz = -speed * 0.55;
        const o = {};
        predict(V3.new(0, y0, z0), V3.new(0, vy, vz), V3.new(), { dt: 1 / 600, maxT: 1.2, stopOnFirstBounce: true, out: o });
        check('contactPoint', !!o.landed && Math.abs(o.landed.z) <= PHh.T_HALF_LEN + PHh.R + 1e-6,
          { speed, landedZ: o.landed && +o.landed.z.toFixed(3), limit: PHh.T_HALF_LEN + PHh.R });
      }

      // ---------------------------------------------------------------
      // 5. a ball that comes to rest ON the table resolves the rally
      // ---------------------------------------------------------------
      sec('deadBall');
      fresh({ bounces: [1], lastHitBy: -1 }); put([0, PHh.TABLE_Y + PHh.R + 0.001, 0.9], [0, 0, 0]);
      g.rallyBounces = [1];
      for (let i = 0; i < 240 && g.state === GS.RALLY; i++) simPhysics(1);
      check('deadBall', g.state !== GS.RALLY && g.lastPoint, { state: g.state, pt: g.lastPoint });
      fresh({ bounces: [1, -1], lastHitBy: 1 }); put([0, PHh.TABLE_Y + PHh.R + 0.001, -0.9], [0, 0, 0]);
      for (let i = 0; i < 240 && g.state === GS.RALLY; i++) simPhysics(1);
      check('deadBall', g.state !== GS.RALLY && g.lastPoint && g.lastPoint.who === 1, { state: g.state, pt: g.lastPoint });

      // ---------------------------------------------------------------
      // 6. a return that spins back over the net is not the hitter's fault
      // ---------------------------------------------------------------
      sec('spinBack');
      fresh({ bounces: [1], lastHitBy: 1 });
      g.onBounce(-1, 1, null);           // the ball reaches the opponent's court
      g.awardPoint = ((orig) => function (who, reason) { this.__pt = { who, reason }; return orig.call(this, who, reason); })(g.awardPoint);
      g.onBounce(1, 1, null);            // ...then rolls back onto the hitter's half
      check('spinBack', g.lastPoint && g.lastPoint.who === 1, { lastPoint: g.lastPoint });
      fresh({ bounces: [1], lastHitBy: 1 });
      g.onBounce(1, 1, null);            // never crossed -> the hitter's fault
      check('spinBack', g.lastPoint && g.lastPoint.who === -1, { lastPoint: g.lastPoint });

      // ---------------------------------------------------------------
      // 7. serve rules: own bounce, receiver bounce, net = let
      // ---------------------------------------------------------------
      sec('serveRules');
      const serveCase = (server, b1side, b2side, net, expectWho, expectReason) => {
        fresh(); g.server = server; g.isServeBall = true; g.serveBounces = 0; g.rallyBounces = [];
        g.ball.lastHitBy = server; g.netTouched = !!net;
        g.onBounce(b1side, 4, null);
        g.onBounce(b2side, 3, null);
        const ok = expectReason === 'none' ? (!g.lastPoint || g.state === GS.RALLY)
          : expectReason === 'let' ? (g.state === GS.POINT && !g.lastPoint)
          : (g.lastPoint && g.lastPoint.who === expectWho);
        check('serveRules', ok, { server, b1side, b2side, net, got: g.lastPoint, state: g.state });
      };
      serveCase(1, 1, -1, false, null, 'none');          // legal serve: no point (lastPoint null)
      serveCase(1, -1, 1, false, -1, 'fault');          // first bounce on the wrong side
      serveCase(1, 1, 1, false, -1, 'fault');           // second bounce on the server's own side
      serveCase(1, 1, -1, true, null, 'let');           // net touch then good = let
      serveCase(-1, -1, 1, false, null, 'none');
      serveCase(-1, 1, -1, false, 1, 'fault');
      serveCase(-1, -1, -1, false, 1, 'fault');

      // ---------------------------------------------------------------
      // 8. every AI level serves legally
      // ---------------------------------------------------------------
      sec('aiServe');
      for (const lvl of [0, 1, 2, 3, 4]) {
        for (let m = 0; m < 6; m++) {
          fresh(); g.ai.setLevel(lvl); g.server = -1; g.prepServe();
          g.setState(GS.SERVE_READY); g.aiServeTimer = 0;
          let bounces = []; const origB = g.onBounce.bind(g);
          g.onBounce = function (side, sp, info) { bounces.push(side); return origB(side, sp, info); };
          for (let i = 0; i < 420; i++) { step(1); if (bounces.length >= 2 || g.state === GS.POINT) break; }
          g.onBounce = origB;
          const ok = bounces.length >= 2 && bounces[0] === -1 && bounces[1] === 1;
          check('aiServe', ok, { lvl, bounces, state: g.state });
        }
      }

      // ---------------------------------------------------------------
      // 9. AI rally shots stay physically sane, level by level
      // ---------------------------------------------------------------
      sec('aiRally');
      for (const lvl of [0, 1, 2, 3, 4]) {
        let legal = 0, shots = 0, bad = 0;
        for (let m = 0; m < 8; m++) {
          fresh(); g.ai.setLevel(lvl);
          g.server = 1; g.setState(GS.RALLY); g.ball.lastHitBy = 1; g.rallyBounces = [-1];
          put([0.1, 1.05, -0.4], [0.2, 0.4, -6]);
          V.set(g.ai.pos, 0, 1.0, -1.45); g.aiPaddle.pos.z = -1.45;
          let lastBy = 1, seen = 0;
          for (let i = 0; i < 420; i++) {
            step(1);
            if (g.ball.lastHitBy === -1 && lastBy === 1) {
              seen++; shots++;
              const v = g.ball.v, sp = V3.len(v);
              if (!Number.isFinite(sp) || sp <= 0 || sp > 32) bad++;
              else legal++;
              lastBy = -1;
            }
            if (g.ball.lastHitBy === 1) lastBy = 1;
            if (g.state !== GS.RALLY) break;
          }
        }
        check('aiRally', shots > 0 && bad === 0, { lvl, shots, bad });
      }

      // ---------------------------------------------------------------
      // 10. player strokes: 36 grip/height/depth cases under 600 Hz
      // ---------------------------------------------------------------
      sec('playerShots');
      for (const grip of ['shakehand', 'penhold']) for (const fh of [true, false]) {
        for (const y of [0.88, 1.02, 1.16]) for (const z of [1.15, 1.45]) for (const dy of [-0.30, 0, 0.25]) {
          const sw = new SwipeTracker();
          sw.down(.5, .5, 0); sw.move(.52, .5 + dy / 2, .05); sw.up(.54, .5 + dy, .1);
          const m = sw.lastReleased;
          if (!isRealStroke(m, false)) { continue; }
          const raw = deriveStroke(m, { side: 1, grip, forehand: fh, ball: { y, z },
            ballSpin: V3.new(150, 0, 0), ballSpeed: 6, movePitch: -.12 });
          const p = V3.new(0, y, z), v = V3.new(0, -1, 6), w = V3.new(150, 0, 0);
          const r = refineRacket(p, v, w, raw, MATCH_RULES.trajectoryAssist, .85);
          const bv = V3.clone(v), bw = V3.clone(w);
          const info = impactRacket(bv, bw, r.normal, r.vR, .85, r.rubber || {});
          let ok = !!info && Number.isFinite(V3.len(bv));
          if (ok) {
            const rep = {};
            predict(V3.clone(p).addScaled ? V3.new(p.x + r.normal.x * PHh.R * 1.05, p.y + r.normal.y * PHh.R * 1.05, p.z + r.normal.z * PHh.R * 1.05) : p,
              V3.clone(bv), V3.clone(bw), { dt: 1 / 600, maxT: 2.4, stopOnFirstBounce: true, out: rep });
            ok = !rep.hitNet && rep.landed && rep.landed.z < 0 && Math.abs(rep.landed.x) <= PHh.T_HALF_WID + PHh.R;
          }
          check('playerShots', ok, ok ? null : { grip, fh, y, z, dy, valid: r.valid,
            net: rep.hitNet, land: rep.landed && [+rep.landed.x.toFixed(2), +rep.landed.z.toFixed(2)] });
        }
      }

      // ---------------------------------------------------------------
      // 11. CCD between frames: a fast ball cannot cross the blade unseen
      // ---------------------------------------------------------------
      sec('ccd');
      for (const speed of [10, 18, 26]) for (const off of [0, 0.15, 0.30]) {
        fresh({ bounces: [1], lastHitBy: -1 });
        g.pointer = { x: .5, y: .55 };
        // swipes early, ball arrives inside the same 1/60 s frame
        const t0 = g.time - 0.06;
        g.swipe.down(.5, .8, t0); g.swipe.move(.5, .6, t0 + .03); g.swipe.move(.5, .4, t0 + .06);
        g.swipe.up(.5, .4, t0 + .06); g.swipeReleasedAt = t0 + .06; g.pointerDown = false;
        g.swipe.pressZone = { accepted: true };
        padTo(0, 1.02, 1.45);
        put([off, 1.02, 1.45 - 0.40], [0, 0, speed]);
        let hit = false;
        for (let i = 0; i < 4 && !hit; i++) { g.pointer = { x: .5, y: .55 }; hit = g.ball.lastHitBy === 1; step(1); }
        check('ccd', g.ball.lastHitBy === 1, { speed, off, by: g.ball.lastHitBy, z: +g.ball.p.z.toFixed(2) });
      }

      // ---------------------------------------------------------------
      // 12. no double contact inside the 90 ms lockout
      // ---------------------------------------------------------------
      sec('lockout');
      {
        fresh({ bounces: [1], lastHitBy: -1 });
        padTo(0, 1.02, 1.45);
        g.player.lastHitT = g.time - 0.02;
        g.swipe.pressZone = { accepted: true };
        g.swipe.down(.5, .8, g.time); g.swipe.move(.5, .4, g.time + .05);
        put([0, 1.02, 1.45], [0, 0, -6]);
        g.tryPlayerHit(V3.clone(g.ball.p));
        check('lockout', g.ball.lastHitBy === -1, { by: g.ball.lastHitBy });
      }

      // ---------------------------------------------------------------
      // 13. a held block stays live, a tap never does
      // ---------------------------------------------------------------
      sec('heldStroke');
      {
        fresh({ bounces: [1], lastHitBy: -1 });
        const t0 = g.time - 1.2;
        g.swipe.down(.5, .5, t0); g.swipe.move(.5, .42, t0 + .06); g.swipe.move(.5, .40, t0 + .10);
        g.swipe.pressZone = { accepted: true };
        const alive = !!g.playerStrokeIntent();
        check('heldStroke', alive, { alive });
        /* Released: the stroke stays usable for the 250 ms release window,
         * then expires. The old line asserted `after === false || true`,
         * which is true for every possible value and tested nothing. */
        g.swipe.up(.5, .40, t0 + .10); g.swipeReleasedAt = t0 + .10;
        const after = g.playerStrokeIntent();
        /* A released gesture keeps 250 ms of life, and this release is
         * 1.1 s old, so it has expired — the check that matters is that the
         * dead window is measured from the RELEASE, not from the last
         * sample. Exercise it directly with a release 50 ms ago. */
        check('heldStroke', after === null, { staleRelease: !!after });
        g.swipeReleasedAt = g.time - 0.05;
        const freshIntent = g.playerStrokeIntent();
        g.swipeReleasedAt = g.time - 0.40;
        const olderIntent = g.playerStrokeIntent();
        check('heldStroke', !!freshIntent && olderIntent === null, { fresh: !!freshIntent, older: !!olderIntent });
        g.swipe.cancel();
        g.swipe.down(.5, .5, g.time); g.swipe.pressZone = { accepted: true };
        g.swipe.up(.5, .5, g.time + 0.02); g.swipeReleasedAt = g.time + 0.02;
        check('heldStroke', g.playerStrokeIntent() === null, { tap: 'rejected' });
      }

      /* A BLOCK is the shot you play when a fast ball arrives at a bat that
       * is already in place: the hand made one short forward move and then
       * held still. It is the one technique where holding still is correct,
       * and the one that a fresh-sample-only intent test silently deleted. */
      /* 7 m/s is deliberately absent: a passive rebound of a slow ball is
       * ~2.5 m/s, and no face angle can carry that from the bat plane over
       * the tape — the player has to push it. 12+ is where a block is the
       * right shot. */
      for (const speed of [12, 16, 22]) {
        fresh({ bounces: [1], lastHitBy: -1 });
        g.pointer = { x: .5, y: .55 };
        step(2);
        const px = g.player.pos.x, py = g.player.pos.y, pz = g.player.pos.z;
        const t0 = g.time - 0.9;
        g.swipe.down(.5, .55, t0);
        g.swipe.move(.5, .47, t0 + .05);
        g.swipe.move(.5, .45, t0 + .09);
        g.swipe.pressZone = { accepted: true };
        put([px, py, pz - 0.85], [0, 0, speed]);
        let hit = false;
        for (let i = 0; i < 40 && !hit; i++) { g.pointer = { x: .5, y: .55 }; step(1); hit = g.ball.lastHitBy === 1; }
        let over = false, land = null;
        if (hit) {
          const rep = {};
          predict(V3.clone(g.ball.p), V3.clone(g.ball.v), V3.clone(g.ball.w),
            { dt: 1 / 600, maxT: 2.4, stopOnFirstBounce: true, out: rep });
          land = rep.landed && [+rep.landed.x.toFixed(2), +rep.landed.z.toFixed(2)];
          over = !rep.hitNet && rep.landed && rep.landed.z < 0 && Math.abs(rep.landed.x) <= PHh.T_HALF_WID + PHh.R;
        }
        const j = g.shotJournal && g.shotJournal.latest;
        check('heldStroke', hit && over, { block: speed, hit, over, land, v: +V3.len(g.ball.v).toFixed(1),
          stroke: j && j.stroke, valid: j && j.valid, face: j && j.contact && j.contact.normal,
          out: j && j.contact && j.contact.outgoing && j.contact.outgoing.v,
          assist: j && j.contact && j.contact.assist });
        g.swipe.cancel();
      }

      // ---------------------------------------------------------------
      // 14. a queued toss is released only while the finger is still down
      // ---------------------------------------------------------------
      sec('deferredToss');
      {
        fresh(); g.server = 1; g.prepServe(); g.recenterT = 0.2; g.tossQueued = true;
        g.pointerDown = false;
        g.updatePlayerPaddle(0.3);
        check('deferredToss', g.state === GS.SERVE_READY && !g.tossQueued, { state: g.state, queued: g.tossQueued });
        g.tossQueued = true; g.recenterT = 0.2; g.pointerDown = true;
        g.updatePlayerPaddle(0.3);
        check('deferredToss', g.state === GS.SERVE_TOSS, { state: g.state });
      }

      // ---------------------------------------------------------------
      // 15. no contacts once the point is over
      // ---------------------------------------------------------------
      sec('pointGate');
      {
        fresh({ bounces: [1], lastHitBy: -1 });
        g.setState(GS.POINT); g.stateT = 0;
        padTo(0, 1.02, 1.45);
        g.swipe.pressZone = { accepted: true };
        g.swipe.down(.5, .8, g.time); g.swipe.move(.5, .4, g.time + .06);
        put([0, 1.02, 1.45], [0, 0, -6]);
        g.tryPlayerHit(V3.clone(g.ball.p));
        check('pointGate', g.ball.lastHitBy === -1, { by: g.ball.lastHitBy });
        g.ai.plan = { t: g.time, speed: 8, aim: { x: 0, z: 1 }, archId: 'DRIVE' };
        const before = g.ball.lastHitBy;
        g.tryAiHit();
        check('pointGate', g.ball.lastHitBy === before, { by: g.ball.lastHitBy });
      }

      // ---------------------------------------------------------------
      // 16. a ball that leaves the arena still awards the point
      // ---------------------------------------------------------------
      sec('escape');
      {
        fresh({ bounces: [], lastHitBy: 1 });
        put([9.5, 0.5, 0], [5, 0, 0]);
        simPhysics(1);
        check('escape', !!g.lastPoint, { pt: g.lastPoint, state: g.state });
        fresh({ bounces: [1], lastHitBy: 1 });
        put([0, 0.5, 12], [0, 0, 5]);
        simPhysics(1);
        check('escape', !!g.lastPoint && g.lastPoint.who === -1, { pt: g.lastPoint });
      }

      // ---------------------------------------------------------------
      // 17. edge ball: outward normal, energy loss, still on the table
      // ---------------------------------------------------------------
      sec('edge');
      {
        for (const z of [PHh.T_HALF_LEN - 0.01, PHh.T_HALF_LEN + 0.01]) {
          const p = V3.new(0, PHh.TABLE_Y + PHh.R, z), v = V3.new(0, -5, -0.2), w = V3.new();
          const before = V3.len(v);
          const info = bounceTable(p, v, w);
          check('edge', !!info && Math.abs(v.z) > 0.05 && V3.len(v) < before * 1.15,
            { z: +z.toFixed(3), vz: +v.z.toFixed(2), before: +before.toFixed(2), after: +V3.len(v).toFixed(2) });
        }
      }

      // ---------------------------------------------------------------
      // 18. the tape deflects the ball UP and over, never through
      // ---------------------------------------------------------------
      sec('tape');
      {
        for (const vz of [-4, -8]) {
          const p = V3.new(0, PHh.NET_TOP + 0.003, 0.05), v = V3.new(0, 0.5, vz), w = V3.new();
          clipTape(p, v, w);
          check('tape', v.y > 0 && Math.abs(v.z) < Math.abs(vz) && p.y > PHh.NET_TOP, { vz, vy: +v.y.toFixed(2), vz2: +v.z.toFixed(2) });
        }
      }

      // ---------------------------------------------------------------
      // 19. topspin dips, backspin floats (sign convention, end to end)
      // ---------------------------------------------------------------
      sec('spinSign');
      {
        const fly = (wx) => {
          const o = {};
          predict(V3.new(0, 1.0, 0.9), V3.new(0, 0.05, -4), V3.new(wx, 0, 0),
            { dt: 1 / 600, maxT: 2.0, out: o });
          return o.apex;
        };
        const a = fly(300), flat = fly(0), b = fly(-300);
        /* The ball flies toward -z. Magnus is w x v, so for this flight a
         * POSITIVE w.x lifts the ball and a negative one presses it down.
         * The apex height is the clean, integration-free way to read it. */
        const dip = Math.min(a, b), float = Math.max(a, b);
        check('spinSign', dip < flat && float > flat, { plus300: +a.toFixed(3), flat: +flat.toFixed(3), minus300: +b.toFixed(3) });
      }

      // ---------------------------------------------------------------
      // 20. paddle substeps: the blade sweeps within the frame, not in one jump
      // ---------------------------------------------------------------
      sec('substepPad');
      {
        fresh({ bounces: [1], lastHitBy: -1 });
        g.pointer = { x: .5, y: .55 };
        padTo(0, 1.02, 1.45);
        const before = V3.clone(g.player.pos);
        g.player.prevPos && V3.copy(g.player.prevPos, before);
        V.set(g.player.pos, 0.35, 1.02, 1.45);
        const poses = [];
        for (let k = 0; k < 6; k++) poses.push(g.substepPadPose(k, 6).pos.x);
        let monotone = true;
        for (let i = 1; i < poses.length; i++) if (poses[i] < poses[i - 1] - 1e-9) monotone = false;
        check('substepPad', monotone && Math.abs(poses[0] - before.x) < 0.36, { poses: poses.map(v => +v.toFixed(3)) });
        check('substepPad', poses[poses.length - 1] <= 0.35 + 1e-9, { last: +poses[poses.length - 1].toFixed(3) });
      }

      return { checks, sections: out.sections, failures: out.failures, errors: [] };
    });
    result.errors = errors;
    console.log(JSON.stringify(result, null, 1).slice(0, 20000));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
