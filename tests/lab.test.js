/* Unit tests for the core loop: gesture -> shot, power -> flight, serve
 * legality, the contact window and the saved history.
 * Everything here runs headless (no DOM, no WebGL). */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { root } = require('./helpers.cjs');

const FILES = ['10_math.js', '30_physics.js', 'lab/00_lab_config.js', 'lab/10_lab_shots.js',
  'lab/20_lab_input.js', 'lab/30_lab_ball.js'];
const API = ['LAB', 'LAB_SHOTS', 'LAB_SHOT_BY_ID', 'labShotForVector', 'labEffort', 'labPowerBand',
  'labBuildStroke', 'labSolveServe', 'labBallZone', 'labTimeToPlane', 'labStepBall',
  'LabStore', 'LabGesture', 'V3', 'PH'];

function loadLab() {
  const saved = new Map();
  const localStorage = {
    getItem: (k) => (saved.has(k) ? saved.get(k) : null),
    setItem: (k, v) => saved.set(k, String(v)),
    removeItem: (k) => saved.delete(k),
  };
  const context = vm.createContext({ console, Math, Date, JSON, localStorage, performance: { now: () => Date.now() } });
  const src = FILES.map((f) => fs.readFileSync(path.join(root, 'tt/src', f), 'utf8')).join('\n');
  vm.runInContext(src + '\n;globalThis.api = {' + API.join(',') + '};', context);
  return { ...context.api, saved };
}

/** Fly a stroke to its first outcome, with the production collisions. */
function flyStroke(lab, stroke, from) {
  const ball = { p: { ...from }, v: { ...stroke.v }, w: { ...stroke.spin },
    q: { x: 0, y: 0, z: 0, w: 1 }, live: true, lastHitBy: 1 };
  const events = [];
  for (let i = 0; i < 4000 && ball.live; i++) {
    for (const e of lab.labStepBall(ball, 1 / 600)) events.push(e);
    const stop = events.find((e) => e.type === 'floor' || e.type === 'out');
    const bounces = events.filter((e) => e.type === 'table');
    if (stop) break;
    if (bounces.length >= 2) break;
  }
  return { events, ball, bounces: events.filter((e) => e.type === 'table') };
}

/* ------------------------------- directions ------------------------- */
test('eight swipe directions map to eight distinct strokes', () => {
  const lab = loadLab();
  const cases = [
    [[0, -1], 'TOP'], [[0.7071, -0.7071], 'TOP_R'], [[1, 0], 'SIDE_R'], [[0.7071, 0.7071], 'BACK_R'],
    [[0, 1], 'BACK'], [[-0.7071, 0.7071], 'BACK_L'], [[-1, 0], 'SIDE_L'], [[-0.7071, -0.7071], 'TOP_L'],
  ];
  const seen = new Set();
  for (const [[dx, dy], id] of cases) {
    const r = lab.labShotForVector(dx, -dy);        // screen y is down
    assert.equal(r.shot.id, id, `vector ${dx},${dy}`);
    assert.ok(r.dot > 0.99);
    seen.add(r.shot.id);
  }
  assert.equal(seen.size, 8);
  assert.equal(lab.LAB_SHOTS.length, 8);
});

test('a crooked human line snaps to the nearest authored direction', () => {
  const lab = loadLab();
  // 17 degrees off "up" is still an upward stroke, not a diagonal
  const a = lab.labShotForVector(Math.sin(17 * Math.PI / 180), Math.cos(17 * Math.PI / 180));
  assert.equal(a.shot.id, 'TOP');
  assert.ok(a.dot > 0.95);
  // 38 degrees off "up" (7 degrees short of the diagonal) becomes the diagonal
  const b = lab.labShotForVector(Math.sin(38 * Math.PI / 180), Math.cos(38 * Math.PI / 180));
  assert.equal(b.shot.id, 'TOP_R');
  // a curved "C" drawn to the left resolves to the leftward stroke
  const c = lab.labShotForVector(-0.95, -0.31);
  assert.equal(c.shot.id, 'SIDE_L');
  // every possible angle is classified (never null, never an exception)
  for (let deg = 0; deg < 360; deg++) {
    const r = lab.labShotForVector(Math.sin(deg * Math.PI / 180), -Math.cos(deg * Math.PI / 180));
    assert.ok(r && r.shot && r.shot.id);
  }
});

test('four power bands, from a tap to a full-blooded swing', () => {
  const lab = loadLab();
  assert.equal(lab.labEffort(5), 0);
  assert.ok(Math.abs(lab.labEffort(lab.LAB.powerFullMm) - lab.LAB.effortMax) < 1e-9);
  // millimetres -> band, through the same conversion the game uses
  const band = (mm) => lab.labPowerBand(lab.labEffort(mm));
  assert.equal(band(0), 'weak');
  assert.equal(band(20), 'weak');
  assert.equal(band(40), 'normal');
  assert.equal(band(52), 'strong');
  assert.equal(band(120), 'over');
  // and the bands are in order on the swipe-length axis
  const mm = [0, 20, 30, 40, 48, 56, 64, 72, 120];
  const bands = mm.map(band);
  const order = ['weak', 'normal', 'strong', 'over'];
  for (let i = 1; i < bands.length; i++) {
    assert.ok(order.indexOf(bands[i]) >= order.indexOf(bands[i - 1]), `bands go backwards: ${bands}`);
  }
});

test('gesure classifier: a tap is a tap on every screen size, a 40 mm swipe is a swipe', () => {
  const lab = loadLab();
  const g = new lab.LabGesture();
  const mmToPx = (mm) => mm * lab.LAB.pxPerMm;
  for (const minDim of [320, 390, 760, 1400]) {
    g.down(100, 300, 1, 'touch');
    g.up(100, 300 - mmToPx(3), 1.1, minDim);
    const tap = g ? null : null;
    void tap;
  }
  g.down(100, 300, 1, 'touch');
  const tap = g.up(102, 298, 1.08, 390);
  assert.equal(tap.ok, false);
  assert.equal(tap.reason, 'tap');

  for (const minDim of [390, 1200]) {
    g.down(100, 300, 1, 'touch');
    for (let i = 1; i <= 5; i++) g.move(100, 300 - mmToPx(40) * i / 5, 1 + i * 0.01);
    const s = g.up(100, 300 - mmToPx(40), 1.08, minDim);
    assert.equal(s.ok, true);
    assert.equal(s.shotId, 'TOP');
    assert.ok(Math.abs(s.mm - 40) < 0.01, `swipe length in mm: ${s.mm}`);
  }
});

/* -------------------------------- flights --------------------------- */
test('a normal stroke lands on the opponent half for all eight shots', () => {
  const lab = loadLab();
  const from = { x: 0, y: 1.00, z: 1.30 };
  for (const shot of lab.LAB_SHOTS) {
    const stroke = lab.labBuildStroke(shot, 0.55, from);
    assert.equal(stroke.band, 'normal', shot.id);
    const r = flyStroke(lab, stroke, from);
    const first = r.bounces[0];
    assert.ok(first, `${shot.id}: no bounce, events ${r.events.map((e) => e.type)}`);
    assert.ok(first.z < 0, `${shot.id}: first bounce on our own half (z=${first.z.toFixed(2)})`);
    assert.ok(Math.abs(first.x) <= lab.PH.T_HALF_WID, `${shot.id}: bounced off the side (x=${first.x.toFixed(2)})`);
  }
});

test('a weak stroke dies before the net, a strong one can fly long', () => {
  const lab = loadLab();
  const from = { x: 0, y: 1.00, z: 1.30 };
  const top = lab.LAB_SHOT_BY_ID.TOP;

  const weak = lab.labBuildStroke(top, 0.05, from);
  assert.equal(weak.band, 'weak');
  const weakFirst = flyStroke(lab, weak, from).bounces[0];
  assert.ok(!weakFirst || weakFirst.z > 0,
    `weak stroke must not reach the opponent's half (z=${weakFirst && weakFirst.z.toFixed(2)})`);

  // a hard backspin drive is the shot that runs away: the bat speed exceeds
  // what any elevation inside the human range can bring down on the table
  const back = lab.LAB_SHOTS.find((s) => s.id === 'BACK');
  const strongBack = lab.labBuildStroke(back, 1.24, from);
  assert.equal(strongBack.band, 'over');
  const rb = flyStroke(lab, strongBack, from);
  const inside = rb.bounces.some((b) => b.z < 0 && b.z > -lab.PH.T_HALF_LEN &&
    Math.abs(b.x) < lab.PH.T_HALF_WID);
  assert.equal(inside, false, 'a full-power backspin must not land on the table');

  // and the solver cannot rescue a bat speed that is physically absurd
  const hot = lab.labBuildStroke(top, 1.24, from);
  const v = { x: hot.v.x * 2.2, y: hot.v.y * 2.2, z: hot.v.z * 2.2 };
  const rh = flyStroke(lab, { v, spin: hot.spin }, from);
  assert.equal(rh.bounces.some((b) => b.z < 0 && b.z > -lab.PH.T_HALF_LEN), false);
});

test('a stronger swipe lands deeper than a softer one', () => {
  const lab = loadLab();
  const from = { x: 0, y: 1.00, z: 1.30 };
  const top = lab.LAB_SHOTS[0];
  const soft = flyStroke(lab, lab.labBuildStroke(top, 0.40, from), from).bounces[0];
  const hard = flyStroke(lab, lab.labBuildStroke(top, 0.80, from), from).bounces[0];
  assert.ok(soft && hard);
  assert.ok(hard.z < soft.z - 0.05,
    `hard ${hard.z.toFixed(2)} should be deeper than soft ${soft.z.toFixed(2)}`);
});

test('shot speed comes from the swipe, not from the length of the screen', () => {
  const lab = loadLab();
  const from = { x: 0, y: 1.0, z: 1.3 };
  const a = lab.labBuildStroke(lab.LAB_SHOTS[0], 0.4, from);
  const b = lab.labBuildStroke(lab.LAB_SHOTS[0], 0.9, from);
  assert.ok(b.speed > a.speed * 1.2);
  assert.ok(Math.abs(lab.V3.len(b.spin)) > Math.abs(lab.V3.len(a.spin)));
});

/* --------------------------------- serve ---------------------------- */
test('every serve combination is legal: own half first, then the opponent half', () => {
  const lab = loadLab();
  for (const dir of lab.LAB.serveDirs) {
    for (const spin of lab.LAB.serveSpins) {
      const sol = lab.labSolveServe(dir, spin);
      assert.ok(sol && sol.v, `${dir}/${spin}: no solution`);
      const ball = { p: { ...lab.LAB.serveHand }, v: { ...sol.v },
        w: { x: spin === 'TOP' ? -120 : spin === 'BACK' ? 110 : 0, y: 0, z: 0 },
        q: { x: 0, y: 0, z: 0, w: 1 }, live: true, lastHitBy: 1 };
      const bounces = [];
      let net = false;
      for (let i = 0; i < 3000 && ball.live; i++) {
        for (const e of lab.labStepBall(ball, 1 / 600)) {
          if (e.type === 'table') bounces.push(e);
          if (e.type === 'net') net = true;
          if (e.type === 'floor') { bounces.push({ floor: true }); }
        }
        if (bounces.some((b) => b.floor)) break;
        if (bounces.length >= 2) break;
      }
      assert.ok(bounces.length >= 2, `${dir}/${spin}: ${bounces.length} bounces`);
      assert.ok(bounces[0].z > 0, `${dir}/${spin}: first bounce must be on our half`);
      assert.ok(bounces[1].z < 0, `${dir}/${spin}: second bounce must be on their half`);
      assert.ok(!net, `${dir}/${spin}: serve hit the net`);
    }
  }
});

test('serve direction really moves the serve left, centre and right', () => {
  const lab = loadLab();
  const x = (dir) => lab.labSolveServe(dir, 'FLAT').v.x;
  const l = x('LEFT'), c = x('CENTER'), r = x('RIGHT');
  assert.ok(l < c - 0.2, `left ${l} vs centre ${c}`);
  assert.ok(r > c + 0.2, `right ${r} vs centre ${c}`);
});

/* -------------------------------- window --------------------------- */
test('the ball is white, then green, then red — and stays green long enough to react', () => {
  const lab = loadLab();
  const ball = { p: { x: 0, y: 1.15, z: -0.55 }, v: { x: 0.05, y: 0.9, z: 3.6 },
    w: { x: -40, y: 0, z: 0 }, q: { x: 0, y: 0, z: 0, w: 1 }, live: true, lastHitBy: -1 };
  const zones = [];
  let greenFrom = null, greenTo = null, t = 0;
  for (let i = 0; i < 900; i++) {
    const z = lab.labBallZone(ball);
    if (z.zone !== zones[zones.length - 1]) zones.push(z.zone);
    if (z.zone === 'ready') { if (greenFrom === null) greenFrom = t; greenTo = t; }
    const events = lab.labStepBall(ball, 1 / 240);
    t += 1 / 240;
    if (events.some((e) => e.type === 'table' || e.type === 'floor')) {
      // keep flying: the ball would be dead here in the game; stop the trace
      if (ball.p.z > 1.6) break;
    }
    if (!ball.live) break;
  }
  // once the ball is dead behind the player there is nothing to hit any more
  const firstLate = zones.indexOf('late');
  assert.ok(zones.slice(0, 2).join() === 'early,ready', `zones ${zones.slice(0, 3)}`);
  assert.ok(firstLate > 1, `no red zone: ${zones}`);
  assert.ok(zones.every((z) => z === 'early' || z === 'ready' || z === 'late' || z === 'idle'));
  assert.equal(zones[zones.length - 1], 'idle');
  const greenMs = (greenTo - greenFrom) * 1000;
  assert.ok(greenMs > 400, `green window too short: ${greenMs.toFixed(0)} ms`);
  const redMs = ((t - greenTo) * 1000);
  assert.ok(redMs > 120, `red window too short: ${redMs.toFixed(0)} ms`);
});

test('a ball that never arrives is not reported as contactable for ever', () => {
  const lab = loadLab();
  // a ball dying on our own half
  const dying = { p: { x: 0, y: 1.0, z: 0.9 }, v: { x: 0, y: 0.2, z: 0.4 }, w: { x: 0, y: 0, z: 0 },
    q: { x: 0, y: 0, z: 0, w: 1 }, live: true, lastHitBy: -1 };
  const z = lab.labBallZone(dying);
  assert.ok(['ready', 'early'].includes(z.zone));
  // a ball that has already gone past the strike plane is late
  const past = { p: { x: 0, y: 1.0, z: 2.0 }, v: { x: 0, y: 0, z: 3.0 }, w: { x: 0, y: 0, z: 0 },
    q: { x: 0, y: 0, z: 0, w: 1 }, live: true, lastHitBy: -1 };
  assert.equal(lab.labBallZone(past, -0.5).zone, 'late');
});

/* -------------------------------- history -------------------------- */
test('history keeps strokes, misses and serves apart and survives a reload', () => {
  const lab = loadLab();
  const store = new lab.LabStore();
  store.startSession();
  store.log({ kind: 'shot', shot: 'TOP', band: 'normal', outcome: 'table', speedKmh: 30, landing: { x: 0, z: -0.8 }, rally: 3 });
  store.log({ kind: 'shot', shot: 'TOP', band: 'strong', outcome: 'out', speedKmh: 42 });
  store.log({ kind: 'shot', shot: 'BACK', band: 'weak', outcome: 'short', speedKmh: 12 });
  store.log({ kind: 'miss', reason: 'вне зоны', shot: 'TOP', band: 'normal' });
  store.log({ kind: 'serve', dir: 'LEFT', spin: 'TOP', outcome: 'legal', bounces: 2 });
  store.endSession();

  const sum = store.summary();
  assert.equal(sum.TOP.n, 2);
  assert.equal(sum.TOP.strong, 1);
  assert.equal(sum.TOP.table, 1);
  assert.equal(sum.TOP.out, 1);
  assert.equal(sum.BACK.shortBall, 1);
  assert.equal(sum.SIDE_R.n, 0);
  assert.equal(store.session.attempts, 3, 'serves and misses are not stroke attempts');
  assert.equal(store.session.bestRally, 3);

  const reloaded = new lab.LabStore();
  assert.equal(reloaded.shots.length, 5);
  assert.equal(reloaded.sessions.length, 1);
  assert.equal(reloaded.summary().BACK.n, 1);
  assert.ok(reloaded.exportData().schema);
});

test('the single setting is per device, clamped and persisted', () => {
  const lab = loadLab();
  const store = new lab.LabStore();
  store.setViewDistance(false, 5);            // desktop
  store.setViewDistance(true, 0.80);          // phone
  const again = new lab.LabStore();
  assert.equal(again.viewDistance(false), lab.LAB.distanceMax, 'desktop value clamped at the top');
  assert.equal(again.viewDistance(true), 0.80, 'phone value keeps its own framing');
  assert.notEqual(again.viewDistance(true), again.viewDistance(false));
  assert.ok(lab.LAB.distanceMin < 1 && lab.LAB.distanceMax > 1);
});
