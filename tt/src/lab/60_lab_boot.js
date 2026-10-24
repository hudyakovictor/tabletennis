/* =====================================================================
 *  BOOT — the page IS the drill. No menu, no splash to dismiss.
 * ===================================================================== */
'use strict';

(function bootLab() {
  const fail = (err) => {
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;text-align:center">
      <div style="max-width:440px">
        <div style="font-size:19px;font-weight:800;margin-bottom:10px">WebGL недоступен</div>
        <div style="font-size:12px;color:#9fb1c8;line-height:1.6">
          Этой игре нужен WebGL. Включите аппаратное ускорение и перезагрузите страницу.<br><br>
          <code style="font-size:10px;color:#ff8a8a">${(err && err.message) || err}</code>
        </div>
      </div></div>`;
    console.error(err);
  };

  const start = () => {
    let store, ui, game;
    try {
      store = new LabStore();
      ui = new LabUI();
      game = new LabGame(document.getElementById('gl'), store, ui);
      ui.attach(game);
    } catch (err) { fail(err); return; }
    window.__game = game;
    window.__lab = { game, store, ui, LAB, LAB_SHOTS, labShotForVector, labBallZone, labBuildStroke };

    let last = performance.now();
    let frames = 0;
    const frame = (now) => {
      const dt = Math.max(0, (now - last) / 1000);
      last = now;
      game.update(dt);
      game.render();
      ui.tick(dt);
      frames++;
      game.frames = frames;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame((t) => { last = t; frame(t); });

    window.addEventListener('pagehide', () => store.endSession());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) store.endSession();
      else if (!store.session) store.startSession();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
