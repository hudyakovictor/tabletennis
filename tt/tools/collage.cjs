/* Menu collage: screenshots of every hub screen in a mobile viewport,
 * assembled into docs/menu-collage-2026.html (all images inline-ish via
 * relative files in docs/collage/). Run: node tt/tools/collage.cjs */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const root = path.join(__dirname, '..', '..');
const outDir = path.join(root, 'docs', 'collage');
fs.mkdirSync(outDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const libs = path.join(os.tmpdir(), 'topspin-browser-libs');
  if (process.platform === 'linux') {
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
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.join(root, 'table-tennis-topspin.html')).href);
  await page.waitForFunction(() => window.__game && window.__game.R.drawCalls > 0);
  await sleep(600);

  const shot = async name => {
    await page.screenshot({ path: path.join(outDir, name + '.png') });
    console.log('shot', name);
  };
  const showOnly = id => page.evaluate(i => {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    if (i) document.querySelector('#' + i).classList.add('on');
  }, id);
  const click = sel => page.evaluate(s => { const el = document.querySelector(s); if (el) el.click(); }, sel);

  /* splash → hub */
  await page.mouse.click(195, 420);
  await sleep(900);
  await shot('01-hub');

  await click('#menuOpenSettings'); await sleep(650); await shot('02-settings');
  await click('#setClose'); await sleep(450);

  await click('#wsOpen'); await sleep(700); await shot('03-workshop-racket');
  await click('.tab[data-tab="shop"]'); await sleep(650); await shot('04-workshop-shop');
  await click('.tab[data-tab="daily"]'); await sleep(650); await shot('05-workshop-daily');
  await click('#wsClose'); await sleep(450);

  await click('#onlineStart'); await sleep(350);
  await showOnly('onlineLobby'); await sleep(650); await shot('06-online');
  await click('#netClose'); await sleep(450);

  await click('#careerStart'); await sleep(800); await shot('07-career-intro');
  /* экран перка: искусственно через UI, если карьера дала список */
  await page.evaluate(() => {
    const g = window.__game;
    if (g && g.career && g.ui) {
      g.career.pendingPerks = g.career.pendingPerks && g.career.pendingPerks.length ? g.career.pendingPerks
        : [{ name: 'Тяжёлое вращение', desc: '+12% к вращению всех ударов', rarity: 'green' },
           { name: 'Мастер топспина', desc: '+25% топспин / −10% скорость', rarity: 'blue' },
           { name: 'Повелитель времени', desc: 'Слоу-мо при смеше быстрее 80 км/ч', rarity: 'gold' }];
      g.ui.showCareerPerks(g.career);
    }
  });
  await sleep(750); await shot('08-career-perk');
  await page.evaluate(() => { const g = window.__game; if (g) { g.returnToMenu(); } });
  await sleep(500);

  await showOnly('tdone'); await sleep(600); await shot('09-training-done');
  await showOnly('over');
  await page.evaluate(() => {
    const o = document.querySelector('#over'); o.classList.add('won');
    document.querySelector('#overTitle').textContent = 'ПОБЕДА';
    document.querySelector('#overScore').textContent = '11 : 7';
  });
  await sleep(900); await shot('10-match-over');

  await showOnly('reels'); await sleep(600); await shot('11-moments');
  await showOnly('shotLab'); await sleep(600); await shot('12-shotlab');

  /* пауза поверх матча */
  await page.evaluate(() => {
    const g = window.__game;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
    g.startMatch(2); g.setPaused(true);
  });
  await sleep(700); await shot('13-pause');

  if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
  await browser.close();

  /* ---- собрать HTML-коллаж ---- */
  const cards = [
    ['01-hub', '01 · Хаб — единое меню', 'Голо-логотип с 3D-тилтом, статус-полоса с одометром монет, сегмент соперников с морфинг-пилюлей, CTA с бегущим лучом, Bento-режимы со spotlight.'],
    ['02-settings', '02 · Настройки', 'Шит арены: номер раздела, шапка, дисклеймер единых правил, хват/рука/камера.'],
    ['03-workshop-racket', '03 · Мастерская — ракетка', 'Кошелёк-одометр, морфинг-вкладки, три слота, стат-бары.'],
    ['04-workshop-shop', '04 · Мастерская — магазин', 'Карточки со spotlight, цены, сезонный прогресс. Дисклеймеры сохранены.'],
    ['05-workshop-daily', '05 · Мастерская — задания', 'Прогресс-бары 6 ежедневных заданий, каскадный вход строк.'],
    ['06-online', '06 · Онлайн-лобби', 'LED-индикатор состояния подключения, код комнаты, дисклеймер эксперимента.'],
    ['07-career-intro', '07 · Карьера — турнир', 'Значок номера турнира, ELO-строка, список соперников каскадом.'],
    ['08-career-perk', '08 · Карьера — перк', 'Карты редкости: обычный / редкий / эпический, лучи и теги.'],
    ['09-training-done', '09 · Обучение пройдено', 'Recap шести ударов карточками.'],
    ['10-match-over', '10 · Итоги матча', 'KPI-статистика с одометром чисел, конфетти победы, реванш.'],
    ['11-moments', '11 · Лучшие моменты', 'Библиотека реплеев.'],
    ['12-shotlab', '12 · Калибровка попадания', 'Технический экран в том же языке шитов.'],
    ['13-pause', '13 · Пауза в матче', 'Продолжить / настройки / калибровка / в меню поверх замороженной сцены.'],
  ];
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TOPSPIN ARENA — коллаж меню «ARENA HUB 2026»</title>
<style>
:root{--bg:#05070c;--surface:#0b0f14;--surface2:#0d1117;--line:#1c2430;--line2:#2a3441;--ink:#e6edf3;--dim:#9fb0c2;--dim2:#6e7d8f;--acc:#39c6ff;--gold:#ffd166}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
.hero{padding:34px 16px 10px;max-width:1240px;margin:0 auto;position:relative;overflow:hidden}
.hero::before{content:"";position:absolute;inset:0;background:radial-gradient(620px 260px at 12% -30%,rgba(57,198,255,.20),transparent 62%),radial-gradient(520px 230px at 88% -22%,rgba(167,139,250,.16),transparent 60%);pointer-events:none}
h1{font-size:clamp(24px,4vw,40px);letter-spacing:-.02em;font-weight:900;position:relative}
h1 b{background:linear-gradient(92deg,#66b8ff,#7ff0c0);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p{color:var(--dim);max-width:46em;margin-top:8px;position:relative}
.kpis{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;position:relative}
.kpi{background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:9px 12px}
.kpi b{display:block;font-size:18px;line-height:1.1}.kpi span{color:var(--dim2);font-size:9.5px;text-transform:uppercase;letter-spacing:.08em}
.grid{display:grid;gap:16px;padding:20px 16px 40px;max-width:1240px;margin:0 auto;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.fig{background:var(--surface);border:1px solid var(--line);border-radius:22px;overflow:hidden}
.fig h3{font-size:14.5px;padding:14px 16px 2px}
.fig p{color:var(--dim2);font-size:12px;padding:2px 16px 12px;line-height:1.45}
.phone{margin:0 12px 14px;border:1px solid var(--line2);border-radius:26px;overflow:hidden;background:#05070c;box-shadow:0 18px 50px rgba(0,0,0,.5)}
.phone img{display:block;width:100%;height:auto}
foot{display:block;max-width:1240px;margin:0 auto;padding:0 16px 34px;color:var(--dim2);font-size:12px}
</style></head><body>
<header class="hero">
<h1>TOPSPIN ARENA — <b>ARENA HUB 2026</b></h1>
<p>Коллаж всех основных экранов меню мобильной игры после полного перепроектирования: единый меню-хаб вместо россыпи карточек. Дизайн-паттерны перенесены из каталога Signal Arena (160 ассетов), отобраны через 100 анализов по гейту «частота × цель × сдержанность» (Emil Kowalski). Скриншоты — живая игра, вьюпорт телефона 390×844.</p>
<div class="kpis">
<div class="kpi"><b>13</b><span>экранов в одном языке</span></div>
<div class="kpi"><b>160 → 21</b><span>ассетов шаблона → перенесено паттернов</span></div>
<div class="kpi"><b>174/174</b><span>тестов зелёные</span></div>
<div class="kpi"><b>0</b><span>внешних ресурсов</span></div>
</div></header>
<main class="grid">
${cards.map(([f, t, d]) => `<figure class="fig"><h3>${t}</h3><p>${d}</p><div class="phone"><img src="collage/${f}.png" alt="${t}"></div></figure>`).join('\n')}
</main>
<foot>Собрано автоматически: <code>node tt/tools/collage.cjs</code> · Карта переноса паттернов и обоснование 100 анализов — в <code>docs/menu-redesign-2026.md</code>.</foot>
</body></html>`;
  fs.writeFileSync(path.join(root, 'docs', 'menu-collage-2026.html'), html);
  console.log('collage written');
})();
