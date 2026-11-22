function confirmSheet(title, text, ok, fn) {
  Sheet.open(`<div class="h1" style="margin:4px 4px 6px">${title}</div><p class="dim" style="margin:0 4px 16px;font-size:12.5px">${text}</p>
    <div style="display:grid;gap:12px"><button class="b3 coral block" data-a="ok">${ok}</button><button class="b3 dark block sm" data-a="no">${t('common.stay')}</button></div>`, {
    onOpen: (w) => w.addEventListener('click', (e) => { const a = e.target.closest('[data-a]'); if (!a) return; Sheet.close(true); if (a.dataset.a === 'ok') fn(); })
  });
}

/* ---------------- Dev: зона удара (?dev=1 или десктоп-панель) ---------------- */
function devZoneSheet() {
  const R = Object.assign({}, GameHost.rules || {}, GameHost.devRules());
  const F = [
    ['captureRadius', .08, .62, .01], ['depthTolerance', .08, .62, .01],
    ['serveCaptureRadius', .2, .9, .01], ['contactForwardPx', 40, 240, 2],
    ['contactBackPx', 0, 200, 2], ['contactSideTouchPx', 20, 90, 2],
    ['contactSideMousePx', 16, 80, 2]
  ];
  const row = ([k, a, b, s]) => `<label class="dz-row"><span>${t('zone.field.' + k)}</span><input type="range" min="${a}" max="${b}" step="${s}" value="${R[k] ?? a}" data-k="${k}"><b class="num" data-v="${k}">${R[k] ?? a}</b></label>`;
  Sheet.open(`<div class="h1" style="margin:4px 4px 4px">${t('zone.title')}</div><p class="dim" style="margin:0 4px 12px;font-size:11.5px">${t('zone.notice')}</p>
    <div class="pnl dz">${F.map(row).join('')}
    <label class="dz-row"><span>${t('zone.show')}</span><button class="tgl ${GameHost.debug ? 'on' : ''}" data-t="debug"></button></label>
    <label class="dz-row"><span>${t('zone.auto')}</span><button class="tgl ${R.autoFootwork !== false ? 'on' : ''}" data-t="autoFootwork"></button></label></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px"><button class="b3 dark sm" data-a="reset">${t('zone.reset')}</button><button class="b3 green sm" data-a="apply">${t('zone.apply')}</button></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px"><button class="b3 dark sm" data-a="stats">${t('zone.stats', { n: ZoneStats.all().length })}</button><button class="b3 dark sm" data-a="link">${t('zone.link')}</button></div>`, {
    onOpen: (w) => {
      const draft = Object.assign({}, GameHost.devRules());
      w.addEventListener('input', (e) => { const i = e.target.closest('input[data-k]'); if (!i) return; draft[i.dataset.k] = +i.value; w.querySelector(`[data-v="${i.dataset.k}"]`).textContent = i.value; });
      w.addEventListener('click', (e) => {
        const toggle = e.target.closest('[data-t]');
        if (toggle) { const k = toggle.dataset.t; if (k === 'debug') { GameHost.setDebug(!GameHost.debug); toggle.classList.toggle('on', GameHost.debug); } else { draft[k] = !toggle.classList.contains('on'); toggle.classList.toggle('on', draft[k]); } return; }
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'stats') { Sheet.close(true); zoneStatsSheet(); return; }
        if (a.dataset.a === 'link') { const u = RulesLink.url(RulesLink.clean(Object.assign({}, R, draft)) || {}); copyText(u).then((ok) => toast(ok ? t('zone.linkCopied') : t('zone.copyFailed'), ok ? 'check' : 'x')); return; }
        if (a.dataset.a === 'reset') GameHost.setDevRules({});
        else GameHost.setDevRules(draft);
        Sheet.close(true); toast(t('zone.restarted'), 'target');
        const cur = Router.cur; Router.go(cur, { replace: true, mode: 'wipe', data: cur === 'train' ? { then: 'hub' } : null });
      });
    }
  });
}

/* ---------------- ИТОГ МАТЧА ---------------- */
function analysisSheet(d) {
  const c = d.coach;
  if (!c || !Number.isSafeInteger(c.n) || c.n < 3 || !Number.isSafeInteger(c.hit) || c.hit < 0 || c.hit > c.n ||
      ![c.side, c.fwd, c.back].every(n => Number.isFinite(n) && n > 0 && n <= 1000) || !Array.isArray(c.dots)) return '';
  const dots = c.dots.filter(a => a && Number.isFinite(a.dx) && Number.isFinite(a.dy)).slice(-24);
  if (!dots.length) return '';
  const { side, fwd, back } = c;
  return `<details class="res-analysis">
    <summary>${t('result.analysis')}<span class="num">${Math.round(c.hit / c.n * 100)}%</span></summary>
    <p class="res-note">${t('result.analysisSample', { n: c.n })}</p>
    <svg class="rs-map" viewBox="-104 ${-back - 30} 208 ${back + fwd + 60}" role="img" aria-label="${t('analysis.mapTitle')}">
      <path d="M ${-side} 0 A ${side} ${back} 0 0 1 ${side} 0 A ${side} ${fwd} 0 0 1 ${-side} 0 Z" fill="rgba(53,198,244,.10)" stroke="#35C6F4" stroke-width="2" stroke-dasharray="9 7"/>
      ${dots.map(a => `<circle cx="${clamp(a.dx, -92, 92)}" cy="${clamp(a.dy, -back - 12, fwd + 12)}" r="6.5" fill="${a.contact ? '#3BF5A0' : a.accepted ? '#FF5A4D' : '#8E98C4'}" stroke="#0B0E22" stroke-width="2"/>`).join('')}
      <circle r="5" fill="#FFD54A"/>
    </svg>
    <div class="rs-legend"><span><i style="background:#3BF5A0"></i>${t('analysis.lgHit')}</span><span><i style="background:#FF5A4D"></i>${t('analysis.lgZone')}</span><span><i style="background:#8E98C4"></i>${t('analysis.lgOut')}</span></div>
  </details>`;
}

Router.def('result', {
  full: true,
  get mood() { return 'gold'; },
  render(d) {
    d = d || this.d || { me: null, op: null, stats: {}, applied: true }; this.d = d;
    const o = PEOPLE[d.opp]; this.reports ||= new WeakMap();
    let report = this.reports.get(d);
    if (!report) {
      const pending = !d.applied && typeof d.win === 'boolean';
      report = { rating: S.rating, xp: S.xp, xpMax: S.xpMax, level: S.level,
        delta: pending ? Math.max(0, S.rating + ratingDelta(S.rating, o?.r, d.win)) - S.rating : null,
        xpGain: pending ? d.win ? 180 : 60 : null,
        loot: pending && d.win ? { coins: 90, chest: (S.chests || []).some(c => !c) } : null,
        names: [d.names?.[0] ?? S.name ?? null, d.names?.[1] ?? o?.s ?? null], levelUp: false, levelUpShown: false, presented: false };
      this.reports.set(d, report);
    }
    this.report = report;
    const esc = n => String(n ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const names = report.names.map((n, i) => String(n ?? t(i ? 'hud.far' : 'hud.near')));
    const score = n => Number.isSafeInteger(n) && n >= 0 ? String(n) : t('result.missing');
    const summary = d.presentation || MatchHUD.createSummary().freeze();
    const players = summary.players, strokes = [...new Set(players.flatMap(p => Object.keys(p.byStroke)))];
    const strokeIds = globalThis.StrokeIcons?.ids || [];
    strokes.sort((a, b) => (strokeIds.indexOf(a) < 0 ? 100 : strokeIds.indexOf(a)) - (strokeIds.indexOf(b) < 0 ? 100 : strokeIds.indexOf(b)));
    const data = (n, coverage, measured = false) => {
      if (!Number.isFinite(n)) return `<span class="res-missing" aria-label="${t('result.noData')}">${t('result.missing')}</span>`;
      const number = measured ? new Intl.NumberFormat(I18n.lang, { maximumFractionDigits: 1 }).format(n) : String(n);
      return coverage === 'complete' ? esc(number) : `<abbr title="${t('result.partial')}" aria-label="${t('result.partialNumber', { n: number })}">${esc(number)}${measured ? '*' : '+'}</abbr>`;
    };
    const head = label => `<thead><tr><th scope="col">${t(label)}</th>${names.map(n => `<th scope="col" title="${esc(n)}">${esc(n)}</th>`).join('')}</tr></thead>`;
    const metrics = [['speed', 'avg', 'result.avgSpeed'], ['speed', 'max', 'result.maxSpeed'], ['spin', 'avg', 'result.avgSpin'], ['spin', 'max', 'result.maxSpin']]
      .filter(([key, stat]) => players.some(p => Number.isFinite(p[key][stat])));
    const L = leagueOf(report.rating), N = nextLeague(report.rating);
    const outcome = typeof d.win === 'boolean' ? d.win ? 'win' : 'lose' : 'finished';
    return `<div class="res ${outcome}" data-outcome="${outcome}">
      <div class="res-scroll scroll" role="region" tabindex="0" aria-label="${t('result.summary')}"><div class="res-report">
        <header class="res-header">
          <h1 class="res-title h-display">${t('result.' + outcome)}</h1>
          ${d.quit ? `<p class="res-context">${t('result.surrender')}</p>` : ''}
          <div class="res-score" aria-label="${t('match.score')}">
            <div class="rs-p ${d.win === true ? 'w' : ''}"><b title="${esc(names[0])}">${esc(names[0])}</b></div>
            <div class="rs-n num"><span>${score(d.me)}</span><i>:</i><span>${score(d.op)}</span></div>
            <div class="rs-p ${d.win === false ? 'w' : ''}"><b title="${esc(names[1])}">${esc(names[1])}</b></div>
          </div>
        </header>
        <section class="res-progress" aria-label="${t('result.progress')}">
          <div class="res-progress-row"><span>${t('result.rating')} · ${esc(leagueName(L))}</span><b class="num" id="rRating">${fmt(report.rating)}</b>${report.delta !== null ? `<em class="${report.delta >= 0 ? 'up' : 'dn'} num">${report.delta > 0 ? '+' : ''}${report.delta}</em>` : ''}</div>
          <div class="bar gold"><i id="rBar" style="--p:${N ? clamp((report.rating - L.min) / (N.min - L.min), 0, 1) : 1}"></i></div>
          <div class="res-progress-row"><span>${t('result.xp', { n: report.level })}</span><b class="num" id="rXp">${fmt(report.xp)}</b><small class="num">/ ${fmt(report.xpMax)}</small>${report.xpGain !== null ? `<em class="up num">+${report.xpGain} XP</em>` : ''}</div>
          <div class="bar"><i id="rXpBar" style="--p:${clamp(report.xp / report.xpMax, 0, 1)}"></i></div>
          ${report.levelUp ? `<button class="res-level-up" data-act="level-up" ${report.levelUpShown ? 'disabled' : ''}>${t('result.levelUpReward', { n: report.level })}</button>` : ''}
        </section>
        <section class="res-section" data-coverage="${summary.coverage}">
          <table class="res-table"><tbody>
            <tr><th scope="row">${t('result.hits')}</th><td class="num" data-stat="hits">${data(players[0]?.hits, players[0]?.coverage)}</td></tr>
            <tr><th scope="row">${t('result.bestRally')}</th><td class="num" data-stat="best-rally">${data(summary.bestRally, summary.bestRallyCoverage)}</td></tr>
            ${Number.isFinite(players[0]?.speed?.max) ? `<tr><th scope="row">${t('result.maxSpeed')} <small>${t('unit.kmh')}</small></th><td class="num" data-metric="speed-max">${data(players[0].speed.max, players[0].speed.coverage, true)}</td></tr>` : ''}
          </tbody></table>
        </section>
        ${report.loot ? `<section class="res-section res-reward"><div>${Art.coin(22)}<b class="num">+${report.loot.coins}</b>${report.loot.chest ? `<span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px">${Art.chest('silver', 24)}<span>${Art.chestName('silver')}</span></span>` : ''}</div></section>` : ''}
        ${d.quests?.length ? `<section class="res-section res-quests">${d.quests.map(q => `<p>${esc(q.id && I18n._lookup('mission.' + q.id) ? t('mission.' + q.id) : q.t)}</p>`).join('')}</section>` : ''}
      </div></div>
      <footer class="res-btns"><button class="b3 dark" data-act="again">${Art.icon('refresh', { c: '#fff' })}${t('result.rematch')}</button><button class="b3 ${d.win ? '' : 'cyan'}" data-act="next">${t('common.next')}</button></footer>
    </div>`;
  },
  refreshLocale(el) { I18n.localizeDOM(el, this.render(this.d), '.rs-n'); return true; },
  mount(el) {
    const d = this.d, report = this.report;
    this.alive = true; this.navigating = false; this.el = el; const token = this.token = {};
    this.animations = [];
    // Commit before presentation or navigation, retaining the result object's identity.
    if (!d.applied && typeof d.win === 'boolean') {
      d.applied = true;
      const before = S.rating;
      S.rating = Math.max(0, S.rating + report.delta); report.delta = S.rating - before;
      ratingNote(S.rating, before);
      if (d.win) { S.wins++; S.streak++; } else { S.losses++; S.streak = 0; }
      S.form = (Array.isArray(S.form) ? S.form : []).concat(d.win ? 1 : 0).slice(-8);
      S.xp += report.xpGain;
      if (S.xp >= S.xpMax) { S.xp -= S.xpMax; S.level++; report.levelUp = true; }
      if (report.loot) {
        S.coins += report.loot.coins;
        if (report.loot.chest) {
          const slot = S.chests.findIndex((c) => !c);
          report.loot.chest = slot >= 0;
          if (slot >= 0) S.chests[slot] = { id: 'c' + Date.now(), kind: 'silver', state: 'locked' };
        }
      }
      save();
      report.rating = S.rating; report.xp = S.xp; report.xpMax = S.xpMax; report.level = S.level;
      if (typeof Progress !== 'undefined' && d.durationMs > 0) {
        const o = PEOPLE[d.opp] || {};
        Progress.match({ me: d.me, op: d.op, durationMs: d.durationMs, mode: d.mode,
          oppRating: o.r, oppName: o.s, bestRally: d.stats?.maxRally });
        if (report.levelUp) Progress.level({ level: S.level, durationMs: d.durationMs, xp: S.xp });
      }
      // The report shows the actual slot assignment and post-rollover XP immediately.
      el.innerHTML = this.render(d);
    }
    BG.mood(typeof d.win === 'boolean' ? d.win ? 'gold' : 'lose' : 'arena');
    const res = el.querySelector('.res'), valid = () => this.alive && !this.navigating && this.token === token && this.d === d && res.isConnected;
    const click = e => {
      const button = e.target.closest('[data-act]'); if (!valid() || !button || !el.contains(button)) return;
      if (button.dataset.act === 'next') this.navigate('hub');
      if (button.dataset.act === 'again') this.navigate('match');
      if (button.dataset.act === 'level-up') this.openLevelUp();
    };
    el.addEventListener('click', click); this.off = () => el.removeEventListener('click', click);
    if (!report.presented) {
      report.presented = true;
      if (!effectiveReducedMotion() && typeof res.animate === 'function') this.animations.push(res.animate(
        [{ opacity: .8, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' }));
      (async () => {
        await sleep(150); if (!valid()) return;
        if (typeof d.win === 'boolean') d.win ? Sfx.win() : Sfx.lose();
        if (d.unlocked?.length) { await achievementPops(d.unlocked, valid); if (!valid()) return; }
        if (report.levelUp && !report.levelUpShown) { await sleep(350); if (valid()) this.openLevelUp(); }
      })();
    }
  },
  openLevelUp() {
    const report = this.report;
    if (!this.alive || this.navigating || !report.levelUp || report.levelUpShown) return;
    report.levelUpShown = true; LevelUp.show(report.level);
    const button = this.el?.querySelector('[data-act=level-up]'); if (button) button.disabled = true;
  },
  navigate(id) {
    this.navigating = true; this.animations?.forEach(a => a.cancel()); this.animations = [];
    clearTimeout(this.routeTimer); const token = this.token;
    const go = () => {
      if (!this.alive || this.token !== token) return;
      if (Router.busy) { this.routeTimer = setTimeout(go, 40); return; }
      this.routeTimer = null; Router.go(id);
    };
    go();
  },
  dispose() {
    this.alive = false; this.token = null; clearTimeout(this.routeTimer);
    this.off?.(); this.off = null; this.animations?.forEach(a => a.cancel()); this.animations = [];
  },
  leave() { this.dispose(); this.el = null; },
  onBack() { this.navigate('hub'); }
});

/* ---------------- ОТКРЫТИЕ СУНДУКА ---------------- */
Router.def('chest', {
  full: true, mood: 'violet',
  render(d) {
    d = d || { kind: 'gold' }; this.d = d; const C = Art.CHEST[d.kind];
    this.loot = [
      { k: 'coins', n: d.kind === 'gold' ? 320 : 180, tk: 'cur.coinsWord', r: 'common', art: Art.coin(110) },
      { k: 'gems', n: d.kind === 'gold' ? 8 : 4, tk: 'cur.gemsWord', r: 'rare', art: Art.gem(104) },
      { k: 'card', n: 1, item: 'r-pan', r: 'leg', art: ItemArt.of(Catalog.byId('r-pan'), 120) }
    ];
    return `<div class="cho">
      <div class="hud mini"><div style="flex:1"></div>
        <div class="cur" data-cur="coins"><span class="ci">${Art.coin(36)}</span><span class="v num">${fmt(S.coins)}</span></div>
        <div class="cur" data-cur="gems"><span class="ci">${Art.gem(34)}</span><span class="v num">${fmt(S.gems)}</span></div></div>
      <div class="cho-title"><span class="cap">${Art.chestName(d.kind)} ${t('chest.word')}</span><b class="h-display" id="choT">${t('chest.tapToOpen')}</b></div>
      <div class="cho-stage">
        <div class="cho-chest" data-press>${Art.chest(d.kind, 220)}</div>
        <div class="cho-taps"><i></i><i></i><i></i></div>
      </div>
      <div class="cho-card"></div>
      <div class="cho-left"></div>
      <div class="cho-sum"></div>
    </div>`;
  },
  mount(el) {
    const ch = el.querySelector('.cho-chest'); const glow = ch.querySelector('.ch-glow'); this.phase = 'taps';
    const root = el.querySelector('.cho');
    ch.addEventListener('click', () => {
      if (this.phase !== 'taps') return;
      this.phase = 'wait';                       // one tap is all it takes
      el.querySelectorAll('.cho-taps i').forEach(d => d.classList.add('on'));
      ch.classList.remove('hit'); void ch.offsetWidth; ch.classList.add('hit');
      glow.style.opacity = 1; Sfx.impact(); haptic('heavy'); FX.shake(6, 240);
      const p = FX.pt(ch); FX.burst(p.x, p.y + 10, { c: ['#D3B5FF', '#FFC93A', '#fff'], count: 20, speed: 8, size: 1 });
      setTimeout(() => this.open(el, root, ch), 420);
    });
    /* during the reveal a tap anywhere fast-forwards to the summary;
       on the summary a tap anywhere closes — never a hunt for a button */
    root.addEventListener('click', (e) => {
      if (e.target.closest('.cho-chest') || e.target.closest('button')) return;
      if (this.phase === 'cards') { clearTimeout(this._t); this.summary(el); }
      else if (this.phase === 'done') this.close();
    });
  },
  async open(el, root, ch) {
    this.phase = 'opening';
    Sfx.rise(.7); ch.classList.add('charge'); await sleep(700);
    root.classList.add('opened'); flash('#fff', .9, 600); Sfx.reveal(2); haptic('heavy'); FX.shake(16, 500);
    const p = FX.pt(ch); FX.burst(p.x, p.y - 30, { c: ['#FFC93A', '#FFF6C8', '#D3B5FF', '#fff'], count: 70, speed: 18, size: 1.8 }); FX.ring(p.x, p.y - 30, '#FFE680', 260, 12); FX.confetti(p.x, p.y - 40, 60, .8);
    $('#choT', el).textContent = t('chest.lookLoot');
    await sleep(650); this.idx = -1; this.phase = 'cards'; this.next(el);
  },
  next(el) {
    if (this.busy) return; this.idx++;
    const card = el.querySelector('.cho-card'); const left = el.querySelector('.cho-left');
    if (this.idx >= this.loot.length) return this.summary(el);
    const it = this.loot[this.idx]; this.busy = true;
    const rn = rarityName(it.r);
    card.innerHTML = `<div class="lcard rar ${it.r === 'common' ? '' : it.r} ${it.r === 'leg' || it.r === 'epic' ? 'beam' : ''}"><div class="lc-in">
      <div class="lc-back">${Art.icon('ball', { c: 'rgba(255,255,255,.5)' })}</div>
      <div class="lc-front"><span class="lc-r">${rn}</span><div class="lc-art">${it.art}</div><b class="lc-n num">${it.k === 'card' ? t('chest.newItem') : '×' + it.n}</b><span class="lc-t">${it.item ? itemName(Catalog.byId(it.item)) : t(it.tk)}</span><i class="lc-foil"></i></div>
    </div></div>`;
    left.textContent = this.loot.length - this.idx - 1 > 0 ? t('chest.more', { n: this.loot.length - this.idx - 1 }) : t('chest.last');
    const lc = card.querySelector('.lcard'); Sfx.swoosh();
    requestAnimationFrame(() => lc.classList.add('in'));
    setTimeout(() => {
      lc.classList.add('flip'); Sfx.reveal(['common', 'rare', 'epic', 'leg'].indexOf(it.r)); haptic(it.r === 'leg' ? 'heavy' : 'medium');
      const p = FX.pt(lc); const col = { common: ['#C9D6F5', '#fff'], rare: ['#33B6FF', '#fff'], epic: ['#B061FF', '#fff', '#FF7AD9'], leg: ['#FFB21E', '#FFF6C8', '#fff'] }[it.r];
      setTimeout(() => { FX.burst(p.x, p.y, { c: col, count: it.r === 'leg' ? 60 : 30, speed: it.r === 'leg' ? 16 : 10, size: it.r === 'leg' ? 1.6 : 1 }); if (it.r === 'leg') { FX.rain(60); flash('#FFE680', .6); FX.shake(10, 400); } FX.twinkles(p.x, p.y, 90, 10); }, 220);
      this.busy = false;
      // the next loot card deals itself — no tapping required
      if (this.phase === 'cards') this._t = setTimeout(() => { this._t = null; if (this.phase === 'cards') this.next(el); }, 1000);
    }, 420);
  },
  async summary(el) {
    if (this.phase === 'sum' || this.phase === 'done') return;
    this.phase = 'sum';
    el.querySelector('.cho-card').innerHTML = ''; el.querySelector('.cho-left').textContent = '';
    $('#choT', el).textContent = t('chest.loot');
    const sum = el.querySelector('.cho-sum');
    sum.innerHTML = `<div class="sum-grid">${this.loot.map((it, i) => `<div class="sg rar ${it.r === 'common' ? '' : it.r}" style="--d:${i}"><div class="sga">${it.art}</div><b class="num">${it.k === 'card' ? 'NEW' : '×' + it.n}</b></div>`).join('')}</div>`;
    sum.classList.add('on');
    // balance fills itself — no «Забрать» step: the loot is already yours
    haptic('success');
    const c = this.loot.find((x) => x.k === 'coins'), g = this.loot.find((x) => x.k === 'gems');
    const cells = $$('.sg', sum);
    await Promise.all([c && Wallet.add('coins', c.n, FX.pt(cells[0])), sleep(220).then(() => g && Wallet.add('gems', g.n, FX.pt(cells[1])))]);
    if (this.d.slot !== undefined) { S.chests[this.d.slot] = null; save(); }
    // Grant only the cards shown, once per owned item.
    for (const it of this.loot) {
      if (it.k === 'card' && it.item && Catalog.byId(it.item) && !S.owned.includes(it.item)) S.owned.push(it.item);
    }
    save();
    if (this.phase === 'sum') {
      this.phase = 'done'; $('#choT', el).textContent = t('chest.inBalance')
      sum.insertAdjacentHTML('beforeend', `<button class="b3 green" data-act="done"><span class="shine"></span>${t('common.done')}</button>`);
      sum.querySelector('[data-act=done]').addEventListener('click', () => this.close());
      if (this.phase === 'done') this._doneT = setTimeout(() => { if (this.phase === 'done') this.close(); }, 2600);
    }
  },
  close() { clearTimeout(this._doneT); this.phase = 'closed'; Router.go('hub'); },
  leave() { clearTimeout(this._t); clearTimeout(this._doneT); },
  onBack() { Router.go('hub'); }
});
