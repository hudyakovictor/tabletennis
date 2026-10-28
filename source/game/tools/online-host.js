#!/usr/bin/env node
/* =====================================================================
   ONLINE HOST — одна ссылка и один порт и для игры, и для реле.

       npm run online -- 3001        (пот поверх cloudflared/ngrok)

   Нужено только для теста онлайн-матча с телефона: игра берёт адрес реле
   из собственного location.origin (см. resolveNetUrl в tt/src/27_network.js),
   поэтому страница и WebSocket-релей должны жить на одном домене. Никаких
   ?net= в ссылке телеграма тогда не нужно.

   Само реле — боевое, из tt/server.js: тот же код комнат, те же лимиты.
   Статика — готовый play/index.html, больше ничего не отдаём.
   ===================================================================== */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createRelay } = require('../tt/server');

const PAGE = path.resolve(__dirname, '..', '..', '..', 'play', 'index.html');
const { server, rooms } = createRelay();

/* дефолтный handler реле отвечает «relay server» на любой путь; для теста
 * нужен HTML игры на /, а WS-апгрейд (он слушает любой путь) не трогаем */
server.removeAllListeners('request');
server.on('request', (req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/api/relay') {          // diagnostics: жив ли реле под тем же путём
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('TOPSPIN ARENA relay ok\n'); return;
  }
  if (url === '/rooms') {              // сколько комнат открыто — для отладки туннеля
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ rooms: [...rooms.keys()] }) + '\n'); return;
  }
  let html;
  try { html = fs.readFileSync(PAGE); } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('play/index.html не найден: собери его — npm run build\n'); return;
  }
  const enc = (req.headers['accept-encoding'] || '');
  if (enc.includes('gzip')) {
    const gz = zlib.gzipSync(html, { level: 6 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' });
    res.end(gz);
  } else {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
  }
});

const port = Number(process.argv[2] || process.env.PORT || 3001);
server.listen(port, '0.0.0.0', () => {
  console.log(`ONLINE HOST  http://localhost:${port}  (игра + реле на /api/relay)`);
  console.log(`страница: ${PAGE}`);
});
