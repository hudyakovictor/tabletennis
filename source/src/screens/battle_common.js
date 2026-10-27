/* Причины очка приходят из движка русскими кодами ('НЕ ДОСТАЛ', 'СЕТКА', …):
     матч здесь, тексты — в словаре. TODO(engine-i18n): движок должен слать
     стабильные коды (MISS/NET/OUT/SERVE), а не локализованные строки. */
const REASON = (who, r) => {
  r = String(r || '').toUpperCase();
  if (who > 0) {
    if (r.includes('НЕ ДОСТАЛ')) return t('reason.oppMissed');
    if (r.includes('ПЕРЕЛЕТ') || r.includes('СЕТК')) return t('reason.oppNet');
    if (r.includes('АУТ')) return t('reason.oppOut');
    if (r.includes('ПОДАЧ')) return t('reason.oppServe');
    return '';
  }
  if (r.includes('НЕ ДОСТАЛ') || r.includes('ПРОПУС')) return t('reason.missed');
  if (r.includes('ПЕРЕЛЕТ') || r.includes('СЕТК')) return t('reason.net');
  if (r.includes('АУТ')) return t('reason.out');
  if (r.includes('ПОДАЧ')) return t('reason.serve');
  return t('reason.miss');
};
/* Уровень бота — ВЫБОР ИГРОКА, а не карточка соперника и не лига:
 * четыре ступеньки движка (AI_LEVELS: EASY/MEDIUM/HARD/WTF) и ровно они
 * же в S.diff (0..3). Лига осталась рейтингу: она лишь подсказывает
 * стартовую ступеньку новому профилю (миграция сейва = СРЕДНИЙ). */
const DIFFS = [
  { id: 0, name: 'EASY', tk: 'diff.easy', sk: 'diff.easySub', c: '#9CFFD0' },
  { id: 1, name: 'MEDIUM', tk: 'diff.medium', sk: 'diff.mediumSub', c: '#9BE8FF' },
  { id: 2, name: 'HARD', tk: 'diff.hard', sk: 'diff.hardSub', c: '#FFC93A' },
  { id: 3, name: 'WTF', tk: 'diff.wtf', sk: 'diff.wtfSub', c: '#FF69D8' }
];
const diffOf = (i) => DIFFS[clamp(Math.round(Number(i) || 0), 0, DIFFS.length - 1)];
/* Адаптация бота к игроку — ТОЛЬКО между матчами: перевес последних
 * результатов даёт тренд −1…+1, движок правит им агрессию и точность
 * на ±4 % (у WTF ±2 %) и НИКОГДА — реакцию. Раньше форма двигала
 * уровень бота целиком, то есть «бот всегда на полшага сильнее». */
const aiTrend = () => {
  const f = Array.isArray(S.form) ? S.form.slice(-6) : [];
  if (f.length < 3) return 0;
  const w = f.reduce((n, x) => n + (x ? 1 : 0), 0), l = f.length - w;
  return clamp((w - l) / f.length, -1, 1);
};
/* Карточки, которые крутит рулетка: слабейшие лица ростера внизу, все — к
 * Легенде. Визуально рейтинги честные, клипать их не станем. */
const MM_POOL = {
  bronze: [4, 3, 6], silver: [4, 3, 6, 2], gold: [2, 0, 1, 6],
  pro: [0, 1, 2, 6, 5], super: [0, 1, 2, 5, 6, 7], legend: [1, 5, 7],
};
/* Партии до 11. У свободной игры счёта нет вовсе (движок держит freePlay),
   поэтому target там — только вежливая заглушка для протокола. */
const TARGET = { ranked: 11, free: 11, practice: 11 };
const devBtn = () => (DEVMODE ? `<button class="ib mx-dev pe" data-act="dev" aria-label="${t('dev.zone')}">${Art.icon('target', { c: '#9BE8FF', sw: 2.4 })}</button>` : '');
