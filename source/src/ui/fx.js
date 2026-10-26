/* =====================================================================
   FX — единый canvas-слой VFX поверх интерфейса:
   искры, кольца ударной волны, конфетти, звёздочки, полёт монет к кошельку,
   тряска камеры. Цикл крутится только пока есть частицы.
   ===================================================================== */
const FX = (() => {
  let cv, ctx, W = 0, H = 0, dpr = 1, running = false, q = 1;
  const P = [];
  const sprites = {};
  function sprite(name, svg, px = 64) {
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent((svg.includes('xmlns=') ? svg : svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')).replace(/width="\d+" height="\d+"/, `width="${px}" height="${px}"`));
    sprites[name] = img;
  }
  function init() {
    cv = $('#fx'); ctx = cv.getContext('2d');
    resize(); window.addEventListener('resize', resize);
    sprite('coin', Art.coin(64)); sprite('gem', Art.gem(64)); sprite('star', Art.star(64));
    setQuality(S.quality);
  }
  function resize() {
    const r = $('#device').getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr;
  }
  function setQuality(qq) { q = qq === 'low' ? .35 : qq === 'mid' ? .65 : 1; }
  const n = (k) => Math.max(1, Math.round(k * q));
  function pt(el) {
    const d = $('#device').getBoundingClientRect(); const r = el.getBoundingClientRect();
    return { x: r.left - d.left + r.width / 2, y: r.top - d.top + r.height / 2 };
  }
  function loop() {
    if (!P.length) { running = false; ctx.clearRect(0, 0, cv.width, cv.height); return; }
    running = true; requestAnimationFrame(loop);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const now = performance.now();
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; const t = (now - p.t0) / p.life;
      if (t >= 1) { P.splice(i, 1); p.done && p.done(); continue; }
      if (t < 0) continue;
      draw(p, t);
    }
  }
  function add(p) { p.t0 = p.t0 || performance.now(); P.push(p); if (!running) loop(); }

  function draw(p, t) {
    const k = p.kind;
    if (k === 'spark') {
      p.vx *= .94; p.vy = p.vy * .94 + p.g; p.x += p.vx; p.y += p.vy;
      const a = 1 - t; ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = p.c; ctx.globalAlpha = a; ctx.lineWidth = p.w * (1 - t * .6); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * p.len, p.y - p.vy * p.len); ctx.stroke();
    } else if (k === 'dot') {
      p.vx *= .96; p.vy = p.vy * .96 + p.g; p.x += p.vx; p.y += p.vy;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - t) * p.a;
      const r = p.r * (1 - t * .5); const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, '#fff'); g.addColorStop(.3, p.c); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
    } else if (k === 'ring') {
      const e = easeOut(t); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - t) * .9;
      ctx.strokeStyle = p.c; ctx.lineWidth = p.w * (1 - t) + .5;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, p.r0 + (p.r1 - p.r0) * e, (p.r0 + (p.r1 - p.r0) * e) * (p.sy || 1), 0, 0, 7); ctx.stroke();
    } else if (k === 'confetti') {
      p.vx *= .985; p.vy = p.vy * .985 + p.g; p.x += p.vx + Math.sin((performance.now() + p.ph) / 180) * .6; p.y += p.vy; p.rot += p.vr;
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = t > .8 ? (1 - t) * 5 : 1;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 2.3));
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    } else if (k === 'twinkle') {
      ctx.globalCompositeOperation = 'lighter'; const s = Math.sin(t * Math.PI) * p.r; ctx.globalAlpha = Math.sin(t * Math.PI);
      ctx.fillStyle = p.c; ctx.beginPath();
      ctx.moveTo(p.x, p.y - s); ctx.quadraticCurveTo(p.x, p.y, p.x + s, p.y); ctx.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
      ctx.quadraticCurveTo(p.x, p.y, p.x - s, p.y); ctx.quadraticCurveTo(p.x, p.y, p.x, p.y - s); ctx.fill();
    } else if (k === 'fly') {
      // фаза 1: разлёт, фаза 2: самонаведение по кривой Безье к цели
      const sp = sprites[p.sprite]; let x, y, s;
      const t1 = .28;
      if (t < t1) { const e = easeOut(t / t1); x = p.x0 + p.bx * e; y = p.y0 + p.by * e; s = .6 + .5 * e; }
      else {
        const u = easeInOut((t - t1) / (1 - t1)); const sx = p.x0 + p.bx, sy = p.y0 + p.by;
        const cx = (sx + p.tx) / 2 + p.cx, cy = Math.min(sy, p.ty) - 80 + p.cy;
        x = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * p.tx; y = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * p.ty; s = 1.1 - .45 * u;
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      const sz = p.size * s;
      if (sp && sp.complete && sp.naturalWidth) { ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t * 10 + p.ph) * .3); ctx.drawImage(sp, -sz / 2, -sz / 2, sz, sz); ctx.restore(); }
      if (Math.random() < .5 * q) add({ kind: 'dot', x, y, vx: 0, vy: 0, g: 0, r: 7, c: p.sprite === 'gem' ? '#2EE6FF' : '#FFC93A', a: .6, life: 300 });
    } else if (k === 'text') {
      const e = easeOutBack(Math.min(1, t * 3)); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = t > .7 ? (1 - t) / .3 : 1;
      ctx.save(); ctx.translate(p.x, p.y - t * 40); ctx.scale(e, e);
      ctx.font = `900 ${p.size}px Unb, Arial Black`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(p.s, 0, 0); ctx.fillStyle = p.c; ctx.fillText(p.s, 0, 0); ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- публичные эффекты ---------- */
  function burst(x, y, { c = ['#FFC93A', '#FF7A4D', '#fff'], count = 22, speed = 9, g = .12, ring = true, size = 1 } = {}) {
    for (let i = 0; i < n(count); i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (.4 + Math.random() * .8);
      add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g, c: pick(c), w: rnd(2, 3.4) * size, len: rnd(1.6, 3), life: rnd(380, 700) });
    }
    for (let i = 0; i < n(count / 2); i++) {
      const a = Math.random() * Math.PI * 2, s = speed * .5 * Math.random();
      add({ kind: 'dot', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: g * .5, r: rnd(6, 12) * size, c: pick(c), a: .8, life: rnd(400, 800) });
    }
    if (ring) { add({ kind: 'ring', x, y, r0: 6, r1: 70 * size, w: 6, c: c[0], life: 520 }); add({ kind: 'ring', x, y, r0: 4, r1: 44 * size, w: 3, c: '#fff', life: 380 }); }
  }
  function twinkles(x, y, r = 60, count = 10, c = '#FFF6C8') {
    for (let i = 0; i < n(count); i++) add({ kind: 'twinkle', x: x + rnd(-r, r), y: y + rnd(-r, r), r: rnd(5, 11), c, life: rnd(500, 900), t0: performance.now() + rnd(0, 600) });
  }
  function confetti(x, y, count = 90, spread = 1) {
    const cols = ['#FF4B3E', '#FFC93A', '#2EE6FF', '#3BF5A0', '#9F6BFF', '#fff', '#FF7AD9'];
    for (let i = 0; i < n(count); i++) {
      const a = -Math.PI / 2 + rnd(-1.2, 1.2) * spread, s = rnd(6, 15);
      add({ kind: 'confetti', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: .22, c: pick(cols), w: rnd(6, 10), h: rnd(10, 16), rot: rnd(0, 6), vr: rnd(-.25, .25), ph: rnd(0, 1000), life: rnd(1800, 2800) });
    }
  }
  function rain(count = 80) { for (let i = 0; i < n(count); i++) add({ kind: 'confetti', x: rnd(0, W), y: rnd(-120, -10), vx: rnd(-1, 1), vy: rnd(2, 5), g: .05, c: pick(['#FFC93A', '#FFF6C8', '#FF9A1A', '#fff']), w: rnd(5, 9), h: rnd(9, 14), rot: rnd(0, 6), vr: rnd(-.2, .2), ph: rnd(0, 1000), life: rnd(2400, 3400), t0: performance.now() + rnd(0, 900) }); }
  function ring(x, y, c = '#2EE6FF', r1 = 80, w = 6, sy = 1) { add({ kind: 'ring', x, y, r0: 4, r1, w, c, sy, life: 500 }); }
  function text(x, y, s, c = '#FFC93A', size = 22) { add({ kind: 'text', x, y, s, c, size, life: 1100 }); }

  /* полёт монет/гемов: возвращает промис, onHit на каждую долетевшую */
  function fly(from, to, { sprite = 'coin', count = 10, size = 30, onHit, stagger = 45 } = {}) {
    return new Promise((res) => {
      const N = Math.max(3, n(count)); let hit = 0;
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, r = rnd(20, 70);
        add({
          kind: 'fly', sprite, x0: from.x, y0: from.y, bx: Math.cos(a) * r, by: Math.sin(a) * r - 20, tx: to.x, ty: to.y, cx: rnd(-60, 60), cy: rnd(-40, 20),
          size, ph: rnd(0, 6), life: rnd(820, 1000), t0: performance.now() + i * stagger,
          done: () => { hit++; onHit && onHit(hit, N); if (hit === N) res(); }
        });
      }
    });
  }

  /* тряска: двигаем слой экранов, затухающе */
  let shakeT = 0, shakeA = 0, shakeD = 1, shaking = false;
  function shake(amp = 10, dur = 400) {
    if (S.rm) return; shakeA = Math.max(shakeA, amp); shakeD = dur; shakeT = performance.now();
    if (!shaking) { shaking = true; requestAnimationFrame(sh); }
  }
  function sh(now) {
    const el = $('#screens'); const t = (now - shakeT) / shakeD;
    if (t >= 1) { el.style.transform = ''; shaking = false; shakeA = 0; return; }
    const a = shakeA * Math.pow(1 - t, 2);
    el.style.transform = `translate(${rnd(-a, a)}px,${rnd(-a, a)}px) rotate(${rnd(-a, a) * .04}deg)`;
    requestAnimationFrame(sh);
  }
  return { init, resize, burst, twinkles, confetti, rain, ring, text, fly, shake, pt, setQuality, get W() { return W; }, get H() { return H; } };
})();
