/* =====================================================================
   API — единственная точка сетевых запросов оболочки.
   Клиент живёт статическим бандлом на Vercel, сервер — отдельно, поэтому
   адрес API вшивается при сборке (python3 source/build.py с TT_API_BASE)
   либо подменяется на ?api=http://localhost:4100 для отладки. Пустой адрес
   — штатный режим «только локально»: игра работает, сеть не нужна.
   Ни один экран не ждёт сеть: очередь и слияние — в services/progress.js.
   ===================================================================== */
const AUTH_KEY = 'ttu-auth';

const Api = {
  base: (() => {
    let q = null;
    try { q = new URLSearchParams(location.search).get('api'); } catch (e) { /* нет query */ }
    const baked = typeof TT_API_BASE === 'string' ? TT_API_BASE : '';
    return String(q || baked || '').replace(/\/+$/, '');
  })(),
  get enabled() { return !!this.base; },
  timeoutMs: 8000,

  /* Токен и playerId хранятся отдельно от сейва: сброс прогресса не должен
   * разлогинивать, а смена аккаунта Telegram — наследовать чужой токен. */
  session() { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; } },
  remember(s) { try { localStorage.setItem(AUTH_KEY, JSON.stringify(s)); } catch (e) {} },
  forget() { try { localStorage.removeItem(AUTH_KEY); } catch (e) {} },

  /* Сырая строка initData — единственное доказательство личности в TMA.
   * initDataUnsafe не годится: его можно подделать в клиенте. */
  initData() {
    const w = TGX.w;
    return w && w.initData ? String(w.initData) : '';
  },

  /** Запрос с таймаутом. Возвращает { ok, status, json } либо { offline:true }. */
  async request(path, { method = 'GET', body = null, idem = null, auth = true } = {}) {
    if (!this.enabled) return { ok: false, offline: true, status: 0 };
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : 0;
    const headers = { 'Content-Type': 'application/json' };
    const s = this.session();
    if (auth && s && s.token) headers.Authorization = 'Bearer ' + s.token;
    if (idem) headers['Idempotency-Key'] = idem;
    try {
      const r = await fetch(this.base + path, {
        method, headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl ? ctl.signal : undefined,
        credentials: 'omit', mode: 'cors', cache: 'no-store'
      });
      const json = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, json };
    } catch (e) {
      /* Таймаут, обрыв, CORS — для вызывающего это одно состояние: сети нет. */
      return { ok: false, offline: true, status: 0, error: (e && e.name) || 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  /** Вход по initData. Вне Telegram строки нет — молча играем локально. */
  async login() {
    if (!this.enabled) return null;
    const initData = this.initData();
    if (!initData) return null;
    const r = await this.request('/api/client/v1/auth/telegram', {
      method: 'POST', body: { initData }, auth: false
    });
    if (!r.ok || !r.json || !r.json.playerToken) return null;
    this.remember({ token: r.json.playerToken, playerId: r.json.playerId });
    return r.json;
  },

  /** LiveOps-календарь: текущий сезон, его даты и сетка наград. Публичная
   *  информация — токен не обязателен. Без сети возвращает null и клиент
   *  сохраняет последний календарь либо использует офлайн-сезон 4. */
  async liveops() {
    if (!this.enabled) return null;
    const r = await this.request('/api/client/v1/liveops/events', { auth: false });
    if (r.offline || !r.ok || !r.json) return null;
    return r.json;
  }
};
