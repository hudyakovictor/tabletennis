/* Outcome map: does the press gate agree with what the physics can actually return?
 * For every incoming AI ball the bot presses at (contact point + dx, dy) `lead` seconds before the
 * predicted contact and swipes up 120 px in 100 ms. Each trial records the gate verdict and the outcome:
 *   gate  — press rejected (OUTSIDE_ZONE etc.)   miss — accepted, bat never met the ball
 *   net / out — met the ball, shot lost           in — met the ball, landed on the opponent's half
 * dx ∈ [-DX, DX] px, dy ∈ [DY0, DY1] px (positive = below the contact point), lead ∈ [L0, L1] s. */
window.__zmap = function (nTrials, o) {
  o = Object.assign({ DX: 90, DY0: -90, DY1: 170, L0: 0, L1: 0.24, swipe: 120, frames: 6, forceGate: false }, o || {});
  const g = window.__game, cv = document.getElementById('gl'), R = cv.getBoundingClientRect();
  const W = R.width, H = R.height, GS_ = window.eval('GS'), MR = window.eval('MATCH_RULES');
  const M = window.__zm || (window.__zm = { pid: 5000, hooked: false });
  M.trials = []; M.cur = null; M.g = null;
  if (!M.origPCZ) M.origPCZ = window.pressContactZone;
  window.pressContactZone = o.noGate ? function (...a) { const z = M.origPCZ(...a); if (z) { z.wouldAccept = z.accepted; z.accepted = true; z.reason = null; } return z; } : M.origPCZ;
  if (!M.hooked) {
    M.hooked = true;
    const ah = g.applyHit.bind(g);
    g.applyHit = function (side, racket, cp, q, info) {
      if (side > 0 && M.cur && !M.cur.hit) { M.cur.hit = true; M.cur.stroke = racket && racket.stroke && racket.stroke.id;
        M.cur.sweet = q; M.cur.contactDt = +(this.time - M.cur.pressT).toFixed(3); }
      return ah(side, racket, cp, q, info);
    };
    const ap = g.awardPoint.bind(g);
    g.awardPoint = function (who, reason) {
      if (M.cur && !M.cur.outcome) {
        if (!M.cur.hit) M.cur.outcome = M.cur.gate ? 'gate' : 'miss';
        else M.cur.outcome = who > 0 ? 'in' : /СЕТК|НЕ ПЕРЕЛЕТЕЛ/.test(reason) ? 'net' : 'out';
        M.cur.reason = reason;
      }
      return ap(who, reason);
    };
  }
  const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: R.left + x, clientY: R.top + y, pointerId: M.pid, pointerType: 'touch', button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true }));
  const rnd = (a, b) => a + Math.random() * (b - a);
  let f = 0, tapped = -9;
  const close = () => {   // the shot is decided once the ball has bounced on the opponent's half after our hit
    if (M.cur && !M.cur.outcome && M.cur.hit && g.ball.lastHitBy === 1 && g.rallyBounces.some((s) => s < 0)) M.cur.outcome = 'in';
    if (M.cur && M.cur.outcome) { M.trials.push(M.cur); M.cur = null; }
  };
  while (M.trials.length < nTrials && f < 60 * 1200) {
    if (M.g) {
      M.g.i++; ev('pointermove', M.g.x + M.g.dxs * M.g.i / o.frames, M.g.y - o.swipe * M.g.i / o.frames);
      if (M.g.i >= o.frames) { ev('pointerup', M.g.x + M.g.dxs, M.g.y - o.swipe); M.g = null; }
    } else if (g.state === GS_.SERVE_READY && g.server === 1 && g.time - tapped > 1) {
      M.pid++; ev('pointerdown', W / 2, H * .7); ev('pointerup', W / 2, H * .7); tapped = g.time;
    } else if (g.state === GS_.SERVE_TOSS && g.server === 1 && g.ball.lastHitBy === 0 && g.ball.v.y < 0 && g.ball.p.y < g.tossApex - 0.12) {
      const q = g.project(g.ball.p, {}); M.pid++; M.g = { x: q.x * W, y: q.y * H + 40, dxs: 0, i: 0 }; ev('pointerdown', M.g.x, M.g.y);
    } else if (g.state === GS_.RALLY && g.ball.lastHitBy === -1 && !M.cur) {
      const cp = g.contactPrediction();
      if (cp && M.planFor !== g.shotId) { M.planFor = g.shotId; M.plan = { dx: rnd(-o.DX, o.DX), dy: rnd(o.DY0, o.DY1), lead: rnd(o.L0, o.L1), serve: !!g.isServeBall }; }
      if (cp && M.plan && M.planFor === g.shotId && cp.t <= M.plan.lead) {
        const q = g.project(cp.p, {}); const x = q.x * W + M.plan.dx, y = q.y * H + M.plan.dy;
        M.pid++; M.g = { x, y, dxs: 0, i: 0 }; ev('pointerdown', x, y);
        const z = g.swipe.pressZone || {};
        M.cur = { dx: Math.round(M.plan.dx), dy: Math.round(M.plan.dy), lead: +M.plan.lead.toFixed(3), cpT: +cp.t.toFixed(3), serve: M.plan.serve,
          gate: !z.accepted, gateReason: z.reason || null, would: z.wouldAccept, sidePx: z.sidePx, backPx: z.backPx, fwdPx: z.fwdPx, pressT: g.time, hit: false,
          cpw: [+cp.p.x.toFixed(2), +(cp.p.y - 0.76).toFixed(2), +cp.p.z.toFixed(2)], cps: [Math.round(q.x * W), Math.round(q.y * H)] };
      }
    }
    g.update(1 / 60); f++;
    close();
    if (g.state === GS_.MATCH_END) { g.settings.targetScore = 99; break; }
  }
  return { W, H, preset: g.settings.camera, frames: f, trials: M.trials };
};
