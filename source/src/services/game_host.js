/* =====================================================================
   GAME HOST — настоящий движок (TOPSPIN ARENA, WebGL) живёт в одном
   постоянном iframe под экранами. Прогревается на поиске соперника,
   крутит «облёт» за меню и общается через postMessage.
   ===================================================================== */
const DEVMODE = /[?&]dev=1/.test(location.search);
const GameHost = {
  frame: null, ready: false, q: [], subs: new Set(), rules: null,
  strokeCatalog: [], matchSnapshot: null, matchResume: null, hudRequestId: 0,
  calibrationRegistry: [], calibration: null, calibrationReady: false, calibrationRequestId: 0, calibrationAckId: 0,
  _calibrationImported: false,
  inspector: null, sessionKind: 'free',
  trainingCatalog: null, trainSnapshot: null, trainRequestId: 0, trainSessionId: null,
  preview: null, previewRequestId: 0, _previewReturn: null,
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
  /* Адрес WS-релея для движка. Внутри srcdoc-iframe своя «пустая» страница:
   * location.search пуст, origin равен "null", поэтому адрес передаётся
   * инжектом. Берём ?net= оболочки, иначе тот же домен, где лежит игра
   * (/api/relay) — так работает ссылка вида https://хост/ без параметров. */
  relayUrl() {
    const q = new URLSearchParams(location.search).get('net');
    if (q) return q;
    return /^https?:$/.test(location.protocol) ? location.origin.replace(/^http/, 'ws') + '/api/relay' : '';
  },
  doc() {
    const pre = '<script>window.__TT_EMBED=1;document.documentElement.classList.add("tt-embed");window.__TT_LOCALE=' + JSON.stringify(I18n.lang) +
      ';window.__TT_PERF=' + (/[?&]perf\b/.test(location.search) ? '1' : '0') +
      ';window.__TT_NET=' + JSON.stringify(this.relayUrl()) +
      ';window.__TT_RULES=' +
      JSON.stringify(this.devRules()).replace(/</g, '\\u003c') + ';<\/script>';
    return GAME_HTML.replace('<head>', '<head>' + pre);
  },
  ensure() {
    if (this.frame) return;
    const f = document.createElement('iframe');
    f.title = t('hub.gameName'); f.setAttribute('allow', 'autoplay; fullscreen');
    f.srcdoc = this.doc();
    $('#gamelayer').appendChild(f); this.frame = f; this.ready = false;
    // слой ещё не показан (заставка, меню) — движок стартует спящим и не рендерит впустую
    if (!$('#gamelayer').classList.contains('on')) { this._asleep = true; this.send('sleep'); }
  },
  captureMatchResume() {
    try {
      const resume = this.frame?.contentWindow?.__game?.captureMatchResume?.();
      if (resume) this.matchResume = structuredClone(resume);
    } catch (e) { /* The last checkpoint remains usable if the frame is gone. */ }
    return this.matchResume;
  },
  reload({ restoreMatch = true } = {}) {
    const mode = this.mode, paused = this.paused;
    const resume = restoreMatch && mode?.type === 'match' ? this.captureMatchResume() : null;
    if (this.frame) this.frame.remove(); this.frame = null; this.ready = false; this.q = [];
    this.calibrationReady = false; this.calibration = null; this.calibrationRegistry = []; this.inspector = null;
    this.notify({ type: 'calibrationPending' }); this.ensure();
    if (resume) {
      this.send('match', { ...mode.data, resume });
      if (paused) this.send('pause');
    }
  },
  syncSettings() {
    document.body.classList.toggle('rm', effectiveReducedMotion());
    if (typeof Sfx !== 'undefined') Sfx.sync();
    this.send('settings', { quality: this._recoveryQuality || S.quality, motionOff: !!S.rm,
      sound: S.sfx !== false, haptics: S.vibro !== false, hint: S.hint !== false, debug: this.debug,
      showPaddle: S.showPaddle === true,
      audioLevels: repairAudioLevels(S.audioLevels, S.volume), calibrations: Object.fromEntries(Object.entries(repairCalibrationPreferences(S.cal)).filter(([key]) =>
        ['camHeight', 'camZoom', 'camSway', 'fingerTrail', 'ballSize', 'trailLen', 'tableGlow', 'hintRadius', 'hintGlow', 'slowmoDepth'].includes(key))),
      missShots: { on: S.missShots === true, half: S.missShotHalf } });
  },
  syncReducedMotion() {
    const effective = effectiveReducedMotion(); document.body.classList.toggle('rm', effective);
    this.send('rm', { on: !!S.rm }); this.notify({ type: 'motionPreference', effective });
  },
  acceptCalibration(m) {
    const state = m.calibration;
    if (!this.ready || !state || !this.calibrationRegistry.length || Number.isFinite(m.requestId) && m.requestId !== this.calibrationRequestId) return false;
    if (!this.calibrationRegistry.every(entry => state.requested && state.effective && state.raw && state.values &&
      Number.isFinite(state.requested[entry.key]) && state.requested[entry.key] >= 0 && state.requested[entry.key] <= 1 &&
      Number.isFinite(state.effective[entry.key]) && state.effective[entry.key] >= 0 && state.effective[entry.key] <= 1 &&
      Number.isFinite(state.raw[entry.key]) && Number.isFinite(state.values.requested && state.values.requested[entry.key]) &&
      Number.isFinite(state.values.effective && state.values.effective[entry.key]))) return false;
    this.calibration = state; this.sessionKind = state.sessionKind;
    if (Number.isFinite(m.requestId)) { this.calibrationReady = true; this.calibrationAckId = m.requestId; }
    if (state.inspector) this.inspector = { ...state.inspector };
    return true;
  },
  notify(m) { this.subs.forEach(fn => { try { fn(m); } catch (err) { console.error(err); } }); },
  acceptMatchSnapshot(snapshot, requestId) {
    if (this.mode?.type !== 'match' || requestId !== this.hudRequestId || !snapshot || snapshot.schema !== 1 ||
        typeof snapshot.matchId !== 'string' || !snapshot.matchId || snapshot.matchId.length > 120 ||
        !Number.isSafeInteger(snapshot.seq) || snapshot.seq < 0 || !Number.isSafeInteger(snapshot.rallyId) || snapshot.rallyId < 0 ||
        !Array.isArray(snapshot.score) || snapshot.score.length !== 2 || !snapshot.score.every(n => Number.isSafeInteger(n) && n >= 0) ||
        !Number.isFinite(snapshot.target) || snapshot.target < 1 || ![1, -1].includes(snapshot.server) ||
        !Array.isArray(snapshot.players) || snapshot.players.length !== 2 ||
        !Array.isArray(snapshot.contacts) || snapshot.contacts.length !== 2) return false;
    const previous = this.matchSnapshot;
    if (previous && (previous.matchId !== snapshot.matchId || snapshot.seq <= previous.seq)) return false;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1, player = snapshot.players[i], contact = snapshot.contacts[i];
      if (!player || player.side !== side || ![player.energy, player.capacity, player.fatigue].every(Number.isFinite) ||
          player.fatigue < 0 || player.fatigue > 45 || Math.abs(player.capacity - (100 - player.fatigue)) > .001 ||
          player.energy < 0 || player.energy > player.capacity) return false;
      if (contact && (contact.side !== side || contact.matchId !== snapshot.matchId || contact.rallyId !== snapshot.rallyId ||
          !Number.isSafeInteger(contact.eventId) || contact.eventId < 1 || typeof contact.stroke !== 'string' ||
          !Number.isFinite(contact.kmh) || contact.kmh < 0 || !Number.isFinite(contact.rps) || contact.rps < 0)) return false;
    }
    this.matchSnapshot = structuredClone(snapshot);
    return true;
  },
  // то, что надо повторить новому iframe после потери GPU-контекста
  mode: null, sticky: {}, paused: false, losses: [],
  send(type, data) {
    const m = Object.assign({ __tt: 1, type }, data || {});
    if (['attract', 'lobby', 'match', 'train', 'quit'].includes(type) && this.preview && (this.preview.active || this.preview.pending)) {
      this._previewReturn = null;
      this.send('previewClose', { requestId: this.previewRequestId }); this.preview = null;
    }
    if (type === 'previewOpen') {
      m.requestId = ++this.previewRequestId;
      this.preview = { active: false, pending: true, requestId: m.requestId };
    }
    if (type === 'settings' || type === 'cal') m.requestId = ++this.calibrationRequestId;
    if (type === 'quality') this._recoveryQuality = null;
    if (['attract', 'lobby', 'match', 'train'].includes(type)) {
      if (this.ready) this.syncSettings();
      if (type === 'match') {
        m.hudRequestId = ++this.hudRequestId;
        if (!m.resume) { this.matchSnapshot = null; this.matchResume = null; }
        const selected = typeof MODE !== 'undefined' && MODE && MODE.id;
        m.sessionKind = ['free', 'practice', 'ranked', 'career', 'check', 'online'].includes(m.sessionKind)
          ? m.sessionKind : m.free ? 'free' : ['free', 'practice', 'ranked'].includes(selected) ? selected : 'practice';
      } else m.sessionKind = type === 'train' ? m.sessionKind === 'check' || m.resume && m.resume.stage === 'check' ? 'check' : 'practice' : 'free';
      delete m.hint; // Preferences have one source, never a stale copy captured in mode.data.
      this.sessionKind = m.sessionKind;
      if (!m.resume) this.inspector = null;
    }
    if (type === 'train') {
      m.requestId = ++this.trainRequestId; m.progress = repairTrainingState(S.training);
      this.trainSessionId = null; this.trainSnapshot = null;
    }
    if (['attract', 'lobby', 'match', 'train'].includes(type)) { this.mode = { type, data: { ...m } }; this.paused = false; }
    if (['quiet', 'mute', 'hint', 'quality', 'rm', 'debug'].includes(type)) this.sticky[type] = data || {};
    if (type === 'pause') this.paused = true; if (type === 'resume' || type === 'quit') this.paused = false;
    if (type === 'quit') { this.mode = { type: 'attract', data: {} }; this.sessionKind = 'free'; this.inspector = null; this.matchSnapshot = null; this.matchResume = null; }
    if (this.debug && typeof HostDiagnostics !== 'undefined' &&
        ['debug', 'pause', 'resume', 'slowmo', 'sleep', 'wake', 'match', 'train', 'quit'].includes(type))
      HostDiagnostics.record('host_command', { command: type, on: data && typeof data.on === 'boolean' ? data.on : null, ready: this.ready });
    if (this.ready && this.frame) this.frame.contentWindow.postMessage(m, '*'); else this.q.push(m);
  },
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  openPreview(options) {
    if (this.preview && (this.preview.active || this.preview.pending)) return false;
    this.ensure();
    this._previewReturn = { shown: $('#gamelayer').classList.contains('on') };
    this.send('pause'); this.show(true); this.send('previewOpen', options);
    return true;
  },
  closePreview() {
    if (this.preview && (this.preview.active || this.preview.pending)) this.send('previewClose', { requestId: this.previewRequestId });
  },
  recover(m) {
    if (this.preview && (this.preview.active || this.preview.pending)) {
      this.preview = null; this._previewReturn = null;
      this.notify({ type: 'preview', active: false, error: 'context_lost' });
    }
    const now = Date.now(); this.losses = this.losses.filter((t) => now - t < 60000); this.losses.push(now);
    const ov = $('#glRecover'); ov && ov.classList.add('on');
    const mode = this.mode, quiet = this.sticky.quiet, paused = this.paused;
    const inspect = this.inspector && this.inspector.requested;
    if (this.losses.length >= 3) this._recoveryQuality = 'low';   // temporary GPU relief, not a saved preference
    const resume = m.resume || this.captureMatchResume() || { score: m.score, server: m.server };
    this.matchResume = resume;
    this.reload({ restoreMatch: false });
    if (quiet) this.send('quiet', quiet);
    if (mode) {
      if (mode.type === 'match' && m.inMatch) this.send('match', Object.assign({}, mode.data, { resume }));
      else if (mode.type === 'train') {
        const snapshot = this._trainRecovery;
        this.send('train', { ...mode.data, lessonId: snapshot && snapshot.id || mode.data.lessonId,
          resume: snapshot ? { stage: snapshot.stage, practicePassed: snapshot.practicePassed, quizPassed: snapshot.quizPassed } : null });
      }
      else if (mode.type !== 'match') this.send(mode.type, mode.data);
      else this.send('attract');
    }
    if (inspect && mode && (mode.type === 'train' || mode.type === 'match' && m.inMatch)) this.send('slowmo', { on: true });
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
  let m = e.data; if (!m || m.__tt !== 1 || !GameHost.frame || e.source !== GameHost.frame.contentWindow) return;
  if (GameHost.debug && typeof HostDiagnostics !== 'undefined' && ['glLost', 'ready', 'paused', 'matchEnd'].includes(m.type))
    HostDiagnostics.record('engine_message', { messageType: m.type, paused: m.type === 'paused' ? !!m.v : null });
  if (m.type === 'glLost') {
    GameHost._trainRecovery = GameHost.trainSnapshot;
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
    const strokeIds = new Set();
    GameHost.strokeCatalog = Array.isArray(m.strokeCatalog) ? m.strokeCatalog.slice(0, 100).filter(stroke => {
      if (!stroke || !/^[A-Z][A-Z0-9_]{0,31}$/.test(stroke.id) || !/^#[\da-f]{6}$/i.test(stroke.col) || strokeIds.has(stroke.id)) return false;
      strokeIds.add(stroke.id); return true;
    }).map(({ id, col }) => ({ id, col })) : [];
    const seen = new Set();
    GameHost.calibrationRegistry = Array.isArray(m.calibrationRegistry) ? m.calibrationRegistry.slice(0, 100).filter(entry => {
      if (!entry || !/^[a-zA-Z][a-zA-Z0-9]{0,47}$/.test(entry.key) || ['constructor', 'prototype'].includes(entry.key) || seen.has(entry.key) ||
          !Number.isFinite(entry.min) || !Number.isFinite(entry.max) || entry.max <= entry.min ||
          !Number.isFinite(entry.default) || entry.default < entry.min || entry.default > entry.max) return false;
      seen.add(entry.key); return true;
    }).map(entry => ({ key: entry.key, default: entry.default, min: entry.min, max: entry.max,
      step: entry.step === 'any' || Number.isFinite(entry.step) && entry.step > 0 ? entry.step : 'any',
      group: entry.group, scope: entry.scope, unit: entry.unit, precision: entry.precision,
      competitiveLocked: entry.competitiveLocked === true, requiresMotion: entry.requiresMotion === true,
      labelRu: String(entry.labelRu || entry.key), labelEn: String(entry.labelEn || entry.key),
      descriptionRu: String(entry.descriptionRu || ''), descriptionEn: String(entry.descriptionEn || '') })) : [];
    if (!GameHost._calibrationImported && GameHost.calibrationRegistry.length) {
      GameHost._calibrationImported = true;
      const saved = repairCalibrationPreferences(m.calibrationPreferences);
      S.cal = repairCalibrationPreferences(S.cal); let imported = false;
      for (const entry of GameHost.calibrationRegistry) {
        if (!Object.prototype.hasOwnProperty.call(S.cal, entry.key) && Object.prototype.hasOwnProperty.call(saved, entry.key)) {
          S.cal[entry.key] = saved[entry.key]; imported = true;
        }
      }
      if (imported) saveNow();
    }
    GameHost.calibrationReady = false; GameHost.calibration = null;
    if (m.trainingCatalog && m.trainingCatalog.version === 1) GameHost.trainingCatalog = m.trainingCatalog;
    if (GameHost._recovering) { GameHost._recovering = false; setTimeout(() => { const ov = $('#glRecover'); ov && ov.classList.remove('on'); }, 350); }
    // Apply a fresh complete settings packet before any queued/recovered mode.
    GameHost.syncSettings();
    if (S.equipped) GameHost.send('equip', { equipped: S.equipped });
    GameHost.send('locale', { lang: I18n.lang });
    const q = GameHost.q; GameHost.q = [];
    const settingsCommands = ['settings', 'quality', 'rm', 'mute', 'haptics', 'hint', 'cal', 'missShots', 'debug', 'equip', 'locale'];
    const modeCommands = ['attract', 'lobby', 'match', 'train', 'quit'];
    let lastMode = -1; q.forEach((x, i) => { if (modeCommands.includes(x.type)) lastMode = i; });
    q.forEach((x, i) => {
      if (settingsCommands.includes(x.type) || modeCommands.includes(x.type) && i !== lastMode) return;
      if (x.type === 'match' || x.type === 'train') delete x.hint;
      GameHost.frame.contentWindow.postMessage(x, '*');
    });
  }
  if (['settings', 'calibration', 'slowmo'].includes(m.type)) GameHost.acceptCalibration(m);
  if (m.type === 'hud') {
    if (!GameHost.acceptMatchSnapshot(m.snapshot, m.hudRequestId)) return;
    m = { ...m, snapshot: GameHost.matchSnapshot };
  }
  if (m.type === 'paused') GameHost.paused = !!m.v;
  if (m.type === 'preview') {
    if (m.requestId !== GameHost.previewRequestId) return;
    GameHost.preview = { ...m, pending: false }; GameHost.paused = !!m.paused;
    if (!m.active && GameHost._previewReturn) {
      const back = GameHost._previewReturn; GameHost._previewReturn = null;
      if (!back.shown) GameHost.show(false);
    }
  }
  if (m.type === 'trainingCatalog' && m.catalog && m.catalog.version === 1) GameHost.trainingCatalog = m.catalog;
  if (['train', 'trainingProgress', 'trainDone'].includes(m.type)) {
    if (m.requestId !== GameHost.trainRequestId || !GameHost.mode || GameHost.mode.type !== 'train') return;
    if (m.type === 'train') {
      if (GameHost.trainSessionId && GameHost.trainSessionId !== m.sessionId) return;
      GameHost.trainSessionId = m.sessionId; GameHost.trainSnapshot = m;
      if (m.mode === 'course' && S.training.lastLesson !== m.id && GameHost.trainingCatalog &&
          GameHost.trainingCatalog.lessons.some(s => s.id === m.id)) { S.training.lastLesson = m.id; save(); }
    } else if (m.sessionId !== GameHost.trainSessionId) return;
    if (m.type === 'trainingProgress' && applyTrainingProgress(S, m, GameHost.trainingCatalog)) saveNow();
    if (m.type === 'trainDone') {
      const result = trainingMastery(S, GameHost.trainingCatalog);
      const rewarded = m.mode === 'course' && m.courseComplete === true && result.courseComplete && awardTrainingCompletion(S, GameHost.trainingCatalog);
      m = { ...m, ...result, courseComplete: m.mode === 'course' && result.courseComplete, rewarded: !!rewarded };
      if (rewarded || result.courseComplete) saveNow();
    }
  }
  if (m.type === 'cameraCalibration' && m.values && typeof m.values === 'object') {
    S.cal = repairCalibrationPreferences(S.cal);
    for (const key of ['camHeight', 'camZoom']) {
      if (Number.isFinite(m.values[key])) S.cal[key] = clamp(m.values[key], 0, 100);
    }
    if (GameHost.calibrationAckId === GameHost.calibrationRequestId) GameHost.acceptCalibration(m);
    save();
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
  GameHost.notify(m);
});

if (motionPreferenceQuery) {
  const sync = () => GameHost.syncReducedMotion();
  if (motionPreferenceQuery.addEventListener) motionPreferenceQuery.addEventListener('change', sync);
  else if (motionPreferenceQuery.addListener) motionPreferenceQuery.addListener(sync);
}

/* ---------- статистика зоны удара: реальные попытки с реальных пальцев ---------- */
const ZoneStats = {
  KEY: 'ttu-zone-stats', MAX: 300, mem: null,
  all() {
    if (this.mem !== null) return this.mem;
    try { const rows = JSON.parse(localStorage.getItem(this.KEY) || 'null'); this.mem = Array.isArray(rows) ? rows.slice(-this.MAX) : []; }
    catch (e) { this.mem = []; }
    return this.mem;
  },
  add(a) {
    const ext = Array.isArray(a.ext) && a.ext.length === 3 && a.ext.every(v => Number.isFinite(v) && v >= 0) &&
      a.ext[0] > 0 && a.ext[2] > 0 ? a.ext.slice() : null;
    const x = { t: Date.now(), kind: a.kind, input: a.input, accepted: a.accepted, zoneReason: a.zoneReason, dx: a.dx, dy: a.dy,
      lead: a.lead, contact: a.contact, reason: a.reason, sweet: a.sweet, training: a.training, rules: a.rules, sig: a.sig || null,
      ext, kx: Number.isFinite(a.kx) && a.kx > 0 ? a.kx : null,
      gestureId: Number.isFinite(a.gestureId) ? a.gestureId : null, shotId: Number.isFinite(a.shotId) ? a.shotId : null,
      acceptedAtPress: typeof a.acceptedAtPress === 'boolean' ? a.acceptedAtPress : null,
      zoneReasonAtPress: typeof a.zoneReasonAtPress === 'string' ? a.zoneReasonAtPress.slice(0, 300) : null };
    const L = this.all(); L.push(x); while (L.length > this.MAX) L.shift();
    this.mem = L; try { localStorage.setItem(this.KEY, JSON.stringify(L)); } catch (e) {}
  },
  LOG: 'ttu-match-log', memLog: null,
  matches() {
    if (this.memLog !== null) return this.memLog;
    try { const rows = JSON.parse(localStorage.getItem(this.LOG) || 'null'); this.memLog = Array.isArray(rows) ? rows.slice(-30) : []; }
    catch (e) { this.memLog = []; }
    return this.memLog;
  },
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
    const capture = GameHost.calibration && GameHost.calibration.capture;
    const radius = capture && Number.isFinite(capture.radius) ? capture.radius : R.captureRadius;
    return [input === 'mouse' ? R.contactSideMousePx : R.contactSideTouchPx, R.contactBackPx, R.contactForwardPx, radius].map((v) => +(+v).toFixed(2)).join('/');
  },
  sigLabel(sig) { if (!sig) return t('zone.sigMissing'); const [s, b, f, r] = sig.split('/'); return t('zone.sig', { s, b, f, r }); },
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
    if (n < 15) recs.push(['info', t('zone.needData', { n })]);
    else {
      if (out / n > 0.25) {
        const over = L.filter((a) => !a.accepted && Number.isFinite(a.dx)).map((a) => Math.max(0, Math.abs((this.norm(a, R) || a).dx) - side)).sort((a, b) => a - b);
        const med = over.length ? over[over.length >> 1] : 0;
        recs.push(['warn', t('zone.outAdvice', { pct: Math.round(out / n * 100), med, add: Math.min(30, Math.max(6, Math.round(med / 2) * 2)) })]);
      }
      if (late / n > 0.2) recs.push(['warn', t('zone.racketAdvice', { pct: Math.round(late / n * 100) })]);
      if (early / n > 0.15) recs.push(['warn', t('zone.earlyAdvice', { pct: Math.round(early / n * 100) })]);
      const edge = L.filter((a) => a.accepted && Number.isFinite(a.dx) && Math.abs((this.norm(a, R) || a).dx) > side * 0.7);
      const edgeHit = edge.filter((a) => a.contact).length;
      if (edge.length >= 5 && edgeHit / edge.length < 0.35) recs.push(['info', t('zone.emptyEdges', { distance: Math.round(side * 0.7), pct: Math.round(edgeHit / edge.length * 100), side: Math.round(side * 0.8) })]);
      if (hit / n > 0.85 && n >= 30) recs.push(['ok', t('zone.tooEasy', { pct: Math.round(hit / n * 100) })]);
      if (!recs.length) recs.push(['ok', t('zone.balanced', { hit: Math.round(hit / n * 100), out: Math.round(out / n * 100) })]);
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
  const cmpHtml = cmp.length > 1 ? `<div class="pnl zs-plot zs-cmp"><div class="cap" style="margin:2px 2px 8px">${t('zone.compareTitle')}</div>
      ${cmp.map((c) => `<div class="zc-row ${c.sig === sigNow ? 'now' : ''} ${best && c.sig === best.sig ? 'best' : ''}"><span>${ZoneStats.sigLabel(c.sig)}</span><b class="num">${c.hit}%</b><small class="num">${t('zone.compareOut', { pct: c.out, n: c.n })}</small></div>`).join('')}
      <p class="dim" style="margin:6px 2px 0;font-size:10.5px">${t('zone.compareLegend')}</p></div>` : '';
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
  Sheet.open(`<div class="h1" style="margin:4px 4px 4px">${t('zone.sheetTitle')}</div>
    <p class="dim" style="margin:0 4px 8px;font-size:11.5px">${t('zone.summary', { n: r.n, input: t(input === 'mouse' ? 'common.mouse' : 'common.touch'), sig: ZoneStats.sigLabel(sigNow) })}</p>
    <div class="zs-scope"><button class="${scope === 'cur' ? 'on' : ''}" data-a="cur">${t('zone.current', { n: nNow })}</button><button class="${scope === 'all' ? 'on' : ''}" data-a="all">${t('zone.all', { n: nAll })}</button></div>
    <div class="zs-kpi"><div><b class="num">${pct(r.hit)}</b><span>${t('zone.contact')}</span></div><div><b class="num">${pct(r.out)}</b><span>${t('zone.outside')}</span></div><div><b class="num">${pct(r.late)}</b><span>${t('zone.racketMiss')}</span></div><div><b class="num">${pct(r.early)}</b><span>${t('zone.early')}</span></div></div>
    <div class="pnl zs-plot"><svg viewBox="-96 ${-back - 34} 192 ${back + fwd + 52}" width="100%" height="300">
      <line x1="-96" y1="0" x2="96" y2="0" stroke="rgba(255,255,255,.08)"/><line x1="0" y1="${-back - 20}" x2="0" y2="${fwd + 16}" stroke="rgba(255,255,255,.08)"/>
      <path d="${zone}" fill="rgba(53,198,244,.10)" stroke="#35C6F4" stroke-width="1.5" stroke-dasharray="5 4"/>
      <circle cx="0" cy="0" r="4.4" fill="#FFD54A"/>${dots}
      <text x="0" y="${-back - 22}" fill="#8C96C0" font-size="10" text-anchor="middle">${t('zone.position')}</text>
      <text x="-90" y="${-back / 2}" fill="#8C96C0" font-size="9">${t('zone.chop')} ↓</text><text x="-90" y="${fwd / 2}" fill="#8C96C0" font-size="9">${t('zone.drive')} ↑</text>
      <text x="${side + 3}" y="-3" fill="#35C6F4" font-size="10">${side}</text><text x="3" y="${fwd + 12}" fill="#35C6F4" font-size="10">${fwd}</text><text x="3" y="${-back - 4}" fill="#35C6F4" font-size="10">${back}</text></svg>
      <div class="zs-leg"><i style="background:#3BF5A0"></i>${t('zone.contact')} <i style="background:#FF5A4D"></i>${t('zone.inZoneMiss')} <i style="background:#7B86B0"></i>${t('zone.outside')} <i style="background:#FFD54A"></i>${t('zone.meeting')}</div></div>
    <div class="pnl zs-plot"><div class="cap" style="margin:2px 2px 6px">${t('zone.pressTiming')}</div><svg viewBox="0 0 244 90" width="100%" height="96">${hist}</svg></div>
    <div class="zs-recs">${r.recs.map(([k, t]) => `<div class="zs-rec ${k}">${t}</div>`).join('')}</div>
    ${cmpHtml}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px"><button class="b3 dark sm" data-a="clear">${t('zone.clear')}</button><button class="b3 dark sm" data-a="export">${t('zone.export')}</button><button class="b3 green sm" style="grid-column:1/-1" data-a="zone">${t('zone.adjust')}</button></div>`, {
    onOpen: (w) => w.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'clear') { ZoneStats.clear(); Sheet.close(true); zoneStatsSheet(scope); }
      if (a.dataset.a === 'cur' || a.dataset.a === 'all') { if (a.dataset.a !== scope) { Sheet.close(true); zoneStatsSheet(a.dataset.a); } }
      if (a.dataset.a === 'export') {
        const L = ZoneStats.all();
        const dump = JSON.stringify({ exported: new Date().toISOString(), ua: navigator.userAgent, screen: [screen.width, screen.height, devicePixelRatio], rules: R, attempts: L });
        copyText(dump).then((ok) => toast(ok ? t('zone.copied', { n: L.length }) : t('zone.copyFailed'), ok ? 'check' : 'x'));
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
    if (!r) { setTimeout(() => toast(t('zone.linkInvalid'), 'x'), 1800); return; }
    try { localStorage.setItem('ttu-rules-dev', JSON.stringify(r)); } catch (e) {}
    setTimeout(() => toast(t('zone.linkApplied', { values: Object.entries(r).map(([k, v]) => `${t('zone.field.' + k)} ${v === true ? t('common.on') : v === false ? t('common.off') : v}`).join(' · ') }), 'target'), 1800);
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
