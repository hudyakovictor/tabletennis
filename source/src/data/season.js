/* Server dates and rewards are authoritative. Keep the last validated calendar
 * offline, including the completed season; never reopen season 4 after a rollover. */
const HARD_SEASON = { n: 4, days: 26, start: Date.UTC(2026, 9, 15), end: Date.UTC(2026, 10, 10) };
const SEASON_CACHE_KEY = 'ttu-seasons';
let _serverSeasons = null, _calendarAt = 0;

function setServerSeason(data) {
  if (!data || !Array.isArray(data.events)) return false;
  const at = Date.parse(data.serverTimeUtc);
  if (!Number.isFinite(at) || at < _calendarAt) return false;
  const seasons = [];
  for (const e of data.events) {
    if (!e || e.type !== 'season' || !e.config || !e.config.season || !['active', 'scheduled', 'finished'].includes(e.status)) continue;
    const n = e.config.season.n, start = Date.parse(e.startsAt), end = Date.parse(e.endsAt), pass = e.config.pass;
    if (!Number.isSafeInteger(n) || n <= 0 || !Number.isFinite(start) || !Number.isFinite(end) || start >= end || !Array.isArray(pass) || !pass.length || pass.length > 100) return false;
    const validReward = (r) => r && Number.isSafeInteger(r.n) && r.n > 0 && (
      r.k === 'coins' || r.k === 'gems' ||
      (r.k === 'chest' && r.n === 1 && ['silver', 'gold', 'epic'].includes(r.kind)) ||
      (r.k === 'card' && r.n === 1 && /^#[0-9a-f]{6}$/i.test(r.col))
    );
    if (!pass.every((r, i) => r && r.s === n && r.l === i + 1 && validReward(r.f) && validReward(r.p))) return false;
    seasons.push({ n, start, end, days: (end - start) / 864e5, pass, closed: e.status === 'finished' });
  }
  _serverSeasons = seasons.sort((a, b) => b.start - a.start || b.n - a.n);
  _calendarAt = at;
  if (typeof Store !== 'undefined') Store.write(SEASON_CACHE_KEY, data);
  return true;
}

function currentSeason(now = Date.now()) {
  if (_serverSeasons !== null) {
    return _serverSeasons.find((s) => s.start <= now && now < s.end && !s.closed)
      || _serverSeasons.find((s) => s.start <= now)
      || { ...HARD_SEASON, closed: true };
  }
  return HARD_SEASON;
}
function seasonNumber(now = Date.now()) { return currentSeason(now).n; }

const seasonEnd = (now = Date.now()) => currentSeason(now).end;
const seasonLeft = (now = Date.now()) => seasonOver(now) ? 0 : Math.max(0, seasonEnd(now) - now);
const seasonOver = (now = Date.now()) => {
  const s = currentSeason(now);
  return !!s.closed || now < s.start || now >= s.end;
};
const seasonLeftText = (now = Date.now()) => {
  const ms = seasonLeft(now);
  if (seasonOver(now)) return t('season.over');
  const d = Math.floor(ms / 864e5);
  if (d) return t('season.dh', { d, h: Math.floor(ms % 864e5 / 36e5) });
  return t('season.hm', { h: Math.floor(ms / 36e5), m: Math.max(1, Math.floor(ms % 36e5 / 6e4)) });
};
const seasonLeftShort = (now = Date.now()) => {
  const ms = seasonLeft(now);
  if (seasonOver(now)) return t('season.overShort');
  const d = Math.floor(ms / 864e5);
  return d ? t('season.dShort', { d }) : t('season.hShort', { h: Math.max(1, Math.floor(ms / 36e5)) });
};
const passTier = (l, seasonN) => {
  const f = l % 5 === 0 ? { k: 'chest', kind: 'silver', n: 1 } : l % 2 ? { k: 'coins', n: 50 + l * 10 } : { k: 'gems', n: 2 + (l >> 1) };
  const p = l % 5 === 0 ? { k: 'chest', kind: l % 10 === 0 ? 'epic' : 'gold', n: 1 } : l % 3 === 0 ? { k: 'card', n: 1, col: ['#FF4B3E', '#9F6BFF', '#2EC9FF'][l % 3] } : { k: 'gems', n: 5 + l };
  return { s: seasonN, l, f, p };
};
const PASS = [...Array(20)].map((_, i) => passTier(i + 1, HARD_SEASON.n));
const PASS_FOR = (seasonN) => [...Array(20)].map((_, i) => passTier(i + 1, seasonN));

function currentPass(now = Date.now()) {
  const s = currentSeason(now);
  return s.pass || PASS_FOR(s.n);
}

function rolloverNeeded(savePassSeason, now = Date.now()) {
  return savePassSeason != null && _serverSeasons !== null && !seasonOver(now) && Number.isFinite(Number(savePassSeason)) && seasonNumber(now) > Number(savePassSeason);
}

function nextSeasonBoundary(now = Date.now()) {
  return Math.min(...(_serverSeasons || [HARD_SEASON]).flatMap((s) => [s.start, s.end]).filter((at) => at > now));
}

if (typeof Store !== 'undefined') setServerSeason(Store.read(SEASON_CACHE_KEY));
globalThis.TTSeason = { setServerSeason, currentSeason, seasonNumber, seasonEnd, seasonLeft, seasonOver, seasonLeftText, seasonLeftShort, PASS, currentPass, rolloverNeeded, nextSeasonBoundary, HARD_SEASON };
