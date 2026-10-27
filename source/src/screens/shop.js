Router.def('shop', {
  mood: 'shop',
  render() {
    return `${UI.hud()}<div class="scroll">
      <div class="pg-head rise" style="--d:0"><div class="h1">${t('shop.title')}</div><span class="chip">${Art.icon('clock', { c: '#9BE8FF' })} <span class="num" id="shopT">05:12:44</span></span></div>
      <div class="feat rar leg beam rise" style="--d:1" data-feat>
        <div class="ft-ribbon">−45%</div>
        <div class="ft-art"><i class="ft-ill" style="background-image:url('${ILL.shop_bundle}')"></i></div>
        <div class="ft-body"><span class="cap" style="color:#FFE28A">${t('shop.offerDay')}</span><b class="h-display">${t('shop.seasonBundle')}</b>
          <div class="ft-items"><span class="chip gold">${itemName(Catalog.byId('r-coral'))}</span><span class="chip cyan">+80 ${t('gems.word', { n: 80 })}</span><span class="chip violet">${t('shop.frame')}</span></div>
          <div class="ft-buy"><s class="dim num ft-old">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })} 629</s><button class="b3 sm" data-act="stars" data-amt="349"><span class="shine"></span>${Art.icon('tstar', { c: '#3A1A00', fill: '#3A1A00' })}349</button></div></div>
        <i class="ft-shine"></i>
      </div>
      <div class="sec-title rise" style="--d:2"><span class="h2">${Art.icon('refresh', { c: '#9CFFD0' })}${t('shop.daily')}</span><span class="dim" style="font-size:11.5px">${t('shop.goodsCount', { n: Catalog.shop().length })}</span></div>
      <div class="grid3">${Catalog.shop().map((it, i) => this.card(it, i)).join('')}</div>
      <div class="sec-title rise" style="--d:9" id="gemPacks"><span class="h2">${Art.gem(22)}${t('cur.gemsWord')}</span><span class="chip">${Art.icon('tg', { c: '#7DD3FF' })} Telegram Stars</span></div>
      <div class="grid3">${[{ g: 80, s: 49 }, { g: 500, s: 249, best: 1 }, { g: 1200, s: 499 }].map((p, i) => `
        <button class="pack rise ${p.best ? 'best' : ''}" style="--d:${10 + i}" data-act="stars" data-gems="${p.g}" data-amt="${p.s}" data-press>
          ${p.best ? `<span class="pk-best">${t('shop.bestValue')}</span>` : ''}<span class="pk-art">${[...Array(i + 1)].map((_, k) => `<span style="--k:${k}">${Art.gem(i ? 46 : 54)}</span>`).join('')}</span>
          <b class="num">${p.g}</b><span class="pk-p">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })}${p.s}</span></button>`).join('')}</div>
      <div class="sec-title rise" style="--d:13"><span class="h2">${Art.coin(22)}${t('cur.coinsWord')}</span></div>
      <div class="grid3">${[{ c: 500, g: 10 }, { c: 1400, g: 25 }, { c: 3200, g: 50 }].map((p, i) => `
        <button class="pack coins rise" style="--d:${14 + i}" data-act="coinpack" data-c="${p.c}" data-g="${p.g}" data-press>
          <span class="pk-art">${[...Array(i + 2)].map((_, k) => `<span style="--k:${k}">${Art.coin(42)}</span>`).join('')}</span>
          <b class="num">${fmt(p.c)}</b><span class="pk-p">${Art.gem(16)}${p.g}</span></button>`).join('')}</div>
    </div>`;
  },
  card(it, i) {
    const own = S.owned.includes(it.id);
    return `<button class="icard rar ${it.r} ${it.r === 'leg' ? 'beam' : ''} rise" style="--d:${3 + i}" data-item="${it.id}" data-press>
      ${it.tagk ? `<span class="ic-tag">${t(it.tagk)}</span>` : ''}
      <span class="ic-art">${ItemArt.of(it, 64)}</span>
      <span class="ic-n">${itemName(it)}</span><span class="ic-t">${kindName(it)}</span>
      <span class="ic-p ${own ? 'own' : ''}">${own ? Art.icon('check', { c: '#9CFFD0' }) + t('shop.owned') : priceTag(it)}</span></button>`;
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
    Sheet.open(`<div class="stars-pay"><div class="sp-ic">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })}</div><div class="h1">${t('shop.starsTitle')}</div>
      <p class="mut">${t('shop.starsText', { gems, gw: t('gems.word', { n: gems }) })}</p>
      <button class="b3 block" data-a="pay"><span class="shine"></span>${t('shop.starsPay', { amt })}</button><p class="dim" style="font-size:11px;margin-top:12px">${t('shop.starsDemo')}</p></div>`, {
      onOpen: (w) => w.querySelector('[data-a=pay]').addEventListener('click', async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spin"></span>' + t('shop.starsWaiting');
        const tg = TGX.w; if (tg && tg.openInvoice && TGX.inTG) { /* invoice-ссылку выдаёт бот: tg.openInvoice(url, cb) */ }
        await sleep(900); haptic('success'); Sfx.win(); Sheet.close();
        await sleep(300); const p = FX.pt(btn); FX.burst(p.x, p.y, { c: ['#2EE6FF', '#fff', '#FFC93A'], count: 40, speed: 12 }); Wallet.add('gems', gems, p);
      })
    });
  },
  product(it, cardEl) {
    const own = S.owned.includes(it.id);
    const stats = it.st[0] ? [[t('stat.speed'), it.st[0], 'coral'], [t('stat.spin'), it.st[1], 'gold'], [t('stat.control'), it.st[2], '']] : null;
    Sheet.open(`<div class="prod rar ${it.r}">
      <div class="pd-stage"><div class="pd-glow"></div>${typeof ILL !== 'undefined' && ILL['shop_' + it.id.replace('-', '_')]
        ? `<div class="pd-ill" style="background-image:url('${ILL['shop_' + it.id.replace('-', '_')]}')"></div>`
        : `<div class="pd-spin" id="pdSpin"><div class="pd-face f">${ItemArt.of(it, 170)}</div><div class="pd-face b">${ItemArt.of(it, 170, { back: true })}</div></div><span class="pd-hint">${it.kind === 'rubber' || it.kind === 'blade' ? t('shop.spinHint') : ''}</span>`}</div>
      <span class="lc-r" style="background:var(--rc)">${rarityName(it.r)} · ${kindName(it)}</span>
      <div class="h1" style="margin:10px 0 4px">${itemName(it)}</div>
      ${stats ? `<div class="pd-stats">${stats.map(([l, v, c], i) => `<div class="pds"><span>${l}</span><div class="bar ${c}"><i style="--p:0" data-p="${v / 100}"></i></div><b class="num">${v}</b></div>`).join('')}</div>`
        : `<p class="mut" style="margin:8px 0 18px;font-size:13px">${it.kind === 'trail' ? t('shop.trailDesc') : t('shop.tableDesc')}</p>`}
      ${own ? `<button class="b3 green block" data-a="equip"><span class="shine"></span>${t('shop.equip')}</button>`
        : `<button class="b3 block hold" data-a="buy"><span class="hold-fill"></span><span class="hold-l">${t('shop.holdToBuy')} · ${priceTag(it)}</span></button>`}
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
          if (!Wallet.spend(it.price.cur, it.price.amt, FX.pt(sp))) return;
          S.owned.push(it.id); save();
          setTimeout(() => { const p = FX.pt(sp); FX.burst(p.x, p.y, { c: ['#FFC93A', '#fff', getComputedStyle(w.querySelector('.prod')).getPropertyValue('--rc').trim() || '#fff'], count: 50, speed: 14, size: 1.4 }); FX.twinkles(p.x, p.y, 80, 12); Sfx.reveal(3); haptic('success'); flash('#fff', .4); }, 650);
          buy.outerHTML = `<button class="b3 green block" data-a="equip"><span class="shine"></span>${t('shop.equip')}</button>`;
          w.querySelector('.pd-stage').insertAdjacentHTML('beforeend', `<span class="pd-stamp">${t('shop.bought')}</span>`);
          const card = $(`.screen.current [data-item="${it.id}"] .ic-p`); if (card) { card.className = 'ic-p own'; card.innerHTML = Art.icon('check', { c: '#9CFFD0' }) + t('shop.owned'); }
        });
        w.addEventListener('click', (e) => { if (e.target.closest('[data-a=equip]')) { S.equipped[it.kind] = it.id; save(); if (typeof GameHost !== 'undefined' && GameHost.ready) GameHost.send('equip', { equipped: S.equipped }); toast(t('shop.equipped', { name: itemName(it) }), 'check'); Sheet.close(); } });
      }
    });
  }
});

/* ---------------- СЕЗОННЫЙ ПРОПУСК ---------------- */