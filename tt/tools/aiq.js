/* Measure what the opponent actually does: pace distribution, stroke mix,
   error rate, rally length — per difficulty level. */
const puppeteer=require('puppeteer');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage(); await p.setViewport({width:900,height:560});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2000));
const out=await p.evaluate(async(SECS)=>{
  const res=[];
  for(let lvl=0;lvl<5;lvl++){
    document.querySelectorAll('.screen').forEach(e=>e.classList.remove('on'));
    const g=window.__game;
    g.settings.adaptive=false;
    g.settings.targetScore=21;
    g.startMatch(lvl); g.paused=true;
    const DT=1/120, PR={};
    const speeds=[], mix={}, rallies=[]; let errs=0, shots=0, pts=[0,0];
    const pdown=(x,y)=>{g.swipe.down(x,y,g.time);g.pointer={x,y};g.pointerDown=true;if(g.state==='SERVE_READY'&&g.server===1)g.startToss();};
    const pmove=(x,y)=>{g.pointer={x,y};if(g.swipe.active)g.swipe.move(x,y,g.time);};
    const pup=()=>{if(!g.swipe.active)return;g.swipe.up(g.pointer.x,g.pointer.y,g.time);g.pointerDown=false;g.swipeReleasedAt=g.time;g.lastSwipeT=g.time;};
    const aim=()=>{const b=g.ball,W=g._strike;let wx=0,wy=PH.TABLE_Y+0.25;
      if(W&&W.on&&W.kind==='rally'){wx=W.x;wy=W.y;} else if(g.state!=='RALLY'){wx=b.p.x;wy=b.p.y;}
      wx=Math.max(-1.1,Math.min(1.1,wx)); wy=Math.max(PH.TABLE_Y-0.2,Math.min(PH.TABLE_Y+0.85,wy));
      return {x:0.5+wx/2.10,y:0.18+(PH.TABLE_Y+0.62-wy)/0.95};};
    let ges=null,cool=0,seen=0;
    const origAward=g.awardPoint.bind(g);
    g.awardPoint=function(who,reason){rallies.push(g.rally);origAward(who,reason);};
    for(let i=0;i<120*SECS;i++){
      if(!ges){const q=aim();pmove(q.x,q.y);}
      if(ges){const s=Math.min(1,(g.time-ges.t0)/0.15);pmove(ges.x0+0.01*s,ges.y0-0.30*s);if(s>=1){pup();ges=null;cool=0.3;}}
      if(!ges&&cool<=0){const b=g.ball,W=g._strike;
        if(g.state==='SERVE_READY'&&g.server===1){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y};pdown(q.x,q.y);}
        else if(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&W&&W.on&&W.kind==='rally'&&W.t<0.15){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y};pdown(q.x,q.y);}}
      cool-=DT; g.update(DT);
      // sample the opponent's outgoing shots
      const r=g.recorder.shots;
      for(let k=seen;k<r.length;k++){const sh=r[k];if(sh.by===-1){speeds.push(sh.speed);mix[sh.stroke]=(mix[sh.stroke]||0)+1;shots++;if(sh.slip)errs++;}}
      seen=r.length;
      if(g.state==='MATCH_END') break;
    }
    speeds.sort((a,b)=>a-b);
    const q=(f)=>speeds.length?+speeds[Math.min(speeds.length-1,Math.floor(speeds.length*f))].toFixed(0):0;
    res.push({lvl:g.ai.L.name, shots,
      kmh:{p10:q(0.1),med:q(0.5),p90:q(0.9),max:q(0.999)},
      errPct:shots?+(errs/shots*100).toFixed(1):0,
      rallyAvg:rallies.length?+(rallies.reduce((a,b)=>a+b,0)/rallies.length).toFixed(1):0,
      score:g.score.slice(), mix});
    g.awardPoint=origAward;
  }
  return res;
},+process.env.SECS||150);
for(const r of out) console.log(r.lvl.padEnd(15), 'км/ч p10/med/p90/max', String(r.kmh.p10).padStart(3), String(r.kmh.med).padStart(3), String(r.kmh.p90).padStart(3), String(r.kmh.max).padStart(3),
  '| брак', String(r.errPct).padStart(5)+'%', '| ралли', String(r.rallyAvg).padStart(4), '| счёт', r.score.join(':'), '|', Object.entries(r.mix).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>k+':'+v).join(' '));
await br.close();})();
