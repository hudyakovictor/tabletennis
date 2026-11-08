/* =====================================================================
 *  APPLICATION BRIDGE — the canvas frame is owned by the single app shell.
 *
 *  Host → game  (postMessage {__tt:1, type, ...}):
 *    lobby {intro?,requestId?}   exhibition; intro waits with the ball hidden
 *    lobbyLaunch {requestId,x,y,diameter} projected splash-ball rebound
 *    attract                    slow orbit over an idle table (menus, VS)
 *    prematch {dur}             fly from the orbit into the playing camera
 *    match {diff,target,free,sessionKind} start a match (free — no score, endless)
 *    train {mode,lessonId,stroke,target,progress} voluntary academy/practice
 *    trainAction {action,answer} start/retry/restart/answer/continue
 *    previewOpen {lessonId,strokeId,technique,rate} | previewClose
 *    previewCommand {command,value} isolated motion/view controls
 *    pause / resume / quit
 *    outro                      victory orbit after the last point
 *    replay / skipReplay        best rally of the match
 *    hint {on} · debug {on} · mute {on}
 *    slowmo {on}                инспекторское замедление траектории (тумблер)
 *    settings {calibrations,audioLevels,sound,haptics,hint,motionOff,quality,debug,missShots}
 *    cal {k,v} | {values}       raw 0..100, all defaults/policy owned by the registry
 *    missShots {on, half}       автоматические снимки первого нажатия
 *    net {cmd, url?, code?}     cmd: create | join | status | leave — онлайн
 *  Game → host:
 *    lobbyReady {requestId,textures,reducedMotion} prepared scene presented
 *    lobbyFrame {requestId,x,y,diameter,phase,handoff,progress} until handoff
 *    lobbyHit {requestId,side,first:true} first incoming paddle contact
 *    ready {calibrationRegistry,calibration}, calibration, settings, slowmo,
 *    state, point, hit, serve, matchEnd, train, trainDone, attempt,
 *    preview {requestId,active,paused,...} including direct close/Esc
 *    shot, shotresult, shoterror, autoHint, awake, paused, replayEnd, haptic,
 *    net {st, room, side, latency, msg}  — статусы онлайн-лобби
 * ===================================================================== */
'use strict';

(function embedBridge() {
  if (typeof window === 'undefined' || !window.__TT_EMBED || window.parent === window) return;
  const post = (type, data) => {
    try { window.parent.postMessage(Object.assign({ __tt: 1, type }, data || {}), '*'); } catch (e) { /* host gone */ }
  };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const start = () => {
    if (typeof ET !== 'undefined' && window.__TT_LOCALE) ET.set(window.__TT_LOCALE);   // язык от хоста
    const applyStaticTexts = () => {
      const ui = window.__game && window.__game.ui;
      if (ui) { ui.localize?.(); ui.syncScore?.(); }
    };
    applyStaticTexts();
    const g = window.__game;
    if (!g) { post('error', { msg: 'game failed to boot' }); return; }
    const ui = g.ui;
    document.documentElement.classList.add('tt-embed');
    g.settings.haptics = false;             // the host owns haptics (Telegram API)
    if (typeof g.hintRequested !== 'boolean') g.hintRequested = g.hintContact !== false;
    refreshGameCalibrationPolicy(g);
    const publishCalibration = (requestId, type = 'calibration') => {
      const state = calibrationState(g);
      post(type, { requestId: Number.isFinite(requestId) ? requestId : null, calibration: state,
        ...(type === 'slowmo' ? { ...state.inspector, on: state.inspector.effective } : {}) });
      return state;
    };

    g.onCameraCalibrationChange = values => post('cameraCalibration', { values, calibration: calibrationState(g) });

    // Restore the calibration gallery from the earlier branch. Capture on
    // pointerdown, not on pause; the host decides which attempts were misses.
    const missCap = createMissShotCapture({ getCanvas: () => g.canvas,
      getOverlay: () => ui && ui.fx, post });
    /* Снимок не снимается внутри обработчика касания: readback WebGL-канваса
     * плюс JPEG — это десятки миллисекунд ровно в момент удара, и телефон
     * ощущает это как «тупит на каждом мяче». Захват откладывается на
     * ближайший render() цикла: буфер читается сразу после draw (пока
     * браузер его не очистил), а ввод уже отдан игре. */
    let shotQueue = null, shotTimer = 0;
    const takeShot = (id, redraw) => {
      shotQueue = null; clearTimeout(shotTimer);
      if (g.preview?.active || g._ttSleeping) { missCap.cancel(); post('shotdrop', { id }); return; }
      const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
      try {
        if (redraw) g.render();          // цикл не успел отрисовать — рисуем сами
        const rec = missCap.capture(id);
        if (g.debugRecording) g.logInput('calibration_capture', { outcome: {
          id, captured: !!rec, half: missCap.getHalf(),
          imageWidth: rec && rec.imageWidth, imageHeight: rec && rec.imageHeight,
          captureWallMs: typeof performance !== 'undefined' ? performance.now() - startedAt : null,
          gameTime: g.time, gestureId: g.swipe.gestureId, shotId: g.shotId } });
      } catch (e) { missCap.fail(e); }
    };
    const armShot = (id) => {
      shotQueue = id; clearTimeout(shotTimer);
      // Пауза/сон могут не дать ни одного кадра — тогда снимаем сами.
      shotTimer = setTimeout(() => { if (shotQueue === id) takeShot(id, true); }, 180);
    };

    /* ---------------------------- cinema ---------------------------- */
    let lobby = false;
    const C = { x: 0, y: PH.TABLE_Y, z: 0 };
    const cine = { mode: 'attract', t: 0, dur: 2, from: null };
    const sph = (e, l) => {
      const dx = e.x - C.x, dz = e.z - C.z;
      return { a: Math.atan2(dx, dz), r: Math.hypot(dx, dz), h: e.y, l: { x: l.x, y: l.y, z: l.z } };
    };
    const pose = (s) => ({ x: C.x + Math.sin(s.a) * s.r, y: s.h, z: C.z + Math.cos(s.a) * s.r });
    const mix = (a, b, k) => ({ a: a.a + (b.a - a.a) * k, r: a.r + (b.r - a.r) * k, h: a.h + (b.h - a.h) * k,
      l: { x: a.l.x + (b.l.x - a.l.x) * k, y: a.l.y + (b.l.y - a.l.y) * k, z: a.l.z + (b.l.z - a.l.z) * k } });
    let lastSph = null;
    const origCam = g.updateCamera.bind(g);
    g.updateCamera = function (dt) {
      if (this.state === GS.MENU && this.lobbyScene?.active) {
        this.lobbyScene.updateCamera(); lastSph = sph(this.camPos, this.camLook); return;
      }
      origCam(dt);
      if (!cine.mode) return;
      if (cine.mode !== 'attract' || !g.reducedMotion && document.visibilityState !== 'hidden') cine.t += dt || 0;
      const live = sph(this.camPos, this.camLook);
      const look0 = { x: C.x, y: C.y + 0.05, z: C.z - 0.15 };
      let s, shift = 0;
      if (cine.mode === 'attract') {
        s = lobby   // лобби: стол поднят в кадре выше (под именем игры), взгляд ниже стола
          ? { a: live.a + 1.05 + cine.t * 0.12, r: live.r * 1.55, h: live.h + 1.2, l: { x: C.x, y: C.y - 0.78, z: C.z - 0.1 } }
          : { a: live.a + 1.05 + cine.t * 0.16, r: live.r * 1.28, h: live.h + 0.75, l: look0 };
      } else if (cine.mode === 'prematch') {
        const k = easeInOut(clamp(cine.t / cine.dur, 0, 1));
        const from = cine.from || { a: live.a + 1.6, r: live.r * 1.5, h: live.h + 1.4, l: look0 };
        // unwrap the angle so the fly-in takes the short way round
        let a0 = from.a; while (a0 - live.a > Math.PI) a0 -= TAU; while (live.a - a0 > Math.PI) a0 += TAU;
        s = mix({ ...from, a: a0 }, live, k); shift = k;
        if (cine.t >= cine.dur) { cine.mode = null; lastSph = null; return; }
      } else if (cine.mode === 'outro') {
        const k = easeInOut(clamp(cine.t / 2.2, 0, 1));
        s = mix(live, { a: live.a + 0.5, r: live.r * 1.22, h: live.h + 0.45, l: look0 }, k);
        s.a += Math.max(0, cine.t - 1) * (g.reducedMotion ? 0 : 0.18);
        shift = 1 - k;
      } else return;
      lastSph = s;
      const eye = pose(s);
      V3.set(this.camPos, eye.x, eye.y, eye.z);
      V3.set(this.camLook, s.l.x, s.l.y, s.l.z);
      const sy = this.camShiftY * shift;
      this.R.setCamera(V3.new(eye.x, eye.y, eye.z), V3.new(s.l.x, s.l.y, s.l.z), { x: 0, y: 1, z: 0 }, this.fov, 0.05, 60, sy);
      const lrig = this._liveRig;
      V3.copy(lrig.eye, this.camPos); V3.copy(lrig.look, this.camLook); lrig.shiftY = sy;
      this.camVP = rigViewProj(lrig, this.R.aspect(), this._rigBuf);
    };
    const setCine = (mode, dur) => {
      cine.from = lastSph; cine.mode = mode; cine.t = 0; if (dur) cine.dur = dur;
    };

    /* ----------------------------- hooks ---------------------------- */
    const wrap = (obj, name, fn) => {
      const orig = obj[name];
      if (typeof orig !== 'function') return;
      obj[name] = function (...args) { return fn.call(this, orig.bind(this), ...args); };
    };
    const stateName = (s) => Object.keys(GS).find((k) => GS[k] === s) || String(s);
    let hudRequestId = 0, lastHudHit = '', onlineHudSeq = 0;
    const publishOnlineHud = () => {
      if (!g.network?.isInMatch) return;
      const snapshot = g.getMatchSnapshot();
      // Presentation only. Enabling Game.matchHudVisible for network play
      // would also enable stamina/effort and change the network physics.
      post('onlineHud', { snapshot: { ...snapshot, seq: ++onlineHudSeq, visible: true, free: false,
        staminaEnabled: false, contacts: [null, null], whiffs: [null, null], event: null, result: null } });
    };
    g.onMatchHud = snapshot => {
      if (lobby) return;
      if (g.network?.isInMatch) { publishOnlineHud(); return; }
      post('hud', { snapshot, hudRequestId });
      const event = snapshot.event;
      if (!snapshot.visible || event?.type !== 'hit') return;
      const contact = snapshot.contacts[event.side > 0 ? 0 : 1];
      const key = snapshot.matchId + ':' + event.id;
      if (!contact || contact.eventId !== event.id || key === lastHudHit) return;
      lastHudHit = key;
      post('hit', { by: contact.side, rally: snapshot.rally, kmh: Math.round(contact.kmh), stroke: contact.stroke,
        sweet: contact.sweet ?? (contact.side > 0 ? g.lastSweet || 0 : 0),
        x: contact.x ?? .5, y: contact.y ?? .6, eventId: contact.eventId, matchId: contact.matchId });
    };
    // Снимок промаха снимается в ближайшем кадре: буфер читается сразу после
    // draw, пока браузер его не очистил, но уже вне обработчика касания.
    wrap(g, 'render', function (orig) {
      const r = orig();
      if (shotQueue && !g.preview?.active) takeShot(shotQueue, false);
      return r;
    });
    wrap(g, 'setState', function (orig, s) {
      const r = orig(s);
      if (lobby) return r;
      post('state', { s: stateName(s), server: this.server, training: !!this.training });
      if (s === GS.SERVE_READY && !this.training) post('serve', { server: this.server, score: this.score.slice() });
      return r;
    });
    wrap(g, 'awardPoint', function (orig, who, reason) {
      const before = this.score[0] + this.score[1];
      const r = orig(who, reason);
      if (!lobby && !this.training && this.score[0] + this.score[1] !== before) {
        const T = this.settings.targetScore, s = this.score;
        const mp = (a, b) => a >= T - 1 && a > b;
        post('point', { who, reason, score: s.slice(), server: this.server, target: T,
          matchPoint: this.matchWinner ? 0 : mp(s[0], s[1]) ? 1 : mp(s[1], s[0]) ? -1 : 0,
          winner: this.matchWinner || 0, rally: this.rally });
      }
      return r;
    });
    wrap(g, 'applyHit', function (orig, side, racket, contactP) {
      const r = orig(side, racket, contactP, ...[].slice.call(arguments, 4));
      if (lobby || this.getMatchSnapshot?.().visible) return r;
      const p = contactP ? this.project(contactP, {}) : null;
      post('hit', { by: side, rally: this.rally, kmh: Math.round(V3.len(this.ball.v) * 3.6),
        stroke: racket && racket.stroke ? racket.stroke.id : '', sweet: side > 0 ? (this.lastSweet || 0) : 0,
        x: p && p.ok ? p.x : 0.5, y: p && p.ok ? p.y : 0.6 });
      return r;
    });
    wrap(g, '_tryPassiveBlock', function (orig) {
      const contactAttempt = syncAdmission();
      const ok = orig.apply(null, [].slice.call(arguments, 1));
      if (ok && !lobby) {
        if (contactAttempt && att === contactAttempt) { att.contact = true; att.sweet = 0.72; flush(); }
        if (!this.getMatchSnapshot?.().visible) {
          const p = this.ball && this.ball.p ? this.project(this.ball.p, {}) : null;
          post('hit', { by: 1, rally: this.rally, kmh: Math.round(V3.len(this.ball.v) * 3.6),
            stroke: 'BLOCK', sweet: 0.72, x: p && p.ok ? p.x : 0.5, y: p && p.ok ? p.y : 0.6 });
        }
      }
      return ok;
    });
    /* The game pauses itself on window blur. Inside the host that fires every
     * time the player touches a host button (pause, skip, dev) — focus leaves
     * the iframe — and would freeze the drill with no visible reason. In
     * embed mode only the host and a hidden page may pause the game. */
    let hostCmd = false;
    wrap(g, 'setPaused', function (orig, v) {
      if (v && !hostCmd && document.visibilityState === 'visible') return undefined;
      const was = !!this.paused; const r = orig(v);
      if (was !== !!this.paused) post('paused', { v: !!this.paused, host: hostCmd });
      return r;
    });
    const hostPause = (v) => { hostCmd = true; try {
      if (g.lobbyScene?.active) g.lobbyScene.paused = !!v;
      g.setPaused(v);
    } finally { hostCmd = false; } };
    wrap(g, 'endReplay', function (orig, complete) { const was = this.replayer && this.replayer.on; const r = orig(complete); if (was) post('replayEnd', {}); return r; });
    wrap(g, 'buzz', function (orig, ms) { post('haptic', { kind: Array.isArray(ms) ? 'success' : ms >= 30 ? 'heavy' : 'light' }); });
    if (ui) {
      ui.syncScore = publishOnlineHud;
      ui.showNote = note => { if (!lobby && note) post('coachNote', { note }); };
      ui.showMatchEnd = function (won) {
        if (lobby) return;
        const s = g.stats;
        post('matchEnd', { won: !!won, score: g.score.slice(), bestRally: g.bestRally,
          stats: { shots: s.shots, winners: s.winners, errors: s.errors, maxSpeed: Math.round(s.maxSpeed),
            maxSpin: Math.round(s.maxSpin), byStroke: s.byStroke },
          /* Телеметрия бота именно этого матча — по уровню, ошибкам (сетка/
           * длинные), скорости ответа и балансу ударов. Хост пишет её в
           * аналитику; без аналитики она остаётся в последнем сообщении. */
          ai: g.ai && g.ai.telemetry ? g.ai.telemetry() : null,
          hasReplay: !!(g.moments && g.moments.best) });
      };
    const lastTrain = { key: '', stage: '' };
      wrap(ui, 'trainSync', function (orig, t) {
        if (lastTrain.stage !== t.stage) {
          lastTrain.stage = t.stage;
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration();
        }
        const r = orig(t);
        const key = [t.sessionId, t.revision, ET.lang(), ui.inputMode, t.coachText, t.nudge > 0].join('|');
        if (key !== lastTrain.key) {
          lastTrain.key = key;
          post('train', Object.assign(t.snapshot(), { requestId: t.options.requestId }));
        }
        return r;
      });
      ui.trainProgress = t => post('trainingProgress', { requestId: t.options.requestId, sessionId: t.sessionId,
        mode: t.mode, id: t.S.id, profile: t.profile, stage: t.stage,
        attempts: t.attempts, correct: t.done, practicePassed: t.practicePassed, quizPassed: t.quizPassed,
        validated: t.checkPassed === true });
      wrap(ui, 'trainDone', function (orig, t) {
        const r = orig(t); post('trainDone', Object.assign(t.summary(), { requestId: t.options.requestId })); return r;
      });
      wrap(ui, 'trainHide', function (orig) { return orig(); });
    }
    // the coach sentence changes with the game state (toss, ball held…): resync each frame cheaply
    wrap(g, 'update', function (orig, dt) {
      const r = orig(dt);
      if (this.training && ui && ui.trainSync) ui.trainSync(this.training);
      return r;
    });

    /* ------------------------ zone telemetry ------------------------ *
     * One record per real attempt (a press on an incoming ball or on the
     * falling toss): where the finger landed relative to the meeting point,
     * how early, and what happened. The host keeps the last few hundred and
     * turns them into a tuning report — real phones, real fingers. */
    let att = null, tossCandidate = false;
    const syncAdmission = () => {
      const sw = g.swipe, z = sw && sw.pressZone;
      if (!att || !sw || att.gestureId !== sw.gestureId || att.shotId !== g.shotId ||
          z && z.shotId !== att.shotId) return null;
      if (z) { att.accepted = !!z.accepted; att.zoneReason = z.reason || null; }
      if (tossCandidate && isRealStroke(sw.active ? sw.m : sw.lastReleased, true)) {
        tossCandidate = false;
        if (att.captureId) armShot(att.captureId);
      }
      return att;
    };
    g.cancelPendingCapture = () => {
      clearTimeout(shotTimer); shotQueue = null; missCap.cancel();
      if (att && att.captureId) post('shotdrop', { id: att.captureId });
      att = null; tossCandidate = false;
    };
    /* A miss explained in one line, right where the eye already is (the
     * shot pill). Built from the same attempt record the stats use, so the
     * advice and the tuning data never disagree. Drills have their own coach. */
    let tip = null, lastAttemptShot = -1;
    const missTip = (a) => {
      // the gate this attempt was judged by (world-scaled per phone/camera), falling back to the rules
      const ext = a.ext || [MATCH_RULES[a.input === 'mouse' ? 'contactSideMousePx' : 'contactSideTouchPx'], MATCH_RULES.contactBackPx, MATCH_RULES.contactForwardPx];
      const side = ext[0], back = ext[1], fwd = ext[2];
      const lr = ET(a.dx > 0 ? 'правее' : 'левее');
      if (a.reason === 'WRONG_DIRECTION' || a.zoneReason === 'WRONG_DIRECTION')
        return ET(a.dy < 0 ? 'Палец над мячом. Веди вниз через мяч или начни под ним.' : 'Палец под мячом. Веди вверх через мяч.');
      if (!a.accepted) {
        if (Number.isFinite(a.dx) && Math.abs(a.dx) > side * 0.8) return ET('Палец {side} мяча. Начни на линии мяча.', { side: lr });
        if (Number.isFinite(a.dy) && a.dy < -back * 0.8) return ET('Старт слишком высоко. Начни ближе к мячу.');
        if (Number.isFinite(a.dy) && a.dy > fwd * 0.8) return ET('Старт слишком низко. Начни ближе к мячу.');
        return ET('Нажатие вне зоны. Начни на линии мяча: вход по адресу.');
      }
      if (a.reason === 'TIMING_EARLY' || (Number.isFinite(a.lead) && a.lead > 0.2)) return ET('Рано. Дождись мяча у ракетки: приём ещё закрыт.');
      if (a.reason === 'NO_FRESH_SWIPE') return ET('Новому мячу нужен новый тап или свайп. Старую заявку не принимают.');
      if (a.reason === 'STATIC_CLICK') return ET('Контакта нет. Нажми коротко или проведи через мяч.');
      if (Number.isFinite(a.dx) && Math.abs(a.dx) > side * 0.55) return ET('Ракетка прошла {side} мяча. Веди прямо через него.', { side: lr });
      return ET('Контакта нет. Веди быстрее и прямо через мяч.');
    };
    // 4.6 s: the point has to be replayed in your head AND the tip read;
// 2.6 s vanished during the very recovery the advice was about.
const showTip = (text) => { if (text) tip = { text, until: g.time + 4.6 }; };
    g.__missTip = () => tip;   // e2e probe
    /* Never override an explicit hint OFF or a competitive restriction. */
    let missStreak = 0, autoHint = false, autoHits = 0;
    const onMiss = () => {
      if (g.hintRequested === false || gameplayCalibrationLocked(g)) { missStreak = 0; return null; }
      if (++missStreak >= 3 && !g.hintContact && !g.training) {
        autoHint = true; autoHits = 0; g.hintContact = true; missStreak = 0;
        post('autoHint', { on: true });
        return ET('Подсказка включена. Веди свайп через мяч.');
      }
      return null;
    };
    const onContact = () => {
      missStreak = 0;
      if (autoHint && ++autoHits >= 2) { autoHint = false; g.hintContact = false; post('autoHint', { on: false }); }
    };
    const resetAssist = () => { if (autoHint) g.hintContact = false; missStreak = 0; autoHint = false; autoHits = 0; };
    const flush = () => {
      if (!att) return;
      syncAdmission();
      if (tossCandidate && !att.contact) {
        if (att.captureId) post('shotdrop', { id: att.captureId });
        att = null; tossCandidate = false; return;
      }
      if (!lobby && !g.demoMode) {
        post('attempt', att);
        // A successful contact removes only this attempt's frame, as in the
        // original gallery. Otherwise keep its first observed rejection code.
        if (att.captureId) post('shotresult', { id: att.captureId, contact: !!att.contact,
          reason: att.reason || att.zoneReason || null });
        if (!att.training && att.kind === 'rally') {
          if (att.contact) onContact();
          else showTip(onMiss() || missTip(att));
        }
      }
      att = null; tossCandidate = false;
    };
    g.onPressZone = function (z, cp, serving) {
      flush();
      if (lobby || this.demoMode || !z) return;
      lastAttemptShot = this.shotId;
      const readyToss = this.state === GS.SERVE_READY;
      if (readyToss && !(z.singleGestureToss && z.pendingServeDrop)) return;
      serving = !!serving || readyToss;
      const incoming = this.state === GS.RALLY && this.ball.live && this.ball.lastHitBy === -1;
      if (!serving && !incoming) return;
      // A READY press is only a candidate: a real one-motion serve preserves
      // its initial evidence, while a stationary toss tap is discarded on flush.
      tossCandidate = readyToss;
      const capture = calibrationState(this).capture;
      att = { t: +this.time.toFixed(3), kind: serving ? 'serve' : 'rally', input: z.pointerType || 'touch',
        accepted: !!z.accepted, zoneReason: z.reason || null,
        acceptedAtPress: !!z.accepted, zoneReasonAtPress: z.reason || null,
        gestureId: this.swipe.gestureId, shotId: this.shotId,
        dx: Number.isFinite(z.pointerX) && Number.isFinite(z.x) ? Math.round(z.pointerX - z.x) : null,
        dy: Number.isFinite(z.pointerY) && Number.isFinite(z.y) ? Math.round(z.pointerY - z.y) : null,
        lead: cp && Number.isFinite(cp.t) ? +cp.t.toFixed(3) : null,
        contact: false, reason: null, sweet: null, training: !!this.training, rules: MATCH_RULES.version,
        // which SETTINGS produced this record (reference px + capture radius) — lets the host compare settings;
        // ext = the gate actually applied on this phone/camera after world scaling, kx = its scale
        sig: [MATCH_RULES[(z.pointerType || 'touch') === 'mouse' ? 'contactSideMousePx' : 'contactSideTouchPx'], MATCH_RULES.contactBackPx, MATCH_RULES.contactForwardPx,
          Number.isFinite(capture.radius) ? capture.radius : MATCH_RULES.captureRadius].map((v) => +(+v).toFixed(2)).join('/'),
        ext: z.anchor === 'contact' ? [z.sidePx, z.backPx, z.fwdPx].map((v) => Math.round(v)) : null,
        kx: Number.isFinite(z.kx) ? +z.kx.toFixed(2) : null };
      // The gate may be anchored to a predicted meeting point rather than the
      // ball's current screen position. Preserve both instead of labelling the
      // reference point as the ball or the visible hint.
      try {
        const ballScreen = this.ball && this.ball.p ? this.project(this.ball.p, {}) : null;
        const zone = Number.isFinite(z.x) && Number.isFinite(z.y) ? {
          x: z.x, y: z.y, radius: z.radius, shape: z.shape, anchor: z.anchor || 'ball',
          axisX: z.axisX, axisY: z.axisY, fwdPx: z.fwdPx, backPx: z.backPx, sidePx: z.sidePx } : null;
        const ball = ballScreen && ballScreen.ok ? { x: ballScreen.x * z.vw, y: ballScreen.y * z.vh } : null;
        att.captureId = missCap.request({ press: { x: z.pressX * z.vw, y: z.pressY * z.vh },
          vw: z.vw, vh: z.vh, zone, ball, kind: att.kind, input: att.input, training: att.training,
          gameTime: this.time, gestureId: att.gestureId, shotId: att.shotId,
          greenAtPress: z.pressContactable, accepted: att.accepted, zoneReason: z.reason,
          dx: att.dx, dy: att.dy });
      } catch (e) {
        missCap.fail(e);
        if (this.debugRecording) this.logInput('calibration_capture', { outcome: {
          id: att.captureId || null, captured: false, error: String(e && e.message || e) } });
      }
      if (att.captureId && !tossCandidate) armShot(att.captureId);
    };
    // Promotions happen during input/physics, before applyHit can consume the
    // gesture or change shotId. Never read a newer gesture as this attempt.
    for (const name of ['promotePendingServeZone', 'promotePendingRallyBackswing']) {
      wrap(g, name, function (orig, ...args) { const result = orig(...args); syncAdmission(); return result; });
    }
    wrap(g, 'logPressRejection', function (orig, reason, detail) {
      if (syncAdmission() && !att.reason && !att.contact) att.reason = reason;
      return orig(reason, detail);
    });
    wrap(g, 'applyHit', function (orig, side) {
      const contactAttempt = side > 0 ? syncAdmission() : null;
      const r = orig.apply(null, [].slice.call(arguments, 1));
      if (contactAttempt && att === contactAttempt) { att.contact = true; att.sweet = +(this.lastSweet || 0).toFixed(2); flush(); }
      return r;
    });
    wrap(g, 'setState', function (orig, st) { if (st !== GS.RALLY && st !== GS.SERVE_TOSS) flush(); return orig(st); });
    wrap(g, 'awardPoint', function (orig, who, reason) {
      if (att && !att.contact && !att.reason) att.reason = 'POINT_' + (who > 0 ? 'WON' : 'LOST');
      const untouched = !att && who < 0 && !lobby && !this.demoMode && !this.training && this.state === GS.RALLY && this.ball && this.ball.lastHitBy === -1
        && Array.isArray(this.rallyBounces) && this.rallyBounces.some((sd) => sd > 0) && lastAttemptShot !== this.shotId;
      flush();
      if (untouched) showTip(onMiss() || ET('Мяч пропущен. Начни под ним и веди вверх.'));
      return orig(who, reason);
    });

    /* ----------------------------- sleep ----------------------------- *
     * The host hides the layer for menus, shop, results… A hidden iframe
     * still gets rAF, so without this the WebGL scene kept rendering at full
     * rate behind every screen — battery, heat and janky host animations.
     * Asleep: no physics, no draw, no HUD; the loop itself costs nothing. */
    g._ttSleeping = false;
    for (const [obj, name] of [[g, 'update'], [g, 'render'], [ui, 'tick']]) {
      wrap(obj, name, function (orig, ...a) { return g._ttSleeping ? undefined : orig(...a); });
    }
    const wake = () => { if (g._ttSleeping) {
      g.lobbyScene?.suspend(); g._ttSleeping = false; g.syncAudioQuiet(); post('awake', {});
    } };
    document.addEventListener('visibilitychange', () => { g.lobbyScene?.suspend(); });
    let previewRequestId = 0;
    const publishPreview = (opened) => post('preview', { ...g.preview?.snapshot(), requestId: previewRequestId,
      active: !!g.preview?.active, paused: !!g.paused, opened, error: opened === false ? g.preview?.error || 'unavailable' : null });
    if (g.preview) {
      wrap(g.preview, 'open', function (orig, options) { const ok = orig(options); publishPreview(ok); return ok; });
      wrap(g.preview, 'close', function (orig, restore) {
        const closed = orig(restore);
        if (closed) { g.syncAudioQuiet(); publishPreview(); }
        return closed;
      });
    }

    /* ------------------------ lost GPU context ----------------------- *
     * Mobile browsers drop WebGL contexts when the app is backgrounded or
     * memory is tight; without handling, the arena stays black forever.
     * Rebuilding every GL resource in place is fragile, so the game reports
     * what was going on and the host rebuilds the whole iframe and resumes. */
    const glCanvas = document.getElementById('gl');
    if (glCanvas) glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); g._ttSleeping = true; g._ttContextLost = true;
      g.clearContactFlashes?.();
      g.lobbyScene?.stop();
      if (g.preview?.active) g.preview.close(false);
      post('glLost', { state: stateName(g.state), lobby, training: g.training ? g.training.step : null,
        inMatch: !lobby && !g.training && [GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY, GS.POINT].includes(g.state),
        score: (g.score || [0, 0]).slice(), server: g.server, resume: g.captureMatchResume?.() });
    }, false);

    // Non-lobby attract/prematch screens retain their original still life.
    const stageIdleArena = () => {
      if (g.demoMode) g.stopDemo();
      const b = g.ball;
      if (b.hist) b.hist.length = 0;
      b.trailGrade = null; b.golden = null; b.live = false;
      /* Красивый натюрморт: мяч лежит на столе по центру передней кромки,
       * обе ракетки ЛЕЖАТ ПЛАШМЯ на столе по разные половины. */
      V3.set(b.p, 0.16, PH.TABLE_Y + 0.02, 0.52);
      V3.zero(b.v); V3.zero(b.w);
      /* Ракетка игрока лежит слева от мяча, лицом вверх (nomal смотрит вверх =
       * клинок горизонтален). pos.y = стол + толщина клинка. */
      const pp = g.player;
      V3.set(pp.pos, -0.34, PH.TABLE_Y + 0.035, 0.95);
      V3.set(pp.normal, 0, 1, 0.18); V3.norm(pp.normal, pp.normal);
      pp.swing = 0; pp.roll = 0;
      g.settings.showPlayerPaddle = true;
      if (g.anticipation) g.anticipation.active = false;
      /* Ракетка соперника — справа от дальней кромки, тоже плашмя. */
      if (g.ai && g.ai.pos) V3.set(g.ai.pos, 0.36, PH.TABLE_Y + 0.035, -0.9);
      if (g.ai && g.ai.anim) { g.ai.anim.swing = 0; g.ai.anim.windup = 0; g.ai.anim.lean = 0; }
      if (cine.mode !== 'attract') setCine('attract');
      g._idleStill = true;              // updatePlayerPaddle не трогает сцену
    };
    const leaveLobby = () => { lobby = false; g.lobbyScene?.stop(); };

    const baseTableCol = g.scene && g.scene.mat && g.scene.mat.table && g.scene.mat.table.color
      ? g.scene.mat.table.color.slice() : null;
    const applyHostEquip = (eq) => {
      if (!eq || typeof eq !== 'object' || !g.equip) return;
      const bladeMap = { 'b-ink': 'b_carb' };
      const rubberMap = { 'r-coral': 'r_tops', 'r-void': 'r_hyb', 'r-teal': 'r_ctl' };
      const bId = bladeMap[eq.blade] || 'b_base';
      const rId = rubberMap[eq.rubber] || 'r_base';
      g.equip.set(bId, rId, rId);
      if (eq.blade === 'b-ink') {
        g.equip.colours.wood = [0.23, 0.26, 0.56];
        g.equip.colours.grip = [0.12, 0.14, 0.28];
      }
      if (eq.rubber === 'r-coral') g.equip.colours.fore = [1.0, 0.29, 0.24];
      else if (eq.rubber === 'r-void') g.equip.colours.fore = [0.62, 0.42, 1.0];
      else if (eq.rubber === 'r-teal') g.equip.colours.fore = [0.08, 0.78, 0.71];
      g.equip._tintKey = [eq.blade || '', eq.rubber || ''].join(':');

      if (eq.trail === 't-gold') g._customTrailCol = [1.0, 0.79, 0.23];
      else if (eq.trail === 't-coral') g._customTrailCol = [1.0, 0.48, 0.30];
      else g._customTrailCol = null;

      if (g.scene && g.scene.mat && g.scene.mat.table && baseTableCol) {
        g.scene.mat.table.color = eq.table === 'tb-neon' ? [0.07, 0.24, 0.38] : baseTableCol.slice();
      }
    };

    const applyHostSettings = (m) => {
      if (typeof m.sound === 'boolean') { g.settings.sound = m.sound; g.audio.setMuted(!m.sound); }
      if (m.audioLevels && typeof m.audioLevels === 'object' && !Array.isArray(m.audioLevels)) {
        const levels = {};
        for (const key of ['master', 'effects', 'music', 'ambient']) {
          if (Object.prototype.hasOwnProperty.call(m.audioLevels, key) && Number.isFinite(m.audioLevels[key])) levels[key] = clamp(m.audioLevels[key], 0, 1);
        }
        g.settings.audioLevels = g.audio.setLevels(levels);
        if (Number.isFinite(levels.master)) g.settings.volume = levels.master;
      }
      if (typeof m.haptics === 'boolean') g.settings.haptics = m.haptics;
      if (typeof m.showPaddle === 'boolean') g.settings.showTouchPaddle = m.showPaddle;
      if (typeof m.hint === 'boolean') { autoHint = false; g.hintRequested = m.hint; }
      if (typeof m.motionOff === 'boolean') g.motionOff = m.motionOff;
      g.reducedMotion = !!g.motionOff || !!(g.motionQuery && g.motionQuery.matches);
      if (ui) ui.reducedMotion = g.reducedMotion;
      if (g.reducedMotion) g.clearContactFlashes?.();
      if (g.lobbyScene?.reduceMotion()) g.render();
      const quality = ['high', 'mid', 'low'].includes(m.quality) ? { high: 'high', mid: 'medium', low: 'low' }[m.quality] : null;
      if (quality && (g.settings.quality !== quality || g.R.quality !== quality)) { g.settings.quality = quality; g.R.quality = quality; g.resize(); }
      if (typeof m.debug === 'boolean') {
        if (typeof g.setDiagnosticMode === 'function') g.setDiagnosticMode(m.debug);
        else if (ui) ui.captureDebug = m.debug;
      }
      if (m.missShots && typeof m.missShots.on === 'boolean') { missCap.setEnabled(m.missShots.on); missCap.setHalf(m.missShots.half); }
      if (Object.prototype.hasOwnProperty.call(m, 'calibrations')) applyGameCalibrations(g, m.calibrations);
      else refreshGameCalibrationPolicy(g, '_policy');
      post('settings', { requestId: Number.isFinite(m.requestId) ? m.requestId : null, calibration: calibrationState(g),
        audioLevels: { ...g.settings.audioLevels }, muted: g.settings.sound === false, reducedMotion: g.reducedMotion,
        quality: g.settings.quality });
    };

    /* Online menus and scoreboards belong to the same application UI. */
    let netPending = null;                       // код комнаты, ждущий connect
    let netTried = false;                         // игрок хотя бы раз жал «создать/войти»
    const netSay = (st, extra) => post('net', Object.assign({ st }, extra || {}));
    function netStart(intent) {                   // '' — создать, иначе — войти по коду
      const net = g.network;
      netPending = intent; netTried = true;
      if (net.connected) { net.joinRoom(netPending || undefined); netPending = null; }
      else if (net.state !== 'CONNECTING') { netSay('connecting'); net.connect(window.__TT_NET || undefined); }
    }
    function netCommand(m) {
      const net = g.network;
      switch (m.cmd) {
        case 'create': netStart(''); break;
        case 'join': netStart(String(m.code || '').toUpperCase().slice(0, 8)); break;
        case 'status':
          /* опрос идёт каждые 2 с: пока игрок ничего не нажимал, отсутствие
           * сокета — не поломка, а нормальное состояние лобби */
          netSay(net.state === 'IN_MATCH' ? 'match' : net.state === 'WAITING' ? 'waiting' :
                 net.state === 'CONNECTING' ? 'connecting' : net.state === 'LOBBY' ? 'lobby' :
                 (netTried ? 'closed' : 'idle'),
                 { room: net.room, side: net.side, latency: net.latency });
          break;
        case 'leave':
          netPending = null; netTried = false; net.leaveRoom(); net.disconnect(); netSay('closed');
          if (g.sessionKind === 'online') g.sessionKind = 'free';
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration();
          break;
        default: break;
      }
    }
    (function bindNetwork() {
      const net = g.network;
      net.on('connected', () => {
        if (netPending !== null) { net.joinRoom(netPending || undefined); netPending = null; }
        else netSay('lobby');
      });
      net.on('assigned', (msg) => netSay('assigned', { room: msg.room, side: msg.side }));
      net.on('matchStart', () => {
        /* Оба игрока стартуют по одному сигналу реле. Физика считается на
         * хосте, гость присылает положение ракетки; уровень 2 — не «бот вместо
         * соперника», а качество отскока дальней ракетки, которую ведут руками. */
        cine.mode = null; lastSph = null;   // остановить attract-камеру
        g.sessionKind = 'online';
        g.inspectSlowmoRequested = false; g.inspectSlowmo = false; leaveLobby();
        g.settings.targetScore = 11; g.freePlay = false;
        resetAssist();
        g.startMatch(2);
        refreshGameCalibrationPolicy(g); publishCalibration();
        if (net.isHost) g.server = 1;        // хост всегда первый подаёт
        if (g.ui) g.ui.syncScore(); // names, zero score and the first server immediately
        netSay('match', { side: net.side });
      });
      net.on('peerLeft', () => { netSay('peerleft'); g.returnToMenu(); g.sessionKind = 'free'; refreshGameCalibrationPolicy(g, '_policy'); publishCalibration(); });
      net.on('disconnected', () => {
        netSay(netTried ? 'closed' : 'idle');
        if (g.sessionKind === 'online') g.sessionKind = 'free';
        refreshGameCalibrationPolicy(g, '_policy'); publishCalibration();
      });
      net.on('error', (msg) => netSay('error', { msg: ET(String(msg && msg.message ? msg.message : msg)) }));
    })();

    /* ---------------------------- commands -------------------------- */
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (e.source !== window.parent || !m || m.__tt !== 1) return;
      if (m.type === 'lobby' && m.intro === true && !Number.isSafeInteger(m.requestId)) return;
      // only commands that need a visible, running arena wake it; 'attract'/'quit' just set the scene
      // behind a hidden layer (menus, matchmaking) and must not restart full-rate rendering there
      const statusOnly = m.type === 'net' && m.cmd === 'status';
      if (!statusOnly && !['sleep', 'mute', 'haptics', 'equip', 'quality', 'rm', 'debug', 'hint', 'inputMode', 'attract', 'quit', 'quiet', 'pause', 'resume', 'locale', 'missShots', 'cal', 'settings', 'sessionKind', 'slowmo'].includes(m.type)) wake();
      switch (m.type) {
        case 'net': netCommand(m); break;
        case 'sleep': g.cancelPendingCapture(); g.cancelInput?.(); g.clearContactFlashes?.(); g.lobbyScene?.suspend(); g._ttSleeping = true; g.syncAudioQuiet(); break;
        case 'wake': break;
        case 'previewOpen':
          leaveLobby();
          previewRequestId = Number.isFinite(m.requestId) ? m.requestId : previewRequestId;
          hostPause(true);
          if (!g.openTrainingPreview(m)) publishPreview(false);
          break;
        case 'previewClose':
          g.cancelPendingCapture();
          if (!g.preview?.close()) publishPreview();
          break;
        case 'previewCommand':
          if (g.preview?.active) { g.preview.command(m.command, m.value); publishPreview(); }
          break;
        case 'settings': applyHostSettings(m); break;
        case 'sessionKind':
          if (['free', 'practice', 'ranked', 'career', 'check', 'online'].includes(m.sessionKind)) g.sessionKind = m.sessionKind;
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration(m.requestId); break;
        case 'attract':
          leaveLobby();
          if (g.state !== GS.MENU) g.returnToMenu();
          g.sessionKind = 'free'; g.inspectSlowmoRequested = false;
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration();
          stageIdleArena(); break;
        case 'lobby':
          lobby = true; g.audio.setMuted(true); resetAssist();
          if (g.preview?.active) g.preview.close();
          if (g.state !== GS.MENU) g.returnToMenu();
          g.sessionKind = 'free'; g.inspectSlowmoRequested = false;
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration();
          if (g.demoMode) g.stopDemo();
          if (!g.lobbyScene) g.lobbyScene = new LobbyExhibition(g, post);
          g.lobbyScene.prepare(m);
          g.updateCamera(0); g.render();
          break;
        case 'lobbyLaunch':
          if (lobby && g.state === GS.MENU && g.lobbyScene?.launch(m)) g.render();
          break;
        case 'prematch':
          leaveLobby();
          if (g.state !== GS.MENU) g.returnToMenu();
          setCine('prematch', m.dur || 2.0); break;
        case 'match':
          leaveLobby();
          hudRequestId = Number.isSafeInteger(m.hudRequestId) ? m.hudRequestId : 0;
          g.sessionKind = ['free', 'practice', 'ranked', 'career', 'check', 'online'].includes(m.sessionKind) ? m.sessionKind : m.free ? 'free' : 'practice';
          g.inspectSlowmoRequested = false; g.inspectSlowmo = false;
          refreshGameCalibrationPolicy(g, '_policy');
          g.audio.init(); g.audio.resume();
          if (Number.isFinite(m.target)) g.settings.targetScore = m.target;
          /* Свободная игра: очки и подачи идут, но score не растёт и матч не
           * заканчивается. Флаг снимается при выходе в меню/тренировку. */
          g.freePlay = !!m.free;
          /* Адаптация между матчами от хоста (тренд его последних игр);
           * без неё — своя история результатов.*/
          if (Number.isFinite(m.trend)) g.setAiTrend(m.trend);
          else g.aiTrend = g.trendFromHistory();
          resetAssist();
          if (g.startMatch(Number.isFinite(m.diff) ? m.diff : g.settings.difficulty, m.resume || null) === false) {
            hostPause(true); post('error', { code: 'invalid_match_resume', msg: 'Match recovery state is invalid' }); break;
          }
          refreshGameCalibrationPolicy(g); publishCalibration();
          if (m.resume) cine.mode = null;
          else if (cine.mode === 'attract') setCine('prematch', 1.2);
          break;
        case 'train':
          leaveLobby();
          g.sessionKind = m.sessionKind === 'check' || m.resume && m.resume.stage === 'check' ? 'check' : 'practice';
          g.inspectSlowmoRequested = false; g.inspectSlowmo = false;
          refreshGameCalibrationPolicy(g, '_policy');
          g.audio.init(); g.audio.resume();
          g.startTraining(m);
          refreshGameCalibrationPolicy(g); publishCalibration();
          if (cine.mode === 'attract') setCine('prematch', 1.2);
          break;
        case 'trainAction':
          if (g.training) {
            g.training.action(m.action, m.answer);
            g.sessionKind = g.training.stage === 'check' ? 'check' : 'practice';
            refreshGameCalibrationPolicy(g, '_policy'); publishCalibration();
            if (['start', 'retry', 'restart', 'continue'].includes(m.action) || m.action === 'answer' && g.training.quizPassed) hostPause(false);
          }
          break;
        case 'inputMode': if (ui && ui.setInputMode) ui.setInputMode(m.pointerType); break;
        case 'pause': hostPause(true); break;
        case 'resume': hostPause(false); break;
        case 'quit':
          g.cancelPendingCapture();
          leaveLobby(); g.inspectSlowmoRequested = false; g.inspectSlowmo = false; g.returnToMenu(); g.sessionKind = 'free';
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration(); setCine('attract'); break;
        case 'outro': setCine('outro'); break;
        case 'live': cine.mode = null; break;
        case 'replay': if (!g.playBestMoments()) post('replayEnd', {}); break;
        case 'skipReplay': g.skipReplay(); break;
        case 'skipStep': if (g.training) g.training.skip(); break;
        case 'hint':
          autoHint = false; g.hintRequested = !!m.on;
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration(); break;
        /* Тумблер инспекторского слоу-мо из оболочки: разобрать траекторию
         * удара в замедлении. Состояние кнопки в движке догонит syncSlowmoControl. */
        case 'slowmo':
          g.inspectSlowmoRequested = !!m.on;
          if (g.setInspectSlowmo) g.setInspectSlowmo(!!m.on);
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration(m.requestId, 'slowmo'); break;
        case 'missShots': missCap.setEnabled(!!m.on); missCap.setHalf(m.half); break;
        case 'rm':
          g.motionOff = !!m.on; g.reducedMotion = g.motionOff || !!(g.motionQuery && g.motionQuery.matches);
          if (ui) ui.reducedMotion = g.reducedMotion;
          if (g.reducedMotion) g.clearContactFlashes?.();
          if (g.lobbyScene?.reduceMotion()) g.render();
          refreshGameCalibrationPolicy(g, '_policy'); publishCalibration(); break;
        case 'debug':
          if (typeof g.setDiagnosticMode === 'function') g.setDiagnosticMode(!!m.on);
          else if (ui) ui.captureDebug = !!m.on;
          break;
        case 'mute': g.settings.sound = !m.on; g.audio.setMuted(!!m.on); break;
        case 'haptics': g.settings.haptics = !!m.on; break;
        case 'equip': applyHostEquip(m.equipped || m); break;
        case 'quality': {
          if (!['high', 'mid', 'low'].includes(m.q)) break;
          const q = { high: 'high', mid: 'medium', low: 'low' }[m.q];
          g.settings.quality = q; g.R.quality = q; g.resize(); break;
        }
        case 'quiet':
          document.documentElement.classList.toggle('tt-quiet', !!m.on);
          g._audioQuietRequested = !!m.on; g.syncAudioQuiet();
          break;
        case 'locale': if (typeof ET !== 'undefined') {
          ET.set(m.lang); applyStaticTexts(); post('trainingCatalog', { catalog: trainingCatalog() });
          if (g.training) { g.training.localize(); g.training.sync(); }
          g.preview?.localize();
        } break;
        case 'cal': {
          if (Object.prototype.hasOwnProperty.call(m, 'values')) applyGameCalibrations(g, m.values);
          else if (m.reset === true) applyGameCalibrations(g, {});
          else applyGameCalibration(g, m.k, m.v);
          publishCalibration(m.requestId);
          break;
        }
      }
    });
    post('ready', { rules: Object.assign({}, MATCH_RULES), trainingCatalog: trainingCatalog(),
      strokeCatalog: typeof STROKES === 'undefined' ? [] : Object.values(STROKES).map(({ id, col }) => ({ id, col })),
      calibrationRegistry: CALIBRATION_REGISTRY, calibration: calibrationState(g),
      calibrationPreferences: g.savedCalibrationPreferences || {},
      steps: TRAIN_STEPS.map((s) => ({ id: s.id, title: ET(s.title) })) });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
