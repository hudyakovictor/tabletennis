const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await br.newPage(); await page.setViewport({width:1280,height:760});
page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2000));
const out=await page.evaluate(async(START)=>{
  const g=window.__game; g.startTraining(); g.paused=true; const DT=1/120; const PR={};
  const rows=[];
  const pdown=(x,y)=>{g.swipe.down(x,y,g.time);g.pointer={x,y};g.pointerDown=true;if(g.state==='SERVE_READY'&&g.server===1)g.startToss();};
  const pmove=(x,y)=>{g.pointer={x,y};if(g.swipe.active)g.swipe.move(x,y,g.time);};
  const pup=()=>{if(!g.swipe.active)return;g.swipe.up(g.pointer.x,g.pointer.y,g.time);g.pointerDown=false;g.swipeReleasedAt=g.time;};
  const aim=()=>{const b=g.ball,sens=g.settings.sensitivity,W=g._strike;let wx=0,wy=PH.TABLE_Y+0.25;
    if(W&&W.on&&W.kind==='rally'){wx=W.x;wy=W.y;}
    else if(g.state!=='RALLY'){wx=b.p.x;wy=b.p.y;}
    wx=Math.max(-1.1,Math.min(1.1,wx));wy=Math.max(PH.TABLE_Y-0.2,Math.min(PH.TABLE_Y+0.85,wy));
    return {x:0.5+wx/(2.10*sens),y:0.18+(PH.TABLE_Y+0.62-wy)/(0.95*sens)};};
  g.training.goStep(START);
  const origPass=g.training.pass.bind(g.training), origFail=g.training.fail.bind(g.training);
  g.training.pass=function(){rows.push({r:'PASS',s:this.lastShot?{sp:+this.lastShot.speed.toFixed(0),top:+this.lastShot.topspin.toFixed(0),side:+this.lastShot.sidespin.toFixed(0),st:this.lastShot.stroke.id}:null});origPass();};
  g.training.fail=function(w){rows.push({r:'FAIL',why:w,s:this.lastShot?{sp:+this.lastShot.speed.toFixed(0),top:+this.lastShot.topspin.toFixed(0),side:+this.lastShot.sidespin.toFixed(0),st:this.lastShot.stroke.id}:null});origFail(w);};
  let ges=null,cool=0;
  for(let i=0;i<120*90;i++){
    const tr=g.training; if(!tr||tr.phase==='done')break;
    if(tr.step!==START) break;
    if(tr.phase==='intro'){g.pointerDown=true;}
    if(!ges){const q=aim();pmove(q.x,q.y);}
    if(ges){const s=Math.min(1,(g.time-ges.t0)/ges.dur);
      const pts=ges.pts;const u=s*(pts.length-1);const k=Math.min(pts.length-2,Math.floor(u));const f=u-k;
      pmove(ges.x0+(pts[k][0]+(pts[k+1][0]-pts[k][0])*f-pts[0][0]),ges.y0+(pts[k][1]+(pts[k+1][1]-pts[k][1])*f-pts[0][1]));
      if(s>=1){pup();ges=null;cool=0.35;}}
    if(!ges&&cool<=0&&tr.phase==='live'){const b=g.ball;const S=tr.S;
      const W=g._strike;
      const can=(g.state==='SERVE_READY'&&g.server===1)||(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&W&&W.on&&W.kind==='rally'&&W.t<0.155);
      if(can){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y,pts:S.gesture,dur:(S.dur||0.16/(S.speed||1))};pdown(q.x,q.y);}}
    cool-=DT; g.update(DT);
    if(rows.length>=7) break;
  }
  return {id:TRAIN_STEPS[START].id,rows};
},+process.argv[2]||0);
console.log(out.id, JSON.stringify(out.rows,null,0).replace(/},/g,'},\n'));
await br.close();})();
