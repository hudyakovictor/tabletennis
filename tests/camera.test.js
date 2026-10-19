const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '30_physics.js', '57_camera.js'],
  ['cameraRigFor', 'tableFrameShift', 'rigViewProj', 'tableScreenBounds', 'CAMERA_ORDER', 'opponentScreenTop', 'CAMERA_HEADROOM',
    'cameraHeadroom', 'frameBottomRoom', 'frameMargin', 'phoneFactor', 'paddleTargetFromPointer', 'pointerPlanePoint', 'PADDLE_LIMITS']);
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
      // The headroom is a property of the screen shape: phones trade dead
      // air above the raised opponent bat for table size, desktop keeps the
      // authored 10 %.
      assert.ok(top>=lib.cameraHeadroom(aspect)-1e-6, `${mode}: opponent clipped at ${top}`);
      assert.ok(b.bottom<=lib.frameBottomRoom(aspect)+1e-9, `${mode}: no lower reading room`);
    }
  });
}

test('phone framing reads bigger than the desktop contract allows', () => {
  // The portrait contract: tighter margins and bands, same 25° tilt.
  assert.ok(lib.frameMargin(390/844) < lib.frameMargin(16/9));
  assert.ok(lib.cameraHeadroom(390/844) < lib.CAMERA_HEADROOM);
  assert.ok(lib.frameBottomRoom(390/844) > 0.901);
  assert.ok(lib.phoneFactor(390/844) > 0.9 && lib.phoneFactor(16/9) < 0.01);
});

test('perspective pointer map lands the blade under the finger at the ball', () => {
  // The phone bug measured against the old linear map: a finger ON the ball
  // produced a blade 0.2-0.4 m away — outside the capture box before any
  // timing error. The perspective map must be exact at the blade depth.
  const aspect = 390 / 844;
  const rig = lib.cameraRigFor('BROADCAST', null, aspect);
  rig.shiftY = lib.tableFrameShift(rig, aspect);
  const vp = lib.rigViewProj(rig, aspect);
  const project = (p) => {
    const cw = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
    return {
      x: ((vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / cw) * 0.5 + 0.5,
      y: 0.5 - ((vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / cw) * 0.5,
    };
  };
  for (const ball of [
    { x: 0, y: 0.95, z: 1.6 }, { x: 0.55, y: 1.1, z: 1.8 },
    { x: -0.6, y: 0.9, z: 1.5 }, { x: 0, y: 1.2, z: 1.75 },
  ]) {
    const scr = project(ball);
    // Invert the stance map so the bat's depth plane is the ball's own. The
    // map is anchored at PADDLE_HOME (1.78) and spans ±0.43 m — balls must
    // sit inside [zNear, zFar] or the clamp legitimately moves the bat.
    assert.ok(ball.z >= lib.PADDLE_LIMITS.zNear && ball.z <= lib.PADDLE_LIMITS.zFar);
    const stanceY = 0.55 + (ball.z - 1.78) / 0.96;
    const t = lib.paddleTargetFromPointer(scr.x, scr.y, stanceY, 1, {}, { vp });
    const errXY = Math.hypot(t.tx - ball.x, t.ty - ball.y);
    assert.ok(errXY < 0.02, `blade ${errXY.toFixed(3)} m off the ball at ${JSON.stringify(ball)}`);
    assert.ok(Math.abs(t.tz - ball.z) < 0.02);
    assert.ok(Math.abs(t.tx) <= lib.PADDLE_LIMITS.x + 1e-9);
  }
});
test('pointer plane point is the inverse of the projection', () => {
  const aspect = 16 / 9;
  const rig = lib.cameraRigFor('BROADCAST', null, aspect);
  const vp = lib.rigViewProj(rig, aspect);
  const p = { x: 0.35, y: 1.12, z: 1.78 };
  const cw = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
  const sx = ((vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / cw) * 0.5 + 0.5;
  const sy = 0.5 - ((vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / cw) * 0.5;
  const o = {};
  assert.ok(lib.pointerPlanePoint(vp, sx, sy, p.z, o));
  assert.ok(Math.hypot(o.x - p.x, o.y - p.y) < 1e-4);
});
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
