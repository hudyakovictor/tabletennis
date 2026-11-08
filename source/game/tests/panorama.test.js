/* The background is world geometry, not a camera-centred skybox. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const {
  STREET_COURT, streetCourtEdgeRadius, streetCourtGroundUV,
  makeStreetCourtFloor, makeStreetCourtShell, makeStreetCourtMarking,
  TABLE_GROUND_SHADOW, tableGroundShadowAlpha, PH, Scene, M4, V3, Q, smoothstep,
} = load(['10_math.js', '20_gl.js', '30_physics.js', '60_scene.js'], [
  'STREET_COURT', 'streetCourtEdgeRadius', 'streetCourtGroundUV',
  'makeStreetCourtFloor', 'makeStreetCourtShell', 'makeStreetCourtMarking',
  'TABLE_GROUND_SHADOW', 'tableGroundShadowAlpha', 'PH', 'Scene', 'M4', 'V3', 'Q', 'smoothstep',
]);
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

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

test('paddle contact shadow stays readable at playing heights and shrinks as the bat drops', () => {
  /* Playtest regression: a bat over the table showed no shadow at all,
   * so its height was unreadable. Scene.blob must keep a clearly visible
   * opacity for the paddle gauge parameters at contact height and at
   * full lift, and the low blob must be the smaller, darker one. */
  const s = Object.create(Scene.prototype);
  s.mesh = { quad: 'quad' };
  s._shadowMat = {};
  s._sm = M4.create(); s._sp = V3.new(); s._sq = Q.new(); s._ss = V3.new();
  const draws = [];
  const R = { draw: (mesh, matrix, mat) => draws.push({ mesh, opacity: mat.opacity, sx: s._ss.x }) };
  const TY = 0.76;
  s.blob(R, 0, TY + 0.20, 0, TY, 0.15, 0.55, 1.1, 0.9, 0.9);   // contact height
  s.blob(R, 0, TY + 0.70, 0, TY, 0.15, 0.55, 1.1, 0.9, 0.9);   // full lift
  assert.equal(draws.length, 2, 'both heights draw a shadow');
  assert.ok(draws[0].opacity > 0.35, `contact-height shadow too faint: ${draws[0].opacity}`);
  assert.ok(draws[1].opacity > 0.20, `lifted shadow too faint: ${draws[1].opacity}`);
  assert.ok(draws[1].opacity < draws[0].opacity, 'higher bat, fainter shadow');
  assert.ok(draws[1].sx > draws[0].sx, 'higher bat, wider shadow');

  // The player's puck: an opaque sphere disc exactly under the bat whose
  // opacity survives playing heights (that is the whole point of it).
  s.mesh = { quad: 'quad', sphere: 'SPHERE' };
  s._puckMat = {};
  draws.length = 0;
  const RP = { draw: (mesh, matrix, mat) => draws.push({ mesh, opacity: mat.opacity, m: [...matrix] }) };
  s.shadowPuck(RP, 0.2, TY + 0.65, 0.9, TY, 0.14, 0.88);
  assert.equal(draws.length, 1);
  assert.equal(draws[0].mesh, 'SPHERE');
  assert.ok(draws[0].opacity > 0.55, `puck too faint at lift: ${draws[0].opacity}`);
  near(draws[0].m[12], 0.2); near(draws[0].m[13], TY + 0.006); near(draws[0].m[14], 0.9);

  // No single-frame jump at the table edge: the crossfade weight used by
  // drawContactShadows must move continuously across the 16 cm band.
  let prev = 1 - smoothstep(-0.08, 0.08, -0.20);
  for (let d = -0.19; d <= 0.20; d += 0.01) {
    const w = 1 - smoothstep(-0.08, 0.08, d);
    assert.ok(Math.abs(w - prev) <= 0.10, `shadow weight jumps at outside=${d.toFixed(2)}: ${prev} -> ${w}`);
    prev = w;
  }
});

test('panorama, table and shadow use the same scene; fallback and shadow pass remain safe', () => {
  const s = Object.create(Scene.prototype);
  const meshNames = ['tableTop', 'box', 'leg', 'netPost', 'net', 'floor', 'quad', 'wall', 'courtFloor', 'courtShell', 'courtMarking'];
  s.mesh = Object.fromEntries(meshNames.map(n => [n, n]));
  s.M = { floor: 'world', tableTop: 'top', apronN: 'apronN', apronS: 'apronS', apronW: 'apronW', apronE: 'apronE', net: 'net' };
  s.mat = { table: {}, apron: {}, frame: {}, post: {}, net: {}, floor: {}, stands: {}, ceiling: {}, pool: {},
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
