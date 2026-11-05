const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { launchBrowser, pageFixture } = require('./shell-fixture.cjs');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); });

for (const width of [390, 1280]) test(`free/ranked routes and locale refresh preserve the hub at ${width}px`, async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['hub'], { width });
  const result = await page.evaluate(async () => {
    const { Router } = fixture, visits = [];
    for (const id of ['match', 'mm', 'train', 'profile', 'online']) Router.def(id, { render: () => '<div>' + id + '</div>', mount: () => visits.push([id, fixture.mode(), fixture.battle().opp]) });
    await Router.go('hub', { mode: 'push' });
    Router.active.el.querySelector('[data-modebtn="free"]').click();
    await Router.go('hub', { mode: 'push' });
    const root = Router.active.el, before = JSON.stringify(fixture.S), stack = JSON.stringify(Router.stack);
    I18n.lang = 'en'; Router.refreshLocale();
    const refreshed = { sameRoot: Router.active.el === root, sameState: JSON.stringify(fixture.S) === before, sameStack: JSON.stringify(Router.stack) === stack, title: root.querySelector('[data-modebtn="ranked"] b').textContent };
    root.querySelector('[data-modebtn="ranked"]').click();
    return { visits, refreshed, cur: Router.cur, shows: fixture.trace.host.filter(x => x === 'show').length, hides: fixture.trace.host.filter(x => x === 'hide').length };
  });
  assert.deepEqual(result.visits, [['match', 'free', 0], ['mm', 'ranked', 0]]);
  assert.deepEqual(result.refreshed, { sameRoot: true, sameState: true, sameStack: true, title: 'League rating' });
  assert.equal(result.cur, 'mm'); assert.equal(result.shows, result.hides); assert.deepEqual(errors, []);
});

test('an explicit online lobby route remains available in Friends', async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['hub']);
  const result = await page.evaluate(async () => {
    fixture.Router.def('online', { render: () => '<div>online</div>' });
    await fixture.Router.go('hub', { mode: 'push' });
    fixture.Router.screens.hub.friendsSheet(); document.querySelector('[data-online]').click();
    return { cur: fixture.Router.cur, sheet: !!fixture.Sheet.cur };
  });
  assert.deepEqual(result, { cur: 'online', sheet: false }); assert.deepEqual(errors, []);
});

test('a busy hub route retry belongs to its mount and cannot navigate after disposal', async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['hub']);
  await page.evaluate(async () => {
    const { Router } = fixture;
    Router.def('mm', { render: () => '<div>ranked</div>' }); Router.def('empty', { render: () => '<div>empty</div>' });
    await Router.go('hub', { mode: 'push' });
    Router.busy = true; Router.active.el.querySelector('[data-modebtn="ranked"]').click();
    Router.busy = false; await Router.go('empty', { mode: 'push' });
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(await page.evaluate(() => fixture.Router.cur), 'empty'); assert.deepEqual(errors, []);
});

test('Stars prompts do not simulate payment or grant bundle/premium rewards', async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['shop', 'pass']);
  const before = await page.evaluate(async () => {
    await fixture.Router.go('shop', { mode: 'push' });
    fixture.Router.active.el.querySelector('[data-product="season-bundle"]').click();
    document.querySelector('[data-a="pay"]').click();
    return JSON.stringify(fixture.S);
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await page.evaluate(() => JSON.stringify(fixture.S)), before);
  assert.equal(await page.evaluate(() => document.querySelector('[data-a="pay"]').disabled), true);
  const result = await page.evaluate(async () => {
    fixture.Sheet.close(true); fixture.S.premium = false;
    await fixture.Router.go('pass', { mode: 'push' }); fixture.Router.screens.pass.buyPremium(null, 4);
    document.querySelector('[data-a="pay"]').click();
    return { premium: fixture.S.premium, payDisabled: document.querySelector('[data-a="pay"]').disabled, saves: fixture.trace.saves.length };
  });
  assert.deepEqual(result, { premium: false, payDisabled: true, saves: 0 }); assert.deepEqual(errors, []);
});

test('closing an actual held product prevents a late charge; illustrated products buy atomically', async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['shop']);
  await page.evaluate(async () => {
    await fixture.Router.go('shop', { mode: 'push' });
    fixture.Router.screens.shop.product(Catalog.byId('r-coral'));
    document.querySelector('[data-a="buy"]').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    fixture.Sheet.close(true);
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.deepEqual(await page.evaluate(() => ({ coins: fixture.S.coins, owned: fixture.S.owned.includes('r-coral'), saves: fixture.trace.saves.length })), { coins: 1000, owned: false, saves: 0 });
  await page.evaluate(() => {
    ILL.shop_r_coral = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    fixture.Router.screens.shop.product(Catalog.byId('r-coral'));
  });
  await page.keyboard.down('Space'); await page.waitForFunction(() => fixture.S.owned.includes('r-coral')); await page.keyboard.up('Space');
  const result = await page.evaluate(() => { fixture.Sheet.close(true); return { coins: fixture.S.coins, saves: fixture.trace.saves.length, savedOwned: fixture.trace.saves[0].owned.includes('r-coral'), receipt: fixture.trace.saves[0].rewardReceipts.includes('item:r-coral') }; });
  assert.deepEqual(result, { coins: 520, saves: 1, savedOwned: true, receipt: true }); assert.deepEqual(errors, []);
});
