const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const browser=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--window-size=1280,760']});
const page=await browser.newPage(); await page.setViewport({width:1280,height:760});
page.on('pageerror',e=>console.log('[PAGEERROR]',e.message));
await page.goto('file://'+path.resolve('/home/user/table-tennis-topspin.html'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1800));
await page.click('#play'); await new Promise(r=>setTimeout(r,600));
await page.evaluate(()=>{
  const g=window.__game, T=window.__T=[];
  const os=g.setState.bind(g); g.setState=(s)=>{T.push('ST->'+s+' @'+g.time.toFixed(2));os(s);};
  const oa=g.awardPoint.bind(g); g.awardPoint=(w,m)=>{T.push('PT w='+w+' "'+m+'"');oa(w,m);};
  const oh=g.tryPlayerHit.bind(g); g.tryPlayerHit=(...a)=>{const r=oh(...a); return r;};
  const ap=g.applyHit.bind(g); g.applyHit=(side,...a)=>{T.push('HIT side='+side);return ap(side,...a);};
  const ot=g.startToss.bind(g); g.startToss=()=>{T.push('TOSS @'+g.time.toFixed(2));ot();};
  let last='';
  window.__sample=setInterval(()=>{const b=g.ball;
    const k=`${g.state}|${g.server}|${b.live?1:0}|${b.lastHitBy}`;
    const line=`  t=${g.time.toFixed(2)} ${g.state} srv=${g.server} sT=${g.stateT.toFixed(2)} live=${b.live?1:0} lh=${b.lastHitBy} p=(${b.p.x.toFixed(2)},${b.p.y.toFixed(2)},${b.p.z.toFixed(2)}) v=(${b.v.x.toFixed(1)},${b.v.y.toFixed(1)},${b.v.z.toFixed(1)}) pad=(${g.player.pos.x.toFixed(2)},${g.player.pos.y.toFixed(2)},${g.player.pos.z.toFixed(2)})`;
    T.push(line); },180);
});
// drive both serves and rally returns
await page.evaluate(async()=>{
  const cv=document.getElementById('gl');const W=innerWidth,H=innerHeight;
  const pe=(t,x,y)=>cv.dispatchEvent(new PointerEvent(t,{pointerId:1,clientX:x,clientY:y,bubbles:true,isPrimary:true,pointerType:'mouse',button:0,buttons:t==='pointerup'?0:1}));
  const sl=ms=>new Promise(r=>setTimeout(r,ms));
  const g=window.__game;
  const x0=W*0.5,y0=H*0.70;
  async function hit(hold){ pe('pointerdown',x0,y0); if(hold)await sl(hold);
    for(let i=1;i<=12;i++){pe('pointermove',x0+i*2,y0-i*19);await sl(11);} pe('pointerup',x0+24,y0-228); }
  window.__drive=setInterval(async()=>{
    if(window.__busy)return; const b=g.ball;
    if(g.state==='SERVE_READY'&&g.server===1){window.__busy=1;await hit(250);window.__T.push('>>player serve');window.__busy=0;}
    else if(g.state==='RALLY'&&b.live&&b.lastHitBy===-1&&b.v.z>0.3&&b.p.z>0.5&&b.p.z<1.4){window.__busy=1;await hit(0);window.__T.push('>>player return');window.__busy=0;}
  },40);
});
await new Promise(r=>setTimeout(r,12000));
const T=await page.evaluate(()=>window.__T);
console.log(T.join('\n'));
await browser.close();})();
