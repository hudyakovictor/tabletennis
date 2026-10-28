'use strict';

/**
 * TOPSPIN ARENA — Admin CRM & Game Client HTTP + Native RFC 6455 WebSocket Server
 *
 * Security, TMA Low-Latency & Arena Live Preview Compatibility:
 * - Binds to `0.0.0.0:4100`.
 * - Strict CSP forbidding inline scripts & external script origins (`04-security.md`).
 * - CSRF / Origin separation: `/api/admin/*` rejects external game-client origins (`403`).
 * - Native zero-dependency RFC 6455 WebSocket `/ws/client` (`13-telegram-miniapp-latency.md`):
 *   supports compact binary (`0x02`) & JSON (`0x01`) frames, ultra-low-latency RTT echo,
 *   and 25-second server-to-client keep-alive Ping (`0x09`) so TMA mobile NAT never drops sockets.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { CONFIG, PING_THRESHOLDS } = require('./config');
const { getDb, openDatabase, runRetentionCleanup } = require('./db/database');
const { seedDatabaseIfEmpty } = require('./db/seed');
const { verifySessionAffinityToken } = require('./security/auth');
const { setActiveWsClientsCount, recordHttpRequestMetric } = require('./services/observability');
const { handleAdminRoute } = require('./routes/adminRoutes');
const { handleClientRoute } = require('./routes/clientRoutes');

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
});

function buildSecurityHeaders(req, pathname) {
  // Note: allow Arena preview iframe embedding when `CRM_STRICT_FRAME_GUARD` is not forced,
  // while keeping strict script-src 'self' and object-src 'none' (04-security.md).
  const strictFrame = process.env.CRM_STRICT_FRAME_GUARD === '1';
  const headers = {
    'Content-Security-Policy': [
      "default-src 'self';",
      "script-src 'self';",
      "style-src 'self' 'unsafe-inline';",
      "img-src 'self' data: blob:;",
      "font-src 'self' data:;",
      "connect-src 'self' ws: wss:;",
      "object-src 'none';",
      "base-uri 'self';",
      "form-action 'self';",
      strictFrame ? "frame-ancestors 'none';" : '',
    ]
      .filter(Boolean)
      .join(' '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (strictFrame) {
    headers['X-Frame-Options'] = 'DENY';
  }

  const origin = req.headers['origin'];
  if (origin) {
    const reqHost = req.headers['host'] || '';
    const sameHostOrigin = origin === `https://${reqHost}` || origin === `http://${reqHost}`;

    if (pathname.startsWith('/api/admin/')) {
      if (sameHostOrigin || CONFIG.allowedOrigins.includes(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
        headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
        headers['Vary'] = 'Origin';
      }
    } else if (pathname.startsWith('/api/client/v1/')) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Geo-Country';
      headers['Vary'] = 'Origin';
    }
  }
  return headers;
}

function readJsonBody(req, maxBytes = 768 * 1024) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return resolve({});
    }
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Payload too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Malformed JSON request body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// Native RFC 6455 WebSocket Frame Helpers for `/ws/client` (13-telegram-miniapp-latency.md)
// ============================================================================
function encodeWsFrame(opcode, payloadBuf) {
  const len = payloadBuf.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payloadBuf]);
}

function decodeWsFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let cursor = offset + 2;

    if (payloadLen === 126) {
      if (cursor + 2 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (payloadLen === 127) {
      if (cursor + 8 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }

    const maskBytes = masked ? 4 : 0;
    if (cursor + maskBytes + payloadLen > buffer.length) break;

    let payload = buffer.subarray(cursor + maskBytes, cursor + maskBytes + payloadLen);
    if (masked) {
      const mask = buffer.subarray(cursor, cursor + 4);
      const unmasked = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        unmasked[i] = payload[i] ^ mask[i & 3];
      }
      payload = unmasked;
    }

    frames.push({ opcode, payload });
    offset = cursor + maskBytes + payloadLen;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function attachClientWebSocketGateway(server) {
  const wsSockets = new Set();
  server.closeWsSockets = () => {
    for (const s of wsSockets) {
      try {
        s.destroy();
      } catch {
        // Ignore
      }
    }
    wsSockets.clear();
  };

  server.on('upgrade', (req, socket) => {
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (urlObj.pathname !== '/ws/client') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const secKey = req.headers['sec-websocket-key'];
    if (!secKey) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const accept = crypto
      .createHash('sha1')
      .update(secKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const affinityToken = urlObj.searchParams.get('affinity');
    const affinity = affinityToken ? verifySessionAffinityToken(affinityToken) : null;

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n')
    );

    socket.setNoDelay(true);
    wsSockets.add(socket);
    setActiveWsClientsCount(wsSockets.size);

    // Send initial welcome frame with node affinity & warnThresholdMs (zero AI mentions!)
    const welcomeJson = JSON.stringify({
      type: 'welcome',
      serverTs: Date.now(),
      reconnectedSessionId: affinity?.sid || null,
      nodeId: affinity?.nodeId || 'ru-msk-tma-01',
      keepAliveSec: 25,
      warnThresholdMs: PING_THRESHOLDS.warnClientThresholdMs,
    });
    socket.write(encodeWsFrame(0x01, Buffer.from(welcomeJson, 'utf8')));

    // 25s Server Keep-Alive Ping (13-telegram-miniapp-latency.md: 20–30s interval)
    const keepAliveTimer = setInterval(() => {
      if (!socket.destroyed) {
        socket.write(encodeWsFrame(0x09, Buffer.from('ka')));
      }
    }, 25_000);
    keepAliveTimer.unref();

    let rxBuf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      rxBuf = Buffer.concat([rxBuf, chunk]);
      if (rxBuf.length > 128 * 1024) {
        socket.destroy();
        return;
      }
      const decoded = decodeWsFrames(rxBuf);
      rxBuf = decoded.remaining;

      for (const frame of decoded.frames) {
        if (frame.opcode === 0x08) {
          // Close frame
          socket.write(encodeWsFrame(0x08, Buffer.alloc(0)));
          socket.end();
          return;
        }
        if (frame.opcode === 0x09) {
          // Client Ping -> Pong
          socket.write(encodeWsFrame(0x0a, frame.payload));
          continue;
        }
        if (frame.opcode === 0x02) {
          // Compact Binary state/ping frame: echo 8-byte server timestamp + client payload header
          const respBuf = Buffer.alloc(8 + Math.min(16, frame.payload.length));
          respBuf.writeBigUInt64BE(BigInt(Date.now()), 0);
          frame.payload.copy(respBuf, 8, 0, Math.min(16, frame.payload.length));
          socket.write(encodeWsFrame(0x02, respBuf));
          continue;
        }
        if (frame.opcode === 0x01) {
          // JSON message (`ping` or `input_tick`)
          try {
            const msg = JSON.parse(frame.payload.toString('utf8'));
            const reply = {
              type: msg.type === 'ping' ? 'pong' : 'ack',
              clientTs: msg.clientTs ?? null,
              serverTs: Date.now(),
              seq: msg.seq ?? 0,
            };
            socket.write(encodeWsFrame(0x01, Buffer.from(JSON.stringify(reply), 'utf8')));
          } catch {
            // Ignore malformed text frame
          }
        }
      }
    });

    const cleanup = () => {
      clearInterval(keepAliveTimer);
      wsSockets.delete(socket);
      setActiveWsClientsCount(wsSockets.size);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  });
}

function createCrmApp(customDb = null) {
  const db = customDb || getDb();
  const publicDir = path.join(CONFIG.rootDir, 'public');

  const server = http.createServer(async (req, res) => {
    const startedMs = performance.now();
    const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const baseHeaders = buildSecurityHeaders(req, pathname);
    const clientIp =
      (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() ||
      req.socket.remoteAddress ||
      '127.0.0.1';

    const sendResponse = (status, bodyObj, extraHeaders = {}, rawText = null, contentType = null) => {
      const durationMs = +(performance.now() - startedMs).toFixed(2);
      if (pathname.startsWith('/api/')) {
        recordHttpRequestMetric({
          method: req.method,
          pathname,
          statusCode: status,
          durationMs,
        });
      }

      const headers = {
        ...baseHeaders,
        'Content-Type': contentType || 'application/json; charset=utf-8',
        ...extraHeaders,
      };
      res.writeHead(status, headers);
      if (rawText !== null) {
        res.end(rawText);
      } else {
        res.end(JSON.stringify(bodyObj));
      }
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, baseHeaders);
      res.end();
      return;
    }

    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        sendResponse(200, {
          ok: true,
          service: 'topspin-arena-admin-crm',
          version: '2.0.0',
          region: CONFIG.primaryRegion,
          wsGateway: '/ws/client',
          timeUtc: new Date().toISOString(),
        });
        return;
      }

      // Block cross-origin game-client calls to `/api/admin/*` (04-security.md CSRF/Origin guard)
      const origin = req.headers['origin'];
      if (origin && pathname.startsWith('/api/admin/') && !baseHeaders['Access-Control-Allow-Origin']) {
        sendResponse(403, {
          error: 'FORBIDDEN_ADMIN_ORIGIN',
          message: 'API админки недоступен с внешнего игрового домена',
        });
        return;
      }

      if (pathname.startsWith('/api/admin/')) {
        const body = await readJsonBody(req);
        const result = await handleAdminRoute(db, req, pathname, urlObj, body, clientIp);
        if (!result) {
          sendResponse(404, { error: 'NOT_FOUND', path: pathname });
          return;
        }
        sendResponse(
          result.status,
          result.json || {},
          result.headers || {},
          result.rawText ?? null,
          result.contentType ?? null
        );
        return;
      }

      if (pathname.startsWith('/api/client/v1/')) {
        const body = await readJsonBody(req);
        const result = await handleClientRoute(db, req, pathname, urlObj, body, clientIp);
        if (!result) {
          sendResponse(404, { error: 'NOT_FOUND', path: pathname });
          return;
        }
        sendResponse(result.status, result.json || {}, result.headers || {});
        return;
      }

      // Static Admin SPA Serving (zero inline scripts!)
      let relPath = pathname === '/' ? '/index.html' : pathname;
      const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
      let fullPath = path.join(publicDir, safePath);

      if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        fullPath = path.join(publicDir, 'index.html');
      }

      const ext = path.extname(fullPath).toLowerCase();
      const content = fs.readFileSync(fullPath);
      res.writeHead(200, {
        ...baseHeaders,
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      });
      res.end(content);
    } catch (err) {
      const code = err.statusCode || 500;
      sendResponse(code, { error: err.message || 'Internal Server Error' });
    }
  });

  attachClientWebSocketGateway(server);

  return { server, db };
}

async function startMainServer() {
  const db = getDb();
  await seedDatabaseIfEmpty(db, false);
  runRetentionCleanup(db);

  const { server } = createCrmApp(db);

  const timer = setInterval(() => {
    try {
      runRetentionCleanup(db);
    } catch {
      // Ignore background cleanup error
    }
  }, 30 * 60 * 1000);
  timer.unref();

  server.listen(CONFIG.port, CONFIG.host, () => {
    console.log(
      `[TOPSPIN ARENA Admin CRM v2] Listening on http://${CONFIG.host}:${CONFIG.port} (Primary Region: ${CONFIG.primaryRegion}, WS: /ws/client)`
    );
  });
  return server;
}

if (require.main === module) {
  startMainServer().catch((err) => {
    console.error('Failed to start Admin CRM:', err);
    process.exit(1);
  });
}

module.exports = {
  createCrmApp,
  openDatabase,
  startMainServer,
};
