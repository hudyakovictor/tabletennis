#!/usr/bin/env node
/* =====================================================================
 *  menu_shots.cjs — снимки всех экранов меню (мобильный 390×844)
 *  и коллаж docs/menu-collage.png.
 *
 *  Снимки снимаются в настоящем Chromium на собранной странице
 *  play/index.html, коллаж собирается canvas-ом в том же браузере
 *  (Pillow в песочнице нет). Запуск:  npm run shots:menu
 * ===================================================================== */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = path.join(ROOT, 'play', 'index.html');
const SHOTS = path.join(ROOT, 'docs', 'menu-shots');
const OUT = path.join(ROOT, 'docs', 'menu-collage.png');
const W = 390, H = 844;

/* Каждый экран: подпись на русском + функция, которая его открывает. */
const SCREENS = [
  { id: 'menu', title: 'Главное меню — хаб', open: (g) => { g.ui.showMainMenu(); } },
  { id: 'drawer', title: 'Шторка «ЕЩЁ»', open: (g) => { g.ui.showMainMenu(); g.ui.hub.toggleDrawer(true); } },
  { id: 'settings', title: 'Настройки: разделы', open: (g) => { g.ui.showMainMenu(); g.ui.openSettings(); } },
  { id: 'tune-serve', title: 'Настройки: подача', open: (g) => { g.ui.showMainMenu(); g.ui.openSettings(); g.ui.tuneServeOpen ? g.ui.tuneServeOpen() : null; } },
  { id: 'tune-control', title: 'Настройки: удар', open: (g) => { g.ui.showMainMenu(); g.ui.openSettings(); g.ui.tuneControlOpen ? g.ui.tuneControlOpen() : null; } },
  { id: 'career', title: 'Карьера: турнир', open: (g) => { g.ui.openCareer(); } },
  { id: 'career-perk', title: 'Карьера: перки', open: (g) => { g.ui.showCareerPerks(g.career); } },
  { id: 'career-end', title: 'Карьера: итог', open: (g) => { g.ui.showCareerTournamentEnd(g.career); } },
  { id: 'online', title: 'Онлайн-лобби', open: (g) => { g.ui.openOnline(); } },
  { id: 'workshop', title: 'Мастерская: ракетки', open: (g) => { g.ui.openWorkshop('racket'); } },
  { id: 'workshop-shop', title: 'Мастерская: магазин', open: (g) => { g.ui.openWorkshop('shop'); } },
  { id: 'over', title: 'Итоги матча', open: (g) => { g.ui.showMatchEnd(true); } },
  { id: 'reels', title: 'Лучшие моменты', open: (g) => { g.ui.showMoments(); } },
  { id: 'shotlab', title: 'Шот-лаб: замер удара', open: (g) => { g.ui.openShotLab(); } },
  { id: 'training', title: 'Обучение: recap', open: (g) => { g.ui.showTrainingRecap(); } },
];

(async () => {
  const DESKTOP = process.argv.includes('--desktop');
  const OUT_DIR = DESKTOP ? path.join(SHOTS, 'desktop') : SHOTS;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux' && !fs.existsSync(path.join(libs, 'lib'))) {
    fs.mkdirSync(libs, { recursive: true });
    const archive = path.join(path.dirname(require.resolve('@sparticuz/chromium')), '../../bin/al2023.tar.br');
    execFileSync('tar', ['xf', '-', '-C', libs], { input: zlib.brotliDecompressSync(fs.readFileSync(archive)) });
  }
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_BIN || await chromium.executablePath(),
    args: chromium.args, headless: true,
    env: { ...process.env, LD_LIBRARY_PATH: [path.join(libs, 'lib'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
  });
  const page = await browser.newPage();
  await page.setViewport(DESKTOP
    ? { width: 1280, height: 760, deviceScaleFactor: 1 }
    : { width: W, height: H, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(pathToFileURL(PAGE).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
  await new Promise((r) => setTimeout(r, 1200));

  const shots = [];
  for (const s of (DESKTOP ? SCREENS.filter((x) => x.id === 'menu' || x.id === 'settings' || x.id === 'workshop') : SCREENS)) {
    await page.evaluate((id) => {
      const g = window.__game;
      /* чистый старт: закрываем всё, что могло остаться от прошлого экрана */
      document.querySelectorAll('.screen.on').forEach((el) => el.classList.remove('on'));
      if (g.ui.hub) { g.ui.hub.toggleDrawer(false); g.ui.hub.close(); }
      document.body.classList.remove('is-playing');
      try { g.returnToMenu(); } catch (e) { /* не критично */ }
    }, s.id);
    await new Promise((r) => setTimeout(r, 260));
    /* функции открытия живут в странице — передаём их через evaluate */
    await page.evaluate((id) => {
      const g = window.__game;
      const map = {
        menu: () => g.ui.showMainMenu(),
        drawer: () => { g.ui.showMainMenu(); g.ui.hub.toggleDrawer(true); },
        settings: () => { g.ui.showMainMenu(); g.ui.openSettings(); },
        'tune-serve': () => { g.ui.showMainMenu(); g.ui.openSettings(); document.getElementById('tuneServeOpen').click(); },
        'tune-control': () => { g.ui.showMainMenu(); g.ui.openSettings(); document.getElementById('tuneControlOpen').click(); },
        career: () => g.ui.openCareer(),
        'career-perk': () => { g.career.pendingPerks = pickThreePerks(g.career); g.ui.showCareerPerks(g.career); },
        'career-end': () => g.ui.showCareerRunEnd(g.career),
        online: () => { g.network.connect = () => {}; g.ui.openOnline(); },
        workshop: () => g.ui.openWorkshop('racket'),
        'workshop-shop': () => g.ui.openWorkshop('shop'),
        over: () => { g.lastReward = { coins: 120, xp: 45, seasonLevels: 1 }; g.ui.showMatchEnd(true); },
        reels: () => {
          const mk = (shots, score, finish, speed, spin, meta) => ({
            shots, score, finish, speed, spin, winner: 1, meta: meta || {},
            frames: [], reel: null, tag: 'РУКА',
          });
          if (!g.moments.kept.length) g.moments.kept.push(
            mk(14, .82, 'SMASH', 96, 71, { matchPoint: true }),
            mk(11, .68, 'LOOP', 78, 63, { deuce: true }),
            mk(7, .55, 'CHOP', 61, 44, {}));
          g.ui.showMoments();
        },
        shotlab: () => g.ui.openShotLab(),
        training: () => g.ui.showTrainingRecap(),
      };
      const fn = map[id];
      if (fn) fn();
    }, s.id);
    await new Promise((r) => setTimeout(r, 700));
    const file = path.join(OUT_DIR, `${String(shots.length + 1).padStart(2, '0')}-${s.id}.png`);
    await page.screenshot({ path: file });
    shots.push({ file, title: s.title });
    console.log('снимок:', path.basename(file), '—', s.title);
  }

  if (DESKTOP) {
    for (const s of shots) console.log('снимок:', path.basename(s.file), '—', s.title);
    await browser.close();
    return;
  }
  /* ------------------------------ коллаж ------------------------------ */
  const COLS = 4, CW = 300, GAP = 20, PAD = 34, HEAD = 128;
  const scale = CW / W;
  const CH = Math.round(H * scale);
  const rows = Math.ceil(shots.length / COLS);
  const canvasW = PAD * 2 + COLS * CW + (COLS - 1) * GAP;
  const canvasH = PAD * 2 + HEAD + rows * (CH + 46) + (rows - 1) * GAP;

  const dataUrls = shots.map((s) => ({
    title: s.title,
    url: 'data:image/png;base64,' + fs.readFileSync(s.file).toString('base64'),
  }));

  const collage = await browser.newPage();
  await collage.setViewport({ width: canvasW, height: canvasH, deviceScaleFactor: 1 });
  await collage.setContent(`<!doctype html><meta charset="utf-8">
    <style>
      html,body{margin:0;background:#05070d;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      canvas{display:block}
    </style><canvas id="c" width="${canvasW}" height="${canvasH}"></canvas>
    <script>
      const shots = ${JSON.stringify(dataUrls)};
      const COLS = ${COLS}, CW = ${CW}, CH = ${CH}, GAP = ${GAP}, PAD = ${PAD}, HEAD = ${HEAD};
      const c = document.getElementById('c'), x = c.getContext('2d');
      const grad = x.createLinearGradient(0,0,c.width,c.height);
      grad.addColorStop(0,'#0b1020'); grad.addColorStop(.5,'#05070d'); grad.addColorStop(1,'#0a0f1c');
      x.fillStyle = grad; x.fillRect(0,0,c.width,c.height);
      /* мягкие пятна света — как в меню */
      const blob = (cx,cy,r,col,a)=>{ const g2=x.createRadialGradient(cx,cy,0,cx,cy,r); g2.addColorStop(0,col.replace('%A%',a)); g2.addColorStop(1,col.replace('%A%','0')); x.fillStyle=g2; x.fillRect(cx-r,cy-r,r*2,r*2); };
      blob(c.width*0.16, c.height*0.08, 520, 'rgba(57,198,255,%A%)', '0.16');
      blob(c.width*0.86, c.height*0.42, 460, 'rgba(179,164,255,%A%)', '0.13');
      blob(c.width*0.42, c.height*0.94, 500, 'rgba(78,227,154,%A%)', '0.10');
      x.fillStyle = '#e8eef8';
      x.font = '700 40px -apple-system,Segoe UI,Roboto,Arial,sans-serif';
      x.fillText('TOPSPIN ARENA · единый меню-хаб', PAD, PAD+26);
      x.fillStyle = '#8ea5b8';
      x.font = '400 19px -apple-system,Segoe UI,Roboto,Arial,sans-serif';
      x.fillText('все экраны меню · мобильный 390×844 · 100 анализов и симуляций motion-системы', PAD, PAD+62);
      x.strokeStyle = 'rgba(142,165,184,.35)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(PAD, PAD+HEAD-26); x.lineTo(c.width-PAD, PAD+HEAD-26); x.stroke();
      const imgs = [];
      let loaded = 0;
      const draw = () => {
        if (loaded < shots.length) return;
        shots.forEach((s,i)=>{
          const col = i % COLS, row = (i / COLS) | 0;
          const px = PAD + col * (CW + GAP);
          const py = PAD + HEAD + row * (CH + 46 + GAP);
          x.save();
          x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 26; x.shadowOffsetY = 10;
          x.fillStyle = '#0d1424'; x.fillRect(px,py,CW,CH);
          x.restore();
          x.drawImage(imgs[i], px, py, CW, CH);
          x.strokeStyle = 'rgba(142,165,184,.35)'; x.lineWidth = 1.5;
          x.strokeRect(px+.5, py+.5, CW-1, CH-1);
          x.fillStyle = '#cfdcec';
          x.font = '600 17px -apple-system,Segoe UI,Roboto,Arial,sans-serif';
          x.fillText(s.title, px+2, py+CH+26);
        });
        document.title = 'ready';
      };
      shots.forEach((s,i)=>{
        const img = new Image();
        img.onload = ()=>{ imgs[i]=img; loaded++; draw(); };
        img.onerror = ()=>{ loaded++; draw(); };
        img.src = s.url;
      });
    </script>`);
  await collage.waitForFunction(() => document.title === 'ready', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 400));
  await collage.screenshot({ path: OUT });
  await browser.close();
  console.log('коллаж:', path.relative(ROOT, OUT));
})().catch((e) => { console.error(e); process.exit(1); });
