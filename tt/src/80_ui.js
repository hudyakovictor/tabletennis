/* =====================================================================
 *  UI — HUD, menus, the 2D coaching layer.
 *
 *  One evidence-based shot badge in the reading band, one score, and
 *  timing brackets on the actual ball. No competing input marker.
 * ===================================================================== */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

class UI {
  constructor() {
    this.game = null;
    this.fx = $('#fx');
    this.fxg = this.fx.getContext('2d');
    this.shotTimer = 0;
    this.noteTimer = 0;
    this.ripples = [];
    this.captureDebug = false;
    this.zoneCal = null; this.zoneCalAfterId = 0;

    // UI Animation system (99-level polish)
    this.uiAnim = new UIAnimation();
    this.hudAnim = new HUDAnimation(this);
    this.motionQuery = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = !!(this.motionQuery && this.motionQuery.matches);
    if (this.motionQuery) {
      const onMotionPreference = (event) => {
        this.reducedMotion = !!event.matches;
        if (this.reducedMotion) this._lastRibbon = null;
      };
      if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', onMotionPreference);
      else if (this.motionQuery.addListener) this.motionQuery.addListener(onMotionPreference);
    }
    this._pv = {};
    this._pv2 = {};
    this.inputMode = detectInputMode();
    this.hasFinePointer = this.inputMode === 'mouse';
    document.addEventListener('pointerdown', e => this.setInputMode(e.pointerType), { capture: true, passive: true });
    this.bindMenu();
    this.resize();
    window.addEventListener('resize', () => { this.resize(); this.syncMenuScrollHint(); });
    this.dialogObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => this.syncDialogFocus()) : null;
    if (this.dialogObserver) this.dialogObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') this.trapDialogFocus(event);
      if (event.key === 'Escape' && $('#shotLab').classList.contains('on')) { event.preventDefault(); this.closeShotLab(); }
    }, true);
  }
  attach(game) {
    this.game = game;
    this.syncDialogFocus();
    this.pendingDiff = game.settings.difficulty;
    this.updateInputCopy();
    this.syncSettings();
    this.syncFullscreen();
    this.syncSoundControls();
    this.syncPauseControl();
    this.refreshMenuBits();
    this.syncMenuScrollHint();

    // Setup UI animations
    if (this.uiAnim) {
      this.uiAnim.clear();
    }
    if (this.hudAnim) {
      this.hudAnim.setupScoreDisplay();
    }

    this.game.analytics && this.game.analytics.send('session:start', {
      platform: this.game.platform.label, touch: this.game.platform.touch,
      level: this.game.profile.data.level, coins: this.game.profile.data.coins,
    });
  }

  activeDialog() {
    const screens = $$('.screen.on[aria-modal="true"]');
    if (screens.length) return screens[screens.length - 1];
    return this.game && this.game.paused ? $('#pauseInd') : null;
  }
  dialogFocusables(dialog) {
    if (!dialog) return [];
    return Array.from(dialog.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.hidden && el.getAttribute('aria-hidden') !== 'true' && el.getClientRects().length > 0);
  }
  syncDialogFocus() {
    const dialog = this.activeDialog();
    if (dialog === this._focusDialog) return;
    this._focusDialog = dialog;
    if (!dialog) {
      const previous = this._dialogReturnFocus;
      this._dialogReturnFocus = null;
      requestAnimationFrame(() => {
        if (this.activeDialog()) return;
        const owner = previous && previous.closest && previous.closest('.screen');
        const pauseOwner = previous && previous.closest && previous.closest('#pauseInd');
        const stillVisible = previous && previous.isConnected &&
          (!owner || owner.classList.contains('on')) && (!pauseOwner || (this.game && this.game.paused));
        if (stillVisible && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
        else if (this.game && this.game.state !== GS.MENU && this.game.state !== GS.MATCH_END) $('#gl').focus({ preventScroll: true });
      });
      return;
    }
    if (!this._dialogReturnFocus) this._dialogReturnFocus = document.activeElement;
    requestAnimationFrame(() => {
      if (this.activeDialog() !== dialog) return;
      const target = dialog.id === 'menu' ? $('#play') : this.dialogFocusables(dialog)[0];
      if (target) target.focus({ preventScroll: true });
      else {
        if (!dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
        dialog.focus({ preventScroll: true });
      }
    });
  }
  trapDialogFocus(event) {
    const dialog = this.activeDialog();
    if (!dialog) return;
    const items = this.dialogFocusables(dialog);
    if (!items.length) { event.preventDefault(); dialog.focus(); return; }
    const first = items[0], last = items[items.length - 1], active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault(); first.focus();
    }
  }

  setInputMode(pointerType) {
    const mode = pointerType === 'touch' || pointerType === 'pen' ? 'touch' : pointerType === 'mouse' ? 'mouse' : null;
    if (!mode || mode === this.inputMode) return;
    this.inputMode = mode; this.hasFinePointer = mode === 'mouse';
    if (mode === 'touch' && this.game) {
      this.game.cameraControls.zoom = 1; this.game.cameraControls.height = 0;
    }
    this.updateInputCopy();
  }
  updateInputCopy() {
    const touch = this.inputMode === 'touch';
    $('#cameraHelp').textContent = touch ? 'Виды настроены. Выберите удобный.' : 'Колесо — масштаб. ПКМ ↕ — высота.';
    $('#gl').setAttribute('aria-label', touch ? 'Игровое поле. Удар — свайп. Камера — в настройках.'
      : 'Игровое поле. Удар — ЛКМ и движение. Колесо — масштаб, ПКМ вверх/вниз — высота камеры, C — сброс.');
    if (this.game && this.game.training) this.trainSync(this.game.training);
  }

  openSettings() {
    this.syncSettings();
    this._settingsWasPaused = this.game.paused;
    this.game.setPaused(true);
    $('#settings').classList.add('on');
    this.renderZonePreview();   // draw now that the panel has a real size
  }
  closeSettings() {
    $('#settings').classList.remove('on');
    if (!this._settingsWasPaused) this.game.setPaused(false);
    this.game.profile.save(true);
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.getElementById('app').requestFullscreen)
        await document.getElementById('app').requestFullscreen();
    } catch (_) { /* embedding browsers may not grant fullscreen */ }
    this.game && this.game.resize(); this.resize();
    this.syncFullscreen();
  }
  syncFullscreen() {
    const app = document.getElementById('app');
    const supported = !!(app && typeof app.requestFullscreen === 'function' && document.fullscreenEnabled !== false);
    const on = !!document.fullscreenElement;
    for (const button of [$('#btnFullscreen'), $('#menuFullscreen')]) {
      if (!button) continue;
      button.hidden = !supported;
      button.innerHTML = ICON.fullscreen;
      button.setAttribute('aria-pressed', String(on));
      button.title = on ? 'Выйти из полного экрана (F)' : 'Полный экран (F)';
      button.setAttribute('aria-label', button.title);
    }
  }
  syncSoundControls() {
    if (!this.game) return;
    const on = !!this.game.settings.sound;
    const label = on ? 'Выключить звук' : 'Включить звук';
    for (const button of [$('#btnSound'), $('#menuSound')]) {
      if (!button) continue;
      button.innerHTML = on ? ICON.sound : ICON.mute;
      button.setAttribute('aria-pressed', String(on));
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }
  syncPauseControl() {
    const button = $('#btnMenu'), g = this.game;
    if (!button || !g) return;
    const key = `${g.state}|${g.paused}`;
    if (button.dataset.syncState === key) return;
    button.dataset.syncState = key;
    const inPlay = g.state !== GS.MENU && g.state !== GS.MATCH_END;
    const label = g.paused ? 'В главное меню' : 'Пауза';
    button.innerHTML = g.paused ? ICON.menu : ICON.pause;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-pressed', String(!g.paused && inPlay));
  }
  toggleSound() {
    const g = this.game;
    if (!g) return;
    g.settings.sound = !g.settings.sound;
    g.audio.setMuted(!g.settings.sound);
    g.saveSettings();
    this.syncSoundControls();
  }

  showMainMenu() {
    clearTimeout(this._careerTimer);
    this.game.returnToMenu();
    $$('.screen').forEach(s => s.classList.remove('on'));
    $('#menu').classList.add('on');
    this.game.audio.menuMusic(true);
    this.refreshMenuBits();
    this.syncMenuScrollHint();
  }

  syncMenuScrollHint() {
    const card = $('#menu .card');
    if (!card) return;
    const update = () => {
      const needed = card.scrollHeight > card.clientHeight + 2;
      card.classList.toggle('scroll-needed', needed);
      card.classList.toggle('scroll-start', needed && card.scrollTop < 24);
    };
    if (!card.dataset.scrollHintBound) {
      card.dataset.scrollHintBound = 'true';
      card.addEventListener('scroll', update, { passive: true });
    }
    update();
  }

  resize() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    /* Size the overlay against the same rect the pointer is normalised
     * against in Game.bindInput (the #gl box). window.innerWidth disagrees
     * with it in embedded frames, which slides every projected cue away
     * from the 3D scene it is supposed to mark. */
    const gl = document.getElementById('gl');
    const r = gl ? gl.getBoundingClientRect() : null;
    const w = (r && r.width) || window.innerWidth;
    const h = (r && r.height) || window.innerHeight;
    const pw = Math.floor(w * d), ph = Math.floor(h * d);
    if (this.fx.width !== pw || this.fx.height !== ph) {
      this.fx.width = pw;
      this.fx.height = ph;
    }
    this.fx.style.width = w + 'px';
    this.fx.style.height = h + 'px';
    this.dpr = d;
    this.fxw = w; this.fyh = h;
  }

  /* ------------------------------ menu ---------------------------- */
  bindMenu() {
    $$('#menu .opt[data-diff]').forEach((b) => b.addEventListener('click', () => {
      $$('#menu .opt[data-diff]').forEach((x) => {
        const selected = x === b;
        x.classList.toggle('sel', selected);
        x.setAttribute('aria-pressed', String(selected));
      });
      this.pendingDiff = +b.dataset.diff;
      if (this.game) this.game.audio.ui('click');
    }));
    $$('.opt[data-set]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.set, v = b.dataset.val;
      $$(`.opt[data-set="${k}"]`).forEach((x) => {
        x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false');
      });
      b.setAttribute('aria-pressed', 'true');
      b.classList.add('sel');
      this.applySetting(k, v);
    }));
    $$('input[type=range][data-set]').forEach((r) => r.addEventListener('input', () => {
      this.applySetting(r.dataset.set, +r.value);
    }));
    const startMatch = () => {
      const d = this.pendingDiff !== undefined ? this.pendingDiff : 2;
      $$('.screen').forEach((s) => s.classList.remove('on'));
      this.game.audio.menuMusic(false);
      document.body.classList.add('is-playing');
      this.trainHide();
      this.game.training = null;
      this.game.analytics && this.game.analytics.send('match:start', { diff: d, mode: 'casual', assist: this.game.settings.assist });
      this.game.career.stop();
      this.game.network.disconnect();
      this.game.startMatch(d);
    };
    const startTrain = () => {
      $$('.screen').forEach((s) => s.classList.remove('on'));
      this.game.audio.menuMusic(false);
      document.body.classList.add('is-playing');
      this.game.analytics && this.game.analytics.send('tutorial:start', {});
      this.game.startTraining();
    };
    $('#play').addEventListener('click', startMatch);
    $('#tdPlay').addEventListener('click', startMatch);
    $('#train0').addEventListener('click', startTrain);
    $('#tdAgain').addEventListener('click', startTrain);
    $('#trSkip').addEventListener('click', () => { const t = this.game.training; if (t && this.game.paused) { t.skip(); this.game.setPaused(false); this.game.audio.ui('click'); } });
    $('#trExit').addEventListener('click', () => { if (this.game.paused) this.showMainMenu(); });
    /* The preview is opt-in: this button shows the lesson on a loop and the
     * same button takes it back. Nothing starts it on its own, so the racket
     * is never pulled out of a pupil's hand. */
    const trDemoBtn = $('#trDemo');
    if (trDemoBtn) trDemoBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = this.game.training;
      if (!t) return;
      this.game.audio.init(); this.game.audio.resume(); this.game.audio.ui('click');
      if (t.isDemo()) t.exitDemo(); else t.playDemo();
    });
    /* --- workshop / shop / daily --- */
    const wsOpen = (tab) => {
      this.game.audio.ui('click');
      this.game.audio.menuMusic(false);
      this.game.analytics && this.game.analytics.send('ui:workshop', { tab: tab || 'racket' });
      $$('.screen').forEach((x) => x.classList.remove('on'));
      this.pick = null;                       // a fresh visit starts from what is fitted
      this.showWorkshop(tab || 'racket');
    };
    $('#wsOpen').addEventListener('click', () => wsOpen('racket'));
    $('#dailyOpen').addEventListener('click', () => wsOpen('daily'));
    $('#wsClose').addEventListener('click', () => {
      $('#workshop').classList.remove('on');
      $('#menu').classList.add('on');
      this.game.audio.ui('click');
    });
    $$('#workshop .tab').forEach((b) => b.addEventListener('click', () => this.showWorkshop(b.dataset.tab)));
    $('#wsEquip').addEventListener('click', () => this.equipSelection());
    $('#wsBuyCry').addEventListener('click', () => this.buySelectionCrystals());
    $('#adCoins').addEventListener('click', () => this.watchAd());
    $('#btnSettings').addEventListener('click', () => $('#settings').classList.contains('on') ? this.closeSettings() : this.openSettings());
    const btnMenuSet = $('#menuOpenSettings');
    if (btnMenuSet) btnMenuSet.addEventListener('click', () => this.openSettings());
    const btnPauseSet = $('#pauseSettings');
    if (btnPauseSet) btnPauseSet.addEventListener('click', (e) => { e.stopPropagation(); this.openSettings(); });
    $('#setClose').addEventListener('click', () => this.closeSettings());
    $$('#cameraViews [data-camera]').forEach(button => button.addEventListener('click', () => this.game.setCameraPreset(button.dataset.camera)));
    $('#camReset').addEventListener('click', () => this.game.camReset());
    $('#btnMenu').addEventListener('click', () => {
      if (this.game.paused) this.showMainMenu();
      else this.game.setPaused(true);
      this.syncPauseControl();
    });
    $('#menuFullscreen').addEventListener('click', () => this.toggleFullscreen());
    $('#menuSound').addEventListener('click', () => this.toggleSound());
    const startDemo = () => {
      $$('.screen').forEach((s) => s.classList.remove('on'));
      document.body.classList.add('is-playing');
      this.trainHide();
      this.game.training = null;
      this.game.career.stop();
      this.game.network.disconnect();
      this.game.startDemo(2);
    };
    const bDemo = $('#demoStart');
    if (bDemo) bDemo.addEventListener('click', startDemo);
    const bDemoExit = $('#btnDemoExit');
    if (bDemoExit) bDemoExit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.game.stopDemo();
    });
    for (const id of ['#shotLabPause', '#shotLabResults']) $(id).addEventListener('click', e => { e.stopPropagation(); this.openShotLab(); });
    const logButton = $('#inputLogPause');
    if (logButton) logButton.addEventListener('click', e => { e.stopPropagation(); this.exportInputLog(); });
    const calMenu = $('#zoneCalMenu');
    if (calMenu) calMenu.addEventListener('click', () => { this.ensureZoneCalibration(); this.openShotLab(); });
    const calStart = $('#zoneCalStart');
    if (calStart) calStart.addEventListener('click', () => { this.zoneCal = null; this.ensureZoneCalibration(); this.renderZoneCalibration(); });
    const calImport = $('#zoneCalImport');
    if (calImport) calImport.addEventListener('click', () => { this.ensureZoneCalibration(); this.importZoneCalibration(); this.renderZoneCalibration(); });
    const calExport = $('#zoneCalExport');
    if (calExport) calExport.addEventListener('click', () => this.exportZoneCalibration());
    $('#shotLabClose').addEventListener('click', () => this.closeShotLab());
    $('#shotLabExport').addEventListener('click', () => this.exportShotLab());
    for (const id of ['#captureDebugPause', '#captureDebugLab']) $(id).addEventListener('change', event => {
      this.captureDebug = event.target.checked;
      for (const selector of ['#captureDebugPause', '#captureDebugLab']) $(selector).checked = this.captureDebug;
      this.syncNativeCursor();
    });

    const pResume = $('#pauseResume'), pMenu = $('#pauseToMenu');
    if (pResume) pResume.addEventListener('click', (e) => { e.stopPropagation(); this.game.setPaused(false); });
    if (pMenu) pMenu.addEventListener('click', (e) => {
      e.stopPropagation(); this.showMainMenu();
    });
    $('#btnFullscreen').addEventListener('click', () => this.toggleFullscreen());
    document.addEventListener('fullscreenchange', () => { this.game && this.game.resize(); this.resize(); this.syncFullscreen(); });
    window.addEventListener('keydown', e => {
      if (e.key.toLowerCase() === 'f' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey &&
          !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) { e.preventDefault(); this.toggleFullscreen(); }
    });
    $('#btnSound').addEventListener('click', () => this.toggleSound());
    /* Spin dial: one tap cycles МЕНЬШЕ -> НОРМА -> БОЛЬШЕ. It biases how much
       of the contact is brush (more spin, less pace) and how much is punch. */
    const sbEl = $('#spinBias');
    if (sbEl) sbEl.addEventListener('click', () => {
      const g = this.game; if (!g) return;
      const order = ['low', 'norm', 'high'];
      const i = order.indexOf(g.settings.spinBias || 'norm');
      g.settings.spinBias = order[(i + 1) % order.length];
      g.saveSettings();
      g.audio.init(); g.audio.ui('click');
      this.syncSpinBias();
    });
    window.addEventListener('keydown', (e) => {
      if ($('#shotLab').classList.contains('on')) return;
      if ((e.key === 'Shift' || e.key === ' ') && !e.repeat && this.game && this.game.replayer.on) {
        this.game.skipReplay(); e.preventDefault(); return;
      }
      if ((e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь')) this.showMoments();
    });
    $('#reelSkip').addEventListener('click', () => this.game && this.game.skipReplay());
    $('#reelsClose').addEventListener('click', () => { $('#reels').classList.remove('on'); this.game && this.game.audio.ui('click'); });
    $('#again').addEventListener('click', () => { $('#over').classList.remove('on'); this.game.restart(); });
    $('#backMenu').addEventListener('click', () => this.showMainMenu());
  }

  /* -------------------------- best moments ------------------------- */

  /** A rally just got into the top list: say so, briefly, without pause. */
  flashMoment(m, idx) {
    const t = $('#mnToast');
    if (!t) return;
    const n = this.game.moments.kept.length;
    t.textContent = idx === 0 && n > 1 ? 'ЛУЧШИЙ МОМЕНТ МАТЧА'
      : 'В КОПИЛКУ МОМЕНТОВ · ' + m.shots + ' УДАРОВ';
    t.classList.add('on');
    clearTimeout(this._mnT);
    this._mnT = setTimeout(() => t.classList.remove('on'), 1700);
    if (idx === 0) this.game.audio.crowd && this.game.audio.crowd(0.5);
  }

  /** Cinematic chrome: letterbox, title card, "skip". */
  replayShow(on, moment, hero) {
    const r = $('#reel');
    if (!r) return;
    r.classList.toggle('on', !!on);
    r.classList.toggle('hero', !!hero);
    r.setAttribute('aria-hidden', String(!on));
    document.body.classList.toggle('is-reel', !!on);
    if (!on && document.activeElement === $('#reelSkip')) {
      const dialog = this.activeDialog();
      const target = dialog ? (this.dialogFocusables(dialog)[0] || dialog) : $('#gl');
      if (target) target.focus({ preventScroll: true });
    }
    if (!on || !moment) return;
    const names = { SMASH: 'СМЕШ', LOOP: 'ТОПСПИН', COUNTER: 'КОНТРАТАКА', DRIVE: 'НАКАТ',
      FLICK: 'ФЛИК', LOB: 'СВЕЧА', CHOP: 'ПОДРЕЗКА', PUSH: 'ТОЛЧОК', BLOCK: 'БЛОК',
      SIDE: 'БОКОВАЯ', HOOK: 'КРЮК', FADE: 'ФЕЙД', DROP: 'КОРОТКИЙ', SERVE_TOP: 'ПОДАЧА',
      SERVE_FAST: 'ПОДАЧА', SERVE_SIDE: 'ПОДАЧА', SERVE_BACK: 'ПОДАЧА' };
    $('#reelTag').textContent = hero ? 'ЛУЧШИЙ МОМЕНТ МАТЧА' : 'МОМЕНТ МАТЧА';
    $('#reelTitle').textContent = (names[moment.finish] || moment.finish || 'РОЗЫГРЫШ')
      + (moment.winner > 0 ? ' \u00b7 ОЧКО ВАШЕ' : '');
    $('#reelMeta').textContent = moment.shots + ' УДАРОВ \u00b7 ' + Math.round(moment.speed) + ' КМ/Ч \u00b7 '
      + Math.round(moment.spin) + ' ОБ/С \u00b7 РЕПЛЕЙ 0.35\u00d7';
  }

  /** The library: three best rallies of the match, newest score first. */
  showMoments() {
    const g = this.game; if (!g) return;
    const kept = g.moments.kept.slice(0, 3);
    if (!kept.length) return;
    const list = $('#momentList');
    list.innerHTML = kept.map((m, i) => {
      const bars = Math.round(clamp(m.score / 0.85, 0, 1) * 5);
      const st = Array.from({ length: 5 }, (_, k) => `<i class="${k < bars ? 'f' : ''}"></i>`).join('');
      const names = { SMASH: 'смеш', LOOP: 'топспин', COUNTER: 'контратака', DRIVE: 'накат', FLICK: 'флик',
        LOB: 'свеча', CHOP: 'подрезка', PUSH: 'толчок', BLOCK: 'блок', SIDE: 'боковая', HOOK: 'крюк', FADE: 'фейд', DROP: 'короткий' };
      const why = [m.meta.matchPoint ? 'матчбол' : '', m.meta.deuce ? 'счёт 10-10' : '', m.meta.netClip ? 'по краю сетки' : '',
        m.meta.deficit >= 2 ? 'отставал ' + m.meta.deficit + ':' + 0 : '', m.shots >= 12 ? 'долгий розыгрыш' : ''].filter(Boolean)[0] || 'чисто исполнено';
      return `<button class="mrow" data-i="${i}"><span class="num">${i + 1}</span>
        <span class="d"><b>${(names[m.finish] || m.finish)} · ${m.shots} ударов</b>
        <small>${Math.round(m.speed)} км/ч · ${Math.round(m.spin)} об/с · ${why}</small></span>
        <span class="st">${st}</span><span class="go">СМОТРЕТЬ \u203a</span></button>`;
    }).join('');
    Array.from(list.querySelectorAll('.mrow')).forEach((b) => b.addEventListener('click', () => {
      $('#reels').classList.remove('on');
      g.watchMoment(g.moments.kept[+b.dataset.i], true);
    }));
    $('#reels').classList.add('on');
  }

  /* --------------------- workshop · shop · daily ------------------- */

  showWorkshop(tab) {
    const g = this.game, p = g.profile;
    if (!p) return;
    $$('#workshop .tab').forEach((b) => {
      const selected = b.dataset.tab === tab;
      b.classList.toggle('on', selected);
      b.setAttribute('aria-pressed', String(selected));
    });
    $$('#workshop .pane').forEach((x) => x.classList.remove('on'));
    $('#pane' + (tab === 'racket' ? 'Racket' : tab === 'shop' ? 'Shop' : 'Daily')).classList.add('on');
    $('#wsBal').textContent = p.data.coins;
    $('#wsCry').textContent = p.data.crystals;
    if (!this.pick) this.pick = { blade: p.data.equip.blade, fh: p.data.equip.fh, bh: p.data.equip.bh };
    this.drawItemList('listBlade', 'blade', this.pick.blade);
    this.drawItemList('listFh', 'rubber', this.pick.fh);
    this.drawItemList('listBh', 'rubber', this.pick.bh);
    this.drawStatCard();
    this.drawShop();
    this.drawDaily();
    $('#workshop').classList.add('on');
  }

  drawItemList(sel, kind, current) {
    const p = this.game.profile;
    const box = $('#' + sel);
    box.innerHTML = ITEMS_ORDER.filter((it) => it.kind === kind).map((it) => {
      const owned = p.owns(it.id);
      const sw = it.kind === 'blade' ? it.wood : it.col;
      const col = `rgb(${sw.map((c) => Math.round(c * 255)).join(',')})`;
      const price = it.price ? `<span class="pr">${it.price}</span>` : '';
      const cry = !owned && it.crystals ? ` <em class="cry">${it.crystals} \u25c8</em>` : '';
      return `<button class="irow${it.id === current ? ' sel' : ''}${owned ? '' : ' locked'}" data-id="${it.id}">
        <span class="sw" style="background:${col}"></span>
        <span class="d"><b>${it.name}</b><small>${it.ru}${owned ? '' : ' · не куплено'}</small></span>${cry}${price}</button>`;
    }).join('');
    Array.from(box.querySelectorAll('.irow')).forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.id, it = ITEMS[id];
      if (!it) return;                 // a stale row from a previous render
      /* the list is re-rendered on every action, so a click that arrives
         after a re-render has a detached button: ask the DOM carefully */
      const owner = b.parentElement || b.closest('.ilist');
      const slot = it.kind === 'blade' ? 'blade' : (owner && owner.id === 'listBh' ? 'bh' : 'fh');
      if (!this.game.profile.owns(id)) {
        const ok = this.game.shop.buyRacket(id);
        if (!ok) { this.toast('НЕ ХВАТАЕТ МОНЕТ · ' + it.price); this.game.audio.ui('deny'); return; }
        this.toast('КУПЛЕНО · ' + it.name);
        this.game.audio.ui('buy');
        $('#wsBal').textContent = this.game.profile.data.coins;
        this.drawShop();
      }
      this.pick[slot] = id;
      this.showWorkshop('racket');
    }));
  }

  drawStatCard() {
    const t = racketStats(this.pick.blade, this.pick.fh, this.pick.bh);
    const eq = new Equipment(this.pick.blade, this.pick.fh, this.pick.bh);
    const cur = this.game.equip;
    const fitted = this.game.profile.data.equip;
    const dirty = this.pick.blade !== fitted.blade || this.pick.fh !== fitted.fh || this.pick.bh !== fitted.bh;
    $('#wsEquip').textContent = dirty ? 'ПОСТАВИТЬ В ИГРУ' : 'ЭТА РАКЕТКА УЖЕ В ИГРЕ';
    $('#wsEquip').disabled = !dirty;
    const bladeItem = ITEMS[this.pick.blade];
    const buyCry = $('#wsBuyCry');
    if (buyCry) {
      const show = !this.game.profile.owns(this.pick.blade) && !!bladeItem.crystals;
      buyCry.style.display = show ? '' : 'none';
      /* keep a real name on the button even while it is hidden: an empty
         button is what screen readers announce as "button" */
      buyCry.textContent = show ? '\u041a\u0423\u041f\u0418\u0422\u042c \u0417\u0410 ' + bladeItem.crystals + ' \u25c8'
        : '\u041a\u0423\u041f\u0418\u0422\u042c \u0417\u0410 \u041a\u0420\u0418\u0421\u0422\u0410\u041b\u041b\u042b';
      buyCry.setAttribute('aria-label', show ? '\u041a\u0443\u043f\u0438\u0442\u044c \u0437\u0430 ' + bladeItem.crystals + ' \u043a\u0440\u0438\u0441\u0442\u0430\u043b\u043b\u043e\u0432'
        : '\u041a\u0443\u043f\u0438\u0442\u044c \u0440\u0430\u043a\u0435\u0442\u043a\u0443 \u0437\u0430 \u043a\u0440\u0438\u0441\u0442\u0430\u043b\u043b\u044b');
    }
    const rows = STAT_KEYS.map((k) => {
      const v = t[k];
      const d = v - cur.stats[k];
      return `<div class="sbar"><small>${STAT_RU[k]}</small><span class="gr"><i style="width:${v}%"></i></span>
        <b style="color:${d > 0 ? 'var(--good)' : d < 0 ? 'var(--bad)' : 'var(--dim2)'}">${v}${d ? (d > 0 ? ' ▲' : ' ▼') : ''}</b></div>`;
    }).join('');
    $('#statCard').innerHTML = rows;
    const sp = (eq.fhParams.e / PH.E_RACKET);
    const describe = t.speed > 70 ? 'быстрая, требует короткого замаха' : t.control > 72 ? 'прощает промах по центру'
      : t.spin > 70 ? 'собирает вращение с кисти' : 'ровная, предсказуемая';
    $('#statNote').innerHTML = `<b>${ITEMS[this.pick.blade].name} · ${ITEMS[this.pick.fh].name}</b><br>`
      + `${describe}. Отскок ${(sp * 100).toFixed(0)}% от базы, пятно контакта ${(eq.sweetK * 100).toFixed(0)}%.`;
  }

  /** Buy the racket that is being tried on, with crystals. */
  buySelectionCrystals() {
    const p = this.game.profile, it = ITEMS[this.pick.blade];
    if (p.owns(it.id)) { this.toast('УЖЕ КУПЛЕНО'); return; }
    if (!it.crystals) { this.toast('ЭТУ РАКЕТКУ БЕРУТ МОНЕТАМИ'); return; }
    if (!this.game.shop.buyRacket(it.id, 'crystals')) {
      this.toast('НУЖНО ' + it.crystals + ' КРИСТАЛЛОВ'); this.game.audio.ui('deny'); return;
    }
    this.toast('КУПЛЕНО ЗА ' + it.crystals + ' \u25c8 · ' + it.name);
    this.game.audio.ui('buy');
    $('#wsBal').textContent = p.data.coins;
    $('#wsCry').textContent = p.data.crystals;
    this.showWorkshop('racket');
  }

  equipSelection() {
    const p = this.game.profile;
    const k = this.pick;
    if (!p.equipRacket(k.blade, k.fh, k.bh)) { this.toast('ЧТО-ТО НЕ КУПЛЕНО'); return; }
    this.game.applyEquipment();
    this.toast('РАКЕТКА В ИГРЕ · ' + this.game.equip.name);
    this.game.audio.ui('buy');
    this.drawStatCard();
    this.refreshMenuBits();
  }

  drawShop() {
    const g = this.game, p = g.profile, shop = g.shop;
    const rackets = shop.racketOffers().filter((o) => !o.owned);
    $('#shopRackets').innerHTML = rackets.length ? rackets.map((o) => {
      const it = o.item;
      const s = itemStats(it);
      const line = STAT_KEYS.map((k) => `${STAT_RU[k].slice(0, 4)} ${Math.round(s[k])}`).join(' · ');
      return `<div class="sitem"><b>${it.name} · ${it.ru}</b><small>${line}</small>
        <span class="buy"><span class="price">${o.price} монет</span>
        <button data-buy="${it.id}">КУПИТЬ</button></span></div>`;
    }).join('') : '<div class="snote">Все ракетки открыты. Играйте.</div>';
    Array.from($('#shopRackets').querySelectorAll('button[data-buy]')).forEach((b) => b.addEventListener('click', () => {
      if (g.shop.buyRacket(b.dataset.buy)) { this.game.audio.ui('buy'); this.toast('КУПЛЕНО'); }
      else { this.game.audio.ui('deny'); this.toast('НЕ ХВАТАЕТ МОНЕТ'); }
      $('#wsBal').textContent = p.data.coins; this.drawShop(); this.refreshMenuBits();
    }));

    const cos = shop.cosmeticOffers();
    $('#shopCosmetics').innerHTML = cos.map((c) => {
      const price = c.cur === 'coins' ? `${c.price} монет` : c.cur === 'crystals' ? `${c.price} кр.` : 'за карьеру';
      return `<div class="sitem ${c.owned ? 'owned' : ''}"><b>${c.ru}</b>
        <small>${c.owned ? 'открыто' : c.cur === 'career' ? 'награда за кубок мира' : 'косметика'}</small>
        <span class="buy"><span class="price">${c.owned ? '—' : price}</span>
        <button data-cos="${c.id}" ${c.owned ? 'disabled' : ''}>${c.owned ? 'ЕСТЬ' : 'КУПИТЬ'}</button></span></div>`;
    }).join('');
    Array.from($('#shopCosmetics').querySelectorAll('button[data-cos]')).forEach((b) => b.addEventListener('click', () => {
      if (g.shop.buyCosmetic(b.dataset.cos)) { this.game.audio.ui('buy'); this.toast('КУПЛЕНО'); }
      else { this.game.audio.ui('deny'); this.toast('НЕ ХВАТАЕТ КРИСТАЛЛОВ'); }
      $('#wsCry').textContent = p.data.crystals; this.drawShop();
    }));

    /* Real-money shelves exist only where IAP is allowed at all. On Poki
       the whole block is hidden and the page stays ads-only, as required. */
    const iap = shop.iapOffers();
    $('#shopIapWrap').style.display = iap.length ? 'block' : 'none';
    $('#shopIap').innerHTML = iap.map((b) => `<div class="sitem ${b.owned ? 'owned' : ''}">
      <b>${b.ru}</b><small>${b.note || (b.crystals ? b.crystals + ' кристаллов' : '')}</small>
      <span class="buy"><span class="price">${b.price} €</span>
      <button data-iap="${b.id}" ${b.owned && b.once ? 'disabled' : ''}>${b.owned && b.once ? 'КУПЛЕНО' : 'КУПИТЬ'}</button></span></div>`).join('');
    Array.from($('#shopIap').querySelectorAll('button[data-iap]')).forEach((b) => b.addEventListener('click', () => {
      /* The store call belongs to the mobile wrapper. Here we only take the
         entitlement, and say so honestly instead of pretending. */
      if (g.platform.canIAP && g.iap) { g.iap(b.dataset.iap); }
      else if (g.shop.grant(b.dataset.iap, false)) {
        this.toast('ПОКУПКА ЗАЧТЕНА · ' + b.dataset.iap.toUpperCase());
        $('#wsBal').textContent = p.data.coins; $('#wsCry').textContent = p.data.crystals;
        this.drawShop();
      }
    }));

    const s = p.data.season;
    const lv = p.seasonLevel();
    $('#seasonBox').innerHTML = `<div class="sl"><span>СЕЗОН ${s.n + 1} · УРОВЕНЬ ${lv}/60</span>
      <span>${s.premium ? 'ПРОПУСК АКТИВЕН' : 'БЕСПЛАТНАЯ ДОРОЖКА'}</span></div>
      <div class="track"><i style="width:${(p.seasonProgress() * 100).toFixed(0)}%"></i></div>
      <div class="snote">Опыт сезона дают матчи и задания. Пропуск добавляет косметику, арены и 400 кристаллов.</div>`;
  }

  drawDaily() {
    const p = this.game.profile;
    const d = p.data.daily;
    $('#dailyHead').innerHTML = `Серия <b>${p.data.streak}</b> ${p.data.streak >= 7 ? '· +50% к награде'
      : p.data.streak >= 3 ? '· +25% к награде' : '· три дня подряд дают +25%'}`;
    $('#taskList').innerHTML = DAILY_TASKS.map((t) => {
      const cur = Math.min(d.tasks[t.id] || 0, t.need);
      const done = d.done.indexOf(t.id) >= 0, claimed = d.claimed.indexOf(t.id) >= 0;
      return `<div class="trow"><span class="d"><b>${t.ru}</b><small>${cur}/${t.need} · ${t.coins} монет</small></span>
        <button data-claim="${t.id}" ${done && !claimed ? '' : 'disabled'}>${claimed ? 'ПОЛУЧЕНО' : done ? 'ЗАБРАТЬ' : 'В ПРОЦЕССЕ'}</button></div>`;
    }).join('');
    Array.from($('#taskList').querySelectorAll('button[data-claim]')).forEach((b) => b.addEventListener('click', () => {
      const got = p.claimTask(b.dataset.claim);
      if (got) { this.toast('+' + got + ' МОНЕТ'); this.game.audio.ui('buy'); }
      $('#wsBal').textContent = p.data.coins;
      this.drawDaily(); this.drawShop(); this.refreshMenuBits();
    }));
  }

  watchAd() {
    const r = this.game.shop.rewardAd('dailyWheel');
    if (r.ok) { this.toast('+' + r.coins + ' МОНЕТ · СПАСИБО'); this.game.audio.ui('buy'); }
    else if (r.why === 'no-ads') this.toast('РЕКЛАМА ОТКЛЮЧЕНА');
    else if (r.why === 'daily') this.toast('ЛИМИТ НА СЕГОДНЯ · ЗАВТРА ЕЩЁ ' + r.cap);
    else this.toast('ПОДОЖДИТЕ ' + (r.left || 45) + ' С');
    const cap = this.game.shop.adsLeft;
    const btn = $('#adCoins');
    if (btn) btn.textContent = cap > 0 ? 'СМОТРЕТЬ РЕКЛАМУ · +120 МОНЕТ · ОСТАЛОСЬ ' + cap : 'РЕКЛАМА · ЛИМИТ НА СЕГОДНЯ ИСЧЕРПАН';
    $('#wsBal').textContent = this.game.profile.data.coins;
    this.drawShop(); this.refreshMenuBits();
  }

  refreshMenuBits() {
    const p = this.game.profile; if (!p) return;
    $('#wsCoins').textContent = p.data.coins + ' монет';
    $('#wsStreak').textContent = 'серия ' + p.data.streak + ' · ' + p.data.daily.done.length + '/6';
  }

  toast(text) {
    const t = $('#mnToast');
    if (!t) return;
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this._tT);
    this._tT = setTimeout(() => t.classList.remove('on'), 1500);
  }

  applySetting(k, v) {
    const g = this.game; if (!g) return;
    const s = g.settings;
    switch (k) {
      // Gameplay assistance is an authored rule, not a player preference.
      case 'hitZone': case 'assist': case 'posAssist': case 'sens': case 'zone': return;
      case 'vol': s.volume = v / 100; g.audio.setVolume(v / 100); break;
      case 'cam': s.camera = v; break;
      case 'quality': s.quality = v; g.R.quality = v; g.resize(); break;
      case 'hand': case 'grip': g.changePaddlePreference(k, v); break;
      case 'gestures': s.gestureProfile = v === 'safe' ? 'safe' : 'classic'; break;
      case 'trail': s.showTrail = v === 'on'; break;
      case 'predict': s.showPredict = v === 'on'; break;
      case 'tele': s.showTele = v === 'on'; $('#spin').classList.toggle('on', s.showTele); break;
      case 'coach': s.coach = v === 'on'; if (!s.coach) this.hideNote(); break;
      case 'adaptive':
        s.adaptive = v === 'on';
        if (g.director) { g.director.enabled = s.adaptive; if (!s.adaptive) { g.director.reset(); g.ai.setHandicap(1); } }
        break;
      case 'haptics': s.haptics = v === 'on'; if (s.haptics) g.buzz(12); break;
        break;
      case 'paddle': s.showPlayerPaddle = v !== 'hide'; break;
      case 'serveToss': s.serveToss = clamp(+v, 0.8, 2.2); this.syncServeToss(); break;
      case 'capScale': s.capScale = clamp(+v, 0.8, 2.5); this.syncGameplaySliders(); break;
      case 'zoneScale': s.zoneScale = clamp(+v, 0.8, 2.5); this.syncGameplaySliders(); break;
      case 'aimAssist': s.aimAssist = clamp(+v, 0.5, 1); this.syncGameplaySliders(); break;
      case 'footAssist': s.footAssist = clamp(+v, 0, 1); this.syncGameplaySliders(); break;
      case 'batSens': s.batSens = clamp(+v, 0.4, 2.2); this.syncGameplaySliders(); break;
      case 'target': s.targetScore = +v; $('#toWin').textContent = v; break;
      default: break;
    }
    g.saveSettings();
    g.audio.ui('click');
  }

  /** The dial says what it is set to, in the band-safe top row. */
  syncSpinBias() {
    const g = this.game; if (!g) return;
    const el = $('#spinBias'), lab = $('#spinBiasVal');
    if (lab) lab.textContent = 'НОРМА';
  }

  syncSettings() {
    const s = this.game.settings;
    for (const [k, key] of [['hand', 'hand'], ['grip', 'grip'], ['gestures', 'gestureProfile']]) {
      $$(`.opt[data-set="${k}"]`).forEach(b => {
        const selected = b.dataset.val === s[key];
        b.classList.toggle('sel', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
    }
    this.syncCameraControls();
    // showPlayerPaddle is a boolean, the generic string-valued loop above
    // cannot match it — sync the visibility row explicitly.
    $$('.opt[data-set="paddle"]').forEach(b => {
      const selected = (b.dataset.val === 'show') === (s.showPlayerPaddle !== false);
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', String(selected));
    });
    this.syncServeToss();
    this.syncGameplaySliders();
  }
  /** The serve-toss height slider reflects settings.serveToss as a cm rise. */
  syncServeToss() {
    const s = this.game.settings;
    const el = $('#serveToss'); if (!el) return;
    const mul = clamp(Number.isFinite(s.serveToss) ? s.serveToss : 1, 0.8, 2.2);
    el.value = String(mul);
    const riseCm = Math.round(30.6 * mul);
    const lab = $('#serveTossVal'); if (lab) lab.textContent = riseCm + ' см';
  }
  /** Reflect the optional human-help sliders (capture, zone, assists, gain). */
  syncGameplaySliders() {
    const s = this.game.settings;
    const set = (id, val, labId, text) => {
      const el = $('#' + id); if (el) el.value = String(val);
      const lab = $('#' + labId); if (lab) lab.textContent = text;
    };
    const cap = clamp(Number.isFinite(s.capScale) ? s.capScale : 1, 0.8, 2.5);
    set('capScale', cap, 'capScaleVal', Math.round(cap * 100) + '%');
    const zone = clamp(Number.isFinite(s.zoneScale) ? s.zoneScale : 1, 0.8, 2.5);
    set('zoneScale', zone, 'zoneScaleVal', Math.round(zone * 100) + '%');
    const aim = clamp(Number.isFinite(s.aimAssist) ? s.aimAssist : 0.85, 0.5, 1);
    set('aimAssist', aim, 'aimAssistVal', Math.round(aim * 100) + '%');
    const foot = clamp(Number.isFinite(s.footAssist) ? s.footAssist : 0.85, 0, 1);
    set('footAssist', foot, 'footAssistVal', Math.round(foot * 100) + '%');
    const sens = clamp(Number.isFinite(s.batSens) ? s.batSens : 1, 0.4, 2.2);
    set('batSens', sens, 'batSensVal', sens.toFixed(2) + '\u00d7');
    this.renderZonePreview();
  }

  syncCameraControls() {
    const g = this.game;
    $$('#cameraViews [data-camera]').forEach(b => {
      const selected = b.dataset.camera === g.settings.camera;
      b.classList.toggle('sel', selected); b.setAttribute('aria-pressed', String(selected));
    });
  }

  /* ------------------------------ HUD ----------------------------- */
  syncScore() {
    const g = this.game;
    const a = $('#ptsA'), b = $('#ptsB');
    const changedA = a.textContent !== String(g.score[0]);
    const changedB = b.textContent !== String(g.score[1]);
    const pulse = (el, className, duration) => {
      if (!el) return;
      el.classList.remove(className);
      void el.offsetWidth; // restart the score pop when points land back-to-back
      el.classList.add(className);
      clearTimeout(el._pulseTimer);
      el._pulseTimer = setTimeout(() => el.classList.remove(className), duration);
    };
    if (changedA) { a.textContent = g.score[0]; pulse(a, 'bump', 480); }
    if (changedB) { b.textContent = g.score[1]; pulse(b, 'bump', 480); }
    if ((changedA || changedB) && g.lastPoint) {
      pulse(g.lastPoint.who > 0 ? $('#scoreSideA') : $('#scoreSideB'), 'scored', 680);
    }
    $('#servA').classList.toggle('on', g.server === 1);
    $('#servB').classList.toggle('on', g.server === -1);
    $('#oppName').textContent = g.ai.L.name;
  }

  showShot() { this.syncShotFeedback(); }
  syncShotFeedback() {
    const entry = this.game && this.game.shotJournal && this.game.shotJournal.latest;
    if (!entry) { this._shotEntry = null; $('#shot').classList.remove('on'); return; }
    if (entry === this._shotEntry && entry.revision === this._shotRevision) return;
    this._shotEntry = entry; this._shotRevision = entry.revision;
    const view = shotHudView(entry);
    if (!view) return;
    const el = $('#shot');
    $('#shotName').textContent = view.title;
    $('#shotStatus').textContent = view.status;
    $('#shotMeta').textContent = view.metrics;
    el.dataset.tone = view.tone; el.classList.add('on');
    this.shotTimer = 7;
  }
  openShotLab() {
    this._labWasPaused = this.game.paused;
    this.game.setPaused(true);
    $('#shotLab').classList.add('on');
    this.renderShotLab();
  }
  closeShotLab() {
    this._labCancelled = true;
    $('#shotLab').classList.remove('on');
    if (!this._labWasPaused) this.game.setPaused(false);
  }
  ensureZoneCalibration() {
    if (!this.zoneCal && typeof ZoneCalibrationSession !== 'undefined') {
      this.zoneCal = new ZoneCalibrationSession();
      const records = (this.game && this.game.shotJournal && this.game.shotJournal.records) || [];
      this.zoneCalAfterId = records.reduce((m, e) => Math.max(m, e.id || 0), 0);
    }
    return this.zoneCal;
  }
  importZoneCalibration() {
    const session = this.ensureZoneCalibration(), g = this.game;
    if (!session || !g || !g.shotJournal) return null;
    const records = g.shotJournal.records;
    if (session.step && session.step.id === 'corners') {
      const corners = [
        { label: 'near-left', p: { x: -PH.T_HALF_WID, y: PH.TABLE_Y, z: PH.T_HALF_LEN } },
        { label: 'near-right', p: { x: PH.T_HALF_WID, y: PH.TABLE_Y, z: PH.T_HALF_LEN } },
        { label: 'far-right', p: { x: PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN } },
        { label: 'far-left', p: { x: -PH.T_HALF_WID, y: PH.TABLE_Y, z: -PH.T_HALF_LEN } },
      ];
      for (const e of records) {
        if (!e || e.id <= this.zoneCalAfterId || !e.pressZone) continue;
        this.zoneCalAfterId = Math.max(this.zoneCalAfterId, e.id);
        const target = corners[session.count()], z = e.pressZone;
        if (!target || typeof g.project !== 'function') continue;
        const proj = g.project(target.p, {});
        if (!proj || !proj.ok || ![z.pressX, z.pressY, z.vw, z.vh].every(Number.isFinite)) continue;
        session.record({ label: target.label, inputType: z.pointerType,
          errorPx: Math.hypot((z.pressX - proj.x) * z.vw, (z.pressY - proj.y) * z.vh),
          along: z.along, across: z.across });
        if (session.done || !session.step || session.step.id !== 'corners') break;
      }
      return session.lastSummary;
    }
    const result = session.importJournal(records, this.zoneCalAfterId);
    if (result) this.zoneCalAfterId = result.lastId;
    return result && result.summary;
  }
  renderZoneCalibration() {
    const status = $('#zoneCalStatus'), box = $('#zoneCalSummary');
    if (!status || !box) return;
    box.replaceChildren();
    const session = this.zoneCal;
    if (!session) { status.textContent = 'Калибровка не начата. Нажмите «Начать заново», выполните задание в игре и вернитесь сюда.'; return; }
    if (session.done) status.textContent = 'Готово: все шаги пройдены мышью и касанием. Скачайте данные калибровки.';
    else status.textContent = `${session.pass === 'mouse' ? 'Мышь' : 'Касание'} · ${session.step.title}: ${session.count()}/${session.step.need}. ${session.step.instruction} Затем откройте эту панель и нажмите «Записать попытки из игры».`;
    const summaries = session.exportData().summaries.filter(x => x.count > 0);
    for (const item of summaries) {
      const p = document.createElement('p');
      p.textContent = `${item.pass} · ${item.stepId} · ${item.count}: ${item.recommendation}`;
      box.append(p);
    }
    if (session.lastSummary) {
      const p = document.createElement('p');
      p.textContent = `Последний завершённый шаг: ${session.lastSummary.recommendation}`;
      box.append(p);
    }
  }
  exportZoneCalibration() {
    const session = this.ensureZoneCalibration();
    if (!session) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(session.exportData(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'topspin-zone-calibration.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  exportInputLog() {
    const log = this.game && this.game.inputLog;
    if (!log) return;
    const url = URL.createObjectURL(new Blob([log.toJSONL(this.game.time)], { type: 'application/x-ndjson' }));
    const link = document.createElement('a'); link.href = url; link.download = 'topspin-input-log.jsonl'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  renderShotLab() {
    const root = $('#shotLabRecords'); root.replaceChildren();
    if (this.zoneCal) this.importZoneCalibration();
    this.renderZoneCalibration();
    const summary=$('#captureCalibrationSummary');summary.replaceChildren();
    for(const serving of [false,true]) {
      const attempts=this.game.shotJournal.records.filter(e=>e.pressZone && e.pressZone.serving===serving);
      const hits=attempts.filter(e=>e.contact), block=document.createElement('div');block.className='lab-entry';
      const add=text=>{const p=document.createElement('p');p.textContent=text;block.append(p);};
      const oval=MATCH_RULES.zoneShape==='oval';
      const title=document.createElement('b');title.textContent=oval?`${serving?'Подача':'Приём'} · овал: скорость×${MATCH_RULES.ovalLeadSec} с + ${MATCH_RULES.ovalForwardPx} px вперёд, ${MATCH_RULES.ovalBackPx} px назад, ${MATCH_RULES.ovalSideMousePx}/${MATCH_RULES.ovalSideTouchPx} px поперёк`:`${serving?'Подача':'Приём'} · радиус ${MATCH_RULES.pressRadiusPx} px`;block.append(title);
      add(`Нажатий: ${attempts.length} · вне зоны: ${attempts.filter(e=>!e.pressZone.accepted).length} · ударов: ${hits.length}`);
      if(oval){
        const rejected=attempts.filter(e=>!e.pressZone.accepted);
        const p90=(rows,key)=>{const xs=rows.map(e=>Math.abs(e.pressZone[key])).filter(Number.isFinite).sort((a,b)=>a-b);return xs.length?Math.round(xs[Math.ceil(xs.length*.9)-1]):'—';};
        add(`Отклонённые: 90-й перцентиль along ${p90(rejected,'along')} px, across ${p90(rejected,'across')} px. Причины: ${[...new Set(rejected.map(e=>e.pressZone.reason||'OUTSIDE_ZONE'))].join(', ')||'—'}.`);
        add(`Принятые удары: 90-й перцентиль along ${p90(hits,'along')} px, across ${p90(hits,'across')} px.`);
      } else {
        for(const scale of [.9,.8,.7]) add(`Радиус ${Math.round(MATCH_RULES.pressRadiusPx*scale)} px: заблокировал бы ${hits.filter(e=>e.pressZone.distancePx>e.pressZone.radius*scale).length} из ${hits.length} записанных ударов.`);
      }
      summary.append(block);
    }
    const entries = this.game.shotJournal.records.slice().reverse();
    if (!entries.length) { root.textContent = 'Пока нет попыток. Сделайте свайп во время игры.'; return; }
    for (const entry of entries) {
      const view = shotFeedbackView(entry), card = document.createElement('div'); card.className = 'lab-entry';
      const title = document.createElement('b'); title.textContent = `#${entry.id} · ${view.title} · ${view.status}`; card.append(title);
      const add = text => { const p = document.createElement('p'); p.textContent = text; card.append(p); };
      if (view.metrics) add(view.metrics);

      if (entry.pressZone) add(entry.pressZone.shape==='oval'||entry.pressZone.shape==='circle'&&Number.isFinite(entry.pressZone.along)
        ? `Нажатие: ${entry.pressZone.accepted?'внутри':'снаружи'} · score ${Number.isFinite(entry.pressZone.score)?entry.pressZone.score.toFixed(2):'—'} · along ${Number.isFinite(entry.pressZone.along)?entry.pressZone.along.toFixed(0):'—'} px · across ${Number.isFinite(entry.pressZone.across)?entry.pressZone.across.toFixed(0):'—'} px${entry.pressZone.reason?` · ${entry.pressZone.reason}`:''}.`
        : `Нажатие: ${entry.pressZone.accepted?'внутри':'снаружи'} · расстояние ${Number.isFinite(entry.pressZone.distancePx)?entry.pressZone.distancePx.toFixed(0):'не измерено'} px из ${entry.pressZone.radius} px.`);
      root.append(card);
    }
  }
  exportShotLab() {
    const data = this.game.shotJournal.exportData();
    data.pressCalibration = { zoneShape: MATCH_RULES.zoneShape, radiusPx: MATCH_RULES.pressRadiusPx,
      oval: { leadSec: MATCH_RULES.ovalLeadSec, forwardPx: MATCH_RULES.ovalForwardPx, backPx: MATCH_RULES.ovalBackPx,
        sideMousePx: MATCH_RULES.ovalSideMousePx, sideTouchPx: MATCH_RULES.ovalSideTouchPx },
      attempts: this.game.shotJournal.records.filter(e=>e.pressZone).map(e=>({ id:e.id, press:e.pressZone, contacted:!!e.contact })) };
    if (this.zoneCal) data.zoneCalibration = this.zoneCal.exportData();
    if (this.game.inputLog) data.inputLogStats = this.game.inputLog.stats(this.game.time);
    data.preferences = { grip: this.game.settings.grip, hand: this.game.settings.hand, spinBias: this.game.settings.spinBias };
    data.equipment = JSON.parse(JSON.stringify(this.game.equip));
    data.career = { active: this.game.career.active, speed: this.game._careerSpeedBoost, spin: this.game._careerSpinBoost };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'topspin-shot-diagnostics.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  showAiShot() { /* the opponent's choice is readable from the ball itself */ }

  /** One sentence about the point that just ended. A coach does not
   *  recite statistics at you, he tells you the single thing you got
   *  wrong — so this shows exactly one line and then gets out of the way. */
  showNote(note) {
    if (!note || !this.game || !this.game.settings.coach) return;
    const el = $('#note');
    el.querySelector('span').textContent = note.text;
    el.querySelector('i').style.background = note.col || 'var(--acc)';
    el.classList.add('on');
    this.noteTimer = note.text.length > 58 ? 3.4 : 2.6;
  }

  hideNote() { this.noteTimer = 0; const el = $('#note'); el && el.classList.remove('on'); }

  /* --------------------------- coach panel ------------------------ */
  trainShow() { $('#train').classList.add('on'); $('#score').style.opacity = '0'; $('#trainingActions').hidden = false; }
  trainHide() { $('#trainingActions').hidden = true; $('#train').classList.remove('on'); $('#score').style.opacity = ''; $('#tdone').classList.remove('on'); }
  trainSync(t) {
    const S = t.S, feedback = t.phase === 'ok' || t.phase === 'fail';
    const preview = t.phase === 'demo';
    const tip = trainingTip(S, this.inputMode,
      this.game && this.game.settings && this.game.settings.gestureProfile === 'safe');
    $('#trStep').textContent = `${t.step + 1}/${TRAIN_STEPS.length}`;
    $('#trTitle').textContent = S.title;
    $('#trProgress').textContent = `${t.done}/${S.need}`;
    $('#trTip').textContent = feedback ? '' : (preview ? 'Смотрите: бот выполняет приём.' : S.goal);
    $('#trainPauseTip').textContent = tip;
    /* The gesture itself is written UNDER the goal at all times: the preview
     * used to be the only place it was shown, so with the preview now opt-in
     * the pupil would have to open the pause menu to learn the swipe. */
    $('#trMsg').textContent = feedback ? t.msg
      : preview ? 'Клик по столу — и вы играете сами.' : tip;
    $('#trMsg').style.color = feedback ? (t.msgCol || 'var(--good)') : 'var(--acc)';
    /* The control says what the NEXT press does, so it reads as a button and
     * not as another badge over the table. */
    const demoBtn = $('#trDemo');
    if (demoBtn) {
      demoBtn.textContent = preview ? 'ХВАТИТ, ИГРАЮ САМ' : 'ПОКАЗАТЬ, КАК ИГРАТЬ';
      demoBtn.setAttribute('aria-pressed', preview ? 'true' : 'false');
    }
  }
  trainDone() { $('#train').classList.remove('on'); $('#trainingActions').hidden = true; $('#tdone').classList.add('on'); }

  showMatchEnd(won) {
    const g = this.game, s = g.stats;
    $('#over').classList.toggle('won', !!won);
    $('#over').classList.toggle('lost', !won);
    $('#overTitle').textContent = won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
    $('#overTitle').style.color = won ? 'var(--good)' : 'var(--bad)';
    $('#overScore').textContent = g.score[0] + ' : ' + g.score[1];
    const avgSpin = s.shots ? (s.totalSpin / s.shots) : 0;
    $('#stShots').textContent = s.shots;
    $('#stMaxSpeed').textContent = s.maxSpeed.toFixed(0) + ' км/ч';
    $('#stMaxSpin').textContent = s.maxSpin.toFixed(0) + ' об/с';
    $('#stAvgSpin').textContent = avgSpin.toFixed(0) + ' об/с';
    $('#stRally').textContent = g.bestRally;
    const top = Object.entries(s.byStroke).sort((a, b) => b[1] - a[1])[0];
    $('#stFav').textContent = top ? (STROKES[top[0]] ? STROKES[top[0]].short : top[0]) + ' ×' + top[1] : '—';
    // Results are immediate; normal best moments remain an explicit choice.
    const row = $('#overMoments');
    row.innerHTML = '';
    /* what the match paid, in one line, next to the score */
    if (g.lastReward) {
      const r = g.lastReward;
      const line = document.createElement('div');
      line.className = 'snote';
      line.innerHTML = `+<b>${r.coins}</b> монет · +<b>${r.xp}</b> опыта`
        + (r.seasonLevels ? ` · сезон +${r.seasonLevels}` : '')
        + (g.moments.kept.length ? ` · моментов в копилке: ${g.moments.kept.length}` : '');
      row.appendChild(line);
      g.lastReward = null;
    }
    const kept = g.moments.kept.slice(0, 3);
    if (kept.length) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = '\u25b6 ЛУЧШИЕ МОМЕНТЫ \u00b7 ' + kept.length;
      b.addEventListener('click', () => this.showMoments());
      row.appendChild(b);
    }
    $('#over').classList.add('on');
  }

  /* ==================================================================
   *  2D coaching layer
   * ================================================================== */

  /** Timing brackets belong to the ball. They are NOT a capture radius. */
  drawStrikeRing(c, W, H, d) {
    const g = this.game;
    if (g.paused || (g.replayer && g.replayer.on)) return;
    const cue = strikeCueModel(g._strike);
    if (!cue) return;
    const p = g.project(g.ball.p, this._pv);
    if (!p.ok || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    const x = p.x * W, y = p.y * H, r = cue.radius * d, arm = 4 * d;
    c.save(); c.globalAlpha = cue.alpha;
    c.strokeStyle = cue.hot ? '#ffe699' : '#8ea5b8';
    c.lineWidth = (cue.hot ? 2 : 1.3) * d;
    c.setLineDash(cue.dashed ? [3 * d, 3 * d] : []);
    // Four L brackets: leave the white ball unobscured and avoid a circular
    // "hitbox" metaphor. No pulsating radius or extra motion in reduced mode.
    c.beginPath();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      c.moveTo(x + sx * (r - arm), y + sy * r);
      c.lineTo(x + sx * r, y + sy * r);
      c.lineTo(x + sx * r, y + sy * (r - arm));
    }
    c.stroke(); c.restore();
  }

  /** Where the bat lives when the player chose to hide it. The paddle still
   *  strikes and still follows the cursor — only its mesh is off — so without
   *  this marker there would be no visual reference for the aim point. A quiet
   *  crosshair on the bat's own world position, never a physics object. */
  drawAimReticle(c, W, H, d) {
    const g = this.game;
    if (g.settings.showPlayerPaddle !== false) return;      // only in hide-racket mode
    if (g.paused || (g.replayer && g.replayer.on)) return;
    if (![GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY, GS.POINT].includes(g.state)) return;
    const pad = g.player; if (!pad || !pad.pos) return;
    const p = g.project(pad.pos, this._rp || (this._rp = {}));
    if (!p.ok || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    const x = p.x * W, y = p.y * H, R = 16 * d, gap = 6 * d;
    c.save();
    c.strokeStyle = '#39c6ff'; c.lineWidth = 2 * d; c.lineCap = 'round';
    c.globalAlpha = 0.85;
    c.beginPath();
    c.moveTo(x - R, y); c.lineTo(x - gap, y);
    c.moveTo(x + gap, y); c.lineTo(x + R, y);
    c.moveTo(x, y - R); c.lineTo(x, y - gap);
    c.moveTo(x, y + gap); c.lineTo(x, y + R);
    c.stroke();
    c.globalAlpha = 0.4;
    c.beginPath(); c.arc(x, y, R * 0.6, 0, TAU); c.stroke();
    c.globalAlpha = 0.95; c.fillStyle = '#39c6ff';
    c.beginPath(); c.arc(x, y, 2 * d, 0, TAU); c.fill();
    c.restore();
  }

  /** A small live diagram inside the settings panel. It draws the reach window
   *  (capScale) and the admission press-circle (zoneScale, doubled on serve)
   *  as concentric rings so dragging a slider instantly shows the shape change
   *  instead of an abstract percentage. Rendered into its own canvas element so
   *  it is never hidden behind the modal backdrop. Purely illustrative. */
  renderZonePreview() {
    const cv = (typeof document !== 'undefined') ? document.querySelector('#zonePreview') : null;
    if (!cv || !cv.getContext) return;
    const g = this.game; if (!g) return;
    const cs = clamp(Number.isFinite(g.settings.capScale) ? g.settings.capScale : 1, 0.8, 2.5);
    const zs = clamp(Number.isFinite(g.settings.zoneScale) ? g.settings.zoneScale : 1, 0.8, 2.5);
    const serving = g.server === 1 && [GS.SERVE_READY, GS.SERVE_TOSS].includes(g.state);
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const w = cv.clientWidth || cv.width || 240, h = cv.clientHeight || cv.height || 160;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const c = cv.getContext('2d'); if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const cx = w * 0.5, cy = h * 0.56, unit = Math.min(w, h) * 0.24;
    const zoneR = unit * zs * (serving ? 2 : 1);   // green admission press-circle
    const reachR = unit * 0.62 * cs;               // blue physical reach ring
    c.save(); c.lineWidth = 2; c.setLineDash([]);
    c.fillStyle = 'rgba(57,198,255,0.10)'; c.beginPath(); c.arc(cx, cy, reachR, 0, TAU); c.fill();
    c.strokeStyle = '#6ee7a8'; c.globalAlpha = 0.9; c.beginPath(); c.arc(cx, cy, zoneR, 0, TAU); c.stroke();
    c.strokeStyle = '#39c6ff'; c.globalAlpha = 0.95; c.beginPath(); c.arc(cx, cy, reachR, 0, TAU); c.stroke();
    c.fillStyle = '#39c6ff'; c.beginPath(); c.arc(cx, cy, 3, 0, TAU); c.fill();
    c.fillStyle = '#9fb4c6'; c.globalAlpha = 0.95; c.font = '11px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText('reach \u00d7' + cs.toFixed(2) + '   \u00b7   zone \u00d7' + (zs * (serving ? 2 : 1)).toFixed(2) + (serving ? ' \u2192 \u043f\u043e\u0434\u0430\u0447\u0430' : ''), cx, h - 8);
    c.restore();
  }

  /** Gesture points for a guide shape around (x, y); also returns the
   *  per-segment lengths and the total path length. Shared by the looping
   *  guide and the one-shot drill demo. */
  trainGuidePath(shape, x, y, L) {
    const pts = [];
    if (shape === 'up') pts.push([x, y + L * 0.55], [x, y - L * 0.55]);
    else if (shape === 'down') pts.push([x, y - L * 0.55], [x, y + L * 0.55]);
    else if (shape === 'side') pts.push([x - L * 0.62, y], [x + L * 0.62, y]);
    else { const a0 = [-L * 0.6, L * 0.12], ctrl = [0, -L * 0.42], a1 = [L * 0.6, L * 0.12];
      for (let i = 0; i <= 20; i++) { const t = i / 20, mt = 1 - t;
        pts.push([x + (mt * mt * a0[0] + 2 * mt * t * ctrl[0] + t * t * a1[0]), y + (mt * mt * a0[1] + 2 * mt * t * ctrl[1] + t * t * a1[1])]); } }
    const seg = []; let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(l); total += l; }
    return { pts, seg, total };
  }

  /** Point at fraction f (0..1) along a guide path. */
  trainGuideAt(path, f) {
    const { pts, seg, total } = path;
    let dist = clamp(f, 0, 1) * total, di = 0;
    while (di < seg.length - 1 && dist > seg[di]) { dist -= seg[di]; di++; }
    const s0 = pts[di], s1 = pts[di + 1] || pts[di], f2 = seg[di] > 0 ? clamp(dist / seg[di], 0, 1) : 0;
    return [s0[0] + (s1[0] - s0[0]) * f2, s0[1] + (s1[1] - s0[1]) * f2];
  }

  /** Training: paint how to make the stroke. Each drill carries a `guide`
   *  gesture shape; we trace it as a groove with a travelling highlight and an
   *  arrowhead, anchored on the live ball (or the bat) so the pupil sees where
   *  and which way to swipe. Purely instructional — never a physics object. */
  drawTrainGuide(c, W, H, d) {
    const g = this.game;
    const tr = g.training;
    if (!tr || !tr.S || g.paused || (g.replayer && g.replayer.on)) return;
    if (['ok', 'fail', 'done'].includes(tr.phase)) return;
    let shape = tr.S.guide;
    if (!shape) return;
    if (shape === 'down' && g.settings.gestureProfile === 'safe') shape = 'up';
    // anchor on the live ball, else the bat, else a lower-centre default
    let ax = 0.5, ay = 0.7;
    const src = (g.ball && g.ball.live) ? g.ball.p : (g.player && g.player.pos);
    if (src) {
      const p = g.project(src, this._tg || (this._tg = {}));
      if (p && p.ok && Number.isFinite(p.x) && Number.isFinite(p.y)) { ax = clamp(p.x, 0.16, 0.84); ay = clamp(p.y, 0.28, 0.9); }
    }
    const x = ax * W, y = ay * H, L = 96 * d;
    const { pts, seg, total } = this.trainGuidePath(shape, x, y, L);
    const col = '#39c6ff';
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = col; c.globalAlpha = 0.22; c.lineWidth = 11 * d;
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.stroke();
    const e = pts[pts.length - 1], pv = pts[pts.length - 2], ang = Math.atan2(e[1] - pv[1], e[0] - pv[0]);
    c.globalAlpha = 0.6; c.fillStyle = col; c.beginPath();
    c.moveTo(e[0], e[1]);
    c.lineTo(e[0] - Math.cos(ang - 0.5) * 16 * d, e[1] - Math.sin(ang - 0.5) * 16 * d);
    c.lineTo(e[0] - Math.cos(ang + 0.5) * 16 * d, e[1] - Math.sin(ang + 0.5) * 16 * d);
    c.closePath(); c.fill();
    let dotT = this.reducedMotion ? 1 : ((g.time % 1.15) / 1.15);
    const [dxp, dyp] = this.trainGuideAt({ pts, seg, total }, dotT);
    const rg = c.createRadialGradient(dxp, dyp, 0, dxp, dyp, 20 * d);
    rg.addColorStop(0, col + 'ee'); rg.addColorStop(1, col + '00');
    c.globalAlpha = 1; c.fillStyle = rg; c.beginPath(); c.arc(dxp, dyp, 20 * d, 0, TAU); c.fill();
    c.fillStyle = '#eaf7ff'; c.beginPath(); c.arc(dxp, dyp, 5 * d, 0, TAU); c.fill();
    c.restore();
  }

  /** Training preview: the bot plays the drill so the pupil can SEE the two
   *  things a cue card cannot say — where the cursor must stand, and which way
   *  it travels. Everything is read from the demo driver in 65_train.js, which
   *  moves a REAL pointer through the real press oval, so the ring below is the
   *  point the pupil's own cursor has to occupy, not a decoration. */
  drawTrainDemo(c, W, H, d) {
    const g = this.game, tr = g.training, dm = tr && tr.demo;
    if (!dm || dm.stopped || g.paused || (g.replayer && g.replayer.on)) return;
    if (['ok', 'fail', 'done'].includes(tr.phase)) return;
    const col = '#39c6ff';
    /* The words are drawn LAST (see section 4): the ghost hand and its ring
     * stand exactly on top of them while the bot is still travelling. */
    let label = null;
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';

    /* 1. The target: where the ball will meet the bat, i.e. where the cursor
     *    has to wait. The halo closes as the ball arrives — that is the press
     *    cue, and it is the same moment the bot presses. */
    if (dm.state === 'seek') {
      const tx = dm.tgt.x * W, ty = dm.tgt.y * H;
      const near = clamp(dm.near || 0, 0, 1);
      const R = (30 - 9 * near) * d;
      c.globalAlpha = 0.30 + 0.45 * near;
      c.strokeStyle = col; c.lineWidth = 1.6 * d;
      c.setLineDash([5 * d, 6 * d]);
      c.beginPath(); c.arc(tx, ty, R, 0, TAU); c.stroke();
      c.setLineDash([]);
      c.beginPath();
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        c.moveTo(tx + sx * (R + 3 * d), ty + sy * R);
        c.lineTo(tx + sx * (R + 8 * d), ty + sy * R);
      }
      c.stroke();
      c.globalAlpha = 0.14 + 0.30 * near;
      c.beginPath(); c.arc(tx, ty, R + (1 - near) * 46 * d, 0, TAU); c.stroke();
      label = { x: tx, y: ty - (R + 16 * d) };
    }

    /* 2. The bot's hand: the exact screen point the pupil must bring their own
     *    pointer to. It is the real synthetic pointer that drives the racket. */
    const gx = dm.pos.x * W, gy = dm.pos.y * H;
    const pressed = dm.state !== 'seek';
    const rg = c.createRadialGradient(gx, gy, 0, gx, gy, 26 * d);
    rg.addColorStop(0, col + 'aa'); rg.addColorStop(1, col + '00');
    c.globalAlpha = 0.95; c.fillStyle = rg;
    c.beginPath(); c.arc(gx, gy, 26 * d, 0, TAU); c.fill();
    c.strokeStyle = '#eaf7ff'; c.lineWidth = 2 * d;
    c.beginPath(); c.arc(gx, gy, 13 * d, 0, TAU); c.stroke();
    c.globalAlpha = 0.45;
    c.beginPath(); c.arc(gx, gy, 20 * d, 0, TAU); c.stroke();
    c.globalAlpha = 1; c.fillStyle = '#eaf7ff';
    c.beginPath(); c.arc(gx, gy, (pressed ? 5.5 : 3.4) * d, 0, TAU); c.fill();

    /* 3. How to swipe: the arrow leaves the cursor along the drill's own
     *    gesture. During the swing the live ribbon takes over by itself. */
    if (dm.state === 'seek' || dm.state === 'press') {
      const dx = dm.dir.x, dy = dm.dir.y;
      const L0 = 18 * d, L1 = 82 * d;
      c.globalAlpha = 0.55; c.strokeStyle = col; c.lineWidth = 3 * d;
      c.beginPath();
      c.moveTo(gx + dx * L0, gy + dy * L0);
      c.lineTo(gx + dx * L1, gy + dy * L1);
      c.stroke();
      const ax = gx + dx * L1, ay = gy + dy * L1, ang = Math.atan2(dy, dx);
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(ax + Math.cos(ang) * 11 * d, ay + Math.sin(ang) * 11 * d);
      c.lineTo(ax + Math.cos(ang + 2.5) * 12 * d, ay + Math.sin(ang + 2.5) * 12 * d);
      c.lineTo(ax + Math.cos(ang - 2.5) * 12 * d, ay + Math.sin(ang - 2.5) * 12 * d);
      c.closePath(); c.fill();
    }
    /* 4. The one instruction that answers “куда вести курсор” — on a dark
     *    plate, above every other mark, so no ring or arrow can eat it. */
    if (label) {
      c.font = `700 ${12 * d}px system-ui,sans-serif`;
      c.textAlign = 'center';
      const half = c.measureText('КУРСОР СЮДА').width / 2 + 7 * d;
      c.globalAlpha = 0.76; c.fillStyle = 'rgba(4,10,18,.86)';
      roundRect(c, label.x - half, label.y - 10 * d, half * 2, 17 * d, 5 * d);
      c.fill();
      c.globalAlpha = 0.96; c.fillStyle = col;
      c.fillText('КУРСОР СЮДА', label.x, label.y);
    }
    c.restore();
  }

  /** Only the racket is visible over live play; dialogs retain their cursor. */
  syncNativeCursor() {
    const g = this.game, canvas = g && g.canvas;
    if (!canvas) return;
    const playing = [GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY, GS.POINT].includes(g.state);
    const dialog = typeof document !== 'undefined' && document.querySelector('.screen.on');
    const cursor = playing && !this.captureDebug && !g.paused && !(g.replayer && g.replayer.on) && !dialog ? 'none' : 'default';
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    /* The fx canvas sits above the play surface; force its cursor too so the
     * native arrow can never flash over the table mid-rally, and keep the
     * whole stage pointer-free while the ball is live. */
    if (this.fx && this.fx.style && this.fx.style.cursor !== cursor) this.fx.style.cursor = cursor;
  }

  drawCaptureDebug(c, W, H, d) {
    const g=this.game;
    if (!this.captureDebug || !g || g.paused || (g.replayer && g.replayer.on) ||
        ![GS.SERVE_READY,GS.SERVE_TOSS,GS.RALLY].includes(g.state)) return;
    const rect=g.canvas.getBoundingClientRect ? g.canvas.getBoundingClientRect() : {width:W/d,height:H/d};
    const saved=g.swipe && g.swipe.pressZone;
    const serving=[GS.SERVE_READY,GS.SERVE_TOSS].includes(g.state) && g.server===1;
    const locked=saved && (g.swipe.active || (typeof g.playerStrokeIntent==='function' && g.playerStrokeIntent(serving)));
    const zone=locked ? saved : g.measurePressZone(g.pointer,g.pointerFine===false?'touch':'mouse');
    if (!zone || ![zone.x,zone.y,zone.radius].every(Number.isFinite)) return;
    if (zone.via==='serve-init' && g.state===GS.SERVE_READY) {
      // Ready accepts a toss command on the play surface, not just within
      // an oval at the old ball position. Do not display a fake hit region.
      c.save();c.fillStyle='#6ee7a8';c.font=`${12*d}px sans-serif`;c.textAlign='center';
      c.fillText('ПОДБРОС: НАЖМИТЕ В ИГРОВОМ ПОЛЕ',W*.5,H*.90);c.restore();
      return;
    }
    const sx=W/rect.width,sy=H/rect.height;
    c.save();c.setLineDash([]);c.globalAlpha=.9;c.lineWidth=2*d;c.strokeStyle=zone.accepted?'#6ee7a8':'#ffb066';
    c.beginPath();
    if (zone.shape==='oval' && [zone.axisX,zone.axisY,zone.fwdPx,zone.backPx,zone.sidePx].every(Number.isFinite)) {
      for(let i=0;i<=48;i++){
        const a=i/48*TAU, co=Math.cos(a), si=Math.sin(a);
        const along=co*(co>=0?zone.fwdPx:zone.backPx), across=si*zone.sidePx;
        const px=(zone.x+zone.axisX*along-zone.axisY*across)*sx;
        const py=(zone.y+zone.axisY*along+zone.axisX*across)*sy;
        if(i===0)c.moveTo(px,py);else c.lineTo(px,py);
      }
    } else c.arc(zone.x*sx,zone.y*sy,zone.radius*sx,0,TAU);
    c.stroke();
    // The dot is the actual sampled pointer, only in this explicit debug mode.
    if (g.pointer && Number.isFinite(g.pointer.x) && Number.isFinite(g.pointer.y)) {
      const dotX=locked&&Number.isFinite(zone.pointerX)?zone.pointerX*sx:g.pointer.x*W;
      const dotY=locked&&Number.isFinite(zone.pointerY)?zone.pointerY*sy:g.pointer.y*H;
      c.fillStyle=c.strokeStyle;c.beginPath();c.arc(dotX,dotY,3*d,0,TAU);c.fill();
    }
    c.restore();
  }

  drawOverlay(dt) {
    const g = this.game, c = this.fxg, W = this.fx.width, H = this.fx.height, d = this.dpr;
    c.clearRect(0, 0, W, H);
    if (!g) return;

    if (!this.captureDebug) this.drawStrikeRing(c, W, H, d);
    this.drawAimReticle(c, W, H, d);
    // The looping racket-anchored guide is retired: the pupil asked for a single
    // one-shot demo above the table (drawTrainDemo), not a groove painted over
    // the blade for the whole drill.
    this.drawTrainDemo(c, W, H, d, dt);
    this.drawCaptureDebug(c, W, H, d);
    this.syncNativeCursor();

    // Calibration shows evidence only, not a decorative swipe or glow.
    if (this.captureDebug) { this._lastRibbon = null; this.ripples.length = 0; }
    // live swipe ribbon
    const sw = g.swipe;
    if (!this.captureDebug && sw.active && sw.samples.length > 1) {
      const pts = sw.samples;
      const n = pts.length;
      c.lineCap = 'round'; c.lineJoin = 'round';
      const st = g.liveStroke;
      const col = st ? st.stroke.col : '#39c6ff';
      /* The trail is the raw pointer path, but the bat lives in a clamped,
       * smoothed world pose — near the screen edges they diverge and the
       * stroke reads as "somewhere far from the racket". Anchor the ribbon on
       * the bat's own projected position (shift the whole shape so its head
       * lands on the bat) so the swing always visibly belongs to the racket. */
      let ox = 0, oy = 0;
      const pad = g.player;
      if (pad && pad.pos) {
        const bp = g.project(pad.pos, this._rb || (this._rb = {}));
        if (bp && bp.ok && Number.isFinite(bp.x) && Number.isFinite(bp.y)) {
          ox = bp.x * W - pts[n - 1].x * W;
          oy = bp.y * H - pts[n - 1].y * H;
        }
      }
      const nox = ox / W, noy = oy / H;
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        c.strokeStyle = col;
        c.globalAlpha = 0.07 + t * 0.5;
        c.lineWidth = (1.5 + t * 11) * d;
        c.beginPath();
        c.moveTo((pts[i - 1].x + nox) * W, (pts[i - 1].y + noy) * H);
        c.lineTo((pts[i].x + nox) * W, (pts[i].y + noy) * H);
        c.stroke();
      }
      c.globalAlpha = 1;
      const hx = pts[n - 1].x * W + ox, hy = pts[n - 1].y * H + oy;
      const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 34 * d);
      rg.addColorStop(0, col + 'cc'); rg.addColorStop(1, col + '00');
      c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 34 * d, 0, TAU); c.fill();

      this._lastRibbon = {
        pts: sw.samples.map((p) => ({ x: p.x + nox, y: p.y + noy })),
        col,
        label: (st && sw.m.dist > 0.045) ? (st.stroke.short || st.stroke.name) : '',
        fade: 1.0,
      };
    } else if (this._lastRibbon) {
      if (this.reducedMotion) this._lastRibbon = null;
      else if ((this._lastRibbon.fade -= dt * 2.2) <= 0) {
        this._lastRibbon = null;
      } else {
        const rb = this._lastRibbon;
        const pts = rb.pts, n = pts.length;
        if (n > 1) {
          c.save();
          c.lineCap = 'round'; c.lineJoin = 'round';
          for (let i = 1; i < n; i++) {
            const t = i / (n - 1);
            c.strokeStyle = rb.col;
            c.globalAlpha = (0.07 + t * 0.5) * rb.fade;
            c.lineWidth = (1.5 + t * 11) * d;
            c.beginPath();
            c.moveTo(pts[i - 1].x * W, pts[i - 1].y * H);
            c.lineTo(pts[i].x * W, pts[i].y * H);
            c.stroke();
          }
          c.globalAlpha = rb.fade;
          const hx = pts[n - 1].x * W, hy = pts[n - 1].y * H;
          const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 34 * d);
          rg.addColorStop(0, rb.col + 'cc'); rg.addColorStop(1, rb.col + '00');
          c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 34 * d, 0, TAU); c.fill();
          c.restore();
        }
      }
    }

    // contact ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += dt;
      const a = 1 - r.t / r.life;
      if (a <= 0) { this.ripples.splice(i, 1); continue; }
      c.strokeStyle = r.col; c.globalAlpha = a * 0.7;
      c.lineWidth = 3 * d * a;
      c.beginPath(); c.arc(r.x * W, r.y * H, (12 + (1 - a) * 70) * d, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;

    // Live words are DOM text in the lower play band, never painted on the table.
  }

  ripple(x, y, col) { if (!this.reducedMotion) this.ripples.push({ x, y, col, t: 0, life: 0.55 }); }

  /* ------------------------------ tick ----------------------------- */
  tick(dt) {
    const g = this.game; if (!g) return;
    // The overlay backing store must follow the #gl rect even when the
    // embedder resizes the frame without firing window `resize`.
    const gr = document.getElementById('gl').getBoundingClientRect();
    if (gr.width && gr.height &&
        (Math.abs(gr.width - (this.fxw || 0)) > 0.5 || Math.abs(gr.height - (this.fyh || 0)) > 0.5)) this.resize();
    this.syncPauseControl();
    this.drawOverlay(dt);
    // A single short status, never a stack of messages/telemetry/hints.
    const status = $('#playStatus');
    let statusText = '';
    if (g.state === GS.POINT && g.stateT < 0.95)
      statusText = g.lastPoint ? (g.lastPoint.who > 0 ? 'Очко ваше' : 'Очко сопернику') : 'Переигровка';

    if (g.training || g.demoMode || g.paused) statusText = '';
    status.textContent = statusText;
    status.hidden = !statusText;

    const timing = $('#timingCue'), gesture = $('#gestureCue');
    timing.classList.remove('on');
    timing.textContent = ''; // No instructional text during normal play.
    gesture.classList.remove('on'); // ShotJournal is the single source of recognition feedback.
    const box = $('#msgs');
    const bDemo = $('#btnDemoExit');
    if (bDemo) bDemo.style.display = (g.demoMode && g.state !== 'MENU' && g.state !== 'MATCH_END') ? 'block' : 'none';
    const messageSignature = g.messages.slice(-2).map(m => m.text + '|' + m.col).join('\n');
    if (messageSignature !== this._messageSignature) {
      this._messageSignature = messageSignature;
      box.innerHTML = g.messages.slice(-2).map((m) =>
        `<div class="msg${m.big ? ' big' : ''}" style="color:${m.col}">${m.text}</div>`).join('');
    }

    // Match point joins the other cues below the table.
    const mpi = $('#mpInd');
    if (mpi) {
      const T = g.settings.targetScore;
      const live = g.state === 'RALLY' || g.state === 'SERVE_READY' || g.state === 'SERVE_TOSS';
      const us = g.score[0] >= T - 1 && g.score[0] > g.score[1];
      const them = g.score[1] >= T - 1 && g.score[1] > g.score[0];
      const on = live && !g.training && (us || them);
      mpi.classList.toggle('on', on);
      mpi.classList.toggle('them', them && !us);
      if (on) mpi.textContent = them && !us ? 'МАТЧБОЛ СОПЕРНИКА' : 'МАТЧБОЛ';
    }

    // Adapt typography to the free space BELOW the table; no guessed pixels.
    const band = $('#playband');
    if (band) {
      if (g.training) {
        const controls = $('#topright').getBoundingClientRect();
        $('#train').style.maxWidth = Math.max(100, controls.left - 28) + 'px';
      }
      const bandSig = `${g.hudBandY}|${window.innerWidth}|${window.innerHeight}|${!!g.training}`;
      if (this._bandH === undefined || this._bandSig !== bandSig) {
        this._bandSig = bandSig;
        const h = band.clientHeight;
        this._bandH = h;
        band.classList.toggle('band-short', h < 150);
        band.classList.toggle('band-tiny', h < 92);
      }
    }

    const rb = $('#rally');
    const showRally = !g.training && g.rally > 2;
    rb.classList.toggle('on', showRally);
    if (showRally) rb.innerHTML = `РАЛЛИ <b>${g.rally}</b> · РЕКОРД <b>${Math.max(g.bestRally, g.rally)}</b>`;

    this.syncShotFeedback();
    if (this.shotTimer > 0) { this.shotTimer -= dt; if (this.shotTimer <= 0) $('#shot').classList.remove('on'); }
    if (this.noteTimer > 0) { this.noteTimer -= dt; if (this.noteTimer <= 0) this.hideNote(); }

    if (g.training && g.training._uiStamp !== g.training.phase + g.training.done + g.training.step + g.training.msg) {
      g.training._uiStamp = g.training.phase + g.training.done + g.training.step + g.training.msg;
      this.trainSync(g.training);
    }

    if (g.settings.showTele) {
      const w = g.ball.w;
      const top = -w.x / TAU, side = w.y / TAU;
      const setG = (el, v, max, pc, nc) => {
        const f = clamp(v / max, -1, 1);
        if (f >= 0) { el.style.left = '50%'; el.style.right = (50 - f * 50) + '%'; el.style.background = pc; }
        else { el.style.right = '50%'; el.style.left = (50 + f * 50) + '%'; el.style.background = nc; }
      };
      setG($('#gTop'), top, 160, 'var(--acc2)', 'var(--acc)');
      setG($('#gSide'), side, 140, 'var(--good)', 'var(--good)');
      $('#gTopV').textContent = (top >= 0 ? '+' : '') + top.toFixed(0) + ' об/с';
      $('#gSideV').textContent = (side >= 0 ? '+' : '') + side.toFixed(0) + ' об/с';
      $('#ballKmh').textContent = (V3.len(g.ball.v) * 3.6).toFixed(0);
    }

    const dbg = $('#dbg');
    dbg.classList.toggle('on', g.settings.showDebug);
    if (g.settings.showDebug) {
      const b = g.ball, sp = V3.len(b.v), wl = V3.len(b.w);
      const Re = (sp * 2 * PH.R) / PH.NU;
      const S = PH.R * wl / Math.max(sp, 0.6);
      const a = aeroAccel(V3.new(), b.v, b.w);
      const magn = Math.hypot(a.x, a.y + PH.G, a.z) / PH.G;
      dbg.innerHTML =
        `<b>FPS</b> ${g.fps.toFixed(0)}  <b>PEAK</b> ${(g.peakMs || 0).toFixed(0)}ms  <b>DC</b> ${g.R.drawCalls}  <b>TRI</b> ${(g.R.tris / 1000).toFixed(1)}k\n` +
        `<b>GL</b> ${g.R.isGL2 ? 'WebGL2' : 'WebGL1'}\n` +
        `<b>state</b> ${g.state}  <b>ts</b> ${g.timeScale.toFixed(2)}\n` +
        `<b>ball</b> p(${b.p.x.toFixed(2)},${b.p.y.toFixed(2)},${b.p.z.toFixed(2)})\n` +
        `      v ${sp.toFixed(2)} m/s = ${(sp * 3.6).toFixed(0)} km/h\n` +
        `      w (${b.w.x.toFixed(0)},${b.w.y.toFixed(0)},${b.w.z.toFixed(0)}) = ${(wl / TAU).toFixed(0)} rev/s\n` +
        `<b>Re</b> ${(Re / 1000).toFixed(1)}k  <b>S</b> ${S.toFixed(2)}  <b>Magnus</b> ${magn.toFixed(2)} g\n` +
        `<b>paddle</b> v ${V3.len(g.player.vel).toFixed(2)} m/s\n` +
        `<b>swipe</b> sp ${g.swipe.m.speed.toFixed(2)} curl ${g.swipe.m.curl.toFixed(2)}\n` +
        `<b>assist</b> ${(g.settings.assist * 100) | 0}%  <b>pos</b> ${(g.settings.posAssist * 100) | 0}%`;
    }
  }

  /* ================================================================
   *  CAREER MODE UI (ported from PR #1, screens reuse .screen/.opt)
   * ================================================================ */
  bindCareer() {
    const g = this.game;
    $('#careerStart').addEventListener('click', () => {
      g.audio.init(); g.audio.resume(); g.audio.ui('click');
      if (g.career.load()) {
        if (g.career.state === 'PERK_SELECT') this.showCareerPerks(g.career);
        else if (g.career.state === 'TOURNAMENT_END') this.showCareerTournamentEnd(g.career);
        else this.showCareerIntro(g.career);
      } else {
        g.career.start();
        this.showCareerIntro(g.career);
      }
    });
    $('#crReady').addEventListener('click', () => {
      g.audio.ui('click');
      const c = g.career;
      c.readyForOpponentSelect();
      this.showCareerOpponentSelect(c);
    });
    $('#crEndRestart').addEventListener('click', () => {
      g.audio.ui('click');
      $('#careerEnd').classList.remove('on');
      g.career.start();
      this.showCareerIntro(g.career);
    });
    $('#crEndMenu').addEventListener('click', () => {
      g.audio.ui('click');
      this.showMainMenu();
    });
  }

  showCareerIntro(career) {
    const t = career.currentTournamentInfo;
    $$('.screen').forEach(s => s.classList.remove('on'));
    $('#crOppList').replaceChildren();
    $('#crReady').hidden = false;
    $('#crTournName').textContent = t.name;
    $('#crTournMark').textContent = String(t.id + 1).padStart(2, '0');
    $('#crTournPlace').textContent = t.place;
    $('#crTournInfo').textContent = `Раундов: ${t.rounds} · ELO ${t.eloMin}–${t.eloMax} · Побед: ${career.totalWins}`;
    $('#careerIntro').classList.add('on');
  }

  showCareerOpponentSelect(career) {
    const g = this.game;
    $$('.screen').forEach(s => s.classList.remove('on'));
    const t = career.currentTournamentInfo;
    $('#crTournName').textContent = t.name;
    $('#crTournMark').textContent = String(t.id + 1).padStart(2, '0');
    $('#crReady').hidden = true;
    const list = $('#crOppList');
    list.innerHTML = '';
    career.opponents.forEach((opp, i) => {
      const btn = document.createElement('button');
      btn.className = 'opt';
      const name = document.createElement('b'), detail = document.createElement('s');
      name.textContent = opp.name; detail.textContent = `${opp.style} · ELO ${opp.elo}`;
      btn.append(name, detail);
      btn.addEventListener('click', () => {
        g.audio.ui('click');
        $$('.screen').forEach(s => s.classList.remove('on'));
        career.selectOpponent(i);
      });
      list.appendChild(btn);
    });
    const status = document.createElement('div');
    status.className = 'note';
    status.textContent = `Раунд ${career.currentRound + 1} из ${career.currentTournamentInfo.rounds} · Перков: ${career.perks.length}`;
    status.style.marginTop = '10px';
    list.appendChild(status);
    $('#careerIntro').classList.add('on');
  }

  showCareerPerks(career) {
    const g = this.game;
    $$('.screen').forEach(s => s.classList.remove('on'));
    const list = $('#crPerkList');
    list.innerHTML = '';
    career.pendingPerks.forEach((perk, i) => {
      const btn = document.createElement('button');
      btn.className = 'opt';
      const colors = { green: '#4ee39a', blue: '#39c6ff', gold: '#ffd34d' };
      btn.style.borderColor = colors[perk.rarity] || '#39c6ff';
      btn.innerHTML = `<b style="color:${colors[perk.rarity]}">${perk.name}</b><small>${perk.desc}</small>`;
      btn.addEventListener('click', () => {
        g.audio.ui('click');
        career.selectPerk(i);
        $$('.screen').forEach(s => s.classList.remove('on'));
        this.showCareerOpponentSelect(career);
      });
      list.appendChild(btn);
    });
    $('#careerPerk').classList.add('on');
  }

  showCareerTournamentEnd(career) {
    const t = career.currentTournamentInfo;
    this.showNote({ text: `${t.name} ПОБЕЖДЁН!`, col: '#ffd34d', code: 'win' });
    clearTimeout(this._careerTimer);
    this._careerTimer = setTimeout(() => {
      if (!career.active || career.state !== 'TOURNAMENT_END') return;
      career.advanceTournament();
      if (career.state === 'RUN_END') {
        this.showCareerRunEnd(career);
      } else {
        this.showCareerIntro(career);
      }
    }, 2500);
  }

  showCareerRunEnd(career) {
    $$('.screen').forEach(s => s.classList.remove('on'));
    const t = TOURNAMENTS[Math.min(career.currentTournament, TOURNAMENTS.length - 1)] || TOURNAMENTS[0];
    const isVictory = career.currentTournament >= TOURNAMENTS.length;
    $('#crEndTitle').textContent = isVictory ? 'ЧЕМПИОН МИРА!' : t.name;
    $('#careerEnd').classList.toggle('career-victory', isVictory);
    $('#crEndSub').textContent = isVictory
      ? 'Вы прошли все 12 турниров. Легенда.'
      : `Выбыли на турнире: ${t.name}`;
    const stats = $('#crEndStats');
    stats.innerHTML = `
      <div class="recap">
        <div class="rc"><i style="background:#4ee39a"></i><b>${career.totalWins}</b><small>побед</small></div>
        <div class="rc"><i style="background:#ff5d6e"></i><b>${career.totalLosses}</b><small>поражений</small></div>
        <div class="rc"><i style="background:#39c6ff"></i><b>${career.perks.length}</b><small>перков</small></div>
        <div class="rc"><i style="background:#ffd34d"></i><b>${Math.round(career.runStats.maxSpeed)}</b><small>км/ч макс</small></div>
      </div>
    `;
    career.stop();
    try { localStorage.removeItem('topspin_career'); } catch(e) {}
    $('#careerEnd').classList.add('on');
  }

  /* ================================================================
   *  ONLINE MODE UI (relay; server picked via ?net= — see 27_network)
   * ================================================================ */
  bindOnline() {
    const g = this.game;
    const net = g.network;
    $('#onlineStart').addEventListener('click', () => {
      g.returnToMenu();
      g.audio.init(); g.audio.resume(); g.audio.ui('click');
      $$('.screen').forEach(s => s.classList.remove('on'));
      $('#netStatus').textContent = 'Подключение...';
      $('#netRoomCode').style.display = 'none';
      $('#onlineLobby').classList.add('on');
      net.connect();
    });
    net.on('connected', () => {
      $('#netStatus').textContent = 'Подключено! Создайте комнату.';
      $('#netRoomCode').style.display = 'none';
    });
    net.on('assigned', (msg) => {
      $('#netRoomCode').textContent = msg.room;
      $('#netRoomCode').style.display = 'block';
      $('#netStatus').textContent = msg.side === 1
        ? 'Вы хост. Ждём соперника...'
        : 'Подключены к комнате.';
    });
    net.on('matchStart', () => {
      $$('.screen').forEach(s => s.classList.remove('on'));
      g.startMatch();
    });
    net.on('disconnected', () => {
      this.showMainMenu();
      this.toast('СОЕДИНЕНИЕ ПРЕРВАНО');
    });
    net.on('error', (msg) => {
      $('#netStatus').textContent = `Ошибка: ${msg}`;
    });
    net.on('peerLeft', () => {
      this.showMainMenu();
      this.toast('СОПЕРНИК ВЫШЕЛ');
    });
    $('#netCreate').addEventListener('click', () => {
      g.audio.ui('click');
      net.joinRoom();
    });
    $('#netJoin').addEventListener('click', () => {
      g.audio.ui('click');
      const code = prompt('Введите код комнаты:');
      if (code) net.joinRoom(code.toUpperCase().trim());
    });
    $('#netClose').addEventListener('click', () => {
      g.audio.ui('click');
      this.showMainMenu();
    });
  }
}

const CSSFONT = '"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif';

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const ICON = {
  fullscreen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg>',
  sound: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  mute: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  menu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
  pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/></svg>',
};
