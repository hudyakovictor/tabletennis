/* ─────────────────────────────────────────────────────────────────────────────
 * Слой данных CRM. Один SQLite-файл (Node 22 node:sqlite, без зависимостей).
 * Логическая изоляция зон сделана префиксами таблиц + view-контрактами:
 *   ops_*, fraud_*, balance_*, market_*, lab_*, director_*, players, payments.
 * У всех таблиц с ПДн есть поле region (05-legal-rf-sanctions.md).
 * ─────────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nowISO, safeJSON, scryptHash, uuid } from './util.js';

export const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- ── Доступ и аудит ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL, last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL, ip TEXT,
  user_agent TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL, actor_role TEXT,
  action TEXT NOT NULL, target TEXT, payload TEXT, ip TEXT, result TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
);

-- ── Игроки и согласия (players) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY, region TEXT NOT NULL DEFAULT 'RU', email_hash TEXT,
  created_at TEXT NOT NULL, consent_telemetry INTEGER NOT NULL DEFAULT 0,
  consent_ai_analysis INTEGER NOT NULL DEFAULT 0, consent_marketing INTEGER NOT NULL DEFAULT 0,
  device_fingerprint_hash TEXT, country_code TEXT, display_name TEXT, telegram_id TEXT,
  status TEXT NOT NULL DEFAULT 'active', risk_score REAL NOT NULL DEFAULT 0,
  banned_at TEXT, ban_reason TEXT, deleted_at TEXT, ltv_usd REAL NOT NULL DEFAULT 0,
  channel TEXT, campaign TEXT, creative TEXT, install_at TEXT, platform TEXT
);
CREATE INDEX IF NOT EXISTS ix_players_install ON players(install_at);
CREATE INDEX IF NOT EXISTS ix_players_region ON players(region);
CREATE TABLE IF NOT EXISTS consents (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, region TEXT NOT NULL, ts TEXT NOT NULL,
  telemetry INTEGER, ai_analysis INTEGER, marketing INTEGER, source TEXT
);
CREATE TABLE IF NOT EXISTS deletion_requests (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, region TEXT NOT NULL, ts TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', completed_at TEXT, requested_by TEXT
);

-- ── Сырые события (общий ingestion) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, dedupe_key TEXT UNIQUE, type TEXT NOT NULL, player_id TEXT,
  session_id TEXT, region TEXT NOT NULL DEFAULT 'OTHER', ts TEXT NOT NULL,
  source TEXT, ingest_key_id TEXT, payload TEXT, received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS ix_events_type_ts ON events(type, ts);
CREATE INDEX IF NOT EXISTS ix_events_player ON events(player_id, ts);

-- ── Сессии, ввод, производительность (ops / balance) ──────────────────────
CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY, player_id TEXT, region TEXT NOT NULL DEFAULT 'OTHER',
  started_at TEXT NOT NULL, ended_at TEXT, device_type TEXT, fps_avg REAL,
  crash INTEGER NOT NULL DEFAULT 0, build_version TEXT, rules_version TEXT,
  ping_ms REAL, platform TEXT, hand TEXT, grip TEXT, duration_s REAL,
  matches INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_sessions_started ON game_sessions(started_at);
CREATE TABLE IF NOT EXISTS input_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT, session_id TEXT, player_id TEXT,
  region TEXT NOT NULL DEFAULT 'OTHER', ts TEXT NOT NULL, pointer_type TEXT,
  along REAL, across REAL, reject_code TEXT, ball_speed REAL, spin REAL,
  accepted INTEGER NOT NULL DEFAULT 0, build_version TEXT, rules_version TEXT,
  device_type TEXT, shot_type TEXT, timing_error_ms REAL, distance_px REAL,
  direction_dot REAL, hand TEXT, grip TEXT
);
CREATE INDEX IF NOT EXISTS ix_input_ts ON input_logs(ts);
CREATE INDEX IF NOT EXISTS ix_input_reject ON input_logs(reject_code, ts);
CREATE TABLE IF NOT EXISTS ops_perf (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, session_id TEXT, player_id TEXT,
  region TEXT NOT NULL DEFAULT 'OTHER', fps REAL, frame_ms REAL, update_ms REAL,
  render_ms REAL, ui_ms REAL, scale REAL, long_task_ms REAL, ping_ms REAL,
  device_type TEXT, build_version TEXT
);
CREATE INDEX IF NOT EXISTS ix_perf_ts ON ops_perf(ts);
CREATE TABLE IF NOT EXISTS ops_errors (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, player_id TEXT, session_id TEXT,
  region TEXT NOT NULL DEFAULT 'OTHER', level TEXT, code TEXT, message TEXT,
  stack_hash TEXT, build_version TEXT, occurrences INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ops_crashes (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, player_id TEXT, session_id TEXT,
  region TEXT NOT NULL DEFAULT 'OTHER', reason TEXT, build_version TEXT, device_type TEXT
);
CREATE TABLE IF NOT EXISTS ops_http (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, region TEXT NOT NULL DEFAULT 'OTHER',
  route TEXT, method TEXT, status INTEGER, latency_ms REAL
);
CREATE TABLE IF NOT EXISTS ops_pings (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, region TEXT NOT NULL, endpoint TEXT,
  ping_ms REAL, status TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, level TEXT NOT NULL, zone TEXT NOT NULL,
  code TEXT NOT NULL, title TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'open',
  runbook TEXT, metrics TEXT, acked_by TEXT, acked_at TEXT, resolved_at TEXT, source TEXT
);
CREATE INDEX IF NOT EXISTS ix_alerts_ts ON alerts(ts);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  severity TEXT NOT NULL DEFAULT 'warning', zone TEXT, owner TEXT, summary TEXT,
  created_by TEXT, resolved_at TEXT
);

-- ── Платежи и экономика (payments / market) ──────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, player_id TEXT, region TEXT NOT NULL DEFAULT 'OTHER', ts TEXT NOT NULL,
  amount_usd REAL NOT NULL DEFAULT 0, currency TEXT, product_id TEXT, product_kind TEXT,
  status TEXT NOT NULL DEFAULT 'paid', provider TEXT, country_code TEXT,
  refunded INTEGER NOT NULL DEFAULT 0, chargeback INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_payments_ts ON payments(ts);
CREATE TABLE IF NOT EXISTS economy_events (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, player_id TEXT, region TEXT NOT NULL DEFAULT 'OTHER',
  kind TEXT, currency TEXT, amount REAL, item_id TEXT, balance_after REAL
);
CREATE TABLE IF NOT EXISTS market_events (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, player_id TEXT, region TEXT NOT NULL DEFAULT 'OTHER',
  channel TEXT, campaign TEXT, creative TEXT, type TEXT,
  cost_usd REAL NOT NULL DEFAULT 0, installs INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_market_ts ON market_events(ts);

-- ── Антифрод (fraud) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fraud_signals (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, player_id TEXT NOT NULL, region TEXT NOT NULL,
  signal TEXT NOT NULL, value REAL, details TEXT
);
CREATE INDEX IF NOT EXISTS ix_fraud_player ON fraud_signals(player_id, ts);
CREATE TABLE IF NOT EXISTS fraud_cases (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, player_id TEXT NOT NULL, region TEXT NOT NULL,
  risk_score REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open', reasons TEXT,
  signals TEXT, review_note TEXT, reviewed_by TEXT, reviewed_at TEXT, created_by TEXT
);
CREATE INDEX IF NOT EXISTS ix_fraud_status ON fraud_cases(status, risk_score DESC);

-- ── Lab: A/B, тесты, отчёты ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lab_tests (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, hypothesis TEXT, zone TEXT NOT NULL DEFAULT 'balance',
  status TEXT NOT NULL DEFAULT 'draft', variants TEXT, started_at TEXT, ended_at TEXT,
  winner TEXT, created_by TEXT, ts TEXT NOT NULL, metrics TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS lab_results (
  id TEXT PRIMARY KEY, test_id TEXT NOT NULL, ts TEXT NOT NULL, variant TEXT,
  metric TEXT NOT NULL, value REAL, sample_size INTEGER
);
CREATE TABLE IF NOT EXISTS lab_test_runs (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL, source TEXT, payload TEXT
);
CREATE TABLE IF NOT EXISTS lab_reports (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, title TEXT NOT NULL, kind TEXT, source TEXT,
  summary TEXT, payload TEXT, zone TEXT, created_by TEXT
);

-- ── ИИ: запросы, сводки, карантин, лимиты ────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_requests (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, zone TEXT NOT NULL, provider TEXT NOT NULL,
  model TEXT NOT NULL, prompt_tokens INTEGER, completion_tokens INTEGER,
  cost_usd REAL, status TEXT, latency_ms INTEGER, error TEXT, injection_suspected INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_ai_ts ON ai_requests(ts);
CREATE TABLE IF NOT EXISTS zone_summaries (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, zone TEXT NOT NULL, status TEXT NOT NULL,
  findings TEXT, metrics TEXT, provider TEXT, model TEXT,
  tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, valid INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_summaries_zone_ts ON zone_summaries(zone, ts);
CREATE TABLE IF NOT EXISTS ai_quarantine (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, zone TEXT NOT NULL, raw TEXT,
  reason TEXT, resolved INTEGER NOT NULL DEFAULT 0, source TEXT
);
CREATE TABLE IF NOT EXISTS ai_limits (
  zone TEXT NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (zone, day)
);

-- ── Директор: чат, состояние, решения, предложения ───────────────────────
CREATE TABLE IF NOT EXISTS director_chat (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, owner_id TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0, meta TEXT
);
CREATE INDEX IF NOT EXISTS ix_chat_ts ON director_chat(ts);
CREATE TABLE IF NOT EXISTS director_state (
  key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, zone TEXT NOT NULL, source TEXT,
  kind TEXT NOT NULL, title TEXT NOT NULL, payload TEXT, rationale TEXT,
  confidence REAL, status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT, reviewed_at TEXT, review_note TEXT, executed_at TEXT
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, owner TEXT NOT NULL, kind TEXT,
  summary TEXT, payload TEXT, proposal_id TEXT
);

-- ── LiveOps ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'announcement', status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT, author TEXT, pinned INTEGER NOT NULL DEFAULT 0, lang TEXT NOT NULL DEFAULT 'ru'
);
CREATE TABLE IF NOT EXISTS pushes (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'critical', channels TEXT, segment TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'sent', sent_at TEXT, author TEXT, auto INTEGER NOT NULL DEFAULT 0,
  dismissible INTEGER NOT NULL DEFAULT 1, dedupe_key TEXT
);
CREATE TABLE IF NOT EXISTS push_reads (
  push_id TEXT NOT NULL, player_id TEXT NOT NULL, read_at TEXT, dismissed_at TEXT,
  PRIMARY KEY (push_id, player_id)
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, player_id TEXT, region TEXT NOT NULL DEFAULT 'OTHER',
  subject TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'normal', screenshot_url TEXT, build_version TEXT,
  updated_at TEXT NOT NULL, assignee TEXT, source TEXT, related_known_issue TEXT
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, ticket_id TEXT NOT NULL, author_role TEXT,
  author TEXT, body TEXT NOT NULL, visible_to_player INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS content_plan (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, title TEXT NOT NULL, kind TEXT,
  status TEXT NOT NULL DEFAULT 'planned', target_date TEXT, owner TEXT, notes TEXT
);
`;

export function openDb(dbPath, { memory = false } = {}) {
  if (dbPath !== ':memory:' && !memory) fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(memory ? ':memory:' : dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  db.prepare('INSERT OR IGNORE INTO meta(key,value) VALUES(?,?)').run('schema_version', String(SCHEMA_VERSION));
  return db;
}

/** INSERT с белыми списками колонок (имена колонок не приходят извне). */
export function insert(db, table, row) {
  const keys = Object.keys(row);
  if (!keys.length) throw new Error('insert: empty row');
  const sql = `INSERT INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  db.prepare(sql).run(...keys.map(k => normalizeValue(row[k])));
  return row;
}

export function insertIgnore(db, table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT OR IGNORE INTO ${table} (${keys.map(k => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const info = db.prepare(sql).run(...keys.map(k => normalizeValue(row[k])));
  return { changes: info.changes };
}

function normalizeValue(v) {
  if (v === undefined) return null;
  if (v === null || typeof v === 'number' || typeof v === 'string' || Buffer.isBuffer(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return JSON.stringify(v);
}

export function updateRow(db, table, id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map(k => `"${k}" = ?`).join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map(k => normalizeValue(patch[k])), id);
}

export function getSetting(db, key, dflt = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? safeJSON(r.value, dflt) : dflt;
}

export function setSetting(db, key, value, actor = 'system') {
  db.prepare(`INSERT INTO settings(key,value,updated_at,updated_by) VALUES(?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .run(key, JSON.stringify(value), nowISO(), actor);
  return value;
}

export function audit(db, { actor = 'system', actorRole = 'system', action, target = '', payload = {}, ip = '', result = 'ok' }) {
  return insert(db, 'audit_log', {
    id: uuid(), ts: nowISO(), actor, actor_role: actorRole, action, target,
    payload: JSON.stringify(payload).slice(0, 8000), ip, result,
  });
}

export function initUsers(db, cfg) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count) return { created: false, password: null };
  const users = [[cfg.adminUser, cfg.adminPassword, 'admin']];
  for (const part of String(cfg.adminExtraUsers || '').split(',')) {
    const [u, p] = part.split(':');
    if (u && p) users.push([u.trim(), p.trim(), 'admin']);
  }
  const stmt = db.prepare('INSERT OR IGNORE INTO users(id,username,password_hash,role,created_at) VALUES(?,?,?,?,?)');
  for (const [u, p, role] of users) stmt.run(uuid(), u, scryptHash(p), role, nowISO());
  return { created: true, password: cfg.generatedPassword ? cfg.adminPassword : null };
}

export function defaultSettings(db) {
  const defaults = {
    maintenance_mode: false,
    maintenance_text: 'Идут технические работы. Матчи временно недоступны.',
    maintenance_eta: '',
    feature_flags: { leaderboard: true, shop: true, online: false, replays: true, push_feed: true },
    rules_version: 4,
    match_rules: {
      version: 4, zoneShape: 'oval', captureRadius: 0.22, depthTolerance: 0.22,
      ovalSideTouchPx: 60, ovalSideMousePx: 44, serveCaptureRadius: 0.55,
      trajectoryAssist: 0.85, positionAssist: 0.85,
    },
    alert_thresholds: {
      crash_rate_pct: 3, reject_rate_pct: 40, error_5xx_pct: 5,
      p95_latency_ms: 500, dau_drop_pct: 20, fps_min: 40,
    },
    priorities: ['Стабильность ввода на Android', 'Рост D7 retention', 'Снижение доли STATIC_CLICK'],
  };
  for (const [k, v] of Object.entries(defaults)) {
    const exists = db.prepare('SELECT 1 FROM settings WHERE key=?').get(k);
    if (!exists) setSetting(db, k, v, 'system');
  }
}

/** Удаление/анонимизация игрока по праву на удаление (16-legal-player-agreements.md).
 * Агрегаты и финансовые суммы можно сохранить, но связь с личностью удаляется
 * во ВСЕХ таблицах. Тикеты/события, где свободный текст может содержать ПДн,
 * удаляются целиком. Операция атомарна. */
export function anonymizePlayer(db, playerId) {
  db.exec('BEGIN');
  try {
    const now = nowISO();
    db.prepare(`UPDATE players SET email_hash=NULL, device_fingerprint_hash=NULL, telegram_id=NULL,
      display_name='deleted', status='deleted', risk_score=0, ltv_usd=0,
      banned_at=NULL, ban_reason=NULL, deleted_at=? WHERE id=?`).run(now, playerId);
    db.prepare('DELETE FROM consents WHERE player_id=?').run(playerId);
    db.prepare('DELETE FROM events WHERE player_id=?').run(playerId);
    db.prepare('DELETE FROM ops_errors WHERE player_id=?').run(playerId);
    db.prepare('DELETE FROM fraud_signals WHERE player_id=?').run(playerId);
    db.prepare('DELETE FROM fraud_cases WHERE player_id=?').run(playerId);
    db.prepare('DELETE FROM push_reads WHERE player_id=?').run(playerId);
    // Свободный текст обращений может содержать ПДн — не обезличиваем, а удаляем.
    const ticketIds = db.prepare('SELECT id FROM tickets WHERE player_id=?').all(playerId).map(x => x.id);
    for (const id of ticketIds) db.prepare('DELETE FROM ticket_messages WHERE ticket_id=?').run(id);
    db.prepare('DELETE FROM tickets WHERE player_id=?').run(playerId);
    // Анонимная телеметрия остаётся для метрик, но без player_id.
    for (const table of ['game_sessions', 'input_logs', 'ops_perf', 'ops_crashes', 'payments', 'economy_events', 'market_events']) {
      db.prepare(`UPDATE ${table} SET player_id=NULL WHERE player_id=?`).run(playerId);
    }
    db.prepare(`UPDATE deletion_requests SET player_id='deleted', status='completed', completed_at=? WHERE player_id=?`).run(now, playerId);
    db.prepare('DELETE FROM director_chat WHERE content LIKE ?').run(`%${playerId}%`);
    db.prepare('DELETE FROM ai_quarantine WHERE raw LIKE ?').run(`%${playerId}%`);
    db.prepare(`UPDATE audit_log SET target='deleted' WHERE target=?`).run(playerId);
    db.prepare(`UPDATE audit_log SET payload=REPLACE(payload, ?, 'deleted') WHERE payload LIKE ?`).run(playerId, `%${playerId}%`);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function tableCounts(db) {
  const tables = ['players', 'events', 'game_sessions', 'input_logs', 'payments', 'alerts',
    'fraud_cases', 'tickets', 'news', 'pushes', 'director_chat', 'ai_requests', 'zone_summaries'];
  const out = {};
  for (const t of tables) out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  return out;
}
