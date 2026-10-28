'use strict';

/**
 * Director Layer — Isolated Executive Synthesis & Chat (03-director-chat.md, 09-api-contracts.md)
 *
 * Strict Boundaries:
 * 1. Reads ONLY through `IsolatedDirectorGateway` (`zone_summaries`, `director_state`, `director_chat`,
 *    `incidents`, `ab_experiments`, `action_proposals`). ZERO access to raw logs, sessions, or PII!
 * 2. Enforces 48–72h Sliding Window: expired messages are physically DELETED from `director_chat`
 *    and stored in the separate Archive DB (`director-archive.sqlite` -> `archived_director_chat`).
 * 3. Maintains a separate Persistent State Block (`priorities`, open incidents, active A/B, recent owner decisions).
 * 4. Formats prompts with the exact 4-block structure from 03-director-chat.md (`[SYSTEM]`, `[PERSISTENT STATE]`,
 *    `[ZONE SUMMARIES]`, `[CHAT HISTORY]`, `[USER QUESTION]`).
 * 5. Validates every output via `validateDirectorResponseContract`; invalid JSON goes straight to `ai_quarantine`.
 */

const crypto = require('node:crypto');
const { CONFIG } = require('../config');
const { getArchiveDb, moveExpiredDirectorChatToArchiveDb } = require('../db/database');
const { IsolatedDirectorGateway } = require('../db/isolation');
const { executeIsolatedZoneModel, recordAiRequest } = require('./providers');
const directorPrompt = require('./prompts/director');
const { validateDirectorResponseContract, quarantineInvalidAiOutput } = require('../security/jsonSchema');
const { detectPromptInjection, scrubPiiAndSanitize } = require('../security/promptGuard');

function parseTimeRangeHours(timeRange) {
  if (timeRange === 'last_24h') return 24;
  if (timeRange === 'last_48h') return 48;
  return CONFIG.directorSlidingWindowHours;
}

function archiveExpiredDirectorMessages(db, referenceNow = new Date()) {
  const res = moveExpiredDirectorChatToArchiveDb(db, referenceNow);
  return { cutoffIso: res.cutoffIso, archivedCount: res.movedCount };
}

function getDirectorContext(db, timeRange = 'last_72h') {
  archiveExpiredDirectorMessages(db);
  const gw = new IsolatedDirectorGateway(db);
  const archDb = getArchiveDb(db);
  const windowHours = parseTimeRangeHours(timeRange);
  const cutoffIso = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  // Latest summary per zone within requested time_range (fallback to latest if none in narrow range)
  const zones = ['ops', 'fraud', 'balance', 'market', 'lab'];
  const freshZoneSummaries = {};
  for (const z of zones) {
    let row = gw.queryGet(
      'SELECT status, summary_json, created_at FROM zone_summaries WHERE zone = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1',
      z,
      cutoffIso
    );
    if (!row) {
      row = gw.queryGet(
        'SELECT status, summary_json, created_at FROM zone_summaries WHERE zone = ? ORDER BY created_at DESC LIMIT 1',
        z
      );
    }
    freshZoneSummaries[z] = row ? JSON.parse(row.summary_json) : null;
  }

  // Persistent state block (separate from chat history — 03-director-chat.md)
  const openIncidents = gw.queryAll(
    "SELECT id, severity, zone, title, runbook_slug, status, created_at FROM incidents WHERE status != 'resolved' ORDER BY created_at DESC LIMIT 10"
  );
  const activeAbs = gw.queryAll(
    "SELECT slug, hypothesis, status, control_sessions, treatment_sessions, control_contact_rate, treatment_contact_rate, p_value FROM ab_experiments WHERE status = 'running'"
  );
  const recentOwnerDecisions = gw.queryAll(
    "SELECT zone, action_type, title, status, decision_comment, decided_at FROM action_proposals WHERE status != 'pending' ORDER BY decided_at DESC LIMIT 8"
  );
  const pendingProposals = gw.queryAll(
    "SELECT id, zone, action_type, title, confidence, created_at FROM action_proposals WHERE status = 'pending' ORDER BY created_at DESC LIMIT 8"
  );
  const prioritiesRow = gw.queryGet("SELECT value_json, updated_at FROM director_state WHERE key = 'priorities'");
  const priorities = prioritiesRow
    ? JSON.parse(prioritiesRow.value_json)
    : [
        'Снижение OUTSIDE_ZONE на touch-экранах и по сложным зонам стола',
        'Стабильный RTT < 85 мс в Telegram Mini App',
        'Подготовка чистого рерайта клиента к подключению CRM',
      ];

  // Active sliding window (<= 48–72h, filtered by time_range)
  const activeMessages = gw
    .queryAll(
      'SELECT id, owner_id, role, content, structured_json, created_at FROM director_chat WHERE created_at >= ? ORDER BY created_at ASC LIMIT 40',
      cutoffIso
    )
    .map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      structured: m.structured_json ? JSON.parse(m.structured_json) : null,
      createdAt: m.created_at,
    }));

  const archivedCountRow = archDb.prepare('SELECT COUNT(*) AS cnt FROM archived_director_chat').get();

  return {
    timeRange,
    slidingWindowHours: CONFIG.directorSlidingWindowHours,
    freshZoneSummaries,
    persistentState: {
      priorities,
      openIncidents,
      activeAbExperiments: activeAbs,
      recentOwnerDecisions,
      pendingProposalsCount: pendingProposals.length,
    },
    activeMessages,
    archivedMessagesCount: Number(archivedCountRow?.cnt || 0),
  };
}

function getArchivedDirectorChat(db, limit = 50) {
  archiveExpiredDirectorMessages(db);
  const archDb = getArchiveDb(db);
  return archDb
    .prepare(
      'SELECT id, role, content, structured_json, created_at, archived_at FROM archived_director_chat ORDER BY created_at DESC LIMIT ?'
    )
    .all(Math.max(1, Math.min(200, Number(limit) || 50)))
    .map((m) => ({
      ...m,
      structured: m.structured_json ? JSON.parse(m.structured_json) : null,
    }));
}

function updateDirectorPriorities(db, prioritiesList) {
  const clean = Array.isArray(prioritiesList)
    ? prioritiesList.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
    : [];
  const nowIso = new Date().toISOString();
  db.prepare(
    `INSERT INTO director_state (key, value_json, updated_at)
     VALUES ('priorities', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
  ).run(JSON.stringify(clean), nowIso);
  return clean;
}

function synthesizeDeterministicDirectorAnswer(question, ctx) {
  const q = String(question || '').toLowerCase();
  const summaries = Object.values(ctx.freshZoneSummaries).filter(Boolean);

  let worstStatus = 'ok';
  for (const s of summaries) {
    if (s.status === 'critical') worstStatus = 'critical';
    else if (s.status === 'warning' && worstStatus === 'ok') worstStatus = 'warning';
  }
  if (ctx.persistentState.openIncidents.some((i) => i.severity === 'critical')) {
    worstStatus = 'critical';
  }

  let focusedZones = ['ops', 'fraud', 'balance', 'market', 'lab'];
  if (/баланс|овал|зон|outside|ввод|свайп|ракетк|penhold|touch|стол/i.test(q)) {
    focusedZones = ['balance', 'lab', 'ops'];
  } else if (/фрод|бот|чит|аккаунт|плат[её]ж.*риск|fraud|24\/7/i.test(q)) {
    focusedZones = ['fraud', 'ops'];
  } else if (/маркет|выруч|roas|ltv|cac|cpi|удержан|retention|коин|гем|эконом/i.test(q)) {
    focusedZones = ['market'];
  } else if (/пинг|лаг|fps|краш|ошибк|инцидент|ops|webgl/i.test(q)) {
    focusedZones = ['ops'];
  } else if (/a\/b|тест|гипотез|calibrate|noise|lab/i.test(q)) {
    focusedZones = ['lab', 'balance'];
  }

  const collectedFindings = [];
  for (const z of focusedZones) {
    const s = ctx.freshZoneSummaries[z];
    if (s && Array.isArray(s.findings)) {
      for (const f of s.findings) {
        collectedFindings.push({
          zone: z,
          issue: f.issue,
          confidence: Number(f.confidence || 0.8),
          recommended_action: f.recommended_action || 'Проверить карточку зоны',
        });
      }
    }
  }

  collectedFindings.sort((a, b) => b.confidence - a.confidence);
  const topFindings = collectedFindings.slice(0, 5);

  const attentionZones = summaries
    .filter((s) => s.status !== 'ok')
    .map((s) => s.zone.toUpperCase());

  const summaryText =
    attentionZones.length > 0
      ? `Окно анализа ${ctx.timeRange}: требуют внимания зоны ${attentionZones.join(', ')}. Открытых инцидентов: ${ctx.persistentState.openIncidents.length}, активных A/B-тестов: ${ctx.persistentState.activeAbExperiments.length}, ожидающих подтверждения владельца решений (HITL): ${ctx.persistentState.pendingProposalsCount}.`
      : `Окно анализа ${ctx.timeRange}: все 5 зон в статусе OK. Активных A/B-тестов: ${ctx.persistentState.activeAbExperiments.length}, критичных инцидентов нет.`;

  return {
    status: worstStatus,
    summary: summaryText,
    findings: topFindings,
    next_questions: [
      'Какие зоны требуют срочного внимания прямо сейчас?',
      'Покажи сводку по балансу овала нажатий и сложности по зонам стола',
      'Какие маркетинговые кампании убыточны по ROAS и какой канал лучший по D7?',
      'Сколько открытых антифрод-кейсов (включая 24/7 и маршруты) требуют ручной проверки?',
    ],
  };
}

async function askDirector(db, { ownerId, question, timeRange = 'last_72h', rawOverrideOutput = null }) {
  const cleanQuestion = scrubPiiAndSanitize(String(question || '').trim().slice(0, 2000));
  if (!cleanQuestion) {
    return { ok: false, status: 400, error: 'Вопрос владельца не может быть пустым' };
  }

  const validTimeRange = ['last_24h', 'last_48h', 'last_72h'].includes(timeRange) ? timeRange : 'last_72h';
  const injectionScan = detectPromptInjection(cleanQuestion);
  const ctx = getDirectorContext(db, validTimeRange);
  const nowIso = new Date().toISOString();

  const userMsgId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO director_chat (id, owner_id, region, role, content, structured_json, archived, created_at)
     VALUES (?, ?, ?, 'owner', ?, NULL, 0, ?)`
  ).run(userMsgId, ownerId, CONFIG.primaryRegion, cleanQuestion, nowIso);

  const chatHistorySlice = ctx.activeMessages.slice(-16).map((m) => ({
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  }));

  const formattedPrompt = directorPrompt.buildDirectorStructuredPrompt({
    persistentState: ctx.persistentState,
    freshZoneSummaries: ctx.freshZoneSummaries,
    chatHistory: chatHistorySlice,
    ownerQuestion: cleanQuestion,
    injectionWarning: injectionScan.suspicious ? injectionScan.matches : undefined,
  });

  const execRes = await executeIsolatedZoneModel(db, {
    zone: 'director',
    systemPrompt: directorPrompt.systemHeader,
    untrustedData: {
      timeRange: validTimeRange,
      persistentState: ctx.persistentState,
      zoneSummaries: ctx.freshZoneSummaries,
      chatHistory: chatHistorySlice,
      ownerQuestion: cleanQuestion,
    },
    customFormattedPrompt: formattedPrompt,
    fallbackSynthesizer: () => synthesizeDeterministicDirectorAnswer(cleanQuestion, ctx),
    rawOverrideOutput,
  });

  if (execRes.silent) {
    return {
      ok: false,
      silent: true,
      reason: execRes.reason,
      error: 'Дневной лимит токенов Директора исчерпан до 00:00 UTC',
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(execRes.rawText);
  } catch {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'director',
      provider: execRes.usedProvider,
      reason: 'Director output is not valid JSON',
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'director',
      provider: execRes.usedProvider,
      model: execRes.model,
      promptTokens: execRes.promptTokens,
      cachedTokens: execRes.cachedTokens,
      completionTokens: execRes.completionTokens,
      isBatch: execRes.isBatch,
      zeroRetention: execRes.zeroRetention,
      fallbackUsed: execRes.fallbackUsed,
      costUsd: execRes.costUsd,
      status: 'quarantined',
    });
    return {
      ok: false,
      quarantined: true,
      quarantineId: qId,
      error: 'Ответ модели не прошёл проверку JSON и помещён в карантин (03-director-chat.md)',
    };
  }

  const schemaCheck = validateDirectorResponseContract(parsed);
  if (!schemaCheck.valid) {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'director',
      provider: execRes.usedProvider,
      reason: schemaCheck.errors.join('; '),
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'director',
      provider: execRes.usedProvider,
      model: execRes.model,
      promptTokens: execRes.promptTokens,
      cachedTokens: execRes.cachedTokens,
      completionTokens: execRes.completionTokens,
      isBatch: execRes.isBatch,
      zeroRetention: execRes.zeroRetention,
      fallbackUsed: execRes.fallbackUsed,
      costUsd: execRes.costUsd,
      status: 'quarantined',
    });
    return {
      ok: false,
      quarantined: true,
      quarantineId: qId,
      errors: schemaCheck.errors,
      error: 'Ответ модели нарушил JSON Schema и помещён в карантин',
    };
  }

  recordAiRequest(db, {
    zone: 'director',
    provider: execRes.usedProvider,
    model: execRes.model,
    promptTokens: execRes.promptTokens,
    cachedTokens: execRes.cachedTokens,
    completionTokens: execRes.completionTokens,
    isBatch: execRes.isBatch,
    zeroRetention: execRes.zeroRetention,
    fallbackUsed: execRes.fallbackUsed,
    costUsd: execRes.costUsd,
    status: 'ok',
  });

  const replyId = crypto.randomUUID();
  const replyIso = new Date(Date.now() + 5).toISOString();
  db.prepare(
    `INSERT INTO director_chat (id, owner_id, region, role, content, structured_json, archived, created_at)
     VALUES (?, ?, ?, 'director', ?, ?, 0, ?)`
  ).run(replyId, ownerId, CONFIG.primaryRegion, parsed.summary, JSON.stringify(parsed), replyIso);

  return {
    ok: true,
    messageId: replyId,
    timeRange: validTimeRange,
    response: parsed,
    provider: execRes.usedProvider,
    promptPreview: execRes.promptPreview,
  };
}

module.exports = {
  archiveExpiredDirectorMessages,
  getDirectorContext,
  getArchivedDirectorChat,
  updateDirectorPriorities,
  askDirector,
};
