'use strict';

/**
 * Game client API (`/api/client/v1/*`) — CORS boundary, Telegram signature and
 * the progress/matches/leaderboard/config surface added for the existing client.
 *
 * The client is a static bundle on Vercel and the API lives elsewhere, so a wrong
 * CORS decision is not cosmetic: `/me` returns the player's profile and progress
 * to anyone who holds the token. A reflected Origin would let any site read it.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-client-api-test-'));
const testDbPath = path.join(tmpDir, 'client-api.sqlite');

const { openDatabase } = require('../src/db/database');
const { seedDatabaseIfEmpty } = require('../src/db/seed');
const { createCrmApp } = require('../src/server');
const { CONFIG } = require('../src/config');

const VERCEL_ORIGIN = 'https://tabletennis-indexhtml.vercel.app';

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

describe('Game client API — CORS, auth and progress', () => {
  let db;
  let server;
  let baseUrl;
  let token;
  let playerId;

  const clientCall = (method, urlPath, body = null, headers = {}) =>
    rawRequest(baseUrl, method, urlPath, {
      body,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });

  /** The dev bypass only works while the bot token is empty and env ≠ production. */
  async function loginPlayer(telegramId) {
    const initData = `dev_bypass=1&user_id=${telegramId}&username=${telegramId}&auth_date=${Math.floor(
      Date.now() / 1000
    )}`;
    const res = await rawRequest(baseUrl, 'POST', '/api/client/v1/auth/telegram', { body: { initData } });
    assert.equal(res.status, 200, `login failed: ${res.text}`);
    return res.json;
  }

  before(async () => {
    db = openDatabase(testDbPath);
    await seedDatabaseIfEmpty(db, true);
    const app = createCrmApp(db);
    server = app.server;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const session = await loginPlayer('tg_client_api_1');
    token = session.playerToken;
    playerId = session.playerId;
  });

  after(async () => {
    if (typeof server.closeWsSockets === 'function') server.closeWsSockets();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('CORS boundary', () => {
    it('does not grant a foreign origin access to the client API', async () => {
      const res = await rawRequest(baseUrl, 'GET', '/api/client/v1/ping', {
        headers: { Origin: 'https://evil.example' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
      assert.equal(res.headers.vary, 'Origin');
    });

    it('does not answer a foreign preflight with an allow header', async () => {
      const res = await rawRequest(baseUrl, 'OPTIONS', '/api/client/v1/me', {
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
      });
      assert.equal(res.status, 204);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
    });

    it('allows the Vercel production origin from the whitelist', async () => {
      assert.ok(
        CONFIG.clientAllowedOrigins.includes(VERCEL_ORIGIN),
        'the shipped client origin must be in the default whitelist'
      );
      const res = await rawRequest(baseUrl, 'GET', '/api/client/v1/ping', {
        headers: { Origin: VERCEL_ORIGIN },
      });
      assert.equal(res.headers['access-control-allow-origin'], VERCEL_ORIGIN);
    });

    it('allows a localhost dev server outside production', async () => {
      const res = await rawRequest(baseUrl, 'GET', '/api/client/v1/ping', {
        headers: { Origin: 'http://localhost:5173' },
      });
      assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:5173');
    });

    it('keeps the admin API closed for the game origin', async () => {
      const res = await rawRequest(baseUrl, 'GET', '/api/admin/overview', {
        headers: { Origin: VERCEL_ORIGIN },
      });
      assert.equal(res.status, 403);
      assert.equal(res.json.error, 'FORBIDDEN_ADMIN_ORIGIN');
    });
  });

  describe('Telegram initData', () => {
    it('rejects a forged signature with 401', async () => {
      const res = await rawRequest(baseUrl, 'POST', '/api/client/v1/auth/telegram', {
        body: { initData: 'query_id=AA&user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef' },
      });
      assert.equal(res.status, 401);
      assert.equal(res.json.error, 'INVALID_TELEGRAM_INIT_DATA');
    });

    it('rejects a missing initData with 401', async () => {
      const res = await rawRequest(baseUrl, 'POST', '/api/client/v1/auth/telegram', { body: {} });
      assert.equal(res.status, 401);
      assert.equal(res.json.error, 'INVALID_TELEGRAM_INIT_DATA');
    });

    it('creates the player once and returns the same id on the next login', async () => {
      const again = await loginPlayer('tg_client_api_1');
      assert.equal(again.playerId, playerId);
    });
  });

  describe('Profile and progress', () => {
    it('requires a player token for /me', async () => {
      const res = await rawRequest(baseUrl, 'GET', '/api/client/v1/me');
      assert.equal(res.status, 401);
      assert.equal(res.json.error, 'PLAYER_AUTH_REQUIRED');
    });

    it('returns the default progress for a fresh player', async () => {
      const res = await clientCall('GET', '/api/client/v1/me');
      assert.equal(res.status, 200);
      assert.equal(res.json.player.playerId, playerId);
      assert.equal(res.json.progress.level, 1);
      assert.equal(res.json.progress.rating, 1000);
      assert.equal(res.json.progress.coins, 0);
    });

    it('rejects a level completed too fast', async () => {
      const res = await clientCall('POST', '/api/client/v1/progress/level-complete', {
        level: 2,
        durationMs: 3000,
        xp: 400,
      });
      assert.equal(res.status, 422);
      assert.equal(res.json.error, 'IMPLAUSIBLE_RESULT');
      assert.ok(res.json.reasons.includes('LEVEL_TOO_FAST'));
    });

    it('awards the level reward from the server and replays idempotently', async () => {
      const key = 'idem-level-2';
      const body = { level: 2, durationMs: 60_000, xp: 400 };
      const res = await clientCall('POST', '/api/client/v1/progress/level-complete', body, {
        'Idempotency-Key': key,
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.progress.level, 2);
      assert.equal(res.json.rewards.coins, 150);
      assert.equal(res.json.rewards.gems, 20);
      const coins = res.json.progress.coins;

      const replay = await clientCall('POST', '/api/client/v1/progress/level-complete', body, {
        'Idempotency-Key': key,
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.json.idempotentReplay, true);
      assert.equal(replay.json.progress.coins, coins, 'a replayed request must not pay twice');
    });

    it('rejects a level regression and an out-of-range level', async () => {
      const down = await clientCall('POST', '/api/client/v1/progress/level-complete', {
        level: 1,
        durationMs: 60_000,
      });
      assert.equal(down.status, 422);
      assert.ok(down.json.reasons.includes('LEVEL_REGRESSION'));

      const zero = await clientCall('POST', '/api/client/v1/progress/level-complete', {
        level: 0,
        durationMs: 60_000,
      });
      assert.equal(zero.status, 422);
      assert.ok(zero.json.reasons.includes('LEVEL_OUT_OF_RANGE'));
    });
  });

  describe('Matches', () => {
    it('rejects a match that is shorter than a real one', async () => {
      const res = await clientCall('POST', '/api/client/v1/matches', {
        playerScore: 11,
        opponentScore: 0,
        durationMs: 5_000,
      });
      assert.equal(res.status, 422);
      assert.ok(res.json.reasons.includes('DURATION_INVALID'));
    });

    it('rejects scores that table tennis cannot produce', async () => {
      const draw = await clientCall('POST', '/api/client/v1/matches', {
        playerScore: 11,
        opponentScore: 11,
        durationMs: 120_000,
      });
      assert.equal(draw.status, 422);
      assert.ok(draw.json.reasons.includes('SCORE_MARGIN'), '11:11 has no winner and no two-point gap');

      const unfinished = await clientCall('POST', '/api/client/v1/matches', {
        playerScore: 5,
        opponentScore: 3,
        durationMs: 120_000,
      });
      assert.equal(unfinished.status, 422);
      assert.ok(unfinished.json.reasons.includes('INCOMPLETE_SCORE'), 'a set ends only at 11+');

      const lopsided = await clientCall('POST', '/api/client/v1/matches', {
        playerScore: 20,
        opponentScore: 3,
        durationMs: 120_000,
      });
      assert.equal(lopsided.status, 422);
      assert.ok(lopsided.json.reasons.includes('SCORE_MARGIN'), 'past 11 the gap must be exactly two');
    });

    it('computes the rating itself and does not double-count a replay', async () => {
      const body = {
        matchId: 'mt_test_0001',
        mode: 'career',
        playerScore: 11,
        opponentScore: 8,
        durationMs: 150_000,
        opponentRating: 1050,
        bestRally: 12,
      };
      const res = await clientCall('POST', '/api/client/v1/matches', body);
      assert.equal(res.status, 200);
      assert.equal(res.json.replay, false);
      assert.equal(res.json.result.win, true);
      assert.ok(res.json.result.ratingDelta > 0, 'a win against a stronger player must add rating');
      assert.equal(res.json.progress.wins, 1);
      assert.equal(res.json.progress.matches, 1);
      assert.equal(res.json.progress.bestRally, 12);

      const replay = await clientCall('POST', '/api/client/v1/matches', body);
      assert.equal(replay.status, 200);
      assert.equal(replay.json.replay, true);
      assert.equal(replay.json.result.ratingDelta, res.json.result.ratingDelta);
      assert.equal(replay.json.progress.matches, 1, 'a replayed match must not be counted twice');
      assert.equal(replay.json.progress.wins, 1);
    });

    it('counts a loss and resets the streak', async () => {
      const res = await clientCall('POST', '/api/client/v1/matches', {
        playerScore: 4,
        opponentScore: 11,
        durationMs: 120_000,
        opponentRating: 1100,
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.result.win, false);
      assert.ok(res.json.result.ratingDelta < 0);
      assert.equal(res.json.progress.losses, 1);
      assert.equal(res.json.progress.streak, 0);
    });

    /* Флаги доверия считаются на сервере и не мешают принять матч: порядок тестов
     * важен — к этому моменту у игрока уже есть история матчей. */
    it('accepts a deuce score (12:10) and does not flag it', async () => {
      const deuce = await clientCall('POST', '/api/client/v1/matches', {
        matchId: 'mt_deuce_0001',
        playerScore: 12,
        opponentScore: 10,
        durationMs: 60_000,
        opponentRating: 1000,
      });
      assert.equal(deuce.status, 200, deuce.text);
      assert.equal(deuce.json.trust.suspicious, false, 'an honest deuce is not flagged');
    });

    it('flags a fast finish and a repeated result without rejecting them', async () => {
      /* 11:4 за 30 с — счёт допустим, но темп невозможен: матч принимается и помечается. */
      const fast = await clientCall('POST', '/api/client/v1/matches', {
        matchId: 'mt_fast_0001',
        playerScore: 11,
        opponentScore: 4,
        durationMs: 30_000,
        opponentRating: 1000,
      });
      assert.equal(fast.status, 200, 'a flag is not a rejection');
      assert.equal(fast.json.trust.suspicious, true);
      assert.ok(fast.json.trust.flags.includes('FAST_FINISH'));

      const body = { mode: 'career', playerScore: 11, opponentScore: 6, durationMs: 200_000, opponentRating: 1000 };
      const first = await clientCall('POST', '/api/client/v1/matches', { ...body, matchId: 'mt_rep_0001' });
      assert.equal(first.status, 200, first.text);
      const second = await clientCall('POST', '/api/client/v1/matches', { ...body, matchId: 'mt_rep_0002' });
      assert.equal(second.status, 200, second.text);
      assert.ok(second.json.trust.flags.includes('REPEATED_RESULT'));
    });
  });

  describe('Leaderboard and config', () => {
    it('lists the player with a rank', async () => {
      const res = await clientCall('GET', '/api/client/v1/leaderboard?limit=5');
      assert.equal(res.status, 200);
      assert.equal(res.json.scope, 'global');
      assert.ok(res.json.entries.length >= 1);
      assert.ok(res.json.entries.every((e, i) => e.rank === i + 1));
      assert.ok(res.json.me);
      assert.ok(res.json.me.rank >= 1);
      assert.equal(res.json.me.playerId, playerId);
    });

    it('gives tied players the same order every time and a rank that matches the list', async () => {
      /* Три игрока с одинаковым рейтингом и одинаковыми победами: место не
       * должно зависеть от порядка строк в базе, иначе клиент покажет игрока в
       * списке на 5-м месте, а строкой «вы» — на 3-м. */
      const twins = [];
      for (const n of [1, 2, 3]) {
        const session = await loginPlayer(`tg_tie_${n}_${Date.now()}`);
        twins.push(session);
      }
      for (const session of twins) {
        const r = await rawRequest(baseUrl, 'POST', '/api/client/v1/matches', {
          body: {
            matchId: `mt_tie_${session.playerId}`,
            playerScore: 11,
            opponentScore: 5,
            durationMs: 240000,
            opponentRating: 1000,
            mode: 'career',
          },
          headers: { Authorization: `Bearer ${session.playerToken}` },
        });
        assert.equal(r.status, 200, r.text);
      }
      const seen = [];
      for (const session of twins) {
        const res = await rawRequest(baseUrl, 'GET', '/api/client/v1/leaderboard?limit=50', {
          headers: { Authorization: `Bearer ${session.playerToken}` },
        });
        assert.equal(res.status, 200);
        seen.push(res.json);
      }
      assert.deepEqual(seen[0].entries, seen[1].entries, 'порядок доски должен быть стабильным');
      for (const board of seen) {
        const row = board.entries.find((e) => e.playerId === board.me.playerId);
        assert.ok(row, 'своя строка должна быть в списке');
        assert.equal(board.me.rank, row.rank, 'me.rank обязан совпадать с местом в списке');
      }
    });

    it('serves match rules and economy limits for the client', async () => {
      const res = await clientCall('GET', '/api/client/v1/config');
      assert.equal(res.status, 200);
      assert.equal(res.json.matchRules.version, 4);
      assert.equal(res.json.rewards.coinsPerLevel, 150);
      assert.equal(res.json.contractVersion, 1);
    });
  });
});
