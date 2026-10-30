Router.def('pass', {
  mood: 'violet', live: true,
  render() {
    const curS = globalThis.TTSeason.currentSeason();
    const over = globalThis.TTSeason.seasonOver() || S.passSeason !== curS.n;
    const cell = (r, lane, l) => {
      const claimed = S.claimed[lane].includes(l); const reached = l <= S.passLvl; const locked = lane === 'p' && !S.premium;
      const st = claimed ? 'claimed' : reached && !locked && !over ? 'ready' : 'future';
      const art = r.k === 'coins' ? Art.coin(38) : r.k === 'gems' ? Art.gem(36) : r.k === 'chest' ? Art.chest(r.kind, 50) : Art.rubber(r.col, 46);
      return `<button class="pc ${lane} ${st} ${locked ? 'locked' : ''}" data-l="${l}" data-lane="${lane}" data-press>
        <span class="pca">${art}</span><b class="num">${r.k === 'chest' || r.k === 'card' ? '' : '×' + r.n}</b>
        ${claimed ? `<span class="pcc">${Art.icon('check', { c: '#fff', sw: 3 })}</span>` : ''}${locked ? `<span class="pcl">${Art.icon('lock', { c: '#FFE28A' })}</span>` : ''}</button>`;
    };
    const pass = globalThis.TTSeason.currentPass();
    return `${UI.hud()}<div class="scroll" id="passScroll" data-pass-season="${curS.n}">
      <div class="pass-hero rise" style="--d:0">
        <i class="ph-ill" style="background-image:url('${ILL.pass_hero}')"></i><i class="ph-shade"></i>
        <span class="chip violet">${Art.icon('clock', { c: '#D9C6FF' })} ${over ? t('season.over') : t('pass.left', { left: globalThis.TTSeason.seasonLeftText() })}</span>
        <div class="ph-t"><span class="cap">${t('pass.seasonLine', { s: curS.n, n: curS.days })}</span><b class="h-display">${t('pass.title')}</b></div>
        <div class="ph-lv"><span class="phl"><span class="num">${S.passLvl}</span></span><div style="flex:1"><div class="cap" style="margin-bottom:6px">${t('pass.level')}</div><div class="bar"><i style="--p:${S.passXp / 100}"></i><span class="lbl">${S.passXp} / 100 XP</span></div></div></div>

      </div>
      ${S.premium ? '' : `<div class="pass-cta rise" style="--d:1"><span class="pcta-i">${Art.icon('crown', { c: '#3A1A00', fill: '#3A1A00' })}</span><div><b>${t('pass.premium')}</b><small>${t('pass.premiumSub', { n: pass.length })}</small></div>${over ? `<span class="dim" style="font-size:11px;text-align:right;max-width:96px">${t('pass.seasonClosed')}</span>` : `<button class="b3 sm" data-act="premium"><span class="shine"></span>⭐ 349</button>`}</div>`}
      <div class="track-h rise" style="--d:2"><span>${t('pass.free')}</span><span></span><span class="gold">${t('pass.premiumShort')}</span></div>
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
    if (!el.classList.contains('repaint')) setTimeout(() => { const c = el.querySelector('.trow.cur'); const sc = el.querySelector('#passScroll'); if (el.isConnected && c && sc) sc.scrollTo({ top: c.offsetTop - sc.clientHeight / 2 + 40, behavior: 'smooth' }); }, 700);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act=premium]'); if (a) return this.buyPremium(a, renderedSeason);
      const c = e.target.closest('.pc'); if (!c) return;
      Progress.reconcileSeason();
      if (globalThis.TTSeason.seasonOver() || renderedSeason !== globalThis.TTSeason.seasonNumber() || renderedSeason !== S.passSeason) { toast(t('season.over'), 'clock'); return; }
      const l = +c.dataset.l, lane = c.dataset.lane; const tier = globalThis.TTSeason.currentPass()[l - 1];
      const r = tier && (lane === 'f' || lane === 'p') && tier[lane];
      if (!r || !Number.isInteger(l)) return;
      if (lane === 'p' && !S.premium) { toast(t('pass.needPremium'), 'crown'); c.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(0)' }], { duration: 300 }); return; }
      if (l > S.passLvl) { toast(t('pass.opensAt', { n: l }), 'lock'); return; }
      if (S.claimed[lane].includes(l)) return;
      if (r.k === 'chest') {
        const i = S.chests.findIndex((x) => !x);
        if (i < 0) { toast(t('chest.slotsFull'), 'gift'); return; }
        S.chests[i] = { id: `p${S.passSeason}_${lane}_${l}`, kind: r.kind, state: 'ready' };
      } else if (r.k === 'coins' || r.k === 'gems') S[r.k] += r.n;
      S.claimed[lane].push(l); saveNow();
      c.classList.remove('ready'); c.classList.add('claimed'); c.insertAdjacentHTML('beforeend', `<span class="pcc">${Art.icon('check', { c: '#fff', sw: 3 })}</span>`);
      const p = FX.pt(c); FX.burst(p.x, p.y, { c: ['#D3B5FF', '#FFC93A', '#fff'], count: 26, speed: 9 }); haptic('success');
      if (r.k === 'coins' || r.k === 'gems') Wallet.show(r.k, r.n, p);
      else if (r.k === 'chest') { Sfx.reveal(2); toast(t('chest.toSlot', { name: Art.chestName(r.kind) + ' ' + t('chest.word') }), 'gift'); }
      else { Sfx.reveal(2); toast(t('pass.newRubber'), 'paddle'); }
      Nav.dots();   // бадж считается из состояния, а не отнимается «на глаз»
    });
  },
  buyPremium(btn, seasonN = globalThis.TTSeason.seasonNumber()) {
    Progress.reconcileSeason();
    if (globalThis.TTSeason.seasonOver() || seasonN !== globalThis.TTSeason.seasonNumber() || seasonN !== S.passSeason) { toast(t('season.over'), 'clock'); return; }
    Sheet.open(`<div class="stars-pay"><div class="sp-ic gold">${Art.icon('crown', { c: '#FFC93A', fill: '#FFC93A' })}</div><div class="h1">${t('pass.premium')}</div>
      <p class="mut">${t('pass.premiumText', { item: itemName(Catalog.byId('r-void')) })}</p>
      <button class="b3 block" data-a="pay"><span class="shine"></span>${t('shop.starsPay', { amt: 349 })}</button><p class="dim" style="font-size:11px;margin-top:12px">${t('shop.starsDemo')}</p></div>`, {
      onOpen: (w) => w.querySelector('[data-a=pay]').addEventListener('click', async (e) => {
        if (e.currentTarget.disabled) return;
        e.currentTarget.disabled = true;
        Sheet.close(); await sleep(250);
        Progress.reconcileSeason();
        if (globalThis.TTSeason.seasonOver() || seasonN !== globalThis.TTSeason.seasonNumber() || seasonN !== S.passSeason) { toast(t('season.over'), 'clock'); return; }
        if (S.premium) return;
        S.premium = true; saveNow(); Sfx.win(); haptic('success'); flash('#FFE680', .6); FX.rain(90);
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
