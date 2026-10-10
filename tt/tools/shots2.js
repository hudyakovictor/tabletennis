const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--window-size=1280,760']});
const page=await br.newPage(); await page.setViewport({width:1280,height:760});
page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('file://'+path.resolve('/home/user/table-tennis-topspin.html'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await page.screenshot({path:'/home/user/tt/shots/20_menu.png'});
await page.click('#play'); await new Promise(r=>setTimeout(r,500));
// fast-forward the simulation then freeze on an interesting frame
const info=await page.evaluate(async()=>{
  const g=window.__game; g.paused=true; const DT=1/120;
  const PR={};
  const pdown=(x,y)=>{g.swipe.down(x,y,g.time);g.pointer={x,y};g.pointerDown=true;if(g.state==='SERVE_READY'&&g.server===1)g.startToss();};
  const pmove=(x,y)=>{g.pointer={x,y};if(g.swipe.active)g.swipe.move(x,y,g.time);};
  const pup=()=>{if(!g.swipe.active)return;g.swipe.up(g.pointer.x,g.pointer.y,g.time);g.pointerDown=false;g.swipeReleasedAt=g.time;};
  const aim=()=>{const b=g.ball,sens=g.settings.sensitivity;let wx=0,wy=PH.TABLE_Y+0.25;
    if(b.live&&b.lastHitBy===-1&&b.v.z>0.3){predict({...b.p},{...b.v},{...b.w},{dt:1/200,maxT:1.6,stopZ:1.34,stopDir:1,stopAtPlane:true,out:PR});if(PR.reach){wx=PR.reach.x;wy=PR.reach.y;}}
    else if(g.state!=='RALLY'){wx=b.p.x;wy=b.p.y;}
    wx=Math.max(-1.1,Math.min(1.1,wx));wy=Math.max(PH.TABLE_Y-0.2,Math.min(PH.TABLE_Y+0.85,wy));
    return {x:0.5+wx/(2.10*sens),y:0.18+(PH.TABLE_Y+0.62-wy)/(0.95*sens)};};
  let ges=null,cool=0;
  for(let i=0;i<120*40;i++){
    if(!ges){const q=aim();pmove(q.x,q.y);}
    if(ges){const s=Math.min(1,(g.time-ges.t0)/0.15);pmove(ges.x0+0.02*s,ges.y0-0.36*s);if(s>=1){pup();ges=null;}}
    if(!ges&&cool<=0){const b=g.ball;
      if(g.state==='SERVE_READY'&&g.server===1){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y};pdown(q.x,q.y);cool=0.3;}
      else if(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&b.v.z>0.2&&g.rallyBounces.some(s=>s>0)&&b.p.z>0.55&&b.p.z<1.15){const q=aim();ges={t0:g.time,x0:q.x,y0:q.y};pdown(q.x,q.y);cool=0.3;}}
    cool-=DT; g.update(DT);
    if(i>120*8 && g.state==='RALLY' && g.ball.live && g.ball.p.z<0.2 && g.ball.p.z>-0.9 && g.rally>=1) break;
  }
  return {score:g.score,state:g.state,rally:g.rally,ball:{...g.ball.p},shots:g.stats.shots};
});
console.log('frozen at', JSON.stringify(info));
await new Promise(r=>setTimeout(r,900));
await page.screenshot({path:'/home/user/tt/shots/21_rally.png'});
// swipe overlay + camera variants
await page.evaluate(()=>{ const g=window.__game; g.settings.camera='DYNAMIC'; });
await new Promise(r=>setTimeout(r,700)); await page.screenshot({path:'/home/user/tt/shots/22_dynamic.png'});
await page.evaluate(()=>{ const g=window.__game; g.settings.camera='LOW'; });
await new Promise(r=>setTimeout(r,700)); await page.screenshot({path:'/home/user/tt/shots/23_low.png'});
await page.evaluate(()=>{ document.getElementById('guide').classList.add('on'); });
await new Promise(r=>setTimeout(r,500)); await page.screenshot({path:'/home/user/tt/shots/24_guide.png'});
await br.close();})();
