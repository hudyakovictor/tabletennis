/* Local visual smoke check; no external requests. */
const path=require('node:path');
const puppeteer=require('puppeteer-core');
const chromium=require('@sparticuz/chromium');
const {pathToFileURL}=require('node:url');
const fs=require('node:fs'),os=require('node:os'),zlib=require('node:zlib');
const {execFileSync}=require('node:child_process');
(async()=>{
 const libs=path.join(os.tmpdir(),'topspin-browser-libs');
 if(process.platform==='linux'){
  fs.mkdirSync(libs,{recursive:true});
  const archive=path.join(path.dirname(require.resolve('@sparticuz/chromium')),'../../bin/al2023.tar.br');
  if(fs.existsSync(archive))execFileSync('tar',['xf','-','-C',libs],{input:zlib.brotliDecompressSync(fs.readFileSync(archive))});
 }
 const browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||await chromium.executablePath(),args:chromium.args,headless:true,
 env:{...process.env,LD_LIBRARY_PATH:[path.join(require('node:os').tmpdir(),'topspin-browser-libs/lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}});
 try{
 for(const [width,height] of [[1280,760],[390,844]]){
  const page=await browser.newPage();await page.setViewport({width,height,isMobile:width<600,hasTouch:width<600});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../../play/index.html')).href);
  await page.waitForFunction(()=>window.__game&&window.__game.R.drawCalls>0);
  await page.evaluate(()=>{
   const g=window.__game;document.querySelector('#loading').classList.add('off');
   document.querySelectorAll('.screen.on').forEach(e=>e.classList.remove('on'));
   g.startMatch(2);g.server=1;g.prepServe();g.paused=true;
   for(let i=0;i<120;i++)g.update(1/60);
   g.paused=true;g.render();
  });
  await new Promise(r=>setTimeout(r,600));
  await page.screenshot({path:path.resolve(__dirname,`../../test-results/evidence/input-${width}x${height}.png`)});
  await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
