/* Shared driver for gameplay probes: reproducible pointer input that mirrors
 * the production bindInput() handlers, without the DOM. */
'use strict';
const { makeGame } = require('./sim-game.cjs');

function attachDriver(g, ctx) {
  const api = ctx.__api;
  const V3 = api.V3, PH = api.PH, M4 = api.M4;
  const W = 1280, H = 760;
  const d = {
    g, api, V3, PH,
    down(x, y) {
      g.swipe.down(x, y, g.time);
      g.swipe.pressZone = ctx.pressHitZone(g.project(g.ball.p), { x, y }, W, H) ||
        { accepted: false, radius: api.MATCH_RULES.pressRadiusPx, distancePx: null };
      g.swipe.pressZone.serving = g.state === 'SERVE_READY' || g.state === 'SERVE_TOSS';
      g.pointer = { x, y }; g.pointerDown = true; g.pointerFine = true;
      if (g.state === 'SERVE_READY' && g.server === 1) g.startToss();
    },
    move(x, y) {
      g.pointer = { x, y };
      g.mouseTrail = (g.mouseTrail || []).filter(p => g.time - p.t < .14);
      g.mouseTrail.push({ x, y, t: g.time });
      if (g.swipe.active) g.swipe.move(x, y, g.time);
    },
    up(x, y) {
      if (!g.swipe.active) { g.pointerDown = false; return; }
      g.pointer = { x, y };
      g.swipe.up(x, y, g.time);
      g.pointerDown = false; g.swipeReleasedAt = g.time;
      g.lastSwipeT = g.time;
    },
    /* Screen position of a world point through the gameplay camera. */
    screen(p) { return g.project(p); },
    /* Pointer that puts the BAT centre at (x,y) and the stance depth at z. */
    pointerFor(x, y, z) {
      const sens = api.MATCH_RULES.sensitivity;
      const px = 0.5 + x / (2 * 1.02 * sens);
      const py = 0.18 + (PH.TABLE_Y + 0.62 - y) / (0.95 * sens);
      let sy = py;
      if (Number.isFinite(z)) sy = 0.55 + (z - 1.44) / (0.86 * (0.6 + 0.4 * sens));
      return { x: px, y: py, sy: Math.max(0, Math.min(1, sy)) };
    },
    /* Press where the ball is (satisfies the 48 px admission), then hold. */
    pressAtBall() {
      const s = g.project(g.ball.p);
      if (!s.ok) return null;
      const x = Math.max(0, Math.min(1, s.x)), y = Math.max(0, Math.min(1, s.y));
      d.down(x, y);
      return { x, y };
    },
    step(dt = 1 / 60, n = 1) {
      for (let i = 0; i < n; i++) g.update(dt);
    },
  };
  return d;
}

function fresh(settings = {}, opts = {}) {
  const { g, ctx, api } = makeGame({ settings, ...opts });
  g.R.viewProj = g.camVP;
  return { g, ctx, api, d: attachDriver(g, ctx) };
}

module.exports = { fresh, attachDriver };
