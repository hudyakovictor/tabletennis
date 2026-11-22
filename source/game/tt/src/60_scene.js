/* =====================================================================
 *  SCENE — procedural table and effects, with an embedded street panorama.
 *  Dimensions follow ITTF: table 2.74 x 1.525 x 0.76 m, net 15.25 cm.
 * ===================================================================== */
'use strict';

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/* ------------------------- procedural textures --------------------- */
function surfaceRandom(seed) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function texTableTop(palette) {
  // canvas x = table WIDTH (1.525 m), canvas y = table LENGTH (2.74 m)
  const W = 1024, H = 2048, c = cv(W, H), g = c.getContext('2d');
  // Surface wear is stable and must not consume the rally's random sequence.
  const random = surfaceRandom(0x51bacead);
  const base = palette.table || '#234e87';
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (random() - 0.5) * 5;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const rg = g.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.62);
  rg.addColorStop(0, 'rgba(255,255,255,0.028)');
  rg.addColorStop(1, 'rgba(0,0,0,0.10)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  // Soft, satin wear where hands, balls and the towel touch the surface.
  for (let i = 0; i < 48; i++) {
    const x = random() * W, y = random() * H, r = 24 + random() * 120;
    const patch = g.createRadialGradient(x, y, 0, x, y, r);
    patch.addColorStop(0, i % 3 ? 'rgba(205,216,224,0.030)' : 'rgba(28,40,54,0.045)');
    patch.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = patch; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 120; i++) {
    g.fillStyle = 'rgba(210,218,222,0.035)';
    g.fillRect(random() * W, random() * H, 10 + random() * 90, 1 + random() * 2);
  }
  // ITTF markings: 20 mm side + end lines, 3 mm centre line
  const lwX = Math.max(3, Math.round(W * 0.020 / PH.T_WID));
  const lwY = Math.max(3, Math.round(H * 0.020 / PH.T_LEN));
  g.fillStyle = '#e9e9df'; g.globalAlpha = 0.94;
  g.fillRect(0, 0, lwX, H); g.fillRect(W - lwX, 0, lwX, H);      // side lines
  g.fillRect(0, 0, W, lwY); g.fillRect(0, H - lwY, W, lwY);      // end lines
  const clw = Math.max(2, Math.round(W * 0.003 / PH.T_WID));
  g.fillRect((W - clw) / 2, 0, clw, H);                          // centre line
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, H / 2 - 1, W, 2);  // halves seam
  g.fillStyle = 'rgba(127,105,77,0.55)';
  for (let i = 0; i < 84; i++) {
    const size = 3 + random() * 12, depth = 1 + random() * 2, side = i % 4;
    if (side < 2) g.fillRect(side ? W - depth : 0, random() * (H - size), depth, size);
    else g.fillRect(random() * (W - size), side === 2 ? 0 : H - depth, size, depth);
  }
  return c;
}

function texFrame() {
  const S = 256, c = cv(S, S), g = c.getContext('2d'), random = surfaceRandom(0x72ab1e00);
  g.fillStyle = '#2b3333'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = i % 3 ? 'rgba(198,205,194,0.045)' : 'rgba(9,14,14,0.10)';
    g.fillRect(random() * S, random() * S, 1, 1 + random() * 3);
  }
  for (let i = 0; i < 22; i++) {
    const x = random() * S, y = random() * S, r = 2 + random() * 9;
    const rust = g.createRadialGradient(x, y, 0, x, y, r);
    rust.addColorStop(0, 'rgba(129,81,45,0.34)'); rust.addColorStop(1, 'rgba(129,81,45,0)');
    g.fillStyle = rust; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return c;
}

function texFloor(palette) {
  const S = 1024, c = cv(S, S), g = c.getContext('2d');
  g.fillStyle = palette.floor || '#241f2b'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 26000; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.030})`;
    g.fillRect(x, y, 1 + Math.random() * 2, 1);
  }
  // sport-floor plank seams
  g.strokeStyle = 'rgba(0,0,0,0.30)'; g.lineWidth = 2;
  for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(0, i * S / 8); g.lineTo(S, i * S / 8); g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,0.025)'; g.lineWidth = 1;
  for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(0, i * S / 8 + 2); g.lineTo(S, i * S / 8 + 2); g.stroke(); }
  return c;
}

function texNet() {
  const W = 1024, H = 256, c = cv(W, H), g = c.getContext('2d');
  const tape = H * 0.14;
  g.clearRect(0, 0, W, H);
  // mesh
  g.strokeStyle = 'rgba(8,10,12,0.94)'; g.lineWidth = 1.75;
  const cells = Math.round((PH.T_WID + 2 * PH.NET_OVERHANG) / 0.01);
  for (let i = 0; i <= cells; i++) {
    const x = i * W / cells;
    g.beginPath(); g.moveTo(x, tape); g.lineTo(x, H); g.stroke();
  }
  const rows = Math.round(PH.NET_H * 0.86 / 0.01);
  for (let j = 0; j <= rows; j++) {
    const y = tape + (H - tape) * j / rows;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  // white tape along the top
  g.fillStyle = '#eeefe9'; g.fillRect(0, 0, W, tape);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, tape - 2, W, 2);
  // bottom cord
  g.strokeStyle = 'rgba(8,10,12,0.94)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, H - 2); g.lineTo(W, H - 2); g.stroke();
  return c;
}

function texBall() {
  const W = 512, H = 256, c = cv(W, H), g = c.getContext('2d');
  g.fillStyle = '#fbfbf7'; g.fillRect(0, 0, W, H);
  // moulding seam around the equator (what you actually watch to read spin)
  g.strokeStyle = 'rgba(120,125,135,0.55)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, H / 2 + 2); g.lineTo(W, H / 2 + 2); g.stroke();
  // star + brand so rotation is unmistakable
  g.save(); g.translate(W * 0.22, H * 0.30);
  g.fillStyle = 'rgba(70,78,92,0.65)';
  g.font = '700 42px ui-sans-serif,system-ui,sans-serif'; g.textAlign = 'center';
  g.fillText('★★★', 0, 0);
  g.font = '600 26px ui-sans-serif,system-ui,sans-serif';
  g.fillText('40+', 0, 34);
  g.restore();
  g.save(); g.translate(W * 0.70, H * 0.72);
  g.fillStyle = 'rgba(70,78,92,0.45)';
  g.font = '700 30px ui-sans-serif,system-ui,sans-serif'; g.textAlign = 'center';
  g.fillText('ARENA', 0, 0);
  g.restore();
  // faint dimples
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`;
    g.beginPath(); g.arc(Math.random() * W, Math.random() * H, Math.random() * 2.2, 0, TAU); g.fill();
  }
  return c;
}

function texRubber(color) {
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.14})`;
    g.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
  }
  const rg = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S * 0.52);
  rg.addColorStop(0, 'rgba(255,255,255,0.10)'); rg.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = rg; g.fillRect(0, 0, S, S);
  // logo removed per requirements
  return c;
}

function texShadow() {
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  r.addColorStop(0.00, 'rgba(0,0,0,1)');
  r.addColorStop(0.45, 'rgba(0,0,0,0.80)');
  r.addColorStop(0.75, 'rgba(0,0,0,0.28)');
  r.addColorStop(1.00, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, S, S);
  return c;
}

/* Stable, soft-edged footprint of the actual table on the floor. The broad
 * tabletop shade follows the overhead key light; four darker contact patches
 * and short leg shadows keep the feet grounded from every orbit angle. */
const TABLE_GROUND_SHADOW = Object.freeze({ width: 3.4, depth: 4.7, offsetX: -0.34, offsetZ: -0.24 });
function tableGroundShadowAlpha(x, z, T = PH) {
  const s = TABLE_GROUND_SHADOW;
  const dx = Math.max(0, Math.abs(x - s.offsetX) - T.T_HALF_WID);
  const dz = Math.max(0, Math.abs(z - s.offsetZ) - T.T_HALF_LEN);
  let a = 0.69 * Math.exp(-(dx * dx + dz * dz) / (2 * 0.22 * 0.22));
  const lx = s.offsetX * 0.85, lz = s.offsetZ * 0.85;
  for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
    const fx = sx * (T.T_HALF_WID - 0.14), fz = sz * (T.T_HALF_LEN - 0.22);
    const t = clamp(((x - fx) * lx + (z - fz) * lz) / (lx * lx + lz * lz), 0, 1);
    const ex = x - fx - lx * t, ez = z - fz - lz * t;
    const leg = 0.40 * Math.exp(-(ex * ex + ez * ez) / (2 * 0.065 * 0.065));
    const contact = 0.48 * Math.exp(-((x - fx) ** 2 + (z - fz) ** 2) / (2 * 0.095 * 0.095));
    a = 1 - (1 - a) * (1 - leg) * (1 - contact);
  }
  return clamp(a, 0, 0.92);
}
function texTableGroundShadow() {
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const image = g.createImageData(S, S), d = image.data, s = TABLE_GROUND_SHADOW;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = ((i + 0.5) / S - 0.5) * s.width;
    const z = ((j + 0.5) / S - 0.5) * s.depth;
    d[(j * S + i) * 4 + 3] = Math.round(255 * tableGroundShadowAlpha(x, z));
  }
  g.putImageData(image, 0, 0);
  return c;
}

function texGlow() {
  const S = 128, c = cv(S, S), g = c.getContext('2d');
  const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, S, S);
  return c;
}

function texRing() {
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 12;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 18, 0, TAU); g.stroke();
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 40, 0, TAU); g.stroke();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * (S / 2 - 54), S / 2 + Math.sin(a) * (S / 2 - 54));
    g.lineTo(S / 2 + Math.cos(a) * (S / 2 - 24), S / 2 + Math.sin(a) * (S / 2 - 24));
    g.stroke();
  }
  return c;
}


/* --------------------- hand-painted rail tag ---------------------- */
/* Ported from the authored table scene. Coordinates are a 100-unit
 * cap-height drawing space; the paths are strokes, not a font. */
const MARKER_STROKES = {
  W: [77, [[11.7, 'M 2,15 Q -1,42 2,79 Q 3,92 12,82 L 32,40 Q 34,34 34,45 L 36,80 Q 37,89 45,82 C 56,70 69,38 74,8']]],
  I: [26, [[10.6, 'M 20,18 Q 13,44 11,80'], [6.6, 'M 7,20 Q 17,15 28,15'], [6.3, 'M 1,80 Q 10,78 22,78']]],
  L: [43, [[11.5, 'M 20,12 C 16,30 7,59 6,79 Q 7,86 15,84 Q 27,82 43,76']]],
  D: [55, [[10.5, 'M 15,16 Q 10,37 6,76'], [11.7, 'M 4,21 C 28,5 52,13 52,40 C 51,65 26,83 3,83']]],
  T: [53, [[12.1, 'M 27,22 C 25,37 16,66 17,84'], [8.5, 'M 2,24 C 13,20 36,14 55,15']]],
  R: [54, [[10.9, 'M 16,18 Q 10,48 7,82'], [11.1, 'M 2,24 C 26,9 52,10 50,28 Q 47,42 17,51 C 33,57 36,72 52,81']]],
  C: [53, [[11.8, 'M 46,21 C 40,7 22,15 12,29 C 1,45 -2,67 9,79 C 19,89 35,79 48,67']]],
  K: [52, [[11.3, 'M 17,15 C 12,31 7,65 6,83'], [9.8, 'M 52,13 C 40,28 28,43 11,52 C 33,54 34,72 51,80']]],
  F: [49, [[11.4, 'M 19,19 C 15,41 7,65 6,84'], [8.2, 'M 3,23 Q 20,15 52,15'], [7.6, 'M 12,48 Q 25,43 40,44']]],
  A: [54, [[11.6, 'M 0,83 C 8,68 30,21 42,13 Q 47,11 45,30 L 44,82'], [7.1, 'M 11,63 Q 26,58 52,59']]],
  O: [58, [[11.5, 'M 46,16 C 31,7 13,21 6,41 C -1,59 2,81 17,83 C 34,88 50,67 53,43 C 55,29 52,21 43,17']]],
  Y: [57, [[10.5, 'M 4,15 C 8,29 14,43 23,53'], [11.9, 'M 54,11 C 44,27 31,47 22,62 C 16,74 12,87 8,94']]],
};

function markerTagTexture(variant = 0) {
  if (typeof Path2D === 'undefined' || typeof document === 'undefined') return null;
  try {
    const canvas = cv(2048, 176), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const random = surfaceRandom(variant ? 915 : 318);
    const label = ['WILD', 'TRICK', 'FACTORY'];
    const letterGap = 4, wordGap = 38;
    const length = label.reduce((total, word) => total + [...word].reduce((w, key) => w + MARKER_STROKES[key][0] + letterGap, 0), 0) + wordGap * 2;
    const width = (canvas.width - 88) / (length + 16), height = 1.40;
    const warmInk = variant === 0 ? '#f5f3e9' : '#f8f6ee';
    ctx.setTransform(width, 0, 0, height, 24, 10);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    let x = 9, n = 0;
    for (const word of label) {
      for (const letter of word) {
        const [advance, parts] = MARKER_STROKES[letter];
        const baseline = (random() - 0.5) * 7 + Math.sin(n * 0.9 + 1) * 2.3 + (5 - n * 0.46);
        ctx.save(); ctx.translate(x + 14, baseline);
        ctx.transform(0.98 + random() * 0.052, (random() - 0.5) * 0.052, -0.217 + (random() - 0.5) * 0.12, 0.96 + random() * 0.081, 0, 0);
        for (const [weight, path] of parts) {
          const line = new Path2D(path);
          ctx.strokeStyle = 'rgba(251,247,230,.22)'; ctx.lineWidth = weight + 1.35;
          ctx.stroke(line);
          ctx.strokeStyle = warmInk; ctx.lineWidth = weight * (0.92 + random() * 0.12); ctx.stroke(line);
        }
        ctx.restore(); x += advance + letterGap; n++;
      }
      x += wordGap;
    }
    ctx.fillStyle = warmInk;
    const underline = new Path2D(`M ${100 + variant * 15},100 Q ${length * 0.59},98 ${length - 36},94
      Q ${length - 19},94 ${length - 10},98 Q ${length - 5},104 ${length - 30},101
      Q ${length * 0.63},100 ${205 + variant * 10},105 Q 134,105 ${100 + variant * 15},100 Z`);
    ctx.fill(underline);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let j = 0; j < image.data.length; j += 4) {
      const opacity = image.data[j + 3];
      if (opacity === 0) continue;
      const point = j >> 2, px = point % canvas.width, py = (point / canvas.width) | 0, r = random();
      const dry = 1 - 0.045 * (1 + Math.sin(py * 1.30 + px * 0.035)) - 0.06 * random();
      image.data[j + 3] = opacity * dry * (r > 0.994 ? 0.36 : r > 0.974 ? 0.73 : 1);
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  } catch (error) {
    console.warn('TOPSPIN: rail tag texture unavailable.', error);
    return null;
  }
}

/* ------------------ tournament table geometry -------------------- */
/* The authored table runs its length along X and its width along Z. The
 * game runs the length along Z, so every authored point is mapped
 * (x, y, z) -> (z, y, x). Geometry is baked into one mesh per material. */
function tableGeoAppend(bucket, geo, matrix) {
  const g = { pos: geo.pos.slice(), nrm: geo.nrm.slice(), uv: geo.uv.slice(), idx: geo.idx.slice(), nv: geo.nv, ni: geo.ni };
  const nm = M4.normalFromMat4(new Float32Array(9), matrix);
  const p = { x: 0, y: 0, z: 0 }, n = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < g.nv; i++) {
    p.x = g.pos[i * 3]; p.y = g.pos[i * 3 + 1]; p.z = g.pos[i * 3 + 2];
    M4.transformPoint(p, matrix, p);
    g.pos[i * 3] = p.x; g.pos[i * 3 + 1] = p.y; g.pos[i * 3 + 2] = p.z;
    n.x = g.nrm[i * 3]; n.y = g.nrm[i * 3 + 1]; n.z = g.nrm[i * 3 + 2];
    const nx = nm[0] * n.x + nm[3] * n.y + nm[6] * n.z;
    const ny = nm[1] * n.x + nm[4] * n.y + nm[7] * n.z;
    const nz = nm[2] * n.x + nm[5] * n.y + nm[8] * n.z;
    const l = Math.hypot(nx, ny, nz) || 1;
    g.nrm[i * 3] = nx / l; g.nrm[i * 3 + 1] = ny / l; g.nrm[i * 3 + 2] = nz / l;
  }
  bucket.push(g);
}

function buildTournamentTable(T) {
  const buckets = { frame: [], frameDark: [], zinc: [], wheel: [], bolt: [], tape: [] };
  const _p = { x: 0, y: 0, z: 0 }, _s = { x: 1, y: 1, z: 1 }, _q = Q.new(), _m = M4.create();
  const box = (bucket, sx, sy, sz, x, y, z) => {
    M4.compose(_m, V3.set(_p, x, y, z), Q.identity(_q), V3.set(_s, 1, 1, 1));
    tableGeoAppend(buckets[bucket], makeBox(sx, sy, sz), _m);
  };
  const cyl = (bucket, r, h, x, y, z, axis = 'Y') => {
    const q = Q.identity(Q.new());
    if (axis === 'Z') Q.setAxisAngle(q, 1, 0, 0, Math.PI / 2);
    if (axis === 'X') Q.setAxisAngle(q, 0, 0, 1, Math.PI / 2);
    M4.compose(_m, V3.set(_p, x, y, z), q, V3.set(_s, 1, 1, 1));
    tableGeoAppend(buckets[bucket], makeCylinder(r, r, h, 18), _m);
  };
  const bar = (bucket, ax, ay, az, bx, by, bz, w, d) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1;
    const q = Q.new(), ux = dx / len, uy = dy / len, uz = dz / len, dot = uy;
    if (dot < -0.9999) Q.setAxisAngle(q, 1, 0, 0, Math.PI);
    else if (dot > 0.9999) Q.identity(q);
    else {
      const cx = uz, cz = -ux, s = Math.hypot(cx, cz) || 1;
      Q.setAxisAngle(q, cx / s, 0, cz / s, Math.acos(clamp(dot, -1, 1)));
    }
    M4.compose(_m, V3.set(_p, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, V3.set(_s, 1, 1, 1));
    tableGeoAppend(buckets[bucket], makeBox(w, len, d), _m);
  };
  const L = T.T_LEN, W = T.T_WID, Y = T.T_H, N = T.NET_H;
  for (const s of [-1, 1]) {
    // Long side rails (authored z = ±0.723 -> game x).
    for (const z of [-0.723, 0.723]) box('frame', 0.061, 0.048, L / 2 - 0.035, z, 0.699, s * (L / 4 + 0.001));
    // Short end rails.
    box('frame', W - 0.11, 0.045, 0.061, 0, 0.699, s * 1.325);
    // Corner legs, their plates and diagonal braces.
    for (const zs of [-1, 1]) {
      bar('frame', zs * 0.581, 0.674, s * 0.881, zs * 0.563, 0.114, s * 1.052, 0.063, 0.062);
      box('frame', 0.094, 0.029, 0.171, zs * 0.581, 0.673, s * 0.873);
      box('frame', 0.069, 0.064, 0.081, zs * 0.563, 0.117, s * 1.059);
      bar('frame', zs * 0.568, 0.663, s * 0.339, zs * 0.563, 0.271, s * 1.006, 0.026, 0.030);
      bar('frame', zs * 0.578, 0.653, s * 0.55, zs * 0.576, 0.409, s * 0.973, 0.014, 0.020);
      // Caster fork and rubber wheel. Authored axle Z -> game X.
      cyl('zinc', 0.028, 0.055, zs * 0.563, 0.109, s * 1.054, 'Y');
      box('frameDark', 0.062, 0.082, 0.048, zs * 0.564, 0.077, s * 1.058);
      const wx = zs * 0.564, wy = 0.055, wz = s * 1.067;
      cyl('wheel', 0.054, 0.048, wx, wy, wz, 'X');
      for (const az of [-1, 1]) {
        const face = wx + az * 0.0235;
        cyl('zinc', 0.047, 0.0038, face, wy, wz, 'X');
        cyl('bolt', 0.032, 0.005, face + az * 0.002, wy, wz, 'X');
        cyl('wheel', 0.020, 0.007, face + az * 0.004, wy, wz, 'X');
        cyl('bolt', 0.010, 0.008, face + az * 0.0056, wy, wz, 'X');
      }
    }
    bar('frame', -0.56, 0.145, s * 1.043, 0.56, 0.145, s * 1.043, 0.042, 0.038);
    bar('frame', -0.576, 0.654, s * 0.894, 0.576, 0.654, s * 0.894, 0.048, 0.044);
    bar('frame', -0.55, 0.633, s * 0.461, 0.55, 0.633, s * 0.461, 0.033, 0.033);
  }
  // Net posts and their little clamps. Authored z = ±0.899 -> game x.
  for (const s of [-1, 1]) {
    box('frame', 0.159, 0.014, 0.073, s * 0.814, Y + 0.0045, 0);
    box('frameDark', 0.019, 0.067, 0.062, s * 0.867, 0.713, 0);
    box('frame', 0.112, 0.012, 0.063, s * 0.813, 0.695, 0);
    cyl('frame', 0.0125, N + 0.019, s * 0.899, Y + N / 2 + 0.006, 0, 'Y');
    cyl('zinc', 0.015, 0.009, s * 0.899, Y + N + 0.016, 0, 'Y');
    cyl('wheel', 0.017, 0.011, s * 0.819, 0.684, 0, 'Y');
    cyl('bolt', 0.005, 0.006, s * 0.878, 0.737, 0, 'Z');
    box('frameDark', 0.017, N, 0.007, s * 0.880, Y + N / 2, 0);
  }
  // White top tape, modelled independently of the net weave.
  box('tape', 1.76, 0.0115, 0.004, 0, Y + N + 0.001, 0);
  const merged = {};
  for (const [key, list] of Object.entries(buckets)) merged[key] = list.length ? mergeGeo(list) : null;
  merged.markerSide = makeQuad(0.616, 0.043);
  merged.markerEnd = makeQuad(0.638, 0.043);
  return merged;
}

const PALETTES = {
  // Deliberately dark. A televised table-tennis hall is a pool of light
  // on a near-black floor: the ball has to be the brightest thing in the
  // frame, and it cannot be if the table glows back at you.
  arena: { table: '#092440', floor: '#0e1016', name: 'ARENA BLUE' },
  classic: { table: '#082c1f', floor: '#13110d', name: 'CLASSIC GREEN' },
  night: { table: '#100a21', floor: '#0a0a11', name: 'NIGHT PURPLE' },
};

/* ------------------------------ Scene ------------------------------ */
class Scene {
  constructor(renderer, paletteName = 'arena') {
    this.R = renderer;
    this.palette = PALETTES[paletteName] || PALETTES.arena;
    this.build();
  }

  build() {
    const R = this.R, P = this.palette;
    const T = PH;

    /* ---- textures ---- */
    const markerSide = markerTagTexture(0), markerEnd = markerTagTexture(1);
    this.tex = {
      table: R.texFromCanvas(texTableTop(P), { wrap: 'clamp' }),
      frame: R.texFromCanvas(texFrame(), { wrap: 'repeat' }),
      floor: R.texFromCanvas(texFloor(P), { wrap: 'repeat' }),
      net: R.texFromCanvas(texNet(), { wrap: 'clamp' }),
      ball: R.texFromCanvas(texBall(), { wrap: 'repeat' }),
      rubberRed: R.texFromCanvas(texRubber('#c1232c'), { wrap: 'clamp' }),
      rubberBlack: R.texFromCanvas(texRubber('#23242c'), { wrap: 'clamp' }),
      stands: R.texFromCanvas(texStandsFallback(), { wrap: 'repeat' }),
      glow: R.texFromCanvas(texGlow(), { wrap: 'clamp', mips: false }),
      ring: R.texFromCanvas(texRing(), { wrap: 'clamp', mips: false }),
      shadow: R.texFromCanvas(texShadow(), { wrap: 'clamp', mips: false }),
      tableGroundShadow: R.texFromCanvas(texTableGroundShadow(), { wrap: 'clamp', mips: false }),
      markerSide: markerSide ? R.texFromCanvas(markerSide, { wrap: 'clamp', mips: false }) : null,
      markerEnd: markerEnd ? R.texFromCanvas(markerEnd, { wrap: 'clamp', mips: false }) : null,
    };

    /* The image is embedded in the offline build. Keep the procedural hall
     * until it has decoded (also used when TT_NO_ARENA or an image fails). */
    this.hasPanorama = false;
    const A = (typeof window !== 'undefined' && window.__TT_ARENA) || {};
    this.standsSettled = !A.stands;
    this.panoramaSettled = !A.panorama;
    if (A.stands) arenaImageTex(R, A.stands, 2048, 256, (tx) => {
      this.tex.stands = tx; if (this.mat.stands) this.mat.stands.tex = tx;
    }, () => { this.standsSettled = true; });
    // WebGL1 only allows REPEAT on power-of-two textures; the 2880x1440 plate
    // would silently sample black there. Keep the full plate on WebGL2 and
    // downsample to the old POT size for the legacy context.
    const panoW = R.isGL2 ? 2880 : 2048, panoH = R.isGL2 ? 1440 : 1024;
    if (A.panorama) arenaImageTex(R, A.panorama, panoW, panoH, (tx) => {
      this.tex.panorama = tx; this.mat.panorama.tex = tx; this.mat.courtGround.tex = tx; this.hasPanorama = true;
    }, () => { this.panoramaSettled = true; });

    /* ---- table + room geometry ---- */
    const tableBody = makeBox(T.T_WID, T.T_THICK, T.T_LEN);
    // The separate top is the only upward face; no coplanar box roof or stretched side markings.
    tableBody.idx = tableBody.idx.filter(i => tableBody.nrm[i * 3 + 1] <= 0);
    tableBody.ni = tableBody.idx.length;
    const table = buildTournamentTable(T);
    this.mesh = {
      tableTop: R.mesh(makePlane(T.T_WID, T.T_LEN)),
      tableBody: R.mesh(tableBody),
      frame: table.frame ? R.mesh(table.frame) : null,
      frameDark: table.frameDark ? R.mesh(table.frameDark) : null,
      zinc: table.zinc ? R.mesh(table.zinc) : null,
      wheel: table.wheel ? R.mesh(table.wheel) : null,
      bolt: table.bolt ? R.mesh(table.bolt) : null,
      tape: table.tape ? R.mesh(table.tape) : null,
      markerSide: R.mesh(table.markerSide),
      markerEnd: R.mesh(table.markerEnd),
      net: R.mesh(makeQuad(T.T_WID + 2 * T.NET_OVERHANG, T.NET_H)),
      ball: R.mesh(makeSphere(T.R, 28, 20)),
      blade: R.mesh(makePaddleBlade(0.077, 0.082, 0.014, 44)),
      rubber: R.mesh(makePaddleBlade(0.072, 0.077, 0.003, 44)),
      handle: R.mesh(makeBox(0.030, 0.100, 0.022)),
      floor: R.mesh(makePlane(34, 30, 17)),
      quad: R.mesh(makeQuad(1, 1)),
      wall: R.mesh(makeQuadUV(1, 1, 1, 1)),
      sphere: R.mesh(makeSphere(1, 16, 12)),
      box: R.mesh(makeBox(1, 1, 1)),
      capsule: R.mesh(makeCapsule(1, 1, 14, 8)),
      trail: R.dynMesh(620),
      marks: R.dynMesh(400),
    };

    /* ---- materials ---- */
    const paint = P.table.slice(1).match(/../g).map(component => parseInt(component, 16) / 255);
    this.mat = {
      table: { color: [1, 1, 1], tex: this.tex.table, rough: 0.90, metal: 0.02, specTint: 0.24 },
      tableBody: { color: paint.map(component => component * 0.55 + 0.02), rough: 0.92, metal: 0.0, specTint: 0.20 },
      frame: { color: [0.16, 0.19, 0.19], tex: this.tex.frame, rough: 0.48, metal: 0.34 },
      frameDark: { color: [0.09, 0.11, 0.11], rough: 0.58, metal: 0.22 },
      zinc: { color: [0.34, 0.38, 0.36], rough: 0.45, metal: 0.68 },
      wheel: { color: [0.05, 0.06, 0.06], rough: 0.84, metal: 0.03 },
      bolt: { color: [0.54, 0.58, 0.56], rough: 0.36, metal: 0.72 },
      tape: { color: [0.93, 0.93, 0.90], rough: 0.87, metal: 0.0 },
      net: { color: [1, 1, 1], tex: this.tex.net, rough: 0.72, alphaTest: 0.08, blend: true, doubleSided: true },
      ball: { color: [1.0, 1.0, 0.99], tex: this.tex.ball, rough: 0.33, metal: 0, specTint: 1.5, emissive: [0.34, 0.335, 0.29], rim: 0.62, rimCol: [1.0, 0.97, 0.88], rimPower: 2.0 },
      bladeWood: { color: [0.92, 0.72, 0.47], rough: 0.46, emissive: [0.055, 0.042, 0.028], rim: 0.26, rimCol: [0.72, 0.82, 1.0], rimPower: 2.2 },
      rubberRed: { color: [1.08, 1.08, 1.08], tex: this.tex.rubberRed, rough: 0.74, specTint: 0.8, emissive: [0.075, 0.020, 0.016], rim: 0.30, rimCol: [1.0, 0.64, 0.56], rimPower: 2.1 },
      rubberBlack: { color: [1, 1, 1], tex: this.tex.rubberBlack, rough: 0.78, specTint: 0.7, emissive: [0.022, 0.026, 0.034], rim: 0.34, rimCol: [0.66, 0.80, 1.0], rimPower: 2.0 },
      handle: { color: [0.26, 0.17, 0.12], rough: 0.62, emissive: [0.022, 0.015, 0.011] },
      floor: { color: [0.52, 0.54, 0.60], tex: this.tex.floor, rough: 0.80 },
      stands: { color: [0.82, 0.82, 0.88], tex: this.tex.stands, rough: 1.0 },
      panorama: { color: [1, 1, 1], unlitTexture: true, doubleSided: true, rough: 1 },
      courtGround: { color: [0.52, 0.54, 0.60], tex: this.tex.floor, rough: 0.80 },
      trail: { color: [1, 1, 1], rough: 1, blend: 'add', emissive: [1, 1, 1], doubleSided: true },
      mark: { color: [1, 1, 1], rough: 1, blend: true, doubleSided: true, emissive: [0.4, 0.4, 0.4] },
      glow: { color: [1, 1, 1], tex: this.tex.glow, blend: 'add', emissive: [1, 1, 1], doubleSided: true, rough: 1 },
      ring: { color: [1, 1, 1], tex: this.tex.ring, blend: 'add', emissive: [1, 1, 1], doubleSided: true, rough: 1 },
      ceiling: { color: [0.07, 0.10, 0.16], emissive: [0.016, 0.026, 0.048], rough: 0.95 },
      shadow: { color: [0, 0, 0], tex: this.tex.shadow, unlit: true, emissive: [0, 0, 0], blend: true, doubleSided: true, rough: 1 },
      pool: { color: [1, 1, 1], tex: this.tex.glow, blend: 'add', emissive: [0.050, 0.058, 0.080], doubleSided: true, rough: 1 },
    };
    if (this.tex.markerSide) this.mat.markerSide = { color: [1, 1, 1], tex: this.tex.markerSide, rough: 0.78, alphaTest: 0.11 };
    if (this.tex.markerEnd) this.mat.markerEnd = { color: [1, 1, 1], tex: this.tex.markerEnd, rough: 0.78, alphaTest: 0.11 };

    this.rackets = {};
    let pending = 0;
    const models = typeof TT_RACKETS !== 'undefined' ? TT_RACKETS : {};
    for (const [id, model] of Object.entries(models)) {
      const parts = model.parts.map(part => ({ mesh: R.mesh(racketGeometry(part)),
        mat: { ...part.material, tex: part.material.texture !== undefined ? R.white : null } }));
      this.rackets[id] = { parts, singleFace: model.singleFace, faceOffset: model.faceOffset };
      for (let index = 0; index < model.textures.length; index++) {
        const image = new Image(); pending++;
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true; image.onload = image.onerror = null;
          this.racketsSettled = --pending === 0;
        };
        image.onload = () => {
          if (settled) return;
          try {
            // glTF UVs already address image rows from the top; don't flip the atlas.
            // The pan's authored sampler repeats its POT texture; the standard atlas stays clamped.
            const texture = R.texFromCanvas(image, { wrap: id === 'r-pan' ? 'repeat' : 'clamp', flipY: false });
            if (!texture || R.gl?.getError && R.gl.getError() !== 0) {
              if (texture) R.gl?.deleteTexture?.(texture);
              return;
            }
            for (const part of parts) if (part.mat.texture === index) part.mat.tex = texture;
          } catch (error) {
            console.warn('Racket texture upload failed', error);
          } finally { settle(); }
        };
        image.onerror = settle;
        try { image.src = model.textures[index]; } catch (error) { settle(); }
      }
    }
    this.racketsSettled = pending === 0;

    /* ---- static transform cache ---- */
    this.M = {};
    const m = (k) => (this.M[k] = this.M[k] || M4.create());
    const pos = V3.new(), rot = Q.new(), scl = V3.new(1, 1, 1);

    M4.compose(m('tableBody'), V3.set(pos, 0, T.T_H - T.T_THICK / 2, 0),
      Q.identity(rot), V3.set(scl, 1, 1, 1));
    M4.compose(m('tableTop'), V3.set(pos, 0, T.T_H, 0),
      Q.identity(rot), V3.set(scl, 1, 1, 1));
    M4.compose(m('net'), V3.set(pos, 0, T.T_H + T.NET_H / 2, 0),
      Q.identity(rot), V3.set(scl, 1, 1, 1));
    M4.compose(m('floor'), V3.set(pos, 0, 0, 0), Q.identity(rot), V3.set(scl, 1, 1, 1));
    M4.compose(m('room'), V3.set(pos, 0, 0, 0), Q.identity(rot), V3.set(scl, 1, 1, 1));

    // Rail tags. The authored side rail lies on z=±0.754 and faces ±Z;
    // in game space that is x=±0.754 facing ±X.
    this.M.markerSides = [];
    for (const s of [-1, 1]) {
      const mm = M4.create();
      M4.compose(mm, V3.set(pos, s * 0.75435, 0.700, -s * 0.743),
        Q.setAxisAngle(rot, 0, 1, 0, s > 0 ? Math.PI / 2 : -Math.PI / 2), V3.set(scl, 1, 1, 1));
      this.M.markerSides.push(mm);
    }
    // Authored end tag at x=-1.356, z=-0.052, facing -X; game end is z=-1.356 facing -Z.
    M4.compose(m('markerEnd'), V3.set(pos, -0.052, 0.699, -1.35635),
      Q.setAxisAngle(rot, 0, 1, 0, Math.PI), V3.set(scl, 1, 1, 1));

    // fallback hall: bare walls + ceiling
    this.walls = [];
    for (const [x, z, w, h, ry] of [[0, -14, 36, 11, 0], [0, 14, 36, 11, Math.PI], [-16.5, 0, 30, 11, Math.PI / 2], [16.5, 0, 30, 11, -Math.PI / 2]]) {
      const mm = M4.create();
      M4.compose(mm, V3.set(pos, x, h / 2 - 0.5, z), Q.setAxisAngle(rot, 0, 1, 0, ry), V3.set(scl, w, h, 1));
      this.walls.push(mm);
    }
    this.ceiling = M4.create();
    M4.compose(this.ceiling, V3.set(pos, 0, 5.4, 0), Q.setAxisAngle(rot, 1, 0, 0, Math.PI / 2), V3.set(scl, 36, 30, 1));

    // a soft pool of light on the floor: sells "this table is lit" without
    // a single shadow-map texel
    this.floorPool = M4.create();
    M4.compose(this.floorPool, V3.set(pos, 0, 0.004, 0),
      Q.setAxisAngle(rot, 1, 0, 0, -Math.PI / 2), V3.set(scl, 9.0, 7.2, 1));

    // A stable, table-shaped shadow is drawn on the same ground as the feet.
    this.tableShade = M4.create();
    M4.compose(this.tableShade, V3.set(pos, 0, 0.012, 0),
      Q.setAxisAngle(rot, 1, 0, 0, -Math.PI / 2),
      V3.set(scl, TABLE_GROUND_SHADOW.width, TABLE_GROUND_SHADOW.depth, 1));

    this._tmp = { pos: V3.new(), rot: Q.new(), scl: V3.new(1, 1, 1), m: M4.create(), m2: M4.create() };
    this._sm = M4.create(); this._sp = V3.new(); this._sq = Q.new(); this._ss = V3.new();
    this._shadowMat = { color: [0, 0, 0], tex: this.tex.shadow, unlit: true, emissive: [0, 0, 0], blend: true, doubleSided: true, rough: 1, opacity: 1 };
    this._shadowMat0 = { color: [0, 0, 0], tex: this.tex.tableGroundShadow, unlit: true, emissive: [0, 0, 0], blend: true, doubleSided: true, rough: 1, opacity: 1 };
  }

  /**
   * Soft contact shadow projected straight down onto a horizontal surface.
   * Height above the surface widens and fades it, exactly like a real
   * penumbra, and it costs one quad.
   */
  blob(R, x, y, z, surfaceY, radius, strength, stretch) {
    const h = Math.max(0, y - surfaceY);
    const grow = 1 + h * 1.5;
    const a = strength * Math.exp(-h * 2.1);
    if (a < 0.012) return;
    const r = radius * grow;
    M4.compose(this._sm, V3.set(this._sp, x, surfaceY + 0.0028, z),
      Q.setAxisAngle(this._sq, 1, 0, 0, -Math.PI / 2),
      V3.set(this._ss, r, r * (stretch || 1), 1));
    this._shadowMat.opacity = Math.min(a, 0.85);
    R.draw(this.mesh.quad, this._sm, this._shadowMat);
  }

  /* Глянцевое размазывание блика по столу (бывший gloss) удалено: светлое
   * пятно под мячем спорило с контактной тенью и врало о высоте. Единственный
   * индикатор высоты теперь — тень в drawContactShadows. */

  /* --------------------------- drawing ---------------------------- */
  /** the net is alpha-blended, so it must be drawn after every opaque
   *  object (including the ball) or it would be overwritten. */
  drawNet(R) { R.draw(this.mesh.net, this.M.net, this.mat.net); }

  drawStatic(R, shadowPass) {
    const d = shadowPass
      ? (mesh, mat4, mat) => R.drawShadow(mesh, mat4, mat && mat.alphaTest ? mat.tex : null, mat && mat.alphaTest)
      : (mesh, mat4, mat) => R.draw(mesh, mat4, mat);
    const M = this.M, me = this.mesh, ma = this.mat;
    if (!shadowPass) {
      if (this.hasPanorama) {
        // One stationary environment and one projection for both the image
        // and the model: translation during the orbit produces real parallax.
        d(me.room, M.room, ma.panorama);
      } else {
        d(me.floor, M.floor, ma.floor);
        R.draw(me.quad, this.floorPool, ma.pool);
        for (const w of this.walls) d(me.wall, w, ma.stands);
        d(me.quad, this.ceiling, ma.ceiling);
      }
      R.draw(me.quad, this.tableShade, this._shadowMat0);
    }
    d(me.tableBody, M.tableBody, ma.tableBody);
    d(me.tableTop, M.tableTop, ma.table);
    if (me.frame) d(me.frame, M.floor, ma.frame);
    if (me.frameDark) d(me.frameDark, M.floor, ma.frameDark);
    if (me.zinc) d(me.zinc, M.floor, ma.zinc);
    if (me.wheel) d(me.wheel, M.floor, ma.wheel);
    if (me.bolt) d(me.bolt, M.floor, ma.bolt);
    if (me.tape) d(me.tape, M.floor, ma.tape);
    if (!shadowPass && me.markerSide && ma.markerSide) {
      for (const mm of this.M.markerSides) d(me.markerSide, mm, ma.markerSide);
      d(me.markerEnd, this.M.markerEnd, ma.markerEnd);
    }
    if (shadowPass) d(me.net, M.net, ma.net);
  }
}
