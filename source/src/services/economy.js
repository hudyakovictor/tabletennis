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

/* Reward effects and their receipt are committed together, before animation. */
const Rewards = {
  has(id) { return Array.isArray(S.rewardReceipts) && S.rewardReceipts.includes(id); },
  passReceipt(seasonN, lane, level) { return `pass:${seasonN}:${lane}:${level}`; },
  passClaimed(seasonN, lane, level) { return S.claimed[lane].includes(level) || this.has(this.passReceipt(seasonN, lane, level)); },
  _grant(receipts, rewards, { cost = null, claim = null, premium = false } = {}) {
    const fail = (why) => ({ ok: false, why });
    if (!Array.isArray(receipts) || !receipts.length || new Set(receipts).size !== receipts.length || receipts.some((id) => typeof id !== 'string' || !id.trim() || id.trim() !== id || id.length > 192) || !Array.isArray(rewards) || (!rewards.length && !premium)) return fail('unavailable');
    if (S.rewardReceipts !== undefined && !Array.isArray(S.rewardReceipts)) return fail('unavailable');
    if (claim && (!['f', 'p'].includes(claim.lane) || !Number.isSafeInteger(claim.level) || claim.level < 1 || !S.claimed || !Array.isArray(S.claimed[claim.lane]))) return fail('unavailable');
    if (claim && S.claimed[claim.lane].includes(claim.level)) return fail('claimed');
    if (receipts.some((id) => this.has(id))) return fail('claimed');
    const balances = { coins: S.coins, gems: S.gems }, credits = { coins: 0, gems: 0 };
    if (Object.values(balances).some((n) => !Number.isSafeInteger(n) || n < 0) || !Array.isArray(S.owned) || !Array.isArray(S.chests)) return fail('unavailable');
    if (cost) {
      if (!['coins', 'gems'].includes(cost.cur) || !Number.isSafeInteger(cost.amt) || cost.amt <= 0) return fail('unavailable');
      if (balances[cost.cur] < cost.amt) return fail('funds');
      balances[cost.cur] -= cost.amt;
    }
    const owned = S.owned.slice(), chests = S.chests.slice(), items = [];
    for (const r of rewards) {
      if (!r || !Number.isSafeInteger(r.n) || r.n <= 0) return fail('unavailable');
      if (r.k === 'coins' || r.k === 'gems') {
        balances[r.k] += r.n; credits[r.k] += r.n;
        if (!Number.isSafeInteger(balances[r.k])) return fail('unavailable');
      } else if (r.k === 'card') {
        const item = Catalog.rewardItem(r); if (!item) return fail('unavailable');
        if (!owned.includes(item.id)) { owned.push(item.id); items.push(item.id); }
      } else if (r.k === 'chest' && r.n === 1 && ['silver', 'gold', 'epic'].includes(r.kind)) {
        const slot = chests.findIndex((c) => !c); if (slot < 0) return fail('slotsFull');
        chests[slot] = { id: receipts[0], kind: r.kind, state: 'ready' };
      } else return fail('unavailable');
    }
    const before = { coins: S.coins, gems: S.gems, owned: S.owned, chests: S.chests, claimed: S.claimed, premium: S.premium, rewardReceipts: S.rewardReceipts };
    Object.assign(S, { ...balances, owned, chests, rewardReceipts: (S.rewardReceipts || []).concat(receipts) });
    if (claim) S.claimed = { ...S.claimed, [claim.lane]: S.claimed[claim.lane].concat(claim.level) };
    if (premium) S.premium = true;
    try {
      if (saveNow() === false) throw new Error('save');
      // Store.write may swallow storage errors; verify the durable receipt.
      if (typeof Store !== 'undefined') {
        const stored = Store.read(SAVE_KEY);
        if (!stored || !Array.isArray(stored.rewardReceipts) || receipts.some((id) => !stored.rewardReceipts.includes(id))) throw new Error('receipt');
      }
    } catch (e) { Object.assign(S, before); return fail('storage'); }
    return { ok: true, items, ...credits };
  },
  claimPass(seasonN, lane, level) {
    Progress.reconcileSeason();
    const season = globalThis.TTSeason;
    if (season.seasonOver() || seasonN !== season.seasonNumber() || seasonN !== S.passSeason) return { ok: false, why: 'season' };
    if (!['f', 'p'].includes(lane) || !Number.isSafeInteger(level) || level < 1) return { ok: false, why: 'unavailable' };
    if (lane === 'p' && !S.premium) return { ok: false, why: 'premium' };
    if (level > S.passLvl) return { ok: false, why: 'level' };
    if (this.passClaimed(seasonN, lane, level)) return { ok: false, why: 'claimed' };
    const tier = season.currentPass()[level - 1];
    if (!tier || tier.s !== seasonN || tier.l !== level) return { ok: false, why: 'unavailable' };
    return this._grant([this.passReceipt(seasonN, lane, level)], [tier[lane]], { claim: { lane, level } });
  },
  buyItem(id) {
    const item = Catalog.byId(id), allowed = Catalog.canBuy(item); if (!allowed.ok) return allowed;
    return this._grant(['item:' + id], [{ k: 'card', n: 1, itemId: id }], { cost: item.price });
  },
  exchangeCoins(id, receipt = 'exchange:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2)) {
    const pack = Catalog.coinPacks().find((p) => p.id === id); if (!pack) return { ok: false, why: 'unavailable' };
    return this._grant([receipt], [{ k: 'coins', n: pack.c }], { cost: { cur: 'gems', amt: pack.g } });
  },
  // This is a server-confirmed receipt boundary, not an openInvoice status callback.
  confirmPurchase(productId, receipt) {
    const offer = Catalog.starOffer(productId);
    if (!offer || !receipt || receipt.confirmed !== true || receipt.status !== 'paid' || receipt.productId !== productId || receipt.currency !== 'XTR' || receipt.amount !== offer.price.amt || typeof receipt.id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(receipt.id)) return { ok: false, why: 'unconfirmed' };
    const receipts = ['purchase:' + receipt.id];
    if (offer.once) {
      Progress.reconcileSeason(); const season = globalThis.TTSeason;
      if (season.seasonOver() || receipt.seasonN !== season.seasonNumber() || receipt.seasonN !== S.passSeason) return { ok: false, why: 'season' };
      if (offer.premium && S.premium) return { ok: false, why: 'claimed' };
      receipts.push(`${offer.premium ? 'premium' : 'bundle'}:${receipt.seasonN}`);
    }
    const rewards = (offer.items || []).map((itemId) => ({ k: 'card', n: 1, itemId }));
    if (offer.gems) rewards.push({ k: 'gems', n: offer.gems });
    return this._grant(receipts, rewards, { premium: !!offer.premium });
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
