/* Capture every main menu page for the collage.
 *
 * Two groups, two viewports, because they are two different surfaces:
 *   hub   — full-screen pages including header and dock (390×844)
 *   sheet — modal sheets that sit above the table (390×640), so the frame
 *           is filled instead of leaving half a screen of blurred table.
 */
const puppeteer = require('/home/user/tabletennis/node_modules/puppeteer-core');
const chromium = require('/home/user/tabletennis/node_modules/@sparticuz/chromium');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const HUB = { width: 390, height: 844 };
const SHEET = { width: 390, height: 844 };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: await chromium.executablePath(),
    args: chromium.args,
    headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: '/tmp/topspin-browser-libs/lib' },
  });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('ERR ' + e.message));
  await page.setViewport({ ...HUB, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  const shot = async (name) => {
    await wait(420);
    await page.screenshot({ path: '/tmp/c-' + name + '.png' });
    console.log('shot', name);
  };
  const boot = async () => {
    await page.goto('file:///home/user/tabletennis/play/index.html');
    await wait(2200);
  };
  const viewport = async (v) => {
    await page.setViewport({ ...v, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await wait(260);
  };
  const clear = () => page.evaluate(() => {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
    document.getElementById('menu').classList.add('on');
    window.__game.ui.hub.setView('play');
  });

  /* ------------------------------- splash ------------------------------ */
  await page.goto('file:///home/user/tabletennis/play/index.html');
  await wait(620);
  await page.screenshot({ path: '/tmp/c-01-splash.png' });
  console.log('shot 01-splash');
  await wait(2200);

  /* -------------------------------- hub -------------------------------- */
  await shot('02-home');
  await page.evaluate(() => document.querySelector('.dossier').scrollIntoView({ block: 'start' }));
  await shot('03-dossier');
  await page.evaluate(() => window.__game.ui.hub.setView('career'));
  await shot('04-career');
  await page.evaluate(() => window.__game.ui.hub.setView('workshop'));
  await shot('05-workshop');
  await page.evaluate(() => window.__game.ui.showWorkshop('shop'));
  await shot('06-shop');
  await page.evaluate(() => window.__game.ui.showWorkshop('daily'));
  await shot('07-daily');
  await page.evaluate(() => {
    window.__game.ui.hub.setView('play');
    window.__game.ui.openSettings();
    document.getElementById('settingsBody').scrollTop = 0;
    window.__game.ui.hub.setSettingsNav('secGrip');
  });
  await shot('08-settings');
  await page.evaluate(() => document.querySelector('#settingsNav [data-sec="secAssist"]').click());
  await shot('09-assist');

  /* ------------------------------- sheets ------------------------------ */
  await viewport(SHEET);
  await page.evaluate(() => window.__game.ui.closeSettings());
  await clear();
  await page.evaluate(() => document.getElementById('careerStart').click());
  await shot('10-career-intro');
  await page.evaluate(() => document.getElementById('crReady').click());
  await shot('11-opponents');
  await page.evaluate(() => {
    const g = window.__game;
    g.career.currentRound = 1;
    g.career.pendingPerks = PERKS.slice(0, 3);
    g.ui.showCareerPerks(g.career);
  });
  await shot('12-perk');
  await page.evaluate(() => {
    const g = window.__game;
    g.career.stop();
    g.career.currentTournament = 3;
    g.career.state = 'RUN_END';
    g.career.totalWins = 9; g.career.totalLosses = 2; g.career.runStats.maxSpeed = 87;
    g.ui.showCareerRunEnd(g.career);
  });
  await shot('13-career-end');
  await clear();
  await page.evaluate(() => {
    const g = window.__game;
    g.moments.kept = [
      { score: 0.78, shots: 14, speed: 74, spin: 168, finish: 'SMASH', meta: { matchPoint: true } },
      { score: 0.62, shots: 9, speed: 58, spin: 142, finish: 'LOOP', meta: { deuce: true } },
      { score: 0.41, shots: 6, speed: 49, spin: 120, finish: 'FADE', meta: { netClip: true } },
    ];
    g.ui.showMoments();
  });
  await shot('14-moments');
  await page.evaluate(() => document.getElementById('reels').classList.remove('on'));
  await page.evaluate(() => {
    const g = window.__game;
    g.startMatch(2);
    g.score = [11, 7];
    g.stats.shots = 24; g.stats.maxSpeed = 61.4; g.stats.maxSpin = 184; g.stats.totalSpin = 2400;
    g.bestRally = 9; g.stats.byStroke = { LOOP: 12, SMASH: 5, BLOCK: 7 };
    g.lastReward = { coins: 30, xp: 120 };
    g.state = GS.MATCH_END;
    document.getElementById('menu').classList.remove('on');
    g.ui.showMatchEnd(true);
  });
  await shot('15-over');
  await page.evaluate(() => {
    const g = window.__game;
    document.getElementById('over').classList.remove('on');
    document.getElementById('menu').classList.remove('on');
    document.body.classList.add('is-playing');
    g.startMatch(2);
    g.setPaused(true);
  });
  await shot('16-pause');
  await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(false);
    g.ui.openShotLab();
  });
  await shot('17-shotlab');
  await page.evaluate(() => {
    const g = window.__game;
    g.ui.closeShotLab();
    g.returnToMenu();
    document.getElementById('menu').classList.remove('on');
    document.getElementById('tdone').classList.add('on');
  });
  await shot('18-training');
  await page.evaluate(() => {
    document.getElementById('tdone').classList.remove('on');
    document.getElementById('menu').classList.add('on');
    window.__game.ui.hub.openMore();
  });
  await shot('19-more');
  await page.evaluate(() => {
    document.getElementById('hubMore').classList.remove('on');
    const g = window.__game;
    document.getElementById('menu').classList.remove('on');
    g.startDemo(2);
  });
  await wait(1400);
  await shot('20-demo');
  await page.evaluate(() => {
    const g = window.__game;
    g.stopDemo();
    g.returnToMenu();
    document.getElementById('onlineStart').click();
  });
  await wait(1600);
  await shot('21-online');

  console.log(errs.join('\n') || 'no-errors');
  await browser.close();
})();
