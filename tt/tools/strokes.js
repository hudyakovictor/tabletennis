/* Stroke matrix. Forces every archetype through the real swipe->racket->
   impact->flight pipeline and reports what physically comes out. */
const puppeteer=require('puppeteer');
(async()=>{const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage();p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});await new Promise(r=>setTimeout(r,1600));
const rows=await p.evaluate(()=>{
 const real=classifyStroke; let FORCE='DRIVE';
 classifyStroke=(m,ctx,sp)=>({id:FORCE,col:'#fff',name:FORCE});
 const out=[];
 for(const id of Object.keys(ARCH)){
  FORCE=id;
  const serve=id.indexOf('SERVE')===0;
  const r={id,n:0,speed:0,spin:0,top:0,side:0,inn:0,net:0,lng:0,depth:0,clear:0};
  for(let k=0;k<36;k++){
   const back=!!ARCH[id].back;
   // a plausible gesture for this archetype: up for drives, down for chops
   const ang=(back?-1:1)*(0.55+Math.random()*0.75);
   // a sidespin stroke IS a sideways gesture — keep that coupling honest
   const lateral=/HOOK|FADE|SERVE_SIDE/.test(id)
     ? (id==='FADE'?-1:1)*(0.62+Math.random()*0.30)
     : Math.sin((k%6-2.5)*0.20)*0.45;
   const m=Object.assign(new SwipeTracker().blankMetrics(),{
     right:lateral,up:Math.sin(ang),dist:0.26+Math.random()*0.22,
     curl:(Math.random()-0.5)*0.9,straightness:0.82,smooth:0.84,samples:14,
     releaseSpeed:2.0+Math.random()*2.0,peakSpeed:2.6+Math.random()*2.2});
   const ctx={side:1,isServe:serve,ball:{x:0.08,y:PH.TABLE_Y+(serve?0.18:0.16),z:1.40},
     ballSpin:{x:-130,y:8,z:0},ballVel:{x:-0.2,y:1.1,z:7.2},incomingTop:130};
   const rk=deriveStroke(m,ctx); if(!rk) continue;
   const v={x:-0.2,y:1.1,z:7.2}, w={x:-130,y:8,z:0};
   if(serve){v.x=0;v.y=-2.2;v.z=0;w.x=0;w.y=0;w.z=0;}
   const info=impactRacket(v,w,rk.normal,rk.vR,rk.quality,rk.rubber||{});
   if(!info) continue;
   const P={x:ctx.ball.x,y:ctx.ball.y,z:ctx.ball.z};
   const o=predict({x:P.x,y:P.y,z:P.z},{x:v.x,y:v.y,z:v.z},{x:w.x,y:w.y,z:w.z},
     {dt:1/480,maxT:3.0,stopOnFirstBounce:true});
   r.n++; r.speed+=Math.hypot(v.x,v.y,v.z)*3.6; r.spin+=Math.hypot(w.x,w.y,w.z)/TAU;
   r.top+=-w.x/TAU; r.side+=w.y/TAU;
   if(o.netCross) r.clear+=o.netCross.y-PH.NET_TOP;
   if(o.hitNet) r.net++;
   else if(o.landed&&o.landed.z<0&&o.landed.z>-PH.T_HALF_LEN-0.02&&Math.abs(o.landed.x)<=PH.T_HALF_WID+0.02){r.inn++;r.depth+=-o.landed.z;}
   else r.lng++;
  }
  out.push(r);
 }
 classifyStroke=real; return out;});
console.log('удар          n   км/ч  об/с    топ    бок |  IN%  сет  аут | глуб  надсет');
for(const r of rows){ if(!r.n){console.log(r.id.padEnd(12),'нет контакта');continue;}
 const f=(v,d=0)=>(v/r.n).toFixed(d);
 console.log(r.id.padEnd(12), String(r.n).padStart(2),
  f(r.speed,1).padStart(6), f(r.spin,0).padStart(5), f(r.top,0).padStart(6), f(r.side,0).padStart(6),
  '|', ((r.inn/r.n*100).toFixed(0)+'%').padStart(5), String(r.net).padStart(4), String(r.lng).padStart(4),
  '|', (r.inn?(r.depth/r.inn).toFixed(2):'  -  ').padStart(5), f(r.clear,2).padStart(6));}
await br.close();})();
