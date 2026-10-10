const puppeteer=require('puppeteer');
const S='/home/user/tt/shots/';
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage(); await p.setViewport({width:1280,height:760});
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text());});
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await p.evaluate(()=>{document.querySelectorAll('.screen').forEach(e=>e.classList.remove('on'));
  const g=window.__game; g.startMatch(2); g.paused=true;
  for(let i=0;i<180;i++) g.update(1/120);});

const pose=async(yawDeg,pitchDeg,zoom,name)=>{
  await p.evaluate(({y,pi,z})=>{const g=window.__game;
    g.camAdj.yaw=-y*Math.PI/180; g.camAdj.pitch=pi*Math.PI/180; g.camAdj.zoom=z;
    g.camAdjT=1.4; g.ui.syncCam();
    for(let i=0;i<120;i++) g.update(1/120);   // let the smoothing settle
    g.render();},{y:yawDeg,pi:pitchDeg,z:zoom});
  await new Promise(r=>setTimeout(r,420));
  await p.screenshot({path:S+name+'.png'});
};
await pose(0,0,1,'c0_default');
await pose(38,0,1,'c1_yaw');
await pose(0,-26,1,'c2_low');
await pose(0,45,1,'c3_high');
await pose(0,0,0.55,'c4_near');
await pose(-25,14,1.9,'c5_far');

// --- gesture plumbing -------------------------------------------------
const read=()=>p.evaluate(()=>{const A=window.__game.camAdj;
  return {yaw:+(A.yaw*180/Math.PI).toFixed(1),pitch:+(A.pitch*180/Math.PI).toFixed(1),zoom:+A.zoom.toFixed(3)};});
await p.evaluate(()=>{window.__game.camReset();});
console.log('reset   ', JSON.stringify(await read()));

// right-button drag
await p.mouse.move(640,400);
await p.mouse.down({button:'right'});
await p.mouse.move(760,460,{steps:6});
await p.mouse.up({button:'right'});
console.log('rmb drag', JSON.stringify(await read()));

// wheel
await p.mouse.wheel({deltaY:-300});
console.log('wheel   ', JSON.stringify(await read()));

// keyboard
await p.evaluate(()=>{window.__game.camReset();});
await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowUp'); await p.keyboard.press('-');
console.log('keys    ', JSON.stringify(await read()));

// two-finger pinch must orbit AND kill the half-made stroke
await p.evaluate(()=>{window.__game.camReset();});
const pinch=await p.evaluate(async()=>{
  const g=window.__game, c=document.getElementById('gl');
  const ev=(t,id,x,y,btn)=>c.dispatchEvent(new PointerEvent(t,{pointerId:id,clientX:x,clientY:y,button:btn||0,buttons:1,bubbles:true}));
  c.setPointerCapture=()=>{};
  ev('pointerdown',1,600,500); ev('pointermove',1,600,460);
  const swipeAlive=g.swipe.active;
  ev('pointerdown',2,700,500);                 // second finger lands
  const afterSecond=g.swipe.active;
  ev('pointermove',1,560,520); ev('pointermove',2,760,520);
  ev('pointerup',1,560,520); ev('pointerup',2,760,520);
  return {swipeAlive,afterSecond,strokeFired:!!g.swipe.lastReleased,
    adj:{yaw:+(g.camAdj.yaw*180/Math.PI).toFixed(1),pitch:+(g.camAdj.pitch*180/Math.PI).toFixed(1),zoom:+g.camAdj.zoom.toFixed(3)}};
});
console.log('pinch   ', JSON.stringify(pinch));
console.log(errs.length?('ERRORS\n'+errs.join('\n')):'no console errors');
await br.close();})();
