/* =====================================================================
   CATALOG — единый реестр товаров маркетплейса (схема v2).
   Товар: { id, nk (ключ названия), kind, r (редкость), price:{cur,amt}|null,
           col, st:[скорость,вращение,контроль], tagk?, from?, to? }.
   from/to — окно доступности (unix ms); null = всегда в продаже. Бандлы —
   отдельные записи kind:'bundle' с полем items:[id…]. Экраны НЕ ходят в
   SHOP напрямую: витрину даёт Catalog.shop(), покупку проверяет
   Catalog.canBuy() — сюда же завтра встанут серверные цены и акции.
   ===================================================================== */
const SHOP = [
  { id: 'r-coral', nk: 'item.r-coral', kind: 'rubber', r: 'epic', price: { cur: 'coins', amt: 480 }, col: '#FF4B3E', st: [78, 92, 64], tagk: 'shop.tagHit' },
  { id: 'r-void', nk: 'item.r-void', kind: 'rubber', r: 'leg', price: { cur: 'gems', amt: 240 }, col: '#9F6BFF', st: [95, 88, 72], tagk: 'shop.tagNew' },
  { id: 'r-teal', nk: 'item.r-teal', kind: 'rubber', r: 'rare', price: { cur: 'coins', amt: 520 }, col: '#14C8B4', st: [66, 70, 92] },
  { id: 't-gold', nk: 'item.t-gold', kind: 'trail', r: 'leg', price: { cur: 'gems', amt: 160 }, col: '#FFC93A', st: [0, 0, 0] },
  { id: 'tb-neon', nk: 'item.tb-neon', kind: 'table', r: 'epic', price: { cur: 'gems', amt: 90 }, col: '#2EE6FF', st: [0, 0, 0] },
  { id: 'b-ink', nk: 'item.b-ink', kind: 'blade', r: 'rare', price: { cur: 'coins', amt: 720 }, col: '#3A4390', st: [72, 60, 80] },
  { id: 'season-bundle', nk: 'shop.seasonBundle', kind: 'bundle', r: 'leg', price: { cur: 'stars', amt: 349 }, items: ['r-coral', 'f-season'], gems: 80, once: true }
];
/* Предметы вне витрины: начальный набор и дроп. Без этого реестра профиль
   показывал в слоте «След мяча» чужую накладку (fallback на SHOP[0]). */
const BONUS_ITEMS = [
  { id: 't-coral', nk: 'item.t-coral', kind: 'trail', r: 'rare', price: null, col: '#FF7A4D', st: [0, 0, 0] },
  { id: 'f-season', nk: 'shop.frame', kind: 'frame', r: 'epic', price: null, col: '#FFC93A', st: [0, 0, 0] }
];
const ALL_ITEMS = SHOP.concat(BONUS_ITEMS);
const STAR_PACKS = [{ id: 'gems-80', g: 80, s: 49 }, { id: 'gems-500', g: 500, s: 249, best: 1 }, { id: 'gems-1200', g: 1200, s: 499 }];
const COIN_PACKS = [{ id: 'coins-500', c: 500, g: 10 }, { id: 'coins-1400', c: 1400, g: 25 }, { id: 'coins-3200', c: 3200, g: 50 }];
const Catalog = {
  byId(id) { return ALL_ITEMS.find((x) => x.id === id) || null; },
  rewardItem(reward) {
    if (!reward || reward.k !== 'card' || reward.n !== 1) return null;
    // Cached/server calendars shipped color-only rubber rewards before itemId.
    const it = reward.itemId !== undefined ? this.byId(reward.itemId) : ALL_ITEMS.find((x) => x.kind === 'rubber' && typeof reward.col === 'string' && x.col.toLowerCase() === reward.col.toLowerCase());
    return it && it.kind !== 'bundle' ? it : null;
  },
  starPacks() { return STAR_PACKS; },
  coinPacks() { return COIN_PACKS; },
  starOffer(id) {
    const bundle = this.bundles().find((x) => x.id === id && x.price.cur === 'stars'); if (bundle) return bundle;
    const pack = STAR_PACKS.find((x) => x.id === id); if (pack) return { id, price: { cur: 'stars', amt: pack.s }, gems: pack.g };
    return id === 'premium-pass' ? { id, price: { cur: 'stars', amt: 349 }, premium: true, once: true } : null;
  },
  /* витрина на момент now: окно доступности + не бандлы (их показывают отдельно) */
  shop(now = Date.now()) {
    return SHOP.filter((it) => it.kind !== 'bundle' && (!it.from || now >= it.from) && (!it.to || now <= it.to));
  },
  bundles(now = Date.now()) {
    return SHOP.filter((it) => it.kind === 'bundle' && (!it.from || now >= it.from) && (!it.to || now <= it.to));
  },
  canBuy(it, state = S) {
    if (!it || this.byId(it.id) !== it || !it.price || !this.shop().includes(it) || !['coins', 'gems'].includes(it.price.cur) || !Number.isSafeInteger(it.price.amt) || it.price.amt <= 0) return { ok: false, why: 'unavailable' };
    if (state.owned.includes(it.id)) return { ok: false, why: 'owned' };
    if (state[it.price.cur] < it.price.amt) return { ok: false, why: 'funds' };
    return { ok: true };
  }
};
const itemName = (it) => (it ? t(it.nk) : '');
const kindName = (it) => { const kind = typeof it === 'string' ? it : it.kind; return t(kind === 'frame' ? 'shop.frame' : 'kind.' + kind); };
const rarityName = (r) => t('rarity.' + (r || 'common'));
const priceTag = (it) => (it && it.price ? `${it.price.cur === 'stars' ? Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' }) : it.price.cur === 'gems' ? Art.gem(18) : Art.coin(18)}<b class="num">${fmt(it.price.amt)}</b>` : '');
