/* The background is world geometry, not a camera-centred skybox. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const {
  STREET_COURT, streetCourtEdgeRadius, streetCourtGroundUV,
  makeStreetCourtFloor, makeStreetCourtShell, makeStreetCourtMarking,
  TABLE_GROUND_SHADOW, tableGroundShadowAlpha, PH, Scene, M4, V3, FS_MAIN, FS_COMPOSITE,
} = load(['10_math.js', '20_gl.js', '30_physics.js', '60_scene.js'], [
  'STREET_COURT', 'streetCourtEdgeRadius', 'streetCourtGroundUV',
  'makeStreetCourtFloor', 'makeStreetCourtShell', 'makeStreetCourtMarking',
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

test('aprons abut below the slab without crossing its bounds or overlapping at the corners', () => {
  const f = tableFixture(), scene = new f.Scene(f.renderer), rails = [];
  for (const key of ['apronN', 'apronS', 'apronW', 'apronE']) {
    const matrix = scene.M[key], min = {}, max = {};
    for (let axis = 0; axis < 3; axis++) {
      const half = Math.abs(matrix[axis * 4 + axis]) / 2;
      min[axis] = matrix[12 + axis] - half; max[axis] = matrix[12 + axis] + half;
    }
    near(max[1], PH.T_H - PH.T_THICK);
    assert.ok(min[0] >= -PH.T_HALF_WID - 1e-6 && max[0] <= PH.T_HALF_WID + 1e-6);
    assert.ok(min[2] >= -PH.T_HALF_LEN - 1e-6 && max[2] <= PH.T_HALF_LEN + 1e-6);
    rails.push({ min, max });
  }
  for (let i = 0; i < rails.length; i++) for (let j = i + 1; j < rails.length; j++) {
    const a = rails[i], b = rails[j];
    assert.ok([0, 1, 2].some(axis => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) < 1e-6));
  }
  near(rails[0].max[2], rails[2].min[2]); near(rails[1].min[2], rails[2].max[2]);
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

test('court and table are centred on the photographed circle rather than the old panorama eye', () => {
  const centre = streetCourtGroundUV(0, 0);
  near(centre.u, 0.5);
  // The source centre of the circle is above the panorama's nadir. Mapping
  // the table to v=0 (the old capture eye) would place it at the court edge.
  const centreY = (1 - centre.v) * 1024;
  assert.ok(centreY > 570 && centreY < 595, `centre y=${centreY}`);
  const farY = (1 - streetCourtGroundUV(0, -4.7).v) * 1024;
  const nearY = (1 - streetCourtGroundUV(0, 4.7).v) * 1024;
  assert.ok(farY > 545 && farY < 555, `far circle edge y=${farY}`);
  assert.ok(nearY > 805 && nearY < 830, `near circle edge y=${nearY}`);

  const ring = makeStreetCourtMarking();
  for (let i = 0; i < ring.nv; i++) {
    const x = ring.pos[3 * i], y = ring.pos[3 * i + 1], z = ring.pos[3 * i + 2];
    assert.ok(Math.abs(Math.hypot(x, z) - 4.7) < 0.05);
    assert.ok(y > 0 && y < 0.04, 'paint belongs to the ground');
  }
  assert.ok(Math.hypot(PH.T_HALF_WID, PH.T_HALF_LEN) < 4.7, 'the whole table is inside the circle');
});

test('floor and walls meet without cracks, UV jumps or camera-relative coordinates', () => {
  const floor = makeStreetCourtFloor(), shell = makeStreetCourtShell();
  const stride = STREET_COURT.columns + 1;
  const floorEdge = STREET_COURT.floorRows * stride;
  for (let i = 0; i < stride; i++) {
    for (let k = 0; k < 3; k++) near(floor.pos[3 * (floorEdge + i) + k], shell.pos[3 * i + k]);
    for (let k = 0; k < 2; k++) near(floor.uv[2 * (floorEdge + i) + k], shell.uv[2 * i + k]);
    assert.ok(Number.isFinite(streetCourtEdgeRadius(i / STREET_COURT.columns)));
  }
  for (const mesh of [floor, shell]) {
    for (const value of mesh.pos) assert.ok(Number.isFinite(value));
    for (const value of mesh.uv) assert.ok(Number.isFinite(value));
    for (let i = 0; i < mesh.ni; i++) assert.ok(mesh.idx[i] < mesh.nv, 'mesh index is in bounds');
    for (let row = 0; row < mesh.nv / stride; row++) {
      const first = row * stride, last = first + STREET_COURT.columns;
      for (let k = 0; k < 3; k++) near(mesh.pos[first * 3 + k], mesh.pos[last * 3 + k], 1e-4);
      near(mesh.uv[first * 2], 0); near(mesh.uv[last * 2], 1);
      near(mesh.uv[first * 2 + 1], mesh.uv[last * 2 + 1]);
    }
  }
  // Ground vertices sample the panorama from the original capture point,
  // independent of any subsequent 3D camera position.
  for (const row of [2, 8, 16, 31]) for (const col of [20, 48, 96, 144, 172]) {
    const i = row * stride + col;
    const uv = streetCourtGroundUV(floor.pos[i * 3], floor.pos[i * 3 + 2]);
    near(uv.u, floor.uv[i * 2], 1e-4); near(uv.v, floor.uv[i * 2 + 1], 1e-4);
  }
});

test('a full lobby orbit stays inside the reconstructed court', () => {
  for (let i = 0; i < 360; i++) {
    const a = i * Math.PI / 180, x = 4.7 * Math.sin(a), z = 4.7 * Math.cos(a);
    const u = streetCourtGroundUV(x, z).u;
    const distance = Math.hypot(x, z - STREET_COURT.eyeZ);
    assert.ok(distance < streetCourtEdgeRadius(u), `camera crosses wall at ${i}°`);
  }
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

test('panorama, table and shadow use the same scene; fallback and shadow pass remain safe', () => {
  const s = Object.create(Scene.prototype);
  const meshNames = ['tableTop', 'tableBody', 'box', 'leg', 'netPost', 'net', 'floor', 'quad', 'wall', 'courtFloor', 'courtShell', 'courtMarking'];
  s.mesh = Object.fromEntries(meshNames.map(n => [n, n]));
  s.M = { floor: 'world', tableTop: 'top', tableBody: 'body', apronN: 'apronN', apronS: 'apronS', apronW: 'apronW', apronE: 'apronE', net: 'net' };
  s.mat = { table: {}, tableBody: {}, apron: {}, frame: {}, post: {}, net: {}, floor: {}, stands: {}, ceiling: {}, pool: {},
    panorama: {}, courtGround: { asphalt: {} }, courtMarking: {} };
  s.floorPool = 'pool'; s.tableShade = 'shade'; s._shadowMat0 = {};
  s.walls = ['wall1']; s.ceiling = 'ceiling'; s.legs = ['leg1']; s.legBars = []; s.netPosts = [];
  const calls = [], R = { draw: (mesh, matrix) => calls.push([mesh, matrix]), drawShadow: (mesh, matrix) => calls.push([mesh, matrix]) };
  s.hasPanorama = true; s.drawStatic(R, false);
  assert.deepEqual(calls.slice(0, 4), [['courtShell', 'world'], ['courtFloor', 'world'], ['courtMarking', 'world'], ['quad', 'shade']]);
  assert.ok(calls.some(([mesh]) => mesh === 'tableTop'));
  calls.length = 0; s.hasPanorama = false; s.drawStatic(R, false);
  assert.ok(calls.some(([mesh]) => mesh === 'floor'));
  assert.ok(calls.some(([mesh, matrix]) => mesh === 'quad' && matrix === 'shade'));
  assert.ok(!calls.some(([mesh]) => mesh === 'courtFloor'));
  calls.length = 0; s.drawStatic(R, true);
  assert.ok(calls.some(([mesh]) => mesh === 'tableTop'));
  assert.ok(!calls.some(([mesh]) => mesh === 'floor' || mesh === 'courtFloor' || mesh === 'quad'));
});
