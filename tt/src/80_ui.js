/* =====================================================================
 *  UI — HUD, menus, the 2D coaching layer.
 *
 *  Design rule for this file: the screen must never explain with text what
 *  it can show with a shape. One transient badge, one score, and the
 *  strike ring drawn straight onto the ball.
 * ===================================================================== */
'use strict';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

class UI {
  constructor() {
    this.game = null;
    this.fx = $('#fx');
    this.fxg = this.fx.getContext('2d');
    this.shotTimer = 0;
    this.noteTimer = 0;
    this.ripples = [];
    this.ghostT = 0;
    this._pv = {};
    this.bindMenu();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  attach(game) { this.game = game; this.syncSettings(); }

  resize() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    this.fx.width = Math.floor(window.innerWidth * d);
    this.fx.height = Math.floor(window.innerHeight * d);
    this.fx.style.width = window.innerWidth + 'px';
    this.fx.style.height = window.innerHeight + 'px';
    this.dpr = d;
  }

  /* ------------------------------ menu ---------------------------- */
  bindMenu() {
    $$('#menu .opt[data-diff]').forEach((b) => b.addEventListener('click', () => {
      $$('#menu .opt[data-diff]').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      this.pendingDiff = +b.dataset.diff;
      if (this.game) this.game.audio.ui('click');
    }));
    $$('.opt[data-set]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.set, v = b.dataset.val;
      $$(`.opt[data-set="${k}"]`).forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      this.applySetting(k, v);
    }));
    $$('input[type=range][data-set]').forEach((r) => r.addEventListener('input', () => {
      this.applySetting(r.dataset.set, +r.value);
    }));
    const startMatch = () => {
      const d = this.pendingDiff !== undefined ? this.pendingDiff : 2;
      $$('.screen').forEach((s) => s.classList.remove('on'));
      this.trainHide();
      this.game.training = null;
      this.game.startMatch(d);
    };
    const startTrain = () => {
      $$('.screen').forEach((s) => s.classList.remove('on'));
      this.game.startTraining();
    };
    $('#play').addEventListener('click', startMatch);
    $('#tdPlay').addEventListener('click', startMatch);
    $('#train0').addEventListener('click', startTrain);
    $('#tdAgain').addEventListener('click', startTrain);
    $('#trSkip').addEventListener('click', () => { const t = this.game.training; if (t) { t.skip(); this.game.audio.ui('click'); } });
    $('#trExit').addEventListener('click', () => {
      this.game.stopTraining();
      $('#menu').classList.add('on');
    });
    $('#btnSettings').addEventListener('click', () => $('#settings').classList.toggle('on'));
    $('#setClose').addEventListener('click', () => $('#settings').classList.remove('on'));
    $('#camReset').addEventListener('click', () => this.game.camReset());
    $('#btnMenu').addEventListener('click', () => { this.game.stopTraining(); $('#menu').classList.add('on'); });
    $('#btnSound').addEventListener('click', () => {
      const g = this.game; g.settings.sound = !g.settings.sound;
      g.audio.setMuted(!g.settings.sound);
      $('#btnSound').innerHTML = g.settings.sound ? ICON.sound : ICON.mute;
    });
    $('#again').addEventListener('click', () => { $('#over').classList.remove('on'); this.game.restart(); });
    $('#backMenu').addEventListener('click', () => { $('#over').classList.remove('on'); $('#menu').classList.add('on'); });
  }

  applySetting(k, v) {
    const g = this.game; if (!g) return;
    const s = g.settings;
    switch (k) {
      case 'assist': s.assist = v / 100; $('#vAssist').textContent = v + '%'; break;
      case 'posAssist': s.posAssist = v / 100; $('#vPos').textContent = v + '%'; break;
      case 'sens': s.sensitivity = v / 100; $('#vSens').textContent = (v / 100).toFixed(2) + '×'; break;
      case 'vol': s.volume = v / 100; g.audio.setVolume(v / 100); $('#vVol').textContent = v + '%'; break;
      case 'cam': s.camera = v; break;
      case 'quality': s.quality = v; g.R.quality = v; g.resize(); break;
      case 'hand': s.hand = v; break;
      case 'trail': s.showTrail = v === 'on'; break;
      case 'predict': s.showPredict = v === 'on'; break;
      case 'zone': s.showZone = v === 'on'; break;
      case 'tele': s.showTele = v === 'on'; $('#spin').classList.toggle('on', s.showTele); break;
      case 'coach': s.coach = v === 'on'; if (!s.coach) this.hideNote(); break;
      case 'adaptive':
        s.adaptive = v === 'on';
        if (g.director) { g.director.enabled = s.adaptive; if (!s.adaptive) { g.director.reset(); g.ai.setHandicap(1); } }
        break;
      case 'haptics': s.haptics = v === 'on'; if (s.haptics) g.buzz(12); break;
      case 'target': s.targetScore = +v; $('#toWin').textContent = v; break;
      case 'camYaw': g.camAdj.yaw = (-v) * Math.PI / 180; g.camAdjT = 1.2; this.syncCam(); return;
      case 'camPitch': g.camAdj.pitch = v * Math.PI / 180; g.camAdjT = 1.2; this.syncCam(); return;
      case 'camDist': g.camAdj.zoom = v / 100; g.camAdjT = 1.2; this.syncCam(); return;
    }
    g.audio.ui('click');
  }

  /** Keep the three camera sliders and the live orbit in step, whichever
   *  one the player actually touched. */
  syncCam() {
    const A = this.game.camAdj;
    const yaw = Math.round(-A.yaw * 180 / Math.PI);
    const pit = Math.round(A.pitch * 180 / Math.PI);
    const dst = Math.round(A.zoom * 100);
    const set = (id, vid, val, txt) => {
      const el = $(id); if (!el) return;
      if (document.activeElement !== el) el.value = val;
      $(vid).textContent = txt;
    };
    set('#rYaw', '#vYaw', yaw, (yaw > 0 ? '+' : '') + yaw + '°');
    set('#rPitch', '#vPitch', pit, (pit > 0 ? '+' : '') + pit + '°');
    set('#rDist', '#vDist', dst, dst + '%');
  }

  syncSettings() {
    const s = this.game.settings;
    const sel = (k, v) => $$(`.opt[data-set="${k}"]`).forEach((x) => x.classList.toggle('sel', x.dataset.val == v));
    sel('cam', s.camera); sel('quality', s.quality); sel('hand', s.hand);
    sel('trail', s.showTrail ? 'on' : 'off'); sel('predict', s.showPredict ? 'on' : 'off');
    sel('zone', s.showZone ? 'on' : 'off'); sel('tele', s.showTele ? 'on' : 'off');
    sel('coach', s.coach ? 'on' : 'off'); sel('adaptive', s.adaptive ? 'on' : 'off');
    sel('haptics', s.haptics ? 'on' : 'off');
    sel('target', s.targetScore);
    $('#spin').classList.toggle('on', !!s.showTele);
    $('#toWin').textContent = s.targetScore;
    $('#rAssist').value = Math.round(s.assist * 100); $('#vAssist').textContent = Math.round(s.assist * 100) + '%';
    $('#rPos').value = Math.round(s.posAssist * 100); $('#vPos').textContent = Math.round(s.posAssist * 100) + '%';
    $('#rSens').value = Math.round(s.sensitivity * 100); $('#vSens').textContent = s.sensitivity.toFixed(2) + '×';
    $('#rVol').value = Math.round(s.volume * 100); $('#vVol').textContent = Math.round(s.volume * 100) + '%';
    this.syncCam();
  }

  /* ------------------------------ HUD ----------------------------- */
  syncScore() {
    const g = this.game;
    const a = $('#ptsA'), b = $('#ptsB');
    if (a.textContent != g.score[0]) { a.textContent = g.score[0]; a.classList.add('bump'); setTimeout(() => a.classList.remove('bump'), 220); }
    if (b.textContent != g.score[1]) { b.textContent = g.score[1]; b.classList.add('bump'); setTimeout(() => b.classList.remove('bump'), 220); }
    $('#servA').classList.toggle('on', g.server === 1);
    $('#servB').classList.toggle('on', g.server === -1);
    $('#oppName').textContent = g.ai.L.name;
    // deuce / match point indicator in the middle
    const T = g.settings.targetScore;
    const mid = $('.sb-mid');
    const s0 = g.score[0], s1 = g.score[1];
    const deuce = s0 >= T - 1 && s1 >= T - 1 && s0 === s1;
    if (deuce) { mid.querySelector('b').textContent = 'РАВНО'; mid.querySelector('span').textContent = 'ДЕЦ'; }
    else { mid.querySelector('b').textContent = 'ДО'; mid.querySelector('span').textContent = T; }
  }

  showShot(info) {
    const el = $('#shot');
    el.classList.add('on');
    this.shotTimer = 1.5;
    const n = $('#shotName');
    n.textContent = info.stroke.short || info.stroke.name;
    n.style.color = info.stroke.col;
    $('#shotMeta').textContent = `${info.speed.toFixed(0)} км/ч · ${info.spin.toFixed(0)} об/с`;
  }
  showAiShot() { /* the opponent's choice is readable from the ball itself */ }

  /** One sentence about the point that just ended. A coach does not
   *  recite statistics at you, he tells you the single thing you got
   *  wrong — so this shows exactly one line and then gets out of the way. */
  showNote(note) {
    if (!note || !this.game || !this.game.settings.coach) return;
    const el = $('#note');
    el.querySelector('span').textContent = note.text;
    el.querySelector('i').style.background = note.col || 'var(--acc)';
    el.classList.add('on');
    this.noteTimer = note.text.length > 58 ? 3.4 : 2.6;
  }

  hideNote() { this.noteTimer = 0; const el = $('#note'); el && el.classList.remove('on'); }

  /* --------------------------- coach panel ------------------------ */
  trainShow() { $('#train').classList.add('on'); $('#score').style.opacity = '0'; }
  trainHide() { $('#train').classList.remove('on'); $('#score').style.opacity = ''; $('#tdone').classList.remove('on'); }
  trainSync(t) {
    const S = t.S;
    $('#trStep').textContent = (t.step + 1) + ' / ' + TRAIN_STEPS.length;
    $('#trTitle').textContent = S.title;
    $('#trTip').textContent = S.tip;
    $('#trWhy').textContent = S.why;
    const m = $('#trMsg');
    m.textContent = t.msg || '';
    m.style.color = t.msgCol || 'var(--good)';
    let pips = '';
    for (let i = 0; i < S.need; i++) pips += `<i class="${i < t.done ? 'on' : ''}"></i>`;
    $('#trPips').innerHTML = pips;
  }
  trainDone() { $('#train').classList.remove('on'); $('#tdone').classList.add('on'); }

  showMatchEnd(won) {
    const g = this.game, s = g.stats;
    $('#overTitle').textContent = won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
    $('#overTitle').style.color = won ? 'var(--good)' : 'var(--bad)';
    $('#overScore').textContent = g.score[0] + ' : ' + g.score[1];
    const avgSpin = s.shots ? (s.totalSpin / s.shots) : 0;
    $('#stShots').textContent = s.shots;
    $('#stMaxSpeed').textContent = s.maxSpeed.toFixed(0) + ' км/ч';
    $('#stMaxSpin').textContent = s.maxSpin.toFixed(0) + ' об/с';
    $('#stAvgSpin').textContent = avgSpin.toFixed(0) + ' об/с';
    $('#stRally').textContent = g.bestRally;
    const top = Object.entries(s.byStroke).sort((a, b) => b[1] - a[1])[0];
    $('#stFav').textContent = top ? (STROKES[top[0]] ? STROKES[top[0]].short : top[0]) + ' ×' + top[1] : '—';
    $('#over').classList.add('on');
  }

  /* ==================================================================
   *  2D coaching layer
   * ================================================================== */

  /** The strike ring: a circle that closes onto the ball and flashes
   *  white at the exact moment the swipe should leave your finger. */
  drawStrikeRing(c, W, H, d) {
    const g = this.game;
    const w = g._strike;
    if (!w || !w.on || w.k < 0.02) return;
    if (!g.settings.showZone) return;
    const p = g.project({ x: w.x, y: w.y, z: w.z }, this._pv);
    if (!p.ok) return;
    const x = p.x * W, y = p.y * H;
    const r0 = 15 * d;                       // closed radius
    const tt = clamp(w.t, 0, 0.85);
    const R = r0 + tt * 150 * d;
    const hot = w.ready;                     // 0..1 — inside the window
    const a = w.k * (0.30 + 0.60 * hot);
    const col = hot > 0.82 ? [255, 236, 140] : hot > 0.4 ? [120, 222, 255] : [110, 150, 190];
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    c.lineWidth = (1.6 + 2.0 * hot) * d;
    c.beginPath(); c.arc(x, y, R, 0, TAU); c.stroke();
    // the fixed target ring you are closing onto
    c.globalAlpha = a * 0.55;
    c.lineWidth = 1.2 * d;
    c.setLineDash([5 * d, 6 * d]);
    c.beginPath(); c.arc(x, y, r0, 0, TAU); c.stroke();
    c.setLineDash([]);
    if (hot > 0.82) {
      const txt = w.kind === 'serve' ? 'СВАЙП ВВЕРХ' : 'БЕЙ!';
      c.globalAlpha = w.k * (0.70 + 0.30 * Math.sin(g.time * 26));
      c.font = `900 ${14 * d}px ${CSSFONT}`;
      c.textAlign = 'center';
      c.lineWidth = 4 * d; c.strokeStyle = 'rgba(3,7,13,.85)'; c.lineJoin = 'round';
      c.strokeText(txt, x, y - R - 14 * d);
      c.fillStyle = '#ffe98a';
      c.fillText(txt, x, y - R - 14 * d);
    }
    c.restore();
  }

  /** The ghost gesture: an animated finger path drawn where the player's
   *  hand actually has to move. Worth a thousand words of cheat-sheet.
   *  Everything is stroked twice — dark outline first — so it stays legible
   *  over the bright table as well as over the dark floor. */
  drawGhost(c, W, H, d, pts, speed, col) {
    const CYCLE = 2.0;
    const T = (this.ghostT * speed) % CYCLE;
    const play = clamp(T / 0.95, 0, 1);
    const fade = T > 1.40 ? clamp((CYCLE - T) / 0.42, 0, 1) : clamp(T / 0.12, 0, 1);
    if (fade <= 0.01) return;

    let P = pts.map((q) => [q[0] * W, q[1] * H]);
    if (P.length > 2) {                       // Catmull-Rom: no dog-legs
      const sm = [];
      for (let i = 0; i < P.length - 1; i++) {
        const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
        for (let k = 0; k < 12; k++) {
          const t = k / 12, t2 = t * t, t3 = t2 * t;
          sm.push([
            0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
            0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
          ]);
        }
      }
      sm.push(P[P.length - 1]);
      P = sm;
    }
    const seg = [];
    let total = 0;
    for (let i = 1; i < P.length; i++) {
      const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      seg.push(l); total += l;
    }
    const at = (u) => {
      let want = u * total, i = 0;
      while (i < seg.length - 1 && want > seg[i]) { want -= seg[i]; i++; }
      const f = seg[i] ? clamp(want / seg[i], 0, 1) : 0;
      return [lerp(P[i][0], P[i + 1][0], f), lerp(P[i][1], P[i + 1][1], f)];
    };
    const trace = () => {
      c.beginPath();
      for (let i = 0; i <= 48; i++) { const q = at(i / 48); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
    };

    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';

    // 1. the whole route: dark halo + dashed bright line
    c.globalAlpha = 0.38 * fade; c.strokeStyle = '#040a12'; c.lineWidth = 11 * d;
    trace(); c.stroke();
    c.globalAlpha = 0.50 * fade; c.strokeStyle = col; c.lineWidth = 3.4 * d;
    c.setLineDash([9 * d, 9 * d]); trace(); c.stroke(); c.setLineDash([]);

    // 2. the part the finger has already covered, solid and bright
    c.globalAlpha = 0.95 * fade; c.strokeStyle = col; c.lineWidth = 6 * d;
    c.beginPath();
    const n = Math.max(2, Math.round(play * 40));
    for (let i = 0; i < n; i++) { const q = at((i / (n - 1)) * play); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
    c.stroke();

    // 3. the finger
    const h = at(play), hb = at(Math.max(0, play - 0.07));
    c.globalAlpha = fade;
    const rg = c.createRadialGradient(h[0], h[1], 0, h[0], h[1], 30 * d);
    rg.addColorStop(0, 'rgba(255,255,255,.95)');
    rg.addColorStop(0.3, col + 'cc'); rg.addColorStop(1, col + '00');
    c.fillStyle = rg; c.beginPath(); c.arc(h[0], h[1], 30 * d, 0, TAU); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(h[0], h[1], 7 * d, 0, TAU); c.fill();

    // 4. arrow head pointing the way out, at the end of the route
    const e = at(1), eb = at(0.86);
    const ang = Math.atan2(e[1] - eb[1], e[0] - eb[0]);
    const ah = 16 * d;
    const tip = [e[0] + Math.cos(ang) * ah * 0.5, e[1] + Math.sin(ang) * ah * 0.5];
    c.globalAlpha = fade * (0.45 + 0.45 * play);
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(tip[0], tip[1]);
    c.lineTo(tip[0] - Math.cos(ang - 0.42) * ah, tip[1] - Math.sin(ang - 0.42) * ah);
    c.lineTo(tip[0] - Math.cos(ang + 0.42) * ah, tip[1] - Math.sin(ang + 0.42) * ah);
    c.closePath(); c.fill();

    // 5. where the finger starts
    const s0 = at(0);
    c.globalAlpha = fade * 0.75; c.strokeStyle = col; c.lineWidth = 2.4 * d;
    c.beginPath(); c.arc(s0[0], s0[1], 15 * d, 0, TAU); c.stroke();
    c.globalAlpha = fade * 0.30; c.fillStyle = col;
    c.beginPath(); c.arc(s0[0], s0[1], 15 * d, 0, TAU); c.fill();
    c.restore();
  }

  drawOverlay(dt) {
    const g = this.game, c = this.fxg, W = this.fx.width, H = this.fx.height, d = this.dpr;
    c.clearRect(0, 0, W, H);
    if (!g) return;
    this.ghostT += dt;

    this.drawStrikeRing(c, W, H, d);

    // coach's ghost gesture, only while the drill is waiting for you
    const tr = g.training;
    if (tr && tr.phase !== 'done') {
      const S = tr.S;
      const show = tr.phase === 'intro' || tr.phase === 'wait' ||
        (tr.phase === 'live' && !(g.swipe && g.swipe.active));
      if (show && S.gesture) this.drawGhost(c, W, H, d, S.gesture, S.speed || 1, '#39c6ff');
    }

    // live swipe ribbon
    const sw = g.swipe;
    if (sw.active && sw.samples.length > 1) {
      const pts = sw.samples;
      const n = pts.length;
      c.lineCap = 'round'; c.lineJoin = 'round';
      const st = g.liveStroke;
      const col = st ? st.stroke.col : '#39c6ff';
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        c.strokeStyle = col;
        c.globalAlpha = 0.07 + t * 0.5;
        c.lineWidth = (1.5 + t * 11) * d;
        c.beginPath();
        c.moveTo(pts[i - 1].x * W, pts[i - 1].y * H);
        c.lineTo(pts[i].x * W, pts[i].y * H);
        c.stroke();
      }
      c.globalAlpha = 1;
      const hx = pts[n - 1].x * W, hy = pts[n - 1].y * H;
      const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 34 * d);
      rg.addColorStop(0, col + 'cc'); rg.addColorStop(1, col + '00');
      c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 34 * d, 0, TAU); c.fill();

      // the one label that matters: which shot this gesture is becoming
      if (st && sw.m.dist > 0.045) {
        c.font = `800 ${12.5 * d}px ${CSSFONT}`;
        c.textAlign = 'center';
        c.fillStyle = col;
        c.globalAlpha = 0.95;
        c.fillText(st.stroke.short || st.stroke.name, hx, hy - 34 * d);
        c.globalAlpha = 1;
      }
    }

    // contact ripples
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.t += dt;
      const a = 1 - r.t / r.life;
      if (a <= 0) { this.ripples.splice(i, 1); continue; }
      c.strokeStyle = r.col; c.globalAlpha = a * 0.7;
      c.lineWidth = 3 * d * a;
      c.beginPath(); c.arc(r.x * W, r.y * H, (12 + (1 - a) * 70) * d, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;

    // camera readout — only while you are actually moving the camera
    if (g.camAdjT > 0) {
      const A = g.camAdj;
      const a = clamp(g.camAdjT / 0.5, 0, 1) * 0.92;
      const yaw = Math.round(-A.yaw * 180 / Math.PI);
      const pit = Math.round(A.pitch * 180 / Math.PI);
      const txt = `${yaw > 0 ? '+' : ''}${yaw}°  ·  ${pit > 0 ? '+' : ''}${pit}°  ·  ${(A.zoom).toFixed(2)}×`;
      c.save();
      c.globalAlpha = a;
      c.font = `600 ${11.5 * d}px ui-monospace,Menlo,Consolas,monospace`;
      c.textAlign = 'center';
      const tw = c.measureText(txt).width + 26 * d;
      c.fillStyle = 'rgba(6,11,19,.74)';
      roundRect(c, W / 2 - tw / 2, H - 112 * d, tw, 26 * d, 13 * d);
      c.fill();
      c.strokeStyle = 'rgba(120,180,240,.22)'; c.lineWidth = 1 * d; c.stroke();
      c.fillStyle = '#bcd6f2';
      c.fillText(txt, W / 2, H - 94 * d);
      c.restore();
    }

    // match point
    if (!tr) {
      const T = g.settings.targetScore;
      const mp = (g.score[0] >= T - 1 && g.score[0] >= g.score[1] + 1) || (g.score[1] >= T - 1 && g.score[1] >= g.score[0] + 1);
      if (mp && (g.state === 'RALLY' || g.state === 'SERVE_READY' || g.state === 'SERVE_TOSS')) {
        c.font = `900 ${13 * d}px ${CSSFONT}`;
        c.textAlign = 'center';
        c.fillStyle = g.score[0] > g.score[1] ? 'rgba(78,227,154,.85)' : 'rgba(255,93,110,.85)';
        c.fillText(g.score[0] > g.score[1] ? 'МАТЧБОЛ' : 'МАТЧБОЛ СОПЕРНИКА', W / 2, 108 * d);
      }
    }
  }

  ripple(x, y, col) { this.ripples.push({ x, y, col, t: 0, life: 0.55 }); }

  /* ------------------------------ tick ----------------------------- */
  tick(dt) {
    const g = this.game; if (!g) return;
    this.drawOverlay(dt);

    const box = $('#msgs');
    if (g.messages.length !== this._nMsg || (g.messages[0] && g.messages[0].text !== this._m0)) {
      box.innerHTML = g.messages.map((m) =>
        `<div class="msg${m.big ? ' big' : ''}" style="color:${m.col}">${m.text}</div>`).join('');
      this._nMsg = g.messages.length;
      this._m0 = g.messages[0] ? g.messages[0].text : null;
    }

    const rb = $('#rally');
    const showRally = !g.training && g.rally > 2;
    rb.classList.toggle('on', showRally);
    if (showRally) rb.innerHTML = `РАЛЛИ <b>${g.rally}</b> · РЕКОРД <b>${Math.max(g.bestRally, g.rally)}</b>`;

    if (this.shotTimer > 0) { this.shotTimer -= dt; if (this.shotTimer <= 0) $('#shot').classList.remove('on'); }
    if (this.noteTimer > 0) { this.noteTimer -= dt; if (this.noteTimer <= 0) this.hideNote(); }

    if (g.training && g.training._uiStamp !== g.training.phase + g.training.done + g.training.step + g.training.msg) {
      g.training._uiStamp = g.training.phase + g.training.done + g.training.step + g.training.msg;
      this.trainSync(g.training);
    }

    if (g.settings.showTele) {
      const w = g.ball.w;
      const top = -w.x / TAU, side = w.y / TAU;
      const setG = (el, v, max, pc, nc) => {
        const f = clamp(v / max, -1, 1);
        if (f >= 0) { el.style.left = '50%'; el.style.right = (50 - f * 50) + '%'; el.style.background = pc; }
        else { el.style.right = '50%'; el.style.left = (50 + f * 50) + '%'; el.style.background = nc; }
      };
      setG($('#gTop'), top, 160, 'var(--acc2)', 'var(--acc)');
      setG($('#gSide'), side, 140, 'var(--good)', 'var(--good)');
      $('#gTopV').textContent = (top >= 0 ? '+' : '') + top.toFixed(0) + ' об/с';
      $('#gSideV').textContent = (side >= 0 ? '+' : '') + side.toFixed(0) + ' об/с';
      $('#ballKmh').textContent = (V3.len(g.ball.v) * 3.6).toFixed(0);
    }

    const dbg = $('#dbg');
    dbg.classList.toggle('on', g.settings.showDebug);
    if (g.settings.showDebug) {
      const b = g.ball, sp = V3.len(b.v), wl = V3.len(b.w);
      const Re = (sp * 2 * PH.R) / PH.NU;
      const S = PH.R * wl / Math.max(sp, 0.6);
      const a = aeroAccel(V3.new(), b.v, b.w);
      const magn = Math.hypot(a.x, a.y + PH.G, a.z) / PH.G;
      dbg.innerHTML =
        `<b>FPS</b> ${g.fps.toFixed(0)}  <b>DC</b> ${g.R.drawCalls}  <b>TRI</b> ${(g.R.tris / 1000).toFixed(1)}k\n` +
        `<b>GL</b> ${g.R.isGL2 ? 'WebGL2' : 'WebGL1'}\n` +
        `<b>state</b> ${g.state}  <b>ts</b> ${g.timeScale.toFixed(2)}\n` +
        `<b>ball</b> p(${b.p.x.toFixed(2)},${b.p.y.toFixed(2)},${b.p.z.toFixed(2)})\n` +
        `      v ${sp.toFixed(2)} m/s = ${(sp * 3.6).toFixed(0)} km/h\n` +
        `      w (${b.w.x.toFixed(0)},${b.w.y.toFixed(0)},${b.w.z.toFixed(0)}) = ${(wl / TAU).toFixed(0)} rev/s\n` +
        `<b>Re</b> ${(Re / 1000).toFixed(1)}k  <b>S</b> ${S.toFixed(2)}  <b>Magnus</b> ${magn.toFixed(2)} g\n` +
        `<b>paddle</b> v ${V3.len(g.player.vel).toFixed(2)} m/s\n` +
        `<b>swipe</b> sp ${g.swipe.m.speed.toFixed(2)} curl ${g.swipe.m.curl.toFixed(2)}\n` +
        `<b>assist</b> ${(g.settings.assist * 100) | 0}%  <b>pos</b> ${(g.settings.posAssist * 100) | 0}%`;
    }
  }
}

const CSSFONT = '"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif';

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const ICON = {
  sound: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  mute: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>',
  gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  menu: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
};
