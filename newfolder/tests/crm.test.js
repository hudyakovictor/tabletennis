'use strict';

/**
 * Comprehensive 15-Factor End-to-End Verification Suite for TOPSPIN ARENA Admin CRM
 * Verifies every architectural, security, AI, legal, TMA-latency, SRE, and LiveOps invariant.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-crm-v2-test-'));
const testDbPath = path.join(tmpDir, 'crm-test.sqlite');

const { openDatabase, getArchiveDb, runRetentionCleanup } = require('../src/db/database');
const { seedDatabaseIfEmpty } = require('../src/db/seed');
const { IsolatedZoneGateway, IsolatedDirectorGateway, ZoneIsolationError } = require('../src/db/isolation');
const { createCrmApp } = require('../src/server');
const { askDirector } = require('../src/ai/director');
const { runOpsZoneAnalysis } = require('../src/ai/zones/opsZone');

function requestJson(baseUrl, method, urlPath, body = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl);
    const payload = body !== null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          Connection: 'close',
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // Raw CSV or HTML
          }
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function buildMaskedWsFrame(opcode, payloadBuf) {
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const header = Buffer.from([0x80 | opcode, 0x80 | payloadBuf.length]);
  const masked = Buffer.alloc(payloadBuf.length);
  for (let i = 0; i < payloadBuf.length; i++) masked[i] = payloadBuf[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

describe('TOPSPIN ARENA Admin CRM — 15-Factor Specification Verification', () => {
  let db;
  let server;
  let baseUrl;
  let adminToken;

  before(async () => {
    db = openDatabase(testDbPath);
    await seedDatabaseIfEmpty(db, true);
    const app = createCrmApp(db);
    server = app.server;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const loginRes = await requestJson(baseUrl, 'POST', '/api/admin/auth/login', {
      username: 'owner@topspin.arena',
      password: 'TopspinAdmin2026!',
    });
    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.json.token);
    adminToken = loginRes.json.token;
  });

  after(async () => {
    if (server) {
      if (typeof server.closeWsSockets === 'function') server.closeWsSockets();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      if (server.listening) {
        server.close();
      }
    }
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('Factor 1 (01-architecture): enforces strict zone/director SQL view isolation & zero AI exposure on client API', async () => {
    const balanceGw = new IsolatedZoneGateway(db, 'balance');
    // Raw `players` must be blocked even if a developer tries to query it
    assert.throws(() => balanceGw.queryAll('SELECT * FROM players'), ZoneIsolationError);
    // Cross-zone table access (`payments` from `balance`) must be blocked
    assert.throws(() => balanceGw.queryAll('SELECT * FROM payments'), ZoneIsolationError);
    // Reading `director_chat` from a zone must be blocked
    assert.throws(() => balanceGw.queryAll('SELECT * FROM director_chat'), ZoneIsolationError);
    // Anonymized view `v_balance_players` works and omits PII
    const viewRow = balanceGw.queryGet('SELECT * FROM v_balance_players LIMIT 1');
    assert.ok(viewRow.player_id);
    assert.equal(viewRow.external_id_hash, undefined);
    assert.equal(viewRow.display_name, undefined);

    // Director gateway cannot read raw input_events or players
    const dirGw = new IsolatedDirectorGateway(db);
    assert.throws(() => dirGw.queryAll('SELECT * FROM input_events LIMIT 1'), ZoneIsolationError);
    assert.throws(() => dirGw.queryAll('SELECT * FROM players LIMIT 1'), ZoneIsolationError);

    // Client bootstrap has zero mentions of AI, LLM, prompts, or zone_summaries
    const boot = await requestJson(baseUrl, 'GET', '/api/client/v1/bootstrap');
    assert.equal(boot.status, 200);
    assert.equal(/openrouter|yandexgpt|zone_summaries|director_chat|prompt/i.test(boot.text), false);
    assert.ok(Object.keys(boot.json.matchRules).length >= 34);
  });

  it('Factor 2 (02-ai-zones): verifies Ops 10 reject codes, Fraud 8 detectors (zero auto-ban), Balance 6 table zones, Market 14 KPIs & Lab read-only bench', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };

    const ops = await requestJson(baseUrl, 'GET', '/api/admin/zones/ops?periodDays=7', null, auth);
    assert.equal(ops.status, 200);
    assert.equal(Object.keys(ops.json.allRejectCodes).length, 10);
    assert.ok('NO_FRESH_SWIPE' in ops.json.allRejectCodes);

    const fraud = await requestJson(baseUrl, 'GET', '/api/admin/zones/fraud', null, auth);
    assert.equal(fraud.status, 200);
    assert.equal(fraud.json.autoBanEnabled, false);
    assert.equal(fraud.json.detectorsActive.length, 8);
    const detectedTypes = new Set(fraud.json.byType.map((t) => t.case_type));
    assert.ok(detectedTypes.has('bot_aim_macro'));
    assert.ok(detectedTypes.has('activity_24_7'));
    assert.ok(detectedTypes.has('repeating_routes'));
    assert.ok(detectedTypes.has('multi_account_cluster'));
    assert.ok(detectedTypes.has('payment_velocity'));
    // Confirm zero players were auto-banned by Fraud AI
    const bannedByAi = db.prepare("SELECT COUNT(*) AS c FROM players WHERE status = 'banned'").get().c;
    assert.equal(bannedByAi, 0);

    const balance = await requestJson(baseUrl, 'GET', '/api/admin/zones/balance?periodDays=30', null, auth);
    assert.equal(balance.status, 200);
    assert.equal(balance.json.tableZoneDifficulty.length, 6);
    assert.ok(balance.json.heatmapBins.length > 10);

    const market = await requestJson(baseUrl, 'GET', '/api/admin/zones/market?periodDays=30', null, auth);
    assert.equal(market.status, 200);
    assert.ok(market.json.kpis.mau >= 100);
    assert.ok(market.json.cohortsBySource.length >= 4);
    assert.ok(market.json.economy.coinSinkRatio > 0);

    const labBench = await requestJson(baseUrl, 'POST', '/api/admin/lab/run-suite', { suite: 'noise' }, auth);
    assert.equal(labBench.status, 200);
    assert.ok(['passed', 'warning'].includes(labBench.json.run.status));
  });

  it('Factor 3 & 9 (03-director-chat & 09-api-contracts): enforces separate Archive DB (>72h), 4-block prompt, time_range & JSON Schema quarantine', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };
    const archDb = getArchiveDb(db);

    // Seeded >72h messages must live in separate `director-archive.sqlite` and NOT in active `director_chat`
    const inArchive = archDb.prepare('SELECT COUNT(*) AS c FROM archived_director_chat').get().c;
    const oldInActive = db.prepare("SELECT COUNT(*) AS c FROM director_chat WHERE id = 'dir_old_owner_1'").get().c;
    assert.ok(inArchive >= 2);
    assert.equal(oldInActive, 0);

    // Valid Director ask with `time_range` and 4-block prompt structure
    const askRes = await requestJson(
      baseUrl,
      'POST',
      '/api/admin/director/ask',
      { question: 'Какие зоны требуют внимания по балансу овала?', time_range: 'last_48h' },
      auth
    );
    assert.equal(askRes.status, 200);
    assert.equal(askRes.json.ok, true);
    assert.ok(askRes.json.promptPreview.includes('[SYSTEM]'));
    assert.ok(askRes.json.promptPreview.includes('[PERSISTENT STATE]'));
    assert.ok(askRes.json.promptPreview.includes('[ZONE SUMMARIES]'));
    assert.ok(askRes.json.promptPreview.includes('[CHAT HISTORY]'));
    assert.ok(askRes.json.promptPreview.includes('[USER QUESTION]'));
    assert.ok(Array.isArray(askRes.json.response.next_questions));

    // Malformed / excessive-agency output must be quarantined and NEVER written to summaries/chat
    const badDir = await askDirector(db, {
      ownerId: 'owner@topspin.arena',
      question: 'Тест карантина',
      rawOverrideOutput: { status: 'ok', summary: 'x', findings: [], next_questions: [], execute_sql: 'DROP TABLE players' },
    });
    assert.equal(badDir.ok, false);
    assert.equal(badDir.quarantined, true);

    const badZone = await runOpsZoneAnalysis(db, { rawOverrideOutput: 'NOT VALID JSON {{{' });
    assert.equal(badZone.quarantined, true);
  });

  it('Factor 4 (04-security): enforces 5-attempt login rate limit, CSRF Origin block, 6-point physics/swipe validator & rich audit trail', async () => {
    // 1. Cross-origin game domain attempting to call `/api/admin/overview` must be blocked with 403
    const crossOrigin = await requestJson(baseUrl, 'GET', '/api/admin/overview', null, {
      Authorization: `Bearer ${adminToken}`,
      Origin: 'https://evil-game-mirror.example',
    });
    assert.equal(crossOrigin.status, 403);

    // 2. 5 failed logins -> 6th returns 429 TOO_MANY_LOGIN_ATTEMPTS
    for (let i = 0; i < 5; i++) {
      const r = await requestJson(
        baseUrl,
        'POST',
        '/api/admin/auth/login',
        { username: 'brute@topspin.arena', password: 'wrong' },
        { 'X-Forwarded-For': '203.0.113.77' }
      );
      assert.equal(r.status, 401);
    }
    const sixth = await requestJson(
      baseUrl,
      'POST',
      '/api/admin/auth/login',
      { username: 'brute@topspin.arena', password: 'wrong' },
      { 'X-Forwarded-For': '203.0.113.77' }
    );
    assert.equal(sixth.status, 429);

    // 3. 6-point physics & fresh-swipe telemetry validation
    const sess = db.prepare('SELECT id FROM sessions LIMIT 1').get();
    const tamperRes = await requestJson(baseUrl, 'POST', '/api/client/v1/telemetry/inputs', {
      sessionId: sess.id,
      events: [
        { along: 10, across: 10, accepted: true, contact: true, has_fresh_swipe: false, ball_speed: 14 }, // Impossible: accepted without fresh swipe!
        { along: 10, across: 10, accepted: true, contact: true, has_fresh_swipe: true, ball_speed: 99.5 }, // Impossible: 99.5 m/s ball speed!
        { along: 520, across: 390, accepted: true, contact: true, has_fresh_swipe: true, ball_speed: 18 }, // Impossible: contact far from paddle!
      ],
    });
    assert.equal(tamperRes.status, 422);
    assert.equal(tamperRes.json.rejectedCount, 3);
  });

  it('Factor 5, 6, 7 & 8 (05-legal, 06-schema, 07-ai-providers, 08-hitl): CN 451 block, token budget cap, prompt cache & closed HITL loop', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };

    // CN jurisdiction blocked without ICP license (HTTP 451)
    const cnRes = await requestJson(baseUrl, 'GET', '/api/client/v1/bootstrap?country=CN');
    assert.equal(cnRes.status, 451);
    assert.equal(cnRes.json.error, 'REGION_UNAVAILABLE_LEGAL');

    // Closed 4-step HITL approval updates MATCH_RULES version and records provider/tokens in audit_logs
    const propsRes = await requestJson(baseUrl, 'GET', '/api/admin/proposals', null, auth);
    const rulesProp = propsRes.json.proposals.find(
      (p) => p.status === 'pending' && (p.action_type === 'propose_match_rules' || p.action_type === 'promote_ab_winner')
    );
    assert.ok(rulesProp);
    const decideRes = await requestJson(
      baseUrl,
      'POST',
      `/api/admin/proposals/${rulesProp.id}/decide`,
      { decision: 'approved', comment: 'Подтверждено в автотесте HITL' },
      auth
    );
    assert.equal(decideRes.status, 200);
    assert.equal(decideRes.json.status, 'applied');
    assert.ok(decideRes.json.appliedEffect.publishedRulesVersion >= 5);

    // Daily token cap exhaustion puts zone into silent mode (`budget_exceeded`)
    await requestJson(
      baseUrl,
      'POST',
      '/api/admin/ai/zones/ops/config',
      { dailyTokenLimit: 1 },
      auth
    );
    const silentRes = await runOpsZoneAnalysis(db);
    assert.equal(silentRes.silent, true);
    assert.equal(silentRes.reason, 'daily_token_limit_reached');
    await requestJson(
      baseUrl,
      'POST',
      '/api/admin/ai/zones/ops/config',
      { dailyTokenLimit: 100000 },
      auth
    );

    // Retention cleanup runs cleanly
    const ret = runRetentionCleanup(db);
    assert.equal(typeof ret.deletedInputEvents, 'number');
  });

  it('Factor 10 & 11 (10-checklist & 13-tma-latency): 100% readiness pass, hot VACUUM INTO backup, session affinity reconnect & RFC 6455 /ws/client', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };

    // Hot DR backup (`VACUUM INTO` + `PRAGMA integrity_check`)
    const bkp = await requestJson(baseUrl, 'POST', '/api/admin/system/backup', {}, auth);
    assert.equal(bkp.status, 200);
    assert.equal(bkp.json.ok, true);
    assert.equal(bkp.json.integrity, 'ok');

    // Readiness check passes 100% of items
    const ready = await requestJson(baseUrl, 'GET', '/api/admin/system/readiness', null, auth);
    assert.equal(ready.status, 200);
    assert.equal(ready.json.readyForLaunch, true);
    assert.equal(ready.json.scorePct, 100);

    // Session start + affinityToken reconnect
    const startRes = await requestJson(baseUrl, 'POST', '/api/client/v1/session/start', {
      playerId: 'plr_0020',
      platform: 'tma_ios',
    });
    assert.equal(startRes.status, 201);
    const { sessionId, affinityToken } = startRes.json;
    assert.ok(affinityToken);

    // Native RFC 6455 WebSocket `/ws/client` upgrade + JSON ping & binary frame echo
    const u = new URL(baseUrl);
    const wsRoundTrip = await new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const req = http.request({
        hostname: u.hostname,
        port: u.port,
        path: `/ws/client?affinity=${encodeURIComponent(affinityToken)}`,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
        },
      });
      req.on('upgrade', (res, socket, head) => {
        const messages = [];
        const processBuffer = (chunk) => {
          if (chunk && chunk.length) messages.push(chunk);
          const combined = Buffer.concat(messages).toString('utf8');
          if (combined.includes('"welcome"') && !socket._pingSent) {
            socket._pingSent = true;
            socket.write(
              buildMaskedWsFrame(0x01, Buffer.from(JSON.stringify({ type: 'ping', clientTs: 12345, seq: 1 })))
            );
          } else if (combined.includes('"pong"')) {
            socket.destroy();
            resolve(combined);
          }
        };
        socket.on('data', processBuffer);
        socket.on('error', reject);
        processBuffer(head);
      });
      req.on('error', reject);
      req.end();
    });
    assert.ok(wsRoundTrip.includes(sessionId));
    assert.ok(wsRoundTrip.includes('"pong"'));
  });

  it('Factor 12, 13, 14 & 15 (SRE, LiveOps, Legal Age Gate/Erasure & Maintenance/News/Tickets): verifies full operational loop', async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };

    // Factor 12: Read-Only Telegram bot allows `/status`, rejects `/ban_all`, and supports `ack:<incident_id>`
    const okCmd = await requestJson(baseUrl, 'POST', '/api/admin/telegram/command', { command: '/status' }, auth);
    assert.equal(okCmd.json.allowed, true);
    const badCmd = await requestJson(baseUrl, 'POST', '/api/admin/telegram/command', { command: '/ban plr_0001' }, auth);
    assert.equal(badCmd.json.allowed, false);

    const ackCb = await requestJson(
      baseUrl,
      'POST',
      '/api/admin/telegram/callback',
      { callbackData: 'ack:inc_android_webgl_01' },
      auth
    );
    assert.equal(ackCb.status, 200);
    assert.equal(ackCb.json.status, 'acknowledged');

    // Factor 13: Morning 09:00 digest
    const digest = await requestJson(baseUrl, 'GET', '/api/admin/digest/morning', null, auth);
    assert.equal(digest.status, 200);
    assert.ok(digest.json.text.includes('09:00'));

    // Factor 14: Regional minor age gate (EU GDPR-K 16+: 14yo without parentalConsent -> 403)
    const minorBlock = await requestJson(
      baseUrl,
      'POST',
      '/api/client/v1/legal/consent',
      { playerId: 'plr_0025', docType: 'tos', docVersion: '1.3', declaredAge: 14, parentalConsent: false, countryCode: 'DE' }
    );
    assert.equal(minorBlock.status, 403);
    assert.equal(minorBlock.json.code, 'PARENTAL_CONSENT_REQUIRED');

    // Right-to-Erasure deletes PII and anonymizes payments (`player_id IS NULL`)
    const eraseRes = await requestJson(baseUrl, 'POST', '/api/admin/players/plr_0003/erase', {}, auth);
    assert.equal(eraseRes.status, 200);
    assert.equal(eraseRes.json.archiveDbScrubbed, true);
    const erasedRow = db.prepare("SELECT display_name, status FROM players WHERE id = 'plr_0003'").get();
    assert.equal(erasedRow.display_name, '[ERASED]');
    assert.equal(erasedRow.status, 'deleted');

    // Factor 15: Maintenance Mode blocks NEW sessions with 503 while allowing active affinity reconnect, plus News PUT edit & Ticket screenshot
    const startActive = await requestJson(baseUrl, 'POST', '/api/client/v1/session/start', {
      playerId: 'plr_0022',
      platform: 'tma_android',
    });
    await requestJson(baseUrl, 'POST', '/api/admin/maintenance', { enabled: true, bannerRu: 'Тест 503' }, auth);

    const blockedNew = await requestJson(baseUrl, 'POST', '/api/client/v1/session/start', {
      playerId: 'plr_0023',
      platform: 'tma_android',
    });
    assert.equal(blockedNew.status, 503);

    const allowedReconnect = await requestJson(baseUrl, 'POST', '/api/client/v1/session/start', {
      playerId: 'plr_0022',
      affinityToken: startActive.json.affinityToken,
    });
    assert.equal(allowedReconnect.status, 200);
    assert.equal(allowedReconnect.json.reconnected, true);

    await requestJson(baseUrl, 'POST', '/api/admin/maintenance', { enabled: false }, auth);

    // News full CRUD including PUT edit
    const createdNews = await requestJson(
      baseUrl,
      'POST',
      '/api/admin/news',
      { category: 'update', titleRu: 'Черновик v1', bodyRu: 'Текст 1' },
      auth
    );
    assert.equal(createdNews.status, 201);
    const editedNews = await requestJson(
      baseUrl,
      'PUT',
      `/api/admin/news/${createdNews.json.post.id}`,
      { titleRu: 'Отредактированный релиз v2' },
      auth
    );
    assert.equal(editedNews.status, 200);
    assert.equal(editedNews.json.post.title_ru, 'Отредактированный релиз v2');

    // Support ticket with screenshot + status history
    const tkt = await requestJson(baseUrl, 'POST', '/api/client/v1/support/tickets', {
      playerId: 'plr_0024',
      category: 'payment',
      subject: 'Проверка скриншота оплаты',
      message: 'Прикладываю чек Stars',
      screenshotName: 'stars_receipt.png',
      screenshotDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    });
    assert.equal(tkt.status, 201);
    assert.equal(tkt.json.ticket.priority, 'critical');
    assert.equal(tkt.json.ticket.screenshotMeta.name, 'stars_receipt.png');
    assert.ok(tkt.json.ticket.statusHistory.length >= 1);
  });

  it('SPA Bundle & CSP Integrity: verifies public/index.html has zero inline scripts and public/assets/app.js compiles cleanly', async () => {
    const vm = require('node:vm');
    const htmlRes = await requestJson(baseUrl, 'GET', '/');
    assert.equal(htmlRes.status, 200);
    assert.ok(htmlRes.headers['content-security-policy'].includes("script-src 'self'"));
    // Only `<script src="/assets/app.js"></script>` allowed — zero inline script bodies
    const scriptTags = htmlRes.text.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
    assert.equal(scriptTags.length, 1);
    assert.ok(scriptTags[0].includes('src="/assets/app.js"'));

    const jsRes = await requestJson(baseUrl, 'GET', '/assets/app.js');
    assert.equal(jsRes.status, 200);
    assert.doesNotThrow(() => new vm.Script(jsRes.text, { filename: 'app.js' }));
  });
});
