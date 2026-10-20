/* =====================================================================
 *  BOOT
 * ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
 *  TELEGRAM HOST. Inside a mini app a downward drag is not a stroke — it
 *  is the host's "close the app" gesture, and it fires in the middle of a
 *  rally. The official bridge can turn that off (disableVerticalSwipes);
 *  this is the ONLY external script the game ever loads, and only when it
 *  is actually running inside Telegram. Standalone builds stay offline.
 *  If the bridge is unavailable, the 'safe' gesture profile still plays
 *  (no stroke needs a downward drag).
 * ------------------------------------------------------------------- */
function initTelegramHost() {
  const win = typeof window !== 'undefined' ? window : null;
  if (!win || !document) return;
  let tg = win.Telegram && win.Telegram.WebApp;
  const params = String(win.location ? (win.location.search + win.location.hash) : '');
  const inTg = !!tg || /[?&#]tgWebApp/.test(params) ||
    /Telegram/i.test((win.navigator && win.navigator.userAgent) || '');
  if (!inTg) return;
  win.__tgWebApp = true;                 // read by defaultGestureProfile()
  const configure = () => {
    const api = win.Telegram && win.Telegram.WebApp;
    if (!api) return;
    try {
      api.ready();
      api.expand();
      if (typeof api.disableVerticalSwipes === 'function') api.disableVerticalSwipes();
      if (api.setHeaderColor) api.setHeaderColor('#05070c');
      if (api.setBackgroundColor) api.setBackgroundColor('#05070c');
    } catch (e) { /* an old client without the API — the gesture profile covers it */ }
    try {
      const sa = api.safeAreaInset || {}, csa = api.contentSafeAreaInset || {};
      const top = Math.max(sa.top || 0, csa.top || 0);
      const bottom = Math.max(sa.bottom || 0, csa.bottom || 0);
      const root = document.documentElement.style;
      if (top > 0) root.setProperty('--sa-top', top + 'px');
      if (bottom > 0) root.setProperty('--sa-bottom', bottom + 'px');
    } catch (e) { /* no safe-area info: env() insets still apply */ }
  };
  if (tg) { configure(); return; }
  const s = document.createElement('script');
  s.src = 'https://telegram.org/js/telegram-web-app.js';
  s.onload = configure;
  s.onerror = () => { /* no bridge: the safe profile plays without it */ };
  document.head.appendChild(s);
}

(function boot() {
  const start = () => {
    initTelegramHost();
    const canvas = document.getElementById('gl');
    let ui, game;
    try {
      ui = new UI();
      game = new Game(canvas, ui);
      ui.attach(game);
      ui.bindCareer();
      ui.bindOnline();
    } catch (err) {
      console.error(err);
      const loading = document.getElementById('loading');
      if (loading) loading.innerHTML =
        `<div style="max-width:420px;text-align:center;padding:24px">
           <div style="font-size:19px;font-weight:800;margin-bottom:10px">WebGL недоступен</div>
           <div style="font-size:12px;color:#8da3bd;line-height:1.6">
             Этой демке нужен WebGL. Включите аппаратное ускорение в браузере и перезагрузите страницу.<br><br>
             <code style="font-size:10px;color:#ff8a8a">${(err && err.message) || err}</code>
           </div></div>`;
      return;
    }
    window.__game = game;

    /* ?cut=… debug switches (see Game.cut): show which group is disabled and,
     * for `hud`, take the whole overlay off the screen so a match can be played
     * with nothing redrawing above the canvas. */
    const cuts = Object.keys(game.cut || {}).filter(k => game.cut[k]);
    if (game.cut && game.cut.hud) {
      const hud = document.getElementById('hud');
      if (hud) hud.style.display = 'none';
    }
    if (cuts.length) {
      const tag = document.createElement('div');
      tag.textContent = 'CUT ' + cuts.join('+');
      tag.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;pointer-events:none;' +
        'font:700 11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;' +
        'color:#ffd34d;background:rgba(0,0,0,.62);border:1px solid rgba(255,211,77,.35);' +
        'padding:3px 8px;border-radius:6px';
      document.body.appendChild(tag);
    }

    /* The menu is the landing screen, so ask for its soundtrack now. The
     * request is remembered by the engine and only actually starts once a
     * gesture has unlocked WebAudio (see dismissSplash) and the sample has
     * decoded — autoplay before a user gesture is blocked by every browser. */
    if (document.querySelector('#menu.on')) game.audio.menuMusic(true);

    // tap/click the pause overlay to resume
    const pauseInd = document.getElementById('pauseInd');
    if (pauseInd) pauseInd.addEventListener('click', () => game.setPaused(false));

    // The utility controls are stateful; UI.attach() supplies their icons and accessible labels.
    document.getElementById('btnSettings').innerHTML = ICON.gear;

    document.getElementById('toWin').textContent = game.settings.targetScore;
    document.querySelectorAll('.opt[data-set="target"]').forEach((b) =>
      b.addEventListener('click', () => { document.getElementById('toWin').textContent = b.dataset.val; }));

    // main loop
    let last = performance.now();
    let acc = 0;
    /* ?diag=1: record every frame for 45 s together with the hit and point
     * events, then download the report. Reading frame times on the machine that
     * actually stutters beats any amount of guessing from here. */
    const diag = game.diagMode ? { t0: performance.now(), frames: [], events: [], done: false,
      env: { ua: navigator.userAgent, dpr: devicePixelRatio || 1, w: innerWidth, h: innerHeight,
        screen: [screen.width, screen.height], hz: 0 } } : null;
    if (diag) {
      window.__diag = diag;
      const tag = document.createElement('div');
      tag.style.cssText = 'position:fixed;left:12px;top:12px;z-index:9999;pointer-events:none;' +
        'font:700 12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;' +
        'color:#7ff0c0;background:rgba(0,0,0,.68);border:1px solid rgba(127,240,192,.35);' +
        'padding:4px 10px;border-radius:6px';
      document.body.appendChild(tag);
      const started = performance.now();
      const saved = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(diag)], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url; a.download = 'topspin-diag.json'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      };
      const finish = () => {
        if (diag.done) return;
        diag.done = true;
        if (performance.memory) diag.env.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576);
        /* Display rate from the median of the early steady frames, not from the
         * first one — the very first gap after load is always a long startup. */
        const dts = [];
        for (let i = 1; i < Math.min(diag.frames.length, 400); i += 2) dts.push(diag.frames[i]);
        dts.sort((a, b) => a - b);
        if (dts.length) diag.env.hz = Math.round(1000 / dts[Math.floor(dts.length / 2)]);
        /* Chrome occasionally swallows a programmatic download, so the badge
         * becomes the retry button — one click and the file is there. */
        tag.textContent = 'DIAG saved — клик, если файла нет';
        tag.style.color = '#ffd34d';
        tag.style.pointerEvents = 'auto';
        tag.style.cursor = 'pointer';
        tag.onclick = saved;
        saved();
      };
      const tick = () => {
        if (diag.done) return;
        const left = 45 - (performance.now() - started) / 1000;
        tag.textContent = 'DIAG ' + Math.max(0, left).toFixed(0) + 's  ' +
          diag.frames.length + 'f  peak ' + game.peakMs.toFixed(0) + 'ms';
        if (left <= 0) finish(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      document.addEventListener('visibilitychange', () => diag.events.push({
        t: Math.round(performance.now() - diag.t0), k: document.hidden ? 'hide' : 'show' }));
    }
    function frame(now) {
      const ms = now - last;
      if (game.noteFrame && !document.hidden) game.noteFrame(ms);
      if (diag && !diag.done) {
        diag.frames.push(Math.round(now - diag.t0), Math.round(ms * 10) / 10);
      }
      const dt = Math.min(ms / 1000, 0.1);
      last = now;
      if (!game.paused) game.update(dt);
      game.render();
      ui.tick(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame((t) => { last = t; frame(t); });

    // A real brand splash, dismissible immediately once the game is ready.
    const splash = document.getElementById('loading');
    /* Browsers only let an AudioContext start inside a real gesture, and the
     * 1.6 s auto-dismiss is not one. It used to call init()/resume() anyway,
     * which logged three "AudioContext was not allowed to start" warnings on
     * every load and left a context suspended until the next click. So the
     * timer only hides the splash; audio is unlocked by the first real
     * pointerdown or keydown, splash still up or not. */
    let audioUnlocked = false;
    const unlockAudio = () => {
      if (audioUnlocked) return;
      audioUnlocked = true;
      game.audio.init(); game.audio.resume();
      if (document.querySelector('#menu.on')) game.audio.menuMusic(true);
    };
    const splashKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      hideSplash(); unlockAudio();
    };
    const hideSplash = () => {
      splash.classList.add('off');
      window.removeEventListener('keydown', splashKey);
    };
    splash.addEventListener('pointerdown', () => { hideSplash(); unlockAudio(); }, { once: true });
    window.addEventListener('keydown', splashKey);
    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });
    setTimeout(hideSplash, 1600);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
