/* =====================================================================
 *  PLAYER HIT SOLVER
 *  Изолированная логика захвата мяча, проверки окна удара и подачи.
 *  Вынесено из монолита 70_game.js для упрощения отладки и поддержки.
 * ===================================================================== */
'use strict';

function tryPlayerHitState(game, p0, inputMetrics = null, inputPad = null) {
    const pad = game.player, b = game.ball;
    if (!b.live) return;
    /* The point is over. A ball still in the air during the point-end pause
     * is scenery: striking it used to change lastHitBy, consume the gesture
     * and feed the journal a contact that belonged to no rally. */
    if (game.state !== GS.RALLY && game.state !== GS.SERVE_TOSS) return;
    /* A serve has to bounce on the receiver's side before it can be returned.
     * `isServeBall` alone did not stop the near side from volleying the
     * opponent's serve straight out of the toss. */
    if (game.pressConsumed()) { game.debugRecording && game.diagnosticPhysicsGate('consumed'); game.logPressRejection('CONSUMED'); return; }
    if (game.isServeBall && b.lastHitBy === -1) {
      game.debugRecording && game.diagnosticPhysicsGate('opponent_serve_not_returnable');
      if (game.pressAdmitsBall() && game.playerStrokeIntent(false)) game.logPressRejection('BOUNCE_ILLEGAL');
      return;
    }
    if (game.state === GS.SERVE_TOSS && game.server === 1 && b.lastHitBy === 0) {
      game.promotePendingServeZone();
    }
    if (!game.pressAdmitsBall()) { game.debugRecording && game.diagnosticPhysicsGate('press_not_admitted'); return; }

    // The fixed envelope belongs to the racket, NOT the pointer marker.
    const reachRadius = MATCH_RULES.captureRadius;
    const serveReach = MATCH_RULES.serveCaptureRadius;

    const serveCtx = game.state === GS.SERVE_TOSS && game.server === 1 && b.lastHitBy === 0;
    const sw = game.swipe, m = inputMetrics || game.playerStrokeIntent(serveCtx);
    if (!m) {
      /* Палец держит ракетку без замаха — «стенка»: пассивный блок с честной
       * физикой отражения, но только когда ЭТОТ же жест уже вывел ракетку в
       * позицию (стал реальным ударом). Удержание без движения само по себе
       * не отражает мяч; короткий тап распознаётся отдельно при отпускании. */
      if (!serveCtx && game._tryPassiveBlock(pad, b)) { game.debugRecording && game.diagnosticPhysicsGate('passive_block'); return; }
      game.debugRecording && game.diagnosticPhysicsGate('no_stroke_intent', { serving: serveCtx });
      game.logNoStrokeIntent(serveCtx);
      return;
    }
    /* ITTF 2.07: a return must follow a bounce on the receiver's court.
     * Without game gate the generous endpoint envelope returned
     *   · a ball still on its way to the player (a volley, a fault), and
     *   · a ball that had already passed the end line and missed the table
     *     — a point the player had already won, turned back into a rally.
     * An out ball is allowed to finish its flight; the gesture is not
     * consumed, so it is still there for the real chance. */
    const ownBounce = game.rallyBounces.some((s) => s > 0);
    if (!serveCtx && !ownBounce) {
      game.debugRecording && game.diagnosticPhysicsGate('bounce_illegal');
      game.logPressRejection('BOUNCE_ILLEGAL');
      if (b.p.z >= PH.T_HALF_LEN) game.hintOut = game.time;
      return;
    }
    const endpointEligible = serveCtx || (b.lastHitBy === -1 && (game.rallyBounces.some(s => s > 0) || b.p.z >= .50));
    const spad = inputPad || game.staticPad(pad);
    const captureSample = measureCaptureAllowance(spad, p0, b.p, serveCtx, endpointEligible);
    if (captureSample && game.shotJournal) game.shotJournal.observeCapture(sw.gestureId, captureSample, game.time);
    if (b.v.z < 0 && b.p.z < spad.pos.z - .35) {
      game.debugRecording && game.diagnosticPhysicsGate('moving_away', { capture: captureSample }); return;
    }
    if (serveCtx && (b.v.y >= 0 || !(game.tossRiseNow() >= MATCH_RULES.serveTossMinRise - 1e-6))) {
      game.debugRecording && game.diagnosticPhysicsGate('serve_not_legal', { tossRise: game.tossRiseNow(), capture: captureSample });
      game.logPressRejection(b.v.y >= 0 ? 'SERVE_TOSS_RISING' : 'SERVE_TOSS_LOW', { tossRise: game.tossRiseNow() });
      return;
    }
    let hit = null, gateDetail = null;

    if (serveCtx) {
      // ITTF 2.06: the ball must be struck while FALLING from the toss.
      const rad = V3.dist(b.p, spad.pos);
      const serveIn = playerInCaptureRange(b.p, spad.pos, true);
      const serveEdge = !serveIn && playerGraceRange(b.p, spad.pos, true);
      if (b.v.y < 0 && game.tossRiseNow() >= MATCH_RULES.serveTossMinRise - 1e-6 && (serveIn || serveEdge)) {
        hit = { t: 1, x: b.p.x, y: b.p.y, z: b.p.z,
          captureKind: serveIn ? 'serve' : 'serve_edge',
          rad: serveIn ? rad * STROKE_CONFIG.serve.qualityRadiusK : serveReach, px: spad.pos.x, py: spad.pos.y, pz: spad.pos.z,
          edge: !serveIn };
      } else if (!serveIn && !serveEdge) {
        game.logPressRejection('SERVE_OUT_OF_REACH', { rad });
      }
    } else if (ownBounce) {
      const pp = spad.pos;
      const closing = (b.p.x - pp.x) * b.v.x + (b.p.y - pp.y) * b.v.y +
        (b.p.z - pp.z) * b.v.z;
      const swept = bladePlaneCapture(b.p, p0, pp, spad.prevPos, spad.normal, false);
      const inside = playerInCaptureRange(b.p, pp) || swept.ok;
      const grazing = !inside && (playerGraceRange(b.p, pp) || swept.grace);
      const still = b.v.x * b.v.x + b.v.y * b.v.y + b.v.z * b.v.z < 0.04;
      const atClosest = MATCH_RULES.contactAtClosest ? (closing >= -0.02 || swept.t < 0.999) : closing <= 0.02;
      if (game.debugRecording) gateDetail = { inside, grazing, still, closing, atClosest, tap: m.tap === true,
        capture: captureSample, previousBall: inputLogVec(p0),
        paddleStart: inputLogVec(spad.prevPos), paddleEnd: inputLogVec(spad.pos) };
      /* v4.2: курсорный путь (inputPad) остаётся в гейте — мгновенный ввод
       * зафиксирован тестами, и фантом стоит в плоскости мяча, поэтому
       * atClosest для него вырожден (сближение ≈ 0). Тяжесть блока держат
       * магнит ракетки (ослаблен), grace-полоса и «Зона приёма». */
      if ((inside || grazing) && (inputPad || (m.tap === true && inside) || atClosest || still)) {
        const cx = swept.point ? swept.point.x : b.p.x;
        const cy = swept.point ? swept.point.y : b.p.y;
        const cz = swept.point ? swept.point.z : b.p.z;
        const pxHit = swept.padPoint ? swept.padPoint.x : pp.x;
        const pyHit = swept.padPoint ? swept.padPoint.y : pp.y;
        const pzHit = swept.padPoint ? swept.padPoint.z : pp.z;
        const lat = Number.isFinite(swept.lat) ? swept.lat : Math.hypot(cx - pxHit, cy - pyHit);
        const dzEff = Number.isFinite(swept.dzEff) ? swept.dzEff : Math.abs(cz - pzHit);
        const frac = Math.max(lat / reachRadius, dzEff / MATCH_RULES.depthTolerance);
        hit = { t: swept.t ?? 1, x: cx, y: cy, z: cz, captureKind: inside ? 'endpoint' : 'edge',
          rad: clamp(frac, 0, 1) * reachRadius, px: pxHit, py: pyHit, pz: pzHit,
          edge: !inside };
      }
    }

    if (!hit) {
      hit = game.sweepPaddle(spad, p0, b.p, serveCtx ? serveReach : reachRadius);
    }
    if (!hit) {
      game.debugRecording && game.diagnosticPhysicsGate('no_intersection', gateDetail || { capture: captureSample });
      game.logNoContactReason(captureSample, serveCtx); return;
    }
    game.debugRecording && game.diagnosticPhysicsGate('hit_candidate', { ...(gateDetail || {}), hit: { ...hit } });
    if (!game.validatePressDirection(m)) { game.debugRecording && game.diagnosticPhysicsGate('wrong_direction'); return; }
    if (b.lastHitBy === 1) { game.debugRecording && game.diagnosticPhysicsGate('already_hit'); game.logPressRejection('CONSUMED'); return; } // you already hit it

    const isServeStroke = game.isServeBall && b.lastHitBy === 0 && game.server === 1;
    const contact = V3.new(hit.x, hit.y, hit.z);
    const strokePos = inputPad ? inputPad.pos : pad.pos;
    const forehand = paddleForehand(strokePos.x, game.settings.hand, pad.forehand);
    const grip = playerWristPose(strokePos, pad.vel, game.settings.hand, { grip: game.settings.grip, forehand });
    const sideParams = game.equip.forSide(game.playerActiveFace);
    const radius = MATCH_RULES.sweetRadius;
    const sweet = clamp((1 - hit.rad / reachRadius) * (sideParams.sweet || game.equip.sweetK), 0, 1);
    const offLat = clamp((hit.x - hit.px) / Math.max(radius, 1e-4), -1, 1);
    const offVer = clamp((hit.y - hit.py) / Math.max(radius, 1e-4), -1, 1);
    const offMag = clamp(Math.hypot(offLat, offVer), 0, 1);
    game.lastSweet = sweet;

    // ---- build the stroke from the live gesture --------------------
    const paidWork = game._playerWork?.gestureId === sw.gestureId && game._playerWork.rallyId === game._rallyId ? game._playerWork : null;
    const request = paidWork?.request || describeStrokeEffort(m, game._playerEffortContext(isServeStroke));
    const effortBudget = game.staminaEnabled() ? paidWork?.budget || game.getEffortBudget(1, request) : null;
    let racket, quality;
    if (hit.edge) {
      racket = game._glanceRacket(m, contact, isServeStroke, sideParams, effortBudget);
      quality = GRACE_RULES.quality;
      racket.quality = quality;
    } else if (m) {
      const contactCfg = STROKE_CONFIG.racket.contact, thresholds = contactCfg.timingThresholds;
      const timing = clamp(m.speed / Math.max(m.peakSpeed, 1e-3), contactCfg.timingMin, 1);
      const timingIndex = timing >= thresholds[0] ? 0 : timing >= thresholds[1] ? 1 : timing >= thresholds[2] ? 2 : 3;
      const tband = ['ТОЧНО', 'ХОРОШО', 'РАНОВАТО', 'ПОЗДНО'][timingIndex];
      const tq = contactCfg.timingQuality[timingIndex];
      game.lastTiming = tband;
      const ctx = {
        side: 1, playerControlled: !game.demoMode, grip: game.settings?.grip, hand: game.settings?.hand, forehand, isServe: isServeStroke,
        ball: { x: contact.x, y: contact.y, z: contact.z },
        ballSpin: b.w, ballSpeed: V3.len(b.v), ballVelocity: b.v,
        powerScale: 1,
        moveYaw: game.padYaw || 0, movePitch: game.padPitch || 0,
        equip: sideParams,
        spinBias: game.settings.spinBias || 'norm',
        spinGain: game.settings.spinGain ?? 1, arcSens: game.settings.arcSens ?? 1,
        effortBudget,
      };
      racket = deriveStroke(m, ctx);
      racket.vmag *= game.equip.vmagK;
      if (!isServeStroke) {
        // Tune intent before solving, never scale the finished ball velocity:
        // the trajectory solver must see the same speed that will be played.
        racket.vmag *= .90;
        racket.vmagCap = m.tap && !m.compactFlick ? 6.5 : 14;
      }
      /* Precision pays twice: a swipe peaking exactly at the contact gets a
       * pace bonus on top of the tq quality bonus — game is what makes the
       * exact hit a winner, not just a neat one. */
      if (timing >= thresholds[0]) racket.vmag *= contactCfg.speedBonus;
      if (!isServeStroke) {
        const miss = (1 - sweet) * offMag;
        racket.vmag *= 1 - contactCfg.missSpeedK * miss;
        racket.azSwing = clamp(racket.azSwing + offLat * contactCfg.missAzimuthK * (1 - sweet), ...STROKE_CONFIG.racket.azSwingRange);
        racket.elev = clamp(racket.elev - offVer * contactCfg.missElevationK * (1 - sweet), ...contactCfg.missElevationRange);
      }
      // Apply the player's physical effort ceiling after equipment/timing,
      // not the lower feeder cap chosen to guarantee safe central returns.
      if (!isServeStroke && racket.stroke && racket.stroke.id === 'SIDE')
        racket.vmag = Math.min(racket.vmag, racketEffortCap(racket));
      quality = clamp(racket.quality * (contactCfg.sweetWeights[0] + contactCfg.sweetWeights[1] * sweet)
        * (contactCfg.timingWeights[0] + contactCfg.timingWeights[1] * timing) * tq, ...contactCfg.qualityRange);
      racket.quality = quality;
      // One authored trajectory assist level, shared by every player.
      const assistLvl = MATCH_RULES.trajectoryAssist;
      const rawSwing = V3.new(), rawNormal = V3.new();
      strokeFrame(racket, 0, 0, 1, rawSwing, rawNormal);
      const rawShotFrame = { normal: shotVec(rawNormal), vR: shotVec(rawSwing),
        faceElev: racket.faceElev, swingElevation: racket.elev, swingAzimuth: racket.azSwing,
        faceAzimuth: racket.azFace, speed: racket.vmag, rubber: { ...racket.rubber } };
      racket = enforceRacketEffort({ ...racket, normal: rawNormal, vR: rawSwing }, effortBudget);
      racket = refineRacket(contact, b.v, b.w, racket, assistLvl, quality);
      if (racket.valid === false && !racket.intentionalOut && clamp(assistLvl, 0, 1) < 0.999) {
        /* Не только подача: в розыгрыше ассист 0.85 тоже мог не найти лега —
         * и игрок получал «мусорный» удар: в свою половину, в сетку с места,
         * или вообще не поперёк свайпа. Пере(решаем) с полным ассистом — он
         * находит легал почти всегда. */
        racket = refineRacket(contact, b.v, b.w, racket, 1, quality);
      }
      if (racket && !racket.intentionalOut && clamp(assistLvl, 0, 1) < 0.999 &&
          !game._playerFlightLegal(contact, racket, isServeStroke)) {
        /* Пост-верификация: решатель «без повторной проверки» формально
         * valid, но мяч уходит в свою половину/в сетку — для игрока это
         * неотличимо от «удар не в ту сторону». Карабкаемся по лестнице:
         * (1) пере(решаем) полным ассистом; (2) если и тот нелегален —
         * честно приглушаем темп (смягченный удар виден и объясним), а не
         * отсылаем абсурдную пулю в стол. Нелегальный СОВСЕМ (valid:false)
         * тоже идёт сюда: быстрый боковой свайп давал 24 об/с бока и 89 км/ч
         * с места в 1.5 м за своей линией — решатель такой мяч не удерживает,
         * и без этой ветки игрок получал пулю за стол. */
        const safer = refineRacket(contact, b.v, b.w, racket, 1, Math.min(quality, contactCfg.fallbackQualityMax));
        if (game._playerFlightLegal(contact, safer, isServeStroke)) racket = safer;
        else {
          /* (2) дикий боковой завиток подачи приглушаем до игрового — это та
           * самая «подача-рыба в сетку» из жалоб: жест честный, цель живая,
           * но curl=0.9 физически непопадаем; ассист усмиряет его ДО удара. */
          let dampedOk = false;
          if (isServeStroke && m && Math.abs(m.curl || 0) > STROKE_CONFIG.serve.curlRecoveryThreshold) {
            const damped = deriveStroke({ ...m, curl: (m.curl || 0) * STROKE_CONFIG.serve.curlRecoveryK }, ctx);
            strokeFrame(damped, 0, 0, 1, damped.vR, damped.normal);
            damped.vmag *= game.equip.vmagK;
            const d2 = refineRacket(contact, b.v, b.w, damped, 1, quality);
            if (game._playerFlightLegal(contact, d2, true)) { racket = d2; dampedOk = true; }
          }
          if (!dampedOk) {
            /* (3) ничего легального не нашлось даже полным ассистом — честно
             * приглушаем темп: смягчённый удар виден и объясним, вместо
             * абсурдной пули в стол молча. Но один только темп убивает удар
             * в другом месте: медленный мяч с прежней закрытой гранью (−15°)
             * идёт в сетку (замер temp/side-browser-probe.cjs: 4 м/с → «в
             * сетку»). Поэтому перебираем несколько честных пар «подъём
             * грани × темп» и берём первую законную; если ни одна не
             * подошла — гасим ТОЛЬКО темп, не трогая грань. Поднятая грань без
             * законного полёта опасна: разворачивая лицо от мяча, она
             * превращает удар в «нет контакта» (impactRacket отвергает
             * расходящуюся грань), и на мобильном вьюпорте свежий жест просто
             * переставал быть ударом. */
            const sw = V3.new(), nm = V3.new();
            let gentle = null;
            for (const [lift, target] of contactCfg.softening) {
              const scale = Math.min(1, target * (game.equip.vmagK || 1) / Math.max(racket.vmag, 1e-6));
              strokeFrame(racket, (racket.dElev || 0) + lift, racket.dAz || 0, scale, sw, nm);
              const cand = enforceRacketEffort({ ...racket, valid: true, softened: true, vmag: racket.vmag * scale,
                vR: V3.clone(sw), normal: V3.clone(nm) }, effortBudget);
              if (game._playerFlightLegal(contact, cand, isServeStroke)) { gentle = cand; break; }
            }
            if (gentle) racket = gentle;
            else {
              const floor = contactCfg.softening[0][1] * (game.equip.vmagK || 1);
              racket.vmag = Math.min(racket.vmag, floor);
              if (racket.vR) V3.mul(racket.vR, racket.vR, Math.min(1, floor / Math.max(V3.len(racket.vR), 1e-6)));
              racket.softened = true;
            }
          }
        }
      }
      racket.sweet = sweet; racket.timing = timing;
      racket.unassisted = rawShotFrame;
    }

    racket = enforceRacketEffort(racket, effortBudget);
    const contactPose = paddleContactPose(contact, racket, { grip: game.settings.grip,
      hand: game.settings.hand, forehand, roll: pad.roll, activeFace: game.playerActiveFace });
    if (!contactPose && !hit.edge) { game.logPressRejection('RACKET_TABLE_COLLISION'); return; }
    racket.contactInput = { pressZone: game.swipe.pressZone && { ...game.swipe.pressZone }, capture: captureSample && { ...captureSample, route: hit.captureKind || 'ccd' }, p: shotVec(contact), v: shotVec(b.v), w: shotVec(b.w), gesture: { ...m },
      context: { grip: game.settings?.grip, hand: game.settings?.hand, forehand, isServe: isServeStroke,
        equip: { ...sideParams }, vmagK: game.equip.vmagK, moveYaw: game.padYaw || 0, movePitch: game.padPitch || 0 } };
    game._preHit = { v: V3.clone(b.v), w: V3.clone(b.w) };
    const info = impactRacket(b.v, b.w, racket.normal, racket.vR, quality, racket.rubber || {});
    /* A separating face returns null and leaves the ball untouched. Consuming
     * the gesture (and the 90 ms hit cooldown, and the paddle's position) on a
     * null impact is how a ball that never touched the rubber still counted as
     * returned — and why the next, real attempt was ignored. */
    if (!info) { game.debugRecording && game.diagnosticPhysicsGate('impact_separating_face', { hit: { ...hit }, quality }); return; }
    {
      const bp = game.R && game.R.viewProj ? game.project(b.p, {}) : null;
      const pp = game.R && game.R.viewProj ? game.project(pad.pos, {}) : null;
      const distancePx = bp && pp && bp.ok && pp.ok && game.vw > 0 && game.vh > 0
        ? Math.hypot((bp.x - pp.x) * game.vw, (bp.y - pp.y) * game.vh) : null;
      game.logInput('contact', { outcome: { contact: true, route: hit.captureKind || 'ccd',
        distancePx, distanceM: captureSample ? captureSample.distance : V3.dist(b.p, pad.pos),
        pressToContactMs: game.swipe.pressZone && Number.isFinite(game.swipe.pressZone.pressT)
          ? Math.max(0, game.time - game.swipe.pressZone.pressT) * 1000 : null } });
    }
    pad.lastHitT = game.time;
    game.anticipation.active = false;
    V3.zero(game.anticipation.visualOffset);
    if (hit.edge) {
      /* Видимая пометка краевого контакта — короткая и НЕ праздничная:
       * никаких эффектов поверх мяча, только слово на табло сообщений и
       * запись в статистику. Игрок должен ПОНЯТЬ, что произошло: он не
       * «промахнулся в никуда», а задел краем. */
      const edgeServe = game.state === GS.SERVE_TOSS;
      game.msg(edgeServe ? 'ПОДАЧА КРАЕМ' : 'КРАЙ РАКЕТКИ', .9, '#ffd77a');
      if (game.stats) game.stats.edgeHits = (game.stats.edgeHits || 0) + 1;
      if (game.shotJournal && typeof game.shotJournal.noteOutcome === 'function')
        game.shotJournal.noteOutcome(hit.captureKind === 'serve_edge' ? 'SERVE_EDGE' : 'EDGE', { q: quality });
    }
    /* Сторож видит позу клинка ДО «прилипания» к мячу: именно эта дистанция
     * и есть ответ на «подача не от ракетки»/«контакт не на ракетке». */
    /* Поза, которой удар РЕШЁН (курсор/тап), а не анимированная копия:
     * раньше тикет «ракетка под столом» считался по другой ракетке, чем та,
     * что коснулась мяча. */
    if (game.watchdog) game.watchdog.contact({ time: game.time, side: 1, serve: isServeStroke,
      contact, pad: contactPose || { pos: strokePos }, padBefore: pad.pos, racket });
    /* The blade is where the contact is. The old code left the bat up to one
     * full capture radius away and launched the ball from a point it visibly
     * never reached; the AI already snaps its paddle to the contact. prevPos is
     * moved too, so the next frame does not read the snap as 20 m/s of bat. */
    V3.copy(pad.pos, contactPose ? contactPose.pos : contact);
    if (contactPose) {
      pad.q = Q.copy(pad.q || Q.new(), contactPose.q); pad.roll = contactPose.roll;
      pad.activeFace = contactPose.activeFace; pad.contactPose = contactPose; pad.poseReady = true;
    }
    pad.forehand = forehand;
    V3.copy(pad.prevPos, pad.pos);
    V3.copy(pad.prev, pad.pos);
    V3.copy(b.p, contact);
    V3.addScaled(b.p, b.p, racket.normal, PH.R * STROKE_CONFIG.racket.launchSeparation);
    V3.copy(pad.normal, racket.normal); // show the assisted contact face too
    if (isServeStroke && !hit.edge && racket.stroke && /^SERVE_/.test(racket.stroke.id) && typeof STROKES !== 'undefined') {
      /* Стиль подачи ВЫРАСТАЕТ из жеста (тот же свайп, четыре направления):
       * вверх — накат, вниз — резаная, поперёк — боковая, длинный быстрый —
       * стремительная. Называем её словом и цветом: подачи перестают быть
       * визуально одинаковыми, и игрок чувствует разницу стилей. */
      const stInfo = STROKES[racket.stroke.id];
      if (stInfo) game.msg(stInfo.name, 1.0, stInfo.col || '#ffd34d');
      const key = 'serve' + racket.stroke.id.slice(6, 7) + racket.stroke.id.slice(7).toLowerCase();
      if (game.stats) game.stats[key] = (game.stats[key] || 0) + 1;
    }
    pad.swing = 1;
    const motion = game.paddleMotion || (game.paddleMotion = new PaddleStrokeMotion());
    motion.contact(racket.normal, pad.roll, racket.stroke.id, game.settings.grip,
      game.settings.hand, forehand, game.settings.followThrough !== false);
    const impactAngles = paddleFaceAngles(racket.normal);
    pad.pitch = impactAngles.pitch; pad.yaw = impactAngles.yaw; pad.motionStage = 'contact';
    if (game.followThrough) game.followThrough.active = false;
    game.holdPaddlePose();

    // Multi-sensory hit feedback (99-level)
    if (game.hitFeedback) {
      game.hitFeedback.execute({
        quality,
        speed: V3.len(b.v) || 0,
        spin: b.w,
        contactPoint: contact,
        contactNormal: racket.normal,
        stroke: racket.stroke ? racket.stroke.id : 'DRIVE',
        power: racket.power,
        isServeStroke,
        isNetCord: game.netTouched,
        isEdge: info && info.edge > 0.25,
        side: 1,
        skipBaseHitAudio: true,
      });
    }

    if (isServeStroke) { game.serveBounces = 0; game.rallyBounces.length = 0; }
    else game.isServeBall = false;
    game.applyHit(1, racket, contact, quality, info);
    sw.consumedGestureId = sw.gestureId; sw.consumedAt = game.time;
    sw.cancel();
    game.pointerDown = false;
    game.swipeReleasedAt = -Infinity;
    if (game.state === GS.SERVE_TOSS) game.setState(GS.RALLY);
}
