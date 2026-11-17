/* =====================================================================
   HUB — Главный экран «Арена». Глобальная переработка.
   Одна доминирующая цель: начать игру. Всё остальное — вторично.
   ===================================================================== */

const MODES = [
  { id: 'free', tk: 'mode.free', sk: 'mode.freeSub', c: 'primary', tag: '훈련', desc: 'mode.freeDesc' },
  { id: 'ranked', tk: 'mode.ranked', sk: 'mode.rankedSub', c: 'gold', tag: '±24', desc: 'mode.rankedDesc' },
  { id: 'practice', tk: 'mode.practice', sk: 'mode.practiceSub', c: 'violet', tag: 'обучение', desc: 'mode.practiceDesc' }
];

const questReady = () => Daily.ready();
const FREE_MS = 4 * 3600 * 1000;
const giftStatus = (left) => (left > 0 ? t('hub.giftInShort', { time: fmtLeft(left) }) : t('hub.giftReadyShort'));
const UNLOCK_MS = { wood: 30 * 60 * 1000, silver: 3 * 3600 * 1000, gold: 8 * 3600 * 1000, epic: 12 * 3600 * 1000 };

Router.def('hub', {
  mood: 'arena',
  render() {
    const qr = questReady();
    const hasGift = (S.freeAt || 0) <= Date.now();
    return `${UI.topHud()}
    <div class="hub-content scroll">
      <!-- Баннер лиги: одна строка, информативно -->
      <header class="hub-hero mb-6">
        <div class="hub-hero-badge flex items-center gap-3">
          <span class="chip gold">${t('hub.league', { name: leagueName(leagueOf(S.rating)) })}</span>
          <span class="chip neon">${fmt(S.rating)}</span>
        </div>
        <h1 class="h1 mt-3">${t('hub.title')}</h1>
        <p class="body-sm mt-2">${t('hub.subtitle', { name: S.name.split(' ')[0] })}</p>
      </header>

      <!-- ГЛАВНОЕ: один призыв к действию на экран -->
      <section class="hub-primary mt-5">
        <h2 class="h3 mb-3">${t('hub.playNow')}</h2>
        <div class="hub-mode-list flex-col gap-3">
          ${MODES.map((m) => `
            <button class="btn btn-primary btn-block flex items-center gap-4 p-4" data-modebtn="${m.id}" data-press>
              <div class="flex-none" style="width:48px;height:48px;display:grid;place-items:center;background:rgba(255,255,255,.08);border-radius:14px;border:1px solid var(--border)">
                ${Art.icon(m.id === 'free' ? 'bolt' : m.id === 'ranked' ? 'crown' : 'target', { c: '#0A0E1E', sw: 2.5 })}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="body">${t(m.tk)}</span>
                  <span class="chip ${m.c === 'gold' ? 'gold' : m.c === 'violet' ? 'violet' : 'primary'} caption">${t(m.tag)}</span>
                </div>
                <div class="caption">${t(m.sk)}</div>
              </div>
              <span class="btn-icon flex-none" aria-hidden="true">${Art.icon('chevron-right', { c: '#fff', sw: 2.5 })}</span>
            </button>
          `).join('')}
        </div>
      </section>

      <!-- ВТОРИЧНО: задания, подарок, друзья, настройки — компактно -->
      <section class="hub-secondary mt-6">
        <h2 class="h3 mb-3">${t('hub.more')}</h2>
        <div class="hub-mode-grid grid2 gap-3">
          <button class="btn btn-ghost btn-block flex items-center gap-4 p-4" data-act="quests" data-press>
            <div class="flex-none" style="width:48px;height:48px;display:grid;place-items:center">${Art.icon('quest', { c: '#2EE6FF', sw: 2.5 })}</div>
            <div class="flex-1 min-w-0">
              <div class="body">${t('hub.quests')}</div>
              <div class="caption">${qr ? t('hub.questsReady', { n: qr }) : t('hub.questsSub')}</div>
            </div>
            ${qr ? `<span class="dot flex-none">${qr}</span>` : ''}
          </button>
          <button class="btn btn-ghost btn-block flex items-center gap-4 p-4" data-act="gifts" data-press data-gift-status="${giftStatus((S.freeAt || 0) - Date.now())}">
            <div class="flex-none" style="width:48px;height:48px;display:grid;place-items:center">${Art.icon('gift', { c: '#FFC93A', sw: 2.5 })}</div>
            <div class="flex-1 min-w-0">
              <div class="body">${t('hub.gift')}</div>
              <div class="caption">${hasGift ? t('hub.giftReady') : t('hub.giftInShort', { time: fmtLeft((S.freeAt || 0) - Date.now()) })}</div>
            </div>
            ${hasGift ? '<span class="dot flex-none">✦</span>' : ''}
          </button>
          <button class="btn btn-ghost btn-block flex items-center gap-4 p-4" data-act="friends" data-press>
            <div class="flex-none" style="width:48px;height:48px;display:grid;place-items:center">${Art.icon('users', { c: '#9BE8FF', sw: 2.5 })}</div>
            <div class="flex-1 min-w-0">
              <div class="body">${t('common.friends')}</div>
              <div class="caption">${t('hub.friendsSub')}</div>
            </div>
          </button>
          <button class="btn btn-ghost btn-block flex items-center gap-4 p-4" data-act="settings" data-press>
            <div class="flex-none" style="width:48px;height:48px;display:grid;place-items:center">${Art.icon('gear', { c: '#9BE8FF', sw: 2.5 })}</div>
            <div class="flex-1 min-w-0">
              <div class="body">${t('nav.settings')}</div>
              <div class="caption">${t('hub.settingsSub')}</div>
            </div>
          </button>
        </div>
      </section>
    </div>`;
  },
  mount(el) {
    UI.bindHud(el);
    this.el = el;
    let alive = true; const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms); timers.add(id); };
    GameHost.ensure(); GameHost.send('quiet', { on: true }); GameHost.show(true, 'lobby'); GameHost.show(true);
    const timer = setInterval(() => {
      $$('[data-gift-status]', el).forEach((b) => {
        const left = (S.freeAt || 0) - Date.now();
        const hasGift = left <= 0;
        b.dataset.giftStatus = giftStatus(left);
        const caption = b.querySelector('.caption');
        if (caption) caption.textContent = hasGift ? t('hub.giftReady') : t('hub.giftInShort', { time: fmtLeft(left) });
        const dot = b.querySelector('.dot');
        if (dot) dot.textContent = hasGift ? '✦' : '';
      });
      UI.refreshNotifications();
    }, 1000);
    timers.add(timer);

    const click = (e) => {
      const a = e.target.closest('[data-act],[data-modebtn]'); if (!a) return;
      const mb = a.dataset.modebtn;
      if (mb) {
        const p = FX.pt(a); FX.burst(p.x, p.y, { count: 24, speed: 9 }); haptic('heavy');
        TGX.fullscreen(true);
        if (mb === 'free') {
          BATTLE = { opp: pick(MM_POOL[leagueOf(S.rating).id] || MM_POOL.bronze) };
          Router.go('match');
        } else if (mb === 'practice') {
          Router.go('train', { data: { then: 'hub' } });
        } else if (mb === 'ranked') {
          Router.go('match');
        }
        return;
      }
      const k = a.dataset.act;
      if (k === 'quests') this.questSheet();
      if (k === 'gifts') this.giftsSheet(a);
      if (k === 'friends') this.friendsSheet();
      if (k === 'settings') openSettings();
    };
    el.addEventListener('click', click);
    return () => { alive = false; timers.forEach(clearTimeout); clearInterval(timer); el.removeEventListener('click', click); this.el = null; GameHost.show(false); };
  },
  leave() { Preloader.cancel(); },
  refreshLocale(el) {
    UI.refreshHud(el); UI.localize(el);
    const qr = questReady();
    const questBtn = el.querySelector('[data-act="quests"]');
    if (questBtn) {
      const caption = questBtn.querySelector('.caption');
      if (caption) caption.textContent = qr ? t('hub.questsReady', { n: qr }) : t('hub.questsSub');
      const dot = questBtn.querySelector('.dot');
      if (dot) dot.textContent = qr ? qr : '';
    }
    const giftBtn = el.querySelector('[data-act="gifts"]');
    if (giftBtn) {
      const left = (S.freeAt || 0) - Date.now();
      const hasGift = left <= 0;
      const caption = giftBtn.querySelector('.caption');
      if (caption) caption.textContent = hasGift ? t('hub.giftReady') : t('hub.giftInShort', { time: fmtLeft(left) });
      const dot = giftBtn.querySelector('.dot');
      if (dot) dot.textContent = hasGift ? '✦' : '';
    }
  },
  giftsSheet(btn) {
    const left = (S.freeAt || 0) - Date.now();
    const hasGift = left <= 0;
    Sheet.open(`
      <div class="sheet-title">${t('hub.giftsTitle')}</div>
      <div class="pnl gf-gift mt-4">
        <span class="gf-art big">${Art.icon('gift', { c: '#FFE9B0' })}</span>
        <span class="gf-t">
          <b class="body">${t('hub.dailyGift')}</b>
          <div class="caption">${hasGift ? t('hub.giftReady') : t('hub.giftIn', { time: fmtLeft(left) })}</div>
        </span>
        <button class="btn btn-${hasGift ? 'success' : 'ghost'} btn-block mt-4" data-gift="1" ${!hasGift ? 'disabled' : ''}>
          ${hasGift ? t('common.claim') : t('hub.giftRefresh', { time: fmtLeft(left) })}
        </button>
      </div>
    `, {
      onOpen: (w) => {
        w.addEventListener('click', (e) => {
          const g = e.target.closest('[data-gift]');
          if (g && Date.now() >= (S.freeAt || 0)) {
            S.freeAt = Date.now() + FREE_MS; save(); UI.refreshNotifications();
            const p = FX.pt(g); Wallet.add('coins', 40, p); FX.twinkles(p.x, p.y, 30, 8); haptic('success');
            toast(t('hub.giftToast', { n: 40 }), 'success');
            Sheet.close(); return;
          }
        });
      }
    });
  },
  questSheet() {
    const items = Daily.items();
    const left = Daily.msLeftToday(); const lh = Math.floor(left / 3600000), lm = Math.floor(left % 3600000 / 60000);
    Sheet.open(`
      <div class="sheet-title">${t('hub.questsTitle')}</div>
      <p class="caption mt-2 mb-4">${t('quests.refreshIn', { h: lh, m: lm })}</p>
      <div class="list mt-3">
        ${items.map((q, i) => `
          <div class="list-item flex items-center justify-between p-4">
            <div class="flex-1 min-w-0">
              <div class="body">${q.t}</div>
              <div class="progress-bar mt-2"><i style="--p:${q.p / q.m}"></i></div>
              <div class="caption mt-1">${q.p}/${q.m} (${Math.round(q.p / q.m * 100)}%)</div>
            </div>
            ${q.done ? (q.claimed ? '<span class="checkmark flex-none" style="background:var(--accent-success);border-color:var(--accent-success)">✓</span>' : `<button class="btn btn-success btn-sm" data-q="${q.id}" data-k="${q.k}" data-r="${q.r}">${t('common.claim')}</button>`) : `<span class="caption">${Math.round(q.p / q.m * 100)}%</span>`}
          </div>
        `).join('')}
      </div>
    `, {
      onOpen: (w) => {
        w.addEventListener('click', (e) => {
          const b = e.target.closest('[data-q]'); if (!b) return;
          const q = Daily.claim(b.dataset.q); if (!q) return;
          const p = FX.pt(b); FX.burst(p.x, p.y, { count: 20 }); Wallet.add(b.dataset.k, +b.dataset.r, p);
          b.outerHTML = '<span class="checkmark flex-none" style="background:var(--accent-success);border-color:var(--accent-success)">✓</span>';
          UI.refreshNotifications(); haptic('success'); toast(t('hub.questClaimed', { n: q.r }), 'success');
        });
      }
    });
  },
  friendsSheet() {
    Sheet.open(`
      <div class="sheet-title">${t('common.friends')}</div>
      <p class="caption mt-2 mb-4">${t('friends.note')}</p>
      <button class="btn btn-primary btn-block mt-4" data-online>${t('hub.online')}</button>
    `, {
      onOpen: (w) => {
        const button = w.querySelector('[data-online]');
        const click = () => { TGX.fullscreen(true); Sheet.close(true); Router.go('online'); };
        button.addEventListener('click', click);
        return () => button.removeEventListener('click', click);
      }
    });
  }
});

/* Вспомогательные стили для hub — только то, что не в base.css */
const _hubStyle = document.createElement('style');
_hubStyle.textContent = `
  .chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:14px;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;background:rgba(255,255,255,.08);color:var(--ink-soft);border:1px solid var(--border)}
  .chip.gold{background:linear-gradient(180deg,rgba(255,201,58,.2),rgba(255,140,0,.1));color:#FFE28A;border-color:rgba(255,201,58,.35)}
  .chip.neon{background:linear-gradient(180deg,rgba(46,230,255,.2),rgba(10,108,240,.1));color:#E6FDFF;border-color:rgba(46,230,255,.35)}
  .chip.primary{background:linear-gradient(180deg,rgba(46,230,255,.2),rgba(10,108,240,.1));color:#E6FDFF;border-color:rgba(46,230,255,.35)}
  .chip.violet{background:linear-gradient(180deg,rgba(159,107,255,.2),rgba(83,32,201,.1));color:#D9C6FF;border-color:rgba(159,107,255,.35)}
  .hub-mode-card .body{color:var(--ink)}
  .hub-mode-card .caption{color:var(--ink-muted)}
  .hub-secondary .body{color:var(--ink)}
  .hub-secondary .caption{color:var(--ink-muted)}
  .dot{width:20px;height:20px;border-radius:50%;background:var(--accent-warning);color:#0A0E1E;font:800 10px/20px var(--Unb);text-align:center;flex-shrink:0}
  .btn-sm{height:40px;padding:0 14px;font-size:14px}
  .flex-none{flex:none}
  .flex-1{flex:1}
  .min-w-0{min-width:0}
  .p-4{padding:var(--space-4)}
  .mt-2{margin-top:var(--space-2)}
  .mt-3{margin-top:var(--space-3)}
  .mt-4{margin-top:var(--space-4)}
  .mt-5{margin-top:var(--space-5)}
  .mt-6{margin-top:var(--space-6)}
  .mb-3{margin-bottom:var(--space-3)}
  .mb-6{margin-bottom:var(--space-6)}
  .justify-between{justify-content:space-between}
  .grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-3)}
  .gf-gift{display:flex;align-items:center;gap:var(--space-4)}
  .gf-art{flex:none}
  .gf-art.big{width:56px;height:56px}
  .gf-t{flex:1;min-width:0}
  .gf-t b{display:block}
`;
document.head.appendChild(_hubStyle);
