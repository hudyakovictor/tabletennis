// Headless audit of the physics/stroke/serve modules — pure Node, no puppeteer needed.
// Usage:  node tt/tools/audit4_perf.js        (loads ../src/*.js into a VM context)
const fs=require('fs'),vm=require('vm');
const SRC='/home/user/tabletennis/tt/src/';
let code=['10_math.js','30_physics.js','40_swipe.js'].map(f=>fs.readFileSync(SRC+f,'utf8')).join('\n');
code+=`\n;globalThis.API={PH,V3,DEG,TAU,predict,deriveStroke,refineRacket,impactRacket};`;
const ctx={console,performance:{now:()=>Number(process.hrtime.bigint())/1e6}};ctx.globalThis=ctx;
vm.createContext(ctx);vm.runInContext(code,ctx);
const A=ctx.API,{PH,V3}=A,T=PH.TABLE_Y;
const cs={p:V3.new(0.2,T+0.35,1.15),v:V3.new(-1.0,-1.2,8.5),w:V3.new(350,0,0)};
const m={up:0.95,right:0.31,dist:0.30,pathLen:0.30,straightness:1,speed:2.6,peakSpeed:2.7,releaseSpeed:2.6,
 accel:0,angle:1.25,angleDeg:72,curl:0,smooth:0.95,samples:24,jerk:0.2,sx:0.5,sy:0.66,x:0.6,y:0.4,dur:0.16};
function one(assist){const c={side:1,ball:{y:cs.p.y,z:cs.p.z},ballSpin:cs.w,ballSpeed:V3.len(cs.v)};const rk=A.deriveStroke(m,c);return A.refineRacket(cs.p,cs.v,cs.w,rk,assist,rk.quality);}
for(const a of [0,0.72,1.0]){for(let i=0;i<3;i++)one(a);const ts=[];for(let i=0;i<12;i++){const t=performance.now();one(a);ts.push(performance.now()-t);}ts.sort((x,y)=>x-y);
 console.log(`assist ${a}: median ${ts[6].toFixed(1)} ms | min ${ts[0].toFixed(1)} | max ${ts[11].toFixed(1)}`);}
// AI-side cost: same call with skill-derived assist
for(const s of [0.5,0.79,0.95]){for(let i=0;i<2;i++)one(s);const t=performance.now();for(let i=0;i<8;i++)one(s);console.log(`AI skill ${s} (assist ${s}): ${((performance.now()-t)/8).toFixed(1)} ms per hit`);}
