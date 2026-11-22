/* The arena is the procedural floor/table scene; panorama room geometry is retired. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const {
  TABLE_GROUND_SHADOW, tableGroundShadowAlpha, PH, Scene, M4, V3, FS_MAIN, FS_COMPOSITE,
} = load(['10_math.js', '20_gl.js', '30_physics.js', '60_scene.js'], [
  'TABLE_GROUND_SHADOW', 'tableGroundShadowAlpha', 'PH', 'Scene', 'M4', 'V3', 'FS_MAIN', 'FS_COMPOSITE',
]);
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

function tableFixture() {
  const canvases = [], textures = [];
  const document = { createElement() {
    const canvas = { calls: [], width: 1, height: 1 };
    const context = new Proxy({
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
      createImageData: () => ({ data: new Uint8ClampedArray(4) }),
      fillRect(...rect) { canvas.calls.push({ kind: 'fill', color: this.fillStyle, rect }); },
      beginPath() { this.path = []; }, moveTo(x, y) { this.path.push([x, y]); }, lineTo(x, y) { this.path.push([x, y]); },
      stroke() { canvas.calls.push({ kind: 'stroke', color: this.strokeStyle, path: this.path.slice() }); },
    }, { get: (object, key) => key in object ? object[key] : () => {} });
    canvas.getContext = () => context; canvases.push(canvas); return canvas;
  } };
  const lib = load(['10_math.js', '20_gl.js', '30_physics.js', '60_scene.js'], ['Scene', 'texTableTop', 'texFrame', 'texNet', 'PALETTES'], { document });
  const renderer = { white: {}, mesh: geometry => geometry, dynMesh: () => ({}),
    texFromCanvas(canvas, options) { const texture = { canvas, options }; textures.push(texture); return texture; } };
  return { ...lib, renderer, textures, canvases };
}

test('the table has one planar marked top at the physical height and an unmarked roofless body', () => {
  const f = tableFixture(), scene = new f.Scene(f.renderer);
  const top = scene.mesh.tableTop, body = scene.mesh.tableBody;
  assert.equal(top.nv, 4); assert.equal(top.ni, 6); assert.equal(body.ni, 30);
  assert.equal(scene.mat.table.tex, scene.tex.table); assert.equal(scene.mat.tableBody.tex, undefined);
  assert.ok(scene.mat.table.rough > .8 && scene.mat.tableBody.rough > .8);
  for (const [mesh, matrix, bottom] of [[top, scene.M.tableTop, PH.T_H], [body, scene.M.tableBody, PH.T_H - PH.T_THICK]]) {
    const min = V3.new(Infinity, Infinity, Infinity), max = V3.new(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < mesh.nv; i++) {
      const p = M4.transformPoint(V3.new(), matrix, V3.new(mesh.pos[i * 3], mesh.pos[i * 3 + 1], mesh.pos[i * 3 + 2]));
      for (const axis of ['x', 'y', 'z']) { min[axis] = Math.min(min[axis], p[axis]); max[axis] = Math.max(max[axis], p[axis]); }
    }
    near(min.x, -PH.T_HALF_WID); near(max.x, PH.T_HALF_WID);
    near(min.z, -PH.T_HALF_LEN); near(max.z, PH.T_HALF_LEN); near(min.y, bottom); near(max.y, PH.T_H);
  }
  assert.ok(Array.from(body.idx).every(i => body.nrm[i * 3 + 1] <= 0), 'no second coplanar upward surface');
  assert.ok(Array.from(top.nrm).every((value, i) => value === (i % 3 === 1 ? 1 : 0)));
});

test('the ported frame is baked per material with finite, indexed geometry', () => {
  const f = tableFixture(), scene = new f.Scene(f.renderer);
  for (const key of ['frame', 'frameDark', 'zinc', 'wheel', 'bolt', 'tape']) {
    const mesh = scene.mesh[key];
    assert.ok(mesh && mesh.nv > 0, `${key} exists`);
    for (const value of mesh.pos) assert.ok(Number.isFinite(value));
    for (const value of mesh.nrm) assert.ok(Number.isFinite(value));
    for (let i = 0; i < mesh.ni; i++) assert.ok(mesh.idx[i] < mesh.nv);
  }
  assert.equal(scene.mesh.markerSide.nv, 4);
  assert.equal(scene.M.markerSides.length, 2);
  for (const mm of scene.M.markerSides) near(Math.abs(mm[12]), 0.75435, 1e-4);
});

test('weathering is POT, retains physical line widths and does not consume gameplay random numbers', () => {
  const f = tableFixture(), top = f.texTableTop(f.PALETTES.arena), frame = f.texFrame();
  assert.deepEqual([top.width, top.height, frame.width, frame.height], [1024, 2048, 256, 256]);
  const marks = top.calls.filter(call => call.color === '#e9e9df');
  assert.equal(marks.length, 5);
  near(marks[0].rect[2] / top.width * PH.T_WID, .020, .0015);
  near(marks[2].rect[3] / top.height * PH.T_LEN, .020, .0015);
  near(marks[4].rect[2] / top.width * PH.T_WID, .003, .0005);
  const isolatedMath = Object.create(Math); isolatedMath.random = () => { throw Error('visual wear consumed gameplay randomness'); };
  const lib = load(['10_math.js', '30_physics.js', '60_scene.js'], ['texTableTop', 'texFrame', 'PALETTES'], {
    Math: isolatedMath, document: { createElement: () => f.canvases[0] },
  });
  lib.texTableTop(lib.PALETTES.arena); lib.texFrame();
});

test('net weave and lower cord are black, tape occupies canvas top and quad v=1 remains the upper edge', () => {
  const f = tableFixture(), canvas = f.texNet(), scene = new f.Scene(f.renderer);
  const tape = canvas.calls.find(call => call.color === '#eeefe9');
  assert.deepEqual(tape.rect, [0, 0, 1024, 256 * .14]);
  assert.ok(canvas.calls.filter(call => call.kind === 'stroke').every(call => call.color === 'rgba(8,10,12,0.94)'));
  assert.deepEqual(canvas.calls.at(-1).path, [[0, 254], [1024, 254]]);
  const mesh = scene.mesh.net;
  for (let i = 0; i < mesh.nv; i++) if (mesh.pos[i * 3 + 1] > 0) near(mesh.uv[i * 2 + 1], 1);
  assert.equal(scene.tex.net.options.flipY, undefined, 'keep the renderer default image flip, unlike the glTF atlas');
});

test('material lighting retains rough-metal reflection and clamps undefined postprocess power inputs', () => {
  assert.match(FS_MAIN, /rough metals/i);
  assert.match(FS_MAIN, /0\.65-0\.20\*rough/);
  assert.match(FS_MAIN, /float NdV = clamp\(dot\(N,V\),0\.0,1\.0\)/);
  assert.match(FS_COMPOSITE, /1\.0 - smoothstep\(0\.25, 0\.95/);
  assert.match(FS_COMPOSITE, /pow\(max\(col,vec3\(0\.0\)\)/);
});

test('table shade has a broad tabletop silhouette, four contact patches and soft edges', () => {
  const s = TABLE_GROUND_SHADOW, shadow = tableGroundShadowAlpha;
  assert.ok(shadow(s.offsetX, s.offsetZ) > 0.65, 'under the tabletop');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (PH.T_HALF_WID - 0.14), z = sz * (PH.T_HALF_LEN - 0.22);
    assert.ok(shadow(x, z) > 0.75, `foot ${sx}, ${sz}`);
  }
  assert.ok(shadow(1.2, 0) < shadow(0.7, 0), 'penumbra falls away from the table');
  assert.ok(shadow(s.width / 2, s.depth / 2) < 0.01, 'transparent at texture edge');
});

test('removed panorama geometry cannot suppress the fallback floor, table or shadow pass', () => {
  const s = Object.create(Scene.prototype);
  const meshNames = ['tableTop', 'tableBody', 'frame', 'frameDark', 'zinc', 'wheel', 'bolt', 'tape',
    'markerSide', 'markerEnd', 'net', 'floor', 'quad', 'wall', 'box'];
  s.mesh = Object.fromEntries(meshNames.map(n => [n, n]));
  s.M = { floor: 'world', tableTop: 'top', tableBody: 'body', net: 'net',
    markerEnd: 'end', markerSides: ['sideA', 'sideB'] };
  s.mat = { table: {}, tableBody: {}, frame: {}, frameDark: {}, zinc: {}, wheel: {}, bolt: {}, tape: {},
    markerSide: {}, markerEnd: {}, net: {}, floor: {}, stands: {}, ceiling: {}, pool: {},
    panorama: {}, courtGround: {} };
  s.floorPool = 'pool'; s.tableShade = 'shade'; s._shadowMat0 = {};
  s.walls = ['wall1']; s.ceiling = 'ceiling';
  const calls = [], R = { draw: (mesh, matrix) => calls.push([mesh, matrix]), drawShadow: (mesh, matrix) => calls.push([mesh, matrix]) };
  s.hasPanorama = true; s.drawStatic(R, false);
  assert.ok(calls.some(([mesh]) => mesh === 'floor'));
  assert.ok(calls.some(([mesh, matrix]) => mesh === 'quad' && matrix === 'shade'));
  assert.ok(calls.some(([mesh]) => mesh === 'tableTop'));
  assert.ok(calls.some(([mesh, matrix]) => mesh === 'markerSide' && matrix === 'sideA'));
  calls.length = 0; s.hasPanorama = false; s.drawStatic(R, false);
  assert.ok(calls.some(([mesh]) => mesh === 'floor'));
  assert.ok(calls.some(([mesh, matrix]) => mesh === 'quad' && matrix === 'shade'));
  calls.length = 0; s.drawStatic(R, true);
  assert.ok(calls.some(([mesh]) => mesh === 'tableTop'));
  assert.ok(!calls.some(([mesh]) => mesh === 'floor' || mesh === 'quad'));
});
