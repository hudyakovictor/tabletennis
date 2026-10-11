// Headless audit of the physics/stroke/serve modules — pure Node, no puppeteer needed.
// Usage:  node tt/tools/audit5_cpu.js        (loads ../src/*.js into a VM context)
// JS throughput calibration of this sandbox CPU
function chaos(n){let s=0;for(let i=0;i<n;i++){s+=Math.sqrt(i)*Math.sin(i)+Math.hypot(i,i);}return s;}
chaos(1e6);const t=performance.now();chaos(2e7);const ms=performance.now()-t;
console.log(`sandbox JS: 2e7 mixed math ops in ${ms.toFixed(0)} ms  -> ${(2e7/ms/1000).toFixed(1)} Mops/s`);
console.log(`nproc: ${require('os').cpus().length}  model: ${require('os').cpus()[0].model}`);
