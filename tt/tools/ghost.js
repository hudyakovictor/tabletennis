const puppeteer=require('puppeteer');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage(); await p.setViewport({width:1280,height:760});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await p.click('#train0'); await new Promise(r=>setTimeout(r,500));
console.log(await p.evaluate(()=>{
  const g=window.__game,u=g.ui;
  const probe=()=>{const c=u.fxg,W=u.fx.width,H=u.fx.height;
    const d=c.getImageData(0,0,W,H).data;let n=0;for(let i=3;i<d.length;i+=4*37)if(d[i]>6)n++;
    return n;};
  const out=[];
  for(const t of [0.0,0.3,0.6,0.9,1.2,1.5,1.8,2.1]){
    u.ghostT=t; u.drawOverlay(0);
    out.push('ghostT='+t+' px='+probe());
  }
  out.push('phase='+g.training.phase+' step='+g.training.step+' gesture='+JSON.stringify(g.training.S.gesture));
  return out.join('\n');
}));
await br.close();})();
