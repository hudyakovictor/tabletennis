/* Integrated shell + actual WebGL engine. No simulated bridge or curriculum. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { repo } = require('./helpers.cjs');

(async () => {
  if (process.env.ACADEMY_SKIP_BUILD !== '1') execFileSync('python3', [path.join(repo, 'source/build.py')], { stdio: 'inherit' });
  const custom = process.env.CHROME_BIN || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : null);
  const browser = await puppeteer.launch({ executablePath: custom || await chromium.executablePath(), headless: true,
    // This suite uses separate browser contexts; Chromium cannot create them
    // in the package's single-process mode.
    args: custom ? ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required']
      : chromium.args.filter(arg => arg !== '--single-process') });
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
          const scroll = el.closest('.academy-scroll, .academy-dialog-scroll');
          if (scroll) scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + el.offsetHeight / 2 - scroll.clientHeight / 2;
        });
        return touch ? page.tap(selector) : page.click(selector);
      };
      const screenshot = async name => {
        const dialog = await page.$('.academy-dialog:not([hidden])');
        if (!dialog) return;
        const bounds = await page.evaluate(() => {
          const d = document.querySelector('.academy-dialog'), r = d.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: innerHeight, width: r.width, viewport: innerWidth };
        });
        assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height && bounds.width <= bounds.viewport, JSON.stringify(bounds));
        if (process.env.ACADEMY_SHOTS) await page.screenshot({ path: path.join(process.env.ACADEMY_SHOTS, `academy-${name}-${width}.png`) });
      };
      const openButton = async selector => { if (await page.$(selector)) await activate(selector); };
      // Coach pacing holds a missed ball until the learner asks for another one.
      const dismissCoach = async () => {
        if (!await page.$('.academy-dialog [data-act="retry"]')) return;
        await activate('.academy-dialog [data-act="retry"]');
        await frame.waitForFunction(() => window.__game.training.phase === 'live');
      };
      const waitLive = async () => {
        await frame.waitForFunction(() => window.__game.training && window.__game.training.phase !== 'intro');
        await dismissCoach();
        await frame.waitForFunction(() => window.__game.training.phase === 'live');
      };

      await page.goto(pathToFileURL(path.join(repo, 'play/index.html')).href + '?s=train', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('.academy-lesson', { timeout: 60000 });
      const catalog = await page.evaluate(() => ({ lessons: GameHost.trainingCatalog.lessons.length,
        strokes: GameHost.trainingCatalog.strokes.length, skills: GameHost.trainingCatalog.skills.length,
        hidden: document.querySelector('.academy-live').hidden, started: !!(GameHost.mode && GameHost.mode.type === 'train') }));
      assert.deepEqual(catalog, { lessons: 44, strokes: 20, skills: 54, hidden: true, started: false }); checks++;
      const variants = await page.evaluate(() => ['SERVE_SIDE_TOP', 'SERVE_SIDE_BACK'].map(id => {
        const c = GameHost.trainingCatalog, lesson = c.lessons.find(s => s.id === id);
        return { id, physical: c.strokes.some(s => s.id === id), stroke: lesson.stroke, technique: lesson.technique, version: c.version };
      }));
      assert.deepEqual(variants, ['SERVE_SIDE_TOP', 'SERVE_SIDE_BACK'].map(id => ({ id, physical: false, stroke: 'SERVE_SIDE', technique: id, version: 1 }))); checks++;
      const baseline = await page.evaluate(() => ({ coins: S.coins, gems: S.gems, elo: S.elo }));
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow === 'hidden' &&
        document.documentElement.scrollWidth <= innerWidth), true, 'catalog must not scroll sideways'); checks++;

      // Selection explains one lesson; the engine starts only on an explicit start.
      await activate('.academy-lesson[data-choice="HIT"]');
      assert.equal(await page.evaluate(() => Router.screens.train.selected().id), 'HIT'); checks++;
      assert.equal(await page.evaluate(() => !!GameHost.mode), false, 'selecting a lesson must not start a session'); checks++;
      await activate('.academy-selection [data-act="open"]');
      const frame = await (await page.$('#gamelayer iframe')).contentFrame();
      await frame.waitForFunction(() => window.__game && window.__game.training && window.__game.training.phase === 'intro');
      const intro = await frame.evaluate(() => ({ phase: window.__game.training.phase, live: window.__game.ball.live,
        input: window.__game.ui.inputMode, paddle: window.__game.playerPaddleVisible, embeddedCard: !!document.getElementById('tIntro') }));
      assert.deepEqual(intro, { phase: 'intro', live: false, input: touch ? 'touch' : 'mouse', paddle: !touch, embeddedCard: false }); checks++;
      await waitLive();
      const hud = await page.evaluate(() => {
        const bar = document.querySelector('.academy-live .academy-tools');
        return { permanent: bar ? bar.querySelectorAll('button').length : 0,
          labels: [...document.querySelectorAll('.academy-live .academy-tool')].map(b => b.getAttribute('aria-label')),
          blocking: [...document.querySelectorAll('.academy-live button')].filter(b => b.getBoundingClientRect().width > 0).length };
      });
      assert.equal(hud.permanent, 2, JSON.stringify(hud)); assert.ok(hud.labels.every(Boolean)); checks++;

      const liveState = () => frame.evaluate(() => {
        const g = window.__game, t = g.training;
        return { time: g.time, shotId: g.shotId, score: g.score, paused: g.paused,
          ball: { p: { ...g.ball.p }, v: { ...g.ball.v }, w: { ...g.ball.w }, q: { ...g.ball.q } },
          training: { phase: t.phase, stage: t.stage, done: t.done, attempts: t.attempts, ballNo: t.ballNo, t: t.t, simTime: t.simTime },
          aiRng: JSON.stringify(g.ai.rng) };
      });

      // A reference preview is read-only: it returns to the same paused lesson.
      await activate('.academy-live [data-act="pause"]');
      await page.waitForSelector('.academy-dialog [data-act="resume"]');
      await activate('.academy-dialog [data-act="reference"]');
      await page.waitForSelector('.academy-dialog [data-act="example"]');
      const beforePreview = await liveState();
      await activate('.academy-dialog [data-act="example"]');
      await frame.waitForSelector('#ttPreview [data-preview="close"]');
      const preview = await frame.evaluate(() => {
        const p = window.__game.preview; p.update(-1); p.render();
        const finite = x => typeof x === 'number' ? Number.isFinite(x) : x && typeof x === 'object' ? Object.values(x).every(finite) : true;
        const root = document.getElementById('ttPreview'), r = root.getBoundingClientRect();
        return { active: p.active, source: p.snapshot().source, finite: finite(p.snapshot()), role: root.getAttribute('role'),
          fits: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
      });
      assert.equal(preview.active, true); assert.equal(preview.source, 'example');
      assert.deepEqual({ finite: preview.finite, role: preview.role, fits: preview.fits }, { finite: true, role: 'dialog', fits: true }); checks++;
      await frame.click('#ttPreview [data-preview="contact"]');
      await frame.$eval('#ttPreview [data-preview="seek"]', el => {
        el.value = (Number(el.min) + Number(el.max)) / 2; el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await frame.click('#ttPreview [data-preview="close"]');
      await frame.waitForFunction(() => !window.__game.preview.active);
      await page.waitForSelector('.academy-dialog [data-act="reference-back"]');
      assert.deepEqual(await liveState(), beforePreview, 'preview controls cannot advance the live ball, input, RNG or training'); checks++;
      await activate('.academy-dialog [data-act="reference-back"]');
      await page.waitForSelector('.academy-dialog [data-act="resume"]');
      assert.equal(await frame.evaluate(() => window.__game.paused), true, 'closing a nested reference keeps the pause'); checks++;

      // Real pointer events drive the same contact/collision pipeline as play.
      // The first frozen opportunity uses the visible contact marker; later
      // taps meet the live ball after its legal bounce.
      const attempt = async () => {
        await new Promise(resolve => setTimeout(resolve, 110));
        await dismissCoach();
        return frame.evaluate(() => {
          const g = window.__game, t = g.training, cv = g.canvas;
          g.paused = false; let sent = false; const before = t.stats.attempts;
          for (let i = 0; i < 1400 && !['question', 'review', 'done'].includes(t.phase); i++) {
            if (t.phase === 'live' && !sent && g.ball.live && g.ball.lastHitBy === -1 &&
                g.rallyBounces.includes(1) && (t.frozen || g.ball.p.z >= 1.10 && g.ball.p.z <= 2.1 && g.ball.p.y >= .94 && g.ball.p.y <= 1.43)) {
              const cue = t.frozen && t.coachCue && t.coachCue(), p = g.project(cue ? cue.p : g.ball.p, {}), r = cv.getBoundingClientRect();
              if (p.ok && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) {
                const pointerType = g.ui.inputMode, pointerId = 700 + t.stats.attempts;
                for (const type of ['pointerdown', 'pointerup']) cv.dispatchEvent(new PointerEvent(type,
                  { pointerId, pointerType, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
                    clientX: r.left + p.x * r.width, clientY: r.top + p.y * r.height, bubbles: true, cancelable: true }));
                sent = true;
              }
            }
            g.update(1 / 60);
            if (t.stats.attempts > before && ['ok', 'fail', 'question'].includes(t.phase)) break;
          }
          g.paused = true;
          return { phase: t.phase, done: t.done, attempts: t.attempts, result: t.result, message: t.msg };
        });
      };

      let practice;
      for (let n = 0; n < 16; n++) { practice = await attempt(); if (practice.phase === 'question') break; }
      assert.equal(practice.phase, 'question', JSON.stringify(practice));
      await page.waitForFunction(() => S.training.lessons.HIT && S.training.lessons.HIT.practiced && document.querySelector('[data-answer="wait"]'));
      assert.equal(await page.evaluate(() => S.training.lessons.HIT.mastered), false); checks++;
      await activate('.academy-dialog [data-answer="wait"]');
      await frame.waitForFunction(() => window.__game.training.stage === 'check' && window.__game.training.phase === 'intro');
      assert.equal(await frame.evaluate(() => window.__game.ball.live), false); checks++;
      await frame.waitForFunction(() => window.__game.training.phase === 'live');
      let check;
      for (let n = 0; n < 4; n++) { await page.evaluate(() => { window.__game.paused = false; }); check = await attempt(); }
      assert.equal(check.phase, 'review', JSON.stringify(check));
      assert.ok(check.done >= 3, JSON.stringify(check));
      await page.waitForFunction(() => S.training.lessons.HIT && S.training.lessons.HIT.mastered);
      assert.deepEqual(await page.evaluate(() => ({ coins: S.coins, gems: S.gems, elo: S.elo })), baseline); checks++;
      assert.equal(await page.evaluate(() => document.querySelector('.academy-dialog').innerText.includes('наград')), false,
        'a lesson review must not promise rewards'); checks++;

      await page.waitForSelector('.academy-dialog [data-act="continue"]'); await activate('.academy-dialog [data-act="continue"]');
      await frame.waitForFunction(() => window.__game.training.S.id === 'DRIVE');
      await activate('.academy-live [data-act="menu"]');
      await page.waitForSelector('.academy-dialog [data-act="skip"]'); await activate('.academy-dialog [data-act="skip"]');
      await page.waitForFunction(() => !document.querySelector('.academy-menu').hidden && !GameHost.mode);
      assert.equal(await page.evaluate(() => !!(S.training.lessons.DRIVE && S.training.lessons.DRIVE.mastered)), false); checks++;

      // Stroke practice: coach pacing stops on a miss and explains it.
      await activate('[data-mode="stroke"]');
      const iconLegend = await page.evaluate(() => {
        const legend = document.querySelector('.academy-spin-legend');
        return { text: legend?.textContent, icons: [...legend.querySelectorAll('svg')].map(svg => ({
          id: svg.dataset.icon, spin: svg.dataset.spin, width: svg.getBoundingClientRect().width,
          balls: svg.querySelectorAll('.stroke-icon-ball').length })) };
      });
      if (iconLegend.text !== undefined) {
        assert.match(iconLegend.text, /стрелка|arrow/i);
        assert.ok(iconLegend.icons.every(i => i.width > 0 && i.balls <= 1)); checks++;
      }
      await activate('.academy-pick[data-choice="LOOP"]'); await activate('.academy-selection [data-act="open"]');
      await frame.waitForFunction(() => window.__game.training && window.__game.training.S.stroke === 'LOOP' && window.__game.training.phase === 'live');
      await page.evaluate(() => { window.__game.paused = false; });
      const failedStroke = await attempt();
      assert.equal(failedStroke.phase, 'fail', JSON.stringify(failedStroke));
      await page.waitForSelector('.academy-dialog [data-act="retry"]');
      assert.equal(await page.evaluate(() => Router.screens.train.overlay), 'feedback', 'coach pacing explains a miss'); checks++;
      assert.equal(await frame.evaluate(() => window.__game.paused), true, 'a coaching review holds the ball'); checks++;
      await activate('.academy-dialog [data-act="reference"]');
      await page.waitForSelector('.academy-dialog [data-motion="actual"]');
      assert.equal(await page.$eval('.academy-dialog [data-motion="actual"]', el => el.tagName.toLowerCase()), 'path');
      await page.waitForSelector('.academy-dialog [data-act="attempt"]');
      assert.equal(await page.$eval('.academy-dialog [data-act="attempt"]', el => el.disabled), false, 'a settled attempt owns a replay'); checks++;
      await activate('.academy-dialog [data-act="attempt"]');
      await frame.waitForSelector('#ttPreview [data-preview="close"]');
      const actual = await frame.evaluate(() => { const p = window.__game.preview, s = p.snapshot(); return { active: p.active, source: s.source, frames: s.physics && s.physics.frames, hz: s.physics && s.physics.hz }; });
      assert.equal(actual.active, true); assert.equal(actual.source, 'attempt');
      assert.ok(actual.hz === 30 && actual.frames >= 2, JSON.stringify(actual)); checks++;
      await frame.click('#ttPreview [data-preview="close"]');
      await frame.waitForFunction(() => !window.__game.preview.active);
      await page.waitForSelector('.academy-dialog [data-act="reference-back"]');
      await screenshot('feedback');
      await activate('.academy-dialog [data-act="reference-back"]');
      await page.waitForSelector('.academy-dialog [data-act="retry"]');
      const held = await frame.evaluate(() => [window.__game.training.attempts, window.__game.training.done]);
      await activate('.academy-dialog [data-act="retry"]');
      await frame.waitForFunction(() => window.__game.training.phase === 'live' && !window.__game.paused);
      assert.deepEqual(await frame.evaluate(() => [window.__game.training.attempts, window.__game.training.done]), held, 'a retry replays the same ball'); checks++;

      // Pacing is switchable mid-lesson without unpausing the ball.
      await activate('.academy-live [data-act="pause"]');
      await page.waitForSelector('.academy-dialog [data-pacing="flow"]');
      await activate('.academy-dialog [data-pacing="flow"]');
      await page.waitForFunction(() => window.__game.training.pacing === 'flow');
      assert.equal(await frame.evaluate(() => window.__game.paused), true, 'changing pace cannot resume play'); checks++;
      assert.equal(await page.evaluate(() => Router.screens.train.options.pacing), 'flow'); checks++;
      await activate('.academy-dialog [data-act="resume"]');
      await frame.waitForFunction(() => window.__game.training.phase === 'live' && !window.__game.paused);
      assert.equal(await page.evaluate(() => S.training.pacing), undefined, 'session pacing never reaches the saved profile'); checks++;

      await activate('.academy-live [data-act="menu"]');
      await page.waitForSelector('.academy-dialog [data-act="academy"]');
      await activate('.academy-dialog [data-act="academy"]');
      await page.waitForFunction(() => !GameHost.mode);
      await activate('[data-mode="accuracy"]'); await activate('.academy-pick[data-choice="corners"]'); await activate('.academy-selection [data-act="open"]');
      await frame.waitForFunction(() => window.__game.training && window.__game.training.mode === 'accuracy' && window.__game.training.phase === 'live');
      const zone = await frame.evaluate(() => window.__game.training.currentTarget);
      assert.ok(zone.z1 < -.7 && (zone.x0 > 0 || zone.x1 < 0), JSON.stringify(zone)); checks++;
      await page.evaluate(() => { window.__game.paused = false; });
      const missedTarget = await attempt();
      assert.equal(missedTarget.phase, 'fail', JSON.stringify(missedTarget));
      await activate('.academy-dialog [data-act="reference"]');
      await page.waitForSelector('.academy-dialog .academy-placement svg');
      assert.equal(await page.$eval('.academy-dialog .academy-placement svg', svg => svg.getAttribute('viewBox')), '0 0 240 210'); checks++;
      await screenshot('placement');

      // Reduced motion never autoplays the reference and never advances the game.
      const stoppedTime = await frame.evaluate(() => window.__game.time);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await activate('.academy-dialog [data-act="example"]');
      await frame.waitForSelector('#ttPreview [data-preview="close"]');
      assert.equal(await frame.evaluate(() => window.__game.time), stoppedTime, 'a reduced-motion review leaves the game clock alone');
      assert.equal(await frame.evaluate(() => window.__game.preview.snapshot().playing), false);
      assert.equal(await page.evaluate(() => !!Router.screens.train.demoRAF), false); checks++;
      await frame.click('#ttPreview [data-preview="close"]');
      await frame.waitForFunction(() => !window.__game.preview.active);
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.academy-lesson', { timeout: 60000 });
      assert.equal(await page.evaluate(() => S.training.lessons.HIT.mastered), true); checks++;
      assert.deepEqual(errors, [], JSON.stringify(errors));
      console.log(`academy ${width}x${height}: 44/20/54 catalog, read-only attempt replay, automatic practice, coaching review and mastery passed`);
      await context.close();
    }
    console.log(`academy browser: ${checks} integrated assertions passed`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });