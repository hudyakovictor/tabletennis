/* ─────────────────────────────────────────────────────────────────────────────
 * Авторизация админки (04-security.md): пароль → scrypt, сессия в HttpOnly
 * cookie, CSRF-токен, rate limiting логина, роли. Клиент игры сюда не ходит:
 * у него отдельный подписанный контракт (ingestAuth).
 * ─────────────────────────────────────────────────────────────────────────── */
import crypto from 'node:crypto';
import { nowISO, scryptVerify, scryptHash, uuid, hmacHex, timingSafeEqual, cleanStr } from './util.js';
import { audit } from './db.js';

const LOGIN_WINDOW_MS = 10 * 60e3;
const LOGIN_MAX = 8;
const BLOCK_MS = 10 * 60e3;

export function createRateLimiter({ windowMs = 60e3, max = 120 } = {}) {
  const buckets = new Map();
  return {
    check(key) {
      const now = Date.now();
      if (buckets.size > 5000) {
        for (const [k, value] of buckets) if (now - value.start > windowMs) buckets.delete(k);
      }
      const b = buckets.get(key);
      if (!b || now - b.start > windowMs) { buckets.set(key, { start: now, n: 1 }); return { ok: true, remaining: max - 1 }; }
      b.n++;
      return { ok: b.n <= max, remaining: Math.max(0, max - b.n), retryAfter: Math.ceil((b.start + windowMs - now) / 1000) };
    },
    reset(key) { buckets.delete(key); },
    clear() { buckets.clear(); },
    size() { return buckets.size; },
  };
}

export function createAuth(db, cfg) {
  const loginLimiter = createRateLimiter({ windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX });
  const generalLimiter = createRateLimiter({ windowMs: 60e3, max: 600 });

  function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
    }
    return out;
  }

  function login({ username, password, ip = '', userAgent = '' }) {
    const u = cleanStr(username, 80);
    const gate = loginLimiter.check(ip || u);
    if (!gate.ok) return { ok: false, error: 'Слишком много попыток. Попробуйте через 10 минут.', status: 429 };
    const row = db.prepare('SELECT * FROM users WHERE username=?').get(u);
    if (!row || !scryptVerify(String(password || ''), row.password_hash)) {
      audit(db, { actor: u, actorRole: 'anonymous', action: 'auth.login_failed', ip, result: 'denied' });
      return { ok: false, error: 'Неверный логин или пароль', status: 401 };
    }
    const session = {
      id: crypto.randomBytes(32).toString('hex'),
      user_id: row.id,
      csrf: crypto.randomBytes(24).toString('hex'),
      ip,
      user_agent: cleanStr(userAgent, 300),
      created_at: nowISO(),
      expires_at: nowISO(Date.now() + cfg.sessionTtlHours * 3600e3),
    };
    db.prepare(`INSERT INTO sessions(id,user_id,csrf,ip,user_agent,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?)`).run(session.id, session.user_id, session.csrf, session.ip,
        session.user_agent, session.created_at, session.expires_at);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(nowISO(), row.id);
    loginLimiter.reset(ip || u);
    audit(db, { actor: u, actorRole: row.role, action: 'auth.login', ip, result: 'ok' });
    return {
      ok: true,
      cookie: `tt_crm_session=${session.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${cfg.sessionTtlHours * 3600}${cfg.cookieSecure ? '; Secure' : ''}`,
      clearCookie: 'tt_crm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
      csrf: session.csrf,
      user: { id: row.id, username: row.username, role: row.role },
    };
  }

  function sessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies.tt_crm_session;
    if (!sid) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(sid);
    if (!s || s.expires_at < nowISO()) return null;
    const u = db.prepare('SELECT id,username,role FROM users WHERE id=?').get(s.user_id);
    if (!u) return null;
    return { session: s, user: u, csrf: s.csrf };
  }

  function csrfOk(req, ctx) {
    if (!ctx?.auth) return false;
    const token = req.headers['x-csrf-token'] || '';
    return timingSafeEqual(token, ctx.auth.csrf);
  }

  function logout(req, res) {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.tt_crm_session) {
      const s = db.prepare('SELECT user_id FROM sessions WHERE id=?').get(cookies.tt_crm_session);
      db.prepare('DELETE FROM sessions WHERE id=?').run(cookies.tt_crm_session);
      audit(db, { actor: s?.user_id || 'unknown', action: 'auth.logout', ip: req.ip || '' });
    }
    res.setHeader('Set-Cookie', 'tt_crm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  }

  function changePassword(userId, oldPassword, newPassword) {
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!row || !scryptVerify(String(oldPassword || ''), row.password_hash)) return { ok: false, error: 'Неверный текущий пароль' };
    if (String(newPassword || '').length < 10) return { ok: false, error: 'Новый пароль минимум 10 символов' };
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(scryptHash(newPassword), userId);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
    audit(db, { actor: row.username, action: 'auth.password_changed' });
    return { ok: true };
  }

  return { login, logout, sessionFromRequest, csrfOk, changePassword, loginLimiter, generalLimiter, parseCookies };
}

/** HMAC-SHA256 подпись батча от игрового бэкенда.
 * signature = hex(HMAC(secret, `${timestamp}.${rawBody}`))
 * Заголовки: x-tt-key, x-tt-timestamp, x-tt-signature, x-tt-nonce (опц.).
 */
export function verifyIngestSignature({ headers, rawBody, cfg, nonces }) {
  const keyId = cleanStr(headers['x-tt-key'], 80);
  const ts = cleanStr(headers['x-tt-timestamp'], 30);
  const sig = cleanStr(headers['x-tt-signature'], 200).replace(/^sha256=/, '');
  const secret = cfg.ingestKeys[keyId];
  if (!keyId || !secret) return { ok: false, error: 'unknown x-tt-key', status: 401 };
  if (!/^\d{10}$/.test(ts)) return { ok: false, error: 'invalid x-tt-timestamp (unix seconds)', status: 401 };
  const skew = Math.abs(Date.now() / 1000 - Number(ts));
  if (skew > cfg.ingestMaxSkewSec) return { ok: false, error: 'timestamp outside allowed skew', status: 401 };
  const expected = hmacHex(secret, `${ts}.${rawBody}`);
  if (!timingSafeEqual(sig, expected)) return { ok: false, error: 'invalid signature', status: 401 };
  const nonce = cleanStr(headers['x-tt-nonce'], 120);
  if (nonce && nonces) {
    if (nonces.has(nonce)) return { ok: false, error: 'nonce replay', status: 409 };
    nonces.set(nonce, Date.now());
  }
  return { ok: true, keyId };
}
