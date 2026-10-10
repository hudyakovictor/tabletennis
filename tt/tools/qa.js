const puppeteer=require('puppeteer');const path=require('path');
const SHOTS='/home/user/tt/shots/';
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--window-size=1280,760']});
const page=await br.newPage(); await page.setViewport({width:1280,height:760});
const errs=[];
page.on('pageerror',e=>errs.push('PAGEERR '+e.message));
page.on('console',async m=>{if(m.type()==='error')errs.push('CONSOLE '+m.text());});
page.on('requestfailed',r=>errs.push('REQFAIL '+r.url()));
await page.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await page.screenshot({path:SHOTS+'n0_menu.png'});

// ---- TRAINING ---------------------------------------------------------
await page.click('#train0'); await new Promise(r=>setTimeout(r,700));
await page.screenshot({path:SHOTS+'n1_train_intro.png'});

const r1=await page.evaluate(async()=>{
  const g=window.__game; g.paused=true; const DT=1/120; const log=[];
  const PR={};
  const pdown=(x,y)=>{g.swipe.down(x,y,g.time);g.pointer={x,y};g.pointerDown=true;if(g.state==='SERVE_READY'&&g.server===1)g.startToss();};
  const pmove=(x,y)=>{g.pointer={x,y};if(g.swipe.active)g.swipe.move(x,y,g.time);};
  const pup=()=>{if(!g.swipe.active)return;g.swipe.up(g.pointer.x,g.pointer.y,g.time);g.pointerDown=false;g.swipeReleasedAt=g.time;};
  const aim=()=>{const b=g.ball,sens=g.settings.sensitivity,W=g._strike;let wx=0,wy=PH.TABLE_Y+0.25;
    if(W&&W.on&&W.kind==='rally'){wx=W.x;wy=W.y;}
    else if(g.state!=='RALLY'){wx=b.p.x;wy=b.p.y;}
    wx=Math.max(-1.1,Math.min(1.1,wx));wy=Math.max(PH.TABLE_Y-0.2,Math.min(PH.TABLE_Y+0.85,wy));
    return {x:0.5+wx/(2.10*sens),y:0.18+(PH.TABLE_Y+0.62-wy)/(0.95*sens)};};
  // follow the ghost gesture of the current step
  let ges=null,cool=0,lastStep=-1,stuck=0;
  for(let i=0;i<120*180;i++){
    const tr=g.training; if(!tr) break;
    if(tr.step!==lastStep){log.push('step '+tr.step+' '+tr.S.id+' @'+g.time.toFixed(1));lastStep=tr.step;}
    if(tr.phase==='done'){log.push('DONE @'+g.time.toFixed(1));break;}
    if(tr.phase==='intro'){g.pointerDown=true;}
    if(!ges){const q=aim();pmove(q.x,q.y);}
    if(ges){const s=Math.min(1,(g.time-ges.t0)/ges.dur);
      const pts=ges.pts; const u=s*(pts.length-1); const k=Math.min(pts.length-2,Math.floor(u)); const f=u-k;
      const x=pts[k][0]+(pts[k+1][0]-pts[k][0])*f, y=pts[k][1]+(pts[k+1][1]-pts[k][1])*f;
      pmove(ges.x0+(x-pts[0][0]),ges.y0+(y-pts[0][1]));
      if(s>=1){pup();ges=null;cool=0.35;}}
    if(!ges&&cool<=0){const b=g.ball;const S=tr.S;
      const W=g._strike;
      const can = (g.state==='SERVE_READY'&&g.server===1) ||
        (g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&W&&W.on&&W.kind==='rally'&&W.t<0.155);
      if(can&&tr.phase==='live'){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y,pts:S.gesture,dur:(S.dur||0.16/(S.speed||1))};pdown(q.x,q.y);}}
    cool-=DT; g.update(DT);
  }
  return {log,step:g.training?g.training.step:-1,phase:g.training?g.training.phase:'-'};
});
console.log(r1.log.join('\n'),'| end step',r1.step,r1.phase);
await new Promise(r=>setTimeout(r,500));
await page.screenshot({path:SHOTS+'n2_train_live.png'});
await page.evaluate(()=>{window.__game.paused=false;});
await new Promise(r=>setTimeout(r,800));
await page.screenshot({path:SHOTS+'n3_train_end.png'});

// ---- MATCH ------------------------------------------------------------
await page.evaluate(()=>{document.querySelectorAll('.screen').forEach(s=>s.classList.remove('on'));window.__game.ui.trainHide();window.__game.training=null;window.__game.startMatch(2);});
await new Promise(r=>setTimeout(r,500));
const r2=await page.evaluate(async()=>{
  const g=window.__game; g.paused=true; const DT=1/120; const PR={};
  const pdown=(x,y)=>{g.swipe.down(x,y,g.time);g.pointer={x,y};g.pointerDown=true;if(g.state==='SERVE_READY'&&g.server===1)g.startToss();};
  const pmove=(x,y)=>{g.pointer={x,y};if(g.swipe.active)g.swipe.move(x,y,g.time);};
  const pup=()=>{if(!g.swipe.active)return;g.swipe.up(g.pointer.x,g.pointer.y,g.time);g.pointerDown=false;g.swipeReleasedAt=g.time;};
  const aim=()=>{const b=g.ball,sens=g.settings.sensitivity,W=g._strike;let wx=0,wy=PH.TABLE_Y+0.25;
    if(W&&W.on&&W.kind==='rally'){wx=W.x;wy=W.y;}
    else if(g.state!=='RALLY'){wx=b.p.x;wy=b.p.y;}
    wx=Math.max(-1.1,Math.min(1.1,wx));wy=Math.max(PH.TABLE_Y-0.2,Math.min(PH.TABLE_Y+0.85,wy));
    return {x:0.5+wx/(2.10*sens),y:0.18+(PH.TABLE_Y+0.62-wy)/(0.95*sens)};};
  let ges=null,cool=0;
  for(let i=0;i<120*60;i++){
    if(!ges){const q=aim();pmove(q.x,q.y);}
    if(ges){const s=Math.min(1,(g.time-ges.t0)/0.15);pmove(ges.x0+0.02*s,ges.y0-0.36*s);if(s>=1){pup();ges=null;}}
    if(!ges&&cool<=0){const b=g.ball;
      if(g.state==='SERVE_READY'&&g.server===1){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y};pdown(q.x,q.y);cool=0.3;}
      else if(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&b.v.z>0.2&&g.rallyBounces.some(s=>s>0)&&b.p.z>0.55&&b.p.z<1.15){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y};pdown(q.x,q.y);cool=0.3;}}
    cool-=DT; g.update(DT);
    if(i>120*6 && g.state==='RALLY' && g.ball.live && g.ball.p.z<0.4 && g.ball.p.z>-1.0 && g.rally>=1) break;
  }
  return {score:g.score,state:g.state,rally:g.rally,dc:g.R.drawCalls,tris:g.R.tris};
});
console.log('match frozen:',JSON.stringify(r2));
await new Promise(r=>setTimeout(r,800));
await page.screenshot({path:SHOTS+'n4_rally.png'});
// mid-flight strike ring
await page.evaluate(()=>{const g=window.__game;for(let i=0;i<34;i++)g.update(1/120);});
await new Promise(r=>setTimeout(r,500));
await page.screenshot({path:SHOTS+'n5_ring.png'});
await page.evaluate(()=>{window.__game.settings.camera='LOW';window.__game.paused=false;});
await new Promise(r=>setTimeout(r,900)); await page.screenshot({path:SHOTS+'n6_low.png'});
await page.evaluate(()=>{window.__game.settings.camera='SIDE';});
await new Promise(r=>setTimeout(r,900)); await page.screenshot({path:SHOTS+'n7_side.png'});
console.log(errs.length?('ERRORS:\n'+errs.join('\n')):'no console errors');
await br.close();})();
