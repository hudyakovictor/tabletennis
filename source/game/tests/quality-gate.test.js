/* Adaptive quality gate (20_gl.js): the blurred-table-lines fix is
 * platform-gated — desktop monitors get the 2× table texture + MSAA,
 * phones keep the current pipeline (no extra VRAM, no extra per-frame
 * cost where there is no problem). Run: npm test (from source/game) */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const lib = load(['20_gl.js'], ['renderQualityGate', 'detectDesktop']);
const gate = lib.renderQualityGate;

test('phones are untouched by the desktop fix (any dpr, any quality)', () => {
  for (const dpr of [1, 2, 3]) for (const q of ['high', 'mid', 'low']) {
    const g = gate({ dpr, desktop: false, quality: q });
    assert.equal(g.tableTex2x, false, `phone ${q} dpr${dpr} keeps 1024 texture`);
    assert.equal(g.msaa, false, `phone ${q} dpr${dpr} keeps antialias:false`);
  }
});

test('desktop high dpr gets both fixes (dpr 1 and retina 2)', () => {
  for (const dpr of [1, 2]) {
    const g = gate({ dpr, desktop: true, quality: 'high' });
    assert.equal(g.tableTex2x, true);
    assert.equal(g.msaa, true);
  }
});

test('mid keeps the one-time texture fix but skips per-frame MSAA', () => {
  const g = gate({ dpr: 1, desktop: true, quality: 'mid' });
  assert.equal(g.tableTex2x, true);
  assert.equal(g.msaa, false);
});

test('low tier is off entirely (it exists to save memory and frame rate)', () => {
  const g = gate({ dpr: 1, desktop: true, quality: 'low' });
  assert.equal(g.tableTex2x, false);
  assert.equal(g.msaa, false);
});

test('dpr above the render cap stays off (the canvas is capped at 2 anyway)', () => {
  const g = gate({ dpr: 3, desktop: true, quality: 'high' });
  assert.equal(g.tableTex2x, false);
  assert.equal(g.msaa, false);
});

test('detectDesktop needs a window with matchMedia — false headless', () => {
  assert.equal(lib.detectDesktop(), false);
});

test('default input is safe (no matchMedia → phone path, no crash)', () => {
  const g = gate();
  assert.equal(typeof g.desktop, 'boolean');
  assert.equal(g.dpr, 1);
  assert.equal(g.quality, 'high');
  assert.equal(g.tableTex2x, false);
  assert.equal(g.msaa, false);
});
