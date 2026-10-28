/* ─────────────────────────────────────────────────────────────────────────────
 * JSON Schema-валидация выходов моделей (03-director-chat.md, 09-api-contracts.md).
 * Реализована без зависимостей: строгие типы, перечисления, лимиты длин.
 * Невалидный ответ уходит в карантин, а НЕ в чат/дашборд.
 * ─────────────────────────────────────────────────────────────────────────── */
import { cleanStr } from '../util.js';

export const ZONES = ['ops', 'fraud', 'balance', 'market', 'lab'];
const STATUSES = ['ok', 'warning', 'critical'];

const INJECTION_MARKERS = [
  /ignore (all |any )?previous instructions/i,
  /ban all players/i,
  /system prompt/i,
  /\bDROP TABLE\b/i,
  /<\s*script/i,
  /\bapi[_ -]?key\b/i,
];

export function looksLikeInjection(text) {
  const s = String(text || '');
  return INJECTION_MARKERS.some(re => re.test(s));
}

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function num(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }

/** Схема сводки зоны (09-api-contracts.md). */
export function validateZoneSummary(raw, expectedZone) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ['response is not an object'], value: null, injection: false };
  const injection = looksLikeInjection(JSON.stringify(raw).slice(0, 20000));
  const zone = cleanStr(raw.zone, 20).toLowerCase();
  if (expectedZone && zone !== expectedZone) errors.push(`zone mismatch: ${zone}`);
  if (!ZONES.includes(zone)) errors.push(`unknown zone: ${zone}`);
  const status = cleanStr(raw.status, 20).toLowerCase();
  if (!STATUSES.includes(status)) errors.push(`invalid status: ${status}`);
  if (!Array.isArray(raw.findings)) errors.push('findings must be an array');
  if (raw.findings && raw.findings.length > 12) errors.push('too many findings');
  const findings = (Array.isArray(raw.findings) ? raw.findings : []).slice(0, 12).map((f, i) => {
    if (!isObj(f)) { errors.push(`finding ${i}: not an object`); return null; }
    const issue = cleanStr(f.issue, 300);
    if (!issue) errors.push(`finding ${i}: empty issue`);
    const c = num(f.confidence);
    if (c === null || c < 0 || c > 1) errors.push(`finding ${i}: confidence must be 0..1`);
    return {
      issue,
      confidence: c ?? 0,
      affected_segment: cleanStr(f.affected_segment, 120) || undefined,
      recommended_action: cleanStr(f.recommended_action, 300) || undefined,
    };
  }).filter(Boolean);
  const metrics = Object.create(null);
  if (raw.metrics !== undefined) {
    if (!isObj(raw.metrics)) errors.push('metrics must be an object');
    else for (const [k, v] of Object.entries(raw.metrics).slice(0, 40)) {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
      const x = num(v);
      if (x !== null) metrics[cleanStr(k, 60)] = x;
    }
  }
  if (injection) errors.push('suspicious instruction-like content in model output');
  const value = {
    zone: zone || expectedZone, status: status || 'ok',
    timestamp: new Date().toISOString(), findings, metrics,
  };
  return { ok: errors.length === 0, errors, value, injection };
}

/** Схема ответа директора (03-director-chat.md). */
export function validateDirectorResponse(raw) {
  const errors = [];
  if (!isObj(raw)) return { ok: false, errors: ['response is not an object'], value: null, injection: false };
  const injection = looksLikeInjection(JSON.stringify(raw).slice(0, 20000));
  const status = cleanStr(raw.status, 20).toLowerCase();
  if (!STATUSES.includes(status)) errors.push(`invalid status: ${status}`);
  const summary = cleanStr(raw.summary, 1500);
  if (!summary) errors.push('empty summary');
  if (!Array.isArray(raw.findings)) errors.push('findings must be an array');
  if (!Array.isArray(raw.next_questions)) errors.push('next_questions must be an array');
  const findings = (Array.isArray(raw.findings) ? raw.findings : []).slice(0, 12).map((f, i) => {
    if (!isObj(f)) { errors.push(`finding ${i}: not an object`); return null; }
    const zone = cleanStr(f.zone, 20).toLowerCase();
    if (!ZONES.includes(zone)) errors.push(`finding ${i}: unknown zone ${zone}`);
    const c = num(f.confidence);
    return {
      zone, issue: cleanStr(f.issue, 300),
      confidence: c !== null && c >= 0 && c <= 1 ? c : 0,
      recommended_action: cleanStr(f.recommended_action, 300) || undefined,
    };
  }).filter(Boolean);
  const next_questions = (Array.isArray(raw.next_questions) ? raw.next_questions : [])
    .slice(0, 5).map(x => cleanStr(x, 160)).filter(Boolean);
  // Модели запрещено возвращать «исполняемые» поля.
  for (const forbidden of ['action', 'execute', 'ban', 'apply', 'tool_calls', 'function_call']) {
    if (raw[forbidden] !== undefined) errors.push(`forbidden field: ${forbidden}`);
  }
  if (injection) errors.push('suspicious instruction-like content in model output');
  const value = { status: status || 'ok', summary, findings, next_questions };
  return { ok: errors.length === 0, errors, value, injection };
}

/** Публичные JSON Schema (для документации и внешних интеграций). */
export const ZONE_SUMMARY_SCHEMA = {
  type: 'object', required: ['zone', 'status', 'findings', 'metrics'],
  properties: {
    zone: { enum: ZONES }, status: { enum: STATUSES },
    findings: { type: 'array', maxItems: 12, items: { type: 'object', required: ['issue', 'confidence'],
      properties: { issue: { type: 'string', maxLength: 300 }, confidence: { type: 'number', minimum: 0, maximum: 1 },
        affected_segment: { type: 'string' }, recommended_action: { type: 'string' } } } },
    metrics: { type: 'object', additionalProperties: { type: 'number' } },
  },
};
export const DIRECTOR_SCHEMA = {
  type: 'object', required: ['status', 'summary', 'findings', 'next_questions'],
  properties: {
    status: { enum: STATUSES }, summary: { type: 'string', maxLength: 1500 },
    findings: { type: 'array', maxItems: 12 }, next_questions: { type: 'array', maxItems: 5, items: { type: 'string' } },
  },
};
