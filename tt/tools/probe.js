const puppeteer=require('puppeteer');
(async()=>{const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage();await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});await new Promise(r=>setTimeout(r,1500));
console.log(await p.evaluate(()=>{const g=window.__game;
 const r=g.analyst.analyse(g.recorder,1,'СОПЕРНИК НЕ ПЕРЕЛЕТЕЛ',g);
 return JSON.stringify({key:r.key,text:r.text, ctor:g.analyst.constructor.name, fn:String(g.analyst.analyse).slice(0,200)});}));
await br.close();})();
