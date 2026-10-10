const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const b=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await b.newPage(); page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('file://'+path.resolve('/home/user/table-tennis-topspin.html'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,1500)); await page.click('#play'); await new Promise(r=>setTimeout(r,300));
const out=await page.evaluate(()=>{
  const g=window.__game; g.paused=true;
  const P=window.PH||g.constructor.PH;
  const res=[];
  // directly exercise the serve solver over the gesture space
  const gestures=[
    ['up slow',   {right:0.05,up:0.95,dist:0.30,speed:1.8,peakSpeed:2.2,releaseSpeed:1.8,curl:0.1,smooth:.9,straightness:.95,samples:14,x:0.5,y:0.5}],
    ['up fast',   {right:0.05,up:0.95,dist:0.42,speed:3.9,peakSpeed:4.3,releaseSpeed:3.9,curl:0.1,smooth:.9,straightness:.95,samples:14,x:0.5,y:0.5}],
    ['down',      {right:0.0,up:-0.98,dist:0.33,speed:2.4,peakSpeed:2.8,releaseSpeed:2.4,curl:0.05,smooth:.9,straightness:.95,samples:14,x:0.5,y:0.5}],
    ['side curl', {right:0.85,up:0.40,dist:0.30,speed:2.6,peakSpeed:3.0,releaseSpeed:2.6,curl:1.6,smooth:.85,straightness:.7,samples:16,x:0.5,y:0.5}],
    ['flat fast', {right:0.12,up:0.30,dist:0.40,speed:4.4,peakSpeed:4.8,releaseSpeed:4.4,curl:0.0,smooth:.95,straightness:.98,samples:12,x:0.5,y:0.5}],
  ];
  const ballP={x:0,y:0.76+0.20,z:1.44}, ballV={x:0,y:-1.6,z:0}, ballW={x:0,y:0,z:0};
  for(const [name,m] of gestures){
    for(const assist of [0.4,0.72,1.0]){
      const ctx={side:1,isServe:true,ball:{y:ballP.y,z:ballP.z},ballSpin:ballW,ballSpeed:1.6};
      const st=deriveStroke(m,ctx);
      const r=refineRacket(ballP,ballV,ballW,st,assist,st.quality);
      const v={...ballV},w={...ballW};
      const inf=impactRacket(v,w,r.normal,r.vR,r.quality,r.rubber||{});
      const rep={};
      predict({...ballP},{x:v.x,y:v.y,z:v.z},{x:w.x,y:w.y,z:w.z},{dt:1/480,maxT:2.6,out:rep});
      res.push(`${name.padEnd(10)} a=${assist} ${st.stroke.id.padEnd(11)} v=${Math.hypot(v.x,v.y,v.z).toFixed(1)}m/s spin=${(Math.hypot(w.x,w.y,w.z)/6.283).toFixed(0)}rps `+
        `b1=${rep.landed?('('+rep.landed.x.toFixed(2)+','+rep.landed.z.toFixed(2)+')'):'--'} net=${rep.hitNet?'YES':'no'} b2=${rep.b2?('('+rep.b2.x.toFixed(2)+','+rep.b2.z.toFixed(2)+')'):'--'} ${r.valid?'OK':'BAD'}`);
    }
  }
  return res;
});
console.log(out.join('\n'));
await b.close();})();
