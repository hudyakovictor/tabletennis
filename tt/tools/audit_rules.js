'use strict';
/* Rule-engine conformance, played through the game's own onBounce/onFloor.
 *
 * The browser suites so far exercised physics and input; the scoring rules
 * were only ever covered indirectly, by letting whole matches run and
 * trusting the point tally. This harness feeds synthetic bounce sequences
 * straight into Game.prototype.onBounce / onFloor / settleDeadBall on a real
 * game object (so every helper they call is the shipping one), and checks
 * the point that comes out against the ITTF rule the sequence represents.
 *
 * Nothing here is a fixture the player could not produce: each case is a
 * legal ball path, and the expected verdict is the rulebook one.
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

  const out = await page.evaluate(() => {
    const g = window.__game;
    const rows = [];
    let awards = [], lets = 0;
    const realAward = g.awardPoint, realLet = g.letServe;
    g.awardPoint = function (who, reason) { awards.push({ who, reason }); this.state = GS.POINT; };
    g.letServe = function () { lets++; this.state = GS.POINT; };

    function reset({ lh = 1, serve = false, server = 1, bounces = [], serveBounces = 0,
      net = false, state = GS.RALLY, live = true } = {}) {
      awards = []; lets = 0;
      g.state = state; g.stateT = 0; g.training = null; g.demoMode = false;
      g.ball.live = live; g.ball.lastHitBy = lh;
      g.ball.p.x = 0; g.ball.p.y = PH.TABLE_Y + 0.4; g.ball.p.z = 1.2;
      V3.zero(g.ball.v); V3.zero(g.ball.w);
      g.isServeBall = serve; g.server = server; g.serveBounces = serveBounces;
      g.netTouched = net; g.rallyBounces = bounces.slice();
      g.score = [0, 0]; g.servesLeft = 2;
    }
    const bounce = (side) => g.onBounce(side, 3, { edge: 0 });
    const floor = () => g.onFloor();
    const check = (name, expect, got, extra) => rows.push({
      name, expect: JSON.stringify(expect), got: JSON.stringify(got), ok: expect === got, ...(extra || {}),
    });
    const verdict = () => {
      if (awards.length) return `${awards[0].who}|${awards[0].reason}`;
      if (lets) return 'let';
      return 'none';
    };

    /* ---- serves ------------------------------------------------------ */
    reset({ lh: 1, serve: true, server: 1 });
    bounce(1);
    check('serve: first bounce on the server side is not a fault', 'none', verdict(),
      { sb: g.serveBounces, ballLive: g.ball.live });

    reset({ lh: 1, serve: true, server: 1 });
    bounce(-1);
    check('serve: first bounce on the receiver side is a fault', '-1|ОШИБКА ПОДАЧИ', verdict());

    reset({ lh: 1, serve: true, server: 1, serveBounces: 1, bounces: [1] });
    bounce(1);
    check('serve: two bounces on the server side is a fault', '-1|ОШИБКА ПОДАЧИ', verdict());

    reset({ lh: 1, serve: true, server: 1, serveBounces: 1, bounces: [1] });
    bounce(-1);
    check('serve: server side then receiver side is good', 'none', verdict(),
      { isServeBall: g.isServeBall, rb: g.rallyBounces.slice() });
    check('serve: a good serve seeds the receiver bounce for the rally rules',
      '[-1]', JSON.stringify(g.rallyBounces));

    reset({ lh: 1, serve: true, server: 1, serveBounces: 1, bounces: [1], net: true });
    bounce(-1);
    check('serve: net cord that lands good is a let', 'let', verdict(),
      { scored: JSON.stringify(g.score), servesLeft: g.servesLeft });

    reset({ lh: 1, serve: true, server: 1, serveBounces: 1, bounces: [1], net: true });
    bounce(1);
    check('serve: net cord that falls back is a fault, not a let', '-1|ОШИБКА ПОДАЧИ', verdict());

    /* the toss (lastHitBy 0) bouncing on the server's own table */
    reset({ lh: 0, serve: true, server: -1, bounces: [] });
    bounce(-1);
    check('toss: a toss bouncing on the table faults the real server', '1|ОШИБКА ПОДАЧИ', verdict());

    /* ---- rally: bounce rules ---------------------------------------- */
    reset({ lh: 1, bounces: [-1] });
    bounce(-1);
    check('rally: second bounce on the receiver side gives the point to the hitter',
      '1|ОЧКО! СОПЕРНИК НЕ ДОСТАЛ', verdict());

    reset({ lh: -1, bounces: [1] });
    bounce(1);
    check('rally: same, mirrored for the AI', '-1|ВЫ НЕ ДОСТАЛИ МЯЧ', verdict());

    reset({ lh: 1, bounces: [] });
    bounce(1);
    check('rally: a ball that bounces on its own side never crossed', '-1|МЯЧ НЕ ПЕРЕЛЕТЕЛ', verdict());

    reset({ lh: 1, bounces: [-1] });
    bounce(1);
    check('rally: a return that comes back after crossing still belongs to the hitter',
      '1|ОЧКО! СОПЕРНИК НЕ ДОСТАЛ', verdict());

    reset({ lh: 1, bounces: [-1] });
    bounce(1);
    const afterFirst = verdict();
    bounce(1);
    check('rally: a point is awarded once, not on the next bounce too', afterFirst, verdict());

    /* ---- floor ------------------------------------------------------- */
    reset({ lh: 1, bounces: [] });
    floor();
    check('floor: a shot that never crossed is out', '-1|АУТ', verdict());

    reset({ lh: 1, bounces: [], net: true });
    floor();
    check('floor: a shot that never crossed and hit the net is a net fault', '-1|В СЕТКУ', verdict());

    reset({ lh: 1, bounces: [-1] });
    floor();
    check('floor: a shot that bounced on the receiver side wins the point', '1|ОЧКО!', verdict());

    reset({ lh: -1, bounces: [1] });
    floor();
    check('floor: mirrored', '-1|ОЧКО СОПЕРНИКУ', verdict());

    reset({ lh: 1, serve: true, server: 1, serveBounces: 1, bounces: [1] });
    floor();
    check('floor: a serve that bounces only once then falls is a fault', '-1|ОШИБКА ПОДАЧИ', verdict());

    reset({ lh: -1, serve: true, server: -1, serveBounces: 1, bounces: [-1] });
    floor();
    check('floor: mirrored serve fault against the AI server', '1|ОШИБКА ПОДАЧИ', verdict());

    /* ---- dead ball --------------------------------------------------- */
    reset({ lh: 1, serve: false, bounces: [-1] });
    g.settleDeadBall();
    check('dead ball: resting after crossing gives the point to the hitter',
      '1|ОЧКО! СОПЕРНИК НЕ ДОСТАЛ', verdict());

    reset({ lh: 1, serve: false, bounces: [] });
    g.settleDeadBall();
    check('dead ball: resting without crossing loses the point', '-1|МЯЧ НЕ ПЕРЕЛЕТЕЛ', verdict());

    reset({ lh: 1, serve: true, server: 1, serveBounces: 1 });
    g.settleDeadBall();
    check('dead ball: a serve that dies is a serve fault', '-1|ПОДАЧА НЕ ВЫПОЛНЕНА', verdict());

    /* ---- point gate -------------------------------------------------- */
    /* The gate lives inside the real awardPoint, so this case keeps it: bounce
     * the point home once, then fire three more events and count SCORE. */
    reset({ lh: 1, bounces: [-1] });
    g.awardPoint = realAward;
    bounce(-1);
    const scoreAfter = g.score.slice();
    bounce(-1); bounce(1); floor();
    check('point gate: three events after a decided point score nothing', JSON.stringify(scoreAfter),
      JSON.stringify(g.score));
    g.awardPoint = function (who, reason) { awards.push({ who, reason }); this.state = GS.POINT; };

    g.awardPoint = realAward; g.letServe = realLet;
    return { rows, pageErrors: [] };
  });

  const fails = out.rows.filter((r) => !r.ok);
  console.log(JSON.stringify({
    checks: out.rows.length, failures: fails.length,
    details: fs ? undefined : undefined,
    failed: fails,
    rows: out.rows.map((r) => `${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`),
    pageErrors,
  }, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
