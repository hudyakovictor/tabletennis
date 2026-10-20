/* Real browser input regressions. RAF is frozen; only time/physics is stepped,
 * never SwipeTracker.down/move/up or tryPlayerHit directly. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const root = path.resolve(__dirname, '..');
(async()=>{
 const libs=path.join(os.tmpdir(),'topspin-browser-libs');
 if(process.platform==='linux'){
  fs.mkdirSync(libs,{recursive:true});
  const archive=path.join(path.dirname(require.resolve('@sparticuz/chromium')),'../../bin/al2023.tar.br');
  if(fs.existsSync(archive))execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(archive))});
 }
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||await chromium.executablePath(),args:chromium.args,headless:true,
  env:{...process.env,LD_LIBRARY_PATH:[path.join(libs,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
 const results=[];
 try{
 for(const [width,height,type] of [[1280,760,'mouse'],[390,844,'touch'],[844,390,'touch']]){
  const page=await browser.newPage();await page.setViewport({width,height,isMobile:type==='touch',hasTouch:type==='touch'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root,'play/index.html')).href);
  await page.waitForFunction(()=>window.__game&&window.__game.R.drawCalls>0);
  const rows=await page.evaluate(({type,width,height})=>{
   const g=window.__game,rows=[];
   g.paused=true; // freeze RAF, manually advance the complete game update
   document.querySelectorAll('.screen.on').forEach(e=>e.classList.remove('on'));
   document.querySelector('#loading').classList.add('off');
   // DOM dispatch below exercises the real listeners. Synthetic IDs are not
   // browser-owned, so capture is tested separately with trusted input below.
   const capture=g.canvas.setPointerCapture;g.canvas.setPointerCapture=()=>{};
   const event=(name,x,y,id=11)=>g.canvas.dispatchEvent(new PointerEvent(name,{bubbles:true,cancelable:true,pointerId:id,isPrimary:id===11,pointerType:type,button:0,buttons:name==='pointerup'?0:1,clientX:x*width,clientY:y*height}));
   const tick=(n=1,fps=60)=>{for(let i=0;i<n;i++)g.update(1/fps);};
   const point=()=>{const p=g.project(g.ball.p,{});return{x:p.x,y:p.y};};
   const setup=()=>{
    g.startMatch(2);g.paused=true;g.server=1;g.prepServe();tick(70);g.paused=false;
    g._inputBaseShot=g.shotId;g.score=[0,0];g.settings.footAssist=.85;g.settings.reducedMotion=true;
   };
   const run=(name,fn)=>{try{const detail=fn();rows.push({name,ok:true,detail});}catch(e){rows.push({name,ok:false,error:e.message});}finally{g.cancelInput();g.paused=true;}};
   const check=(v,message)=>{if(!v)throw Error(message);};
   for(const fps of [30,60,120,144]){
    run(`ready drag produces one serve at ${fps} FPS`,()=>{
     setup();const p=point();event('pointerdown',p.x,p.y);
     const admitted=g.swipe.pressZone&&g.swipe.pressZone.accepted;
     tick(1,fps);event('pointermove',p.x,p.y-.045);tick(1,fps);event('pointermove',p.x+.015,p.y-.10);event('pointerup',p.x+.015,p.y-.10);
     for(let i=0;i<fps*2&&g.state!==GS.POINT&&g.ball.lastHitBy!==1;i++)tick(1,fps);
     check(g.ball.lastHitBy===1,`no serve: admitted=${admitted}, zone=${JSON.stringify(g.swipe.pressZone)}, state=${g.state}`);
     check(g.shotId-g._inputBaseShot===1,`expected one contact, got ${g.shotId-g._inputBaseShot}`);return{shotId:g.shotId-g._inputBaseShot};
    });
   }
   run('press during rising toss is admitted, contact waits for descent',()=>{
    setup();let p=point();event('pointerdown',p.x,p.y);event('pointerup',p.x,p.y);tick(4);p=point();
    event('pointerdown',p.x,p.y);tick();event('pointermove',p.x,p.y-.08);event('pointerup',p.x,p.y-.08);
    check(g.ball.lastHitBy===0,'rising ball struck illegally');
    for(let i=0;i<60&&g.ball.lastHitBy!==1&&g.state!==GS.POINT;i++)tick();check(g.shotId-g._inputBaseShot===1,'rising press permanently rejected');return{shotId:g.shotId-g._inputBaseShot};
   });
   for (const [label,dx,dy] of [['up',0,-.1],['down',0,.1],['left',-.12,0],['right',.12,0]]) {
    run(`ready-state ${label} flick from lower control area`,()=>{
     setup();event('pointerdown',.5,.72);tick();event('pointermove',.5+dx*.5,.72+dy*.5);tick();event('pointermove',.5+dx,.72+dy);event('pointerup',.5+dx,.72+dy);
     for(let i=0;i<70&&g.ball.lastHitBy!==1&&g.state!==GS.POINT;i++)tick();
     check(g.shotId-g._inputBaseShot===1,'serve-init flick rejected');
    });
   }
   run('pause cancels a queued toss',()=>{
    setup();g.prepServe();event('pointerdown',.5,.75);event('pointerup',.5,.75);g.setPaused(true);g.setPaused(false);tick(30);
    check(g.state===GS.SERVE_READY&&!g.tossQueued,'cancelled toss started after resume');
   });
   run('outside press on a flying toss remains rejected',()=>{
    setup();const p=point();event('pointerdown',p.x,p.y);event('pointerup',p.x,p.y);tick(8);
    event('pointerdown',.02,.02);tick();event('pointermove',.15,.15);event('pointerup',.15,.15);tick(65);
    check(g.shotId===g._inputBaseShot,'outside toss press produced a hit');
   });
   run('debug preview uses the same scaled zone as pointerdown',()=>{
    setup();const p=point();event('pointerdown',p.x,p.y);event('pointerup',p.x,p.y);tick(4);g.settings.zoneScale=1.8;
    const q=point(),expected=g.measurePressZone(q,type);event('pointerdown',q.x,q.y);const stamped=g.swipe.pressZone;
    check(expected.radius===stamped.radius&&expected.sidePx===stamped.sidePx&&expected.accepted===stamped.accepted,'preview/input disagree');
    g.settings.zoneScale=1;
   });
   run('fresh input returns an incoming ball after its own-side bounce',()=>{
    setup();g.cancelInput();g.recenterT=0;g.server=-1;g.setState(GS.RALLY);g.isServeBall=false;g.rallyBounces=[1];
    V3.set(g.ball.p,0,1.05,1.5);V3.set(g.ball.v,0,.1,4);V3.zero(g.ball.w);g.ball.live=true;g.ball.lastHitBy=-1;
    V3.copy(g.player.pos,g.ball.p);V3.copy(g.player.prevPos,g.ball.p);g.player.lastHitT=g.time-1;
    const p=point();event('pointerdown',p.x,p.y);tick();event('pointermove',p.x,p.y-.04);tick();event('pointermove',p.x+.01,p.y-.09);event('pointerup',p.x+.01,p.y-.09);
    for(let i=0;i<30&&g.ball.lastHitBy!==1&&g.state!==GS.POINT;i++)tick();
    check(g.ball.lastHitBy===1,'fresh admitted return missed: '+JSON.stringify({state:g.state,shot:g.shotId-g._inputBaseShot,zone:g.swipe.pressZone,m:g.swipe.lastReleased,ball:g.ball.p,pad:g.player.pos,latest:g.shotJournal.latest}));
   });
   run('tap during recenter queues toss after release',()=>{
    setup();g.prepServe();event('pointerdown',.5,.75);event('pointerup',.5,.75);tick(23);
    check(g.state===GS.SERVE_TOSS,'queued tap silently dropped');return{state:g.state};
   });
   run('stationary click never strikes',()=>{setup();const p=point();event('pointerdown',p.x,p.y);event('pointerup',p.x,p.y);tick(90);check(g.shotId===g._inputBaseShot,'static click hit ball');});
   run('releasing at rest does not change stance or paddle position',()=>{
    setup();g.server=-1;g.ball.live=false;g.setState(GS.RALLY);g.recenterT=0;
    event('pointerdown',.5,.78);tick();event('pointermove',.5,.47);tick(90);
    const before={...g.player.pos},stance=g.stanceY;event('pointerup',.5,.47);tick(90);
    const drift=V3.dist(before,g.player.pos);check(drift<.002,`release drift ${drift.toFixed(4)} m; stance ${stance} -> ${g.stanceY}`);return{drift};
   });
   run('pause overlay motion cannot steer paddle',()=>{
    setup();g.setPaused(true);const before=JSON.stringify(g.pointer);
    window.dispatchEvent(new PointerEvent('pointermove',{pointerType:'mouse',clientX:width*.9,clientY:height*.9,buttons:0}));
    check(JSON.stringify(g.pointer)===before,'background hover changed paddle target while paused');
   });
   run('secondary pointer cannot move primary stroke',()=>{
    setup();const p=point();event('pointerdown',p.x,p.y);tick();event('pointermove',.95,.1,22);
    check(g.swipe.m.dist===0,'unowned pointer added motion to primary stroke');
   });
   run('same-frame event preserves initial press sample',()=>{
    setup();const p=point();event('pointerdown',p.x,p.y);event('pointermove',p.x+.025,p.y-.04);
    check(g.swipe.samples[0].x===p.x&&g.swipe.samples[0].y===p.y,'first move overwrote pointerdown origin');
   });
   g.canvas.setPointerCapture=capture;g.paused=true;
   return rows;
  },{type,width,height});
  results.push(...rows.map(r=>({viewport:`${width}x${height}`,type,...r})));
  // Trusted browser-owned mouse/touch input: capture, element hit-testing,
  // CSS touch-action and release semantics, without synthetic capture mocks.
  await page.evaluate(()=>{const g=window.__game;g.startMatch(2);g.paused=true;g.server=1;g.prepServe();for(let i=0;i<70;i++)g.update(1/60);g.paused=false;g._savedUpdate=g.update;g.update=()=>{};});
  const p=await page.evaluate(()=>{const g=window.__game,p=g.project(g.ball.p,{}),r=g.canvas.getBoundingClientRect();return{x:r.left+p.x*r.width,y:r.top+p.y*r.height};});
  if(type==='mouse'){
   await page.mouse.move(p.x,p.y);await page.mouse.down();await page.evaluate(()=>{const g=window.__game;g._savedUpdate.call(g,1/60);});
   await page.mouse.move(p.x,p.y-height*.08,{steps:5});await page.mouse.up();
  }else{
   const cdp=await page.createCDPSession();
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x,y:p.y,id:1}]});
   await page.evaluate(()=>{const g=window.__game;g._savedUpdate.call(g,1/60);});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y-height*.08,id:1}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  }
  const trusted=await page.evaluate(()=>{const g=window.__game;for(let i=0;i<50&&g.ball.lastHitBy!==1;i++)g._savedUpdate.call(g,1/60);return{ok:g.ball.lastHitBy===1&&!g.swipe.active,shotId:g.shotId,zone:g.swipe.pressZone};});
  results.push({viewport:`${width}x${height}`,type,name:'trusted input + DOM hit-test + pointer capture',...trusted});
  results.push({viewport:`${width}x${height}`,type,name:'no browser exceptions',ok:errors.length===0,errors});
  await page.close();
 }
 }finally{await browser.close();}
 fs.mkdirSync(path.join(root,'test-results','evidence'),{recursive:true});
 const out=process.env.INPUT_REPORT||path.join(root,'test-results/evidence/input-regressions.json');fs.writeFileSync(out,JSON.stringify(results,null,2));
 for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.viewport} ${r.name}${r.error?' — '+r.error:''}`);
 console.log(`${results.filter(r=>r.ok).length}/${results.length} passed; ${out}`);
 if(!process.env.INPUT_BASELINE)assert.equal(results.filter(r=>!r.ok).length,0,'input regressions failed');
})().catch(e=>{console.error(e);process.exitCode=1;});
