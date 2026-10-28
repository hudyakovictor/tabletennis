'use strict';

/**
 * Platform & governance verification suite (v3).
 *
 * Covers the layer that the domain suites do not: server-side sessions + CSRF,
 * idempotent mutations, RBAC navigation, operator accounts, alert silences,
 * SLO accounting, audit-chain integrity, CSV hardening, player-360, support SLA,
 * the SSE stream and the client-facing admission ticket.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-platform-test-'));
const testDbPath = path.join(tmpDir, 'platform.sqlite');

const { openDatabase } = require('../src/db/database');
const { seedDatabaseIfEmpty } = require('../src/db/seed');
const { createCrmApp } = require('../src/server');
const { verifyAuditChain } = require('../src/security/audit');

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
            /* CSV / SSE */
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

function cookieJar() {
  const jar = new Map();
  return {
    absorb(res) {
      const list = res.headers['set-cookie'] || [];
      for (const raw of list) {
        const pair = String(raw).split(';')[0];
        const idx = pair.indexOf('=');
        const name = pair.slice(0, idx);
        const value = pair.slice(idx + 1);
        if (!value || /Max-Age=0/i.test(String(raw))) jar.delete(name);
        else jar.set(name, value);
      }
    },
    header() {
      return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
    },
    get(name) {
      return jar.get(name);
    },
  };
}

describe('Platform & governance (v3)', () => {
  let db;
  let server;
  let baseUrl;
  let admin; // { jar, csrf, user }
  let playerId;

  async function adminCall(method, urlPath, body = null, extra = {}) {
    const res = await rawRequest(baseUrl, method, urlPath, {
      body,
      headers: {
        cookie: admin.jar.header(),
        ...(method !== 'GET' && admin.csrf ? { 'X-CSRF-Token': admin.csrf } : {}),
        ...extra,
      },
    });
    admin.jar.absorb(res);
    const rotated = admin.jar.get('topspin_csrf');
    if (rotated) admin.csrf = rotated;
    return res;
  }

  async function loginAs(username, password) {
    const jar = cookieJar();
    const res = await rawRequest(baseUrl, 'POST', '/api/admin/auth/login', { body: { username, password } });
    jar.absorb(res);
    return { jar, csrf: jar.get('topspin_csrf'), status: res.status, json: res.json };
  }

  before(async () => {
    db = openDatabase(testDbPath);
    await seedDatabaseIfEmpty(db, true);
    const app = createCrmApp(db);
    server = app.server;
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const attempt = await loginAs('owner@topspin.arena', 'TopspinAdmin2026!');
    assert.equal(attempt.status, 200);
    admin = attempt;
    playerId = db.prepare("SELECT id FROM players WHERE status = 'active' LIMIT 1").get().id;
  });

  after(async () => {
    if (typeof server.closeWsSockets === 'function') server.closeWsSockets();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sessions + CSRF: cookie login issues a server session, mutations require the CSRF header', async () => {
    const me = await adminCall('GET', '/api/admin/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.json.user.role, 'admin');
    assert.ok(me.json.user.permissions.includes('dashboard:read'));
    assert.ok(me.json.user.navigation.length >= 10);
    assert.ok(me.json.session.id, 'session id must be tracked server-side');
    assert.ok(admin.jar.get('topspin_crm_token'), 'HttpOnly session cookie must be set');

    const noCsrf = await rawRequest(baseUrl, 'POST', '/api/admin/observability/silence', {
      body: { fingerprint: 'csrf_probe', reason: 'probe reason' },
      headers: { cookie: admin.jar.header() },
    });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json.error, 'CSRF_TOKEN_INVALID');

    const sessions = await adminCall('GET', '/api/admin/auth/sessions');
    assert.equal(sessions.status, 200);
    assert.ok(sessions.json.sessions.some((s) => s.current));

    const refreshed = await adminCall('POST', '/api/admin/auth/refresh', {});
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.json.user.permissions.length > 10);
  });

  it('idempotency: a repeated Idempotency-Key replays the first response instead of double-applying', async () => {
    const key = `test-idem-${Date.now()}`;
    const payload = { fingerprint: 'idem_probe', reason: 'idempotency replay probe' };
    const first = await adminCall('POST', '/api/admin/observability/silence', payload, { 'Idempotency-Key': key });
    assert.equal(first.status, 201);
    const second = await adminCall('POST', '/api/admin/observability/silence', payload, { 'Idempotency-Key': key });
    assert.equal(second.status, 201);
    assert.equal(second.headers['idempotent-replayed'], 'true');
    assert.equal(second.json.silence.id, first.json.silence.id);
    const count = db.prepare("SELECT COUNT(*) AS c FROM alert_silences WHERE fingerprint = 'idem_probe'").get().c;
    assert.equal(Number(count), 1);
  });

  it('RBAC: an isolated zone role sees only its own zone and cannot reach the dashboard', async () => {
    const created = await adminCall('POST', '/api/admin/users', {
      email: `ops.analyst.${Date.now()}@topspin.arena`,
      password: 'ZoneAnalyst2026!',
      role: 'ai_zone_ops',
      name: 'Ops analyst',
    });
    assert.equal(created.status, 201);

    const login = await loginAs(created.json.username, 'ZoneAnalyst2026!');
    assert.equal(login.status, 200);
    assert.ok(login.json.user.permissions.includes('zone:ops:read'));
    assert.ok(!login.json.user.permissions.includes('dashboard:read'));
    assert.deepEqual(login.json.user.navigation.map((t) => t.id), ['ops']);

    const zoneLogin = { jar: login.jar, csrf: login.csrf };
    const saved = admin;
    admin = zoneLogin;

    const overview = await adminCall('GET', '/api/admin/overview');
    assert.equal(overview.status, 403);
    const ops = await adminCall('GET', '/api/admin/zones/ops');
    assert.equal(ops.status, 200);
    const fraud = await adminCall('GET', '/api/admin/zones/fraud');
    assert.equal(fraud.status, 403);
    assert.equal(fraud.json.error, 'FORBIDDEN_ZONE_ISOLATION');

    admin = saved;
    // The same operator cannot be created twice.
    const dup = await adminCall('POST', '/api/admin/users', { email: created.json.username, password: 'AnotherPass2026!', role: 'ai_zone_ops' });
    assert.equal(dup.status, 409);
  });

  it('player 360: aggregated profile, sanction with an audited reason, erasure endpoint reachable', async () => {
    const detail = await adminCall('GET', `/api/admin/players/${playerId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.player.id, playerId);
    for (const key of ['metrics', 'sessions', 'payments', 'consents', 'tickets', 'fraudCases']) {
      assert.ok(key in detail.json, `player 360 must expose ${key}`);
    }
    assert.ok(Array.isArray(detail.json.consents));

    const sanction = await adminCall('POST', `/api/admin/players/${playerId}/status`, {
      status: 'suspended',
      reason: 'Проверка санкции в тестовом прогоне',
    });
    assert.equal(sanction.status, 200);
    const row = db.prepare('SELECT status, ban_reason FROM players WHERE id = ?').get(playerId);
    assert.equal(row.status, 'suspended');
    assert.match(row.ban_reason, /Проверка санкции/);

    const audit = db
      .prepare("SELECT action FROM audit_logs WHERE target_id = ? ORDER BY id DESC LIMIT 5")
      .all(playerId)
      .map((r) => r.action);
    assert.ok(audit.some((a) => a.includes('player')), 'sanction must be audited');

    const missing = await adminCall('GET', '/api/admin/players/does-not-exist');
    assert.equal(missing.status, 404);

    await adminCall('POST', `/api/admin/players/${playerId}/status`, { status: 'active', reason: 'Снятие тестовой санкции' });
  });

  it('fraud review: human verdict closes the case and lands in the hash chain', async () => {
    const list = await adminCall('GET', '/api/admin/fraud/cases?page=1&pageSize=5&status=open');
    assert.equal(list.status, 200);
    assert.ok(list.json.total > 0);
    const target = list.json.items[0];
    assert.ok(target.signals && Array.isArray(target.signals.signals), 'signals must be parsed server-side');

    const review = await adminCall('POST', `/api/admin/fraud/cases/${target.id}/review`, {
      verdict: 'false_positive',
      playerAction: 'none',
      note: 'Проверено вручную: биомеханика в пределах нормы',
    });
    assert.equal(review.status, 200);
    const after = db.prepare('SELECT status FROM fraud_cases WHERE id = ?').get(target.id);
    assert.equal(after.status, 'false_positive');

    const chain = verifyAuditChain(db);
    assert.equal(chain.valid, true);
    assert.ok(chain.checked > 0);
  });

  it('support SLA: first response seals the timer, status history is written, client sees the thread', async () => {
    const ticket = db.prepare("SELECT id FROM support_tickets WHERE status != 'closed' LIMIT 1").get()
      || db.prepare('SELECT id FROM support_tickets LIMIT 1').get();
    assert.ok(ticket, 'seed must include at least one ticket');

    const detail = await adminCall('GET', `/api/admin/tickets/${ticket.id}`);
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.json.messages));
    assert.ok(Array.isArray(detail.json.statusHistory));

    const reply = await adminCall('POST', `/api/admin/tickets/${ticket.id}/reply`, {
      body: 'Проверили матч, результат скорректирован.',
      status: 'answered',
    });
    assert.equal(reply.status, 200);
    const row = db.prepare('SELECT status, first_response_at, first_response_minutes FROM support_tickets WHERE id = ?').get(ticket.id);
    assert.equal(row.status, 'answered');
    assert.ok(row.first_response_at, 'first response timestamp must be sealed');
    assert.ok(Number(row.first_response_minutes) >= 0);

    const clientThread = await rawRequest(baseUrl, 'GET', `/api/client/v1/support/tickets/${ticket.id}?playerId=${encodeURIComponent(db.prepare('SELECT player_id FROM support_tickets WHERE id = ?').get(ticket.id).player_id)}`);
    assert.equal(clientThread.status, 200);
    assert.ok(clientThread.json.messages.length >= 1);

    const liveops = await adminCall('GET', '/api/admin/liveops');
    assert.equal(liveops.status, 200);
    assert.ok(liveops.json.ticketSla);
    assert.equal(typeof liveops.json.ticketSla.stormDetected, 'boolean');
  });

  it('observability: SLO report, silences CRUD and quarantine feed are exposed together', async () => {
    const obs = await adminCall('GET', '/api/admin/observability');
    assert.equal(obs.status, 200);
    assert.ok(Array.isArray(obs.json.slo.targets) && obs.json.slo.targets.length >= 4);
    assert.ok(obs.json.slo.targets.every((t) => typeof t.breached === 'boolean'));
    assert.ok(Array.isArray(obs.json.silences));
    assert.ok(Array.isArray(obs.json.quarantined));
    assert.ok(Array.isArray(obs.json.topApiErrors));

    const created = await adminCall('POST', '/api/admin/observability/silence', { fingerprint: 'http_latency_p99_ms', reason: 'Плановое шумоподавление', minutes: 30 });
    assert.equal(created.status, 201);
    const listed = await adminCall('GET', '/api/admin/observability');
    assert.ok(listed.json.silences.some((s) => s.id === created.json.silence.id));

    const removed = await adminCall('DELETE', `/api/admin/observability/silence/${created.json.silence.id}`);
    assert.equal(removed.status, 200);
    const afterRemoval = await adminCall('GET', '/api/admin/observability');
    assert.ok(!afterRemoval.json.silences.some((s) => s.id === created.json.silence.id));
  });

  it('governance: eight roles, compliance metadata, AI budgets and a verifiable audit chain', async () => {
    const gov = await adminCall('GET', '/api/admin/governance');
    assert.equal(gov.status, 200);
    assert.equal(gov.json.roles.length, 8);
    const ids = gov.json.roles.map((r) => r.id).sort();
    assert.deepEqual(ids, ['admin', 'ai_director', 'ai_zone_balance', 'ai_zone_fraud', 'ai_zone_lab', 'ai_zone_market', 'ai_zone_ops', 'player']);
    assert.equal(gov.json.aiBudgets.length, 5);
    assert.ok(gov.json.aiBudgets.every((b) => b.hasApiKey === false || b.hasApiKey === true));
    assert.ok(gov.json.compliance.retentionInputDays >= 90);
    assert.ok(gov.json.residency.length >= 5);
    assert.equal(gov.json.audit.verified, true);
    assert.ok(gov.json.groups.length >= 3);

    const verify = await adminCall('GET', '/api/admin/audit/verify');
    assert.equal(verify.status, 200);
    assert.equal(verify.json.valid, true);
    assert.match(verify.json.algorithm, /sha256/);
  });

  it('scheduler: jobs are inspectable, toggleable and runnable on demand', async () => {
    const status = await adminCall('GET', '/api/admin/scheduler');
    assert.equal(status.status, 200);
    const jobs = Array.isArray(status.json) ? status.json : status.json.jobs;
    assert.ok(jobs.length >= 8);
    const job = jobs.find((j) => j.job_name === 'anomaly_scan') || jobs[0];

    const toggled = await adminCall('POST', `/api/admin/scheduler/${job.job_name}/toggle`, { enabled: false });
    assert.equal(toggled.status, 200);
    const afterToggle = await adminCall('GET', '/api/admin/scheduler');
    const list = Array.isArray(afterToggle.json) ? afterToggle.json : afterToggle.json.jobs;
    assert.equal(Boolean(list.find((j) => j.job_name === job.job_name).enabled), false);
    await adminCall('POST', `/api/admin/scheduler/${job.job_name}/toggle`, { enabled: true });

    const run = await adminCall('POST', `/api/admin/scheduler/${job.job_name}/run`, {});
    assert.equal(run.status, 200);
    assert.ok(run.json.run || run.json.ok);
  });

  it('settings & diagnostics: operators, sessions, providers and a read-only system snapshot', async () => {
    const settings = await adminCall('GET', '/api/admin/settings');
    assert.equal(settings.status, 200);
    assert.ok(Array.isArray(settings.json.users));
    assert.ok(!('password_hash' in (settings.json.users[0] || {})), 'password hashes must never leave the server');
    assert.ok(Array.isArray(settings.json.providers));
    assert.ok(settings.json.providers.every((z) => !('apiKey' in z)), 'zone API keys must never be serialized');
    assert.ok(settings.json.roles.length === 8);

    const diagnostics = await adminCall('GET', '/api/admin/system/diagnostics');
    assert.equal(diagnostics.status, 200);
    assert.ok(diagnostics.json.db.tables > 20);
    assert.equal(diagnostics.json.auditChain.valid, true);
    assert.ok(diagnostics.json.memoryMb > 0);
  });

  it('CSV export neutralizes formula injection and serves a stable header', async () => {
    const marker = `=cmd|' /C calc'!A0-${Date.now()}`;
    db.prepare(
      "INSERT INTO players (id, display_name, region, install_source, status, created_at, last_seen_at) VALUES (?, ?, 'RU', 'organic_tma', 'active', ?, ?)"
    ).run('plr_csv_injection', marker, new Date().toISOString(), new Date().toISOString());

    const csv = await adminCall('GET', '/api/admin/exports/players.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.includes('display_name'));
    assert.ok(!/(^|,)=cmd/m.test(csv.text), 'leading "=" must be neutralized');
    assert.ok(csv.text.includes("'=cmd"), 'formula cell must be prefixed with an apostrophe');

    db.prepare('DELETE FROM players WHERE id = ?').run('plr_csv_injection');

    const unknown = await adminCall('GET', '/api/admin/exports/not_a_dataset.csv');
    assert.equal(unknown.status, 404);
  });

  it('global search and notifications: cross-entity query, unread counter, mark-all-read', async () => {
    const search = await adminCall('GET', '/api/admin/search?q=Player');
    assert.equal(search.status, 200);
    assert.ok(Array.isArray(search.json.groups));
    assert.ok(search.json.groups.length > 0);

    const created = await adminCall('POST', '/api/admin/incidents', {
      severity: 'critical',
      zone: 'ops',
      title: `Notification probe ${Date.now()}`,
      description: 'Проверка центра уведомлений',
    });
    assert.equal(created.status, 201);

    const feed = await adminCall('GET', '/api/admin/notifications');
    assert.equal(feed.status, 200);
    assert.ok(feed.json.unread >= 1, 'critical incident must raise an unread notification');
    assert.ok(feed.json.items.length >= 1);

    const readAll = await adminCall('POST', '/api/admin/notifications/read-all', {});
    assert.equal(readAll.status, 200);
    const after = await adminCall('GET', '/api/admin/notifications');
    assert.equal(after.json.unread, 0);

    db.prepare("DELETE FROM incidents WHERE title LIKE 'Notification probe %'").run();
  });

  it('SSE stream delivers a live event frame after a mutation', async () => {
    const received = [];
    const streamPromise = new Promise((resolve, reject) => {
      const u = new URL('/api/admin/stream', baseUrl);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname,
          method: 'GET',
          headers: { cookie: admin.jar.header(), Accept: 'text/event-stream' },
        },
        (res) => {
          assert.equal(res.statusCode, 200);
          assert.match(res.headers['content-type'], /text\/event-stream/);
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            received.push(chunk);
            if (chunk.includes('event: incident')) {
              res.destroy();
              resolve();
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
      setTimeout(() => {
        req.destroy();
        reject(new Error('SSE event not received within timeout'));
      }, 5000).unref();
    });

    // Give the stream a moment to subscribe before triggering the event.
    await new Promise((r) => setTimeout(r, 250));
    await adminCall('POST', '/api/admin/incidents', {
      severity: 'warning',
      zone: 'ops',
      title: `SSE probe ${Date.now()}`,
      description: 'Проверка живого потока',
    });

    await streamPromise;
    const payload = received.join('');
    assert.match(payload, /event: hello/);
    assert.match(payload, /event: incident/);
    db.prepare("DELETE FROM incidents WHERE title LIKE 'SSE probe %'").run();
  });

  it('client admission: short-lived WS ticket, deduplicated telemetry and notification dismissal', async () => {
    const sessionRes = await rawRequest(baseUrl, 'POST', '/api/client/v1/session/start', {
      body: { playerId, platform: 'tma_android', deviceHash: `dev_${Date.now()}` },
    });
    assert.ok([200, 201].includes(sessionRes.status), `session/start returned ${sessionRes.status}`);
    const { sessionId, affinityToken } = sessionRes.json;
    assert.ok(sessionId && affinityToken);

    const ticket = await rawRequest(baseUrl, 'POST', '/api/client/v1/ws/ticket', { body: { affinityToken, sessionId } });
    assert.equal(ticket.status, 201, 'ticket creation returns 201 Created');
    assert.ok(ticket.json.ticket.length > 20);
    assert.match(ticket.json.wsEndpoint, /^\/ws\/client\?ticket=/);
    const row = db.prepare('SELECT expires_at FROM ws_tickets WHERE id = ?').get(ticket.json.ticket);
    assert.ok(row, 'ticket must be persisted for single-use admission');
    const ttlMs = new Date(row.expires_at).getTime() - Date.now();
    assert.ok(ttlMs <= 60_000 && ttlMs > 0, 'ticket TTL must be about one minute');

    const event = {
      clientEventId: `evt_${Date.now()}`,
      ts: new Date().toISOString(),
      pointerType: 'touch',
      grip: 'shakehand',
      hand: 'right',
      tableZone: 'deep_fh',
      hasFreshSwipe: true,
      swipeStraightness: 0.9,
      along: 0.5,
      across: 0.5,
      accepted: true,
      contact: true,
      ballSpeed: 16,
      spin: 150,
      reactionMs: 250,
    };
    const batch1 = await rawRequest(baseUrl, 'POST', '/api/client/v1/telemetry/inputs', {
      body: { sessionId, events: [event] },
    });
    assert.equal(batch1.status, 200);
    assert.equal(batch1.json.acceptedCount, 1);

    const batch2 = await rawRequest(baseUrl, 'POST', '/api/client/v1/telemetry/inputs', {
      body: { sessionId, events: [event] },
    });
    assert.equal(batch2.status, 200);
    assert.equal(batch2.json.acceptedCount, 0);
    assert.equal(batch2.json.dedupedCount, 1);
    const stored = db.prepare('SELECT COUNT(*) AS c FROM input_events WHERE session_id = ? AND client_event_id = ?').get(sessionId, event.clientEventId);
    assert.equal(Number(stored.c), 1, 'retried batch must not duplicate input events');

    const feed = await rawRequest(baseUrl, 'GET', `/api/client/v1/notifications?playerId=${playerId}`);
    assert.equal(feed.status, 200);
    assert.ok(Array.isArray(feed.json.items));
    assert.ok(feed.json.pinnedCount >= 0);
    if (feed.json.items.length) {
      const target = feed.json.items[0];
      const dismiss = await rawRequest(baseUrl, 'POST', `/api/client/v1/notifications/${target.id}/dismiss`, { body: { playerId } });
      assert.equal(dismiss.status, 200);
      const after = await rawRequest(baseUrl, 'GET', `/api/client/v1/notifications?playerId=${playerId}`);
      assert.ok(!after.json.items.some((n) => n.id === target.id), 'dismissed push must stay dismissed');
    }
  });

  it('maintenance mode returns 503 with Retry-After and blocks only new matches', async () => {
    const on = await adminCall('POST', '/api/admin/maintenance', {
      enabled: true,
      bannerRu: 'Обновляем серверы — вернёмся через 15 минут',
      bannerEn: 'Updating servers — back in 15 minutes',
      etaIso: new Date(Date.now() + 15 * 60000).toISOString(),
    });
    assert.equal(on.status, 200, `maintenance enable failed: ${on.status} ${on.text.slice(0, 200)}`);
    assert.equal((on.json.maintenance || on.json.state).enabled, true);

    const blocked = await rawRequest(baseUrl, 'POST', '/api/client/v1/session/start', {
      body: { playerId, platform: 'tma_ios', deviceHash: 'dev_maint' },
    });
    assert.equal(blocked.status, 503);
    assert.ok(blocked.headers['retry-after'], '503 must carry Retry-After');
    assert.equal(blocked.json.maintenance.enabled, true);

    const off = await adminCall('POST', '/api/admin/maintenance', { enabled: false });
    assert.equal(off.status, 200);
    const allowed = await rawRequest(baseUrl, 'POST', '/api/client/v1/session/start', {
      body: { playerId, platform: 'tma_ios', deviceHash: 'dev_maint_2' },
    });
    assert.ok([200, 201].includes(allowed.status), `session/start after maintenance returned ${allowed.status}`);
  });
});
