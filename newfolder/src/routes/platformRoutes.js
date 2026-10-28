'use strict';

/**
 * Platform & Governance routes — the parts of the admin API that are about the
 * platform itself rather than a game domain: operator accounts, scheduler-adjacent
 * diagnostics, governance/compliance reporting, alert silences and SLO accounting.
 *
 * Kept in its own module so `adminRoutes.js` stays a domain router. Every handler
 * returns `null` when the path is not its own, which lets the caller fall through.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const { CONFIG, ROLES, DATA_RESIDENCY_MAP, AGE_GATE_RULES, RETENTION_DAYS, AI_ZONES } = require('../config');
const { PERMISSIONS: P, ROLE_PERMISSIONS, permissionsForRole, navigationForRole, hasPermission } = require('../security/permissions');
const { hashPassword } = require('../security/auth');
const { writeAuditLog, verifyAuditChain } = require('../security/audit');
const { listAllZonesStatus } = require('../ai/providers');
const { computeGoldenSignals } = require('../services/observability');
const { schedulerStatus } = require('../services/scheduler');
const { runReadinessChecklist } = require('../services/readiness');
const { publish } = require('../services/eventBus');

const SERVER_STARTED_AT = Date.now();

const ROLE_LABELS = Object.freeze({
  [ROLES.PLAYER]: 'Игрок (клиент)',
  [ROLES.ADMIN]: 'Администратор (владелец)',
  [ROLES.AI_ZONE_OPS]: 'Зона Ops',
  [ROLES.AI_ZONE_FRAUD]: 'Зона Fraud',
  [ROLES.AI_ZONE_BALANCE]: 'Зона Balance',
  [ROLES.AI_ZONE_MARKET]: 'Зона Market',
  [ROLES.AI_ZONE_LAB]: 'Зона Lab',
  [ROLES.AI_DIRECTOR]: 'Слой директора',
});

/* -------------------------------------------------------------------------- */
/* Explicit SLO definitions (observability spec: golden signals + error budget) */
/* -------------------------------------------------------------------------- */

const SLO_TARGETS = Object.freeze([
  {
    id: 'availability',
    name: 'Доступность API',
    description: 'Доля запросов без ответа 5xx за последние 5 минут',
    targetPct: 99.5,
    direction: 'above',
    evaluate: (g) => Math.max(0, 100 - Number(g.errors?.errorRatePct || 0)),
    metric: 'error_rate_pct',
  },
  {
    id: 'latency_p95',
    name: 'Задержка HTTP p95',
    description: 'p95 ответа API не должен превышать 120 мс',
    targetPct: 95,
    direction: 'below',
    targetValueMs: 120,
    evaluate: (g) => Number(g.latency?.httpP95Ms || 0),
    metric: 'http_latency_p95_ms',
  },
  {
    id: 'client_rtt',
    name: 'Клиентский RTT p95',
    description: 'p95 RTT клиента в Mini App не должен превышать 100 мс',
    targetPct: 95,
    direction: 'below',
    targetValueMs: 100,
    evaluate: (g) => Number(g.latency?.clientRttP95Ms || 0),
    metric: 'client_rtt_p95_ms',
  },
  {
    id: 'realtime_uptime',
    name: 'Стабильность realtime',
    description: 'Таймауты WebSocket-соединений за сутки',
    targetPct: 99,
    direction: 'below',
    targetValueMs: 20,
    evaluate: (g) => Number(g.errors?.wsTimeouts24h || 0),
    metric: 'ws_timeouts_24h',
  },
]);

function computeSloReport(db) {
  const g = computeGoldenSignals(db);
  const targets = SLO_TARGETS.map((slo) => {
    const value = slo.evaluate(g);
    const breached = slo.targetValueMs
      ? value > slo.targetValueMs
      : value < slo.targetPct;
    const headroom = slo.targetValueMs
      ? Math.max(0, Math.min(100, ((slo.targetValueMs - value) / slo.targetValueMs) * 100))
      : Math.max(0, Math.min(100, ((value - slo.targetPct) / Math.max(0.001, 100 - slo.targetPct)) * 100));
    return {
      id: slo.id,
      name: slo.name,
      description: slo.description,
      metric: slo.metric,
      targetPct: slo.targetPct,
      targetValue: slo.targetValueMs || slo.targetPct,
      direction: slo.direction,
      currentPct: slo.targetValueMs ? null : Number(value.toFixed(2)),
      currentValue: Number(value.toFixed(2)),
      budgetRemainingPct: Number(headroom.toFixed(1)),
      breached,
    };
  });
  return {
    targets,
    evaluatedAt: new Date().toISOString(),
    windowMinutes: 5,
    telegram: {
      alertsEnabled: process.env.CRM_TELEGRAM_ALERTS !== '0',
      digestTime: CONFIG.digestTimeUtc || '09:00',
      recipients: Number(process.env.CRM_TELEGRAM_RECIPIENTS || 1),
      readOnly: true,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Alert silences                                                              */
/* -------------------------------------------------------------------------- */

function listActiveSilences(db) {
  return db
    .prepare('SELECT * FROM alert_silences WHERE expires_at > ? ORDER BY created_at DESC')
    .all(new Date().toISOString());
}

function createSilence(db, { fingerprint, reason, createdBy, minutes = 120 }) {
  if (!fingerprint || !reason) return null;
  const now = new Date();
  const id = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + Math.max(5, Math.min(1440, Number(minutes) || 120)) * 60000).toISOString();
  db.prepare(
    'INSERT INTO alert_silences (id, fingerprint, reason, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, fingerprint, reason, createdBy, now.toISOString(), expiresAt);
  return { id, fingerprint, reason, createdBy, createdAt: now.toISOString(), expiresAt };
}

function isSilenced(db, fingerprint) {
  const row = db
    .prepare('SELECT 1 AS ok FROM alert_silences WHERE fingerprint = ? AND expires_at > ? LIMIT 1')
    .get(fingerprint, new Date().toISOString());
  return Boolean(row);
}

/* -------------------------------------------------------------------------- */
/* Shared aggregates                                                           */
/* -------------------------------------------------------------------------- */

function ticketSlaSummary(db) {
  const settings = db.prepare("SELECT value_json FROM system_settings WHERE key = 'ticket_sla'").get();
  let cfg = { firstResponseMinutes: 30, resolutionHours: 24, stormThreshold: 8, stormWindowMinutes: 15 };
  if (settings) {
    try {
      cfg = { ...cfg, ...JSON.parse(settings.value_json) };
    } catch {
      /* fall back to defaults */
    }
  }
  const nowIso = new Date().toISOString();
  const windowStart = new Date(Date.now() - cfg.stormWindowMinutes * 60000).toISOString();
  const open = Number(db.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE status IN ('open','in_progress','waiting_player','answered')").get()?.c || 0);
  const overdue = Number(
    db.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE status NOT IN ('closed','resolved') AND sla_due_at IS NOT NULL AND sla_due_at < ?").get(nowIso)?.c || 0
  );
  const awaitingFirstResponse = Number(
    db.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE status NOT IN ('closed','resolved') AND first_response_at IS NULL").get()?.c || 0
  );
  const closedToday = Number(
    db.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE status IN ('closed','resolved') AND updated_at >= ?").get(new Date(Date.now() - 86400000).toISOString())?.c || 0
  );
  const firstResponse = db
    .prepare('SELECT AVG(first_response_minutes) AS avg FROM support_tickets WHERE first_response_minutes IS NOT NULL')
    .get();
  const recent = Number(db.prepare('SELECT COUNT(*) AS c FROM support_tickets WHERE created_at >= ?').get(windowStart)?.c || 0);
  const uniquePlayers = Number(
    db.prepare('SELECT COUNT(DISTINCT player_id) AS c FROM support_tickets WHERE created_at >= ?').get(windowStart)?.c || 0
  );
  return {
    ...cfg,
    open,
    overdue,
    awaitingFirstResponse,
    closedToday,
    avgFirstResponseMin: Number(firstResponse?.avg || 0).toFixed(1) * 1,
    targetFirstResponseMin: cfg.firstResponseMinutes,
    targetResolutionHours: cfg.resolutionHours,
    stormDetected: recent >= cfg.stormThreshold,
    stormThreshold: cfg.stormThreshold,
    stormWindowMinutes: cfg.stormWindowMinutes,
    recentCount: recent,
    uniquePlayers,
  };
}

function observabilityExtras(db) {
  const report = computeSloReport(db);
  return {
    slo: report,
    silences: listActiveSilences(db),
    quarantined: db
      .prepare('SELECT id, zone, reason, created_at FROM ai_quarantine ORDER BY created_at DESC LIMIT 20')
      .all(),
    topApiErrors: db
      .prepare(
        `SELECT json_extract(labels_json, '$.method') AS method,
                json_extract(labels_json, '$.path') AS path,
                CAST(json_extract(labels_json, '$.status') AS INTEGER) AS status,
                SUM(metric_value) AS cnt
           FROM telemetry_metrics
          WHERE metric_name = 'http_error' AND bucket_ts >= ?
          GROUP BY method, path, status
          ORDER BY cnt DESC LIMIT 10`
      )
      .all(new Date(Date.now() - 24 * 3600 * 1000).toISOString()),
    series: {
      latency: db
        .prepare("SELECT metric_value FROM telemetry_metrics WHERE metric_name IN ('http_latency_p95_ms','http_latency_ms') ORDER BY bucket_ts DESC LIMIT 24")
        .all()
        .map((r) => Number(r.metric_value))
        .reverse(),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Route handlers                                                              */
/* -------------------------------------------------------------------------- */

async function handlePlatformRoutes(ctx) {
  const { db, req, pathname, urlObj, body, principal, ipHash, guard } = ctx;
  const method = req.method;

  /* ------------------------------ Maintenance GET ------------------------------ */
  if (method === 'GET' && pathname === '/api/admin/maintenance') {
    const denied = guard(P.LIVEOPS_READ);
    if (denied) return denied;
    const { getMaintenanceState } = require('../services/liveops');
    return { status: 200, json: getMaintenanceState(db) };
  }

  /* ------------------------------ Alert silences ------------------------------ */
  if (method === 'POST' && pathname === '/api/admin/observability/silence') {
    const denied = guard(P.OBSERVABILITY_READ);
    if (denied) return denied;
    const fingerprint = String(body.fingerprint || body.metric || '').trim();
    const reason = String(body.reason || '').trim();
    if (!fingerprint) return { status: 400, json: { error: 'FINGERPRINT_REQUIRED' } };
    if (reason.length < 5) return { status: 400, json: { error: 'REASON_TOO_SHORT', message: 'Причина должна быть не короче 5 символов' } };
    const silence = createSilence(db, { fingerprint, reason, createdBy: principal.username, minutes: body.minutes });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'observability.alert_silenced',
      targetType: 'alert_silences',
      targetId: silence.id,
      applied: { fingerprint, reason, expiresAt: silence.expiresAt },
      ipHash,
    });
    publish('silence', { id: silence.id, fingerprint, expiresAt: silence.expiresAt });
    return { status: 201, json: { ok: true, silence } };
  }

  const silenceMatch = pathname.match(/^\/api\/admin\/observability\/silence\/([^/]+)$/);
  if (method === 'DELETE' && silenceMatch) {
    const denied = guard(P.OBSERVABILITY_READ);
    if (denied) return denied;
    const row = db.prepare('SELECT * FROM alert_silences WHERE id = ?').get(silenceMatch[1]);
    if (!row) return { status: 404, json: { error: 'SILENCE_NOT_FOUND' } };
    db.prepare('DELETE FROM alert_silences WHERE id = ?').run(silenceMatch[1]);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'observability.alert_unsilenced',
      targetType: 'alert_silences',
      targetId: row.id,
      applied: { fingerprint: row.fingerprint },
      ipHash,
    });
    publish('silence', { id: row.id, fingerprint: row.fingerprint, removed: true });
    return { status: 200, json: { ok: true, id: row.id } };
  }

  /* --------------------------------- Governance -------------------------------- */
  if (method === 'GET' && pathname === '/api/admin/governance') {
    const denied = guard(P.GOVERNANCE_READ);
    if (denied) return denied;

    const readiness = runReadinessChecklist(db);
    const grouped = new Map();
    for (const check of readiness.checks || []) {
      const key = check.category || 'general';
      if (!grouped.has(key)) grouped.set(key, { name: key, passed: 0, total: 0, items: [] });
      const group = grouped.get(key);
      group.items.push(check);
      group.total += 1;
      if (check.passed) group.passed += 1;
    }

    const auditByAction = db
      .prepare('SELECT action, COUNT(*) AS cnt FROM audit_logs GROUP BY action ORDER BY cnt DESC LIMIT 10')
      .all();
    const auditTotal = Number(db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get()?.c || 0);
    const chain = verifyAuditChain(db);
    const zoneBudgets = listAllZonesStatus(db)
      .filter((z) => ['ops', 'fraud', 'balance', 'market', 'lab'].includes(z.zone))
      .map((z) => ({
      zone: z.zone,
      provider: z.provider,
      model: z.model,
      limit: z.dailyTokenLimit,
      used: z.usedTokens,
      remaining: z.remainingTokens,
      utilizationPct: z.utilizationPct,
      costUsd: z.costUsdToday,
      hasApiKey: z.hasApiKey,
      }));

    const userCounts = db
      .prepare('SELECT role, COUNT(*) AS c FROM admin_users GROUP BY role')
      .all()
      .reduce((acc, r) => ({ ...acc, [r.role]: Number(r.c) }), {});

    return {
      status: 200,
      json: {
        ok: true,
        readiness,
        groups: Array.from(grouped.values()),
        recentAudit: db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 12').all(),
        auditByAction,
        audit: {
          total: auditTotal,
          verified: chain.valid,
          checked: chain.checked,
          headHash: chain.headHash,
          algorithm: chain.algorithm,
        },
        roles: Object.values(ROLES).map((role) => ({
          id: role,
          name: ROLE_LABELS[role] || role,
          description: role === ROLES.ADMIN
            ? 'Полный доступ: подтверждение решений HITL, публикация правил, санкции, системные операции'
            : `Изолированный доступ: ${(ROLE_PERMISSIONS[role] || []).length} прав без пересечения с другими зонами`,
          permissions: permissionsForRole(role),
          tabs: navigationForRole(role).map((t) => t.id),
          users: userCounts[role] || 0,
        })),
        policy: {
          bootstrapAdmin: { email: String(process.env.BOOTSTRAP_ADMIN_EMAIL || 'owner@topspin.arena'), role: ROLES.ADMIN },
          rules: [
            'ИИ только предлагает: ни одно действие не применяется без подтверждения человека',
            'ИИ никогда не упоминается игрокам и не имеет канала связи с клиентом',
            'Пять зон изолированы: ключи, схемы чтения, промпты и лимиты не пересекаются',
            'Промпт-инъекции отсекаются блоком DATA и валидацией JSON Schema',
            'Ответ, не прошедший схему, уходит в карантин, а не в чат директора',
          ],
          quarantinedCount: Number(db.prepare('SELECT COUNT(*) AS c FROM ai_quarantine').get()?.c || 0),
          directorWindowHours: CONFIG.directorSlidingWindowHours,
          zeroRetention: Object.values(AI_ZONES).every((z) => z.zeroRetention !== false),
        },
        aiBudgets: zoneBudgets,
        compliance: {
          minAge: AGE_GATE_RULES.DEFAULT.minAgeWithoutParentalConsent,
          guardianUnder: AGE_GATE_RULES.EU.minAgeWithoutParentalConsent,
          retentionInputDays: RETENTION_DAYS.inputLogs,
          retentionTelemetryDays: RETENTION_DAYS.telemetrySessions,
          retentionDirectorDays: RETENTION_DAYS.directorChatArchive,
          deletionSlaDays: RETENTION_DAYS.deletionSlaDays,
        },
        residency: Object.entries(DATA_RESIDENCY_MAP).map(([region, meta]) => ({
          region,
          storage: meta.dbCluster,
          regime: meta.legalRegime,
          allowed: meta.piiAllowedOnPrimary !== false,
          note: meta.piiAllowedOnPrimary === false ? 'PII не хранится на первичном кластере' : 'PII разрешены',
        })),
      },
    };
  }

  /* --------------------------------- Settings --------------------------------- */
  if (method === 'GET' && pathname === '/api/admin/settings') {
    const denied = guard(P.SYSTEM_READ);
    if (denied) return denied;

    const users = db
      .prepare('SELECT id, username, role, display_name, last_login_at, created_at FROM admin_users ORDER BY created_at ASC')
      .all()
      .map((u) => ({ ...u, email: u.username, name: u.display_name, isActive: true }));
    const sessions = db
      .prepare('SELECT id, actor_id, role, created_at, last_seen_at, expires_at, revoked_at FROM admin_sessions ORDER BY last_seen_at DESC LIMIT 40')
      .all()
      .map((s) => ({ ...s, email: s.actor_id, current: s.id === (principal.sid || null) }));
    const jobs = schedulerStatus(db);
    const zones = listAllZonesStatus(db);
    const aiUsedToday = zones.reduce((sum, z) => sum + Number(z.usedTokens || 0), 0);
    const aiBudgetToday = zones.reduce((sum, z) => sum + Number(z.dailyTokenLimit || 0), 0);

    return {
      status: 200,
      json: {
        ok: true,
        users,
        sessions,
        scheduler: { jobs: Array.isArray(jobs) ? jobs : jobs.jobs || [], enabled: process.env.CRM_SCHEDULER_DISABLED !== '1' },
        jobs: Array.isArray(jobs) ? jobs : jobs.jobs || [],
        providers: zones,
        zones,
        roles: Object.values(ROLES).map((role) => ({ id: role, name: ROLE_LABELS[role] || role, permissions: permissionsForRole(role) })),
        aiUsedToday,
        aiBudgetToday,
        openTickets: Number(db.prepare("SELECT COUNT(*) AS c FROM support_tickets WHERE status NOT IN ('closed','resolved')").get()?.c || 0),
        envFacts: {
          CRM_DB_PATH: CONFIG.dbPath.replace(CONFIG.rootDir, ''),
          CRM_ARCHIVE_DB_PATH: CONFIG.archiveDbPath.replace(CONFIG.rootDir, ''),
          CRM_SCHEDULER_DISABLED: process.env.CRM_SCHEDULER_DISABLED === '1',
          ADMIN_ALLOWED_ORIGINS: (CONFIG.allowedOrigins || []).join(', '),
          REQUIRE_SESSION_REGISTRY: CONFIG.requireSessionRegistry !== false,
          NODE_ENV: process.env.NODE_ENV || 'development',
        },
      },
    };
  }

  /* -------------------------------- Diagnostics -------------------------------- */
  if (method === 'GET' && pathname === '/api/admin/system/diagnostics') {
    const denied = guard(P.SYSTEM_READ);
    if (denied) return denied;

    let sizeMb = 0;
    try {
      sizeMb = Number((fs.statSync(db.__filePath || CONFIG.dbPath).size / 1048576).toFixed(2));
    } catch {
      sizeMb = 0;
    }
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
    const counts = {};
    for (const table of tables) {
      try {
        counts[table] = Number(db.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get()?.c || 0);
      } catch {
        counts[table] = null;
      }
    }
    const mem = process.memoryUsage();
    const chain = verifyAuditChain(db);
    const jobs = schedulerStatus(db);
    return {
      status: 200,
      json: {
        generatedAt: new Date().toISOString(),
        uptimeSec: Math.round((Date.now() - SERVER_STARTED_AT) / 1000),
        node: process.version,
        memoryMb: Number((mem.rss / 1048576).toFixed(1)),
        heapUsedMb: Number((mem.heapUsed / 1048576).toFixed(1)),
        db: { file: db.__filePath || CONFIG.dbPath, sizeMb, tables: tables.length, counts },
        migrations: db.__migrations || [],
        auditChain: { valid: chain.valid, checked: chain.checked, headHash: chain.headHash },
        scheduler: { running: Boolean(process.env.CRM_SCHEDULER_DISABLED !== '1'), jobs: (jobs.jobs || jobs || []).length },
        pendingJobs: (jobs.jobs || jobs || []).filter((j) => j.enabled && j.next_run_at && j.next_run_at <= new Date().toISOString()).length,
        runtime: {
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          sessionRegistry: CONFIG.requireSessionRegistry !== false,
        },
      },
    };
  }

  /* ---------------------------------- Users ----------------------------------- */
  if (method === 'GET' && pathname === '/api/admin/users') {
    const denied = guard(P.USERS_MANAGE);
    if (denied) return denied;
    const users = db
      .prepare('SELECT id, username, role, display_name, last_login_at, created_at FROM admin_users ORDER BY created_at ASC')
      .all()
      .map((u) => ({ ...u, email: u.username, name: u.display_name, is_active: 1 }));
    return { status: 200, json: { items: users, users, roles: Object.values(ROLES).map((r) => ({ id: r, name: ROLE_LABELS[r] || r })) } };
  }

  if (method === 'POST' && pathname === '/api/admin/users') {
    const denied = guard(P.USERS_MANAGE);
    if (denied) return denied;
    const username = String(body.email || body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const role = String(body.role || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(username)) return { status: 400, json: { error: 'EMAIL_INVALID' } };
    if (password.length < 12) return { status: 400, json: { error: 'PASSWORD_TOO_SHORT', message: 'Пароль должен быть не короче 12 символов' } };
    if (!Object.values(ROLES).includes(role) || role === ROLES.PLAYER) return { status: 400, json: { error: 'ROLE_INVALID' } };
    const exists = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
    if (exists) return { status: 409, json: { error: 'USER_EXISTS' } };
    const id = crypto.randomUUID();
    db.prepare(
      'INSERT INTO admin_users (id, username, password_hash, role, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, username, hashPassword(password), role, String(body.name || body.displayName || username).slice(0, 120), new Date().toISOString());
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'admin.user.created',
      targetType: 'admin_users',
      targetId: id,
      applied: { username, role },
      ipHash,
    });
    publish('user', { id, username, role, action: 'created' });
    return { status: 201, json: { ok: true, id, username, role } };
  }

  const userMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (method === 'PATCH' && userMatch) {
    const denied = guard(P.USERS_MANAGE);
    if (denied) return denied;
    const target = db.prepare('SELECT id, username, role FROM admin_users WHERE id = ?').get(userMatch[1]);
    if (!target) return { status: 404, json: { error: 'USER_NOT_FOUND' } };
    const nextRole = body.role ? String(body.role) : target.role;
    if (!Object.values(ROLES).includes(nextRole) || nextRole === ROLES.PLAYER) return { status: 400, json: { error: 'ROLE_INVALID' } };
    const displayName = body.name || body.displayName;
    db.prepare('UPDATE admin_users SET role = ?, display_name = COALESCE(?, display_name) WHERE id = ?').run(
      nextRole,
      displayName ? String(displayName).slice(0, 120) : null,
      target.id
    );
    if (body.password) {
      if (String(body.password).length < 12) return { status: 400, json: { error: 'PASSWORD_TOO_SHORT' } };
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.password)), target.id);
    }
    if (body.isActive === false) {
      db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE actor_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), target.username);
    }
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'admin.user.updated',
      targetType: 'admin_users',
      targetId: target.id,
      applied: { role: nextRole, passwordRotated: Boolean(body.password), deactivated: body.isActive === false },
      ipHash,
    });
    publish('user', { id: target.id, username: target.username, role: nextRole, action: 'updated' });
    return { status: 200, json: { ok: true, id: target.id, role: nextRole } };
  }

  /* ------------------------- Governance export shortcut ----------------------- */
  if (method === 'GET' && pathname === '/api/admin/governance/roles') {
    const denied = guard(P.GOVERNANCE_READ);
    if (denied) return denied;
    return {
      status: 200,
      json: {
        roles: Object.values(ROLES).map((role) => ({
          id: role,
          name: ROLE_LABELS[role] || role,
          permissions: permissionsForRole(role),
          tabs: navigationForRole(role).map((t) => t.id),
        })),
        can: (permission) => hasPermission(principal.role, permission),
      },
    };
  }

  return null;
}

module.exports = {
  handlePlatformRoutes,
  observabilityExtras,
  computeSloReport,
  ticketSlaSummary,
  listActiveSilences,
  isSilenced,
  SLO_TARGETS,
  ROLE_LABELS,
};
