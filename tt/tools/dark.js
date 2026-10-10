const puppeteer = require('puppeteer');
const path = require('path');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,760'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 760, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + path.resolve(__dirname, '../../table-tennis-topspin.html'), { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2500));
  const info = await p.evaluate(() => {
    const g = window.__game;
    g.start && g.start();
    g.paused = true;
    for (let i = 0; i < 60; i++) g.update(1 / 120);
    const S = g.scene, R = g.R;
    return {
      state: g.state,
      env: JSON.parse(JSON.stringify(R.env)),
      tableMat: { ...S.mat.table, tex: !!S.mat.table.tex },
      useShadowMap: R.useShadowMap,
      hasShadowFBO: !!R.shadowFBO,
      post: JSON.parse(JSON.stringify(R.post)),
      cam: { pos: R.camPos },
      quality: R.quality,
    };
  });
  console.log(JSON.stringify(info, null, 1));
  // render variants
  const variants = {
    a_normal: () => {},
    b_noblobs: () => { window.__game.drawContactShadows = function () {}; },
    c_noblobs_nofx: () => { window.__game.drawContactShadows = function () {}; window.__game.drawFX = function () {}; },
  };
  for (const k of Object.keys(variants)) {
    await p.evaluate(`(${variants[k].toString()})()`);
    await p.evaluate(() => { window.__game.render(); });
    await p.screenshot({ path: path.resolve(__dirname, '../shots/dk_' + k + '.png') });
    await p.reload({ waitUntil: 'load' });
    await new Promise(r => setTimeout(r, 2000));
    await p.evaluate(() => { const g = window.__game; g.start && g.start(); g.paused = true; for (let i = 0; i < 60; i++) g.update(1 / 120); });
  }
  await b.close();
})();
