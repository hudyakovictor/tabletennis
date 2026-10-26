'use strict';
/* =====================================================================
   CORE — состояние, Telegram, звук, хаптика, роутер, анимационные утилиты
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* ---------- состояние (переживает перезапуск, если доступно хранилище) ---------- */
/* Новый игрок — НОВЫЙ игрок: никакого вшитого «ветерана 2140». Рейтинг с
   нуля бывает только 1000, рекорд 0/0, серия и лучший розыгрыш — нулевые,
   уровень 1. Всё остальное зарабатывается матчами (см. form-сложность в
   scr_battle). */
const DEFAULT_STATE = {
  name: 'Anton Spin', nick: '@anton_tt', club: 'Spin Lab',
  coins: 1840, gems: 46, level: 1, xp: 0, xpMax: 1800,
  rating: 1000, wins: 0, losses: 0, streak: 0, bestRally: 0,
  form: [],
  passLvl: 7, passXp: 60, premium: false, claimed: { f: [1, 2, 3, 4, 5], p: [] },
  chests: [
    { id: 'c1', kind: 'silver', state: 'ready' },
    { id: 'c2', kind: 'gold', state: 'unlocking', endsAt: Date.now() + (2 * 3600 + 14 * 60) * 1000 },
    { id: 'c3', kind: 'epic', state: 'locked' },
    null
  ],
  owned: ['r-teal', 'b-ink', 't-coral'], equipped: { rubber: 'r-teal', blade: 'b-ink', trail: 't-coral' },
  sfx: true, music: true, vibro: true, rm: false, quality: 'high', assist: true, tutorial: true, hint: true, tutorialDone: false
};
const Store = {
  ok: (() => { try { const k = '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; } })(),
  load() { if (!this.ok) return null; try { return JSON.parse(localStorage.getItem('ttu-v2') || 'null'); } catch (e) { return null; } },
  save(s) { if (!this.ok) return; try { localStorage.setItem('ttu-v2', JSON.stringify(s)); } catch (e) {} }
};
const S = Object.assign(structuredClone(DEFAULT_STATE), Store.load() || {});
/* Миграция одним отпечатком: вшитый «ветеран» (2140 / 124-61 / ур. 12) — это
   стартовые данные старой сборки, а не заслуги игрока. Нетронутый фейк
   становится честным новичком; реально отыгранный профиль (любое поле
   изменено) не трогаем. */
if (S.rating === 2140 && S.wins === 124 && S.losses === 61 && S.level === 12 && S.xp === 1240) {
  Object.assign(S, { rating: 1000, wins: 0, losses: 0, streak: 0, bestRally: 0, level: 1, xp: 0 });
}
if (!Array.isArray(S.form)) S.form = [];
const save = () => Store.save(S);

/* ---------- Telegram WebApp (по спецификации Mini Apps) ---------- */
const TGX = {
  get w() { return window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null; },
  get inTG() { const w = this.w; return !!(w && w.platform && w.platform !== 'unknown'); },
  mob() { const w = this.w; return !!(w && ['android', 'ios'].includes(w.platform)); },
  /* safe-area = сумма системных вырезов (safeAreaInset) и интерфейса Telegram
     (contentSafeAreaInset); сверху и снизу считаем независимо */
  _insets() {
    const w = this.w; const c = (w && w.contentSafeAreaInset) || {}; const s = (w && w.safeAreaInset) || {};
    document.documentElement.style.setProperty('--tgt', ((c.top || 0) + (s.top || 0)) + 'px');
    document.documentElement.style.setProperty('--tgb', ((c.bottom || 0) + (s.bottom || 0)) + 'px');
    document.documentElement.style.setProperty('--tglr', ((c.left || 0) + (s.left || 0)) + 'px');
  },
  init() {
    const w = this.w; if (!w) return;
    try {
      w.ready(); w.expand();
      if (w.disableVerticalSwipes) w.disableVerticalSwipes();      // свайп-закрытие не должно ронять розыгрыш
      if (w.setHeaderColor) w.setHeaderColor('#05060F');
      if (w.setBackgroundColor) w.setBackgroundColor('#05060F');
      if (w.setBottomBarColor) w.setBottomBarColor('#05060F');
      this._insets();
      ['contentSafeAreaChanged', 'safeAreaChanged', 'fullscreenChanged', 'viewportChanged'].forEach((ev) => {
        try { w.onEvent && w.onEvent(ev, () => this._insets()); } catch (e) {}
      });
      if (w.BackButton) w.BackButton.onClick(() => Router.back());
      const u = w.initDataUnsafe && w.initDataUnsafe.user;
      if (u && u.first_name) { S.name = (u.first_name + ' ' + (u.last_name || '')).trim(); if (u.username) S.nick = '@' + u.username; }
    } catch (e) {}
  },
  back(show) { const w = this.w; if (!w || !w.BackButton) return; try { show ? w.BackButton.show() : w.BackButton.hide(); } catch (e) {} },
  /* иммерсивный полноэкранный режим. Вход — только по жесту пользователя
     (только так клиенты его принимают); вызываем из обработчика «В бой». */
  fullscreen(on) {
    const w = this.w; if (!w || !this.inTG) return;
    try {
      if (on) {
        if (!w.isFullscreen && w.requestFullscreen) w.requestFullscreen();
        // lockOrientation фиксирует ТЕКУЩУЮ ориентацию — лочим только в портрете,
        // иначе зафиксируем случайный ландшафт. Десктопу ориентацию не трогаем.
        if (this.mob() && w.lockOrientation && !w.isOrientationLocked && window.innerHeight >= window.innerWidth) {
          setTimeout(() => { try { w.lockOrientation(); } catch (e) {} }, 150);
        }
      } else {
        if (this.mob() && w.unlockOrientation && w.isOrientationLocked) { try { w.unlockOrientation(); } catch (e) {} }
        if (w.isFullscreen && w.exitFullscreen) { try { w.exitFullscreen(); } catch (e) {} }
      }
    } catch (e) {}
  },
  /* защита от случайного закрытия во время матча/обучения (Bot API 7.10+) */
  guard(on) {
    const w = this.w; if (!w) return;
    try { if (on) { if (w.enableClosingConfirmation) w.enableClosingConfirmation(); } else if (w.disableClosingConfirmation) w.disableClosingConfirmation(); } catch (e) {}
  }
};

/* ---------- хаптика ---------- */
function haptic(kind = 'light') {
  if (!S.vibro) return;
  const w = TGX.w;
  try {
    if (w && w.HapticFeedback && TGX.inTG) {
      if (kind === 'success' || kind === 'error' || kind === 'warning') w.HapticFeedback.notificationOccurred(kind);
      else if (kind === 'select') w.HapticFeedback.selectionChanged();
      else w.HapticFeedback.impactOccurred(kind); // light | medium | heavy | rigid | soft
    } else if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
      // браузер блокирует вибрацию до первого касания и пишет предупреждение в консоль — не дёргаем зря
      navigator.vibrate({ light: 6, select: 4, soft: 8, medium: 14, rigid: 10, heavy: 24, success: [10, 40, 18], error: [24, 40, 24], warning: 16 }[kind] || 8);
    }
  } catch (e) {}
}

/* ---------- синтез звука (WebAudio, без файлов) ---------- */
const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = .55;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * .5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { return false; }
  }
  const ok = () => S.sfx && ensure();
  function tone(freq, dur, { type = 'sine', vol = .3, slide = 0, delay = 0, attack = .004 } = {}) {
    const t = ctx.currentTime + delay; const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + .02);
  }
  function noise(dur, { f = 2000, q = 1, vol = .3, type = 'bandpass', delay = 0, sweep = 0 } = {}) {
    const t = ctx.currentTime + delay; const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (sweep) fl.frequency.exponentialRampToValueAtTime(f * sweep, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + dur + .02);
  }
  return {
    unlock: ensure,
    tap() { if (!ok()) return; tone(880, .06, { type: 'triangle', vol: .18, slide: 1.4 }); },
    soft() { if (!ok()) return; tone(520, .07, { type: 'sine', vol: .14, slide: 1.2 }); },
    tab() { if (!ok()) return; tone(660, .08, { type: 'triangle', vol: .16, slide: 1.5 }); tone(990, .06, { type: 'sine', vol: .08, delay: .03 }); },
    paddle(p = 1) { if (!ok()) return; noise(.05, { f: 2600 * p, q: 2.5, vol: .5 }); tone(1150 * p, .07, { type: 'sine', vol: .28, slide: .6 }); },
    table() { if (!ok()) return; noise(.03, { f: 3800, q: 3, vol: .32 }); tone(720, .06, { type: 'sine', vol: .22, slide: .7 }); },
    net() { if (!ok()) return; noise(.12, { f: 900, q: .8, vol: .3, type: 'lowpass' }); },
    whoosh() { if (!ok()) return; noise(.32, { f: 500, q: .9, vol: .35, sweep: 6 }); },
    smash() { if (!ok()) return; noise(.08, { f: 3000, q: 1.5, vol: .7 }); tone(160, .3, { type: 'sine', vol: .5, slide: .4 }); noise(.4, { f: 600, q: .7, vol: .3, sweep: 5, delay: .02 }); },
    coin(i = 0) { if (!ok()) return; const b = 1320 * Math.pow(1.06, i % 6); tone(b, .09, { type: 'square', vol: .06 }); tone(b * 1.5, .16, { type: 'triangle', vol: .12, delay: .05 }); },
    gem(i = 0) { if (!ok()) return; tone(1760 * Math.pow(1.05, i % 5), .2, { type: 'sine', vol: .14 }); tone(2640, .14, { type: 'sine', vol: .06, delay: .04 }); },
    impact() { if (!ok()) return; tone(110, .45, { type: 'sine', vol: .7, slide: .35 }); noise(.25, { f: 400, q: .6, vol: .45, type: 'lowpass' }); },
    point() { if (!ok()) return; [784, 988, 1318].forEach((f, i) => tone(f, .22, { type: 'triangle', vol: .2, delay: i * .07 })); },
    lose() { if (!ok()) return; [440, 370, 294].forEach((f, i) => tone(f, .26, { type: 'triangle', vol: .18, delay: i * .1 })); },
    win() { if (!ok()) return; [523, 659, 784, 1046, 1318].forEach((f, i) => { tone(f, .35, { type: 'triangle', vol: .2, delay: i * .09 }); tone(f / 2, .35, { type: 'sine', vol: .1, delay: i * .09 }); }); },
    tick() { if (!ok()) return; tone(1400, .03, { type: 'square', vol: .05 }); },
    count(n) { if (!ok()) return; tone(n ? 660 : 1320, n ? .18 : .45, { type: 'triangle', vol: .28 }); },
    rise(d = .8) { if (!ok()) return; tone(300, d, { type: 'sawtooth', vol: .05, slide: 4 }); noise(d, { f: 400, q: 2, vol: .1, sweep: 8 }); },
    reveal(r = 0) { if (!ok()) return; const base = [880, 988, 1175, 1568][r]; [0, .08, .16].forEach((d, i) => tone(base * [1, 1.25, 1.5][i], .4, { type: 'sine', vol: .16, delay: d })); noise(.6, { f: 6000, q: 1, vol: .12, type: 'highpass' }); },
    swoosh() { if (!ok()) return; noise(.22, { f: 1200, q: 1.2, vol: .25, sweep: .3 }); },
    hold(p) { if (!ok()) return; tone(400 + p * 800, .05, { type: 'triangle', vol: .06 }); },
    error() { if (!ok()) return; tone(220, .12, { type: 'square', vol: .1 }); tone(180, .16, { type: 'square', vol: .1, delay: .1 }); }
  };
})();

/* ---------- кнопки: нажатие = звук + хаптика + сжатие ---------- */
document.addEventListener('pointerdown', (e) => {
  Sfx.unlock();
  const b = e.target.closest('.b3,.ib,[data-press]');
  if (b) { b.classList.add('pressed'); haptic('light'); }
}, { passive: true });
const unpress = () => $$('.pressed').forEach((b) => b.classList.remove('pressed'));
document.addEventListener('pointerup', unpress, { passive: true });
document.addEventListener('pointercancel', unpress, { passive: true });
document.addEventListener('click', (e) => {
  const b = e.target.closest('.b3,.ib,[data-press]');
  if (b && !b.hasAttribute('data-silent')) Sfx.tap();
}, true);

/* ---------- числовой тикер с «подпрыгиванием» ---------- */
function tickNumber(el, from, to, dur = 900, { prefix = '', suffix = '', onTick } = {}) {
  if (!el) return Promise.resolve();
  return new Promise((res) => {
    const t0 = performance.now(); let last = from, tickK = 0;
    const step = (now) => {
      const t = clamp((now - t0) / dur, 0, 1); const v = Math.round(lerp(from, to, easeOut(t)));
      if (v !== last) { el.textContent = prefix + fmt(v) + suffix; last = v; if (onTick && (tickK = (tickK || 0) + 1) % 3 === 0) onTick(v); }
      if (t < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}
function bump(el, cls = 'bump') { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

/* ---------- toast ---------- */
function toast(html, icon = 'star') {
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<span class="ti">${Art.icon(icon)}</span><span>${html}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, 2200);
}

/* ---------- полноэкранная вспышка ---------- */
function flash(color = '#fff', peak = .55, dur = 380) {
  const f = $('#flash'); f.style.background = color;
  f.animate([{ opacity: peak }, { opacity: 0 }], { duration: dur, easing: 'cubic-bezier(.16,1,.3,1)' });
}

/* ---------- bottom sheet ---------- */
const Sheet = {
  cur: null,
  open(html, { onOpen, cls = '' } = {}) {
    this.close(true);
    const w = document.createElement('div'); w.className = 'sheet-wrap';
    w.innerHTML = `<div class="scrim"></div><div class="sheet ${cls}"><div class="grab"></div><div class="sbody">${html}</div></div>`;
    $('#sheets').appendChild(w); this.cur = w;
    requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('open')));
    w.querySelector('.scrim').addEventListener('click', () => this.close());
    // свайп вниз для закрытия
    const sh = w.querySelector('.sheet'); let y0 = null, dy = 0;
    sh.addEventListener('pointerdown', (e) => { if (e.target.closest('.sbody') && w.querySelector('.sbody').scrollTop > 0) return; y0 = e.clientY; dy = 0; sh.style.transition = 'none'; });
    sh.addEventListener('pointermove', (e) => { if (y0 === null) return; dy = Math.max(0, e.clientY - y0); sh.style.transform = `translateY(${dy}px)`; });
    const end = () => { if (y0 === null) return; y0 = null; sh.style.transition = ''; sh.style.transform = ''; if (dy > 110) this.close(); };
    sh.addEventListener('pointerup', end); sh.addEventListener('pointercancel', end);
    Sfx.swoosh(); haptic('soft');
    TGX.back(true);
    onOpen && onOpen(w);
    return w;
  },
  close(instant) {
    const w = this.cur; if (!w) return; this.cur = null;
    if (instant) { w.remove(); return; }
    w.classList.add('closing'); setTimeout(() => w.remove(), 300);
    TGX.back(Router.stack.length > 1);
  }
};

/* ---------- роутер с хореографией переходов ---------- */
const Router = {
  screens: {}, cur: null, stack: [], busy: false,
  TABS: ['shop', 'pass', 'hub', 'ranks', 'profile'],
  def(id, d) { this.screens[id] = d; },
  async go(id, { mode = 'auto', data = null, replace = false } = {}) {
    if (this.busy) return; const d = this.screens[id]; if (!d) return;
    if (Sheet.cur) Sheet.close(true);
    this.busy = true;
    const prev = this.cur; const prevD = prev && this.screens[prev];
    const host = $('#screens');
    if (mode === 'auto') mode = (this.TABS.includes(id) && this.TABS.includes(prev)) ? 'tab' : (d.full || (prevD && prevD.full) ? 'wipe' : 'push');
    if (mode === 'wipe') await Wipe.cover();
    const el = document.createElement('section'); el.className = 'screen'; el.dataset.id = id;
    el.innerHTML = d.render(data);
    const oldEl = host.querySelector('.screen.current');
    host.appendChild(el);
    if (prevD && prevD.leave) try { prevD.leave(); } catch (e) { console.error(e); }
    BG.mood(d.mood || 'arena');
    Nav.show(!d.full); Nav.set(this.TABS.includes(id) ? id : null);
    if (mode === 'tab' && oldEl) {
      const dir = this.TABS.indexOf(id) > this.TABS.indexOf(prev) ? 1 : -1;
      el.animate([{ transform: `translateX(${dir * 38}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' });
      oldEl.animate([{ transform: 'none', opacity: 1 }, { transform: `translateX(${-dir * 24}%) scale(.96)`, opacity: 0 }], { duration: 340, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
      Sfx.tab();
    } else if (mode === 'push' && oldEl) {
      el.animate([{ transform: 'translateY(6%) scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: 'cubic-bezier(.16,1,.3,1)' });
      oldEl.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(1.03)' }], { duration: 260, fill: 'forwards' });
    }
    el.classList.add('current'); if (oldEl) oldEl.classList.remove('current');
    requestAnimationFrame(() => el.classList.add('live'));
    if (replace && this.stack.length) this.stack[this.stack.length - 1] = id;
    else if (this.TABS.includes(id)) this.stack = [id];
    else this.stack.push(id);
    this.cur = id;
    try { d.mount && d.mount(el, data); } catch (e) { console.error(e); }
    TGX.back(this.stack.length > 1 && !this.TABS.includes(id));
    Dev.mark(id);
    setTimeout(() => { if (oldEl) oldEl.remove(); }, mode === 'wipe' ? 0 : 500);
    if (mode === 'wipe') await Wipe.reveal();
    this.busy = false;
  },
  back() {
    if (Sheet.cur) { Sheet.close(); return; }
    const d = this.screens[this.cur]; if (d && d.onBack) { d.onBack(); return; }
    if (this.stack.length > 1) { this.stack.pop(); const id = this.stack.pop(); this.go(id); }
    else if (this.cur !== 'hub') this.go('hub');
  }
};

const Wipe = {
  el: null,
  cover() {
    const w = this.el || (this.el = $('#wipe'));
    w.className = 'on in'; Sfx.whoosh(); haptic('medium');
    return sleep(S.rm ? 10 : 520);
  },
  reveal() {
    const w = this.el; w.className = 'on outw';
    return sleep(S.rm ? 10 : 560).then(() => { w.className = ''; });
  }
};

/* ---------- нижняя навигация ---------- */
const Nav = {
  /* Четыре вкладки по запросу: Главная / Турниры / Магазин / Настройки.
   * «Настройки» — кнопка-ярлык, не маршрут: она открывает лист настроек
   * поверх текущего экрана и не снимает подсветку с активной вкладки. */
  items: [
    { id: 'hub', l: 'Главная', i: 'navArena' },
    { id: 'pass', l: 'Турниры', i: 'navPass' },
    { id: 'shop', l: 'Магазин', i: 'navShop' },
    { id: 'settings', l: 'Настройки', i: 'navGear', sheet: true }
  ],
  build() {
    const n = $('#nav');
    n.innerHTML = '<div class="navbg"></div>' + this.items.map((t) => `
      <button class="tab" data-tab="${t.id}" aria-label="${t.l}" data-silent>
        <span class="glow"></span><span class="ti">${Art.navIcon(t.i)}</span><span class="tl">${t.l}</span>
      </button>`).join('');
    n.addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      haptic('select');
      /* «Настройки» — лист поверх текущего экрана: маршрут не меняем,
       * вкладку не подсвечиваем (set() знает только реальные экраны) */
      if (b.dataset.tab === 'settings') { openSettings(); Sfx.tab(); return; }
      if (b.dataset.tab === Router.cur) { const sc = $('.screen.current .scroll'); sc && sc.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      Router.go(b.dataset.tab);
    });
    this.dots();
  },
  /* бадж «Пропуска» = число реально доступных наград (не зашитая константа):
     при открытии приложения и после каждого клейма пересчитывается */
  dots() {
    if (typeof PASS === 'undefined') return;
    let n = 0;
    for (const r of PASS) {
      if (r.l <= S.passLvl && !S.claimed.f.includes(r.l)) n++;
      if (S.premium && r.l <= S.passLvl && !S.claimed.p.includes(r.l)) n++;
    }
    const t = $('#nav .tab[data-tab=pass]'); if (!t) return;
    let d = t.querySelector('.dot');
    if (n > 0) { if (!d) { d = document.createElement('span'); d.className = 'dot'; t.appendChild(d); } d.textContent = String(n); }
    else if (d) d.remove();
  },
  set(id) { $$('#nav .tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id)); },
  show(on) { $('#nav').classList.toggle('hide', !on); }
};

/* ---------- dev-панель (только десктоп) ---------- */
const Dev = {
  list: [
    ['splash', 'Загрузка'], ['hub', 'Арена (хаб)'], ['mm', 'Поиск соперника'], ['vs', 'VS-экран'], ['match', 'Матч (играбельный)'], ['train', 'Обучение'],
    ['result', 'Победа'], ['result-lose', 'Поражение'], ['chest', 'Открытие сундука'], ['shop', 'Магазин'], ['pass', 'Сезонный пропуск'],
    ['ranks', 'Рейтинг'], ['profile', 'Профиль']
  ],
  build() {
    const l = $('#dpList'); if (!l) return;
    l.innerHTML = this.list.map(([id, t]) => `<button data-go="${id}">${t}</button>`).join('');
    l.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const id = b.dataset.go;
      if (id === 'result') Router.go('result', { data: Demo.result(true) });
      else if (id === 'result-lose') Router.go('result', { data: Demo.result(false) });
      else if (id === 'chest') Router.go('chest', { data: { kind: 'gold' } });
      else Router.go(id);
    });
    $$('[data-dev]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.dev; const dev = $('#device').getBoundingClientRect();
      const c = { x: dev.width / 2, y: dev.height / 2 };
      if (k === 'coins') Wallet.add('coins', 120, c);
      if (k === 'confetti') FX.confetti(c.x, dev.height * .3, 120);
      if (k === 'shake') FX.shake(16, 500);
      if (k === 'lvl') LevelUp.show(S.level + 1);
      if (k === 'train') Router.go('train', { data: { then: 'hub' } });
      if (k === 'zone') devZoneSheet();
      if (k === 'zstats') zoneStatsSheet();
    }));
    $$('#dpQuality button').forEach((b) => b.addEventListener('click', () => { setQuality(b.dataset.q); }));
    this.syncQ();
  },
  syncQ() { $$('#dpQuality button').forEach((b) => b.classList.toggle('on', b.dataset.q === S.quality)); },
  mark(id) { $$('#dpList button').forEach((b) => b.classList.toggle('on', b.dataset.go === id)); }
};

function setQuality(q) {
  S.quality = q; save();
  document.body.classList.toggle('q-low', q === 'low');
  BG.setQuality(q); FX.setQuality(q); Dev.syncQ();
  if (typeof GameHost !== 'undefined' && GameHost.frame) GameHost.send('quality', { q });
}

/* ---------- демо-данные ---------- */
const PEOPLE = [
  { n: 'Максим Дорохов', s: 'М. Дорохов', r: 2210, c: ['#2EC9FF', '#1A3FA8'], club: 'Spin Lab', wr: 71 },
  { n: 'Анна Коваль', s: 'А. Коваль', r: 2195, c: ['#FF7AD9', '#7A1FA8'], club: 'Arena 4', wr: 64 },
  { n: 'Влад Соколов', s: 'В. Соколов', r: 2170, c: ['#7CFF8A', '#127A3A'], club: 'Topspin', wr: 58 },
  { n: 'Игорь Петров', s: 'И. Петров', r: 2050, c: ['#FFC93A', '#A8531F'], club: 'Arena 2', wr: 52 },
  { n: 'Тимур Сафин', s: 'Т. Сафин', r: 1990, c: ['#B48CFF', '#3B1FA8'], club: 'Kazan PP', wr: 49 },
  { n: 'Дарья Мороз', s: 'Д. Мороз', r: 2320, c: ['#7DF3FF', '#0E6A8A'], club: 'Ice Spin', wr: 66 },
  { n: 'Роман Ким', s: 'Р. Ким', r: 2080, c: ['#FF9A6B', '#A81F2A'], club: 'Seoul Club', wr: 55 },
  { n: 'Lee Jun', s: 'Lee Jun', r: 2410, c: ['#FFE680', '#A86A00'], club: 'Busan', wr: 74 }
];
const ME_COL = ['#FF7A4D', '#B4161E'];
const LEAGUES = [
  { id: 'bronze', n: 'Бронза', min: 900, c: ['#E3A06B', '#8A4A1F'] },
  { id: 'silver', n: 'Серебро', min: 1400, c: ['#E6EEFF', '#7B8BB0'] },
  { id: 'gold', n: 'Золото', min: 1800, c: ['#FFE680', '#C47A00'] },
  { id: 'pro', n: 'Лига Про', min: 2100, c: ['#7DF3FF', '#0A6FC2'] },
  { id: 'super', n: 'Суперлига', min: 2400, c: ['#D3B5FF', '#5320C9'] },
  { id: 'legend', n: 'Легенда', min: 2700, c: ['#FFB199', '#C2122A'] }
];
const leagueOf = (r) => { let L = LEAGUES[0]; for (const l of LEAGUES) if (r >= l.min) L = l; return L; };
const nextLeague = (r) => LEAGUES.find((l) => l.min > r) || null;
