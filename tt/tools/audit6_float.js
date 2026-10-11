// Reference float-throughput calibration of the host CPU (for scaling the audit timings).
// Usage:  node tt/tools/audit6_float.js
const fs=require('fs'),vm=require('vm');
let code=['10_math.js','30_physics.js'].map(f=>fs.readFileSync('/home/user/tabletennis/tt/src/'+f,'utf8')).join('\n').replace(/^'use strict';/m,'');
code+=`\n;globalThis.API={PH,V3,integrateBall,predict};`;
const ctx={console,performance:{now:()=>Number(process.hrtime.bigint())/1e6}};ctx.globalThis=ctx;
vm.createContext(ctx);vm.runInContext(code,ctx);
const A=ctx.API,{V3}=A;
const p=V3.new(0,1,1),v=V3.new(0.5,1,-8),w=V3.new(-300,30,10);
for(let i=0;i<5e4;i++)A.integrateBall(p,v,w,1/600);           // warm
let t=performance.now();const N=2e6;
for(let i=0;i<N;i++)A.integrateBall(p,v,w,1/600);
const per=(performance.now()-t)/N*1000;
console.log(`integrateBall: ${per.toFixed(3)} us/step on this vCPU (1 core @2.6GHz shared)`);
// tight float loop reference
let s=0;const M=5e7;t=performance.now();for(let i=0;i<M;i++){s+=Math.sqrt(i)*1.5;}const ms=performance.now()-t;
console.log(`reference float loop: ${(M/ms/1e3).toFixed(1)} Mops/s  (typical modern desktop browser: ~300-600 Mops/s, mid-range phone: ~80-200)`);
