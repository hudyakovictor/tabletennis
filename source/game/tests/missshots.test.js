/* Miss-shot capture: region math (click ±100 px, clamped), marker drawing
 * and the shot lifecycle (request → capture → post 'shot'). The shell side
 * (MissShots store) lives in the browser bundle and is exercised by hand.
 * Run: npm test (from source/game) */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['44_miss_shots.js'], ['MISS_SHOT_HALF', 'missShotRect', 'createMissShotCapture']);

test('region = click ±100 px, centered when possible', () => {
  assert.equal(lib.MISS_SHOT_HALF, 100);
  const r = lib.missShotRect({ x: 400, y: 300 }, 800, 600);   // field-wise: the vm realm has its own Object.prototype
  assert.equal(r.x, 300); assert.equal(r.y, 200); assert.equal(r.w, 201); assert.equal(r.h, 201);
});

test('region clamps to the canvas and always contains the click', () => {
  const tl = lib.missShotRect({ x: 5, y: 5 }, 800, 600);
  assert.equal(tl.x, 0); assert.equal(tl.y, 0); assert.equal(tl.w, 201); assert.equal(tl.h, 201);
  const br = lib.missShotRect({ x: 795, y: 595 }, 800, 600);
  assert.equal(br.x, 695); assert.equal(br.y, 495); assert.equal(br.w, 105); assert.equal(br.h, 105);
  assert.ok(br.x <= 795 && 795 < br.x + br.w, 'click inside region');
});

test('nonsense press yields no region', () => {
  assert.equal(lib.missShotRect(null, 800, 600), null);
  assert.equal(lib.missShotRect({ x: NaN, y: 300 }, 800, 600), null);
  assert.equal(lib.missShotRect({ x: 400, y: 300 }, 0, 600), null);
});

function fakeCtx() {
  const calls = { drawImage: [], arc: [], fill: 0, stroke: 0, save: 0, restore: 0 };
  const ctx = {
    drawImage: (...a) => calls.drawImage.push(a),
    beginPath: () => {}, arc: (...a) => calls.arc.push(a),
    moveTo: () => {}, lineTo: () => {}, stroke: () => calls.stroke++, fill: () => calls.fill++,
    save: () => calls.save++, restore: () => calls.restore++,
    fillStyle: '', strokeStyle: '', lineWidth: 0,
  };
  return { ctx, calls };
}

function fixture() {
  const { ctx, calls } = fakeCtx();
  const c2 = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/jpeg;base64,FAKEIMAGE' };
  const src = { width: 1600, height: 900 };          // device px; vw 800 → k = 2
  const posted = [];
  const cap = lib.createMissShotCapture({
    getCanvas: () => src, createCanvas: () => c2,
    post: (type, rec) => posted.push({ type, rec }),
  });
  return { cap, calls, c2, src, posted };
}

test('capture reads the WebGL region at device px and posts one shot', () => {
  const f = fixture();
  const id = f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600,
    zone: { x: 460, y: 340, radius: 60 }, kind: 'rally', input: 'touch',
    accepted: false, reason: 'OUTSIDE_ZONE', dx: 40, dy: -30 });
  assert.equal(typeof id, 'number');
  assert.ok(f.cap.hasPending());
  const rec = f.cap.capture();
  assert.ok(!f.cap.hasPending(), 'capture clears pending');
  assert.equal(f.c2.width, 201); assert.equal(f.c2.height, 201);
  // source rect in device px: k = 1600/800 = 2 → (600,400,402,402) → 201×201
  const srcArgs = f.calls.drawImage[0].slice(1);   // field-wise: vm-realm array
  assert.equal(srcArgs.length, 8);
  [600, 400, 402, 402, 0, 0, 201, 201].forEach((v, i) => assert.equal(srcArgs[i], v, `drawImage arg ${i}`));
  assert.equal(f.posted.length, 1);
  assert.equal(f.posted[0].type, 'shot');
  const r = f.posted[0].rec;                        // vm-realm object: compare fields
  assert.equal(r.id, id); assert.equal(r.t, rec.t); assert.equal(r.kind, 'rally');
  assert.equal(r.input, 'touch'); assert.equal(r.accepted, false);
  assert.equal(r.reason, 'OUTSIDE_ZONE'); assert.equal(r.dx, 40); assert.equal(r.dy, -30);
  assert.equal(r.w, 201); assert.equal(r.h, 201); assert.equal(r.img, 'FAKEIMAGE');
});

test('markers: red crosshair at the click, green ring at the zone center', () => {
  const f = fixture();
  f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600,
    zone: { x: 460, y: 340, radius: 60 }, kind: 'rally', input: 'touch', accepted: true, reason: null });
  f.cap.capture();
  const arcs = f.calls.arc;
  // click relative to region (300,200): (100,100) — crosshair ring r=10 and dot r=3.5
  assert.ok(arcs.some((a) => a[0] === 100 && a[1] === 100 && a[2] === 10), 'click crosshair');
  assert.ok(arcs.some((a) => a[0] === 100 && a[1] === 100 && a[2] === 3.5), 'click dot');
  // zone relative: (460-300, 340-200) = (160,140), radius 60 (within clamp)
  assert.ok(arcs.some((a) => a[0] === 160 && a[1] === 140 && a[2] === 60), 'zone ring');
  assert.ok(arcs.some((a) => a[0] === 160 && a[1] === 140 && a[2] === 3.5), 'zone dot');
  assert.ok(f.calls.save && f.calls.restore, 'ctx saved/restored around markers');
});

test('no zone (ball not projectable) still captures with the click marker', () => {
  const f = fixture();
  f.cap.request({ press: { x: 100, y: 100 }, vw: 800, vh: 600, zone: null, kind: 'serve', input: 'mouse' });
  const rec = f.cap.capture();
  assert.ok(rec); assert.equal(rec.kind, 'serve'); assert.equal(rec.accepted, false);
});

test('capture is a no-op without a pending request or a live canvas', () => {
  const f = fixture();
  assert.equal(f.cap.capture(), null);
  const f2 = fixture();
  f2.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600 });
  const dead = lib.createMissShotCapture({ getCanvas: () => null, post: () => {} });
  assert.equal(dead.capture(), null);
});

test('disabled capture refuses new requests', () => {
  const f = fixture();
  f.cap.setEnabled(false);
  assert.equal(f.cap.isEnabled(), false);
  assert.equal(f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600 }), null);
  f.cap.setEnabled(true);
  assert.ok(f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600 }));
});
