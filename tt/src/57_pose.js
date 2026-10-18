/* =====================================================================
 *  RACKET POSE — how the blade is actually held, from the body outward.
 *
 *  Before this module the bat had a face normal that came from the stroke
 *  and a "bank" that came from nowhere in particular. The whole postural
 *  model of the game was two lines:
 *
 *      padYaw = smooth(clamp(vel.x *  0.062, ±0.46))
 *      padRoll = smooth(clamp(vel.x * -0.040, ±0.30)) * handed
 *
 *  i.e. a transient twitch off the bat's lateral SPEED, and nothing else.
 *  Measured in Chromium (tt/tools/_pose.js) that produced:
 *
 *      park the bat at the far right of the table  -> yaw 0.1 deg, roll 0.1 deg
 *      move the mouse forward / back               -> 0.0 deg, exactly nothing
 *      switch the player to left-handed            -> the sign of that 0.1 deg
 *      hold the left mouse button                  -> nothing until release
 *
 *  which is the "there is code for it but nothing works" state. Velocity is
 *  also the wrong input: a hand that has finished moving still holds a
 *  posture, and that posture is what the eye reads.
 *
 *  This module replaces it with one model, and every term is a posture the
 *  body KEEPS, with the hand's motion layered on top of it:
 *
 *   1. STANCE  — where the bat is, left or right of the body. Reach to your
 *      right and the face opens right while the wrist banks so the handle
 *      stays out and the blade head comes in across the body. This is the
 *      loudest cue in real table tennis: it is what makes a forehand look
 *      like a forehand and a wide backhand look like a wide backhand, and
 *      it holds while you stand there, not only while you travel.
 *   2. DEPTH   — leaning in over the table CLOSES the face; sitting back
 *      OPENS it. Forward/back mouse travel finally does something.
 *   3. HEIGHT  — a high bat closes (you hit down through the ball), a low
 *      bat opens (you have to lift it). Players do this without thinking.
 *   4. MOTION  — the hand leads the blade. Bat velocity AND raw pointer
 *      velocity add a bounded wrist lead on all three axes. The pointer
 *      term matters on desktop: the mouse keeps moving after the bat has
 *      run out of reach at the edge of the box, and a real wrist keeps
 *      cocking when the arm can no longer travel.
 *   5. PRESS   — the click (or the finger landing) cocks the wrist: the
 *      face opens a touch, the yaw winds back toward the hip and the roll
 *      winds opposite the snap. It reaches full cock in ~60 ms, so a button
 *      press has an immediate physical answer before any travel happens.
 *   6. SNAP    — contact. The wrist whips through the ball: the face
 *      closes, the yaw carries across the body and the roll reverses, then
 *      all three decay over ~0.3 s. That decay IS the follow-through, and
 *      it is the reason a hit reads as a hit instead of a teleport.
 *
 *  ---------------------------------------------------------------------
 *  HANDEDNESS — why there is no `* handed` anywhere below.
 *
 *  A left-hander is a right-hander reflected in the sagittal plane, and
 *  that reflection is x -> -x. A reflection conjugates a rotation into its
 *  inverse: M·Ry(t)·M = Ry(-t) and M·Rz(t)·M = Rz(-t). So reflecting
 *  "righty reaching RIGHT, face open right, handle out right" gives "lefty
 *  reaching LEFT, face open left, handle out left" — the same posture, the
 *  same side of the body, mirrored in the world.
 *
 *  The consequence is the part the old code got wrong: once the lateral
 *  coordinate is expressed in BODY space (xnBody = worldX * side), the
 *  stance, depth, height, motion, press and snap terms are ALREADY mirror
 *  correct and must not be multiplied by a handedness sign. The old
 *  `* handed` on the roll did exactly that, which made a lefty bank the
 *  same way as a righty at the same WORLD x — the one thing a reflection
 *  can never do, and the reason switching hands looked like nothing.
 *
 *  Handedness genuinely enters in two places only, both of them real:
 *    · the GRIP angle the rig adds (±0.42 rad): the resting angle of that
 *      particular wrist around the handle, which is not a world direction
 *      and therefore does not mirror away;
 *    · WHICH side of the body counts as the FOREHAND (fhFlag below), used
 *      to scale the contact snap, because a forehand wrist snap is much
 *      stronger than a backhand one and those two sides swap between hands.
 *
 *  Everything is authored in BODY space (pitch/yaw/roll positive = closed /
 *  toward the player's right / handle toward the player's left) and only
 *  converted to world at the end, so the same class drives the player
 *  (side +1, facing -Z) and the opponent (side -1, facing +Z) with no
 *  special cases.
 * ===================================================================== */
'use strict';

const RACKET_POSE = {
  /* ---- authored limits, radians. These ARE the anatomy: the wrist has
   * no more range than this, so a pathological input (a teleported cursor,
   * a 4000 dpi flick) can never wind the blade into a corkscrew. Together
   * they bound the drawn face normal at cos(pitch)·cos(yaw) >= 0.89 of
   * straight ahead, which is what the browser regression suite checks. */
  pitch: 0.34,             // ±19 deg  open / closed
  yaw: 0.32,               // ±18 deg  face turned left / right
  roll: 0.42,              // ±24 deg  wrist bank on top of the grip angle
                           //          (the rig clamps its own extra roll to
                           //          RIG_EXTRA_ROLL = 0.44 and the total to
                           //          RIG_TOTAL_ROLL = 1.05)

  /* ---- the ready position. Slightly open, square to the table: the same
   * resting face the game has always had, so a bat at home looks at home. */
  restPitch: -0.05,        // -2.9 deg, normal.y = -0.05

  /* ---- 1. stance: where the bat is, left/right of the body.
   * Sign convention, stated once: the blade HEAD LAGS THE HAND. Reach (or
   * travel) to your right and the heavy head stays behind, so the handle
   * stands out toward the right and the head leans in across the body —
   * the same reason the bat banks when you step wide to cover a ball. Both
   * the stance and the velocity terms below use that one sign, so a bat
   * held at the right edge looks like the bat that just arrived there. */
  stanceYaw: 0.26,         // reach right -> the face opens right
  stanceRoll: 0.34,        // handle OUT toward the reach, head IN across

  /* ---- 2/3. depth and height posture */
  depthPitch: 0.22,        // leaning in over the table closes the face
  heightPitch: 0.17,       // a high bat closes, a low bat opens

  /* ---- 4. motion. Two sources, deliberately: the bat's own velocity is
   * what the body did, the pointer's velocity is what the hand is still
   * asking for after the bat hit the edge of its box. Measured: with only
   * the bat term, a mouse pushed past the reach limit produced nothing at
   * all, because the bat had stopped. */
  velYaw: 0.055, velYawMax: 0.16,      // per m/s of lateral bat travel
  velRoll: 0.040, velRollMax: 0.15,
  velPitch: 0.050, velPitchMax: 0.15,  // per m/s of forward bat travel
  ptrYaw: 0.045, ptrYawMax: 0.13,      // per normalised screen unit / s
  ptrPitch: 0.055, ptrPitchMax: 0.15,
  ptrRoll: 0.030, ptrRollMax: 0.11,
  ptrSpeedMax: 8,          // clamp on the raw pointer speed, units/s

  /* ---- 5. press: the click cocks the wrist */
  pressPitch: -0.11,       // taking it back opens the face a touch
  pressYaw: 0.11,          // and winds the face toward the reaching side
  pressRoll: 0.17,         // roll winds OPPOSITE the snap it is about to make
  pressIn: 26,             // 1/s -> two thirds cocked in ~40 ms, full in ~0.1 s
  pressOut: 10,            // the cock is spent, not released, at contact

  /* ---- 6. snap: contact, and the follow-through it decays into */
  snapPitch: 0.24,         // the wrist flexes: the face closes through the ball
  snapYaw: 0.15,           // and carries ACROSS the body
  snapRoll: 0.30,
  snapForehand: 1.50,      // a forehand snap is a real wrist whip ...
  snapBackhand: 0.55,      // ... a backhand one is mostly forearm
  snapDecay: 13.0,         // 1/s -> 96 % gone in 0.25 s: a readable follow-
                           //        through that is still back before the
                           //        next ball arrives
  snapDecayNoFollow: 30,   // settings.followThrough off: stop at the ball

  /* ---- smoothing, 1/s. The postural rates are slow enough that the blade
   * has mass; rateSnap takes over while the contact impulse is live, because
   * a wrist whip happens in ~50 ms and must not be smeared across a third of
   * a second by a filter tuned for standing still. */
  ratePitch: 15, rateYaw: 15, rateRoll: 13, rateSnap: 44,
};

/* The rig adds its own clamped extra roll (RIG_EXTRA_ROLL in 56_rig.js,
 * 0.40 rad). It is deliberately a little wider than RACKET_POSE.roll above
 * so an authored pose can never be silently truncated by the renderer. */

class RacketPose {
  /**
   * @param {object} [o]
   * @param {'right'|'left'} [o.hand]  which hand holds it
   * @param {number} [o.side]          +1 near side (faces -Z), -1 far side
   * @param {{x:number,y:number,z:number}} [o.home] ready position, world metres
   */
  constructor(o) {
    const opts = o || {};
    this.side = opts.side < 0 ? -1 : 1;
    this.hand = opts.hand === 'left' ? 'left' : 'right';
    this.home = opts.home ? { x: opts.home.x, y: opts.home.y, z: opts.home.z } : null;
    /* The near side's ready pose comes from the control mapping itself, so
     * "the neutral pose" can never drift away from "where the cursor parks
     * the bat". The far side is the same box reflected in the net. */
    if (!this.home) {
      const h = paddleTargetFromPointer(0.5, 0.55, 0.55, 1,
        { tx: 0, ty: 0, tz: 0 }, { zNear: PADDLE_LIMITS.zNear });
      this.home = { x: h.tx, y: h.ty, z: this.side > 0 ? h.tz : -h.tz };
    }
    this.pitch = RACKET_POSE.restPitch;
    this.yaw = 0;
    this.roll = 0;                 // BODY space: + = handle toward the left hand side
    this.rollWorld = 0;            // what the rig consumes
    this.normal = V3.new(0, Math.sin(this.pitch), -this.side * Math.cos(this.pitch));
    this.press = 0;                // 0..1 wrist cock, from the button/finger being down
    this.snap = 0;                 // 0..1 contact impulse, decays into the follow-through
    this.snapSide = 0;             // which side of the body that contact was on
    this.snapForehand = 1;         // 0 backhand .. 1 forehand, latched at contact
    this.xnBody = 0;               // cached lateral stance, body space
    this.ptrVel = { x: 0, y: 0 };  // smoothed raw pointer speed, screen units/s
    this._ptr = null;
    this._lastHand = this.hand;
  }

  /** +1 right-handed, -1 left-handed. */
  get H() { return this.hand === 'left' ? -1 : 1; }

  /** Switching hands must not teleport the blade: only the grip and the
   *  forehand/backhand flag change, and both are read fresh every frame. */
  setHand(h) {
    const next = h === 'left' ? 'left' : 'right';
    if (next === this.hand) return false;
    this.hand = next; this._lastHand = next;
    return true;
  }

  /** Back to the ready position, instantly. Called on every new point. */
  reset() {
    this.pitch = RACKET_POSE.restPitch;
    this.yaw = 0; this.roll = 0; this.rollWorld = 0;
    this.press = 0; this.snap = 0; this.snapSide = 0;
    this.ptrVel.x = 0; this.ptrVel.y = 0;
    this._ptr = null;
    this.xnBody = 0;
    return this._buildNormal();
  }

  /**
   * Contact. Fires the wrist snap; the decay afterwards is the
   * follow-through. Power scales it so a block barely flicks and a loop
   * whips right round.
   * @param {number} [power] 0..1
   */
  strike(power) {
    const P = RACKET_POSE;
    const p = clamp(Number.isFinite(power) ? power : 1, 0, 1.4);
    this.snapSide = clamp(this.xnBody * 2, -1, 1);
    this.snapForehand = this.forehandFlag(this.xnBody);
    this.snap = clamp(0.45 + 0.55 * p, 0, 1);
    this.press = 0;                 // the cock has been spent on the ball
    return this.snap;
  }

  /**
   * 0 on the backhand side of the body, 1 on the forehand side. THIS is
   * where handedness actually bites: for a right-hander the forehand is at
   * xnBody > 0, for a left-hander at xnBody < 0, and the reflection is
   * carried by the sign of H rather than by a sign on the whole model.
   */
  forehandFlag(xnBody) {
    return (clamp((xnBody || 0) * this.H * 3, -1, 1) + 1) * 0.5;
  }

  /** Reach box -> body-space normalised coordinates, all in [-1, 1]. */
  coords(inp) {
    const side = this.side, home = this.home;
    const L = Math.max(1e-3, Number.isFinite(inp.xLimit) ? inp.xLimit : PADDLE_LIMITS.x);
    /* zIn is the closest the bat may get to the net, zOut the furthest back.
     * Both are world z; the ranges are asymmetric on purpose, because
     * leaning in over the table covers nearly a metre while standing back
     * covers sixty centimetres, and each should still read as "full". */
    const zIn = Number.isFinite(inp.zIn) ? inp.zIn : (side > 0 ? PADDLE_LIMITS.zNear : -PADDLE_LIMITS.zFar);
    const zOut = Number.isFinite(inp.zOut) ? inp.zOut : (side > 0 ? PADDLE_LIMITS.zFar : -PADDLE_LIMITS.zNear);
    const yLo = Number.isFinite(inp.yLo) ? inp.yLo : PH.TABLE_Y + PADDLE_LIMITS.yLo;
    const yHi = Number.isFinite(inp.yHi) ? inp.yHi : PH.TABLE_Y + PADDLE_LIMITS.yHi;

    const x = Number.isFinite(inp.x) ? inp.x : home.x;
    const y = Number.isFinite(inp.y) ? inp.y : home.y;
    const z = Number.isFinite(inp.z) ? inp.z : home.z;

    const xn = clamp((x - home.x) / L, -1, 1) * side;      // + = the player's right
    const fwd = (home.z - z) * side;                       // + = toward the table
    const fwdRange = Math.max(0.05, (home.z - zIn) * side);
    const backRange = Math.max(0.05, (zOut - home.z) * side);
    const zn = clamp(fwd > 0 ? -fwd / fwdRange : -fwd / backRange, -1, 1);
    const dy = y - home.y;
    const yn = clamp(dy > 0 ? dy / Math.max(0.05, yHi - home.y)
      : dy / Math.max(0.05, home.y - yLo), -1, 1);
    return { xn, zn, yn };
  }

  /**
   * Advance one frame.
   *
   * @param {number} dt seconds
   * @param {object} inp
   *   hand {'right'|'left'}   · x,y,z bat position (world m)
   *   vx,vz bat velocity (world m/s) · ptrX,ptrY raw pointer (0..1 screen)
   *   zIn,zOut,yLo,yHi reach box (world) · pressing {boolean}
   *   followThrough {boolean} · isServe {boolean}
   * @returns {RacketPose} this
   */
  update(dt, inp) {
    const P = RACKET_POSE, o = inp || {};
    const step = clamp(Number.isFinite(dt) ? dt : 1 / 60, 1 / 480, 1 / 12);
    if (o.hand) this.setHand(o.hand);
    const side = this.side;

    /* ---- raw pointer speed, in screen units per second ------------- *
     * Tracked here rather than in the input layer because the pointer is
     * the one signal that survives the bat reaching the edge of its box,
     * and because it has to be smoothed to survive a 1000 Hz mouse. */
    if (Number.isFinite(o.ptrX) && Number.isFinite(o.ptrY)) {
      if (this._ptr) {
        const iv = 1 / Math.max(step, 1e-3);
        this.ptrVel.x = expSmooth(this.ptrVel.x, clamp((o.ptrX - this._ptr.x) * iv, -P.ptrSpeedMax, P.ptrSpeedMax), 22, step);
        this.ptrVel.y = expSmooth(this.ptrVel.y, clamp((o.ptrY - this._ptr.y) * iv, -P.ptrSpeedMax, P.ptrSpeedMax), 22, step);
      }
      this._ptr = this._ptr || { x: 0, y: 0 };
      this._ptr.x = o.ptrX; this._ptr.y = o.ptrY;
    } else { this.ptrVel.x = 0; this.ptrVel.y = 0; this._ptr = null; }

    const c = this.coords(o);
    this.xnBody = c.xn;

    /* bat and pointer velocity, both in body space */
    const vxBody = (Number.isFinite(o.vx) ? clamp(o.vx, -9, 9) : 0) * side;
    const vFwd = -(Number.isFinite(o.vz) ? clamp(o.vz, -9, 9) : 0) * side;
    const pxBody = this.ptrVel.x * side;
    const pFwd = -this.ptrVel.y;                  // screen up = toward the table

    /* ---- press / snap envelopes ----------------------------------- */
    const wantPress = o.pressing ? 1 : 0;
    this.press = expSmooth(this.press, wantPress, wantPress ? P.pressIn : P.pressOut, step);
    /* Both ends snap shut. A button held down is a posture the player is
     * keeping, so it has to arrive and then stop moving; the same goes for
     * letting go. Without the snaps the envelope asymptotes forever. */
    if (this.press < 1e-4) this.press = 0;
    else if (this.press > 1 - 1e-4) this.press = 1;
    const decay = o.followThrough === false ? P.snapDecayNoFollow : P.snapDecay;
    this.snap = expSmooth(this.snap, 0, decay, step);
    if (this.snap < 1e-4) this.snap = 0;

    const fh = this.forehandFlag(c.xn);
    const reach = clamp(c.xn * 2, -1, 1);         // full at half the box width
    const cock = this.press, snap = this.snap;
    const snapK = lerp(P.snapBackhand, P.snapForehand, this.snapForehand);
    const serveK = o.isServe ? 0.7 : 1;           // a serve toss is a smaller wrist

    /* ---- 1..4. the posture the body holds -------------------------- */
    let pitchT = P.restPitch
      + c.yn * P.heightPitch                       // high -> close, low -> open
      - c.zn * P.depthPitch                        // in -> close, back -> open
      + clamp(vFwd * P.velPitch, -P.velPitchMax, P.velPitchMax)
      + clamp(pFwd * P.ptrPitch, -P.ptrPitchMax, P.ptrPitchMax);

    let yawT = c.xn * P.stanceYaw
      + clamp(vxBody * P.velYaw, -P.velYawMax, P.velYawMax)
      + clamp(pxBody * P.ptrYaw, -P.ptrYawMax, P.ptrYawMax);

    let rollT = -c.xn * P.stanceRoll
      + clamp(-vxBody * P.velRoll, -P.velRollMax, P.velRollMax)
      + clamp(-pxBody * P.ptrRoll, -P.ptrRollMax, P.ptrRollMax);

    /* ---- 5. the cock: wind back, opposite everything the snap does -- */
    pitchT += cock * P.pressPitch;
    yawT += cock * c.xn * P.pressYaw;
    rollT += cock * reach * P.pressRoll;

    /* ---- 6. the snap: whip through the ball, then follow through ---- */
    pitchT += snap * P.snapPitch * snapK * serveK;
    yawT -= snap * this.snapSide * P.snapYaw * snapK;
    rollT -= snap * this.snapSide * P.snapRoll * snapK;

    /* ---- clamp to the anatomy, then give the blade some mass -------- *
     * Two time scales, not one. Posture drifts (15/s: the blade has mass
     * and a body under it), contact snaps (44/s while the impulse is live:
     * a wrist whip is over in ~50 ms and must not be smeared by a filter
     * tuned for standing still). The blend is the snap envelope itself, so
     * the fast rate fades out exactly as the follow-through does.
     *
     * `approach` snaps onto the target once it is within 1e-9 of it, which
     * makes ANY steady input an exact fixed point rather than an asymptote.
     * That is not cosmetic: the regression suite runs twelve idle seconds at
     * 30/60/120 FPS and requires the normal not to move by 1e-8, and a pose
     * that forever chases its own target by 1e-12 per frame also forever
     * re-normalises, re-clamps and re-reads as "still moving". */
    const boost = this.snap;
    const approach = (cur, target, base, lo, hi) => {
      const t = clamp(target, lo, hi);
      return clamp(Math.abs(t - cur) < 1e-9 ? t : expSmooth(cur, t, lerp(base, P.rateSnap, boost), step), lo, hi);
    };
    this.pitch = approach(this.pitch, pitchT, P.ratePitch, -P.pitch, P.pitch);
    this.yaw = approach(this.yaw, yawT, P.rateYaw, -P.yaw, P.yaw);
    this.roll = approach(this.roll, rollT, P.rateRoll, -P.roll, P.roll);
    /* -0 would survive a deepEqual against 0 as a difference, and a blade
     * that is not banked is not banked either way round. */
    this.rollWorld = this.roll === 0 ? 0 : this.roll * side;

    return this._buildNormal();
  }

  /** Body-space angles -> the world face normal. */
  _buildNormal() {
    const cp = Math.cos(this.pitch), cy = Math.cos(this.yaw), n = this.normal;
    n.x = Math.sin(this.yaw) * cp * this.side;
    n.y = Math.sin(this.pitch);
    n.z = -this.side * cy * cp;
    return V3.norm(n, n);
  }

  /** Yaw expressed in WORLD x, which is what deriveStroke's azFace expects:
   *  it builds the normal with plain sin(azFace) on x and -side on z, so a
   *  positive azFace always opens toward world +x regardless of side. */
  get yawWorld() { return this.yaw * this.side; }

  /** Degrees, for the debug overlay. */
  readout() {
    return 'pitch ' + (this.pitch / DEG).toFixed(1) + '\u00b0  yaw ' + (this.yaw / DEG).toFixed(1)
      + '\u00b0  roll ' + (this.roll / DEG).toFixed(1) + '\u00b0'
      + '  cock ' + (this.press * 100).toFixed(0) + '%  snap ' + (this.snap * 100).toFixed(0) + '%';
  }
}
