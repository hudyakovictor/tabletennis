/* =====================================================================
   UI — общие блоки: верхний HUD, кнопки-ярлыки, 3D-наклон карточек,
   «держи, чтобы купить», сегмент-табы со скользящей плашкой.
   ===================================================================== */
const UI = {
  /* Это локальная лента доступных игровых наград, а не обещание системных
     push-уведомлений: автономная игра не имеет сервера push-подписки. */
  notices() {
    const items = [];
    if (Date.now() >= (S.freeAt || 0)) items.push({ icon: 'gift', title: t('hub.dailyGift'), detail: t('hub.giftReady'), action: 'gifts' });
    const chests = (Array.isArray(S.chests) ? S.chests : []).filter((c) => c && c.state === 'ready').length;
    if (chests) items.push({ icon: 'lock', title: t('notices.chests'), detail: t('notices.chestsDetail', { n: chests }), action: 'gifts' });
    const quests = Daily.ready();
    if (quests) items.push({ icon: 'quest', title: t('hub.questsTitle'), detail: t('notices.questsDetail', { n: quests }), action: 'quests' });
    return items;
  },
  notificationButton(cls = '') {
    const count = this.notices().length;
    return `<button class="notice-button ${cls}" data-act="notifications" aria-label="${t('notices.title')}" title="${t('notices.title')}">
      ${Art.icon('bell', { c: 'currentColor', fill: 'none', sw: 1.9 })}<span class="notice-count num" aria-hidden="true" ${count ? '' : 'hidden'}>${count || ''}</span>
    </button>`;
  },
  refreshNotifications() {
    const count = this.notices().length;
    $$('.notice-button .notice-count').forEach((badge) => { badge.hidden = !count; badge.textContent = count || ''; });
  },
  openNotifications({ readOnly = false } = {}) {
    const items = this.notices();
    const rows = items.map((item) => {
      const tag = readOnly ? 'div' : 'button';
      return `<${tag} class="notice-row" ${readOnly ? '' : `data-notice="${item.action}"`}>
        <span class="notice-icon">${Art.icon(item.icon, { c: 'currentColor', fill: 'none' })}</span>
        <span class="notice-copy"><b>${item.title}</b><small>${item.detail}</small></span>
        ${readOnly ? '' : '<span class="notice-arrow" aria-hidden="true">›</span>'}</${tag}>`;
    }).join('');
    const w = Sheet.open(`<div class="notice-head"><div><span class="notice-kicker">${t('notices.kicker')}</span><div class="h1">${t('notices.title')}</div></div>
        <button class="notice-close" data-notice-close aria-label="${t('notices.close')}">${Art.icon('x', { c: 'currentColor', fill: 'none' })}</button></div>
      <div class="notice-list">${rows || `<div class="notice-empty">${Art.icon('bell', { c: 'currentColor', fill: 'none' })}<p>${t('notices.empty')}</p></div>`}</div>`, {
      onOpen: (wrap) => wrap.addEventListener('click', async (e) => {
        if (e.target.closest('[data-notice-close]')) { Sheet.close(); return; }
        const row = e.target.closest('[data-notice]'); if (!row) return;
        const action = row.dataset.notice;
        Sheet.close(true);
        if (Router.cur !== 'hub') await Router.go('hub');
        if (Router.cur !== 'hub') return;
        const hub = Router.screens.hub;
        if (action === 'gifts') hub.giftsSheet();
        else if (action === 'quests') hub.questSheet();
      })
    });
    const dialog = w.querySelector('.sheet');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', t('notices.title'));
    this.refreshNotifications();
  },
  hud({ back = false, title = '' } = {}) {
    const L = leagueOf(S.rating);
    const left = back
      ? `<button class="ib" data-act="back" aria-label="${t('common.back')}">${Art.icon('back', { c: '#fff' })}</button><div class="h2 hud-title">${title}</div>`
      : `<button class="hud-me" data-act="profile" aria-label="${t('hud.profile')}">
          <span class="hud-name"><b>${S.name.split(' ')[0]}</b><span>${t('hud.level', { n: S.level })} · ${leagueName(L)}</span></span>
        </button>`;
    /* Покупка валюты остаётся в магазине, а колокольчик показывает только
       реальные доступные награды, без выдуманных сообщений. */
    return `<div class="hud">${left}
      <div class="cur" data-cur="coins"><span class="ci">${Art.coin(36)}</span><span class="v num">${fmt(S.coins)}</span></div>
      <div class="cur" data-cur="gems"><span class="ci">${Art.gem(34)}</span><span class="v num">${fmt(S.gems)}</span></div>
      ${this.notificationButton()}
    </div>`;
  },
  bindHud(el) {
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const k = a.dataset.act;
      if (k === 'back') Router.back();
      if (k === 'profile') Router.go('profile');
      if (k === 'notifications') this.openNotifications();
      if (k === 'buy-coins' || k === 'buy-gems') { Router.go('shop'); setTimeout(() => { const g = $('.screen.current #gemPacks'); g && g.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 520); }
    });
  },

  /* 3D-наклон карточки: указатель или гироскоп, со светом-бликом */
  tilt(el, max = 10) {
    if (S.rm) return;
    el.style.transformStyle = 'preserve-3d';
    let raf = 0, tx = 0, ty = 0, cx = 0, cy = 0;
    const tick = () => { cx = lerp(cx, tx, .15); cy = lerp(cy, ty, .15); el.style.transform = `perspective(700px) rotateX(${cy}deg) rotateY(${cx}deg)`; el.style.setProperty('--mx', (50 + cx * 4) + '%'); el.style.setProperty('--my', (50 - cy * 4) + '%'); if (Math.abs(cx - tx) + Math.abs(cy - ty) > .05) raf = requestAnimationFrame(tick); else raf = 0; };
    const go = () => { if (!raf) raf = requestAnimationFrame(tick); };
    el.addEventListener('pointermove', (e) => { const r = el.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width - .5) * 2 * max; ty = -((e.clientY - r.top) / r.height - .5) * 2 * max; go(); });
    el.addEventListener('pointerleave', () => { tx = 0; ty = 0; go(); });
    el.addEventListener('pointerup', () => { tx = 0; ty = 0; go(); });
  },

  /* держи, чтобы подтвердить (защита от случайной покупки) */
  hold(btn, ms, onDone) {
    let t0 = 0, raf = 0, done = false; const fill = btn.querySelector('.hold-fill');
    const frame = (now) => {
      const p = clamp((now - t0) / ms, 0, 1); fill.style.transform = `scaleX(${p})`;
      if (Math.floor(p * 10) !== Math.floor((p - .016) * 10)) { Sfx.hold(p); haptic('select'); }
      if (p >= 1) { done = true; btn.classList.remove('holding'); onDone(); return; }
      raf = requestAnimationFrame(frame);
    };
    const start = (e) => { if (done) return; t0 = performance.now(); btn.classList.add('holding'); raf = requestAnimationFrame(frame); };
    const stop = () => { cancelAnimationFrame(raf); if (!done) { fill.style.transition = 'transform .3s'; fill.style.transform = 'scaleX(0)'; setTimeout(() => (fill.style.transition = ''), 300); btn.classList.remove('holding'); } };
    btn.addEventListener('pointerdown', start); btn.addEventListener('pointerup', stop); btn.addEventListener('pointerleave', stop); btn.addEventListener('pointercancel', stop);
  },

  seg(el, onChange) {
    const pill = el.querySelector('.pill'); const btns = $$('button', el);
    const place = (b) => { pill.style.left = b.offsetLeft + 'px'; pill.style.width = b.offsetWidth + 'px'; };
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.classList.contains('on'))));
    requestAnimationFrame(() => place(el.querySelector('button.on') || btns[0]));
    el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; btns.forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); place(b); Sfx.tab(); haptic('select'); onChange && onChange(b.dataset.v); });
  },

  /* сплит-текст для побуквенной анимации */
  split(s, cls = 'ch') { return [...s].map((c, i) => `<span class="${cls}" style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join(''); }
};

/* таймер-строка */
function fmtLeft(ms) { return I18n.left(ms); }
