/* Evidence-based shot feedback. Intent != contact != legal return != point.
 * Stores bounded numeric events, never video frames or miss replays. */
'use strict';
const SHOT_DIAGNOSTICS_VERSION = 1;
const SHOT_OUTCOMES = Object.freeze({ outside: 'Вне зоны нажатия', pending: 'Ждём отскок', table: 'На стол', net: 'В сетку',
  out: 'Аут', own_half: 'На своей половине', serve_fault: 'Ошибка подачи', let: 'Переподача',
  no_contact: 'Нет контакта', rejected: 'Жест слишком короткий', no_swipe: 'Мяч пропущен — нет нового удара' });
const shotVec = v => v && [v.x, v.y, v.z].every(Number.isFinite) ? { x: v.x, y: v.y, z: v.z } : null;
function measureShotSpin(w, velocity) {
  const omega = shotVec(w) || { x: 0, y: 0, z: 0 };
  const v = shotVec(velocity) || { x: 0, y: 0, z: -1 };
  const len = Math.hypot(v.x, v.z);
  const fx = len > 1e-8 ? v.x / len : 0, fz = len > 1e-8 ? v.z / len : -1;
  return { totalRps: Math.hypot(omega.x, omega.y, omega.z) / TAU,
    topRps: (omega.x * fz - omega.z * fx) / TAU,
    sideRps: omega.y / TAU, corkRps: (omega.x * fx + omega.z * fz) / TAU };
}
function shotSpinText(spin) {
  if (!spin || spin.totalRps < 1) return 'Практически без вращения';
  const parts = [];
  if (Math.abs(spin.topRps) >= 1) parts.push(`${spin.topRps > 0 ? 'Верхнее' : 'Нижнее'} ${Math.abs(spin.topRps).toFixed(1)} об/с`);
  if (Math.abs(spin.sideRps) >= 1) parts.push(`боковое ${Math.abs(spin.sideRps).toFixed(1)} об/с`);
  if (Math.abs(spin.corkRps) >= 1) parts.push(`продольное ${Math.abs(spin.corkRps).toFixed(1)} об/с`);
  return parts.join(' · ') || `Суммарно ${spin.totalRps.toFixed(1)} об/с`;
}
function shotFeedbackView(entry) {
  if (!entry) return null;
  if (entry.outcome === 'no_swipe') return { title: 'НОВОГО УДАРА НЕ БЫЛО', status: 'Мяч пропущен', metrics: '', detail: '', tone: 'neutral' };
  const stroke = STROKES[entry.strokeId];
  const name = stroke ? stroke.name : 'ЖЕСТ';
  if (!entry.contact) return { title: entry.valid ? `Жест: ${name.toLowerCase()}` : 'Жест не распознан',
    status: entry.outcome === 'pending' ? 'Ищем контакт' : SHOT_OUTCOMES[entry.outcome] || 'Нет контакта',
    metrics: '', detail: entry.outcome === 'no_contact' ? 'Свайп был, касания мяча не было' : '', tone: 'neutral' };
  return { title: `Жест: ${name.toLowerCase()}`, status: entry.outcome === 'pending' ? 'Контакт есть · ждём отскок' : SHOT_OUTCOMES[entry.outcome] || entry.outcome,
    metrics: `${entry.contact.speedKmh.toFixed(0)} км/ч · ${shotSpinText(entry.contact.spin)}`,
    detail: `Оценка контакта ${Math.round(entry.contact.quality * 100)}% · вращение измерено после удара`,
    tone: entry.outcome === 'table' ? 'good' : ['net', 'out', 'own_half', 'serve_fault'].includes(entry.outcome) ? 'bad' : 'neutral' };
}
// Live HUD is deliberately brief; the pause journal retains the full report.
function shotHudView(entry) {
  if (!entry || (!entry.contact && entry.outcome === 'pending')) return null;
  const full = shotFeedbackView(entry);
  if (!entry.contact) return { ...full, title: '', status: entry.outcome === 'no_swipe' ? 'Мяч пропущен' : entry.outcome === 'rejected' ? 'Нет удара' : full.status, metrics: '' };
  const spin = entry.contact.spin;
  const components = [ ['Верхнее', spin.topRps], ['Боковое', spin.sideRps], ['Продольное', spin.corkRps] ];
  components.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  let [label, value] = components[0];
  if (label === 'Верхнее' && value < 0) label = 'Нижнее';
  return { ...full, title: (STROKES[entry.strokeId] || {}).short || '',
    status: entry.outcome === 'pending' ? 'Контакт' : full.status,
    metrics: spin.totalRps < 1 ? 'Без вращения' : `${label} ${Math.round(Math.abs(value))} об/с` };
}

class ShotJournal {
  constructor(limit = 120) { this.limit = Math.max(1, Math.min(500, limit)); this.reset(); }
  reset() { this.records = []; this.sequence = 0; this.latest = null; this.flight = null; }
  create(gestureId, time) {
    const entry = { id: ++this.sequence, revision: 1, gestureId, time, strokeId: null, valid: false,
      outcome: 'pending', contact: null, bounces: [], netTouches: 0 };
    this.records.push(entry); if (this.records.length > this.limit) this.records.shift();
    this.latest = entry; return entry;
  }
  observe(gestureId, metrics, context) {
    if (!metrics || !Number.isFinite(gestureId) || gestureId <= 0) return null;
    let entry = this.records.find(e => e.gestureId === gestureId);
    if (entry && entry.contact) return entry;
    if (!entry) entry = this.create(gestureId, context.time);
    const valid = isRealStroke(metrics, context.isServe);
    const kind = valid ? context.strokeId : null;
    if (entry.valid !== valid || entry.strokeId !== kind) entry.revision++;
    entry.valid = valid; entry.strokeId = kind; entry.isServe = !!context.isServe;
    entry.gestureMetrics = { ...metrics };
    entry.gesture = { dx: metrics.dx, dy: metrics.dy, duration: metrics.dur, path: metrics.pathLen,
      peakSpeed: metrics.peakSpeed, releaseSpeed: metrics.releaseSpeed, samples: metrics.samples, curl: metrics.curl };
    entry.deadline = context.sampleTime + (context.isServe ? 1.15 : context.active ? .18 : .25);
    if (['no_contact', 'rejected'].includes(entry.outcome) && valid && context.time <= entry.deadline) { entry.outcome = 'pending'; entry.revision++; }
    if (entry.pressZone && !entry.pressZone.accepted) { entry.outcome = 'outside'; return entry; }
    if (!valid && !context.active && entry.outcome !== 'rejected') { entry.outcome = 'rejected'; entry.revision++; }
    return entry;
  }
  /** The pointerdown stamp is final. The only later change is a REJECTION
   *  (the finished swipe did not move towards the ball it started near), and
   *  the journal's copy must learn about it or the report disagrees with the
   *  gate that actually ran. */
  rejectPress(gestureId, reason, zone) {
    const e = this.records.find(r => r.gestureId === gestureId && !r.contact);
    if (!e || !e.pressZone) return;
    if (zone) e.pressZone = { ...zone };
    e.pressZone.accepted = false; e.pressZone.reason = reason || 'OUTSIDE_ZONE';
    if (e.outcome === 'pending') { e.outcome = 'outside'; e.revision++; }
  }
  expire(time) {
    for (const entry of this.records) {
      if (!entry.contact && entry.outcome === 'pending' && time > entry.deadline) {
        entry.outcome = entry.valid ? 'no_contact' : 'rejected'; entry.revision++;
      }
    }
  }
  observeCapture(gestureId, sample, time) {
    const entry = this.records.find(e => e.gestureId === gestureId && !e.contact);
    if (!entry || !Number.isFinite(sample.score)) return;
    if (!entry.closest || sample.score < entry.closest.score) entry.closest = { ...sample, time };
  }
  capture(gestureId, time, racket, ball, extra = {}) {
    let entry = this.records.find(e => e.gestureId === gestureId && !e.contact);
    if (!entry) entry = this.create(gestureId, time);
    const outgoing = { v: shotVec(ball.v), w: shotVec(ball.w) };
    const input = racket.contactInput || null;
    entry.strokeId = racket.stroke ? racket.stroke.id : 'DRIVE'; entry.valid = true;
    entry.isServe = !!racket.isServe; entry.outcome = 'pending'; entry.revision++;
    entry.contact = { time, speedKmh: V3.len(ball.v) * 3.6, spin: measureShotSpin(ball.w, ball.v),
      quality: clamp(Number.isFinite(racket.quality) ? racket.quality : 0, 0, 1),
      incoming: input, outgoing, normal: shotVec(racket.normal), racketVelocity: shotVec(racket.vR),
      raw: racket.unassisted || null, assist: { elevation: racket.dElev || 0, azimuth: racket.dAz || 0, wrist: racket.dWrist || 0,
        scale: racket.scale === undefined ? 1 : racket.scale, damp: racket.damp === undefined ? 1 : racket.damp,
        valid: racket.valid === undefined ? null : !!racket.valid, solved: racket.solved || null },
      grip: extra.grip || 'shakehand', hand: extra.hand || 'right', shotId: extra.shotId };
    if (input && input.w) {
      entry.contact.spinChangeRps = Math.hypot(ball.w.x - input.w.x, ball.w.y - input.w.y, ball.w.z - input.w.z) / TAU;
    }
    this.flight = entry; this.latest = entry; return entry;
  }
  resolve(outcome) {
    const e = this.flight;
    if (!e || e.outcome === outcome) return;
    e.outcome = outcome; e.revision++;
  }
  bounce(side, time) {
    const e = this.flight; if (!e || e.outcome !== 'pending') return;
    e.bounces.push({ side, time });
    if (e.isServe) {
      if (e.bounces.length === 1 && side !== 1) this.resolve('serve_fault');
      else if (e.bounces.length >= 2) this.resolve(side === -1 ? (e.netTouches ? 'let' : 'table') : 'serve_fault');
    } else this.resolve(side === -1 ? 'table' : 'own_half');
    if (e.outcome === 'let') this.flight = null; // let is not part of the next scored rally
  }
  net() { if (this.flight && this.flight.outcome === 'pending') { this.flight.netTouches++; this.flight.revision++; } }
  returned(time) { if (this.flight) this.flight.returnedAt = time; }
  point(who, reason, lastHitBy, time) {
    this.expire(time + .001);
    const e = this.flight;
    if (e) { e.point = { won: who > 0, reason }; e.revision++; }
    if (e && lastHitBy === 1 && e.outcome === 'pending') {
      this.resolve(reason.includes('СЕТКУ') ? 'net' : reason.includes('ПОДАЧ') ? 'serve_fault' : reason.includes('ПЕРЕЛЕТЕЛ') ? 'own_half' : 'out');
    } else if (who < 0 && lastHitBy <= 0 && (!this.latest || this.latest.contact)) {
      const missed = this.create(null, time); missed.outcome = 'no_swipe';
    } else if (this.latest && !this.latest.contact && this.latest.outcome === 'pending') {
      this.latest.outcome = this.latest.valid ? 'no_contact' : 'rejected'; this.latest.revision++;
    }
    this.flight = null; // a later rally must not rewrite this point
  }
  exportData() { return JSON.parse(JSON.stringify({ schema: SHOT_DIAGNOSTICS_VERSION, rules: MATCH_RULES,
    physics: PH, archetypes: ARCH, profiles: PADDLE_PROFILES, records: this.records })); }
}

/* ---------------- guided press-zone calibration -----------------------
 * Development data collection only. The session never changes MATCH_RULES
 * and never builds a personal zone: every player keeps the one shared oval.
 * Steps run mouse first, then touch (step 7 of the brief is the repeat). */
const ZONE_CALIBRATION_STEPS = Object.freeze([
  Object.freeze({ id: 'corners', title: 'Углы стола', need: 4,
    instruction: 'Нажимайте точно в углы стола по очереди: ближний левый, ближний правый, дальний правый, дальний левый.' }),
  Object.freeze({ id: 'stationary', title: 'Неподвижный мяч', need: 30,
    instruction: 'По 10 ударов: начинайте замах перед мячом, сбоку и сзади. Мяч — в готовности к подаче.' }),
  Object.freeze({ id: 'slow', title: 'Медленный мяч', need: 20,
    instruction: '20 приёмов медленного мяча в обучении или матче. Начинайте замах там, где удобно.' }),
  Object.freeze({ id: 'fast', title: 'Быстрый мяч', need: 20,
    instruction: '20 приёмов быстрого мяча (упражнение «Тайминг» или подача соперника).' }),
  Object.freeze({ id: 'serve', title: 'Своя подача', need: 15,
    instruction: '15 подбросов и подач. Пишутся высота, старт пальца и длина свайпа.' }),
  Object.freeze({ id: 'power', title: 'Сила и спин', need: 8,
    instruction: 'По 2 удара: самый слабый, самый сильный, топспин, подрезка. Нужен контакт.' }),
]);
const ZONE_CALIBRATION_PASSES = Object.freeze(['mouse', 'touch']);

function calibrationPercentile(values, q) {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  return xs[Math.min(xs.length - 1, Math.max(0, Math.ceil(xs.length * q) - 1))];
}

class ZoneCalibrationSession {
  constructor() { this.reset(); }
  reset() { this.samples = []; this.passIndex = 0; this.stepIndex = 0; this.done = false; this.lastSummary = null; }
  get pass() { return ZONE_CALIBRATION_PASSES[this.passIndex] || null; }
  get step() { return ZONE_CALIBRATION_STEPS[this.stepIndex] || null; }
  count(stepId = this.step && this.step.id, pass = this.pass) {
    return this.samples.filter(s => s.stepId === stepId && s.pass === pass).length;
  }
  record(sample) {
    if (!sample || this.done || !this.step) return null;
    const inputType = sample.inputType === 'mouse' ? 'mouse' : sample.inputType ? 'touch' : this.pass;
    if (inputType !== this.pass) return null;      // wrong device for this pass: not evidence
    const row = { ...sample, pass: this.pass, stepId: this.step.id, inputType };
    this.samples.push(row);
    let summary = null;
    if (this.count() >= this.step.need) {
      summary = this.summaryFor(this.step.id, this.pass);
      this.lastSummary = summary;
      this.stepIndex++;
      if (this.stepIndex >= ZONE_CALIBRATION_STEPS.length) { this.stepIndex = 0; this.passIndex++; }
      if (this.passIndex >= ZONE_CALIBRATION_PASSES.length) this.done = true;
    }
    return { sample: row, summary, done: this.done,
      progress: this.done ? null : { pass: this.pass, step: this.step, have: this.count() } };
  }
  /** Map ShotJournal records onto the current step. Corners are recorded by
   *  the UI directly (the journal does not know which corner was the target). */
  importJournal(records, afterId = 0) {
    let added = 0, lastId = afterId, summary = null;
    for (const e of records || []) {
      if (!e || e.id <= afterId || !e.pressZone) continue;
      lastId = Math.max(lastId, e.id);
      const z = e.pressZone, stepId = this.step && this.step.id;
      if (!stepId || stepId === 'corners') continue;
      if (stepId === 'serve' && !z.serving) continue;
      if (stepId === 'power' && !e.contact) continue;
      const label = stepId === 'stationary'
        ? (z.along > 20 ? 'front' : z.along < -20 ? 'back' : 'side')
        : stepId === 'power' ? (e.strokeId || 'shot') : stepId;
      const result = this.record({ label, along: z.along, across: z.across, score: z.score,
        accepted: !!z.accepted, reason: z.reason || null, inputType: z.pointerType,
        gesturePath: e.gesture ? e.gesture.path : null, gesturePeakSpeed: e.gesture ? e.gesture.peakSpeed : null,
        contactY: e.contact && e.contact.incoming && e.contact.incoming.p ? e.contact.incoming.p.y : null,
        ballSpeedKmh: e.contact ? e.contact.speedKmh : null, spin: e.contact ? e.contact.spin : null });
      if (result) { added++; if (result.summary) summary = result.summary; }
      if (this.done) break;
    }
    return { added, lastId, summary };
  }
  summaryFor(stepId, pass) {
    const rows = this.samples.filter(s => s.stepId === stepId && s.pass === pass);
    const p90along = calibrationPercentile(rows.map(r => r.along).filter(v => v > 0), .9);
    const p90across = calibrationPercentile(rows.map(r => Math.abs(r.across)), .9);
    const p90error = calibrationPercentile(rows.map(r => r.errorPx), .9);
    const byLabel = {};
    for (const r of rows) byLabel[r.label || stepId] = (byLabel[r.label || stepId] || 0) + 1;
    let recommendation;
    if (stepId === 'corners') recommendation = `90-й перцентиль ошибки по углам: ${p90error === null ? '—' : Math.round(p90error)} px.`;
    else if (stepId === 'serve') recommendation = `90-й перцентиль замаха на подаче: ${p90along === null ? '—' : Math.round(p90along)} px по оси падения, ${p90across === null ? '—' : Math.round(p90across)} px поперёк.`;
    else if (stepId === 'power') recommendation = 'Таблица «жест → скорость и спин мяча» — в экспорте (samples шага power).';
    else recommendation = `90-й перцентиль замаха: ${p90along === null ? '—' : Math.round(p90along)} px вперёд, ${p90across === null ? '—' : Math.round(p90across)} px поперёк.`;
    return { stepId, pass, count: rows.length, byLabel, p90along, p90across, p90error, recommendation };
  }
  compareSlowFast(pass) {
    const slow = this.summaryFor('slow', pass), fast = this.summaryFor('fast', pass);
    return { pass, slowP90along: slow.p90along, fastP90along: fast.p90along,
      growsWithSpeed: slow.p90along !== null && fast.p90along !== null ? fast.p90along > slow.p90along : null };
  }
  exportData() {
    return JSON.parse(JSON.stringify({ schema: 'zone-calibration-v1', rulesVersion: MATCH_RULES.version,
      rules: MATCH_RULES, done: this.done, pass: this.pass, stepIndex: this.stepIndex,
      samples: this.samples,
      summaries: ZONE_CALIBRATION_PASSES.flatMap(pass => ZONE_CALIBRATION_STEPS.map(st => this.summaryFor(st.id, pass))),
      slowVsFast: ZONE_CALIBRATION_PASSES.map(pass => this.compareSlowFast(pass)) }));
  }
}

/** Deterministic fixtures, not a promise to cover all possible shots.
 * 2 grips × 2 hands × FH/BH × 3 heights × 2 depths × 3 gestures = 144.
 * Hand mirrors x and swipe direction, not topspin. No settings are changed. */
function shotCalibrationCases() {
  const cases = [];
  for (const grip of ['shakehand', 'penhold']) for (const hand of ['right', 'left']) for (const forehand of [true, false])
    for (const y of [.88, 1.05, 1.3]) for (const z of [1.2, 1.65]) for (const dy of [-.35, -.12, .25])
      cases.push({ grip, hand, forehand, y, z, dy });
  return cases;
}
function evaluateShotCalibration(c) {
  const h = c.hand === 'left' ? -1 : 1, sw = new SwipeTracker();
  sw.down(.5, .5, 0); sw.move(.5 + .02 * h, .5 + c.dy / 2, .05); sw.up(.5 + .04 * h, .5 + c.dy, .1);
  const p = V3.new(.15 * h * (c.forehand ? 1 : -1), c.y, c.z), inputV = V3.new(0, -1, 6), inputW = V3.new(150, 0, 0);
  const raw = deriveStroke(sw.lastReleased, { side: 1, grip: c.grip, forehand: c.forehand,
    ball: { y: c.y, z: c.z }, ballSpin: inputW, ballSpeed: 6, movePitch: -.15 });
  const r = refineRacket(p, inputV, inputW, raw, MATCH_RULES.trajectoryAssist, .85);
  const v = V3.clone(inputV), w = V3.clone(inputW);
  impactRacket(v, w, r.normal, r.vR, .85, r.rubber);
  V3.addScaled(p, p, r.normal, PH.R * 1.05);
  const report = predict(p, v, w, { dt: PH.SIM_DT, maxT: 2.6, stopOnFirstBounce: true, out: {} });
  const finite = [...Object.values(v), ...Object.values(w), ...Object.values(r.normal)].every(Number.isFinite);
  const face = Math.asin(clamp(r.normal.y, -1, 1)) / DEG, range = r.faceEnvelope;
  const inEnvelope = !range || (face >= range[0] - 1e-6 && face <= range[1] + 1e-6);
  return { ...c, stroke: r.stroke.id, finite, inEnvelope, faceDegrees: face, speedKmh: V3.len(v) * 3.6,
    spin: measureShotSpin(w, v), rawNormal: shotVec(raw.normal), finalNormal: shotVec(r.normal),
    correction: { elevation: r.dElev || 0, wrist: r.dWrist || 0 },
    legal: !!(!report.hitNet && report.landed && report.landed.z < 0), landed: report.landed || null, hitNet: !!report.hitNet };
}
async function runShotCalibration(options = {}) {
  const cases = shotCalibrationCases(), results = [];
  for (const c of cases) {
    if (options.cancelled && options.cancelled()) return { cancelled: true, results };
    results.push(evaluateShotCalibration(c));
    if (options.progress) options.progress(results.length, cases.length);
    if (options.yield) await options.yield();
  }
  return { schema: SHOT_DIAGNOSTICS_VERSION, fixture: 'player-144-v1', rulesVersion: MATCH_RULES.version,
    dt: PH.SIM_DT, total: results.length, legal: results.filter(r => r.legal).length,
    invariantFailures: results.filter(r => !r.finite || !r.inEnvelope).length, results };
}


/** A same-substep sensitivity study, NOT a replay or prediction of a whole rally. */
function summarizeCaptureCalibration(records) {
  return [false,true].map(serving => {
    const samples = records.map(e => e.contact && e.contact.incoming && e.contact.incoming.capture)
      .filter(s => s && s.serving === serving && Number.isFinite(s.requiredRadius) && s.requiredRadius >= 0 && Number.isFinite(s.radius) && s.radius > 0);
    const fractions = samples.map(s => s.requiredRadius/s.radius).sort((a,b)=>a-b);
    return { serving, count: samples.length, nearEdge: fractions.filter(f=>f>=.8).length,
      p90: fractions.length ? fractions[Math.ceil(fractions.length*.9)-1] : null,
      depthTrials: serving ? [] : [.9,.8,.7].map(scale => ({ scale, kept: samples.filter(s =>
        (Number.isFinite(s.ccdRadius) && s.ccdRadius <= s.radius+1e-9) ||
        (s.endpointEligible && s.lateral <= s.radius+1e-9 && s.depthGap <= s.depthLimit*scale+1e-9)).length })),
      trials: [1,.9,.8,.7].map(scale => ({ scale, kept: samples.filter(s=>s.requiredRadius<=s.radius*scale+1e-9).length })) };
  });
}
