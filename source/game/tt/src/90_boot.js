/* The engine only boots inside the shell's frame. */
'use strict';

(function boot() {
  if (typeof window === 'undefined' || !window.__TT_EMBED || window.parent === window) return;

  const start = () => {
    if (window.__TT_LOCALE) ET.set(window.__TT_LOCALE);
    const canvas = document.getElementById('gl');
    let ui, game;
    try {
      ui = new UI();
      game = new Game(canvas, ui);
      ui.attach(game);
    } catch (err) {
      console.error(err);
      return;
    }
    window.__game = game;
    window.addEventListener('error', (e) => game.diagnosticIssue('error', e.message || 'Script error', e.error && e.error.stack));
    window.addEventListener('unhandledrejection', (e) => {
      const r = e.reason;
      game.diagnosticIssue('unhandledrejection', r && r.message || String(r), r && r.stack);
    });
    canvas.addEventListener('webglcontextlost', () => game.diagnosticIssue('webglcontextlost', 'WebGL context lost'));
    canvas.addEventListener('webglcontextrestored', () => game.diagnosticIssue('webglcontextrestored', 'WebGL context restored'));

    let last = performance.now();
    let perf = null;
    try {
      const wantHud = !!window.__TT_PERF || !!game.debugRecording;
      perf = new PerfMonitor({ overlay: wantHud, onScale: (k) => game.setRenderScale(k) });
      game.perf = perf;
    } catch (e) { console.error(e); }
    function frame(now) {
      const rawDt = (now - last) / 1000;
      const dt = Math.min(rawDt, 0.1);
      last = now;
      if (game.debugRecording && !game.preview?.active) {
        game._debugLastFrameDelta = rawDt;
        if (!game.paused && rawDt > .05) game.logInput('frame_gap', { outcome: { rawSeconds: rawDt, appliedSeconds: dt } });
      }
      const t0 = performance.now();
      const preview = game.preview?.active, awake = !game._ttSleeping;
      if (awake) {
        if (preview) game.preview.update(rawDt);
        else if (!game.paused) game.update(dt);
      }
      const t1 = performance.now();
      if (awake) game.render();
      const t2 = performance.now();
      if (awake && !preview) ui.tick(dt);
      const t3 = performance.now();
      if (perf && awake && !preview) perf.frame(rawDt * 1000, [t1 - t0, t2 - t1, t3 - t2]);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame((t) => { last = t; frame(t); });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
