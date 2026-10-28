'use strict';

/**
 * Zone 4: Market (Marketing, Retention, Monetization, Cohorts & Economy Balance)
 * (02-ai-zones.md, 15-liveops-content-plan.md)
 * Cadence: Daily at 08:00 UTC.
 * Strict boundary: reads ONLY anonymized `v_market_players`, `marketing_campaigns`,
 * `payments`, `ad_events`, `economy_ledger`, `sessions`, and own `zone_summaries`.
 */

const crypto = require('node:crypto');
const { IsolatedZoneGateway } = require('../../db/isolation');
const { executeIsolatedZoneModel, recordAiRequest } = require('../providers');
const marketPrompt = require('../prompts/market');
const { validateZoneSummaryContract, quarantineInvalidAiOutput } = require('../../security/jsonSchema');

function computeMarketDashboard(db, { periodDays = 30 } = {}) {
  const gw = new IsolatedZoneGateway(db, 'market');
  const days = Math.max(1, Math.min(365, Number(periodDays) || 30));
  const cutoffIso = new Date(Date.now() - days * 86400 * 1000).toISOString();

  const campaigns = gw
    .queryAll(
      `SELECT
         id, source, campaign, creative, spend_usd, impressions, clicks, installs, paying_users,
         d1_retained, d7_retained, d30_retained, revenue_d30_usd
       FROM marketing_campaigns
       ORDER BY spend_usd DESC`
    )
    .map((c) => {
      const installs = Math.max(1, Number(c.installs || 0));
      const payers = Number(c.paying_users || 0);
      const spend = Number(c.spend_usd || 0);
      const rev = Number(c.revenue_d30_usd || 0);
      return {
        ...c,
        cpiUsd: +(spend / installs).toFixed(2),
        cacUsd: payers > 0 ? +(spend / payers).toFixed(2) : null,
        d1Pct: +((Number(c.d1_retained || 0) / installs) * 100).toFixed(1),
        d7Pct: +((Number(c.d7_retained || 0) / installs) * 100).toFixed(1),
        d30Pct: +((Number(c.d30_retained || 0) / installs) * 100).toFixed(1),
        ltvD30Usd: +(rev / installs).toFixed(2),
        roasPct: spend > 0 ? +((rev / spend) * 100).toFixed(1) : null,
        payerConvPct: +((payers / installs) * 100).toFixed(2),
      };
    });

  // Cohorts aggregated by acquisition source (v_market_players + payments)
  const cohortsBySource = gw.queryAll(
    `SELECT
       vp.install_source,
       COUNT(DISTINCT vp.player_id) AS cohort_users,
       COUNT(DISTINCT CASE WHEN p.status = 'succeeded' THEN p.player_id END) AS cohort_payers,
       ROUND(COALESCE(SUM(CASE WHEN p.status = 'succeeded' THEN p.amount_usd ELSE 0 END), 0), 2) AS cohort_iap_usd
     FROM v_market_players vp
     LEFT JOIN payments p ON p.player_id = vp.player_id
     GROUP BY vp.install_source
     ORDER BY cohort_users DESC`
  );

  const playerCounts = gw.queryGet(`SELECT COUNT(*) AS mau FROM v_market_players`);
  const dauRow = gw.queryGet(
    `SELECT COUNT(DISTINCT player_id) AS dau
     FROM sessions
     WHERE started_at >= datetime('now', '-1 day')`
  );

  const iapAgg = gw.queryGet(
    `SELECT
       COUNT(DISTINCT player_id) AS unique_payers,
       COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_usd ELSE 0 END), 0) AS iap_revenue_usd,
       COUNT(*) AS tx_count
     FROM payments
     WHERE created_at >= ?`,
    cutoffIso
  );

  const adAgg = gw.queryGet(
    `SELECT
       COUNT(*) AS impressions,
       SUM(rewarded) AS rewarded_views,
       COALESCE(SUM(revenue_usd), 0) AS ad_revenue_usd
     FROM ad_events
     WHERE created_at >= ?`,
    cutoffIso
  );

  const economyFlow = gw.queryAll(
    `SELECT
       currency,
       flow_type,
       reason,
       SUM(amount) AS total_amount,
       COUNT(*) AS events_count
     FROM economy_ledger
     WHERE created_at >= ?
     GROUP BY currency, flow_type, reason
     ORDER BY currency, flow_type, total_amount DESC`,
    cutoffIso
  );

  let coinsSource = 0;
  let coinsSink = 0;
  let gemsSource = 0;
  let gemsSink = 0;
  for (const row of economyFlow) {
    if (row.currency === 'coins') {
      if (row.flow_type === 'source') coinsSource += Number(row.total_amount || 0);
      else coinsSink += Number(row.total_amount || 0);
    } else if (row.currency === 'gems') {
      if (row.flow_type === 'source') gemsSource += Number(row.total_amount || 0);
      else gemsSink += Number(row.total_amount || 0);
    }
  }

  const mau = Math.max(1, Number(playerCounts?.mau || 1));
  const dau = Math.max(1, Number(dauRow?.dau || Math.round(mau * 0.34)));
  const uniquePayers = Number(iapAgg?.unique_payers || 0);
  const iapRevenueUsd = +Number(iapAgg?.iap_revenue_usd || 0).toFixed(2);
  const adRevenueUsd = +Number(adAgg?.ad_revenue_usd || 0).toFixed(2);
  const totalRevenueUsd = +(iapRevenueUsd + adRevenueUsd).toFixed(2);

  const totalSpendUsd = +campaigns.reduce((s, c) => s + Number(c.spend_usd || 0), 0).toFixed(2);
  const totalInstalls = campaigns.reduce((s, c) => s + Number(c.installs || 0), 0);
  const totalCampaignRev = +campaigns.reduce((s, c) => s + Number(c.revenue_d30_usd || 0), 0).toFixed(2);
  const adImpressions = Number(adAgg?.impressions || 0);

  const kpis = {
    mau,
    dau,
    stickinessPct: +((dau / mau) * 100).toFixed(1),
    iapRevenueUsd,
    adRevenueUsd,
    totalRevenueUsd,
    totalSpendUsd,
    blendedCpiUsd: totalInstalls > 0 ? +(totalSpendUsd / totalInstalls).toFixed(2) : 0,
    blendedCacUsd: uniquePayers > 0 ? +(totalSpendUsd / uniquePayers).toFixed(2) : 0,
    arpuUsd: +(totalRevenueUsd / mau).toFixed(2),
    arppuUsd: uniquePayers > 0 ? +(iapRevenueUsd / uniquePayers).toFixed(2) : 0,
    arpdauUsd: +(totalRevenueUsd / dau).toFixed(2),
    payerConversionPct: +((uniquePayers / mau) * 100).toFixed(2),
    blendedRoasPct: totalSpendUsd > 0 ? +((totalCampaignRev / totalSpendUsd) * 100).toFixed(1) : 100,
    ecpmUsd: adImpressions > 0 ? +((adRevenueUsd / adImpressions) * 1000).toFixed(2) : 0,
  };

  const coinSinkRatio = coinsSource > 0 ? +(coinsSink / coinsSource).toFixed(2) : 1;
  const gemSinkRatio = gemsSource > 0 ? +(gemsSink / gemsSource).toFixed(2) : 1;

  return {
    periodDays: days,
    kpis,
    campaigns,
    cohortsBySource,
    economy: {
      coinsSource,
      coinsSink,
      coinSinkRatio,
      gemsSource,
      gemsSink,
      gemSinkRatio,
      ledgerBreakdown: economyFlow,
    },
  };
}

function ensureMarketProposalIfNeeded(db, dash) {
  const losing = dash.campaigns.find((c) => c.spend_usd > 100 && c.roasPct !== null && c.roasPct < 75);
  if (!losing) return;
  const existing = db
    .prepare("SELECT id FROM action_proposals WHERE zone = 'market' AND status = 'pending' LIMIT 1")
    .get();
  if (existing) return;

  db.prepare(
    `INSERT INTO action_proposals
     (id, zone, action_type, title, rationale, payload_json, confidence, status, created_at)
     VALUES (?, 'market', 'pause_negative_roas_campaign', ?, ?, ?, ?, 'pending', ?)`
  ).run(
    crypto.randomUUID(),
    `Остановить убыточную кампанию ${losing.campaign} (${losing.source}, ROAS ${losing.roasPct}%)`,
    `Расход $${losing.spend_usd}, CPI $${losing.cpiUsd}, D7=${losing.d7Pct}%. ИИ не меняет бюджеты напрямую — требуется подтверждение владельца.`,
    JSON.stringify({ campaign_id: losing.id, campaign: losing.campaign, recommended_spend_usd: 0 }),
    0.89,
    new Date().toISOString()
  );
}

async function runMarketZoneAnalysis(db, { rawOverrideOutput = null } = {}) {
  const gw = new IsolatedZoneGateway(db, 'market');
  const dash = computeMarketDashboard(db, { periodDays: 30 });
  const prevSummaries = gw.readOwnSummaryHistory(3);
  const nowIso = new Date().toISOString();

  const fallbackSynthesizer = () => {
    const findings = [];
    let status = 'ok';

    const losingCampaigns = dash.campaigns.filter((c) => c.spend_usd > 50 && c.roasPct !== null && c.roasPct < 80);
    if (losingCampaigns.length > 0) {
      status = 'warning';
      const worst = losingCampaigns[0];
      findings.push({
        issue: `Кампания '${worst.campaign}' (${worst.source}/${worst.creative}) имеет убыточный ROAS ${worst.roasPct}% при CPI $${worst.cpiUsd}`,
        confidence: 0.9,
        affected_segment: `${worst.source}_${worst.campaign}`,
        recommended_action: 'Подтвердить остановку креатива в блоке HITL и перераспределить бюджет в Telegram Ads / органические посевы',
      });
    }

    if (dash.economy.coinSinkRatio < 0.65) {
      if (status === 'ok') status = 'warning';
      findings.push({
        issue: `Инфляция мягкой валюты (coins): отношение sink/source = ${dash.economy.coinSinkRatio} (вывод меньше притока)`,
        confidence: 0.86,
        affected_segment: 'soft_currency_economy',
        recommended_action: 'Добавить косметические sink-события (турнирные взносы монетами или кастомные накладки без Pay-to-Win)',
      });
    }

    if (findings.length === 0) {
      findings.push({
        issue: `Юнит-экономика сбалансирована: ROAS ${dash.kpis.blendedRoasPct}%, ARPPU $${dash.kpis.arppuUsd}, eCPM $${dash.kpis.ecpmUsd}`,
        confidence: 0.89,
        affected_segment: 'all_cohorts',
        recommended_action: 'Масштабировать лучшие креативы с D7 удержанием > 22%',
      });
    }

    return {
      zone: 'market',
      timestamp: nowIso,
      status,
      findings,
      metrics: dash.kpis,
    };
  };

  const execRes = await executeIsolatedZoneModel(db, {
    zone: 'market',
    systemPrompt: marketPrompt.systemPrompt,
    untrustedData: { current: dash, previousOwnSummaries: prevSummaries },
    fallbackSynthesizer,
    rawOverrideOutput,
  });

  if (execRes.silent) return { zone: 'market', silent: true, reason: execRes.reason };

  let parsed = null;
  try {
    parsed = JSON.parse(execRes.rawText);
  } catch {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'market',
      provider: execRes.usedProvider,
      reason: 'Malformed JSON from Market model',
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'market',
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
    return { zone: 'market', quarantined: true, quarantineId: qId };
  }

  const check = validateZoneSummaryContract(parsed, 'market');
  if (!check.valid) {
    const qId = quarantineInvalidAiOutput(db, {
      zone: 'market',
      provider: execRes.usedProvider,
      reason: check.errors.join('; '),
      rawOutput: execRes.rawText,
    });
    recordAiRequest(db, {
      zone: 'market',
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
    return { zone: 'market', quarantined: true, quarantineId: qId, errors: check.errors };
  }

  const reqId = recordAiRequest(db, {
    zone: 'market',
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

  ensureMarketProposalIfNeeded(db, dash);
  const summaryId = gw.writeSummary({ status: parsed.status, summaryObj: parsed, requestId: reqId });
  return { zone: 'market', summaryId, summary: parsed, provider: execRes.usedProvider };
}

module.exports = {
  computeMarketDashboard,
  runMarketZoneAnalysis,
};
