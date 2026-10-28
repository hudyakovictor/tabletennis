'use strict';

/**
 * Isolated Per-Zone AI Provider Client (07-ai-providers.md)
 *
 * Key Architectural Principles:
 * - No shared AI Router at launch: each zone resolves its own isolated API key, prompt, model, and daily cap.
 * - Strict daily token caps: Ops 100k, Fraud 200k, Balance 300k, Market 200k, Lab 500k.
 *   When daily tokens >= limit, the zone stays silent until UTC midnight (`status = 'budget_exceeded'`).
 * - Tracks `prompt_tokens`, `cached_tokens` (prompt cache >=90% discount on static `[SYSTEM]` header),
 *   `completion_tokens`, `is_batch` (50% Batch API discount for `lab`), and `zero_retention` flag.
 * - Supports sanctions-resilient failover chain (`primary -> fallbackProvider -> local_statistical`)
 *   across YandexGPT, GigaChat, Ollama/vLLM, OpenRouter, NVIDIA NIM, GPT4Free, and deterministic local stats.
 */

const crypto = require('node:crypto');
const { CONFIG, AI_ZONES } = require('../config');
const { buildIsolatedDataBlock } = require('../security/promptGuard');
const { decryptSecret, encryptSecret, fingerprintSecret, maskSecret, validateProviderKey } = require('../security/secrets');

const PROVIDER_ENDPOINTS = Object.freeze({
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  gpt4free: process.env.GPT4FREE_BASE_URL || 'http://127.0.0.1:1337/v1/chat/completions',
  ollama: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434/v1/chat/completions',
  vllm: process.env.VLLM_BASE_URL || 'http://127.0.0.1:8000/v1/chat/completions',
  yandexgpt: 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion',
  gigachat: 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions',
});

function estimateTokens(text) {
  return Math.max(12, Math.ceil(String(text || '').length / 3.8));
}

/**
 * Resolves the effective key for a zone. Precedence is deliberate:
 * `env` (secret manager / orchestrator) → `vault` (encrypted in ai_zone_configs) → none.
 * `keySource` is part of the contract so an operator can see *why* a rotation did
 * not change behaviour, instead of guessing.
 */
function resolveZoneKey(staticCfg, row) {
  if (staticCfg.apiKey) {
    return {
      apiKey: staticCfg.apiKey,
      keySource: 'env',
      keyFingerprint: fingerprintSecret(staticCfg.apiKey),
      keyMasked: maskSecret(staticCfg.apiKey),
      keyUpdatedAt: null,
    };
  }
  const decrypted = decryptSecret(row ? row.api_key_encrypted : null);
  if (decrypted) {
    return {
      apiKey: decrypted,
      keySource: 'vault',
      keyFingerprint: row.api_key_fingerprint || fingerprintSecret(decrypted),
      keyMasked: maskSecret(decrypted),
      keyUpdatedAt: row.api_key_updated_at || null,
    };
  }
  return { apiKey: '', keySource: 'none', keyFingerprint: null, keyMasked: null, keyUpdatedAt: null };
}

function getZoneRuntimeConfig(db, zone) {
  const staticCfg = AI_ZONES[zone];
  if (!staticCfg) throw new Error(`Unknown AI zone: ${zone}`);
  const row = db
    .prepare(
      `SELECT zone, provider, fallback_provider, model, daily_token_limit, zero_retention, batch_mode, enabled,
              api_key_encrypted, api_key_fingerprint, api_key_updated_at, api_key_updated_by, updated_at
         FROM ai_zone_configs WHERE zone = ?`
    )
    .get(zone);
  const key = resolveZoneKey(staticCfg, row);
  return {
    zone,
    role: staticCfg.role,
    title: staticCfg.title,
    cadence: staticCfg.cadence,
    provider: row ? row.provider : staticCfg.provider,
    fallbackProvider: row ? row.fallback_provider : staticCfg.fallbackProvider || 'local_statistical',
    model: row ? row.model : staticCfg.model,
    dailyTokenLimit: row ? Number(row.daily_token_limit) : staticCfg.dailyTokenLimit,
    zeroRetention: row ? Boolean(row.zero_retention) : Boolean(staticCfg.zeroRetention),
    batchMode: row ? Boolean(row.batch_mode) : Boolean(staticCfg.batchMode),
    enabled: row ? Boolean(row.enabled) : true,
    apiKey: key.apiKey,
    hasApiKey: Boolean(key.apiKey),
    keySource: key.keySource,
    keyFingerprint: key.keyFingerprint,
    keyMasked: key.keyMasked,
    keyUpdatedAt: key.keyUpdatedAt,
    keyUpdatedBy: row ? row.api_key_updated_by || null : null,
  };
}

function getZoneDailyUsage(db, zone, referenceDate = new Date()) {
  const dayStart = new Date(
    Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate())
  ).toISOString();
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(prompt_tokens + completion_tokens), 0) AS used_tokens,
         COALESCE(SUM(cached_tokens), 0) AS cached_tokens,
         COALESCE(SUM(cost_usd), 0) AS cost_usd,
         SUM(CASE WHEN is_batch = 1 THEN 1 ELSE 0 END) AS batch_calls,
         COUNT(*) AS calls_count
       FROM ai_requests
       WHERE zone = ? AND created_at >= ? AND status IN ('ok', 'quarantined')`
    )
    .get(zone, dayStart);
  return {
    dayStart,
    usedTokens: Number(row?.used_tokens || 0),
    cachedTokens: Number(row?.cached_tokens || 0),
    costUsd: +Number(row?.cost_usd || 0).toFixed(6),
    batchCalls: Number(row?.batch_calls || 0),
    callsCount: Number(row?.calls_count || 0),
  };
}

function recordAiRequest(
  db,
  {
    zone,
    provider,
    model,
    promptTokens,
    cachedTokens = 0,
    completionTokens,
    isBatch = false,
    zeroRetention = true,
    fallbackUsed = false,
    costUsd,
    status,
  }
) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ai_requests
     (id, zone, region, provider, model, prompt_tokens, cached_tokens, completion_tokens,
      is_batch, zero_retention, fallback_used, cost_usd, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    zone,
    CONFIG.primaryRegion,
    provider,
    model,
    Math.round(promptTokens || 0),
    Math.round(cachedTokens || 0),
    Math.round(completionTokens || 0),
    isBatch ? 1 : 0,
    zeroRetention ? 1 : 0,
    fallbackUsed ? 1 : 0,
    Number(costUsd || 0),
    status,
    new Date().toISOString()
  );
  return id;
}

async function tryCallExternalProvider(providerName, cfg, systemPrompt, userBlock) {
  const endpoint = PROVIDER_ENDPOINTS[providerName];
  if (!endpoint) throw new Error(`No endpoint for provider '${providerName}'`);
  const isLocalOpenSource = providerName === 'ollama' || providerName === 'vllm' || providerName === 'gpt4free';
  if (!cfg.apiKey && !isLocalOpenSource) {
    throw new Error(`Missing isolated API key for zone '${cfg.zone}' on provider '${providerName}'`);
  }

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = `Bearer ${cfg.apiKey}`;
  if (cfg.zeroRetention) {
    headers['X-Data-Retention'] = 'none';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userBlock },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty completion content');
  return content;
}

/**
 * Executes an isolated zone/director AI call:
 * 1. Enforces zone enabled & strict daily token cap (silent on exhaustion).
 * 2. Scrubs PII & builds isolated `<UNTRUSTED_DATA_JSON>` prompt (`customFormattedPrompt` supported for Director).
 * 3. Runs `primary -> fallbackProvider -> local_statistical` chain.
 * 4. Computes prompt-cache (`cachedTokens` at 10% rate) & Batch API (`isBatch` 50% discount) cost.
 */
async function executeIsolatedZoneModel(
  db,
  { zone, systemPrompt, untrustedData, customFormattedPrompt = null, fallbackSynthesizer, rawOverrideOutput = null }
) {
  const cfg = getZoneRuntimeConfig(db, zone);
  const usage = getZoneDailyUsage(db, zone);

  if (!cfg.enabled) {
    return { silent: true, reason: 'zone_disabled', cfg, usage };
  }
  if (usage.usedTokens >= cfg.dailyTokenLimit) {
    recordAiRequest(db, {
      zone,
      provider: cfg.provider,
      model: cfg.model,
      promptTokens: 0,
      completionTokens: 0,
      isBatch: cfg.batchMode,
      zeroRetention: cfg.zeroRetention,
      costUsd: 0,
      status: 'budget_exceeded',
    });
    return { silent: true, reason: 'daily_token_limit_reached', cfg, usage };
  }

  const dataBlock = buildIsolatedDataBlock(untrustedData);
  const fullPrompt = customFormattedPrompt || `[SYSTEM]\n${systemPrompt}\n\n[DATA]\n${dataBlock}`;
  const systemTokens = estimateTokens(systemPrompt);
  const promptTokens = estimateTokens(fullPrompt);
  // Prompt cache: after first call of the day, ~90% of static [SYSTEM] header hits cache (10% cost per 07-ai-providers.md)
  const cachedTokens = usage.callsCount > 0 ? Math.floor(systemTokens * 0.9) : 0;

  if (usage.usedTokens + promptTokens > cfg.dailyTokenLimit) {
    recordAiRequest(db, {
      zone,
      provider: cfg.provider,
      model: cfg.model,
      promptTokens: 0,
      completionTokens: 0,
      isBatch: cfg.batchMode,
      zeroRetention: cfg.zeroRetention,
      costUsd: 0,
      status: 'budget_exceeded',
    });
    return { silent: true, reason: 'daily_token_limit_reached', cfg, usage };
  }

  let rawText = null;
  let usedProvider = cfg.provider;
  let fallbackUsed = false;

  if (rawOverrideOutput !== null) {
    rawText = typeof rawOverrideOutput === 'string' ? rawOverrideOutput : JSON.stringify(rawOverrideOutput);
  } else if (cfg.provider !== 'local_statistical') {
    try {
      rawText = await tryCallExternalProvider(cfg.provider, cfg, systemPrompt, dataBlock);
    } catch {
      fallbackUsed = true;
      if (cfg.fallbackProvider && cfg.fallbackProvider !== 'local_statistical' && cfg.fallbackProvider !== cfg.provider) {
        try {
          rawText = await tryCallExternalProvider(cfg.fallbackProvider, cfg, systemPrompt, dataBlock);
          usedProvider = `${cfg.provider}->${cfg.fallbackProvider}`;
        } catch {
          usedProvider = `${cfg.provider}->local_statistical`;
          rawText = JSON.stringify(fallbackSynthesizer());
        }
      } else {
        usedProvider = `${cfg.provider}->local_statistical`;
        rawText = JSON.stringify(fallbackSynthesizer());
      }
    }
  } else {
    usedProvider = 'local_statistical';
    rawText = JSON.stringify(fallbackSynthesizer());
  }

  const completionTokens = estimateTokens(rawText);
  const isLocalFree = usedProvider === 'local_statistical' || usedProvider.endsWith('->local_statistical') || usedProvider === 'ollama';
  const baseRatePer1k = isLocalFree ? 0 : 0.00045;
  const uncachedPromptTokens = Math.max(0, promptTokens - cachedTokens);
  // Cached prompt tokens billed at 10% rate; Batch API (`lab`) receives 50% discount (07-ai-providers.md)
  const batchDiscountMul = cfg.batchMode ? 0.5 : 1.0;
  const costUsd = +(
    (((uncachedPromptTokens + cachedTokens * 0.1 + completionTokens) / 1000) *
      baseRatePer1k *
      batchDiscountMul)
  ).toFixed(6);

  return {
    silent: false,
    rawText,
    promptPreview: fullPrompt,
    usedProvider,
    model: cfg.model,
    promptTokens,
    cachedTokens,
    completionTokens,
    isBatch: cfg.batchMode,
    zeroRetention: cfg.zeroRetention,
    fallbackUsed,
    costUsd,
    cfg,
  };
}

function listAllZonesStatus(db) {
  return Object.keys(AI_ZONES).map((zone) => {
    const cfg = getZoneRuntimeConfig(db, zone);
    const usage = getZoneDailyUsage(db, zone);
    const latest =
      zone !== 'director'
        ? db
            .prepare('SELECT status, summary_json, created_at FROM zone_summaries WHERE zone = ? ORDER BY created_at DESC LIMIT 1')
            .get(zone)
        : null;
    return {
      ...cfg,
      apiKey: undefined, // Never leak API keys — only source/fingerprint/mask leave the process.
      usedTokens: usage.usedTokens,
      cachedTokensToday: usage.cachedTokens,
      remainingTokens: Math.max(0, cfg.dailyTokenLimit - usage.usedTokens),
      utilizationPct: +((usage.usedTokens / Math.max(1, cfg.dailyTokenLimit)) * 100).toFixed(1),
      costUsdToday: usage.costUsd,
      callsToday: usage.callsCount,
      batchCallsToday: usage.batchCalls,
      latestStatus: latest ? latest.status : 'ok',
      latestSummaryAt: latest ? latest.created_at : null,
    };
  });
}

function updateZoneConfig(db, zone, { provider, fallbackProvider, model, dailyTokenLimit, zeroRetention, batchMode, enabled, apiKey, clearApiKey, actorUsername }) {
  const allowedProviders = new Set([
    'local_statistical',
    'openrouter',
    'nvidia',
    'gpt4free',
    'yandexgpt',
    'gigachat',
    'ollama',
    'vllm',
  ]);
  const current = getZoneRuntimeConfig(db, zone);
  const nextProvider = allowedProviders.has(provider) ? provider : current.provider;
  const nextFallback = allowedProviders.has(fallbackProvider) ? fallbackProvider : current.fallbackProvider;
  const nextModel = model ? String(model).slice(0, 80) : current.model;
  const nextLimit =
    Number.isFinite(Number(dailyTokenLimit)) && Number(dailyTokenLimit) >= 0
      ? Math.round(Number(dailyTokenLimit))
      : current.dailyTokenLimit;
  const nextZeroRet = zeroRetention === undefined ? (current.zeroRetention ? 1 : 0) : zeroRetention ? 1 : 0;
  const nextBatch = batchMode === undefined ? (current.batchMode ? 1 : 0) : batchMode ? 1 : 0;
  const nextEnabled = enabled === undefined ? (current.enabled ? 1 : 0) : enabled ? 1 : 0;

  const nowIso = new Date().toISOString();

  // Key rotation is a separate concern from tuning the zone: validate before any
  // write, so a rejected key never leaves the zone half-updated.
  let keyWrite = null;
  if (clearApiKey) {
    keyWrite = { encrypted: null, fingerprint: null, from: current.keyFingerprint, action: 'cleared' };
  } else if (apiKey !== undefined && apiKey !== null && String(apiKey).trim() !== '') {
    const check = validateProviderKey(apiKey);
    if (!check.ok) {
      const err = new Error(check.message);
      err.code = check.error;
      throw err;
    }
    keyWrite = {
      encrypted: encryptSecret(check.value),
      fingerprint: fingerprintSecret(check.value),
      from: current.keyFingerprint,
      action: 'rotated',
    };
  }

  if (keyWrite) {
    db.prepare(
      `UPDATE ai_zone_configs
       SET provider = ?, fallback_provider = ?, model = ?, daily_token_limit = ?,
           zero_retention = ?, batch_mode = ?, enabled = ?,
           api_key_encrypted = ?, api_key_fingerprint = ?, api_key_updated_at = ?, api_key_updated_by = ?,
           updated_at = ?
       WHERE zone = ?`
    ).run(
      nextProvider,
      nextFallback,
      nextModel,
      nextLimit,
      nextZeroRet,
      nextBatch,
      nextEnabled,
      keyWrite.encrypted,
      keyWrite.fingerprint,
      nowIso,
      actorUsername || null,
      nowIso,
      zone
    );
  } else {
    db.prepare(
      `UPDATE ai_zone_configs
       SET provider = ?, fallback_provider = ?, model = ?, daily_token_limit = ?,
           zero_retention = ?, batch_mode = ?, enabled = ?, updated_at = ?
       WHERE zone = ?`
    ).run(nextProvider, nextFallback, nextModel, nextLimit, nextZeroRet, nextBatch, nextEnabled, nowIso, zone);
  }

  const updated = getZoneRuntimeConfig(db, zone);
  if (keyWrite) {
    updated.keyChange = { action: keyWrite.action, from: keyWrite.from, to: keyWrite.fingerprint, at: nowIso };
  }
  return updated;
}

module.exports = {
  getZoneRuntimeConfig,
  getZoneDailyUsage,
  recordAiRequest,
  executeIsolatedZoneModel,
  listAllZonesStatus,
  updateZoneConfig,
};
