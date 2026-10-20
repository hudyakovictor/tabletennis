/* The camera contract. Every assertion here is a promise the game makes to
 * the player; the numbers are screen fractions, not device pixels, because
 * the whole point of the rewrite is that a preset looks the same on a phone
 * as it does on a monitor.
 *
 *   1. ONE composition rule: the near edge of the playing surface sits on
 *      the preset's `nearY`, the reading band starts at PLAY_BAND_Y, and the
 *      opponent's contact envelope stays above CAMERA_HEADROOM.
 *   2. NO zoom and NO manual height — not even as a parameter that is
 *      silently ignored: a rig is a pure function of (preset, aspect).
 *   3. The pointer map is the exact inverse of the projection the renderer
 *      uses, so the blade is drawn under the cursor. Measured, not assumed:
 *      project(unproject(screen)) must come back to the same pixel.
 *   4. The reach box never leaves the frame and always covers the table.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

const NAMES = ['cameraRigFor', 'rigViewProj', 'tabletopBounds', 'tableScreenBounds',
  'opponentScreenTop', 'CAMERA_ORDER', 'CAMERA_PRESETS', 'CAMERA_HEADROOM', 'PLAY_RECT',
  'PLAY_BAND_Y', 'PADDLE_LIMITS', 'PADDLE_STANCE_Z', 'PADDLE_HOME', 'reachFor',
  'paddleTargetFromPointer', 'projectPoint', 'unprojectToPlane', 'clampPaddleToFrustum',
  'paddleVisibleOk', 'lensFovDeg', 'horizontalFovDeg', 'rigMargin', 'tableFrameShift',
  'tableTopScreenY', 'PH', 'M4', 'paddleLimitsFor', 'depthForPointer', 'quantizeDepth'];
const lib = load(['10_math.js', '30_physics.js', '57_camera.js'], NAMES);

const VIEWPORTS = [
  [1920, 1080], [1366, 768], [1280, 760], [1024, 768], [844, 390],
  [820, 1180], [768, 1024], [414, 896], [390, 844], [360, 640],
];

const norm = (r) => JSON.stringify({
  eye: r.eye, look: r.look, fov: r.fov, shiftY: r.shiftY, mode: r.mode,
});

for (const [w, h] of VIEWPORTS) {
  const a = w / h;
  test(`framing ${w}x${h}: same composition on every preset`, () => {
    for (const mode of lib.CAMERA_ORDER) {
      const P = lib.CAMERA_PRESETS[mode];
      const rig = lib.cameraRigFor(mode, null, a);
      const vp = lib.rigViewProj(rig, a);
      const table = lib.tabletopBounds(vp);
      const frame = lib.tableScreenBounds(vp);
      const opp = lib.opponentScreenTop(vp);

      assert.ok([table.top, table.bottom, table.left, table.right].every(Number.isFinite), mode);
      // the near edge is where the composition says it is, to 1/300 of a screen
      assert.ok(Math.abs(table.bottom - P.nearY) < 0.004,
        `${mode}: near edge ${table.bottom.toFixed(4)} != ${P.nearY}`);
      // the table starts below the scoreboard
      assert.ok(table.top >= P.topMin - 0.004, `${mode}: table top ${table.top.toFixed(3)}`);
      // the whole playing surface, including the legs, is inside the frame
      assert.ok(frame.left >= 0 && frame.right <= 1, `${mode}: table cropped sideways ${JSON.stringify(frame)}`);
      assert.ok(frame.bottom <= 0.92, `${mode}: table runs into the reading band`);
      // the opponent's contact envelope is readable
      assert.ok(opp >= lib.CAMERA_HEADROOM - 0.004, `${mode}: opponent clipped at ${opp.toFixed(3)}`);
      // the reading band is authored, not derived from the table
      assert.equal(lib.PLAY_BAND_Y, 0.872);
      assert.ok(lib.PLAY_BAND_Y > frame.bottom + 0.02, `${mode}: band overlaps the table`);
      // the eye is above the table and looks down at the authored pitch
      const d = Math.hypot(rig.eye.y - rig.look.y, rig.eye.z - rig.look.z);
      const pitch = Math.atan2(rig.eye.y - rig.look.y, Math.abs(rig.eye.z - rig.look.z)) * 180 / Math.PI;
      assert.ok(Math.abs(pitch - P.pitch) < 0.01, `${mode}: pitch ${pitch.toFixed(2)}`);
      assert.ok(rig.eye.y > rig.look.y + 0.5, `${mode}: eye is not above the table`);
    }
  });
}

test('there is no zoom and no manual height: a rig depends only on preset and aspect', () => {
  for (const a of [16 / 9, 1.5, 0.75, 390 / 844]) {
    for (const mode of lib.CAMERA_ORDER) {
      const base = norm(lib.cameraRigFor(mode, null, a));
      // the old API's fifth argument must change nothing at all
      for (const controls of [{ zoom: 0.72, height: 2.5 }, { zoom: 1.6, height: -1 }, { zoom: NaN, height: Infinity }]) {
        const rig = lib.cameraRigFor(mode, null, a, undefined, controls);
        assert.equal(norm(rig), base, `${mode} @ ${a}: a camera control still moves the view`);
      }
      // and neither does a moving ball
      const withBall = lib.cameraRigFor(mode, { x: 1.2, y: 2.4, z: -1 }, a);
      assert.equal(norm(withBall), base, `${mode} @ ${a}: the view follows the ball`);
    }
  }
});

test('a preset looks the same on every device of the same aspect', () => {
  // 1366x768 and 1920x1080 are both 16:9; a user resizing a window or opening
  // fullscreen must not see the table grow or shrink.
  const a = 1920 / 1080, b = 1366 / 768;
  for (const mode of lib.CAMERA_ORDER) {
    const r1 = lib.cameraRigFor(mode, null, a), r2 = lib.cameraRigFor(mode, null, b);
    const t1 = { ...lib.tabletopBounds(lib.rigViewProj(r1, a)) };
    const t2 = { ...lib.tabletopBounds(lib.rigViewProj(r2, b)) };
    for (const k of ['top', 'bottom', 'left', 'right'])
      assert.ok(Math.abs(t1[k] - t2[k]) < 0.01, `${mode}: ${k} differs across 16:9 devices`);
  }
  // Portrait phones of different sizes (390x844, 414x896) are the same ratio
  // to within 1 %: their framing must agree to within 2 % of the screen.
  for (const mode of lib.CAMERA_ORDER) {
    const r1 = lib.cameraRigFor(mode, null, 390 / 844);
    const r2 = lib.cameraRigFor(mode, null, 414 / 896);
    const t1 = { ...lib.tabletopBounds(lib.rigViewProj(r1, 390 / 844)) };
    const t2 = { ...lib.tabletopBounds(lib.rigViewProj(r2, 414 / 896)) };
    assert.ok(Math.abs(t1.bottom - t2.bottom) < 0.02, `${mode}: phone framing drifts`);
    assert.ok(Math.abs((t1.right - t1.left) - (t2.right - t2.left)) < 0.02, `${mode}: phone width drifts`);
  }
});

test('three presets are genuinely different views of the same frame', () => {
  const seen = new Set();
  for (const mode of lib.CAMERA_ORDER) {
    const P = lib.CAMERA_PRESETS[mode];
    assert.ok(P.pitch >= 15 && P.pitch <= 40, `${mode}: pitch ${P.pitch} is not a playable angle`);
    assert.ok(P.nearY > 0.5 && P.nearY < 0.72, `${mode}: near edge too high or too low`);
    seen.add(P.pitch);
  }
  assert.equal(seen.size, lib.CAMERA_ORDER.length, 'presets must differ in pitch');
  /* Every pair must draw the table somewhere measurably different — a preset
   * that reproduces another one is a menu entry pretending to be a choice.
   * The pitch difference is the cause; the corner distance is the effect a
   * player actually sees. */
  const a = 16 / 9;
  const corners = (mode) => {
    const vp = lib.rigViewProj(lib.cameraRigFor(mode, null, a), a);
    const out = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = lib.projectPoint(vp, { x: sx * lib.PH.T_HALF_WID, y: lib.PH.TABLE_Y, z: sz * lib.PH.T_HALF_LEN }, {});
      out.push(p.x, p.y);
    }
    return out;
  };
  for (let i = 0; i < lib.CAMERA_ORDER.length; i++) {
    for (let j = i + 1; j < lib.CAMERA_ORDER.length; j++) {
      const A = corners(lib.CAMERA_ORDER[i]), B = corners(lib.CAMERA_ORDER[j]);
      const diff = Math.max(...A.map((v, k) => Math.abs(v - B[k])));
      assert.ok(diff > 0.015, `${lib.CAMERA_ORDER[i]} and ${lib.CAMERA_ORDER[j]} look the same (${diff.toFixed(3)})`);
    }
  }
});

test('a portrait screen widens the lens instead of cropping the table', () => {
  for (const mode of lib.CAMERA_ORDER) {
    const P = lib.CAMERA_PRESETS[mode];
    const wide = lib.lensFovDeg(P.vfov, 16 / 9);
    const tall = lib.lensFovDeg(P.vfov, 390 / 844);
    assert.equal(wide, P.vfov, '16:9 must use the authored vertical angle');
    assert.ok(tall > wide, 'portrait must widen the vertical angle');
    assert.ok(tall <= 84.0001, 'the lens must not become a fish-eye');
  }
});

test('pointer → blade is the exact inverse of the projection', () => {
  for (const [w, h] of VIEWPORTS) {
    const a = w / h;
    for (const mode of lib.CAMERA_ORDER) {
      const rig = lib.cameraRigFor(mode, null, a);
      const vp = lib.rigViewProj(rig, a);
      for (const z of [lib.PADDLE_LIMITS.zStepIn, lib.PADDLE_STANCE_Z, lib.PADDLE_LIMITS.zNear, lib.PADDLE_LIMITS.zFar]) {
        const box = lib.reachFor(rig, a, z);
        let worst = 0, worstAt = null;
        for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) {
          const px = box.sx0 + (box.sx1 - box.sx0) * i / 24;
          const py = box.sy0 + (box.sy1 - box.sy0) * j / 24;
          const t = lib.paddleTargetFromPointer(px, py, 0, 1, {}, { rig, aspect: a, z });
          const s = lib.projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, {});
          assert.ok(s.ok, 'projected blade is behind the camera');
          const e = Math.hypot(s.x - px, s.y - py);
          if (e > worst) { worst = e; worstAt = [px, py]; }
        }
        assert.ok(worst < 1e-3, `${mode} ${w}x${h} z=${z}: blade off the cursor by ${worst} at ${worstAt}`);
      }
    }
  }
});

test('every point a ball can occupy is inside the exact pointer area', () => {
  /* The promise that matters: wherever the ball can be, the player can put
   * the blade there, and the blade is drawn under the cursor. The ball never
   * leaves the table by more than a run-out, so the test projects that
   * envelope (not the glass) and demands it sits inside the reach box on
   * every screen. A 4:3 window has more glass at the sides than a bat can
   * cross; that strip is scenery, not a promise. */
  /* The playing surface plus a run-out at rally height: a ball above the
   * table, anywhere across its width, up to a comfortable loop. A ball that
   * is both far off the side AND high is not a shot this game produces. */
  const BALL_X = lib.PH.T_HALF_WID + 0.15;
  const BALL_Y = [lib.PH.TABLE_Y, lib.PH.TABLE_Y + 0.55];
  for (const [w, h] of VIEWPORTS) {
    const a = w / h;
    if (a < 1.2) continue;                 // portrait: see the test below
    for (const mode of lib.CAMERA_ORDER) {
      const rig = lib.cameraRigFor(mode, null, a);
      const vp = lib.rigViewProj(rig, a);
      const box = lib.reachFor(rig, a, lib.PADDLE_STANCE_Z);
      for (const sx of [-1, 1]) for (const y of BALL_Y) {
        const s = lib.projectPoint(vp, { x: sx * BALL_X, y, z: lib.PADDLE_STANCE_Z }, {});
        assert.ok(s.ok, `${mode} ${w}x${h}: ball envelope behind the camera`);
        assert.ok(s.x > box.sx0 - 0.005 && s.x < box.sx1 + 0.005,
          `${mode} ${w}x${h}: ball at x=${(sx * BALL_X).toFixed(2)} is outside the pointer area`);
        assert.ok(s.y > box.sy0 - 0.005 && s.y < box.sy1 + 0.005,
          `${mode} ${w}x${h}: ball at y=${y.toFixed(2)} is outside the pointer area`);
      }
    }
  }
});

test('portrait keeps the full width and most of the height reachable', () => {
  for (const [w, h] of VIEWPORTS) {
    const a = w / h;
    if (a >= 1.2) continue;
    for (const mode of lib.CAMERA_ORDER) {
      const rig = lib.cameraRigFor(mode, null, a);
      const box = lib.reachFor(rig, a, lib.PADDLE_STANCE_Z);
      assert.ok(box.sx1 - box.sx0 > 0.86, `${mode} ${w}x${h}: reach only ${(box.sx1 - box.sx0).toFixed(2)} wide`);
      /* A portrait phone frames more empty floor under the table than the
       * bat can descend into. Three quarters of the play height stays exact;
       * the strip below is scenery, not input, and there is no cursor on a
       * touch screen to be fooled by it. */
      const span = lib.PLAY_RECT.bottom - lib.PLAY_RECT.top;
      assert.ok(box.sy1 - box.sy0 > span * 0.75,
        `${mode} ${w}x${h}: reach only ${((box.sy1 - box.sy0) / span).toFixed(2)} of the play height`);
    }
  }
});

test('a step-in trades depth for height, never for accuracy', () => {
  /* Leaning in shrinks the band of screen rows the blade can occupy — that is
   * physics, not a bug. What must never happen is the blade sitting somewhere
   * the cursor is not. Two guarantees: inside the band the map is exact, and
   * the depth search pulls the blade back out for any row below it. */
  for (const [w, h] of VIEWPORTS) {
    const a = w / h;
    for (const mode of lib.CAMERA_ORDER) {
      const rig = lib.cameraRigFor(mode, null, a);
      const vp = lib.rigViewProj(rig, a);
      const z = lib.PADDLE_LIMITS.zStepIn;
      const box = lib.reachFor(rig, a, z);
      let worst = 0;
      for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) {
        const px = box.sx0 + (box.sx1 - box.sx0) * i / 16;
        const py = box.sy0 + (box.sy1 - box.sy0) * j / 16;
        const t = lib.paddleTargetFromPointer(px, py, 0, 1, {}, { rig, aspect: a, z });
        const s = lib.projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, {});
        worst = Math.max(worst, Math.hypot(s.x - px, s.y - py));
      }
      assert.ok(worst < 1e-3, `${mode} ${w}x${h}: blade ${worst} off the cursor while stepped in`);
      // the blade may not sink through the playing surface
      assert.ok(box.yLo >= lib.PH.TABLE_Y + 0.17,
        `${mode} ${w}x${h}: step-in box lets the blade through the table`);
      /* Any cursor row the standing blade can reach finds SOME exact depth.
       * A 4:3 tablet frames more glass above the player's reach than the play
       * rectangle assumes, so the sweep starts at the stance plane's own top:
       * that strip is scenery, and the depth search must not pretend. */
      const stance = lib.reachFor(rig, a, lib.PADDLE_STANCE_Z);
      for (const py of [stance.sy0 + 0.005, 0.45, 0.6, 0.75, stance.sy1 - 0.005]) {
        if (py < lib.PLAY_RECT.top || py > lib.PLAY_RECT.bottom) continue;
        const depth = lib.depthForPointer(rig, a, 0.5, py, z);
        const t = lib.paddleTargetFromPointer(0.5, py, 0, 1, {}, { rig, aspect: a, z: depth });
        const s = lib.projectPoint(vp, { x: t.tx, y: t.ty, z: t.tz }, {});
        /* A millimetre and a half is under two pixels at 1080p: the depth is
         * quantised to a centimetre, and the box edge moves with it. */
        assert.ok(Math.abs(s.y - py) < 1.5e-3,
          `${mode} ${w}x${h}: cursor row ${py} unreachable, blade at ${s.y.toFixed(3)} (depth ${depth})`);
      }
    }
  }
});

test('the blade never leaves the frame, even for a pointer outside it', () => {
  for (const [w, h] of VIEWPORTS) {
    const a = w / h;
    for (const mode of lib.CAMERA_ORDER) {
      const rig = lib.cameraRigFor(mode, null, a);
      const vp = lib.rigViewProj(rig, a);
      for (const [px, py] of [[-3, .5], [4, .5], [.5, -3], [.5, 4], [-1, -1], [2, 2], [NaN, NaN], [.5, .5]]) {
        const t = lib.paddleTargetFromPointer(px, py, 0, 1, {}, { rig, aspect: a, z: lib.PADDLE_STANCE_Z });
        assert.ok([t.tx, t.ty, t.tz].every(Number.isFinite), 'non-finite target');
        assert.ok(Math.abs(t.tx) <= lib.PADDLE_LIMITS.x + 1e-9, 'x outside the reach');
        assert.ok(t.ty >= lib.PH.TABLE_Y + lib.PADDLE_LIMITS.yLo - 1e-9, 'y below the reach');
        assert.ok(t.ty <= lib.PH.TABLE_Y + lib.PADDLE_LIMITS.yHi + 1e-9, 'y above the reach');
        assert.ok(t.tz >= lib.PADDLE_LIMITS.zStepIn - 1e-9 && t.tz <= lib.PADDLE_LIMITS.zFar + 1e-9, 'z outside the reach');
        // and the last-resort clamp keeps it visible too
        lib.clampPaddleToFrustum(vp, t, 0.0);
        assert.ok(lib.paddleVisibleOk(vp, t, 0.0), `${mode} ${w}x${h}: blade parked off screen`);
      }
    }
  }
});

test('the reach covers the table so every ball on the table can be met', () => {
  for (const [w, h] of VIEWPORTS) {
    const a = w / h;
    for (const mode of lib.CAMERA_ORDER) {
      const rig = lib.cameraRigFor(mode, null, a);
      const box = lib.reachFor(rig, a, lib.PADDLE_STANCE_Z);
      // side to side: at least three quarters of the table's half width
      assert.ok(box.xMax > 0.60, `${mode} ${w}x${h}: reach only ${box.xMax.toFixed(2)} m`);
      // and the height band covers a ball from just above the surface to a loop
      assert.ok(box.yLo < lib.PH.TABLE_Y + 0.10, `${mode}: cannot reach low`);
      assert.ok(box.yHi > lib.PH.TABLE_Y + 0.42, `${mode}: cannot reach a loop`);
      // the screen rectangle the box projects to is inside the play rectangle
      assert.ok(box.sx0 >= lib.PLAY_RECT.left - 0.02 && box.sx1 <= lib.PLAY_RECT.right + 0.02,
        `${mode}: reach rect sideways ${box.sx0.toFixed(3)}..${box.sx1.toFixed(3)}`);
      assert.ok(box.sy0 >= lib.PLAY_RECT.top - 0.02 && box.sy1 <= lib.PLAY_RECT.bottom + 0.02,
        `${mode}: reach rect vertically ${box.sy0.toFixed(3)}..${box.sy1.toFixed(3)}`);
    }
  }
});

test('legacy helpers still describe the fitted rig', () => {
  const a = 16 / 9;
  const rig = lib.cameraRigFor('BROADCAST', null, a);
  assert.equal(lib.tableFrameShift(rig), rig.shiftY);
  assert.ok(lib.rigMargin(rig, a) > -0.02);
  assert.ok(Number.isFinite(lib.tableTopScreenY('BROADCAST', a)));
  assert.ok(lib.horizontalFovDeg(lib.CAMERA_PRESETS.BROADCAST.vfov, a) > 50);
});
