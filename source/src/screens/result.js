function confirmSheet(title, text, ok, fn) {
  Sheet.open(`<div class="h1" style="margin:4px 4px 6px">${title}</div><p class="dim" style="margin:0 4px 16px;font-size:12.5px">${text}</p>
    <div style="display:grid;gap:12px"><button class="b3 coral block" data-a="ok">${ok}</button><button class="b3 dark block sm" data-a="no">${t('common.stay')}</button></div>`, {
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
        if (t) { const k = t.dataset.t; if (k === 'debug') { GameHost.setDebug(!GameHost.debug); t.classList.toggle('on', GameHost.debug); } else { draft[k] = !t.classList.contains('on'); t.classList.toggle('on', draft[k]); } return; }
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
/* «Разбор матча» — шторка снизу экрана итога. Закрыта: видна только ручка
   с названием. Тап — поднимается на ~62% экрана поверх виджетов: внутри
   крупная тепловая карта зоны удара (те же попытки, что собирает
   ZoneStats) и советы по игре: главная ошибка матча из coach-разбора +
   подсказки по статистике матча. */
function analysisSheet(d) {
  const c = d.coach, st = d.stats || {};
  const has = !!(c && c.n >= 3 && Array.isArray(c.dots));
  const tips = [];
  if (has) tips.push({ h: c.title, p: c.tip });
  if ((st.acc || 0) < 60) tips.push({ h: t('analysis.tipAccT'), p: t('analysis.tipAcc') });
  if ((st.maxRally || 0) < 6) tips.push({ h: t('analysis.tipRallyT'), p: t('analysis.tipRally') });
  tips.push({ h: t('analysis.tipSpinT'), p: t('analysis.tipSpin') });
  let map;
  if (has) {
    const side = c.side, fwd = c.fwd, back = c.back;
    const X = (a) => clamp(a.dx, -92, 92), Y = (a) => clamp(a.dy, -back - 12, fwd + 12);
    const blobs = c.dots.map((a) => `<circle cx="${X(a)}" cy="${Y(a)}" r="30" fill="url(#heatG)"/>`).join('');
    const dots = c.dots.map((a) => `<circle cx="${X(a)}" cy="${Y(a)}" r="6.5" fill="${a.contact ? '#3BF5A0' : a.accepted ? '#FF5A4D' : '#8E98C4'}" stroke="#0B0E22" stroke-width="2"/>`).join('');
    map = `<div class="cap">${t('analysis.mapTitle')}</div>
      <svg class="rs-map" viewBox="-104 ${-back - 30} 208 ${back + fwd + 60}" role="img" aria-label="${t('analysis.mapTitle')}">
        <defs><radialGradient id="heatG"><stop offset="0%" stop-color="#FF6A3C" stop-opacity=".75"/><stop offset="55%" stop-color="#FF3C5A" stop-opacity=".32"/><stop offset="100%" stop-color="#FF3C5A" stop-opacity="0"/></radialGradient></defs>
        <path d="M ${-side} 0 A ${side} ${back} 0 0 1 ${side} 0 A ${side} ${fwd} 0 0 1 ${-side} 0 Z" fill="rgba(53,198,244,.10)" stroke="#35C6F4" stroke-width="2.5" stroke-dasharray="9 7"/>
        ${blobs}${dots}<circle r="7" fill="#FFD54A" stroke="#0B0E22" stroke-width="2"/>
      </svg>
      <div class="rs-legend"><span><i style="background:#3BF5A0"></i>${t('analysis.lgHit')}</span><span><i style="background:#FF5A4D"></i>${t('analysis.lgZone')}</span><span><i style="background:#8E98C4"></i>${t('analysis.lgOut')}</span></div>`;
  } else {
    map = `<div class="pnl rc tip" style="opacity:1;transform:none">${Art.icon('info', { c: '#9BE8FF' })}<p><b>${t('coach.tipLabel')}</b> ${t('coach.fallback')}</p></div>`;
  }
  return `<div class="res-sheet" id="resSheet">
    <button class="rs-head" data-act="sheet" aria-expanded="false">
      <span class="rs-grip"></span>
      <span class="rs-name">${Art.icon('chart', { c: '#9BE8FF' })} ${t('result.analysis')}</span>
      ${has ? `<span class="rs-pct num">${c.pct}%</span>` : ''}
      <span class="rs-chev"></span>
    </button>
    <div class="rs-body">${map}
      <div class="cap" style="margin-top:16px">${t('analysis.tipsTitle')}</div>
      ${tips.slice(0, 3).map((x) => `<div class="rs-tip"><b>${x.h}</b><p>${x.p}</p></div>`).join('')}
    </div>
  </div>`;
}

Router.def('result', {
  full: true,
  get mood() { return 'gold'; },
  render(d) {
    d = d || Demo.result(true); this.d = d; const o = PEOPLE[d.opp];
    const delta = d.win ? 24 : -18; this.delta = delta;
    const medals = [
      { on: d.win, tk: 'result.win' }, { on: d.stats.perfect >= 3, tk: 'medal.perfect' }, { on: d.stats.maxRally >= 8, tk: 'medal.rally' }
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
      <div class="res-title h-display">${UI.split(d.win ? t('result.win') : t('result.lose'))}</div>
      <div class="res-score">
        <div class="rs-p">${Art.avatar('me', 62, { ring: '#FF7A4D' })}<b>${S.name.split(' ')[0]}</b></div>
        <div class="rs-n num"><span class="${d.win ? 'w' : ''}">${d.me}</span><i>:</i><span class="${d.win ? '' : 'w'}">${d.op}</span></div>
        <div class="rs-p">${Art.avatar('p' + d.opp, 62, { ring: o.c[0] })}<b>${o.s.split(' ').pop()}</b></div>
      </div>
      <div class="medals">${medals.map((m, i) => `<div class="md" data-i="${i}"><span class="mds">${Art.star(i === 1 ? 74 : 60, m.on)}</span><small>${t(m.tk)}</small></div>`).join('')}</div>
      <div class="res-widgets">
        <div class="pnl rc rating" style="--d:0"><span class="rcb">${Art.badge(L, 40)}</span><div class="rcm"><span class="cap">${t('result.rating')} · ${leagueName(L)}</span>
          <div class="rcv"><b class="num" id="rRating">${fmt(S.rating)}</b><em class="${delta > 0 ? 'up' : 'dn'}">${delta > 0 ? '+' : ''}${delta}</em></div>
          <div class="bar gold"><i id="rBar" style="--p:${N ? (S.rating - L.min) / (N.min - L.min) : 1}"></i></div></div></div>
        <div class="pnl rc" style="--d:1"><span class="rcl"><span>${S.level}</span></span><div class="rcm"><span class="cap">${t('result.xp', { n: S.level })}</span>
          <div class="rcv"><b class="num" id="rXp">${fmt(S.xp)}</b><span class="dim num">/ ${fmt(S.xpMax)}</span><em class="up">+${d.win ? 180 : 60} XP</em></div>
          <div class="bar"><i id="rXpBar" style="--p:${S.xp / S.xpMax}"></i></div></div></div>
        <div class="pnl rc stat big" style="--d:2"><span class="cap">${t('result.maxSpeed')}</span><b class="num">${d.stats.maxSpeed || 0}<small class="dim"> ${t('unit.kmh')}</small></b></div>
        <div class="pnl rc stat big" style="--d:3"><span class="cap">${t('result.accuracy')}</span><b class="num">${d.stats.acc || 0}<small class="dim">%</small></b></div>
      </div>
      <div class="res-cards">
        ${d.quests && d.quests.length ? `<div class="pnl rc" style="--d:4"><span class="rcb">${Art.icon('target', { c: '#9BE8FF' })}</span><div class="rcm"><span class="cap">${t('result.questDone')}</span><b>${d.quests.map((q) => q.t).join(' · ')}</b><small class="dim">${t('result.questReward')}</small></div></div>` : ''}
        ${d.win ? `<div class="pnl rc loot" style="--d:4"><span class="lc">${Art.chest('silver', 64)}</span><div class="rcm"><span class="cap">${t('result.reward')}</span><b>${Art.chestName('silver')} ${t('chest.word')}</b><small class="dim">${t('result.chestSent')}</small></div><span class="lcoin">${Art.coin(30)}<b class="num">+90</b></span></div>`
          : ''}
      </div>
      <div class="res-btns"><button class="b3 dark" data-act="again">${Art.icon('refresh', { c: '#fff' })}${t('result.rematch')}</button><button class="b3 ${d.win ? '' : 'cyan'}" data-act="next"><span class="shine"></span>${t('common.next')}</button></div>
      ${analysisSheet(d)}
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
      /* The ladder has a floor: a long losing run used to drive the rating
       * negative, and the league badge then showed a number no league owns. */
      S.rating = Math.max(0, S.rating + this.delta);
      if (d.win) { S.wins++; S.streak++; } else { S.losses++; S.streak = 0; }
      /* форма (aiTrend в battle_common.js) — последние 8 результатов, победа = 1:
       * по ней бот понимает тренд МЕЖДУ матчами, а не внутри розыгрыша */
      S.form = (Array.isArray(S.form) ? S.form : []).concat(d.win ? 1 : 0).slice(-8);
      const add = d.win ? 180 : 60;
      this.xv = Math.min(S.xp + add, S.xpMax); this.xpBar = Math.min(1, (S.xp + add) / S.xpMax);
      S.xp += add; this.lvlUp = false;
      if (S.xp >= S.xpMax) { S.xp -= S.xpMax; S.level++; this.lvlUp = true; }
      save();
    }
    BG.mood(d.win ? 'gold' : 'lose');
    el.querySelector('[data-act=next]').addEventListener('click', () => Router.go('hub'));
    /* Реванш — СРАЗУ в матч с тем же соперником (BATTLE.opp и MODE живы):
       ни радара, ни экрана VS — тот же игрок, новый матч. */
    el.querySelector('[data-act=again]').addEventListener('click', () => Router.go('match'));
    const sheet = el.querySelector('#resSheet');
    if (sheet) {
      const head = sheet.querySelector('[data-act=sheet]');
      head.addEventListener('click', () => {
        const open = sheet.classList.toggle('open');
        head.setAttribute('aria-expanded', String(open));
        haptic('select'); Sfx.soft();
      });
    }
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
      { k: 'coins', n: d.kind === 'gold' ? 320 : 180, tk: 'cur.coinsWord', r: 'common', art: Art.coin(110) },
      { k: 'gems', n: d.kind === 'gold' ? 8 : 4, tk: 'cur.gemsWord', r: 'rare', art: Art.gem(104) },
      { k: 'card', n: 1, item: 'r-coral', r: 'epic', art: Art.rubber('#FF4B3E', 120) },
      ...(d.kind === 'gold' ? [{ k: 'card', n: 1, item: 't-gold', r: 'leg', art: ItemArt.comet(110) }] : [])
    ];
    return `<div class="cho">
      <div class="hud mini"><div style="flex:1"></div>
        <div class="cur" data-cur="coins"><span class="ci">${Art.coin(36)}</span><span class="v num">${fmt(S.coins)}</span></div>
        <div class="cur" data-cur="gems"><span class="ci">${Art.gem(34)}</span><span class="v num">${fmt(S.gems)}</span></div></div>
      <div class="cho-title"><span class="cap">${Art.chestName(d.kind)} ${t('chest.word')}</span><b class="h-display" id="choT">${t('chest.tapToOpen')}</b></div>
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
    $('#choT', el).textContent = t('chest.lookLoot');
    await sleep(650); this.idx = -1; this.phase = 'cards'; this.next(el);
  },
  next(el) {
    if (this.busy) return; this.idx++;
    const card = el.querySelector('.cho-card'); const left = el.querySelector('.cho-left');
    if (this.idx >= this.loot.length) return this.summary(el);
    const it = this.loot[this.idx]; this.busy = true;
    const rn = rarityName(it.r);
    card.innerHTML = `<div class="lcard rar ${it.r === 'common' ? '' : it.r} ${it.r === 'leg' || it.r === 'epic' ? 'beam' : ''}"><div class="lc-in">
      <div class="lc-back">${Art.icon('ball', { c: 'rgba(255,255,255,.5)' })}</div>
      <div class="lc-front"><span class="lc-r">${rn}</span><div class="lc-art">${it.art}</div><b class="lc-n num">${it.k === 'card' ? t('chest.newItem') : '×' + it.n}</b><span class="lc-t">${it.item ? itemName(Catalog.byId(it.item)) : t(it.tk)}</span><i class="lc-foil"></i></div>
    </div></div>`;
    left.textContent = this.loot.length - this.idx - 1 > 0 ? t('chest.more', { n: this.loot.length - this.idx - 1 }) : t('chest.last');
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
    $('#choT', el).textContent = t('chest.loot');
    const sum = el.querySelector('.cho-sum');
    sum.innerHTML = `<div class="sum-grid">${this.loot.map((it, i) => `<div class="sg rar ${it.r === 'common' ? '' : it.r}" style="--d:${i}"><div class="sga">${it.art}</div><b class="num">${it.k === 'card' ? 'NEW' : '×' + it.n}</b></div>`).join('')}</div>`;
    sum.classList.add('on');
    // balance fills itself — no «Забрать» step: the loot is already yours
    haptic('success');
    const c = this.loot.find((x) => x.k === 'coins'), g = this.loot.find((x) => x.k === 'gems');
    const cells = $$('.sg', sum);
    await Promise.all([c && Wallet.add('coins', c.n, FX.pt(cells[0])), sleep(220).then(() => g && Wallet.add('gems', g.n, FX.pt(cells[1])))]);
    if (this.d.slot !== undefined) { S.chests[this.d.slot] = null; save(); }
    /* The cards the chest SHOWS must actually be granted: the gallery promised
     * "НОВЫЙ ПРЕДМЕТ" for t-gold and the profile still said «не куплено»,
     * because nothing but r-coral ever entered the inventory. */
    for (const it of this.loot) {
      if (it.k === 'card' && it.item && Catalog.byId(it.item) && !S.owned.includes(it.item)) S.owned.push(it.item);
    }
    if (!S.owned.includes('r-coral')) S.owned.push('r-coral');
    save();
    if (this.phase === 'sum') {
      this.phase = 'done'; $('#choT', el).textContent = t('chest.inBalance')
      sum.insertAdjacentHTML('beforeend', `<button class="b3 green" data-act="done"><span class="shine"></span>${t('common.done')}</button>`);
      sum.querySelector('[data-act=done]').addEventListener('click', () => this.close());
      if (this.phase === 'done') this._doneT = setTimeout(() => { if (this.phase === 'done') this.close(); }, 2600);
    }
  },
  close() { clearTimeout(this._doneT); this.phase = 'closed'; Router.go('hub'); },
  leave() { clearTimeout(this._t); clearTimeout(this._doneT); },
  onBack() { Router.go('hub'); }
});
