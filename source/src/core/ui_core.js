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
  repaint() {
    /* Перерисовать текущий экран на месте: без перехода, без стека, без истории.
     * Нужно экранам с серверными числами (`live: true`) — они рисуются раньше,
     * чем придёт ответ сети, и иначе показывали бы устаревшие цифры. Позиция
     * прокрутки сохраняется: ответ не должен выдёргивать игрока наверх. */
    const d = this.screens[this.cur]; if (!d || !d.live) return false;
    const el = $('#screens .screen.current'); if (!el) return false;
    const sc = el.querySelector('.scroll'); const top = sc ? sc.scrollTop : 0;
    /* Без входной хореографии: игрок уже на экране, контент не должен
     * выезжать заново — меняются только числа. */
    el.classList.add('repaint');
    el.innerHTML = d.render();
    try { d.mount && d.mount(el); } catch (e) { console.error(e); }
    const sc2 = el.querySelector('.scroll'); if (sc2) sc2.scrollTop = top;
    return true;
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
    { id: 'hub', k: 'nav.hub', i: 'home' },
    { id: 'pass', k: 'nav.pass', i: 'cup' },
    { id: 'shop', k: 'nav.shop', i: 'market' },
    { id: 'settings', k: 'nav.settings', i: 'gear', sheet: true }
  ],
  build() {
    const n = $('#nav'); if (!n) return;
    n.innerHTML = '<div class="navbg"></div>' + this.items.map((tb) => `
      <button class="tab" data-tab="${tb.id}" aria-label="${t(tb.k)}" title="${t(tb.k)}" data-silent>
        <span class="glow"></span><span class="ti" aria-hidden="true">${Art.icon(tb.i, { c: 'currentColor', fill: 'none', sw: 1.9 })}</span>
      </button>`).join('');
    if (!this.bound) n.addEventListener('click', (e) => {
      const b = e.target.closest('.tab'); if (!b) return;
      haptic('select');
      /* «Настройки» — лист поверх текущего экрана: маршрут не меняем,
       * вкладку не подсвечиваем (set() знает только реальные экраны) */
      if (b.dataset.tab === 'settings') { openSettings(); Sfx.tab(); return; }
      if (b.dataset.tab === Router.cur) { const sc = $('.screen.current .scroll'); sc && sc.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      Router.go(b.dataset.tab);
    });
    this.bound = true;
    this.set(this.items.some((tb) => tb.id === Router.cur && !tb.sheet) ? Router.cur : null);
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
  set(id) { $$('#nav .tab').forEach((el) => { const on = el.dataset.tab === id; el.classList.toggle('on', on); if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }); },
  show(on) { $('#nav').classList.toggle('hide', !on); }
};
