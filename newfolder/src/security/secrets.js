'use strict';

/**
 * Secret vault for per-zone provider API keys (`04-security.md` → isolated zone keys).
 *
 * Design decisions, and why they are what they are:
 *  - **Encrypted at rest, not hashed.** A provider key must be *used*, so a hash is
 *    useless. AES-256-GCM gives confidentiality + integrity and detects a tampered
 *    ciphertext instead of sending garbage to a provider.
 *  - **The encryption key never lives in the database.** It is derived (scrypt) from
 *    `KEY_ENCRYPTION_SECRET`, falling back to the session secret so a fresh install
 *    still works. A stolen `crm.sqlite` alone therefore does not reveal provider keys.
 *  - **Environment variables win.** Ops reality: secrets usually come from the
 *    orchestrator/secret manager. If `ZONE_X_API_KEY` is set, a database key is
 *    ignored — and the API says so via `keySource`, otherwise rotation would look
 *    broken ("I changed the key and nothing happened").
 *  - **Nothing returns the plaintext.** The API exposes `keySource`, a stable
 *    fingerprint prefix and a masked tail; the audit records the fingerprint only.
 */

const crypto = require('node:crypto');
const { CONFIG } = require('../config');

const VERSION = 'v1';
const SCRYPT_SALT = 'topspin-arena-secret-vault-v1';

let cachedKey = null;

function encryptionKey() {
  if (cachedKey) return cachedKey;
  const secret =
    process.env.KEY_ENCRYPTION_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET ||
    CONFIG.jwtSecret ||
    'topspin-arena-dev-secret-vault';
  cachedKey = crypto.scryptSync(String(secret), SCRYPT_SALT, 32, { N: 16384, r: 8, p: 1 });
  return cachedKey;
}

/** Test hook: forget the derived key (used when a suite rotates the env secret). */
function resetSecretVaultCache() {
  cachedKey = null;
}

function encryptSecret(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

function decryptSecret(blob) {
  if (!blob || typeof blob !== 'string') return null;
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Wrong encryption secret or tampered ciphertext: behave like "no key" so the
    // zone degrades to its local fallback instead of failing the whole request.
    return null;
  }
}

/** Stable, non-reversible identity of a key: used in audit and in the UI table. */
function fingerprintSecret(plaintext) {
  return crypto.createHash('sha256').update(String(plaintext)).digest('hex').slice(0, 12);
}

/** `sk-or-v1-…4f2a` → `••••4f2a`; short keys are masked completely. */
function maskSecret(plaintext) {
  const value = String(plaintext || '');
  if (value.length < 8) return '••••';
  return `••••${value.slice(-4)}`;
}

/**
 * Validates an operator-supplied provider key before it is stored.
 * Rejects the shapes that silently break calls: whitespace, quotes pasted from a
 * `.env` line, `Bearer ` prefixes and absurd lengths.
 */
function validateProviderKey(raw) {
  const value = String(raw ?? '').trim();
  // Order matters for usability: the most specific explanation wins, because
  // `Bearer sk-…` also contains whitespace and would otherwise report "пробелы".
  if (/^Bearer\s/i.test(value)) {
    return { ok: false, error: 'API_KEY_HAS_SCHEME', message: 'Уберите префикс «Bearer» — нужен только сам ключ' };
  }
  if (/^["'](.+)["']$/.test(value)) {
    return { ok: false, error: 'API_KEY_HAS_QUOTES', message: 'Уберите кавычки вокруг ключа' };
  }
  if (/\s/.test(value)) return { ok: false, error: 'API_KEY_HAS_WHITESPACE', message: 'Ключ содержит пробелы' };
  if (value.length < 8) return { ok: false, error: 'API_KEY_TOO_SHORT', message: 'Ключ короче 8 символов' };
  if (value.length > 256) return { ok: false, error: 'API_KEY_TOO_LONG', message: 'Ключ длиннее 256 символов' };
  return { ok: true, value };
}

module.exports = {
  encryptSecret,
  decryptSecret,
  fingerprintSecret,
  maskSecret,
  validateProviderKey,
  resetSecretVaultCache,
};
