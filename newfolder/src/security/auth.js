'use strict';

/**
 * Authentication, scrypt Password Hashing, 5-Attempt Brute-Force Guard,
 * 8-Role RBAC & TMA Session Affinity Tokens (04-security.md, 13-telegram-miniapp-latency.md)
 */

const crypto = require('node:crypto');
const { CONFIG, ROLES } = require('../config');
const { hashIdentifier } = require('./audit');
const { hasPermission: hasGranularPermission, ROLE_PERMISSIONS: GRANULAR_ROLES } = require('./permissions');

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.PLAYER]: ['client:play', 'client:telemetry', 'client:support', 'client:privacy'],
  [ROLES.ADMIN]: [
    'zones:read_all',
    'zones:manage',
    'director:chat',
    'hitl:decide',
    'rules:publish',
    'fraud:review',
    'liveops:manage',
    'legal:manage',
    'audit:read',
    'system:manage',
  ],
  [ROLES.AI_ZONE_OPS]: ['zone:ops:read', 'zone:ops:summarize'],
  [ROLES.AI_ZONE_FRAUD]: ['zone:fraud:read', 'zone:fraud:summarize'],
  [ROLES.AI_ZONE_BALANCE]: ['zone:balance:read', 'zone:balance:summarize'],
  [ROLES.AI_ZONE_MARKET]: ['zone:market:read', 'zone:market:summarize'],
  [ROLES.AI_ZONE_LAB]: ['zone:lab:read', 'zone:lab:summarize'],
  [ROLES.AI_DIRECTOR]: ['director:read_summaries', 'director:reply'],
});

function hasPermission(role, permission) {
  const list = ROLE_PERMISSIONS[role];
  return Array.isArray(list) && list.includes(permission);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 3) return false;
  const [, salt, expectedHex] = parts;
  const computed = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(expectedHex, 'hex');
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

function signHmacJwt(payloadObj, ttlSeconds = 8 * 3600) {
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const nowSec = Math.floor(Date.now() / 1000);
  const bodyB64 = Buffer.from(
    JSON.stringify({
      ...payloadObj,
      iat: nowSec,
      exp: nowSec + ttlSeconds,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', CONFIG.jwtSecret)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  return `${headerB64}.${bodyB64}.${sig}`;
}

function verifyHmacJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, bodyB64, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', CONFIG.jwtSecret)
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function signToken({ sub, username, role, displayName, sid = null }) {
  return signHmacJwt({ sub, username, role, displayName, sid, typ: 'admin' }, 12 * 3600);
}

function signPlayerToken({ playerId, region }) {
  return signHmacJwt({ sub: playerId, region, role: ROLES.PLAYER, typ: 'player' }, 7 * 86400);
}

function signSessionAffinityToken({ sessionId, playerId, region, nodeId }) {
  return signHmacJwt({ sid: sessionId, sub: playerId, region, nodeId, typ: 'affinity' }, 2 * 3600);
}

function verifySessionAffinityToken(token) {
  const p = verifyHmacJwt(token);
  if (!p || p.typ !== 'affinity' || !p.sid) return null;
  return p;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

/**
 * Resolves the admin principal.
 *
 * When a `db` is supplied the server-side session registry is authoritative:
 * a revoked or expired session is rejected even if its JWT signature is still valid.
 * Legacy JWTs without `sid` are accepted only outside production, so an upgrade never
 * locks the owner out while a leaked production token cannot outlive its session.
 */
function authenticateAdminRequest(req, db = null, { allowLegacy = CONFIG.env !== 'production' } = {}) {
  const auth = req.headers['authorization'];
  let raw = null;
  let source = 'cookie';
  if (auth && auth.startsWith('Bearer ')) {
    raw = auth.slice(7).trim();
    source = 'bearer';
  } else {
    const cookies = parseCookies(req.headers['cookie']);
    raw = cookies['topspin_crm_token'] || null;
  }
  if (!raw) return null;
  const payload = verifyHmacJwt(raw);
  if (!payload || payload.typ !== 'admin') return null;

  if (db) {
    // A disabled operator loses access immediately, including via a bearer token
    // that has not expired yet — deactivation must not wait for the 12h TTL.
    const account = db.prepare('SELECT is_active FROM admin_users WHERE id = ?').get(payload.sub);
    if (account && Number(account.is_active) === 0) return null;
    if (payload.sid) {
      const session = getActiveSession(db, payload.sid);
      if (!session) return null;
      if (Date.now() - new Date(session.last_seen_at).getTime() > 60_000) {
        touchAdminSession(db, payload.sid);
      }
      return { ...payload, authSource: source, sessionExpiresAt: session.expires_at };
    }
    if (!allowLegacy) return null;
  }
  return { ...payload, authSource: source, legacy: !payload.sid };
}

function authenticatePlayerRequest(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const p = verifyHmacJwt(auth.slice(7).trim());
  if (!p || p.role !== ROLES.PLAYER) return null;
  return p;
}

const SESSION_TTL_SEC = 12 * 3600;

function buildSessionCookie(token, isSecure = false) {
  const parts = [
    `topspin_crm_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SEC}`,
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie() {
  return 'topspin_crm_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

/**
 * CSRF double-submit token. The cookie is deliberately readable by the SPA
 * (HttpOnly=false) while the server keeps only its SHA-256 hash inside the session
 * row, so a stolen cookie alone cannot authorize a mutation.
 */
function buildCsrfCookie(csrfToken, isSecure = false) {
  const parts = [
    `topspin_csrf=${encodeURIComponent(csrfToken)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SEC}`,
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

function clearCsrfCookie() {
  return 'topspin_csrf=; Path=/; SameSite=Lax; Max-Age=0';
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createAdminSession(db, { actor, ipHash = null, userAgent = null }) {
  const sid = crypto.randomUUID();
  const csrfToken = crypto.randomBytes(24).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SEC * 1000).toISOString();
  db.prepare(
    `INSERT INTO admin_sessions
     (id, actor_id, username, role, ip_hash, ua_hash, csrf_hash, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sid,
    actor.id,
    actor.username,
    actor.role,
    ipHash,
    userAgent ? hashIdentifier(userAgent) : null,
    sha256(csrfToken),
    now.toISOString(),
    now.toISOString(),
    expiresAt
  );
  return { sid, csrfToken, expiresAt };
}

function getActiveSession(db, sid) {
  if (!db || !sid) return null;
  const row = db
    .prepare('SELECT * FROM admin_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?')
    .get(sid, new Date().toISOString());
  return row || null;
}

function touchAdminSession(db, sid) {
  if (!db || !sid) return;
  try {
    db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?').run(
      new Date().toISOString(),
      sid
    );
  } catch {
    /* session touching must never break a request */
  }
}

function revokeAdminSession(db, sid, actorId = null) {
  if (!db || !sid) return false;
  const sql = actorId
    ? 'UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND actor_id = ? AND revoked_at IS NULL'
    : 'UPDATE admin_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL';
  const params = actorId
    ? [new Date().toISOString(), sid, actorId]
    : [new Date().toISOString(), sid];
  const res = db.prepare(sql).run(...params);
  return Number(res.changes || 0) > 0;
}

function listAdminSessions(db, actorId) {
  return db
    .prepare(
      `SELECT id, actor_id, username, role, ip_hash, created_at, last_seen_at, expires_at, revoked_at
       FROM admin_sessions WHERE actor_id = ? ORDER BY last_seen_at DESC LIMIT 25`
    )
    .all(actorId);
}

function cleanupAdminSessions(db) {
  const cutoff = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  const res = db
    .prepare('DELETE FROM admin_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)')
    .run(cutoff, cutoff);
  return Number(res.changes || 0);
}

function verifyCsrf(db, req, principal, cookies) {
  // Bearer-authenticated API clients are not exposed to ambient-credential CSRF.
  const viaBearer = String(req.headers['authorization'] || '').startsWith('Bearer ');
  if (viaBearer) return true;
  const header = String(req.headers['x-csrf-token'] || '');
  const cookie = cookies['topspin_csrf'] || '';
  if (!header || !cookie || header !== cookie) return false;
  const session = getActiveSession(db, principal.sid);
  if (!session) return false;
  return session.csrf_hash === sha256(header);
}

// 5 failed attempts per 5 minutes brute-force guard (04-security.md)
const loginAttemptBuckets = new Map();

function checkLoginAttemptLimit(key) {
  const now = Date.now();
  const entry = loginAttemptBuckets.get(key);
  if (entry && now < entry.resetAt && entry.failed >= 5) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true };
}

function recordFailedLoginAttempt(key) {
  const now = Date.now();
  const entry = loginAttemptBuckets.get(key) || { failed: 0, resetAt: now + 5 * 60_000 };
  if (now > entry.resetAt) {
    entry.failed = 0;
    entry.resetAt = now + 5 * 60_000;
  }
  entry.failed++;
  loginAttemptBuckets.set(key, entry);
}

function clearLoginAttempts(key) {
  loginAttemptBuckets.delete(key);
}

function ensureBootstrapAdmin(db) {
  const existing = db
    .prepare('SELECT id FROM admin_users WHERE lower(username) = ?')
    .get(CONFIG.adminEmail.toLowerCase());
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO admin_users (id, username, password_hash, role, display_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    CONFIG.adminEmail.toLowerCase(),
    hashPassword(CONFIG.adminPassword),
    ROLES.ADMIN,
    'Владелец TOPSPIN ARENA',
    new Date().toISOString()
  );
  return id;
}

module.exports = {
  ROLE_PERMISSIONS: GRANULAR_ROLES,
  hasPermission: hasGranularPermission,
  legacyHasPermission: hasGranularPermission,
  hashPassword,
  verifyPassword,
  signToken,
  verifyHmacJwt,
  signPlayerToken,
  authenticatePlayerRequest,
  signSessionAffinityToken,
  verifySessionAffinityToken,
  authenticateAdminRequest,
  buildSessionCookie,
  clearSessionCookie,
  buildCsrfCookie,
  clearCsrfCookie,
  SESSION_TTL_SEC,
  createAdminSession,
  getActiveSession,
  touchAdminSession,
  revokeAdminSession,
  listAdminSessions,
  cleanupAdminSessions,
  verifyCsrf,
  parseCookies,
  checkLoginAttemptLimit,
  recordFailedLoginAttempt,
  clearLoginAttempts,
  ensureBootstrapAdmin,
  hashIdentifier,
};
