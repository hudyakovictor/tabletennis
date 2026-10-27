/* Automatic calibration capture: geometry, device scaling and markers. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['44_miss_shots.js'], ['MISS_SHOT_HALF', 'MISS_SHOT_SIZES', 'missShotRect', 'createMissShotCapture']);

test('capture uses ±350 CSS px by default, with ±300 and ±400 options', () => {
  assert.equal(lib.MISS_SHOT_HALF, 350);
  assert.deepEqual([...lib.MISS_SHOT_SIZES], [20, 100, 300, 350, 400]);
  const a = lib.missShotRect({ x: 800, y: 600 }, 1600, 1200);
  assert.deepEqual([a.x, a.y, a.w, a.h], [450, 250, 701, 701]);
  const b = lib.missShotRect({ x: 800, y: 600 }, 1600, 1200, 400);
  assert.deepEqual([b.x, b.y, b.w, b.h], [400, 200, 801, 801]);
});

test('requested square is clipped to each edge, not shifted off the press', () => {
  const a = lib.missShotRect({ x: 5, y: 6 }, 800, 600, 20);
  assert.deepEqual([a.x, a.y, a.w, a.h], [0, 0, 26, 27]);
  const b = lib.missShotRect({ x: 795, y: 595 }, 800, 600, 20);
  assert.deepEqual([b.x, b.y, b.w, b.h], [775, 575, 25, 25]);
  const wide = lib.missShotRect({ x: 195, y: 500 }, 390, 844);
  assert.deepEqual([wide.x, wide.y, wide.w, wide.h], [0, 150, 390, 694]);
  assert.equal(lib.missShotRect({ x: -1, y: 50 }, 800, 600), null);
  assert.equal(lib.missShotRect({ x: NaN, y: 50 }, 800, 600), null);
  assert.equal(lib.missShotRect({ x: 5, y: 5 }, 0, 600), null);
});

function fixture() {
  const calls = { draw: [], arcs: [], ellipses: [], scales: [] }, posted = [];
  const ctx = { drawImage: (...v) => calls.draw.push(v), beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, stroke() {}, fill() {}, save() {}, restore() {},
    scale: (...v) => calls.scales.push(v), arc: (...v) => calls.arcs.push(v), ellipse: (...v) => calls.ellipses.push(v) };
  const out = { width: 0, height: 0, getContext: () => ctx,
    toDataURL: () => 'data:image/jpeg;base64,FAKEIMAGE1234' };
  const gl = { width: 1600, height: 900 }, fx = { width: 800, height: 1200 };
  const cap = lib.createMissShotCapture({ getCanvas: () => gl, getOverlay: () => fx,
    createCanvas: () => out, post: (type, rec) => posted.push({ type, rec }) });
  return { cap, calls, posted, out, gl, fx };
}

test('capture preserves actual GL pixel resolution and scales the overlay independently', () => {
  const f = fixture(); f.cap.setHalf(20);
  const id = f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600,
    zone: { x: 405, y: 310, shape: 'oval', axisX: 0, axisY: 1, fwdPx: 60, backPx: 20, sidePx: 30 },
    kind: 'rally', input: 'touch', accepted: true, gameTime: 1.25, gestureId: 4, shotId: 7 });
  assert.equal(typeof id, 'string'); assert.ok(f.cap.hasPending());
  const rec = f.cap.capture(); assert.equal(f.cap.hasPending(), false);
  // The CSS crop is 41×41, but the GL backing is 2× horizontally and 1.5×
  // vertically. It must not be reduced to 41×41 before encoding.
  assert.deepEqual([f.out.width, f.out.height], [82, 62]);
  assert.deepEqual(f.calls.draw[0].slice(1), [760, 420, 82, 61.5, 0, 0, 82, 62]);
  assert.deepEqual(f.calls.draw[1].slice(1), [380, 560, 41, 82, 0, 0, 82, 62]);
  assert.deepEqual(f.calls.scales[0], [2, 62 / 41]);
  assert.equal(f.calls.ellipses.length, 2, 'asymmetric forward and back gate');
  assert.ok(f.calls.arcs.some(v => v[0] === 20 && v[1] === 20 && v[2] === 7), 'red pointer mark');
  assert.equal(f.posted.length, 1); assert.equal(f.posted[0].type, 'shot');
  assert.equal(rec.id, id); assert.equal(rec.gestureId, 4); assert.equal(rec.shotId, 7);
  assert.equal(rec.imageWidth, 82); assert.equal(rec.imageHeight, 62);
  assert.equal(rec.img, 'FAKEIMAGE1234'); assert.equal(rec.status, 'pending');
});

test('default wide capture retains the full render pixels; old narrow mode still works', () => {
  const f = fixture();
  f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600, zone: null });
  const rec = f.cap.capture();
  assert.ok(rec); assert.equal(rec.half, 350);
  assert.deepEqual([rec.w, rec.h, f.out.width, f.out.height], [701, 600, 1402, 900]);
  assert.ok(f.calls.arcs.some(v => v[0] === 350 && v[1] === 300));
  f.cap.setHalf(100);
  f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600 });
  const old = f.cap.capture();
  assert.equal(old.half, 100); assert.deepEqual([old.w, old.h, old.imageWidth, old.imageHeight], [201, 201, 402, 302]);
});

test('disabled capture clears pending; failed capture reports an error', () => {
  const f = fixture(); f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600 });
  f.cap.setEnabled(false); assert.equal(f.cap.hasPending(), false);
  assert.equal(f.cap.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600 }), null);
  const errors = [];
  const dead = lib.createMissShotCapture({ getCanvas: () => null, post: (type, rec) => errors.push({ type, rec }) });
  dead.request({ press: { x: 400, y: 300 }, vw: 800, vh: 600 });
  assert.equal(dead.capture(), null); assert.equal(errors[0].type, 'shoterror');
  assert.match(errors[0].rec.message, /canvas unavailable/i);
});

test('ids do not restart at one after an iframe recreation', () => {
  const a = fixture(), b = fixture();
  const press = { press: { x: 400, y: 300 }, vw: 800, vh: 600 };
  assert.notEqual(a.cap.request(press), b.cap.request(press));
});
