/* =====================================================================
 *  PARTICLES — GPU point-sprite burst pool (extracted from 70_game).
 *  Fixed ring buffer: spawn writes into preallocated typed arrays, the
 *  vertex buffer is re-uploaded with bufferSubData — no per-frame
 *  allocation, no GC pressure on the hot path. Used by Game for hit
 *  bursts, net/out flashes and celebration confetti.
 * ===================================================================== */

class Particles {
  constructor(max = 260) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max); this.col = new Float32Array(max * 3);
    this.grav = new Float32Array(max);
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, grav) {
    const i = this.n < this.max ? this.n++ : (Math.random() * this.max) | 0;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.grav[i] = grav === undefined ? 4 : grav;
  }
  burst(x, y, z, n, speed, life, size, r, g, b, dir) {
    for (let i = 0; i < n; i++) {
      let vx = rndSym(1), vy = rndSym(1), vz = rndSym(1);
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      if (dir) { vx = vx * 0.5 + dir.x; vy = vy * 0.5 + dir.y; vz = vz * 0.5 + dir.z; }
      const s = speed * rnd(0.35, 1);
      this.spawn(x, y, z, vx * s, vy * s, vz * s, life * rnd(0.6, 1.2), size * rnd(0.6, 1.3), r, g, b);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.v[i * 3 + 1] -= this.grav[i] * dt;
      this.v[i * 3] *= 1 - 2.2 * dt; this.v[i * 3 + 2] *= 1 - 2.2 * dt;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
    }
  }
}
