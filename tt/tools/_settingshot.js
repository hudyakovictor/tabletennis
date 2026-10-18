/* Screenshot of the settings panel with the new leading-hand control.
 * node tt/tools/_settingshot.js [outfile] */
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');
const zlib = require('node:zlib'); const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core'); const chromium = require('@sparticuz/chromium');
const root = path.resolve(__dirname, '../..');
const OUT = path.resolve(process.argv[2] || path.join(os.homedir(), 'shots', 'settings-hand.png'));

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux') {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } });
  const page = await browser.newPage();
  await page.setViewport({ width: 520, height: 900, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  await page.goto(pathToFileURL(path.join(root, 'play/index.html')).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
  const box = await page.evaluate(() => {
    const l = document.getElementById('loading'); if (l) l.classList.add('off');
    const g = window.__game;
    g.settings.hand = 'left'; g.saveSettings();       // show the saved lefty choice lit
    g.ui.syncSettings();
    g.ui.openSettings();
    const el = document.getElementById('settings');
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), w: Math.min(r.width, window.innerWidth), h: Math.min(r.height, window.innerHeight) };
  });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: OUT, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  console.log('wrote ' + OUT);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
