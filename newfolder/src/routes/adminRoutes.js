'use strict';

/**
 * Admin CRM API Routes (`/api/admin/*`) — Strict RBAC, CSRF Origin Guard & Full Audit Trail
 */

const crypto = require('node:crypto');
const { CONFIG, ROLES, MATCH_RULES_V4, REGION_ENDPOINTS, PING_THRESHOLDS } = require('../config');
const { runRetentionCleanup } = require('../db/database');
const { ZONE_ALLOWED_TABLES, DIRECTOR_ALLOWED_TABLES } = require('../db/isolation');
const {
  verifyPassword,
  signToken,
  authenticateAdminRequest,
  hasPermission,
  buildSessionCookie,
  clearSessionCookie,
  buildCsrfCookie,
  clearCsrfCookie,
  createAdminSession,
  getActiveSession,
  revokeAdminSession,
  listAdminSessions,
  verifyCsrf,
  parseCookies,
  checkLoginAttemptLimit,
  recordFailedLoginAttempt,
  clearLoginAttempts,
} = require('../security/auth');
const { writeAuditLog, hashIdentifier, verifyAuditChain } = require('../security/audit');
const {
  PERMISSIONS: P,
  hasPermission: roleHas,
  canReadZone,
  canRunZone,
  deny,
  permissionsForRole,
  navigationForRole,
} = require('../security/permissions');
const { checkRateLimit } = require('../security/validator');
const { publish, subscribe, replaySince, stats: busStats } = require('../services/eventBus');
const {
  notify,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
} = require('../services/notifications');
const { schedulerStatus, runJob, setJobEnabled, ensureJobs } = require('../services/scheduler');
const idempotency = require('../services/idempotency');
const { parseListQuery, listResponse, countTotal, parseJsonColumn, toCsv, csvResult } = require('./query');
const { ZONE_SUMMARY_JSON_SCHEMA, DIRECTOR_RESPONSE_JSON_SCHEMA } = require('../security/jsonSchema');

const { listAllZonesStatus, updateZoneConfig } = require('../ai/providers');
const { computeOpsDashboard, runOpsZoneAnalysis } = require('../ai/zones/opsZone');
const { computeFraudDashboard, runFraudZoneAnalysis } = require('../ai/zones/fraudZone');
const { computeBalanceDashboard, runBalanceZoneAnalysis } = require('../ai/zones/balanceZone');
const { computeMarketDashboard, runMarketZoneAnalysis } = require('../ai/zones/marketZone');
const { importOrRunLabSuite, computeLabDashboard, runLabZoneAnalysis } = require('../ai/zones/labZone');
const {
  getDirectorContext,
  getArchivedDirectorChat,
  updateDirectorPriorities,
  askDirector,
} = require('../ai/director');
const {
  computeGoldenSignals,
  evaluateBaselineAnomalies,
  listRunbooks,
  getRunbookBySlug,
  listIncidents,
  createIncident,
  updateIncidentStatus,
  createPostmortem,
  listPostmortems,
} = require('../services/observability');
const {
  executeReadOnlyBotCommand,
  handleTelegramCallbackQuery,
  buildMorningDigest,
  sendCriticalTelegramAlert,
} = require('../services/telegramBot');
const {
  AGE_GATE_RULES,
  getMaintenanceState,
  setMaintenanceState,
  createPushNotification,
  listPushNotifications,
  createNewsPost,
  updateNewsPost,
  listNewsPosts,
  deleteNewsPost,
  listSupportTickets,
  replyToSupportTicket,
  listPlayerFeedback,
  createOrUpdateFeedbackItem,
  listPatchPipeline,
  createPatchRelease,
  listLegalDocuments,
  listProviderDpaRegistry,
  exportPlayerDataPackage,
  executeRightToErasure,
  listLiveopsCalendar,
  createLiveopsEvent,
} = require('../services/liveops');
const { runReadinessChecklist, triggerDisasterRecoveryBackup } = require('../services/readiness');
const { handlePlatformRoutes, observabilityExtras, ticketSlaSummary } = require('./platformRoutes');

async function handleAdminRoute(db, req, pathname, urlObj, body, clientIp, res = null) {
  const ipHash = hashIdentifier(clientIp);
  const rl = checkRateLimit(`admin:${ipHash}`, CONFIG.rateLimits.adminApiPerMinute);
  if (!rl.allowed) {
    return { status: 429, json: { error: 'RATE_LIMITED', message: 'Превышен лимит запросов к API админки' } };
  }

  // -------------------------------------------------------------------------
  // Public Admin Auth Endpoint (5-attempt / 5-min brute-force limiter)
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/admin/auth/login') {
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const loginKey = `${ipHash}:${username || 'anon'}`;

    const attemptCheck = checkLoginAttemptLimit(loginKey);
    if (!attemptCheck.allowed) {
      writeAuditLog(db, {
        actorRole: 'anonymous',
        actorId: username || 'unknown',
        action: 'admin.login.rate_limited',
        targetType: 'admin_users',
        ipHash,
      });
      return {
        status: 429,
        headers: { 'Retry-After': String(attemptCheck.retryAfterSec || 60) },
        json: {
          error: 'TOO_MANY_LOGIN_ATTEMPTS',
          retryAfterSec: attemptCheck.retryAfterSec,
          message: 'Слишком много неудачных попыток входа (макс. 5 за 5 минут)',
        },
      };
    }

    const row = db
      .prepare('SELECT id, username, password_hash, role, display_name FROM admin_users WHERE lower(username) = ?')
      .get(username);
    if (!row || !verifyPassword(password, row.password_hash)) {
      recordFailedLoginAttempt(loginKey);
      writeAuditLog(db, {
        actorRole: 'anonymous',
        actorId: username || 'unknown',
        action: 'admin.login.failed',
        targetType: 'admin_users',
        ipHash,
      });
      return { status: 401, json: { error: 'INVALID_CREDENTIALS', message: 'Неверный логин или пароль' } };
    }

    clearLoginAttempts(loginKey);
    db.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);

    const actor = { id: row.id, username: row.username, role: row.role };
    const session = createAdminSession(db, {
      actor,
      ipHash,
      userAgent: req.headers['user-agent'] || null,
    });
    const token = signToken({
      sub: row.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name,
      sid: session.sid,
    });

    writeAuditLog(db, {
      actorRole: row.role,
      actorId: row.username,
      action: 'admin.login.success',
      targetType: 'admin_sessions',
      targetId: session.sid,
      applied: { expiresAt: session.expiresAt },
      ipHash,
    });
    publish('session', { event: 'login', username: row.username, role: row.role });

    const isSecure = req.headers['x-forwarded-proto'] === 'https';
    return {
      status: 200,
      headers: {
        'Set-Cookie': [buildSessionCookie(token, isSecure), buildCsrfCookie(session.csrfToken, isSecure)],
      },
      json: {
        ok: true,
        token,
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
        user: {
          id: row.id,
          username: row.username,
          role: row.role,
          displayName: row.display_name,
          permissions: permissionsForRole(row.role),
          navigation: navigationForRole(row.role),
        },
      },
    };
  }

  // -------------------------------------------------------------------------
  // Require Authenticated RBAC Principal for all subsequent `/api/admin/*`
  // -------------------------------------------------------------------------
  const principal = authenticateAdminRequest(req, db);
  if (!principal) {
    return { status: 401, json: { error: 'UNAUTHORIZED', message: 'Требуется вход администратора' } };
  }

  // Reject any accidental player token attempting to call `/api/admin/*` (04-security.md)
  if (principal.role === ROLES.PLAYER) {
    return { status: 403, json: { error: 'FORBIDDEN_PLAYER_ROLE', message: 'Токен игрока не имеет доступа к CRM' } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/auth/logout') {
    if (principal.sid) revokeAdminSession(db, principal.sid);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'admin.logout',
      targetType: 'admin_sessions',
      targetId: principal.sid || null,
      ipHash,
    });
    return {
      status: 200,
      headers: { 'Set-Cookie': [clearSessionCookie(), clearCsrfCookie()] },
      json: { ok: true },
    };
  }

  if (req.method === 'GET' && pathname === '/api/admin/auth/me') {
    return {
      status: 200,
      json: {
        ok: true,
        user: {
          id: principal.sub,
          username: principal.username,
          role: principal.role,
          displayName: principal.displayName,
          permissions: permissionsForRole(principal.role),
          navigation: navigationForRole(principal.role),
        },
        session: {
          id: principal.sid || null,
          expiresAt: principal.sessionExpiresAt || null,
          authSource: principal.authSource,
          legacy: Boolean(principal.legacy),
        },
        unreadNotifications: unreadCount(db, principal.role),
      },
    };
  }

  if (req.method === 'POST' && pathname === '/api/admin/auth/refresh') {
    const isSecure = req.headers['x-forwarded-proto'] === 'https';
    const now = new Date();
    let sid = principal.sid;
    let csrfToken = null;
    if (sid) {
      csrfToken = crypto.randomBytes(24).toString('base64url');
      const csrfHash = crypto.createHash('sha256').update(csrfToken).digest('hex');
      db.prepare('UPDATE admin_sessions SET csrf_hash = ?, last_seen_at = ?, expires_at = ? WHERE id = ?').run(
        csrfHash,
        now.toISOString(),
        new Date(now.getTime() + 12 * 3600 * 1000).toISOString(),
        sid
      );
    } else {
      const created = createAdminSession(db, {
        actor: { id: principal.sub, username: principal.username, role: principal.role },
        ipHash,
        userAgent: req.headers['user-agent'] || null,
      });
      sid = created.sid;
      csrfToken = created.csrfToken;
    }
    const token = signToken({
      sub: principal.sub,
      username: principal.username,
      role: principal.role,
      displayName: principal.displayName,
      sid,
    });
    const cookies = [buildSessionCookie(token, isSecure)];
    if (csrfToken) cookies.push(buildCsrfCookie(csrfToken, isSecure));
    return {
      status: 200,
      headers: { 'Set-Cookie': cookies },
      json: {
        ok: true,
        token,
        csrfToken,
        expiresAt: new Date(now.getTime() + 12 * 3600 * 1000).toISOString(),
        user: {
          id: principal.sub,
          username: principal.username,
          role: principal.role,
          displayName: principal.displayName,
          permissions: permissionsForRole(principal.role),
          navigation: navigationForRole(principal.role),
        },
      },
    };
  }

  // -------------------------------------------------------------------------
  // CSRF (double-submit + server-side hash) & replay-safe mutations
  // -------------------------------------------------------------------------
  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const isMutating = MUTATING.has(req.method);

  if (isMutating && pathname !== '/api/admin/auth/logout') {
    const cookies = parseCookies(req.headers['cookie']);
    if (!verifyCsrf(db, req, principal, cookies)) {
      writeAuditLog(db, {
        actorRole: principal.role,
        actorId: principal.username,
        action: 'security.csrf_rejected',
        targetType: 'admin_sessions',
        targetId: principal.sid || null,
        ipHash,
      });
      return {
        status: 403,
        json: {
          error: 'CSRF_TOKEN_INVALID',
          message: 'Недействительный CSRF-токен. Обновите страницу и войдите повторно.',
        },
      };
    }
  }

  const idemKey = isMutating ? String(req.headers['idempotency-key'] || '').trim().slice(0, 128) : '';
  if (idemKey) {
    const hit = idempotency.lookup(
      db,
      idemKey,
      principal.sub,
      idempotency.hashRequest(req.method, pathname, body)
    );
    if (hit.state === 'replay') {
      return { status: hit.status, headers: { 'Idempotent-Replayed': 'true' }, json: hit.json };
    }
    if (hit.state === 'conflict') return hit;
  }

  const result = await dispatchAdmin(db, { req, res, pathname, urlObj, body, clientIp, principal, ipHash });

  if (idemKey && result && Number(result.status) < 500) {
    idempotency.save(
      db,
      idemKey,
      principal.sub,
      req.method,
      pathname,
      body,
      result.status,
      result.json || { rawTextIgnored: Boolean(result.rawText) }
    );
  }
  return result;
}

/**
 * Authenticated dispatcher. Every branch below runs only after:
 * JWT verified -> session registry valid -> role not `player` -> CSRF verified.
 */
async function dispatchAdmin(db, { req, res, pathname, urlObj, body, clientIp, principal, ipHash }) {
  const guard = (perm) => deny(principal.role, perm);

  // =========================================================================
  // Platform meta: capabilities, feature flags and the operator's own scope
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/admin/system/meta') {
    return {
      status: 200,
      json: {
        ok: true,
        version: '3.0.0',
        serverTimeUtc: new Date().toISOString(),
        region: CONFIG.primaryRegion,
        environment: CONFIG.env,
        wsGateway: '/ws/client',
        streamEndpoint: '/api/admin/stream',
        migrations: db.__migrations || [],
        features: {
          sseStream: true,
          scheduler: process.env.CRM_SCHEDULER_DISABLED !== '1',
          idempotency: true,
          auditHashChain: true,
          serverSessions: true,
          csrf: true,
          notifications: true,
        },
        retentionDays: { inputLogs: 90, telemetry: 180, aiLogs: 180, directorChat: 365 },
        rateLimits: CONFIG.rateLimits,
        permissions: permissionsForRole(principal.role),
        navigation: navigationForRole(principal.role),
        role: principal.role,
      },
    };
  }

  // =========================================================================
  // Session management: list & revoke (stolen laptop scenario)
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/admin/auth/sessions') {
    const denied = guard(P.SESSIONS_MANAGE);
    if (denied) return denied;
    const sessions = listAdminSessions(db, principal.sub).map((s) => ({
      id: s.id,
      createdAt: s.created_at,
      lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at,
      revokedAt: s.revoked_at,
      ipHash: s.ip_hash,
      current: s.id === principal.sid,
      active: !s.revoked_at && new Date(s.expires_at) > new Date(),
    }));
    return { status: 200, json: { sessions } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/auth/sessions/revoke') {
    const denied = guard(P.SESSIONS_MANAGE);
    if (denied) return denied;
    const targetId = String(body.sessionId || '');
    if (!targetId) return { status: 400, json: { error: 'SESSION_ID_REQUIRED' } };
    const ok = revokeAdminSession(db, targetId, principal.sub);
    if (ok) {
      writeAuditLog(db, {
        actorRole: principal.role,
        actorId: principal.username,
        action: 'admin.session.revoked',
        targetType: 'admin_sessions',
        targetId,
        ipHash,
      });
    }
    publish('session', { event: 'revoked', sessionId: targetId });
    return { status: ok ? 200 : 404, json: { ok, sessionId: targetId } };
  }

  // =========================================================================
  // Operator Notification Center
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/admin/notifications') {
    const denied = guard(P.NOTIFICATIONS_READ);
    if (denied) return denied;
    const unreadOnly = urlObj.searchParams.get('unread') === '1';
    return {
      status: 200,
      json: {
        items: listNotifications(db, {
          role: principal.role,
          unreadOnly,
          limit: Number(urlObj.searchParams.get('limit') || 60),
        }),
        unread: unreadCount(db, principal.role),
      },
    };
  }

  if (req.method === 'POST' && pathname === '/api/admin/notifications/read') {
    const denied = guard(P.NOTIFICATIONS_READ);
    if (denied) return denied;
    const changed = markRead(db, body.ids || body.id || [], principal.username);
    return { status: 200, json: { ok: true, changed, unread: unreadCount(db, principal.role) } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/notifications/read-all') {
    const denied = guard(P.NOTIFICATIONS_READ);
    if (denied) return denied;
    const changed = markAllRead(db, principal.username, principal.role);
    return { status: 200, json: { ok: true, changed, unread: 0 } };
  }

  // =========================================================================
  // Live stream (Server-Sent Events) — replaces blind polling of the dashboard
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/admin/stream') {
    if (!res) return { status: 500, json: { error: 'STREAM_UNSUPPORTED' } };
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event) => {
      try {
        res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        /* socket gone */
      }
    };
    res.write('retry: 4000\n\n');
    for (const ev of replaySince(req.headers['last-event-id'])) send(ev);
    send({ id: 0, type: 'hello', at: new Date().toISOString(), payload: { role: principal.role, bus: busStats() } });
    const unsubscribe = subscribe(send);
    const heartbeat = setInterval(() => {
      try {
        res.write(`: keep-alive ${Date.now()}\n\n`);
      } catch {
        /* ignore */
      }
    }, 20_000);
    heartbeat.unref?.();
    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
      try {
        res.end();
      } catch {
        /* ignore */
      }
    };
    req.on('close', close);
    req.on('error', close);
    return { handled: true };
  }

  // =========================================================================
  // Scheduler (documented cadences of all 5 zones + platform jobs)
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/admin/scheduler') {
    const denied = guard(P.SCHEDULER_READ);
    if (denied) return denied;
    ensureJobs(db);
    return { status: 200, json: schedulerStatus(db) };
  }

  const jobRunMatch = pathname.match(/^\/api\/admin\/scheduler\/([a-z0-9_]+)\/run$/);
  if (req.method === 'POST' && jobRunMatch) {
    const denied = guard(P.SCHEDULER_MANAGE);
    if (denied) return denied;
    const jobName = jobRunMatch[1];
    const result = await runJob(db, jobName, { trigger: 'manual', force: Boolean(body.force) });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'system.scheduler.job_run',
      targetType: 'scheduler_jobs',
      targetId: jobName,
      applied: { ok: result.ok, status: result.status || result.error || null },
      ipHash,
    });
    return { status: result.ok ? 200 : 400, json: result };
  }

  const jobToggleMatch = pathname.match(/^\/api\/admin\/scheduler\/([a-z0-9_]+)\/toggle$/);
  if (req.method === 'POST' && jobToggleMatch) {
    const denied = guard(P.SCHEDULER_MANAGE);
    if (denied) return denied;
    const jobName = jobToggleMatch[1];
    const enabled = Boolean(body.enabled);
    const ok = setJobEnabled(db, jobName, enabled);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'system.scheduler.job_toggled',
      targetType: 'scheduler_jobs',
      targetId: jobName,
      applied: { enabled },
      ipHash,
    });
    return { status: ok ? 200 : 404, json: { ok, jobName, enabled } };
  }

  // =========================================================================
  // Tamper-evident audit verification
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/admin/audit/verify') {
    const denied = guard(P.AUDIT_VERIFY);
    if (denied) return denied;
    const result = verifyAuditChain(db);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'audit.chain.verified',
      targetType: 'audit_logs',
      applied: { valid: result.valid, checked: result.checked },
      ipHash,
    });
    return { status: 200, json: result };
  }

  // =========================================================================
  // Global operator search (Cmd/Ctrl+K)
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/admin/search') {
    const denied = guard(P.SEARCH_GLOBAL);
    if (denied) return denied;
    const q = String(urlObj.searchParams.get('q') || '').trim().slice(0, 80);
    if (q.length < 2) return { status: 200, json: { q, groups: [] } };
    const like = `%${q}%`;
    const groups = [];

    if (roleHas(principal.role, P.PLAYERS_READ)) {
      groups.push({
        type: 'player',
        label: 'Игроки',
        items: db
          .prepare(
            `SELECT id, display_name AS title, region || ' · ' || status AS subtitle
             FROM players WHERE id LIKE ? OR display_name LIKE ? ORDER BY last_seen_at DESC LIMIT 5`
          )
          .all(like, like)
          .map((r) => ({ ...r, link: `#/players?player=${r.id}` })),
      });
    }
    if (roleHas(principal.role, P.LIVEOPS_TICKETS)) {
      groups.push({
        type: 'ticket',
        label: 'Тикеты',
        items: db
          .prepare(
            `SELECT id, subject AS title, status || ' · ' || priority AS subtitle
             FROM support_tickets WHERE subject LIKE ? OR id LIKE ? ORDER BY updated_at DESC LIMIT 5`
          )
          .all(like, like)
          .map((r) => ({ ...r, link: `#/liveops?ticket=${r.id}` })),
      });
    }
    if (roleHas(principal.role, P.OBSERVABILITY_READ)) {
      groups.push({
        type: 'incident',
        label: 'Инциденты',
        items: db
          .prepare(
            `SELECT id, title, status || ' · ' || severity AS subtitle FROM incidents
             WHERE title LIKE ? ORDER BY created_at DESC LIMIT 5`
          )
          .all(like)
          .map((r) => ({ ...r, link: `#/observability?incident=${r.id}` })),
      });
    }
    if (roleHas(principal.role, P.HITL_DECIDE)) {
      groups.push({
        type: 'proposal',
        label: 'Решения HITL',
        items: db
          .prepare(
            `SELECT id, title, zone || ' · ' || status AS subtitle FROM action_proposals
             WHERE title LIKE ? OR rationale LIKE ? ORDER BY created_at DESC LIMIT 5`
          )
          .all(like, like)
          .map((r) => ({ ...r, link: `#/overview?proposal=${r.id}` })),
      });
    }
    if (roleHas(principal.role, P.LIVEOPS_NEWS)) {
      groups.push({
        type: 'news',
        label: 'Новости',
        items: db
          .prepare(`SELECT id, title_ru AS title, category AS subtitle FROM news_posts WHERE title_ru LIKE ? LIMIT 5`)
          .all(like)
          .map((r) => ({ ...r, link: `#/liveops?tab=news&news=${r.id}` })),
      });
    }
    return { status: 200, json: { q, groups: groups.filter((g) => g.items.length) } };
  }

  // =========================================================================
  // CSV exports (formula-injection safe) for offline analysis
  // =========================================================================
  const exportMatch = pathname.match(/^\/api\/admin\/exports\/([a-z_]+)\.csv$/);
  if (req.method === 'GET' && exportMatch) {
    const denied = guard(P.EXPORTS_READ);
    if (denied) return denied;
    const dataset = exportMatch[1];
    const stamp = new Date().toISOString().slice(0, 10);
    let columns = null;
    let rows = [];
    if (dataset === 'audit' && roleHas(principal.role, P.AUDIT_READ)) {
      columns = [
        { key: 'id' }, { key: 'created_at' }, { key: 'region' }, { key: 'actor_role' }, { key: 'actor_id' },
        { key: 'action' }, { key: 'target_type' }, { key: 'target_id' }, { key: 'provider' }, { key: 'model' },
        { key: 'tokens_used' }, { key: 'entry_hash' },
      ];
      rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 5000').all();
    } else if (dataset === 'players' && roleHas(principal.role, P.PLAYERS_READ)) {
      columns = [
        { key: 'id' }, { key: 'display_name' }, { key: 'region' }, { key: 'status' }, { key: 'install_source' },
        { key: 'install_campaign' }, { key: 'created_at' }, { key: 'last_seen_at' },
      ];
      rows = db.prepare('SELECT * FROM players ORDER BY last_seen_at DESC LIMIT 5000').all();
    } else if (dataset === 'tickets' && roleHas(principal.role, P.LIVEOPS_TICKETS)) {
      columns = [
        { key: 'id' }, { key: 'player_id' }, { key: 'region' }, { key: 'category' }, { key: 'priority' },
        { key: 'subject' }, { key: 'status' }, { key: 'sla_due_at' }, { key: 'first_response_minutes' },
        { key: 'created_at' }, { key: 'updated_at' },
      ];
      rows = db.prepare('SELECT * FROM support_tickets ORDER BY created_at DESC LIMIT 5000').all();
    } else if (dataset === 'incidents' && roleHas(principal.role, P.OBSERVABILITY_READ)) {
      columns = [
        { key: 'id' }, { key: 'severity' }, { key: 'zone' }, { key: 'title' }, { key: 'status' },
        { key: 'runbook_slug' }, { key: 'created_at' }, { key: 'ack_at' }, { key: 'resolved_at' },
      ];
      rows = db.prepare('SELECT * FROM incidents ORDER BY created_at DESC LIMIT 5000').all();
    } else if (dataset === 'proposals' && roleHas(principal.role, P.HITL_DECIDE)) {
      columns = [
        { key: 'id' }, { key: 'zone' }, { key: 'action_type' }, { key: 'title' }, { key: 'confidence' },
        { key: 'status' }, { key: 'decided_by' }, { key: 'created_at' }, { key: 'decided_at' },
      ];
      rows = db.prepare('SELECT * FROM action_proposals ORDER BY created_at DESC LIMIT 5000').all();
    } else if (dataset === 'campaigns' && roleHas(principal.role, P.ZONE_MARKET_READ)) {
      columns = [
        { key: 'id' }, { key: 'source' }, { key: 'campaign' }, { key: 'creative' }, { key: 'spend_usd' },
        { key: 'installs' }, { key: 'paying_users' }, { key: 'revenue_d30_usd' }, { key: 'updated_at' },
      ];
      rows = db.prepare('SELECT * FROM marketing_campaigns ORDER BY spend_usd DESC LIMIT 5000').all();
    } else if (dataset === 'fraud_cases' && roleHas(principal.role, P.FRAUD_REVIEW)) {
      columns = [
        { key: 'id' }, { key: 'player_id' }, { key: 'region' }, { key: 'risk_score' }, { key: 'case_type' },
        { key: 'status' }, { key: 'reviewed_by' }, { key: 'created_at' }, { key: 'reviewed_at' },
      ];
      rows = db.prepare('SELECT * FROM fraud_cases ORDER BY created_at DESC LIMIT 5000').all();
    }

    if (!columns) return { status: 404, json: { error: 'EXPORT_DATASET_NOT_FOUND_OR_FORBIDDEN', dataset } };

    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'export.csv.generated',
      targetType: 'export',
      targetId: dataset,
      applied: { rows: rows.length },
      ipHash,
    });
    return csvResult(`topspin-${dataset}-${stamp}.csv`, toCsv(columns, rows));
  }

  // =========================================================================
  // Zone summary history (trend instead of a single "latest" snapshot)
  // =========================================================================
  const zoneHistoryMatch = pathname.match(/^\/api\/admin\/zones\/(ops|fraud|balance|market|lab)\/summaries$/);
  if (req.method === 'GET' && zoneHistoryMatch) {
    const zone = zoneHistoryMatch[1];
    if (!canReadZone(principal.role, zone)) {
      return { status: 403, json: { error: 'FORBIDDEN_ZONE_ISOLATION', zone } };
    }
    const limit = Math.min(50, Math.max(1, Number(urlObj.searchParams.get('limit') || 12)));
    const rows = db
      .prepare('SELECT id, status, summary_json, created_at FROM zone_summaries WHERE zone = ? ORDER BY created_at DESC LIMIT ?')
      .all(zone, limit)
      .map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.created_at,
        summary: parseJsonColumn(r.summary_json, {}),
      }));
    return { status: 200, json: { zone, summaries: rows } };
  }

  // =========================================================================
  // Fraud queue: paginated, filterable, with human review trail
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/admin/fraud/cases') {
    if (!canReadZone(principal.role, 'fraud')) {
      return { status: 403, json: { error: 'FORBIDDEN_ZONE_ISOLATION', zone: 'fraud' } };
    }
    const list = parseListQuery(urlObj, {
      allowedSort: ['risk_score', 'created_at', 'reviewed_at'],
      defaultSort: 'risk_score',
      defaultOrder: 'desc',
    });
    const status = String(urlObj.searchParams.get('status') || 'all');
    const where = ['1=1'];
    const params = [];
    if (status !== 'all') {
      where.push('status = ?');
      params.push(status);
    }
    if (list.q) {
      where.push('(id LIKE ? OR player_id LIKE ? OR case_type LIKE ?)');
      params.push(`%${list.q}%`, `%${list.q}%`, `%${list.q}%`);
    }
    const whereSql = `FROM fraud_cases WHERE ${where.join(' AND ')}`;
    const total = countTotal(db, whereSql, params);
    const items = db
      .prepare(`SELECT * ${whereSql} ORDER BY ${list.sort} ${list.order.toUpperCase()} LIMIT ? OFFSET ?`)
      .all(...params, list.pageSize, list.offset)
      .map((c) => ({
        ...c,
        signals: parseJsonColumn(c.signals_json, []),
        reviews: db
          .prepare('SELECT * FROM fraud_case_reviews WHERE case_id = ? ORDER BY created_at DESC LIMIT 5')
          .all(c.id),
      }));
    return {
      status: 200,
      json: {
        ...listResponse(items, { ...list, total }),
        statusCounts: db
          .prepare('SELECT status, COUNT(*) AS c FROM fraud_cases GROUP BY status')
          .all()
          .reduce((acc, r) => ({ ...acc, [r.status]: Number(r.c) }), {}),
      },
    };
  }

  // =========================================================================
  // Player 360: one screen for support, fraud, legal and revenue context
  // =========================================================================
  const playerDetailMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)$/);
  if (req.method === 'GET' && playerDetailMatch) {
    const denied = guard(P.PLAYERS_READ);
    if (denied) return denied;
    const playerId = playerDetailMatch[1];
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
    if (!player) return { status: 404, json: { error: 'PLAYER_NOT_FOUND' } };

    const sessions = db
      .prepare(
        `SELECT id, platform, region, avg_fps, p5_fps, rtt_p50_ms, rtt_p95_ms, crashed, webgl_lost, started_at, ended_at
         FROM sessions WHERE player_id = ? ORDER BY started_at DESC LIMIT 20`
      )
      .all(playerId);
    const payments = db
      .prepare('SELECT id, amount_usd, currency, provider, item_sku, status, risk_flag, created_at FROM payments WHERE player_id = ? ORDER BY created_at DESC LIMIT 20')
      .all(playerId);
    const consents = db
      .prepare('SELECT * FROM player_consents WHERE player_id = ? ORDER BY consented_at DESC LIMIT 10')
      .all(playerId);
    const tickets = db
      .prepare('SELECT id, subject, status, priority, category, sla_due_at, created_at FROM support_tickets WHERE player_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(playerId);
    const fraudCases = db
      .prepare('SELECT id, risk_score, case_type, status, created_at FROM fraud_cases WHERE player_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(playerId);
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS sessions_count,
                COALESCE(SUM(avg_fps), 0) AS fps_sum,
                COALESCE((SELECT SUM(amount_usd) FROM payments WHERE player_id = ? AND status = 'succeeded'), 0) AS lifetime_usd
         FROM sessions WHERE player_id = ?`
      )
      .get(playerId, playerId);

    return {
      status: 200,
      json: {
        player,
        metrics: {
          sessions: Number(totals.sessions_count || 0),
          avgFps: totals.sessions_count ? Math.round(Number(totals.fps_sum) / Number(totals.sessions_count)) : null,
          lifetimeUsd: +Number(totals.lifetime_usd || 0).toFixed(2),
          lastSeenAt: player.last_seen_at,
        },
        sessions,
        payments,
        consents,
        tickets,
        fraudCases,
      },
    };
  }

  const playerStatusMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/status$/);
  if (req.method === 'POST' && playerStatusMatch) {
    const denied = guard(P.PLAYERS_SANCTION);
    if (denied) return denied;
    const playerId = playerStatusMatch[1];
    const nextStatus = String(body.status || '');
    if (!['active', 'suspended', 'banned'].includes(nextStatus)) {
      return { status: 400, json: { error: 'INVALID_STATUS' } };
    }
    const reason = String(body.reason || '').trim().slice(0, 400);
    if (nextStatus !== 'active' && reason.length < 5) {
      return { status: 400, json: { error: 'REASON_REQUIRED', message: 'Укажите причину санкции (мин. 5 символов)' } };
    }
    const player = db.prepare('SELECT id, status, display_name FROM players WHERE id = ?').get(playerId);
    if (!player) return { status: 404, json: { error: 'PLAYER_NOT_FOUND' } };
    db.prepare('UPDATE players SET status = ?, ban_reason = ? WHERE id = ?').run(
      nextStatus,
      nextStatus === 'active' ? null : reason,
      playerId
    );
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: `player.status.${nextStatus}`,
      targetType: 'players',
      targetId: playerId,
      proposed: { previousStatus: player.status },
      applied: { status: nextStatus, reason },
      dataRefs: ['players'],
      ipHash,
    });
    publish('player', { playerId, status: nextStatus, by: principal.username });
    notify(db, {
      kind: 'player',
      severity: nextStatus === 'banned' ? 'warning' : 'info',
      title: `Санкция по игроку ${player.display_name || playerId}: ${nextStatus}`,
      body: reason,
      link: `#/players?player=${playerId}`,
    });
    return { status: 200, json: { ok: true, playerId, status: nextStatus } };
  }

  // =========================================================================
  // Support ticket detail & explicit status transition
  // =========================================================================
  const ticketDetailMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)$/);
  if (req.method === 'GET' && ticketDetailMatch) {
    const denied = guard(P.LIVEOPS_TICKETS);
    if (denied) return denied;
    const { getSupportTicketById } = require('../services/liveops');
    const ticket = getSupportTicketById(db, ticketDetailMatch[1]);
    if (!ticket) return { status: 404, json: { error: 'TICKET_NOT_FOUND' } };
    return { status: 200, json: ticket };
  }

  const ticketStatusMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)\/status$/);
  if (req.method === 'POST' && ticketStatusMatch) {
    const denied = guard(P.LIVEOPS_TICKETS);
    if (denied) return denied;
    const nextStatus = String(body.status || '');
    if (!['open', 'in_progress', 'answered', 'closed'].includes(nextStatus)) {
      return { status: 400, json: { error: 'INVALID_STATUS' } };
    }
    const prev = db.prepare('SELECT status FROM support_tickets WHERE id = ?').get(ticketStatusMatch[1]);
    if (!prev) return { status: 404, json: { error: 'TICKET_NOT_FOUND' } };
    const nowIso = new Date().toISOString();
    db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(nowIso, nowIso, ticketStatusMatch[1]);
    require('../services/liveops').recordTicketStatusEvent?.(db, {
      ticketId: ticketStatusMatch[1],
      fromStatus: prev.status,
      toStatus: nextStatus,
      actor: principal.username,
      note: String(body.note || '').slice(0, 200),
    });
    publish('ticket', { ticketId: ticketStatusMatch[1], status: nextStatus });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'support.ticket.status_changed',
      targetType: 'support_tickets',
      targetId: ticketStatusMatch[1],
      applied: { from: prev.status, to: nextStatus },
      ipHash,
    });
    return { status: 200, json: { ok: true, status: nextStatus } };
  }


  // -------------------------------------------------------------------------
  // Executive Overview & Morning Digest
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/overview') {
    const denied = guard(P.DASHBOARD_READ);
    if (denied) return denied;

    const zonesStatus = listAllZonesStatus(db);
    const summaries = {};
    for (const z of ['ops', 'fraud', 'balance', 'market', 'lab']) {
      const r = db
        .prepare('SELECT status, summary_json, created_at FROM zone_summaries WHERE zone = ? ORDER BY created_at DESC LIMIT 1')
        .get(z);
      summaries[z] = r ? JSON.parse(r.summary_json) : null;
    }
    const goldenSignals = computeGoldenSignals(db);
    const anomalies = evaluateBaselineAnomalies(db);
    const maintenance = getMaintenanceState(db);
    const proposals = db
      .prepare('SELECT * FROM action_proposals ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC LIMIT 20')
      .all()
      .map((p) => ({ ...p, payload: JSON.parse(p.payload_json || '{}') }));
    const openIncidents = listIncidents(db).filter((i) => i.status !== 'resolved');
    const openTicketsCount = Number(
      db.prepare("SELECT COUNT(*) AS cnt FROM support_tickets WHERE status IN ('open', 'in_progress')").get()?.cnt || 0
    );
    const readiness = runReadinessChecklist(db);

    return {
      status: 200,
      json: {
        region: CONFIG.primaryRegion,
        maintenance,
        goldenSignals,
        anomalies,
        zonesStatus,
        summaries,
        proposals,
        openIncidents,
        openTicketsCount,
        readinessSummary: {
          readyForLaunch: readiness.readyForLaunch,
          passedCount: readiness.passedCount,
          totalCount: readiness.totalCount,
          scorePct: readiness.scorePct,
        },
      },
    };
  }

  if (req.method === 'GET' && pathname === '/api/admin/digest/morning') {
    const denied = guard(P.DASHBOARD_READ);
    if (denied) return denied;
    return { status: 200, json: buildMorningDigest(db) };
  }

  // -------------------------------------------------------------------------
  // 5 Isolated Zone Dashboards (with periodDays filter) & Manual Trigger
  // -------------------------------------------------------------------------
  const periodDays = Number(urlObj.searchParams.get('periodDays') || 30);

  if (req.method === 'GET' && pathname === '/api/admin/zones/ops') {
    if (!hasPermission(principal.role, 'zones:read_all') && !hasPermission(principal.role, 'zone:ops:read')) {
      return { status: 403, json: { error: 'FORBIDDEN_ZONE_ISOLATION' } };
    }
    return { status: 200, json: computeOpsDashboard(db, { periodDays: Number(urlObj.searchParams.get('periodDays') || 7) }) };
  }

  if (req.method === 'GET' && pathname === '/api/admin/zones/fraud') {
    if (!hasPermission(principal.role, 'zones:read_all') && !hasPermission(principal.role, 'zone:fraud:read')) {
      return { status: 403, json: { error: 'FORBIDDEN_ZONE_ISOLATION' } };
    }
    return {
      status: 200,
      json: computeFraudDashboard(db, { statusFilter: urlObj.searchParams.get('status') || 'all' }),
    };
  }

  if (req.method === 'GET' && pathname === '/api/admin/zones/balance') {
    if (!hasPermission(principal.role, 'zones:read_all') && !hasPermission(principal.role, 'zone:balance:read')) {
      return { status: 403, json: { error: 'FORBIDDEN_ZONE_ISOLATION' } };
    }
    return { status: 200, json: computeBalanceDashboard(db, { periodDays }) };
  }

  if (req.method === 'GET' && pathname === '/api/admin/zones/market') {
    if (!hasPermission(principal.role, 'zones:read_all') && !hasPermission(principal.role, 'zone:market:read')) {
      return { status: 403, json: { error: 'FORBIDDEN_ZONE_ISOLATION' } };
    }
    return { status: 200, json: computeMarketDashboard(db, { periodDays }) };
  }

  if (req.method === 'GET' && pathname === '/api/admin/zones/lab') {
    if (!hasPermission(principal.role, 'zones:read_all') && !hasPermission(principal.role, 'zone:lab:read')) {
      return { status: 403, json: { error: 'FORBIDDEN_ZONE_ISOLATION' } };
    }
    return { status: 200, json: computeLabDashboard(db) };
  }

  const runZoneMatch = pathname.match(/^\/api\/admin\/zones\/(ops|fraud|balance|market|lab)\/run$/);
  if (req.method === 'POST' && runZoneMatch) {
    const zone = runZoneMatch[1];
    if (!canRunZone(principal.role, zone)) {
      return { status: 403, json: { error: 'FORBIDDEN_ZONE_RUN', zone, role: principal.role } };
    }
    const runners = {
      ops: runOpsZoneAnalysis,
      fraud: runFraudZoneAnalysis,
      balance: runBalanceZoneAnalysis,
      market: runMarketZoneAnalysis,
      lab: runLabZoneAnalysis,
    };
    const res = await runners[zone](db);
    const latestReq = db
      .prepare('SELECT provider, model, prompt_tokens, completion_tokens FROM ai_requests WHERE zone = ? ORDER BY created_at DESC LIMIT 1')
      .get(zone);

    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: `ai.zone.${zone}.manual_run`,
      targetType: 'zone_summaries',
      targetId: res.summaryId || zone,
      proposed: res.summary ? { status: res.summary.status, findingsCount: res.summary.findings?.length || 0 } : null,
      dataRefs: Array.from(ZONE_ALLOWED_TABLES[zone] || []),
      provider: latestReq?.provider || null,
      model: latestReq?.model || null,
      tokensUsed: latestReq ? Number(latestReq.prompt_tokens) + Number(latestReq.completion_tokens) : 0,
      ipHash,
    });
    publish('zone', {
      zone,
      status: res?.summary?.status || 'ok',
      findings: res?.summary?.findings?.length || 0,
      summaryId: res?.summaryId || null,
    });
    if (res?.summary?.status === 'critical') {
      notify(db, {
        kind: 'zone',
        severity: 'critical',
        title: `Зона ${zone.toUpperCase()}: критическая сводка`,
        body: res.summary.summary || 'Требуется решение владельца',
        link: `#/${zone}`,
        fingerprint: `zone_critical:${zone}:${res.summaryId || ''}`,
      });
    }
    return { status: 200, json: res };
  }

  // -------------------------------------------------------------------------
  // Lab Read-Only Benchmark Runner / Importer & A/B Experiment Creator
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/admin/lab/run-suite') {
    const denied = guard(P.ZONE_LAB_RUN);
    if (denied) return denied;
    const run = importOrRunLabSuite(db, {
      suite: body.suite || 'noise',
      branch: body.branch || 'arena/6529cdce-tabletennis',
      externalSummary: body.summary || null,
    });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'lab.suite.executed',
      targetType: 'lab_runs',
      targetId: run.id,
      applied: { suite: run.suite, status: run.status, durationMs: run.durationMs },
      ipHash,
    });
    return { status: 200, json: { ok: true, run } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/lab/experiments') {
    const denied = guard(P.LAB_EXPERIMENT);
    if (denied) return denied;
    const id = crypto.randomUUID();
    const slug = String(body.slug || `exp_${Date.now()}`).replace(/[^a-z0-9_-]/gi, '').slice(0, 48);
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO ab_experiments
       (id, slug, hypothesis, status, rules_patch_json, control_sessions, treatment_sessions, control_contact_rate, treatment_contact_rate, control_d1_pct, treatment_d1_pct, created_at)
       VALUES (?, ?, ?, 'running', ?, 0, 0, 0, 0, 0, 0, ?)`
    ).run(
      id,
      slug,
      String(body.hypothesis || 'Новая гипотеза баланса').slice(0, 400),
      JSON.stringify(body.rulesPatch || {}),
      nowIso
    );
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'lab.ab_experiment.created',
      targetType: 'ab_experiments',
      targetId: id,
      proposed: body.rulesPatch || {},
      ipHash,
    });
    return { status: 201, json: { ok: true, id, slug } };
  }

  // -------------------------------------------------------------------------
  // Balance: Human-Confirmed MATCH_RULES Publication (02-ai-zones.md, 08-implementation-plan.md)
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/admin/balance/rules') {
    const denied = guard(P.RULES_PUBLISH);
    if (denied) return denied;

    const currentRow = db
      .prepare('SELECT version, rules_json FROM match_rules_versions WHERE is_active = 1 ORDER BY version DESC LIMIT 1')
      .get();
    const currentRules = currentRow ? JSON.parse(currentRow.rules_json) : MATCH_RULES_V4;
    const patch = body.rulesPatch && typeof body.rulesPatch === 'object' ? body.rulesPatch : {};
    const sanitizedPatch = {};
    for (const [k, v] of Object.entries(patch)) {
      if (Object.prototype.hasOwnProperty.call(MATCH_RULES_V4, k) && k !== 'version') {
        if (typeof MATCH_RULES_V4[k] === 'boolean') {
          sanitizedPatch[k] = Boolean(v);
        } else {
          const num = Number(v);
          if (Number.isFinite(num) && num >= 0 && num <= 2000) {
            sanitizedPatch[k] = num;
          }
        }
      }
    }

    const maxVer = Number(db.prepare('SELECT COALESCE(MAX(version), 4) AS m FROM match_rules_versions').get()?.m || 4);
    const nextVersion = maxVer + 1;
    const nextRules = { ...MATCH_RULES_V4, ...currentRules, ...sanitizedPatch, version: nextVersion };
    const nowIso = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare('UPDATE match_rules_versions SET is_active = 0').run();
      db.prepare(
        `INSERT INTO match_rules_versions (version, rules_json, is_active, comment, created_by, created_at)
         VALUES (?, ?, 1, ?, ?, ?)`
      ).run(
        nextVersion,
        JSON.stringify(nextRules),
        String(body.comment || 'Ручное обновление MATCH_RULES владельцем').slice(0, 240),
        principal.username,
        nowIso
      );
    });
    tx();

    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'balance.match_rules.published',
      targetType: 'match_rules_versions',
      targetId: String(nextVersion),
      proposed: sanitizedPatch,
      applied: { prevVersion: currentRow?.version || 4, nextVersion, activeFields: Object.keys(nextRules).length },
      dataRefs: ['match_rules_versions', 'input_events'],
      ipHash,
    });

    return { status: 200, json: { ok: true, version: nextVersion, rules: nextRules } };
  }

  // -------------------------------------------------------------------------
  // Fraud: Human-Only Case Review & Explicit Sanction (Zero Auto-Bans!)
  // -------------------------------------------------------------------------
  const fraudReviewMatch = pathname.match(/^\/api\/admin\/fraud\/cases\/([^/]+)\/review$/);
  if (req.method === 'POST' && fraudReviewMatch) {
    const denied = guard(P.FRAUD_REVIEW);
    if (denied) return denied;

    const caseId = fraudReviewMatch[1];
    const existing = db.prepare('SELECT * FROM fraud_cases WHERE id = ?').get(caseId);
    if (!existing) return { status: 404, json: { error: 'CASE_NOT_FOUND' } };

    const verdict = body.verdict === 'confirmed_fraud' ? 'confirmed_fraud' : 'false_positive';
    const playerAction = ['none', 'suspend', 'ban'].includes(body.playerAction) ? body.playerAction : 'none';
    const reviewNote = String(body.note || '').slice(0, 500);
    const nowIso = new Date().toISOString();

    db.prepare(
      `UPDATE fraud_cases
       SET status = ?, reviewed_by = ?, review_note = ?, reviewed_at = ?
       WHERE id = ?`
    ).run(verdict, principal.username, reviewNote, nowIso, caseId);

    if (verdict === 'confirmed_fraud' && playerAction !== 'none' && existing.player_id) {
      const nextPlayerStatus = playerAction === 'ban' ? 'banned' : 'suspended';
      db.prepare(`UPDATE players SET status = ?, ban_reason = ? WHERE id = ?`).run(
        nextPlayerStatus,
        reviewNote || `Confirmed fraud case ${caseId}`,
        existing.player_id
      );
    }

    db.prepare(
      `INSERT INTO fraud_case_reviews (id, case_id, reviewer, verdict, player_action, note, risk_score_before, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      caseId,
      principal.username,
      verdict,
      playerAction,
      reviewNote,
      Number(existing.risk_score || 0),
      nowIso
    );

    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'fraud.case.human_reviewed',
      targetType: 'fraud_cases',
      targetId: caseId,
      proposed: { riskScore: existing.risk_score, caseType: existing.case_type },
      applied: { verdict, playerAction, reviewNote },
      dataRefs: ['fraud_cases', 'players'],
      ipHash,
    });

    publish('fraud', { caseId, verdict, playerAction, by: principal.username });
    notify(db, {
      kind: 'fraud',
      severity: verdict === 'confirmed_fraud' ? 'warning' : 'info',
      title: `Кейс ${caseId.slice(0, 8)} разобран: ${verdict === 'confirmed_fraud' ? 'подтверждён' : 'ложное срабатывание'}`,
      body: reviewNote || `Действие по игроку: ${playerAction}`,
      link: `#/fraud?case=${caseId}`,
    });
    return { status: 200, json: { ok: true, caseId, verdict, playerAction } };
  }

  // -------------------------------------------------------------------------
  // Closed 4-Step HITL Proposals Decision Loop across ALL 5 Zones (08-implementation-plan.md)
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/proposals') {
    const denied = guard(P.DASHBOARD_READ);
    if (denied) return denied;
    const list = parseListQuery(urlObj, {
      allowedSort: ['created_at', 'confidence', 'status', 'zone'],
      defaultSort: 'created_at',
      defaultOrder: 'desc',
    });
    const statusFilter = String(urlObj.searchParams.get('status') || 'all');
    const where = ['1=1'];
    const params = [];
    if (statusFilter !== 'all') {
      where.push('status = ?');
      params.push(statusFilter);
    }
    if (list.q) {
      where.push('(title LIKE ? OR rationale LIKE ? OR zone LIKE ?)');
      params.push(`%${list.q}%`, `%${list.q}%`, `%${list.q}%`);
    }
    const whereSql = `FROM action_proposals WHERE ${where.join(' AND ')}`;
    const total = countTotal(db, whereSql, params);
    const rows = db
      .prepare(
        `SELECT * ${whereSql}
         ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, ${list.sort} ${list.order.toUpperCase()}
         LIMIT ? OFFSET ?`
      )
      .all(...params, list.pageSize, list.offset)
      .map((r) => ({ ...r, payload: parseJsonColumn(r.payload_json, {}) }));
    return {
      status: 200,
      json: {
        proposals: rows,
        ...listResponse(rows, { ...list, total }),
        statusCounts: db
          .prepare('SELECT status, COUNT(*) AS c FROM action_proposals GROUP BY status')
          .all()
          .reduce((acc, r) => ({ ...acc, [r.status]: Number(r.c) }), {}),
      },
    };
  }

  const propMatch = pathname.match(/^\/api\/admin\/proposals\/([^/]+)\/decide$/);
  if (req.method === 'POST' && propMatch) {
    const denied = guard(P.HITL_DECIDE);
    if (denied) return denied;
    const propId = propMatch[1];
    const prop = db.prepare('SELECT * FROM action_proposals WHERE id = ?').get(propId);
    if (!prop) return { status: 404, json: { error: 'PROPOSAL_NOT_FOUND' } };

    const decision = body.decision === 'approved' ? 'approved' : 'rejected';
    const comment = String(body.comment || '').slice(0, 400);
    const nowIso = new Date().toISOString();
    const payload = JSON.parse(prop.payload_json || '{}');
    let appliedEffect = { decision };

    if (decision === 'approved') {
      if ((prop.action_type === 'propose_match_rules' || prop.action_type === 'promote_ab_winner') && payload.rulesPatch) {
        const curRow = db
          .prepare('SELECT version, rules_json FROM match_rules_versions WHERE is_active = 1 ORDER BY version DESC LIMIT 1')
          .get();
        const curRules = curRow ? JSON.parse(curRow.rules_json) : MATCH_RULES_V4;
        const maxVer = Number(db.prepare('SELECT COALESCE(MAX(version), 4) AS m FROM match_rules_versions').get()?.m || 4);
        const nextVer = maxVer + 1;
        const nextRules = { ...MATCH_RULES_V4, ...curRules, ...payload.rulesPatch, version: nextVer };
        db.prepare('UPDATE match_rules_versions SET is_active = 0').run();
        db.prepare(
          `INSERT INTO match_rules_versions (version, rules_json, is_active, comment, created_by, created_at)
           VALUES (?, ?, 1, ?, ?, ?)`
        ).run(nextVer, JSON.stringify(nextRules), `HITL Approved (${prop.zone}): ${prop.title}`, principal.username, nowIso);
        if (payload.experiment_id) {
          db.prepare(`UPDATE ab_experiments SET status = 'completed', winner = 'treatment', closed_at = ? WHERE id = ?`).run(
            nowIso,
            payload.experiment_id
          );
        }
        appliedEffect = { decision, publishedRulesVersion: nextVer, rulesPatch: payload.rulesPatch };
      } else if (prop.action_type === 'pause_negative_roas_campaign' && payload.campaign_id) {
        db.prepare(`UPDATE marketing_campaigns SET spend_usd = 0, updated_at = ? WHERE id = ?`).run(
          nowIso,
          payload.campaign_id
        );
        appliedEffect = { decision, pausedCampaignId: payload.campaign_id };
      } else if (prop.action_type === 'review_fraud_case' && payload.case_id) {
        db.prepare(
          `UPDATE fraud_cases SET status = 'confirmed_fraud', reviewed_by = ?, review_note = ?, reviewed_at = ? WHERE id = ?`
        ).run(principal.username, comment || 'Подтверждено через HITL', nowIso, payload.case_id);
        appliedEffect = { decision, reviewedFraudCaseId: payload.case_id };
      } else if (prop.action_type === 'ops_mitigation_alert' && payload.notifyBanner) {
        const push = createPushNotification(db, {
          priority: 'important',
          pinned: true,
          titleRu: '📡 Рекомендация по стабильности соединения',
          bodyRu: payload.notifyBanner,
          segment: payload.targetSegment || 'all',
          actorUsername: principal.username,
        });
        appliedEffect = { decision, sentPushId: push.id };
      }
    }

    const nextStatus = decision === 'approved' ? 'applied' : 'rejected';
    db.prepare(
      `UPDATE action_proposals
       SET status = ?, decided_by = ?, decision_comment = ?, decided_at = ?
       WHERE id = ?`
    ).run(nextStatus, principal.username, comment, nowIso, propId);

    const latestZoneCall = db
      .prepare('SELECT provider, model, prompt_tokens, completion_tokens FROM ai_requests WHERE zone = ? ORDER BY created_at DESC LIMIT 1')
      .get(prop.zone);

    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: `hitl.proposal.${nextStatus}`,
      targetType: 'action_proposals',
      targetId: propId,
      proposed: payload,
      applied: appliedEffect,
      dataRefs: [prop.zone, 'action_proposals'],
      provider: latestZoneCall?.provider || 'local_statistical',
      model: latestZoneCall?.model || null,
      tokensUsed: latestZoneCall ? Number(latestZoneCall.prompt_tokens) + Number(latestZoneCall.completion_tokens) : 0,
      ipHash,
    });

    publish('proposal', { id: propId, zone: prop.zone, title: prop.title, status: nextStatus });
    notify(db, {
      kind: 'proposal',
      severity: nextStatus === 'applied' ? 'warning' : 'info',
      title: `Решение HITL ${nextStatus === 'applied' ? 'применено' : 'отклонено'}: ${prop.title}`,
      body: `Зона ${prop.zone}. ${comment || JSON.stringify(appliedEffect).slice(0, 180)}`,
      link: '#/overview',
    });
    return { status: 200, json: { ok: true, id: propId, status: nextStatus, appliedEffect } };
  }

  // -------------------------------------------------------------------------
  // Players Directory, GDPR/152-ФЗ Export & Right-to-Erasure
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/players') {
    const denied = guard(P.PLAYERS_READ);
    if (denied) return denied;
    const q = String(urlObj.searchParams.get('q') || '').trim();
    const region = String(urlObj.searchParams.get('region') || '').trim();
    const status = String(urlObj.searchParams.get('status') || '').trim();

    const list = parseListQuery(urlObj, {
      allowedSort: ['last_seen_at', 'created_at', 'status', 'region', 'display_name'],
      defaultSort: 'last_seen_at',
      defaultOrder: 'desc',
    });
    const where = ['1=1'];
    const params = [];
    if (q) {
      where.push('(p.id LIKE ? OR p.display_name LIKE ? OR p.install_campaign LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (region && region !== 'all') {
      where.push('p.region = ?');
      params.push(region);
    }
    if (status && status !== 'all') {
      where.push('p.status = ?');
      params.push(status);
    }
    const whereSql = `FROM players p WHERE ${where.join(' AND ')}`;
    const total = countTotal(db, whereSql, params);
    const players = db
      .prepare(
        `SELECT p.id, p.display_name, p.region, p.install_source, p.install_campaign, p.status, p.ban_reason,
                p.created_at, p.last_seen_at,
                (SELECT COUNT(*) FROM sessions s WHERE s.player_id = p.id) AS sessions_count,
                COALESCE((SELECT ROUND(SUM(amount_usd), 2) FROM payments pay
                          WHERE pay.player_id = p.id AND pay.status = 'succeeded'), 0) AS total_iap_usd
         ${whereSql}
         ORDER BY p.${list.sort} ${list.order.toUpperCase()} LIMIT ? OFFSET ?`
      )
      .all(...params, list.pageSize, list.offset);
    const privacyRequests = db.prepare('SELECT * FROM privacy_requests ORDER BY requested_at DESC LIMIT 20').all();
    const statusCounts = db
      .prepare('SELECT status, COUNT(*) AS c FROM players GROUP BY status')
      .all()
      .reduce((acc, r) => ({ ...acc, [r.status]: Number(r.c) }), {});
    return {
      status: 200,
      json: {
        players,
        items: players,
        privacyRequests,
        statusCounts,
        ...listResponse(players, { ...list, total }),
      },
    };
  }

  const playerExportMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/export$/);
  if (req.method === 'GET' && playerExportMatch) {
    const denied = guard(P.PLAYERS_EXPORT);
    if (denied) return denied;
    const pkg = exportPlayerDataPackage(db, playerExportMatch[1]);
    if (!pkg) return { status: 404, json: { error: 'PLAYER_NOT_FOUND' } };
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'privacy.player_data.exported',
      targetType: 'players',
      targetId: playerExportMatch[1],
      dataRefs: ['players', 'player_consents', 'sessions', 'payments', 'support_tickets'],
      ipHash,
    });
    return { status: 200, json: pkg };
  }

  const playerEraseMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/erase$/);
  if (req.method === 'POST' && playerEraseMatch) {
    const denied = guard(P.PLAYERS_ERASE);
    if (denied) return denied;
    const res = executeRightToErasure(db, {
      playerId: playerEraseMatch[1],
      reason: body.reason || 'Запрос субъекта ПДн (152-ФЗ / GDPR Art. 17)',
      processedBy: principal.username,
    });
    if (!res) return { status: 404, json: { error: 'PLAYER_NOT_FOUND' } };
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'privacy.right_to_erasure.completed',
      targetType: 'players',
      targetId: playerEraseMatch[1],
      applied: res,
      dataRefs: ['players', 'sessions', 'input_events', 'payments', 'director-archive.sqlite'],
      ipHash,
    });
    publish('privacy', { playerId: playerEraseMatch[1], action: 'erasure' });
    return { status: 200, json: res };
  }

  // -------------------------------------------------------------------------
  // Director Chat (48–72h Sliding Window + Separate Archive DB + Priorities)
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/director/context') {
    const denied = guard(P.DIRECTOR_READ);
    if (denied) return denied;
    const timeRange = urlObj.searchParams.get('time_range') || 'last_72h';
    return { status: 200, json: getDirectorContext(db, timeRange) };
  }

  if (req.method === 'GET' && pathname === '/api/admin/director/archive') {
    const denied = guard(P.DIRECTOR_ARCHIVE);
    if (denied) return denied;
    return { status: 200, json: { archivedMessages: getArchivedDirectorChat(db, 60) } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/director/priorities') {
    const denied = guard(P.DIRECTOR_PRIORITIES);
    if (denied) return denied;
    const priorities = updateDirectorPriorities(db, body.priorities || []);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'director.priorities.updated',
      targetType: 'director_state',
      targetId: 'priorities',
      applied: { priorities },
      ipHash,
    });
    return { status: 200, json: { ok: true, priorities } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/director/ask') {
    const denied = guard(P.DIRECTOR_CHAT);
    if (denied) return denied;
    const res = await askDirector(db, {
      ownerId: principal.username,
      question: body.question,
      timeRange: body.time_range || body.timeRange || 'last_72h',
    });
    const latestDirReq = db
      .prepare("SELECT provider, model, prompt_tokens, completion_tokens FROM ai_requests WHERE zone = 'director' ORDER BY created_at DESC LIMIT 1")
      .get();
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'director.chat.asked',
      targetType: 'director_chat',
      targetId: res.messageId || 'quarantined',
      proposed: { questionLen: String(body.question || '').length, timeRange: body.time_range || 'last_72h' },
      applied: { ok: res.ok, quarantined: !!res.quarantined },
      dataRefs: Array.from(DIRECTOR_ALLOWED_TABLES),
      provider: latestDirReq?.provider || null,
      model: latestDirReq?.model || null,
      tokensUsed: latestDirReq ? Number(latestDirReq.prompt_tokens) + Number(latestDirReq.completion_tokens) : 0,
      ipHash,
    });
    return { status: res.status || (res.ok ? 200 : 422), json: res };
  }

  // -------------------------------------------------------------------------
  // AI Governance, Token Caps, Quarantine & Formal JSON Schema Contracts
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/ai/zones') {
    const denied = guard(P.GOVERNANCE_READ);
    if (denied) return denied;
    const quarantine = db.prepare('SELECT * FROM ai_quarantine ORDER BY created_at DESC LIMIT 25').all();
    return {
      status: 200,
      json: {
        zones: listAllZonesStatus(db),
        quarantine,
        isolationMatrix: {
          zones: Object.fromEntries(Object.entries(ZONE_ALLOWED_TABLES).map(([k, s]) => [k, Array.from(s)])),
          director: Array.from(DIRECTOR_ALLOWED_TABLES),
          rawPlayersBlockedEverywhere: true,
        },
        schemas: {
          zoneSummary: ZONE_SUMMARY_JSON_SCHEMA,
          directorResponse: DIRECTOR_RESPONSE_JSON_SCHEMA,
        },
      },
    };
  }

  const aiCfgMatch = pathname.match(/^\/api\/admin\/ai\/zones\/(ops|fraud|balance|market|lab|director)\/config$/);
  if (req.method === 'POST' && aiCfgMatch) {
    const denied = guard(P.AI_CONFIGURE);
    if (denied) return denied;
    const zone = aiCfgMatch[1];
    const updated = updateZoneConfig(db, zone, body);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: `ai.zone.${zone}.config_updated`,
      targetType: 'ai_zone_configs',
      targetId: zone,
      applied: {
        provider: updated.provider,
        fallbackProvider: updated.fallbackProvider,
        model: updated.model,
        dailyTokenLimit: updated.dailyTokenLimit,
        zeroRetention: updated.zeroRetention,
        batchMode: updated.batchMode,
        enabled: updated.enabled,
      },
      ipHash,
    });
    publish('ai_config', { zone, provider: updated.provider, model: updated.model });
    return { status: 200, json: { ok: true, config: { ...updated, apiKey: undefined } } };
  }

  // -------------------------------------------------------------------------
  // Observability, Incidents, Runbooks, Post-Mortems & Read-Only Telegram Bot
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/observability') {
    const denied = guard(P.OBSERVABILITY_READ);
    if (denied) return denied;
    return {
      status: 200,
      json: {
        goldenSignals: computeGoldenSignals(db),
        anomalies: evaluateBaselineAnomalies(db),
        incidents: listIncidents(db),
        runbooks: listRunbooks(),
        postmortems: listPostmortems(db),
        regionEndpoints: REGION_ENDPOINTS,
        pingThresholds: PING_THRESHOLDS,
        ...observabilityExtras(db),
      },
    };
  }

  const rbMatch = pathname.match(/^\/api\/admin\/runbooks\/([^/]+)$/);
  if (req.method === 'GET' && rbMatch) {
    const denied = guard(P.OBSERVABILITY_READ);
    if (denied) return denied;
    const rb = getRunbookBySlug(rbMatch[1]);
    if (!rb) return { status: 404, json: { error: 'RUNBOOK_NOT_FOUND' } };
    return { status: 200, json: rb };
  }

  if (req.method === 'POST' && pathname === '/api/admin/incidents') {
    const denied = guard(P.INCIDENTS_MANAGE);
    if (denied) return denied;
    const inc = createIncident(db, {
      severity: body.severity,
      zone: body.zone,
      title: body.title,
      description: body.description,
      runbookSlug: body.runbookSlug,
    });
    let tgPush = null;
    if (inc.severity === 'critical') {
      tgPush = await sendCriticalTelegramAlert(inc);
    }
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'observability.incident.created',
      targetType: 'incidents',
      targetId: inc.id,
      applied: { severity: inc.severity, zone: inc.zone, tgPush },
      ipHash,
    });
    notify(db, {
      kind: 'incident',
      severity: inc.severity,
      title: `Инцидент: ${inc.title}`,
      body: inc.description || '',
      link: '#/observability',
      fingerprint: `incident:${inc.id}`,
    });
    publish('incident', { id: inc.id, severity: inc.severity, zone: inc.zone, title: inc.title, status: inc.status });
    return { status: 201, json: { ok: true, incident: inc, telegramAlert: tgPush } };
  }

  const incStatusMatch = pathname.match(/^\/api\/admin\/incidents\/([^/]+)\/status$/);
  if (req.method === 'POST' && incStatusMatch) {
    const denied = guard(P.INCIDENTS_MANAGE);
    if (denied) return denied;
    const updated = updateIncidentStatus(db, incStatusMatch[1], {
      action: body.action,
      actorUsername: principal.username,
    });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: `observability.incident.${body.action}`,
      targetType: 'incidents',
      targetId: incStatusMatch[1],
      applied: { status: updated?.status },
      ipHash,
    });
    publish('incident', { id: incStatusMatch[1], status: updated?.status, action: body.action });
    return { status: 200, json: { ok: true, incident: updated } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/postmortems') {
    const denied = guard(P.POSTMORTEMS_CREATE);
    if (denied) return denied;
    const pm = createPostmortem(db, {
      incidentId: body.incidentId,
      summary: body.summary,
      timeline: body.timeline,
      rootCause: body.rootCause,
      impact: body.impact,
      fixApplied: body.fixApplied,
      actionItems: body.actionItems,
      createdBy: principal.username,
    });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'observability.postmortem.created',
      targetType: 'postmortems',
      targetId: pm.id,
      applied: { incidentId: body.incidentId },
      ipHash,
    });
    return { status: 201, json: { ok: true, postmortem: pm } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/telegram/command') {
    const denied = guard(P.BOT_READ);
    if (denied) return denied;
    return { status: 200, json: executeReadOnlyBotCommand(db, body.command) };
  }

  if (req.method === 'POST' && pathname === '/api/admin/telegram/callback') {
    const denied = guard(P.INCIDENTS_MANAGE);
    if (denied) return denied;
    const res = handleTelegramCallbackQuery(db, {
      callbackData: body.callbackData,
      operatorHandle: principal.username,
    });
    if (res.ok) {
      writeAuditLog(db, {
        actorRole: principal.role,
        actorId: principal.username,
        action: 'telegram.callback.incident_ack',
        targetType: 'incidents',
        targetId: res.incidentId,
        applied: { status: 'acknowledged' },
        ipHash,
      });
    }
    return { status: res.ok ? 200 : 400, json: res };
  }

  // -------------------------------------------------------------------------
  // Maintenance, Priority Push, Full News CRUD, Tickets, Feedback, Patches & Calendar
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/liveops') {
    const denied = guard(P.LIVEOPS_READ);
    if (denied) return denied;
    return {
      status: 200,
      json: {
        maintenance: getMaintenanceState(db),
        pushes: listPushNotifications(db),
        news: listNewsPosts(db),
        tickets: listSupportTickets(db, { status: urlObj.searchParams.get('ticketStatus') || 'all' }),
        feedback: listPlayerFeedback(db),
        patches: listPatchPipeline(db),
        calendar: listLiveopsCalendar(db),
        ticketSla: ticketSlaSummary(db),
      },
    };
  }

  if (req.method === 'POST' && pathname === '/api/admin/maintenance') {
    const denied = guard(P.LIVEOPS_MAINTENANCE);
    if (denied) return denied;
    const state = setMaintenanceState(db, {
      enabled: body.enabled,
      bannerRu: body.bannerRu,
      bannerEn: body.bannerEn,
      etaIso: body.etaIso,
      actorUsername: principal.username,
    });
    publish('maintenance', state);
    notify(db, {
      kind: 'maintenance',
      severity: state.enabled ? 'warning' : 'info',
      title: state.enabled ? 'Включён режим технических работ' : 'Технические работы завершены',
      body: state.bannerRu || '',
      link: '#/liveops',
    });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: `liveops.maintenance.${state.enabled ? 'enabled' : 'disabled'}`,
      targetType: 'system_settings',
      targetId: 'maintenance_mode',
      applied: state,
      ipHash,
    });
    return { status: 200, json: { ok: true, maintenance: state } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/pushes') {
    const denied = guard(P.LIVEOPS_PUSH);
    if (denied) return denied;
    const push = createPushNotification(db, {
      priority: body.priority,
      pinned: body.pinned,
      titleRu: body.titleRu,
      bodyRu: body.bodyRu,
      titleEn: body.titleEn,
      bodyEn: body.bodyEn,
      segment: body.segment,
      expiresAt: body.expiresAt,
      actorUsername: principal.username,
    });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'liveops.push.sent',
      targetType: 'push_notifications',
      targetId: push.id,
      applied: { priority: push.priority, pinned: push.pinned, segment: push.segment },
      ipHash,
    });
    publish('push', { id: push.id, priority: push.priority, title: push.title_ru });
    return { status: 201, json: { ok: true, push } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/news') {
    const denied = guard(P.LIVEOPS_NEWS);
    if (denied) return denied;
    const post = createNewsPost(db, {
      category: body.category,
      titleRu: body.titleRu,
      bodyRu: body.bodyRu,
      titleEn: body.titleEn,
      bodyEn: body.bodyEn,
      imageUrl: body.imageUrl,
      published: body.published !== false,
      actorUsername: principal.username,
    });
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'liveops.news.created',
      targetType: 'news_posts',
      targetId: post.id,
      applied: { category: post.category, titleRu: post.title_ru },
      ipHash,
    });
    publish('news', { id: post.id, category: post.category, title: post.title_ru, published: post.published });
    return { status: 201, json: { ok: true, post } };
  }

  const newsIdMatch = pathname.match(/^\/api\/admin\/news\/([^/]+)$/);
  if ((req.method === 'PUT' || req.method === 'PATCH') && newsIdMatch) {
    const denied = guard(P.LIVEOPS_NEWS);
    if (denied) return denied;
    const updated = updateNewsPost(db, newsIdMatch[1], body);
    if (!updated) return { status: 404, json: { error: 'NEWS_NOT_FOUND' } };
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'liveops.news.updated',
      targetType: 'news_posts',
      targetId: newsIdMatch[1],
      applied: { category: updated.category, titleRu: updated.title_ru, published: updated.published },
      ipHash,
    });
    return { status: 200, json: { ok: true, post: updated } };
  }

  if (req.method === 'DELETE' && newsIdMatch) {
    const denied = guard(P.LIVEOPS_NEWS);
    if (denied) return denied;
    deleteNewsPost(db, newsIdMatch[1]);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'liveops.news.deleted',
      targetType: 'news_posts',
      targetId: newsIdMatch[1],
      ipHash,
    });
    return { status: 200, json: { ok: true } };
  }

  const ticketReplyMatch = pathname.match(/^\/api\/admin\/tickets\/([^/]+)\/reply$/);
  if (req.method === 'POST' && ticketReplyMatch) {
    const denied = guard(P.LIVEOPS_TICKETS);
    if (denied) return denied;
    const updatedTicket = replyToSupportTicket(db, ticketReplyMatch[1], {
      adminUsername: principal.username,
      body: body.body,
      nextStatus: body.status || 'answered',
    });
    if (!updatedTicket) return { status: 404, json: { error: 'TICKET_NOT_FOUND' } };
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'support.ticket.replied',
      targetType: 'support_tickets',
      targetId: ticketReplyMatch[1],
      applied: { status: updatedTicket.status },
      ipHash,
    });
    publish('ticket', { ticketId: ticketReplyMatch[1], status: updatedTicket.status, replied: true });
    return { status: 200, json: { ok: true, ticket: updatedTicket } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/feedback') {
    const denied = guard(P.LIVEOPS_FEEDBACK);
    if (denied) return denied;
    const item = createOrUpdateFeedbackItem(db, body);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: body.id ? 'liveops.feedback.updated' : 'liveops.feedback.created',
      targetType: 'player_feedback',
      targetId: item?.id,
      applied: { stage: item?.stage, priorityScore: item?.priority_score },
      ipHash,
    });
    return { status: 200, json: { ok: true, item } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/patches') {
    const denied = guard(P.LIVEOPS_PATCHES);
    if (denied) return denied;
    const patch = createPatchRelease(db, body);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'liveops.patch.created',
      targetType: 'patch_pipeline',
      targetId: patch.id,
      applied: { version: patch.version, track: patch.track, status: patch.status },
      ipHash,
    });
    return { status: 201, json: { ok: true, patch } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/liveops/events') {
    const denied = guard(P.LIVEOPS_NEWS);
    if (denied) return denied;
    const ev = createLiveopsEvent(db, body);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'liveops.calendar.created',
      targetType: 'liveops_events',
      targetId: ev.id,
      applied: { title: ev.title, eventType: ev.event_type },
      ipHash,
    });
    return { status: 201, json: { ok: true, event: ev } };
  }

  // -------------------------------------------------------------------------
  // Legal Compliance, DPA Registry, Audit Logs & Launch Readiness / DR Backup
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/legal') {
    const denied = guard(P.LEGAL_READ);
    if (denied) return denied;
    const consentStats = db
      .prepare(
        `SELECT
           region,
           COUNT(*) AS consents_count,
           SUM(is_minor) AS minors_with_parental_consent,
           SUM(analytics_opt_in) AS analytics_opt_in_count,
           SUM(marketing_opt_in) AS marketing_opt_in_count
         FROM player_consents
         GROUP BY region`
      )
      .all();
    return {
      status: 200,
      json: {
        documents: listLegalDocuments(db),
        dpaRegistry: listProviderDpaRegistry(db),
        ageGateRules: AGE_GATE_RULES,
        cnIcpLicensed: CONFIG.cnIcpLicensed,
        consentStats,
        privacyRequests: db.prepare('SELECT * FROM privacy_requests ORDER BY requested_at DESC LIMIT 30').all(),
      },
    };
  }

  if (req.method === 'GET' && pathname === '/api/admin/audit') {
    const denied = guard(P.AUDIT_READ);
    if (denied) return denied;
    const format = urlObj.searchParams.get('format');
    const list = parseListQuery(urlObj, {
      allowedSort: ['created_at', 'id', 'tokens_used'],
      defaultSort: 'created_at',
      defaultOrder: 'desc',
    });
    const where = ['1=1'];
    const params = [];
    if (list.q) {
      where.push('(action LIKE ? OR actor_id LIKE ? OR target_id LIKE ? OR target_type LIKE ?)');
      params.push(`%${list.q}%`, `%${list.q}%`, `%${list.q}%`, `%${list.q}%`);
    }
    const actionFilter = String(urlObj.searchParams.get('action') || '').trim();
    if (actionFilter) {
      where.push('action LIKE ?');
      params.push(`${actionFilter}%`);
    }
    const actorFilter = String(urlObj.searchParams.get('actor') || '').trim();
    if (actorFilter) {
      where.push('actor_id = ?');
      params.push(actorFilter);
    }
    const whereSql = `FROM audit_logs WHERE ${where.join(' AND ')}`;
    const total = countTotal(db, whereSql, params);
    const logs = db
      .prepare(`SELECT * ${whereSql} ORDER BY ${list.sort} ${list.order.toUpperCase()} LIMIT ? OFFSET ?`)
      .all(...params, list.pageSize, list.offset);
    if (format === 'csv') {
      const allLogs = db.prepare(`SELECT * ${whereSql} ORDER BY id DESC LIMIT 5000`).all(...params);
      const csvColumns = [
        { key: 'id' }, { key: 'created_at' }, { key: 'region' }, { key: 'actor_role' }, { key: 'actor_id' },
        { key: 'action' }, { key: 'target_type' }, { key: 'target_id' }, { key: 'provider' }, { key: 'model' },
        { key: 'tokens_used' }, { key: 'entry_hash' },
      ];
      return csvResult(`topspin-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(csvColumns, allLogs));
    }
    return {
      status: 200,
      json: {
        logs,
        items: logs,
        actors: db.prepare('SELECT actor_id, actor_role, COUNT(*) AS c FROM audit_logs GROUP BY actor_id ORDER BY c DESC LIMIT 20').all(),
        chain: { algorithm: 'sha256', headHash: logs[0]?.entry_hash || null },
        ...listResponse(logs, { ...list, total }),
      },
    };
  }

  if (req.method === 'GET' && pathname === '/api/admin/system/readiness') {
    const denied = guard(P.SYSTEM_READ);
    if (denied) return denied;
    return { status: 200, json: runReadinessChecklist(db) };
  }

  if (req.method === 'POST' && pathname === '/api/admin/system/backup') {
    const denied = guard(P.SYSTEM_BACKUP);
    if (denied) return denied;
    const backup = triggerDisasterRecoveryBackup(db);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'system.dr_hot_backup.created',
      targetType: 'sqlite_backup',
      targetId: backup.createdAt,
      applied: backup,
      ipHash,
    });
    return { status: 200, json: backup };
  }

  if (req.method === 'POST' && pathname === '/api/admin/system/retention') {
    const denied = guard(P.SYSTEM_RETENTION);
    if (denied) return denied;
    const cleanup = runRetentionCleanup(db);
    writeAuditLog(db, {
      actorRole: principal.role,
      actorId: principal.username,
      action: 'system.retention_cleanup.executed',
      targetType: 'database',
      applied: cleanup,
      ipHash,
    });
    return { status: 200, json: { ok: true, cleanup } };
  }

  // Platform, governance, operator accounts and silences live in their own module.
  const platformResult = await handlePlatformRoutes({
    db,
    req,
    pathname,
    urlObj,
    body,
    clientIp,
    principal,
    ipHash,
    guard,
  });
  if (platformResult) return platformResult;

  return null;
}

module.exports = {
  handleAdminRoute,
};
