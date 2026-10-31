Router.def('pass', {
  mood: 'violet', live: true,
  render() {
    const curS = globalThis.TTSeason.currentSeason();
    const over = globalThis.TTSeason.seasonOver() || S.passSeason !== curS.n;
    const cell = (r, lane, l) => {
      const claimed = Rewards.passClaimed(curS.n, lane, l); const reached = l <= S.passLvl; const locked = lane === 'p' && !S.premium;
      const st = claimed ? 'claimed' : reached && !locked && !over ? 'ready' : 'future';
      const item = Catalog.rewardItem(r);
      const art = r.k === 'coins' ? Art.coin(38) : r.k === 'gems' ? Art.gem(36) : r.k === 'chest' ? Art.chest(r.kind, 50) : item ? item.kind === 'frame' ? Art.avatar('me', 46, { ring: item.col }) : ItemArt.of(item, 46) : Art.icon('lock');
      return `<button class="pc ${lane} ${st} ${locked ? 'locked' : ''}" data-l="${l}" data-lane="${lane}" data-press>
        <span class="pca">${art}</span><b class="num">${r.k === 'chest' || r.k === 'card' ? '' : '×' + r.n}</b>
        ${claimed ? `<span class="pcc">${Art.icon('check', { c: '#fff', sw: 3 })}</span>` : ''}${locked ? `<span class="pcl">${Art.icon('lock', { c: '#FFE28A' })}</span>` : ''}</button>`;
    };
    const pass = globalThis.TTSeason.currentPass();
    return `${UI.hud()}<div class="scroll" id="passScroll" data-pass-season="${curS.n}">
      <div class="pass-hero rise" style="--d:0">
        <i class="ph-ill" style="background-image:url('${ILL.pass_hero}')"></i><i class="ph-shade"></i>
        <span class="chip violet">${Art.icon('clock', { c: '#D9C6FF' })} <span data-pass-left>${over ? t('season.over') : t('pass.left', { left: globalThis.TTSeason.seasonLeftText() })}</span></span>
        <div class="ph-t"><span class="cap" data-pass-line>${t('pass.seasonLine', { s: curS.n, n: curS.days })}</span><b class="h-display" data-l10n="pass.title">${t('pass.title')}</b></div>
        <div class="ph-lv"><span class="phl"><span class="num">${S.passLvl}</span></span><div style="flex:1"><div class="cap" data-l10n="pass.level" style="margin-bottom:6px">${t('pass.level')}</div><div class="bar"><i style="--p:${S.passXp / 100}"></i><span class="lbl">${S.passXp} / 100 XP</span></div></div></div>

      </div>
      ${S.premium ? '' : `<div class="pass-cta rise" style="--d:1"><span class="pcta-i">${Art.icon('crown', { c: '#3A1A00', fill: '#3A1A00' })}</span><div><b data-l10n="pass.premium">${t('pass.premium')}</b><small data-pass-premium-sub>${t('pass.premiumSub', { n: pass.length })}</small></div>${over ? `<span class="dim" data-l10n="pass.seasonClosed" style="font-size:11px;text-align:right;max-width:96px">${t('pass.seasonClosed')}</span>` : `<button class="b3 sm" data-act="premium"><span class="shine"></span>${Art.icon('tstar', { c: '#3A1A00', fill: '#3A1A00' })} ${Catalog.starOffer('premium-pass').price.amt}</button>`}</div>`}
      <div class="track-h rise" style="--d:2"><span data-l10n="pass.free">${t('pass.free')}</span><span></span><span class="gold" data-l10n="pass.premiumShort">${t('pass.premiumShort')}</span></div>
      <div class="track">
        <div class="tline"><i style="height:${Math.max(0, (S.passLvl - .5) / pass.length * 100)}%"></i></div>
        ${pass.map((r, i) => `<div class="trow ${r.l === S.passLvl ? 'cur' : ''} ${r.l <= S.passLvl ? 'reached' : ''}" style="--d:${Math.min(i, 10) + 3}">
          ${cell(r.f, 'f', r.l)}<span class="tnode"><span class="num">${r.l}</span></span>${cell(r.p, 'p', r.l)}</div>`).join('')}
      </div>
    </div>`;
  },
  mount(el) {
    UI.bindHud(el);
    const renderedSeason = Number(el.querySelector('[data-pass-season]').dataset.passSeason);
    const timer = !el.classList.contains('repaint') ? setTimeout(() => { const c = el.querySelector('.trow.cur'); const sc = el.querySelector('#passScroll'); if (el.isConnected && c && sc) sc.scrollTo({ top: c.offsetTop - sc.clientHeight / 2 + 40, behavior: 'smooth' }); }, 700) : 0;
    const click = (e) => {
      const a = e.target.closest('[data-act=premium]'); if (a) return this.buyPremium(a, renderedSeason);
      const c = e.target.closest('.pc'); if (!c) return;
      const l = +c.dataset.l, lane = c.dataset.lane; const tier = globalThis.TTSeason.currentPass()[l - 1];
      const r = tier && (lane === 'f' || lane === 'p') && tier[lane];
      if (!r || !Number.isInteger(l)) return;
      const result = Rewards.claimPass(renderedSeason, lane, l);
      if (!result.ok) {
        if (result.why === 'claimed') return;
        toast(result.why === 'season' ? t('season.over') : result.why === 'premium' ? t('pass.needPremium') : result.why === 'level' ? t('pass.opensAt', { n: l }) : result.why === 'slotsFull' ? t('chest.slotsFull') : t('pass.rewardUnavailable'), result.why === 'slotsFull' ? 'gift' : 'lock');
        return;
      }
      const cell = $(`.screen.current .pc[data-l="${l}"][data-lane="${lane}"]`) || c;
      cell.classList.remove('ready'); cell.classList.add('claimed'); cell.insertAdjacentHTML('beforeend', `<span class="pcc">${Art.icon('check', { c: '#fff', sw: 3 })}</span>`);
      const p = FX.pt(cell); FX.burst(p.x, p.y, { c: ['#D3B5FF', '#FFC93A', '#fff'], count: 26, speed: 9 }); haptic('success');
      if (r.k === 'coins' || r.k === 'gems') Wallet.show(r.k, r.n, p);
      else if (r.k === 'chest') { Sfx.reveal(2); toast(t('chest.toSlot', { name: Art.chestName(r.kind) + ' ' + t('chest.word') }), 'gift'); }
      else { Sfx.reveal(2); toast(result.items.length ? itemName(Catalog.byId(result.items[0])) : t('shop.owned'), 'paddle'); }
      Nav.dots();   // бадж считается из состояния, а не отнимается «на глаз»
    };
    el.addEventListener('click', click);
    return () => { clearTimeout(timer); el.removeEventListener('click', click); };
  },
  refreshLocale(el) {
    UI.refreshHud(el); UI.localize(el);
    const season = globalThis.TTSeason, cur = season.currentSeason(), over = season.seasonOver() || S.passSeason !== cur.n;
    el.querySelector('[data-pass-left]').textContent = over ? t('season.over') : t('pass.left', { left: season.seasonLeftText() });
    el.querySelector('[data-pass-line]').textContent = t('pass.seasonLine', { s: cur.n, n: cur.days });
    const sub = el.querySelector('[data-pass-premium-sub]'); if (sub) sub.textContent = t('pass.premiumSub', { n: season.currentPass().length });
  },
  buyPremium(btn, seasonN = globalThis.TTSeason.seasonNumber(), receipt = null) {
    if (receipt) {
      const result = Rewards.confirmPurchase('premium-pass', receipt);
      if (result.ok) { Sfx.win(); haptic('success'); flash('#FFE680', .6); if (Router.cur === 'pass') Router.repaint(); Nav.dots(); }
      else if (result.why !== 'claimed') toast(t(result.why === 'season' ? 'season.over' : 'shop.starsUnconfirmed'), 'lock');
      return result;
    }
    Progress.reconcileSeason();
    if (globalThis.TTSeason.seasonOver() || seasonN !== globalThis.TTSeason.seasonNumber() || seasonN !== S.passSeason) { toast(t('season.over'), 'clock'); return; }
    if (S.premium) return;
    Sheet.open(`<div class="stars-pay"><div class="sp-ic gold">${Art.icon('crown', { c: '#FFC93A', fill: '#FFC93A' })}</div><div class="h1">${t('pass.premium')}</div>
      <p class="mut">${t('pass.premiumText', { n: globalThis.TTSeason.currentPass().length })}</p>
      <button class="b3 block" data-a="pay" disabled><span class="shine"></span>${t('shop.starsPay', { amt: Catalog.starOffer('premium-pass').price.amt })}</button><p class="dim" role="status" style="font-size:11px;margin-top:12px">${t('shop.starsUnavailable')}</p></div>`);
  }
});

/* ---------------- РЕЙТИНГ ---------------- */
