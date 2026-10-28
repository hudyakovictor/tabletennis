'use strict';

/**
 * Player 360 for the game data the client writes: progress, the match journal and
 * the manual correction route. The correction endpoint is the only place where an
 * operator can change rating or wallet values, so it is tested for what it refuses
 * (no reason, out-of-range values) as much as for what it writes.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-admin-progress-test-'));
const testDbPath = path.join(tmpDir, 'admin-progress.sqlite');

const { openDatabase } = require('../src/db/database');
const { seedDatabaseIfEmpty } = require('../src/db/seed');
const { createCrmApp } = require('../src/server');

function rawRequest(baseUrl, method, urlPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, baseUrl);
    const payload = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          Connection: 'close',
          Origin: baseUrl,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
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
            /* non-JSON */
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

describe('Admin view of player progress and matches', () => {
  let db;
  let server;
  let baseUrl;
  let adminToken;
  let playerToken;
  let playerId;

  const admin = (method, urlPath, body = null) =>
    rawRequest(baseUrl, method, urlPath, { body, headers: { Authorization: `Bearer ${adminToken}` } });
  const client = (method, urlPath, body = null) =>
    rawRequest(baseUrl, method, urlPath, { body, headers: { Authorization: `Bearer ${playerToken}` } });

  before(async () => {
    db = openDatabase(testDbPath);
    await seedDatabaseIfEmpty(db, true);
    const app = createCrmApp(db);
    server = app.server;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const login = await rawRequest(baseUrl, 'POST', '/api/admin/auth/login', {
      body: { username: 'owner@topspin.arena', password: 'TopspinAdmin2026!' },
    });
    assert.equal(login.status, 200, login.text);
    adminToken = login.json.token;

    const initData = `dev_bypass=1&user_id=tg_admin_view_1&username=viewer&auth_date=${Math.floor(Date.now() / 1000)}`;
    const session = await rawRequest(baseUrl, 'POST', '/api/client/v1/auth/telegram', { body: { initData } });
    assert.equal(session.status, 200, session.text);
    playerToken = session.json.playerToken;
    playerId = session.json.playerId;

    /* Один матч с флагом: 11:4 за 30 с — темп невозможен, но результат принимается. */
    const match = await client('POST', '/api/client/v1/matches', {
      matchId: 'mt_admin_flag_1',
      playerScore: 11,
      opponentScore: 4,
      durationMs: 30_000,
      opponentRating: 1000,
    });
    assert.equal(match.status, 200, match.text);
    assert.equal(match.json.trust.suspicious, true);
  });

  after(async () => {
    if (typeof server.closeWsSockets === 'function') server.closeWsSockets();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows progress, the match journal and trust flags on the player card', async () => {
    const res = await admin('GET', `/api/admin/players/${playerId}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.progress.level, 1);
    assert.equal(res.json.progress.matches, 1);
    assert.equal(res.json.matchTotals.total, 1);
    assert.equal(res.json.matchTotals.suspicious, 1);
    assert.equal(res.json.recentMatches.length, 1);
    const [match] = res.json.recentMatches;
    assert.equal(`${match.player_score}:${match.opponent_score}`, '11:4');
    assert.equal(match.suspicious, 1);
    assert.ok(match.flags.includes('FAST_FINISH'), 'the reason for the flag must survive a round trip');
  });

  it('notifies the operator about a flagged match', async () => {
    const rows = db
      .prepare("SELECT kind, title FROM admin_notifications WHERE kind = 'fraud' ORDER BY created_at DESC")
      .all();
    assert.ok(rows.length >= 1, 'a flagged match must be visible without opening the player card');
    assert.match(rows[0].title, /FAST_FINISH/);
  });

  it('refuses a correction without a reason or with an impossible value', async () => {
    const noReason = await admin('POST', `/api/admin/players/${playerId}/progress`, { coins: 100 });
    assert.equal(noReason.status, 400);
    assert.equal(noReason.json.error, 'REASON_REQUIRED');

    const tooMuch = await admin('POST', `/api/admin/players/${playerId}/progress`, {
      rating: 9999,
      reason: 'проверка потолка',
    });
    assert.equal(tooMuch.status, 400);
    assert.equal(tooMuch.json.error, 'VALUE_OUT_OF_RANGE');
    assert.equal(tooMuch.json.field, 'rating');

    const nothing = await admin('POST', `/api/admin/players/${playerId}/progress`, { reason: 'пустая правка' });
    assert.equal(nothing.status, 400);
    assert.equal(nothing.json.error, 'NOTHING_TO_UPDATE');
  });

  it('applies a correction, keeps it in the audit chain and notifies', async () => {
    const res = await admin('POST', `/api/admin/players/${playerId}/progress`, {
      coins: 5000,
      rating: 1200,
      reason: 'возврат сохранения после сбоя клиента',
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.progress.coins, 5000);
    assert.equal(res.json.progress.rating, 1200);
    assert.deepEqual(res.json.changed.sort(), ['coins', 'rating']);

    const card = await admin('GET', `/api/admin/players/${playerId}`);
    assert.equal(card.json.progress.coins, 5000);
    assert.equal(card.json.progress.rating, 1200);

    const audit = db
      .prepare("SELECT actor_id, proposed_json, applied_json FROM audit_logs WHERE action = 'player.progress.correct' ORDER BY created_at DESC")
      .get();
    assert.ok(audit, 'a correction without an audit row is a silent edit');
    assert.equal(audit.actor_id, 'owner@topspin.arena');
    assert.equal(JSON.parse(audit.applied_json).coins, 5000);
    assert.equal(JSON.parse(audit.proposed_json).coins, 0);

    const note = db
      .prepare("SELECT title FROM admin_notifications WHERE kind = 'player' ORDER BY created_at DESC")
      .get();
    assert.ok(note && note.title.includes('Правка прогресса'));
  });

  it('lists matches with filters and the shared pagination shape', async () => {
    const clean = await client('POST', '/api/client/v1/matches', {
      matchId: 'mt_admin_clean_1',
      playerScore: 11,
      opponentScore: 9,
      durationMs: 240_000,
      opponentRating: 1000,
    });
    assert.equal(clean.status, 200, clean.text);
    assert.equal(clean.json.trust.suspicious, false);

    const flagged = await admin('GET', '/api/admin/matches?suspicious=1');
    assert.equal(flagged.status, 200, flagged.text);
    assert.equal(flagged.json.total, 1);
    assert.equal(flagged.json.items.length, 1);
    assert.equal(flagged.json.items[0].player_id, playerId);
    assert.ok(flagged.json.items[0].flags.includes('FAST_FINISH'));
    assert.ok(flagged.json.suspiciousCount >= 1);

    const mine = await admin('GET', `/api/admin/matches?playerId=${encodeURIComponent(playerId)}`);
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.json.total, 2);
    assert.equal(mine.json.items.length, 2);
    assert.ok(mine.json.items[0].created_at >= mine.json.items[1].created_at, 'newest match first');
    assert.equal(mine.json.page, 1);
    assert.ok(mine.json.totalPages >= 1);
  });

  it('keeps the journal closed for a player token', async () => {
    const res = await client('GET', '/api/admin/matches');
    assert.ok([401, 403].includes(res.status), `player token must not read the journal, got ${res.status}`);
  });
});
