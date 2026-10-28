'use strict';

/**
 * Sprint S1 verification: data retention, DR backups and DSAR handling.
 *
 * These are the destructive, legally-binding parts of the CRM, so the suite
 * checks *behaviour under failure*, not just happy paths:
 *  - a dry-run must count exactly the rows the real run deletes, and delete none;
 *  - a backup must be opened read-only and verified against the audit head, and a
 *    tampered file must be reported as unusable instead of "restored";
 *  - rotation must never drop the only snapshot of a month;
 *  - a DSAR must be unique per type while open, must not be fulfil-able twice, and
 *    must escalate (not disappear) when the 30-day SLA is exceeded;
 *  - a scheduler job failing three times in a row must open exactly one incident
 *    and close it on the next successful run.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'topspin-s1-test-'));
const testDbPath = path.join(tmpDir, 's1.sqlite');
const backupDir = path.join(tmpDir, 'backups');

const {
  openDatabase,
  runRetentionCleanup,
  createHotBackup,
  verifyBackupFile,
  pruneBackups,
  listBackups,
  currentAuditHead,
} = require('../src/db/database');
const { seedDatabaseIfEmpty } = require('../src/db/seed');
const { createCrmApp } = require('../src/server');
const { runJob, ensureJobs } = require('../src/services/scheduler');
const { CONFIG } = require('../src/config');

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
            /* non-JSON error page */
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
      for (const raw of res.headers['set-cookie'] || []) {
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

describe('S1 · retention, backups and DSAR', () => {
  let db;
  let server;
  let baseUrl;
  let admin;

  async function adminCall(method, urlPath, body = null) {
    const res = await rawRequest(baseUrl, method, urlPath, {
      body,
      headers: {
        cookie: admin.jar.header(),
        ...(method !== 'GET' && admin.csrf ? { 'X-CSRF-Token': admin.csrf } : {}),
      },
    });
    admin.jar.absorb(res);
    const rotated = admin.jar.get('topspin_csrf');
    if (rotated) admin.csrf = rotated;
    return res;
  }

  /** Activities players that have no open DSAR yet, so intake is never a duplicate. */
  function freePlayerIds(count) {
    return db
      .prepare(
        `SELECT id FROM players
          WHERE status = 'active'
            AND id NOT IN (SELECT player_id FROM privacy_requests WHERE status IN ('pending','in_progress'))
          ORDER BY id DESC LIMIT ?`
      )
      .all(count)
      .map((r) => r.id);
  }

  before(async () => {
    db = openDatabase(testDbPath);
    await seedDatabaseIfEmpty(db, true);
    const app = createCrmApp(db);
    server = app.server;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;

    const jar = cookieJar();
    const login = await rawRequest(baseUrl, 'POST', '/api/admin/auth/login', {
      body: { username: 'owner@topspin.arena', password: 'TopspinAdmin2026!' },
    });
    assert.equal(login.status, 200);
    jar.absorb(login);
    admin = { jar, csrf: jar.get('topspin_csrf') };
  });

  after(async () => {
    if (typeof server.closeWsSockets === 'function') server.closeWsSockets();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /* ------------------------------ Retention ------------------------------ */

  it('retention: dry-run counts exactly what the real run deletes and deletes nothing', async () => {
    const now = new Date();
    const old90 = new Date(now.getTime() - 120 * 86400 * 1000).toISOString(); // past 90, inside 180
    const old180 = new Date(now.getTime() - 200 * 86400 * 1000).toISOString(); // past 180, inside 365
    const old365 = new Date(now.getTime() - 400 * 86400 * 1000).toISOString(); // past every window
    const recent = new Date(now.getTime() - 5 * 86400 * 1000).toISOString();

    const insertEvent = db.prepare(
      `INSERT INTO input_events (session_id, player_id, ts, along, across, accepted) VALUES (?, ?, ?, 0.5, 0.5, 1)`
    );
    for (let i = 0; i < 7; i += 1) insertEvent.run('s1-session', null, old90);
    for (let i = 0; i < 3; i += 1) insertEvent.run('s1-session', null, recent);

    const insertMetric = db.prepare(
      'INSERT INTO telemetry_metrics (bucket_ts, metric_name, metric_value) VALUES (?, ?, ?)'
    );
    for (let i = 0; i < 5; i += 1) insertMetric.run(old180, 's1_probe', 1);
    for (let i = 0; i < 4; i += 1) insertMetric.run(recent, 's1_probe', 1);

    const insertSession = db.prepare(
      'INSERT INTO sessions (id, region, platform, device_hash, started_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < 6; i += 1) insertSession.run(`s1-old-${i}`, 'RU', 'tma_ios', 'dev', old180);
    for (let i = 0; i < 2; i += 1) insertSession.run(`s1-new-${i}`, 'RU', 'tma_ios', 'dev', recent);

    const insertAi = db.prepare(
      `INSERT INTO ai_requests (id, zone, region, provider, model, status, created_at) VALUES (?, 'ops', 'RU', 'mock', 'mock-1', 'ok', ?)`
    );
    insertAi.run('s1-ai-old', old365);
    insertAi.run('s1-ai-new', recent);

    const countRows = () => ({
      input_events: db.prepare('SELECT COUNT(*) AS c FROM input_events').get().c,
      telemetry_metrics: db.prepare('SELECT COUNT(*) AS c FROM telemetry_metrics').get().c,
      sessions: db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c,
      ai_requests: db.prepare('SELECT COUNT(*) AS c FROM ai_requests').get().c,
    });

    // GET preview (what the UI shows before the operator presses anything).
    const previewRes = await adminCall('GET', '/api/admin/system/retention/preview');
    assert.equal(previewRes.status, 200);
    const preview = previewRes.json.preview;
    assert.equal(preview.dryRun, true);
    assert.ok(preview.rules.length >= 6);
    assert.equal(preview.policy.inputEventsDays, 90);
    assert.equal(preview.policy.telemetryDays, 180);
    const before = countRows();
    assert.deepEqual(countRows(), before, 'a dry-run must not delete anything');

    // POST with dryRun:true must report the same numbers as the GET preview.
    const dryRunRes = await adminCall('POST', '/api/admin/system/retention', { dryRun: true });
    assert.equal(dryRunRes.status, 200);
    assert.equal(dryRunRes.json.preview.dryRun, true);
    assert.equal(dryRunRes.json.preview.totalRowsAffected, preview.totalRowsAffected);
    assert.deepEqual(countRows(), before, 'a POSTed dry-run must not delete anything either');

    const perRule = (report) => Object.fromEntries(report.rules.map((r) => [r.table, r.rowsAffected]));
    const previewRows = perRule(preview);
    // Exact counts: only rows past their own window are counted — the 120-day
    // input events go, the 120-day rows of the 180-day tables stay.
    assert.equal(previewRows.input_events, 7);
    assert.equal(previewRows.telemetry_metrics, 5);
    assert.equal(previewRows.sessions, 6);
    assert.equal(previewRows.ai_requests, 1);
    assert.equal(preview.totalRowsAffected, preview.rules.reduce((s, r) => s + r.rowsAffected, 0));

    const runRes = await adminCall('POST', '/api/admin/system/retention', {});
    assert.equal(runRes.status, 200);
    const report = runRes.json.cleanup;
    assert.ok(report, 'the real run must return its report');
    assert.equal(report.dryRun, false);
    assert.deepEqual(perRule(report), previewRows, 'real deletions must match the previewed counts');
    assert.equal(report.deletedInputEvents, previewRows.input_events);
    assert.equal(report.totalRowsAffected, preview.totalRowsAffected);

    const after = countRows();
    assert.equal(after.input_events, before.input_events - previewRows.input_events);
    assert.equal(after.telemetry_metrics, before.telemetry_metrics - previewRows.telemetry_metrics);
    assert.equal(after.sessions, before.sessions - previewRows.sessions);
    assert.equal(after.ai_requests, before.ai_requests - previewRows.ai_requests);
    // Fresh data survives: retention is a policy, not a wipe.
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM input_events WHERE session_id = 's1-session'").get().c,
      3
    );
  });

  /* ------------------------------- Backups ------------------------------- */

  it('backup: creation verifies integrity + audit head; a tampered file is reported unusable', async () => {
    const head = currentAuditHead(db);
    const created = createHotBackup(db, backupDir, { keepDaily: 14 });
    assert.equal(created.ok, true);
    assert.equal(created.integrity, 'ok');
    assert.equal(created.matchesHead, true);
    assert.ok(created.headHash, 'the backup must carry an audit head hash');
    assert.ok(created.sizeBytes > 0);
    assert.ok(fs.existsSync(path.join(backupDir, created.backupFile)));

    // Read-only verification must not create WAL/SHM side files next to the snapshot.
    const verified = verifyBackupFile(path.join(backupDir, created.backupFile), { expectedHeadHash: head });
    assert.equal(verified.ok, true);
    assert.equal(verified.matchesHead, true);
    assert.ok(verified.tables > 20);
    assert.ok(!fs.existsSync(`${path.join(backupDir, created.backupFile)}-wal`));

    // A backup taken before the head moved must be flagged, not silently accepted.
    const stale = verifyBackupFile(path.join(backupDir, created.backupFile), { expectedHeadHash: 'deadbeef' });
    assert.equal(stale.matchesHead, false);
    assert.equal(stale.ok, false);

    // Truncated / corrupted files are the classic restore-time surprise.
    const tampered = path.join(tmpDir, 'crm-backup-2020-01-01T00-00-00-000Z.sqlite');
    fs.writeFileSync(tampered, Buffer.alloc(256, 7));
    const broken = verifyBackupFile(tampered);
    assert.equal(broken.ok, false);
    assert.ok(broken.error);

    // Missing file: explicit error rather than a crash.
    assert.equal(verifyBackupFile(path.join(tmpDir, 'nope.sqlite')).error, 'BACKUP_NOT_FOUND');

    // API surface used by the "Бэкапы" screen.
    const list = await adminCall('GET', '/api/admin/system/backups?verify=1');
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.json.items));
    assert.ok(list.json.retentionHint.includes('14'));
    if (list.json.latestVerified) {
      assert.ok(['ok', 'unknown'].includes(String(list.json.latestVerified.integrity)));
    }
    const traversal = await adminCall('POST', '/api/admin/system/backups/..%2Fetc%2Fpasswd%2Fx.sqlite/verify', {});
    assert.equal(traversal.status, 400);
    assert.equal(traversal.json.error, 'INVALID_BACKUP_NAME');

    // A negative verdict is a successful check (200 + ok:false), not an HTTP error:
    // "this file is stale" must reach the operator as a report, not a failed request.
    const corruptName = 'crm-backup-1999-01-01T00-00-00-000Z.sqlite';
    const corruptPath = path.join(CONFIG.backupDir, corruptName);
    fs.mkdirSync(CONFIG.backupDir, { recursive: true });
    fs.writeFileSync(corruptPath, Buffer.alloc(128, 3));
    try {
      const corrupt = await adminCall('POST', `/api/admin/system/backups/${corruptName}/verify`, {});
      assert.equal(corrupt.status, 200);
      assert.equal(corrupt.json.ok, false);
      assert.ok(corrupt.json.error);
    } finally {
      fs.rmSync(corruptPath, { force: true });
    }
    const missing = await adminCall('POST', '/api/admin/system/backups/crm-backup-does-not-exist.sqlite/verify', {});
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, 'BACKUP_NOT_FOUND');
  });

  it('backup rotation: keeps the newest 14 plus the newest snapshot of every month', () => {
    const dir = path.join(tmpDir, 'rotate');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = (y, m, d, h) =>
      `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}-00-00-000Z`;
    const names = [];
    // 20 daily snapshots in November, 3 in October, 2 in September.
    for (let day = 1; day <= 20; day += 1) names.push(`crm-backup-${stamp(2026, 11, day, 2)}.sqlite`);
    for (const day of [28, 29, 30]) names.push(`crm-backup-${stamp(2026, 10, day, 2)}.sqlite`);
    for (const day of [10, 20]) names.push(`crm-backup-${stamp(2026, 9, day, 2)}.sqlite`);
    names.forEach((name) => fs.writeFileSync(path.join(dir, name), 'x'));

    assert.equal(listBackups(dir).length, 25);
    const result = pruneBackups({ keepDaily: 14, backupDir: dir });
    const kept = listBackups(dir).map((b) => b.file);

    assert.equal(result.removed.length, 25 - result.kept);
    // The 14 newest are November 20 → November 7.
    for (let day = 7; day <= 20; day += 1) {
      assert.ok(kept.includes(`crm-backup-${stamp(2026, 11, day, 2)}.sqlite`), `day ${day} must be kept`);
    }
    // Monthly anchors: the newest October and September snapshots survive.
    assert.ok(kept.includes(`crm-backup-${stamp(2026, 10, 30, 2)}.sqlite`));
    assert.ok(kept.includes(`crm-backup-${stamp(2026, 9, 20, 2)}.sqlite`));
    // Older November days are gone, older October/September copies too.
    assert.ok(!kept.includes(`crm-backup-${stamp(2026, 11, 6, 2)}.sqlite`));
    assert.ok(!kept.includes(`crm-backup-${stamp(2026, 10, 28, 2)}.sqlite`));
    assert.ok(!kept.includes(`crm-backup-${stamp(2026, 9, 10, 2)}.sqlite`));
    assert.ok(kept.length <= 16, 'rotation must stay bounded');
  });

  /* -------------------------------- DSAR -------------------------------- */

  it('DSAR: single open request per type, legal transitions, export package and erasure', async () => {
    const [exportPlayer, erasurePlayer, rejectPlayer] = freePlayerIds(3);

    const created = await adminCall('POST', '/api/admin/privacy/requests', {
      playerId: exportPlayer,
      requestType: 'export',
    });
    assert.equal(created.status, 201);
    const request = created.json.request;
    assert.equal(request.status, 'pending');
    assert.equal(request.source, 'operator');
    const slaMs = new Date(request.due_at).getTime() - new Date(request.requested_at).getTime();
    assert.equal(Math.round(slaMs / 86400000), 30, 'the legal deadline is 30 days');

    // Duplicate open request: refuse, and point at the one already queued.
    const duplicate = await adminCall('POST', '/api/admin/privacy/requests', {
      playerId: exportPlayer,
      requestType: 'export',
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.json.error, 'REQUEST_ALREADY_OPEN');
    assert.equal(duplicate.json.requestId, request.id);

    assert.equal((await adminCall('POST', '/api/admin/privacy/requests', { playerId: 'nope', requestType: 'export' })).status, 404);
    assert.equal(
      (await adminCall('POST', '/api/admin/privacy/requests', { playerId: exportPlayer, requestType: 'sell' })).status,
      400
    );

    const started = await adminCall('POST', `/api/admin/privacy/requests/${request.id}/start`);
    assert.equal(started.status, 200);
    assert.equal(started.json.request.status, 'in_progress');
    const restarted = await adminCall('POST', `/api/admin/privacy/requests/${request.id}/start`);
    assert.equal(restarted.status, 409);
    assert.equal(restarted.json.error, 'INVALID_TRANSITION');

    const fulfilled = await adminCall('POST', `/api/admin/privacy/requests/${request.id}/fulfil`);
    assert.equal(fulfilled.status, 200);
    assert.equal(fulfilled.json.request.status, 'completed');
    assert.ok(fulfilled.json.dataPackage, 'an export must return the legal artefact');
    assert.ok(fulfilled.json.dataPackage.player || fulfilled.json.dataPackage.subject);
    assert.ok(fulfilled.json.request.completed_at);
    assert.equal(fulfilled.json.request.processed_by, 'owner@topspin.arena');

    const twice = await adminCall('POST', `/api/admin/privacy/requests/${request.id}/fulfil`);
    assert.equal(twice.status, 409);
    assert.equal(twice.json.error, 'REQUEST_ALREADY_COMPLETED');

    // Rejection requires a written reason (auditors ask "why").
    const rejectBase = await adminCall('POST', '/api/admin/privacy/requests', {
      playerId: rejectPlayer,
      requestType: 'export',
      reason: 'player asked by email',
    });
    assert.equal(rejectBase.status, 201);
    const badReject = await adminCall('POST', `/api/admin/privacy/requests/${rejectBase.json.request.id}/reject`, {
      reason: 'no',
    });
    assert.equal(badReject.status, 422);
    assert.equal(badReject.json.error, 'REASON_REQUIRED');
    const rejected = await adminCall('POST', `/api/admin/privacy/requests/${rejectBase.json.request.id}/reject`, {
      reason: 'Запрос дублирует уже выданную выгрузку',
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.json.request.status, 'rejected');
    assert.ok(rejected.json.request.rejection_reason.length > 5);
    // A rejected request is closed: it can be fulfilled later? No — the decision is final.
    assert.equal((await adminCall('POST', `/api/admin/privacy/requests/${rejectBase.json.request.id}/fulfil`)).status, 409);

    // Erasure: the player is anonymised and the queue row is completed exactly once.
    const erasure = await adminCall('POST', '/api/admin/privacy/requests', {
      playerId: erasurePlayer,
      requestType: 'erasure',
    });
    assert.equal(erasure.status, 201);
    const rowsBefore = db
      .prepare('SELECT COUNT(*) AS c FROM privacy_requests WHERE player_id = ?')
      .get(erasurePlayer).c;
    const erased = await adminCall('POST', `/api/admin/privacy/requests/${erasure.json.request.id}/fulfil`);
    assert.equal(erased.status, 200);
    assert.equal(erased.json.request.status, 'completed');
    assert.ok(erased.json.erasure, 'erasure must return its checklist');
    const rowsAfter = db
      .prepare('SELECT COUNT(*) AS c FROM privacy_requests WHERE player_id = ?')
      .get(erasurePlayer).c;
    assert.equal(rowsAfter, rowsBefore, 'fulfilling must not insert a duplicate history row');
    const playerRow = db.prepare('SELECT status FROM players WHERE id = ?').get(erasurePlayer);
    assert.ok(!playerRow || playerRow.status !== 'active', 'an erased player must not stay active');

    const queue = await adminCall('GET', '/api/admin/privacy/requests?status=all');
    assert.equal(queue.status, 200);
    assert.ok(queue.json.summary.slaDays === 30);
    assert.ok(Array.isArray(queue.json.items));
    assert.equal((await adminCall('GET', '/api/admin/privacy/requests?status=bogus')).status, 400);
  });

  it('DSAR: an overdue request escalates through the SLA sweep instead of disappearing', async () => {
    const [latePlayer] = freePlayerIds(1);
    const created = await adminCall('POST', '/api/admin/privacy/requests', {
      playerId: latePlayer,
      requestType: 'export',
    });
    assert.equal(created.status, 201);
    // Backdate the clock: 40 days ago, deadline 10 days ago.
    const requestedAt = new Date(Date.now() - 40 * 86400 * 1000).toISOString();
    const dueAt = new Date(Date.now() - 10 * 86400 * 1000).toISOString();
    db.prepare('UPDATE privacy_requests SET requested_at = ?, due_at = ? WHERE id = ?').run(
      requestedAt,
      dueAt,
      created.json.request.id
    );

    const queue = await adminCall('GET', '/api/admin/privacy/requests');
    const item = queue.json.items.find((r) => r.id === created.json.request.id);
    assert.ok(item, 'an overdue request must stay in the open queue');
    assert.equal(item.isOverdue, true);
    assert.equal(item.daysLeft, 0);
    assert.ok(queue.json.summary.overdue >= 1);

    ensureJobs(db);
    const sweep = await runJob(db, 'dsar_sla_sweep', { trigger: 'manual', force: true });
    assert.equal(sweep.ok, true);
    const escalation = db
      .prepare("SELECT * FROM admin_notifications WHERE kind = 'privacy' AND title LIKE '%Просрочено%' ORDER BY created_at DESC LIMIT 1")
      .get();
    assert.ok(escalation, 'an overdue DSAR must produce a notification');
    assert.equal(escalation.severity, 'critical');

    // The sweep never deletes the request: the deadline is owned by a human.
    const still = db.prepare('SELECT status FROM privacy_requests WHERE id = ?').get(created.json.request.id);
    assert.equal(still.status, 'pending');
  });

  it('DSAR client intake: a player can open a request and the queue picks it up', async () => {
    const [clientPlayer] = freePlayerIds(1);
    const res = await rawRequest(baseUrl, 'POST', '/api/client/v1/privacy/request', {
      body: { playerId: clientPlayer, requestType: 'export', reason: 'хочу свои данные' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.type, 'export');
    assert.equal(res.json.status, 'pending');
    assert.ok(res.json.requestId);
    assert.ok(res.json.dueAt, 'the player must be told the deadline, not the internal id');
    assert.equal(res.json.slaDays, 30);
    assert.ok(res.json.message);

    const row = db.prepare('SELECT * FROM privacy_requests WHERE id = ?').get(res.json.requestId);
    assert.equal(row.source, 'player_client');
    assert.equal(row.status, 'pending');

    // A second identical request is a duplicate, not a second deadline.
    const dup = await rawRequest(baseUrl, 'POST', '/api/client/v1/privacy/request', {
      body: { playerId: clientPlayer, requestType: 'export' },
    });
    assert.equal(dup.status, 409);

    // Invalid input is rejected before it reaches the queue.
    const badType = await rawRequest(baseUrl, 'POST', '/api/client/v1/privacy/request', {
      body: { playerId: clientPlayer, requestType: 'everything' },
    });
    assert.equal(badType.status, 400);
    assert.ok(badType.json.message);

    // Abuse guard: the intake is public, so it is rate limited per client.
    // Calls 4 and 5 are still served (and rejected on validation), the 6th is cut.
    const extras = [];
    for (let i = 0; i < 3; i += 1) {
      const extra = await rawRequest(baseUrl, 'POST', '/api/client/v1/privacy/request', {
        body: { playerId: clientPlayer, requestType: 'bogus' },
      });
      extras.push(extra.status);
    }
    assert.deepEqual(extras.slice(0, 2), [400, 400]);
    assert.equal(extras[2], 429, 'the 6th request within a minute must be rate limited');
  });

  /* --------------------------- Scheduler (B7) --------------------------- */

  it('scheduler: three consecutive failures open exactly one critical incident, the next success closes it', async () => {
    ensureJobs(db);
    // Simulate a broken deployment: the privacy table is unavailable, so the SLA
    // sweep throws. Take it offline only for this test and restore it right after.
    db.exec('ALTER TABLE privacy_requests RENAME TO privacy_requests_offline');
    let failed = 0;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const run = await runJob(db, 'dsar_sla_sweep', { trigger: 'manual', force: true });
        if (run.status === 'failed') failed += 1;
      }
    } finally {
      db.exec('ALTER TABLE privacy_requests_offline RENAME TO privacy_requests');
    }
    assert.equal(failed, 3, 'the job must report failure instead of throwing at the caller');
    const job = db.prepare("SELECT * FROM scheduler_jobs WHERE job_name = 'dsar_sla_sweep'").get();
    assert.equal(Number(job.consecutive_failures), 3);
    assert.equal(job.last_status, 'failed');
    assert.ok(job.last_error, 'the failure reason must be stored for the operator');
    assert.ok(job.next_run_at, 'a failing job must be rescheduled with backoff');

    const incidents = db
      .prepare("SELECT * FROM incidents WHERE title LIKE '%dsar_sla_sweep%'")
      .all();
    assert.equal(incidents.length, 1, 'a streak must open one incident, not one per attempt');
    assert.equal(incidents[0].severity, 'critical');
    assert.notEqual(incidents[0].status, 'resolved');

    const notification = db
      .prepare("SELECT * FROM admin_notifications WHERE fingerprint = 'scheduler_down:dsar_sla_sweep'")
      .all();
    assert.equal(notification.length, 1, 'the operator is paged once per streak');

    // Recovery: the next successful run resolves the incident and says so.
    const ok = await runJob(db, 'dsar_sla_sweep', { trigger: 'manual', force: true });
    assert.equal(ok.ok, true);
    const resolved = db.prepare("SELECT * FROM incidents WHERE title LIKE '%dsar_sla_sweep%'").get();
    assert.equal(resolved.status, 'resolved');
    assert.ok(resolved.resolved_at);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM admin_notifications WHERE fingerprint = 'scheduler_up:dsar_sla_sweep'").get().c,
      1
    );
    const healed = db.prepare("SELECT * FROM scheduler_jobs WHERE job_name = 'dsar_sla_sweep'").get();
    assert.equal(Number(healed.consecutive_failures), 0);
  });

  it('backup dir is only ever the configured one (no path escaping from the API)', () => {
    assert.ok(path.isAbsolute(CONFIG.backupDir));
    assert.equal(CONFIG.backupDir.endsWith(path.join('data', 'backups')), true);
  });
});
