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
      this.cam = Object.assign({ y: -1.05, z: 1.75, pitch: 36, f: 1.02, cy: .43, yaw: 0, sway: 0 }, opt.cam || {});
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
      this.loop = this.loop.bind(this); this.last = performance.now(); this.raf = requestAnimationFrame(this.loop);
      if (this.mode === 'play') this.bindInput();
    }
    destroy() { cancelAnimationFrame(this.raf); this.dead = true; this.unbind && this.unbind(); }
    resize() {
      const r = this.cv.getBoundingClientRect(); this.dpr = Math.min(2, devicePixelRatio || 1) * (S.quality === 'low' ? .7 : 1);
      this.W = r.width; this.H = r.height; this.cv.width = Math.max(1, r.width * this.dpr); this.cv.height = Math.max(1, r.height * this.dpr);
      this.F = this.W * this.cam.f;
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
      const s = this.F / Math.max(.05, zc);
      return { x: this.W / 2 + dx * s, y: this.H * this.cam.cy - yc * s, s };
    }
    unprojectPlaneY(sx, sy, Y) {
      const { sp, cp } = this.basis();
      const vx = (sx - this.W / 2) / this.F, vy = -(sy - this.H * this.cam.cy) / this.F;
      const dyy = sp * vy + cp, dzz = cp * vy - sp;
      const t = (Y - this.cam.y) / dyy;
      return { x: t * vx, z: this.cam.z + t * dzz };
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
        if (P.react <= 0) { const pr = this.predictCross(planeY); if (pr) { P.tx = pr.x + (P.err || 0); P.tz = clamp(pr.z, .05, .6); } }
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
      const b = this.ball;
      // ракетка игрока
      if (this.mode === 'play') {
        const P = this.pp; const f = this.finger;
        const w = this.unprojectPlaneY(f.sx, f.sy - 64, PY);
        let tx = clamp(w.x, -1.1, 1.1);
        const pr = b.live && b.vy < 0 ? this.predictCross(PY) : null;
        let tz = clamp(w.z, .03, .65);
        if (pr) { tz = lerp(tz, pr.z, this.assist ? .88 : .55); if (this.assist && Math.abs(pr.x - tx) < .28) tx = lerp(tx, pr.x, .22); }
        const nx = lerp(P.x, tx, Math.min(1, dtR * 30)); P.vx = (nx - P.x) / Math.max(1e-4, dtR); P.x = nx; P.z = lerp(P.z, tz, Math.min(1, dtR * 16));
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
      const q = 1 - rel; const power = clamp(-v.vy / 2000, 0, 1);
      const perfect = q > .6 && power > .3;
      const weak = q < .1 && Math.random() < .45;
      let tx = clamp(v.vx / 1700, -1, 1) * .62 + (b.x - this.pp.x) * .8 + rnd(-.06, .06);
      if (Math.abs(v.vx) > 2600) tx = Math.sign(v.vx) * rnd(.7, .9); // риск: в аут
      tx = clamp(tx, -.92, .92);
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
      // тень стола на полу
      const fc = P(0, NY, FLOOR); const fw = P(HW + .5, NY, FLOOR).x - fc.x;
      let g = c.createRadialGradient(fc.x, fc.y, 0, fc.x, fc.y, fw * 1.3); g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.ellipse(fc.x, fc.y, fw * 1.4, fw * .55, 0, 0, 7); c.fill();
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
      if (!b.live && this.state !== 'serve-p' && this.state !== 'serve-o') return;
      // тень
      const overTable = Math.abs(b.x) <= HW && b.y >= 0 && b.y <= L;
      const sz = overTable ? 0 : FLOOR; const sp = P(b.x, b.y, sz); const hgt = Math.max(0, b.z - sz);
      const sr = VIS_BR * sp.s * (1 + hgt * .8);
      c.fillStyle = `rgba(0,0,10,${clamp(.55 - hgt * .5, .12, .55)})`; c.beginPath(); c.ellipse(sp.x, sp.y, sr * 1.2, sr * .5, 0, 0, 7); c.fill();
      // след
      const col = b.by === 'p' ? this.colP : this.colO; const perfect = this.lastShot && this.lastShot.perfect && b.by === 'p';
      if (this.trail.length > 2 && S.quality !== 'low') {
        c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
        for (let i = 1; i < this.trail.length; i++) {
          const p0 = P(this.trail[i - 1].x, this.trail[i - 1].y, this.trail[i - 1].z), p1 = P(this.trail[i].x, this.trail[i].y, this.trail[i].z);
          const k = i / this.trail.length; c.strokeStyle = perfect ? `rgba(255,200,60,${k * .9})` : hexA(col, k * .7);
          c.lineWidth = VIS_BR * p1.s * 1.6 * k; c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(p1.x, p1.y); c.stroke();
        }
        c.restore();
      }
      const p = P(b.x, b.y, b.z); const r = Math.max(3, VIS_BR * p.s);
      const gl = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3.2); gl.addColorStop(0, perfect ? 'rgba(255,210,80,.55)' : 'rgba(255,255,255,.35)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gl; c.beginPath(); c.arc(p.x, p.y, r * 3.2, 0, 7); c.fill();
      const g = c.createRadialGradient(p.x - r * .35, p.y - r * .4, r * .1, p.x, p.y, r);
      g.addColorStop(0, '#FFFFFF'); g.addColorStop(.6, '#FFF3E0'); g.addColorStop(1, '#F2B880');
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, r, 0, 7); c.fill();
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
