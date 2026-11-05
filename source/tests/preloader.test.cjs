const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, pageFixture } = require('./shell-fixture.cjs');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); });

async function splash(t, { width = 390, reduced = false } = {}) {
  const result = await pageFixture(t, browser, ['hub'], { width, main: true });
  await result.page.evaluate(reduced => {
    fixture.S.quality = 'high'; fixture.S.rm = reduced;
    document.body.classList.toggle('rm', reduced);
    fixture.Router.def('profile', { render: () => '<button id="profile-ready">Profile</button>' });
  }, reduced);
  await result.page.waitForFunction(() => fixture.trace.messages.some(m => m.type === 'lobby' && m.intro));
  return result;
}

test('bridge ready cannot launch the ball; sprites, fonts and presented lobby gate the smash', async t => {
  const { page, errors } = await splash(t);
  await new Promise(resolve => setTimeout(resolve, 1000));
  const waiting = await page.evaluate(() => {
    const s = fixture.Preloader.session;
    fixture.emitHost({ type: 'lobbyReady', requestId: s.id + 1 });
    return { bridge: fixture.host.ready, phase: s.phase, frame: s.sheet.dataset.frame,
      percent: Number(s.readout.getAttribute('aria-valuenow')), launches: fixture.trace.messages.filter(m => m.type === 'lobbyLaunch').length };
  });
  assert.deepEqual(waiting, { bridge: true, phase: 'loading', frame: 'intro:0', percent: 83, launches: 0 });
  await page.evaluate(() => fixture.emitHost({ type: 'lobbyReady', requestId: fixture.Preloader.session.id }));
  await page.waitForFunction(() => document.querySelector('#preloader').dataset.phase === 'glass');
  assert.deepEqual(await page.evaluate(() => ({ route: fixture.Router.cur, pointer: getComputedStyle(document.querySelector('#preloader')).pointerEvents,
    wipe: document.querySelector('#wipe').className, menu: !!document.querySelector('[data-modebtn="free"]') })),
  { route: 'hub', pointer: 'none', wipe: '', menu: true });
  await page.waitForFunction(() => fixture.trace.messages.some(m => m.type === 'lobbyLaunch'));
  assert.equal(await page.evaluate(() => fixture.trace.messages.find(m => m.type === 'lobbyLaunch').diameter), .9);
  assert.deepEqual(errors, []);
});

for (const width of [390, 1280]) test(`projected flight uses CSS pixels and releases exactly one sprite at ${width}px`, async t => {
  const { page, errors } = await splash(t, { width });
  await page.evaluate(() => { fixture.Preloader.session.minElapsed = true; fixture.emitHost({ type: 'lobbyReady', requestId: fixture.Preloader.session.id }); });
  await page.waitForFunction(() => fixture.trace.messages.some(m => m.type === 'lobbyLaunch'));
  const result = await page.evaluate(() => {
    const s = fixture.Preloader.session;
    fixture.emitHost({ type: 'lobbyFrame', requestId: s.id, x: .29, y: .51, diameter: .04, handoff: false });
    const r = s.ball.getBoundingClientRect(), d = s.root.getBoundingClientRect();
    const projected = { x: (r.left + r.width * .5 - d.left) / d.width, y: (r.top + r.height * .534 - d.top) / d.height,
      diameter: r.width * .625 / d.width };
    fixture.emitHost({ type: 'lobbyFrame', requestId: s.id, handoff: true, phase: 'flight' });
    return { projected, hidden: s.root.hidden, active: !!fixture.Preloader.session, subscribers: fixture.host.subs.size,
      animations: s.animations.size, timers: s.timers.size };
  });
  assert.ok(Math.abs(result.projected.x - .29) < .001);
  assert.ok(Math.abs(result.projected.y - .51) < .001);
  assert.ok(Math.abs(result.projected.diameter - .04) < .001);
  assert.deepEqual({ ...result, projected: null }, { projected: null, hidden: true, active: false, subscribers: 0, animations: 0, timers: 0 });
  assert.deepEqual(errors, []);
});

test('visible menu can navigate during incoming flight and disposal ignores stale frame messages', async t => {
  const { page, errors } = await splash(t);
  await page.evaluate(() => { fixture.Preloader.session.minElapsed = true; fixture.emitHost({ type: 'lobbyReady', requestId: fixture.Preloader.session.id }); });
  await page.waitForFunction(() => fixture.trace.messages.some(m => m.type === 'lobbyLaunch'));
  const id = await page.evaluate(() => fixture.Preloader.session.id);
  await page.click('[data-modebtn="career"]');
  await page.waitForFunction(() => fixture.Router.cur === 'profile');
  const result = await page.evaluate(id => {
    fixture.emitHost({ type: 'lobbyFrame', requestId: id, x: .5, y: .48, diameter: .5, handoff: false });
    return { active: !!fixture.Preloader.session, hidden: document.querySelector('#preloader').hidden, subscribers: fixture.host.subs.size };
  }, id);
  assert.deepEqual(result, { active: false, hidden: true, subscribers: 0 }); assert.deepEqual(errors, []);
});

test('reduced motion keeps the readiness gate but collapses smash, glass and travel', async t => {
  const { page, errors } = await splash(t, { reduced: true });
  await page.evaluate(() => { fixture.Preloader.session.minElapsed = true; fixture.emitHost({ type: 'lobbyReady', requestId: fixture.Preloader.session.id }); });
  await page.waitForFunction(() => fixture.trace.messages.some(m => m.type === 'lobbyLaunch'));
  const result = await page.evaluate(() => {
    const s = fixture.Preloader.session;
    const before = { route: fixture.Router.cur, phase: s.phase, animations: s.animations.size, frame: s.sheet.dataset.frame, ball: s.ball.style.opacity };
    fixture.emitHost({ type: 'lobbyFrame', requestId: s.id, handoff: true, phase: 'rally' });
    return { before, hidden: s.root.hidden };
  });
  assert.deepEqual(result, { before: { route: 'hub', phase: 'flight', animations: 0, frame: 'intro:0', ball: '0' }, hidden: true });
  assert.deepEqual(errors, []);
});

test('leaving at glass contact cancels the delayed launch instead of leaving a waiting lobby', async t => {
  const { page, errors } = await splash(t);
  await page.evaluate(() => {
    fixture.Preloader.session.minElapsed = true;
    fixture.emitHost({ type: 'lobbyReady', requestId: fixture.Preloader.session.id });
    const contact = new MutationObserver(() => {
      if (document.querySelector('#preloader').dataset.phase !== 'glass') return;
      contact.disconnect(); document.querySelector('[data-modebtn="career"]').click();
    });
    contact.observe(document.querySelector('#preloader'), { attributes: true, attributeFilter: ['data-phase'] });
  });
  await page.waitForFunction(() => fixture.Router.cur === 'profile');
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.deepEqual(await page.evaluate(() => ({ active: !!fixture.Preloader.session,
    launches: fixture.trace.messages.filter(m => m.type === 'lobbyLaunch').length,
    cancelled: fixture.trace.messages.some(m => m.type === 'attract') })),
  { active: false, launches: 0, cancelled: true });
  assert.deepEqual(errors, []);
});
