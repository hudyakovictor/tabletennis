/* =====================================================================
 *  HUB FX — интерактивный слой меню-хаба «ARENA HUB 2026».
 *
 *  Портировано из каталога Signal Arena (двигажок SA):
 *   · Spring (пружинная интеграция) — 3D-тилт голо-логотипа (ассет №01)
 *   · haptic() — Telegram HapticFeedback + vibrate-фолбэк (весь каталог)
 *   · roll() — числовой одометр валюты/счётчиков (ассет №25)
 *   · shake() — тряска контейнера на отказ (engine.js)
 *   · конфетти на DOM-частицах — финал победы (FX-система каталога)
 *  Плюс хабовая хореография: морфинг-пилюля соперников и вкладок
 *  мастерской (ассет №28), spotlight Bento-плиток (№39), статус LED
 *  онлайн-лобби (№81), каскад --i при входе списков.
 *
 *  Модуль — наблюдатель: он НЕ меняет навигацию и логику UI, а слушает
 *  DOM (MutationObserver/события) и добавляет движение. Отключение
 *  модуля возвращает игре прежнее поведение без единой правки.
 *  prefers-reduced-motion: все эффекты выключены, значения мгновенны.
 * ===================================================================== */
'use strict';

const HubFX = (() => {
  const RM = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  /* ------------------------------------------------- единый rAF-цикл */
  const tickers = new Set();
  let rafId = 0, lastT = 0;
  function loop(t) {
    rafId = 0;
    const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016); lastT = t;
    tickers.forEach(fn => { if (fn(dt, t) === false) tickers.delete(fn); });
    if (tickers.size) rafId = requestAnimationFrame(loop);
  }
  function tick(fn) { tickers.add(fn); if (!rafId) { lastT = 0; rafId = requestAnimationFrame(loop); } }

  /* ------------------------------------------- пружина (Signal Arena) */
  class Spring {
    constructor(v = 0, stiff = 170, damp = 18, mass = 1) {
      this.v = v; this.target = v; this.vel = 0; this.k = stiff; this.d = damp; this.m = mass;
    }
    set(t) { this.target = t; return this; }
    step(dt) {
      const f = -this.k * (this.v - this.target) - this.d * this.vel;
      this.vel += (f / this.m) * dt; this.v += this.vel * dt;
      if (Math.abs(this.vel) < .0008 && Math.abs(this.v - this.target) < .0008) { this.v = this.target; this.vel = 0; }
      return this.v;
    }
    get settled() { return this.vel === 0 && this.v === this.target; }
  }

  /* --------------------------------------- тактильная отдача (каталог) */
  const tg = window.Telegram && window.Telegram.WebApp;
  function haptic(kind) {
    kind = kind || 'light';
    try {
      const h = tg && tg.HapticFeedback;
      if (h) {
        if (['light', 'medium', 'heavy', 'rigid', 'soft'].indexOf(kind) >= 0) h.impactOccurred(kind);
        else if (['error', 'success', 'warning'].indexOf(kind) >= 0) h.notificationOccurred(kind);
        else h.selectionChanged();
        return;
      }
      if (navigator.vibrate) navigator.vibrate({ light: 8, medium: 14, heavy: 24, success: [10, 40, 16], error: [26, 50, 26] }[kind] || 8);
    } catch (e) { /* хаптика необязательна */ }
  }

  /* ------------------------------------------ одометр чисел (ассет 25) */
  function roll(node, from, to, dur, fmt) {
    fmt = fmt || (v => String(Math.round(v)));
    if (!node || from === to) { if (node) node.textContent = fmt(to); return; }
    if (RM) { node.textContent = fmt(to); return; }
    const t0 = performance.now(), ms = (dur || .7) * 1000;
    tick(() => {
      const t = clamp((performance.now() - t0) / ms, 0, 1);
      node.textContent = fmt(lerp(from, to, easeOut(t)));
      return t < 1;
    });
  }

  /* --------------------------------------------- тряска отказа (engine) */
  function shake(node, power, dur) {
    if (!node || RM) return;
    power = power || 7; const ms = (dur || .42) * 1000, t0 = performance.now();
    tick(() => {
      const t = clamp((performance.now() - t0) / ms, 0, 1);
      const p = power * (1 - t) * (1 - t);
      node.style.transform = 'translate(' + (Math.random() * 2 * p - p).toFixed(2) + 'px,' + (Math.random() * 2 * p - p).toFixed(2) + 'px)';
      if (t >= 1) { node.style.transform = ''; return false; }
      return true;
    });
  }

  function bump(node) {
    if (!node || RM) return;
    node.classList.remove('bumpfx'); void node.offsetWidth; node.classList.add('bumpfx');
  }

  /* ----------------------------------------- конфетти победы (FX-слой) */
  function confetti(n) {
    if (RM) return;
    const layer = $('#fxLayer'); if (!layer) return;
    const W = layer.clientWidth || innerWidth, H = layer.clientHeight || innerHeight;
    const cols = ['#39c6ff', '#7ff0c0', '#ffd166', '#ff7a2f', '#a78bfa', '#e6edf3'];
    const parts = [];
    for (let i = 0; i < (n || 90); i++) {
      const el = document.createElement('i');
      el.style.background = cols[i % cols.length];
      el.style.left = (Math.random() * W) + 'px';
      el.style.top = '-16px';
      layer.appendChild(el);
      parts.push({ el, x: 0, y: -16 - Math.random() * H * .35, vx: (Math.random() - .5) * 90, vy: 150 + Math.random() * 260, rot: Math.random() * 360, vr: (Math.random() - .5) * 540, sway: Math.random() * 6.28 });
    }
    tick((dt, t) => {
      let alive = false;
      for (const p of parts) {
        if (!p.el) continue;
        p.y += p.vy * dt; p.x += p.vx * dt + Math.sin(t / 280 + p.sway) * 34 * dt; p.rot += p.vr * dt;
        if (p.y > H + 24) { p.el.remove(); p.el = null; continue; }
        alive = true;
        p.el.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) rotate(' + p.rot.toFixed(0) + 'deg)';
        p.el.style.opacity = p.y > H - 130 ? String(clamp((H - p.y) / 130, 0, 1)) : '1';
      }
      return alive;
    });
  }

  /* ============================ 1. Голо-логотип (ассет №01) =========== */
  function initHolo() {
    const holo = $('#brandHolo'); if (!holo || RM) return;
    const rx = new Spring(0, 150, 16), ry = new Spring(0, 150, 16), fa = new Spring(0, 90, 20);
    let px = .5, py = .5, active = false;
    const menu = $('#menu');
    const onMove = e => {
      const r = holo.getBoundingClientRect(); if (!r.width) return;
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      px = clamp(x, -0.4, 1.4); py = clamp(y, -0.4, 1.4);
      ry.set((px - .5) * 14); rx.set((.5 - py) * 11); fa.set((px - .5) * 60);
      holo.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
      holo.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      if (!active) { active = true; start(); }
    };
    const onLeave = () => { rx.set(0); ry.set(0); fa.set(0); holo.style.setProperty('--gx', '50%'); holo.style.setProperty('--gy', '50%'); };
    function start() {
      tick(dt => {
        rx.step(dt); ry.step(dt); fa.step(dt);
        holo.style.setProperty('--rx', rx.v.toFixed(2) + 'deg');
        holo.style.setProperty('--ry', ry.v.toFixed(2) + 'deg');
        holo.style.setProperty('--fa', fa.v.toFixed(1) + 'deg');
        if (rx.settled && ry.settled && fa.settled) { active = false; return false; }
        return true;
      });
    }
    const host = menu || holo;
    host.addEventListener('pointermove', onMove, { passive: true });
    host.addEventListener('pointerleave', onLeave, { passive: true });
    /* гироскоп/наклон устройства — только если событие реально шлёт данные */
    window.addEventListener('deviceorientation', e => {
      if (e.gamma == null || !menu || !menu.classList.contains('on')) return;
      ry.set(clamp(e.gamma / 3.2, -10, 10)); rx.set(clamp((45 - (e.beta || 45)) / 4, -8, 8));
      if (!active) { active = true; start(); }
    }, { passive: true });
  }

  /* ================= 2. Spotlight Bento-плиток (ассет №39) ============ */
  function initSpotlight() {
    if (RM) return;
    document.addEventListener('pointermove', e => {
      const t = e.target && e.target.closest ? e.target.closest('.btile,.sitem') : null;
      if (!t) return;
      const r = t.getBoundingClientRect();
      t.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      t.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  /* ============ 3. Морфинг-пилюля: соперники + вкладки (№28) ========= */
  function morphPill(container, activeEl, vars) {
    if (!container || !activeEl) return;
    const cr = container.getBoundingClientRect(), r = activeEl.getBoundingClientRect();
    if (!r.width) return;
    container.style.setProperty(vars[0], (r.left - cr.left) + 'px');
    container.style.setProperty(vars[1], r.width + 'px');
  }
  function syncDifficulty() {
    const box = $('.menu-difficulty'); if (!box) return;
    box.style.setProperty('--dw', '0px'); // измерить без влияния старой пилюли
    morphPill(box, $('.opt.sel', box) || $('.opt', box), ['--dx', '--dw']);
  }
  function syncTabs() {
    const box = $('#workshop .tabs'); if (!box) return;
    morphPill(box, $('.tab.on', box) || $('.tab', box), ['--tx', '--tw']);
  }
  function initPills() {
    const diff = $('.menu-difficulty');
    if (diff) {
      new MutationObserver(syncDifficulty).observe(diff, { attributes: true, subtree: true, attributeFilter: ['class', 'aria-pressed'] });
    }
    const tabs = $('#workshop .tabs');
    if (tabs) new MutationObserver(syncTabs).observe(tabs, { attributes: true, subtree: true, attributeFilter: ['class'] });
    const menu = $('#menu'), ws = $('#workshop');
    if (menu) new MutationObserver(() => { if (menu.classList.contains('on')) requestAnimationFrame(syncDifficulty); }).observe(menu, { attributes: true, attributeFilter: ['class'] });
    if (ws) new MutationObserver(() => { if (ws.classList.contains('on')) requestAnimationFrame(syncTabs); }).observe(ws, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', () => { syncDifficulty(); syncTabs(); }, { passive: true });
    requestAnimationFrame(() => { syncDifficulty(); syncTabs(); });
  }

  /* ============ 4. Одометры: кошелёк и статус-полоса (№25) =========== */
  function watchNumber(id, chipEl) {
    const node = document.getElementById(id); if (!node) return;
    let cur = parseInt(node.textContent, 10) || 0, shown = cur;
    new MutationObserver(() => {
      const next = parseInt(node.textContent, 10) || 0;
      if (next === cur) return;
      /* переписываем текст сами анимацией — гасим рекурсию флагом значения */
      cur = next; const from = shown; shown = next;
      if (RM) { node.textContent = String(next); return; }
      const t0 = performance.now();
      tick(() => {
        const t = clamp((performance.now() - t0) / 650, 0, 1);
        node.textContent = String(Math.round(lerp(from, next, easeOut(t))));
        return t < 1;
      });
      bump(chipEl || node.parentElement);
      if (next > from) haptic('soft');
    }).observe(node, { childList: true, characterData: true, subtree: true });
    return () => cur;
  }
  function initWallet() {
    const getBal = watchNumber('wsBal', $('.wmon'));
    watchNumber('wsCry', $('.wcr'));
    /* статус-полоса хаба зеркалит #wsCoins/#wsStreak (80_ui их обновляет) */
    const coinsSrc = $('#wsCoins'), streakSrc = $('#wsStreak');
    const coinsVal = $('#hubCoinsVal'), streakVal = $('#hubStreakVal'), dailyBar = $('#hubDailyBar');
    let lastCoins = 0;
    function syncHub() {
      if (coinsSrc && coinsVal) {
        const n = parseInt(coinsSrc.textContent, 10) || 0;
        if (n !== lastCoins) { roll(coinsVal, lastCoins, n, .65); bump($('#hubCoins')); lastCoins = n; }
      }
      if (streakSrc) {
        if (streakVal) streakVal.textContent = streakSrc.textContent;
        const m = /(\d+)\s*\/\s*6/.exec(streakSrc.textContent || '');
        if (dailyBar && m) dailyBar.style.width = Math.round(parseInt(m[1], 10) / 6 * 100) + '%';
      }
    }
    if (coinsSrc) new MutationObserver(syncHub).observe(coinsSrc, { childList: true, characterData: true, subtree: true });
    if (streakSrc) new MutationObserver(syncHub).observe(streakSrc, { childList: true, characterData: true, subtree: true });
    const menu = $('#menu');
    if (menu) new MutationObserver(() => { if (menu.classList.contains('on')) syncHub(); }).observe(menu, { attributes: true, attributeFilter: ['class'] });
    syncHub();
    return getBal;
  }

  /* ================= 5. Тосты: тряска на отказ, хаптика =============== */
  function initToasts() {
    const t = $('#mnToast'); if (!t) return;
    new MutationObserver(() => {
      if (!t.classList.contains('on')) return;
      const s = t.textContent || '';
      if (/НЕ ХВАТАЕТ|НУЖНО .*КРИСТАЛЛОВ|ЧТО-ТО НЕ КУПЛЕНО|ОШИБКА/.test(s)) {
        shake($('.wallet') || $('#hubCoins')); haptic('error');
      } else if (/КУПЛЕНО|РАКЕТКА В ИГРЕ|\+.*МОНЕТ|ПОКУПКА ЗАЧТЕНА/.test(s)) haptic('success');
      else if (/СОПЕРНИК ВЫШЕЛ|РЕКЛАМА ОТКЛЮЧЕНА/.test(s)) haptic('warning');
    }).observe(t, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
  }

  /* ================= 6. Онлайн: LED-статус по тексту (№81) ============ */
  function initNet() {
    const st = $('#netStatus'), box = $('#netState'); if (!st || !box) return;
    const sync = () => {
      const s = st.textContent || '';
      box.dataset.state = /Ошибка/.test(s) ? 'err' : (/Подключено|хост|комнат/i.test(s) ? 'ok' : 'wait');
    };
    new MutationObserver(sync).observe(st, { childList: true, characterData: true, subtree: true });
    sync();
  }

  /* ============ 7. Каскад входов списков: индекс --i ================== */
  function staggerKids(container, sel) {
    if (!container) return;
    $$(sel, container).forEach((el, i) => { if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', Math.min(i, 14)); });
  }
  function initStagger() {
    const map = [
      ['#listBlade', '.irow'], ['#listFh', '.irow'], ['#listBh', '.irow'],
      ['#shopRackets', '.sitem'], ['#shopCosmetics', '.sitem'], ['#shopIap', '.sitem'],
      ['#momentList', '.mrow'], ['#taskList', '.trow'],
    ];
    for (const [cid, sel] of map) {
      const c = $(cid); if (!c) continue;
      new MutationObserver(() => staggerKids(c, sel)).observe(c, { childList: true });
      staggerKids(c, sel);
    }
    /* каскад блоков внутри каждого экрана при открытии */
    $$('.screen').forEach(sc => {
      const apply = () => $$('.rise', sc).forEach((el, i) => el.style.setProperty('--i', Math.min(i, 10)));
      new MutationObserver(() => { if (sc.classList.contains('on')) apply(); }).observe(sc, { attributes: true, attributeFilter: ['class'] });
      apply();
    });
  }

  /* ============ 8. Финал матча: конфетти + одометр статистики ======== */
  function initFinale() {
    const over = $('#over'); if (!over) return;
    let fired = false;
    new MutationObserver(() => {
      const on = over.classList.contains('on'), won = over.classList.contains('won');
      if (on && !fired) {
        fired = true;
        if (won) { confetti(110); haptic('success'); }
        else if (over.classList.contains('lost')) haptic('warning');
        ['stShots', 'stRally', 'stMaxSpeed', 'stMaxSpin', 'stAvgSpin'].forEach(id => {
          const n = document.getElementById(id); if (!n) return;
          const v = parseFloat(n.textContent); if (!isFinite(v) || v === 0) return;
          const dec = /\./.test(n.textContent) ? 1 : 0;
          roll(n, 0, v, .8, x => dec ? x.toFixed(dec) : String(Math.round(x)));
        });
      } else if (!on) fired = false;
    }).observe(over, { attributes: true, attributeFilter: ['class'] });
    const crEnd = $('#careerEnd');
    if (crEnd) {
      let f2 = false;
      new MutationObserver(() => {
        const on = crEnd.classList.contains('on') && crEnd.classList.contains('career-victory');
        if (on && !f2) { f2 = true; confetti(160); haptic('success'); }
        if (!crEnd.classList.contains('on')) f2 = false;
      }).observe(crEnd, { attributes: true, attributeFilter: ['class'] });
    }
  }

  /* ============ 9. Хаптика интерфейса: каждое нажатие ощущается ======= */
  function initHaptics() {
    document.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      if (b.id === 'play' || b.id === 'again' || b.id === 'crReady') { haptic('medium'); return; }
      if (b.classList.contains('btile')) { haptic('light'); return; }
      if (b.classList.contains('opt') || b.classList.contains('tab')) { haptic('sel'); return; }
      if (b.classList.contains('ic')) { haptic('light'); return; }
      haptic('light');
    }, { passive: true });
  }

  /* ============ 10. Telegram Mini App: тема и разворот ================ */
  function initTelegram() {
    if (!tg) return;
    try {
      tg.ready && tg.ready(); tg.expand && tg.expand();
      tg.setHeaderColor && tg.setHeaderColor('#05070c');
      tg.setBackgroundColor && tg.setBackgroundColor('#05070c');
    } catch (e) { /* не критично */ }
  }

  function init() {
    initTelegram(); initHolo(); initSpotlight(); initPills(); initWallet();
    initToasts(); initNet(); initStagger(); initFinale(); initHaptics();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  return { Spring, haptic, roll, shake, confetti, bump };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { HubFX };
