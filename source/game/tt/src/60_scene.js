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
  const base = palette.table || '#123f74';
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(178,190,184,0.12)'; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (random() - 0.5) * 6;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const rg = g.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.62);
  rg.addColorStop(0, 'rgba(255,255,255,0.020)');
  rg.addColorStop(1, 'rgba(0,0,0,0.11)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 36; i++) {
    const x = random() * W, y = random() * H, r = 20 + random() * 90;
    const patch = g.createRadialGradient(x, y, 0, x, y, r);
    patch.addColorStop(0, i % 3 ? 'rgba(214,221,205,0.035)' : 'rgba(47,54,48,0.04)');
    patch.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = patch; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 100; i++) {
    g.fillStyle = 'rgba(196,202,180,0.04)';
    g.fillRect(random() * W, random() * H, 8 + random() * 80, 1 + random() * 2);
  }
  // ITTF markings: 20 mm side + end lines, 3 mm centre line
  const lwX = Math.max(3, Math.round(W * 0.020 / PH.T_WID));
  const lwY = Math.max(3, Math.round(H * 0.020 / PH.T_LEN));
  g.fillStyle = '#e9e9df'; g.globalAlpha = 0.93;
  g.fillRect(0, 0, lwX, H); g.fillRect(W - lwX, 0, lwX, H);      // side lines
  g.fillRect(0, 0, W, lwY); g.fillRect(0, H - lwY, W, lwY);      // end lines
  const clw = Math.max(2, Math.round(W * 0.003 / PH.T_WID));
  g.fillRect((W - clw) / 2, 0, clw, H);                          // centre line
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, H / 2 - 1, W, 2);  // halves seam
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
  g.fillStyle = '#343b3c'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = i % 3 ? 'rgba(203,206,190,0.045)' : 'rgba(12,18,19,0.08)';
    g.fillRect(random() * S, random() * S, 1, 1 + random() * 3);
  }
  for (let i = 0; i < 22; i++) {
    const x = random() * S, y = random() * S, r = 2 + random() * 9;
    const rust = g.createRadialGradient(x, y, 0, x, y, r);
    rust.addColorStop(0, 'rgba(129,81,45,0.42)'); rust.addColorStop(1, 'rgba(129,81,45,0)');
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
    };

    /* The image is embedded in the offline build. Keep the procedural hall
     * until it has decoded (also used when TT_NO_ARENA or an image fails). */
    this.hasPanorama = false;
    const A = (typeof window !== 'undefined' && window.__TT_ARENA) || {};
    this.standsSettled = !A.stands;
    this.panoramaSettled = !A.panorama;
    this.asphaltSettled = !A.asphalt;
    if (A.stands) arenaImageTex(R, A.stands, 2048, 256, (tx) => {
      this.tex.stands = tx; if (this.mat.stands) this.mat.stands.tex = tx;
    }, () => { this.standsSettled = true; });
    if (A.panorama) arenaImageTex(R, A.panorama, 2048, 1024, (tx) => {
      this.tex.panorama = tx; this.mat.panorama.tex = tx; this.mat.courtGround.tex = tx; this.hasPanorama = true;
    }, () => { this.panoramaSettled = true; });
    if (A.asphalt) arenaImageTex(R, A.asphalt, 512, 512, (tx) => {
      this.tex.asphalt = tx; this.mat.courtGround.asphalt = tx;
    }, () => { this.asphaltSettled = true; });

    /* ---- meshes ---- */
    const tableBody = makeBox(T.T_WID, T.T_THICK, T.T_LEN);
    // The separate top is the only upward face; no coplanar box roof or stretched side markings.
    tableBody.idx = tableBody.idx.filter(i => tableBody.nrm[i * 3 + 1] <= 0);
    tableBody.ni = tableBody.idx.length;
    this.mesh = {
      tableTop: R.mesh(makePlane(T.T_WID, T.T_LEN)),
      tableBody: R.mesh(tableBody),
      apron: R.mesh(makeBox(1, 1, 1)),
      leg: R.mesh(makeCylinder(0.035, 0.030, T.T_H - T.T_THICK, 14)),
      legBar: R.mesh(makeBox(1, 1, 1)),
      net: R.mesh(makeQuad(T.T_WID + 2 * T.NET_OVERHANG, T.NET_H)),
      netPost: R.mesh(makeCylinder(0.013, 0.016, T.NET_H + 0.04, 12)),
      ball: R.mesh(makeSphere(T.R, 28, 20)),
      blade: R.mesh(makePaddleBlade(0.077, 0.082, 0.014, 44)),
      rubber: R.mesh(makePaddleBlade(0.072, 0.077, 0.003, 44)),
      handle: R.mesh(makeBox(0.030, 0.100, 0.022)),
      floor: R.mesh(makePlane(34, 30, 17)),
      courtFloor: R.mesh(makeStreetCourtFloor()),
      courtShell: R.mesh(makeStreetCourtShell()),
      courtMarking: R.mesh(makeStreetCourtMarking()),
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
      table: { color: [0.88, 0.91, 0.96], tex: this.tex.table, rough: 0.90, metal: 0.0, specTint: 0.22 },
      tableBody: { color: paint.map(component => component * 0.88 + 0.025), rough: 0.92, metal: 0.0, specTint: 0.20 },
      apron: { color: [0.18, 0.22, 0.24], rough: 0.86, metal: 0.0, specTint: 0.35 },
      frame: { color: [0.50, 0.55, 0.60], tex: this.tex.frame, rough: 0.82, metal: 0.42 },
      net: { color: [1, 1, 1], tex: this.tex.net, rough: 0.72, alphaTest: 0.08, blend: true, doubleSided: true },
      post: { color: [0.50, 0.55, 0.60], tex: this.tex.frame, rough: 0.60, metal: 0.70 },
      ball: { color: [1.0, 1.0, 0.99], tex: this.tex.ball, rough: 0.33, metal: 0, specTint: 1.5, emissive: [0.34, 0.335, 0.29], rim: 0.62, rimCol: [1.0, 0.97, 0.88], rimPower: 2.0 },
      bladeWood: { color: [0.92, 0.72, 0.47], rough: 0.46, emissive: [0.055, 0.042, 0.028], rim: 0.26, rimCol: [0.72, 0.82, 1.0], rimPower: 2.2 },
      rubberRed: { color: [1.08, 1.08, 1.08], tex: this.tex.rubberRed, rough: 0.74, specTint: 0.8, emissive: [0.075, 0.020, 0.016], rim: 0.30, rimCol: [1.0, 0.64, 0.56], rimPower: 2.1 },
      rubberBlack: { color: [1, 1, 1], tex: this.tex.rubberBlack, rough: 0.78, specTint: 0.7, emissive: [0.022, 0.026, 0.034], rim: 0.34, rimCol: [0.66, 0.80, 1.0], rimPower: 2.0 },
      handle: { color: [0.26, 0.17, 0.12], rough: 0.62, emissive: [0.022, 0.015, 0.011] },
      floor: { color: [0.52, 0.54, 0.60], tex: this.tex.floor, rough: 0.80 },
      stands: { color: [0.82, 0.82, 0.88], tex: this.tex.stands, rough: 1.0 },
      panorama: { color: [1, 1, 1], unlitTexture: true, doubleSided: true, rough: 1 },
      courtGround: { color: [1, 1, 1], unlitTexture: true, doubleSided: true, rough: 1 },
      courtMarking: { color: [0, 0, 0], unlit: true, emissive: [0.07, 0.28, 0.34], blend: true, opacity: 0.78, doubleSided: true },
      trail: { color: [1, 1, 1], rough: 1, blend: 'add', emissive: [1, 1, 1], doubleSided: true },
      mark: { color: [1, 1, 1], rough: 1, blend: true, doubleSided: true, emissive: [0.4, 0.4, 0.4] },
      glow: { color: [1, 1, 1], tex: this.tex.glow, blend: 'add', emissive: [1, 1, 1], doubleSided: true, rough: 1 },
      ring: { color: [1, 1, 1], tex: this.tex.ring, blend: 'add', emissive: [1, 1, 1], doubleSided: true, rough: 1 },
      ceiling: { color: [0.07, 0.10, 0.16], emissive: [0.016, 0.026, 0.048], rough: 0.95 },
      shadow: { color: [0, 0, 0], tex: this.tex.shadow, unlit: true, emissive: [0, 0, 0], blend: true, doubleSided: true, rough: 1 },
      pool: { color: [1, 1, 1], tex: this.tex.glow, blend: 'add', emissive: [0.050, 0.058, 0.080], doubleSided: true, rough: 1 },
    };

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

    // slim rail around the rim, flush with the body
    const ap = 0.016;
    const apY = T.T_H - T.T_THICK - 0.034 / 2;
    M4.compose(m('apronN'), V3.set(pos, 0, apY, -T.T_HALF_LEN + ap / 2),
      Q.identity(rot), V3.set(scl, T.T_WID, 0.034, ap));
    M4.compose(m('apronS'), V3.set(pos, 0, apY, T.T_HALF_LEN - ap / 2),
      Q.identity(rot), V3.set(scl, T.T_WID, 0.034, ap));
    M4.compose(m('apronW'), V3.set(pos, -T.T_HALF_WID + ap / 2, apY, 0),
      Q.identity(rot), V3.set(scl, ap, 0.034, T.T_LEN - ap * 2));
    M4.compose(m('apronE'), V3.set(pos, T.T_HALF_WID - ap / 2, apY, 0),
      Q.identity(rot), V3.set(scl, ap, 0.034, T.T_LEN - ap * 2));

    this.legs = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const mm = M4.create();
      M4.compose(mm, V3.set(pos, sx * (T.T_HALF_WID - 0.14), (T.T_H - T.T_THICK) / 2, sz * (T.T_HALF_LEN - 0.22)),
        Q.identity(rot), V3.set(scl, 1, 1, 1));
      this.legs.push(mm);
    }
    this.legBars = [];
    for (const sz of [-1, 1]) {
      const mm = M4.create();
      M4.compose(mm, V3.set(pos, 0, 0.14, sz * (T.T_HALF_LEN - 0.22)), Q.identity(rot),
        V3.set(scl, 2 * (T.T_HALF_WID - 0.14), 0.04, 0.04));
      this.legBars.push(mm);
    }
    for (const sz of [-1, 1]) {
      const mm = M4.create();
      M4.compose(mm, V3.set(pos, 0, T.T_H - 0.10, sz * (T.T_HALF_LEN - 0.55)), Q.identity(rot),
        V3.set(scl, 2 * (T.T_HALF_WID - 0.14), 0.05, 0.05));
      this.legBars.push(mm);
    }

    M4.compose(m('net'), V3.set(pos, 0, T.T_H + T.NET_H / 2, 0),
      Q.identity(rot), V3.set(scl, 1, 1, 1));
    this.netPosts = [];
    for (const sx of [-1, 1]) {
      const mm = M4.create();
      M4.compose(mm, V3.set(pos, sx * (T.T_HALF_WID + T.NET_OVERHANG), T.T_H + (T.NET_H + 0.04) / 2 - 0.02, 0),
        Q.identity(rot), V3.set(scl, 1, 1, 1));
      this.netPosts.push(mm);
    }

    M4.compose(m('floor'), V3.set(pos, 0, 0, 0), Q.identity(rot), V3.set(scl, 1, 1, 1));

    /* Борта, LED-баннеры и потолочные панели убраны: зал остался голыми
     * стенами с трибуной — игроку читать мяч проще, кадру дешевле. */

    // far wall + ceiling
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
        d(me.courtShell, M.floor, ma.panorama);
        d(me.courtFloor, M.floor, ma.courtGround);
        if (ma.courtGround.asphalt) R.draw(me.courtMarking, M.floor, ma.courtMarking);
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
    d(me.box, M.apronN, ma.apron); d(me.box, M.apronS, ma.apron);
    d(me.box, M.apronW, ma.apron); d(me.box, M.apronE, ma.apron);
    for (const l of this.legs) d(me.leg, l, ma.frame);
    for (const l of this.legBars) d(me.box, l, ma.frame);
    for (const p of this.netPosts) d(me.netPost, p, ma.post);
    if (shadowPass) d(me.net, M.net, ma.net);
  }
}
