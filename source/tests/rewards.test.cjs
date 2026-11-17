const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (name) => fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const receipt = (productId, extra = {}) => ({ id: 'tg-charge-1', productId, confirmed: true, status: 'paid', currency: 'XTR', amount: 349, seasonN: 4, ...extra });

function load({ raw = {}, now = '2026-10-20T00:00:00Z', cached = null } = {}) {
  class Clock extends Date { static now() { return Date.parse(now); } }
  const entries = new Map([['ttu-v2', JSON.stringify({ v: 7, passSeason: 4, passLvl: 20, premium: true, ...raw })]]), saves = [];
  if (cached) entries.set('ttu-seasons', JSON.stringify(cached));
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); if (key === 'ttu-v2') saves.push(JSON.parse(value)); },
    removeItem: (key) => entries.delete(key),
  };
  const context = vm.createContext({
    Date: Clock, structuredClone, setTimeout: () => 1, clearTimeout: () => {},
    t: (key) => key,
    Progress: { reconcileSeason() {} },
    localStorage: storage,
  });
  vm.runInContext(['core/state.js', 'data/catalog.js', 'data/season.js', 'services/economy.js'].map(read).join('\n') + '\nglobalThis.fixture = { S, Store, Rewards, Catalog, season: TTSeason };', context);
  return { ...context.fixture, saves, entries, storage };
}

test('pan is the sole equipment product; standard is free/hidden and existing currency offers remain', () => {
  const f = load(), before = plain(f.S);
  assert.deepEqual(plain(f.Catalog.shop().map(item => ({ id: item.id, kind: item.kind, price: item.price }))),
    [{ id: 'r-pan', kind: 'racket', price: { cur: 'gems', amt: 500 } }]);
  assert.equal(f.Catalog.byId('r-standard').price, null);
  assert.equal(f.Catalog.canBuy(f.Catalog.byId('r-standard')).why, 'unavailable');
  assert.deepEqual(plain(f.Catalog.bundles()), []);
  assert.deepEqual(plain(f.Catalog.starPacks().map(pack => pack.id)), ['gems-80', 'gems-500', 'gems-1200']);
  assert.deepEqual(plain(f.Catalog.coinPacks().map(pack => pack.id)), ['coins-500', 'coins-1400', 'coins-3200']);
  assert.deepEqual(plain(f.Catalog.starOffer('premium-pass')), { id: 'premium-pass', price: { cur: 'stars', amt: 349 }, premium: true, once: true });
  for (const id of ['r-coral', 'r-void', 'r-teal', 'b-ink', 't-gold', 't-coral', 'tb-neon', 'f-season', 'season-bundle']) {
    assert.equal(f.Catalog.byId(id), null, id);
    assert.equal(f.Rewards.buyItem(id).why, 'unavailable', id);
  }
  assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
});

test('every fallback pass card identifies the surviving pan item', () => {
  const f = load(), cards = f.season.currentPass().map((tier) => tier.p).filter((r) => r.k === 'card');
  assert.deepEqual([...new Set(cards.map((r) => r.itemId))], ['r-pan']);
  for (const card of cards) assert.equal(f.Catalog.rewardItem(card).id, card.itemId);
});

test('pass card ownership, claim and receipt share one durable save and replay is inert', () => {
  const f = load(), result = f.Rewards.claimPass(4, 'p', 3);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.items), ['r-pan']);
  assert.equal(f.saves.length, 1);
  assert.ok(f.saves[0].owned.includes('r-pan'));
  assert.ok(f.saves[0].claimed.p.includes(3));
  assert.ok(f.saves[0].rewardReceipts.includes('pass:4:p:3'));
  const before = plain(f.S);
  assert.equal(f.Rewards.claimPass(4, 'p', 3).why, 'claimed');
  assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 1);
  const restored = load({ raw: f.saves[0] });
  assert.equal(restored.Rewards.claimPass(4, 'p', 3).why, 'claimed');
  assert.equal(restored.saves.length, 0);
});

test('legacy claimed flags survive migration without repairing them by regranting items', () => {
  const f = load({ raw: { v: 5, owned: ['r-standard'], claimed: { f: [1], p: [3] } } });
  const before = plain(f.S);
  assert.equal(f.Rewards.claimPass(4, 'p', 3).why, 'claimed');
  assert.deepEqual(plain(f.S), before);
  assert.deepEqual(plain(f.S.owned), ['r-standard']); assert.equal(f.saves.length, 0);
  assert.ok(f.entries.has('ttu-v2.bak'));
});

test('an already owned pass card consumes its tier once without duplicate inventory entries', () => {
  const f = load({ raw: { owned: ['r-pan'] } });
  const result = f.Rewards.claimPass(4, 'p', 3);
  assert.equal(result.ok, true); assert.deepEqual(plain(result.items), []);
  assert.deepEqual(plain(f.S.owned), ['r-standard', 'r-pan']); assert.ok(f.S.claimed.p.includes(3));
  assert.equal(f.saves.length, 1); assert.ok(f.saves[0].rewardReceipts.includes('pass:4:p:3'));
});

test('pass currencies and chests commit immediately; full slots do not consume a claim', () => {
  const f = load({ raw: { chests: [null, null, null, null] } });
  const coins = f.S.coins, gems = f.S.gems;
  assert.equal(f.Rewards.claimPass(4, 'f', 1).ok, true);
  assert.equal(f.S.coins, coins + 60); assert.equal(f.S.gems, gems);
  assert.equal(f.Rewards.claimPass(4, 'f', 2).ok, true);
  assert.equal(f.S.gems, gems + 3);
  assert.equal(f.Rewards.claimPass(4, 'p', 5).ok, true);
  assert.deepEqual(plain(f.S.chests[0]), { id: 'pass:4:p:5', kind: 'gold', state: 'ready' });
  const full = load({ raw: { chests: Array.from({ length: 4 }, (_, i) => ({ id: String(i), kind: 'gold', state: 'ready' })) } });
  const before = plain(full.S);
  assert.equal(full.Rewards.claimPass(4, 'f', 5).why, 'slotsFull');
  assert.deepEqual(plain(full.S), before); assert.equal(full.saves.length, 0);
});

test('invalid item rewards, closed seasons and locked tiers never claim or change balances', () => {
  const f = load(), before = plain(f.S);
  assert.equal(f.Rewards._grant(['pass:4:p:3'], [{ k: 'card', n: 1, itemId: 'missing' }], { claim: { lane: 'p', level: 3 }, cost: { cur: 'gems', amt: 10 } }).ok, false);
  assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
  assert.equal(f.Rewards.claimPass(5, 'p', 3).why, 'season');
  assert.equal(load({ now: '2026-11-10T00:00:00Z' }).Rewards.claimPass(4, 'f', 1).why, 'season');
  assert.equal(load({ raw: { premium: false } }).Rewards.claimPass(4, 'p', 3).why, 'premium');
  assert.equal(load({ raw: { passLvl: 0 } }).Rewards.claimPass(4, 'f', 1).why, 'level');
  assert.equal(f.Rewards.claimPass(4, 'invalid', 1).ok, false);
});

test('malformed transaction metadata fails before currency or claim effects', () => {
  const f = load({ raw: { gems: 1000 } }), before = plain(f.S);
  for (const ids of [null, 'scalar', [], ['duplicate', 'duplicate'], ['trailing '], [undefined]]) {
    assert.equal(f.Rewards._grant(ids, [{ k: 'gems', n: 80 }], { cost: { cur: 'coins', amt: 20 } }).ok, false);
    assert.deepEqual(plain(f.S), before);
  }
  assert.equal(f.Rewards._grant(['valid'], [{ k: 'coins', n: 80 }], { claim: { lane: 'bad', level: 1 }, cost: { cur: 'gems', amt: 20 } }).ok, false);
  assert.deepEqual(plain(f.S), before);
  f.S.rewardReceipts = {}; const malformed = plain(f.S);
  assert.equal(f.Rewards.buyItem('r-pan').why, 'unavailable');
  assert.deepEqual(plain(f.S), malformed); assert.equal(f.saves.length, 0);
});

test('retired bundle receipts are rejected even when paid, while legacy receipt history is preserved', () => {
  const f = load({ raw: { v: 9, owned: ['r-coral', 'f-season'], rewardReceipts: ['purchase:legacy-bundle-charge', 'bundle:4'] } }), before = plain(f.S);
  assert.equal(f.Catalog.starOffer('season-bundle'), null);
  for (const id of ['legacy-bundle-charge', 'new-bundle-charge']) {
    assert.deepEqual(plain(f.Rewards.confirmPurchase('season-bundle', receipt('season-bundle', { id }))), { ok: false, why: 'unconfirmed' });
    assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
  }
  assert.deepEqual(plain(f.S.owned), ['r-standard']);
  assert.deepEqual(plain(f.S.rewardReceipts), ['purchase:legacy-bundle-charge', 'bundle:4']);
});

test('direct retired card rewards cannot partially grant, charge or record receipts', () => {
  const f = load(), before = plain(f.S);
  for (const itemId of ['r-coral', 'r-void', 'r-teal', 'b-ink', 't-gold', 't-coral', 'tb-neon', 'f-season', 'season-bundle']) {
    assert.equal(f.Rewards._grant(['retired:' + itemId], [{ k: 'gems', n: 80 }, { k: 'card', n: 1, itemId }],
      { claim: { lane: 'p', level: 3 }, cost: { cur: 'gems', amt: 10 } }).why, 'unavailable');
    assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
  }
});

test('real Stars pack credit and receipt share one save; replay/reused charges are inert across reload', () => {
  const f = load(), before = plain(f.S), paid = receipt('gems-80', { id: 'pack-charge', amount: 49 });
  assert.deepEqual(plain(f.Rewards.confirmPurchase('gems-80', paid)), { ok: true, items: [], coins: 0, gems: 80 });
  const after = { ...before, gems: before.gems + 80, rewardReceipts: ['purchase:pack-charge'] };
  assert.deepEqual(plain(f.S), after); assert.equal(f.saves.length, 1); assert.deepEqual(f.saves[0], after);
  assert.equal(f.Rewards.confirmPurchase('gems-80', paid).why, 'claimed');
  assert.equal(f.Rewards.confirmPurchase('gems-500', receipt('gems-500', { id: 'pack-charge', amount: 249 })).why, 'claimed');
  assert.deepEqual(plain(f.S), after); assert.equal(f.saves.length, 1);
  const restored = load({ raw: f.saves[0] });
  assert.equal(restored.Rewards.confirmPurchase('gems-80', paid).why, 'claimed');
  assert.deepEqual(plain(restored.S), after); assert.equal(restored.saves.length, 0);
  assert.equal(restored.Rewards.confirmPurchase('gems-80', receipt('gems-80', { id: 'pack-charge-2', amount: 49 })).ok, true);
  assert.equal(restored.S.gems, before.gems + 160, 'packs may be repurchased with a distinct real charge');
  assert.deepEqual(plain(restored.S.rewardReceipts), ['purchase:pack-charge', 'purchase:pack-charge-2']);
  assert.equal(restored.saves.length, 1); assert.deepEqual(restored.saves[0], plain(restored.S));
});

test('unconfirmed, forged-price, mismatched and stale receipts grant nothing', () => {
  for (const extra of [{ confirmed: false }, { status: 'pending' }, { status: 'cancelled' }, { status: 'failed' }, { currency: 'gems' }, { amount: 49 }, { productId: 'gems-80' }, { id: '' }, { id: 'invalid receipt' }, { seasonN: 3 }]) {
    const f = load({ raw: { premium: false } }), before = plain(f.S);
    assert.deepEqual(plain(f.Rewards.confirmPurchase('premium-pass', receipt('premium-pass', extra))),
      { ok: false, why: extra.seasonN === 3 ? 'season' : 'unconfirmed' }, JSON.stringify(extra));
    assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
  }
  const f = load(), before = plain(f.S);
  assert.equal(f.Rewards.confirmPurchase('gems-80', 'paid').why, 'unconfirmed');
  assert.equal(f.Rewards.confirmPurchase('missing', receipt('missing')).why, 'unconfirmed');
  assert.equal(f.Rewards.confirmPurchase('gems-80', { status: 'paid' }).why, 'unconfirmed');
  assert.equal(f.Rewards.confirmPurchase('gems-80', receipt('gems-80')).why, 'unconfirmed', '349 is not the 49 Stars pack price');
  assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
});

test('gem packs use their own XTR price; premium grants entitlement only and preserves legacy flags', () => {
  const f = load({ raw: { premium: false } }), before = plain(f.S);
  assert.equal(f.Rewards.confirmPurchase('gems-80', receipt('gems-80', { amount: 49 })).ok, true);
  assert.equal(f.S.gems, before.gems + 80); assert.deepEqual(plain(f.S.owned), before.owned);
  assert.equal(f.Rewards.confirmPurchase('premium-pass', receipt('premium-pass', { id: 'premium-charge' })).ok, true);
  assert.equal(f.S.premium, true); assert.equal(f.S.gems, before.gems + 80);
  assert.equal(f.saves.length, 2); assert.equal(f.saves[1].premium, true);
  assert.deepEqual(f.saves[1].rewardReceipts, ['purchase:tg-charge-1', 'purchase:premium-charge', 'premium:4']);
  const paid = plain(f.S);
  assert.equal(f.Rewards.confirmPurchase('premium-pass', receipt('premium-pass', { id: 'premium-charge-2' })).why, 'claimed');
  assert.deepEqual(plain(f.S), paid); assert.equal(f.saves.length, 2);
  const legacy = load(), old = plain(legacy.S);
  assert.equal(legacy.Rewards.confirmPurchase('premium-pass', receipt('premium-pass')).why, 'claimed');
  assert.deepEqual(plain(legacy.S), old); assert.equal(legacy.saves.length, 0);
});

test('catalog item purchases and currency exchanges are atomic, canonical and retry-safe', () => {
  const f = load({ raw: { gems: 510 } }), gems = f.S.gems, before = plain(f.S);
  assert.equal(f.Catalog.canBuy({ ...f.Catalog.byId('r-pan'), price: { cur: 'gems', amt: 1 } }).why, 'unavailable');
  assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
  assert.equal(f.Rewards.buyItem('r-pan').ok, true);
  assert.equal(f.S.gems, gems - 500); assert.ok(f.saves[0].owned.includes('r-pan'));
  assert.equal(f.saves[0].gems, gems - 500); assert.ok(f.saves[0].rewardReceipts.includes('item:r-pan'));
  assert.deepEqual(plain(f.S.equipped), { racket: 'r-standard' }, 'buying does not silently equip');
  const bought = plain(f.S);
  assert.equal(f.Rewards.buyItem('r-pan').why, 'owned');
  assert.equal(f.Rewards.buyItem('r-standard').why, 'unavailable');
  assert.deepEqual(plain(f.S), bought); assert.equal(f.saves.length, 1);
  const restored = load({ raw: f.saves[0] });
  assert.equal(restored.Rewards.buyItem('r-pan').why, 'owned');
  assert.deepEqual(plain(restored.S), bought); assert.equal(restored.saves.length, 0);
  const coins = f.S.coins, currentGems = f.S.gems;
  assert.equal(f.Rewards.exchangeCoins('coins-500', 'exchange:test-1').ok, true);
  assert.equal(f.S.gems, currentGems - 10); assert.equal(f.S.coins, coins + 500);
  assert.equal(f.Rewards.exchangeCoins('coins-500', 'exchange:test-1').why, 'claimed');
  assert.equal(f.Rewards.exchangeCoins('missing').ok, false);
  const poor = load({ raw: { coins: 0, gems: 0 } }), old = plain(poor.S);
  assert.equal(poor.Rewards.buyItem('r-pan').why, 'funds');
  assert.equal(poor.Rewards.exchangeCoins('coins-500').why, 'funds');
  assert.deepEqual(plain(poor.S), old); assert.equal(poor.saves.length, 0);
});

test('a failed durable write rolls back currency, inventory, flags and receipts', () => {
  const f = load({ raw: { gems: 1000 } }), before = plain(f.S);
  f.Store.save = () => { throw new Error('disk'); };
  assert.equal(f.Rewards.buyItem('r-pan').why, 'storage');
  assert.deepEqual(plain(f.S), before);
  assert.equal(f.Rewards.claimPass(4, 'p', 3).why, 'storage');
  assert.deepEqual(plain(f.S), before);
  assert.equal(f.Rewards.confirmPurchase('gems-80', receipt('gems-80', { amount: 49 })).why, 'storage');
  assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
});

test('a failed premium receipt write rolls back entitlement and both purchase/season receipts', () => {
  const f = load({ raw: { premium: false } }), before = plain(f.S), saved = f.entries.get('ttu-v2');
  f.Store.save = () => false;
  assert.equal(f.Rewards.confirmPurchase('premium-pass', receipt('premium-pass')).why, 'storage');
  assert.deepEqual(plain(f.S), before); assert.equal(f.entries.get('ttu-v2'), saved); assert.equal(f.saves.length, 0);
});

test('real silent storage/quota failures are detected by the persisted receipt and rolled back', () => {
  for (const setItem of [() => { throw new Error('quota'); }, () => {}]) {
    const f = load({ raw: { gems: 1000 } }), before = plain(f.S), saved = f.entries.get('ttu-v2');
    f.storage.setItem = setItem;
    assert.equal(f.Rewards.buyItem('r-pan').why, 'storage');
    assert.deepEqual(plain(f.S), before); assert.equal(f.entries.get('ttu-v2'), saved);
    assert.equal(f.Rewards.claimPass(4, 'p', 3).why, 'storage');
    assert.deepEqual(plain(f.S), before); assert.equal(f.entries.get('ttu-v2'), saved);
    assert.equal(f.Rewards.confirmPurchase('gems-80', receipt('gems-80', { amount: 49 })).why, 'storage');
    assert.deepEqual(plain(f.S), before); assert.equal(f.entries.get('ttu-v2'), saved);
    assert.equal(f.Rewards.buyItem('unknown-bundle').why, 'unavailable');
    assert.equal(f.Rewards.confirmPurchase('season-bundle', receipt('season-bundle')).why, 'unconfirmed');
    assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
  }
});

for (const legacy of [{ col: '#9f6bff' }, { itemId: 'r-void' }]) test(`legacy cached ${legacy.itemId ? 'retired-ID' : 'color-only'} cards normalize without reopening claims`, () => {
  const pass = Array.from({ length: 20 }, (_, i) => ({ s: 5, l: i + 1, f: { k: 'coins', n: 60 }, p: { k: 'card', n: 1, ...legacy } }));
  const cached = { serverTimeUtc: '2026-11-11T00:00:00Z', events: [{ type: 'season', status: 'active', startsAt: '2026-11-11T00:00:00Z', endsAt: '2026-12-07T00:00:00Z', config: { season: { n: 5 }, pass } }] };
  const raw = { passSeason: 5, claimed: { f: [], p: [3] }, rewardReceipts: ['pass:5:p:6'], owned: ['r-coral'] };
  const f = load({ now: '2026-11-15T00:00:00Z', cached, raw }), before = plain(f.S);
  assert.equal(f.season.seasonNumber(), 5);
  assert.equal(f.season.currentPass()[2].p.itemId, 'r-pan');
  assert.equal(f.Rewards.claimPass(5, 'p', 3).why, 'claimed');
  assert.equal(f.Rewards.claimPass(5, 'p', 6).why, 'claimed');
  assert.deepEqual(plain(f.S), before); assert.deepEqual(plain(f.S.owned), ['r-standard']); assert.equal(f.saves.length, 0);
  const input = structuredClone(cached);
  assert.equal(f.season.setServerSeason(input), true);
  assert.deepEqual(input, cached); assert.deepEqual(JSON.parse(f.entries.get('ttu-seasons')), cached, 'cache retains the raw server cards');
  const bad = structuredClone(cached); bad.events[0].config.pass[0].p = { k: 'card', n: 1, itemId: 'missing', col: '#9f6bff' };
  assert.equal(f.season.setServerSeason(bad), false);
  assert.equal(f.season.seasonNumber(), 5); assert.equal(f.season.currentPass()[0].p.itemId, 'r-pan');
  assert.deepEqual(JSON.parse(f.entries.get('ttu-seasons')), cached);
  const finished = load({ now: '2026-12-08T00:00:00Z', cached, raw }), completed = plain(finished.S);
  assert.equal(finished.season.seasonNumber(), 5); assert.equal(finished.season.seasonOver(), true);
  assert.equal(finished.Rewards.claimPass(5, 'p', 1).why, 'season');
  assert.deepEqual(plain(finished.S), completed); assert.equal(finished.saves.length, 0);
});

// Small DOM boundary and virtual clock: report behavior without Chrome or an engine.
class ReportNode {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = new Map(); this.className = ''; this.html = '';
    this.style = { setProperty() {} };
    this.classList = { add: (...names) => { this.className = [...new Set(this.className.split(' ').concat(names))].join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter(n => !names.includes(n)).join(' '); },
      contains: name => this.className.split(' ').includes(name) };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = String(v); if (k.startsWith('data-')) this.dataset[k.slice(5)] = String(v); }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  get isConnected() { return !!this.connected || !!this.parentNode?.isConnected; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(n => n !== this); this.parentNode = null; this.connected = false; }
  set innerHTML(html) {
    this.html = html; this.children.forEach(n => { n.parentNode = null; }); this.children = [];
    const container = html.match(/^\s*<div class="(res [^"]*|mx[^"]*)"/);
    if (container) {
      const node = new ReportNode(); node.className = container[1]; this.appendChild(node);
      node.animate = () => { const animation = { cancelled: 0, cancel() { this.cancelled++; } }; this.animationLog?.push(animation); return animation; };
    }
    for (const match of html.matchAll(/<(b|span) class="(h-display|rec)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      const node = this.appendChild(new ReportNode(match[1])); node.className = match[2]; node.innerHTML = match[3]; node.textContent = match[3];
    }
    for (const match of html.matchAll(/<button\b([^>]*)>/g)) {
      const node = this.appendChild(new ReportNode('button'));
      for (const attr of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(attr[1], attr[2]);
      node.disabled = /\bdisabled\b/.test(match[1]);
    }
  }
  get innerHTML() { return this.html; }
  get outerHTML() {
    const attrs = { ...this.attrs, ...Object.fromEntries(Object.entries(this.dataset).map(([k, v]) => ['data-' + k, v])) };
    return `<${this.tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>${this.html}</${this.tag}>`;
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    const data = selector.match(/^\[data-(act|a)=["']?([^"'\]]+)["']?\]$/);
    return data ? this.dataset[data[1]] === data[2] : this.tag === selector;
  }
  querySelectorAll(selector) {
    if (selector.includes(' ')) { const [parent, child] = selector.split(' '); return this.querySelectorAll(parent).flatMap(n => n.querySelectorAll(child)); }
    return this.children.flatMap(n => [...(n.matches(selector) ? [n] : []), ...n.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let n = this; n; n = n.parentNode) if (selector === '[data-act]' ? !!n.dataset.act : n.matches(selector)) return n; return null; }
  addEventListener(type, fn) { const set = this.events.get(type) || new Set(); set.add(fn); this.events.set(type, set); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  click() {
    if (this.disabled) return;
    for (let n = this; n; n = n.parentNode) for (const fn of [...(n.events.get('click') || [])]) fn({ target: this, currentTarget: n });
  }
}

function reportFixture(raw = {}) {
  let now = Date.parse('2026-10-20T12:00:00Z'), timerId = 0;
  const timers = new Map(), trace = { saves: [], routes: [], audio: [], effects: [], levels: [], progress: [], host: [], locale: [], hud: [] };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const initial = { v: 10, name: 'Long Player Name', rating: 1000, xp: 100, xpMax: 1800, level: 1, coins: 1000, gems: 500,
    wins: 0, losses: 0, streak: 0, rm: true, chests: [null, null, null, null], owned: ['r-standard', 'r-pan'],
    equipped: { racket: 'r-pan' }, rewardReceipts: ['item:r-pan'], ...raw };
  const entries = new Map([['ttu-v2', JSON.stringify(initial)]]), body = new ReportNode(); body.connected = true;
  let api;
  const Router = { screens: {}, busy: false, def(id, screen) { this.screens[id] = screen; }, go(id, options = {}) {
    trace.routes.push({ id, data: options.data }); this.cur = id;
    this.activeScreen?.leave(); if (this.activeView) this.activeView.connected = false; this.activeScreen = null;
    return Promise.resolve();
  } };
  const host = { subs: new Set(), debug: false, strokeCatalog: [], send(type) { trace.host.push(type); this.onCommand?.(type); },
    on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }, show() {}, ensure() {} };
  const document = { body, visibilityState: 'visible', addEventListener() {}, createElement: tag => new ReportNode(tag), createElementNS: (_, tag) => new ReportNode(tag) };
  const context = vm.createContext({ Date: Clock, Intl, console, structuredClone, document, window: { addEventListener() {} },
    localStorage: { getItem: k => entries.get(k) ?? null, setItem(k, v) { entries.set(k, v); if (k === 'ttu-v2') trace.saves.push(JSON.parse(v)); }, removeItem: k => entries.delete(k) },
    setTimeout(fn, ms = 0) { const id = ++timerId; timers.set(id, { fn, due: now + ms }); return id; }, clearTimeout: id => timers.delete(id),
    Router, GameHost: host, PEOPLE: [{ s: 'Full Opponent Name', n: 'Full Opponent Name', r: 1200, club: 'Club', c: ['#fff', '#ccc'] }],
    BATTLE: { opp: 0, t0: now - 5000 }, MODE: { id: 'career', tk: 'hub.career' }, TARGET: { career: 11 },
    Art: new Proxy({ chestName: k => api.I18n.t('chest.' + k) }, { get: (o, k) => o[k] || (() => `<svg data-art="${k}"></svg>`) }),
    UI: { notificationButton: () => '<button data-act="notifications"></button>' }, devBtn: () => '', TGX: { guard() {} }, BG: { mood() {} }, REASON: () => '',
    Sfx: new Proxy({}, { get: (_, k) => () => trace.audio.push(k) }), FX: new Proxy({ W: 390, H: 844 }, { get: (o, k) => o[k] || (() => trace.effects.push(k)) }),
    haptic() {}, flash() {}, LevelUp: { show: n => trace.levels.push(n) },
    Progress: { match: d => trace.progress.push(['match', plain(d)]), level: d => trace.progress.push(['level', plain(d)]) },
    ZoneStats: { matchSummary: () => ({ n: 0, hit: 0, pct: 0, dots: [] }), logMatch: () => trace.effects.push('log-match') },
    animateAchievements: async (list, alive) => { if (alive()) trace.effects.push('achievements'); } });
  const files = ['core/state.js', 'core/util.js', 'core/i18n.js', 'locales/ru.js', 'locales/en.js', 'data/leagues.js',
    'services/career.js', 'ui/stroke_icons.js', 'ui/match_hud.js', 'screens/result.js', 'screens/match.js'];
  vm.runInContext(files.map(read).join('\n') + '\nachievementPops = animateAchievements; globalThis.api = { S, I18n, MatchHUD, Daily, Career, PEOPLE, ratingDelta, Router };', context);
  api = context.api; api.I18n.lang = 'en';
  api.I18n.localizeDOM = (el, html, skip) => { el.localizedMarkup = html; trace.locale.push(skip); };
  const view = html => {
    const el = new ReportNode(); el.connected = true; el.animationLog = trace.effects; el.innerHTML = html;
    return el;
  };
  const result = Router.screens.result;
  const mount = d => { const el = view(result.render(d)); Router.activeScreen = result; Router.activeView = el; result.mount(el); return el; };
  const makeSummary = (contacts = [[1, 'DRIVE', 40.5, 0], [-1, 'BLOCK', 30, 6]]) => {
    const summary = api.MatchHUD.createSummary();
    let snapshot = { schema: 1, matchId: 'report-match', seq: 1, rallyId: 1, phase: 'SERVE_READY', rally: 0, score: [0, 0], contacts: [null, null], event: { id: 1, type: 'serve', side: 1 } };
    summary.accept(snapshot);
    for (const [side, stroke, kmh, rps] of contacts) {
      const id = snapshot.event.id + 1, records = snapshot.contacts.slice();
      records[side === 1 ? 0 : 1] = { matchId: snapshot.matchId, rallyId: 1, eventId: id, side, stroke, kmh, rps };
      snapshot = { ...snapshot, seq: snapshot.seq + 1, phase: 'RALLY', rally: snapshot.rally + 1, contacts: records, event: { id, type: 'hit', side } };
      summary.accept(snapshot);
    }
    return summary;
  };
  const match = Router.screens.match;
  const mountMatch = () => {
    const el = view('<div class="mx live"></div>'); Router.activeScreen = match; Router.activeView = el;
    match.el = el; match.alive = true; match.timers = []; match.identities = [api.S.name, api.PEOPLE[0].s];
    match.hudSnapshot = null; match.result = null; match.presentation = api.MatchHUD.createSummary();
    match.hud = { update: snapshot => trace.hud.push(plain(snapshot)), dispose() {} };
    match.st = { p: 0, o: 0, server: 0, over: false, hits: 0, perfect: 0, smash: 0, maxRally: 0, myServes: 0,
      live: true, spin: 0, oppHits: 0, rallyHits: 0, servePts: 0, serveWon: 0, seq: [] };
    match.off = host.on(m => match.onMsg(m));
    return el;
  };
  const advance = async ms => {
    const until = now + ms;
    for (let i = 0; i < 1000; i++) {
      await Promise.resolve(); await Promise.resolve();
      const next = [...timers.entries()].filter(([, t]) => t.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      now = Math.max(now, next[1].due); timers.delete(next[0]); next[1].fn();
    }
    now = until; await Promise.resolve(); await Promise.resolve();
  };
  return { ...api, context, trace, timers, result, match, host, view, mount, mountMatch, makeSummary, advance, stored: () => JSON.parse(entries.get('ttu-v2')) };
}

for (const [win, quit, me, op] of [[true, false, 11, 7], [false, false, 7, 11], [false, true, 9, 2]]) {
  test(`report ${quit ? 'surrender while leading' : win ? 'win' : 'loss'} uses authoritative outcome and commits before actions`, async () => {
    const f = reportFixture(), before = plain(f.S), d = { win, quit, me, op, opp: 0, names: ['Player <b>One</b>', 'Entire Opponent Name'],
      stats: { hits: 99, perfect: 5, maxRally: 3, acc: 81, winners: 9 }, presentation: f.makeSummary().freeze(), durationMs: 5000, mode: 'career' };
    const preview = f.result.render(d);
    assert.deepEqual(plain(f.S), before); assert.equal(d.applied, undefined);
    assert.match(preview, new RegExp(`data-outcome="${win ? 'win' : 'lose'}"`));
    assert.match(preview, new RegExp(`<span>${me}</span><i>:</i><span>${op}</span>`));
    assert.ok(preview.includes('Player &lt;b&gt;One&lt;/b&gt;') && preview.includes('Entire Opponent Name'));
    assert.doesNotMatch(preview, /Accuracy|Winners|81%|res-ill|medals|res-sheet/);
    const el = f.mount(d);
    assert.equal(d.applied, true); assert.equal(f.S.xp, before.xp + (win ? 180 : 60));
    assert.equal(f.S.coins, before.coins + (win ? 90 : 0)); assert.equal(f.S.gems, before.gems);
    assert.equal(f.S.rating, Math.max(0, before.rating + f.ratingDelta(before.rating, f.PEOPLE[0].r, win)));
    assert.equal(f.S.wins, win ? 1 : 0); assert.equal(f.S.losses, win ? 0 : 1); assert.deepEqual(plain(f.S.form), [win ? 1 : 0]);
    assert.equal(el.innerHTML.includes('res-reward'), win); assert.equal(el.innerHTML.includes('Match surrendered'), quit);
    assert.equal((el.innerHTML.match(/class="res-scroll scroll"/g) || []).length, 1);
    assert.ok(el.innerHTML.indexOf('</div></div>\n      <footer class="res-btns">') > 0);
    el.querySelector('[data-act=next]').click(); await f.advance(500);
    assert.equal(f.trace.routes[0].id, 'hub'); assert.equal(f.stored().xp, f.S.xp); assert.deepEqual(f.trace.audio, []);
    assert.deepEqual(f.trace.progress.map(([kind]) => kind), ['match']);
  });
}

test('report duplicate render, localization, disposal and identity remount cannot re-award or leak another result', async () => {
  const f = reportFixture(), d = { win: true, me: 11, op: 7, opp: 0, stats: {}, presentation: f.makeSummary().freeze() };
  const el = f.mount(d); await f.advance(250); const awarded = plain(f.S), saved = f.trace.saves.length, report = f.result.report;
  for (const lang of ['ru', 'en', 'ru', 'en']) { f.I18n.lang = lang; f.result.refreshLocale(el); f.result.render(d); }
  assert.equal(f.result.report, report); assert.equal(f.result.d, d); assert.deepEqual(plain(f.S), awarded); assert.equal(f.trace.saves.length, saved);
  assert.ok(f.trace.locale.every(skip => skip === '.rs-n'), 'frozen metric numbers can reformat with the locale; exact scores stay untouched');
  f.result.dispose(); f.mount(d); await f.advance(500);
  assert.deepEqual(plain(f.S), awarded); assert.equal(f.trace.saves.length, saved); assert.equal(f.trace.audio.length, 1);
  const second = { win: false, me: 4, op: 11, opp: 0, stats: {} }; f.result.dispose(); f.mount(second); await f.advance(250);
  const afterSecond = plain(f.S); f.result.dispose(); const returned = f.mount(d);
  assert.equal(f.result.report, report); assert.deepEqual(plain(f.S), afterSecond);
  assert.ok(returned.innerHTML.includes('+180 XP') && returned.innerHTML.includes('Coins for the win'));
  assert.equal(f.result.report.levelUp, false);
  const imported = { ...d, applied: true }; f.result.dispose(); const old = f.mount(imported);
  assert.deepEqual(plain(f.S), afterSecond); assert.doesNotMatch(old.innerHTML, /res-reward|\+180 XP/);
});

test('report victory loot respects full/free slots and rechecks a slot filled between render and mount', async () => {
  for (const open of [false, true, 'filled-late']) {
    const chests = Array.from({ length: 4 }, (_, i) => ({ id: 'old-' + i, kind: 'gold', state: 'ready' }));
    if (open) chests[2] = null;
    const f = reportFixture({ chests }), d = { win: true, me: 11, op: 7, opp: 0, stats: {} }, before = plain(f.S);
    const el = f.view(f.result.render(d));
    if (open === 'filled-late') f.S.chests[2] = { id: 'late', kind: 'gold', state: 'ready' };
    f.result.mount(el); await f.advance(250);
    assert.equal(f.S.coins, before.coins + 90); assert.equal(f.S.gems, before.gems);
    assert.deepEqual(plain(f.S.owned), before.owned); assert.deepEqual(plain(f.S.equipped), before.equipped); assert.deepEqual(plain(f.S.rewardReceipts), before.rewardReceipts);
    const granted = f.S.chests.filter(c => c?.kind === 'silver');
    assert.equal(granted.length, open === true ? 1 : 0); assert.equal(el.innerHTML.includes('Locked chest assigned to a free slot'), open === true);
    if (open === true) assert.deepEqual(plain(f.S.chests[2]), { id: 'c' + Date.parse('2026-10-20T12:00:00Z'), kind: 'silver', state: 'locked' });
    for (const i of [0, 1, 3]) assert.deepEqual(plain(f.S.chests[i]), before.chests[i]);
    assert.equal(f.trace.saves.length, 1); f.result.leave();
  }
});

test('report XP rollover shows carried XP and opens the separate level-up Claim gate at most once', async () => {
  for (const [win, xp, carried] of [[true, 1750, 130], [false, 1780, 40]]) {
    const f = reportFixture({ xp, level: 3 }), before = plain(f.S), d = { win, me: win ? 11 : 7, op: win ? 7 : 11, opp: 0, stats: {}, durationMs: 5000 };
    const el = f.mount(d);
    assert.equal(f.S.level, 4); assert.equal(f.S.xp, carried); assert.equal(f.result.report.xp, carried);
    assert.ok(el.innerHTML.includes(`id="rXp">${carried}</b>`) && el.innerHTML.includes('XP · level 4'));
    el.querySelector('[data-act=level-up]').click(); f.result.openLevelUp();
    await f.advance(1000); assert.deepEqual(f.trace.levels, [4]);
    assert.equal(f.S.coins, before.coins + (win ? 90 : 0)); assert.equal(f.S.gems, before.gems, 'level-up currencies wait for the separate Claim gate');
    assert.deepEqual(f.trace.progress.map(([kind]) => kind), ['match', 'level']);
    f.I18n.lang = 'ru'; f.result.refreshLocale(el); f.result.dispose(); f.mount(d); await f.advance(1000);
    assert.deepEqual(f.trace.levels, [4]); assert.equal(f.S.xp, carried); assert.equal(f.S.level, 4); f.result.leave();
  }
});

test('report early Rematch/Next/Back and busy-transition retries own cancellation and keep the same routes', async () => {
  for (const action of ['again', 'next', 'back']) {
    const f = reportFixture({ rm: false }), d = { win: true, me: 11, op: 7, opp: 0, stats: {}, unlocked: [{ id: 'first_win' }] };
    const el = f.mount(d), opponent = f.context.BATTLE.opp, mode = f.context.MODE.id;
    if (action === 'back') f.result.onBack(); else el.querySelector(`[data-act=${action}]`).click();
    await f.advance(5000);
    assert.deepEqual(f.trace.routes.map(r => r.id), [action === 'again' ? 'match' : 'hub']);
    assert.equal(f.context.BATTLE.opp, opponent); assert.equal(f.context.MODE.id, mode);
    assert.deepEqual(f.trace.audio, []); assert.deepEqual(f.trace.levels, []);
    assert.equal(f.trace.effects.length, 1);
    assert.ok(f.trace.effects.every(a => typeof a === 'object' && a.cancelled === 1));
    assert.equal(f.stored().coins, 1090); assert.equal(f.stored().xp, 280);
    el.querySelector('[data-act=next]').click(); assert.equal(f.trace.routes.length, 1);
  }
  const queued = reportFixture(), d = { win: false, me: 7, op: 11, opp: 0, stats: {} };
  const el = queued.mount(d); queued.Router.busy = true; el.querySelector('[data-act=next]').click();
  assert.equal(queued.trace.routes.length, 0); queued.Router.busy = false; await queued.advance(40);
  assert.deepEqual(queued.trace.routes.map(r => r.id), ['hub']);
  const cancelled = reportFixture(); const old = cancelled.mount({ ...d, applied: false });
  cancelled.Router.busy = true; old.querySelector('[data-act=again]').click(); cancelled.result.leave(); cancelled.Router.busy = false;
  await cancelled.advance(500); assert.deepEqual(cancelled.trace.routes, []); assert.deepEqual(cancelled.trace.audio, []);
});

test('report real stroke comparison, supported zero spin and missing/partial data localize without demo metrics', () => {
  const f = reportFixture(), all = f.context.StrokeIcons.ids;
  const contacts = [...all].map(id => [1, id, 40.5, 0]);
  const d = { win: true, me: 22, op: 20, opp: 0, stats: { hits: 99, acc: 81, winners: 5 },
    presentation: f.makeSummary(contacts).freeze(), names: ['Long <script>Player</script> Name', 'Whole Opponent Identity'] };
  let html = f.result.render(d);
  assert.equal((html.match(/<tr data-stroke=/g) || []).length, 20);
  for (const id of all) assert.ok(html.includes(`data-stroke="${id}"`));
  assert.match(html, /data-metric="spin-avg" data-coverage="complete">0<\/td>/);
  assert.match(html, /data-metric="spin-avg" data-coverage="missing"><span class="res-missing"/);
  assert.ok(html.includes('40.5') && html.includes('Strokes played') && html.includes('Average total spin'));
  assert.ok(html.includes('&lt;script&gt;Player&lt;/script&gt;')); assert.doesNotMatch(html, /<script>|Accuracy|81%|Winners/);
  f.I18n.lang = 'ru'; html = f.result.render(d);
  assert.ok(html.includes('40,5') && html.includes('Использованные удары') && html.includes('Среднее вращение'));
  const partial = f.makeSummary([[1, 'UNRECOGNIZED', 0, -1]]); partial.recover();
  html = f.result.render({ win: false, me: 9, op: 2, opp: 999, stats: {}, presentation: partial.freeze() });
  assert.ok(html.includes('data-stroke="UNKNOWN"') && html.includes('Неполная выборка'));
  assert.match(html, /data-metric="speed-avg" data-coverage="partial"><abbr[^>]*>0\*<\/abbr>/);
  assert.doesNotMatch(html, /data-metric="spin-/); assert.ok(html.includes('Соперник'));
  html = f.result.render({ win: false, me: 4, op: 7, opp: 0, stats: { hits: 38, perfect: 5, maxRally: 12, acc: 81 } });
  assert.ok(html.includes('Нет записи контактов') && html.includes('Нет данных о технике ударов'));
  assert.doesNotMatch(html, /data-metric=|data-stroke=|81%/);
  const css = read('css/screens_battle.css').split('/* ---------- RESULT ---------- */')[1].split('/* ---------- CHEST OPEN ---------- */')[0];
  assert.match(css, /\.res\{[^}]*flex-direction:column[^}]*overflow:hidden/);
  assert.match(css, /\.res-btns \.b3\{[^}]*min-height:48px/);
  assert.doesNotMatch(css, /@media|res-widgets|res-sheet|opacity:0|position:sticky/);
});

test('report queued early navigation cancels presentation and level-up while retaining committed rewards', async () => {
  const f = reportFixture({ xp: 1750, rm: false }), d = { win: true, me: 11, op: 7, opp: 0, stats: {} };
  const el = f.mount(d); f.Router.busy = true; el.querySelector('[data-act=next]').click();
  await f.advance(1000);
  assert.deepEqual(f.trace.routes, []); assert.deepEqual(f.trace.audio, []); assert.deepEqual(f.trace.levels, []);
  assert.ok(f.trace.effects.every(a => typeof a === 'object' && a.cancelled === 1));
  assert.equal(f.S.xp, 130); assert.equal(f.S.level, 2); assert.equal(f.S.coins, 1090);
  f.Router.busy = false; await f.advance(40);
  assert.deepEqual(f.trace.routes.map(r => r.id), ['hub']); assert.equal(f.stored().xp, 130);
});

test('report absent outcome cannot invent a winner, a reward or a defeat sound from a leading score', async () => {
  const f = reportFixture(), before = plain(f.S), d = { me: 9, op: 2, opp: 999, stats: {} };
  const el = f.mount(d); await f.advance(1000);
  assert.match(el.innerHTML, /data-outcome="finished"/); assert.ok(el.innerHTML.includes('Match finished'));
  assert.doesNotMatch(el.innerHTML, /res-reward|\+180 XP|\+60 XP|class="rs-p w"/);
  assert.equal(d.applied, undefined); assert.deepEqual(plain(f.S), before); assert.deepEqual(f.trace.saves, []);
  assert.deepEqual(f.trace.progress, []); assert.deepEqual(f.trace.audio, []);
});

test('match accepts only HUD contact metrics, retains recovery and freezes the same presentation before outro', async () => {
  const f = reportFixture(); f.mountMatch();
  const start = { schema: 1, matchId: 'accepted-match', seq: 1, rallyId: 1, phase: 'SERVE_READY', rally: 0,
    score: [0, 0], contacts: [null, null], event: { id: 1, type: 'serve', side: 1 } };
  f.match.onMsg({ type: 'hud', snapshot: start });
  f.match.onMsg({ type: 'hit', by: 1, rally: 1, stroke: 'SMASH', kmh: 999, rps: 999 });
  f.match.onMsg({ type: 'calibrationPending' });
  const contact = { matchId: start.matchId, rallyId: 1, eventId: 2, side: 1, stroke: 'DRIVE', kmh: 40, rps: 0 };
  const accepted = { ...start, seq: 2, phase: 'RALLY', rally: 1, contacts: [contact, null], event: { id: 2, type: 'hit', side: 1 } };
  f.match.onMsg({ type: 'hud', snapshot: accepted });
  let frozen;
  f.host.onCommand = type => { if (type === 'outro') { frozen = f.match.result.presentation; assert.ok(Object.isFrozen(frozen)); } };
  const end = { won: true, score: [11, 7], stats: { shots: 1, maxSpeed: 999, maxSpin: 999 }, ai: { shots: 0 }, bestRally: 1 };
  const pending = f.match.finish(end), career = plain(f.S.car);
  f.match.onMsg({ type: 'matchEnd', ...end });
  f.match.onMsg({ type: 'hud', snapshot: { ...accepted, seq: 3, contacts: [{ ...contact, eventId: 3, kmh: 999 }, null] } });
  contact.kmh = 999; end.stats.shots = 999;
  assert.equal(f.match.presentation.freeze(end), frozen); assert.equal(frozen.recovered, true); assert.equal(frozen.coverage, 'partial');
  assert.equal(frozen.players[0].hits, 1); assert.equal(frozen.players[0].speed.avg, 40); assert.equal(frozen.players[0].spin.avg, 0);
  assert.equal(frozen.players[1].hits, 0); assert.equal(frozen.players[1].speed.avg, null);
  assert.deepEqual(plain(frozen.players[0].byStroke), { DRIVE: 1 }); assert.equal(f.match.result.stats.hits, 1, 'legacy career counters remain separate');
  assert.equal(f.trace.hud.length, 2); assert.deepEqual(plain(f.S.car), career);
  await f.advance(3000); await pending;
  assert.deepEqual(f.trace.routes.map(r => r.id), ['result']); assert.equal(f.trace.routes[0].data.presentation, frozen);
});

for (const completion of ['replayEnd', 'synchronous-replayEnd', 'skip', 'timeout']) {
  test(`match frozen result survives ${completion}, duplicate end and locale refresh without duplicate rewards`, async () => {
    const f = reportFixture(); const el = f.mountMatch(), st = f.match.st;
    st.p = 11; st.o = 7; st.maxRally = 4;
    const end = { won: true, score: [11, 7], stats: { shots: 2 }, ai: { shots: 1 }, bestRally: 4, hasReplay: true };
    if (completion === 'synchronous-replayEnd') f.host.onCommand = type => { if (type === 'replay') for (const fn of [...f.host.subs]) fn({ type: 'replayEnd' }); };
    const pending = f.match.finish(end), result = f.match.result;
    await f.match.finish(end); await f.advance(3000);
    if (completion !== 'synchronous-replayEnd') {
      const replay = el.querySelector('.mx-replay'); assert.ok(replay);
      f.I18n.lang = 'ru'; f.match.refreshLocale(el); f.I18n.lang = 'en'; f.match.refreshLocale(el);
      assert.ok(el.querySelector('.mx-replay .rec').innerHTML.includes('Replay'));
      assert.equal(f.match.result, result); assert.equal(Object.isFrozen(result.presentation), true);
      assert.equal(f.S.wins, 0); assert.equal(f.S.coins, 1000); assert.equal(f.S.xp, 100, 'outro/replay do not award result rewards');
      if (completion === 'skip') replay.querySelector('[data-a=skip]').click();
      else if (completion === 'replayEnd') for (const fn of [...f.host.subs]) fn({ type: 'replayEnd' });
      else await f.advance(16000);
    }
    await pending;
    assert.deepEqual(f.trace.routes.map(r => r.id), ['result']); assert.equal(f.trace.routes[0].data, result);
    assert.equal(f.trace.host.filter(type => type === 'outro').length, 1); assert.equal(f.trace.host.filter(type => type === 'replay').length, 1);
    assert.equal(f.trace.host.filter(type => type === 'skipReplay').length, completion === 'skip' ? 1 : 0);
    assert.equal(f.host.subs.size, 0); assert.equal(f.timers.size, 0);
    f.mount(result); await f.advance(250); const awarded = plain(f.S), saves = f.trace.saves.length;
    f.result.refreshLocale(f.result.el); f.result.dispose(); f.mount(result); await f.advance(20000);
    assert.deepEqual(plain(f.S), awarded); assert.equal(f.trace.saves.length, saves); assert.equal(f.S.coins, 1090);
    assert.equal(f.S.xp, 280); assert.deepEqual(f.trace.routes.map(r => r.id), ['result']);
  });
}

for (const at of [0, 1000, 3000]) test(`match early navigation at ${at}ms cannot finish over a later mount`, async () => {
  const f = reportFixture(); const old = f.mountMatch();
  const pending = f.match.finish({ won: true, score: [11, 7], stats: {}, hasReplay: true });
  await f.advance(at); f.Router.go('hub'); f.mountMatch();
  await f.advance(20000); await pending;
  assert.deepEqual(f.trace.routes.map(r => r.id), ['hub']); assert.equal(f.match.result, null); assert.equal(f.match.st.over, false);
  assert.equal(f.S.wins, 0); assert.equal(f.S.coins, 1000); assert.equal(old.isConnected, false);
  assert.equal(f.host.subs.size, 1, 'only the new match owns a host listener');
  f.match.leave(); assert.equal(f.host.subs.size, 0);
});

test('match surrender while leading uses won, bypasses outro and leaves daily rewards for Home', async () => {
  const f = reportFixture({ daily: { d: '2026-10-20', ids: ['win1', 'hits40', 'rally8'], p: { win1: 0, hits40: 39, rally8: 0 }, got: {} } });
  f.mountMatch(); f.match.st.p = 9; f.match.st.o = 2; f.match.st.hits = 40;
  const before = plain(f.S); await f.match.finish({ won: false, quit: true, score: [9, 2] });
  const surrendered = f.trace.routes[0].data;
  assert.equal(surrendered.win, false); assert.equal(surrendered.quit, true); assert.equal(surrendered.me, 9); assert.equal(surrendered.op, 2);
  assert.equal(surrendered.quests, undefined); assert.equal(surrendered.unlocked, undefined); assert.deepEqual(plain(f.S), before);
  assert.ok(!f.trace.host.includes('outro') && !f.trace.host.includes('replay'));
  f.mount(surrendered); assert.equal(f.S.coins, before.coins); assert.equal(f.S.xp, before.xp + 60);
  const g = reportFixture({ daily: before.daily }); g.mountMatch(); g.match.st.hits = 1; g.match.st.maxRally = 8;
  const pending = g.match.finish({ won: true, score: [11, 7], stats: {}, bestRally: 8 });
  const won = g.match.result; assert.deepEqual(plain(won.quests.map(q => q.id)), ['win1', 'hits40', 'rally8']);
  assert.equal(g.Daily.ready(), 3); assert.equal(g.S.coins, 1000); assert.deepEqual(plain(g.S.daily.got), {});
  await g.advance(3000); await pending; const el = g.mount(won), awarded = plain(g.S), saves = g.trace.saves.length;
  assert.ok(el.innerHTML.includes('Ready to claim') && el.innerHTML.includes('Claim the reward on Home.'));
  g.I18n.lang = 'ru'; g.result.refreshLocale(el);
  assert.ok(el.localizedMarkup.includes('Забери награду на главной.') && el.localizedMarkup.includes(g.I18n.t('mission.win1')));
  assert.deepEqual(plain(g.S), awarded); assert.equal(g.trace.saves.length, saves); assert.deepEqual(plain(g.S.daily.got), {});
  assert.equal(g.S.coins, 1090); assert.equal(g.Daily.ready(), 3);
});

test('report inline contact analysis uses validated observed attempts and never fabricates an empty map or accuracy', () => {
  const f = reportFixture(), base = { win: false, me: 7, op: 11, opp: 0, stats: { acc: 99 } };
  const coach = { n: 40, hit: 30, pct: 99, side: 36, fwd: 150, back: 100,
    dots: Array.from({ length: 40 }, (_, i) => ({ dx: i - 20, dy: i, contact: i % 2 === 0, accepted: true })) };
  const html = f.result.render({ ...base, coach });
  assert.ok(html.includes('<details class="res-analysis">') && html.includes('75%'));
  assert.ok(html.includes('Recorded contact-zone attempts: 40. This is a sample, not match accuracy.'));
  assert.equal((html.match(/<circle cx=/g) || []).length, 24); assert.doesNotMatch(html, /99%|heatG|res-sheet/);
  for (const bad of [null, { ...coach, n: 2 }, { ...coach, hit: 41 }, { ...coach, fwd: Infinity }, { ...coach, dots: [] }, { ...coach, dots: [{ dx: NaN, dy: 0 }] }]) {
    assert.doesNotMatch(f.result.render({ ...base, coach: bad }), /res-analysis|rs-map|99%/);
  }
});
