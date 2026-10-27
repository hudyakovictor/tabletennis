Router.def('ranks', {
  mood: 'gold',
  data(tab) {
    const base = PEOPLE.map((p, i) => ({ ...p, key: 'p' + i }));
    let list = tab === 'friends' ? base.filter((_, i) => [0, 1, 3, 5].includes(i)) : tab === 'club' ? base.filter((_, i) => [0, 2, 4].includes(i)) : base;
    const meRow = { n: S.name, s: t('ranks.you'), r: S.rating, key: 'me', me: true, club: S.club };
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
      ${tab === 'world' && me ? `<div class="lrow me sticky"><span class="lp num">${fmt(me.pos)}</span>${Art.avatar('me', 40)}<span class="ln"><b>${t('ranks.you')}</b><small>${t('ranks.topPct', { club: S.club })}</small></span><span class="lch up">▲38</span><span class="lr num">${Art.badge(leagueOf(S.rating), 18)}${fmt(S.rating)}</span></div>` : ''}`;
  },
  render() {
    /* Фильтр стоит ПЕРВЫМ (важнее заголовка), плитки ниже собраны в одну
     * общую плашку — визуально группа, а не разрозненные элементы. */
    return `${UI.hud()}<div class="scroll">
      <div class="seg rise" style="--d:0;margin:8px 14px 4px" id="rkSeg"><span class="pill"></span><button class="on" data-v="world">${t('ranks.world')}</button><button data-v="friends">${t('common.friends')}</button><button data-v="club">${t('ranks.club')}</button></div>
      <div class="pg-head rise" style="--d:1;margin:4px 14px 6px"><div class="h1">${t('ranks.title')}</div><span class="chip gold">${Art.icon('clock', { c: '#FFE28A' })} ${t('ranks.seasonChip', { left: t('season.leftShort') })}</span></div>
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