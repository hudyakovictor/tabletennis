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
  checkLoginAttemptLimit,
  recordFailedLoginAttempt,
  clearLoginAttempts,
} = require('../security/auth');
const { writeAuditLog, hashIdentifier } = require('../security/audit');
const { checkRateLimit } = require('../security/validator');
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

async function handleAdminRoute(db, req, pathname, urlObj, body, clientIp) {
  const ipHash = hashIdentifier(clientIp);
  const rl = checkRateLimit(`admin:${ipHash}`, CONFIG.rateLimits.adminApiPerMinute);
  if (!rl.allowed) {
    return { status: 429, json: { error: 'RATE_LIMITED', message: 'Превышен лимит запросов к API админки' } };
  }

  // -------------------------------------------------------------------------
  // Public Admin Auth Endpoints (with 5-attempt / 5-min brute-force limiter)
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

    const token = signToken({
      sub: row.id,
      username: row.username,
      role: row.role,
      displayName: row.display_name,
    });

    writeAuditLog(db, {
      actorRole: row.role,
      actorId: row.username,
      action: 'admin.login.success',
      targetType: 'admin_users',
      targetId: row.id,
      ipHash,
    });

    const isSecure = req.headers['x-forwarded-proto'] === 'https';
    return {
      status: 200,
      headers: { 'Set-Cookie': buildSessionCookie(token, isSecure) },
      json: {
        ok: true,
        token,
        user: {
          id: row.id,
          username: row.username,
          role: row.role,
          displayName: row.display_name,
        },
      },
    };
  }

  if (req.method === 'POST' && pathname === '/api/admin/auth/logout') {
    return {
      status: 200,
      headers: { 'Set-Cookie': clearSessionCookie() },
      json: { ok: true },
    };
  }

  // -------------------------------------------------------------------------
  // Require Authenticated RBAC Principal for all subsequent `/api/admin/*`
  // -------------------------------------------------------------------------
  const principal = authenticateAdminRequest(req);
  if (!principal) {
    return { status: 401, json: { error: 'UNAUTHORIZED', message: 'Требуется вход администратора' } };
  }

  // Reject any accidental player token attempting to call `/api/admin/*` (04-security.md)
  if (principal.role === ROLES.PLAYER) {
    return { status: 403, json: { error: 'FORBIDDEN_PLAYER_ROLE', message: 'Токен игрока не имеет доступа к CRM' } };
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
        },
      },
    };
  }

  const requireAdmin = () => {
    if (!hasPermission(principal.role, 'zones:read_all')) {
      return {
        status: 403,
        json: { error: 'FORBIDDEN_RBAC', message: `Роль ${principal.role} не имеет прав владельца/администратора` },
      };
    }
    return null;
  };

  // -------------------------------------------------------------------------
  // Executive Overview & Morning Digest
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/overview') {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
    if (denied) return denied;
    const zone = runZoneMatch[1];
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
    return { status: 200, json: res };
  }

  // -------------------------------------------------------------------------
  // Lab Read-Only Benchmark Runner / Importer & A/B Experiment Creator
  // -------------------------------------------------------------------------
  if (req.method === 'POST' && pathname === '/api/admin/lab/run-suite') {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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

    return { status: 200, json: { ok: true, caseId, verdict, playerAction } };
  }

  // -------------------------------------------------------------------------
  // Closed 4-Step HITL Proposals Decision Loop across ALL 5 Zones (08-implementation-plan.md)
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/proposals') {
    const denied = requireAdmin();
    if (denied) return denied;
    const rows = db
      .prepare('SELECT * FROM action_proposals ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, created_at DESC LIMIT 40')
      .all()
      .map((r) => ({ ...r, payload: JSON.parse(r.payload_json || '{}') }));
    return { status: 200, json: { proposals: rows } };
  }

  const propMatch = pathname.match(/^\/api\/admin\/proposals\/([^/]+)\/decide$/);
  if (req.method === 'POST' && propMatch) {
    const denied = requireAdmin();
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

    return { status: 200, json: { ok: true, id: propId, status: nextStatus, appliedEffect } };
  }

  // -------------------------------------------------------------------------
  // Players Directory, GDPR/152-ФЗ Export & Right-to-Erasure
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/players') {
    const denied = requireAdmin();
    if (denied) return denied;
    const q = String(urlObj.searchParams.get('q') || '').trim();
    const region = String(urlObj.searchParams.get('region') || '').trim();
    const status = String(urlObj.searchParams.get('status') || '').trim();

    let sql = `
      SELECT p.id, p.display_name, p.region, p.install_source, p.install_campaign, p.status, p.ban_reason, p.created_at, p.last_seen_at,
             COUNT(DISTINCT s.id) AS sessions_count,
             COALESCE(ROUND(SUM(CASE WHEN pay.status = 'succeeded' THEN pay.amount_usd ELSE 0 END), 2), 0) AS total_iap_usd
      FROM players p
      LEFT JOIN sessions s ON s.player_id = p.id
      LEFT JOIN payments pay ON pay.player_id = p.id
      WHERE 1=1
    `;
    const params = [];
    if (q) {
      sql += ' AND (p.id LIKE ? OR p.display_name LIKE ? OR p.install_campaign LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (region && region !== 'all') {
      sql += ' AND p.region = ?';
      params.push(region);
    }
    if (status && status !== 'all') {
      sql += ' AND p.status = ?';
      params.push(status);
    }
    sql += ' GROUP BY p.id ORDER BY p.last_seen_at DESC LIMIT 80';

    const players = db.prepare(sql).all(...params);
    const privacyRequests = db.prepare('SELECT * FROM privacy_requests ORDER BY requested_at DESC LIMIT 20').all();
    return { status: 200, json: { players, privacyRequests } };
  }

  const playerExportMatch = pathname.match(/^\/api\/admin\/players\/([^/]+)\/export$/);
  if (req.method === 'GET' && playerExportMatch) {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    return { status: 200, json: res };
  }

  // -------------------------------------------------------------------------
  // Director Chat (48–72h Sliding Window + Separate Archive DB + Priorities)
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/director/context') {
    const denied = requireAdmin();
    if (denied) return denied;
    const timeRange = urlObj.searchParams.get('time_range') || 'last_72h';
    return { status: 200, json: getDirectorContext(db, timeRange) };
  }

  if (req.method === 'GET' && pathname === '/api/admin/director/archive') {
    const denied = requireAdmin();
    if (denied) return denied;
    return { status: 200, json: { archivedMessages: getArchivedDirectorChat(db, 60) } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/director/priorities') {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    return { status: 200, json: { ok: true, config: { ...updated, apiKey: undefined } } };
  }

  // -------------------------------------------------------------------------
  // Observability, Incidents, Runbooks, Post-Mortems & Read-Only Telegram Bot
  // -------------------------------------------------------------------------
  if (req.method === 'GET' && pathname === '/api/admin/observability') {
    const denied = requireAdmin();
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
      },
    };
  }

  const rbMatch = pathname.match(/^\/api\/admin\/runbooks\/([^/]+)$/);
  if (req.method === 'GET' && rbMatch) {
    const denied = requireAdmin();
    if (denied) return denied;
    const rb = getRunbookBySlug(rbMatch[1]);
    if (!rb) return { status: 404, json: { error: 'RUNBOOK_NOT_FOUND' } };
    return { status: 200, json: rb };
  }

  if (req.method === 'POST' && pathname === '/api/admin/incidents') {
    const denied = requireAdmin();
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
    return { status: 201, json: { ok: true, incident: inc, telegramAlert: tgPush } };
  }

  const incStatusMatch = pathname.match(/^\/api\/admin\/incidents\/([^/]+)\/status$/);
  if (req.method === 'POST' && incStatusMatch) {
    const denied = requireAdmin();
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
    return { status: 200, json: { ok: true, incident: updated } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/postmortems') {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
    if (denied) return denied;
    return { status: 200, json: executeReadOnlyBotCommand(db, body.command) };
  }

  if (req.method === 'POST' && pathname === '/api/admin/telegram/callback') {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
      },
    };
  }

  if (req.method === 'POST' && pathname === '/api/admin/maintenance') {
    const denied = requireAdmin();
    if (denied) return denied;
    const state = setMaintenanceState(db, {
      enabled: body.enabled,
      bannerRu: body.bannerRu,
      bannerEn: body.bannerEn,
      etaIso: body.etaIso,
      actorUsername: principal.username,
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
    const denied = requireAdmin();
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
    return { status: 201, json: { ok: true, push } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/news') {
    const denied = requireAdmin();
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
    return { status: 201, json: { ok: true, post } };
  }

  const newsIdMatch = pathname.match(/^\/api\/admin\/news\/([^/]+)$/);
  if ((req.method === 'PUT' || req.method === 'PATCH') && newsIdMatch) {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    return { status: 200, json: { ok: true, ticket: updatedTicket } };
  }

  if (req.method === 'POST' && pathname === '/api/admin/feedback') {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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
    const denied = requireAdmin();
    if (denied) return denied;
    const format = urlObj.searchParams.get('format');
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all();
    if (format === 'csv') {
      const header = 'id,created_at,region,actor_role,actor_id,action,target_type,target_id,provider,model,tokens_used\n';
      const rows = logs
        .map((l) =>
          [
            l.id,
            l.created_at,
            l.region,
            l.actor_role,
            `"${String(l.actor_id || '').replace(/"/g, '""')}"`,
            l.action,
            l.target_type,
            l.target_id || '',
            l.provider || '',
            l.model || '',
            l.tokens_used || 0,
          ].join(',')
        )
        .join('\n');
      return {
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: { 'Content-Disposition': 'attachment; filename="topspin-audit-logs.csv"' },
        rawText: header + rows,
      };
    }
    return { status: 200, json: { logs } };
  }

  if (req.method === 'GET' && pathname === '/api/admin/system/readiness') {
    const denied = requireAdmin();
    if (denied) return denied;
    return { status: 200, json: runReadinessChecklist(db) };
  }

  if (req.method === 'POST' && pathname === '/api/admin/system/backup') {
    const denied = requireAdmin();
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
    const denied = requireAdmin();
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

  return null;
}

module.exports = {
  handleAdminRoute,
};
