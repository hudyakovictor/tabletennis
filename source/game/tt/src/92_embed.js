/* =====================================================================
 *  EMBED BRIDGE — runs only when the host page set window.__TT_EMBED.
 *
 *  Host → game  (postMessage {__tt:1, type, ...}):
 *    attract                    slow orbit over an idle table (menus, VS)
 *    prematch {dur}             fly from the orbit into the playing camera
 *    match {diff,target,hint,free}   start a scored match (free — no score, endless)
 *    train {step}               start the tutorial (optionally at a drill)
 *    pause / resume / quit
 *    outro                      victory orbit after the last point
 *    replay / skipReplay        best rally of the match
 *    hint {on} · debug {on} · mute {on}
 *    slowmo {on}                инспекторское замедление траектории (тумблер)
 *    cal {k, v}                 калибровка оболочки; spinGain/arcSens — закрутка
 *    missShots {on, half}       автоматические снимки первого нажатия
 *    net {cmd, url?, code?}     cmd: create | join | status | leave — онлайн
 *  Game → host:
 *    ready, state, point, hit, serve, matchEnd, train, trainDone, attempt,
 *    shot, shotresult, shoterror, autoHint, awake, paused, replayEnd, haptic,
 *    net {st, room, side, latency, msg}  — статусы онлайн-лобби
 * ===================================================================== */
'use strict';

(function embedBridge() {
  if (typeof window === 'undefined' || !window.__TT_EMBED) return;
  const post = (type, data) => {
    try { window.parent.postMessage(Object.assign({ __tt: 1, type }, data || {}), '*'); } catch (e) { /* host gone */ }
  };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const start = () => {
    if (typeof ET !== 'undefined' && window.__TT_LOCALE) ET.set(window.__TT_LOCALE);   // язык от хоста
    const applyStaticTexts = () => { const w = document.getElementById('tIWait'); if (w && typeof ET !== 'undefined') w.textContent = ET('ui.tapContinue'); };
    applyStaticTexts();
    const g = window.__game;
    if (!g) { post('error', { msg: 'game failed to boot' }); return; }
    const ui = g.ui;
    document.documentElement.classList.add('tt-embed');
    const splash = document.getElementById('loading');
    if (splash) splash.classList.add('off');
    g.settings.haptics = false;             // the host owns haptics (Telegram API)
    /* The contact ring is the one piece of UI that teaches timing; having it
     * OFF by default left players guessing ("то рисуется, то не рисуется" =
     * the miss-streak auto-toggle kicking in). Guidance on from ball one. */
    g.hintContact = true;

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
      origCam(dt);
      if (!cine.mode) return;
      cine.t += dt || 0;
      const live = sph(this.camPos, this.camLook);
      const look0 = { x: C.x, y: C.y + 0.05, z: C.z - 0.15 };
      let s, shift = 0;
      if (cine.mode === 'attract') {
        s = lobby   // лобби: стол поднят в кадре выше (под именем игры), взгляд ниже стола
          ? { a: live.a + 1.05 + cine.t * 0.12 * (g.reducedMotion ? 0.2 : 1), r: live.r * 1.55, h: live.h + 1.2, l: { x: C.x, y: C.y - 0.78, z: C.z - 0.1 } }
          : { a: live.a + 1.05 + cine.t * 0.16 * (g.reducedMotion ? 0.2 : 1), r: live.r * 1.28, h: live.h + 0.75, l: look0 };
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
    // Снимок промаха снимается в ближайшем кадре: буфер читается сразу после
    // draw, пока браузер его не очистил, но уже вне обработчика касания.
    wrap(g, 'render', function (orig) {
      const r = orig();
      if (shotQueue) takeShot(shotQueue, false);
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
      if (lobby) return r;
      const p = contactP ? this.project(contactP, {}) : null;
      post('hit', { by: side, rally: this.rally, kmh: Math.round(V3.len(this.ball.v) * 3.6),
        stroke: racket && racket.stroke ? racket.stroke.id : '', sweet: side > 0 ? (this.lastSweet || 0) : 0,
        x: p && p.ok ? p.x : 0.5, y: p && p.ok ? p.y : 0.6 });
      return r;
    });
    wrap(g, '_tryPassiveBlock', function (orig) {
      const ok = orig.apply(null, [].slice.call(arguments, 1));
      if (ok && !lobby) {
        if (att) { att.contact = true; att.sweet = 0.72; flush(); }
        const p = this.ball && this.ball.p ? this.project(this.ball.p, {}) : null;
        post('hit', { by: 1, rally: this.rally, kmh: Math.round(V3.len(this.ball.v) * 3.6),
          stroke: 'BLOCK', sweet: 0.72, x: p && p.ok ? p.x : 0.5, y: p && p.ok ? p.y : 0.6 });
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
    const hostPause = (v) => { hostCmd = true; try { g.setPaused(v); } finally { hostCmd = false; } };
    wrap(g, 'endReplay', function (orig, complete) { const was = this.replayer && this.replayer.on; const r = orig(complete); if (was) post('replayEnd', {}); return r; });
    wrap(g, 'buzz', function (orig, ms) { post('haptic', { kind: Array.isArray(ms) ? 'success' : ms >= 30 ? 'heavy' : 'light' }); });
    if (ui) {
      ui.showMatchEnd = function (won) {
        if (lobby) { setTimeout(() => { if (lobby) g.startDemo(1); }, 2500); return; }
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
      const lastTrain = { key: '' };
      wrap(ui, 'trainSync', function (orig, t) {
        const r = orig(t);
        const S = t.S, key = [t.step, t.done, t.phase, t.frozen, t.nudge > 0, t.coachText].join('|');
        if (key !== lastTrain.key) {
          lastTrain.key = key;
          post('train', { step: t.step, total: TRAIN_STEPS.length, id: S.id, title: ET(S.title), goal: ET(S.goal),
            /* в интро вся информация живёт в большой внутриигровой карточке —
             * шапка хоста её НЕ дублирует */
            text: t.phase === 'intro' ? '' : t.coachText, tip: trainingTip(S, ui.inputMode || 'touch'), done: t.done, need: S.need,
            phase: t.phase, msg: t.msg, frozen: !!t.frozen, nudge: t.nudge > 0, guide: t.guide });
        }
        return r;
      });
      wrap(ui, 'trainDone', function (orig, t) { const r = orig(t); post('trainDone', {}); return r; });
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
    let att = null;
    /* A miss explained in one line, right where the eye already is (the
     * shot pill). Built from the same attempt record the stats use, so the
     * advice and the tuning data never disagree. Drills have their own coach. */
    let tip = null, lastAttemptShot = -1;
    const missTip = (a) => {
      // the gate this attempt was judged by (world-scaled per phone/camera), falling back to the rules
      const ext = a.ext || [MATCH_RULES[a.input === 'mouse' ? 'contactSideMousePx' : 'contactSideTouchPx'], MATCH_RULES.contactBackPx, MATCH_RULES.contactForwardPx];
      const side = ext[0], back = ext[1], fwd = ext[2];
      const lr = a.dx > 0 ? 'правее' : 'левее';
      if (a.reason === 'WRONG_DIRECTION' || a.zoneReason === 'WRONG_DIRECTION')
        return a.dy < 0 ? 'Палец над мячом — веди вниз через мяч или начни под ним' : 'Палец под мячом — веди свайп вверх через мяч';
      if (!a.accepted) {
        if (Number.isFinite(a.dx) && Math.abs(a.dx) > side * 0.8) return `Палец ${lr} мяча — ставь его на линию мяча`;
        if (Number.isFinite(a.dy) && a.dy < -back * 0.8) return 'Слишком высоко — начинай ближе к мячу';
        if (Number.isFinite(a.dy) && a.dy > fwd * 0.8) return 'Слишком низко — начинай ближе к мячу';
        return 'Мимо зоны — ставь палец на линию мяча';
      }
      if (a.reason === 'TIMING_EARLY' || (Number.isFinite(a.lead) && a.lead > 0.2)) return 'Рано! Дождись, пока мяч подлетит к тебе';
      if (a.reason === 'NO_FRESH_SWIPE') return 'Для каждого удара нужен новый тап или свайп';
      if (a.reason === 'STATIC_CLICK') return 'Нажми коротко или проведи через мяч';
      if (Number.isFinite(a.dx) && Math.abs(a.dx) > side * 0.55) return `Ракетка прошла ${lr} — веди свайп прямо через мяч`;
      return 'Свайп быстрее и прямо через мяч';
    };
    // 4.6 s: the point has to be replayed in your head AND the tip read;
// 2.6 s vanished during the very recovery the advice was about.
const showTip = (text) => { if (text) tip = { text, until: g.time + 4.6 }; };
    g.__missTip = () => tip;   // e2e probe
    /* Adaptive assist: three misses in a row with the ring switched off →
     * the ring comes back by itself until two clean contacts, then hides
     * again. The player's own setting is never overwritten. */
    let missStreak = 0, autoHint = false, autoHits = 0;
    const onMiss = () => {
      if (++missStreak >= 3 && !g.hintContact && !g.training) {
        autoHint = true; autoHits = 0; g.hintContact = true; missStreak = 0;
        post('autoHint', { on: true });
        return 'Включил кольцо: веди свайп через него';
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
      att = null;
    };
    wrap(ui, 'syncShotFeedback', function (orig) {
      orig();
      const el = document.getElementById('shot'); if (!el) return;
      const e = g.shotJournal && g.shotJournal.latest;
      if (tip && g.time < tip.until && !g.training && (!e || !e.contact)) {
        document.getElementById('shotName').textContent = 'Совет';
        document.getElementById('shotStatus').textContent = tip.text;
        document.getElementById('shotMeta').textContent = '';
        el.dataset.tone = 'tip'; el.classList.add('on'); ui.shotTimer = Math.max(ui.shotTimer || 0, tip.until - g.time);
      } else if (tip && (g.time >= tip.until || (e && e.contact))) {
        tip = null; if (el.dataset.tone === 'tip') { el.classList.remove('on'); ui._shotEntry = null; }
      }
      if (e && e.contact && !g.training && (e.outcome === 'net' || e.outcome === 'out') && el.classList.contains('on')) {
        const m = document.getElementById('shotMeta');
        const t = e.outcome === 'net' ? 'свайп круче вверх' : 'короче и мягче';
        if (m.textContent !== t) m.textContent = t;
      }
    });
    g.onPressZone = function (z, cp, serving) {
      flush();
      if (lobby || this.demoMode || !z) return;
      lastAttemptShot = this.shotId;
      const incoming = this.state === GS.RALLY && this.ball.live && this.ball.lastHitBy === -1;
      if (!serving && !incoming) return;
      if (this.state === GS.SERVE_READY) return;            // the toss tap is not a stroke
      att = { t: +this.time.toFixed(3), kind: serving ? 'serve' : 'rally', input: z.pointerType || 'touch',
        accepted: !!z.accepted, zoneReason: z.reason || null,
        dx: Number.isFinite(z.pointerX) && Number.isFinite(z.x) ? Math.round(z.pointerX - z.x) : null,
        dy: Number.isFinite(z.pointerY) && Number.isFinite(z.y) ? Math.round(z.pointerY - z.y) : null,
        lead: cp && Number.isFinite(cp.t) ? +cp.t.toFixed(3) : null,
        contact: false, reason: null, sweet: null, training: !!this.training, rules: MATCH_RULES.version,
        // which SETTINGS produced this record (reference px + capture radius) — lets the host compare settings;
        // ext = the gate actually applied on this phone/camera after world scaling, kx = its scale
        sig: [MATCH_RULES[(z.pointerType || 'touch') === 'mouse' ? 'contactSideMousePx' : 'contactSideTouchPx'], MATCH_RULES.contactBackPx, MATCH_RULES.contactForwardPx, MATCH_RULES.captureRadius].map((v) => +(+v).toFixed(2)).join('/'),
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
          gameTime: this.time, gestureId: this.swipe.gestureId, shotId: this.shotId,
          greenAtPress: z.pressContactable, accepted: att.accepted, zoneReason: z.reason,
          dx: att.dx, dy: att.dy });
      } catch (e) {
        missCap.fail(e);
        if (this.debugRecording) this.logInput('calibration_capture', { outcome: {
          id: att.captureId || null, captured: false, error: String(e && e.message || e) } });
      }
      if (att.captureId) armShot(att.captureId);
    };
    wrap(g, 'logPressRejection', function (orig, reason, detail) {
      if (att && !att.reason && !att.contact) att.reason = reason;
      return orig(reason, detail);
    });
    wrap(g, 'applyHit', function (orig, side) {
      const r = orig.apply(null, [].slice.call(arguments, 1));
      if (side > 0 && att) { att.contact = true; att.sweet = +(this.lastSweet || 0).toFixed(2); flush(); }
      return r;
    });
    wrap(g, 'setState', function (orig, st) { if (st !== GS.RALLY && st !== GS.SERVE_TOSS) flush(); return orig(st); });
    wrap(g, 'awardPoint', function (orig, who, reason) {
      if (att && !att.contact && !att.reason) att.reason = 'POINT_' + (who > 0 ? 'WON' : 'LOST');
      const untouched = !att && who < 0 && !lobby && !this.demoMode && !this.training && this.state === GS.RALLY && this.ball && this.ball.lastHitBy === -1
        && Array.isArray(this.rallyBounces) && this.rallyBounces.some((sd) => sd > 0) && lastAttemptShot !== this.shotId;
      flush();
      if (untouched) showTip(onMiss() || 'Мяч пропущен — свайпни снизу вверх через него');
      return orig(who, reason);
    });

    /* ----------------------------- sleep ----------------------------- *
     * The host hides the layer for menus, shop, results… A hidden iframe
     * still gets rAF, so without this the WebGL scene kept rendering at full
     * rate behind every screen — battery, heat and janky host animations.
     * Asleep: no physics, no draw, no HUD; the loop itself costs nothing. */
    let sleeping = false;
    for (const [obj, name] of [[g, 'update'], [g, 'render'], [ui, 'tick']]) {
      wrap(obj, name, function (orig, ...a) { return sleeping ? undefined : orig(...a); });
    }
    const wake = () => { if (sleeping) { sleeping = false; post('awake', {}); } };

    /* ------------------------ lost GPU context ----------------------- *
     * Mobile browsers drop WebGL contexts when the app is backgrounded or
     * memory is tight; without handling, the arena stays black forever.
     * Rebuilding every GL resource in place is fragile, so the game reports
     * what was going on and the host rebuilds the whole iframe and resumes. */
    const glCanvas = document.getElementById('gl');
    if (glCanvas) glCanvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); sleeping = true;
      post('glLost', { state: stateName(g.state), lobby, training: g.training ? g.training.step : null,
        inMatch: !lobby && !g.training && !g.demoMode && [GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY, GS.POINT].includes(g.state),
        score: (g.score || [0, 0]).slice(), server: g.server });
    }, false);

    /* Спокойная «витрина» арены: стол, ракетки на своих местах, мяч лежит
     * на столе, НИЧЕГО не движется, кроме медленной камеры. Автоматч
     * бот-на-бота вырезан: два прыгающих автопилота читались как читеры. */
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

    /* ---------------------------- online ----------------------------
     * В embed-режиме оболочка прячет все экраны движка, поэтому его онлайн-
     * лобби недоступно: управление сетью пришло командами net {}, а статусы
     * уходят хосту одним сообщением 'net' {st, room, side, latency, msg}.
     * Табло движка (#score, #rally) в embed тоже скрыто — на время онлайн-
     * матча включаем классом tt-online, иначе игрок играет вслепую.
     * */
    let netPending = null;                       // код комнаты, ждущий connect
    let netTried = false;                         // игрок хотя бы раз жал «создать/войти»
    const netSay = (st, extra) => post('net', Object.assign({ st }, extra || {}));
    const onlineHud = (on) => { try { document.documentElement.classList.toggle('tt-online', !!on); } catch (e) {} };
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
          netPending = null; netTried = false; onlineHud(false); net.leaveRoom(); net.disconnect(); netSay('closed');
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
        g.inspectSlowmo = false; lobby = false;
        g.settings.targetScore = 11; g.freePlay = false;
        resetAssist(); g.hintContact = false;
        g.startMatch(2);
        if (g.ui) g.ui.syncScore(); // names, zero score and the first server immediately
        onlineHud(true);
        netSay('match', { side: net.side });
      });
      net.on('peerLeft', () => { onlineHud(false); netSay('peerleft'); g.returnToMenu(); });
      net.on('disconnected', () => { onlineHud(false); netSay(netTried ? 'closed' : 'idle'); });
      net.on('error', (msg) => netSay('error', { msg: String(msg && msg.message ? msg.message : msg) }));
    })();

    /* ---------------------------- commands -------------------------- */
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.__tt !== 1) return;
      // only commands that need a visible, running arena wake it; 'attract'/'quit' just set the scene
      // behind a hidden layer (menus, matchmaking) and must not restart full-rate rendering there
      if (!['sleep', 'mute', 'haptics', 'equip', 'quality', 'rm', 'debug', 'hint', 'attract', 'quit', 'quiet', 'pause', 'resume', 'locale', 'missShots'].includes(m.type)) wake();
      switch (m.type) {
        case 'net': netCommand(m); break;
        case 'sleep': sleeping = true; break;      // frozen in place: update is skipped, so nothing advances
        case 'wake': break;
        case 'attract':
          lobby = false;
          if (g.state !== GS.MENU) g.returnToMenu();
          stageIdleArena(); break;
        case 'lobby':                       // тихая витрина: стол и камера, без автоматча
          lobby = true; g.audio.setMuted(true); resetAssist(); g.hintContact = false;
          if (g.state !== GS.MENU) g.returnToMenu();
          stageIdleArena();
          break;
        case 'prematch':
          lobby = false;
          if (g.state !== GS.MENU) g.returnToMenu();
          setCine('prematch', m.dur || 2.0); break;
        case 'match':
          lobby = false;
          g.inspectSlowmo = false;
          g.audio.init(); g.audio.resume();
          if (Number.isFinite(m.target)) g.settings.targetScore = m.target;
          /* Свободная игра: очки и подачи идут, но score не растёт и матч не
           * заканчивается. Флаг снимается при выходе в меню/тренировку. */
          g.freePlay = !!m.free;
          /* Адаптация между матчами от хоста (тренд его последних игр);
           * без неё — своя история результатов.*/
          if (Number.isFinite(m.trend)) g.setAiTrend(m.trend);
          else g.aiTrend = g.trendFromHistory();
          resetAssist(); g.hintContact = !!m.hint;
          g.startMatch(Number.isFinite(m.diff) ? m.diff : g.settings.difficulty);
          if (m.resume && Array.isArray(m.resume.score)) {
            // the engine was rebuilt after a lost GPU context: continue the same match, no fly-in
            const [a, b] = m.resume.score; g.score = [a | 0, b | 0];
            if (m.resume.server === 1 || m.resume.server === -1) g.server = m.resume.server;
            const T = g.settings.targetScore || 11;
            g.servesLeft = (a >= T - 1 && b >= T - 1) ? 1 : 2 - ((a + b) % 2);
            g.prepServe(); cine.mode = null;
          } else if (cine.mode === 'attract') setCine('prematch', 1.2);
          break;
        case 'train':
          lobby = false;
          g.audio.init(); g.audio.resume();
          g.startTraining();
          if (Number.isFinite(m.step) && m.step > 0) g.training.goStep(m.step);
          if (cine.mode === 'attract') setCine('prematch', 1.2);
          break;
        case 'pause': hostPause(true); break;
        case 'resume': hostPause(false); break;
        case 'quit': lobby = false; g.inspectSlowmo = false; g.returnToMenu(); setCine('attract'); break;
        case 'outro': setCine('outro'); break;
        case 'live': cine.mode = null; break;
        case 'replay': if (!g.playBestMoments()) post('replayEnd', {}); break;
        case 'skipReplay': g.skipReplay(); break;
        case 'skipStep': if (g.training) g.training.skip(); break;
        case 'hint': if (!(autoHint && !m.on)) { autoHint = false; g.hintContact = !!m.on; } break;
        /* Тумблер инспекторского слоу-мо из оболочки: разобрать траекторию
         * удара в замедлении. Состояние кнопки в движке догонит syncSlowmoControl. */
        case 'slowmo': if (g.setInspectSlowmo) g.setInspectSlowmo(!!m.on); break;
        case 'missShots': missCap.setEnabled(!!m.on); missCap.setHalf(m.half); break;
        case 'rm': g.reducedMotion = !!m.on || !!(g.motionQuery && g.motionQuery.matches); break;
        case 'debug':
          if (typeof g.setDiagnosticMode === 'function') g.setDiagnosticMode(!!m.on);
          else if (ui) ui.captureDebug = !!m.on;
          break;
        case 'mute': g.settings.sound = !m.on; g.audio.setMuted(!!m.on); break;
        case 'haptics': g.settings.haptics = !!m.on; break;
        case 'equip': applyHostEquip(m.equipped || m); break;
        case 'quality': {
          const q = { high: 'high', mid: 'medium', low: 'low' }[m.q] || 'high';
          g.settings.quality = q; g.R.quality = q; g.resize(); break;
        }
        case 'quiet': document.documentElement.classList.toggle('tt-quiet', !!m.on); break;
        case 'locale': if (typeof ET !== 'undefined') { ET.set(m.lang); applyStaticTexts(); } break;   // язык от хоста
        /* Калибровка из настроек оболочки: 10 личных параметров 0..100.
         * Применяются мгновенно, хранятся у хоста. Не трогают честные
         * правила боя — только комфорт, камеру и визуал. */
        case 'cal': {
          const K = m.k, V = clamp(m.v || 0, 0, 100) / 100;
          g._cal = g._cal || {};
          g._cal[K] = V;
          /* Камера: угол (высота) и зум мапятся на существующие setter'ы
           * игрового движка — они уже зажаты в честные пределы CAM_ADJUST. */
          if (K === 'camHeight' && g.setCamPitch) g.setCamPitch(CAM_ADJUST.pitchMin + V * (CAM_ADJUST.pitchMax - CAM_ADJUST.pitchMin));
          if (K === 'camZoom' && g.setCamZoom) g.setCamZoom(CAM_ADJUST.zoomMin + V * (CAM_ADJUST.zoomMax - CAM_ADJUST.zoomMin));
          if (K === 'camSway') g._swayCal = V;
          /* Закрутка из калибровки оболочки: те же поля настроек, что у
           * ползунков самого движка. Ползунок 0..100 -> множитель физический:
           * сила 0.5..1.6 (нейтраль ~45), чувствительность дуги 0.6..1.8 (~33). */
          if (K === 'spinGain') g.settings.spinGain = 0.5 + V * 1.1;
          if (K === 'arcSens') g.settings.arcSens = 0.6 + V * 1.2;
          /* Свечение стола: слайдер приходил, но движок его не читал — стол
           * оставался одинаковым при любом значении. Эмиссия стола теперь
           * масштабируется, а базовый цвет/текстуру не трогаем. */
          if (K === 'tableGlow' && g.scene && g.scene.mat && g.scene.mat.table) {
            const k = clamp(V, 0, 1);
            g.scene.mat.table = Object.assign({}, g.scene.mat.table, {
              emissive: [0.018 * k, 0.042 * k, 0.10 * k],
            });
          }
          if (K === 'trailLen' || K === 'ballSize' || K === 'padSpeed' || K === 'padSmooth' || K === 'hintRadius' ||
              K === 'hintGlow' || K === 'fingerTrail' || K === 'tossHeight' || K === 'slowmoDepth') { /* читаются напрямую из g._cal */ }
          break;
        }
      }
    });
    post('ready', { rules: Object.assign({}, MATCH_RULES), steps: TRAIN_STEPS.map((s) => ({ id: s.id, title: ET(s.title) })) });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
