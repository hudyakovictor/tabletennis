const puppeteer=require('puppeteer');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage(); await p.setViewport({width:1280,height:760});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
p.on('console',async m=>{const a=[];for(const h of m.args()){try{a.push(await h.evaluate(v=>v&&v.stack?v.stack:String(v)));}catch(e){a.push('?');}}console.log(m.type().toUpperCase(),a.join(' '));});
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2500));
console.log('game?',await p.evaluate(()=>!!window.__game));
await br.close();})();
