/* =====================================================================
 *  META — profile, money, shop, platform. The commercial layer.
 *
 *  Rules this file is written to, in order of importance:
 *
 *  1. NOTHING HERE MAY CHANGE WHO WINS. The shop sells different, never
 *     better (see 84_racket.js: every item spends the same stat budget),
 *     and it sells looks, convenience and reasons to come back.
 *  2. NO DARK PATTERNS. No energy, no timers that punish, no loot boxes,
 *     no ads mid-match, no "are you sure you want to stay poor". A
 *     rewarded ad is always an offer, never a toll.
 *  3. THE WEB BUILD HAS TO BE HONEST ABOUT ITSELF. Poki forbids
 *     third-party IAP entirely, so on a portal the shop hides its
 *     paid shelves and keeps ads-only. The same code runs everywhere.
 *  4. IT MUST SURVIVE A RELOAD. One versioned blob in localStorage, with
 *     a migration step, and no throwing if storage is blocked (private
 *     mode, embedded iframes on portals).
 * ===================================================================== */
'use strict';

const SAVE_KEY = 'topspin.arena.save.v1';
const SAVE_VERSION = 3;

/* Soft currency ceiling. Not a gameplay limit — a sanity limit: a save
   that arrives with 1e309 coins (or NaN, or the string "много") is a
   broken save, not a rich player. Clamping here keeps every downstream
   multiplication finite. */
const MAX_COINS = 9999999;
const MAX_CRYSTALS = 999999;
const MAX_XP = 1e9;
const MAX_ADS_PER_DAY = 5;

/** Merge an untrusted object into a fresh one, skipping the keys that can
 *  rewrite an object's prototype. `JSON.parse('{"__proto__":{"a":1}}')`
 *  produces a real own property, and a plain Object.assign would then set
 *  the prototype of the target — the prototype-pollution trick. */
function safeAssign(base, raw) {
  if (!raw || typeof raw !== 'object') return base;
  for (const k of Object.keys(raw)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    base[k] = raw[k];
  }
  return base;
}
/** A finite number in range, or the default. Strings, null, NaN and
 *  ±Infinity all land on the default instead of poisoning the wallet. */
function num(v, d, lo, hi) {
  let n = typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) n = d;
  if (lo !== undefined && n < lo) n = lo;
  if (hi !== undefined && n > hi) n = hi;
  return n;
}
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi));
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const strList = (v, ok, cap) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && ok(x)).slice(0, cap) : []);

/* ------------------------------------------------------------------ *
 *  Platform: where are we running, and what is allowed here?
 * ------------------------------------------------------------------ */
class Platform {
  constructor(nav) {
    const navi = nav || (typeof navigator !== 'undefined' ? navigator : {});
    const ua = (navi.userAgent || '').toLowerCase();
    const host = (typeof location !== 'undefined' ? location.hostname : '') || '';
    this.poki = /poki\./i.test(host) || !!navi.poki;
    this.crazy = /crazygames/i.test(host) || !!navi.CrazyGames;
    this.y8 = /y8\./i.test(host);
    this.gamedist = /gamedistribution/i.test(host);
    this.portal = this.poki || this.crazy || this.y8 || this.gamedist;
    this.itch = /itch\.io/i.test(host);
    this.touch = 'ontouchstart' in (navi && navi.maxTouchPoints ? navi : {}) || (navi.maxTouchPoints || 0) > 0;
  }

  /* Poki: ads only, no IAP at all. CrazyGames: ads + IAP through them.
     Own domain / itch: everything, and that is where the shop shows up.
     These are getters, not fields, so flipping a flag (or being detected
     later, when the portal SDK finally loads) can never leave the shop
     showing a shelf the platform forbids. */
  get canIAP() { return !this.poki && !this.y8 && !this.gamedist; }
  get canRewarded() { return true; }
  get storePct() { return this.poki ? 0.50 : this.crazy ? 0.60 : this.y8 ? 0.50 : this.gamedist ? 0.33 : 1.0; }
  get label() {
    if (this.poki) return 'POKI';
    if (this.crazy) return 'CRAZYGAMES';
    if (this.y8) return 'Y8';
    if (this.gamedist) return 'GAMEDISTRIBUTION';
    return 'ПРЯМОЙ ЗАПУСК';
  }
}

/* ------------------------------------------------------------------ *
 *  Analytics: one bus, adapters know how to talk to each portal.
 *  Deliberately tiny — the numbers we act on are D1/D7, session length,
 *  the drop-off step of the tutorial and the shop funnel.
 * ------------------------------------------------------------------ */
class Analytics {
  constructor(platform) {
    this.platform = platform;
    this.queue = [];
    this.sessionStart = Date.now();
    this.events = 0;
    this.onEvent = null;
  }
  send(name, props) {
    const e = { name, t: Date.now(), i: this.events++, props: props || {} };
    this.queue.push(e);
    if (this.queue.length > 200) this.queue.shift();
    if (this.onEvent) this.onEvent(e);
    // portal SDKs are wired here when present; nothing else leaves the page
    const n = (typeof navigator !== 'undefined') ? navigator : {};
    if (n.poki && n.poki.gameLoadingFinished && this.events === 2) { try { n.poki.gameLoadingFinished(); } catch (x) { /* ignore */ } }
    return e;
  }
  get sessionSec() { return (Date.now() - this.sessionStart) / 1000; }
  funnelStep(name) { this.send('funnel:' + name, { d: Math.round(this.sessionSec) }); }
}

/* ------------------------------------------------------------------ *
 *  Profile: everything that has to survive a reload.
 * ------------------------------------------------------------------ */
const DAILY_TASKS = [
  { id: 'win1', ru: 'ВЫИГРАЙ МАТЧ', need: 1, coins: 120 },
  { id: 'rally8', ru: 'РОЗЫГРЫШ ИЗ 8 УДАРОВ', need: 1, coins: 100 },
  { id: 'topspin', ru: '10 ТОПСПИНОВ', need: 10, coins: 90 },
  { id: 'smash', ru: '3 СМЕША', need: 3, coins: 110 },
  { id: 'serves', ru: '5 ЛЕГАЛЬНЫХ ПОДАЧ ПОДРЯД', need: 5, coins: 100 },
  { id: 'replay', ru: 'ПОСМОТРИ ЛУЧШИЙ МОМЕНТ', need: 1, coins: 80 },
];

class Profile {
  constructor(platform) {
    this.platform = platform;
    this.data = this.blank();
    this.loaded = false;
    this.dirty = false;
    this.load();
  }

  blank() {
    return {
      v: SAVE_VERSION,
      created: Date.now(),
      days: [],
      streak: 0,
      coins: 250,
      crystals: 0,
      xp: 0, level: 1,
      owned: ['b_base', 'r_base'],
      equip: { blade: 'b_base', fh: 'r_base', bh: 'r_base' },
      cosmetics: { trail: 'std', arena: 'arena', grip: 'std' },
      career: { div: 0, event: 0, points: 0, cups: 0, trophies: [], seen: 0 },
      stats: { matches: 0, wins: 0, shots: 0, rallies: 0, maxRally: 0, minutes: 0, bestSpeed: 0, bestSpin: 0, moments: 0 },
      daily: { day: '', tasks: {}, done: [], claimed: [], wheel: '' },
      season: { n: 0, xp: 0, premium: false, claimed: [] },
      ads: { watched: 0, last: 0, day: '', today: 0 },
      purchases: [],
      settings: null,
    };
  }

  load() {
    let raw = null;
    try { raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(SAVE_KEY) : null; } catch (e) { raw = null; }
    if (raw) {
      try {
        const d = JSON.parse(raw);
        const base = this.blank();
        safeAssign(base, d);
        base.stats = safeAssign(base.stats, d.stats);
        base.daily = safeAssign(base.daily, d.daily);
        base.season = safeAssign(base.season, d.season);
        base.career = safeAssign(base.career, d.career);
        base.cosmetics = safeAssign(base.cosmetics, d.cosmetics);
        base.equip = safeAssign(base.equip, d.equip);
        base.ads = safeAssign(base.ads, d.ads);
        this.data = base;
        if (!Array.isArray(this.data.owned) || !this.data.owned.length) this.data.owned = ['b_base', 'r_base'];
        this.migrate(num(d.v, 1, 1, SAVE_VERSION));
      } catch (e) { this.data = this.blank(); }
    }
    this.migrate(num(this.data.v, 1, 1, SAVE_VERSION));
    this.sanitize();
    this.loaded = true;
    this.today();
    return this.data;
  }

  migrate(from) {
    const d = this.data;
    if (from < 2) { d.equip = d.equip || { blade: 'b_base', fh: 'r_base', bh: 'r_base' }; }
    if (from < 3) {
      for (const id of ['b_base', 'r_base']) if (d.owned.indexOf(id) < 0) d.owned.push(id);
      d.cosmetics = d.cosmetics || { trail: 'std', arena: 'arena', grip: 'std' };
    }
    /* an old save may know only some of the three racket slots */
    d.equip = d.equip || {};
    d.equip.blade = d.equip.blade || 'b_base';
    d.equip.fh = d.equip.fh || 'r_base';
    d.equip.bh = d.equip.bh || d.equip.fh || 'r_base';
    d.cosmetics = d.cosmetics || { trail: 'std', arena: 'arena', grip: 'std' };
    d.v = SAVE_VERSION;
  }

  /**
   * The last line of defence between a save file and the game. Every
   * field is normalised here: numbers finite and in range, ids existing,
   * unknown items dropped, currency survivable. Called on every load, so
   * a save edited by hand, half-written by a crash, or carried over from
   * an older version can never make the game behave strangely.
   */
  sanitize() {
    const d = this.data, b = this.blank();
    d.v = SAVE_VERSION;
    d.created = int(d.created, Date.now(), 0, 4e12);
    d.coins = int(d.coins, b.coins, 0, MAX_COINS);
    d.crystals = int(d.crystals, 0, 0, MAX_CRYSTALS);
    d.xp = int(d.xp, 0, 0, MAX_XP);
    d.level = int(d.level, 1, 1, 200);
    d.streak = int(d.streak, 0, 0, 100000);
    d.days = strList(d.days, (x) => /^\d{1,4}-\d{1,2}-\d{1,2}$/.test(x), 60);
    /* inventory: only real catalogue ids, always including the starter kit */
    d.owned = strList(d.owned, (id) => !!ITEMS[id], 400);
    for (const id of ['b_base', 'r_base']) if (d.owned.indexOf(id) < 0) d.owned.push(id);
    /* equipment: right kind for the right slot, and owned */
    const pick = (id, kind, fallback) => {
      const it = ITEMS[id];
      return (it && it.kind === kind && d.owned.indexOf(id) >= 0) ? id : fallback;
    };
    if (!d.equip || typeof d.equip !== 'object') d.equip = {};
    d.equip.blade = pick(d.equip.blade, 'blade', 'b_base');
    d.equip.fh = pick(d.equip.fh, 'rubber', 'r_base');
    d.equip.bh = pick(d.equip.bh, 'rubber', d.equip.fh);
    /* cosmetics: value must exist for that category */
    if (!d.cosmetics || typeof d.cosmetics !== 'object') d.cosmetics = {};
    for (const kind of ['trail', 'arena', 'grip']) {
      const vals = COSMETICS.filter((c) => c.kind === kind).map((c) => c.val);
      if (vals.indexOf(d.cosmetics[kind]) < 0) d.cosmetics[kind] = b.cosmetics[kind];
    }
    /* stats */
    if (!d.stats || typeof d.stats !== 'object') d.stats = {};
    for (const key of Object.keys(b.stats)) d.stats[key] = num(d.stats[key], 0, 0, 1e12);
    /* daily */
    if (!d.daily || typeof d.daily !== 'object') d.daily = {};
    if (typeof d.daily.day !== 'string') d.daily.day = '';
    const taskIds = DAILY_TASKS.map((t) => t.id);
    if (!d.daily.tasks || typeof d.daily.tasks !== 'object') d.daily.tasks = {};
    for (const id of Object.keys(d.daily.tasks)) {
      if (taskIds.indexOf(id) < 0) delete d.daily.tasks[id];
      else d.daily.tasks[id] = num(d.daily.tasks[id], 0, 0, 1e9);
    }
    d.daily.done = strList(d.daily.done, (id) => taskIds.indexOf(id) >= 0, 20);
    d.daily.claimed = strList(d.daily.claimed, (id) => taskIds.indexOf(id) >= 0, 20);
    if (typeof d.daily.wheel !== 'string') d.daily.wheel = '';
    /* season */
    if (!d.season || typeof d.season !== 'object') d.season = {};
    d.season.n = int(d.season.n, 0, 0, 999);
    d.season.xp = int(d.season.xp, 0, 0, MAX_XP);
    d.season.premium = bool(d.season.premium, false);
    d.season.claimed = Array.isArray(d.season.claimed)
      ? d.season.claimed.filter((x) => Number.isInteger(x) && x >= 0 && x <= 60).slice(0, 200) : [];
    /* ads */
    if (!d.ads || typeof d.ads !== 'object') d.ads = {};
    d.ads.watched = int(d.ads.watched, 0, 0, 1e6);
    d.ads.last = int(d.ads.last, 0, 0, 4e12);
    d.ads.noadsBought = bool(d.ads.noadsBought, false);
    d.ads.day = typeof d.ads.day === 'string' ? d.ads.day : '';
    d.ads.today = int(d.ads.today, 0, 0, MAX_ADS_PER_DAY);
    /* purchases: history of what was actually paid for */
    d.purchases = Array.isArray(d.purchases)
      ? d.purchases.filter((x) => x && typeof x === 'object' && typeof x.id === 'string').slice(-200) : [];
    /* career (used by the tournament ladder) */
    if (!d.career || typeof d.career !== 'object') d.career = {};
    d.career.div = int(d.career.div, 0, 0, 99);
    d.career.event = int(d.career.event, 0, 0, 999);
    d.career.points = int(d.career.points, 0, 0, 1e9);
    d.career.cups = int(d.career.cups, 0, 0, 9999);
    d.career.seen = int(d.career.seen, 0, 0, 1e9);
    d.career.trophies = strList(d.career.trophies, () => true, 100);
    /* settings: the game applies ranges on top, but it must be an object */
    if (d.settings !== null && (typeof d.settings !== 'object' || Array.isArray(d.settings))) d.settings = null;
    return d;
  }

  save(force) {
    if (!this.dirty && !force) return true;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let ok = true;
    try {
      if (typeof localStorage !== 'undefined') { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); }
      this.dirty = false;
    } catch (e) { ok = false; }        // private mode: the game still plays
    /* A localStorage write is synchronous disk I/O and can stall a frame; when
     * ?diag=1 is on, the report gets the ones that actually took time. */
    if (t0 && typeof window !== 'undefined' && window.__diag) {
      const ms = performance.now() - t0;
      if (ms > 0.4) window.__diag.events.push({
        t: Math.round(performance.now() - window.__diag.t0), k: 'save', ms: +ms.toFixed(1) });
    }
    return ok;
  }

  touch() { this.dirty = true; if (this._sv === undefined) this._sv = 0; }
  maybeSave(dt) {                      // cheap: write at most every 4 s
    if (!this.dirty) return;
    this._sv = (this._sv || 0) + dt;
    if (this._sv > 4) { this._sv = 0; this.save(); }
  }

  /* ------------------------------ time --------------------------- */
  dayKey(t) {
    const d = new Date(t || Date.now());
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  today() {
    const k = this.dayKey();
    const d = this.data.daily;
    if (d.day !== k) {
      const y = this.dayKey(Date.now() - 86400000);
      this.data.streak = (d.day === y) ? (this.data.streak + 1) : 1;
      d.day = k; d.tasks = {}; d.done = []; d.claimed = [];
      this.touch();
    }
    this.data.days = this.data.days || [];
    if (this.data.days.indexOf(k) < 0) { this.data.days.push(k); if (this.data.days.length > 60) this.data.days.shift(); }
    return this.data.streak;
  }

  /* ------------------------------ money -------------------------- */
  addCoins(n, why) {
    if (!Number.isFinite(n)) n = 0;                     // NaN from a broken reward table
    if (!Number.isFinite(this.data.coins)) this.data.coins = 0;
    this.data.coins = clamp(Math.round(this.data.coins + n), 0, MAX_COINS);
    this.touch();
    if (this.onCoins) this.onCoins(n, why);
    return this.data.coins;
  }
  spend(coins, crystals) {
    const d = this.data;
    const c = num(coins, 0, 0, MAX_COINS), k = num(crystals, 0, 0, MAX_CRYSTALS);
    if (!Number.isFinite(d.coins) || !Number.isFinite(d.crystals)) this.sanitize();
    if (d.coins < c || d.crystals < k) return false;
    d.coins -= c; d.crystals -= k;
    this.touch();
    return true;
  }
  addXP(n) {
    const d = this.data;
    if (!Number.isFinite(n) || n < 0) n = 0;
    d.xp = clamp(d.xp + n, 0, MAX_XP);
    const need = (lv) => 400 + lv * 260;
    while (d.xp >= need(d.level)) { d.xp -= need(d.level); d.level++; if (this.onLevel) this.onLevel(d.level); }
    this.touch();
    return d.level;
  }
  xpToNext() { return 400 + this.data.level * 260; }

  /* ---------------------------- inventory ------------------------ */
  owns(id) { return this.data.owned.indexOf(id) >= 0; }
  buy(id, price, currency) {
    if (this.owns(id) || !ITEMS[id]) return false;
    if (!Number.isFinite(price) || price < 0) return false;
    const ok = currency === 'crystals' ? this.spend(0, price) : this.spend(price, 0);
    if (!ok) return false;
    this.data.owned.push(id);
    this.data.purchases.push({ id, price, currency, t: Date.now() });
    this.touch(); this.save(true);
    return true;
  }
  equipRacket(blade, fh, bh) {
    /* A rubber is not a blade and a blade is not a rubber: the equipment
       maths reads different fields for the two, so a slot filled with the
       wrong kind of item would quietly produce a nonsense racket. */
    const okKind = (id, kind) => { const it = ITEMS[id]; return !!it && it.kind === kind && this.owns(id); };
    if (!okKind(blade, 'blade') || !okKind(fh, 'rubber') || !okKind(bh, 'rubber')) return false;
    this.data.equip = { blade, fh, bh };
    this.touch(); this.save(true);
    return true;
  }

  /* ------------------------------- daily ------------------------- */
  taskProgress(id, add, absolute) {
    const d = this.data.daily;
    const t = DAILY_TASKS.find((x) => x.id === id);
    if (!t || d.claimed.indexOf(id) >= 0) return;
    const cur = absolute !== undefined ? absolute : (d.tasks[id] || 0) + add;
    d.tasks[id] = cur;
    if (cur >= t.need && d.done.indexOf(id) < 0) { d.done.push(id); this.touch(); }
    this.touch();
  }
  claimTask(id) {
    const d = this.data.daily;
    const t = DAILY_TASKS.find((x) => x.id === id);
    if (!t || d.done.indexOf(id) < 0 || d.claimed.indexOf(id) >= 0) return 0;
    d.claimed.push(id);
    const bonus = this.data.streak >= 7 ? 1.5 : this.data.streak >= 3 ? 1.25 : 1;
    const coins = Math.round(t.coins * bonus);
    this.addCoins(coins, 'task:' + id);
    this.save(true);
    return coins;
  }
  get dailyDone() { return this.data.daily.done.length; }

  /* ------------------------------ season ------------------------- */
  seasonLevel() { return Math.min(60, 1 + Math.floor(this.data.season.xp / 250)); }
  seasonProgress() { return clamp((this.data.season.xp % 250) / 250, 0, 1); }
  addSeasonXP(n) {
    const s = this.data.season;
    if (!Number.isFinite(n) || n < 0) n = 0;
    const before = this.seasonLevel();
    s.xp += n;
    this.touch();
    return this.seasonLevel() - before;      // how many levels just landed
  }

  /* ------------------------- match outcomes ---------------------- */
  onMatchEnd(won, score, stats, moments) {
    const d = this.data, s = d.stats;
    const coins = won ? 30 : 8;
    const xp = won ? 120 : 45;
    s.matches++; if (won) s.wins++;
    s.shots += stats.shots || 0;
    s.rallies += stats.rallies || 0;
    s.maxRally = Math.max(s.maxRally, stats.bestRally || 0);
    s.bestSpeed = Math.max(s.bestSpeed, stats.maxSpeed || 0);
    s.bestSpin = Math.max(s.bestSpin, stats.maxSpin || 0);
    s.moments += moments || 0;
    const lv = this.addXP(xp);
    const se = this.addSeasonXP(xp);
    this.addCoins(coins, 'match');
    if (won) this.taskProgress('win1', 1);
    this.touch(); this.save(true);
    return { coins, xp, level: lv, seasonLevels: se };
  }
}

/* ------------------------------------------------------------------ *
 *  Shop: what is for sale, at what price, and on which platform.
 *  Prices are in soft coins (earned by playing) or crystals (bought),
 *  and cosmetics are the only thing crystals can buy.
 * ------------------------------------------------------------------ */
const COSMETICS = [
  { id: 'trail_std', kind: 'trail', ru: 'СЛЕД · СТАНДАРТ', price: 0, cur: 'coins', val: 'std' },
  { id: 'trail_gold', kind: 'trail', ru: 'СЛЕД · ЗОЛОТО', price: 240, cur: 'crystals', val: 'gold' },
  { id: 'trail_ice', kind: 'trail', ru: 'СЛЕД · ЛЁД', price: 180, cur: 'crystals', val: 'ice' },
  { id: 'arena_club', kind: 'arena', ru: 'АРЕНА · КЛУБ', price: 0, cur: 'coins', val: 'arena' },
  { id: 'arena_world', kind: 'arena', ru: 'АРЕНА · АРЕНА МИРА', price: 1, cur: 'career', val: 'world' },
  { id: 'grip_red', kind: 'grip', ru: 'НАКЛАДКА РУЧКИ · АЛЫЙ', price: 120, cur: 'crystals', val: 'red' },
];

const SHOP_BUNDLES = [
  { id: 'starter', ru: 'СТАРТОВЫЙ НАБОР', crystals: 300, coins: 1500, price: '2.99', cur: 'eur', once: true,
    note: 'основание LOOPER + 300 кристаллов' },
  { id: 'crystals_120', ru: '120 КРИСТАЛЛОВ', crystals: 120, price: '1.19', cur: 'eur' },
  { id: 'crystals_650', ru: '650 КРИСТАЛЛОВ', crystals: 650, price: '4.99', cur: 'eur', best: true },
  { id: 'crystals_1500', ru: '1500 КРИСТАЛЛОВ', crystals: 1500, price: '9.99', cur: 'eur' },
  { id: 'pass', ru: 'СЕЗОННЫЙ ПРОПУСК', pass: true, price: '4.99', cur: 'eur',
    note: '60 уровней, скины, арены, 400 кристаллов' },
  { id: 'noads', ru: 'БЕЗ РЕКЛАМЫ НАВСЕГДА', noads: true, price: '3.99', cur: 'eur' },
];

class Shop {
  constructor(profile, platform, analytics) {
    this.p = profile; this.platform = platform; this.an = analytics;
    this.log = [];
  }

  /** Racket items, priced in coins so that playing unlocks everything. */
  racketOffers() {
    const out = [];
    for (const id in ITEMS) {
      const it = ITEMS[id];
      if (it.kind !== 'blade' && it.kind !== 'rubber') continue;
      out.push({
        id, item: it, kind: it.kind, ru: it.ru, name: it.name,
        price: it.price, crystals: it.crystals, cur: 'coins', owned: this.p.owns(id),
        tier: it.tier, star: !!it.star,
      });
    }
    return out;
  }

  cosmeticOffers() {
    return COSMETICS.map((c) => ({
      ...c, owned: this.p.data.cosmetics[c.kind] === c.val || (c.cur === 'coins' && c.price === 0),
    }));
  }

  /** Only shown when the platform allows real money (not on Poki/Y8). */
  iapOffers() {
    if (!this.platform.canIAP) return [];
    return SHOP_BUNDLES.map((b) => ({ ...b, owned: this.p.data.purchases.some((x) => x.id === b.id) }));
  }

  /**
   * Two ways to own a racket: play for it (coins) or pay for it
   * (crystals, which come from the store). Both are recorded, and the
   * cheap items stay coin-only so the whole game can be finished for
   * free — paying buys time, never power.
   */
  buyRacket(id, cur) {
    const it = ITEMS[id];
    if (!it) return false;
    const currency = cur === 'crystals' ? 'crystals' : 'coins';
    const price = currency === 'crystals' ? it.crystals : it.price;
    if (!Number.isFinite(price) || price <= 0) return false;
    if (!this.p.buy(id, price, currency)) return false;
    this.an && this.an.send('shop:buy', { id, cur: currency, price });
    this.log.push({ id, cur: currency, t: Date.now() });
    return true;
  }

  buyCosmetic(id) {
    const c = COSMETICS.find((x) => x.id === id);
    if (!c) return false;
    if (c.cur === 'career') return false;                 // earned, never sold
    if (this.p.data.cosmetics[c.kind] === c.val) return false;    // already worn: never charge twice
    if (c.cur === 'crystals') {
      if (!this.p.spend(0, c.price)) return false;
    } else if (c.cur === 'coins' && c.price > 0) {
      if (!this.p.spend(c.price, 0)) return false;
    }
    this.p.data.cosmetics[c.kind] = c.val;
    this.p.touch(); this.p.save(true);
    this.an && this.an.send('shop:buy', { id, cur: c.cur, price: c.price });
    return true;
  }

  /**
   * Real-money purchase. The actual store call belongs to the wrapper
   * (Capacitor / portal SDK); this is the entitlement side, which is the
   * part that must be right: grant once, record it, never refund silently.
   */
  grant(bundleId, receipt) {
    const b = SHOP_BUNDLES.find((x) => x.id === bundleId);
    if (!b) return false;
    const d = this.p.data;
    /* The store will happily call us twice (retry, double tap, a restored
       purchase after reinstall). The receipt is what makes it idempotent:
       one receipt, one grant — otherwise a single payment pays out twice. */
    const tag = typeof receipt === 'string' && receipt ? receipt : null;
    if (tag && d.purchases.some((x) => x.receipt === tag)) return false;
    if (b.once && d.purchases.some((x) => x.id === bundleId)) return false;
    d.purchases.push({ id: bundleId, t: Date.now(), receipt: tag || 'local:' + Date.now() });
    if (b.crystals) d.crystals += b.crystals;
    if (b.coins) d.coins += b.coins;
    if (b.pass) d.season.premium = true;
    if (b.noads) d.ads.noadsBought = true;
    if (bundleId === 'starter') { if (!this.p.owns('b_loop')) d.owned.push('b_loop'); }
    this.p.touch(); this.p.save(true);
    this.an && this.an.send('iap:grant', { id: bundleId, eur: b.price });
    return true;
  }

  /**
   * Rewarded video. The offer must be concrete and the answer must be
   * "no thanks" — a rewarded ad with no refusal is a toll booth.
   */
  /** How many rewarded ads are left today (the UI must be able to say). */
  get adsLeft() {
    const a = this.p.data.ads;
    if (a.noadsBought) return 0;
    if (a.day !== this.p.dayKey(Date.now())) return MAX_ADS_PER_DAY;
    return Math.max(0, MAX_ADS_PER_DAY - (a.today || 0));
  }

  rewardAd(kind) {
    const p = this.p, a = p.data.ads;
    if (a.noadsBought) return { ok: false, why: 'no-ads' };
    const now = Date.now();
    /* The daily budget is the real brake. Without it a player farms 120
       coins every 45 seconds — more than playing pays — and every price
       in the shop stops meaning anything. */
    const day = p.dayKey(now);
    if (a.day !== day) { a.day = day; a.today = 0; }
    if (a.today >= MAX_ADS_PER_DAY) return { ok: false, why: 'daily', left: 0, cap: MAX_ADS_PER_DAY };
    if (now - (a.last || 0) < 45000) return { ok: false, why: 'cooldown', left: Math.ceil((45000 - (now - a.last)) / 1000) };
    const table = {
      coins2x: { coins: 120, ru: '×2 монеты за матч' },
      secondChance: { coins: 0, ru: 'второй шанс в турнире' },
      dailyWheel: { coins: 120, ru: 'колесо дня' },
    };
    const offer = table[kind] || table.coins2x;
    a.last = now;
    a.watched++;
    a.today++;
    if (offer.coins) p.addCoins(offer.coins, 'ad:' + kind);
    p.touch(); p.save(true);
    this.an && this.an.send('ad:rewarded', { kind, coins: offer.coins, left: MAX_ADS_PER_DAY - a.today });
    return { ok: true, coins: offer.coins, offer, left: MAX_ADS_PER_DAY - a.today };
  }
}

/* ------------------------------------------------------------------ *
 *  Economy tuning, in one place so it can be argued with.
 * ------------------------------------------------------------------ */
const ECONOMY = {
  matchWin: 30, matchLoss: 8, tournamentWin: 250, dailyTask: '90–120',
  level: 120, season: 250,
  note: 'Сессия 12 минут ≈ 2 матча ≈ 70 монет + 1–2 задания. Скин ракетки 900 —'
      + ' это примерно 8 игровых сессий, или один вечер с двумя рекламными удвоениями.',
};
