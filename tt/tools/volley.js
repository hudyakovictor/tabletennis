const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await b.newPage(); page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('file://'+path.resolve('/home/user/table-tennis-topspin.html'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1500)); await page.click('#play'); await new Promise(r=>setTimeout(r,300));
const out=await page.evaluate(()=>{
  const g=window.__game; g.paused=true; const DT=1/120; const L=[];
  const ob=g.onBounce?g.onBounce.bind(g):null;
  if(ob) g.onBounce=(side,...a)=>{ L.push(`  bounce side=${side} z=${g.ball.p.z.toFixed(2)} lh=${g.ball.lastHitBy} serveBall=${g.isServeBall} sb=${g.serveBounces} rb=[${g.rallyBounces}]`); return ob(side,...a); };
  const op=g.awardPoint.bind(g); g.awardPoint=(w,m)=>{ if(g.state!=='POINT'&&g.state!=='MATCH_END') L.push(`PT ${w>0?'YOU':'AI '} ${m}  z=${g.ball.p.z.toFixed(2)} lh=${g.ball.lastHitBy} rb=[${g.rallyBounces}] serveBall=${g.isServeBall}`); op(w,m); };
  const ah=g.applyHit.bind(g); g.applyHit=(side,...a)=>{ L.push(`  HIT ${side>0?'YOU':'AI '} z=${g.ball.p.z.toFixed(2)} rbBefore=[${g.rallyBounces}]`); return ah(side,...a); };
  const pdown=(x,y)=>{g.swipe.down(x,y,g.time);g.pointer={x,y};g.pointerDown=true;if(g.state==='SERVE_READY'&&g.server===1)g.startToss();};
  const pmove=(x,y)=>{g.pointer={x,y};if(g.swipe.active)g.swipe.move(x,y,g.time);};
  const pup=()=>{if(!g.swipe.active)return;g.swipe.up(g.pointer.x,g.pointer.y,g.time);g.pointerDown=false;g.swipeReleasedAt=g.time;};
  let ges=null,cool=0;
  for(let i=0;i<120*60;i++){
    if(ges){const s=Math.min(1,(g.time-ges.t0)/0.15);pmove(0.5+0.02*s,0.72-0.34*s);if(s>=1){pup();ges=null;}}
    if(!ges&&cool<=0){const b=g.ball;
      if(g.state==='SERVE_READY'&&g.server===1){ges={t0:g.time};pdown(0.5,0.72);cool=0.35;}
      else if(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&b.v.z>0.2&&g.rallyBounces.some(s=>s>0)&&b.p.z>0.55&&b.p.z<1.15){ges={t0:g.time};pdown(0.5,0.72);cool=0.3;}}
    cool-=DT; g.update(DT); if(L.length>90)break;
  }
  return L;
});
console.log(out.join('\n'));
await b.close();})();
