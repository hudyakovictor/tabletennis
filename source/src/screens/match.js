Router.def('match', {
  full: true, mood: 'battle', game: true,
  render() {
    const o = PEOPLE[BATTLE.opp]; const T = TARGET[MODE.id] || 11;
    return `<div class="mx cine">
      <div class="mx-bars"><i></i><i></i></div>
      <div class="m-vig"></div>
      <div class="sb safe-top">
        <div class="sb-in">
          <div class="sbp me">${Art.avatar('me', 38)}<span class="sbn"><b>${S.name.split(' ')[0]}</b><i class="srv" data-srv="1">${t('match.serve')}</i></span></div>
          <div class="sbs"><span class="d me num" id="scP">0</span><span class="colon">:</span><span class="d op num" id="scO">0</span></div>
          <div class="sbp op"><span class="sbn r"><b>${o.s.split(' ').pop()}</b><i class="srv" data-srv="-1">${t('match.serve')}</i></span>${Art.avatar('p' + BATTLE.opp, 38)}</div>
        </div>
        <div class="sb-sub"><span class="cap">${t(MODE.tk)} · ${t('match.to', { n: T })}</span></div>
      </div>
      <button class="ib m-pause pe" data-act="pause" aria-label="${t('match.pause')}">${Art.icon('pause', { c: '#fff', sw: 2.6 })}</button>
      <button class="ib m-slowmo pe" data-act="slowmo" aria-label="${t('match.slowmo')}" aria-pressed="false">${Art.icon('clock', { c: '#fff', sw: 2.4 })}<span>${t('match.slowmo')}</span></button>
      ${devBtn()}
      <div class="m-rally"><span>${t('match.rally')}</span><b class="num">×0</b></div>
      <div class="m-banner"></div>
      <div class="mx-srv"></div>
      <div class="m-serve">${Art.icon('paddle', { c: '#FFB3A6' })}<span>${t('match.serveHint')}</span></div>
      <div class="mx-intro">
        <div class="lt op" style="--c1:${o.c[0]};--c2:${o.c[1]}">${Art.avatar('p' + BATTLE.opp, 56)}<span><small>${o.club} · ${fmt(o.r)}</small><b>${o.n}</b></span></div>
        <div class="mx-chip"><span>${t(MODE.tk)}</span><b>${t('match.matchTo', { n: T })}</b></div>
        <div class="lt me" style="--c1:#FF7A4D;--c2:#B4161E"><span><small>${S.club} · ${fmt(S.rating)}</small><b>${S.name}</b></span>${Art.avatar('me', 56)}</div>
      </div>
      <div class="vs-count mx-count"></div>
    </div>`;
  },
  mount(el) {
    BATTLE.t0 = Date.now();
    TGX.fullscreen(true);                // застрять в иммерсиве можно и без жеста — хуже не станет
    TGX.guard(true);                     // не дать случайно закрыть приложение среди розыгрыша
    this.el = el; this.alive = true; this.timers = [];
    const st = this.st = { p: 0, o: 0, server: 0, over: false, hits: 0, perfect: 0, smash: 0, maxRally: 0, myServes: 0, live: false, spin: 0, oppHits: 0, rallyHits: 0, servePts: 0, serveWon: 0, seq: [] };
    GameHost.ensure(); GameHost.show(true); GameHost.send('quiet', { on: true }); GameHost.send('mute', { on: !S.sfx });
    this.off = GameHost.on((m) => this.onMsg(m));
    el.querySelector('[data-act=pause]').addEventListener('click', () => this.pause());
    /* Слоу-мо «разобрать траекторию»: свободный тумблер в движок; состояние
       кнопки живёт здесь, движок лишь замедляет время розыгрыша. */
    const smBtn = el.querySelector('[data-act=slowmo]');
    smBtn.addEventListener('click', () => {
      const on = smBtn.getAttribute('aria-pressed') !== 'true';
      smBtn.setAttribute('aria-pressed', String(on)); smBtn.classList.toggle('on', on);
      GameHost.send('slowmo', { on }); haptic('select'); Sfx.soft();
    });
    const dv = el.querySelector('[data-act=dev]'); if (dv) dv.addEventListener('click', () => devZoneSheet());
    this.intro();
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
    GameHost.send('match', { diff: clamp((LDIFF[leagueOf(S.rating).id] ?? 1) + (MODE.id === 'quick' ? -1 : 0) + formAdjust(), 0, 4), target: TARGET[MODE.id] || 11, hint: !!S.hint });
    GameHost.send('quiet', { on: false });
    mx.classList.remove('bars', 'cine'); mx.classList.add('live'); this.st.live = true;
    await sleep(520); c.innerHTML = '';
  },
  banner(html, cls = '', ms = 1000) {
    const b = this.el.querySelector('.m-banner'); b.className = 'm-banner ' + cls; b.innerHTML = html; void b.offsetWidth; b.classList.add('on');
    clearTimeout(this.bt); this.bt = setTimeout(() => b.classList.remove('on'), ms);
  },
  onMsg(m) {
    const el = this.el, st = this.st; if (!this.alive || st.over && m.type !== 'replayEnd' && m.type !== 'matchEnd') return;
    const serveEl = el.querySelector('.m-serve'), rallyEl = el.querySelector('.m-rally'), rallyN = rallyEl.querySelector('b');
    if (m.type === 'serve') {
      if (m.server !== st.server) {
        const c = el.querySelector('.mx-srv');
        c.className = 'mx-srv ' + (m.server > 0 ? 'me' : 'op'); c.textContent = m.server > 0 ? t('match.youServe') : t('match.oppServe');
        void c.offsetWidth; c.classList.add('on');
      }
      st.server = m.server;
      $$('.srv', el).forEach((s) => s.classList.toggle('on', +s.dataset.srv === m.server));
      if (m.server > 0) st.myServes++;
      // подсказка подачи — ТОЛЬКО когда подаёт игрок; при подаче бота всегда прячем
      if (m.server > 0 && st.myServes <= 3) serveEl.classList.add('on'); else serveEl.classList.remove('on');
    }
    if (m.type === 'hit') {
      if (m.by > 0) {
        st.hits++; serveEl.classList.remove('on');
        if (SPIN_STROKES.has(m.stroke)) st.spin++; if (m.rally > 1) st.rallyHits++;
        /* В момент удара — НИКАКИХ эффектов поверх кадра: всплески, кольца и
         * стикеры ("ИДЕАЛЬНО!", км/ч) — визуальная плата ровно там, где глаз
         * держит мяч. Вердикт и подпись уже есть в самой игре (след мяча +
         * сообщение). Каламбур в руке (haptic) остаётся — он не тратит взгляд. */
        if (m.sweet >= .8) { st.perfect++; haptic('heavy'); }
        if (m.stroke === 'SMASH' || m.kmh >= 70) st.smash++;
      }
      else st.oppHits++;
      if (m.rally >= 3) { rallyEl.classList.add('on'); rallyN.textContent = '×' + m.rally; bump(rallyN); rallyEl.classList.toggle('fire', m.rally >= 10); }
    }
    if (m.type === 'point') {
      st.maxRally = Math.max(st.maxRally, m.rally || 0); rallyEl.classList.remove('on', 'fire');
      const win = m.who > 0; st.p = m.score[0]; st.o = m.score[1]; st.seq.push(win ? 1 : -1);
      if (st.server > 0) { st.servePts++; if (win) st.serveWon++; }
      el.querySelector('#scP').textContent = st.p; el.querySelector('#scO').textContent = st.o;
      const sc = el.querySelector(win ? '#scP' : '#scO'); sc.classList.remove('flip'); void sc.offsetWidth; sc.classList.add('flip');
      const vig = el.querySelector('.m-vig');
      if (win) {
        Sfx.point(); haptic('success');
        /* очко засчитывается счётом, анимацией «flip» и баннером с причиной —
         * конфетти над цифрой посреди розыгрыша не нужны */
        const why = REASON(1, m.reason); this.banner(`<b>${t('match.point')}</b>${why ? `<small>${why}</small>` : ''}`, 'win');
      } else {
        Sfx.lose(); haptic('error'); FX.shake(5, 220);
        this.banner(`<b>${REASON(-1, m.reason)}</b><small>${t('match.pointToOpp')}</small>`, 'lose');
      }
      vig.classList.toggle('mp', !!m.matchPoint);
      if (m.matchPoint && !m.winner) this.later(() => { this.banner(`<b>${t('match.matchball')}</b><small>${m.matchPoint > 0 ? t('match.matchballSub') : t('match.matchballOpp')}</small>`, 'mp', 1300); Sfx.rise(.5); haptic('warning'); }, 1150);
    }
    if (m.type === 'paused' && m.v && !m.host && !Sheet.cur && !st.over) this.pause(true);
    if (m.type === 'matchEnd') this.finish(m);
  },
  pause(fromGame) {
    if (this.st.over) return;
    GameHost.send('pause');
    Sheet.open(`<div class="h1" style="margin:4px 4px 6px">${t('match.pause')}</div><p class="dim" style="margin:0 4px 16px;font-size:12.5px">${t('match.pauseScore', { p: this.st.p, o: this.st.o })}</p>
      <div style="display:grid;gap:12px"><button class="b3 green block" data-a="resume"><span class="shine"></span>${Art.icon('play', { c: '#fff' })}${t('common.resume')}</button>
      <button class="b3 dark block" data-a="train">${Art.icon('target', { c: '#fff' })}${t('match.training')}</button>
      <button class="b3 dark block" data-a="settings">${Art.icon('gear', { c: '#fff' })}${t('nav.settings')}</button>
      <button class="b3 coral block sm" data-a="quit">${t('match.surrender')}</button></div>`, {
      onOpen: (w) => w.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'resume') Sheet.close();
        if (a.dataset.a === 'settings') openSettings();
        if (a.dataset.a === 'train') { this.st.over = true; Sheet.close(true); Router.go('train', { data: { then: 'hub' } }); }
        if (a.dataset.a === 'quit') { Sheet.close(true); this.finish({ won: false, quit: true, score: [this.st.p, this.st.o] }); }
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
    el.querySelector('.m-serve').classList.remove('on'); el.querySelector('.m-vig').classList.remove('mp');
    clearTimeout(this.bt); this.later(() => el.querySelector('.m-banner').classList.remove('on'), 500);
    const res = { win, me: m.score ? m.score[0] : st.p, op: m.score ? m.score[1] : st.o, opp: BATTLE.opp,
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
        const off = GameHost.on((x) => { if (x.type === 'replayEnd') { off(); ok(); } });
        r.querySelector('[data-a=skip]').addEventListener('click', () => { GameHost.send('skipReplay'); off(); ok(); });
        this.later(() => { off(); ok(); }, 16000);
      });
      GameHost.send('replay');
      await done; if (!this.alive) return;
    }
    Router.go('result', { data: res });
  },
  leave() {
    this.alive = false; this.off && this.off(); this.timers.forEach(clearTimeout); clearTimeout(this.bt);
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