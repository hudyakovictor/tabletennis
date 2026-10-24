/* =====================================================================
 *  BALL — one integration step and the two launchers (AI / feed).
 *  The collisions are the project's single source of truth: tableContact,
 *  netContactStep, bounceTable, bounceNet, clipTape, impactSphere.
 * ===================================================================== */
'use strict';

const LAB_TAB = { x: 0, y: 0, z: 0 };
const LAB_NET = { x: 0, y: 0, z: 0 };
const LAB_UP = { x: 0, y: 1, z: 0 };
const LAB_ZERO = { x: 0, y: 0, z: 0 };

/** One 1/600 s step. Returns the events that happened inside it. */
function labStepBall(b, dt, extra) {
  const events = [];
  if (!b.live) return events;
  const p0 = { x: b.p.x, y: b.p.y, z: b.p.z };
  integrateBall(b.p, b.v, b.w, dt);
  Q.integrate(b.q, b.q, b.w, dt);
  b.speed = V3.len(b.v);

  if (b.v.y < 0) {
    const tb = tableContact(p0.x, p0.y, p0.z, b.p.x, b.p.y, b.p.z, LAB_TAB);
    if (tb) {
      const vyIn = b.v.y;
      b.p.x = tb.x; b.p.y = tb.y + 1e-5; b.p.z = tb.z;
      const info = bounceTable(b.p, b.v, b.w);
      events.push({
        type: 'table', x: tb.x, z: tb.z, side: Math.sign(tb.z) || 1,
        speedIn: Math.abs(vyIn), edge: info ? info.edge : 0,
      });
    }
  }

  const nk = netContactStep(p0.x, p0.y, p0.z, b.p.x, b.p.y, b.p.z, LAB_NET);
  if (nk > 0) {
    if (nk === 2) clipTape(b.p, b.v, b.w);
    else bounceNet(b.p, b.v, b.w, Math.sign(p0.z) || 1);
    events.push({ type: 'net', tape: nk === 2 });
  }

  if (b.p.y - PH.R <= 0 && b.v.y < 0) {
    b.p.y = PH.R;
    impactSphere(b.v, b.w, LAB_UP, LAB_ZERO, PH.E_FLOOR, PH.MU_FLOOR, 0);
    events.push({ type: 'floor', x: b.p.x, z: b.p.z });
  }

  if (Math.abs(b.p.x) > 8 || Math.abs(b.p.z) > 10 || b.p.y > 8 || !Number.isFinite(b.p.x)) {
    b.live = false;
    events.push({ type: 'out' });
  }
  if (extra) extra(b, events);
  return events;
}

/** Try a list of speeds until the flight lands where we asked. Used by the
 *  opponent: it is a ball machine, but its ball still has to obey physics. */
function labSolveFrom(from, target, spin, speeds) {
  let best = null;
  for (const s of speeds) {
    const sol = labSolveLaunch(from, target, spin, s);
    if (!best || sol.score < best.score) best = sol;
    if (best.score < 0.12) break;
  }
  return best;
}

function labAiSpin(kind) {
  if (kind === 'TOP') return { x: -160, y: 0, z: 0 };
  if (kind === 'BACK') return { x: 120, y: 0, z: 0 };
  if (kind === 'SIDE_R') return { x: 20, y: -150, z: 0 };
  if (kind === 'SIDE_L') return { x: 20, y: 150, z: 0 };
  return { x: 0, y: 0, z: 0 };
}

/* ------------------------------- storage ----------------------------- */
class LabStore {
  constructor() {
    /* Distance is stored twice: the framing that works on a phone is not the
     * framing that works on a monitor, and the player must not have to
     * re-tune it every time they switch device. */
    this.settings = { distance: LAB.distance, distanceTouch: LAB.distance, serveDir: 'CENTER',
      serveSpin: 'FLAT', debug: false, sound: true };
    this.shots = [];
    this.sessions = [];
    this.load();
  }
  _read(key, fallback) {
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  _write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  load() {
    const s = this._read(LAB.storeKey, null);
    if (s && typeof s === 'object') Object.assign(this.settings, s);
    for (const key of ['distance', 'distanceTouch']) {
      this.settings[key] = clamp(Number(this.settings[key]) || LAB.distance,
        LAB.distanceMin, LAB.distanceMax);
    }
    const h = this._read(LAB.historyKey, null);
    if (h && Array.isArray(h.shots)) this.shots = h.shots.slice(-LAB.historyLimit);
    if (h && Array.isArray(h.sessions)) this.sessions = h.sessions.slice(-LAB.sessionLimit);
    this.session = null;
  }
  saveSettings() { this._write(LAB.storeKey, this.settings); }
  /** The distance that applies to this device, clamped. */
  viewDistance(touch) {
    const v = touch ? this.settings.distanceTouch : this.settings.distance;
    return clamp(Number(v) || LAB.distance, LAB.distanceMin, LAB.distanceMax);
  }
  setViewDistance(touch, v) {
    const c = clamp(v, LAB.distanceMin, LAB.distanceMax);
    if (touch) this.settings.distanceTouch = c; else this.settings.distance = c;
    this.saveSettings();
    return c;
  }
  startSession() {
    this.session = {
      id: 'S' + Date.now().toString(36),
      start: Date.now(), end: null,
      attempts: 0, returns: 0, points: 0, bestRally: 0, shots: {},
      serves: 0, serveOk: 0, misses: 0,
    };
    this.sessions.push(this.session);
    if (this.sessions.length > LAB.sessionLimit) this.sessions.shift();
    this.persist();
    return this.session;
  }
  endSession() {
    if (!this.session) return;
    this.session.end = Date.now();
    this.persist();
  }
  persist() {
    this._write(LAB.historyKey, { v: LAB.version, shots: this.shots, sessions: this.sessions });
  }
  log(rec) {
    const r = Object.assign({ t: Date.now(), session: this.session ? this.session.id : null }, rec);
    this.shots.push(r);
    if (this.shots.length > LAB.historyLimit) this.shots.shift();
    const s = this.session;
    if (s) {
      /* Only real strokes count as attempts: a serve or a whiffed swipe is
       * a separate event and must not inflate the stroke counters. */
      if (r.kind === 'shot') {
        s.attempts++;
        s.shots[r.shot] = s.shots[r.shot] || { n: 0, weak: 0, normal: 0, strong: 0, over: 0, table: 0 };
        s.shots[r.shot].n++;
        if (r.band) s.shots[r.shot][r.band] = (s.shots[r.shot][r.band] || 0) + 1;
        if (r.outcome === 'table') { s.returns++; s.shots[r.shot].table++; }
      } else if (r.kind === 'serve') {
        s.serves++;
        if (r.outcome === 'legal') s.serveOk++;
      } else if (r.kind === 'miss') {
        s.misses++;
      }
      s.bestRally = Math.max(s.bestRally, r.rally || 0);
    }
    this.persist();
    return r;
  }
  summary(list) {
    const src = list || this.shots;
    const out = {};
    for (const s of LAB_SHOTS) out[s.id] = {
      id: s.id, ru: s.ru, short: s.short,
      n: 0, weak: 0, normal: 0, strong: 0, over: 0,
      table: 0, net: 0, shortBall: 0, out: 0, speedSum: 0,
    };
    for (const r of src) {
      if (r.kind && r.kind !== 'shot') continue;
      const row = out[r.shot];
      if (!row) continue;
      row.n++;
      if (r.band) row[r.band]++;
      if (r.outcome === 'table') row.table++;
      else if (r.outcome === 'net') row.net++;
      else if (r.outcome === 'short') row.shortBall++;
      else if (r.outcome === 'out') row.out++;
      if (Number.isFinite(r.speedKmh)) row.speedSum += r.speedKmh;
    }
    for (const k in out) out[k].avgKmh = out[k].n ? out[k].speedSum / out[k].n : 0;
    return out;
  }
  clearHistory() {
    this.shots = [];
    this.sessions = [];
    this.session = null;
    this.persist();
  }
  exportData() {
    return {
      schema: LAB.version, exportedAt: new Date().toISOString(),
      settings: this.settings, sessions: this.sessions, shots: this.shots,
    };
  }
}
