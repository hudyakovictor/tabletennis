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

  /** Серверные числа не откатывают локальные: офлайн-игра могла уйти вперёд. */
  merge(p) {
    if (!p) return;
    const take = (key, field) => {
      const v = Number(p[key]);
      if (Number.isFinite(v) && v > (Number(S[field]) || 0)) S[field] = v;
    };
    take('level', 'level'); take('rating', 'rating'); take('wins', 'wins');
    take('losses', 'losses'); take('streak', 'streak'); take('bestRally', 'bestRally');
    take('coins', 'coins'); take('gems', 'gems');
    save();
  },

  async pull() {
    const r = await Api.request('/api/client/v1/me');
    if (r.offline) { this.online = false; return; }
    if (!r.ok || !r.json) return;
    this.online = true;
    this.playerId = r.json.player && r.json.player.playerId;
    this.merge(r.json.progress);
  },

  async boot() {
    if (!Api.enabled || this.ready) return;
    this.ready = true;
    const s = await Api.login();
    /* SDK Telegram грузится async: если initData ещё нет, следующий вызов
     * (load, возврат в фокус) попробует снова, а игра в это время локальна. */
    if (!s) { this.ready = false; return; }
    this.playerId = s.playerId; this.online = true;
    await this.pull();
    await this.flush();
    /* TMA часто живёт в фоне: досылаем очередь при возврате на экран. */
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!this.online) this.boot(); else this.flush();
    });
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
      if (r.json && r.json.progress) this.merge(r.json.progress);
      list.shift(); this.saveQ(list);
    }
  }
};
