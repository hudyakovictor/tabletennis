/* =====================================================================
 *  GAME — the core loop, and nothing else.
 *
 *  serve (direction/spin chosen by the player)
 *    -> ball must bounce on our half and on theirs
 *    -> the opponent returns it
 *    -> the ball is white / green / red
 *    -> touch inside the zone and draw one of 8 lines
 *    -> the stroke is physics, the outcome is measured, the attempt is saved
 *    -> repeat. No menu, no career, no score.
 * ===================================================================== */
'use strict';

const LAB_UP3 = { x: 0, y: 1, z: 0 };

class LabGame {
  constructor(canvas, store, ui) {
    this.canvas = canvas;
    this.store = store;
    this.ui = ui;
    this.isTouch = (typeof matchMedia === 'function') && matchMedia('(hover:none) and (pointer:coarse)').matches;

    this.R = new Renderer(canvas, { quality: this.isTouch ? 'medium' : 'high' });
    this.scene = new Scene(this.R, 'arena');
    this.rig = new PaddleRig();
    this.audio = new AudioEngine();

    this.gesture = new LabGesture();
    this.store.startSession();

    this.time = 0;
    this.state = 'serve';
    this.stateT = 0;
    this.acc = 0;
    this.rally = 0;
    this.bestRally = 0;
    this.misses = 0;
    this.shotsMade = 0;
    this.counts = {};
    for (const s of LAB_SHOTS) this.counts[s.id] = { normal: 0, strong: 0, weak: 0, over: 0, table: 0 };

    this.ball = {
      p: { x: 0, y: 1.0, z: 1.6 }, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 },
      q: Q.new(), live: false, lastHitBy: 0, speed: 0, bouncedFar: false, bouncedNear: false,
    };
    this.serveFlight = null;
    this.shotResolved = null;
    this.netTouched = false;
    this.aiHit = false;
    this.pendingMiss = false;

    this.pad = {
      pos: { x: 0, y: 1.22, z: 1.66 }, target: { x: 0, y: 1.22, z: 1.66 },
      normal: { x: 0, y: 0.18, z: -1 }, swing: 0, visible: !this.isTouch, flash: 0,
    };
    this.aiPad = {
      pos: { x: 0, y: 0.94, z: -1.50 }, target: { x: 0, y: 0.94, z: -1.50 },
      normal: { x: 0, y: 0.16, z: 1 }, swing: 0,
    };
    this.pointer = { x: 0, y: 0, nx: 0.5, ny: 0.5, down: false, inside: false, lastActive: -9, type: 'mouse' };
    this.zonePx = 90;
    this.zone = 'idle';
    this.contact = null;
    this.debug = '';
    this.aiStep = 0;
    this.aiPlan = [
      { x: -0.48, z: 0.80, spin: 'TOP' },
      { x: 0.50, z: 0.94, spin: 'BACK' },
      { x: 0.02, z: 0.70, spin: 'FLAT' },
      { x: 0.56, z: 0.86, spin: 'SIDE_R' },
      { x: -0.54, z: 0.92, spin: 'TOP' },
      { x: 0.10, z: 1.02, spin: 'SIDE_L' },
      { x: -0.30, z: 0.74, spin: 'BACK' },
      { x: 0.34, z: 0.78, spin: 'FLAT' },
    ];

    this.ballMat = Object.assign({}, this.scene.mat.ball);
    this._proj = {};
    this._tmp = { p: { x: 0, y: 0, z: 0 } };

    this.bindPointer();
    this.resize();
    this.applyCamera();
    this.resetToServe();

    this._lastHud = 0;
    this._lastZone = null;
  }

  /* ----------------------------- geometry ------------------------- */
  resize() {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    this.w = w; this.h = h;
    this.R.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
    this.zonePx = labZonePx(w, h);
    this.applyCamera();
  }

  /** Eye/target for a given dolly, pitch and lens. Pure function. */
  rigAt(doll, pitchDeg, fov) {
    const p = pitchDeg * DEG;
    const look = { x: 0, y: LAB.camLook.y, z: LAB.camLook.z };
    return {
      eye: { x: 0, y: look.y + Math.sin(p) * doll, z: look.z + Math.cos(p) * doll },
      look, fov,
    };
  }

  viewProj(rig, out) {
    const aspect = this.R.aspect();
    const vf = lensFovDeg(rig.fov, aspect) * DEG;
    const proj = M4.perspective((out && out.proj) || M4.create(), vf, aspect, 0.05, 60);
    const view = M4.lookAt((out && out.view) || M4.create(), rig.eye, rig.look, LAB_UP3);
    return M4.mul((out && out.vp) || M4.create(), proj, view);
  }

  /** Screen bounds of the playing surface for one rig. */
  tableBounds(rig) {
    const vp = this.viewProj(rig, this._fitBuf || (this._fitBuf = {}));
    let left = 1, right = 0, top = 1, bottom = 0;
    const HW = PH.T_HALF_WID, HL = PH.T_HALF_LEN, Y = PH.TABLE_Y;
    for (const cx of [-HW, HW]) for (const cz of [-HL, HL]) {
      const p = { x: cx, y: Y, z: cz };
      const cw = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
      const sx = ((vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / cw) * 0.5 + 0.5;
      const sy = 0.5 - ((vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / cw) * 0.5;
      left = Math.min(left, sx); right = Math.max(right, sx);
      top = Math.min(top, sy); bottom = Math.max(bottom, sy);
    }
    return { left, right, top, bottom, width: right - left };
  }

  /**
   * The camera is FITTED to the surface and then moved by the single
   * setting. Without the fit a landscape screen puts the table in the
   * middle of a black hall and a portrait phone shrinks it to a stamp.
   */
  applyCamera() {
    const aspect = this.R.aspect();
    const portrait = aspect < 1;
    const pitch = portrait ? LAB.camPitchPortrait : LAB.camPitch;
    const wantW = portrait ? 1.02 : 0.90;
    const wantH = portrait ? 0.80 : 0.64;
    let lo = 1.2, hi = 12;
    for (let i = 0; i < 34; i++) {
      const d = Math.sqrt(lo * hi);
      const b = this.tableBounds(this.rigAt(d, pitch, LAB.camFov));
      if (b.width > wantW || (b.bottom - b.top) > wantH) lo = d; else hi = d;
    }
    let doll = Math.sqrt(lo * hi);
    const user = this.store.viewDistance(this.isTouch);
    doll *= user;
    const rig = this.rigAt(doll, pitch, LAB.camFov);
    const b = this.tableBounds(rig);
    /* Lens shift instead of a rotation: it drops the near edge onto the
     * authored line without changing the perspective of the fit. */
    const nearTarget = portrait ? 0.90 : 0.815;
    const shift = clamp(nearTarget - b.bottom, -0.55, 0.55);
    const top = b.top + shift;
    this.cam = rig;
    this.camShiftY = shift;
    this.camFitted = Math.max(0, top);
    this.R.setCamera(rig.eye, rig.look, LAB_UP3, rig.fov, 0.05, 60, shift);
    this.R.setLightFrustum({ x: 0, y: PH.TABLE_Y, z: 0 }, 6.0, 2.40, 0.5, 14);
    this.fovV = verticalFovDeg(rig.fov, aspect) * DEG;
    this.fovH = horizontalFovDeg(rig.fov, aspect) * DEG;
  }

  /** Screen (0..1, y down) -> the world point on the bat's plane. */
  pointerWorld(nx, ny, out) {
    const cam = this.cam;
    let fx = cam.look.x - cam.eye.x, fy = cam.look.y - cam.eye.y, fz = cam.look.z - cam.eye.z;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = -fz, rz = fx;                        // cross(fwd, up) with up = +y
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const ux = fy * rz - fz * 0;                  // cross(right, fwd)
    const uy = fz * rx - fx * rz;
    const uz = fx * 0 - fy * rx;
    const tx = Math.tan(this.fovH / 2) * (nx * 2 - 1);
    /* The lens shift (proj[9] = 2*shift) is part of the projection the
     * renderer uses, so the inverse map has to subtract it. */
    const ty = Math.tan(this.fovV / 2) * (1 - ny * 2 - 2 * (this.camShiftY || 0));
    let dx = fx + rx * tx + ux * ty;
    let dy = fy + 0 * tx + uy * ty;
    let dz = fz + rz * tx + uz * ty;
    const planeZ = 1.62;
    const t = (planeZ - cam.eye.z) / (Math.abs(dz) < 1e-5 ? -1e-5 : dz);
    const o = out || {};
    o.x = clamp(cam.eye.x + dx * t, -1.72, 1.72);
    o.y = clamp(cam.eye.y + dy * t, 0.55, 2.10);
    o.z = planeZ;
    return o;
  }

  project(p, out) {
    const m = this.R.viewProj;
    const o = out || {};
    const cw = m[3] * p.x + m[7] * p.y + m[11] * p.z + m[15];
    if (cw <= 1e-4) { o.ok = false; return o; }
    o.x = ((m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12]) / cw) * 0.5 + 0.5;
    o.y = 0.5 - ((m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13]) / cw) * 0.5;
    o.ok = true;
    return o;
  }

  ballScreen() { return this.project(this.ball.p, this._proj); }

  /* ------------------------------ input --------------------------- */
  bindPointer() {
    const c = this.canvas;
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      const nx = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      const ny = clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1);
      this.pointer.x = nx * this.w; this.pointer.y = ny * this.h;
      this.pointer.nx = nx; this.pointer.ny = ny;
    };
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.init(); this.audio.resume();
      c.setPointerCapture && c.setPointerCapture(e.pointerId);
      pos(e);
      this.pointer.down = true; this.pointer.type = e.pointerType || 'mouse';
      this.pointer.lastActive = this.time;
      this.gesture.down(this.pointer.x, this.pointer.y, performance.now() / 1000, e.pointerType);
      this.gesture.sx = this.pointer.nx; this.gesture.sy = this.pointer.ny;
      /* Sample the contact immediately: a fast flick can begin and end
       * inside one frame, and waiting for the next update() would throw the
       * contact away. */
      this.updateContactWindow();
      this.pad.visible = true;
      this.pad.flash = 0;
      this.updatePaddleTarget();
    }, { passive: false });

    c.addEventListener('pointermove', (e) => {
      pos(e);
      this.pointer.lastActive = this.time;
      if (this.pointer.down) this.gesture.move(this.pointer.x, this.pointer.y, performance.now() / 1000);
      this.updatePaddleTarget();
    }, { passive: true });

    const end = (e) => {
      if (!this.pointer.down) return;
      pos(e);
      this.pointer.down = false;
      this.pointer.lastActive = this.time;
      const g = this.gesture.up(this.pointer.x, this.pointer.y, performance.now() / 1000, Math.min(this.w, this.h));
      this.onGesture(g);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => {
      this.pointer.down = false;
      this.gesture.cancel();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 120));
  }

  updatePaddleTarget() {
    const w = this.pointerWorld(this.pointer.nx, this.pointer.ny, this._tmp.p);
    this.pad.target.x = w.x; this.pad.target.y = w.y; this.pad.target.z = 1.62;
  }

  /* --------------------------- gesture -> hit --------------------- */
  onGesture(g) {
    if (!g) return;
    /* Serving is the player's own action: any tap or swipe on the table
     * tosses the ball with the direction and spin chosen in the settings. */
    if (this.state === 'serve') { this.serveNow(true); return; }
    if (!g.ok) {                       // a tap: log it, it is calibration data
      this.miss('слишком коротко', g, this.distanceAt(this.gesture.sx, this.gesture.sy));
      return;
    }
    const shot = g.shot;
    const startNx = this.gesture.sx, startNy = this.gesture.sy;
    const dist = this.distanceAt(startNx, startNy);
    if (this.state !== 'rally' || !this.ball.live || this.ball.lastHitBy !== -1) {
      this.miss('нет мяча', g, dist);
      return;
    }
    const zoneNow = labBallZone(this.ball).zone;
    /* The contact may have been sampled while the finger was on the ball
     * (the normal case) or, for a flick that started and ended inside one
     * frame, only now — check the START point against the ball too. */
    const within = g.contact || this.contactAt(startNx, startNy);
    if (!within) {
      this.miss(zoneNow === 'late' ? 'поздно' : zoneNow === 'early' ? 'рано' : 'вне зоны', g, dist);
      return;
    }
    const stale = this.time - within.t > LAB.lateGraceSec && zoneNow !== 'ready';
    if (stale) { this.miss('поздно', g, within.score); return; }
    this.strike(g, shot, within);
  }

  /** Distance from a screen point (0..1) to the ball, in CSS px. */
  distanceAt(nx, ny) {
    const pr = this.ballScreen();
    if (!pr.ok) return Infinity;
    return Math.hypot((pr.x - nx) * this.w, (pr.y - ny) * this.h);
  }

  /** Distance from the current pointer to the ball, in CSS px. */
  zoneDistance() {
    this.lastZonePx = this.distanceAt(this.pointer.nx, this.pointer.ny);
    return this.lastZonePx;
  }

  contactAt(nx, ny) {
    const zone = labBallZone(this.ball).zone;
    if (zone !== 'ready') return null;
    const d = this.distanceAt(nx, ny);
    if (d > this.zonePx) return null;
    return { t: this.time, score: d, p: { x: this.ball.p.x, y: this.ball.p.y, z: this.ball.p.z } };
  }

  contactNow() {
    if (!this.gesture.active && !this.pointer.down) return null;
    return this.contactAt(this.pointer.nx, this.pointer.ny);
  }

  miss(reason, g, px) {
    this.misses++;
    this.lastShot = { miss: true, reason, shot: g && g.shotId, band: g && g.band, px };
    this.audio.ui('click');
    this.store.log({
      kind: 'miss', reason, shot: (g && g.shotId) || null, band: (g && g.band) || null,
      effort: g ? +(g.effort || 0).toFixed(3) : null,
      norm: g ? +(g.norm || 0).toFixed(3) : null,
      mm: g && Number.isFinite(g.mm) ? +g.mm.toFixed(1) : null,
      px: Number.isFinite(px) ? Math.round(px) : null,
      zonePx: Math.round(this.zonePx),
      zone: this.zone,
      rally: this.rally,
    });
    this.flashToast(reason === 'поздно' ? 'ПОЗДНО' : reason === 'рано' ? 'РАНО' : 'МИМО', '#ff8a95');
    this.ui && this.ui.syncCounters();
  }

  strike(g, shot, within) {
    /* Meet the ball where it will be on the strike plane, not wherever it
     * happened to be when the finger left the screen: the swipe takes
     * 100-250 ms, and during that time a 4 m/s ball travels most of a
     * metre. The contact point is the predicted intercept, which is the
     * point the player was actually aiming at. */
    const contact = (this.hitAt && this.hitAt.z > 0)
      ? { x: this.hitAt.x, y: this.hitAt.y, z: this.hitAt.z }
      : within.p;
    /* The launch starts from where the contact actually happened; if the
     * finger was released a moment later, the ball has moved on, so we keep
     * the contact point inside a small legal box instead of letting it sit
     * behind the player. */
    const from = {
      x: clamp(contact.x, -1.5, 1.5),
      y: clamp(contact.y, PH.TABLE_Y + 0.10, 2.05),
      z: clamp(contact.z, 0.72, 2.16),
    };
    const stroke = labBuildStroke(shot, g.effort, from);
    const b = this.ball;
    b.p.x = from.x; b.p.y = from.y; b.p.z = from.z;
    b.v.x = stroke.v.x; b.v.y = stroke.v.y; b.v.z = stroke.v.z;
    b.w.x = stroke.spin.x; b.w.y = stroke.spin.y; b.w.z = stroke.spin.z;
    b.live = true; b.lastHitBy = 1; b.speed = V3.len(b.v);
    b.bouncedFar = false; b.bouncedNear = false;
    this.serveFlight = null;
    this.shotResolved = null;
    this.netTouched = false;
    this.aiHit = false;
    this.pendingMiss = false;
    this.crossT = null;
    this.hitAt = null;

    this.rally++;
    this.bestRally = Math.max(this.bestRally, this.rally);
    this.shotsMade++;
    this.actionT = this.time;

    const c = this.counts[shot.id];
    c[stroke.band] = (c[stroke.band] || 0) + 1;
    this.lastShot = {
      shot: shot.id, ru: shot.ru, band: stroke.band, effort: g.effort,
      speedKmh: b.speed * 3.6, norm: g.norm, mm: g.mm, dev: g.deviationDeg,
      straight: g.straightness, elev: stroke.elevDeg, px: within.score,
      from: { ...from }, target: stroke.target, solved: stroke.solved,
      contactLag: Math.max(0, this.time - within.t),
      rally: this.rally, at: Date.now(),
    };
    this.currentShot = this.lastShot;

    this.pad.pos.x = from.x; this.pad.pos.y = from.y; this.pad.pos.z = from.z;
    this.pad.flash = 0.20;
    this.pad.swing = 1;

    this.audio.hitRacket(V3.len(b.v), brushOf(stroke.spin), stroke.band === 'weak');
    this.ui && this.ui.onStrike(shot.id, stroke.band);
    this.ui && this.ui.syncCounters();
  }

  /* --------------------------- loop / physics --------------------- */
  resetToServe() {
    this.state = 'serve';
    this.stateT = this.time;
    this.rally = 0;
    const hand = LAB.serveHand;
    this.ball.live = false;
    this.ball.p.x = hand.x; this.ball.p.y = hand.y; this.ball.p.z = hand.z;
    this.ball.v.x = this.ball.v.y = this.ball.v.z = 0;
    this.ball.w.x = this.ball.w.y = this.ball.w.z = 0;
    this.ball.lastHitBy = 0;
    this.ball.bouncedFar = false; this.ball.bouncedNear = false;
    this.shotResolved = null;
    this.resolveT = 0;
    this.netTouched = false;
    this.serveFlight = null;
    this.contact = null;
    this.actionT = this.time;
    this.crossT = null; this.hitAt = null;
    this.ui && this.ui.syncAll();
  }

  serveNow(manual) {
    if (this.state !== 'serve') return;
    const dir = this.store.settings.serveDir;
    const spinKind = this.store.settings.serveSpin;
    const sol = labSolveServe(dir, spinKind);
    if (!sol) return;
    const b = this.ball;
    b.live = true;
    b.v.x = sol.v.x; b.v.y = sol.v.y; b.v.z = sol.v.z;
    const st = spinKind === 'TOP' ? 120 : spinKind === 'BACK' ? -110 : spinKind === 'SIDE' ? 0 : 0;
    const ss = spinKind === 'SIDE' ? (dir === 'RIGHT' ? -130 : dir === 'LEFT' ? 130 : -130) : 0;
    b.w.x = -st; b.w.y = -ss; b.w.z = 0;
    b.lastHitBy = 1;
    b.bouncedFar = false; b.bouncedNear = false;
    this.serveFlight = { bounces: 0, dir, spin: spinKind, logged: false };
    this.currentShot = null;
    this.crossT = null; this.hitAt = null;
    this.shotResolved = null;
    this.netTouched = false;
    this.aiHit = false;
    this.rally = 0;
    this.state = 'rally';
    this.stateT = this.time;
    this.actionT = this.time;
    this.audio.hitRacket(V3.len(b.v), 0.35, false);
    this.flashToast(`ПОДАЧА · ${dirRu(dir)} · ${serveRu(spinKind)}`, '#9fd8ff');
    this.ui && this.ui.syncAll();
    if (manual) this.ui && this.ui.blip();
  }

  update(dtReal) {
    const dt = Math.min(0.05, Math.max(0, dtReal));
    this.time += dt;


    if (this.ball.live) {
      this.acc += dt;
      let guard = 0;
      while (this.acc >= PH.SIM_DT && guard++ < 40) {
        this.stepBall(PH.SIM_DT);
        this.acc -= PH.SIM_DT;
      }
      if (guard >= 40) this.acc = 0;
    }

    this.updateContactWindow();
    this.maybeAiReturn();
    this.checkMissedBall();
    this.updatePads(dt);

    if (this.state === 'dead' && this.time - this.stateT > LAB.deadDelay) this.resetToServe();
    /* The watchdog is about a STUCK ball, so it runs from the last hit, not
     * from the serve: a long rally is not a stuck ball. */
    if (this.state === 'rally' && this.time - (this.actionT || this.stateT) > LAB.watchdogSec) {
      this.endRally('watchdog');
    }
    /* A stroke that already missed (net, short, long) is over: do not let
     * the ball dribble around for seconds until the watchdog fires. */
    if (this.state === 'rally' && this.shotResolved && this.shotResolved !== 'table' &&
      this.time - (this.resolveT || 0) > LAB.deadDelay) this.endRally('dead');
    if (this.state === 'rally' && this.ball.live && this.ball.p.z > 3.2 && this.ball.v.z > 0) this.endRally('missed');

    const now = performance.now();
    if (now - this._lastHud > 90) { this._lastHud = now; this.ui && this.ui.syncLive(this); }
    this.ui && this.ui.tick(dt, this);
  }

  stepBall(dt) {
    const before = this.ball.p.z;
    const evs = labStepBall(this.ball, dt);
    if (this.crossT !== null && this.ball.p.z < before - 1e-6) { this.crossT = null; this.hitAt = null; }
    for (const ev of evs) this.onBallEvent(ev);
  }

  onBallEvent(ev) {
    const b = this.ball;
    if (ev.type === 'table') {
      this.audio.hitTable(Math.abs(ev.speedIn), ev.x);
      if (ev.edge > 0.3) this.flashToast('РЕБРО СТОЛА', '#ffd24d');
      if (b.lastHitBy === 1) {
        if (this.serveFlight) {
          /* A serve is not a stroke: it is judged by the ITTF sequence
           * (own half first, then the opponent's) and recorded on its own
           * line so the stroke counters stay about strokes. */
          this.serveFlight.bounces++;
          if (this.serveFlight.bounces === 1 && ev.side !== 1) this.logServe('fault_own');
          if (this.serveFlight.bounces === 2) {
            this.logServe(ev.side === -1 ? 'legal' : 'short');
            if (ev.side === -1) b.bouncedFar = true;
          }
        } else if (ev.side === -1) {
          if (!this.shotResolved) this.resolveShot('table', ev);
          b.bouncedFar = true;
        } else if (!this.shotResolved) {
          this.resolveShot(this.netTouched ? 'net' : 'short', ev);
        }
      } else if (b.lastHitBy === -1) {
        if (ev.side === 1) b.bouncedNear = true;
        else if (!this.pendingMiss) this.endRally('ai_fault');
      }
    } else if (ev.type === 'net') {
      this.audio.hitNet();
      this.netTouched = true;
      if (this.serveFlight && this.serveFlight.bounces < 1) this.logServe('net');
    } else if (ev.type === 'floor') {
      this.audio.hitFloor(4);
      if (b.lastHitBy === 1 && !this.shotResolved) {
        this.resolveShot(this.netTouched ? 'net'
          : (b.p.z < -PH.T_HALF_LEN || Math.abs(b.p.x) > PH.T_HALF_WID) ? 'out' : 'short', { x: b.p.x, z: b.p.z });
      }
      b.live = false;
      if (this.state === 'rally') this.endRally(b.lastHitBy === -1 ? 'missed' : 'dead');
    } else if (ev.type === 'out') {
      if (b.lastHitBy === 1 && !this.shotResolved) this.resolveShot('out', { x: b.p.x, z: b.p.z });
      this.endRally('out');
    }
  }

  /** Serves are logged for calibration but never touch the stroke counters. */
  logServe(outcome) {
    const f = this.serveFlight;
    if (!f || f.logged) return;
    f.logged = true;
    f.outcome = outcome;
    this.store.log({ kind: 'serve', dir: f.dir, spin: f.spin, outcome,
      bounces: f.bounces, rally: 0 });
    /* A legal serve needs no toast: the rally simply continues. Only the
     * mistakes are worth a word, because those are the ones being debugged. */
    if (outcome !== 'legal') {
      this.flashToast(outcome === 'short' ? 'ПОДАЧА · КОРОТКО' : outcome === 'net'
        ? 'ПОДАЧА · СЕТКА' : 'ПОДАЧА · ОШИБКА', '#ffd24d');
    }
  }

  resolveShot(outcome, where) {
    if (this.shotResolved) return;
    this.shotResolved = outcome;
    this.resolveT = this.time;
    const s = this.currentShot;
    if (!s) return;
    s.outcome = outcome;
    s.landing = where && Number.isFinite(where.x) ? { x: +where.x.toFixed(3), z: +where.z.toFixed(3) } : null;
    if (outcome === 'table') this.counts[s.shot].table++;
    this.store.log({
      kind: 'shot', shot: s.shot, band: s.band, outcome,
      effort: +(s.effort || 0).toFixed(3), norm: +(s.norm || 0).toFixed(3),
      mm: Number.isFinite(s.mm) ? +s.mm.toFixed(1) : null,
      px: Math.round(s.px || 0), zonePx: Math.round(this.zonePx),
      speedKmh: +(s.speedKmh || 0).toFixed(1), elevDeg: +(s.elev || 0).toFixed(1),
      deviationDeg: +(s.dev || 0).toFixed(1), straight: +(s.straight || 0).toFixed(2),
      contactLagMs: Math.round((s.contactLag || 0) * 1000),
      landing: s.landing, rally: s.rally, solved: s.solved,
    });
    this.ui && this.ui.syncCounters();
  }

  endRally(reason) {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.stateT = this.time;
    this.ball.live = false;
    this.bestRally = Math.max(this.bestRally, this.rally);
    this.ui && this.ui.syncAll();
    if (reason === 'missed') this.flashToast('МЯЧ ПРОПУЩЕН', '#ff8a95');
    else if (reason === 'out' && this.shotResolved === 'out') this.flashToast('МИМО СТОЛА', '#ffd24d');
  }

  checkMissedBall() {
    if (this.state !== 'rally' || !this.ball.live) return;
    if (this.ball.lastHitBy !== -1) return;
    if (this.ball.p.z > 2.55 && this.ball.v.z > 0) { this.endRally('missed'); return; }
    if (this.ball.p.y < PH.TABLE_Y - 0.12 && this.ball.p.z > 0.5) this.endRally('missed');
  }

  /* --------------------------- opponent ball --------------------- */
  maybeAiReturn() {
    const b = this.ball;
    if (this.state !== 'rally' || !b.live || b.lastHitBy !== 1 || this.aiHit) return;
    if (b.v.z >= -0.4) return;
    if (!(b.bouncedFar || b.p.z < -1.24)) return;
    if (b.p.z < -2.5) return;
    if (b.p.y < PH.TABLE_Y - 0.05) return;      // below the table: no return
    this.aiHit = true;
    const from = {
      x: clamp(b.p.x, -0.72, 0.72),
      y: clamp(b.p.y, PH.TABLE_Y + 0.14, 1.46),
      z: clamp(b.p.z, -1.42, -0.92),
    };
    const plan = this.aiPlan[this.aiStep++ % this.aiPlan.length];
    const target = { x: plan.x, z: plan.z };
    const spin = labAiSpin(plan.spin);
    const speeds = [4.2, 4.9, 5.6, 6.3];
    const sol = labSolveFrom(from, target, spin, speeds);
    if (!sol) return;
    b.p.x = from.x; b.p.y = from.y; b.p.z = from.z;
    b.v.x = sol.v.x; b.v.y = sol.v.y; b.v.z = sol.v.z;
    b.w.x = spin.x; b.w.y = spin.y; b.w.z = spin.z;
    b.lastHitBy = -1; b.bouncedNear = false; b.bouncedFar = false;
    this.crossT = null; this.hitAt = null;
    this.actionT = this.time;
    this.aiPad.pos.x = from.x; this.aiPad.pos.y = from.y; this.aiPad.pos.z = from.z;
    this.aiPad.swing = 1;
    this.audio.hitRacket(V3.len(b.v), brushOf(spin), false);
  }

  /* --------------------------- contact window -------------------- */
  /**
   * Signed time to the strike plane. The crossing of the plane is recorded
   * once per flight and the sign comes from it, so a ball that has already
   * gone past can never be reported as "arriving in 8 ms".
   */
  refreshHitTime() {
    const b = this.ball;
    if (!b.live || b.lastHitBy !== -1) { this.hitAt = null; this.hitT = null; return; }
    if (this.crossT === null && b.p.z >= LAB.strikeZ && b.v.z > 0) this.crossT = this.time;
    if (this.crossT !== null) {
      this.hitT = this.crossT - this.time;
      if (!this.hitAt) {
        const r = labTimeToPlane(b, LAB.strikeZ);
        this.hitAt = r.at || { x: b.p.x, y: b.p.y, z: b.p.z };
      }
      return;
    }
    const now = this.time;
    if (now - (this._hitCalcAt || -9) < 0.04 && this.hitAt) return;
    this._hitCalcAt = now;
    const r = labTimeToPlane(b, LAB.strikeZ);
    this.hitT = r.t;
    this.hitAt = r.at;
  }

  updateContactWindow() {
    this.refreshHitTime();
    const z = labBallZone(this.ball, this.hitT);
    this.zone = z.zone;
    this.contact = null;
    if (!this.gesture.active || !this.pointer.down) return;
    if (this.ball.lastHitBy !== -1) return;
    const c = this.contactAt(this.pointer.nx, this.pointer.ny);
    if (!c) return;
    this.contact = c;
    this.gesture.noteContact(c);
  }

  /* ------------------------------ pads --------------------------- */
  updatePads(dt) {
    const p = this.pad;
    const k = 1 - Math.exp(-(p.flash > 0 ? 34 : 16) * dt);
    if (p.flash > 0) {
      p.flash -= dt;
      if (p.flash <= 0) p.flash = 0;
    }
    // while the ball is close, the blade leans toward it so the contact reads
    const b = this.ball;
    const target = p.flash > 0 ? b.p : p.target;
    p.pos.x += (target.x - p.pos.x) * k;
    p.pos.y += (target.y - p.pos.y) * k;
    p.pos.z += (target.z - p.pos.z) * k;
    p.swing = Math.max(0, p.swing - dt * 5);
    const aimX = (this.pointer.nx - 0.5) * 0.8;
    p.normal.x = -aimX * 0.45;
    p.normal.y = 0.16;
    p.normal.z = -1;
    if (this.isTouch) p.visible = this.pointer.down || this.time - this.pointer.lastActive < 0.75;
    else p.visible = true;

    const a = this.aiPad;
    a.pos.x += (a.target.x - a.pos.x) * (1 - Math.exp(-7 * dt));
    a.pos.y += (a.target.y - a.pos.y) * (1 - Math.exp(-7 * dt));
    a.pos.z += (a.target.z - a.pos.z) * (1 - Math.exp(-7 * dt));
    a.swing = Math.max(0, a.swing - dt * 4);
    // the opponent drifts toward the incoming ball
    if (this.ball.live && this.ball.p.z < 0) {
      a.target.x = clamp(this.ball.p.x * 0.85, -0.62, 0.62);
      a.target.y = clamp(this.ball.p.y + 0.06, 0.83, 1.34);
    } else {
      a.target.x = 0; a.target.y = 0.94; a.target.z = -1.50;
    }
  }

  /* ------------------------------ render -------------------------- */
  setBallColor() {
    const zone = labBallZone(this.ball).zone;
    const m = this.ballMat;
    if (this.ball.lastHitBy === -1 && this.ball.live) {
      if (zone === 'ready') {
        m.color = [LAB.colorReady[0], LAB.colorReady[1], LAB.colorReady[2]];
        m.emissive = [0.10, 0.52, 0.16];
        m.rimCol = [0.6, 1.0, 0.6];
      } else if (zone === 'late') {
        m.color = [LAB.colorLate[0], LAB.colorLate[1], LAB.colorLate[2]];
        m.emissive = [0.45, 0.06, 0.07];
        m.rimCol = [1.0, 0.5, 0.5];
      } else {
        m.color = [1, 1, 1];
        m.emissive = [0.34, 0.335, 0.29];
        m.rimCol = [1.0, 0.97, 0.88];
      }
    } else {
      m.color = [1, 1, 1];
      m.emissive = [0.34, 0.335, 0.29];
      m.rimCol = [1.0, 0.97, 0.88];
    }
  }

  drawDynamic(shadowPass) {
    const R = this.R, S = this.scene, me = S.mesh;
    this.setBallColor();
    const b = this.ball;
    if (b.live || this.state === 'serve') {
      const bs = this.isTouch ? LAB.ballScale * 1.5 : LAB.ballScale;
      M4.compose(S._tmp.m, b.p, b.q, V3.set(S._tmp.scl, bs, bs, bs));
      if (shadowPass) R.drawShadow(me.ball, S._tmp.m, null, 0);
      else R.draw(me.ball, S._tmp.m, this.ballMat);
    }
    if (this.pad.visible) {
      this.rig.draw(R, S, {
        pos: this.pad.pos, normal: this.pad.normal, hand: 'right',
        shadowPass, swing: this.pad.swing, roll: 0,
        scale: this.isTouch ? LAB.padScale * 1.35 : LAB.padScale,
      });
    }
    this.rig.draw(R, S, {
      pos: this.aiPad.pos, normal: this.aiPad.normal, hand: 'left',
      shadowPass, swing: -this.aiPad.swing, roll: 0,
    });
  }

  drawContactShadows() {
    const S = this.scene, b = this.ball;
    if (!b.live && this.state !== 'serve') return;
    const overTable = Math.abs(b.p.x) < PH.T_HALF_WID + 0.12 && Math.abs(b.p.z) < PH.T_HALF_LEN + 0.14;
    S.blob(this.R, b.p.x, b.p.y, b.p.z, overTable ? PH.TABLE_Y : 0, 0.055, 0.95, 1);
    S.blob(this.R, this.pad.pos.x, this.pad.pos.y, this.pad.pos.z,
      overTable ? PH.TABLE_Y : 0, 0.10, this.pad.visible ? 0.42 : 0, 1);
    S.blob(this.R, this.aiPad.pos.x, this.aiPad.pos.y, this.aiPad.pos.z,
      PH.TABLE_Y, 0.10, 0.36, 1);
  }

  drawReflections() {
    const S = this.scene, b = this.ball;
    if (b.live || this.state === 'serve') {
      S.gloss(this.R, b.p.x, b.p.y, b.p.z, this.cam.eye.x, this.cam.eye.z, 0.055, 1.5, [1, 0.98, 0.9]);
    }
  }

  render() {
    const R = this.R;
    if (R.beginShadow()) {
      this.scene.drawStatic(R, true);
      this.drawDynamic(true);
    }
    R.beginScene([0.014, 0.019, 0.030]);
    this.scene.drawStatic(R, false);
    this.drawContactShadows();
    this.drawReflections();
    this.drawDynamic(false);
    this.scene.drawNet(R);
    R.present(this.time);
  }

  /* ------------------------------ helpers ------------------------ */
  flashToast(text, color) {
    this.toast = { text, color: color || '#fff', t: this.time };
    this.ui && this.ui.toast(text, color);
  }

  setDistance(v) {
    this.store.setViewDistance(this.isTouch, v);
    this.applyCamera();
    this.updatePaddleTarget();
  }

  toggleSound() {
    this.store.settings.sound = !this.store.settings.sound;
    this.store.saveSettings();
    this.audio.setMuted(!this.store.settings.sound);
    if (this.store.settings.sound) { this.audio.init(); this.audio.resume(); }
  }
}

function brushOf(spin) {
  return clamp(Math.hypot(spin.x, spin.y) / 420, 0, 1);
}
function dirRu(d) { return d === 'LEFT' ? 'ВЛЕВО' : d === 'RIGHT' ? 'ВПРАВО' : 'ПО ЦЕНТРУ'; }
function serveRu(s) { return s === 'TOP' ? 'ТОПСПИН' : s === 'BACK' ? 'ПОДРЕЗКА' : s === 'SIDE' ? 'БОКОВАЯ' : 'ПЛОСКАЯ'; }
