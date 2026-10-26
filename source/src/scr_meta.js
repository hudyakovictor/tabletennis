/* =====================================================================
   META — магазин, сезонный пропуск, рейтинг, профиль
   ===================================================================== */
const ItemArt = {
  comet(size = 90, c = '#FFC93A') {
    const g = 'cm' + Math.random().toString(36).slice(2, 7);
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><defs><linearGradient id="${g}" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity="0"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>
      <path d="M92 10L40 52a14 14 0 0 0 8 8z" fill="url(#${g})"/><path d="M80 14L36 46" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".6"/>
      <circle cx="38" cy="62" r="18" fill="#FFF8E8" stroke="${c}" stroke-width="4"/><circle cx="32" cy="56" r="5" fill="#fff"/></svg>`;
  },
  table(size = 90, c = '#2EE6FF') {
    return `<svg viewBox="0 0 100 100" width="${size}" height="${size}"><path d="M10 52L50 32l40 20-40 20z" fill="#1749B0" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M10 52v6l40 20 40-20v-6L50 72z" fill="#0A1F57"/><path d="M50 32v40" stroke="#fff" stroke-width="1.5" opacity=".8"/><path d="M28 43l44 22" stroke="#fff" stroke-width="5" opacity=".85"/>
      <path d="M18 62v20M82 62v20M50 78v14" stroke="#0A0D1E" stroke-width="4"/></svg>`;
  },
  of(it, size, opt = {}) {
    const ill = (typeof ILL !== 'undefined') && ILL['shop_' + it.id.replace('-', '_')];
    if (ill) return `<i class="ilf" style="display:block;width:${size}px;height:${size}px;background-image:url('${ill}');background-size:contain;background-position:center;background-repeat:no-repeat;-webkit-mask:radial-gradient(closest-side,#000 72%,transparent 100%);mask:radial-gradient(closest-side,#000 72%,transparent 100%)"></i>`;
    return it.kind === 'trail' ? this.comet(size, it.col) : it.kind === 'table' ? this.table(size, it.col) : it.kind === 'rubber' ? Art.rubber(it.col, size, opt) : it.kind === 'blade' ? Art.blade(it.col, size, opt) : Art.paddle(it.col, size);
  }
};
const SHOP = [
  { id: 'r-coral', n: 'Coral Spin', t: 'Накладка', kind: 'rubber', r: 'epic', price: 480, cur: 'coins', col: '#FF4B3E', st: [78, 92, 64], tag: 'Хит' },
  { id: 'r-void', n: 'Void Pulse', t: 'Накладка', kind: 'rubber', r: 'leg', price: 240, cur: 'gems', col: '#9F6BFF', st: [95, 88, 72], tag: 'Новинка' },
  { id: 'r-teal', n: 'Teal Control', t: 'Накладка', kind: 'rubber', r: 'rare', price: 520, cur: 'coins', col: '#14C8B4', st: [66, 70, 92] },
  { id: 't-gold', n: 'Золотая комета', t: 'След мяча', kind: 'trail', r: 'leg', price: 160, cur: 'gems', col: '#FFC93A', st: [0, 0, 0] },
  { id: 'tb-neon', n: 'Neon Arena', t: 'Стол', kind: 'table', r: 'epic', price: 90, cur: 'gems', col: '#2EE6FF', st: [0, 0, 0] },
  { id: 'b-ink', n: 'Ink Blade', t: 'Основание', kind: 'blade', r: 'rare', price: 720, cur: 'coins', col: '#3A4390', st: [72, 60, 80] }
];
/* Предметы вне витрины: начальный набор и дроп. Без этого реестра профиль
   показывал в слоте «След мяча» чужую накладку (fallback на SHOP[0]). */
const BONUS_ITEMS = [
  { id: 't-coral', n: 'Коралловый след', t: 'След мяча', kind: 'trail', r: 'rare', col: '#FF7A4D', st: [0, 0, 0] }
];
const ALL_ITEMS = SHOP.concat(BONUS_ITEMS);
const RN = { common: 'Обычная', rare: 'Редкая', epic: 'Эпическая', leg: 'Легендарная' };
const priceTag = (it) => `${it.cur === 'gems' ? Art.gem(18) : Art.coin(18)}<b class="num">${fmt(it.price)}</b>`;

/* ---------------- МАГАЗИН ---------------- */
Router.def('shop', {
  mood: 'shop',
  render() {
    return `${UI.hud()}<div class="scroll">
      <div class="pg-head rise" style="--d:0"><div class="h1">Магазин</div><span class="chip">${Art.icon('clock', { c: '#9BE8FF' })} <span class="num" id="shopT">05:12:44</span></span></div>
      <div class="feat rar leg beam rise" style="--d:1" data-feat>
        <div class="ft-ribbon">−45%</div>
        <div class="ft-art"><i class="ft-ill" style="background-image:url('${ILL.shop_bundle}')"></i></div>
        <div class="ft-body"><span class="cap" style="color:#FFE28A">Предложение дня</span><b class="h-display">Набор сезона</b>
          <div class="ft-items"><span class="chip gold">Coral Spin</span><span class="chip cyan">+80 гемов</span><span class="chip violet">Рамка</span></div>
          <div class="ft-buy"><s class="dim num ft-old">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })} 629</s><button class="b3 sm" data-act="stars" data-amt="349"><span class="shine"></span>${Art.icon('tstar', { c: '#3A1A00', fill: '#3A1A00' })}349</button></div></div>
        <i class="ft-shine"></i>
      </div>
      <div class="sec-title rise" style="--d:2"><span class="h2">${Art.icon('refresh', { c: '#9CFFD0' })}Ежедневные</span><span class="dim" style="font-size:11.5px">6 товаров</span></div>
      <div class="grid3">${SHOP.map((it, i) => this.card(it, i)).join('')}</div>
      <div class="sec-title rise" style="--d:9" id="gemPacks"><span class="h2">${Art.gem(22)}Гемы</span><span class="chip">${Art.icon('tg', { c: '#7DD3FF' })} Telegram Stars</span></div>
      <div class="grid3">${[{ g: 80, s: 49 }, { g: 500, s: 249, best: 1 }, { g: 1200, s: 499 }].map((p, i) => `
        <button class="pack rise ${p.best ? 'best' : ''}" style="--d:${10 + i}" data-act="stars" data-gems="${p.g}" data-amt="${p.s}" data-press>
          ${p.best ? '<span class="pk-best">Выгодно</span>' : ''}<span class="pk-art">${[...Array(i + 1)].map((_, k) => `<span style="--k:${k}">${Art.gem(i ? 46 : 54)}</span>`).join('')}</span>
          <b class="num">${p.g}</b><span class="pk-p">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })}${p.s}</span></button>`).join('')}</div>
      <div class="sec-title rise" style="--d:13"><span class="h2">${Art.coin(22)}Монеты</span></div>
      <div class="grid3">${[{ c: 500, g: 10 }, { c: 1400, g: 25 }, { c: 3200, g: 50 }].map((p, i) => `
        <button class="pack coins rise" style="--d:${14 + i}" data-act="coinpack" data-c="${p.c}" data-g="${p.g}" data-press>
          <span class="pk-art">${[...Array(i + 2)].map((_, k) => `<span style="--k:${k}">${Art.coin(42)}</span>`).join('')}</span>
          <b class="num">${fmt(p.c)}</b><span class="pk-p">${Art.gem(16)}${p.g}</span></button>`).join('')}</div>
    </div>`;
  },
  card(it, i) {
    const own = S.owned.includes(it.id);
    return `<button class="icard rar ${it.r} ${it.r === 'leg' ? 'beam' : ''} rise" style="--d:${3 + i}" data-item="${it.id}" data-press>
      ${it.tag ? `<span class="ic-tag">${it.tag}</span>` : ''}
      <span class="ic-art">${ItemArt.of(it, 64)}</span>
      <span class="ic-n">${it.n}</span><span class="ic-t">${it.t}</span>
      <span class="ic-p ${own ? 'own' : ''}">${own ? Art.icon('check', { c: '#9CFFD0' }) + 'Есть' : priceTag(it)}</span></button>`;
  },
  mount(el) {
    UI.bindHud(el); UI.tilt(el.querySelector('[data-feat]'), 8);
    let left = 5 * 3600 + 12 * 60 + 44; const t = el.querySelector('#shopT');
    this.iv = setInterval(() => { left--; if (left < 0) left += 24 * 3600; const h = left / 3600 | 0, m = (left % 3600) / 60 | 0, s = left % 60; t.textContent = [h, m, s].map((x) => String(x).padStart(2, '0')).join(':'); }, 1000);
    el.addEventListener('click', (e) => {
      const it = e.target.closest('[data-item]'); if (it) return this.product(SHOP.find((x) => x.id === it.dataset.item), it);
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'stars') this.stars(a);
      if (a.dataset.act === 'coinpack') { if (!Wallet.spend('gems', +a.dataset.g, FX.pt(a))) return; setTimeout(() => Wallet.add('coins', +a.dataset.c, FX.pt(a)), 500); }
    });
  },
  leave() { clearInterval(this.iv); },
  stars(btn) {
    const gems = +btn.dataset.gems || 80; const amt = btn.dataset.amt;
    Sheet.open(`<div class="stars-pay"><div class="sp-ic">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })}</div><div class="h1">Оплата Stars</div>
      <p class="mut">Покупка проходит в Telegram. Подтверди, чтобы получить <b>${gems} гемов</b>.</p>
      <button class="b3 block" data-a="pay"><span class="shine"></span>Оплатить ⭐ ${amt}</button><p class="dim" style="font-size:11px;margin-top:12px">Демо-режим: Stars не списываются</p></div>`, {
      onOpen: (w) => w.querySelector('[data-a=pay]').addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span>Ждём Telegram…';
        const tg = TGX.w; if (tg && tg.openInvoice && TGX.inTG) { /* invoice-ссылку выдаёт бот: tg.openInvoice(url, cb) */ }
        await sleep(900); haptic('success'); Sfx.win(); Sheet.close();
        await sleep(300); const p = FX.pt(btn); FX.burst(p.x, p.y, { c: ['#2EE6FF', '#fff', '#FFC93A'], count: 40, speed: 12 }); Wallet.add('gems', gems, p);
      })
    });
  },
  product(it, cardEl) {
    const own = S.owned.includes(it.id);
    const stats = it.st[0] ? [['Скорость', it.st[0], 'coral'], ['Вращение', it.st[1], 'gold'], ['Контроль', it.st[2], '']] : null;
    Sheet.open(`<div class="prod rar ${it.r}">
      <div class="pd-stage"><div class="pd-glow"></div>${typeof ILL !== 'undefined' && ILL['shop_' + it.id.replace('-', '_')]
        ? `<div class="pd-ill" style="background-image:url('${ILL['shop_' + it.id.replace('-', '_')]}')"></div>`
        : `<div class="pd-spin" id="pdSpin"><div class="pd-face f">${ItemArt.of(it, 170)}</div><div class="pd-face b">${ItemArt.of(it, 170, { back: true })}</div></div><span class="pd-hint">${it.kind === 'rubber' || it.kind === 'blade' ? 'Крути пальцем' : ''}</span>`}</div>
      <span class="lc-r" style="background:var(--rc)">${RN[it.r]} · ${it.t}</span>
      <div class="h1" style="margin:10px 0 4px">${it.n}</div>
      ${stats ? `<div class="pd-stats">${stats.map(([l, v, c], i) => `<div class="pds"><span>${l}</span><div class="bar ${c}"><i style="--p:0" data-p="${v / 100}"></i></div><b class="num">${v}</b></div>`).join('')}</div>`
        : `<p class="mut" style="margin:8px 0 18px;font-size:13px">${it.kind === 'trail' ? 'Огненный шлейф за мячом после твоих ударов. Виден сопернику.' : 'Арена с неоновой подсветкой кромок и отражениями.'}</p>`}
      ${own ? `<button class="b3 green block" data-a="equip"><span class="shine"></span>Экипировать</button>`
        : `<button class="b3 block hold" data-a="buy"><span class="hold-fill"></span><span class="hold-l">Держи, чтобы купить · ${priceTag(it)}</span></button>`}
    </div>`, {
      onOpen: (w) => {
        setTimeout(() => $$('.pd-stats .bar i', w).forEach((i, k) => setTimeout(() => i.style.setProperty('--p', i.dataset.p), k * 120)), 350);
        // вращение предмета
        const sp = $('#pdSpin', w); let ang = -20, vel = .4, drag = null; if (sp) {
        const tick = () => { if (!w.isConnected) return; if (!drag) { ang += vel; vel = lerp(vel, .4, .02); } sp.style.transform = `rotateY(${ang}deg) rotateX(8deg)`; requestAnimationFrame(tick); }; tick();
        const st = w.querySelector('.pd-stage');
        st.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, a: ang, t: performance.now() }; e.stopPropagation(); });
        st.addEventListener('pointermove', (e) => { if (!drag) return; const na = drag.a + (e.clientX - drag.x) * .8; vel = (na - ang); ang = na; });
        const end = () => { drag = null; }; st.addEventListener('pointerup', end); st.addEventListener('pointerleave', end); }
        const buy = w.querySelector('[data-a=buy]');
        if (buy) UI.hold(buy, 700, () => {
          if (!Wallet.spend(it.cur, it.price, FX.pt(sp))) return;
          S.owned.push(it.id); save();
          setTimeout(() => { const p = FX.pt(sp); FX.burst(p.x, p.y, { c: ['#FFC93A', '#fff', getComputedStyle(w.querySelector('.prod')).getPropertyValue('--rc').trim() || '#fff'], count: 50, speed: 14, size: 1.4 }); FX.twinkles(p.x, p.y, 80, 12); Sfx.reveal(3); haptic('success'); flash('#fff', .4); }, 650);
          buy.outerHTML = `<button class="b3 green block" data-a="equip"><span class="shine"></span>Экипировать</button>`;
          w.querySelector('.pd-stage').insertAdjacentHTML('beforeend', '<span class="pd-stamp">Куплено</span>');
          const card = $(`.screen.current [data-item="${it.id}"] .ic-p`); if (card) { card.className = 'ic-p own'; card.innerHTML = Art.icon('check', { c: '#9CFFD0' }) + 'Есть'; }
        });
        w.addEventListener('click', (e) => { if (e.target.closest('[data-a=equip]')) { S.equipped[it.kind] = it.id; save(); toast(`${it.n} экипирована`, 'check'); Sheet.close(); } });
      }
    });
  }
});

/* ---------------- СЕЗОННЫЙ ПРОПУСК ---------------- */
const SEASON = { n: 4, days: 26, left: '12д 4ч' };   // единая правда о сезоне (было 12д в шапке, 26д в подписи, 6 недель в подсказках)
const PASS = [...Array(20)].map((_, i) => {
  const l = i + 1;
  const f = l % 5 === 0 ? { k: 'chest', kind: 'silver', n: 1 } : l % 2 ? { k: 'coins', n: 50 + l * 10 } : { k: 'gems', n: 2 + (l >> 1) };
  const p = l % 5 === 0 ? { k: 'chest', kind: l % 10 === 0 ? 'epic' : 'gold', n: 1 } : l % 3 === 0 ? { k: 'card', n: 1, col: ['#FF4B3E', '#9F6BFF', '#2EC9FF'][l % 3] } : { k: 'gems', n: 5 + l };
  return { l, f, p };
});
Router.def('pass', {
  mood: 'violet',
  render() {
    const cell = (r, lane, l) => {
      const claimed = S.claimed[lane].includes(l); const reached = l <= S.passLvl; const locked = lane === 'p' && !S.premium;
      const st = claimed ? 'claimed' : reached && !locked ? 'ready' : 'future';
      const art = r.k === 'coins' ? Art.coin(38) : r.k === 'gems' ? Art.gem(36) : r.k === 'chest' ? Art.chest(r.kind, 50) : Art.rubber(r.col, 46);
      return `<button class="pc ${lane} ${st} ${locked ? 'locked' : ''}" data-l="${l}" data-lane="${lane}" data-press>
        <span class="pca">${art}</span><b class="num">${r.k === 'chest' || r.k === 'card' ? '' : '×' + r.n}</b>
        ${claimed ? `<span class="pcc">${Art.icon('check', { c: '#fff', sw: 3 })}</span>` : ''}${locked ? `<span class="pcl">${Art.icon('lock', { c: '#FFE28A' })}</span>` : ''}</button>`;
    };
    return `${UI.hud()}<div class="scroll" id="passScroll">
      <div class="pass-hero rise" style="--d:0">
        <i class="ph-ill" style="background-image:url('${ILL.pass_hero}')"></i><i class="ph-shade"></i>
        <span class="chip violet">${Art.icon('clock', { c: '#D9C6FF' })} осталось ${SEASON.left}</span>
        <div class="ph-t"><span class="cap">Сезон ${SEASON.n} · ${SEASON.days} дней</span><b class="h-display">Боевой<br>пропуск</b></div>
        <div class="ph-lv"><span class="phl"><span class="num">${S.passLvl}</span></span><div style="flex:1"><div class="cap" style="margin-bottom:6px">Уровень пропуска</div><div class="bar"><i style="--p:${S.passXp / 100}"></i><span class="lbl">${S.passXp} / 100 XP</span></div></div></div>

      </div>
      ${S.premium ? '' : `<div class="pass-cta rise" style="--d:1"><span class="pcta-i">${Art.icon('crown', { c: '#3A1A00', fill: '#3A1A00' })}</span><div><b>Премиум-пропуск</b><small>+35 наград · эксклюзивная накладка</small></div><button class="b3 sm" data-act="premium"><span class="shine"></span>⭐ 349</button></div>`}
      <div class="track-h rise" style="--d:2"><span>Бесплатно</span><span></span><span class="gold">Премиум</span></div>
      <div class="track">
        <div class="tline"><i style="height:${(S.passLvl - .5) / PASS.length * 100}%"></i></div>
        ${PASS.map((r, i) => `<div class="trow ${r.l === S.passLvl ? 'cur' : ''} ${r.l <= S.passLvl ? 'reached' : ''}" style="--d:${Math.min(i, 10) + 3}">
          ${cell(r.f, 'f', r.l)}<span class="tnode"><span class="num">${r.l}</span></span>${cell(r.p, 'p', r.l)}</div>`).join('')}
      </div>
    </div>`;
  },
  mount(el) {
    UI.bindHud(el);
    setTimeout(() => { const c = el.querySelector('.trow.cur'); const sc = el.querySelector('#passScroll'); if (c && sc) sc.scrollTo({ top: c.offsetTop - sc.clientHeight / 2 + 40, behavior: 'smooth' }); }, 700);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act=premium]'); if (a) return this.buyPremium(a);
      const c = e.target.closest('.pc'); if (!c) return;
      const l = +c.dataset.l, lane = c.dataset.lane; const r = PASS[l - 1][lane];
      if (c.classList.contains('locked')) { toast('Нужен премиум-пропуск', 'crown'); c.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(0)' }], { duration: 300 }); return; }
      if (c.classList.contains('future')) { toast(`Откроется на ${l} уровне`, 'lock'); return; }
      if (c.classList.contains('claimed')) return;
      S.claimed[lane].push(l); save();
      c.classList.remove('ready'); c.classList.add('claimed'); c.insertAdjacentHTML('beforeend', `<span class="pcc">${Art.icon('check', { c: '#fff', sw: 3 })}</span>`);
      const p = FX.pt(c); FX.burst(p.x, p.y, { c: ['#D3B5FF', '#FFC93A', '#fff'], count: 26, speed: 9 }); haptic('success');
      if (r.k === 'coins' || r.k === 'gems') Wallet.add(r.k, r.n, p);
      else if (r.k === 'chest') { Sfx.reveal(2); toast(`${Art.CHEST[r.kind].n} сундук отправлен в слот`, 'gift'); const i = S.chests.findIndex((x) => !x); if (i >= 0) { S.chests[i] = { id: 'p' + l, kind: r.kind, state: 'ready' }; save(); } }
      else { Sfx.reveal(2); toast('Новая накладка в инвентаре', 'paddle'); }
      Nav.dots();   // бадж считается из состояния, а не отнимается «на глаз»
    });
  },
  buyPremium(btn) {
    Sheet.open(`<div class="stars-pay"><div class="sp-ic gold">${Art.icon('crown', { c: '#FFC93A', fill: '#FFC93A' })}</div><div class="h1">Премиум-пропуск</div>
      <p class="mut">Откроет 20 премиум-наград сезона, включая <b>эпический сундук</b> и накладку <b>Void Pulse</b>.</p>
      <button class="b3 block" data-a="pay"><span class="shine"></span>Оплатить ⭐ 349</button><p class="dim" style="font-size:11px;margin-top:12px">Демо-режим: Stars не списываются</p></div>`, {
      onOpen: (w) => w.querySelector('[data-a=pay]').addEventListener('click', async () => {
        Sheet.close(); await sleep(250); S.premium = true; save(); Sfx.win(); haptic('success'); flash('#FFE680', .6); FX.rain(90);
        // честный ремонт экрана: раньше innerHTML подменялся вручную, и обработчик
        // клеймов дублировался с каждой покупкой
        Router.go('pass', { replace: true, mode: 'push' });
        Nav.dots();
        setTimeout(() => { $$('.screen.current .pc.p.ready').forEach((c, i) => setTimeout(() => { const p = FX.pt(c); FX.burst(p.x, p.y, { c: ['#FFC93A', '#fff'], count: 16, speed: 7 }); }, 300 + i * 90)); }, 120);
      })
    });
  }
});

/* ---------------- РЕЙТИНГ ---------------- */
Router.def('ranks', {
  mood: 'gold',
  data(tab) {
    const base = PEOPLE.map((p, i) => ({ ...p, key: 'p' + i }));
    let list = tab === 'friends' ? base.filter((_, i) => [0, 1, 3, 5].includes(i)) : tab === 'club' ? base.filter((_, i) => [0, 2, 4].includes(i)) : base;
    const meRow = { n: S.name, s: 'Ты', r: S.rating, key: 'me', me: true, club: S.club };
    if (tab === 'world') { list = list.sort((a, b) => b.r - a.r).map((x, i) => ({ ...x, pos: i + 1 })); list.push({ ...meRow, pos: 1284 }); }
    else list = list.concat([meRow]).sort((a, b) => b.r - a.r).map((x, i) => ({ ...x, pos: i + 1 }));
    return list;
  },
  body(tab) {
    const list = this.data(tab); const top = list.filter((x) => x.pos <= 3); const rest = list.filter((x) => x.pos > 3 && !(tab === 'world' && x.me));
    const order = [top[1], top[0], top[2]].filter(Boolean);
    const me = list.find((x) => x.me);
    return `<div class="podium">${order.map((p) => `<div class="pod p${p.pos}">
        <div class="pd-av">${p.pos === 1 ? `<span class="crown">${Art.icon('crown', { c: '#FFC93A', fill: '#FFC93A' })}</span>` : ''}${Art.avatar(p.key, p.pos === 1 ? 78 : 62, { ring: ['', '#FFC93A', '#DDE6FF', '#E3A06B'][p.pos] })}</div>
        <b class="pd-n">${p.s}</b><span class="pd-r num">${Art.trophy(14)}${fmt(p.r)}</span>
        <div class="pd-col"><span class="num">${p.pos}</span></div></div>`).join('')}</div>
      <div class="lb">${rest.map((p, i) => `<div class="lrow ${p.me ? 'me' : ''}" style="--d:${i}">
        <span class="lp num">${p.pos}</span>${Art.avatar(p.key, 40)}<span class="ln"><b>${p.s}</b><small>${p.club}</small></span>
        <span class="lch ${i % 3 === 1 ? 'dn' : 'up'}">${i % 3 === 1 ? '▼' : '▲'}${(i * 7 % 5) + 1}</span><span class="lr num">${Art.badge(leagueOf(p.r), 18)}${fmt(p.r)}</span></div>`).join('')}</div>
      ${tab === 'world' && me ? `<div class="lrow me sticky"><span class="lp num">${fmt(me.pos)}</span>${Art.avatar('me', 40)}<span class="ln"><b>Ты</b><small>топ 4% · ${S.club}</small></span><span class="lch up">▲38</span><span class="lr num">${Art.badge(leagueOf(S.rating), 18)}${fmt(S.rating)}</span></div>` : ''}`;
  },
  render() {
    /* Фильтр стоит ПЕРВЫМ (важнее заголовка), плитки ниже собраны в одну
     * общую плашку — визуально группа, а не разрозненные элементы. */
    return `${UI.hud()}<div class="scroll">
      <div class="seg rise" style="--d:0;margin:8px 14px 4px" id="rkSeg"><span class="pill"></span><button class="on" data-v="world">Мир</button><button data-v="friends">Друзья</button><button data-v="club">Клуб</button></div>
      <div class="pg-head rise" style="--d:1;margin:4px 14px 6px"><div class="h1">Рейтинг</div><span class="chip gold">${Art.icon('clock', { c: '#FFE28A' })} Сезон: 12д</span></div>
      <div class="pnl rk-plate rise" style="--d:2"><div id="rkBody" class="rk-body">${this.body('world')}</div></div></div>`;
  },
  mount(el) {
    UI.bindHud(el); this.anim(el);
    UI.seg(el.querySelector('#rkSeg'), (v) => { const b = el.querySelector('#rkBody'); b.classList.remove('go'); b.innerHTML = this.body(v); void b.offsetWidth; this.anim(el); });
  },
  anim(el) {
    const b = el.querySelector('#rkBody'); requestAnimationFrame(() => b.classList.add('go'));
    setTimeout(() => { const p1 = el.querySelector('.pod.p1 .pd-av'); if (!p1) return; const p = FX.pt(p1); FX.twinkles(p.x, p.y, 50, 10); FX.burst(p.x, p.y - 30, { c: ['#FFC93A', '#fff'], count: 14, speed: 6, size: .7, ring: false }); Sfx.impact(); }, 900);
  }
});

/* ---------------- ПРОФИЛЬ ---------------- */
Router.def('profile', {
  mood: 'arena',
  render() {
    const L = leagueOf(S.rating); const total = S.wins + S.losses; const wr = total ? Math.round(S.wins / total * 100) : null;
    // рейтинг за 30 дней
    let r = S.rating - 240; const pts = [...Array(30)].map((_, i) => (r += Math.sin(i * 1.3) * 22 + 9 + (i > 24 ? 6 : 0)));
    pts[29] = S.rating; this.pts = pts;
    const sk = Career.radar(); this.sk = sk;
    const ach = ACH.map((a) => [a.t, a.i, !!Career.got[a.id], a.d]); const achN = ach.filter((a) => a[2]).length;
    const eq = (k) => ALL_ITEMS.find((x) => x.id === S.equipped[k]) || null;
    const KIND_T = { rubber: 'Накладка', blade: 'Основание', trail: 'След мяча' };
    return `${UI.hud()}<div class="scroll">
      <div class="pf-hero pnl rise" style="--d:0">
        <div class="pf-av">${Art.avatar('me', 92, { round: false })}<span class="pf-lv">${S.level}</span></div>
        <div class="pf-id"><b class="h2">${S.name}</b><span class="dim">${S.nick}</span><span class="chip cyan" style="margin-top:8px">${Art.icon('shield', { c: '#7DF3FF' })} ${S.club}</span></div>
        <button class="ib pf-set" data-act="settings" aria-label="Настройки">${Art.icon('gear', { c: '#fff' })}</button>
        <div class="pf-league"><span class="pfl-b">${Art.badge(L, 74)}</span><span class="cap">${L.n}</span><b class="num txt-gold">${fmt(S.rating)}</b></div>
      </div>
      <div class="pf-stats">
        <div class="pnl pst rise" style="--d:1"><span class="cap">Матчи</span><b class="num" data-n="${total}">0</b></div>
        <div class="pnl pst rise" style="--d:2"><span class="cap">Победы</span><b class="num txt-gold" data-n="${S.wins}">0</b></div>
        <div class="pnl pst ring rise" style="--d:3"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="25" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="7"/>${wr === null ? '' : `<circle class="wr" cx="30" cy="30" r="25" fill="none" stroke="url(#wrg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="157" stroke-dashoffset="157" data-o="${157 * (1 - wr / 100)}"/>`}<defs><linearGradient id="wrg"><stop offset="0" stop-color="#3BF5A0"/><stop offset="1" stop-color="#2EC9FF"/></linearGradient></defs></svg><b class="num">${wr === null ? '—' : wr + '%'}</b><span class="cap">Винрейт</span></div>
      </div>
      <div class="pnl chart rise" style="--d:4"><div class="ch-h"><span class="cap">Рейтинг · 30 дней</span><b class="num" id="chVal">${fmt(S.rating)}</b><em class="up">+${Math.round(S.rating - pts[0])}</em></div>
        <div class="ch-wrap" id="chWrap">${this.chart(pts)}</div></div>
      ${this.technique()}
      <div class="pnl skills rise" style="--d:5"><span class="cap">Стиль игры${Career.c.m ? ` · по ${Career.c.m} ${Career.c.m === 1 ? 'матчу' : 'матчам'}` : ' · сыграй матч'}</span><div class="sk-wrap">${this.radar(sk)}</div></div>
      <div class="sec-title rise" style="--d:6"><span class="h2">${Art.icon('trophy')}Достижения</span><span class="dim" style="font-size:11.5px">${achN} / ${ach.length}</span></div>
      <div class="ach">${ach.map(([t, i, got, dsc], k) => `<div class="ac ${got ? 'got' : ''} pop" style="--d:${k + 6}" data-ach="${dsc}" data-press><span class="aci">${Art.icon(i, { c: got ? '#3A1A00' : 'rgba(255,255,255,.35)', sw: 2.2, fill: got && ICON_FILL.has(i) ? '#3A1A00' : 'transparent' })}</span><small>${t}</small></div>`).join('')}</div>
      <div class="sec-title rise" style="--d:8"><span class="h2">${Art.icon('paddle', { c: '#FFB3A6' })}Экипировка</span></div>
      <div class="grid3 eq">${['rubber', 'blade', 'trail'].map((k, i) => { const it = eq(k);
        return it ? `<div class="icard rar ${it.r} rise" style="--d:${9 + i}"><span class="ic-art">${ItemArt.of(it, 56)}</span><span class="ic-n">${it.n}</span><span class="ic-t">${it.t}</span></div>`
          : `<div class="icard rise" style="--d:${9 + i}"><span class="ic-art dim-ic">${Art.icon('lock', { c: 'rgba(255,255,255,.3)' })}</span><span class="ic-n dim">Не экипировано</span><span class="ic-t">${KIND_T[k]}</span></div>`; }).join('')}</div>
    </div>`;
  },
  /* Техника удара: точность контакта по последним матчам — из тех же попыток,
     что и «Разбор матча». Показывает прогресс, а не только рейтинг. */
  technique() {
    const M = ZoneStats.matches().slice(-12);
    if (!M.length) return `<div class="pnl tq empty rise" style="--d:4"><span class="cap">Техника удара</span><p>Сыграй матч — здесь появится точность контакта и твоя главная ошибка.</p></div>`;
    const last = M[M.length - 1], prev = M.slice(0, -1);
    const avgPrev = prev.length ? Math.round(prev.reduce((s, m) => s + m.pct, 0) / prev.length) : null;
    const trend = avgPrev === null ? null : last.pct - avgPrev;
    const cnt = {}; M.forEach((m) => { if (m.key !== 'good') cnt[m.key] = (cnt[m.key] || 0) + 1; });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    const KEY = { side: 'палец уходит вбок от мяча', high: 'свайп начинается выше мяча', early: 'удар раньше времени', racket: 'ракетка проходит мимо мяча' };
    const bars = M.map((m, i) => `<i class="${m.win ? 'w' : 'l'}${i === M.length - 1 ? ' last' : ''}" style="--h:${Math.max(4, m.pct)};--i:${i}"><em class="num">${m.pct}</em></i>`).join('');
    return `<div class="pnl tq rise" style="--d:4">
      <div class="ch-h"><span class="cap">Техника удара · контакт</span><b class="num">${last.pct}%</b>${trend === null ? '' : `<em class="${trend >= 0 ? 'up' : 'dn'}">${trend >= 0 ? '+' : ''}${trend}</em>`}</div>
      <div class="tq-bars">${bars}</div>
      <div class="tq-leg"><span><i class="w"></i>победа</span><span><i></i>поражение</span><span>последние ${M.length} матчей</span></div>
      <p class="tq-note">${top ? `Чаще всего: <b>${KEY[top[0]]}</b> (${top[1]} из ${M.length})` : '<b>Чистая техника</b> во всех последних матчах'}</p></div>`;
  },
  chart(pts) {
    const W = 330, H = 120, min = Math.min(...pts) - 10, max = Math.max(...pts) + 10;
    const X = (i) => 6 + i / (pts.length - 1) * (W - 12), Y = (v) => H - 8 - (v - min) / (max - min) * (H - 20);
    let d = `M${X(0)},${Y(pts[0])}`; for (let i = 1; i < pts.length; i++) { const x0 = X(i - 1), x1 = X(i), y0 = Y(pts[i - 1]), y1 = Y(pts[i]); const cx = (x0 + x1) / 2; d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
    this.cX = X; this.cY = Y;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chsvg"><defs><linearGradient id="chg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2EC9FF" stop-opacity=".45"/><stop offset="1" stop-color="#2EC9FF" stop-opacity="0"/></linearGradient>
      <filter id="chgl"><feGaussianBlur stdDeviation="3"/></filter></defs>
      ${[0, 1, 2, 3].map((k) => `<line x1="0" x2="${W}" y1="${10 + k * 34}" y2="${10 + k * 34}" stroke="rgba(255,255,255,.06)" stroke-dasharray="3 5"/>`).join('')}
      <path class="ch-area" d="${d} L${X(pts.length - 1)},${H} L${X(0)},${H}Z" fill="url(#chg)"/>
      <path d="${d}" fill="none" stroke="#2EC9FF" stroke-width="5" opacity=".5" filter="url(#chgl)" class="ch-line"/>
      <path d="${d}" fill="none" stroke="#9BF6FF" stroke-width="2.6" stroke-linecap="round" class="ch-line"/>
      <line class="ch-cur" x1="0" x2="0" y1="0" y2="${H}" stroke="rgba(255,255,255,.35)" stroke-dasharray="3 3" opacity="0"/>
      <circle class="ch-dot" cx="${X(pts.length - 1)}" cy="${Y(pts[pts.length - 1])}" r="5" fill="#fff" stroke="#2EC9FF" stroke-width="3"/></svg>`;
  },
  radar(sk) {
    const c = 90, R = 66, n = sk.length; const pt = (i, r) => [c + Math.sin(i / n * 6.283) * r, c - Math.cos(i / n * 6.283) * r];
    const ring = (k) => sk.map((_, i) => pt(i, R * k).join(',')).join(' ');
    return `<svg viewBox="0 0 180 180" class="rdsvg">${[.25, .5, .75, 1].map((k) => `<polygon points="${ring(k)}" fill="none" stroke="rgba(255,255,255,${k === 1 ? .14 : .07})"/>`).join('')}
      ${sk.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="rgba(255,255,255,.07)"/>`; }).join('')}
      <polygon class="rd-shape" points="${sk.map(([, v], i) => pt(i, R * v).join(',')).join(' ')}" fill="rgba(255,75,62,.3)" stroke="#FF7A4D" stroke-width="2.4" stroke-linejoin="round"/>
      ${sk.map(([l, v], i) => { const [x, y] = pt(i, R + 16); const [dx, dy] = pt(i, R * v); return `<circle cx="${dx}" cy="${dy}" r="3.5" fill="#fff" class="rd-dot"/><text x="${x}" y="${y + 3}" text-anchor="middle" fill="rgba(222,230,255,.75)" font-size="10" font-weight="800" font-family="Man">${l}</text>`; }).join('')}</svg>`;
  },
  mount(el) {
    UI.bindHud(el);
    el.querySelector('[data-act=settings]').addEventListener('click', openSettings);
    el.querySelectorAll('[data-ach]').forEach((a) => a.addEventListener('click', () => { haptic('select'); toast(`<b>${a.querySelector('small').textContent}</b> · ${a.dataset.ach}`, a.classList.contains('got') ? 'check' : 'lock'); }));
    setTimeout(() => {
      $$('[data-n]', el).forEach((b) => tickNumber(b, 0, +b.dataset.n, 1100));
      const wr = el.querySelector('.wr'); if (wr) { wr.style.transition = 'stroke-dashoffset 1.3s cubic-bezier(.16,1,.3,1)'; wr.style.strokeDashoffset = wr.dataset.o; }
      el.querySelector('.chart').classList.add('go'); el.querySelector('.skills').classList.add('go');
    }, 450);
    // скраб по графику
    const wrap = el.querySelector('#chWrap'); const svg = wrap.querySelector('svg'); const val = el.querySelector('#chVal');
    const dot = svg.querySelector('.ch-dot'), cur = svg.querySelector('.ch-cur'); const pts = this.pts;
    const scrub = (e) => { const r = svg.getBoundingClientRect(); const t = clamp((e.clientX - r.left) / r.width, 0, 1); const i = Math.round(t * (pts.length - 1)); const x = this.cX(i), y = this.cY(pts[i]);
      dot.setAttribute('cx', x); dot.setAttribute('cy', y); cur.setAttribute('x1', x); cur.setAttribute('x2', x); cur.setAttribute('opacity', 1); if (val.textContent !== fmt(pts[i])) { val.textContent = fmt(Math.round(pts[i])); haptic('select'); } };
    wrap.addEventListener('pointerdown', (e) => { scrub(e); wrap.setPointerCapture(e.pointerId); });
    wrap.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') scrub(e); });
    wrap.addEventListener('pointerup', () => { const i = pts.length - 1; dot.setAttribute('cx', this.cX(i)); dot.setAttribute('cy', this.cY(pts[i])); cur.setAttribute('opacity', 0); val.textContent = fmt(S.rating); });
  }
});
