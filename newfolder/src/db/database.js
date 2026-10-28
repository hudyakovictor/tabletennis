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
function runRetentionCleanup(db = getDb(), referenceNow = new Date()) {
  const cutoffIso = (days) => new Date(referenceNow.getTime() - days * 86400 * 1000).toISOString();
  const c90 = cutoffIso(RETENTION_DAYS.inputLogs);
  const c180 = cutoffIso(RETENTION_DAYS.telemetrySessions);
  const c365 = cutoffIso(RETENTION_DAYS.directorChatArchive);

  const archMove = moveExpiredDirectorChatToArchiveDb(db, referenceNow);
  const archDb = getArchiveDb(db);

  const rInput = db.prepare('DELETE FROM input_events WHERE ts < ?').run(c90);
  const rMetrics = db.prepare('DELETE FROM telemetry_metrics WHERE bucket_ts < ?').run(c180);
  const rSess = db.prepare('DELETE FROM sessions WHERE started_at < ?').run(c180);
  const rAi = db.prepare('DELETE FROM ai_requests WHERE created_at < ?').run(c180);
  const rQuar = db.prepare('DELETE FROM ai_quarantine WHERE created_at < ?').run(c180);
  const rSum = db.prepare('DELETE FROM zone_summaries WHERE created_at < ?').run(c180);
  const rChatPurge = archDb.prepare('DELETE FROM archived_director_chat WHERE created_at < ?').run(c365);

  return {
    deletedInputEvents: Number(rInput.changes || 0),
    deletedTelemetryMetrics: Number(rMetrics.changes || 0),
    deletedSessions: Number(rSess.changes || 0),
    deletedAiRequests: Number(rAi.changes || 0),
    deletedQuarantine: Number(rQuar.changes || 0),
    deletedOldSummaries: Number(rSum.changes || 0),
    archivedDirectorChat: archMove.movedCount,
    deletedOldDirectorChat: Number(rChatPurge.changes || 0),
  };
}

/**
 * Atomic Hot Backup & Integrity Verification (`10-checklist.md` -> DR & Backups)
 */
function createHotBackup(db = getDb(), customBackupDir = null) {
  const backupDir = customBackupDir || CONFIG.backupDir;
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `crm-backup-${stamp}.sqlite`);
  const escapedPath = backupFile.replace(/'/g, "''");

  db.exec(`VACUUM INTO '${escapedPath}'`);

  const checkDb = new DatabaseSync(backupFile);
  let integrity = 'unknown';
  try {
    const row = checkDb.prepare('PRAGMA integrity_check').get();
    integrity = row?.integrity_check || 'ok';
  } finally {
    checkDb.close();
  }

  const stat = fs.statSync(backupFile);
  return {
    ok: integrity === 'ok',
    backupFile: path.basename(backupFile),
    fullPath: backupFile,
    sizeBytes: stat.size,
    integrity,
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
  applySchemaMigrations,
};
