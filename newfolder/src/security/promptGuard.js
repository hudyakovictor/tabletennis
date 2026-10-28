'use strict';

/**
 * Prompt Injection & PII Scrubbing Guard (03-director-chat.md, 04-security.md, 07-ai-providers.md)
 *
 * 1. Never sends emails, IPs, device_fingerprint_hash, or telegram_id_hash to external AI models.
 * 2. Detects prompt-injection phrases inside untrusted strings (campaigns, nicknames, tickets, logs)
 *    and neutralizes delimiter-escape sequences.
 * 3. Wraps all untrusted telemetry payloads inside a strict `DATA` block separated from `SYSTEM`.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+|previous\s+|prior\s+)?instructions/gi,
  /system\s*prompt/gi,
  /you\s+are\s+now\s+/gi,
  /ban\s+all\s+players/gi,
  /drop\s+table/gi,
  /\[system\]/gi,
  /<\/?untrusted_data_json>/gi,
  /disregard\s+(?:above|earlier)/gi,
];

const PII_FIELD_NAMES = new Set([
  'email',
  'email_hash',
  'ip',
  'ip_hash',
  'device_fingerprint',
  'device_fingerprint_hash',
  'telegram_id',
  'telegram_id_hash',
  'password',
  'password_hash',
  'api_key',
  'apiKey',
]);

function detectPromptInjection(value) {
  const str = typeof value === 'string' ? value : JSON.stringify(value || '');
  const matches = [];
  for (const re of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(str);
    if (m) matches.push(m[0]);
  }
  return {
    suspicious: matches.length > 0,
    matches,
  };
}

function scrubPiiAndSanitize(input) {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') {
    return input
      .replace(/<\/?UNTRUSTED_DATA_JSON>/gi, '[ESCAPED_TAG]')
      .replace(/\[(SYSTEM|USER|ASSISTANT)\]/gi, '($1)')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_IP]');
  }
  if (Array.isArray(input)) {
    return input.map(scrubPiiAndSanitize);
  }
  if (typeof input === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(input)) {
      if (PII_FIELD_NAMES.has(k)) continue;
      clean[k] = scrubPiiAndSanitize(v);
    }
    return clean;
  }
  return input;
}

function buildIsolatedDataBlock(dataObj) {
  const sanitized = scrubPiiAndSanitize(dataObj);
  return `<UNTRUSTED_DATA_JSON>\n${JSON.stringify(sanitized, null, 2)}\n</UNTRUSTED_DATA_JSON>`;
}

module.exports = {
  detectPromptInjection,
  scrubPiiAndSanitize,
  buildIsolatedDataBlock,
};
