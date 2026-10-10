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
  E_TABLE: 0.870,           // normal COR ball/table (calibrated: 30.5cm drop -> ~23cm)
  E_TABLE_SPEED: 0.009,     // COR loss per m/s of impact speed
  MU_TABLE: 0.20,           // Coulomb friction ball/table
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
  E_RACKET_SPEED: 0.0100,   // COR falls steeply with impact speed
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
  const info = impactSphere(v, w, N_UP, ZERO3, e, PH.MU_TABLE, PH.ET_TABLE);
  p.y = PH.TABLE_Y + PH.R + 1e-5;
  return info;
}

/* ---------------------------------------------------------------- *
 *  Ball <-> racket.  The racket is modelled as a heavy moving disc
 *  with unit normal n (facing the incoming ball) and velocity vR.
 *  `quality` in [0..1] scales the effective COR (off-centre hits).
 * ---------------------------------------------------------------- */
const SPIN_CAP = 1080;   // rad/s  (~172 rev/s, above the measured world best)
function impactRacket(v, w, n, vR, quality = 1, rubber = {}) {
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
  let t = 0, prevY = _pp.y, prevZ = _pp.z;
  let bounceSide = 0;
  while (t < maxT) {
    prevY = _pp.y; prevZ = _pp.z;
    integrateBall(_pp, _pv, _pw, dt);
    t += dt;
    if (out.path && (out.path.length < 400)) out.path.push(_pp.x, _pp.y, _pp.z);
    if (_pp.y > out.apex) out.apex = _pp.y;

    // net plane
    if ((prevZ > 0) !== (_pp.z > 0)) {
      const a = Math.abs(prevZ) / (Math.abs(prevZ) + Math.abs(_pp.z) + 1e-9);
      const yAt = lerp(prevY, _pp.y, a);
      const xAt = lerp(_pp.x - (_pp.x - p0.x) * 0, _pp.x, 1);
      out.netCross = { y: yAt, x: xAt, t };
      if (yAt < PH.NET_TOP + PH.R * 0.5 && Math.abs(xAt) < PH.NET_HALF_WID) { out.hitNet = true; break; }
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
