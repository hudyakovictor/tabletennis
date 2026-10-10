const puppeteer=require('puppeteer');
const S='/home/user/tt/shots/';
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const errs=[];
const shot=async(w,h,name,fn)=>{
  const p=await br.newPage(); await p.setViewport({width:w,height:h});
  p.on('pageerror',e=>errs.push(name+': '+e.message));
  await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,2200));
  if(fn) await fn(p);
  await new Promise(r=>setTimeout(r,500));
  await p.screenshot({path:S+name+'.png'});
  await p.close();
};
const play=async(p,y,pi,z)=>{
  await p.evaluate(({y,pi,z})=>{document.querySelectorAll('.screen').forEach(e=>e.classList.remove('on'));
    const g=window.__game; g.startMatch(2); g.paused=true;
    for(let i=0;i<200;i++) g.update(1/120);
    g.camAdj.yaw=-y*Math.PI/180; g.camAdj.pitch=pi*Math.PI/180; g.camAdj.zoom=z; g.camAdjT=1.4; g.ui.syncCam();
    for(let i=0;i<140;i++) g.update(1/120);
    g.render();},{y,pi,z});
};
await shot(1280,760,'d1_orbit45',p=>play(p,45,10,1.18));
await shot(1280,760,'d2_lowclose',p=>play(p,-14,-20,0.72));
await shot(1280,760,'d3_top',p=>play(p,0,46,1.25));
await shot(1280,760,'d4_settings',async p=>{await p.click('#play');await new Promise(r=>setTimeout(r,400));await p.click('#btnSettings');});
await shot(430,880,'d5_m_settings',async p=>{await p.click('#play');await new Promise(r=>setTimeout(r,400));await p.click('#btnSettings');
  await p.evaluate(()=>{const c=document.querySelector('#settings .card');c.scrollTop=c.scrollHeight*0.42;});});
console.log(errs.length?errs.join('\n'):'clean');
await br.close();})();
