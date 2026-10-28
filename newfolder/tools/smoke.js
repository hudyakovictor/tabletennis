#!/usr/bin/env node
/* Быстрый smoke без внешних зависимостей: поднимает CRM на случайном порту,
 * наполняет in-memory БД и проверяет ключевые API. */
import { createRuntime } from '../server/index.js';
import { loadConfig } from '../server/config.js';

const cfg = loadConfig({ CRM_ENV: 'test', ADMIN_PASSWORD: 'smoke-password-123', DEMO_DATA: '1', JOBS_ENABLED: '0', BOT_ENABLED: '0', INGEST_KEYS: 'smoke:smoke-secret' }, { dbPath: ':memory:', port: 0, host: '127.0.0.1' });
const runtime = createRuntime({ cfg });
const address = await runtime.start();
const base = `http://127.0.0.1:${address.port}`;
try {
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'owner', password: 'smoke-password-123' }) });
  if (!login.ok) throw new Error(`login ${login.status}`);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf } = await login.json();
  const paths = ['/', '/api/health', '/api/overview', '/api/ops', '/api/balance', '/api/market', '/api/economy', '/api/players', '/api/fraud', '/api/lab', '/api/ai', '/api/director/context', '/api/liveops', '/api/settings', '/api/integration'];
  for (const path of paths) {
    const res = await fetch(base + path, { headers: { Cookie: cookie } });
    console.log(`${res.status} ${path}`);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
  }
  const zone = await fetch(`${base}/api/ai/zones/balance/run`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' }, body: '{}' });
  if (!zone.ok) throw new Error(`zone ${zone.status}`);
  console.log('200 /api/ai/zones/balance/run');
  console.log('\nSMOKE OK');
} finally { await runtime.stop(); }
