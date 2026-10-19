'use strict';
/* Full-match invariants.
 *
 * Every other harness in tt/tools pokes the game with a fixture it built
 * itself. This one lets the game play itself (demo mode, three levels) and
 * asks only one question of the live data: can a contact ever happen from a
 * place the rules and the reach model make impossible?
 *
 * Checked per contact:
 *   ownSide     contact on the hitter's own side of the net
 *   reach       pre-snap blade-to-ball distance inside the capture radius
 *   tableHigh   contact not below the playing surface by more than a bat
 *   lateral     contact inside the authored lateral reach
 *   doubleSide  no contact after the ball bounced twice on the hitter's side
 *   deadBall    no contact with a ball that is no longer live
 *   state       no rally contact outside RALLY
 * Checked per point:
 *   serveFaults / lets / stuck tosses (a serve that never starts)
 *   hit counts that are not followed by a legal landing
 *
 * A violation is a game bug: the fix belongs in tryPlayerHit/tryAiHit or in
 * the reach model, never in this file.
 */
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
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 760 });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(pathToFileURL(path.join(root, 'play/index.html')).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
  await page.waitForFunction(() => window.__game.music._initialized);

  const result = await page.evaluate(() => {
    const g = window.__game;
    const CAPTURE = MATCH_RULES.captureRadius;
    const out = { matches: [], contacts: 0, violations: {}, examples: [], perLevel: {} };
    const bump = (k, ex) => {
      out.violations[k] = (out.violations[k] || 0) + 1;
      if (out.examples.length < 20) out.examples.push({ k, ...ex });
    };

    for (const lvl of [0, 2, 4]) {
      const agg = { points: 0, serveFaults: 0, lets: 0, stuck: 0, hits: 0, misses: 0, serves: 0,
        pointsByReason: {}, crossNet: 0, ownSideLand: 0, outLand: 0, netHit: 0 };
      out.perLevel[lvl] = agg;
      for (let m = 0; m < 4; m++) {
        g.startDemo(lvl); g.setPaused(false);
        let steps = 0;

        const protoApply = g.applyHit;
        g.applyHit = function (side, racket, contact, quality, info) {
          out.contacts++;
          agg.hits++;
          const b = this.ball;
          const pre = g.__preHit;                     // stamped by the wrappers below
          const dist = pre ? Math.hypot(pre.pad.x - contact.x, pre.pad.y - contact.y, pre.pad.z - contact.z) : -1;
          /* Legality of the contact point itself. */
          if (side > 0 && contact.z < PADDLE_LIMITS.zStepIn - CAPTURE - 0.01) bump('playerOverNet', { contact: [contact.x, contact.y, contact.z] });
          if (side < 0 && contact.z > -(PADDLE_LIMITS.zStepIn - CAPTURE - 0.01)) bump('aiOverNet', { contact: [contact.x, contact.y, contact.z] });
          /* Only the PLAYER has an absolute envelope (PADDLE_LIMITS). The
           * AI's contract is its own paddle plus the 0.42 m strike radius,
           * which `reach` below already checks; applying the player's box to
           * it produced a "violation" for a ball 7 cm outside a limit the AI
           * was never given. */
          if (side > 0 && contact.y < PH.TABLE_Y + PADDLE_LIMITS.yLo - CAPTURE - 0.01) bump('playerBelowTable', { side,
            contact: [+contact.x.toFixed(2), +contact.y.toFixed(2), +contact.z.toFixed(2)],
            pad: pre ? [+pre.pad.x.toFixed(2), +pre.pad.y.toFixed(2), +pre.pad.z.toFixed(2)] : null,
            ball: [+b.p.x.toFixed(2), +b.p.y.toFixed(2), +b.p.z.toFixed(2)],
            v: [+b.v.x.toFixed(2), +b.v.y.toFixed(2), +b.v.z.toFixed(2)],
            state: this.state, rb: this.rallyBounces.slice(), stroke: racket && racket.stroke && racket.stroke.id });
          /* |x| <= PADDLE_LIMITS.x + MATCH_RULES.captureRadius for the model;
           * the check below adds only its explicit 1 cm numerical slack. */
          if (side > 0 && Math.abs(contact.x) > PADDLE_LIMITS.x + CAPTURE + 0.01) bump('playerLateral', { side,
            contact: [+contact.x.toFixed(3), +contact.y.toFixed(3), +contact.z.toFixed(3)],
            pad: pre ? [+pre.pad.x.toFixed(3), +pre.pad.y.toFixed(3), +pre.pad.z.toFixed(3)] : null });
          if (dist > CAPTURE + 0.06) bump('reach', { dist: +dist.toFixed(3), contact: [contact.x, contact.y, contact.z] });
          const mine = (s) => (side > 0 ? s > 0 : s < 0);
          if (this.rallyBounces.filter(mine).length >= 2) bump('doubleSide', { rb: this.rallyBounces.slice() });
          if (!b.live) bump('deadBall', {});
          if (this.state !== GS.RALLY && this.state !== GS.SERVE_TOSS) bump('badState', { state: this.state });
          /* A serve clears rallyBounces immediately before applyHit; that is
           * the only contact for which the ball has not bounced yet. */
          const isServe = this.rallyBounces.length === 0;
          /* Where does the shot actually go? */
          const pred = {};
          const bb = V3.clone(b.p), bv = V3.clone(b.v), bw = V3.clone(b.w);
          predict(bb, bv, bw, { dt: 1 / 260, maxT: 2.4, stopOnFirstBounce: true, out: pred });
          if (pred.hitNet) agg.netHit++;
          else if (pred.landed) {
            const sgn = side > 0 ? -1 : 1;
            if (pred.landed.z * sgn > 0.02) agg.crossNet++;
            else agg.ownSideLand++;
            if (Math.abs(pred.landed.x) > PH.T_HALF_WID + PH.R || Math.abs(pred.landed.z) > PH.T_HALF_LEN + PH.R) agg.outLand++;
            if (isServe) {
              /* ITTF 2.06.2: the serve must first touch the server's court. */
              const mine = side > 0 ? 1 : -1;
              agg.serves++;
              if (pred.landed.z * mine < -0.02) bump('serveFirstBounceWrongSide', { landed: [pred.landed.x, pred.landed.z] });
              else if (Math.abs(pred.landed.x) > PH.T_HALF_WID + PH.R ||
                pred.landed.z * mine > PH.T_HALF_LEN + PH.R) bump('serveFirstBounceOffTable', { landed: [pred.landed.x, pred.landed.z] });
            }
          }
          return protoApply.call(this, side, racket, contact, quality, info);
        };

        const wrap = (name) => {
          const proto = g[name];
          if (typeof proto !== 'function') return;
          g[name] = function (...a) {
            g.__preHit = { pad: V3.clone((name === 'tryPlayerHit' ? this.player : this.aiPaddle).pos) };
            try { return proto.apply(this, a); } finally { g.__preHit = null; }
          };
        };
        wrap('tryPlayerHit'); wrap('tryAiHit');

        const protoAward = g.awardPoint;
        g.awardPoint = function (who, reason) {
          const live = this.state !== GS.POINT && this.state !== GS.MATCH_END && this.state !== GS.MATCH_END;
          const before = this.score.slice();
          const r = protoAward.call(this, who, reason);
          const scored = this.score[0] !== before[0] || this.score[1] !== before[1];
          if (scored) {
            agg.points++;
            agg.pointsByReason[reason] = (agg.pointsByReason[reason] || 0) + 1;
            if (/ПОДАЧ/.test(reason)) agg.serveFaults++;
            if (/ПЕРЕИГРОВКА/.test(reason)) agg.lets++;
          } else if (live) {
            /* Refused (already in POINT) — that is the state gate doing its
             * job; count it so a regression that scores twice is visible. */
            bump('doubleAward', { state: this.state, reason });
          }
          return r;
        };

        while (g.state !== GS.MATCH_END && steps < 60 * 240) {
          g.update(1 / 60);
          agg.aiMaxX = Math.max(agg.aiMaxX || 0, Math.abs(g.ai.pos.x));
          agg.playerMaxX = Math.max(agg.playerMaxX || 0, Math.abs(g.player.pos.x));
          steps++;
          if (g.state === GS.SERVE_TOSS && g.stateT > 3.4) agg.stuck++;
          if (g.state === GS.SERVE_READY && g.stateT > 3.4) agg.stuck++;
        }
        g.awardPoint = protoAward;
        g.applyHit = protoApply;
        /* restore the hit wrappers for the next match */
        agg.stuck = agg.stuck; // kept per level
        out.matches.push({ lvl, m, score: g.score.slice(), steps, rally: g.rally });
        g.returnToMenu();
      }
    }
    return out;
  });

  const brief = {
    contacts: result.contacts,
    violations: result.violations,
    examples: result.examples,
    perLevel: result.perLevel,
    pageErrors,
  };
  console.log(JSON.stringify(brief, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
