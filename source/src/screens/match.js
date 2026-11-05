Router.def('match', {
  full: true, mood: 'battle', game: true,
  render() {
    const o = PEOPLE[BATTLE.opp]; const T = TARGET[MODE.id] || 11;
    const free = MODE.id === 'free';
    const text = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    return `<div class="mx cine">
      <div class="mx-bars"><i></i><i></i></div>
      <div class="m-vig"></div>
      <div class="match-hud-slot"></div>
      <div class="match-actions pe">
        ${UI.notificationButton('m-notifications')}
        <button class="ib m-slowmo" data-act="slowmo" aria-label="${t('match.slowmo')}" title="${t('match.slowmo')}" aria-pressed="false">${Art.icon('clock', { c: 'currentColor', fill: 'none', sw: 2 })}<span>${t('match.slowmo')}</span></button>
        <button class="ib m-pause" data-act="pause" aria-label="${t('match.pause')}" title="${t('match.pause')}">${Art.icon('pause', { c: 'currentColor', fill: 'none', sw: 2.6 })}</button>
      </div>
      <button class="ib m-diag-shot pe" data-act="diag-mark" ${GameHost.debug ? '' : 'hidden'} aria-label="${t('debug.mark')}"><span aria-hidden="true">●</span> ${t('debug.mark')}</button>
      ${devBtn()}
      <div class="mx-intro">
        <div class="lt op" style="--c1:${o.c[0]};--c2:${o.c[1]}"><span><small>${text(o.club)} · ${fmt(o.r)}</small><b>${text(o.n)}</b></span></div>
        <div class="mx-chip"><span>${t(MODE.tk)}</span><b>${free ? t('match.freeNoScore') : t('match.matchTo', { n: T })}</b></div>
        <div class="lt me" style="--c1:#FF7A4D;--c2:#B4161E"><span><small>${text(S.club)} · ${fmt(S.rating)}</small><b>${text(S.name)}</b></span></div>
      </div>
      <div class="vs-count mx-count"></div>
    </div>`;
  },
  mount(el) {
    BATTLE.t0 = Date.now();
    TGX.fullscreen(true);                // застрять в иммерсиве можно и без жеста — хуже не станет
    TGX.guard(true);                     // не дать случайно закрыть приложение среди розыгрыша
    this.el = el; this.alive = true; this.timers = [];
    this.hudSnapshot = null;
    this.hud = MatchHUD.mount(el.querySelector('.match-hud-slot'), this.hudOptions());
    const st = this.st = { p: 0, o: 0, server: 0, over: false, hits: 0, perfect: 0, smash: 0, maxRally: 0, myServes: 0, live: false, spin: 0, oppHits: 0, rallyHits: 0, servePts: 0, serveWon: 0, seq: [] };
    GameHost.ensure(); GameHost.show(true); GameHost.send('quiet', { on: true }); GameHost.send('mute', { on: !S.sfx });
    this.off = GameHost.on((m) => this.onMsg(m));
    el.querySelector('[data-act=pause]').addEventListener('click', () => this.pause());
    el.querySelector('[data-act=notifications]').addEventListener('click', () => {
      if (!this.st.live || this.st.over || Sheet.cur) return;
      GameHost.send('pause'); UI.openNotifications({ readOnly: true }); this.watchSheets();
    });
    el.querySelector('[data-act=diag-mark]').addEventListener('click', diagnosticMarkFrame);
    /* The engine confirms the effective inspector state and mode restrictions. */
    const smBtn = el.querySelector('[data-act=slowmo]');
    smBtn.addEventListener('click', () => {
      if (smBtn.disabled || !GameHost.inspector?.allowed) return;
      smBtn.disabled = true;
      GameHost.send('slowmo', { on: !GameHost.inspector.effective }); haptic('select'); Sfx.soft();
    });
    const dv = el.querySelector('[data-act=dev]'); if (dv) dv.addEventListener('click', () => devZoneSheet());
    this.syncSlowmo();
    this.intro();
  },
  syncSlowmo() {
    const button = this.el && this.el.querySelector('.m-slowmo'); if (!button) return;
    const inspector = GameHost.inspector;
    button.disabled = !GameHost.calibrationReady || !inspector?.allowed;
    button.classList.toggle('on', !!inspector?.effective); button.setAttribute('aria-pressed', String(!!inspector?.effective));
  },
  hudOptions() {
    return { t, strokeCatalog: GameHost.strokeCatalog || [], names: [S.name, PEOPLE[BATTLE.opp].s],
      botLevel: t(diffOf(S.diff).tk), reducedMotion: effectiveReducedMotion(), reason: REASON };
  },
  refreshLocale(el) {
    I18n.localizeDOM(el, this.render()); this.syncSlowmo();
    if (this.hudSnapshot) this.hud.update(this.hudSnapshot, this.hudOptions());
    return true;
  },
  later(fn, ms) { const t = setTimeout(() => this.alive && fn(), ms); this.timers.push(t); return t; },
  async intro() {
    const el = this.el, mx = el.querySelector('.mx'), intro = el.querySelector('.mx-intro');
    GameHost.send('prematch', { dur: 3.1 });
    await sleep(120); if (!this.alive) return;
    mx.classList.add('bars'); Sfx.whoosh();
    await sleep(380); if (!this.alive) return;
    intro.classList.add('a'); Sfx.impact(); haptic('medium');
    await sleep(520); if (!this.alive) return;
    intro.classList.add('b'); Sfx.soft();
    await sleep(520); if (!this.alive) return;
    intro.classList.add('c'); Sfx.impact(); haptic('medium');
    await sleep(1250); if (!this.alive) return;
    intro.classList.add('out');
    const c = el.querySelector('.mx-count');
    /* отсчёт — ЧЕСТНЫЕ секунды: раньше тикал каждые 560 мс и «3-2-1»
     * пролетал в 1.8 раза быстрее, чем считает человек */
    for (const n of ['3', '2', '1']) { c.innerHTML = `<b>${n}</b>`; Sfx.count(1); haptic('medium'); await sleep(980); if (!this.alive) return; }
    c.innerHTML = `<b class="go">${t('match.go')}</b>`; Sfx.count(0); haptic('heavy'); flash('#fff', .25, 260);
    /* free: движок держит freePlay — очки разыгрываются, счёт не растёт.
       Уровень бота (S.diff) и тренд последних матчей уходят в движок явно:
       бот больше не захардкожен на «ПРО», а форма игрока не двигает уровень
       целиком — только ±4 % агрессии/точности между матчами. */
    GameHost.send('match', { diff: clamp(Math.round(S.diff ?? 1), 0, 3), trend: aiTrend(), target: TARGET[MODE.id] || 11, hint: !!S.hint, free: MODE.id === 'free' });
    GameHost.send('quiet', { on: false });
    mx.classList.remove('bars', 'cine'); mx.classList.add('live'); this.st.live = true;
    await sleep(520); c.innerHTML = '';
  },
  onMsg(m) {
    if (this.alive && ['ready', 'settings', 'calibration', 'slowmo', 'calibrationPending', 'sessionKind'].includes(m.type)) this.syncSlowmo();
    if (this.alive && m.type === 'hud') {
      this.hudSnapshot = m.snapshot;
      this.hud.update(m.snapshot, this.hudOptions());
      this.st.p = m.snapshot.score[0]; this.st.o = m.snapshot.score[1];
      return;
    }
    if (this.alive && this.hudSnapshot && ['ready', 'settings', 'motionPreference'].includes(m.type))
      this.hud.update(this.hudSnapshot, this.hudOptions());
    const el = this.el, st = this.st; if (!this.alive || st.over && m.type !== 'replayEnd' && m.type !== 'matchEnd') return;
    if (m.type === 'serve') {
      st.server = m.server;
      if (m.server > 0) st.myServes++;
    }
    if (m.type === 'hit') {
      if (m.by > 0) {
        st.hits++;
        if (SPIN_STROKES.has(m.stroke)) st.spin++; if (m.rally > 1) st.rallyHits++;
        /* В момент удара — НИКАКИХ эффектов поверх кадра: всплески, кольца и
         * стикеры ("ИДЕАЛЬНО!", км/ч) — визуальная плата ровно там, где глаз
         * держит мяч. Вердикт и подпись уже есть в самой игре (след мяча +
         * сообщение). Каламбур в руке (haptic) остаётся — он не тратит взгляд. */
        if (m.sweet >= .8) { st.perfect++; haptic('heavy'); }
        if (m.stroke === 'SMASH' || m.kmh >= 70) st.smash++;
      }
      else st.oppHits++;
    }
    if (m.type === 'point') {
      st.maxRally = Math.max(st.maxRally, m.rally || 0);
      const win = m.who > 0; st.p = m.score[0]; st.o = m.score[1]; st.seq.push(win ? 1 : -1);
      if (st.server > 0) { st.servePts++; if (win) st.serveWon++; }
      if (win) {
        Sfx.point(); haptic('success');
      } else {
        Sfx.lose(); haptic('error');
      }
    }
    if (m.type === 'paused' && m.v && !m.host && !Sheet.cur && !st.over) this.pause(true);
    /* В свободной игре движок матч не завершает — но если придёт, показывать
       итог с нулевым счётом нельзя. */
    if (m.type === 'matchEnd' && MODE.id !== 'free') this.finish(m);
  },
  pause(fromGame) {
    if (this.st.over) return;
    GameHost.send('pause');
    const free = MODE.id === 'free';
    Sheet.open(`<div class="h1" style="margin:4px 4px 6px">${t('match.pause')}</div><p class="dim" style="margin:0 4px 16px;font-size:12.5px">${free ? t('match.freePause') : t('match.pauseScore', { p: this.st.p, o: this.st.o })}</p>
      <div style="display:grid;gap:12px"><button class="b3 green block" data-a="resume"><span class="shine"></span>${Art.icon('play', { c: '#fff' })}${t('common.resume')}</button>
      <button class="b3 dark block" data-a="screenshot">${t('debug.screenshot')}</button>
      <button class="b3 dark block" data-a="diagnostics">${t('debug.title')}</button>
      <button class="b3 dark block" data-a="train">${Art.icon('target', { c: '#fff' })}${t('match.training')}</button>
      <button class="b3 dark block" data-a="settings">${Art.icon('gear', { c: '#fff' })}${t('nav.settings')}</button>
      <button class="b3 coral block sm" data-a="quit">${free ? t('match.exitFree') : t('match.surrender')}</button></div>`, {
      onOpen: (w) => w.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'resume') Sheet.close();
        if (a.dataset.a === 'settings') openSettings();
        if (a.dataset.a === 'screenshot') diagnosticsSheet({ focusScreenshot: true });
        if (a.dataset.a === 'diagnostics') diagnosticsSheet();
        if (a.dataset.a === 'train') { this.st.over = true; Sheet.close(true); Router.go('train', { data: { then: 'hub' } }); }
        if (a.dataset.a === 'quit') {
          Sheet.close(true);
          if (free) this.exitFree();
          else this.finish({ won: false, quit: true, score: [this.st.p, this.st.o] });
        }
      })
    });
    this.watchSheets();
  },
  /* Движок снимается с паузы, только когда закрылись ВСЕ листы. Лист настроек
     заменяет лист паузы — раньше это молча запускало розыгрыш под настройками. */
  watchSheets() {
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    const host = $('#sheets'); if (!host) return;
    this._mo = new MutationObserver(() => {
      if (!Sheet.cur && !this.st.over && this.alive) {
        this._mo.disconnect(); this._mo = null;
        GameHost.send('mute', { on: !S.sfx }); GameHost.send('hint', { on: !!S.hint }); GameHost.send('resume');
      }
    });
    this._mo.observe(host, { childList: true });
  },
  async finish(m) {
    const st = this.st; if (st.done) return; st.over = true; st.done = true;
    TGX.guard(false);
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    const el = this.el, mx = el.querySelector('.mx'); const win = !!m.won;
    const res = { win, me: m.score ? m.score[0] : st.p, op: m.score ? m.score[1] : st.o, opp: BATTLE.opp,
      /* Длительность и режим — факты для сервера: он проверяет правдоподобие
       * и сам считает рейтинг, а не верит присланному «я выиграл». */
      durationMs: Math.max(0, Date.now() - (BATTLE.t0 || Date.now())),
      mode: (MODE && MODE.id) || 'career',
      stats: { hits: st.hits, perfect: st.perfect, smash: st.smash, maxRally: Math.max(st.maxRally, m.bestRally || 0),
        acc: m.stats && m.stats.shots ? clamp(Math.round(100 - (m.stats.errors || 0) / Math.max(1, m.stats.shots) * 100), 0, 100) : 0 },
      coach: ZoneStats.matchSummary(BATTLE.t0 || 0, win) };
    res.seq = st.seq.slice();                                     // для графика «Ход матча»
    res.stats.maxSpeed = (m.stats && m.stats.maxSpeed) || 0;      // км/ч, идёт из движка
    res.stats.winners = (m.stats && m.stats.winners) || 0;        // чистые победные игрока
    if (!m.quit) { ZoneStats.logMatch(res.coach, win); res.unlocked = Career.record(st, win, res.coach);
      res.quests = Daily.tick(res, win);                          // миссии дня, закрытые ЭТИМ матчем
    }
    if (m.quit) { Router.go('result', { data: res }); return; }
    GameHost.send('outro');
    mx.classList.add('cine', 'bars'); mx.classList.remove('live');
    await sleep(700); if (!this.alive) return;
    const b = document.createElement('div'); b.className = 'm-final ' + (win ? 'win' : 'lose');
    b.innerHTML = `<div><b class="h-display">${win ? t('result.win') : t('result.lose')}</b><small class="num">${res.me} : ${res.op}</small></div>`; mx.appendChild(b);
    win ? (Sfx.win(), haptic('success'), flash('#FFE680', .45), FX.confetti(FX.W / 2, FX.H * .42, 120, 1.2)) : (Sfx.lose(), haptic('error'));
    await sleep(2300); if (!this.alive) return;
    if (m.hasReplay) {
      b.classList.add('out');
      const r = document.createElement('div'); r.className = 'mx-replay';
      r.innerHTML = `<span class="rec"><i></i>${t('match.replay', { n: res.stats.maxRally })}</span><button class="b3 dark sm pe" data-a="skip">${t('common.next')} ›</button>`; mx.appendChild(r);
      const done = new Promise((ok) => {
        const finish = this.replayResolve = () => { this.replayOff?.(); this.replayOff = null; this.replayResolve = null; ok(); };
        this.replayOff = GameHost.on((x) => { if (x.type === 'replayEnd') finish(); });
        r.querySelector('[data-a=skip]').addEventListener('click', () => { GameHost.send('skipReplay'); finish(); });
        this.later(finish, 16000);
      });
      GameHost.send('replay');
      await done; if (!this.alive) return;
    }
    Router.go('result', { data: res });
  },
  /* Свободная игра заканчивается только выходом: ни итога, ни рейтинга, ни
     миссий — просто назад в хаб. */
  exitFree() {
    const st = this.st; if (st.done) return; st.over = true; st.done = true;
    TGX.guard(false);
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    toast(t('match.freeExitToast'), 'target');
    Router.go('hub');
  },
  leave() {
    this.alive = false; this.off && this.off(); this.timers.forEach(clearTimeout);
    this.hud?.dispose(); this.hud = null; this.hudSnapshot = null;
    this.replayResolve?.(); this.replayOff?.(); this.replayOff = null; this.replayResolve = null;
    TGX.guard(false);
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    // fullscreen НЕ выключаем — весь путь (поиск → матч → итог) живёт в иммерсиве
    GameHost.send('slowmo', { on: false });
    GameHost.send('quit'); GameHost.show(false);
  },
  onBack() { if (!this.st.over) this.pause(); }
});

/* ---------------- ОБУЧЕНИЕ ----------------
   Наставник живёт в движке: первый мяч замирает в точке удара, кольцо
   показывает честный размер зоны, «призрачный палец» показывает свайп.
   Эта карточка — только текст и прогресс. */
