/* randomized stress test: 2500 gestures x random ball states */
function synth(){
  const t=new SwipeTracker();
  const sx=rnd(0.15,0.85), sy=rnd(0.25,0.9);
  const ang=rnd(0,TAU), len=rnd(0.03,0.55), dur=rnd(0.05,0.55);
  const bend=rndSym(0.1);
  const steps=Math.max(4,Math.round(dur*120));
  const ex=sx+Math.cos(ang)*len, ey=sy-Math.sin(ang)*len;
  for(let i=0;i<=steps;i++){
    const s=i/steps, tt=dur*s;
    const nx=-(ey-sy), ny=(ex-sx); const bl=Math.hypot(nx,ny)||1;
    const off=bend*Math.sin(Math.PI*s);
    const x=sx+(ex-sx)*s+nx/bl*off+rndSym(0.002), y=sy+(ey-sy)*s+ny/bl*off+rndSym(0.002);
    if(i===0)t.down(x,y,tt); else t.move(x,y,tt);
  }
  return t.up(sx+(ex-sx)+0,sy+(ey-sy),dur);
}
function randBall(){
  const y=PH.TABLE_Y+rnd(0.02,0.62), z=rnd(1.05,2.3);
  const vz=rnd(3,14), vy=rnd(-4,1.2);
  const sx=rndSym(700), sy=rndSym(350);
  return {p:V3.new(rndSym(0.6),y,z), v:V3.new(rndSym(2.2),vy,vz), w:V3.new(sx,sy,rndSym(120))};
}
const levels=[0,0.25,0.5,0.7,0.85,1.0];
console.log('assist |  IN   |  NET  | LONG  | OWN   | avg km/h | avg spin rev/s | p95 km/h | solver ms/hit');
console.log('-'.repeat(104));
for(const A of levels){
  let IN=0,NET=0,LONG=0,OWN=0,N=0; let spdSum=0,spinSum=0; const spds=[];
  const t0=process.hrtime.bigint();
  for(let i=0;i<1200;i++){
    const m=synth(); const b=randBall();
    const ctx={side:1,ball:{y:b.p.y,z:b.p.z},ballSpin:{x:b.w.x,y:b.w.y,z:b.w.z},ballSpeed:V3.len(b.v)};
    const st=deriveStroke(m,ctx);
    const r=refineRacket(b.p,b.v,b.w,st,A,st.quality);
    const v=V3.clone(b.v),w=V3.clone(b.w);
    impactRacket(v,w,r.normal,r.vR,st.quality,r.rubber||{});
    const o=predict(V3.clone(b.p),V3.clone(v),V3.clone(w),{dt:1/320,maxT:2.6,stopOnFirstBounce:true});
    N++;
    const kmh=V3.len(v)*3.6; spdSum+=kmh; spds.push(kmh); spinSum+=V3.len(w)/6.2832;
    if(o.hitNet)NET++; else if(!o.landed)LONG++; else if(o.landed.z>0)OWN++; else IN++;
  }
  const ms=Number(process.hrtime.bigint()-t0)/1e6/N;
  spds.sort((a,b)=>a-b);
  console.log(String(A).padEnd(6)+' |'+(100*IN/N).toFixed(1).padStart(6)+'%|'+(100*NET/N).toFixed(1).padStart(6)+'%|'+(100*LONG/N).toFixed(1).padStart(6)+'%|'+(100*OWN/N).toFixed(1).padStart(6)+'%|'+(spdSum/N).toFixed(1).padStart(9)+' |'+(spinSum/N).toFixed(0).padStart(15)+' |'+spds[Math.floor(N*0.95)].toFixed(1).padStart(9)+' |'+ms.toFixed(2).padStart(14));
}
