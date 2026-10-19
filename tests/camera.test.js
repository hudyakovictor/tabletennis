const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '30_physics.js', '57_camera.js'],
  ['cameraRigFor', 'tableFrameShift', 'rigViewProj', 'tableScreenBounds', 'CAMERA_ORDER', 'opponentScreenTop',
    'CAMERA_HEADROOM', 'paddleTargetFromPointer', 'PADDLE_LIMITS', 'PH', 'clamp', 'PADDLE_HOME']);
for (const [w,h] of [[1920,1080],[1280,760],[1024,768],[844,390],[390,844],[360,640],[768,1024]]) {
  test(`table framing and manual dolly: ${w}x${h}`, () => {
    for (const mode of lib.CAMERA_ORDER) for (const controls of [
      { zoom:1 }, { zoom:.72 }, { zoom:1.6 },
      { zoom:NaN, height:NaN }, { zoom:Infinity, height:Infinity }, { zoom:-999, height:-999 },
      { zoom:.72, height:-1 }, { zoom:1.6, height:2.5 },
    ]) {
      const aspect=w/h, rig=lib.cameraRigFor(mode,null,aspect,undefined,controls);
      rig.shiftY=lib.tableFrameShift(rig,aspect);
      const b=lib.tableScreenBounds(lib.rigViewProj(rig,aspect));
      assert.ok([b.top,b.bottom,b.left,b.right].every(Number.isFinite), mode);
      assert.ok(b.top>0 && b.bottom<1 && b.left>=0 && b.right<=1, `${mode}: ${JSON.stringify(b)}`);
      const top=lib.opponentScreenTop(lib.rigViewProj(rig,aspect));
      assert.ok(top>=lib.CAMERA_HEADROOM-1e-6, `${mode}: opponent clipped at ${top}`);
      assert.ok(b.bottom<=.935, `${mode}: no lower reading room`);
    }
  });
}
test('camera dolly moves forward/back without changing the viewing direction', () => {
  const a=16/9;
  const base=JSON.parse(JSON.stringify(lib.cameraRigFor('BROADCAST',null,a,undefined,{zoom:1})));
  const close=JSON.parse(JSON.stringify(lib.cameraRigFor('BROADCAST',null,a,undefined,{zoom:.9})));
  const far=lib.cameraRigFor('BROADCAST',null,a,undefined,{zoom:1.3});
  const dist=r=>Math.hypot(r.eye.x-r.look.x,r.eye.y-r.look.y,r.eye.z-r.look.z);
  assert.ok(dist(close)<dist(base));assert.ok(dist(far)>dist(base));
  for(const r of [close,far])for(const axis of ['x','y','z'])
    assert.ok(Math.abs((r.eye[axis]-r.look[axis])/dist(r)-(base.eye[axis]-base.look[axis])/dist(base))<1e-6);
});

test('default camera has the same playable angle on phone and desktop', () => {
  for(const [aspect,lo,hi] of [[16/9,24.0,26.0],[390/844,20.0,35.0],[844/390,20.0,35.0]]) {
    const r=lib.cameraRigFor('BROADCAST',null,aspect);
    const angle=Math.atan2(r.eye.y-r.look.y,Math.hypot(r.eye.x-r.look.x,r.eye.z-r.look.z))*180/Math.PI;
    assert.ok(angle>=lo && angle<=hi,`unexpected ${angle} degree tilt`);
  }
});

test('height raises the eye without rotating sideways or changing the zoom control', () => {
  for(const aspect of [16/9,390/844])for(const mode of lib.CAMERA_ORDER) {
    const base=JSON.parse(JSON.stringify(lib.cameraRigFor(mode,null,aspect,undefined,{zoom:1,height:0})));
    const raised=lib.cameraRigFor(mode,null,aspect,undefined,{zoom:1,height:1});
    const pitch=r=>Math.atan2(r.eye.y-r.look.y,Math.hypot(r.eye.x-r.look.x,r.eye.z-r.look.z));
    assert.ok(pitch(raised)>pitch(base));assert.equal(raised.eye.x,base.eye.x);
    assert.equal(raised.look.x,base.look.x);assert.equal(raised.look.z,base.look.z);assert.equal(raised.fov,base.fov);
  }
});
test('no playable preset or extreme manual height puts the eye below the table', () => {
  for(const aspect of [.46,1,16/9])for(const mode of lib.CAMERA_ORDER)for(const height of [-999,0,999]) {
    const r=lib.cameraRigFor(mode,null,aspect,undefined,{height,zoom:1});
    const tilt=Math.atan2(r.eye.y-r.look.y,Math.hypot(r.eye.x-r.look.x,r.eye.z-r.look.z))*180/Math.PI;
    assert.ok(tilt>=17.99 && tilt<=42.01);assert.ok(r.eye.y>r.look.y);
  }
});

/* The bat's depth is the "where can I take the ball" question. The mapping
 * used to top out 0.29 m short of the authored stance box, so a deep ball
 * could only be taken in front, over the table. */
test('the stance mapping reaches the whole authored depth box, front unchanged', () => {
  const L = lib.PADDLE_LIMITS, o = {};
  const at = (sy) => { lib.paddleTargetFromPointer(.5, .5, sy, 1, o, {}); return o.tz; };
  assert.ok(Math.abs(at(.55) - lib.PADDLE_HOME.z) < 1e-9, 'the neutral pose stays where it was');
  assert.ok(Math.abs(at(.21) - (lib.PADDLE_HOME.z - 0.34 * 0.96)) < 1e-9, 'forward reach is untouched');
  assert.ok(at(.20) >= L.zNear - 1e-9, 'never closer than the end line by default');
  assert.ok(Math.abs(at(1) - L.zFar) < 1e-9, `a low press must reach zFar, got ${at(1)} of ${L.zFar}`);
  assert.ok(at(.85) > 2.2, 'the deep half of the screen is now usable depth');
  for (let i = 0; i <= 40; i++) {
    const z = at(i / 40);
    assert.ok(z >= L.zStepIn - 1e-9 && z <= L.zFar + 1e-9, `z out of the box: ${z}`);
    if (i > 22) assert.ok(z > at((i - 1) / 40), 'monotone: lower touch, deeper stance');
  }
  // the step-in floor the game asks for is reported and respected
  lib.paddleTargetFromPointer(.5, .5, .2, 1, o, { zNear: L.zStepIn });
  assert.equal(o.zNear, L.zStepIn);
  assert.ok(Math.abs(o.tz - (lib.PADDLE_HOME.z - 0.34 * 0.96)) < 1e-9,
    'the forward band ends where it always did — only the back half grew');
  lib.paddleTargetFromPointer(.5, .5, .2, 1, o, { zNear: 9 });
  assert.equal(o.zNear, L.zFar, 'a nonsensical floor is clamped into the box');
});
