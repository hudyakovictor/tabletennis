/* =====================================================================
 *  GAME RENDERER
 *  Изолированная отрисовка динамических объектов и эффектов.
 *  Вынесено из 70_game.js.
 * ===================================================================== */
'use strict';

function drawGameDynamic(game, shadowPass) {
    if (game.state === GS.MENU && game.lobbyScene?.active) { game.lobbyScene.draw(shadowPass); return; }
    const R = game.R, S = game.scene, me = S.mesh, ma = S.mat;
    const tmp = S._tmp;
    const d = shadowPass
      ? (mesh, mat4, mat) => R.drawShadow(mesh, mat4, null, 0)
      : (mesh, mat4, mat) => R.draw(mesh, mat4, mat);

    /* ball: зелёный мяч — единственный носитель «бей сейчас».
     * Прежняя логика («зелёный = мяч внутри бокса захвата») по замерам в
     * живом матче давала 1 кадр, 17–33 мс: сигнал загорался в тот же миг,
     * когда удар уже случается, и глазами не ловился.
     * Трасса приёма покадрово: окно вообще открывается лишь после отскока
     * на своей стороне и live 2–4 кадра (eta на момент открытия 0.09–0.18 с)
     * — это физический предел честного «бей сейчас». Поэтому тон считается
     * по ВРЕМЕНИ до контакта: с 0.30 с мяч трогается зелёным, с 0.15 с он
     * уже целиком зелёный и держит цвет до удара — то есть зелёный ВСЁ
     * подлетное окно, а не последний кадр.
     * Тонировка идёт по альбедо (сам мяч зелёный), а не по rim-блику:
     * «ёмит+обводка» читались как едва заметный зелёный зайчик.
     * Спекуляр приглушён — белый блик на стеклянном шаре съедал цвет. */
    const STRIKE_FULL = 0.15;
    // помощь хосту (g.hintContact): заевшемуся игроку мяч зеленеет заранее
    const STRIKE_LEAD = game.hintContact ? 0.45 : 0.30;
    const pointBall = !game.replayer?.on && (game.state === GS.POINT || game.state === GS.MATCH_END) && game._pointBall;
    if (game.ball.live || game.state === GS.SERVE_READY || game._idleStill || pointBall) {
      const BS = (game._cal && game._cal.ballSize !== undefined) ? (0.8 + game._cal.ballSize * 0.5) : 1;
      const visualBall = pointBall || game.ball;
      M4.compose(tmp.m, visualBall.p, visualBall.q, V3.set(tmp.scl, BS, BS, BS));
      const hints = game.hintContact !== false && !(typeof gameplayCalibrationLocked === 'function' && gameplayCalibrationLocked(game));
      const gk = shadowPass || !hints || pointBall ? 0 : strikeGreenTint(game._strike, STRIKE_LEAD, STRIKE_FULL);
      if (gk > 0.02) {
        let gm = game._ballGreen;
        if (!gm) {
          gm = game._ballGreen = Object.assign({}, ma.ball);
          // Object.assign делит массивы с базовым материалом — own copies
          gm.color = ma.ball.color.slice();
          gm.emissive = ma.ball.emissive.slice();
        }
        const bc = ma.ball.color, be = ma.ball.emissive, c = gm.color, e = gm.emissive;
        c[0] = lerp(bc[0], 0.26, gk); c[1] = lerp(bc[1], 1.0, gk); c[2] = lerp(bc[2], 0.42, gk);
        e[0] = lerp(be[0], 0.03, gk); e[1] = lerp(be[1], 0.42, gk); e[2] = lerp(be[2], 0.13, gk);
        gm.specTint = lerp(ma.ball.specTint, 0.35, gk);
        gm.rim = lerp(ma.ball.rim, 0.12, gk);
        gm.rimCol = [0.3, 1.0, 0.45]; gm.rimPower = 2.8;
        d(me.ball, tmp.m, gm);
      } else {
        d(me.ball, tmp.m, ma.ball);
      }
    }

    /* Paddle-only rendering. Physics and visuals share the same face normal;
       rendering must not mutate the simulation's orientation. */
    if (game.playerPaddleVisible) {
      const pp = game.player;
      const trickPose = game.paddleTrick?.pose(pp);
      game.rig.draw(R, S, {
        pos: trickPose?.pos || pp.pos, normal: pp.normal,
        q: trickPose?.q || (pp.poseReady && !game._idleStill ? pp.q : undefined), hand: game.settings.hand, shadowPass,
        swing: pp.swing, roll: pp.roll || 0, absoluteRoll: true,
        mats: game.paddleMats(S, game.equip),
        racket: game._equippedRacket, activeFace: pp.activeFace,
      });
    }

    // Opponent paddle; no hand, forearm or sleeve geometry.
    const ap = game.aiPaddle;
    if (game._idleStill) {
      /* Витрина: ракетка ИИ лежит плашмя на дальней половине стола —
       * та же заготовка, что и у игрока в stageIdleArena. */
      const flat = V3.set(V3.new(), 0.05, 1, -0.16); V3.norm(flat, flat);
      game.rig.draw(R, S, {
        pos: game.ai.pos, normal: flat, hand: game.settings.hand === 'right' ? 'left' : 'right',
        swing: 0, roll: 0, mats: game.paddleMats(S, game.aiEquip), shadowPass,
        racket: 'r-standard',
      });
      return;
    }
    game.rig.draw(R, S, {
      pos: ap.pos, normal: ap.normal, q: ap.poseReady ? ap.q : undefined, hand: game.ai.hand || 'right',
      swing: 0, roll: ap.roll ?? game.ai.roll ?? .28, absoluteRoll: true,
      mats: game.paddleMats(S, game.aiEquip), shadowPass,
      racket: 'r-standard', activeFace: ap.activeFace,
    });

  }

function drawGameFX(game) {
    const R = game.R, S = game.scene, me = S.mesh;
    const tmp = S._tmp;
    /* trail */
    game.buildTrail();
    if (me.trail.count) {
      /* Trail = the VERDICT on your input, not the spin family:
       *  green  = perfect place AND perfect timing (nearly always a winner),
       *  yellow = counted, but on the edge of a miss,
       *  red    = wrong place or wrong time.
       *  The opponent's returns keep the old spin palette. */
       const ts = game.ball.trailStroke || (game.lastShotInfo && game.lastShotInfo.stroke) || null;
       const hex = (ts && ts.col) ? ts.col : '#a0b4c8';
       const col = [parseInt(hex.slice(1,3),16)/255, parseInt(hex.slice(3,5),16)/255, parseInt(hex.slice(5,7),16)/255];
       const k = 0.9;
       const grade = game.ball.trailGrade && game.ball.lastHitBy === 1 ? game.ball.trailGrade : null;
       R.draw(me.trail, M4.identity(tmp.m), {
         color: [col[0], col[1], col[2]], rough: 1, blend: 'add', doubleSided: true, unlit: 1,
         emissive: [col[0] * k * 1.4, col[1] * k * 1.4, col[2] * k * 1.4], opacity: grade ? 0.8 : 0.3,
       });
    }

    /* bounce marks */
    for (const mk of game.marks) {
      const a = clamp(1 - mk.t / mk.life, 0, 1);
      const sz = mk.s * (1 + (1 - a) * 1.8);
      M4.compose(tmp.m, V3.new(mk.x, PH.TABLE_Y + 0.0035, mk.z),
        Q.setAxisAngle(Q.new(), 1, 0, 0, -Math.PI / 2), V3.new(sz, sz, sz));
      R.draw(me.quad, tmp.m, {
        color: [1, 1, 1], tex: game.scene.tex.ring, blend: 'add', doubleSided: true,
        emissive: [a * 0.9, a * 0.85, a * 0.6], rough: 1,
      });
    }

    /* predicted landing spot: без пульсации — мигающая метка на столе
     * только шумела, место приземления читается и статичной */
    if (game.settings.showPredict && game.ball.live && game.predictOut.landed && game.ball.lastHitBy === 1) {
      const L = game.predictOut.landed;
      M4.compose(tmp.m, V3.new(L.x, PH.TABLE_Y + 0.004, L.z),
        Q.setAxisAngle(Q.new(), 1, 0, 0, -Math.PI / 2), V3.new(0.055, 0.055, 0.055));
      R.draw(me.quad, tmp.m, {
        color: [1, 1, 1], tex: game.scene.tex.ring, blend: 'add', doubleSided: true,
        emissive: [0.15, 0.95, 0.55], rough: 1,
      });
    }

    /* contact flash — один сдержанный ореол в ЗАМРОЖЕННОЙ точке контакта.
     * Ни шлейф, ни частицы его не порождают и не гасят; цвет = принятый
     * удар, а не вердикт и не косметика инвентаря. */
    const flashes = game.contactFlashes || [];
    for (let i = 0; i < flashes.length; i++) {
      const f = flashes[i];
      const age = clamp((game.time - f.birth) / f.life, 0, 1);
      const a = (1 - age) * (1 - age);
      /* Квад стартует с 1.5 диаметров мяча, а не с его собственного размера:
       * сфера мяча пишется с depth-mask, а пульса — аддитивно поверх уже
       * готового кадра, поэтому квад диаметра мяча ЗАЦИКЛИВАЕТСЯ силуэтом
       * мяча целиком (замер в живом рендере: 0 изменённых пикселей в пике).
       * 1.5 → 2.2 диаметра оставляют ядро мяча нетронутым (он по-прежнему
       * ярчайший и самый чёткий) и дают читаемое цветное кольцо вокруг него. */
      const sz = PH.R * (CONTACT_FLASH_W0 + age * CONTACT_FLASH_W1);
      game.billboard(tmp.m, f.p, sz, 0);
      R.draw(me.quad, tmp.m, {
        color: [1, 1, 1], tex: game.scene.tex.glow, blend: 'add', doubleSided: true, unlit: 1,
        emissive: [f.r, f.g, f.b], rough: 1, opacity: a * CONTACT_FLASH_OPACITY,
      });
    }

    /* particles */
    const P = game.particles;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) continue;
      if (P.trail?.[i] && (!game.settings.showTrail || game.reducedMotion || game._calValues.trailLen <= 0)) continue;
      const a = P.life[i] / P.maxLife[i];
      const sz = P.size[i] * (0.4 + a * 1.4);
      game.billboard(tmp.m, V3.new(P.p[i * 3], P.p[i * 3 + 1], P.p[i * 3 + 2]), sz, 0);
      R.draw(me.quad, tmp.m, {
        color: [1, 1, 1], tex: game.scene.tex.glow, blend: 'add', doubleSided: true,
        emissive: [P.col[i * 3] * a * 1.6, P.col[i * 3 + 1] * a * 1.6, P.col[i * 3 + 2] * a * 1.6], rough: 1,
      });
    }

    /* Свечение вокруг мяча убрано: аддитивный ореол поверх и без того
     * светлого мяча размывал его силуэт именно там, где надо бить.
     * Мяч держится в кадре за счёт emissive в материале и тёмной арены. */
}
