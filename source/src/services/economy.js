/* =====================================================================
   ECONOMY — кошелёк и награды за уровень. Покупка (spend) пишется в сейв
   немедленно (saveNow): деньги не должны воскресать после краша.
   WALLET — изменения валют всегда видимы: монеты летят в счётчик,
   счётчик подпрыгивает, иконка крутится, играет звук на каждую монету.
   ===================================================================== */
const Wallet = {
  add(kind, amount, fromPt, { count } = {}) {
    const startVal = S[kind]; S[kind] += amount; save();
    /* Мгновенный звуковой отклик: раньше первый «дзынь» звучал только когда
     * долетала первая монета (~1 с после касания) — ощущалось как лаг. */
    if (kind === 'gems') Sfx.gem(0); else Sfx.coin(0);
    return this._fly(kind, amount, fromPt, startVal, count);
  },
  /* Начисление уже записано, а показать надо позже (награда за матч пишется
   * сразу — иначе ранний выход с экрана терял её, — а дорожка монет идёт по
   * таймлайну). Баланс не трогаем: иначе анимация начислила бы второй раз. */
  show(kind, amount, fromPt, { count } = {}) {
    if (kind === 'gems') Sfx.gem(0); else Sfx.coin(0);
    return this._fly(kind, amount, fromPt, S[kind] - amount, count);
  },
  _fly(kind, amount, fromPt, startVal, count) {
    const target = $(`.screen.current [data-cur="${kind}"]`) || $(`[data-cur="${kind}"]`);
    if (!target) return Promise.resolve();
    const v = target.querySelector('.v'), ic = target.querySelector('.ci');
    const to = FX.pt(ic || target);
    const N = count || clamp(Math.round(Math.abs(amount) / 12), 6, 16);
    return FX.fly(fromPt, to, {
      sprite: kind === 'gems' ? 'gem' : 'coin', count: N,
      onHit: (i, total) => {
        const val = Math.round(startVal + amount * (i / total)); v.textContent = fmt(val);
        bump(v); ic && bump(ic, 'bump-ic'); if (i % 3 === 0 || i === total) (kind === 'gems' ? Sfx.gem(i / 3 | 0) : Sfx.coin(i / 3 | 0)); if (i % 3 === 0) haptic('soft');
        if (i === total) { v.textContent = fmt(S[kind]); FX.burst(to.x, to.y, { c: kind === 'gems' ? ['#2EE6FF', '#fff'] : ['#FFC93A', '#fff'], count: 10, speed: 5, size: .6 }); }
      }
    });
  },
  spend(kind, amount, toPt) {
    if (S[kind] < amount) { toast(t('wallet.notEnough', { cur: t('cur.' + kind) }), kind === 'gems' ? 'gem' : 'coin'); Sfx.error(); haptic('error'); return false; }
    const src = $(`.screen.current [data-cur="${kind}"]`);
    const startVal = S[kind]; S[kind] -= amount; saveNow();
    if (src) {
      const v = src.querySelector('.v');
      tickNumber(v, startVal, S[kind], 600); bump(v);
      FX.fly(FX.pt(src.querySelector('.ci') || src), toPt, { sprite: kind === 'gems' ? 'gem' : 'coin', count: 8, size: 26, stagger: 30 });
    }
    return true;
  }
};

/* =====================================================================
   LEVEL UP — полноэкранная награда
   ===================================================================== */
const LevelUp = {
  show(lvl) {
    S.level = lvl; saveNow();
    const w = document.createElement('div'); w.className = 'lvlup';
    w.innerHTML = `<div class="lu-rays"></div><div class="lu-in">
      <div class="lu-cap">${t('levelup.title')}</div>
      <div class="lu-badge"><span>${lvl}</span></div>
      <div class="lu-rew">${Art.gem(30)}<b>+20</b>${Art.coin(30)}<b>+150</b></div>
      <button class="b3 green" data-act="ok">${t('common.claim')}</button></div>`;
    $('#sheets').appendChild(w); w.style.pointerEvents = 'auto';
    Sfx.win(); haptic('success'); flash('#FFE680', .6);
    const d = FX.pt(w.querySelector('.lu-badge')); setTimeout(() => { FX.burst(d.x, d.y, { count: 40, speed: 12, size: 1.4 }); FX.twinkles(d.x, d.y, 90, 16); }, 380);
    w.querySelector('[data-act=ok]').addEventListener('click', async (e) => {
      const p = FX.pt(e.currentTarget);
      w.classList.add('out'); setTimeout(() => w.remove(), 300);
      Wallet.add('gems', 20, p); setTimeout(() => Wallet.add('coins', 150, p), 250);
    });
  }
};
