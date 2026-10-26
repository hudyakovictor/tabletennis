/* Карта эффективной области удара. Выполняется ВНУТРИ страницы игры.
 * Синтетический игрок: в момент, когда до мяча остаётся `lead` секунд,
 * ставит палец в точку (мяч + dx,dy) CSS px и делает свайп вверх.
 * Возвращает сетку: hit (контакт ракеткой) и ok (мяч вернулся на стол соперника). */
window.__hitmap = function (opt) {
  const g = window.__game, cv = document.getElementById('gl');
  const o = Object.assign({ leads: null, xs: [], ys: [], lead: 0, swipePx: 120, swipeMs: 100, swipeDx: 0, seed: 7, lanes: [-.2, 0, .2], type: 'touch', step: 1 }, opt || {});
  let s = o.seed; const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  Math.random = rand;
  const R = cv.getBoundingClientRect();
  const DT = 1 / 60;
  const step = (n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
  const ev = (type, x, y) => {
    const e = new PointerEvent(type, { clientX: R.left + x, clientY: R.top + y, pointerId: 7, pointerType: o.type, button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true });
    cv.dispatchEvent(e);
  };
  if (!g.training) g.startTraining();
  let bounces = [];
  if (!g.__hmHooked2) { g.__hmHooked2 = true; const ob = g.onBounce; g.onBounce = function (side) { (window.__hmB || []).push({ side, by: this.ball.lastHitBy }); return ob.apply(this, arguments); }; }
  const T = g.training;
  T.goStep(1); // ТОПСПИН: подача-накидка с дальней стороны
  const out = [];
  const reset = (lane) => {
    g.cancelInput && g.cancelInput();
    T.goStep(o.step); T.phase = 'hold'; g.ball.live = false; step(20);
    const r0 = Math.random; Math.random = () => .5 + lane; T.feed(); Math.random = r0;
  };
  const ghosts = {};
  /* Проход-«призрак»: тот же детерминированный накат без касаний. Находим кадр,
   * где мяч доходит до плоскости ракетки, и его экранную точку S. Идеальный
   * игрок проводит пальцем через S ровно в этот момент (середина свайпа). */
  const park = (x, y) => cv.dispatchEvent(new PointerEvent('pointermove', { clientX: R.left + x, clientY: R.top + y, pointerId: 8, pointerType: 'mouse', buttons: 0, bubbles: true, cancelable: true, isPrimary: true }));
  const ghost = (lane) => {
    if (ghosts[lane]) return ghosts[lane];
    let at = { x: R.width / 2, y: R.height * .55 };
    for (let it = 0; it < 3; it++) { park(at.x, at.y); const G = ghost1(lane); if (!G) return (ghosts[lane] = null); at = G; }
    return (ghosts[lane] = at);
  };
  const ghost1 = (lane) => {
    reset(lane);
    let prev = null, near = null;
    for (let f = 1; f < 240; f++) {
      step();
      const b = g.ball, pz = g.player.pos.z;
      const bounced = g.rallyBounces && g.rallyBounces.some((x) => x > 0);
      const sp = g.project(b.p, {}); const cur = { x: sp.x * R.width, y: sp.y * R.height, z: b.p.z, f };
      if (bounced && b.p.z >= pz && prev) {
        const k = Math.min(1, Math.max(0, (pz - prev.z) / Math.max(1e-6, b.p.z - prev.z)));
        return ({ f: prev.f + k, x: prev.x + (cur.x - prev.x) * k, y: prev.y + (cur.y - prev.y) * k });
      }
      // короткий мяч может не дойти до плоскости: берём момент наибольшего сближения по глубине
      if (bounced && b.p.y > PH.TABLE_Y + .03) { const dz = Math.abs(pz - b.p.z); if (!near || dz < near.dz) near = { dz, f, x: cur.x, y: cur.y }; }
      prev = cur;
      if (!b.live) break;
    }
    return near && near.dz < .25 ? near : null;
  };
  const one = (dx, dy, lane) => {
    const G = ghost(lane);
    const res = { hit: false, ok: false, zone: '-', pressed: false };
    if (!G) return res;
    park(G.x, G.y); reset(lane);
    const swipeT = o.swipeMs / 1000, n = Math.max(2, Math.round(swipeT / DT));
    const startF = Math.round(G.f - n / 2 - o.lead / DT);
    for (let f = 1; f < startF; f++) step();
    const sx = G.x + dx, sy = G.y + dy + o.swipePx / 2;
    ev('pointermove', sx, sy); ev('pointerdown', sx, sy);
    const pz = g.swipe.pressZone; res.zone = pz ? (pz.accepted ? 'IN' : (pz.reason || 'OUT')) : '-';
    let best = { dz: 9 };
    const track = () => { const b = g.ball.p, q = g.player.pos, dz = Math.abs(b.z - q.z);
      if (g.ball.lastHitBy !== 1 && dz < best.dz) best = { dz: +dz.toFixed(3), lat: +Math.hypot(b.x - q.x, b.y - q.y).toFixed(3), bz: +b.z.toFixed(2), pz: +q.z.toFixed(2) }; };
    for (let i = 1; i <= n; i++) { step(); track(); ev('pointermove', sx + o.swipeDx * i / n, sy - o.swipePx * i / n); }
    ev('pointerup', sx + o.swipeDx, sy - o.swipePx);
    res.pressed = true;
    let bouncedOpp = false; window.__hmB = [];
    for (let i = 0; i < 150; i++) {
      if (g.ball.lastHitBy === 1) res.hit = true; else track();
      if (window.__hmB.some((b) => b.side === -1 && b.by === 1)) { bouncedOpp = true; res.land = [+g.ball.p.x.toFixed(2), +g.ball.p.z.toFixed(2)]; }
      if (!g.ball.live || bouncedOpp) break;
      step();
    }
    res.ok = res.hit && bouncedOpp; res.best = best;
    return res;
  };
  if (o.pre) for (const [x, y, l] of o.pre) one(x, y, l);
  if (o.probe) return o.lanes.map((lane) => Object.assign({ lane, ghost: ghost(lane) }, one(o.xs[0] || 0, o.ys[0] || 0, lane)));
  if (o.leads) {
    for (const L of o.leads) { o.lead = L; let hit = 0, ok = 0;
      for (const lane of o.lanes) { const r = one(o.xs[0] || 0, o.ys[0] || 0, lane); hit += r.hit; ok += r.ok; }
      out.push({ lead: L, hit: hit / o.lanes.length, ok: ok / o.lanes.length }); }
    return out;
  }
  for (const dy of o.ys) for (const dx of o.xs) {
    let hit = 0, ok = 0, z = {};
    for (const lane of o.lanes) { const r = one(dx, dy, lane); hit += r.hit; ok += r.ok; z[r.zone] = (z[r.zone] || 0) + 1; }
    out.push({ dx, dy, hit: hit / o.lanes.length, ok: ok / o.lanes.length, zone: z });
  }
  return out;
};
