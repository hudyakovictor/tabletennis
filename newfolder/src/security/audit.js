'use strict';

/**
 * Tamper-evident Immutable Audit Trail (04-security.md lines 107–117)
 *
 * Every entry records who / when / what was proposed (`proposed`) / what was applied
 * (`applied`) / on what data (`dataRefs`) / which AI provider+model was involved /
 * how many tokens were spent — and is sealed into a SHA-256 hash chain
 * (`prev_hash` -> `entry_hash`), so a deleted or edited row is *provable*.
 *
 * The chain is intentionally append-only: no update/delete statement is ever issued
 * against `audit_logs` anywhere in the codebase.
 */

const crypto = require('node:crypto');
const { CONFIG } = require('../config');

const GENESIS_HASH = 'GENESIS';

function hashIdentifier(value) {
  if (!value) return null;
  return crypto
    .createHmac('sha256', CONFIG.piiSalt)
    .update(String(value).trim().toLowerCase())
    .digest('hex')
    .slice(0, 32);
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Canonical, order-stable serialization of an audit entry. Changing this function
 * invalidates historical proofs, therefore it is frozen by a regression test.
 */
function canonicalAuditPayload(row) {
  return JSON.stringify([
    row.id,
    row.region,
    row.actor_role,
    row.actor_id,
    row.action,
    row.target_type || '',
    row.target_id || '',
    row.proposed_json || '',
    row.applied_json || '',
    row.data_refs_json || '',
    row.provider || '',
    row.model || '',
    Number(row.tokens_used || 0),
    row.ip_hash || '',
    row.created_at,
  ]);
}

function computeEntryHash(prevHash, row) {
  return sha256Hex(`${prevHash || GENESIS_HASH}\n${canonicalAuditPayload(row)}`);
}

function lastAuditRow(db) {
  return db
    .prepare(
      `SELECT id, region, actor_role, actor_id, action, target_type, target_id,
              proposed_json, applied_json, data_refs_json, provider, model,
              tokens_used, ip_hash, prev_hash, entry_hash, created_at
       FROM audit_logs ORDER BY id DESC LIMIT 1`
    )
    .get();
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
  const prev = lastAuditRow(db);
  const prevHash = prev?.entry_hash || GENESIS_HASH;
  const row = {
    region: String(region || CONFIG.primaryRegion),
    actor_role: String(actorRole || 'system'),
    actor_id: String(actorId || 'system'),
    action: String(action),
    target_type: targetType ? String(targetType) : null,
    target_id: targetId !== null && targetId !== undefined ? String(targetId) : null,
    proposed_json: proposed ? JSON.stringify(proposed) : null,
    applied_json: applied ? JSON.stringify(applied) : null,
    data_refs_json: dataRefs ? JSON.stringify(dataRefs) : null,
    provider: provider ? String(provider) : null,
    model: model ? String(model) : null,
    tokens_used: Math.round(Number(tokensUsed || 0)),
    ip_hash: ipHash ? String(ipHash).slice(0, 48) : null,
    created_at: createdAt,
  };

  const result = db
    .prepare(
      `INSERT INTO audit_logs
       (region, actor_role, actor_id, action, target_type, target_id,
        proposed_json, applied_json, data_refs_json, provider, model, tokens_used, ip_hash, prev_hash, entry_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.region,
      row.actor_role,
      row.actor_id,
      row.action,
      row.target_type,
      row.target_id,
      row.proposed_json,
      row.applied_json,
      row.data_refs_json,
      row.provider,
      row.model,
      row.tokens_used,
      row.ip_hash,
      prevHash,
      // Placeholder that is replaced immediately below with the sealed hash.
      '',
      row.created_at
    );

  const insertedId = Number(result.lastInsertRowid);
  const entryHash = computeEntryHash(prevHash, { ...row, id: insertedId });
  db.prepare('UPDATE audit_logs SET entry_hash = ? WHERE id = ?').run(entryHash, insertedId);
  return { id: insertedId, entryHash, prevHash: prevHash };
}

/**
 * Rebuilds the chain for rows written before v3 (they carry no hash at all).
 * Only NULL/empty `entry_hash` rows are touched; already-sealed rows are never modified.
 */
function backfillAuditChain(db) {
  const rows = db
    .prepare(
      `SELECT id, region, actor_role, actor_id, action, target_type, target_id,
              proposed_json, applied_json, data_refs_json, provider, model,
              tokens_used, ip_hash, prev_hash, entry_hash, created_at
       FROM audit_logs ORDER BY id ASC`
    )
    .all();
  let prevHash = GENESIS_HASH;
  let sealed = 0;
  const update = db.prepare('UPDATE audit_logs SET prev_hash = ?, entry_hash = ? WHERE id = ?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      if (row.entry_hash) {
        prevHash = row.entry_hash;
        continue;
      }
      const entryHash = computeEntryHash(prevHash, row);
      update.run(prevHash, entryHash, row.id);
      prevHash = entryHash;
      sealed += 1;
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
  return { sealed, totalRows: rows.length };
}

/**
 * Verifies the full chain (or the last `limit` entries).
 * Returns the first broken link so the operator can inspect exactly where history diverges.
 */
function verifyAuditChain(db, { limit = null } = {}) {
  const sql = `SELECT id, region, actor_role, actor_id, action, target_type, target_id,
                      proposed_json, applied_json, data_refs_json, provider, model,
                      tokens_used, ip_hash, prev_hash, entry_hash, created_at
               FROM audit_logs ORDER BY id ASC`;
  const all = db.prepare(sql).all();
  const rows = limit ? all.slice(-limit) : all;
  let expectedPrev = limit ? rows[0]?.prev_hash || GENESIS_HASH : GENESIS_HASH;
  let checked = 0;
  for (const row of rows) {
    if (!row.entry_hash) {
      return {
        valid: false,
        checked,
        totalRows: all.length,
        brokenAtId: row.id,
        reason: 'UNSEALED_ROW',
        message: `Запись аудита #${row.id} не имеет подписи (записана до включения hash-chain)`,
      };
    }
    if (row.prev_hash !== expectedPrev) {
      return {
        valid: false,
        checked,
        totalRows: all.length,
        brokenAtId: row.id,
        reason: 'BROKEN_LINK',
        message: `Разрыв цепочки на записи #${row.id}: prev_hash не совпадает с предыдущим entry_hash`,
      };
    }
    const recomputed = computeEntryHash(row.prev_hash, row);
    if (recomputed !== row.entry_hash) {
      return {
        valid: false,
        checked,
        totalRows: all.length,
        brokenAtId: row.id,
        reason: 'CONTENT_TAMPERED',
        message: `Содержимое записи #${row.id} изменено после записи (hash не сходится)`,
      };
    }
    expectedPrev = row.entry_hash;
    checked += 1;
  }
  return {
    valid: true,
    checked,
    totalRows: all.length,
    headHash: expectedPrev === GENESIS_HASH ? null : expectedPrev,
    algorithm: 'sha256(prev_hash + canonical_entry)',
  };
}

module.exports = {
  GENESIS_HASH,
  hashIdentifier,
  writeAuditLog,
  verifyAuditChain,
  backfillAuditChain,
  canonicalAuditPayload,
  computeEntryHash,
};
