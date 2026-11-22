/* =====================================================================
 *  GAME LOOP
 *  Изолированный главный цикл обновления матча (updateGameLoop).
 *  Вынесено из монолита 70_game.js для упрощения отладки и поддержки.
 * ===================================================================== */
'use strict';

function updateGameLoop(game, dtReal) {
    if (game.preview?.active) return;
    game.training?.refreshHelp?.();
    if (game.paused || (typeof document !== 'undefined' && document.hidden)) return;
    if (!Number.isFinite(dtReal) || dtReal <= 0) return;
    dtReal = Math.min(dtReal, 0.1);
    if (game.state === GS.MENU) {
      game.lobbyScene?.update(dtReal);
      game.updateCamera(dtReal);
      game.profile.maybeSave(dtReal);
      return;
    }
    /* ---- the coach is holding the ball in mid-air: the world stops, the
       bat still follows the finger so the pupil can line it up ---- */
    if (game.training && game.training.frozen) {
      game.training.update(dtReal, 0);
      game.updatePlayerPaddle(dtReal);
      game.updateCamera(dtReal);
      return;
    }
    game.frame++;
    /* ---- a replay owns the whole update: physics is off, the clip is
       the truth, and the camera is a filmmaker rather than a spectator ---- */
    if (game.replayer.on) {
      game.time += dtReal;
      game.replayer.update(dtReal, game);
      game.particles.update(dtReal);
      game.updateCameraReplay(dtReal);
      return;
    }
    game.time += dtReal;
    game.stateT += dtReal;
    game._hudElapsed = (game._hudElapsed || 0) + dtReal;
    const policyKey = [game.sessionKind, game.training?.stage, game.career?.active, game.network.isInMatch].join('|');
    if (policyKey !== game._calPolicyKey && typeof refreshGameCalibrationPolicy === 'function') {
      game._calPolicyKey = policyKey; refreshGameCalibrationPolicy(game);
    }
    if (game.slowmoUntil && game.time > game.slowmoUntil) { game.targetTimeScale = 1; game.slowmoUntil = 0; }
    game.updateSlowmo(dtReal);
    // Normal play always runs at real time; only an explicit slow-motion
    // effect may reduce it. Legacy flytime preferences cannot accelerate it.
    const inspectorActive = game.inspectSlowmo && game.slowmo.allowed;
    const requestedScale = game.training?.adaptive ? game.training.tutorialScale
      : inspectorActive || game.slowmo.active || game.slowmoUntil ? game.targetTimeScale : 1;
    const targetScale = clamp(Number.isFinite(requestedScale) ? requestedScale : 1, 0.1, 1);
    game.timeScale = typeof gameplayCalibrationLocked === 'function' && gameplayCalibrationLocked(game)
      ? 1 : game.training?.adaptive ? targetScale
        : clamp(expSmooth(Number.isFinite(game.timeScale) ? game.timeScale : 1, targetScale, 9, dtReal), 0.1, 1);
    const dt = dtReal * game.timeScale;
    game.strokeTime += dt;
    game.stateSimT = (game.stateSimT || 0) + dt;
    game.training?.beginRecordingFrame?.(dtReal, dt);

    if (game.demoMode && !game.paused) {
      game.updateDemoPlayer(dtReal);
    }

    game.updateShotDiagnostics();
    game._expireSwingWork();

    // state machine
    switch (game.state) {
      case GS.SERVE_READY:
        if (game.server === -1) {
          /* сначала бот ВЫХОДИТ в позицию подачи. Раньше мяч парковался у
           * ракетки там, куда бот дотянулся в прошлом розыгрыше (край стола,
           * под самой сеткой) — и подача летела из того же угла */
          {
            const toss = STROKE_CONFIG.serve.toss;
            const tx = clamp(game.aiServeX || 0, -toss.aiReadyXMax, toss.aiReadyXMax);
            const tz = -(PH.T_HALF_LEN + toss.aiEndMargin);
            const k = 1 - Math.exp(-toss.aiApproachRate * dt);
            game.ai.pos.x += (tx - game.ai.pos.x) * k;
            game.ai.pos.z += (tz - game.ai.pos.z) * k;
            game.ai.pos.x = clamp(game.ai.pos.x, -toss.aiPositionXMax, toss.aiPositionXMax);
            if (game.ai.pos.z > -toss.aiZMin) game.ai.pos.z = -toss.aiZMin;
            game.ai.pos.y = PH.TABLE_Y + toss.aiPaddleHeight;
          }
          /* park the ball in front of the AI's OWN bat every frame — a serve
           * tossed 25 cm away from the paddle reads as ball and racket living
           * in different worlds */
          V3.set(game.ball.p, game.ai.pos.x,
            PH.TABLE_Y + STROKE_CONFIG.serve.toss.height,
            clamp(game.ai.pos.z + STROKE_CONFIG.serve.toss.aiPaddleZOffset,
              -(PH.T_HALF_LEN + STROKE_CONFIG.serve.toss.aiFarMargin), -STROKE_CONFIG.serve.toss.aiNearZ));
          game.aiServeTimer -= dt;
          if (game.aiServeTimer <= 0) {
            const toss = STROKE_CONFIG.serve.toss;
            V3.set(game.ball.v, rndSym(toss.aiLateralJitter), toss.aiSpeed, rndSym(toss.aiLateralJitter));
            game.ball.live = true;
            game.isServeBall = true;
            game.setState(GS.SERVE_TOSS);
            game.aiSwingAt = game.strokeTime + toss.aiSwingDelay;
          }
        } else {
          game.serveHint = clamp(game.serveHint + dtReal, 0, 3);
          parkServeBall(game.ball.p, game.player, game.settings.hand);
        }
        break;
      case GS.SERVE_TOSS:
        /* The opponent strikes at a HEIGHT, not at a deadline. `aiSwingAt`
         * is real seconds while the ball integrates scaled seconds, so under
         * slow-mo a fixed deadline met the ball 10-20 cm lower than intended
         * and every slowed-down serve came out a different serve. The height
         * is also what makes a fast serve geometrically possible: from 0.61 m
         * above the table even a full-speed flat swing cannot bounce on the
         * server's own half, so the solver used to halve it (measured: the
         * fast serve left the bat at 24 km/h at swing scale 0.50). At 0.36 m
         * on the way down it is a real serve. */
        if (game.server === -1 && game.ball.lastHitBy === 0 && game.stateSimT > STROKE_CONFIG.serve.toss.aiContactDelay &&
          ((game.ball.v.y < 0 && game.ball.p.y <= PH.TABLE_Y + STROKE_CONFIG.serve.toss.aiContactHeight) ||
            game.strokeTime > game.aiSwingAt + STROKE_CONFIG.serve.toss.aiTimeout)) {
          const racket = enforceRacketEffort(game.ai.serve(game));
          const contact = V3.clone(game.ball.p);
          const contactPose = racket && paddleContactPose(contact, racket, { hand: 'right', grip: 'shakehand', forehand: racket.forehand, roll: game.aiPaddle.roll });
          const launch = racket && resolveRacketLaunch(game.ball, racket);
          if (!racket || racket.valid === false || !contactPose || !launch || !strokeIdentityMatches(racket, launch)) {
            game.logInput('decision', { outcome: { reason: 'BOT_SERVE_RETRY',
              detail: racket?.invalidReason || (!contactPose ? 'geometry' : !launch ? 'separating' : 'spin') } });
            game.ball.live = false; game.aiServeTimer = .25; game.setState(GS.SERVE_READY);
            break;
          }
          const request = racket.effortRequest || { strokeId: racket.stroke.id, effort: 0 };
          game._aiWork = { side: -1, swingId: ++game._swingId, shotId: game.shotId, rallyId: game._rallyId,
            paid: Stamina.cost(request), request, budget: racket.effortBudget };
          game._chargeStamina(-1, game._aiWork.paid);
          game._preHit = { v: V3.clone(game.ball.v), w: V3.clone(game.ball.w) };
          const info = launch.info;
          if (game.watchdog) game.watchdog.contact({ time: game.time, side: -1, serve: true,
            contact, pad: contactPose, padBefore: game.aiPaddle.pos, racket,
            aiLevel: game.ai ? game.ai.levelIndex : null });
          V3.copy(game.aiPaddle.pos, contactPose.pos); V3.copy(game.ai.pos, contactPose.pos);
          V3.copy(game.aiPaddle.normal, racket.normal);
          game.aiPaddle.q = Q.copy(game.aiPaddle.q || Q.new(), contactPose.q);
          game.aiPaddle.roll = contactPose.roll; game.aiPaddle.contactPose = contactPose; game.aiPaddle.poseReady = true;
          game.aiPaddleMotion = game.aiPaddleMotion || new PaddleStrokeMotion();
          game.aiPaddleMotion.contact(racket.normal, contactPose.roll, racket.stroke.id, 'shakehand', 'right',
            racket.forehand !== false, true, { pose: contactPose, racket, side: -1 });
          V3.copy(game.ball.p, launch.p); V3.copy(game.ball.v, launch.v); V3.copy(game.ball.w, launch.w);
          game.serveBounces = 0; game.rallyBounces.length = 0;
          game.applyHit(-1, racket, contact, racket.quality, info);
          game.setState(GS.RALLY);
        }
        if (game.server === 1 && game.ball.lastHitBy === 0) {
          game.tossApex = Math.max(game.tossApex || 0, game.ball.p.y);
          if (game.stateSimT > STROKE_CONFIG.serve.toss.timeout) game.awardPoint(-1, 'ПОДАЧА НЕ ВЫПОЛНЕНА');
        }
        break;
      case GS.POINT:
        if (game.matchWinner && game.stateT > 1.35) {
          game.setState(GS.MATCH_END);
          game.audio.gameOver(game.matchWinner > 0);
          game.settleMatch();
          game.ui && game.ui.showMatchEnd(game.matchWinner > 0);
          // career progression over the results screen
          if (game.career.active) {
            game.career.onMatchEnd(game.matchWinner);
            game.career.save();
          }
        } else if (game.stateT > 1.35) {
          game.rally = 0;
          game.prepServe();
        }
        break;
    }
    /* Move the player's paddle BEFORE the ball. The capture test used to run
     * against the previous frame's pose (the paddle was updated after the
     * substeps), so a bat that had visibly arrived was still a frame behind
     * for the contact — 0.1-0.2 m at a normal swipe speed. */
    game.updatePlayerPaddle(dtReal, dt);
    game.watchdogArmFrame();
    // A point reached inside the physics loop starts moving on the next frame.
    game.advancePointBall(dt);

    // physics substeps
    if (game.ball.live) {
      game._acc += dt;
      let guard = 0;
      /* How many physics steps game frame will take, so the paddle's own
       * frame-long travel can be split into exactly that many poses. */
      const nSub = Math.max(1, Math.min(400, Math.floor(game._acc / PHYS_DT + 1e-9)));
      game._subK = 0; game._subN = nSub;
      while (game._acc >= PHYS_DT && guard++ < 400) {
        game._subPad = game.substepPadPose(game._subK++, nSub);
        game._trainingSubFraction = game._subK / nSub;
        game._advanceStamina(PHYS_DT);
        game.stepPhysics(PHYS_DT);
        game._acc -= PHYS_DT;
        if (!game.ball.live) break;
      }
      game._subPad = null;
      game._trainingSubFraction = null;
      game.recordBallTrail();
    } else game._acc = 0;

    game.updateStrikeWindow(dtReal);
    game.logInput('frame', { dt: dtReal });
    if (game.state === GS.RALLY || game.state === GS.SERVE_TOSS) game.moments.push(game.time, game);
    if (game.training) {
      game.training.update(dtReal, dt);
      if (game.training.allowAi) game.ai.think(game, dt);
    }
    else if (game.network.isInMatch) {
      // online: the far paddle belongs to the peer, not to the AI
      const op = game.network.opponentRacket;
      V3.copy(game.aiPaddle.pos, op.pos);
      V3.copy(game.aiPaddle.normal, op.normal);
    }
    else game.ai.think(game, dt);
    game.updateOpponentPose(dt);
    game.tryAiHit();
    game._syncMatchHud();
    game.watchdogFrame(dtReal);
    game.particles.update(dt, dtReal);
    for (const m of game.marks) m.t += dtReal;
    while (game.marks.length && game.marks[0].t > game.marks[0].life) game.marks.shift();
    for (const m of game.messages) m.t += dtReal;
    while (game.messages.length && game.messages[0].t > game.messages[0].dur) game.messages.shift();
    game.hitFlash = Math.max(0, game.hitFlash - dtReal * 3.2);
    game.ageContactFlashes(game.time);

    // Only the timer advances here. Position and orientation each have one
    // owner in updatePlayerPaddle / PaddleStrokeMotion, before rendering.
    if (game.followThrough.active) {
      game.followThrough.t += dtReal;
      if (game.followThrough.t >= game.followThrough.duration) game.followThrough.active = false;
    }

    // Anticipation must never carry a serve pull-back into a rally.
    const serveAnticipation = game.server === 1 &&
      (game.state === GS.SERVE_READY || game.state === GS.SERVE_TOSS);
    if (!serveAnticipation || !game.settings.anticipationHint) {
      game.anticipation.active = false;
      V3.zero(game.anticipation.visualOffset);
    } else {
      if (game.anticipation.active) {
        game.anticipation.t += dtReal;
        const progress = game.anticipation.t / game.anticipation.duration;
        if (progress >= 1) {
          game.anticipation.active = false;
        } else {
          // Backswing pull-back — pulls paddle opposite to swipe direction
          const pullAmount = Math.sin(progress * Math.PI) * game.anticipation.intensity * 0.12;
          const offset = V3.mul(V3.new(), game.anticipation.targetDir, -pullAmount);
          V3.copy(game.anticipation.visualOffset, offset);
        }
      } else {
        V3.zero(game.anticipation.visualOffset);
      }
    }

    // Update spin indicator
    if (game.settings.showSpinIndicator && game.ball.live) {
      game.spinIndicator.active = true;
      V3.copy(game.spinIndicator.w, game.ball.w);
      const spinMag = V3.len(game.ball.w);
      if (spinMag > 50) {
        // Color based on spin type relative to ball flight direction:
        // topspin = orange, backspin = blue-cyan, right/left sidespin = green/violet
        const travelSign = game.ball.v.z < 0 ? 1 : -1;
        const topSigned = -travelSign * game.ball.w.x;
        if (Math.abs(game.ball.w.x) > Math.abs(game.ball.w.y)) {
          game.spinIndicator.color = topSigned > 0 ? [1, 0.52, 0.12] : [0.22, 0.68, 1];
        } else {
          game.spinIndicator.color = game.ball.w.y > 0 ? [0.1, 0.85, 0.45] : [0.78, 0.35, 1];
        }
      } else {
        game.spinIndicator.color = [0.8, 0.8, 0.8];
      }
    } else {
      game.spinIndicator.active = false;
    }

    // Update momentum (once per scored point, never per animation frame)
    if (game.settings.momentumBar) {
      const ptSeq = game.lastPoint ? (game.lastPoint.seq || game.lastPoint.at || 1) : 0;
      if (ptSeq && ptSeq !== game._momentumSeenSeq) {
        game._momentumSeenSeq = ptSeq;
        if (game.lastPoint.who > 0) {
          game.momentum.streak++;
          game.momentum.target = Math.min(1, game.momentum.streak / 5);
        } else if (game.lastPoint.who < 0) {
          game.momentum.streak = 0;
          game.momentum.target = 0;
        }
      }
      game.momentum.current = expSmooth(game.momentum.current, game.momentum.target, 3, dtReal);
    }

    if (game.profile) {
      game.profile.data.stats.minutes += dtReal / 60;
      game.profile.maybeSave(dtReal);
    }
    game.updateCamera(dtReal);
    game.keepPaddleOnScreen();
    game.clampPaddleVolume();
    game.training?.captureRecordingFrame?.();

    // post-processing: оставлен только тонмап/виньетка. Радиальное «мыло»
    // и хроматический аберрационный сдвиг убраны совсем: они размывали и
    // расщепляли на цветные копии именно мяч в точке удара.
    const P = game.R.post;
    P.radial = 0; P.ca = 0;
    P.flash = game.reducedMotion ? 0 : expSmooth(P.flash, game.hitFlash * 0.03, 10, dtReal);
    P.sat = expSmooth(P.sat, 1.05 + (1 - game.timeScale) * 0.25, 4, dtReal);
    game.audio.setCrowd(clamp(game.rally / 18, 0, 1) * 0.6 + (game.state === GS.POINT ? 0.4 : 0));

    // network: sync state (host) or input (guest)
    if (game.network.isInMatch) {
      if (game.network.isHost) game.network.sendGameState();
      else game.network.sendInput();
    }
    // fps
    game._fpsN++; game._fpsT += dtReal;
    if (game._fpsT > 0.5) { game.fps = game._fpsN / game._fpsT; game._fpsT = 0; game._fpsN = 0; }

    // Update music system — dynamic soundtrack based on game state
    if (game.music && game.music._initialized) {
      game.music.update({
        state: game.state,
        rally: game.rally,
        ball: game.ball,
        settings: game.settings,
        momentum: game.momentum,
        lastPoint: game.lastPoint,
      });
    }

    // Update emotional system — dramatic moments and arc
    if (game.emotion) {
      game.emotion.update(game);
    }

}

function stepGamePhysics(game, dt) {
    const b = game.ball;
    if (game._cordForgiveUntil && game.time >= game._cordForgiveUntil) game.clearCordCaptureBoost();
    if (!b.live) return;
    // a ball that has run out of energy settles instead of micro-bouncing
    if (b.p.y - PH.R <= PH.TABLE_Y + 0.004 && Math.abs(b.v.y) < 0.30 &&
      Math.abs(b.p.x) <= PH.T_HALF_WID && Math.abs(b.p.z) <= PH.T_HALF_LEN) {
      b.restT = (b.restT || 0) + dt;
      if (b.restT > 0.9 || V3.len(b.v) < 0.45) {
        if (game.state === GS.POINT || game.state === GS.MATCH_END) { b.live = false; return; }
        /* The ball came to rest ON the table during a rally. Nothing else
         * would ever resolve it: no bounce, no floor, no point — the rally
         * hung with a motionless ball until the player left the match.
         * `restT` (0.9 s of sitting on the table), not the instantaneous
         * speed: a short ball still trickling at 0.3 m/s is a ball the
         * player can and should be able to run in and flick, and the old
         * speed test killed exactly those. */
        if ((game.state === GS.RALLY || game.state === GS.SERVE_TOSS) && b.restT > 0.9) { game.settleDeadBall(); return; }
      }
    } else b.restT = 0;
    const p0 = V3.clone(b.p);

    integrateBall(b.p, b.v, b.w, dt);
    Q.integrate(b.q, b.q, spinVisualRate(b.w, game._spinVis || (game._spinVis = V3.new())), dt);
    b.speed = V3.len(b.v);

    /* --- table --- */
    /* tableContact() is the same function predict() runs: it rejects a ball
     * that was already below the surface at the start of the step and it
     * returns the INTERPOLATED touch point, not the end of the step. At
     * 30 m/s the end of a 1/600 s step is 5 cm past the line, which is how a
     * ball that landed inside the line got recorded outside it. */
    if (b.v.y < 0) {
      const tb = tableContact(p0.x, p0.y, p0.z, b.p.x, b.p.y, b.p.z, game._tabHit || (game._tabHit = { x: 0, y: 0, z: 0 }));
      if (tb) {
        const sp = -b.v.y;
        b.p.x = tb.x; b.p.y = tb.y + 1e-5; b.p.z = tb.z;
        /* The white line is physics now (bounceTable tilts the contact normal
         * outward and takes a third of the restitution off). The old handler
         * did its own thing on top of it — v.y *= 0.45 and rndSym(1.2) m/s of
         * sideways velocity — so the effect was applied twice and, worse, the
         * same shot gave a different answer every time. An edge ball should be
         * unreadable for the RECEIVER, not random for the game. */
        const info = bounceTable(b.p, b.v, b.w);
        if (info && info.edge > 0.25) {
          // Only the feedback is rate-limited here. bounceTable already
          // resolves the contact; adding a private lift/displacement changed
          // the live trajectory without changing the AI/solver prediction.
          if (game.time - (game._edgeFxT || -9) > 0.45) {
            game._edgeFxT = game.time;
            game.msg(info.edgeAxis === 'x' ? 'РЕБРО СТОЛА!' : 'ЗАДНЯЯ КРОМКА!', 1.0, '#ffd34d');
            game.shakeIt(0.10 + 0.16 * info.edge, V3.new(0, 1, 0));
            game.stats.edgeBalls = (game.stats.edgeBalls || 0) + 1;
          }
        }
        game.onBounce(Math.sign(b.p.z) || 1, sp, info);
      }
    }

    /* --- net --- */
    /* netContactStep() is the same model predict() and every solver use:
     * 0 clean, 1 mesh, 2 white tape. A ball whose whole body is under the
     * table passes BENEATH the net — the plane used to reflect it, so a ball
     * that had already fallen off the table bounced off an invisible wall. */
    const nk = netContactStep(p0.x, p0.y, p0.z, b.p.x, b.p.y, b.p.z,
      game._netHit || (game._netHit = { x: 0, y: 0, z: 0 }));
    if (nk > 0) {
      const nh = game._netHit;
      if (nk === 2) {
        clipTape(b.p, b.v, b.w);
        game.audio.hitNet();
        game.msg('КАСАНИЕ ШНУРА', 1.1, '#ffd34d');
        game.emitParticles(nh.x, PH.NET_TOP, 0, 8, 1.1, 0.3, 0.014, 1, 0.9, 0.5);
        game.netTouched = true;
        if (b.lastHitBy === 1 && game.shotJournal) game.shotJournal.net();
        /* Шнур временно расширяет окно приёма, не изменяя время игры.
         * Базовый forgive восстанавливается в stepPhysics. */
        if (!game.training && typeof getCaptureForgiveness === 'function' && typeof setCaptureForgiveness === 'function') {
          if (!(game._cordForgiveUntil > game.time)) {
            game._cordBaseForgive = getCaptureForgiveness();
          }
          setCaptureForgiveness(game._cordBaseForgive * 1.5);
          game._cordForgiveUntil = game.time + 0.9;
        }
        game.buzz([12, 22, 12]);
      } else {
        bounceNet(b.p, b.v, b.w, Math.sign(p0.z) || 1);
        game.audio.hitNet();
        game.emitParticles(nh.x, nh.y, 0, 7, 0.7, 0.3, 0.013, 0.8, 0.85, 1);
        game.netTouched = true;
        if (b.lastHitBy === 1 && game.shotJournal) game.shotJournal.net();
        game.moments.addBounce(true);
      }
      game.training?.recordEvent?.('net', { tape: nk === 2, point: { ...nh } });
    }

    /* --- floor --- */
    if (b.p.y - PH.R <= 0.0 && b.v.y < 0) {
      b.p.y = PH.R;
      impactSphere(b.v, b.w, N_UP, ZERO3, PH.E_FLOOR, PH.MU_FLOOR, 0);
      game.training?.recordEvent?.('floor', { point: { ...b.p } });
      game.onFloor();
      if (V3.len(b.v) < 0.6) b.live = false;
    }

    /* --- out of bounds safety --- */
    if (Math.abs(b.p.x) > 9 || Math.abs(b.p.z) > 11 || b.p.y > 9) {
      b.live = false;
      // The ball escaped the arena without ever reaching the floor check that
      // normally resolves a point (a wide or sky-high shot). Award the point so
      // the rally state can't hang forever with a dead ball.
      if (game.state === GS.RALLY) {
        const lh = b.lastHitBy;
        if (lh !== 0) {
          const onRecv = game.rallyBounces.filter((s) => s === -lh).length;
          if (onRecv === 0) game.awardPoint(-lh, lh > 0 ? 'АУТ' : 'СОПЕРНИК В АУТЕ');
          else game.awardPoint(lh, lh > 0 ? 'ОЧКО! СОПЕРНИК НЕ ДОСТАЛ' : 'ВЫ НЕ ДОСТАЛИ МЯЧ');
        }
      }
    }

    game._trailCrumb(b);

    /* --- paddles (CCD) --- */
    if (game.time - game.player.lastHitT > 0.09) game.tryPlayerHit(p0);
    else game.debugRecording && game.diagnosticPhysicsGate('hit_cooldown', { elapsedReal: game.time - game.player.lastHitT, requiredReal: .09 });

    game.watchdogSubstep(p0);
  }
