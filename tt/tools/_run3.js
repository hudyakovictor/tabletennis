/* =====================================================================
 *  TOPSPIN // ARENA TABLE TENNIS  —  math core
 *  Minimal, allocation-conscious linear algebra (vec3 / mat3 / mat4 / quat)
 * ===================================================================== */
'use strict';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const sign = Math.sign;
const rnd = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const rndSym = (a) => (Math.random() * 2 - 1) * a;
// deterministic-ish gaussian (Box-Muller, cached)
let _g2 = null;
function gauss(sigma = 1) {
  if (_g2 !== null) { const g = _g2; _g2 = null; return g * sigma; }
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u));
  _g2 = r * Math.sin(TAU * v);
  return r * Math.cos(TAU * v) * sigma;
}
// frame-rate independent exponential smoothing
const expSmooth = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/* ------------------------------ vec3 ------------------------------ */
const V3 = {
  new: (x = 0, y = 0, z = 0) => ({ x, y, z }),
  set: (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; },
  copy: (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; return o; },
  clone: (a) => ({ x: a.x, y: a.y, z: a.z }),
  add: (o, a, b) => { o.x = a.x + b.x; o.y = a.y + b.y; o.z = a.z + b.z; return o; },
  sub: (o, a, b) => { o.x = a.x - b.x; o.y = a.y - b.y; o.z = a.z - b.z; return o; },
  mul: (o, a, s) => { o.x = a.x * s; o.y = a.y * s; o.z = a.z * s; return o; },
  addScaled: (o, a, b, s) => { o.x = a.x + b.x * s; o.y = a.y + b.y * s; o.z = a.z + b.z * s; return o; },
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (o, a, b) => {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    o.x = x; o.y = y; o.z = z; return o;
  },
  len: (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z),
  len2: (a) => a.x * a.x + a.y * a.y + a.z * a.z,
  dist: (a, b) => { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); },
  norm: (o, a) => { const l = V3.len(a) || 1e-9; o.x = a.x / l; o.y = a.y / l; o.z = a.z / l; return o; },
  lerp: (o, a, b, t) => { o.x = lerp(a.x, b.x, t); o.y = lerp(a.y, b.y, t); o.z = lerp(a.z, b.z, t); return o; },
  zero: (o) => { o.x = o.y = o.z = 0; return o; },
};

/* ------------------------------ mat4 ------------------------------ *
 * Column-major, OpenGL convention.                                    */
const M4 = {
  create: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  identity: (m) => { m.set(M4.I); return m; },
  I: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  copy: (o, a) => { o.set(a); return o; },

  mul(o, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3],
      a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11],
      a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
    o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  },

  ortho(o, l, r, b, t, n, f) {
    const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    o[0] = -2 * lr; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = -2 * bt; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 2 * nf; o[11] = 0;
    o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf; o[15] = 1;
    return o;
  },

  lookAt(o, eye, center, up) {
    let zx = eye.x - center.x, zy = eye.y - center.y, zz = eye.z - center.z;
    let l = Math.hypot(zx, zy, zz) || 1e-9; zx /= l; zy /= l; zz /= l;
    let xx = up.y * zz - up.z * zy, xy = up.z * zx - up.x * zz, xz = up.x * zy - up.y * zx;
    l = Math.hypot(xx, xy, xz) || 1e-9; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * eye.x + xy * eye.y + xz * eye.z);
    o[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
    o[14] = -(zx * eye.x + zy * eye.y + zz * eye.z);
    o[15] = 1;
    return o;
  },

  compose(o, pos, quat, scale) {
    const { x, y, z, w } = quat;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;
    o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
    o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
    o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
    o[12] = pos.x; o[13] = pos.y; o[14] = pos.z; o[15] = 1;
    return o;
  },

  invert(o, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7],
      a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10,
      b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12,
      b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30,
      b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },

  // upper-left 3x3 inverse-transpose packed as mat3 (9 floats)
  normalFromMat4(o3, a) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a10 = a[4], a11 = a[5], a12 = a[6], a20 = a[8], a21 = a[9], a22 = a[10];
    const b01 = a22 * a11 - a12 * a21, b11 = -a22 * a10 + a12 * a20, b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    if (!det) { o3.set([1, 0, 0, 0, 1, 0, 0, 0, 1]); return o3; }
    det = 1.0 / det;
    o3[0] = b01 * det; o3[1] = (-a22 * a01 + a02 * a21) * det; o3[2] = (a12 * a01 - a02 * a11) * det;
    o3[3] = b11 * det; o3[4] = (a22 * a00 - a02 * a20) * det; o3[5] = (-a12 * a00 + a02 * a10) * det;
    o3[6] = b21 * det; o3[7] = (-a21 * a00 + a01 * a20) * det; o3[8] = (a11 * a00 - a01 * a10) * det;
    return o3;
  },

  transformPoint(o, m, p) {
    const x = p.x, y = p.y, z = p.z;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    o.x = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    o.y = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    o.z = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return o;
  },
  transformDir(o, m, p) {
    const x = p.x, y = p.y, z = p.z;
    o.x = m[0] * x + m[4] * y + m[8] * z;
    o.y = m[1] * x + m[5] * y + m[9] * z;
    o.z = m[2] * x + m[6] * y + m[10] * z;
    return o;
  },
};

/* ------------------------------ quat ------------------------------ */
const Q = {
  new: (x = 0, y = 0, z = 0, w = 1) => ({ x, y, z, w }),
  identity: (q) => { q.x = q.y = q.z = 0; q.w = 1; return q; },
  copy: (o, a) => { o.x = a.x; o.y = a.y; o.z = a.z; o.w = a.w; return o; },
  setAxisAngle(o, ax, ay, az, rad) {
    const h = rad * 0.5, s = Math.sin(h), l = Math.hypot(ax, ay, az) || 1e-9;
    o.x = (ax / l) * s; o.y = (ay / l) * s; o.z = (az / l) * s; o.w = Math.cos(h);
    return o;
  },
  mul(o, a, b) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    o.x = ax * bw + aw * bx + ay * bz - az * by;
    o.y = ay * bw + aw * by + az * bx - ax * bz;
    o.z = az * bw + aw * bz + ax * by - ay * bx;
    o.w = aw * bw - ax * bx - ay * by - az * bz;
    return o;
  },
  // integrate angular velocity w (rad/s, world frame) over dt
  integrate(o, q, w, dt) {
    const hx = w.x * dt * 0.5, hy = w.y * dt * 0.5, hz = w.z * dt * 0.5;
    const nx = q.x + (hx * q.w + hy * q.z - hz * q.y);
    const ny = q.y + (hy * q.w + hz * q.x - hx * q.z);
    const nz = q.z + (hz * q.w + hx * q.y - hy * q.x);
    const nw = q.w - (hx * q.x + hy * q.y + hz * q.z);
    const l = Math.hypot(nx, ny, nz, nw) || 1;
    o.x = nx / l; o.y = ny / l; o.z = nz / l; o.w = nw / l;
    return o;
  },
  fromEuler(o, x, y, z) { // YXZ order
    const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
    o.x = s1 * c2 * c3 + c1 * s2 * s3;
    o.y = c1 * s2 * c3 - s1 * c2 * s3;
    o.z = c1 * c2 * s3 - s1 * s2 * c3;
    o.w = c1 * c2 * c3 + s1 * s2 * s3;
    return o;
  },
  slerp(o, a, b, t) {
    let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
    let bx = b.x, by = b.y, bz = b.z, bw = b.w;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let s0, s1;
    if (1 - cos > 1e-6) {
      const om = Math.acos(cos), si = Math.sin(om);
      s0 = Math.sin((1 - t) * om) / si; s1 = Math.sin(t * om) / si;
    } else { s0 = 1 - t; s1 = t; }
    o.x = s0 * a.x + s1 * bx; o.y = s0 * a.y + s1 * by; o.z = s0 * a.z + s1 * bz; o.w = s0 * a.w + s1 * bw;
    return o;
  },
  // quaternion that rotates +Z onto dir (with given up)
  lookRotation(o, dir, up) {
    const f = V3.norm({ x: 0, y: 0, z: 0 }, dir);
    const r = V3.norm({ x: 0, y: 0, z: 0 }, V3.cross({ x: 0, y: 0, z: 0 }, up, f));
    const u = V3.cross({ x: 0, y: 0, z: 0 }, f, r);
    const m00 = r.x, m01 = u.x, m02 = f.x, m10 = r.y, m11 = u.y, m12 = f.y, m20 = r.z, m21 = u.z, m22 = f.z;
    const tr = m00 + m11 + m22;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; o.w = 0.25 * s; o.x = (m21 - m12) / s; o.y = (m02 - m20) / s; o.z = (m10 - m01) / s; }
    else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; o.w = (m21 - m12) / s; o.x = 0.25 * s; o.y = (m01 + m10) / s; o.z = (m02 + m20) / s; }
    else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; o.w = (m02 - m20) / s; o.x = (m01 + m10) / s; o.y = 0.25 * s; o.z = (m12 + m21) / s; }
    else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; o.w = (m10 - m01) / s; o.x = (m02 + m20) / s; o.y = (m12 + m21) / s; o.z = 0.25 * s; }
    return o;
  },
};

/* --------------------------- misc helpers -------------------------- */
// cheap value noise for camera shake / crowd modulation
function hash1(n) { return (Math.sin(n * 127.1) * 43758.5453) % 1; }
function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u);
}

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
  CD0: 0.42,                // base drag coefficient (subcritical sphere)
  CD_SPIN: 0.14,            // drag increase with spin ratio
  CL_SLOPE: 1.00,           // lift slope dCl/dS for small spin ratio S
  CL_MAX: 0.36,             // saturation of lift coefficient
  SPIN_DECAY_TAU: 14.0,     // aerodynamic spin decay time constant [s]

  /* ---- table ---- */
  T_LEN: 2.74, T_WID: 1.525, T_H: 0.76,
  T_HALF_LEN: 1.37, T_HALF_WID: 0.7625,
  T_THICK: 0.025,
  E_TABLE: 0.915,           // normal COR ball/table (calibrated: 30.5cm drop -> 23cm)
  E_TABLE_SPEED: 0.0085,    // COR loss per m/s of impact speed
  MU_TABLE: 0.25,           // Coulomb friction ball/table
  ET_TABLE: 0.00,           // tangential restitution of the table (none)

  /* ---- net ---- */
  NET_H: 0.1525,            // net height above the table
  NET_OVERHANG: 0.1525,     // net extends past each side line
  NET_E: 0.16,              // how much comes back off a compliant net
  NET_DAMP_T: 0.26,         // tangential energy kept
  NET_SPIN_KEEP: 0.30,
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
  out.bounces = 0; out.hitNet = false; out.landed = null; out.apex = -1; out.cross = null;
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

/* =====================================================================
 *  SWIPE  ->  STROKE
 *  The gesture is never "a button that plays an animation". It is turned
 *  into a real racket state (3-D velocity + face normal + contact point)
 *  and the ball is then resolved by the rigid-body impact solver.
 *  Everything the player feels (speed, spin, curve, placement, mishits)
 *  is an emergent property of that racket state.
 * ===================================================================== */
'use strict';

/* --------------------------- gesture tracker ----------------------- */
class SwipeTracker {
  constructor() {
    this.active = false;
    this.samples = [];          // {x,y,t} normalized screen units (y down)
    this.maxSamples = 64;
    this.startT = 0;
    this.m = this.blankMetrics();
    this.lastReleased = null;
  }
  blankMetrics() {
    return {
      sx: 0, sy: 0, x: 0, y: 0, dx: 0, dy: 0,
      dist: 0, pathLen: 0, straightness: 1,
      speed: 0, peakSpeed: 0, releaseSpeed: 0, accel: 0,
      angle: 0, angleDeg: 0, up: 0, right: 0,
      curl: 0, dur: 0, samples: 0, jerk: 0, smooth: 1,
    };
  }
  down(x, y, t) {
    this.active = true; this.startT = t;
    this.samples.length = 0;
    this.samples.push({ x, y, t });
    this.m = this.blankMetrics();
    this.m.sx = x; this.m.sy = y; this.m.x = x; this.m.y = y;
  }
  move(x, y, t) {
    if (!this.active) return;
    const s = this.samples, last = s[s.length - 1];
    if (last && t - last.t < 0.0025) { last.x = x; last.y = y; return; }
    s.push({ x, y, t });
    if (s.length > this.maxSamples) s.shift();
    this.compute(t);
  }
  up(x, y, t) {
    if (!this.active) return null;
    this.samples.push({ x, y, t });
    this.compute(t);
    this.active = false;
    this.lastReleased = { ...this.m };
    return this.lastReleased;
  }
  compute(now) {
    const s = this.samples, n = s.length, m = this.m;
    if (n < 2) return m;
    const a = s[0], b = s[n - 1];
    m.sx = a.x; m.sy = a.y; m.x = b.x; m.y = b.y;
    m.dx = b.x - a.x; m.dy = b.y - a.y;
    m.dist = Math.hypot(m.dx, m.dy);
    m.dur = Math.max(1e-3, b.t - a.t);
    m.samples = n;

    // path length + curl (signed turning, + = counter-clockwise on screen)
    let pl = 0, curl = 0, jerkAcc = 0, prevSpeed = 0, speedChanges = 0;
    for (let i = 1; i < n; i++) {
      const px = s[i].x - s[i - 1].x, py = s[i].y - s[i - 1].y;
      const seg = Math.hypot(px, py);
      pl += seg;
      const dt = Math.max(1e-4, s[i].t - s[i - 1].t);
      const sp = seg / dt;
      if (i > 1) { jerkAcc += Math.abs(sp - prevSpeed); speedChanges++; }
      prevSpeed = sp;
      if (i > 1) {
        const qx = s[i - 1].x - s[i - 2].x, qy = s[i - 1].y - s[i - 2].y;
        const cr = qx * py - qy * px, dp = qx * px + qy * py;
        if (seg > 1e-5) curl += Math.atan2(cr, dp);     // signed turn, radians
      }
    }
    m.pathLen = pl;
    m.straightness = pl > 1e-5 ? clamp(m.dist / pl, 0, 1) : 1;
    m.curl = clamp(curl, -3.2, 3.2);          // total signed turning [rad]
    m.jerk = speedChanges ? jerkAcc / speedChanges : 0;

    // velocity over the trailing 55 ms window (what the hand is doing *now*)
    const W = 0.055;
    let i0 = n - 1;
    while (i0 > 0 && b.t - s[i0].t < W) i0--;
    const w = s[i0];
    const wdt = Math.max(1e-3, b.t - w.t);
    const vx = (b.x - w.x) / wdt, vy = (b.y - w.y) / wdt;
    m.speed = Math.hypot(vx, vy);
    m.releaseSpeed = m.speed;
    if (m.speed > m.peakSpeed) m.peakSpeed = m.speed;
    // 25 ms acceleration (is the hand still accelerating into the ball?)
    let i1 = n - 1; while (i1 > 0 && b.t - s[i1].t < 0.025) i1--;
    const w1 = s[i1], wdt1 = Math.max(1e-3, b.t - w1.t);
    const sp1 = Math.hypot(b.x - w1.x, b.y - w1.y) / wdt1;
    m.accel = (sp1 - m.speed) / Math.max(wdt1, 1e-3);

    // direction: blend of overall displacement and current velocity
    let dirx = vx, diry = vy;
    if (m.speed < 0.08) { dirx = m.dx; diry = m.dy; }
    else { dirx = vx * 0.72 + m.dx / m.dur * 0.28; diry = vy * 0.72 + m.dy / m.dur * 0.28; }
    m.angle = Math.atan2(-diry, dirx);      // screen y is down -> flip
    m.angleDeg = m.angle / DEG;
    m.right = Math.cos(m.angle);
    m.up = Math.sin(m.angle);
    m.smooth = clamp(1 - m.jerk / 14, 0.15, 1);
    return m;
  }
}

/* ------------------------- stroke archetypes ----------------------- */
/** Every archetype describes how the arm behaves, not how the ball flies. */
const STROKES = {
  LOOP: { id: 'LOOP', name: 'ТОПСПИН-ЛУП', short: 'LOOP', col: '#ff7a2f', desc: 'Касательный разгон вверх — мощное верхнее вращение' },
  COUNTER: { id: 'COUNTER', name: 'КОНТР-ТОПСПИН', short: 'CTR', col: '#ff4d6d', desc: 'Встречный топспин по восходящему мячу' },
  DRIVE: { id: 'DRIVE', name: 'НАКАТ', short: 'DRIVE', col: '#ffd34d', desc: 'Плоско-поступательный удар с лёгким верхним' },
  SMASH: { id: 'SMASH', name: 'СМЕШ', short: 'SMASH', col: '#ff2d2d', desc: 'Завершающий плоский удар сверху' },
  FLICK: { id: 'FLICK', name: 'ФЛИК', short: 'FLICK', col: '#ff9f1c', desc: 'Короткий кистевой подкрут над столом' },
  PUSH: { id: 'PUSH', name: 'ПОДСТАВКА-ПОДРЕЗКА', short: 'PUSH', col: '#4dd2ff', desc: 'Короткая подрезка открытой ракеткой' },
  CHOP: { id: 'CHOP', name: 'ЧОП', short: 'CHOP', col: '#2f9bff', desc: 'Дальняя защита, тяжёлое нижнее вращение' },
  BLOCK: { id: 'BLOCK', name: 'БЛОК', short: 'BLOCK', col: '#a0b4c8', desc: 'Пассивный приём — гасит скорость соперника' },
  LOB: { id: 'LOB', name: 'СВЕЧА', short: 'LOB', col: '#b388ff', desc: 'Высокая оборонительная свеча с верхним вращением' },
  HOOK: { id: 'HOOK', name: 'ХУК (боковое)', short: 'HOOK', col: '#39e08b', desc: 'Боковое вращение — мяч уходит дугой' },
  FADE: { id: 'FADE', name: 'ФЕЙД (боковое)', short: 'FADE', col: '#39e0c8', desc: 'Обратное боковое вращение' },
  DROP: { id: 'DROP', name: 'УКОРОЧЕННЫЙ', short: 'DROP', col: '#8fd14f', desc: 'Мягкое гашение у сетки' },
  SERVE_TOP: { id: 'SERVE_TOP', name: 'ПОДАЧА: ВЕРХНЕЕ', short: 'SRV+', col: '#ff7a2f', desc: '' },
  SERVE_BACK: { id: 'SERVE_BACK', name: 'ПОДАЧА: НИЖНЕЕ', short: 'SRV-', col: '#4dd2ff', desc: '' },
  SERVE_SIDE: { id: 'SERVE_SIDE', name: 'ПОДАЧА: БОКОВОЕ', short: 'SRVx', col: '#39e08b', desc: '' },
  SERVE_FAST: { id: 'SERVE_FAST', name: 'ПОДАЧА: БЫСТРАЯ', short: 'SRV!', col: '#ffd34d', desc: '' },
};

/* ------------------------------------------------------------------ *
 *  Stroke archetypes expressed the way a coach describes them:
 *    elev    - elevation of the swing path (deg, + = upward)
 *    contact - angle between the swing path and the racket face normal.
 *              THIS is the speed <-> spin dial of real table tennis:
 *              small = flat/pure speed, large = grazing/pure spin.
 *    lat     - how much the gesture's sideways part rotates the swing
 *    speed   - effort multiplier, soft = compliant (absorbing) contact
 * ------------------------------------------------------------------ */
const ARCH = {
  LOOP: { elev: 58, contact: 63, speed: 1.00, lat: 0.50, back: false },
  COUNTER: { elev: 46, contact: 56, speed: 1.06, lat: 0.50, back: false },
  DRIVE: { elev: 24, contact: 33, speed: 1.00, lat: 0.60, back: false },
  SMASH: { elev: -5, contact: 22, speed: 1.10, lat: 0.45, back: false },
  FLICK: { elev: 50, contact: 58, speed: 0.90, lat: 0.60, back: false },
  PUSH: { elev: -28, contact: 64, speed: 0.50, lat: 0.45, back: true, soft: 0.80 },
  CHOP: { elev: -50, contact: 68, speed: 0.66, lat: 0.40, back: true },
  BLOCK: { elev: 6, contact: 24, speed: 0.16, lat: 0.35, back: false, soft: 0.62, absorb: 0.35 },
  LOB: { elev: 66, contact: 50, speed: 0.60, lat: 0.35, back: false },
  HOOK: { elev: 28, contact: 56, speed: 1.00, lat: 1.70, back: false },
  FADE: { elev: 28, contact: 56, speed: 1.00, lat: 1.70, back: false },
  DROP: { elev: -10, contact: 60, speed: 0.16, lat: 0.30, back: true, soft: 0.42, absorb: 0.55 },
  SERVE_TOP: { elev: 46, contact: 58, speed: 0.80, lat: 0.60, back: false },
  SERVE_BACK: { elev: -40, contact: 72, speed: 0.75, lat: 0.60, back: true },
  SERVE_SIDE: { elev: 10, contact: 62, speed: 0.85, lat: 2.00, back: false },
  SERVE_FAST: { elev: 2, contact: 26, speed: 1.00, lat: 0.60, back: false },
};

/** Pick the archetype. Ordering matters: situational shots win over generic. */
function classifyStroke(m, ctx, sp01) {
  const r = m.right, u = m.up;
  const latMag = Math.abs(r);
  const curly = Math.abs(m.curl) > 0.38;
  const fast = sp01 > 0.60, veryFast = sp01 > 0.92, slow = sp01 < 0.30;
  const b = ctx.ball;
  const hAboveNet = b.y - PH.NET_TOP;
  const hAboveTable = b.y - PH.TABLE_Y;
  const depth = Math.abs(b.z);
  const overTable = depth < PH.T_HALF_LEN - 0.02;
  const incomingTop = ctx.incomingTop || 0;
  const incSpeed = ctx.ballSpeed || 6;

  if (ctx.isServe) {
    if (veryFast && Math.abs(u) < 0.45) return STROKES.SERVE_FAST;
    if (latMag > 0.70 || curly) return STROKES.SERVE_SIDE;
    if (u < -0.18) return STROKES.SERVE_BACK;
    return STROKES.SERVE_TOP;
  }
  // tiny gesture = touch play
  if (m.dist < 0.050 && sp01 < 0.45) {
    if (incSpeed > 7.0 || incomingTop > 220) return STROKES.BLOCK;
    return (overTable && hAboveTable < 0.34) ? STROKES.DROP : STROKES.BLOCK;
  }
  // finishing a high ball always beats everything else
  if (hAboveNet > 0.14 && sp01 > 0.52 && u < 0.52) return STROKES.SMASH;
  // downward gestures = backspin family
  if (u < -0.28) {
    if (depth > PH.T_HALF_LEN + 0.40 || (fast && m.dist > 0.20)) return STROKES.CHOP;
    if (slow && overTable && hAboveTable < 0.35) return STROKES.DROP;
    return STROKES.PUSH;
  }
  // a clearly curved sideways gesture = sidespin
  if (latMag > 0.58 && curly) return (r > 0) ? STROKES.HOOK : STROKES.FADE;
  // upward gestures = topspin family
  if (u > 0.70) {
    if (slow && hAboveTable < 0.55) return STROKES.LOB;
    if (overTable && m.dist < 0.13 && hAboveTable < 0.30) return STROKES.FLICK;
    return (incomingTop > 170 && fast) ? STROKES.COUNTER : STROKES.LOOP;
  }
  if (u > 0.34) return (incomingTop > 260 && veryFast) ? STROKES.COUNTER : STROKES.LOOP;
  return STROKES.DRIVE;
}

/* ------------------------------------------------------------------ *
 *  Build the racket state from gesture metrics + ball context.
 *  side = +1 for the near player (hits towards -z)
 * ------------------------------------------------------------------ */
function deriveStroke(m, ctx) {
  const side = ctx.side || 1;
  const fwd = -side;

  /* ---- 1. effort ------------------------------------------------- */
  const raw = Math.max(m.releaseSpeed, m.peakSpeed * 0.78);
  const sp01 = clamp(raw / 4.2, 0, 1.45);

  /* ---- 2. context ------------------------------------------------ */
  const b = ctx.ball || { y: PH.TABLE_Y + 0.15, z: side * 1.2 };
  ctx.ball = b;
  const incomingTop = ctx.incomingTop !== undefined ? ctx.incomingTop
    : -side * ((ctx.ballSpin && ctx.ballSpin.x) || 0);
  ctx.incomingTop = incomingTop;
  const hAboveNet = b.y - PH.NET_TOP;
  const hAboveTable = b.y - PH.TABLE_Y;

  /* ---- 3. archetype ---------------------------------------------- */
  const st = classifyStroke(m, ctx, sp01);
  const A = ARCH[st.id] || ARCH.DRIVE;

  /* ---- 4. continuous blend archetype <- raw gesture --------------- *
   * The archetype only biases; the actual numbers still follow the
   * player's hand, so two LOOPs are never identical.                  */
  const r = m.right, u = m.up;
  const gestureElev = u * 66;                       // deg
  let elev = clamp(A.elev * 0.52 + gestureElev * 0.62, -72, 80);

  // spin intent: verticality + gesture length + wrist curl
  const spinIntent = clamp(Math.pow(Math.abs(u), 1.25) * 0.78
    + clamp(m.dist * 1.6, 0, 0.35)
    + Math.abs(m.curl) * 0.08, 0, 1.15);
  let contact = A.contact * 0.62 + lerp(20, 74, clamp(spinIntent, 0, 1)) * 0.46;
  // a high ball wants a flatter contact; a ball below the net wants a graze
  contact += clamp(-hAboveNet * 42, -16, 10);
  contact = clamp(contact, 14, 80);

  // azimuth of the swing / of the face
  const azSwing = clamp(r * A.lat * 0.72, -1.35, 1.35);      // rad
  const azFace = clamp(r * A.lat * 0.34 + m.curl * 0.10, -0.80, 0.80);

  let vmag = 2.0 + 15.5 * Math.pow(sp01, 0.82);
  vmag = clamp(vmag * A.speed * (ctx.powerScale || 1), 0.8, 19.5);

  /* ---- 5. build the 3-D racket frame ------------------------------ */
  const eR = elev * DEG;
  const swing = V3.new(
    Math.sin(azSwing) * Math.cos(eR),
    Math.sin(eR),
    fwd * Math.cos(azSwing) * Math.cos(eR));
  V3.norm(swing, swing);
  const vR = V3.mul(V3.new(), swing, vmag);
  if (A.absorb) { V3.mul(vR, vR, 1 - A.absorb); }       // soft hands recoil

  // face normal: rotate away from the swing by the contact angle
  const phi = (A.back ? eR + contact * DEG : eR - contact * DEG);
  const normal = V3.new(
    Math.sin(azFace) * Math.cos(phi),
    Math.sin(phi),
    fwd * Math.cos(azFace) * Math.cos(phi));
  V3.norm(normal, normal);

  /* ---- 6. intended placement -------------------------------------- */
  const aimX = clamp((m.x - 0.5) * 2.0 + r * 0.50, -1, 1) * (PH.T_HALF_WID * 0.86);
  let depth01;
  switch (st.id) {
    case 'DROP': depth01 = 0.13; break;
    case 'PUSH': depth01 = 0.46 + sp01 * 0.30; break;
    case 'FLICK': depth01 = 0.55; break;
    case 'BLOCK': depth01 = 0.45 + sp01 * 0.3; break;
    case 'LOB': depth01 = 0.90; break;
    case 'SMASH': depth01 = 0.72; break;
    case 'CHOP': depth01 = 0.58; break;
    default: depth01 = clamp(0.34 + sp01 * 0.44 + m.dist * 0.26, 0.2, 0.96);
  }
  const aimZ = -side * lerp(0.16, PH.T_HALF_LEN - 0.07, depth01);

  /* ---- 7. execution quality --------------------------------------- */
  const quality = clamp(
    0.46
    + 0.24 * m.smooth
    + 0.16 * m.straightness
    + 0.14 * clamp(m.samples / 12, 0, 1)
    - 0.10 * clamp(Math.abs(m.curl) - 1.4, 0, 1.6), 0.2, 1);

  const rubber = A.soft ? { e: PH.E_RACKET * A.soft, mu: PH.MU_RACKET, et: PH.ET_RACKET * (0.5 + 0.5 * A.soft) } : null;

  return {
    stroke: st, arch: A, vR, normal, vmag, aim: { x: aimX, z: aimZ },
    power: sp01, quality, elev, contact, azSwing, azFace, spinIntent, rubber,
    swipe: m, side,
    netClear: st.id === 'LOB' ? 0.50 : st.id === 'DROP' ? 0.035
      : st.id === 'SMASH' ? 0.040 : st.id === 'CHOP' ? 0.075 : 0.055,
  };
}

/* ------------------------------------------------------------------ *
 *  PHYSICAL AIM ASSIST
 *  The ball is never teleported. We rotate the player's WHOLE stroke
 *  (swing path + racket face together, so the contact angle and hence
 *  the spin character are preserved — exactly what a real player does
 *  when aiming) and scale the swing speed, until the shot physically
 *  lands where the gesture asked for.
 *    assist = 0 -> pure simulation, your technique or nothing
 *    assist = 1 -> flawless professional execution
 * ------------------------------------------------------------------ */
const _rv = V3.new(), _rw = V3.new(), _rn = V3.new(), _rs = V3.new(), _rvr = V3.new(), _rout = {};

function dirFromAngles(out, elev, az, fwd) {
  out.x = Math.sin(az) * Math.cos(elev);
  out.y = Math.sin(elev);
  out.z = fwd * Math.cos(az) * Math.cos(elev);
  return V3.norm(out, out);
}

/** Rebuild (swing, normal) for a stroke rotated by (dElev, dAz). */
function strokeFrame(racket, dElev, dAz, scale, outSwing, outNormal) {
  const fwd = -racket.side;
  const e = clamp(racket.elev * DEG + dElev, -1.30, 1.40);
  const a = clamp(racket.azSwing + dAz, -1.40, 1.40);
  const contact = racket.contact * DEG;
  const phi = clamp(racket.arch.back ? e + contact : e - contact, -1.25, 1.35);
  const af = clamp(racket.azFace + dAz, -1.10, 1.10);
  dirFromAngles(outSwing, e, a, fwd);
  dirFromAngles(outNormal, phi, af, fwd);
  V3.mul(outSwing, outSwing, racket.vmag * (racket.arch.absorb ? 1 - racket.arch.absorb : 1) * scale);
  return outSwing;
}

function refineRacket(ballP, ballV, ballW, racket, assist, quality) {
  const fwd = -racket.side;
  const rubber = Object.assign({}, racket.rubber || {});
  const q = quality !== undefined ? quality : racket.quality;
  const side = racket.side;

  const evalStroke = (dE, dA, sc, dmp, outV, outW) => {
    strokeFrame(racket, dE, dA, sc, _rs, _rn);
    V3.copy(outV, ballV); V3.copy(outW, ballW);
    rubber.damp = dmp;
    impactRacket(outV, outW, _rn, _rs, q, rubber);
  };

  /* ---- 1. what does the untouched gesture physically do? ---------- */
  evalStroke(0, 0, 1, 1, _rv, _rw);
  const rawReport = {};
  predict(V3.clone(ballP), V3.clone(_rv), V3.clone(_rw),
    { dt: 1 / 280, maxT: 2.6, stopOnFirstBounce: true, out: rawReport });
  racket.rawReport = rawReport;
  if (assist <= 0.001) return racket;

  // where did the raw shot "want" to go?
  let rawX, rawZ;
  if (rawReport.landed) { rawX = rawReport.landed.x; rawZ = rawReport.landed.z; }
  else if (rawReport.hitNet) {
    rawX = rawReport.netCross ? rawReport.netCross.x : ballP.x;
    rawZ = -side * 0.12;                          // just over the net
  } else if (rawReport.planeCross) { rawX = rawReport.planeCross.x; rawZ = rawReport.planeCross.z; }
  else { rawX = racket.aim.x; rawZ = racket.aim.z; }
  // keep the blend sane
  rawX = clamp(rawX, -2.2, 2.2); rawZ = clamp(rawZ, -3.2, 3.2);

  /* ---- 2. the assisted target is a blend of mistake and intent ---- */
  const target = {
    x: lerp(rawX, racket.aim.x, assist),
    z: lerp(rawZ, racket.aim.z, assist),
  };
  // never aim into your own half
  if (Math.sign(target.z) === side || Math.abs(target.z) < 0.10) target.z = -side * 0.22;

  /* ---- 3. converge the stroke rotation onto that target ----------- */
  let dE = 0, dA = 0, sc = 1, dmp = 1, sol = null;
  for (let outer = 0; outer < 3; outer++) {
    sol = solveLaunch(ballP, target, _rw, {
      speed: V3.len(_rv),
      netClear: racket.netClear,
      speedForgive: 0,                       // power is the player's business
    });
    if (!sol) break;
    // if even the flattest trajectory overshoots, soften the hands
    if (sol.err > 0.22 && dmp > 0.42) { dmp = Math.max(0.42, dmp * 0.80); }
    const want = V3.new(sol.vx, sol.vy, sol.vz);
    const wantLen = V3.len(want);
    const wd = V3.norm(V3.new(), want);
    const wE = Math.asin(clamp(wd.y, -1, 1));
    const wA = Math.atan2(wd.x, fwd * wd.z);
    for (let it = 0; it < 9; it++) {
      evalStroke(dE, dA, sc, dmp, _rv, _rw);
      const got = V3.len(_rv);
      if (got < 0.3) { sc *= 1.4; continue; }
      const gd = V3.norm(V3.new(), _rv);
      const gE = Math.asin(clamp(gd.y, -1, 1));
      const gA = Math.atan2(gd.x, fwd * gd.z);
      const eErr = wE - gE, aErr = wA - gA, sErr = wantLen / got;
      const relax = it < 3 ? 0.82 : 0.52;
      dE = clamp(dE + eErr * relax, -1.05, 1.15);
      dA = clamp(dA + aErr * relax * 0.9, -1.0, 1.0);
      // The assist polishes technique; it may NOT make you a different
      // athlete. Swing scale stays inside a believable human band and the
      // only other lever is how softly the hand holds the bat (damp).
      const scLo = racket.arch.absorb ? 0.12 : 0.45, scHi = 1.50;
      if (sErr < 1) {
        const next = sc * Math.pow(sErr, 0.55);
        sc = clamp(next, scLo, scHi);
        if (next < scLo && dmp > 0.30) dmp = Math.max(0.30, dmp * 0.85);
      } else {
        if (dmp < 1 && sc > scHi * 0.92) dmp = Math.min(1, dmp * 1.18);
        sc = clamp(sc * Math.pow(sErr, 0.60), scLo, scHi);
      }
      if (Math.abs(eErr) < 0.004 && Math.abs(aErr) < 0.006 && Math.abs(sErr - 1) < 0.015) break;
    }
    if (sol.err < 0.12) break;
  }
  if (!sol) return racket;

  /* ---- 4. guarantee pass: never leave the player with a shot that
   *        clips the net or dies on their own half when they asked for
   *        a clean one. Nudges the elevation in small physical steps.  */
  const chk = {};
  const validate = (e_, a_, s_, d_) => {
    evalStroke(e_, a_, s_, d_, _rv, _rw);
    predict(V3.clone(ballP), V3.clone(_rv), V3.clone(_rw),
      { dt: 1 / 280, maxT: 2.6, stopOnFirstBounce: true, out: chk });
    if (chk.hitNet) return -1;
    if (!chk.landed) return 1;
    if (Math.sign(chk.landed.z) === side) return -1;
    return 0;
  };
  let verdict = validate(dE, dA, sc, dmp);
  for (let k = 0; k < 10 && verdict !== 0; k++) {
    if (verdict < 0) { dE += 0.045; sc = clamp(sc * 1.035, 0.12, 1.55); }
    else { dE -= 0.035; dmp = Math.max(0.30, dmp * 0.96); }
    verdict = validate(dE, dA, sc, dmp);
  }

  const swing = V3.new(), normal = V3.new();
  strokeFrame(racket, dE, dA, sc, swing, normal);
  rubber.damp = dmp;
  return { ...racket, normal, vR: swing, rubber, dElev: dE, dAz: dA, scale: sc, damp: dmp, solved: sol, target, valid: verdict === 0 };
}

/** Cheap post-hoc report of where a struck ball will actually go. */
function shotReport(p, v, w, out) {
  return predict(V3.clone(p), V3.clone(v), V3.clone(w),
    { dt: 1 / 300, maxT: 2.6, stopOnFirstBounce: true, out: out || _rout });
}

// synthesize gestures and check the resulting shots
function gesture(pts, dur){
  const t=new SwipeTracker(); let t0=0;
  const n=pts.length;
  for(let i=0;i<n;i++){
    const tt=t0+dur*i/(n-1);
    if(i===0)t.down(pts[i][0],pts[i][1],tt); else t.move(pts[i][0],pts[i][1],tt);
  }
  return t.up(pts[n-1][0],pts[n-1][1],t0+dur);
}
function lineG(x0,y0,x1,y1,dur,steps=16,bend=0){
  const p=[];
  for(let i=0;i<=steps;i++){const s=i/steps;
    const nx=-(y1-y0),ny=(x1-x0); const bl=Math.hypot(nx,ny)||1;
    const off=bend*Math.sin(Math.PI*s);
    p.push([x0+(x1-x0)*s+nx/bl*off, y0+(y1-y0)*s+ny/bl*off]);}
  return gesture(p,dur);
}
const ballCtx=(y,z,vz,spinX)=>({side:1,ball:{y,z,vz,spinX},ballSpin:{x:spinX,y:0,z:0},ballSpeed:Math.abs(vz)});

const tests=[
 ['swipe UP fast (loop)',       lineG(0.5,0.80,0.52,0.42,0.13), ballCtx(PH.TABLE_Y+0.12,1.25,6,-120)],
 ['swipe UP slow (lob)',        lineG(0.5,0.80,0.51,0.52,0.42), ballCtx(PH.TABLE_Y+0.10,1.30,5,-80)],
 ['swipe FORWARD-UP 45 fast',   lineG(0.42,0.80,0.66,0.52,0.12), ballCtx(PH.TABLE_Y+0.22,1.25,7,-150)],
 ['swipe FLAT fast, high ball', lineG(0.38,0.62,0.74,0.60,0.10), ballCtx(PH.TABLE_Y+0.42,1.20,5,-60)],
 ['swipe DOWN med (push)',      lineG(0.5,0.50,0.52,0.70,0.18), ballCtx(PH.TABLE_Y+0.09,1.15,5,60)],
 ['swipe DOWN long fast (chop)',lineG(0.5,0.38,0.53,0.86,0.15), ballCtx(PH.TABLE_Y+0.05,1.95,8,-300)],
 ['tiny swipe (block)',         lineG(0.5,0.70,0.515,0.685,0.09), ballCtx(PH.TABLE_Y+0.15,1.25,11,-420)],
 ['swipe RIGHT curved (hook)',  lineG(0.30,0.70,0.78,0.60,0.12,16,0.07), ballCtx(PH.TABLE_Y+0.16,1.25,6,-100)],
 ['swipe LEFT curved (fade)',   lineG(0.72,0.70,0.24,0.60,0.12,16,-0.07), ballCtx(PH.TABLE_Y+0.16,1.25,6,-100)],
];
console.log('gesture                         | stroke   | pwr | racket v (m/s)        |speed| face normal             | aim x/z');
console.log('-'.repeat(132));
for(const [name,m,ctx] of tests){
  const s=deriveStroke(m,ctx);
  const f=(v,d=2)=>v.toFixed(d).padStart(6);
  console.log(name.padEnd(31)+' | '+s.stroke.short.padEnd(8)+' |'+s.power.toFixed(2).padStart(5)+' | ('+f(s.vR.x)+','+f(s.vR.y)+','+f(s.vR.z)+') |'+s.vmag.toFixed(1).padStart(5)+'| ('+f(s.normal.x)+','+f(s.normal.y)+','+f(s.normal.z)+') | '+s.aim.x.toFixed(2)+' / '+s.aim.z.toFixed(2));
}

console.log('\n== resulting BALL state after the physical impact ==');
console.log('gesture                         | stroke | out speed  | topspin rev/s | side rev/s | lands (x,z) | net clear | VERDICT');
console.log('-'.repeat(132));
for(const [name,m,ctx] of tests){
  const s=deriveStroke(m,ctx);
  const bp=V3.new(0.05,ctx.ball.y,ctx.ball.z);
  const bv=V3.new(0,-1.2,ctx.ball.vz);
  const bw=V3.new(ctx.ball.spinX,0,0);
  const r=refineRacket(bp,bv,bw,s,0.95,s.quality);
  const v=V3.clone(bv),w=V3.clone(bw);
  impactRacket(v,w,r.normal,r.vR,s.quality,r.rubber||{});
  const o=predict(V3.clone(bp),V3.clone(v),V3.clone(w),{dt:1/400,maxT:2.5,stopOnFirstBounce:true});
  const topspin=-w.x/6.2832, side=w.y/6.2832;
  const land=o.landed?('('+o.landed.x.toFixed(2)+','+o.landed.z.toFixed(2)+')'):(o.hitNet?'NET':'OUT');
  const clear=o.netCross?((o.netCross.y-PH.NET_TOP)*100).toFixed(1)+'cm':'-';
  let verdict='ok';
  if(o.hitNet)verdict='! net';
  else if(!o.landed)verdict='! long';
  else if(o.landed.z>0)verdict='! own half';
  console.log(name.padEnd(31)+' | '+s.stroke.short.padEnd(6)+' | '+(V3.len(v)*3.6).toFixed(1).padStart(6)+' km/h |'+topspin.toFixed(0).padStart(10)+'     |'+side.toFixed(0).padStart(9)+'   | '+land.padEnd(11)+' | '+clear.padStart(8)+' | '+verdict);
}
