'use strict';
/* =====================================================================
 *  30 gameplay scenarios (2026-11-05) — part 3: stroke solution, AI and
 *  match/network state (scenarios 21…30).
 *
 *  Same rules as part 1: one numbered scenario per `test()`, asserting what
 *  the real engine modules can prove headlessly. The numbers in the names
 *  are the measured ones from `docs/scenarios-30-audit-2026-11-05.ru.md`.
 * ===================================================================== */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

class Socket { static OPEN = 1; constructor() { this.readyState = 1; } send() {} close() { this.readyState = 3; } }

const ENGINE = load([
  '10_math.js', '30_physics.js', '12_match_rules.js', '27_network.js', '37_stroke_motion_data.js',
  '38_paddle_motion.js', '40_swipe.js', '42_shot_diagnostics.js', '55_ai.js', '56_rig.js',
  '57_camera.js', '59_replay.js', '84_racket.js', '70_game.js',
], [
  'V3', 'Q', 'PH', 'MATCH_RULES', 'STROKE_CONFIG', 'SwipeTracker', 'deriveStroke', 'refineRacket',
  'impactRacket', 'impactSphere', 'predict', 'integrateBall', 'tableContact', 'bounceTable',
  'netContactStep', 'netContactKind', 'launchPoint', 'paddleContactPose', 'PaddleStrokeMotion',
  'Equipment', 'Game', 'GS', 'NetworkManager', 'netMirrorState', 'netMirrorInput', 'netFlipZ',
  'ShotJournal', 'reachFor', 'resetCameraCache', 'quantizeDepth', 'PADDLE_STANCE_Z',
], { WebSocket: Socket, location: { search: '' }, window: { devicePixelRatio: 2, innerWidth: 390, innerHeight: 844 } });
const {
  V3, Q, PH, STROKE_CONFIG, SwipeTracker, deriveStroke, refineRacket, impactRacket, predict,
  integrateBall, tableContact, bounceTable, netContactStep, paddleContactPose, PaddleStrokeMotion,
  Equipment, Game, GS, NetworkManager, netMirrorState, ShotJournal, reachFor, resetCameraCache,
  quantizeDepth, PADDLE_STANCE_Z,
} = ENGINE;

const TY = PH.TABLE_Y;
const GESTURES = { DRIVE: [0.2, 0, 1.2], LOOP: [0.5, 0, 1.2], PUSH: [-0.6, 0, 1.2], SIDE: [0, 1, 1.4], CHOP: [-0.95, 0, 3.0] };
const INCOMING = { TOP: [-180, 0, 0], BACK: [260, 0, 0], SIDE: [0, 240, 0], MIXED: [-120, 140, 40] };
const BALL_P = V3.new(0, TY + 0.35, 1.15), BALL_V = V3.new(0, 0.6, 6);
const metrics = (up, right, speed) => ({ samples: 8, dist: .24, pathLen: .24, speed, releaseSpeed: speed,
  peakSpeed: speed * 1.02, right, up, curl: 0, smooth: 1, straightness: 1, x: .5, y: .5 });

function stroke([up, right, speed], spin, assist = 0.85, grip = 'shakehand', hand = 'right') {
  const equip = new Equipment();
  const raw = deriveStroke(metrics(up, right, speed), { side: 1, grip, hand, forehand: true, isServe: false,
    ball: { x: BALL_P.x, y: BALL_P.y, z: BALL_P.z }, ballSpin: V3.clone(spin), ballVelocity: V3.clone(BALL_V),
    ballSpeed: V3.len(BALL_V), powerScale: 1, equip: equip.forSide(1) });
  const sol = refineRacket(BALL_P, V3.clone(BALL_V), V3.clone(spin), raw, assist, 0.9);
  const v = V3.clone(BALL_V), w = V3.clone(spin);
  const info = impactRacket(v, w, sol.normal, sol.vR, 0.9, sol.rubber);
  return { raw, sol, info, v, w, requested: raw.stroke.id, accepted: sol.stroke.id };
}

/* ------------------------------------------------------------------ 21 */
test('21. one incoming ball, three rackets and both faces: pace, spin and the contact parameters differ by equipment', () => {
  const n = V3.norm(V3.new(), V3.new(0, -0.22, -1));
  const vR = V3.new(0, 2.4, -8.4);
  const contact = (params) => {
    const v = V3.new(0, 0.55, 6.1), w = V3.new(-55, 25, 0);
    const info = impactRacket(v, w, n, vR, 0.95, params);
    return info ? { speed: V3.len(v), spin: V3.len(w), jn: info.Jn, slip: info.slipping } : null;
  };
  const base = new Equipment('b_base', 'r_base', 'r_base');
  const fast = new Equipment('b_carb', 'r_fast', 'r_fast');
  const spin = new Equipment('b_loop', 'r_tops', 'r_tops');
  const mixed = new Equipment('b_base', 'r_fast', 'r_tops');
  const b = contact(base.forSide(1)), f = contact(fast.forSide(1)), s = contact(spin.forSide(1));
  for (const r of [b, f, s]) assert.ok(r && Number.isFinite(r.speed) && Number.isFinite(r.spin), 'equipment produced a non-finite contact');
  assert.ok(f.speed > b.speed + 0.5, `the fast racket is not faster: ${f.speed.toFixed(2)} vs ${b.speed.toFixed(2)}`);
  assert.ok(s.spin > b.spin + 8, `the spin racket is not spinnier: ${s.spin.toFixed(0)} vs ${b.spin.toFixed(0)}`);
  assert.ok(s.spin / s.speed > b.spin / b.speed + 0.3,
    `the spin racket does not trade pace for spin: ${(s.spin / s.speed).toFixed(1)} vs ${(b.spin / b.speed).toFixed(1)}`);
  /* Both faces of one blade are different rubbers and must behave differently. */
  const fh = contact(mixed.forSide(1)), bh = contact(mixed.forSide(-1));
  assert.ok(fh && bh, 'a mixed blade lost one of its faces');
  assert.ok(fh.speed > bh.speed + 0.1, `FH/BH rubbers are indistinguishable in pace: ${fh.speed.toFixed(2)} vs ${bh.speed.toFixed(2)}`);
  assert.ok(bh.spin > fh.spin + 8, `the backhand rubber does not add spin: ${bh.spin.toFixed(0)} vs ${fh.spin.toFixed(0)}`);
  /* And the caps hold: no equipment can exceed the stroke ceilings. */
  for (const r of [b, f, s, fh, bh]) {
    assert.ok(r.speed < 40, `contact speed above the ceiling: ${r.speed}`);
    assert.ok(r.spin <= STROKE_CONFIG.spin.cap + 1e-6, `spin above the cap: ${r.spin}`);
  }
});

/* ------------------------------------------------------------------ 22 */
test('22. the stroke type survives every incoming spin, and the outgoing spin belongs to that type', () => {
  const family = { DRIVE: -1, LOOP: -1, SIDE: 0, PUSH: 1, CHOP: 1 };     // -1 topspin, +1 backspin, 0 sidespin
  let cases = 0;
  for (const [id, g] of Object.entries(GESTURES)) {
    for (const [sid, spin] of Object.entries(INCOMING)) {
      const r = stroke(g, V3.new(...spin));
      assert.ok(r.info, `${id}/${sid}: separating face on a legal stroke`);
      assert.equal(r.accepted, r.requested, `${id}/${sid}: the accepted type (${r.accepted}) differs from the requested one`);
      cases++;
      if (family[id] === 0) {
        assert.ok(Math.abs(r.w.y) > 25, `${id}/${sid}: a side-spin stroke produced almost no sidespin (${r.w.y.toFixed(0)})`);
        assert.ok(Math.abs(r.w.x) < 90, `${id}/${sid}: a side-spin stroke turned into topspin/backspin (${r.w.x.toFixed(0)})`);
      } else {
        assert.ok(Math.sign(r.w.x) === family[id] && Math.abs(r.w.x) > 80,
          `${id}/${sid}: the outgoing spin (${r.w.x.toFixed(0)}) does not belong to ${id}`);
      }
      assert.ok(Number.isFinite(V3.len(r.v)) && V3.len(r.v) > 1, `${id}/${sid}: no ball speed after the contact`);
    }
  }
  assert.equal(cases, 20);
  /* With the assist off, the contact model is live: the same swing against a
   * topspin and a backspin ball gives measurably different output. */
  const top = stroke(GESTURES.LOOP, V3.new(...INCOMING.TOP), 0);
  const back = stroke(GESTURES.LOOP, V3.new(...INCOMING.BACK), 0);
  assert.ok(top.info && back.info);
  assert.ok(Math.abs(V3.len(top.v) - V3.len(back.v)) > 0.5,
    `incoming spin does not reach the contact model at all (${V3.len(top.v).toFixed(2)} vs ${V3.len(back.v).toFixed(2)})`);
});

/* ------------------------------------------------------------------ 23 */
test('23. the assist never changes an already legal stroke type nor flips its spin sign', () => {
  const family = { DRIVE: -1, LOOP: -1, SIDE: 0, PUSH: 1, CHOP: 1 };
  let checked = 0;
  for (const assist of [0, 0.05, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0]) {
    for (const [id, g] of Object.entries(GESTURES)) {
      const r = stroke(g, V3.new(...INCOMING.TOP), assist);
      assert.ok(r.info, `assist ${assist}/${id}: the contact disappeared`);
      assert.equal(r.accepted, r.requested, `assist ${assist}: ${id} became ${r.accepted}`);
      if (family[id] !== 0) {
        assert.ok(Math.sign(r.w.x) === family[id],
          `assist ${assist}: ${id} flipped the spin sign to ${r.w.x.toFixed(0)}`);
      }
      checked++;
    }
  }
  assert.equal(checked, 40);
  /* What the assist is FOR: with the same gesture, the helped swing puts the
   * ball on the opponent's half, the unhelped one does not have to. It must
   * never do that by exceeding a physical ceiling. */
  const lands = (r) => {
    const o = {};
    predict(V3.add(V3.new(), BALL_P, V3.mul(V3.new(), r.sol.normal, PH.R)), V3.clone(r.v), V3.clone(r.w),
      { dt: PH.SIM_DT, maxT: 2.6, out: o, stopOnFirstBounce: true });
    return o.landed ? o.landed.z : NaN;
  };
  let helpedLanding = 0;
  for (const [id, g] of Object.entries(GESTURES)) {
    const helped = stroke(g, V3.new(), 1.0);
    const z = lands(helped);
    assert.ok(Number.isFinite(z), `assist 1.0/${id}: the helped stroke never landed`);
    if (z < 0) helpedLanding++;
    assert.ok(V3.len(helped.v) < 40 && V3.len(helped.w) <= STROKE_CONFIG.spin.cap + 1e-6,
      `assist 1.0/${id}: a physical ceiling was broken`);
  }
  assert.ok(helpedLanding >= 3, `only ${helpedLanding}/5 fully assisted strokes landed on the other side`);
});

/* ------------------------------------------------------------------ 24 */
test('24. a new ball arriving before the old animation ends: the AI paddle is at the new plan, not the old template', () => {
  function probe(dt, frames) {
    const g = Object.create(Game.prototype);
    const oldContact = V3.new(-0.35, 1.05, -1.2);
    const newIntercept = V3.new(0.45, 0.95, -1.35);
    Object.assign(g, {
      time: 5, state: GS.RALLY, _idleStill: false,
      ai: { pos: V3.clone(newIntercept), faceNormal: V3.new(0, 0, 1), anim: { windup: 0, swing: 1 }, roll: .28, forehand: true },
      aiPaddle: { pos: V3.clone(oldContact), prevPos: V3.new(), normal: V3.new(0, 0, 1), q: Q.new(), roll: .28 },
      ball: { live: true, lastHitBy: 1, p: V3.clone(newIntercept), v: V3.new() },
      aiPaddleMotion: new PaddleStrokeMotion(),
    });
    const normal = V3.norm(V3.new(), V3.new(-0.4, 0.2, 0.9));
    const racket = { normal, vR: V3.new(1, 1, 1), stroke: { id: 'DRIVE' }, forehand: true };
    const pose = paddleContactPose(oldContact, racket, { hand: 'right', grip: 'shakehand', forehand: true, roll: .28 });
    g.aiPaddleMotion.contact(normal, pose.roll, 'DRIVE', 'shakehand', 'right', true, true, { pose, racket, side: -1 });
    const start = V3.dist(g.aiPaddle.pos, newIntercept);
    for (let i = 0; i < frames; i++) g.updateOpponentPose(dt);
    return { start, end: V3.dist(g.aiPaddle.pos, newIntercept) };
  }
  for (const [dt, frames] of [[1 / 60, 24], [1 / 30, 12], [1 / 120, 48]]) {
    const r = probe(dt, frames);
    assert.ok(r.start > 0.5, `the fixture is not a real intercept change: ${r.start.toFixed(2)} m`);
    assert.ok(r.end < 0.02, `the old template kept the paddle ${r.end.toFixed(3)} m off the new plan (dt ${dt.toFixed(4)})`);
  }
});

/* ------------------------------------------------------------------ 25 */
test('25. two physical events in one substep give one contact, one episode and one point', () => {
  /* Net and table touched inside the same stepped frame: both primitives fire,
   * and the game has ONE episode to spend on them. */
  const hit = {}, tabHit = {};
  const net = netContactStep(0.70, TY + 0.06, 0.05, 0.70, TY + 0.01, -0.05, hit);
  const table = tableContact(0.70, TY + 0.06, 0.05, 0.70, TY + 0.01, -0.05, tabHit);
  assert.ok(net >= 1, 'the net plane crossing was not seen in that substep');
  assert.ok(table, 'the table contact was not seen in that substep');

  /* One point per episode: the second awardPoint in the same episode is a
   * no-op, so two primitives cannot score twice. */
  const g = Object.create(Game.prototype);
  let awards = 0;
  Object.assign(g, {
    time: 1, settings: { targetScore: 11, adaptive: false }, freePlay: false, career: { active: false },
    score: [0, 0], games: [0, 0], servesLeft: 2, server: 1, state: GS.RALLY, rally: 2, bestRally: 0,
    stats: { shots: 0, winners: 0, errors: 0, rallies: 0, byStroke: {}, maxSpeed: 0, maxSpin: 0, totalSpin: 0 },
    lastSwipeT: 0, lastPoint: null, training: null, debugRecording: false, network: { isInMatch: false }, ui: null,
    ball: { p: V3.new(), v: V3.new(), w: V3.new(), live: true, lastHitBy: -1, hist: [], trailGrade: null, golden: null },
    audio: { point() {}, applause() {}, setCrowd() {} }, recorder: {}, awards: [],
    analyst: { analyse() { return null; } }, ai: { onPointEnd() {}, setHandicap() {}, setPressure() {}, levelIndex: 1 },
    director: { onPoint() { return 1; }, streak: 0 }, shotJournal: null,
    moments: { endRally() { return null; } }, emitter: null,
    setState(s) { this.state = s; awards++; }, shakeIt() {}, msg() {}, buzz() {}, logInput() {},
    addMark() {}, emitParticles() {}, equip: {},
  });
  g.awardPoint(1, 'winner');
  const after = g.score[0] + g.score[1];
  g.awardPoint(1, 'same episode');
  g.awardPoint(-1, 'same episode');
  assert.equal(g.score[0] + g.score[1], after, 'a single episode was scored more than once');
  assert.equal(after, 1);
  assert.equal(g.state, GS.POINT, 'the episode did not close the rally');
});

/* ------------------------------------------------------------------ 26 */
test('26. a match through 10:10: serve rotation, advantage, set point — 10:10 → 11:10 → 11:11 → 13:11', () => {
  const g = Object.create(Game.prototype);
  Object.assign(g, {
    time: 1, settings: { targetScore: 11, adaptive: false }, freePlay: false, career: { active: false },
    score: [0, 0], games: [0, 0], servesLeft: 2, server: 1, state: GS.RALLY, rally: 0, bestRally: 0,
    stats: { shots: 0, winners: 0, errors: 0, rallies: 0, byStroke: {}, maxSpeed: 0, maxSpin: 0, totalSpin: 0 },
    lastSwipeT: 0, lastPoint: null, training: null, debugRecording: false, network: { isInMatch: false }, ui: null,
    matchWinner: 0,
    ball: { p: V3.new(), v: V3.new(), w: V3.new(), live: true, lastHitBy: -1, hist: [], trailGrade: null, golden: null },
    audio: { point() {}, applause() {}, setCrowd() {} }, recorder: {}, awards: [],
    analyst: { analyse() { return null; } }, ai: { onPointEnd() {}, setHandicap() {}, setPressure() {}, levelIndex: 1 },
    director: { onPoint() { return 1; }, streak: 0 }, shotJournal: null,
    moments: { endRally() { return null; } }, emitter: null,
    setState(s) { this.state = s; }, shakeIt() {}, msg() {}, buzz() {}, logInput() {},
    addMark() {}, emitParticles() {}, equip: {},
  });
  const play = (who) => {
    g.state = GS.RALLY;
    g.awardPoint(who, 'test');
    return `${g.score[0]}:${g.score[1]} srv=${g.server}/${g.servesLeft}`;
  };
  for (let i = 0; i < 10; i++) play(1);
  for (let i = 0; i < 10; i++) play(-1);
  assert.deepEqual(g.score, [10, 10]);
  const deuceServe = g.servesLeft;
  assert.equal(deuceServe, 1, 'serve did not switch to one point each at 10:10');
  const seq = [];
  seq.push(play(1));   // 11:10 advantage
  seq.push(play(-1));  // 11:11
  seq.push(play(1));   // 12:11 — one point ahead is NOT a win
  const notWon = g.matchWinner;
  seq.push(play(1));   // 13:11 — two ahead, the match is over
  assert.match(seq[0], /^11:10/);
  assert.match(seq[1], /^11:11/);
  assert.match(seq[2], /^12:11/);
  assert.match(seq[3], /^13:11/);
  assert.equal(notWon, 0, 'the match ended on a one-point lead');
  assert.equal(g.matchWinner, 1, `the match did not end on a two-point lead: ${seq[seq.length - 1]}`);
  assert.deepEqual(g.score, [13, 11]);
  /* Every deuce point changes the server. */
  assert.ok(seq.every(r => /srv=(-?1)\/1$/.test(r)), `deuce serve rotation broke: ${seq.join(' ')}`);
});

/* ------------------------------------------------------------------ 27 */
test('27. the first hit of a new point cannot be served by the previous gesture or template', () => {
  const g = Object.create(Game.prototype);
  const swipe = new SwipeTracker();
  const motion = new PaddleStrokeMotion();
  Object.assign(g, {
    time: 4, state: GS.SERVE_READY, settings: { hand: 'right', grip: 'shakehand' },
    pointer: { x: .5, y: .55 }, pointerInside: true, pointerDown: true,
    padYaw: .3, padRoll: .2, padPitch: -.2, liveStroke: { stroke: 'LOOP', t: 0 }, _prep: 1,
    _settlePaddleFace: true, mouseTrail: [[.5, .9]], followThrough: { active: true },
    paddleMotion: motion, swipe,
    player: { pos: V3.new(0.4, TY + 0.5, 1.6), prevPos: V3.new(0.4, TY + 0.5, 1.6), prev: V3.new(0.4, TY + 0.5, 1.6),
      vel: V3.new(1, 0, 0), normal: V3.new(0, -0.2, -1), forehand: true, swing: .6, yaw: .3, pitch: -.2, roll: .2 },
    _paddlePred: { reach: {} }, _strikePred: { reach: {} }, _volleyPred: { reach: {} },
    paddleReadClock: { reset() {} }, strikeReadClock: { reset() {} },
    _strike: { on: true, k: .8 },
  });
  swipe.down(.5, .9, 4); swipe.move(.5, .6, 4.02); swipe.move(.55, .4, 4.04);
  assert.equal(swipe.active, true, 'the fixture gesture is not live');
  g.resetPaddle(true);
  assert.equal(g.pointerDown, false, 'the old finger is still down after the reset');
  assert.equal(swipe.active, false, 'the old gesture survived the reset and can hit the new ball');
  assert.equal(g.liveStroke, null, 'the old stroke template survived the reset');
  assert.equal(g._prep, 0);
  assert.equal(g._settlePaddleFace, false);
  assert.equal(g.followThrough.active, false, 'the old follow-through is still animating');
  assert.equal(g._strike.on, false, 'the old strike cue is still on');
  assert.equal(g._paddlePred.reach, null, 'the old reach cache is still handed to the new point');
  assert.deepEqual([g.player.pos.x, g.player.pos.y, g.player.pos.z], [0, TY + 0.28, PADDLE_STANCE_Z],
    'the hard reset did not park the bat at the home pose');
  assert.equal(g.paddleMotion.active, false, 'the racket kept animating the previous point');
});

/* ------------------------------------------------------------------ 28 */
test('28. online: the same physical situation is a mirror image on the guest, contact and score included', () => {
  const mirrored = netMirrorState({ ball: { p: [0, 0.5, 0.8], v: [0.3, 0.5, -4], w: [100, 50, 20] }, lastHitBy: 1 });
  assert.equal(mirrored.ball.p[2], -0.8, 'the ball depth was not mirrored');
  assert.equal(mirrored.ball.v[2], 4, 'the ball velocity was not mirrored');
  assert.equal(mirrored.ball.w[0], -100, 'the topspin sign was not mirrored');
  assert.equal(mirrored.ball.w[1], -50, 'the sidespin was not mirrored as an axial vector');
  assert.equal(mirrored.lastHitBy, -1, 'the striker is not mirrored');
  assert.equal(netMirrorState({ lastHitBy: -1 }).lastHitBy, 1);
  assert.ok(netMirrorState({ lastHitBy: 0 }).lastHitBy === 0, 'the toss striker must mirror to itself');

  const game = {
    ball: { p: V3.new(0, 0.5, 1.2), v: V3.new(0, 0, -5), w: V3.new(), live: true, lastHitBy: 0 },
    score: [0, 0], server: 1, state: 'RALLY', rally: 0,
    player: { pos: V3.new(), normal: V3.new() }, aiPaddle: { pos: V3.new(), normal: V3.new() },
    ai: { pos: V3.new() }, ui: { syncScore() {} },
  };
  const net = new NetworkManager(game);
  net.isHost = false; net.state = 'IN_MATCH'; net.side = -1;
  net._handle({ type: 'state', t: 1, lastHitBy: 1, ball: { p: [0, 0.4, 0.8], v: [0, 1, -4], w: [0, 0, 0] },
    racket: { pos: [0, 0.3, 1], n: [0, 0, 1] }, score: [1, 0], state: 'RALLY', server: 1, rally: 3 });
  assert.equal(game.ball.lastHitBy, -1, 'the guest still believes it struck the incoming ball');
  /* The guest interpolates towards the host state, so the ball converges to the
   * mirrored position over the next frames instead of teleporting. */
  let prevZ = game.ball.p.z;
  for (let t = 1.1; t <= 2.3; t += 0.1) {
    net._handle({ type: 'state', t, lastHitBy: 1, ball: { p: [0, 0.4, 0.8], v: [0, 1, -4], w: [0, 0, 0] },
      racket: { pos: [0, 0.3, 1], n: [0, 0, 1] }, score: [1, 0], state: 'RALLY', server: 1, rally: 3 });
    assert.ok(game.ball.p.z <= prevZ + 1e-9, 'the guest ball moved away from the host position');
    prevZ = game.ball.p.z;
  }
  assert.ok(Math.abs(game.ball.p.z + 0.8) < 0.05, `the guest ball did not reach the mirrored position: ${game.ball.p.z.toFixed(3)}`);
  /* Every score on the guest is the host's, mirrored into the guest frame. */
  assert.equal(game.score.join(','), '0,1', 'the guest did not mirror the host score');
  net._handle({ type: 'point', score: [2, 0], server: 1, rally: 0 });
  assert.equal(game.score.join(','), '0,2', 'the guest did not mirror the announced point');
  net._handle({ type: 'point', score: [1, 0], server: 1, rally: 0 });
  /* And a guest can never award a point of its own. */
  game.network = net;
  game.ball.hist = [];
  const award = Game.prototype.awardPoint;
  award.call(game, 1, 'guest-side physics');
  assert.equal(game.score.join(','), '0,1', 'the guest scored a point its host did not award');
  assert.equal(game.ball.live, false, 'the guest did not stop the ball on a host point');
});

/* ------------------------------------------------------------------ 29 */
test('29. online with lag, lag spikes and repeats: one confirmed contact, no rewound ball', () => {
  const game = {
    ball: { p: V3.new(0, 0.5, 1), v: V3.new(0, 0.5, 8), w: V3.new(), live: true, lastHitBy: -1 },
    score: [0, 0], server: 1, state: 'RALLY', rally: 3,
  };
  const host = new NetworkManager(game);
  host.isHost = true; host.state = 'IN_MATCH';
  host._handle({ type: 'guestHit', hitId: 1, v: [0, 0.5, 8], w: [0, 0, 0], rally: 4 });
  assert.equal(game.ball.lastHitBy, -1, 'the guest strike was not applied');
  assert.equal(game.ball.v.z, -8, 'the guest strike mirrors the wrong axis');
  const beforeZ = game.ball.v.z;
  game.ball.lastHitBy = 1;                       // the host returned it
  host._handle({ type: 'guestHit', hitId: 1, v: [0, 9, 9], w: [0, 0, 0], rally: 4 });
  assert.equal(game.ball.v.z, beforeZ, 'a duplicated guestHit was applied twice');
  assert.equal(game.ball.lastHitBy, 1, 'a duplicated guestHit rewound the striker');
  host._handle({ type: 'guestHit', hitId: 2, v: [0, 0.4, 7], w: [0, 0, 0], rally: 5 });
  assert.equal(game.ball.v.z, -7, 'a genuinely new strike was dropped as a duplicate');

  /* A lagging state must not rewind the rally, and equal clocks are repeats. */
  const guestGame = {
    ball: { p: V3.new(0, 0.5, 1), v: V3.new(), w: V3.new(), live: true, lastHitBy: 0 },
    score: [0, 0], server: 1, state: 'RALLY', rally: 0,
    player: { pos: V3.new(), normal: V3.new() }, aiPaddle: { pos: V3.new(), normal: V3.new() },
    ai: { pos: V3.new() }, ui: { syncScore() {} },
  };
  const guest = new NetworkManager(guestGame);
  guest.isHost = false; guest.state = 'IN_MATCH'; guest.side = -1;
  const send = (t, z) => guest._handle({ type: 'state', t, lastHitBy: 0, ball: { p: [0, 0.5, z], v: [0, 0, 6], w: [0, 0, 0] },
    racket: { pos: [0, 0.3, 1], n: [0, 0, 1] }, score: [0, 0], state: 'RALLY' });
  send(2, 0.9);
  const zApplied = guestGame.ball.p.z;
  send(1.4, 0.2);                                 // 600 ms late
  assert.equal(guestGame.ball.p.z, zApplied, 'a stale state dragged the guest ball backwards');
  send(2, 0.1);                                   // duplicate of the last clock
  assert.equal(guestGame.ball.p.z, zApplied, 'a duplicate state was applied twice');
  send(2.5, 0.6);
  assert.ok(guestGame.ball.p.z < zApplied - 0.3,
    `a fresh state was ignored (z ${guestGame.ball.p.z.toFixed(3)} after ${zApplied.toFixed(3)})`);
});

/* ------------------------------------------------------------------ 30 */
test('30. a long session does not accumulate state or degrade the frame', () => {
  /* 1. The shot journal is a ring buffer: 1000 contacts cannot grow it. */
  const journal = new ShotJournal();
  for (let i = 1; i <= 1000; i++) {
    journal.create(i, i * 0.01);
    journal.observe(i, metrics(0.5, 0, 2), { strokeId: 'LOOP', isServe: false, time: i * 0.01, sampleTime: i * 0.01 });
  }
  const limit = journal.limit;
  assert.ok(Number.isFinite(limit) && limit > 0, 'the journal has no limit');
  assert.ok(journal.records.length <= limit, `the journal grew to ${journal.records.length} records`);

  /* 2. The gesture tracker keeps no history between gestures. */
  const sw = new SwipeTracker();
  for (let i = 0; i < 1000; i++) {
    sw.down(.5, .9, i);
    sw.move(.5, .7, i + .01);
    sw.move(.55, .5, i + .02);
    sw.up(.6, .4, i + .03);
  }
  for (const key of ['samples', 'points', '_samples', 'trail']) {
    if (Array.isArray(sw[key])) assert.ok(sw[key].length < 64, `SwipeTracker.${key} accumulated ${sw[key].length} entries`);
  }
  assert.equal(sw.active, false);

  /* 3. The camera/reach caches are keyed on a quantised depth, so a session
   * that slides the blade in by millimetres cannot grow a box per millimetre:
   * 1000 depths inside the 1.05 m envelope collapse to ~105 bins. */
  const bins = new Set();
  for (let i = 0; i <= 1000; i++) bins.add(quantizeDepth(1.30 + i * 0.00105));
  assert.ok(bins.size <= 110, `the depth key space grew to ${bins.size} bins`);
  assert.equal(quantizeDepth(1.5001), quantizeDepth(1.5004));
  assert.notEqual(quantizeDepth(1.5001), quantizeDepth(1.62));

  /* 4. One thousand solved swings: the last hundred are not slower than the
   * first hundred, so no per-contact state is being carried. */
  const solve = () => {
    const r = refineRacket(BALL_P, V3.clone(BALL_V), V3.new(-60, 20, 0),
      deriveStroke(metrics(0.5, 0, 1.2), { side: 1, grip: 'shakehand', hand: 'right', forehand: true, isServe: false,
        ball: { x: BALL_P.x, y: BALL_P.y, z: BALL_P.z }, ballSpin: V3.new(-60, 20, 0),
        ballVelocity: V3.clone(BALL_V), ballSpeed: V3.len(BALL_V), powerScale: 1,
        equip: new Equipment().forSide(1) }), 0.85, 0.9);
    return r.valid;
  };
  for (let i = 0; i < 200; i++) solve();          // warm up
  const batch = () => { const t = process.hrtime.bigint(); for (let i = 0; i < 100; i++) solve(); return Number(process.hrtime.bigint() - t) / 1e6; };
  const first = batch();
  for (let i = 0; i < 800; i++) solve();
  const last = batch();
  assert.ok(last < first * 2.5 + 5, `solving slowed from ${first.toFixed(1)} ms to ${last.toFixed(1)} ms per 100`);
  /* 5. Physics itself stays allocation-free-ish over a thousand contacts. */
  const v = V3.new(0, 0.5, 6), w = V3.new(-60, 20, 0), n = V3.norm(V3.new(), V3.new(0, -0.2, -1));
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) {
    const vv = V3.clone(v), ww = V3.clone(w);
    const info = impactRacket(vv, ww, n, V3.new(0, 2, -8), 0.95, {});
    if (!info) assert.fail('a contact disappeared during the long run');
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 400, `1000 contacts took ${ms.toFixed(0)} ms`);
});
