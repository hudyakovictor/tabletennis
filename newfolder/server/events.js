/* ─────────────────────────────────────────────────────────────────────────────
 * Единая схема событий (этап 1 плана 08-implementation-plan.md).
 * Игровой бэкенд шлёт батч событий, подписанный HMAC; CRM валидрует КАЖДОЕ
 * событие, даже если отправитель доверенный: данные считаются недоверенными.
 * ─────────────────────────────────────────────────────────────────────────── */
import { cleanStr, clamp, validISO, nowISO, uuid } from './util.js';

export const REJECT_CODES = Object.freeze([
  'OUTSIDE_ZONE', 'NO_FRESH_SWIPE', 'STATIC_CLICK', 'DEPTH_FAIL', 'TIMING_LATE',
  'TIMING_EARLY', 'CONSUMED', 'SERVE_TOSS_LOW', 'WRONG_DIRECTION', 'BOUNCE_ILLEGAL',
]); // 1:1 из source/game/tt/src/12_match_rules.js

export const EVENT_TYPES = Object.freeze([
  'session_start', 'session_end', 'input', 'perf', 'error', 'crash', 'http_request',
  'ping', 'match_end', 'payment', 'economy', 'marketing', 'install', 'test_result',
  'consent', 'deletion_request', 'support_ticket', 'custom',
]);

export const DEVICE_TYPES = ['touch', 'mouse', 'pen', 'keyboard', 'desktop', 'android', 'ios', 'tablet', 'unknown'];
export const REGIONS = ['RU', 'CIS', 'EU', 'IN', 'BR', 'US', 'OTHER'];

const STRING_FIELDS = [
  'device_type', 'pointer_type', 'reject_code', 'shot_type', 'build_version', 'rules_version',
  'hand', 'grip', 'platform', 'level', 'code', 'message', 'stack_hash', 'reason', 'route',
  'method', 'endpoint', 'product_id', 'product_kind', 'currency', 'status', 'provider',
  'idempotency_key', 'kind', 'item_id', 'channel', 'campaign', 'creative', 'type', 'source',
  'display_name', 'email_hash', 'country_code', 'telegram_id', 'subject', 'screenshot_url',
  'payload', 'name', 'winner', 'metric', 'variant', 'summary',
];
const NUMBER_FIELDS = [
  'along', 'across', 'ball_speed', 'spin', 'timing_error_ms', 'distance_px', 'direction_dot',
  'fps', 'fps_avg', 'frame_ms', 'update_ms', 'render_ms', 'ui_ms', 'scale', 'long_task_ms',
  'ping_ms', 'latency_ms', 'duration_s', 'matches', 'points', 'amount_usd', 'amount',
  'balance_after', 'cost_usd', 'installs', 'impressions', 'clicks', 'value', 'sample_size',
  'won', 'score', 'rally', 'hits', 'risk_score',
];
const BOOL_FIELDS = [
  'accepted', 'crash', 'refunded', 'chargeback', 'telemetry', 'ai_analysis', 'marketing', 'pinned',
];

const NUM_BOUNDS = {
  along: [-2000, 2000], across: [-2000, 2000], ball_speed: [0, 100], spin: [-1000, 1000],
  fps: [0, 1000], fps_avg: [0, 1000], frame_ms: [0, 10000], ping_ms: [0, 100000],
  latency_ms: [0, 600000], amount_usd: [0, 100000], cost_usd: [0, 1000000],
  duration_s: [0, 86400 * 7], distance_px: [0, 100000], direction_dot: [-1, 1],
  timing_error_ms: [-100000, 100000],
};
const DEFAULT_BOUNDS = [-1e9, 1e9];

/** Валидация и нормализация одного события. Никогда не бросает исключение. */
export function validateEvent(raw, opts = {}) {
  const now = opts.now || Date.now();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'event must be an object' };
  const errors = [];
  const type = cleanStr(raw.type, 40).toLowerCase();
  if (!EVENT_TYPES.includes(type)) errors.push(`unknown type: ${type || '(empty)'}`);

  let ts = cleanStr(raw.ts, 40) || nowISO(now);
  if (!validISO(ts)) {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) ts = new Date(parsed).toISOString();
    else errors.push('invalid ts');
  }
  if (!errors.length) {
    const t = Date.parse(ts);
    if (t > now + 5 * 60e3) ts = nowISO(now);           // будущее — не принимаем
    if (t < now - 400 * 86400e3) errors.push('ts is too old');
  }

  const region = cleanStr(raw.region || 'OTHER', 8).toUpperCase();
  const player_id = cleanStr(raw.player_id, 120) || null;
  const session_id = cleanStr(raw.session_id, 120) || null;
  const source = cleanStr(raw.source || opts.source || 'game-backend', 60);
  const id = cleanStr(raw.id, 120) || uuid();

  const dataIn = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : {};
  if (Object.keys(dataIn).length > 60) errors.push('data: too many fields');
  const data = {};
  for (const [k, v] of Object.entries(dataIn)) {
    const key = cleanStr(k, 60);
    if (!key) continue;
    if (STRING_FIELDS.includes(key)) {
      data[key] = cleanStr(v, key === 'message' || key === 'payload' || key === 'summary' ? 6000 : 300);
    } else if (NUMBER_FIELDS.includes(key)) {
      const n = Number(v);
      if (!Number.isFinite(n)) { data[key] = null; continue; }
      const [lo, hi] = NUM_BOUNDS[key] || DEFAULT_BOUNDS;
      data[key] = clamp(n, lo, hi);
    } else if (BOOL_FIELDS.includes(key)) {
      data[key] = v === true || v === 1 || v === 'true' || v === '1' ? 1 : 0;
    } else if (key === 'data' || key === 'extra' || key === 'meta' || key === 'results' || key === 'variants') {
      // Вложенные объекты — только компактный JSON, без функций и без текстов-инструкций.
      const txt = cleanStr(JSON.stringify(v).slice(0, 20000), 20000);
      data[key] = txt;
    }
    // Неизвестные ключи отбрасываются — нельзя тащить произвольный мусор в БД и промпты.
  }
  if (data.reject_code && !REJECT_CODES.includes(data.reject_code)) errors.push(`unknown reject_code: ${data.reject_code}`);
  if (data.pointer_type && !DEVICE_TYPES.includes(data.pointer_type)) data.pointer_type = 'unknown';
  if (!REGIONS.includes(region)) errors.push(`unknown region: ${region}`);
  if (type === 'input' && !data.reject_code && data.accepted === undefined) errors.push('input: need accepted or reject_code');
  if (type === 'payment' && data.amount_usd == null) errors.push('payment: need amount_usd');
  if (['input', 'payment', 'consent', 'deletion_request', 'support_ticket'].includes(type) && !player_id && type !== 'input') {
    errors.push(`${type}: need player_id`);
  }

  if (errors.length) return { ok: false, error: errors.slice(0, 5).join('; ') };
  return {
    ok: true,
    event: {
      id, dedupe_key: cleanStr(raw.dedupe_key, 160) || id, type, ts, region,
      player_id, session_id, source, data,
    },
  };
}

/** Публичное описание схемы — отдаётся в /api/schema и в UI раздела «Интеграция». */
export function eventSchemaDoc() {
  return {
    version: 1,
    transport: 'POST /api/ingest/events (HMAC-SHA256, application/json)',
    envelope: {
      id: 'string, optional, uuid — idempotency key',
      type: `one of ${EVENT_TYPES.join(', ')}`,
      ts: 'ISO-8601 UTC, e.g. 2026-10-28T09:00:00.000Z',
      region: `one of ${REGIONS.join(', ')}`,
      player_id: 'string, optional — псевдоним, НЕ email/телефон',
      session_id: 'string, optional',
      data: 'object — поля по типу события (см. fields)',
    },
    reject_codes: REJECT_CODES,
    fields: {
      input: ['pointer_type', 'along', 'across', 'reject_code', 'accepted', 'ball_speed', 'spin', 'timing_error_ms', 'distance_px', 'direction_dot', 'shot_type', 'build_version', 'rules_version', 'device_type', 'hand', 'grip'],
      perf: ['fps', 'frame_ms', 'update_ms', 'render_ms', 'ui_ms', 'long_task_ms', 'ping_ms', 'scale', 'device_type'],
      session_start: ['device_type', 'platform', 'build_version', 'rules_version', 'hand', 'grip', 'ping_ms'],
      session_end: ['duration_s', 'fps_avg', 'crash', 'matches', 'points'],
      error: ['level', 'code', 'message', 'stack_hash', 'build_version'],
      crash: ['reason', 'build_version', 'device_type'],
      http_request: ['route', 'method', 'status', 'latency_ms'],
      ping: ['endpoint', 'ping_ms', 'status'],
      payment: ['amount_usd', 'currency', 'product_id', 'product_kind', 'status', 'provider', 'idempotency_key', 'refunded', 'chargeback'],
      economy: ['kind', 'currency', 'amount', 'item_id', 'balance_after'],
      marketing: ['channel', 'campaign', 'creative', 'cost_usd', 'installs', 'impressions', 'clicks', 'type'],
      install: ['channel', 'campaign', 'creative', 'platform', 'display_name'],
      test_result: ['kind', 'source', 'payload', 'value', 'sample_size'],
      consent: ['telemetry', 'ai_analysis', 'marketing'],
      support_ticket: ['subject', 'body' /* body передаётся через data.message */, 'screenshot_url'],
      custom: ['kind', 'value', 'metric', 'summary'],
    },
    limits: { batch: 1000, bodyBytes: 5 * 1024 * 1024, futureSkewMs: 300000 },
  };
}
