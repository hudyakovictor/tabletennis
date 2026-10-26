/* =====================================================================
 *  SCENE — all geometry and every texture is generated at runtime.
 *  Dimensions follow ITTF: table 2.74 x 1.525 x 0.76 m, net 15.25 cm.
 * ===================================================================== */
'use strict';

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

/* ------------------------- procedural textures --------------------- */
function texTableTop(palette) {
  // canvas x = table WIDTH (1.525 m), canvas y = table LENGTH (2.74 m)
  const W = 1024, H = 1840, c = cv(W, H), g = c.getContext('2d');
  const base = palette.table || '#123f74';
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const rg = g.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.62);
  rg.addColorStop(0, 'rgba(255,255,255,0.040)');
  rg.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  // ITTF markings: 20 mm side + end lines, 3 mm centre line
  const lwX = Math.max(3, Math.round(W * 0.020 / PH.T_WID));
  const lwY = Math.max(3, Math.round(H * 0.020 / PH.T_LEN));
  g.fillStyle = '#ffffff'; g.globalAlpha = 0.95;
  g.fillRect(0, 0, lwX, H); g.fillRect(W - lwX, 0, lwX, H);      // side lines
  g.fillRect(0, 0, W, lwY); g.fillRect(0, H - lwY, W, lwY);      // end lines
  const clw = Math.max(2, Math.round(W * 0.003 / PH.T_WID));
  g.fillRect((W - clw) / 2, 0, clw, H);                          // centre line
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(0, H / 2 - 2, W, 4);  // halves seam
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
  g.clearRect(0, 0, W, H);
  // mesh
  g.strokeStyle = 'rgba(232,240,255,0.78)'; g.lineWidth = 1.5;
  const cells = 86;
  for (let i = 0; i <= cells; i++) {
    const x = i * W / cells;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H * 0.86); g.stroke();
  }
  const rows = 22;
  for (let j = 0; j <= rows; j++) {
    const y = H * 0.86 * j / rows;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  // white tape along the top
  g.fillStyle = '#f2f6ff'; g.fillRect(0, H * 0.86, W, H * 0.14);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, H * 0.86, W, 3);
  // bottom cord
  g.strokeStyle = 'rgba(240,246,255,0.9)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 2); g.lineTo(W, 2); g.stroke();
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
  // a logo pressed into the topsheet
  g.globalAlpha = 0.16; g.fillStyle = '#fff';
  g.font = '800 30px ui-sans-serif,system-ui,sans-serif'; g.textAlign = 'center';
  g.fillText('TOPSPIN', S / 2, S * 0.58);
  g.globalAlpha = 1;
  return c;
}

function texBanner(palette) {
  // a calm dark board with a single accent line - no shouty repeated text
  const W = 512, H = 128, c = cv(W, H), g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0, '#16233a'); lg.addColorStop(0.5, '#101a2c'); lg.addColorStop(1, '#0a1220');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(57,198,255,0.55)'; g.fillRect(0, 0, W, 3);
  g.fillStyle = 'rgba(57,198,255,0.08)'; g.fillRect(0, 3, W, 10);
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, H - 6, W, 6);
  return c;
}

function texWall(palette) {
  // A calm vertical gradient. No text, no noise: the hall must never
  // compete with the ball for the player's attention.
  const W = 32, H = 512, c = cv(W, H), g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0.00, '#020305');
  lg.addColorStop(0.42, '#03060b');
  lg.addColorStop(0.78, '#081020');
  lg.addColorStop(0.94, '#101c30');
  lg.addColorStop(1.00, '#070b14');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
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
      floor: R.texFromCanvas(texFloor(P), { wrap: 'repeat' }),
      net: R.texFromCanvas(texNet(), { wrap: 'clamp' }),
      ball: R.texFromCanvas(texBall(), { wrap: 'repeat' }),
      rubberRed: R.texFromCanvas(texRubber('#c1232c'), { wrap: 'clamp' }),
      rubberBlack: R.texFromCanvas(texRubber('#23242c'), { wrap: 'clamp' }),
      banner: R.texFromCanvas(texBanner(P), { wrap: 'repeat' }),
      wall: R.texFromCanvas(texWall(P), { wrap: 'repeat' }),
      glow: R.texFromCanvas(texGlow(), { wrap: 'clamp', mips: false }),
      ring: R.texFromCanvas(texRing(), { wrap: 'clamp', mips: false }),
      shadow: R.texFromCanvas(texShadow(), { wrap: 'clamp', mips: false }),
    };

    /* ---- meshes ---- */
    this.mesh = {
      tableTop: R.mesh(makeBox(T.T_WID, T.T_THICK, T.T_LEN, 1, true)),
      apron: R.mesh(makeBox(1, 1, 1)),
      leg: R.mesh(makeCylinder(0.035, 0.030, T.T_H - T.T_THICK, 14)),
      legBar: R.mesh(makeBox(1, 1, 1)),
      net: R.mesh(makeQuad(T.T_WID + 2 * T.NET_OVERHANG, T.NET_H)),
      netPost: R.mesh(makeCylinder(0.013, 0.016, T.NET_H + 0.04, 12)),
      ball: R.mesh(makeSphere(T.R, 28, 20)),
      blade: R.mesh(makePaddleBlade(0.077, 0.082, 0.014, 44)),
      rubber: R.mesh(makePaddleBlade(0.072, 0.077, 0.003, 44)),
      handle: R.mesh(makeBox(0.030, 0.100, 0.022)),
      floor: R.mesh(makePlane(26, 26, 13)),
      quad: R.mesh(makeQuad(1, 1)),
      bannerLong: R.mesh(makeQuadUV(1, 1, 4, 1)),
      bannerShort: R.mesh(makeQuadUV(1, 1, 3.4, 1)),
      wall: R.mesh(makeQuadUV(1, 1, 1, 1)),
      sphere: R.mesh(makeSphere(1, 16, 12)),
      box: R.mesh(makeBox(1, 1, 1)),
      capsule: R.mesh(makeCapsule(1, 1, 14, 8)),
      trail: R.dynMesh(620),
      marks: R.dynMesh(400),
    };

    /* ---- materials ---- */
    this.mat = {
      table: { color: [0.74, 0.77, 0.84], tex: this.tex.table, rough: 0.48, metal: 0.0, specTint: 0.88 },
      apron: { color: [0.34, 0.37, 0.44], rough: 0.56, metal: 0.0, specTint: 0.6 },
      frame: { color: [0.10, 0.11, 0.14], rough: 0.38, metal: 0.72 },
      net: { color: [1, 1, 1], tex: this.tex.net, rough: 0.72, alphaTest: 0.08, blend: true, doubleSided: true },
      post: { color: [0.08, 0.09, 0.11], rough: 0.32, metal: 0.8 },
      ball: { color: [1.0, 1.0, 0.99], tex: this.tex.ball, rough: 0.33, metal: 0, specTint: 1.5, emissive: [0.34, 0.335, 0.29], rim: 0.62, rimCol: [1.0, 0.97, 0.88], rimPower: 2.0 },
      bladeWood: { color: [0.92, 0.72, 0.47], rough: 0.46, emissive: [0.055, 0.042, 0.028], rim: 0.26, rimCol: [0.72, 0.82, 1.0], rimPower: 2.2 },
      rubberRed: { color: [1.08, 1.08, 1.08], tex: this.tex.rubberRed, rough: 0.74, specTint: 0.8, emissive: [0.075, 0.020, 0.016], rim: 0.30, rimCol: [1.0, 0.64, 0.56], rimPower: 2.1 },
      rubberBlack: { color: [1, 1, 1], tex: this.tex.rubberBlack, rough: 0.78, specTint: 0.7, emissive: [0.022, 0.026, 0.034], rim: 0.34, rimCol: [0.66, 0.80, 1.0], rimPower: 2.0 },
      handle: { color: [0.26, 0.17, 0.12], rough: 0.62, emissive: [0.022, 0.015, 0.011] },
      floor: { color: [0.52, 0.54, 0.60], tex: this.tex.floor, rough: 0.80 },
      wall: { color: [1, 1, 1], tex: this.tex.wall, rough: 1.0, emissive: [0.006, 0.009, 0.016] },
      banner: { color: [1, 1, 1], tex: this.tex.banner, rough: 0.52, emissive: [0.02, 0.04, 0.07] },
      barrier: { color: [0.06, 0.08, 0.12], rough: 0.5 },
      trail: { color: [1, 1, 1], rough: 1, blend: 'add', emissive: [1, 1, 1], doubleSided: true },
      mark: { color: [1, 1, 1], rough: 1, blend: true, doubleSided: true, emissive: [0.4, 0.4, 0.4] },
      glow: { color: [1, 1, 1], tex: this.tex.glow, blend: 'add', emissive: [1, 1, 1], doubleSided: true, rough: 1 },
      ring: { color: [1, 1, 1], tex: this.tex.ring, blend: 'add', emissive: [1, 1, 1], doubleSided: true, rough: 1 },
      light: { color: [1, 1, 1], emissive: [3.4, 3.35, 3.1], rough: 0.2 },
      lightBody: { color: [0.14, 0.15, 0.18], rough: 0.4, metal: 0.6 },
      ceiling: { color: [0.04, 0.047, 0.06], rough: 0.95 },
      shadow: { color: [0, 0, 0], tex: this.tex.shadow, unlit: true, emissive: [0, 0, 0], blend: true, doubleSided: true, rough: 1 },
      pool: { color: [1, 1, 1], tex: this.tex.glow, blend: 'add', emissive: [0.050, 0.058, 0.080], doubleSided: true, rough: 1 },
      gloss: { color: [1, 1, 1], tex: this.tex.glow, blend: 'add', emissive: [1, 1, 1], doubleSided: true, rough: 1, unlit: true },
    };

    /* ---- static transform cache ---- */
    this.M = {};
    const m = (k) => (this.M[k] = this.M[k] || M4.create());
    const pos = V3.new(), rot = Q.new(), scl = V3.new(1, 1, 1);

    M4.compose(m('tableTop'), V3.set(pos, 0, T.T_H - T.T_THICK / 2, 0),
      Q.identity(rot), V3.set(scl, 1, 1, 1));

    // slim rail around the rim, flush with the body
    const ap = 0.016;
    const apY = T.T_H - T.T_THICK - 0.010;
    M4.compose(m('apronN'), V3.set(pos, 0, apY, -T.T_HALF_LEN + ap / 2),
      Q.identity(rot), V3.set(scl, T.T_WID + 0.004, 0.034, ap));
    M4.compose(m('apronS'), V3.set(pos, 0, apY, T.T_HALF_LEN - ap / 2),
      Q.identity(rot), V3.set(scl, T.T_WID + 0.004, 0.034, ap));
    M4.compose(m('apronW'), V3.set(pos, -T.T_HALF_WID + ap / 2, apY, 0),
      Q.identity(rot), V3.set(scl, ap, 0.034, T.T_LEN + 0.004));
    M4.compose(m('apronE'), V3.set(pos, T.T_HALF_WID - ap / 2, apY, 0),
      Q.identity(rot), V3.set(scl, ap, 0.034, T.T_LEN + 0.004));

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

    // surrounding barriers removed per user request: clear unobstructed arena
    this.barriers = [];

    // far wall + ceiling
    this.walls = [];
    for (const [x, z, w, h, ry] of [[0, -11, 30, 10, 0], [0, 11, 30, 10, Math.PI], [-13, 0, 24, 10, Math.PI / 2], [13, 0, 24, 10, -Math.PI / 2]]) {
      const mm = M4.create();
      M4.compose(mm, V3.set(pos, x, h / 2 - 0.5, z), Q.setAxisAngle(rot, 0, 1, 0, ry), V3.set(scl, w, h, 1));
      this.walls.push(mm);
    }
    // ceiling light bars removed per user request: no overhead clutter
    this.lights = []; this.lightBodies = [];
    this.ceiling = M4.create();
    M4.compose(this.ceiling, V3.set(pos, 0, 5.4, 0), Q.setAxisAngle(rot, 1, 0, 0, Math.PI / 2), V3.set(scl, 26, 26, 1));

    // a soft pool of light on the floor: sells "this table is lit" without
    // a single shadow-map texel
    this.floorPool = M4.create();
    M4.compose(this.floorPool, V3.set(pos, 0, 0.004, 0),
      Q.setAxisAngle(rot, 1, 0, 0, -Math.PI / 2), V3.set(scl, 9.0, 7.2, 1));

    // one big soft pool of shade under the table: cleaner than any shadow
    // map and it never flickers
    this.tableShade = M4.create();
    M4.compose(this.tableShade, V3.set(pos, 0, 0.012, 0),
      Q.setAxisAngle(rot, 1, 0, 0, -Math.PI / 2), V3.set(scl, T.T_WID * 2.15, T.T_LEN * 1.5, 1));

    this._tmp = { pos: V3.new(), rot: Q.new(), scl: V3.new(1, 1, 1), m: M4.create(), m2: M4.create() };
    this._sm = M4.create(); this._sp = V3.new(); this._sq = Q.new(); this._ss = V3.new();
    this._shadowMat = { color: [0, 0, 0], tex: this.tex.shadow, unlit: true, emissive: [0, 0, 0], blend: true, doubleSided: true, rough: 1, opacity: 1 };
    this._shadowMat0 = { color: [0, 0, 0], tex: this.tex.shadow, unlit: true, emissive: [0, 0, 0], blend: true, doubleSided: true, rough: 1, opacity: 0.55 };
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

  /** Glossy smear on the table top — the cheap, stable stand-in for a planar
   *  reflection. A polished table does not mirror sharply: micro-roughness
   *  stretches every highlight along the view direction and fades it with
   *  height. Two quads do it: a tight bright core right under the object and
   *  a long dim tail towards the viewer. Costs nothing, can never spill off
   *  the table and never fights the depth buffer. */
  gloss(R, x, y, z, camX, camZ, radius, strength, col) {
    const TY = PH.T_H, HW = PH.T_HALF_WID, HL = PH.T_HALF_LEN;
    const h = y - TY;
    if (h < -0.03 || h > 1.05) return;
    if (Math.abs(x) > HW + 0.10 || Math.abs(z) > HL + 0.16) return;
    const hh = Math.max(0, h);
    let a = strength * Math.exp(-hh * 1.5);
    a *= clamp((HW + 0.03 - Math.abs(x)) / 0.13, 0, 1);     // soft rim cut
    a *= clamp((HL + 0.05 - Math.abs(z)) / 0.16, 0, 1);
    if (a < 0.012) return;

    // The mirror image slides towards the viewer along the horizontal view
    // direction, so the smear has to follow the camera azimuth — otherwise
    // it points the wrong way the moment the player orbits the hall.
    const vx = camX - x, vz = camZ - z;
    const vl = Math.hypot(vx, vz) || 1e-4;
    const ux = vx / vl, uz = vz / vl;
    const yaw = Math.atan2(ux, uz);
    const g = this.mat.gloss;
    const qx = this._sq, qy = this._sq2 || (this._sq2 = Q.new()), qr = this._sq3 || (this._sq3 = Q.new());
    Q.setAxisAngle(qy, 0, 1, 0, yaw);
    Q.setAxisAngle(qx, 1, 0, 0, -Math.PI / 2);
    Q.mul(qr, qy, qx);

    const put = (d, rx, rz, amt) => {
      const cx = x + ux * d, cz = z + uz * d;
      if (Math.abs(cx) > HW + rx || Math.abs(cz) > HL + rz) return;
      M4.compose(this._sm, V3.set(this._sp, cx, TY + 0.0022, cz), qr,
        V3.set(this._ss, rx, rz, 1));
      g.emissive[0] = col[0] * amt; g.emissive[1] = col[1] * amt; g.emissive[2] = col[2] * amt;
      R.draw(this.mesh.quad, this._sm, g);
    };
    const len = radius * (1 + hh * 9.0);
    put(0, radius * (1 + hh * 0.5), radius * (1 + hh * 0.8), a);     // core
    put(len * 0.85, radius * 0.9, len * 1.15, a * 0.40);             // tail
  }

  /* --------------------------- drawing ---------------------------- */
  /** the net is alpha-blended, so it must be drawn after every opaque
   *  object (including the ball) or it would be overwritten. */
  drawNet(R) { R.draw(this.mesh.net, this.M.net, this.mat.net); }

  drawStatic(R, shadowPass) {
    const d = shadowPass
      ? (mesh, mat4, mat) => R.drawShadow(mesh, mat4, mat && mat.alphaTest ? mat.tex : null, mat && mat.alphaTest)
      : (mesh, mat4, mat) => R.draw(mesh, mat4, mat);
    const M = this.M, me = this.mesh, ma = this.mat;
    d(me.tableTop, M.tableTop, ma.table);
    d(me.box, M.apronN, ma.apron); d(me.box, M.apronS, ma.apron);
    d(me.box, M.apronW, ma.apron); d(me.box, M.apronE, ma.apron);
    for (const l of this.legs) d(me.leg, l, ma.frame);
    for (const l of this.legBars) d(me.box, l, ma.frame);
    for (const p of this.netPosts) d(me.netPost, p, ma.post);
    if (!shadowPass) {
      d(me.floor, M.floor, ma.floor);
      R.draw(me.quad, this.floorPool, ma.pool);
      R.draw(me.quad, this.tableShade, this._shadowMat0);
      for (const w of this.walls) d(me.wall, w, ma.wall);
      for (const b of this.barriers) d(b.long ? me.bannerLong : me.bannerShort, b.m, ma.banner);
      for (const b of this.lightBodies) d(me.box, b, ma.lightBody);
      for (const l of this.lights) d(me.quad, l, ma.light);
      d(me.quad, this.ceiling, ma.ceiling);
    } else {
      d(me.net, M.net, ma.net);
    }
  }
}
