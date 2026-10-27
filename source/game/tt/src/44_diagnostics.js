/* Opt-in, local-only diagnostics. This is deliberately independent of the
 * analytics/network code: no diagnostic data is transmitted automatically. */
const DIAGNOSTIC_VERSION = 2;
const DIAGNOSTIC_DB = 'topspin-local-diagnostics-v1';
const DIAGNOSTIC_SESSION_KEY = 'topspin-diagnostic-session-v1';

function diagNumber(value) { return Number.isFinite(value) ? value : null; }
function diagVec(value) {
  return value ? [diagNumber(value.x), diagNumber(value.y), diagNumber(value.z)] : null;
}
function diagPoint(value) {
  return value ? { x: diagNumber(value.x), y: diagNumber(value.y), t: diagNumber(value.t),
    simTime: diagNumber(value.simTime), pressure: diagNumber(value.pressure) } : null;
}
function diagMetrics(value) {
  if (!value) return null;
  const keys = ['sx', 'sy', 'x', 'y', 'dx', 'dy', 'dur', 'dist', 'pathLen', 'speed', 'peakSpeed',
    'releaseSpeed', 'accel', 'samples', 'curl', 'straightness', 'vx', 'vy', 'angle', 'angleDeg',
    'up', 'right', 'jerk', 'smooth', 'peakEventTime', 'peakSimTime', 'eventTime', 'simTime', 't0', 't1'];
  const result = {};
  for (const key of keys) if (value[key] !== undefined) result[key] = diagNumber(value[key]);
  return result;
}
function diagErrorText(value, limit = 2000) {
  // Paths sometimes contain query parameters or fragments with credentials.
  return String(value == null ? '' : value).replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, '$1')
    .replace(/(file:\/\/[^\s?#)]+)[?#][^\s)]*/g, '$1').slice(0, limit);
}
function diagnosticSessionId() {
  try {
    const old = sessionStorage.getItem(DIAGNOSTIC_SESSION_KEY);
    if (old) return old;
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    sessionStorage.setItem(DIAGNOSTIC_SESSION_KEY, id);
    return id;
  } catch (e) { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12); }
}

/* Snapshot actual gates, not a second attempt at making a hit. In particular,
 * do not call playerStrokeIntent(): it can reject and mutate a live gesture. */
function diagnosticSnapshot(game) {
  const b = game.ball || {}, p = game.player || {}, sw = game.swipe || {};
  const settings = game.settings || {}, strike = game._strike || {};
  const zone = sw.pressZone || null, metrics = sw.m || null, released = sw.lastReleased || null;
  const serving = game.state === 'SERVE_TOSS' && game.server === 1 && b.lastHitBy === 0;
  const sp = game._subPad || p;
  const capture = typeof measureCaptureAllowance === 'function' && b.p && sp.pos && sp.normal && sp.prevPos
    ? measureCaptureAllowance(sp, b.p, b.p, serving, true) : null;
  const cp = game._cp || null;
  const cpPoint = cp && cp.p;
  let rect = null;
  try {
    const r = game.canvas && game.canvas.getBoundingClientRect();
    if (r) rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  } catch (e) {}
  let sampleAge = null;
  try {
    if (typeof game.strokeAge === 'function') {
      const last = sw.samples && sw.samples[sw.samples.length - 1];
      const stamp = sw.active ? last && last.t : game.swipeReleasedAt;
      const simStamp = sw.active ? sw.sampleSimTime : sw.releaseSimTime;
      sampleAge = diagNumber(game.strokeAge(simStamp, stamp));
    }
  } catch (e) {}
  return {
    clocks: { gameSeconds: diagNumber(game.time), simulationSeconds: diagNumber(game.strokeTime),
      timeScale: diagNumber(game.timeScale), timeScaleTarget: diagNumber(game.targetTimeScale),
      inspectSlowmo: !!game.inspectSlowmo, slowmoActive: !!(game.slowmo && game.slowmo.active),
      physicsStepSeconds: typeof PH !== 'undefined' ? diagNumber(PH.SIM_DT) : null,
      physicsAccumulator: diagNumber(game._acc), frameDelta: diagNumber(game._debugLastFrameDelta),
      wallMs: Date.now(), monotonicMs: typeof performance !== 'undefined' ? diagNumber(performance.now()) : null,
      frame: diagNumber(game.frame), fps: diagNumber(game.fps),
      substep: game._subPad ? diagNumber(game._subK) : null, substeps: game._subPad ? diagNumber(game._subN) : null,
      substepSimulationStart: game._subPad && Number.isFinite(game.strokeTime) && Number.isFinite(game._acc)
        ? game.strokeTime - game._acc : null,
      substepSimulationEnd: game._subPad && Number.isFinite(game.strokeTime) && Number.isFinite(game._acc) && typeof PH !== 'undefined'
        ? game.strokeTime - game._acc + PH.SIM_DT : null },
    match: { state: game.state, stateTime: diagNumber(game.stateT), paused: !!game.paused,
      shotId: diagNumber(game.shotId), score: Array.isArray(game.score) ? game.score.slice() : null,
      server: diagNumber(game.server), rally: diagNumber(game.rally), serveBall: !!game.isServeBall,
      lastHitBy: diagNumber(b.lastHitBy), bounces: Array.isArray(game.rallyBounces) ? game.rallyBounces.slice() : [],
      inTraining: !!game.isTraining, online: !!(game.network && game.network.isInMatch) },
    ball: { position: diagVec(b.p), velocity: diagVec(b.v), spin: diagVec(b.w), live: !!b.live,
      speed: diagNumber(b.speed), radius: typeof PH !== 'undefined' ? diagNumber(PH.R) : null },
    paddle: { position: diagVec(p.pos), previousPosition: diagVec(p.prevPos || p.prev),
      substepPosition: diagVec(game._subPad && game._subPad.pos), velocity: diagVec(p.vel), normal: diagVec(p.normal),
      hitRadius: diagNumber(p.hitRadius), lastHitReal: diagNumber(p.lastHitT), target: diagVec(p.target),
      targetComputed: game._ptTarget ? [diagNumber(game._ptTarget.tx), diagNumber(game._ptTarget.ty), diagNumber(game._ptTarget.tz)] : null,
      footDepth: diagNumber(game._footZ), phase: p.motionStage || null, swing: diagNumber(p.swing),
      yaw: diagNumber(p.yaw), pitch: diagNumber(p.pitch), roll: diagNumber(p.roll) },
    gesture: { id: diagNumber(sw.gestureId), active: !!sw.active, pointerId: zone && zone.pointerId,
      pointerType: zone && zone.pointerType || null, consumedGestureId: diagNumber(sw.consumedGestureId),
      pressShotId: zone && diagNumber(zone.shotId), pressWasContactable: !!(zone && zone.pressContactable),
      startTime: diagNumber(sw.startT), sampleCount: (sw.samples || []).length,
      samples: (sw.samples || []).slice(-16).map(diagPoint),
      sampleSim: diagNumber(sw.sampleSimTime), releaseReal: diagNumber(game.swipeReleasedAt),
      releaseSim: diagNumber(sw.releaseSimTime), sampleAge, tapMaxMovePx: diagNumber(sw.tapMaxMovePx),
      current: diagMetrics(metrics), released: diagMetrics(released), releasedIsTap: !!(released && released.tap),
      pressZone: zone ? { ...zone } : null },
    gates: { greenCue: !!(strike.on && strike.contactable),
      cueOn: !!strike.on, cueContactable: !!strike.contactable, cueReady: diagNumber(strike.ready),
      cueKind: strike.kind || null, strikeEta: diagNumber(strike.t),
      ownBounce: Array.isArray(game.rallyBounces) && game.rallyBounces.includes(1),
      strokeAge: sampleAge, worldDistance: capture ? diagNumber(capture.distance) : null,
      depth: capture ? diagNumber(capture.depthGap) : null, lateral: capture ? diagNumber(capture.lateral) : null,
      inside: b.p && sp.pos && typeof playerInCaptureRange === 'function' ? playerInCaptureRange(b.p, sp, serving) : null,
      grace: b.p && sp.pos && typeof playerGraceRange === 'function' ? playerGraceRange(b.p, sp, serving) : null,
      captureScore: capture ? diagNumber(capture.score) : null,
      predictedPoint: diagVec(cpPoint), predictedEta: cp ? diagNumber(cp.t) : null,
      predictedFrame: diagNumber(game._cpFrame), predictedRealTime: diagNumber(game._cpTime) },
    view: { canvas: game.canvas ? { width: game.canvas.width, height: game.canvas.height, rect } : null,
      overlay: game.ui && game.ui.fx ? { width: game.ui.fx.width, height: game.ui.fx.height } : null,
      devicePixelRatio: typeof window !== 'undefined' ? diagNumber(window.devicePixelRatio) : null,
      viewport: typeof window !== 'undefined' ? [window.innerWidth, window.innerHeight] : null,
      camera: settings.camera || null, cameraPosition: game.R ? diagVec(game.R.camPos) : null,
      viewProjection: game.R && game.R.viewProj ? Array.from(game.R.viewProj, diagNumber) : null }
  };
}

/* A bounded write-behind journal protects recent evidence from a page reload.
 * It never blocks gameplay on I/O. Live export still works if IndexedDB is
 * unavailable; the UI reports that recovery is unavailable in that case. */
class DiagnosticArchive {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.status = 'opening'; this.error = null; this.dropped = 0; this.pruned = 0; this.frameStatus = 'none';
    this.running = true; this.pending = []; this.db = null; this.writing = null; this.timer = null; this.flushScheduled = false;
    this.ready = this.open();
  }
  open() {
    return new Promise(resolve => {
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB unavailable');
        const req = indexedDB.open(DIAGNOSTIC_DB, 2);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('chunks')) {
            const store = db.createObjectStore('chunks', { autoIncrement: true });
            store.createIndex('session', 'sessionId', { unique: false });
          }
          // One latest explicitly bookmarked PNG globally, not one per match.
          if (!db.objectStoreNames.contains('frames')) db.createObjectStore('frames');
        };
        req.onerror = () => { this.status = 'unavailable'; this.error = diagErrorText(req.error && req.error.message); resolve(false); };
        req.onblocked = () => { this.status = 'unavailable'; this.error = 'IndexedDB blocked'; resolve(false); };
        req.onsuccess = () => {
          this.db = req.result; this.status = 'available';
          this.db.onversionchange = () => { this.db.close(); this.db = null; this.status = 'unavailable'; };
          if (this.running) this.timer = setInterval(() => this.scheduleFlush(), 3000);
          resolve(true);
          if (this.pending.length) this.scheduleFlush();
        };
      } catch (e) { this.status = 'unavailable'; this.error = diagErrorText(e && e.message || e); resolve(false); }
    });
  }
  add(event) {
    if (this.status === 'unavailable') return;
    this.pending.push(event);
    if (this.pending.length > 3000) { this.pending.splice(0, 256); this.dropped += 256; }
    if (this.pending.length >= 256 && this.status === 'available') this.scheduleFlush();
  }
  scheduleFlush() {
    if (this.flushScheduled || this.status !== 'available' || !this.pending.length) return;
    this.flushScheduled = true;
    this.flush().catch(e => { this.error = diagErrorText(e && e.message || e); this.status = 'unavailable'; })
      .finally(() => { this.flushScheduled = false; if (this.pending.length >= 256) this.scheduleFlush(); });
  }
  async flush() {
    if (!(await this.ready) || !this.db) return false;
    if (this.writing) { await this.writing; return this.pending.length ? this.flush() : true; }
    if (!this.pending.length) return true;
    const events = this.pending.splice(0, 256);
    this.writing = new Promise(resolve => {
      try {
        const tx = this.db.transaction('chunks', 'readwrite');
        const store = tx.objectStore('chunks');
        store.add({ sessionId: this.sessionId, savedAt: Date.now(), events });
        // At most 64 chunks globally (~16,384 events, and less for partial
        // chunks). Oldest chunks are pruned, never whole current evidence.
        const count = store.count();
        count.onsuccess = () => {
          let excess = Math.max(0, count.result - 64);
          if (!excess) return;
          const cursor = store.openCursor();
          cursor.onsuccess = () => { const c = cursor.result; if (c && excess-- > 0) { c.delete(); this.pruned++; c.continue(); } };
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = tx.onabort = () => { this.error = diagErrorText(tx.error && tx.error.message || 'IndexedDB write failed'); this.status = 'unavailable'; this.dropped += events.length; resolve(false); };
      } catch (e) { this.error = diagErrorText(e && e.message || e); this.status = 'unavailable'; this.dropped += events.length; resolve(false); }
    });
    const ok = await this.writing; this.writing = null;
    if (ok && this.pending.length) return this.flush();
    return ok;
  }
  async read() {
    await this.flush();
    if (!this.db || this.status !== 'available') return [];
    return new Promise(resolve => {
      try {
        const req = this.db.transaction('chunks', 'readonly').objectStore('chunks').index('session').getAll(this.sessionId);
        req.onsuccess = () => resolve(req.result.flatMap(chunk => chunk.events || []));
        req.onerror = () => { this.error = diagErrorText(req.error && req.error.message); resolve([]); };
      } catch (e) { this.error = diagErrorText(e && e.message || e); resolve([]); }
    });
  }
  async saveFrame(frame) {
    this.frameStatus = 'pending';
    if (!(await this.ready) || !this.db || this.status !== 'available') { this.frameStatus = 'unavailable'; return false; }
    return new Promise(resolve => {
      try {
        const tx = this.db.transaction('frames', 'readwrite');
        tx.objectStore('frames').put({ sessionId: this.sessionId, frame }, 'latest');
        tx.oncomplete = () => { this.frameStatus = 'saved'; resolve(true); };
        tx.onerror = tx.onabort = () => { this.frameStatus = 'failed'; this.frameError = diagErrorText(tx.error && tx.error.message || 'Frame save failed'); resolve(false); };
      } catch (e) { this.frameStatus = 'failed'; this.frameError = diagErrorText(e && e.message || e); resolve(false); }
    });
  }
  async readFrame() {
    if (!(await this.ready) || !this.db || this.status !== 'available') return null;
    return new Promise(resolve => {
      try {
        const req = this.db.transaction('frames', 'readonly').objectStore('frames').get('latest');
        req.onsuccess = () => {
          const row = req.result, frame = row && row.sessionId === this.sessionId ? row.frame : null;
          if (frame) this.frameStatus = 'saved';
          resolve(frame);
        };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }
  stop() { this.running = false; if (this.timer) clearInterval(this.timer); this.timer = null; this.flush(); }
  start() {
    this.running = true;
    if (!this.timer && this.db && this.status === 'available') this.timer = setInterval(() => this.scheduleFlush(), 3000);
  }
}

function diagnosticEnvironment(game) {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const win = typeof window !== 'undefined' ? window : {};
  const doc = typeof document !== 'undefined' ? document : {};
  const gl = game.R && game.R.gl;
  let renderer = null, vendor = null, glVersion = null, contextAttributes = null, contextLost = null;
  try {
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      vendor = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
      glVersion = gl.getParameter(gl.VERSION); contextAttributes = gl.getContextAttributes(); contextLost = gl.isContextLost();
    }
  } catch (e) { renderer = 'unavailable'; }
  return { userAgent: nav.userAgent || null, language: nav.language || null,
    platform: nav.platform || null, touchPoints: nav.maxTouchPoints || 0,
    deviceMemoryGB: nav.deviceMemory || null, hardwareConcurrency: nav.hardwareConcurrency || null,
    viewport: [win.innerWidth || 0, win.innerHeight || 0], devicePixelRatio: win.devicePixelRatio || 1,
    screen: win.screen ? { width: win.screen.width, height: win.screen.height, orientation: win.screen.orientation && win.screen.orientation.type } : null,
    visibility: doc.visibilityState || null, embedded: !!(win.__ttEmbed && win.__ttEmbed.enabled),
    webgl: { version: glVersion, vendor, renderer, attributes: contextAttributes, contextLost },
    build: typeof BUILD_VERSION !== 'undefined' ? BUILD_VERSION : null };
}
