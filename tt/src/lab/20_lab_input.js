/* =====================================================================
 *  INPUT — pointer -> paddle position, pointer path -> one of 8 shots.
 *
 *  The gesture is never a hidden button. A stroke needs:
 *    1. a pointer path long enough to have a direction (a tap does not hit),
 *    2. that direction snapped to the nearest of the eight authored lines,
 *    3. the pointer to have been inside the ball's screen zone while the
 *       ball was in the contact window (the ball itself shows the window
 *       in colour: white -> green -> red).
 *  Length sets the power; nothing else sets the power.
 * ===================================================================== */
'use strict';

class LabGesture {
  constructor() {
    this.active = false;
    this.points = [];
    this.startT = 0;
    this.start = { x: 0, y: 0 };
    this.last = { x: 0, y: 0, t: 0 };
    this.maxPoints = 96;
    this.contact = null;        // best contact snapshot while the finger is down
    this.moved = 0;
    this.sx = 0.5; this.sy = 0.5;   // start in normalised screen units
  }
  down(x, y, t, pointerType) {
    this.active = true;
    this.points.length = 0;
    this.points.push({ x, y, t });
    this.startT = t; this.start = { x, y }; this.last = { x, y, t };
    this.contact = null;
    this.moved = 0;
    this.pointerType = pointerType || 'mouse';
  }
  move(x, y, t) {
    if (!this.active) return;
    const p = this.points;
    const l = p[p.length - 1];
    if (l && Math.hypot(x - l.x, y - l.y) < 0.6) {
      l.x = x; l.y = y; l.t = t;
    } else {
      p.push({ x, y, t });
      if (p.length > this.maxPoints) p.shift();
      this.moved += l ? Math.hypot(x - l.x, y - l.y) : 0;
    }
    this.last = { x, y, t };
  }
  /** Remember the moment the finger was on the ball inside the window. */
  noteContact(info) {
    if (!info || !this.active) return;
    if (!this.contact || info.score < this.contact.score) this.contact = { ...info };
  }
  cancel() {
    this.active = false;
    this.points.length = 0;
    this.contact = null;
  }
  /** Classify the path. Never returns null: a tap comes back with ok=false
   *  and a reason, so the HUD can say why nothing happened. */
  up(x, y, t, minDim) {
    if (!this.active) return null;
    this.move(x, y, t);
    this.active = false;
    const p = this.points;
    const first = p[0], last = p[p.length - 1];
    const dx = last.x - first.x, dy = last.y - first.y;
    const dist = Math.hypot(dx, dy);
    const pathLen = Math.max(dist, this.pathLength());
    const minPx = LAB.minSwipeMm * LAB.pxPerMm;
    const out = {
      dx, dy, dist, pathLen, dur: Math.max(1, last.t - first.t),
      straightness: pathLen > 1e-6 ? clamp(dist / pathLen, 0, 1) : 0,
      mm: dist / LAB.pxPerMm,
      pointerType: this.pointerType || 'mouse',
      contact: this.contact,
      samples: p.length,
    };
    if (dist < minPx) { out.reason = 'tap'; out.ok = false; return out; }

    /* Curved lines are straightened: the direction is dominated by the
     * overall displacement, with the finishing direction as a tie-breaker.
     * A "C" therefore reads as the direction it was drawn towards, not as
     * a sequence of micro-directions nobody could repeat. */
    const tail = p[Math.max(0, p.length - 4)];
    const tdx = last.x - tail.x, tdy = last.y - tail.y;
    const tl = Math.hypot(tdx, tdy) || 1;
    let ux = dx / dist, uy = dy / dist;
    ux = ux * 0.72 + (tdx / tl) * 0.28;
    uy = uy * 0.72 + (tdy / tl) * 0.28;
    const ul = Math.hypot(ux, uy) || 1;

    const hit = labShotForVector(ux / ul, -(uy / ul));   // screen y is down
    out.ok = true;
    out.mm = dist / LAB.pxPerMm;
    out.norm = out.mm / LAB.powerFullMm;
    out.ux = ux / ul; out.uy = uy / ul;
    out.effort = labEffort(out.mm);
    out.band = labPowerBand(out.effort);
    out.shot = hit.shot;
    out.shotId = hit.shot.id;
    out.snapDeg = hit.angle;
    out.snapDot = hit.dot;
    out.deviationDeg = Math.acos(clamp(hit.dot, -1, 1)) / DEG;
    return out;
  }
  pathLength() {
    let s = 0;
    for (let i = 1; i < this.points.length; i++) {
      s += Math.hypot(this.points[i].x - this.points[i - 1].x,
        this.points[i].y - this.points[i - 1].y);
    }
    return s;
  }
}
