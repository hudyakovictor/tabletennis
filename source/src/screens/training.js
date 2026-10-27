Router.def('train', {
  full: true, mood: 'battle', game: true,
  render(d) {
    return `<div class="mx tx cine">
      <div class="mx-bars"><i></i><i></i></div>
      <div class="tc safe-top">
        <div class="tc-in">
          <div class="tc-h"><span class="tc-step num">1/6</span><b class="tc-title">${t('train.title')}</b><span class="tc-dots"></span></div>
          <p class="tc-text">${t('train.ballComing')}</p>
          <div class="tc-hold"><i></i>${t('train.ballWaits')}</div>
        </div>
        <div class="tc-msg"></div>
      </div>
      <button class="ib m-pause pe" data-act="exit" aria-label="${t('common.exit')}">${Art.icon('x', { c: '#fff', sw: 2.6 })}</button>
      <button class="ib m-diag-open pe" data-act="diagnostics">${t('debug.title')}</button>
      <button class="ib m-diag-shot pe" data-act="diag-mark" ${GameHost.debug ? '' : 'hidden'} aria-label="${t('debug.mark')}"><span aria-hidden="true">●</span> ${t('debug.mark')}</button>
      <button class="b3 dark sm tx-skip pe" data-act="skip">${t('train.skipStep')} ›</button>
      ${devBtn()}
      <div class="tx-done"><div class="pnl tx-card">
        <span class="tx-cup">${Art.icon('crown', { c: '#FFE28A', sw: 2.2 })}</span>
        <b class="h-display">${t('train.readyTitle')}</b>
        <p>${t('train.readyText')}</p>
        <div class="tx-reward"><span class="cap">${t('train.reward')}</span>
          <div class="tx-rw"><div class="cur" data-cur="coins"><span class="ci">${Art.coin(30)}</span><span class="v num">${fmt(S.coins)}</span></div>
          <div class="cur" data-cur="gems"><span class="ci">${Art.gem(28)}</span><span class="v num">${fmt(S.gems)}</span></div></div>
          <div class="tx-rw-plus"><b class="num">+200</b><b class="num g">+5</b></div></div>
        <div style="display:grid;gap:10px;margin-top:16px"><button class="b3 xl play pe" data-a="go"><span class="shine"></span>${Art.icon('swords', { c: '#3A1A00', sw: 2.6 })}${t('train.toBattle')}</button>
        <button class="b3 dark sm pe" data-a="again">${t('train.again')}</button></div>
      </div></div>
    </div>`;
  },
  mount(el, d) {
    TGX.fullscreen(true);
    TGX.guard(true);
    this.el = el; this.data = d || {}; this.alive = true; this.last = {};
    GameHost.ensure(); GameHost.show(true); GameHost.send('quiet', { on: true }); GameHost.send('mute', { on: !S.sfx });
    this.off = GameHost.on((m) => this.onMsg(m));
    el.querySelector('[data-act=exit]').addEventListener('click', () => this.exit());
    el.querySelector('[data-act=diagnostics]').addEventListener('click', () => { GameHost.send('pause'); diagnosticsSheet(); this.watchSheets(); });
    el.querySelector('[data-act=diag-mark]').addEventListener('click', diagnosticMarkFrame);
    el.querySelector('[data-act=skip]').addEventListener('click', () => { GameHost.send('skipStep'); haptic('select'); });
    const dv = el.querySelector('[data-act=dev]'); if (dv) dv.addEventListener('click', () => devZoneSheet());
    el.querySelector('.tx-done').addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'go') { const p = FX.pt(a); FX.burst(p.x, p.y, { count: 30, speed: 11 }); haptic('heavy'); Router.go('mm'); }
      if (a.dataset.a === 'again') { el.querySelector('.tx-done').classList.remove('on'); GameHost.send('train', { step: 0 }); }
    });
    (async () => {
      const mx = el.querySelector('.mx');
      GameHost.send('prematch', { dur: 1.0 });
      await sleep(140); mx.classList.add('bars'); Sfx.whoosh();
      /* титульная карточка «КАК БИТЬ» со стеной текста УДАЛЕНА: обучение
         стартует сразу после короткой стартовой анимации */
      await sleep(760); if (!this.alive) return;
      mx.classList.remove('bars', 'cine'); mx.classList.add('live');
      GameHost.send('train', { step: this.data.step || 0 }); GameHost.send('quiet', { on: false });
    })();
  },
  onMsg(m) {
    if (!this.alive) return;
    const el = this.el;
    if (m.type === 'train') {
      const L = this.last;
      el.querySelector('.tc-step').textContent = `${m.step + 1}/${m.total}`;
      el.querySelector('.tc-title').textContent = m.title;
      /* в интро большая карточка урока несёт весь текст — шапка молчит.
       * (пустая строка через `||` падала в goal — отсюда был дубль) */
      el.querySelector('.tc-text').textContent = m.phase === 'intro' ? '' : (m.text || m.goal);
      el.querySelector('.tc-dots').innerHTML = [...Array(m.need)].map((_, i) => `<i class="${i < m.done ? 'on' : ''}"></i>`).join('');
      const card = el.querySelector('.tc'); card.classList.toggle('hold', !!m.frozen);
      /* на время объявления урока шапка прячется целиком — карточка урока
         единственный текст на экране */
      card.style.opacity = m.phase === 'intro' ? '0' : '';
      if (m.step !== L.step) { card.animate([{ transform: 'translateY(-12px) scale(.96)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.18,1.25,.4,1)' }); if (L.step !== undefined) { Sfx.rise(.4); haptic('success'); } }
      if (m.frozen && !L.frozen) { Sfx.soft(); haptic('rigid'); }
      if (m.nudge && !L.nudge) haptic('warning');
      if (m.phase !== L.phase && (m.phase === 'ok' || m.phase === 'fail')) {
        const msg = el.querySelector('.tc-msg'); msg.className = 'tc-msg ' + m.phase; msg.textContent = m.msg || (m.phase === 'ok' ? t('train.ok') : t('train.tryAgain'));
        void msg.offsetWidth; msg.classList.add('on');
        if (m.phase === 'ok') { Sfx.point(); haptic('success'); const dt = el.querySelectorAll('.tc-dots i')[m.done - 1]; if (dt) { const p = FX.pt(dt); FX.burst(p.x, p.y, { c: ['#9CFFD0', '#fff', '#FFC93A'], count: 18, speed: 7 }); } }
        else { haptic('error'); card.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(7px)' }, { transform: 'translateX(-4px)' }, { transform: 'none' }], { duration: 360 }); }
      }
      this.last = { step: m.step, frozen: m.frozen, nudge: m.nudge, phase: m.phase };
    }
    if (m.type === 'paused' && m.v && !m.host && !Sheet.cur) {
      GameHost.send('pause');
      Sheet.open(`<div class="h1" style="margin:4px 4px 14px">${t('match.pause')}</div><div style="display:grid;gap:12px"><button class="b3 green block" data-a="go"><span class="shine"></span>${Art.icon('play', { c: '#fff' })}${t('common.resume')}</button><button class="b3 dark block" data-a="screenshot">${t('debug.screenshot')}</button><button class="b3 dark block" data-a="diagnostics">${t('debug.title')}</button><button class="b3 dark block sm" data-a="exit">${t('train.exit')}</button></div>`, {
        onOpen: (w) => w.addEventListener('click', (e) => {
          const a = e.target.closest('[data-a]'); if (!a) return;
          if (a.dataset.a === 'screenshot') { diagnosticsSheet({ focusScreenshot: true }); return; }
          if (a.dataset.a === 'diagnostics') { diagnosticsSheet(); return; }
          Sheet.close(true); if (a.dataset.a === 'exit') this.exit();
        })
      });
      this.watchSheets();
    }
    if (m.type === 'trainDone') {
      S.tutorialDone = true; save();
      const done = el.querySelector('.tx-done'); done.classList.add('on'); Sfx.win(); haptic('success'); flash('#FFE680', .35); FX.confetti(FX.W / 2, FX.H * .3, 110, 1.1);
      const rw = done.querySelector('.tx-reward');
      if (S.tutorialRewarded) rw.classList.add('got');
      else {
        S.tutorialRewarded = true; save();
        rw.classList.add('pay');
        setTimeout(() => { if (!this.alive) return; const from = FX.pt(done.querySelector('.tx-cup'));
          Wallet.add('coins', 200, from).then(() => this.alive && Wallet.add('gems', 5, from)); }, 900);
      }
    }
  },
  watchSheets() {
    const host = $('#sheets'); if (this._mo) this._mo.disconnect();
    this._mo = new MutationObserver(() => { if (!Sheet.cur && this.alive) { this._mo.disconnect(); this._mo = null; GameHost.send('resume'); } });
    this._mo.observe(host, { childList: true });
  },
  exit() {
    if (!S.tutorialDone && this.data.then === 'mm') {
      return confirmSheet(t('train.skipTitle'), t('train.skipText'), t('train.skip'), () => { S.tutorialDone = true; save(); Router.go('mm'); });
    }
    Router.go('hub');
  },
  leave() { this.alive = false; this.off && this.off(); TGX.guard(false); if (this._mo) { this._mo.disconnect(); this._mo = null; } GameHost.send('quit'); GameHost.show(false); },
  onBack() { this.exit(); }
});
