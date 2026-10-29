/* =====================================================================
   ONLINE — матч с другом. Сетевой частью движет движок (команды net и
   события net), оболочка показывает статус, код комнаты, пинг и приглашение.
   Адрес реле берётся из адреса страницы (GameHost.relayUrl), поэтому ссылка
   для друга — просто адрес игры + ?room=КОД.
   ===================================================================== */
const Net = { st: 'idle', room: '', side: 0, ping: 0, err: '', code: '', over: null };
/* Код комнаты — строго 5 символов A-Z0-9 (так валидирует реле). Пропускать
 * в разметку что-то другое нельзя: ссылка ?room= приходит извне. */
const netCode = (v) => {
  const c = String(v || '').trim().toUpperCase();
  return /^[A-Z0-9]{5}$/.test(c) ? c : '';
};
const netEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

Router.def('online', {
  full: true, mood: 'arena',
  render() {
    return `${UI.hud({ back: true, title: t('net.title') })}<div class="scroll net" id="netBody"></div>`;
  },
  mount(el) {
    UI.bindHud(el);
    this.el = el; this.alive = true;
    this.off = GameHost.on((m) => {
      if (m.type === 'net') this.onNet(m);
      else if (m.type === 'matchEnd' && Net.st === 'match') this.onOver(m);
    });
    GameHost.ensure();
    Net.code = netCode(new URLSearchParams(location.search).get('room'));
    this.paint();
    /* пинг считает движок (ping/pong раз в 2 с), здесь только спрашиваем статус */
    this.iv = setInterval(() => { if (this.alive && GameHost.ready) GameHost.send('net', { cmd: 'status' }); }, 2000);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const k = b.dataset.act;
      haptic('medium'); Sfx.soft();
      if (k === 'create') { Net.st = 'connecting'; Net.err = ''; this.paint(); GameHost.send('net', { cmd: 'create' }); }
      if (k === 'join') {
        const code = netCode((el.querySelector('#netIn') || {}).value);
        if (!code) { Net.err = t('net.badCode'); this.paint(); return; }
        Net.st = 'connecting'; Net.code = code; this.paint(); GameHost.send('net', { cmd: 'join', code });
      }
      if (k === 'invite') this.invite(b);
      if (k === 'again') { Net.over = null; Net.st = 'idle'; Net.room = ''; Net.code = ''; GameHost.send('net', { cmd: 'leave' }); this.paint(); }
      if (k === 'leave') { Net.st = 'idle'; Net.room = ''; Net.code = ''; Net.err = ''; GameHost.send('net', { cmd: 'leave' }); this.paint(); }
      if (k === 'exit') this.quitMatch();
    });
    /* глубокая ссылка с кодом: друг не должен вводить его руками */
    if (Net.code) { Net.st = 'connecting'; this.paint(); GameHost.send('net', { cmd: 'join', code: Net.code }); }
  },
  onNet(m) {
    // Status polls can arrive after matchEnd; keep the result visible until
    // the player explicitly chooses a new room or exits.
    if (!this.alive || Net.over) return;
    if (m.msg) Net.err = String(m.msg);
    const room = netCode(m.room);
    if (room) { Net.room = room; Net.code = room; }
    if (Number.isFinite(m.latency)) Net.ping = m.latency;
    if (m.side === 1 || m.side === -1) Net.side = m.side;
    if (m.st) Net.st = m.st;
    this.el.classList.toggle('net-playing', Net.st === 'match');
    if (Net.st === 'match') { GameHost.show(true); TGX.guard(true); }
    else GameHost.show(false);
    this.paint();
  },
  onOver(m) {
    Net.over = { won: !!m.won, score: netEsc((m.score || []).join(':')) };
    Net.st = 'over';
    GameHost.send('outro'); GameHost.show(false); TGX.guard(false);
    this.el.classList.remove('net-playing'); this.paint();
  },
  quitMatch() {
    GameHost.send('net', { cmd: 'leave' });
    GameHost.send('attract');
    GameHost.show(false);
    TGX.guard(false);
    Net.st = 'idle'; Net.room = ''; Net.code = ''; Net.over = null;
    Router.go('hub');
  },
  invite(btn) {
    const link = location.href.split('?')[0].split('#')[0] + '?room=' + Net.code;
    const show = () => { btn.textContent = t('net.copied'); setTimeout(() => this.paint(), 1200); };
    if (navigator.share) { navigator.share({ url: link }).then(() => {}, () => prompt(t('net.linkPh'), link)); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(show, () => prompt(t('net.linkPh'), link));
    else prompt(t('net.linkPh'), link);
  },
  paint() {
    if (!this.alive || !this.el) return;
    const body = this.el.querySelector('#netBody'); if (!body) return;
    const relay = GameHost.relayUrl();
    const head = (chip) => `<div class="pg-head rise" style="--d:0"><div class="h1">${t('net.title')}</div>${chip}</div>`;

    if (Net.st === 'match') {
      body.innerHTML = `<div class="net-live">
        <span class="net-meta">${t('net.roomCap')} ${Net.code} · ${t(Net.side === 1 ? 'net.host' : 'net.guest')}</span>
        <span class="net-ping num">${Net.ping || '—'} ${t('net.ms')}</span>
        <button class="net-exit pe" data-act="exit" aria-label="${t('common.exit')}" title="${t('common.exit')}">${Art.icon('x', { c: 'currentColor', fill: 'none', sw: 2.2 })}</button></div>`;
      return;
    }
    if (Net.over) {
      body.innerHTML = head(`<span class="chip">${t('net.score')} <b class="num">${Net.over.score}</b></span>`) +
        `<div class="pnl net-card rise" style="--d:1">
          <div class="net-note">${t(Net.over.won ? 'net.won' : 'net.lost')}</div>
          <button class="b3 gold" data-act="again">${t('net.again')}</button>
          <button class="b3 dark" data-act="exit">${t('common.exit')}</button></div>`;
      return;
    }
    const wait = Net.st === 'assigned' || Net.st === 'waiting';
    const open = Net.st === 'idle' || Net.st === 'error' || Net.st === 'closed' || Net.st === 'peerleft' || Net.st === 'lobby';
    const note = netEsc(Net.st === 'error' && Net.err ? Net.err : t('net.st.' + Net.st));
    body.innerHTML = head(`<span class="chip ${wait ? 'gold' : ''}">${Net.ping} ${t('net.ms')}</span>`) +
      `<div class="pnl net-card rise" style="--d:1">
        <div class="cap">${t('net.roomCap')}</div>
        <div class="net-code num">${Net.code || '— · — · — · — · —'}</div>
        <div class="net-note">${note}</div>
        ${wait ? `<button class="b3 gold" data-act="invite">${t('net.invite')}</button>
          <button class="b3 dark" data-act="leave">${t('net.leave')}</button>` : ''}
        ${open ? `<button class="b3 gold" data-act="create">${t('net.create')}</button>
          <div class="net-join"><input class="net-in num" id="netIn" maxlength="5" inputmode="text"
            autocapitalize="characters" autocomplete="off" spellcheck="false"
            placeholder="${t('net.codePh')}"><button class="b3 dark" data-act="join">${t('net.join')}</button></div>` : ''}
      </div>
      <div class="pnl inset net-relay rise" style="--d:2"><span>${Art.icon('info', { c: '#9BE8FF' })}</span>
        <p>${t('net.relay')} <b class="num">${netEsc(relay ? relay.replace(/^wss?:\/\//, '') : t('net.relayNone'))}</b></p></div>`;
  },
  leave() { this.alive = false; clearInterval(this.iv); if (this.off) this.off(); GameHost.show(false); TGX.guard(false); },
  onBack() {
    if (Net.st === 'match') this.quitMatch();
    else { GameHost.send('net', { cmd: 'leave' }); Router.go('hub'); }
  }
});
