'use strict';

/**
 * Authentication, scrypt Password Hashing, 5-Attempt Brute-Force Guard,
 * 8-Role RBAC & TMA Session Affinity Tokens (04-security.md, 13-telegram-miniapp-latency.md)
 */

const crypto = require('node:crypto');
const { CONFIG, ROLES } = require('../config');
const { hashIdentifier } = require('./audit');

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

function signToken({ sub, username, role, displayName }) {
  return signHmacJwt({ sub, username, role, displayName, typ: 'admin' }, 12 * 3600);
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

function authenticateAdminRequest(req) {
  const auth = req.headers['authorization'];
  let raw = null;
  if (auth && auth.startsWith('Bearer ')) {
    raw = auth.slice(7).trim();
  } else {
    const cookies = parseCookies(req.headers['cookie']);
    raw = cookies['topspin_crm_token'] || null;
  }
  if (!raw) return null;
  return verifyHmacJwt(raw);
}

function authenticatePlayerRequest(req) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const p = verifyHmacJwt(auth.slice(7).trim());
  if (!p || p.role !== ROLES.PLAYER) return null;
  return p;
}

function buildSessionCookie(token, isSecure = false) {
  const parts = [
    `topspin_crm_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${12 * 3600}`,
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie() {
  return 'topspin_crm_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
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
  ROLE_PERMISSIONS,
  hasPermission,
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
  checkLoginAttemptLimit,
  recordFailedLoginAttempt,
  clearLoginAttempts,
  ensureBootstrapAdmin,
  hashIdentifier,
};
