'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { CONFIG, RETENTION_DAYS, AI_ZONES } = require('../config');

let sharedDb = null;

function openArchiveDbFor(mainPath) {
  const archPath =
    mainPath === ':memory:'
      ? ':memory:'
      : mainPath === CONFIG.dbPath
      ? CONFIG.archiveDbPath
      : `${mainPath}.archive.sqlite`;
  if (archPath !== ':memory:') {
    fs.mkdirSync(path.dirname(archPath), { recursive: true });
  }
  const archDb = new DatabaseSync(archPath);
  archDb.exec('PRAGMA journal_mode = WAL;');
  archDb.exec('PRAGMA synchronous = NORMAL;');
  archDb.exec(`
    CREATE TABLE IF NOT EXISTS archived_director_chat (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      region TEXT NOT NULL DEFAULT 'RU',
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      structured_json TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_arch_dir_created ON archived_director_chat(created_at DESC);
  `);
  archDb.__filePath = archPath;
  return archDb;
}

function openDatabase(customPath) {
  const targetPath = customPath || CONFIG.dbPath;
  if (targetPath !== ':memory:') {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  if (fs.existsSync(CONFIG.backupDir) === false) {
    fs.mkdirSync(CONFIG.backupDir, { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Compatibility wrapper so `db.pragma('journal_mode')` works seamlessly alongside `node:sqlite`
  db.pragma = (expr) => db.prepare(`PRAGMA ${expr}`).all();
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback if already rolled back
      }
      throw err;
    }
  };

  const schemaSql = fs.readFileSync(
    path.join(CONFIG.rootDir, 'sql', 'sqlite-schema.sql'),
    'utf8'
  );
  db.exec(schemaSql);
  db.__migrations = applySchemaMigrations(db);

  const archiveDb = openArchiveDbFor(targetPath);
  db.__archiveDb = archiveDb;
  db.__filePath = targetPath;

  const origClose = db.close.bind(db);
  db.close = () => {
    try {
      if (db.__archiveDb) db.__archiveDb.close();
    } catch {
      // Ignore if already closed
    }
    return origClose();
  };

  const now = new Date().toISOString();
  const upsertZone = db.prepare(`
    INSERT INTO ai_zone_configs
    (zone, provider, fallback_provider, model, daily_token_limit, zero_retention, batch_mode, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(zone) DO NOTHING
  `);
  for (const z of Object.values(AI_ZONES)) {
    upsertZone.run(
      z.zone,
      z.provider,
      z.fallbackProvider || 'local_statistical',
      z.model,
      z.dailyTokenLimit,
      z.zeroRetention ? 1 : 0,
      z.batchMode ? 1 : 0,
      now
    );
  }

  return db;
}

function getArchiveDb(db = getDb()) {
  if (!db.__archiveDb) {
    db.__archiveDb = openArchiveDbFor(db.__filePath || CONFIG.dbPath);
  }
  return db.__archiveDb;
}

function getDb() {
  if (!sharedDb) {
    sharedDb = openDatabase();
  }
  return sharedDb;
}

function closeDb() {
  if (sharedDb) {
    sharedDb.close();
    sharedDb = null;
  }
}

/**
 * Forward-only, idempotent schema migrations for databases created by earlier
 * builds. `CREATE TABLE IF NOT EXISTS` never adds a column to an existing table,
 * so every additive column is applied here explicitly. Cheap to run (PRAGMA scan)
 * and safe on a hot database.
 */
const COLUMN_MIGRATIONS = Object.freeze([
  ['input_events', 'client_event_id', 'TEXT'],
  ['support_tickets', 'first_response_at', 'TEXT'],
  ['support_tickets', 'first_response_minutes', 'INTEGER'],
  ['support_tickets', 'sla_due_at', 'TEXT'],
  ['audit_logs', 'prev_hash', 'TEXT'],
  ['audit_logs', 'entry_hash', 'TEXT'],
  ['admin_sessions', 'csrf_hash', "TEXT NOT NULL DEFAULT ''"],
  ['sessions', 'ws_ticket_id', 'TEXT'],
  // Encrypted provider keys live next to their zone config; the plaintext never
  // reaches the database and the encryption key is derived from the environment.
  ['ai_zone_configs', 'api_key_encrypted', 'TEXT'],
  ['ai_zone_configs', 'api_key_fingerprint', 'TEXT'],
  ['ai_zone_configs', 'api_key_updated_at', 'TEXT'],
  ['ai_zone_configs', 'api_key_updated_by', 'TEXT'],
  // Account lifecycle: an operator must be switchable off without deleting the row,
  // otherwise the audit trail of their past actions loses its subject.
  ['admin_users', 'is_active', 'INTEGER NOT NULL DEFAULT 1'],
  ['admin_users', 'disabled_at', 'TEXT'],
  ['admin_users', 'disabled_by', 'TEXT'],
  // DSAR queue: deadline, provenance and rejection reason must survive restarts.
  ['privacy_requests', 'due_at', 'TEXT'],
  ['privacy_requests', 'source', 'TEXT'],
  ['privacy_requests', 'notes', 'TEXT'],
  ['privacy_requests', 'rejection_reason', 'TEXT'],
  ['privacy_requests', 'updated_at', 'TEXT'],
]);

function tableColumns(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
  } catch {
    return new Set();
  }
}

function applySchemaMigrations(db) {
  const applied = [];
  for (const [table, column, ddl] of COLUMN_MIGRATIONS) {
    const cols = tableColumns(db, table);
    if (cols.size === 0) continue;
    if (cols.has(column)) continue;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
      applied.push(`${table}.${column}`);
    } catch (err) {
      // A concurrent process may have added it between the check and the ALTER.
      if (!String(err.message).includes('duplicate column')) throw err;
    }
  }

  // Legacy audit rows (pre-v3) predate the hash chain: seal them retroactively so
  // tamper detection covers the full history instead of silently skipping it.
  const legacy = db
    .prepare('SELECT COUNT(*) AS c FROM audit_logs WHERE entry_hash IS NULL OR entry_hash = \'\'')
    .get();
  if (Number(legacy?.c || 0) > 0) {
    try {
      const { backfillAuditChain } = require('../security/audit');
      backfillAuditChain(db);
    } catch {
      // Audit backfill is best-effort; chain verification reports the gap explicitly.
    }
    applied.push('audit_logs.hash_chain.backfill');
  }
  return applied;
}

/**
 * Moves expired Director chat messages (> 48–72h) OUT of active `director_chat`
 * and INTO the separate Archive DB (`director-archive.sqlite` -> `archived_director_chat`).
 */
function moveExpiredDirectorChatToArchiveDb(db = getDb(), referenceNow = new Date()) {
  const archDb = getArchiveDb(db);
  const cutoffIso = new Date(
    referenceNow.getTime() - CONFIG.directorSlidingWindowHours * 3600 * 1000
  ).toISOString();
  const nowIso = referenceNow.toISOString();

  const expiredRows = db
    .prepare('SELECT * FROM director_chat WHERE archived = 1 OR created_at < ? ORDER BY created_at ASC')
    .all(cutoffIso);

  if (!expiredRows.length) {
    return { cutoffIso, movedCount: 0 };
  }

  const insArch = archDb.prepare(`
    INSERT OR REPLACE INTO archived_director_chat
    (id, owner_id, region, role, content, structured_json, created_at, archived_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const delActive = db.prepare('DELETE FROM director_chat WHERE id = ?');

  archDb.exec('BEGIN IMMEDIATE');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of expiredRows) {
      insArch.run(
        r.id,
        r.owner_id,
        r.region || 'RU',
        r.role,
        r.content,
        r.structured_json || null,
        r.created_at,
        nowIso
      );
      delActive.run(r.id);
    }
    db.exec('COMMIT');
    archDb.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    try { archDb.exec('ROLLBACK'); } catch {}
    throw err;
  }

  return { cutoffIso, movedCount: expiredRows.length };
}

/**
 * Automated Data Retention Policy (06-data-schema.md):
 * - raw input_events: 90 days
 * - telemetry sessions / telemetry_metrics: 180 days
 * - ai_requests / ai_quarantine / zone_summaries: 180 days
 * - director_chat: active window 48-72h -> separate archive DB -> purged after 365 days
 * - payments: retained anonymized per accounting law
 */
/**
 * Retention policy (90 / 180 / 365 days, `16-legal-player-agreements.md`).
 *
 * `dryRun` counts exactly the rows each rule *would* delete without touching them.
 * That matters because the policy is destructive and irreversible: an operator must
 * be able to see "this will drop 1 818 input events" before pressing the button,
 * not read it in a runbook afterwards.
 */
function runRetentionCleanup(db = getDb(), referenceNow = new Date(), { dryRun = false } = {}) {
  const cutoffIso = (days) => new Date(referenceNow.getTime() - days * 86400 * 1000).toISOString();
  const c90 = cutoffIso(RETENTION_DAYS.inputLogs);
  const c180 = cutoffIso(RETENTION_DAYS.telemetrySessions);
  const c365 = cutoffIso(RETENTION_DAYS.directorChatArchive);
  const archDb = getArchiveDb(db);

  const rules = [
    { key: 'deletedInputEvents', table: 'input_events', column: 'ts', cutoff: c90, days: RETENTION_DAYS.inputLogs, db },
    { key: 'deletedTelemetryMetrics', table: 'telemetry_metrics', column: 'bucket_ts', cutoff: c180, days: RETENTION_DAYS.telemetrySessions, db },
    { key: 'deletedSessions', table: 'sessions', column: 'started_at', cutoff: c180, days: RETENTION_DAYS.telemetrySessions, db },
    { key: 'deletedAiRequests', table: 'ai_requests', column: 'created_at', cutoff: c180, days: RETENTION_DAYS.telemetrySessions, db },
    { key: 'deletedQuarantine', table: 'ai_quarantine', column: 'created_at', cutoff: c180, days: RETENTION_DAYS.telemetrySessions, db },
    { key: 'deletedOldSummaries', table: 'zone_summaries', column: 'created_at', cutoff: c180, days: RETENTION_DAYS.telemetrySessions, db },
    { key: 'deletedOldDirectorChat', table: 'archived_director_chat', column: 'created_at', cutoff: c365, days: RETENTION_DAYS.directorChatArchive, db: archDb },
  ];

  const report = {
    dryRun: Boolean(dryRun),
    evaluatedAt: referenceNow.toISOString(),
    policy: {
      inputEventsDays: RETENTION_DAYS.inputLogs,
      telemetryDays: RETENTION_DAYS.telemetrySessions,
      directorChatDays: RETENTION_DAYS.directorChatArchive,
      deletionSlaDays: RETENTION_DAYS.deletionSlaDays,
    },
    rules: [],
  };

  if (dryRun) {
    for (const rule of rules) {
      const row = rule.db
        .prepare(`SELECT COUNT(*) AS c FROM ${rule.table} WHERE ${rule.column} < ?`)
        .get(rule.cutoff);
      report.rules.push({
        key: rule.key,
        table: rule.table,
        retentionDays: rule.days,
        cutoffIso: rule.cutoff,
        rowsAffected: Number(row?.c || 0),
      });
    }
    // Moving chat to the archive DB is not destructive, but an operator should still
    // see how much will migrate before it disappears from the active table.
    const pendingMove = db
      .prepare(`SELECT COUNT(*) AS c FROM director_chat WHERE created_at < ?`)
      .get(cutoffIso(CONFIG.directorSlidingWindowHours ? CONFIG.directorSlidingWindowHours : 72));
    report.archivedDirectorChat = Number(pendingMove?.c || 0);
    report.totalRowsAffected = report.rules.reduce((sum, r) => sum + r.rowsAffected, 0);
    return report;
  }

  const archMove = moveExpiredDirectorChatToArchiveDb(db, referenceNow);
  for (const rule of rules) {
    const res = rule.db.prepare(`DELETE FROM ${rule.table} WHERE ${rule.column} < ?`).run(rule.cutoff);
    report.rules.push({
      key: rule.key,
      table: rule.table,
      retentionDays: rule.days,
      cutoffIso: rule.cutoff,
      rowsAffected: Number(res.changes || 0),
    });
  }
  // Keep the flat, historical shape as well: existing callers and the demo scripts
  // read `deletedInputEvents` etc. directly.
  for (const rule of report.rules) report[rule.key] = rule.rowsAffected;
  report.archivedDirectorChat = archMove.movedCount;
  report.totalRowsAffected = report.rules.reduce((sum, r) => sum + r.rowsAffected, 0);
  return report;
}

/**
 * Backup / restore lifecycle (`10-checklist.md` → DR & Backups).
 *
 * Design notes, because "we make backups" is not the same as "we can restore":
 *  - `VACUUM INTO` gives a consistent snapshot while the DB is live (WAL);
 *  - every backup is opened read-only and checked twice: `PRAGMA integrity_check`
 *    and the audit `head_hash`, so a truncated or silently older snapshot is
 *    detected at creation time rather than during an outage;
 *  - rotation keeps `keepDaily` newest backups plus the newest backup of every
 *    month, so a policy can never delete the only copy from last month.
 */

const BACKUP_PREFIX = 'crm-backup-';

function listBackups(backupDir = CONFIG.backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith(BACKUP_PREFIX) && name.endsWith('.sqlite'))
    .map((name) => {
      const full = path.join(backupDir, name);
      const stat = fs.statSync(full);
      const match = name.match(/crm-backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.sqlite$/);
      // The creation time is encoded in the file name and is authoritative:
      // copying a snapshot to another host (`rsync`, S3, a restore drill) rewrites
      // mtime, and rotation must not then treat last month's copy as the newest.
      const createdFromName = match
        ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`
        : null;
      return {
        file: name,
        sizeBytes: stat.size,
        createdAt: createdFromName || stat.mtime.toISOString(),
        monthKey: match ? `${match[1]}-${match[2]}` : 'unknown',
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Opens a backup strictly read-only (no WAL side files are created next to it) and
 * reports whether it is a usable snapshot of *this* installation.
 */
function verifyBackupFile(filePath, { expectedHeadHash = null } = {}) {
  if (!fs.existsSync(filePath)) {
    return { ok: false, file: path.basename(filePath), error: 'BACKUP_NOT_FOUND' };
  }
  let probe = null;
  try {
    probe = new DatabaseSync(filePath, { readOnly: true });
    const integrity = probe.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown';
    const hasAudit = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit_logs'")
      .get();
    const headRow = hasAudit
      ? probe.prepare('SELECT entry_hash FROM audit_logs ORDER BY rowid DESC LIMIT 1').get()
      : null;
    const tables = probe
      .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'")
      .get()?.c || 0;
    const players = hasAudit ? probe.prepare('SELECT COUNT(*) AS c FROM players').get()?.c || 0 : 0;
    const headHash = headRow?.entry_hash || null;
    const matchesHead = expectedHeadHash ? headHash === expectedHeadHash : null;
    return {
      ok: integrity === 'ok' && (matchesHead !== false),
      file: path.basename(filePath),
      fullPath: filePath,
      sizeBytes: fs.statSync(filePath).size,
      integrity,
      tables,
      players,
      headHash,
      expectedHeadHash,
      matchesHead,
      error: integrity === 'ok' ? null : 'INTEGRITY_CHECK_FAILED',
    };
  } catch (err) {
    return { ok: false, file: path.basename(filePath), error: err.message || 'BACKUP_UNREADABLE' };
  } finally {
    if (probe) probe.close();
  }
}

function currentAuditHead(db) {
  try {
    return db.prepare('SELECT entry_hash FROM audit_logs ORDER BY rowid DESC LIMIT 1').get()?.entry_hash || null;
  } catch {
    return null;
  }
}

/**
 * Rotation: keep the newest `keepDaily` snapshots plus the newest snapshot of each
 * distinct month. Returns the removed file names so the caller can audit them.
 */
function pruneBackups({ keepDaily = 14, backupDir = CONFIG.backupDir } = {}) {
  const all = listBackups(backupDir);
  const keep = new Set(all.slice(0, Math.max(1, keepDaily)).map((b) => b.file));
  const monthsSeen = new Set();
  for (const backup of all) {
    if (keep.has(backup.file)) {
      monthsSeen.add(backup.monthKey);
      continue;
    }
    if (!monthsSeen.has(backup.monthKey)) {
      keep.add(backup.file);
      monthsSeen.add(backup.monthKey);
    }
  }
  const removed = [];
  for (const backup of all) {
    if (keep.has(backup.file)) continue;
    try {
      fs.unlinkSync(path.join(backupDir, backup.file));
      removed.push(backup.file);
    } catch {
      /* a file locked by another process is retried on the next run */
    }
  }
  return { kept: all.length - removed.length, removed };
}

/**
 * Atomic Hot Backup & Integrity Verification (`10-checklist.md` -> DR & Backups)
 */
function createHotBackup(db = getDb(), customBackupDir = null, { keepDaily = 14 } = {}) {
  const backupDir = customBackupDir || CONFIG.backupDir;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `${BACKUP_PREFIX}${stamp}.sqlite`);

  db.exec(`VACUUM INTO '${backupFile.replace(/'/g, "''")}'`);

  const expectedHeadHash = currentAuditHead(db);
  const verified = verifyBackupFile(backupFile, { expectedHeadHash });
  const rotation = pruneBackups({ keepDaily, backupDir });

  return {
    ok: verified.ok,
    backupFile: path.basename(backupFile),
    fullPath: backupFile,
    sizeBytes: verified.sizeBytes,
    integrity: verified.integrity,
    headHash: verified.headHash,
    matchesHead: verified.matchesHead,
    tables: verified.tables,
    players: verified.players,
    rotation,
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  openDatabase,
  getArchiveDb,
  getDb,
  closeDb,
  moveExpiredDirectorChatToArchiveDb,
  runRetentionCleanup,
  createHotBackup,
  listBackups,
  verifyBackupFile,
  pruneBackups,
  currentAuditHead,
  applySchemaMigrations,
};
