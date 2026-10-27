/* =====================================================================
 *  MISS SHOTS — captures of the click neighborhood for the shell's
 *  calibration "history of misses".
 *
 *  On every press that can become a stroke attempt (rally / serve) we
 *  remember a 201×201 CSS-px region: the click point ±100 px, clamped to
 *  the canvas. The capture itself runs right after the next game.render()
 *  (the WebGL drawing buffer is valid only inside the frame task), draws
 *  the region into a 2D canvas and stamps two markers on it:
 *     red crosshair + dot  — where the finger/cursor was
 *     green ring + white dot — the hit zone center (where the ball was
 *     when the press was admitted)
 *  so the player can see at a glance: "I really missed" (green ring is
 *  right there, contact never came) vs "calibrate" (red crosshair far
 *  from the green ring — the finger placement is off).
 *
 *  The shell keeps the shot only while the attempt stays a miss: a hit
 *  drops it via the 'shotdrop' message. Region size and JPEG quality are
 *  constants — the history is a diagnostic tool, not an album.
 * ===================================================================== */
'use strict';

const MISS_SHOT_HALF = 100;          // px each side of the click
const MISS_SHOT_JPEG = 0.75;         // diagnostic image: small beats pretty
const MISS_SHOT_RING_MIN = 8, MISS_SHOT_RING_MAX = 70;   // px on the 201 canvas

/** Region around a press in CSS px, clamped to the viewport. Always
 *  contains the click. Returns null for a nonsense press. */
function missShotRect(press, vw, vh) {
  if (!press || ![press.x, press.y, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) return null;
  const x = Math.max(0, Math.min(Math.round(press.x - MISS_SHOT_HALF), vw - 1));
  const y = Math.max(0, Math.min(Math.round(press.y - MISS_SHOT_HALF), vh - 1));
  const w = Math.min(2 * MISS_SHOT_HALF + 1, vw - x);
  const h = Math.min(2 * MISS_SHOT_HALF + 1, vh - y);
  return { x, y, w, h };
}

function drawMissMarkers(ctx, p) {
  const pr = { x: p.pressX - p.x, y: p.pressY - p.y };   // click, CSS px on the region
  ctx.save();
  /* red: the click — crosshair + filled dot */
  ctx.strokeStyle = 'rgba(255,77,77,.95)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(pr.x, pr.y, 10, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pr.x - 16, pr.y); ctx.lineTo(pr.x - 12, pr.y);
  ctx.moveTo(pr.x + 12, pr.y); ctx.lineTo(pr.x + 16, pr.y);
  ctx.moveTo(pr.x, pr.y - 16); ctx.lineTo(pr.x, pr.y - 12);
  ctx.moveTo(pr.x, pr.y + 12); ctx.lineTo(pr.x, pr.y + 16);
  ctx.stroke();
  ctx.fillStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(pr.x, pr.y, 3.5, 0, Math.PI * 2); ctx.fill();
  /* green: the hit zone the press was judged against (CSS px), white dot — its center */
  if (p.zone && Number.isFinite(p.zone.x) && Number.isFinite(p.zone.y)) {
    const zr = { x: p.zone.x - p.x, y: p.zone.y - p.y };
    const rad = Math.max(MISS_SHOT_RING_MIN, Math.min(MISS_SHOT_RING_MAX, p.zone.radius || 40));
    ctx.strokeStyle = 'rgba(80,255,150,.95)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(zr.x, zr.y, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(zr.x, zr.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** The capture half-state machine: request() at press time, capture()
 *  once per frame right after render(). Both axes of the region are CSS
 *  px; the WebGL canvas is read at device px (k = canvas.width / vw). */
function createMissShotCapture(opts = {}) {
  const getCanvas = opts.getCanvas || (() => null);
  const createCanvas = opts.createCanvas || (() => (typeof document !== 'undefined' ? document.createElement('canvas') : null));
  const post = opts.post || (() => {});
  let enabled = opts.enabled !== false;
  let seq = 0;
  let pending = null;

  function request(a) {
    if (!enabled) return null;
    const rect = missShotRect(a.press, a.vw, a.vh);
    if (!rect) return null;
    pending = { id: ++seq, ...rect, vw: a.vw, vh: a.vh, pressX: a.press.x, pressY: a.press.y,
      zone: a.zone || null, kind: a.kind || null, input: a.input || null,
      accepted: !!a.accepted, reason: a.reason || null,
      dx: a.dx !== undefined ? a.dx : null, dy: a.dy !== undefined ? a.dy : null };
    return pending.id;
  }

  function capture() {
    const p = pending; if (!p) return null; pending = null;
    const cv = getCanvas();
    if (!cv || !cv.width || !cv.height) return null;
    const k = cv.width / Math.max(1, p.vw);          // device px per CSS px
    const c2 = createCanvas();
    if (!c2) return null;
    c2.width = p.w; c2.height = p.h;
    const ctx = c2.getContext && c2.getContext('2d');
    if (!ctx) return null;
    try {
      ctx.drawImage(cv, p.x * k, p.y * k, p.w * k, p.h * k, 0, 0, p.w, p.h);
    } catch (e) { return null; }                      // GPU context lost etc.
    drawMissMarkers(ctx, p);
    let img = null;
    try {
      const url = c2.toDataURL('image/jpeg', MISS_SHOT_JPEG);
      img = url.slice(url.indexOf(',') + 1);
    } catch (e) { return null; }
    const rec = { id: p.id, t: Date.now(), kind: p.kind, input: p.input,
      accepted: p.accepted, reason: p.reason, dx: p.dx, dy: p.dy, w: p.w, h: p.h, img };
    post('shot', rec);
    return rec;
  }

  return {
    request,
    capture,
    hasPending: () => !!pending,
    setEnabled: (v) => { enabled = !!v; },
    isEnabled: () => enabled,
  };
}
