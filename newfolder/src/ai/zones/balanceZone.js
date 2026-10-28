'use strict';

/**
 * Zone 3: Balance (Input Oval, 6-Zone Table Difficulty, MATCH_RULES v4, Grip/Hand) — 02-ai-zones.md
 * Cadence: Every 6 hours.
 * Strict boundary: reads ONLY input_events, match_rules_versions, anonymized v_balance_players, own zone_summaries.
 */

const crypto = require('node:crypto');
const { MATCH_RULES_V4, TABLE_ZONES, PRESS_REJECTION_REASONS } = require('../../config');
const { IsolatedZoneGateway } = require('../../db/isolation');
const { executeIsolatedZoneModel, recordAiRequest } = require('../providers');
const balancePrompt = require('../prompts/balance');
const { validateZoneSummaryContract, quarantineInvalidAiOutput } = require('../../security/jsonSchema');

function computeBalanceDashboard(db, { periodDays = 30 } = {}) {
  const gw = new IsolatedZoneGateway(db, 'balance');
  const days = Math.max(1, Math.min(90, Number(periodDays) || 30));
  const cutoffIso = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const activeRuleRow = gw.queryGet(
    'SELECT version, rules_json, comment, created_by, created_at FROM match_rules_versions WHERE is_active = 1 ORDER BY version DESC LIMIT 1'
  );
  const activeRules = activeRuleRow ? JSON.parse(activeRuleRow.rules_json) : MATCH_RULES_V4;

  const history = gw
    .queryAll(
      'SELECT version, is_active, comment, created_by, created_at, rules_json FROM match_rules_versions ORDER BY version DESC LIMIT 10'
    )
    .map((r) => ({
      ...r,
      rules: JSON.parse(r.rules_json),
    }));

  const overall = gw.queryGet(
    `SELECT
       COUNT(*) AS total_presses,
       SUM(accepted) AS accepted_presses,
       SUM(contact) AS contact_hits,
       SUM(is_grace) AS grace_hits,
       SUM(CASE WHEN has_fresh_swipe = 0 THEN 1 ELSE 0 END) AS missing_fresh_swipes,
       ROUND(AVG(CASE WHEN accepted = 1 THEN ball_speed END), 2) AS avg_ball_speed_ms,
       ROUND(AVG(CASE WHEN accepted = 1 THEN ABS(spin) END), 1) AS avg_spin_rad_s,
       ROUND(AVG(reaction_ms), 1) AS avg_reaction_ms
     FROM input_events
     WHERE ts >= ?`,
    cutoffIso
  );

  // Breakdown by pointer_type + grip + hand (02-ai-zones.md)
  const bySegment = gw.queryAll(
    `SELECT
       pointer_type,
       grip,
       hand,
       COUNT(*) AS presses,
       ROUND(AVG(accepted) * 100, 1) AS accept_rate_pct,
       ROUND(AVG(contact) * 100, 1) AS contact_rate_pct,
       ROUND(AVG(CASE WHEN reject_code = 'OUTSIDE_ZONE' THEN 1.0 ELSE 0.0 END) * 100, 1) AS outside_zone_pct,
       ROUND(AVG(CASE WHEN reject_code = 'NO_FRESH_SWIPE' THEN 1.0 ELSE 0.0 END) * 100, 1) AS no_fresh_swipe_pct,
       ROUND(AVG(reaction_ms), 1) AS avg_reaction_ms
     FROM input_events
     WHERE ts >= ?
     GROUP BY pointer_type, grip, hand
     ORDER BY presses DESC`,
    cutoffIso
  );

  // 6-Zone Table Difficulty Matrix (short_bh, short_mid, short_fh, deep_bh, deep_mid, deep_fh) — 02-ai-zones.md
  const rawZoneRows = gw.queryAll(
    `SELECT
       table_zone,
       COUNT(*) AS total_shots,
       ROUND(AVG(accepted) * 100, 1) AS accept_rate_pct,
       ROUND(AVG(contact) * 100, 1) AS contact_rate_pct,
       ROUND((1.0 - AVG(contact)) * 100, 1) AS difficulty_index,
       ROUND(AVG(CASE WHEN accepted = 1 THEN ball_speed END), 2) AS avg_ball_speed_ms,
       ROUND(AVG(reaction_ms), 1) AS avg_reaction_ms
     FROM input_events
     WHERE ts >= ?
     GROUP BY table_zone`,
    cutoffIso
  );
  const zoneMap = new Map(rawZoneRows.map((z) => [z.table_zone, z]));
  const tableZoneDifficulty = TABLE_ZONES.map((zoneKey) => {
    const z = zoneMap.get(zoneKey) || {
      table_zone: zoneKey,
      total_shots: 0,
      accept_rate_pct: 0,
      contact_rate_pct: 0,
      difficulty_index: 0,
      avg_ball_speed_ms: 0,
      avg_reaction_ms: 0,
    };
    const topRej = gw.queryGet(
      `SELECT reject_code, COUNT(*) AS cnt
       FROM input_events
       WHERE table_zone = ? AND accepted = 0 AND reject_code IS NOT NULL AND ts >= ?
       GROUP BY reject_code
       ORDER BY cnt DESC
       LIMIT 1`,
      zoneKey,
      cutoffIso
    );
    return {
      ...z,
      top_reject_code: topRej ? topRej.reject_code : null,
    };
  });

  // 2D binned heatmap across along [-180..180] and across [-130..130] (step 20 px)
  const heatmapBins = gw.queryAll(
    `SELECT
       CAST(ROUND(along / 20.0) * 20 AS INTEGER) AS bin_along,
       CAST(ROUND(across / 20.0) * 20 AS INTEGER) AS bin_across,
       COUNT(*) AS total,
       SUM(accepted) AS accepted_cnt,
       SUM(CASE WHEN accepted = 0 THEN 1 ELSE 0 END) AS rejected_cnt
     FROM input_events
     WHERE ts >= ?
     GROUP BY bin_along, bin_across
     ORDER BY total DESC
     LIMIT 160`,
    cutoffIso
  );

  const rejectDistribution = gw.queryAll(
    `SELECT reject_code, COUNT(*) AS count
     FROM input_events
     WHERE accepted = 0 AND reject_code IS NOT NULL AND ts >= ?
     GROUP BY reject_code
     ORDER BY count DESC`,
    cutoffIso
  );

  const totalPresses = Number(overall?.total_presses || 0);
  const acceptRatePct = totalPresses > 0 ? +(((overall.accepted_presses || 0) / totalPresses) * 100).toFixed(1) : 0;
  const contactRatePct = totalPresses > 0 ? +(((overall.contact_hits || 0) / totalPresses) * 100).toFixed(1) : 0;

  return {
    periodDays: days,
    activeVersion: activeRuleRow ? activeRuleRow.version : 4,
    activeRules,
    rulesFieldCount: Object.keys(activeRules).length,
    canonicalRejectReasons: PRESS_REJECTION_REASONS,
    rulesHistory: history,
    totals: {
      totalPresses,
      acceptRatePct,
      contactRatePct,
      graceHits: Number(overall?.grace_hits || 0),
      missingFreshSwipes: Number(overall?.missing_fresh_swipes || 0),
      avgBallSpeedMs: Number(overall?.avg_ball_speed_ms || 0),
      avgSpinRadS: Number(overall?.avg_spin_rad_s || 0),
      avgReactionMs: Number(overall?.avg_reaction_ms || 0),
    },
    bySegment,
    tableZoneDifficulty,
    heatmapBins,
    rejectDistribution,
  };
}

async function runBalanceZoneAnalysis(db, { rawOverrideOutput = null } = {}) {
  const gw = new IsolatedZoneGateway(db, 'balance');
  const dash = computeBalanceDashboard(db, { periodDays: 30 });
  const prevSummaries = gw.readOwnSummaryHistory(3);
  const nowIso = new Date().toISOString();

  const touchSegments = dash.bySegment.filter((s) => s.pointer_type === 'touch');
  const worstTouch = touchSegments.sort((a, b) => b.outside_zone_pct - a.outside_zone_pct)[0];
  const hardestZone = [...dash.tableZoneDifficulty].sort((a, b) => b.difficulty_index - a.difficulty_index)[0];

  if (worstTouch && worstTouch.outside_zone_pct >= 22) {
    const existingPending = db
      .prepare("SELECT id FROM action_proposals WHERE zone = 'balance' AND status = 'pending' LIMIT 1")
      .get();
    if (!existingPending) {
      const currentAlong = Number(dash.activeRules.ovalForwardMaxPx || 120);
      const currentSide = Number(dash.activeRules.contactSideTouchPx || 64);
      const proposedPatch = {
        ovalForwardMaxPx: Math.min(136, currentAlong + 8),
        contactSideTouchPx: Math.min(76, currentSide + 6),
      };
      db.prepare(
        `INSERT INTO action_proposals
         (id, zone, action_type, title, rationale, payload_json, confidence, status, created_at)
         VALUES (?, 'balance', 'propose_match_rules', ?, ?, ?, ?, 'pending', ?)`
      ).run(
        crypto.randomUUID(),
        `Расширить touch-овал (${currentAlong}x${currentSide} -> ${proposedPatch.ovalForwardMaxPx}x${proposedPatch.contactSideTouchPx})`,
        `Сегмент ${worstTouch.pointer_type}/${worstTouch.grip}/${worstTouch.hand} даёт ${worstTouch.outside_zone_pct}% OUTSIDE_ZONE; самая сложная зона стола — ${hardestZone ? hardestZone.table_zone : 'deep_bh'}. Единые честные правила без Pay-to-Win.`,
        JSON.stringify({ rulesPatch: proposedPatch }),
        0.87,
        nowIso
      );
    }
  }

  const fallbackSynthesizer = () => {
    const findings = [];
    let status = 'ok';

    if (worstTouch && worstTouch.outside_zone_pct >= 22) {
      status = 'warning';
      findings.push({
        issue: `Высокая доля OUTSIDE_ZONE (${worstTouch.outside_zone_pct}%) на мобильном сегменте ${worstTouch.pointer_type}/${worstTouch.grip}/${worstTouch.hand}`,
        confidence: 0.88,
        affected_segment: `${worstTouch.pointer_type}_${worstTouch.grip}_${worstTouch.hand}`,
        recommended_action: 'Проверить в Lab или подтвердить предложение об увеличении ovalAlongTouch/ovalAcrossTouch на +6..8 пкс',
      });
    }

    if (hardestZone && hardestZone.total_shots >= 15 && hardestZone.difficulty_index >= 35) {
      if (status === 'ok') status = 'warning';
      findings.push({
        issue: `Зона стола ${hardestZone.table_zone} имеет повышенный индекс сложности ${hardestZone.difficulty_index}% (контакт ${hardestZone.contact_rate_pct}%, частый отказ: ${hardestZone.top_reject_code || 'OUTSIDE_ZONE'})`,
        confidence: 0.85,
        affected_segment: `table_zone_${hardestZone.table_zone}`,
        recommended_action: 'Сопоставить тайминг подлёта и reachGracePx для дальних/коротких углов в стенде `npm run noise`',
      });
    }

    const penholdLeft = dash.bySegment.find((s) => s.grip === 'penhold' && s.hand === 'left');
    if (penholdLeft && penholdLeft.accept_rate_pct < dash.totals.acceptRatePct - 8) {
      if (status === 'ok') status = 'warning';
      findings.push({
        issue: `Просадка принятых ударов у левшей с хватом перо (${penholdLeft.accept_rate_pct}% против среднего ${dash.totals.acceptRatePct}%)`,
        confidence: 0.82,
        affected_segment: 'penhold_left',
        recommended_action: 'Проверить симметрию углов ракетки для left-hand penhold в будущем рерайте клиента',
      });
    }

    if (findings.length === 0) {
      findings.push({
        issue: `Глобальный баланс MATCH_RULES v${dash.activeVersion} стабилен (принятие ${dash.totals.acceptRatePct}%, контакт ${dash.totals.contactRatePct}%)`,
        confidence: 0.91,
        affected_segment: 'all_segments',
        recommended_action: 'Продолжать сбор теплокарты along/across и матрицы 6 зон стола',
      });
    }

    return {
      zone: 'balance',
      timestamp: nowIso,
      status,
      findings,
      metrics: dash.totals,
    };
  };

  const execRes = await executeIsolatedZoneModel(db, {
    zone: 'balance',
    systemPrompt: balancePrompt.systemPrompt,
    untrustedData: {
      activeVersion: dash.activeVersion,
      totals: dash.totals,
      bySegment: dash.bySegment,
      tableZoneDifficulty: dash.tableZoneDifficulty,
      rejectDistribution: dash.rejectDistribution,
      previousOwnSummaries: prevSummaries,
    },
    fallbackSynthesizer,
    rawOverrideOutput,
  });

  if (execRes.silent) return { zone: 'balance', silent: true, reason: execRes.reason };

  let parsed = null;
  try {
    parsed = JSON.parse(execRes.rawText);
  } catch {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'balance',
      provider: execRes.usedProvider,
      reason: 'Malformed JSON from Balance model',
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'balance',
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
    return { zone: 'balance', quarantined: true, quarantineId: qId };
  }

  const check = validateZoneSummaryContract(parsed, 'balance');
  if (!check.valid) {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'balance',
      provider: execRes.usedProvider,
      reason: check.errors.join('; '),
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'balance',
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
    return { zone: 'balance', quarantined: true, quarantineId: qId, errors: check.errors };
  }

  const reqId = recordAiRequest(db, {
    zone: 'balance',
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
  return { zone: 'balance', summaryId, summary: parsed, provider: execRes.usedProvider };
}

module.exports = {
  computeBalanceDashboard,
  runBalanceZoneAnalysis,
};
