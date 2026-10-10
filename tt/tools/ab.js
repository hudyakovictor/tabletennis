const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await br.newPage(); await page.setViewport({width:1280,height:760});
page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('file://'+path.resolve('/home/user/table-tennis-topspin.html'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2000)); await page.click('#play'); await new Promise(r=>setTimeout(r,1500));
for (const [name,fn] of [['A_base',()=>{}],
                         ['B_noCA',()=>{window.__game.R.post.ca=0;}],
                         ['C_noBloom',()=>{window.__game.R.post.ca=0;window.__game.R.post.bloom=0;}],
                         ['D_noGrain',()=>{window.__game.R.post.ca=0;window.__game.R.post.bloom=0;window.__game.R.post.grain=0;}]]) {
  await page.evaluate(fn); await new Promise(r=>setTimeout(r,700));
  await page.screenshot({path:'/home/user/tt/shots/ab_'+name+'.png'});
}
await br.close();})();
