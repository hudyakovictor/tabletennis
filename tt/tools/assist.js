/* Aim-assist stress: fire sloppy real gestures through the full
   swipe -> refineRacket -> impact -> flight path and count what lands. */
const puppeteer=require('puppeteer');
(async()=>{const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});await new Promise(r=>setTimeout(r,1600));
const rows=await p.evaluate(()=>{
 const res=[];
 for(const assist of [0,0.25,0.5,0.72,1.0]){
  let inn=0,net=0,lng=0,n=0,sp=0,spin=0;
  for(let k=0;k<400;k++){
   const m=Object.assign(new SwipeTracker().blankMetrics(),{
     right:(Math.random()-0.5)*1.1,up:0.25+Math.random()*0.72,dist:0.18+Math.random()*0.34,
     curl:(Math.random()-0.5)*1.2,straightness:0.6+Math.random()*0.4,smooth:0.6+Math.random()*0.4,
     samples:10+(Math.random()*10|0),releaseSpeed:1.2+Math.random()*3.0,peakSpeed:1.8+Math.random()*3.2,
     x:0.2+Math.random()*0.6,y:0.4+Math.random()*0.3});
   const P={x:(Math.random()-0.5)*1.0,y:PH.TABLE_Y+0.08+Math.random()*0.30,z:1.30+Math.random()*0.30};
   const ctx={side:1,isServe:false,ball:P,ballSpin:{x:-100-Math.random()*300,y:0,z:0},
     ballVel:{x:0,y:1.0,z:6.5+Math.random()*4},incomingTop:100};
   const rk=deriveStroke(m,ctx); if(!rk) continue;
   const v={x:ctx.ballVel.x,y:ctx.ballVel.y,z:ctx.ballVel.z},w={x:ctx.ballSpin.x,y:0,z:0};
   const rk2=refineRacket(P,v,w,rk,assist,rk.quality)||rk;
   const info=impactRacket(v,w,rk2.normal,rk2.vR,rk2.quality,rk2.rubber||{}); if(!info) continue;
   const o=predict({x:P.x,y:P.y,z:P.z},{x:v.x,y:v.y,z:v.z},{x:w.x,y:w.y,z:w.z},
     {dt:1/480,maxT:3.0,stopOnFirstBounce:true});
   n++; sp+=Math.hypot(v.x,v.y,v.z)*3.6; spin+=Math.hypot(w.x,w.y,w.z)/TAU;
   if(o.hitNet) net++;
   else if(o.landed&&o.landed.z<0&&o.landed.z>=-PH.T_HALF_LEN&&Math.abs(o.landed.x)<=PH.T_HALF_WID) inn++;
   else lng++;
  }
  res.push({assist,n,inn:+(inn/n*100).toFixed(1),net:+(net/n*100).toFixed(1),lng:+(lng/n*100).toFixed(1),
    sp:+(sp/n).toFixed(1),spin:+(spin/n).toFixed(0)});
 }
 return res;});
console.log('помощь   n    IN%   сетка%   аут%  | ср.км/ч  ср.об/с');
for(const r of rows) console.log(String(r.assist).padEnd(7), String(r.n).padStart(3),
 String(r.inn).padStart(6), String(r.net).padStart(7), String(r.lng).padStart(7), '|',
 String(r.sp).padStart(7), String(r.spin).padStart(8));
await br.close();})();
