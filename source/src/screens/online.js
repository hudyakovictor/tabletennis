/* =====================================================================
   TTU v3 — Онлайн (матч с другом). Глобальный rework.
   Фундаментальный rework: чёткая иерархия, минимальная цель касания 48px,
   WCAG AA контраст, никаких инлайн-стилей, никаких декоративных эффектов.
   ===================================================================== */
const Net = { st: 'idle', room: '', side: 0, ping: 0, err: '', code: '', over: null, hud: null };
const netCode = (v) => {
  const c = String(v || '').trim().toUpperCase();
  return /^[A-Z0-9]{5}$/.test(c) ? c : '';
};
const netEsc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

Router.def('online', {
  full: true, mood: 'arena',
  render() {
    return `${UI.hud({ back: true, title: t('net.title') })}<div class="scroll online-scroll" id="netBody"></div>`;
  },
  mount(el) {
    UI.bindHud(el);
    this.el = el; this.alive = true;
    this.off = GameHost.on((m) => {
      if (m.type === 'net') this.onNet(m);
      else if (m.type === 'onlineHud') this.onHud(m.snapshot);
      else if (m.type === 'matchEnd' && Net.st === 'match') this.onOver(m);
    });
    GameHost.ensure();
    Net.code = netCode(new URLSearchParams(location.search).get('room'));
    this.paint();
    this.iv = setInterval(() => { if (this.alive && GameHost.ready) GameHost.send('net', { cmd: 'status' }); }, 2000);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const k = b.dataset.act;
      haptic('medium'); Sfx.soft();
      if (k === 'create') { Net.st = 'connecting'; Net.err = ''; Net.hud = null; this.paint(); GameHost.send('net', { cmd: 'create' }); }
      if (k === 'join') {
        const code = netCode((el.querySelector('#netIn') || {}).value);
        if (!code) { Net.err = t('net.badCode'); this.paint(); return; }
        Net.st = 'connecting'; Net.code = code; Net.hud = null; this.paint(); GameHost.send('net', { cmd: 'join', code }); }
      if (k === 'invite') this.invite(b);
      if (k === 'again') { Net.over = null; Net.hud = null; Net.st = 'idle'; Net.room = ''; Net.code = ''; GameHost.send('net', { cmd: 'leave' }); this.paint(); }
      if (k === 'leave') { Net.st = 'idle'; Net.room = ''; Net.code = ''; Net.err = ''; Net.hud = null; GameHost.send('net', { cmd: 'leave' }); this.paint(); }
      if (k === 'exit') this.quitMatch();
    });
    if (Net.code) { Net.st = 'connecting'; this.paint(); GameHost.send('net', { cmd: 'join', code: Net.code }); }
  },
  onNet(m) {
    if (!this.alive || Net.over) return;
    if (m.msg) Net.err = String(m.msg);
    const room = netCode(m.room);
    if (room) { Net.room = room; Net.code = room; }
    if (Number.isFinite(m.latency)) Net.ping = m.latency;
    if (m.side === 1 || m.side === -1) Net.side = m.side;
    if (m.st) Net.st = m.st;
    this.el.classList.toggle('online-playing', Net.st === 'match');
    if (Net.st === 'match') { GameHost.show(true); TGX.guard(true); }
    else GameHost.show(false);
    this.paint();
  },
  onOver(m) {
    Net.over = { won: !!m.won, score: netEsc((m.score || []).join(':')) };
    Net.st = 'over';
    GameHost.send('outro'); GameHost.show(false); TGX.guard(false);
    this.el.classList.remove('online-playing'); this.paint();
  },
  onHud(snapshot) {
    if (!this.alive || Net.over || !snapshot || snapshot.schema !== 1 || !snapshot.matchId ||
        !Array.isArray(snapshot.score) || snapshot.score.length !== 2 ||
        !snapshot.score.every(n => Number.isSafeInteger(n) && n >= 0) || !Number.isSafeInteger(snapshot.seq)) return;
    if (Net.hud?.matchId === snapshot.matchId && Net.hud.seq >= snapshot.seq) return;
    Net.hud = snapshot;
    if (Net.st === 'match') this.paint();
  },
  quitMatch() {
    GameHost.send('net', { cmd: 'leave' });
    GameHost.send('attract');
    GameHost.show(false);
    TGX.guard(false);
    Net.st = 'idle'; Net.room = ''; Net.code = ''; Net.over = null; Net.hud = null;
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

    if (Net.st === 'match') {
      if (!this.hud) {
        body.innerHTML = `<div class="match-hud-slot net-hud-slot"></div><div class="online-live">
          <span class="online-meta"></span><span class="online-ping num"></span>
          <button class="btn btn-icon online-exit" data-act="exit" aria-label="${t('common.exit')}" title="${t('common.exit')}">${Art.icon('x', { c: 'currentColor', fill: 'none', sw: 2.2 })}</button></div>`;
        this.hud = MatchHUD.mount(body.querySelector('.net-hud-slot'));
      }
      body.querySelector('.online-meta').textContent = `${t('net.roomCap')} ${Net.code} · ${t(Net.side === 1 ? 'net.host' : 'net.guest')}`;
      body.querySelector('.online-ping').textContent = `${Net.ping || '—'} ${t('net.ms')}`;
      if (Net.hud) this.hud.update(Net.hud, { t, names: [S.name, t('hud.far')], reducedMotion: effectiveReducedMotion() });
      return;
    }
    if (this.hud) { this.hud.dispose(); this.hud = null; }
    if (Net.over) {
      body.innerHTML = this.onlineHead(`<span class="chip chip-gold">${t('net.score')} <b class="num">${Net.over.score}</b></span>`) +
        `<div class="pnl online-card"><div class="online-note">${t(Net.over.won ? 'net.won' : 'net.lost')}</div>
          <button class="btn btn-ghost btn-block" data-act="again">${t('net.again')}</button>
          <button class="btn btn-ghost btn-block" data-act="exit">${t('common.exit')}</button></div>`;
      return;
    }
    const wait = Net.st === 'assigned' || Net.st === 'waiting';
    const open = Net.st === 'idle' || Net.st === 'error' || Net.st === 'closed' || Net.st === 'peerleft' || Net.st === 'lobby';
    const note = netEsc(Net.st === 'error' && Net.err ? Net.err : t('net.st.' + Net.st));
    const relayHost = relay ? relay.replace(/^wss?:\/\//, '') : t('net.relayNone');
    body.innerHTML = this.onlineHead(`<span class="chip ${wait ? 'chip-wait' : ''}">${Net.ping} ${t('net.ms')}</span>`) +
      `<div class="pnl online-card">
        <div class="caption online-cap">${t('net.roomCap')}</div>
        <div class="online-code num">${Net.code || '— · — · — · — · —'}</div>
        <div class="online-note caption">${note}</div>
        ${wait ? `<button class="btn btn-ghost btn-block" data-act="invite">${t('net.invite')}</button>
          <button class="btn btn-ghost btn-block" data-act="leave">${t('net.leave')}</button>` : ''}
        ${open ? `<button class="btn btn-primary btn-block" data-act="create">${t('net.create')}</button>
          <div class="online-join"><input class="online-in" id="netIn" maxlength="5" inputmode="text"
            autocapitalize="characters" autocomplete="off" spellcheck="false"
            placeholder="${t('net.codePh')}"><button class="btn btn-ghost btn-block sm" data-act="join">${t('net.join')}</button></div>` : ''}
      </div>
      <div class="pnl online-relay"><span class="relay-icon">${Art.icon('info', { c: '#9BE8FF' })}</span>
        <p class="relay-text">${t('net.relay')} <b class="num">${netEsc(relayHost)}</b></p></div>`;
  },
  onlineHead(chip) {
    return `<header class="online-head flex items-center gap-3 mb-4">
      <h2 class="body-lg">${t('net.title')}</h2>${chip}</header>`;
  },
  leave() { this.alive = false; clearInterval(this.iv); if (this.off) this.off(); this.hud?.dispose(); this.hud = null; GameHost.show(false); TGX.guard(false); },
  onBack() {
    if (Net.st === 'match') this.quitMatch();
    else { GameHost.send('net', { cmd: 'leave' }); Router.go('hub'); }
  }
});
