/* HTTP API + статика админки. Без фреймворков и внешних зависимостей.
 * Публичные endpoint'ы строго отделены от админских; все админские мутации
 * требуют сессию + CSRF. Приватные client API подписываются игровым бэкендом. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from './metrics.js';
import * as L from './liveops.js';
import * as A from './actions.js';
import { validateEvent, eventSchemaDoc } from './events.js';
import { ingestBatch } from './ingest.js';
import { applySecurity, clientIp, readJson } from './security.js';
import { verifyIngestSignature } from './auth.js';
import { runZoneAnalysis, runAllZones, ZONE_META } from './ai/zones.js';
import { askDirector, chatHistory, directorContext, setDirectorState, addDecision, archiveOldChat } from './ai/director.js';
import { scorePlayer, createCaseIfNeeded, scanActivePlayers, caseDetail, reviewCase } from './fraud.js';
import { evaluateAlerts, setAlertStatus } from './alerts.js';
import { publicConfig } from './config.js';
import { audit, setSetting, getSetting, insert, updateRow, anonymizePlayer, tableCounts } from './db.js';
import { uuid, nowISO, cleanStr, safeJSON, esc } from './util.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const RUNBOOK_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../runbooks');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8' };

function routeRegex(template) {
  const keys = [];
  const pattern = template.split('/').map(part => {
    if (part.startsWith(':')) { keys.push(part.slice(1)); return '([^/]+)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${pattern}/?$`), keys };
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function csv(res, filename, rows) {
  const list = Array.isArray(rows) ? rows : [rows];
  const keys = [...new Set(list.flatMap(r => Object.keys(r || {})))];
  const quote = (v) => {
    let text = String(typeof v === 'object' && v !== null ? JSON.stringify(v) : v ?? '');
    // Защита от formula injection при открытии CSV в Excel/Sheets.
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const body = '\uFEFF' + [keys.map(quote).join(','), ...list.map(r => keys.map(k => quote(r[k])).join(','))].join('\r\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` });
  res.end(body);
}

export function createRouter({ db, cfg, auth, bot = null, jobs = null, logger = console }) {
  const routes = [];
  const nonces = new Map();
  const nonceTimer = setInterval(() => {
    const cutoff = Date.now() - cfg.ingestMaxSkewSec * 2000;
    for (const [k, ts] of nonces) if (ts < cutoff) nonces.delete(k);
  }, 60000);
  nonceTimer.unref?.();

  function route(method, template, handler, opts = {}) {
    routes.push({ method, template, handler, opts, ...routeRegex(template) });
  }
  const get = (p, h, o) => route('GET', p, h, o);
  const post = (p, h, o) => route('POST', p, h, o);
  const patch = (p, h, o) => route('PATCH', p, h, o);
  const del = (p, h, o) => route('DELETE', p, h, o);

  // ── Публичное / ingestion ────────────────────────────────────────────────
  get('/api/health', async () => ({ ok: true, service: 'topspin-crm', version: cfg.version, time: nowISO(), env: cfg.envName }), { public: true });
  get('/api/ingest/schema', async () => eventSchemaDoc(), { public: true });
  post('/api/ingest/events', async (ctx) => {
    const signature = verifyIngestSignature({ headers: ctx.req.headers, rawBody: ctx.raw, cfg, nonces });
    if (!signature.ok) return { status: signature.status, body: { error: signature.error } };
    const events = Array.isArray(ctx.body) ? ctx.body : ctx.body?.events;
    if (!Array.isArray(events)) return { status: 400, body: { error: 'body must be an array or {events:[]}' } };
    if (events.length > cfg.ingestMaxBatch) return { status: 413, body: { error: `batch too large, max ${cfg.ingestMaxBatch}` } };
    const checked = events.map(e => validateEvent(e));
    const result = ingestBatch(db, checked, { source: 'game-backend', keyId: signature.keyId });
    audit(db, { actor: signature.keyId, actorRole: 'game-backend', action: 'ingest.batch', ip: ctx.ip, payload: { accepted: result.accepted, duplicates: result.duplicates, rejected: result.rejected.length } });
    return { status: result.accepted || result.duplicates ? 200 : 400, body: result };
  }, { public: true, ingest: true });

  get('/api/client/config', async () => L.clientConfig(db, cfg), { public: true, client: true });
  get('/api/client/feed', async (ctx) => L.clientFeed(db, {
    playerId: cleanStr(ctx.query.get('player_id'), 120), region: cleanStr(ctx.query.get('region'), 8).toUpperCase(), platform: cleanStr(ctx.query.get('platform'), 30),
  }), { public: true, client: true });
  post('/api/client/pushes/:id/read', async (ctx) => L.markPushRead(db, ctx.params.id, cleanStr(ctx.body.player_id, 120), { dismissed: !!ctx.body.dismissed }), { public: true, signed: true, client: true });
  post('/api/client/tickets', async (ctx) => L.createTicket(db, { ...ctx.body, player_id: ctx.body.player_id }, { source: 'client-backend' }), { public: true, signed: true, client: true });
  get('/api/client/tickets', async (ctx) => {
    const playerId = cleanStr(ctx.query.get('player_id'), 120);
    if (!playerId) return { status: 400, body: { error: 'player_id required' } };
    return db.prepare('SELECT id,ts,subject,status,priority,updated_at FROM tickets WHERE player_id=? ORDER BY updated_at DESC LIMIT 50').all(playerId);
  }, { public: true, signed: true, client: true });
  get('/api/client/tickets/:id', async (ctx) => {
    const t = L.ticketDetail(db, ctx.params.id);
    if (!t) return { status: 404, body: { error: 'ticket not found' } };
    if (t.player_id !== cleanStr(ctx.query.get('player_id'), 120)) return { status: 403, body: { error: 'forbidden' } };
    return { ...t, messages: t.messages.filter(m => m.visible_to_player) };
  }, { public: true, signed: true, client: true });
  post('/api/client/consents', async (ctx) => {
    const e = validateEvent({ ...ctx.body, type: 'consent', ts: ctx.body.ts || nowISO() });
    if (!e.ok) return { status: 400, body: { error: e.error } };
    return ingestBatch(db, [e], { source: 'client-backend', keyId: ctx.signature.keyId });
  }, { public: true, signed: true, client: true });
  post('/api/client/deletion', async (ctx) => {
    const e = validateEvent({ ...ctx.body, type: 'deletion_request', ts: ctx.body.ts || nowISO() });
    if (!e.ok) return { status: 400, body: { error: e.error } };
    return ingestBatch(db, [e], { source: 'client-backend', keyId: ctx.signature.keyId });
  }, { public: true, signed: true, client: true });

  // ── Авторизация владельца ────────────────────────────────────────────────
  post('/api/auth/login', async (ctx) => {
    const result = auth.login({ username: ctx.body.username, password: ctx.body.password, ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] });
    if (!result.ok) return { status: result.status, body: { error: result.error } };
    ctx.res.setHeader('Set-Cookie', result.cookie);
    return { csrf: result.csrf, user: result.user };
  }, { public: true });
  get('/api/auth/me', async (ctx) => ({ user: ctx.auth.user, csrf: ctx.auth.csrf, config: publicConfig(cfg) }));
  post('/api/auth/logout', async (ctx) => { auth.logout(ctx.req, ctx.res); return { ok: true }; });
  post('/api/auth/password', async (ctx) => {
    const r = auth.changePassword(ctx.auth.user.id, ctx.body.old_password, ctx.body.new_password);
    if (!r.ok) return { status: 400, body: { error: r.error } };
    ctx.res.setHeader('Set-Cookie', 'tt_crm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { ok: true, relogin: true };
  });

  // ── Дашборды ─────────────────────────────────────────────────────────────
  get('/api/overview', async (ctx) => M.overview(db, ctx.query.get('range') || '7d'));
  get('/api/ops', async (ctx) => M.ops(db, ctx.query.get('range') || '24h'));
  get('/api/balance', async (ctx) => M.balance(db, ctx.query.get('range') || '7d', Object.fromEntries(ctx.query)));
  get('/api/market', async (ctx) => M.market(db, ctx.query.get('range') || '30d'));
  get('/api/economy', async (ctx) => M.economy(db, ctx.query.get('range') || '30d'));
  get('/api/events', async (ctx) => {
    const where = ['1=1']; const args = [];
    for (const key of ['type', 'player_id', 'region', 'session_id']) {
      const v = cleanStr(ctx.query.get(key), 120);
      if (v) { where.push(`${key}=?`); args.push(v); }
    }
    const limit = Math.min(200, Math.max(1, Number(ctx.query.get('limit')) || 50));
    const rows = db.prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT ?`).all(...args, limit);
    return { rows: rows.map(r => ({ ...r, payload: safeJSON(r.payload, {}) })), limit };
  });
  get('/api/export', async (ctx) => {
    const entity = cleanStr(ctx.query.get('entity'), 40);
    const tables = { players: 'players', payments: 'payments', alerts: 'alerts', tickets: 'tickets', fraud_cases: 'fraud_cases', ai_requests: 'ai_requests', audit_log: 'audit_log', news: 'news', proposals: 'proposals' };
    const table = tables[entity];
    if (!table) return { status: 400, body: { error: `entity must be ${Object.keys(tables).join('|')}` } };
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid DESC LIMIT 10000`).all();
    if (ctx.query.get('format') === 'json') return { rows };
    return { raw: true, send: () => csv(ctx.res, `${entity}-${nowISO().slice(0, 10)}.csv`, rows) };
  });

  // ── Игроки, согласия, удаление ───────────────────────────────────────────
  get('/api/players', async (ctx) => M.playersList(db, Object.fromEntries(ctx.query)));
  get('/api/players/:id', async (ctx) => {
    const d = M.playerDetail(db, ctx.params.id);
    return d || { status: 404, body: { error: 'player not found' } };
  });
  post('/api/players/:id/status', async (ctx) => {
    const p = db.prepare('SELECT * FROM players WHERE id=?').get(ctx.params.id);
    if (!p) return { status: 404, body: { error: 'player not found' } };
    const status = ctx.body.status;
    if (!['active', 'banned'].includes(status)) return { status: 400, body: { error: 'status must be active|banned' } };
    updateRow(db, 'players', p.id, status === 'banned'
      ? { status, banned_at: nowISO(), ban_reason: cleanStr(ctx.body.reason, 300) || 'Ручная блокировка владельцем' }
      : { status, banned_at: null, ban_reason: null, risk_score: Math.min(p.risk_score, 0.3) });
    audit(db, { actor: ctx.auth.user.username, action: `player.${status}`, target: p.id, payload: { reason: ctx.body.reason || '' }, ip: ctx.ip });
    return M.playerDetail(db, p.id);
  });
  post('/api/players/:id/consents', async (ctx) => {
    const allowed = ['consent_telemetry', 'consent_ai_analysis', 'consent_marketing'];
    const patch = {};
    for (const k of allowed) if (ctx.body[k] !== undefined) patch[k] = ctx.body[k] ? 1 : 0;
    updateRow(db, 'players', ctx.params.id, patch);
    insert(db, 'consents', { id: uuid(), player_id: ctx.params.id, region: db.prepare('SELECT region FROM players WHERE id=?').get(ctx.params.id)?.region || 'OTHER', ts: nowISO(), telemetry: patch.consent_telemetry ?? null, ai_analysis: patch.consent_ai_analysis ?? null, marketing: patch.consent_marketing ?? null, source: 'admin' });
    audit(db, { actor: ctx.auth.user.username, action: 'player.consents', target: ctx.params.id, payload: patch });
    return M.playerDetail(db, ctx.params.id);
  });
  post('/api/players/:id/delete-data', async (ctx) => {
    if (ctx.body.confirm !== ctx.params.id) return { status: 400, body: { error: 'confirm must equal player id' } };
    anonymizePlayer(db, ctx.params.id);
    db.prepare(`UPDATE deletion_requests SET status='completed', completed_at=? WHERE player_id=?`).run(nowISO(), ctx.params.id);
    audit(db, { actor: ctx.auth.user.username, action: 'player.data_deleted', target: ctx.params.id, ip: ctx.ip });
    return { ok: true, anonymized: true, player_id: ctx.params.id };
  });

  // ── Fraud ────────────────────────────────────────────────────────────────
  get('/api/fraud', async (ctx) => M.fraudMetrics(db, ctx.query.get('range') || '7d'));
  get('/api/fraud/cases/:id', async (ctx) => caseDetail(db, ctx.params.id) || { status: 404, body: { error: 'case not found' } });
  post('/api/fraud/scan', async (ctx) => {
    const result = scanActivePlayers(db, { threshold: Number(ctx.body.threshold) || 0.55 });
    audit(db, { actor: ctx.auth.user.username, action: 'fraud.scan', payload: result });
    return result;
  });
  post('/api/fraud/score/:playerId', async (ctx) => {
    const score = scorePlayer(db, ctx.params.playerId);
    const result = ctx.body.create_case ? createCaseIfNeeded(db, score, { actor: ctx.auth.user.username }) : { score };
    audit(db, { actor: ctx.auth.user.username, action: 'fraud.score', target: ctx.params.playerId, payload: { risk: score.risk } });
    return result;
  });
  post('/api/fraud/cases/:id/review', async (ctx) => {
    const result = reviewCase(db, ctx.params.id, { status: ctx.body.status, note: ctx.body.note, actor: ctx.auth.user.username, ban: !!ctx.body.ban });
    if (!result.ok) return { status: 400, body: result };
    audit(db, { actor: ctx.auth.user.username, action: 'fraud.review', target: ctx.params.id, payload: { status: ctx.body.status, ban: !!ctx.body.ban, note: ctx.body.note } });
    return result;
  });

  // ── Lab ──────────────────────────────────────────────────────────────────
  get('/api/lab', async (ctx) => M.labMetrics(db, ctx.query.get('range') || '30d'));
  post('/api/lab/tests', async (ctx) => saveLabTest(db, ctx.body, ctx.auth.user.username));
  patch('/api/lab/tests/:id', async (ctx) => saveLabTest(db, ctx.body, ctx.auth.user.username, ctx.params.id));
  del('/api/lab/tests/:id', async (ctx) => {
    db.prepare('DELETE FROM lab_results WHERE test_id=?').run(ctx.params.id);
    db.prepare('DELETE FROM lab_tests WHERE id=?').run(ctx.params.id);
    audit(db, { actor: ctx.auth.user.username, action: 'lab.test_deleted', target: ctx.params.id });
    return { ok: true };
  });
  post('/api/lab/results', async (ctx) => {
    const test = db.prepare('SELECT id FROM lab_tests WHERE id=?').get(ctx.body.test_id);
    if (!test) return { status: 404, body: { error: 'test not found' } };
    const row = { id: uuid(), test_id: test.id, ts: nowISO(), variant: cleanStr(ctx.body.variant, 40), metric: cleanStr(ctx.body.metric, 80), value: Number(ctx.body.value) || 0, sample_size: Math.max(0, Number(ctx.body.sample_size) || 0) };
    if (!row.variant || !row.metric) return { status: 400, body: { error: 'variant and metric required' } };
    insert(db, 'lab_results', row);
    audit(db, { actor: ctx.auth.user.username, action: 'lab.result_added', target: test.id, payload: row });
    return row;
  });
  post('/api/lab/reports', async (ctx) => {
    const row = { id: uuid(), ts: nowISO(), title: cleanStr(ctx.body.title, 240), kind: cleanStr(ctx.body.kind || 'manual', 60), source: cleanStr(ctx.body.source || 'admin', 100), summary: cleanStr(ctx.body.summary, 6000), payload: JSON.stringify(ctx.body.payload || {}), zone: cleanStr(ctx.body.zone || 'lab', 20), created_by: ctx.auth.user.username };
    if (!row.title) return { status: 400, body: { error: 'title required' } };
    insert(db, 'lab_reports', row);
    return row;
  });

  // ── ИИ и директор ────────────────────────────────────────────────────────
  get('/api/ai', async (ctx) => ({ ...M.aiMetrics(db, cfg, ctx.query.get('range') || '7d'), zoneMeta: ZONE_META }));
  post('/api/ai/zones/run-all', async (ctx) => {
    const result = await runAllZones(db, cfg, { actor: ctx.auth.user.username });
    audit(db, { actor: ctx.auth.user.username, action: 'ai.run_all', payload: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.ok])) });
    return result;
  });
  post('/api/ai/zones/:zone/run', async (ctx) => {
    const result = await runZoneAnalysis(db, cfg, ctx.params.zone, { actor: ctx.auth.user.username });
    audit(db, { actor: ctx.auth.user.username, action: 'ai.zone_run', target: ctx.params.zone, payload: { ok: result.ok }, result: result.ok ? 'ok' : 'error' });
    return result.ok ? result : { status: 422, body: result };
  });
  get('/api/ai/summaries', async (ctx) => M.latestSummaries(db, ctx.query.get('zone') || 'ops', Number(ctx.query.get('limit')) || 20));
  post('/api/ai/quarantine/:id/resolve', async (ctx) => {
    updateRow(db, 'ai_quarantine', ctx.params.id, { resolved: 1 });
    audit(db, { actor: ctx.auth.user.username, action: 'ai.quarantine_resolved', target: ctx.params.id });
    return { ok: true };
  });
  get('/api/director/context', async () => directorContext(db, cfg));
  get('/api/director/chat', async (ctx) => ({ messages: chatHistory(db, cfg, { limit: Number(ctx.query.get('limit')) || 100 }), context: directorContext(db, cfg) }));
  post('/api/director/chat', async (ctx) => {
    const result = await askDirector(db, cfg, { ownerId: ctx.auth.user.id, ownerName: ctx.auth.user.username, question: ctx.body.question });
    audit(db, { actor: ctx.auth.user.username, action: 'director.ask', payload: { provider: result.provider, recovered: result.recovered } });
    return result;
  });
  post('/api/director/state', async (ctx) => {
    const result = setDirectorState(db, ctx.body.key, ctx.body.value, ctx.auth.user.username);
    audit(db, { actor: ctx.auth.user.username, action: 'director.state', target: ctx.body.key });
    return result;
  });
  post('/api/director/archive', async () => archiveOldChat(db, cfg));
  post('/api/director/decisions', async (ctx) => addDecision(db, { owner: ctx.auth.user.username, kind: ctx.body.kind, summary: ctx.body.summary, payload: ctx.body.payload || {} }));
  get('/api/decisions', async () => db.prepare('SELECT * FROM decisions ORDER BY ts DESC LIMIT 100').all().map(d => ({ ...d, payload: safeJSON(d.payload, {}) })));

  // ── Предложения и решения владельца ──────────────────────────────────────
  get('/api/proposals', async (ctx) => A.listProposals(db, Object.fromEntries(ctx.query)));
  post('/api/proposals/:id/review', async (ctx) => A.reviewProposal(db, ctx.params.id, { decision: ctx.body.decision, note: ctx.body.note, actor: ctx.auth.user.username }));
  post('/api/proposals/:id/execute', async (ctx) => A.executeProposal(db, ctx.params.id, { actor: ctx.auth.user.username, notifier: bot?.notifyPush }));

  // ── Alerts / инциденты ───────────────────────────────────────────────────
  get('/api/alerts', async (ctx) => {
    const status = cleanStr(ctx.query.get('status'), 20);
    return db.prepare(`SELECT * FROM alerts ${status ? 'WHERE status=?' : ''} ORDER BY ts DESC LIMIT 200`).all(...(status ? [status] : [])).map(a => ({ ...a, metrics: safeJSON(a.metrics, {}) }));
  });
  post('/api/alerts/evaluate', async (ctx) => {
    const result = evaluateAlerts(db);
    audit(db, { actor: ctx.auth.user.username, action: 'alerts.evaluate', payload: result });
    return result;
  });
  post('/api/alerts/:id/status', async (ctx) => {
    const result = setAlertStatus(db, ctx.params.id, ctx.body.status, ctx.auth.user.username);
    audit(db, { actor: ctx.auth.user.username, action: 'alert.status', target: ctx.params.id, payload: { status: ctx.body.status } });
    return result;
  });
  get('/api/incidents', async () => db.prepare('SELECT * FROM incidents ORDER BY ts DESC LIMIT 100').all());
  post('/api/incidents', async (ctx) => A.saveIncident(db, ctx.body, ctx.auth.user.username));
  patch('/api/incidents/:id', async (ctx) => A.saveIncident(db, ctx.body, ctx.auth.user.username, ctx.params.id));

  // ── LiveOps ──────────────────────────────────────────────────────────────
  get('/api/liveops', async () => ({
    maintenance: L.maintenanceState(db), news: L.newsList(db),
    pushes: db.prepare('SELECT * FROM pushes ORDER BY ts DESC LIMIT 100').all().map(p => ({ ...p, channels: safeJSON(p.channels, []) })),
    tickets: L.ticketList(db), content: db.prepare('SELECT * FROM content_plan ORDER BY target_date DESC LIMIT 100').all(),
  }));
  post('/api/maintenance', async (ctx) => L.setMaintenance(db, { ...ctx.body, actor: ctx.auth.user.username, notifier: bot?.notifyPush }));
  get('/api/news', async () => L.newsList(db));
  post('/api/news', async (ctx) => L.saveNews(db, ctx.body, ctx.auth.user.username));
  patch('/api/news/:id', async (ctx) => L.saveNews(db, ctx.body, ctx.auth.user.username, ctx.params.id));
  del('/api/news/:id', async (ctx) => {
    db.prepare('DELETE FROM news WHERE id=?').run(ctx.params.id);
    audit(db, { actor: ctx.auth.user.username, action: 'news.deleted', target: ctx.params.id });
    return { ok: true };
  });
  get('/api/pushes', async () => db.prepare('SELECT * FROM pushes ORDER BY ts DESC LIMIT 100').all().map(p => ({ ...p, channels: safeJSON(p.channels, []) })));
  post('/api/pushes', async (ctx) => L.sendPush(db, { ...ctx.body, author: ctx.auth.user.username }, { notifier: bot?.notifyPush }));
  get('/api/tickets', async (ctx) => L.ticketList(db, Object.fromEntries(ctx.query)));
  get('/api/tickets/:id', async (ctx) => L.ticketDetail(db, ctx.params.id) || { status: 404, body: { error: 'ticket not found' } });
  post('/api/tickets', async (ctx) => L.createTicket(db, ctx.body, { actor: ctx.auth.user.username, source: 'admin' }));
  patch('/api/tickets/:id', async (ctx) => L.updateTicket(db, ctx.params.id, ctx.body, ctx.auth.user.username));
  get('/api/content', async () => db.prepare('SELECT * FROM content_plan ORDER BY target_date DESC LIMIT 100').all());
  post('/api/content', async (ctx) => L.saveContent(db, ctx.body, ctx.auth.user.username));
  patch('/api/content/:id', async (ctx) => L.saveContent(db, ctx.body, ctx.auth.user.username, ctx.params.id));
  del('/api/content/:id', async (ctx) => {
    db.prepare('DELETE FROM content_plan WHERE id=?').run(ctx.params.id);
    audit(db, { actor: ctx.auth.user.username, action: 'content.deleted', target: ctx.params.id });
    return { ok: true };
  });

  // ── Настройки, аудит, интеграция ─────────────────────────────────────────
  get('/api/settings', async () => ({ settings: L.allSettings(db), config: publicConfig(cfg), bot: bot?.state || null, jobs: jobs?.last || {} }));
  patch('/api/settings', async (ctx) => L.updateSettings(db, ctx.body, ctx.auth.user.username));
  get('/api/audit', async (ctx) => {
    const limit = Math.min(300, Number(ctx.query.get('limit')) || 100);
    return db.prepare('SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?').all(limit).map(a => ({ ...a, payload: safeJSON(a.payload, {}) }));
  });
  get('/api/integration', async () => ({
    config: publicConfig(cfg), schema: eventSchemaDoc(), tables: tableCounts(db),
    ingest: { endpoint: '/api/ingest/events', keyIds: Object.keys(cfg.ingestKeys), algorithm: 'HMAC-SHA256', signature: 'hex(HMAC(secret, `${x-tt-timestamp}.${rawBody}`))', maxBatch: cfg.ingestMaxBatch },
    client: { public: ['/api/client/config', '/api/client/feed'], signed: ['/api/client/tickets', '/api/client/consents', '/api/client/deletion', '/api/client/pushes/:id/read'] },
    bot: bot?.state || null,
  }));
  post('/api/demo/seed', async (ctx) => {
    const { seedDemoData } = await import('./seed.js');
    const result = seedDemoData(db, cfg, { force: !!ctx.body.force });
    audit(db, { actor: ctx.auth.user.username, action: 'demo.seed', payload: result });
    return result;
  });
  get('/api/runbooks/:name', async (ctx) => {
    const name = path.basename(ctx.params.name);
    const file = path.join(RUNBOOK_DIR, name.endsWith('.md') ? name : `${name}.md`);
    if (!file.startsWith(RUNBOOK_DIR) || !fs.existsSync(file)) return { status: 404, body: { error: 'runbook not found' } };
    return { name, content: fs.readFileSync(file, 'utf8') };
  });

  // ── Диспетчер ────────────────────────────────────────────────────────────
  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, 'http://crm.local');
    const pathname = decodeURIComponent(url.pathname);
    applySecurity(req, res, cfg);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!pathname.startsWith('/api/')) return serveStatic(req, res, pathname);
    const found = routes.find(r => r.method === req.method && r.regex.test(pathname));
    if (!found) return json(res, 404, { error: 'API route not found', path: pathname });
    const ip = clientIp(req);
    const limiter = auth.generalLimiter.check(`${ip}:${found.opts.ingest ? 'ingest' : 'api'}`);
    if (!limiter.ok) return json(res, 429, { error: 'rate limit exceeded', retryAfter: limiter.retryAfter });
    const match = pathname.match(found.regex);
    const params = Object.fromEntries(found.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
    const ctx = { req, res, params, query: url.searchParams, ip, body: {}, raw: '', auth: null, signature: null };
    try {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
        const parsed = await readJson(req, 5 * 1024 * 1024);
        ctx.raw = parsed.raw; ctx.body = parsed.body;
      }
      if (found.opts.signed) {
        const signature = verifyIngestSignature({ headers: req.headers, rawBody: ctx.raw, cfg, nonces });
        if (!signature.ok) return json(res, signature.status, { error: signature.error });
        ctx.signature = signature;
      }
      if (!found.opts.public) {
        ctx.auth = auth.sessionFromRequest(req);
        if (!ctx.auth) return json(res, 401, { error: 'authentication required' });
        if (ctx.auth.user.role !== 'admin') return json(res, 403, { error: 'admin role required' });
        if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) && !auth.csrfOk(req, ctx)) {
          return json(res, 403, { error: 'CSRF token missing or invalid' });
        }
      }
      const result = await found.handler(ctx);
      if (res.writableEnded) return;
      if (result?.raw && result.send) { result.send(); return; }
      if (result && typeof result === 'object' && 'status' in result && 'body' in result && typeof result.status === 'number') {
        return json(res, result.status, result.body);
      }
      json(res, 200, result ?? { ok: true });
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) logger.error(`[api] ${req.method} ${pathname}:`, err.stack || err.message);
      if (!res.writableEnded) json(res, status, { error: status >= 500 ? 'internal server error' : err.message, requestId: uuid().slice(0, 8) });
    } finally {
      const ms = Date.now() - started;
      if (ms > 5000) logger.warn(`[slow] ${req.method} ${pathname} ${ms}ms`);
    }
  }
  return { handle, routes, close: () => clearInterval(nonceTimer) };
}

function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'method not allowed' });
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) return json(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // SPA fallback только для навигации, не для отсутствующих ассетов.
    if (!path.extname(rel)) {
      const index = path.join(PUBLIC_DIR, 'index.html');
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(index));
    }
    return json(res, 404, { error: 'file not found' });
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Length': fs.statSync(file).size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function saveLabTest(db, data, actor, id = null) {
  const name = cleanStr(data.name, 240);
  if (!name) throw Object.assign(new Error('name required'), { status: 400 });
  const status = ['draft', 'running', 'paused', 'completed', 'cancelled'].includes(data.status) ? data.status : 'draft';
  const variants = Array.isArray(data.variants) ? data.variants.slice(0, 8).map((v, i) => ({ id: cleanStr(v.id || String.fromCharCode(65 + i), 10), name: cleanStr(v.name || v, 160), rules: v.rules || {} })) : [];
  const patch = {
    name, hypothesis: cleanStr(data.hypothesis, 2000), zone: cleanStr(data.zone || 'balance', 20),
    status, variants: JSON.stringify(variants), winner: cleanStr(data.winner, 40) || null,
    started_at: status === 'running' ? (data.started_at || nowISO()) : data.started_at || null,
    ended_at: status === 'completed' ? nowISO() : null,
    metrics: JSON.stringify(Array.isArray(data.metrics) ? data.metrics.map(x => cleanStr(x, 60)) : ['success_rate', 'reject_rate']),
    notes: cleanStr(data.notes, 3000),
  };
  if (id) {
    if (!db.prepare('SELECT id FROM lab_tests WHERE id=?').get(id)) throw Object.assign(new Error('test not found'), { status: 404 });
    updateRow(db, 'lab_tests', id, patch);
  } else {
    id = uuid();
    insert(db, 'lab_tests', { id, ts: nowISO(), created_by: actor, ...patch });
  }
  audit(db, { actor, action: 'lab.test_saved', target: id, payload: { name, status } });
  return db.prepare('SELECT * FROM lab_tests WHERE id=?').get(id);
}
