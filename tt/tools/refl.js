const puppeteer=require('puppeteer');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage(); await p.setViewport({width:1280,height:760});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await p.evaluate(()=>{
  document.querySelectorAll('.screen').forEach(e=>e.classList.remove('on'));
  const g=window.__game; g.startMatch(2); g.paused=true;
  for(let i=0;i<120;i++) g.update(1/120);
  // freeze a staged pose: ball low over the near half, bat beside it
  g.state='RALLY'; g.ball.live=true; g.isServeBall=false;
  V3.set(g.ball.p, -0.18, PH.TABLE_Y+0.10, 0.55); V3.set(g.ball.v,0.2,0.6,2.4); V3.set(g.ball.w,-180,0,0);
  V3.set(g.player.pos, 0.34, PH.TABLE_Y+0.16, 1.30);
  V3.set(g.aiPaddle.pos, -0.20, PH.TABLE_Y+0.18, -1.40);
  g.render();
});
await new Promise(r=>setTimeout(r,400));
await p.screenshot({path:'/home/user/tt/shots/r1_gloss.png'});
await br.close();})();
