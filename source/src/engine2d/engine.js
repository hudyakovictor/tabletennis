/* =====================================================================
   ENGINE — настольный теннис в псевдо-3D на canvas 2D.
   Мир в метрах: x — ширина (±0.7625), y — длина (0 у игрока … 2.74),
   z — высота над столом. Камера с наклоном/рысканьем, проекция руками.
   mode 'demo' — ИИ против ИИ (живой фон хаба), 'play' — игрок пальцем.
   ===================================================================== */
const TT = (() => {
  const L = 2.74, HW = .7625, NY = L / 2, NET_H = .1525, G = 9.8, BR = .02, VIS_BR = .046;
  const PY = -.3, OY = L + .3; // плоскости ударов
  const FLOOR = -.76;

  class Game {
    constructor(canvas, opt = {}) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.mode = opt.mode || 'demo';
      this.lobby = this.mode === 'demo' && opt.lobby === true;
      this.cam = Object.assign(this.lobby
        ? { y: -3.2, z: 1.8, pitch: 28, f: 1, cy: .5, yaw: -40, sway: 0 }
        : { y: -1.05, z: 1.75, pitch: 36, f: 1.02, cy: .43, yaw: 0, sway: 0 }, opt.cam || {});
      this.on = opt.on || (() => {});
      this.spd = opt.spd || .42; this.timeScale = 1; this.slowUntil = 0;
      this.diff = opt.diff || .6;
      this.colP = opt.colP || '#FF4B3E'; this.colO = opt.colO || '#2EC9FF';
      this.ball = { x: 0, y: .3, z: .3, vx: 0, vy: 0, vz: 0, live: false, by: 'p', bounced: null, net: false };
      this.trail = []; this.marks = []; this.sparks = [];
      this.pp = { x: 0, z: .22, vx: 0, ang: 0, tx: 0, tz: .22, flash: 0 }; // paddle player (near)
      this.op = { x: 0, z: .22, vx: 0, ang: 0, tx: 0, tz: .22, flash: 0, react: 0 };
      this.netShake = 0; this.rally = 0; this.state = 'idle'; this.t = 0; this.paused = false;
      this.finger = { down: false, sx: 0, sy: 0, vx: 0, vy: 0, hist: [] };
      this.assist = opt.assist !== false;
      this.resize();
      if (this.lobby) this.prepareLobby({ intro: true });
      this.loop = this.loop.bind(this); this.last = performance.now(); this.raf = requestAnimationFrame(this.loop);
      if (this.mode === 'play') this.bindInput();
    }
    destroy() {
      cancelAnimationFrame(this.raf); this.dead = true; this.unbind && this.unbind();
      if (this._lobby) this._lobby.onReady = this._lobby.onFrame = this._lobby.onHit = null;
    }
    resize() {
      const r = this.cv.getBoundingClientRect(); this.dpr = Math.min(2, devicePixelRatio || 1) * (S.quality === 'low' ? .7 : 1);
      this.W = r.width; this.H = r.height; this.cv.width = Math.max(1, r.width * this.dpr); this.cv.height = Math.max(1, r.height * this.dpr);
      this.F = (this.lobby ? Math.min(this.W, this.H * .62) : this.W) * this.cam.f;
    }

    /* ---------- камера ---------- */
    basis() {
      const p = this.cam.pitch * Math.PI / 180; return { sp: Math.sin(p), cp: Math.cos(p) };
    }
    project(x, y, z) {
      const yaw = (this.cam.yaw + this.cam.sway) * Math.PI / 180;
      if (yaw) { const px = x, py = y - NY; x = px * Math.cos(yaw) - py * Math.sin(yaw); y = px * Math.sin(yaw) + py * Math.cos(yaw) + NY; }
      const { sp, cp } = this.basis();
      const dx = x, dy = y - this.cam.y, dz = z - this.cam.z;
      const zc = dy * cp - dz * sp; const yc = dy * sp + dz * cp;
      const s = this.F / Math.max(this.lobby ? .001 : .05, zc);
      return { x: this.W / 2 + dx * s, y: this.H * this.cam.cy - yc * s, s };
    }
    unprojectPlaneY(sx, sy, Y) {
      const { sp, cp } = this.basis();
      const vx = (sx - this.W / 2) / this.F, vy = -(sy - this.H * this.cam.cy) / this.F;
      const dyy = sp * vy + cp, dzz = cp * vy - sp;
      const t = (Y - this.cam.y) / dyy;
      return { x: t * vx, z: this.cam.z + t * dzz };
    }

    /* Menu-only clock and arcs. No serves, match AI, points or ball replacement. */
    prepareLobby({ requestId = 0, intro = true, onReady, onFrame, onHit } = {}) {
      if (!this.lobby || this.dead) return false;
      const old = this._lobby;
      if (!intro && old && old.phase === 'rally') {
        Object.assign(old, { requestId, ready: false, onReady, onFrame: null, onHit: null, handoff: true, framesDone: true });
        return true;
      }
      if (intro && old && old.requestId === requestId && old.phase !== 'idle') return false;
      const l = this._lobby = { requestId, onReady, onFrame: intro ? onFrame : null, onHit: intro ? onHit : null,
        ready: false, phase: 'idle', handoff: !intro, framesDone: !intro, radius: VIS_BR, first: false, leg: null, hitPending: null };
      this.state = 'idle'; this.rally = 0; this.netShake = 0; this.trail.length = this.marks.length = 0;
      Object.assign(this.ball, { vx: 0, vy: 0, vz: 0, live: false, bounced: null, net: false });
      for (const P of [this.pp, this.op]) Object.assign(P, { x: 0, z: .28, tx: 0, tz: .28, vx: 0, ang: 0,
        flash: 0, bodyX: 0, lean: 0, windup: 0, hitAt: -100 });
      l.left = this.project(this.pp.x, PY, this.pp.z).x <= this.project(this.op.x, OY, this.op.z).x ? 'p' : 'o';
      if (!intro) {
        Object.assign(this.ball, { x: 0, y: l.left === 'p' ? PY : OY, z: .28 });
        l.first = true; this.lobbyContact(l.left);
      }
      return true;
    }
    lobbyCalm() {
      return !!document.hidden || !!S.rm || (typeof effectiveReducedMotion === 'function' && effectiveReducedMotion());
    }
    launchLobby({ requestId = 0, x = .5, y = .48, diameter = .9 } = {}) {
      const l = this._lobby;
      if (!this.lobby || this.dead || !l.ready || l.requestId !== requestId || l.phase !== 'idle' ||
          !this.W || !this.H || ![x, y, diameter].every(Number.isFinite) || diameter <= 0) return false;
      if (this.lobbyCalm()) this.stageLobbyContact();
      else {
        // Invert the actual yaw/pitch projection at the depth set by visible diameter.
        const depth = Math.max(.001, 2 * VIS_BR * this.F / (diameter * this.W));
        l.radius = diameter * this.W * depth / (2 * this.F);
        const dx = (x * this.W - this.W / 2) * depth / this.F;
        const yc = -(y * this.H - this.H * this.cam.cy) * depth / this.F;
        const { sp, cp } = this.basis(); const ry = this.cam.y + depth * cp + yc * sp - NY;
        const yaw = (this.cam.yaw + this.cam.sway) * Math.PI / 180;
        Object.assign(this.ball, { x: dx * Math.cos(yaw) + ry * Math.sin(yaw),
          y: -dx * Math.sin(yaw) + ry * Math.cos(yaw) + NY, z: this.cam.z + yc * cp - depth * sp,
          live: true, by: l.left === 'p' ? 'o' : 'p', bounced: null, net: false });
        l.phase = 'flight'; this.state = 'rally'; this.lobbyLeg(l.left, true);
      }
      this.draw();
      return true;
    }
    stageLobbyContact() {
      const l = this._lobby;
      Object.assign(this.ball, { x: 0, y: l.left === 'p' ? PY : OY, z: .28, vx: 0, vy: 0, vz: 0 });
      l.handoff = true; this.lobbyContact(l.left);
    }
    lobbyLeg(side, incoming = false) {
      const l = this._lobby, b = this.ball;
      const to = { x: incoming ? 0 : Math.sin(this.rally * .85) * .33,
        y: side === 'p' ? PY : OY, z: incoming ? .28 : .28 + Math.sin(this.rally * .65) * .035 };
      const bounce = { x: lerp(incoming ? 0 : b.x, to.x, .78), y: side === 'p' ? .48 : L - .48, z: BR };
      l.leg = { side, from: { x: b.x, y: b.y, z: b.z }, bounce, to, before: incoming ? .98 : .8,
        after: incoming ? .32 : .36, height: incoming ? .58 : .42, elapsed: 0, bounced: false,
        p: { x: this.pp.x, z: this.pp.z }, o: { x: this.op.x, z: this.op.z } };
      const T = l.leg.before;
      b.vx = (bounce.x - b.x) / T; b.vy = (bounce.y - b.y) / T; b.vz = (BR - b.z + 4 * l.leg.height) / T;
    }
    lobbyContact(side) {
      const l = this._lobby, b = this.ball, P = side === 'p' ? this.pp : this.op;
      const calm = this.lobbyCalm();
      P.x = P.tx = b.x; P.z = P.tz = b.z; P.windup = 0; P.flash = calm ? 0 : 1;
      P.hitAt = calm ? -100 : this.t; P.ang = calm ? 0 : (side === 'p' ? .25 : -.25);
      b.live = true; b.by = side; b.bounced = null; b.net = false; this.state = l.phase = 'rally'; this.rally++;
      if (!l.first) { l.first = true; l.hitPending = { type: 'lobbyHit', requestId: l.requestId, side, first: true }; }
      l.leg = null;
      if (!calm) this.lobbyLeg(side === 'p' ? 'o' : 'p');
    }
    stepLobby(dt) {
      const l = this._lobby, b = this.ball;
      if (this.lobbyCalm()) {
        if (l.phase === 'flight') this.stageLobbyContact();
        b.vx = b.vy = b.vz = 0; this.trail.length = this.marks.length = 0;
        for (const P of [this.pp, this.op]) { P.vx = P.windup = P.flash = P.ang = 0; P.hitAt = -100; }
        return;
      }
      if (l.phase === 'idle' || dt <= 0) return;
      this.t += dt;
      if (!l.leg) this.lobbyLeg(b.by === 'p' ? 'o' : 'p');
      const leg = l.leg, total = leg.before + leg.after;
      leg.elapsed = Math.min(total, leg.elapsed + dt);
      const after = leg.elapsed >= leg.before;
      const a = after ? leg.bounce : leg.from, end = after ? leg.to : leg.bounce;
      const T = after ? leg.after : leg.before, u = clamp((leg.elapsed - (after ? leg.before : 0)) / T, 0, 1);
      const height = after ? .12 : leg.height;
      b.x = lerp(a.x, end.x, u); b.y = lerp(a.y, end.y, u); b.z = lerp(a.z, end.z, u) + 4 * height * u * (1 - u);
      b.vx = (end.x - a.x) / T; b.vy = (end.y - a.y) / T; b.vz = (end.z - a.z + 4 * height * (1 - 2 * u)) / T;
      if (after && !leg.bounced) {
        leg.bounced = true; b.bounced = leg.side;
        this.marks.push({ x: leg.bounce.x, y: leg.bounce.y, t: this.t });
      }
      const progress = leg.elapsed / total, ease = progress * progress * (3 - 2 * progress);
      for (const side of ['p', 'o']) {
        const P = side === 'p' ? this.pp : this.op, origin = leg[side], receiver = side === leg.side;
        const previous = P.x;
        P.tx = receiver ? leg.to.x : origin.x * .55; P.tz = receiver ? leg.to.z : .28;
        P.x = lerp(origin.x, P.tx, ease); P.z = lerp(origin.z, P.tz, ease); P.vx = (P.x - previous) / dt;
        P.bodyX = lerp(P.bodyX, clamp(P.x, -.2, .2), Math.min(1, dt * 4)); P.lean = clamp((P.x - P.bodyX) * .6, -.06, .06);
        P.windup = receiver ? clamp((.28 - (total - leg.elapsed)) / .28, 0, 1) : 0;
        const follow = clamp(1 - (this.t - P.hitAt) / .42, 0, 1);
        P.ang = clamp(-P.vx * .12, -.15, .15) + (side === 'p' ? -1 : 1) * (.35 * P.windup - .25 * follow);
        P.flash *= Math.pow(.004, dt);
      }
      // Render the exact contact before advancing the outgoing leg.
      if (leg.elapsed >= total) this.lobbyContact(leg.side);
      if (S.quality !== 'low' && l.handoff) {
        this.trail.push({ x: b.x, y: b.y, z: b.z }); if (this.trail.length > 12) this.trail.shift();
      }
    }
    lobbyDrawn() {
      const l = this._lobby;
      if (!l || this.dead || !this.W || !this.H) return;
      if (!l.ready) {
        l.ready = true; const cb = l.onReady; l.onReady = null;
        if (typeof cb === 'function') cb({ type: 'lobbyReady', requestId: l.requestId });
        return;
      }
      if (!l.framesDone && l.phase !== 'idle') {
        const p = this.project(this.ball.x, this.ball.y, this.ball.z), cb = l.onFrame;
        l.framesDone = l.handoff; if (l.handoff) l.onFrame = null;
        if (typeof cb === 'function') cb({ type: 'lobbyFrame', requestId: l.requestId, x: p.x / this.W, y: p.y / this.H,
          diameter: 2 * l.radius * p.s / this.W, phase: l.phase, handoff: l.handoff,
          progress: l.phase === 'flight' ? l.leg.elapsed / (l.leg.before + l.leg.after) : 1 });
      }
      if (this._lobby !== l || this.dead) return;
      if (l.hitPending) {
        const hit = l.hitPending, cb = l.onHit; l.hitPending = null; l.onHit = null;
        if (typeof cb === 'function') cb(hit);
      }
    }

    /* ---------- ввод ---------- */
    bindInput() {
      const el = this.cv;
      const pos = (e) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) * (this.W / r.width), y: (e.clientY - r.top) * (this.H / r.height) }; };
      const down = (e) => { const p = pos(e); const f = this.finger; f.down = true; f.sx = p.x; f.sy = p.y; f.hist = [{ x: p.x, y: p.y, t: performance.now() }]; this.on('touch', p); if (this.state === 'serve-p') this.servePending = true; };
      const move = (e) => { const f = this.finger; if (!f.down && e.pointerType !== 'mouse') return; const p = pos(e); f.sx = p.x; f.sy = p.y; f.hist.push({ x: p.x, y: p.y, t: performance.now() }); if (f.hist.length > 12) f.hist.shift(); };
      const up = () => { const f = this.finger; f.down = false; if (this.state === 'serve-p' && this.servePending) { this.servePending = false; this.serveFromPlayer(); } };
      el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
      this.unbind = () => { el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    }
    fingerVel() {
      const h = this.finger.hist; const now = performance.now();
      const recent = h.filter((p) => now - p.t < 110); if (recent.length < 2) return { vx: 0, vy: 0 };
      const a = recent[0], b = recent[recent.length - 1]; const dt = Math.max(16, b.t - a.t) / 1000;
      return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
    }

    /* ---------- удары ---------- */
    shoot(tx, ty, T, by, { net = false } = {}) {
      const b = this.ball;
      let tries = 0;
      while (tries++ < 12) {
        const vy = (ty - b.y) / T; const tn = (NY - b.y) / vy; const vz = (0 - b.z + .5 * G * T * T) / T;
        const zn = b.z + vz * tn - .5 * G * tn * tn;
        if (net || zn > NET_H + .03 || tn < 0 || tn > T) { b.vx = (tx - b.x) / T; b.vy = vy; b.vz = vz; break; }
        T += .04;
      }
      if (net) { b.vz *= .82; }
      b.by = by; b.bounced = null; b.net = false; b.live = true; this.rally++;
    }
    serve(by) {
      if (this.lobby) return;
      const b = this.ball; this.rally = 0; this.trail = [];
      if (by === 'p') { this.state = 'serve-p'; b.live = false; b.x = this.pp.x; b.y = PY; b.z = .3; }
      else {
        this.state = 'serve-o'; b.live = false; b.x = rnd(-.3, .3); b.y = OY; b.z = .3; this.op.tx = b.x;
        setTimeout(() => { if (this.dead || this.state !== 'serve-o') return; this.state = 'rally'; this.shoot(rnd(-.5, .5), rnd(.35, .9), .62, 'o'); this.op.flash = 1; this.on('hit', { by: 'o', ...this.project(b.x, b.y, b.z) }); }, this.mode === 'demo' ? 500 : 850);
      }
    }
    serveFromPlayer() {
      const v = this.fingerVel(); const b = this.ball;
      this.state = 'rally';
      const tx = clamp(v.vx / 1800, -1, 1) * .55; const p = clamp(-v.vy / 2200, 0, 1);
      this.shoot(tx, rnd(1.95, 2.4), lerp(.62, .5, p), 'p'); this.pp.flash = 1;
      this.on('hit', { by: 'p', perfect: false, power: p, ...this.project(b.x, b.y, b.z) });
    }

    /* ---------- ИИ ---------- */
    predictCross(planeY) {
      const b = { ...this.ball }; let bounced = 0;
      for (let i = 0; i < 600; i++) {
        const dt = 1 / 240; const py = b.y;
        b.vz -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        if (b.z <= BR && Math.abs(b.x) <= HW && b.y >= 0 && b.y <= L && b.vz < 0) { b.z = BR; b.vz = -b.vz * .86; bounced++; }
        if ((py - planeY) * (b.y - planeY) <= 0) return { x: b.x, z: b.z, ok: bounced > 0 };
        if (b.z < FLOOR) return null;
      }
      return null;
    }
    aiDrive(P, planeY, side, dt) {
      const b = this.ball;
      const incoming = b.live && ((side === 'o' && b.vy > 0) || (side === 'p' && b.vy < 0));
      if (incoming) {
        P.react -= dt;
        if (P.react <= 0) { const pr = this.predictCross(planeY); if (pr) { P.tx = pr.x + (P.err || 0); P.tz = clamp(pr.z, .05, .6); } else { const vx = b.vx, vy = b.vy; const estT = Math.max(1e-3, (planeY - b.y) / vy); P.tx = clamp(b.x + vx * estT, -1.1, 1.1); P.tz = clamp(b.z + ( -G * estT * estT / 2 + b.vz * estT), .05, .6); } }
      } else { P.tx = lerp(P.tx, 0, dt * 1.2); P.tz = .22; P.react = .12 / this.diff; P.err = rnd(-.06, .06) * (1.3 - this.diff); }
      /* В демо «ИИ против ИИ» (живой фон хаба) боты двигались рывками:
       * gain 9 на дистанцию + скорость до 2.2 м/с выглядело как телепортация.
       * В демо движения намеренно мягче (gain 4.5, скорость ниже) — читаемо и плавно. */
      const demo = this.mode === 'demo';
      const maxV = (1.1 + this.diff * 1.1) * (demo ? .58 : 1); const dx = P.tx - P.x;
      const v = clamp(dx * (demo ? 4.5 : 9), -maxV, maxV); P.vx = v; P.x += v * dt; P.z = lerp(P.z, P.tz, dt * (demo ? 4.5 : 8));
      P.ang = lerp(P.ang, clamp(-v * .25, -.6, .6), dt * (demo ? 6 : 10));
    }

    /* ---------- цикл ---------- */
    loop(now) {
      if (this.dead) return; this.raf = requestAnimationFrame(this.loop);
      let dtR = Math.min(.05, (now - this.last) / 1000); this.last = now;
      if (this.lobby) { if (!this.paused || this.lobbyCalm()) this.stepLobby(this.paused ? 0 : dtR); this.draw(); return; }
      if (this.paused) { this.draw(); return; }
      this.timeScale = now < this.slowUntil ? .22 : lerp(this.timeScale, 1, .15);
      this.t += dtR;
      if (this.cam.swayAmp) this.cam.sway = Math.sin(this.t * .25) * this.cam.swayAmp;
      const dtW = dtR * this.spd * this.timeScale * (1 + Math.min(this.rally, 14) * .018);
      const steps = Math.ceil(dtW / (1 / 240));
      for (let i = 0; i < steps; i++) this.step(dtW / steps, dtR / steps);
      this.netShake *= Math.pow(.02, dtR); this.pp.flash *= Math.pow(.004, dtR); this.op.flash *= Math.pow(.004, dtR);
      this.draw();
    }
    step(dt, dtR) {
      if (this.lobby) { this.stepLobby(dtR); return; }
      const b = this.ball;
      // ракетка игрока
      if (this.mode === 'play') {
        const P = this.pp; const f = this.finger;
        const w = this.unprojectPlaneY(f.sx, f.sy - 64, PY);
        let tx = clamp(f.sx, -1.1, 1.1);
        const pr = b.live && b.vy < 0 ? this.predictCross(PY) : null;
        let tz = clamp(w.z, .03, .65);
        if (pr) { tz = lerp(tz, pr.z, this.assist ? .88 : .55); if (this.assist && Math.abs(pr.x - tx) < .28) tx = lerp(tx, pr.x, .22); }
        const nx = lerp(P.x, tx, Math.min(1, dtR * 30)); P.vx = (nx - P.x) / Math.max(1e-4, dtR); if (Math.abs(P.vx) > 15) { const sign = Math.sign(P.vx); P.vx = sign * 15; } P.x = nx; P.z = lerp(P.z, tz, Math.min(1, dtR * 16));
        P.ang = lerp(P.ang, clamp(-P.vx * .06, -.7, .7), Math.min(1, dtR * 12));
        if (this.state === 'serve-p') { b.x = P.x; b.y = PY + .02; b.z = P.z + .1 + Math.abs(Math.sin(this.t * 4)) * .18; }
      } else this.aiDrive(this.pp, PY, 'p', dtR);
      this.aiDrive(this.op, OY, 'o', dtR);
      if (this.state === 'serve-o') { b.x = this.op.x; b.y = OY - .02; b.z = this.op.z + .1 + Math.abs(Math.sin(this.t * 4)) * .18; }
      if (!b.live) return;

      const py = b.y, pz = b.z;
      b.vz -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      // сетка
      if (!b.net && (py - NY) * (b.y - NY) <= 0 && b.z < NET_H && b.z > -.02 && Math.abs(b.x) < HW + .15) {
        b.net = true; b.y = NY - Math.sign(b.vy) * .02; b.vy = -b.vy * .12; b.vx *= .3; b.vz = Math.max(.4, b.vz * .3);
        this.netShake = 1; this.on('net', this.project(b.x, NY, b.z));
      }
      // отскок от стола
      if (b.z <= BR && b.vz < 0 && Math.abs(b.x) <= HW && b.y >= 0 && b.y <= L) {
        b.z = BR; b.vz = -b.vz * .86; b.vx *= .97; b.vy *= .97;
        const side = b.y < NY ? 'p' : 'o';
        this.marks.push({ x: b.x, y: b.y, t: this.t });
        this.on('bounce', { side, ...this.project(b.x, b.y, 0) });
        const target = b.by === 'p' ? 'o' : 'p';
        if (side !== target) return this.endRally(target, b.net ? 'net' : 'own');      // свой стол / после сетки
        if (b.bounced === target) return this.endRally(b.by, 'double');               // два отскока
        b.bounced = target;
      }
      // пересечение плоскости удара
      const receiver = b.by === 'p' ? 'o' : 'p'; const plane = receiver === 'p' ? PY : OY;
      if ((py - plane) * (b.y - plane) <= 0 && ((receiver === 'p' && b.vy < 0) || (receiver === 'o' && b.vy > 0))) {
        const P = receiver === 'p' ? this.pp : this.op;
        const dx = Math.abs(b.x - P.x), dz = Math.abs(b.z - P.z);
        if (b.bounced !== receiver) { // мяч не попал на стол
          return this.endRally(receiver, 'out');
        }
        const isHuman = this.mode === 'play' && receiver === 'p';
        const reach = isHuman ? (this.assist ? .24 : .19) : .2;
        const d = Math.hypot(dx, dz * .45);
        if (d < reach) {
          if (isHuman) this.humanHit(d / reach);
          else this.aiHit(receiver, P);
        } else {
          b.missedBy = receiver;
        }
      }
      // мяч упал — конец розыгрыша
      if (b.z < FLOOR || b.y < -1.6 || b.y > L + 1.6) {
        const receiver2 = b.by === 'p' ? 'o' : 'p';
        if (b.bounced === receiver2) this.endRally(b.by, 'miss'); else this.endRally(receiver2, 'out');
      }
      // след
      this.trailTick = (this.trailTick || 0) + dt;
      if (this.trailTick > .006) { this.trailTick = 0; this.trail.push({ x: b.x, y: b.y, z: b.z }); if (this.trail.length > 18) this.trail.shift(); }
    }
    humanHit(rel) {
      const b = this.ball; const v = this.fingerVel();
      const q = 1 - rel; const power = clamp(Math.abs(v.vy) / 2000, 0, 1);
      const perfect = q > .6 && power > .3;
      const weak = q < .1 && Math.random() < .45;
      let tx = clamp(v.vx / 1700, -1, 1) * .62 + (b.x - this.pp.x) * .8 + rnd(-.06, .06);
      if (Math.abs(v.vx) > 2600) tx = Math.sign(v.vx) * rnd(.7, .9); // риск: в аут
      tx = clamp(tx, -.92, .92);
      const sidespin = (b.x - this.pp.x) * (1 - rel) * .15 * (S.cal && S.cal.spinGain !== undefined ? clamp(S.cal.spinGain, 0, 1) : 1);
      tx = clamp(tx + sidespin, -.92, .92);
      const arcSens = S.cal && S.cal.arcSens !== undefined ? clamp(S.cal.arcSens, 0, 1) : 1;
      const effectiveSidespin = arcSens > 0.5 ? sidespin : 0;
      tx = clamp(tx + effectiveSidespin, -.92, .92);
      const ty = lerp(NY + .45, L - .18, clamp(.35 + power * .65 + rnd(-.1, .1), 0, 1));
      let T = lerp(.6, .42, power) * (perfect ? .78 : 1);
      this.shoot(tx, ty, T, 'p', { net: weak });
      this.pp.flash = 1;
      if (perfect) { this.slowUntil = performance.now() + 340; }
      this.lastShot = { perfect, power, q };
      this.on('hit', { by: 'p', perfect, power, q, ...this.project(b.x, b.y, b.z) });
    }
    aiHit(side, P) {
      const b = this.ball; const ls = this.lastShot || {};
      let miss = .05 + (1 - this.diff) * .12 + Math.min(this.rally, 20) * .006;
      if (this.mode === 'play') { if (ls.perfect) miss += .5; else miss += ls.power * .15; }
      if (this.mode === 'demo') miss = this.rally > 9 ? .3 : .02;
      if (Math.random() < miss) { b.missedBy = side; P.tx += Math.sign(rnd(-1, 1)) * .25; return; }
      const toP = side === 'o';
      const smash = b.z > .32 && Math.random() < .35 * this.diff;
      const awayFrom = toP ? this.pp.x : this.op.x;
      let tx = clamp(-Math.sign(awayFrom || rnd(-1, 1)) * rnd(.15, .6) + rnd(-.15, .15), -.66, .66);
      const spinMult = S.cal && S.cal.spinGain !== undefined ? clamp(S.cal.spinGain, 0, 1) : 1;
      tx = clamp(tx + rnd(-.1, .1) * spinMult, -.66, .66);
      const ty = toP ? rnd(.3, NY - .3) : rnd(NY + .3, L - .25);
      const T = (smash ? .44 : rnd(.52, .64)) - this.diff * .04;
      this.shoot(tx, ty, T, side); P.flash = 1; this.lastShot = { perfect: false, power: smash ? .9 : .3 };
      this.on('hit', { by: side, smash, ...this.project(b.x, b.y, b.z) });
    }
    endRally(winner, reason) {
      const b = this.ball; if (!b.live) return; b.live = false; this.state = 'over';
      this.on('point', { winner, reason, rally: this.rally, ...this.project(b.x, clamp(b.y, 0, L), Math.max(0, b.z)) });
    }

    /* ---------- отрисовка ---------- */
    quad(pts, fill) { const c = this.ctx; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); if (fill) { c.fillStyle = fill; c.fill(); } }
    P(x, y, z) { return this.project(x, y, z); }
    draw() {
      const c = this.ctx; const W = this.W, H = this.H; c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, W, H);
      const P = (x, y, z) => this.project(x, y, z);
      const lobby = this._lobby;
      const back = lobby && (P(this.pp.x, PY, this.pp.z).s < P(this.op.x, OY, this.op.z).s ? 'p' : 'o');
      if (lobby && lobby.phase !== 'idle' && !lobby.handoff) {
        const b = this.ball; if (2 * lobby.radius * P(b.x, b.y, b.z).s <= 12) lobby.handoff = true;
      }
      // тень стола на полу
      const fc = P(0, NY, FLOOR); const fw = P(HW + .5, NY, FLOOR).x - fc.x;
      let g = c.createRadialGradient(fc.x, fc.y, 0, fc.x, fc.y, fw * 1.3); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(fc.x, fc.y, fw * 1.4, fw * .55, 0, 0, 7); c.fill();
      if (lobby) {
        this.drawRobotShadow(this.pp, PY);
        this.drawRobotShadow(this.op, OY);
      }
      // ножки
      c.fillStyle = '#0A0D1E';
      for (const [lx, ly] of [[-HW + .12, .25], [HW - .12, .25], [-HW + .12, L - .25], [HW - .12, L - .25]]) {
        const a = P(lx, ly, -.03), bb = P(lx, ly, FLOOR); const w = Math.max(2, a.s * .04);
        c.fillRect(a.x - w / 2, a.y, w, bb.y - a.y);
      }
      // торцы и бока
      const T = .03;
      this.quad([P(-HW, 0, 0), P(HW, 0, 0), P(HW, 0, -T), P(-HW, 0, -T)], '#081A4A');
      this.quad([P(-HW, 0, 0), P(-HW, L, 0), P(-HW, L, -T), P(-HW, 0, -T)], '#0A1F57');
      this.quad([P(HW, 0, 0), P(HW, L, 0), P(HW, L, -T), P(HW, 0, -T)], '#0A1F57');
      // столешница
      const n1 = P(-HW, 0, 0), n2 = P(HW, 0, 0), f2 = P(HW, L, 0), f1 = P(-HW, L, 0);
      g = c.createLinearGradient(0, n1.y, 0, f1.y); g.addColorStop(0, '#1E63E0'); g.addColorStop(.5, '#1749B0'); g.addColorStop(1, '#0F3486');
      this.quad([n1, n2, f2, f1], g);
      // блик прожектора
      c.save(); this.quad([n1, n2, f2, f1]); c.clip();
      const sp = P(Math.sin(this.t * .3) * .3, NY * .9, 0);
      g = c.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, (n2.x - n1.x) * .6); g.addColorStop(0, 'rgba(160,220,255,.28)'); g.addColorStop(1, 'rgba(160,220,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // отметки отскоков
      for (let i = this.marks.length - 1; i >= 0; i--) {
        const m = this.marks[i]; const age = this.t - m.t; if (age > .6) { this.marks.splice(i, 1); continue; }
        const p = P(m.x, m.y, 0); const r = (.03 + age * .25) * p.s;
        c.strokeStyle = `rgba(255,255,255,${(1 - age / .6) * .8})`; c.lineWidth = 2; c.beginPath(); c.ellipse(p.x, p.y, r, r * .45, 0, 0, 7); c.stroke();
      }
      c.restore();
      // белые линии
      const line = (x0, y0, x1, y1, w) => { const a = P(x0 - w, y0, 0), b2 = P(x0 + w, y0, 0), cc = P(x1 + w, y1, 0), d = P(x1 - w, y1, 0); this.quad([a, b2, cc, d], 'rgba(255,255,255,.92)'); };
      const e = .02;
      line(-HW + e / 2, 0, -HW + e / 2, L, e / 2); line(HW - e / 2, 0, HW - e / 2, L, e / 2); line(0, 0, 0, L, .0025);
      this.quad([P(-HW, 0, 0), P(HW, 0, 0), P(HW, e, 0), P(-HW, e, 0)], 'rgba(255,255,255,.95)');
      this.quad([P(-HW, L - e, 0), P(HW, L - e, 0), P(HW, L, 0), P(-HW, L, 0)], 'rgba(255,255,255,.9)');
      // неоновые кромки сторон
      c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
      c.shadowBlur = 18; c.shadowColor = this.colP; c.strokeStyle = this.colP; c.lineWidth = 3;
      c.beginPath(); c.moveTo(n1.x, n1.y + 3); c.lineTo(n2.x, n2.y + 3); c.stroke();
      c.shadowColor = this.colO; c.strokeStyle = this.colO; c.lineWidth = 2;
      c.beginPath(); c.moveTo(f1.x, f1.y - 1); c.lineTo(f2.x, f2.y - 1); c.stroke(); c.restore();

      if (lobby) {
        const b = this.ball, ballFar = P(b.x, b.y, b.z).s < P(0, NY, NET_H).s;
        if (ballFar) this.drawBall();
        this.drawNet();
        // Robots stand behind their own paddle, so the near body covers the far one.
        this.drawRobot(this.op, OY, this.colO, true);
        this.drawRobot(this.pp, PY, this.colP, false);
        if (!ballFar) this.drawBall();
        this.lobbyDrawn(); return;
      }

      const b = this.ball; const ballFar = b.y > NY;
      this.drawPaddle(this.op, OY, this.colO, true);
      if (ballFar) this.drawBall();
      this.drawNet();
      if (!ballFar) this.drawBall();
      if (this.mode === 'demo' || !this.hidePaddle) this.drawPaddle(this.pp, PY, this.colP, false);
    }
    drawNet() {
      const c = this.ctx; const P = (x, y, z) => this.project(x, y, z);
      const sh = Math.sin(this.t * 40) * this.netShake * .03; const ext = HW + .15;
      const a = P(-ext, NY + sh, 0), b = P(ext, NY + sh, 0), cc = P(ext, NY + sh, NET_H), d = P(-ext, NY + sh, NET_H);
      this.quad([a, b, cc, d], 'rgba(220,235,255,.16)');
      c.strokeStyle = 'rgba(230,240,255,.28)'; c.lineWidth = .7; c.beginPath();
      for (let x = -ext; x <= ext; x += .05) { const p0 = P(x, NY + sh, 0), p1 = P(x, NY + sh, NET_H); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); }
      for (let z = .03; z < NET_H; z += .035) { const p0 = P(-ext, NY + sh, z), p1 = P(ext, NY + sh, z); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); }
      c.stroke();
      const t0 = P(-ext, NY + sh, NET_H), t1 = P(ext, NY + sh, NET_H);
      c.strokeStyle = '#fff'; c.lineWidth = Math.max(2, t0.s * .014); c.beginPath(); c.moveTo(t0.x, t0.y); c.lineTo(t1.x, t1.y); c.stroke();
      c.fillStyle = '#C9D2F5';
      for (const x of [-ext, ext]) { const p0 = P(x, NY, -.02), p1 = P(x, NY, NET_H + .01); const w = Math.max(2.5, p0.s * .02); c.fillRect(p0.x - w / 2, p1.y, w, p0.y - p1.y); }
    }
    drawBall() {
      const c = this.ctx; const b = this.ball; const P = (x, y, z) => this.project(x, y, z);
      if (this.lobby && !this._lobby.handoff) return;
      if (!b.live && this.state !== 'serve-p' && this.state !== 'serve-o') return;
      const radius = this.lobby ? this._lobby.radius : VIS_BR;
      // тень
      const overTable = Math.abs(b.x) <= HW && b.y >= 0 && b.y <= L;
      const sz = overTable ? 0 : FLOOR; const sp = P(b.x, b.y, sz); const hgt = Math.max(0, b.z - sz);
      const sr = radius * sp.s * (1 + hgt * .8);
      c.fillStyle = `rgba(0,0,10,${clamp(.55 - hgt * .5, .12, .55)})`; c.beginPath(); c.ellipse(sp.x, sp.y, sr * 1.2, sr * .5, 0, 0, 7); c.fill();
      // след
      const col = b.by === 'p' ? this.colP : this.colO; const perfect = this.lastShot && this.lastShot.perfect && b.by === 'p';
      if (this.trail.length > 2 && S.quality !== 'low') {
        c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
        for (let i = 1; i < this.trail.length; i++) {
          const p0 = P(this.trail[i - 1].x, this.trail[i - 1].y, this.trail[i - 1].z), p1 = P(this.trail[i].x, this.trail[i].y, this.trail[i].z);
          const k = i / this.trail.length; c.strokeStyle = perfect ? `rgba(255,200,60,${k * .9})` : hexA(col, k * .7);
          c.lineWidth = radius * p1.s * 1.6 * k; c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
        }
        c.restore();
      }
      const p = P(b.x, b.y, b.z); const r = this.lobby ? radius * p.s : Math.max(3, VIS_BR * p.s);
      const gl = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2); gl.addColorStop(0, perfect ? 'rgba(255,210,80,.55)' : 'rgba(255,255,255,.35)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gl; c.beginPath(); c.arc(p.x, p.y, r * 3.2, 0, 7); c.fill();
      const g = c.createRadialGradient(p.x - r * .35, p.y - r * .4, r * .1, p.x, p.y, r);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(.6, '#FFF3E0'); g.addColorStop(1, '#F2B880');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.fill();
    }
    drawRobotShadow(Pd, planeY) {
      const c = this.ctx, p = this.project(Pd.bodyX, planeY + (planeY === PY ? -.32 : .32), FLOOR);
      c.fillStyle = 'rgba(0,0,12,.4)'; c.beginPath(); c.ellipse(p.x, p.y, p.s * .29, p.s * .11, 0, 0, 7); c.fill();
    }
    drawRobot(Pd, planeY, col, far) {
      const c = this.ctx, inward = far ? -1 : 1, hand = far ? -1 : 1;
      const bx = Pd.bodyX, by = planeY - inward * .32;
      const follow = clamp(1 - (this.t - Pd.hitAt) / .42, 0, 1);
      const tx = bx + Pd.lean, ty = by + inward * (.035 + follow * .07 - Pd.windup * .04);
      const P = (x, y, z) => this.project(x, y, z);
      const joint = (p, radius, fill) => { c.fillStyle = fill; c.beginPath(); c.arc(p.x, p.y, p.s * radius, 0, 7); c.fill(); };
      const limb = (a, b, width) => {
        c.strokeStyle = '#111A30'; c.lineWidth = (a.s + b.s) * width * .6;
        c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        c.strokeStyle = '#A8B9D0'; c.lineWidth *= .65; c.stroke();
      };
      c.save(); c.lineCap = c.lineJoin = 'round';
      const stride = clamp(Pd.vx * .055, -.055, .055);
      for (const sign of [-1, 1]) {
        const hip = P(bx + sign * .11, by, -.1), knee = P(bx + sign * .13, by + inward * .035, -.43 + Math.abs(stride) * .2);
        const foot = P(bx + sign * .14 + sign * stride, by - inward * sign * stride, FLOOR + .035);
        limb(hip, knee, .075); limb(knee, foot, .065); joint(knee, .047, '#526887');
        c.fillStyle = '#D5DFEC'; c.beginPath(); c.ellipse(foot.x, foot.y, foot.s * .105, foot.s * .045, -.15 * sign, 0, 7); c.fill();
      }
      const freeShoulder = P(tx - hand * .19, ty, .53), freeElbow = P(tx - hand * .24, ty, .23), freeWrist = P(tx - hand * .18, ty + inward * .07, .03);
      limb(freeShoulder, freeElbow, .075); limb(freeElbow, freeWrist, .06); joint(freeElbow, .045, '#526887'); joint(freeWrist, .045, '#D5DFEC');
      this.quad([P(bx - .15, by, .04), P(bx + .15, by, .04), P(bx + .13, by, -.17), P(bx - .13, by, -.17)], '#384D70');
      const chest = P(tx, ty, .35);
      let g = c.createLinearGradient(chest.x, chest.y - .3 * chest.s, chest.x, chest.y + .3 * chest.s);
      g.addColorStop(0, '#DBE4F0'); g.addColorStop(1, '#7085A5');
      this.quad([P(tx - .19, ty, .57), P(tx + .19, ty, .57), P(bx + .14, by, .04), P(bx - .14, by, .04)], g);
      c.strokeStyle = '#1B2A47'; c.lineWidth = Math.max(1, chest.s * .018); c.stroke();
      this.quad([P(tx - .15, ty, .43), P(tx + .15, ty, .43), P(tx + .14, ty, .34), P(tx - .14, ty, .34)], col);
      joint(P(tx, ty, .21), .046, '#162A47'); joint(P(tx, ty, .21), .023, lighten(col));
      limb(P(tx, ty, .57), P(tx, ty, .72), .075);
      const head = P(tx, ty, .83), w = head.s * .30, h = head.s * .27;
      g = c.createLinearGradient(head.x - w / 2, head.y - h / 2, head.x + w / 2, head.y + h / 2);
      g.addColorStop(0, '#F1F5FB'); g.addColorStop(1, '#8D9FB9');
      roundRect(c, head.x - w / 2, head.y - h / 2, w, h, w * .18); c.fillStyle = g; c.fill();
      c.strokeStyle = '#233650'; c.lineWidth = Math.max(1, head.s * .017); c.stroke();
      roundRect(c, head.x - w * .4, head.y - h * .18, w * .8, h * .38, h * .12); c.fillStyle = '#101D34'; c.fill();
      const target = P(this.ball.x, this.ball.y, this.ball.z), look = this._lobby.phase === 'idle' ? 0 : clamp((target.x - head.x) / this.W, -.12, .12) * w;
      c.fillStyle = lighten(col);
      for (const sign of [-1, 1]) { roundRect(c, head.x + look + sign * w * .19 - w * .1, head.y - h * .045, w * .2, h * .09, h * .025); c.fill(); }
      c.fillStyle = '#566F92'; c.fillRect(head.x - w * .15, head.y + h * .3, w * .3, h * .035);
      const shoulder = P(tx + hand * .19, ty, .53);
      const elbow = P(tx + hand * .22 + (Pd.x - tx) * .25, planeY - inward * (.18 + Pd.windup * .1), Math.max(.18, Pd.z - .05));
      const contact = P(Pd.x, planeY, Pd.z), r = (far ? .1 : .085) * contact.s * (far ? 1.25 : 1.05);
      // The wrist grips the existing drawPaddle handle, including its screen rotation.
      const hy = r * (far ? -1.35 : 1.3);
      const wrist = { x: contact.x - Math.sin(Pd.ang) * hy, y: contact.y + Math.cos(Pd.ang) * hy, s: contact.s };
      limb(shoulder, elbow, .075); limb(elbow, wrist, .06); joint(shoulder, .052, col); joint(elbow, .044, '#526887');
      this.drawPaddle(Pd, planeY, col, far); joint(wrist, .035, '#D5DFEC');
      c.restore();
    }
    drawPaddle(Pd, planeY, col, far) {
      const c = this.ctx; const p = this.project(Pd.x, planeY, Pd.z);
      const r = (far ? .1 : .085) * p.s * (far ? 1.25 : 1.05);
      c.save(); c.translate(p.x, p.y); c.rotate(Pd.ang + (far ? Math.PI : 0) * 0);
      if (Pd.flash > .05) { c.globalCompositeOperation = 'lighter'; const g = c.createRadialGradient(0, 0, 0, 0, 0, r * 2.4); g.addColorStop(0, hexA(col, Pd.flash * .8)); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, r * 2.4, 0, 7); c.fill(); c.globalCompositeOperation = 'source-over'; }
      // ручка
      const hx = far ? 0 : 0, hy = far ? -r * .95 : r * .9;
      c.fillStyle = '#B8743A'; c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 1;
      roundRect(c, hx - r * .2, far ? hy - r * .9 : hy - r * .1, r * .4, r * 1.0, r * .15); c.fill(); c.stroke();
      // накладка
      c.fillStyle = '#2A1408'; c.beginPath(); c.ellipse(0, 0, r * 1.04, r * 1.1, 0, 0, 7); c.fill();
      const g = c.createRadialGradient(-r * .35, -r * .4, r * .1, 0, 0, r * 1.1); g.addColorStop(0, lighten(col)); g.addColorStop(.5, col); g.addColorStop(1, darken(col));
      c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, r, r * 1.06, 0, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = Math.max(1, r * .08); c.beginPath(); c.ellipse(0, 0, r * .78, r * .84, 0, 3.6, 4.6); c.stroke();
      c.restore();
    }
    screenOfPaddle() { return this.project(this.pp.x, PY, this.pp.z); }
  }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  function lighten(hex) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.min(255, v + 90); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
  function darken(hex) { const n = parseInt(hex.slice(1), 16); const f = (v) => Math.max(0, v * .45 | 0); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; }
  return { Game, L, NY, HW };
})();
