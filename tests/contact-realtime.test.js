const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs'),path=require('node:path');
const {load}=require('./helpers.cjs');
const lib=load(['10_math.js','30_physics.js','38_paddle_motion.js','40_swipe.js'],['V3','PH','deriveStroke','refineRacket','refineRacketRealtime','impactRacket','predict','paddleForehand','SERVE_WARM','solveServeStroke']);
vm.runInContext('globalThis.flightCount=0; const predictReference=predict;predict=(...args)=>{globalThis.flightCount++;return predictReference(...args);}',lib.context);
const {V3,PH}=lib;
const fixtures=require('./contact-fixtures.cjs');
const rows=[];
for (const [id,s] of fixtures) test(`live ${id}: left/centre/right, both grips and both hands`,()=>{
 const failures=[];
 for(const grip of ['shakehand','penhold'])for(const hand of ['right','left'])for(const x of [-.62,0,.62]){
  const p=V3.new(x,s.y,s.z), v=V3.new(.2,-1,s.serve?0:s.inc||6),w=V3.new(s.spin||120,30,0);
  const m={right:s.right??.12,up:s.up,dist:s.dist??.24,curl:s.curl||0,releaseSpeed:s.speed,peakSpeed:s.speed,speed:s.speed,smooth:.95,straightness:.95,holdT:0,samples:8,x:.52,y:.5,sx:.5,sy:.7,dx:.02,dy:-s.up*.2,pathLen:s.dist??.24,dur:.12};
  const raw=lib.deriveStroke(m,{side:1,grip,forehand:lib.paddleForehand(x,hand),isServe:!!s.serve,ball:p,ballSpin:w,ballSpeed:V3.len(v)});
  assert.equal(raw.stroke.id,id,`fixture classified as ${raw.stroke.id}`);
  const evaluate=(r)=>{
   const bv=V3.clone(v),bw=V3.clone(w),info=lib.impactRacket(bv,bw,r.normal,r.vR,.85,r.rubber||{});
   const bp=V3.clone(p);V3.addScaled(bp,bp,r.normal,PH.R*1.05);
   const report=lib.predict(bp,bv,bw,{dt:PH.SIM_DT,maxT:2.6,stopOnFirstBounce:!s.serve,stopAfterBounces:s.serve?2:undefined,out:{}});
   const legal=!!info&&!report.hitNet&&!!report.landed&&(s.serve?report.landed.z>0&&!!report.b2&&report.b2.z<0:report.landed.z<0);
   return {legal,speed:V3.len(bv),spin:{...bw},landing:report.b2||report.landed};
  };
  lib.SERVE_WARM.clear();lib.context.flightCount=0;
  const result=lib.refineRacketRealtime(p,v,w,{...raw},.85,.85);
  const flights=lib.context.flightCount,actual=evaluate(result);
  lib.SERVE_WARM.clear();const reference=evaluate(lib.refineRacket(p,v,w,{...raw},.85,.85));
  const row={id,grip,hand,x,flights,valid:result.valid,actual,reference};rows.push(row);
  assert.ok([result.normal,result.vR].every(vec=>Object.values(vec).every(Number.isFinite)));
  assert.ok(V3.len(result.vR)<=(s.serve?12.5:19.5)+1e-6);
  assert.ok(flights<=(s.serve?128:73),`unbounded ${flights} flights`);
  if (['LOOP','COUNTER','SERVE_TOP'].includes(id)) assert.ok(actual.spin.x<0, `${id} lost topspin`);
  if (['CHOP','PUSH','SERVE_BACK'].includes(id)) assert.ok(actual.spin.x>0, `${id} lost backspin`);
  if (id==='HOOK') assert.ok(actual.spin.y>0,'hook lost positive sidespin');
  if (id==='FADE') assert.ok(actual.spin.y<0,'fade lost negative sidespin');
  if(result.valid===true&&!actual.legal)failures.push(`${grip}/${hand}/${x}: false valid`);
  if(reference.legal&&!actual.legal)failures.push(`${grip}/${hand}/${x}: reference legal, live illegal`);
 }
 assert.deepEqual(failures,[]);
});
test('save full production-physics matrix',()=>{
 const out=path.resolve(__dirname,'../test-results/evidence/contact-matrix.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(rows,null,2));
 console.log(JSON.stringify({cases:rows.length,liveLegal:rows.filter(r=>r.actual.legal).length,referenceLegal:rows.filter(r=>r.reference.legal).length,maxFlights:Math.max(...rows.map(r=>r.flights))}));
});

test('pathological serves cannot escape the shared 128-candidate live budget',()=>{
 for(const grip of ['shakehand','penhold'])for(const up of [-1.4,0,1.4])for(const speed of [0,.1,2,15])for(const x of [-.7,.7]){
  const p=V3.new(x,.94,1.9),v=V3.new(.4,-2,0),w=V3.new();
  const raw=lib.deriveStroke({right:.9,up,dist:.02,curl:1.2,releaseSpeed:speed,peakSpeed:speed,smooth:.7,straightness:.6,samples:3,x:.9,y:.5},
    {side:1,grip,isServe:true,ball:p,ballSpin:w,ballSpeed:2});
  lib.SERVE_WARM.clear();lib.context.flightCount=0;
  const r=lib.refineRacketRealtime(p,v,w,raw,.85,.6);
  assert.ok(lib.context.flightCount<=128,`serve escaped budget: ${lib.context.flightCount}`);
  assert.ok([r.normal,r.vR].every(vec=>Object.values(vec).every(Number.isFinite)));
 }
});

test('budget control never catches unrelated physics errors',()=>{
 assert.throws(()=>lib.solveServeStroke(V3.new(0,1.1,1.6),{aim:{x:0,z:-1}},()=>{throw Error('physics fault');},1,.85,true),/physics fault/);
});
