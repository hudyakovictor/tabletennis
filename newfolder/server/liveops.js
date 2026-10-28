/* LiveOps: техработы, пуши, новости, поддержка, контент-план, настройки.
 * Пуши и новости — разные сущности и разные ленты (17-maintenance...). */
import { insert, updateRow, getSetting, setSetting, audit } from './db.js';
import { uuid, nowISO, cleanStr, safeJSON } from './util.js';

export const NEWS_CATEGORIES = ['patch_notes', 'known_issues', 'event', 'announcement'];
export const TICKET_STATUSES = ['new', 'in_progress', 'resolved', 'closed'];
export const CONTENT_STATUSES = ['idea', 'planned', 'in_progress', 'released', 'cancelled'];

export function allSettings(db) {
  return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, safeJSON(r.value, r.value)]));
}

export function maintenanceState(db) {
  return {
    enabled: !!getSetting(db, 'maintenance_mode', false),
    text: getSetting(db, 'maintenance_text', ''),
    eta: getSetting(db, 'maintenance_eta', ''),
  };
}

export async function setMaintenance(db, { enabled, text, eta = '', actor = 'owner', notifier = null }) {
  const before = maintenanceState(db);
  const next = !!enabled;
  if (text !== undefined) setSetting(db, 'maintenance_text', cleanStr(text, 500), actor);
  setSetting(db, 'maintenance_eta', cleanStr(eta, 100), actor);
  setSetting(db, 'maintenance_mode', next, actor);
  let push = null;
  if (before.enabled !== next) {
    push = await sendPush(db, {
      title: next ? 'Идут технические работы' : 'Работа восстановлена',
      body: next ? (cleanStr(text, 500) || before.text || 'Матчи временно недоступны.') : 'Матчи снова доступны. Спасибо за ожидание!',
      level: next ? 'critical' : 'info', segment: 'all', author: actor, auto: true,
      dedupeKey: `maintenance:${next}:${Date.now()}`,
    }, { notifier });
  }
  audit(db, { actor, action: 'maintenance.changed', payload: { before, after: maintenanceState(db), autoPush: !!push } });
  return { state: maintenanceState(db), push };
}

export async function sendPush(db, data, { notifier = null } = {}) {
  const title = cleanStr(data.title, 200);
  const body = cleanStr(data.body, 2000);
  if (!title || !body) throw Object.assign(new Error('title and body required'), { status: 400 });
  const row = {
    id: uuid(), ts: nowISO(), title, body,
    level: ['critical', 'warning', 'info'].includes(data.level) ? data.level : 'critical',
    channels: JSON.stringify(Array.isArray(data.channels) && data.channels.length ? data.channels : ['in-app', 'telegram']),
    segment: cleanStr(data.segment || 'all', 80),
    status: 'sent', sent_at: nowISO(), author: data.author || 'owner',
    auto: data.auto ? 1 : 0, dismissible: data.dismissible === false ? 0 : 1,
    dedupe_key: data.dedupeKey || null,
  };
  if (row.dedupe_key) {
    const dup = db.prepare('SELECT * FROM pushes WHERE dedupe_key=?').get(row.dedupe_key);
    if (dup) return { ...dup, channels: safeJSON(dup.channels, []), duplicate: true };
  }
  insert(db, 'pushes', row);
  if (notifier) {
    try { await notifier(row); }
    catch (e) { updateRow(db, 'pushes', row.id, { status: 'in-app-only' }); row.status = 'in-app-only'; row.deliveryError = String(e.message).slice(0, 200); }
  }
  audit(db, { actor: row.author, action: 'push.sent', target: row.id, payload: { title, segment: row.segment, auto: !!row.auto } });
  return { ...row, channels: safeJSON(row.channels, []) };
}

export function newsList(db, { includeDrafts = true } = {}) {
  return db.prepare(`SELECT * FROM news ${includeDrafts ? '' : "WHERE status='published'"} ORDER BY COALESCE(published_at,ts) DESC LIMIT 200`).all();
}

export function saveNews(db, data, actor = 'owner', id = null) {
  const title = cleanStr(data.title, 200);
  const body = cleanStr(data.body, 12000);
  if (!title || !body) throw Object.assign(new Error('title and body required'), { status: 400 });
  const category = NEWS_CATEGORIES.includes(data.category) ? data.category : 'announcement';
  const status = ['draft', 'published', 'archived'].includes(data.status) ? data.status : 'draft';
  const patch = {
    title, body, category, status,
    published_at: status === 'published' ? (data.published_at || nowISO()) : null,
    author: actor, pinned: data.pinned ? 1 : 0, lang: data.lang === 'en' ? 'en' : 'ru',
  };
  if (id) {
    if (!db.prepare('SELECT id FROM news WHERE id=?').get(id)) throw Object.assign(new Error('news not found'), { status: 404 });
    updateRow(db, 'news', id, patch);
  } else {
    id = uuid();
    insert(db, 'news', { id, ts: nowISO(), ...patch });
  }
  audit(db, { actor, action: 'news.saved', target: id, payload: { title, status } });
  return db.prepare('SELECT * FROM news WHERE id=?').get(id);
}

export function ticketList(db, { status = '', search = '', limit = 100 } = {}) {
  const where = ['1=1']; const args = [];
  if (status) { where.push('t.status=?'); args.push(status); }
  if (search) { where.push('(t.subject LIKE ? OR t.body LIKE ? OR t.player_id LIKE ?)'); args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  return db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id) AS messages
    FROM tickets t WHERE ${where.join(' AND ')} ORDER BY t.updated_at DESC LIMIT ?`)
    .all(...args, Math.min(300, Number(limit) || 100));
}

export function ticketDetail(db, id) {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!ticket) return null;
  return { ...ticket, messages: db.prepare('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY ts').all(id) };
}

export function createTicket(db, data, { actor = 'player', source = 'admin' } = {}) {
  const subject = cleanStr(data.subject, 200);
  const body = cleanStr(data.body || data.message, 6000);
  if (!subject || !body) throw Object.assign(new Error('subject and body required'), { status: 400 });
  const id = uuid();
  const ts = nowISO();
  insert(db, 'tickets', {
    id, ts, player_id: cleanStr(data.player_id, 120) || null,
    region: cleanStr(data.region || 'OTHER', 8).toUpperCase(), subject, body,
    status: 'new', priority: ['low', 'normal', 'high', 'critical'].includes(data.priority) ? data.priority : 'normal',
    screenshot_url: cleanStr(data.screenshot_url, 500) || null,
    build_version: cleanStr(data.build_version, 60) || null, updated_at: ts,
    assignee: null, source, related_known_issue: null,
  });
  insert(db, 'ticket_messages', { id: uuid(), ts, ticket_id: id, author_role: 'player', author: actor, body, visible_to_player: 1 });
  return ticketDetail(db, id);
}

export function updateTicket(db, id, data, actor = 'owner') {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(id);
  if (!t) throw Object.assign(new Error('ticket not found'), { status: 404 });
  const patch = { updated_at: nowISO() };
  if (data.status) {
    if (!TICKET_STATUSES.includes(data.status)) throw Object.assign(new Error('invalid ticket status'), { status: 400 });
    patch.status = data.status;
  }
  if (data.priority && ['low', 'normal', 'high', 'critical'].includes(data.priority)) patch.priority = data.priority;
  if (data.assignee !== undefined) patch.assignee = cleanStr(data.assignee, 100) || null;
  updateRow(db, 'tickets', id, patch);
  const reply = cleanStr(data.reply, 6000);
  if (reply) insert(db, 'ticket_messages', {
    id: uuid(), ts: nowISO(), ticket_id: id, author_role: 'support', author: actor,
    body: reply, visible_to_player: data.internal ? 0 : 1,
  });
  audit(db, { actor, action: 'ticket.updated', target: id, payload: { status: patch.status, replied: !!reply } });
  return ticketDetail(db, id);
}

export function saveContent(db, data, actor = 'owner', id = null) {
  const title = cleanStr(data.title, 240);
  if (!title) throw Object.assign(new Error('title required'), { status: 400 });
  const patch = {
    title, kind: cleanStr(data.kind || 'content', 40),
    status: CONTENT_STATUSES.includes(data.status) ? data.status : 'planned',
    target_date: cleanStr(data.target_date, 20) || null,
    owner: cleanStr(data.owner || actor, 100), notes: cleanStr(data.notes, 3000),
  };
  if (id) updateRow(db, 'content_plan', id, patch);
  else { id = uuid(); insert(db, 'content_plan', { id, ts: nowISO(), ...patch }); }
  audit(db, { actor, action: 'content.saved', target: id, payload: patch });
  return db.prepare('SELECT * FROM content_plan WHERE id=?').get(id);
}

const RULE_LIMITS = {
  version: [1, 100], captureRadius: [0.05, 1], depthTolerance: [0.05, 1],
  ovalSideTouchPx: [10, 200], ovalSideMousePx: [10, 200], serveCaptureRadius: [0.05, 2],
  trajectoryAssist: [0, 1], positionAssist: [0, 1], ovalLeadSec: [0, 1],
  ovalForwardPx: [0, 300], ovalBackPx: [0, 300], pressRadiusPx: [10, 300],
};
const SETTING_KEYS = new Set(['feature_flags', 'match_rules', 'alert_thresholds', 'active_build', 'paused_campaigns', 'rules_version']);

export function updateSettings(db, patch, actor = 'owner') {
  const updated = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!SETTING_KEYS.has(key)) throw Object.assign(new Error(`setting not allowed: ${key}`), { status: 400 });
    if (key === 'match_rules') {
      const current = getSetting(db, 'match_rules', {});
      const next = { ...current };
      for (const [k, v] of Object.entries(value || {})) {
        if (k === 'zoneShape' && ['oval', 'circle'].includes(v)) { next[k] = v; continue; }
        if (!(k in RULE_LIMITS)) throw Object.assign(new Error(`unknown MATCH_RULES key: ${k}`), { status: 400 });
        const n = Number(v);
        const [lo, hi] = RULE_LIMITS[k];
        if (!Number.isFinite(n) || n < lo || n > hi) throw Object.assign(new Error(`${k} must be ${lo}..${hi}`), { status: 400 });
        next[k] = n;
      }
      setSetting(db, key, next, actor); updated[key] = next;
    } else if (key === 'feature_flags') {
      const current = getSetting(db, key, {});
      const next = { ...current };
      for (const [k, v] of Object.entries(value || {})) {
        if (['__proto__', 'constructor', 'prototype'].includes(k)) throw Object.assign(new Error('unsafe feature flag key'), { status: 400 });
        next[cleanStr(k, 40)] = !!v;
      }
      setSetting(db, key, next, actor); updated[key] = next;
    } else if (key === 'alert_thresholds') {
      const next = {};
      for (const [k, v] of Object.entries(value || {})) {
        if (['__proto__', 'constructor', 'prototype'].includes(k)) throw Object.assign(new Error('unsafe threshold key'), { status: 400 });
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100000) throw Object.assign(new Error(`invalid threshold ${k}`), { status: 400 });
        next[cleanStr(k, 40)] = n;
      }
      setSetting(db, key, next, actor); updated[key] = next;
    } else if (key === 'paused_campaigns') {
      const next = Array.isArray(value) ? value.map(x => cleanStr(x, 100)).filter(Boolean).slice(0, 100) : [];
      setSetting(db, key, next, actor); updated[key] = next;
    } else {
      const next = cleanStr(value, 100);
      setSetting(db, key, next, actor); updated[key] = next;
    }
  }
  audit(db, { actor, action: 'settings.updated', payload: updated });
  return updated;
}

/** Публичный конфиг игры. Секретов и внутренних URL админки здесь нет. */
export function clientConfig(db, cfg) {
  const m = maintenanceState(db);
  return {
    version: cfg.version,
    server_time: nowISO(),
    maintenance: { enabled: m.enabled, text: m.text, eta: m.eta, block_matchmaking: m.enabled },
    feature_flags: getSetting(db, 'feature_flags', {}),
    match_rules: getSetting(db, 'match_rules', {}),
    rules_version: getSetting(db, 'rules_version', 4),
    active_build: getSetting(db, 'active_build', ''),
    paused_campaigns: getSetting(db, 'paused_campaigns', []),
    region_endpoints: cfg.regionEndpoints,
    ping_warn_ms: cfg.pingWarnMs,
  };
}

export function clientFeed(db, { playerId = '', region = '', platform = '' } = {}) {
  const news = newsList(db, { includeDrafts: false }).filter(n => n.status === 'published').slice(0, 50)
    .map(n => ({ id: n.id, title: n.title, body: n.body, category: n.category, published_at: n.published_at, pinned: !!n.pinned }));
  const pushes = db.prepare(`SELECT * FROM pushes WHERE status IN ('sent','in-app-only') ORDER BY ts DESC LIMIT 50`).all()
    .filter(p => p.segment === 'all' || p.segment === region || p.segment === platform)
    .map(p => {
      const read = playerId ? db.prepare('SELECT * FROM push_reads WHERE push_id=? AND player_id=?').get(p.id, playerId) : null;
      return {
        id: p.id, title: p.title, body: p.body, level: p.level, ts: p.ts,
        important: true, pinned: !read?.dismissed_at, auto: !!p.auto,
        dismissible: !!p.dismissible, read_at: read?.read_at || null, dismissed_at: read?.dismissed_at || null,
      };
    });
  // Пуши отдельно и всегда приоритетнее; не смешиваются с новостями.
  pushes.sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(b.ts).localeCompare(String(a.ts)));
  return { pushes, news, maintenance: maintenanceState(db) };
}

export function markPushRead(db, pushId, playerId, { dismissed = false } = {}) {
  if (!playerId) throw Object.assign(new Error('player_id required'), { status: 400 });
  const now = nowISO();
  db.prepare(`INSERT INTO push_reads(push_id,player_id,read_at,dismissed_at) VALUES(?,?,?,?)
    ON CONFLICT(push_id,player_id) DO UPDATE SET read_at=COALESCE(push_reads.read_at,excluded.read_at),
    dismissed_at=COALESCE(excluded.dismissed_at,push_reads.dismissed_at)`)
    .run(pushId, playerId, now, dismissed ? now : null);
  return { ok: true, push_id: pushId, player_id: playerId };
}
