/* =====================================================================
   GAME HOST — настоящий движок (TOPSPIN ARENA, WebGL) живёт в одном
   постоянном iframe под экранами. Прогревается на поиске соперника,
   крутит «облёт» за меню и общается через postMessage.
   ===================================================================== */
const DEVMODE = /[?&]dev=1/.test(location.search);
const GameHost = {
  frame: null, ready: false, q: [], subs: new Set(), rules: null,
  debug: (() => { try { return sessionStorage.getItem('ttu-debug-recording') === '1'; } catch (e) { return false; } })(),
  setDebug(on) {
    this.debug = !!on;
    try { sessionStorage.setItem('ttu-debug-recording', on ? '1' : '0'); } catch (e) {}
    this.send('debug', { on: this.debug });
    document.querySelectorAll('[data-act=diag-mark]').forEach(b => { b.hidden = !this.debug; });
    return this.debug;
  },
  devRules() { try { return JSON.parse(localStorage.getItem('ttu-rules-dev') || '{}') || {}; } catch (e) { return {}; } },
  setDevRules(r) { try { localStorage.setItem('ttu-rules-dev', JSON.stringify(r || {})); } catch (e) {} this.reload(); },
  doc() {
    const pre = '<script>window.__TT_EMBED=1;document.documentElement.classList.add("tt-embed");window.__TT_LOCALE=' + JSON.stringify(I18n.lang) + ';window.__TT_RULES=' +
      JSON.stringify(this.devRules()).replace(/</g, '\\u003c') + ';<\/script>';
    return GAME_HTML.replace('<head>', '<head>' + pre);
  },
  ensure() {
    if (this.frame) return;
    const f = document.createElement('iframe');
    f.title = 'Table Tennis'; f.setAttribute('allow', 'autoplay; fullscreen');
    f.srcdoc = this.doc();
    $('#gamelayer').appendChild(f); this.frame = f; this.ready = false;
    // слой ещё не показан (заставка, меню) — движок стартует спящим и не рендерит впустую
    if (!$('#gamelayer').classList.contains('on')) { this._asleep = true; this.send('sleep'); }
  },
  reload() { if (this.frame) this.frame.remove(); this.frame = null; this.ready = false; this.q = []; this.ensure(); },
  // то, что надо повторить новому iframe после потери GPU-контекста
  mode: null, sticky: {}, paused: false, losses: [],
  send(type, data) {
    const m = Object.assign({ __tt: 1, type }, data || {});
    if (['attract', 'lobby', 'match', 'train'].includes(type)) { this.mode = { type, data: data || {} }; this.paused = false; }
    if (['quiet', 'mute', 'hint', 'quality', 'rm', 'debug'].includes(type)) this.sticky[type] = data || {};
    if (type === 'pause') this.paused = true; if (type === 'resume' || type === 'quit') this.paused = false;
    if (type === 'quit') this.mode = { type: 'attract', data: {} };
    if (this.debug && typeof HostDiagnostics !== 'undefined' &&
        ['debug', 'pause', 'resume', 'slowmo', 'sleep', 'wake', 'match', 'train', 'quit'].includes(type))
      HostDiagnostics.record('host_command', { command: type, on: data && typeof data.on === 'boolean' ? data.on : null, ready: this.ready });
    if (this.ready && this.frame) this.frame.contentWindow.postMessage(m, '*'); else this.q.push(m);
  },
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  recover(m) {
    const now = Date.now(); this.losses = this.losses.filter((t) => now - t < 60000); this.losses.push(now);
    const ov = $('#glRecover'); ov && ov.classList.add('on');
    const mode = this.mode, sticky = Object.assign({}, this.sticky), paused = this.paused;
    if (this.losses.length >= 3) sticky.quality = { q: 'low' };   // третья потеря за минуту — разгружаем GPU
    this.reload();
    Object.entries(sticky).forEach(([t, d]) => this.send(t, d));
    if (mode) {
      if (mode.type === 'match' && m.inMatch) this.send('match', Object.assign({}, mode.data, { resume: { score: m.score, server: m.server } }));
      else if (mode.type === 'train') this.send('train', { step: Number.isFinite(m.training) ? m.training : (mode.data.step || 0) });
      else if (mode.type !== 'match') this.send(mode.type, mode.data);
      else this.send('attract');
    }
    if (paused) this.send('pause');
    if (!$('#gamelayer').classList.contains('on')) { this._asleep = true; this.send('sleep'); }
    this._recovering = true;
  },
  show(on, mode) {
    const lobby = mode === 'lobby';
    $('#gamelayer').classList.toggle('on', !!on); $('#gamelayer').classList.toggle('lobby', !!on && lobby);
    document.body.classList.toggle('in-game', !!on && !lobby); document.body.classList.toggle('in-lobby', !!on && lobby);
    if (on && !lobby && this.frame) try { this.frame.focus(); } catch (e) {}
    // спрятанная игра засыпает после затухания слоя (.45 с) и просыпается сразу при показе
    clearTimeout(this._sleepT);
    if (on) { if (this._asleep) { this._asleep = false; this.send('wake'); } }
    else this._sleepT = setTimeout(() => { if (!$('#gamelayer').classList.contains('on')) { this._asleep = true; this.send('sleep'); } }, 600);
  }
};
window.addEventListener('message', (e) => {
  const m = e.data; if (!m || m.__tt !== 1 || !GameHost.frame || e.source !== GameHost.frame.contentWindow) return;
  if (GameHost.debug && typeof HostDiagnostics !== 'undefined' && ['glLost', 'ready', 'paused', 'matchEnd'].includes(m.type))
    HostDiagnostics.record('engine_message', { messageType: m.type, paused: m.type === 'paused' ? !!m.v : null });
  if (m.type === 'glLost') {
    if (GameHost._glRecoveryPending) return;
    let flush = null;
    try {
      const g = GameHost.frame.contentWindow.__game;
      if (GameHost.debug && g && g.debugArchive) flush = g.debugArchive.flush();
    } catch (err) {}
    if (flush && typeof flush.then === 'function') {
      GameHost._glRecoveryPending = true;
      // Give the bounded local journal a short chance to finish before the
      // old iframe is destroyed. Never leave GPU recovery waiting on storage.
      Promise.race([flush.catch(() => false), new Promise(resolve => setTimeout(resolve, 250))])
        .then(() => { GameHost._glRecoveryPending = false; GameHost.recover(m); });
    } else GameHost.recover(m);
    return;
  }
  if (m.type === 'ready') {
    GameHost.ready = true; GameHost.rules = m.rules;
    if (GameHost._recovering) { GameHost._recovering = false; setTimeout(() => { const ov = $('#glRecover'); ov && ov.classList.remove('on'); }, 350); }
    if (GameHost.debug) GameHost.send('debug', { on: true });
    GameHost.send('quality', { q: S.quality });
    GameHost.send('rm', { on: !!S.rm });
    GameHost.send('locale', { lang: I18n.lang });
    /* вся сохранённая калибровка (включая закрутку) — в движок сразу,
       а не только когда игрок тронет ползунок */
    if (S.cal) for (const k in S.cal) GameHost.send('cal', { k, v: S.cal[k] });
    GameHost.send('missShots', { on: S.missShots !== false, half: S.missShotHalf });
    const q = GameHost.q; GameHost.q = []; q.forEach((x) => GameHost.frame.contentWindow.postMessage(x, '*'));
  }
  if (m.type === 'haptic') haptic(m.kind);
  if (m.type === 'attempt') ZoneStats.add(m);
  if (m.type === 'shot') {
    const added = MissShots.add(m);
    if (!added) MissShots.captureError = t('set.missesInvalidFrame');
    if (GameHost.debug && typeof HostDiagnostics !== 'undefined') HostDiagnostics.record('calibration_shot',
      { id: m.id, added, storage: MissShots.storage, width: m.w, height: m.h,
        imageWidth: m.imageWidth, imageHeight: m.imageHeight, gameTime: m.gameTime });
  }
  if (m.type === 'shotresult') MissShots.result(m.id, m);
  if (m.type === 'shotdrop') MissShots.drop(m.id);
  if (m.type === 'shoterror') {
    MissShots.captureError = String(m.message || 'capture failed');
    if (GameHost.debug && typeof HostDiagnostics !== 'undefined') HostDiagnostics.record('calibration_shot_error', { message: MissShots.captureError });
  }
  GameHost.subs.forEach((f) => { try { f(m); } catch (err) { console.error(err); } });
});

/* ---------- статистика зоны удара: реальные попытки с реальных пальцев ---------- */
const ZoneStats = {
  KEY: 'ttu-zone-stats', MAX: 300, mem: [],
  all() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null') || this.mem; } catch (e) { return this.mem; } },
  add(a) {
    const x = { t: Date.now(), kind: a.kind, input: a.input, accepted: a.accepted, zoneReason: a.zoneReason, dx: a.dx, dy: a.dy,
      lead: a.lead, contact: a.contact, reason: a.reason, sweet: a.sweet, training: a.training, rules: a.rules, sig: a.sig || null };
    const L = this.all(); L.push(x); while (L.length > this.MAX) L.shift();
    this.mem = L; try { localStorage.setItem(this.KEY, JSON.stringify(L)); } catch (e) {}
  },
  LOG: 'ttu-match-log', memLog: [],
  matches() { try { return JSON.parse(localStorage.getItem(this.LOG) || 'null') || this.memLog; } catch (e) { return this.memLog; } },
  logMatch(c, win) {
    if (!c || c.n < 3) return;
    const L = this.matches(); L.push({ t: Date.now(), pct: c.pct, n: c.n, win: !!win, key: c.key }); while (L.length > 30) L.shift();
    this.memLog = L; try { localStorage.setItem(this.LOG, JSON.stringify(L)); } catch (e) {}
  },
  matchSummary(since, win) {
    const L = this.all().filter((a) => a.kind === 'rally' && a.t >= since);
    const R = Object.assign({}, GameHost.rules || {}, GameHost.devRules());
    const side = (L.some((a) => a.input === 'mouse') ? R.contactSideMousePx : R.contactSideTouchPx) || 48;
    const back = R.contactBackPx || 120, fwd = R.contactForwardPx || 150;
    const n = L.length, hit = L.filter((a) => a.contact).length, pct = n ? Math.round(hit / n * 100) : 0;
    const cat = { side: [], high: [], early: [], racket: [] };
    L.filter((a) => !a.contact).forEach((a) => {
      const q = this.norm(a, R) || a;
      if (this.wrongDir(a)) (q.dy < 0 ? cat.high : cat.racket).push(a);
      else if (!a.accepted) (Number.isFinite(q.dy) && q.dy < -back * 0.8 ? cat.high : cat.side).push(a);
      else if (a.reason === 'TIMING_EARLY' || (Number.isFinite(a.lead) && a.lead > 0.2)) cat.early.push(a);
      else cat.racket.push(a);
    });
    const top = Object.entries(cat).sort((a, b) => b[1].length - a[1].length)[0];
    const lrOf = (A) => (A.reduce((s, a) => s + (a.dx || 0), 0) >= 0 ? t('coach.right') : t('coach.left'));
    let key = 'good', title = t('coach.goodTitle'), tip = t('coach.goodTip', { pct });
    if (win === false) tip = t('coach.goodLoseTip', { pct });
    if (pct < 80 && top[1].length) {
      key = top[0];
      ({ side: () => { title = t('coach.sideTitle', { dir: lrOf(top[1]) }); tip = t('coach.sideTip'); },
         high: () => { title = t('coach.highTitle'); tip = t('coach.highTip'); },
         early: () => { title = t('coach.earlyTitle'); tip = t('coach.earlyTip'); },
         racket: () => { title = t('coach.racketTitle', { dir: lrOf(top[1]) }); tip = t('coach.racketTip'); } })[top[0]]();
    }
    return { n, hit, pct, key, title, tip, side, back, fwd, dots: L.slice(-24).map((a) => { const q = this.norm(a, R); return q && { dx: q.dx, dy: q.dy, contact: a.contact, accepted: a.accepted }; }).filter(Boolean) };
  },
  clear() { this.mem = []; try { localStorage.removeItem(this.KEY); } catch (e) {} },
  /** dx/dy of an attempt in REFERENCE px: the game scales the gate to the phone/camera (rules v4 'world'),
   *  so raw px from a tablet and a small phone are not comparable — divide by the scale actually applied */
  norm(a, R) {
    if (!a || !Number.isFinite(a.dx) || !Number.isFinite(a.dy)) return null;
    const e = a.ext; if (!e || !R) return { dx: a.dx, dy: a.dy };
    const side = (a.input === 'mouse' ? R.contactSideMousePx : R.contactSideTouchPx) || 48;
    const sx = e[0] / side || 1, sb = e[1] / (R.contactBackPx || 120) || 1, sf = e[2] / (R.contactForwardPx || 150) || 1;
    return { dx: Math.round(a.dx / sx), dy: Math.round(a.dy < 0 ? a.dy / sb : a.dy / sf) };
  },
  wrongDir(a) { return a.reason === 'WRONG_DIRECTION' || a.zoneReason === 'WRONG_DIRECTION'; },
  /** подпись текущей зоны в том же формате, что пишет игра: бока/верх/низ/радиус */
  sigNow(input) {
    const R = Object.assign({}, GameHost.rules || {}, GameHost.devRules());
    return [input === 'mouse' ? R.contactSideMousePx : R.contactSideTouchPx, R.contactBackPx, R.contactForwardPx, R.captureRadius].map((v) => +(+v).toFixed(2)).join('/');
  },
  sigLabel(sig) { if (!sig) return 'до записи настроек'; const [s, b, f, r] = sig.split('/'); return `бока ${s} · верх ${b} · низ ${f} · r ${r}`; },
  compare(input) {
    const G = {};
    this.all().filter((a) => a.kind === 'rally' && (!input || a.input === input)).forEach((a) => { const k = a.sig || ''; (G[k] = G[k] || []).push(a); });
    return Object.entries(G).map(([sig, L]) => ({ sig, n: L.length, hit: Math.round(L.filter((a) => a.contact).length / L.length * 100), out: Math.round(L.filter((a) => !a.accepted).length / L.length * 100) }))
      .sort((a, b) => b.n - a.n);
  },
  report(input, sig) {
    const L = this.all().filter((a) => a.kind === 'rally' && (!input || a.input === input) && (sig === undefined || (a.sig || '') === sig));
    const n = L.length, hit = L.filter((a) => a.contact).length;
    const out = L.filter((a) => !a.accepted).length;
    const inMiss = L.filter((a) => a.accepted && !a.contact);
    const late = inMiss.filter((a) => a.reason === 'TIMING_LATE' || a.reason === 'DEPTH_FAIL').length;
    const early = inMiss.filter((a) => a.reason === 'TIMING_EARLY' || a.reason === 'NO_FRESH_SWIPE').length;
    const recs = [];
    const R = Object.assign({}, GameHost.rules || {}, GameHost.devRules());
    const side = (input === 'mouse' ? R.contactSideMousePx : R.contactSideTouchPx) || 48;
    if (n < 15) recs.push(['info', `Мало данных: ${n} попыток. Для вывода нужно хотя бы 15 — сыграй ещё.`]);
    else {
      if (out / n > 0.25) {
        const over = L.filter((a) => !a.accepted && Number.isFinite(a.dx)).map((a) => Math.max(0, Math.abs((this.norm(a, R) || a).dx) - side)).sort((a, b) => a - b);
        const med = over.length ? over[over.length >> 1] : 0;
        recs.push(['warn', `${Math.round(out / n * 100)}% нажатий мимо зоны. Медианный промах — ${med} px за боковой границей: попробуй «бока» +${Math.min(30, Math.max(6, Math.round(med / 2) * 2))} px.`]);
      }
      if (late / n > 0.2) recs.push(['warn', `В ${Math.round(late / n * 100)}% попыток палец был в зоне, но ракетка прошла мимо мяча. Радиус захвата +0,02–0,04 м простит неточную линию свайпа.`]);
      if (early / n > 0.15) recs.push(['warn', `В ${Math.round(early / n * 100)}% попыток свайп закончился до прилёта мяча — жмут слишком рано. Зону не трогай: включи «Подсказку удара» в настройках.`]);
      const edge = L.filter((a) => a.accepted && Number.isFinite(a.dx) && Math.abs((this.norm(a, R) || a).dx) > side * 0.7);
      const edgeHit = edge.filter((a) => a.contact).length;
      if (edge.length >= 5 && edgeHit / edge.length < 0.35) recs.push(['info', `Края зоны «пустые»: у боковых нажатий (дальше ${Math.round(side * 0.7)} px от центра) контакт только ${Math.round(edgeHit / edge.length * 100)}%. Зона обещает больше, чем достаёт ракетка: сузь бока до ~${Math.round(side * 0.8)} px или подними радиус захвата.`]);
      if (hit / n > 0.85 && n >= 30) recs.push(['ok', `Попаданий ${Math.round(hit / n * 100)}% — слишком легко. Можно ужать радиус захвата на 0,02 м.`]);
      if (!recs.length) recs.push(['ok', `Баланс в норме: ${Math.round(hit / n * 100)}% контакта, мимо зоны ${Math.round(out / n * 100)}%.`]);
    }
    return { L, n, hit, out, late, early, recs, side, R };
  }
};

function copyText(txt) {
  const fallback = () => { const t = document.createElement('textarea'); t.value = txt; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} t.remove(); return ok; };
  try { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt).then(() => true, fallback); } catch (e) {}
  return Promise.resolve(fallback());
}

function zoneStatsSheet(scope = 'cur') {
  const touch = ZoneStats.all().filter((a) => a.input !== 'mouse').length, mouse = ZoneStats.all().filter((a) => a.input === 'mouse').length;
  const input = mouse > touch ? 'mouse' : 'touch';
  const sigNow = ZoneStats.sigNow(input), cmp = ZoneStats.compare(input);
  const nNow = (cmp.find((c) => c.sig === sigNow) || { n: 0 }).n, nAll = cmp.reduce((s, c) => s + c.n, 0);
  const r = ZoneStats.report(input, scope === 'cur' ? sigNow : undefined), R = r.R;
  const best = cmp.filter((c) => c.n >= 10).sort((a, b) => b.hit - a.hit)[0];
  const cmpHtml = cmp.length > 1 ? `<div class="pnl zs-plot zs-cmp"><div class="cap" style="margin:2px 2px 8px">Сравнение настроек</div>
      ${cmp.map((c) => `<div class="zc-row ${c.sig === sigNow ? 'now' : ''} ${best && c.sig === best.sig ? 'best' : ''}"><span>${ZoneStats.sigLabel(c.sig)}</span><b class="num">${c.hit}%</b><small class="num">мимо ${c.out}% · ${c.n}</small></div>`).join('')}
      <p class="dim" style="margin:6px 2px 0;font-size:10.5px">Зелёная рамка — лучший контакт среди настроек с 10+ попытками, жёлтая точка — текущая.</p></div>` : '';
  const fwd = R.contactForwardPx || 150, back = R.contactBackPx || 120, side = r.side;
  const dots = r.L.slice(-120).map((a) => {
    const q = ZoneStats.norm(a, R); if (!q) return '';
    const c = a.contact ? '#3BF5A0' : a.accepted ? '#FF5A4D' : '#7B86B0';
    return `<circle cx="${clamp(q.dx, -92, 92)}" cy="${clamp(q.dy, -back - 14, fwd + 14)}" r="3.6" fill="${c}" fill-opacity=".85" stroke="#05060F" stroke-width="1"/>`;
  }).join('');
  const zone = `M ${-side} 0 A ${side} ${back} 0 0 1 ${side} 0 A ${side} ${fwd} 0 0 1 ${-side} 0 Z`;
  const bins = [...Array(8)].map(() => [0, 0]);
  r.L.forEach((a) => { if (!Number.isFinite(a.lead)) return; const i = clamp(Math.floor(a.lead / 0.05), 0, 7); bins[i][a.contact ? 0 : 1]++; });
  const mx = Math.max(1, ...bins.map((b) => b[0] + b[1]));
  const hist = bins.map((b, i) => { const h0 = b[0] / mx * 60, h1 = b[1] / mx * 60;
    return `<rect x="${i * 30 + 4}" y="${70 - h0}" width="22" height="${h0}" rx="3" fill="#3BF5A0"/><rect x="${i * 30 + 4}" y="${70 - h0 - h1}" width="22" height="${h1}" rx="3" fill="#FF5A4D" fill-opacity=".8"/><text x="${i * 30 + 15}" y="84" fill="#8C96C0" font-size="10" text-anchor="middle">${(i * 0.05).toFixed(2)}</text>`; }).join('');
  const pct = (a) => r.n ? Math.round(a / r.n * 100) + '%' : '—';
  Sheet.open(`<div class="h1" style="margin:4px 4px 4px">Статистика зоны</div>
    <p class="dim" style="margin:0 4px 8px;font-size:11.5px">${r.n} попыток в розыгрыше · ${input === 'mouse' ? 'мышь' : 'палец'} · ${ZoneStats.sigLabel(sigNow)}</p>
    <div class="zs-scope"><button class="${scope === 'cur' ? 'on' : ''}" data-a="cur">Текущая зона · ${nNow}</button><button class="${scope === 'all' ? 'on' : ''}" data-a="all">Все настройки · ${nAll}</button></div>
    <div class="zs-kpi"><div><b class="num">${pct(r.hit)}</b><span>контакт</span></div><div><b class="num">${pct(r.out)}</b><span>мимо зоны</span></div><div><b class="num">${pct(r.late)}</b><span>ракетка мимо</span></div><div><b class="num">${pct(r.early)}</b><span>рано</span></div></div>
    <div class="pnl zs-plot"><svg viewBox="-96 ${-back - 34} 192 ${back + fwd + 52}" width="100%" height="300">
      <line x1="-96" y1="0" x2="96" y2="0" stroke="rgba(255,255,255,.08)"/><line x1="0" y1="${-back - 20}" x2="0" y2="${fwd + 16}" stroke="rgba(255,255,255,.08)"/>
      <path d="${zone}" fill="rgba(53,198,244,.10)" stroke="#35C6F4" stroke-width="1.5" stroke-dasharray="5 4"/>
      <circle cx="0" cy="0" r="4.4" fill="#FFD54A"/>${dots}
      <text x="0" y="${-back - 22}" fill="#8C96C0" font-size="10" text-anchor="middle">где лёг палец относительно точки встречи, px</text>
      <text x="-90" y="${-back / 2}" fill="#8C96C0" font-size="9">подрезка ↓</text><text x="-90" y="${fwd / 2}" fill="#8C96C0" font-size="9">удар ↑</text>
      <text x="${side + 3}" y="-3" fill="#35C6F4" font-size="10">${side}</text><text x="3" y="${fwd + 12}" fill="#35C6F4" font-size="10">${fwd}</text><text x="3" y="${-back - 4}" fill="#35C6F4" font-size="10">${back}</text></svg>
      <div class="zs-leg"><i style="background:#3BF5A0"></i>контакт <i style="background:#FF5A4D"></i>в зоне, но мимо <i style="background:#7B86B0"></i>вне зоны <i style="background:#FFD54A"></i>точка встречи</div></div>
    <div class="pnl zs-plot"><div class="cap" style="margin:2px 2px 6px">За сколько секунд до встречи нажимали</div><svg viewBox="0 0 244 90" width="100%" height="96">${hist}</svg></div>
    <div class="zs-recs">${r.recs.map(([k, t]) => `<div class="zs-rec ${k}">${t}</div>`).join('')}</div>
    ${cmpHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px"><button class="b3 dark sm" data-a="clear">Очистить</button><button class="b3 dark sm" data-a="export">Экспорт JSON</button><button class="b3 green sm" style="grid-column:1/-1" data-a="zone">Настроить зону</button></div>`, {
    onOpen: (w) => w.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'clear') { ZoneStats.clear(); Sheet.close(true); zoneStatsSheet(scope); }
      if (a.dataset.a === 'cur' || a.dataset.a === 'all') { if (a.dataset.a !== scope) { Sheet.close(true); zoneStatsSheet(a.dataset.a); } }
      if (a.dataset.a === 'export') {
        const L = ZoneStats.all();
        const dump = JSON.stringify({ exported: new Date().toISOString(), ua: navigator.userAgent, screen: [screen.width, screen.height, devicePixelRatio], rules: R, attempts: L });
        copyText(dump).then((ok) => toast(ok ? `Скопировано: ${L.length} попыток · вставь в чат разработчику` : 'Не удалось скопировать', ok ? 'check' : 'x'));
      }
      if (a.dataset.a === 'zone') { Sheet.close(true); devZoneSheet(); }
    })
  });
}

/* ---------- настройка зоны по ссылке: ?rules=<base64url JSON> или startapp=r_<…> в Telegram ----------
   Разработчик подбирает зону, жмёт «Ссылка с настройкой» и рассылает её тестерам:
   у всех одинаковая зона, а статистика сравнивается по подписи настройки. */
const RULE_RANGES = { captureRadius: [.08, .62], depthTolerance: [.08, .62], serveCaptureRadius: [.2, .9], contactForwardPx: [40, 240],
  contactBackPx: [0, 200], contactSideTouchPx: [20, 90], contactSideMousePx: [16, 80] };
const RulesLink = {
  enc(o) { return btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(s) { try { s = s.replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(escape(atob(s)))); } catch (e) { return null; } },
  clean(o) {
    if (!o || typeof o !== 'object') return null; const r = {};
    for (const [k, [a, b]] of Object.entries(RULE_RANGES)) if (Number.isFinite(+o[k])) r[k] = clamp(+o[k], a, b);
    if (typeof o.autoFootwork === 'boolean') r.autoFootwork = o.autoFootwork;
    return Object.keys(r).length ? r : null;
  },
  url(o) { const base = location.href.split('?')[0].split('#')[0]; return base + '?rules=' + this.enc(o); },
  boot() {
    let raw = null;
    try { raw = new URLSearchParams(location.search).get('rules'); } catch (e) {}
    try { const sp = TGX.w && TGX.w.initDataUnsafe && TGX.w.initDataUnsafe.start_param; if (!raw && sp && sp.startsWith('r_')) raw = sp.slice(2); } catch (e) {}
    if (!raw) return;
    const r = this.clean(this.dec(raw));
    if (!r) { setTimeout(() => toast('Ссылка с настройкой зоны повреждена', 'x'), 1800); return; }
    try { localStorage.setItem('ttu-rules-dev', JSON.stringify(r)); } catch (e) {}
    const N = { contactSideTouchPx: 'бока', contactSideMousePx: 'бока (мышь)', contactBackPx: 'верх', contactForwardPx: 'низ', captureRadius: 'r', depthTolerance: 'глубина', serveCaptureRadius: 'r подачи', autoFootwork: 'авто-шаг' };
    setTimeout(() => toast(`Зона из ссылки: ${Object.entries(r).map(([k, v]) => `${N[k]} ${v === true ? 'вкл' : v === false ? 'выкл' : v}`).join(' · ')}`, 'target'), 1800);
  }
};
RulesLink.boot();

/* телефон повернули горизонтально — экран «Поверни телефон» закрывает арену; матч и обучение
   не должны идти за ним, поэтому ставим их на паузу с обычным листом «Пауза» */
try {
  const mqRot = matchMedia('(orientation:landscape) and (max-height:520px) and (pointer:coarse)');
  const onRot = () => {
    if (!mqRot.matches || Sheet.cur) return;
    const scr = Router.screens[Router.cur];
    if (Router.cur === 'match' && scr && scr.st && scr.st.live && !scr.st.over) scr.pause(true);
    else if (Router.cur === 'train' && scr && scr.alive) scr.onMsg({ type: 'paused', v: true, host: false });
  };
  mqRot.addEventListener ? mqRot.addEventListener('change', onRot) : mqRot.addListener(onRot);
} catch (e) {}
