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
    try {
      if (!document.documentElement.classList.contains('tt-embed') && sessionStorage.getItem('ttu-debug-recording') === '1') game.setDiagnosticMode(true);
    } catch (e) {}
    window.addEventListener('error', (e) => game.diagnosticIssue('error', e.message || 'Script error', e.error && e.error.stack));
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      game.diagnosticIssue('unhandledrejection', r && r.message || String(r), r && r.stack);
    });
    canvas.addEventListener('webglcontextlost', () => game.diagnosticIssue('webglcontextlost', 'WebGL context lost'));
    canvas.addEventListener('webglcontextrestored', () => game.diagnosticIssue('webglcontextrestored', 'WebGL context restored'));

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
    /* Монитор считает цену кадра всегда (три суммы на кадр), а панель
     * показывает только по ?perf или при включённой записи диагностики.
     * Масштаб рендера он правит сам: слабый телефон перестаёт задыхаться
     * без того, чтобы игрок лез в настройки. */
    let perf = null;
    try {
      // В оболочке движок живёт в iframe без query — флаг приходит от хоста
      // (window.__TT_PERF); автономная сборка читает ?perf сама.
      const wantHud = (typeof window.__TT_PERF !== 'undefined' ? !!window.__TT_PERF : false) ||
        /[?&]perf\b/.test(location.search) || !!game.debugRecording;
      perf = new PerfMonitor({ overlay: wantHud, onScale: (k) => game.setRenderScale(k) });
      game.perf = perf;
    } catch (e) { console.error(e); }
    function frame(now) {
      const rawDt = (now - last) / 1000;
      const dt = Math.min(rawDt, 0.1);
      last = now;
      if (game.debugRecording) {
        game._debugLastFrameDelta = rawDt;
        if (!game.paused && rawDt > .05) game.logInput('frame_gap', { outcome: { rawSeconds: rawDt, appliedSeconds: dt } });
      }
      const t0 = performance.now();
      if (!game.paused) game.update(dt);
      const t1 = performance.now();
      game.render();
      const t2 = performance.now();
      ui.tick(dt);
      const t3 = performance.now();
      if (perf) perf.frame(rawDt * 1000, [t1 - t0, t2 - t1, t3 - t2]);
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
