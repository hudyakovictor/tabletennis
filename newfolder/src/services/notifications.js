'use strict';

/**
 * Operator Notification Center.
 *
 * Why it exists: the dashboard used to surface incidents/proposals only on manual
 * refresh, so a 03:00 critical incident was invisible until someone clicked «Обновить».
 * Notifications are persisted (read state survives reload), deduplicated by
 * fingerprint (a flapping alert cannot spam 200 rows), role-scoped (a zone analyst
 * never sees PII notifications) and pushed live via SSE.
 */

const crypto = require('node:crypto');
const { publish } = require('./eventBus');

function fingerprintOf(kind, title, extra = '') {
  return crypto
    .createHash('sha256')
    .update(`${kind}|${title}|${extra}`)
    .digest('hex')
    .slice(0, 32);
}

function recentDuplicate(db, fingerprint, windowSec = 1800) {
  if (!fingerprint) return null;
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  return db
    .prepare('SELECT id FROM admin_notifications WHERE fingerprint = ? AND created_at >= ? LIMIT 1')
    .get(fingerprint, since);
}

function notify(db, { kind, severity = 'info', title, body = '', link = null, roles = [], fingerprint = null, dedupeWindowSec = 1800 }) {
  const fp = fingerprint || fingerprintOf(kind, title, body.slice(0, 64));
  if (recentDuplicate(db, fp, dedupeWindowSec)) return null;

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO admin_notifications
     (id, fingerprint, kind, severity, title, body, link_hash, target_roles_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, fp, kind, severity, String(title).slice(0, 220), String(body).slice(0, 1200), link, JSON.stringify(roles || []), createdAt);

  const row = { id, kind, severity, title, body, link, roles, created_at: createdAt, read_at: null };
  publish('notification', row);
  return row;
}

function listNotifications(db, { role = null, unreadOnly = false, limit = 60 } = {}) {
  const params = [];
  let sql = `SELECT id, kind, severity, title, body, link_hash AS link, target_roles_json, read_at, read_by, created_at
             FROM admin_notifications WHERE 1=1`;
  if (unreadOnly) sql += ' AND read_at IS NULL';
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(200, Math.max(1, Number(limit) || 60)));
  const rows = db.prepare(sql).all(...params);

  return rows
    .filter((r) => {
      if (!role) return true;
      let roles = [];
      try {
        roles = JSON.parse(r.target_roles_json || '[]');
      } catch {
        roles = [];
      }
      return roles.length === 0 || roles.includes(role);
    })
    .map((r) => ({
      ...r,
      target_roles: undefined,
    }));
}

function unreadCount(db, role = null) {
  return listNotifications(db, { role, unreadOnly: true, limit: 200 }).length;
}

function markRead(db, ids, actor) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return 0;
  const stmt = db.prepare('UPDATE admin_notifications SET read_at = ?, read_by = ? WHERE id = ? AND read_at IS NULL');
  const now = new Date().toISOString();
  let changed = 0;
  for (const id of list) changed += Number(stmt.run(now, actor, id).changes || 0);
  return changed;
}

function markAllRead(db, actor, role = null) {
  const rows = listNotifications(db, { role, unreadOnly: true, limit: 200 });
  return markRead(db, rows.map((r) => r.id), actor);
}

function pruneNotifications(db, olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86400 * 1000).toISOString();
  const res = db.prepare('DELETE FROM admin_notifications WHERE created_at < ? AND read_at IS NOT NULL').run(cutoff);
  return Number(res.changes || 0);
}

module.exports = {
  fingerprintOf,
  notify,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  pruneNotifications,
};
