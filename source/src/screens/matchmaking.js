/* =====================================================================
   BATTLE LOOP — поиск → VS → матч → итог → сундук
   ===================================================================== */
let BATTLE = { opp: 0 };
const Demo = {
  result(win) { return { win, me: win ? 7 : 4, op: win ? 4 : 7, opp: 0, stats: { hits: 38, perfect: 5, smash: 3, maxRally: 12, acc: 81 } }; }
};

/* ---------------- ПОИСК СОПЕРНИКА ---------------- */
Router.def('mm', {
  full: true, mood: 'battle',
  render() {
    const L = leagueOf(S.rating);
    return `<div class="mm safe-top">
      <i class="mm-ill" style="background-image:url('${ILL.radar}')"></i>
      <div class="mm-top"><span class="chip gold">${Art.icon(MODE.i, { c: '#FFE28A' })} ${t(MODE.tk)} · ${leagueName(L)}</span>
        <div class="h1 mm-t">${t('mm.searching')}<span class="dots"><i>.</i><i>.</i><i>.</i></span></div>
        <div class="mm-time num">0:00</div></div>
      <div class="radar">
        <div class="rg r1"></div><div class="rg r2"></div><div class="rg r3"></div>
        <div class="sweep"></div>
        ${[...Array(6)].map((_, i) => `<span class="blip" style="--a:${i * 61 + 20}deg;--r:${60 + (i % 3) * 34}px;--dl:${i * .4}s"></span>`).join('')}
        <div class="me">${Art.avatar('me', 96)}</div>
      </div>
      <div class="found"><span class="cap">${t('mm.found')}</span><b class="h2"></b></div>
      <div class="mm-tip pnl inset"><span>${Art.icon('info', { c: '#9BE8FF' })}</span><p>${t('mm.tip')}</p></div>
      <button class="b3 dark sm mm-cancel" data-act="cancel">${t('common.cancel')}</button>
    </div>`;
  },
  mount(el) {
    const t0 = Date.now(); const tm = el.querySelector('.mm-time');
    this.iv = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); tm.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }, 250);
    /* one soft blip as the search starts — a repeating sonar out of context
       reads as a broken smoke detector */
    this.sonar = setTimeout(() => Sfx.soft(), 350);
    el.querySelector('[data-act=cancel]').addEventListener('click', () => { this.cancelled = true; Router.go('hub'); });
    this.cancelled = false;
    GameHost.ensure(); GameHost.send('attract');
    BATTLE = { opp: MODE.id === 'friend' ? 0 : pick(MM_POOL[leagueOf(S.rating).id] || MM_POOL.bronze) };
    /* Только радар: поиск — свип и блипы, нашёлся — имя и вспышка в центре.
       Лента-рулетка с карточками соперников убрана по дизайну: выбор
       соперника — дело лиги и рейтинга, а не барабана. */
    (async () => {
      await sleep(2300); if (this.cancelled) return;
      clearInterval(this.sonar);
      const o = PEOPLE[BATTLE.opp]; const f = el.querySelector('.found');
      f.querySelector('b').textContent = o.n; f.classList.add('on');
      el.querySelector('.mm').classList.add('found-on');
      const p = FX.pt(el.querySelector('.radar .me'));
      FX.burst(p.x, p.y, { c: ['#2EE6FF', '#fff', '#FFC93A'], count: 36, speed: 12, size: 1.2 });
      FX.ring(p.x, p.y, '#7DF3FF', 170, 9);
      Sfx.impact(); haptic('heavy'); flash('#7DF3FF', .35);
      await sleep(1150); if (this.cancelled) return;
      Router.go('vs');
    })();
  },
  leave() { clearInterval(this.iv); clearInterval(this.sonar); this.cancelled = true; },
  onBack() { this.cancelled = true; Router.go('hub'); }
});

/* ---------------- VS ---------------- */
Router.def('vs', {
  full: true, mood: 'battle',
  render() {
    const o = PEOPLE[BATTLE.opp]; const Lo = leagueOf(o.r), Lm = leagueOf(S.rating);
    const stat = (l, a, b) => `<div class="vs-st"><b class="num">${a}</b><span>${l}</span><b class="num">${b}</b><i style="--a:${a / (a + b)}"></i></div>`;
    return `<div class="vs">
      <div class="vs-half top" style="--c1:${o.c[0]};--c2:${o.c[1]}">
        <div class="vs-art">${Art.avatar('p' + BATTLE.opp, 210, { round: false })}</div>
        <div class="vs-info"><span class="vs-badge">${Art.badge(Lo, 44)}</span><b class="h-display">${o.s}</b><span class="mut">${o.club} · <b class="num">${fmt(o.r)}</b></span></div>
      </div>
      <div class="vs-half bot" style="--c1:#FF7A4D;--c2:#B4161E">
        <div class="vs-art">${Art.avatar('me', 210, { round: false })}</div>
        <div class="vs-info"><span class="vs-badge">${Art.badge(Lm, 44)}</span><b class="h-display">${S.name.split(' ')[0]}</b><span class="mut">${S.club} · <b class="num">${fmt(S.rating)}</b></span></div>
      </div>
      <div class="vs-mid"><div class="vs-logo"><span class="v">V</span><span class="s">S</span></div></div>
      <div class="vs-stats pnl">${stat(t('vs.winrate'), Math.round(S.wins / (S.wins + S.losses) * 100), o.wr)}${stat(t('vs.streak'), S.streak, 2)}${stat(t('vs.bestRally'), S.bestRally, 19)}</div>
    </div>`;
  },
  mount(el) {
    const vs = el.querySelector('.vs'); this.alive = true;
    (async () => {
      await sleep(80); vs.classList.add('in'); Sfx.whoosh();
      await sleep(520); if (!this.alive) return;
      vs.classList.add('slam'); Sfx.impact(); haptic('heavy'); FX.shake(18, 520); flash('#fff', .7);
      const p = FX.pt(el.querySelector('.vs-logo')); FX.burst(p.x, p.y, { c: ['#FFC93A', '#FF4B3E', '#2EE6FF', '#fff'], count: 50, speed: 15, size: 1.6 }); FX.ring(p.x, p.y, '#fff', 220, 10);
      await sleep(500); if (!this.alive) return; vs.classList.add('stats');
      await sleep(1700); if (!this.alive) return;
      Router.go('match');
    })();
  },
  leave() { this.alive = false; },
  onBack() { this.alive = false; Router.go('hub'); }
});

/* ---------------- МАТЧ (настоящий движок TOPSPIN ARENA в iframe) ----------------
   Хореография: кинематографические полосы → облёт камеры к столу с плашками
   игроков → 3-2-1 «Игра!» → матч → «Победа/Поражение» с облётом победителя →
   лучший розыгрыш (повтор) → итог. Счёт, баннеры и пауза — в дизайне v2. */