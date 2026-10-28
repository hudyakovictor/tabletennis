/* HTTP-защита: CORS, CSP, security headers, лимиты тела, client IP.
 * CSP: inline-скрипты запрещены, стили — 'unsafe-inline' (динамические графики),
 * frame-ancestors настраивается (по умолчанию * для iframe-превью). */
import { cleanStr } from './util.js';

export function applySecurity(req, res, cfg, { isApi = true } = {}) {
  const origin = req.headers.origin || '';
  const allow = isApi && (req.url || '').startsWith('/api/client/')
    ? cfg.clientOrigins : cfg.adminOrigins;
  if (origin && allow.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-TT-Key, X-TT-Timestamp, X-TT-Signature, X-TT-Nonce, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cache-Control', 'no-store');
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${cfg.frameAncestors}`,
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  if (cfg.envName === 'production' && cfg.cookieSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export function clientIp(req) {
  // Доверяем proxy-заголовку только если явно разрешено (по умолчанию нет).
  const fwd = cleanStr(req.headers['x-forwarded-for'], 200);
  if (process.env.TRUST_PROXY === '1' && fwd) return fwd.split(',')[0].trim();
  return (req.socket?.remoteAddress || 'unknown').replace('::ffff:', '');
}

export async function readBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        done = true;
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

export async function readJson(req, maxBytes = 5 * 1024 * 1024) {
  const buf = await readBody(req, maxBytes);
  if (!buf.length) return { raw: '', body: {} };
  const raw = buf.toString('utf8');
  let body;
  try { body = JSON.parse(raw); }
  catch { throw Object.assign(new Error('invalid JSON'), { status: 400 }); }
  return { raw, body };
}

/** Экспорт несекретной части конфигурации для UI (никаких ключей). */
export function maskSecret(s) {
  if (!s) return '';
  return s.slice(0, 3) + '••••' + s.slice(-3);
}
