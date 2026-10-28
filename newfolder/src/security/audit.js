'use strict';

/**
 * Immutable Audit Trail (04-security.md lines 107–117):
 * Records who, when, what was proposed (`proposed`), what was applied (`applied`),
 * on what data (`dataRefs`), which AI provider/model was used, and tokens spent.
 */

const crypto = require('node:crypto');
const { CONFIG } = require('../config');

function hashIdentifier(value) {
  if (!value) return null;
  return crypto
    .createHmac('sha256', CONFIG.piiSalt)
    .update(String(value).trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function writeAuditLog(
  db,
  {
    region = CONFIG.primaryRegion,
    actorRole,
    actorId,
    action,
    targetType = null,
    targetId = null,
    proposed = null,
    applied = null,
    dataRefs = null,
    provider = null,
    model = null,
    tokensUsed = 0,
    ipHash = null,
  }
) {
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs
     (region, actor_role, actor_id, action, target_type, target_id,
      proposed_json, applied_json, data_refs_json, provider, model, tokens_used, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(region || CONFIG.primaryRegion),
    String(actorRole || 'system'),
    String(actorId || 'system'),
    String(action),
    targetType ? String(targetType) : null,
    targetId ? String(targetId) : null,
    proposed ? JSON.stringify(proposed) : null,
    applied ? JSON.stringify(applied) : null,
    dataRefs ? JSON.stringify(dataRefs) : null,
    provider ? String(provider) : null,
    model ? String(model) : null,
    Math.round(Number(tokensUsed || 0)),
    ipHash ? String(ipHash).slice(0, 48) : null,
    createdAt
  );
}

module.exports = {
  hashIdentifier,
  writeAuditLog,
};
