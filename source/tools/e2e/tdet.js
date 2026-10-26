(() => {
  const g = window.__game, cv = document.getElementById('gl'), R = cv.getBoundingClientRect();
  const DT = 1 / 60, step = (n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
  let pid = 20;
  const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: R.left + x, clientY: R.top + y, pointerId: pid, pointerType: 'touch', button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true }));
  const T = g.training, out = [];
  const swipe = (x, y, dx = 0) => { pid++; ev('pointerdown', x, y); for (let i = 1; i <= 6; i++) { step(); ev('pointermove', x + dx * i / 6, y - 120 * i / 6); } ev('pointerup', x + dx, y - 120); };
  const until = (f, n = 600) => { for (let i = 0; i < n; i++) { if (f()) return i; step(); } return -1; };
  const cueXY = () => { const c = T.coachCue(); if (!c || !c.p) return null; const q = g.project(c.p, {}); return [q.x * R.width, q.y * R.height, c]; };
  T.goStep(1); // урок «УДАР» — мячи летят сами; урок 0 (подача) требует жеста
  // выйти из intro: одно касание — «я прочитал объявление урока»
  ev('pointerdown', R.width * 0.5, R.height * 0.8); g.update(DT); ev('pointerup', R.width * 0.5, R.height * 0.8);
  // ball 1: freeze
  let f = until(() => T.frozen, 900); out.push('freeze@' + f);
  let [x, y] = cueXY();
  pid++; ev('pointerdown', x + 160, y + 200); ev('pointerup', x + 160, y + 200); step(2);
  out.push('badPress frozen=' + T.frozen + ' nudge=' + T.nudge.toFixed(2));
  swipe(x, y + 40);
  out.push('after swipe frozen=' + T.frozen + ' ballz=' + g.ball.p.z.toFixed(2) + ' padz=' + g.player.pos.z.toFixed(2));
  until(() => T.phase !== 'live', 400); out.push('ball1 phase=' + T.phase + ' done=' + T.done + ' msg=' + T.msg);
  out.push(JSON.stringify(g.inputLog.events().filter(e => e.type !== 'frame' && e.type !== 'pointermove').slice(-5).map(e => [e.type, +e.t.toFixed(3), e.outcome])));
  // ball 2: approach — press when contact is ~0.1 s away
  until(() => T.phase === 'live' && g.ball.live, 600);
  f = until(() => { const cp = g.contactPrediction && g.contactPrediction(); return cp && g.rallyBounces.some((s) => s > 0) && cp.t <= 0.06; }, 600);
  const c2 = cueXY(); out.push('ball2 guide=' + T.guide + ' frozen=' + T.frozen + ' cue=' + (c2 && c2[2].level));
  if (c2) swipe(c2[0], c2[1] + 40);
  until(() => T.phase !== 'live', 400); out.push('ball2 phase=' + T.phase + ' done=' + T.done + ' ' + T.msg);
  out.push(JSON.stringify(g.inputLog.events().filter(e => e.type !== 'frame' && e.type !== 'pointermove').slice(-4).map(e => [e.type, +e.t.toFixed(3), e.outcome, e.decision && e.decision.reason])));
  // ball 3: ring
  until(() => T.phase === 'live' && g.ball.live, 600);
  until(() => { const cp = g.contactPrediction && g.contactPrediction(); return cp && g.rallyBounces.some((s) => s > 0) && cp.t <= 0.06; }, 600);
  const c3 = cueXY(); out.push('ball3 guide=' + T.guide + ' cue=' + (c3 && c3[2].level));
  if (c3) swipe(c3[0], c3[1] + 40);
  until(() => T.phase !== 'live', 400); out.push('ball3 phase=' + T.phase + ' done=' + T.done);
  step(90); out.push('step now=' + T.step + ' ' + T.S.id + ' phase=' + T.phase);
  // AIM: одним касанием закрыть объявление урока, потом мяч на aimSide
  if (T.phase === 'intro') { ev('pointerdown', R.width * 0.5, R.height * 0.8); g.update(DT); ev('pointerup', R.width * 0.5, R.height * 0.8); }
  until(() => T.phase === 'live' && g.ball.live, 900);
  until(() => { const cp = g.contactPrediction && g.contactPrediction(); return cp && g.rallyBounces.some((s) => s > 0) && cp.t <= 0.06; }, 600);
  const c4 = cueXY(); out.push('aim side=' + T.aimSide + ' cue=' + (c4 && c4[2].level) + ' aimcue=' + (c4 && c4[2].aim));
  if (c4) swipe(c4[0], c4[1] + 40, 90 * T.aimSide);
  until(() => T.phase !== 'live', 400); out.push('aim phase=' + T.phase + ' done=' + T.done + ' x=' + g.ball.p.x.toFixed(2) + ' ' + T.msg);
  return out.join('\n');
})()
