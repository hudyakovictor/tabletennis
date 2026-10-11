#!/usr/bin/env node
/* =====================================================================
 *  TOPSPIN ARENA — WebSocket relay server for online multiplayer.
 *
 *  Usage:  node server.js [port]
 *  Default port: 3001
 *
 *  Protocol:
 *    { type: 'join', room?: string }   — join or create a room
 *    { type: 'leave' }                 — leave current room
 *    { type: 'state', ... }            — host sends game state
 *    { type: 'input', ... }            — guest sends input
 *    { type: 'ping' }                  — latency probe
 * ===================================================================== */
'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.argv[2]) || 3001;
const rooms = new Map();   // roomCode → { host: ws, guest: ws, created: Date }

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcast(room, obj, exclude) {
  [room.host, room.guest].forEach(ws => {
    if (ws && ws !== exclude && ws.readyState === 1) send(ws, obj);
  });
}

function findRoom(ws) {
  for (const [code, room] of rooms) {
    if (room.host === ws || room.guest === ws) return { code, room };
  }
  return null;
}

function cleanUp(code) {
  const room = rooms.get(code);
  if (!room) return;
  if (!room.host && !room.guest) {
    rooms.delete(code);
    console.log(`  room ${code} deleted (empty)`);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('TOPSPIN ARENA relay server\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  console.log(`  client connected (total: ${wss.clients.size})`);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch(e) { return; }

    switch (msg.type) {
      case 'join': {
        // leave existing room first
        const existing = findRoom(ws);
        if (existing) {
          if (existing.room.host === ws) existing.room.host = null;
          if (existing.room.guest === ws) existing.room.guest = null;
          broadcast(existing.room, { type: 'peer_left' }, ws);
          cleanUp(existing.code);
          ws._room = null;
        }

        let code = msg.room;
        let room = code ? rooms.get(code) : null;
        let side;

        if (room && room.guest === null) {
          // join existing room as guest
          room.guest = ws;
          side = -1;
          console.log(`  client joined room ${code} as guest`);
          // both players ready
          send(ws, { type: 'assigned', side, room: code, peerId: ws._id });
          send(room.host, { type: 'ready' });
          send(ws, { type: 'ready' });
        } else {
          // create new room
          code = code || genRoomCode();
          room = { host: ws, guest: null, created: new Date() };
          rooms.set(code, room);
          side = 1;
          console.log(`  room ${code} created`);
          send(ws, { type: 'assigned', side, room: code, peerId: null });
        }
        ws._room = code;
        ws._side = side;
        break;
      }

      case 'leave': {
        const found = findRoom(ws);
        if (found) {
          if (found.room.host === ws) found.room.host = null;
          if (found.room.guest === ws) found.room.guest = null;
          broadcast(found.room, { type: 'peer_left' }, ws);
          cleanUp(found.code);
        }
        ws._room = null;
        break;
      }

      case 'state': {
        // relay from host to guest
        const found = findRoom(ws);
        if (found && found.room.guest && found.room.host === ws) {
          send(found.room.guest, msg);
        }
        break;
      }

      case 'input': {
        // relay from guest to host
        const found = findRoom(ws);
        if (found && found.room.host && found.room.guest === ws) {
          send(found.room.host, msg);
        }
        break;
      }

      case 'point': {
        const found = findRoom(ws);
        if (found) broadcast(found.room, msg, null);
        break;
      }

      case 'ping': {
        send(ws, { type: 'pong', t: Date.now() });
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log(`  client disconnected (total: ${wss.clients.size})`);
    const found = findRoom(ws);
    if (found) {
      if (found.room.host === ws) found.room.host = null;
      if (found.room.guest === ws) found.room.guest = null;
      broadcast(found.room, { type: 'peer_left' }, null);
      cleanUp(found.code);
    }
  });
});

// heartbeat to detect dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 10000);

server.listen(PORT, () => {
  console.log(`TOPSPIN ARENA relay server on port ${PORT}`);
});