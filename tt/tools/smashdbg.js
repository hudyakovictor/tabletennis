const puppeteer=require('puppeteer');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage(); await p.setViewport({width:1280,height:760});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2000));
const log=await p.evaluate(()=>{
  const g=window.__game; g.startTraining(); g.paused=true; const out=[];
  g.training.goStep(5);
  for(let i=0;i<120*12;i++){
    g.update(1/120);
    if(i%15===0){const W=g._strike,b=g.ball;
      out.push(`t=${g.time.toFixed(2)} ph=${g.training.phase} st=${g.state} live=${b.live} p=(${b.p.x.toFixed(2)},${b.p.y.toFixed(2)},${b.p.z.toFixed(2)}) v=(${b.v.x.toFixed(1)},${b.v.y.toFixed(1)},${b.v.z.toFixed(1)}) W=${W?W.on+'/'+W.kind+'/'+(W.t||0).toFixed(2):'-'}`);}
    if(g.training.phase==='fail'||g.training.phase==='ok') break;
  }
  return out;
});
console.log(log.join('\n'));
await br.close();})();
