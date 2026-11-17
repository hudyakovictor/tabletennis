# Три метода игрового цикла

Точные методы из `source/game/tt/src/70_game.js` на момент проверки. Это методы класса `Game`; им нужны остальные модули и состояние движка. Порядок — как в запросе.

## `stepPhysics`

```js
  stepPhysics(dt) {
    const b = this.ball;
    if (this._cordForgiveUntil && this.time >= this._cordForgiveUntil) this.clearCordCaptureBoost();
    if (!b.live) return;
    // a ball that has run out of energy settles instead of micro-bouncing
    if (b.p.y - PH.R <= PH.TABLE_Y + 0.004 && Math.abs(b.v.y) < 0.30 &&
      Math.abs(b.p.x) <= PH.T_HALF_WID && Math.abs(b.p.z) <= PH.T_HALF_LEN) {
      b.restT = (b.restT || 0) + dt;
      if (b.restT > 0.9 || V3.len(b.v) < 0.45) {
        if (this.state === GS.POINT || this.state === GS.MATCH_END) { b.live = false; return; }
        /* The ball came to rest ON the table during a rally. Nothing else
         * would ever resolve it: no bounce, no floor, no point — the rally
         * hung with a motionless ball until the player left the match.
         * `restT` (0.9 s of sitting on the table), not the instantaneous
         * speed: a short ball still trickling at 0.3 m/s is a ball the
         * player can and should be able to run in and flick, and the old
         * speed test killed exactly those. */
        if ((this.state === GS.RALLY || this.state === GS.SERVE_TOSS) && b.restT > 0.9) { this.settleDeadBall(); return; }
      }
    } else b.restT = 0;
    const p0 = V3.clone(b.p);

    integrateBall(b.p, b.v, b.w, dt);
    Q.integrate(b.q, b.q, spinVisualRate(b.w, this._spinVis || (this._spinVis = V3.new())), dt);
    b.speed = V3.len(b.v);

    /* --- table --- */
    /* tableContact() is the same function predict() runs: it rejects a ball
     * that was already below the surface at the start of the step and it
     * returns the INTERPOLATED touch point, not the end of the step. At
     * 30 m/s the end of a 1/600 s step is 5 cm past the line, which is how a
     * ball that landed inside the line got recorded outside it. */
    if (b.v.y < 0) {
      const tb = tableContact(p0.x, p0.y, p0.z, b.p.x, b.p.y, b.p.z, this._tabHit || (this._tabHit = { x: 0, y: 0, z: 0 }));
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
          if (this.time - (this._edgeFxT || -9) > 0.45) {
            this._edgeFxT = this.time;
            this.msg(info.edgeAxis === 'x' ? 'РЕБРО СТОЛА!' : 'ЗАДНЯЯ КРОМКА!', 1.0, '#ffd34d');
            this.shakeIt(0.10 + 0.16 * info.edge, V3.new(0, 1, 0));
            this.stats.edgeBalls = (this.stats.edgeBalls || 0) + 1;
          }
        }
        this.onBounce(Math.sign(b.p.z) || 1, sp, info);
      }
    }

    /* --- net --- */
    /* netContactStep() is the same model predict() and every solver use:
     * 0 clean, 1 mesh, 2 white tape. A ball whose whole body is under the
     * table passes BENEATH the net — the plane used to reflect it, so a ball
     * that had already fallen off the table bounced off an invisible wall. */
    const nk = netContactStep(p0.x, p0.y, p0.z, b.p.x, b.p.y, b.p.z,
      this._netHit || (this._netHit = { x: 0, y: 0, z: 0 }));
    if (nk > 0) {
      const nh = this._netHit;
      if (nk === 2) {
        clipTape(b.p, b.v, b.w);
        this.audio.hitNet();
        this.msg('КАСАНИЕ ШНУРА', 1.1, '#ffd34d');
        this.emitParticles(nh.x, PH.NET_TOP, 0, 8, 1.1, 0.3, 0.014, 1, 0.9, 0.5);
        this.netTouched = true;
        if (b.lastHitBy === 1 && this.shotJournal) this.shotJournal.net();
        /* Шнур временно расширяет окно приёма, не изменяя время игры.
         * Базовый forgive восстанавливается в stepPhysics. */
        if (typeof getCaptureForgiveness === 'function' && typeof setCaptureForgiveness === 'function') {
          if (!(this._cordForgiveUntil > this.time)) {
            this._cordBaseForgive = getCaptureForgiveness();
          }
          setCaptureForgiveness(this._cordBaseForgive * 1.5);
          this._cordForgiveUntil = this.time + 0.9;
        }
        this.buzz([12, 22, 12]);
      } else {
        bounceNet(b.p, b.v, b.w, Math.sign(p0.z) || 1);
        this.audio.hitNet();
        this.emitParticles(nh.x, nh.y, 0, 7, 0.7, 0.3, 0.013, 0.8, 0.85, 1);
        this.netTouched = true;
        if (b.lastHitBy === 1 && this.shotJournal) this.shotJournal.net();
        this.moments.addBounce(true);
      }
    }

    /* --- floor --- */
    if (b.p.y - PH.R <= 0.0 && b.v.y < 0) {
      b.p.y = PH.R;
      impactSphere(b.v, b.w, N_UP, ZERO3, PH.E_FLOOR, PH.MU_FLOOR, 0);
      this.onFloor();
      if (V3.len(b.v) < 0.6) b.live = false;
    }

    /* --- out of bounds safety --- */
    if (Math.abs(b.p.x) > 9 || Math.abs(b.p.z) > 11 || b.p.y > 9) {
      b.live = false;
      // The ball escaped the arena without ever reaching the floor check that
      // normally resolves a point (a wide or sky-high shot). Award the point so
      // the rally state can't hang forever with a dead ball.
      if (this.state === GS.RALLY) {
        const lh = b.lastHitBy;
        if (lh !== 0) {
          const onRecv = this.rallyBounces.filter((s) => s === -lh).length;
          if (onRecv === 0) this.awardPoint(-lh, lh > 0 ? 'АУТ' : 'СОПЕРНИК В АУТЕ');
          else this.awardPoint(lh, lh > 0 ? 'ОЧКО! СОПЕРНИК НЕ ДОСТАЛ' : 'ВЫ НЕ ДОСТАЛИ МЯЧ');
        }
      }
    }

    this._trailCrumb(b);

    /* --- paddles (CCD) --- */
    if (this.time - this.player.lastHitT > 0.09) this.tryPlayerHit(p0);
    else this.debugRecording && this.diagnosticPhysicsGate('hit_cooldown', { elapsedReal: this.time - this.player.lastHitT, requiredReal: .09 });

    this.watchdogSubstep(p0);
  }
```

## `applyHit`

```js
  applyHit(side, racket, contactP, quality, info) {
    if (side === 1) {
      if (this.demoMode) { b_gradeAssign(this, null); }
      else {
        const grade = this.hitInputGrade(racket.contactInput && racket.contactInput.gesture);
        b_gradeAssign(this, grade);
        if (grade === 'green' && !this.training)
          this.msg('ЧИСТЫЙ КОНТАКТ', 1.1, '#7CFF9E');
      }
    } else { b_gradeAssign(this, null); }
    function b_gradeAssign(g2, grade) {
      g2.ball.trailGrade = grade;
      g2.ball.golden = (grade === 'green' && !g2.training && Math.random() < 0.88) ? 'win' : null;
    }
    if (side < 0 && this.shotJournal) this.shotJournal.returned(this.time);
    const b = this.ball;
    b.lastHitBy = side;
    this._hitSeq = (this._hitSeq || 0) + 1;   // сторож: в этом подшаге контакт был
    this.shotId++;                       // the opponent reacts once per shot
    b.trailStroke = racket.stroke || null;
    this._recordContactFlash(side, racket.stroke && racket.stroke.id, contactP, this.time);
    this.rallyBounces.length = 0;
    this.netTouched = false;
    // career perks act on the player's own shots: the chosen boosts scale
    // speed/spin right after the impact resolves, before anything reads them
    if (side > 0 && this.career.active) {
      const sid = (racket.stroke && racket.stroke.id) || 'DRIVE';
      let vm = this._careerSpeedBoost;
      let wm = this._careerSpinBoost;
      if (sid === 'LOOP' || sid === 'DRIVE' || sid === 'SMASH' || sid === 'COUNTER') wm *= this._careerTopspinBoost;
      if (sid === 'PUSH' || sid === 'CHOP') wm *= this._careerBackspinPenalty;
      if (sid === 'SMASH') vm *= this._careerSmashBoost;
      if (sid === 'COUNTER') vm *= this._careerCounterBoost;
      if (sid === 'CHOP') wm *= this._careerChopBoost;
      if (sid === 'HOOK' || sid === 'FADE' || sid === 'SIDE' || sid === 'SERVE_SIDE') b.w.y *= this._careerSidespinBoost;
      if (this._careerDecisiveActive) { vm *= 1 + this._careerDecisiveBoost; this._careerDecisiveActive = false; }
      if (vm !== 1) { b.v.x *= vm; b.v.y *= vm; b.v.z *= vm; }
      if (wm !== 1) { b.w.x *= wm; b.w.y *= wm; b.w.z *= wm; }
    }
    if (!this.isServeBall) {
      this.rally++;
      if (!this.training && !this.demoMode) this.audio.onRallyHit(this.rally, side);
    }

    // Difficulty belongs to OpponentAI's launch solver. Clamping velocity
    // here invalidated its legal serves after they had already been solved.

    const speed = V3.len(b.v), spin = V3.len(b.w), incoming = this._preHit;
    /* Здесь уже применены экипировка, бонус за точный контакт, штраф за
     * промах, смягчение темпа и карьерные бусты — то есть проверять потолки
     * имеет смысл только отсюда. */
    this.watchdogStroke(side, racket, contactP, quality, speed, spin);
    const name = racket.stroke ? racket.stroke.id : 'DRIVE';
    if (side > 0) {
      this.stats.shots++;
      this.stats.totalSpin += spin / TAU;
      if (speed * 3.6 > this.stats.maxSpeed) this.stats.maxSpeed = speed * 3.6;
      if (spin / TAU > this.stats.maxSpin) this.stats.maxSpin = spin / TAU;
      this.stats.byStroke[name] = (this.stats.byStroke[name] || 0) + 1;
    } else {
      this.stats.aiShots = (this.stats.aiShots || 0) + 1;
      if (this.ai && typeof this.ai.recordHit === 'function')
        this.ai.recordHit({ v: incoming?.v || b.v }, racket, { p: b.p, v: b.v, w: b.w, info }, this.strokeTime ?? this.time);
    }
    if (this.state === GS.SERVE_TOSS) this.setState(GS.RALLY);
    this._publishMatchContact(side, racket, contactP, quality,
      side > 0 ? (this.lastSweet !== undefined ? this.lastSweet : 1) : 1);

    // Every accepted hit owns one base racket cue here. Strong/sloppy swings
    // retain their extra whoosh; feedback must not repeat the physical contact.
    const softHit = !!(racket.arch && racket.arch.soft) || (side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.38);
    const sweet = side > 0 ? (this.lastSweet !== undefined ? this.lastSweet : 1) : 1;
    const isStrongHit = speed > 7.5 && (quality ?? 0.8) > 0.70 && sweet > 0.50;
    const isFastSloppy = !isStrongHit && speed > 7.5 && (sweet < 0.50 || (quality ?? 0.8) < 0.70);
    this.audio.hitRacket(speed, info ? info.contactSlip : 0, !isStrongHit && softHit, side + '/' + this.shotId, isStrongHit ? 1 : 0);
    if (isStrongHit) {
      this.audio.whoosh(clamp(speed / 10, 0.6, 1.4), 'hit/' + this.shotId);
    } else if (isFastSloppy) {
      this.audio.whoosh(clamp(speed / 12, 0.4, 1.0), 'sloppy/' + this.shotId);
    }
    if (side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.30) this.buzz(16);
    if (this.feedback) {
      this.feedback.execute({
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
      this.hitFlash = Math.min(this.hitFlash + 0.55, 1);   // периферия, не точка контакта
      this.lastShotInfo = {
        stroke: racket.stroke, speed: speed * 3.6, spin: spin / TAU,
        side, shotId: this.shotId, v: shotVec(b.v), w: shotVec(b.w),
        topspin: -b.w.x * side, sidespin: b.w.y, quality,
        power: racket.power, t: this.time,
        contact: racket.contact, elev: racket.elev, contactPoint: shotVec(contactP),
        timing: side > 0 ? (this.lastTiming || '') : '',
        sweet: side > 0 ? (this.lastSweet !== undefined ? this.lastSweet : 1) : 1,
        rim: side > 0 && this.lastSweet !== undefined && this.lastSweet < 0.42,
      };
      if (this.shotJournal) this.shotJournal.capture(this.swipe.gestureId, this.time,
        { ...racket, quality }, b, { grip: this.settings?.grip, hand: this.settings?.hand, shotId: this.shotId });
      this.ui && this.ui.showShot(this.lastShotInfo);
      this.recorder.addShot(1, Object.assign({
        x: contactP.x, y: contactP.y, z: contactP.z, quality,
      }, this.lastShotInfo));
      if (this.training) this.training.onPlayerHit(this.lastShotInfo, racket, contactP);
      this.moments.addContact(this.time, {
        by: 1, stroke: (racket.stroke && racket.stroke.id) || '?',
        speed: speed * 3.6, spin: spin / TAU, quality,
      });
      const sid = racket.stroke && racket.stroke.id;
      if (sid === 'LOOP' || sid === 'COUNTER') this.matchTasks.topspin++;
      else if (sid === 'SMASH') this.matchTasks.smash++;
      if (racket.isServe) this.matchTasks.serves++;
      this.buzz(Math.round(lerp(8, 26, clamp(speed / 90, 0, 1))));
      this.shakeIt(clamp(speed / 55, 0.03, 0.38) * 0.45, V3.new(rndSym(0.4), 0.5, 1));
      // Time is changed only by the player's separate slow-motion control.
      // refresh the landing preview
      if (this.settings.showPredict) {
        predict(V3.clone(b.p), V3.clone(b.v), V3.clone(b.w),
          { dt: 1 / 240, maxT: 2.4, stopOnFirstBounce: true, out: this.predictOut, path: this.predictPath });
      }
    } else {
      this.shakeIt(clamp(speed / 90, 0.02, 0.18), V3.new(rndSym(0.4), 0.4, -1));
      this.recorder.addShot(-1, {
        stroke: racket.stroke, speed: speed * 3.6, spin: spin / TAU,
        topspin: b.w.x, sidespin: b.w.y, quality, t: this.time,
        contact: racket.contact, elev: racket.elev,
        x: contactP.x, y: contactP.y, z: contactP.z,
        slip: !!(this.ai.lastShot && this.ai.lastShot.slip),
      });
      this.ui && this.ui.showAiShot(racket.stroke);
      this.moments.addContact(this.time, {
        by: -1, stroke: (racket.stroke && racket.stroke.id) || '?',
        speed: speed * 3.6, spin: spin / TAU, quality,
      });
    }
  }
```

## `awardPoint`

```js
  awardPoint(who, reason) {
    if (this.watchdog) this.watchdog.point();
    /* Гость в онлайне не ведёт счёт: хост единственный источник очков. Собственная
     * физика гостя может определить финал розыгрыша иначе и счёт разойдётся.
     * Гостю достаточно остановить мяч — следующий point-пакет синхронизирует счёт. */
    if (this.network.isInMatch && !this.network.isHost) {
      this.ball.live = false; this.ball.hist.length = 0;
      this.ball.trailGrade = null; this.ball.golden = null;
      return;
    }
    if (this.debugRecording) {
      this.logInput('point', { outcome: { winner: who, reason } });
      const press = this._debugLastPress;
      if (who < 0 && press && press.shotId === this.shotId && press.green && this.ball.lastHitBy === -1) {
        this.logInput('anomaly', { outcome: { reason: 'GREEN_PRESS_WITHOUT_RETURN', press,
          note: 'Observation only; inspect input, cancellation and physics_gate events for the cause.' } });
      }
    }
    if (this.training) {                 // drills have no score, only feedback
      if (this.shotJournal) this.shotJournal.point(who, reason, this.ball.lastHitBy, this.time);
      this.training.onFault(who, reason);
      this.ball.live = false;
      this.ball.hist.length = 0; this.ball.trailGrade = null; this.ball.golden = null;
      return;
    }
    if (this.state === GS.POINT || this.state === GS.MATCH_END) return;
    this._cancelPlayerWork();
    if (this.staminaEnabled()) this._pendingCredit = this._rallyId;
    /* очко закончилось — шлейф мёртвого мяча умирает вместе с ним,
     * а не висит «мерзкой полосой» до следующей подачи */
    this.ball.live = false;
    this.ball.hist.length = 0; this.ball.trailGrade = null; this.ball.golden = null;
    const idx = who > 0 ? 0 : 1;
    /* Свободная игра: мяч разыгрывается как обычно, но счёт не растёт —
     * партия не может закончиться, подача ротируется, розыгрыш идёт дальше. */
    if (!this.freePlay) this.score[idx]++;
    if (this.shotJournal) this.shotJournal.point(who, reason, this.ball.lastHitBy, this.time);
    const lh = this.ball.lastHitBy;
    this.stats.rallies++;
    this.lastPoint = { who, reason, at: this.time, seq: this.stats.rallies };
    this.buzz(who > 0 ? [14, 50, 22] : 42);
    if (this.rally > this.bestRally) this.bestRally = this.rally;
    if (who > 0) {
      if (lh === 1) this.stats.winners++;
    } else {
      const ownFault = lh === 1 || (this.isServeBall && this.server === 1 && lh === 0);
      if (ownFault) this.stats.errors++;
    }

    // why did that happen? one sentence, only when it helps
    this.lastSwipeLate = (this.time - this.lastSwipeT) > 0.75;
    this.pointNote = this.analyst.analyse(this.recorder, who, reason, this);
    if (this.pointNote && !this.training && this.ui) this.ui.showNote(this.pointNote);
    this.ai.onPointEnd(who);
    const h = this.director.onPoint(who, this.ai.levelIndex);
    this.ai.setHandicap(this.settings.adaptive ? h : 1);
    this.ai.setPressure(this.score[1], this.score[0], this.settings.targetScore);

    // serve rotation: every 2 points, every 1 from 10-10
    const deuce = this.score[0] >= this.settings.targetScore - 1 && this.score[1] >= this.settings.targetScore - 1;
    this.servesLeft--;
    if (deuce || this.servesLeft <= 0) { this.server = -this.server; this.servesLeft = deuce ? 1 : 2; }
    /* Онлайн-матч: хост всегда подаёт (подача гостя ещё не сведена, см. TODO),
     * поэтому после ротации подача всегда возвращается хосту. */
    if (this.network.isInMatch) { this.server = 1; this.servesLeft = 2; }

    this.audio.point(who > 0);
    /* Драма момента — текстом в том же баннере у табло и ростом толпы,
     * НЕ мусором в кадре: серия игрока, дьюс и матчбол названы явно. */
    const streak = this.director.streak;   // + = очки игрока подряд
    const tgt = this.settings.targetScore;
    const matchPoint = (this.score[0] >= tgt - 1 && this.score[0] > this.score[1]) ||
                       (this.score[1] >= tgt - 1 && this.score[1] > this.score[0]);
    let tag = '';
    if (matchPoint) tag = ET(who > 0 ? ' · МАТЧБОЛ' : ' · МАТЧБОЛ СОПЕРНИКА');
    else if (deuce) tag = ET(' · ДЬЮС');
    if (who > 0 && streak >= 3) {
      tag += ET(' · СЕРИЯ ×{n}', { n: streak });
      this.audio.applause(clamp(0.3 + (streak - 2) * 0.25, 0.3, 1.5));  // зал подхватывает серию
      this.audio.setCrowd(clamp(0.30 + streak * 0.10, 0, 0.9));
    }
    this.msg(ET(reason) + tag, 1.5, who > 0 ? '#6ee7a8' : '#ff8a8a', true);
    // the filter: keep this rally only if it is worth watching again
    this.lastMoment = this.moments.endRally(this.time, this, {
      winner: who, reason, score: this.score, target: this.settings.targetScore,
    });
    if (this.lastMoment && this.ui) this.ui.flashMoment(this.lastMoment, this.moments.kept.indexOf(this.lastMoment));
    this.setState(GS.POINT);
    this.shakeIt(0.5, V3.new(rndSym(1), 1, 0));

    const T = this.settings.targetScore;
    if ((this.score[0] >= T || this.score[1] >= T) && Math.abs(this.score[0] - this.score[1]) >= 2) {
      this.matchWinner = this.score[0] > this.score[1] ? 1 : -1;
    }
    // network: relay the point to the peer
    if (this.network.isInMatch) {
      this.network._send({ type: 'point', who, reason, score: this.score.slice() });
    }
    // career: the decisive perk arms itself on match point and pays out
    // on the player's next shot (see applyHit)
    if (this.career.active && this._careerDecisiveBoost > 0) {
      const isMatchPoint = (this.score[0] >= T - 1 && this.score[0] > this.score[1]) ||
                           (this.score[1] >= T - 1 && this.score[1] > this.score[0]);
      if (isMatchPoint) this._careerDecisiveActive = true;
    }
    this.ui && this.ui.syncScore();
    if (this.matchHudVisible()) {
      const id = ++this._hudEventId;
      this._matchResult = { id, who, reason, winner: this.matchWinner || 0 };
      this._matchEvent = { id, type: 'point', side: who };
      this._syncMatchHud(true);
    }
  }
```
