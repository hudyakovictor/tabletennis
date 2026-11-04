'use strict';
// 150 deterministic, parameterized checks of live game handlers. These are
// scenarios in four families, not 150 independent theories about the game.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { Game, GS, PH, V3, Q, predict } = load(
  ['10_math.js', '30_physics.js', '40_swipe.js', '70_game.js'],
  ['Game', 'GS', 'PH', 'V3', 'Q', 'predict']);

function rulesFixture({ server, hitter, serve, history = [], net = false }) {
  const g = Object.create(Game.prototype);
  Object.assign(g, { time: 2, server, state: GS.RALLY, isServeBall: serve,
    serveBounces: 0, rallyBounces: history.slice(), netTouched: net,
    ball: { p: V3.new(0, PH.TABLE_Y + PH.R, .5), v: V3.new(), w: V3.new(), live: true, lastHitBy: hitter },
    audio: { hitTable() {}, hitFloor() {} }, recorder: { addBounce() {} },
    awards: [], lets: 0, addMark() {}, emitParticles() {}, shakeIt() {},
    awardPoint(who) { this.awards.push(who); this.ball.live = false; },
    letServe() { this.lets++; this.ball.live = false; },
  });
  return g;
}

// 64: both servers, unstruck/struck toss, first and second side, net, speeds.
for (const server of [-1, 1]) for (const struck of [false, true])
  for (const first of [-1, 1]) for (const second of [-1, 1])
    for (const net of [false, true]) for (const speed of [.3, 8]) {
      test(`serve ${server}/${struck}/${first}/${second}/net=${net}/speed=${speed}`, () => {
        const g = rulesFixture({ server, hitter: struck ? server : 0, serve: true, net });
        g.onBounce(first, speed, null);
        if (!struck || first !== server) {
          assert.deepEqual(g.awards, [-server]); assert.equal(g.lets, 0); return;
        }
        assert.equal(g.awards.length, 0); assert.equal(g.serveBounces, 1);
        g.onBounce(second, speed, null);
        if (second !== -server) { assert.deepEqual(g.awards, [-server]); assert.equal(g.lets, 0); }
        else if (net) { assert.equal(g.lets, 1); assert.equal(g.awards.length, 0); }
        else { assert.equal(g.lets, 0); assert.equal(g.awards.length, 0); assert.equal(g.isServeBall, false); assert.deepEqual(g.rallyBounces, [-server]); }
      });
    }

// 24: first and possible second bounce on either half, for both hitters.
for (const hitter of [-1, 1]) for (const first of [-1, 1])
  for (const second of [0, -1, 1]) for (const speed of [.3, 8]) {
    test(`rally ${hitter}/${first}/${second}/speed=${speed}`, () => {
      const g = rulesFixture({ server: hitter, hitter, serve: false });
      g.onBounce(first, speed, null);
      if (first === hitter) { assert.deepEqual(g.awards, [-hitter]); return; }
      assert.equal(g.awards.length, 0);
      if (!second) return;
      g.onBounce(second, speed, null);
      assert.deepEqual(g.awards, [hitter]);
    });
  }

// 32: floor resolution before or after a legal bounce, including unstruck tosses.
for (const server of [-1, 1]) for (const variant of [0, 1, 2, 3])
  for (const bounced of [false, true]) for (const speed of [.4, 7]) {
    test(`floor ${server}/${variant}/bounced=${bounced}/speed=${speed}`, () => {
      const serve = variant < 2;
      const hitter = serve ? (variant === 0 ? 0 : server) : (variant === 2 ? server : -server);
      const history = bounced ? [serve ? server : -hitter] : [];
      const g = rulesFixture({ server, hitter, serve, history });
      g.serveBounces = bounced ? 1 : 0; g.ball.v.y = -speed;
      g.onFloor();
      assert.deepEqual(g.awards, [serve ? -server : bounced ? hitter : -hitter]);
    });
  }

// 30: compare actual net event and predictor in both directions, above/below
// the net and around the posts. Stop at the event, not the random deflection.
for (const direction of [-1, 1]) for (const height of [PH.TABLE_Y - .06, PH.NET_TOP, PH.NET_TOP + .1])
  for (const x of [-PH.NET_HALF_WID - .01, -PH.NET_HALF_WID + .01, 0, PH.NET_HALF_WID - .01, PH.NET_HALF_WID + .01]) {
    test(`net direction=${direction}, height=${height.toFixed(3)}, x=${x.toFixed(3)}`, () => {
      const p = V3.new(x, height, -direction * .025), v = V3.new(0, 0, direction * 8), w = V3.new();
      const pred = predict(p, v, w, { dt: PH.SIM_DT, maxT: PH.SIM_DT });
      let netEvents = 0;
      const g = Object.create(Game.prototype);
      Object.assign(g, { time: 1, state: GS.RALLY, stats: {}, player: { lastHitT: 1 },
        ball: { p: V3.clone(p), v: V3.clone(v), w: V3.clone(w), q: Q.new(), live: true, lastHitBy: -1 },
        audio: { hitNet() { netEvents++; }, hitEdge() {}, hitFloor() {} }, moments: { addBounce() {} },
        msg() {}, shakeIt() {}, emitParticles() {}, punchSlowmo() {}, buzz() {}, _trailCrumb() {}, watchdogSubstep() {},
        onBounce() { throw Error('unexpected table collision'); } });
      g.stepPhysics(PH.SIM_DT);
      assert.equal(netEvents > 0, pred.hitNet);
      const expectedKind = Math.abs(x) < PH.NET_HALF_WID && height === PH.NET_TOP ? 2 : 0;
      assert.equal(pred.netKind || 0, expectedKind);
    });
  }
