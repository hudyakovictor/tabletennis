/* =====================================================================
 *  UI — counters on top, one compact readout below, settings and history.
 *  No menu: the page opens straight into the drill.
 * ===================================================================== */
'use strict';

const LAB_ICON = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 5m0-5-5 5"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

const LAB_TILE_COLOR = {
  TOP: '#ffb35c', TOP_L: '#ffb35c', TOP_R: '#ffb35c',
  BACK: '#7ec8ff', BACK_L: '#7ec8ff', BACK_R: '#7ec8ff',
  SIDE_L: '#6ef0c4', SIDE_R: '#6ef0c4',
};

class LabUI {
  constructor() {
    this.el = {};
    const id = (k) => document.getElementById(k);
    for (const k of ['counters', 'missN', 'rallyN', 'lastShot', 'lsTitle', 'lsMeta', 'debug',
      'toast', 'panel', 'panelClose', 'distRange',
      'distOut', 'serveDirs', 'serveSpins', 'dbgToggle', 'openHistory',
      'panelDone', 'history', 'histClose', 'histTotal', 'histSummary', 'histTable',
      'histExport', 'histClear', 'histHint', 'histSessions',
      'btnSettings', 'btnSound', 'btnFull']) this.el[k] = id(k);
    this.game = null;
    this.buildCounters();
    this.bind();
  }

  attach(game) {
    this.game = game;
    this.syncSettings();
    this.syncAll();
    this.el.btnSettings.innerHTML = LAB_ICON.gear;
    this.el.btnFull.innerHTML = LAB_ICON.full;
    this.syncSound();
  }

  /* ------------------------------ counters ----------------------- */
  buildCounters() {
    const box = this.el.counters;
    if (!box) return;
    box.innerHTML = LAB_SHOTS.map((s) => {
      const rot = s.deg;
      const col = LAB_TILE_COLOR[s.id] || '#cfe0f2';
      return `<div class="tile" data-shot="${s.id}" title="${s.ru}">
        <svg viewBox="0 0 24 24" style="transform:rotate(${rot}deg);color:${col}"
             fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19.5V5.6"/><path d="M6.4 11.2 12 5.6l5.6 5.6"/><circle cx="12" cy="20.3" r="1.15" fill="currentColor" stroke="none"/>
        </svg>
        <span class="nm">${s.short}</span>
        <span class="ct"><i class="tot">0</i></span>
        <span class="sub"><i class="n">0</i>/<u class="s">0</u></span>
      </div>`;
    }).join('');
  }

  syncCounters() {
    const g = this.game;
    if (!g || !this.el.counters) return;
    for (const s of LAB_SHOTS) {
      const tile = this.el.counters.querySelector(`[data-shot="${s.id}"]`);
      if (!tile) continue;
      const raw = g.counts[s.id] || {};
      const c = {
        normal: raw.normal || 0, strong: raw.strong || 0, weak: raw.weak || 0,
        over: raw.over || 0, table: raw.table || 0,
      };
      const total = c.normal + c.strong + c.weak + c.over;
      tile.querySelector('.tot').textContent = total;
      tile.querySelector('.n').textContent = c.normal;
      tile.querySelector('.s').textContent = c.strong;
      tile.classList.toggle('any', total > 0);
      tile.title = `${s.ru}: всего ${total} · обычных ${c.normal}, сильных ${c.strong}` +
        (c.weak ? `, слабых ${c.weak}` : '') + (c.over ? `, слишком сильных ${c.over}` : '') +
        ` · на стол ${c.table}`;
    }
    if (this.el.missN) this.el.missN.textContent = g.misses;
    if (this.el.rallyN) this.el.rallyN.textContent = g.rally;
  }

  onStrike(shotId, band) {
    const tile = this.el.counters && this.el.counters.querySelector(`[data-shot="${shotId}"]`);
    if (!tile) return;
    tile.classList.remove('hit');
    void tile.offsetWidth;
    tile.classList.add('hit');
    this.syncCounters();
  }

  syncAll() {
    this.syncCounters();
    this.syncReadout();
  }

  syncReadout() {
    const g = this.game;
    if (!g) return;
    const ls = this.el.lastShot;
    if (!ls) return;
    ls.className = '';
    if (g.state === 'serve') {
      this.el.lsTitle.textContent = 'ПОДАЧА';
      const d = g.store.settings.serveDir, s = g.store.settings.serveSpin;
      this.el.lsMeta.textContent = `${dirRu(d)} · ${serveRu(s)} · коснитесь стола, чтобы подать`;
    } else {
      if (g.lastShot && g.lastShot.miss && (!g.currentShot || g.lastShot.at >= (g.currentShot.at || 0))) {
        this.el.lsTitle.textContent = 'МИМО';
        this.el.lsMeta.textContent = g.lastShot.reason || '';
        ls.className = 'bad';
      } else if (g.currentShot) {
        const s = g.currentShot;
        const band = LAB_BAND_RU[s.band] || 'ОБЫЧНЫЙ';
        const out = s.outcome === 'table' ? 'НА СТОЛ' : s.outcome === 'net' ? 'В СЕТКУ'
          : s.outcome === 'out' ? 'МИМО СТОЛА' : s.outcome === 'short' ? 'НЕ ДОЛЕТЕЛ' : '—';
        this.el.lsTitle.textContent = `${s.ru} · ${band}`;
        this.el.lsMeta.textContent = s.outcome
          ? `${out}${s.landing ? ` · x ${s.landing.x.toFixed(2)} z ${s.landing.z.toFixed(2)}` : ''}`
          : 'в полёте…';
        ls.className = s.outcome === 'table' ? 'good' : s.outcome ? 'bad' : '';
      }
    }
  }

  syncLive(g) {
    this.syncCounters();
    /* The line under the table follows the state, not just state CHANGES:
     * a stroke resolves seconds after it was made. */
    this.syncReadout();
    if (!g.store.settings.debug || !this.el.debug) { this.el.debug.textContent = ''; return; }
    const b = g.ball;
    const zoneRu = g.zone === 'ready' ? 'ЗЕЛЁНАЯ' : g.zone === 'late' ? 'КРАСНАЯ'
      : g.zone === 'early' ? 'БЕЛАЯ' : '—';
    const lines = [];
    const tHit = Number.isFinite(g.hitT) ? Math.round(g.hitT * 1000) : null;
    lines.push(`мяч ${b.live ? (b.speed * 3.6).toFixed(0) + ' км/ч' : '—'} · окно ${zoneRu}` +
      (tHit !== null ? ` · до удара ${tHit} мс` : ''));
    if (g.pointer.down) {
      const p = g.ballScreen();
      const d = p.ok ? Math.round(Math.hypot((p.x - g.pointer.nx) * g.w, (p.y - g.pointer.ny) * g.h)) : -1;
      lines.push(`палец–мяч ${d} px из ${Math.round(g.zonePx)} px`);
    }
    const s = g.currentShot;
    if (s) {
      lines.push(`${s.ru} ${LAB_BAND_RU[s.band] || 'ОБЫЧНЫЙ'} · свайп ${Math.round(s.mm || 0)} мм · ${Math.round(s.speedKmh)} км/ч`);
      lines.push(`откл ${(s.dev || 0).toFixed(0)}° · прямее ${((s.straight || 0) * 100).toFixed(0)}% · отклик ${Math.round((s.contactLag || 0) * 1000)} мс · ${s.solved ? 'цель решена' : 'цель не решена'}`);
    } else {
      lines.push('свайп: ↑ топспин · ↓ подрезка · ←/→ боковой · диагонали — комбинации');
    }
    this.el.debug.textContent = lines.join('\n');

    /* optional zone ring — off by default, calibration only */
  }


  /* ------------------------------ chrome ------------------------- */
  bind() {
    const $ = (k) => this.el[k];
    $('btnSettings').addEventListener('click', () => this.openPanel(true));
    $('panelClose').addEventListener('click', () => this.openPanel(false));
    $('panelDone').addEventListener('click', () => this.openPanel(false));
    $('panel').addEventListener('click', (e) => { if (e.target === $('panel')) this.openPanel(false); });
    $('btnSound').addEventListener('click', () => { this.game && this.game.toggleSound(); this.syncSound(); });
    $('btnFull').addEventListener('click', () => this.toggleFull());

    $('distRange').addEventListener('input', (e) => {
      const v = Number(e.target.value) / 100;
      if (this.game) this.game.setDistance(v);
      $('distOut').textContent = Math.round(v * 100) + '%';
    });

    $('serveDirs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-serve-dir]');
      if (!b || !this.game) return;
      this.game.store.settings.serveDir = b.dataset.serveDir;
      this.game.store.saveSettings();
      this.syncSettings(); this.syncAll();
    });
    $('serveSpins').addEventListener('click', (e) => {
      const b = e.target.closest('[data-serve-spin]');
      if (!b || !this.game) return;
      this.game.store.settings.serveSpin = b.dataset.serveSpin;
      this.game.store.saveSettings();
      this.syncSettings(); this.syncAll();
    });
    $('dbgToggle').addEventListener('change', (e) => {
      if (!this.game) return;
      this.game.store.settings.debug = e.target.checked;
      this.game.store.saveSettings();
    });
    $('openHistory').addEventListener('click', () => { this.openPanel(false); this.openHistory(true); });
    $('histClose').addEventListener('click', () => this.openHistory(false));
    $('history').addEventListener('click', (e) => { if (e.target === $('history')) this.openHistory(false); });
    $('histExport').addEventListener('click', () => this.exportJSON());
    $('histClear').addEventListener('click', () => {
      if (!this.game) return;
      if (!confirm('Очистить всю историю ударов и сессий?')) return;
      this.game.store.clearHistory();
      this.renderHistory();
      $('histHint').textContent = 'История очищена. Текущая сессия тоже сброшена.';
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А') this.toggleFull();
      if (e.key === 'Escape') { this.openPanel(false); this.openHistory(false); }
    });
  }

  syncSettings() {
    const s = this.game.store.settings;
    const d = this.game.store.viewDistance(this.game.isTouch);
    this.el.distRange.value = Math.round(d * 100);
    this.el.distOut.textContent = Math.round(d * 100) + '%';
    this.el.distRange.title = this.game.isTouch ? 'Для этого телефона' : 'Для этого экрана';
    for (const b of this.el.serveDirs.querySelectorAll('[data-serve-dir]'))
      b.classList.toggle('sel', b.dataset.serveDir === s.serveDir);
    for (const b of this.el.serveSpins.querySelectorAll('[data-serve-spin]'))
      b.classList.toggle('sel', b.dataset.serveSpin === s.serveSpin);
    this.el.dbgToggle.checked = !!s.debug;
  }


  syncSound() {
    const on = this.game ? this.game.store.settings.sound : true;
    this.el.btnSound.innerHTML = on ? LAB_ICON.sound : LAB_ICON.mute;
    this.el.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  openPanel(on) {
    this.el.panel.hidden = !on;
    if (on) this.syncSettings();
  }

  openHistory(on) {
    this.el.history.hidden = !on;
    if (on) this.renderHistory();
  }

  /* ------------------------------ history ------------------------ */
  renderHistory() {
    if (!this.game) return;
    const store = this.game.store;
    const sum = store.summary();
    const total = Object.values(sum).reduce((a, r) => a + r.n, 0);
    const table = Object.values(sum).reduce((a, r) => a + r.table, 0);
    const misses = store.shots.filter((r) => r.kind === 'miss').length;
    const serves = store.shots.filter((r) => r.kind === 'serve');
    const serveOk = serves.filter((r) => r.outcome === 'legal').length;
    const best = store.sessions.reduce((a, s) => Math.max(a, s.bestRally || 0), 0);
    this.el.histTotal.innerHTML = `
      <div><small>УДАРЫ</small><b>${total}</b></div>
      <div><small>НА СТОЛ</small><b>${total ? Math.round(table / total * 100) : 0}%</b></div>
      <div><small>ПРОМАХИ / ТАПЫ</small><b>${misses}</b></div>
      <div><small>ПОДАЧИ OK</small><b>${serveOk}/${serves.length}</b></div>
      <div><small>ЛУЧШАЯ СЕРИЯ</small><b>${best}</b></div>
      <div><small>СЕССИЙ</small><b>${store.sessions.length}</b></div>`;

    this.el.histSummary.innerHTML = LAB_SHOTS.map((s) => {
      const r = sum[s.id];
      const pct = r.n ? Math.round(r.table / r.n * 100) : 0;
      return `<div class="hrow">
        <b>${s.ru}</b><span class="num">${r.n}</span>
        <span class="num">${pct}% · ${r.normal}/${r.strong}/${r.weak}/${r.over}</span>
        <span class="num">${r.avgKmh ? Math.round(r.avgKmh) + ' км/ч' : ''}</span>
        <span class="bar"><i style="width:${pct}%"></i></span>
      </div>`;
    }).join('');

    const sessions = store.sessions.slice().reverse().slice(0, 12).map((x) => {
      const d = new Date(x.start);
      const day = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ` +
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const live = store.session && store.session.id === x.id;
      return `<tr><td>${day}${live ? ' · идёт' : ''}</td><td>${x.attempts || 0}</td>
        <td>${x.attempts ? Math.round((x.returns || 0) / x.attempts * 100) + '%' : '—'}</td>
        <td>${x.serveOk || 0}/${x.serves || 0}</td><td>${x.misses || 0}</td>
        <td>${x.bestRally || 0}</td></tr>`;
    }).join('');
    if (this.el.histSessions) {
      this.el.histSessions.querySelector('tbody').innerHTML = sessions ||
        '<tr><td colspan="6" style="color:#9fb1c8">Ещё не было ни одной игры.</td></tr>';
    }

    const rows = store.shots.slice(-80).reverse().map((r) => {
      const t = new Date(r.t);
      const tm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      if (r.kind === 'miss') return `<tr><td>${tm}</td><td>—</td><td>${r.band || ''}</td>
        <td>${r.mm != null ? Math.round(r.mm) + ' мм' : ''}</td>
        <td class="warnt">${r.reason || 'мимо'}</td><td>—</td><td>—</td></tr>`;
      if (r.kind === 'serve') {
        const out = r.outcome === 'legal' ? 'ок' : r.outcome === 'short' ? 'коротко'
          : r.outcome === 'net' ? 'сетка' : 'ошибка';
        return `<tr><td>${tm}</td><td>ПОДАЧА ${serveRu(r.spin)}</td><td>${dirRu(r.dir)}</td>
          <td>${r.bounces} отск.</td><td class="${r.outcome === 'legal' ? 'ok' : 'warnt'}">${out}</td>
          <td>—</td><td>—</td></tr>`;
      }
      const cls = r.outcome === 'table' ? 'ok' : r.outcome ? 'bad' : '';
      const out = r.outcome === 'table' ? 'стол' : r.outcome === 'net' ? 'сетка'
        : r.outcome === 'out' ? 'аут' : r.outcome === 'short' ? 'коротко' : (r.outcome || '—');
      return `<tr><td>${tm}</td><td>${r.shot || ''}</td>
        <td>${r.band === 'over' ? 'слишком' : r.band === 'strong' ? 'сильн.' : r.band === 'weak' ? 'слаб.' : 'обычн.'}</td>
        <td>${r.mm != null ? Math.round(r.mm) + ' мм' : ''}</td>
        <td class="${cls}">${out}</td>
        <td>${r.landing ? `${r.landing.x.toFixed(2)} / ${r.landing.z.toFixed(2)}` : ''}</td>
        <td>${r.speedKmh ? Math.round(r.speedKmh) : ''}</td></tr>`;
    }).join('');
    this.el.histTable.querySelector('tbody').innerHTML = rows ||
      '<tr><td colspan="7" style="color:#9fb1c8">Пока пусто — сделайте первый удар.</td></tr>';
    this.el.histHint.textContent =
      `Хранится ${store.shots.length} последних записей и ${store.sessions.length} игр в этом браузере. ` +
      'Под ударами: обычных / сильных / слабых / слишком сильных. ' +
      '«Жест» — сколько миллиметров провели пальцем.';
  }

  async exportJSON() {
    const text = JSON.stringify(this.game.store.exportData(), null, 1);
    try {
      await navigator.clipboard.writeText(text);
      this.el.histHint.textContent = `JSON (${(text.length / 1024).toFixed(1)} КБ) скопирован в буфер обмена.`;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); this.el.histHint.textContent = 'JSON скопирован в буфер обмена.'; }
      catch (e2) { this.el.histHint.textContent = 'Копирование недоступно в этом браузере.'; }
      ta.remove();
    }
  }

  /* ------------------------------ misc --------------------------- */
  toggleFull() {
    const d = document;
    if (!d.fullscreenElement) {
      (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen || (() => {})).call(d.documentElement);
    } else {
      (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
    }
  }

  toast(text, color) {
    if (!this.el.toast) return;
    this.el.toast.textContent = text;
    this.el.toast.style.color = color || '#fff';
    this.el.toast.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.el.toast.classList.remove('on'), 900);
  }

  blip() {
    if (this.el.toast) {
      this.el.toast.classList.remove('on');
      void this.el.toast.offsetWidth;
    }
  }

  tick() {
    if (!this.game) return;
    if (this._lastState !== this.game.state) {
      this._lastState = this.game.state;
      this.syncAll();
    }
    this.syncAll.dirty = true;
  }
}
