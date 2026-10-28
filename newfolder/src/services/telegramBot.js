'use strict';

/**
 * Read-Only Ops Telegram Bot Service (14-observability-runbooks.md, 15-liveops-content-plan.md)
 *
 * Security Rules:
 * - Strictly READ-ONLY for all game/player/rule state: NO ban, NO MATCH_RULES edit, NO maintenance toggle, NO SQL.
 * - Supports 8 pull commands: /status, /ping, /errors, /players, /revenue, /ai, /fraud, /help
 * - Supports inline callback button `ack:<incident_id>` ("Принял / В работе") so operators suppress duplicate alerts.
 * - Generates the 09:00 Morning Owner Digest (15-liveops-content-plan.md).
 */

const { CONFIG, PING_THRESHOLDS } = require('../config');
const { computeOpsDashboard } = require('../ai/zones/opsZone');
const { computeFraudDashboard } = require('../ai/zones/fraudZone');
const { computeMarketDashboard } = require('../ai/zones/marketZone');
const { listAllZonesStatus } = require('../ai/providers');
const { computeGoldenSignals } = require('./observability');

const ALLOWED_BOT_COMMANDS = Object.freeze([
  '/status',
  '/ping',
  '/errors',
  '/players',
  '/revenue',
  '/ai',
  '/fraud',
  '/help',
]);

function executeReadOnlyBotCommand(db, rawCommand) {
  const cmd = String(rawCommand || '')
    .trim()
    .split(/\s+/)[0]
    .split('@')[0]
    .toLowerCase();

  if (!ALLOWED_BOT_COMMANDS.includes(cmd)) {
    return {
      allowed: false,
      readOnlyEnforced: true,
      reply:
        '⛔ Команда отклонена политикой безопасности Read-Only бота (14-observability-runbooks.md).\n' +
        'Бот никогда не меняет игру, правила или аккаунты. Доступны только: ' +
        ALLOWED_BOT_COMMANDS.join(', '),
    };
  }

  if (cmd === '/help') {
    return {
      allowed: true,
      readOnlyEnforced: true,
      reply: [
        '🏓 *TOPSPIN ARENA — Read-Only Ops Bot*',
        '/status — общий светофор зон, CCU и открытые инциденты',
        '/ping — RTT по платформам и сессии >100 мс (порог TMA)',
        '/errors — краши, потери WebGL, 5xx и коды отказа ввода',
        '/players — DAU, MAU, Stickiness и сессии',
        '/revenue — IAP, Ad Revenue, ARPPU, ROAS',
        '/ai — лимиты токенов, prompt-cache и расходы по 5 зонам',
        '/fraud — открытые антифрод-кейсы (автобаны выключены)',
        'Инлайн-кнопка: `ack:<incident_id>` — пометить инцидент «Принял / В работе»',
      ].join('\n'),
    };
  }

  if (cmd === '/status') {
    const ops = computeOpsDashboard(db);
    const gs = computeGoldenSignals(db);
    const maint = db.prepare("SELECT value_json FROM system_settings WHERE key = 'maintenance_mode'").get();
    const maintObj = maint ? JSON.parse(maint.value_json) : { enabled: false };
    return {
      allowed: true,
      readOnlyEnforced: true,
      reply: [
        `📊 *Статус TOPSPIN ARENA*: ${ops.openIncidents.length > 0 ? '🟡 ВНИМАНИЕ' : '🟢 ШТАТНО'}`,
        `• Техработы: ${maintObj.enabled ? ' ВКЛЮЧЕНЫ' : 'выключены'}`,
        `• CCU / Сессий (7д): ${gs.traffic.ccu} / ${ops.totals.totalSessions}`,
        `• HTTP p50/p95/p99: ${gs.latency.httpP50Ms} / ${gs.latency.httpP95Ms} / ${gs.latency.httpP99Ms} мс`,
        `• Клиентский RTT p50/p95: ${ops.totals.meanRttP50Ms} / ${ops.totals.meanRttP95Ms} мс`,
        `• Открытых инцидентов: ${ops.openIncidents.length}`,
      ].join('\n'),
    };
  }

  if (cmd === '/ping') {
    const ops = computeOpsDashboard(db);
    const lines = ops.byPlatform.map(
      (p) => `• ${p.platform}: p50=${p.rtt_p50_ms}мс, p95=${p.rtt_p95_ms}мс (${p.sessions} сессий)`
    );
    const b = ops.rttBuckets;
    return {
      allowed: true,
      readOnlyEnforced: true,
      reply: [
        `🌐 *Сетевые задержки TMA (порог предупреждения >${PING_THRESHOLDS.warnClientThresholdMs} мс)*`,
        ...lines,
        `Распределение: <35мс=${b.excellent_lt35}, 35-65мс=${b.good_35_65}, 65-100мс=${b.playable_65_100}, 100-150мс=${b.poor_100_150}, >150мс=${b.unacceptable_gt150}`,
      ].join('\n'),
    };
  }

  if (cmd === '/errors') {
    const ops = computeOpsDashboard(db);
    const topRej = ops.rejectBreakdown
      .slice(0, 4)
      .map((r) => `${r.reject_code}: ${r.cnt}`)
      .join(', ');
    return {
      allowed: true,
      readOnlyEnforced: true,
      reply: [
        '🚨 *Ошибки и отказы ввода*',
        `• Краши: ${ops.totals.totalCrashes} (${ops.totals.crashRatePct}%)`,
        `• Потери WebGL: ${ops.totals.webglLost}`,
        `• HTTP 5xx: ${ops.totals.errors5xx}`,
        `• Отклонено нажатий: ${ops.totals.rejectRatePct}% (${topRej || 'нет'})`,
      ].join('\n'),
    };
  }

  if (cmd === '/players') {
    const market = computeMarketDashboard(db);
    return {
      allowed: true,
      readOnlyEnforced: true,
      reply: [
        '👥 *Онлайн и аудитория*',
        `• DAU: ${market.kpis.dau}`,
        `• MAU: ${market.kpis.mau}`,
        `• Stickiness (DAU/MAU): ${market.kpis.stickinessPct}%`,
        `• Конверсия в платящих: ${market.kpis.payerConversionPct}%`,
      ].join('\n'),
    };
  }

  if (cmd === '/revenue') {
    const market = computeMarketDashboard(db);
    return {
      allowed: true,
      readOnlyEnforced: true,
      reply: [
        '💰 *Монетизация и маркетинг*',
        `• Общая выручка: $${market.kpis.totalRevenueUsd} (IAP $${market.kpis.iapRevenueUsd} + Ads $${market.kpis.adRevenueUsd})`,
        `• ARPU / ARPPU: $${market.kpis.arpuUsd} / $${market.kpis.arppuUsd}`,
        `• Blended CPI / ROAS: $${market.kpis.blendedCpiUsd} / ${market.kpis.blendedRoasPct}%`,
        `• eCPM рекламы: $${market.kpis.ecpmUsd}`,
      ].join('\n'),
    };
  }

  if (cmd === '/ai') {
    const zones = listAllZonesStatus(db);
    const lines = zones.map(
      (z) =>
        `• ${z.zone}: ${z.usedTokens}/${z.dailyTokenLimit} ток. (${z.utilizationPct}%, кэш ${z.cachedTokensToday}) — $${z.costUsdToday}`
    );
    return {
      allowed: true,
      readOnlyEnforced: true,
      reply: ['🤖 *ИИ-бюджеты и лимиты зон*', ...lines].join('\n'),
    };
  }

  const fraud = computeFraudDashboard(db);
  return {
    allowed: true,
    readOnlyEnforced: true,
    reply: [
      '🛡️ *Антифрод-сводка (8 детекторов, автобаны выключены)*',
      `• Открытых кейсов: ${fraud.counts.openCases} (высокий риск >=0.80: ${fraud.counts.highRiskOpen})`,
      `• Подтверждённый фрод: ${fraud.counts.confirmedFraud}, ложные: ${fraud.counts.falsePositives}`,
      'Вердикты выставляются только вручную в веб-админке.',
    ].join('\n'),
  };
}

/**
 * Handles inline Telegram callback `[Принял / В работе]` (`ack:<incident_id>`)
 * per 14-observability-runbooks.md lines 124–129.
 */
function handleTelegramCallbackQuery(db, { callbackData, operatorHandle = 'tg_duty_engineer' }) {
  const raw = String(callbackData || '');
  if (!raw.startsWith('ack:')) {
    return { ok: false, error: 'Разрешён только callback ack:<incident_id> (Read-Only режим)' };
  }
  const incId = raw.slice(4).trim();
  const inc = db.prepare('SELECT * FROM incidents WHERE id = ?').get(incId);
  if (!inc) {
    return { ok: false, error: 'Инцидент не найден' };
  }
  const nowIso = new Date().toISOString();
  db.prepare(`UPDATE incidents SET status = 'acknowledged', ack_by = ?, ack_at = ? WHERE id = ?`).run(
    String(operatorHandle).slice(0, 64),
    nowIso,
    incId
  );
  return {
    ok: true,
    incidentId: incId,
    status: 'acknowledged',
    ackBy: operatorHandle,
    reply: `✅ Инцидент "${inc.title}" взят в работу оператором @${operatorHandle}. Повторные пуши подавлены.`,
  };
}

/**
 * Morning 09:00 Owner Digest (15-liveops-content-plan.md line 131)
 */
function buildMorningDigest(db) {
  const ops = computeOpsDashboard(db, { periodDays: 1 });
  const market = computeMarketDashboard(db, { periodDays: 1 });
  const fraud = computeFraudDashboard(db);
  const openTickets = Number(
    db.prepare(`SELECT COUNT(*) AS cnt FROM support_tickets WHERE status IN ('open', 'in_progress')`).get()?.cnt || 0
  );
  const pendingHitl = Number(
    db.prepare(`SELECT COUNT(*) AS cnt FROM action_proposals WHERE status = 'pending'`).get()?.cnt || 0
  );
  const activeAbs = Number(
    db.prepare(`SELECT COUNT(*) AS cnt FROM ab_experiments WHERE status = 'running'`).get()?.cnt || 0
  );

  const text = [
    '☀️ *Утренняя сводка владельца TOPSPIN ARENA (09:00)*',
    `• DAU / MAU: ${market.kpis.dau} / ${market.kpis.mau} (Stickiness ${market.kpis.stickinessPct}%)`,
    `• Выручка за 24ч: $${market.kpis.totalRevenueUsd} (ARPDAU $${market.kpis.arpdauUsd})`,
    `• Стабильность: FPS=${ops.totals.meanFps}, RTT p50=${ops.totals.meanRttP50Ms}мс, краши=${ops.totals.crashRatePct}%`,
    `• Открытых тикетов поддержки: ${openTickets}`,
    `• Антифрод (высокий риск): ${fraud.counts.highRiskOpen} | Активных A/B: ${activeAbs}`,
    `• Ожидают подтверждения владельца (HITL): ${pendingHitl}`,
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    schedule: '09:00 local',
    text,
    metrics: {
      dau: market.kpis.dau,
      revenue24hUsd: market.kpis.totalRevenueUsd,
      crashRatePct: ops.totals.crashRatePct,
      openTickets,
      pendingHitl,
      activeAbs,
    },
  };
}

async function sendCriticalTelegramAlert(incident) {
  if (!CONFIG.telegramOpsBotToken || !CONFIG.telegramOpsChatId) {
    return { delivered: false, mode: 'local_log_only', inlineKeyboard: [[{ text: 'Принял / В работе', callback_data: `ack:${incident.id}` }]] };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${CONFIG.telegramOpsBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CONFIG.telegramOpsChatId,
        text: `🔴 CRITICAL [${incident.zone.toUpperCase()}]: ${incident.title}\n${incident.description}\nRunbook: ${incident.runbook_slug || 'n/a'}`,
        reply_markup: {
          inline_keyboard: [[{ text: '✅ Принял / В работе', callback_data: `ack:${incident.id}` }]],
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    return { delivered: res.ok, mode: 'telegram_api' };
  } catch {
    return { delivered: false, mode: 'network_blocked_fallback' };
  }
}

module.exports = {
  ALLOWED_BOT_COMMANDS,
  executeReadOnlyBotCommand,
  handleTelegramCallbackQuery,
  buildMorningDigest,
  sendCriticalTelegramAlert,
};
