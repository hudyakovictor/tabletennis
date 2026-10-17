const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const lib = load(['10_math.js', '30_physics.js', '57_camera.js'],
  ['cameraRigFor', 'tableFrameShift', 'rigViewProj', 'tableScreenBounds', 'CAMERA_ORDER', 'opponentScreenTop', 'CAMERA_HEADROOM']);
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
      assert.ok(b.bottom<=.901, `${mode}: no lower reading room`);
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
  for(const [aspect,lo,hi] of [[16/9,24.9,25.1],[390/844,24.9,25.1],[844/390,24.9,25.1]]) {
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
