/* «Бот 2» — человекоподобный игрок для e2e: разбег ±jitter px, упреждение
 * по предикции контакта. Контракт из тестов: window.__bot2(frames) играет
 * n кадров; window.__b2jit = {px, lead} настраивает разбег. » */
window.__bot2 = (function () {
  let pid = 900;
  return function (frames = 60) {
    const g = window.__game;
    if (!g || !g.canvas) return 'nogame';
    const cv = g.canvas, R = cv.getBoundingClientRect();
    const jit = window.__b2jit || { px: 40, lead: 0.12 };
    const jitter = (s) => (Math.sin(g.time * 911 + s * 31) * 0.5) * jit.px;
    const ev = (type, x, y, buttons = 1) => cv.dispatchEvent(new PointerEvent(type, {
      clientX: R.left + x, clientY: R.top + y, pointerId: pid, pointerType: 'touch',
      button: 0, buttons, bubbles: true, cancelable: true, isPrimary: true
    }));
    let busy = false;
    for (let i = 0; i < frames; i++) {
      g.update(1 / 60);
      /* Подача: состояние SERVE_READY — подносим палец и касаемся */
      if ((g.state === 'SERVE_READY') && g.server === 1) {
        if (!busy) {
          busy = true; pid++;
          const sp = g.project(g.ball.p, {});
          if (sp && sp.ok) {
            const x = sp.x * R.width + jitter(1), y = sp.y * R.height + 120 + jitter(2) * 0.4;
            ev('pointerdown', x, y);
            for (let k = 1; k <= 6; k++) { g.update(1 / 60); ev('pointermove', x, y - 140 * k / 6); }
            ev('pointerup', x, y - 140, 0);
          }
          busy = false;
        }
        continue;
      }
      /* Розыгрыш: по предикции до точки встречи бьём чуть с упреждением. */
      const b = g.ball;
      const incoming = b && b.live && b.v && b.v.z > 0.05 && (!g.rallyBounces || g.rallyBounces.some((s) => s > 0));
      if (incoming && !busy) {
        const cp = g.contactPrediction && g.contactPrediction();
        if (cp && cp.t <= (jit.lead + 0.06) && cp.t > 0.01) {
          busy = true; pid++;
          const sp = g.project(cp.p, {});
          if (sp && sp.ok) {
            const x = sp.x * R.width + jitter(3), y = sp.y * R.height + 36 + jitter(4) * 0.5;
            ev('pointerdown', x, y);
            for (let k = 1; k <= 5; k++) { g.update(1 / 60); ev('pointermove', x, y - 110 * k / 5); }
            ev('pointerup', x, y - 110, 0);
          }
          busy = false;
        }
      }
    }
    return 'ok';
  };
})();
