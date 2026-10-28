'use strict';

/**
 * Data-subject requests (DSAR): right of access and right to erasure
 * (`16-legal-player-agreements.md`, GDPR Art. 15/17, 152-ФЗ ст. 14/20).
 *
 * The previous build only *recorded* a completed erasure; there was no intake and
 * no queue, so the 30-day legal deadline had no owner and no watch. This module
 * makes the deadline a first-class object:
 *  - every request gets `due_at = requested_at + deletionSlaDays` (30 by default);
 *  - status flows `pending → in_progress → completed | rejected`, and only the
 *    transitions that make legal sense are accepted;
 *  - an export is a *recorded* event too (an operator proving they answered);
 *  - nothing is ever deleted by the timer: overdue requests escalate, they do not
 *    silently disappear.
 */

const crypto = require('node:crypto');
const { CONFIG, RETENTION_DAYS } = require('../config');
const { exportPlayerDataPackage, executeRightToErasure } = require('./liveops');

const REQUEST_TYPES = Object.freeze(['export', 'erasure']);
const OPEN_STATUSES = Object.freeze(['pending', 'in_progress']);

function slaDays() {
  return RETENTION_DAYS.deletionSlaDays || 30;
}

function addDays(isoString, days) {
  return new Date(new Date(isoString).getTime() + days * 86400 * 1000).toISOString();
}

function decorate(row, now = new Date()) {
  if (!row) return row;
  const due = row.due_at || addDays(row.requested_at, slaDays());
  const closed = row.status === 'completed' || row.status === 'rejected';
  const msLeft = new Date(due).getTime() - now.getTime();
  return {
    ...row,
    due_at: due,
    isOpen: OPEN_STATUSES.includes(row.status),
    isOverdue: !closed && msLeft < 0,
    daysLeft: closed ? null : Math.max(0, Math.floor(msLeft / 86400000)),
    hoursLeft: closed ? null : Math.max(0, Math.floor(msLeft / 3600000)),
    slaDays: slaDays(),
  };
}

function createPrivacyRequest(db, { playerId, requestType, source = 'operator', reason = null, createdBy = null }) {
  const player = playerId ? db.prepare('SELECT id, region, status FROM players WHERE id = ?').get(playerId) : null;
  if (!player) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (!REQUEST_TYPES.includes(requestType)) return { ok: false, code: 'REQUEST_TYPE_INVALID' };

  // One open request per player and type: a queue full of duplicates is how a
  // 30-day deadline gets missed twice for the same person.
  const existing = db
    .prepare(
      `SELECT id FROM privacy_requests
        WHERE player_id = ? AND request_type = ? AND status IN ('pending', 'in_progress')`
    )
    .get(playerId, requestType);
  if (existing) {
    return { ok: false, code: 'REQUEST_ALREADY_OPEN', requestId: existing.id };
  }

  const nowIso = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO privacy_requests
       (id, player_id, region, request_type, status, reason, requested_at, due_at, source, notes, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    player.id,
    player.region || CONFIG.primaryRegion,
    requestType,
    reason,
    nowIso,
    addDays(nowIso, slaDays()),
    source,
    createdBy ? `intake: ${createdBy}` : null,
    nowIso
  );
  return { ok: true, request: decorate(db.prepare('SELECT * FROM privacy_requests WHERE id = ?').get(id)) };
}

function getPrivacyRequest(db, id) {
  return decorate(db.prepare('SELECT * FROM privacy_requests WHERE id = ?').get(id));
}

function listPrivacyRequests(db, { status = 'open', limit = 100 } = {}) {
  const where = status === 'all' ? '' : status === 'open' ? `WHERE status IN ('pending','in_progress')` : 'WHERE status = ?';
  const rows =
    status === 'all' || status === 'open'
      ? db.prepare(`SELECT * FROM privacy_requests ${where} ORDER BY requested_at DESC LIMIT ?`).all(limit)
      : db.prepare(`SELECT * FROM privacy_requests ${where} ORDER BY requested_at DESC LIMIT ?`).all(status, limit);
  const now = new Date();
  return rows.map((row) => decorate(row, now));
}

function privacyQueueSummary(db) {
  const rows = listPrivacyRequests(db, { status: 'open', limit: 500 });
  const now = new Date();
  const all = db
    .prepare('SELECT status, COUNT(*) AS c FROM privacy_requests GROUP BY status')
    .all()
    .reduce((acc, r) => ({ ...acc, [r.status]: Number(r.c) }), {});
  return {
    slaDays: slaDays(),
    open: rows.length,
    overdue: rows.filter((r) => r.isOverdue).length,
    dueSoon: rows.filter((r) => !r.isOverdue && r.daysLeft != null && r.daysLeft <= 5).length,
    completed: all.completed || 0,
    rejected: all.rejected || 0,
    pending: all.pending || 0,
    inProgress: all.in_progress || 0,
    oldestRequestedAt: rows.length ? rows[rows.length - 1].requested_at || rows[0].requested_at : null,
    byType: rows.reduce((acc, r) => ({ ...acc, [r.request_type]: (acc[r.request_type] || 0) + 1 }), {}),
    evaluatedAt: now.toISOString(),
  };
}

function markInProgress(db, id, actor) {
  const row = db.prepare('SELECT * FROM privacy_requests WHERE id = ?').get(id);
  if (!row) return { ok: false, code: 'REQUEST_NOT_FOUND' };
  if (row.status !== 'pending') return { ok: false, code: 'INVALID_TRANSITION', status: row.status };
  const nowIso = new Date().toISOString();
  db.prepare(`UPDATE privacy_requests SET status = 'in_progress', updated_at = ? WHERE id = ?`).run(nowIso, id);
  return { ok: true, request: getPrivacyRequest(db, id), actor };
}

/**
 * Executes the request. Export produces the package (returned to the caller);
 * erasure delegates to the existing, transactional `executeRightToErasure`, which
 * already writes its own completed row — so we update *that* row instead of
 * inserting a duplicate.
 */
function fulfilPrivacyRequest(db, id, { actor }) {
  const row = db.prepare('SELECT * FROM privacy_requests WHERE id = ?').get(id);
  if (!row) return { ok: false, code: 'REQUEST_NOT_FOUND' };
  if (row.status === 'completed') return { ok: false, code: 'REQUEST_ALREADY_COMPLETED' };
  if (row.status === 'rejected') return { ok: false, code: 'REQUEST_REJECTED' };

  const nowIso = new Date().toISOString();
  if (row.request_type === 'export') {
    const dataPackage = exportPlayerDataPackage(db, row.player_id);
    if (!dataPackage) return { ok: false, code: 'PLAYER_NOT_FOUND' };
    db.prepare(
      `UPDATE privacy_requests
          SET status = 'completed', completed_at = ?, processed_by = ?, updated_at = ?
        WHERE id = ?`
    ).run(nowIso, actor || null, nowIso, id);
    return { ok: true, request: getPrivacyRequest(db, id), dataPackage };
  }

  const erasure = executeRightToErasure(db, {
    playerId: row.player_id,
    reason: row.reason || 'DSAR erasure',
    processedBy: actor || 'operator',
    // The queue row already exists — do not duplicate the subject's history.
    recordRequest: false,
    dueAt: row.due_at,
  });
  if (!erasure) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  db.prepare(
    `UPDATE privacy_requests
        SET status = 'completed', completed_at = ?, processed_by = ?, updated_at = ?
      WHERE id = ?`
  ).run(nowIso, actor || null, nowIso, id);
  return { ok: true, request: getPrivacyRequest(db, id), erasure };
}

function rejectPrivacyRequest(db, id, { reason, actor }) {
  const row = db.prepare('SELECT * FROM privacy_requests WHERE id = ?').get(id);
  if (!row) return { ok: false, code: 'REQUEST_NOT_FOUND' };
  if (row.status !== 'pending' && row.status !== 'in_progress') {
    return { ok: false, code: 'INVALID_TRANSITION', status: row.status };
  }
  const why = String(reason || '').trim();
  if (why.length < 5) return { ok: false, code: 'REASON_REQUIRED' };
  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE privacy_requests
        SET status = 'rejected', completed_at = ?, processed_by = ?, rejection_reason = ?, updated_at = ?
      WHERE id = ?`
  ).run(nowIso, actor || null, why.slice(0, 500), nowIso, id);
  return { ok: true, request: getPrivacyRequest(db, id) };
}

module.exports = {
  REQUEST_TYPES,
  OPEN_STATUSES,
  createPrivacyRequest,
  getPrivacyRequest,
  listPrivacyRequests,
  privacyQueueSummary,
  markInProgress,
  fulfilPrivacyRequest,
  rejectPrivacyRequest,
  slaDays,
};
