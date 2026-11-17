/* =====================================================================
   TTU v3 — Магазин (shop). Глобальный rework.
   Фундаментальный rework: чёткая иерархия, минимальная цель касания 48px,
   WCAG AA контраст, никаких инлайн-стилей, никаких декоративных эффектов.
   ===================================================================== */

Router.def('shop', {
  mood: 'shop',
  render() {
    return `${UI.hud()}<div class="scroll shop-scroll">
      <section class="shop-section">
        <div class="section-head"><span class="h2">${Art.icon('refresh', { c: '#9CFFD0' })}<span data-l10n="shop.daily">${t('shop.daily')}</span></span><span class="caption goods-count" data-goods-count>${t('shop.goodsCount', { n: Catalog.shop().length })}</span></div>
        <div class="shop-grid">${Catalog.shop().map((it, i) => this.card(it, i + 1)).join('')}</div>
      </section>

      <section class="shop-section gem-section" id="gemPacks">
        <div class="section-head"><span class="h2">${Art.gem(22)}<span data-l10n="cur.gemsWord">${t('cur.gemsWord')}</span></span><span class="chip tg-chip">${Art.icon('tg', { c: '#7DD3FF' })} ${t('cur.tgStars')}</span></div>
        <div class="shop-grid">${Catalog.starPacks().map((p, i) => `\n        <button class="pack pack-stars ${p.best ? 'pack-best' : ''}" data-act="stars" data-product="${p.id}" data-press>\n          ${p.best ? `<span class="pack-tag">${t('shop.bestValue')}</span>` : ''}<span class="pack-art">${[...Array(i + 1)].map((_, k) => `<span class="pack-gem">${Art.gem(i ? 46 : 54)}</span>`).join('')}</span>\n          <b class="num">${p.g}</b><span class="pack-price">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })}${p.s}</span></button>`).join('')}</div>
      </section>

      <section class="shop-section coin-section">
        <div class="section-head"><span class="h2">${Art.coin(22)}<span data-l10n="cur.coinsWord">${t('cur.coinsWord')}</span></span></div>
        <div class="shop-grid">${Catalog.coinPacks().map((p, i) => `\n        <button class="pack pack-coins" data-act="coinpack" data-pack="${p.id}" data-press>\n          <span class="pack-art">${[...Array(i + 2)].map((_, k) => `<span class="pack-coin">${Art.coin(42)}</span>`).join('')}</span>\n          <b class="num">${fmt(p.c)}</b><span class="pack-price">${Art.gem(16)}${p.g}</span></button>`).join('')}</div>
      </section>
    </div>`;
  },
  card(it, i) {
    const own = S.owned.includes(it.id);
    return `<button class="item-card rar ${it.r} ${it.r === 'leg' ? 'item-beam' : ''}" data-item="${it.id}" data-press>
      ${it.tagk ? `<span class="item-tag">${t(it.tagk)}</span>` : ''}
      <span class="item-art">${ItemArt.of(it, 64)}</span>
      <span class="item-name">${itemName(it)}</span><span class="item-kind">${kindName(it)}</span>
      <span class="item-price ${own ? 'own' : ''}">${own ? Art.icon('check', { c: '#9CFFD0' }) + t('shop.owned') : priceTag(it)}</span></button>`;
  },
  mount(el) {
    UI.bindHud(el);
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
    return () => { el.removeEventListener('click', click); };
  },
  refreshLocale(el) {
    UI.refreshHud(el); UI.localize(el);
    el.querySelector('.goods-count').textContent = t('shop.goodsCount', { n: Catalog.shop().length });
    $$('[data-item]', el).forEach((card) => {
      const it = Catalog.byId(card.dataset.item); if (!it) return;
      card.querySelector('.item-name').textContent = itemName(it); card.querySelector('.item-kind').textContent = kindName(it);
      if (S.owned.includes(it.id)) card.querySelector('.item-price').innerHTML = Art.icon('check', { c: '#9CFFD0' }) + t('shop.owned');
      const tag = card.querySelector('.item-tag'); if (tag && it.tagk) tag.textContent = t(it.tagk);
    });
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
    Sheet.open(`<div class="stars-pay">
      <div class="pay-icon">${Art.icon('tstar', { c: '#FFC93A', fill: '#FFC93A' })}</div>
      <h2 class="body-lg">${t(offer.premium ? 'pass.premium' : 'shop.starsTitle')}</h2>
      <p class="pay-text">${offer.premium ? t('pass.premiumText', { n: globalThis.TTSeason.currentPass().length }) : t('shop.starsText', { gems, gw: t('gems.word', { n: gems }) })}</p>
      <button class="btn btn-ghost btn-block sm pay-btn" data-a="pay" disabled>${t('shop.starsPay', { amt })}</button>
      <p class="caption status-note" role="status">${t('shop.starsUnavailable')}</p>
    </div>`);
  },
  product(it, cardEl) {
    if (!it || Catalog.byId(it.id) !== it || it.kind !== 'racket') return;
    const own = S.owned.includes(it.id);
    const stats = it.st[0] ? [[t('stat.speed'), it.st[0], 'coral'], [t('stat.spin'), it.st[1], 'gold'], [t('stat.control'), it.st[2], '']] : null;
    const descKey = it.id === 'r-pan' ? 'shop.panDesc' : 'shop.tableDesc';
    Sheet.open(`<div class="product-sheet prod-rar ${it.r}">
      <div class="product-stage">
        ${typeof ILL !== 'undefined' && ILL['shop_' + it.id.replace('-', '_')]
          ? `<div class="product-ill" style="background-image:url('${ILL['shop_' + it.id.replace('-', '_')]}')"></div>`
          : `<div class="product-spin"><div class="product-face f">${ItemArt.of(it, 170)}</div><div class="product-face b">${ItemArt.of(it, 170, { back: true })}</div></div><span class="product-hint">${t('shop.spinHint')}</span>`}
      </div>
      <span class="rarity-tag" style="background:var(--rc)">${rarityName(it.r)} · ${kindName(it)}</span>
      <h2 class="body-lg">${itemName(it)}</h2>
      ${stats ? `<div class="product-stats">${stats.map(([l, v, c], i) => `<div class="stat-row"><span class="stat-label">${l}</span><div class="stat-bar bar-${c}"><i style="--p:0" data-p="${v / 100}"></i></div><b class="stat-val num">${v}</b></div>`).join('')}</div>`
        : `<p class="caption product-desc">${t(descKey)}</p>`}
      ${own ? `<button class="btn btn-success btn-block" data-a="equip">${t('shop.equip')}</button>`
        : `<button class="btn btn-ghost btn-block hold-btn" data-a="buy">${t('shop.holdToBuy')} · ${priceTag(it)}</button>`}
    </div>`, {
      onOpen: (w) => {
        let alive = true, raf = 0; const timers = new Set();
        const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms); timers.add(id); };
        later(() => $$('.product-stats .stat-bar i', w).forEach((i, k) => later(() => i.style.setProperty('--p', i.dataset.p), k * 120)), 350);
        // вращение предмета
        const sp = w.querySelector('.product-spin'), stage = w.querySelector('.product-stage'), anchor = sp || stage;
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
          later(() => { const p = FX.pt(anchor); FX.burst(p.x, p.y, { c: ['#FFC93A', '#fff', getComputedStyle(w.querySelector('.product-sheet')).getPropertyValue('--rc').trim() || '#fff'], count: 50, speed: 14, size: 1.4 }); FX.twinkles(p.x, p.y, 80, 12); Sfx.reveal(3); haptic('success'); flash('#fff', .4); }, 650);
          buy.outerHTML = `<button class="btn btn-success btn-block" data-a="equip">${t('shop.equip')}</button>`;
          w.querySelector('.product-stage').insertAdjacentHTML('beforeend', `<span class="product-stamp">${t('shop.bought')}</span>`);
          const card = $(`.screen.current [data-item="${it.id}"] .item-price`); if (card) { card.className = 'item-price own'; card.innerHTML = Art.icon('check', { c: '#9CFFD0' }) + t('shop.owned'); }
        });
        const click = (e) => {
          if (!e.target.closest('[data-a=equip]') || !S.owned.includes(it.id) || it.kind !== 'racket') return;
          S.equipped.racket = it.id; saveNow();
          if (typeof GameHost !== 'undefined' && GameHost.ready) GameHost.send('equip', { equipped: S.equipped });
          toast(t('shop.equipped', { name: itemName(it) }), 'check'); Sheet.close();
          if (Router.cur === 'profile') {
            Router.repaint(); Router.active.el.querySelector('.eq-grid').focus({ preventScroll: true });
          }
        };
        w.addEventListener('click', click);
        return () => { alive = false; timers.forEach(clearTimeout); cancelAnimationFrame(raf); w.removeEventListener('click', click); stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', end); stage.removeEventListener('pointerleave', end); stage.removeEventListener('pointercancel', end); };
      }
    });
  }
});

/* ---------------- СЕЗОННЫЙ ПРОПУСК ---------------- */
