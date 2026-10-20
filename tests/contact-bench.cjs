/* Paired A/B: same input/physics/browser, one warmup then repeated cold-cache
 * contacts. CPU throttling is synthetic, not a substitute for phone testing. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const{execFileSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const puppeteer=require('puppeteer-core'),chromium=require('@sparticuz/chromium');
(async()=>{
 const libs=path.join(os.tmpdir(),'topspin-browser-libs');fs.mkdirSync(libs,{recursive:true});
 if(process.platform==='linux'){const a=path.join(path.dirname(require.resolve('@sparticuz/chromium')),'../../bin/al2023.tar.br');if(fs.existsSync(a))execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(a))});}
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||await chromium.executablePath(),headless:true,args:chromium.args,env:{...process.env,LD_LIBRARY_PATH:[path.join(libs,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
 try{
 const page=await browser.newPage();await page.goto(pathToFileURL(path.resolve(__dirname,'../play/index.html')).href);await page.waitForFunction(()=>window.__game&&window.__game.R.drawCalls>0);await page.evaluate(()=>window.__game.paused=true);
 if(process.env.CPU_SLOWDOWN)await(await page.createCDPSession()).send('Emulation.setCPUThrottlingRate',{rate:+process.env.CPU_SLOWDOWN});
 const data=await page.evaluate(({fixtures,repeats})=>{
  const integrate0=integrateBall,predict0=predict;let steps=0,flights=0;
  integrateBall=(...a)=>{steps++;return integrate0(...a);};predict=(...a)=>{flights++;return predict0(...a);};
  const rows=[];
  try{
  for(let pass=-1;pass<repeats;pass++)for(const grip of ['shakehand','penhold'])for(const x of [-.62,0,.62])for(const [id,s] of fixtures){
   const p=V3.new(x,s.y,s.z),v=V3.new(.2,-1,s.serve?0:s.inc||6),w=V3.new(s.spin||120,30,0);
   const m={right:s.right??.12,up:s.up,dist:s.dist??.24,curl:s.curl||0,releaseSpeed:s.speed,peakSpeed:s.speed,speed:s.speed,smooth:.95,straightness:.95,holdT:0,samples:8,x:.52,y:.5,sx:.5,sy:.7,dx:.02,dy:-s.up*.2,pathLen:s.dist??.24,dur:.12};
   const raw=deriveStroke(m,{side:1,grip,forehand:paddleForehand(x,'right'),isServe:!!s.serve,ball:p,ballSpin:w,ballSpeed:V3.len(v)});
   for(const algorithm of (pass%2?['reference','live']:['live','reference'])){
    SERVE_WARM.clear();steps=0;flights=0;
    const t=performance.now(),out=(algorithm==='live'?refineRacketRealtime:refineRacket)(p,v,w,{...raw},.85,.85),ms=performance.now()-t;
    const cost={steps,flights};const bv=V3.clone(v),bw=V3.clone(w),info=impactRacket(bv,bw,out.normal,out.vR,.85,out.rubber||{});
    const bp=V3.clone(p);V3.addScaled(bp,bp,out.normal,PH.R*1.05);
    const report=predict0(bp,bv,bw,{dt:PH.SIM_DT,maxT:2.6,stopOnFirstBounce:!s.serve,stopAfterBounces:s.serve?2:undefined,out:{}});
    const landing=report.b2||report.landed;
    if(pass>=0)rows.push({pass,algorithm,grip,x,id,stroke:raw.stroke.id,ms,...cost,valid:out.valid,
     legal:!!info&&!report.hitNet&&!!report.landed&&(s.serve?report.landed.z>0&&!!report.b2&&report.b2.z<0:report.landed.z<0),
     speed:V3.len(bv),spin:{...bw},aimErrorM:landing?Math.hypot(landing.x-raw.aim.x,landing.z-raw.aim.z):null});
   }
  }
  }finally{integrateBall=integrate0;predict=predict0;}
  return rows;
 },{fixtures:require('./contact-fixtures.cjs'),repeats:+process.env.BENCH_REPEATS||3});
 const summary={cpuSlowdown:+process.env.CPU_SLOWDOWN||1,algorithms:{}};
 for(const algorithm of ['reference','live']){const r=data.filter(r=>r.algorithm===algorithm),times=r.map(r=>r.ms).sort((a,b)=>a-b);summary.algorithms[algorithm]={cases:r.length,legal:r.filter(r=>r.legal).length,medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)],maxMs:times.at(-1),maxFlights:Math.max(...r.map(r=>r.flights)),maxSteps:Math.max(...r.map(r=>r.steps)),meanAimErrorM:r.reduce((a,b)=>a+(b.aimErrorM||0),0)/r.length};}
 const out=process.env.CONTACT_REPORT||path.resolve(__dirname,'../test-results/evidence/contact-bench.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify({summary,data},null,2));console.log(JSON.stringify({...summary,report:out},null,2));
 if(summary.algorithms.live.legal<summary.algorithms.reference.legal)throw Error('trajectory regression');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
