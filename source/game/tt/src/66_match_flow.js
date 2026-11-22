/* =====================================================================
 *  MATCH FLOW
 *  Изолированная логика начисления очков (awardMatchPoint) и применения
 *  удара (applyMatchHit). Вынесено из 70_game.js.
 * ===================================================================== */
'use strict';

function awardMatchPoint(game, who, reason) {
    if (game.watchdog) game.watchdog.point();
    /* Гость в онлайне не ведёт счёт: хост единственный источник очков. Собственная
     * физика гостя может определить финал розыгрыша иначе и счёт разойдётся.
     * Гостю достаточно остановить мяч — следующий point-пакет синхронизирует счёт. */
    if (game.network.isInMatch && !game.network.isHost) {
      game.ball.live = false; game.ball.hist.length = 0;
      game.ball.trailGrade = null; game.ball.golden = null;
      return;
    }
    if (game.debugRecording) {
      game.logInput('point', { outcome: { winner: who, reason } });
      const press = game._debugLastPress;
      if (who < 0 && press && press.shotId === game.shotId && press.green && game.ball.lastHitBy === -1) {
        game.logInput('anomaly', { outcome: { reason: 'GREEN_PRESS_WITHOUT_RETURN', press,
          note: 'Observation only; inspect input, cancellation and physics_gate events for the cause.' } });
      }
    }
    if (game.training) {                 // drills have no score, only feedback
      if (game.shotJournal) game.shotJournal.point(who, reason, game.ball.lastHitBy, game.time);
      game.training.onFault(who, reason);
      game.ball.live = false;
      game.ball.hist.length = 0; game.ball.trailGrade = null; game.ball.golden = null;
      return;
    }
    if (game.state === GS.POINT || game.state === GS.MATCH_END) return;
    game._cancelPlayerWork();
    if (game.staminaEnabled()) game._pendingCredit = game._rallyId;
    /* очко закончилось — шлейф мёртвого мяча умирает вместе с ним,
     * а не висит «мерзкой полосой» до следующей подачи */
    // Continue the finished ball separately, without affecting scoring or replay.
    game.capturePointBall();
    game.ball.live = false;
    game.ball.hist.length = 0; game.ball.trailGrade = null; game.ball.golden = null;
    const idx = who > 0 ? 0 : 1;
    /* Свободная игра: мяч разыгрывается как обычно, но счёт не растёт —
     * партия не может закончиться, подача ротируется, розыгрыш идёт дальше. */
    if (!game.freePlay) game.score[idx]++;
    if (game.shotJournal) game.shotJournal.point(who, reason, game.ball.lastHitBy, game.time);
    const lh = game.ball.lastHitBy;
    game.stats.rallies++;
    game.lastPoint = { who, reason, at: game.time, seq: game.stats.rallies };
    game.buzz(who > 0 ? [14, 50, 22] : 42);
    if (game.rally > game.bestRally) game.bestRally = game.rally;
    if (who > 0) {
      if (lh === 1) game.stats.winners++;
    } else {
      const ownFault = lh === 1 || (game.isServeBall && game.server === 1 && lh === 0);
      if (ownFault) game.stats.errors++;
    }

    // why did that happen? one sentence, only when it helps
    game.lastSwipeLate = (game.time - game.lastSwipeT) > 0.75;
    game.pointNote = game.analyst.analyse(game.recorder, who, reason, game);
    if (game.pointNote && !game.training && game.ui) game.ui.showNote(game.pointNote);
    game.ai.onPointEnd(who);
    const h = game.director.onPoint(who, game.ai.levelIndex);
    game.ai.setHandicap(game.settings.adaptive ? h : 1);
    game.ai.setPressure(game.score[1], game.score[0], game.settings.targetScore);

    // serve rotation: every 2 points, every 1 from 10-10
    const deuce = game.score[0] >= game.settings.targetScore - 1 && game.score[1] >= game.settings.targetScore - 1;
    game.servesLeft--;
    if (deuce || game.servesLeft <= 0) { game.server = -game.server; game.servesLeft = deuce ? 1 : 2; }
    /* Онлайн-матч: хост всегда подаёт (подача гостя ещё не сведена, см. TODO),
     * поэтому после ротации подача всегда возвращается хосту. */
    if (game.network.isInMatch) { game.server = 1; game.servesLeft = 2; }

    game.audio.point(who > 0);
    /* Драма момента — текстом в том же баннере у табло и ростом толпы,
     * НЕ мусором в кадре: серия игрока, дьюс и матчбол названы явно. */
    const streak = game.director.streak;   // + = очки игрока подряд
    const tgt = game.settings.targetScore;
    const matchPoint = (game.score[0] >= tgt - 1 && game.score[0] > game.score[1]) ||
                       (game.score[1] >= tgt - 1 && game.score[1] > game.score[0]);
    let tag = '';
    if (matchPoint) tag = ET(who > 0 ? ' · МАТЧБОЛ' : ' · МАТЧБОЛ СОПЕРНИКА');
    else if (deuce) tag = ET(' · ДЬЮС');
    if (who > 0 && streak >= 3) {
      tag += ET(' · СЕРИЯ ×{n}', { n: streak });
      game.audio.applause(clamp(0.3 + (streak - 2) * 0.25, 0.3, 1.5));  // зал подхватывает серию
      game.audio.setCrowd(clamp(0.30 + streak * 0.10, 0, 0.9));
    }
    game.msg(ET(reason) + tag, 1.5, who > 0 ? '#6ee7a8' : '#ff8a8a', true);
    // the filter: keep game rally only if it is worth watching again
    game.lastMoment = game.moments.endRally(game.time, game, {
      winner: who, reason, score: game.score, target: game.settings.targetScore,
    });
    if (game.lastMoment && game.ui) game.ui.flashMoment(game.lastMoment, game.moments.kept.indexOf(game.lastMoment));
    game.setState(GS.POINT);
    game.shakeIt(0.5, V3.new(rndSym(1), 1, 0));

    const T = game.settings.targetScore;
    if ((game.score[0] >= T || game.score[1] >= T) && Math.abs(game.score[0] - game.score[1]) >= 2) {
      game.matchWinner = game.score[0] > game.score[1] ? 1 : -1;
    }
    // network: relay the point to the peer
    if (game.network.isInMatch) {
      game.network._send({ type: 'point', who, reason, score: game.score.slice() });
    }
    // career: the decisive perk arms itself on match point and pays out
    // on the player's next shot (see applyHit)
    if (game.career.active && game._careerDecisiveBoost > 0) {
      const isMatchPoint = (game.score[0] >= T - 1 && game.score[0] > game.score[1]) ||
                           (game.score[1] >= T - 1 && game.score[1] > game.score[0]);
      if (isMatchPoint) game._careerDecisiveActive = true;
    }
    game.ui && game.ui.syncScore();
    if (game.matchHudVisible()) {
      const id = ++game._hudEventId;
      game._matchResult = { id, who, reason, winner: game.matchWinner || 0 };
      game._matchEvent = { id, type: 'point', side: who };
      game._syncMatchHud(true);
    }

}

function applyMatchHit(game, side, racket, contactP, quality, info) {
    if (side === 1) {
      if (game.demoMode) { b_gradeAssign(game, null); }
      else {
        const grade = game.hitInputGrade(racket.contactInput && racket.contactInput.gesture);
        b_gradeAssign(game, grade);
        if (grade === 'green' && !game.training)
          game.msg('ЧИСТЫЙ КОНТАКТ', 1.1, '#7CFF9E');
      }
    } else { b_gradeAssign(game, null); }
    function b_gradeAssign(g2, grade) {
      g2.ball.trailGrade = grade;
      g2.ball.golden = (grade === 'green' && !g2.training && Math.random() < 0.88) ? 'win' : null;
    }
    if (side < 0 && game.shotJournal) game.shotJournal.returned(game.time);
    const b = game.ball;
    b.lastHitBy = side;
    game._hitSeq = (game._hitSeq || 0) + 1;   // сторож: в этом подшаге контакт был
    game.shotId++;                       // the opponent reacts once per shot
    b.trailStroke = racket.stroke || null;
    game._recordContactFlash(side, racket.stroke && racket.stroke.id, contactP, game.time);
    game.rallyBounces.length = 0;
    game.netTouched = false;
    // career perks act on the player's own shots: the chosen boosts scale
    // speed/spin right after the impact resolves, before anything reads them
    if (side > 0 && game.career.active) {
      const sid = (racket.stroke && racket.stroke.id) || 'DRIVE';
      let vm = game._careerSpeedBoost;
      let wm = game._careerSpinBoost;
      if (sid === 'LOOP' || sid === 'DRIVE' || sid === 'SMASH' || sid === 'COUNTER') wm *= game._careerTopspinBoost;
      if (sid === 'PUSH' || sid === 'CHOP') wm *= game._careerBackspinPenalty;
      if (sid === 'SMASH') vm *= game._careerSmashBoost;
      if (sid === 'COUNTER') vm *= game._careerCounterBoost;
      if (sid === 'CHOP') wm *= game._careerChopBoost;
      if (sid === 'HOOK' || sid === 'FADE' || sid === 'SIDE' || sid === 'SERVE_SIDE') b.w.y *= game._careerSidespinBoost;
      if (game._careerDecisiveActive) { vm *= 1 + game._careerDecisiveBoost; game._careerDecisiveActive = false; }
      if (vm !== 1) { b.v.x *= vm; b.v.y *= vm; b.v.z *= vm; }
      if (wm !== 1) { b.w.x *= wm; b.w.y *= wm; b.w.z *= wm; }
    }
    if (!game.isServeBall) {
      game.rally++;
      if (!game.training && !game.demoMode) game.audio.onRallyHit(game.rally, side);
    }

    // Difficulty belongs to OpponentAI's launch solver. Clamping velocity
    // here invalidated its legal serves after they had already been solved.

    const speed = V3.len(b.v), spin = V3.len(b.w), incoming = game._preHit;
    /* Здесь уже применены экипировка, бонус за точный контакт, штраф за
     * промах, смягчение темпа и карьерные бусты — то есть проверять потолки
     * имеет смысл только отсюда. */
    game.watchdogStroke(side, racket, contactP, quality, speed, spin);
    const name = racket.stroke ? racket.stroke.id : 'DRIVE';
    if (side > 0) {
      game.stats.shots++;
      game.stats.totalSpin += spin / TAU;
      if (speed * 3.6 > game.stats.maxSpeed) game.stats.maxSpeed = speed * 3.6;
      if (spin / TAU > game.stats.maxSpin) game.stats.maxSpin = spin / TAU;
      game.stats.byStroke[name] = (game.stats.byStroke[name] || 0) + 1;
    } else {
      game.stats.aiShots = (game.stats.aiShots || 0) + 1;
      if (game.ai && typeof game.ai.recordHit === 'function')
        game.ai.recordHit({ v: incoming?.v || b.v }, racket, { p: b.p, v: b.v, w: b.w, info }, game.strokeTime ?? game.time);
    }
    if (game.state === GS.SERVE_TOSS) game.setState(GS.RALLY);
    game._publishMatchContact(side, racket, contactP, quality,
      side > 0 ? (game.lastSweet !== undefined ? game.lastSweet : 1) : 1);

    // Every accepted hit owns one base racket cue here. Strong/sloppy swings
    // retain their extra whoosh; feedback must not repeat the physical contact.
    const softHit = !!(racket.arch && racket.arch.soft) || (side > 0 && game.lastSweet !== undefined && game.lastSweet < 0.38);
    const sweet = side > 0 ? (game.lastSweet !== undefined ? game.lastSweet : 1) : 1;
    const isStrongHit = speed > 7.5 && (quality ?? 0.8) > 0.70 && sweet > 0.50;
    const isFastSloppy = !isStrongHit && speed > 7.5 && (sweet < 0.50 || (quality ?? 0.8) < 0.70);
    game.audio.hitRacket(speed, info ? info.contactSlip : 0, !isStrongHit && softHit, side + '/' + game.shotId, isStrongHit ? 1 : 0);
    if (isStrongHit) {
      game.audio.whoosh(clamp(speed / 10, 0.6, 1.4), 'hit/' + game.shotId);
    } else if (isFastSloppy) {
      game.audio.whoosh(clamp(speed / 12, 0.4, 1.0), 'sloppy/' + game.shotId);
    }
    if (side > 0 && game.lastSweet !== undefined && game.lastSweet < 0.30) game.buzz(16);
    if (game.feedback) {
      game.feedback.execute({
        quality: quality ?? 0.8,
        speed,
        spin: b.w,
        stroke: racket.stroke,
        contactPoint: contactP,
        side,
        skipBaseHitAudio: true,
        skipBaseHaptic: true,
      });
    }
    /* Всплеск частиц в точке контакта убран совсем: салют ровно там, куда
     * игрок смотрит, — чистая помеха, и в ОБУЧЕНИИ тоже. Контакт теперь
     * отмечает короткая цветная вспышка цвета принятого удара
     * (_recordContactFlash); вердикт ввода остаётся за шлейфом и текстом. */

    if (side > 0) {
      game.hitFlash = Math.min(game.hitFlash + 0.55, 1);   // периферия, не точка контакта
      game.lastShotInfo = {
        stroke: racket.stroke, speed: speed * 3.6, spin: spin / TAU,
        side, shotId: game.shotId, v: shotVec(b.v), w: shotVec(b.w),
        topspin: -b.w.x * side, sidespin: b.w.y, quality,
        power: racket.power, t: game.time,
        contact: racket.contact, elev: racket.elev, contactPoint: shotVec(contactP),
        timing: side > 0 ? (game.lastTiming || '') : '',
        sweet: side > 0 ? (game.lastSweet !== undefined ? game.lastSweet : 1) : 1,
        rim: side > 0 && game.lastSweet !== undefined && game.lastSweet < 0.42,
      };
      if (game.shotJournal) game.shotJournal.capture(game.swipe.gestureId, game.time,
        { ...racket, quality }, b, { grip: game.settings?.grip, hand: game.settings?.hand, shotId: game.shotId });
      game.ui && game.ui.showShot(game.lastShotInfo);
      game.recorder.addShot(1, Object.assign({
        x: contactP.x, y: contactP.y, z: contactP.z, quality,
      }, game.lastShotInfo));
      if (game.training) game.training.onPlayerHit(game.lastShotInfo, racket, contactP);
      game.moments.addContact(game.time, {
        by: 1, stroke: (racket.stroke && racket.stroke.id) || '?',
        speed: speed * 3.6, spin: spin / TAU, quality,
      });
      const sid = racket.stroke && racket.stroke.id;
      if (sid === 'LOOP' || sid === 'COUNTER') game.matchTasks.topspin++;
      else if (sid === 'SMASH') game.matchTasks.smash++;
      if (racket.isServe) game.matchTasks.serves++;
      game.buzz(Math.round(lerp(8, 26, clamp(speed / 90, 0, 1))));
      game.shakeIt(clamp(speed / 55, 0.03, 0.38) * 0.45, V3.new(rndSym(0.4), 0.5, 1));
      // Time is changed only by the player's separate slow-motion control.
      // refresh the landing preview
      if (game.settings.showPredict) {
        predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
          { dt: 1 / 240, maxT: 2.4, stopOnFirstBounce: true, out: game.predictOut, path: game.predictPath });
      }
    } else {
      game.shakeIt(clamp(speed / 90, 0.02, 0.18), V3.new(rndSym(0.4), 0.4, -1));
      game.recorder.addShot(-1, {
        stroke: racket.stroke, speed: speed * 3.6, spin: spin / TAU,
        topspin: b.w.x, sidespin: b.w.y, quality, t: game.time,
        contact: racket.contact, elev: racket.elev,
        x: contactP.x, y: contactP.y, z: contactP.z,
        slip: !!(game.ai.lastShot && game.ai.lastShot.slip),
      });
      game.ui && game.ui.showAiShot(racket.stroke);
      game.moments.addContact(game.time, {
        by: -1, stroke: (racket.stroke && racket.stroke.id) || '?',
        speed: speed * 3.6, spin: spin / TAU, quality,
      });
    }
}

function startMatchFlow(game, diff, resume = null) {
    const restored = resume === null ? null : game._validateMatchResume(resume);
    if (resume !== null && !restored) return false;
    if (restored) game._playerFace = restored.playerFace;
    game._matchHudSuppressed = true;
    if (restored) { game.freePlay = restored.free; game.demoMode = restored.demo; game._keepDemo = restored.demo; }
    game.cancelInput?.('match_start');
    game._playerWork = game._aiWork = null;
    game.lobbyScene?.stop();
    game.setSessionKind(game.network.isInMatch ? 'online' : game.career.active ? 'career' : game.freePlay ? 'free' : game.sessionKind === 'practice' ? 'practice' : 'ranked');
    game.endReplay(false); // cancel old callbacks; never complete an old match here
    game.moments.reset();
    if (game.inputLog && typeof game.inputLog.resetClock === 'function') game.inputLog.resetClock(game.time);
    game.shotJournal && game.shotJournal.reset();
    game.ui?.clearShotFeedback?.();
    game.watchdog && game.watchdog.reset();
    game.lastMoment = null;
    game._acc = 0;
    game.followThrough.active = false;
    game.anticipation.active = false;
    game.audio.stopAudience();
    game.audio.stopEffects?.(); game._swingSoundId = null; game._aiSwingSoundShot = null;
    game.contactFlashes = [];
    game._contactFlashSeen = new Set();
    game._demoGesture = null;
    game.matchTasks = { topspin: 0, smash: 0, serves: 0, moments: 0 };
    const wasTraining = !!game.training;
    game.training?.quit?.(); game.training = null;
    if (wasTraining) game.ai.setLevel?.(game.settings.difficulty);
    // A new match must not inherit training or temporary cord assistance.
    game.clearCordCaptureBoost();
    if (typeof setCaptureForgiveness === 'function') setCaptureForgiveness(1);
    game.matchWinner = 0;
    game._idleStill = false;           // витрина «ракетки на столе» — только в меню/лобби
    game.messages.length = 0;
    game.pointNote = null;
    game.slowmo.energy = 1; game.slowmo.on = false; game.slowmo.active = false;
    game.targetTimeScale = 1; game.timeScale = 1; game.slowmoUntil = 0;
    if (CAMERA_ORDER.indexOf(game.settings.camera) < 0) game.settings.camera = CAMERA_ORDER[0];
    game.resetPaddle(true);            // hard: the bat is placed, not glided
    game.ai.reset();
    game.analyst.reset();
    game.director.reset();
    game.director.enabled = game.settings.adaptive;
    game.pointNote = null;
    if (diff !== undefined) { game.settings.difficulty = diff; game.ai.setLevel(diff); }
    /* Адаптация работает ТОЛЬКО между матчами: значение посчитано до первого
     * мяча и внутри розыгрыша не меняется — резиновой сложности здесь нет. */
    game.ai.setTrend(game.aiTrend !== undefined ? game.aiTrend : game.trendFromHistory());
    // career: the chop perk slows the opponent, always from the base speed
    if (game.career.active && game._careerAISlowdown < 1) {
      game.ai.maxSpeed = game.ai.L.move * game._careerAISlowdown;
    }
    // career and online are scored modes: no bullet time there
    game.setSlowmoAllowed(!(game.career.active || game.network.isInMatch));
    game._matchId = restored ? restored.matchId : Date.now().toString(36) + '-' + (++matchSerial).toString(36);
    game.stamina = restored ? restored.stamina.map(s => ({ ...s })) : [Stamina.fresh(), Stamina.fresh()];
    game._hudSeq = restored ? restored.seq : 0;
    game._hudEventId = restored ? restored.eventId : 0;
    game._rallyId = restored ? restored.rallyId : 0;
    game._serveId = restored ? restored.serveId : 0;
    game._swingId = restored ? restored.swingId : 0;
    game._pendingCredit = restored ? restored.pendingCredit : null;
    game._creditedRally = restored ? restored.creditedRally : -1;
    game._matchContacts = restored ? restored.contacts.map(c => c && { ...c,
      velocity: c.velocity && { ...c.velocity }, angularVelocity: c.angularVelocity && { ...c.angularVelocity } }) : [null, null];
    game._matchWhiffs = restored ? restored.whiffs.map(w => w && { ...w }) : [null, null];
    game._matchEvent = restored?.event ? { ...restored.event } : null;
    game._matchResult = restored?.result ? { ...restored.result } : null;
    game._hudElapsed = 0; game._matchHudDirty = false;
    game.score = [0, 0]; game.games = [0, 0];
    game.rally = 0; game.bestRally = 0;
    game.stats = { shots: 0, aiShots: 0, winners: 0, errors: 0, blocks: 0, edgeHits: 0, edgeBalls: 0,
      maxSpeed: 0, maxSpin: 0, byStroke: {}, totalSpin: 0, rallies: 0 };
    game.server = Math.random() < 0.5 ? 1 : -1;
    game.servesLeft = 2;
    game.audio.init(); game.audio.resume();
    if (!game._keepDemo) game.demoMode = false;
    game._keepDemo = false;
    if (restored) {
      game.score = restored.score.slice(); game.server = restored.server; game.servesLeft = restored.servesLeft;
      game.settings.targetScore = restored.target; game.demoMode = restored.demo; game.freePlay = restored.free;
      game.matchWinner = restored.winner; game.rally = restored.rally; game.bestRally = restored.bestRally; game.shotId = restored.shotId;
      game._aiWork = restored.aiWork && { ...restored.aiWork };
      game.isServeBall = restored.isServeBall; game.serveBounces = restored.serveBounces;
      game.rallyBounces = restored.rallyBounces.slice(); game.netTouched = restored.netTouched;
      for (const key of ['p', 'v', 'w']) V3.copy(game.ball[key], restored.ball[key]);
      Q.copy(game.ball.q, restored.ball.q);
      game.ball.live = restored.ball.live; game.ball.lastHitBy = restored.ball.lastHitBy; game.ball.hist.length = 0;
      game.ball.trailStroke = null; game.ball.trailGrade = null; game.ball.golden = null;
      game.aiServeTimer = restored.aiServeTimer; game.aiServeX = restored.aiServeX;
      game.aiSwingAt = game.strokeTime + restored.aiSwingRemaining;
      game.tossStartY = restored.tossStartY; game.tossApex = restored.tossApex;
      game.setState(restored.phase);
      game.stateT = restored.stateT; game.stateSimT = restored.stateSimT;
      game.setPaused(restored.paused);
      game.swipeReleasedAt = -Infinity;
      game.audio.resetRally(); game.recorder.begin(game.time, game.server);
      game.moments.beginRally(game.time, game.score);
      game.ai.setPressure(game.score[1], game.score[0], restored.target);
      game._matchHudSuppressed = false;
      game._syncMatchHud(true);
      return true;
    }
    game.prepServe();
    game._matchHudSuppressed = false;
    game._syncMatchHud(true, 'serve', game.server);
    if (game.demoMode) {
      game.msg('НАБЛЮДЕНИЕ · БОТЫ ИГРАЮТ', 3.0, '#39c6ff', true);
    } else {
      game.msg(game.server === 1 ? 'ТВОЯ ПОДАЧА' : 'ПОДАЁТ СОПЕРНИК', 1.6, '#7fd4ff');
    }
    return true;
}
