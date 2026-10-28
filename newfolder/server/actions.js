/* Human-in-the-loop: предложения зон не исполняются сами.
 * approve/reject — решение владельца; execute — отдельное подтверждённое
 * действие со строгим белым списком и аудитом. */
import { updateRow, getSetting, setSetting, audit } from './db.js';
import { safeJSON, nowISO, cleanStr } from './util.js';
import { addDecision } from './ai/director.js';
import { updateSettings, sendPush } from './liveops.js';

export function listProposals(db, { status = '', zone = '' } = {}) {
  const where = ['1=1']; const args = [];
  if (status) { where.push('status=?'); args.push(status); }
  if (zone) { where.push('zone=?'); args.push(zone); }
  return db.prepare(`SELECT * FROM proposals WHERE ${where.join(' AND ')} ORDER BY ts DESC LIMIT 200`)
    .all(...args).map(p => ({ ...p, payload: safeJSON(p.payload, {}) }));
}

export function reviewProposal(db, id, { decision, note = '', actor = 'owner' }) {
  const p = db.prepare('SELECT * FROM proposals WHERE id=?').get(id);
  if (!p) throw Object.assign(new Error('proposal not found'), { status: 404 });
  if (!['approve', 'reject'].includes(decision)) throw Object.assign(new Error('decision must be approve/reject'), { status: 400 });
  if (!['pending', 'approved'].includes(p.status) && decision === 'approve') throw Object.assign(new Error('proposal already reviewed'), { status: 409 });
  const status = decision === 'approve' ? 'approved' : 'rejected';
  updateRow(db, 'proposals', id, { status, reviewed_by: actor, reviewed_at: nowISO(), review_note: cleanStr(note, 1000) });
  addDecision(db, { owner: actor, kind: p.kind, summary: `${decision === 'approve' ? 'Одобрено' : 'Отклонено'}: ${p.title}`, payload: safeJSON(p.payload, {}), proposalId: id });
  audit(db, { actor, action: `proposal.${decision}d`, target: id, payload: { note } });
  return { ...db.prepare('SELECT * FROM proposals WHERE id=?').get(id), payload: safeJSON(p.payload, {}) };
}

export async function executeProposal(db, id, { actor = 'owner', notifier = null } = {}) {
  const p = db.prepare('SELECT * FROM proposals WHERE id=?').get(id);
  if (!p) throw Object.assign(new Error('proposal not found'), { status: 404 });
  if (p.status !== 'approved') throw Object.assign(new Error('proposal must be approved first'), { status: 409 });
  const payload = safeJSON(p.payload, {});
  let result = {};
  switch (p.kind) {
    case 'update_rules': {
      if (!payload.key || payload.value === undefined) throw Object.assign(new Error('payload requires key and value; change MATCH_RULES manually in Settings'), { status: 400 });
      result.settings = updateSettings(db, { match_rules: { [payload.key]: payload.value } }, actor);
      break;
    }
    case 'rollback_build': {
      const target = cleanStr(payload.target, 80);
      if (!target) throw Object.assign(new Error('payload.target required'), { status: 400 });
      result.settings = updateSettings(db, { active_build: target }, actor);
      break;
    }
    case 'pause_campaign': {
      const campaign = cleanStr(payload.campaign, 100);
      if (!campaign) throw Object.assign(new Error('payload.campaign required'), { status: 400 });
      const paused = getSetting(db, 'paused_campaigns', []);
      if (!paused.includes(campaign)) paused.push(campaign);
      result.settings = updateSettings(db, { paused_campaigns: paused }, actor);
      break;
    }
    case 'send_push': {
      if (!payload.title || !payload.body) throw Object.assign(new Error('payload.title/body required'), { status: 400 });
      result.push = await sendPush(db, { ...payload, author: actor }, { notifier });
      break;
    }
    case 'continue_test': {
      const testName = cleanStr(payload.test || payload.test_id, 200);
      const test = db.prepare('SELECT * FROM lab_tests WHERE id=? OR name=?').get(testName, testName);
      if (!test) throw Object.assign(new Error('test not found; open Lab and choose it manually'), { status: 400 });
      updateRow(db, 'lab_tests', test.id, { status: 'running', ended_at: null });
      result.test = db.prepare('SELECT * FROM lab_tests WHERE id=?').get(test.id);
      break;
    }
    case 'review_case':
      throw Object.assign(new Error('Fraud cases require manual evidence review; nothing was executed'), { status: 400 });
    case 'ops_review':
    default:
      result.note = 'Решение зафиксировано. Автоматических изменений игры не выполнялось.';
      break;
  }
  updateRow(db, 'proposals', id, { status: 'executed', executed_at: nowISO() });
  addDecision(db, { owner: actor, kind: p.kind, summary: `Исполнено после подтверждения: ${p.title}`, payload, proposalId: id });
  audit(db, { actor, action: 'proposal.executed', target: id, payload });
  return { ok: true, result, proposal: { ...db.prepare('SELECT * FROM proposals WHERE id=?').get(id), payload } };
}

export function saveIncident(db, data, actor = 'owner', id = null) {
  const patch = {
    title: cleanStr(data.title, 240),
    status: ['open', 'mitigated', 'resolved'].includes(data.status) ? data.status : 'open',
    severity: ['info', 'warning', 'critical'].includes(data.severity) ? data.severity : 'warning',
    zone: cleanStr(data.zone || 'ops', 20), owner: actor,
    summary: cleanStr(data.summary, 3000),
    resolved_at: data.status === 'resolved' ? nowISO() : null,
  };
  if (!patch.title) throw Object.assign(new Error('title required'), { status: 400 });
  if (id) updateRow(db, 'incidents', id, patch);
  else {
    id = globalThis.crypto.randomUUID();
    db.prepare(`INSERT INTO incidents(id,ts,title,status,severity,zone,owner,summary,created_by,resolved_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id, nowISO(), patch.title, patch.status, patch.severity, patch.zone, actor, patch.summary, actor, patch.resolved_at);
  }
  audit(db, { actor, action: 'incident.saved', target: id, payload: patch });
  return db.prepare('SELECT * FROM incidents WHERE id=?').get(id);
}

export function runRetention(db, cfg) {
  const days = cfg.retention;
  const cutoff = (n) => new Date(Date.now() - n * 86400e3).toISOString();
  const out = {};
  out.input_logs = db.prepare('DELETE FROM input_logs WHERE ts<?').run(cutoff(days.inputDays)).changes;
  out.input_events = db.prepare("DELETE FROM events WHERE type='input' AND ts<?").run(cutoff(days.inputDays)).changes;
  out.events = db.prepare('DELETE FROM events WHERE ts<?').run(cutoff(days.telemetryDays)).changes;
  out.ops_perf = db.prepare('DELETE FROM ops_perf WHERE ts<?').run(cutoff(days.telemetryDays)).changes;
  out.ai_requests = db.prepare('DELETE FROM ai_requests WHERE ts<?').run(cutoff(days.aiDays)).changes;
  out.director_chat = db.prepare('DELETE FROM director_chat WHERE ts<?').run(cutoff(days.chatDays)).changes;
  out.audit_log = db.prepare('DELETE FROM audit_log WHERE ts<?').run(cutoff(days.chatDays)).changes;
  out.expired_sessions = db.prepare('DELETE FROM sessions WHERE expires_at<?').run(nowISO()).changes;
  setSetting(db, 'last_retention_run', { at: nowISO(), deleted: out }, 'system');
  return out;
}
