/* =====================================================================
   UI — общие блоки: верхний HUD, кнопки-ярлыки, 3D-наклон карточек,
   «держи, чтобы купить», сегмент-табы со скользящей плашкой.
   ===================================================================== */
const UI = {
  hud({ back = false, title = '' } = {}) {
    const L = leagueOf(S.rating); const p = S.xp / S.xpMax; const C = 2 * Math.PI * 21;
    const left = back
      ? `<button class="ib" data-act="back" aria-label="Назад">${Art.icon('back', { c: '#fff' })}</button><div class="h2" style="flex:1;margin-left:4px">${title}</div>`
      : `<div class="hud-me" data-act="profile">
          <div class="lvl-ring">
            <svg class="ring" viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="4.5"/>
            <circle cx="24" cy="24" r="21" fill="none" stroke="url(#xpg)" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/>
            <defs><linearGradient id="xpg"><stop offset="0" stop-color="#7DF3FF"/><stop offset="1" stop-color="#2E8BFF"/></linearGradient></defs></svg>
            <div class="av">${Art.avatar('me', 38)}</div><div class="lv">${S.level}</div>
          </div>
          <div class="hud-name"><b>${S.name.split(' ')[0]}</b><span>${Art.badge(L, 14)}${L.n}</span></div>
        </div>`;
    /* Кнопки «+» убраны: они перегружали верхнюю плашку и перехватывали
     * случайные тапы в момент подачи/удара. Покупка — только из магазина. */
    return `<div class="hud">${left}
      <div class="cur" data-cur="coins"><span class="ci">${Art.coin(36)}</span><span class="v num">${fmt(S.coins)}</span></div>
      <div class="cur" data-cur="gems"><span class="ci">${Art.gem(34)}</span><span class="v num">${fmt(S.gems)}</span></div>
    </div>`;
  },
  bindHud(el) {
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const k = a.dataset.act;
      if (k === 'back') Router.back();
      if (k === 'profile') Router.go('profile');
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
    requestAnimationFrame(() => place(el.querySelector('button.on') || btns[0]));
    el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.classList.contains('on')) return; btns.forEach((x) => x.classList.toggle('on', x === b)); place(b); Sfx.tab(); haptic('select'); onChange && onChange(b.dataset.v); });
  },

  /* сплит-текст для побуквенной анимации */
  split(s, cls = 'ch') { return [...s].map((c, i) => `<span class="${cls}" style="--i:${i}">${c === ' ' ? '&nbsp;' : c}</span>`).join(''); }
};

/* таймер-строка */
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}ч ${String(m).padStart(2, '0')}м` : `${m}:${String(ss).padStart(2, '0')}`;
}
