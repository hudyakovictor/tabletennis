/* DOM-input -> fixed-step simulation -> render: contact must keep moving.
 * Synthetic pointers cover the matrix. Browser-owned capture is covered by
 * test:input's separate trusted mouse / CDP touch scenarios. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const puppeteer=require('puppeteer-core'),chromium=require('@sparticuz/chromium');
(async()=>{
 const libs=path.join(os.tmpdir(),'topspin-browser-libs');fs.mkdirSync(libs,{recursive:true});
 const archive=path.join(path.dirname(require.resolve('@sparticuz/chromium')),'../../bin/al2023.tar.br');if(process.platform==='linux'&&fs.existsSync(archive))execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(archive))});
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||await chromium.executablePath(),headless:true,args:chromium.args,env:{...process.env,LD_LIBRARY_PATH:[path.join(libs,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
 const rows=[];try{
 for(const [width,height,type] of [[1280,760,'mouse'],[390,844,'touch'],[844,390,'touch']]){
 const page=await browser.newPage();await page.setViewport({width,height,isMobile:type==='touch',hasTouch:type==='touch'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve(__dirname,'../play/index.html')).href);await page.waitForFunction(()=>window.__game&&window.__game.R.drawCalls>0);
 const report=await page.evaluate(({width,height,type})=>{
 const g=window.__game,results=[];g.paused=true;
 document.querySelectorAll('.screen.on').forEach(e=>e.classList.remove('on'));document.querySelector('#loading').classList.add('off');
 const capture=g.canvas.setPointerCapture;g.canvas.setPointerCapture=()=>{};
 const check=(v,m)=>{if(!v)throw Error(m);};
 const event=(name,x,y)=>g.canvas.dispatchEvent(new PointerEvent(name,{bubbles:true,cancelable:true,pointerType:type,pointerId:31,isPrimary:true,button:0,buttons:name==='pointerup'?0:1,clientX:x*width,clientY:y*height}));
 for(const fps of [30,60,120,144])for(const grip of ['shakehand','penhold'])for(const hand of ['right','left'])for(const x of [-.6,0,.6]){
 try{
 g.startMatch(2);g.paused=true;g.server=1;g.prepServe();for(let i=0;i<70;i++)g.update(1/60);
 g.settings.grip=grip;g.settings.hand=hand;g.recenterT=0;g.server=-1;g.setState(GS.RALLY);g.isServeBall=false;g.rallyBounces=[1];
 g.ai.think=()=>{};g.tryAiHit=()=>{};g.settings.slowmoPlayer=1;g.settings.slowmoOnBigShots=true;g.reducedMotion=true;
 V3.set(g.ball.p,x,1.05,1.5);V3.set(g.ball.v,0,.1,4);V3.zero(g.ball.w);g.ball.live=true;g.ball.lastHitBy=-1;
 V3.copy(g.player.pos,g.ball.p);V3.copy(g.player.prevPos,g.ball.p);g.player.lastHitT=g.time-1;
 g.paused=false;const sid=g.shotId,p=g.project(g.ball.p,{}),tick=()=>g.update(1/fps);let peakMs=0;
 event('pointerdown',p.x,p.y);tick();event('pointermove',p.x,p.y-.04);tick();event('pointermove',p.x+.01,p.y-.09);event('pointerup',p.x+.01,p.y-.09);
 for(let i=0;i<40&&g.ball.lastHitBy!==1&&g.state!==GS.POINT;i++){const t=performance.now();tick();peakMs=Math.max(peakMs,performance.now()-t);}
 check(g.ball.lastHitBy===1,'no contact');check(g.shotId-sid===1,'double contact');
 check(g.player.motionStage==='contact','impact pose not installed');
 check(!g.anticipation.active&&V3.len(g.anticipation.visualOffset)===0,'wind-up still pulls bat back after impact');
 const before={p:{...g.player.pos},n:{...g.player.normal}};tick();
 const displacement=V3.dist(before.p,g.player.pos),faceDelta=V3.dist(before.n,g.player.normal);
 check(displacement>.0001||faceDelta>.0001,'first post-impact frame frozen');
 check(g.player.motionStage!=='contact','intentional contact hold remains');
 check(g.targetTimeScale===1,'hit enabled automatic slow motion');
 // Raw movement after contact remains actionable without waiting for recovery.
 const pointerX=g.pointer.x,dir=pointerX>.6?-1:1;
 g.canvas.dispatchEvent(new PointerEvent('pointermove',{pointerType:type,pointerId:31,isPrimary:true,buttons:0,clientX:(pointerX+dir*.08)*width,clientY:g.pointer.y*height}));
 if(type==='mouse'){check(Math.abs(g.pointer.x-pointerX)>.07,'mouse target locked');tick();}
 const pose={...g.player.pos};g.render();g.render();check(V3.dist(pose,g.player.pos)===0,'render mutated physics');
 check(Object.values(g.player.pos).every(Number.isFinite),'non-finite position');
 results.push({ok:true,fps,grip,hand,x,displacement,faceDelta,peakUpdateMs:peakMs});
 }catch(e){results.push({ok:false,fps,grip,hand,x,error:e.message});}
 finally{g.cancelInput();g.paused=true;}
 }
 g.canvas.setPointerCapture=capture;return results;
 },{width,height,type});
 rows.push(...report.map(r=>({viewport:`${width}x${height}`,type,...r})));rows.push({viewport:`${width}x${height}`,ok:errors.length===0,name:'browser exceptions',errors});
 await page.screenshot({path:path.resolve(__dirname,`../test-results/evidence/contact-${width}x${height}.png`)});await page.close();
 }
 }finally{await browser.close();}
 const out=path.resolve(__dirname,'../test-results/evidence/contact-browser.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(rows,null,2));
 for(const r of rows.filter(r=>!r.ok))console.log('FAIL',JSON.stringify(r));
 console.log(JSON.stringify({checks:rows.length,passed:rows.filter(r=>r.ok).length,maxContactUpdateMs:Math.max(...rows.map(r=>r.peakUpdateMs||0)),report:out}));assert.equal(rows.filter(r=>!r.ok).length,0);
})().catch(e=>{console.error(e);process.exitCode=1;});
