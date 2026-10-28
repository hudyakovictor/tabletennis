'use strict';

/**
 * Game Client API (`/api/client/v1/*`) — Zero AI Exposure, TMA Low-Latency & Session Affinity
 * (01-architecture.md, 04-security.md, 09-api-contracts.md, 13-telegram-miniapp-latency.md, 16-legal, 17-maintenance)
 *
 * Strict Guarantee:
 * - Responses contain ZERO mentions of AI, LLMs, zone summaries, prompts, or provider keys.
 * - Enforces regional residency (CN ICP block), regional age gate (US:13 / EU:16 / RU:14),
 *   6-point physics/swipe/frequency telemetry validation, and TMA session affinity on reconnect.
 */

const crypto = require('node:crypto');
const { CONFIG, MATCH_RULES_V4, PING_THRESHOLDS } = require('../config');
const {
  signPlayerToken,
  authenticatePlayerRequest,
  signSessionAffinityToken,
  verifySessionAffinityToken,
  hashIdentifier,
} = require('../security/auth');
const {
  checkRateLimit,
  resolveDataResidency,
  verifyTelegramInitData,
  validateInputTelemetryBatch,
} = require('../security/validator');
const {
  getMaintenanceState,
  listPushNotifications,
  listNewsPosts,
  listLegalDocuments,
  recordPlayerConsent,
  createSupportTicket,
  getSupportTicketById,
  listSupportTickets,
} = require('../services/liveops');
const { publish } = require('../services/eventBus');
const { notify } = require('../services/notifications');
const { createPrivacyRequest } = require('../services/privacy');
const { lookup: idemLookup, save: idemSave, hashRequest } = require('../services/idempotency');

function getActiveClientRules(db) {
  const row = db
    .prepare('SELECT version, rules_json FROM match_rules_versions WHERE is_active = 1 ORDER BY version DESC LIMIT 1')
    .get();
  return row ? JSON.parse(row.rules_json) : MATCH_RULES_V4;
}

function deterministicAbAssignment(playerId, db) {
  const exp = db
    .prepare("SELECT slug, rules_patch_json FROM ab_experiments WHERE status = 'running' ORDER BY created_at DESC LIMIT 1")
    .get();
  if (!exp || !playerId) return { variant: 'control', patch: {} };
  const hashByte = crypto.createHash('sha256').update(`${playerId}:${exp.slug}`).digest()[0];
  const isTreatment = hashByte % 2 === 1;
  return {
    experimentSlug: exp.slug,
    variant: isTreatment ? `${exp.slug}_treatment` : `${exp.slug}_control`,
    patch: isTreatment ? JSON.parse(exp.rules_patch_json || '{}') : {},
  };
}

/* ---------------------------------------------------------------------------
 * Game progress (19-client-integration-guide.md §3.12)
 *
 * Правило доверия: клиент присылает факты — уровень, длительность, счёт, — а
 * не результат («я выиграл, дай 500 монет»). Сервер проверяет правдоподобие,
 * сам считает рейтинг по Эло и сам начисляет награду за уровень. Полный
 * реплей-контроль — следующий этап; здесь лимиты, монотонность и потолки.
 * ------------------------------------------------------------------------- */
const PROGRESS_LIMITS = Object.freeze({
  maxLevel: 99,
  minLevelMs: 15_000, // уровень короче 15 с физически невозможен
  minLevelMsPerLevel: 1_500, // порог растёт со ступенькой: 15 с + 1.5 с × level
  maxXpPerLevel: 10_000,
  maxLevelJump: 5, // оффлайн-очередь может принести пачку, но не «1 → 60»
  maxBestRally: 200,
  minMatchMs: 25_000, // матч до 11 очков быстрее 25 с не разыгрывается (11:0 за ~30 с — норма)
  maxMatchMs: 3 * 3600_000,
  maxScore: 99,
  eloK: 32,
  maxRatingDelta: 64,
  coinsPerLevel: 150, // те же числа, что показывает LevelUp в клиенте
  gemsPerLevel: 20,
});

function asInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function progressJson(row) {
  return {
    level: row.level,
    xp: row.xp,
    rating: row.rating,
    matches: row.matches,
    wins: row.wins,
    losses: row.losses,
    streak: row.streak,
    bestRally: row.best_rally,
    coins: row.coins,
    gems: row.gems,
    updatedAt: row.updated_at,
  };
}

function readProgress(db, playerId) {
  return db.prepare('SELECT * FROM player_progress WHERE player_id = ?').get(playerId) || null;
}

/* Прогресс создаётся лениво: игрок, вошедший до появления таблицы, получает
 * дефолтную строку при первом чтении, а не 404. */
function ensureProgress(db, playerId) {
  const existing = readProgress(db, playerId);
  if (existing) return existing;
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO player_progress (player_id, created_at, updated_at) VALUES (?, ?, ?)')
    .run(playerId, now, now);
  return readProgress(db, playerId);
}

function eloDelta(rating, opponentRating, win) {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  const raw = Math.round(PROGRESS_LIMITS.eloK * ((win ? 1 : 0) - expected));
  return Math.max(-PROGRESS_LIMITS.maxRatingDelta, Math.min(PROGRESS_LIMITS.maxRatingDelta, raw));
}

async function handleClientRoute(db, req, pathname, urlObj, body, clientIp) {
  const ipHash = hashIdentifier(clientIp);
  const residency = resolveDataResidency(req, body?.countryCode || urlObj.searchParams.get('country'));

  // Enforce CN PIPL block when ICP license is absent (05-legal-rf-sanctions.md)
  if (residency.blocked) {
    return {
      status: 451,
      json: {
        error: 'REGION_UNAVAILABLE_LEGAL',
        region: residency.countryCode,
        reason: residency.blockReason,
      },
    };
  }

  // Ultra-lightweight RTT probe (`GET /api/client/v1/ping`) for TMA `<35ms / 35-65ms / >100ms` measurement
  if (req.method === 'GET' && pathname === '/api/client/v1/ping') {
    const clientSentTs = Number(urlObj.searchParams.get('t') || 0);
    return {
      status: 200,
      json: {
        pong: true,
        clientSentTs,
        serverTs: Date.now(),
        region: residency.region,
        nodeId: residency.recommendedEndpoint.nodeId,
        warnThresholdMs: PING_THRESHOLDS.warnClientThresholdMs,
      },
    };
  }

  // Client Bootstrap Config (`GET /api/client/v1/bootstrap`)
  if (req.method === 'GET' && pathname === '/api/client/v1/bootstrap') {
    const playerAuth = authenticatePlayerRequest(req);
    const baseRules = getActiveClientRules(db);
    const ab = deterministicAbAssignment(playerAuth?.sub || null, db);
    const effectiveRules = { ...baseRules, ...ab.patch };
    const maintenance = getMaintenanceState(db);
    const pushes = listPushNotifications(db, { activeOnly: true });
    const news = listNewsPosts(db, { publishedOnly: true }).slice(0, 10);
    const legalDocs = listLegalDocuments(db).map((d) => ({
      docType: d.doc_type,
      version: d.version,
      lang: d.lang,
      title: d.title,
    }));

    return {
      status: 200,
      json: {
        serverTimeUtc: new Date().toISOString(),
        region: residency.region,
        recommendedEndpoint: residency.recommendedEndpoint,
        wsEndpoint: '/ws/client',
        pingThresholds: PING_THRESHOLDS,
        ageGate: residency.ageGate,
        maintenance,
        matchRules: effectiveRules,
        abVariant: ab.variant,
        notifications: pushes,
        news,
        legalDocuments: legalDocs,
      },
    };
  }

  // Telegram Mini App Auth (`POST /api/client/v1/auth/telegram`)
  if (req.method === 'POST' && pathname === '/api/client/v1/auth/telegram') {
    const rl = checkRateLimit(`tma_auth:${ipHash}`, 30);
    if (!rl.allowed) return { status: 429, json: { error: 'RATE_LIMITED' } };

    const tgCheck = verifyTelegramInitData(body.initData || '');
    if (!tgCheck.valid) {
      return { status: 401, json: { error: 'INVALID_TELEGRAM_INIT_DATA', message: tgCheck.error } };
    }

    const extHash = hashIdentifier(`tg_${tgCheck.telegramId}`);
    let player = db.prepare('SELECT * FROM players WHERE external_id_hash = ?').get(extHash);
    const nowIso = new Date().toISOString();

    if (!player) {
      const newId = `plr_${crypto.randomBytes(6).toString('hex')}`;
      db.prepare(
        `INSERT INTO players
         (id, external_id_hash, display_name, region, install_source, install_campaign, install_creative, status, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
      ).run(
        newId,
        extHash,
        tgCheck.username,
        residency.region,
        String(body.installSource || tgCheck.startParam || 'organic_tma').slice(0, 48),
        body.installCampaign ? String(body.installCampaign).slice(0, 64) : null,
        body.installCreative ? String(body.installCreative).slice(0, 64) : null,
        nowIso,
        nowIso
      );
      player = db.prepare('SELECT * FROM players WHERE id = ?').get(newId);
    } else {
      if (player.status === 'banned') {
        return { status: 403, json: { error: 'ACCOUNT_BANNED', reason: player.ban_reason || 'Fair play violation' } };
      }
      db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ?').run(nowIso, player.id);
    }

    const playerToken = signPlayerToken({ playerId: player.id, region: player.region });
    return {
      status: 200,
      json: {
        ok: true,
        playerId: player.id,
        displayName: player.display_name,
        region: player.region,
        recommendedEndpoint: residency.recommendedEndpoint,
        playerToken,
      },
    };
  }

  // Legal Consent with Regional Age Gate (`POST /api/client/v1/legal/consent`)
  if (req.method === 'POST' && pathname === '/api/client/v1/legal/consent') {
    const playerAuth = authenticatePlayerRequest(req);
    const playerId = playerAuth?.sub || String(body.playerId || '').slice(0, 64);
    if (!playerId) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };

    const res = recordPlayerConsent(db, {
      playerId,
      region: residency.region,
      docType: body.docType || 'tos',
      docVersion: body.docVersion || '1.3',
      declaredAge: body.declaredAge ?? 18,
      parentalConsent: Boolean(body.parentalConsent),
      analyticsOptIn: Boolean(body.analyticsOptIn),
      marketingOptIn: Boolean(body.marketingOptIn),
      ipHash,
    });
    if (!res.ok) {
      return { status: 403, json: res };
    }
    return { status: 200, json: res };
  }

  // Session Start & TMA Reconnect Session Affinity (`POST /api/client/v1/session/start`)
  if (req.method === 'POST' && pathname === '/api/client/v1/session/start') {
    const playerAuth = authenticatePlayerRequest(req);
    const playerId = playerAuth?.sub || String(body.playerId || '').slice(0, 64);
    if (!playerId) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };

    const sessRl = checkRateLimit(`sess_start:${playerId}`, CONFIG.rateLimits.sessionStartsPerMinute);
    if (!sessRl.allowed) return { status: 429, json: { error: 'SESSION_START_RATE_LIMITED' } };

    // Reconnect path: verify HMAC session affinity token so active matches survive TMA network switch AND maintenance!
    if (body.affinityToken) {
      const aff = verifySessionAffinityToken(body.affinityToken);
      if (aff && aff.sid && aff.sub === playerId) {
        const existingSession = db.prepare('SELECT * FROM sessions WHERE id = ? AND player_id = ?').get(aff.sid, playerId);
        if (existingSession && !existingSession.ended_at) {
          return {
            status: 200,
            json: {
              ok: true,
              reconnected: true,
              sessionId: existingSession.id,
              nodeId: aff.nodeId,
              region: aff.region,
              affinityToken: body.affinityToken,
            },
          };
        }
      }
    }

    // New session check: block new matches with HTTP 503 during Maintenance Mode (17-maintenance-push-news-support.md)
    const maint = getMaintenanceState(db);
    if (maint.enabled) {
      return {
        status: 503,
        headers: { 'Retry-After': '60' },
        json: {
          error: 'MAINTENANCE_ACTIVE',
          matchmakingBlocked: true,
          bannerRu: maint.bannerRu,
          bannerEn: maint.bannerEn,
          etaIso: maint.etaIso,
          retryAfterSec: 60,
          // Nested form so a client can render the banner without branching.
          maintenance: {
            enabled: true,
            bannerRu: maint.bannerRu,
            bannerEn: maint.bannerEn,
            etaIso: maint.etaIso,
            retryAfterSec: 60,
            allowActiveMatchesFinishGraceSec: maint.allowActiveMatchesFinishGraceSec,
          },
        },
      };
    }

    const pRow = db.prepare('SELECT id, status, region FROM players WHERE id = ?').get(playerId);
    if (!pRow) return { status: 404, json: { error: 'PLAYER_NOT_FOUND' } };
    if (pRow.status === 'banned' || pRow.status === 'suspended') {
      return { status: 403, json: { error: 'PLAYER_RESTRICTED', status: pRow.status } };
    }

    const sessionId = `ses_${crypto.randomBytes(8).toString('hex')}`;
    const platform = ['tma_ios', 'tma_android', 'web_desktop'].includes(body.platform) ? body.platform : 'tma_ios';
    const deviceHash = hashIdentifier(body.deviceFingerprint || `${playerId}:${platform}`);
    const nowIso = new Date().toISOString();
    const nodeId = residency.recommendedEndpoint.nodeId;

    const affinityToken = signSessionAffinityToken({
      sessionId,
      playerId,
      region: residency.region,
      nodeId,
    });

    db.prepare(
      `INSERT INTO sessions
       (id, player_id, region, platform, device_hash, ip_hash, affinity_token, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(sessionId, playerId, residency.region, platform, deviceHash, ipHash, affinityToken, nowIso);

    return {
      status: 201,
      json: {
        ok: true,
        reconnected: false,
        sessionId,
        region: residency.region,
        nodeId,
        wsEndpoint: '/ws/client',
        affinityToken,
      },
    };
  }

  // Batch Input Telemetry Ingestion (`POST /api/client/v1/telemetry/inputs`)
  if (req.method === 'POST' && pathname === '/api/client/v1/telemetry/inputs') {
    const rl = checkRateLimit(`telemetry:${ipHash}`, CONFIG.rateLimits.clientTelemetryPerMinute);
    if (!rl.allowed) {
      return {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSec || 5) },
        json: { error: 'TELEMETRY_RATE_LIMITED', retryAfterSec: rl.retryAfterSec || 5 },
      };
    }

    const sessionId = String(body.sessionId || '');
    const session = db.prepare('SELECT id, player_id, region FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { status: 404, json: { error: 'SESSION_NOT_FOUND' } };

    const check = validateInputTelemetryBatch(body.events || []);

    if (check.tamperDetected && check.rejectedEvents.length > 0) {
      // Flag packet tampering into `fraud_cases` for human review (never auto-ban!)
      db.prepare(
        `INSERT INTO fraud_cases (id, player_id, region, risk_score, case_type, signals_json, status, created_at)
         VALUES (?, ?, ?, 0.86, 'packet_tamper_attempt', ?, 'open', ?)`
      ).run(
        crypto.randomUUID(),
        session.player_id,
        session.region,
        JSON.stringify({
          sessionId,
          rejectedCount: check.rejectedEvents.length,
          sampleReasons: check.rejectedEvents.slice(0, 5),
        }),
        new Date().toISOString()
      );
    }

    if (check.validEvents.length === 0 && check.rejectedEvents.length > 0) {
      return {
        status: 422,
        json: {
          ok: false,
          error: 'INVALID_TELEMETRY_BATCH',
          acceptedCount: 0,
          rejectedCount: check.rejectedEvents.length,
          reasons: check.rejectedEvents.slice(0, 10),
        },
      };
    }

    // `INSERT OR IGNORE` + unique (session_id, client_event_id) makes a retried batch
    // byte-for-byte idempotent: a lost 200 response can never double-count a stroke.
    const ins = db.prepare(
      `INSERT OR IGNORE INTO input_events
       (client_event_id, session_id, player_id, ts, pointer_type, grip, hand, is_serve, table_zone, has_fresh_swipe, swipe_straightness,
        along, across, accepted, contact, is_grace, reject_code, stroke_type, ball_speed, spin, reaction_ms, sweet_spot_dist, rules_version, ab_variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    let inserted = 0;
    let deduped = 0;
    const tx = db.transaction((rows) => {
      for (const ev of rows) {
        const res = ins.run(
          ev.client_event_id || null,
          session.id,
          session.player_id,
          ev.ts,
          ev.pointer_type,
          ev.grip,
          ev.hand,
          ev.is_serve,
          ev.table_zone,
          ev.has_fresh_swipe,
          ev.swipe_straightness,
          ev.along,
          ev.across,
          ev.accepted,
          ev.contact,
          ev.is_grace,
          ev.reject_code,
          ev.stroke_type,
          ev.ball_speed,
          ev.spin,
          ev.reaction_ms,
          ev.sweet_spot_dist,
          ev.rules_version,
          ev.ab_variant
        );
        if (Number(res.changes || 0) > 0) inserted += 1;
        else deduped += 1;
      }
    });
    tx(check.validEvents);

    return {
      status: 200,
      json: {
        ok: true,
        acceptedCount: inserted,
        dedupedCount: deduped,
        rejectedCount: check.rejectedEvents.length,
        serverTs: Date.now(),
      },
    };
  }

  // Session End Summary (`POST /api/client/v1/telemetry/session-end`)
  if (req.method === 'POST' && pathname === '/api/client/v1/telemetry/session-end') {
    const sessionId = String(body.sessionId || '');
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return { status: 404, json: { error: 'SESSION_NOT_FOUND' } };

    db.prepare(
      `UPDATE sessions
       SET rtt_p50_ms = ?, rtt_p95_ms = ?, avg_fps = ?, p5_fps = ?, crashed = ?, webgl_lost = ?, ended_at = ?
       WHERE id = ?`
    ).run(
      Number.isFinite(Number(body.rttP50Ms)) ? Number(body.rttP50Ms) : 42,
      Number.isFinite(Number(body.rttP95Ms)) ? Number(body.rttP95Ms) : 85,
      Number.isFinite(Number(body.avgFps)) ? Number(body.avgFps) : 60,
      Number.isFinite(Number(body.p5Fps)) ? Number(body.p5Fps) : 54,
      body.crashed ? 1 : 0,
      body.webglLost ? 1 : 0,
      new Date().toISOString(),
      sessionId
    );
    return { status: 200, json: { ok: true } };
  }

  // Player Support Tickets (`POST /api/client/v1/support/tickets` & `GET /api/client/v1/support/tickets`)
  if (req.method === 'POST' && pathname === '/api/client/v1/support/tickets') {
    const rl = checkRateLimit(`ticket:${ipHash}`, 12);
    if (!rl.allowed) return { status: 429, json: { error: 'SUPPORT_RATE_LIMITED' } };

    const playerAuth = authenticatePlayerRequest(req);
    const playerId = playerAuth?.sub || String(body.playerId || '').slice(0, 64) || null;

    const ticket = await createSupportTicket(db, {
      playerId,
      region: residency.region,
      sessionId: body.sessionId || null,
      category: body.category || 'bug',
      priority: body.priority || null,
      subject: body.subject || 'Обращение из игры',
      message: body.message || '',
      screenshotName: body.screenshotName || null,
      screenshotDataUrl: body.screenshotDataUrl || null,
      clientContext: body.clientContext || {},
    });

    publish('ticket', { ticketId: ticket.id, status: ticket.status, priority: ticket.priority });
    notify(db, {
      kind: 'ticket',
      severity: ticket.priority === 'critical' ? 'critical' : ticket.priority === 'high' ? 'warning' : 'info',
      title: `Новое обращение: ${ticket.subject}`,
      body: `Категория ${ticket.category} · SLA до ${ticket.sla_due_at || '—'}`,
      link: `#/liveops?ticket=${ticket.id}`,
      fingerprint: `ticket_new:${ticket.id}`,
    });
    return { status: 201, json: { ok: true, ticket } };
  }

  if (req.method === 'GET' && pathname === '/api/client/v1/support/tickets') {
    const playerAuth = authenticatePlayerRequest(req);
    const playerId = playerAuth?.sub || urlObj.searchParams.get('playerId');
    if (!playerId) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };
    return { status: 200, json: { tickets: listSupportTickets(db, { playerId }) } };
  }

  // Player-side ticket thread & status (`GET /api/client/v1/support/tickets/:id`)
  const clientTicketMatch = pathname.match(/^\/api\/client\/v1\/support\/tickets\/([^/]+)$/);
  if (req.method === 'GET' && clientTicketMatch) {
    const playerAuth = authenticatePlayerRequest(req);
    const playerId = playerAuth?.sub || urlObj.searchParams.get('playerId');
    if (!playerId) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };
    const ticket = getSupportTicketById(db, clientTicketMatch[1]);
    if (!ticket || ticket.player_id !== playerId) {
      return { status: 404, json: { error: 'TICKET_NOT_FOUND' } };
    }
    return {
      status: 200,
      json: {
        id: ticket.id,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        slaDueAt: ticket.sla_due_at,
        messages: ticket.messages.map((m) => ({
          role: m.sender_role,
          body: m.body,
          attachmentName: m.attachment_name,
          createdAt: m.created_at,
        })),
        statusHistory: ticket.statusHistory.map((e) => ({
          to: e.to_status,
          at: e.created_at,
          note: e.note,
        })),
      },
    };
  }

  // =========================================================================
  // Data-subject requests (16-legal-player-agreements.md, GDPR Art. 15/17).
  // A player may ask for their data or ask to be forgotten *from the client*:
  // making them write an email is exactly what regulators treat as "not readily
  // available". Intake only creates a queued request; a human fulfils it and the
  // 30-day clock starts immediately.
  // =========================================================================
  if (req.method === 'POST' && pathname === '/api/client/v1/privacy/request') {
    const rl = checkRateLimit(`privacy:${ipHash}`, 5);
    if (!rl.allowed) return { status: 429, json: { error: 'RATE_LIMITED', retryAfterSec: 60 } };

    const playerAuth = authenticatePlayerRequest(req);
    const playerId = playerAuth?.sub || String(body.playerId || '').slice(0, 64);
    if (!playerId) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };

    const created = createPrivacyRequest(db, {
      playerId,
      requestType: String(body.requestType || '').trim(),
      source: 'player_client',
      reason: body.reason ? String(body.reason).slice(0, 500) : null,
    });
    if (!created.ok) {
      const status =
        created.code === 'PLAYER_NOT_FOUND' ? 404 : created.code === 'REQUEST_ALREADY_OPEN' ? 409 : 400;
      return {
        status,
        json: {
          error: created.code,
          requestId: created.requestId || null,
          message:
            created.code === 'REQUEST_ALREADY_OPEN'
              ? 'Запрос такого типа уже принят и обрабатывается'
              : created.code === 'REQUEST_TYPE_INVALID'
              ? 'Допустимые типы: export, erasure'
              : 'Игрок не найден',
        },
      };
    }

    // No AI, no internals: the player sees what happens next and by when.
    notify(db, {
      kind: 'privacy',
      severity: 'warning',
      title: `Запрос ПДн: ${created.request.request_type}`,
      body: `Игрок ${playerId} · срок ${created.request.due_at.slice(0, 10)}`,
      link: '#/governance?tab=legal',
    });
    return {
      status: 201,
      json: {
        ok: true,
        requestId: created.request.id,
        type: created.request.request_type,
        status: created.request.status,
        requestedAt: created.request.requested_at,
        dueAt: created.request.due_at,
        slaDays: created.request.slaDays,
        message:
          created.request.request_type === 'export'
            ? 'Запрос на доступ принят. Данные будут переданы в течение 30 дней.'
            : 'Запрос на удаление принят. Данные будут удалены в течение 30 дней.',
      },
    };
  }

  // =========================================================================
  // Unified notification feed (17-maintenance-push-news-support.md):
  // admin pushes are ALWAYS pinned above regular news and visually distinct.
  // =========================================================================
  if (req.method === 'GET' && pathname === '/api/client/v1/notifications') {
    const playerAuth = authenticatePlayerRequest(req);
    const playerId = playerAuth?.sub || String(urlObj.searchParams.get('playerId') || '').slice(0, 64);
    if (!playerId) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };

    const dismissed = new Set(
      db.prepare('SELECT notification_id FROM notification_dismissals WHERE player_id = ?')
        .all(playerId)
        .map((r) => r.notification_id)
    );
    const pushes = listPushNotifications(db, { activeOnly: true })
      .filter((p) => !dismissed.has(p.id))
      .map((p) => ({
        id: p.id,
        kind: 'push',
        priority: p.priority === 'normal' ? 'important' : p.priority,
        pinned: true,
        important: true,
        title: p.title_ru,
        titleEn: p.title_en,
        body: p.body_ru,
        bodyEn: p.body_en,
        createdAt: p.created_at,
        expiresAt: p.expires_at,
        dismissible: true,
      }));
    const news = listNewsPosts(db, { publishedOnly: true })
      .filter((n) => !dismissed.has(n.id))
      .slice(0, 30)
      .map((n) => ({
        id: n.id,
        kind: 'news',
        priority: 'normal',
        pinned: false,
        important: false,
        category: n.category,
        title: n.title_ru,
        titleEn: n.title_en,
        body: n.body_ru,
        bodyEn: n.body_en,
        createdAt: n.created_at,
        dismissible: false,
      }));
    return {
      status: 200,
      json: {
        // Pushes strictly first: client renders this array top-down.
        items: [...pushes, ...news],
        pinnedCount: pushes.length,
        unreadCount: pushes.length,
        serverTimeUtc: new Date().toISOString(),
      },
    };
  }

  const dismissMatch = pathname.match(/^\/api\/client\/v1\/notifications\/([^/]+)\/dismiss$/);
  if (req.method === 'POST' && dismissMatch) {
    const playerAuth = authenticatePlayerRequest(req);
    const playerId = playerAuth?.sub || String(body.playerId || '').slice(0, 64);
    if (!playerId) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };
    db.prepare(
      'INSERT OR IGNORE INTO notification_dismissals (player_id, notification_id, dismissed_at) VALUES (?, ?, ?)'
    ).run(playerId, dismissMatch[1], new Date().toISOString());
    return { status: 200, json: { ok: true, notificationId: dismissMatch[1] } };
  }

  // =========================================================================
  // WebSocket admission ticket (short-lived, single-use) — the long-lived player
  // token must never appear in a WS URL, where proxies log it.
  // =========================================================================
  if (req.method === 'POST' && pathname === '/api/client/v1/ws/ticket') {
    const playerAuth = authenticatePlayerRequest(req);
    let playerId = playerAuth?.sub || null;
    let sessionId = String(body.sessionId || '') || null;
    let nodeId = residency.recommendedEndpoint?.nodeId || null;

    if (!playerId && body.affinityToken) {
      const aff = verifySessionAffinityToken(body.affinityToken);
      if (aff) {
        playerId = aff.sub;
        sessionId = aff.sid;
        nodeId = aff.nodeId;
      }
    }
    if (!playerId) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };

    const ticketId = crypto.randomBytes(24).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    db.prepare(
      'INSERT INTO ws_tickets (id, player_id, session_id, region, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(ticketId, playerId, sessionId, residency.region, now.toISOString(), expiresAt);
    return {
      status: 201,
      json: {
        ok: true,
        ticket: ticketId,
        expiresAt,
        wsEndpoint: `/ws/client?ticket=${encodeURIComponent(ticketId)}`,
        nodeId,
        keepAliveSec: 25,
      },
    };
  }

  // `GET /api/client/v1/news?limit=` — patch notes and known issues archive
  if (req.method === 'GET' && pathname === '/api/client/v1/news') {
    const limit = Math.min(50, Math.max(1, Number(urlObj.searchParams.get('limit') || 20)));
    const category = String(urlObj.searchParams.get('category') || 'all');
    const posts = listNewsPosts(db, { publishedOnly: true })
      .filter((n) => category === 'all' || n.category === category)
      .slice(0, limit)
      .map((n) => ({
        id: n.id,
        category: n.category,
        title: n.title_ru,
        titleEn: n.title_en,
        body: n.body_ru,
        bodyEn: n.body_en,
        publishedAt: n.created_at,
      }));
    return { status: 200, json: { posts, count: posts.length } };
  }

  // =========================================================================
  // Game progress, matches, leaderboard and runtime config (§3.12)
  // =========================================================================

  // Profile and progress (`GET /api/client/v1/me`)
  if (req.method === 'GET' && pathname === '/api/client/v1/me') {
    const auth = authenticatePlayerRequest(req);
    if (!auth) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };

    const player = db
      .prepare('SELECT id, display_name, region, status, ban_reason, created_at FROM players WHERE id = ?')
      .get(auth.sub);
    if (!player) return { status: 404, json: { error: 'PLAYER_NOT_FOUND' } };
    if (player.status === 'banned') {
      return { status: 403, json: { error: 'ACCOUNT_BANNED', reason: player.ban_reason || null } };
    }
    if (player.status !== 'active') {
      return { status: 403, json: { error: 'PLAYER_RESTRICTED', status: player.status } };
    }

    const progress = ensureProgress(db, player.id);
    return {
      status: 200,
      json: {
        ok: true,
        player: {
          playerId: player.id,
          displayName: player.display_name,
          region: player.region,
          status: player.status,
          createdAt: player.created_at,
        },
        progress: progressJson(progress),
        rewards: { coinsPerLevel: PROGRESS_LIMITS.coinsPerLevel, gemsPerLevel: PROGRESS_LIMITS.gemsPerLevel },
        serverTimeUtc: new Date().toISOString(),
      },
    };
  }

  // Level completion (`POST /api/client/v1/progress/level-complete`)
  if (req.method === 'POST' && pathname === '/api/client/v1/progress/level-complete') {
    const auth = authenticatePlayerRequest(req);
    if (!auth) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };

    const rl = checkRateLimit(`progress:${auth.sub}`, 30);
    if (!rl.allowed) {
      return {
        status: 429,
        json: { error: 'RATE_LIMITED', retryAfterSec: rl.retryAfterSec },
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      };
    }

    const idemKey = String(req.headers['idempotency-key'] || '') || null;
    const idem = idemLookup(db, idemKey, auth.sub, hashRequest('POST', pathname, body));
    if (idem.state === 'conflict') return { status: idem.status, json: idem.json };
    if (idem.state === 'replay') return { status: idem.status, json: idem.json };

    const current = ensureProgress(db, auth.sub);
    const level = asInt(body.level);
    const durationMs = asInt(body.durationMs);
    const xp = body.xp === undefined ? null : asInt(body.xp);
    const reasons = [];

    if (level === null || level < 1 || level > PROGRESS_LIMITS.maxLevel) reasons.push('LEVEL_OUT_OF_RANGE');
    if (durationMs === null || durationMs < 0) reasons.push('DURATION_INVALID');
    if (xp !== null && (xp < 0 || xp > PROGRESS_LIMITS.maxXpPerLevel)) reasons.push('XP_OUT_OF_RANGE');
    if (!reasons.length && level < current.level) reasons.push('LEVEL_REGRESSION');
    if (!reasons.length && level > current.level + PROGRESS_LIMITS.maxLevelJump) reasons.push('LEVEL_JUMP');
    const minDurationMs = PROGRESS_LIMITS.minLevelMs + PROGRESS_LIMITS.minLevelMsPerLevel * Math.max(1, level || 1);
    if (!reasons.length && durationMs < minDurationMs) reasons.push('LEVEL_TOO_FAST');

    if (reasons.length) {
      return { status: 422, json: { error: 'IMPLAUSIBLE_RESULT', reasons, minDurationMs } };
    }

    /* Награда — число сервера, а не клиента: сколько ступенек реально прошло,
     * столько и начислено. Клиент только показывает то, что вернул ответ. */
    const levels = level - current.level;
    const coins = levels * PROGRESS_LIMITS.coinsPerLevel;
    const gems = levels * PROGRESS_LIMITS.gemsPerLevel;
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE player_progress
          SET level = ?, xp = ?, coins = coins + ?, gems = gems + ?, updated_at = ?
        WHERE player_id = ?`
    ).run(level, xp === null ? current.xp : Math.max(current.xp, xp), coins, gems, now, auth.sub);

    const updated = readProgress(db, auth.sub);
    const json = {
      ok: true,
      progress: progressJson(updated),
      rewards: { coins, gems },
      serverTimeUtc: now,
    };
    idemSave(db, idemKey, auth.sub, 'POST', pathname, body, 200, json);
    publish('progress', { playerId: auth.sub, level: updated.level, coins, gems });
    return { status: 200, json };
  }

  // Match result (`POST /api/client/v1/matches`)
  if (req.method === 'POST' && pathname === '/api/client/v1/matches') {
    const auth = authenticatePlayerRequest(req);
    if (!auth) return { status: 401, json: { error: 'PLAYER_AUTH_REQUIRED' } };

    const rl = checkRateLimit(`matches:${auth.sub}`, 40);
    if (!rl.allowed) {
      return {
        status: 429,
        json: { error: 'RATE_LIMITED', retryAfterSec: rl.retryAfterSec },
        headers: { 'Retry-After': String(rl.retryAfterSec) },
      };
    }

    const idemKey = String(req.headers['idempotency-key'] || '') || null;
    const idem = idemLookup(db, idemKey, auth.sub, hashRequest('POST', pathname, body));
    if (idem.state === 'conflict') return { status: idem.status, json: idem.json };
    if (idem.state === 'replay') return { status: idem.status, json: idem.json };

    const playerScore = asInt(body.playerScore);
    const opponentScore = asInt(body.opponentScore);
    const durationMs = asInt(body.durationMs);
    const opponentRating = Math.min(3000, Math.max(100, asInt(body.opponentRating) ?? 1000));
    const mode = /^[a-z_]{3,24}$/.test(String(body.mode || '')) ? String(body.mode) : 'career';
    const clientMatchId = /^[A-Za-z0-9_.:-]{6,64}$/.test(String(body.matchId || '')) ? String(body.matchId) : null;

    const reasons = [];
    const badScore = (v) => v === null || v < 0 || v > PROGRESS_LIMITS.maxScore;
    if (badScore(playerScore) || badScore(opponentScore)) reasons.push('SCORE_INVALID');
    if (!reasons.length && playerScore === opponentScore) reasons.push('NO_WINNER');
    if (!reasons.length && (durationMs === null || durationMs < PROGRESS_LIMITS.minMatchMs || durationMs > PROGRESS_LIMITS.maxMatchMs)) {
      reasons.push('DURATION_INVALID');
    }
    if (reasons.length) {
      return { status: 422, json: { error: 'IMPLAUSIBLE_RESULT', reasons, minDurationMs: PROGRESS_LIMITS.minMatchMs } };
    }

    const matchId = clientMatchId || `mt_${crypto.randomBytes(8).toString('hex')}`;
    const existing = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    if (existing) {
      if (existing.player_id !== auth.sub) {
        return { status: 409, json: { error: 'MATCH_ID_CONFLICT' } };
      }
      /* Повторная отправка того же матча (ретрай, второй таб) не должна
       * второй раз менять рейтинг — возвращаем сохранённый результат. */
      const progress = ensureProgress(db, auth.sub);
      return {
        status: 200,
        json: {
          ok: true,
          replay: true,
          matchId,
          result: { win: !!existing.win, ratingBefore: existing.rating_before, ratingDelta: existing.rating_delta, rating: progress.rating },
          progress: progressJson(progress),
          serverTimeUtc: new Date().toISOString(),
        },
      };
    }

    const current = ensureProgress(db, auth.sub);
    const win = playerScore > opponentScore;
    const ratingBefore = current.rating;
    const ratingDelta = eloDelta(ratingBefore, opponentRating, win);
    const ratingAfter = Math.max(0, ratingBefore + ratingDelta);
    const bestRally = Math.min(
      PROGRESS_LIMITS.maxBestRally,
      Math.max(current.best_rally, asInt(body.bestRally) ?? 0)
    );
    const now = new Date().toISOString();

    db.transaction((row) => {
      db.prepare(
        `UPDATE player_progress
            SET rating = ?, matches = matches + 1, wins = wins + ?, losses = losses + ?,
                streak = ?, best_rally = ?, updated_at = ?
          WHERE player_id = ?`
      ).run(ratingAfter, win ? 1 : 0, win ? 0 : 1, win ? row.streak + 1 : 0, bestRally, now, auth.sub);
      db.prepare(
        `INSERT INTO matches
           (id, player_id, mode, opponent_name, opponent_rating, player_score, opponent_score,
            win, rating_before, rating_delta, duration_ms, rules_version, client_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        matchId,
        auth.sub,
        mode,
        String(body.opponentName || '').slice(0, 48) || null,
        opponentRating,
        playerScore,
        opponentScore,
        win ? 1 : 0,
        ratingBefore,
        ratingDelta,
        durationMs,
        asInt(body.rulesVersion),
        String(body.clientVersion || '').slice(0, 32) || null,
        now
      );
    })(current);

    const updated = readProgress(db, auth.sub);
    publish('match', { playerId: auth.sub, matchId, win, ratingDelta, mode });
    const json = {
      ok: true,
      replay: false,
      matchId,
      result: { win, ratingBefore, ratingDelta, rating: updated.rating },
      progress: progressJson(updated),
      serverTimeUtc: now,
    };
    idemSave(db, idemKey, auth.sub, 'POST', pathname, body, 200, json);
    return { status: 200, json };
  }

  // Leaderboard (`GET /api/client/v1/leaderboard`)
  if (req.method === 'GET' && pathname === '/api/client/v1/leaderboard') {
    const limit = Math.min(50, Math.max(1, asInt(urlObj.searchParams.get('limit')) ?? 20));
    const rows = db
      .prepare(
        `SELECT p.player_id, pl.display_name, p.rating, p.level, p.wins, p.losses
           FROM player_progress p
           JOIN players pl ON pl.id = p.player_id
          WHERE pl.status = 'active'
          ORDER BY p.rating DESC, p.wins DESC, p.updated_at ASC
          LIMIT ?`
      )
      .all(limit);

    const auth = authenticatePlayerRequest(req);
    let me = null;
    if (auth) {
      const mine = readProgress(db, auth.sub);
      if (mine) {
        const better = db
          .prepare(
            `SELECT COUNT(*) AS n
               FROM player_progress p
               JOIN players pl ON pl.id = p.player_id
              WHERE pl.status = 'active' AND (p.rating > ? OR (p.rating = ? AND p.wins > ?))`
          )
          .get(mine.rating, mine.rating, mine.wins);
        me = { rank: Number(better.n) + 1, playerId: auth.sub, ...progressJson(mine) };
      }
    }

    return {
      status: 200,
      json: {
        ok: true,
        scope: 'global',
        entries: rows.map((r, i) => ({
          rank: i + 1,
          playerId: r.player_id,
          name: r.display_name,
          rating: r.rating,
          level: r.level,
          wins: r.wins,
          losses: r.losses,
        })),
        me,
        serverTimeUtc: new Date().toISOString(),
      },
    };
  }

  // Runtime config (`GET /api/client/v1/config`) — balance without a deploy
  if (req.method === 'GET' && pathname === '/api/client/v1/config') {
    const rules = getActiveClientRules(db);
    return {
      status: 200,
      json: {
        ok: true,
        contractVersion: 1,
        matchRules: rules,
        rewards: { coinsPerLevel: PROGRESS_LIMITS.coinsPerLevel, gemsPerLevel: PROGRESS_LIMITS.gemsPerLevel },
        limits: {
          maxLevel: PROGRESS_LIMITS.maxLevel,
          maxLevelJump: PROGRESS_LIMITS.maxLevelJump,
          minMatchMs: PROGRESS_LIMITS.minMatchMs,
        },
        maintenance: getMaintenanceState(db),
        serverTimeUtc: new Date().toISOString(),
      },
    };
  }

  return null;
}

module.exports = {
  handleClientRoute,
};
