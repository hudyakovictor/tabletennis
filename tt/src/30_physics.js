/* =====================================================================
 *  PHYSICS — rigid sphere with aerodynamics, Coulomb-friction impacts
 *  All units SI. Coordinate frame:
 *     +x : to the right (as seen by the human player)
 *     +y : up (world floor at y=0)
 *     +z : towards the human player  (opponent sits at -z)
 *  References used for constants: ITTF Technical Leaflet T3 (ball),
 *  ITTF Handbook 2.1 (table), standard sphere aerodynamics,
 *  and published table-tennis impact studies.
 * ===================================================================== */
'use strict';

const PH = {
  /* ---- ball (ITTF 40+ plastic) ---- */
  R: 0.020,                 // radius  [m]      (40 mm diameter)
  M: 0.0027,                // mass    [kg]     (2.7 g)
  I_FACTOR: 2 / 5,          // solid-ish sphere inertia factor used for contacts
  // A real ball is a thin shell (I = 2/3 m r^2) but contact behaviour of a
  // ping-pong ball is best fit in the literature by an effective factor in
  // [0.4 .. 0.6]; 0.5 reproduces measured rebound spin very well.
  I_EFF: 0.50,

  /* ---- environment ---- */
  G: 9.81,                  // gravity [m/s^2]
  RHO: 1.2041,              // air density at 20 C, 1 atm [kg/m^3]
  NU: 1.5e-5,               // kinematic viscosity (for Reynolds)

  /* ---- aerodynamics ---- */
  CD0: 0.44,                // base drag coefficient (subcritical sphere)
  CD_SPIN: 0.18,            // drag increase with spin ratio
  CL_SLOPE: 1.05,           // lift slope dCl/dS for small spin ratio S
  CL_MAX: 0.38,             // saturation of lift coefficient
  SPIN_DECAY_TAU: 9.0,      // aerodynamic spin decay time constant [s]

  /* ---- table ---- */
  T_LEN: 2.74, T_WID: 1.525, T_H: 0.76,
  T_HALF_LEN: 1.37, T_HALF_WID: 0.7625,
  T_THICK: 0.025,
  // ITTF T3 drop test: a standard ball dropped from 30.5 cm must rebound
  // 23..26 cm, i.e. e = sqrt(23/30.5)..sqrt(26/30.5) = 0.868..0.923.
  // A dropped ball lands at ~2.4 m/s and the rebound is measured in the
  // first bounce, so the *effective* e at that speed has to sit near 0.894.
  // The previous pair (0.870 / 0.009) gave e = 0.848 -> 20.5 cm rebound,
  // outside the legal window; this pair gives 24.0 cm.
  E_TABLE: 0.930,           // normal COR ball/table at zero impact speed
  E_TABLE_SPEED: 0.0085,    // COR loss per m/s of impact speed
  /* Coulomb friction ball/table. Calibrated, not guessed (bench suite 12,
   * A/B over mu x et): the ITTF dead-ball rebound is 23.3 cm at EVERY value
   * because a vertical drop has no tangential slip, so friction is free to
   * be set by how the table should answer SPIN.
   *   mu 0.25 (the old value): a heavy loop at 8 m/s kicked forward by 8.8 %
   *     and at 12 m/s by 3.2 % — i.e. a fast topspin drive bounced like a
   *     dead ball, which is why loops felt floaty and flat;
   *   mu 0.40: +22.4 % at 8 m/s, +14.5 % at 12 m/s, a heavy chop brakes to
   *     -61.8 % of its incoming speed (it dies short, as a chop should), and
   *     a corkscrew ball is thrown 76 cm sideways in the 0.45 s after the
   *     bounce — a sidespin serve now visibly jumps off the table;
   *   mu 0.48: kicks hard enough to look cartoonish (+29.6 %/-72.8 %).
   * ET_TABLE stays 0: it only acts in the gripping regime and moved no
   * measured number by more than 1.5 cm. */
  MU_TABLE: 0.40,           // Coulomb friction ball/table (calibrated above)
  ET_TABLE: 0.00,           // tangential restitution of the table (none)

  /* ---- net ---- */
  NET_H: 0.1525,            // net height above the table
  NET_OVERHANG: 0.1525,     // net extends past each side line
  NET_E: 0.10,              // how much comes back off a compliant net
  NET_DAMP_T: 0.22,         // tangential energy kept
  NET_SPIN_KEEP: 0.25,
  TAPE_R: 0.008,            // the white tape at the top of the net

  /* ---- racket / rubber ---- */
  E_RACKET: 0.800,          // normal COR, inverted rubber + sponge, sweet spot
  E_RACKET_SPEED: 0.0060,   // COR falls with impact speed
  MU_RACKET: 1.05,          // very grippy topsheet
  ET_RACKET: 0.52,          // tangential restitution ("catapult" of the sponge)
  SWEET_R: 0.055,           // radius of the sweet spot on the blade

  /* ---- floor ---- */
  E_FLOOR: 0.78, MU_FLOOR: 0.4,

  /* The ONE integration step. The game runs the ball at 600 Hz, so every
   * verdict a solver hands to the game has to be taken at 600 Hz too: at
   * 300 Hz the bounce is detected up to 1.3 cm later along the flight, which
   * is enough to turn a serve that the solver called legal into one that
   * clips the tape in play (measured: the player's weak tap came back
   * valid=true from the solver and then hit the net in the game). Coarse
   * steps are still fine for SEARCHING; only the verdict must match. */
  SIM_DT: 1 / 600,
};
PH.AREA = Math.PI * PH.R * PH.R;
PH.TABLE_Y = PH.T_H;                 // playing surface height
PH.NET_TOP = PH.T_H + PH.NET_H;
PH.NET_HALF_WID = PH.T_HALF_WID + PH.NET_OVERHANG;

/* ---------------------------------------------------------------- *
 *  Aerodynamic acceleration (drag + Magnus) for state (v, w).
 *  Returns acceleration in m/s^2 written into `out`.
 * ---------------------------------------------------------------- */
const _acc_tmp = V3.new();
function aeroAccel(out, v, w) {
  const speed = V3.len(v);
  if (speed < 1e-5) { out.x = 0; out.y = -PH.G; out.z = 0; return out; }
  const wlen = V3.len(w);
  const S = (PH.R * wlen) / Math.max(speed, 0.6);     // spin ratio
  const cd = PH.CD0 + PH.CD_SPIN * Math.min(S, 1.2);
  const kd = 0.5 * PH.RHO * PH.AREA * cd / PH.M;      // 1/m * 0.5 rho A Cd
  // drag  a = -kd |v| v
  out.x = -kd * speed * v.x;
  out.y = -kd * speed * v.y - PH.G;
  out.z = -kd * speed * v.z;
  if (wlen > 1e-3) {
    // Magnus: F = 0.5 rho A Cl |v|^2 * unit(w x v),  Cl = f(S)
    let cl = Math.min(PH.CL_SLOPE * S, PH.CL_MAX);
    if (S > 1.25) cl *= 1 - 0.26 * Math.min((S - 1.25) / 1.2, 1);   // saturation
    V3.cross(_acc_tmp, w, v);
    const cl_len = V3.len(_acc_tmp);
    if (cl_len > 1e-6) {
      const k = (0.5 * PH.RHO * PH.AREA * cl * speed * speed) / (PH.M * cl_len);
      out.x += _acc_tmp.x * k;
      out.y += _acc_tmp.y * k;
      out.z += _acc_tmp.z * k;
    }
  }
  return out;
}

/* ---------------------------------------------------------------- *
 *  RK4 integration of one ball over dt (no collisions here).
 * ---------------------------------------------------------------- */
const _k1 = V3.new(), _k2 = V3.new(), _k3 = V3.new(), _k4 = V3.new();
const _vt = V3.new(), _pt = V3.new();
function integrateBall(p, v, w, dt) {
  // velocity derivative via RK4; position via the matching weighted velocity
  aeroAccel(_k1, v, w);
  V3.addScaled(_vt, v, _k1, dt * 0.5); aeroAccel(_k2, _vt, w);
  V3.addScaled(_vt, v, _k2, dt * 0.5); aeroAccel(_k3, _vt, w);
  V3.addScaled(_vt, v, _k3, dt); aeroAccel(_k4, _vt, w);
  let ax = (_k1.x + 2 * _k2.x + 2 * _k3.x + _k4.x) / 6;
  let ay = (_k1.y + 2 * _k2.y + 2 * _k3.y + _k4.y) / 6;
  let az = (_k1.z + 2 * _k2.z + 2 * _k3.z + _k4.z) / 6;
  if (!Number.isFinite(ax)) ax = 0;
  if (!Number.isFinite(ay)) ay = 0;
  if (!Number.isFinite(az)) az = 0;
  p.x += (v.x + ax * dt * 0.5) * dt;
  p.y += (v.y + ay * dt * 0.5) * dt;
  p.z += (v.z + az * dt * 0.5) * dt;
  v.x += ax * dt; v.y += ay * dt; v.z += az * dt;
  const decay = Math.exp(-dt / PH.SPIN_DECAY_TAU);
  w.x *= decay; w.y *= decay; w.z *= decay;
}

/* ---------------------------------------------------------------- *
 *  Generic frictional impact of a spinning sphere against a plane
 *  with unit normal n (pointing towards the ball) that itself moves
 *  with velocity vSurf and has material (e, mu, et).
 *  Mutates v and w in place. Returns impact diagnostics.
 * ---------------------------------------------------------------- */
const _u = V3.new(), _un = V3.new(), _ut = V3.new(), _vc = V3.new(), _jt = V3.new(), _tmpc = V3.new();
/* ---------------------------------------------------------------- *
 *  Input hygiene
 *
 *  A single NaN or Infinity — a broken touch driver, a synthetic pointer
 *  event, a detached canvas reporting a zero-size rect, a normalised
 *  zero-length normal — used to sail straight through the integrator and
 *  the ball disappeared for the rest of the point, with the rally counter
 *  still running. Measured before this gate: 11 of 36 hostile inputs
 *  produced a NaN or threw. Everything that enters the physics is repaired
 *  to the nearest physical state here, in one place, instead of being
 *  checked at forty call sites.
 * ---------------------------------------------------------------- */
const V_MAX = 60;                     // m/s = 216 km/h, above any real shot

function saneV(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Clamp to the physical envelope; returns true if anything was repaired. */
function sanitizeV(v, limit) {
  if (!v) return true;
  let fixed = false;
  if (!Number.isFinite(v.x)) { v.x = 0; fixed = true; }
  if (!Number.isFinite(v.y)) { v.y = 0; fixed = true; }
  if (!Number.isFinite(v.z)) { v.z = 0; fixed = true; }
  const L = Math.hypot(v.x, v.y, v.z);
  const max = limit || V_MAX;
  if (!Number.isFinite(L)) { v.x = v.y = v.z = 0; return true; }
  if (L > max) { const k = max / L; v.x *= k; v.y *= k; v.z *= k; fixed = true; }
  return fixed;
}

/** A direction the impact can be solved against: finite and not degenerate. */
function saneN(n) {
  if (!saneV(n)) return false;
  const L = Math.hypot(n.x, n.y, n.z);
  return Number.isFinite(L) && L > 1e-6;
}

function impactSphere(v, w, n, vSurf, e, mu, et) {
  if (!saneN(n) || !v || !w) return null;
  sanitizeV(v); sanitizeV(w, SPIN_CAP * 2);
  if (vSurf) sanitizeV(vSurf); else vSurf = ZERO3;
  // relative velocity of the ball centre wrt the surface
  V3.sub(_u, v, vSurf);
  const un = V3.dot(_u, n);
  if (un > 0) return null;                      // separating, no impact
  V3.mul(_un, n, un);
  V3.sub(_ut, _u, _un);

  // contact point velocity (relative, tangential):  ut + w x (-R n)
  V3.cross(_tmpc, w, n);                        // w x n
  _vc.x = _ut.x - PH.R * _tmpc.x;
  _vc.y = _ut.y - PH.R * _tmpc.y;
  _vc.z = _ut.z - PH.R * _tmpc.z;
  const vcLen = V3.len(_vc);

  // ---- normal impulse (per unit mass) ----
  const eEff = Math.max(0.05, e);
  const dvn = -(1 + eEff) * un;                  // >0
  const Jn = PH.M * dvn;

  // ---- tangential impulse ----
  // impulse that would null the contact point (grip):
  //   dv_c = (1/m)(1 + R^2/I_eff_r2) Jt  with I = I_eff m R^2
  //   => factor  k = 1 + 1/I_eff
  const kFac = 1 + 1 / PH.I_EFF;                 // 3.0 for I_EFF=0.5
  const gripMag = (PH.M / kFac) * (1 + et) * vcLen;
  const maxFric = mu * Jn;
  let slipping = false, jtMag;
  if (gripMag <= maxFric || vcLen < 1e-6) jtMag = gripMag;
  else { jtMag = maxFric; slipping = true; }

  if (vcLen > 1e-6) V3.mul(_jt, _vc, -jtMag / vcLen); else V3.zero(_jt);

  // apply linear
  v.x += (_jt.x + n.x * Jn) / PH.M;
  v.y += (_jt.y + n.y * Jn) / PH.M;
  v.z += (_jt.z + n.z * Jn) / PH.M;
  // apply angular:  dw = (1/I) (-R n) x Jt  = -(R/I) (n x Jt)
  const invI = 1 / (PH.I_EFF * PH.M * PH.R * PH.R);
  V3.cross(_tmpc, n, _jt);
  w.x -= PH.R * invI * _tmpc.x;
  w.y -= PH.R * invI * _tmpc.y;
  w.z -= PH.R * invI * _tmpc.z;

  return { impactSpeed: -un, slipping, contactSlip: vcLen, Jn, Jt: jtMag };
}

/* ---------------------------------------------------------------- *
 *  Ball <-> table top
 * ---------------------------------------------------------------- */
const N_UP = V3.new(0, 1, 0), ZERO3 = V3.new(0, 0, 0);
/* 27 mm band around the white line where a contact counts as an edge ball. */
PH.EDGE_BAND = PH.R * 1.35;
const _edgeN = { x: 0, y: 1, z: 0 };

/**
 * Ball vs table top, including the white line.
 *
 * An edge ball is not a smaller version of a normal bounce: the contact
 * normal points OUTWARD and up, so the rebound leaves steeper, slower and at
 * an angle the receiver had no way of reading. That is why it wins points,
 * and why leaving it out made the sidelines feel like the rest of the table.
 * Implemented here — the single function the game, the replay and every
 * solver go through — so the AI's prediction of a shot agrees with the ball
 * the player actually sees.
 */
function bounceTable(p, v, w) {
  const speed = Math.max(0, -v.y);
  let e = clamp(PH.E_TABLE - PH.E_TABLE_SPEED * speed, 0.68, 0.92);
  let n = N_UP;
  // signed distance inside each line; negative means the ball caught the
  // corner itself (predict allows a bounce up to R beyond the line)
  const ex = PH.T_HALF_WID - Math.abs(p.x);
  const ez = PH.T_HALF_LEN - Math.abs(p.z);
  const edge = Math.min(ex, ez);
  let k = 0;
  if (edge < PH.EDGE_BAND) {
    k = 1 - clamp(edge / PH.EDGE_BAND, 0, 1);
    // the side line throws the ball wide, the end line throws it long: both
    // away from the middle of the table
    _edgeN.x = ex < ez ? Math.sign(p.x || 1) * 0.62 * k : 0;
    _edgeN.z = ex < ez ? 0 : Math.sign(p.z || 1) * 0.62 * k;
    _edgeN.y = 1;
    n = V3.norm(_edgeN, _edgeN);
    e *= 1 - 0.30 * k;                  // a corner is wood and air, not a sprung top
  }
  const info = impactSphere(v, w, n, ZERO3, e, PH.MU_TABLE, PH.ET_TABLE);
  p.y = PH.TABLE_Y + PH.R + 1e-5;
  if (info) { info.edge = k; info.edgeAxis = ex < ez ? 'x' : 'z'; }
  return info;
}

/* ---------------------------------------------------------------- *
 *  Ball <-> racket.  The racket is modelled as a heavy moving disc
 *  with unit normal n (facing the incoming ball) and velocity vR.
 *  `quality` in [0..1] scales the effective COR (off-centre hits).
 * ---------------------------------------------------------------- */
const SPIN_CAP = 1080;   // rad/s  (~172 rev/s, above the measured world best)
function impactRacket(v, w, n, vR, quality = 1, rubber = {}) {
  if (!saneN(n)) return null;
  sanitizeV(vR);
  const q = Number.isFinite(quality) ? clamp(quality, 0, 1) : 1;
  quality = q;
  const e0 = (rubber.e ?? PH.E_RACKET) * (0.55 + 0.45 * quality);
  const mu = (rubber.mu ?? PH.MU_RACKET) * (0.6 + 0.4 * quality);
  const et = (rubber.et ?? PH.ET_RACKET) * (0.5 + 0.5 * quality);
  V3.sub(_u, v, vR);
  const closing = -V3.dot(_u, n);
  const e = clamp((e0 - PH.E_RACKET_SPEED * Math.max(0, closing)) * (rubber.damp ?? 1), 0.18, 0.92);
  const info = impactSphere(v, w, n, vR, e, mu, et);
  const wl = V3.len(w);
  if (wl > SPIN_CAP) V3.mul(w, w, SPIN_CAP / wl);
  return info;
}

/* ---------------------------------------------------------------- *
 *  Ball <-> net.  Highly inelastic, compliant, kills most spin.
 * ---------------------------------------------------------------- */
function bounceNet(p, v, w, side) {
  const vz = v.z;
  v.z = -vz * PH.NET_E;
  v.x *= PH.NET_DAMP_T;
  v.y = v.y * PH.NET_DAMP_T - Math.abs(vz) * 0.06;
  // the mesh scatters a little
  v.x += gauss(0.12 * Math.min(1, Math.abs(vz) / 6));
  v.y += gauss(0.08);
  w.x *= PH.NET_SPIN_KEEP; w.y *= PH.NET_SPIN_KEEP; w.z *= PH.NET_SPIN_KEEP;
  p.z = side * (PH.R + 0.004);
}

/** Ball clips the top tape: deflect + big energy loss, classic net-cord. */
function clipTape(p, v, w) {
  const sp = V3.len(v);
  v.y = Math.abs(v.y) * 0.18 + sp * 0.07 + 0.25;
  v.z *= 0.42;
  v.x *= 0.58;
  v.x += gauss(0.22);
  v.z += gauss(0.10);
  w.x *= 0.45; w.y *= 0.45; w.z *= 0.45;
  p.y = PH.NET_TOP + PH.R + 0.002;
}

/* ---------------------------------------------------------------- *
 *  ONE contact model for the net and the table.
 *
 *  These two functions are the single source of truth for "did the
 *  ball touch the net" and "did it land on the table". The live
 *  simulation (70_game.js stepPhysics) and every solver (predict,
 *  solveLaunch, the serve search, the AI) go through them, because
 *  they used to disagree:
 *    · predict() called the 0.8925-0.9225 m band clean while the game
 *      called it the white tape, so a solver-certified shot clipped the
 *      cord in the live frame;
 *    · neither side let a ball that had dropped below the table pass
 *      under the net — the net plane acted as an infinite wall down to
 *      the floor;
 *    · predict() had no "from above" guard on the table, so a ball
 *      below the table bounced on the playing surface (measured: 15
 *      bounces in 2.5 s, teleporting upward every time);
 *    · both recorded the contact at the END of the integration step.
 *      At 30 m/s a 1/600 s step is 5 cm: a ball that landed 3 cm inside
 *      the line was recorded 2 cm outside it.
 * ---------------------------------------------------------------- */
const TABLE_REACH_X = PH.T_HALF_WID + PH.R;
const TABLE_REACH_Z = PH.T_HALF_LEN + PH.R;
/* Where the net assembly is: 0 = nothing, 1 = mesh, 2 = white tape.
 * `y` and `x` are the ball CENTRE at the plane. */
function netContactKind(y, x) {
  if (!Number.isFinite(y) || !Number.isFinite(x)) return 0;
  if (Math.abs(x) >= PH.NET_HALF_WID) return 0;            // around the post
  if (y - PH.R >= PH.NET_TOP) return 0;                    // clean over the tape
  if (y + PH.R <= PH.TABLE_Y) return 0;                    // under the table, under the net
  if (y + PH.R > PH.NET_TOP && y - PH.R < PH.NET_TOP) return 2;   // straddles the tape
  return 1;                                                // the mesh
}
/* Interpolated crossing of the net plane inside one step, or a touch of it
 * without crossing (|z| < R). Writes the contact point into `out`. */
const _netHit = { x: 0, y: 0, z: 0 };
function netContactStep(x0, y0, z0, x1, y1, z1, out) {
  let cx, cy, cz;
  if ((z0 > 0) !== (z1 > 0)) {
    const a = Math.abs(z0) / (Math.abs(z0) + Math.abs(z1) + 1e-9);
    cx = lerp(x0, x1, a); cy = lerp(y0, y1, a); cz = 0;
  } else if (Math.abs(z1) <= PH.R + 0.004 && Math.abs(z1) <= Math.abs(z0) + 1e-9) {
    /* Inside the net's own thickness and not retreating from it: the ball is
     * against the mesh even though it never reached the plane. The retreat
     * test matters — without it a ball spawned or rebounding a centimetre off
     * the plane is dragged back into the net every step. */
    cx = x1; cy = y1; cz = z1;
  } else return 0;
  const kind = netContactKind(cy, cx);
  if (kind && out) { out.x = cx; out.y = cy; out.z = cz; }
  return kind;
}
/* Interpolated first contact of a DESCENDING ball with the playing surface.
 * Returns the point in `out`, or null when the step does not reach the table
 * from above or the contact point misses the table. */
const _tabHit = { x: 0, y: 0, z: 0 };
function tableContact(x0, y0, z0, x1, y1, z1, out) {
  if (!(y1 - PH.R <= PH.TABLE_Y) || !(y0 - PH.R > PH.TABLE_Y - 0.02)) return null;
  const dy = y0 - y1;
  const a = dy > 1e-9 ? (y0 - (PH.TABLE_Y + PH.R)) / dy : 0;
  const k = a < 0 ? 0 : a > 1 ? 1 : a;
  const x = lerp(x0, x1, k), z = lerp(z0, z1, k);
  if (Math.abs(x) > TABLE_REACH_X || Math.abs(z) > TABLE_REACH_Z) return null;
  out.x = x; out.y = PH.TABLE_Y + PH.R; out.z = z;
  return out;
}

/* ---------------------------------------------------------------- *
 *  Fast forward simulation (no racket) used by the AI and by the
 *  trajectory predictor. Does NOT allocate.
 * ---------------------------------------------------------------- */
const _pp = V3.new(), _pv = V3.new(), _pw = V3.new();
/**
 * @param {object} res  out: {hitTableZ, hitTableX, tToTable, apexY, crossZ:{t,x,y}, out:boolean}
 */
function predict(p0, v0, w0, opts = {}) {
  const dt = opts.dt || 1 / 240;
  const maxT = opts.maxT || 3.0;
  const stopZ = opts.stopZ;              // stop when z crosses this plane (towards the player)
  const stopDir = opts.stopDir || 1;
  V3.copy(_pp, p0); V3.copy(_pv, v0); V3.copy(_pw, w0);
  sanitizeV(_pp, 40); sanitizeV(_pv); sanitizeV(_pw, SPIN_CAP * 2);
  const out = opts.out || {};
  out.bounces = 0; out.hitNet = false; out.landed = null; out.b2 = null; out.apex = -1; out.cross = null;
  out.planeCross = null; out.netCross = null; out.floor = null;
  out.reachT = -1; out.reach = null; out.path = opts.path || null;
  out.diverged = false; out.edge = 0;
  if (out.path) out.path.length = 0;
  let t = 0, prevX = _pp.x, prevY = _pp.y, prevZ = _pp.z;
  let bounceSide = 0;
  while (t < maxT) {
    prevX = _pp.x; prevY = _pp.y; prevZ = _pp.z;
    integrateBall(_pp, _pv, _pw, dt);
    t += dt;
    if (!saneV(_pv) || !saneV(_pp)) { out.diverged = true; break; }
    if (out.path && (out.path.length < 400)) out.path.push(_pp.x, _pp.y, _pp.z);
    if (_pp.y > out.apex) out.apex = _pp.y;

    /* The plane crossing is recorded even when the ball clears the net —
     * solveLaunch() measures the clearance from it, and a missing netCross
     * silently scored every shot as if it had cleared by 99 m. */
    if (!out.netCross && (prevZ > 0) !== (_pp.z > 0)) {
      const a = Math.abs(prevZ) / (Math.abs(prevZ) + Math.abs(_pp.z) + 1e-9);
      out.netCross = { y: lerp(prevY, _pp.y, a), x: lerp(prevX, _pp.x, a), t };
    }
    // net: the same model the live simulation runs (mesh / tape / clean)
    const netKind = netContactStep(prevX, prevY, prevZ, _pp.x, _pp.y, _pp.z, _netHit);
    if (netKind > 0) {
      out.netKind = netKind;
      out.hitNet = true;
      break;
    }
    /* Where the ball crosses the table's horizontal plane, interpolated
     * inside the step. Also the point where a miss overshoots. */
    if (!out.planeCross && _pv.y < 0 && _pp.y - PH.R <= PH.TABLE_Y && prevY - PH.R > PH.TABLE_Y) {
      const a = (prevY - (PH.TABLE_Y + PH.R)) / Math.max(prevY - _pp.y, 1e-9);
      const k = a < 0 ? 0 : a > 1 ? 1 : a;
      out.planeCross = { x: lerp(prevX, _pp.x, k), z: lerp(prevZ, _pp.z, k), t };
    }
    // table: only from above, and at the interpolated contact point
    if (_pv.y < 0) {
      const hit = tableContact(prevX, prevY, prevZ, _pp.x, _pp.y, _pp.z, _tabHit);
      if (hit) {
      _pp.x = hit.x; _pp.z = hit.z; _pp.y = hit.y + 1e-5;
      out.bounces++;
      if (out.bounces === 1) { out.landed = { x: hit.x, z: hit.z, t, vy: _pv.y, speed: V3.len(_pv) }; bounceSide = Math.sign(hit.z); }
      else if (out.bounces === 2) out.b2 = { x: hit.x, z: hit.z, t, speed: V3.len(_pv) };
      if (opts.stopOnFirstBounce) break;
      /* The serve solver asks for exactly two bounces and nothing else: the
       * rest of the flight (up to 1.5 s of RK4 at 300 Hz) was integrated and
       * thrown away on every one of the ~150 candidates per serve, which is
       * most of the 50-90 ms the search used to block the frame for. */
      if (opts.stopAfterBounces && out.bounces >= opts.stopAfterBounces) break;
      const bi = bounceTable(_pp, _pv, _pw);
      if (bi && bi.edge > out.edge) {
        out.edge = bi.edge;
        out.edgeBounce = { x: _pp.x, z: _pp.z, k: bi.edge, axis: bi.edgeAxis, t };
      }
      }
    }
    // requested crossing plane (racket plane of a player)
    if (stopZ !== undefined && out.reachT < 0) {
      if ((stopDir > 0 && _pp.z >= stopZ) || (stopDir < 0 && _pp.z <= stopZ)) {
        out.reachT = t; out.reach = { x: _pp.x, y: _pp.y, z: _pp.z, vx: _pv.x, vy: _pv.y, vz: _pv.z };
        if (opts.stopAtPlane) break;
      }
    }
    if (_pp.y < 0.02) { out.floor = { x: _pp.x, z: _pp.z, t }; break; }
  }
  out.endT = t;
  out.clear = (out.netCross ? out.netCross.y : 99) - PH.NET_TOP - PH.R;
  out.end = { x: _pp.x, y: _pp.y, z: _pp.z };
  out.endV = { x: _pv.x, y: _pv.y, z: _pv.z };
  return out;
}

/* ---------------------------------------------------------------- *
 *  Inverse ballistics.
 *  Given a launch point, a spin and a SPEED the player actually
 *  generated, find the launch direction that lands on `target`.
 *  Scanning the elevation is more robust than Newton because the
 *  range/elevation curve is unimodal and the net is a hard obstacle.
 * ---------------------------------------------------------------- */
const _ip = V3.new(), _iv = V3.new(), _iw = V3.new(), _predOut = {};
/** Full elevation span, used to keep the polished answer inside the range. */
const _ELEV = [-0.34, -0.26, -0.19, -0.13, -0.08, -0.04, 0, 0.035, 0.07, 0.105,
  0.145, 0.19, 0.24, 0.30, 0.36, 0.43, 0.51, 0.60, 0.70, 0.81, 0.93, 1.06];
/** Sparse grid for the cheap first pass; the winner is polished afterwards. */
const _ELEV_SCAN = [-0.34, -0.19, -0.08, 0, 0.035, 0.07, 0.105, 0.145, 0.24, 0.36, 0.51, 0.70, 0.93, 1.06];
/** Integration steps: coarse for the scan, medium for the polish, production
 *  step for the answer that is handed to the impact solver. */
const DT_SCAN = 1 / 130, DT_POLISH = 1 / 200, DT_FINE = 1 / 260;

function _tryLaunch(from, spin, speed, ux, uz, elev, netClear, out, dt) {
  V3.copy(_ip, from);
  const ch = Math.cos(elev), sh = Math.sin(elev);
  V3.set(_iv, ux * speed * ch, speed * sh, uz * speed * ch);
  V3.copy(_iw, spin);
  predict(_ip, _iv, _iw, { dt: dt || 1 / 260, maxT: 2.4, stopOnFirstBounce: true, out });
  const clear = (out.netCross ? out.netCross.y : 99) - PH.NET_TOP - PH.R;
  return { clear, landed: out.landed, hitNet: out.hitNet, vx: _iv.x, vy: _iv.y, vz: _iv.z };
}

/**
 * @param {object} opts {speed, netClear, speedForgive}
 *   speedForgive: how much the solver may slow the shot down if the
 *   player's power simply cannot stay on the table (0 = never).
 */
function solveLaunch(from, target, spin, opts = {}) {
  /* The solver is called with whatever the input layer produced, so it gets
   * the same gate as everything else: a NaN target must not turn into a NaN
   * launch that then poisons the ball for the rest of the point.
   * NOTE: `target` is a landing POINT, and callers legitimately pass it as
   * {x, z} with no y — demanding a finite y here silently disabled the whole
   * assist layer (measured: player shots on the table fell from 83 % to 6 %,
   * because refineRacket treats a null solve as "no opinion" and hands back
   * the raw gesture). Positions are checked, never clamped: clamping a
   * position vector as if it were a velocity would move the aim point. */
  const finitePt = (p) => !!p && Number.isFinite(p.x) && Number.isFinite(p.z) &&
    (p.y === undefined || Number.isFinite(p.y));
  if (!finitePt(from) || !finitePt(target)) return null;
  if (spin) sanitizeV(spin, SPIN_CAP * 2);
  const dirX = target.x - from.x, dirZ = target.z - from.z;
  const horiz = Math.hypot(dirX, dirZ) || 1e-6;
  let ux = dirX / horiz, uz = dirZ / horiz;
  const netClear = opts.netClear !== undefined ? opts.netClear : 0.055;
  let speed = clamp(opts.speed || horiz * 5.0, 1.6, 34);
  const forgive = opts.speedForgive !== undefined ? opts.speedForgive : 0.45;

  let best = null;
  const o = _predOut;
  const scoreOf = (t) => {
    if (t.hitNet) return 50 + Math.max(0, -t.clear) * 20;
    if (!t.landed) {                                           // flew off the end
      const pc = o.planeCross || o.floor;
      const over = pc ? Math.hypot(pc.x - target.x, pc.z - target.z) : 9;
      return 1.2 + over;                                       // minimise overshoot
    }
    const e = Math.hypot(t.landed.x - target.x, t.landed.z - target.z);
    return e + Math.max(0, netClear - t.clear) * 7;
  };

  /* ---------------------------------------------------------------
   * Shape of the search, and why:
   *   · a sparse scan at a cheap integration step finds the right valley
   *     (14 flights);
   *   · a short golden-section polish pins the elevation down (6 flights);
   *   · the answer is confirmed at the production step (1 flight);
   *   · sidespin and the "too hot for the table" give-back are applied as
   *     local corrections around that answer, not as another full scan.
   * Everything shares one hard budget, because this function is called up
   * to three times per stroke and used to reach 150+ flights per hit.
   * --------------------------------------------------------------- */
  let spent = 0;
  const BUDGET = 30;

  // 1. coarse scan
  let bestS = Infinity, bestI = 0;
  const sc = new Array(_ELEV_SCAN.length), tk = new Array(_ELEV_SCAN.length);
  for (let i = 0; i < _ELEV_SCAN.length; i++) {
    const t = _tryLaunch(from, spin, speed, ux, uz, _ELEV_SCAN[i], netClear, o, DT_SCAN);
    spent++;
    tk[i] = t; sc[i] = scoreOf(t);
    if (sc[i] < bestS) { bestS = sc[i]; bestI = i; }
  }
  if (!isFinite(bestS)) return null;
  best = { score: bestS, elev: _ELEV_SCAN[bestI], ...tk[bestI] };

  // 2. golden-section polish (the scan only has to land in the right valley)
  let lo = Math.max(_ELEV[0], best.elev - 0.075), hi = Math.min(_ELEV[_ELEV.length - 1], best.elev + 0.075);
  for (let k = 0; k < 3 && spent < BUDGET - 2; k++) {
    const third = (hi - lo) / 3;
    const e1 = lo + third, e2 = hi - third;
    const a = _tryLaunch(from, spin, speed, ux, uz, e1, netClear, o, DT_POLISH), sa = scoreOf(a);
    const b2 = _tryLaunch(from, spin, speed, ux, uz, e2, netClear, o, DT_POLISH), sb = scoreOf(b2);
    spent += 2;
    if (sa < sb) { hi = e2; if (sa < best.score) best = { score: sa, elev: e1, ...a }; }
    else { lo = e1; if (sb < best.score) best = { score: sb, elev: e2, ...b2 }; }
  }

  // 3. sidespin bends the flight: rotate the aim azimuth analytically and
  //    re-check the same elevation, instead of rescanning the whole grid
  if (best.landed) {
    const errLat = (best.landed.x - target.x) * (-uz) + (best.landed.z - target.z) * (ux);
    if (Math.abs(errLat) > 0.03) {
      const corr = -Math.atan2(errLat, horiz) * 0.95;
      const c = Math.cos(corr), sN = Math.sin(corr);
      const nx = ux * c - uz * sN, nz = ux * sN + uz * c;
      const ux0 = ux, uz0 = uz;
      ux = nx; uz = nz;
      const t = _tryLaunch(from, spin, speed, ux, uz, best.elev, netClear, o, DT_FINE);
      spent++;
      const s = scoreOf(t);
      if (s < best.score) best = { score: s, elev: best.elev, ...t };
      else { ux = ux0; uz = uz0; }             // rotation did not help, undo
    }
  }

  // 4. too hot to keep on the table? a limited power give-back, rescanned
  //    only around the winner
  if (best.score > 0.18 && forgive > 0.001 && (!best.landed || best.score > 0.3)) {
    const next = speed * (1 - 0.22 * forgive);
    if (next > 2.0) {
      speed = next;
      const e0 = best.elev;
      for (const e of [e0 - 0.06, e0, e0 + 0.06]) {
        if (spent >= BUDGET) break;
        const t = _tryLaunch(from, spin, speed, ux, uz, e, netClear, o, DT_POLISH);
        spent++;
        const s = scoreOf(t);
        if (s < best.score) best = { score: s, elev: e, ...t };
      }
    }
  }

  // 5. answer confirmed at the step the impact solver works at
  const fin = _tryLaunch(from, spin, speed, ux, uz, best.elev, netClear, o, DT_FINE);
  best = { score: scoreOf(fin), elev: best.elev, ...fin };
  if (!best) return null;
  return {
    vx: best.vx, vy: best.vy, vz: best.vz, elev: best.elev, speed,
    landed: best.landed ? { ...best.landed } : null, clear: best.clear, err: best.score,
  };
}
