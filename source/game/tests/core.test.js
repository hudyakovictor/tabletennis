const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

test('trajectory and live physics agree on tabletop contact before the net in the same step', () => {
  const { Game, GS, PH, V3, Q, predict } = load(['10_math.js', '30_physics.js', '40_swipe.js', '70_game.js'],
    ['Game', 'GS', 'PH', 'V3', 'Q', 'predict']);
  for (const side of [-1, 1]) for (const vy of [-1, -.1]) {
    const p = V3.new(0, PH.TABLE_Y + PH.R + .0001, .03 * side);
    const v = V3.new(0, vy, -8 * side), w = V3.new(), bounces = [];
    const g = Object.create(Game.prototype);
    Object.assign(g, { time: 1, state: GS.RALLY, stats: {},
      ball: { p: V3.clone(p), v: V3.clone(v), w: V3.clone(w), q: Q.new(), live: true, lastHitBy: 1 },
      player: { lastHitT: 1 }, audio: { hitNet() {}, hitFloor() {} }, moments: { addBounce() {} },
      onBounce(hitSide) { bounces.push(hitSide); }, msg() {}, shakeIt() {}, _trailCrumb() {},
      watchdogSubstep() {}, emitParticles() {}, buzz() {} });
    g.stepPhysics(PH.SIM_DT);
    assert.deepEqual(bounces, [side]);
    assert.equal(!!g.netTouched, vy === -.1);
    for (const stop of [{}, { stopOnFirstBounce: true }, { stopAfterBounces: 1 }]) {
      const out = predict(p, v, w, { dt: PH.SIM_DT, maxT: PH.SIM_DT, ...stop });
      assert.equal(out.bounces, bounces.length);
      assert.equal(out.hitNet, !!g.netTouched);
      assert.ok(Math.abs(out.landed.z - g.ball.p.z) < 1e-9 || g.netTouched,
        'prediction uses the interpolated tabletop point, not the overshooting endpoint');
    }
  }
});

test('normal matrix follows model rotation in column-major order', () => {
  const { M4, Q, V3 } = load(['10_math.js'], ['M4', 'Q', 'V3']);
  for (const axis of [V3.new(1, 0, 0), V3.new(0, 1, 0), V3.new(0, 0, 1), V3.new(1, 2, -3)]) {
    const q = Q.setAxisAngle(Q.new(), axis.x, axis.y, axis.z, .73);
    const model = M4.compose(M4.create(), V3.new(3, -2, 5), q, V3.new(1, 1, 1));
    const before = Array.from(model), normal = new Float32Array(9);
    assert.equal(M4.normalFromMat4(normal, model), normal);
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) {
      assert.ok(Math.abs(normal[col * 3 + row] - model[col * 4 + row]) < 1e-6,
        `normal matrix must rotate with the model at column ${col}, row ${row}`);
    }
    assert.deepEqual(Array.from(model), before, 'normal extraction does not mutate the model');
  }
});

test('normal matrix preserves tangent-plane perpendicularity under rotation and nonuniform scale', () => {
  const { M4, Q, V3 } = load(['10_math.js'], ['M4', 'Q', 'V3']);
  const q = Q.fromEuler(Q.new(), .37, -.81, .22);
  const rotation = M4.compose(M4.create(), V3.new(), q, V3.new(1, 1, 1));
  const u = V3.new(1, 2, -1), v = V3.new(-2, 1, .5), n = V3.cross(V3.new(), u, v);
  for (const scale of [V3.new(.4, 1.8, 3.1), V3.new(-1.4, .65, 2.3)]) {
    const model = M4.compose(M4.create(), V3.new(7, -5, 3), q, scale);
    const normal = M4.normalFromMat4(new Float32Array(9), model);
    const transformed = V3.new(
      normal[0] * n.x + normal[3] * n.y + normal[6] * n.z,
      normal[1] * n.x + normal[4] * n.y + normal[7] * n.z,
      normal[2] * n.x + normal[5] * n.y + normal[8] * n.z);
    const expected = M4.transformDir(V3.new(), rotation, V3.new(n.x / scale.x, n.y / scale.y, n.z / scale.z));
    assert.ok(V3.dist(transformed, expected) < 2e-6, 'normal uses rotation and reciprocal scale');
    V3.norm(transformed, transformed);
    for (const tangent of [u, v]) {
      const t = M4.transformDir(V3.new(), model, tangent);
      V3.norm(t, t);
      assert.ok(Math.abs(V3.dot(transformed, t)) < 1e-6, 'normal stays perpendicular to both transformed tangents');
    }
  }
});

test('normal matrix retains the singular identity fallback and output buffer', () => {
  const { M4, Q, V3 } = load(['10_math.js'], ['M4', 'Q', 'V3']);
  for (const scale of [V3.new(0, 2, 3), V3.new(2, 0, 3), V3.new(2, 3, 0)]) {
    const model = M4.compose(M4.create(), V3.new(1, 2, 3), Q.fromEuler(Q.new(), .3, -.7, .2), scale);
    const normal = new Float32Array(9).fill(17);
    assert.equal(M4.normalFromMat4(normal, model), normal);
    assert.deepEqual(Array.from(normal), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
});

test('cylinder caps and unchanged box winding agree with supplied normals', () => {
  const { makeCylinder, makeBox, V3, TAU } = load(['10_math.js', '20_gl.js'], ['makeCylinder', 'makeBox', 'V3', 'TAU']);
  const meshes = [makeBox(2, .5, 3)];
  for (const [rTop, rBot, h, seg] of [[.05, .05, .08, 24], [.1, .2, .75, 7], [.2, .1, .75, 3]]) {
    const g = makeCylinder(rTop, rBot, h, seg), sides = makeCylinder(rTop, rBot, h, seg, false);
    assert.equal(g.nv, sides.nv + 2 * (seg + 2));
    assert.equal(g.ni, sides.ni + 6 * seg);
    for (const key of ['pos', 'nrm', 'uv', 'idx']) {
      assert.deepEqual(Array.from(g[key].subarray(0, sides[key].length)), Array.from(sides[key]), `capping preserves side ${key}`);
    }
    for (let cap = 0; cap < 2; cap++) {
      const ny = cap === 0 ? 1 : -1, y = ny * h / 2, r = cap === 0 ? rTop : rBot;
      const centre = sides.nv + cap * (seg + 2);
      assert.deepEqual(Array.from(g.pos.subarray(centre * 3, centre * 3 + 3)), [0, Math.fround(y), 0]);
      assert.deepEqual(Array.from(g.uv.subarray(centre * 2, centre * 2 + 2)), [.5, .5]);
      for (let i = 0; i <= seg; i++) {
        const vertex = centre + 1 + i, angle = i / seg * TAU, c = Math.cos(angle), s = Math.sin(angle);
        assert.deepEqual(Array.from(g.pos.subarray(vertex * 3, vertex * 3 + 3)), [Math.fround(c * r), Math.fround(y), Math.fround(s * r)]);
        assert.deepEqual(Array.from(g.nrm.subarray(vertex * 3, vertex * 3 + 3)), [0, ny, 0]);
        assert.deepEqual(Array.from(g.uv.subarray(vertex * 2, vertex * 2 + 2)), [Math.fround(c * .5 + .5), Math.fround(s * .5 + .5)]);
      }
    }
    meshes.push(g);
  }
  for (const g of meshes) for (let i = 0; i < g.ni; i += 3) {
    const a = g.idx[i] * 3, b = g.idx[i + 1] * 3, c = g.idx[i + 2] * 3;
    const ab = V3.new(g.pos[b] - g.pos[a], g.pos[b + 1] - g.pos[a + 1], g.pos[b + 2] - g.pos[a + 2]);
    const ac = V3.new(g.pos[c] - g.pos[a], g.pos[c + 1] - g.pos[a + 1], g.pos[c + 2] - g.pos[a + 2]);
    const face = V3.cross(V3.new(), ab, ac), normal = V3.new(g.nrm[a], g.nrm[a + 1], g.nrm[a + 2]);
    assert.ok(V3.dot(face, normal) > 0, `triangle ${i / 3} must face its supplied normal`);
  }
});

function careerFixture() {
  const lib = load(['10_math.js', '25_career.js'], ['Career', 'PERKS', 'TOURNAMENTS']);
  const game = { settings: { assist: .6, posAssist: .7, difficulty: 2 },
    ai: { setLevel() {}, reset() {} }, startMatch() {}, score: [11, 5], stats: { maxSpeed: 80 } };
  const c = new lib.Career(game); c.start();
  return { ...lib, game, c };
}
test('career restores the exact remaining bracket and round', () => {
  const { c, game, Career } = careerFixture();
  c.readyForOpponentSelect(); c.selectOpponent(1); c.onMatchEnd(1); c.save();
  const bracket = JSON.stringify(c.opponents);
  const restored = new Career(game);
  assert.equal(restored.load(), true);
  assert.equal(restored.currentRound, 1);
  assert.equal(JSON.stringify(restored.opponents), bracket);
});
test('career settings do not accumulate on repeated load', () => {
  const { c, PERKS, game } = careerFixture();
  const perk = PERKS.find(p => p.id === 'heavy_spin');
  c.perks.push(perk); perk.apply(game); c.save();
  const assist = game.settings.assist;
  const spin = game._careerSpinBoost;
  assert.equal(c.load(), true); assert.equal(game.settings.assist, assist); assert.equal(game._careerSpinBoost, spin);
  assert.equal(c.load(), true); assert.equal(game.settings.assist, assist); assert.equal(game._careerSpinBoost, spin);
});
test('leaving career removes all bonuses and restores preferences', () => {
  const { c, game, PERKS } = careerFixture();
  PERKS.find(p => p.id === 'heavy_spin').apply(game); game._careerNetSafe = true;
  c.stop(); assert.equal(game.settings.assist, .6); assert.equal(game._careerNetSafe, false);
  assert.equal(c.active, false);
});
test('career terminal save is deleted rather than resurrected', () => {
  const { c, saved } = careerFixture(); c.state = 'RUN_END'; c.save();
  assert.equal(saved.has('topspin_career'), false); assert.equal(c.load(), false);
});
test('career completed tournament resumes at the next-transition checkpoint', () => {
  const { c } = careerFixture(); c.currentRound = 3; c.opponents = []; c.state = 'TOURNAMENT_END'; c.save();
  assert.equal(c.load(), true); assert.equal(c.state, 'TOURNAMENT_END');
  c.advanceTournament(); assert.equal(c.currentTournament, 1); c.advanceTournament(); assert.equal(c.currentTournament, 1);
});
test('pending perk choice survives reload without re-rolling', () => {
  const { c, PERKS } = careerFixture(); c.currentTournament = 1; c.enterTournament();
  c.state = 'PERK_SELECT'; c.pendingPerks = PERKS.slice(0, 3); c.save();
  assert.equal(c.load(), true); assert.equal(c.state, 'PERK_SELECT');
  assert.equal(c.pendingPerks.map(p => p.id).join(), PERKS.slice(0, 3).map(p => p.id).join());
});
test('career invalid selections and repeated match end are harmless', () => {
  const { c } = careerFixture(); c.selectOpponent(0); assert.equal(c.state, 'TOURNAMENT_INTRO');
  c.readyForOpponentSelect(); c.selectOpponent(.5); assert.equal(c.state, 'OPPONENT_SELECT');
  c.selectOpponent(0); c.onMatchEnd(1); c.onMatchEnd(1); assert.equal(c.totalWins, 1);
});
for (const raw of ['null', '[]', '{"currentTournament":999,"currentRound":0}', '{"currentTournament":0,"currentRound":-1}',
  '{"currentTournament":0,"currentRound":0,"perks":{},"v":2,"opponents":[]}']) {
  test('reject corrupt career save: ' + raw, () => {
    const { c, saved } = careerFixture(); saved.set('topspin_career', raw);
    assert.equal(c.load(), false);
  });
}
test('cancelling a swipe never reuses the previous released stroke', () => {
  const { SwipeTracker } = load(['10_math.js', '30_physics.js', '40_swipe.js'], ['SwipeTracker']);
  const s = new SwipeTracker(); s.down(.5, .8, 1); s.up(.5, .4, 1.15); assert.ok(s.lastReleased);
  s.down(.5, .7, 2); s.cancel(); assert.equal(s.active, false); assert.equal(s.lastReleased, null);
});
test('a click with no travel cannot pass the stroke gate', () => {
  const { SwipeTracker, isRealStroke } = load(
    ['10_math.js', '30_physics.js', '40_swipe.js'], ['SwipeTracker', 'isRealStroke']);
  const s = new SwipeTracker();
  s.down(.5, .55, 1);
  s.move(.5, .55, 1.01);
  const m = s.up(.501, .549, 1.04);
  assert.equal(isRealStroke(m, false), false, 'stationary click is not a stroke');
  s.down(.5, .62, 2);
  s.move(.51, .61, 2.02); // tiny drag in a random direction
  const twitch = s.up(.52, .60, 2.04);
  assert.equal(isRealStroke(twitch, false), false, 'a 2 % twitch in any direction is not a stroke');
  s.down(.5, .70, 3);
  s.move(.52, .58, 3.05);
  s.move(.55, .42, 3.12);
  const flick = s.up(.56, .38, 3.16);
  assert.equal(isRealStroke(flick, false), true, 'a real drag still counts as a stroke');
  s.down(.50, .62, 4);
  s.move(.50, .50, 4.08);
  const serveFlick = s.up(.50, .44, 4.14);
  assert.equal(isRealStroke(serveFlick, true), true, 'a short upward serve flick is a serve stroke');
});
test('physical drop rebounds within table-tennis calibration range', () => {
  const { PH, V3, integrateBall, bounceTable } = load(['10_math.js', '30_physics.js'], ['PH', 'V3', 'integrateBall', 'bounceTable']);
  const p = V3.new(0, PH.TABLE_Y + PH.R + .305, .4), v = V3.new(), w = V3.new();
  for (let i = 0; p.y > PH.TABLE_Y + PH.R && i < 10000; i++) integrateBall(p, v, w, 1/4000);
  bounceTable(p, v, w); let peak = p.y;
  for (let i = 0; v.y > 0 && i < 10000; i++) { integrateBall(p, v, w, 1/4000); peak = Math.max(peak, p.y); }
  const height = peak - PH.TABLE_Y - PH.R;
  assert.ok(height > .23 && height < .27, `rebound ${height}`);
});
for (const axis of ['x', 'z']) for (const sign of [-1, 1]) for (const direction of ['outward', 'inward']) {
  test(`${axis} edge ${sign}, ${direction}: confirmed contact rebounds without an immediate double bounce`, () => {
    const { PH, V3, tableContact, bounceTable, integrateBall, predict } = load(
      ['10_math.js', '30_physics.js'], ['PH', 'V3', 'tableContact', 'bounceTable', 'integrateBall', 'predict']);
    const p = V3.new(.5, PH.TABLE_Y + PH.R, .5), v = V3.new(6, -.1, 6), w = V3.new();
    p[axis] = sign * ((axis === 'x' ? PH.T_HALF_WID : PH.T_HALF_LEN) - .001);
    v[axis] = sign * (direction === 'outward' ? .5 : -.5);
    const start = V3.clone(p), incoming = V3.clone(v);
    assert.ok(tableContact(p.x, p.y + .0001, p.z, p.x, p.y, p.z, {}), 'contact is on the tabletop from above');
    const info = bounceTable(p, v, w);
    assert.ok(info && info.Jn > 0, 'a confirmed contact delivers a real normal impulse');
    assert.equal(info.edgeAxis, axis); assert.ok(info.edge > 0);
    assert.ok(v.y > 0, `rebound vy=${v.y}`);
    assert.equal(p.x, start.x); assert.equal(p.z, start.z);
    if (direction === 'outward') assert.ok(v.y < .1, 'no artificial minimum rebound speed');
    const previous = V3.clone(p);
    integrateBall(p, v, w, PH.SIM_DT);
    assert.equal(tableContact(previous.x, previous.y, previous.z, p.x, p.y, p.z, {}), null);
    const flight = predict(start, incoming, V3.new(), { dt: PH.SIM_DT, maxT: 2 * PH.SIM_DT });
    assert.equal(flight.bounces, 1); assert.equal(flight.b2, null);
    assert.ok(flight.end.y > PH.TABLE_Y + PH.R);
  });
}
for (const wy of [0, -300, 300]) {
  test(`inverse launch verification matches production landing and clearance, sidespin ${wy}`, () => {
    const { PH, V3, solveLaunch, predict } = load(
      ['10_math.js', '30_physics.js'], ['PH', 'V3', 'solveLaunch', 'predict']);
    const from = V3.new(0, .84, .65), spin = V3.new(0, wy, 0);
    const solved = solveLaunch(from, { x: 0, z: -.75 }, spin, { speed: 5, netClear: .03, speedForgive: 0 });
    assert.ok(solved && solved.landed, 'low-ball fixture has a verified landing');
    const flight = predict(from, V3.new(solved.vx, solved.vy, solved.vz), spin,
      { dt: PH.SIM_DT, maxT: 2.4, stopOnFirstBounce: true });
    assert.equal(flight.hitNet, false); assert.ok(flight.netCross && flight.landed && flight.landed.z < 0);
    assert.deepEqual(solved.landed, flight.landed);
    assert.equal(solved.clear, flight.clear);
  });
}
test('weak-closing tilted edge resolves once from untouched state instead of falling through the playing plane', () => {
  const l = load(['10_math.js', '30_physics.js'], ['PH', 'V3', 'tableContact', 'bounceTable', 'integrateBall', 'impactSphere']);
  for (const axis of ['x', 'z']) for (const sign of [-1, 1]) {
    const p = l.V3.new(.14, l.PH.TABLE_Y + l.PH.R, .14);
    p[axis] = sign * ((axis === 'x' ? l.PH.T_HALF_WID : l.PH.T_HALF_LEN) + .0116);
    const v = l.V3.new(.1, -3.6434, .1), w = l.V3.new(-28, -14, 6.4); v[axis] = sign * 5.08;
    const expectedV = l.V3.clone(v), expectedW = l.V3.clone(w), initial = l.V3.clone(p);
    const restitution = Math.max(.68, Math.min(.92, l.PH.E_TABLE - l.PH.E_TABLE_SPEED * -v.y)) * .70;
    l.impactSphere(expectedV, expectedW, l.V3.new(0, 1, 0), l.V3.new(), restitution, l.PH.MU_TABLE, l.PH.ET_TABLE);
    const info = l.bounceTable(p, v, w);
    assert.ok(info && info.edge === 1 && info.edgeAxis === axis);
    assert.ok(v.y > 0, 'a top contact cannot exit through the playing plane');
    for (const coordinate of ['x', 'y', 'z']) {
      assert.ok(Math.abs(v[coordinate] - expectedV[coordinate]) < 1e-12, 'one physical impulse, not a patched output');
      assert.ok(Math.abs(w[coordinate] - expectedW[coordinate]) < 1e-12, 'spin from the same untouched incoming state');
    }
    assert.equal(p.x, initial.x); assert.equal(p.z, initial.z);
    const previous = l.V3.clone(p); l.integrateBall(p, v, w, l.PH.SIM_DT);
    assert.equal(l.tableContact(previous.x, previous.y, previous.z, p.x, p.y, p.z, {}), null);
  }
});
test('predict clears reused result fields between flights', () => {
  const { predict, V3 } = load(['10_math.js', '30_physics.js'], ['predict', 'V3']);
  const out = {};
  predict(V3.new(0, 1, 1), V3.new(0, 0, -6), V3.new(), { out });
  predict(V3.new(0, 1, 1), V3.new(0, 0, 0), V3.new(), { out, maxT: .01 });
  assert.equal(out.netCross, null); assert.equal(out.floor, null); assert.equal(out.landed, null);
});

test('pagehide after leaving career preserves the suspended checkpoint', () => {
  const { c, saved } = careerFixture(); c.readyForOpponentSelect(); c.save();
  const checkpoint = saved.get('topspin_career'); c.stop(); c.save();
  assert.equal(saved.get('topspin_career'), checkpoint);
});

test('volume chosen before AudioContext creation survives mute/unmute', () => {
  const { AudioEngine } = load(['50_audio.js'], ['AudioEngine']);
  const a = new AudioEngine(); a.setVolume(.2); a.setMuted(true);
  a.master = { gain: { value: 0 } }; a.setMuted(false);
  assert.equal(a.master.gain.value,.2);
  a.setMuted(true); a.setVolume(.3); assert.equal(a.master.gain.value,0);
  a.setMuted(false); assert.equal(a.master.gain.value,.3);
  a.setVolume(NaN); assert.equal(a.master.gain.value,.3);
});
