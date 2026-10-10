const puppeteer=require('puppeteer');const path=require('path');
const FILE=process.env.TTFILE||'/home/user/table-tennis-topspin.html';
(async()=>{
const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--window-size=900,600']});
const page=await browser.newPage(); await page.setViewport({width:900,height:600});
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('file://'+path.resolve(FILE),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1500));
await page.click('#play'); await new Promise(r=>setTimeout(r,400));

const res = await page.evaluate(async (SECONDS)=>{
  const g=window.__game;
  g.paused=true;                       // take the loop away from rAF
  const DT=1/120;
  const ev=[]; const push=(s)=>{ if(ev.length<4000) ev.push(s); };
  const RE={}; window.__RE=RE;
  const SHOTQ={}; window.__SQ=SHOTQ;
  const oah=g.applyHit.bind(g);
  g.applyHit=(side,racket,cp,q,info)=>{
    if(side>0){ const b=g.ball,o={};
      predict({x:b.p.x,y:b.p.y,z:b.p.z},{x:b.v.x,y:b.v.y,z:b.v.z},{x:b.w.x,y:b.w.y,z:b.w.z},
              {dt:1/240,maxT:2.4,stopOnFirstBounce:true,out:o});
      const id=(racket.stroke&&racket.stroke.id)||'?';
      const res = o.hitNet?'NET' : (!o.landed?'LONG' : (o.landed.z>0?'OWN' : (Math.abs(o.landed.x)<=PH.T_HALF_WID?'IN':'WIDE')));
      const k=SHOTQ[id]||(SHOTQ[id]={IN:0,NET:0,LONG:0,OWN:0,WIDE:0}); k[res]++;
    }
    return oah(side,racket,cp,q,info);
  };
  const op=g.awardPoint.bind(g); g.awardPoint=(w,m)=>{ if(g.state!=='POINT'&&g.state!=='MATCH_END'){RE[m]=(RE[m]||0)+1;push(`PT ${w>0?'YOU':'AI '} ${m}  [${g.score[0]}-${g.score[1]}] rally=${g.rally}`);} op(w,m);};
  const ol=g.letServe?g.letServe.bind(g):null; if(ol) g.letServe=()=>{push('LET');ol();};

  // ---- synthetic pointer identical to the real handlers -------------
  let ges=null;
  const pdown=(x,y)=>{ g.swipe.down(x,y,g.time); g.pointer={x,y}; g.pointerDown=true;
                       if(g.state==='SERVE_READY'&&g.server===1) g.startToss(); };
  const pmove=(x,y)=>{ g.pointer={x,y}; if(g.swipe.active) g.swipe.move(x,y,g.time); };
  const pup  =()=>{ if(!g.swipe.active)return; const n=g.pointer; g.swipe.up(n.x,n.y,g.time); g.pointerDown=false; g.swipeReleasedAt=g.time; };

  const SHOTS=[
    {n:'LOOP',   dx: 0.02, dy:-0.38, dur:0.15, bend: 0},
    {n:'DRIVE',  dx: 0.09, dy:-0.26, dur:0.12, bend: 0},
    {n:'SMASH',  dx: 0.04, dy:-0.50, dur:0.09, bend: 0},
    {n:'PUSH',   dx:-0.05, dy: 0.22, dur:0.17, bend: 0},
    {n:'CHOP',   dx: 0.03, dy: 0.38, dur:0.15, bend: 0},
    {n:'HOOK',   dx: 0.07, dy:-0.32, dur:0.14, bend: 0.11},
    {n:'FADE',   dx:-0.07, dy:-0.32, dur:0.14, bend:-0.11},
    {n:'LOB',    dx: 0.01, dy:-0.40, dur:0.33, bend: 0},
    {n:'BLOCK',  dx: 0.01, dy:-0.05, dur:0.09, bend: 0},
    {n:'FLICK',  dx: 0.11, dy:-0.30, dur:0.10, bend: 0.05},
  ];
  // --- a human-ish hand: the cursor tracks where the ball will arrive ----
  const PR={};
  const aimPointer=()=>{
    const b=g.ball, sens=g.settings.sensitivity;
    let wx=0, wy=PH.TABLE_Y+0.25;
    if(b.live && b.lastHitBy===-1 && b.v.z>0.3){
      predict({x:b.p.x,y:b.p.y,z:b.p.z},{x:b.v.x,y:b.v.y,z:b.v.z},{x:b.w.x,y:b.w.y,z:b.w.z},
              {dt:1/200,maxT:1.6,stopZ:1.34,stopDir:1,stopAtPlane:true,out:PR});
      if(PR.reach){ wx=PR.reach.x; wy=PR.reach.y; }
    } else if(g.state==='SERVE_READY'||g.state==='SERVE_TOSS'){ wx=b.p.x; wy=b.p.y; }
    wx=Math.max(-1.1,Math.min(1.1,wx)); wy=Math.max(PH.TABLE_Y-0.2,Math.min(PH.TABLE_Y+0.85,wy));
    return { x: 0.5 + wx/(2.10*sens), y: 0.18 + (PH.TABLE_Y+0.62-wy)/(0.95*sens) };
  };
  // start a gesture that will be fed over the next frames
  const begin=(sh)=>{ const p0=aimPointer(); const x0=p0.x, y0=p0.y;
    ges={sh,x0,y0,t0:g.time,n:0}; pdown(x0,y0); push('  sw '+sh.n); };
  const feed=()=>{ if(!ges)return;
    const el=g.time-ges.t0, s=Math.min(1,el/ges.sh.dur);
    const {dx,dy,bend}=ges.sh; let nx=-dy,ny=dx; const bl=Math.hypot(nx,ny)||1;
    const off=bend*Math.sin(Math.PI*s);
    pmove(ges.x0+dx*s+nx/bl*off, ges.y0+dy*s+ny/bl*off);
    if(s>=1){ pup(); ges=null; } };

  let si=0, cool=0, steps=Math.round(SECONDS/DT);
  const hist=[];
  for(let i=0;i<steps;i++){
    if(!ges){ const q=aimPointer(); pmove(q.x,q.y); }
    feed();
    if(!ges && cool<=0){
      const b=g.ball;
      if(g.state==='SERVE_READY'&&g.server===1){ begin(SHOTS[si++%SHOTS.length]); cool=0.25; }
      else if(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&b.v.z>0.2
              &&g.rallyBounces.some(s=>s>0)&&b.p.z>0.55&&b.p.z<1.15&&b.p.y>0.60){
        begin(SHOTS[si++%SHOTS.length]); cool=0.30; }
    }
    cool-=DT;
    g.update(DT);
    hist.push(g.state);
    if(g.state==='MATCH_END') break;
  }
  const H={}; for(const k of hist) H[k]=(H[k]||0)+1;
  const RE2=window.__RE; const SQ=window.__SQ;
  const b2=g.ball;
  return { shotq:SQ, reasons:RE2, hist:H, stuck:`state=${g.state} sT=${g.stateT.toFixed(1)} live=${b2.live} lh=${b2.lastHitBy} p=(${b2.p.x.toFixed(2)},${b2.p.y.toFixed(2)},${b2.p.z.toFixed(2)}) v=(${b2.v.x.toFixed(2)},${b2.v.y.toFixed(2)},${b2.v.z.toFixed(2)}) serveBall=${g.isServeBall} srv=${g.server} aiTimer=${g.aiServeTimer}`,
           ev, score:g.score, shots:g.stats.shots, best:g.bestRally, byStroke:g.stats.byStroke,
           rallies:g.stats.rallies, avgRally:+(g.stats.shots/Math.max(1,g.stats.rallies)).toFixed(2),
           maxSpeed:+g.stats.maxSpeed.toFixed(1), maxSpin:+g.stats.maxSpin.toFixed(0), state:g.state };
}, +(process.env.SECS||90));

console.log(res.ev.join('\n'));
console.log('\n== rallies',res.rallies,'avgShots/rally',res.avgRally,'\n== score', res.score, 'state', res.state, 'shots', res.shots, 'bestRally', res.best);
console.log('== byStroke', JSON.stringify(res.byStroke), 'maxSpeed', res.maxSpeed, 'maxSpin', res.maxSpin);
console.log('== shotq', JSON.stringify(res.shotq));
console.log('== reasons', JSON.stringify(res.reasons,null,0));
console.log('== hist', JSON.stringify(res.hist));
console.log('== stuck', res.stuck);
console.log('== errors', errs.length?errs.slice(0,5):'(none)');
await browser.close();})();
