/* =====================================================================
 *  PLAYER PADDLE CONTROLLER
 *  Чистое, изолированное управление позицией, позой и сбросом ракетки игрока.
 *  Переписано с нуля без конфликтующих костылей (serveSlide, recenterT,
 *  самопроизвольного step-in при подаче соперника).
 * ===================================================================== */
'use strict';

function resetPlayerPaddleState(game, hard) {
  game.cancelPaddleTrick();
  const pad = game.player;
  const poseRoll = pad.roll;
  const broken = ![pad.pos.x, pad.pos.y, pad.pos.z].every(Number.isFinite);
  const resetPosition = hard || broken;

  if (resetPosition || !game.pointer || !Number.isFinite(game.pointer.x) || !Number.isFinite(game.pointer.y)) {
    game.pointer = { x: 0.5, y: 0.55 };
    game.pointerInside = true;
  }

  game.pointerDown = false;
  game.padYaw = 0;
  game.padRoll = (game.settings.hand === 'left' ? -1 : 1)
    * (game.settings.grip === 'penhold' ? Math.PI - 0.052 : 0.28) * game.playerActiveFace;
  game.padPitch = -(game.settings.grip === 'penhold' ? 5 : 15) * Math.PI / 180;

  if (game.paddleMotion) game.paddleMotion.reset();
  if (game.paddleReadClock) game.paddleReadClock.reset();
  if (game.strikeReadClock) game.strikeReadClock.reset();
  if (game._strike) { game._strike.on = false; game._strike.k = 0; }
  if (resetPosition) pad.forehand = true;

  pad.motionStage = 'ready';
  game.liveStroke = null;
  game._prep = 0;
  game._settlePaddleFace = false;
  game.mouseTrail = [];
  pad.yaw = 0;
  pad.pitch = game.padPitch;
  pad.roll = game.padRoll;

  if (game.followThrough) game.followThrough.active = false;
  game.recenterT = 0;
  game.tossQueued = false;
  game.tossQueuedAt = -9;
  game.swipe.cancel();

  if (game._paddlePred) game._paddlePred.reach = null;
  if (game._strikePred) game._strikePred.reach = null;
  if (game._volleyPred) game._volleyPred.reach = null;

  if (resetPosition) {
    V3.set(pad.pos, PADDLE_HOME.x, PADDLE_HOME.y, PADDLE_HOME.z);
    V3.copy(pad.prevPos, pad.pos);
    V3.copy(pad.prev, pad.pos);
    V3.zero(pad.vel);
    V3.set(pad.normal, 0, Math.sin(game.padPitch), -Math.cos(game.padPitch));
    pad.activeFace = game.playerActiveFace;
    paddlePoseQuaternion(V3.mul(V3.new(), pad.normal, pad.activeFace), pad.roll, pad.q || (pad.q = Q.new()));
    pad.poseReady = true;
  } else {
    const face = paddleFaceAngles(pad.normal);
    game.padYaw = pad.yaw = face.yaw;
    game.padPitch = pad.pitch = face.pitch;
    game.padRoll = pad.roll = Number.isFinite(poseRoll) ? poseRoll : game.padRoll;
  }

  pad.swing = 0;
  game._ptTarget = { tx: pad.pos.x, ty: pad.pos.y, tz: pad.pos.z };
  game._paddleHold = null;
  if (!resetPosition) game.holdPaddlePose();
}

function updatePlayerPaddleState(game, dt, strokeDt = dt) {
  game.updatePaddleTrick();
  const cfg = STROKE_CONFIG.racket;
  const pad = game.player;

  if (!Number.isFinite(pad.pos.x) || !Number.isFinite(pad.pos.y) || !Number.isFinite(pad.pos.z)) {
    V3.set(pad.pos, PADDLE_HOME.x, PADDLE_HOME.y, PADDLE_HOME.z);
  }
  V3.copy(pad.prev, pad.pos);
  pad.prevPos = pad.prevPos || V3.clone(pad.pos);
  V3.copy(pad.prevPos, pad.pos);
  if (!Number.isFinite(game.padYaw)) game.padYaw = 0;
  if (!Number.isFinite(game.padPitch)) game.padPitch = -0.26;
  if (!Number.isFinite(game.padRoll)) game.padRoll = 0;

  let pt = game.pointer || { x: 0.5, y: 0.55 };
  if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
    pt = { x: 0.5, y: 0.55 };
    game.pointer = pt;
  }

  const calSpeedK = (game._cal && Number.isFinite(game._cal.padSpeed))
    ? lerp(0.84, 1.20, clamp(game._cal.padSpeed, 0, 1)) : 1;
  const sens = clamp((Number.isFinite(MATCH_RULES.sensitivity) ? MATCH_RULES.sensitivity : 1) * calSpeedK, 0.55, 2.0);
  const px = clamp(0.5 + (pt.x - 0.5) * sens, 0, 1);
  const py = clamp(0.5 + (pt.y - 0.5) * sens, 0, 1);

  // Глубина ракетки: по умолчанию стойка PADDLE_STANCE_Z.
  // Сдвигается к мячу ТОЛЬКО когда игрок сам нажал и приём принят (pressFoot).
  const pressFoot = !!(game.swipe && game.swipe.pressZone &&
    game.swipe.pressZone.accepted === true && game.swipe.pressZone.shotId === game.shotId &&
    game.state === GS.RALLY && game.ball && game.ball.live && game.ball.lastHitBy === -1 &&
    game.ball.p && game.ball.p.z > PADDLE_LIMITS.zStepIn - 0.35);

  const wantFootZ = pressFoot
    ? clamp(game.ball.p.z - 0.02, PADDLE_LIMITS.zStepIn, PADDLE_STANCE_Z)
    : PADDLE_STANCE_Z;
  game._footZ = expSmooth(Number.isFinite(game._footZ) ? game._footZ : PADDLE_STANCE_Z, wantFootZ, pressFoot ? 24 : 14, dt);

  const t = pointerBladeSolve(
    game._liveRig,
    game.R.aspect(),
    px,
    py,
    {
      out: game._ptTarget || (game._ptTarget = { tx: 0, ty: 0, tz: 0 })
    }
  );

  const lim = paddleLimitsFor(t.tz);
  const tx = clamp(clamp(t.tx, -REACH_SHELL.xHard, REACH_SHELL.xHard), -lim.x, lim.x);
  const ty = clamp(t.ty, PH.TABLE_Y + lim.yLo, PH.TABLE_Y + lim.yHi);
  const tz = clamp(t.tz, PADDLE_LIMITS.zStepIn, PADDLE_LIMITS.zFar);

  game._reachFwd = expSmooth(game._reachFwd || 0, t.reachFwd || 0, 9, dt);
  game._reachTilt = game._reachFwd * REACH_SHELL.arcTilt;

  const calRate = (game._cal && Number.isFinite(game._cal.padSmooth))
    ? lerp(1 / cfg.trackingLagRange[0], 1 / cfg.trackingLagRange[1], clamp(game._cal.padSmooth, 0, 1))
    : 1 / cfg.trackingLag;

  game._padTarget = { tx, ty, tz, rate: calRate, lock: false, footZ: game._footZ };
  const destination = V3.set(game._padDestination || (game._padDestination = V3.new()), tx, ty, tz);
  stepPaddlePosition(pad.pos, destination, calRate, dt, cfg.maxSpeed);
  V3.sub(pad.vel, pad.pos, pad.prevPos);

  pad.forehand = paddleForehand(pad.pos.x, game.settings.hand, pad.forehand);
  const wrist = playerWristPose(pad.pos, pad.vel, game.settings.hand, {
    grip: game.settings.grip,
    forehand: pad.forehand,
    activeFace: game.playerActiveFace,
    reachTilt: game._reachTilt || 0
  });

  if (game.state === GS.SERVE_READY || game.state === GS.SERVE_TOSS) {
    // На подаче держим ракетку ровно, без случайных разворотов торцом
    const servePitch = -(game.settings.grip === 'penhold' ? 5 : 15) * Math.PI / 180;
    game.padYaw = expSmooth(game.padYaw, 0, 16, dt);
    game.padPitch = expSmooth(game.padPitch, servePitch, 16, dt);
    game.padRoll = expSmooth(game.padRoll, wrist.roll, 16, dt);
  } else {
    game.padYaw = expSmooth(game.padYaw, wrist.yaw, cfg.poseSmooth, dt);
    game.padPitch = expSmooth(game.padPitch, wrist.pitch, cfg.poseSmooth, dt);
    game.padRoll = expSmooth(game.padRoll, wrist.roll, cfg.poseSmooth, dt);
  }

  pad.yaw = game.padYaw;
  pad.pitch = game.padPitch;
  pad.roll = game.padRoll;
  pad.activeFace = game.playerActiveFace;
  pad.swing = expSmooth(pad.swing || 0, clamp(V3.len(pad.vel) / 8, 0, 1), 16, dt);

  V3.set(
    pad.normal,
    Math.sin(pad.yaw) * Math.cos(pad.pitch),
    Math.sin(pad.pitch),
    -Math.cos(pad.yaw) * Math.cos(pad.pitch)
  );
  V3.norm(pad.normal, pad.normal);
  paddlePoseQuaternion(V3.mul(V3.new(), pad.normal, pad.activeFace), pad.roll, pad.q || (pad.q = Q.new()));
  enforcePaddleTableClearance(pad.pos, pad.normal, pad.roll, 0.006, PH.TABLE_Y, PH.T_HALF_WID, PH.T_HALF_LEN, pad.q);

  if (!Number.isFinite(pad.pos.x) || !Number.isFinite(pad.pos.y) || !Number.isFinite(pad.pos.z)) {
    V3.set(pad.pos, PADDLE_HOME.x, PADDLE_HOME.y, PADDLE_HOME.z);
  }
  if (!Number.isFinite(pad.normal.x) || !Number.isFinite(pad.normal.y) || !Number.isFinite(pad.normal.z)) {
    V3.set(pad.normal, 0, -0.25, -0.96);
  }
  if (!Number.isFinite(pad.roll)) pad.roll = game.padRoll = 0.28;
  if (!Number.isFinite(pad.swing)) pad.swing = 0;
  if (!pad.q || !Number.isFinite(pad.q[0]) || !Number.isFinite(pad.q[1]) || !Number.isFinite(pad.q[2]) || !Number.isFinite(pad.q[3])) {
    pad.q = pad.q || Q.new();
    pad.q[0] = 0; pad.q[1] = 0; pad.q[2] = 0; pad.q[3] = 1;
  }

  V3.mul(pad.vel, V3.sub(pad.vel, pad.pos, pad.prevPos), 1 / Math.max(dt, 1e-4));
  pad.poseReady = false;
}
