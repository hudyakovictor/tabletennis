/* One frame clock owns progress, the completed frame and the final fade. */
const Preloader = {
  session: null, serial: 0,
  mount() {
    this.cancel();
    const root = $('#preloader'); if (!root) return;
    const s = this.session = { root, id: ++this.serial, alive: true, phase: 'loading',
      sceneReady: false, fontsReady: false, revealed: false, displayedProgress: 0,
      elapsed: 0, frameTime: null, raf: 0, timers: new Set(), cleanups: [] };
    // The transformed desktop device must not become our fixed containing block.
    document.body.appendChild(root);
    root.hidden = false; root.className = 'preloader'; root.dataset.phase = 'loading'; root.style.opacity = '1';
    root.removeAttribute('aria-hidden'); root.setAttribute('role', 'status');
    s.readout = $('.pl-readout', root); s.arc = $('.pl-progress', root);
    s.pct = $('.pl-percent', root); s.status = $('.pl-status', root);
    const retry = $('.pl-retry', root); retry.hidden = true; retry.textContent = t('loader.retry');
    s.status.dataset.i18n = 'loader.loading'; s.status.textContent = t('loader.loading');
    this.progress(s, 0);
    const visibility = () => {
      cancelAnimationFrame(s.raf); s.raf = 0; s.frameTime = null;
      if (s.phase === 'complete') s.elapsed = 0;
      if (!document.hidden) this.schedule(s);
    };
    document.addEventListener('visibilitychange', visibility);
    s.cleanups.push(() => document.removeEventListener('visibilitychange', visibility));
    s.cleanups.push(GameHost.on(m => this.message(s, m)));
    const retryLoad = () => {
      if (Router.busy) return;
      this.cancel(); GameHost.reload(); Router.go('splash', { mode: 'instant', replace: true });
    };
    retry.addEventListener('click', retryLoad); s.cleanups.push(() => retry.removeEventListener('click', retryLoad));
    document.fonts.ready.then(() => { if (s.alive) s.fontsReady = true; }, () => this.error(s));
    this.schedule(s);
    // Paint the shell before parsing/compiling the embedded engine.
    const timer = setTimeout(() => {
      s.timers.delete(timer); if (!s.alive || s.phase !== 'loading') return;
      s.sceneStarted = true;
      try {
        GameHost.ensure(); GameHost.send('quiet', { on: true });
        GameHost.send('lobby', { intro: true, requestId: s.id }); GameHost.show(true, 'lobby');
      } catch (e) { this.error(s); }
    }, 240);
    s.timers.add(timer);
    return () => { if (this.session === s && !s.revealed) this.cancel(); };
  },
  schedule(s) {
    if (s.alive && s.phase !== 'error' && !document.hidden && !s.raf)
      s.raf = requestAnimationFrame(now => this.tick(s, now));
  },
  tick(s, now) {
    s.raf = 0;
    if (!s.alive || s.phase === 'error' || document.hidden) return;
    // Cap stalls, so a background tab or a long compile cannot skip the ramp.
    const dt = s.frameTime === null ? 0 : Math.max(0, Math.min(50, now - s.frameTime));
    s.frameTime = now; s.elapsed += dt;
    if (s.phase === 'loading') {
      const ready = s.sceneReady && s.fontsReady;
      this.progress(s, Math.min(ready ? 100 : 99, s.displayedProgress + dt / 12));
      if (s.displayedProgress === 100) {
        s.phase = 'complete'; s.root.dataset.phase = 'complete'; s.elapsed = 0;
      } else if (!ready && s.elapsed >= 20000) { this.error(s); return; }
    } else if (s.phase === 'complete' && s.elapsed >= 100 && !Router.busy) {
      s.revealed = true; s.phase = 'fade'; s.root.dataset.phase = 'fade'; s.elapsed = 0;
      s.root.setAttribute('aria-hidden', 'true'); s.root.removeAttribute('role');
      // Readiness uses the bridge's waiting lobby; exit it without lobbyLaunch.
      // Hub.mount starts the normal exhibition instead of a splash-ball flight.
      GameHost.send('attract');
      Router.go('hub', { mode: 'instant', replace: true, data: { preloader: true } });
    } else if (s.phase === 'fade') {
      s.root.style.opacity = String(Math.max(0, 1 - s.elapsed / 180));
      if (s.elapsed >= 180) { this.cancel(true); return; }
    }
    this.schedule(s);
  },
  progress(s, value) {
    s.displayedProgress = Math.max(s.displayedProgress, value);
    s.arc.style.strokeDashoffset = `${477.522 * (1 - s.displayedProgress / 100)}`;
    const percent = Math.floor(s.displayedProgress);
    s.pct.innerHTML = `${percent}<span>%</span>`;
    s.readout.setAttribute('aria-valuenow', String(percent));
  },
  message(s, m) {
    if (!s.alive || s.phase === 'error') return;
    if (m.type === 'glLost') { s.sceneReady = false; this.error(s); return; }
    if (m.type === 'lobbyReady' && m.requestId === s.id && s.sceneStarted && s.phase === 'loading') s.sceneReady = true;
  },
  stop(s) {
    cancelAnimationFrame(s.raf); s.raf = 0;
    s.timers.forEach(clearTimeout); s.timers.clear();
  },
  error(s) {
    if (!s.alive || s.revealed || s.phase === 'error') return;
    this.stop(s); s.phase = 'error'; s.root.dataset.phase = 'error';
    s.status.dataset.i18n = 'loader.error'; s.status.textContent = t('loader.error');
    $('.pl-retry', s.root).hidden = false;
  },
  cancel(keepScene = false) {
    const s = this.session; this.session = null;
    const root = s ? s.root : $('#preloader'); if (root) { root.hidden = true; root.setAttribute('aria-hidden', 'true'); }
    if (!s) return;
    s.alive = false; this.stop(s); s.cleanups.splice(0).forEach(fn => fn());
    if (!keepScene && s.sceneStarted) {
      GameHost.send('attract'); if (!s.revealed) GameHost.show(false);
    }
  }
};
