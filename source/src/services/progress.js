/* =====================================================================
   PROGRESS — серверное сохранение прогресса.
   Локальный сейв остаётся источником истины для игры: без сети матч,
   награды и рейтинг работают как раньше. Сеть только сохраняет ФАКТЫ —
   «матч 11:8 длился 2:14», «уровень 2 закрыт» — и присылает серверные
   числа, которые нельзя уменьшить локально.
   Очередь на диске: краш, сворачивание TMA или обрыв сети не теряют
   результат. Повтор безопасен — у каждой записи свой Idempotency-Key,
   сервер отдаёт сохранённый ответ, а не начисляет второй раз.
   ===================================================================== */
const SYNC_KEY = 'ttu-sync';
const SYNC_MAX = 40;

const Progress = {
  online: false, playerId: null, ready: false,

  q() { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || '[]') || []; } catch (e) { return []; } },
  saveQ(list) { try { localStorage.setItem(SYNC_KEY, JSON.stringify(list.slice(-SYNC_MAX))); } catch (e) {} },
  get pending() { return this.q().length; },

  push(item) {
    const list = this.q();
    list.push(Object.assign({ at: Date.now() }, item));
    this.saveQ(list);
  },

  /** Запись о матче. Числа приходят из экрана итога, а не считаются здесь. */
  match(m) {
    if (!Api.enabled || !m || !(m.durationMs > 0)) return;
    const id = 'mt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    this.push({
      k: 'match', id,
      body: {
        matchId: id,
        mode: m.mode || 'career',
        playerScore: m.me, opponentScore: m.op,
        durationMs: Math.round(m.durationMs),
        opponentRating: m.oppRating, opponentName: m.oppName,
        bestRally: m.bestRally || 0,
        rulesVersion: m.rulesVersion || null,
        clientVersion: typeof SHELL_BUILD === 'string' ? SHELL_BUILD : null
      }
    });
    this.flush();
  },

  /** Закрытая ступенька уровня. Уровень и опыт — те, что уже в сейве. */
  level(l) {
    if (!Api.enabled || !l) return;
    this.push({
      k: 'level', id: 'lvl_' + l.level + '_' + Date.now().toString(36),
      body: { level: l.level, durationMs: Math.round(l.durationMs || 0), xp: l.xp }
    });
    this.flush();
  },

  /** Серверные числа не откатывают локальные: офлайн-игра могла уйти вперёд.
   *  Рейтинг — исключение: он считается на сервере, а клиент только повторяет
   *  ту же формулу для офлайна. Когда очередь пуста, сервер знает про игрока
   *  всё, и его числа берутся точь-в-точь: иначе в профиле и на доске рейтинга
   *  у одного игрока два разных рейтинга. Уровень, опыт и валюта остаются
   *  «только вверх» — их копит клиент. */
  merge(p, exact = false) {
    if (!p) return;
    let changed = false;
    const take = (key, field, serverOwned = false) => {
      const v = Number(p[key]);
      if (!Number.isFinite(v)) return;
      if (exact && serverOwned) { if (S[field] !== v) { S[field] = v; changed = true; } }
      else if (v > (Number(S[field]) || 0)) { S[field] = v; changed = true; }
    };
    take('level', 'level'); take('rating', 'rating', true); take('wins', 'wins', true);
    take('losses', 'losses', true); take('streak', 'streak', true); take('bestRally', 'bestRally');
    take('coins', 'coins'); take('gems', 'gems');
    /* История рейтинга живёт только на клиенте, сервер шлёт одно число. Когда
     * очередь пуста — это число и есть сегодняшняя точка графика: иначе кривая
     * в профиле расходится с подписью над ней. */
    if (exact && Number.isFinite(Number(p.rating))) ratingCorrect(Number(p.rating));
    save();
    /* Открытый экран показывал старые числа — перерисовываем те, что подписаны
     * на серверные данные (`live` в Router.def). Пачка ответов из очереди даёт
     * одну перерисовку, а не по одной на каждый матч. */
    if (changed && typeof Router !== 'undefined' && Router.cur) {
      clearTimeout(this.repaintAt);
      this.repaintAt = setTimeout(() => Router.repaint(), 150);
    }
  },

  async pull() {
    const r = await Api.request('/api/client/v1/me');
    if (r.offline) { this.online = false; return; }
    if (!r.ok || !r.json) return;
    this.online = true;
    this.playerId = r.json.player && r.json.player.playerId;
    /* Очередь ещё не отправлена — серверные числа неполные, берём максимум. */
    this.merge(r.json.progress, !this.pending);
  },

  seasonRequest: null, seasonWatching: false, seasonTimer: 0, seasonStamp: null,

  reconcileSeason() {
    const season = globalThis.TTSeason;
    if (season.rolloverNeeded(S.passSeason)) {
      S.passSeason = season.seasonNumber();
      S.passLvl = 0;
      S.passXp = 0;
      S.premium = false;
      S.claimed = { f: [], p: [] };
      saveNow();
    }
    const current = season.currentSeason();
    const stamp = JSON.stringify([current, season.seasonOver(), season.seasonLeftText(), S.passSeason]);
    if (stamp !== this.seasonStamp) {
      this.seasonStamp = stamp;
      Nav.dots();
      if (Router.cur === 'pass') Router.repaint();
      if (Router.cur === 'ranks') {
        const chip = document.querySelector('.screen.current [data-season-left]');
        if (chip) chip.textContent = t('ranks.seasonChip', { left: season.seasonLeftShort() });
      }
    }
    if (this.seasonWatching) {
      clearTimeout(this.seasonTimer);
      const delay = Math.max(25, Math.min(60000, season.nextSeasonBoundary() - Date.now()));
      this.seasonTimer = setTimeout(() => {
        // Reconcile cached boundaries immediately, without waiting for the network.
        this.reconcileSeason();
        this.applySeasonRollover().catch(() => {});
      }, delay);
    }
  },

  /** Public calendar loading is independent of Telegram authentication. */
  async applySeasonRollover() {
    if (this.seasonRequest) return this.seasonRequest;
    this.seasonRequest = (async () => {
      try {
        if (Api.enabled) globalThis.TTSeason.setServerSeason(await Api.liveops());
      } finally {
        this.reconcileSeason();
      }
    })();
    try { await this.seasonRequest; } finally { this.seasonRequest = null; }
  },

  watchSeason() {
    if (this.seasonWatching) return;
    this.seasonWatching = true;
    const refresh = () => {
      this.reconcileSeason();
      this.applySeasonRollover().catch(() => {});
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
    window.addEventListener('pageshow', refresh);
    window.addEventListener('online', refresh);
    refresh();
  },

  async boot() {
    if (!Api.enabled || this.ready) return;
    this.ready = true;
    const s = await Api.login();
    /* SDK Telegram грузится async: если его тег пришёл позже нашего `load`, в
     * момент первого boot() initData ещё нет. Пара отложенных попыток закрывает
     * этот зазор; дальше — обычный возврат в фокус (visibilitychange). */
    if (!s) {
      this.ready = false;
      if ((this.retries = (this.retries || 0) + 1) <= 3) setTimeout(() => this.boot(), 800 * this.retries);
      return;
    }
    this.retries = 0;
    this.playerId = s.playerId; this.online = true;
    await this.pull();
    await this.flush();
    /* Доска нужна экрану рейтинга, а не старту: тянем в фоне, экран сам
     * перерисуется, когда данные придут. */
    this.leaderboard().catch(() => {});
    /* TMA часто живёт в фоне: досылаем очередь при возврате на экран. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!this.online) this.boot(); else { this.flush(); this.leaderboard().catch(() => {}); }
    });
  },

  /* Реальная доска сервера. Пока её нет — экран показывает локальный список,
   * поэтому запрос никогда не блокирует рендер. Кэш на минуту: ходить между
   * экранами не должно значить ходить в сеть.
   * Ответ зависит от того, кто спрашивает: со своим токеном сервер добавляет
   * строку «me». Поэтому кэш привязан к состоянию входа — иначе доска, которую
   * успел запросить холодный экран до логина, до минуты оставалась бы без
   * своей строки. Ответ, пришедший позже более свежего запроса, отбрасывается. */
  board: null, boardAt: 0, boardAuth: false, boardSeq: 0, boardSubs: [],
  onBoard(fn) {
    this.boardSubs.push(fn);
    return () => { this.boardSubs = this.boardSubs.filter((f) => f !== fn); };
  },
  async leaderboard(limit = 20) {
    if (!Api.enabled) return null;
    const authed = !!Api.session();
    if (this.board && this.boardAuth === authed && Date.now() - this.boardAt < 60000) return this.board;
    const seq = ++this.boardSeq;
    const r = await Api.request(`/api/client/v1/leaderboard?limit=${limit}`);
    if (seq !== this.boardSeq) return this.board;
    if (!r.ok || !r.json) return this.board;
    this.online = true;
    this.boardAuth = authed;
    this.board = { entries: r.json.entries || [], me: r.json.me || null, at: Date.now() };
    this.boardAt = Date.now();
    /* Экран мог нарисоваться раньше ответа — подписчики перерисуют себя сами. */
    this.boardSubs.slice().forEach((fn) => { try { fn(this.board); } catch (e) {} });
    return this.board;
  },

  /** Отправка очереди. Останавливается на обрыве сети, а не теряет записи. */
  async flush() {
    if (!Api.enabled || !this.online) return;
    let list = this.q();
    while (list.length) {
      const item = list[0];
      const path = item.k === 'match' ? '/api/client/v1/matches' : '/api/client/v1/progress/level-complete';
      const r = await Api.request(path, { method: 'POST', body: item.body, idem: item.id });
      if (r.offline) { this.online = false; return; }
      /* 422 — сервер счёл факт неправдоподобным; 409 — ключ занят другим
       * телом. Держать такую запись в очереди нельзя: она заклинит всё,
       * что стоит за ней. Такие факты отбрасываем и идём дальше. */
      if (r.status === 409 || r.status === 422) { list.shift(); this.saveQ(list); continue; }
      if (!r.ok) { this.online = r.status < 500; return; }
      list.shift(); this.saveQ(list);
      /* Ответ на последний факт — это и есть всё, что сервер знает: только
       * теперь его рейтинг точный. */
      if (r.json && r.json.progress) this.merge(r.json.progress, !list.length);
    }
  }
};
