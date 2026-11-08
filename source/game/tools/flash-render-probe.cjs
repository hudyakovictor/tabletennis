/* Временный зонд (не часть сюиты): приёмка плана по рендеру контактной вспышки.
 * Читает ВЕСЬ кадр дефолтного FBO дважды (с пульсой / без неё) и считает
 * пиксель с максимальным приростом яркости: по вектору «прибавилось» видно,
 * выживает ли тон палитры после ACES/блика, а по litPct — заметна ли пульса
 * вообще. Режим free убирает мяч из кадра, режим live меряет то, что игрок
 * видит в момент контакта (мяч может закрысть квад своим силуэтом).
 * Запуск: CHROME_BIN=... node tools/flash-render-probe.cjs */
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const { appFrame } = require('../tests/helpers.cjs');

function hexToRgb(h) { const s = h.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)].map((v) => v / 255); }
function hue(rgb) {
  const [r, g, b] = rgb.map((v) => Math.max(0, v));
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(h * 60);
}
function hueDist(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
function sat(rgb) { const mx = Math.max(...rgb), mn = Math.min(...rgb); return mx <= 0 ? 0 : +((mx - mn) / mx).toFixed(2); }

const PROBE = `((sid, age, mode) => {
  function hx(h) { const s = h.replace('#', ''); return [parseInt(s.slice(0,2),16)/255, parseInt(s.slice(2,4),16)/255, parseInt(s.slice(4,6),16)/255]; }
  const g = window.__game, gl = g.R.gl, W = g.canvas.width, H = g.canvas.height;
  g.paused = true;
  if (!g._ballHome) g._ballHome = V3.clone(g.ball.p);
  const contact = V3.clone(g._ballHome);
  if (mode === 'free') V3.set(g.ball.p, 0, 3.4, -4.2); else V3.copy(g.ball.p, g._ballHome);
  g.contactFlashes.length = 0;
  const grab = (withFlash) => {
    if (withFlash) {
      const c = hx(STROKES[sid].col);
      g.contactFlashes.push({ side: 1, id: sid, p: V3.clone(contact), r: c[0], g: c[1], b: c[2],
        birth: g.time - CONTACT_FLASH_LIFE_S * age, life: CONTACT_FLASH_LIFE_S });
    } else g.contactFlashes.length = 0;
    const dc0 = g.R.drawCalls;
    g.render();
    const arr = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, arr);
    return { arr, dc: g.R.drawCalls - dc0 };
  };
  const on = grab(true), off = grab(false);
  let bestK = -1, bestDL = 0, n = 0, sum = [0, 0, 0];
  for (let i = 0; i < W * H; i++) {
    const k = i * 4;
    const dl = (on.arr[k] + on.arr[k+1] + on.arr[k+2]) - (off.arr[k] + off.arr[k+1] + off.arr[k+2]);
    if (dl > bestDL) { bestDL = dl; bestK = k; }
    if (dl > 1) { sum[0] += on.arr[k] - off.arr[k]; sum[1] += on.arr[k+1] - off.arr[k+1]; sum[2] += on.arr[k+2] - off.arr[k+2]; n++; }
  }
  V3.copy(g.ball.p, g._ballHome);
  const px = bestK < 0 ? null : {
    base: [off.arr[bestK], off.arr[bestK+1], off.arr[bestK+2]],
    added: [on.arr[bestK] - off.arr[bestK], on.arr[bestK+1] - off.arr[bestK+1], on.arr[bestK+2] - off.arr[bestK+2]],
  };
  /* ядро мяча: пульса не должна его трогать (глубина) и не должна его
   * перебивать по яркости (он остаётся ярчайшим объектом кадра) */
  const pb = g.project(g._ballHome, {});
  const bk = (Math.min(H - 1, Math.max(0, (1 - pb.y) * H | 0)) * W + Math.min(W - 1, Math.max(0, pb.x * W | 0))) * 4;
  const core = { base: [off.arr[bk], off.arr[bk+1], off.arr[bk+2]],
    added: [on.arr[bk] - off.arr[bk], on.arr[bk+1] - off.arr[bk+1], on.arr[bk+2] - off.arr[bk+2]] };
  /* экранный радиус мяча — чтобы сказать, где именно лежит максимум: на
   * силуэте мяча (r<1) или в ореоле вокруг него (1<r<2) */
  const edgeP = V3.clone(g._ballHome); edgeP.x += PH.R;
  const edge = g.project(edgeP, {});
  const rPx = Math.abs(edge.x - pb.x) * W;
  const dPx = bestK < 0 ? -1 : Math.hypot((bestK / 4) % W - pb.x * W, (bestK / 4 / W | 0) - (1 - pb.y) * H);
  return { hex: STROKES[sid].col, px, core, ringR: bestK < 0 ? -1 : +(dPx / rPx).toFixed(2),
    ballPx: +rPx.toFixed(1),
    lit: +(n / (W * H) * 1000).toFixed(2),
    meanAdd: n ? sum.map((v) => +(v / n).toFixed(1)) : [0, 0, 0], dcOn: on.dc, dcOff: off.dc };
})`;

async function run(browser, width, height, mobile, dpr, ids, ages, modes, shots) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: dpr });
  const frame = await appFrame(page);
  await frame.evaluate(() => {
    const g = window.__game;
    g.startMatch(2); g.setState(GS.RALLY); g.ball.live = true;
    g.updateCamera(4); g.updateCamera(0); g.paused = true;
  });
  const rows = [];
  for (const mode of modes) for (const id of ids) for (const age of ages) {
    const r = await frame.evaluate(`${PROBE}(${JSON.stringify(id)}, ${age}, ${JSON.stringify(mode)})`);
    const addHue = r.px ? hue(r.px.added.map((v) => v / 255)) : -1;
    rows.push({
      vp: `${width}x${height}`, mode, id, age: age.toFixed(2), hex: r.hex,
      want: `${hue(hexToRgb(r.hex))}/${sat(hexToRgb(r.hex))}`,
      got: `${addHue}/${r.px ? sat(r.px.added.map((v) => Math.max(0, v) / 255)) : 0}`,
      hueErr: r.px ? hueDist(hue(hexToRgb(r.hex)), addHue) : -1,
      peakAdd: r.px ? r.px.added.join(',') : '-', litPermille: r.lit, meanAdd: r.meanAdd.join(','), dc: r.dcOn,
      ballCore: r.core.base.join(',') + '+' + r.core.added.join(','),
      ringR: r.ringR, ballPx: r.ballPx,
    });
  }
  const bounds = await (await page.$('#gamelayer iframe')).boundingBox();
  for (const [tag, age] of shots) {
    const box = await frame.evaluate(`(() => { const g = window.__game; g.contactFlashes.length = 0;
      if (${age} >= 0) { function hx(h){const s=h.replace('#','');return [parseInt(s.slice(0,2),16)/255,parseInt(s.slice(2,4),16)/255,parseInt(s.slice(4,6),16)/255];}
        const c = hx(STROKES['LOOP'].col);
        g.contactFlashes.push({ side: 1, id: 'LOOP', p: V3.clone(g.ball.p), r: c[0], g: c[1], b: c[2],
          birth: g.time - CONTACT_FLASH_LIFE_S * ${age}, life: CONTACT_FLASH_LIFE_S }); }
      g.render();
      const r = g.canvas.getBoundingClientRect(), pr = g.project(g.ball.p, {});
      return { left: r.left + pr.x * r.width, top: r.top + pr.y * r.height };
    })()`);
    await page.screenshot({ path: path.join(__dirname, `flash-${tag}-${width}.png`),
      clip: { x: Math.round(bounds.x + box.left - 40), y: Math.round(bounds.y + box.top - 40), width: 80, height: 80 } });
  }
  if (shots.length) console.log('  zoom-кадры:', shots.map(([t]) => `flash-${t}-${width}.png`).join(', '));
  if (errs.length) console.error('PAGE ERRORS', width, errs);
  await page.close();
  return rows;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
      '--autoplay-policy=no-user-gesture-required'],
    headless: true,
  });
  const ids = ['DRIVE', 'LOOP', 'PUSH', 'BLOCK', 'SMASH', 'CHOP', 'SERVE_NO_SPIN', 'HOOK'];
  const out = [
    ...await run(browser, 1280, 760, false, 1, ids, [0, 0.4, 0.8], ['live'], [['peak', 0], ['mid', 0.4], ['tail', 0.8], ['none', -1]]),
    ...await run(browser, 390, 844, true, 2, ['LOOP', 'DRIVE', 'BLOCK', 'SMASH'], [0, 0.4], ['live'], []),
    ...await run(browser, 844, 390, true, 2, ['LOOP', 'DRIVE', 'BLOCK', 'PUSH'], [0, 0.4], ['live'], []),
    ...await run(browser, 1280, 760, false, 3, ['LOOP', 'BLOCK', 'CHOP'], [0, 0.8], ['free'], []),
  ];
  await browser.close();
  console.table(out);
  const invisible = out.filter((r) => r.litPermille <= 0);
  const washed = out.filter((r) => r.id !== 'BLOCK' && r.age === '0.00' && r.litPermille > 0 && (r.got.endsWith('/0') || r.hueErr > 45));
  const touchedBall = out.filter((r) => r.mode === 'live' && Number(r.ballCore.split('+')[1].split(',').reduce((a, v) => Math.max(a, Math.abs(+v)), 0)) > 4);
  console.log(invisible.length ? 'НЕВИДИМАЯ ПУЛЬСА: ' + JSON.stringify(invisible.map((r) => [r.vp, r.mode, r.id, r.age])) : 'пульса видна во всех замерах');
  console.log(washed.length ? 'ТОН ТЕРЯЕТСЯ: ' + JSON.stringify(washed.map((r) => [r.vp, r.id, r.want, r.got, r.hueErr])) : 'тон палитры читается в рендере');
  console.log(touchedBall.length ? 'ПУЛЬСА БЬЁТ ПО МЯЧУ: ' + JSON.stringify(touchedBall.map((r) => [r.vp, r.id, r.ballCore])) : 'ядро мяча не тронуто (глубина держит)');
}
main().catch((e) => { console.error(e); process.exit(1); });
