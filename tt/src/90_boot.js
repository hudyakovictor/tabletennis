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

    // tap/click the pause overlay to resume
    const pauseInd = document.getElementById('pauseInd');
    if (pauseInd) pauseInd.addEventListener('click', () => game.setPaused(false));

    // icons
    document.getElementById('btnSound').innerHTML = ICON.sound;
    document.getElementById('btnSettings').innerHTML = ICON.gear;
    document.getElementById('btnMenu').innerHTML = ICON.menu;

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

    setTimeout(() => document.getElementById('loading').classList.add('off'), 260);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
