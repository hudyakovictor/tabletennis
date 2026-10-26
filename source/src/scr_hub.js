/* =====================================================================
   HUB — «Арена»: живой стол с розыгрышем ИИ vs ИИ, дорога лиги,
   огромная кнопка «В бой», слоты сундуков, боковые ярлыки.
   ===================================================================== */
const MODES = [
  { id: 'ranked', t: 'Рейтинговый', s: 'Очки лиги · соперник твоего уровня', i: 'crown', c: 'gold', diff: .62, tag: '±24' },
  { id: 'quick', t: 'Быстрый матч', s: 'Без риска для рейтинга · до 7', i: 'bolt', c: 'coral', diff: .5, tag: '~20 с' },
  { id: 'practice', t: 'Тренировка', s: 'Обучение с наставником · 6 шагов', i: 'target', c: 'violet', diff: .35, tag: '2 мин' }
];
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
    <div class="road rise" style="--d:0" data-act="ranks">
      <span class="rb">${Art.badge(L, 34)}</span>
      <div class="bar gold"><i style="--p:0" data-p="${p}"></i><span class="lbl num">${fmt(S.rating)} / ${N ? fmt(N.min) : '∞'}</span></div>
      <span class="rb next">${N ? Art.badge(N, 34) : ''}</span>
    </div>
    <div class="hero">
      <canvas class="demo"></canvas>
      <div class="arena-title"><small>Настольный теннис</small><b>TABLE TENNIS</b><b class="alt">ULTIMATE</b></div>
      <div class="side l">
        <button class="fab pop" style="--d:2" data-act="quests" data-press><span class="fic"><img src="${ILL['ic-quest']}" alt="" width="34" height="34"></span>${qr ? `<span class="dot">${qr}</span>` : ''}<em>Задания</em></button>
        <button class="fab pop" style="--d:3" data-act="events" data-press><span class="fic"><img src="${ILL['ic-trophy']}" alt="" width="34" height="34"></span><em>События</em></button>
      </div>
      <div class="side r">
        <button class="fab pop ${freeLeft <= 0 ? 'free' : ''}" style="--d:2" data-act="gifts" data-press><span class="fchest">${Art.icon('gift', { c: '#FFE9B0' })}</span><em class="num" id="freeT" data-gift="1">${freeLeft > 0 ? fmtLeft(freeLeft) : 'Подарок'}</em></button>
      </div>
    </div>
    <div class="playzone play-grid">
      <button class="b3 modebtn rise" style="--d:2" data-modebtn="quick" data-press><span class="shine"></span><span class="mb-i"><img src="${ILL['ic-swirl']}" alt="" width="34" height="34"></span><span class="mb-t"><small>до 7 · без риска</small><b>Быстрый матч</b></span></button>
      <button class="b3 modebtn gold rise" style="--d:3" data-modebtn="ranked" data-press><span class="shine"></span><span class="mb-i"><img src="${ILL['ic-cross']}" alt="" width="34" height="34"></span><span class="mb-t"><small>рейтинг ±24</small><b>Онлайн</b></span></button>
      <button class="b3 modebtn dark rise" style="--d:4" data-modebtn="practice" data-press><span class="shine"></span><span class="mb-i"><img src="${ILL['ic-basket']}" alt="" width="34" height="34"></span><span class="mb-t"><small>6 шагов с наставником</small><b>Практика</b></span></button>
      <button class="b3 modebtn dark rise" style="--d:5" data-modebtn="career" data-press><span class="shine"></span><span class="mb-i"><img src="${ILL['ic-medalp']}" alt="" width="34" height="34"></span><span class="mb-t"><small>статистика и рост</small><b>Карьера</b></span></button>
    </div>
    ${this.friendsBar()}`;
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
        <span class="fr-band-t">${Art.icon('users', { c: '#9BE8FF' })}<b>Друзья</b><i class="fr-band-on num">${on} онлайн</i></span>
        <span class="fr-list">${F.map((f) => { const p = PEOPLE[f.i]; return `<span class="fr-c st-${f.st}" data-f="${f.i}">
          <span class="fr-av">${Art.avatar('p' + f.i, 46)}${f.st === 'play'
            ? `<span class="fr-pd">${Art.paddle('#E8202A', 22, { handle: '#F5C25E', rot: 20 })}</span>`
            : `<i class="fr-dot ${f.st}"></i>`}</span>
          <b>${p.s.split(' ')[0]}</b>
        </span>`; }).join('')}<span class="fr-c fr-inv"><span class="fr-av">${Art.icon('plus', { c: '#9BE8FF', sw: 2.6 })}</span><b>Зови</b></span></span>
      </button>
    </div>`;
  },
  /* Панель подарка: ежедневный бонус + все сундуки одним списком */
  giftsSheet(btn) {
    const left = (S.freeAt || 0) - Date.now();
    const chestRows = S.chests.map((c, i) => {
      if (!c) return `<div class="gf-row dim"><span class="gf-art">${Art.chest('wood', 34, { ghost: true })}</span><span class="gf-t">Слот пуст — выиграй сундук в матче</span></div>`;
      const C = Art.CHEST[c.kind];
      const st = c.state === 'ready' ? `<button class="b3 green sm" data-gchest="${i}">Открыть</button>`
        : c.state === 'unlocking' ? `<span class="chip num" data-ends="${c.endsAt}">${fmtLeft(c.endsAt - Date.now())}</span>`
        : `<span class="chip">${C.n}</span>`;
      return `<div class="gf-row"><span class="gf-art">${Art.chest(c.kind, 40)}</span><span class="gf-t"><b>${C.n} сундук</b><small>${c.state === 'ready' ? 'Готов к открытию' : c.state === 'unlocking' ? 'Открывается…' : 'В очереди на открытие'}</small></span>${st}</div>`;
    }).join('');
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">Подарок и сундуки</div>
      <div class="pnl gf-gift"><span class="gf-art big">${Art.icon('gift', { c: '#FFE9B0' })}</span>
        <span class="gf-t"><b>Ежедневный подарок</b><small>${left > 0 ? 'Будет доступен через ' + fmtLeft(left) : '+40 монет — уже ждёт'}</small></span>
        <button class="b3 ${left > 0 ? 'dark' : 'cyan'} sm" data-gift="1" ${left > 0 ? 'disabled' : ''}>${left > 0 ? 'Обновление ' + fmtLeft(left) : 'Забрать'}</button></div>
      <div class="pnl" style="margin-top:10px;display:grid;gap:10px">${chestRows}</div>`, {
      onOpen: (w) => {
        w.addEventListener('click', (e) => {
          const g = e.target.closest('[data-gift]');
          if (g && Date.now() >= (S.freeAt || 0)) {
            S.freeAt = Date.now() + FREE_MS; save();
            const p = FX.pt(g); Wallet.add('coins', 40, p); FX.twinkles(p.x, p.y, 30, 8); haptic('success');
            toast('Ежедневный подарок: +40 монет', 'gift');
            Sheet.close(); return;
          }
          const ch = e.target.closest('[data-gchest]');
          if (ch) { Sheet.close(); Router.go('chest', { data: { kind: S.chests[+ch.dataset.gchest].kind, slot: +ch.dataset.gchest } }); }
        });
      }
    });
  },
  slot(c, i) {
    if (!c) return `<div class="slot empty rise" style="--d:${4 + i}"><span>Пустой<br>слот</span></div>`;
    const C = Art.CHEST[c.kind];
    if (c.state === 'ready') return `<button class="slot ready rar ${C.rar} beam rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 58)}</span><b class="open">Открыть</b></button>`;
    if (c.state === 'unlocking') return `<button class="slot unl rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 50)}</span><b class="num" data-ends="${c.endsAt}">${fmtLeft(c.endsAt - Date.now())}</b><span class="skip">${Art.gem(14)}18</span></button>`;
    return `<button class="slot lock rise" style="--d:${4 + i}" data-chest="${i}" data-press><span class="sc">${Art.chest(c.kind, 50)}</span><b>${C.n}</b><span class="skip">${Art.icon('clock', { c: '#9BE8FF', sw: 2.6 })}${fmtLeft(UNLOCK_MS[c.kind] || UNLOCK_MS.silver)}</span></button>`;
  },
  mount(el) {
    UI.bindHud(el);
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
        gft.textContent = left > 0 ? fmtLeft(left) : 'Подарок';
        const fab = gft.closest('.fab'); fab && fab.classList.toggle('free', left <= 0);
      }
    }, 1000);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act],[data-modebtn],[data-chest],[data-f]'); if (!a) return;
      const mb = a.dataset.modebtn;
      if (mb) {
        const p = FX.pt(a); FX.burst(p.x, p.y, { count: 24, speed: 9 }); haptic('heavy');
        TGX.fullscreen(true);          // иммерсивный режим запрашиваем из жеста — так требует клиент
        MODE = MODES.find((m) => m.id === mb) || MODE;
        if (mb === 'practice') Router.go('train', { data: { then: 'hub' } });
        else if (mb === 'career') Router.go('profile');
        else Router.go('mm');
        return;
      }
      if (a.dataset.chest !== undefined) return this.chestTap(+a.dataset.chest, a);
      if (a.dataset.f !== undefined) return this.friendsSheet();
      const k = a.dataset.act;
      if (k === 'play') {
        const p = FX.pt(a); FX.burst(p.x, p.y, { count: 30, speed: 11 }); haptic('heavy');
        TGX.fullscreen(true);
        if (MODE.id === 'practice') Router.go('train', { data: { then: 'hub' } });
        else Router.go('mm');
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
  leave() { this.game && this.game.destroy(); this.game = null; clearInterval(this.timer); if (this.lobby) { GameHost.show(false); GameHost.send('attract'); } },
  chestTap(i, btn) {
    const c = S.chests[i]; if (!c) return;
    if (c.state === 'ready') { Router.go('chest', { data: { kind: c.kind, slot: i } }); return; }
    if (c.state === 'unlocking') {
      Sheet.open(`<div class="chest-sheet"><div class="cs-art">${Art.chest(c.kind, 150)}</div><div class="h1">${Art.CHEST[c.kind].n} сундук</div>
        <p class="mut">Откроется через <b class="num" data-ends="${c.endsAt}">${fmtLeft(c.endsAt - Date.now())}</b></p>
        <div class="cs-loot"><span>${Art.coin(28)}<b>240–320</b></span><span>${Art.gem(26)}<b>4–8</b></span><span>${Art.icon('paddle', { c: '#D9C6FF' })}<b>Редкая карта</b></span></div>
        <button class="b3 cyan block" data-act="skip"><span class="shine"></span>Открыть сейчас · ${Art.gem(22)} 18</button></div>`, {
        onOpen: (w) => w.querySelector('[data-act=skip]').addEventListener('click', (e) => { if (!Wallet.spend('gems', 18, FX.pt(e.currentTarget))) return; c.state = 'ready'; save(); Sheet.close(); setTimeout(() => Router.go('chest', { data: { kind: c.kind, slot: i } }), 350); })
      });
      return;
    }
    // 'locked': тап ЗАПУСКАЕТ открытие, если очередь свободна. Занята — честно объясняем.
    if (S.chests.some((x) => x && x.state === 'unlocking')) {
      toast('Сначала дождись открытия другого сундука', 'clock');
      btn.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      Sfx.error(); return;
    }
    const ms = UNLOCK_MS[c.kind] || UNLOCK_MS.silver;
    c.state = 'unlocking'; c.endsAt = Date.now() + ms; save();
    btn.outerHTML = this.slot(c, i);   // подменяем слот прямо на месте — он начинает считать
    toast(`${Art.CHEST[c.kind].n} сундук откроется через ${fmtLeft(ms)}`, 'clock');
    haptic('medium');
  },
  modeSheet() {
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">Выбери режим</div><div class="modes">${MODES.map((m, i) => `
      <button class="mcard ${m.c} ${m.id === MODE.id ? 'on' : ''}" data-m="${m.id}" style="--d:${i}">
        <span class="mic">${Art.icon(m.i, { c: '#fff' })}</span><span class="mt"><b>${m.t}</b><small>${m.s}</small></span><span class="chip">${m.tag}</span>
      </button>`).join('')}</div>`, {
      onOpen: (w) => {
        $$('.mcard', w).forEach((c) => UI.tilt(c, 6));
        w.addEventListener('click', (e) => { const b = e.target.closest('.mcard'); if (!b) return; MODE = MODES.find((m) => m.id === b.dataset.m); haptic('medium');
          const p = FX.pt(b); FX.burst(p.x, p.y, { count: 14, speed: 7, size: .8 });
          Sheet.close(); const chip = $('.screen.current .mode-chip'); if (chip) { chip.querySelector('b').textContent = MODE.t; chip.querySelector('.mi').innerHTML = Art.icon(MODE.i, { c: '#FFE28A' }); bump(chip); } });
      }
    });
  },
  questSheet() {
    const items = Daily.items();
    const left = Daily.msLeftToday(); const lh = Math.floor(left / 3600000), lm = Math.floor(left % 3600000 / 60000);
    Sheet.open(`<div class="h1" style="margin:4px 4px 4px">Задания дня</div><p class="dim" style="margin:0 4px 14px;font-size:12px">Обновятся через ${lh}ч ${lm}м</p>
      ${items.map((q, i) => { return `<div class="quest pnl"><div class="qi">${q.k === 'gems' ? Art.gem(34) : Art.coin(34)}<b>+${q.r}</b></div>
        <div class="qb"><b>${q.t}</b><div class="bar ${q.done ? 'green' : ''}"><i style="--p:${q.p / q.m}"></i><span class="lbl">${q.p}/${q.m}</span></div></div>
        ${q.done
          ? (q.claimed ? `<span class="chip green">${Art.icon('check', { c: '#9CFFD0' })}</span>`
                     : `<button class="b3 green sm" data-q="${q.id}" data-k="${q.k}" data-r="${q.r}">Забрать</button>`)
          : `<span class="chip">${Math.round(q.p / q.m * 100)}%</span>`}</div>`; }).join('')}`, {
      onOpen: (w) => w.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]'); if (!b) return;
        const q = Daily.claim(b.dataset.q); if (!q) return;
        const p = FX.pt(b); FX.burst(p.x, p.y, { count: 20 }); Wallet.add(b.dataset.k, +b.dataset.r, p);
        b.outerHTML = `<span class="chip green">${Art.icon('check', { c: '#9CFFD0' })}</span>`; haptic('success');
      })
    });
  },
  /* События: честные анонсы — без кнопок, которые ведут в никуда */
  eventsSheet() {
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">События</div>
      <div class="pnl ev-row"><span class="ev-ic">${Art.icon('trophy', { c: '#FFE28A' })}</span><span class="ev-tx"><b>Кубок сезона</b><small>Одиночный турнир на 16 соперников. Награда — эпический сундук и гемы.</small></span><span class="chip gold">скоро</span></div>
      <div class="pnl ev-row"><span class="ev-ic">${Art.icon('users', { c: '#9BE8FF' })}</span><span class="ev-tx"><b>Лига выходного дня</b><small>Серия коротких матчей с двойным рейтингом — суббота и воскресенье.</small></span><span class="chip">скоро</span></div>
      <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.55">О старте события пришлём уведомление.</p>`);
  },
  /* Друзья: реальные люди из клуба; матчи по ссылке сознательно отключены */
  friendsSheet() {
    const F = [[0, PEOPLE[0]], [5, PEOPLE[5]]];
    Sheet.open(`<div class="h1" style="margin:4px 4px 14px">Друзья</div>
      <div class="pnl sgroup">${F.map(([i, p]) => `<div class="fr-row">${Art.avatar('p' + i, 42)}<span class="fr-n"><b>${p.s}</b><small>${p.club} · ${fmt(p.r)}</small></span><button class="b3 dark sm" disabled>Скоро</button></div>`).join('')}</div>
      <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.55">Матчи по ссылке в чате появятся в следующем обновлении. Пока тренируйся в рейтинговых матчах.</p>`);
  }
});

/* ---------------- Настройки (лист) ---------------- */
/* Калибровка: личные предпочтения, которые позже станут основными.
   10 параметров со слайдерами, всё живёт в S.cal. */
const CAL = [
  { k: 'camHeight', t: 'Высота камеры', d: 'Ниже — вид как у игрока за столом, выше — обзор сверху', min: 0, max: 100, def: 50 },
  { k: 'camZoom', t: 'Приближение камеры', d: 'Насколько близко стол к кадру в розыгрыше', min: 0, max: 100, def: 50 },
  { k: 'camSway', t: 'Покачивание камеры', d: 'Кинематографичный дрейф в подачах и паузах; 0 — камера статична', min: 0, max: 100, def: 40 },
  { k: 'padSpeed', t: 'Скорость ракетки', d: 'Насколько резво ракетка следует за пальцем', min: 0, max: 100, def: 55 },
  { k: 'padSmooth', t: 'Сглаживание ракетки', d: 'Убирает дёрганье пальца; 0 — мгновенный отклик, 100 — плавно, но с задержкой', min: 0, max: 100, def: 35 },
  { k: 'ballSize', t: 'Размер мяча на экране', d: 'Только визуал; физический размер по регламенту не трогаем', min: 0, max: 100, def: 50 },
  { k: 'trailLen', t: 'Длина шлейфа мяча', d: 'Штрих-движок подчёркивает скорость удара; 0 — шлейф выключен', min: 0, max: 100, def: 45 },
  { k: 'tableGlow', t: 'Яркость стола', d: 'Свечение разметки и плашки стола на тёмной арене', min: 0, max: 100, def: 50 },
  { k: 'flytime', t: 'Скорость мяча', d: 'Общий темп матча: ниже — больше времени на реакцию, тренировочный режим', min: 0, max: 100, def: 50 },
  { k: 'hintRadius', t: 'Кольцо подсказки', d: 'Размер кольца в точке встречи с мячом; уменьшай по мере прогресса', min: 0, max: 100, def: 60 }
];
function openSettings() {
  const row = (k, t, i, d) => `<div class="srow"><span class="si">${Art.icon(i, { c: '#9BE8FF' })}</span><span class="st"><b>${t}</b><small>${d}</small></span><button class="tgl ${S[k] ? 'on' : ''}" data-k="${k}" aria-label="${t}"></button></div>`;
  S.cal = S.cal || {};
  const cal = CAL.map((c) => { const v = S.cal[c.k] !== undefined ? S.cal[c.k] : c.def; return `<div class="calrow"><div class="cal-t"><b>${c.t}</b><small>${c.d}</small></div><div class="cal-c"><input type="range" min="${c.min}" max="${c.max}" value="${v}" data-cal="${c.k}" aria-label="${c.t}"><span class="cal-v num" data-calv="${c.k}">${v}</span></div></div>`; }).join('');
  Sheet.open(`<div class="h1" style="margin:4px 4px 14px">Настройки</div>
    <div class="pnl sgroup">${row('sfx', 'Звуки', 'sound', 'Удары, монеты, интерфейс')}${row('vibro', 'Вибрация', 'vibe', 'Хаптика Telegram')}${row('hint', 'Подсказка удара', 'target', 'Кольцо в точке встречи с мячом')}${row('rm', 'Меньше движения', 'motion', 'Без тряски и вспышек')}</div>
    <div class="cap" style="margin:18px 4px 8px">Качество графики</div>
    <div class="seg" id="qseg"><span class="pill"></span>${['high', 'mid', 'low'].map((q) => `<button data-v="${q}" class="${S.quality === q ? 'on' : ''}">${{ high: 'Высокое', mid: 'Среднее', low: 'Эконом' }[q]}</button>`).join('')}</div>
    <div class="cap" style="margin:18px 4px 8px">Калибровка <small class="dim" style="text-transform:none;font-weight:400;font-size:11px">· подбери под себя — позже станет стандартом</small></div>
    <details class="pnl calib"><summary class="cal-sum">${Art.icon('target', { c: '#9BE8FF' })} Открыть калибровку · 10 параметров</summary><div class="cal-list">${cal}</div></details>
    <p class="dim" style="font-size:11.5px;margin:14px 4px 0;line-height:1.5">TTU v2 · сборка 2.0.0 · Telegram Mini App</p>`, {
    onOpen: (w) => {
      w.addEventListener('click', (e) => { const row = e.target.closest('.srow'); const t = e.target.closest('.tgl') || (row && row.querySelector('.tgl')); if (!t) return; const k = t.dataset.k; S[k] = !S[k]; save(); t.classList.toggle('on', S[k]); haptic('select'); Sfx.soft(); if (k === 'rm') { document.body.classList.toggle('rm', S.rm); GameHost.ready && GameHost.send('rm', { on: S.rm }); } });
      w.addEventListener('input', (e) => {
        const r = e.target.closest('input[data-cal]'); if (!r) return;
        S.cal[r.dataset.cal] = +r.value; save();
        const v = w.querySelector(`[data-calv="${r.dataset.cal}"]`); if (v) v.textContent = r.value;
        GameHost.ready && GameHost.send('cal', { k: r.dataset.cal, v: +r.value });
      });
      UI.seg($('#qseg', w), (v) => setQuality(v));
    }
  });
}
