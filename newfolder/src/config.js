'use strict';

const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');

// ============================================================================
// Canonical MATCH_RULES v4 baseline (1-to-1 with source/game/tt/src/12_match_rules.js)
// ============================================================================
const MATCH_RULES_V4 = Object.freeze({
  version: 4,
  zoneShape: 'oval',
  pressRadiusPx: 96,
  ovalLeadSec: 0.16,
  ovalForwardPx: 24,
  ovalForwardMaxPx: 120,
  ovalBackPx: 18,
  ovalSideMousePx: 44,
  ovalSideTouchPx: 60,
  ovalMinSpeedPx: 8,
  ovalFullSpeedPx: 120,
  ovalSampleDtSec: 0.05,
  serveTossMinRise: 0.16,
  trajectoryAssist: 0.85,
  positionAssist: 0.85,
  sensitivity: 1,
  captureRadius: 0.22,
  depthTolerance: 0.22,
  serveCaptureRadius: 0.55,
  sweetRadius: 0.15225,
  timingMinPx: 8,
  timingMaxPx: 20,
  timingHorizon: 0.44,
  contactAtClosest: true,
  zoneAnchor: 'contact',
  contactForwardPx: 150,
  contactBackPx: 120,
  contactSideTouchPx: 64,
  contactSideMousePx: 46,
  zoneScale: 'world',
  zoneRefPxPerCmX: 2.94,
  zoneRefPxPerCmY: 2.39,
  zoneScaleMin: 0.75,
  zoneScaleMax: 1.5,
  contactMinSideTouchPx: 52,
  contactMinSideMousePx: 38,
  contactMinAlongPx: 70,
  contactEdgePx: 20,
  magnet: 0,
  magnetRadius: 0,
  magnetHorizon: 0.45,
  autoFootwork: true,
  footworkHeight: 0.4,
});

const PRESS_REJECTION_REASONS = Object.freeze([
  'OUTSIDE_ZONE',
  'NO_FRESH_SWIPE',
  'STATIC_CLICK',
  'DEPTH_FAIL',
  'TIMING_LATE',
  'TIMING_EARLY',
  'CONSUMED',
  'SERVE_TOSS_LOW',
  'WRONG_DIRECTION',
  'BOUNCE_ILLEGAL',
]);

const TABLE_ZONES = Object.freeze([
  'short_bh',
  'short_mid',
  'short_fh',
  'deep_bh',
  'deep_mid',
  'deep_fh',
]);

const PHYSICS_LIMITS = Object.freeze({
  maxBallSpeedMs: 38.0,
  maxAbsSpinRadS: 1150.0,
  maxAbsAlongPx: 650.0,
  maxAbsAcrossPx: 450.0,
  minReactionMs: 42.0,
  maxEventsPerSecond: 25,
  maxBatchEvents: 200,
});

const DATA_RESIDENCY_MAP = Object.freeze({
  RU: { region: 'RU', dbCluster: 'rf-msk-primary', legalRegime: '152-FZ', piiAllowedOnPrimary: true, priority: 1 },
  BY: { region: 'RU', dbCluster: 'rf-msk-primary', legalRegime: 'CIS', piiAllowedOnPrimary: true, priority: 1 },
  KZ: { region: 'RU', dbCluster: 'rf-msk-primary', legalRegime: 'CIS', piiAllowedOnPrimary: true, priority: 1 },
  TR: { region: 'TR', dbCluster: 'me-ist-regional', legalRegime: 'KVKK', piiAllowedOnPrimary: true, priority: 2 },
  IN: { region: 'IN', dbCluster: 'ap-bom-regional', legalRegime: 'DPDP', piiAllowedOnPrimary: true, priority: 2 },
  SG: { region: 'SG', dbCluster: 'ap-sin-regional', legalRegime: 'PDPA', piiAllowedOnPrimary: true, priority: 2 },
  BR: { region: 'BR', dbCluster: 'sa-gru-regional', legalRegime: 'LGPD', piiAllowedOnPrimary: true, priority: 2 },
  DE: { region: 'EU', dbCluster: 'eu-fra-gdpr', legalRegime: 'GDPR', piiAllowedOnPrimary: false, priority: 3 },
  FR: { region: 'EU', dbCluster: 'eu-fra-gdpr', legalRegime: 'GDPR', piiAllowedOnPrimary: false, priority: 3 },
  SE: { region: 'EU', dbCluster: 'eu-fra-gdpr', legalRegime: 'GDPR', piiAllowedOnPrimary: false, priority: 3 },
  EU: { region: 'EU', dbCluster: 'eu-fra-gdpr', legalRegime: 'GDPR', piiAllowedOnPrimary: false, priority: 3 },
  US: { region: 'US', dbCluster: 'us-iad-regional', legalRegime: 'COPPA/CCPA', piiAllowedOnPrimary: true, priority: 3 },
  CA: { region: 'US', dbCluster: 'us-iad-regional', legalRegime: 'PIPEDA', piiAllowedOnPrimary: true, priority: 3 },
  CN: {
    region: 'CN',
    dbCluster: 'cn-blocked-no-icp',
    legalRegime: 'PIPL',
    blocked: process.env.CN_ICP_LICENSED !== '1',
    blockReason: 'ICP license & local partner required before serving CN (05-legal-rf-sanctions.md)',
    priority: 99,
  },
});

const REGION_ENDPOINTS = Object.freeze({
  RU: { nodeId: 'ru-msk-tma-01', code: 'ru-msk-1', label: 'РФ + СНГ (Москва / Питер)', wsUrl: 'wss://msk.game.topspin.arena/ws/client', active: true, rollout: 'immediate', targetRttMs: 38 },
  EU: { nodeId: 'eu-fra-tma-01', code: 'eu-fra-1', label: 'Европа (Франкфурт / Амстердам)', wsUrl: 'wss://fra.game.topspin.arena/ws/client', active: true, rollout: 'on_eu_growth', targetRttMs: 52 },
  TR: { nodeId: 'me-ist-tma-01', code: 'me-ist-1', label: 'Турция / Ближний Восток (Стамбул)', wsUrl: 'wss://ist.game.topspin.arena/ws/client', active: true, rollout: 'on_growth', targetRttMs: 60 },
  IN: { nodeId: 'ap-bom-tma-01', code: 'ap-bom-1', label: 'Индия (Мумбаи)', wsUrl: 'wss://bom.game.topspin.arena/ws/client', active: true, rollout: 'on_growth', targetRttMs: 74 },
  SG: { nodeId: 'ap-sin-tma-01', code: 'ap-sin-1', label: 'Юго-Восточная Азия (Сингапур)', wsUrl: 'wss://sin.game.topspin.arena/ws/client', active: true, rollout: 'on_growth', targetRttMs: 68 },
  US: { nodeId: 'us-iad-tma-01', code: 'us-iad-1', label: 'США Восток (Вирджиния)', wsUrl: 'wss://iad.game.topspin.arena/ws/client', active: true, rollout: 'on_growth', targetRttMs: 76 },
  US_WEST: { nodeId: 'us-sjc-tma-01', code: 'us-sjc-1', label: 'США Запад (Калифорния)', wsUrl: 'wss://sjc.game.topspin.arena/ws/client', active: true, rollout: 'on_growth', targetRttMs: 82 },
  BR: { nodeId: 'sa-gru-tma-01', code: 'sa-gru-1', label: 'Бразилия / Латам (Сан-Паулу)', wsUrl: 'wss://gru.game.topspin.arena/ws/client', active: true, rollout: 'on_growth', targetRttMs: 88 },
  CN: { nodeId: 'cn-sha-deferred', code: 'cn-sha-1', label: 'Китай (Отложено — нужна ICP-лицензия)', wsUrl: null, active: false, rollout: 'deferred_icp', targetRttMs: null },
});

// Exact RTT thresholds per 13-telegram-miniapp-latency.md: <35ms, 35-65ms, 65-100ms, 100-150ms (warn >100ms), >150ms
const PING_THRESHOLDS = Object.freeze({
  excellentMaxMs: 35,
  goodMaxMs: 65,
  playableRollbackMaxMs: 100,
  warnClientThresholdMs: 100,
  poorWarnMaxMs: 150,
  excellentMs: 35,
  goodMs: 65,
  warnMs: 100,
  unacceptablePvpMs: 150,
});

// Regional minor parental-consent thresholds (16-legal-player-agreements.md: COPPA 13, GDPR-K 16, 152-ФЗ 14)
const AGE_GATE_RULES = Object.freeze({
  US: { minAgeWithoutParentalConsent: 13, law: 'COPPA (US)' },
  US_WEST: { minAgeWithoutParentalConsent: 13, law: 'COPPA (US)' },
  EU: { minAgeWithoutParentalConsent: 16, law: 'GDPR-K (EU)' },
  RU: { minAgeWithoutParentalConsent: 14, law: '152-ФЗ / ГК РФ' },
  DEFAULT: { minAgeWithoutParentalConsent: 13, law: 'Standard Minimum Age' },
});

const ROLES = Object.freeze({
  PLAYER: 'player',
  ADMIN: 'admin',
  AI_ZONE_OPS: 'ai_zone_ops',
  AI_ZONE_FRAUD: 'ai_zone_fraud',
  AI_ZONE_BALANCE: 'ai_zone_balance',
  AI_ZONE_MARKET: 'ai_zone_market',
  AI_ZONE_LAB: 'ai_zone_lab',
  AI_DIRECTOR: 'ai_director',
});

const AI_ZONES = Object.freeze({
  ops: {
    zone: 'ops',
    role: ROLES.AI_ZONE_OPS,
    title: 'Зона Ops',
    cadence: 'every 15m',
    provider: process.env.ZONE_OPS_PROVIDER || 'local_statistical',
    fallbackProvider: process.env.ZONE_OPS_FALLBACK_PROVIDER || 'yandexgpt',
    model: process.env.ZONE_OPS_MODEL || 'meta-llama/llama-3.1-8b-instruct',
    apiKey: process.env.ZONE_OPS_API_KEY || '',
    dailyTokenLimit: Number(process.env.ZONE_OPS_DAILY_TOKEN_LIMIT || 100000),
    zeroRetention: true,
    batchMode: false,
  },
  fraud: {
    zone: 'fraud',
    role: ROLES.AI_ZONE_FRAUD,
    title: 'Зона Fraud',
    cadence: 'every 30m',
    provider: process.env.ZONE_FRAUD_PROVIDER || 'local_statistical',
    fallbackProvider: process.env.ZONE_FRAUD_FALLBACK_PROVIDER || 'nvidia',
    model: process.env.ZONE_FRAUD_MODEL || 'qwen/qwen-2.5-72b-instruct',
    apiKey: process.env.ZONE_FRAUD_API_KEY || '',
    dailyTokenLimit: Number(process.env.ZONE_FRAUD_DAILY_TOKEN_LIMIT || 200000),
    zeroRetention: true,
    batchMode: false,
  },
  balance: {
    zone: 'balance',
    role: ROLES.AI_ZONE_BALANCE,
    title: 'Зона Balance',
    cadence: 'every 6h',
    provider: process.env.ZONE_BALANCE_PROVIDER || 'local_statistical',
    fallbackProvider: process.env.ZONE_BALANCE_FALLBACK_PROVIDER || 'yandexgpt',
    model: process.env.ZONE_BALANCE_MODEL || 'qwen/qwen-2.5-72b-instruct',
    apiKey: process.env.ZONE_BALANCE_API_KEY || '',
    dailyTokenLimit: Number(process.env.ZONE_BALANCE_DAILY_TOKEN_LIMIT || 300000),
    zeroRetention: true,
    batchMode: false,
  },
  market: {
    zone: 'market',
    role: ROLES.AI_ZONE_MARKET,
    title: 'Зона Market',
    cadence: 'daily 08:00 UTC',
    provider: process.env.ZONE_MARKET_PROVIDER || 'local_statistical',
    fallbackProvider: process.env.ZONE_MARKET_FALLBACK_PROVIDER || 'gigachat',
    model: process.env.ZONE_MARKET_MODEL || 'qwen/qwen-2.5-72b-instruct',
    apiKey: process.env.ZONE_MARKET_API_KEY || '',
    dailyTokenLimit: Number(process.env.ZONE_MARKET_DAILY_TOKEN_LIMIT || 200000),
    zeroRetention: true,
    batchMode: false,
  },
  lab: {
    zone: 'lab',
    role: ROLES.AI_ZONE_LAB,
    title: 'Зона Lab',
    cadence: 'nightly batch 03:00 UTC',
    provider: process.env.ZONE_LAB_PROVIDER || 'local_statistical',
    fallbackProvider: process.env.ZONE_LAB_FALLBACK_PROVIDER || 'ollama',
    model: process.env.ZONE_LAB_MODEL || 'deepseek/deepseek-chat',
    apiKey: process.env.ZONE_LAB_API_KEY || '',
    dailyTokenLimit: Number(process.env.ZONE_LAB_DAILY_TOKEN_LIMIT || 500000),
    zeroRetention: false,
    batchMode: true,
  },
  director: {
    zone: 'director',
    role: ROLES.AI_DIRECTOR,
    title: 'Директор (Слой сводок)',
    cadence: 'interactive 48-72h window',
    provider: process.env.DIRECTOR_PROVIDER || 'local_statistical',
    fallbackProvider: process.env.DIRECTOR_FALLBACK_PROVIDER || 'yandexgpt',
    model: process.env.DIRECTOR_MODEL || 'anthropic/claude-3.5-sonnet',
    apiKey: process.env.DIRECTOR_API_KEY || '',
    dailyTokenLimit: Number(process.env.DIRECTOR_DAILY_TOKEN_LIMIT || 250000),
    zeroRetention: true,
    batchMode: false,
  },
});

const RETENTION_DAYS = Object.freeze({
  inputLogs: 90,
  telemetrySessions: 180,
  aiRequests: 180,
  directorChatArchive: 365,
  deletionSlaDays: 30,
});

const CONFIG = Object.freeze({
  rootDir: ROOT_DIR,
  port: Number(process.env.PORT || 4100),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',
  dbPath: process.env.CRM_DB_PATH
    ? path.resolve(ROOT_DIR, process.env.CRM_DB_PATH)
    : path.join(ROOT_DIR, 'data', 'crm.sqlite'),
  archiveDbPath: process.env.CRM_ARCHIVE_DB_PATH
    ? path.resolve(ROOT_DIR, process.env.CRM_ARCHIVE_DB_PATH)
    : path.join(ROOT_DIR, 'data', 'director-archive.sqlite'),
  backupDir: path.join(ROOT_DIR, 'data', 'backups'),
  primaryRegion: process.env.PRIMARY_DATA_REGION || 'RU',
  cnIcpLicensed: process.env.CN_ICP_LICENSED === '1',
  adminEmail: process.env.ADMIN_EMAIL || 'owner@topspin.arena',
  adminPassword: process.env.ADMIN_PASSWORD || 'TopspinAdmin2026!',
  jwtSecret: process.env.JWT_SECRET || process.env.SESSION_SECRET || 'topspin-arena-dev-hmac-secret-change-in-prod',
  piiSalt: process.env.PII_HASH_SALT || 'topspin-152fz-salt-change-in-prod',
  allowedOrigins: (process.env.ADMIN_ALLOWED_ORIGINS || 'http://localhost:4100,http://127.0.0.1:4100')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  rateLimits: {
    adminApiPerMinute: 240,
    clientTelemetryPerMinute: 120,
    sessionStartsPerMinute: 20,
  },
  telegramGameBotToken: process.env.TELEGRAM_GAME_BOT_TOKEN || '',
  telegramOpsBotToken: process.env.TELEGRAM_ADMIN_BOT_TOKEN || '',
  telegramOpsChatId: process.env.TELEGRAM_OWNER_CHAT_ID || '',
  directorSlidingWindowHours: Math.max(48, Math.min(72, Number(process.env.DIRECTOR_SLIDING_WINDOW_HOURS || 72))),
});

module.exports = {
  CONFIG,
  MATCH_RULES_V4,
  PRESS_REJECTION_REASONS,
  TABLE_ZONES,
  PHYSICS_LIMITS,
  DATA_RESIDENCY_MAP,
  REGION_ENDPOINTS,
  PING_THRESHOLDS,
  AGE_GATE_RULES,
  ROLES,
  AI_ZONES,
  RETENTION_DAYS,
};
