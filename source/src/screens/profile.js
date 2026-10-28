Router.def('profile', {
  mood: 'arena',
  /* Числа профиля приходят с сервера: пока ответ в пути, рисуем локальные,
   * а когда они сменятся — экран перерисует Progress.merge. */
  live: true,
  render() {
    const L = leagueOf(S.rating); const total = S.wins + S.losses; const wr = total ? Math.round(S.wins / total * 100) : null;
    // рейтинг за 30 дней
    let r = S.rating - 240; const pts = [...Array(30)].map((_, i) => (r += Math.sin(i * 1.3) * 22 + 9 + (i > 24 ? 6 : 0)));
    pts[29] = S.rating; this.pts = pts;
    const sk = Career.radar(); this.sk = sk;
    const ach = ACH.map((a) => [t(a.tk), a.i, !!Career.got[a.id], t(a.dk)]); const achN = ach.filter((a) => a[2]).length;
    const eq = (k) => ALL_ITEMS.find((x) => x.id === S.equipped[k]) || null;
    return `${UI.hud()}<div class="scroll">
      <div class="pf-hero pnl rise" style="--d:0">
        <div class="pf-av">${Art.avatar('me', 92, { round: false })}<span class="pf-lv">${S.level}</span></div>
        <div class="pf-id"><b class="h2">${S.name}</b><span class="dim">${S.nick}</span><span class="chip cyan" style="margin-top:8px">${Art.icon('shield', { c: '#7DF3FF' })} ${S.club}</span></div>
        <button class="ib pf-set" data-act="settings" aria-label="${t('nav.settings')}">${Art.icon('gear', { c: '#fff' })}</button>
        <div class="pf-league"><span class="pfl-b">${Art.badge(L, 74)}</span><span class="cap">${leagueName(L)}</span><b class="num txt-gold">${fmt(S.rating)}</b></div>
      </div>
      <div class="pf-stats">
        <div class="pnl pst rise" style="--d:1"><span class="cap">${t('profile.matches')}</span><b class="num" data-n="${total}">0</b></div>
        <div class="pnl pst rise" style="--d:2"><span class="cap">${t('profile.wins')}</span><b class="num txt-gold" data-n="${S.wins}">0</b></div>
        <div class="pnl pst ring rise" style="--d:3"><svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="25" fill="none" stroke="rgba(0,0,0,.45)" stroke-width="7"/>${wr === null ? '' : `<circle class="wr" cx="30" cy="30" r="25" fill="none" stroke="url(#wrg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="157" stroke-dashoffset="157" data-o="${157 * (1 - wr / 100)}"/>`}<defs><linearGradient id="wrg"><stop offset="0" stop-color="#3BF5A0"/><stop offset="1" stop-color="#2EC9FF"/></linearGradient></defs></svg><b class="num">${wr === null ? '—' : wr + '%'}</b><span class="cap">${t('profile.winrate')}</span></div>
      </div>
      <div class="pnl chart rise" style="--d:4"><div class="ch-h"><span class="cap">${t('profile.rating30')}</span><b class="num" id="chVal">${fmt(S.rating)}</b><em class="up">+${Math.round(S.rating - pts[0])}</em></div>
        <div class="ch-wrap" id="chWrap">${this.chart(pts)}</div></div>
      ${this.technique()}
      <div class="pnl skills rise" style="--d:5"><span class="cap">${t('profile.style')}${Career.c.m ? t('profile.styleBy', { n: Career.c.m }) : t('profile.stylePlay')}</span><div class="sk-wrap">${this.radar(sk)}</div></div>
      <div class="sec-title rise" style="--d:6"><span class="h2">${Art.icon('trophy')}${t('profile.achievements')}</span><span class="dim" style="font-size:11.5px">${achN} / ${ach.length}</span></div>
      <div class="ach">${ach.map(([t, i, got, dsc], k) => `<div class="ac ${got ? 'got' : ''} pop" style="--d:${k + 6}" data-ach="${dsc}" data-press><span class="aci">${Art.icon(i, { c: got ? '#3A1A00' : 'rgba(255,255,255,.35)', sw: 2.2, fill: got && ICON_FILL.has(i) ? '#3A1A00' : 'transparent' })}</span><small>${t}</small></div>`).join('')}</div>
      <div class="sec-title rise" style="--d:8"><span class="h2">${Art.icon('paddle', { c: '#FFB3A6' })}${t('profile.equipment')}</span></div>
      <div class="grid3 eq">${['rubber', 'blade', 'trail'].map((k, i) => { const it = eq(k);
        return it ? `<div class="icard rar ${it.r} rise" style="--d:${9 + i}"><span class="ic-art">${ItemArt.of(it, 56)}</span><span class="ic-n">${itemName(it)}</span><span class="ic-t">${kindName(it)}</span></div>`
          : `<div class="icard rise" style="--d:${9 + i}"><span class="ic-art dim-ic">${Art.icon('lock', { c: 'rgba(255,255,255,.3)' })}</span><span class="ic-n dim">${t('profile.notEquipped')}</span><span class="ic-t">${kindName(k)}</span></div>`; }).join('')}</div>
    </div>`;
  },
  /* Техника удара: точность контакта по последним матчам — из тех же попыток,
     что и «Разбор матча». Показывает прогресс, а не только рейтинг. */
  technique() {
    const M = ZoneStats.matches().slice(-12);
    if (!M.length) return `<div class="pnl tq empty rise" style="--d:4"><span class="cap">${t('profile.techTitle')}</span><p>${t('profile.techEmpty')}</p></div>`;
    const last = M[M.length - 1], prev = M.slice(0, -1);
    const avgPrev = prev.length ? Math.round(prev.reduce((s, m) => s + m.pct, 0) / prev.length) : null;
    const trend = avgPrev === null ? null : last.pct - avgPrev;
    const cnt = {}; M.forEach((m) => { if (m.key !== 'good') cnt[m.key] = (cnt[m.key] || 0) + 1; });
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    const KEY = { side: t('profile.errSide'), high: t('profile.errHigh'), early: t('profile.errEarly'), racket: t('profile.errRacket') };
    const bars = M.map((m, i) => `<i class="${m.win ? 'w' : 'l'}${i === M.length - 1 ? ' last' : ''}" style="--h:${Math.max(4, m.pct)};--i:${i}"><em class="num">${m.pct}</em></i>`).join('');
    return `<div class="pnl tq rise" style="--d:4">
      <div class="ch-h"><span class="cap">${t('profile.techContact')}</span><b class="num">${last.pct}%</b>${trend === null ? '' : `<em class="${trend >= 0 ? 'up' : 'dn'}">${trend >= 0 ? '+' : ''}${trend}</em>`}</div>
      <div class="tq-bars">${bars}</div>
      <div class="tq-leg"><span><i class="w"></i>${t('profile.legendWin')}</span><span><i></i>${t('profile.legendLose')}</span><span>${t('profile.lastMatches', { n: M.length })}</span></div>
      <p class="tq-note">${top ? t('profile.techOften', { what: KEY[top[0]], a: top[1], b: M.length }) : t('profile.techClean')}</p></div>`;
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
