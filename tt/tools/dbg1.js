const puppeteer=require('puppeteer');
(async()=>{const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});await new Promise(r=>setTimeout(r,1500));
console.log(await p.evaluate(()=>{
 const m={right:0.1,up:0.8,dist:0.32,curl:0.1,straightness:0.82,samples:14,releaseSpeed:3.0,peakSpeed:3.4};
 const ctx={side:1,isServe:false,ball:{x:0.08,y:PH.TABLE_Y+0.16,z:1.40},ballSpin:{x:-130,y:8,z:0},ballVel:{x:-0.2,y:1.1,z:7.2},incomingTop:130};
 const rk=deriveStroke(m,ctx);
 const v={x:-0.2,y:1.1,z:7.2}, w={x:-130,y:8,z:0};
 const before=Math.hypot(v.x,v.y,v.z);
 const info=impactRacket(v,w,rk.normal,rk.vR,rk.quality,rk.rubber||{});
 return JSON.stringify({id:rk.stroke&&rk.stroke.id,vmag:rk.vmag,n:rk.normal,vR:rk.vR,q:rk.quality,
   before:+before.toFixed(2), after:+Math.hypot(v.x,v.y,v.z).toFixed(2), info:info?Object.keys(info):null},null,1);}));
await br.close();})();
