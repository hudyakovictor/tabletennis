/* Сезон — календарь, а не картинка. Остаток считается от даты старта, поэтому
 * чип «Сезон: 12д» в рейтинге и «осталось 12д 4ч» в пасе тикают, а после
 * финиша честно говорят «сезон завершён». Раньше обе строки (season.left и
 * season.leftShort) были зашиты в словарь — одно и то же число навсегда. */
const SEASON = { n: 4, days: 26, start: Date.UTC(2026, 9, 15) };   // старт сезона 4 — 15.10.2026, 00:00 UTC
const seasonEnd = () => SEASON.start + SEASON.days * 864e5;
const seasonLeft = (now = Date.now()) => Math.max(0, seasonEnd() - now);
const seasonOver = (now = Date.now()) => seasonEnd() <= now;
/* Длинный остаток для героя паса: дни и часы, в последние часы — часы и минуты. */
const seasonLeftText = (now = Date.now()) => {
  const ms = seasonLeft(now);
  if (!ms) return t('season.over');
  const d = Math.floor(ms / 864e5);
  if (d) return t('season.dh', { d, h: Math.floor(ms % 864e5 / 36e5) });
  return t('season.hm', { h: Math.floor(ms / 36e5), m: Math.max(1, Math.floor(ms % 36e5 / 6e4)) });
};
/* Короткий остаток для чипа в рейтинге: только дни или только часы. */
const seasonLeftShort = (now = Date.now()) => {
  const ms = seasonLeft(now);
  if (!ms) return t('season.overShort');
  const d = Math.floor(ms / 864e5);
  return d ? t('season.dShort', { d }) : t('season.hShort', { h: Math.max(1, Math.floor(ms / 36e5)) });
};
const PASS = [...Array(20)].map((_, i) => {
  const l = i + 1;
  const f = l % 5 === 0 ? { k: 'chest', kind: 'silver', n: 1 } : l % 2 ? { k: 'coins', n: 50 + l * 10 } : { k: 'gems', n: 2 + (l >> 1) };
  const p = l % 5 === 0 ? { k: 'chest', kind: l % 10 === 0 ? 'epic' : 'gold', n: 1 } : l % 3 === 0 ? { k: 'card', n: 1, col: ['#FF4B3E', '#9F6BFF', '#2EC9FF'][l % 3] } : { k: 'gems', n: 5 + l };
  return { l, f, p };
});
