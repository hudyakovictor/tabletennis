import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { testRuntime, client, event } from './helpers.js';
import { insert, getSetting } from '../db.js';
import { uuid } from '../util.js';

let env, request, session;
before(async () => {
  env = await testRuntime({ demo: true });
  session = await env.login();
  request = client(env.base, session);
});
after(async () => { await env.stop(); });

test('health, SPA and security headers are public; admin API is not', async () => {
  const open = client(env.base);
  const health = await open('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);
  const page = await open('/');
  assert.equal(page.status, 200);
  assert.match(page.text, /TOPSPIN ARENA/);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const module = await open('/js/app.js');
  assert.equal(module.status, 200);
  const denied = await open('/api/overview');
  assert.equal(denied.status, 401);
});

test('admin mutations require CSRF', async () => {
  const noCsrf = client(env.base, { cookie: session.cookie });
  const r = await noCsrf('/api/pushes', { method: 'POST', body: { title: 'x', body: 'y' } });
  assert.equal(r.status, 403);
});

test('signed ingestion accepts a batch and rejects bad signature', async () => {
  const signed = client(env.base);
  const e = event('input', { accepted: 0, reject_code: 'WRONG_DIRECTION', pointer_type: 'touch', along: 12, across: 8 }, { id: 'api-ingest-test' });
  const ok = await signed('/api/ingest/events', { method: 'POST', body: { events: [e] }, signed: true });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.data.accepted, 1);
  const bad = await signed('/api/ingest/events', { method: 'POST', body: { events: [e] }, headers: { 'x-tt-key': 'test-key', 'x-tt-timestamp': '1', 'x-tt-signature': 'bad' } });
  assert.equal(bad.status, 401);
});

test('all dashboard endpoints return real data', async () => {
  for (const path of ['/api/overview?range=7d', '/api/ops?range=24h', '/api/balance?range=7d', '/api/market?range=30d', '/api/economy?range=30d', '/api/players', '/api/fraud', '/api/lab', '/api/ai', '/api/director/context', '/api/proposals', '/api/liveops', '/api/settings', '/api/integration', '/api/audit']) {
    const r = await request(path);
    assert.equal(r.status, 200, `${path}: ${r.text.slice(0, 200)}`);
  }
  const players = await request('/api/players?limit=5');
  assert.ok(players.data.total >= 200);
  assert.equal(players.data.rows.length, 5);
});

test('public config/feed contain no secrets and separate pushes from news', async () => {
  const open = client(env.base);
  const config = await open('/api/client/config');
  assert.equal(config.status, 200);
  assert.ok('maintenance' in config.data);
  assert.ok(!JSON.stringify(config.data).includes('test-secret'));
  const feed = await open('/api/client/feed');
  assert.ok(Array.isArray(feed.data.pushes));
  assert.ok(Array.isArray(feed.data.news));
  assert.ok(feed.data.pushes.every(p => p.important));
});

test('maintenance toggle creates automatic priority push', async () => {
  const before = await request('/api/pushes');
  const r = await request('/api/maintenance', { method: 'POST', body: { enabled: true, text: 'Плановые работы', eta: '10 минут' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.state.enabled, true);
  assert.ok(r.data.push);
  const after = await request('/api/pushes');
  assert.ok(after.data.length > before.data.length);
  const feed = await client(env.base)('/api/client/feed');
  assert.equal(feed.data.maintenance.enabled, true);
  await request('/api/maintenance', { method: 'POST', body: { enabled: false, text: 'Плановые работы', eta: '' } });
});

test('news CRUD and manual push are audited', async () => {
  const created = await request('/api/news', { method: 'POST', body: { title: 'Test patch', body: 'Safe <script>alert(1)</script>', category: 'patch_notes', status: 'published' } });
  assert.equal(created.status, 200);
  const id = created.data.id;
  const updated = await request(`/api/news/${id}`, { method: 'PATCH', body: { title: 'Test patch 2', body: 'Fixed', category: 'patch_notes', status: 'published' } });
  assert.equal(updated.data.title, 'Test patch 2');
  const push = await request('/api/pushes', { method: 'POST', body: { title: 'Critical test', body: 'Restored', level: 'critical', channels: ['in-app'] } });
  assert.equal(push.data.status, 'sent');
  const removed = await request(`/api/news/${id}`, { method: 'DELETE', body: {} });
  assert.equal(removed.status, 200);
  const audit = await request('/api/audit?limit=20');
  assert.ok(audit.data.some(a => a.action === 'news.saved'));
  assert.ok(audit.data.some(a => a.action === 'push.sent'));
});

test('support ticket workflow and signed client API', async () => {
  const created = await client(env.base)('/api/client/tickets', { method: 'POST', body: { player_id: 'p-0001', subject: 'Test ticket', body: 'Input fails', region: 'RU' }, signed: true });
  assert.equal(created.status, 200, created.text);
  const id = created.data.id;
  const answered = await request(`/api/tickets/${id}`, { method: 'PATCH', body: { status: 'resolved', reply: 'Fixed in next build' } });
  assert.equal(answered.data.status, 'resolved');
  assert.ok(answered.data.messages.some(m => m.author_role === 'support'));
  const own = await client(env.base)(`/api/client/tickets?player_id=p-0001`, { signed: true });
  assert.equal(own.status, 200);
  assert.ok(own.data.some(t => t.id === id));
  const forbidden = await client(env.base)(`/api/client/tickets/${id}?player_id=another-player`, { signed: true });
  assert.equal(forbidden.status, 403);
});

test('AI zone output is valid and director responds from summaries', async () => {
  const zone = await request('/api/ai/zones/ops/run', { method: 'POST', body: {} });
  assert.equal(zone.status, 200, zone.text);
  assert.equal(zone.data.ok, true);
  assert.equal(zone.data.summary.zone, 'ops');
  const chat = await request('/api/director/chat', { method: 'POST', body: { question: 'Какие зоны требуют внимания?' } });
  assert.equal(chat.status, 200, chat.text);
  assert.ok(['ok', 'warning', 'critical'].includes(chat.data.answer.status));
  assert.ok(chat.data.answer.summary.length > 10);
  assert.ok(!('action' in chat.data.answer));
});

test('proposal needs approve then execute and changes only whitelisted config', async () => {
  const id = uuid();
  insert(env.db, 'proposals', { id, ts: new Date().toISOString(), zone: 'balance', source: 'test', kind: 'update_rules', title: 'Test rule change', payload: JSON.stringify({ key: 'ovalSideTouchPx', value: 66 }), rationale: 'test', confidence: .9, status: 'pending' });
  const early = await request(`/api/proposals/${id}/execute`, { method: 'POST', body: {} });
  assert.equal(early.status, 409);
  const approved = await request(`/api/proposals/${id}/review`, { method: 'POST', body: { decision: 'approve', note: 'checked' } });
  assert.equal(approved.data.status, 'approved');
  const executed = await request(`/api/proposals/${id}/execute`, { method: 'POST', body: {} });
  assert.equal(executed.status, 200, executed.text);
  assert.equal(getSetting(env.db, 'match_rules').ovalSideTouchPx, 66);
});

test('settings validation rejects unknown MATCH_RULES fields', async () => {
  const bad = await request('/api/settings', { method: 'PATCH', body: { match_rules: { admin_api_key: 'hack' } } });
  assert.equal(bad.status, 400);
  const good = await request('/api/settings', { method: 'PATCH', body: { feature_flags: { leaderboard: false } } });
  assert.equal(good.status, 200);
  const config = await client(env.base)('/api/client/config');
  assert.equal(config.data.feature_flags.leaderboard, false);
});

test('player detail, fraud review and data deletion are owner actions', async () => {
  const detail = await request('/api/players/p-0001');
  assert.equal(detail.status, 200);
  assert.equal(detail.data.player.id, 'p-0001');
  const score = await request('/api/fraud/score/p-0001', { method: 'POST', body: { create_case: true } });
  assert.equal(score.status, 200);
  const removed = await request('/api/players/p-0001/delete-data', { method: 'POST', body: { confirm: 'p-0001' } });
  assert.equal(removed.status, 200);
  const after = await request('/api/players/p-0001');
  assert.equal(after.data.player.status, 'deleted');
  assert.equal(after.data.player.device_fingerprint_hash, null);
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM input_logs WHERE player_id=?').get('p-0001').n, 0);
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM events WHERE player_id=?').get('p-0001').n, 0);
  assert.equal(env.db.prepare('SELECT COUNT(*) n FROM tickets WHERE player_id=?').get('p-0001').n, 0);
});

test('CSV export and integration metadata work without exposing secrets', async () => {
  const csv = await request('/api/export?entity=players&format=csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  const integration = await request('/api/integration');
  assert.equal(integration.data.schema.reject_codes.length, 10);
  assert.ok(!integration.text.includes('test-secret-key-32-characters-long'));
  assert.ok(integration.data.tables.players > 0);
});
