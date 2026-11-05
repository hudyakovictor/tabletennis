'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const { Stamina, STAMINA_CONFIG: cfg } = load(['13_stamina.js'], ['Stamina', 'STAMINA_CONFIG'], {
  document: undefined, window: undefined, localStorage: undefined, GS: undefined, PH: undefined,
  Date: undefined, performance: undefined, setInterval: undefined,
});

function close(actual, expected, message = '') {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
}

function sameState(actual, expected) {
  for (const key of ['energy', 'fatigue', 'regenDelayRemaining']) close(actual[key], expected[key], key);
  assert.equal(actual.low, expected.low);
}

function valid(state) {
  assert.ok(Stamina.validateRestore(state), JSON.stringify(state));
  assert.ok(state.energy >= 0 && state.energy <= Stamina.capacity(state));
  assert.ok(state.fatigue >= 0 && state.fatigue <= cfg.fatigueMax);
}

function elapsed(state, seconds, fps) {
  if (!fps) return Stamina.advance(state, seconds);
  const frames = Math.floor(seconds * fps);
  for (let i = 0; i < frames; i++) state = Stamina.advance(state, 1 / fps);
  return Stamina.advance(state, seconds - frames / fps);
}

function rallies(strokes, fps) {
  let players = [Stamina.fresh(), Stamina.fresh()];
  for (let rally = 0; rally < 14; rally++) {
    for (const strokeId of strokes) {
      players = players.map(state => Stamina.charge(elapsed(state, 1.2, fps),
        Stamina.cost({ strokeId, effort: .8, kind: 'swing' })));
    }
    // The caller grants one fixed point credit, not continuous serve-wait healing.
    players = players.map(state => Stamina.advance({ ...state,
      energy: Math.min(Stamina.capacity(state), state.energy + cfg.pointRecovery),
    }, 0));
  }
  return players;
}

test('fresh state is independent; module runs without game, DOM, storage or clocks', () => {
  const a = Stamina.fresh(), b = Stamina.fresh();
  assert.notEqual(a, b);
  assert.deepEqual({ ...a }, { energy: 100, fatigue: 0, regenDelayRemaining: 0, low: false });
  assert.equal(Stamina.capacity(a), 100);
  assert.equal(Stamina.effortScale(a), 1);
  a.energy = 0;
  assert.equal(b.energy, 100);
  valid(Stamina.advance(Stamina.charge(b, 10), 1));
});

test('central costs cover exactly the plan twenty techniques and stay immutable', () => {
  assert.deepEqual({ ...cfg.costs }, {
    DRIVE: 8, LOOP: 12, COUNTER: 10, SMASH: 17,
    SIDE: 8, HOOK: 10, FADE: 10, FLICK: 8, BANANA: 10,
    PUSH: 4, CHOP: 7, CHOP_BLOCK: 4, BLOCK: 3, LOB: 6, DROP: 4,
    SERVE_TOP: 6, SERVE_BACK: 6, SERVE_SIDE: 7, SERVE_FAST: 9, SERVE_NO_SPIN: 4,
  });
  for (const value of [cfg, cfg.costs, cfg.intensity, cfg.curve]) assert.ok(Object.isFrozen(value));
  assert.throws(() => { cfg.costs.SMASH = 0; }, TypeError);
  for (const [strokeId, base] of Object.entries(cfg.costs)) {
    for (const effort of [0, .2, .5, .8, 1]) {
      close(Stamina.cost({ strokeId, effort }), base * (.5 + .5 * effort ** 2), strokeId);
    }
    assert.equal(Stamina.cost({ strokeId, effort: -1 }), base / 2);
    assert.equal(Stamina.cost({ strokeId, effort: 2 }), base);
    assert.equal(Stamina.cost({ strokeId, effort: 0, kind: 'tap' }), 2);
    assert.equal(Stamina.cost({ strokeId, effort: 1, kind: 'tap' }), 2);
  }
});

test('cost rejects numeric coercion and ignores hit, speed, score and side metadata', () => {
  for (const effort of [NaN, Infinity, -Infinity, undefined, null, '1']) {
    assert.equal(Stamina.cost({ strokeId: 'SMASH', effort }), 8.5);
  }
  for (const strokeId of ['UNKNOWN', '__proto__', 'constructor', undefined]) {
    assert.equal(Stamina.cost({ strokeId, effort: 1 }), cfg.costs.DRIVE);
  }
  assert.equal(Stamina.cost(null), cfg.costs.DRIVE / 2);
  const motion = { strokeId: 'LOOP', effort: .8, kind: 'swing' };
  assert.equal(Stamina.cost({ ...motion, hit: true, side: 1, kmh: 90, score: [7, 7] }),
    Stamina.cost({ ...motion, hit: false, side: -1, kmh: 0, score: [0, 0] }));
});

test('charge returns a new state, spends work once and restarts the cooldown', () => {
  const before = Object.freeze(Stamina.fresh());
  const after = Stamina.charge(before, 17);
  assert.notEqual(after, before);
  sameState(before, Stamina.fresh());
  sameState(after, { energy: 83, fatigue: 1.19, regenDelayRemaining: .55, low: false });
  close(Stamina.capacity(after), 98.81);
  const partial = Stamina.advance(after, .4);
  const extra = Stamina.charge(partial, 2);
  close(extra.regenDelayRemaining, .55);
  close(extra.energy, 81);
  close(extra.fatigue, 1.33);
  for (const work of [0, -1, NaN, Infinity, -Infinity, undefined, '4']) {
    const copy = Stamina.charge(partial, work);
    assert.notEqual(copy, partial);
    sameState(copy, partial);
  }
});

test('exhausted work still adds fatigue; huge finite inputs remain bounded', () => {
  const empty = Object.freeze({ energy: 0, fatigue: 10, regenDelayRemaining: 0, low: true });
  const after = Stamina.charge(empty, 17);
  close(after.fatigue, 11.19);
  assert.equal(after.energy, 0);
  const exhausted = Stamina.charge(after, Number.MAX_VALUE);
  assert.equal(exhausted.fatigue, 45);
  assert.equal(exhausted.energy, 0);
  assert.equal(Stamina.capacity(exhausted), 55);
  const recovered = Stamina.advance(exhausted, Number.MAX_VALUE);
  assert.equal(recovered.energy, 55);
  assert.equal(recovered.fatigue, 45);
  valid(recovered);
});

test('positive ledger top-ups equal one total charge, including past zero energy', () => {
  for (const start of [Stamina.fresh(), { energy: 5, fatigue: 10, regenDelayRemaining: .1, low: true }]) {
    const work = [3, 7.2, 9.5, 20];
    const split = work.reduce((state, delta) => Stamina.charge(state, delta), start);
    sameState(split, Stamina.charge(start, work.reduce((sum, delta) => sum + delta, 0)));
    valid(split);
  }
});

test('runtime normalization is finite and depleted, never a NaN-to-fresh reset', () => {
  for (const input of [null, undefined, {},
    { energy: NaN, fatigue: Infinity, regenDelayRemaining: NaN, low: false },
    { energy: 900, fatigue: 90, regenDelayRemaining: 12, low: false },
    { energy: -1, fatigue: -1, regenDelayRemaining: -1, low: true }]) {
    const result = Stamina.advance(input, 0);
    valid(result);
    assert.ok(Number.isFinite(Stamina.capacity(input)));
    assert.ok(Number.isFinite(Stamina.effortScale(input)));
  }
  const invalid = Stamina.charge({ energy: NaN, fatigue: NaN }, NaN);
  assert.equal(invalid.energy, 0);
  assert.equal(invalid.fatigue, 45);
  assert.equal(invalid.low, true);
});

test('cooldown uses only eligible simulation time and integrates the crossing exactly', () => {
  const state = Object.freeze(Stamina.charge(Stamina.fresh(), 40));
  const early = Stamina.advance(state, .2);
  close(early.energy, 60);
  close(early.regenDelayRemaining, .35);
  const boundary = Stamina.advance(state, .55);
  assert.equal(boundary.energy, 60);
  assert.equal(boundary.regenDelayRemaining, 0);
  close(Stamina.advance(state, .8).energy, 61);
  sameState(Stamina.advance(early, .6), Stamina.advance(state, .8));
  for (const dt of [0, -1, NaN, Infinity, -Infinity, null, undefined, '3']) {
    const copy = Stamina.advance(state, dt);
    assert.notEqual(copy, state);
    sameState(copy, state);
  }
  // Pause supplies no simulation time; slow motion supplies only its scaled step.
  let paused = state;
  for (let frame = 0; frame < 240; frame++) paused = Stamina.advance(paused, 0);
  sameState(paused, state);
  close(Stamina.advance(state, 2 * .25).energy, state.energy);
  close(Stamina.advance(state, 2).energy, 65.8);
});

test('recovery is invariant to timestep splits, including saturation and low-latch transitions', () => {
  for (const start of [Stamina.charge(Stamina.fresh(), 40),
    { energy: 24, fatigue: 30, regenDelayRemaining: .17, low: true }]) {
    for (const seconds of [.55, 1.2, 2.2, 30]) {
      const once = Stamina.advance(start, seconds);
      for (const fps of [30, 60, 120, 144, 240]) sameState(elapsed(start, seconds, fps), once);
      const parts = [.1, .2, .3, .4].map(fraction => fraction * seconds);
      sameState(parts.reduce((state, dt) => Stamina.advance(state, dt), start), once);
      assert.equal(once.fatigue, start.fatigue);
    }
  }
});

test('low warning enters below 25, leaves above 30 and preserves the deadband latch', () => {
  for (const low of [false, true]) {
    for (const energy of [25, 27.5, 30]) {
      const state = Stamina.advance({ energy, fatigue: 10, regenDelayRemaining: 0, low }, 0);
      assert.equal(state.low, low);
      assert.equal(Stamina.validateRestore(state).low, low);
    }
  }
  const entered = Stamina.charge({ energy: 25, fatigue: 10, regenDelayRemaining: 0, low: false }, .01);
  assert.equal(entered.low, true);
  const held = Stamina.advance({ energy: 29, fatigue: 10, regenDelayRemaining: 0, low: true }, .25);
  assert.equal(held.energy, 30);
  assert.equal(held.low, true);
  for (const fps of [30, 60, 120, 144, 240]) {
    sameState(elapsed({ energy: 29, fatigue: 10, regenDelayRemaining: 0, low: true }, .25, fps), held);
  }
  assert.equal(Stamina.advance(held, .001).low, false);
});

test('restore strictly rejects malformed data instead of silently making a fresh state', () => {
  for (const raw of [null, undefined, [], 1, 'fresh', {}, { ...Stamina.fresh(), low: true }]) {
    assert.equal(Stamina.validateRestore(raw), null);
  }
  for (const field of ['energy', 'fatigue', 'regenDelayRemaining', 'low']) {
    const missing = { ...Stamina.fresh() };
    delete missing[field];
    assert.equal(Stamina.validateRestore(missing), null, `missing ${field}`);
    for (const value of [NaN, Infinity, -Infinity, null, '0']) {
      assert.equal(Stamina.validateRestore({ ...Stamina.fresh(), [field]: value }), null, field);
    }
  }
  for (const patch of [{ energy: -1 }, { energy: 101 }, { fatigue: -1 }, { fatigue: 46 },
    { energy: 56, fatigue: 45 }, { regenDelayRemaining: -.01 }, { regenDelayRemaining: .5501 },
    { energy: 24.9, low: false }, { energy: 30.1, low: true }]) {
    assert.equal(Stamina.validateRestore({ ...Stamina.fresh(), ...patch }), null);
  }
});

test('valid restore detaches state and preserves fatigue, cooldown and hysteresis', () => {
  for (const state of [Stamina.fresh(), { energy: 0, fatigue: 45, regenDelayRemaining: .55, low: true },
    { energy: 55, fatigue: 45, regenDelayRemaining: 0, low: false },
    { energy: 27, fatigue: 23, regenDelayRemaining: .37, low: true }]) {
    const raw = JSON.parse(JSON.stringify(state));
    const restored = Stamina.validateRestore(Object.freeze(raw));
    assert.notEqual(restored, raw);
    sameState(restored, state);
    sameState(Stamina.advance(restored, 1.2), Stamina.advance(state, 1.2));
    restored.energy = 0;
    assert.equal(raw.energy, state.energy);
  }
});

test('effort follows the configured smooth curve with nonzero exhausted defense', () => {
  for (const fatigue of [0, 20, 45]) {
    const cap = cfg.energyMax - fatigue, fatigueFactor = 1 - .12 * fatigue / 45;
    let previous = 0;
    for (let energy = 0; energy <= cap; energy += .5) {
      const scale = Stamina.effortScale({ energy, fatigue });
      assert.ok(scale >= previous && scale >= .528 && scale <= 1);
      previous = scale;
    }
    close(Stamina.effortScale({ energy: .15 * cap, fatigue }), .6 * fatigueFactor);
    close(Stamina.effortScale({ energy: .375 * cap, fatigue }), .8 * fatigueFactor);
    close(Stamina.effortScale({ energy: .6 * cap, fatigue }), fatigueFactor);
  }
  close(Stamina.effortScale({ energy: 0, fatigue: 45 }), .528);
});

test('budgets are immutable pre-charge snapshots with a continuous own-effort ceiling', () => {
  const request = { actionId: 'swing:12', side: -1, strokeId: 'SMASH', requestedVmag: 15.6, freshVmagCap: 19.5, effort: .8 };
  const fresh = Stamina.deriveEffortBudget(Stamina.fresh(), Object.freeze({ ...request }));
  assert.equal(fresh.vmagCap, 19.5);
  assert.equal(fresh.limited, false);
  const state = Object.freeze({ energy: 30, fatigue: 30, regenDelayRemaining: .2, low: false });
  const budget = Stamina.deriveEffortBudget(state, request);
  assert.ok(Object.isFrozen(budget));
  assert.deepEqual(Object.keys(budget).sort(),
    ['actionId', 'side', 'requestedVmag', 'freshVmagCap', 'effortScale', 'vmagCap', 'limited'].sort());
  close(budget.vmagCap, request.freshVmagCap * Stamina.effortScale(state));
  const almostFresh = Stamina.deriveEffortBudget(Stamina.charge(Stamina.fresh(), 1e-6), request);
  assert.ok(fresh.vmagCap - almostFresh.vmagCap < 1e-6);
  assert.equal(budget.actionId, request.actionId);
  assert.equal(budget.side, -1);
  assert.equal(budget.limited, true);
  assert.throws(() => { budget.vmagCap = 100; }, TypeError);
  request.requestedVmag = 999;
  assert.equal(budget.requestedVmag, 15.6);
  assert.ok(Stamina.deriveEffortBudget(Stamina.charge(state, 17), { ...request, requestedVmag: 15.6 }).vmagCap < budget.vmagCap);
  sameState(state, { energy: 30, fatigue: 30, regenDelayRemaining: .2, low: false });
});

test('budget invalid numbers are bounded and repeated attacks progressively lose own-effort ceiling', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, undefined, '9']) {
    const budget = Stamina.deriveEffortBudget(null, { requestedVmag: value, freshVmagCap: value, side: 0, actionId: {} });
    assert.equal(budget.vmagCap, 0);
    assert.equal(budget.requestedVmag, 0);
    assert.equal(budget.freshVmagCap, 0);
    assert.equal(budget.actionId, null);
    assert.equal(budget.side, null);
    assert.ok(Number.isFinite(budget.effortScale));
  }
  const request = { actionId: 1, side: 1, strokeId: 'SMASH', requestedVmag: 15.6, freshVmagCap: 19.5, effort: .8 };
  let state = { energy: 45, fatigue: 30, regenDelayRemaining: 0, low: false };
  const caps = [];
  for (let swing = 0; swing < 3; swing++) {
    caps.push(Stamina.deriveEffortBudget(state, request).vmagCap);
    state = Stamina.advance(Stamina.charge(state, Stamina.cost(request)), 1.2);
  }
  assert.ok(caps[1] < caps[0] && caps[2] < caps[1], caps.join(', '));
  assert.ok(caps[2] < caps[0] * .8, caps.join(', '));
  for (const strokeId of ['BLOCK', 'PUSH', 'SERVE_NO_SPIN']) {
    assert.ok(Stamina.deriveEffortBudget({ energy: 0, fatigue: 45 }, { ...request, strokeId }).vmagCap > 0);
  }
});

test('14 rallies of four .8-effort returns reward mixed play and economical defense without score coupling', t => {
  const scenarios = {
    mixed: ['LOOP', 'SMASH', 'BLOCK', 'PUSH'],
    attack: ['SMASH', 'SMASH', 'SMASH', 'SMASH'],
    defense: ['BLOCK', 'PUSH', 'CHOP_BLOCK', 'DROP'],
  };
  const results = {};
  for (const [name, strokes] of Object.entries(scenarios)) {
    const [near, far] = rallies(strokes);
    sameState(near, far);
    valid(near);
    assert.ok(near.fatigue > 0);
    for (const fps of [30, 60, 120, 144]) sameState(rallies(strokes, fps)[0], near);
    results[name] = near;
  }
  t.diagnostic(JSON.stringify(results));
  assert.equal(results.attack.fatigue, 45);
  close(results.mixed.fatigue, 28.9296);
  close(results.defense.fatigue, 12.054);
  assert.ok(results.attack.fatigue > results.mixed.fatigue * 1.5);
  assert.ok(results.mixed.fatigue > results.defense.fatigue * 2);
  assert.ok(results.defense.energy > results.mixed.energy);
  // This heavy mixed sequence also depletes E, so both end at the fixed point credit.
  assert.equal(results.mixed.energy, cfg.pointRecovery);
  assert.equal(results.attack.energy, cfg.pointRecovery);
  assert.ok(Stamina.capacity(results.mixed) > Stamina.capacity(results.attack));
  assert.ok(Stamina.effortScale(results.attack) < Stamina.effortScale(results.mixed));
  const state = results.mixed, request = { strokeId: 'SMASH', effort: .8, requestedVmag: 15.6, freshVmagCap: 19.5, side: 1, actionId: 2 };
  const atSeven = { ...state, score: [7, 7] };
  sameState(Stamina.advance(atSeven, 1.2), Stamina.advance(state, 1.2));
  sameState(Stamina.charge(atSeven, Stamina.cost(request)), Stamina.charge(state, Stamina.cost(request)));
  assert.deepEqual(Stamina.deriveEffortBudget(atSeven, request), Stamina.deriveEffortBudget(state, request));
  sameState(Stamina.fresh(), { energy: 100, fatigue: 0, regenDelayRemaining: 0, low: false });
});
