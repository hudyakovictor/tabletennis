/* ---------- лиги и демо-соперники (данные; имена лиг — через i18n) ---------- */
const PEOPLE = [
  { n: 'Максим Дорохов', s: 'М. Дорохов', r: 2210, c: ['#2EC9FF', '#1A3FA8'], club: 'Spin Lab', wr: 71 },
  { n: 'Анна Коваль', s: 'А. Коваль', r: 2195, c: ['#FF7AD9', '#7A1FA8'], club: 'Arena 4', wr: 64 },
  { n: 'Влад Соколов', s: 'В. Соколов', r: 2170, c: ['#7CFF8A', '#127A3A'], club: 'Topspin', wr: 58 },
  { n: 'Игорь Петров', s: 'И. Петров', r: 2050, c: ['#FFC93A', '#A8531F'], club: 'Arena 2', wr: 52 },
  { n: 'Тимур Сафин', s: 'Т. Сафин', r: 1990, c: ['#B48CFF', '#3B1FA8'], club: 'Kazan PP', wr: 49 },
  { n: 'Дарья Мороз', s: 'Д. Мороз', r: 2320, c: ['#7DF3FF', '#0E6A8A'], club: 'Ice Spin', wr: 66 },
  { n: 'Роман Ким', s: 'Р. Ким', r: 2080, c: ['#FF9A6B', '#A81F2A'], club: 'Seoul Club', wr: 55 },
  { n: 'Lee Jun', s: 'Lee Jun', r: 2410, c: ['#FFE680', '#A86A00'], club: 'Busan', wr: 74 }
];
const ME_COL = ['#FF7A4D', '#B4161E'];
const LEAGUES = [
  { id: 'bronze', k: 'league.bronze', min: 900, c: ['#E3A06B', '#8A4A1F'] },
  { id: 'silver', k: 'league.silver', min: 1400, c: ['#E6EEFF', '#7B8BB0'] },
  { id: 'gold', k: 'league.gold', min: 1800, c: ['#FFE680', '#C47A00'] },
  { id: 'pro', k: 'league.pro', min: 2100, c: ['#7DF3FF', '#0A6FC2'] },
  { id: 'super', k: 'league.super', min: 2400, c: ['#D3B5FF', '#5320C9'] },
  { id: 'legend', k: 'league.legend', min: 2700, c: ['#FFB199', '#C2122A'] }
];
const leagueOf = (r) => { let L = LEAGUES[0]; for (const l of LEAGUES) if (r >= l.min) L = l; return L; };
const nextLeague = (r) => LEAGUES.find((l) => l.min > r) || null;
const leagueName = (L) => t(L.k);

/* Шаг рейтинга — та же формула Эло, что и на сервере (`eloK` и `maxRatingDelta`
 * в `newfolder/src/routes/clientRoutes.js`). Раньше клиент брал фиксированные
 * +24/−18: профиль считал одно число, сервер — другое, и после синхронизации
 * они уже никогда не сходились. Константы сверяет `tests/state.test.cjs`.
 * Неизвестный соперник = 1000: тот же дефолт, что у сервера. */
const ELO_K = 32, ELO_MAX = 64, ELO_UNKNOWN = 1000;
const ratingDelta = (rating, opponentRating, win) => {
  const mine = Number(rating) || 0;
  const opp = Number.isFinite(Number(opponentRating)) ? Number(opponentRating) : ELO_UNKNOWN;
  const expected = 1 / (1 + 10 ** ((opp - mine) / 400));
  return Math.max(-ELO_MAX, Math.min(ELO_MAX, Math.round(ELO_K * ((win ? 1 : 0) - expected))));
};
