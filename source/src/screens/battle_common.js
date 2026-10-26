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
/* Сложность бота = ТВОЯ лига, не карточка соперника: бронзовый игрок не
 * должен получать ПРО-руку только потому, что в ростере все карточки про.
 * Quick играет ступенькой ниже рейтинга, ranked — ровно по лиге. */
const LDIFF = { bronze: 0, silver: 1, gold: 2, pro: 3, super: 4, legend: 4 };
/* Карточки, которые крутит рулетка: слабейшие лица ростера внизу, все — к
 * Легенде. Визуально рейтинги честные, клипать их не станем. */
const MM_POOL = {
  bronze: [4, 3, 6], silver: [4, 3, 6, 2], gold: [2, 0, 1, 6],
  pro: [0, 1, 2, 6, 5], super: [0, 1, 2, 5, 6, 7], legend: [1, 5, 7],
};
const TARGET = { ranked: 11, quick: 7, practice: 11 };
/* Сложность зарабатывается формой последних матчей: по последним 6 играм
   перевес побед ≥ 3 — оппонент на уровень жёстче, перевес поражений ≥ 3 —
   на уровень мягче. Новый игрок (формы нет) играет честную базу. */
const formAdjust = () => {
  const f = Array.isArray(S.form) ? S.form.slice(-6) : [];
  if (f.length < 4) return 0;
  const w = f.reduce((n, x) => n + (x ? 1 : 0), 0), l = f.length - w;
  return w - l >= 3 ? 1 : l - w >= 3 ? -1 : 0;
};
const devBtn = () => (DEVMODE ? `<button class="ib mx-dev pe" data-act="dev" aria-label="${t('dev.zone')}">${Art.icon('target', { c: '#9BE8FF', sw: 2.4 })}</button>` : '');
