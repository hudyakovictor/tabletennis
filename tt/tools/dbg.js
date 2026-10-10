function g(pts,dur){const t=new SwipeTracker();for(let i=0;i<pts.length;i++){const tt=dur*i/(pts.length-1);
 if(i===0)t.down(pts[i][0],pts[i][1],tt);else t.move(pts[i][0],pts[i][1],tt);}return t.up(pts[pts.length-1][0],pts[pts.length-1][1],dur);}
function lineG(x0,y0,x1,y1,dur,steps=16,bend=0){const p=[];for(let i=0;i<=steps;i++){const s=i/steps;
 const nx=-(y1-y0),ny=(x1-x0);const bl=Math.hypot(nx,ny)||1;const off=bend*Math.sin(Math.PI*s);
 p.push([x0+(x1-x0)*s+nx/bl*off,y0+(y1-y0)*s+ny/bl*off]);}return g(p,dur);}

const cases=[
 ['HOOK', lineG(0.30,0.70,0.78,0.60,0.12,16,0.07), {y:PH.TABLE_Y+0.16,z:1.25,vz:6,sx:-100}],
 ['CHOP', lineG(0.5,0.38,0.53,0.86,0.15), {y:PH.TABLE_Y+0.05,z:1.95,vz:8,sx:-300}],
 ['BLOCK',lineG(0.5,0.70,0.515,0.685,0.09), {y:PH.TABLE_Y+0.15,z:1.25,vz:11,sx:-420}],
];
for(const [nm,m,bc] of cases){
  const ctx={side:1,ball:{y:bc.y,z:bc.z},ballSpin:{x:bc.sx,y:0,z:0},ballSpeed:bc.vz};
  const s=deriveStroke(m,ctx);
  const bp=V3.new(0.05,bc.y,bc.z),bv=V3.new(0,-1.2,bc.vz),bw=V3.new(bc.sx,0,0);
  console.log('\n--- '+nm+' --- stroke='+s.stroke.short+' elev='+s.elev.toFixed(1)+' contact='+s.contact.toFixed(1)+' vmag='+s.vmag.toFixed(1)+' aim=('+s.aim.x.toFixed(2)+','+s.aim.z.toFixed(2)+')');
  const r=refineRacket(bp,bv,bw,s,0.85,s.quality);
  const rr=s.rawReport;
  console.log('  raw: landed='+(rr.landed?'('+rr.landed.x.toFixed(2)+','+rr.landed.z.toFixed(2)+')':(rr.hitNet?'NET':'OUT'))+' planeCross='+(rr.planeCross?'('+rr.planeCross.x.toFixed(2)+','+rr.planeCross.z.toFixed(2)+')':'-'));
  console.log('  blended target=('+(r.target?r.target.x.toFixed(2)+','+r.target.z.toFixed(2):'-')+')  dE='+(r.dElev*180/Math.PI).toFixed(1)+'deg dA='+(r.dAz*180/Math.PI).toFixed(1)+'deg sc='+(r.scale||1).toFixed(2)+' damp='+(r.damp||1).toFixed(2)+' solErr='+(r.solved?r.solved.err.toFixed(3):'-'));
  const v=V3.clone(bv),w=V3.clone(bw); impactRacket(v,w,r.normal,r.vR,s.quality,r.rubber||{});
  const o=predict(V3.clone(bp),V3.clone(v),V3.clone(w),{dt:1/400,maxT:2.5,stopOnFirstBounce:true});
  console.log('  FINAL: v='+(V3.len(v)*3.6).toFixed(1)+'km/h spin='+(V3.len(w)/6.2832).toFixed(0)+'rev/s land='+(o.landed?'('+o.landed.x.toFixed(2)+','+o.landed.z.toFixed(2)+')':(o.hitNet?'NET':'OUT ->'+(o.planeCross?o.planeCross.z.toFixed(2):'?')))+' clear='+(o.netCross?((o.netCross.y-PH.NET_TOP)*100).toFixed(1):'-')+'cm');
  if(r.solved) console.log('  solved want v=('+r.solved.vx.toFixed(2)+','+r.solved.vy.toFixed(2)+','+r.solved.vz.toFixed(2)+') |'+Math.hypot(r.solved.vx,r.solved.vy,r.solved.vz).toFixed(2)+'|  got v=('+v.x.toFixed(2)+','+v.y.toFixed(2)+','+v.z.toFixed(2)+')');
}
