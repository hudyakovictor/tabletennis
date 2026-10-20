/* Deliberately harder contacts: off-centre placement, low/high contacts,
 * incoming flat/top/back spin and imperfect quality. Not a success-rate
 * forecast for humans. Reports regressions against the reference solver. */
const {load}=require('./helpers.cjs');const fs=require('node:fs');const fixtures=require('./contact-fixtures.cjs');
const L=load(['10_math.js','30_physics.js','40_swipe.js'],['V3','PH','deriveStroke','refineRacket','refineRacketRealtime','impactRacket','predict','paddleForehand','SERVE_WARM']);
const {V3,PH}=L, rows=[];
for(const [id,s] of fixtures)for(const grip of ['shakehand','penhold'])for(const k of [-1,0,1])for(const variation of [0,1,2]){
 const x=k*.64,y=s.y+[0,-.07,.12][variation],z=s.z+[0,.18,-.16][variation];
 const p=V3.new(x,y,z),v=V3.new([0,.8,-.6][variation],s.serve?-1:-.8,s.serve?0:s.inc||[6,10,4][variation]);
 const w=V3.new(s.spin||[120,0,-180][variation],variation===2?-100:30,0);
 const speed=s.speed*[1,.82,1.1][variation], dist=s.dist??.24;
 const m={right:s.right??.12,up:s.up,dist,curl:s.curl||0,releaseSpeed:speed,peakSpeed:speed,speed,smooth:.9,straightness:.9,samples:8,holdT:0,x:.5+k*.3,y:.5,dx:.02,dy:-s.up*.2,dur:.12};
 const ctx={side:1,grip,forehand:L.paddleForehand(x,'right'),isServe:!!s.serve,ball:p,ballSpin:w,ballSpeed:V3.len(v)};
 const raw=L.deriveStroke(m,ctx),quality=[.85,.65,.95][variation];
 function run(fn){L.SERVE_WARM.clear();const r=fn(p,v,w,{...raw},.85,quality);const bv=V3.clone(v),bw=V3.clone(w);const info=L.impactRacket(bv,bw,r.normal,r.vR,quality,r.rubber||{});const bp=V3.clone(p);V3.addScaled(bp,bp,r.normal,PH.R*1.05);const o=L.predict(bp,bv,bw,{dt:PH.SIM_DT,maxT:2.6,stopOnFirstBounce:!s.serve,stopAfterBounces:s.serve?2:undefined,out:{}});
 return{valid:r.valid,legal:!!info&&!o.hitNet&&!!o.landed&&(s.serve?o.landed.z>0&&!!o.b2&&o.b2.z<0:o.landed.z<0),landing:o.b2||o.landed,speed:V3.len(bv),spin:{...bw}};}
 rows.push({id,classified:raw.stroke.id,grip,x,y,z,variation,live:run(L.refineRacketRealtime),reference:run(L.refineRacket)});
}
fs.mkdirSync('test-results/evidence',{recursive:true});fs.writeFileSync('test-results/evidence/contact-stress.json',JSON.stringify(rows,null,2));
const regressions=rows.filter(r=>r.reference.legal&&!r.live.legal),falseValid=rows.filter(r=>r.live.valid===true&&!r.live.legal);
console.log(JSON.stringify({cases:rows.length,liveLegal:rows.filter(r=>r.live.legal).length,referenceLegal:rows.filter(r=>r.reference.legal).length,regressions:regressions.map(r=>({id:r.id,grip:r.grip,x:r.x,variation:r.variation})),falseValid: falseValid.length},null,2));
if(falseValid.length)process.exitCode=1;
