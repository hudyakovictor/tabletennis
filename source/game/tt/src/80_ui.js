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
    /* Только основная кнопка определяет семейство ввода: правый/средний драг
     * камеры — это не «пользователь перешёл на мышь», и в тач-сессии он не
     * должен тайком включать desktop-управление камерой обратно. */
    document.addEventListener('pointerdown', e => { if (e.button === 0) this.setInputMode(e.pointerType); }, { capture: true, passive: true });
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
    this.updateInputCopy();
  }
  updateInputCopy() {
    const touch = this.inputMode === 'touch';
    $('#cameraHelp').textContent = 'Три готовых вида. Кадр одинаковый на всех устройствах и не требует настройки.';
    $('#gl').setAttribute('aria-label', touch
      ? 'Игровое поле. Короткий тап отбивает мяч, свайп задаёт вращение. Вид камеры — в настройках.'
      : 'Игровое поле. Короткий клик отбивает мяч, ЛКМ с движением задаёт вращение. Вид камеры — 1, 2, 3 или в настройках.');
    if (this.game && this.game.training) this.trainSync(this.game.training);
  }

  openSettings() {
    this.syncSettings();
    this._settingsWasPaused = this.game.paused;
    this.game.setPaused(true);
    $('#settings').classList.add('on');
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
  /* Кнопка инспекторского слоу-мо: иконка рисуется один раз, состояние
   * (aria-pressed + подсветка) догоняет тумблер каждый кадр — переключатель
   * может прийти и из оболочки (сообщение slowmo), и с этой же кнопки. */
  syncSlowmoControl() {
    const button = $('#btnSlowmo'), g = this.game;
    if (!button) return;
    if (!button.innerHTML) button.innerHTML = ICON.slowmo;
    if (!g) return;
    const on = !!g.inspectSlowmo;
    if (button.dataset.slowmoOn !== String(on)) {
      button.dataset.slowmoOn = String(on);
      button.setAttribute('aria-pressed', String(on));
      button.title = on ? 'Слоу-мо включено: обычная скорость' : 'Слоу-мо: разобрать траекторию';
      button.setAttribute('aria-label', button.title);
    }
  }
  syncPauseControl() {
    const button = $('#btnMenu'), g = this.game;
    if (!button || !g) return;
    const key = `${g.state}|${g.paused}|${!!g.debugRecording}`;
    if (button.dataset.syncState === key) return;
    const mark = $('#diagMark'); if (mark) mark.hidden = !g.debugRecording || g.paused || g.state === GS.MENU || g.state === GS.MATCH_END;
    const record = $('#diagnosticRecordPause'); if (record) record.checked = !!g.debugRecording;
    if (g.paused) this.refreshDiagnosticPause();
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
    this.fx.width = Math.floor(window.innerWidth * d);
    this.fx.height = Math.floor(window.innerHeight * d);
    this.fx.style.width = window.innerWidth + 'px';
    this.fx.style.height = window.innerHeight + 'px';
    this.dpr = d;
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
    /* --- workshop / shop / daily --- */
    const wsOpen = (tab) => {
      this.game.audio.ui('click');
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
    const pauseActions = document.querySelector('.pause-actions');
    if (pauseActions) pauseActions.addEventListener('click', e => e.stopPropagation());
    $('#diagnosticRecordPause').addEventListener('change', e => {
      this.game.setDiagnosticMode(e.target.checked);
      try { sessionStorage.setItem('ttu-debug-recording', e.target.checked ? '1' : '0'); } catch (err) {}
      this.syncPauseControl(); this.refreshDiagnosticPause();
    });
    $('#diagMark').addEventListener('click', e => {
      e.stopPropagation();
      try { this._diagnosticBookmark = this.game.captureDiagnosticFrame(true); this.game.logInput('bookmark', { outcome: { capturedAt: this._diagnosticBookmark.capturedAt } }); }
      catch (err) { this.game.diagnosticIssue('screenshot', err && err.message || err, err && err.stack); }
    });
    $('#diagnosticShotPause').addEventListener('click', () => {
      try {
        this._diagnosticBookmark = this.game.captureDiagnosticFrame(true); this.refreshDiagnosticPause();
        const reveal = () => {
          const box = $('#diagnosticPreview'), body = document.querySelector('.pause-actions');
          if (!box || box.hidden || !body) return;
          body.scrollTop += box.getBoundingClientRect().top - body.getBoundingClientRect().top;
        };
        requestAnimationFrame(reveal);
        const image = $('#diagnosticImage');
        if (image && typeof image.decode === 'function') image.decode().then(() => requestAnimationFrame(reveal)).catch(() => {});
        setTimeout(() => this.refreshDiagnosticPause(), 500);
      } catch (err) { $('#diagnosticStatus').textContent = 'Не удалось сделать снимок: ' + (err && err.message || err); }
    });
    $('#diagnosticReportPause').addEventListener('click', async e => {
      e.target.disabled = true; $('#diagnosticStatus').textContent = 'Подготавливаем отчёт…';
      try {
        const report = await this.game.diagnosticReport();
        // Keep the same evidence with a smaller export on memory-limited phones.
        this._diagnosticReportText = JSON.stringify(report);
        if (this._diagnosticReportUrl) URL.revokeObjectURL(this._diagnosticReportUrl);
        this._diagnosticReportUrl = URL.createObjectURL(new Blob([this._diagnosticReportText], { type: 'application/json' }));
        const link = $('#diagnosticReportLink'); link.href = this._diagnosticReportUrl; link.hidden = false;
        $('#diagnosticTextButton').hidden = false; this.refreshDiagnosticPause();
      } catch (err) { $('#diagnosticStatus').textContent = 'Не удалось подготовить отчёт: ' + (err && err.message || err); }
      finally { e.target.disabled = false; }
    });
    $('#diagnosticTextButton').addEventListener('click', () => {
      const area = $('#diagnosticText'); area.value = this._diagnosticReportText || ''; area.hidden = false; area.focus(); area.select();
    });
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
    const slowmoBtn = $('#btnSlowmo');
    if (slowmoBtn) slowmoBtn.addEventListener('click', () => {
      const g = this.game; if (!g || !g.setInspectSlowmo) return;
      g.setInspectSlowmo(!g.inspectSlowmo);
      this.syncSlowmoControl();
      g.audio && g.audio.ui('click');
    });
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
      /* Сamera trim sliders: live, quiet (no click per tick), self-saving. */
      case 'camZoom': g.setCamZoom(v / 100); return;
      case 'camPitch': g.setCamPitch(v); return;
      case 'quality': s.quality = v; g.R.quality = v; g.resize(); break;
      case 'hand': case 'grip': g.changePaddlePreference(k, v); break;
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
      case 'target': s.targetScore = +v; $('#toWin').textContent = v; break;
      /* Калибровка закрутки: ползунки в процентах, хранится множитель. */
      case 'spinGain': s.spinGain = clamp(v / 100, 0.5, 1.6); break;
      case 'arcSens': s.arcSens = clamp(v / 100, 0.6, 1.8); break;
      default: break;
    }
    if (k === 'spinGain' || k === 'arcSens') {
      const val = String(Math.round(s[k] * 100));
      $$('input[type=range][data-set="' + k + '"]').forEach(r => { if (r.value !== val) r.value = val; });
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
    for (const k of ['hand', 'grip']) {
      $$(`.opt[data-set="${k}"]`).forEach(b => {
        const selected = b.dataset.val === s[k];
        b.classList.toggle('sel', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
    }
    this.syncCameraControls();
    for (const [id, v] of [['#spinGain', s.spinGain], ['#spinGainLab', s.spinGain], ['#arcSens', s.arcSens], ['#arcSensLab', s.arcSens]]) {
      const el = $(id); if (el) el.value = String(Math.round((Number.isFinite(v) ? v : 1) * 100));
    }
  }
  syncCameraControls() {
    const g = this.game, s = g.settings;
    $$('#cameraViews [data-camera]').forEach(b => {
      const selected = b.dataset.camera === s.camera;
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
    /* Подсветка ИМЕННО этого удара: имя вспыхивает цветом архетипа
     * (накат — свой цвет, боковая — свой), чтобы глаз связывал жест,
     * название и полёт мяча без чтения мелкого текста. */
    const stCol = (typeof STROKES !== 'undefined' && entry.strokeId && STROKES[entry.strokeId])
      ? STROKES[entry.strokeId].col : null;
    el.style.setProperty('--shotc', stCol || '#ffd34d');
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    this.shotTimer = 7;
  }
  openShotLab() {
    this.syncSettings();
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
  refreshDiagnosticPause() {
    const g = this.game, status = $('#diagnosticStatus'); if (!g || !status || !g.inputLog) return;
    const stats = g.inputLog.stats(g.time), archive = g.diagnosticRecoveryArchive();
    if (archive && archive.status === 'opening' && this._diagnosticRecoveryReady !== archive) {
      this._diagnosticRecoveryReady = archive;
      archive.ready.then(() => this.refreshDiagnosticPause());
    }
    const storage = archive && archive.status === 'available' ? 'локальное восстановление доступно'
      : archive && archive.status === 'opening' ? 'подключаем локальное хранилище' : 'восстановление после перезагрузки недоступно';
    const frameStatus = this._diagnosticBookmark ? ' · ' + (archive && archive.frameStatus === 'saved' ? 'кадр в локальном резерве'
      : archive && archive.frameStatus === 'pending' ? 'сохраняем кадр' : 'кадр только в памяти') : '';
    status.textContent = `${g.debugRecording ? 'Запись включена' : 'Запись выключена'} · в памяти ${Math.round(stats.retainedWallSeconds)} с / ${stats.inWindow} событий · ${storage}${frameStatus}`;
    if (!this._diagnosticBookmark && !this._diagnosticRestoreTried && g.debugArchive) {
      this._diagnosticRestoreTried = true;
      g.debugArchive.readFrame().then(saved => {
        if (saved && !this._diagnosticBookmark) { this._diagnosticBookmark = saved; this.refreshDiagnosticPause(); }
      }).catch(() => {});
    }
    const frame = this._diagnosticBookmark || g._diagnosticFrame, box = $('#diagnosticPreview');
    if (frame && frame.dataUrl && box) {
      box.hidden = false;
      $('#diagnosticFrameTime').textContent = frame.capturedAt ? 'Время снимка: ' + new Date(frame.capturedAt).toLocaleString() : '';
      $('#diagnosticImage').src = frame.dataUrl; $('#diagnosticImageLink').href = frame.dataUrl;
    }
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
  trainHide() { $('#trainingActions').hidden = true; $('#train').classList.remove('on'); $('#score').style.opacity = ''; $('#tdone').classList.remove('on'); const ti = $('#tIntro'); if (ti) ti.classList.remove('on'); }
  trainSync(t) {
    const S = t.S, feedback = t.phase === 'ok' || t.phase === 'fail';
    $('#trStep').textContent = `${t.step + 1}/${TRAIN_STEPS.length}`;
    $('#trTitle').textContent = ET(S.title);
    $('#trProgress').textContent = `${t.done}/${S.need}`;
    /* во время интро строку шапка НЕ дублирует — вся информация живёт
       в большой карточке урока */
    $('#trTip').textContent = t.phase === 'intro' ? ''
      : t.phase === 'fail'
      ? ET('ui.tapRetry')
      : feedback ? '' : (t.coachText || ET(S.goal));
    $('#trainPauseTip').textContent = trainingTip(S, this.inputMode);
    $('#trMsg').textContent = feedback ? t.msg : '';
    $('#trMsg').style.color = t.msgCol || 'var(--good)';
    /* большое объявление урока: каждый новый удар представлен КРУПНО,
       с целью и жестом — до этого о смене удара сообщал только мелкий текст */
    const ti = $('#tIntro');
    /* во время объявления урока мелкая шапка прячется: карточка — единственный
     * источник текста, дублей больше нет нигде */
    $('#train').classList.toggle('ti-hide', t.phase === 'intro');
    if (ti) {
      const show = t.phase === 'intro';
      ti.classList.toggle('on', show);
      if (show && this._tIntroStep !== t.step) {
        this._tIntroStep = t.step;
        /* «НОВЫЙ УДАР» — только для действительно новых ударов; базовое
         * отбитие и направление — просто очередной урок */
        const isNewStroke = S.id === 'TOPSPIN' || S.id === 'PUSH';
        $('#tINo').textContent = t.step === 0 ? ET('ui.lessonFirst', { total: TRAIN_STEPS.length })
          : isNewStroke ? ET('ui.lessonNew', { n: t.step + 1, total: TRAIN_STEPS.length })
          : ET('ui.lesson', { n: t.step + 1, total: TRAIN_STEPS.length });
        $('#tITitle').textContent = ET(S.title);
        $('#tIGoal').textContent = ET(S.goal);
        $('#tITip').textContent = trainingTip(S, this.inputMode);
      }
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

  /* ==================================================================
   *  Coach layer (tutorial + optional match hint)
   *  The ring is drawn where the ball will MEET the bat, at the honest
   *  size of the capture radius at that depth — what you see is what
   *  counts. The shrinking outer circle closes exactly at contact.
   * ================================================================== */
  coachCueNow() {
    const g = this.game;
    if (!g || g.paused || (g.replayer && g.replayer.on)) return null;
    if (g.training) return typeof g.training.coachCue === 'function' ? g.training.coachCue() : null;
    if (g.hintContact && g.state === GS.RALLY && typeof g.contactPrediction === 'function') {
      /* ONE mark, pinned to the world point it appeared at — it never roams
       * across the screen (that travelling ring was the whole complaint).
       * Opens ~300 ms before contact, heats up, carries the ideal-contact dot,
       * vanishes on the swing — and its lifecycle is airtight so no stale
       * mark survives on screen:
       *  - it only lives while the opponent's ball ACTUALLY travels at the
       *    player (toward-guard on v.z; after a whiff the ball sails on as
       *    'missed' and a fossil mark would otherwise keep rendering);
       *  - the pin is gated on THIS flight's geometry (the ball is already
       *    on the player's side of the net), never on a bounce counter
       *    accumulated over the whole rally — that stale gate kept the old
       *    mark alive between shots and made it 'jump' between contacts;
       *  - a mark whose ball flew past the pinned plane un-hit dies at once. */
      if (g.ball.lastHitBy === 1) { this._mark = null; return null; }
      const toward = g.ball.v && g.ball.v.z > 0.05;
      if (!toward) { this._mark = null; return null; }
      const cp = g.contactPrediction();
      if (!this._mark || this._mark.shot !== g.shotId) {
        this._mark = null;
        if (cp && cp.t < 0.30 && g.ball.p.z > -0.04)
          this._mark = { shot: g.shotId, p: { x: cp.p.x, y: cp.p.y, z: cp.p.z } };
        else return null;
      }
      /* мяч пролетел мимо укреплённой плоскости — метка умирает сразу,
       * не дожидаясь конца очка */
      if (this._mark && g.ball.p.z > this._mark.p.z + 0.10) { this._mark = null; return null; }
      return { kind: 'mark', p: this._mark.p, t: cp ? cp.t : .15, subtle: true };
    }
    this._mark = null;
    return null;
  }

  coachRadius(p, x, W, serve) {
    const g = this.game, d = this.dpr;
    if (serve) return 30 * d;
    const q = g.project({ x: p.x + MATCH_RULES.captureRadius, y: p.y, z: p.z }, {});
    const r = q && q.ok ? Math.abs(q.x * W - x) : 40 * d;
    return clamp(r, 22 * d, 64 * d);
  }

  drawAimTarget(c, W, H, d, side, now) {
    const g = this.game, y = PH.TABLE_Y + 0.002;
    const xs = side === 0 ? [-0.28, 0.28] : side > 0 ? [0.04, PH.T_HALF_WID] : [-PH.T_HALF_WID, -0.04];
    const pts = [[xs[0], -PH.T_HALF_LEN], [xs[1], -PH.T_HALF_LEN], [xs[1], -0.06], [xs[0], -0.06]]
      .map(([x, z]) => g.project({ x, y, z }, {}));
    if (pts.some((q) => !q || !q.ok)) return;
    const a = 0.20 + 0.10 * Math.sin(now * 5);
    c.save();
    c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x * W, q.y * H) : c.moveTo(q.x * W, q.y * H))); c.closePath();
    c.fillStyle = `rgba(53,198,244,${a})`; c.fill();
    c.lineWidth = 2 * d; c.strokeStyle = 'rgba(125,243,255,.9)'; c.shadowColor = '#35C6F4'; c.shadowBlur = 14 * d; c.stroke();
    c.restore();
  }

  drawGhostFinger(c, d, x0, y0, x1, y1, ph) {
    // a hand (Material «touch_app», Apache-2.0) whose fingertip traces the stroke
    if (!this._handPath && typeof Path2D !== 'undefined')
      this._handPath = new Path2D('M9 11.24V7.5C9 6.12 10.12 5 11.5 5S14 6.12 14 7.5v3.74c1.21-.81 2-2.18 2-3.74C16 5.01 13.99 3 11.5 3S7 5.01 7 7.5c0 1.56.79 2.93 2 3.74zm9.84 4.63l-4.54-2.26c-.17-.07-.35-.11-.54-.11H13v-6c0-.83-.67-1.5-1.5-1.5S10 6.67 10 7.5v10.74l-3.43-.72c-.08-.01-.15-.03-.24-.03-.31 0-.59.13-.79.33l-.79.8 4.94 4.94c.27.27.65.44 1.06.44h6.79c.75 0 1.33-.55 1.44-1.28l.75-5.27c.01-.07.02-.14.02-.2 0-.62-.38-1.16-.91-1.38z');
    const e = ph < 0.22 ? 0 : ph > 0.74 ? 1 : (ph - 0.22) / 0.52;
    const k = e * e * (3 - 2 * e);
    const fx = x0 + (x1 - x0) * k, fy = y0 + (y1 - y0) * k;
    const fade = ph > 0.86 ? 1 - (ph - 0.86) / 0.14 : ph < 0.08 ? ph / 0.08 : 1;
    c.save(); c.globalAlpha = fade;
    if (k > 0.01) {
      const gr = c.createLinearGradient(x0, y0, fx, fy);
      gr.addColorStop(0, 'rgba(255,230,153,0)'); gr.addColorStop(1, 'rgba(255,240,200,.9)');
      c.strokeStyle = gr; c.lineCap = 'round'; c.lineWidth = 9 * d;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(fx, fy); c.stroke();
    }
    // touch-down ripple at the start of the stroke
    if (ph >= 0.08 && ph < 0.4) {
      const r = (ph - 0.08) / 0.32;
      c.strokeStyle = `rgba(255,255,255,${0.28 * (1 - r)})`; c.lineWidth = 1.8 * d;
      c.beginPath(); c.arc(x0, y0, 8 * d + r * 26 * d, 0, TAU); c.stroke();
    }
    const press = ph < 0.22 ? 1 - Math.sin(ph / 0.22 * Math.PI) * 0.12 : 1;
    if (this._handPath) {
      const sc = 2.5 * d * press;
      c.translate(fx, fy); c.scale(sc, sc); c.translate(-11.5, -4);
      c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 8 * d; c.shadowOffsetY = 3 * d;
      c.fillStyle = '#fff'; c.fill(this._handPath);
      c.shadowColor = 'transparent'; c.lineWidth = 0.6; c.strokeStyle = 'rgba(10,14,30,.55)'; c.stroke(this._handPath);
    } else {
      c.fillStyle = 'rgba(255,255,255,.95)'; c.beginPath(); c.arc(fx, fy, 12 * d, 0, TAU); c.fill();
    }
    c.restore();
  }

  drawCoach(c, W, H, d) {
    const g = this.game, now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    let cue = this.coachCueNow();
    /* Никакого «досвета» последнего кадра и никакого сглаживания между
     * позициями: точки сигналов теперь ПРИКОЛОЧЕНЫ при появлении (матч —
     * coachCueNow, тренировка — training.coachCue), а кольцо должно просто
     * появляться и исчезать в нужном месте, а не плыть за прогнозом. */
    if (!cue) return false;
    if (cue.kind === 'aim') { this.drawAimTarget(c, W, H, d, cue.side || 0, now); return true; }
    if (cue.kind === 'mark') {
      /* static strike mark: one ring + the ideal-contact dot, pinned in the
       * world, white → butter-yellow as the window closes. Nothing chases the
       * ball, nothing slides, no chevrons, no approach circles. */
      const q = g.project(cue.p, {});
      if (!q || !q.ok || !Number.isFinite(q.x)) return false;
      const mx0 = q.x * W, my0 = q.y * H;
      const rr = this.coachRadius(cue.p, mx0, W, false);
      const padE = rr + ((MATCH_RULES.contactEdgePx || 20) + 6) * d;
      const mx = clamp(mx0, padE, W - padE), my = clamp(my0, 90 * d, H - 70 * d);
      const heat = clamp(1 - (cue.t || .3) / .30, 0, 1);
      c.save();
      c.globalAlpha = 0.8 + 0.2 * heat;
      c.shadowColor = heat > .66 ? '#FFE699' : '#35C6F4'; c.shadowBlur = (8 + heat * 6) * d;
      c.strokeStyle = heat > .66 ? '#FFE699' : 'rgba(255,255,255,.92)';
      c.lineWidth = (2 + heat * 1.6) * d;
      c.beginPath(); c.arc(mx, my, rr, 0, TAU); c.stroke();
      c.shadowBlur = 0;
      c.beginPath(); c.arc(mx, my, (3 + heat * 4.4) * d, 0, TAU);
      c.fillStyle = heat > .85 ? '#8CFF9E' : '#FFD54A'; c.fill();
      c.lineWidth = 1.5 * d; c.strokeStyle = 'rgba(255,255,255,.9)'; c.stroke();
      c.restore();
      return true;
    }
    const p = g.project(cue.p, {});
    if (!p || !p.ok || !Number.isFinite(p.x)) return false;
    let x = p.x * W, y = p.y * H;
    let r = this.coachRadius(cue.p, x, W, cue.serve || cue.kind === 'tap');
    if (!cue.frozen && cue.kind === 'contact') {
      /* an opponent's wide serve predicts a meeting point at (or past) the
       * screen edge: clamp the ring into view — the gate clamps press
       * admission the same way. Позиция мгновенная: сама точка уже
       * приколочена выше по стеку, скольжения не нужны. */
      const mx = ((MATCH_RULES.contactEdgePx || 20) + 24) * d, my = 96 * d;
      x = clamp(x, mx, W - mx); y = clamp(y, my, H - my);
    }
    if (cue.aim !== undefined) this.drawAimTarget(c, W, H, d, cue.aim, now);
    if (cue.nudge > 0) x += Math.sin(now * 70) * 7 * d * Math.min(1, cue.nudge * 2);
    c.save();
    if (cue.frozen) {
      // the world stops: dim everything except a window around the ring
      c.fillStyle = 'rgba(3,6,14,.62)'; c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'destination-out';
      const hole = c.createRadialGradient(x, y, r * 1.2, x, y, r * 3.4);
      hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = hole; c.beginPath(); c.arc(x, y, r * 3.4, 0, TAU); c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    const alpha = (cue.subtle ? 0.75 : 1) *
      (cue.fade !== undefined ? cue.fade : 1) *
      (cue._holdAge !== undefined ? Math.max(.25, 1 - cue._holdAge / .24) : 1);
    c.globalAlpha = alpha;
    if (cue.kind === 'tap') {
      const ph = (now % 1.2) / 1.2;
      c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2.5 * d;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
      c.globalAlpha = (1 - ph) * alpha; c.lineWidth = 3 * d;
      c.beginPath(); c.arc(x, y, r * (1 + ph * 1.8), 0, TAU); c.stroke();
      c.globalAlpha = alpha;
      /* Рука стоит ПРЯМО В цели: палец опускается из-под кружка в его
       * центр, куда и надо тапнуть. Раньше иконка рисовалась далеко под
       * кружком — и было непонятно, жать в круг или «куда показывает палец» */
      this.drawGhostFinger(c, d, x, y + r * 0.6, x, y - r * 0.04, ph);
      c.restore(); return true;
    }
    // approach circle: closes on the ring exactly when the ball arrives
    if ((cue.level === 'approach' || cue.level === 'freeze') && !cue.frozen && cue.t > 0) {
      const k = clamp((cue.t - 0.06) / 0.55, 0, 1);   // circles meet = moment to put the finger down
      c.strokeStyle = cue.subtle ? 'rgba(255,255,255,.45)' : 'rgba(255,230,153,.8)';
      c.lineWidth = (cue.subtle ? 1.5 : 2.5) * d;
      c.beginPath(); c.arc(x, y, r * (1 + 2.4 * k), 0, TAU); c.stroke();
    }
    const pulse = cue.frozen ? 1 + 0.07 * Math.sin(now * 7) : 1;
    /* heat: white = "it will be HERE", a butter-yellow ring + glowing dot =
     * "lift NOW". Blends over the last 350 ms instead of a 90 ms pop. */
    const heat = cue.frozen ? 0 : clamp(1 - (cue.t !== undefined ? cue.t : 1) / .35, 0, 1);
    c.shadowColor = cue.frozen ? '#FFD54A' : heat > .6 ? '#FFE699' : '#35C6F4';
    c.shadowBlur = (cue.subtle ? 6 : 16) * d * (0.7 + heat * .6);
    c.strokeStyle = heat > .75 ? '#FFE699' : heat > .4 ? '#F3EDD8' : 'rgba(255,255,255,.95)';
    c.lineWidth = ((cue.subtle ? 2 : 3) + heat * 1.6) * d;
    c.beginPath(); c.arc(x, y, r * pulse, 0, TAU); c.stroke();
    c.shadowBlur = 0;
    // the exact ideal contact spot — a dot players can aim the finger at
    const dotR = (3.2 + heat * 3.4) * d;
    c.beginPath(); c.arc(x, y, dotR, 0, TAU);
    c.fillStyle = heat > .8 ? 'rgba(140,255,158,.95)' : 'rgba(255,213,74,.95)';
    if (!cue.frozen) { c.shadowColor = '#FFE699'; c.shadowBlur = 8 * d; }
    c.fill(); c.shadowBlur = 0;
    c.lineWidth = 1.6 * d; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
    if (cue.frozen) {
      /* Одна история, три элемента, один путь:
       *   маленький пунктирный кружок = «палец ОТСЮДА»,
       *   пунктирная линия = путь жеста СКВОЗЬ кольцо (и жёлтую точку),
       *   рука = зацикленная анимация этого пути.
       * Большого овала-зоны больше нет — он читался как четвёртая,
       * непонятная отдельная область.
       * ВАЖНО: модель прицеливания (deriveStroke) читает ТОЧКУ СТАРТА жеста
       * так же, как его направление — поэтому стартовый кружок стоит на
       * СТОРОНЕ ЦЕЛИ, а не напротив неё: раньше при цели «влево» кружок был
       * справа от кольца и честно повторённый жест прицеливался ВПРАВО —
       * «не в ту зону». Горизонтальный сдвиг старта зажат в допуск гейта
       * (≤34 CSS px — внутри contactSide* минимумов для мыши и пальца);
       * вертикальные расстояния — в долях экрана, чтобы пропорции жеста не
       * зависели от радиуса кольца/матрицы dpr. */
      const ph = (now % 1.4) / 1.4, aimSgn = cue.aim || 0;
      const mSide = Math.min(W, H);
      const sx = x + clamp(aimSgn * W * 0.10, -34 * d, 34 * d);
      const sy = y + mSide * 0.12;                  // старт: ниже кольца, на стороне цели
      const ex = x + aimSgn * W * 0.22;             // финиш: выше кольца, дальше в сторону цели
      const ey = y - mSide * 0.10;
      // путь жеста
      c.save();
      c.setLineDash([3 * d, 5 * d]); c.lineWidth = 1.4 * d; c.lineCap = 'round';
      c.strokeStyle = 'rgba(255,255,255,.45)';
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
      // стартовый кружок «палец отсюда»
      c.setLineDash([4 * d, 4 * d]); c.lineWidth = 2 * d;
      c.strokeStyle = 'rgba(125,243,255,.95)'; c.shadowColor = 'rgba(46,230,255,.6)'; c.shadowBlur = 9 * d;
      c.beginPath(); c.arc(sx, sy, 10 * d, 0, TAU); c.stroke();
      c.setLineDash([]); c.shadowBlur = 0; c.restore();
      this.drawGhostFinger(c, d, sx, sy, ex, ey, ph);
    }
    c.restore();
    return true;
  }

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
    /* язык цвета единый: зелёный = «бей сейчас» (окно открыто). Сине-серый
     * вне-оконный цвет убран — он читался как ещё один «синий шлейф». */
    c.strokeStyle = cue.hot ? 'rgba(124,255,158,.95)' : 'rgba(255,255,255,.55)';
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

  /** Only the racket is visible over live play; dialogs retain their cursor. */
  syncNativeCursor() {
    const g = this.game, canvas = g && g.canvas;
    if (!canvas) return;
    const playing = [GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY, GS.POINT].includes(g.state);
    const dialog = typeof document !== 'undefined' && document.querySelector('.screen.on');
    const cursor = playing && !this.captureDebug && !g.paused && !(g.replayer && g.replayer.on) && !dialog ? 'none' : 'default';
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  drawCaptureDebug(c, W, H, d) {
    const g=this.game;
    if (!this.captureDebug || !g || g.paused || (g.replayer && g.replayer.on) ||
        ![GS.SERVE_READY,GS.SERVE_TOSS,GS.RALLY].includes(g.state)) return;
    const rect=g.canvas.getBoundingClientRect ? g.canvas.getBoundingClientRect() : {width:W/d,height:H/d};
    const saved=g.swipe && g.swipe.pressZone;
    const serving=[GS.SERVE_READY,GS.SERVE_TOSS].includes(g.state) && g.server===1;
    const locked=saved && (g.swipe.active || (typeof g.playerStrokeIntent==='function' && g.playerStrokeIntent(serving)));
    const cpz=!serving && MATCH_RULES.zoneAnchor==='contact' && typeof g.contactPrediction==='function' ? g.contactPrediction() : null;
    const zone=locked ? saved : cpz ? pressContactZone(g.project(cpz.p,{}),g.pointer,rect.width,rect.height,{pointerType:g.pointerFine===false?'touch':'mouse',scale:typeof g.contactGateScale==='function'?g.contactGateScale(cpz.p,rect):null}) : pressZoneForBall(g.ball,g.pointer,rect.width,rect.height,{
      project:(point,out)=>g.project(point,out||{}), pointerType:g.pointerFine===false?'touch':'mouse',
      referenceWorld:g.player&&g.player.pos,
      kind:serving&&g.state===GS.SERVE_TOSS?'serve':'rally',
      tossApex:g.tossApex,tossStartY:g.tossStartY,tableY:PH.TABLE_Y});
    if (!zone || ![zone.x,zone.y,zone.radius].every(Number.isFinite)) return;
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
    // Physical capture: the racket-sized sphere that actually decides contact.
    if (g.player && g.player.pos) {
      const pp=g.player.pos, c0=g.project(pp,{}), c1=g.project({x:pp.x+(serving?MATCH_RULES.serveCaptureRadius:MATCH_RULES.captureRadius),y:pp.y,z:pp.z},{});
      if (c0&&c0.ok&&c1&&c1.ok){ c.save(); c.setLineDash([5*d,4*d]); c.strokeStyle='rgba(125,243,255,.85)'; c.lineWidth=1.5*d;
        c.beginPath(); c.arc(c0.x*W,c0.y*H,Math.abs(c1.x-c0.x)*W,0,TAU); c.stroke(); c.restore(); }
    }
    if (cpz) { const q=g.project(cpz.p,{}); if (q&&q.ok){ c.fillStyle='#FFD54A'; c.beginPath(); c.arc(q.x*W,q.y*H,4*d,0,TAU); c.fill(); } }
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

    // bracket strike ring: only inside training — matches show the pinned mark
    if (!this.captureDebug && !this.drawCoach(c, W, H, d) && this.game && this.game.training) this.drawStrikeRing(c, W, H, d);
    this.drawCaptureDebug(c, W, H, d);
    this.syncNativeCursor();

    // Calibration shows evidence only, not a decorative swipe or glow.
    if (this.captureDebug) { this._lastRibbon = null; this.ripples.length = 0; }
    // live swipe ribbon — НЕЙТРАЛЬНЫЙ белый след пальца, без языка цветов.
    // Раньше он красился цветом предсказанного удара (вверх=оранжевый
    // топспин, вниз=синяя подрезка) — именно эта синяя/оранжевая линия за
    // пальцем и читалась как «не тот» шлейф. Вердикт показывают шлейф мяча
    // и вспышка контакта (зелёный/жёлтый/красный) — после удара, по делу.
    const sw = g.swipe;
    if (!this.captureDebug && sw.active && sw.samples.length > 1) {
      const pts = sw.samples;
      const n = pts.length;
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        c.strokeStyle = '#ffffff';
        c.globalAlpha = 0.07 + t * 0.5;
        c.lineWidth = (1.5 + t * 11) * d;
        c.beginPath();
        c.moveTo(pts[i - 1].x * W, pts[i - 1].y * H);
        c.lineTo(pts[i].x * W, pts[i].y * H);
        c.stroke();
      }
      c.globalAlpha = 1;
      const hx = pts[n - 1].x * W, hy = pts[n - 1].y * H;
      const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 34 * d);
      rg.addColorStop(0, 'rgba(255,255,255,.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 34 * d, 0, TAU); c.fill();

      this._lastRibbon = {
        pts: sw.samples.map((p) => ({ x: p.x, y: p.y })),
        col: '#ffffff',
        label: '',
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
    this.syncPauseControl();
    this.syncSlowmoControl();
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
        `<b>FPS</b> ${g.fps.toFixed(0)}  <b>DC</b> ${g.R.drawCalls}  <b>TRI</b> ${(g.R.tris / 1000).toFixed(1)}k\n` +
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
  slowmo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.6 2.6M9.5 2h5"/></svg>',
};
