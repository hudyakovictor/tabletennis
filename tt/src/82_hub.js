/* =====================================================================
 *  82_hub.js — ЕДИНЫЙ МЕНЮ-ХАБ + motion-система.
 *
 *  Меню перестало быть россыпью карточек: одна оболочка (#hub) с шапкой,
 *  сценой, доком и шторкой. Внутри сцены живут те же экраны, но теперь
 *  между ними один общий язык движения: пружина, каскад, морфинг,
 *  тактильный отклик.
 *
 *  Всё, что двигается, — трансформы и прозрачность. Один rAF на весь хаб.
 *  prefers-reduced-motion выключает декоративное, но не логику.
 * ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
 *  Пружина. Критически задемпфированная по умолчанию: без перелётов,
 *  без «резинового» хвоста — интерфейс должен останавливаться точно.
 * ------------------------------------------------------------------- */
class HubSpring {
  constructor(value = 0, opts = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = opts.stiffness != null ? opts.stiffness : 190;
    this.damping = opts.damping != null ? opts.damping : 26;
    this.mass = opts.mass != null ? opts.mass : 1;
    this.precision = opts.precision != null ? opts.precision : 0.35;
    this.onUpdate = opts.onUpdate || null;
    this.onRest = opts.onRest || null;
    this.resting = true;
  }
  set(v) { this.value = v; this.velocity = 0; this.target = v; }
  to(v) { if (v !== this.target) { this.target = v; this.resting = false; } }
  /** Один шаг интегратора. true — пружина в покое. */
  step(dt) {
    if (this.resting) return true;
    const d = Math.min(Math.max(dt, 0), 1 / 30);
    const force = -this.stiffness * (this.value - this.target);
    const damper = -this.damping * this.velocity;
    const accel = (force + damper) / this.mass;
    this.velocity += accel * d;
    this.value += this.velocity * d;
    if (Math.abs(this.value - this.target) < this.precision && Math.abs(this.velocity) < this.precision) {
      this.value = this.target;
      this.velocity = 0;
      this.resting = true;
      if (this.onUpdate) this.onUpdate(this.value);
      if (this.onRest) this.onRest();
      return true;
    }
    if (this.onUpdate) this.onUpdate(this.value);
    return false;
  }
}

/* ---------------------------------------------------------------------
 *  Тикер: один rAF на все анимации хаба. Спит, когда никто не двигается.
 * ------------------------------------------------------------------- */
class HubTicker {
  constructor() { this.subs = new Set(); this.raf = 0; this.last = 0; }
  add(fn) { this.subs.add(fn); this.start(); return () => this.subs.delete(fn); }
  start() {
    if (this.raf) return;
    this.last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const loop = (t) => {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      const dt = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      for (const fn of Array.from(this.subs)) {
        try { fn(dt, now); } catch (err) { console.error('hub ticker', err); }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
}

/* ---------------------------------------------------------------------
 *  Мелкие чистые функции — их можно тестировать без браузера.
 * ------------------------------------------------------------------- */
function hubEaseOut(t) { return 1 - Math.pow(1 - t, 3); }
function hubEaseInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
function hubClamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function hubLerp(a, b, t) { return a + (b - a) * t; }

/** Перемешивание букв для «дешифратора» заголовка. */
function hubScrambleFrame(text, progress, seed = 1) {
  const n = text.length;
  const out = [];
  let s = (seed >>> 0) || 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const r = (s / 4294967296);
    const ch = text[i];
    if (ch === ' ' || ch === '·' || ch === '—' || ch === '/') { out.push(ch); continue; }
    const threshold = progress * 1.35;
    out.push(r < threshold ? ch : HUB_GLYPHS[Math.floor(r * HUB_GLYPHS.length) % HUB_GLYPHS.length]);
  }
  return out.join('');
}
const HUB_GLYPHS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ01▓▒░/\\|<>';

/** Каскад: индексы задержек для детей контейнера. */
function hubStaggerIndices(count, step = 34, cap = 12) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(Math.min(i, cap) * step);
  return out;
}

/* ---------------------------------------------------------------------
 *  MENU HUB
 * ------------------------------------------------------------------- */
class MenuHub {
  constructor(ui) {
    this.ui = ui;
    this.game = null;
    this.ticker = new HubTicker();
    this.root = document.getElementById('hub');
    this.stage = document.getElementById('hubStage');
    this.dock = document.getElementById('hubDock');
    this.pill = document.getElementById('dockPill');
    this.drawer = document.getElementById('hubDrawer');
    this.live = document.getElementById('hubLive');
    this.activeId = null;
    this.drawerOpen = false;
    this.pending = null;
    this.reduced = false;
    this.motionQuery = (typeof window !== 'undefined' && window.matchMedia)
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._springs = [];
    this._binds = [];
    this._rafUnlock = null;
    if (this.motionQuery) {
      const apply = (e) => { this.reduced = !!e.matches; };
      this.reduced = !!this.motionQuery.matches;
      if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', apply);
      else if (this.motionQuery.addListener) this.motionQuery.addListener(apply);
    }
    if (this.root) this.build();
  }

  /* ------------------------- построение ------------------------- */

  attach(game) {
    this.game = game;
    this.sync();
    return this;
  }

  build() {
    if (!this.root) return;
    this.root.setAttribute('aria-hidden', 'true');
    this.bindDock();
    this.bindDrawer();
    this.bindRipples();
    this.bindSpotlight();
    this.observeViews();
    this.prepareStagger();
  }

  /** Индексы каскада проставляются один раз — потом CSS сам их читает. */
  prepareStagger() {
    const views = document.querySelectorAll('#hubStage .screen .card');
    views.forEach((card) => {
      Array.from(card.children).forEach((child, i) => {
        child.style.setProperty('--i', String(Math.min(i, 12)));
      });
    });
  }

  /** Следим за тем, какой экран включён: источник истины — класс .on. */
  observeViews() {
    if (typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver((records) => {
      if (this._syncing) return;
      /* Реагируем только на смену класса у экранов: любые другие
         переключения классов в игре (счёт, волны, частицы) — не наше дело. */
      for (const r of records) {
        const t = r.target;
        if (t && t.classList && t.classList.contains('screen')) { this.sync(); return; }
      }
    });
    this.observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  /* --------------------------- навигация -------------------------- */

  /** Экран, который сейчас открыт (последний .screen с .on). */
  currentView() {
    const screens = Array.from(document.querySelectorAll('#hubStage .screen.on'));
    return screens.length ? screens[screens.length - 1] : null;
  }

  /** Синхронизация оболочки с состоянием экранов. */
  sync() {
    const view = this.currentView();
    const id = view ? view.id : null;
    if (id === this.activeId) { this.updateMode(); return; }
    const prev = this.activeId;
    this.activeId = id;
    this.root.classList.toggle('on', !!id);
    this.root.setAttribute('aria-hidden', id ? 'false' : 'true');
    if (id) {
      this.root.dataset.view = id;
      this.onViewEnter(view, prev);
    } else {
      this.onViewLeave(prev);
    }
    this.updateMode();
    this.updateDock();
  }

  onViewEnter(view, prevId) {
    if (!view) return;
    view.classList.add('hub-enter');
    if (this.reduced) { view.classList.remove('hub-enter'); return; }
    // Каскад перезапускается на каждом входе: снимаем и возвращаем класс.
    void view.offsetWidth;
    view.classList.add('hub-enter');
    const title = view.querySelector('.logo, .hub-view-title');
    if (title && !title.dataset.scrambled) {
      title.dataset.scrambled = '1';
      this.scramble(title, title.textContent);
    }
    /* Скринридер должен знать, куда мы попали: имя раздела — в aria-label. */
    const label = view.getAttribute('aria-label') || (title && title.textContent) || '';
    if (label) this.announce(label);
  }

  onViewLeave(prevId) {
    if (prevId) {
      const prev = document.getElementById(prevId);
      if (prev) prev.classList.remove('hub-enter');
    }
  }

  /** Режим оболочки: док виден не везде. */
  updateMode() {
    const id = this.activeId;
    let mode = 'menu';
    if (id === 'shotLab') mode = 'tech';
    else if (id === 'over') mode = 'result';
    else if (id === 'tdone') mode = 'result';
    else if (!id) mode = 'hidden';
    this.root.dataset.mode = mode;
    this.root.classList.toggle('mode-tech', mode === 'tech');
    this.root.classList.toggle('mode-result', mode === 'result');
    const top = document.getElementById('hubTop');
    if (top) top.hidden = mode === 'tech';
  }

  /** Открыть конкретный экран хаба. */
  go(id) {
    const target = document.getElementById(id);
    if (!target) return false;
    document.querySelectorAll('#hubStage .screen').forEach((s) => s.classList.remove('on'));
    target.classList.add('on');
    this.sync();
    return true;
  }

  /** Закрыть хаб (вернуться в игру / паузу). */
  close() {
    document.querySelectorAll('#hubStage .screen').forEach((s) => s.classList.remove('on'));
    this.sync();
  }

  /* ----------------------------- док ------------------------------ */

  bindDock() {
    if (!this.dock) return;
    this.dock.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.ui && this.ui.game && this.ui.game.audio && this.ui.game.audio.ui('click');
        const id = btn.dataset.view;
        if (id === 'career') {
          this.ui && this.ui.openCareer && this.ui.openCareer();
          return;
        }
        if (id === 'workshop') {
          this.ui && this.ui.openWorkshop && this.ui.openWorkshop('racket');
          return;
        }
        if (id === 'online') {
          this.ui && this.ui.openOnline && this.ui.openOnline();
          return;
        }
        this.go(id);
      });
    });
    this.dock.querySelectorAll('[data-drawer]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.ui && this.ui.game && this.ui.game.audio && this.ui.game.audio.ui('click');
        this.toggleDrawer();
      });
    });
    /* Пилюля — пружина, а не CSS-переход: активный пункт «переезжает». */
    if (this.pill) {
      this.pillX = new HubSpring(0, { stiffness: 220, damping: 24 });
      this.pillW = new HubSpring(0, { stiffness: 220, damping: 24 });
      this.pillX.onUpdate = (v) => { this.pill.style.transform = 'translateX(' + v.toFixed(2) + 'px)'; };
      this.pillW.onUpdate = (v) => { this.pill.style.width = Math.max(0, v).toFixed(2) + 'px'; };
      this._springs.push(this.pillX, this.pillW);
      this.ticker.add((dt) => {
        const a = this.pillX.step(dt), b = this.pillW.step(dt);
        return a && b;
      });
    }
  }

  /** Какая кнопка дока соответствует текущему экрану. */
  dockTargetFor(id) {
    if (!id) return null;
    if (['menu'].includes(id)) return 'menu';
    if (['careerIntro', 'careerPerk', 'careerEnd'].includes(id)) return 'career';
    if (['workshop'].includes(id)) return 'workshop';
    if (['onlineLobby'].includes(id)) return 'online';
    if (['settings', 'tuneServe', 'tuneControl', 'tdone', 'reels', 'shotLab'].includes(id)) return 'drawer';
    return null;
  }

  updateDock() {
    if (!this.dock) return;
    const target = this.dockTargetFor(this.activeId);
    this.dock.querySelectorAll('.dock-btn').forEach((btn) => {
      const on = !!(target && (btn.dataset.view === target ||
        (target === 'drawer' && btn.hasAttribute('data-drawer'))));
      btn.classList.toggle('on', !!on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if (this.pill) {
      const btn = target === 'drawer'
        ? this.dock.querySelector('[data-drawer]')
        : this.dock.querySelector('[data-view="' + (target || '') + '"]');
      if (btn) this.movePill(btn);
      else this.pill.style.opacity = '0';
    }
  }

  movePill(btn) {
    if (!this.pill) return;
    const r = btn.getBoundingClientRect();
    const dr = this.dock.getBoundingClientRect();
    if (!r.width) return;
    this.pill.style.opacity = '1';
    const x = r.left - dr.left;
    const w = r.width;
    if (this.pillX.resting && this.pillW.resting) {
      this.pillX.set(x); this.pillW.set(w);
      this.pill.style.transform = 'translateX(' + x.toFixed(2) + 'px)';
      this.pill.style.width = w.toFixed(2) + 'px';
      return;
    }
    this.pillX.to(x);
    this.pillW.to(w);
  }

  /* --------------------------- шторка ---------------------------- */

  bindDrawer() {
    if (!this.drawer) return;
    this.drawer.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = btn.dataset.view;
        this.toggleDrawer(false);
        if (id === 'settings') this.ui && this.ui.openSettings();
        else if (id === 'reels') this.ui && this.ui.showMoments && this.ui.showMoments(true);
        else if (id === 'shotLab') this.ui && this.ui.openShotLab();
        else if (id === 'tdone') this.ui && this.ui.showTrainingRecap && this.ui.showTrainingRecap();
        else this.go(id);
      });
    });
    this.drawer.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const action = btn.dataset.action;
        this.toggleDrawer(false);
        if (action === 'demo') this.ui && this.ui.startDemo && this.ui.startDemo();
        if (action === 'training') this.ui && this.ui.startTraining && this.ui.startTraining();
      });
    });
    /* Клик по фону шторки закрывает её. */
    const scrim = document.getElementById('hubScrim');
    if (scrim) scrim.addEventListener('click', () => this.toggleDrawer(false));
  }

  toggleDrawer(force) {
    if (!this.drawer) return;
    const open = force === undefined ? !this.drawerOpen : !!force;
    this.drawerOpen = open;
    this.drawer.classList.toggle('on', open);
    this.drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    const scrim = document.getElementById('hubScrim');
    if (scrim) scrim.classList.toggle('on', open);
    const btn = this.dock && this.dock.querySelector('[data-drawer]');
    if (btn) btn.classList.toggle('on', open);
    if (this.ui && this.ui.game && this.ui.game.audio) this.ui.game.audio.ui('click');
    if (open) {
      const first = this.drawer.querySelector('button');
      if (first) setTimeout(() => first.focus({ preventScroll: true }), 60);
    }
  }

  /* --------------------------- отклик ---------------------------- */

  /** Круговая волна от точки нажатия. */
  bindRipples() {
    const root = document.getElementById('hub');
    if (!root) return;
    root.addEventListener('pointerdown', (e) => {
      if (this.reduced) return;
      const btn = e.target.closest && e.target.closest('button, .opt, .irow, .trow, .sitem, .mrow, .dock-btn');
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.1;
      const ring = document.createElement('span');
      ring.className = 'hub-ripple';
      ring.style.width = ring.style.height = size.toFixed(0) + 'px';
      ring.style.left = (e.clientX - r.left - size / 2).toFixed(0) + 'px';
      ring.style.top = (e.clientY - r.top - size / 2).toFixed(0) + 'px';
      btn.appendChild(ring);
      setTimeout(() => ring.remove(), 620);
    }, { passive: true });
  }

  /** Прожектор: подсветка следует за пальцем. */
  bindSpotlight() {
    const root = document.getElementById('hub');
    if (!root) return;
    let raf = 0, px = 0, py = 0, lx = 0, ly = 0;
    const loop = () => {
      lx += (px - lx) * 0.18;
      ly += (py - ly) * 0.18;
      root.style.setProperty('--hub-x', lx.toFixed(1) + 'px');
      root.style.setProperty('--hub-y', ly.toFixed(1) + 'px');
      raf = Math.abs(px - lx) > 0.4 || Math.abs(py - ly) > 0.4 ? requestAnimationFrame(loop) : 0;
    };
    root.addEventListener('pointermove', (e) => {
      if (this.reduced) return;
      const r = root.getBoundingClientRect();
      px = e.clientX - r.left; py = e.clientY - r.top;
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
  }

  /* ------------------------ счётчики и текст ---------------------- */

  /** Числовой счётчик: монеты, кристаллы, опыт. */
  setNumber(el, value, opts = {}) {
    if (!el) return;
    const from = Number(el.dataset.v || 0);
    const to = Number(value) || 0;
    el.dataset.v = String(to);
    if (this.reduced || from === to) { el.textContent = opts.format ? opts.format(to) : String(to); return; }
    const dur = opts.duration || 520;
    const start = performance.now();
    const fmt = opts.format || ((v) => String(Math.round(v)));
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = hubEaseOut(t);
      el.textContent = fmt(hubLerp(from, to, e));
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = fmt(to);
    };
    requestAnimationFrame(step);
  }

  /** «Дешифратор» заголовка: буквы собираются из шума. */
  scramble(el, text) {
    if (!el) return;
    if (this.reduced) { el.textContent = text; return; }
    const dur = 420;
    const start = performance.now();
    const seed = Math.floor(Math.random() * 100000) + 1;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      el.textContent = hubScrambleFrame(text, t, seed);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = text;
    };
    requestAnimationFrame(step);
  }

  /* --------------------------- частицы --------------------------- */

  /** Конфетти / искры победы. */
  burst(anchor, opts = {}) {
    if (this.reduced || !anchor) return;
    const host = document.getElementById('hubFx');
    if (!host) return;
    const r = anchor.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const cx = r.left - hr.left + r.width / 2;
    const cy = r.top - hr.top + r.height / 2;
    const colors = opts.colors || ['#ffd34d', '#39c6ff', '#4ee39a', '#ff7a2f', '#b3a4ff'];
    const n = opts.count || 26;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'hub-spark';
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const dist = 60 + Math.random() * 120;
      p.style.left = cx.toFixed(0) + 'px';
      p.style.top = cy.toFixed(0) + 'px';
      p.style.background = colors[i % colors.length];
      p.style.setProperty('--dx', (Math.cos(a) * dist).toFixed(0) + 'px');
      p.style.setProperty('--dy', (Math.sin(a) * dist - 40).toFixed(0) + 'px');
      p.style.setProperty('--rot', (Math.random() * 540 - 270).toFixed(0) + 'deg');
      p.style.animationDuration = (0.6 + Math.random() * 0.5).toFixed(2) + 's';
      host.appendChild(p);
      setTimeout(() => p.remove(), 1200);
    }
  }

  /** Монетки, летящие в счётчик кошелька. */
  coinFly(anchor, count = 1) {
    if (this.reduced || !anchor) return;
    const chip = document.getElementById('hubCoinChip');
    const host = document.getElementById('hubFx');
    if (!chip || !host) return;
    const from = anchor.getBoundingClientRect();
    const to = chip.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const n = Math.min(10, Math.max(3, count));
    for (let i = 0; i < n; i++) {
      const coin = document.createElement('i');
      coin.className = 'hub-coin-fly';
      coin.style.left = (from.left - hr.left + from.width / 2).toFixed(0) + 'px';
      coin.style.top = (from.top - hr.top + from.height / 2).toFixed(0) + 'px';
      coin.style.setProperty('--tx', ((to.left + to.width / 2) - (from.left + from.width / 2)).toFixed(0) + 'px');
      coin.style.setProperty('--ty', ((to.top + to.height / 2) - (from.top + from.height / 2)).toFixed(0) + 'px');
      coin.style.animationDelay = (i * 55) + 'ms';
      host.appendChild(coin);
      setTimeout(() => coin.remove(), 1400);
    }
  }

  /* --------------------------- объявления ------------------------ */

  /** Один короткий текст для скринридера — что открылось. */
  announce(text) {
    if (!this.live || !text) return;
    this.live.textContent = '';
    setTimeout(() => { this.live.textContent = text; }, 30);
  }

  /** Тост внутри хаба: короткий, с въездом снизу. */
  toast(text) {
    const el = document.getElementById('hubToast');
    if (!el || !text) return;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('on'), 1900);
  }
}
