'use strict';

/**
 * Server-Side Input, Physics, Swipe-Freshness, Residency & Rate-Limit Validator
 * (04-security.md, 05-legal-rf-sanctions.md, 16-legal-player-agreements.md)
 */

const crypto = require('node:crypto');
const {
  CONFIG,
  PHYSICS_LIMITS,
  PRESS_REJECTION_REASONS,
  TABLE_ZONES,
  DATA_RESIDENCY_MAP,
  REGION_ENDPOINTS,
  AGE_GATE_RULES,
} = require('../config');

const VALID_REJECT_SET = new Set(PRESS_REJECTION_REASONS);
const VALID_TABLE_ZONE_SET = new Set(TABLE_ZONES);
const VALID_POINTER_SET = new Set(['touch', 'mouse', 'pen']);
const VALID_GRIP_SET = new Set(['shakehand', 'penhold']);
const VALID_HAND_SET = new Set(['right', 'left']);

const bucketMap = new Map();

function checkRateLimit(key, maxPerMinute = 120) {
  const now = Date.now();
  let bucket = bucketMap.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    bucketMap.set(key, bucket);
  }
  bucket.count++;
  return {
    allowed: bucket.count <= maxPerMinute,
    remaining: Math.max(0, maxPerMinute - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/**
 * Resolves player jurisdiction, regional server endpoint & age-gate law.
 * Enforces CN PIPL block when ICP license is absent (05-legal-rf-sanctions.md).
 */
function resolveDataResidency(req, explicitCountry) {
  const rawCountry = String(
    explicitCountry ||
      req?.headers?.['x-geo-country'] ||
      req?.headers?.['cf-ipcountry'] ||
      CONFIG.primaryRegion ||
      'RU'
  )
    .trim()
    .toUpperCase()
    .slice(0, 2);

  const policy = DATA_RESIDENCY_MAP[rawCountry] || {
    region: [
      'AT', 'BE', 'BG', 'CY', 'CZ', 'DK', 'EE', 'ES', 'FI', 'GR', 'HR', 'HU',
      'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
    ].includes(rawCountry)
      ? 'EU'
      : CONFIG.primaryRegion,
    dbCluster: 'rf-msk-primary',
    legalRegime: 'STANDARD',
    piiAllowedOnPrimary: true,
    priority: 3,
  };

  const endpoint = REGION_ENDPOINTS[policy.region] || REGION_ENDPOINTS.RU;
  const ageRule = AGE_GATE_RULES[policy.region] || AGE_GATE_RULES.DEFAULT;

  return {
    countryCode: rawCountry,
    region: policy.region,
    dbCluster: policy.dbCluster,
    legalRegime: policy.legalRegime,
    blocked: !!policy.blocked,
    blockReason: policy.blockReason || null,
    piiAllowedOnPrimary: policy.piiAllowedOnPrimary !== false,
    recommendedEndpoint: endpoint,
    ageGate: ageRule,
  };
}

/**
 * Evaluates regional minor parental-consent gate (16-legal-player-agreements.md: COPPA / GDPR-K / 152-ФЗ)
 */
function evaluateAgeGate(region, declaredAge, parentalConsent) {
  const rule = AGE_GATE_RULES[region] || AGE_GATE_RULES.DEFAULT;
  const ageNum = Number(declaredAge);
  if (!Number.isFinite(ageNum) || ageNum < 6 || ageNum > 120) {
    return { valid: false, requiresParentalConsent: true, minAge: rule.minAgeWithoutParentalConsent, law: rule.law };
  }
  const isMinor = ageNum < rule.minAgeWithoutParentalConsent;
  if (isMinor && !parentalConsent) {
    return {
      valid: false,
      isMinor: true,
      requiresParentalConsent: true,
      minAge: rule.minAgeWithoutParentalConsent,
      law: rule.law,
    };
  }
  return {
    valid: true,
    isMinor,
    requiresParentalConsent: isMinor,
    minAge: rule.minAgeWithoutParentalConsent,
    law: rule.law,
  };
}

/**
 * Verifies Telegram Mini App `initData` HMAC-SHA256 signature per Telegram WebApp spec:
 * secret_key = HMAC_SHA256("WebAppData", bot_token)
 * hash = hex(HMAC_SHA256(secret_key, sorted_data_check_string))
 */
function verifyTelegramInitData(initDataRaw, botToken = CONFIG.telegramGameBotToken) {
  if (!initDataRaw || typeof initDataRaw !== 'string') {
    return { valid: false, error: 'Missing initData' };
  }
  const params = new URLSearchParams(initDataRaw);
  const hash = params.get('hash');

  if (!botToken && CONFIG.env !== 'production' && params.get('dev_bypass') === '1') {
    const devId = params.get('user_id') || 'tg_dev_1001';
    return {
      valid: true,
      devMode: true,
      telegramId: devId,
      username: params.get('username') || 'dev_player',
      startParam: params.get('start_param') || null,
    };
  }

  if (!botToken || !hash) {
    return { valid: false, error: 'Telegram signature verification requires bot token and hash' };
  }

  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (k !== 'hash') pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(computedHash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, error: 'Invalid Telegram initData HMAC signature' };
  }

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) {
    return { valid: false, error: 'Expired Telegram auth_date' };
  }

  let userObj = {};
  try {
    userObj = JSON.parse(params.get('user') || '{}');
  } catch {
    return { valid: false, error: 'Malformed Telegram user JSON' };
  }
  if (!userObj.id) {
    return { valid: false, error: 'Missing Telegram user.id' };
  }

  return {
    valid: true,
    devMode: false,
    telegramId: String(userObj.id),
    username: userObj.username ? String(userObj.username).slice(0, 48) : `Player_${String(userObj.id).slice(-4)}`,
    languageCode: userObj.language_code || 'ru',
    startParam: params.get('start_param') || null,
  };
}

/**
 * Full 6-point Server Input & Physics Validator (04-security.md lines 53–61):
 * 1. Event frequency (`maxEventsPerSecond`)
 * 2. Physical plausibility (`ball_speed`, `spin`, `reaction_ms`)
 * 3. Monotonic & non-future timestamps (`ts`)
 * 4. Ball speed vs racket contact offset consistency (`along`/`across`)
 * 5. Fresh swipe presence (`has_fresh_swipe === false` cannot be `accepted: true`)
 * 6. `MATCH_RULES` reject code consistency (`accepted === true` cannot carry a `reject_code`)
 */
function validateInputTelemetryBatch(events) {
  if (!Array.isArray(events)) {
    return {
      valid: false,
      error: 'events must be an array',
      validEvents: [],
      rejectedEvents: [],
      tamperDetected: true,
    };
  }
  if (events.length > PHYSICS_LIMITS.maxBatchEvents) {
    return {
      valid: false,
      error: `Batch exceeds max ${PHYSICS_LIMITS.maxBatchEvents} events`,
      validEvents: [],
      rejectedEvents: [],
      tamperDetected: true,
    };
  }

  const validEvents = [];
  const rejectedEvents = [];
  let tamperDetected = false;
  let prevTsMs = -Infinity;
  const recentSecondWindow = [];

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || typeof ev !== 'object') {
      rejectedEvents.push({ index: i, reason: 'NON_OBJECT' });
      continue;
    }

    const along = Number(ev.along);
    const across = Number(ev.across);
    const ballSpeed = ev.ball_speed === null || ev.ball_speed === undefined ? 0 : Number(ev.ball_speed);
    const spin = ev.spin === null || ev.spin === undefined ? 0 : Number(ev.spin);
    const reactionMs =
      ev.reaction_ms === null || ev.reaction_ms === undefined ? null : Number(ev.reaction_ms);

    if (!Number.isFinite(along) || !Number.isFinite(across) || !Number.isFinite(ballSpeed) || !Number.isFinite(spin)) {
      rejectedEvents.push({ index: i, reason: 'NON_FINITE_NUMBERS' });
      tamperDetected = true;
      continue;
    }

    // 2. Physical plausibility
    if (Math.abs(along) > PHYSICS_LIMITS.maxAbsAlongPx || Math.abs(across) > PHYSICS_LIMITS.maxAbsAcrossPx) {
      rejectedEvents.push({ index: i, reason: 'IMPOSSIBLE_SCREEN_COORDS' });
      tamperDetected = true;
      continue;
    }
    if (ballSpeed < 0 || ballSpeed > PHYSICS_LIMITS.maxBallSpeedMs) {
      rejectedEvents.push({ index: i, reason: 'IMPOSSIBLE_BALL_SPEED_SI', value: ballSpeed });
      tamperDetected = true;
      continue;
    }
    if (Math.abs(spin) > PHYSICS_LIMITS.maxAbsSpinRadS) {
      rejectedEvents.push({ index: i, reason: 'IMPOSSIBLE_SPIN_RAD_S', value: spin });
      tamperDetected = true;
      continue;
    }
    if (reactionMs !== null && (!Number.isFinite(reactionMs) || reactionMs < 15 || reactionMs > 10_000)) {
      rejectedEvents.push({ index: i, reason: 'IMPOSSIBLE_REACTION_MS', value: reactionMs });
      tamperDetected = true;
      continue;
    }

    // 3. Timestamp check & 1. Event frequency check
    const tsDate = ev.ts ? new Date(ev.ts) : new Date();
    const tsMs = tsDate.getTime();
    if (!Number.isFinite(tsMs) || tsMs > Date.now() + 60_000) {
      rejectedEvents.push({ index: i, reason: 'FUTURE_OR_INVALID_TIMESTAMP' });
      tamperDetected = true;
      continue;
    }
    if (tsMs < prevTsMs - 5000) {
      rejectedEvents.push({ index: i, reason: 'NON_MONOTONIC_TIMESTAMP' });
      continue;
    }
    prevTsMs = Math.max(prevTsMs, tsMs);

    while (recentSecondWindow.length > 0 && tsMs - recentSecondWindow[0] > 1000) {
      recentSecondWindow.shift();
    }
    recentSecondWindow.push(tsMs);
    if (recentSecondWindow.length > PHYSICS_LIMITS.maxEventsPerSecond) {
      rejectedEvents.push({ index: i, reason: 'EVENT_FREQUENCY_FLOOD' });
      tamperDetected = true;
      continue;
    }

    const accepted = Boolean(ev.accepted);
    const contact = accepted ? Boolean(ev.contact) : false;
    const hasFreshSwipe = ev.has_fresh_swipe === undefined ? true : Boolean(ev.has_fresh_swipe);

    // 4. Ball speed vs racket position consistency
    if (contact && ballSpeed > 1.0 && (Math.abs(along) > 260 || Math.abs(across) > 180)) {
      rejectedEvents.push({ index: i, reason: 'CONTACT_POSITION_MISMATCH' });
      tamperDetected = true;
      continue;
    }

    // 5. Fresh swipe invariant: cannot accept a stroke without a fresh swipe
    if (accepted && !hasFreshSwipe) {
      rejectedEvents.push({ index: i, reason: 'ACCEPTED_WITHOUT_FRESH_SWIPE' });
      tamperDetected = true;
      continue;
    }

    // 6. MATCH_RULES reject code consistency
    if (ev.reject_code && !VALID_REJECT_SET.has(ev.reject_code)) {
      rejectedEvents.push({ index: i, reason: 'UNKNOWN_REJECT_CODE', code: ev.reject_code });
      tamperDetected = true;
      continue;
    }
    if (accepted && ev.reject_code) {
      rejectedEvents.push({ index: i, reason: 'CONTRADICTORY_ACCEPT_AND_REJECT_CODE' });
      tamperDetected = true;
      continue;
    }

    const pointerType = VALID_POINTER_SET.has(ev.pointer_type) ? ev.pointer_type : 'touch';
    const grip = VALID_GRIP_SET.has(ev.grip) ? ev.grip : 'shakehand';
    const hand = VALID_HAND_SET.has(ev.hand) ? ev.hand : 'right';
    const tableZone = VALID_TABLE_ZONE_SET.has(ev.table_zone)
      ? ev.table_zone
      : along >= 0
      ? across < -18
        ? 'deep_bh'
        : across > 18
        ? 'deep_fh'
        : 'deep_mid'
      : across < -18
      ? 'short_bh'
      : across > 18
      ? 'short_fh'
      : 'short_mid';

    const straightness =
      ev.swipe_straightness !== undefined && Number.isFinite(Number(ev.swipe_straightness))
        ? Math.max(0, Math.min(1, +Number(ev.swipe_straightness).toFixed(4)))
        : 0.88;

    validEvents.push({
      ts: tsDate.toISOString(),
      pointer_type: pointerType,
      grip,
      hand,
      is_serve: ev.is_serve ? 1 : 0,
      table_zone: tableZone,
      has_fresh_swipe: hasFreshSwipe ? 1 : 0,
      swipe_straightness: straightness,
      along: +along.toFixed(2),
      across: +across.toFixed(2),
      accepted: accepted ? 1 : 0,
      contact: contact ? 1 : 0,
      is_grace: ev.is_grace ? 1 : 0,
      reject_code: accepted ? null : ev.reject_code || (!hasFreshSwipe ? 'NO_FRESH_SWIPE' : 'OUTSIDE_ZONE'),
      stroke_type: ev.stroke_type ? String(ev.stroke_type).slice(0, 24) : null,
      ball_speed: +ballSpeed.toFixed(3),
      spin: +spin.toFixed(2),
      reaction_ms: reactionMs !== null ? +reactionMs.toFixed(1) : null,
      sweet_spot_dist:
        ev.sweet_spot_dist !== undefined && Number.isFinite(Number(ev.sweet_spot_dist))
          ? +Number(ev.sweet_spot_dist).toFixed(4)
          : null,
      rules_version: Number.isInteger(ev.rules_version) ? ev.rules_version : 4,
      ab_variant: ev.ab_variant ? String(ev.ab_variant).slice(0, 48) : null,
    });
  }

  return {
    valid: rejectedEvents.length === 0 || validEvents.length > 0,
    validEvents,
    rejectedEvents,
    tamperDetected,
  };
}

module.exports = {
  checkRateLimit,
  resolveDataResidency,
  evaluateAgeGate,
  verifyTelegramInitData,
  validateInputTelemetryBatch,
};
