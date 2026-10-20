/* =====================================================================
 *  HUB — the 2026 menu shell.
 *
 *  One persistent surface: a rail, a stage, and sheets that slide over
 *  the same arena. This file only moves the menu — gameplay rules live
 *  in 12_match_rules.js and are read, never rewritten, here.
 *
 *  Motion rules: transforms and opacity only; 120–340 ms; custom
 *  ease-out; reduced-motion honoured; no animation on high-frequency
 *  keyboard actions.
 * ===================================================================== */
'use strict';

const HUB_DIFF = [
  { name: 'НОВИЧОК',  sub: 'лёгкий',   elo: '600–900',    threat: 12, tag: '01 / 05',
    scout: 'Только учится держать мяч. Даёт время на замах и почти не атакует первым.' },
  { name: 'ЛЮБИТЕЛЬ', sub: 'средний',  elo: '900–1200',   threat: 28, tag: '02 / 05',
    scout: 'Уверенно держит розыгрыш, но открывает стол под топспин. Любит средний темп.' },
  { name: 'ПРО',      sub: 'опытный',  elo: '1200–1600',  threat: 60, tag: '03 / 05',
    scout: 'Держит темп, любит длинные розыгрыши и ждёт вашу ошибку на втором ударе.' },
  { name: 'МАСТЕР',   sub: 'сложный',  elo: '1600–2100',  threat: 82, tag: '04 / 05',
    scout: 'Атакует первым и читает короткий мяч. Прощает мало, наказывает сразу.' },
  { name: 'ЛЕГЕНДА',  sub: 'максимум', elo: '2100+',      threat: 97, tag: '05 / 05',
    scout: 'Максимальная скорость и давление. Здесь помогает только чистая техника.' },
];

const HUB_PERK_COLORS = { green: '#4ee39a', blue: '#39c6ff', gold: '#ffd34d' };

class Hub {
  constructor(game) {
    this.game = game;
    this.menu = $('#menu');
    this.shell = $('#hubShell');
    this.stage = $('#hubStage');
    this.nav = $('#hubNav');
    this.toastEl = $('#hubToast');
    this.live = $('#hubLive');
    this.view = 'play';
    this.wsTab = 'racket';
    this.diff = 2;
    this.preview = { capture: 100, press: 100, aim: 85, approach: 85, sens: 100 };
    this._toastT = 0;
    this._lastCoins = -1;
    this._lastCrystals = -1;

    this.bindNav();
    this.bindActions();
    this.bindMore();
    this.bindSettings();
    this.bindCareerView();
    this.bindLaunch();
    this.bindAmbient();
    this.bindEscape();
    this.bindKeys();
    this.bindNetObserver();

    if (this.stage) this.stage.addEventListener('scroll', () => this.syncScrollHint(), { passive: true });
    this.renderLadder();
    this.renderPerkCodex();
    this.syncView('play', { silent: true });
    this.syncSettings();
    this.refresh();
  }

  /* ------------------------------ helpers --------------------------- */
  sfx(kind = 'click') {
    const a = this.game && this.game.audio;
    if (!a) return;
    /* A single press must make a single sound: the hub delegates clicks and
       some controls also speak for themselves. */
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (kind === 'click' && now - (this._sfxAt || 0) < 60) return;
    this._sfxAt = now;
    try { a.ui(kind); } catch (e) { /* audio is optional */ }
  }
  isOpen() { return !!(this.menu && this.menu.classList.contains('on')); }
  closeSheets(except) {
    $$('.screen.on').forEach((s) => {
      if (s.id === 'menu' || s === except) return;
      s.classList.remove('on');
    });
  }
  toast(text) {
    const el = this.toastEl;
    if (!el) return;
    el.textContent = text;
    el.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('on'), 2100);
  }
  announce(text) { if (this.live) this.live.textContent = text; }

  /* ------------------------------- nav ------------------------------ */
  bindNav() {
    const items = $$('#menu [data-view], #menu [data-ws-tab]');
    items.forEach((btn) => btn.addEventListener('click', () => {
      if (btn.dataset.wsTab) {
        this.sfx();
        this.openWorkshop(btn.dataset.wsTab);
        return;
      }
      const view = btn.dataset.view;
      if (!view) return;
      this.sfx();
      this.setView(view);
    }));
    $$('#menu [data-view-go]').forEach((btn) => btn.addEventListener('click', () => {
      this.sfx();
      this.setView(btn.dataset.viewGo);
    }));
    $$('#menu [data-go]').forEach((btn) => btn.addEventListener('click', () => {
      this.sfx();
      this.runAction(btn.dataset.go);
    }));
    // Arrow-key navigation through the rail, as a native tablist would do.
    if (this.nav) {
      this.nav.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        const buttons = Array.from(this.nav.querySelectorAll('.nav-btn'));
        const i = buttons.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        let next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next].focus();
      });
    }
    window.addEventListener('resize', () => { this.placeMarker(); this.syncScrollHint(); }, { passive: true });
  }

  /** The phone hint is a promise: it disappears once the page is read. */
  syncScrollHint() {
    const hint = this.menu && this.menu.querySelector('.scroll-hint');
    const stage = this.stage;
    if (!hint || !stage) return;
    const atEnd = stage.scrollHeight - stage.scrollTop - stage.clientHeight < 48;
    hint.classList.toggle('is-done', atEnd);
    hint.classList.toggle('is-idle', stage.scrollTop < 8);
  }

  setView(name, opts = {}) {
    if (!['play', 'career', 'workshop'].includes(name)) return;
    const target = name === 'play' ? $('#viewPlay') : name === 'career' ? $('#viewCareer') : $('#workshop');
    if (!target) return;
    const changed = this.view !== name;
    this.view = name;
    /* Career and online sheets hide every .screen (including the menu) for
       their own full-bleed entrance. Returning from them must bring the hub
       back, not leave a blank arena. */
    if (this.menu) this.menu.classList.add('on');
    $$('.hub-view').forEach((v) => {
      v.classList.remove('is-on');
      v.classList.remove('on');
      v.setAttribute('aria-hidden', 'true');
    });
    target.classList.add('is-on');
    target.classList.add('on');
    target.setAttribute('aria-hidden', 'false');
    this.setActive(name === 'workshop' ? (this.wsTab === 'daily' ? 'tasks' : 'workshop') : name);
    if (this.stage) this.stage.scrollTop = 0;
    if (!opts.silent) {
      const names = { play: 'Игра', career: 'Карьера', workshop: 'Мастерская' };
      this.announce('Открыт раздел: ' + names[name]);
      if (changed) {
        // Re-trigger the entrance so the stage always feels like one surface.
        target.style.animation = 'none';
        void target.offsetWidth;
        target.style.animation = '';
      }
    }
    if (name === 'career') this.renderCareer();
    if (name === 'workshop' && this.game && this.game.ui && this.game.ui.renderWorkshop) {
      this.game.ui.renderWorkshop(this.wsTab);
      this.setActive(this.wsTab === 'daily' ? 'tasks' : 'workshop');
    }
    requestAnimationFrame(() => this.placeMarker());
  }

  syncView(name, tab) {
    if (name === 'workshop' && tab) this.wsTab = tab;
    if (['play', 'career', 'workshop'].includes(name)) this.setView(name, { silent: true });
    requestAnimationFrame(() => this.placeMarker());
  }

  setActive(key) {
    $$('#hubNav .nav-btn, .hub-dock .dock-btn').forEach((b) => {
      const isView = b.dataset.view;
      const isTasks = b.dataset.wsTab === 'daily';
      const on = (isView && isView === key) || (isTasks && key === 'tasks');
      b.classList.toggle('is-on', !!on);
      if (on) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    this.activeKey = key;
    this.placeMarker();
  }

  placeMarker() {
    const marker = this.nav && this.nav.querySelector('.nav-marker');
    if (!marker || !this.nav) return;
    const active = this.nav.querySelector('.nav-btn.is-on');
    if (!active) return;
    const top = active.offsetTop;
    const h = active.offsetHeight;
    marker.style.setProperty('--nav-y', top + 'px');
    marker.style.height = Math.max(30, h - 12) + 'px';
    marker.style.transform = `translateY(${top + 6}px)`;
  }

  openWorkshop(tab) {
    this.wsTab = tab || 'racket';
    this.setView('workshop');
    if (this.stage) this.stage.scrollTop = 0;
  }

  /* ----------------------------- actions ---------------------------- */
  bindActions() {
    const click = (id, fn) => { const el = $('#' + id); if (el) el.addEventListener('click', fn); };
    click('hubSettingsBtn', () => this.openSettings());
    click('hubMoreBtn', () => this.openMore());
    click('moreFullscreen', () => { const b = $('#menuFullscreen'); if (b) b.click(); });
    click('moreSound', () => { const b = $('#menuSound'); if (b) b.click(); });
    click('settingsCalibration', () => {
      const ui = this.game && this.game.ui;
      if (!ui) return;
      ui.ensureZoneCalibration();
      ui.openShotLab();
    });
    click('settingsMoments', () => {
      const ui = this.game && this.game.ui;
      if (!ui) return;
      ui.closeSettings();
      ui.showMoments();
    });
    click('setCloseTop', () => this.game.ui.closeSettings());
    // Difficulty is authored by UI.bindMenu; the hub only mirrors its meaning.
    $$('#menu .opt[data-diff]').forEach((b) => b.addEventListener('click', () => this.setDiff(+b.dataset.diff)));
    // Quality is a real preference; sound/haptics/grip etc. go through UI.applySetting.
    $$('#menu [data-quality]').forEach((b) => b.addEventListener('click', () => {
      this.game.ui.applySetting('quality', b.dataset.quality);
      this.syncSettings();
      this.sfx();
    }));
    $$('#menu [data-set]').forEach((b) => b.addEventListener('click', () => {
      this.sfx();
      requestAnimationFrame(() => this.syncSettings());
    }));
  }

  openSettings() {
    if (!this.isOpen()) return;
    this.closeSheets($('#settings'));
    this.game.ui.openSettings();
    this.syncSettings();
  }

  setDiff(d) {
    if (!Number.isFinite(d)) return;
    const ui = this.game && this.game.ui;
    if (ui) ui.pendingDiff = clamp(d, 0, 4);
    this.renderDossier(clamp(d, 0, 4));
    this.sfx();
  }

  runAction(action) {
    const ui = this.game && this.game.ui;
    if (!ui) return;
    /* Whatever the destination, the directory sheet is only a shortcut. */
    if (action !== 'menu') {
      const more = $('#hubMore');
      if (more) more.classList.remove('on');
    }
    if (action === 'settings') { this.openSettings(); return; }
    if (action === 'training') { $('#train0') && $('#train0').click(); return; }
    if (action === 'online') { $('#onlineStart') && $('#onlineStart').click(); return; }
    if (action === 'calibration') { ui.ensureZoneCalibration(); ui.openShotLab(); return; }
    if (action === 'moments') { this.closeSheets(); ui.showMoments(); return; }
    if (action === 'demo') { $('#demoStart') && $('#demoStart').click(); return; }
    if (action === 'workshop') { this.openWorkshop('racket'); return; }
    if (action === 'tasks') { this.openWorkshop('daily'); return; }
    if (action === 'menu') { this.closeSheets(); this.setView('play'); return; }
  }

  /* ------------------------------ more ------------------------------ */
  bindMore() {
    $$('[data-more]').forEach((b) => b.addEventListener('click', () => { this.sfx(); this.openMore(); }));
    $$('[data-close-sheet]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.closeSheet;
      const el = id && document.getElementById(id);
      if (el) el.classList.remove('on');
      this.sfx();
    }));
    $$('[data-go="menu"]').forEach((b) => b.addEventListener('click', () => {
      this.closeSheets();
      this.setView('play');
      this.sfx();
    }));
    /* The "all sections" sheet lives outside #menu, so its tiles are bound
       here rather than with the rail. */
    $$('#hubMore [data-go]').forEach((b) => b.addEventListener('click', () => {
      this.sfx();
      this.runAction(b.dataset.go);
    }));
  }

  openMore() {
    const el = $('#hubMore');
    if (!el) return;
    this.closeSheets(el);
    el.classList.add('on');
    this.announce('Все разделы меню');
    requestAnimationFrame(() => {
      const first = el.querySelector('.more-tile');
      if (first) first.focus({ preventScroll: true });
    });
  }

  /* ---------------------------- career view ------------------------- */
  bindCareerView() {
    const view = $('#viewCareer');
    if (!view) return;
    view.addEventListener('click', (e) => {
      const start = e.target.closest('[data-career-start]');
      if (start) { this.sfx(); $('#careerStart') && $('#careerStart').click(); return; }
      const card = e.target.closest('.road-card');
      if (card) {
        this.sfx();
        this.toast(`ТУРНИР ${card.dataset.ix} · ${card.dataset.name} · ${card.dataset.elo} ELO`);
      }
    });
  }

  renderLadder() {
    const box = $('#hubLadder');
    if (!box || typeof TOURNAMENTS === 'undefined') return;
    const c = this.game && this.game.career;
    const active = !!(c && c.active);
    const cur = active ? c.currentTournament : 0;
    box.innerHTML = TOURNAMENTS.map((t, i) => {
      const state = active ? (i < cur ? 'won' : i === cur ? 'now' : 'next') : (i === 0 ? 'now' : 'next');
      return `<article class="road-card ${state}" data-ix="${String(i + 1).padStart(2, '0')}" data-name="${t.name}" data-elo="${t.eloMin}–${t.eloMax}">
        <div class="rc-ix"><span>${String(i + 1).padStart(2, '0')}</span><i></i></div>
        <b>${t.name}</b><small>${t.place}</small>
        <div class="rc-meta"><span>ELO <b>${t.eloMin}–${t.eloMax}</b></span><span>${t.rounds} р.</span></div>
      </article>`;
    }).join('');
  }

  renderPerkCodex() {
    const box = $('#hubPerkCodex');
    if (!box || typeof PERKS === 'undefined') return;
    box.innerHTML = PERKS.map((p) => `<div class="perk-row"><i style="background:${HUB_PERK_COLORS[p.rarity] || '#4ee39a'}"></i><div><b>${p.name}</b><small>${p.desc}</small></div></div>`).join('');
  }

  renderCareer() {
    this.renderLadder();
    const box = $('#hubCareerBody');
    const btn = $('#careerStart');
    if (!box) return;
    const g = this.game;
    const c = g && g.career;
    const p = g && g.profile && g.profile.data;
    if (!c) return;
    if (c.active) {
      const t = (typeof TOURNAMENTS !== 'undefined' && TOURNAMENTS[c.currentTournament]) || { name: 'ТУРНИР', place: '', rounds: 3 };
      box.classList.remove('idle');
      box.innerHTML = `
        <div class="cl-main"><div><b>${t.name}</b><br><span>${t.place} · РАУНД ${Math.min(c.currentRound + 1, t.rounds)} / ${t.rounds}</span></div><em>${c.perks.length} ПЕРКОВ</em></div>
        <div class="cl-stat"><small>ПОБЕД</small><b>${c.totalWins}</b></div>
        <div class="cl-stat"><small>ПОРАЖЕНИЙ</small><b>${c.totalLosses}</b></div>
        <div class="cl-stat"><small>ПЕРКОВ</small><b>${c.perks.length}</b></div>
        <div class="cl-stat"><small>МАКС. КМ/Ч</small><b>${Math.round(c.runStats.maxSpeed || 0)}</b></div>`;
      if (btn) btn.textContent = 'ПРОДОЛЖИТЬ КАРЬЕРУ';
    } else {
      const wins = (p && p.stats && p.stats.wins) || 0;
      const matches = (p && p.stats && p.stats.matches) || 0;
      const best = (p && p.stats && p.stats.bestSpeed) || 0;
      box.classList.add('idle');
      box.innerHTML = `
        <div class="cl-main"><div><b>ЗАБЕГ ЕЩЁ НЕ НАЧАТ</b><br><span>Первый турнир — «Подвальный пинг-понг» · Гараж</span></div><em>12 ТУРНИРОВ</em></div>
        <div class="cl-stat"><small>МАТЧЕЙ</small><b>${matches}</b></div>
        <div class="cl-stat"><small>ПОБЕД</small><b>${wins}</b></div>
        <div class="cl-stat"><small>ЛУЧШАЯ</small><b>${Math.round(best)}</b></div>
        <div class="cl-stat"><small>МОМЕНТОВ</small><b>${(p && p.stats && p.stats.moments) || 0}</b></div>`;
      if (btn) btn.textContent = 'НАЧАТЬ КАРЬЕРУ';
    }
  }

  /* ------------------------------ dossier --------------------------- */
  renderDossier(d) {
    const info = HUB_DIFF[clamp(d, 0, 4)];
    if (!info) return;
    const set = (id, val) => { const el = $('#' + id); if (el) el.textContent = val; };
    set('hubDiffHint', info.sub);
    set('hubDiffName', info.name);
    set('hubDiffSub', info.sub);
    set('hubDiffElo', info.elo);
    set('hubDiffTag', info.tag);
    set('hubScout', info.scout);
    set('hubThreatLabel', 'УГРОЗА ' + info.threat + '%');
    set('ctaSub', info.name + ' · ' + info.sub + ' · до 11 очков');
    const bars = $('#hubThreat');
    if (bars) {
      const n = Math.max(1, Math.round(info.threat / 20));
      Array.from(bars.children).forEach((el, i) => el.classList.toggle('on', i < n));
      bars.setAttribute('aria-label', `Уровень угрозы ${n} из 5`);
    }
    this.diff = d;
    this.refreshStats();
  }

  refreshStats() {
    const p = this.game && this.game.profile && this.game.profile.data;
    if (!p) return;
    const st = p.stats || {};
    const set = (id, val) => { const el = $('#' + id); if (el) el.textContent = val; };
    set('hubStatWins', st.wins || 0);
    set('hubStatBest', Math.round(st.bestSpeed || 0));
    set('hubStatMoments', st.moments || 0);
  }

  /* ----------------------------- settings --------------------------- */
  bindSettings() {
    $$('#settingsNav .set-nav').forEach((b) => b.addEventListener('click', () => {
      const sec = document.getElementById(b.dataset.sec);
      if (!sec) return;
      this.sfx();
      this.scrollToSection(sec);
      this.setSettingsNav(b.dataset.sec);
    }));
    const body = $('#settingsBody');
    if (body) {
      let t = 0;
      body.addEventListener('scroll', () => {
        clearTimeout(t);
        t = setTimeout(() => this.syncSettingsNavFromScroll(), 60);
      }, { passive: true });
    }
    const reset = $('#previewReset');
    if (reset) reset.addEventListener('click', () => {
      this.preview = { capture: 100, press: 100, aim: 85, approach: 85, sens: 100 };
      this.syncMeters();
      this.sfx();
      this.toast('ПРЕДПРОСМОТР СБРОШЕН · ЭТАЛОН');
    });
    $$('.meter').forEach((meter) => this.bindMeter(meter));
  }

  /** Jump to a settings section inside its own scroller.
   *  `scrollIntoView({behavior:'smooth'})` was measurably unreliable in the
   *  nested fixed overlay (it stopped mid-way and left the section hidden),
   *  so the offset is computed here and applied in one frame. */
  scrollToSection(sec) {
    const body = $('#settingsBody');
    if (!body || !sec) return;
    const top = sec.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    const sticky = body.querySelector('.settings-nav');
    const pad = 8;
    body.scrollTop = Math.max(0, Math.min(body.scrollHeight - body.clientHeight, top - pad));
    if (sticky && sticky.contains(sec)) body.scrollTop = 0;
  }

  setSettingsNav(id) {
    $$('#settingsNav .set-nav').forEach((b) => b.classList.toggle('on', b.dataset.sec === id));
  }

  syncSettingsNavFromScroll() {
    const body = $('#settingsBody');
    if (!body) return;
    const top = body.getBoundingClientRect().top + 8;
    let best = null, dist = Infinity;
    $$('#settingsBody .set-sec').forEach((sec) => {
      const d = Math.abs(sec.getBoundingClientRect().top - top);
      if (d < dist) { dist = d; best = sec.id; }
    });
    if (best) this.setSettingsNav(best);
  }

  bindMeter(meter) {
    const key = meter.dataset.meter || meter.dataset.preview;
    const isPreview = !!meter.dataset.preview;
    const spec = key === 'serveToss' ? { min: 28, max: 46, step: 1, unit: 'см' }
      : key === 'volume' ? { min: 0, max: 100, step: 1, unit: '%' }
      : key === 'sens' ? { min: 50, max: 160, step: 1, unit: '×', scale: 100 }
      : { min: 50, max: 140, step: 1, unit: '%' };
    const get = () => {
      if (key === 'serveToss') return Number(this.game.settings.serveToss) || 37;
      if (key === 'volume') return Math.round((this.game.settings.volume ?? .9) * 100);
      return this.preview[key];
    };
    const set = (raw, commit) => {
      const v = clamp(Math.round(raw / spec.step) * spec.step, spec.min, spec.max);
      if (key === 'serveToss') {
        this.game.settings.serveToss = v;
        const out = $('#serveTossVal'); if (out) out.textContent = v + ' см';
        if (commit) { this.game.saveSettings(); this.sfx(); this.toast('ВЫСОТА ПОДБРОСА · ' + v + ' СМ'); }
      } else if (key === 'volume') {
        const vol = v / 100;
        this.game.settings.volume = vol;
        this.game.audio.setVolume(vol);
        const out = $('#volumeVal'); if (out) out.textContent = v + '%';
        if (commit) { this.game.saveSettings(); this.sfx(); }
      } else {
        this.preview[key] = v;
        const out = meter.parentElement && meter.parentElement.querySelector('.meter-val');
        if (out) out.textContent = key === 'sens' ? (v / 100).toFixed(2) + '×' : Math.round(v) + '%';
        this.updatePreview(commit);
      }
      const pct = (v - spec.min) / (spec.max - spec.min) * 100;
      meter.style.setProperty('--v', pct.toFixed(2) + '%');
      meter.setAttribute('aria-valuenow', String(v));
      meter.setAttribute('aria-valuetext', key === 'sens' ? (v / 100).toFixed(2) + '×' : Math.round(v) + ' ' + spec.unit);
    };
    meter._setValue = (v, commit) => set(v, commit);
    meter._getValue = get;

    const valueFromEvent = (e) => {
      const r = meter.getBoundingClientRect();
      const pct = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      return spec.min + pct * (spec.max - spec.min);
    };
    let dragging = false;
    const down = (e) => {
      dragging = true;
      meter.classList.add('is-drag');
      try { meter.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      set(valueFromEvent(e), false);
      e.preventDefault();
    };
    const move = (e) => { if (dragging) set(valueFromEvent(e), false); };
    const up = (e) => {
      if (!dragging) return;
      dragging = false;
      meter.classList.remove('is-drag');
      set(valueFromEvent(e), true);
    };
    meter.addEventListener('pointerdown', down);
    meter.addEventListener('pointermove', move);
    meter.addEventListener('pointerup', up);
    meter.addEventListener('pointercancel', () => { dragging = false; meter.classList.remove('is-drag'); });
    meter.addEventListener('keydown', (e) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      const cur = get();
      const step = (spec.step || 1) * (e.shiftKey ? 10 : 1);
      let v = e.key === 'Home' ? spec.min : e.key === 'End' ? spec.max
        : cur + (e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : -step);
      set(v, true);
    });
    set(get(), false);
  }

  syncMeters() {
    $$('.meter').forEach((m) => {
      if (!m._setValue) return;
      const key = m.dataset.meter || m.dataset.preview;
      if (key === 'serveToss') m._setValue(Number(this.game.settings.serveToss) || 37, false);
      else if (key === 'volume') m._setValue(Math.round((this.game.settings.volume ?? .9) * 100), false);
      else m._setValue(this.preview[key], false);
    });
    this.updatePreview(false);
  }

  updatePreview(commit) {
    const stage = $('#assistPreview');
    if (!stage) return;
    const p = this.preview;
    stage.style.setProperty('--cap', (84 * p.capture / 100).toFixed(1) + 'px');
    stage.style.setProperty('--press', (58 * p.press / 100).toFixed(1) + 'px');
    stage.style.setProperty('--aim', (24 * p.aim / 85).toFixed(1) + 'px');
    stage.style.setProperty('--sens', (1 + (p.sens - 100) / 200).toFixed(2));
    if (commit) this.toast('ПРЕДПРОСМОТР · ПРАВИЛА МАТЧА НЕ МЕНЯЮТСЯ');
  }

  syncSettings() {
    const s = this.game && this.game.settings;
    if (!s) return;
    const val = (key) => {
      const v = s[key];
      if (typeof v === 'boolean') return v ? 'on' : 'off';
      return String(v);
    };
    $$('#settings [data-set]').forEach((b) => {
      const key = b.dataset.set;
      if (!['grip', 'hand', 'gestureProfile', 'showPlayerPaddle', 'trail', 'predict', 'sound', 'haptics', 'coach', 'adaptive'].includes(key)) return;
      const selected = b.dataset.val === val(key);
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', String(selected));
    });
    $$('#settings [data-quality]').forEach((b) => {
      const selected = b.dataset.quality === s.quality;
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', String(selected));
    });
    this.syncMeters();
  }

  /* ------------------------------ launch ---------------------------- */
  bindLaunch() {
    const play = $('#play');
    const veil = $('#launch');
    if (!play || !veil) return;
    play.addEventListener('click', () => {
      veil.classList.remove('go');
      void veil.offsetWidth;
      veil.classList.add('go');
      clearTimeout(this._launchT);
      this._launchT = setTimeout(() => veil.classList.remove('go'), 860);
    });
  }

  /* ----------------------------- ambient ---------------------------- */
  bindAmbient() {
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = !!(reduced && reduced.matches);
    if (reduced && reduced.addEventListener) reduced.addEventListener('change', (e) => { this.reduced = e.matches; });
    const amb = this.menu && this.menu.querySelector('.hub-ambient');
    if (!amb || !window.matchMedia || !window.matchMedia('(pointer:fine)').matches) return;
    let raf = 0, tx = 0, ty = 0;
    this.menu.addEventListener('pointermove', (e) => {
      if (this.reduced || !this.isOpen()) return;
      tx = (e.clientX / window.innerWidth - .5) * 10;
      ty = (e.clientY / window.innerHeight - .5) * 8;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        amb.style.transform = `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0)`;
      });
    }, { passive: true });
  }

  /* ------------------------------- keys ----------------------------- */
  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const onButton = !!(t && t.closest && t.closest('button,a,[role="slider"]'));
      /* Enter starts the match from the hub itself, exactly as the footer
         promises. On a focused button the browser already sends a click. */
      if ((e.key === 'Enter' || e.key === ' ') && !onButton && this.isOpen() &&
          !$('#settings').classList.contains('on') && !$('#hubMore').classList.contains('on') &&
          !$('.sheet.on')) {
        e.preventDefault();
        this.sfx();
        const play = $('#play');
        if (play) play.click();
      }
    });
    /* One sound for every control in the menu, including ones that only
       change a CSS class. `audio.ui` is initialised on the first gesture. */
    document.getElementById('app').addEventListener('pointerdown', (e) => {
      const btn = e.target.closest && e.target.closest('button, [role="slider"], .opt');
      if (!btn || !btn.closest('#menu, .screen')) return;
      if (btn.disabled) return;
      this.sfx();
    }, { passive: true, capture: true });
  }

  /* ------------------------------ escape ---------------------------- */
  bindEscape() {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = (id) => { const el = document.getElementById(id); return !!(el && el.classList.contains('on')); };
      if (open('hubMore')) { $('#hubMore').classList.remove('on'); e.preventDefault(); return; }
      if (open('settings')) { this.game.ui.closeSettings(); e.preventDefault(); return; }
      if (open('reels')) { $('#reels').classList.remove('on'); e.preventDefault(); return; }
      if (open('onlineLobby')) { $('#onlineLobby').classList.remove('on'); e.preventDefault(); return; }
      if (open('careerIntro') || open('careerPerk') || open('careerEnd')) {
        this.closeSheets(); this.setView('career'); e.preventDefault();
      }
      // #shotLab is closed by the UI capture listener above.
    });
  }

  /* --------------------------- online steps ------------------------- */
  bindNetObserver() {
    const st = $('#netStatus');
    if (!st || typeof MutationObserver === 'undefined') return;
    const sync = () => {
      const t = st.textContent || '';
      const step = /Ошибка/i.test(t) ? 1 : /Подключено|хост|Подключены/i.test(t) ? 2 : /Подключение/i.test(t) ? 0 : 1;
      const steps = $$('.net-steps span');
      steps.forEach((el, i) => el.classList.toggle('on', i <= step));
    };
    new MutationObserver(sync).observe(st, { childList: true, characterData: true, subtree: true });
    sync();
  }

  /* ------------------------------ wallet ---------------------------- */
  bump(el) {
    if (!el || this.reduced) return;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 520);
  }

  refresh() {
    const g = this.game;
    const p = g && g.profile && g.profile.data;
    if (!p) return;
    const set = (id, v) => { const el = $('#' + id); if (el) el.textContent = v; };
    const coins = p.coins || 0, crystals = p.crystals || 0;
    if (this._lastCoins >= 0 && coins !== this._lastCoins) this.bump($('#hubCoins'));
    if (this._lastCrystals >= 0 && crystals !== this._lastCrystals) this.bump($('#hubCrystals'));
    this._lastCoins = coins; this._lastCrystals = crystals;
    set('hubCoins', coins);
    set('hubCrystals', crystals);
    set('wsCoins', coins + ' монет');
    const done = (p.daily && p.daily.done && p.daily.done.length) || 0;
    set('wsStreak', 'серия ' + (p.streak || 0) + ' · ' + done + '/6');
    const dailyFill = $('#hubDailyFill'); if (dailyFill) dailyFill.style.width = (done / 6 * 100) + '%';
    const lv = (typeof g.profile.seasonLevel === 'function') ? g.profile.seasonLevel() : Math.max(1, Math.floor((p.xp || 0) / 500) + 1);
    const prog = (typeof g.profile.seasonProgress === 'function') ? g.profile.seasonProgress() : 0;
    set('hubSeasonText', 'УРОВЕНЬ ' + lv);
    set('hubSeasonLvl', 'УРОВЕНЬ ' + lv + ' / 60');
    set('hubXpText', ((p.season && p.season.xp) || 0) + ' ОПЫТА');
    const fill = $('#hubSeasonFill');
    if (fill) fill.style.width = (prog * 100).toFixed(1) + '%';
    const bar = fill && fill.parentElement;
    if (bar) bar.setAttribute('aria-valuenow', String(Math.round(prog * 100)));
    const kicker = $('#hubHeroKicker');
    const c = g.career;
    if (kicker) {
      if (c && c.active) {
        const t = TOURNAMENTS[c.currentTournament];
        kicker.textContent = 'КАРЬЕРА · ' + (t ? t.name : 'ТУРНИР').toUpperCase() + ' · РАУНД ' + (c.currentRound + 1);
      } else kicker.textContent = 'БЫСТРЫЙ МАТЧ · ДО 11';
    }
    this.refreshStats();
    this.renderCareer();
    const sel = $$('#menu .opt[data-diff]').find((b) => b.classList.contains('sel'));
    if (sel) this.renderDossier(+sel.dataset.diff);
    else this.renderDossier(this.diff);
  }

  /* ------------------------------ enter ----------------------------- */
  enter() {
    /* The menu must show the difficulty that will actually be played:
       `pendingDiff` is the pending choice, settings are what was saved. */
    const ui = this.game && this.game.ui;
    const d = ui && Number.isFinite(ui.pendingDiff) ? ui.pendingDiff : (this.game.settings.difficulty ?? 2);
    this.syncDiffButtons(d);
    this.syncView('play', { silent: true });
    this.refresh();
    this.placeMarker();
    this.syncScrollHint();
  }

  syncDiffButtons(d) {
    $$('#menu .opt[data-diff]').forEach((b) => {
      const on = +b.dataset.diff === d;
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', String(on));
    });
    this.renderDossier(Math.max(0, Math.min(4, d)));
  }
}
