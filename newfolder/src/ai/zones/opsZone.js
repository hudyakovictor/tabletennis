'use strict';

/**
 * Zone 1: Ops (Technical State & Stability) — 02-ai-zones.md, 13-telegram-miniapp-latency.md
 * Cadence: Every 15 minutes (or on anomaly trigger).
 * Strict boundary: reads ONLY sessions, telemetry_metrics, input_events, incidents, own zone_summaries.
 */

const crypto = require('node:crypto');
const { PING_THRESHOLDS, PRESS_REJECTION_REASONS } = require('../../config');
const { IsolatedZoneGateway } = require('../../db/isolation');
const { executeIsolatedZoneModel, recordAiRequest } = require('../providers');
const opsPrompt = require('../prompts/ops');
const { validateZoneSummaryContract, quarantineInvalidAiOutput } = require('../../security/jsonSchema');

function computeOpsDashboard(db, { periodDays = 7 } = {}) {
  const gw = new IsolatedZoneGateway(db, 'ops');
  const days = Math.max(1, Math.min(90, Number(periodDays) || 7));
  const cutoffIso = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const sessionAgg = gw.queryGet(
    `SELECT
       COUNT(*) AS total_sessions,
       ROUND(AVG(avg_fps), 1) AS mean_fps,
       ROUND(MIN(p5_fps), 1) AS worst_p5_fps,
       ROUND(AVG(rtt_p50_ms), 1) AS mean_rtt_p50,
       ROUND(AVG(rtt_p95_ms), 1) AS mean_rtt_p95,
       SUM(crashed) AS total_crashes,
       SUM(webgl_lost) AS total_webgl_lost
     FROM sessions
     WHERE started_at >= ?`,
    cutoffIso
  );

  const byPlatform = gw.queryAll(
    `SELECT
       platform,
       COUNT(*) AS sessions,
       ROUND(AVG(avg_fps), 1) AS avg_fps,
       ROUND(AVG(rtt_p50_ms), 1) AS rtt_p50_ms,
       ROUND(AVG(rtt_p95_ms), 1) AS rtt_p95_ms,
       SUM(crashed) AS crashes,
       SUM(webgl_lost) AS webgl_lost
     FROM sessions
     WHERE started_at >= ?
     GROUP BY platform
     ORDER BY sessions DESC`,
    cutoffIso
  );

  // Exact RTT Tiers from 13-telegram-miniapp-latency.md: <35, 35-65, 65-100, 100-150 (warn >100), >150
  const rttBuckets = gw.queryGet(
    `SELECT
       SUM(CASE WHEN rtt_p50_ms < ? THEN 1 ELSE 0 END) AS excellent_lt35,
       SUM(CASE WHEN rtt_p50_ms >= ? AND rtt_p50_ms < ? THEN 1 ELSE 0 END) AS good_35_65,
       SUM(CASE WHEN rtt_p50_ms >= ? AND rtt_p50_ms <= ? THEN 1 ELSE 0 END) AS playable_65_100,
       SUM(CASE WHEN rtt_p50_ms > ? AND rtt_p50_ms <= ? THEN 1 ELSE 0 END) AS poor_100_150,
       SUM(CASE WHEN rtt_p50_ms > ? THEN 1 ELSE 0 END) AS unacceptable_gt150
     FROM sessions
     WHERE started_at >= ?`,
    PING_THRESHOLDS.excellentMaxMs,
    PING_THRESHOLDS.excellentMaxMs,
    PING_THRESHOLDS.goodMaxMs,
    PING_THRESHOLDS.goodMaxMs,
    PING_THRESHOLDS.playableRollbackMaxMs,
    PING_THRESHOLDS.warnClientThresholdMs,
    PING_THRESHOLDS.poorWarnMaxMs,
    PING_THRESHOLDS.poorWarnMaxMs,
    cutoffIso
  );

  const byRegionRtt = gw.queryAll(
    `SELECT
       region,
       COUNT(*) AS sessions,
       ROUND(AVG(rtt_p50_ms), 1) AS avg_rtt_p50_ms,
       ROUND(AVG(rtt_p95_ms), 1) AS avg_rtt_p95_ms,
       SUM(CASE WHEN rtt_p50_ms > ? THEN 1 ELSE 0 END) AS warn_gt100_sessions
     FROM sessions
     WHERE started_at >= ?
     GROUP BY region
     ORDER BY sessions DESC`,
    PING_THRESHOLDS.warnClientThresholdMs,
    cutoffIso
  );

  const rejectRows = gw.queryAll(
    `SELECT reject_code, COUNT(*) AS cnt
     FROM input_events
     WHERE accepted = 0 AND reject_code IS NOT NULL AND ts >= ?
     GROUP BY reject_code
     ORDER BY cnt DESC`,
    cutoffIso
  );
  const rejectMap = Object.fromEntries(PRESS_REJECTION_REASONS.map((r) => [r, 0]));
  for (const r of rejectRows) {
    rejectMap[r.reject_code] = Number(r.cnt || 0);
  }

  const inputTotals = gw.queryGet(
    `SELECT
       COUNT(*) AS total_inputs,
       SUM(CASE WHEN accepted = 0 THEN 1 ELSE 0 END) AS rejected_inputs
     FROM input_events
     WHERE ts >= ?`,
    cutoffIso
  );

  const http5xx = gw.queryGet(
    `SELECT COALESCE(SUM(metric_value), 0) AS errors_5xx
     FROM telemetry_metrics
     WHERE metric_name = 'http_5xx_count' AND bucket_ts >= ?`,
    cutoffIso
  );

  const openIncidents = gw.queryAll(
    `SELECT id, severity, zone, title, description, runbook_slug, status, ack_by, created_at
     FROM incidents
     WHERE status != 'resolved'
     ORDER BY created_at DESC
     LIMIT 20`
  );

  const ownSummaryHistory = gw.readOwnSummaryHistory(4);

  const totalSessions = Number(sessionAgg?.total_sessions || 0);
  const crashRatePct = totalSessions > 0 ? +(((sessionAgg.total_crashes || 0) / totalSessions) * 100).toFixed(2) : 0;
  const rejectRatePct =
    Number(inputTotals?.total_inputs || 0) > 0
      ? +(((inputTotals.rejected_inputs || 0) / inputTotals.total_inputs) * 100).toFixed(2)
      : 0;

  return {
    periodDays: days,
    totals: {
      totalSessions,
      meanFps: Number(sessionAgg?.mean_fps || 60),
      worstP5Fps: Number(sessionAgg?.worst_p5_fps || 55),
      meanRttP50Ms: Number(sessionAgg?.mean_rtt_p50 || 42),
      meanRttP95Ms: Number(sessionAgg?.mean_rtt_p95 || 88),
      totalCrashes: Number(sessionAgg?.total_crashes || 0),
      crashRatePct,
      webglLost: Number(sessionAgg?.total_webgl_lost || 0),
      rejectRatePct,
      errors5xx: Number(http5xx?.errors_5xx || 0),
    },
    byPlatform,
    byRegionRtt,
    rttBuckets: {
      excellent_lt35: Number(rttBuckets?.excellent_lt35 || 0),
      good_35_65: Number(rttBuckets?.good_35_65 || 0),
      playable_65_100: Number(rttBuckets?.playable_65_100 || 0),
      poor_100_150: Number(rttBuckets?.poor_100_150 || 0),
      unacceptable_gt150: Number(rttBuckets?.unacceptable_gt150 || 0),
    },
    rejectBreakdown: rejectRows,
    allRejectCodes: rejectMap,
    openIncidents,
    ownSummaryHistoryCount: ownSummaryHistory.length,
  };
}

function ensureOpsProposalIfNeeded(db, dash) {
  const highPingCount = dash.rttBuckets.poor_100_150 + dash.rttBuckets.unacceptable_gt150;
  if (dash.totals.crashRatePct <= 1.2 && highPingCount === 0) return;

  const existing = db
    .prepare("SELECT id FROM action_proposals WHERE zone = 'ops' AND status = 'pending' LIMIT 1")
    .get();
  if (existing) return;

  db.prepare(
    `INSERT INTO action_proposals
     (id, zone, action_type, title, rationale, payload_json, confidence, status, created_at)
     VALUES (?, 'ops', 'ops_mitigation_alert', ?, ?, ?, ?, 'pending', ?)`
  ).run(
    crypto.randomUUID(),
    'Включить баннер повышенного RTT / проверить WebGL-пул на бюджетном Android',
    `Crash rate=${dash.totals.crashRatePct}%, сессий с RTT > 100мс (порог предупреждения клиента): ${highPingCount}. Автопереключение запрещено (HITL).`,
    JSON.stringify({
      notifyBanner: 'На части мобильных сетей зафиксирован повышенный пинг (>100 мс). Рекомендуем Wi-Fi.',
      targetSegment: 'tma_android',
    }),
    0.88,
    new Date().toISOString()
  );
}

async function runOpsZoneAnalysis(db, { rawOverrideOutput = null } = {}) {
  const gw = new IsolatedZoneGateway(db, 'ops');
  const dash = computeOpsDashboard(db, { periodDays: 7 });
  const prevSummaries = gw.readOwnSummaryHistory(3);
  const nowIso = new Date().toISOString();

  const fallbackSynthesizer = () => {
    const findings = [];
    let status = 'ok';

    if (dash.totals.crashRatePct > 2.0) {
      status = 'critical';
      findings.push({
        issue: `Crash rate вырос до ${dash.totals.crashRatePct}% (порог 2.0%), потерь WebGL: ${dash.totals.webglLost}`,
        confidence: 0.94,
        affected_segment: 'tma_android_low_ram',
        recommended_action: 'Проверить rb-client-crash-surge и подтвердить предупреждающий баннер для слабых Android',
      });
    } else if (dash.totals.crashRatePct > 0.8) {
      status = 'warning';
      findings.push({
        issue: `Умеренный уровень крашей (${dash.totals.crashRatePct}%) и WebGL context loss (${dash.totals.webglLost}) на бюджетных TMA-устройствах`,
        confidence: 0.86,
        affected_segment: 'tma_android',
        recommended_action: 'Проконтролировать освобождение текстур арены при сворачивании Telegram WebView',
      });
    }

    const warnPingCount = dash.rttBuckets.poor_100_150 + dash.rttBuckets.unacceptable_gt150;
    if (warnPingCount > 0 || dash.totals.meanRttP95Ms > PING_THRESHOLDS.warnClientThresholdMs) {
      if (status === 'ok') status = 'warning';
      findings.push({
        issue: `RTT p95 = ${dash.totals.meanRttP95Ms} мс; сессий выше порога предупреждения (>100 мс): ${warnPingCount} (из них >150 мс: ${dash.rttBuckets.unacceptable_gt150})`,
        confidence: 0.89,
        affected_segment: 'mobile_4g_tma',
        recommended_action: 'Проверить привязку региональных узлов (RU/EU/CIS) и rollback-буфер 65–100 мс',
      });
    }

    if (dash.totals.rejectRatePct > 28) {
      if (status === 'ok') status = 'warning';
      const topReject = dash.rejectBreakdown[0];
      findings.push({
        issue: `Доля отклонённых нажатий ${dash.totals.rejectRatePct}% (лидирует ${topReject ? topReject.reject_code : 'OUTSIDE_ZONE'})`,
        confidence: 0.84,
        affected_segment: 'touch_mobile',
        recommended_action: 'Сверить отчёт зоны Balance по овалу нажатий и свежести свайпа (NO_FRESH_SWIPE)',
      });
    }

    if (findings.length === 0) {
      findings.push({
        issue: 'Технические метрики FPS, RTT и стабильности сессий в пределах целевых SLO',
        confidence: 0.95,
        affected_segment: 'all_platforms',
        recommended_action: 'Продолжать штатный мониторинг 4 золотых сигналов',
      });
    }

    return {
      zone: 'ops',
      timestamp: nowIso,
      status,
      findings,
      metrics: dash.totals,
    };
  };

  const execRes = await executeIsolatedZoneModel(db, {
    zone: 'ops',
    systemPrompt: opsPrompt.systemPrompt,
    untrustedData: { current: dash, previousOwnSummaries: prevSummaries },
    fallbackSynthesizer,
    rawOverrideOutput,
  });

  if (execRes.silent) return { zone: 'ops', silent: true, reason: execRes.reason };

  let parsed = null;
  try {
    parsed = JSON.parse(execRes.rawText);
  } catch {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'ops',
      provider: execRes.usedProvider,
      reason: 'Malformed JSON from Ops model',
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'ops',
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
    return { zone: 'ops', quarantined: true, quarantineId: qId };
  }

  const check = validateZoneSummaryContract(parsed, 'ops');
  if (!check.valid) {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'ops',
      provider: execRes.usedProvider,
      reason: check.errors.join('; '),
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'ops',
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
    return { zone: 'ops', quarantined: true, quarantineId: qId, errors: check.errors };
  }

  const reqId = recordAiRequest(db, {
    zone: 'ops',
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

  ensureOpsProposalIfNeeded(db, dash);
  const summaryId = gw.writeSummary({ status: parsed.status, summaryObj: parsed, requestId: reqId });
  return { zone: 'ops', summaryId, summary: parsed, provider: execRes.usedProvider };
}

module.exports = {
  computeOpsDashboard,
  runOpsZoneAnalysis,
};
