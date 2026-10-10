
console.log('\n== 11. RE-CHECK drop test + real loop geometry + smash cap ==');
{
  const p=V3.new(0,PH.TABLE_Y+0.305+PH.R,0),v=V3.new(0,0,0),w=V3.new(0,0,0);
  let dt=1/4000; while(p.y-PH.R>PH.TABLE_Y){integrateBall(p,v,w,dt);}
  const vi=-v.y; bounceTable(p,v,w); let maxY=p.y;
  while(v.y>0){integrateBall(p,v,w,dt); if(p.y>maxY)maxY=p.y;}
  console.log('  drop test rebound = '+((maxY-PH.R-PH.TABLE_Y)*100).toFixed(1)+' cm  (target ~23)');
}
{ // a REAL loop: closed face, strongly upward grazing swing
  const v=V3.new(0,-1.0,5.5), w=V3.new(-150,0,0);
  const n=V3.norm(V3.new(),V3.new(0,-0.34,-1));   // closed face
  const vR=V3.new(0,16.5,-12.0);                  // brush up & forward
  impactRacket(v,w,n,vR,1.0);
  console.log('  LOOP  -> speed '+(V3.len(v)*3.6).toFixed(1)+' km/h, spin '+(V3.len(w)/6.2832).toFixed(0)+' rev/s, vy='+v.y.toFixed(2));
}
{ // powerful but realistic smash
  const v=V3.new(0,-1.0,6.0), w=V3.new(-80,0,0);
  const n=V3.norm(V3.new(),V3.new(0,-0.25,-1));
  const vR=V3.new(0,-2.0,-18.0);
  impactRacket(v,w,n,vR,1.0);
  console.log('  SMASH -> speed '+(V3.len(v)*3.6).toFixed(1)+' km/h (world record ~112 km/h), spin '+(V3.len(w)/6.2832).toFixed(0)+' rev/s');
}
{ // heavy chop: open face, downward grazing
  const v=V3.new(0,-1.5,7.0), w=V3.new(-300,0,0);
  const n=V3.norm(V3.new(),V3.new(0,0.70,-1));
  const vR=V3.new(0,-11.0,-4.5);
  impactRacket(v,w,n,vR,1.0);
  console.log('  CHOP  -> speed '+(V3.len(v)*3.6).toFixed(1)+' km/h, spin wx='+w.x.toFixed(0)+' rad/s = '+(w.x/6.2832).toFixed(0)+' rev/s backspin, vy='+v.y.toFixed(2));
}
{ // sidespin hook: swing across to the right
  const v=V3.new(0,-1.0,6.0), w=V3.new(-100,0,0);
  const n=V3.norm(V3.new(),V3.new(-0.30,-0.10,-1));
  const vR=V3.new(9.0,6.0,-12.0);
  impactRacket(v,w,n,vR,1.0);
  console.log('  HOOK  -> v=('+v.x.toFixed(2)+','+v.y.toFixed(2)+','+v.z.toFixed(2)+')  w=('+w.x.toFixed(0)+','+w.y.toFixed(0)+','+w.z.toFixed(0)+')  sidespin wy='+(w.y/6.2832).toFixed(0)+' rev/s');
  // does it curve?
  const p=V3.new(0,0.95,1.3); const o=predict(p,v,w,{dt:1/600,maxT:2,stopOnFirstBounce:true});
  console.log('         lands at x='+(o.landed?o.landed.x.toFixed(3):'-')+' z='+(o.landed?o.landed.z.toFixed(2):'-')+'  (straight line would be x=0)');
}
