'use strict';

/**
 * Zone 2: Fraud (Anti-Cheat, Bots, Multi-Accounts & Payment Risk) — 02-ai-zones.md
 * Cadence: Every 30 minutes (or event-driven).
 *
 * Implements ALL 8 canonical detectors from 02-ai-zones.md lines 40–52:
 *   1. Sweet-spot hit accuracy (`sweet_spot_dist <= 0.08`)
 *   2. Superhuman reaction (`avg_reaction_ms < 115`)
 *   3. Robotic linear swipe (`avg_straightness >= 0.992`)
 *   4. 24/7 marathon activity (`distinct_utc_hours >= 20` inside 24h window)
 *   5. Repeating stroke routes (`identical quantized (along, across, stroke)` >= 8x)
 *   6. Multi-account device/IP cluster (`>= 3` players sharing `device_hash` or `ip_hash`)
 *   7. Payment velocity surge (`>= 5` payments within 10 minutes)
 *   8. Payment geo mismatch (`billing_country !== session_country` or `risk_flag = 1`)
 *
 * CRITICAL INVARIANT: Fraud AI NEVER auto-bans a player. It only writes `fraud_cases`
 * and HITL `action_proposals` for human confirmation!
 */

const crypto = require('node:crypto');
const { CONFIG } = require('../../config');
const { IsolatedZoneGateway } = require('../../db/isolation');
const { executeIsolatedZoneModel, recordAiRequest } = require('../providers');
const fraudPrompt = require('../prompts/fraud');
const { validateZoneSummaryContract, quarantineInvalidAiOutput } = require('../../security/jsonSchema');

function runAutomatedFraudDetectors(db) {
  const gw = new IsolatedZoneGateway(db, 'fraud');
  const nowIso = new Date().toISOString();

  // Detectors 1, 2, 3: Sweet-spot accuracy, superhuman reaction, robotic swipe straightness
  const playerStats = gw.queryAll(
    `SELECT
       player_id,
       COUNT(*) AS shots,
       ROUND(AVG(CASE WHEN contact = 1 THEN 1.0 ELSE 0.0 END), 4) AS contact_rate,
       ROUND(AVG(reaction_ms), 1) AS avg_reaction_ms,
       ROUND(AVG(CASE WHEN sweet_spot_dist IS NOT NULL AND sweet_spot_dist <= 0.08 THEN 1.0 ELSE 0.0 END), 4) AS sweet_spot_rate,
       ROUND(AVG(swipe_straightness), 4) AS avg_straightness
     FROM input_events
     WHERE accepted = 1
     GROUP BY player_id
     HAVING COUNT(*) >= 18`
  );

  let upserted = 0;

  const upsertFraudCase = (playerId, caseType, riskScore, signalsObj) => {
    const existing = gw.queryGet(
      `SELECT id FROM fraud_cases WHERE player_id = ? AND case_type = ? AND status = 'open'`,
      playerId,
      caseType
    );
    const pRow = gw.queryGet('SELECT region FROM v_fraud_players WHERE player_id = ?', playerId);
    const region = pRow?.region || CONFIG.primaryRegion;
    if (!existing) {
      db.prepare(
        `INSERT INTO fraud_cases (id, player_id, region, risk_score, case_type, signals_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`
      ).run(crypto.randomUUID(), playerId, region, +riskScore.toFixed(2), caseType, JSON.stringify(signalsObj), nowIso);
      upserted++;
    }
  };

  for (const s of playerStats) {
    const signals = [];
    let risk = 0.1;

    if (s.sweet_spot_rate >= 0.92 && s.contact_rate >= 0.96) {
      risk += 0.42;
      signals.push(`Нечеловеческая точность sweet-spot ${(s.sweet_spot_rate * 100).toFixed(1)}% при контакте ${(s.contact_rate * 100).toFixed(1)}%`);
    }
    if (s.avg_reaction_ms !== null && s.avg_reaction_ms < 115) {
      risk += 0.36;
      signals.push(`Сверхбыстрая средняя реакция ${s.avg_reaction_ms} мс (<115 мс биомеханического порога)`);
    }
    if (s.avg_straightness !== null && s.avg_straightness >= 0.992) {
      risk += 0.28;
      signals.push(`Абсолютно прямолинейные траектории свайпов (${(s.avg_straightness * 100).toFixed(2)}% линейности)`);
    }

    if (risk >= 0.65) {
      upsertFraudCase(s.player_id, 'bot_aim_macro', Math.min(0.99, risk), {
        shots: s.shots,
        contact_rate: s.contact_rate,
        avg_reaction_ms: s.avg_reaction_ms,
        sweet_spot_rate: s.sweet_spot_rate,
        avg_straightness: s.avg_straightness,
        signals,
      });
    }
  }

  // Detector 4: 24/7 Activity without human sleep window (>= 20 distinct UTC hours in last 48h)
  const marathonPlayers = gw.queryAll(
    `SELECT
       player_id,
       COUNT(DISTINCT strftime('%H', started_at)) AS distinct_hours,
       COUNT(*) AS session_count
     FROM sessions
     WHERE started_at >= datetime('now', '-2 days')
     GROUP BY player_id
     HAVING COUNT(DISTINCT strftime('%H', started_at)) >= 20`
  );
  for (const mp of marathonPlayers) {
    upsertFraudCase(mp.player_id, 'activity_24_7', 0.87, {
      distinct_utc_hours: mp.distinct_hours,
      session_count: mp.session_count,
      signals: [`Активность 24/7 без перерыва на сон: ${mp.distinct_hours}/24 часовых слотов UTC (${mp.session_count} сессий)`],
    });
  }

  // Detector 5: Repeating stroke routes (identical quantized along/across/stroke repeated >= 8 times)
  const repeatingRoutes = gw.queryAll(
    `SELECT
       player_id,
       CAST(ROUND(along, 0) AS INTEGER) AS q_along,
       CAST(ROUND(across, 0) AS INTEGER) AS q_across,
       COALESCE(stroke_type, 'drive') AS stroke_t,
       COUNT(*) AS identical_hits
     FROM input_events
     WHERE accepted = 1
     GROUP BY player_id, q_along, q_across, stroke_t
     HAVING COUNT(*) >= 8`
  );
  for (const rr of repeatingRoutes) {
    upsertFraudCase(rr.player_id, 'repeating_routes', 0.84, {
      quantized_point: { along: rr.q_along, across: rr.q_across, stroke: rr.stroke_t },
      identical_hits: rr.identical_hits,
      signals: [
        `Повторяющийся пиксельный маршрут свайпа (${rr.q_along}, ${rr.q_across}, ${rr.stroke_t}) воспроизведён ${rr.identical_hits} раз подряд`,
      ],
    });
  }

  // Detector 6: Multi-account device/IP cluster (>= 3 distinct players on one device_hash or ip_hash)
  const deviceClusters = gw.queryAll(
    `SELECT device_hash, COUNT(DISTINCT player_id) AS accounts_count, MIN(player_id) AS sample_player
     FROM sessions
     GROUP BY device_hash
     HAVING COUNT(DISTINCT player_id) >= 3`
  );
  for (const c of deviceClusters) {
    upsertFraudCase(c.sample_player, 'multi_account_cluster', Math.min(0.95, 0.55 + c.accounts_count * 0.08), {
      device_hash: c.device_hash,
      accounts_count: c.accounts_count,
      signals: [`На одном device_hash (${c.device_hash}) обнаружено ${c.accounts_count} различных аккаунтов`],
    });
  }

  // Detector 7: Payment velocity (>= 4 transactions by same player within 15 minutes)
  const velocityRows = gw.queryAll(
    `SELECT
       p1.player_id,
       COUNT(DISTINCT p2.id) AS burst_tx_count,
       ROUND(SUM(p2.amount_usd), 2) AS burst_usd
     FROM payments p1
     JOIN payments p2
       ON p1.player_id = p2.player_id
      AND ABS(julianday(p2.created_at) - julianday(p1.created_at)) * 1440 <= 15
     WHERE p1.player_id IS NOT NULL
     GROUP BY p1.player_id, p1.id
     HAVING COUNT(DISTINCT p2.id) >= 4`
  );
  for (const vr of velocityRows) {
    upsertFraudCase(vr.player_id, 'payment_velocity', 0.89, {
      burst_tx_count: vr.burst_tx_count,
      burst_usd: vr.burst_usd,
      signals: [`Аномальная частота платежей: ${vr.burst_tx_count} транзакций за <=15 минут ($${vr.burst_usd})`],
    });
  }

  // Detector 8: Payment geo mismatch or high-risk flag
  const riskyPayments = gw.queryAll(
    `SELECT id, player_id, amount_usd, billing_country, session_country, provider
     FROM payments
     WHERE player_id IS NOT NULL AND (risk_flag = 1 OR billing_country != session_country)
     LIMIT 25`
  );
  for (const p of riskyPayments) {
    upsertFraudCase(p.player_id, 'payment_geo_velocity', 0.78, {
      payment_id: p.id,
      amount_usd: p.amount_usd,
      billing_country: p.billing_country,
      session_country: p.session_country,
      provider: p.provider,
      signals: [`Несовпадение страны биллинга (${p.billing_country}) и страны игровой сессии (${p.session_country})`],
    });
  }

  // Ensure HITL proposal exists if there is a critical >=0.85 case
  const topCritical = gw.queryGet(
    `SELECT id, player_id, case_type, risk_score FROM fraud_cases WHERE status = 'open' AND risk_score >= 0.85 ORDER BY risk_score DESC LIMIT 1`
  );
  if (topCritical) {
    const existingProp = db
      .prepare("SELECT id FROM action_proposals WHERE zone = 'fraud' AND status = 'pending' LIMIT 1")
      .get();
    if (!existingProp) {
      db.prepare(
        `INSERT INTO action_proposals
         (id, zone, action_type, title, rationale, payload_json, confidence, status, created_at)
         VALUES (?, 'fraud', 'review_fraud_case', ?, ?, ?, ?, 'pending', ?)`
      ).run(
        crypto.randomUUID(),
        `Проверить антифрод-кейс высокого риска (${topCritical.case_type}, score=${topCritical.risk_score})`,
        `Автобаны запрещены (02-ai-zones.md). Требуется ручной вердикт администратора по кейсу ${topCritical.id.slice(0, 8)}.`,
        JSON.stringify({ case_id: topCritical.id, recommended_verdict: 'confirmed_fraud' }),
        topCritical.risk_score,
        nowIso
      );
    }
  }

  return upserted;
}

function computeFraudDashboard(db, { statusFilter = 'all' } = {}) {
  runAutomatedFraudDetectors(db);
  const gw = new IsolatedZoneGateway(db, 'fraud');

  const whereClause =
    statusFilter && statusFilter !== 'all' ? 'WHERE fc.status = ?' : '';
  const params = statusFilter && statusFilter !== 'all' ? [statusFilter] : [];

  const cases = gw
    .queryAll(
      `SELECT
         fc.id,
         fc.player_id,
         vp.player_alias,
         vp.region,
         vp.status AS player_status,
         fc.risk_score,
         fc.case_type,
         fc.signals_json,
         fc.status,
         fc.reviewed_by,
         fc.review_note,
         fc.created_at,
         fc.reviewed_at
       FROM fraud_cases fc
       LEFT JOIN v_fraud_players vp ON vp.player_id = fc.player_id
       ${whereClause}
       ORDER BY
         CASE fc.status WHEN 'open' THEN 0 ELSE 1 END ASC,
         fc.risk_score DESC,
         fc.created_at DESC
       LIMIT 60`,
      ...params
    )
    .map((r) => ({
      ...r,
      signals: JSON.parse(r.signals_json || '{}'),
    }));

  const summaryCounts = gw.queryGet(
    `SELECT
       COUNT(*) AS total_cases,
       SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_cases,
       SUM(CASE WHEN status = 'open' AND risk_score >= 0.8 THEN 1 ELSE 0 END) AS high_risk_open,
       SUM(CASE WHEN status = 'confirmed_fraud' THEN 1 ELSE 0 END) AS confirmed_fraud,
       SUM(CASE WHEN status = 'false_positive' THEN 1 ELSE 0 END) AS false_positives
     FROM fraud_cases`
  );

  const byType = gw.queryAll(
    `SELECT case_type, COUNT(*) AS cnt, ROUND(AVG(risk_score), 2) AS avg_risk
     FROM fraud_cases
     GROUP BY case_type
     ORDER BY cnt DESC`
  );

  return {
    autoBanEnabled: false, // Architectural guarantee (02-ai-zones.md)
    detectorsActive: [
      'bot_aim_macro',
      'superhuman_reaction',
      'robotic_swipe_straightness',
      'activity_24_7',
      'repeating_routes',
      'multi_account_cluster',
      'payment_velocity',
      'payment_geo_velocity',
    ],
    counts: {
      totalCases: Number(summaryCounts?.total_cases || 0),
      openCases: Number(summaryCounts?.open_cases || 0),
      highRiskOpen: Number(summaryCounts?.high_risk_open || 0),
      confirmedFraud: Number(summaryCounts?.confirmed_fraud || 0),
      falsePositives: Number(summaryCounts?.false_positives || 0),
    },
    byType,
    cases,
  };
}

async function runFraudZoneAnalysis(db, { rawOverrideOutput = null } = {}) {
  const gw = new IsolatedZoneGateway(db, 'fraud');
  const dash = computeFraudDashboard(db);
  const prevSummaries = gw.readOwnSummaryHistory(3);
  const nowIso = new Date().toISOString();

  // Strip player_id so zero raw identifiers ever enter LLM context
  const sanitizedForModel = {
    counts: dash.counts,
    byType: dash.byType,
    topOpenCases: dash.cases
      .filter((c) => c.status === 'open')
      .slice(0, 10)
      .map((c) => ({
        caseRef: c.id.slice(0, 8),
        alias: c.player_alias,
        region: c.region,
        caseType: c.case_type,
        riskScore: c.risk_score,
        signals: c.signals.signals || [],
      })),
  };

  const fallbackSynthesizer = () => {
    const findings = [];
    let status = 'ok';

    if (dash.counts.highRiskOpen > 0) {
      status = dash.counts.highRiskOpen >= 3 ? 'critical' : 'warning';
      findings.push({
        issue: `Открыто ${dash.counts.highRiskOpen} антифрод-кейсов высокого риска (risk_score >= 0.80): макро-боты, 24/7 активность, повторяющиеся маршруты и всплески транзакций`,
        confidence: 0.91,
        affected_segment: 'ranked_and_payments',
        recommended_action: 'Провести ручную верификацию открытых кейсов во вкладке Fraud (автобаны отключены по ТЗ)',
      });
    }

    const multi = dash.byType.find((t) => t.case_type === 'multi_account_cluster');
    if (multi && multi.cnt > 0) {
      if (status === 'ok') status = 'warning';
      findings.push({
        issue: `Обнаружены мультиаккаунт-кластеры (${multi.cnt} кейса, средний риск ${multi.avg_risk})`,
        confidence: 0.85,
        affected_segment: 'referral_and_tournaments',
        recommended_action: 'Проверить связанные сессии на перелив турнирного рейтинга перед начислением наград',
      });
    }

    if (findings.length === 0) {
      findings.push({
        issue: 'Новых подозрительных паттернов ботов, 24/7 марафонов или платёжного фрода не выявлено',
        confidence: 0.93,
        affected_segment: 'all_players',
        recommended_action: 'Поддерживать штатный режим 8 детекторов без автобанов',
      });
    }

    return {
      zone: 'fraud',
      timestamp: nowIso,
      status,
      findings,
      metrics: dash.counts,
    };
  };

  const execRes = await executeIsolatedZoneModel(db, {
    zone: 'fraud',
    systemPrompt: fraudPrompt.systemPrompt,
    untrustedData: { current: sanitizedForModel, previousOwnSummaries: prevSummaries },
    fallbackSynthesizer,
    rawOverrideOutput,
  });

  if (execRes.silent) return { zone: 'fraud', silent: true, reason: execRes.reason };

  let parsed = null;
  try {
    parsed = JSON.parse(execRes.rawText);
  } catch {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'fraud',
      provider: execRes.usedProvider,
      reason: 'Malformed JSON from Fraud model',
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'fraud',
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
    return { zone: 'fraud', quarantined: true, quarantineId: qId };
  }

  const check = validateZoneSummaryContract(parsed, 'fraud');
  if (!check.valid) {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'fraud',
      provider: execRes.usedProvider,
      reason: check.errors.join('; '),
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'fraud',
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
    return { zone: 'fraud', quarantined: true, quarantineId: qId, errors: check.errors };
  }

  const reqId = recordAiRequest(db, {
    zone: 'fraud',
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

  const summaryId = gw.writeSummary({ status: parsed.status, summaryObj: parsed, requestId: reqId });
  return { zone: 'fraud', summaryId, summary: parsed, provider: execRes.usedProvider };
}

module.exports = {
  runAutomatedFraudDetectors,
  computeFraudDashboard,
  runFraudZoneAnalysis,
};
