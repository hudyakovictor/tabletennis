'use strict';

/**
 * Idempotency for state-changing admin calls.
 *
 * A CRM mutation can be retried by a flaky mobile connection, a double-click, or an
 * impatient operator: without idempotency a retried `POST /liveops/maintenance` is
 * harmless, but a retried push/news/sanction is not. With an `Idempotency-Key`
 * header the first response is replayed byte-for-byte and the side effect happens once.
 */

const crypto = require('node:crypto');

const TTL_MS = 24 * 3600 * 1000;

function hashRequest(method, pathname, body) {
  return crypto
    .createHash('sha256')
    .update(`${method}:${pathname}:${JSON.stringify(body ?? {})}`)
    .digest('hex');
}

function lookup(db, key, actorId, requestHash) {
  if (!key) return { state: 'absent' };
  const row = db
    .prepare('SELECT * FROM idempotency_keys WHERE key = ? AND expires_at > ?')
    .get(key, new Date().toISOString());
  if (!row) return { state: 'absent' };
  if (row.actor_id !== actorId || row.request_hash !== requestHash) {
    return {
      state: 'conflict',
      status: 409,
      json: {
        error: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Ключ идемпотентности уже использован для другого запроса или другим администратором',
      },
    };
  }
  let parsed = {};
  try {
    parsed = JSON.parse(row.response_json);
  } catch {
    parsed = {};
  }
  return { state: 'replay', status: Number(row.status_code), json: { ...parsed, idempotentReplay: true } };
}

function save(db, key, actorId, method, pathname, body, status, json) {
  if (!key) return;
  const now = Date.now();
  try {
    db.prepare(
      `INSERT OR REPLACE INTO idempotency_keys
       (key, endpoint, actor_id, request_hash, status_code, response_json, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      key,
      `${method} ${pathname}`,
      actorId,
      hashRequest(method, pathname, body),
      status,
      JSON.stringify(json ?? {}),
      new Date(now).toISOString(),
      new Date(now + TTL_MS).toISOString()
    );
  } catch {
    /* idempotency persistence must never break the primary write */
  }
}

function prune(db) {
  const res = db.prepare('DELETE FROM idempotency_keys WHERE expires_at < ?').run(new Date().toISOString());
  return Number(res.changes || 0);
}

module.exports = { TTL_MS, hashRequest, lookup, save, prune };
