/* Integrated shell + actual WebGL engine. No simulated bridge or curriculum. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { repo } = require('./helpers.cjs');

(async () => {
  execFileSync('python3', [path.join(repo, 'source/build.py')], { stdio: 'inherit' });
  const custom = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);
  const browser = await puppeteer.launch({ executablePath: custom || await chromium.executablePath(), headless: true,
    args: custom ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required'] : chromium.args });
  let checks = 0;
  try {
    for (const [width, height] of [[1280, 800], [390, 844], [320, 568]]) {
      const context = await browser.createBrowserContext();
      const touch = width < 600, page = await context.newPage(), errors = [];
      await page.setViewport({ width, height, isMobile: touch, hasTouch: touch });
      await page.setRequestInterception(true);
      page.on('request', r => /^https?:/.test(r.url()) ? r.abort() : r.continue());
      page.on('pageerror', e => errors.push(e.message));
      const activate = async selector => {
        await page.$eval(selector, el => {
          const scroll = el.closest('.academy-scroll');
          if (scroll) scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + el.offsetHeight / 2 - scroll.clientHeight / 2;
        });
        return touch ? page.tap(selector) : page.click(selector);
      };
      const screenshot = async name => {
        const bounds = await page.evaluate(() => {
          const r = document.querySelector('.academy-dialog').getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: innerHeight, scroll: document.querySelector('.academy-dialog').closest('.screen').scrollTop };
        });
        assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height, JSON.stringify(bounds));
        if (process.env.ACADEMY_SHOTS) await page.screenshot({ path: path.join(process.env.ACADEMY_SHOTS, `academy-${name}-${width}.png`) });
      };
      await page.goto(pathToFileURL(path.join(repo, 'play/index.html')).href + '?s=train', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('.academy-lesson', { timeout: 60000 });
      const catalog = await page.evaluate(() => ({ lessons: GameHost.trainingCatalog.lessons.length,
        strokes: GameHost.trainingCatalog.strokes.length, skills: GameHost.trainingCatalog.skills.length,
        hidden: document.querySelector('.academy-live').hidden, started: !!(GameHost.mode && GameHost.mode.type === 'train') }));
      assert.deepEqual(catalog, { lessons: 38, strokes: 16, skills: 48, hidden: true, started: false }); checks++;
      const baseline = await page.evaluate(() => ({ coins: S.coins, gems: S.gems, elo: S.elo }));
      await activate('.academy-lesson[data-choice="HIT"]');
      const frame = await (await page.$('#gamelayer iframe')).contentFrame();
      await frame.waitForFunction(() => window.__game && window.__game.training && window.__game.training.phase === 'intro');
      await page.waitForSelector('.academy-dialog [data-act="start"]');
      const intro = await frame.evaluate(() => ({ phase: window.__game.training.phase, live: window.__game.ball.live,
        input: window.__game.ui.inputMode, paddle: window.__game.playerPaddleVisible, embeddedCard: getComputedStyle(document.getElementById('tIntro')).display }));
      assert.deepEqual(intro, { phase: 'intro', live: false, input: touch ? 'touch' : 'mouse', paddle: !touch, embeddedCard: 'none' }); checks++;
      const geometry = await page.evaluate(() => {
        const d = document.querySelector('.academy-dialog').getBoundingClientRect();
        return { fits: d.width <= innerWidth && d.height <= innerHeight && d.top >= 0 && d.bottom <= innerHeight,
          views: [...document.querySelectorAll('.academy-dialog svg[data-demo-view]')].filter(svg => !svg.closest('details:not([open])') && svg.getBoundingClientRect().height > 0).length,
          text: document.querySelector('.academy-dialog-scroll').innerText.length,
          details: document.querySelector('.academy-dialog details').open,
          taps: document.querySelector('.academy-dialog [data-input=touch]').textContent };
      });
      assert.ok(geometry.fits && geometry.views === 1 && !geometry.details && geometry.text < 500 && /коротк|brief/i.test(geometry.taps), JSON.stringify(geometry)); checks++;
      const finiteCursor = await page.evaluate(() => new Promise(resolve => {
        const saved = window.requestAnimationFrame;
        window.requestAnimationFrame = cb => saved.call(window, now => cb(now - 10000));
        try { Router.screens.train.playDemo(); } finally { window.requestAnimationFrame = saved; }
        saved.call(window, () => {
          const cursor = document.querySelector('.academy-dialog .academy-gesture .academy-demo-ball');
          resolve(Number.isFinite(Number(cursor.getAttribute('cx'))) && Number.isFinite(Number(cursor.getAttribute('cy'))));
        });
      }));
      assert.equal(finiteCursor, true, 'a frame timestamp before animation start must stay at the start point'); checks++;
      await activate('.academy-dialog [data-act="start"]');

      // Real pointer events drive the same contact/collision pipeline as play.
      // The first frozen opportunity uses the visible contact marker; later
      // taps meet the live ball after its legal bounce.
      const attempt = async () => {
        if (await frame.evaluate(() => window.__game.training.phase === 'fail' && window.__game.training.stage !== 'check')) {
          await page.waitForSelector('.academy-dialog [data-act="retry"]'); await activate('.academy-dialog [data-act="retry"]');
        }
        await new Promise(resolve => setTimeout(resolve, 110));
        return frame.evaluate(() => {
          const g = window.__game, t = g.training, cv = g.canvas;
          g.paused = false; let sent = false; const before = t.stats.attempts;
          for (let i = 0; i < 1100 && !['question', 'review', 'done'].includes(t.phase); i++) {
            if (t.phase === 'live' && !sent && g.ball.live && g.ball.lastHitBy === -1 &&
                g.rallyBounces.includes(1) && (t.frozen || g.ball.p.z >= 1.10 && g.ball.p.z <= 2.1 && g.ball.p.y >= .94 && g.ball.p.y <= 1.43)) {
              const cue = t.frozen && t.coachCue(), p = g.project(cue ? cue.p : g.ball.p, {}), r = cv.getBoundingClientRect();
              if (p.ok && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
                const pointerType = g.ui.inputMode, pointerId = 700 + t.stats.attempts;
                for (const type of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(type,
                  { pointerId, pointerType, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                    clientX: r.left + p.x * r.width, clientY: r.top + p.y * r.height, bubbles: true, cancelable: true }));
                sent = true;
              }
            }
            g.update(1 / 60);
            if (t.stats.attempts > before && ['ok', 'fail'].includes(t.phase)) break;
          }
          g.paused = true;
          return { phase: t.phase, done: t.done, attempts: t.attempts, result: t.result, message: t.msg };
        });
      };
      let practice;
      for (let n = 0; n < 12; n++) { practice = await attempt(); if (practice.phase === 'question') break; }
      assert.equal(practice.phase, 'question', JSON.stringify(practice));
      await page.waitForFunction(() => S.training.lessons.HIT && S.training.lessons.HIT.practiced && document.querySelector('[data-answer="wait"]'));
      assert.equal(await page.evaluate(() => S.training.lessons.HIT.mastered), false); checks++;
      await activate('.academy-dialog [data-answer="wait"]');
      await frame.waitForFunction(() => window.__game.training.stage === 'check' && window.__game.training.phase === 'intro');
      assert.equal(await frame.evaluate(() => window.__game.ball.live), false); checks++;
      await page.waitForSelector('.academy-dialog [data-act="start"]'); await activate('.academy-dialog [data-act="start"]');
      let check;
      for (let n = 0; n < 4; n++) check = await attempt();
      assert.equal(check.phase, 'review', JSON.stringify(check));
      assert.ok(check.done >= 3, JSON.stringify(check));
      await page.waitForFunction(() => S.training.lessons.HIT && S.training.lessons.HIT.mastered);
      assert.deepEqual(await page.evaluate(() => ({ coins: S.coins, gems: S.gems, elo: S.elo })), baseline); checks++;
      await page.waitForSelector('.academy-dialog [data-act="continue"]'); await activate('.academy-dialog [data-act="continue"]');
      await frame.waitForFunction(() => window.__game.training.S.id === 'DRIVE');
      await page.waitForSelector('.academy-dialog [data-act="skip"]'); await activate('.academy-dialog [data-act="skip"]');
      await page.waitForFunction(() => !document.querySelector('.academy-menu').hidden);
      assert.equal(await page.evaluate(() => !!(S.training.lessons.DRIVE && S.training.lessons.DRIVE.mastered)), false); checks++;

      await activate('[data-mode="stroke"]'); await activate('.academy-pick[data-choice="LOOP"]'); await activate('.academy-selection [data-act="open"]');
      await frame.waitForFunction(() => window.__game.training && window.__game.training.S.stroke === 'LOOP');
      await page.waitForSelector('.academy-dialog [data-act="start"]'); await screenshot('motion');
      await activate('.academy-dialog [data-act="start"]');
      const failedStroke = await attempt();
      assert.equal(failedStroke.phase, 'fail', JSON.stringify(failedStroke));
      await page.waitForSelector('.academy-dialog [data-feedback="tap"]');
      const correction = await frame.evaluate(() => {
        const t = window.__game.training, before = [t.attempts, t.done];
        t.update(8);
        return { phase: t.phase, before, after: [t.attempts, t.done], feedback: t.feedback };
      });
      assert.equal(correction.phase, 'fail'); assert.deepEqual(correction.before, correction.after);
      assert.ok(correction.feedback.actual.gesture.points.length > 0, 'real pointer sample survived input cancellation');
      assert.equal(correction.feedback.expected.id, 'LOOP');
      assert.equal(await page.$eval('.academy-dialog [data-motion="actual"]', el => el.tagName.toLowerCase()), 'path');
      await screenshot('feedback'); checks++;
      await activate('.academy-dialog [data-act="retry"]');
      await frame.waitForFunction(() => ['wait', 'live'].includes(window.__game.training.phase));
      assert.deepEqual(await frame.evaluate(() => [window.__game.training.attempts, window.__game.training.done]), correction.before); checks++;
      await activate('.academy-live [data-act="academy"]');
      await frame.waitForFunction(() => !window.__game.training);

      await activate('.academy-pick[data-choice="LOB"]');
      assert.equal(await page.evaluate(() => Router.screens.train.selected().id), 'LOB', 'stroke selection must accept the click');
      await activate('.academy-selection [data-act="open"]');
      assert.equal(await page.evaluate(() => Router.screens.train.active && Router.screens.train.active.mode), 'stroke', 'practice button must open the selected stroke');
      await frame.waitForFunction(() => window.__game.training && window.__game.training.S.stroke === 'LOB');
      const lob = await frame.evaluate(() => ({ id: window.__game.training.S.stroke, phase: window.__game.training.phase,
        apex: Math.max(...window.__game.training.snapshot().diagram.recommended.map(p => p[1])) }));
      assert.ok(lob.id === 'LOB' && lob.phase === 'intro' && lob.apex >= 1.3); checks++;
      await page.waitForSelector('.academy-dialog [data-act="demo"]');
      const stoppedTime = await frame.evaluate(() => window.__game.time);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await activate('.academy-dialog [data-act="demo"]');
      assert.equal(await frame.evaluate(() => window.__game.time), stoppedTime);
      assert.equal(await page.evaluate(() => Router.screens.train.demoRAF), null); checks++;
      await activate('.academy-dialog [data-act="academy"]');
      await activate('[data-mode="accuracy"]'); await activate('.academy-pick[data-choice="corners"]'); await activate('.academy-selection [data-act="open"]');
      await frame.waitForFunction(() => window.__game.training && window.__game.training.mode === 'accuracy');
      const zone = await frame.evaluate(() => window.__game.training.currentTarget);
      assert.ok(zone.z1 < -.7 && (zone.x0 > 0 || zone.x1 < 0)); checks++;
      await activate('.academy-dialog [data-act="start"]');
      const missedTarget = await attempt(); assert.equal(missedTarget.phase, 'fail', JSON.stringify(missedTarget));
      await page.waitForSelector('.academy-dialog [data-feedback="outside"]');
      assert.equal(await page.$eval('.academy-dialog .academy-placement svg', svg => svg.getAttribute('viewBox')), '0 0 240 210'); checks++;
      await screenshot('placement');
      await activate('.academy-dialog [data-act="reference"]');
      await frame.waitForFunction(() => window.__game.paused);
      const time = await frame.evaluate(() => window.__game.time);
      await activate('.academy-dialog .academy-details summary');
      assert.equal(await frame.evaluate(() => window.__game.time), time); checks++;
      await activate('.academy-dialog [data-act="reference-back"]');
      await activate('.academy-dialog [data-act="academy"]');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.academy-lesson', { timeout: 60000 });
      assert.equal(await page.evaluate(() => S.training.lessons.HIT.mastered), true); checks++;
      assert.deepEqual(errors, []);
      console.log(`academy ${width}x${height}: physical contact, concise motion guide, retained correction, actual trace, placement and mastery passed`);
      await context.close();
    }
    console.log(`academy browser: ${checks} integrated assertions passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
