/* =====================================================================
 *  PADDLE-ONLY RIG
 *  Local +Z is the red face normal; the handle extends along local -Y.
 *  No hand/arm geometry. Drawing is a pure consumer of the gameplay pose.
 * ===================================================================== */
'use strict';

/* ------------------------------------------------------------------ *
 *  GRIP PROFILES — how the player actually holds the bat.             *
 *                                                                     *
 *  shakehand (European): ready pose has the blade in front of the     *
 *  body, face tipped 10-20 deg forward off vertical — the natural     *
 *  "ready to drive" nod. Relaxed wrist, never a rigid 12 o'clock.     *
 *                                                                     *
 *  penhold (Asian): the blade hangs almost VERTICALLY (0-10 deg off   *
 *  vertical) with the HANDLE POINTING UP. In this rig "handle up" is  *
 *  not a new mesh: a paddle rolled PI about its face normal has its   *
 *  handle (local -Y) in the air. The blade ellipse is 180-deg         *
 *  symmetric, so that rotation is visually free, and the rubber       *
 *  colours stay glued to their surfaces. Left/right stays a mirror:   *
 *  roll = PI + h·(offsets), because a rotation of PI+a about the      *
 *  normal mirrored across x is a rotation of PI-a about the mirrored  *
 *  normal (rot(Rn,-(PI+a)) = rot(Rn,PI-a) mod 2PI).                   *
 * ------------------------------------------------------------------ */
const GRIPS = {
  shakehand: {
    restPitch: -0.24,      // ~14 deg forward off vertical (brief: 10-20 deg)
    restRoll: 0.28,        // relaxed ready grip (~16 deg)
    rollLo: -1.05, rollHi: 1.35,
    reachYaw: 0.27,
    handleUp: false,
    handleScale: 1,
  },
  penhold: {
    restPitch: -0.10,      // ~6 deg off vertical (brief: 0-10 deg), handle up
    restRoll: 0.10,        // blade nearly at 12 o'clock around the normal
    rollLo: -0.45, rollHi: 0.62,   // wrist-led fan, much smaller than shakehand
    reachYaw: 0.38,        // penhold covers the wing with the wrist, not the shoulder
    handleUp: true,
    handleScale: 0.62,     // a penhold handle is visibly shorter (Japanese/Chinese style)
  },
};
const PENHOLD_ROLL_BASE = Math.PI;
function gripOf(grip) { return GRIPS[grip] || GRIPS.shakehand; }
/** The rest pitch of a grip — the baseline the physics yaw/pitch are relative to. */
function gripRestPitch(grip) { return gripOf(grip).restPitch; }
/** Absolute ready roll for a hand+grip pair (penhold lives near PI). */
function readyRollFor(hand, grip) {
  const g = gripOf(grip), h = hand === 'left' ? -1 : 1;
  return (g.handleUp ? PENHOLD_ROLL_BASE : 0) + h * g.restRoll;
}

/* ------------------------------------------------------------------ *
 *  STROKE CONTACT POSE — the two angles that ARE the language of a    *
 *  shot when there is no arm mesh:                                    *
 *                                                                     *
 *    tilt — bat angle from vertical at contact, radians.              *
 *           negative = closed (leaning into the ball), positive = open*
 *           Real shakehand bands: drive 10-20 deg fwd, topspin        *
 *           30-50 deg fwd, chop 20-40 deg open, block 0-15 deg.       *
 *    turn — wrist roll signature AROUND the face normal (rad).        *
 *           Applied as h*turn, so a left-hander mirrors it exactly —  *
 *           the coach's "-10 deg edge-out" is the same line of code   *
 *           for both hands, only the sign flips.                      *
 *                                                                     *
 *  Penhold plays the same shots more from the wrist with a smaller    *
 *  closed range (10-30 deg on the forehand), so the table is          *
 *  compressed into the classic band rather than re-authored.          *
 * ------------------------------------------------------------------ */
const STROKE_POSE = {
  LOOP: { tilt: -0.70, turn: 0.14 },        // 40 deg closed, winding over the ball
  COUNTER: { tilt: -0.60, turn: 0.10 },     // 34 deg closed, on the rise
  DRIVE: { tilt: -0.26, turn: 0.06 },       // 15 deg closed, minimal rotation
  SMASH: { tilt: -0.49, turn: 0.08 },       // 28 deg closed, finishing down
  FLICK: { tilt: -0.38, turn: 0.16 },       // wrist snap over the table
  PUSH: { tilt: 0.52, turn: -0.10 },        // 30 deg open, slicing under
  CHOP: { tilt: 0.61, turn: -0.16 },        // 35 deg open, heavy backspin
  BLOCK: { tilt: -0.12, turn: 0.00 },       // 7 deg closed, almost square
  LOB: { tilt: 0.10, turn: 0.05 },          // slightly open, lifting deep
  HOOK: { tilt: -0.31, turn: -0.20 },       // wrapping around the outside
  FADE: { tilt: -0.31, turn: 0.20 },        // inside-out side of the ball
  DROP: { tilt: 0.45, turn: -0.06 },        // open and soft at the net
  SERVE_TOP: { tilt: -0.49, turn: 0.12 },
  SERVE_BACK: { tilt: 0.70, turn: -0.14 },  // wide open, pure underside
  SERVE_SIDE: { tilt: -0.21, turn: 0.24 },  // face does the talking
  SERVE_FAST: { tilt: -0.35, turn: 0.00 },  // flat and through
};
function strokePose(strokeId, grip) {
  const p = STROKE_POSE[strokeId];
  if (!p) return null;
  const g = gripOf(grip);
  if (!g.handleUp) return p;
  /* Classic penhold: closed angles compressed into the 10-30 deg wrist
     band, open angles kept nearly full (there is no reverse-backhand
     model here — the same face works both wings). */
  return {
    tilt: p.tilt < 0 ? p.tilt * 0.68 : p.tilt * 0.85,
    turn: p.turn * 0.85,
  };
}

/**
 * Shakehand-inspired player pose, in world/player coordinates.
 * Local +Y points from grip to blade head. All targets are absolute:
 * lateral reach sets forehand/backhand stance; phase adds wrist motion.
 * Reflecting x, velocity.x, ballX and handedness reflects the entire pose.
 *
 * Drivers — each is a real thing a shakehand player does with the bat:
 *   1. pos.x         lateral reach → yaw + FH/BH clock roll
 *   2. pos.y         height → close a smash, open a push
 *   3. pos.z         depth → open over the table, close off it
 *   4. vel.x         lead the step with the face
 *   5. vel.y         lift opens, drop closes
 *   6. vel.z         a lunge tips the blade into the ball
 *   7. hand          left mirrors right exactly
 *   8. preparation   backswing cocks the wrist (continuous)
 *   9. follow        recovery unrolls it
 *  10. gesturePitch  live swipe flexion
 *  11. gestureYaw    live swipe / curl turn
 *  12. ballX         face tracks the intercept, not the body
 *  13. ballY/contactY  close if the contact is above the bat
 *  14. incomingTop   topspin closes, backspin opens
 *  15. ballSpeed     a fast ball is blocked with a tighter face
 *  16. stepIn/serve/eta  short ball, toss, commit-over-time
 *  17. incomingSide  sidespin yaws the face into the kick
 *  18. compact       block: pull a wide roll back to ready
 *  19. snap          wrist snap in the brush direction
 *  20. aimYaw/Pitch  desktop hover micro-aim (touch leaves these 0)
 *  21. attackLean    drive/loop: close the face, tip the head toward the net
 *  22. grip          shakehand | penhold — the whole ready pose and fan
 *  23. strokeTilt/Turn/K  contact pose of the live (or last) stroke,
 *                    blended in as the gesture develops — the backswing /
 *                    contact / follow-through keyframes of the brief
 *
 * Extra drivers are zero when omitted, so a rest pose at x=0, z=1.44 is
 * bit-identical to the ready grip. Animation limits, not full IK.
 */
function playerWristPose(pos, vel, hand, phase = {}, grip = 'shakehand') {
  const h = hand === 'left' ? -1 : 1;
  const G = gripOf(grip);
  const px = pos.x || 0;
  const reach = Math.tanh(px / 0.48);
  const forehand = px * h >= -0.08;
  const t = clamp(Math.abs(px) / 0.72, 0, 1);
  const stance = t * t * (3 - 2 * t);
  const readyRoll = G.restRoll; // relaxed ready grip, never rigid 12 o'clock
  const cross = clamp((px * h + 0.24) / 0.32, 0, 1);
  const mix = cross * cross * (3 - 2 * cross);
  const sideRoll = lerp(G.rollLo, G.rollHi, mix);
  const preparation = clamp(phase.preparation || 0, 0, 1);
  const follow = clamp(phase.follow || 0, 0, 1);
  const direction = 2 * mix - 1;

  const vx = clamp((vel && vel.x) || 0, -7, 7);
  const vy = clamp((vel && vel.y) || 0, -4, 4);
  const vz = clamp((vel && vel.z) || 0, -5, 5);

  /* Height. Prefer the predicted contact if the caller has one — that is
     where a real player sets the angle, not where the bat currently sits.
     Missing y is home so x/z-only callers keep the old rest pitch. */
  const HOME_Y = 1.01;
  const hy = Number.isFinite(phase.contactY) ? phase.contactY
    : Number.isFinite(pos.y) ? pos.y : HOME_Y;
  /* Stretched arm cannot close as hard as a compact smash in front. */
  const reachLimit = 1 - 0.32 * stance;
  const heightPitch = -clamp((hy - HOME_Y) / 0.55, -1, 1) * 0.22 * reachLimit;

  /* Depth. Over the table you get under the ball (open); off the end you
     close for a loop. Velocity still tips the blade into a lunge. */
  const pz = Number.isFinite(pos.z) ? pos.z : 1.44;
  const depthPitch = -(pz - 1.44) * 0.22;

  const gestureYaw = clamp(phase.gestureYaw || 0, -0.32, 0.32);
  const gesturePitch = phase.gesturePitch || 0;
  const aimYaw = clamp(phase.aimYaw || 0, -0.12, 0.12);
  const aimPitch = clamp(phase.aimPitch || 0, -0.14, 0.14);
  const snap = clamp(phase.snap || 0, -1, 1);

  const hasBall = Number.isFinite(phase.ballX) || Number.isFinite(phase.ballY)
    || Number.isFinite(phase.incomingTop) || Number.isFinite(phase.ballSpeed)
    || Number.isFinite(phase.incomingSide) || Number.isFinite(phase.contactY);
  const eta = Number.isFinite(phase.eta) ? clamp(phase.eta, 0, 2) : 0.45;
  const commit = hasBall ? clamp(1.20 - eta / 0.48, 0.22, 1) : 0;

  let trackYaw = 0, readPitch = 0;
  if (hasBall) {
    if (Number.isFinite(phase.ballX)) {
      trackYaw = -clamp((phase.ballX - px) / 0.45, -1, 1) * 0.13 * commit;
    }
    const refY = Number.isFinite(pos.y) ? pos.y : HOME_Y;
    if (Number.isFinite(phase.ballY)) {
      readPitch += -clamp((phase.ballY - refY) / 0.32, -1, 1) * 0.11 * commit;
    }
    /* Sign: a ball travelling toward the player (+z) has POSITIVE w.x for
       topspin (see 40_swipe.js). Close for top, open for back. */
    if (Number.isFinite(phase.incomingTop)) {
      readPitch += -clamp(phase.incomingTop / 360, -1, 1) * 0.14 * commit;
    }
    if (Number.isFinite(phase.ballSpeed)) {
      readPitch += -clamp((phase.ballSpeed - 5.5) / 12, 0, 1) * 0.08 * commit;
    }
    /* World-space sidespin: +w.y kicks the ball to the player's +x, so the
       face yaws right (negative yaw) to cover it. Not mirrored by hand —
       both grips live in the same world. */
    if (Number.isFinite(phase.incomingSide)) {
      trackYaw += -clamp(phase.incomingSide / 90, -1, 1) * 0.10 * commit;
    }
  }

  const stepIn = clamp(phase.stepIn || 0, 0, 1);
  const serving = phase.serving ? 1 : 0;
  const sidePitch = stance * (forehand ? -0.055 : 0.075);

  const yaw = clamp(
    -reach * G.reachYaw - vx * 0.035 + gestureYaw + trackYaw + aimYaw,
    -0.52, 0.52);

  let pitch = G.restPitch + depthPitch + heightPitch + vz * 0.10 - vy * 0.025
    + gesturePitch + preparation * 0.10 - follow * 0.12
    + readPitch + stepIn * 0.09 + serving * 0.07 + sidePitch
    + aimPitch - snap * 0.08
    - clamp(phase.attackLean || 0, 0, 1) * 0.28;

  /* Stroke keyframes. The backswing (preparation above) opens the face,
     the live stroke blends toward its authored contact angle, and the
     follow-through (game feeds the last stroke back with k = swing decay)
     holds the tilt a moment before the grip settles home. */
  const kStroke = clamp(phase.strokeK || 0, 0, 1);
  if (kStroke > 0 && Number.isFinite(phase.strokeTilt)) {
    pitch = lerp(pitch, clamp(phase.strokeTilt, -0.62, 0.66), kStroke * 0.72);
  }

  /* A penhold hangs its blade BELOW the fist (handle up): every wing lean
     that reads naturally for shakehand (blade top toward the wing) would
     cross the racket over the hand on screen, because for a hanging pen
     the blade must stay OUTBOARD with the handle leaning in toward the
     body. So all reach-driven roll terms mirror for a handleUp grip. The
     shakehand numbers stay bit-identical and the left-hand mirror (h)
     keeps working — it multiplies the whole expression. */
  const wingSign = G.handleUp ? -1 : 1;
  let roll = h * (readyRoll
      + wingSign * (lerp(readyRoll, sideRoll, stance) - readyRoll
        + direction * (preparation * 0.14 - follow * 0.24)))
    - vx * 0.018 * wingSign;

  /* The stroke's wrist signature: negative turn wraps (hook), positive
     unwraps (fade). h*turn mirrors it for the left hand. */
  if (kStroke > 0 && Number.isFinite(phase.strokeTurn)) {
    roll += h * phase.strokeTurn * kStroke;
  }

  /* Closing a wide forehand lays the blade back (shoulder opens). Zero at
     the ready pitch, so the ready grip does not drift. */
  const closeAmt = clamp(-(pitch - G.restPitch) - 0.03, 0, 0.45);
  roll += h * stance * closeAmt * 0.50 * wingSign;

  /* Fast incoming + no time: compact block, pull a laid-back roll home. */
  const compact = clamp(phase.compact || 0, 0, 1);
  roll = lerp(roll, h * readyRoll, compact * 0.52);

  /* Near the table the handle cannot lay the blade flat. */
  if (Number.isFinite(pos.y)) {
    const clear = clamp((pos.y - 0.82) / 0.18, 0, 1);
    const cap = lerp(0.62, 1.55, clear);
    roll = clamp(roll, -cap, cap);
  }

  /* Penhold: lift the whole grip half a turn about the face normal. The
     blade ellipse is 180-deg symmetric, so this costs nothing visually —
     it is what puts the handle UP while the face keeps aiming at the
     ball, exactly the "почти вертикально, ручка вверх" ready pose. The
     wrist still has an anatomy: ~35 deg of cock either side of the rest
     grip, clamped SYMMETRICALLY around PI so the left hand stays the
     exact mirror of the right. */
  roll = G.handleUp
    ? clamp(roll + PENHOLD_ROLL_BASE, PENHOLD_ROLL_BASE - 0.62, PENHOLD_ROLL_BASE + 0.62)
    : clamp(roll, -3.25, 3.25);

  return {
    yaw,
    pitch: clamp(pitch, -0.55, 0.55),
    roll,
    forehand,
  };
}

/** Face normal from wrist yaw/pitch. Roll is around this axis and must
 *  not be baked in — the rubber colours stay on their surfaces. */
function faceFromWrist(out, yaw, pitch, side) {
  const o = out || { x: 0, y: 0, z: 0 };
  const fwd = (side === undefined || side >= 0) ? -1 : 1;
  const p = Number.isFinite(pitch) ? pitch : 0;
  const y = Number.isFinite(yaw) ? yaw : 0;
  const cp = Math.cos(p), sp = Math.sin(p);
  o.x = Math.sin(-y) * cp;
  o.y = sp;
  o.z = fwd * Math.cos(y) * cp;
  const L = Math.hypot(o.x, o.y, o.z) || 1;
  o.x /= L; o.y /= L; o.z /= L;
  return o;
}

class PaddleRig {
  constructor() {
    this._q = Q.new();
    this._rollQ = Q.new();
    this._m = M4.create();
    this._partM = M4.create();
    this._normal = V3.new();
    this._pos = V3.new();
    this._one = { x: 1, y: 1, z: 1 };
    this._hs = { x: 1, y: 1, z: 1 };
    this._up = { x: 0, y: 1, z: 0 };
  }

  /** Player supplies an absolute wrist roll; AI retains its compact grip. */
  paddleQuat(out, normal, hand, swing, extraRoll, absoluteRoll = false) {
    Q.lookRotation(out, normal, this._up);
    const roll = absoluteRoll ? clamp(extraRoll || 0, -3.85, 3.85)
      : (hand === 'left' ? 0.42 : -0.42)
      + clamp(swing || 0, -1, 1) * 0.3 + clamp(extraRoll || 0, -0.55, 0.55);
    return Q.mul(out, out, Q.setAxisAngle(this._rollQ, 0, 0, 1, roll));
  }

  ghostMat(o) {
    return {
      color: o.ghostCol || [0.25, 0.8, 1], rough: 0.5, unlit: true,
      blend: 'add', opacity: o.alpha !== undefined ? o.alpha : 0.42,
      emissive: [0.06, 0.10, 0.14], doubleSided: false,
    };
  }

  draw(R, S, o) {
    // Copy a supplied quaternion: callers retain ownership of their pose.
    const q = o.q ? Q.copy(this._q, o.q)
      : this.paddleQuat(this._q, o.normal, o.hand, o.swing, o.roll, o.absoluteRoll);
    const me = S.mesh, ma = S.mat, mats = o.mats || {};
    const draw = o.shadowPass
      ? (mesh, matrix, mat) => R.drawShadow(mesh, matrix, null, 0)
      : (mesh, matrix, mat) => R.draw(mesh, matrix, mat);
    const ghost = o.ghost ? this.ghostMat(o) : null;
    M4.compose(this._m, o.pos, q, this._one);
    draw(me.blade, this._m, ghost || mats.wood || ma.bladeWood);

    // Offsets must use the very same quaternion as the blade, not a stale
    // physics normal. Red/black are fixed surfaces, never swapped by ball
    // velocity (which used to make the colours pop at every bounce).
    M4.transformDir(this._normal, this._m, { x: 0, y: 0, z: 1 });
    V3.addScaled(this._pos, o.pos, this._normal, 0.0085);
    M4.compose(this._partM, this._pos, q, this._one);
    draw(me.rubber, this._partM, ghost || mats.red || ma.rubberRed);
    V3.addScaled(this._pos, o.pos, this._normal, -0.0085);
    M4.compose(this._partM, this._pos, q, this._one);
    draw(me.rubber, this._partM, ghost || mats.black || ma.rubberBlack);

    /* A penhold handle is short and sits closer to the head; the rolled
       (≈PI) quaternion is what turns it skyward — drawing stays a pure
       consumer of the same single quaternion again. */
    const pen = o.grip === 'penhold';
    M4.transformDir(this._pos, this._m, { x: 0, y: pen ? -0.105 : -0.125, z: 0 });
    V3.add(this._pos, o.pos, this._pos);
    this._hs.y = gripOf(o.grip).handleScale;
    M4.compose(this._partM, this._pos, q, this._hs);
    draw(me.handle, this._partM, ghost || mats.grip || ma.handle);
    return q;
  }
}
