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
function hash1(n) { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); }
function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u);
}
