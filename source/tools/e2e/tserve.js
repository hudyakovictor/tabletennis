(() => {
  const g = window.__game, cv = document.getElementById('gl'), R = cv.getBoundingClientRect();
  const DT = 1 / 60, step = (n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
  let pid = 80;
  const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: R.left + x, clientY: R.top + y, pointerId: pid, pointerType: 'touch', button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true }));
  const T = g.training, out = [];
  const until = (f, n = 600) => { for (let i = 0; i < n; i++) { if (f()) return i; step(); } return -1; };
  const GSN = (s) => Object.keys(GS).find((k) => GS[k] === s);
  T.goStep(2);
  for (let k = 0; k < 3; k++) {
    let w = until(() => g.state === GS.SERVE_READY && T.phase === 'live', 900);
    const c = T.coachCue(); out.push('ball' + k + ' ready@' + w + ' cue=' + (c && c.kind) + ' text=' + T.coachText);
    const q = c && c.p ? g.project(c.p, {}) : { x: .5, y: .7 };
    pid++; ev('pointerdown', q.x * R.width, q.y * R.height); step(); ev('pointerup', q.x * R.width, q.y * R.height);
    w = until(() => T.frozen || (g.state === GS.SERVE_TOSS && g.ball.v.y < 0 && k > 0 && g.ball.p.y < g.tossApex - 0.12), 300);
    const c2 = T.coachCue(); out.push('  state=' + GSN(g.state) + ' frozen=' + T.frozen + ' cue=' + (c2 && c2.kind + '/' + c2.level) + ' text=' + T.coachText);
    const p2 = g.project(g.ball.p, {}); const x = p2.x * R.width, y = p2.y * R.height + 40;
    pid++; ev('pointerdown', x, y); for (let i = 1; i <= 6; i++) { step(); ev('pointermove', x, y - 120 * i / 6); } ev('pointerup', x, y - 120);
    until(() => T.phase !== 'live', 400); out.push('  -> phase=' + T.phase + ' done=' + T.done + ' ' + T.msg);
  }
  return out.join('\n');
})()
