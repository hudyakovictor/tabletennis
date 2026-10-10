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
    const R = g.R, gl = R.gl;
    const sample = (label) => {
      const cv = R.gl.canvas;
      const px = new Uint8Array(4);
      const pts = [[640, 700], [640, 600], [640, 500], [640, 380], [640, 330], [200, 600], [1080, 600]];
      const res = [];
      for (const [x, y] of pts) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.readPixels(Math.round(x * cv.width / 1280), Math.round((760 - y) * cv.height / 760), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        res.push([x, y, px[0], px[1], px[2]].join(','));
      }
      return label + ': ' + res.join(' | ');
    };
    const log = [];
    g.render(); log.push(sample('normal'));
    const sv = g.drawContactShadows; g.drawContactShadows = function () { };
    g.render(); log.push(sample('noblob'));
    g.drawContactShadows = sv;
    const svfx = g.drawFX; g.drawFX = function () { };
    g.render(); log.push(sample('nofx  '));
    g.drawFX = svfx;
    // table material probe
    const S = g.scene;
    const old = S.mat.table;
    S.mat.table = { color: [1, 0, 0], rough: 0.5, emissive: [1, 0, 0] };
    g.render(); log.push(sample('redtbl'));
    S.mat.table = old;
    return {
      log, camPos: R.camPos, state: g.state,
      cw: gl.canvas.width, ch: gl.canvas.height,
      fovInfo: R._lastFov, dpr: R.dpr,
      tableTopM: Array.from(S.M.tableTop),
    };
  });
  console.log(out.log.join('\n'));
  console.log('cam', JSON.stringify(out.camPos), 'state', out.state, 'canvas', out.cw, out.ch, 'dpr', out.dpr);
  console.log('tableTop M', out.tableTopM.map(v => +v.toFixed(3)).join(' '));
  await br.close();
})();
