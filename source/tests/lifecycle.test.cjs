const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, pageFixture } = require('./shell-fixture.cjs');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); });

test('repaint owns mount disposers and data; locale refresh never remounts or leaves a session', async (t) => {
  const { page, errors } = await pageFixture(t, browser);
  const result = await page.evaluate(async () => {
    const { Router } = fixture, counts = { mounts: 0, cleanups: 0, disposes: 0, leaves: 0, refreshes: 0 };
    const session = { id: 'session-1', score: [8, 6], paused: true, connection: 'same' };
    Router.def('session', {
      live: true,
      render(data) { if (data !== session) throw Error('lost mount data'); return '<div class="scroll"><b id="label">ru</b><div style="height:1600px"></div></div>'; },
      mount(el, data) { counts.mounts++; if (data !== session) throw Error('lost session'); return () => counts.cleanups++; },
      dispose() { counts.disposes++; }, leave() { counts.leaves++; },
      refreshLocale(el, data) { if (data !== session) throw Error('lost locale data'); counts.refreshes++; el.querySelector('#label').textContent = 'en'; },
    });
    Router.def('empty', { render: () => '<div>empty</div>' });
    await Router.go('session', { mode: 'push', data: session });
    Router.active.el.querySelector('.scroll').scrollTop = 77;
    for (let i = 0; i < 3; i++) Router.repaint();
    const el = Router.active.el, stack = JSON.stringify(Router.stack), before = JSON.stringify(session);
    Router.refreshLocale(); Router.refreshLocale();
    const refreshed = { ...counts, sameElement: Router.active.el === el, sameData: Router.active.data === session, sameStack: JSON.stringify(Router.stack) === stack, sameSession: JSON.stringify(session) === before, top: el.querySelector('.scroll').scrollTop };
    await Router.go('empty', { mode: 'push' });
    return { refreshed, counts, unsupported: Router.refreshLocale() };
  });
  assert.deepEqual(result.refreshed, { mounts: 4, cleanups: 3, disposes: 3, leaves: 0, refreshes: 2, sameElement: true, sameData: true, sameStack: true, sameSession: true, top: 77 });
  assert.deepEqual(result.counts, { mounts: 4, cleanups: 4, disposes: 4, leaves: 1, refreshes: 2 });
  assert.equal(result.unsupported, false); assert.deepEqual(errors, []);
});

test('a shared disposer/leave function runs once and render failures release the router', async (t) => {
  const { page } = await pageFixture(t, browser);
  const result = await page.evaluate(async () => {
    const { Router } = fixture; let exits = 0;
    const leave = () => exits++;
    Router.def('one', { render: () => '<div>one</div>', mount: () => leave, leave });
    Router.def('two', { render: () => '<div>two</div>' });
    Router.def('bad', { render() { throw Error('render'); } });
    await Router.go('one', { mode: 'push' }); await Router.go('two', { mode: 'push' });
    try { await Router.go('bad', { mode: 'push' }); } catch (e) {}
    return { exits, busy: Router.busy, cur: Router.cur, active: Router.active.id };
  });
  assert.deepEqual(result, { exits: 1, busy: false, cur: 'two', active: 'two' });
});

test('a server repaint during the transition is coalesced rather than lost', async (t) => {
  const { page, errors } = await pageFixture(t, browser);
  const result = await page.evaluate(async () => {
    const { Router } = fixture; let value = 1, mounts = 0, cleanups = 0, leaves = 0;
    Router.def('live', { live: true, render: () => '<div id="value">' + value + '</div>', mount() { mounts++; return () => cleanups++; }, leave() { leaves++; } });
    await Router.go('live', { mode: 'push' });
    const transition = Router.go('live', { mode: 'wipe' });
    await new Promise((resolve) => setTimeout(resolve, 15)); value = 2;
    const immediate = Router.repaint(); await transition;
    return { immediate, value: Router.active.el.querySelector('#value').textContent, mounts, cleanups, leaves, pending: Router.repaintPending };
  });
  assert.deepEqual(result, { immediate: false, value: '2', mounts: 3, cleanups: 2, leaves: 1, pending: false });
  assert.deepEqual(errors, []);
});

test('dialog traps Tab, restores focus/inert, owns Escape and removes document listeners', async (t) => {
  const { page, errors } = await pageFixture(t, browser);
  await page.evaluate(() => {
    document.querySelector('#opener').focus(); document.querySelector('#nav').inert = true;
    fixture.closed = []; fixture.disposed = 0; fixture.escapes = 0;
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') fixture.escapes++; });
    fixture.Sheet.open('<h1>Dialog</h1><button disabled>disabled</button><fieldset disabled><button>fieldset-disabled</button></fieldset><button style="visibility:hidden">invisible</button><button id="first">first</button><button id="last">last</button><button hidden>hidden</button>', { onOpen: () => () => fixture.disposed++, onClose: (_, reason) => fixture.closed.push(reason) });
  });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'first');
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'last');
  await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement.id), 'first');
  await page.evaluate(() => document.querySelector('#opener').focus());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'first');
  await page.keyboard.press('Escape');
  const result = await page.evaluate(() => {
    fixture.Sheet.close(true);
    return { open: !!fixture.Sheet.cur, focus: document.activeElement.id, disposed: fixture.disposed, closed: fixture.closed, escapes: fixture.escapes, keys: fixture.listenerCount(document, 'keydown', true), focusListeners: fixture.listenerCount(document, 'focusin'), screensInert: document.querySelector('#screens').inert, navInert: document.querySelector('#nav').inert };
  });
  assert.deepEqual(result, { open: false, focus: 'opener', disposed: 1, closed: ['close'], escapes: 0, keys: 0, focusListeners: 0, screensInert: false, navInert: true });
  assert.deepEqual(errors, []);
});

test('replacement/empty dialogs keep the original focus target and do not accumulate callbacks', async (t) => {
  const { page } = await pageFixture(t, browser);
  const result = await page.evaluate(() => {
    document.querySelector('#opener').focus(); const closed = [];
    for (let i = 0; i < 10; i++) fixture.Sheet.open('<h1>Empty dialog</h1>', { onClose: (_, reason) => closed.push(reason) });
    const focusedDialog = document.activeElement.classList.contains('sheet');
    fixture.Sheet.close(true); fixture.Sheet.close(true);
    return { focusedDialog, focus: document.activeElement.id, replacements: closed.filter((r) => r === 'replace').length, final: closed.at(-1), keys: fixture.listenerCount(document, 'keydown', true), focusListeners: fixture.listenerCount(document, 'focusin') };
  });
  assert.deepEqual(result, { focusedDialog: true, focus: 'opener', replacements: 9, final: 'close', keys: 0, focusListeners: 0 });
});

test('closing a sheet synchronously cancels an active hold and its element handlers', async (t) => {
  const { page } = await pageFixture(t, browser);
  await page.evaluate(() => {
    const w = fixture.Sheet.open('<button id="hold"><span class="hold-fill"></span>hold</button>');
    fixture.held = w.querySelector('#hold');
    fixture.disposeHold = fixture.UI.hold(fixture.held, 200, () => fixture.trace.grants++);
    fixture.held.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
  });
  await page.waitForFunction(() => fixture.held.querySelector('.hold-fill').style.transform !== '');
  await page.evaluate(() => { fixture.Sheet.close(true); fixture.disposeHold(); });
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual(await page.evaluate(() => ({ grants: fixture.trace.grants, down: fixture.listenerCount(fixture.held, 'pointerdown'), keys: fixture.listenerCount(fixture.held, 'keydown'), holding: fixture.held.classList.contains('holding') })), { grants: 0, down: 0, keys: 0, holding: false });
});

test('keyboard hold works, allows a failed confirmation retry and stays idempotently disposable', async (t) => {
  const { page, errors } = await pageFixture(t, browser);
  await page.evaluate(() => {
    const w = fixture.Sheet.open('<button id="hold"><span class="hold-fill"></span>hold</button>');
    fixture.UI.hold(w.querySelector('#hold'), 60, () => { fixture.trace.grants++; return fixture.trace.grants > 1; });
  });
  await page.keyboard.down('Enter'); await page.waitForFunction(() => fixture.trace.grants === 1); await page.keyboard.up('Enter');
  await page.keyboard.down('Space'); await page.waitForFunction(() => fixture.trace.grants === 2); await page.keyboard.up('Space');
  await page.evaluate(() => fixture.Sheet.close(true));
  assert.equal(await page.evaluate(() => fixture.trace.grants), 2); assert.deepEqual(errors, []);
});

test('offline ranks repaints dispose immediately and locale refresh preserves the selected filter', async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['ranks']);
  const result = await page.evaluate(async () => {
    const { Router, Progress } = fixture;
    Router.def('empty', { render: () => '<div>empty</div>' });
    await Router.go('ranks', { mode: 'push' }); const first = Router.active.el;
    for (let i = 0; i < 5; i++) Router.repaint();
    Router.active.el.querySelector('[data-v="friends"]').click();
    const current = Router.active.el; I18n.lang = 'en'; Router.refreshLocale();
    const mounted = { subscriptions: Progress.boardSubs.length, oldClicks: fixture.listenerCount(first, 'click'), sameElement: Router.active.el === current, tab: Router.screens.ranks.tab };
    await Router.go('empty', { mode: 'push' });
    return { mounted, subscriptions: Progress.boardSubs.length };
  });
  await new Promise((resolve) => setTimeout(resolve, 950));
  assert.deepEqual(result, { mounted: { subscriptions: 1, oldClicks: 0, sameElement: true, tab: 'friends' }, subscriptions: 0 });
  assert.deepEqual(await page.evaluate(() => fixture.trace.fx), []); assert.deepEqual(errors, []);
});

test('leaving splash cancels preload, particles and delayed navigation', async (t) => {
  const { page, errors } = await pageFixture(t, browser, [], { main: true });
  await page.evaluate(async () => {
    fixture.Router.def('empty', { render: () => '<div>empty</div>' });
    await fixture.Router.go('empty', { mode: 'push' });
    fixture.S.quality = 'high'; fixture.trace.host.length = 0; fixture.trace.fx.length = 0;
    await fixture.Router.go('splash', { mode: 'push' }); await fixture.Router.go('empty', { mode: 'push' });
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(await page.evaluate(() => ({ cur: fixture.Router.cur, host: fixture.trace.host, fx: fixture.trace.fx })), { cur: 'empty', host: [], fx: [] });
  assert.deepEqual(errors, []);
});
