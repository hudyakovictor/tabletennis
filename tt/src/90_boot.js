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
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!game.paused) game.update(dt);
      game.render();
      ui.tick(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame((t) => { last = t; frame(t); });

    // A real brand splash, dismissible immediately once the game is ready.
    const splash = document.getElementById('loading');
    const dismissSplash = () => {
      splash.classList.add('off');
      window.removeEventListener('keydown', splashKey);
      // The splash tap is the first user gesture: unlock audio and let the
      // pending menu soundtrack begin.
      game.audio.init(); game.audio.resume();
      if (document.querySelector('#menu.on')) game.audio.menuMusic(true);
    };
    const splashKey = (e) => { if (e.key === 'Enter' || e.key === ' ') dismissSplash(); };
    splash.addEventListener('pointerdown', dismissSplash, { once: true });
    window.addEventListener('keydown', splashKey);
    setTimeout(dismissSplash, 1600);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
