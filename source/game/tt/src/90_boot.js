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
      if (loading) loading.innerHTML =
        `<div style="max-width:420px;text-align:center;padding:24px">
           <div style="font-size:19px;font-weight:800;margin-bottom:10px">${ET('boot.webglTitle')}</div>
           <div style="font-size:12px;color:#8da3bd;line-height:1.6">
             ${ET('boot.webglBody')}<br><br>
             <code style="font-size:10px;color:#ff8a8a">${(err && err.message) || err}</code>
           </div></div>`;
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
