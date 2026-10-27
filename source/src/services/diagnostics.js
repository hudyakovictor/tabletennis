/* Player-accessible local diagnostics for the embedded engine. Nothing here
   sends reports, screenshots, input coordinates or errors to a server. */
const HostDiagnostics = {
  events: [], errors: [], bookmark: null, reportText: '', reportUrl: null,
  record(type, detail = {}) {
    if (!GameHost.debug) return;
    const event = { type, wallMs: Date.now(), monotonicMs: performance.now(), ...detail };
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    // Forward the small host/iframe lifecycle trail into the same bounded
    // local journal, so it also survives an iframe or page reload.
    try {
      const g = this.game();
      if (g && g.debugRecording && typeof g.logInput === 'function') g.logInput('host_event', { outcome: event });
    } catch (e) {}
  },
  error(kind, message, stack) {
    const clean = v => String(v || '').replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, '$1').slice(0, 3000);
    const item = { kind, message: clean(message), stack: clean(stack), wallMs: Date.now() };
    this.errors.push(item); if (this.errors.length > 100) this.errors.shift();
    this.record('runtime_error', item);
  },
  game() { try { return GameHost.frame && GameHost.frame.contentWindow.__game; } catch (e) { return null; } },
  context() {
    return { build: typeof SHELL_BUILD !== 'undefined' ? SHELL_BUILD : null,
      userAgent: navigator.userAgent, language: navigator.language, viewport: [innerWidth, innerHeight],
      devicePixelRatio, visibility: document.visibilityState, focused: document.hasFocus(),
      telegramWebApp: !!(window.Telegram && window.Telegram.WebApp),
      engineReady: !!GameHost.ready, hostPaused: !!GameHost.paused,
      errors: this.errors.slice(), events: this.events.slice(), maxEvents: 500 };
  },
  markFrame() {
    const g = this.game();
    if (!g || typeof g.captureDiagnosticFrame !== 'function') throw new Error(t('debug.engineUnavailable'));
    this.bookmark = g.captureDiagnosticFrame(true);
    if (g.debugRecording) g.logInput('bookmark', { outcome: { capturedAt: this.bookmark.capturedAt } });
    this.record('bookmark', { capturedAt: this.bookmark.capturedAt });
    return this.bookmark;
  }
};
window.addEventListener('error', e => HostDiagnostics.error('error', e.message, e.error && e.error.stack));
window.addEventListener('unhandledrejection', e => HostDiagnostics.error('unhandledrejection', e.reason && e.reason.message || e.reason, e.reason && e.reason.stack));
for (const name of ['blur', 'focus', 'pagehide', 'pageshow']) window.addEventListener(name, () => HostDiagnostics.record(name));
document.addEventListener('visibilitychange', () => HostDiagnostics.record('visibility', { state: document.visibilityState }));
for (const name of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(name, e => {
  if (!GameHost.debug) return;
  const target = e.target && e.target.closest && e.target.closest('[data-act],[data-a],[data-d]');
  HostDiagnostics.record('host_pointer', { event: name, pointerType: e.pointerType, pointerId: e.pointerId,
    x: e.clientX, y: e.clientY, buttons: e.buttons, trusted: !!e.isTrusted,
    control: target ? (target.dataset.act || target.dataset.a || target.dataset.d || null) : null });
}, true);

function diagnosticMarkFrame() {
  try { HostDiagnostics.markFrame(); toast(t('debug.marked')); }
  catch (e) { HostDiagnostics.error('screenshot', e && e.message || e, e && e.stack); toast(t('debug.shotFailed')); }
}

function diagnosticsSheet({ focusScreenshot = false } = {}) {
  const g = HostDiagnostics.game();
  // A stopped session can still have a locally archived report and frame.
  // Open it for recovery without silently re-enabling recording.
  const recovery = g && typeof g.diagnosticRecoveryArchive === 'function' ? g.diagnosticRecoveryArchive() : null;
  const on = GameHost.debug;
  const status = () => {
    const game = HostDiagnostics.game(), log = game && game.inputLog && game.inputLog.stats(game.time);
    const archive = game && game.debugArchive;
    const storage = archive ? archive.status : 'not_enabled';
    return (GameHost.debug ? t('debug.recordingOn') : t('debug.recordingOff')) +
      (log ? ` · ${t('debug.retained', { n: Math.round(log.retainedWallSeconds), count: log.inWindow })}` : '') +
      ' · ' + (storage === 'available' ? t('debug.storageAvailable') : storage === 'opening' ? t('debug.storageOpening') : t('debug.storageUnavailable')) +
      (HostDiagnostics.bookmark ? ' · ' + (archive && archive.frameStatus === 'saved' ? t('debug.frameSaved') :
        archive && archive.frameStatus === 'pending' ? t('debug.framePending') : t('debug.frameMemory')) : '');
  };
  const previewHtml = `<div class="diag-preview" data-d-preview hidden>
      <a class="b3 green block" data-d="download-shot" download="topspin-frame.png">${t('debug.downloadShot')}</a>
      <button class="b3 dark block sm" data-d="share-shot" hidden>${t('debug.shareShot')}</button>
      <img data-d-image alt="${t('debug.imageAlt')}">
      <p class="dim diag-copy" data-d-frame-time></p>
      <p class="dim diag-copy">${t('debug.previewHint')}</p>
    </div>`;
  const shotButton = `<button class="b3 dark block" data-d="shot">${t('debug.captureNow')}</button>`;
  const doneButton = `<button class="b3 dark block" data-d="done">${t('common.resume')}</button>`;
  const html = focusScreenshot ? `<div class="h1" style="margin:4px 4px 8px">${t('debug.screenshot')}</div>
    <div class="diag-status" data-d-status role="status" hidden></div>
    <div class="diag-actions">${previewHtml}${shotButton}
      <button class="b3 dark block" data-d="open-diagnostics">${t('debug.title')}</button>${doneButton}</div>` :
    `<div class="h1" style="margin:4px 4px 8px">${t('debug.title')}</div>
    <p class="dim diag-copy">${t('debug.instructions')}</p>
    <div class="diag-status" data-d-status role="status"></div>
    <p class="dim diag-copy">${t('debug.privacy')}</p>
    <div class="diag-actions">
      <button class="b3 ${on ? 'dark' : 'green'} block" data-d="toggle" aria-pressed="${on}">${on ? t('debug.stop') : t('debug.start')}</button>
      <button class="b3 dark block" data-d="report">${t('debug.prepareReport')}</button>
      <div class="diag-report" data-d-report hidden>
        <a class="b3 green block" data-d="download-report" download="topspin-diagnostics.json">${t('debug.downloadReport')}</a>
        <button class="b3 dark block sm" data-d="copy">${t('debug.copyReport')}</button>
        <button class="b3 dark block sm" data-d="show-text">${t('debug.showText')}</button>
        <textarea class="diag-text" data-d-text readonly hidden aria-label="${t('debug.reportText')}"></textarea>
      </div>
      ${shotButton}${previewHtml}${doneButton}
    </div>`;
  Sheet.open(html, { onOpen: w => {
    const statusEl = w.querySelector('[data-d-status]');
    const preview = w.querySelector('[data-d-preview]');
    // A marked frame is deliberate evidence. Otherwise the screenshot view
    // should capture the current pause, not reuse an old automatic preview.
    let frame = HostDiagnostics.bookmark || (!focusScreenshot && g && g._diagnosticFrame) || null;
    const refresh = () => { statusEl.textContent = status(); };
    const revealFrame = () => {
      if (!w.isConnected || Sheet.cur !== w || preview.hidden) return;
      const body = w.querySelector('.sbody');
      if (!body) return;
      // Scroll only the sheet, not the page underneath. On a phone the
      // download used to appear below the visible area with no indication.
      const top = body.scrollTop + preview.getBoundingClientRect().top - body.getBoundingClientRect().top;
      body.scrollTop = top;
    };
    const showFrame = (f, reveal = false) => {
      if (!f || !f.dataUrl) return;
      frame = f; preview.hidden = false;
      w.querySelector('[data-d-frame-time]').textContent = f.capturedAt ? `${t('debug.capturedAt')}: ${new Date(f.capturedAt).toLocaleString()}` : '';
      const image = w.querySelector('[data-d-image]'); image.src = f.dataUrl;
      w.querySelector('[data-d=download-shot]').href = f.dataUrl;
      const share = w.querySelector('[data-d=share-shot]');
      share.hidden = !(navigator.share && typeof File !== 'undefined');
      if (reveal) {
        requestAnimationFrame(revealFrame);
        if (typeof image.decode === 'function') image.decode().then(() => requestAnimationFrame(revealFrame)).catch(() => {});
      }
    };
    const restoreFrame = () => {
      const engine = HostDiagnostics.game();
      if (HostDiagnostics.bookmark || !engine || !engine.debugArchive) return;
      engine.debugArchive.readFrame().then(saved => {
        if (saved && !HostDiagnostics.bookmark && w.isConnected) { HostDiagnostics.bookmark = saved; showFrame(saved); refresh(); }
      }).catch(() => {});
    };
    showFrame(frame); restoreFrame(); refresh();
    if (focusScreenshot && !frame) {
      try {
        const engine = HostDiagnostics.game();
        if (!engine) throw new Error(t('debug.engineUnavailable'));
        // This is just a current preview. Do not overwrite an explicitly
        // bookmarked frame while asynchronous recovery is still in progress.
        showFrame(engine.captureDiagnosticFrame(false));
      } catch (err) {
        HostDiagnostics.error('screenshot', err && err.message || err, err && err.stack);
        statusEl.hidden = false;
        statusEl.textContent = t('debug.shotFailed') + ': ' + String(err && err.message || err);
      }
    }
    if (recovery && recovery.status === 'opening') recovery.ready.then(() => { if (w.isConnected) refresh(); });
    w.addEventListener('click', async e => {
      const el = e.target.closest('[data-d]'); if (!el) return;
      const act = el.dataset.d;
      if (act === 'toggle') {
        const enabled = GameHost.setDebug(!GameHost.debug);
        el.classList.toggle('green', !enabled); el.classList.toggle('dark', enabled);
        el.setAttribute('aria-pressed', String(enabled));
        el.textContent = enabled ? t('debug.stop') : t('debug.start');
        refresh(); setTimeout(refresh, 250);
      } else if (act === 'report') {
        const engine = HostDiagnostics.game();
        if (!engine || typeof engine.diagnosticReport !== 'function') { statusEl.textContent = t('debug.engineUnavailable'); return; }
        el.disabled = true; statusEl.textContent = t('debug.preparing');
        try {
          const report = await engine.diagnosticReport();
          report.host = HostDiagnostics.context();
          if (HostDiagnostics.bookmark) {
            const { dataUrl, ...frameInfo } = HostDiagnostics.bookmark; report.host.bookmarkedFrame = frameInfo;
          }
          // Detailed recordings can be large on phones. Compact JSON keeps all
          // values while avoiding the extra memory and storage of indentation.
          HostDiagnostics.reportText = JSON.stringify(report);
          if (HostDiagnostics.reportUrl) URL.revokeObjectURL(HostDiagnostics.reportUrl);
          HostDiagnostics.reportUrl = URL.createObjectURL(new Blob([HostDiagnostics.reportText], { type: 'application/json' }));
          w.querySelector('[data-d=download-report]').href = HostDiagnostics.reportUrl;
          w.querySelector('[data-d-report]').hidden = false;
          restoreFrame(); refresh();
        } catch (err) {
          HostDiagnostics.error('export', err && err.message || err, err && err.stack);
          statusEl.textContent = t('debug.reportFailed') + ': ' + String(err && err.message || err);
        } finally { el.disabled = false; }
      } else if (act === 'copy') {
        const ok = await copyText(HostDiagnostics.reportText);
        statusEl.textContent = ok ? t('debug.copied') : t('debug.copyFailed');
        if (!ok) { const area = w.querySelector('[data-d-text]'); area.hidden = false; area.value = HostDiagnostics.reportText; }
      } else if (act === 'show-text') {
        const area = w.querySelector('[data-d-text]'); area.hidden = false; area.value = HostDiagnostics.reportText; area.focus(); area.select();
      } else if (act === 'shot') {
        try {
          const engine = HostDiagnostics.game();
          if (!engine) throw new Error(t('debug.engineUnavailable'));
          const f = engine.captureDiagnosticFrame(true); HostDiagnostics.bookmark = f; showFrame(f, !focusScreenshot);
          if (focusScreenshot) statusEl.hidden = true;
          refresh(); setTimeout(refresh, 500);
        } catch (err) {
          HostDiagnostics.error('screenshot', err && err.message || err, err && err.stack);
          statusEl.hidden = false;
          statusEl.textContent = t('debug.shotFailed') + ': ' + String(err && err.message || err);
        }
      } else if (act === 'share-shot') {
        try {
          const bytes = atob(frame.dataUrl.split(',')[1]), array = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) array[i] = bytes.charCodeAt(i);
          const file = new File([array], 'topspin-frame.png', { type: 'image/png' });
          if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error(t('debug.shareUnavailable'));
          await navigator.share({ files: [file], title: 'TOPSPIN' });
        } catch (err) { statusEl.textContent = t('debug.shareUnavailable'); }
      } else if (act === 'open-diagnostics') diagnosticsSheet();
      else if (act === 'done') Sheet.close();
    });
  }});
}
