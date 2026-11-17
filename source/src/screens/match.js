/* =====================================================================
   MATCH — Игровая сцена. Глобальная переработка.
   Только необходимое для игры. Без отладочного мусора.
   ===================================================================== */

Router.def('match', {
  full: true, mood: 'battle', game: true,
  render() {
    const o = PEOPLE[BATTLE.opp]; const T = TARGET[MODE.id] || 11;
    const free = MODE.id === 'free';
    return `<div class="mx cine">
      <div class="mx-bars"><i></i><i></i></div>
      <div class="m-vig"></div>
      <div class="match-hud-slot"></div>
      <div class="match-actions pe">
        ${UI.notificationButton('m-notifications')}
        <button class="ib m-pause" data-act="pause" aria-label="${t('match.pause')}" title="${t('match.pause')}">${Art.icon('pause', { c: 'currentColor', fill: 'none', sw: 2.6 })}</button>
      </div>
    </div>`;
  },
  mount(el) {
    BATTLE.t0 = Date.now();
    TGX.fullscreen(true);
    TGX.guard(true);
    this.el = el; this.alive = true; this.timers = [];
    this.hudSnapshot = null; this.result = null;
    this.identities = [String(S.name ?? t('hud.near')), String(PEOPLE[BATTLE.opp]?.s ?? t('hud.far'))];
    this.presentation = MatchHUD.createSummary();
    this.hud = MatchHUD.mount(el.querySelector('.match-hud-slot'), this.hudOptions());
    const st = this.st = { p: 0, o: 0, server: 0, over: false, hits: 0, perfect: 0, smash: 0, maxRally: 0, myServes: 0, live: false, spin: 0, oppHits: 0, rallyHits: 0, servePts: 0, serveWon: 0, seq: [] };
    GameHost.ensure(); GameHost.show(true); GameHost.send('quiet', { on: true }); GameHost.send('mute', { on: !S.sfx });
    this.off = GameHost.on((m) => this.onMsg(m));
    el.querySelector('[data-act=pause]').addEventListener('click', () => this.pause());
    el.querySelector('[data-act=notifications]').addEventListener('click', () => {
      if (!this.st.live || this.st.over || Sheet.cur) return;
      GameHost.send('pause'); UI.openNotifications({ readOnly: true }); this.watchSheets();
    });
    this.intro().catch(() => {});
  },
  async intro() {
    const el = this.el, st = this.st, mx = el.querySelector('.mx');
    const valid = () => this.alive && this.st === st && !st.over;
    GameHost.send('prematch', { dur: 0.3 });
    for (let i = 0; i < 8; i++) { await sleep(40); if (!valid()) return; }
    const free = MODE.id === 'free';
    GameHost.send('match', { diff: clamp(Math.round(S.diff ?? 1), 0, 3), trend: aiTrend(), target: TARGET[MODE.id] || 11, hint: !!S.hint, free: MODE.id === 'free' });
    if (st.paused) GameHost.send('pause');
    GameHost.send('quiet', { on: false });
    mx.classList.remove('bars', 'cine'); mx.classList.add('live'); st.live = true;
    sleep(40);
  },
  onMsg(m) {
    if (!this.alive || this.st.over && m.type !== 'replayEnd' && m.type !== 'matchEnd') return;
    if (m.type === 'serve') {
      this.st.server = m.server;
      if (m.server > 0) this.st.myServes++;
    }
    if (m.type === 'hit') {
      if (m.by > 0) {
        this.st.hits++;
        if (SPIN_STROKES.has(m.stroke)) this.st.spin++; if (m.rally > 1) this.st.rallyHits++;
        if (m.sweet >= .8) { this.st.perfect++; haptic('heavy'); }
        if (m.stroke === 'SMASH' || m.kmh >= 70) this.st.smash++;
      }
      else this.st.oppHits++;
    }
    if (m.type === 'point') {
      this.st.maxRally = Math.max(this.st.maxRally, m.rally || 0);
      const win = m.who > 0; this.st.p = m.score[0]; this.st.o = m.score[1]; this.st.seq.push(win ? 1 : -1);
      if (this.st.server > 0) { this.st.servePts++; if (win) this.st.serveWon++; }
      if (win) { Sfx.point(); haptic('success'); } else { Sfx.lose(); haptic('error'); }
    }
    if (m.type === 'paused' && m.v && !m.host && !Sheet.cur && !this.st.over) this.pause(true);
    if (m.type === 'matchEnd' && MODE.id !== 'free') this.finish(m);
  },
  pause(fromGame) {
    if (this.st.over) return;
    this.st.paused = true;
    GameHost.send('pause');
    const free = MODE.id === 'free';
    Sheet.open(`<div class="sheet-title">${t('match.pause')}</div><p class="caption mt-2 mb-4">${free ? t('match.freePause') : t('match.pauseScore', { p: this.st.p, o: this.st.o })}</p>
      <div style="display:grid;gap:12px">
        <button class="btn btn-success btn-block" data-a="resume">${Art.icon('play', { c: '#fff', sw: 2.5 })}<span>${t('common.resume')}</span></button>
        <button class="btn btn-ghost btn-block" data-a="settings">${Art.icon('gear', { c: '#fff', sw: 2.5 })}<span>${t('nav.settings')}</span></button>
        <button class="btn btn-danger btn-block sm" data-a="quit">${free ? t('match.exitFree') : t('match.surrender')}</button>
      </div>`, {
      onOpen: (w) => w.addEventListener('click', (e) => {
        const a = e.target.closest('[data-a]'); if (!a) return;
        if (a.dataset.a === 'resume') Sheet.close();
        if (a.dataset.a === 'settings') openSettings();
        if (a.dataset.a === 'quit') {
          Sheet.close(true);
          if (free) this.exitFree();
          else this.finish({ won: false, quit: true, score: [this.st.p, this.st.o] });
        }
      })
    });
    this.watchSheets();
  },
  watchSheets() {
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    const host = $('#sheets'); if (!host) return;
    this._mo = new MutationObserver(() => {
      if (!Sheet.cur && !this.st.over && this.alive) {
        this._mo.disconnect(); this._mo = null;
        this.st.paused = false;
        GameHost.send('mute', { on: !S.sfx }); GameHost.send('hint', { on: !!S.hint }); GameHost.send('resume');
      }
    });
    this._mo.observe(host, { childList: true });
  },
  async finish(m) {
    const st = this.st; if (st.done) return; st.over = true; st.done = true;
    TGX.guard(false);
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    const el = this.el, mx = el.querySelector('.mx'), valid = () => this.alive && this.st === st; const win = !!m.won;
    const res = { win, me: m.score ? m.score[0] : st.p, op: m.score ? m.score[1] : st.o, opp: BATTLE.opp,
      quit: !!m.quit, names: this.identities.slice(), presentation: this.presentation.freeze(m),
      durationMs: Math.max(0, Date.now() - (BATTLE.t0 || Date.now())),
      mode: (MODE && MODE.id) || 'career',
      stats: { hits: st.hits, perfect: st.perfect, smash: st.smash, maxRally: Math.max(st.maxRally, m.bestRally || 0),
        acc: m.stats && m.stats.shots ? clamp(Math.round(100 - (m.stats.errors || 0) / Math.max(1, m.stats.shots) * 100), 0, 100) : 0 },
      coach: ZoneStats.matchSummary(BATTLE.t0 || 0, win) };
    res.seq = st.seq.slice();
    res.stats.maxSpeed = (m.stats && m.stats.maxSpeed) || 0;
    res.stats.winners = (m.stats && m.stats.winners) || 0;
    this.result = res;
    if (!m.quit) { ZoneStats.logMatch(res.coach, win); res.unlocked = Career.record(st, win, res.coach);
      res.quests = Daily.tick(res, win); }
    if (m.quit) { Router.go('result', { data: res }); return; }
    GameHost.send('outro');
    mx.classList.add('cine', 'bars'); mx.classList.remove('live');
    await sleep(700); if (!valid()) return;
    const b = document.createElement('div'); b.className = 'm-final ' + (win ? 'win' : 'lose');
    b.innerHTML = `<div><b class="h-display">${win ? t('result.win') : t('result.lose')}</b><small class="num">${res.me} : ${res.op}</small></div>`; mx.appendChild(b);
    win ? (Sfx.win(), haptic('success'), flash('#FFE680', .45), FX.confetti(FX.W / 2, FX.H * .42, 120, 1.2)) : (Sfx.lose(), haptic('error'));
    await sleep(2300); if (!valid()) return;
    if (m.hasReplay) {
      b.classList.add('out');
      const r = document.createElement('div'); r.className = 'mx-replay';
      r.innerHTML = `<span class="rec"><i></i>${t('match.replay', { n: res.stats.maxRally })}</span><button class="btn btn-ghost sm" data-a="skip">${t('common.next')} ›</button>`; mx.appendChild(r);
      const done = new Promise((ok) => {
        const finish = this.replayResolve = () => { this.replayOff?.(); this.replayOff = null; this.replayResolve = null; ok(); };
        this.replayOff = GameHost.on((x) => { if (x.type === 'replayEnd') finish(); });
        r.querySelector('[data-a=skip]').addEventListener('click', () => { GameHost.send('skipReplay'); finish(); });
        this.later(finish, 16000);
      });
      GameHost.send('replay');
      await done; if (!valid()) return;
    }
    Router.go('result', { data: res });
  },
  exitFree() {
    const st = this.st; if (st.done) return; st.over = true; st.done = true;
    TGX.guard(false);
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    toast(t('match.freeExitToast'), 'target');
    Router.go('hub');
  },
  leave() {
    this.alive = false; this.off && this.off(); this.timers.forEach(clearTimeout);
    this.hud?.dispose(); this.hud = null; this.hudSnapshot = null;
    this.presentation = null; this.result = null; this.identities = null;
    this.replayResolve?.(); this.replayOff?.(); this.replayOff = null; this.replayResolve = null;
    TGX.guard(false);
    if (this._mo) { this._mo.disconnect(); this._mo = null; }
    GameHost.send('slowmo', { on: false });
    GameHost.send('quit'); GameHost.show(false);
  },
  onBack() { if (!this.st.over) this.pause(); },
  hudOptions() {
    return { t, strokeCatalog: GameHost.strokeCatalog || [], names: this.identities,
      reducedMotion: effectiveReducedMotion(), reason: REASON };
  },
  later(fn, ms) { const t = setTimeout(() => this.alive && fn(), ms); this.timers.push(t); return t; }
});

/* Вспомогательные стили match — только то, что не в base.css / match_hud.css */
const _matchStyle = document.createElement('style');
_matchStyle.textContent = `
  .mx{position:absolute;inset:0;pointer-events:none}
  .mx .pe,.mx .pe *{pointer-events:auto}
  .mx:not(.live) .match-hud-slot{visibility:hidden}
  .mx .match-actions{opacity:0;pointer-events:none;transform:translateY(-14px);transition:opacity .4s,transform .5s var(--ease-out)}
  .mx.live .match-actions{opacity:1;pointer-events:auto;transform:none}
  .mx-bars i{position:absolute;left:0;right:0;height:13%;background:#000;z-index:6;transition:transform .7s var(--ease-out)}
  .mx-bars i:first-child{top:0;transform:translateY(-101%)}.mx-bars i:last-child{bottom:0;transform:translateY(101%)}
  .mx.bars .mx-bars i{transform:none}
  .m-pause{width:48px;height:48px;border-radius:14px;color:#e1f1fa;background:rgba(7,14,25,.78);
    box-shadow:inset 0 0 0 1px rgba(207,231,245,.16),0 6px 20px rgba(0,0,0,.25)}
  .m-pause svg{width:24px;height:24px}
  .mx .m-final{background:radial-gradient(ellipse at center,rgba(2,3,10,.25),rgba(2,3,10,.55));z-index:7}
  .mx .m-final>div{text-align:center}
  .mx .m-final b{font-size:64px}
  .mx .m-final small{display:block;margin-top:10px;font:900 30px/1 var(--Unb);color:#fff;opacity:0;animation:fadeIn .4s .5s forwards;text-shadow:0 3px 0 rgba(0,0,0,.4)}
  .mx-replay{position:absolute;left:0;right:0;bottom:calc(13% + 14px);z-index:8;display:flex;align-items:center;justify-content:space-between;padding:0 16px;animation:fadeIn .4s}
  .mx-replay .rec{white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis;display:inline-flex;align-items:center;gap:8px;font:900 12px/1 var(--Unb);letter-spacing:.08em;text-transform:uppercase;color:#fff}
  .mx-replay .rec i{width:10px;height:10px;border-radius:50%;background:#FF3B30;box-shadow:0 0 10px #FF3B30;animation:mpv .9s infinite}
  @keyframes mpv{50%{opacity:.4}}
`;
document.head.appendChild(_matchStyle);
