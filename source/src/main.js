/* =====================================================================
   MAIN — сплэш с прелоадом и загрузка приложения
   ===================================================================== */
const TIPS = [
  'Свайп вверх по экрану — удар. Чем быстрее, тем сильнее.',
  'Наклон свайпа задаёт кручение мяча.',
  'Серия побед ускоряет подъём по лиге.',
  'Сундуки открываются, даже когда приложение закрыто.',
  'Сезонный пропуск обновляется каждые 26 дней.'
];

Router.def('splash', {
  full: true, mood: 'violet',
  render() {
    const word = 'TABLE TENNIS';
    return `<div class="splash">
      <div class="sp-logo">
        <div class="sp-paddles"><span>${Art.paddle('#E8202A', 74, { rot: -20 })}</span><span>${Art.paddle('#1E6BFF', 74, { rot: -20 })}</span></div>
        <div class="sp-ball"></div>
        <div class="sp-t2">${[...word].map((c, i) => `<span class="ch" style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join('')}</div>
        <div class="sp-t1">Ultimate</div>
      </div>
      <div class="sp-bar"><div class="bar gold"><i id="spBar" style="--p:0;transition:width .25s linear"></i><span class="lbl" id="spPct">0%</span></div></div>
      <div class="sp-tip" id="spTip">${TIPS[0]}</div>
    </div>`;
  },
  mount(el) {
    // мяч ударяется о «стол» — частицы + хаптика
    setTimeout(() => { const r = el.querySelector('.sp-ball').getBoundingClientRect(); const d = $('#device').getBoundingClientRect(); FX.ring(r.left - d.left + r.width / 2, r.top - d.top + r.height, '#FFE28A'); haptic('rigid'); }, 500);
    setTimeout(() => { const r = el.querySelector('.sp-t2').getBoundingClientRect(); const d = $('#device').getBoundingClientRect(); FX.burst(r.left - d.left + r.width / 2, r.top - d.top + r.height / 2, { count: 40, c: ['#FF7A4D', '#FFE28A', '#fff'] }); }, 1500);
    // движок прогревается под заставкой, но после первых кадров логотипа: разбор игры — одна длинная задача
    const useGame = S.quality !== 'low', t0 = performance.now();
    if (useGame) setTimeout(() => { try { GameHost.ensure(); } catch (e) {} }, 450);
    let p = 0, ti = 0; const bar = $('#spBar', el), pct = $('#spPct', el), tip = $('#spTip', el);
    const tipT = setInterval(() => { ti = (ti + 1) % TIPS.length; tip.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 300 }); tip.textContent = TIPS[ti]; }, 2600);
    const step = () => {
      if (Router.cur !== 'splash') { clearInterval(tipT); return; }
      // полоса честная: последние 12% ждут готовности движка (но не дольше 9 с — дальше хаб сам догрузит)
      const engineOk = !useGame || GameHost.ready || performance.now() - t0 > 9000;
      p = Math.min(engineOk ? 100 : 88, p + rnd(4, 13)); bar.style.setProperty('--p', p / 100); pct.textContent = Math.round(p) + '%';
      if (p < 100) setTimeout(step, p >= 88 ? 60 : rnd(80, 190));
      else { clearInterval(tipT); setTimeout(() => Router.go('hub', { mode: 'wipe' }), 350); }
    };
    setTimeout(step, 1100);
  }
});

/* ---------- FPS-метр для dev-панели ---------- */
(function fps() {
  const el = $('#dpFps'); if (!el) return; let n = 0, t0 = performance.now();
  const loop = (t) => { n++; if (t - t0 > 1000) { el.textContent = Math.round(n * 1000 / (t - t0)) + ' fps'; n = 0; t0 = t; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();

/* ---------- boot ---------- */
function boot() {
  TGX.init();
  const mob = () => document.body.classList.toggle('mobile', TGX.inTG || matchMedia('(max-width:760px), (pointer:coarse) and (max-width:1100px)').matches);
  mob(); window.addEventListener('resize', mob);
  document.body.classList.toggle('rm', !!S.rm || matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.body.classList.toggle('in-tg', TGX.inTG);
  try { FX.init(); } catch (e) { console.error(e); }
  try { BG.init(); } catch (e) { console.error(e); }
  Nav.build(); Dev.build();
  setQuality(S.quality || 'high');
  const start = new URLSearchParams(location.search).get('s');
  if (start && Router.screens[start]) {
    if (start === 'result') Router.go('result', { data: Demo.result(true) });
    else if (start === 'chest') Router.go('chest', { data: { kind: 'gold' } });
    else Router.go(start);
  } else Router.go('splash');
  window.addEventListener('resize', () => { try { FX.resize(); BG.resize(); } catch (e) {} });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
// Telegram SDK грузится async — переинициализируем, когда появится
window.addEventListener('load', () => { if (TGX.w) TGX.init(); });
