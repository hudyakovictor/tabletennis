const fs=require('fs');
global.window={};
eval(fs.readFileSync('src/10_math.js','utf8')+'\n'+fs.readFileSync('src/30_physics.js','utf8'));

const fmt=(n,d=3)=>Number(n).toFixed(d);
console.log('== constants ==');
console.log('area',PH.AREA.toExponential(3),'tableY',PH.TABLE_Y,'netTop',PH.NET_TOP);

// 1) terminal / drag sanity: ball fired horizontally, no spin
function flight(v0,w0,p0){
  const p=V3.clone(p0),v=V3.clone(v0),w=V3.clone(w0);
  let t=0,dt=1/2000; const pts=[];
  while(t<2.0 && p.y>0.01){ integrateBall(p,v,w,dt); t+=dt; pts.push([t,p.x,p.y,p.z]); }
  return {p,v,t,pts};
}
console.log('\n== 1. drag check: 20 m/s horizontal, no spin, from 1.0 m ==');
let r=flight(V3.new(0,0,-20),V3.new(0,0,0),V3.new(0,1.0,1.3));
console.log(' after flight t=',fmt(r.t),' end speed=',fmt(V3.len(r.v)),'m/s (lost '+fmt(100*(1-V3.len(r.v)/20),1)+'%)');

console.log('\n== 2. Magnus: topspin 100 rev/s (628 rad/s), 15 m/s forward ==');
// topspin travelling in -z: spin axis is +x ... check sign
// ball moving -z with topspin => top of ball moves in -z direction => w = (-1,0,0)*? 
// v=(0,0,-15). Magnus F ~ w x v. For downward force (dip) we need F_y<0.
for(const wx of [628,-628]){
  const p=V3.new(0,1.0,1.3),v=V3.new(0,0,-15),w=V3.new(wx,0,0);
  const a=V3.new(); aeroAccel(a,v,w);
  console.log('  w=('+wx+',0,0) -> accel y='+fmt(a.y,2)+' m/s2  (gravity alone -9.81) => '+(a.y<-9.81?'DIP (topspin)':'LIFT (backspin)'));
}
console.log('\n== 3. Magnus magnitude in g ==');
{const p=V3.new(0,1,1.3),v=V3.new(0,0,-15),w=V3.new(-628,0,0);const a=V3.new();aeroAccel(a,v,w);
console.log('  backspin lift = '+fmt((a.y+9.81)/9.81,2)+' g');}

console.log('\n== 4. table bounce, pure drop from 30.5 cm (ITTF test) ==');
{
  const p=V3.new(0,PH.TABLE_Y+0.305+PH.R,0),v=V3.new(0,0,0),w=V3.new(0,0,0);
  let dt=1/4000,t=0;
  while(p.y-PH.R>PH.TABLE_Y){integrateBall(p,v,w,dt);t+=dt;}
  const vimp=-v.y; bounceTable(p,v,w);
  let maxY=p.y; const v2=V3.clone(v);
  while(v.y>0){integrateBall(p,v,w,dt); if(p.y>maxY)maxY=p.y;}
  console.log('  impact v='+fmt(vimp,2)+' m/s, rebound v='+fmt(v2.y,2)+', height='+fmt((maxY-PH.R-PH.TABLE_Y)*100,1)+' cm  (ITTF spec: 24-26 cm)');
}

console.log('\n== 5. topspin bounce kick-forward test ==');
{
  const p=V3.new(0,PH.TABLE_Y+0.1,0.5),v=V3.new(0,-4,-10),w=V3.new(-500,0,0); // topspin moving -z
  const vin=V3.clone(v);
  bounceTable(p,v,w);
  console.log('  vz: '+fmt(vin.z,2)+' -> '+fmt(v.z,2)+'  (topspin should ACCELERATE forward)');
  const p2=V3.new(0,PH.TABLE_Y+0.1,0.5),v2=V3.new(0,-4,-10),w2=V3.new(500,0,0); // backspin
  bounceTable(p2,v2,w2);
  console.log('  backspin vz: -10.00 -> '+fmt(v2.z,2)+'  (should SLOW / check back)');
  const p3=V3.new(0,PH.TABLE_Y+0.1,0.5),v3=V3.new(0,-4,-10),w3=V3.new(0,0,0);
  bounceTable(p3,v3,w3);
  console.log('  no spin  vz: -10.00 -> '+fmt(v3.z,2));
}

console.log('\n== 6. racket impact: loop drive (brush up) ==');
{
  const v=V3.new(0,-1.2,6.0);   // incoming towards player (+z), slight descent
  const w=V3.new(-120,0,0);      // incoming topspin from opponent
  // racket face slightly closed, swinging up & forward (-z)
  const n=V3.norm(V3.new(),V3.new(0,0.30,-1));
  const vR=V3.new(0,9.0,-11.0);
  const info=impactRacket(v,w,n,vR,1.0);
  console.log('  out v = ('+fmt(v.x,2)+','+fmt(v.y,2)+','+fmt(v.z,2)+')  |v|='+fmt(V3.len(v),2)+' m/s ='+fmt(V3.len(v)*3.6,1)+' km/h');
  console.log('  out w = ('+fmt(w.x,0)+','+fmt(w.y,0)+','+fmt(w.z,0)+') rad/s = '+fmt(V3.len(w)/(2*Math.PI),0)+' rev/s');
}
console.log('\n== 7. racket impact: flat smash ==');
{
  const v=V3.new(0,-0.5,7.0), w=V3.new(-100,0,0);
  const n=V3.norm(V3.new(),V3.new(0,-0.18,-1));
  const vR=V3.new(0,-1.5,-19.0);
  impactRacket(v,w,n,vR,1.0);
  console.log('  |v|='+fmt(V3.len(v),2)+' m/s = '+fmt(V3.len(v)*3.6,1)+' km/h, spin='+fmt(V3.len(w)/(2*Math.PI),0)+' rev/s');
}
console.log('\n== 8. racket impact: chop (brush down, open face) ==');
{
  const v=V3.new(0,-2,8.0), w=V3.new(-250,0,0);
  const n=V3.norm(V3.new(),V3.new(0,0.62,-1));
  const vR=V3.new(0,-7.0,-4.0);
  impactRacket(v,w,n,vR,1.0);
  console.log('  out v=('+fmt(v.x,2)+','+fmt(v.y,2)+','+fmt(v.z,2)+') spin x='+fmt(w.x,0)+' rad/s ('+(w.x>0?'BACKSPIN ok':'topspin WRONG')+')');
}
console.log('\n== 9. solveLaunch: from player side to deep opponent corner ==');
{
  const from=V3.new(0.1,0.95,1.35), target={x:-0.45,z:-1.10};
  for(const spin of [V3.new(0,0,0), V3.new(-450,0,0), V3.new(380,0,0)]){
    const s=solveLaunch(from,target,spin,{elev:0.22});
    if(!s){console.log('   no solution');continue;}
    console.log('  spin wx='+spin.x+': speed='+fmt(s.speed,2)+' elev='+fmt(s.elev*180/Math.PI,1)+'deg land=('+fmt(s.landed.x,2)+','+fmt(s.landed.z,2)+') netClear='+fmt(s.clear*100,1)+'cm err='+fmt(s.score,3));
  }
}
console.log('\n== 10. full rally trajectory timing ==');
{
  const p=V3.new(0,1.0,1.3),v=V3.new(0,1.5,-12),w=V3.new(-400,0,0);
  const o=predict(p,v,w,{dt:1/600,maxT:3,stopZ:-1.6,stopDir:-1});
  console.log('  bounces='+o.bounces+' firstLand=('+(o.landed?fmt(o.landed.x,2)+','+fmt(o.landed.z,2):'-')+') t='+(o.landed?fmt(o.landed.t,3):'-')+'  apex='+fmt(o.apex,2)+' netClear='+(o.netCross?fmt((o.netCross.y-PH.NET_TOP)*100,1)+'cm':'-'));
  console.log('  time to reach opponent plane z=-1.6: '+fmt(o.reachT,3)+' s');
}
