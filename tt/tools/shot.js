const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=angle','--use-angle=swiftshader',
           '--enable-unsafe-swiftshader','--disable-dev-shm-usage','--enable-webgl','--ignore-gpu-blocklist',
           '--window-size=1280,760']
  });
  const page = await browser.newPage();
  await page.setViewport({width:1280,height:760,deviceScaleFactor:1});
  const logs=[];
  page.on('console', async m=>{
    const args=[];
    for(const a of m.args()){ try{ args.push(await a.evaluate(v=> (v&&v.stack)?v.stack:(typeof v==='object'?JSON.stringify(v):String(v)))); }catch(e){ args.push(m.text()); } }
    logs.push('['+m.type()+'] '+args.join(' '));
  });
  page.on('pageerror', e=>logs.push('[PAGEERROR] '+e.message));
  await page.goto('file://'+path.resolve(process.argv[2]||'/home/user/table-tennis-topspin.html'), {waitUntil:'load'});
  await new Promise(r=>setTimeout(r,2500));

  const info = await page.evaluate(()=>{
    const c=document.getElementById('gl');
    const gl=c.getContext('webgl2')||c.getContext('webgl');
    return {gl: !!gl, ver: gl?gl.getParameter(gl.VERSION):'none',
            rend: gl?gl.getParameter(gl.RENDERER):'none',
            game: !!window.__game, w:c.width, h:c.height};
  });
  console.log('ENV:', JSON.stringify(info));
  if(!info.game){ console.log('--- early logs ---'); console.log(logs.join('\n')||'(none)'); await browser.close(); process.exit(0); }
  await page.screenshot({path:'/home/user/tt/shots/01_menu.png'});

  // start the match
  await page.click('#play');
  await new Promise(r=>setTimeout(r,1200));
  await page.screenshot({path:'/home/user/tt/shots/02_start.png'});

  // helper: swipe
  async function swipe(x0,y0,x1,y1,ms,steps=14,bend=0){
    await page.mouse.move(x0,y0);
    await page.mouse.down();
    for(let i=1;i<=steps;i++){
      const s=i/steps;
      const nx=-(y1-y0), ny=(x1-x0); const bl=Math.hypot(nx,ny)||1;
      const off=bend*Math.sin(Math.PI*s);
      await page.mouse.move(x0+(x1-x0)*s+nx/bl*off, y0+(y1-y0)*s+ny/bl*off);
      await new Promise(r=>setTimeout(r, ms/steps));
    }
    await page.mouse.up();
  }

  // serve + rally a bit
  for (let k=0;k<7;k++){
    const st = await page.evaluate(()=>window.__game.state);
    if (st==='SERVE_READY'){
      await page.mouse.move(640,520); await page.mouse.down();
      await new Promise(r=>setTimeout(r,170));
      for(let i=1;i<=12;i++){ await page.mouse.move(640+i*2, 520-i*11); await new Promise(r=>setTimeout(r,10)); }
      await page.mouse.up();
    } else {
      await swipe(640,540, 650,390, 120);
    }
    await new Promise(r=>setTimeout(r,700));
    if(k===1) await page.screenshot({path:'/home/user/tt/shots/03_rally.png'});
  }
  await page.screenshot({path:'/home/user/tt/shots/04_after.png'});

  const state = await page.evaluate(()=>{
    const g=window.__game;
    return {state:g.state, score:g.score, rally:g.rally, shots:g.stats.shots,
            fps:+g.fps.toFixed(1), dc:g.R.drawCalls, tris:g.R.tris,
            gl2:g.R.isGL2, shadow:!!g.R.shadowFBO, ball:{x:+g.ball.p.x.toFixed(2),y:+g.ball.p.y.toFixed(2),z:+g.ball.p.z.toFixed(2)},
            msgs:g.messages.map(m=>m.text)};
  });
  console.log('STATE:', JSON.stringify(state));
  console.log('--- console ---');
  console.log(logs.slice(0,40).join('\n') || '(clean)');
  await browser.close();
})().catch(e=>{console.error('HARNESS ERROR', e); process.exit(1);});
