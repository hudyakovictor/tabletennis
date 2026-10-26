#!/usr/bin/env node
/* TOPSPIN ARENA WebSocket relay. Run: npm run relay -- 3001 */
'use strict';
const http = require('node:http');
const { randomInt } = require('node:crypto');
const { WebSocketServer } = require('ws');

function createRelay() {
  const rooms = new Map();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('TOPSPIN ARENA relay server\n');
  });
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
  const send = (ws, obj) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  };
  function newCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do { code = Array.from({ length: 5 }, () => chars[randomInt(chars.length)]).join(''); }
    while (rooms.has(code));
    return code;
  }
  function leave(ws) {
    const room = rooms.get(ws._room);
    ws._room = null;
    if (!room) return;
    if (room.host === ws) {
      // A guest cannot simulate the departed host's match. Retire the room;
      // otherwise it becomes an unjoinable ghost, or a match with no host.
      rooms.delete(room.code);
      if (room.guest) {
        room.guest._room = null;
        send(room.guest, { type: 'peer_left', roomClosed: true });
      }
    } else if (room.guest === ws) {
      room.guest = null;
      send(room.host, { type: 'peer_left', roomClosed: false });
    }
  }
  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    // Oversized frames and socket errors must not crash the relay process.
    ws.on('error', () => {});
    ws.on('close', () => leave(ws));
    ws.on('message', data => {
      let msg;
      try { msg = JSON.parse(data); } catch (_) { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      const room = rooms.get(ws._room);
      switch (msg.type) {
        case 'join': {
          const requested = msg.room !== undefined && msg.room !== null && msg.room !== '';
          const code = requested && typeof msg.room === 'string' ? msg.room.trim().toUpperCase() : null;
          if (requested && (!code || !/^[A-Z0-9]{5}$/.test(code))) {
            send(ws, { type: 'error', message: 'Код комнаты: 5 букв или цифр' }); return;
          }
          if (room && room.code === code) return; // idempotent, never join yourself
          const target = requested ? rooms.get(code) : null;
          if (requested && !target) {
            send(ws, { type: 'error', message: 'Комната не найдена' }); return;
          }
          if (target && target.guest) {
            send(ws, { type: 'error', message: 'Комната заполнена' }); return;
          }
          // Validate first: a failed join must not evict a working room.
          leave(ws);
          if (target) {
            target.guest = ws;
            ws._room = code;
            send(ws, { type: 'assigned', side: -1, room: code });
            send(target.host, { type: 'ready' }); send(ws, { type: 'ready' });
          } else {
            const newRoom = { code: newCode(), host: ws, guest: null };
            rooms.set(newRoom.code, newRoom);
            ws._room = newRoom.code;
            send(ws, { type: 'assigned', side: 1, room: newRoom.code });
          }
          break;
        }
        case 'leave': leave(ws); break;
        case 'state':
        case 'point':
          if (room && room.host === ws) send(room.guest, msg);
          break;
        case 'input':
          if (room && room.guest === ws) send(room.host, msg);
          break;
        case 'ping': send(ws, { type: 'pong', t: msg.t }); break;
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) ws.terminate();
      else { ws.isAlive = false; ws.ping(); }
    }
  }, 10000);
  heartbeat.unref();
  server.on('close', () => clearInterval(heartbeat));
  return { server, wss, rooms };
}

if (require.main === module) {
  const port = Number(process.argv[2] || process.env.PORT || 3001);
  const { server } = createRelay();
  server.listen(port, '0.0.0.0', () => console.log(`TOPSPIN ARENA relay on port ${server.address().port}`));
}
module.exports = { createRelay };
