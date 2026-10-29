/* =====================================================================
   HUB — «Арена»: живой стол с облётом камеры, дорога лиги,
   компактный выбор режимов, друзья и боковые ярлыки.
   ===================================================================== */
const MODES = [
  { id: 'ranked', tk: 'mode.ranked', sk: 'mode.rankedSub', i: 'crown', c: 'gold', diff: .62, tag: '±24' },
  { id: 'free', tk: 'mode.free', sk: 'mode.freeSub', i: 'bolt', c: 'coral', diff: .5, tagk: 'mode.freeTag' },
  { id: 'practice', tk: 'mode.practice', sk: 'mode.practiceSub', i: 'target', c: 'violet', diff: .35, tagk: 'mode.practiceTag' }
];
const modeTag = (m) => (m.tagk ? t(m.tagk) : m.tag || '');
let MODE = MODES[0];

/* Задания дня стали ЖИВЫМИ: миссии и прогресс считает Daily (career.js)
   из реальных итогов матчей — статичная заглушка QUESTS (с выдуманными
   2/3, 10/10, 9/15) удалена. Клейм записывается в S.daily.got — иначе лист
   можно было переоткрывать и бесконечно фармить ту же награду. */
const questReady = () => Daily.ready();
const FREE_MS = 4 * 3600 * 1000;           // подарок раз в 4 часа
const UNLOCK_MS = { wood: 30 * 60 * 1000, silver: 3 * 3600 * 1000, gold: 8 * 3600 * 1000, epic: 12 * 3600 * 1000 };

Router.def('hub', {
  mood: 'arena',
  render() {
    const L = leagueOf(S.rating), N = nextLeague(S.rating);
    const p = N ? (S.rating - L.min) / (N.min - L.min) : 1;
    const qr = questReady();
    const freeLeft = (S.freeAt || 0) - Date.now();
    /* Название зала убрано: «Твой зал · Лига / Арена» перегружало шапку */
    return `${UI.hud()}
    <div class="hub-content scroll">
    <div class="road rise" style="--d:0" data-act="ranks">
      <span class="rb">${Art.badge(L, 34)}</span>
      <div class="bar gold"><i style="--p:0" data-p="${p}"></i><span class="lbl num">${fmt(S.rating)} / ${N ? fmt(N.min) : '∞'}</span></div>
      <span class="rb next">${N ? Art.badge(N, 34) : ''}</span>
    </div>
    <div class="hero">
      <canvas class="demo"></canvas>
      <div class="side l">
        <button class="fab pop" style="--d:2" data-act="quests" data-press><span class="fic"><img src="${ILL['ic-quest']}" alt="" width="34" height="34"></span>${qr ? `<span class="dot">${qr}</span>` : ''}<em>${t('hub.quests')}</em></button>
        <button class="fab pop" style="--d:3" data-act="events" data-press><span class="fic"><img src="${ILL['ic-trophy']}" alt="" width="34" height="34"></span><em>${t('hub.events')}</em></button>
      </div>
      <div class="side r">
        <button class="fab pop ${freeLeft <= 0 ? 'free' : ''}" style="--d:2" data-act="gifts" data-press><span class="fchest">${Art.icon('gift', { c: '#FFE9B0' })}</span><em class="num" id="freeT" data-gift="1">${freeLeft > 0 ? fmtLeft(freeLeft) : t('hub.gift')}</em></button>
      </div>
    </div>
    <div class="playzone play-grid">
      <button class="b3 modebtn rise" style="--d:2" data-modebtn="free" data-press><span class="mb-i"><img src="${ILL['ic-swirl']}" alt="" width="120" height="120"></span><span class="mb-t"><b>${t('mode.free')}</b><small>${t('hub.freeSub')}</small></span></button>
      <button class="b3 modebtn gold rise" style="--d:3" data-modebtn="ranked" data-press><span class="mb-i"><img src="${ILL['ic-cross']}" alt="" width="120" height="120"></span><span class="mb-t"><b>${t('hub.online')}</b><small>${t('hub.onlineSub')}</small></span></button>
      <button class="b3 modebtn dark rise" style="--d:4" data-modebtn="practice" data-press><span class="mb-i"><img src="${ILL['ic-basket']}" alt="" width="120" height="120"></span><span class="mb-t"><b>${t('mode.practice')}</b><small>${t('hub.practiceSub')}</small></span></button>
      <button class="b3 modebtn dark rise" style="--d:5" data-modebtn="career" data-press><span class="mb-i"><img src="${ILL['ic-medalp']}" alt="" width="120" height="120"></span><span class="mb-t"><b>${t('hub.career')}</b><small>${t('hub.careerSub')}</small></span></button>
    </div>
    ${this.friendsBar()}
    </div>`;
  },
  /* Друзья-лента (3 друга + «+» к рефералке):
   * в матче — мини-ракетка (красная накладка, жёлтая ручка) на месте точки;
   * онлайн — зелёная точка; оффлайн — ч/б аватарка. */
  friendsBar() {
    const F = [
      { i: 0, st: 'play' },   // М. Дорохов — играет
      { i: 1, st: 'on' },     // А. Коваль — онлайн
      { i: 5, st: 'off' }     // Д. Мороз — оффлайн
    ];
    const on = F.filter((f) => f.st !== 'off').length;
    return `<div class="friends rise" style="--d:6">
      <button class="fr-band" data-act="friends" data-press>
        <span class="fr-band-t">${Art.icon('users', { c: '#9BE8FF' })}<b>${t('common.friends')}</b><i class="fr-band-on num">${t('hub.onlineCount', { n: on })}</i></span>
        <span class="fr-list">${F.map((f) => { const p = PEOPLE[f.i]; return `<span class="fr-c st-${f.st}" data-f="${f.i}">
          <span class="fr-av">${Art.avatar('p' + f.i, 46)}${f.st === 'play'
            ? `<span class="fr-pd">${Art.paddle('#E8202A', 22, { handle: '#F5C25E', rot: 20 })}</span>`
            : `<i class="fr-dot ${f.st}"></i>`}</span>
          <b>${p.s.split(' ')[0]}</b>
        </span>`; }).join('')}<span class="fr-c fr-inv"><span class="fr-av">${Art.icon('plus', { c: '#9BE8FF', sw: 2.6 })}</span><b>${t('hub.invite')}</b></span></span>
      </button>
    </div>`;
  },
  /* Панель подарка: ежедневный бонус + все сундуки одним списком */
  giftsSheet(btn) {
    const left = (S.freeAt || 0) - Date.now();
    const chestRows = S.chests.map((c, i) => {
      if (!c) return `<div class="gf-row dim"><span class="gf-art">${Art.chest('wood', 34, { ghost: true })}</span><span class="gf-t">${t('hub.slotEmptyHint')}</span></div>`;
      const C = Art.CHEST[c.kind];
      const st = c.state === 'ready' ? `<button class="b3 green sm" data-gchest="${i}">${t('common.open')}</button>`
        : c.state === 'unlocking' ? `<span class="chip num" data-ends="${c.endsAt}">${fmtLeft(c.endsAt - Date.now())}</span>`
        : `<span class="chip">${Art.chestName(c.kind)}</span>`;
      return `<div class="gf-row"><span class="gf-art">${Art.chest(c.kind, 40)}</span><span class="gf-t"><b>${Art.chestName(c.kind)} ${t('chest.word')}</b><small>${c.state === 'ready' ? t('chest.ready') : c.state === 'unlocking' ? t('chest.unlocking') : t('chest.queued')}</small></span>${st}</div>`;
    }).join('');
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('hub.giftsTitle')}</div>
      <div class="pnl gf-gift"><span class="gf-art big">${Art.icon('gift', { c: '#FFE9B0' })}</span>
        <span class="gf-t"><b>${t('hub.dailyGift')}</b><small>${left > 0 ? t('hub.giftIn', { time: fmtLeft(left) }) : t('hub.giftReady')}</small></span>
        <button class="b3 ${left > 0 ? 'dark' : 'cyan'} sm" data-gift="1" ${left > 0 ? 'disabled' : ''}>${left > 0 ? t('hub.giftRefresh', { time: fmtLeft(left) }) : t('common.claim')}</button></div>
      <div class="pnl" style="margin-top:10px;display:grid;gap:10px">${chestRows}</div>`, {
      onOpen: (w) => {
        w.addEventListener('click', (e) => {
          const g = e.target.closest('[data-gift]');
          if (g && Date.now() >= (S.freeAt || 0)) {
            S.freeAt = Date.now() + FREE_MS; save(); UI.refreshNotifications();
            const p = FX.pt(g); Wallet.add('coins', 40, p); FX.twinkles(p.x, p.y, 30, 8); haptic('success');
            toast(t('hub.giftToast', { n: 40 }), 'gift');
            Sheet.close(); return;
          }
          const ch = e.target.closest('[data-gchest]');
          if (ch) { Sheet.close(); Router.go('chest', { data: { kind: S.chests[+ch.dataset.gchest].kind, slot: +ch.dataset.gchest } }); }
        });
      }
    });
  },
  slot(c, i) {
    if (!c) return `<div class="slot empty rise" style="--d:${4 + i}"><span>${t('chest.slotEmpty')}</span></div>`;
    const C = Art.CHEST[c.kind];
    if (c.state === 'ready') return `<button class="slot ready rar ${C.rar} beam rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 58)}</span><b class="open">${t('common.open')}</b></button>`;
    if (c.state === 'unlocking') return `<button class="slot unl rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 50)}</span><b class="num" data-ends="${c.endsAt}">${fmtLeft(c.endsAt - Date.now())}</b><span class="skip">${Art.gem(14)}18</span></button>`;
    return `<button class="slot lock rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 50)}</span><b>${Art.chestName(c.kind)}</b><span class="skip">${Art.icon('clock', { c: '#9BE8FF', sw: 2.6 })}${fmtLeft(UNLOCK_MS[c.kind] || UNLOCK_MS.silver)}</span></button>`;
  },
  mount(el) {
    UI.bindHud(el);
    this.el = el;
    // живой стол: настоящий движок за интерфейсом (бот против бота, облёт камеры);
    // на «Эконом» — лёгкая 2D-заглушка
    this.lobby = S.quality !== 'low';
    if (this.lobby) {
      el.classList.add('lobby');
      GameHost.ensure(); GameHost.send('quiet', { on: true }); GameHost.send('lobby'); GameHost.show(true, 'lobby');
    }
    const cv = el.querySelector('canvas.demo');
    if (this.lobby) cv.style.display = 'none';
    else this.game = new TT.Game(cv, { mode: 'demo', cam: { y: -1.55, z: 1.15, pitch: 25, f: .92, cy: .5, swayAmp: 9 }, spd: .38, diff: .9 });
    const g = this.game;
    if (g) {
      g.on = (ev, d) => {
        if (ev === 'point') setTimeout(() => !g.dead && g.serve(Math.random() < .5 ? 'p' : 'o'), 700);
      };
      setTimeout(() => g.serve('o'), 600);
    }
    // дорога лиги
    setTimeout(() => { const i = el.querySelector('.road .bar i'); i && i.style.setProperty('--p', i.dataset.p); }, 400);
    // таймеры: слоты сундуков + кулдаун подарка — оба живые, без застывших подписей
    this.timer = setInterval(() => {
      $$('[data-ends]', el).forEach((b) => (b.textContent = fmtLeft(+b.dataset.ends - Date.now())));
      const gft = el.querySelector('#freeT');
      if (gft) {
        const left = (S.freeAt || 0) - Date.now();
        gft.textContent = left > 0 ? fmtLeft(left) : t('hub.gift');
        const fab = gft.closest('.fab'); fab && fab.classList.toggle('free', left <= 0);
      }
      UI.refreshNotifications();
    }, 1000);
    el.addEventListener('click', (e) => {
      /* Router.go при busy молча возвращается: тап по плитке во время перехода
       * splash → hub терялся без всякого ответа. Ждём освобождения и повторяем. */
      const goRoute = (id, opt) => {
        if (!Router.screens[id]) return;
        if (!Router.busy) { Router.go(id, opt); return; }
        let tries = 0;
        const tick = () => {
          if (!Router.busy) { if (Router.cur !== id) Router.go(id, opt); }
          else if (++tries < 40) setTimeout(tick, 50);
        };
        setTimeout(tick, 50);
      };
      const a = e.target.closest('[data-act],[data-modebtn],[data-chest],[data-f]'); if (!a) return;
      const mb = a.dataset.modebtn;
      if (mb) {
        const p = FX.pt(a); FX.burst(p.x, p.y, { count: 24, speed: 9 }); haptic('heavy');
        TGX.fullscreen(true);          // иммерсивный режим запрашиваем из жеста — так требует клиент
        MODE = MODES.find((m) => m.id === mb) || MODE;
        if (mb === 'free') {
          /* Свободная игра стартует сразу: без радара и VS — только спарринг
           * без счёта и без последствий для рейтинга. */
          BATTLE = { opp: pick(MM_POOL[leagueOf(S.rating).id] || MM_POOL.bronze) };
          goRoute('match');
          return;
        }
        if (mb === 'practice') goRoute('train', { data: { then: 'hub' } });
        else if (mb === 'career') goRoute('profile');
        /* Плитка подписана «Онлайн» — значит ведёт в лобби матча с другом,
         * а не в радар под бота: рейтинговый бой остаётся большой кнопкой. */
        else if (mb === 'ranked') goRoute('online');
        else goRoute('mm');
        return;
      }
      if (a.dataset.chest !== undefined) return this.chestTap(+a.dataset.chest, a);
      if (a.dataset.f !== undefined) return this.friendsSheet();
      const k = a.dataset.act;
      if (k === 'play') {
        const p = FX.pt(a); FX.burst(p.x, p.y, { count: 30, speed: 11 }); haptic('heavy');
        TGX.fullscreen(true);
        if (MODE.id === 'free') {
          BATTLE = { opp: pick(MM_POOL[leagueOf(S.rating).id] || MM_POOL.bronze) };
          goRoute('match');
        }
        else if (MODE.id === 'practice') goRoute('train', { data: { then: 'hub' } });
        else goRoute('mm');
      }
      if (k === 'mode' && this.modeSheet) this.modeSheet();
      if (k === 'ranks') Router.go('ranks');
      if (k === 'quests') this.questSheet();
      if (k === 'events') this.eventsSheet();
      if (k === 'friends') this.friendsSheet();
      if (k === 'gifts') this.giftsSheet(a);
    });
    // пасхалка: тап по столу = искры
    cv.addEventListener('pointerdown', (e) => { const p = FX.pt({ getBoundingClientRect: () => ({ left: e.clientX, top: e.clientY, width: 0, height: 0 }) }); FX.burst(p.x, p.y, { c: ['#2EE6FF', '#fff'], count: 12, speed: 6, size: .7 }); Sfx.paddle(1.2); });
  },
  leave() { this.game && this.game.destroy(); this.game = null; this.el = null; clearInterval(this.timer); if (this.lobby) { GameHost.show(false); GameHost.send('attract'); } },
  chestTap(i, btn) {
    const c = S.chests[i]; if (!c) return;
    if (c.state === 'ready') { Router.go('chest', { data: { kind: c.kind, slot: i } }); return; }
    if (c.state === 'unlocking') {
      Sheet.open(`<div class="chest-sheet"><div class="cs-art">${Art.chest(c.kind, 150)}</div><div class="h1">${Art.chestName(c.kind)} ${t('chest.word')}</div>
        <p class="mut">${t('chest.opensIn')} <b class="num" data-ends="${c.endsAt}">${fmtLeft(c.endsAt - Date.now())}</b></p>
        <div class="cs-loot"><span>${Art.coin(28)}<b>240–320</b></span><span>${Art.gem(26)}<b>4–8</b></span><span>${Art.icon('paddle', { c: '#D9C6FF' })}<b>${t('chest.rareCard')}</b></span></div>
        <button class="b3 cyan block" data-act="skip"><span class="shine"></span>${t('chest.openNow')} · ${Art.gem(22)} 18</button></div>`, {
        onOpen: (w) => w.querySelector('[data-act=skip]').addEventListener('click', (e) => { if (!Wallet.spend('gems', 18, FX.pt(e.currentTarget))) return; c.state = 'ready'; save(); Sheet.close(); setTimeout(() => Router.go('chest', { data: { kind: c.kind, slot: i } }), 350); })
      });
      return;
    }
    // 'locked': тап ЗАПУСКАЕТ открытие, если очередь свободна. Занята — честно объясняем.
    if (S.chests.some((x) => x && x.state === 'unlocking')) {
      toast(t('hub.chestWaitFirst'), 'clock');
      btn.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      Sfx.error(); return;
    }
    const ms = UNLOCK_MS[c.kind] || UNLOCK_MS.silver;
    c.state = 'unlocking'; c.endsAt = Date.now() + ms; save();
    btn.outerHTML = this.slot(c, i);   // подменяем слот прямо на месте — он начинает считать
    toast(t('chest.opensInToast', { name: Art.chestName(c.kind) + ' ' + t('chest.word'), time: fmtLeft(ms) }), 'clock');
    haptic('medium');
  },
  modeSheet() {
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('hub.chooseMode')}</div><div class="modes">${MODES.map((m, i) => `
      <button class="mcard ${m.c} ${m.id === MODE.id ? 'on' : ''}" data-m="${m.id}" style="--d:${i}">
        <span class="mic">${Art.icon(m.i, { c: '#fff' })}</span><span class="mt"><b>${t(m.tk)}</b><small>${t(m.sk)}</small></span><span class="chip">${modeTag(m)}</span>
      </button>`).join('')}</div>`, {
      onOpen: (w) => {
        $$('.mcard', w).forEach((c) => UI.tilt(c, 6));
        w.addEventListener('click', (e) => { const b = e.target.closest('.mcard'); if (!b) return; MODE = MODES.find((m) => m.id === b.dataset.m); haptic('medium');
          const p = FX.pt(b); FX.burst(p.x, p.y, { count: 14, speed: 7, size: .8 });
          Sheet.close(); const chip = $('.screen.current .mode-chip'); if (chip) { chip.querySelector('b').textContent = t(MODE.tk); chip.querySelector('.mi').innerHTML = Art.icon(MODE.i, { c: '#FFE28A' }); bump(chip); } });
      }
    });
  },
  questSheet() {
    const items = Daily.items();
    const left = Daily.msLeftToday(); const lh = Math.floor(left / 3600000), lm = Math.floor(left % 3600000 / 60000);
    Sheet.open(`<div class="h1" style="margin:4px 4px 4px">${t('hub.questsTitle')}</div><p class="dim" style="margin:0 4px 14px;font-size:12px">${t('quests.refreshIn', { h: lh, m: lm })}</p>
      ${items.map((q, i) => { return `<div class="quest pnl"><div class="qi">${q.k === 'gems' ? Art.gem(34) : Art.coin(34)}<b>+${q.r}</b></div>
        <div class="qb"><b>${q.t}</b><div class="bar ${q.done ? 'green' : ''}"><i style="--p:${q.p / q.m}"></i><span class="lbl">${q.p}/${q.m}</span></div></div>
        ${q.done
          ? (q.claimed ? `<span class="chip green">${Art.icon('check', { c: '#9CFFD0' })}</span>`
                     : `<button class="b3 green sm" data-q="${q.id}" data-k="${q.k}" data-r="${q.r}">${t('common.claim')}</button>`)
          : `<span class="chip">${Math.round(q.p / q.m * 100)}%</span>`}</div>`; }).join('')}`, {
      onOpen: (w) => w.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]'); if (!b) return;
        const q = Daily.claim(b.dataset.q); if (!q) return;
        const p = FX.pt(b); FX.burst(p.x, p.y, { count: 20 }); Wallet.add(b.dataset.k, +b.dataset.r, p);
        b.outerHTML = `<span class="chip green">${Art.icon('check', { c: '#9CFFD0' })}</span>`; UI.refreshNotifications(); haptic('success');
      })
    });
  },
  /* События: честные анонсы — без кнопок, которые ведут в никуда */
  eventsSheet() {
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('hub.events')}</div>
      <div class="pnl ev-row"><span class="ev-ic">${Art.icon('trophy', { c: '#FFE28A' })}</span><span class="ev-tx"><b>${t('ev.cupName')}</b><small>${t('ev.cupDesc')}</small></span><span class="chip gold">${t('common.soon')}</span></div>
      <div class="pnl ev-row"><span class="ev-ic">${Art.icon('users', { c: '#9BE8FF' })}</span><span class="ev-tx"><b>${t('ev.weekendName')}</b><small>${t('ev.weekendDesc')}</small></span><span class="chip">${t('common.soon')}</span></div>
      <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.55">${t('ev.note')}</p>`);
  },
  /* Друзья: реальные люди из клуба; матчи по ссылке сознательно отключены */
  friendsSheet() {
    const F = [[0, PEOPLE[0]], [5, PEOPLE[5]]];
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('common.friends')}</div>
      <div class="pnl sgroup">${F.map(([i, p]) => `<div class="fr-row">${Art.avatar('p' + i, 42)}<span class="fr-n"><b>${p.s}</b><small>${p.club} · ${fmt(p.r)}</small></span><button class="b3 dark sm" disabled>${t('common.soonCap')}</button></div>`).join('')}</div>
      <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.55">${t('friends.note')}</p>`);
  }
});

/* ---------------- Настройки (лист) ---------------- */
/* Калибровка: личные предпочтения, которые позже станут основными.
   10 параметров со слайдерами, всё живёт в S.cal. */