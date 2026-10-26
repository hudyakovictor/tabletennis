/* =====================================================================
   BATTLE LOOP — поиск → VS → матч → итог → сундук
   ===================================================================== */
let BATTLE = { opp: 0 };
const Demo = {
  result(win) { return { win, me: win ? 7 : 4, op: win ? 4 : 7, opp: 0, stats: { hits: 38, perfect: 5, smash: 3, maxRally: 12, acc: 81 } }; }
};

/* ---------------- ПОИСК СОПЕРНИКА ---------------- */
Router.def('mm', {
  full: true, mood: 'battle',
  render() {
    const L = leagueOf(S.rating);
    const reel = [...Array(24)].map((_, i) => { const k = i % 8; return `<span class="ri">${Art.avatar('p' + k, 64, { round: false })}</span>`; }).join('');
    return `<div class="mm safe-top">
      <i class="mm-ill" style="background-image:url('${ILL.radar}')"></i>
      <div class="mm-top"><span class="chip gold">${Art.icon(MODE.i, { c: '#FFE28A' })} ${MODE.t} · ${L.n}</span>
        <div class="h1 mm-t">Поиск соперника<span class="dots"><i>.</i><i>.</i><i>.</i></span></div>
        <div class="mm-time num">0:00</div></div>
      <div class="radar">
        <div class="rg r1"></div><div class="rg r2"></div><div class="rg r3"></div>
        <div class="sweep"></div>
        ${[...Array(6)].map((_, i) => `<span class="blip" style="--a:${i * 61 + 20}deg;--r:${60 + (i % 3) * 34}px;--dl:${i * .4}s"></span>`).join('')}
        <div class="me">${Art.avatar('me', 96)}</div>
      </div>
      <div class="reel"><div class="strip">${reel}</div><div class="reel-frame"></div></div>
      <div class="found"><span class="cap">Соперник найден</span><b class="h2"></b></div>
      <div class="mm-tip pnl inset"><span>${Art.icon('info', { c: '#9BE8FF' })}</span><p>Смахни вверх в момент удара — <b>идеальный удар</b> с замедлением и усиленным вращением.</p></div>
      <button class="b3 dark sm mm-cancel" data-act="cancel">Отмена</button>
    </div>`;
  },
  mount(el) {
    const t0 = Date.now(); const tm = el.querySelector('.mm-time');
    this.iv = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); tm.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 250);
    /* one soft blip as the search starts — a repeating sonar out of context
       reads as a broken smoke detector */
    this.sonar = setTimeout(() => Sfx.soft(), 350);
    el.querySelector('[data-act=cancel]').addEventListener('click', () => { this.cancelled = true; Router.go('hub'); });
    this.cancelled = false;
    GameHost.ensure(); GameHost.send('attract');
    BATTLE = { opp: MODE.id === 'friend' ? 0 : pick(MM_POOL[leagueOf(S.rating).id] || MM_POOL.bronze) };
    (async () => {
      await sleep(2300); if (this.cancelled) return;
      clearInterval(this.sonar);
      el.querySelector('.mm').classList.add('rolling');
      const strip = el.querySelector('.strip'); const item = 76; const target = 16 + BATTLE.opp; // индекс карточки соперника
      const reelW = el.querySelector('.reel').clientWidth;
      const endX = -(target * item - reelW / 2 + item / 2);
      let last = 0; const dur = 2100; const st = performance.now();
      await new Promise((res) => { const f = (now) => { const t = clamp((now - st) / dur, 0, 1); const e = 1 - Math.pow(1 - t, 4); const x = endX * e; strip.style.transform = `translateX(${x}px)`; const idx = Math.floor(-x / item); if (idx !== last) { last = idx; Sfx.tick(); haptic('select'); } if (t < 1) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
      if (this.cancelled) return;
      const card = strip.children[target]; card.classList.add('win');
      const p = FX.pt(card); FX.burst(p.x, p.y, { c: ['#2EE6FF', '#fff', '#FFC93A'], count: 36, speed: 12, size: 1.2 }); FX.shake(8, 300); Sfx.impact(); haptic('heavy'); flash('#7DF3FF', .4);
      const o = PEOPLE[BATTLE.opp]; const f = el.querySelector('.found'); f.querySelector('b').textContent = o.n; f.classList.add('on');
      await sleep(1100); if (this.cancelled) return;
      Router.go('vs');
    })();
  },
  leave() { clearInterval(this.iv); clearInterval(this.sonar); this.cancelled = true; },
  onBack() { this.cancelled = true; Router.go('hub'); }
});

/* ---------------- VS ---------------- */
Router.def('vs', {
  full: true, mood: 'battle',
  render() {
    const o = PEOPLE[BATTLE.opp]; const Lo = leagueOf(o.r), Lm = leagueOf(S.rating);
    const stat = (l, a, b) => `<div class="vs-st"><b class="num">${a}</b><span>${l}</span><b class="num">${b}</b><i style="--a:${a / (a + b)}"></i></div>`;
    return `<div class="vs">
      <div class="vs-half top" style="--c1:${o.c[0]};--c2:${o.c[1]}">
        <div class="vs-art">${Art.avatar('p' + BATTLE.opp, 210, { round: false })}</div>
        <div class="vs-info"><span class="vs-badge">${Art.badge(Lo, 44)}</span><b class="h-display">${o.s}</b><span class="mut">${o.club} · <b class="num">${fmt(o.r)}</b></span></div>
      </div>
      <div class="vs-half bot" style="--c1:#FF7A4D;--c2:#B4161E">
        <div class="vs-art">${Art.avatar('me', 210, { round: false })}</div>
        <div class="vs-info"><span class="vs-badge">${Art.badge(Lm, 44)}</span><b class="h-display">${S.name.split(' ')[0]}</b><span class="mut">${S.club} · <b class="num">${fmt(S.rating)}</b></span></div>
      </div>
      <div class="vs-mid"><div class="vs-logo"><span class="v">V</span><span class="s">S</span></div></div>
      <div class="vs-stats pnl">${stat('Винрейт %', Math.round(S.wins / (S.wins + S.losses) * 100), o.wr)}${stat('Серия', S.streak, 2)}${stat('Лучший розыгрыш', S.bestRally, 19)}</div>
    </div>`;
  },
  mount(el) {
    const vs = el.querySelector('.vs'); this.alive = true;
    (async () => {
      await sleep(80); vs.classList.add('in'); Sfx.whoosh();
      await sleep(520); if (!this.alive) return;
      vs.classList.add('slam'); Sfx.impact(); haptic('heavy'); FX.shake(18, 520); flash('#fff', .7);
      const p = FX.pt(el.querySelector('.vs-logo')); FX.burst(p.x, p.y, { c: ['#FFC93A', '#FF4B3E', '#2EE6FF', '#fff'], count: 50, speed: 15, size: 1.6 }); FX.ring(p.x, p.y, '#fff', 220, 10);
      await sleep(500); if (!this.alive) return; vs.classList.add('stats');
      await sleep(1700); if (!this.alive) return;
      Router.go('match');
    })();
  },
  leave() { this.alive = false; },
  onBack() { this.alive = false; Router.go('hub'); }
});

/* ---------------- МАТЧ (настоящий движок TOPSPIN ARENA в iframe) ----------------
   Хореография: кинематографические полосы → облёт камеры к столу с плашками
   игроков → 3-2-1 «Игра!» → матч → «Победа/Поражение» с облётом победителя →
   лучший розыгрыш (повтор) → итог. Счёт, баннеры и пауза — в дизайне v2. */
const REASON = (who, r) => {
  r = String(r || '').toUpperCase();
  if (who > 0) {
    if (r.includes('НЕ ДОСТАЛ')) return 'соперник не достал';
    if (r.includes('ПЕРЕЛЕТ') || r.includes('СЕТК')) return 'соперник в сетку';
    if (r.includes('АУТ')) return 'аут соперника';
    if (r.includes('ПОДАЧ')) return 'ошибка подачи соперника';
    return '';
  }
  if (r.includes('НЕ ДОСТАЛ') || r.includes('ПРОПУС')) return 'Не достал';
  if (r.includes('ПЕРЕЛЕТ') || r.includes('СЕТК')) return 'Сетка';
  if (r.includes('АУТ')) return 'Аут';
  if (r.includes('ПОДАЧ')) return 'Ошибка подачи';
  return 'Мимо';
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
const devBtn = () => (DEVMODE ? `<button class="ib mx-dev pe" data-act="dev" aria-label="Зона удара">${Art.icon('target', { c: '#9BE8FF', sw: 2.4 })}</button>` : '');

Router.def('match', {
  full: true, mood: 'battle', game: true,
  render() {
    const o = PEOPLE[BATTLE.opp]; const T = TARGET[MODE.id] || 11;
    return `<div class="mx cine">
      <div class="mx-bars"><i></i><i></i></div>
      <div class="m-vig"></div>
      <div class="sb safe-top">
        <div class="sb-in">
          <div class="sbp me">${Art.avatar('me', 38)}<span class="sbn"><b>${S.name.split(' ')[0]}</b><i class="srv" data-srv="1">ПОДАЧА</i></span></div>
          <div class="sbs"><span class="d me num" id="scP">0</span><span class="colon">:</span><span class="d op num" id="scO">0</span></div>
          <div class="sbp op"><span class="sbn r"><b>${o.s.split(' ').pop()}</b><i class="srv" data-srv="-1">ПОДАЧА</i></span>${Art.avatar('p' + BATTLE.opp, 38)}</div>
        </div>
        <div class="sb-sub"><span class="cap">${MODE.t} · до ${T}</span></div>
      </div>
      <button class="ib m-pause pe" data-act="pause" aria-label="Пауза">${Art.icon('pause', { c: '#fff', sw: 2.6 })}</button>
      ${devBtn()}
      <div class="m-rally"><span>Розыгрыш</span><b class="num">×0</b></div>
      <div class="m-banner"></div>
      <div class="mx-srv"></div>
      <div class="m-serve">${Art.icon('paddle', { c: '#FFB3A6' })}<span>Твоя подача: <b>коснись</b> — подброс,<br>затем <b>смахни вверх</b> по мячу</span></div>
      <div class="mx-intro">
        <div class="lt op" style="--c1:${o.c[0]};--c2:${o.c[1]}">${Art.avatar('p' + BATTLE.opp, 56)}<span><small>${o.club} · ${fmt(o.r)}</small><b>${o.n}</b></span></div>
        <div class="mx-chip"><span>${MODE.t}</span><b>Матч до ${T}</b></div>
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
    c.innerHTML = '<b class="go">Игра!</b>'; Sfx.count(0); haptic('heavy'); flash('#fff', .25, 260);
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
        c.className = 'mx-srv ' + (m.server > 0 ? 'me' : 'op'); c.textContent = m.server > 0 ? 'Подаёшь ты' : 'Подаёт соперник';
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
        const why = REASON(1, m.reason); this.banner(`<b>Очко!</b>${why ? `<small>${why}</small>` : ''}`, 'win');
      } else {
        Sfx.lose(); haptic('error'); FX.shake(5, 220);
        this.banner(`<b>${REASON(-1, m.reason)}</b><small>очко сопернику</small>`, 'lose');
      }
      vig.classList.toggle('mp', !!m.matchPoint);
      if (m.matchPoint && !m.winner) this.later(() => { this.banner(m.matchPoint > 0 ? '<b>Матчбол</b><small>одно очко до победы</small>' : '<b>Матчбол</b><small>у соперника</small>', 'mp', 1300); Sfx.rise(.5); haptic('warning'); }, 1150);
    }
    if (m.type === 'paused' && m.v && !m.host && !Sheet.cur && !st.over) this.pause(true);
    if (m.type === 'matchEnd') this.finish(m);
  },
  pause(fromGame) {
    if (this.st.over) return;
    GameHost.send('pause');
    Sheet.open(`<div class="h1" style="margin:4px 4px 6px">Пауза</div><p class="dim" style="margin:0 4px 16px;font-size:12.5px">Счёт ${this.st.p}:${this.st.o}. Соперник ждёт.</p>
      <div style="display:grid;gap:12px"><button class="b3 green block" data-a="resume"><span class="shine"></span>${Art.icon('play', { c: '#fff' })}Продолжить</button>
      <button class="b3 dark block" data-a="train">${Art.icon('target', { c: '#fff' })}Обучение</button>
      <button class="b3 dark block" data-a="settings">${Art.icon('gear', { c: '#fff' })}Настройки</button>
      <button class="b3 coral block sm" data-a="quit">Сдаться</button></div>`, {
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
    b.innerHTML = `<div><b class="h-display">${win ? 'Победа' : 'Поражение'}</b><small class="num">${res.me} : ${res.op}</small></div>`; mx.appendChild(b);
    win ? (Sfx.win(), haptic('success'), flash('#FFE680', .45), FX.confetti(FX.W / 2, FX.H * .42, 120, 1.2)) : (Sfx.lose(), haptic('error'));
    await sleep(2300); if (!this.alive) return;
    if (m.hasReplay) {
      b.classList.add('out');
      const r = document.createElement('div'); r.className = 'mx-replay';
      r.innerHTML = `<span class="rec"><i></i>Повтор · ×${res.stats.maxRally}</span><button class="b3 dark sm pe" data-a="skip">Дальше ›</button>`; mx.appendChild(r);
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
    GameHost.send('quit'); GameHost.show(false);
  },
  onBack() { if (!this.st.over) this.pause(); }
});

/* ---------------- ОБУЧЕНИЕ ----------------
   Наставник живёт в движке: первый мяч замирает в точке удара, кольцо
   показывает честный размер зоны, «призрачный палец» показывает свайп.
   Эта карточка — только текст и прогресс. */
Router.def('train', {
  full: true, mood: 'battle', game: true,
  render(d) {
    return `<div class="mx tx cine">
      <div class="mx-bars"><i></i><i></i></div>
      <div class="tc safe-top">
        <div class="tc-in">
          <div class="tc-h"><span class="tc-step num">1/6</span><b class="tc-title">Обучение</b><span class="tc-dots"></span></div>
          <p class="tc-text">Мяч летит к тебе…</p>
          <div class="tc-hold"><i></i>Мяч ждёт тебя</div>
        </div>
        <div class="tc-msg"></div>
      </div>
      <button class="ib m-pause pe" data-act="exit" aria-label="Выйти">${Art.icon('x', { c: '#fff', sw: 2.6 })}</button>
      <button class="b3 dark sm tx-skip pe" data-act="skip">Пропустить шаг ›</button>
      ${devBtn()}
      <div class="tx-done"><div class="pnl tx-card">
        <span class="tx-cup">${Art.icon('crown', { c: '#FFE28A', sw: 2.2 })}</span>
        <b class="h-display">Готов к матчу!</b>
        <p>Удар, направление, подача и вращение — всё на месте.</p>
        <div class="tx-reward"><span class="cap">Награда за обучение</span>
          <div class="tx-rw"><div class="cur" data-cur="coins"><span class="ci">${Art.coin(30)}</span><span class="v num">${fmt(S.coins)}</span></div>
          <div class="cur" data-cur="gems"><span class="ci">${Art.gem(28)}</span><span class="v num">${fmt(S.gems)}</span></div></div>
          <div class="tx-rw-plus"><b class="num">+200</b><b class="num g">+5</b></div></div>
        <div style="display:grid;gap:10px;margin-top:16px"><button class="b3 xl play pe" data-a="go"><span class="shine"></span>${Art.icon('swords', { c: '#3A1A00', sw: 2.6 })}В бой</button>
        <button class="b3 dark sm pe" data-a="again">Пройти ещё раз</button></div>
      </div></div>
    </div>`;
  },
  mount(el, d) {
    TGX.fullscreen(true);
    TGX.guard(true);
    this.el = el; this.data = d || {}; this.alive = true; this.last = {};
    GameHost.ensure(); GameHost.show(true); GameHost.send('quiet', { on: true }); GameHost.send('mute', { on: !S.sfx });
    this.off = GameHost.on((m) => this.onMsg(m));
    el.querySelector('[data-act=exit]').addEventListener('click', () => this.exit());
    el.querySelector('[data-act=skip]').addEventListener('click', () => { GameHost.send('skipStep'); haptic('select'); });
    const dv = el.querySelector('[data-act=dev]'); if (dv) dv.addEventListener('click', () => devZoneSheet());
    el.querySelector('.tx-done').addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'go') { const p = FX.pt(a); FX.burst(p.x, p.y, { count: 30, speed: 11 }); haptic('heavy'); Router.go('mm'); }
      if (a.dataset.a === 'again') { el.querySelector('.tx-done').classList.remove('on'); GameHost.send('train', { step: 0 }); }
    });
    (async () => {
      const mx = el.querySelector('.mx');
      GameHost.send('prematch', { dur: 1.0 });
      await sleep(140); mx.classList.add('bars'); Sfx.whoosh();
      /* титульная карточка «КАК БИТЬ» со стеной текста УДАЛЕНА: обучение
         стартует сразу после короткой стартовой анимации */
      await sleep(760); if (!this.alive) return;
      mx.classList.remove('bars', 'cine'); mx.classList.add('live');
      GameHost.send('train', { step: this.data.step || 0 }); GameHost.send('quiet', { on: false });
    })();
  },
  onMsg(m) {
    if (!this.alive) return;
    const el = this.el;
    if (m.type === 'train') {
      const L = this.last;
      el.querySelector('.tc-step').textContent = `${m.step + 1}/${m.total}`;
      el.querySelector('.tc-title').textContent = m.title;
      /* в интро большая карточка урока несёт весь текст — шапка молчит.
       * (пустая строка через `||` падала в goal — отсюда был дубль) */
      el.querySelector('.tc-text').textContent = m.phase === 'intro' ? '' : (m.text || m.goal);
      el.querySelector('.tc-dots').innerHTML = [...Array(m.need)].map((_, i) => `<i class="${i < m.done ? 'on' : ''}"></i>`).join('');
      const card = el.querySelector('.tc'); card.classList.toggle('hold', !!m.frozen);
      /* на время объявления урока шапка прячется целиком — карточка урока
         единственный текст на экране */
      card.style.opacity = m.phase === 'intro' ? '0' : '';
      if (m.step !== L.step) { card.animate([{ transform: 'translateY(-12px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.18,1.25,.4,1)' }); if (L.step !== undefined) { Sfx.rise(.4); haptic('success'); } }
      if (m.frozen && !L.frozen) { Sfx.soft(); haptic('rigid'); }
      if (m.nudge && !L.nudge) haptic('warning');
      if (m.phase !== L.phase && (m.phase === 'ok' || m.phase === 'fail')) {
        const msg = el.querySelector('.tc-msg'); msg.className = 'tc-msg ' + m.phase; msg.textContent = m.msg || (m.phase === 'ok' ? 'Есть!' : 'Ещё раз');
        void msg.offsetWidth; msg.classList.add('on');
        if (m.phase === 'ok') { Sfx.point(); haptic('success'); const dt = el.querySelectorAll('.tc-dots i')[m.done - 1]; if (dt) { const p = FX.pt(dt); FX.burst(p.x, p.y, { c: ['#9CFFD0', '#fff', '#FFC93A'], count: 18, speed: 7 }); } }
        else { haptic('error'); card.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'none' }], { duration: 360 }); }
      }
      this.last = { step: m.step, frozen: m.frozen, nudge: m.nudge, phase: m.phase };
    }
    if (m.type === 'paused' && m.v && !m.host && !Sheet.cur) {
      GameHost.send('pause');
      Sheet.open(`<div class="h1" style="margin:4px 4px 14px">Пауза</div><div style="display:grid;gap:12px"><button class="b3 green block" data-a="go"><span class="shine"></span>${Art.icon('play', { c: '#fff' })}Продолжить</button><button class="b3 dark block sm" data-a="exit">Выйти из обучения</button></div>`, {
        onOpen: (w) => w.addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (!a) return; Sheet.close(true); if (a.dataset.a === 'exit') this.exit(); })
      });
      // resume — только когда листов не осталось вообще
      const host = $('#sheets'); if (this._mo) this._mo.disconnect();
      this._mo = new MutationObserver(() => { if (!Sheet.cur && this.alive) { this._mo.disconnect(); this._mo = null; GameHost.send('resume'); } });
      this._mo.observe(host, { childList: true });
    }
    if (m.type === 'trainDone') {
      S.tutorialDone = true; save();
      const done = el.querySelector('.tx-done'); done.classList.add('on'); Sfx.win(); haptic('success'); flash('#FFE680', .35); FX.confetti(FX.W / 2, FX.H * .3, 110, 1.1);
      const rw = done.querySelector('.tx-reward');
      if (S.tutorialRewarded) rw.classList.add('got');
      else {
        S.tutorialRewarded = true; save();
        rw.classList.add('pay');
        setTimeout(() => { if (!this.alive) return; const from = FX.pt(done.querySelector('.tx-cup'));
          Wallet.add('coins', 200, from).then(() => this.alive && Wallet.add('gems', 5, from)); }, 900);
      }
    }
  },
  exit() {
    if (!S.tutorialDone && this.data.then === 'mm') {
      return confirmSheet('Пропустить обучение?', 'Его можно пройти позже: Арена → режим «Тренировка».', 'Пропустить', () => { S.tutorialDone = true; save(); Router.go('mm'); });
    }
    Router.go('hub');
  },
  leave() { this.alive = false; this.off && this.off(); TGX.guard(false); if (this._mo) { this._mo.disconnect(); this._mo = null; } GameHost.send('quit'); GameHost.show(false); },
  onBack() { this.exit(); }
});

function confirmSheet(title, text, ok, fn) {
  Sheet.open(`<div class="h1" style="margin:4px 4px 6px">${title}</div><p class="dim" style="margin:0 4px 16px;font-size:12.5px">${text}</p>
    <div style="display:grid;gap:12px"><button class="b3 coral block" data-a="ok">${ok}</button><button class="b3 dark block sm" data-a="no">Остаться</button></div>`, {
    onOpen: (w) => w.addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (!a) return; Sheet.close(true); if (a.dataset.a === 'ok') fn(); })
  });
}

/* ---------------- Dev: зона удара (?dev=1 или десктоп-панель) ---------------- */
function devZoneSheet() {
  const R = Object.assign({}, GameHost.rules || {}, GameHost.devRules());
  const F = [
    ['captureRadius', 'Радиус захвата, м', .08, .62, .01], ['depthTolerance', 'Допуск глубины, м', .08, .62, .01],
    ['serveCaptureRadius', 'Радиус подачи, м', .2, .9, .01], ['contactForwardPx', 'Зона: вниз (удар ↑), px', 40, 240, 2],
    ['contactBackPx', 'Зона: вверх (подрезка ↓), px', 0, 200, 2], ['contactSideTouchPx', 'Зона: бока (тач), px', 20, 90, 2],
    ['contactSideMousePx', 'Зона: бока (мышь), px', 16, 80, 2]
  ];
  const row = ([k, t, a, b, s]) => `<label class="dz-row"><span>${t}</span><input type="range" min="${a}" max="${b}" step="${s}" value="${R[k] ?? a}" data-k="${k}"><b class="num" data-v="${k}">${R[k] ?? a}</b></label>`;
  Sheet.open(`<div class="h1" style="margin:4px 4px 4px">Зона удара · dev</div><p class="dim" style="margin:0 4px 12px;font-size:11.5px">Изменения перезапускают движок. Хранятся локально (ttu-rules-dev).</p>
    <div class="pnl dz">${F.map(row).join('')}
    <label class="dz-row"><span>Показать зоны</span><button class="tgl ${GameHost.debug ? 'on' : ''}" data-t="debug"></button></label>
    <label class="dz-row"><span>Авто-шаг к мячу</span><button class="tgl ${R.autoFootwork !== false ? 'on' : ''}" data-t="autoFootwork"></button></label></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px"><button class="b3 dark sm" data-a="reset">Сброс v3</button><button class="b3 green sm" data-a="apply">Применить</button></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px"><button class="b3 dark sm" data-a="stats">Статистика · ${ZoneStats.all().length}</button><button class="b3 dark sm" data-a="link">Ссылка с настройкой</button></div>`, {
    onOpen: (w) => {
      const draft = Object.assign({}, GameHost.devRules());
      w.addEventListener('input', (e) => { const i = e.target.closest('input[data-k]'); if (!i) return; draft[i.dataset.k] = +i.value; w.querySelector(`[data-v="${i.dataset.k}"]`).textContent = i.value; });
      w.addEventListener('click', (e) => {
        const t = e.target.closest('[data-t]');
        if (t) { const k = t.dataset.t; if (k === 'debug') { GameHost.debug = !GameHost.debug; t.classList.toggle('on', GameHost.debug); GameHost.send('debug', { on: GameHost.debug }); } else { draft[k] = !t.classList.contains('on'); t.classList.toggle('on', draft[k]); } return; }
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'stats') { Sheet.close(true); zoneStatsSheet(); return; }
        if (a.dataset.a === 'link') { const u = RulesLink.url(RulesLink.clean(Object.assign({}, R, draft)) || {}); copyText(u).then((ok) => toast(ok ? 'Ссылка скопирована — у тестеров будет эта же зона' : 'Не удалось скопировать', ok ? 'check' : 'x')); return; }
        if (a.dataset.a === 'reset') GameHost.setDevRules({});
        else GameHost.setDevRules(draft);
        Sheet.close(true); toast('Движок перезапущен с новой зоной', 'target');
        const cur = Router.cur; Router.go(cur, { replace: true, mode: 'wipe', data: cur === 'train' ? { then: 'hub' } : null });
      });
    }
  });
}

/* ---------------- ИТОГ МАТЧА ---------------- */
/* «Разбор матча»: одна главная ошибка этого матча и как её исправить,
   из тех же попыток, что и dev-статистика зоны. */
function coachCard(c, d) {
  if (!c || c.n < 3) return `<div class="pnl rc tip" style="--d:${d}">${Art.icon('info', { c: '#9BE8FF' })}<p><b>Совет:</b> ставь палец под мяч и смахивай вверх через него, когда мяч подлетает к тебе.</p></div>`;
  const side = c.side, fwd = c.fwd, back = c.back;
  const dots = c.dots.map((a) => `<circle cx="${clamp(a.dx, -88, 88)}" cy="${clamp(a.dy, -c.back - 10, c.fwd + 10)}" r="7" fill="${a.contact ? '#3BF5A0' : a.accepted ? '#FF5A4D' : '#8E98C4'}" stroke="#0B0E22" stroke-width="2"/>`).join('');
  return `<div class="pnl rc coach ${c.key}" style="--d:${d}">
    <svg class="cz" viewBox="-92 ${-c.back - 16} 184 ${c.back + c.fwd + 32}"><path d="M ${-side} 0 A ${side} ${back} 0 0 1 ${side} 0 A ${side} ${fwd} 0 0 1 ${-side} 0 Z" fill="rgba(53,198,244,.12)" stroke="#35C6F4" stroke-width="3" stroke-dasharray="9 7"/><circle r="8" fill="#FFD54A"/>${dots}</svg>
    <div class="rcm"><span class="cap">Разбор матча · контакт <b class="num">${c.pct}%</b></span><b class="ct">${c.title}</b><p>${c.tip}</p></div></div>`;
}

Router.def('result', {
  full: true,
  get mood() { return 'gold'; },
  render(d) {
    d = d || Demo.result(true); this.d = d; const o = PEOPLE[d.opp];
    const delta = d.win ? 24 : -18; this.delta = delta;
    const medals = [
      { on: d.win, t: 'Победа' }, { on: d.stats.perfect >= 3, t: 'Идеальные ×3' }, { on: d.stats.maxRally >= 8, t: 'Розыгрыш 8+' }
    ];
    this.medals = medals;
    const L = leagueOf(S.rating), N = nextLeague(S.rating);
    /* Ход матча: кумулятивная разница очков по ходу серии — видно, кто вёл
     * и где был перелом. Аналитическая зрелищность без единого лишнего
     * эффекта в самом матче. */
    /* Блок «Ход матча» с графиком убран: отнимал место у разбора и дублировал
     * счёт. Если понадобится — старый код в системе контроля версий. */
    /* Кубок/трофей убран с экрана итога: дублировал смысл плашки ПОБЕДА
     * и забирал место у разбора. Иллюстрация поражения остаётся. */
    return `<div class="res ${d.win ? 'win' : 'lose'}">
      ${d.win ? '' : `<i class="res-ill" style="background-image:url('${ILL.lose}')"></i>`}
      <div class="hud mini">${''}<div style="flex:1"></div>
        <div class="cur" data-cur="coins"><span class="ci">${Art.coin(36)}</span><span class="v num">${fmt(S.coins)}</span></div>
        <div class="cur" data-cur="gems"><span class="ci">${Art.gem(34)}</span><span class="v num">${fmt(S.gems)}</span></div></div>
      <div class="res-title h-display">${UI.split(d.win ? 'Победа' : 'Поражение')}</div>
      <div class="res-score">
        <div class="rs-p">${Art.avatar('me', 62, { ring: '#FF7A4D' })}<b>${S.name.split(' ')[0]}</b></div>
        <div class="rs-n num"><span class="${d.win ? 'w' : ''}">${d.me}</span><i>:</i><span class="${d.win ? '' : 'w'}">${d.op}</span></div>
        <div class="rs-p">${Art.avatar('p' + d.opp, 62, { ring: o.c[0] })}<b>${o.s.split(' ').pop()}</b></div>
      </div>
      <div class="medals">${medals.map((m, i) => `<div class="md" data-i="${i}"><span class="mds">${Art.star(i === 1 ? 74 : 60, m.on)}</span><small>${m.t}</small></div>`).join('')}</div>
      <div class="res-cards">
        <div class="pnl rc rating" style="--d:0"><span class="rcb">${Art.badge(L, 40)}</span><div class="rcm"><span class="cap">Рейтинг · ${L.n}</span>
          <div class="rcv"><b class="num" id="rRating">${fmt(S.rating)}</b><em class="${delta > 0 ? 'up' : 'dn'}">${delta > 0 ? '+' : ''}${delta}</em></div>
          <div class="bar gold"><i id="rBar" style="--p:${N ? (S.rating - L.min) / (N.min - L.min) : 1}"></i></div></div></div>
        <div class="pnl rc" style="--d:1"><span class="rcl"><span>${S.level}</span></span><div class="rcm"><span class="cap">Опыт · уровень ${S.level}</span>
          <div class="rcv"><b class="num" id="rXp">${fmt(S.xp)}</b><span class="dim num">/ ${fmt(S.xpMax)}</span><em class="up">+${d.win ? 180 : 60} XP</em></div>
          <div class="bar"><i id="rXpBar" style="--p:${S.xp / S.xpMax}"></i></div></div></div>
        <div class="rc-row">
          <div class="pnl rc stat big" style="--d:3"><span class="cap">Макс. скорость</span><b class="num">${d.stats.maxSpeed || 0}<small class="dim"> км/ч</small></b></div>
          <div class="pnl rc stat big" style="--d:4"><span class="cap">Точность</span><b class="num">${d.stats.acc || 0}<small class="dim">%</small></b></div>
        </div>
        ${d.quests && d.quests.length ? `<div class="pnl rc" style="--d:5"><span class="rcb">${Art.icon('target', { c: '#9BE8FF' })}</span><div class="rcm"><span class="cap">Задание дня выполнено</span><b>${d.quests.map((q) => q.t).join(' · ')}</b><small class="dim">Награда ждёт на главной</small></div></div>` : ''}
        ${d.win ? `<div class="pnl rc loot" style="--d:5"><span class="lc">${Art.chest('silver', 64)}</span><div class="rcm"><span class="cap">Награда</span><b>Серебряный сундук</b><small class="dim">Отправлен в свободный слот</small></div><span class="lcoin">${Art.coin(30)}<b class="num">+90</b></span></div>`
          : ''}
        ${coachCard(d.coach, d.win ? 6 : 5)}
      </div>
      <div class="res-btns"><button class="b3 dark" data-act="again">${Art.icon('refresh', { c: '#fff' })}Реванш</button><button class="b3 ${d.win ? '' : 'cyan'}" data-act="next"><span class="shine"></span>Далее</button></div>
    </div>`;
  },
  mount(el) {
    const d = this.d; const res = el.querySelector('.res'); this.alive = true;
    /* Награды применяем СРАЗУ, до дорожки анимации (идемпотентно через d.applied).
       Раньше всё записывалось глубоко в таймлайне: ранний тап «Далее»/«Назад»
       терял рейтинг и опыт, которые экран уже показывал. */
    if (!d.applied) {
      d.applied = true;
      this.r0 = S.rating; this.x0 = S.xp;
      S.rating += this.delta;
      if (d.win) { S.wins++; S.streak++; } else { S.losses++; S.streak = 0; }
      /* форма для formAdjust: последние 8 результатов, победа = 1 */
      S.form = (Array.isArray(S.form) ? S.form : []).concat(d.win ? 1 : 0).slice(-8);
      const add = d.win ? 180 : 60;
      this.xv = Math.min(S.xp + add, S.xpMax); this.xpBar = Math.min(1, (S.xp + add) / S.xpMax);
      S.xp += add; this.lvlUp = false;
      if (S.xp >= S.xpMax) { S.xp -= S.xpMax; S.level++; this.lvlUp = true; }
      save();
    }
    BG.mood(d.win ? 'gold' : 'lose');
    el.querySelector('[data-act=next]').addEventListener('click', () => Router.go('hub'));
    el.querySelector('[data-act=again]').addEventListener('click', () => Router.go('mm'));
    (async () => {
      await sleep(150); res.classList.add('t1');
      if (d.win) { Sfx.win(); FX.rain(70); } else Sfx.lose();
      await sleep(650); if (!this.alive) return; res.classList.add('t2');
      // звёзды-медали: штамп с ударом
      for (const [i, m] of this.medals.entries()) {
        await sleep(330); if (!this.alive) return;
        const md = el.querySelector(`.md[data-i="${i}"]`); md.classList.add('on');
        if (m.on) { const p = FX.pt(md.querySelector('.mds')); setTimeout(() => { FX.burst(p.x, p.y, { count: 26, speed: 10, size: 1.1 }); FX.twinkles(p.x, p.y, 40, 6); Sfx.impact(); haptic('heavy'); FX.shake(5, 200); }, 180); }
        else { setTimeout(() => Sfx.soft(), 180); }
      }
      await sleep(500); if (!this.alive) return; res.classList.add('t3');
      await sleep(450);
      // рейтинг — уже записан в состояние, здесь только визуальная дорожка
      const L = leagueOf(S.rating), N = nextLeague(S.rating);
      tickNumber(el.querySelector('#rRating'), this.r0, S.rating, 900, { onTick: () => Sfx.tick() });
      el.querySelector('#rBar').style.setProperty('--p', N ? (S.rating - L.min) / (N.min - L.min) : 1);
      await sleep(900); if (!this.alive) return;
      // опыт
      tickNumber(el.querySelector('#rXp'), this.x0, this.xv, 800);
      el.querySelector('#rXpBar').style.setProperty('--p', this.xpBar);
      await sleep(900); if (!this.alive) return;
      if (d.win) {
        const lc = el.querySelector('.lcoin'); Wallet.add('coins', 90, FX.pt(lc));
        const empty = S.chests.findIndex((c) => !c); if (empty >= 0) { S.chests[empty] = { id: 'c' + Date.now(), kind: 'silver', state: 'locked' }; save(); }
        const lch = el.querySelector('.lc'); lch.classList.add('drop');
      }
      res.classList.add('t4');
      if (d.unlocked && d.unlocked.length) { await sleep(700); await achievementPops(d.unlocked, () => this.alive); }
      if (this.lvlUp) { await sleep(1200); if (this.alive) LevelUp.show(S.level); }
    })();
  },
  leave() { this.alive = false; },
  onBack() { Router.go('hub'); }
});

/* ---------------- ОТКРЫТИЕ СУНДУКА ---------------- */
Router.def('chest', {
  full: true, mood: 'violet',
  render(d) {
    d = d || { kind: 'gold' }; this.d = d; const C = Art.CHEST[d.kind];
    this.loot = [
      { k: 'coins', n: d.kind === 'gold' ? 320 : 180, t: 'Монеты', r: 'common', art: Art.coin(110) },
      { k: 'gems', n: d.kind === 'gold' ? 8 : 4, t: 'Гемы', r: 'rare', art: Art.gem(104) },
      { k: 'card', n: 1, t: 'Накладка «Coral Spin»', r: 'epic', art: Art.rubber('#FF4B3E', 120) },
      ...(d.kind === 'gold' ? [{ k: 'card', n: 1, t: 'След «Золотая комета»', r: 'leg', art: ItemArt.comet(110) }] : [])
    ];
    return `<div class="cho">
      <div class="hud mini"><div style="flex:1"></div>
        <div class="cur" data-cur="coins"><span class="ci">${Art.coin(36)}</span><span class="v num">${fmt(S.coins)}</span></div>
        <div class="cur" data-cur="gems"><span class="ci">${Art.gem(34)}</span><span class="v num">${fmt(S.gems)}</span></div></div>
      <div class="cho-title"><span class="cap">${C.n} сундук</span><b class="h-display" id="choT">Тапни, чтобы открыть</b></div>
      <div class="cho-stage">
        <div class="cho-chest" data-press>${Art.chest(d.kind, 220)}</div>
        <div class="cho-taps"><i></i><i></i><i></i></div>
      </div>
      <div class="cho-card"></div>
      <div class="cho-left"></div>
      <div class="cho-sum"></div>
    </div>`;
  },
  mount(el) {
    const ch = el.querySelector('.cho-chest'); const glow = ch.querySelector('.ch-glow'); this.phase = 'taps';
    const root = el.querySelector('.cho');
    ch.addEventListener('click', () => {
      if (this.phase !== 'taps') return;
      this.phase = 'wait';                       // one tap is all it takes
      el.querySelectorAll('.cho-taps i').forEach(d => d.classList.add('on'));
      ch.classList.remove('hit'); void ch.offsetWidth; ch.classList.add('hit');
      glow.style.opacity = 1; Sfx.impact(); haptic('heavy'); FX.shake(6, 240);
      const p = FX.pt(ch); FX.burst(p.x, p.y + 10, { c: ['#D3B5FF', '#FFC93A', '#fff'], count: 20, speed: 8, size: 1 });
      setTimeout(() => this.open(el, root, ch), 420);
    });
    /* during the reveal a tap anywhere fast-forwards to the summary;
       on the summary a tap anywhere closes — never a hunt for a button */
    root.addEventListener('click', (e) => {
      if (e.target.closest('.cho-chest') || e.target.closest('button')) return;
      if (this.phase === 'cards') { clearTimeout(this._t); this.summary(el); }
      else if (this.phase === 'done') this.close();
    });
  },
  async open(el, root, ch) {
    this.phase = 'opening';
    Sfx.rise(.7); ch.classList.add('charge'); await sleep(700);
    root.classList.add('opened'); flash('#fff', .9, 600); Sfx.reveal(2); haptic('heavy'); FX.shake(16, 500);
    const p = FX.pt(ch); FX.burst(p.x, p.y - 30, { c: ['#FFC93A', '#FFF6C8', '#D3B5FF', '#fff'], count: 70, speed: 18, size: 1.8 }); FX.ring(p.x, p.y - 30, '#FFE680', 260, 12); FX.confetti(p.x, p.y - 40, 60, .8);
    $('#choT', el).textContent = 'Смотри, что выпало';
    await sleep(650); this.idx = -1; this.phase = 'cards'; this.next(el);
  },
  next(el) {
    if (this.busy) return; this.idx++;
    const card = el.querySelector('.cho-card'); const left = el.querySelector('.cho-left');
    if (this.idx >= this.loot.length) return this.summary(el);
    const it = this.loot[this.idx]; this.busy = true;
    const rn = { common: 'Обычная', rare: 'Редкая', epic: 'Эпическая', leg: 'Легендарная' }[it.r];
    card.innerHTML = `<div class="lcard rar ${it.r === 'common' ? '' : it.r} ${it.r === 'leg' || it.r === 'epic' ? 'beam' : ''}"><div class="lc-in">
      <div class="lc-back">${Art.icon('ball', { c: 'rgba(255,255,255,.5)' })}</div>
      <div class="lc-front"><span class="lc-r">${rn}</span><div class="lc-art">${it.art}</div><b class="lc-n num">${it.k === 'card' ? 'Новинка' : '×' + it.n}</b><span class="lc-t">${it.t}</span><i class="lc-foil"></i></div>
    </div></div>`;
    left.textContent = this.loot.length - this.idx - 1 > 0 ? `ещё ${this.loot.length - this.idx - 1}` : 'последняя';
    const lc = card.querySelector('.lcard'); Sfx.swoosh();
    requestAnimationFrame(() => lc.classList.add('in'));
    setTimeout(() => {
      lc.classList.add('flip'); Sfx.reveal(['common', 'rare', 'epic', 'leg'].indexOf(it.r)); haptic(it.r === 'leg' ? 'heavy' : 'medium');
      const p = FX.pt(lc); const col = { common: ['#C9D6F5', '#fff'], rare: ['#33B6FF', '#fff'], epic: ['#B061FF', '#fff', '#FF7AD9'], leg: ['#FFB21E', '#FFF6C8', '#fff'] }[it.r];
      setTimeout(() => { FX.burst(p.x, p.y, { c: col, count: it.r === 'leg' ? 60 : 30, speed: it.r === 'leg' ? 16 : 10, size: it.r === 'leg' ? 1.6 : 1 }); if (it.r === 'leg') { FX.rain(60); flash('#FFE680', .6); FX.shake(10, 400); } FX.twinkles(p.x, p.y, 90, 10); }, 220);
      this.busy = false;
      // the next loot card deals itself — no tapping required
      if (this.phase === 'cards') this._t = setTimeout(() => { this._t = null; if (this.phase === 'cards') this.next(el); }, 1000);
    }, 420);
  },
  async summary(el) {
    if (this.phase === 'sum' || this.phase === 'done') return;
    this.phase = 'sum';
    el.querySelector('.cho-card').innerHTML = ''; el.querySelector('.cho-left').textContent = '';
    $('#choT', el).textContent = 'Добыча';
    const sum = el.querySelector('.cho-sum');
    sum.innerHTML = `<div class="sum-grid">${this.loot.map((it, i) => `<div class="sg rar ${it.r === 'common' ? '' : it.r}" style="--d:${i}"><div class="sga">${it.art}</div><b class="num">${it.k === 'card' ? 'NEW' : '×' + it.n}</b></div>`).join('')}</div>`;
    sum.classList.add('on');
    // balance fills itself — no «Забрать» step: the loot is already yours
    haptic('success');
    const c = this.loot.find((x) => x.k === 'coins'), g = this.loot.find((x) => x.k === 'gems');
    const cells = $$('.sg', sum);
    await Promise.all([c && Wallet.add('coins', c.n, FX.pt(cells[0])), sleep(220).then(() => g && Wallet.add('gems', g.n, FX.pt(cells[1])))]);
    if (this.d.slot !== undefined) { S.chests[this.d.slot] = null; save(); }
    if (!S.owned.includes('r-coral')) S.owned.push('r-coral'); save();
    if (this.phase === 'sum') {
      this.phase = 'done'; $('#choT', el).textContent = 'В балансе!'
      sum.insertAdjacentHTML('beforeend', `<button class="b3 green" data-act="done"><span class="shine"></span>Готово</button>`);
      sum.querySelector('[data-act=done]').addEventListener('click', () => this.close());
      if (this.phase === 'done') this._doneT = setTimeout(() => { if (this.phase === 'done') this.close(); }, 2600);
    }
  },
  close() { clearTimeout(this._doneT); this.phase = 'closed'; Router.go('hub'); },
  leave() { clearTimeout(this._t); clearTimeout(this._doneT); },
  onBack() { Router.go('hub'); }
});
