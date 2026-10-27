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
        <span class="chip violet">${Art.icon('clock', { c: '#D9C6FF' })} ${t('pass.left', { left: t('season.left') })}</span>
        <div class="ph-t"><span class="cap">${t('pass.seasonLine', { s: SEASON.n, n: SEASON.days })}</span><b class="h-display">${t('pass.title')}</b></div>
        <div class="ph-lv"><span class="phl"><span class="num">${S.passLvl}</span></span><div style="flex:1"><div class="cap" style="margin-bottom:6px">${t('pass.level')}</div><div class="bar"><i style="--p:${S.passXp / 100}"></i><span class="lbl">${S.passXp} / 100 XP</span></div></div></div>

      </div>
      ${S.premium ? '' : `<div class="pass-cta rise" style="--d:1"><span class="pcta-i">${Art.icon('crown', { c: '#3A1A00', fill: '#3A1A00' })}</span><div><b>${t('pass.premium')}</b><small>${t('pass.premiumSub', { n: 35 })}</small></div><button class="b3 sm" data-act="premium"><span class="shine"></span>⭐ 349</button></div>`}
      <div class="track-h rise" style="--d:2"><span>${t('pass.free')}</span><span></span><span class="gold">${t('pass.premiumShort')}</span></div>
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
      if (c.classList.contains('locked')) { toast(t('pass.needPremium'), 'crown'); c.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-6deg)' }, { transform: 'rotate(6deg)' }, { transform: 'rotate(0)' }], { duration: 300 }); return; }
      if (c.classList.contains('future')) { toast(t('pass.opensAt', { n: l }), 'lock'); return; }
      if (c.classList.contains('claimed')) return;
      S.claimed[lane].push(l); save();
      c.classList.remove('ready'); c.classList.add('claimed'); c.insertAdjacentHTML('beforeend', `<span class="pcc">${Art.icon('check', { c: '#fff', sw: 3 })}</span>`);
      const p = FX.pt(c); FX.burst(p.x, p.y, { c: ['#D3B5FF', '#FFC93A', '#fff'], count: 26, speed: 9 }); haptic('success');
      if (r.k === 'coins' || r.k === 'gems') Wallet.add(r.k, r.n, p);
      else if (r.k === 'chest') { Sfx.reveal(2); toast(t('chest.toSlot', { name: Art.chestName(r.kind) + ' ' + t('chest.word') }), 'gift'); const i = S.chests.findIndex((x) => !x); if (i >= 0) { S.chests[i] = { id: 'p' + l, kind: r.kind, state: 'ready' }; save(); } }
      else { Sfx.reveal(2); toast(t('pass.newRubber'), 'paddle'); }
      Nav.dots();   // бадж считается из состояния, а не отнимается «на глаз»
    });
  },
  buyPremium(btn) {
    Sheet.open(`<div class="stars-pay"><div class="sp-ic gold">${Art.icon('crown', { c: '#FFC93A', fill: '#FFC93A' })}</div><div class="h1">${t('pass.premium')}</div>
      <p class="mut">${t('pass.premiumText', { item: itemName(Catalog.byId('r-void')) })}</p>
      <button class="b3 block" data-a="pay"><span class="shine"></span>${t('shop.starsPay', { amt: 349 })}</button><p class="dim" style="font-size:11px;margin-top:12px">${t('shop.starsDemo')}</p></div>`, {
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