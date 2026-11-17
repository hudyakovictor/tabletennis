'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const { evaluateContactZone } = load(['10_math.js', '12_match_rules.js'], ['evaluateContactZone']);

test('contact corridor samples its final segment even when stride does not divide its length', () => {
  for (const length of [37, 38, 53, 55]) {
    const samples = Array.from({ length }, (_, i) => ({ x: .1 + .8 * i / (length - 1), y: .5, z: 1.5, t: i / 240 }));
    const corridor = { valid: true, anchors: [samples[0]], primary: samples[0], samples, footZ: 1.5 };
    const project = p => ({ ok: true, x: p.x, y: p.y });
    const zone = evaluateContactZone(corridor, null, { x: .9, y: .5 }, 10000, 1000, project, null, { pointerType: 'mouse' });
    assert.equal(zone.accepted, true, `length ${length}`);
    assert.ok(Math.abs(zone.worldTarget.x - .9) < 1e-9, `length ${length}: ${zone.worldTarget.x}`);
  }
});
