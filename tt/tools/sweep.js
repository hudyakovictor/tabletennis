const puppeteer=require('puppeteer');const path=require('path');
const F='file://'+path.resolve('/home/user/table-tennis-topspin.html');
const LAUNCH={headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']};
(async()=>{
const br=await puppeteer.launch(LAUNCH);
// --- desktop: settings + match end ---------------------------------
let page=await br.newPage(); await page.setViewport({width:1280,height:760});
page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto(F,{waitUntil:'load'}); await new Promise(r=>setTimeout(r,2000));
await page.click('#play'); await new Promise(r=>setTimeout(r,500));
await page.evaluate(()=>{ document.getElementById('settings').classList.add('on'); });
await new Promise(r=>setTimeout(r,600)); await page.screenshot({path:'/home/user/tt/shots/30_settings.png'});
await page.evaluate(()=>{ document.getElementById('settings').classList.remove('on'); });
// force a finished match with plausible stats
await page.evaluate(()=>{
  const g=window.__game;
  g.score=[11,8]; g.stats.shots=146; g.stats.winners=11; g.stats.errors=8;
  g.stats.maxSpeed=104.6; g.stats.maxSpin=168; g.stats.totalSpin=146*63; g.stats.rallies=19;
  g.bestRally=14; g.stats.byStroke={LOOP:41,DRIVE:22,BLOCK:28,PUSH:14,SMASH:7,CHOP:5,HOOK:6,FADE:4,LOB:3,FLICK:5,DROP:2,SERVE_TOP:9};
  g.matchWinner=1; g.setState('MATCH_END'); window.__ui&&window.__ui.showMatchEnd(true);
  const u=g.ui; u&&u.showMatchEnd(true);
});
await new Promise(r=>setTimeout(r,900)); await page.screenshot({path:'/home/user/tt/shots/31_over.png'});
await page.close();
// --- mobile portrait ------------------------------------------------
page=await br.newPage();
await page.setViewport({width:412,height:892,deviceScaleFactor:2,isMobile:true,hasTouch:true});
await page.goto(F,{waitUntil:'load'}); await new Promise(r=>setTimeout(r,2200));
await page.screenshot({path:'/home/user/tt/shots/40_m_menu.png'});
await page.click('#play'); await new Promise(r=>setTimeout(r,2500));
await page.screenshot({path:'/home/user/tt/shots/41_m_game.png'});
await page.close();
// --- mobile landscape ------------------------------------------------
page=await br.newPage();
await page.setViewport({width:892,height:412,deviceScaleFactor:2,isMobile:true,hasTouch:true});
await page.goto(F,{waitUntil:'load'}); await new Promise(r=>setTimeout(r,2200));
await page.screenshot({path:'/home/user/tt/shots/42_m_land_menu.png'});
await page.click('#play'); await new Promise(r=>setTimeout(r,2500));
await page.screenshot({path:'/home/user/tt/shots/43_m_land.png'});
await br.close();
console.log('ok');})();
