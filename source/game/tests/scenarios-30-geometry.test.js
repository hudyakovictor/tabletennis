'use strict';
/* =====================================================================
 *  30 gameplay scenarios (2026-11-05) — part 2: zones, geometry and the
 *  incoming ball (scenarios 11…20).
 *
 *  Same rules as part 1 (`scenarios-30.test.js`): every `test()` is one
 *  numbered scenario from the request and asserts what the real engine
 *  modules can prove headlessly. The measured numbers quoted in the names
 *  come from `docs/scenarios-30-audit-2026-11-05.ru.md`.
 * ===================================================================== */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const ENGINE = load([
  '10_math.js', '30_physics.js', '12_match_rules.js', '38_paddle_motion.js',
  '37_stroke_motion_data.js', '40_swipe.js', '42_shot_diagnostics.js', '55_ai.js',
  '57_camera.js', '84_racket.js', '70_game.js', '80_ui.js',
], [
  'V3', 'Q', 'PH', 'MATCH_RULES', 'GRACE_RULES', 'STROKE_CONFIG', 'SwipeTracker', 'refineRacket',
  'isRealStroke', 'deriveStroke', 'refineRacket', 'impactRacket', 'impactSphere',
  'integrateBall', 'tableContact', 'bounceTable', 'netContactStep', 'predict',
  'launchPoint', 'paddleContactPose', 'paddleTableClearance', 'enforcePaddleTableClearance',
  'bladePlaneCapture', 'measureCaptureAllowance', 'playerCaptureLimits', 'pressContactZone',
  'pressZoneForBall', 'evaluateContactZone', 'solveStrikeCorridor', 'paddleLimitsFor',
  'PADDLE_LIMITS', 'PADDLE_STANCE_Z', 'REACH_SHELL', 'Equipment', 'OpponentAI',
  'resolveRacketLaunch', 'ShotJournal', 'Game', 'STROKE_CONFIG',
], { window: { devicePixelRatio: 2, innerWidth: 390, innerHeight: 844 } });
const {
  V3, PH, MATCH_RULES, STROKE_CONFIG, SwipeTracker, deriveStroke, refineRacket, impactRacket, predict,
  integrateBall, tableContact, bounceTable, netContactStep, paddleContactPose,
  paddleTableClearance, enforcePaddleTableClearance, bladePlaneCapture, playerCaptureLimits,
  evaluateContactZone, solveStrikeCorridor, paddleLimitsFor, PADDLE_LIMITS, PADDLE_STANCE_Z,
  Equipment, OpponentAI, resolveRacketLaunch, ShotJournal, Game,
} = ENGINE;

const TY = PH.TABLE_Y;
const finite = (...xs) => xs.every(Number.isFinite);
function rngFrom(seed) {
  let st = seed >>> 0;
  return () => ((st = (Math.imul(st, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const pad = () => ({ pos: V3.new(0, TY + 0.35, 1.78), normal: V3.new(0, 0, -1), prevPos: V3.new() });
/* A screen projection simple enough to reason about: the world point keeps its
 * sign and is scaled into 0..1. Used only to turn anchors into pixels. */
const proj = (q) => ({ ok: true, x: 0.5 + q.x * 0.28, y: 0.55 - (q.y - TY) * 0.42 });

/* ------------------------------------------------------------------ 11 */
test('11. 12–30 m/s closing speeds and oblique crossings: the swept check never loses a contact inside one substep', () => {
  const n = V3.norm(V3.new(), V3.new(0.25, -0.35, -1));   // oblique blade
  const padPos = V3.new(0, TY + 0.35, 1.78), padPrev = V3.new(0.05, TY + 0.33, 1.80);
  /* A 30 m/s ball travels a full metre between two 1/30 s frames: any check
   * that only looks at frame samples misses the blade completely. */
  const pass = (off) => {
    const b0 = V3.new(off, TY + 0.40, 2.55), b1 = V3.new(off + 0.02, TY + 0.35, 15.5 / 10);
    return { b0, b1 };
  };
  let edges = 0, prevOk = null, onCount = 0, discreteMissed = 0, insideOffsets = [];
  for (let off = -0.60; off <= 0.6001; off += 0.002) {
    const { b0, b1 } = pass(off);
    const swept = bladePlaneCapture(b1, b0, padPos, padPrev, n, false);
    assert.ok(finite(swept.t, swept.lat, swept.dzEff), 'swept capture returned non-finite geometry');
    assert.ok(swept.t >= 0 && swept.t <= 1, `contact parameter outside the substep: ${swept.t}`);
    const ok = swept.ok;
    if (ok) { onCount++; insideOffsets.push(off); }
    if (prevOk !== null && ok !== prevOk) edges++;
    prevOk = ok;
    /* Discrete frame sampling of the same pass (ball and paddle frozen at the
     * sample points) is the baseline the CCD has to beat. */
    const mid = V3.new((b0.x + b1.x) / 2, (b0.y + b1.y) / 2, (b0.z + b1.z) / 2);
    const discrete = [b0, mid, b1].some(b => bladePlaneCapture(b, b, padPos, padPrev, n, false).ok);
    if (ok && !discrete) discreteMissed++;
  }
  assert.ok(onCount > 50, `contact zone too small to prove anything: ${onCount} offsets`);
  /* Exactly one contiguous run: no hole in the middle of the blade. */
  assert.equal(edges, 2, `detection set is not a single interval (${edges} edges at ${insideOffsets[0]}…${insideOffsets[insideOffsets.length - 1]})`);
  assert.ok(discreteMissed > 0, 'the swept check never disagreed with frame samples, so this proves nothing');
  /* And the reported contact point really lies between the two frames. */
  const { b0, b1 } = pass(0);
  const s = bladePlaneCapture(b1, b0, padPos, padPrev, n, false);
  assert.ok(s.ok, 'a straight pass through the blade centre was not detected');
  assert.ok(s.point.z <= b0.z + 1e-9 && s.point.z >= b1.z - 1e-9, 'contact point outside the swept segment');
  assert.ok(s.t > 0 && s.t < 1, 'the contact was reported at an endpoint of the substep');
});

/* ------------------------------------------------------------------ 12 */
test('12. low ball at the side line AND the end line: height, width and depth limits hold simultaneously', () => {
  const surfaceClear = 0.18;             // PADDLE_LIMITS.yLo at the near edge
  let lowWideCells = 0;
  for (const z of [PADDLE_LIMITS.zStepIn, 1.40, 1.55, 1.61, 1.70, PADDLE_STANCE_Z, 2.00, PADDLE_LIMITS.zFar]) {
    for (const wantX of [0, 0.8, 2.0, 3.0, -3.0]) {
      for (const wantY of [-0.45, 0.02, 0.18, 0.5, 1.4, 3.0]) {
        const lim = paddleLimitsFor(z);
        const x = Math.max(-lim.x, Math.min(lim.x, wantX));
        const y = Math.max(TY + lim.yLo, Math.min(TY + lim.yHi, TY + wantY));
        const zc = Math.max(PADDLE_LIMITS.zStepIn, Math.min(PADDLE_LIMITS.zFar, z));
        /* The engine clamps depth last, so every other limit is re-checked
         * against the depth that is actually rendered, not the requested one. */
        const lim2 = paddleLimitsFor(zc);
        assert.ok(Math.abs(x) <= lim2.x + 1e-9, `width broken at z=${zc}: x=${x} lim=${lim2.x}`);
        assert.ok(y >= TY + lim2.yLo - 1e-9 && y <= TY + lim2.yHi + 1e-9, `height broken at z=${zc}: y=${y} range=${lim2.yLo}…${lim2.yHi}`);
        assert.ok(zc >= PADDLE_LIMITS.zStepIn - 1e-9 && zc <= PADDLE_LIMITS.zFar + 1e-9, `depth escaped: ${zc}`);
        /* Blade over the table may not be inside it, at any lateral offset. */
        if (zc <= PH.T_HALF_LEN + 0.24) {
          const cl = paddleTableClearance({ x, y, z: zc }, V3.norm(V3.new(), V3.new(0, -0.2, -1)), 0);
          assert.ok(cl >= -1e-9, `blade below the surface at (${x.toFixed(2)}, ${y.toFixed(2)}, ${zc.toFixed(2)}): clearance ${cl}`);
        }
        if (wantX > lim.x && wantY <= surfaceClear && z <= 1.40) {
          lowWideCells++;
          assert.ok(Math.abs(x) === lim.x && y === TY + lim.yLo,
            'a corner request gave up one limit to satisfy the other');
        }
      }
    }
  }
  assert.ok(lowWideCells > 0, 'no extreme corner cell was exercised');
  /* The reach box is a function of depth only — the viewport never enters it. */
  assert.equal(paddleLimitsFor(PADDLE_LIMITS.zStepIn).yLo, surfaceClear);
  assert.ok(paddleLimitsFor(PADDLE_STANCE_Z).yLo <= PADDLE_LIMITS.yLo + 1e-9);
});

/* ------------------------------------------------------------------ 13 */
test('13. racket leaving the table constraint: the lift is idempotent and never rewinds the horizontal pose', () => {
  const n = V3.norm(V3.new(), V3.new(0, -0.18, -1));
  let lifts = 0, stillBelow = 0, moved = 0;
  const rng = rngFrom(7);
  for (let i = 0; i < 1500; i++) {
    const p = { x: (rng() * 2 - 1) * 2.1, y: TY - 0.10 + rng() * 0.30, z: 1.20 + rng() * 0.95 };
    const before = { x: p.x, z: p.z };
    const roll = (rng() * 2 - 1) * 0.6;
    const lift = enforcePaddleTableClearance(p, n, roll);
    if (lift > 1e-9) lifts++;
    assert.ok(finite(p.x, p.y, p.z), 'clearance produced NaN');
    assert.equal(p.x, before.x); assert.equal(p.z, before.z);   // only y may move
    const again = enforcePaddleTableClearance(p, n, roll);
    if (again > 1e-9) { moved++; }
    if (paddleTableClearance(p, n, roll) < 0.006 - 1e-6) stillBelow++;
  }
  assert.ok(lifts > 80, `the sweep never needed a lift: ${lifts}`);
  assert.equal(stillBelow, 0, `${stillBelow} poses are still inside the table after the lift`);
  assert.equal(moved, 0, `${moved} poses needed a second lift — the helper is not idempotent`);
});

/* ------------------------------------------------------------------ 14 */
test('14. heavy sidespin moves the meeting point during the gesture, mirrored by sign and without a jump', () => {
  const flight = (wy) => {
    const o = {};
    predict(V3.new(0, TY + 0.42, -0.9), V3.new(0, 1.2, 5.4), V3.new(0, wy, 0),
      { dt: 1 / 240, maxT: 2.0, out: o, maxPath: 2000 });
    return o.landed ? o.landed : null;
  };
  const flat = flight(0), hook = flight(280), fade = flight(-280), max = flight(600);
  for (const l of [flat, hook, fade, max]) assert.ok(l && finite(l.x, l.z, l.t), 'no landing point for a legal incoming ball');
  assert.ok(Math.abs(flat.x) < 1e-9, 'a spin-free ball drifted sideways on its own');
  assert.ok(hook.x > 0.12 && fade.x < -0.12, `sidespin did not move the meeting point: ${hook.x.toFixed(3)} / ${fade.x.toFixed(3)}`);
  assert.ok(Math.abs(hook.x + fade.x) < 1e-9, 'the two spin signs are not mirror images');
  assert.ok(Math.abs(hook.z - fade.z) < 1e-9 && Math.abs(hook.t - fade.t) < 1e-9, 'the spin sign changed the timing of the bounce');
  assert.ok(Math.abs(max.x) > 0.1 && Math.abs(max.x) < 0.5, `a 600 rad/s ball gave a silly meeting point: ${max.x}`);

  /* The forecast is re-run every frame while the finger is moving. It must be
   * stable: the same deterministic model from a later state predicts the same
   * bounce, so the capture point cannot jump under the finger. */
  const p = V3.new(0, TY + 0.42, -0.9), v = V3.new(0, 1.2, 5.4), w = V3.new(0, 400, 0);
  const pp = V3.clone(p), vv = V3.clone(v), ww = V3.clone(w);
  let prev = null, worst = 0, samples = 0;
  for (let i = 0; i <= 12; i++) {
    const o = {}; predict(V3.clone(pp), V3.clone(vv), V3.clone(ww), { dt: 1 / 240, maxT: 2.0, out: o, maxPath: 2000 });
    if (o.landed) {
      if (prev) worst = Math.max(worst, Math.hypot(o.landed.x - prev.x, o.landed.z - prev.z));
      prev = o.landed; samples++;
    }
    integrateBall(pp, vv, ww, 0.02);
  }
  assert.ok(samples >= 10, 'the forecast stopped producing landing points mid-flight');
  assert.ok(worst < 0.005, `the predicted meeting point jumped ${worst.toFixed(3)} m between frames`);
});

/* ------------------------------------------------------------------ 15 */
test('15. a really extreme but reachable ball is admitted, a pointer outside the zone is refused with a word', () => {
  /* Lateral court corner, ball low and wide: legal, but only just. */
  const extreme = { p: V3.new(-0.60, TY + 0.30, -1.05), v: V3.new(-0.2, 0.4, 6.4), w: V3.new(-80, 0, 0), live: true, lastHitBy: -1 };
  const c = solveStrikeCorridor(extreme, pad(), [], predict, { tableY: TY });
  assert.ok(c.valid, 'the extreme-but-reachable ball produced no corridor');
  assert.ok(c.anchors.length > 0 && finite(c.primary.x, c.primary.t), 'corridor without anchors');
  assert.ok(Math.abs(c.primary.x) > 0.5, `the extreme cell did not stay extreme: x=${c.primary.x}`);

  const anchorPx = proj(c.primary);
  const hit = evaluateContactZone(c, extreme, { x: anchorPx.x, y: anchorPx.y }, 390, 844, proj, () => null, { pointerType: 'touch' });
  assert.ok(hit && hit.accepted, `the anchor press was refused: ${hit && hit.reason}`);
  assert.equal(hit.reason, null);

  /* Same corridor, pointer a third of the screen away: an honest "not here". */
  const off = evaluateContactZone(c, extreme, { x: anchorPx.x + 0.33, y: anchorPx.y }, 390, 844, proj, () => null, { pointerType: 'touch' });
  assert.equal(off.accepted, false);
  assert.equal(off.reason, 'OUTSIDE_ZONE');

  /* And an admitted press that finds nothing is classified, never left blank. */
  const journal = new ShotJournal();
  journal.create(1, 0);
  journal.observe(1, { samples: 8, dist: .2, pathLen: .2, speed: 2, releaseSpeed: 2, peakSpeed: 2,
    right: 0, up: 1, curl: 0, smooth: 1, x: .5, y: .5 }, { strokeId: 'DRIVE', isServe: false, time: 0, sampleTime: 0 });
  journal.observeCapture(1, { lateral: 0.31, radius: 0.22, depthGap: 0.02, depthLimit: 0.22, score: 0.9 }, 0);
  assert.equal(journal.missReason(journal.latest), 'TIMING_LATE');
  assert.equal(journal.missReason({ valid: true, closest: { lateral: 0.1, radius: 0.22, depthGap: 0.4, depthLimit: 0.22 } }), 'DEPTH_FAIL');
  assert.equal(journal.missReason({ valid: true, closest: { lateral: 0.1, radius: 0.22, depthGap: 0.02, depthLimit: 0.22 } }), 'TIMING_EARLY');
});

/* ------------------------------------------------------------------ 16 */
test('16. receiving all five AI serves: a press before the bounce is admitted and the corridor survives the bounce', () => {
  const SERVES = { SERVE_TOP: .10, SERVE_BACK: .40, SERVE_SIDE: .65, SERVE_FAST: .80, SERVE_NO_SPIN: .95 };
  let solved = 0, corridors = 0, admitted = 0, deferred = 0;
  for (const [id, draw] of Object.entries(SERVES)) {
    for (let seed = 1; seed <= 8; seed++) {
      const rng = rngFrom(seed * 97), ai = new OpponentAI(1);
      ai.side = -1; ai.setHandicap(1);
      const draws = [draw, .35 + rng() * .3, .3 + rng() * .4, rng() < .5 ? .1 : .9, rng() < .5 ? .1 : .9];
      ai.rng = () => (draws.length ? draws.shift() : rng());
      const ball = { p: V3.new((rng() * 2 - 1) * .2, TY + STROKE_CONFIG.serve.toss.aiContactHeight, -(PH.T_HALF_LEN + .2)),
        v: V3.new((rng() * 2 - 1) * .05, -2.43, (rng() * 2 - 1) * .05), w: V3.new(), live: true, lastHitBy: 0 };
      const game = { ball, time: 0, strokeTime: 0, equip: { forSide: () => ({}) } };
      const racket = ai.serve(game);
      if (!racket || !racket.valid) continue;
      const launch = resolveRacketLaunch(ball, racket);
      if (!launch) continue;
      solved++;
      /* Fly the serve and stop right after the server's own bounce: that is
       * the receiver's gesture window (before his bounce). */
      const p = V3.clone(launch.p), v = V3.clone(launch.v), w = V3.clone(launch.w);
      const prev = V3.new(), hit = {};
      let state = null, bounces = 0;
      for (let i = 0; i < 1200; i++) {
        V3.copy(prev, p); integrateBall(p, v, w, PH.SIM_DT);
        if (netContactStep(prev.x, prev.y, prev.z, p.x, p.y, p.z, hit)) break;
        if (v.y < 0 && tableContact(prev.x, prev.y, prev.z, p.x, p.y, p.z, hit)) {
          V3.copy(p, { x: hit.x, y: hit.y + 1e-5, z: hit.z });
          bounceTable(p, v, w);
          bounces++;
          if (bounces === 1) state = { p: V3.clone(p), v: V3.clone(v), w: V3.clone(w) };
          if (bounces === 2) break;
        }
        if (p.y < .05) break;
      }
      if (!state) continue;
      const incoming = { p: state.p, v: state.v, w: state.w, live: true, lastHitBy: -1 };
      const c = solveStrikeCorridor(incoming, pad(), [], predict, { tableY: TY });
      if (!c.valid) continue;                       // the serve died: not a reception case
      corridors++;
      assert.ok(c.legalFromT > 0, 'the receiver corridor starts before the ball reaches him');
      const a = proj(c.primary);
      const z = evaluateContactZone(c, incoming, { x: a.x, y: a.y }, 390, 844, proj, () => null, { pointerType: 'touch' });
      if (z && z.accepted) admitted++;
      /* The hit gate itself is still closed: no bounce on the receiver's side
       * yet, which is exactly why the press must be admitted ahead of it. */
      deferred++;
    }
  }
  assert.ok(solved >= 35, `only ${solved} of 40 serves were solved — the fixture is not representative`);
  assert.equal(corridors, solved, `${solved - corridors} legal serves produced no receiver corridor`);
  assert.equal(admitted, solved, `${solved - admitted} presses were refused before the bounce (a lost reception)`);
  assert.equal(deferred, solved);
});

/* ------------------------------------------------------------------ 17 */
test('17. a ball whose speed changes sign: no endless wait, no auto-capture, no second hit', () => {
  /* Real backspin measured on the engine: the bounce eats horizontal pace but
   * never reverses it, so there is no "ball comes back at me" to wait for. */
  const run = (spinX) => {
    const v = V3.new(0, -1.4, 6.5), spin = V3.new(spinX, 0, 0);
    const p = V3.new(0, TY + 0.35, -0.6), prev = V3.new(), hit = {};
    for (let i = 0; i < 1200; i++) {
      V3.copy(prev, p); integrateBall(p, v, spin, PH.SIM_DT);
      if (netContactStep(prev.x, prev.y, prev.z, p.x, p.y, p.z, hit)) return null;
      if (v.y < 0 && tableContact(prev.x, prev.y, prev.z, p.x, p.y, p.z, hit)) {
        V3.copy(p, { x: hit.x, y: hit.y + 1e-5, z: hit.z });
        const before = v.z; bounceTable(p, v, spin);
        return { z: p.z, before, after: v.z, state: { p: V3.clone(p), v: V3.clone(v), w: V3.clone(spin) } };
      }
      if (p.y < .05) return null;
    }
    return null;
  };
  let reversed = 0, slowed = 0;
  for (const spin of [-300, -600, -900, -1200]) {
    const b = run(spin);
    assert.ok(b, `a heavy-backspin ball (${spin}) never reached the table`);
    assert.ok(b.z > -PH.T_HALF_LEN && b.z < PH.T_HALF_LEN, 'the bounce was recorded off the table');
    if (b.after < 0) reversed++;
    if (Math.abs(b.after) < Math.abs(b.before)) slowed++;
  }
  assert.equal(reversed, 0, 'backspin now reverses the ball — the contact window below needs a fresh look');
  assert.equal(slowed, 4, 'backspin no longer slows the ball: the bounce lost its bite');

  /* The hypothetical reversal the scenario describes: the ball is moving away
   * from the player after its own bounce. The corridor must refuse quickly and
   * stay refused — no polling loop, no accumulating state. */
  const away = { p: V3.new(0, TY + 0.20, 0.55), v: V3.new(0, -0.9, -4.0), w: V3.new(500, 0, 0), live: true, lastHitBy: -1 };
  const t0 = Date.now();
  let results = 0;
  for (let i = 0; i < 40; i++) {
    const c = solveStrikeCorridor(away, pad(), [], predict, { tableY: TY });
    assert.equal(c.valid, false, 'a ball leaving the player still produced a strike corridor');
    results++;
  }
  const ms = Date.now() - t0;
  assert.equal(results, 40);
  assert.ok(ms < 400, `40 refusals took ${ms} ms — the corridor loops on a reversing ball`);
});

/* ------------------------------------------------------------------ 18 */
test('18. centre, edge, rim: the contact sweeps from a clean hit through sliding to a miss', () => {
  const n0 = V3.norm(V3.new(), V3.new(0, -0.25, -1));
  const vR = V3.new(0, 2.0, -7);
  const swing = (n, q = 1) => {
    const v = V3.new(0, 0.55, 6.1), w = V3.new(-55, 25, 0);
    const info = impactRacket(v, w, n, vR, q, {});
    return info ? { speed: V3.len(v), spin: V3.len(w), slip: info.slipping, jn: info.Jn } : null;
  };
  const centre = swing(n0);
  assert.ok(centre && !centre.slip, 'a square hit in the sweet spot is reported as sliding');
  let seenSlip = false, lastSpeed = centre.speed, grazes = 0, misses = 0;
  for (let phi = 10; phi <= 90; phi += 5) {
    const a = phi * Math.PI / 180;
    const n = V3.norm(V3.new(), V3.new(Math.sin(a), n0.y, -Math.cos(a)));
    const r = swing(n);
    if (!r) { misses++; continue; }
    grazes++;
    assert.ok(finite(r.speed, r.spin), `non-finite output at ${phi}°`);
    assert.ok(r.speed <= centre.speed + 1e-9, 'an edge-on contact came out faster than a square one');
    assert.ok(r.speed <= lastSpeed + 1e-9 || r.slip, 'the graze got faster as the face turned away');
    if (r.slip) seenSlip = true;
    lastSpeed = r.speed;
  }
  assert.ok(seenSlip, 'no graze ever entered the sliding regime');
  assert.ok(misses >= 1, 'even a fully edge-on face still returned a hit');
  /* Off-centre on the face (quality) costs pace but stays finite. */
  const qs = [1, .8, .6, .4, .2, .1].map(q => swing(n0, q));
  assert.ok(qs.every(Boolean), 'an off-centre hit on the rubber produced no contact');
  for (let i = 1; i < qs.length; i++) {
    assert.ok(qs[i].speed < qs[i - 1].speed + 1e-9, 'moving off the sweet spot did not cost speed');
    assert.ok(finite(qs[i].speed, qs[i].spin, qs[i].jn));
  }
  assert.ok(centre.speed - qs[qs.length - 1].speed > 2, 'a handle-side hit costs almost nothing — no rim penalty');
});

/* ------------------------------------------------------------------ 19 */
test('19. left and right handed mirror: sidespin sign, flight direction and the extreme zones', () => {
  const equip = new Equipment();
  let pairs = 0, legal = 0;
  for (const grip of ['shakehand', 'penhold']) {
    const rows = [];
    for (const dir of [1, -1]) {
      const m = { samples: 8, dist: .24, pathLen: .24, speed: 2.4, releaseSpeed: 2.4, peakSpeed: 2.64,
        right: 0.35 * dir, up: 0.85, curl: 0, smooth: 1, straightness: 1, x: .5, y: .5 };
      const p = V3.new(dir * 0.1, TY + 0.35, 1.15), v = V3.new(0, 0.6, 6), w = V3.new(-60, 40 * dir, 0);
      const raw = deriveStroke(m, { side: 1, grip, hand: dir > 0 ? 'right' : 'left', forehand: true, isServe: false,
        ball: { x: p.x, y: p.y, z: p.z }, ballSpin: w, ballVelocity: v, ballSpeed: V3.len(v),
        powerScale: 1, equip: equip.forSide(1) });
      const sol = refineRacket(p, v, w, raw, 0.85, 0.9);
      assert.ok(sol && sol.valid, `${grip}: the ${dir > 0 ? 'right' : 'left'} handed stroke was not solvable`);
      const vv = V3.clone(v), ww = V3.clone(w);
      const info = impactRacket(vv, ww, sol.normal, sol.vR, 0.9, sol.rubber);
      assert.ok(info, `${grip}: separating face on a legal ${dir > 0 ? 'right' : 'left'} handed stroke`);
      const o = {};
      predict(launchPointFor(p, sol.normal), V3.clone(vv), V3.clone(ww), { dt: PH.SIM_DT, maxT: 2.6, out: o, stopOnFirstBounce: true });
      assert.ok(o.landed, `${grip}: no landing point for the ${dir > 0 ? 'right' : 'left'} handed stroke`);
      legal++;
      rows.push({ landX: o.landed.x, spinY: ww.y, speed: V3.len(vv) });
    }
    const [rh, lh] = rows;                     // right-handed and its mirror
    pairs++;
    assert.ok(Math.abs(rh.landX + lh.landX) < 0.02,
      `${grip}: the landing point is not mirrored (${rh.landX.toFixed(3)} vs ${lh.landX.toFixed(3)})`);
    assert.ok(Math.abs(rh.spinY + lh.spinY) < 8,
      `${grip}: the sidespin sign is not mirrored (${rh.spinY.toFixed(1)} vs ${lh.spinY.toFixed(1)})`);
    assert.ok(Math.abs(Math.abs(rh.landX) - Math.abs(lh.landX)) < 0.02 && Math.abs(rh.landX) > 0.03,
      `${grip}: the extreme zone is not reachable from both hands`);
    assert.ok(Math.abs(rh.speed - lh.speed) < 0.6, `${grip}: the mirror changed the pace`);
  }
  assert.equal(pairs, 2);
  assert.equal(legal, 4);
});
function launchPointFor(p, n) {
  return V3.add(V3.new(), p, V3.mul(V3.new(), n, PH.R));
}

/* ------------------------------------------------------------------ 20 */
test('20. rotating the scene mid-gesture drops the gesture instead of mixing two projections', () => {
  function fixture(w, h) {
    const g = Object.create(Game.prototype);
    Object.assign(g, {
      vw: w, vh: h, preview: null, camRig: null, settings: { quality: 'high' }, renderScale: 1,
      R: { resize() {} }, canvas: { clientWidth: w, clientHeight: h },
      swipe: new SwipeTracker(), cancelled: [],
    });
    g.cancelInput = (reason) => { g.cancelled.push(reason); g.swipe.cancel(); };
    return g;
  }
  /* 390×844 portrait → 844×390 landscape while the finger is down. */
  const rot = fixture(390, 844);
  rot.swipe.down(.5, .9, 0); rot.swipe.move(.5, .6, 0.016);
  assert.equal(rot.swipe.active, true);
  rot.canvas.clientWidth = 844; rot.canvas.clientHeight = 390;
  rot.resize();
  assert.deepEqual(rot.cancelled, ['viewport_resize'], 'a rotation did not cancel the live gesture');
  assert.equal(rot.swipe.active, false, 'the cancelled gesture kept accumulating samples');

  /* A keyboard/URL-bar jitter of 0.26 % is not a projection change. */
  const jitter = fixture(390, 844);
  jitter.swipe.down(.5, .9, 0); jitter.swipe.move(.5, .6, 0.016);
  jitter.canvas.clientWidth = 391;
  jitter.resize();
  assert.deepEqual(jitter.cancelled, []);
  assert.equal(jitter.swipe.active, true, 'a sub-2 % resize threw away a live gesture');

  /* Stroke maths is expressed in normalised units, so the same finger path
   * classifies identically on both projections — no coordinate can be mixed. */
  const path = [[.5, .9, 0], [.52, .82, .01], [.56, .7, .02], [.6, .58, .03], [.64, .46, .04]];
  const metrics = (w, h) => {
    const sw = new SwipeTracker(); sw.down(path[0][0], path[0][1], path[0][2]);
    for (let i = 1; i < path.length; i++) sw.move(path[i][0], path[i][1], path[i][2]);
    const last = path[path.length - 1];
    const m = sw.up(last[0], last[1], last[2]);
    /* Screen pixels are only produced at the very end, from the live viewport. */
    return { m, px: { x: m.x * w, y: m.y * h } };
  };
  const portrait = metrics(390, 844), landscape = metrics(844, 390);
  assert.equal(portrait.m.dist, landscape.m.dist);
  assert.equal(portrait.m.up, landscape.m.up);
  assert.equal(portrait.m.right, landscape.m.right);
  assert.equal(portrait.m.curl, landscape.m.curl);
  assert.notEqual(portrait.px.y, landscape.px.y);   // only the final pixel differs, as it must
  const stroke = deriveStroke(portrait.m, { side: 1, grip: 'shakehand', hand: 'right', forehand: true,
    isServe: false, ball: { x: 0, y: TY + 0.3, z: 1.1 }, ballSpin: { x: 0, y: 0, z: 0 },
    ballVelocity: { x: 0, y: 0.5, z: 6 }, ballSpeed: 6, powerScale: 1, equip: new Equipment().forSide(1) });
  const strokeLandscape = deriveStroke(landscape.m, { side: 1, grip: 'shakehand', hand: 'right', forehand: true,
    isServe: false, ball: { x: 0, y: TY + 0.3, z: 1.1 }, ballSpin: { x: 0, y: 0, z: 0 },
    ballVelocity: { x: 0, y: 0.5, z: 6 }, ballSpeed: 6, powerScale: 1, equip: new Equipment().forSide(1) });
  assert.equal(stroke.stroke.id, strokeLandscape.stroke.id, 'the classified stroke depends on the viewport');
});
