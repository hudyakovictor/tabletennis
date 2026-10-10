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
  CL_MAX: 0.33,             // saturation of lift coefficient
  SPIN_DECAY_TAU: 14.0,     // aerodynamic spin decay time constant [s]

  /* ---- table ---- */
  T_LEN: 2.74, T_WID: 1.525, T_H: 0.76,
  T_HALF_LEN: 1.37, T_HALF_WID: 0.7625,
  T_THICK: 0.025,
  E_TABLE: 0.890,           // normal COR ball/table (ITTF drop test 24.5/30.5)
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
  E_RACKET: 0.830,          // normal COR, inverted rubber + sponge, sweet spot
  E_RACKET_SPEED: 0.0042,   // COR falls with impact speed
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
    const cl = Math.min(PH.CL_SLOPE * S, PH.CL_MAX);
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
function impactRacket(v, w, n, vR, quality = 1, rubber = {}) {
  const e0 = (rubber.e ?? PH.E_RACKET) * (0.55 + 0.45 * quality);
  const mu = (rubber.mu ?? PH.MU_RACKET) * (0.6 + 0.4 * quality);
  const et = (rubber.et ?? PH.ET_RACKET) * (0.5 + 0.5 * quality);
  V3.sub(_u, v, vR);
  const closing = -V3.dot(_u, n);
  const e = clamp(e0 - PH.E_RACKET_SPEED * Math.max(0, closing), 0.45, 0.95);
  return impactSphere(v, w, n, vR, e, mu, et);
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
 *  Inverse ballistics: find the launch velocity that makes the ball
 *  pass over the net and land on `target` (x,z) with a chosen arc.
 *  Newton/secant search on the 2 free parameters (speed, elevation).
 * ---------------------------------------------------------------- */
const _ip = V3.new(), _iv = V3.new(), _iw = V3.new(), _predOut = {};
function solveLaunch(from, target, spin, opts = {}) {
  const dirX = target.x - from.x, dirZ = target.z - from.z;
  const horiz = Math.hypot(dirX, dirZ) || 1e-6;
  const ux = dirX / horiz, uz = dirZ / horiz;
  let elev = opts.elev !== undefined ? opts.elev : 0.22;      // rad
  let speed = opts.speed || clamp(horiz * 4.2, 5, 22);
  const netClear = opts.netClear !== undefined ? opts.netClear : 0.07;
  let best = null;
  for (let iter = 0; iter < 26; iter++) {
    V3.copy(_ip, from);
    const ch = Math.cos(elev), sh = Math.sin(elev);
    V3.set(_iv, ux * speed * ch, speed * sh, uz * speed * ch);
    V3.copy(_iw, spin);
    predict(_ip, _iv, _iw, { dt: 1 / 360, maxT: 2.2, stopOnFirstBounce: true, out: _predOut });
    const landed = _predOut.landed;
    const netY = _predOut.netCross ? _predOut.netCross.y : 99;
    const clear = netY - (PH.NET_TOP + PH.R);
    if (!landed) {
      // never landed on the table: shorten
      speed *= 0.9; elev *= 0.95; continue;
    }
    const errZ = (landed.z - target.z);
    const distErr = Math.hypot(landed.x - target.x, errZ);
    const score = distErr + Math.max(0, netClear - clear) * 6 + (_predOut.hitNet ? 10 : 0);
    if (!best || score < best.score) best = { score, speed, elev, vx: _iv.x, vy: _iv.y, vz: _iv.z, landed: { ...landed }, clear };
    if (distErr < 0.02 && clear > netClear * 0.6 && !_predOut.hitNet) break;
    // adjust: too long -> reduce speed; too low over the net -> raise elevation
    const along = (landed.z - from.z) * uz + (landed.x - from.x) * ux;
    const want = horiz;
    speed *= clamp(1 + (want - along) * 0.16, 0.86, 1.18);
    if (_predOut.hitNet || clear < netClear) elev += clamp((netClear - clear) * 0.55 + 0.02, 0, 0.11);
    else if (clear > netClear * 3.0 && along > want) elev -= 0.025;
    elev = clamp(elev, -0.35, 1.1);
    speed = clamp(speed, 2.2, 32);
  }
  return best;
}


const fmt=(n,d=3)=>Number(n).toFixed(d);
console.log('== constants ==');
console.log('area',PH.AREA.toExponential(3),'tableY',PH.TABLE_Y,'netTop',PH.NET_TOP);

// 1) terminal / drag sanity: ball fired horizontally, no spin
function flight(v0,w0,p0){
  const p=V3.clone(p0),v=V3.clone(v0),w=V3.clone(w0);
  let t=0,dt=1/2000; const pts=[];
  while(t<2.0 && p.y>0.01){ integrateBall(p,v,w,dt); t+=dt; pts.push([t,p.x,p.y,p.z]); }
  return {p,v,t,pts};
}
console.log('\n== 1. drag check: 20 m/s horizontal, no spin, from 1.0 m ==');
let r=flight(V3.new(0,0,-20),V3.new(0,0,0),V3.new(0,1.0,1.3));
console.log(' after flight t=',fmt(r.t),' end speed=',fmt(V3.len(r.v)),'m/s (lost '+fmt(100*(1-V3.len(r.v)/20),1)+'%)');

console.log('\n== 2. Magnus: topspin 100 rev/s (628 rad/s), 15 m/s forward ==');
// topspin travelling in -z: spin axis is +x ... check sign
// ball moving -z with topspin => top of ball moves in -z direction => w = (-1,0,0)*? 
// v=(0,0,-15). Magnus F ~ w x v. For downward force (dip) we need F_y<0.
for(const wx of [628,-628]){
  const p=V3.new(0,1.0,1.3),v=V3.new(0,0,-15),w=V3.new(wx,0,0);
  const a=V3.new(); aeroAccel(a,v,w);
  console.log('  w=('+wx+',0,0) -> accel y='+fmt(a.y,2)+' m/s2  (gravity alone -9.81) => '+(a.y<-9.81?'DIP (topspin)':'LIFT (backspin)'));
}
console.log('\n== 3. Magnus magnitude in g ==');
{const p=V3.new(0,1,1.3),v=V3.new(0,0,-15),w=V3.new(-628,0,0);const a=V3.new();aeroAccel(a,v,w);
console.log('  backspin lift = '+fmt((a.y+9.81)/9.81,2)+' g');}

console.log('\n== 4. table bounce, pure drop from 30.5 cm (ITTF test) ==');
{
  const p=V3.new(0,PH.TABLE_Y+0.305+PH.R,0),v=V3.new(0,0,0),w=V3.new(0,0,0);
  let dt=1/4000,t=0;
  while(p.y-PH.R>PH.TABLE_Y){integrateBall(p,v,w,dt);t+=dt;}
  const vimp=-v.y; bounceTable(p,v,w);
  let maxY=p.y; const v2=V3.clone(v);
  while(v.y>0){integrateBall(p,v,w,dt); if(p.y>maxY)maxY=p.y;}
  console.log('  impact v='+fmt(vimp,2)+' m/s, rebound v='+fmt(v2.y,2)+', height='+fmt((maxY-PH.R-PH.TABLE_Y)*100,1)+' cm  (ITTF spec: 24-26 cm)');
}

console.log('\n== 5. topspin bounce kick-forward test ==');
{
  const p=V3.new(0,PH.TABLE_Y+0.1,0.5),v=V3.new(0,-4,-10),w=V3.new(-500,0,0); // topspin moving -z
  const vin=V3.clone(v);
  bounceTable(p,v,w);
  console.log('  vz: '+fmt(vin.z,2)+' -> '+fmt(v.z,2)+'  (topspin should ACCELERATE forward)');
  const p2=V3.new(0,PH.TABLE_Y+0.1,0.5),v2=V3.new(0,-4,-10),w2=V3.new(500,0,0); // backspin
  bounceTable(p2,v2,w2);
  console.log('  backspin vz: -10.00 -> '+fmt(v2.z,2)+'  (should SLOW / check back)');
  const p3=V3.new(0,PH.TABLE_Y+0.1,0.5),v3=V3.new(0,-4,-10),w3=V3.new(0,0,0);
  bounceTable(p3,v3,w3);
  console.log('  no spin  vz: -10.00 -> '+fmt(v3.z,2));
}

console.log('\n== 6. racket impact: loop drive (brush up) ==');
{
  const v=V3.new(0,-1.2,6.0);   // incoming towards player (+z), slight descent
  const w=V3.new(-120,0,0);      // incoming topspin from opponent
  // racket face slightly closed, swinging up & forward (-z)
  const n=V3.norm(V3.new(),V3.new(0,0.30,-1));
  const vR=V3.new(0,9.0,-11.0);
  const info=impactRacket(v,w,n,vR,1.0);
  console.log('  out v = ('+fmt(v.x,2)+','+fmt(v.y,2)+','+fmt(v.z,2)+')  |v|='+fmt(V3.len(v),2)+' m/s ='+fmt(V3.len(v)*3.6,1)+' km/h');
  console.log('  out w = ('+fmt(w.x,0)+','+fmt(w.y,0)+','+fmt(w.z,0)+') rad/s = '+fmt(V3.len(w)/(2*Math.PI),0)+' rev/s');
}
console.log('\n== 7. racket impact: flat smash ==');
{
  const v=V3.new(0,-0.5,7.0), w=V3.new(-100,0,0);
  const n=V3.norm(V3.new(),V3.new(0,-0.18,-1));
  const vR=V3.new(0,-1.5,-19.0);
  impactRacket(v,w,n,vR,1.0);
  console.log('  |v|='+fmt(V3.len(v),2)+' m/s = '+fmt(V3.len(v)*3.6,1)+' km/h, spin='+fmt(V3.len(w)/(2*Math.PI),0)+' rev/s');
}
console.log('\n== 8. racket impact: chop (brush down, open face) ==');
{
  const v=V3.new(0,-2,8.0), w=V3.new(-250,0,0);
  const n=V3.norm(V3.new(),V3.new(0,0.62,-1));
  const vR=V3.new(0,-7.0,-4.0);
  impactRacket(v,w,n,vR,1.0);
  console.log('  out v=('+fmt(v.x,2)+','+fmt(v.y,2)+','+fmt(v.z,2)+') spin x='+fmt(w.x,0)+' rad/s ('+(w.x>0?'BACKSPIN ok':'topspin WRONG')+')');
}
console.log('\n== 9. solveLaunch: from player side to deep opponent corner ==');
{
  const from=V3.new(0.1,0.95,1.35), target={x:-0.45,z:-1.10};
  for(const spin of [V3.new(0,0,0), V3.new(-450,0,0), V3.new(380,0,0)]){
    const s=solveLaunch(from,target,spin,{elev:0.22});
    if(!s){console.log('   no solution');continue;}
    console.log('  spin wx='+spin.x+': speed='+fmt(s.speed,2)+' elev='+fmt(s.elev*180/Math.PI,1)+'deg land=('+fmt(s.landed.x,2)+','+fmt(s.landed.z,2)+') netClear='+fmt(s.clear*100,1)+'cm err='+fmt(s.score,3));
  }
}
console.log('\n== 10. full rally trajectory timing ==');
{
  const p=V3.new(0,1.0,1.3),v=V3.new(0,1.5,-12),w=V3.new(-400,0,0);
  const o=predict(p,v,w,{dt:1/600,maxT:3,stopZ:-1.6,stopDir:-1});
  console.log('  bounces='+o.bounces+' firstLand=('+(o.landed?fmt(o.landed.x,2)+','+fmt(o.landed.z,2):'-')+') t='+(o.landed?fmt(o.landed.t,3):'-')+'  apex='+fmt(o.apex,2)+' netClear='+(o.netCross?fmt((o.netCross.y-PH.NET_TOP)*100,1)+'cm':'-'));
  console.log('  time to reach opponent plane z=-1.6: '+fmt(o.reachT,3)+' s');
}
