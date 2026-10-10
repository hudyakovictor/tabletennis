const puppeteer = require('puppeteer');
const path = require('path');
const FILE = process.argv[2] || '/home/user/table-tennis-topspin.html';

(async () => {
  const browser = await puppeteer.launch({ headless:'new',
    args:['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader',
          '--enable-unsafe-swiftshader','--disable-dev-shm-usage','--window-size=1280,760']});
  const page = await browser.newPage();
  await page.setViewport({width:1280,height:760});
  const errs=[];
  page.on('pageerror', e=>errs.push('[PAGEERROR] '+e.message));
  page.on('console', async m=>{ if(m.type()==='error'){ try{ errs.push('[err] '+await m.args()[0].evaluate(v=>v&&v.stack||String(v))); }catch(_){ errs.push('[err] '+m.text()); } } });
  await page.goto('file://'+path.resolve(FILE), {waitUntil:'load'});
  await new Promise(r=>setTimeout(r,2000));
  await page.click('#play');
  await new Promise(r=>setTimeout(r,800));

  // in-page robot: dispatches real PointerEvents on the canvas, timed off ball state
  await page.evaluate(()=>{
    const g = window.__game, cv = document.getElementById('gl');
    const W = innerWidth, H = innerHeight;
    const log = window.__log = [];
    let busy = false;
    const pe = (type,x,y)=>cv.dispatchEvent(new PointerEvent(type,{pointerId:1,clientX:x,clientY:y,bubbles:true,isPrimary:true,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1}));
    const sleep = ms=>new Promise(r=>setTimeout(r,ms));
    // a swipe described in normalised screen space with optional curvature
    async function gesture(dx, dy, ms, bend, hold){
      const x0=W*0.5, y0=H*0.70; const x1=x0+dx, y1=y0+dy;
      pe('pointerdown',x0,y0);
      if(hold) await sleep(hold);
      const N=12;
      for(let i=1;i<=N;i++){
        const s=i/N;
        let nx=-(y1-y0), ny=(x1-x0); const bl=Math.hypot(nx,ny)||1;
        const off=bend*Math.sin(Math.PI*s);
        pe('pointermove', x0+(x1-x0)*s+nx/bl*off, y0+(y1-y0)*s+ny/bl*off);
        await sleep(ms/N);
      }
      pe('pointerup',x1,y1);
    }
    const SHOTS = [
      {n:'loop',    dx:  20, dy:-230, ms:150, bend:  0},
      {n:'drive',   dx:  60, dy:-170, ms:120, bend:  0},
      {n:'smash',   dx:  30, dy:-300, ms: 85, bend:  0},
      {n:'push',    dx: -30, dy: 150, ms:170, bend:  0},
      {n:'chop',    dx:  20, dy: 230, ms:150, bend:  0},
      {n:'hook',    dx:  40, dy:-200, ms:140, bend: 70},
      {n:'fade',    dx: -40, dy:-200, ms:140, bend:-70},
      {n:'lob',     dx:  10, dy:-240, ms:320, bend:  0},
      {n:'block',   dx:   8, dy: -40, ms: 90, bend:  0},
      {n:'flick',   dx:  70, dy:-190, ms: 95, bend: 30},
    ];
    let si=0;
    window.__robot = setInterval(async ()=>{
      if (busy) return;
      const st=g.state, b=g.ball;
      if (st==='SERVE_READY'){
        busy=true;
        const sh=SHOTS[si++%SHOTS.length];
        await gesture(sh.dx, sh.dy, sh.ms, sh.bend, 230);
        log.push('serve:'+sh.n);
        busy=false;
      } else if (st==='RALLY' && b.live && b.lastHitBy===-1 && b.v.z>0.4 && b.p.z>0.55 && b.p.z<1.35){
        busy=true;
        const sh=SHOTS[si++%SHOTS.length];
        await gesture(sh.dx, sh.dy, sh.ms, sh.bend, 0);
        log.push('rally:'+sh.n);
        busy=false;
      }
    }, 40);
  });

  const snaps=[];
  for (let t=0;t<34;t++){
    await new Promise(r=>setTimeout(r,900));
    const s = await page.evaluate(()=>{const g=window.__game;return{st:g.state,sc:g.score.join('-'),sh:g.stats.shots,ral:g.rally,best:g.bestRally,m:(g.messages[0]||{}).text||''};});
    snaps.push(s);
    if (t===6)  await page.screenshot({path:'/home/user/tt/shots/10_rally.png'});
    if (t===15) await page.screenshot({path:'/home/user/tt/shots/11_rally.png'});
    if (t===25) await page.screenshot({path:'/home/user/tt/shots/12_rally.png'});
  }
  const fin = await page.evaluate(()=>{const g=window.__game;return{
    st:g.state, score:g.score, shots:g.stats.shots, best:g.bestRally,
    byStroke:g.stats.byStroke, maxSpeed:+g.stats.maxSpeed.toFixed(1), maxSpin:+g.stats.maxSpin.toFixed(0),
    fps:+g.fps.toFixed(1), log:window.__log.slice(-24)};});
  console.log('MSG TIMELINE:', snaps.map(s=>s.sc+'|'+s.m).filter((v,i,a)=>v!==a[i-1]).join('  ·  '));
  console.log('FINAL:', JSON.stringify(fin,null,1));
  console.log('ERRORS:', errs.length? errs.slice(0,8).join('\n') : '(none)');
  await browser.close();
})().catch(e=>{console.error('HARNESS',e);process.exit(1);});
