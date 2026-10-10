const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage','--window-size=1280,760']});
const page=await br.newPage(); await page.setViewport({width:1280,height:760});
page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('file://'+path.resolve('/home/user/table-tennis-topspin.html'),{waitUntil:'load'});
await new Promise(r=>setTimeout(r,2200));
await page.click('#play'); await new Promise(r=>setTimeout(r,600));
const out=await page.evaluate(()=>{
  const g=window.__game; g.paused=true; for(let i=0;i<240;i++) g.update(1/120);
  const R=g.R,S=g.scene,gl=R.gl;
  const px=new Uint8Array(4);
  const samp=()=>{const pts=[[640,700],[640,600],[640,500],[640,380]];const res=[];
    for(const [x,y] of pts){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.readPixels(x,760-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);res.push(px[0]+','+px[1]+','+px[2]);}return res.join(' | ');};
  const log=[];
  const RED={color:[1,0,0],emissive:[1,0,0],unlit:true,rough:1};
  // 1: only table
  R.beginScene([0,0,0.2]); R.draw(S.mesh.tableTop,S.M.tableTop,RED); R.present(0); log.push('tableOnly      '+samp());
  // 2: only table, doubleSided
  R.beginScene([0,0,0.2]); R.draw(S.mesh.tableTop,S.M.tableTop,{...RED,doubleSided:true}); R.present(0); log.push('tableOnly 2side '+samp());
  // 3: full static, table red
  const old=S.mat.table; S.mat.table=RED;
  R.beginScene([0,0,0.2]); S.drawStatic(R,false); R.present(0); log.push('staticAll red  '+samp());
  S.mat.table=old;
  // 4: static minus floor/walls/banners
  R.beginScene([0,0,0.2]); R.draw(S.mesh.tableTop,S.M.tableTop,RED); R.draw(S.mesh.floor,S.M.floor,S.mat.floor); R.present(0); log.push('table+floor    '+samp());
  // 5: table + walls
  R.beginScene([0,0,0.2]); R.draw(S.mesh.tableTop,S.M.tableTop,RED); for(const w of S.walls) R.draw(S.mesh.wall,w,S.mat.wall); R.present(0); log.push('table+walls    '+samp());
  // 6: table + ceiling
  R.beginScene([0,0,0.2]); R.draw(S.mesh.tableTop,S.M.tableTop,RED); R.draw(S.mesh.quad,S.ceiling,S.mat.ceiling); R.present(0); log.push('table+ceiling  '+samp());
  // 7: table + apron
  R.beginScene([0,0,0.2]); R.draw(S.mesh.tableTop,S.M.tableTop,RED); R.draw(S.mesh.box,S.M.apronN,S.mat.apron);R.draw(S.mesh.box,S.M.apronS,S.mat.apron);R.draw(S.mesh.box,S.M.apronW,S.mat.apron);R.draw(S.mesh.box,S.M.apronE,S.mat.apron); R.present(0); log.push('table+aprons   '+samp());
  return log;
});
console.log(out.join('\n'));
await br.close();})();
