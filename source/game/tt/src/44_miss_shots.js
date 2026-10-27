/* =====================================================================
 * Calibration miss history. Based on the earlier miss-shots gallery:
 * remember the neighbourhood of the initial press and keep it in the host
 * only if the attempt has not resulted in a contact. Coordinates and crop
 * margins are CSS pixels, independent of WebGL resolution / device DPR.
 * ===================================================================== */
'use strict';

const MISS_SHOT_HALF = 350;  // CSS pixels on each side of the initial press
const MISS_SHOT_SIZES = Object.freeze([20, 100, 300, 350, 400]);
const MISS_SHOT_JPEG = 0.88;

function missShotRect(press, vw, vh, half = MISS_SHOT_HALF) {
  if (!press || ![press.x, press.y, vw, vh, half].every(Number.isFinite) ||
      vw <= 0 || vh <= 0 || half <= 0 || press.x < 0 || press.y < 0 || press.x >= vw || press.y >= vh) return null;
  // Intersect the requested square with the canvas on all four sides.
  const x = Math.max(0, Math.round(press.x - half));
  const y = Math.max(0, Math.round(press.y - half));
  const right = Math.min(Math.ceil(vw), Math.round(press.x + half) + 1);
  const bottom = Math.min(Math.ceil(vh), Math.round(press.y + half) + 1);
  return { x, y, w: right - x, h: bottom - y };
}

function drawMissMarkers(ctx, p) {
  ctx.save();
  const z = p.zone;
  if (z && Number.isFinite(z.x) && Number.isFinite(z.y)) {
    const x = z.x - p.x, y = z.y - p.y;
    const oval = z.shape === 'oval' && [z.fwdPx, z.backPx, z.sidePx, z.axisX, z.axisY].every(Number.isFinite) &&
      z.fwdPx > 0 && z.backPx > 0 && z.sidePx > 0 && typeof ctx.ellipse === 'function';
    ctx.strokeStyle = 'rgba(80,255,150,.95)'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (oval) {
      // Two half ellipses match the actual asymmetric press admission gate.
      const angle = Math.atan2(z.axisY, z.axisX);
      ctx.ellipse(x, y, z.fwdPx, z.sidePx, angle, -Math.PI / 2, Math.PI / 2);
      ctx.ellipse(x, y, z.backPx, z.sidePx, angle, Math.PI / 2, 3 * Math.PI / 2);
      ctx.closePath();
    } else if (Number.isFinite(z.radius) && z.radius > 0) {
      ctx.arc(x, y, z.radius, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  }
  // Red mark = actual initial pointer position. Draw it last so it remains
  // visible even when the press and the zone reference coincide.
  const x = p.pressX - p.x, y = p.pressY - p.y;
  ctx.strokeStyle = 'rgba(255,77,77,.98)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.moveTo(x - 12, y); ctx.lineTo(x - 9, y);
  ctx.moveTo(x + 9, y); ctx.lineTo(x + 12, y);
  ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 9);
  ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 12);
  ctx.stroke();
  ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** request() is called on pointerdown. The bridge redraws the current scene
 * and calls capture() in that SAME event task: with preserveDrawingBuffer
 * disabled, reading a later frame can be blank or show a moved ball. */
function createMissShotCapture(opts = {}) {
  const getCanvas = opts.getCanvas || (() => null);
  const getOverlay = opts.getOverlay || (() => null);
  const createCanvas = opts.createCanvas || (() => (typeof document !== 'undefined' ? document.createElement('canvas') : null));
  const post = opts.post || (() => {});
  const instance = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  let enabled = opts.enabled !== false, half = MISS_SHOT_HALF, seq = 0, pending = null;

  function request(a) {
    if (!enabled || !a) return null;
    const rect = missShotRect(a.press, a.vw, a.vh, half);
    if (!rect) return null;
    pending = { id: instance + '-' + (++seq), t: Date.now(), ...rect, vw: a.vw, vh: a.vh,
      pressX: a.press.x, pressY: a.press.y, zone: a.zone || null, ball: a.ball || null,
      kind: a.kind || null, input: a.input || null, training: !!a.training,
      gameTime: Number.isFinite(a.gameTime) ? a.gameTime : null,
      gestureId: a.gestureId, shotId: a.shotId, greenAtPress: !!a.greenAtPress,
      accepted: !!a.accepted, zoneReason: a.zoneReason || null,
      dx: Number.isFinite(a.dx) ? a.dx : null, dy: Number.isFinite(a.dy) ? a.dy : null,
      half };
    return pending.id;
  }

  function fail(error) {
    const p = pending; pending = null;
    if (p) post('shoterror', { id: p.id, message: String(error && error.message || error || 'capture failed').slice(0, 300) });
    return null;
  }

  function capture() {
    const p = pending; if (!p) return null;
    try {
      const cv = getCanvas();
      if (!cv || !cv.width || !cv.height) throw new Error('Game canvas unavailable');
      const c2 = createCanvas(); if (!c2) throw new Error('Image canvas unavailable');
      // Preserve the actual WebGL backing resolution (which may be below
      // device DPR at reduced graphics quality). Downsampling to CSS pixels
      // and then enlarging the preview made small captures visibly blocky.
      const renderX = cv.width / p.vw, renderY = cv.height / p.vh;
      c2.width = Math.max(1, Math.round(p.w * renderX));
      c2.height = Math.max(1, Math.round(p.h * renderY));
      const ctx = c2.getContext && c2.getContext('2d'); if (!ctx) throw new Error('2D canvas unavailable');
      // x and y scales can differ slightly when the renderer rounds sizes.
      const draw = (src) => {
        const kx = src.width / p.vw, ky = src.height / p.vh;
        ctx.drawImage(src, p.x * kx, p.y * ky, p.w * kx, p.h * ky, 0, 0, c2.width, c2.height);
      };
      draw(cv);
      const overlay = getOverlay();
      if (overlay && overlay.width && overlay.height) draw(overlay);
      ctx.save(); ctx.scale(c2.width / p.w, c2.height / p.h);
      drawMissMarkers(ctx, p);
      ctx.restore();
      const url = c2.toDataURL('image/jpeg', MISS_SHOT_JPEG);
      if (!url.startsWith('data:image/jpeg;base64,') || url.length < 30) throw new Error('JPEG encoding failed');
      const rec = { ...p, imageWidth: c2.width, imageHeight: c2.height,
        status: 'pending', reason: null, img: url.slice(url.indexOf(',') + 1) };
      pending = null;
      post('shot', rec);
      return rec;
    } catch (e) { return fail(e); }
  }

  return { request, capture, fail, hasPending: () => !!pending,
    setEnabled: (v) => { enabled = !!v; if (!enabled) pending = null; }, isEnabled: () => enabled,
    setHalf: (v) => { half = MISS_SHOT_SIZES.includes(+v) ? +v : MISS_SHOT_HALF; },
    getHalf: () => half };
}
