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
  { id: 'r-pan', nk: 'item.r-pan', kind: 'racket', r: 'leg', price: { cur: 'gems', amt: 500 }, col: '#3A3A3A', st: [80, 60, 50], tagk: 'shop.tagNew' }
];
/* Предметы вне витрины: бесплатная стандартная ракетка (скрыта из покупки). */
const BONUS_ITEMS = [
  { id: 'r-standard', nk: 'item.r-standard', kind: 'racket', r: 'common', price: null, col: '#8B7355', st: [70, 70, 70] }
];
const ALL_ITEMS = SHOP.concat(BONUS_ITEMS);
const STAR_PACKS = [{ id: 'gems-80', g: 80, s: 49 }, { id: 'gems-500', g: 500, s: 249, best: 1 }, { id: 'gems-1200', g: 1200, s: 499 }];
const COIN_PACKS = [{ id: 'coins-500', c: 500, g: 10 }, { id: 'coins-1400', c: 1400, g: 25 }, { id: 'coins-3200', c: 3200, g: 50 }];
const Catalog = {
  byId(id) { return ALL_ITEMS.find((x) => x.id === id) || null; },
  rewardItem(reward) {
    if (!reward || reward.k !== 'card' || reward.n !== 1) return null;
    const it = reward.itemId !== undefined ? this.byId(reward.itemId) : ALL_ITEMS.find((x) => x.kind === 'racket' && typeof reward.col === 'string' && x.col.toLowerCase() === reward.col.toLowerCase());
    return it && it.kind !== 'bundle' ? it : null;
  },
  starPacks() { return STAR_PACKS; },
  coinPacks() { return COIN_PACKS; },
  starOffer(id) {
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
