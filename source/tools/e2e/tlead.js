(() => {
  const g = window.__game, cv = document.getElementById('gl'), R = cv.getBoundingClientRect();
  const DT = 1 / 60, step = (n = 1) => { for (let i = 0; i < n; i++) g.update(DT); };
  let pid = 50;
  const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: R.left + x, clientY: R.top + y, pointerId: pid, pointerType: 'touch', button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, isPrimary: true }));
  const T = g.training, out = [];
  const until = (f, n = 600) => { for (let i = 0; i < n; i++) { if (f()) return i; step(); } return -1; };
  const trial = (stepI, lead, off) => {
    T.goStep(stepI); T.ballNo = 5; T.fails = 0;
    until(() => T.phase === 'live' && g.ball.live, 900);
    T.ballNo = 5;
    let cp;
    until(() => { cp = g.contactPrediction(); return cp && g.rallyBounces.some((s) => s > 0) && cp.t <= lead; }, 600);
    if (!cp) return 'nocp';
    const q = g.project(cp.p, {}); const x = q.x * R.width, y = q.y * R.height + off;
    pid++; ev('pointerdown', x, y); for (let i = 1; i <= 6; i++) { step(); ev('pointermove', x, y - 120 * i / 6); } ev('pointerup', x, y - 120);
    until(() => T.phase !== 'live', 400);
    return T.phase === 'ok' ? 'OK' : '..';
  };
  for (const s of [0, 3]) for (const off of [20, 40, 60]) {
    const row = [];
    for (const lead of [0.04, 0.07, 0.1, 0.13, 0.16, 0.2]) row.push(trial(s, lead, off));
    out.push('step' + s + ' off' + off + ': ' + row.join(' '));
  }
  return out.join('\n');
})()
