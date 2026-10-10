// synthesize gestures and check the resulting shots
function gesture(pts, dur){
  const t=new SwipeTracker(); let t0=0;
  const n=pts.length;
  for(let i=0;i<n;i++){
    const tt=t0+dur*i/(n-1);
    if(i===0)t.down(pts[i][0],pts[i][1],tt); else t.move(pts[i][0],pts[i][1],tt);
  }
  return t.up(pts[n-1][0],pts[n-1][1],t0+dur);
}
function lineG(x0,y0,x1,y1,dur,steps=16,bend=0){
  const p=[];
  for(let i=0;i<=steps;i++){const s=i/steps;
    const nx=-(y1-y0),ny=(x1-x0); const bl=Math.hypot(nx,ny)||1;
    const off=bend*Math.sin(Math.PI*s);
    p.push([x0+(x1-x0)*s+nx/bl*off, y0+(y1-y0)*s+ny/bl*off]);}
  return gesture(p,dur);
}
const ballCtx=(y,z,vz,spinX)=>({side:1,ball:{y,z,vz,spinX},ballSpin:{x:spinX,y:0,z:0},ballSpeed:Math.abs(vz)});

const tests=[
 ['swipe UP fast (loop)',       lineG(0.5,0.80,0.52,0.42,0.13), ballCtx(PH.TABLE_Y+0.12,1.25,6,-120)],
 ['swipe UP slow (lob)',        lineG(0.5,0.80,0.51,0.52,0.42), ballCtx(PH.TABLE_Y+0.10,1.30,5,-80)],
 ['swipe FORWARD-UP 45 fast',   lineG(0.42,0.80,0.66,0.52,0.12), ballCtx(PH.TABLE_Y+0.22,1.25,7,-150)],
 ['swipe FLAT fast, high ball', lineG(0.38,0.62,0.74,0.60,0.10), ballCtx(PH.TABLE_Y+0.42,1.20,5,-60)],
 ['swipe DOWN med (push)',      lineG(0.5,0.50,0.52,0.70,0.18), ballCtx(PH.TABLE_Y+0.09,1.15,5,60)],
 ['swipe DOWN long fast (chop)',lineG(0.5,0.38,0.53,0.86,0.15), ballCtx(PH.TABLE_Y+0.05,1.95,8,-300)],
 ['tiny swipe (block)',         lineG(0.5,0.70,0.515,0.685,0.09), ballCtx(PH.TABLE_Y+0.15,1.25,11,-420)],
 ['swipe RIGHT curved (hook)',  lineG(0.30,0.70,0.78,0.60,0.12,16,0.07), ballCtx(PH.TABLE_Y+0.16,1.25,6,-100)],
 ['swipe LEFT curved (fade)',   lineG(0.72,0.70,0.24,0.60,0.12,16,-0.07), ballCtx(PH.TABLE_Y+0.16,1.25,6,-100)],
];
console.log('gesture                         | stroke   | pwr | racket v (m/s)        |speed| face normal             | aim x/z');
console.log('-'.repeat(132));
for(const [name,m,ctx] of tests){
  const s=deriveStroke(m,ctx);
  const f=(v,d=2)=>v.toFixed(d).padStart(6);
  console.log(name.padEnd(31)+' | '+s.stroke.short.padEnd(8)+' |'+s.power.toFixed(2).padStart(5)+' | ('+f(s.vR.x)+','+f(s.vR.y)+','+f(s.vR.z)+') |'+s.vmag.toFixed(1).padStart(5)+'| ('+f(s.normal.x)+','+f(s.normal.y)+','+f(s.normal.z)+') | '+s.aim.x.toFixed(2)+' / '+s.aim.z.toFixed(2));
}

console.log('\n== resulting BALL state after the physical impact ==');
console.log('gesture                         | stroke | out speed  | topspin rev/s | side rev/s | lands (x,z) | net clear | VERDICT');
console.log('-'.repeat(132));
for(const [name,m,ctx] of tests){
  const s=deriveStroke(m,ctx);
  const bp=V3.new(0.05,ctx.ball.y,ctx.ball.z);
  const bv=V3.new(0,-1.2,ctx.ball.vz);
  const bw=V3.new(ctx.ball.spinX,0,0);
  const r=refineRacket(bp,bv,bw,s,0.95,s.quality);
  const v=V3.clone(bv),w=V3.clone(bw);
  impactRacket(v,w,r.normal,r.vR,s.quality,r.rubber||{});
  const o=predict(V3.clone(bp),V3.clone(v),V3.clone(w),{dt:1/400,maxT:2.5,stopOnFirstBounce:true});
  const topspin=-w.x/6.2832, side=w.y/6.2832;
  const land=o.landed?('('+o.landed.x.toFixed(2)+','+o.landed.z.toFixed(2)+')'):(o.hitNet?'NET':'OUT');
  const clear=o.netCross?((o.netCross.y-PH.NET_TOP)*100).toFixed(1)+'cm':'-';
  let verdict='ok';
  if(o.hitNet)verdict='! net';
  else if(!o.landed)verdict='! long';
  else if(o.landed.z>0)verdict='! own half';
  console.log(name.padEnd(31)+' | '+s.stroke.short.padEnd(6)+' | '+(V3.len(v)*3.6).toFixed(1).padStart(6)+' km/h |'+topspin.toFixed(0).padStart(10)+'     |'+side.toFixed(0).padStart(9)+'   | '+land.padEnd(11)+' | '+clear.padStart(8)+' | '+verdict);
}
