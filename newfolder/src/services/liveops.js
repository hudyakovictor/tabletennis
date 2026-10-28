'use strict';

/**
 * LiveOps, Maintenance, Push, News (Full CRUD), Support Tickets (Screenshots + History + Burst + Escalation),
 * Player Feedback Loop, Patch Pipeline & Legal Compliance Service
 * (15-liveops-content-plan.md, 16-legal-player-agreements.md, 17-maintenance-push-news-support.md)
 */

const crypto = require('node:crypto');
const { CONFIG, AGE_GATE_RULES } = require('../config');
const { getArchiveDb } = require('../db/database');
const { evaluateAgeGate } = require('../security/validator');
const { sendCriticalTelegramAlert } = require('./telegramBot');

function getMaintenanceState(db) {
  const row = db.prepare("SELECT value_json, updated_at FROM system_settings WHERE key = 'maintenance_mode'").get();
  if (!row) {
    return {
      enabled: false,
      bannerRu: '',
      bannerEn: '',
      etaIso: null,
      allowActiveMatchesFinishGraceSec: 180,
      blockNewMatchesHttp503: true,
    };
  }
  return { ...JSON.parse(row.value_json), updatedAt: row.updated_at };
}

function setMaintenanceState(db, { enabled, bannerRu, bannerEn, etaIso, graceSec, actorUsername }) {
  const nowIso = new Date().toISOString();
  const prev = getMaintenanceState(db);
  const next = {
    enabled: Boolean(enabled),
    bannerRu:
      bannerRu ||
      (enabled
        ? 'Идут плановые технические работы. Текущие партии завершатся корректно, новые матчи временно недоступны.'
        : ''),
    bannerEn:
      bannerEn ||
      (enabled ? 'Scheduled maintenance is in progress. Active matches can finish; new matchmaking is paused.' : ''),
    etaIso: etaIso || null,
    allowActiveMatchesFinishGraceSec: Number.isFinite(Number(graceSec))
      ? Math.max(0, Math.min(1800, Number(graceSec)))
      : prev.allowActiveMatchesFinishGraceSec || 180,
    blockNewMatchesHttp503: Boolean(enabled),
  };

  db.prepare(
    `INSERT INTO system_settings (key, value_json, updated_by, updated_at)
     VALUES ('maintenance_mode', ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(JSON.stringify(next), actorUsername, nowIso);

  if (prev.enabled !== next.enabled) {
    createPushNotification(db, {
      priority: 'critical',
      pinned: next.enabled,
      titleRu: next.enabled ? '⚙️ Начались технические работы' : '✅ Серверы снова открыты!',
      bodyRu: next.enabled
        ? `${next.bannerRu}${next.etaIso ? ` Ориентировочное завершение: ${next.etaIso}` : ''}`
        : 'Технические работы завершены. Добро пожаловать обратно за стол TOPSPIN ARENA!',
      titleEn: next.enabled ? '⚙️ Maintenance Started' : '✅ Servers Are Back Online!',
      bodyEn: next.enabled ? next.bannerEn : 'Maintenance is complete. Welcome back to TOPSPIN ARENA!',
      segment: 'all',
      actorUsername,
    });
  }

  return next;
}

function createPushNotification(
  db,
  { priority = 'normal', pinned = false, titleRu, bodyRu, titleEn = '', bodyEn = '', segment = 'all', expiresAt = null, actorUsername }
) {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const validPriority = ['normal', 'important', 'critical'].includes(priority) ? priority : 'normal';
  db.prepare(
    `INSERT INTO push_notifications
     (id, priority, pinned, title_ru, body_ru, title_en, body_en, segment, sent_count, created_by, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    validPriority,
    pinned ? 1 : 0,
    String(titleRu || '').slice(0, 140),
    String(bodyRu || '').slice(0, 1000),
    String(titleEn || titleRu || '').slice(0, 140),
    String(bodyEn || bodyRu || '').slice(0, 1000),
    String(segment || 'all').slice(0, 64),
    db.prepare("SELECT COUNT(*) AS cnt FROM players WHERE status = 'active'").get()?.cnt || 0,
    actorUsername,
    nowIso,
    expiresAt
  );
  return db.prepare('SELECT * FROM push_notifications WHERE id = ?').get(id);
}

function listPushNotifications(db, { activeOnly = false } = {}) {
  if (activeOnly) {
    return db
      .prepare(
        `SELECT * FROM push_notifications
         WHERE expires_at IS NULL OR expires_at > datetime('now')
         ORDER BY pinned DESC, created_at DESC LIMIT 20`
      )
      .all();
  }
  return db.prepare('SELECT * FROM push_notifications ORDER BY pinned DESC, created_at DESC LIMIT 40').all();
}

// ============================================================================
// Full News CRUD: Create, Read, Update (PUT/PATCH), Delete (17-maintenance-push-news-support.md)
// ============================================================================
function createNewsPost(
  db,
  { category = 'update', titleRu, bodyRu, titleEn = '', bodyEn = '', imageUrl = null, published = true, actorUsername }
) {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const validCat = ['update', 'tournament', 'balance', 'maintenance', 'promo'].includes(category) ? category : 'update';
  db.prepare(
    `INSERT INTO news_posts
     (id, category, title_ru, body_ru, title_en, body_en, image_url, published, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    validCat,
    String(titleRu || '').slice(0, 160),
    String(bodyRu || '').slice(0, 4000),
    String(titleEn || titleRu || '').slice(0, 160),
    String(bodyEn || bodyRu || '').slice(0, 4000),
    imageUrl ? String(imageUrl).slice(0, 300) : null,
    published ? 1 : 0,
    actorUsername,
    nowIso,
    nowIso
  );
  return db.prepare('SELECT * FROM news_posts WHERE id = ?').get(id);
}

function updateNewsPost(db, newsId, patch) {
  const existing = db.prepare('SELECT * FROM news_posts WHERE id = ?').get(newsId);
  if (!existing) return null;
  const nowIso = new Date().toISOString();
  const validCat = ['update', 'tournament', 'balance', 'maintenance', 'promo'].includes(patch.category)
    ? patch.category
    : existing.category;
  const titleRu = patch.titleRu !== undefined ? String(patch.titleRu).slice(0, 160) : existing.title_ru;
  const bodyRu = patch.bodyRu !== undefined ? String(patch.bodyRu).slice(0, 4000) : existing.body_ru;
  const titleEn = patch.titleEn !== undefined ? String(patch.titleEn).slice(0, 160) : existing.title_en;
  const bodyEn = patch.bodyEn !== undefined ? String(patch.bodyEn).slice(0, 4000) : existing.body_en;
  const imageUrl =
    patch.imageUrl !== undefined ? (patch.imageUrl ? String(patch.imageUrl).slice(0, 300) : null) : existing.image_url;
  const published = patch.published !== undefined ? (patch.published ? 1 : 0) : existing.published;

  db.prepare(
    `UPDATE news_posts
     SET category = ?, title_ru = ?, body_ru = ?, title_en = ?, body_en = ?, image_url = ?, published = ?, updated_at = ?
     WHERE id = ?`
  ).run(validCat, titleRu, bodyRu, titleEn, bodyEn, imageUrl, published, nowIso, newsId);

  return db.prepare('SELECT * FROM news_posts WHERE id = ?').get(newsId);
}

function listNewsPosts(db, { publishedOnly = false } = {}) {
  if (publishedOnly) {
    return db.prepare('SELECT * FROM news_posts WHERE published = 1 ORDER BY created_at DESC LIMIT 30').all();
  }
  return db.prepare('SELECT * FROM news_posts ORDER BY created_at DESC LIMIT 50').all();
}

function deleteNewsPost(db, id) {
  return db.prepare('DELETE FROM news_posts WHERE id = ?').run(id);
}

// ============================================================================
// Support Tickets: Screenshots, Status History, Known-Issue Link, Burst -> Ops Alert, Critical -> Telegram
// ============================================================================
function recordTicketStatusEvent(db, { ticketId, fromStatus, toStatus, actor, note }) {
  db.prepare(
    `INSERT INTO support_ticket_events (id, ticket_id, from_status, to_status, actor, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    ticketId,
    fromStatus || null,
    toStatus,
    String(actor || 'system').slice(0, 64),
    note ? String(note).slice(0, 500) : null,
    new Date().toISOString()
  );
}

async function createSupportTicket(
  db,
  { playerId, region = CONFIG.primaryRegion, sessionId = null, category = 'bug', priority = null, subject, message, screenshotName = null, screenshotDataUrl = null, clientContext = {} }
) {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const validCat = ['bug', 'payment', 'cheater_report', 'account', 'privacy', 'feedback'].includes(category)
    ? category
    : 'bug';

  // Auto-prioritize payment/crash issues if not explicitly specified
  const computedPriority =
    priority && ['low', 'normal', 'high', 'critical'].includes(priority)
      ? priority
      : validCat === 'payment' || /краш|crash|черный экран|не зачисл/i.test(`${subject} ${message}`)
      ? 'critical'
      : 'normal';

  // Auto-link to open incident if category/keywords match (17-maintenance-push-news-support.md)
  const openInc = db
    .prepare(
      `SELECT id, title FROM incidents WHERE status != 'resolved' ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, created_at DESC LIMIT 1`
    )
    .get();
  const linkedIncidentId =
    openInc && (validCat === 'bug' || /лаг|пинг|краш|webgl|fps/i.test(`${subject} ${message}`)) ? openInc.id : null;

  let screenshotMeta = null;
  if (screenshotName || screenshotDataUrl) {
    const rawStr = String(screenshotDataUrl || '');
    screenshotMeta = JSON.stringify({
      name: String(screenshotName || 'screenshot.png').slice(0, 120),
      sizeChars: rawStr.length,
      previewDataUrl: rawStr.startsWith('data:image/') ? rawStr.slice(0, 32_000) : null,
    });
  }

  // SLA per priority (17-maintenance-push-news-support.md): critical 30m, high 2h, normal 8h, low 24h
  const SLA_MINUTES = { critical: 30, high: 120, normal: 480, low: 1440 };
  const slaDueAt = new Date(Date.now() + (SLA_MINUTES[computedPriority] || 480) * 60_000).toISOString();

  db.prepare(
    `INSERT INTO support_tickets
     (id, player_id, region, session_id, category, priority, subject, status, linked_incident_id,
      screenshot_meta_json, client_context_json, sla_due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    playerId,
    region,
    sessionId,
    validCat,
    computedPriority,
    String(subject || 'Обращение игрока').slice(0, 180),
    linkedIncidentId,
    screenshotMeta,
    JSON.stringify(clientContext || {}),
    slaDueAt,
    nowIso,
    nowIso
  );

  db.prepare(
    `INSERT INTO support_messages (id, ticket_id, sender_role, sender_name, body, attachment_name, created_at)
     VALUES (?, ?, 'player', 'Player', ?, ?, ?)`
  ).run(id + '_m1', id, String(message || '').slice(0, 3000), screenshotName ? String(screenshotName).slice(0, 120) : null, nowIso);

  recordTicketStatusEvent(db, {
    ticketId: id,
    fromStatus: null,
    toStatus: 'open',
    actor: playerId || 'player',
    note: linkedIncidentId ? `Автопривязка к известному инциденту ${linkedIncidentId.slice(0, 8)}` : 'Создан тикет игрока',
  });

  // Burst detector: >= 6 tickets in 15 minutes -> raise Ops Warning incident (17-maintenance-push-news-support.md)
  const burstRow = db
    .prepare(`SELECT COUNT(*) AS cnt FROM support_tickets WHERE created_at >= datetime('now', '-15 minutes')`)
    .get();
  if (Number(burstRow?.cnt || 0) >= 6) {
    const existingBurstInc = db
      .prepare(`SELECT id FROM incidents WHERE title LIKE 'Всплеск обращений в поддержку%' AND status != 'resolved'`)
      .get();
    if (!existingBurstInc) {
      db.prepare(
        `INSERT INTO incidents (id, severity, zone, title, description, runbook_slug, status, created_at)
         VALUES (?, 'warning', 'ops', ?, ?, 'rb-support-ticket-storm', 'open', ?)`
      ).run(
        crypto.randomUUID(),
        `Всплеск обращений в поддержку (${burstRow.cnt} за 15 мин)`,
        'Автоматический сигнал из модуля Support: массовые тикеты игроков за короткое окно.',
        nowIso
      );
    }
  }

  // Critical ticket -> escalate to Telegram Ops Bot immediately
  if (computedPriority === 'critical') {
    await sendCriticalTelegramAlert({
      id,
      zone: 'ops',
      title: `Критичный тикет поддержки (${validCat}): ${String(subject || '').slice(0, 80)}`,
      description: String(message || '').slice(0, 240),
      runbook_slug: 'rb-support-ticket-storm',
    });
  }

  return getSupportTicketById(db, id);
}

function getSupportTicketById(db, ticketId) {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(ticketId);
  if (!ticket) return null;
  const messages = db
    .prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC')
    .all(ticketId);
  const statusHistory = db
    .prepare('SELECT * FROM support_ticket_events WHERE ticket_id = ? ORDER BY created_at ASC')
    .all(ticketId);
  return {
    ...ticket,
    screenshotMeta: ticket.screenshot_meta_json ? JSON.parse(ticket.screenshot_meta_json) : null,
    clientContext: JSON.parse(ticket.client_context_json || '{}'),
    messages,
    statusHistory,
  };
}

function listSupportTickets(db, { status = null, playerId = null } = {}) {
  let sql = `
    SELECT t.*, p.display_name, p.region AS player_region
    FROM support_tickets t
    LEFT JOIN players p ON p.id = t.player_id
    WHERE 1=1
  `;
  const params = [];
  if (status && status !== 'all') {
    sql += ' AND t.status = ?';
    params.push(status);
  }
  if (playerId) {
    sql += ' AND t.player_id = ?';
    params.push(playerId);
  }
  sql += ` ORDER BY
    CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'answered' THEN 2 ELSE 3 END ASC,
    CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END ASC,
    t.updated_at DESC LIMIT 60`;

  return db
    .prepare(sql)
    .all(...params)
    .map((t) => ({
      ...t,
      screenshotMeta: t.screenshot_meta_json ? JSON.parse(t.screenshot_meta_json) : null,
      clientContext: JSON.parse(t.client_context_json || '{}'),
      messages: db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(t.id),
      statusHistory: db
        .prepare('SELECT * FROM support_ticket_events WHERE ticket_id = ? ORDER BY created_at ASC')
        .all(t.id),
    }));
}

function replyToSupportTicket(db, ticketId, { adminUsername, body, nextStatus = 'answered' }) {
  const prev = db.prepare('SELECT status FROM support_tickets WHERE id = ?').get(ticketId);
  if (!prev) return null;
  const nowIso = new Date().toISOString();
  const validStatus = ['open', 'in_progress', 'answered', 'closed'].includes(nextStatus) ? nextStatus : 'answered';
  if (body && String(body).trim()) {
    db.prepare(
      `INSERT INTO support_messages (id, ticket_id, sender_role, sender_name, body, created_at)
       VALUES (?, ?, 'admin', ?, ?, ?)`
    ).run(crypto.randomUUID(), ticketId, adminUsername, String(body).slice(0, 3000), nowIso);
  }
  // First human response seals the SLA clock exactly once (replies never overwrite it).
  db.prepare(
    `UPDATE support_tickets
     SET status = ?, updated_at = ?,
         first_response_at = COALESCE(first_response_at, ?),
         first_response_minutes = COALESCE(
           first_response_minutes,
           CAST((julianday(?) - julianday(created_at)) * 24 * 60 AS INTEGER)
         )
     WHERE id = ?`
  ).run(validStatus, nowIso, nowIso, nowIso, ticketId);
  if (prev.status !== validStatus) {
    recordTicketStatusEvent(db, {
      ticketId,
      fromStatus: prev.status,
      toStatus: validStatus,
      actor: adminUsername,
      note: body ? String(body).slice(0, 120) : `Статус изменён на ${validStatus}`,
    });
  }
  return getSupportTicketById(db, ticketId);
}

// ============================================================================
// Player Feedback Loop (collect -> sort -> prioritize -> respond) & Patch Pipeline (15-liveops-content-plan.md)
// ============================================================================
function listPlayerFeedback(db) {
  return db
    .prepare('SELECT * FROM player_feedback ORDER BY priority_score DESC, votes DESC, updated_at DESC LIMIT 50')
    .all();
}

function createOrUpdateFeedbackItem(db, { id = null, source = 'crm', category = 'controls', summary, votes = 1, priorityScore = 50, stage = 'collected', publicResponse = null, targetPatchVersion = null }) {
  const nowIso = new Date().toISOString();
  const validStage = ['collected', 'sorted', 'prioritized', 'responded'].includes(stage) ? stage : 'collected';
  if (id) {
    const existing = db.prepare('SELECT * FROM player_feedback WHERE id = ?').get(id);
    if (!existing) return null;
    db.prepare(
      `UPDATE player_feedback
       SET category = ?, summary = ?, votes = ?, priority_score = ?, stage = ?, public_response = ?, target_patch_version = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      category || existing.category,
      summary !== undefined ? String(summary).slice(0, 400) : existing.summary,
      votes !== undefined ? Number(votes) : existing.votes,
      priorityScore !== undefined ? Number(priorityScore) : existing.priority_score,
      validStage,
      publicResponse !== undefined ? publicResponse : existing.public_response,
      targetPatchVersion !== undefined ? targetPatchVersion : existing.target_patch_version,
      nowIso,
      id
    );
    return db.prepare('SELECT * FROM player_feedback WHERE id = ?').get(id);
  }
  const newId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO player_feedback (id, source, category, summary, votes, priority_score, stage, public_response, target_patch_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId,
    String(source).slice(0, 32),
    String(category).slice(0, 32),
    String(summary || '').slice(0, 400),
    Number(votes || 1),
    Number(priorityScore || 50),
    validStage,
    publicResponse,
    targetPatchVersion,
    nowIso,
    nowIso
  );
  return db.prepare('SELECT * FROM player_feedback WHERE id = ?').get(newId);
}

function listPatchPipeline(db) {
  return db.prepare('SELECT * FROM patch_pipeline ORDER BY created_at DESC LIMIT 30').all();
}

function createPatchRelease(db, { version, track = 'biweekly_update', status = 'qa', changelogRu, changelogEn = '', targetDate }) {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const validTrack = ['day1_hotfix', 'week1_patch', 'biweekly_update', 'beta_branch'].includes(track)
    ? track
    : 'biweekly_update';
  const validStatus = ['planned', 'qa', 'staged', 'deployed', 'rolled_back'].includes(status) ? status : 'qa';
  db.prepare(
    `INSERT INTO patch_pipeline (id, version, track, status, changelog_ru, changelog_en, target_date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(version).slice(0, 32),
    validTrack,
    validStatus,
    String(changelogRu || '').slice(0, 2000),
    String(changelogEn || changelogRu || '').slice(0, 2000),
    String(targetDate || nowIso.slice(0, 10)),
    nowIso
  );
  return db.prepare('SELECT * FROM patch_pipeline WHERE id = ?').get(id);
}

// ============================================================================
// Legal Documents (ToS, Privacy, EULA, Cookie Policy RU/EN), Regional Age Gate, DPA & 30d Erasure
// ============================================================================
function listLegalDocuments(db) {
  return db
    .prepare(
      'SELECT id, doc_type, version, lang, title, content_md, requires_reconsent, published_at FROM legal_documents ORDER BY doc_type, lang'
    )
    .all();
}

function listProviderDpaRegistry(db) {
  return db.prepare('SELECT * FROM provider_dpa_registry ORDER BY provider ASC').all();
}

function recordPlayerConsent(
  db,
  { playerId, region = CONFIG.primaryRegion, docType, docVersion, declaredAge = 18, parentalConsent = false, analyticsOptIn = false, marketingOptIn = false, ipHash = null }
) {
  const ageCheck = evaluateAgeGate(region, declaredAge, parentalConsent);
  if (!ageCheck.valid) {
    return {
      ok: false,
      code: 'PARENTAL_CONSENT_REQUIRED',
      minAge: ageCheck.minAge,
      law: ageCheck.law,
      error: `Для региона ${region} (${ageCheck.law}) игрокам младше ${ageCheck.minAge} лет требуется подтверждённое согласие родителя/опекуна.`,
    };
  }

  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO player_consents
     (id, player_id, region, doc_type, doc_version, declared_age, is_minor, parental_consent, analytics_opt_in, marketing_opt_in, ip_hash, consented_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    playerId,
    region,
    docType,
    docVersion,
    Math.round(Number(declaredAge)),
    ageCheck.isMinor ? 1 : 0,
    parentalConsent ? 1 : 0,
    analyticsOptIn ? 1 : 0,
    marketingOptIn ? 1 : 0,
    ipHash,
    nowIso
  );
  return { ok: true, id, consentedAt: nowIso, ageGate: ageCheck };
}

function exportPlayerDataPackage(db, playerId) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return null;
  const consents = db.prepare('SELECT * FROM player_consents WHERE player_id = ?').all(playerId);
  const sessions = db.prepare('SELECT * FROM sessions WHERE player_id = ? ORDER BY started_at DESC LIMIT 100').all(playerId);
  const payments = db
    .prepare('SELECT id, amount_usd, currency, item_sku, status, created_at FROM payments WHERE player_id = ?')
    .all(playerId);
  const tickets = listSupportTickets(db, { playerId });

  return {
    exportedAt: new Date().toISOString(),
    slaCompliance: '152-ФЗ / GDPR Art. 15 Right of Access',
    player,
    consents,
    sessions,
    payments,
    supportTickets: tickets,
  };
}

/**
 * Full Right-to-Erasure (`<=30d` SLA, executed immediately on admin confirmation)
 * Scrubs PII across active SQLite AND `director-archive.sqlite` while preserving anonymized financial records!
 */
function executeRightToErasure(db, { playerId, reason = 'GDPR / 152-ФЗ erasure request', processedBy, recordRequest = true, dueAt = null }) {
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return null;

  const nowIso = new Date().toISOString();
  const reqId = crypto.randomUUID();
  const archDb = getArchiveDb(db);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM player_consents WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM support_messages WHERE ticket_id IN (SELECT id FROM support_tickets WHERE player_id = ?)').run(playerId);
    db.prepare('DELETE FROM support_ticket_events WHERE ticket_id IN (SELECT id FROM support_tickets WHERE player_id = ?)').run(playerId);
    db.prepare('DELETE FROM support_tickets WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM input_events WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM sessions WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM ad_events WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM economy_ledger WHERE player_id = ?').run(playerId);
    db.prepare('DELETE FROM fraud_cases WHERE player_id = ?').run(playerId);

    // Anonymize tax-obligated payment rows (06-data-schema.md & 16-legal-player-agreements.md)
    db.prepare('UPDATE payments SET player_id = NULL WHERE player_id = ?').run(playerId);

    // Scrub any accidental mention in active director_chat
    if (player.display_name) {
      db.prepare(`UPDATE director_chat SET content = REPLACE(content, ?, '[ERASED_PLAYER]') WHERE content LIKE ?`).run(
        player.display_name,
        `%${player.display_name}%`
      );
    }

    db.prepare(
      `UPDATE players
       SET external_id_hash = NULL,
           display_name = '[ERASED]',
           status = 'deleted',
           ban_reason = NULL,
           deleted_at = ?
       WHERE id = ?`
    ).run(nowIso, playerId);

    // `recordRequest: false` is used when the erasure fulfils an existing DSAR row:
    // writing a second "completed erasure" would duplicate the subject's history.
    if (recordRequest) {
      db.prepare(
        `INSERT INTO privacy_requests
           (id, player_id, region, request_type, status, reason, requested_at, due_at, completed_at, processed_by, source, updated_at)
         VALUES (?, ?, ?, 'erasure', 'completed', ?, ?, ?, ?, ?, 'operator', ?)`
      ).run(
        reqId,
        playerId,
        player.region || CONFIG.primaryRegion,
        reason,
        nowIso,
        dueAt || nowIso,
        nowIso,
        processedBy,
        nowIso
      );
    }
  });

  tx();

  // Also scrub separate Archive DB (`director-archive.sqlite`)
  if (player.display_name) {
    archDb
      .prepare(`UPDATE archived_director_chat SET content = REPLACE(content, ?, '[ERASED_PLAYER]') WHERE content LIKE ?`)
      .run(player.display_name, `%${player.display_name}%`);
  }

  return {
    requestId: reqId,
    playerId,
    region: player.region,
    status: 'completed',
    completedAt: nowIso,
    anonymizedPaymentsPreserved: true,
    archiveDbScrubbed: true,
  };
}

function listLiveopsCalendar(db) {
  return db.prepare('SELECT * FROM liveops_events ORDER BY starts_at ASC').all();
}

function createLiveopsEvent(db, { title, eventType, startsAt, endsAt, configObj = {}, status = 'scheduled' }) {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO liveops_events (id, title, event_type, starts_at, ends_at, config_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(title || '').slice(0, 140),
    ['season', 'tournament', 'holiday', 'patch', 'quest'].includes(eventType) ? eventType : 'tournament',
    startsAt,
    endsAt,
    JSON.stringify(configObj),
    status,
    nowIso
  );
  return db.prepare('SELECT * FROM liveops_events WHERE id = ?').get(id);
}

module.exports = {
  AGE_GATE_RULES,
  getMaintenanceState,
  setMaintenanceState,
  createPushNotification,
  listPushNotifications,
  createNewsPost,
  updateNewsPost,
  listNewsPosts,
  deleteNewsPost,
  createSupportTicket,
  getSupportTicketById,
  listSupportTickets,
  replyToSupportTicket,
  recordTicketStatusEvent,
  listPlayerFeedback,
  createOrUpdateFeedbackItem,
  listPatchPipeline,
  createPatchRelease,
  listLegalDocuments,
  listProviderDpaRegistry,
  recordPlayerConsent,
  exportPlayerDataPackage,
  executeRightToErasure,
  listLiveopsCalendar,
  createLiveopsEvent,
};
