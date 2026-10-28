import crypto from 'node:crypto';
import { createRuntime } from '../index.js';
import { loadConfig } from '../config.js';

export async function testRuntime({ demo = false } = {}) {
  const cfg = loadConfig({
    CRM_ENV: 'test', ADMIN_PASSWORD: 'test-password-123', SESSION_SECRET: 'test-session-secret',
    DEMO_DATA: demo ? '1' : '0', JOBS_ENABLED: '0', BOT_ENABLED: '0',
    INGEST_KEYS: 'test-key:test-secret-key-32-characters-long',
    AI_LOCAL_FALLBACK: '1', COOKIE_SECURE: '0', FRAME_ANCESTORS: '*',
  }, { dbPath: ':memory:', port: 0, host: '127.0.0.1', jobsEnabled: false });
  const runtime = createRuntime({ cfg });
  const address = await runtime.start();
  const base = `http://127.0.0.1:${address.port}`;
  return {
    runtime, db: runtime.db, cfg, base,
    async stop() { await runtime.stop(); },
    async login() {
      const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'test-password-123' }) });
      if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`);
      const cookie = res.headers.get('set-cookie').split(';')[0];
      const data = await res.json();
      return { cookie, csrf: data.csrf, user: data.user };
    },
  };
}

export function client(base, session = {}) {
  return async function request(path, { method = 'GET', body, headers = {}, signed = false } = {}) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const h = { Accept: 'application/json', ...headers };
    if (session.cookie) h.Cookie = session.cookie;
    if (session.csrf && !['GET', 'HEAD'].includes(method)) h['X-CSRF-Token'] = session.csrf;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (signed) {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      h['x-tt-key'] = 'test-key';
      h['x-tt-timestamp'] = timestamp;
      h['x-tt-signature'] = crypto.createHmac('sha256', 'test-secret-key-32-characters-long').update(`${timestamp}.${raw}`).digest('hex');
      h['x-tt-nonce'] = crypto.randomUUID();
    }
    const res = await fetch(`${base}${path}`, { method, headers: h, body: body === undefined ? undefined : raw });
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = text; }
    return { status: res.status, data, headers: res.headers, text };
  };
}

export function event(type, data = {}, extra = {}) {
  return { id: crypto.randomUUID(), type, ts: new Date().toISOString(), region: 'RU', player_id: 'player-test', session_id: 'session-test', data, ...extra };
}
