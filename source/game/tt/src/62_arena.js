/* =====================================================================
 *  ARENA DRESSING — a calibrated street panorama and its 3D court.
 *  Assets are embedded by tt/build.py; if the image is unavailable the
 *  procedural hall below keeps the game playable offline.
 * ===================================================================== */

/* Процедурные трибуны: тёмный зал и тысячи тусклых голов-точек,
 * без светильников и прожекторных лучей. Рисуется один раз в канвас 2048×256 —
 * того же размера, что и фото-текстура, чтобы свап был бесшовным. */
function texStandsFallback() {
  const W = 2048, H = 256, c = cv(W, H), g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0.00, '#04060a');
  lg.addColorStop(0.30, '#070b13');
  lg.addColorStop(0.75, '#0a1220');
  lg.addColorStop(1.00, '#05070c');
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  // толпа: тусклые точки-головы, плотнее к низу; верх темнее низа
  for (let i = 0; i < 24000; i++) {
    const y = H * 0.16 + Math.pow(Math.random(), 0.8) * H * 0.84;
    const fade = 0.35 + 0.65 * (y / H);
    const v = (6 + Math.random() * 26) * fade;
    g.fillStyle = `rgba(${v * 1.1 | 0},${v * 1.25 | 0},${v * 1.7 | 0},${0.5 + Math.random() * 0.5})`;
    g.fillRect(Math.random() * W, y, 1.6, 1.3);
  }
  return c;
}

/* Фото → текстура того же размера, что фолбэк: рисуем картинку в
 * канвас и отдаём в общий texFromCanvas (mips/aniso — как у всех). */
function arenaImageTex(R, dataUrl, w, h, cb) {
  if (!dataUrl || typeof Image === 'undefined') return;
  const img = new Image();
  img.onload = () => {
    try {
      const c = cv(w, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(R.texFromCanvas(c, { wrap: 'repeat' }));
    } catch (e) { /* фолбэк остаётся — арена не голая */ }
  };
  img.src = dataUrl;
}

/*
 * The supplied street panorama was made at the NEAR EDGE of the court, not
 * at the circle in the middle. A skybox centred on the moving camera cannot
 * put its markings under the table: they slide whenever the camera moves.
 *
 * Reconstruct a small 2.5D environment instead. Rays from the panorama's
 * original eye intersect a real ground plane; at the photographed ground /
 * wall boundary they continue up fixed walls and a curved sky. The table and
 * the orbit both use world (0, 0, 0), at the centre of the court marking.
 * The panorama is a single image, so the depth of buildings is an
 * approximation, but the floor, table feet and shadows now share one plane.
 *
 * The silhouette was measured from assets/street-court.jpg (2048 x 1024).
 * x is a fraction of the 360° image; y is the ground/wall boundary in a
 * 1024 x 512 view. Keep these together if the photograph is replaced.
 */
const STREET_COURT = Object.freeze({
  eyeHeight: 1.20,
  eyeZ: 5.60,               // original camera relative to the court centre
  wallHeight: 8.0,
  roofRise: 7.0,
  columns: 192,
  floorRows: 32,
  wallRows: 24,
  roofRows: 24,
  edge: Object.freeze([
    [0, 350], [64, 340], [128, 325], [160, 312], [192, 300],
    [224, 290], [256, 283], [320, 275], [384, 272], [448, 270],
    [512, 269], [576, 270], [640, 272], [704, 275], [768, 283],
    [800, 290], [832, 300], [864, 312], [896, 325], [960, 340], [1024, 350],
  ]),
});

/** Distance from the original panorama eye to the ground/wall boundary. */
function streetCourtEdgeRadius(u, config = STREET_COURT) {
  const x = clamp(u, 0, 1) * 1024, edge = config.edge;
  let i = 1;
  while (i < edge.length - 1 && x > edge[i][0]) i++;
  const a = edge[i - 1], b = edge[i];
  const y = lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
  return config.eyeHeight / Math.tan((y / 512 - 0.5) * Math.PI);
}

/** Texture location of a point on the real court, useful for calibration. */
function streetCourtGroundUV(x, z, config = STREET_COURT) {
  const dx = x, dz = z - config.eyeZ, r = Math.hypot(dx, dz);
  return {
    u: 0.5 + Math.atan2(dx, -dz) / TAU,
    v: 0.5 - Math.atan2(config.eyeHeight, r) / Math.PI,
  };
}

/** A polar grid keeps the 360° texture seam at the back, never across a quad.
 *  Nonlinear radial spacing retains detail close to the original eye. */
function makeStreetCourtFloor(config = STREET_COURT) {
  const n = config.columns, rows = config.floorRows;
  const g = geoAlloc((n + 1) * (rows + 1), n * rows * 6);
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    for (let i = 0; i <= n; i++) {
      const u = i / n, theta = (u - 0.5) * TAU;
      const r = streetCourtEdgeRadius(u, config) * t * t;
      geoPush(g, Math.sin(theta) * r, 0, config.eyeZ - Math.cos(theta) * r,
        0, 1, 0, u, 0.5 - Math.atan2(config.eyeHeight, r) / Math.PI);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + n + 1;
    geoQuad(g, a, b, b + 1, a + 1);
  }
  return g;
}

/** Walls and sky are fixed in world space, not attached to the camera. The
 *  first row has exactly the same positions and UVs as the floor's edge. */
function makeStreetCourtShell(config = STREET_COURT) {
  const n = config.columns, rows = config.wallRows + config.roofRows;
  const g = geoAlloc((n + 1) * (rows + 1), n * rows * 6);
  for (let j = 0; j <= rows; j++) {
    const roof = j > config.wallRows;
    const angle = roof ? (j - config.wallRows) / config.roofRows * Math.PI / 2 : 0;
    for (let i = 0; i <= n; i++) {
      const u = i / n, theta = (u - 0.5) * TAU;
      const edgeRadius = streetCourtEdgeRadius(u, config);
      const r = edgeRadius * Math.cos(angle);
      const y = roof ? config.wallHeight + config.roofRise * Math.sin(angle)
        : config.wallHeight * j / config.wallRows;
      geoPush(g, Math.sin(theta) * r, y, config.eyeZ - Math.cos(theta) * r,
        -Math.sin(theta), 0, Math.cos(theta), u,
        0.5 + Math.atan2(y - config.eyeHeight, r) / Math.PI);
    }
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + n + 1;
    geoQuad(g, a, a + 1, b + 1, b);
  }
  return g;
}

/** Painted centre circle, on the same plane as the table feet. Its radius is
 * calibrated against the near/far edges of the circle in the photograph. */
function makeStreetCourtMarking(radius = 4.7, width = 0.085, segments = 160) {
  const g = geoAlloc((segments + 1) * 2, segments * 6);
  for (let i = 0; i <= segments; i++) {
    const theta = i / segments * TAU, s = Math.sin(theta), c = Math.cos(theta);
    // A small lift avoids z-fighting with the floor on 16-bit depth buffers.
    for (const r of [radius - width / 2, radius + width / 2])
      geoPush(g, s * r, 0.025, c * r, 0, 1, 0, 0, 0);
  }
  for (let i = 0; i < segments; i++) geoQuad(g, i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  return g;
}
