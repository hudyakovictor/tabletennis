const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load: loadEngine } = require('./helpers.cjs');

const source = fs.readFileSync(path.join(__dirname, '../tt/src/06_calibration.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
function load(forgiveness = 1) {
  const capture = [];
  let personal = 1;
  const context = vm.createContext({
    CAM_ADJUST: { pitchMin: -16, pitchMax: 16, zoomMin: .6, zoomMax: 1.8 },
    STROKE_CONFIG: { racket: { trackingLagRange: [1 / 68, 1 / 36] }, serve: { toss: { speed: 2.1, speedSpan: .75 } } },
    MATCH_RULES: { captureRadius: .22, depthTolerance: .22, serveCaptureRadius: .55 },
    setCaptureCalibration(value) { personal = value; capture.push(value); },
    getCaptureCalibration: () => personal, getCaptureForgiveness: () => forgiveness,
    getCaptureEnvelope: () => forgiveness * personal,
  });
  vm.runInContext(source + '\n;globalThis.api = { CALIBRATION_REGISTRY, normalizeCalibrations, calibrationPace, gameplayCalibrationLocked, calibrationState, refreshGameCalibrationPolicy, applyGameCalibration, applyGameCalibrations };', context);
  return { ...context.api, capture, forceCapture: context.setCaptureCalibration };
}
function game(extra = {}) {
  return { settings: { camPitch: 0, camZoom: 1, showTrail: true }, sessionKind: 'free',
    slowmo: { on: false, active: false, allowed: true, energy: .7 }, inspectSlowmo: false, hintContact: true,
    career: { active: false }, network: { isInMatch: false }, motionOff: false, motionQuery: { matches: false },
    time: 10, strokeTime: 8, timeScale: 1, ball: { p: [0, 1, 1], v: [1, 2, 3], w: [4, 5, 6], hist: [] },
    scene: { mat: { table: { color: [.1, .2, .3], roughness: .6, emissive: [.2, .2, .2] } }, mesh: { trail: { count: 90 } } },
    setCamPitch(value) { this.settings.camPitch = Math.round(value * 2) / 2; },
    setCamZoom(value) { this.settings.camZoom = Math.round(value * 100) / 100; }, ...extra };
}

test('the only calibration registry is serializable, unique, fractional and complete', () => {
  const { CALIBRATION_REGISTRY: registry } = load();
  assert.equal(registry.length, 17); assert.equal(new Set(registry.map(row => row.key)).size, 17);
  const defaults = { camHeight: 50, camZoom: 50, camSway: 0, padSpeed: 100 * (1 - .84) / .36,
    padSmooth: 40.625, fingerTrail: 55, spinGain: 100 * (1 - .5) / 1.1, arcSens: 100 * (1 - .6) / 1.2,
    tossHeight: 45, ballSize: 50, trailLen: 33, flytime: 50, tableGlow: 0, hintRadius: 60, captureK: 50,
    hintGlow: 65, slowmoDepth: 100 * (.55 - .30) / .43 };
  assert.deepEqual(Object.fromEntries(registry.map(row => [row.key, row.default])), defaults);
  assert.equal(Object.isFrozen(registry), true);
  for (const row of registry) {
    assert.equal(Object.isFrozen(row), true); assert.equal(row.min, 0); assert.equal(row.max, 100); assert.equal(row.step, 'any');
    for (const key of ['labelRu', 'labelEn', 'descriptionRu', 'descriptionEn', 'unit', 'scope', 'group']) assert.ok(typeof row[key] === 'string' && row[key]);
  }
  assert.deepEqual(plain(registry), JSON.parse(JSON.stringify(registry)));
});

test('raw normalization retains zero/fractions and rejects invalid or inherited preferences', () => {
  const { CALIBRATION_REGISTRY: registry, normalizeCalibrations: normalize } = load();
  for (const raw of [null, undefined, [], true, 1, 'bad']) {
    const values = normalize(raw); assert.equal(Object.keys(values).length, 17);
    for (const row of registry) assert.equal(values[row.key], row.default / 100);
  }
  const raw = { camSway: 0, flytime: '0', padSmooth: '40.625', spinGain: NaN, arcSens: Infinity, camZoom: -10,
    captureK: 400, slowmoDepth: null, fingerTrail: true, tableGlow: '', unknown: 100 };
  Object.setPrototypeOf(raw, { hintRadius: 100 });
  const normalized = normalize(raw);
  assert.equal(normalized.camSway, 0); assert.equal(normalized.flytime, 0); assert.equal(normalized.padSmooth, .40625);
  assert.equal(normalized.camZoom, 0); assert.equal(normalized.captureK, 1); assert.equal(normalized.hintRadius, .6);
  for (const key of ['spinGain', 'arcSens', 'slowmoDepth', 'fingerTrail', 'tableGlow']) assert.equal(normalized[key], registry.find(row => row.key === key).default / 100);
  assert.equal(Object.hasOwn(normalized, 'unknown'), false); assert.equal(raw.captureK, 400);
  const poisoned = normalize(JSON.parse('{"__proto__":{"flytime":0},"constructor":0,"flytime":0}'));
  assert.equal(Object.hasOwn(poisoned, '__proto__'), false); assert.equal(Object.hasOwn(poisoned, 'constructor'), false); assert.equal(poisoned.flytime, 0);
});

test('pace is exactly .35/1/1.25 at 0/50/100 and monotonic on both segments', () => {
  const { calibrationPace: pace } = load();
  assert.equal(pace(0), .35); assert.equal(pace(.5), 1); assert.equal(pace(1), 1.25);
  assert.equal(pace(.25), .675); assert.equal(pace(.75), 1.125);
  assert.equal(pace(-10), .35); assert.equal(pace(10), 1.25);
  for (const invalid of [null, true, '', NaN, Infinity, {}, undefined]) assert.equal(pace(invalid), 1);
  for (let i = 1; i <= 1000; i++) assert.ok(pace(i / 1000) >= pace((i - 1) / 1000));
});

test('startup applies every exact neutral default, leaving ball physics, clocks and progress unchanged', () => {
  const api = load(), g = game();
  g.trainingProfile = { lessons: { LOOP: { mastered: true } } }; g.inventory = ['owned'];
  const physical = plain({ p: g.ball.p, v: g.ball.v, w: g.ball.w, training: g.trainingProfile, inventory: g.inventory });
  const state = api.applyGameCalibrations(g, {});
  assert.equal(Object.keys(g._cal).length, 17); assert.equal(g.settings.camPitch, 0); assert.equal(g.settings.camZoom, 1);
  assert.equal(g._swayCal, 0); assert.equal(g.settings.spinGain, 1); assert.equal(g.settings.arcSens, 1);
  assert.equal(g._calValues.padSpeed, 1); assert.equal(g._calValues.padSmooth, 1000 / 55);
  assert.equal(g._calValues.ballSize, 1.05); assert.equal(g._calValues.hintRadius, 1); assert.equal(g._calValues.captureK, 1);
  assert.equal(g._calValues.slowmoDepth, .30); assert.ok(Math.abs(g._calValues.trailLen - 176) < 1e-12); assert.equal(g._calValues.tossHeight, 2.4375);
  assert.equal(state.pace, 1); assert.equal(state.inspector.requested, false); assert.equal(state.inspector.effective, false);
  assert.deepEqual(plain(g.scene.mat.table.emissive), [0, 0, 0]); assert.deepEqual(api.capture, [1]);
  assert.deepEqual(plain({ p: g.ball.p, v: g.ball.v, w: g.ball.w, training: g.trainingProfile, inventory: g.inventory }), physical);
  assert.deepEqual(plain(state.time), { real: 10, simulation: 8, timeScale: 1 });
});

test('one-key updates retain other requests and never reapply unrelated camera setters', () => {
  const api = load(), calls = [], g = game({ setCamPitch(v) { calls.push('pitch'); this.settings.camPitch = v; },
    setCamZoom(v) { calls.push('zoom'); this.settings.camZoom = v; } });
  api.applyGameCalibrations(g, { flytime: 0, captureK: 100, padSmooth: 80 }); calls.length = 0;
  const before = plain(g._cal); api.applyGameCalibration(g, 'spinGain', 0);
  for (const key of Object.keys(before).filter(key => key !== 'spinGain')) assert.equal(g._cal[key], before[key]);
  assert.equal(g.settings.spinGain, .5); assert.deepEqual(calls, []);
  api.applyGameCalibration(g, 'spinGain', Infinity); assert.equal(g.settings.spinGain, 1);
  const saved = plain(g._cal); api.applyGameCalibration(g, '__proto__', 0); api.applyGameCalibration(g, 'notRegistered', 100);
  assert.deepEqual(plain(g._cal), saved); assert.equal(Object.hasOwn(g._cal, '__proto__'), false);
});

test('full saved/default application replaces calibration only and does not mutate its raw input', () => {
  const api = load(), g = game(), raw = { flytime: 0, captureK: 100, ballSize: 100 };
  api.applyGameCalibrations(g, raw); assert.equal(g._cal.flytime, 0); assert.equal(g._cal.captureK, 1);
  api.applyGameCalibrations(g, { tableGlow: 0 });
  assert.equal(g._cal.flytime, .5); assert.equal(g._cal.captureK, .5); assert.equal(g._cal.ballSize, .5);
  assert.deepEqual(raw, { flytime: 0, captureK: 100, ballSize: 100 });
});

for (const kind of ['free', 'practice', 'ranked', 'career', 'check', 'online']) {
  test('requested/effective calibration policy for ' + kind, () => {
    const api = load(), g = game({ sessionKind: kind, inspectSlowmoRequested: true, inspectSlowmo: true });
    const state = api.applyGameCalibrations(g, { flytime: 0, captureK: 100, spinGain: 100, slowmoDepth: 100 });
    const locked = !['free', 'practice'].includes(kind);
    assert.equal(api.gameplayCalibrationLocked(g), locked); assert.equal(state.locked, locked); assert.equal(state.sessionKind, kind);
    assert.equal(g._cal.flytime, 0); assert.equal(g._cal.captureK, 1); assert.equal(g._cal.slowmoDepth, 1);
    assert.equal(g._calEffective.flytime, locked ? .5 : 0); assert.equal(g._calEffective.captureK, locked ? .5 : 1);
    assert.equal(state.pace, locked ? 1 : .35); assert.equal(state.requestedPace, .35);
    assert.equal(g._capCalK, locked ? 1 : 1.3); assert.equal(g.settings.spinGain, 1.6);
    assert.equal(state.inspector.requested, true); assert.equal(state.inspector.effective, !locked); assert.equal(state.hint.effective, !locked);
    assert.equal(g.settings.hint, !locked);
  });
}

for (const extra of [{ network: { isInMatch: true } }, { career: { active: true } }, { training: { stage: 'check' } }]) {
  test('actual active regime overrides a stale free session kind: ' + Object.keys(extra)[0], () => {
    const api = load(), g = game(extra); api.applyGameCalibrations(g, { flytime: 0, captureK: 100 });
    assert.equal(api.gameplayCalibrationLocked(g), true); assert.equal(g._calEffective.flytime, .5); assert.equal(g._calEffective.captureK, .5);
    g.network.isInMatch = false; g.career.active = false; g.training = null; g.sessionKind = 'free';
    const resumed = api.refreshGameCalibrationPolicy(g);
    assert.equal(resumed.locked, false); assert.equal(resumed.pace, .35); assert.equal(g._capCalK, 1.3);
    assert.equal(g._cal.flytime, 0); assert.equal(g._cal.captureK, 1);
  });
}

test('OS OR requested reduced motion suppresses optional camera tracking without losing its preference', () => {
  const api = load(), g = game(); api.applyGameCalibrations(g, { camSway: 100 });
  for (const [user, os, expected] of [[false, false, false], [false, true, true], [true, false, true], [true, true, true]]) {
    g.motionOff = user; g.motionQuery.matches = os; g.reducedMotion = !expected;
    const state = api.refreshGameCalibrationPolicy(g, '_policy');
    assert.equal(state.reducedMotion, expected); assert.equal(g._swayCal, expected ? 0 : 1); assert.equal(g._cal.camSway, 1);
    assert.equal(state.restrictions.camSway, expected ? 'reduced-motion' : '');
  }
});

test('explicit hint OFF and inspector restrictions stay effective without erasing requests', () => {
  const api = load(), g = game({ hintRequested: false, training: { stage: 'practice' } });
  api.applyGameCalibrations(g, {}); g.inspectSlowmoRequested = true; g.slowmo.allowed = false;
  const state = api.refreshGameCalibrationPolicy(g, '_policy');
  assert.equal(g.hintContact, false); assert.equal(state.hint.requested, false); assert.equal(state.restrictions.hintRadius, 'hint-off');
  assert.equal(g.settings.hint, false);
  assert.equal(state.inspector.requested, true); assert.equal(state.inspector.allowed, false); assert.equal(state.inspector.effective, false);
});

test('trail shrink/off is immediate and table glow does not replace color or other material properties', () => {
  const api = load(), g = game(); api.applyGameCalibrations(g, { trailLen: 100 });
  g.ball.hist = Array.from({ length: 96 }, (_, i) => i);
  api.applyGameCalibration(g, 'trailLen', 33); assert.equal(g.ball.hist.length, 33);
  api.applyGameCalibration(g, 'trailLen', 0); assert.equal(g.ball.hist.length, 0); assert.equal(g.scene.mesh.trail.count, 0);
  const color = g.scene.mat.table.color;
  api.applyGameCalibration(g, 'tableGlow', 100); assert.equal(g.scene.mat.table.color, color); assert.equal(g.scene.mat.table.roughness, .6);
  assert.deepEqual(plain(g.scene.mat.table.emissive), [.018, .042, .10]);
  api.applyGameCalibration(g, 'tableGlow', 0); assert.deepEqual(plain(g.scene.mat.table.emissive), [0, 0, 0]);
});

test('diagnostic snapshot contains every sanitized request/effect, actual camera trims and both clocks, detached from Game', () => {
  const api = load(), g = game(); api.applyGameCalibrations(g, { camHeight: 51, camZoom: 50.4, tossHeight: 80, captureK: 0 });
  const state = api.calibrationState(g);
  for (const field of ['requested', 'effective', 'raw', 'active', 'restrictions']) assert.equal(Object.keys(state[field]).length, 17);
  assert.equal(state.values.effective.camHeight, .5); assert.equal(state.values.effective.camZoom, 1.01);
  assert.equal(state.requested.captureK, 0); assert.equal(state.requested.tossHeight, .8);
  assert.doesNotThrow(() => JSON.stringify(state));
  state.requested.captureK = .9; state.effective.flytime = 0; state.values.effective.spinGain = 5;
  assert.equal(g._cal.captureK, 0); assert.equal(g._calEffective.flytime, .5); assert.equal(g._calValues.spinGain, 1);
  assert.deepEqual(plain(api.calibrationState(g).time), { real: 10, simulation: 8, timeScale: 1 });
});

test('capture diagnostics use actual global envelope and separate regulation serve forgiveness', () => {
  const api = load(1.2), g = game();
  const state = api.applyGameCalibrations(g, { captureK: 100 });
  assert.equal(state.capture.personal, 1.3); assert.equal(state.capture.forgiveness, 1.2);
  assert.equal(state.capture.radius, .22 * (1.2 * 1.3)); assert.equal(state.capture.depth, .22 * (1.2 * 1.3));
  assert.equal(state.capture.serveRadius, .55 * 1.2);
  const context = vm.createContext({}); vm.runInContext(source + '\n;globalThis.state = calibrationState(null);', context);
  assert.equal(context.state.capture.radius, null); assert.equal(context.state.capture.depth, null); assert.equal(context.state.capture.serveRadius, null);
  assert.doesNotThrow(() => JSON.stringify(context.state));
});

test('policy refresh repairs global capture drift and unrelated full settings do not trim an unchanged live trail', () => {
  const api = load(), g = game(); api.applyGameCalibrations(g, {});
  api.forceCapture(1.3); assert.equal(g._capCalK, 1);
  assert.equal(api.refreshGameCalibrationPolicy(g, '_policy').capture.personal, 1);
  g.ball.hist = Array.from({ length: 96 }, (_, i) => i);
  api.applyGameCalibrations(g, {}); assert.equal(g.ball.hist.length, 96);
  api.applyGameCalibration(g, 'trailLen', 10); assert.equal(g.ball.hist.length, 9);
});

for (const hz of [60, 120]) {
  test(`timed trail shrink at ${hz} Hz keeps the exact cutoff paired through the next live append`, () => {
    const api = load(), g = game();
    const { Game } = loadEngine(['10_math.js', '30_physics.js', '70_game.js'], ['Game']);
    api.applyGameCalibrations(g, { trailLen: 100 });
    const samples = Array.from({ length: hz + 1 }, (_, i) => g.time - 1 + i / hz);
    g.ball.histTimes = [...samples]; g.ball.hist = samples.flatMap(t => [t, 2 * t, -t]);
    g.ball.trailSampleAt = g.time;
    api.applyGameCalibration(g, 'trailLen', 33);
    for (let step = 0; step < 2; step++) {
      const cutoff = g.time - .176, expected = [cutoff, ...samples.filter(t => t > cutoff)];
      assert.equal(g.ball.hist.length, g.ball.histTimes.length * 3, 'positions and timestamps remain paired');
      assert.equal(g.ball.histTimes.length, expected.length);
      for (let i = 0; i < expected.length; i++) {
        assert.ok(Math.abs(g.ball.histTimes[i] - expected[i]) < 1e-12, 'the oldest sample is exactly at the cutoff');
        for (const [axis, factor] of [[0, 1], [1, 2], [2, -1]]) {
          assert.ok(Math.abs(g.ball.hist[i * 3 + axis] - factor * expected[i]) < 1e-12, 'interpolation preserves timestamp/position pairing');
        }
      }
      if (!step) {
        g.time += 1 / hz; samples.push(g.time); g.ball.p = { x: g.time, y: 2 * g.time, z: -g.time };
        Game.prototype.recordBallTrail.call(g);
      }
    }
    api.applyGameCalibration(g, 'trailLen', 0);
    assert.equal(g.ball.hist.length, 0); assert.equal(g.ball.histTimes.length, 0); assert.equal(g.scene.mesh.trail.count, 0);
  });
}

for (const toggle of ['requested motion', 'OS motion', 'trail visibility']) {
  test(`${toggle} policy toggle clears both timed histories immediately and retains the trail request`, () => {
    const api = load(), g = game();
    const { Game } = loadEngine(['10_math.js', '30_physics.js', '70_game.js'], ['Game']);
    api.applyGameCalibrations(g, { trailLen: 33 });
    g.ball.histTimes = [9.99, 10]; g.ball.hist = [0, 1, 2, 3, 4, 5];
    if (toggle === 'requested motion') g.motionOff = true;
    else if (toggle === 'OS motion') g.motionQuery.matches = true;
    else g.settings.showTrail = false;
    const off = api.refreshGameCalibrationPolicy(g, '_policy');
    assert.equal(g.ball.hist.length, 0); assert.equal(g.ball.histTimes.length, 0); assert.equal(g.scene.mesh.trail.count, 0);
    assert.equal(off.requested.trailLen, .33); assert.equal(off.active.trailLen, false);
    g.motionOff = false; g.motionQuery.matches = false; g.settings.showTrail = true;
    assert.equal(api.refreshGameCalibrationPolicy(g, '_policy').active.trailLen, true);
    assert.equal(g.ball.hist.length, 0, 'reenabling does not restore an old trail');
    g.time += 1 / 60; g.ball.p = { x: 0, y: 1, z: 2 };
    Game.prototype.recordBallTrail.call(g);
    assert.equal(g.ball.hist.length, 3); assert.equal(g.ball.histTimes.length, 1); assert.equal(g.ball.histTimes[0], g.time);
  });
}
