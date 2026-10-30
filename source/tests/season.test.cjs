const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (name) => fs.readFileSync(path.join(__dirname, '../src/', name), 'utf8');
const t = (k, vars) => (vars ? k + ':' + Object.keys(vars).map((x) => x + '=' + vars[x]).join(',') : k);
const DAY = 864e5, HOUR = 36e5;
const at = (iso) => Date.parse(iso);
const plain = (value) => JSON.parse(JSON.stringify(value));
const event = (n, start, end) => ({
  id: 'season_' + n, type: 'season', title: 'Opaque public title', status: 'scheduled',
  startsAt: start, endsAt: end,
  config: {
    season: { n, days: 999 },
    pass: Array.from({ length: 20 }, (_, i) => ({ s: n, l: i + 1, f: { k: 'coins', n: 900 + i }, p: { k: 'gems', n: 10 + i } })),
  },
});
const s4 = () => event(4, '2026-10-15T00:00:00Z', '2026-11-10T00:00:00Z');
const s5 = () => event(5, '2026-11-11T00:00:00Z', '2026-12-07T00:00:00Z');
const calendar = (events, time = '2026-10-20T06:30:00Z') => ({ events, serverTimeUtc: time });

function load({ now = '2026-10-20T06:30:00Z', raw = null, cached = null, response = null } = {}) {
  let time = at(now), nextTimer = 0;
  class Clock extends Date { static now() { return time; } }
  const entries = new Map(), saves = [], timers = new Map(), listeners = new Map();
  if (raw) entries.set('ttu-v2', JSON.stringify(raw));
  if (cached) entries.set('ttu-seasons', JSON.stringify(cached));
  const on = (target) => (name, fn) => {
    const key = target + ':' + name;
    listeners.set(key, [...(listeners.get(key) || []), fn]);
  };
  const counts = { requests: 0, logins: 0, repaints: 0, dots: 0 };
  const document = { visibilityState: 'visible', addEventListener: on('document'), querySelector: () => null };
  const Api = { enabled: true, liveops: async () => { counts.requests++; return response; }, login: async () => { counts.logins++; return null; } };
  const context = vm.createContext({
    t, Date: Clock, structuredClone, document, window: { addEventListener: on('window') }, Api,
    localStorage: {
      getItem: (k) => entries.get(k) ?? null,
      setItem: (k, v) => { entries.set(k, v); if (k === 'ttu-v2') saves.push(JSON.parse(v)); },
      removeItem: (k) => entries.delete(k),
    },
    setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    Nav: { dots: () => counts.dots++ }, Router: { cur: 'pass', repaint: () => counts.repaints++ },
  });
  vm.runInContext([read('core/state.js'), read('data/season.js'), read('services/progress.js'),
    'globalThis.fixture = { S, Progress, season: globalThis.TTSeason };'].join('\n'), context);
  return {
    ...context.fixture, entries, saves, timers, counts, listeners, document, Api,
    clock: (iso) => { time = at(iso); }, response: (value) => { response = value; },
    emit: (target, name) => (listeners.get(target + ':' + name) || []).forEach((fn) => fn()),
  };
}

test('хардкодный сезон 4: старт 15.10.2026, длина 26 дней', () => {
  const { season } = load();
  assert.equal(season.HARD_SEASON.n, 4);
  assert.equal(season.HARD_SEASON.days, 26);
  assert.equal(season.HARD_SEASON.start, Date.UTC(2026, 9, 15));
  assert.equal(season.seasonEnd(), Date.UTC(2026, 10, 10));
});

test('в первый день остаётся весь сезон, и он не завершён', () => {
  const { season } = load();
  const now = at('2026-10-15T00:00:00Z');
  assert.equal(season.seasonLeft(now), 26 * DAY);
  assert.equal(season.seasonOver(now), false);
  assert.equal(season.seasonLeftText(now), 'season.dh:d=26,h=0');
  assert.equal(season.seasonLeftShort(now), 'season.dShort:d=26');
});

test('середина сезона считается в днях и часах', () => {
  const { season } = load();
  const now = at('2026-10-20T06:30:00Z');
  assert.equal(season.seasonLeft(now), 20 * DAY + 17 * HOUR + 30 * 60000);
  assert.equal(season.seasonLeftText(now), 'season.dh:d=20,h=17');
  assert.equal(season.seasonLeftShort(now), 'season.dShort:d=20');
});

test('последние часы — уже часы и минуты, а не «0д 3ч»', () => {
  const { season } = load();
  const now = at('2026-11-09T21:15:00Z');
  assert.equal(season.seasonLeft(now), 2 * HOUR + 45 * 60000);
  assert.equal(season.seasonLeftText(now), 'season.hm:h=2,m=45');
  assert.equal(season.seasonLeftShort(now), 'season.hShort:h=2');
});

test('последняя минута не показывает «0ч 0м»', () => {
  const { season } = load();
  const now = season.seasonEnd() - 30 * 1000;
  assert.equal(season.seasonLeftText(now), 'season.hm:h=0,m=1');
  assert.equal(season.seasonLeftShort(now), 'season.hShort:h=1');
});

test('финиш: остаток ноль, оба экрана говорят «завершён»', () => {
  const { season } = load();
  const now = season.seasonEnd();
  assert.equal(season.seasonLeft(now), 0);
  assert.equal(season.seasonOver(now), true);
  assert.equal(season.seasonLeftText(now), 'season.over');
  assert.equal(season.seasonLeftShort(now), 'season.overShort');
});

test('после финиша остаток не уходит в минус', () => {
  const { season } = load();
  const now = season.seasonEnd() + 40 * DAY;
  assert.equal(season.seasonLeft(now), 0);
  assert.equal(season.seasonOver(now), true);
  assert.equal(season.seasonLeftText(now), 'season.over');
});

test('сетка наград хардкода — 20 уровней, сезон 4', () => {
  const { season } = load();
  assert.equal(season.currentPass().length, 20);
  assert.equal(season.currentPass()[0].s, 4);
  assert.equal(season.currentPass()[0].l, 1);
});

test('server endsAt and pass rewards override fallback dates and formulas', () => {
  const { season } = load();
  const e = s4(); e.endsAt = '2026-11-08T00:00:00Z';
  assert.equal(season.setServerSeason(calendar([e])), true);
  assert.equal(season.seasonEnd(), at(e.endsAt));
  assert.equal(season.currentSeason().days, 24, 'ignore contradictory config.days');
  assert.equal(season.currentPass()[0].f.n, 900, 'use server reward, not local 60 coins');
  assert.equal(season.seasonOver(at(e.endsAt)), true, 'end is exclusive');
  assert.equal(season.seasonNumber(at(e.endsAt) + DAY), 4, 'retain the completed server season');
});

test('cached upcoming seasons activate at their start, not during the gap', () => {
  const f = load({ cached: calendar([s4(), s5()]) });
  f.clock('2026-11-10T00:00:00Z');
  assert.equal(f.season.seasonNumber(), 4);
  assert.equal(f.season.seasonOver(), true);
  assert.equal(f.season.nextSeasonBoundary(), at('2026-11-11T00:00:00Z'));
  f.clock('2026-11-11T00:00:00Z');
  assert.equal(f.season.seasonNumber(), 5);
  assert.equal(f.season.seasonOver(), false);
  assert.equal(f.season.currentPass()[0].s, 5);
  f.clock('2026-12-07T00:00:00Z');
  assert.equal(f.season.seasonNumber(), 5);
  assert.equal(f.season.seasonLeft(), 0);
  assert.equal(f.season.seasonOver(), true);
});

test('roadmap titles, tournaments and cancelled events are not seasons', () => {
  const f = load({ now: '2026-11-15T00:00:00Z' });
  const legacy = { ...s4(), title: 'Season 999', config: {} };
  const tournament = { ...s4(), type: 'tournament' };
  const cancelled = { ...s4(), status: 'cancelled' };
  f.season.setServerSeason(calendar([legacy, tournament, cancelled, s5()]));
  assert.equal(f.season.seasonNumber(), 5);
  assert.equal(f.season.rolloverNeeded(4), true);
  assert.equal(f.season.rolloverNeeded(5), false);
  assert.equal(f.season.rolloverNeeded(6), false);
  assert.equal(f.season.rolloverNeeded(null), false);
});

test('invalid or older responses do not discard a validated calendar', () => {
  const { season } = load({ cached: calendar([s4()]) });
  for (const bad of [null, {}, calendar([{ ...s4(), startsAt: 'invalid' }]),
    calendar([{ ...s4(), endsAt: s4().startsAt }]), calendar([s4()], '2026-10-19T00:00:00Z')]) {
    assert.equal(season.setServerSeason(bad), false);
    assert.equal(season.currentPass()[0].f.n, 900);
  }
  const negative = s4(); negative.config.pass[0].f.n = -1;
  assert.equal(season.setServerSeason(calendar([negative])), false);
  assert.equal(season.currentPass()[0].f.n, 900);
});

test('authoritative empty calendar closes the pass rather than reopening fallback', () => {
  const f = load();
  assert.equal(f.season.setServerSeason(calendar([])), true);
  assert.equal(f.season.seasonOver(), true);
  assert.equal(f.season.seasonLeft(), 0);
  assert.equal(f.season.rolloverNeeded(3), false);
});

test('rollover resets only seasonal progress, premium and claims, once', async () => {
  const raw = { v: 6, passSeason: 4, passLvl: 7, passXp: 60, premium: true, claimed: { f: [1, 2], p: [1] },
    coins: 12345, gems: 678, level: 12, xp: 456, rating: 1321, wins: 8, losses: 3, owned: ['r-teal'], chests: [{ id: 'earned', kind: 'silver', state: 'ready' }], hist: [{ t: 1, r: 1000 }] };
  const f = load({ now: '2026-11-15T00:00:00Z', raw, response: calendar([s4(), s5()]) });
  await f.Progress.applySeasonRollover();
  assert.equal(f.S.passSeason, 5);
  assert.equal(f.S.passLvl, 0); assert.equal(f.S.passXp, 0); assert.equal(f.S.premium, false);
  assert.deepEqual(plain(f.S.claimed), { f: [], p: [] });
  for (const key of ['coins', 'gems', 'level', 'xp', 'rating', 'wins', 'losses', 'owned', 'chests', 'hist']) assert.deepEqual(plain(f.S[key]), raw[key], key);
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].passSeason, 5);
  f.S.passLvl = 2; f.S.passXp = 30; f.S.premium = true; f.S.claimed.f.push(1);
  await f.Progress.applySeasonRollover();
  assert.equal(f.S.passLvl, 2); assert.equal(f.S.passXp, 30); assert.equal(f.S.premium, true);
  assert.deepEqual(plain(f.S.claimed.f), [1]);
  assert.equal(f.saves.length, 1, 'same response does not reset or save twice');
});

test('offline reload keeps the server season and earned progress', async () => {
  const f = load({ now: '2026-12-08T00:00:00Z', cached: calendar([s4(), s5()]),
    raw: { v: 6, passSeason: 5, passLvl: 9, passXp: 20, premium: true, claimed: { f: [1], p: [] } } });
  f.Api.enabled = false;
  await f.Progress.applySeasonRollover();
  assert.equal(f.season.seasonNumber(), 5);
  assert.equal(f.season.seasonOver(), true);
  assert.equal(f.season.currentPass()[0].f.n, 900);
  assert.equal(f.S.passLvl, 9); assert.equal(f.S.premium, true);
  assert.equal(f.saves.length, 0);
  assert.equal(f.counts.requests, 0);
});

test('same-season date and reward updates repaint without resetting earned progress', async () => {
  const f = load({ raw: { v: 6, passSeason: 4, passLvl: 7, passXp: 60, premium: true } });
  f.Progress.reconcileSeason();
  const repaints = f.counts.repaints;
  const e = s4(); e.endsAt = '2026-11-08T00:00:00Z'; e.config.pass[0].f.n = 777;
  f.response(calendar([e]));
  await f.Progress.applySeasonRollover();
  assert.equal(f.counts.repaints, repaints + 1);
  assert.equal(f.season.currentPass()[0].f.n, 777);
  assert.equal(f.S.passLvl, 7); assert.equal(f.S.passXp, 60); assert.equal(f.S.premium, true);
  assert.equal(f.saves.length, 0);
  assert.ok(f.entries.has('ttu-seasons'));
});

test('public calendar watch is auth-independent, idempotent and refreshes on return', async () => {
  const f = load({ response: calendar([s4(), s5()]) });
  f.Progress.watchSeason(); f.Progress.watchSeason();
  await f.Progress.applySeasonRollover();
  assert.equal(f.counts.requests, 1); assert.equal(f.counts.logins, 0);
  assert.equal(f.listeners.get('window:pageshow').length, 1);
  assert.equal(f.listeners.get('window:online').length, 1);
  f.document.visibilityState = 'hidden'; f.emit('document', 'visibilitychange');
  assert.equal(f.counts.requests, 1);
  f.clock('2026-11-11T00:00:00Z');
  f.document.visibilityState = 'visible'; f.emit('document', 'visibilitychange');
  await f.Progress.applySeasonRollover();
  assert.equal(f.S.passSeason, 5);
  assert.equal(f.counts.requests, 2);
});

test('season boundary timer reconciles cached rollover before a failed fetch', async () => {
  const f = load({ now: '2026-11-10T23:59:59Z', cached: calendar([s4(), s5()]),
    raw: { v: 6, passSeason: 4, passLvl: 7, passXp: 60, premium: true } });
  f.Progress.watchSeason(); await f.Progress.applySeasonRollover();
  const timer = Array.from(f.timers.values())[0];
  assert.equal(timer.delay, 1000);
  assert.equal(f.S.passSeason, 4, 'gap must not reset old-season progress');
  f.clock('2026-11-11T00:00:00Z'); timer.fn();
  assert.equal(f.S.passSeason, 5, 'rollover happens synchronously at the boundary');
  assert.equal(f.S.passLvl, 0); assert.equal(f.S.premium, false);
  await f.Progress.applySeasonRollover();
  assert.equal(f.saves.length, 1);
});

test('concurrent calendar refreshes share one request', async () => {
  let resolve;
  const pending = new Promise((r) => { resolve = r; });
  const f = load({ response: pending });
  const first = f.Progress.applySeasonRollover(), second = f.Progress.applySeasonRollover();
  assert.equal(f.counts.requests, 1);
  resolve(calendar([s4()]));
  await Promise.all([first, second]);
  assert.equal(f.season.currentPass()[0].f.n, 900);
});

test('the public liveops API request does not require a player token', async () => {
  const context = vm.createContext({ URLSearchParams, location: { search: '?api=http://localhost:4100' } });
  vm.runInContext(read('services/api.js') + '\nglobalThis.api = Api;', context);
  let options;
  context.api.request = async (url, opts) => { assert.equal(url, '/api/client/v1/liveops/events'); options = opts; return { ok: true, json: calendar([]) }; };
  assert.ok(await context.api.liveops());
  assert.equal(options.auth, false);
});

test('зашитых чисел сезона больше нет в словарях', () => {
  for (const src of [read('locales/ru.js'), read('locales/en.js')]) {
    assert.ok(!src.includes("'season.left'"), 'season.left был выдуманным остатком');
    assert.ok(!src.includes("'season.leftShort'"), 'season.leftShort был выдуманным остатком');
    assert.ok(src.includes("'season.over'"), 'финиш сезона должен быть в словаре');
  }
});
