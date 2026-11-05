/* =====================================================================
   MAIN — сплэш с прелоадом и загрузка приложения
   ===================================================================== */
Router.def('splash', {
  full: true, mood: 'violet',
  render: () => '',
  mount: () => Preloader.mount()
});

/* ---------- FPS-метр для dev-панели ---------- */
(function fps() {
  const el = $('#dpFps'); if (!el) return; let n = 0, t0 = performance.now();
  const loop = (t) => { n++; if (t - t0 > 1000) { el.textContent = Math.round(n * 1000 / (t - t0)) + ' fps'; n = 0; t0 = t; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();

/* ---------- boot ---------- */
let booted = false;
function boot() {
  if (booted) return; booted = true;
  TGX.init();
  I18n.init();            // язык: S.lang → Telegram language_code → браузер → ru
  Progress.watchSeason();
  const mob = () => document.body.classList.toggle('mobile', TGX.inTG || matchMedia('(max-width:760px), (pointer:coarse) and (max-width:1100px)').matches);
  mob(); window.addEventListener('resize', mob);
  document.body.classList.toggle('rm', !!S.rm || matchMedia('(prefers-reduced-motion: reduce)').matches);
  document.body.classList.toggle('in-tg', TGX.inTG);
  // SDK loading never gates offline boot or the splash/game route.
  TGX.load().then(() => { mob(); document.body.classList.toggle('in-tg', TGX.inTG); try { Progress.boot(); } catch (e) {} });
  try { FX.init(); } catch (e) { console.error(e); }
  try { BG.init(); } catch (e) { console.error(e); }
  Nav.build(); Dev.build();
  setQuality(S.quality || 'high');
  const start = new URLSearchParams(location.search).get('s');
  if (start && Router.screens[start]) {
    if (start !== 'splash') Preloader.cancel();
    if (start === 'result') Router.go('result', { data: Demo.result(true) });
    else if (start === 'chest') Router.go('chest', { data: { kind: 'gold' } });
    else Router.go(start, { mode: start === 'splash' ? 'instant' : 'auto' });
  } else if (/^[A-Za-z0-9]{5}$/.test(new URLSearchParams(location.search).get('room') || '')) {
    /* ссылка ?room=КОД ведёт сразу в онлайн-лобби: друг не ищет кнопку, а
     * команда join встанет в очередь GameHost и уйдёт движку, когда тот будет готов */
    Preloader.cancel(); Router.go('online');
  } else Router.go('splash', { mode: 'instant' });
  window.addEventListener('resize', () => { try { FX.resize(); BG.resize(); } catch (e) {} });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
window.addEventListener('pagehide', () => TGX.dispose());
window.addEventListener('pageshow', (e) => { if (e.persisted) TGX.load(); });
