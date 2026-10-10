const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await browser.newPage(); await page.setViewport({width:900,height:600});
page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('file://'+path.resolve('/home/user/table-tennis-topspin.html'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1500)); await page.click('#play'); await new Promise(r=>setTimeout(r,400));
const out=await page.evaluate(()=>{
  const g=window.__game; g.paused=true; const DT=1/120; const L=[];
  // log every plane crossing, hit or miss
  const osw=g.sweepPaddle.bind(g);
  g.sweepPaddle=(pad,p0,p1,radius)=>{
    const n=pad.normal;
    const d0=(p0.x-pad.prevPos.x)*n.x+(p0.y-pad.prevPos.y)*n.y+(p0.z-pad.prevPos.z)*n.z;
    const d1=(p1.x-pad.pos.x)*n.x+(p1.y-pad.pos.y)*n.y+(p1.z-pad.pos.z)*n.z;
    const r=osw(pad,p0,p1,radius);
    if(d0>0.02&&d1<=0.02&&L.length<60){
      L.push(`cross t=${g.time.toFixed(2)} ball=(${p1.x.toFixed(2)},${p1.y.toFixed(2)},${p1.z.toFixed(2)}) pad=(${pad.pos.x.toFixed(2)},${pad.pos.y.toFixed(2)},${pad.pos.z.toFixed(2)}) R=${radius.toFixed(3)} ${r?'HIT rad='+r.rad.toFixed(3):'MISS dx='+(p1.x-pad.pos.x).toFixed(2)+' dy='+(p1.y-pad.pos.y).toFixed(2)}`);
    }
    return r;
  };
  const pdown=(x,y)=>{g.swipe.down(x,y,g.time);g.pointer={x,y};g.pointerDown=true;if(g.state==='SERVE_READY'&&g.server===1)g.startToss();};
  const pmove=(x,y)=>{g.pointer={x,y};if(g.swipe.active)g.swipe.move(x,y,g.time);};
  const pup=()=>{if(!g.swipe.active)return;g.swipe.up(g.pointer.x,g.pointer.y,g.time);g.pointerDown=false;g.swipeReleasedAt=g.time;};
  let ges=null,cool=0;
  for(let i=0;i<120*45;i++){
    if(ges){const el=g.time-ges.t0,s=Math.min(1,el/0.14);pmove(0.5+0.02*s,0.72-0.36*s);if(s>=1){pup();ges=null;}}
    if(!ges&&cool<=0){const b=g.ball;
      if(g.state==='SERVE_READY'&&g.server===1){ges={t0:g.time};pdown(0.5,0.72);cool=0.3;}
      else if(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&b.v.z>0.2&&b.p.z>0.4&&b.p.z<1.2){ges={t0:g.time};pdown(0.5,0.72);cool=0.4;}}
    cool-=DT; g.update(DT);
  }
  return {L, posAssist:g.settings.posAssist, assist:g.settings.assist, score:g.score};
});
console.log(out.L.join('\n')); console.log('posAssist',out.posAssist,'assist',out.assist,'score',out.score);
await browser.close();})();
