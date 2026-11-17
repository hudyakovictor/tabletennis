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

test('real gem-pack and premium Stars prompts never simulate payment or grant rewards', async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['shop', 'pass'], { persisted: true });
  const before = await page.evaluate(async () => {
    await fixture.Router.go('shop', { mode: 'push' });
    const before = JSON.stringify(fixture.S);
    fixture.Router.active.el.querySelector('[data-product="gems-80"]').click();
    document.querySelector('[data-a="pay"]').click();
    return before;
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal(await page.evaluate(() => JSON.stringify(fixture.S)), before);
  assert.equal(await page.evaluate(() => document.querySelector('[data-a="pay"]').disabled), true);
  assert.equal(await page.evaluate(() => fixture.trace.saves.length), 0);
  const result = await page.evaluate(async () => {
    fixture.Sheet.close(true); fixture.S.premium = false;
    await fixture.Router.go('pass', { mode: 'push' });
    const before = JSON.stringify(fixture.S);
    fixture.Router.active.el.querySelector('[data-act="premium"]').click();
    document.querySelector('[data-a="pay"]').click();
    return { premium: fixture.S.premium, unchanged: JSON.stringify(fixture.S) === before, payDisabled: document.querySelector('[data-a="pay"]').disabled, saves: fixture.trace.saves.length };
  });
  assert.deepEqual(result, { premium: false, unchanged: true, payDisabled: true, saves: 0 }); assert.deepEqual(errors, []);
});

for (const width of [390, 1280]) test(`pan hold-close rollback, illustrated 500-gem purchase and equipped reload at ${width}px`, async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['shop'], { width, persisted: true });
  await page.evaluate(async () => {
    await fixture.Router.go('shop', { mode: 'push' });
    fixture.Router.active.el.querySelector('[data-item="r-pan"]').click();
    document.querySelector('[data-a="buy"]').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
    fixture.Sheet.close(true);
  });
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.deepEqual(await page.evaluate(() => ({ coins: fixture.S.coins, gems: fixture.S.gems, owned: fixture.S.owned,
    equipped: fixture.S.equipped, receipts: fixture.S.rewardReceipts, saves: fixture.trace.saves.length })),
    { coins: 1000, gems: 1000, owned: ['r-standard'], equipped: { racket: 'r-standard' }, receipts: [], saves: 0 });
  const illustrated = await page.evaluate(() => {
    ILL.shop_r_pan = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');
    fixture.Router.active.el.querySelector('[data-item="r-pan"]').click();
    return { illustration: document.querySelector('.pd-ill')?.style.backgroundImage.includes(ILL.shop_r_pan),
      spin: !!document.querySelector('.pd-spin'), products: [...fixture.Router.active.el.querySelectorAll('[data-item]')].map(card => card.dataset.item) };
  });
  assert.deepEqual(illustrated, { illustration: true, spin: false, products: ['r-pan'] });
  await page.keyboard.down('Space'); await page.waitForFunction(() => fixture.S.owned.includes('r-pan')); await page.keyboard.up('Space');
  const bought = await page.evaluate(() => ({ coins: fixture.S.coins, gems: fixture.S.gems, saves: fixture.trace.saves.length,
    savedOwned: fixture.trace.saves[0].owned, savedGems: fixture.trace.saves[0].gems,
    receipt: fixture.trace.saves[0].rewardReceipts.includes('item:r-pan'), equipped: fixture.S.equipped }));
  assert.deepEqual(bought, { coins: 1000, gems: 500, saves: 1, savedOwned: ['r-standard', 'r-pan'], savedGems: 500,
    receipt: true, equipped: { racket: 'r-standard' } });
  const equipped = await page.evaluate(() => {
    document.querySelector('[data-a="equip"]').click();
    return { saved: fixture.stored(), saves: fixture.trace.saves.length, packet: fixture.trace.messages.findLast(m => m.type === 'equip'), sheet: !!fixture.Sheet.cur };
  });
  assert.deepEqual(equipped.saved.equipped, { racket: 'r-pan' }); assert.equal(equipped.saves, 2);
  assert.deepEqual(equipped.packet, { type: 'equip', equipped: { racket: 'r-pan' } }); assert.equal(equipped.sheet, false);
  assert.deepEqual(errors, []);
  const { page: reloaded, errors: reloadErrors } = await pageFixture(t, browser, ['shop'], { width, persisted: true, raw: equipped.saved });
  const restored = await reloaded.evaluate(async () => {
    await fixture.Router.go('shop', { mode: 'push' });
    fixture.Router.active.el.querySelector('[data-item="r-pan"]').click();
    return { coins: fixture.S.coins, gems: fixture.S.gems, owned: fixture.S.owned, equipped: fixture.S.equipped,
      receipts: fixture.S.rewardReceipts, buy: !!document.querySelector('[data-a="buy"]'), equip: !!document.querySelector('[data-a="equip"]'), saves: fixture.trace.saves.length };
  });
  assert.deepEqual(restored, { coins: 1000, gems: 500, owned: ['r-standard', 'r-pan'], equipped: { racket: 'r-pan' },
    receipts: ['item:r-pan'], buy: false, equip: true, saves: 0 }); assert.deepEqual(reloadErrors, []);
});

test('profile shows one standard racket after a corrupt unowned pan/retired-slot reload', async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['profile'], { persisted: true,
    raw: { v: 10, owned: ['r-void', 'event-earned'], equipped: { racket: 'r-pan', rubber: 'r-void', blade: 'b-ink', trail: 't-gold', table: 'tb-neon' } } });
  const result = await page.evaluate(async () => {
    window.Career = { radar: () => [], got: {}, c: { m: 0 } }; window.ACH = []; window.ICON_FILL = new Set();
    window.ratingSeries = () => []; window.ZoneStats = { matches: () => [] };
    await fixture.Router.go('profile', { mode: 'push' });
    const eq = fixture.Router.active.el.querySelector('.eq');
    return { cards: eq.querySelectorAll('.icard').length, arts: [...eq.querySelectorAll('[data-item-art]')].map(art => art.dataset.itemArt),
      name: eq.querySelector('.ic-n').textContent, expectedName: itemName(Catalog.byId('r-standard')), owned: fixture.S.owned, equipped: fixture.S.equipped };
  });
  assert.equal(result.cards, 1); assert.deepEqual(result.arts, ['r-standard']); assert.equal(result.name, result.expectedName);
  assert.deepEqual(result.owned, ['r-standard', 'event-earned']); assert.deepEqual(result.equipped, { racket: 'r-standard' });
  assert.deepEqual(errors, []);
});

for (const width of [320, 1280]) test(`profile switches owned rackets both ways without a purchase at ${width}px`, async (t) => {
  const raw = { v: 10, owned: ['r-standard', 'r-pan', 'event-earned'], equipped: { racket: 'r-pan' },
    rewardReceipts: ['item:r-pan'], claimed: { f: [1], p: [3] } };
  const { page, errors } = await pageFixture(t, browser, ['profile', 'shop'], { width, persisted: true, raw });
  await page.evaluate(async () => {
    window.Career = { radar: () => [], got: {}, c: { m: 0 } }; window.ACH = []; window.ICON_FILL = new Set();
    window.ratingSeries = () => []; window.ZoneStats = { matches: () => [] };
    await fixture.Router.go('profile', { mode: 'push' });
  });
  for (const id of ['r-standard', 'r-pan']) {
    const result = await page.evaluate(id => {
      const before = JSON.stringify({ coins: fixture.S.coins, gems: fixture.S.gems, owned: fixture.S.owned,
        receipts: fixture.S.rewardReceipts, claimed: fixture.S.claimed });
      const cards = [...fixture.Router.active.el.querySelectorAll('[data-equipment]')];
      const selected = cards.find(card => card.getAttribute('aria-pressed') === 'true');
      const disabled = selected.disabled;
      const target = cards.find(card => card.dataset.equipment === id);
      target.focus(); target.click();
      const buy = !!fixture.Sheet.cur.querySelector('[data-a="buy"]');
      fixture.Sheet.cur.querySelector('[data-a="equip"]').click();
      return { cards: cards.map(card => card.dataset.equipment).sort(), disabled, buy, sheet: !!fixture.Sheet.cur,
        selected: fixture.Router.active.el.querySelector('[aria-pressed="true"]').dataset.equipment,
        unchanged: JSON.stringify({ coins: fixture.S.coins, gems: fixture.S.gems, owned: fixture.S.owned,
          receipts: fixture.S.rewardReceipts, claimed: fixture.S.claimed }) === before,
        saved: fixture.stored(), packet: fixture.trace.messages.at(-1), saves: fixture.trace.saves.length,
        focused: document.activeElement === fixture.Router.active.el.querySelector('.eq') };
    }, id);
    assert.deepEqual(result.cards, ['r-pan', 'r-standard']); assert.equal(result.disabled, true);
    assert.equal(result.buy, false); assert.equal(result.sheet, false); assert.equal(result.selected, id);
    assert.equal(result.unchanged, true); assert.deepEqual(result.saved.equipped, { racket: id });
    assert.deepEqual(result.packet, { type: 'equip', equipped: { racket: id } });
    assert.equal(result.saves, id === 'r-standard' ? 1 : 2);
    assert.equal(result.focused, true, 'repainting the equipment picker preserves keyboard context');
  }
  assert.deepEqual(errors, []);
});

test('chests show pan once and summaries grant only shown items without resurrecting retired/default goods', async (t) => {
  const { page, errors } = await pageFixture(t, browser, ['result'], { raw: { owned: ['event-earned'] } });
  const result = await page.evaluate(async () => {
    const chest = fixture.Router.screens.chest, cards = {};
    for (const kind of ['silver', 'gold', 'epic']) { chest.render({ kind }); cards[kind] = chest.loot.filter(reward => reward.k === 'card').map(reward => reward.item); }
    const el = document.createElement('div'); el.className = 'screen current'; el.innerHTML = chest.render({ kind: 'gold' });
    document.querySelector('#screens').appendChild(el);
    const coins = fixture.S.coins, gems = fixture.S.gems;
    await chest.summary(el);
    const after = JSON.stringify(fixture.S), saves = fixture.trace.saves.length;
    await chest.summary(el); chest.leave();
    return { cards, cells: el.querySelectorAll('.sg').length, owned: fixture.S.owned, coins: fixture.S.coins - coins,
      gems: fixture.S.gems - gems, replayInert: JSON.stringify(fixture.S) === after && fixture.trace.saves.length === saves };
  });
  assert.deepEqual(result, { cards: { silver: ['r-pan'], gold: ['r-pan'], epic: ['r-pan'] }, cells: 3,
    owned: ['event-earned', 'r-pan'], coins: 320, gems: 8, replayInert: true }); assert.deepEqual(errors, []);
});
