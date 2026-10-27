/* ---------- состояние (переживает перезапуск, если доступно хранилище) ---------- */
/* Схема сейва версионируется (S.v): каждое изменение формы DEFAULT_STATE —
   новая версия + шаг в MIGRATIONS. Перед миграцией пишется бэкап
   (ttu-v2.bak), битый сейв не роняет игру: откат к бэкапу или честный старт.
   Запись — дебаунс 250 мс: save() дёргают слайдеры и анимации кошелька на
   каждый тик, синхронный JSON+localStorage в хот-пате = микрофризы.
   Критичные места (покупка, конец матча) вызывают saveNow(). Флаш также
   происходит при сворачивании приложения (visibilitychange/pagehide). */
/* Новый игрок — НОВЫЙ игрок: никакого вшитого «ветерана 2140». Рейтинг с
   нуля бывает только 1000, рекорд 0/0, серия и лучший розыгрыш — нулевые,
   уровень 1. Всё остальное зарабатывается матчами (см. сложность формы в
   screens/match.js). */
const SAVE_KEY = 'ttu-v2';
const SAVE_VERSION = 2;
const DEFAULT_STATE = {
  v: SAVE_VERSION, lang: null,
  name: 'Anton Spin', nick: '@anton_tt', club: 'Spin Lab',
  coins: 1840, gems: 46, level: 1, xp: 0, xpMax: 1800,
  rating: 1000, wins: 0, losses: 0, streak: 0, bestRally: 0,
  form: [],
  passLvl: 7, passXp: 60, premium: false, claimed: { f: [1, 2, 3, 4, 5], p: [] },
  chests: [
    { id: 'c1', kind: 'silver', state: 'ready' },
    { id: 'c2', kind: 'gold', state: 'unlocking', endsAt: Date.now() + (2 * 3600 + 14 * 60) * 1000 },
    { id: 'c3', kind: 'epic', state: 'locked' },
    null
  ],
  owned: ['r-teal', 'b-ink', 't-coral'], equipped: { rubber: 'r-teal', blade: 'b-ink', trail: 't-coral' },
  sfx: true, music: true, vibro: true, rm: false, quality: 'high', assist: true, tutorial: true, hint: true, tutorialDone: false
};
/* Шаги миграции: MIGRATIONS[v] переводит сейв версии v в v+1 (мутирует черновик). */
const MIGRATIONS = {
  /* v1 (без поля v, ключ ttu-v2) → v2: язык интерфейса + отпечаток фейк-ветерана.
     Миграция одним отпечатком: вшитый «ветеран» (2140 / 124-61 / ур. 12) — это
     стартовые данные старой сборки, а не заслуги игрока. Нетронутый фейк
     становится честным новичком; реально отыгранный профиль не трогаем. */
  1: (s) => {
    if (s.rating === 2140 && s.wins === 124 && s.losses === 61 && s.level === 12 && s.xp === 1240) {
      Object.assign(s, { rating: 1000, wins: 0, losses: 0, streak: 0, bestRally: 0, level: 1, xp: 0 });
    }
    if (s.lang === undefined) s.lang = null;
  }
};
const Store = {
  ok: (() => { try { const k = '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } })(),
  read(key) { if (!this.ok) return null; try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
  write(key, s) { if (!this.ok) return; try { localStorage.setItem(key, JSON.stringify(s)); } catch (e) {} },
  load() {
    let raw = this.read(SAVE_KEY);
    if (!raw || typeof raw !== 'object') raw = this.read(SAVE_KEY + '.bak');   // битый основной → бэкап
    if (!raw || typeof raw !== 'object') return null;
    const from = Number.isFinite(raw.v) ? raw.v : 1;
    if (from > SAVE_VERSION) return raw;                                        // сейв новее игры: не ломаем
    if (from < SAVE_VERSION) this.write(SAVE_KEY + '.bak', raw);                // бэкап до миграции
    const draft = Object.assign(structuredClone(DEFAULT_STATE), raw);
    for (let v = from; v < SAVE_VERSION; v++) { if (MIGRATIONS[v]) MIGRATIONS[v](draft); }
    draft.v = SAVE_VERSION;
    /* форма важнее значений: недостающие ветки добираем из дефолтов */
    if (!Array.isArray(draft.form)) draft.form = [];
    if (!draft.claimed || typeof draft.claimed !== 'object') draft.claimed = structuredClone(DEFAULT_STATE.claimed);
    if (!Array.isArray(draft.claimed.f)) draft.claimed.f = [];
    if (!Array.isArray(draft.claimed.p)) draft.claimed.p = [];
    if (!Array.isArray(draft.owned)) draft.owned = DEFAULT_STATE.owned.slice();
    if (!draft.equipped || typeof draft.equipped !== 'object') draft.equipped = Object.assign({}, DEFAULT_STATE.equipped);
    if (!Array.isArray(draft.chests)) draft.chests = structuredClone(DEFAULT_STATE.chests);
    return draft;
  },
  save(s) { this.write(SAVE_KEY, s); }
};
const S = Store.load() || structuredClone(DEFAULT_STATE);
let _saveT = 0;
const saveNow = () => { if (_saveT) { clearTimeout(_saveT); _saveT = 0; } Store.save(S); };
/* save() — отложить запись; повторные вызовы сливаются в одну */
const save = () => { if (_saveT) return; _saveT = setTimeout(saveNow, 250); };
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  window.addEventListener('pagehide', saveNow);
}
