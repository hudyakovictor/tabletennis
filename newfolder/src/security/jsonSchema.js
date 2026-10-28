'use strict';

/**
 * Formal JSON Schema Contracts & Quarantine Gate (03-director-chat.md, 09-api-contracts.md)
 *
 * Exports formal JSON Schema Draft-2020-12 definitions AND enforces strict runtime
 * validation (`additionalProperties: false` on root & findings, excessive-agency block).
 */

const crypto = require('node:crypto');

const ALLOWED_ZONES = new Set(['ops', 'fraud', 'balance', 'market', 'lab']);
const ALLOWED_STATUSES = new Set(['ok', 'warning', 'critical']);
const FORBIDDEN_ACTION_KEYS = new Set([
  'execute_sql',
  'ban_player_now',
  'mutate_rules',
  'shell_cmd',
  'send_push_now',
  'charge_payment',
  'delete_data',
]);

const ZONE_SUMMARY_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://crm.topspin.arena/schemas/zone-summary.json',
  type: 'object',
  additionalProperties: false,
  required: ['zone', 'timestamp', 'status', 'findings', 'metrics'],
  properties: {
    zone: { type: 'string', enum: ['ops', 'fraud', 'balance', 'market', 'lab'] },
    timestamp: { type: 'string', format: 'date-time' },
    status: { type: 'string', enum: ['ok', 'warning', 'critical'] },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['issue', 'confidence'],
        properties: {
          issue: { type: 'string', minLength: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          affected_segment: { type: 'string' },
          recommended_action: { type: 'string' },
        },
      },
    },
    metrics: { type: 'object' },
  },
});

const DIRECTOR_RESPONSE_JSON_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://crm.topspin.arena/schemas/director-response.json',
  type: 'object',
  additionalProperties: false,
  required: ['status', 'summary', 'findings', 'next_questions'],
  properties: {
    status: { type: 'string', enum: ['ok', 'warning', 'critical'] },
    summary: { type: 'string', minLength: 1 },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['zone', 'issue', 'confidence'],
        properties: {
          zone: { type: 'string', enum: ['ops', 'fraud', 'balance', 'market', 'lab'] },
          issue: { type: 'string', minLength: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          recommended_action: { type: 'string' },
        },
      },
    },
    next_questions: {
      type: 'array',
      items: { type: 'string' },
    },
  },
});

const ALLOWED_ZONE_ROOT_KEYS = new Set(['zone', 'timestamp', 'status', 'findings', 'metrics']);
const ALLOWED_ZONE_FINDING_KEYS = new Set(['issue', 'confidence', 'affected_segment', 'recommended_action']);
const ALLOWED_DIRECTOR_ROOT_KEYS = new Set(['status', 'summary', 'findings', 'next_questions']);
const ALLOWED_DIRECTOR_FINDING_KEYS = new Set(['zone', 'issue', 'confidence', 'recommended_action']);

function validateZoneSummaryContract(obj, expectedZone = null) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['Root must be a JSON object'] };
  }
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_ACTION_KEYS.has(k)) {
      errors.push(`Forbidden excessive-agency field '${k}' detected`);
    } else if (!ALLOWED_ZONE_ROOT_KEYS.has(k)) {
      errors.push(`Unexpected root property '${k}' (additionalProperties: false)`);
    }
  }
  if (!ALLOWED_ZONES.has(obj.zone)) {
    errors.push(`Invalid zone '${obj.zone}'`);
  }
  if (expectedZone && obj.zone !== expectedZone) {
    errors.push(`Zone mismatch: expected '${expectedZone}', got '${obj.zone}'`);
  }
  if (typeof obj.timestamp !== 'string' || Number.isNaN(Date.parse(obj.timestamp))) {
    errors.push('Invalid ISO timestamp');
  }
  if (!ALLOWED_STATUSES.has(obj.status)) {
    errors.push(`Invalid status '${obj.status}' (must be ok | warning | critical)`);
  }
  if (!Array.isArray(obj.findings)) {
    errors.push('findings must be an array');
  } else {
    obj.findings.forEach((f, idx) => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        errors.push(`findings[${idx}] must be an object`);
        return;
      }
      for (const fk of Object.keys(f)) {
        if (FORBIDDEN_ACTION_KEYS.has(fk) || !ALLOWED_ZONE_FINDING_KEYS.has(fk)) {
          errors.push(`findings[${idx}] invalid property '${fk}'`);
        }
      }
      if (typeof f.issue !== 'string' || !f.issue.trim()) {
        errors.push(`findings[${idx}].issue must be a non-empty string`);
      }
      if (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 1) {
        errors.push(`findings[${idx}].confidence must be a number in [0, 1]`);
      }
      if (f.affected_segment !== undefined && typeof f.affected_segment !== 'string') {
        errors.push(`findings[${idx}].affected_segment must be a string`);
      }
      if (f.recommended_action !== undefined && typeof f.recommended_action !== 'string') {
        errors.push(`findings[${idx}].recommended_action must be a string`);
      }
    });
  }
  if (!obj.metrics || typeof obj.metrics !== 'object' || Array.isArray(obj.metrics)) {
    errors.push('metrics must be an object');
  }
  return { valid: errors.length === 0, errors };
}

function validateDirectorResponseContract(obj) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, errors: ['Root must be a JSON object'] };
  }
  for (const k of Object.keys(obj)) {
    if (FORBIDDEN_ACTION_KEYS.has(k)) {
      errors.push(`Forbidden excessive-agency field '${k}' detected`);
    } else if (!ALLOWED_DIRECTOR_ROOT_KEYS.has(k)) {
      errors.push(`Unexpected director root property '${k}' (additionalProperties: false)`);
    }
  }
  if (!ALLOWED_STATUSES.has(obj.status)) {
    errors.push(`Invalid status '${obj.status}' (must be ok | warning | critical)`);
  }
  if (typeof obj.summary !== 'string' || !obj.summary.trim()) {
    errors.push('summary must be a non-empty string');
  }
  if (!Array.isArray(obj.findings)) {
    errors.push('findings must be an array');
  } else {
    obj.findings.forEach((f, idx) => {
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        errors.push(`findings[${idx}] must be an object`);
        return;
      }
      for (const fk of Object.keys(f)) {
        if (FORBIDDEN_ACTION_KEYS.has(fk) || !ALLOWED_DIRECTOR_FINDING_KEYS.has(fk)) {
          errors.push(`findings[${idx}] invalid property '${fk}'`);
        }
      }
      if (!ALLOWED_ZONES.has(f.zone)) {
        errors.push(`findings[${idx}].zone must be one of ops|fraud|balance|market|lab`);
      }
      if (typeof f.issue !== 'string' || !f.issue.trim()) {
        errors.push(`findings[${idx}].issue must be a non-empty string`);
      }
      if (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 1) {
        errors.push(`findings[${idx}].confidence must be in [0, 1]`);
      }
      if (f.recommended_action !== undefined && typeof f.recommended_action !== 'string') {
        errors.push(`findings[${idx}].recommended_action must be a string`);
      }
    });
  }
  if (!Array.isArray(obj.next_questions) || !obj.next_questions.every((q) => typeof q === 'string')) {
    errors.push('next_questions must be an array of strings');
  }
  return { valid: errors.length === 0, errors };
}

function quarantineInvalidAiOutput(db, { zone, provider, reason, rawOutput }) {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO ai_quarantine (id, zone, provider, reason, raw_output, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(zone),
    String(provider || 'unknown'),
    String(reason),
    typeof rawOutput === 'string' ? rawOutput.slice(0, 8000) : JSON.stringify(rawOutput).slice(0, 8000),
    createdAt
  );
  return id;
}

module.exports = {
  ZONE_SUMMARY_JSON_SCHEMA,
  DIRECTOR_RESPONSE_JSON_SCHEMA,
  validateZoneSummaryContract,
  validateDirectorResponseContract,
  quarantineInvalidAiOutput,
};
