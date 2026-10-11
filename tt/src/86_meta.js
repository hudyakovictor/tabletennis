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
      ads: { watched: 0, last: 0 },
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
        this.data = Object.assign(base, d);
        this.data.stats = Object.assign(base.stats, d.stats || {});
        this.data.daily = Object.assign(base.daily, d.daily || {});
        this.data.season = Object.assign(base.season, d.season || {});
        this.data.career = Object.assign(base.career, d.career || {});
        this.data.cosmetics = Object.assign(base.cosmetics, d.cosmetics || {});
        if (!Array.isArray(this.data.owned) || !this.data.owned.length) this.data.owned = ['b_base', 'r_base'];
        this.migrate(d.v || 1);
      } catch (e) { this.data = this.blank(); }
    }
    this.migrate(this.data.v);
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

  save(force) {
    if (!this.dirty && !force) return true;
    try {
      if (typeof localStorage !== 'undefined') { localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); }
      this.dirty = false;
      return true;
    } catch (e) { return false; }        // private mode: the game still plays
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
    this.data.coins = Math.max(0, Math.round(this.data.coins + n));
    this.touch();
    if (this.onCoins) this.onCoins(n, why);
    return this.data.coins;
  }
  spend(coins, crystals) {
    const d = this.data;
    if (d.coins < (coins || 0) || d.crystals < (crystals || 0)) return false;
    d.coins -= coins || 0; d.crystals -= crystals || 0;
    this.touch();
    return true;
  }
  addXP(n) {
    const d = this.data;
    d.xp += n;
    const need = (lv) => 400 + lv * 260;
    while (d.xp >= need(d.level)) { d.xp -= need(d.level); d.level++; if (this.onLevel) this.onLevel(d.level); }
    this.touch();
    return d.level;
  }
  xpToNext() { return 400 + this.data.level * 260; }

  /* ---------------------------- inventory ------------------------ */
  owns(id) { return this.data.owned.indexOf(id) >= 0; }
  buy(id, price, currency) {
    if (this.owns(id)) return false;
    const ok = currency === 'crystals' ? this.spend(0, price) : this.spend(price, 0);
    if (!ok) return false;
    this.data.owned.push(id);
    this.data.purchases.push({ id, price, currency, t: Date.now() });
    this.touch(); this.save(true);
    return true;
  }
  equipRacket(blade, fh, bh) {
    for (const id of [blade, fh, bh]) if (id && !this.owns(id)) return false;
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
        price: it.price, cur: 'coins', owned: this.p.owns(id), tier: it.tier, star: !!it.star,
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

  buyRacket(id) {
    const it = ITEMS[id];
    if (!it || it.price === undefined) return false;
    if (!this.p.buy(id, it.price, 'coins')) return false;
    this.an && this.an.send('shop:buy', { id, cur: 'coins', price: it.price });
    this.log.push({ id, t: Date.now() });
    return true;
  }

  buyCosmetic(id) {
    const c = COSMETICS.find((x) => x.id === id);
    if (!c) return false;
    if (c.cur === 'career') return false;                 // earned, never sold
    if (c.cur === 'crystals') {
      if (!this.p.spend(0, c.price)) return false;
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
    if (b.once && d.purchases.some((x) => x.id === bundleId)) return false;
    d.purchases.push({ id: bundleId, t: Date.now(), receipt: receipt ? 'ok' : 'none' });
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
  rewardAd(kind) {
    const p = this.p;
    if (p.data.ads.noadsBought) return { ok: false, why: 'no-ads' };
    const now = Date.now();
    if (now - (p.data.ads.last || 0) < 45000) return { ok: false, why: 'cooldown', left: Math.ceil((45000 - (now - p.data.ads.last)) / 1000) };
    const table = {
      coins2x: { coins: 120, ru: '×2 монеты за матч' },
      secondChance: { coins: 0, ru: 'второй шанс в турнире' },
      dailyWheel: { coins: 120, ru: 'колесо дня' },
    };
    const offer = table[kind] || table.coins2x;
    p.data.ads.last = now;
    p.data.ads.watched++;
    if (offer.coins) p.addCoins(offer.coins, 'ad:' + kind);
    p.touch(); p.save(true);
    this.an && this.an.send('ad:rewarded', { kind, coins: offer.coins });
    return { ok: true, coins: offer.coins, offer };
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
