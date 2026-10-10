const puppeteer=require('puppeteer');
const S='/home/user/tt/shots/';
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const errs=[];
async function shot(w,h,name,setup){
  const p=await br.newPage(); await p.setViewport({width:w,height:h,deviceScaleFactor:1});
  p.on('pageerror',e=>errs.push(name+': '+e.message));
  await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
  await new Promise(r=>setTimeout(r,2200));
  if(setup) await setup(p);
  await new Promise(r=>setTimeout(r,650));
  await p.screenshot({path:S+name+'.png'});
  await p.close();
}
const stepTo=(n,live)=>async(p)=>{
  await p.click('#train0'); await new Promise(r=>setTimeout(r,500));
  await p.evaluate(({n,live})=>{
    const g=window.__game; g.training.goStep(n);
    if(live){ g.paused=true; g.training.phase='wait'; g.training.t=1; 
      for(let i=0;i<120*1.2;i++) g.update(1/120); }
  },{n,live});
};
await shot(1280,760,'t0_menu');
await shot(1280,760,'t1_coach_serve',stepTo(0,false));
await shot(1280,760,'t2_coach_topspin',stepTo(1,true));
await shot(1280,760,'t3_coach_side',stepTo(3,false));
await shot(1280,760,'t4_settings',async p=>{await p.click('#play');await new Promise(r=>setTimeout(r,400));await p.click('#btnSettings');});
await shot(430,880,'t5_mobile_menu');
await shot(430,880,'t6_mobile_coach',stepTo(1,true));
await shot(880,430,'t7_land_coach',stepTo(1,true));
await shot(430,880,'t8_mobile_rally',async p=>{
  await p.click('#play'); await new Promise(r=>setTimeout(r,400));
  await p.evaluate(()=>{const g=window.__game;g.paused=true;for(let i=0;i<120*4;i++)g.update(1/120);});
});
console.log(errs.length?errs.join('\n'):'clean');
await br.close();})();
