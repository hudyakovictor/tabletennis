const puppeteer=require('puppeteer');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const p=await br.newPage(); await p.setViewport({width:1280,height:760});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('file:///home/user/table-tennis-topspin.html',{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2000));
console.log(await p.evaluate(()=>{
  const g=window.__game,S=g.scene,R=g.R;
  g.startMatch(2); g.paused=true; for(let i=0;i<60;i++) g.update(1/120);
  const out={count:S.mesh.tableTop.count, body:S.mesh.tableBody.count,
    M:Array.from(S.M.tableTop).map(v=>+v.toFixed(3)), tex:!!S.mat.table.tex};
  return JSON.stringify(out);
}));
// variant screenshots
for (const [name, fn] of [['A_normal',()=>{}],
  ['B_twoSided',()=>{window.__game.scene.mat.table.doubleSided=true;}],
  ['C_unlitRed',()=>{const m=window.__game.scene.mat.table;m.unlit=true;m.emissive=[1,0,0];m.doubleSided=true;}]]) {
  await p.evaluate(`(${fn.toString()})()`);
  await p.evaluate(()=>{window.__game.render();});
  await new Promise(r=>setTimeout(r,250));
  await p.screenshot({path:'/home/user/tt/shots/tb_'+name+'.png'});
}
await br.close();})();
