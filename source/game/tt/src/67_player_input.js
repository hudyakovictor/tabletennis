/* =====================================================================
 *  PLAYER INPUT CONTROLLER
 *  Изолированная обработка pointer/touch/keyboard ввода и жестов подачи.
 *  Вынесено из монолита 70_game.js для упрощения отладки и поддержки.
 * ===================================================================== */
'use strict';

function bindGameInput(game) {
    const c = game.canvas;
    /* Screen → surface coordinates. A pointer event with a non-finite or
       absurd coordinate (broken touch driver, synthetic event, detached
       canvas with a zero-size rect) used to poison the paddle transform
       permanently: one NaN reached the smoothing filter and the racket
       never came back. Sanitise at the boundary, in one place. */
    const norm = (e) => {
      const r = c.getBoundingClientRect();
      const w = r.width > 0 ? r.width : (c.clientWidth || 1);
      const h = r.height > 0 ? r.height : (c.clientHeight || 1);
      const xr = (e.clientX - r.left) / w;
      const yr = (e.clientY - r.top) / h;
      const x = Number.isFinite(xr) ? clamp(xr, 0, 1) : 0.5;
      const y = Number.isFinite(yr) ? clamp(yr, 0, 1) : 0.5;
      /* Raw gesture coordinates preserve swipe velocity & angle when a fast
       * flick travels past the canvas border, while x/y stay inside 0..1 so
       * the 3D paddle can never park off-screen. */
      const rawX = Number.isFinite(xr) ? clamp(xr, -0.35, 1.35) : x;
      const rawY = Number.isFinite(yr) ? clamp(yr, -0.35, 1.35) : y;
      return { x, y, rawX, rawY };
    };

    // Monotonic hardware-timestamp gesture clock anchored to `game.time` so
    // multi-event bursts within one rAF frame keep true millisecond spacing.
    let _domT0 = null, _gameT0 = 0, _lastEvT = 0;
    const evTime = (e) => {
      const ts = e && Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : null;
      if (ts === null) {
        _lastEvT = Math.max(_lastEvT, game.time);
        return _lastEvT;
      }
      if (_domT0 === null || (!game.swipe.active && !game._playerWork?.held && !game.paddleTrick?.points.length &&
          Math.abs((game.time - _gameT0) - (ts - _domT0) * 0.001) > 0.22)) {
        _domT0 = ts;
        _gameT0 = game.time;
        _lastEvT = game.time;
      }
      const mapped = _gameT0 + Math.max(0, (ts - _domT0) * 0.001);
      _lastEvT = Math.max(_lastEvT, mapped);
      return _lastEvT;
    };
    const evSimTime = (tReal) => game.strokeTime + Math.max(0, tReal - game.time) * (game.timeScale || 1);

    // Primary pointer strikes; right drag and two-finger gestures adjust the view.
    const ptrs = new Map();
    let activeStrokePointerId = null;
    let lastStrokeTimestamp = -Infinity;
    let cameraDrag = null, cameraGesture = null, suppressTouches = false;
    const cameraPair = () => {
      const pair = [...ptrs.values()].slice(0, 2);
      if (pair.length < 2) return null;
      return { y: (pair[0].y + pair[1].y) / 2,
        distance: Math.max(1, Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y)) };
    };
    const cameraAdjust = (pitch, zoom) => {
      const values = {};
      if (Number.isFinite(pitch)) {
        pitch = clamp(pitch, CAM_ADJUST.pitchMin, CAM_ADJUST.pitchMax);
        values.camHeight = 50 + 50 * pitch / (pitch < 0 ? -CAM_ADJUST.pitchMin : CAM_ADJUST.pitchMax);
        applyGameCalibration(game, 'camHeight', values.camHeight);
      }
      if (Number.isFinite(zoom)) {
        zoom = clamp(zoom, CAM_ADJUST.zoomMin, CAM_ADJUST.zoomMax);
        values.camZoom = zoom < 1 ? 50 * (zoom - CAM_ADJUST.zoomMin) / (1 - CAM_ADJUST.zoomMin)
          : 50 + 50 * (zoom - 1) / (CAM_ADJUST.zoomMax - 1);
        applyGameCalibration(game, 'camZoom', values.camZoom);
      }
      if (game.onCameraCalibrationChange) game.onCameraCalibrationChange(values);
    };
    const domEvent = e => ({ type: e.type, pointerId: e.pointerId, pointerType: e.pointerType || null,
      clientX: Number.isFinite(e.clientX) ? e.clientX : null, clientY: Number.isFinite(e.clientY) ? e.clientY : null,
      button: e.button, buttons: e.buttons, pressure: Number.isFinite(e.pressure) ? e.pressure : null,
      width: Number.isFinite(e.width) ? e.width : null, height: Number.isFinite(e.height) ? e.height : null,
      timestamp: Number.isFinite(e.timeStamp) ? e.timeStamp : null,
      receivedAt: typeof performance !== 'undefined' ? performance.now() : null,
      trusted: !!e.isTrusted, cancelable: !!e.cancelable });
    const dropStroke = () => {
      game._cancelPlayerWork();
      activeStrokePointerId = null;
      lastStrokeTimestamp = -Infinity;
      game.swipe.cancel();
      game.pointerDown = false;
    };

    game.cancelInput = (reason = 'unspecified', event = null) => {
      game.cancelPaddleTrick();
      if (game.preview?.active) return;
      game.training?.captureAttemptGesture?.();
      if (game.debugRecording) game.logInput('input_cancel', { dom: event ? domEvent(event) : null,
        outcome: { reason, active: !!game.swipe.active, pointerDown: !!game.pointerDown, pointers: ptrs.size } });
      ptrs.clear(); cameraDrag = cameraGesture = null; suppressTouches = false; dropStroke();
    };
    const down = (e) => {
      game.cancelPaddleTrick();
      if (game.preview?.active) return;
      if (game.paused || game.state === GS.MENU || game.state === GS.MATCH_END) {
        if (game.debugRecording) game.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: game.paused ? 'PAUSED' : 'NON_PLAY_STATE' } });
        return;
      }
      if (e.button === 2) {
        dropStroke(); ptrs.clear(); suppressTouches = false;
        cameraDrag = { id: e.pointerId, y: e.clientY, pitch: game.settings.camPitch || 0 };
        e.preventDefault(); return;
      }
      if (e.button === 1) { e.preventDefault(); return; }
      if (game.demoMode) game.stopDemo(); // a real stroke always takes control
      game.audio.init(); game.audio.resume();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.preventDefault();

      if (game.replayer.on) {
        if (game.debugRecording) game.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'REPLAY_SKIPPED' } });
        game.skipReplay(); return;
      }
      if (ptrs.size >= 2 || suppressTouches) {      // never turn a camera gesture into a stroke
        if (game.debugRecording) game.logInput('input_cancel', { dom: domEvent(e), outcome: { reason: 'SECOND_POINTER', pointers: ptrs.size } });
        dropStroke(); suppressTouches = true;
        const pair = cameraPair();
        cameraGesture = pair && { ...pair, pitch: game.settings.camPitch || 0, zoom: game.settings.camZoom || 1 };
        return;
      }
      const n = norm(e);

      // A preparatory pull-back is reserved for the player's own serve.
      // Rally gestures still use the normal admission and contact pipeline.
      const preparingServe = game.server === 1 &&
        (game.state === GS.SERVE_READY || game.state === GS.SERVE_TOSS);
      if (preparingServe && game.settings.anticipationHint && !game.anticipation.active) {
        const centerX = 0.5;
        const dx = n.x - centerX;
        const dy = n.y - 0.55;
        const mag = Math.hypot(dx, dy) || 0.1;
        if (mag > 0.1) {
          const normX = dx / mag;
          const normY = dy / mag;
          game.anticipation.active = true;
          game.anticipation.t = 0;
          game.anticipation.targetDir = V3.norm(V3.new(),
            V3.new(normX * 0.3, normY * 0.2, 0.5));
          game.anticipation.intensity = clamp(mag * 2, 0.3, 1.0);
          game.anticipation.duration = 0.08 + 0.06 * game.anticipation.intensity;
        }
      }

      activeStrokePointerId = e.pointerId;
      lastStrokeTimestamp = Number.isFinite(e.timeStamp) ? e.timeStamp : -Infinity;
      const tEv = evTime(e), simEv = evSimTime(tEv);
      const pointerType = e.pointerType || (game.pointerFine === false ? 'touch' : 'mouse');
      game.pointer = { x: n.x, y: n.y };
      game.pointerFine = pointerType !== 'touch' && pointerType !== 'pen';

      game.swipe.down(n.rawX, n.rawY, tEv, simEv, c.getBoundingClientRect());
      game._beginPlayerWork(n.rawX, n.rawY, tEv, simEv);
      game.swipe.tapMaxMovePx = 0;
      const rect = c.getBoundingClientRect();
      const serveReadyPress = game.state === GS.SERVE_READY && game.server === 1;
      const servePress = game.state === GS.SERVE_TOSS && game.server === 1;
      const cpGate = (!servePress && !serveReadyPress && MATCH_RULES.zoneAnchor === 'contact')
        ? game.contactPrediction() : null;
      const corridor = (!servePress && !serveReadyPress && MATCH_RULES.zoneAnchor === 'contact')
        ? game.strikeCorridor() : null;

      let ballZone = null;
      if (!servePress && !serveReadyPress && MATCH_RULES.zoneAnchor === 'contact') {
        ballZone = evaluateContactZone(
          corridor,
          game.ball,
          n,
          rect.width,
          rect.height,
          point => game.project(point, {}),
          point => game.contactGateScale(point, rect),
          {
            pointerType,
            frozen: !!(game.training && game.training.frozen),
            referenceWorld: game.player && game.player.pos,
          }
        );
        if (ballZone && ballZone.accepted && ballZone.worldTarget && Number.isFinite(ballZone.worldTarget.z)) {
          game._footZ = clamp(ballZone.worldTarget.z, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);
        }
      } else {
        ballZone = pressZoneForBall(game.ball, n, rect.width, rect.height, {
          project: point => game.project(point, {}), pointerType,
          referenceWorld: game.player && game.player.pos,
          kind: (servePress || serveReadyPress) ? 'serve' : 'rally',
          tossApex: game.tossApex, tossStartY: game.tossStartY, tableY: PH.TABLE_Y,
        });
      }

      game.swipe.pressZone = ballZone || { accepted: false, shape: MATCH_RULES.zoneShape,
        radius: MATCH_RULES.pressRadiusPx, distancePx: null, score: null, along: null,
        across: null, reason: 'OUTSIDE_ZONE', pointerType };

      // Seamless early-serve backswing continuity: if the player begins their
      // serve gesture during SERVE_READY (one-motion toss+strike) or while the
      // toss is still rising towards its apex, arm `pendingServeDrop` when the
      // press is horizontally aligned with the toss column.
      if ((servePress || serveReadyPress) && !game.swipe.pressZone.accepted) {
        const rising = serveReadyPress || (game.ball && game.ball.v && game.ball.v.y >= -0.05);
        if (rising && canArmEarlyServeSwipe(game.project(game.ball.p, {}), n, rect.width, rect.height, pointerType)) {
          game.swipe.pressZone.pendingServeDrop = true;
          game.swipe.pressZone.singleGestureToss = serveReadyPress;
        }
      } else if (!servePress && !serveReadyPress && !game.swipe.pressZone.accepted &&
          game.state === GS.RALLY && corridor && corridor.valid) {
        /* A deep loop/push backswing legitimately starts far below the
         * meeting point (real players begin the swing a foot under the ball).
         * Arm it as a `pendingBackswing` when it starts on the ball's lateral
         * line; it is only ADMITTED later, when the live stroke actually
         * sweeps inside the corridor (`promotePendingRallyBackswing`). */
        const pz0 = game.swipe.pressZone;
        if (Number.isFinite(pz0.across) && Number.isFinite(pz0.along) &&
            Number.isFinite(pz0.sidePx) && Number.isFinite(pz0.fwdPx) &&
            Math.abs(pz0.across) <= pz0.sidePx * 2.6 &&
            pz0.along > pz0.fwdPx && pz0.along <= pz0.fwdPx * 4.5) {
          pz0.pendingBackswing = true;
        }
      }

      game.swipe.pressZone.pressX = n.x; game.swipe.pressZone.pressY = n.y;
      game.swipe.pressZone.vw = rect.width; game.swipe.pressZone.vh = rect.height;
      game.swipe.pressZone.pointerId = e.pointerId;
      game.swipe.pressZone.pointerType = pointerType;
      game.swipe.pressZone.pressT = tEv;
      if (game.debugRecording && Number.isFinite(e.timeStamp)) game.swipe.pressZone.domTimestamp = e.timeStamp;
      game.swipe.pressZone.pressContactable = !!(game._strike && game._strike.on && game._strike.contactable);
      game.swipe.pressZone.shotId = game.shotId;
      game.swipe.pressZone.serving = serveReadyPress || servePress;
      const ballAtPress = game.project(game.ball.p, {});
      game.swipe.pressZone.tapAtPress = game.swipe.pressZone.accepted === true && ballAtPress.ok &&
        Math.hypot((n.x - ballAtPress.x) * rect.width, (n.y - ballAtPress.y) * rect.height) <= CONTACT_CORRIDOR_RULES.tapContactRadiusPx;
      const press = { ...game.swipe.pressZone }, gestureId = game.swipe.gestureId;
      if (game.training && typeof game.training.onPress === 'function') game.training.onPress(press);
      if (!game.swipe.active || game.swipe.gestureId !== gestureId) return;
      if (typeof game.onPressZone === 'function') game.onPressZone(press, cpGate, servePress);
      if (game.shotJournal) {
        const attempt = game.shotJournal.create(gestureId, tEv);
        attempt.pressZone = press;
        const win = attempt.pressZone.serving ? 1.15 : .25;
        attempt.deadline = tEv + win;
        attempt.deadlineSim = simEv + win;
        if (!attempt.pressZone.accepted) attempt.outcome = 'outside';
      }
      game.pointerDown = true;
      game.logInput('pointerdown', { pointer: { x: n.x, y: n.y }, pointerId: e.pointerId, buttons: e.buttons, inputType: pointerType,
        dom: game.debugRecording ? domEvent(e) : null,
        outcome: { greenAtPress: !!press.pressContactable,
          gateAnchor: corridor && corridor.valid ? 'strike_corridor' : (cpGate ? 'predicted_contact' : 'current_ball'),
          predictedEta: cpGate ? cpGate.t : null } });
      if (game.debugRecording) game._debugLastPress = { shotId: game.shotId, gestureId: game.swipe.gestureId,
        green: !!press.pressContactable, accepted: !!press.accepted, time: tEv };
      if (serveReadyPress) game.startToss();
    };

    const track = (e) => {
      const n = norm(e);
      game.pointer = { x: n.x, y: n.y };
      const tEv = evTime(e);
      if (e.pointerType) game.pointerFine = e.pointerType !== 'touch' && e.pointerType !== 'pen';
      if (e.pointerType === 'mouse') {
        game.mouseTrail = (game.mouseTrail || []).filter(p => tEv - p.t < 0.14);
        game.mouseTrail.push({ x: n.x, y: n.y, t: tEv });
        if (game.mouseTrail.length > 64) game.mouseTrail.shift();
      }
      game.pointerInside = n.x > 0.001 && n.x < 0.999 && n.y > 0.001 && n.y < 0.999;
      return n;
    };

    const move = (e) => {
      if (game.preview?.active) return;
      if (cameraDrag && e.pointerId === cameraDrag.id) {
        cameraAdjust(cameraDrag.pitch - (e.clientY - cameraDrag.y) * .08, null);
        if (e.cancelable) e.preventDefault(); return;
      }
      const p = ptrs.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (suppressTouches) {
        const pair = cameraPair();
        if (pair && cameraGesture) cameraAdjust(cameraGesture.pitch - (pair.y - cameraGesture.y) * .08,
          cameraGesture.zoom * pair.distance / cameraGesture.distance);
        if (e.cancelable) e.preventDefault(); return;
      }
      if (activeStrokePointerId !== null && e.pointerId !== activeStrokePointerId) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      if ((game.swipe.active || game._playerWork?.held) && ptrs.size < 2) {
        const z = game.swipe.pressZone;
        let samples = [];
        if (typeof e.getCoalescedEvents === 'function') {
          try { samples = e.getCoalescedEvents() || []; } catch (_) { samples = []; }
        }
        // Resolve each available prefix, just as separate hardware events do.
        // A later curve must never relabel a contact already made by its straight leg.
        let n;
        for (const sample of [...samples, e]) {
          if (Number.isFinite(sample.pointerId) && sample.pointerId !== e.pointerId) continue;
          // Check the original clock before evTime clamps pre-start times to zero.
          if (Number.isFinite(sample.timeStamp)) {
            if (sample.timeStamp < lastStrokeTimestamp) continue;
            lastStrokeTimestamp = sample.timeStamp;
          } else if (sample !== e) continue;
          const tEv = evTime(sample), simEv = evSimTime(tEv);
          const latest = Math.max(game.swipe.samples.at(-1)?.t ?? -Infinity, game._playerWork?.lastTime ?? -Infinity);
          if (tEv < latest) continue;
          n = track(sample);
          if (z) game.swipe.tapMaxMovePx = Math.max(game.swipe.tapMaxMovePx || 0,
            Math.hypot((n.rawX - z.pressX) * z.vw, (n.rawY - z.pressY) * z.vh));
          game.swipe.move(n.rawX, n.rawY, tEv, simEv);
          game._samplePlayerWork(n.rawX, n.rawY, tEv, simEv);
          game.promotePendingServeZone();
          game.promotePendingRallyBackswing(n);
          game.tryInputHit(game.swipe.m);
        }
        if (!n) { if (e.cancelable) e.preventDefault(); return; }
        game.logInput('pointermove', { pointer: { x: n.x, y: n.y }, pointerId: e.pointerId, buttons: e.buttons,
          inputType: e.pointerType || (game.pointerFine === false ? 'touch' : 'mouse'),
          dom: game.debugRecording ? domEvent(e) : null });
      } else {
        let samples = [];
        if (e.pointerType === 'mouse' && typeof e.getCoalescedEvents === 'function') {
          try { samples = e.getCoalescedEvents() || []; } catch (_) { samples = []; }
        }
        for (const sample of [...samples, e]) {
          if (Number.isFinite(sample.pointerId) && sample.pointerId !== e.pointerId) continue;
          const point = track(sample);
          if (e.pointerType === 'mouse') game.observePaddleTrick(point, evTime(sample), !e.buttons && !sample.buttons);
          else game.cancelPaddleTrick();
        }
      }
      if (e.cancelable) e.preventDefault();
    };

    const up = (e) => {
      if (game.preview?.active) return;
      if (cameraDrag && cameraDrag.id === e.pointerId) { cameraDrag = null; e.preventDefault(); return; }
      ptrs.delete(e.pointerId);
      if (suppressTouches) {
        cameraGesture = null;
        if (!ptrs.size) suppressTouches = false;
        e.preventDefault(); return;
      }
      if (e.button === 2 || e.button === 1) {
        e.preventDefault();
        return;
      }
      if (activeStrokePointerId !== null && e.pointerId !== activeStrokePointerId) {
        if (game.debugRecording) game.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'NON_OWNER_POINTER_RELEASE' } });
        e.preventDefault(); return;
      }
      if (ptrs.size >= 1) {
        if (game.debugRecording) game.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'OTHER_POINTER_STILL_DOWN' } });
        e.preventDefault(); return;
      }
      if (!game.swipe.active) {
        const n = norm(e), tEv = evTime(e);
        game.pointer = { x: n.x, y: n.y };
        game._samplePlayerWork(n.rawX, n.rawY, tEv, evSimTime(tEv), true);
        activeStrokePointerId = null;
        if (game.debugRecording) game.logInput('pointer_ignored', { dom: domEvent(e), outcome: { reason: 'RELEASE_WITHOUT_ACTIVE_PRESS' } });
        game.pointerDown = false; return;
      }
      activeStrokePointerId = null;
      const n = norm(e);
      const tEv = evTime(e), simEv = evSimTime(tEv);
      game.pointer = { x: n.x, y: n.y };
      const sw = game.swipe, zone = sw.pressZone;
      if (zone) sw.tapMaxMovePx = Math.max(sw.tapMaxMovePx || 0,
        Math.hypot((n.rawX - zone.pressX) * zone.vw, (n.rawY - zone.pressY) * zone.vh));
      game.promotePendingServeZone();
      sw.up(n.rawX, n.rawY, tEv, simEv);
      game.promotePendingRallyBackswing(n);
      // Only a stationary toss tap is disarmed. A completed early serve swipe
      // must survive release and meet the ball when the toss starts falling.
      if (zone && zone.singleGestureToss && !isRealStroke(sw.lastReleased, true)) {
        zone.pendingServeDrop = false;
      }
      game.pointerDown = false;
      game.swipeReleasedAt = tEv;
      const tapSlop = zone && zone.pointerType === 'mouse' ? 10 : 14;
      const flickMax = CONTACT_CORRIDOR_RULES.compactFlickMaxPx;
      const rallyTap = game.state === GS.RALLY && game.ball.live && game.ball.lastHitBy === -1;
      const serveTap = zone && zone.serving && !zone.singleGestureToss &&
        game.state === GS.SERVE_TOSS && game.server === 1 && game.ball.live && game.ball.lastHitBy === 0 &&
        game.ball.v.y < 0 && game.tossRiseNow() >= MATCH_RULES.serveTossMinRise - 1e-6;
      const tapAge = serveTap && Number.isFinite(simEv) && Number.isFinite(sw.startSimTime)
        ? simEv - sw.startSimTime : tEv - sw.startT;
      if (zone && zone.shotId === game.shotId && (rallyTap || serveTap) &&
          tapAge >= 0 && tapAge <= CONTACT_CORRIDOR_RULES.compactFlickMaxSec &&
          !isRealStroke(sw.lastReleased, !!serveTap)) {
        if (sw.tapMaxMovePx <= tapSlop) {
          sw.lastReleased = tapStrokeMetrics(sw.lastReleased, zone.pressX, zone.pressY, !!serveTap);
        } else if (!zone.serving && zone.accepted && sw.tapMaxMovePx <= flickMax) {
          sw.lastReleased = compactStrokeMetrics(sw.lastReleased, n.x, n.y);
        }
      }
      game._samplePlayerWork(n.rawX, n.rawY, tEv, simEv, true, sw.lastReleased);
      game.updateShotDiagnostics();
      game.logSwipeRelease({ pointer: { x: n.x, y: n.y }, pointerId: e.pointerId, buttons: e.buttons,
        inputType: e.pointerType || (game.pointerFine === false ? 'touch' : 'mouse'),
        dom: game.debugRecording ? domEvent(e) : null });
      game.lastSwipeT = tEv;
      game.tryInputHit(sw.lastReleased);
      e.preventDefault();
    };

    c.addEventListener('pointerdown', (e) => {
      /* A synthetic or already-released pointer has no capture target, and
       * setPointerCapture throws for it — which used to abort the whole
       * handler, so the press never became a stroke. */
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer */ }
      down(e);
    });
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => {
      if (activeStrokePointerId !== null && e.pointerId !== activeStrokePointerId) { ptrs.delete(e.pointerId); return; }
      game.cancelInput('pointercancel', e);
    });
    c.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId) || cameraDrag && cameraDrag.id === e.pointerId) game.cancelInput('lostpointercapture', e); });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerleave', () => game.cancelPaddleTrick());
    // Hover movement follows the bat. A held right button is not a camera command.
    window.addEventListener('pointermove', (e) => {
      if (game.preview?.active || e.target === c) return;
      if (ptrs.has(e.pointerId) || cameraDrag && cameraDrag.id === e.pointerId) move(e);
      else if (!ptrs.size && !game.swipe.active) { game.cancelPaddleTrick(); track(e); }
    });
    window.addEventListener('pointerup', (e) => { if (ptrs.has(e.pointerId) || cameraDrag && cameraDrag.id === e.pointerId) up(e); });
    window.addEventListener('blur', () => { game.cancelInput('window_blur'); game.setPaused(true); });
    document.addEventListener('visibilitychange', () => {
      if (game.debugRecording) game.logInput('visibility', { outcome: { state: document.visibilityState } });
      if (document.hidden || document.visibilityState === 'hidden') { game.cancelInput('document_hidden'); game.setPaused(true); game.profile.save(true); }
    });
    window.addEventListener('pagehide', (e) => {
      game.cancelPaddleTrick();
      if (game.debugRecording) game.logInput('pagehide', { outcome: { persisted: !!e.persisted } });
      if (game.debugArchive) game.debugArchive.flush();
      game.profile.save(true); game.career.save();
    });
    c.addEventListener('wheel', (e) => {
      if (game.preview?.active || game.paused) return;
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? c.clientHeight : 1);
      cameraAdjust(null, (game.settings.camZoom || 1) * Math.exp(-clamp(delta, -500, 500) * .001));
      e.preventDefault();
    }, { passive: false });
    c.style.touchAction = 'none';

    /* Keep vertical gestures in the mini app when Telegram supports the API;
     * retain the DOM fallback for older Telegram clients and embedded webviews. */
    try {
      const tg = window.Telegram && window.Telegram.WebApp;
      if (tg && typeof tg.setupSwipeBehavior === 'function') {
        tg.setupSwipeBehavior({ allow_vertical_swipe: false });
      }
    } catch (e) { console.debug('Telegram swipe behavior unavailable', e); }
    document.addEventListener('touchmove', (e) => {
      if (game.preview?.active) return;
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    /* Prevent iOS rubber-banding / pull-to-refresh on the body. */
    document.body.style.overscrollBehavior = 'none';
    document.documentElement.style.overscrollBehavior = 'none';

    window.addEventListener('keydown', (e) => {
      if (game.preview?.active) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey ||
          (e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)))) return;
      if (e.key === 'r' || e.key === 'R' || e.key === 'к' || e.key === 'К') game.restart();
      if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') game.setPaused(!game.paused);
      if (e.key === 'F3') { game.settings.showDebug = !game.settings.showDebug; e.preventDefault(); }
      if (e.key === 'c' || e.key === 'C' || e.key === 'с' || e.key === 'С') { game.camReset(); e.preventDefault(); }
      if (e.key >= '1' && e.key <= '3') {
        game.setCameraPreset(CAMERA_ORDER[+e.key - 1]); e.preventDefault();
      }
      if (e.key === '0' || e.key === ')') { game.setCameraPreset(CAMERA_ORDER[0]); e.preventDefault(); }
    });
}
