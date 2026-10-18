/* =====================================================================
 *  BOOT
 * ===================================================================== */
'use strict';

(function boot() {
  const start = () => {
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
      if (loading) {
        const detail = String((err && err.message) || err || 'Unknown startup error');
        const isWebGLFailure = /webgl|graphics context/i.test(detail);
        const panel = document.createElement('div');
        panel.style.cssText = 'max-width:420px;text-align:center;padding:24px';
        const title = document.createElement('div');
        title.style.cssText = 'font-size:19px;font-weight:800;margin-bottom:10px';
        title.textContent = isWebGLFailure ? 'WebGL недоступен' : 'Не удалось запустить игру';
        const copy = document.createElement('div');
        copy.style.cssText = 'font-size:12px;color:#8da3bd;line-height:1.6';
        copy.textContent = isWebGLFailure
          ? 'Этой демке нужен WebGL. Включите аппаратное ускорение в браузере и перезагрузите страницу.'
          : 'Произошла ошибка во время запуска. Обновите страницу или сообщите этот код ошибки.';
        const code = document.createElement('code');
        code.style.cssText = 'display:block;margin-top:16px;font-size:10px;color:#ff8a8a';
        code.textContent = detail;
        panel.append(title, copy, code);
        loading.replaceChildren(panel);
      }
      return;
    }
    window.__game = game;

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
    };
    const splashKey = (e) => { if (e.key === 'Enter' || e.key === ' ') dismissSplash(); };
    splash.addEventListener('pointerdown', dismissSplash, { once: true });
    window.addEventListener('keydown', splashKey);
    setTimeout(dismissSplash, 1600);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
