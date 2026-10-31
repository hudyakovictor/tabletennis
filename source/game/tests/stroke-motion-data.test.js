'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '30_physics.js', '37_stroke_motion_data.js'],
  ['PADDLE_TEMPLATES', 'compileStrokeTemplate', 'sampleStrokeTemplate',
    'retargetStrokeTemplate', 'createStrokeTemplateOutput', 'V3', 'Q', 'M4', 'PH', 'STROKE_CONFIG']);
const { PADDLE_TEMPLATES: data, compileStrokeTemplate: compile, sampleStrokeTemplate: sample,
  retargetStrokeTemplate: retarget, createStrokeTemplateOutput: output, V3, Q, M4, PH } = lib;
const ids = ['DRIVE', 'LOOP', 'COUNTER', 'SMASH', 'FLICK', 'SIDE', 'HOOK', 'FADE', 'BLOCK',
  'PUSH', 'CHOP', 'DROP', 'LOB', 'SERVE_TOP', 'SERVE_BACK', 'SERVE_SIDE', 'SERVE_FAST',
  'BANANA', 'CHOP_BLOCK', 'SERVE_NO_SPIN'];
const near = (a, b, e = 1e-8) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b} (tolerance ${e})`);
const nearV = (a, b, e = 1e-8) => { for (const axis of ['x', 'y', 'z']) near(a[axis], b[axis], e); };
const dotQ = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
const finite = pose => {
  for (const key of ['p', 'q', 'n', 'up', 'v', 'w', 'point', 'vR'])
    for (const value of Object.values(pose[key])) assert.ok(Number.isFinite(value), `${key} is not finite`);
  near(Math.hypot(pose.q.x, pose.q.y, pose.q.z, pose.q.w), 1);
  near(V3.len(pose.n), 1); near(V3.len(pose.up), 1); near(V3.dot(pose.n, pose.up), 0);
};
const mirrorV = (v, sx, sz) => V3.new(v.x * sx, v.y, v.z * sz);
const frozen = o => {
  assert.ok(Object.isFrozen(o));
  for (const v of Object.values(o)) if (v && typeof v === 'object') frozen(v);
};

test('all 17 source IDs/152 keys/87 references plus three independent profiles are immutable', () => {
  assert.deepEqual(Object.keys(data.strokes).sort(), [...ids].sort());
  const original = Object.values(data.strokes).filter(s => s.authored === 'source');
  assert.equal(original.length, 17);
  assert.equal(original.reduce((n, s) => n + s.keys.length, 0), 152);
  assert.equal(original.reduce((n, s) => n + s.ballReference.length, 0), 87);
  frozen(data);
  for (const id of ids) {
    const s = data.strokes[id];
    assert.equal(s.sourceId, id.toLowerCase());
    assert.equal(s.ballReference.filter(p => p.contact).length, 1);
    assert.equal(s.spinIn, undefined); assert.equal(s.spinOut, undefined);
    assert.equal(s.swipeReference.referenceOnly, true);
    assert.equal(s.swipeReference.space, 'screen-percent-y-down');
    assert.ok(s.swipeReference.pts.every(p => p.every(v => v >= 0 && v <= 100)));
  }
  for (const id of ids.slice(17)) {
    assert.equal(data.strokes[id].authored, 'project');
    assert.notDeepEqual(data.strokes[id].keys, data.strokes.DRIVE.keys);
  }
});

test('absolute references use table origin, relative dp is never translated', () => {
  const drive = data.strokes.DRIVE;
  near(drive.ballReference[2].p[0], .34);
  near(drive.ballReference[2].p[1], PH.TABLE_Y + .24);
  near(drive.ballReference[2].p[2], PH.T_HALF_LEN + .14);
  assert.deepEqual(Array.from(drive.keys[0].dp), [-.12, -.04, .22]);
  near(data.geometry.rubberOffset, .010);
  near(data.geometry.ballRadius, PH.BALL_R ?? PH.R);
  const c = compile('drive');
  nearV(V3.sub(V3.new(), c.keys[0].p, c.contact.p), V3.new(-.12, -.04, .22));
});

for (const id of ids) {
  test(`${id}: finite unit frames, non-uniform C1 poses, real surface contact and all mirrors`, () => {
    const authoredFH = data.strokes[id].hand === 'fh';
    for (const grip of ['shakehand', 'penhold']) for (const forehand of [true, false]) {
      const c = compile(id, { grip, forehand, loop: true, duration: .38 });
      frozen(c);
      const a = output(), b = output(), before = output(), after = output();
      sample(c, c.contactPhase, a);
      nearV(a.p, c.contact.p); nearV(a.n, c.contact.n); nearV(a.point, c.contact.point);
      nearV(a.vR, c.contact.vR); near(Math.abs(dotQ(a.q, c.contact.q)), 1);
      near(V3.dist(c.contact.ballP, a.point), data.geometry.ballRadius);
      near(V3.dot(V3.sub(V3.new(), a.point, a.p), a.n), .010);
      assert.equal(a.stage, 'contact');
      const mat = M4.compose(M4.create(), a.p, a.q, V3.new(1, 1, 1));
      nearV(M4.transformDir(V3.new(), mat, V3.new(0, 0, c.activeFace)), a.n, 1e-7);
      nearV(M4.transformDir(V3.new(), mat, V3.new(0, 1, 0)), a.up, 1e-7);
      for (let step = 0; step <= 200; step++) {
        sample(c, step / 200, a); finite(a);
        if (step) assert.ok(Math.abs(dotQ(a.q, b.q)) > .95, 'orientation has no sign/long-path jump');
        Q.copy(b.q, a.q);
      }
      for (const key of c.keys) {
        sample(c, key.t - 1e-7, before); sample(c, key.t + 1e-7, after);
        nearV(before.p, after.p, 5e-6); nearV(before.v, after.v, 5e-5);
        nearV(before.n, after.n, 5e-6); nearV(before.up, after.up, 5e-6);
        nearV(before.w, after.w, 2e-4); nearV(before.vR, after.vR, 6e-5);
      }
      const left = compile(id, { grip, forehand, hand: 'left', loop: true, duration: .38 });
      const far = compile(id, { grip, forehand, side: -1, loop: true, duration: .38 });
      const opposite = compile(id, { grip, forehand: !forehand, loop: true, duration: .38 });
      for (const phase of [0, .13, .365, c.contactPhase, .67, .93, 1]) {
        sample(c, phase, a);
        for (const [variant, sx, sz] of [[left, -1, 1], [far, -1, -1], [opposite, -1, 1]]) {
          sample(variant, phase, b);
          for (const key of ['p', 'n', 'up', 'v', 'point', 'vR']) nearV(b[key], mirrorV(a[key], sx, sz));
          nearV(b.w, V3.new(a.w.x * sz, a.w.y * sx * sz, a.w.z * sx));
        }
      }
      assert.equal(c.activeFace, forehand ? 1 : -1);
      assert.equal(c.forehand, forehand);
      assert.equal(c.swipeReference.curl, data.strokes[id].swipeReference.curl * (forehand === authoredFH ? 1 : -1));

      // An arbitrary real impact overrides the template, including surface velocity.
      const normal = V3.norm(V3.new(), V3.new(.23, -.31, -.92));
      const up = V3.new(.8, .45, .1), point = V3.new(.21, 1.12, 1.43), vR = V3.new(2.7, 1.4, -8.3);
      const target = { point, normal, up, vR, duration: .29 };
      const r = retarget(c, target);
      sample(r, c.contactPhase, a); finite(a);
      nearV(a.point, point); nearV(a.n, normal); nearV(a.vR, vR);
      nearV(a.p, r.contact.p); near(Math.abs(dotQ(a.q, r.contact.q)), 1);
      near(V3.dot(V3.sub(V3.new(), point, a.p), a.n), .010);
      near(V3.dist(r.contact.ballP, point), data.geometry.ballRadius);
      const ballP = V3.addScaled(V3.new(), point, normal, data.geometry.ballRadius);
      const byBall = retarget(c, { ballP, q: a.q, vR, duration: .29 });
      const byCenter = retarget(c, { p: a.p, q: a.q, vR, duration: .29 });
      nearV(byBall.contact.p, a.p); nearV(byCenter.contact.p, a.p);
      const h = 1e-7;
      sample(r, c.contactPhase - h, before); sample(r, c.contactPhase + h, after);
      nearV(V3.mul(V3.new(), V3.sub(V3.new(), after.point, before.point), 1 / (2 * h * r.duration)), vR, 1e-4);
      nearV(before.vR, after.vR, 4e-4);
      for (const edge of [c.backPhase, c.finishPhase, 0, 1]) {
        sample(r, edge - 1e-7, before); sample(r, edge + 1e-7, after);
        nearV(before.p, after.p, 5e-6); nearV(before.v, after.v, 2e-4);
      }
      const combined = compile(id, { grip, forehand, hand: 'left', side: -1, loop: true, duration: .38 });
      const mirroredTarget = { point: mirrorV(point, 1, -1), normal: mirrorV(normal, 1, -1),
        up: mirrorV(up, 1, -1), vR: mirrorV(vR, 1, -1), duration: .29 };
      const mirroredRetarget = retarget(combined, mirroredTarget);
      for (const phase of [.15, c.backPhase, .50, c.contactPhase, .63, c.finishPhase, .88]) {
        sample(r, phase, a); sample(mirroredRetarget, phase, b);
        for (const key of ['p', 'n', 'up', 'v', 'point', 'vR']) nearV(b[key], mirrorV(a[key], 1, -1));
      }
    }
  });
}

test('contact phase is read from marker, supports nonzero relative contact dp', () => {
  const fixture = JSON.parse(JSON.stringify(data.strokes.DRIVE));
  fixture.keys[4].t = .58; fixture.keys[4].dp = [.014, -.02, .007];
  fixture.ballReference[2].t = .58;
  const c = compile(fixture), pose = sample(c, .58);
  near(c.contactPhase, .58); nearV(pose.point, c.contact.point);
  near(V3.dist(c.contact.ballP, pose.point), data.geometry.ballRadius);
  nearV(c.keys[4].p, c.contact.p);
  const expected = V3.new(fixture.keys[0].dp[0] - .014, fixture.keys[0].dp[1] + .02, fixture.keys[0].dp[2] - .007);
  nearV(V3.sub(V3.new(), c.keys[0].p, c.contact.p), expected);
  assert.equal(sample(c, .58).stage, 'contact');
});

test('non-uniform Hermite uses phase intervals, not equally spaced key indices', () => {
  const c = compile('DRIVE');
  const a = c.keys[2], b = c.keys[3], previous = c.keys[1], next = c.keys[4];
  const phase = a.t + (b.t - a.t) * .37, u = .37, dt = b.t - a.t;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  const expected = V3.new();
  for (const axis of ['x', 'y', 'z']) expected[axis] = h00 * a.p[axis] + h01 * b.p[axis]
    + h10 * dt * (b.p[axis] - previous.p[axis]) / (b.t - previous.t)
    + h11 * dt * (next.p[axis] - a.p[axis]) / (next.t - a.t);
  nearV(sample(c, phase).p, expected);
  const normal = compile('DRIVE'), fast = compile('DRIVE', { duration: normal.duration / 3 });
  for (const phase of [.24, .48, normal.contactPhase, .81]) {
    const a = sample(normal, phase), b = sample(fast, phase);
    nearV(a.p, b.p); near(Math.abs(dotQ(a.q, b.q)), 1);
    nearV(b.v, V3.mul(V3.new(), a.v, 3)); nearV(b.vR, V3.mul(V3.new(), a.vR, 3));
  }
});

test('quaternion interpolation crosses +/-180 on the short hemisphere and handles parallel up', () => {
  const fixture = JSON.parse(JSON.stringify(data.strokes.DRIVE));
  for (let i = 0; i < fixture.keys.length; i++) {
    const angle = (i % 2 ? -179 : 179) * Math.PI / 180;
    fixture.keys[i].n = [Math.sin(angle), 0, Math.cos(angle)];
    fixture.keys[i].up = [0, 1, 0];
  }
  const c = compile(fixture, { loop: true });
  for (let i = 0; i < 100; i++) {
    const p = sample(c, i / 100); finite(p);
    assert.ok(p.n.z < -.99, 'interpolation did not take the long path through zero degrees');
  }
  for (const key of fixture.keys) { key.n = [0, 1, 0]; key.up = [0, 1, 0]; }
  finite(sample(compile(fixture), .55));
});

test('one-shot clamps with stationary ends; loop wraps without pose/velocity discontinuities', () => {
  const single = compile('BANANA'), loop = compile('BANANA', { loop: true });
  for (const [phase, end] of [[-3, 0], [4, 1], [NaN, 0], [Infinity, 0]]) {
    const a = sample(single, phase), b = sample(single, end);
    finite(a); nearV(a.p, b.p); nearV(a.v, V3.new()); nearV(a.w, V3.new());
  }
  nearV(sample(loop, -.37).p, sample(loop, .63).p);
  nearV(sample(loop, 7.63).p, sample(loop, .63).p);
  nearV(sample(loop, 0).v, sample(loop, 1).v);
  for (const c of [single, loop]) {
    assert.equal(sample(c, 0).stage, 'ready');
    assert.equal(sample(c, c.readyPhase).stage, 'backswing');
    assert.equal(sample(c, c.backPhase).stage, 'swing');
    assert.equal(sample(c, c.contactPhase).stage, 'contact');
    assert.equal(sample(c, c.finishPhase).stage, 'recover');
  }
});

test('custom local contact stays on the correct rubber with rotational surface velocity', () => {
  const c = compile('LOOP', { forehand: false, grip: 'penhold' });
  const point = V3.new(-.4, 1.03, 1.7), vR = V3.new(-2, 4, -7), localPoint = [.022, -.018, -.010];
  const r = retarget(c, { point, normal: V3.new(.1, -.3, -1), vR, localPoint, duration: .31 });
  const pose = sample(r, c.contactPhase), m = M4.compose(M4.create(), pose.p, pose.q, V3.new(1, 1, 1));
  nearV(M4.transformPoint(V3.new(), m, V3.new(...localPoint)), point, 1e-7);
  nearV(pose.vR, vR);
  assert.ok(V3.dist(pose.v, pose.vR) > .01, 'surface velocity includes omega cross offset');
  const fixed = retarget(c, { p: pose.p, q: pose.q, vR, localPoint, duration: .31 });
  nearV(fixed.contact.point, point);
  const actualLocalPoint = Object.freeze(V3.new(...localPoint));
  const byPose = retarget(c, { point, q: pose.q, normal: pose.n, up: pose.up, vR,
    localPoint: actualLocalPoint, duration: .31 });
  nearV(byPose.contact.p, pose.p); nearV(byPose.contact.vR, vR);
  nearV(byPose.localPoint, actualLocalPoint);
});

test('out buffers are reused with no vector/quaternion allocations and preview/live remain independent', () => {
  const c = compile('HOOK'), a = output(), b = output();
  const target = { point: V3.new(.1, 1.1, 1.6), normal: V3.new(0, -.2, -1), vR: V3.new(2, 2, -6), duration: .36 };
  const r = retarget(c, target), refs = { ...a }, contactRefs = { ...r.contact };
  const saved = JSON.stringify(c), other = retarget(c, { point: V3.new(-.4, 1.4, 1.8) });
  const otherSaved = JSON.stringify(other);
  const vn = V3.new, qn = Q.new;
  V3.new = Q.new = () => { throw new Error('per-frame allocation'); };
  try {
    for (let i = 0; i < 200; i++) {
      assert.equal(sample(r, i / 200, a), a);
      assert.equal(sample(c, i / 200, b), b);
      target.point.x += .001;
      assert.equal(retarget(c, target, r), r);
    }
  } finally { V3.new = vn; Q.new = qn; }
  for (const key of ['p', 'q', 'n', 'up', 'v', 'w', 'point', 'vR']) {
    assert.equal(a[key], refs[key]); assert.equal(r.contact[key], contactRefs[key]);
  }
  assert.equal(JSON.stringify(c), saved); assert.equal(JSON.stringify(other), otherSaved);
  nearV(sample(r, c.contactPhase).point, target.point);
  assert.notDeepEqual(a.p, b.p);
});

test('compile/sample/retarget never modify PH, stroke config, input contact or consume RNG', () => {
  const phBefore = JSON.stringify(PH), configBefore = JSON.stringify(lib.STROKE_CONFIG), dataBefore = JSON.stringify(data);
  const math = lib.context.Math || require('node:vm').runInContext('Math', lib.context);
  const random = math.random;
  math.random = () => { throw new Error('main RNG consumed'); };
  try {
    const target = Object.freeze({ point: Object.freeze(V3.new(.1, 1.2, 1.7)),
      normal: Object.freeze(V3.new(0, -.2, -1)), vR: Object.freeze(V3.new(2, 1, -6)) });
    const before = JSON.stringify(target);
    for (const id of ids) sample(retarget(compile(id), target), .55);
    assert.equal(JSON.stringify(target), before);
  } finally { math.random = random; }
  assert.equal(JSON.stringify(PH), phBefore); assert.equal(JSON.stringify(lib.STROKE_CONFIG), configBefore);
  assert.equal(JSON.stringify(data), dataBefore);
});

test('invalid IDs, contact markers, timing, vectors and ambiguous anchors fail explicitly', () => {
  for (const id of ['UNKNOWN', '', undefined]) assert.throws(() => compile(id), /template/i);
  for (const options of [{ duration: 0 }, { duration: Infinity }, { hand: 'fh' }, { side: 0 }, { grip: 'unknown' }])
    assert.throws(() => compile('DRIVE', options));
  for (const mutate of [s => { s.ballReference[2].contact = false; },
    s => { s.ballReference[0].contact = true; }, s => { s.keys[3].t = s.keys[2].t; },
    s => { s.keys[4].n = [0, 0, 0]; }, s => { s.keys[4].t = .56; }]) {
    const s = JSON.parse(JSON.stringify(data.strokes.DRIVE)); mutate(s);
    assert.throws(() => compile(s));
  }
  const c = compile('DRIVE'), point = V3.new(0, 1, 1.6);
  for (const target of [{}, { point, ballP: point }, { point, p: point }, { point, duration: 0 },
    { point, normal: V3.new() }, { point, vR: V3.new(NaN, 0, 0) },
    { point, localPoint: [0, 0, -.01] }, { point, q: Q.new(), normal: V3.new(0, 0, -1) },
    { point, q: Q.new(), up: V3.new(1, 0, 0) }]) assert.throws(() => retarget(c, target));
  assert.throws(() => sample('DRIVE', .5), /compile/i);
});
