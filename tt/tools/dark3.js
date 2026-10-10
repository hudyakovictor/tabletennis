const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const br = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--window-size=1280,760'] });
  const page = await br.newPage(); await page.setViewport({ width: 1280, height: 760 });
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('file://' + path.resolve('/home/user/table-tennis-topspin.html'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2200));
  await page.click('#play'); await new Promise(r => setTimeout(r, 600));
  const out = await page.evaluate(() => {
    const g = window.__game; g.paused = true;
    for (let i = 0; i < 240; i++) g.update(1 / 120);
    const R = g.R, S = g.scene;
    g.render();
    const vp = R.viewProj;
    const proj = (x, y, z) => {
      const m = vp;
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const cz = m[2] * x + m[6] * y + m[10] * z + m[14];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(cx / cw * 0.5 + 0.5) * 1280, (1 - (cy / cw * 0.5 + 0.5)) * 760, (cz / cw).toFixed(3), cw.toFixed(2)].map(v => typeof v === 'number' ? Math.round(v) : v).join(',');
    };
    return {
      drawCalls: R.drawCalls, tris: R.tris,
      meshCounts: Object.keys(S.mesh).map(k => k + ':' + (S.mesh[k] ? S.mesh[k].count : 'null')).join(' '),
      corners: {
        nearL: proj(-0.7625, 0.76, 1.37), nearR: proj(0.7625, 0.76, 1.37),
        farL: proj(-0.7625, 0.76, -1.37), farR: proj(0.7625, 0.76, -1.37),
        netTop: proj(0, 0.9125, 0),
        ball: proj(g.ball.p.x, g.ball.p.y, g.ball.p.z),
      },
      ballp: { ...g.ball.p },
      camPos: R.camPos, proj0: Array.from(R.proj).map(v => +v.toFixed(3)),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await br.close();
})();
