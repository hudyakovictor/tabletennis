Router.def('shop', {
  mood: 'shop',
  render() {
    const bundle = Catalog.byId('season-bundle'), bundleOwned = Rewards.has('bundle:' + globalThis.TTSeason.seasonNumber());
    return `${UI.hud()}<div class="scroll">
      <div class="pg-head rise" style="--d:0"><div class="h1" data-l10n="shop.title">${t('shop.title')}</div><span class="chip">${Art.icon('clock', { c: '#9BE8FF' })} <span class="num" id="shopT">05:12:44</span></span></div>
      <div class="feat rar leg beam rise" style="--d:1" data-feat>
        <div class="ft-ribbon">−45%</div>
        <div class="ft-art"><i class="ft-ill" style="background-image:url('${ILL.shop_bundle}')"></i></div>
        <div class="ft-body"><span class="cap" data-l10n="shop.offerDay" style="color:#FFE28A">${t('shop.offerDay')}</span><b class="h-display" data-l10n="shop.seasonBundle">${t('shop.seasonBundle')}</b>
          <div class="ft-items">${this.bundleItems(bundle)}</div>
          <div class="ft-buy"><s class="dim num ft-old">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })} 629</s><button class="b3 sm" data-act="stars" data-product="${bundle.id}" ${bundleOwned || globalThis.TTSeason.seasonOver() ? 'disabled' : ''}><span class="shine"></span>${bundleOwned ? t('shop.owned') : Art.icon('tstar', { c: '#3A1A00', fill: '#3A1A00' }) + bundle.price.amt}</button></div></div>
        <i class="ft-shine"></i>
      </div>
      <div class="sec-title rise" style="--d:2"><span class="h2">${Art.icon('refresh', { c: '#9CFFD0' })}<span data-l10n="shop.daily">${t('shop.daily')}</span></span><span class="dim" data-goods-count style="font-size:11.5px">${t('shop.goodsCount', { n: Catalog.shop().length })}</span></div>
      <div class="grid3">${Catalog.shop().map((it, i) => this.card(it, i)).join('')}</div>
      <div class="sec-title rise" style="--d:9" id="gemPacks"><span class="h2">${Art.gem(22)}<span data-l10n="cur.gemsWord">${t('cur.gemsWord')}</span></span><span class="chip">${Art.icon('tg', { c: '#7DD3FF' })} Telegram Stars</span></div>
      <div class="grid3">${Catalog.starPacks().map((p, i) => `
        <button class="pack rise ${p.best ? 'best' : ''}" style="--d:${10 + i}" data-act="stars" data-product="${p.id}" data-press>
          ${p.best ? `<span class="pk-best" data-l10n="shop.bestValue">${t('shop.bestValue')}</span>` : ''}<span class="pk-art">${[...Array(i + 1)].map((_, k) => `<span style="--k:${k}">${Art.gem(i ? 46 : 54)}</span>`).join('')}</span>
          <b class="num">${p.g}</b><span class="pk-p">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })}${p.s}</span></button>`).join('')}</div>
      <div class="sec-title rise" style="--d:13"><span class="h2">${Art.coin(22)}<span data-l10n="cur.coinsWord">${t('cur.coinsWord')}</span></span></div>
      <div class="grid3">${Catalog.coinPacks().map((p, i) => `
        <button class="pack coins rise" style="--d:${14 + i}" data-act="coinpack" data-pack="${p.id}" data-press>
          <span class="pk-art">${[...Array(i + 2)].map((_, k) => `<span style="--k:${k}">${Art.coin(42)}</span>`).join('')}</span>
          <b class="num">${fmt(p.c)}</b><span class="pk-p">${Art.gem(16)}${p.g}</span></button>`).join('')}</div>
    </div>`;
  },
  bundleItems(bundle) {
    return `<span class="chip gold">${itemName(Catalog.byId(bundle.items[0]))}</span><span class="chip cyan">+${bundle.gems} ${t('gems.word', { n: bundle.gems })}</span><span class="chip violet">${itemName(Catalog.byId(bundle.items[1]))}</span>`;
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
    let left = 5 * 3600 + 12 * 60 + 44; const clock = el.querySelector('#shopT');
    const iv = setInterval(() => { left--; if (left < 0) left += 24 * 3600; const h = left / 3600 | 0, m = (left % 3600) / 60 | 0, s = left % 60; clock.textContent = [h, m, s].map((x) => String(x).padStart(2, '0')).join(':'); }, 1000);
    const click = (e) => {
      const it = e.target.closest('[data-item]'); if (it) return this.product(Catalog.byId(it.dataset.item), it);
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.disabled) return;
      if (a.dataset.act === 'stars') this.stars(a);
      if (a.dataset.act === 'coinpack') {
        const old = S.gems, result = Rewards.exchangeCoins(a.dataset.pack);
        if (!result.ok) { toast(result.why === 'funds' ? t('wallet.notEnough', { cur: t('cur.gems') }) : t('pass.rewardUnavailable'), 'gem'); Sfx.error(); return; }
        const value = el.querySelector('[data-cur="gems"] .v'); tickNumber(value, old, S.gems, 600);
        Wallet.show('coins', result.coins, FX.pt(a));
      }
    };
    el.addEventListener('click', click);
    return () => { clearInterval(iv); el.removeEventListener('click', click); };
  },
  refreshLocale(el) {
    UI.refreshHud(el); UI.localize(el);
    el.querySelector('.ft-items').innerHTML = this.bundleItems(Catalog.byId('season-bundle'));
    el.querySelector('[data-goods-count]').textContent = t('shop.goodsCount', { n: Catalog.shop().length });
    $$('[data-item]', el).forEach((card) => {
      const it = Catalog.byId(card.dataset.item); if (!it) return;
      card.querySelector('.ic-n').textContent = itemName(it); card.querySelector('.ic-t').textContent = kindName(it);
      if (S.owned.includes(it.id)) card.querySelector('.ic-p').innerHTML = Art.icon('check', { c: '#9CFFD0' }) + t('shop.owned');
      const tag = card.querySelector('.ic-tag'); if (tag && it.tagk) tag.textContent = t(it.tagk);
    });
    if (Rewards.has('bundle:' + globalThis.TTSeason.seasonNumber())) el.querySelector('[data-product="season-bundle"]').textContent = t('shop.owned');
  },
  stars(btn, receipt = null) {
    const productId = btn.dataset.product, offer = Catalog.starOffer(productId); if (!offer) return { ok: false, why: 'unavailable' };
    if (receipt) {
      const result = Rewards.confirmPurchase(productId, receipt);
      if (result.ok && btn.isConnected) {
        if (Sheet.cur) Sheet.close(); haptic('success'); Sfx.win();
        const p = FX.pt(btn); FX.burst(p.x, p.y, { c: ['#2EE6FF', '#fff', '#FFC93A'], count: 40, speed: 12 });
        if (result.gems) Wallet.show('gems', result.gems, p);
        if (offer.once) { btn.disabled = true; btn.textContent = t('shop.owned'); }
      } else if (!result.ok && result.why !== 'claimed') toast(t(result.why === 'season' ? 'season.over' : 'shop.starsUnconfirmed'), 'lock');
      return result;
    }
    const gems = offer.gems, amt = offer.price.amt;
    Sheet.open(`<div class="stars-pay"><div class="sp-ic">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })}</div><div class="h1">${t('shop.starsTitle')}</div>
      ${offer.items ? `<div class="ft-items">${this.bundleItems(offer)}</div>` : `<p class="mut">${t('shop.starsText', { gems, gw: t('gems.word', { n: gems }) })}</p>`}
      <button class="b3 block" data-a="pay" disabled><span class="shine"></span>${t('shop.starsPay', { amt })}</button><p class="dim" role="status" style="font-size:11px;margin-top:12px">${t('shop.starsUnavailable')}</p></div>`);
  },
  product(it, cardEl) {
    if (!it || Catalog.byId(it.id) !== it || !['rubber', 'blade', 'trail', 'table'].includes(it.kind)) return;
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
        let alive = true, raf = 0; const timers = new Set();
        const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms); timers.add(id); };
        later(() => $$('.pd-stats .bar i', w).forEach((i, k) => later(() => i.style.setProperty('--p', i.dataset.p), k * 120)), 350);
        // вращение предмета
        const sp = $('#pdSpin', w), stage = w.querySelector('.pd-stage'), anchor = sp || stage;
        let ang = -20, vel = .4, drag = null;
        const tick = () => { if (!alive || !sp) return; if (!drag) { ang += vel; vel = lerp(vel, .4, .02); } sp.style.transform = `rotateY(${ang}deg) rotateX(8deg)`; raf = requestAnimationFrame(tick); };
        if (!(typeof effectiveReducedMotion === 'function' ? effectiveReducedMotion() : S.rm)) tick();
        const down = (e) => { drag = { x: e.clientX, a: ang }; e.stopPropagation(); };
        const move = (e) => { if (!drag || !sp) return; const na = drag.a + (e.clientX - drag.x) * .8; vel = na - ang; ang = na; };
        const end = () => { drag = null; };
        stage.addEventListener('pointerdown', down); stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', end); stage.addEventListener('pointerleave', end); stage.addEventListener('pointercancel', end);
        const buy = w.querySelector('[data-a=buy]');
        if (buy) UI.hold(buy, 700, () => {
          const old = it.price && S[it.price.cur], result = Rewards.buyItem(it.id);
          if (!result.ok) { toast(result.why === 'funds' ? t('wallet.notEnough', { cur: t('cur.' + it.price.cur) }) : result.why === 'owned' || result.why === 'claimed' ? t('shop.owned') : t('pass.rewardUnavailable'), 'lock'); Sfx.error(); return false; }
          tickNumber($(`.screen.current [data-cur="${it.price.cur}"] .v`), old, S[it.price.cur], 600);
          later(() => { const p = FX.pt(anchor); FX.burst(p.x, p.y, { c: ['#FFC93A', '#fff', getComputedStyle(w.querySelector('.prod')).getPropertyValue('--rc').trim() || '#fff'], count: 50, speed: 14, size: 1.4 }); FX.twinkles(p.x, p.y, 80, 12); Sfx.reveal(3); haptic('success'); flash('#fff', .4); }, 650);
          buy.outerHTML = `<button class="b3 green block" data-a="equip"><span class="shine"></span>${t('shop.equip')}</button>`;
          w.querySelector('.pd-stage').insertAdjacentHTML('beforeend', `<span class="pd-stamp">${t('shop.bought')}</span>`);
          const card = $(`.screen.current [data-item="${it.id}"] .ic-p`); if (card) { card.className = 'ic-p own'; card.innerHTML = Art.icon('check', { c: '#9CFFD0' }) + t('shop.owned'); }
        });
        const click = (e) => { if (e.target.closest('[data-a=equip]') && S.owned.includes(it.id) && ['rubber', 'blade', 'trail', 'table'].includes(it.kind)) { S.equipped[it.kind] = it.id; saveNow(); if (typeof GameHost !== 'undefined' && GameHost.ready) GameHost.send('equip', { equipped: S.equipped }); toast(t('shop.equipped', { name: itemName(it) }), 'check'); Sheet.close(); } };
        w.addEventListener('click', click);
        return () => { alive = false; timers.forEach(clearTimeout); cancelAnimationFrame(raf); w.removeEventListener('click', click); stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', end); stage.removeEventListener('pointerleave', end); stage.removeEventListener('pointercancel', end); };
      }
    });
  }
});

/* ---------------- СЕЗОННЫЙ ПРОПУСК ---------------- */
