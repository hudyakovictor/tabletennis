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

test('every fallback pass card identifies a real catalog item, including Void Pulse', () => {
  const f = load(), cards = f.season.currentPass().map((tier) => tier.p).filter((r) => r.k === 'card');
  assert.deepEqual([...new Set(cards.map((r) => r.itemId))], ['r-coral', 'r-void', 'r-teal']);
  for (const card of cards) assert.equal(f.Catalog.rewardItem(card).id, card.itemId);
});

test('pass card ownership, claim and receipt share one durable save and replay is inert', () => {
  const f = load(), result = f.Rewards.claimPass(4, 'p', 3);
  assert.equal(result.ok, true);
  assert.deepEqual(plain(result.items), ['r-coral']);
  assert.equal(f.saves.length, 1);
  assert.ok(f.saves[0].owned.includes('r-coral'));
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
  const f = load({ raw: { v: 5, owned: ['r-teal'], claimed: { f: [1], p: [3] } } });
  const before = plain(f.S);
  assert.equal(f.Rewards.claimPass(4, 'p', 3).why, 'claimed');
  assert.deepEqual(plain(f.S), before);
  assert.deepEqual(plain(f.S.owned), ['r-teal']); assert.equal(f.saves.length, 0);
  assert.ok(f.entries.has('ttu-v2.bak'));
});

test('an already owned pass card consumes its tier once without duplicate inventory entries', () => {
  const f = load({ raw: { owned: ['r-coral'] } });
  const result = f.Rewards.claimPass(4, 'p', 3);
  assert.equal(result.ok, true); assert.deepEqual(plain(result.items), []);
  assert.deepEqual(plain(f.S.owned), ['r-coral']); assert.ok(f.S.claimed.p.includes(3));
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
  const f = load(), before = plain(f.S);
  for (const ids of [null, 'scalar', [], ['duplicate', 'duplicate'], ['trailing '], [undefined]]) {
    assert.equal(f.Rewards._grant(ids, [{ k: 'gems', n: 80 }], { cost: { cur: 'coins', amt: 20 } }).ok, false);
    assert.deepEqual(plain(f.S), before);
  }
  assert.equal(f.Rewards._grant(['valid'], [{ k: 'coins', n: 80 }], { claim: { lane: 'bad', level: 1 }, cost: { cur: 'gems', amt: 20 } }).ok, false);
  assert.deepEqual(plain(f.S), before);
  f.S.rewardReceipts = {}; const malformed = plain(f.S);
  assert.equal(f.Rewards.buyItem('r-coral').ok, false);
  assert.deepEqual(plain(f.S), malformed); assert.equal(f.saves.length, 0);
});

test('confirmed bundle grants exactly its known items and 80 gems, once per season and receipt', () => {
  const f = load(), coins = f.S.coins, gems = f.S.gems;
  assert.equal(f.Catalog.byId('f-season').kind, 'frame');
  assert.equal(f.Catalog.bundles()[0].id, 'season-bundle');
  assert.equal(f.Rewards.confirmPurchase('season-bundle', receipt('season-bundle')).ok, true);
  assert.equal(f.S.coins, coins); assert.equal(f.S.gems, gems + 80);
  assert.ok(f.S.owned.includes('r-coral')); assert.ok(f.S.owned.includes('f-season'));
  assert.deepEqual(plain(f.S.equipped), { rubber: 'r-teal', blade: 'b-ink', trail: 't-coral' });
  assert.equal(f.saves.length, 1);
  assert.deepEqual(plain(f.S.rewardReceipts), ['purchase:tg-charge-1', 'bundle:4']);
  assert.equal(f.Rewards.confirmPurchase('season-bundle', receipt('season-bundle')).why, 'claimed');
  assert.equal(f.Rewards.confirmPurchase('season-bundle', receipt('season-bundle', { id: 'second-charge' })).why, 'claimed');
  assert.equal(f.S.gems, gems + 80); assert.equal(f.saves.length, 1);
  const restored = load({ raw: f.saves[0] });
  assert.equal(restored.Rewards.confirmPurchase('season-bundle', receipt('season-bundle')).why, 'claimed');
});

test('a broken bundle cannot partially grant, charge or record its receipt', () => {
  const f = load(), before = plain(f.S);
  f.Catalog.byId('season-bundle').items.push('unknown-frame');
  assert.equal(f.Rewards.confirmPurchase('season-bundle', receipt('season-bundle')).ok, false);
  assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
});

test('unconfirmed, forged-price, mismatched and stale receipts grant nothing', () => {
  for (const extra of [{ confirmed: false }, { status: 'pending' }, { status: 'cancelled' }, { status: 'failed' }, { currency: 'gems' }, { amount: 49 }, { productId: 'gems-80' }, { id: '' }, { id: 'invalid receipt' }, { seasonN: 3 }]) {
    const f = load(), before = plain(f.S);
    assert.equal(f.Rewards.confirmPurchase('season-bundle', receipt('season-bundle', extra)).ok, false, JSON.stringify(extra));
    assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
  }
  const f = load();
  assert.equal(f.Rewards.confirmPurchase('gems-80', 'paid').ok, false);
  assert.equal(f.Rewards.confirmPurchase('missing', receipt('missing')).ok, false);
  assert.equal(f.Rewards.confirmPurchase('gems-80', { status: 'paid' }).ok, false);
});

test('gem packs use their own XTR price; premium grants entitlement only and preserves legacy flags', () => {
  const f = load({ raw: { premium: false } }), before = plain(f.S);
  assert.equal(f.Rewards.confirmPurchase('gems-80', receipt('gems-80', { amount: 49 })).ok, true);
  assert.equal(f.S.gems, before.gems + 80); assert.deepEqual(plain(f.S.owned), before.owned);
  assert.equal(f.Rewards.confirmPurchase('premium-pass', receipt('premium-pass', { id: 'premium-charge' })).ok, true);
  assert.equal(f.S.premium, true); assert.equal(f.S.gems, before.gems + 80);
  const legacy = load(), old = plain(legacy.S);
  assert.equal(legacy.Rewards.confirmPurchase('premium-pass', receipt('premium-pass')).why, 'claimed');
  assert.deepEqual(plain(legacy.S), old); assert.equal(legacy.saves.length, 0);
});

test('catalog item purchases and currency exchanges are atomic, canonical and retry-safe', () => {
  const f = load(), coins = f.S.coins;
  assert.equal(f.Rewards.buyItem('r-coral').ok, true);
  assert.equal(f.S.coins, coins - 480); assert.ok(f.saves[0].owned.includes('r-coral'));
  assert.equal(f.saves[0].coins, coins - 480); assert.equal(f.Rewards.buyItem('r-coral').ok, false);
  assert.equal(f.Catalog.canBuy({ ...f.Catalog.byId('r-void'), price: { cur: 'gems', amt: 1 } }).ok, false);
  assert.equal(f.Rewards.buyItem('f-season').ok, false);
  const gems = f.S.gems, currentCoins = f.S.coins;
  assert.equal(f.Rewards.exchangeCoins('coins-500', 'exchange:test-1').ok, true);
  assert.equal(f.S.gems, gems - 10); assert.equal(f.S.coins, currentCoins + 500);
  assert.equal(f.Rewards.exchangeCoins('coins-500', 'exchange:test-1').why, 'claimed');
  assert.equal(f.Rewards.exchangeCoins('missing').ok, false);
  const poor = load({ raw: { coins: 0, gems: 0 } }), old = plain(poor.S);
  assert.equal(poor.Rewards.buyItem('r-coral').why, 'funds');
  assert.equal(poor.Rewards.exchangeCoins('coins-500').why, 'funds');
  assert.deepEqual(plain(poor.S), old); assert.equal(poor.saves.length, 0);
});

test('a failed durable write rolls back currency, inventory, flags and receipts', () => {
  const f = load(), before = plain(f.S);
  f.Store.save = () => { throw new Error('disk'); };
  assert.equal(f.Rewards.buyItem('r-coral').why, 'storage');
  assert.deepEqual(plain(f.S), before);
  assert.equal(f.Rewards.claimPass(4, 'p', 3).why, 'storage');
  assert.deepEqual(plain(f.S), before);
});

test('real silent storage/quota failures are detected by the persisted receipt and rolled back', () => {
  const f = load(), before = plain(f.S), saved = f.entries.get('ttu-v2');
  f.storage.setItem = () => { throw new Error('quota'); };
  assert.equal(f.Rewards.buyItem('r-coral').why, 'storage');
  assert.deepEqual(plain(f.S), before); assert.equal(f.entries.get('ttu-v2'), saved);
  assert.equal(f.Rewards.claimPass(4, 'p', 3).why, 'storage');
  assert.deepEqual(plain(f.S), before); assert.equal(f.entries.get('ttu-v2'), saved);
  assert.equal(f.Rewards.confirmPurchase('season-bundle', receipt('season-bundle')).why, 'storage');
  assert.deepEqual(plain(f.S), before); assert.equal(f.saves.length, 0);
});

test('legacy cached color cards become known itemIds without reopening a completed/newer calendar', () => {
  const pass = Array.from({ length: 20 }, (_, i) => ({ s: 5, l: i + 1, f: { k: 'coins', n: 60 }, p: { k: 'card', n: 1, col: '#FF4B3E' } }));
  const cached = { serverTimeUtc: '2026-11-11T00:00:00Z', events: [{ type: 'season', status: 'active', startsAt: '2026-11-11T00:00:00Z', endsAt: '2026-12-07T00:00:00Z', config: { season: { n: 5 }, pass } }] };
  const f = load({ now: '2026-11-15T00:00:00Z', cached, raw: { passSeason: 5, claimed: { f: [], p: [3] }, owned: ['r-teal'] } });
  assert.equal(f.season.seasonNumber(), 5);
  assert.equal(f.season.currentPass()[2].p.itemId, 'r-coral');
  assert.equal(f.Rewards.claimPass(5, 'p', 3).why, 'claimed'); assert.deepEqual(plain(f.S.owned), ['r-teal']);
  const bad = structuredClone(cached); bad.events[0].config.pass[0].p.itemId = 'missing';
  assert.equal(f.season.setServerSeason(bad), false);
  assert.equal(f.season.seasonNumber(), 5); assert.equal(f.season.currentPass()[0].p.itemId, 'r-coral');
});
