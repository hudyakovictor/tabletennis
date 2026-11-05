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
function arenaImageTex(R, dataUrl, w, h, cb, settled) {
  if (!dataUrl || typeof Image === 'undefined') { settled?.(false); return; }
  const img = new Image();
  let done = false;
  const finish = uploaded => {
    if (done) return;
    done = true; img.onload = img.onerror = null; settled?.(uploaded);
  };
  img.onload = () => {
    if (done) return;
    try {
      const c = cv(w, h);
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const tx = R.texFromCanvas(c, { wrap: 'repeat' });
      if (!tx || R.gl?.getError && R.gl.getError() !== 0) {
        if (tx) R.gl?.deleteTexture?.(tx);
        finish(false); return;
      }
      cb(tx); finish(true);
    } catch (e) { finish(false); /* Keep the existing procedural texture. */ }
  };
  img.onerror = () => finish(false);
  try { img.src = dataUrl; } catch (e) { finish(false); }
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

/* Menu-only exhibition. It owns neither the match clock nor the gameplay
 * paddles, and never calls the scoring, AI, telemetry or network pipeline. */
/* Камера «Арены» в меню. eye стоит на дуге радиуса distance с высотой
 * eyeBase + distance * eyeRise, а distance подбирается так, чтобы габарит
 * стола (и 0.8 м над ним) влез в рамку xMin..xMax / yMin..yMax.
 * 0.14/0.30 вместо 0.18/0.38 — вид ниже, почти с уровня сетки; рамка
 * 0.06..0.94 / 0.12..0.80 вместо 0.10..0.90 / 0.15..0.72 — стол крупнее,
 * то есть ближе. Формула высоты одна для подбора и живого кадра: иначе
 * _fitCamera считает по одному ракурсу, а рисуется другой. */
const LOBBY_CAM = Object.freeze({ eyeBase: 0.14, eyeRise: 0.30, xMin: 0.06, xMax: 0.94, yMin: 0.12, yMax: 0.80 });

class LobbyExhibition {
  constructor(game, post) {
    this.g = game; this.post = post;
    this.active = false; this.phase = 'off'; this.clock = 0; this.paused = false;
    this.requestId = null; this.readySent = false; this.handoff = false;
    this.rig = { eye: V3.new(), look: V3.new(0, 0.30, 0), fov: 52, shiftY: -0.08 };
    this._vp = { vp: M4.create(), view: M4.create(), proj: M4.create() };
    this._inverse = M4.create(); this._near = V3.new(); this._far = V3.new();
    this._right = V3.new(); this._edge = V3.new(); this._screen = {}; this._radiusScreen = {};
    this._m = M4.create(); this._p = V3.new(); this._q = Q.new(); this._s = V3.new();
    this._axisQ = Q.setAxisAngle(Q.new(), 1, 0, 0, Math.PI / 2);
    this._dir = V3.new(); this._up = V3.new(0, 1, 0); this._wrist = V3.new(); this._elbow = V3.new();
    this.bots = [1, -1].map(side => ({ side, x: 0, velocity: 0, hitAt: -Infinity,
      contact: V3.new(), stage: 'idle', pad: { pos: V3.new(), normal: V3.new(), q: Q.new() } }));
    const enamel = color => ({ color, rough: 0.38, metal: 0.18, rim: 0.25, rimCol: color, rimPower: 2.5 });
    this.mats = { suits: [enamel([0.12, 0.78, 0.75]), enamel([1, 0.40, 0.20])],
      shell: enamel([0.80, 0.86, 0.90]), joint: enamel([0.12, 0.17, 0.22]),
      visor: { color: [0.025, 0.045, 0.065], rough: 0.23, metal: 0.35 },
      eye: { color: [0.58, 1, 1], emissive: [0.30, 0.65, 0.72], rough: 0.8 } };
  }

  radius() {
    const c = this.g._cal;
    return PH.R * (c && c.ballSize !== undefined ? 0.8 + c.ballSize * 0.5 : 1);
  }

  prepare(options = {}) {
    const intro = options.intro === true;
    if (intro && !Number.isSafeInteger(options.requestId)) return false;
    // Hub repaints and retries of the same request are not a new entrance.
    if (this.active && (!intro || this.requestId === options.requestId)) return true;
    this.stop(); this.active = true; this.phase = intro ? 'waiting' : 'rally';
    this.requestId = intro ? options.requestId : null; this.readySent = false;
    this.clock = 0; this.elapsed = 0; this.hits = 0; this.firstHitAt = 0; this.paused = false;
    this.resumePending = false;
    this.handoff = !intro; this.framePending = false; this.hitPending = null;
    this.g._idleStill = false;
    this._clearBall();
    for (const bot of this.bots) { bot.x = 0; bot.velocity = 0; bot.hitAt = -Infinity; bot.stage = 'idle'; }
    this._fitCamera(); this.updateCamera();
    const left = this.g.project({ x: 0, y: 1, z: 2 }, {}).x;
    const right = this.g.project({ x: 0, y: 1, z: -2 }, {}).x;
    this.firstSide = left < right ? 1 : -1;
    if (!intro) {
      V3.set(this.g.ball.p, -0.24, PH.TABLE_Y + 0.34, this.firstSide * 1.58);
      this._contact(this.firstSide, false, 0);
    }
    this._poseBots(0);
    return true;
  }

  _clearBall() {
    const b = this.g.ball;
    b.live = false; b.lastHitBy = 0; b.trailGrade = null; b.golden = null;
    if (b.hist) b.hist.length = 0;
    if (b.histTimes) b.histTimes.length = 0;
    V3.set(b.p, 0.16, PH.TABLE_Y + this.radius(), 0.52);
    V3.zero(b.v); V3.zero(b.w); Q.identity(b.q);
  }

  stop() {
    if (!this.active) return;
    this.active = false; this.phase = 'off'; this.requestId = null;
    this.framePending = false; this.hitPending = null; this.cameraPrepared = false;
    this.flight = this.shot = null; this.g._idleStill = false;
    this._clearBall();
  }

  suspend() { this.resumePending = true; }

  _eyeY() { return LOBBY_CAM.eyeBase + this.distance * LOBBY_CAM.eyeRise; }

  _fitCamera() {
    const aspect = this.g.R.aspect(), rig = this.rig, p = this._p, C = LOBBY_CAM;
    this.distance = 3.2;
    // Fit the table and ball action; paddles may go out of frame.
    for (; this.distance < 9; this.distance += 0.25) {
      let fits = true;
      for (let i = 0; i < 12 && fits; i++) {
        const a = i * TAU / 12;
        V3.set(rig.eye, Math.sin(a) * this.distance, this._eyeY(), Math.cos(a) * this.distance);
        const vp = rigViewProj(rig, aspect, this._vp);
        for (const x of [-0.85, 0.85]) for (const z of [-1.40, 1.40]) for (const y of [0, 0.80]) {
          const s = projectPoint(vp, V3.set(p, x, y, z), this._screen);
          if (!s.ok || s.x < C.xMin || s.x > C.xMax || s.y < C.yMin || s.y > C.yMax) fits = false;
        }
      }
      if (fits) break;
    }
    this.aspect = aspect;
  }

  updateCamera() {
    if (!this.active || this.g.state !== GS.MENU) return;
    const g = this.g, rig = this.rig;
    if (this.phase !== 'flight' && Math.abs(g.R.aspect() - this.aspect) > 0.005) this._fitCamera();
    const orbit = this.phase === 'rally' ? Math.max(0, this.clock - this.firstHitAt) * 0.10 : 0;
    const a = 1.02 + orbit;
    V3.set(rig.eye, Math.sin(a) * this.distance, this._eyeY(), Math.cos(a) * this.distance);
    V3.copy(g.camPos, rig.eye); V3.copy(g.camLook, rig.look);
    V3.copy(g.camPosT, rig.eye); V3.copy(g.camLookT, rig.look);
    g.fov = g.fovT = rig.fov; g.camShiftY = rig.shiftY;
    V3.copy(g._liveRig.eye, rig.eye); V3.copy(g._liveRig.look, rig.look);
    g._liveRig.fov = rig.fov; g._liveRig.shiftY = rig.shiftY;
    g.R.setCamera(rig.eye, rig.look, this._up, rig.fov, 0.05, 60, rig.shiftY);
    g.camVP = rigViewProj(rig, g.R.aspect(), g._rigBuf); g.camVPReady = true;
    this.cameraPrepared = true;
  }

  launch(options) {
    if (!this.active || this.phase !== 'waiting' || !this.readySent || options.requestId !== this.requestId ||
        !Number.isSafeInteger(options.requestId) || !Number.isFinite(options.x) || !Number.isFinite(options.y) ||
        options.x < 0 || options.x > 1 || options.y < 0 || options.y > 1 ||
        !Number.isFinite(options.diameter) || options.diameter <= 0) return false;
    this.updateCamera();
    const g = this.g, vp = g.R.viewProj;
    if (!M4.invert(this._inverse, vp)) return false;
    // Solve clip-W from the projected camera-right radius, then invert the
    // exact renderer matrix. Do not clamp to the near plane: the sprite owns
    // the very large, initially clipped sphere until the <=12 CSS px handoff.
    const b = rigBasis(this.rig, {}), r = this.radius();
    V3.set(this._right, b.rx, b.ry, b.rz);
    const width = Math.abs(vp[0] * b.rx + vp[4] * b.ry + vp[8] * b.rz) * r;
    const depth = width / options.diameter;
    const ndc = V3.set(this._p, options.x * 2 - 1, 1 - options.y * 2, -1);
    M4.transformPoint(this._near, this._inverse, ndc);
    ndc.z = 1; M4.transformPoint(this._far, this._inverse, ndc);
    const cw = p => vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
    const nearW = cw(this._near), farW = cw(this._far);
    V3.lerp(g.ball.p, this._near, this._far, (depth - nearW) / (farW - nearW));
    this.phase = 'flight'; this.elapsed = 0; this.framePending = true; this.handoff = false;
    const side = this.firstSide, down = 0.25, up = 0.28, entry = 0.82;
    const end = V3.new(-0.24, PH.TABLE_Y + 0.34, side * 1.58);
    const bounce = V3.new(end.x - 0.16 * up, PH.TABLE_Y + r, side * 0.82);
    const after = V3.new(0.16, (end.y - bounce.y + PH.G * up * up / 2) / up, (end.z - bounce.z) / up);
    const before = V3.new(after.x, -after.y / 0.90 + PH.G * down, after.z);
    const approach = V3.new(bounce.x - before.x * down,
      bounce.y - before.y * down + PH.G * down * down / 2, bounce.z - before.z * down);
    const start = V3.clone(g.ball.p);
    this.flight = { side, entry, down, up, duration: entry + down + up, start, approach, bounce, end, before, after,
      tangent0: V3.mul(V3.new(), V3.sub(V3.new(), approach, start), 1.65), tangent1: V3.mul(V3.new(), before, entry) };
    this._sampleFlight(0);
    this.reduceMotion();
    this._poseBots(0);
    return true;
  }

  _arc(start, velocity, t) {
    V3.addScaled(this.g.ball.p, start, velocity, t); this.g.ball.p.y -= PH.G * t * t / 2;
    V3.copy(this.g.ball.v, velocity); this.g.ball.v.y -= PH.G * t;
  }

  _sampleFlight(t) {
    const f = this.flight;
    if (t < f.entry) {
      // A short Hermite rebound joins the real gravity arc with the same
      // position and velocity; its endpoints are world points, not a 2D fake.
      const u = t / f.entry, u2 = u * u, u3 = u2 * u;
      for (const axis of ['x', 'y', 'z']) {
        this.g.ball.p[axis] = (2 * u3 - 3 * u2 + 1) * f.start[axis] + (u3 - 2 * u2 + u) * f.tangent0[axis] +
          (-2 * u3 + 3 * u2) * f.approach[axis] + (u3 - u2) * f.tangent1[axis];
        this.g.ball.v[axis] = ((6 * u2 - 6 * u) * f.start[axis] + (3 * u2 - 4 * u + 1) * f.tangent0[axis] +
          (-6 * u2 + 6 * u) * f.approach[axis] + (3 * u2 - 2 * u) * f.tangent1[axis]) / f.entry;
      }
    } else if (t < f.entry + f.down) this._arc(f.approach, f.before, t - f.entry);
    else this._arc(f.bounce, f.after, Math.min(t - f.entry - f.down, f.up));
  }

  _contact(side, first, at) {
    const bot = this.bots.find(b => b.side === side);
    bot.hitAt = at; V3.copy(bot.contact, this.g.ball.p);
    this.g.ball.lastHitBy = side; this.hits++;
    if (first) {
      this.firstHitAt = at;
      if (!this.handoff) { this.handoff = true; this.framePending = true; }
      this.hitPending = { requestId: this.requestId, side, first: true };
    }
    this.phase = 'rally';
    const duration = 0.80 + Math.sin(this.hits * 1.7) * 0.045, down = duration * 0.7, up = duration - down;
    const start = V3.clone(this.g.ball.p), end = V3.new(Math.sin(this.hits * 1.79) * 0.43, 0, -side * 1.58);
    const before = V3.new((end.x - start.x) / duration,
      (PH.TABLE_Y + this.radius() - start.y + PH.G * down * down / 2) / down, (end.z - start.z) / duration);
    const bounce = V3.addScaled(V3.new(), start, before, down); bounce.y = PH.TABLE_Y + this.radius();
    const after = V3.new(before.x, -(before.y - PH.G * down) * 0.90, before.z);
    end.y = bounce.y + after.y * up - PH.G * up * up / 2;
    this.shot = { side: -side, start, end, bounce, before, after, down, up, duration };
  }

  reduceMotion() {
    if (!this.active || !this.g.reducedMotion || this.phase !== 'flight') return false;
    V3.copy(this.g.ball.p, this.flight.end); this.elapsed = 0;
    this._contact(this.firstSide, true, this.clock); this._poseBots(0);
    return true;
  }

  update(dt) {
    if (!this.active) return;
    if (this.g.state !== GS.MENU || this.g.preview?.active) { this.stop(); return; }
    if (this.paused || this.g._ttSleeping || typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.suspend(); return;
    }
    if (this.resumePending) { this.resumePending = false; return; }
    if (this.g.reducedMotion) {
      this.reduceMotion();
      return;
    }
    if (this.phase === 'waiting' || !Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1); this.clock += dt; this.elapsed += dt;
    if (this.phase === 'flight') {
      if (this.elapsed < this.flight.duration) this._sampleFlight(this.elapsed);
      else {
        this.elapsed -= this.flight.duration; V3.copy(this.g.ball.p, this.flight.end);
        this._contact(this.firstSide, true, this.clock - this.elapsed);
      }
    }
    if (this.phase === 'rally') {
      while (this.elapsed >= this.shot.duration) {
        this.elapsed -= this.shot.duration; V3.copy(this.g.ball.p, this.shot.end);
        this._contact(this.shot.side, false, this.clock - this.elapsed);
      }
      const s = this.shot;
      if (this.elapsed < s.down) this._arc(s.start, s.before, this.elapsed);
      else this._arc(s.bounce, s.after, this.elapsed - s.down);
    }
    Q.setAxisAngle(this.g.ball.q, 1, 0, 0, this.clock * 8);
    this._poseBots(dt);
  }

  _poseBots(dt) {
    const f = this.phase === 'flight' ? this.flight : this.shot;
    for (const bot of this.bots) {
      const incoming = this.phase !== 'waiting' && f?.side === bot.side;
      const target = incoming ? f.end : bot.contact;
      const oldX = bot.x;
      bot.x = expSmooth(bot.x, incoming ? target.x - 0.18 : bot.x * 0.7, 7, dt);
      bot.velocity = dt > 0 ? (bot.x - oldX) / dt : 0;
      const pad = bot.pad, side = bot.side, age = this.clock - bot.hitAt;
      const ready = V3.set(this._p, bot.x + 0.23, PH.TABLE_Y + 0.34, side * 1.70);
      V3.copy(pad.pos, ready); bot.stage = 'idle';
      const hitPose = contact => {
        V3.set(pad.normal, 0.08, 0.12, -side); V3.norm(pad.normal, pad.normal);
        V3.addScaled(pad.pos, contact, pad.normal, -(this.radius() + 0.009));
      };
      if (age >= 0 && age < 0.46) {
        hitPose(bot.contact); V3.copy(this._edge, pad.pos);
        V3.set(this._edge, this._edge.x - side * 0.16, this._edge.y + 0.16, this._edge.z - side * 0.22);
        if (age < 0.16) V3.lerp(pad.pos, pad.pos, this._edge, smoothstep(0, 0.16, age));
        else V3.lerp(pad.pos, this._edge, ready, smoothstep(0.16, 0.46, age));
        bot.stage = age < 0.045 ? 'contact' : 'recovery';
      } else if (incoming) {
        const eta = f.duration - this.elapsed;
        if (eta < 0.34) {
          hitPose(target); V3.copy(this._edge, pad.pos);
          V3.set(this._edge, this._edge.x + side * 0.22, this._edge.y - 0.12, this._edge.z + side * 0.26);
          if (eta > 0.12) V3.lerp(pad.pos, ready, this._edge, smoothstep(0, 0.22, 0.34 - eta));
          else V3.lerp(pad.pos, this._edge, pad.pos, smoothstep(0, 0.12, 0.12 - eta));
          bot.stage = eta < 0.035 ? 'contact' : 'windup';
        }
      }
      V3.set(pad.normal, 0.08, 0.12, -side); V3.norm(pad.normal, pad.normal);
      this.g.rig.paddleQuat(pad.q, pad.normal, 'right', 0, side * 0.28, true);
    }
  }

  beforeRender() {
    this.sendFrame = false;
    if (!this.active || this.phase === 'waiting' || this.requestId === null || this.handoff && !this.framePending) return;
    const g = this.g, s = g.project(g.ball.p, this._screen), b = rigBasis(this.rig, {});
    V3.set(this._right, b.rx, b.ry, b.rz);
    V3.addScaled(this._edge, g.ball.p, this._right, this.radius());
    const e = g.project(this._edge, this._radiusScreen);
    const rect = g.canvas.getBoundingClientRect(), width = rect.width || g.vw || 1, height = rect.height || g.vh || 1;
    if (!s.ok || !e.ok) return;
    this.frameX = s.x; this.frameY = s.y;
    this.frameDiameter = 2 * Math.hypot(e.x - s.x, (e.y - s.y) * height / width);
    if (this.frameDiameter * width <= 12) this.handoff = true;
    this.sendFrame = true;
  }

  afterRender() {
    if (!this.active || this.g.state !== GS.MENU || this.g._ttSleeping || this.g._ttContextLost ||
        this.g.R.gl?.isContextLost?.() ||
        typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const scene = this.g.scene;
    if (this.requestId !== null && !this.readySent && this.cameraPrepared &&
        scene.panoramaSettled && scene.asphaltSettled && scene.standsSettled) {
      this.readySent = true;
      this.post('lobbyReady', { requestId: this.requestId, reducedMotion: !!this.g.reducedMotion,
        textures: { panorama: scene.hasPanorama ? 'uploaded' : 'fallback',
          asphalt: scene.mat.courtGround.asphalt ? 'uploaded' : 'fallback' } });
    }
    if (this.sendFrame) {
      this.post('lobbyFrame', { requestId: this.requestId, x: this.frameX, y: this.frameY, diameter: this.frameDiameter,
        phase: this.phase === 'flight' ? 'flight' : 'rally', handoff: this.handoff,
        progress: this.phase === 'flight' ? clamp(this.elapsed / this.flight.duration, 0, 1) : 1 });
      this.framePending = false; this.sendFrame = false;
    }
    if (this.hitPending) { this.post('lobbyHit', this.hitPending); this.hitPending = null; }
  }

  _part(R, S, mesh, mat, shadow, x, y, z, sx, sy, sz, q) {
    M4.compose(this._m, V3.set(this._p, x, y, z), q || Q.identity(this._q), V3.set(this._s, sx, sy, sz));
    if (shadow) R.drawShadow(S.mesh[mesh], this._m, null, 0);
    else R.draw(S.mesh[mesh], this._m, mat);
  }

  _limb(R, S, a, b, radius, mat, shadow) {
    V3.sub(this._dir, b, a);
    const length = V3.len(this._dir);
    // The unit capsule is three units tall. Its Y axis follows the limb.
    Q.lookRotation(this._q, this._dir, Math.abs(this._dir.z) < 1e-4 ? { x: 0, y: 0, z: 1 } : this._up);
    Q.mul(this._q, this._q, this._axisQ);
    this._part(R, S, 'capsule', mat, shadow, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2,
      radius, length / 3, radius, this._q);
  }

  draw(shadow) {
    const g = this.g, R = g.R, S = g.scene, m = this.mats;
    if (this.handoff && this.phase !== 'waiting') {
      const bs = this.radius() / PH.R;
      this._part(R, S, 'ball', S.mat.ball, shadow, g.ball.p.x, g.ball.p.y, g.ball.p.z, bs, bs, bs, g.ball.q);
    }
     for (let i = 0; i < this.bots.length; i++) {
       const bot = this.bots[i];
       g.rig.draw(R, S, { ...bot.pad, hand: 'right', shadowPass: shadow,
         mats: g.paddleMats(S, i === 0 ? g.equip : g.aiEquip) });
     }
  }

   drawShadows() {
     const g = this.g, S = g.scene, b = g.ball;
     if (this.handoff && this.phase !== 'waiting' && Math.abs(b.p.x) < PH.T_HALF_WID && Math.abs(b.p.z) < PH.T_HALF_LEN)
       S.blob(g.R, b.p.x, b.p.y, b.p.z, PH.TABLE_Y, 0.085, 0.40, 1);
   }
}
