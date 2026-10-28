/* Маленькие утилиты без зависимостей. Всё, что попадает в БД/AI/UI,
 * проходит через нормализацию здесь. */
import crypto from 'node:crypto';

export const uuid = () => crypto.randomUUID();
export const nowISO = (d = new Date()) => new Date(d).toISOString();
export const iso = (ms) => new Date(ms).toISOString();
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const round = (v, n = 2) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(n)) : 0;
export const pct = (a, b) => b > 0 ? round(a / b * 100, 2) : 0;
export const sum = (arr) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
export const avg = (arr) => arr.length ? sum(arr) / arr.length : 0;
export const safeJSON = (s, dflt = null) => { try { return JSON.parse(s); } catch { return dflt; } };
export const stableStringify = (o) => JSON.stringify(o, Object.keys(o).sort?.() ? undefined : undefined);

/** Строка без управляющих символов и с ограниченной длиной.
 * Защита от log-forging, prompt-injection разделителей и XSS в логах. */
export function cleanStr(v, max = 2000) {
  if (v === null || v === undefined) return '';
  return String(v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Экранирование для HTML в серверных шаблонах и Telegram (HTML parse_mode). */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Данные в блоке [DATA] не должны иметь возможности подделать разметку блоков. */
export function sanitizeForPrompt(v) {
  return cleanStr(v, 12000)
    .replace(/\[\/?(SYSTEM|DATA|ZONE SUMMARIES|CHAT HISTORY|USER QUESTION|INSTRUCTIONS)\]/gi, '[block]')
    .replace(/<<<[^>]*>>>/g, '[marker]')
    .replace(/ignore (all |any )?previous instructions/gi, '[filtered]');
}

export function hashValue(secret, value) {
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function hmacHex(secret, message) {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function timingSafeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

export function scryptHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function scryptVerify(password, stored) {
  try {
    const [, salt, hash] = String(stored).split('$');
    const candidate = crypto.scryptSync(String(password), salt, 64);
    return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
  } catch { return false; }
}

export function rangeStart(range = '24h', now = Date.now()) {
  const map = {
    '1h': 3600e3, '24h': 86400e3, '48h': 2 * 86400e3,
    '7d': 7 * 86400e3, '14d': 14 * 86400e3, '30d': 30 * 86400e3,
    '90d': 90 * 86400e3, 'all': 20 * 365 * 86400e3,
  };
  return new Date(now - (map[range] || map['7d'])).toISOString();
}

export function bucketISO(ts, bucket = 'day') {
  const d = new Date(ts);
  if (bucket === 'hour') return d.toISOString().slice(0, 13) + ':00';
  return d.toISOString().slice(0, 10);
}

/** Заполняет пропущенные дни/часы нулями — графики не «прыгают». */
export function fillSeries(rows, fromISO, days = 7, key = 'day', valueKey = 'value') {
  const map = new Map(rows.map(r => [String(r[key]), Number(r[valueKey]) || 0]));
  const out = [];
  const start = new Date(fromISO);
  start.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400e3);
    const k = d.toISOString().slice(0, 10);
    out.push({ day: k, value: map.get(k) || 0 });
  }
  return out;
}

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = clamp(Math.ceil(p / 100 * sorted.length) - 1, 0, sorted.length - 1);
  return sorted[i];
}

/** Детерминированный PRNG — демо-данные и локальный AI воспроизводимы. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function pick(rnd, arr) { return arr[Math.floor(rnd() * arr.length)]; }

export function daysAgoISO(n, now = Date.now()) { return iso(now - n * 86400e3); }

/** Простая проверка ISO-даты: строки сравнимы лексикографически. */
export function validISO(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v)
    && !Number.isNaN(Date.parse(v));
}
