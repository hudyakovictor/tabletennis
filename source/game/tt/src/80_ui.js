/* Canvas feedback and host integration hooks. Screens belong to the shell. */
'use strict';

const CSSFONT = '"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif';

class UI {
  constructor() {
    this.game = null;
    this.fx = document.getElementById('fx');
    this.fxg = this.fx.getContext('2d');
    this.hitLabels = [];
    this._labelShotId = -1;
    this.ripples = [];
    this.captureDebug = false;
    this._pv = {};
    this._lastRibbon = null;
    this.motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = !!(this.motionQuery && this.motionQuery.matches);
    if (this.motionQuery) {
      const onMotionPreference = (event) => {
        this.reducedMotion = !!(event.matches || this.game && this.game.motionOff);
        if (this.reducedMotion) this._lastRibbon = null;
      };
      if (this.motionQuery.addEventListener) this.motionQuery.addEventListener('change', onMotionPreference);
      else if (this.motionQuery.addListener) this.motionQuery.addListener(onMotionPreference);
    }
    this.inputMode = detectInputMode();
    this.hasFinePointer = this.inputMode === 'mouse';
    // Camera drags must not switch a touch session back to mouse controls.
    document.addEventListener('pointerdown', e => {
      if (e.button === 0) this.setInputMode(e.pointerType);
    }, { capture: true, passive: true });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  attach(game) {
    this.game = game;
    this.reducedMotion = !!(game.reducedMotion || this.motionQuery && this.motionQuery.matches);
    this.localize();
  }

  setInputMode(pointerType) {
    const mode = pointerType === 'touch' || pointerType === 'pen' ? 'touch' : pointerType === 'mouse' ? 'mouse' : null;
    if (!mode || mode === this.inputMode) return;
    this.inputMode = mode;
    this.hasFinePointer = mode === 'mouse';
    this.updateInputCopy();
  }

  localize() {
    document.documentElement.lang = ET.lang();
    const app = document.getElementById('app');
    if (app) app.setAttribute('aria-label', ET('Игровая сцена'));
    this.updateInputCopy();
  }

  updateInputCopy() {
    const g = this.game;
    if (!g) return;
    g.canvas.setAttribute('aria-label', ET(this.inputMode === 'touch'
      ? 'Игровое поле. Короткий тап отбивает мяч, свайп задаёт направление и вращение. Камера в настройках.'
      : 'Игровое поле. Короткий клик отбивает мяч, движение с ЛКМ задаёт направление и вращение. Камера: 1, 2, 3 или настройки.'));
    if (g.training) this.trainSync(g.training);
  }

  // The embed bridge replaces or wraps these hooks; none owns screen DOM or storage.
  trainShow() {}
  trainSync() {}
  trainDone() {}
  trainHide() {}
  trainProgress() {}
  showMatchEnd() {}
  showNote() {}
  showAiShot() {}
  syncScore() {}
  syncMatchHud() {}
  flashMoment() {}
  replayShow() {}
  refreshMenuBits() {}
  syncSettings() {}
  syncCameraControls() {}

  resize() {
    const d = Math.min(window.devicePixelRatio || 1, 2);
    this.fx.width = Math.floor(window.innerWidth * d);
    this.fx.height = Math.floor(window.innerHeight * d);
    this.fx.style.width = window.innerWidth + 'px';
    this.fx.style.height = window.innerHeight + 'px';
    this.dpr = d;
  }

  usesMatchHud() {
    const g = this.game;
    return !!(g && typeof g.getMatchSnapshot === 'function' && !g.training && !g.preview?.active &&
      !g.lobbyScene?.active && !g.network?.isInMatch && g.sessionKind !== 'online' &&
      [GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY, GS.POINT, GS.MATCH_END].includes(g.state));
  }

  clearShotFeedback() { this.hitLabels.length = 0; this._labelShotId = -1; }

  showShot(info, now = performance.now() / 1000) {
    const g = this.game, stroke = info && info.stroke;
    if (this.usesMatchHud()) { this.clearShotFeedback(); return false; }
    const point = info && shotVec(info.contactPoint), velocity = info && shotVec(info.v), spin = info && shotVec(info.w);
    if (!g || g.demoMode || g.preview?.active || !info || info.side !== 1 || !stroke || !STROKES[stroke.id] ||
        !point || !velocity || !spin || !Number.isFinite(info.shotId) || info.shotId <= this._labelShotId) return false;
    this.syncShotFeedback(now);
    this._labelShotId = info.shotId;
    const name = { SERVE_TOP: 'TOPSPIN SERVE', SERVE_BACK: 'BACKSPIN SERVE', SERVE_SIDE: 'SIDE SERVE',
      SERVE_FAST: 'FAST SERVE', SERVE_NO_SPIN: 'NO-SPIN SERVE', CHOP_BLOCK: 'CHOP BLOCK' }[stroke.id] || stroke.id;
    for (const label of this.hitLabels) label.until = Math.min(label.until, now + .3);
    this.hitLabels.push({ shotId: info.shotId, name, color: STROKES[stroke.id].col, point,
      rps: Math.round(measureShotSpin(spin, velocity).totalRps), at: now, until: now + 1.5 });
    if (this.hitLabels.length > 2) this.hitLabels.shift();
    return true;
  }

  syncShotFeedback(now = performance.now() / 1000) {
    for (let i = this.hitLabels.length - 1; i >= 0; i--)
      if (now >= this.hitLabels[i].until) this.hitLabels.splice(i, 1);
  }

  drawShotLabels(c, W, H, d, now = performance.now() / 1000) {
    if (this.usesMatchHud()) { this.clearShotFeedback(); return; }
    this.syncShotFeedback(now);
    const g = this.game;
    if (!this.hitLabels.length || !g || g.paused || g.demoMode || g.preview?.active || [GS.MENU, GS.MATCH_END].includes(g.state)) return;
    const margin = 12 * d;
    const font = clamp(W / d * .06, 20, 30) * d, unit = ET.lang() === 'en' ? 'rps' : 'об/с';
    c.save(); c.textAlign = 'left'; c.textBaseline = 'bottom'; c.lineJoin = 'round';
    for (const label of this.hitLabels) {
      const p = g.project(label.point, this._shotProjection || (this._shotProjection = {}));
      if (!p || !p.ok || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const pop = g.reducedMotion || this.reducedMotion ? 1 : 1 + .08 * Math.max(0, 1 - (now - label.at) / .16);
      c.font = '800 ' + font * pop + 'px sans-serif';
      const text = label.name + ' ' + label.rps + ' ' + unit, width = c.measureText(text).width, height = font * pop;
      const x = clamp(p.x * W - width / 2, margin, Math.max(margin, W - width - margin));
      const y = clamp(p.y * H - 30 * d, height + margin, Math.max(height + margin, H - margin));
      c.globalAlpha = clamp((label.until - now) / .55, 0, 1);
      c.lineWidth = 2.5 * d; c.strokeStyle = '#080c14'; c.fillStyle = label.color;
      c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = 4 * d;
      c.strokeText(text, x, y); c.fillText(text, x, y);
    }
    c.restore();
  }

  coachCueNow() {
    const g = this.game;
    if (!g || g.paused || (g.replayer && g.replayer.on)) return null;
    if (g.training) return typeof g.training.coachCue === 'function' ? g.training.coachCue() : null;
    // Match timing is communicated by the ball, not an extra capture marker.
    return null;
  }

  coachRadius(p, x, W, serve) {
    const g = this.game, d = this.dpr;
    const calK = (g._cal && Number.isFinite(g._cal.hintRadius)) ? lerp(0.25, 1.50, clamp(g._cal.hintRadius, 0, 1)) : 1;
    if (serve) return 30 * d * calK;
    const q = g.project({ x: p.x + MATCH_RULES.captureRadius, y: p.y, z: p.z }, {});
    const r = q && q.ok ? Math.abs(q.x * W - x) : 40 * d;
    return clamp(r, 22 * d, W * 0.16) * calK;
  }

  drawAimTarget(c, W, H, d, side, now, zone) {
    const g = this.game, y = PH.TABLE_Y + 0.002;
    const xs = zone ? [zone.x0, zone.x1] : side === 0 ? [-0.28, 0.28] : side > 0 ? [0.04, PH.T_HALF_WID] : [-PH.T_HALF_WID, -0.04];
    const zs = zone ? [zone.z0, zone.z1] : [-PH.T_HALF_LEN, -.06];
    const pts = [[xs[0], zs[0]], [xs[1], zs[0]], [xs[1], zs[1]], [xs[0], zs[1]]]
      .map(([x, z]) => g.project({ x, y, z }, {}));
    if (pts.some((q) => !q || !q.ok)) return;
    const a = this.reducedMotion ? .25 : 0.20 + 0.10 * Math.sin(now * 5);
    c.save();
    c.beginPath(); pts.forEach((q, i) => (i ? c.lineTo(q.x * W, q.y * H) : c.moveTo(q.x * W, q.y * H))); c.closePath();
    c.fillStyle = `rgba(53,198,244,${a})`; c.fill();
    c.lineWidth = 2 * d; c.strokeStyle = 'rgba(125,243,255,.9)'; c.shadowColor = '#35C6F4'; c.shadowBlur = 14 * d; c.stroke();
    c.restore();
  }

  drawCoach(c, W, H, d) {
    const g = this.game, now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    const glowK = (g._cal && Number.isFinite(g._cal.hintGlow))
      ? lerp(0.30, 1.15, clamp(g._cal.hintGlow, 0, 1)) : 1;
    const greenNow = !!(g._strike && g._strike.on && g._strike.contactable);
    const cue = this.coachCueNow();
    if (!cue) return false;
    if (cue.kind === 'aim') { this.drawAimTarget(c, W, H, d, cue.side || 0, now, cue.zone); return true; }
    const p = g.project(cue.p, {});
    if (!p || !p.ok || !Number.isFinite(p.x)) return false;
    let x = p.x * W, y = p.y * H;
    const r = this.coachRadius(cue.p, x, W, cue.serve || cue.kind === 'tap');
    if (!cue.frozen && cue.kind === 'contact') {
      const mx = ((MATCH_RULES.contactEdgePx || 20) + 24) * d, my = 96 * d;
      x = clamp(x, mx, W - mx); y = clamp(y, my, H - my);
    }
    if (cue.zone) this.drawAimTarget(c, W, H, d, cue.aim || 0, now, cue.zone);
    if (cue.nudge > 0) x += Math.sin(now * 70) * 7 * d * Math.min(1, cue.nudge * 2);
    c.save();
    if (cue.frozen) {
      // Frozen training isolates the contact window without moving the marker.
      c.fillStyle = 'rgba(3,6,14,.62)'; c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'destination-out';
      const hole = c.createRadialGradient(x, y, r * 1.2, x, y, r * 3.4);
      hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = hole; c.beginPath(); c.arc(x, y, r * 3.4, 0, TAU); c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    const alpha = Math.min(1, (cue.subtle ? 0.75 : 1) *
      (cue.fade !== undefined ? cue.fade : 1) *
      (cue._holdAge !== undefined ? Math.max(.25, 1 - cue._holdAge / .24) : 1) * glowK);
    c.globalAlpha = alpha;
    if (cue.kind === 'tap') {
      c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2.5 * d;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
      c.restore(); return true;
    }
    if ((cue.level === 'approach' || cue.level === 'freeze') && !cue.frozen && cue.t > 0) {
      const k = clamp((cue.t - 0.06) / 0.55, 0, 1);
      c.strokeStyle = cue.subtle ? 'rgba(255,255,255,.45)' : 'rgba(255,230,153,.8)';
      c.lineWidth = (cue.subtle ? 1.5 : 2.5) * d;
      c.beginPath(); c.arc(x, y, r * (1 + 2.4 * k), 0, TAU); c.stroke();
    }
    const pulse = cue.frozen && !this.reducedMotion ? 1 + 0.07 * Math.sin(now * 7) : 1;
    const heat = cue.frozen ? 0 : clamp(1 - (cue.t !== undefined ? cue.t : 1) / .35, 0, 1);
    c.shadowColor = cue.frozen ? '#FFD54A' : heat > .6 ? '#FFE699' : '#35C6F4';
    c.shadowBlur = (cue.subtle ? 4 : 10) * d * (0.7 + heat * .6);
    c.strokeStyle = heat > .75 ? '#FFE699' : heat > .4 ? '#F3EDD8' : 'rgba(255,255,255,.95)';
    c.lineWidth = ((cue.subtle ? 2 : 3) + heat * 1.6) * d;
    c.beginPath(); c.arc(x, y, r * pulse, 0, TAU); c.stroke();
    c.shadowBlur = 0;
    const dotR = (3.2 + heat * 3.4) * d;
    c.beginPath(); c.arc(x, y, dotR, 0, TAU);
    c.fillStyle = greenNow ? 'rgba(140,255,158,.95)' : 'rgba(255,213,74,.95)';
    c.fill(); c.shadowBlur = 0;
    c.lineWidth = 1.6 * d; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke();
    c.restore();
    if (cue.frozen && cue.gesture && cue.gesture.kind !== 'tap') {
      const points = cue.gesture.points, pad = 24 * d;
      let scale = 1;
      for (const point of points) {
        if (point[0] < 0) scale = Math.min(scale, (x - pad) / (-point[0] * W));
        if (point[0] > 0) scale = Math.min(scale, (W - x - pad) / (point[0] * W));
        if (point[1] < 0) scale = Math.min(scale, (y - 96 * d) / (-point[1] * H));
        if (point[1] > 0) scale = Math.min(scale, (H - y - pad) / (point[1] * H));
      }
      if (scale > .25) {
        const ps = points.map(p => [x + p[0] * W * scale, y + p[1] * H * scale]), start = ps[0], end = ps[ps.length - 1], before = ps[ps.length - 2];
        const angle = Math.atan2(end[1] - before[1], end[0] - before[0]);
        c.save(); c.lineCap = 'round'; c.lineWidth = 3 * d; c.strokeStyle = '#9cffd0'; c.fillStyle = '#9cffd0';
        c.beginPath(); ps.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.stroke();
        c.beginPath(); c.moveTo(end[0], end[1]);
        c.lineTo(end[0] - Math.cos(angle - .5) * 12 * d, end[1] - Math.sin(angle - .5) * 12 * d);
        c.lineTo(end[0] - Math.cos(angle + .5) * 12 * d, end[1] - Math.sin(angle + .5) * 12 * d); c.closePath(); c.fill();
        c.beginPath(); c.arc(start[0], start[1], 12 * d, 0, TAU); c.fill();
        c.font = `800 ${12 * d}px ${CSSFONT}`; c.textAlign = 'center'; c.fillStyle = '#080f21'; c.fillText('1', start[0], start[1] + 4 * d);
        c.restore();
      }
    }
    return true;
  }

  // Timing brackets belong to the ball; they are not a capture radius.
  drawStrikeRing(c, W, H, d) {
    const g = this.game;
    if (g.paused || (g.replayer && g.replayer.on)) return;
    const cue = strikeCueModel(g._strike);
    if (!cue) return;
    const p = g.project(g.ball.p, this._pv);
    if (!p.ok || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    const x = p.x * W, y = p.y * H, r = cue.radius * d, arm = 4 * d;
    const glowK = (g._cal && Number.isFinite(g._cal.hintGlow))
      ? lerp(0.30, 1.15, clamp(g._cal.hintGlow, 0, 1)) : 1;
    c.save(); c.globalAlpha = Math.min(1, cue.alpha * glowK);
    c.strokeStyle = cue.hot ? 'rgba(124,255,158,.95)' : 'rgba(255,255,255,.55)';
    c.lineWidth = (cue.hot ? 2 : 1.3) * d;
    c.setLineDash(cue.dashed ? [3 * d, 3 * d] : []);
    c.beginPath();
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      c.moveTo(x + sx * (r - arm), y + sy * r);
      c.lineTo(x + sx * r, y + sy * r);
      c.lineTo(x + sx * r, y + sy * (r - arm));
    }
    c.stroke(); c.restore();
  }

  syncNativeCursor() {
    const g = this.game, canvas = g && g.canvas;
    if (!canvas) return;
    const playing = [GS.SERVE_READY, GS.SERVE_TOSS, GS.RALLY, GS.POINT].includes(g.state);
    const cursor = playing && !this.captureDebug && !g.paused && !g.preview?.active && !(g.replayer && g.replayer.on) ? 'none' : 'default';
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
  }

  drawCaptureDebug(c, W, H, d) {
    const g=this.game;
    if (!this.captureDebug || !g || g.paused || (g.replayer && g.replayer.on) ||
        ![GS.SERVE_READY,GS.SERVE_TOSS,GS.RALLY].includes(g.state)) return;
    const rect=g.canvas.getBoundingClientRect ? g.canvas.getBoundingClientRect() : {width:W/d,height:H/d};
    const saved=g.swipe && g.swipe.pressZone;
    const serving=[GS.SERVE_READY,GS.SERVE_TOSS].includes(g.state) && g.server===1;
    const locked=saved && (g.swipe.active || (typeof g.playerStrokeIntent==='function' && g.playerStrokeIntent(serving)));
    const cpz=!serving && MATCH_RULES.zoneAnchor==='contact' && typeof g.contactPrediction==='function' ? g.contactPrediction() : null;
    const zone=locked ? saved : cpz ? pressContactZone(g.project(cpz.p,{}),g.pointer,rect.width,rect.height,{pointerType:g.pointerFine===false?'touch':'mouse',scale:typeof g.contactGateScale==='function'?g.contactGateScale(cpz.p,rect):null}) : pressZoneForBall(g.ball,g.pointer,rect.width,rect.height,{
      project:(point,out)=>g.project(point,out||{}), pointerType:g.pointerFine===false?'touch':'mouse',
      referenceWorld:g.player&&g.player.pos,
      kind:serving&&g.state===GS.SERVE_TOSS?'serve':'rally',
      tossApex:g.tossApex,tossStartY:g.tossStartY,tableY:PH.TABLE_Y});
    if (!zone || ![zone.x,zone.y,zone.radius].every(Number.isFinite)) return;
    const sx=W/rect.width,sy=H/rect.height;
    c.save();c.setLineDash([]);c.globalAlpha=.9;c.lineWidth=2*d;c.strokeStyle=zone.accepted?'#6ee7a8':'#ffb066';
    c.beginPath();
    if (zone.shape==='oval' && [zone.axisX,zone.axisY,zone.fwdPx,zone.backPx,zone.sidePx].every(Number.isFinite)) {
      for(let i=0;i<=48;i++){
        const a=i/48*TAU, co=Math.cos(a), si=Math.sin(a);
        const along=co*(co>=0?zone.fwdPx:zone.backPx), across=si*zone.sidePx;
        const px=(zone.x+zone.axisX*along-zone.axisY*across)*sx;
        const py=(zone.y+zone.axisY*along+zone.axisX*across)*sy;
        if(i===0)c.moveTo(px,py);else c.lineTo(px,py);
      }
    } else c.arc(zone.x*sx,zone.y*sy,zone.radius*sx,0,TAU);
    c.stroke();
    // Physical capture is distinct from the pointer admission zone.
    if (g.player && g.player.pos) {
      const pp=g.player.pos, c0=g.project(pp,{}), c1=g.project({x:pp.x+(serving?MATCH_RULES.serveCaptureRadius:MATCH_RULES.captureRadius),y:pp.y,z:pp.z},{});
      if (c0&&c0.ok&&c1&&c1.ok){ c.save(); c.setLineDash([5*d,4*d]); c.strokeStyle='rgba(125,243,255,.85)'; c.lineWidth=1.5*d;
        c.beginPath(); c.arc(c0.x*W,c0.y*H,Math.abs(c1.x-c0.x)*W,0,TAU); c.stroke(); c.restore(); }
    }
    if (cpz) { const q=g.project(cpz.p,{}); if (q&&q.ok){ c.fillStyle='#FFD54A'; c.beginPath(); c.arc(q.x*W,q.y*H,4*d,0,TAU); c.fill(); } }
    if (g.pointer && Number.isFinite(g.pointer.x) && Number.isFinite(g.pointer.y)) {
      const dotX=locked&&Number.isFinite(zone.pointerX)?zone.pointerX*sx:g.pointer.x*W;
      const dotY=locked&&Number.isFinite(zone.pointerY)?zone.pointerY*sy:g.pointer.y*H;
      c.fillStyle=c.strokeStyle;c.beginPath();c.arc(dotX,dotY,3*d,0,TAU);c.fill();
    }
    c.restore();
  }

  drawOverlay(dt) {
    const g = this.game, c = this.fxg, W = this.fx.width, H = this.fx.height, d = this.dpr;
    c.clearRect(0, 0, W, H);
    if (!g) return;

    if (!this.captureDebug && !this.drawCoach(c, W, H, d) && g.training && g.training.guide !== 'none') this.drawStrikeRing(c, W, H, d);
    this.drawCaptureDebug(c, W, H, d);
    this.syncNativeCursor();

    if (this.captureDebug) { this._lastRibbon = null; this.ripples.length = 0; }
    const sw = g.swipe;
    const trailK = (g._cal && Number.isFinite(g._cal.fingerTrail))
      ? lerp(0.35, 1.25, clamp(g._cal.fingerTrail, 0, 1)) : 1;
    if (!this.captureDebug && !g.reducedMotion && !this.reducedMotion && sw.active && sw.samples.length > 1) {
      const pts = sw.samples;
      const n = pts.length;
      /* The ribbon is drawn FROM THE BLADE, not from the raw finger: in
       * the saturated parts of the pointer map (high arc, low drop) the
       * blade legitimately sits away from the fingertip, and a ribbon
       * glued to the finger showed the stroke happening in empty space
       * next to the bat. Shifting the whole path by (blade projection -
       * last sample) keeps the gesture's shape and puts its head, where
       * the eye reads "now", exactly on the blade. Absurd offsets (blade
       * clamped to the frustum edge, replay scrubs) fall back to raw. */
      let offX = 0, offY = 0;
      if (g.player && g.player.pos && typeof g.project === 'function') {
        const bp = g.project(g.player.pos, {});
        if (bp && bp.ok) {
          const candX = (bp.x - pts[n - 1].x) * W, candY = (bp.y - pts[n - 1].y) * H;
          if (Math.hypot(candX, candY) < Math.max(W, H) * 0.6) { offX = candX; offY = candY; }
        }
      }
      c.lineCap = 'round'; c.lineJoin = 'round';
      for (let i = 1; i < n; i++) {
        const t = i / (n - 1);
        c.strokeStyle = '#ffffff';
        c.globalAlpha = Math.min(1, (0.07 + t * 0.5) * trailK);
        c.lineWidth = (1.5 + t * 11) * d * trailK;
        c.beginPath();
        c.moveTo(pts[i - 1].x * W + offX, pts[i - 1].y * H + offY);
        c.lineTo(pts[i].x * W + offX, pts[i].y * H + offY);
        c.stroke();
      }
      c.globalAlpha = Math.min(1, trailK);
      const hx = pts[n - 1].x * W + offX, hy = pts[n - 1].y * H + offY;
      const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 34 * d);
      rg.addColorStop(0, 'rgba(255,255,255,.55)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 34 * d, 0, TAU); c.fill();

      this._lastRibbon = {
        pts: sw.samples.map((p) => ({ x: p.x, y: p.y })),
        col: '#ffffff',
        fade: 1.0,
        offX, offY,
      };
    } else if (this._lastRibbon) {
      if (this.reducedMotion) this._lastRibbon = null;
      else if ((this._lastRibbon.fade -= dt * 2.2) <= 0) {
        this._lastRibbon = null;
      } else {
        const rb = this._lastRibbon;
        const pts = rb.pts, n = pts.length;
        if (n > 1) {
          c.save();
          c.lineCap = 'round'; c.lineJoin = 'round';
          const rbOffX = rb.offX || 0, rbOffY = rb.offY || 0;
          for (let i = 1; i < n; i++) {
            const t = i / (n - 1);
            c.strokeStyle = rb.col;
            c.globalAlpha = Math.min(1, (0.07 + t * 0.5) * rb.fade * trailK);
            c.lineWidth = (1.5 + t * 11) * d * trailK;
            c.beginPath();
            c.moveTo(pts[i - 1].x * W + rbOffX, pts[i - 1].y * H + rbOffY);
            c.lineTo(pts[i].x * W + rbOffX, pts[i].y * H + rbOffY);
            c.stroke();
          }
          c.globalAlpha = Math.min(1, rb.fade * trailK);
          const hx = pts[n - 1].x * W + rbOffX, hy = pts[n - 1].y * H + rbOffY;
          const rg = c.createRadialGradient(hx, hy, 0, hx, hy, 34 * d);
          rg.addColorStop(0, rb.col + 'cc'); rg.addColorStop(1, rb.col + '00');
          c.fillStyle = rg; c.beginPath(); c.arc(hx, hy, 34 * d, 0, TAU); c.fill();
          c.restore();
        }
      }
    }

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
    this.drawShotLabels(c, W, H, d);
  }

  ripple(x, y, col) { if (!this.reducedMotion) this.ripples.push({ x, y, col, t: 0, life: 0.55 }); }

  tick(dt) {
    if (this.game) this.drawOverlay(dt);
  }
}
