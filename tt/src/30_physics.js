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
  E_TABLE: 0.870,           // normal COR ball/table (calibrated: 30.5cm drop -> 23cm  => sqrt(23/30.5)=0.868)
  E_TABLE_SPEED: 0.009,     // COR loss per m/s of impact speed
  MU_TABLE: 0.24,           // Coulomb friction ball/table (velocity-dependent, see bounceTable)
  MU_TABLE_SPEED: 0.008,    // friction drops with sliding speed
  ET_TABLE: 0.03,           // tangential restitution of the table (slight springiness)

  /* ---- net ---- */
  NET_H: 0.1525,            // net height above the table
  NET_OVERHANG: 0.1525,     // net extends past each side line
  NET_E: 0.10,              // how much comes back off a compliant net
  NET_E_BOTTOM: 0.06,       // net is tighter at the bottom (less give)
  NET_E_TOP: 0.14,          // net is looser near the tape (more give)
  NET_DAMP_T: 0.22,         // tangential energy kept
  NET_SPIN_KEEP: 0.25,
  NET_SAG: 0.012,           // sag at the sides of the net [m]
  NET_SKEW_FACTOR: 0.35,    // how much the net deflects tangentially
  TAPE_R: 0.008,            // the white tape at the top of the net

  /* ---- racket / rubber ---- */
  E_RACKET: 0.800,          // normal COR, inverted rubber + sponge, sweet spot
  E_RACKET_SPEED: 0.0060,   // COR falls with impact speed
  MU_RACKET: 1.05,          // very grippy topsheet
  ET_RACKET: 0.52,          // tangential restitution ("catapult" of the sponge)
  SWEET_R: 0.055,           // radius of the sweet spot on the blade

  /* ---- floor ---- */
  E_FLOOR: 0.78, MU_FLOOR: 0.4,
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
  // Reynolds-dependent drag: Cd drops in the critical regime Re ~ 3e5
  // smooth cubic: 1.10 at Re=0 → 1.02 at Re=30k → 0.97 at Re=80k → 0.95 at Re=200k
  const Re = (2 * PH.R * speed) / PH.NU;               // Reynolds number
  const ReK = clamp(Re / 80000, 0, 1);                 // 0..1 over working range
  const ReCorr = 1.10 - 0.21 * ReK + 0.14 * ReK * ReK - 0.06 * ReK * ReK * ReK;
  const cd = (PH.CD0 + PH.CD_SPIN * Math.min(S, 1.2)) * ReCorr;
  const kd = 0.5 * PH.RHO * PH.AREA * cd / PH.M;      // 1/m * 0.5 rho A Cd
  // drag  a = -kd |v| v
  out.x = -kd * speed * v.x;
  out.y = -kd * speed * v.y - PH.G;
  out.z = -kd * speed * v.z;
  if (wlen > 1e-3) {
    // Magnus: F = 0.5 rho A Cl |v|^2 * unit(w x v),  Cl = f(S)
    let cl = Math.min(PH.CL_SLOPE * S, PH.CL_MAX);
    if (S > 1.25) cl *= 1 - 0.26 * Math.min((S - 1.25) / 1.2, 1);   // saturation
    // lift crisis at extreme spin: boundary layer fully separated
    if (S > 2.5) cl *= Math.max(0.08, 1 - 0.55 * (S - 2.5));
    // Reynolds correction on Magnus: low Re reduces lift effectiveness
    if (Re < 2.5e4) cl *= 0.75 + 0.25 * Re / 2.5e4;
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
  const ax = (_k1.x + 2 * _k2.x + 2 * _k3.x + _k4.x) / 6;
  const ay = (_k1.y + 2 * _k2.y + 2 * _k3.y + _k4.y) / 6;
  const az = (_k1.z + 2 * _k2.z + 2 * _k3.z + _k4.z) / 6;
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
function impactSphere(v, w, n, vSurf, e, mu, et) {
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
function bounceTable(p, v, w) {
  const speed = -v.y;
  const e = clamp(PH.E_TABLE - PH.E_TABLE_SPEED * speed, 0.68, 0.92);
  // velocity-dependent friction: high sliding speed reduces grip
  const vtEst = Math.sqrt(v.x * v.x + v.z * v.z);
  const mu = Math.max(0.10, PH.MU_TABLE - PH.MU_TABLE_SPEED * vtEst);
  const info = impactSphere(v, w, N_UP, ZERO3, e, mu, PH.ET_TABLE);
  p.y = PH.TABLE_Y + PH.R + 1e-5;
  return info;
}

/* ---------------------------------------------------------------- *
 *  Ball <-> racket.  The racket is modelled as a heavy moving disc
 *  with unit normal n (facing the incoming ball) and velocity vR.
 *  `quality` in [0..1] scales the effective COR (off-centre hits).
 * ---------------------------------------------------------------- */
const SPIN_CAP = 1080;   // rad/s  (~172 rev/s, above the measured world best)

/* ---- Rubber profiles: each type defines its own physics ---- */
const RUBBER_PROFILES = {
  CLASSIC:  { e: 0.800, mu: 1.05, et: 0.52, sponge: 1.8, tacky: 0.0, name: 'Классика' },
  TENSOR:   { e: 0.830, mu: 1.10, et: 0.62, sponge: 2.1, tacky: 0.0, name: 'Тензор' },
  TACKY:    { e: 0.750, mu: 1.28, et: 0.38, sponge: 1.5, tacky: 0.85, name: 'Липкая' },
  LONGPIP:  { e: 0.620, mu: 0.80, et: 0.20, sponge: 0.8, tacky: 0.0, name: 'Длинные шипы' },
  ANTISPIN: { e: 0.700, mu: 0.42, et: 0.12, sponge: 1.0, tacky: 0.5, name: 'Антискручивание' },
  HARD:     { e: 0.760, mu: 0.95, et: 0.44, sponge: 1.2, tacky: 0.0, name: 'Жёсткая' },
};

function impactRacket(v, w, n, vR, quality = 1, rubber = {}) {
  // rubber profiles: read from profile if specified, else use passed values or defaults
  const rp = rubber.profile ? RUBBER_PROFILES[rubber.profile] : null;
  const baseE  = rp ? rp.e  : (rubber.e  ?? PH.E_RACKET);
  const baseMu = rp ? rp.mu : (rubber.mu ?? PH.MU_RACKET);
  const baseEt = rp ? rp.et : (rubber.et ?? PH.ET_RACKET);
  const spongeThick = rp ? rp.sponge : (rubber.sponge ?? 1.8);  // mm
  const tacky       = rp ? rp.tacky  : (rubber.tacky  ?? 0);    // 0..1
  // sponge thickness scales the catapult (tangential restitution)
  const spongeScale = 0.65 + 0.35 * clamp(spongeThick / 2.2, 0.3, 1.2);
  // tacky rubber: higher friction but less catapult (ball "sticks")
  const muBoost = 1 + 0.20 * tacky;
  const etPenalty = 1 - 0.35 * tacky;
  const e0 = baseE * (0.55 + 0.45 * quality);
  const mu = baseMu * (0.6 + 0.4 * quality) * muBoost;
  const et = baseEt * (0.5 + 0.5 * quality) * spongeScale * etPenalty;
  V3.sub(_u, v, vR);
  const closing = -V3.dot(_u, n);
  const e = clamp((e0 - PH.E_RACKET_SPEED * Math.max(0, closing)) * (rubber.damp ?? 1), 0.18, 0.92);
  const info = impactSphere(v, w, n, vR, e, mu, et);
  const wl = V3.len(w);
  if (wl > SPIN_CAP) V3.mul(w, w, SPIN_CAP / wl);
  // long pimples: invert incoming spin
  if (rp && rp === RUBBER_PROFILES.LONGPIP) {
    w.x *= -0.55; w.y *= -0.55; w.z *= -0.55;
  }
  return info;
}

/* ---------------------------------------------------------------- *
 *  Ball <-> net.  Highly inelastic, compliant, kills most spin.
 * ---------------------------------------------------------------- */
/** Net sag model: height varies with x-position (tight at center, sags at sides). */
function netHeightAt(x) {
  const normX = clamp(Math.abs(x) / PH.NET_HALF_WID, 0, 1);
  return PH.NET_H - PH.NET_SAG * normX * normX;
}

function bounceNet(p, v, w, side) {
  const hRatio = clamp((p.y - PH.TABLE_Y) / PH.NET_H, 0, 1);
  // height-dependent compliance: bottom=stiff, top=looser
  const eNet = lerp(PH.NET_E_BOTTOM, PH.NET_E_TOP, hRatio);
  // tangential response: skewed net deflects ball sideways
  const vtEst = Math.sqrt(v.x * v.x + v.y * v.y);
  const tangentialDamp = PH.NET_DAMP_T * (1 + PH.NET_SKEW_FACTOR * hRatio);
  const vz = v.z;
  v.z = -vz * eNet;
  v.x *= Math.min(tangentialDamp, 0.65);
  v.y = v.y * PH.NET_DAMP_T - Math.abs(vz) * 0.06;
  // the mesh scatters a little — more at higher speed
  const scatter = Math.min(1, Math.abs(vz) / 6);
  v.x += gauss(0.12 * scatter);
  v.y += gauss(0.08);
  // glancing hits slide along the net and lose more energy
  if (vtEst > 2) { v.x *= 0.85; v.y *= 0.85; }
  w.x *= PH.NET_SPIN_KEEP; w.y *= PH.NET_SPIN_KEEP; w.z *= PH.NET_SPIN_KEEP;
  p.z = side * (PH.R + 0.004);
}

/** Ball clips the top tape: deflect + big energy loss, classic net-cord.
 *  Angle-dependent: direct hits absorb more; glancing hits deflect more. */
function clipTape(p, v, w) {
  const sp = V3.len(v);
  const vTangent = Math.sqrt(v.x * v.x + v.y * v.y);
  const angle01 = clamp(Math.abs(v.z) / Math.max(sp, 0.1), 0, 1);  // 0=glancing, 1=direct
  const absorb = lerp(0.60, 0.82, angle01);   // direct hits absorb more
  const deflect = 1 - absorb;
  v.y = Math.abs(v.y) * 0.18 * deflect + sp * 0.07 + 0.25;
  v.z *= 0.42 * deflect;
  v.x *= 0.58 * deflect;
  // scatter proportional to speed
  v.x += gauss(0.22 * Math.min(1, sp / 12));
  v.z += gauss(0.10 * Math.min(1, sp / 12));
  w.x *= 0.45; w.y *= 0.45; w.z *= 0.45;
  p.y = PH.NET_TOP + PH.R + 0.002;
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
  const out = opts.out || {};
  out.bounces = 0; out.hitNet = false; out.landed = null; out.b2 = null; out.apex = -1; out.cross = null;
  out.planeCross = null; out.netCross = null; out.floor = null;
  out.reachT = -1; out.reach = null; out.path = opts.path || null;
  if (out.path) out.path.length = 0;
  let t = 0, prevX = _pp.x, prevY = _pp.y, prevZ = _pp.z;
  let bounceSide = 0;
  while (t < maxT) {
    prevX = _pp.x; prevY = _pp.y; prevZ = _pp.z;
    integrateBall(_pp, _pv, _pw, dt);
    t += dt;
    if (out.path && (out.path.length < 400)) out.path.push(_pp.x, _pp.y, _pp.z);
    if (_pp.y > out.apex) out.apex = _pp.y;

    // net plane — uses sag-adjusted height
    if ((prevZ > 0) !== (_pp.z > 0)) {
      const a = Math.abs(prevZ) / (Math.abs(prevZ) + Math.abs(_pp.z) + 1e-9);
      const yAt = lerp(prevY, _pp.y, a);
      const xAt = lerp(prevX, _pp.x, a);
      out.netCross = { y: yAt, x: xAt, t };
      const netTopAtX = PH.TABLE_Y + netHeightAt(xAt) + PH.R * 0.5;
      if (yAt < netTopAtX && Math.abs(xAt) < PH.NET_HALF_WID) { out.hitNet = true; break; }
    }
    // crossing of the table's horizontal plane anywhere (used to measure
    // how far a ball that misses actually overshoots)
    if (!out.planeCross && _pv.y < 0 && _pp.y - PH.R <= PH.TABLE_Y && prevY - PH.R > PH.TABLE_Y) {
      out.planeCross = { x: _pp.x, z: _pp.z, t };
    }
    // table
    if (_pp.y - PH.R <= PH.TABLE_Y && _pv.y < 0 &&
      Math.abs(_pp.x) <= PH.T_HALF_WID + PH.R && Math.abs(_pp.z) <= PH.T_HALF_LEN + PH.R) {
      out.bounces++;
      if (out.bounces === 1) { out.landed = { x: _pp.x, z: _pp.z, t, vy: _pv.y, speed: V3.len(_pv) }; bounceSide = Math.sign(_pp.z); }
      else if (out.bounces === 2) out.b2 = { x: _pp.x, z: _pp.z, t, speed: V3.len(_pv) };
      if (opts.stopOnFirstBounce) break;
      bounceTable(_pp, _pv, _pw);
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
const _ELEV = [-0.34, -0.26, -0.19, -0.13, -0.08, -0.04, 0, 0.035, 0.07, 0.105,
  0.145, 0.19, 0.24, 0.30, 0.36, 0.43, 0.51, 0.60, 0.70, 0.81, 0.93, 1.06];

function _tryLaunch(from, spin, speed, ux, uz, elev, netClear, out) {
  V3.copy(_ip, from);
  const ch = Math.cos(elev), sh = Math.sin(elev);
  V3.set(_iv, ux * speed * ch, speed * sh, uz * speed * ch);
  V3.copy(_iw, spin);
  predict(_ip, _iv, _iw, { dt: 1 / 260, maxT: 2.4, stopOnFirstBounce: true, out });
  const clear = (out.netCross ? out.netCross.y : 99) - PH.NET_TOP - PH.R;
  return { clear, landed: out.landed, hitNet: out.hitNet, vx: _iv.x, vy: _iv.y, vz: _iv.z };
}

/**
 * @param {object} opts {speed, netClear, speedForgive}
 *   speedForgive: how much the solver may slow the shot down if the
 *   player's power simply cannot stay on the table (0 = never).
 */
function solveLaunch(from, target, spin, opts = {}) {
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

  for (let pass = 0; pass < 3; pass++) {
    best = null;
    for (let i = 0; i < _ELEV.length; i++) {
      const t = _tryLaunch(from, spin, speed, ux, uz, _ELEV[i], netClear, o);
      const sc = scoreOf(t);
      if (!best || sc < best.score) best = { score: sc, elev: _ELEV[i], ...t };
    }
    if (!best) return null;
    // local refinement around the winner
    let lo = best.elev - 0.075, hi = best.elev + 0.075;
    for (let k = 0; k < 7; k++) {
      const mid = (lo + hi) / 2;
      const a = _tryLaunch(from, spin, speed, ux, uz, mid - 0.018, netClear, o), sa = scoreOf(a);
      const b2 = _tryLaunch(from, spin, speed, ux, uz, mid + 0.018, netClear, o), sb = scoreOf(b2);
      if (sa < sb) { hi = mid; if (sa < best.score) best = { score: sa, elev: mid - 0.018, ...a }; }
      else { lo = mid; if (sb < best.score) best = { score: sb, elev: mid + 0.018, ...b2 }; }
    }
    // too hot to keep on the table? allow a limited power give-back
    if (best.score > 0.18 && forgive > 0.001 && (!best.landed || best.score > 0.3)) {
      const next = speed * (1 - 0.22 * forgive);
      if (next > 2.0 && pass < 2) { speed = next; continue; }
    }
    // sidespin bends the flight: correct the aim azimuth and re-solve once
    if (best.landed && pass < 2) {
      const errLat = (best.landed.x - target.x) * (-uz) + (best.landed.z - target.z) * (ux);
      if (Math.abs(errLat) > 0.015) {
        const corr = -Math.atan2(errLat, horiz) * 0.95;
        const c = Math.cos(corr), sN = Math.sin(corr);
        const nx = ux * c - uz * sN, nz = ux * sN + uz * c;
        ux = nx; uz = nz;
        continue;
      }
    }
    break;
  }
  if (!best) return null;
  return {
    vx: best.vx, vy: best.vy, vz: best.vz, elev: best.elev, speed,
    landed: best.landed ? { ...best.landed } : null, clear: best.clear, err: best.score,
  };
}
