/* Bounded input telemetry: the last 30 seconds of pointer decisions.
 * Events are plain objects in a fixed ring; JSON is produced only on export,
 * so the per-frame cost is one snapshot plus one array write. */
'use strict';

const INPUT_LOG_SCHEMA = 1;
const INPUT_LOG_SECONDS = 30;
const INPUT_LOG_MAX_EVENTS = 16000;

function inputLogVec(v) {
  return v && [v.x, v.y, v.z].every(Number.isFinite) ? [v.x, v.y, v.z] : null;
}

function inputLogDecision(zone) {
  if (!zone) return null;
  const speed = Number.isFinite(zone.speedPx) ? zone.speedPx : 0;
  return {
    shape: zone.shape || MATCH_RULES.zoneShape,
    score: Number.isFinite(zone.score) ? zone.score : null,
    along: Number.isFinite(zone.along) ? zone.along : null,
    across: Number.isFinite(zone.across) ? zone.across : null,
    accepted: !!zone.accepted,
    reason: zone.reason || (zone.accepted ? null : 'OUTSIDE_ZONE'),
    distancePx: Number.isFinite(zone.distancePx) ? zone.distancePx : null,
    directionDot: Number.isFinite(zone.directionDot) ? zone.directionDot : null,
    // Proxy, not a measured contact error: along/speed is when the ball would
    // reach the press point; the reference is the configured lead time.
    timingErrorMs: speed > 1 && Number.isFinite(zone.along)
      ? (zone.along / speed - (zone.leadSec || MATCH_RULES.ovalLeadSec)) * 1000 : null,
    via: zone.via || null,
  };
}

class InputTelemetryLog {
  constructor(options = {}) {
    this.seconds = Number.isFinite(options.seconds) && options.seconds > 0 ? options.seconds : INPUT_LOG_SECONDS;
    this.capacity = Math.max(128, Math.min(INPUT_LOG_MAX_EVENTS,
      Number.isFinite(options.maxEvents) ? Math.floor(options.maxEvents) : INPUT_LOG_MAX_EVENTS));
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
    this.dropped = 0;
    this.lastT = -Infinity;
    this.epoch = 0;
  }

  /** Game.time is monotonic in the current Game, but a future reset must not
   * make the 30 s window discard every event from the new clock. A rollback
   * starts a new epoch and drops future-stamped events from the old one. */
  resetClock(t, force = false) {
    if (!Number.isFinite(t)) return false;
    if (!force && !(t < this.lastT - 1e-9)) {
      if (t > this.lastT) this.lastT = t;
      return false;
    }
    this.buffer.fill(null);
    this.head = 0; this.count = 0; this.dropped = 0;
    this.epoch++;
    this.lastT = t;
    return true;
  }

  record(event) {
    if (!event || !Number.isFinite(event.t)) return null;
    if (event.t < this.lastT - 1e-9) this.resetClock(event.t, true);
    event.epoch = this.epoch;
    event.schema = INPUT_LOG_SCHEMA;
    event.rulesVersion = MATCH_RULES.version;
    event.build = typeof BUILD_VERSION !== 'undefined' ? BUILD_VERSION : 'source';
    if (this.count === this.capacity) this.dropped++;
    this.buffer[this.head] = event;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    if (event.t > this.lastT) this.lastT = event.t;
    return event;
  }

  events(now = this.lastT) {
    const out = [], cutoff = Number.isFinite(now) ? now - this.seconds : -Infinity;
    const start = this.count < this.capacity ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const e = this.buffer[(start + i) % this.capacity];
      if (e && e.epoch === this.epoch && e.t >= cutoff) out.push(e);
    }
    return out;
  }

  toJSONL(now = this.lastT) {
    return this.events(now).map(e => JSON.stringify(e)).join('\n') + (this.count ? '\n' : '');
  }

  stats(now = this.lastT) {
    const events = this.events(now);
    return { schema: INPUT_LOG_SCHEMA, seconds: this.seconds, capacity: this.capacity, epoch: this.epoch,
      stored: this.count, inWindow: events.length, dropped: this.dropped,
      approxBytes: events.length ? JSON.stringify(events[0]).length * events.length : 0 };
  }

  clear() {
    this.buffer.fill(null);
    this.head = 0; this.count = 0; this.dropped = 0; this.lastT = -Infinity; this.epoch++;
  }
}

function makeInputLogEvent(game, type, extra = {}) {
  if (!game || !game.ball || !game.player) return null;
  const b = game.ball, pad = game.player, sw = game.swipe || {};
  const zone = extra.zone || sw.pressZone || null;
  const width = Number.isFinite(game.vw) && game.vw > 0 ? game.vw : zone && zone.vw;
  const height = Number.isFinite(game.vh) && game.vh > 0 ? game.vh : zone && zone.vh;
  let screen = null, screenV = null;
  if (typeof game.project === 'function' && game.R && game.R.viewProj && width > 0 && height > 0) {
    const a = game.project(b.p, {});
    if (a && a.ok && [a.x, a.y].every(Number.isFinite)) {
      const ax = a.x, ay = a.y, dt = MATCH_RULES.ovalSampleDtSec;
      const c = game.project({ x: b.p.x + b.v.x * dt, y: b.p.y + b.v.y * dt, z: b.p.z + b.v.z * dt }, {});
      screen = [ax * width, ay * height];
      if (c && c.ok && [c.x, c.y].every(Number.isFinite))
        screenV = [(c.x - ax) * width / dt, (c.y - ay) * height / dt];
    }
  }
  const pointer = extra.pointer || game.pointer || null;
  return {
    type,
    frame: Number.isFinite(game.frame) ? game.frame : null,
    t: game.time,
    dt: Number.isFinite(extra.dt) ? extra.dt : null,
    fps: Number.isFinite(game.fps) ? game.fps : null,
    inputType: extra.inputType || (zone && zone.pointerType) || (game.pointerFine === false ? 'touch' : 'mouse'),
    state: game.state || null,
    gestureId: Number.isFinite(sw.gestureId) ? sw.gestureId : null,
    pointer: pointer && [pointer.x, pointer.y].every(Number.isFinite) ? {
      x: pointer.x, y: pointer.y,
      px: width > 0 ? pointer.x * width : null,
      py: height > 0 ? pointer.y * height : null,
      id: extra.pointerId !== undefined ? extra.pointerId : null,
      buttons: Number.isFinite(extra.buttons) ? extra.buttons : null,
    } : null,
    ball: { p: inputLogVec(b.p), v: inputLogVec(b.v), w: inputLogVec(b.w), screen, screenV,
      live: !!b.live, lastHitBy: Number.isFinite(b.lastHitBy) ? b.lastHitBy : null },
    paddle: { p: inputLogVec(pad.pos), normal: inputLogVec(pad.normal),
      phase: pad.motionStage || null },
    gesture: sw.m ? { samples: sw.m.samples, dist: sw.m.dist, pathLen: sw.m.pathLen,
      speed: sw.m.speed, peakSpeed: sw.m.peakSpeed, active: !!sw.active } : null,
    decision: inputLogDecision(zone),
    outcome: extra.outcome || null,
  };
}

/** Benchmark with the real camera path: makeInputLogEvent projects the ball
 * now and at p+v*dt through Game.prototype.project and a BROADCAST
 * rigViewProj matrix. The projection counter is returned as evidence; the
 * old linear project stub is intentionally gone. */
function benchmarkInputTelemetry(iterations = 5000, options = {}) {
  const width = Number.isFinite(options.width) && options.width > 0 ? options.width : 1280;
  const height = Number.isFinite(options.height) && options.height > 0 ? options.height : 760;
  const aspect = width / height;
  let viewProj = options.viewProj || null, projection = null;
  if (!viewProj && typeof cameraRigFor === 'function' && typeof rigViewProj === 'function' &&
      typeof M4 !== 'undefined' && typeof PH !== 'undefined') {
    const buffer = { vp: M4.create(), proj: M4.create(), view: M4.create() };
    viewProj = rigViewProj(cameraRigFor('BROADCAST', { x: 0, y: PH.TABLE_Y, z: 0 }, aspect), aspect, buffer);
    projection = 'cameraRigFor(BROADCAST)+rigViewProj';
  }
  if (!viewProj || !Array.from(viewProj).every(Number.isFinite) || typeof Game === 'undefined' ||
      !Game.prototype || typeof Game.prototype.project !== 'function') {
    return { iterations, totalMs: null, msPerEvent: null, events: 0, projectionCalls: 0,
      projectionsPerEvent: 0, projection, error: 'real Game.project/camera rig unavailable' };
  }
  let projectionCalls = 0;
  const project = function (p, out) {
    projectionCalls++;
    return Game.prototype.project.call(this, p, out);
  };
  const log = new InputTelemetryLog({ maxEvents: 4096 });
  const game = { frame: 1, time: 0, fps: 60, vw: width, vh: height, pointerFine: true,
    state: 'RALLY', pointer: { x: .5, y: .5 }, R: { viewProj },
    ball: { p: { x: 0, y: 1, z: 1 }, v: { x: 0, y: 0, z: 5 }, w: { x: 0, y: 0, z: 0 }, live: true, lastHitBy: -1 },
    player: { pos: { x: 0, y: 1, z: 1.6 }, normal: { x: 0, y: 0, z: -1 }, motionStage: 'ready' },
    swipe: { gestureId: 1, active: true, m: { samples: 4, dist: .1, pathLen: .12, speed: 1, peakSpeed: 1.2 },
      pressZone: { shape: 'oval', score: .5, along: 20, across: 3, accepted: true, speedPx: 300 } },
    project };
  const probe = makeInputLogEvent(game, 'frame', { dt: 1 / 60 });
  if (!probe || !probe.ball || !Array.isArray(probe.ball.screenV)) {
    return { iterations, totalMs: null, msPerEvent: null, events: 0, projectionCalls,
      projectionsPerEvent: iterations ? projectionCalls / iterations : 0, projection,
      error: 'real projection did not produce screen velocity' };
  }
  projectionCalls = 0;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const start = now();
  for (let i = 0; i < iterations; i++) {
    game.time = i / 60; game.frame = i;
    log.record(makeInputLogEvent(game, 'frame', { dt: 1 / 60 }));
  }
  const elapsed = now() - start;
  return { iterations, totalMs: elapsed, msPerEvent: elapsed / iterations, events: log.count,
    projectionCalls, projectionsPerEvent: iterations ? projectionCalls / iterations : 0,
    projection: `${projection || 'supplied viewProj'} + Game.prototype.project`,
    viewport: [width, height] };
}
