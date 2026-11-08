/* One visible ball: comic sprite at the glass, then the scene's own ball. */
const Preloader = {
  session: null, serial: 0,
  mount() {
    this.cancel();
    const root = $('#preloader'); if (!root) return;
    const s = this.session = { root, id: ++this.serial, alive: true, phase: 'loading',
      loaded: 0, total: 6, sceneReady: false, minElapsed: false, revealed: false,
      timers: new Set(), animations: new Set(), cleanups: [], faceRaf: 0 };
    root.hidden = false; root.className = 'preloader'; root.dataset.phase = 'loading';
    root.removeAttribute('aria-hidden'); root.setAttribute('role', 'status');
    s.ball = $('.pl-ball', root); s.sheet = $('.pl-sheet', root); s.paddle = $('.pl-paddle', root);
    s.burst = $('.pl-burst', root); s.glass = $('.pl-glass', root); s.readout = $('.pl-readout', root);
    s.arc = $('.pl-progress', root); s.pct = $('.pl-percent', root); s.status = $('.pl-status', root);
    const retry = $('.pl-retry', root); retry.hidden = true; retry.textContent = t('loader.retry');
    for (const el of [s.ball, s.paddle, s.burst, s.glass]) { el.style.transform = ''; el.style.opacity = ''; }
    s.ball.style.animation = '';
    s.status.dataset.i18n = 'loader.loading'; s.status.textContent = t('loader.loading'); this.progress(s, 0); this.frame(s, 'intro', 0);
    const measure = () => {
      s.width = root.clientWidth; s.height = root.clientHeight; s.cell = s.ball.clientWidth;
      if (s.impactScale) s.impactDiameter = s.impactScale * s.cell * .625;
    };
    measure(); window.addEventListener('resize', measure); s.cleanups.push(() => window.removeEventListener('resize', measure));
    const visibility = () => {
      s.animations.forEach(a => { if (document.hidden && a.playState === 'running') a.pause(); else if (!document.hidden && a.playState === 'paused') a.play(); });
      if (!document.hidden) {
        if (s.pendingLaunch) { s.pendingLaunch = false; this.launch(s); }
        else this.maybeStart(s);
      }
    };
    document.addEventListener('visibilitychange', visibility);
    s.cleanups.push(() => document.removeEventListener('visibilitychange', visibility));
    if (typeof GameHost.on === 'function') s.cleanups.push(GameHost.on(m => this.message(s, m)));
    const retryLoad = () => { GameHost.reload(); this.mount(); };
    retry.addEventListener('click', retryLoad); s.cleanups.push(() => retry.removeEventListener('click', retryLoad));
    const ready = () => { if (!s.alive) return; s.loaded++; const value = Math.min(99, Math.floor(s.loaded / s.total * 100)); this.later(s, () => { if (s.alive) this.progress(s, value); }, s.loaded * 120); this.later(s, () => { if (s.alive) this.maybeStart(s); }, s.loaded * 120 + 80); };
    const keys = ['preloader-ball-intro', 'preloader-ball-spin', 'preloader-paddle', 'preloader-burst'];
    Promise.all(keys.map(key => {
      const image = new Image(); image.src = ILL[key] || '';
      return image.decode().then(() => { ready(); return image; });
    })).then(() => {
      if (!s.alive) return;
      s.paddle.src = ILL['preloader-paddle']; s.burst.src = ILL['preloader-burst'];
      root.classList.add('has-sprites');
    }).catch(() => this.error(s));
    document.fonts.ready.then(ready, () => this.error(s));
    this.later(s, () => { s.minElapsed = true; this.maybeStart(s); }, 900);
    // Let the CSS arrival paint before parsing/compiling the embedded engine.
    this.later(s, () => {
      s.sceneStarted = true;
      try {
        /* Живой стол всегда настоящий движок: лёгкая 2D-заглушка для
         * «Эконома» удалена вместе с engine2d/. Эконом теперь только
         * режет разрешение внутри WebGL-движка. */
        s.engine = true; GameHost.ensure(); GameHost.send('quiet', { on: true });
        GameHost.send('lobby', { intro: true, requestId: s.id }); GameHost.show(true, 'lobby');
      } catch (e) { this.error(s); }
    }, 240);
    this.later(s, () => { if (!s.sceneReady && !document.hidden) this.error(s); }, 20000);
    return () => { if (this.session && !this.session.revealed) this.cancel(); };
  },
  later(s, fn, ms) {
    const id = setTimeout(() => { s.timers.delete(id); if (s.alive) fn(); }, ms);
    s.timers.add(id); return id;
  },
  animate(s, el, frames, options) {
    const a = el.animate(frames, options); s.animations.add(a);
    a.finished.catch(() => {});
    return a;
  },
  frame(s, sheet, index) {
    const cols = sheet === 'intro' ? 5 : 6;
    if (s.sheet.dataset.sheet !== sheet) {
      s.sheet.dataset.sheet = sheet;
      s.sheet.style.backgroundImage = `url("${ILL[sheet === 'intro' ? 'preloader-ball-intro' : 'preloader-ball-spin'] || ''}")`;
      s.sheet.style.backgroundSize = `${cols * 100}% 400%`;
    }
    if (s.sheet.dataset.frame === `${sheet}:${index}`) return;
    s.sheet.dataset.frame = `${sheet}:${index}`;
    s.sheet.style.backgroundPosition = `${index % cols * 100 / (cols - 1)}% ${Math.floor(index / cols) * 100 / 3}%`;
  },
  progress(s, value) {
    s.arc.style.strokeDashoffset = `${477.522 * (1 - value / 100)}`;
    s.pct.innerHTML = `${value}<span>%</span>`; s.readout.setAttribute('aria-valuenow', String(value));
  },
  error(s) {
    if (!s.alive || s.revealed) return;
    cancelAnimationFrame(s.faceRaf); s.animations.forEach(a => a.cancel());
    s.root.classList.remove('launched');
    s.phase = 'error'; s.root.dataset.phase = 'error'; s.status.dataset.i18n = 'loader.error'; s.status.textContent = t('loader.error');
    $('.pl-retry', s.root).hidden = false;
  },
  maybeStart(s) {
    if (!s.alive || s.phase !== 'loading' || !s.minElapsed || s.loaded < s.total || !s.sceneReady || document.hidden) return;
    if (Router.busy) { this.later(s, () => this.maybeStart(s), 60); return; }
    this.progress(s, 100);
    if (document.body.classList.contains('rm')) this.reveal(s, true);
    else this.strike(s);
  },
  async strike(s) {
    s.phase = 'windup'; s.root.dataset.phase = 'windup'; s.root.classList.add('launched');
    s.ball.style.animation = 'none';
    const k = s.cell / 148;
    const pose = (x, y, angle, scale) => `translate3d(${x * k}px,${y * k}px,0) rotate(${angle}deg) scale(${scale})`;
    try {
      await this.animate(s, s.paddle, [
        { transform: pose(108, -56, -144, .84), opacity: 0 },
        { transform: pose(56, -36, -122, 1.06), opacity: 1 }
      ], { duration: 220, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'forwards' }).finished;
      if (!s.alive) return;
      s.phase = 'strike'; s.root.dataset.phase = 'strike';
      if (navigator.userActivation && navigator.userActivation.hasBeenActive) Sfx.smash();
      haptic('rigid');
      this.animate(s, s.paddle, [
        { transform: pose(56, -36, -122, 1.06), opacity: 1 },
        { transform: pose(34, -24, -108, .88), opacity: 0 }
      ], { duration: 200, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
      this.animate(s, s.burst, [{ opacity: .95, transform: 'scale(.9)' }, { opacity: 0, transform: 'scale(1.65)' }],
        { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'forwards' });
      s.impactDiameter = Math.min(s.width * .9, s.height * .52);
      s.impactScale = s.impactDiameter / (s.cell * .625);
      const frames = Array.from({ length: 49 }, (_, i) => {
        const p = i / 48, approach = Math.max(0, (p - .15) / .85);
        const scale = 1 + (s.impactScale - 1) * Math.pow(approach, 2.2);
        return { transform: `translate3d(${-s.cell * .035 * Math.sin(p * Math.PI)}px,${-s.cell * .08 * Math.sin(p * Math.PI)}px,0) scale(${scale})`, offset: p };
      });
      s.rush = this.animate(s, s.ball, frames, { duration: 720, easing: 'linear', fill: 'forwards' });
      const face = () => {
        if (!s.alive || s.phase !== 'strike') return;
        const elapsed = Number(s.rush.currentTime) || 0;
        const p = elapsed / 720;
        if (p < 0.45) {
          this.frame(s, 'spin', Math.floor(p / 0.45 * 2 * 24) % 24);
        } else if (p < 0.55) {
          this.frame(s, 'spin', 0);
        } else {
          this.frame(s, 'spin', Math.floor((p - 0.55) / 0.45 * 2 * 24) % 24);
        }
        s.faceRaf = requestAnimationFrame(face);
      };
      face(); await s.rush.finished;
      if (!s.alive) return;
      cancelAnimationFrame(s.faceRaf); this.frame(s, 'spin', 0); this.reveal(s, false);
    } catch (e) { if (s.alive) this.error(s); }
  },
  reveal(s, reduced) {
    if (!s.alive || s.revealed) return;
    s.revealed = true; s.phase = reduced ? 'flight' : 'glass'; s.root.dataset.phase = s.phase;
    s.root.classList.add('revealed', 'launched'); s.root.setAttribute('aria-hidden', 'true'); s.root.removeAttribute('role');
    Router.go('hub', { mode: 'instant', replace: true, data: { preloader: true } });
    if (reduced) {
      s.ball.style.opacity = '0'; this.launch(s); return;
    }
    if (navigator.userActivation && navigator.userActivation.hasBeenActive) Sfx.impact();
    haptic('heavy');
    this.animate(s, s.glass, [
      { opacity: 0, transform: 'translate(-50%,-50%) scale(.94)' },
      { opacity: .95, transform: 'translate(-50%,-50%) scale(1)', offset: .08 },
      { opacity: .6, transform: 'translate(-50%,-50%) scale(1.02)', offset: .5 },
      { opacity: 0, transform: 'translate(-50%,-50%) scale(1.06)' }
    ], { duration: 600, easing: 'linear', fill: 'forwards' });
    s.rush.cancel();
    s.ball.style.transform = `scale(${s.impactScale})`;
    const k = s.cell / 148;
    const pose = (x, y, angle, scale) => `translate3d(${x * k}px,${y * k}px,0) rotate(${angle}deg) scale(${scale})`;
    this.animate(s, s.paddle, [
      { transform: pose(34, -24, -108, .88), opacity: 0 },
      { transform: pose(56, -36, -122, 1.06), opacity: 1 }
    ], { duration: 180, easing: 'cubic-bezier(.55,0,1,.45)', fill: 'forwards' });
    s.squash = this.animate(s, s.ball, [
      { transform: `scale(${s.impactScale})` },
      { transform: `scale(${s.impactScale * 1.12},${s.impactScale * .86})`, offset: .3 },
      { transform: `scale(${s.impactScale * .9})` }
    ], { duration: 200, easing: 'cubic-bezier(.23,1,.32,1)', fill: 'forwards' });
    this.later(s, () => this.launch(s), 400);
  },
  launch(s) {
    if (!s.alive) return;
    if (document.hidden) { s.pendingLaunch = true; return; }
    s.phase = 'flight'; s.root.dataset.phase = 'flight';
    const data = { requestId: s.id, x: .5, y: .48, diameter: (s.impactDiameter || s.width * .9) / s.width };
    GameHost.send('lobbyLaunch', data);
    this.later(s, () => { if (!document.hidden) this.finish(s); }, 2600);
  },
  message(s, m) {
    if (!s.alive) return;
    if (m.type === 'glLost') {
      if (s.revealed) this.finish(s);
      else if (s.sceneReady) { s.sceneReady = false; s.loaded--; this.progress(s, Math.floor(s.loaded / s.total * 100)); }
      return;
    }
    if (m.type === 'motionPreference' && m.effective) {
      if (s.revealed) { if (s.phase === 'glass') this.launch(s); this.finish(s); }
      else if (s.phase !== 'loading') { cancelAnimationFrame(s.faceRaf); s.animations.forEach(a => a.cancel()); this.reveal(s, true); }
      return;
    }
    if (m.requestId !== s.id) return;
    if (m.type === 'lobbyReady' && !s.sceneReady) {
      s.sceneReady = true; s.loaded++; this.progress(s, Math.min(99, Math.floor(s.loaded / s.total * 100))); this.maybeStart(s);
    }
    if (m.type !== 'lobbyFrame' || !s.revealed) return;
    if (m.handoff) { this.finish(s); return; }
    if (![m.x, m.y, m.diameter].every(Number.isFinite)) return;
    if (s.squash) { s.squash.cancel(); s.squash = null; }
    s.ball.style.transform = `translate3d(${(m.x - .5) * s.width}px,${(m.y - .48) * s.height}px,0) scale(${m.diameter * s.width / (s.cell * .625)})`;
  },
  finish(s) {
    if (this.session !== s) return;
    this.cancel(true);
  },
  cancel(keepScene = false) {
    const s = this.session; this.session = null;
    const root = s ? s.root : $('#preloader'); if (root) { root.hidden = true; root.setAttribute('aria-hidden', 'true'); }
    if (!s) return;
    s.alive = false; s.timers.forEach(clearTimeout); cancelAnimationFrame(s.faceRaf);
    s.animations.forEach(a => a.cancel()); s.animations.clear(); s.timers.clear(); s.cleanups.splice(0).forEach(fn => fn());
    if (!keepScene && s.sceneStarted && s.engine) {
      GameHost.send('attract'); if (!s.revealed) GameHost.show(false);
    }
  }
};
