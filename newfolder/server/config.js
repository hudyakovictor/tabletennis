/* Центральная конфигурация. Только сервер читает process.env.
 * Ни один из этих значений не отдаётся в клиентский бандл, кроме явно
 * публичного блока в /api/public-config (без секретов). */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Минимальный .env loader без зависимостей. Существующие env не перезаписываются. */
export function loadEnvFile(file = '.env') {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) return false;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 1) continue;
    const key = s.slice(0, i).trim();
    let value = s.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}

const ZONES = ['ops', 'fraud', 'balance', 'market', 'lab', 'director'];
const ZONE_DEFAULTS = {
  ops: { model: 'openai/gpt-4o-mini', dailyTokens: 100000, cadenceMinutes: 60 },
  fraud: { model: 'openai/gpt-4o-mini', dailyTokens: 200000, cadenceMinutes: 30 },
  balance: { model: 'anthropic/claude-3.5-sonnet', dailyTokens: 300000, cadenceMinutes: 1440 },
  market: { model: 'openai/gpt-4o-mini', dailyTokens: 200000, cadenceMinutes: 1440 },
  lab: { model: 'meta/llama-3.1-70b-instruct', dailyTokens: 500000, cadenceMinutes: 1440 },
  director: { model: 'anthropic/claude-3.5-sonnet', dailyTokens: 200000, cadenceMinutes: 0 },
};

function parseKV(str, sep = ':') {
  const out = {};
  for (const part of String(str || '').split(',')) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf(sep);
    if (i < 0) continue;
    out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return out;
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** INGEST_KEYS=id:secret,... → Map id → secret.
 * Если ключей нет, создаём локальный dev-ключ (только для CRM_ENV=development). */
export function parseIngestKeys(raw, envName) {
  const keys = parseKV(raw);
  if (!Object.keys(keys).length && envName !== 'production') {
    keys['local-dev'] = 'local-dev-secret';
  }
  return keys;
}

export function loadConfig(env = process.env, overrides = {}) {
  const envName = env.CRM_ENV || 'production';
  const ingest = parseIngestKeys(env.INGEST_KEYS, envName);
  const ai = {};
  for (const z of ZONES) {
    const up = z.toUpperCase();
    const d = ZONE_DEFAULTS[z];
    ai[z] = {
      zone: z,
      zoneRole: `ai_zone_${z}`,
      baseUrl: env[`AI_${up}_BASE_URL`] || 'https://openrouter.ai/api/v1',
      apiKey: env[`AI_${up}_API_KEY`] || '',
      model: env[`AI_${up}_MODEL`] || d.model,
      priceIn: num(env[`AI_${up}_PRICE_IN`], 0.5),      // USD / 1M input tokens
      priceOut: num(env[`AI_${up}_PRICE_OUT`], 1.5),    // USD / 1M output tokens
      dailyTokens: num(env[`AI_${up}_DAILY_TOKENS`], d.dailyTokens),
      cadenceMinutes: d.cadenceMinutes,
      timeoutMs: num(env.AI_TIMEOUT_MS, 20000),
    };
  }
  const cfg = {
    envName,
    port: num(env.PORT, 4173),
    host: env.HOST || '0.0.0.0',
    dbPath: env.CRM_DB_PATH || 'data/crm.sqlite',
    demoData: env.DEMO_DATA !== '0',
    timezone: env.CRM_TIMEZONE || 'Europe/Moscow',
    directorWindowHours: Math.min(168, Math.max(12, num(env.DIRECTOR_WINDOW_HOURS, 72))),
    adminUser: env.ADMIN_USER || 'owner',
    adminPassword: env.ADMIN_PASSWORD || '',
    adminExtraUsers: env.ADMIN_EXTRA_USERS || '',
    sessionSecret: env.SESSION_SECRET || '',
    sessionTtlHours: num(env.SESSION_TTL_HOURS, 24),
    cookieSecure: env.COOKIE_SECURE === '1',
    adminOrigins: String(env.ADMIN_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    clientOrigins: String(env.CLIENT_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    frameAncestors: env.FRAME_ANCESTORS || '*',
    ingestKeys: ingest,
    ingestMaxSkewSec: num(env.INGEST_MAX_SKEW_SEC, 300),
    ingestMaxBatch: Math.min(5000, num(env.INGEST_MAX_BATCH, 1000)),
    ai,
    aiLocalFallback: env.AI_LOCAL_FALLBACK !== '0',
    aiZones: ZONES,
    bot: {
      enabled: env.BOT_ENABLED === '1' && !!env.BOT_TOKEN,
      token: env.BOT_TOKEN || '',
      chatIds: String(env.BOT_CHAT_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
      dailyDigestHour: num(env.BOT_DAILY_DIGEST_HOUR, 9),
      ackEnabled: env.BOT_ACK_ENABLED !== '0',
    },
    dataResidencyMap: parseKV(env.DATA_RESIDENCY_MAP || 'RU:ru-central1,OTHER:ru-central1'),
    regionEndpoints: parseKV(env.REGION_ENDPOINTS || ''),
    pingWarnMs: num(env.PING_WARN_MS, 100),
    retention: {
      inputDays: num(env.RETENTION_INPUT_DAYS, 90),
      telemetryDays: num(env.RETENTION_TELEMETRY_DAYS, 180),
      aiDays: num(env.RETENTION_AI_DAYS, 180),
      chatDays: num(env.RETENTION_CHAT_DAYS, 365),
    },
    jobsEnabled: env.JOBS_ENABLED !== '0',
    alertsEvalMinutes: num(env.ALERTS_EVAL_MINUTES, 5),
    regions: ['RU', 'CIS', 'EU', 'IN', 'BR', 'US', 'OTHER'],
    version: '1.0.0',
    now: () => new Date(),
  };
  if (!cfg.adminPassword) {
    cfg.adminPassword = crypto.randomBytes(12).toString('base64url');
    cfg.generatedPassword = true;
  }
  if (!cfg.sessionSecret) cfg.sessionSecret = crypto.randomBytes(32).toString('hex');
  return Object.assign(cfg, overrides);
}

export function publicConfig(cfg) {
  return {
    version: cfg.version,
    env: cfg.envName,
    regions: cfg.regions,
    dataResidency: cfg.dataResidencyMap,
    regionEndpoints: cfg.regionEndpoints,
    directorWindowHours: cfg.directorWindowHours,
    aiZones: cfg.aiZones.map(z => ({
      zone: z,
      model: cfg.ai[z].model,
      provider: cfg.ai[z].apiKey ? 'openai-compatible' : 'local-heuristic',
      dailyTokens: cfg.ai[z].dailyTokens,
      configured: !!cfg.ai[z].apiKey,
    })),
    botEnabled: cfg.bot.enabled,
    demoData: cfg.demoData,
  };
}

export { ZONES, ZONE_DEFAULTS };
