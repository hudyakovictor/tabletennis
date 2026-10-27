/* =====================================================================
   I18N — локализация оболочки. Словари лежат в locales/<lang>.js и
   регистрируются через I18n.add(); новый язык = новый файл словаря +
   строка в LANGS (см. docs/ARCHITECTURE.ru.md, «Как добавить язык»).
   Ключи — точечные ('nav.hub', 'wallet.notEnough'); значение — строка с
   плейсхолдерами {name} или объект плюральных форм {one,few,many,other}
   (выбор — Intl.PluralRules по числу из параметра n).
   Движок (iframe) получает язык сообщением GameHost 'locale' и пользуется
   своим словарём (game/tt/src/03_i18n.js) с тем же контрактом ключей.
   ===================================================================== */
const I18n = {
  dicts: {},
  /* Порядок = порядок в переключателе. name — автоним, не переводится. */
  LANGS: [
    { id: 'ru', name: 'Русский' },
    { id: 'en', name: 'English' }
  ],
  fallback: 'ru',
  lang: 'ru',
  add(lang, dict) { this.dicts[lang] = Object.assign(this.dicts[lang] || {}, dict); },
  has(lang) { return !!this.dicts[lang]; },
  detect() {
    try { if (typeof S !== 'undefined' && S.lang && this.has(S.lang)) return S.lang; } catch (e) {}
    try {
      const w = typeof TGX !== 'undefined' && TGX.w;
      const code = (w && w.initDataUnsafe && w.initDataUnsafe.user && w.initDataUnsafe.user.language_code) || '';
      const hit = this._match(code); if (hit) return hit;
    } catch (e) {}
    try { return this._match(navigator.language || '') || this.fallback; } catch (e) { return this.fallback; }
  },
  _match(code) {
    const c = String(code || '').toLowerCase();
    if (!c) return null;
    if (this.has(c)) return c;
    const base = c.split('-')[0];
    return this.has(base) ? base : null;
  },
  init() {
    this.lang = this.detect();
    try { document.documentElement.lang = this.lang; } catch (e) {}
  },
  setLang(lang) {
    if (!this.has(lang) || lang === this.lang) return;
    this.lang = lang;
    try { document.documentElement.lang = lang; } catch (e) {}
    S.lang = lang; saveNow();
    if (typeof GameHost !== 'undefined') GameHost.send('locale', { lang });
    if (typeof Nav !== 'undefined' && Nav.build) Nav.build();
    if (typeof Sheet !== 'undefined' && Sheet.cur) Sheet.close(true);
    if (typeof Router !== 'undefined' && Router.cur) Router.go(Router.cur, { replace: true, mode: 'push' });
  },
  _lookup(key) {
    const d = this.dicts[this.lang];
    if (d && key in d) return d[key];
    const f = this.dicts[this.fallback];
    if (f && key in f) return f[key];
    return undefined;
  },
  t(key, vars = {}) {
    let v = this._lookup(key);
    if (v === undefined) return key;
    if (v && typeof v === 'object') {
      const n = Number(vars.n);
      let form = 'other';
      try { form = new Intl.PluralRules(this.lang).select(Number.isFinite(n) ? n : 0); } catch (e) {}
      v = v[form] || v.other || v.one || '';
    }
    return String(v).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : '{' + k + '}'));
  },
  num(n) { try { return new Intl.NumberFormat(this.lang).format(Math.round(n)); } catch (e) { return String(Math.round(n)); } },
  /* Человекочитаемый остаток времени (мс) в текущей локали: 2ч 14м / 2h 14m */
  left(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? this.t('time.hm', { h, m: String(m).padStart(2, '0') }) : m + ':' + String(ss).padStart(2, '0');
  }
};
const t = (key, vars) => I18n.t(key, vars);
