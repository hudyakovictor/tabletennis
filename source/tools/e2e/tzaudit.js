/* Zone × camera audit. Runs inside the game frame. The precise bot (bot2.js) keeps rallies going;
 * for every incoming AI ball we sample, each frame: the predicted contact point (the press-gate anchor)
 * and the ball, both on screen. When the player's bat meets the ball we compute what a human would face.
 * Returns an array of per-shot records; the Python side aggregates. */
window.__zaudit = function (nShots, preset, maxFrames) {
  const g = window.__game, cv = document.getElementById('gl'), R = cv.getBoundingClientRect();
  const W = R.width, H = R.height, GS_ = window.eval('GS'), PCZ = window.eval('pressContactZone'), MR = window.eval('MATCH_RULES');
  const EXT = window.eval('typeof contactGateExtents === "function" ? contactGateExtents : null');
  if (preset) g.setCameraPreset(preset);
  const scr = (p) => { const q = g.project(p, {}); return q && q.ok ? { x: q.x * W, y: q.y * H } : null; };
  const A = window.__za || (window.__za = { recs: [], cur: null, hooked: false, aiHit: null, serve: false });
  A.recs = []; A.cur = null;
  if (!A.hooked) {
    A.hooked = true;
    const orig = g.applyHit.bind(g);
    g.applyHit = function (side, racket, contactP, quality, info) {
      const serve = !!this.isServeBall;
      if (side > 0 && A.cur && A.cur.samples.length) A.done = { cur: A.cur, contact: { x: contactP.x, y: contactP.y, z: contactP.z }, t: this.time };
      if (side < 0) A.cur = { t0: this.time, serve, samples: [], bounceT: null, shot: this.shotId + 1 };
      else A.cur = null;
      return orig(side, racket, contactP, quality, info);
    };
  }
  const finish = (d) => {
    const s = d.cur.samples, last = s[s.length - 1];
    const C = scr(d.contact); if (!C) return;
    const pxcm = (dx, dy) => { const a = scr({ x: d.contact.x + dx, y: d.contact.y + dy, z: d.contact.z }); return a ? Math.hypot(a.x - C.x, a.y - C.y) / 5 : NaN; };
    const pxX = pxcm(0.05, 0), pxY = pxcm(0, 0.05);
    const sc = typeof g.contactGateScale === 'function' ? g.contactGateScale(d.contact, { width: W, height: H }) : null;
    const ext = EXT ? EXT('touch', sc) : { sidePx: MR.contactSideTouchPx, backPx: MR.contactBackPx, fwdPx: MR.contactForwardPx };
    // gate windows: finger ON the ball / 40 px BELOW the ball, gate anchored on the prediction of that frame
    const win = (offY) => { let lo = null, hi = null; for (const q of s) { if (!q.cp) continue;
      const z = PCZ({ x: q.cp.x / W, y: q.cp.y / H, ok: true }, { x: q.b.x / W, y: (q.b.y + offY) / H }, W, H, { pointerType: 'touch', scale: q.sc });
      if (z && z.accepted) { const tt = d.t - q.t; if (hi === null || tt > hi) hi = tt; if (lo === null || tt < lo) lo = tt; } }
      return hi === null ? null : [+lo.toFixed(3), +hi.toFixed(3)]; };
    const at = (lead) => { let best = null; for (const q of s) if (q.cp && (best === null || Math.abs(d.t - q.t - lead) < Math.abs(d.t - best.t - lead))) best = q; return best; };
    const drift = (lead) => { const q = at(lead); return q && Math.abs(d.t - q.t - lead) < 0.03 ? +Math.hypot(q.cp.x - C.x, q.cp.y - C.y).toFixed(1) : null; };
    const q05 = at(0.05), bsp = q05 ? Math.hypot(q05.b.x - C.x, q05.b.y - C.y) / Math.max(0.01, d.t - q05.t) : NaN;
    const firstCp = s.find((q) => q.cp);
    A.recs.push({ serve: d.cur.serve, flight: +(d.t - d.cur.t0).toFixed(3), afterBounce: d.cur.bounceT ? +(d.t - d.cur.bounceT).toFixed(3) : null,
      cpVisibleFor: firstCp ? +(d.t - firstCp.t).toFixed(3) : 0,
      cw: [+d.contact.x.toFixed(3), +(d.contact.y - 0.76).toFixed(3), +d.contact.z.toFixed(3)], cs: [Math.round(C.x), Math.round(C.y)],
      cfrac: [+(C.x / W).toFixed(3), +(C.y / H).toFixed(3)], pxX: +pxX.toFixed(2), pxY: +pxY.toFixed(2),
      ballPxPerS: Math.round(bsp), onBall: win(0), below40: win(40),
      drift: { t30: drift(0.30), t20: drift(0.20), t10: drift(0.10) },
      zoneCm: { side: +(ext.sidePx / pxX).toFixed(1), back: +(ext.backPx / pxY).toFixed(1), fwd: +(ext.fwdPx / pxY).toFixed(1) }, zonePx: [Math.round(ext.sidePx), Math.round(ext.backPx), Math.round(ext.fwdPx)],
      clipBottom: C.y + ext.fwdPx > H * 0.872, clipSide: C.x - ext.sidePx < 0 || C.x + ext.sidePx > W,
      unreachable: (C.x < 0 || C.x > W) && !((MR.contactEdgePx || 0) > 0) });
  };
  const bot = window.__bot2;
  let f = 0;
  while (A.recs.length < nShots && f < (maxFrames || 60 * 600)) {
    if (A.cur && g.state === GS_.RALLY && g.ball.live && g.ball.lastHitBy === -1) {
      if (!A.cur.bounceT && g.rallyBounces.some((x) => x > 0)) A.cur.bounceT = g.time;
      const cp = g.contactPrediction(), b = scr(g.ball.p);
      if (b) A.cur.samples.push({ t: g.time, b, cp: cp ? scr(cp.p) : null, sc: cp && typeof g.contactGateScale === 'function' ? g.contactGateScale(cp.p, { width: W, height: H }) : null, bounced: !!A.cur.bounceT });
    }
    bot(1); f++;
    if (A.done) { finish(A.done); A.done = null; }
    if (g.state === GS_.MATCH_END) break;
  }
  return { W, H, preset: g.settings.camera, frames: f, recs: A.recs };
};
