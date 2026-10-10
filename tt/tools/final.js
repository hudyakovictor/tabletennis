const puppeteer=require('puppeteer');const path=require('path');
(async()=>{
const br=await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-dev-shm-usage']});
const page=await br.newPage(); await page.setViewport({width:1280,height:760});
const errs=[];
page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
page.on('console',async m=>{if(m.type()==='error'){try{errs.push('err '+await m.args()[0].evaluate(v=>v&&v.stack||String(v)));}catch(_){errs.push('err '+m.text());}}});
page.on('requestfailed',r=>errs.push('REQFAIL '+r.url()));
const reqs=[];
page.on('request',r=>{ if(!r.url().startsWith('file:')&&!r.url().startsWith('data:')) reqs.push(r.url()); });
await page.goto('file://'+path.resolve('/home/user/table-tennis-topspin.html'),{waitUntil:'networkidle0'});
await new Promise(r=>setTimeout(r,2000));
await page.click('#play');
await new Promise(r=>setTimeout(r,8000));
// exercise every UI surface
const probe=await page.evaluate(async()=>{
  const g=window.__game, out={};
  const ids=['gl','fx','hud','score','p1','p2','toWin','sdot1','sdot2','rally','msgs','hint','dbg',
    'btnSound','btnSettings','btnMenu','shot','shotName','shotDesc','shotSpeed','shotSpin','shotQual','shotQBar',
    'spin','ballKmh','gTop','gTopV','gSide','gSideV','oppShot','menu','settings','guide','over','play','mapList',
    'stShots','stBest','stMaxSpeed','stMaxSpin','stAvgSpin','stFav','overTitle','overScore','loading'];
  out.missing=ids.filter(i=>!document.getElementById(i));
  // cycle cameras + quality + overlays
  for(const c of ['BROADCAST','DYNAMIC','LOW','SIDE']){ g.settings.camera=c; g.update(1/60); g.render(); }
  for(const q of ['low','medium','high']){ g.R.setQuality?g.R.setQuality(q):(g.settings.quality=q); g.update(1/60); g.render(); }
  for(const s of ['menu','settings','guide','over']){ const e=document.getElementById(s); e.classList.add('on'); await new Promise(r=>requestAnimationFrame(r)); e.classList.remove('on'); }
  out.perf={dc:g.R.drawCalls,tris:g.R.tris,gl2:g.R.isGL2,shadow:!!g.R.shadowFBO};
  out.settingsKeys=Object.keys(g.settings);
  out.strokes=Object.keys(STROKES).length;
  return out;
});
console.log('external requests:', reqs.length? reqs : '(none - fully self-contained)');
console.log('missing DOM ids:', probe.missing.length?probe.missing:'(none)');
console.log('perf:', JSON.stringify(probe.perf), 'strokes:', probe.strokes);
console.log('settings:', probe.settingsKeys.join(','));
console.log('errors:', errs.length?errs.slice(0,10):'(none)');
await br.close();})();
